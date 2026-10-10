/**
 * Operating-authority repository: SQL only, on a caller-supplied transaction client.
 *
 * No authorization, validation, normalization or Master Register logic lives here. Every function takes the client the
 * authorization wrapper checked out, so authorization and persistence share one connection and one transaction. Nothing
 * here issues DELETE (the runtime role has none).
 *
 * Business time is passed and returned as text with microsecond precision, because a JS Date would truncate to
 * milliseconds and could reorder two writes made within the same millisecond.
 */

import type { PoolClient } from "pg"
import type { AuthorityKind, AuthorityStatus } from "@/lib/operating-authorities/definitions"
import type { NumberCollisionMatch } from "@/lib/operating-authorities/errors"
import type {
  AuthorityRecord,
  RecordLifecycle,
  ReviewMatch,
  StatusPeriodRecord,
  VersionRecord,
} from "@/lib/operating-authorities/types"

export type Queryable = Pick<PoolClient, "query">

export const NUMBER_COLLISION_CONSTRAINT = "operating_authority_versions_current_number_uq"
export const CURRENT_IDENTITY_CONSTRAINT = "operating_authority_versions_current_identity_uq"
export const CURRENT_VERSION_CONSTRAINT = "operating_authority_versions_current_uq"
export const CURRENT_STATUS_CONSTRAINT = "operating_authority_status_periods_current_uq"
export const VERSION_WINDOW_CONSTRAINT = "operating_authority_versions_effective_window_valid"
export const STATUS_WINDOW_CONSTRAINT = "operating_authority_status_periods_effective_window_valid"
export const VERSION_AUTHORITY_ACTIVE_CONSTRAINT = "operating_authority_versions_authority_active"
export const STATUS_AUTHORITY_ACTIVE_CONSTRAINT = "operating_authority_status_periods_authority_active"

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

/** Row-locks the Organization so concurrent authority writers for it serialize. */
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

export async function loadCustomerOrganizationId(client: Queryable, customerId: string): Promise<string | undefined> {
  const result = await client.query<{ organization_id: string }>(
    `SELECT organization_id FROM public.customers WHERE id = $1`,
    [customerId],
  )
  return result.rows[0]?.organization_id
}

export async function isActiveKind(client: Queryable, kind: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM public.authority_kinds WHERE code = $1 AND is_active`, [kind])
  return (result.rowCount ?? 0) > 0
}

// --- row mapping --------------------------------------------------------------------------------------------------

type AuthorityRow = {
  id: string
  organization_id: string
  kind: AuthorityKind
  record_status: RecordLifecycle
  archived_at: string | null
  created_at: string
}
const AUTHORITY_COLUMNS = `id, organization_id, kind, record_status, ${MICRO_ISO("archived_at")} AS archived_at,
  ${MICRO_ISO("created_at")} AS created_at`
const toAuthority = (row: AuthorityRow): AuthorityRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  kind: row.kind,
  recordStatus: row.record_status,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
})

type VersionRow = {
  id: string
  authority_id: string
  number_display: string
  number_normalized: string
  normalization_rule_version: string
  jurisdiction_country: string
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
const VERSION_COLUMNS = `id, authority_id, number_display, number_normalized, normalization_rule_version,
  jurisdiction_country, jurisdiction_region, ${DATE_ISO("issued_on")} AS issued_on, ${DATE_ISO("expires_on")} AS expires_on,
  version_reason, ${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO("effective_to")} AS effective_to,
  record_status, ${MICRO_ISO("corrected_at")} AS corrected_at, superseded_by_version_id, ${MICRO_ISO("created_at")} AS created_at`
const toVersion = (row: VersionRow): VersionRecord => ({
  id: row.id,
  authorityId: row.authority_id,
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
  authority_id: string
  authority_status: AuthorityStatus
  period_reason: StatusPeriodRecord["periodReason"]
  effective_from: string
  effective_to: string | null
  record_status: StatusPeriodRecord["recordStatus"]
  corrected_at: string | null
  superseded_by_period_id: string | null
  created_at: string
}
const PERIOD_COLUMNS = `id, authority_id, authority_status, period_reason, ${MICRO_ISO("effective_from")} AS effective_from,
  ${MICRO_ISO("effective_to")} AS effective_to, record_status, ${MICRO_ISO("corrected_at")} AS corrected_at,
  superseded_by_period_id, ${MICRO_ISO("created_at")} AS created_at`
const toPeriod = (row: PeriodRow): StatusPeriodRecord => ({
  id: row.id,
  authorityId: row.authority_id,
  authorityStatus: row.authority_status,
  periodReason: row.period_reason,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededByPeriodId: row.superseded_by_period_id,
  createdAt: row.created_at,
})

// --- authorities --------------------------------------------------------------------------------------------------

export async function insertAuthority(client: Queryable, organizationId: string, kind: AuthorityKind): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.operating_authorities (organization_id, kind) VALUES ($1, $2) RETURNING id`,
    [organizationId, kind],
  )
  return result.rows[0].id
}

/** One authority of the Organization by id, optionally row-locked. */
export async function getAuthority(
  client: Queryable,
  organizationId: string,
  authorityId: string,
  lock = false,
): Promise<AuthorityRecord | undefined> {
  const result = await client.query<AuthorityRow>(
    `SELECT ${AUTHORITY_COLUMNS} FROM public.operating_authorities
      WHERE id = $1 AND organization_id = $2${lock ? " FOR UPDATE" : ""}`,
    [authorityId, organizationId],
  )
  return result.rows[0] ? toAuthority(result.rows[0]) : undefined
}

export async function setAuthorityRecordStatus(client: Queryable, authorityId: string, status: RecordLifecycle): Promise<void> {
  await client.query(
    `UPDATE public.operating_authorities
        SET record_status = $2, archived_at = CASE WHEN $2 = 'archived' THEN now() ELSE NULL END, updated_at = now()
      WHERE id = $1`,
    [authorityId, status],
  )
}

export async function listAuthorities(client: Queryable, organizationId: string): Promise<AuthorityRecord[]> {
  const result = await client.query<AuthorityRow>(
    `SELECT ${AUTHORITY_COLUMNS} FROM public.operating_authorities WHERE organization_id = $1 ORDER BY kind, created_at, id`,
    [organizationId],
  )
  return result.rows.map(toAuthority)
}

// --- versions -----------------------------------------------------------------------------------------------------

export async function insertVersion(
  client: Queryable,
  values: {
    id: string
    authorityId: string
    organizationId: string
    kind: AuthorityKind
    numberDisplay: string
    numberNormalized: string
    normalizationRuleVersion: string
    jurisdictionCountry: string
    jurisdictionRegion: string | null
    issuedOn: string | null
    expiresOn: string | null
    versionReason: VersionRecord["versionReason"]
    effectiveFrom: string
  },
): Promise<VersionRecord> {
  const result = await client.query<VersionRow>(
    `INSERT INTO public.operating_authority_versions
       (id, authority_id, organization_id, kind, number_display, number_normalized, normalization_rule_version,
        jurisdiction_country, jurisdiction_region, issued_on, expires_on, version_reason, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12, $13::timestamptz)
     RETURNING ${VERSION_COLUMNS}`,
    [
      values.id,
      values.authorityId,
      values.organizationId,
      values.kind,
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

export async function getCurrentVersion(client: Queryable, authorityId: string, lock = false): Promise<VersionRecord | undefined> {
  const result = await client.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM public.operating_authority_versions
      WHERE authority_id = $1 AND record_status = 'active' AND effective_to IS NULL${lock ? " FOR UPDATE" : ""}`,
    [authorityId],
  )
  return result.rows[0] ? toVersion(result.rows[0]) : undefined
}

/** A real-world change: the version was true until `effectiveTo`. */
export async function endVersion(client: Queryable, versionId: string, effectiveTo: string): Promise<void> {
  await client.query(
    `UPDATE public.operating_authority_versions SET effective_to = $2::timestamptz, updated_at = now()
      WHERE id = $1 AND record_status = 'active' AND effective_to IS NULL`,
    [versionId, effectiveTo],
  )
}

/** A correction: the version was wrongly recorded. It is kept, flagged, NOT ended, and pointed at its replacement. */
export async function markVersionCorrected(client: Queryable, versionId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.operating_authority_versions
        SET record_status = 'corrected', corrected_at = now(), superseded_by_version_id = $2, updated_at = now()
      WHERE id = $1 AND record_status = 'active'`,
    [versionId, replacementId],
  )
}

export async function listVersions(client: Queryable, authorityIds: string[]): Promise<Map<string, VersionRecord[]>> {
  const map = new Map<string, VersionRecord[]>()
  if (authorityIds.length === 0) return map
  const result = await client.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM public.operating_authority_versions
      WHERE authority_id = ANY($1::uuid[]) ORDER BY authority_id, effective_from, created_at, id`,
    [authorityIds],
  )
  for (const row of result.rows) {
    const list = map.get(row.authority_id) ?? []
    list.push(toVersion(row))
    map.set(row.authority_id, list)
  }
  return map
}

// --- status periods -----------------------------------------------------------------------------------------------

export async function insertStatusPeriod(
  client: Queryable,
  values: {
    id: string
    authorityId: string
    authorityStatus: AuthorityStatus
    periodReason: StatusPeriodRecord["periodReason"]
    effectiveFrom: string
  },
): Promise<StatusPeriodRecord> {
  const result = await client.query<PeriodRow>(
    `INSERT INTO public.operating_authority_status_periods (id, authority_id, authority_status, period_reason, effective_from)
     VALUES ($1, $2, $3, $4, $5::timestamptz)
     RETURNING ${PERIOD_COLUMNS}`,
    [values.id, values.authorityId, values.authorityStatus, values.periodReason, values.effectiveFrom],
  )
  return toPeriod(result.rows[0])
}

export async function getCurrentStatusPeriod(client: Queryable, authorityId: string, lock = false): Promise<StatusPeriodRecord | undefined> {
  const result = await client.query<PeriodRow>(
    `SELECT ${PERIOD_COLUMNS} FROM public.operating_authority_status_periods
      WHERE authority_id = $1 AND record_status = 'active' AND effective_to IS NULL${lock ? " FOR UPDATE" : ""}`,
    [authorityId],
  )
  return result.rows[0] ? toPeriod(result.rows[0]) : undefined
}

export async function endStatusPeriod(client: Queryable, periodId: string, effectiveTo: string): Promise<void> {
  await client.query(
    `UPDATE public.operating_authority_status_periods SET effective_to = $2::timestamptz, updated_at = now()
      WHERE id = $1 AND record_status = 'active' AND effective_to IS NULL`,
    [periodId, effectiveTo],
  )
}

export async function markStatusPeriodCorrected(client: Queryable, periodId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.operating_authority_status_periods
        SET record_status = 'corrected', corrected_at = now(), superseded_by_period_id = $2, updated_at = now()
      WHERE id = $1 AND record_status = 'active'`,
    [periodId, replacementId],
  )
}

export async function listStatusPeriods(client: Queryable, authorityIds: string[]): Promise<Map<string, StatusPeriodRecord[]>> {
  const map = new Map<string, StatusPeriodRecord[]>()
  if (authorityIds.length === 0) return map
  const result = await client.query<PeriodRow>(
    `SELECT ${PERIOD_COLUMNS} FROM public.operating_authority_status_periods
      WHERE authority_id = ANY($1::uuid[]) ORDER BY authority_id, effective_from, created_at, id`,
    [authorityIds],
  )
  for (const row of result.rows) {
    const list = map.get(row.authority_id) ?? []
    list.push(toPeriod(row))
    map.set(row.authority_id, list)
  }
  return map
}

// --- identity / collision -----------------------------------------------------------------------------------------

/** Mirrors the identity index expression: the current version this Organization already holds for the same identity. */
export async function findCurrentIdentityHolder(
  client: Queryable,
  organizationId: string,
  kind: AuthorityKind,
  identityIncludesJurisdiction: boolean,
  jurisdictionCountry: string,
  jurisdictionRegion: string | null,
): Promise<{ authorityId: string; versionId: string } | undefined> {
  const result = await client.query<{ authority_id: string; id: string }>(
    `SELECT authority_id, id FROM public.operating_authority_versions
      WHERE organization_id = $1 AND kind = $2 AND record_status = 'active' AND effective_to IS NULL
        AND ($3::boolean = false OR (jurisdiction_country = $4 AND jurisdiction_region IS NOT DISTINCT FROM $5::text))
      LIMIT 1`,
    [organizationId, kind, identityIncludesJurisdiction, jurisdictionCountry, jurisdictionRegion],
  )
  const row = result.rows[0]
  return row ? { authorityId: row.authority_id, versionId: row.id } : undefined
}

/** The CURRENT version holding this number in this namespace, with enough detail to disclose to a registry reader. */
export async function findCurrentNumberHolder(
  client: Queryable,
  kind: AuthorityKind,
  jurisdictionCountry: string,
  jurisdictionRegion: string | null,
  numberNormalized: string,
): Promise<NumberCollisionMatch | undefined> {
  const result = await client.query<{
    organization_id: string
    legal_name: string
    authority_id: string
    version_id: string
    record_status: "active" | "archived"
    authority_status: string | null
  }>(
    `SELECT v.organization_id, o.legal_name, v.authority_id, v.id AS version_id, a.record_status,
            (SELECT p.authority_status FROM public.operating_authority_status_periods p
              WHERE p.authority_id = a.id AND p.record_status = 'active' AND p.effective_to IS NULL) AS authority_status
       FROM public.operating_authority_versions v
       JOIN public.operating_authorities a ON a.id = v.authority_id
       JOIN public.organizations o ON o.id = v.organization_id
      WHERE v.kind = $1 AND v.jurisdiction_country = $2 AND v.jurisdiction_region IS NOT DISTINCT FROM $3::text
        AND v.number_normalized = $4 AND v.record_status = 'active' AND v.effective_to IS NULL
      LIMIT 1`,
    [kind, jurisdictionCountry, jurisdictionRegion, numberNormalized],
  )
  const row = result.rows[0]
  if (!row) return undefined
  return {
    organizationId: row.organization_id,
    organizationLegalName: row.legal_name,
    authorityId: row.authority_id,
    versionId: row.version_id,
    authorityRecordStatus: row.record_status,
    authorityStatus: row.authority_status,
    recommendedAction: row.record_status === "archived" ? "RESTORE_ARCHIVED" : "OPEN_EXISTING",
  }
}

/** Ended or corrected versions with the same number in the same namespace: review evidence, never a blocker. */
export async function findNumberReviewMatches(
  client: Queryable,
  kind: AuthorityKind,
  jurisdictionCountry: string,
  jurisdictionRegion: string | null,
  numberNormalized: string,
  excludeAuthorityId: string | null,
): Promise<ReviewMatch[]> {
  const result = await client.query<{
    organization_id: string
    legal_name: string
    authority_id: string
    record_status: "active" | "corrected"
  }>(
    `SELECT DISTINCT v.organization_id, o.legal_name, v.authority_id, v.record_status
       FROM public.operating_authority_versions v
       JOIN public.organizations o ON o.id = v.organization_id
      WHERE v.kind = $1 AND v.jurisdiction_country = $2 AND v.jurisdiction_region IS NOT DISTINCT FROM $3::text
        AND v.number_normalized = $4 AND NOT (v.record_status = 'active' AND v.effective_to IS NULL)
        AND ($5::uuid IS NULL OR v.authority_id <> $5::uuid)`,
    [kind, jurisdictionCountry, jurisdictionRegion, numberNormalized, excludeAuthorityId],
  )
  return result.rows.map((row) => ({
    kind: "ENDED_OR_CORRECTED_NUMBER" as const,
    organizationId: row.organization_id,
    organizationLegalName: row.legal_name,
    authorityId: row.authority_id,
    versionRecordStatus: row.record_status,
  }))
}
