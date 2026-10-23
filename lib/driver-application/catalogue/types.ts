/**
 * The universal driver hiring application: catalogue data model.
 *
 * ONE catalogue describes every question, section, authorization and verification requirement. Everything is DECLARATIVE data (conditions are
 * expressions, not functions) so the exact resolved plan can be frozen with each invitation, hashed, stored, and re-evaluated later on the same
 * rules version. No scenario has its own form: the plan resolver selects from this catalogue.
 */

export type Stage = "PRE_OFFER" | "CONDITIONAL_OFFER" | "POST_OFFER"
export const STAGE_ORDER: Record<Stage, number> = { PRE_OFFER: 0, CONDITIONAL_OFFER: 1, POST_OFFER: 2 }

export type Sensitivity = "STANDARD" | "PERSONAL" | "SENSITIVE" | "RESTRICTED"
export type Purpose = "IDENTITY" | "REGULATORY" | "HR" | "ELIGIBILITY"

export type SectionId = "identity" | "address" | "licence" | "experience" | "employment" | "hr" | "eligibility" | "documents" | "authorizations"

export type FieldType = "text" | "textarea" | "email" | "phone" | "date" | "number" | "select" | "multiselect" | "yesno" | "repeatable" | "upload" | "sensitive"

/** A condition over answers (`ans.<fieldId>`) and the plan context (`ctx.<key>`). */
export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { ref: string; op: "eq" | "neq" | "in" | "includes" | "truthy" | "falsy" | "gte"; value?: unknown }

export interface Option {
  value: string
  label: string
}

export interface Validation {
  minLength?: number
  maxLength?: number
  /** JavaScript regular-expression source. */
  pattern?: string
  patternMessage?: string
  min?: number
  max?: number
  minItems?: number
  maxItems?: number
  notFuture?: boolean
  notPast?: boolean
  /** Minimum age in years for a date of birth. */
  minAgeYears?: number
  /** Repeatable only: the entries must cover this many continuous years up to today (`from`/`to` item fields), gaps explained. */
  coverageYears?: number | "ctx.historyYears"
}

/** Option lists resolved at render and validation time from the shared jurisdiction list (kept out of every frozen plan). */
export type OptionsRef = "jurisdictions.us" | "jurisdictions.ca" | "jurisdictions.all"

export interface ItemField {
  id: string
  type: Exclude<FieldType, "repeatable" | "upload" | "sensitive">
  label: string
  required: boolean
  options?: Option[]
  optionsRef?: OptionsRef
  validation?: Validation
  /** Relative condition over the other fields of the same item (`item.<id>`). */
  appliesWhen?: Cond
}

export interface EvidenceSpec {
  /** Stored as evidence document type DRIVER_APPLICATION_<CLASS>. */
  documentClass: string
  sensitivity: "standard" | "sensitive" | "restricted"
  accept: string[]
  hint: string
}

export type CollectionGate = "VAULT_KEY" | "LEGAL_APPROVAL"

export interface FieldDef {
  id: string
  section: SectionId
  order: number
  type: FieldType
  label: string
  help?: string
  purpose: Purpose
  /** Plan-time and answer-time applicability. Absent = always applicable. */
  appliesWhen?: Cond
  required: boolean | Cond
  options?: Option[]
  optionsRef?: OptionsRef
  validation?: Validation
  itemFields?: ItemField[]
  sensitivity: Sensitivity
  /** The earliest stage at which the field may be collected. Fields later than the application's stage are not in the plan. */
  stage: Stage
  /** Some fields have a stricter stage when the driver's operations involve Canada (human-rights limits on pre-offer questions; counsel to confirm). */
  stageWhenCanada?: Stage
  evidence?: EvidenceSpec
  /** Keys into LEGAL_SOURCES, or a carrier-policy reference. */
  legalSource: string[]
  carrierPolicyRef?: string
  pdf: { label?: string; mask?: "LAST4" | "EXCLUDE" | "NONE"; format?: "date" | "yesno" | "list" | "table" }
  /** Sensitive identifiers: collection stays OFF until every gate is satisfied. */
  collectionGates?: CollectionGate[]
}

export interface SectionDef {
  id: SectionId
  title: string
  intro: string
  order: number
}

export type LegalStatus = "APPROVED" | "PENDING_LEGAL_REVIEW" | "EXTERNAL_PROCESS_REQUIRED"

export interface ConsentDef {
  key: string
  version: string
  title: string
  purpose: string
  /** The exact text presented and signed. Status says whether counsel has approved it; until APPROVED nothing may rely on it. */
  text: string
  legalStatus: LegalStatus
  scope: Record<string, unknown>
  authorizedParties: string[]
  appliesWhen?: Cond
  stage: Stage
  /** True: TES records only that the external, standalone process is required; it never captures acceptance on behalf of that process. */
  external?: boolean
  /** True: must be presented on its own (its own screen and its own PDF page), never combined with other text. */
  standalone?: boolean
  legalSource: string[]
  /** Requirements (verification keys) that rely on this consent. */
  supports: string[]
}

export interface RequirementDef {
  /** Verification requirement key (stable). */
  key: string
  type: "IDENTITY" | "LICENCE" | "MEDICAL" | "PREVIOUS_EMPLOYER" | "DRIVING_RECORD" | "CLEARINGHOUSE" | "PSP" | "CRIMINAL_BACKGROUND" | "WORK_ELIGIBILITY" | "REFERENCES" | "CARRIER_SPECIFIC"
  title: string
  appliesWhen?: Cond
  stage: Stage
  /** Required for a QUALIFIED decision. */
  requiredForQualification: boolean
  consentKey?: string
  /** Evidence classes that can support this requirement. */
  evidenceClasses?: string[]
  /** External process (e.g. FMCSA Clearinghouse full query) that TES does not perform or consent for. */
  external?: boolean
  legalSource: string[]
}

export interface LegalSource {
  citation: string
  jurisdiction: "US" | "CA" | "US_STATE" | "CA_PROVINCE" | "BOTH"
  note: string
  /** Honest status: nothing here has been verified by counsel. */
  verification: "UNVERIFIED_BY_COUNSEL"
}

export type MatrixRule = "ALLOWED" | "RESTRICTED" | "PROHIBITED"

export interface HrItemDef {
  id: string
  title: string
  description: string
  /** Rule per country and stage. RESTRICTED needs an explicit acknowledgement and a legal-review flag; PROHIBITED can never be enabled. */
  matrix: { US: Record<Stage, MatrixRule>; CA: Record<Stage, MatrixRule> }
  legalSource: string[]
  fields: string[]
  requirementKeys?: string[]
}

export interface Catalogue {
  version: string
  rulesVersion: string
  sections: SectionDef[]
  fields: FieldDef[]
  consents: ConsentDef[]
  requirements: RequirementDef[]
  hrItems: HrItemDef[]
  legalSources: Record<string, LegalSource>
}
