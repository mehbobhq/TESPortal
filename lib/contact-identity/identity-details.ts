/**
 * Restricted person identity details shown in Contacts: date of birth and the person's driving licence record.
 *
 * Canonical homes (no second copy anywhere):
 *   date of birth   public.person_birth_dates (migration 0035), keyed by the ONE canonical Person, restricted by PERSON_IDENTITY_READ /
 *                   PERSON_IDENTITY_MANAGE.
 *   driving licence public.driver_licences (migration 0021), the SAME record the Drivers workflow uses. A person's licence is never
 *                   duplicated: an existing record is reused, a licence number already held by ANOTHER person is refused (and that
 *                   person is never disclosed). The licence row hangs off public.driver_profiles; creating one for a contact only
 *                   records "this person holds a licence". It does NOT make them a company Driver (that is
 *                   organization_driver_relationships, which this module never writes).
 *
 * Entering these details is DATA ENTRY. It never verifies an identity: nothing here sets or reads a verification state, and the Contacts
 * page keeps showing the identity as Unverified. Licence restrictions are intentionally not part of this workflow.
 *
 * History: a date of birth never "changes", so a different value is a CORRECTION (the wrong row is kept, flagged and pointed at its
 * replacement) and clearing it VOIDS the row. A licence whose number and jurisdiction are unchanged but whose class or dates differ is
 * a RENEWAL (the old record is ended, the new one starts); any other edit is a CORRECTION of a wrongly recorded licence. Nothing is
 * deleted.
 *
 * Master Register: events reference rows (table:id) and carry controlled-vocabulary literals only. A date of birth or a licence number
 * is NEVER written to the Master Register (it must not become a second copy of identity data).
 *
 * Plain domain logic on a caller-supplied transaction; the capability checks and the server-only boundary are in service.ts.
 */
import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { ContactConflictError, ContactNotFoundError, ContactStateError, ContactValidationError } from "@/lib/contacts/errors"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType } from "@/lib/master-register/types"
import { normalizeDriverLicenceNumber } from "@/lib/operational-identity/normalization"

export type IdentityContext = { client: PoolClient; actor: { id: string; actorType: ActorType }; masterRegister: MasterRegisterRepository }

export type LicenceDetails = {
  id: string
  number: string
  country: string
  region: string
  licenceClass: string | null
  issueDate: string | null
  expiryDate: string | null
}

export type PersonIdentityDetails = {
  personId: string
  dateOfBirth: { id: string; value: string } | null
  licence: LicenceDetails | null
}

export type LicenceInput = {
  number: string
  country: string
  region: string
  licenceClass?: string | null
  issueDate?: string | null
  expiryDate?: string | null
}

export type IdentityInput = {
  /** undefined = untouched, null or "" = clear (the entry is voided, never deleted). */
  dateOfBirth?: string | null
  /** undefined = untouched, null = clear. */
  licence?: LicenceInput | null
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar day (2026-02-30 is refused), as YYYY-MM-DD. */
export function parseDay(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DAY.test(value.trim())) throw new ContactValidationError(field, `${field} must be a date (YYYY-MM-DD).`)
  const day = value.trim()
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new ContactValidationError(field, `${field} is not a real date.`)
  return day
}

export function parseDateOfBirth(value: unknown): string {
  const day = parseDay(value, "dateOfBirth")
  if (day < "1900-01-01") throw new ContactValidationError("dateOfBirth", "The date of birth is not plausible.")
  if (day > new Date().toISOString().slice(0, 10)) throw new ContactValidationError("dateOfBirth", "A date of birth cannot be in the future.")
  return day
}

type PreparedLicence = { number: string; normalized: string; country: string; region: string; licenceClass: string | null; issueDate: string | null; expiryDate: string | null }

export function prepareLicence(value: LicenceInput): PreparedLicence {
  const number = typeof value.number === "string" ? value.number.trim() : ""
  const normalized = normalizeDriverLicenceNumber(number)
  if (!normalized || number.length > 40) throw new ContactValidationError("licence.number", "Enter the driver licence number (up to 40 characters).")
  const country = typeof value.country === "string" ? value.country.trim().toUpperCase() : ""
  const region = typeof value.region === "string" ? value.region.trim().toUpperCase() : ""
  if (!country || !region || country.length > 8 || region.length > 8) throw new ContactValidationError("licence.region", "Enter the issuing jurisdiction (country and province / state).")
  const licenceClass = typeof value.licenceClass === "string" && value.licenceClass.trim() !== "" ? value.licenceClass.trim() : null
  if (licenceClass !== null && licenceClass.length > 20) throw new ContactValidationError("licence.class", "The licence class is too long.")
  const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "")
  const issueDate = empty(value.issueDate) ? null : parseDay(value.issueDate, "licence.issueDate")
  const expiryDate = empty(value.expiryDate) ? null : parseDay(value.expiryDate, "licence.expiryDate")
  if (issueDate && expiryDate && expiryDate < issueDate) throw new ContactValidationError("licence.expiryDate", "The licence cannot expire before it was issued.")
  return { number, normalized, country, region, licenceClass, issueDate, expiryDate }
}

// --- reads ----------------------------------------------------------------------------------------------------------------

export async function readBirthDate(client: Pick<PoolClient, "query">, personId: string): Promise<{ id: string; value: string } | null> {
  const result = await client.query<{ id: string; value: string }>(
    `SELECT id, to_char(date_of_birth, 'YYYY-MM-DD') AS value FROM public.person_birth_dates WHERE person_id = $1 AND record_status = 'active'`,
    [personId],
  )
  return result.rows[0] ?? null
}

const LICENCE_SELECT = `SELECT id, licence_number_display AS number, jurisdiction_country AS country, jurisdiction_region AS region, licence_class AS "licenceClass",
       to_char(issue_date, 'YYYY-MM-DD') AS "issueDate", to_char(expiry_date, 'YYYY-MM-DD') AS "expiryDate"
  FROM public.driver_licences WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL
 ORDER BY effective_from DESC, created_at DESC`

export async function readLicence(client: Pick<PoolClient, "query">, personId: string): Promise<LicenceDetails | null> {
  const result = await client.query<LicenceDetails>(`${LICENCE_SELECT} LIMIT 1`, [personId])
  return result.rows[0] ?? null
}

// --- writes ---------------------------------------------------------------------------------------------------------------

const literal = (value: string | number | boolean | null) => ({ kind: "LITERAL" as const, value })
const reference = (table: string, id: string) => ({ kind: "REFERENCE" as const, reference: `${table}:${id}` })

async function event(ctx: IdentityContext, eventType: "RECORD_CREATED" | "RECORD_CORRECTED" | "RECORD_UPDATED", operation: string, resourceType: string, resourceId: string, organizationId: string, personId: string, fields: Array<{ field: string; before?: ReturnType<typeof reference> | ReturnType<typeof literal>; after?: ReturnType<typeof reference> | ReturnType<typeof literal> }>) {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: { resourceType, resourceId, subjectReferences: [`organization:${organizationId}`, `person:${personId}`] },
    source: { sourceType: "APPLICATION", component: "contacts", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fields.map((f) => f.field), fieldChanges: fields },
    outcome: { result: "SUCCESS" },
  })
}

/** Records, corrects or voids the person's date of birth. Returns what changed ("unchanged" when the value already stands). */
export async function setDateOfBirth(ctx: IdentityContext, organizationId: string, personId: string, input: unknown): Promise<"created" | "corrected" | "voided" | "unchanged"> {
  const clearing = input === null || (typeof input === "string" && input.trim() === "")
  const next = clearing ? null : parseDateOfBirth(input)
  const existing = await readBirthDate(ctx.client, personId)
  if (next === null) {
    if (!existing) return "unchanged"
    await ctx.client.query(`UPDATE public.person_birth_dates SET record_status = 'voided', corrected_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 AND record_status = 'active'`, [existing.id])
    await event(ctx, "RECORD_CORRECTED", "voidDateOfBirth", "person_birth_date", existing.id, organizationId, personId, [{ field: "dateOfBirth", before: reference("person_birth_dates", existing.id), after: literal("voided") }])
    return "voided"
  }
  if (existing && existing.value === next) return "unchanged"
  const id = randomUUID()
  if (existing) {
    // The current row must stop being the unique active row before the replacement is inserted; the pointer FK is deferred.
    await ctx.client.query(`UPDATE public.person_birth_dates SET record_status = 'corrected', corrected_at = clock_timestamp(), superseded_by_id = $2, updated_at = clock_timestamp() WHERE id = $1 AND record_status = 'active'`, [existing.id, id])
  }
  await ctx.client.query(`INSERT INTO public.person_birth_dates (id, person_id, date_of_birth) VALUES ($1, $2, $3::date)`, [id, personId, next])
  await event(ctx, existing ? "RECORD_CORRECTED" : "RECORD_CREATED", existing ? "correctDateOfBirth" : "recordDateOfBirth", "person_birth_date", id, organizationId, personId, [
    { field: "dateOfBirth", ...(existing ? { before: reference("person_birth_dates", existing.id) } : {}), after: reference("person_birth_dates", id) },
  ])
  return existing ? "corrected" : "created"
}

async function holderOf(client: Pick<PoolClient, "query">, p: PreparedLicence): Promise<string | null> {
  const result = await client.query<{ person_id: string }>(
    `SELECT person_id FROM public.driver_licences
      WHERE jurisdiction_country = $1 AND jurisdiction_region = $2 AND licence_number_normalized = $3 AND record_status = 'active' AND effective_to IS NULL LIMIT 1`,
    [p.country, p.region, p.normalized],
  )
  return result.rows[0]?.person_id ?? null
}

async function insertLicence(ctx: IdentityContext, personId: string, p: PreparedLicence, effectiveFrom: string, id: string) {
  await ctx.client.query(
    `INSERT INTO public.driver_licences (id, person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_number_normalized, licence_class, issue_date, expiry_date, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10::date)`,
    [id, personId, p.country, p.region, p.number, p.normalized, p.licenceClass, p.issueDate, p.expiryDate, effectiveFrom],
  )
}

/** Records, renews, corrects or voids the person's driving licence in the canonical driver_licences table. */
export async function setLicence(ctx: IdentityContext, organizationId: string, personId: string, input: LicenceInput | null): Promise<"created" | "renewed" | "corrected" | "voided" | "unchanged"> {
  const existing = await ctx.client.query<{ id: string; country: string; region: string; normalized: string; licenceClass: string | null; issueDate: string | null; expiryDate: string | null; effectiveFrom: string; today: string }>(
    `SELECT id, jurisdiction_country AS country, jurisdiction_region AS region, licence_number_normalized AS normalized, licence_class AS "licenceClass",
            to_char(issue_date, 'YYYY-MM-DD') AS "issueDate", to_char(expiry_date, 'YYYY-MM-DD') AS "expiryDate", to_char(effective_from, 'YYYY-MM-DD') AS "effectiveFrom",
            to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS today
       FROM public.driver_licences WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1 FOR UPDATE`,
    [personId],
  )
  const current = existing.rows[0]
  if (input === null) {
    if (!current) return "unchanged"
    await ctx.client.query(`UPDATE public.driver_licences SET record_status = 'voided', corrected_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 AND record_status = 'active'`, [current.id])
    await event(ctx, "RECORD_CORRECTED", "voidDriverLicence", "driver_licence", current.id, organizationId, personId, [{ field: "licence", before: reference("driver_licences", current.id), after: literal("voided") }])
    return "voided"
  }
  const p = prepareLicence(input)
  const holder = await holderOf(ctx.client, p)
  if (holder !== null && holder !== personId) throw new ContactConflictError("This licence number is already recorded for another person. Nothing was saved.")

  if (current && current.country === p.country && current.region === p.region && current.normalized === p.normalized &&
      (current.licenceClass ?? null) === p.licenceClass && (current.issueDate ?? null) === p.issueDate && (current.expiryDate ?? null) === p.expiryDate) return "unchanged"

  const person = await ctx.client.query<{ record_status: string }>(`SELECT record_status FROM public.persons WHERE id = $1`, [personId])
  if (!person.rows[0]) throw new ContactNotFoundError("Person")
  if (person.rows[0].record_status !== "active") throw new ContactStateError("This person is archived; restore the person first.")

  const profile = await ctx.client.query(`SELECT 1 FROM public.driver_profiles WHERE person_id = $1`, [personId])
  if ((profile.rowCount ?? 0) === 0) {
    await ctx.client.query(`INSERT INTO public.driver_profiles (person_id) VALUES ($1)`, [personId])
    await event(ctx, "RECORD_CREATED", "recordLicenceHolder", "driver_profile", personId, organizationId, personId, [{ field: "driverProfile", after: reference("driver_profiles", personId) }])
  }

  const id = randomUUID()
  if (!current) {
    await insertLicence(ctx, personId, p, (await ctx.client.query<{ d: string }>(`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d`)).rows[0].d, id)
    await event(ctx, "RECORD_CREATED", "recordDriverLicence", "driver_licence", id, organizationId, personId, [{ field: "licence", after: reference("driver_licences", id) }])
    return "created"
  }
  const sameIdentity = current.country === p.country && current.region === p.region && current.normalized === p.normalized
  if (sameIdentity && current.effectiveFrom < current.today) {
    // RENEWAL: class or dates moved on. The old record is ended today and the new one starts today.
    await ctx.client.query(`UPDATE public.driver_licences SET effective_to = $2::date, updated_at = clock_timestamp() WHERE id = $1 AND record_status = 'active' AND effective_to IS NULL`, [current.id, current.today])
    await insertLicence(ctx, personId, p, current.today, id)
    await event(ctx, "RECORD_UPDATED", "renewDriverLicence", "driver_licence", id, organizationId, personId, [{ field: "licence", before: reference("driver_licences", current.id), after: reference("driver_licences", id) }])
    return "renewed"
  }
  // CORRECTION: the recorded licence was wrong (or was recorded today). The wrong row is kept, flagged and pointed at its replacement.
  await ctx.client.query(`UPDATE public.driver_licences SET record_status = 'corrected', corrected_at = clock_timestamp(), superseded_by_id = $2, updated_at = clock_timestamp() WHERE id = $1 AND record_status = 'active'`, [current.id, id])
  await insertLicence(ctx, personId, p, current.effectiveFrom, id)
  await event(ctx, "RECORD_CORRECTED", "correctDriverLicence", "driver_licence", id, organizationId, personId, [{ field: "licence", before: reference("driver_licences", current.id), after: reference("driver_licences", id) }])
  return "corrected"
}
