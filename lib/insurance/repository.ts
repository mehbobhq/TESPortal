/**
 * Insurance repository: SQL only, on a caller-supplied transaction client.
 *
 * No authorization, validation or Master Register logic lives here. Every function takes the client the authorization
 * wrapper checked out, so authorization and persistence share one connection and one transaction. Nothing here issues
 * DELETE (the runtime role has none) and nothing here updates identity or content columns (the runtime role cannot).
 *
 * Business time is passed and returned as text: calendar dates as "YYYY-MM-DD", instants with microsecond precision and
 * money as two-decimal strings, because a JS Date or float would truncate or round.
 *
 * Lock order (used by every operation): the insured Organization row, then the policy row, then dependent rows (terms,
 * endorsements, coverages, broker periods).
 */

import type { PoolClient } from "pg"
import type { CancellationReason, CoverageType, Currency, EndorsementKind, InsuranceFamily, LimitBasis, TermReason } from "@/lib/insurance/definitions"
import type { PolicyNumberHolder } from "@/lib/insurance/errors"
import type { BrokerPeriodRecord, CoverageRecord, EndorsementRecord, PolicyRecord, TermRecord } from "@/lib/insurance/types"

export type Queryable = Pick<PoolClient, "query">

// Constraint / trigger-constraint names the operations translate into domain errors.
export const NUMBER_NAMESPACE_CONSTRAINT = "insurance_policy_terms_number_namespace"
export const TERM_NO_OVERLAP_CONSTRAINT = "insurance_policy_terms_no_overlap"
export const TERM_POLICY_ACTIVE_CONSTRAINT = "insurance_policy_terms_policy_active"
export const BROKER_POLICY_ACTIVE_CONSTRAINT = "insurance_broker_periods_policy_active"
export const BROKER_CONTACT_ACTIVE_CONSTRAINT = "insurance_broker_periods_contact_active"
export const CURRENT_BROKER_CONSTRAINT = "insurance_broker_periods_current_uq"
export const ENDORSEMENT_WINDOW_CONSTRAINT = "insurance_endorsements_inside_active_term"
export const ENDORSEMENT_NUMBER_CONSTRAINT = "insurance_endorsements_number_uq"
export const COVERAGE_WINDOW_CONSTRAINT = "insurance_coverages_inside_active_term"
export const COVERAGE_LIMIT_RULES_CONSTRAINT = "insurance_coverages_limit_rules"
export const COVERAGE_OVERLAP_CONSTRAINTS = ["insurance_coverages_no_overlap", "insurance_coverages_current_uq"] as const
export const ORGANIZATION_ACTIVE_CONSTRAINT = "organization_must_be_active"
export const REQUIRED_STATE_CONSTRAINTS = ["insurance_policies_require_active_term", "insurance_policy_terms_require_coverage"] as const
export const CHECK_CONSTRAINTS = [
  "insurance_policy_terms_period_valid",
  "insurance_policy_terms_expiry_required",
  "insurance_policy_terms_cancellation_within_term",
  "insurance_policy_terms_cancellation_reason_valid",
  "insurance_coverages_limit_positive",
  "insurance_coverages_deductible_non_negative",
  "insurance_coverages_currency_state_consistent",
  "insurance_coverages_currency_valid",
  "insurance_coverages_limit_basis_valid",
  "insurance_coverages_limit_basis_needs_limit",
  "insurance_coverages_period_valid",
  "insurance_broker_periods_effective_window_valid",
  "insurance_policies_insurer_differs_from_insured",
] as const

const MICRO_ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const MICRO_ISO_NULL = (column: string) => `CASE WHEN ${column} IS NULL THEN NULL ELSE ${MICRO_ISO(column)} END`
const DATE_NULL = (column: string) => `${column}::text`

export async function databaseNow(client: Queryable): Promise<string> {
  const result = await client.query<{ now: string }>(`SELECT ${MICRO_ISO("clock_timestamp()")} AS now`)
  return result.rows[0].now
}

export async function isNotInFuture(client: Queryable, instant: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(`SELECT $1::timestamptz <= clock_timestamp() AS ok`, [instant])
  return result.rows[0].ok
}

/** The database's calendar date (the one business-date rules are measured against). */
export async function databaseToday(client: Queryable): Promise<string> {
  const result = await client.query<{ today: string }>(`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS today`)
  return result.rows[0].today
}

export async function isDateNotInFuture(client: Queryable, date: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(`SELECT $1::date <= (clock_timestamp() AT TIME ZONE 'UTC')::date AS ok`, [date])
  return result.rows[0].ok
}

/** Savepoints let a unique violation from a concurrent writer become a domain result instead of an aborted transaction. */
export async function savepoint(client: Queryable, name: string): Promise<void> {
  await client.query(`SAVEPOINT ${name}`)
}
export async function releaseSavepoint(client: Queryable, name: string): Promise<void> {
  await client.query(`RELEASE SAVEPOINT ${name}`)
}
export async function rollbackToSavepoint(client: Queryable, name: string): Promise<void> {
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`)
}

// --- organizations --------------------------------------------------------------------------------------------------

type OrganizationStatus = "active" | "archived" | "merged"

/** Row-locks the insured Organization so every writer of its insurance serializes (lock order step 1). */
export async function lockOrganization(client: Queryable, organizationId: string): Promise<{ id: string; status: OrganizationStatus } | undefined> {
  const result = await client.query<{ id: string; status: OrganizationStatus }>(`SELECT id, status FROM public.organizations WHERE id = $1 FOR UPDATE`, [organizationId])
  return result.rows[0]
}

/** Reads an Organization without locking (insurers and brokerages are referenced, not changed). */
export async function getOrganization(client: Queryable, organizationId: string): Promise<{ id: string; status: OrganizationStatus; legalName: string } | undefined> {
  const result = await client.query<{ id: string; status: OrganizationStatus; legal_name: string }>(`SELECT id, status, legal_name FROM public.organizations WHERE id = $1`, [organizationId])
  const row = result.rows[0]
  return row ? { id: row.id, status: row.status, legalName: row.legal_name } : undefined
}

// --- policies -------------------------------------------------------------------------------------------------------

const POLICY_COLUMNS = `id, organization_id, insurer_organization_id, family, renews_policy_id, record_status, ${MICRO_ISO_NULL("archived_at")} AS archived_at, ${MICRO_ISO("created_at")} AS created_at`
type PolicyRow = {
  id: string
  organization_id: string
  insurer_organization_id: string
  family: InsuranceFamily
  renews_policy_id: string | null
  record_status: "active" | "archived"
  archived_at: string | null
  created_at: string
}
const toPolicy = (row: PolicyRow): PolicyRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  insurerOrganizationId: row.insurer_organization_id,
  family: row.family,
  renewsPolicyId: row.renews_policy_id,
  recordStatus: row.record_status,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
})

/** Resolves a policy to its insured Organization without locking (used to find the Organization to lock first). */
export async function findPolicyOrganization(client: Queryable, policyId: string): Promise<string | undefined> {
  const result = await client.query<{ organization_id: string }>(`SELECT organization_id FROM public.insurance_policies WHERE id = $1`, [policyId])
  return result.rows[0]?.organization_id
}
export async function findTermPolicy(client: Queryable, termId: string): Promise<string | undefined> {
  const result = await client.query<{ policy_id: string }>(`SELECT policy_id FROM public.insurance_policy_terms WHERE id = $1`, [termId])
  return result.rows[0]?.policy_id
}
export async function findEndorsementTerm(client: Queryable, endorsementId: string): Promise<string | undefined> {
  const result = await client.query<{ term_id: string }>(`SELECT term_id FROM public.insurance_endorsements WHERE id = $1`, [endorsementId])
  return result.rows[0]?.term_id
}
export async function findCoverageTerm(client: Queryable, coverageId: string): Promise<string | undefined> {
  const result = await client.query<{ term_id: string }>(`SELECT term_id FROM public.insurance_coverages WHERE id = $1`, [coverageId])
  return result.rows[0]?.term_id
}
export async function findBrokerPeriodPolicy(client: Queryable, periodId: string): Promise<string | undefined> {
  const result = await client.query<{ policy_id: string }>(`SELECT policy_id FROM public.insurance_broker_periods WHERE id = $1`, [periodId])
  return result.rows[0]?.policy_id
}

export async function getPolicy(client: Queryable, policyId: string, lock = false): Promise<PolicyRecord | undefined> {
  const result = await client.query<PolicyRow>(`SELECT ${POLICY_COLUMNS} FROM public.insurance_policies WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [policyId])
  return result.rows[0] ? toPolicy(result.rows[0]) : undefined
}

export async function listPolicies(client: Queryable, organizationId: string): Promise<PolicyRecord[]> {
  const result = await client.query<PolicyRow>(`SELECT ${POLICY_COLUMNS} FROM public.insurance_policies WHERE organization_id = $1 ORDER BY created_at, id`, [organizationId])
  return result.rows.map(toPolicy)
}

export async function insertPolicy(client: Queryable, input: { id: string; organizationId: string; insurerOrganizationId: string; family: InsuranceFamily; renewsPolicyId: string | null }): Promise<void> {
  await client.query(
    `INSERT INTO public.insurance_policies (id, organization_id, insurer_organization_id, family, renews_policy_id) VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.organizationId, input.insurerOrganizationId, input.family, input.renewsPolicyId],
  )
}

export async function setPolicyArchived(client: Queryable, policyId: string, archived: boolean): Promise<void> {
  await client.query(
    `UPDATE public.insurance_policies SET record_status = $2, archived_at = CASE WHEN $2 = 'archived' THEN clock_timestamp() ELSE NULL END, updated_at = clock_timestamp() WHERE id = $1`,
    [policyId, archived ? "archived" : "active"],
  )
}

// --- terms ----------------------------------------------------------------------------------------------------------

const TERM_COLUMNS = `id, policy_id, number_display, number_normalized, normalization_rule_version, ${DATE_NULL("term_start")} AS term_start, ${DATE_NULL("term_end")} AS term_end,
  ${DATE_NULL("cancelled_on")} AS cancelled_on, cancellation_reason, term_reason, record_status, ${MICRO_ISO_NULL("corrected_at")} AS corrected_at, superseded_by_term_id`
type TermRow = {
  id: string
  policy_id: string
  number_display: string
  number_normalized: string
  normalization_rule_version: string
  term_start: string
  term_end: string | null
  cancelled_on: string | null
  cancellation_reason: CancellationReason | null
  term_reason: TermReason
  record_status: "active" | "corrected"
  corrected_at: string | null
  superseded_by_term_id: string | null
}
const toTerm = (row: TermRow): TermRecord => ({
  id: row.id,
  policyId: row.policy_id,
  numberDisplay: row.number_display,
  numberNormalized: row.number_normalized,
  normalizationRuleVersion: row.normalization_rule_version,
  termStart: row.term_start,
  termEnd: row.term_end,
  cancelledOn: row.cancelled_on,
  cancellationReason: row.cancellation_reason,
  termReason: row.term_reason,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededById: row.superseded_by_term_id,
})

export async function getTerm(client: Queryable, termId: string, lock = false): Promise<TermRecord | undefined> {
  const result = await client.query<TermRow>(`SELECT ${TERM_COLUMNS} FROM public.insurance_policy_terms WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [termId])
  return result.rows[0] ? toTerm(result.rows[0]) : undefined
}

export async function listTerms(client: Queryable, policyIds: string[]): Promise<Map<string, TermRecord[]>> {
  const grouped = new Map<string, TermRecord[]>()
  if (policyIds.length === 0) return grouped
  const result = await client.query<TermRow>(
    `SELECT ${TERM_COLUMNS} FROM public.insurance_policy_terms WHERE policy_id = ANY($1::uuid[]) ORDER BY term_start, created_at, id`,
    [policyIds],
  )
  for (const row of result.rows) grouped.set(row.policy_id, [...(grouped.get(row.policy_id) ?? []), toTerm(row)])
  return grouped
}

/** The genuine (active) terms of one policy, earliest first, row-locked when `lock` is set. */
export async function listActiveTerms(client: Queryable, policyId: string, lock = false): Promise<TermRecord[]> {
  const result = await client.query<TermRow>(
    `SELECT ${TERM_COLUMNS} FROM public.insurance_policy_terms WHERE policy_id = $1 AND record_status = 'active' ORDER BY term_start, id${lock ? " FOR NO KEY UPDATE" : ""}`,
    [policyId],
  )
  return result.rows.map(toTerm)
}

export async function insertTerm(
  client: Queryable,
  input: {
    id: string
    policyId: string
    organizationId: string
    insurerOrganizationId: string
    family: InsuranceFamily
    numberDisplay: string
    numberNormalized: string
    ruleVersion: string
    termStart: string
    termEnd: string | null
    termReason: TermReason
  },
): Promise<void> {
  await client.query(
    `INSERT INTO public.insurance_policy_terms
       (id, policy_id, organization_id, insurer_organization_id, family, number_display, number_normalized, normalization_rule_version, term_start, term_end, term_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11)`,
    [input.id, input.policyId, input.organizationId, input.insurerOrganizationId, input.family, input.numberDisplay, input.numberNormalized, input.ruleVersion, input.termStart, input.termEnd, input.termReason],
  )
}

/** The one-way cancellation fact (NULL -> value). */
export async function setTermCancellation(client: Queryable, termId: string, cancelledOn: string, reason: CancellationReason): Promise<void> {
  await client.query(`UPDATE public.insurance_policy_terms SET cancelled_on = $2::date, cancellation_reason = $3, updated_at = clock_timestamp() WHERE id = $1`, [termId, cancelledOn, reason])
}

/** Supersedes a term with its correction (the old term is kept, flagged and frozen). */
export async function supersedeTerm(client: Queryable, termId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.insurance_policy_terms SET record_status = 'corrected', corrected_at = clock_timestamp(), superseded_by_term_id = $2, updated_at = clock_timestamp() WHERE id = $1`,
    [termId, replacementId],
  )
}

/** The active term holding this number in this insurer's namespace (other than `excludePolicyId`'s own terms). */
export async function findNumberHolder(client: Queryable, insurerOrganizationId: string, numberNormalized: string, excludePolicyId: string | null): Promise<PolicyNumberHolder | undefined> {
  const result = await client.query<{
    policy_id: string
    term_id: string
    organization_id: string
    legal_name: string
    family: string
    policy_record_status: "active" | "archived"
  }>(
    `SELECT t.policy_id, t.id AS term_id, p.organization_id, o.legal_name, p.family, p.record_status AS policy_record_status
       FROM public.insurance_policy_terms t
       JOIN public.insurance_policies p ON p.id = t.policy_id
       JOIN public.organizations o ON o.id = p.organization_id
      WHERE t.insurer_organization_id = $1 AND t.number_normalized = $2 AND t.record_status = 'active'
        AND ($3::uuid IS NULL OR t.policy_id <> $3::uuid)
      ORDER BY t.created_at, t.id
      LIMIT 1`,
    [insurerOrganizationId, numberNormalized, excludePolicyId],
  )
  const row = result.rows[0]
  if (!row) return undefined
  return {
    policyId: row.policy_id,
    termId: row.term_id,
    organizationId: row.organization_id,
    organizationLegalName: row.legal_name,
    family: row.family,
    policyRecordStatus: row.policy_record_status,
    recommendedAction: row.policy_record_status === "archived" ? "RESTORE_ARCHIVED" : "OPEN_EXISTING",
  }
}

// --- endorsements ---------------------------------------------------------------------------------------------------

const ENDORSEMENT_COLUMNS = `id, term_id, number_display, number_normalized, endorsement_kind, ${DATE_NULL("effective_on")} AS effective_on, record_status, ${MICRO_ISO_NULL("corrected_at")} AS corrected_at, superseded_by_endorsement_id`
type EndorsementRow = {
  id: string
  term_id: string
  number_display: string | null
  number_normalized: string | null
  endorsement_kind: EndorsementKind
  effective_on: string
  record_status: "active" | "corrected"
  corrected_at: string | null
  superseded_by_endorsement_id: string | null
}
const toEndorsement = (row: EndorsementRow): EndorsementRecord => ({
  id: row.id,
  termId: row.term_id,
  numberDisplay: row.number_display,
  numberNormalized: row.number_normalized,
  kind: row.endorsement_kind,
  effectiveOn: row.effective_on,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededById: row.superseded_by_endorsement_id,
})

export async function getEndorsement(client: Queryable, endorsementId: string, lock = false): Promise<EndorsementRecord | undefined> {
  const result = await client.query<EndorsementRow>(`SELECT ${ENDORSEMENT_COLUMNS} FROM public.insurance_endorsements WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [endorsementId])
  return result.rows[0] ? toEndorsement(result.rows[0]) : undefined
}

export async function listEndorsements(client: Queryable, termIds: string[]): Promise<Map<string, EndorsementRecord[]>> {
  const grouped = new Map<string, EndorsementRecord[]>()
  if (termIds.length === 0) return grouped
  const result = await client.query<EndorsementRow>(
    `SELECT ${ENDORSEMENT_COLUMNS} FROM public.insurance_endorsements WHERE term_id = ANY($1::uuid[]) ORDER BY effective_on, created_at, id`,
    [termIds],
  )
  for (const row of result.rows) grouped.set(row.term_id, [...(grouped.get(row.term_id) ?? []), toEndorsement(row)])
  return grouped
}

export async function listActiveEndorsements(client: Queryable, termId: string): Promise<EndorsementRecord[]> {
  const result = await client.query<EndorsementRow>(
    `SELECT ${ENDORSEMENT_COLUMNS} FROM public.insurance_endorsements WHERE term_id = $1 AND record_status = 'active' ORDER BY effective_on, created_at, id`,
    [termId],
  )
  return result.rows.map(toEndorsement)
}

export async function insertEndorsement(
  client: Queryable,
  input: { id: string; termId: string; policyId: string; organizationId: string; family: InsuranceFamily; numberDisplay: string | null; numberNormalized: string | null; kind: EndorsementKind; effectiveOn: string },
): Promise<void> {
  await client.query(
    `INSERT INTO public.insurance_endorsements (id, term_id, policy_id, organization_id, family, number_display, number_normalized, endorsement_kind, effective_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date)`,
    [input.id, input.termId, input.policyId, input.organizationId, input.family, input.numberDisplay, input.numberNormalized, input.kind, input.effectiveOn],
  )
}

export async function supersedeEndorsement(client: Queryable, endorsementId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.insurance_endorsements SET record_status = 'corrected', corrected_at = clock_timestamp(), superseded_by_endorsement_id = $2, updated_at = clock_timestamp() WHERE id = $1`,
    [endorsementId, replacementId],
  )
}

// --- coverages ------------------------------------------------------------------------------------------------------

const COVERAGE_COLUMNS = `id, term_id, coverage_type, limit_amount::text AS limit_amount, deductible_amount::text AS deductible_amount, currency, limit_basis, scheduled_vehicles_only,
  ${DATE_NULL("effective_from")} AS effective_from, ${DATE_NULL("effective_to")} AS effective_to, endorsement_id, ended_by_endorsement_id, record_status, ${MICRO_ISO_NULL("corrected_at")} AS corrected_at, superseded_by_coverage_id`
type CoverageRow = {
  id: string
  term_id: string
  coverage_type: CoverageType
  limit_amount: string | null
  deductible_amount: string | null
  currency: Currency | null
  limit_basis: LimitBasis | null
  scheduled_vehicles_only: boolean
  effective_from: string
  effective_to: string | null
  endorsement_id: string | null
  ended_by_endorsement_id: string | null
  record_status: "active" | "corrected"
  corrected_at: string | null
  superseded_by_coverage_id: string | null
}
const toCoverage = (row: CoverageRow): CoverageRecord => ({
  id: row.id,
  termId: row.term_id,
  coverageType: row.coverage_type,
  limitAmount: row.limit_amount,
  deductibleAmount: row.deductible_amount,
  currency: row.currency,
  limitBasis: row.limit_basis,
  scheduledVehiclesOnly: row.scheduled_vehicles_only,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  endorsementId: row.endorsement_id,
  endedByEndorsementId: row.ended_by_endorsement_id,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededById: row.superseded_by_coverage_id,
})

export async function getCoverage(client: Queryable, coverageId: string, lock = false): Promise<CoverageRecord | undefined> {
  const result = await client.query<CoverageRow>(`SELECT ${COVERAGE_COLUMNS} FROM public.insurance_coverages WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [coverageId])
  return result.rows[0] ? toCoverage(result.rows[0]) : undefined
}

export async function listCoverages(client: Queryable, termIds: string[]): Promise<Map<string, CoverageRecord[]>> {
  const grouped = new Map<string, CoverageRecord[]>()
  if (termIds.length === 0) return grouped
  const result = await client.query<CoverageRow>(
    `SELECT ${COVERAGE_COLUMNS} FROM public.insurance_coverages WHERE term_id = ANY($1::uuid[]) ORDER BY coverage_type, effective_from, created_at, id`,
    [termIds],
  )
  for (const row of result.rows) grouped.set(row.term_id, [...(grouped.get(row.term_id) ?? []), toCoverage(row)])
  return grouped
}

/** The genuine (active) coverage rows of one term, ordered by type then start, row-locked when `lock` is set. */
export async function listActiveCoverages(client: Queryable, termId: string, lock = false): Promise<CoverageRecord[]> {
  const result = await client.query<CoverageRow>(
    `SELECT ${COVERAGE_COLUMNS} FROM public.insurance_coverages WHERE term_id = $1 AND record_status = 'active' ORDER BY coverage_type, effective_from, id${lock ? " FOR NO KEY UPDATE" : ""}`,
    [termId],
  )
  return result.rows.map(toCoverage)
}

export type CoverageInsert = {
  id: string
  termId: string
  policyId: string
  organizationId: string
  family: InsuranceFamily
  coverageType: CoverageType
  limitAmount: string | null
  deductibleAmount: string | null
  currency: Currency | null
  limitBasis: LimitBasis | null
  scheduledVehiclesOnly: boolean
  effectiveFrom: string
  endorsementId: string | null
}

/**
 * Inserts an OPEN coverage row (effective_to NULL). The runtime role may insert effective_from / endorsement_id but a row
 * is ended only by an UPDATE that sets effective_to together with ended_by_endorsement_id (endCoverage).
 */
export async function insertCoverage(client: Queryable, input: CoverageInsert): Promise<void> {
  await client.query(
    `INSERT INTO public.insurance_coverages
       (id, term_id, policy_id, organization_id, family, coverage_type, limit_amount, deductible_amount, currency, limit_basis, scheduled_vehicles_only, effective_from, endorsement_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9, $10, $11, $12::date, $13)`,
    [input.id, input.termId, input.policyId, input.organizationId, input.family, input.coverageType, input.limitAmount, input.deductibleAmount, input.currency, input.limitBasis, input.scheduledVehiclesOnly, input.effectiveFrom, input.endorsementId],
  )
}

/** A REAL-WORLD end: sets effective_to (with the endorsement that caused it) on a genuine, open coverage row. */
export async function endCoverage(client: Queryable, coverageId: string, effectiveTo: string, endedByEndorsementId: string): Promise<void> {
  await client.query(
    `UPDATE public.insurance_coverages SET effective_to = $2::date, ended_by_endorsement_id = $3, updated_at = clock_timestamp() WHERE id = $1`,
    [coverageId, effectiveTo, endedByEndorsementId],
  )
}

/** A CORRECTION: flags the row (never ends it) and links its replacement. */
export async function supersedeCoverage(client: Queryable, coverageId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.insurance_coverages SET record_status = 'corrected', corrected_at = clock_timestamp(), superseded_by_coverage_id = $2, updated_at = clock_timestamp() WHERE id = $1`,
    [coverageId, replacementId],
  )
}

// --- broker periods -------------------------------------------------------------------------------------------------

const BROKER_COLUMNS = `id, policy_id, broker_organization_id, broker_relationship_id, broker_person_id, ${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO_NULL("effective_to")} AS effective_to,
  record_status, ${MICRO_ISO_NULL("corrected_at")} AS corrected_at, superseded_by_period_id`
type BrokerRow = {
  id: string
  policy_id: string
  broker_organization_id: string
  broker_relationship_id: string | null
  broker_person_id: string | null
  effective_from: string
  effective_to: string | null
  record_status: "active" | "corrected"
  corrected_at: string | null
  superseded_by_period_id: string | null
}
const toBroker = (row: BrokerRow): BrokerPeriodRecord => ({
  id: row.id,
  policyId: row.policy_id,
  brokerOrganizationId: row.broker_organization_id,
  brokerRelationshipId: row.broker_relationship_id,
  brokerPersonId: row.broker_person_id,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededById: row.superseded_by_period_id,
})

export async function getBrokerPeriod(client: Queryable, periodId: string, lock = false): Promise<BrokerPeriodRecord | undefined> {
  const result = await client.query<BrokerRow>(`SELECT ${BROKER_COLUMNS} FROM public.insurance_broker_periods WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [periodId])
  return result.rows[0] ? toBroker(result.rows[0]) : undefined
}

export async function listBrokerPeriods(client: Queryable, policyIds: string[]): Promise<Map<string, BrokerPeriodRecord[]>> {
  const grouped = new Map<string, BrokerPeriodRecord[]>()
  if (policyIds.length === 0) return grouped
  const result = await client.query<BrokerRow>(
    `SELECT ${BROKER_COLUMNS} FROM public.insurance_broker_periods WHERE policy_id = ANY($1::uuid[]) ORDER BY effective_from, created_at, id`,
    [policyIds],
  )
  for (const row of result.rows) grouped.set(row.policy_id, [...(grouped.get(row.policy_id) ?? []), toBroker(row)])
  return grouped
}

export async function getCurrentBrokerPeriod(client: Queryable, policyId: string, lock = false): Promise<BrokerPeriodRecord | undefined> {
  const result = await client.query<BrokerRow>(
    `SELECT ${BROKER_COLUMNS} FROM public.insurance_broker_periods WHERE policy_id = $1 AND record_status = 'active' AND effective_to IS NULL${lock ? " FOR NO KEY UPDATE" : ""}`,
    [policyId],
  )
  return result.rows[0] ? toBroker(result.rows[0]) : undefined
}

/** Latest end among the genuine broker periods of a policy, or null when none has ended. */
export async function latestBrokerEnd(client: Queryable, policyId: string): Promise<string | null> {
  const result = await client.query<{ latest: string | null }>(
    `SELECT ${MICRO_ISO_NULL("max(effective_to)")} AS latest FROM public.insurance_broker_periods WHERE policy_id = $1 AND record_status = 'active'`,
    [policyId],
  )
  return result.rows[0].latest
}

/** Genuine broker periods other than `excludeId`, to check a corrected window against its neighbours. */
export async function listOtherActiveBrokerPeriods(client: Queryable, policyId: string, excludeId: string): Promise<BrokerPeriodRecord[]> {
  const result = await client.query<BrokerRow>(
    `SELECT ${BROKER_COLUMNS} FROM public.insurance_broker_periods WHERE policy_id = $1 AND record_status = 'active' AND id <> $2 ORDER BY effective_from, id`,
    [policyId, excludeId],
  )
  return result.rows.map(toBroker)
}

/** The person's ACTIVE (current) relationship with the brokerage firm, if any; share-locked so it cannot end mid-write. */
export async function findActiveRelationship(client: Queryable, organizationId: string, personId: string): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM public.organization_person_relationships WHERE organization_id = $1 AND person_id = $2 AND record_status = 'active' AND effective_to IS NULL FOR SHARE`,
    [organizationId, personId],
  )
  return result.rows[0]?.id
}

export async function insertBrokerPeriod(
  client: Queryable,
  input: { id: string; policyId: string; organizationId: string; brokerOrganizationId: string; brokerRelationshipId: string | null; brokerPersonId: string | null; effectiveFrom: string },
): Promise<void> {
  await client.query(
    `INSERT INTO public.insurance_broker_periods (id, policy_id, organization_id, broker_organization_id, broker_relationship_id, broker_person_id, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
    [input.id, input.policyId, input.organizationId, input.brokerOrganizationId, input.brokerRelationshipId, input.brokerPersonId, input.effectiveFrom],
  )
}

export async function endBrokerPeriod(client: Queryable, periodId: string, at: string): Promise<void> {
  await client.query(`UPDATE public.insurance_broker_periods SET effective_to = $2::timestamptz, updated_at = clock_timestamp() WHERE id = $1`, [periodId, at])
}

export async function supersedeBrokerPeriod(client: Queryable, periodId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.insurance_broker_periods SET record_status = 'corrected', corrected_at = clock_timestamp(), superseded_by_period_id = $2, updated_at = clock_timestamp() WHERE id = $1`,
    [periodId, replacementId],
  )
}
