import type {
  Applicability,
  ApplicabilitySource,
  EffectiveApplicability,
  OperatingScope,
  Region,
  RuleSection,
} from "@/lib/company-profile/definitions"

export type RecordStatus = "active" | "corrected"

/** Every business-time value is an ISO-8601 UTC string with microsecond precision. */
type Period = {
  id: string
  organizationId: string
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: RecordStatus
  correctedAt: string | null
  supersededById: string | null
}

export type OperatingScopePeriod = Period & { operatingScope: OperatingScope }
export type RuleApplicabilityPeriod = Period & { ruleCode: string; applicability: Applicability }
export type DriverRequirementPeriod = Period & { minimumDriverAgeYears: number; minimumDriverExperienceMonths: number }

/** One row of the controlled rule catalogue. */
export type CatalogueRule = {
  code: string
  section: RuleSection
  displayName: string
  appliesToRegion: Region
  defaultApplicability: "APPLIES" | null
  registrationProgramCode: string | null
  isActive: boolean
  sortOrder: number
}

export type RuleProfileEntry = {
  rule: CatalogueRule
  /** The assertion in force (current, or as of the requested instant); null when none. */
  assertion: RuleApplicabilityPeriod | null
  effective: EffectiveApplicability
  source: ApplicabilitySource
  /** Every recorded period for this rule, original first; corrected rows are flagged and never genuine. */
  history: RuleApplicabilityPeriod[]
}

export type CompanyProfileView = {
  organizationId: string
  /** The instant the facts were evaluated at; null means "now" (current, unended facts). */
  asOf: string | null
  operatingScope: { assertion: OperatingScopePeriod | null; history: OperatingScopePeriod[] }
  driverRequirements: { assertion: DriverRequirementPeriod | null; history: DriverRequirementPeriod[] }
  /** EVERY catalogued rule, in catalogue order. */
  rules: RuleProfileEntry[]
}

export type TaxAlignment =
  | "NO_REGISTRATION_IDENTITY"
  | "CONSISTENT"
  | "APPLIES_WITHOUT_ACTIVE_REGISTRATION"
  | "DOES_NOT_APPLY_WITH_ACTIVE_REGISTRATION"
  | "REGISTRATION_WITHOUT_APPLICABILITY"
  | "NOT_CONFIGURED"

/** Applicability beside the existence of an ACTIVE-status registration. Reveals no number, id or date. */
export type TaxApplicabilityComparison = {
  ruleCode: string
  registrationProgramCode: string | null
  effective: EffectiveApplicability
  source: ApplicabilitySource
  /** null when the rule has no registration identity (Form 2290). */
  hasActiveRegistration: boolean | null
  alignment: TaxAlignment
}
