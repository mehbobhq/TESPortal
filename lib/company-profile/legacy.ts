/**
 * Legacy Settings vocabulary -> canonical Company Operating Profile vocabulary.
 *
 * PURE mapping tables and functions. This file never reads browser storage and never touches the database: it exists so a
 * later deterministic, reconcilable import has an agreed mapping. The legacy source is the browser-held Settings workspace
 * (app/companies/[id]/settings/page.tsx) whose state is { jurisdiction, minimumDriverAge, minimumDriverExperience, rules }.
 *
 * Every function returns an explicit status; an unmappable legacy value is reported as such and never guessed. A legacy
 * value that merely echoes an untouched default is NOT an assertion: the legacy store pre-fills defaults, so an importer that
 * wrote them as assertions would fabricate history.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node.
 */

import { DRIVER_AGE_YEARS, DRIVER_EXPERIENCE_MONTHS, getRuleDefinition, RULE_DEFINITIONS, type Applicability, type OperatingScope } from "@/lib/company-profile/definitions"

// --- operating scope ------------------------------------------------------------------------------------------------

export const LEGACY_JURISDICTION_TO_SCOPE: Readonly<Record<string, OperatingScope>> = Object.freeze({
  canada: "CANADA",
  us: "UNITED_STATES",
  both: "CANADA_AND_UNITED_STATES",
})

export type LegacyScopeResult = { status: "MAPPED"; operatingScope: OperatingScope } | { status: "UNMAPPABLE" }

/** Exact (case-sensitive) legacy jurisdiction values only; anything else is UNMAPPABLE. */
export function mapLegacyJurisdiction(value: unknown): LegacyScopeResult {
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_JURISDICTION_TO_SCOPE, value)) {
    return { status: "MAPPED", operatingScope: LEGACY_JURISDICTION_TO_SCOPE[value] }
  }
  return { status: "UNMAPPABLE" }
}

// --- rule ids and values --------------------------------------------------------------------------------------------

/** Legacy rule ids are the lower-case spelling of the canonical rule codes. */
export const LEGACY_RULE_IDS: readonly string[] = RULE_DEFINITIONS.map((definition) => definition.code.toLowerCase())

/** The canonical rule code for a legacy rule id, or null (exact lower-case ids only). */
export function mapLegacyRuleId(legacyRuleId: unknown): string | null {
  if (typeof legacyRuleId !== "string" || legacyRuleId !== legacyRuleId.toLowerCase()) return null
  const code = legacyRuleId.toUpperCase()
  return getRuleDefinition(code) ? code : null
}

export const LEGACY_RULE_VALUES = ["applies", "does-not-apply", "not-configured"] as const

export type LegacyRuleResult =
  | {
      status: "ASSERTION"
      ruleCode: string
      applicability: Applicability
      /** True when the asserted value equals the catalogue default: harmless, but an importer may prefer to skip it. */
      redundantWithDefault: boolean
    }
  | {
      status: "NO_ASSERTION"
      ruleCode: string
      /** True when the rule has a catalogue default and the legacy user had moved it to "not configured". */
      overridesDefault: boolean
    }
  | { status: "UNMAPPABLE" }

/** 'applies' -> APPLIES, 'does-not-apply' -> DOES_NOT_APPLY, 'not-configured' -> no assertion. Unknown id or value: UNMAPPABLE. */
export function mapLegacyRule(legacyRuleId: unknown, legacyValue: unknown): LegacyRuleResult {
  const ruleCode = mapLegacyRuleId(legacyRuleId)
  if (ruleCode === null) return { status: "UNMAPPABLE" }
  const definition = getRuleDefinition(ruleCode)!
  if (legacyValue === "not-configured") return { status: "NO_ASSERTION", ruleCode, overridesDefault: definition.defaultApplicability === "APPLIES" }
  if (legacyValue === "applies") return { status: "ASSERTION", ruleCode, applicability: "APPLIES", redundantWithDefault: definition.defaultApplicability === "APPLIES" }
  if (legacyValue === "does-not-apply") return { status: "ASSERTION", ruleCode, applicability: "DOES_NOT_APPLY", redundantWithDefault: false }
  return { status: "UNMAPPABLE" }
}

// --- tax codes ------------------------------------------------------------------------------------------------------

/** The legacy tax-filing TaxCode values (src/components/tax-filing/types.ts) are identical strings to the legacy tax rule ids. */
export const LEGACY_TAX_CODES = [
  "ifta",
  "ct_huf",
  "ny_hut",
  "kyu",
  "nm_wdt",
  "or_wmt",
  "form_2290",
  "fuel_charge_registration",
  "texas_excise_tax",
  "arkansas_motor_fuel_tax",
  "ontario_tobacco_tax",
] as const

export type LegacyTaxResult =
  | {
      status: "MAPPED"
      ruleCode: string
      /** The 0016 registration program; null for Form 2290, which has no registration identity (a mapped, known fact). */
      registrationProgramCode: string | null
    }
  | { status: "UNMAPPABLE" }

export function mapLegacyTaxCode(legacyTaxCode: unknown): LegacyTaxResult {
  const ruleCode = mapLegacyRuleId(legacyTaxCode)
  const definition = ruleCode === null ? undefined : getRuleDefinition(ruleCode)
  if (!definition || definition.section !== "TAX") return { status: "UNMAPPABLE" }
  return { status: "MAPPED", ruleCode: definition.code, registrationProgramCode: definition.registrationProgramCode }
}

// --- driver minimums ------------------------------------------------------------------------------------------------

/** The values the legacy Settings state pre-fills. They are defaults, NOT assertions. */
export const LEGACY_DEFAULT_MINIMUM_DRIVER_AGE = "21"
export const LEGACY_DEFAULT_MINIMUM_DRIVER_EXPERIENCE = "24"

export type LegacyMinimumResult = { status: "NO_ASSERTION" } | { status: "ASSERTION"; value: number } | { status: "INVALID" }

function parseLegacyNumber(raw: unknown, range: { min: number; max: number }): number | null {
  if (typeof raw !== "string" || !/^\d{1,4}$/.test(raw)) return null
  const value = Number(raw)
  return value >= range.min && value <= range.max ? value : null
}

/** Strict: the legacy store holds strings; only plain digits within range map. An untouched default is NO_ASSERTION. */
export function mapLegacyMinimumAge(raw: unknown): LegacyMinimumResult {
  if (raw === LEGACY_DEFAULT_MINIMUM_DRIVER_AGE) return { status: "NO_ASSERTION" }
  const value = parseLegacyNumber(raw, DRIVER_AGE_YEARS)
  return value === null ? { status: "INVALID" } : { status: "ASSERTION", value }
}

export function mapLegacyMinimumExperience(raw: unknown): LegacyMinimumResult {
  if (raw === LEGACY_DEFAULT_MINIMUM_DRIVER_EXPERIENCE) return { status: "NO_ASSERTION" }
  const value = parseLegacyNumber(raw, DRIVER_EXPERIENCE_MONTHS)
  return value === null ? { status: "INVALID" } : { status: "ASSERTION", value }
}

export type LegacyDriverRequirementsResult =
  | { status: "NO_ASSERTION" }
  | { status: "ASSERTION"; minimumDriverAgeYears: number; minimumDriverExperienceMonths: number }
  | { status: "INVALID"; invalidFields: Array<"minimumDriverAge" | "minimumDriverExperience"> }

/**
 * Driver minimums are stored together, so both legacy fields map together. Both untouched defaults: NO_ASSERTION. Either one
 * invalid: INVALID (naming the field). Otherwise an ASSERTION - when only ONE field is still the default, its default value
 * is used for the pair because the other field was deliberately set.
 */
export function mapLegacyDriverRequirements(rawAge: unknown, rawExperience: unknown): LegacyDriverRequirementsResult {
  const age = mapLegacyMinimumAge(rawAge)
  const experience = mapLegacyMinimumExperience(rawExperience)
  const invalidFields: Array<"minimumDriverAge" | "minimumDriverExperience"> = []
  if (age.status === "INVALID") invalidFields.push("minimumDriverAge")
  if (experience.status === "INVALID") invalidFields.push("minimumDriverExperience")
  if (invalidFields.length > 0) return { status: "INVALID", invalidFields }
  if (age.status === "NO_ASSERTION" && experience.status === "NO_ASSERTION") return { status: "NO_ASSERTION" }
  return {
    status: "ASSERTION",
    minimumDriverAgeYears: age.status === "ASSERTION" ? age.value : Number(LEGACY_DEFAULT_MINIMUM_DRIVER_AGE),
    minimumDriverExperienceMonths: experience.status === "ASSERTION" ? experience.value : Number(LEGACY_DEFAULT_MINIMUM_DRIVER_EXPERIENCE),
  }
}
