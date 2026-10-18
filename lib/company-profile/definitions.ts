import { CompanyProfileValidationError } from "@/lib/company-profile/errors"

/**
 * Company Operating Profile vocabulary. PostgreSQL's catalogue (company_profile_rules, seeded by migration 0019) is
 * authoritative; this file only lets application code name the codes it may request, and a drift test proves the two agree.
 * Adding a rule is a migration, so the vocabulary stays controlled.
 *
 * Absence is meaningful: a rule with no assertion is NOT CONFIGURED (or takes the catalogue default, when it has one). There
 * is deliberately no generic key/value setting anywhere in this domain.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node.
 */

export const OPERATING_SCOPES = ["CANADA", "UNITED_STATES", "CANADA_AND_UNITED_STATES"] as const
export type OperatingScope = (typeof OPERATING_SCOPES)[number]

/** What an assertion can say. "Not configured" is the ABSENCE of an assertion, never a stored value. */
export const APPLICABILITIES = ["APPLIES", "DOES_NOT_APPLY"] as const
export type Applicability = (typeof APPLICABILITIES)[number]
export type EffectiveApplicability = Applicability | "NOT_CONFIGURED"
export type ApplicabilitySource = "ASSERTED" | "DEFAULT" | "NOT_CONFIGURED"

export const RULE_SECTIONS = ["CARGO", "OPERATIONS", "TAX", "DRIVERS", "PROGRAMS"] as const
export type RuleSection = (typeof RULE_SECTIONS)[number]

export const REGIONS = ["CANADA", "UNITED_STATES", "BOTH"] as const
export type Region = (typeof REGIONS)[number]

/** Company driver minimums: bounds mirror the database CHECK constraints. */
export const DRIVER_AGE_YEARS = { min: 16, max: 100 } as const
export const DRIVER_EXPERIENCE_MONTHS = { min: 0, max: 600 } as const

export type RuleDefinition = {
  code: string
  section: RuleSection
  displayName: string
  appliesToRegion: Region
  /** The TES default assumption for a rule with no assertion (informational; never written as an assertion). */
  defaultApplicability: "APPLIES" | null
  /** The 0016 registration program this tax rule corresponds to; null for every other rule (and for Form 2290). */
  registrationProgramCode: string | null
}

const rule = (
  code: string,
  section: RuleSection,
  displayName: string,
  appliesToRegion: Region,
  defaultApplicability: "APPLIES" | null,
  registrationProgramCode: string | null,
): RuleDefinition => ({ code, section, displayName, appliesToRegion, defaultApplicability, registrationProgramCode })

/** The 45 catalogued rules, in catalogue (sort_order) order. */
export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
  rule("DG_CANADA", "CARGO", "Dangerous goods in Canada", "CANADA", "APPLIES", null),
  rule("DG_US", "CARGO", "Hazardous materials in the United States", "UNITED_STATES", "APPLIES", null),
  rule("DG_WV_NV", "CARGO", "Dangerous goods in West Virginia or Nevada", "UNITED_STATES", null, null),
  rule("DG_COLORADO", "CARGO", "Dangerous goods in Colorado", "UNITED_STATES", null, null),
  rule("DG_IDAHO", "CARGO", "Dangerous goods in Idaho", "UNITED_STATES", null, null),
  rule("TOBACCO_ONTARIO", "CARGO", "Tobacco transport in Ontario", "CANADA", null, null),
  rule("ALCOHOL_US", "CARGO", "Alcohol transport in the United States", "UNITED_STATES", null, null),
  rule("ALCOHOL_NJ", "CARGO", "Alcohol transport in New Jersey", "UNITED_STATES", null, null),
  rule("ALCOHOL_TX", "CARGO", "Alcohol transport in Texas", "UNITED_STATES", null, null),
  rule("ALCOHOL_KY", "CARGO", "Alcohol transport in Kentucky", "UNITED_STATES", null, null),
  rule("ALCOHOL_IN", "CARGO", "Alcohol transport in Indiana", "UNITED_STATES", null, null),
  rule("ALCOHOL_OH", "CARGO", "Alcohol transport in Ohio", "UNITED_STATES", null, null),
  rule("ALCOHOL_NY", "CARGO", "Alcohol transport in New York", "UNITED_STATES", null, null),
  rule("REEFER_CALIFORNIA", "OPERATIONS", "Refrigerated operations in California", "UNITED_STATES", null, null),
  rule("IFTA", "TAX", "IFTA", "BOTH", null, "IFTA"),
  rule("CT_HUF", "TAX", "Connecticut Highway Use Fee", "UNITED_STATES", null, "CT_HUF"),
  rule("NY_HUT", "TAX", "New York Highway Use Tax", "UNITED_STATES", null, "NY_HUT"),
  rule("KYU", "TAX", "Kentucky Weight Distance Tax / KYU", "UNITED_STATES", null, "KYU"),
  rule("NM_WDT", "TAX", "New Mexico Weight Distance Tax", "UNITED_STATES", null, "NM_WDT"),
  rule("OR_WMT", "TAX", "Oregon Weight-Mile Tax", "UNITED_STATES", null, "OR_WMT"),
  rule("FORM_2290", "TAX", "Federal Heavy Highway Vehicle Use Tax — Form 2290", "UNITED_STATES", null, null),
  rule("FUEL_CHARGE_REGISTRATION", "TAX", "Fuel Charge Registration", "CANADA", null, "FUEL_CHARGE"),
  rule("TEXAS_EXCISE_TAX", "TAX", "Texas Excise Tax", "UNITED_STATES", null, "TX_EXCISE"),
  rule("ARKANSAS_MOTOR_FUEL_TAX", "TAX", "Arkansas Motor Fuel Tax", "UNITED_STATES", null, "AR_MFT"),
  rule("ONTARIO_TOBACCO_TAX", "TAX", "Ontario Tobacco Tax", "CANADA", null, "ON_TOBACCO"),
  rule("BACKGROUND_CHECK", "DRIVERS", "Background check", "BOTH", "APPLIES", null),
  rule("ANNUAL_ROAD_TEST", "DRIVERS", "Annual road test", "BOTH", "APPLIES", null),
  rule("PRE_EMPLOYMENT_ROAD_TEST", "DRIVERS", "Pre-employment road test", "BOTH", "APPLIES", null),
  rule("PSP", "DRIVERS", "PSP screening", "UNITED_STATES", null, null),
  rule("CANADIAN_DRUG_ALCOHOL", "DRIVERS", "Drug & alcohol testing for Canadian drivers", "CANADA", "APPLIES", null),
  rule("TAX_DOCUMENTS", "DRIVERS", "Driver tax documents", "BOTH", "APPLIES", null),
  rule("WORK_PERMIT", "DRIVERS", "Work permit", "BOTH", null, null),
  rule("PERMANENT_RESIDENT_CARD", "DRIVERS", "Permanent resident card", "BOTH", null, null),
  rule("STAFF_INCORPORATION", "DRIVERS", "Staff incorporation documents", "BOTH", null, null),
  rule("PASSPORT_US", "DRIVERS", "Passport for US operations", "UNITED_STATES", "APPLIES", null),
  rule("VISA_US", "DRIVERS", "Visa for US operations", "UNITED_STATES", null, null),
  rule("CTPAT", "PROGRAMS", "CTPAT", "UNITED_STATES", null, null),
  rule("FAST", "PROGRAMS", "FAST", "BOTH", null, null),
  rule("PIP", "PROGRAMS", "PIP", "CANADA", null, null),
  rule("CSA", "PROGRAMS", "Customs Self Assessment", "CANADA", null, null),
  rule("SMARTWAY", "PROGRAMS", "EPA SmartWay", "UNITED_STATES", null, null),
  rule("COR", "PROGRAMS", "COR", "CANADA", null, null),
  rule("PIC", "PROGRAMS", "Partners in Compliance", "CANADA", null, null),
  rule("WEIGHT_TO_GO", "PROGRAMS", "Weight to Go", "CANADA", null, null),
  rule("PREMIUM_CARRIER", "PROGRAMS", "Premium carrier designation", "BOTH", null, null),
]

export const RULE_CODES: readonly string[] = RULE_DEFINITIONS.map((definition) => definition.code)

const RULES_BY_CODE: ReadonlyMap<string, RuleDefinition> = new Map(RULE_DEFINITIONS.map((definition) => [definition.code, definition]))

export const getRuleDefinition = (code: string): RuleDefinition | undefined => RULES_BY_CODE.get(code)

export const isOperatingScope = (value: unknown): value is OperatingScope => typeof value === "string" && (OPERATING_SCOPES as readonly string[]).includes(value)
export const isApplicability = (value: unknown): value is Applicability => typeof value === "string" && (APPLICABILITIES as readonly string[]).includes(value)
export const isRuleSection = (value: unknown): value is RuleSection => typeof value === "string" && (RULE_SECTIONS as readonly string[]).includes(value)
export const isRegion = (value: unknown): value is Region => typeof value === "string" && (REGIONS as readonly string[]).includes(value)

/** A rule code is a catalogue key: upper snake case. The catalogue itself decides whether it exists. */
export const isRuleCodeShape = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,47}$/.test(value)
/** True when the code is one of the rules this build knows (the database remains the authority). */
export const isRuleCode = (value: unknown): value is string => typeof value === "string" && RULES_BY_CODE.has(value)

export const isDriverAgeYears = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= DRIVER_AGE_YEARS.min && value <= DRIVER_AGE_YEARS.max
export const isDriverExperienceMonths = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= DRIVER_EXPERIENCE_MONTHS.min && value <= DRIVER_EXPERIENCE_MONTHS.max

/**
 * What a rule means for a company right now: the explicit assertion, else the catalogue default (APPLIES) when the rule has
 * one, else NOT_CONFIGURED. An ended assertion with no replacement is no assertion.
 */
export function effectiveApplicability(
  rule: Pick<RuleDefinition, "defaultApplicability">,
  assertion: Applicability | null,
): { effective: EffectiveApplicability; source: ApplicabilitySource } {
  if (assertion !== null) return { effective: assertion, source: "ASSERTED" }
  if (rule.defaultApplicability === "APPLIES") return { effective: "APPLIES", source: "DEFAULT" }
  return { effective: "NOT_CONFIGURED", source: "NOT_CONFIGURED" }
}

/** Is a rule relevant to a company operating in this scope? (Informational; assertions are never blocked by it.) */
export function isRuleRelevantToScope(rule: Pick<RuleDefinition, "appliesToRegion">, scope: OperatingScope): boolean {
  if (rule.appliesToRegion === "BOTH" || scope === "CANADA_AND_UNITED_STATES") return true
  return rule.appliesToRegion === scope
}

// ---------------------------------------------------------------------------------------------------------------
// Company and Customer profile facts (migration 0033). The database catalogues are authoritative; a drift test proves these agree.
// ---------------------------------------------------------------------------------------------------------------

/** Descriptive cargo categories (cargo_categories). Never a compliance claim; see facts.ts. */
export const CARGO_CATEGORY_DEFINITIONS = [
  { code: "GENERAL_FREIGHT", displayName: "General Freight" },
  { code: "SPECIALIZED_EQUIPMENT", displayName: "Specialized Equipment" },
  { code: "HOUSEHOLD_GOODS", displayName: "Household Goods" },
  { code: "TEMPERATURE_CONTROLLED_FOOD", displayName: "Temperature-Controlled & Food" },
  { code: "HAZARDOUS_MATERIALS", displayName: "Hazardous Materials" },
  { code: "BULK_OTHER", displayName: "Bulk & Other" },
] as const
export type CargoCategoryCode = (typeof CARGO_CATEGORY_DEFINITIONS)[number]["code"]

/** Billing payment method names (billing_payment_methods): a PREFERENCE, never contract terms or payment details. */
export const PAYMENT_METHOD_DEFINITIONS = [
  { code: "E_TRANSFER", displayName: "E-Transfer" },
  { code: "CREDIT_CARD", displayName: "Credit Card" },
  { code: "WIRE_TRANSFER", displayName: "Wire Transfer" },
  { code: "CHEQUE", displayName: "Cheque" },
] as const
export type PaymentMethodCode = (typeof PAYMENT_METHOD_DEFINITIONS)[number]["code"]

const byCodeOrLabel = <T extends { code: string; displayName: string }>(definitions: readonly T[], value: unknown): T | undefined => {
  if (typeof value !== "string") return undefined
  const wanted = value.trim().toLowerCase()
  return definitions.find((definition) => definition.code.toLowerCase() === wanted || definition.displayName.toLowerCase() === wanted)
}

/** Resolves a cargo category given as its code or its display label; undefined when it is neither. */
export const resolveCargoCategory = (value: unknown) => byCodeOrLabel(CARGO_CATEGORY_DEFINITIONS, value)
/** Resolves a payment method given as its code or its display label; undefined when it is neither. */
export const resolvePaymentMethod = (value: unknown) => byCodeOrLabel(PAYMENT_METHOD_DEFINITIONS, value)

/**
 * The three fleet service categories a provider name can be recorded for. The kind is the short key used by forms and the API;
 * the code is the controlled catalogue entry (fleet_service_categories) that is stored. ELD/HOS, GPS/Telematics and Fuel are
 * distinct services: one vendor may supply several of them, and a company may use a different vendor for each.
 */
export const FLEET_PROVIDER_KINDS = ["ELD", "GPS", "FUEL"] as const
export type FleetProviderKind = (typeof FLEET_PROVIDER_KINDS)[number]
export const FLEET_SERVICE_CATEGORY_CODE: Record<FleetProviderKind, string> = { ELD: "ELD_HOS", GPS: "GPS_TELEMATICS", FUEL: "FUEL_SERVICES" }
export const FLEET_SERVICE_CATEGORY_LABEL: Record<FleetProviderKind, string> = { ELD: "ELD / Hours of Service", GPS: "GPS / Telematics", FUEL: "Fuel Card / Fuel Services" }
export const isFleetProviderKind = (value: unknown): value is FleetProviderKind => typeof value === "string" && (FLEET_PROVIDER_KINDS as readonly string[]).includes(value)

/** The matching form of a provider name: case-folded, whitespace collapsed. Advisory matching only. */
export function normalizeProviderName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()
}

/** A provider name as stored: trimmed, internal whitespace collapsed, 1-120 characters, no control characters. */
export function prepareProviderName(value: unknown, field = "providerName"): string {
  if (typeof value !== "string") throw new CompanyProfileValidationError(field, "A provider name must be text.")
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim()
  if (name === "") throw new CompanyProfileValidationError(field, "A provider name cannot be blank.")
  if (name.length > 120) throw new CompanyProfileValidationError(field, "A provider name is limited to 120 characters.")
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(name)) throw new CompanyProfileValidationError(field, "A provider name cannot contain control characters.")
  return name
}

