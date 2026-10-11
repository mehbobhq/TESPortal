/**
 * Customer Relationship repository: SQL only, on a caller-supplied transaction client.
 *
 * No authorization, validation or Master Register logic lives here. Every function takes the client the authorization
 * wrapper checked out, so authorization and persistence share one connection and one transaction. Nothing here issues
 * DELETE (the runtime role has none).
 *
 * Business time is passed and returned as text with microsecond precision, because a JS Date would truncate to
 * milliseconds and could reorder two writes made within the same millisecond.
 *
 * Lock order (used by every operation): Organization row, then the Engagement row, then dependent rows. Customers rows are
 * immutable and the runtime role cannot row-lock them; the Organization lock serializes everything about its Customer.
 */

import type { PoolClient } from "pg"
import type { EngagementEndReason, EngagementStage, EngagementType, ProductLevel } from "@/lib/customer-relationship/definitions"
import type {
  AgreementRecord,
  AgreementVersionRecord,
  ChangeReason,
  CustomerRecord,
  EngagementRecord,
  RecordStatus,
  ResponsibilityRecord,
  ScopeRecord,
  StageRecord,
  TerminationRecord,
} from "@/lib/customer-relationship/types"

export type Queryable = Pick<PoolClient, "query">

// Constraint / trigger-constraint names the operations translate into domain errors.
export const ONE_OPEN_ENGAGEMENT_CONSTRAINT = "customer_engagements_one_open_uq"
export const ONE_CUSTOMER_PER_ORGANIZATION_CONSTRAINT = "customers_organization_id_key"
export const ENGAGEMENT_NO_OVERLAP_CONSTRAINT = "customer_engagements_no_overlap"
export const ENGAGEMENT_ORGANIZATION_ACTIVE_CONSTRAINT = "customer_engagements_organization_active"
export const ENGAGEMENT_ENDED_FINAL_CONSTRAINT = "customer_engagements_ended_is_final"
export const CURRENT_TERMINATION_CONSTRAINT = "customer_engagement_terminations_current_uq"
export const TERMINATION_AFTER_START_CONSTRAINT = "customer_engagement_terminations_after_start"
export const CURRENT_STAGE_CONSTRAINT = "customer_engagement_stages_current_uq"
export const STAGE_NO_OVERLAP_CONSTRAINT = "customer_engagement_stages_no_overlap"
export const STAGE_RULES_CONSTRAINT = "customer_engagement_stages_stage_rules"
export const STAGE_WINDOW_CONSTRAINT = "customer_engagement_stages_engagement_window"
export const CURRENT_SCOPE_CONSTRAINT = "engagement_service_scopes_current_uq"
export const SCOPE_NO_OVERLAP_CONSTRAINT = "engagement_service_scopes_no_overlap"
export const SCOPE_WINDOW_CONSTRAINT = "engagement_service_scopes_engagement_window"
export const SCOPE_CATALOGUE_CONSTRAINTS = ["engagement_service_scopes_catalogue_rules", "engagement_service_scopes_service_fk"] as const
export const SCOPE_AGREEMENT_CONSTRAINT = "engagement_service_scopes_agreement_rules"
export const SCOPE_DEPENDENTS_CONSTRAINTS = ["engagement_service_scopes_dependents_block_change", "engagement_service_scopes_dependents_block_end"] as const
export const CURRENT_RESPONSIBILITY_CONSTRAINT = "engagement_responsibility_periods_current_uq"
export const RESPONSIBILITY_NO_OVERLAP_CONSTRAINT = "engagement_responsibility_periods_no_overlap"
export const RESPONSIBILITY_WINDOW_CONSTRAINT = "engagement_responsibility_periods_scope_window"
export const CURRENT_AGREEMENT_VERSION_CONSTRAINT = "customer_agreement_versions_current_uq"
export const AGREEMENT_VERSION_NO_OVERLAP_CONSTRAINT = "customer_agreement_versions_no_overlap"
export const AGREEMENT_ACTIVE_CONSTRAINT = "customer_agreement_versions_agreement_active"
export const AGREEMENT_ARCHIVE_BLOCKED_CONSTRAINT = "customer_agreements_archive_requires_no_current_version"
export const CONSISTENCY_CONSTRAINTS = [
  "engagement_consistency_current_stage",
  "engagement_consistency_stage_history",
  "engagement_consistency_termination",
  "engagement_consistency_dependents",
  "engagement_consistency_termination_record",
  "customer_engagements_engagement_type_required",
  "customer_agreements_require_version",
] as const
export const WINDOW_CONSTRAINTS = [
  "customer_engagement_stages_effective_window_valid",
  "customer_engagement_stages_planned_end_after_start",
  "engagement_service_scopes_effective_window_valid",
  "engagement_responsibility_periods_effective_window_valid",
  "customer_agreement_versions_effective_window_valid",
  "customer_engagements_ended_after_start",
  "customer_engagement_terminations_after_start",
] as const

export type PeriodTable =
  | "customer_engagement_stages"
  | "engagement_service_scopes"
  | "engagement_responsibility_periods"
  | "customer_agreement_versions"

const MICRO_ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const MICRO_ISO_NULL = (column: string) => `CASE WHEN ${column} IS NULL THEN NULL ELSE ${MICRO_ISO(column)} END`

export async function databaseNow(client: Queryable): Promise<string> {
  const result = await client.query<{ now: string }>(`SELECT ${MICRO_ISO("clock_timestamp()")} AS now`)
  return result.rows[0].now
}

export async function isNotInFuture(client: Queryable, instant: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(`SELECT $1::timestamptz <= clock_timestamp() AS ok`, [instant])
  return result.rows[0].ok
}

// --- organizations and customers ------------------------------------------------------------------------------------

/** Row-locks the Organization so every writer of its Customer relationship serializes (lock order step 1). */
export async function lockOrganization(
  client: Queryable,
  organizationId: string,
): Promise<{ id: string; status: "active" | "archived" | "merged" } | undefined> {
  const result = await client.query<{ id: string; status: "active" | "archived" | "merged" }>(
    `SELECT id, status FROM public.organizations WHERE id = $1 FOR UPDATE`,
    [organizationId],
  )
  return result.rows[0]
}

const CUSTOMER_COLUMNS = `id, organization_id, ${MICRO_ISO("created_at")} AS created_at`

type CustomerRow = { id: string; organization_id: string; created_at: string }
const toCustomer = (row: CustomerRow): CustomerRecord => ({ id: row.id, organizationId: row.organization_id, createdAt: row.created_at })

export async function getCustomerByOrganization(client: Queryable, organizationId: string): Promise<CustomerRecord | undefined> {
  const result = await client.query<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM public.customers WHERE organization_id = $1`, [organizationId])
  return result.rows[0] ? toCustomer(result.rows[0]) : undefined
}

export async function getCustomer(client: Queryable, customerId: string): Promise<CustomerRecord | undefined> {
  const result = await client.query<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM public.customers WHERE id = $1`, [customerId])
  return result.rows[0] ? toCustomer(result.rows[0]) : undefined
}

export async function insertCustomer(client: Queryable, organizationId: string): Promise<CustomerRecord> {
  const result = await client.query<CustomerRow>(`INSERT INTO public.customers (organization_id) VALUES ($1) RETURNING ${CUSTOMER_COLUMNS}`, [organizationId])
  return toCustomer(result.rows[0])
}

// --- engagements ----------------------------------------------------------------------------------------------------

const ENGAGEMENT_COLUMNS = `id, customer_id, engagement_type, ${MICRO_ISO("started_at")} AS started_at, ${MICRO_ISO_NULL("ended_at")} AS ended_at, end_reason_code`

type EngagementRow = { id: string; customer_id: string; engagement_type: EngagementType; started_at: string; ended_at: string | null; end_reason_code: EngagementEndReason | null }
const toEngagement = (row: EngagementRow): EngagementRecord => ({
  id: row.id,
  customerId: row.customer_id,
  engagementType: row.engagement_type,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  endReason: row.end_reason_code,
})

/** Resolves an Engagement to its Organization without locking (used to find the Organization to lock first). */
export async function findEngagementOrganization(client: Queryable, engagementId: string): Promise<string | undefined> {
  const result = await client.query<{ organization_id: string }>(
    `SELECT c.organization_id FROM public.customer_engagements e JOIN public.customers c ON c.id = e.customer_id WHERE e.id = $1`,
    [engagementId],
  )
  return result.rows[0]?.organization_id
}

export async function getEngagement(client: Queryable, engagementId: string, lock = false): Promise<EngagementRecord | undefined> {
  const result = await client.query<EngagementRow>(
    `SELECT ${ENGAGEMENT_COLUMNS} FROM public.customer_engagements WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`,
    [engagementId],
  )
  return result.rows[0] ? toEngagement(result.rows[0]) : undefined
}

export async function listEngagements(client: Queryable, customerId: string): Promise<EngagementRecord[]> {
  const result = await client.query<EngagementRow>(
    `SELECT ${ENGAGEMENT_COLUMNS} FROM public.customer_engagements WHERE customer_id = $1 ORDER BY started_at, id`,
    [customerId],
  )
  return result.rows.map(toEngagement)
}

export async function getOpenEngagement(client: Queryable, customerId: string, lock = false): Promise<EngagementRecord | undefined> {
  const result = await client.query<EngagementRow>(
    `SELECT ${ENGAGEMENT_COLUMNS} FROM public.customer_engagements WHERE customer_id = $1 AND ended_at IS NULL${lock ? " FOR NO KEY UPDATE" : ""}`,
    [customerId],
  )
  return result.rows[0] ? toEngagement(result.rows[0]) : undefined
}

export async function latestEngagementEnd(client: Queryable, customerId: string): Promise<string | null> {
  const result = await client.query<{ ended_at: string | null }>(
    `SELECT ${MICRO_ISO_NULL("max(ended_at)")} AS ended_at FROM public.customer_engagements WHERE customer_id = $1`,
    [customerId],
  )
  return result.rows[0].ended_at
}

export async function insertEngagement(client: Queryable, input: { customerId: string; engagementType: EngagementType; startedAt: string }): Promise<EngagementRecord> {
  const result = await client.query<EngagementRow>(
    `INSERT INTO public.customer_engagements (customer_id, engagement_type, started_at) VALUES ($1, $2, $3::timestamptz) RETURNING ${ENGAGEMENT_COLUMNS}`,
    [input.customerId, input.engagementType, input.startedAt],
  )
  return toEngagement(result.rows[0])
}

/** Records (or, for an ended Engagement, CORRECTS) the canonical termination columns. Reopening is impossible: no NULL is ever written. */
export async function setEngagementEnd(client: Queryable, engagementId: string, endedAt: string, endReason: EngagementEndReason): Promise<void> {
  await client.query(
    `UPDATE public.customer_engagements SET ended_at = $2::timestamptz, end_reason_code = $3, updated_at = clock_timestamp() WHERE id = $1`,
    [engagementId, endedAt, endReason],
  )
}

// --- termination audit trail ----------------------------------------------------------------------------------------

const TERMINATION_COLUMNS = `id, engagement_id, ${MICRO_ISO("ended_at")} AS ended_at, end_reason_code, change_reason, record_status, ${MICRO_ISO_NULL("corrected_at")} AS corrected_at, superseded_by_id`
type TerminationRow = {
  id: string
  engagement_id: string
  ended_at: string
  end_reason_code: EngagementEndReason
  change_reason: "INITIAL" | "CORRECTION"
  record_status: "active" | "corrected"
  corrected_at: string | null
  superseded_by_id: string | null
}
const toTermination = (row: TerminationRow): TerminationRecord => ({
  id: row.id,
  engagementId: row.engagement_id,
  endedAt: row.ended_at,
  endReason: row.end_reason_code,
  changeReason: row.change_reason,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededById: row.superseded_by_id,
})

export async function getActiveTermination(client: Queryable, engagementId: string, lock = false): Promise<TerminationRecord | undefined> {
  const result = await client.query<TerminationRow>(
    `SELECT ${TERMINATION_COLUMNS} FROM public.customer_engagement_terminations WHERE engagement_id = $1 AND record_status = 'active'${lock ? " FOR NO KEY UPDATE" : ""}`,
    [engagementId],
  )
  return result.rows[0] ? toTermination(result.rows[0]) : undefined
}

export async function listTerminations(client: Queryable, engagementIds: string[]): Promise<Map<string, TerminationRecord[]>> {
  const grouped = new Map<string, TerminationRecord[]>()
  if (engagementIds.length === 0) return grouped
  const result = await client.query<TerminationRow>(
    `SELECT ${TERMINATION_COLUMNS} FROM public.customer_engagement_terminations WHERE engagement_id = ANY($1::uuid[]) ORDER BY created_at, id`,
    [engagementIds],
  )
  for (const row of result.rows) grouped.set(row.engagement_id, [...(grouped.get(row.engagement_id) ?? []), toTermination(row)])
  return grouped
}

export async function insertTermination(
  client: Queryable,
  input: { id: string; engagementId: string; endedAt: string; endReason: EngagementEndReason; changeReason: "INITIAL" | "CORRECTION" },
): Promise<void> {
  await client.query(
    `INSERT INTO public.customer_engagement_terminations (id, engagement_id, ended_at, end_reason_code, change_reason)
     VALUES ($1, $2, $3::timestamptz, $4, $5)`,
    [input.id, input.engagementId, input.endedAt, input.endReason, input.changeReason],
  )
}

/** Supersedes a termination record with its correction (the old record is kept, flagged and frozen). */
export async function supersedeTermination(client: Queryable, id: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.customer_engagement_terminations SET record_status = 'corrected', corrected_at = clock_timestamp(), superseded_by_id = $2, updated_at = clock_timestamp() WHERE id = $1`,
    [id, replacementId],
  )
}

// --- stages ---------------------------------------------------------------------------------------------------------

const PERIOD_COLUMNS = `${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO_NULL("effective_to")} AS effective_to, record_status, ${MICRO_ISO_NULL("corrected_at")} AS corrected_at, superseded_by_id`

type PeriodRow = { effective_from: string; effective_to: string | null; record_status: RecordStatus; corrected_at: string | null; superseded_by_id: string | null }
const toPeriod = (row: PeriodRow) => ({
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededById: row.superseded_by_id,
})

const STAGE_COLUMNS = `id, engagement_id, stage_code, ${MICRO_ISO_NULL("planned_end_at")} AS planned_end_at, change_reason, ${PERIOD_COLUMNS}`
type StageRow = PeriodRow & { id: string; engagement_id: string; stage_code: EngagementStage; planned_end_at: string | null; change_reason: ChangeReason }
const toStage = (row: StageRow): StageRecord => ({
  id: row.id,
  engagementId: row.engagement_id,
  stage: row.stage_code,
  plannedEndAt: row.planned_end_at,
  changeReason: row.change_reason,
  ...toPeriod(row),
})

export async function getStage(client: Queryable, stageId: string, lock = false): Promise<StageRecord | undefined> {
  const result = await client.query<StageRow>(`SELECT ${STAGE_COLUMNS} FROM public.customer_engagement_stages WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [stageId])
  return result.rows[0] ? toStage(result.rows[0]) : undefined
}

export async function getCurrentStage(client: Queryable, engagementId: string, lock = false): Promise<StageRecord | undefined> {
  const result = await client.query<StageRow>(
    `SELECT ${STAGE_COLUMNS} FROM public.customer_engagement_stages WHERE engagement_id = $1 AND record_status = 'active' AND effective_to IS NULL${lock ? " FOR NO KEY UPDATE" : ""}`,
    [engagementId],
  )
  return result.rows[0] ? toStage(result.rows[0]) : undefined
}

export async function listStages(client: Queryable, engagementIds: string[]): Promise<Map<string, StageRecord[]>> {
  const grouped = new Map<string, StageRecord[]>()
  if (engagementIds.length === 0) return grouped
  const result = await client.query<StageRow>(
    `SELECT ${STAGE_COLUMNS} FROM public.customer_engagement_stages WHERE engagement_id = ANY($1::uuid[]) ORDER BY effective_from, created_at, id`,
    [engagementIds],
  )
  for (const row of result.rows) grouped.set(row.engagement_id, [...(grouped.get(row.engagement_id) ?? []), toStage(row)])
  return grouped
}

export async function insertStage(
  client: Queryable,
  input: { id: string; engagementId: string; stage: EngagementStage; plannedEndAt: string | null; changeReason: ChangeReason; effectiveFrom: string; effectiveTo: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO public.customer_engagement_stages (id, engagement_id, stage_code, planned_end_at, change_reason, effective_from, effective_to)
     VALUES ($1, $2, $3, $4::timestamptz, $5, $6::timestamptz, $7::timestamptz)`,
    [input.id, input.engagementId, input.stage, input.plannedEndAt, input.changeReason, input.effectiveFrom, input.effectiveTo],
  )
}

// --- scopes ---------------------------------------------------------------------------------------------------------

const SCOPE_COLUMNS = `id, engagement_id, product_level_code, service_code, agreement_id, change_reason, ${PERIOD_COLUMNS}`
type ScopeRow = PeriodRow & { id: string; engagement_id: string; product_level_code: ProductLevel; service_code: string | null; agreement_id: string | null; change_reason: ChangeReason }
const toScope = (row: ScopeRow): ScopeRecord => ({
  id: row.id,
  engagementId: row.engagement_id,
  productLevel: row.product_level_code,
  serviceCode: row.service_code,
  agreementId: row.agreement_id,
  changeReason: row.change_reason,
  ...toPeriod(row),
})

export async function getScope(client: Queryable, scopeId: string, lock = false): Promise<ScopeRecord | undefined> {
  const result = await client.query<ScopeRow>(`SELECT ${SCOPE_COLUMNS} FROM public.engagement_service_scopes WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [scopeId])
  return result.rows[0] ? toScope(result.rows[0]) : undefined
}

export async function listScopes(client: Queryable, engagementIds: string[]): Promise<Map<string, ScopeRecord[]>> {
  const grouped = new Map<string, ScopeRecord[]>()
  if (engagementIds.length === 0) return grouped
  const result = await client.query<ScopeRow>(
    `SELECT ${SCOPE_COLUMNS} FROM public.engagement_service_scopes WHERE engagement_id = ANY($1::uuid[]) ORDER BY effective_from, created_at, id`,
    [engagementIds],
  )
  for (const row of result.rows) grouped.set(row.engagement_id, [...(grouped.get(row.engagement_id) ?? []), toScope(row)])
  return grouped
}

export async function listOpenScopeIds(client: Queryable, engagementId: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM public.engagement_service_scopes WHERE engagement_id = $1 AND record_status = 'active' AND effective_to IS NULL ORDER BY id`,
    [engagementId],
  )
  return result.rows.map((row) => row.id)
}

export async function insertScope(
  client: Queryable,
  input: { id: string; engagementId: string; productLevel: ProductLevel; serviceCode: string | null; agreementId: string | null; changeReason: ChangeReason; effectiveFrom: string; effectiveTo: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO public.engagement_service_scopes (id, engagement_id, product_level_code, service_code, agreement_id, change_reason, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)`,
    [input.id, input.engagementId, input.productLevel, input.serviceCode, input.agreementId, input.changeReason, input.effectiveFrom, input.effectiveTo],
  )
}

// --- responsibility -------------------------------------------------------------------------------------------------

const RESPONSIBILITY_COLUMNS = `id, engagement_id, scope_id, change_reason, ${PERIOD_COLUMNS}`
type ResponsibilityRow = PeriodRow & { id: string; engagement_id: string; scope_id: string; change_reason: ChangeReason }
const toResponsibility = (row: ResponsibilityRow): ResponsibilityRecord => ({
  id: row.id,
  engagementId: row.engagement_id,
  scopeId: row.scope_id,
  changeReason: row.change_reason,
  ...toPeriod(row),
})

export async function getResponsibility(client: Queryable, responsibilityId: string, lock = false): Promise<ResponsibilityRecord | undefined> {
  const result = await client.query<ResponsibilityRow>(`SELECT ${RESPONSIBILITY_COLUMNS} FROM public.engagement_responsibility_periods WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [responsibilityId])
  return result.rows[0] ? toResponsibility(result.rows[0]) : undefined
}

export async function listResponsibilities(client: Queryable, engagementIds: string[]): Promise<Map<string, ResponsibilityRecord[]>> {
  const grouped = new Map<string, ResponsibilityRecord[]>()
  if (engagementIds.length === 0) return grouped
  const result = await client.query<ResponsibilityRow>(
    `SELECT ${RESPONSIBILITY_COLUMNS} FROM public.engagement_responsibility_periods WHERE engagement_id = ANY($1::uuid[]) ORDER BY effective_from, created_at, id`,
    [engagementIds],
  )
  for (const row of result.rows) grouped.set(row.engagement_id, [...(grouped.get(row.engagement_id) ?? []), toResponsibility(row)])
  return grouped
}

export async function listOpenResponsibilityIds(client: Queryable, input: { engagementId: string; scopeId?: string }): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM public.engagement_responsibility_periods
      WHERE engagement_id = $1 AND ($2::uuid IS NULL OR scope_id = $2) AND record_status = 'active' AND effective_to IS NULL ORDER BY id`,
    [input.engagementId, input.scopeId ?? null],
  )
  return result.rows.map((row) => row.id)
}

export async function insertResponsibility(
  client: Queryable,
  input: { id: string; engagementId: string; scopeId: string; changeReason: ChangeReason; effectiveFrom: string; effectiveTo: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO public.engagement_responsibility_periods (id, engagement_id, scope_id, change_reason, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
    [input.id, input.engagementId, input.scopeId, input.changeReason, input.effectiveFrom, input.effectiveTo],
  )
}

/** Latest start of any genuine (active) row among an Engagement's scopes and responsibility windows, and the latest end. */
export async function dependentBounds(client: Queryable, engagementId: string): Promise<{ latestStart: string | null; latestBoundedEnd: string | null }> {
  const result = await client.query<{ latest_start: string | null; latest_end: string | null }>(
    `SELECT ${MICRO_ISO_NULL("max(effective_from)")} AS latest_start, ${MICRO_ISO_NULL("max(effective_to)")} AS latest_end
       FROM (
         SELECT effective_from, effective_to FROM public.engagement_service_scopes WHERE engagement_id = $1 AND record_status = 'active'
         UNION ALL
         SELECT effective_from, effective_to FROM public.engagement_responsibility_periods WHERE engagement_id = $1 AND record_status = 'active'
       ) AS d`,
    [engagementId],
  )
  return { latestStart: result.rows[0].latest_start, latestBoundedEnd: result.rows[0].latest_end }
}

// --- agreements -----------------------------------------------------------------------------------------------------

const VERSION_COLUMNS = `id, agreement_id, agreement_reference, signed_on::text AS signed_on, change_reason, ${PERIOD_COLUMNS}`
type VersionRow = PeriodRow & { id: string; agreement_id: string; agreement_reference: string | null; signed_on: string | null; change_reason: ChangeReason }
const toVersion = (row: VersionRow): AgreementVersionRecord => ({
  id: row.id,
  agreementId: row.agreement_id,
  agreementReference: row.agreement_reference,
  signedOn: row.signed_on,
  changeReason: row.change_reason,
  ...toPeriod(row),
})

type AgreementRow = { id: string; customer_id: string; record_status: "active" | "archived"; archived_at: string | null }
const AGREEMENT_COLUMNS = `id, customer_id, record_status, ${MICRO_ISO_NULL("archived_at")} AS archived_at`

export async function findAgreementOrganization(client: Queryable, agreementId: string): Promise<string | undefined> {
  const result = await client.query<{ organization_id: string }>(
    `SELECT c.organization_id FROM public.customer_agreements a JOIN public.customers c ON c.id = a.customer_id WHERE a.id = $1`,
    [agreementId],
  )
  return result.rows[0]?.organization_id
}

export async function findVersionAgreement(client: Queryable, versionId: string): Promise<string | undefined> {
  const result = await client.query<{ agreement_id: string }>(`SELECT agreement_id FROM public.customer_agreement_versions WHERE id = $1`, [versionId])
  return result.rows[0]?.agreement_id
}

export async function getAgreementRow(client: Queryable, agreementId: string, lock = false): Promise<Omit<AgreementRecord, "versions"> | undefined> {
  const result = await client.query<AgreementRow>(`SELECT ${AGREEMENT_COLUMNS} FROM public.customer_agreements WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [agreementId])
  const row = result.rows[0]
  return row ? { id: row.id, customerId: row.customer_id, recordStatus: row.record_status, archivedAt: row.archived_at } : undefined
}

export async function listAgreements(client: Queryable, customerId: string): Promise<AgreementRecord[]> {
  const agreements = await client.query<AgreementRow>(`SELECT ${AGREEMENT_COLUMNS} FROM public.customer_agreements WHERE customer_id = $1 ORDER BY created_at, id`, [customerId])
  const ids = agreements.rows.map((row) => row.id)
  const versions = ids.length
    ? await client.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM public.customer_agreement_versions WHERE agreement_id = ANY($1::uuid[]) ORDER BY effective_from, created_at, id`, [ids])
    : { rows: [] as VersionRow[] }
  return agreements.rows.map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    recordStatus: row.record_status,
    archivedAt: row.archived_at,
    versions: versions.rows.filter((version) => version.agreement_id === row.id).map(toVersion),
  }))
}

export async function getVersion(client: Queryable, versionId: string, lock = false): Promise<AgreementVersionRecord | undefined> {
  const result = await client.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM public.customer_agreement_versions WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [versionId])
  return result.rows[0] ? toVersion(result.rows[0]) : undefined
}

export async function getCurrentVersion(client: Queryable, agreementId: string, lock = false): Promise<AgreementVersionRecord | undefined> {
  const result = await client.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM public.customer_agreement_versions WHERE agreement_id = $1 AND record_status = 'active' AND effective_to IS NULL${lock ? " FOR NO KEY UPDATE" : ""}`,
    [agreementId],
  )
  return result.rows[0] ? toVersion(result.rows[0]) : undefined
}

export async function insertAgreement(client: Queryable, input: { id: string; customerId: string }): Promise<void> {
  await client.query(`INSERT INTO public.customer_agreements (id, customer_id) VALUES ($1, $2)`, [input.id, input.customerId])
}

export async function setAgreementArchived(client: Queryable, agreementId: string, archived: boolean): Promise<void> {
  await client.query(
    `UPDATE public.customer_agreements SET record_status = $2, archived_at = CASE WHEN $2 = 'archived' THEN clock_timestamp() ELSE NULL END, updated_at = clock_timestamp() WHERE id = $1`,
    [agreementId, archived ? "archived" : "active"],
  )
}

export async function insertVersion(
  client: Queryable,
  input: { id: string; agreementId: string; reference: string | null; signedOn: string | null; changeReason: ChangeReason; effectiveFrom: string; effectiveTo: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO public.customer_agreement_versions (id, agreement_id, agreement_reference, signed_on, change_reason, effective_from, effective_to)
     VALUES ($1, $2, $3, $4::date, $5, $6::timestamptz, $7::timestamptz)`,
    [input.id, input.agreementId, input.reference, input.signedOn, input.changeReason, input.effectiveFrom, input.effectiveTo],
  )
}

// --- generic lifecycle ----------------------------------------------------------------------------------------------

/** A REAL-WORLD end: sets effective_to on a genuine, open row. */
export async function endPeriod(client: Queryable, table: PeriodTable, id: string, at: string): Promise<void> {
  await client.query(`UPDATE public.${table} SET effective_to = $2::timestamptz, updated_at = clock_timestamp() WHERE id = $1`, [id, at])
}

/** A CORRECTION or VOID: flags the row (never ends it) and links the replacement, if any. */
export async function markPeriod(client: Queryable, table: PeriodTable, id: string, status: "corrected" | "voided", replacementId: string | null): Promise<void> {
  await client.query(
    `UPDATE public.${table} SET record_status = $2, corrected_at = clock_timestamp(), superseded_by_id = $3, updated_at = clock_timestamp() WHERE id = $1`,
    [id, status, replacementId],
  )
}
