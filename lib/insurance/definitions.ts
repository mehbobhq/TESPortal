/**
 * Insurance vocabulary, policy-number normalization and date derivation.
 *
 * PostgreSQL's insurance_coverage_types catalogue (migration 0017) is the persisted source of truth for which coverage /
 * account / bond types exist, which family each belongs to and whether a limit is required; the database triggers and
 * composite foreign keys enforce that shape. This module lets application code name the codes it may request and owns the
 * pieces the database cannot express - the versioned policy-number normalization rule and the date-derived reading of
 * "in force" - and a drift test proves the catalogue and this file agree.
 *
 * There is NO stored policy status. Expiry, cancellation and "in force" are interpreted from the stated dates and the
 * one-way cancellation fact (termStateOn below); archive is record lifecycle, not policy status.
 *
 * Policy-number namespace: a number identifies ONE policy within its INSURER. It is never globally unique (two insurers may
 * issue the same number) and every term of the same policy may repeat it.
 *
 * Number validation is PERMISSIVE: insurers issue many formats and none is authoritatively locked, so the rule only
 * guarantees a safe, comparable token (it is NOT regulatory-format validation). Tightening is done by adding a NEW rule
 * version; every version ever stored stays resolvable in NORMALIZATION_RULES.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node.
 */

import { InsuranceValidationError } from "@/lib/insurance/errors"

export const FAMILIES = ["INSURANCE", "WORKERS_COMPENSATION", "BOND"] as const
export type InsuranceFamily = (typeof FAMILIES)[number]

export const COVERAGE_TYPE_DEFINITIONS = {
  AUTO_LIABILITY: { family: "INSURANCE", limitRequired: true },
  MOTOR_TRUCK_CARGO: { family: "INSURANCE", limitRequired: true },
  GENERAL_LIABILITY: { family: "INSURANCE", limitRequired: true },
  PHYSICAL_DAMAGE: { family: "INSURANCE", limitRequired: true },
  UMBRELLA_EXCESS: { family: "INSURANCE", limitRequired: true },
  REEFER_BREAKDOWN: { family: "INSURANCE", limitRequired: true },
  WORKERS_COMPENSATION: { family: "WORKERS_COMPENSATION", limitRequired: false },
  BOND_FREIGHT_BROKER: { family: "BOND", limitRequired: true },
  BOND_CUSTOMS: { family: "BOND", limitRequired: true },
  BOND_PERFORMANCE: { family: "BOND", limitRequired: true },
} as const satisfies Record<string, { family: InsuranceFamily; limitRequired: boolean }>

export type CoverageType = keyof typeof COVERAGE_TYPE_DEFINITIONS
/** In catalogue sort order. */
export const COVERAGE_TYPES = Object.keys(COVERAGE_TYPE_DEFINITIONS) as CoverageType[]

/** Why a term was cancelled (one-way fact on the term). There is no "other": more codes are added by migration. */
export const CANCELLATION_REASONS = ["INSURED_REQUEST", "INSURER_CANCELLATION", "NON_PAYMENT", "REPLACED_BY_NEW_POLICY"] as const
export type CancellationReason = (typeof CANCELLATION_REASONS)[number]

export const ENDORSEMENT_KINDS = ["COVERAGE_ADDED", "COVERAGE_CHANGED", "COVERAGE_REMOVED"] as const
export type EndorsementKind = (typeof ENDORSEMENT_KINDS)[number]

export const LIMIT_BASES = ["COMBINED_SINGLE_LIMIT", "PER_OCCURRENCE", "PER_VEHICLE", "AGGREGATE", "PENAL_SUM"] as const
export type LimitBasis = (typeof LIMIT_BASES)[number]

export const CURRENCIES = ["CAD", "USD"] as const
export type Currency = (typeof CURRENCIES)[number]

/** How a term came to exist (set by the server; never supplied by a caller). */
export const TERM_REASONS = ["INITIAL", "RENEWAL", "CORRECTION"] as const
export type TermReason = (typeof TERM_REASONS)[number]

const includes = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value)

export const isFamily = (value: unknown): value is InsuranceFamily => includes(FAMILIES, value)
export const isCoverageType = (value: unknown): value is CoverageType => typeof value === "string" && Object.prototype.hasOwnProperty.call(COVERAGE_TYPE_DEFINITIONS, value)
export const isCancellationReason = (value: unknown): value is CancellationReason => includes(CANCELLATION_REASONS, value)
export const isEndorsementKind = (value: unknown): value is EndorsementKind => includes(ENDORSEMENT_KINDS, value)
export const isLimitBasis = (value: unknown): value is LimitBasis => includes(LIMIT_BASES, value)
export const isCurrency = (value: unknown): value is Currency => includes(CURRENCIES, value)

export const coverageTypesOfFamily = (family: InsuranceFamily): CoverageType[] => COVERAGE_TYPES.filter((type) => COVERAGE_TYPE_DEFINITIONS[type].family === family)

/** Limit bases that make sense per family: a bond's limit is its penal sum; insurance limits are never penal sums. */
export function limitBasesOfFamily(family: InsuranceFamily): readonly LimitBasis[] {
  if (family === "BOND") return ["PENAL_SUM"]
  if (family === "INSURANCE") return LIMIT_BASES.filter((basis) => basis !== "PENAL_SUM")
  return []
}

// ---------------------------------------------------------------------------------------------------------------
// Versioned policy-number normalization
// ---------------------------------------------------------------------------------------------------------------

export type NormalizationRule = {
  readonly version: string
  readonly classification: "PERMISSIVE"
  readonly apply: (raw: string) => { ok: true; normalized: string } | { ok: false; reason: string }
}

/**
 * NFKC, upper case, then spaces, hyphens, periods, slashes and underscores are formatting and are removed; what remains must
 * be 1-40 letters or digits. Case, spacing and punctuation therefore never make two spellings of one number different.
 */
const POLICY_NUMBER_PERMISSIVE: NormalizationRule = {
  version: "insurance_policy_number.permissive.v1",
  classification: "PERMISSIVE",
  apply(raw) {
    const normalized = raw.normalize("NFKC").toUpperCase().replace(/[\s\-./_]+/g, "")
    return /^[A-Z0-9]{1,40}$/.test(normalized)
      ? { ok: true, normalized }
      : { ok: false, reason: "The number must be 1-40 letters or digits (spaces, hyphens, periods, slashes and underscores are ignored)." }
  },
}

/** Every rule version ever stored must remain here, unchanged. */
export const NORMALIZATION_RULES: Readonly<Record<string, NormalizationRule>> = {
  [POLICY_NUMBER_PERMISSIVE.version]: POLICY_NUMBER_PERMISSIVE,
}
export const CURRENT_NUMBER_RULE = POLICY_NUMBER_PERMISSIVE

export type PreparedNumber = { display: string; normalized: string; ruleVersion: string }

const DISPLAY_NUMBER_MAX = 60

/** Prepares a policy / account / bond / endorsement number: the number as printed, its comparison form and the rule version. */
export function prepareNumber(value: unknown, field = "policyNumber"): PreparedNumber {
  if (typeof value !== "string" || value.trim() === "") throw new InsuranceValidationError(field, `${field} is required.`)
  const display = value.normalize("NFC").replace(/\s+/g, " ").trim()
  if (display.length > DISPLAY_NUMBER_MAX) throw new InsuranceValidationError(field, `${field} must not exceed ${DISPLAY_NUMBER_MAX} characters.`)
  const result = CURRENT_NUMBER_RULE.apply(display)
  if (!result.ok) throw new InsuranceValidationError(field, result.reason)
  return { display, normalized: result.normalized, ruleVersion: CURRENT_NUMBER_RULE.version }
}

// ---------------------------------------------------------------------------------------------------------------
// Calendar dates and amounts
// ---------------------------------------------------------------------------------------------------------------

/** True when `value` is a real calendar date written YYYY-MM-DD (so 2023-02-30 is not a date). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

export function parseCalendarDate(value: unknown, field: string): string {
  if (typeof value === "string" && isCalendarDate(value.trim())) return value.trim()
  throw new InsuranceValidationError(field, `${field} must be a calendar date (YYYY-MM-DD).`)
}

/** Dates are stored as given and compare correctly as text. */
export const compareDates = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * A money amount as a canonical decimal string with exactly two decimals ("1000000.00"), never a float: at most 12 integer
 * digits and 2 decimals (numeric(14,2)). Numbers are accepted only when their plain decimal rendering is exact.
 */
export function parseAmount(value: unknown, field: string, options: { allowZero: boolean }): string {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : ""
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) throw new InsuranceValidationError(field, `${field} must be a decimal amount with at most 12 digits and 2 decimals.`)
  const canonical = `${match[1].replace(/^0+(?=\d)/, "")}.${(match[2] ?? "").padEnd(2, "0")}`
  if (!options.allowZero && /^0+\.00$/.test(canonical)) throw new InsuranceValidationError(field, `${field} must be greater than zero.`)
  return canonical
}

// ---------------------------------------------------------------------------------------------------------------
// Derived state (nothing here is stored)
// ---------------------------------------------------------------------------------------------------------------

export type TermStateInput = { recordStatus: "active" | "corrected"; termStart: string; termEnd: string | null; cancelledOn: string | null }
export type TermState = "CORRECTED" | "NOT_STARTED" | "IN_FORCE" | "EXPIRED" | "CANCELLED"

/**
 * Reads a term on a calendar date. A term runs from termStart up to (not including) termEnd; a cancellation takes effect on
 * cancelledOn (coverage is no longer in force on that date). A corrected term never counts: it is a preserved wrong record.
 * A continuous bond (no termEnd) is in force until cancelled.
 */
export function termStateOn(term: TermStateInput, date: string): TermState {
  if (term.recordStatus !== "active") return "CORRECTED"
  if (date < term.termStart) return "NOT_STARTED"
  if (term.cancelledOn !== null && date >= term.cancelledOn) return "CANCELLED"
  if (term.termEnd !== null && date >= term.termEnd) return "EXPIRED"
  return "IN_FORCE"
}

export type CoverageRowInput = { recordStatus: "active" | "corrected"; effectiveFrom: string; effectiveTo: string | null }

/** A coverage row is in force on a date when it is genuine, spans the date, and its term is in force that date. */
export function coverageInForce(row: CoverageRowInput, termState: TermState, date: string): boolean {
  return termState === "IN_FORCE" && row.recordStatus === "active" && row.effectiveFrom <= date && (row.effectiveTo === null || date < row.effectiveTo)
}

// ---------------------------------------------------------------------------------------------------------------
// Scheduled vehicles (migration 0025, insurance_coverage_vehicles)
// ---------------------------------------------------------------------------------------------------------------

/** Why a schedule row exists. The database CHECK (insurance_coverage_vehicles_reason_valid) holds the same list. */
export const SCHEDULE_REASONS = ["INITIAL", "CHANGE", "CORRECTION"] as const
export type ScheduleReason = (typeof SCHEDULE_REASONS)[number]

export const isScheduleReason = (value: unknown): value is ScheduleReason => includes(SCHEDULE_REASONS, value)

export type CoverageWindowInput = { coverageEnd: string | null; termEnd: string | null; cancelledOn: string | null }

/**
 * The first calendar date a coverage is NO LONGER in force: the earliest of its own end, its term's end and its term's
 * cancellation (absent values ignored), or null when none of them is stated. A schedule window lies inside
 * [coverage.effectiveFrom, coverageWindowEnd); an open schedule runs "until the coverage ends".
 */
export function coverageWindowEnd(input: CoverageWindowInput): string | null {
  const stated = [input.coverageEnd, input.termEnd, input.cancelledOn].filter((value): value is string => value !== null)
  return stated.length === 0 ? null : stated.reduce((earliest, value) => (value < earliest ? value : earliest))
}

/** A schedule window is half-open [from, to): in force on `date` from its first day up to, not including, its end. */
export const scheduleInForce = (window: { effectiveFrom: string; effectiveTo: string | null }, date: string): boolean =>
  window.effectiveFrom <= date && (window.effectiveTo === null || date < window.effectiveTo)
