/**
 * Company operating facts for driver onboarding: "enter once, reuse everywhere".
 *
 * Driver onboarding consumes information the company already recorded; it never asks for it again and never keeps a copy. The canonical
 * sources (all read server-side through the existing row-level-security boundary, see operations.readCompanyOperatingFacts):
 *
 *   registration country   organizations.country_code, refined by organization_presentation_jurisdictions (an explicit override) and by active
 *                          organization_identifiers (dual registration)  -> operations.getPresentationContext (unchanged)
 *   operating scope        company_operating_scope_periods: the current active period (CANADA | UNITED_STATES | CANADA_AND_UNITED_STATES)
 *   hazardous materials    company_cargo_category_periods: an active HAZARDOUS_MATERIALS category (the Profile "Cargo Information"), and
 *                          company_rule_applicability_periods for DG_US / DG_CANADA (explicit APPLIES / DOES_NOT_APPLY)
 *   PSP screening          company_rule_applicability_periods, rule PSP
 *   passenger carrying     NO canonical source exists today (no table, column, catalogue code or rule records it). It is reported as a data-model
 *                          gap (see PASSENGER_GAP), never inferred and never guessed to be "No".
 *
 * Principles:
 *  - Missing data is UNKNOWN, never NO. "NO" requires a positive record (cargo information was recorded and does not include hazardous materials,
 *    or an explicit DOES_NOT_APPLY rule).
 *  - Company capabilities decide which application CONTENT is relevant. They never mark an individual driver qualified, endorsed, medically
 *    certified or authorized.
 *  - No "server-only" import: pure functions, testable under Node. The database read lives in operations.ts.
 */

import type { PresentationContext, PresentationCountry } from "@/lib/jurisdiction-context"
import type { NormalizedScope, ScopeKind } from "@/lib/driver-prospects/operating-scope"

export type FactTri = "YES" | "NO" | "UNKNOWN"
export type CompanyOperatingScope = "CANADA" | "UNITED_STATES" | "CANADA_AND_UNITED_STATES"

export type HazmatBasis = "CARGO_CATEGORY" | "RULE_APPLIES" | "RULE_DOES_NOT_APPLY" | "CARGO_RECORDED_WITHOUT_HAZMAT" | "NOT_RECORDED" | "NOT_READABLE"

export interface CompanyOperatingFacts {
  /** Registration country (or explicit presentation override); null with a reason when it cannot be established. */
  registration: PresentationContext
  /** The company's recorded operating scope, or null when none is recorded (or it is not readable by this user). */
  operatingScope: CompanyOperatingScope | null
  hazmat: { value: FactTri; basis: HazmatBasis }
  /** Whether the company's PSP-screening rule applies (company_rule_applicability_periods, rule PSP). */
  psp: { value: FactTri }
  /** Always UNKNOWN today: no canonical record of passenger-carrying operations exists. */
  passengerCarrying: { value: FactTri; basis: "NO_CANONICAL_SOURCE" }
  /** True only when the profile tables could be read for this user. A false value means the facts above are UNKNOWN because of access, not because they are absent. */
  profileReadable: boolean
}

export const PASSENGER_GAP =
  "Passenger-carrying operations are not recorded anywhere in the company's canonical profile (no cargo category, rule, scope value or field exists for them), so TES cannot tell whether this company carries passengers."

export interface HazmatInputs {
  readable: boolean
  /** Active, current cargo category codes; null/empty = none recorded. */
  cargoCodes: string[] | null
  /** Explicit applicability of the dangerous-goods rules (DG_US, DG_CANADA), if recorded. */
  dgRules: Array<{ rule: string; applicability: "APPLIES" | "DOES_NOT_APPLY" }>
}

/** Missing data is UNKNOWN. A hazardous-materials indication anywhere wins (the conservative reading). */
export function deriveHazmat(i: HazmatInputs): CompanyOperatingFacts["hazmat"] {
  if (!i.readable) return { value: "UNKNOWN", basis: "NOT_READABLE" }
  if ((i.cargoCodes ?? []).includes("HAZARDOUS_MATERIALS")) return { value: "YES", basis: "CARGO_CATEGORY" }
  if (i.dgRules.some((r) => r.applicability === "APPLIES")) return { value: "YES", basis: "RULE_APPLIES" }
  if (i.dgRules.length > 0 && i.dgRules.every((r) => r.applicability === "DOES_NOT_APPLY")) return { value: "NO", basis: "RULE_DOES_NOT_APPLY" }
  if ((i.cargoCodes ?? []).length > 0) return { value: "NO", basis: "CARGO_RECORDED_WITHOUT_HAZMAT" }
  return { value: "UNKNOWN", basis: "NOT_RECORDED" }
}

export const UNKNOWN_FACTS = (registration: PresentationContext): CompanyOperatingFacts => ({
  registration,
  operatingScope: null,
  hazmat: { value: "UNKNOWN", basis: "NOT_READABLE" },
  psp: { value: "UNKNOWN" },
  passengerCarrying: { value: "UNKNOWN", basis: "NO_CANONICAL_SOURCE" },
  profileReadable: false,
})

// ------------------------------------------------------------------------------------------------------------------------------
// Intended Operation: the six choices, their stable canonical values and their order
// ------------------------------------------------------------------------------------------------------------------------------

/**
 * Stable canonical values (the existing scope kinds, independent of display labels):
 *   CA_INTERPROVINCIAL  Canada wide        CROSS_BORDER  Cross border        US_INTERSTATE  US wide
 *   CA_INTRAPROVINCIAL  Canada Intraprovince       US_INTRASTATE  US Intrastate       UNDETERMINED  Not yet decided
 * (MIXED remains a valid stored kind for earlier records but is no longer offered.)
 */
export type IntendedOperation = Extract<ScopeKind, "CA_INTERPROVINCIAL" | "CROSS_BORDER" | "US_INTERSTATE" | "CA_INTRAPROVINCIAL" | "US_INTRASTATE" | "UNDETERMINED">

export const INTENDED_OPERATION_LABEL: Record<IntendedOperation, string> = {
  CA_INTERPROVINCIAL: "Canada wide",
  CROSS_BORDER: "Cross border",
  US_INTERSTATE: "US wide",
  CA_INTRAPROVINCIAL: "Canada Intraprovince",
  US_INTRASTATE: "US Intrastate",
  UNDETERMINED: "Not yet decided",
}

const CA_ORDER: IntendedOperation[] = ["CA_INTERPROVINCIAL", "CROSS_BORDER", "US_INTERSTATE", "CA_INTRAPROVINCIAL", "US_INTRASTATE", "UNDETERMINED"]
const US_ORDER: IntendedOperation[] = ["US_INTERSTATE", "CROSS_BORDER", "CA_INTERPROVINCIAL", "US_INTRASTATE", "CA_INTRAPROVINCIAL", "UNDETERMINED"]
/** Used only when the registration country cannot be established: neither country is favoured. */
const NEUTRAL_ORDER: IntendedOperation[] = ["CROSS_BORDER", "CA_INTERPROVINCIAL", "US_INTERSTATE", "CA_INTRAPROVINCIAL", "US_INTRASTATE", "UNDETERMINED"]

/** All six options are always available; the registration country decides ONLY the display order. */
export function orderIntendedOperations(country: PresentationCountry | null): IntendedOperation[] {
  return [...(country === "CA" ? CA_ORDER : country === "US" ? US_ORDER : NEUTRAL_ORDER)]
}
export const DEFAULT_INTENDED_OPERATION: IntendedOperation = "UNDETERMINED"

// ------------------------------------------------------------------------------------------------------------------------------
// Applying company facts to the driver's intended operation
// ------------------------------------------------------------------------------------------------------------------------------

export interface NeedsAttention {
  id: string
  text: string
}

export interface EffectiveScope {
  scope: NormalizedScope
  /** Open items for staff. Nothing here silently removes application content. */
  needsAttention: NeedsAttention[]
}

const usKinds = (s: NormalizedScope) => s.kind === "US_INTRASTATE" || s.kind === "US_INTERSTATE" || s.kind === "CROSS_BORDER" || s.components.some((c) => c === "US_INTRASTATE" || c === "US_INTERSTATE" || c === "CROSS_BORDER")

/**
 * Derives the application characteristics from the intended operation and the company's recorded facts. The same function is used by the
 * browser preview and the server issuance, so the preview is exactly what the server decides.
 *
 *  - U.S. operations: the commercial-motor-vehicle and CDL questions are not asked. The federal driver-qualification sections are INCLUDED
 *    (the safe superset) and the applicability is flagged for staff to confirm against the driver's actual vehicles. A characteristic a
 *    staff member already recorded explicitly for this driver (earlier records) is kept.
 *  - Hazardous materials: YES -> hazmat content is included; UNKNOWN -> included and flagged (never silently excluded); NO -> not added.
 *  - PSP: included when the company's PSP rule applies (or the earlier per-driver choice was made).
 *  - Passenger carrying: no canonical source -> not added, and the gap is flagged (never assumed to be "No").
 */
export function applyCompanyFacts(scope: NormalizedScope, facts: CompanyOperatingFacts): EffectiveScope {
  const needsAttention: NeedsAttention[] = []
  const c = { ...scope.characteristics }
  const us = usKinds(scope)

  if (us) {
    let derived = false
    if (c.cmvOperation === "UNKNOWN") { c.cmvOperation = "YES"; derived = true }
    if (c.cmvOperation === "YES" && c.cdlRequired === "UNKNOWN") { c.cdlRequired = "YES"; derived = true }
    if (derived) needsAttention.push({ id: "company_fact.us_cmv_presumed", text: "U.S. commercial-motor-vehicle and CDL applicability is derived from the intended operation, not asked. The federal sections are included; confirm against the vehicles this driver will actually operate." })
  }

  if (facts.hazmat.value === "YES") c.hazmat = true
  else if (facts.hazmat.value === "UNKNOWN") {
    c.hazmat = true
    needsAttention.push({
      id: "company_fact.hazmat_unknown",
      text: facts.hazmat.basis === "NOT_READABLE"
        ? "The company's Cargo Information could not be read for this user, so whether the company transports hazardous materials is unknown. Hazardous-materials questions are included until it is confirmed."
        : "The company has not recorded its Cargo Information, so whether it transports hazardous materials is unknown. Hazardous-materials questions are included until the Profile is completed.",
    })
  }
  // NO: leaves any earlier per-driver value untouched; nothing is added solely by company configuration.

  if (facts.psp.value === "YES" && c.cmvOperation === "YES") c.pspIntended = true

  if (facts.passengerCarrying.value === "UNKNOWN") {
    needsAttention.push({ id: "company_fact.passenger_not_recorded", text: `${PASSENGER_GAP} Passenger-related questions are not added automatically; confirm whether they apply to this driver.` })
  } else if (facts.passengerCarrying.value === "YES") c.passengerCarrying = true

  if (facts.registration.country === null) {
    needsAttention.push({ id: "company_fact.registration_country_unresolved", text: `${facts.registration.reason ?? "The company's registration country is not established."} The application is not tailored to the company's country.` })
  }

  return { scope: { ...scope, characteristics: c }, needsAttention }
}
