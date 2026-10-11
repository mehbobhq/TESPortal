/**
 * Company Operating Profile repository: SQL only, on a caller-supplied transaction client.
 *
 * No authorization, validation or Master Register logic lives here. Every function takes the client the authorization
 * wrapper checked out, so authorization and persistence share one connection and one transaction. Nothing here issues
 * DELETE (the runtime role has none).
 *
 * Business time is passed and returned as text with microsecond precision, because a JS Date would truncate to
 * milliseconds and could reorder two writes made within the same millisecond.
 *
 * The runtime role may UPDATE only the lifecycle columns (effective_to, record_status, corrected_at,
 * superseded_by_period_id, updated_at). effective_to is named in an INSERT ONLY for a correction of an already-ended period
 * (its replacement is born with the same window); every other insert omits the column.
 *
 * Lock order (used by every operation): Organization row, then the current period row of the fact, then dependents.
 */

import type { PoolClient } from "pg"
import type { OperatingScope, Applicability } from "@/lib/company-profile/definitions"
import type {
  CatalogueRule,
  DriverRequirementPeriod,
  OperatingScopePeriod,
  RecordStatus,
  RuleApplicabilityPeriod,
} from "@/lib/company-profile/types"

export type Queryable = Pick<PoolClient, "query">

// Constraint / trigger-constraint names the operations translate into domain errors.
export const CURRENT_SCOPE_CONSTRAINT = "company_operating_scope_periods_current_uq"
export const CURRENT_RULE_CONSTRAINT = "company_rule_applicability_periods_current_uq"
export const CURRENT_DRIVER_CONSTRAINT = "company_driver_requirement_periods_current_uq"
export const CURRENT_CONSTRAINTS = [CURRENT_SCOPE_CONSTRAINT, CURRENT_RULE_CONSTRAINT, CURRENT_DRIVER_CONSTRAINT] as const
export const RULE_ACTIVE_CONSTRAINTS = ["company_rule_applicability_periods_rule_active", "company_rule_applicability_periods_rule_code_fkey"] as const
export const ORGANIZATION_ACTIVE_CONSTRAINT = "organization_must_be_active"
export const WINDOW_CONSTRAINTS = [
  "company_operating_scope_periods_effective_window_valid",
  "company_rule_applicability_periods_effective_window_valid",
  "company_driver_requirement_periods_effective_window_valid",
] as const
export const VALUE_CONSTRAINTS = [
  "company_operating_scope_periods_scope_valid",
  "company_rule_applicability_periods_applicability_valid",
  "company_driver_requirement_periods_age_valid",
  "company_driver_requirement_periods_experience_valid",
] as const

export type PeriodTable = "company_operating_scope_periods" | "company_rule_applicability_periods" | "company_driver_requirement_periods"

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

// --- organizations --------------------------------------------------------------------------------------------------

/** Row-locks the Organization so every writer of its profile facts serializes (lock order step 1). */
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

export async function organizationExists(client: Queryable, organizationId: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM public.organizations WHERE id = $1`, [organizationId])
  return (result.rowCount ?? 0) > 0
}

// --- rule catalogue -------------------------------------------------------------------------------------------------

const RULE_COLUMNS = `code, section, display_name, applies_to_region, default_applicability, registration_program_code, is_active, sort_order`
type CatalogueRow = {
  code: string
  section: CatalogueRule["section"]
  display_name: string
  applies_to_region: CatalogueRule["appliesToRegion"]
  default_applicability: "APPLIES" | null
  registration_program_code: string | null
  is_active: boolean
  sort_order: number
}
const toCatalogueRule = (row: CatalogueRow): CatalogueRule => ({
  code: row.code,
  section: row.section,
  displayName: row.display_name,
  appliesToRegion: row.applies_to_region,
  defaultApplicability: row.default_applicability,
  registrationProgramCode: row.registration_program_code,
  isActive: row.is_active,
  sortOrder: row.sort_order,
})

export async function listRules(client: Queryable): Promise<CatalogueRule[]> {
  const result = await client.query<CatalogueRow>(`SELECT ${RULE_COLUMNS} FROM public.company_profile_rules ORDER BY sort_order`)
  return result.rows.map(toCatalogueRule)
}

export async function getRule(client: Queryable, code: string): Promise<CatalogueRule | undefined> {
  const result = await client.query<CatalogueRow>(`SELECT ${RULE_COLUMNS} FROM public.company_profile_rules WHERE code = $1`, [code])
  return result.rows[0] ? toCatalogueRule(result.rows[0]) : undefined
}

// --- shared period shape --------------------------------------------------------------------------------------------

const PERIOD_COLUMNS = `id, organization_id, ${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO_NULL("effective_to")} AS effective_to, record_status, ${MICRO_ISO_NULL("corrected_at")} AS corrected_at, superseded_by_period_id`
const ORDER = `ORDER BY effective_from, (corrected_at IS NULL), created_at, id`

type PeriodRow = {
  id: string
  organization_id: string
  effective_from: string
  effective_to: string | null
  record_status: RecordStatus
  corrected_at: string | null
  superseded_by_period_id: string | null
}
const toPeriod = (row: PeriodRow) => ({
  id: row.id,
  organizationId: row.organization_id,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededById: row.superseded_by_period_id,
})

const lockClause = (lock: boolean) => (lock ? " FOR NO KEY UPDATE" : "")

/** Resolves a period to its Organization without locking (used to find the Organization to lock first). */
export async function findPeriodOrganization(client: Queryable, table: PeriodTable, periodId: string): Promise<string | undefined> {
  const result = await client.query<{ organization_id: string }>(`SELECT organization_id FROM public.${table} WHERE id = $1`, [periodId])
  return result.rows[0]?.organization_id
}

/** The latest end among genuine rows: a new period may not start before it (there is no gap-fill backdating over history). */
export async function latestEnd(client: Queryable, table: PeriodTable, organizationId: string, ruleCode?: string): Promise<string | null> {
  const result = await client.query<{ latest: string | null }>(
    `SELECT ${MICRO_ISO_NULL("max(effective_to)")} AS latest FROM public.${table}
      WHERE organization_id = $1 AND record_status = 'active'${ruleCode === undefined ? "" : " AND rule_code = $2"}`,
    ruleCode === undefined ? [organizationId] : [organizationId, ruleCode],
  )
  return result.rows[0].latest
}

/** A REAL-WORLD end: sets effective_to on a genuine, open row. */
export async function endPeriod(client: Queryable, table: PeriodTable, id: string, at: string): Promise<void> {
  await client.query(`UPDATE public.${table} SET effective_to = $2::timestamptz, updated_at = clock_timestamp() WHERE id = $1`, [id, at])
}

/** A CORRECTION: flags the row (never ends it) and links its replacement. */
export async function markCorrected(client: Queryable, table: PeriodTable, id: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.${table} SET record_status = 'corrected', corrected_at = clock_timestamp(), superseded_by_period_id = $2, updated_at = clock_timestamp() WHERE id = $1`,
    [id, replacementId],
  )
}

// --- operating scope ------------------------------------------------------------------------------------------------

const SCOPE_COLUMNS = `${PERIOD_COLUMNS}, operating_scope`
type ScopeRow = PeriodRow & { operating_scope: OperatingScope }
const toScope = (row: ScopeRow): OperatingScopePeriod => ({ ...toPeriod(row), operatingScope: row.operating_scope })

export async function getScopePeriod(client: Queryable, periodId: string, lock = false): Promise<OperatingScopePeriod | undefined> {
  const result = await client.query<ScopeRow>(`SELECT ${SCOPE_COLUMNS} FROM public.company_operating_scope_periods WHERE id = $1${lockClause(lock)}`, [periodId])
  return result.rows[0] ? toScope(result.rows[0]) : undefined
}

export async function getCurrentScope(client: Queryable, organizationId: string, lock = false): Promise<OperatingScopePeriod | undefined> {
  const result = await client.query<ScopeRow>(
    `SELECT ${SCOPE_COLUMNS} FROM public.company_operating_scope_periods WHERE organization_id = $1 AND record_status = 'active' AND effective_to IS NULL${lockClause(lock)}`,
    [organizationId],
  )
  return result.rows[0] ? toScope(result.rows[0]) : undefined
}

export async function listScopePeriods(client: Queryable, organizationId: string): Promise<OperatingScopePeriod[]> {
  const result = await client.query<ScopeRow>(`SELECT ${SCOPE_COLUMNS} FROM public.company_operating_scope_periods WHERE organization_id = $1 ${ORDER}`, [organizationId])
  return result.rows.map(toScope)
}

export async function insertScope(
  client: Queryable,
  input: { id: string; organizationId: string; operatingScope: OperatingScope; effectiveFrom: string; effectiveTo?: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO public.company_operating_scope_periods (id, organization_id, operating_scope, effective_from${input.effectiveTo ? ", effective_to" : ""})
     VALUES ($1, $2, $3, $4::timestamptz${input.effectiveTo ? ", $5::timestamptz" : ""})`,
    [input.id, input.organizationId, input.operatingScope, input.effectiveFrom, ...(input.effectiveTo ? [input.effectiveTo] : [])],
  )
}

// --- rule applicability ---------------------------------------------------------------------------------------------

const RULE_PERIOD_COLUMNS = `${PERIOD_COLUMNS}, rule_code, applicability`
type RulePeriodRow = PeriodRow & { rule_code: string; applicability: Applicability }
const toRulePeriod = (row: RulePeriodRow): RuleApplicabilityPeriod => ({ ...toPeriod(row), ruleCode: row.rule_code, applicability: row.applicability })

export async function getRulePeriod(client: Queryable, periodId: string, lock = false): Promise<RuleApplicabilityPeriod | undefined> {
  const result = await client.query<RulePeriodRow>(`SELECT ${RULE_PERIOD_COLUMNS} FROM public.company_rule_applicability_periods WHERE id = $1${lockClause(lock)}`, [periodId])
  return result.rows[0] ? toRulePeriod(result.rows[0]) : undefined
}

export async function getCurrentRulePeriod(client: Queryable, organizationId: string, ruleCode: string, lock = false): Promise<RuleApplicabilityPeriod | undefined> {
  const result = await client.query<RulePeriodRow>(
    `SELECT ${RULE_PERIOD_COLUMNS} FROM public.company_rule_applicability_periods
      WHERE organization_id = $1 AND rule_code = $2 AND record_status = 'active' AND effective_to IS NULL${lockClause(lock)}`,
    [organizationId, ruleCode],
  )
  return result.rows[0] ? toRulePeriod(result.rows[0]) : undefined
}

export async function listRulePeriods(client: Queryable, organizationId: string): Promise<RuleApplicabilityPeriod[]> {
  const result = await client.query<RulePeriodRow>(`SELECT ${RULE_PERIOD_COLUMNS} FROM public.company_rule_applicability_periods WHERE organization_id = $1 ${ORDER}`, [organizationId])
  return result.rows.map(toRulePeriod)
}

export async function insertRulePeriod(
  client: Queryable,
  input: { id: string; organizationId: string; ruleCode: string; applicability: Applicability; effectiveFrom: string; effectiveTo?: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO public.company_rule_applicability_periods (id, organization_id, rule_code, applicability, effective_from${input.effectiveTo ? ", effective_to" : ""})
     VALUES ($1, $2, $3, $4, $5::timestamptz${input.effectiveTo ? ", $6::timestamptz" : ""})`,
    [input.id, input.organizationId, input.ruleCode, input.applicability, input.effectiveFrom, ...(input.effectiveTo ? [input.effectiveTo] : [])],
  )
}

// --- driver requirements --------------------------------------------------------------------------------------------

const DRIVER_COLUMNS = `${PERIOD_COLUMNS}, minimum_driver_age_years, minimum_driver_experience_months`
type DriverRow = PeriodRow & { minimum_driver_age_years: number; minimum_driver_experience_months: number }
const toDriver = (row: DriverRow): DriverRequirementPeriod => ({
  ...toPeriod(row),
  minimumDriverAgeYears: row.minimum_driver_age_years,
  minimumDriverExperienceMonths: row.minimum_driver_experience_months,
})

export async function getDriverPeriod(client: Queryable, periodId: string, lock = false): Promise<DriverRequirementPeriod | undefined> {
  const result = await client.query<DriverRow>(`SELECT ${DRIVER_COLUMNS} FROM public.company_driver_requirement_periods WHERE id = $1${lockClause(lock)}`, [periodId])
  return result.rows[0] ? toDriver(result.rows[0]) : undefined
}

export async function getCurrentDriverPeriod(client: Queryable, organizationId: string, lock = false): Promise<DriverRequirementPeriod | undefined> {
  const result = await client.query<DriverRow>(
    `SELECT ${DRIVER_COLUMNS} FROM public.company_driver_requirement_periods WHERE organization_id = $1 AND record_status = 'active' AND effective_to IS NULL${lockClause(lock)}`,
    [organizationId],
  )
  return result.rows[0] ? toDriver(result.rows[0]) : undefined
}

export async function listDriverPeriods(client: Queryable, organizationId: string): Promise<DriverRequirementPeriod[]> {
  const result = await client.query<DriverRow>(`SELECT ${DRIVER_COLUMNS} FROM public.company_driver_requirement_periods WHERE organization_id = $1 ${ORDER}`, [organizationId])
  return result.rows.map(toDriver)
}

export async function insertDriverPeriod(
  client: Queryable,
  input: { id: string; organizationId: string; minimumDriverAgeYears: number; minimumDriverExperienceMonths: number; effectiveFrom: string; effectiveTo?: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO public.company_driver_requirement_periods (id, organization_id, minimum_driver_age_years, minimum_driver_experience_months, effective_from${input.effectiveTo ? ", effective_to" : ""})
     VALUES ($1, $2, $3, $4, $5::timestamptz${input.effectiveTo ? ", $6::timestamptz" : ""})`,
    [input.id, input.organizationId, input.minimumDriverAgeYears, input.minimumDriverExperienceMonths, input.effectiveFrom, ...(input.effectiveTo ? [input.effectiveTo] : [])],
  )
}

// --- cross-domain read (plain SELECT on 0016; no import of the registrations domain) ----------------------------------

/**
 * For every active TAX catalogue rule: does the Organization hold a registration of the mapped program that is not archived
 * and whose CURRENT status period is ACTIVE? null when the rule has no registration identity.
 */
export async function listTaxRuleRegistrationPresence(
  client: Queryable,
  organizationId: string,
): Promise<Array<{ ruleCode: string; registrationProgramCode: string | null; hasActiveRegistration: boolean | null }>> {
  const result = await client.query<{ code: string; registration_program_code: string | null; has_active: boolean | null }>(
    `SELECT r.code, r.registration_program_code,
            CASE WHEN r.registration_program_code IS NULL THEN NULL ELSE EXISTS (
              SELECT 1
                FROM public.registrations AS g
                JOIN public.registration_status_periods AS s ON s.registration_id = g.id
               WHERE g.organization_id = $1
                 AND g.program_code = r.registration_program_code
                 AND g.record_status = 'active'
                 AND s.record_status = 'active'
                 AND s.effective_to IS NULL
                 AND s.registration_status = 'ACTIVE'
            ) END AS has_active
       FROM public.company_profile_rules AS r
      WHERE r.section = 'TAX' AND r.is_active
      ORDER BY r.sort_order`,
    [organizationId],
  )
  return result.rows.map((row) => ({ ruleCode: row.code, registrationProgramCode: row.registration_program_code, hasActiveRegistration: row.has_active }))
}
