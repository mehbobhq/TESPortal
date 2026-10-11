/**
 * Tax-registration repository: SQL only, on a caller-supplied transaction client.
 *
 * No authorization, validation, normalization or Master Register logic lives here. Every function takes the client the
 * authorization wrapper checked out, so authorization and persistence share one connection and one transaction. Nothing
 * here issues DELETE (the runtime role has none).
 *
 * Business time is passed and returned as text with microsecond precision, because a JS Date would truncate to
 * milliseconds and could reorder two writes made within the same millisecond.
 */

import type { PoolClient } from "pg"
import type { ProgramCode, RegistrationStatus } from "@/lib/tax-registrations/definitions"
import type { NumberCollisionMatch } from "@/lib/tax-registrations/errors"
import type {
  RegistrationRecord,
  RecordLifecycle,
  ReviewMatch,
  StatusPeriodRecord,
  VersionRecord,
} from "@/lib/tax-registrations/types"

export type Queryable = Pick<PoolClient, "query">

export const NUMBER_COLLISION_CONSTRAINT = "registration_versions_current_number_uq"
export const CURRENT_VERSION_CONSTRAINT = "registration_versions_current_uq"
export const CURRENT_STATUS_CONSTRAINT = "registration_status_periods_current_uq"
export const VERSION_WINDOW_CONSTRAINT = "registration_versions_effective_window_valid"
export const STATUS_WINDOW_CONSTRAINT = "registration_status_periods_effective_window_valid"
export const VERSION_REGISTRATION_ACTIVE_CONSTRAINT = "registration_versions_registration_active"
export const STATUS_REGISTRATION_ACTIVE_CONSTRAINT = "registration_status_periods_registration_active"
export const ORGANIZATION_ACTIVE_CONSTRAINT = "organization_must_be_active"

const MICRO_ISO = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const DATE_ISO = (column: string) => `to_char(${column}, 'YYYY-MM-DD')`

// --- clock --------------------------------------------------------------------------------------------------------

/** The database clock (not transaction start) as a microsecond ISO instant. */
export async function databaseNow(client: Queryable): Promise<string> {
  const result = await client.query<{ now: string }>(`SELECT ${MICRO_ISO("clock_timestamp()")} AS now`)
  return result.rows[0].now
}

export async function isNotInFuture(client: Queryable, instant: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(`SELECT $1::timestamptz <= clock_timestamp() AS ok`, [instant])
  return result.rows[0].ok
}

// --- organizations ------------------------------------------------------------------------------------------------

/** Row-locks the Organization so concurrent registration writers for it serialize. */
export async function lockOrganization(
  client: Queryable,
  organizationId: string,
): Promise<{ id: string; status: "active" | "archived" | "merged"; legalName: string } | undefined> {
  const result = await client.query<{ id: string; status: "active" | "archived" | "merged"; legal_name: string }>(
    `SELECT id, status, legal_name FROM public.organizations WHERE id = $1 FOR UPDATE`,
    [organizationId],
  )
  const row = result.rows[0]
  return row ? { id: row.id, status: row.status, legalName: row.legal_name } : undefined
}

export async function organizationExists(client: Queryable, organizationId: string): Promise<boolean> {
  return ((await client.query(`SELECT 1 FROM public.organizations WHERE id = $1`, [organizationId])).rowCount ?? 0) > 0
}

export async function isActiveProgram(client: Queryable, program: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM public.registration_programs WHERE code = $1 AND is_active`, [program])
  return (result.rowCount ?? 0) > 0
}

// --- row mapping --------------------------------------------------------------------------------------------------

type RegistrationRow = {
  id: string
  organization_id: string
  program_code: ProgramCode
  record_status: RecordLifecycle
  archived_at: string | null
  created_at: string
}
const REGISTRATION_COLUMNS = `id, organization_id, program_code, record_status, ${MICRO_ISO("archived_at")} AS archived_at,
  ${MICRO_ISO("created_at")} AS created_at`
const toRegistration = (row: RegistrationRow): RegistrationRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  program: row.program_code,
  recordStatus: row.record_status,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
})

type VersionRow = {
  id: string
  registration_id: string
  number_display: string
  number_normalized: string
  normalization_rule_version: string
  jurisdiction_country: string | null
  jurisdiction_region: string | null
  issued_on: string | null
  expires_on: string | null
  version_reason: VersionRecord["versionReason"]
  effective_from: string
  effective_to: string | null
  record_status: VersionRecord["recordStatus"]
  corrected_at: string | null
  superseded_by_version_id: string | null
  created_at: string
}
const VERSION_COLUMNS = `id, registration_id, number_display, number_normalized, normalization_rule_version,
  jurisdiction_country, jurisdiction_region, ${DATE_ISO("issued_on")} AS issued_on, ${DATE_ISO("expires_on")} AS expires_on,
  version_reason, ${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO("effective_to")} AS effective_to,
  record_status, ${MICRO_ISO("corrected_at")} AS corrected_at, superseded_by_version_id, ${MICRO_ISO("created_at")} AS created_at`
const toVersion = (row: VersionRow): VersionRecord => ({
  id: row.id,
  registrationId: row.registration_id,
  numberDisplay: row.number_display,
  numberNormalized: row.number_normalized,
  normalizationRuleVersion: row.normalization_rule_version,
  jurisdictionCountry: row.jurisdiction_country,
  jurisdictionRegion: row.jurisdiction_region,
  issuedOn: row.issued_on,
  expiresOn: row.expires_on,
  versionReason: row.version_reason,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededByVersionId: row.superseded_by_version_id,
  createdAt: row.created_at,
})

type PeriodRow = {
  id: string
  registration_id: string
  registration_status: RegistrationStatus
  period_reason: StatusPeriodRecord["periodReason"]
  effective_from: string
  effective_to: string | null
  record_status: StatusPeriodRecord["recordStatus"]
  corrected_at: string | null
  superseded_by_period_id: string | null
  created_at: string
}
const PERIOD_COLUMNS = `id, registration_id, registration_status, period_reason, ${MICRO_ISO("effective_from")} AS effective_from,
  ${MICRO_ISO("effective_to")} AS effective_to, record_status, ${MICRO_ISO("corrected_at")} AS corrected_at,
  superseded_by_period_id, ${MICRO_ISO("created_at")} AS created_at`
const toPeriod = (row: PeriodRow): StatusPeriodRecord => ({
  id: row.id,
  registrationId: row.registration_id,
  registrationStatus: row.registration_status,
  periodReason: row.period_reason,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededByPeriodId: row.superseded_by_period_id,
  createdAt: row.created_at,
})

// --- authorities --------------------------------------------------------------------------------------------------

export async function insertRegistration(client: Queryable, organizationId: string, program: ProgramCode): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, $2) RETURNING id`,
    [organizationId, program],
  )
  return result.rows[0].id
}

/** One registration of the Organization by id, optionally row-locked. */
export async function getRegistration(
  client: Queryable,
  organizationId: string,
  registrationId: string,
  lock = false,
): Promise<RegistrationRecord | undefined> {
  const result = await client.query<RegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} FROM public.registrations
      WHERE id = $1 AND organization_id = $2${lock ? " FOR UPDATE" : ""}`,
    [registrationId, organizationId],
  )
  return result.rows[0] ? toRegistration(result.rows[0]) : undefined
}

export async function setRegistrationRecordStatus(client: Queryable, registrationId: string, status: RecordLifecycle): Promise<void> {
  await client.query(
    `UPDATE public.registrations
        SET record_status = $2, archived_at = CASE WHEN $2 = 'archived' THEN now() ELSE NULL END, updated_at = now()
      WHERE id = $1`,
    [registrationId, status],
  )
}

export async function listRegistrations(client: Queryable, organizationId: string): Promise<RegistrationRecord[]> {
  const result = await client.query<RegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} FROM public.registrations WHERE organization_id = $1 ORDER BY program_code, created_at, id`,
    [organizationId],
  )
  return result.rows.map(toRegistration)
}

// --- versions -----------------------------------------------------------------------------------------------------

export async function insertVersion(
  client: Queryable,
  values: {
    id: string
    registrationId: string
    organizationId: string
    program: ProgramCode
    numberDisplay: string
    numberNormalized: string
    normalizationRuleVersion: string
    jurisdictionCountry: string | null
    jurisdictionRegion: string | null
    issuedOn: string | null
    expiresOn: string | null
    versionReason: VersionRecord["versionReason"]
    effectiveFrom: string
  },
): Promise<VersionRecord> {
  const result = await client.query<VersionRow>(
    `INSERT INTO public.registration_versions
       (id, registration_id, organization_id, program_code, number_display, number_normalized, normalization_rule_version,
        jurisdiction_country, jurisdiction_region, issued_on, expires_on, version_reason, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12, $13::timestamptz)
     RETURNING ${VERSION_COLUMNS}`,
    [
      values.id,
      values.registrationId,
      values.organizationId,
      values.program,
      values.numberDisplay,
      values.numberNormalized,
      values.normalizationRuleVersion,
      values.jurisdictionCountry,
      values.jurisdictionRegion,
      values.issuedOn,
      values.expiresOn,
      values.versionReason,
      values.effectiveFrom,
    ],
  )
  return toVersion(result.rows[0])
}

export async function getCurrentVersion(client: Queryable, registrationId: string, lock = false): Promise<VersionRecord | undefined> {
  const result = await client.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM public.registration_versions
      WHERE registration_id = $1 AND record_status = 'active' AND effective_to IS NULL${lock ? " FOR UPDATE" : ""}`,
    [registrationId],
  )
  return result.rows[0] ? toVersion(result.rows[0]) : undefined
}

/** A real-world change: the version was true until `effectiveTo`. */
export async function endVersion(client: Queryable, versionId: string, effectiveTo: string): Promise<void> {
  await client.query(
    `UPDATE public.registration_versions SET effective_to = $2::timestamptz, updated_at = now()
      WHERE id = $1 AND record_status = 'active' AND effective_to IS NULL`,
    [versionId, effectiveTo],
  )
}

/** A correction: the version was wrongly recorded. It is kept, flagged, NOT ended, and pointed at its replacement. */
export async function markVersionCorrected(client: Queryable, versionId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.registration_versions
        SET record_status = 'corrected', corrected_at = now(), superseded_by_version_id = $2, updated_at = now()
      WHERE id = $1 AND record_status = 'active'`,
    [versionId, replacementId],
  )
}

export async function listVersions(client: Queryable, registrationIds: string[]): Promise<Map<string, VersionRecord[]>> {
  const map = new Map<string, VersionRecord[]>()
  if (registrationIds.length === 0) return map
  const result = await client.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM public.registration_versions
      WHERE registration_id = ANY($1::uuid[]) ORDER BY registration_id, effective_from, created_at, id`,
    [registrationIds],
  )
  for (const row of result.rows) {
    const list = map.get(row.registration_id) ?? []
    list.push(toVersion(row))
    map.set(row.registration_id, list)
  }
  return map
}

// --- status periods -----------------------------------------------------------------------------------------------

export async function insertStatusPeriod(
  client: Queryable,
  values: {
    id: string
    registrationId: string
    registrationStatus: RegistrationStatus
    periodReason: StatusPeriodRecord["periodReason"]
    effectiveFrom: string
  },
): Promise<StatusPeriodRecord> {
  const result = await client.query<PeriodRow>(
    `INSERT INTO public.registration_status_periods (id, registration_id, registration_status, period_reason, effective_from)
     VALUES ($1, $2, $3, $4, $5::timestamptz)
     RETURNING ${PERIOD_COLUMNS}`,
    [values.id, values.registrationId, values.registrationStatus, values.periodReason, values.effectiveFrom],
  )
  return toPeriod(result.rows[0])
}

export async function getCurrentStatusPeriod(client: Queryable, registrationId: string, lock = false): Promise<StatusPeriodRecord | undefined> {
  const result = await client.query<PeriodRow>(
    `SELECT ${PERIOD_COLUMNS} FROM public.registration_status_periods
      WHERE registration_id = $1 AND record_status = 'active' AND effective_to IS NULL${lock ? " FOR UPDATE" : ""}`,
    [registrationId],
  )
  return result.rows[0] ? toPeriod(result.rows[0]) : undefined
}

export async function endStatusPeriod(client: Queryable, periodId: string, effectiveTo: string): Promise<void> {
  await client.query(
    `UPDATE public.registration_status_periods SET effective_to = $2::timestamptz, updated_at = now()
      WHERE id = $1 AND record_status = 'active' AND effective_to IS NULL`,
    [periodId, effectiveTo],
  )
}

export async function markStatusPeriodCorrected(client: Queryable, periodId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.registration_status_periods
        SET record_status = 'corrected', corrected_at = now(), superseded_by_period_id = $2, updated_at = now()
      WHERE id = $1 AND record_status = 'active'`,
    [periodId, replacementId],
  )
}

export async function listStatusPeriods(client: Queryable, registrationIds: string[]): Promise<Map<string, StatusPeriodRecord[]>> {
  const map = new Map<string, StatusPeriodRecord[]>()
  if (registrationIds.length === 0) return map
  const result = await client.query<PeriodRow>(
    `SELECT ${PERIOD_COLUMNS} FROM public.registration_status_periods
      WHERE registration_id = ANY($1::uuid[]) ORDER BY registration_id, effective_from, created_at, id`,
    [registrationIds],
  )
  for (const row of result.rows) {
    const list = map.get(row.registration_id) ?? []
    list.push(toPeriod(row))
    map.set(row.registration_id, list)
  }
  return map
}

// --- identity / collision -----------------------------------------------------------------------------------------

/** The CURRENT version holding this number in this namespace, with enough detail to disclose to a registry reader. */
export async function findCurrentNumberHolder(
  client: Queryable,
  program: ProgramCode,
  jurisdictionCountry: string | null,
  jurisdictionRegion: string | null,
  numberNormalized: string,
): Promise<NumberCollisionMatch | undefined> {
  const result = await client.query<{
    organization_id: string
    legal_name: string
    registration_id: string
    version_id: string
    record_status: "active" | "archived"
    registration_status: string | null
  }>(
    `SELECT v.organization_id, o.legal_name, v.registration_id, v.id AS version_id, a.record_status,
            (SELECT p.registration_status FROM public.registration_status_periods p
              WHERE p.registration_id = a.id AND p.record_status = 'active' AND p.effective_to IS NULL) AS registration_status
       FROM public.registration_versions v
       JOIN public.registrations a ON a.id = v.registration_id
       JOIN public.organizations o ON o.id = v.organization_id
      WHERE v.program_code = $1 AND v.jurisdiction_country IS NOT DISTINCT FROM $2::text AND v.jurisdiction_region IS NOT DISTINCT FROM $3::text
        AND v.number_normalized = $4 AND v.record_status = 'active' AND v.effective_to IS NULL
      LIMIT 1`,
    [program, jurisdictionCountry, jurisdictionRegion, numberNormalized],
  )
  const row = result.rows[0]
  if (!row) return undefined
  return {
    organizationId: row.organization_id,
    organizationLegalName: row.legal_name,
    registrationId: row.registration_id,
    versionId: row.version_id,
    registrationRecordStatus: row.record_status,
    registrationStatus: row.registration_status,
    recommendedAction: row.record_status === "archived" ? "RESTORE_ARCHIVED" : "OPEN_EXISTING",
  }
}

/** Ended or corrected versions with the same number in the same namespace: review evidence, never a blocker. */
export async function findNumberReviewMatches(
  client: Queryable,
  program: ProgramCode,
  jurisdictionCountry: string | null,
  jurisdictionRegion: string | null,
  numberNormalized: string,
  excludeRegistrationId: string | null,
): Promise<ReviewMatch[]> {
  const result = await client.query<{
    organization_id: string
    legal_name: string
    registration_id: string
    record_status: "active" | "corrected"
  }>(
    `SELECT DISTINCT v.organization_id, o.legal_name, v.registration_id, v.record_status
       FROM public.registration_versions v
       JOIN public.organizations o ON o.id = v.organization_id
      WHERE v.program_code = $1 AND v.jurisdiction_country IS NOT DISTINCT FROM $2::text AND v.jurisdiction_region IS NOT DISTINCT FROM $3::text
        AND v.number_normalized = $4 AND NOT (v.record_status = 'active' AND v.effective_to IS NULL)
        AND ($5::uuid IS NULL OR v.registration_id <> $5::uuid)`,
    [program, jurisdictionCountry, jurisdictionRegion, numberNormalized, excludeRegistrationId],
  )
  return result.rows.map((row) => ({
    kind: "ENDED_OR_CORRECTED_NUMBER" as const,
    organizationId: row.organization_id,
    organizationLegalName: row.legal_name,
    registrationId: row.registration_id,
    versionRecordStatus: row.record_status,
  }))
}
