/**
 * Contracts definitions: controlled vocabularies and pure rules. No I/O, no framework imports.
 *
 * The database (migration 0031) is the final arbiter of every rule here; these definitions exist so the application can
 * validate early, explain refusals and render the gates.
 */

export const CONTRACT_STATUSES = ["draft", "ready_for_signature", "signed", "superseded", "archived"] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

/** Allowed status transitions. Every transition needs verified evidence and a Master Register record. */
export const CONTRACT_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  draft: ["ready_for_signature", "archived"],
  ready_for_signature: ["draft", "signed"],
  signed: ["superseded", "archived"],
  superseded: ["archived"],
  archived: [],
}

export function isContractStatus(value: unknown): value is ContractStatus {
  return typeof value === "string" && (CONTRACT_STATUSES as readonly string[]).includes(value)
}

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to)
}

export const AUTHORITY_TYPES = ["SERVICE_DECISION_AUTHORITY", "CONTRACT_SIGNATORY"] as const
export type AuthorityType = (typeof AUTHORITY_TYPES)[number]

export function isAuthorityType(value: unknown): value is AuthorityType {
  return typeof value === "string" && (AUTHORITY_TYPES as readonly string[]).includes(value)
}

export const AUTHORITY_NOTICE_DOCUMENT_TYPE = "CUSTOMER_AUTHORITY_NOTICE"
export const SIGNED_CONTRACT_DOCUMENT_TYPE = "SIGNED_CONTRACT_DOCUMENT"

/** Gate codes returned by tes_security.contract_gate_failures(). */
export const GATE_CODES = [
  "CUSTOMER_RELATIONSHIP",
  "CONTRACT_REFERENCE",
  "SERVICE_SCOPE",
  "RESPONSIBILITY_MATRIX",
  "REQUIRED_SETTINGS",
  "PRICING_PACKAGE",
  "SERVICE_DECISION_AUTHORITY",
  "CONTRACT_SIGNATORY",
  "EVIDENCE_REQUIREMENTS",
  "MASTER_REGISTER_ACCOUNTABILITY",
] as const
export type GateCode = (typeof GATE_CODES)[number]

export const GATE_LABELS: Readonly<Record<GateCode, string>> = {
  CUSTOMER_RELATIONSHIP: "Organization / customer relationship",
  CONTRACT_REFERENCE: "Contract reference",
  SERVICE_SCOPE: "Service scope",
  RESPONSIBILITY_MATRIX: "Responsibility matrix",
  REQUIRED_SETTINGS: "Required settings",
  PRICING_PACKAGE: "Pricing / package definition",
  SERVICE_DECISION_AUTHORITY: "Service Decision Authority",
  CONTRACT_SIGNATORY: "Contract Signatory",
  EVIDENCE_REQUIREMENTS: "Evidence requirements",
  MASTER_REGISTER_ACCOUNTABILITY: "Master Register accountability path",
}

export const PRICING_BASES = ["monthly_package", "one_time_service", "included_in_package"] as const
export type PricingBasis = (typeof PRICING_BASES)[number]

export const FEE_CURRENCIES = ["CAD", "USD"] as const
export type FeeCurrency = (typeof FEE_CURRENCIES)[number]

export const RESPONSIBLE_PARTIES = ["TES", "CUSTOMER", "SHARED"] as const
export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number]

export const HISTORY_TREATMENTS = ["excluded", "customer_retains", "tes_assumes_with_evidence"] as const
export type HistoryTreatment = (typeof HISTORY_TREATMENTS)[number]

/** The 0030 line-item column that mirrors the matrix: TES never assumes pre-engagement history without evidence. */
export type ResponsibilityBoundary = "from_effective_responsibility_date_only" | "customer_retains_history" | "tes_assumes_defined_history_with_evidence"

export function deriveResponsibilityBoundary(treatments: readonly HistoryTreatment[]): ResponsibilityBoundary {
  if (treatments.includes("tes_assumes_with_evidence")) return "tes_assumes_defined_history_with_evidence"
  if (treatments.includes("customer_retains")) return "customer_retains_history"
  return "from_effective_responsibility_date_only"
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,80}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isCode = (value: unknown): value is string => typeof value === "string" && CODE_PATTERN.test(value)
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value)

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}
