/**
 * Driver operations over the approved operational-identity schema (migrations 0014, 0021, 0022, 0023, 0024).
 *
 * Every function runs INSIDE the transaction the DRIVER_MANAGE authorization wrapper opened; Master Register events are written
 * through a repository bound to the same client, so a failure anywhere (including the Master Register) rolls the whole change
 * back. Nothing here issues DELETE (the runtime role has none and the tables forbid it).
 *
 * What the approved architecture defines, and therefore what is implemented here (nothing else is invented):
 *   - A driver is a ROLE of a Person (docs/core-operational-identity-boundaries.md). The cut-over plan maps the legacy driver
 *     master to "create/resolve person, create driver profile, import licences" (docs/canonical-data-cutover-browser-authority-
 *     retirement.md). Migration 0024 lets DRIVER_MANAGE (and only it, with CONTACT_MANAGE) write persons, person_name_versions and
 *     person_channels, so creating the Person of a driver is a DRIVER_MANAGE act. createDriver() does exactly that, atomically.
 *   - Licence identity is country + jurisdiction + normalized number (migration 0021/0022): an existing current licence means
 *     the same Person, never a silent duplicate (findDriverByLicence). Names, email and phone are advisory only and are NEVER
 *     used to merge people.
 *   - Real-world change vs correction vs void (the convention of migrations 0012/0013/0014/0017, enforced for drivers by the
 *     guard triggers of 0021): change ends the open row at T and starts the next at T; correct keeps the wrong row flagged
 *     'corrected' pointing at its replacement (which inherits the business start); void keeps a row entered in error.
 *   - Medical qualification periods (0021, no operation until now): add / change (renewal) / correct / void.
 *
 * Company isolation: every operation names the Organization (taken from the URL by the route, never from a body) and a driver
 * is reachable only through a relationship row with THAT Organization; anything else is reported as "not found". A Person is
 * global (one human, several Organizations), so name and licence facts are shared by every Organization the driver works with.
 *
 * Master Register events carry references and controlled-vocabulary literals only: never a name, licence number, email or
 * phone number (the Master Register must not become a second copy of identity data).
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { prepareChannel, prepareName } from "@/lib/contacts/definitions"
import * as contacts from "@/lib/contacts/repository"
import { recordEvent } from "@/lib/master-register/record-event"
import type { FieldChange } from "@/lib/master-register/types"
import { ContactValidationError } from "@/lib/contacts/errors"
import { DriverConflictError, DriverNotFoundError, DriverStateError, DriverValidationError } from "./driver-errors"
import { normalizeDriverLicenceNumber, normalizeUnitNumber } from "./normalization"
import type { IdentityContext } from "./operations"

export const RELATIONSHIP_TYPES = ["EMPLOYEE", "CONTRACTOR", "OWNER_OPERATOR"] as const
export type DriverRelationshipType = (typeof RELATIONSHIP_TYPES)[number]
export const OPEN_STATUSES = ["ONBOARDING", "ACTIVE", "SUSPENDED"] as const
export type DriverOpenStatus = (typeof OPEN_STATUSES)[number]
export const QUALIFICATION_TYPE = /^[A-Z][A-Z0-9_]{1,63}$/

// --- input parsing -----------------------------------------------------------------------------------------------

type Raw = Record<string, unknown>
function object(value: unknown, field: string, allowed: readonly string[]): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DriverValidationError(field, `${field} must be an object.`)
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new DriverValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
  return value as Raw
}
function uuid(value: unknown, field: string): string {
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())) return value.trim().toLowerCase()
  throw new DriverValidationError(field, `${field} must be a UUID.`)
}
function day(value: unknown, field: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const text = value.trim()
    const date = new Date(`${text}T00:00:00Z`)
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text) return text
  }
  throw new DriverValidationError(field, `${field} must be a calendar date (YYYY-MM-DD).`)
}
/** The contacts vocabulary rejects with ContactValidationError; a driver operation reports its own error type. */
function viaContacts<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (error instanceof ContactValidationError) throw new DriverValidationError(error.field, error.message)
    throw error
  }
}
const optionalDay = (value: unknown, field: string): string | null => (value === undefined || value === null || value === "" ? null : day(value, field))
function text(value: unknown, field: string, max = 100): string {
  if (typeof value !== "string" || value.trim() === "") throw new DriverValidationError(field, `${field} is required.`)
  const t = value.trim()
  if (t.length > max) throw new DriverValidationError(field, `${field} must not exceed ${max} characters.`)
  return t
}
const optionalText = (value: unknown, field: string, max = 100): string | null => (value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? null : text(value, field, max))
function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T
  throw new DriverValidationError(field, `${field} must be one of ${allowed.join(", ")}.`)
}
function driverNumber(value: unknown): { display: string | null; normalized: string | null } {
  const display = optionalText(value, "driverNumber", 40)
  return { display, normalized: display ? normalizeUnitNumber(display) : null }
}

// --- constraints → domain errors ---------------------------------------------------------------------------------

const CONSTRAINT_MESSAGES: Record<string, () => Error> = {
  organization_driver_current_uq: () => new DriverConflictError("This person already has an open driver relationship with the Organization, or a concurrent change was made."),
  organization_driver_current_number_uq: () => new DriverConflictError("Another current driver of this Organization already has that driver number."),
  organization_driver_relationships_no_overlap: () => new DriverValidationError("effectiveFrom", "The relationship dates overlap an existing record of this driver with the Organization."),
  driver_licences_current_identity_uq: () => new DriverConflictError("This licence already identifies a driver."),
  driver_licences_identity_no_overlap: () => new DriverConflictError("This licence already identifies a driver for an overlapping period."),
  driver_licences_person_current_jurisdiction_uq: () => new DriverConflictError("The driver already has a current licence in this jurisdiction; record a replacement (change) or correct it."),
  driver_medical_current_uq: () => new DriverConflictError("The driver already has a current period of this qualification; record a renewal (change) or correct it."),
  driver_medical_qualification_periods_no_overlap: () => new DriverValidationError("effectiveFrom", "The qualification dates overlap an existing period of the same kind."),
  person_name_versions_current_uq: () => new DriverConflictError("A concurrent change was made; retry the operation."),
  person_channels_current_value_uq: () => new DriverConflictError("This email or phone is already recorded as current for the person."),
  person_channels_current_preferred_uq: () => new DriverConflictError("Another channel of this kind is already preferred."),
  person_name_versions_effective_window_valid: () => new DriverValidationError("effectiveFrom", "The effective date must be after the current record began."),
  person_channels_effective_window_valid: () => new DriverValidationError("effectiveFrom", "The effective date must be after the current record began."),
  organization_driver_relationships_effective_to_check: () => new DriverValidationError("effectiveTo", "The end date must be after the relationship started."),
  driver_licences_check: () => new DriverValidationError("expiryDate", "The licence dates are inconsistent (expiry cannot precede issue; an end must follow the start)."),
}
const GENERIC_CHECKS = /^(organization_driver_relationships|driver_licences|driver_medical_qualification_periods)_check\d*$/

/** Translates the documented database backstops into domain errors; anything else propagates unchanged. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    const constraint = typeof error === "object" && error !== null ? (error as { constraint?: string }).constraint : undefined
    const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined
    if (constraint && CONSTRAINT_MESSAGES[constraint]) throw CONSTRAINT_MESSAGES[constraint]()
    if (constraint && GENERIC_CHECKS.test(constraint)) throw new DriverValidationError("dates", "The record's dates are inconsistent (an end must follow the start; expiry cannot precede issue).")
    if (constraint === "persons_require_current_name") throw new DriverStateError("A person must have exactly one current name.")
    if (code === "23514" && error instanceof Error && /must be active/.test(error.message)) throw new DriverStateError(error.message)
    throw error
  }
}

// --- Master Register ---------------------------------------------------------------------------------------------

type EventName = "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_CORRECTED" | "RECORD_LINK_ESTABLISHED"
const literal = (value: string | number | boolean | null) => ({ kind: "LITERAL" as const, value })
const reference = (table: string, id: string) => ({ kind: "REFERENCE" as const, reference: `${table}:${id}` })

async function record(ctx: IdentityContext, eventType: EventName, operation: string, target: { resourceType: string; resourceId: string; organizationId: string; personId: string }, fieldChanges: FieldChange[]) {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: { resourceType: target.resourceType, resourceId: target.resourceId, subjectReferences: [`organization:${target.organizationId}`, `person:${target.personId}`] },
    source: { sourceType: "APPLICATION", component: "operational-identity", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: { result: "SUCCESS" },
  })
}

// --- shared building blocks --------------------------------------------------------------------------------------

type RelationshipRow = {
  id: string
  organization_id: string
  person_id: string
  relationship_type: DriverRelationshipType
  driver_number_display: string | null
  status: "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "ENDED"
  effective_from: string
  effective_to: string | null
  record_status: "active" | "corrected" | "voided"
}
const REL_COLUMNS = `id, organization_id, person_id, relationship_type, driver_number_display, status, to_char(effective_from,'YYYY-MM-DD') AS effective_from, to_char(effective_to,'YYYY-MM-DD') AS effective_to, record_status`

async function lockActiveOrganization(ctx: IdentityContext, organizationId: string): Promise<void> {
  const organization = await contacts.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new DriverNotFoundError("Organization")
  if (organization.status !== "active") throw new DriverStateError("This Organization is not active; its drivers can no longer be changed.")
}

/**
 * Locks the driver through its relationship with the Organization (lock order: Organization, person, relationship, dependents).
 * A person with no genuine relationship row with THIS Organization looks exactly like one that does not exist.
 */
async function lockManagedDriver(ctx: IdentityContext, organizationId: string, personId: string, options: { requireOpen?: boolean } = {}): Promise<{ relationship: RelationshipRow | null }> {
  const person = await contacts.lockPerson(ctx.client, personId)
  const related = await ctx.client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.organization_driver_relationships WHERE organization_id=$1 AND person_id=$2 AND record_status IN ('active','corrected')`,
    [organizationId, personId],
  )
  if (!person || Number(related.rows[0].n) === 0) throw new DriverNotFoundError("Driver")
  if (person.recordStatus !== "active") throw new DriverStateError("This person is archived.")
  const open = await ctx.client.query<RelationshipRow>(
    `SELECT ${REL_COLUMNS} FROM public.organization_driver_relationships WHERE organization_id=$1 AND person_id=$2 AND record_status='active' AND effective_to IS NULL FOR UPDATE`,
    [organizationId, personId],
  )
  const relationship = open.rows[0] ?? null
  if (options.requireOpen && !relationship) throw new DriverStateError("The driver has no current relationship with this Organization (it has ended); this change cannot be made.")
  return { relationship }
}

const today = async (client: PoolClient): Promise<string> => (await client.query<{ d: string }>(`SELECT to_char(current_date,'YYYY-MM-DD') AS d`)).rows[0].d

async function insertRelationship(client: PoolClient, row: { id: string; organizationId: string; personId: string; type: string; numberDisplay: string | null; numberNormalized: string | null; status: string; effectiveFrom: string }) {
  await guarded(() =>
    client.query(
      `INSERT INTO public.organization_driver_relationships (id, organization_id, person_id, relationship_type, driver_number_display, driver_number_normalized, status, effective_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date)`,
      [row.id, row.organizationId, row.personId, row.type, row.numberDisplay, row.numberNormalized, row.status, row.effectiveFrom],
    ),
  )
}

type LicenceInput = { country: string; region: string; number: string; licenceClass: string | null; issueDate: string | null; expiryDate: string | null; effectiveFrom: string }
function parseLicence(value: unknown, field: string, defaultFrom: string): LicenceInput {
  const raw = object(value, field, ["jurisdictionCountry", "jurisdictionRegion", "licenceNumber", "licenceClass", "issueDate", "expiryDate", "effectiveFrom"])
  const number = text(raw.licenceNumber, `${field}.licenceNumber`, 40)
  if (!normalizeDriverLicenceNumber(number)) throw new DriverValidationError(`${field}.licenceNumber`, "licenceNumber must contain letters or digits.")
  const issueDate = optionalDay(raw.issueDate, `${field}.issueDate`)
  const expiryDate = optionalDay(raw.expiryDate, `${field}.expiryDate`)
  if (issueDate && expiryDate && expiryDate < issueDate) throw new DriverValidationError(`${field}.expiryDate`, "The licence expiry cannot precede its issue date.")
  return {
    country: text(raw.jurisdictionCountry, `${field}.jurisdictionCountry`, 60),
    region: text(raw.jurisdictionRegion, `${field}.jurisdictionRegion`, 60),
    number,
    licenceClass: optionalText(raw.licenceClass, `${field}.licenceClass`, 20),
    issueDate,
    expiryDate,
    effectiveFrom: raw.effectiveFrom === undefined ? defaultFrom : day(raw.effectiveFrom, `${field}.effectiveFrom`),
  }
}

async function insertLicence(client: PoolClient, id: string, personId: string, l: LicenceInput) {
  await guarded(() =>
    client.query(
      `INSERT INTO public.driver_licences (id, person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_number_normalized, licence_class, issue_date, expiry_date, effective_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10::date)`,
      [id, personId, l.country, l.region, l.number, normalizeDriverLicenceNumber(l.number), l.licenceClass, l.issueDate, l.expiryDate, l.effectiveFrom],
    ),
  )
}

// ======================================================================================================================
// Existing-driver check (canonical identity signal: licence only)
// ======================================================================================================================

export type ExistingDriverMatch =
  | { found: false }
  | { found: true; personId: string; givenName: string | null; familyName: string | null; activeAtThisOrganization: boolean; otherOrganizationCount: number }

/** Read: does the licence (country + jurisdiction + normalized number) already identify a driver? Email/phone/name are NOT identity signals. */
export async function checkExistingDriver(client: PoolClient, organizationId: string, rawInput: unknown): Promise<ExistingDriverMatch> {
  const input = object(rawInput, "input", ["jurisdictionCountry", "jurisdictionRegion", "licenceNumber"])
  const number = normalizeDriverLicenceNumber(text(input.licenceNumber, "licenceNumber", 40))
  if (!number) throw new DriverValidationError("licenceNumber", "licenceNumber must contain letters or digits.")
  const found = await client.query<{ person_id: string }>(
    `SELECT person_id FROM public.driver_licences WHERE jurisdiction_country=$1 AND jurisdiction_region=$2 AND licence_number_normalized=$3 AND record_status='active' AND effective_to IS NULL LIMIT 1`,
    [text(input.jurisdictionCountry, "jurisdictionCountry", 60), text(input.jurisdictionRegion, "jurisdictionRegion", 60), number],
  )
  if (!found.rows[0]) return { found: false }
  const personId = found.rows[0].person_id
  const name = await client.query<{ given_name: string | null; family_name: string | null }>(
    `SELECT given_name, family_name FROM public.person_name_versions WHERE person_id=$1 AND record_status='active' AND effective_to IS NULL LIMIT 1`,
    [personId],
  )
  const relationships = await client.query<{ organization_id: string }>(
    `SELECT organization_id FROM public.organization_driver_relationships WHERE person_id=$1 AND record_status='active' AND effective_to IS NULL`,
    [personId],
  )
  return {
    found: true,
    personId,
    givenName: name.rows[0]?.given_name ?? null,
    familyName: name.rows[0]?.family_name ?? null,
    activeAtThisOrganization: relationships.rows.some((row) => row.organization_id === organizationId),
    otherOrganizationCount: relationships.rows.filter((row) => row.organization_id !== organizationId).length,
  }
}

// ======================================================================================================================
// Create a driver (Person + name + driver profile + channels + licence + Organization relationship), atomically
// ======================================================================================================================

export type CreateDriverResult = { kind: "CREATED"; personId: string; relationshipId: string; licenceId: string | null }

export async function createDriver(ctx: IdentityContext, rawInput: unknown): Promise<CreateDriverResult> {
  const input = object(rawInput, "input", ["organizationId", "givenName", "familyName", "email", "phone", "relationshipType", "status", "driverNumber", "effectiveFrom", "licence"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const name = viaContacts(() => prepareName(optionalText(input.givenName, "givenName") ?? undefined, optionalText(input.familyName, "familyName") ?? undefined))
  if (!name.givenName || !name.familyName) throw new DriverValidationError("name", "A driver needs a given name and a family name.")
  const email = optionalText(input.email, "email", 254)
  const phone = optionalText(input.phone, "phone", 60)
  const emailChannel = email ? viaContacts(() => prepareChannel("EMAIL", email, undefined, "email")) : null
  const phoneChannel = phone ? viaContacts(() => prepareChannel("PHONE", phone, undefined, "phone")) : null
  const type = oneOf(input.relationshipType, RELATIONSHIP_TYPES, "relationshipType")
  const status = oneOf(input.status, OPEN_STATUSES, "status")
  const number = driverNumber(input.driverNumber)
  const effectiveFrom = day(input.effectiveFrom, "effectiveFrom")
  const licence = input.licence === undefined || input.licence === null ? null : parseLicence(input.licence, "licence", effectiveFrom)

  await lockActiveOrganization(ctx, organizationId)
  if (licence) {
    const existing = await ctx.client.query<{ person_id: string }>(
      `SELECT person_id FROM public.driver_licences WHERE jurisdiction_country=$1 AND jurisdiction_region=$2 AND licence_number_normalized=$3 AND record_status='active' AND effective_to IS NULL LIMIT 1`,
      [licence.country, licence.region, normalizeDriverLicenceNumber(licence.number)],
    )
    if (existing.rows[0]) throw new DriverConflictError("This licence already identifies a driver. Add the existing driver to the Organization instead of creating a second person.", existing.rows[0].person_id)
  }

  const personId = randomUUID()
  const at = await contacts.databaseNow(ctx.client)
  await guarded(async () => {
    await contacts.insertPerson(ctx.client, personId)
    await contacts.insertName(ctx.client, { id: randomUUID(), personId, givenName: name.givenName, familyName: name.familyName, normalized: name.normalized, reason: "INITIAL", effectiveFrom: at })
    await ctx.client.query(`INSERT INTO public.driver_profiles (person_id) VALUES ($1)`, [personId])
    for (const [prepared, channelType] of [[emailChannel, "EMAIL"], [phoneChannel, "PHONE"]] as const) {
      if (prepared) await contacts.insertPersonChannel(ctx.client, { id: randomUUID(), personId, channelType, display: prepared.display, normalized: prepared.normalized, ruleVersion: prepared.ruleVersion, extension: prepared.extension, preferred: true, reason: "INITIAL", effectiveFrom: at })
    }
  })
  const subjects = { organizationId, personId }
  await record(ctx, "RECORD_CREATED", "DRIVER_CREATE", { resourceType: "driver_profiles", resourceId: personId, ...subjects }, [{ field: "record", after: reference("driver_profiles", personId) }])

  let licenceId: string | null = null
  if (licence) {
    licenceId = randomUUID()
    await insertLicence(ctx.client, licenceId, personId, licence)
    await record(ctx, "RECORD_CREATED", "DRIVER_LICENCE_CREATE", { resourceType: "driver_licences", resourceId: licenceId, ...subjects }, [{ field: "record", after: reference("driver_licences", licenceId) }])
  }
  const relationshipId = randomUUID()
  await insertRelationship(ctx.client, { id: relationshipId, organizationId, personId, type, numberDisplay: number.display, numberNormalized: number.normalized, status, effectiveFrom })
  await record(ctx, "RECORD_LINK_ESTABLISHED", "ORGANIZATION_DRIVER_ESTABLISH", { resourceType: "organization_driver_relationships", resourceId: relationshipId, ...subjects }, [
    { field: "relationshipType", after: literal(type) },
    { field: "status", after: literal(status) },
    { field: "record", after: reference("organization_driver_relationships", relationshipId) },
  ])
  return { kind: "CREATED", personId, relationshipId, licenceId }
}

/** The existing-driver "same person" resolution: relate an EXISTING driver profile to this Organization (a new relationship; the person is untouched). */
export async function addExistingDriver(ctx: IdentityContext, rawInput: unknown): Promise<{ relationshipId: string }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "relationshipType", "status", "driverNumber", "effectiveFrom"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  const type = oneOf(input.relationshipType, RELATIONSHIP_TYPES, "relationshipType")
  const status = oneOf(input.status, OPEN_STATUSES, "status")
  const number = driverNumber(input.driverNumber)
  const effectiveFrom = day(input.effectiveFrom, "effectiveFrom")

  await lockActiveOrganization(ctx, organizationId)
  const person = await contacts.lockPerson(ctx.client, personId)
  const profile = await ctx.client.query<{ record_status: string }>(`SELECT record_status FROM public.driver_profiles WHERE person_id=$1 FOR UPDATE`, [personId])
  if (!person || !profile.rows[0]) throw new DriverNotFoundError("Driver")
  if (person.recordStatus !== "active" || profile.rows[0].record_status !== "active") throw new DriverStateError("This driver is archived.")
  const open = await ctx.client.query(`SELECT 1 FROM public.organization_driver_relationships WHERE organization_id=$1 AND person_id=$2 AND record_status='active' AND effective_to IS NULL`, [organizationId, personId])
  if ((open.rowCount ?? 0) > 0) throw new DriverConflictError("This driver is already a current driver of this Organization.", personId)

  const relationshipId = randomUUID()
  await insertRelationship(ctx.client, { id: relationshipId, organizationId, personId, type, numberDisplay: number.display, numberNormalized: number.normalized, status, effectiveFrom })
  await record(ctx, "RECORD_LINK_ESTABLISHED", "ORGANIZATION_DRIVER_ESTABLISH", { resourceType: "organization_driver_relationships", resourceId: relationshipId, organizationId, personId }, [
    { field: "relationshipType", after: literal(type) },
    { field: "status", after: literal(status) },
    { field: "record", after: reference("organization_driver_relationships", relationshipId) },
  ])
  return { relationshipId }
}

// ======================================================================================================================
// Name (person_name_versions): change = real-world change; correct = a recorded name was wrong
// ======================================================================================================================

async function nameMutation(ctx: IdentityContext, rawInput: unknown, mode: "change" | "correct") {
  const input = object(rawInput, "input", mode === "change" ? ["organizationId", "personId", "givenName", "familyName", "effectiveFrom"] : ["organizationId", "personId", "givenName", "familyName"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  if (input.givenName === undefined && input.familyName === undefined) throw new DriverValidationError("input", "Nothing to change.")
  const explicit = mode === "change" ? optionalDay(input.effectiveFrom, "effectiveFrom") : null

  await lockActiveOrganization(ctx, organizationId)
  await lockManagedDriver(ctx, organizationId, personId)
  const current = await contacts.getCurrentName(ctx.client, personId, true)
  if (!current) throw new DriverNotFoundError("Name")
  const prepared = viaContacts(() =>
    prepareName(
      input.givenName !== undefined ? optionalText(input.givenName, "givenName") ?? undefined : current.givenName ?? undefined,
      input.familyName !== undefined ? optionalText(input.familyName, "familyName") ?? undefined : current.familyName ?? undefined,
    ),
  )
  if (!prepared.givenName || !prepared.familyName) throw new DriverValidationError("name", "A driver needs a given name and a family name.")
  if (prepared.givenName === current.givenName && prepared.familyName === current.familyName) throw new DriverValidationError("input", "The name is unchanged.")

  const replacementId = randomUUID()
  if (mode === "change") {
    const at = explicit ? `${explicit}T00:00:00Z` : await contacts.databaseNow(ctx.client)
    if (!(await contacts.isNotInFuture(ctx.client, at))) throw new DriverValidationError("effectiveFrom", "effectiveFrom cannot be in the future.")
    await guarded(async () => {
      await contacts.endPeriod(ctx.client, "person_name_versions", current.id, at)
      await contacts.insertName(ctx.client, { id: replacementId, personId, givenName: prepared.givenName, familyName: prepared.familyName, normalized: prepared.normalized, reason: "CHANGE", effectiveFrom: at })
    })
    await record(ctx, "RECORD_UPDATED", "DRIVER_NAME_CHANGE", { resourceType: "person_name_versions", resourceId: replacementId, organizationId, personId }, [
      { field: "name", before: reference("person_name_versions", current.id), after: reference("person_name_versions", replacementId) },
    ])
  } else {
    await guarded(async () => {
      await contacts.markPeriod(ctx.client, "person_name_versions", current.id, "corrected", replacementId)
      await contacts.insertName(ctx.client, { id: replacementId, personId, givenName: prepared.givenName, familyName: prepared.familyName, normalized: prepared.normalized, reason: "CORRECTION", effectiveFrom: current.effectiveFrom })
    })
    await record(ctx, "RECORD_CORRECTED", "DRIVER_NAME_CORRECT", { resourceType: "person_name_versions", resourceId: replacementId, organizationId, personId }, [
      { field: "name", before: reference("person_name_versions", current.id), after: reference("person_name_versions", replacementId) },
    ])
  }
  return { nameVersionId: replacementId }
}
export const changeDriverName = (ctx: IdentityContext, input: unknown) => nameMutation(ctx, input, "change")
export const correctDriverName = (ctx: IdentityContext, input: unknown) => nameMutation(ctx, input, "correct")

// ======================================================================================================================
// Email / phone (person_channels)
// ======================================================================================================================

/** Sets the driver's current email or phone: a first value is added; a different value is a real-world change (or, with mode "correct", a correction). */
export async function setDriverChannel(ctx: IdentityContext, rawInput: unknown): Promise<{ channelId: string | null }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "channelType", "value", "mode"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  const channelType = oneOf(input.channelType, ["EMAIL", "PHONE"] as const, "channelType")
  const mode = input.mode === undefined ? "change" : oneOf(input.mode, ["change", "correct"] as const, "mode")
  const prepared = viaContacts(() => prepareChannel(channelType, input.value, undefined, "value"))

  await lockActiveOrganization(ctx, organizationId)
  await lockManagedDriver(ctx, organizationId, personId)
  const open = await ctx.client.query<{ id: string; value_normalized: string; value_display: string; extension: string | null; effective_from: string }>(
    `SELECT id, value_normalized, value_display, extension, to_char(effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from
       FROM public.person_channels WHERE person_id=$1 AND channel_type=$2 AND record_status='active' AND effective_to IS NULL AND is_preferred FOR UPDATE`,
    [personId, channelType],
  )
  const current = open.rows[0]
  if (current && current.value_normalized === prepared.normalized && (current.extension ?? null) === prepared.extension) throw new DriverValidationError("value", "The value is unchanged.")
  const id = randomUUID()
  const at = await contacts.databaseNow(ctx.client)
  await guarded(async () => {
    if (!current) {
      await contacts.insertPersonChannel(ctx.client, { id, personId, channelType, display: prepared.display, normalized: prepared.normalized, ruleVersion: prepared.ruleVersion, extension: prepared.extension, preferred: true, reason: "INITIAL", effectiveFrom: at })
    } else if (mode === "change") {
      await ctx.client.query(`UPDATE public.person_channels SET effective_to=$2::timestamptz, updated_at=clock_timestamp() WHERE id=$1`, [current.id, at])
      await contacts.insertPersonChannel(ctx.client, { id, personId, channelType, display: prepared.display, normalized: prepared.normalized, ruleVersion: prepared.ruleVersion, extension: prepared.extension, preferred: true, reason: "CHANGE", effectiveFrom: at })
    } else {
      await contacts.markPeriod(ctx.client, "person_channels", current.id, "corrected", id)
      await contacts.insertPersonChannel(ctx.client, { id, personId, channelType, display: prepared.display, normalized: prepared.normalized, ruleVersion: prepared.ruleVersion, extension: prepared.extension, preferred: true, reason: "CORRECTION", effectiveFrom: current.effective_from })
    }
  })
  await record(ctx, !current ? "RECORD_CREATED" : mode === "change" ? "RECORD_UPDATED" : "RECORD_CORRECTED", `DRIVER_${channelType}_${!current ? "ADD" : mode.toUpperCase()}`, { resourceType: "person_channels", resourceId: id, organizationId, personId }, [
    { field: "channelType", after: literal(channelType) },
    { field: "channel", before: current ? reference("person_channels", current.id) : undefined, after: reference("person_channels", id) },
  ])
  return { channelId: id }
}

// ======================================================================================================================
// Organization relationship: change / correct / end
// ======================================================================================================================

/**
 * REAL-WORLD change of the driver's relationship with the Organization (type, status, driver number): the open row is ended at T
 * and the next row starts at T. T must be after the open row's start; the same day is a CORRECTION (see correctDriverRelationship).
 */
export async function changeDriverRelationship(ctx: IdentityContext, rawInput: unknown): Promise<{ relationshipId: string }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "relationshipType", "status", "driverNumber", "effectiveFrom"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  await lockActiveOrganization(ctx, organizationId)
  const { relationship } = await lockManagedDriver(ctx, organizationId, personId, { requireOpen: true })
  const current = relationship as RelationshipRow
  const type = input.relationshipType === undefined ? current.relationship_type : oneOf(input.relationshipType, RELATIONSHIP_TYPES, "relationshipType")
  const status = input.status === undefined ? (current.status as DriverOpenStatus) : oneOf(input.status, OPEN_STATUSES, "status")
  const number = input.driverNumber === undefined ? { display: current.driver_number_display, normalized: current.driver_number_display ? normalizeUnitNumber(current.driver_number_display) : null } : driverNumber(input.driverNumber)
  if (type === current.relationship_type && status === current.status && number.display === current.driver_number_display) throw new DriverValidationError("input", "Nothing changed.")
  const at = input.effectiveFrom === undefined ? await today(ctx.client) : day(input.effectiveFrom, "effectiveFrom")
  if (at <= current.effective_from) throw new DriverValidationError("effectiveFrom", `A change must take effect after the current record began (${current.effective_from}). If the recorded value was wrong, correct it instead.`)

  const id = randomUUID()
  await guarded(async () => {
    await ctx.client.query(`UPDATE public.organization_driver_relationships SET effective_to=$2::date, updated_at=clock_timestamp() WHERE id=$1`, [current.id, at])
    await insertRelationship(ctx.client, { id, organizationId, personId, type, numberDisplay: number.display, numberNormalized: number.normalized, status, effectiveFrom: at })
  })
  await record(ctx, "RECORD_UPDATED", "ORGANIZATION_DRIVER_CHANGE", { resourceType: "organization_driver_relationships", resourceId: id, organizationId, personId }, [
    { field: "relationshipType", before: literal(current.relationship_type), after: literal(type) },
    { field: "status", before: literal(current.status), after: literal(status) },
    { field: "record", before: reference("organization_driver_relationships", current.id), after: reference("organization_driver_relationships", id) },
  ])
  return { relationshipId: id }
}

/** CORRECTION of a wrongly recorded relationship: the wrong row is kept, flagged, and the replacement carries the same business start. */
export async function correctDriverRelationship(ctx: IdentityContext, rawInput: unknown): Promise<{ relationshipId: string }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "relationshipType", "status", "driverNumber"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  await lockActiveOrganization(ctx, organizationId)
  const { relationship } = await lockManagedDriver(ctx, organizationId, personId, { requireOpen: true })
  const current = relationship as RelationshipRow
  const type = input.relationshipType === undefined ? current.relationship_type : oneOf(input.relationshipType, RELATIONSHIP_TYPES, "relationshipType")
  const status = input.status === undefined ? (current.status as DriverOpenStatus) : oneOf(input.status, OPEN_STATUSES, "status")
  const number = input.driverNumber === undefined ? { display: current.driver_number_display, normalized: current.driver_number_display ? normalizeUnitNumber(current.driver_number_display) : null } : driverNumber(input.driverNumber)
  if (type === current.relationship_type && status === current.status && number.display === current.driver_number_display) throw new DriverValidationError("input", "Nothing changed.")

  const id = randomUUID()
  await guarded(async () => {
    await ctx.client.query(`UPDATE public.organization_driver_relationships SET record_status='corrected', corrected_at=clock_timestamp(), superseded_by_id=$2, updated_at=clock_timestamp() WHERE id=$1`, [current.id, id])
    await insertRelationship(ctx.client, { id, organizationId, personId, type, numberDisplay: number.display, numberNormalized: number.normalized, status, effectiveFrom: current.effective_from })
  })
  await record(ctx, "RECORD_CORRECTED", "ORGANIZATION_DRIVER_CORRECT", { resourceType: "organization_driver_relationships", resourceId: id, organizationId, personId }, [
    { field: "relationshipType", before: literal(current.relationship_type), after: literal(type) },
    { field: "status", before: literal(current.status), after: literal(status) },
    { field: "record", before: reference("organization_driver_relationships", current.id), after: reference("organization_driver_relationships", id) },
  ])
  return { relationshipId: id }
}

/** REAL-WORLD end of the relationship (status ENDED at the end date). Nothing is deleted; a rehire is a new relationship. */
export async function endDriverRelationship(ctx: IdentityContext, rawInput: unknown): Promise<{ relationshipId: string }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "effectiveTo"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  await lockActiveOrganization(ctx, organizationId)
  const { relationship } = await lockManagedDriver(ctx, organizationId, personId, { requireOpen: true })
  const current = relationship as RelationshipRow
  const at = input.effectiveTo === undefined ? await today(ctx.client) : day(input.effectiveTo, "effectiveTo")
  if (at <= current.effective_from) throw new DriverValidationError("effectiveTo", `The end date must be after the relationship began (${current.effective_from}). If the relationship was entered in error, correct it.`)
  await guarded(() =>
    ctx.client.query(`UPDATE public.organization_driver_relationships SET status='ENDED', effective_to=$2::date, updated_at=clock_timestamp() WHERE id=$1`, [current.id, at]),
  )
  await record(ctx, "RECORD_UPDATED", "ORGANIZATION_DRIVER_END", { resourceType: "organization_driver_relationships", resourceId: current.id, organizationId, personId }, [
    { field: "status", before: literal(current.status), after: literal("ENDED") },
    { field: "effectiveTo", after: literal(at) },
  ])
  return { relationshipId: current.id }
}

// ======================================================================================================================
// Licences (driver_licences)
// ======================================================================================================================

type LicenceRow = { id: string; person_id: string; jurisdiction_country: string; jurisdiction_region: string; licence_number_display: string; licence_class: string | null; issue_date: string | null; expiry_date: string | null; effective_from: string; effective_to: string | null; record_status: string }
const LICENCE_COLUMNS = `id, person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_class, to_char(issue_date,'YYYY-MM-DD') AS issue_date, to_char(expiry_date,'YYYY-MM-DD') AS expiry_date, to_char(effective_from,'YYYY-MM-DD') AS effective_from, to_char(effective_to,'YYYY-MM-DD') AS effective_to, record_status`

async function openLicence(ctx: IdentityContext, personId: string, licenceId: string): Promise<LicenceRow> {
  const result = await ctx.client.query<LicenceRow>(`SELECT ${LICENCE_COLUMNS} FROM public.driver_licences WHERE id=$1 AND person_id=$2 AND record_status='active' AND effective_to IS NULL FOR UPDATE`, [licenceId, personId])
  if (!result.rows[0]) throw new DriverNotFoundError("Licence")
  return result.rows[0]
}

/**
 * Records a licence for the driver. With a current licence in the SAME jurisdiction this is a REAL-WORLD replacement (renewal or
 * reissue): the current one is ended at the new licence's effective date, which must be after the current one began. A licence
 * in another jurisdiction coexists. A licence number that already identifies another driver is a conflict (never a duplicate person).
 */
export async function recordDriverLicence(ctx: IdentityContext, rawInput: unknown): Promise<{ licenceId: string; replacedLicenceId: string | null }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "licence"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  const licence = parseLicence(input.licence, "licence", await today(ctx.client))
  await lockActiveOrganization(ctx, organizationId)
  await lockManagedDriver(ctx, organizationId, personId, { requireOpen: true })
  const number = normalizeDriverLicenceNumber(licence.number)
  const holder = await ctx.client.query<{ person_id: string }>(
    `SELECT person_id FROM public.driver_licences WHERE jurisdiction_country=$1 AND jurisdiction_region=$2 AND licence_number_normalized=$3 AND record_status='active' AND effective_to IS NULL LIMIT 1`,
    [licence.country, licence.region, number],
  )
  if (holder.rows[0] && holder.rows[0].person_id !== personId) throw new DriverConflictError("This licence already identifies a different driver.", holder.rows[0].person_id)
  const sameJurisdiction = await ctx.client.query<LicenceRow>(
    `SELECT ${LICENCE_COLUMNS} FROM public.driver_licences WHERE person_id=$1 AND jurisdiction_country=$2 AND jurisdiction_region=$3 AND record_status='active' AND effective_to IS NULL FOR UPDATE`,
    [personId, licence.country, licence.region],
  )
  const current = sameJurisdiction.rows[0] ?? null
  if (current && licence.effectiveFrom <= current.effective_from) {
    throw new DriverValidationError("licence.effectiveFrom", `A replacement licence must take effect after the current one began (${current.effective_from}). If the recorded licence was wrong, correct it instead.`)
  }
  const id = randomUUID()
  await guarded(async () => {
    if (current) await ctx.client.query(`UPDATE public.driver_licences SET effective_to=$2::date, updated_at=clock_timestamp() WHERE id=$1`, [current.id, licence.effectiveFrom])
    await insertLicence(ctx.client, id, personId, licence)
  })
  await record(ctx, current ? "RECORD_UPDATED" : "RECORD_CREATED", current ? "DRIVER_LICENCE_CHANGE" : "DRIVER_LICENCE_CREATE", { resourceType: "driver_licences", resourceId: id, organizationId, personId }, [
    { field: "record", before: current ? reference("driver_licences", current.id) : undefined, after: reference("driver_licences", id) },
  ])
  return { licenceId: id, replacedLicenceId: current?.id ?? null }
}

/** CORRECTION of a wrongly recorded licence (number, class, dates, jurisdiction): the wrong row is kept, flagged; the replacement inherits the business start. */
export async function correctDriverLicence(ctx: IdentityContext, rawInput: unknown): Promise<{ licenceId: string }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "licenceId", "jurisdictionCountry", "jurisdictionRegion", "licenceNumber", "licenceClass", "issueDate", "expiryDate"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  const licenceId = uuid(input.licenceId, "licenceId")
  await lockActiveOrganization(ctx, organizationId)
  await lockManagedDriver(ctx, organizationId, personId, { requireOpen: true })
  const current = await openLicence(ctx, personId, licenceId)
  const next = parseLicence(
    {
      jurisdictionCountry: input.jurisdictionCountry ?? current.jurisdiction_country,
      jurisdictionRegion: input.jurisdictionRegion ?? current.jurisdiction_region,
      licenceNumber: input.licenceNumber ?? current.licence_number_display,
      licenceClass: input.licenceClass === undefined ? current.licence_class : input.licenceClass,
      issueDate: input.issueDate === undefined ? current.issue_date : input.issueDate,
      expiryDate: input.expiryDate === undefined ? current.expiry_date : input.expiryDate,
      effectiveFrom: current.effective_from,
    },
    "licence",
    current.effective_from,
  )
  if (next.country === current.jurisdiction_country && next.region === current.jurisdiction_region && next.number === current.licence_number_display && next.licenceClass === current.licence_class && next.issueDate === current.issue_date && next.expiryDate === current.expiry_date) {
    throw new DriverValidationError("input", "Nothing changed.")
  }
  const number = normalizeDriverLicenceNumber(next.number)
  const holder = await ctx.client.query<{ person_id: string; id: string }>(
    `SELECT person_id, id FROM public.driver_licences WHERE jurisdiction_country=$1 AND jurisdiction_region=$2 AND licence_number_normalized=$3 AND record_status='active' AND effective_to IS NULL LIMIT 1`,
    [next.country, next.region, number],
  )
  if (holder.rows[0] && holder.rows[0].id !== current.id) throw new DriverConflictError("This licence already identifies a driver.", holder.rows[0].person_id)
  const id = randomUUID()
  await guarded(async () => {
    await ctx.client.query(`UPDATE public.driver_licences SET record_status='corrected', corrected_at=clock_timestamp(), superseded_by_id=$2, updated_at=clock_timestamp() WHERE id=$1`, [current.id, id])
    await insertLicence(ctx.client, id, personId, next)
  })
  await record(ctx, "RECORD_CORRECTED", "DRIVER_LICENCE_CORRECT", { resourceType: "driver_licences", resourceId: id, organizationId, personId }, [
    { field: "record", before: reference("driver_licences", current.id), after: reference("driver_licences", id) },
  ])
  return { licenceId: id }
}

/** VOID of a licence that should never have been recorded: kept, flagged 'voided', no replacement. */
export async function voidDriverLicence(ctx: IdentityContext, rawInput: unknown): Promise<{ licenceId: string }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "licenceId"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  const licenceId = uuid(input.licenceId, "licenceId")
  await lockActiveOrganization(ctx, organizationId)
  await lockManagedDriver(ctx, organizationId, personId, { requireOpen: true })
  const current = await openLicence(ctx, personId, licenceId)
  await guarded(() => ctx.client.query(`UPDATE public.driver_licences SET record_status='voided', corrected_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [current.id]))
  await record(ctx, "RECORD_CORRECTED", "DRIVER_LICENCE_VOID", { resourceType: "driver_licences", resourceId: current.id, organizationId, personId }, [
    { field: "record", before: reference("driver_licences", current.id), after: literal("voided") },
  ])
  return { licenceId: current.id }
}

// ======================================================================================================================
// Medical qualification periods (driver_medical_qualification_periods; the table had no operations before this file)
// ======================================================================================================================

type MedicalRow = { id: string; person_id: string; jurisdiction_country: string; jurisdiction_region: string | null; qualification_type: string; issued_on: string | null; expires_on: string | null; effective_from: string; effective_to: string | null; record_status: string }
const MEDICAL_COLUMNS = `id, person_id, jurisdiction_country, jurisdiction_region, qualification_type, to_char(issued_on,'YYYY-MM-DD') AS issued_on, to_char(expires_on,'YYYY-MM-DD') AS expires_on, to_char(effective_from,'YYYY-MM-DD') AS effective_from, to_char(effective_to,'YYYY-MM-DD') AS effective_to, record_status`

type MedicalInput = { country: string; region: string | null; type: string; issuedOn: string | null; expiresOn: string | null; effectiveFrom: string }
function parseMedical(raw: Raw, defaultFrom: string, base?: MedicalRow): MedicalInput {
  const type = raw.qualificationType === undefined ? base?.qualification_type : text(raw.qualificationType, "qualificationType", 64)
  if (!type || !QUALIFICATION_TYPE.test(type)) throw new DriverValidationError("qualificationType", "qualificationType must be upper-case letters, digits and underscores (for example DOT_MEDICAL_CERTIFICATE).")
  const issuedOn = raw.issuedOn === undefined ? base?.issued_on ?? null : optionalDay(raw.issuedOn, "issuedOn")
  const expiresOn = raw.expiresOn === undefined ? base?.expires_on ?? null : optionalDay(raw.expiresOn, "expiresOn")
  if (issuedOn && expiresOn && expiresOn < issuedOn) throw new DriverValidationError("expiresOn", "The expiry cannot precede the issue date.")
  const country = raw.jurisdictionCountry === undefined ? base?.jurisdiction_country : text(raw.jurisdictionCountry, "jurisdictionCountry", 60)
  if (!country) throw new DriverValidationError("jurisdictionCountry", "jurisdictionCountry is required.")
  return {
    country,
    region: raw.jurisdictionRegion === undefined ? base?.jurisdiction_region ?? null : optionalText(raw.jurisdictionRegion, "jurisdictionRegion", 60),
    type,
    issuedOn,
    expiresOn,
    effectiveFrom: raw.effectiveFrom === undefined ? base?.effective_from ?? defaultFrom : day(raw.effectiveFrom, "effectiveFrom"),
  }
}
async function insertMedical(client: PoolClient, id: string, personId: string, m: MedicalInput) {
  await guarded(() =>
    client.query(
      `INSERT INTO public.driver_medical_qualification_periods (id, person_id, jurisdiction_country, jurisdiction_region, qualification_type, issued_on, expires_on, effective_from)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8::date)`,
      [id, personId, m.country, m.region, m.type, m.issuedOn, m.expiresOn, m.effectiveFrom],
    ),
  )
}
async function openMedical(ctx: IdentityContext, personId: string, periodId: string): Promise<MedicalRow> {
  const result = await ctx.client.query<MedicalRow>(`SELECT ${MEDICAL_COLUMNS} FROM public.driver_medical_qualification_periods WHERE id=$1 AND person_id=$2 AND record_status='active' AND effective_to IS NULL FOR UPDATE`, [periodId, personId])
  if (!result.rows[0]) throw new DriverNotFoundError("Medical qualification period")
  return result.rows[0]
}

const MEDICAL_ADD_KEYS = ["organizationId", "personId", "qualificationType", "jurisdictionCountry", "jurisdictionRegion", "issuedOn", "expiresOn", "effectiveFrom"] as const

export async function addMedicalPeriod(ctx: IdentityContext, rawInput: unknown): Promise<{ periodId: string }> {
  const input = object(rawInput, "input", MEDICAL_ADD_KEYS)
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  if (input.qualificationType === undefined || input.jurisdictionCountry === undefined) throw new DriverValidationError("input", "qualificationType and jurisdictionCountry are required.")
  const medical = parseMedical(input, await today(ctx.client))
  await lockActiveOrganization(ctx, organizationId)
  await lockManagedDriver(ctx, organizationId, personId, { requireOpen: true })
  const id = randomUUID()
  await insertMedical(ctx.client, id, personId, medical)
  await record(ctx, "RECORD_CREATED", "DRIVER_MEDICAL_PERIOD_CREATE", { resourceType: "driver_medical_qualification_periods", resourceId: id, organizationId, personId }, [
    { field: "qualificationType", after: literal(medical.type) },
    { field: "record", after: reference("driver_medical_qualification_periods", id) },
  ])
  return { periodId: id }
}

/** REAL-WORLD change (renewal / re-examination): the current period is ended at the new period's effective date, which must be after it began. */
export async function changeMedicalPeriod(ctx: IdentityContext, rawInput: unknown): Promise<{ periodId: string }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "periodId", "issuedOn", "expiresOn", "effectiveFrom"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  const periodId = uuid(input.periodId, "periodId")
  await lockActiveOrganization(ctx, organizationId)
  await lockManagedDriver(ctx, organizationId, personId, { requireOpen: true })
  const current = await openMedical(ctx, personId, periodId)
  const next = parseMedical({ issuedOn: input.issuedOn, expiresOn: input.expiresOn, effectiveFrom: input.effectiveFrom }, await today(ctx.client), { ...current, issued_on: null, expires_on: null })
  if (input.effectiveFrom === undefined) next.effectiveFrom = await today(ctx.client)
  if (next.effectiveFrom <= current.effective_from) throw new DriverValidationError("effectiveFrom", `A renewal must take effect after the current period began (${current.effective_from}). If the recorded period was wrong, correct it instead.`)
  const id = randomUUID()
  await guarded(async () => {
    await ctx.client.query(`UPDATE public.driver_medical_qualification_periods SET effective_to=$2::date, updated_at=clock_timestamp() WHERE id=$1`, [current.id, next.effectiveFrom])
    await insertMedical(ctx.client, id, personId, next)
  })
  await record(ctx, "RECORD_UPDATED", "DRIVER_MEDICAL_PERIOD_CHANGE", { resourceType: "driver_medical_qualification_periods", resourceId: id, organizationId, personId }, [
    { field: "record", before: reference("driver_medical_qualification_periods", current.id), after: reference("driver_medical_qualification_periods", id) },
  ])
  return { periodId: id }
}

/** CORRECTION of a wrongly recorded period: the wrong row is kept, flagged; the replacement inherits the business start. */
export async function correctMedicalPeriod(ctx: IdentityContext, rawInput: unknown): Promise<{ periodId: string }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "periodId", "qualificationType", "jurisdictionCountry", "jurisdictionRegion", "issuedOn", "expiresOn"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  const periodId = uuid(input.periodId, "periodId")
  await lockActiveOrganization(ctx, organizationId)
  await lockManagedDriver(ctx, organizationId, personId, { requireOpen: true })
  const current = await openMedical(ctx, personId, periodId)
  const next = parseMedical({ ...input, effectiveFrom: current.effective_from }, current.effective_from, current)
  if (next.country === current.jurisdiction_country && next.region === current.jurisdiction_region && next.type === current.qualification_type && next.issuedOn === current.issued_on && next.expiresOn === current.expires_on) {
    throw new DriverValidationError("input", "Nothing changed.")
  }
  const id = randomUUID()
  await guarded(async () => {
    await ctx.client.query(`UPDATE public.driver_medical_qualification_periods SET record_status='corrected', corrected_at=clock_timestamp(), superseded_by_id=$2, updated_at=clock_timestamp() WHERE id=$1`, [current.id, id])
    await insertMedical(ctx.client, id, personId, next)
  })
  await record(ctx, "RECORD_CORRECTED", "DRIVER_MEDICAL_PERIOD_CORRECT", { resourceType: "driver_medical_qualification_periods", resourceId: id, organizationId, personId }, [
    { field: "record", before: reference("driver_medical_qualification_periods", current.id), after: reference("driver_medical_qualification_periods", id) },
  ])
  return { periodId: id }
}

/** VOID of a period that should never have been recorded: kept, flagged 'voided', no replacement. */
export async function voidMedicalPeriod(ctx: IdentityContext, rawInput: unknown): Promise<{ periodId: string }> {
  const input = object(rawInput, "input", ["organizationId", "personId", "periodId"])
  const organizationId = uuid(input.organizationId, "organizationId")
  const personId = uuid(input.personId, "personId")
  const periodId = uuid(input.periodId, "periodId")
  await lockActiveOrganization(ctx, organizationId)
  await lockManagedDriver(ctx, organizationId, personId, { requireOpen: true })
  const current = await openMedical(ctx, personId, periodId)
  await guarded(() => ctx.client.query(`UPDATE public.driver_medical_qualification_periods SET record_status='voided', corrected_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [current.id]))
  await record(ctx, "RECORD_CORRECTED", "DRIVER_MEDICAL_PERIOD_VOID", { resourceType: "driver_medical_qualification_periods", resourceId: current.id, organizationId, personId }, [
    { field: "record", before: reference("driver_medical_qualification_periods", current.id), after: literal("voided") },
  ])
  return { periodId: current.id }
}
