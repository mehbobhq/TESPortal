import { deriveOnboarding, type ProspectEventRow } from "./onboarding-stages"
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
import { evaluateScope, scopeFromRow, validateScopeInput, SCOPE_RULES_VERSION, type NormalizedScope, type ScopeInput } from "./operating-scope"
import { prospectSchemaMessage, prospectSchemaState, scopeSchemaAvailable, scopeSchemaMessage } from "./schema-state"
import { planSha256, resolvePlan, type HrSelections } from "@/lib/driver-application/plan"
import { assertQualifiedForApproval } from "@/lib/driver-application/approval-gate"
import { approvedSensitiveFields, vaultReady } from "@/lib/driver-application/sensitive"
import type { Stage } from "@/lib/driver-application/catalogue/types"
import type { PresentationContext, PresentationCountry } from "@/lib/jurisdiction-context"
import { applyCompanyFacts, deriveHazmat, UNKNOWN_FACTS, type CompanyOperatingFacts, type CompanyOperatingScope } from "./company-operating-facts"
import { hasAdditionalSystemCapability } from "@/lib/auth/tes-system-context"
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

export const uuid = (value: unknown, field: string) => {
  if (typeof value !== "string" || !UUID.test(value.trim())) throw new DriverProspectValidationError(field, `${field} must be a UUID.`)
  return value.trim()
}

async function requireSchema(ctx: ProspectContext, what: string) {
  const state = await prospectSchemaState(ctx.client)
  if (state !== "COMPLETE") throw new DriverProspectStateError(prospectSchemaMessage(state, what))
}

export async function mr(ctx: ProspectContext, eventType: string, operation: string, resourceType: string, resourceId: string, organizationId: string, subjects: string[], after?: { field: string; value: string }) {
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

export async function event(ctx: ProspectContext, prospectId: string, organizationId: string, type: string, from: string | null, to: string | null, invitationId: string | null) {
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


type ScopeRow = { id: string; scope_kind: string; components: string[]; us_jurisdictions: string[]; ca_jurisdictions: string[]; characteristics: Record<string, unknown>; rules_version: string; established_at: Date }
const SCOPE_COLUMNS = `id, scope_kind, components, us_jurisdictions, ca_jurisdictions, characteristics, rules_version, established_at`

/** Validates a scope as entered, throwing a field-level error with every problem found. */
function requireValidScope(input: ScopeInput): NormalizedScope {
  const v = validateScopeInput(input)
  if (!v.ok) throw new DriverProspectValidationError("operatingScope", v.errors.join(" "))
  return v.value
}

async function insertScope(ctx: ProspectContext, prospect: { id: string; organization_id: string }, scope: NormalizedScope): Promise<string> {
  const id = randomUUID()
  await ctx.client.query(
    `INSERT INTO public.driver_prospect_operating_scopes (id, prospect_id, organization_id, scope_kind, components, us_jurisdictions, ca_jurisdictions, characteristics, rules_version, established_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
    [id, prospect.id, prospect.organization_id, scope.kind, scope.components, scope.usJurisdictions, scope.caJurisdictions, JSON.stringify(scope.characteristics), SCOPE_RULES_VERSION, ctx.actor.id],
  )
  return id
}

async function currentScopeRow(ctx: ProspectContext, prospectId: string, organizationId: string): Promise<ScopeRow | null> {
  const r = await ctx.client.query<ScopeRow>(
    `SELECT ${SCOPE_COLUMNS} FROM public.driver_prospect_operating_scopes WHERE prospect_id = $1 AND organization_id = $2 AND superseded_at IS NULL`,
    [prospectId, organizationId],
  )
  return r.rows[0] ?? null
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
  // Email and phone are both optional for SAVING a driver; an application cannot be issued until a usable contact exists (see prepareInvitation).
  const scope = input.scope ? requireValidScope(input.scope) : null
  const recordScope = scope !== null && scope.kind !== "UNDETERMINED"
  if (recordScope && !(await scopeSchemaAvailable(ctx.client))) throw new DriverProspectStateError(scopeSchemaMessage("Recording the operating scope"))
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
  if (recordScope && scope) {
    const scopeId = await insertScope(ctx, { id: prospectId, organization_id: organizationId }, scope)
    await event(ctx, prospectId, organizationId, "OPERATING_SCOPE_ESTABLISHED", null, null, null)
    await mr(ctx, "RECORD_CREATED", "DRIVER_PROSPECT_SCOPE_ESTABLISH", "driver_prospect_operating_scopes", scopeId, organizationId, [`person:${personId}`], { field: "operatingScope", value: scope.kind })
  }
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

export async function listProspects(ctx: ProspectContext, decision: SystemAuthorizationDecision, organizationIdInput: string): Promise<ProspectView[]> {
  await requireSchema(ctx, "The prospect list")
  const organizationId = uuid(organizationIdInput, "organizationId")
  const r = await ctx.client.query(
    `SELECT p.id, p.person_id, p.status, p.created_at, p.status_changed_at, p.converted_relationship_id,
            n.given_name, n.family_name,
            (SELECT c.value_display FROM public.person_channels c WHERE c.person_id = p.person_id AND c.channel_type = 'EMAIL' AND c.record_status = 'active' AND c.effective_to IS NULL ORDER BY c.is_preferred DESC, c.created_at LIMIT 1) AS email,
            (SELECT c.value_display FROM public.person_channels c WHERE c.person_id = p.person_id AND c.channel_type = 'PHONE' AND c.record_status = 'active' AND c.effective_to IS NULL ORDER BY c.is_preferred DESC, c.created_at LIMIT 1) AS phone,
            i.id AS invitation_id, i.status AS invitation_status, i.sent_at, i.expires_at, rel.status AS relationship_status
       FROM public.driver_prospects p
       LEFT JOIN public.organization_driver_relationships rel ON rel.id = p.converted_relationship_id
       LEFT JOIN public.person_name_versions n ON n.person_id = p.person_id AND n.record_status = 'active' AND n.effective_to IS NULL
       LEFT JOIN LATERAL (SELECT * FROM public.driver_application_invitations x WHERE x.prospect_id = p.id ORDER BY x.created_at DESC LIMIT 1) i ON true
      WHERE p.organization_id = $1
      ORDER BY p.created_at DESC, p.id`,
    [organizationId],
  )
  const eventRows = await ctx.client.query<{ prospect_id: string; event_type: string; to_status: string | null; occurred_at: Date }>(
    `SELECT prospect_id, event_type, to_status, occurred_at FROM public.driver_prospect_events WHERE organization_id = $1 ORDER BY occurred_at, id`,
    [organizationId],
  )
  const eventsByProspect = new Map<string, ProspectEventRow[]>()
  for (const e of eventRows.rows) {
    const list = eventsByProspect.get(e.prospect_id) ?? []
    list.push({ eventType: e.event_type, toStatus: e.to_status, occurredAt: new Date(e.occurred_at).toISOString() })
    eventsByProspect.set(e.prospect_id, list)
  }
  // The application the driver would receive follows from the intended operation AND the company's recorded facts, exactly as at issuance.
  const facts = await readProfileFacts(ctx, decision, organizationId, { country: null, basis: "UNRESOLVED", reason: null }, "DRIVER_READ")
  const scopeAvailable = await scopeSchemaAvailable(ctx.client)
  const scopeByProspect = new Map<string, ScopeRow>()
  if (scopeAvailable) {
    const scopes = await ctx.client.query<ScopeRow & { prospect_id: string }>(
      `SELECT prospect_id, ${SCOPE_COLUMNS} FROM public.driver_prospect_operating_scopes WHERE organization_id = $1 AND superseded_at IS NULL`,
      [organizationId],
    )
    for (const row of scopes.rows) scopeByProspect.set(row.prospect_id, row)
  }
  return r.rows.map((row) => {
    const scopeRow = scopeByProspect.get(row.id) ?? null
    const normalized = scopeRow ? scopeFromRow(scopeRow) : null
    const scopeEvaluation = evaluateScope(normalized ? applyCompanyFacts(normalized, facts).scope : null)
    const live = LIVE_STATUSES.slice(0, 2).includes(row.status)
    const blocked = !live
      ? "Applications can be sent only while the prospect is a prospect or has an invitation out."
      : !row.email
        ? "Add an email address to send an application."
        : !scopeAvailable
          ? scopeSchemaMessage("Sending an application").replace(" Nothing was changed.", "")
          : !scopeEvaluation.issuable
            ? scopeEvaluation.reason
            : null
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
      onboarding: deriveOnboarding({ status: row.status, relationshipStatus: row.relationship_status ?? null, events: eventsByProspect.get(row.id) ?? [] }),
      invitation: row.invitation_id
        ? { invitationId: row.invitation_id, status: row.invitation_status as InvitationStatus, sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null, expiresAt: new Date(row.expires_at).toISOString(), deliveryFailed: row.invitation_status === "FAILED" }
        : null,
      operatingScope: normalized && scopeRow ? { ...normalized, establishedAt: new Date(scopeRow.established_at).toISOString(), rulesVersion: scopeRow.rules_version } : null,
      scopeEvaluation,
      scopeAvailable,
      canInvite: blocked === null,
      inviteBlockedReason: blocked,
    }
  })
}

/** Phase 1 of sending: revokes any live invitation, stores the HASH of a fresh secret and returns the secret ONCE (it is never stored). */
export async function prepareInvitation(ctx: ProspectContext, decision: SystemAuthorizationDecision, input: { organizationId: string; prospectId: string; stage?: Stage; supplementsApplicationId?: string }) {
  await requireSchema(ctx, "Sending an application")
  const organizationId = uuid(input.organizationId, "organizationId")
  const company = await activeOrganization(ctx, organizationId)
  const prospect = await lockProspect(ctx, organizationId, uuid(input.prospectId, "prospectId"))
  const laterStage = (input.stage ?? "PRE_OFFER") !== "PRE_OFFER"
  const sendable = laterStage ? ["APPLICATION_SUBMITTED", "UNDER_REVIEW"] : ["PROSPECT", "INVITED"]
  if (!sendable.includes(prospect.status)) {
    throw new DriverProspectStateError(`An application cannot be sent for a prospect whose status is ${PROSPECT_STATUS_LABEL[prospect.status]}. Nothing was sent.`)
  }
  const recipient = await ctx.client.query<{ value_normalized: string; given_name: string | null; family_name: string | null }>(
    `SELECT c.value_normalized, n.given_name, n.family_name
       FROM public.person_channels c LEFT JOIN public.person_name_versions n ON n.person_id = c.person_id AND n.record_status = 'active' AND n.effective_to IS NULL
      WHERE c.person_id = $1 AND c.channel_type = 'EMAIL' AND c.record_status = 'active' AND c.effective_to IS NULL ORDER BY c.is_preferred DESC, c.created_at LIMIT 1`,
    [prospect.person_id],
  )
  if (!recipient.rows[0]) {
    const phone = await ctx.client.query(`SELECT 1 FROM public.person_channels WHERE person_id = $1 AND channel_type = 'PHONE' AND record_status = 'active' AND effective_to IS NULL LIMIT 1`, [prospect.person_id])
    throw new DriverProspectStateError(
      phone.rowCount
        ? "This prospect has a phone number but no email address. Applications are delivered by email only (SMS delivery is not available), so add an email address before sending. Nothing was sent."
        : "This prospect has no email address or phone number. Add contact information before sending an application. Nothing was sent.",
    )
  }
  // The application is issued only for the driver's established, supported operating scope, and freezes the requirements that follow from it.
  if (!(await scopeSchemaAvailable(ctx.client))) throw new DriverProspectStateError(scopeSchemaMessage("Sending an application").replace("Nothing was changed.", "Nothing was sent."))
  const scopeRow = await currentScopeRow(ctx, prospect.id, organizationId)
  const facts = await readCompanyOperatingFacts(ctx, decision, organizationId)
  const effective = scopeRow && scopeFromRow(scopeRow) ? applyCompanyFacts(scopeFromRow(scopeRow)!, facts) : null
  const evaluation = evaluateScope(effective ? effective.scope : null)
  if (!evaluation.issuable || !scopeRow || !effective) throw new DriverProspectStateError(`${evaluation.reason ?? "The operating scope is not established."} Nothing was sent.`)
  // The complete application plan is resolved HERE, on the server, from the scope, the carrier's HR configuration and the collection stage, and frozen with the invitation.
  const hrRow = await ctx.client.query<{ selections: HrSelections }>(`SELECT selections FROM public.organization_hr_screening_profiles WHERE organization_id = $1 AND superseded_at IS NULL`, [organizationId])
  const presentation = facts.registration
  const stage: Stage = input.stage ?? "PRE_OFFER"
  const plan = resolvePlan({
    scope: effective.scope,
    needsAttention: effective.needsAttention,
    profile: evaluation.profile,
    carrierCountry: presentation.country,
    hrSelections: hrRow.rows[0]?.selections ?? {},
    collectionStage: stage,
    gates: { vaultReady: vaultReady(), approvedSensitiveFields: approvedSensitiveFields() },
  })
  if (stage !== "PRE_OFFER") {
    const original = input.supplementsApplicationId
      ? await ctx.client.query(`SELECT 1 FROM public.driver_applications WHERE id = $1 AND organization_id = $2 AND prospect_id = $3 AND status = 'SUBMITTED'`, [input.supplementsApplicationId, organizationId, prospect.id])
      : { rowCount: 0 }
    if (!original.rowCount) throw new DriverProspectStateError("A later-stage request supplements a submitted application of this prospect. Nothing was sent.")
  }
  const frozen = { ...evaluation.profile, plan, planSha256: planSha256(plan), ...(input.supplementsApplicationId ? { supplementsApplicationId: input.supplementsApplicationId } : {}) }
  const revoked = await ctx.client.query<{ id: string }>(
    `UPDATE public.driver_application_invitations SET status = 'REVOKED' WHERE prospect_id = $1 AND status IN ('PENDING', 'SENT', 'OPENED') RETURNING id`,
    [prospect.id],
  )
  for (const row of revoked.rows) await event(ctx, prospect.id, organizationId, "INVITATION_REVOKED", null, null, row.id)

  const token = randomBytes(32).toString("base64url")
  const invitationId = randomUUID()
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS)
  await ctx.client.query(
    `INSERT INTO public.driver_application_invitations (id, prospect_id, organization_id, token_hash, recipient_email_normalized, expires_at, created_by_actor_id, operating_scope_id, requirements_profile, requirements_rules_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [invitationId, prospect.id, organizationId, hashInvitationToken(token), recipient.rows[0].value_normalized, expiresAt, ctx.actor.id, scopeRow.id, JSON.stringify(frozen), plan.rulesVersion],
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
    requirements: evaluation.profile,
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
  // A submission never qualifies anyone: approval of a prospect with a submitted application needs a recorded Qualified decision.
  if (input.to === "APPROVED") await assertQualifiedForApproval(ctx, organizationId, prospect.id)
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
    decision,
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

/**
 * Establishes (or changes) the driver's intended operating scope. It is a new immutable VERSION; the earlier one is kept. Any application still open for
 * the old scope is revoked in the same transaction (with its own event), so an outdated or mismatched application can no longer be opened.
 * Allowed only before the application is submitted: after that the submitted application belongs to the scope it was issued for.
 */
export async function establishOperatingScope(ctx: ProspectContext, input: { organizationId: string; prospectId: string; scope: ScopeInput }) {
  await requireSchema(ctx, "Setting the operating scope")
  if (!(await scopeSchemaAvailable(ctx.client))) throw new DriverProspectStateError(scopeSchemaMessage("Setting the operating scope"))
  const organizationId = uuid(input.organizationId, "organizationId")
  const scope = requireValidScope(input.scope)
  await activeOrganization(ctx, organizationId)
  const prospect = await lockProspect(ctx, organizationId, uuid(input.prospectId, "prospectId"))
  if (prospect.status !== "PROSPECT" && prospect.status !== "INVITED") {
    throw new DriverProspectStateError(`The operating scope can no longer be changed: the prospect is ${PROSPECT_STATUS_LABEL[prospect.status]}. Nothing was changed.`)
  }
  const current = await currentScopeRow(ctx, prospect.id, organizationId)
  const same = current && scopeFromRow(current) && JSON.stringify(scopeFromRow(current)) === JSON.stringify(scope)
  if (same) return { changed: false as const, scopeId: current.id, revokedInvitations: 0 }
  if (!current && scope.kind === "UNDETERMINED") return { changed: false as const, scopeId: null, revokedInvitations: 0 }

  const revoked = await ctx.client.query<{ id: string }>(
    `UPDATE public.driver_application_invitations SET status = 'REVOKED' WHERE prospect_id = $1 AND status IN ('PENDING', 'SENT', 'OPENED') RETURNING id`,
    [prospect.id],
  )
  for (const row of revoked.rows) await event(ctx, prospect.id, organizationId, "INVITATION_REVOKED", null, null, row.id)
  if (current) await ctx.client.query(`UPDATE public.driver_prospect_operating_scopes SET superseded_at = clock_timestamp() WHERE id = $1`, [current.id])
  const scopeId = await insertScope(ctx, { id: prospect.id, organization_id: organizationId }, scope)
  await event(ctx, prospect.id, organizationId, "OPERATING_SCOPE_ESTABLISHED", null, null, null)
  await mr(ctx, current ? "RECORD_UPDATED" : "RECORD_CREATED", "DRIVER_PROSPECT_SCOPE_ESTABLISH", "driver_prospect_operating_scopes", scopeId, organizationId, [`person:${prospect.person_id}`], { field: "operatingScope", value: scope.kind })
  return { changed: true as const, scopeId, revokedInvitations: revoked.rows.length }
}

const COUNTRY_ALIASES: Record<string, PresentationCountry> = { CA: "CA", CAN: "CA", CANADA: "CA", US: "US", USA: "US", "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US" }
const toCountry = (v: unknown): PresentationCountry | null => (typeof v === "string" ? COUNTRY_ALIASES[v.trim().toUpperCase()] ?? null : null)

/**
 * The company's primary PRESENTATION jurisdiction: what staff see first. Order of authority: an explicitly established value; else the company's
 * recorded country of formation when it is a single U.S./Canadian value and no active registration identifier (readable only with registry access)
 * points to the other country; otherwise UNRESOLVED, and an explicit selection is required. It is presentation only and never decides applicability.
 */
export async function getPresentationContext(ctx: ProspectContext, decision: SystemAuthorizationDecision, organizationIdInput: string): Promise<PresentationContext> {
  const organizationId = uuid(organizationIdInput, "organizationId")
  const org = await ctx.client.query<{ country_code: string | null }>(`SELECT country_code FROM public.organizations WHERE id = $1`, [organizationId])
  if (!org.rows[0]) throw new DriverProspectNotFoundError("Company not found.")
  if (await scopeSchemaAvailable(ctx.client)) {
    const explicit = await ctx.client.query<{ country_code: string }>(`SELECT country_code FROM public.organization_presentation_jurisdictions WHERE organization_id = $1 AND superseded_at IS NULL`, [organizationId])
    const c = toCountry(explicit.rows[0]?.country_code)
    if (c) return { country: c, basis: "EXPLICIT", reason: null }
  }
  const formation = toCountry(org.rows[0].country_code)
  if (!formation) return { country: null, basis: "UNRESOLVED", reason: "The company's registered country is not recorded as the United States or Canada." }
  if (await hasAdditionalSystemCapability(ctx.client, decision, "ORGANIZATION_REGISTRY_READ")) {
    await enterSystemCapability(ctx.client, "ORGANIZATION_REGISTRY_READ")
    const ids = await ctx.client.query<{ jurisdiction_country: string | null }>(`SELECT DISTINCT jurisdiction_country FROM public.organization_identifiers WHERE organization_id = $1 AND status = 'active'`, [organizationId])
    await enterSystemCapability(ctx.client, "DRIVER_MANAGE")
    if (ids.rows.some((r) => { const o = toCountry(r.jurisdiction_country); return o !== null && o !== formation })) {
      return { country: null, basis: "UNRESOLVED", reason: "The company is registered in both the United States and Canada." }
    }
  }
  return { country: formation, basis: "REGISTRATION", reason: null }
}

/** Establishes the company's primary presentation jurisdiction. A company-profile act: it needs COMPANY_PROFILE_MANAGE in addition to driver authority. */
export async function establishPresentationJurisdiction(ctx: ProspectContext, decision: SystemAuthorizationDecision, input: { organizationId: string; country: unknown }) {
  if (!(await scopeSchemaAvailable(ctx.client))) throw new DriverProspectStateError(scopeSchemaMessage("Setting the company's primary jurisdiction"))
  const organizationId = uuid(input.organizationId, "organizationId")
  const country = toCountry(input.country)
  if (!country) throw new DriverProspectValidationError("country", "Choose United States or Canada.")
  await requireAdditionalSystemCapability(ctx.client, decision, "COMPANY_PROFILE_MANAGE")
  await activeOrganization(ctx, organizationId)
  await enterSystemCapability(ctx.client, "COMPANY_PROFILE_MANAGE")
  const previous = await ctx.client.query<{ id: string; country_code: string }>(`SELECT id, country_code FROM public.organization_presentation_jurisdictions WHERE organization_id = $1 AND superseded_at IS NULL FOR UPDATE`, [organizationId])
  if (previous.rows[0]?.country_code === country) {
    await enterSystemCapability(ctx.client, "DRIVER_MANAGE")
    return { country, changed: false as const }
  }
  if (previous.rows[0]) await ctx.client.query(`UPDATE public.organization_presentation_jurisdictions SET superseded_at = clock_timestamp() WHERE id = $1`, [previous.rows[0].id])
  const id = randomUUID()
  await ctx.client.query(`INSERT INTO public.organization_presentation_jurisdictions (id, organization_id, country_code, established_by_actor_id) VALUES ($1, $2, $3, $4)`, [id, organizationId, country, ctx.actor.id])
  await enterSystemCapability(ctx.client, "DRIVER_MANAGE")
  await mr(ctx, previous.rows[0] ? "RECORD_UPDATED" : "RECORD_CREATED", "ORGANIZATION_PRESENTATION_JURISDICTION_ESTABLISH", "organization_presentation_jurisdictions", id, organizationId, [], { field: "presentationJurisdiction", value: country })
  return { country, changed: true as const }
}

/**
 * The company's recorded operating facts, read from the canonical Profile tables through the existing row-level-security boundary (nothing is copied
 * or stored for onboarding). Missing or unreadable data is UNKNOWN, never "No". COMPANY_PROFILE_READ is an additional capability; without it the
 * profile facts are reported unreadable rather than guessed.
 */
export async function readCompanyOperatingFacts(ctx: ProspectContext, decision: SystemAuthorizationDecision, organizationIdInput: string): Promise<CompanyOperatingFacts> {
  const organizationId = uuid(organizationIdInput, "organizationId")
  const registration = await getPresentationContext(ctx, decision, organizationId)
  return readProfileFacts(ctx, decision, organizationId, registration, "DRIVER_MANAGE")
}

/** The Profile part of the facts. `restore` is the capability the surrounding transaction was opened with; it is re-entered afterwards. */
async function readProfileFacts(ctx: ProspectContext, decision: SystemAuthorizationDecision, organizationId: string, registration: PresentationContext, restore: "DRIVER_MANAGE" | "DRIVER_READ"): Promise<CompanyOperatingFacts> {
  if (!(await hasAdditionalSystemCapability(ctx.client, decision, "COMPANY_PROFILE_READ"))) return UNKNOWN_FACTS(registration)
  await enterSystemCapability(ctx.client, "COMPANY_PROFILE_READ")
  try {
    const scope = await ctx.client.query<{ operating_scope: CompanyOperatingScope }>(
      `SELECT operating_scope FROM public.company_operating_scope_periods WHERE organization_id = $1 AND record_status = 'active' AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1`, [organizationId])
    const cargo = await ctx.client.query<{ cargo_category_code: string }>(
      `SELECT cargo_category_code FROM public.company_cargo_category_periods WHERE organization_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [organizationId])
    const rules = await ctx.client.query<{ rule_code: string; applicability: "APPLIES" | "DOES_NOT_APPLY" }>(
      `SELECT rule_code, applicability FROM public.company_rule_applicability_periods WHERE organization_id = $1 AND record_status = 'active' AND effective_to IS NULL AND rule_code = ANY($2::text[])`, [organizationId, ["DG_US", "DG_CANADA", "PSP"]])
    const psp = rules.rows.find((r) => r.rule_code === "PSP")
    return {
      registration,
      operatingScope: scope.rows[0]?.operating_scope ?? null,
      hazmat: deriveHazmat({
        readable: true,
        cargoCodes: cargo.rows.map((r) => r.cargo_category_code),
        dgRules: rules.rows.filter((r) => r.rule_code !== "PSP").map((r) => ({ rule: r.rule_code, applicability: r.applicability })),
      }),
      psp: { value: psp ? (psp.applicability === "APPLIES" ? "YES" : "NO") : "UNKNOWN" },
      passengerCarrying: { value: "UNKNOWN", basis: "NO_CANONICAL_SOURCE" },
      profileReadable: true,
    }
  } finally {
    await enterSystemCapability(ctx.client, restore)
  }
}
