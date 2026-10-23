import { JURISDICTIONS, type JurisdictionOption } from "@/lib/jurisdictions"
import { SCOPE_KINDS, type ScopeKind } from "@/lib/driver-prospects/operating-scope"

/**
 * Customer-Jurisdiction Context: the company's primary PRESENTATION jurisdiction decides what staff see FIRST (ordering and terminology).
 * It never decides regulatory applicability, and the other country always remains available.
 */
export type PresentationCountry = "US" | "CA"
export type PresentationBasis = "EXPLICIT" | "REGISTRATION" | "UNRESOLVED"
export interface PresentationContext {
  country: PresentationCountry | null
  basis: PresentationBasis
  /** Why an explicit selection is required, when it is. */
  reason: string | null
}

const US_FIRST: ScopeKind[] = ["US_INTRASTATE", "US_INTERSTATE", "CROSS_BORDER", "CA_INTRAPROVINCIAL", "CA_INTERPROVINCIAL", "MIXED", "UNDETERMINED"]
const CA_FIRST: ScopeKind[] = ["CA_INTRAPROVINCIAL", "CA_INTERPROVINCIAL", "CROSS_BORDER", "US_INTRASTATE", "US_INTERSTATE", "MIXED", "UNDETERMINED"]

/** Scope options with the company's domestic options first. With no established presentation country the neutral order is used (no assumption). */
export function orderScopeKinds(country: PresentationCountry | null): ScopeKind[] {
  if (country === "US") return US_FIRST
  if (country === "CA") return CA_FIRST
  return [...SCOPE_KINDS]
}

export interface JurisdictionGroup {
  country: "United States" | "Canada"
  /** "State" or "Province / territory". */
  term: string
  options: JurisdictionOption[]
}

/** Both countries' jurisdictions, the presentation country's group first. */
export function jurisdictionGroups(country: PresentationCountry | null): JurisdictionGroup[] {
  const us: JurisdictionGroup = { country: "United States", term: "State", options: JURISDICTIONS.filter((j) => j.country === "United States") }
  const ca: JurisdictionGroup = { country: "Canada", term: "Province / territory", options: JURISDICTIONS.filter((j) => j.country === "Canada") }
  return country === "CA" ? [ca, us] : [us, ca]
}

export const presentationLabel = (country: PresentationCountry) => (country === "US" ? "United States" : "Canada")
