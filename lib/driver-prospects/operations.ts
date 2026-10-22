import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { requireAdditionalSystemCapability, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { enterSystemCapability } from "@/lib/company-directory/capability-context"
import { setDateOfBirth } from "@/lib/contact-identity/identity-details"
import { prepareChannel, prepareName } from "@/lib/contacts/definitions"
import * as contactsRepo from "@/lib/contacts/repository"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType } from "@/lib/master-register/types"
import * as identity from "@/lib/operational-identity/operations"
import {
  DriverProspectConflictError,
  DriverProspectNotFoundError,
  DriverProspectStateError,
  DriverProspectValidationError,
} from "./errors"
import { prospectSchemaMessage, prospectSchemaState } from "./schema-state"
import {
  PROSPECT_STATUS_LABEL,
  REVIEW_TARGETS,
  type ConvertProspectInput,
  type CreateProspectInput,
  type InvitationStatus,
  type ProspectStatus,
  type ProspectView,
  type ReviewTarget,
} from "./types"

export type ProspectContext = { client: PoolClient; actor: { id: string; actorType: ActorType }; masterRegister: MasterRegisterRepository }

export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIVE_STATUSES = ["PROSPECT", "INVITED", "APPLICATION_SUBMITTED", "UNDER_REVIEW"]
export const hashInvitationToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex")

const uuid = (value: unknown, field: string) => {
  if (typeof value !== "string" || !UUID.test(value.trim())) throw new DriverProspectValidationError(field, `${field} must be a UUID.`)
  return value.trim()
}

async function requireSchema(ctx: ProspectContext, what: string) {
  const state = await prospectSchemaState(ctx.client)
  if (state !== "COMPLETE") throw new DriverProspectStateError(prospectSchemaMessage(state, what))
}

async function mr(ctx: ProspectContext, eventType: string, operation: string, resourceType: string, resourceId: string, organizationId: string, subjects: string[], after?: { field: string; value: string }) {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: { resourceType, resourceId, companyId: organizationId, subjectReferences: [`organization:${organizationId}`, ...subjects] },
    source: { sourceType: "APPLICATION", component: "driver-prospects", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: {
      changedFields: [after?.field ?? "record"],
      fieldChanges: [{ field: after?.field ?? "record", after: after ? { kind: "LITERAL", value: after.value } : { kind: "REFERENCE", reference: `${resourceType}:${resourceId}` } }],
    },
    outcome: { result: "SUCCESS" },
  } as never)
}

async function event(ctx: ProspectContext, prospectId: string, organizationId: string, type: string, from: string | null, to: string | null, invitationId: string | null) {
  await ctx.client.query(
    `INSERT INTO public.driver_prospect_events (prospect_id, organization_id, event_type, from_status, to_status, invitation_id, actor_id, source) VALUES ($1, $2, $3, $4, $5, $6, $7, 'STAFF')`,
    [prospectId, organizationId, type, from, to, invitationId, ctx.actor.id],
  )
}

async function activeOrganization(ctx: ProspectContext, organizationId: string): Promise<{ name: string }> {
  const r = await ctx.client.query<{ status: string; name: string }>(`SELECT status, coalesce(display_name, legal_name) AS name FROM public.organizations WHERE id = $1 FOR UPDATE`, [organizationId])
  if (!r.rows[0]) throw new DriverProspectNotFoundError("Company not found.")
  if (r.rows[0].status !== "active") throw new DriverProspectStateError("The company must be active.")
  return { name: r.rows[0].name }
}

type ProspectRow = { id: string; organization_id: string; person_id: string; status: ProspectStatus; converted_relationship_id: string | null }
/** The prospect of THIS company only: another company's prospect is indistinguishable from one that does not exist. */
async function lockProspect(ctx: ProspectContext, organizationId: string, prospectId: string): Promise<ProspectRow> {
  const r = await ctx.client.query<ProspectRow>(
    `SELECT id, organization_id, person_id, status, converted_relationship_id FROM public.driver_prospects WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
    [prospectId, organizationId],
  )
  if (!r.rows[0]) throw new DriverProspectNotFoundError("Prospect not found.")
  return r.rows[0]
}

async function savepoint<T>(ctx: ProspectContext, work: () => Promise<T>, onViolation: () => Error): Promise<T> {
  await ctx.client.query("SAVEPOINT driver_prospect_write")
  try {
    const result = await work()
    await ctx.client.query("RELEASE SAVEPOINT driver_prospect_write")
    return result
  } catch (error) {
    await ctx.client.query("ROLLBACK TO SAVEPOINT driver_prospect_write")
    await ctx.client.query("RELEASE SAVEPOINT driver_prospect_write")
    const code = (error as { code?: string }).code
    if (code === "23505") throw onViolation()
    if (code === "23514") throw new DriverProspectStateError((error as Error).message)
    throw error
  }
}

function splitFullName(raw: unknown): { given: string; family: string } {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : ""
  const parts = text.split(" ").filter(Boolean)
  if (parts.length < 2) throw new DriverProspectValidationError("fullName", "Enter the first and last name.")
  if (text.length > 120) throw new DriverProspectValidationError("fullName", "The name is too long.")
  return { given: parts[0], family: parts.slice(1).join(" ") }
}

/**
 * Saves a prospective driver: a canonical person (name + email and/or phone) linked to THIS company by a driver_prospects row. It requires only a
 * full name and one usable contact method, and invents nothing else (no date of birth, address, licence or start date). The prospect is not a
 * driver relationship: it holds nothing exclusively and never appears in the driver roster. A person this company already knows by the same email
 * or phone (as a prospect or a driver) is REUSED or refused, never duplicated.
 */
export async function createProspect(ctx: ProspectContext, decision: SystemAuthorizationDecision, input: CreateProspectInput) {
  await requireSchema(ctx, "Adding a driver prospect")
  const organizationId = uuid(input.organizationId, "organizationId")
  const { given, family } = splitFullName(input.fullName)
  const name = prepareName(given, family)
  const email = input.email && input.email.trim() !== "" ? prepareChannel("EMAIL", input.email, undefined, "email") : null
  const phone = input.phone && input.phone.trim() !== "" ? prepareChannel("PHONE", input.phone, undefined, "phone") : null
  if (!email && !phone) throw new DriverProspectValidationError("contact", "Enter an email address or a phone number.")
  await requireAdditionalSystemCapability(ctx.client, decision, "DRIVER_MANAGE")
  await activeOrganization(ctx, organizationId)

  // The same person already known to THIS company by the same email or phone is reused (or refused), never duplicated.
  const known = await ctx.client.query<{ person_id: string; live: boolean; driver: boolean }>(
    `SELECT pc.person_id,
            EXISTS (SELECT 1 FROM public.driver_prospects p WHERE p.person_id = pc.person_id AND p.organization_id = $3 AND p.status = ANY($4::text[])) AS live,
            EXISTS (SELECT 1 FROM public.organization_driver_relationships r WHERE r.person_id = pc.person_id AND r.organization_id = $3 AND r.record_status = 'active' AND r.effective_to IS NULL) AS driver
       FROM public.person_channels pc
      WHERE pc.record_status = 'active' AND pc.effective_to IS NULL
        AND ((pc.channel_type = 'EMAIL' AND pc.value_normalized = $1) OR (pc.channel_type = 'PHONE' AND pc.value_normalized = $2))
        AND (EXISTS (SELECT 1 FROM public.driver_prospects p WHERE p.person_id = pc.person_id AND p.organization_id = $3)
          OR EXISTS (SELECT 1 FROM public.organization_driver_relationships r WHERE r.person_id = pc.person_id AND r.organization_id = $3))`,
    [email?.normalized ?? null, phone?.normalized ?? null, organizationId, LIVE_STATUSES],
  )
  if (known.rows.some((row) => row.live)) throw new DriverProspectConflictError("This person is already a prospect of this company. Nothing was saved.")
  if (known.rows.some((row) => row.driver)) throw new DriverProspectConflictError("This person is already a driver of this company. Nothing was saved.")
  const reused = known.rows[0]?.person_id ?? null

  const at = (await ctx.client.query<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).rows[0].t
  const personId = reused ?? randomUUID()
  if (!reused) {
    await enterSystemCapability(ctx.client, "DRIVER_MANAGE")
    await contactsRepo.insertPerson(ctx.client, personId)
    await contactsRepo.insertName(ctx.client, { id: randomUUID(), personId, givenName: name.givenName, familyName: name.familyName, normalized: name.normalized, reason: "INITIAL", effectiveFrom: at })
    let first = true
    for (const [type, channel] of [["EMAIL", email], ["PHONE", phone]] as const) {
      if (!channel) continue
      await contactsRepo.insertPersonChannel(ctx.client, {
        id: randomUUID(), personId, channelType: type, display: channel.display, normalized: channel.normalized, ruleVersion: channel.ruleVersion,
        extension: channel.extension, preferred: first, reason: "INITIAL", effectiveFrom: at,
      })
      first = false
    }
  }
  const prospectId = randomUUID()
  await savepoint(
    ctx,
    () => ctx.client.query(`INSERT INTO public.driver_prospects (id, organization_id, person_id, created_by_actor_id) VALUES ($1, $2, $3, $4)`, [prospectId, organizationId, personId, ctx.actor.id]),
    () => new DriverProspectConflictError("This person is already a prospect of this company. Nothing was saved."),
  )
  await event(ctx, prospectId, organizationId, "PROSPECT_CREATED", null, "PROSPECT", null)
  await mr(ctx, "RECORD_CREATED", "DRIVER_PROSPECT_CREATE", "driver_prospects", prospectId, organizationId, [`person:${personId}`])
  return { prospectId, personId, status: "PROSPECT" as const, personReused: reused !== null }
}

/** Adds an email address to a prospect that has none (for example one saved with only a phone number), so an application can be sent. */
export async function addProspectEmail(ctx: ProspectContext, input: { organizationId: string; prospectId: string; email: string }) {
  await requireSchema(ctx, "Adding an email address")
  const organizationId = uuid(input.organizationId, "organizationId")
  const prospect = await lockProspect(ctx, organizationId, uuid(input.prospectId, "prospectId"))
  if (!LIVE_STATUSES.includes(prospect.status)) throw new DriverProspectStateError("This prospect is closed. Nothing was changed.")
  const email = prepareChannel("EMAIL", input.email, undefined, "email")
  const existing = await ctx.client.query(`SELECT 1 FROM public.person_channels WHERE person_id = $1 AND channel_type = 'EMAIL' AND record_status = 'active' AND effective_to IS NULL`, [prospect.person_id])
  if ((existing.rowCount ?? 0) > 0) throw new DriverProspectConflictError("This prospect already has an email address. Nothing was changed.")
  const at = (await ctx.client.query<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).rows[0].t
  await contactsRepo.insertPersonChannel(ctx.client, {
    id: randomUUID(), personId: prospect.person_id, channelType: "EMAIL", display: email.display, normalized: email.normalized, ruleVersion: email.ruleVersion,
    extension: null, preferred: true, reason: "INITIAL", effectiveFrom: at,
  })
  await mr(ctx, "RECORD_UPDATED", "DRIVER_PROSPECT_EMAIL_ADD", "driver_prospects", prospect.id, organizationId, [`person:${prospect.person_id}`])
  return { prospectId: prospect.id }
}

export async function listProspects(ctx: ProspectContext, organizationIdInput: string): Promise<ProspectView[]> {
  await requireSchema(ctx, "The prospect list")
  const organizationId = uuid(organizationIdInput, "organizationId")
  const r = await ctx.client.query(
    `SELECT p.id, p.person_id, p.status, p.created_at, p.status_changed_at, p.converted_relationship_id,
            n.given_name, n.family_name,
            (SELECT c.value_display FROM public.person_channels c WHERE c.person_id = p.person_id AND c.channel_type = 'EMAIL' AND c.record_status = 'active' AND c.effective_to IS NULL ORDER BY c.is_preferred DESC, c.created_at LIMIT 1) AS email,
            (SELECT c.value_display FROM public.person_channels c WHERE c.person_id = p.person_id AND c.channel_type = 'PHONE' AND c.record_status = 'active' AND c.effective_to IS NULL ORDER BY c.is_preferred DESC, c.created_at LIMIT 1) AS phone,
            i.id AS invitation_id, i.status AS invitation_status, i.sent_at, i.expires_at
       FROM public.driver_prospects p
       LEFT JOIN public.person_name_versions n ON n.person_id = p.person_id AND n.record_status = 'active' AND n.effective_to IS NULL
       LEFT JOIN LATERAL (SELECT * FROM public.driver_application_invitations x WHERE x.prospect_id = p.id ORDER BY x.created_at DESC LIMIT 1) i ON true
      WHERE p.organization_id = $1
      ORDER BY p.created_at DESC, p.id`,
    [organizationId],
  )
  return r.rows.map((row) => {
    const live = LIVE_STATUSES.slice(0, 2).includes(row.status)
    const blocked = !live ? "Applications can be sent only while the prospect is a prospect or has an invitation out." : !row.email ? "Add an email address to send an application." : null
    return {
      prospectId: row.id,
      personId: row.person_id,
      status: row.status,
      statusLabel: PROSPECT_STATUS_LABEL[row.status as ProspectStatus],
      givenName: row.given_name,
      familyName: row.family_name,
      email: row.email,
      phone: row.phone,
      createdAt: new Date(row.created_at).toISOString(),
      statusChangedAt: new Date(row.status_changed_at).toISOString(),
      convertedRelationshipId: row.converted_relationship_id,
      invitation: row.invitation_id
        ? { invitationId: row.invitation_id, status: row.invitation_status as InvitationStatus, sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null, expiresAt: new Date(row.expires_at).toISOString(), deliveryFailed: row.invitation_status === "FAILED" }
        : null,
      canInvite: blocked === null,
      inviteBlockedReason: blocked,
    }
  })
}

/** Phase 1 of sending: revokes any live invitation, stores the HASH of a fresh secret and returns the secret ONCE (it is never stored). */
export async function prepareInvitation(ctx: ProspectContext, input: { organizationId: string; prospectId: string }) {
  await requireSchema(ctx, "Sending an application")
  const organizationId = uuid(input.organizationId, "organizationId")
  const company = await activeOrganization(ctx, organizationId)
  const prospect = await lockProspect(ctx, organizationId, uuid(input.prospectId, "prospectId"))
  if (prospect.status !== "PROSPECT" && prospect.status !== "INVITED") {
    throw new DriverProspectStateError(`An application cannot be sent for a prospect whose status is ${PROSPECT_STATUS_LABEL[prospect.status]}. Nothing was sent.`)
  }
  const recipient = await ctx.client.query<{ value_normalized: string; given_name: string | null; family_name: string | null }>(
    `SELECT c.value_normalized, n.given_name, n.family_name
       FROM public.person_channels c LEFT JOIN public.person_name_versions n ON n.person_id = c.person_id AND n.record_status = 'active' AND n.effective_to IS NULL
      WHERE c.person_id = $1 AND c.channel_type = 'EMAIL' AND c.record_status = 'active' AND c.effective_to IS NULL ORDER BY c.is_preferred DESC, c.created_at LIMIT 1`,
    [prospect.person_id],
  )
  if (!recipient.rows[0]) throw new DriverProspectStateError("This prospect has no email address. Add one before sending an application. Nothing was sent.")
  const revoked = await ctx.client.query<{ id: string }>(
    `UPDATE public.driver_application_invitations SET status = 'REVOKED' WHERE prospect_id = $1 AND status IN ('PENDING', 'SENT', 'OPENED') RETURNING id`,
    [prospect.id],
  )
  for (const row of revoked.rows) await event(ctx, prospect.id, organizationId, "INVITATION_REVOKED", null, null, row.id)

  const token = randomBytes(32).toString("base64url")
  const invitationId = randomUUID()
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS)
  await ctx.client.query(
    `INSERT INTO public.driver_application_invitations (id, prospect_id, organization_id, token_hash, recipient_email_normalized, expires_at, created_by_actor_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [invitationId, prospect.id, organizationId, hashInvitationToken(token), recipient.rows[0].value_normalized, expiresAt, ctx.actor.id],
  )
  await event(ctx, prospect.id, organizationId, "INVITATION_CREATED", prospect.status, prospect.status, invitationId)
  await mr(ctx, "RECORD_CREATED", "DRIVER_APPLICATION_INVITATION_CREATE", "driver_application_invitations", invitationId, organizationId, [`person:${prospect.person_id}`])
  return {
    invitationId,
    token,
    to: recipient.rows[0].value_normalized,
    applicantName: [recipient.rows[0].given_name, recipient.rows[0].family_name].filter(Boolean).join(" "),
    companyName: company.name,
    expiresAt: expiresAt.toISOString(),
  }
}

/** Phase 2: records the delivery outcome. A failure is stored as a generic code (the provider's text is never persisted) and the prospect stays a prospect. */
export async function recordInvitationOutcome(
  ctx: ProspectContext,
  input: { organizationId: string; prospectId: string; invitationId: string; outcome: { sent: true; messageId: string } | { sent: false } },
) {
  const organizationId = uuid(input.organizationId, "organizationId")
  const prospect = await lockProspect(ctx, organizationId, uuid(input.prospectId, "prospectId"))
  const invitationId = uuid(input.invitationId, "invitationId")
  if (input.outcome.sent) {
    const updated = await ctx.client.query(
      `UPDATE public.driver_application_invitations SET status = 'SENT', sent_at = clock_timestamp(), provider_message_id = $3 WHERE id = $1 AND prospect_id = $2 AND status = 'PENDING'`,
      [invitationId, prospect.id, input.outcome.messageId.slice(0, 200)],
    )
    if (updated.rowCount !== 1) return { recorded: false as const } // the applicant already opened it, or it was superseded: the outcome adds nothing
    if (prospect.status === "PROSPECT") await ctx.client.query(`UPDATE public.driver_prospects SET status = 'INVITED' WHERE id = $1`, [prospect.id])
    await event(ctx, prospect.id, organizationId, "INVITATION_SENT", prospect.status, "INVITED", invitationId)
    await mr(ctx, "RECORD_UPDATED", "DRIVER_APPLICATION_INVITATION_SEND", "driver_application_invitations", invitationId, organizationId, [`person:${prospect.person_id}`], { field: "status", value: "SENT" })
    return { recorded: true as const, status: "SENT" as const }
  }
  const failed = await ctx.client.query(
    `UPDATE public.driver_application_invitations SET status = 'FAILED', delivery_error_code = 'DELIVERY_FAILED' WHERE id = $1 AND prospect_id = $2 AND status = 'PENDING'`,
    [invitationId, prospect.id],
  )
  if (failed.rowCount !== 1) return { recorded: false as const }
  await event(ctx, prospect.id, organizationId, "INVITATION_FAILED", prospect.status, prospect.status, invitationId)
  await mr(ctx, "RECORD_UPDATED", "DRIVER_APPLICATION_INVITATION_FAILED", "driver_application_invitations", invitationId, organizationId, [`person:${prospect.person_id}`], { field: "status", value: "FAILED" })
  return { recorded: true as const, status: "FAILED" as const }
}

/** Staff review steps. The database enforces the order; APPROVED does NOT make the person a driver (see convertProspectToCompanyDriver). */
export async function reviewProspect(ctx: ProspectContext, input: { organizationId: string; prospectId: string; to: ReviewTarget }) {
  await requireSchema(ctx, "Reviewing a prospect")
  if (!REVIEW_TARGETS.includes(input.to)) throw new DriverProspectValidationError("to", "to must be UNDER_REVIEW, APPROVED, REJECTED or WITHDRAWN.")
  const organizationId = uuid(input.organizationId, "organizationId")
  const prospect = await lockProspect(ctx, organizationId, uuid(input.prospectId, "prospectId"))
  await savepoint(ctx, () => ctx.client.query(`UPDATE public.driver_prospects SET status = $2 WHERE id = $1`, [prospect.id, input.to]), () => new DriverProspectConflictError("The prospect changed. Nothing was saved."))
  await event(ctx, prospect.id, organizationId, "STATUS_CHANGED", prospect.status, input.to, null)
  await mr(ctx, "RECORD_UPDATED", "DRIVER_PROSPECT_STATUS_CHANGE", "driver_prospects", prospect.id, organizationId, [`person:${prospect.person_id}`], { field: "status", value: input.to })
  return { prospectId: prospect.id, status: input.to }
}

/**
 * The qualified step. Only an APPROVED prospect can be converted, and only with EVERYTHING a company driver needs: date of birth, relationship start
 * date, relationship type and a licence (country, jurisdiction, number, effective date). The driver is created as ONBOARDING (never directly
 * ACTIVE) through the existing assignment rules, so one driver can still hold only one open assignment across TES.
 */
export async function convertProspectToCompanyDriver(ctx: ProspectContext, decision: SystemAuthorizationDecision, input: ConvertProspectInput) {
  await requireSchema(ctx, "Converting a prospect to a company driver")
  const organizationId = uuid(input.organizationId, "organizationId")
  const required: Array<[string, unknown]> = [
    ["dateOfBirth", input.dateOfBirth], ["relationshipStartDate", input.relationshipStartDate], ["relationshipType", input.relationshipType],
    ["licence.country", input.licence?.country], ["licence.region", input.licence?.region], ["licence.number", input.licence?.number], ["licence.effectiveFrom", input.licence?.effectiveFrom],
  ]
  for (const [field, value] of required) if (typeof value !== "string" || value.trim() === "") throw new DriverProspectValidationError(field, `${field} is required to onboard a company driver.`)
  await requireAdditionalSystemCapability(ctx.client, decision, "PERSON_IDENTITY_MANAGE")
  await activeOrganization(ctx, organizationId)
  const prospect = await lockProspect(ctx, organizationId, uuid(input.prospectId, "prospectId"))
  if (prospect.status !== "APPROVED") throw new DriverProspectStateError("Only an approved prospect can be onboarded as a company driver. Nothing was changed.")
  if (prospect.converted_relationship_id) throw new DriverProspectStateError("This prospect is already a company driver. Nothing was changed.")

  const identityContext = { client: ctx.client, actor: ctx.actor, masterRegister: ctx.masterRegister }
  await enterSystemCapability(ctx.client, "PERSON_IDENTITY_MANAGE")
  await setDateOfBirth(identityContext, organizationId, prospect.person_id, input.dateOfBirth)
  await enterSystemCapability(ctx.client, "DRIVER_MANAGE")
  const hasProfile = await ctx.client.query(`SELECT 1 FROM public.driver_profiles WHERE person_id = $1`, [prospect.person_id])
  if ((hasProfile.rowCount ?? 0) === 0) await identity.createDriverProfile(identityContext, { personId: prospect.person_id })
  await identity.addDriverLicence(identityContext, {
    personId: prospect.person_id, jurisdictionCountry: input.licence.country, jurisdictionRegion: input.licence.region, licenceNumber: input.licence.number,
    licenceClass: input.licence.licenceClass, effectiveFrom: input.licence.effectiveFrom,
  })
  const established = await identity.establishOrganizationDriver(
    identityContext,
    { organizationId, personId: prospect.person_id, relationshipType: input.relationshipType, driverNumber: input.driverNumber, status: "ONBOARDING", effectiveFrom: input.relationshipStartDate },
  )
  await ctx.client.query(`UPDATE public.driver_prospects SET converted_relationship_id = $2 WHERE id = $1`, [prospect.id, established.relationshipId])
  await event(ctx, prospect.id, organizationId, "CONVERTED_TO_DRIVER", "APPROVED", "APPROVED", null)
  await mr(ctx, "RECORD_LINK_ESTABLISHED", "DRIVER_PROSPECT_CONVERT", "driver_prospects", prospect.id, organizationId, [`person:${prospect.person_id}`], { field: "driverRelationship", value: established.relationshipId })
  return { prospectId: prospect.id, relationshipId: established.relationshipId, status: "ONBOARDING" as const }
}

/** The submitted application for one prospect of THIS company (never reachable by an application id alone). */
export async function getProspectSubmission(ctx: ProspectContext, input: { organizationId: string; prospectId: string }) {
  await requireSchema(ctx, "Reading an application")
  const organizationId = uuid(input.organizationId, "organizationId")
  const r = await ctx.client.query<{ receipt_id: string; submitted_at: Date; payload: unknown }>(
    `SELECT s.receipt_id, s.submitted_at, s.payload
       FROM public.driver_application_submissions s
       JOIN public.driver_application_invitations i ON i.id = s.invitation_id
      WHERE i.prospect_id = $1 AND i.organization_id = $2 ORDER BY s.submitted_at DESC LIMIT 1`,
    [uuid(input.prospectId, "prospectId"), organizationId],
  )
  if (!r.rows[0]) throw new DriverProspectNotFoundError("No submitted application was found for this prospect.")
  return { receiptId: r.rows[0].receipt_id, submittedAt: r.rows[0].submitted_at.toISOString(), payload: r.rows[0].payload }
}
