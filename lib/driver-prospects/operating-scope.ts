import { JURISDICTIONS } from "@/lib/jurisdictions"

/**
 * Intended operating scope of a prospective driver, and the hiring-application requirements that follow from it.
 *
 * Principles (TES Customer-Jurisdiction Context Policy):
 *  - The scope describes what THIS driver will do. It is never inferred from the employer's registration, authorities, address or other drivers.
 *  - Selecting a scope does not establish that the driver is legally qualified; it only decides which application sections and consents are issued.
 *  - Where this module cannot safely decide (undetermined scope, unknown CMV/CDL status for U.S. operations) issuance is BLOCKED with a reason.
 *  - The rules below are an application-content baseline, not a legal rules engine. `limitations` lists what is NOT evaluated.
 */

export const SCOPE_RULES_VERSION = "2026-10-v2"

export const BASE_SCOPE_KINDS = ["US_INTRASTATE", "US_INTERSTATE", "CA_INTRAPROVINCIAL", "CA_INTERPROVINCIAL", "CROSS_BORDER"] as const
export const SCOPE_KINDS = [...BASE_SCOPE_KINDS, "MIXED", "UNDETERMINED"] as const
export type BaseScopeKind = (typeof BASE_SCOPE_KINDS)[number]
export type ScopeKind = (typeof SCOPE_KINDS)[number]
export type Tri = "YES" | "NO" | "UNKNOWN"

export const SCOPE_LABEL: Record<ScopeKind, string> = {
  US_INTRASTATE: "U.S. intrastate (one state)",
  US_INTERSTATE: "U.S. interstate (two or more states)",
  CA_INTRAPROVINCIAL: "Canadian intraprovincial (one province or territory)",
  CA_INTERPROVINCIAL: "Canadian interprovincial (two or more provinces or territories)",
  CROSS_BORDER: "Canada–U.S. cross-border",
  MIXED: "Mixed or changing assignments",
  UNDETERMINED: "Not yet determined",
}

export interface ScopeCharacteristics {
  /** Will the driver operate a commercial motor vehicle (as defined for the operation, e.g. by weight, hazmat or passenger use)? */
  cmvOperation: Tri
  /** Is a commercial driver's licence required for the vehicles the driver will operate? (decides U.S. Clearinghouse applicability) */
  cdlRequired: Tri
  /** The carrier intends to request an FMCSA PSP report for this driver. */
  pspIntended: boolean
  hazmat: boolean
  passengerCarrying: boolean
}

export interface ScopeInput {
  kind: string
  components?: string[]
  usJurisdictions?: string[]
  caJurisdictions?: string[]
  characteristics?: Partial<Record<keyof ScopeCharacteristics, unknown>>
}

export interface NormalizedScope {
  kind: ScopeKind
  components: BaseScopeKind[]
  usJurisdictions: string[]
  caJurisdictions: string[]
  characteristics: ScopeCharacteristics
}

export type ApplicationRegion = "Canada" | "United States" | "Cross-Border"

export interface RequirementsProfile {
  version: string
  scopeKind: ScopeKind
  applicationRegion: ApplicationRegion
  /** Continuous employment history the application collects. */
  employmentHistoryYears: 3 | 10
  /** Regulated sections the application shows. Absent here = not shown at all. */
  sections: { clearinghouse: boolean; psp: boolean; dotDrugAlcoholHistory: boolean }
  /** Pre-employment verification TES expects to perform or request for this driver (informational for staff; consents are separate). */
  verification: string[]
  /** Requirements this application does NOT collect or evaluate and that staff must verify outside it. */
  manualVerification: string[]
  usJurisdictions: string[]
  caJurisdictions: string[]
}

export type ScopeEvaluation =
  | { issuable: true; reason: null; profile: RequirementsProfile; limitations: string[] }
  | { issuable: false; reason: string; profile: null; limitations: string[] }

const CA_CODES = new Set(JURISDICTIONS.filter((j) => j.country === "Canada").map((j) => j.code))
const US_CODES = new Set(JURISDICTIONS.filter((j) => j.country === "United States").map((j) => j.code))
const tri = (v: unknown): Tri => (v === "YES" || v === "NO" ? v : "UNKNOWN")
const codes = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))].sort()

export const involvesUS = (s: Pick<NormalizedScope, "kind" | "components" | "usJurisdictions">) =>
  s.usJurisdictions.length > 0 || s.kind === "US_INTRASTATE" || s.kind === "US_INTERSTATE" || s.kind === "CROSS_BORDER" || s.components.some((c) => c === "US_INTRASTATE" || c === "US_INTERSTATE" || c === "CROSS_BORDER")
export const involvesCanada = (s: Pick<NormalizedScope, "kind" | "components" | "caJurisdictions">) =>
  s.caJurisdictions.length > 0 || s.kind === "CA_INTRAPROVINCIAL" || s.kind === "CA_INTERPROVINCIAL" || s.kind === "CROSS_BORDER" || s.components.some((c) => c === "CA_INTRAPROVINCIAL" || c === "CA_INTERPROVINCIAL" || c === "CROSS_BORDER")

/** Normalizes and validates a scope as entered. The shape rules mirror the database CHECK on driver_prospect_operating_scopes. */
export function validateScopeInput(input: ScopeInput): { ok: true; value: NormalizedScope } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const kind = (SCOPE_KINDS as readonly string[]).includes(input.kind) ? (input.kind as ScopeKind) : null
  if (!kind) return { ok: false, errors: ["Choose an operating scope."] }
  const us = codes(input.usJurisdictions)
  const ca = codes(input.caJurisdictions)
  const components = [...new Set(input.components ?? [])].filter((c): c is BaseScopeKind => (BASE_SCOPE_KINDS as readonly string[]).includes(c))
  if (us.some((c) => !US_CODES.has(c))) errors.push("A U.S. state or district code is not recognized.")
  if (ca.some((c) => !CA_CODES.has(c))) errors.push("A Canadian province or territory code is not recognized.")
  const c = input.characteristics ?? {}
  const characteristics: ScopeCharacteristics = {
    cmvOperation: tri(c.cmvOperation),
    cdlRequired: tri(c.cdlRequired),
    pspIntended: c.pspIntended === true,
    hazmat: c.hazmat === true,
    passengerCarrying: c.passengerCarrying === true,
  }
  const n = { kind, components: kind === "MIXED" ? components : [], usJurisdictions: us, caJurisdictions: ca }
  // Jurisdictions are OPTIONAL: onboarding no longer asks which states or provinces the driver will visit (the intended operation decides the
  // regulatory scope). When earlier records or other callers supply them, they must still be consistent with the kind.
  switch (kind) {
    case "US_INTRASTATE": if (us.length > 1 || ca.length) errors.push("U.S. intrastate means at most one state and no Canadian jurisdiction."); break
    case "US_INTERSTATE": if (ca.length) errors.push("U.S. wide operation has no Canadian jurisdiction."); break
    case "CA_INTRAPROVINCIAL": if (ca.length > 1 || us.length) errors.push("Canadian intraprovincial means at most one province or territory and no U.S. jurisdiction."); break
    case "CA_INTERPROVINCIAL": if (us.length) errors.push("Canada wide operation has no U.S. jurisdiction."); break
    case "CROSS_BORDER": break
    case "MIXED":
      // Kept for earlier records only; no longer offered.
      if (components.length < 2) errors.push("Mixed or changing assignments needs at least two operation types.")
      if (!errors.length) {
        const needUS = components.some((x) => x !== "CA_INTRAPROVINCIAL" && x !== "CA_INTERPROVINCIAL")
        const needCA = components.some((x) => x !== "US_INTRASTATE" && x !== "US_INTERSTATE")
        if (needUS && !us.length) errors.push("List the U.S. states the assignments may cover.")
        if (needCA && !ca.length) errors.push("List the Canadian provinces or territories the assignments may cover.")
      }
      break
    case "UNDETERMINED": if (us.length || ca.length) errors.push("An undetermined scope has no jurisdictions yet."); break
  }
  if (characteristics.pspIntended && !involvesUS(n)) errors.push("An FMCSA PSP request applies only to operations in the United States.")
  return errors.length ? { ok: false, errors } : { ok: true, value: { ...n, characteristics } }
}

/**
 * Re-saving an existing driver's scope must never drop what is already recorded. A field the caller OMITS (undefined) keeps its stored value; a field the
 * caller supplies, even as an empty list, is honoured. The new onboarding form sends only the intended operation, so earlier states, provinces,
 * assignments and hazmat / passenger / CMV / CDL / PSP flags survive. If the stored values cannot coexist with a changed kind (for example two stored
 * states and a new "US Intrastate"), the incompatible part is not carried; the earlier version remains stored, unchanged, in the scope history.
 */
export function mergeScopeInput(input: ScopeInput, current: NormalizedScope | null): ScopeInput {
  if (!current) return input
  const characteristics = { ...current.characteristics, ...Object.fromEntries(Object.entries(input.characteristics ?? {}).filter(([, v]) => v !== undefined)) }
  const full: ScopeInput = {
    ...input,
    components: input.components ?? current.components,
    usJurisdictions: input.usJurisdictions ?? current.usJurisdictions,
    caJurisdictions: input.caJurisdictions ?? current.caJurisdictions,
    characteristics,
  }
  if (validateScopeInput(full).ok) return full
  const characteristicsOnly: ScopeInput = { ...input, characteristics }
  if (validateScopeInput(characteristicsOnly).ok) return characteristicsOnly
  // A PSP request cannot follow the driver into a kind with no U.S. operation; every other stored flag still does.
  const withoutPsp: ScopeInput = { ...input, characteristics: { ...characteristics, pspIntended: false } }
  return validateScopeInput(withoutPsp).ok ? withoutPsp : input
}

const LIMITATIONS = [
  "Selecting an operating scope does not establish that the driver is eligible or qualified; it decides which application sections and consents are issued.",
  "State, provincial and territorial rules (including intrastate adoption of federal rules, exemptions, age and medical requirements, and Alberta's carrier history rule) are not evaluated by TES; staff must verify them.",
  "Vehicle thresholds, endorsement eligibility and other operation-specific requirements are collected or flagged for staff but not evaluated. Company capabilities (for example hazardous materials) decide which application content is relevant; they never mark a driver qualified, endorsed or authorized.",
]

/** Decides whether an application can be issued for this scope and, if so, exactly what it contains. */
export function evaluateScope(scope: NormalizedScope | null): ScopeEvaluation {
  if (!scope || scope.kind === "UNDETERMINED") {
    return { issuable: false, reason: "The driver's intended operation is not decided. Choose the intended operation before sending an application.", profile: null, limitations: LIMITATIONS }
  }
  const us = involvesUS(scope)
  const ca = involvesCanada(scope)
  const ch = scope.characteristics
  if (us && ch.cmvOperation === "UNKNOWN") {
    return { issuable: false, reason: "Establish whether the driver will operate a commercial motor vehicle in the United States before sending an application.", profile: null, limitations: LIMITATIONS }
  }
  if (us && ch.cmvOperation === "YES" && ch.cdlRequired === "UNKNOWN") {
    return { issuable: false, reason: "Establish whether a commercial driver's licence is required for the U.S. operation before sending an application.", profile: null, limitations: LIMITATIONS }
  }
  const usCmv = us && ch.cmvOperation === "YES"
  const usCdl = usCmv && ch.cdlRequired === "YES"
  const verification: string[] = ["Driver licence and driver record / abstract verification, where permitted and applicable"]
  if (ca) verification.push("Canadian driver abstract and carrier-record checks as applicable to the province or territory (not evaluated by TES)")
  if (usCdl) verification.push("FMCSA Drug & Alcohol Clearinghouse limited query (requires the driver's specific consent)")
  if (usCmv && ch.pspIntended) verification.push("FMCSA PSP report (requires the standalone PSP disclosure and authorization)")
  const manual: string[] = []
  if (scope.kind === "US_INTRASTATE" || scope.components.includes("US_INTRASTATE")) manual.push(`Intrastate requirements of ${scope.usJurisdictions.join(", ") || "the state"} (adoption of federal rules, exemptions, age and medical standards) must be verified.`)
  if (us && ch.cmvOperation === "NO") manual.push("The driver is not expected to operate a commercial motor vehicle in the United States; FMCSA driver-qualification and testing requirements are not applied. Verify this remains true.")
  if (ca) manual.push("Provincial or territorial driver and carrier requirements are not evaluated; TES applies a three-year employment-history baseline.")
  if (ch.hazmat) manual.push("Hazardous-materials qualification is collected as a self-declaration with supporting evidence; its validity and the driver's eligibility are not evaluated by TES and must be verified.")
  if (ch.passengerCarrying) manual.push("Passenger-carrying qualification is collected as a self-declaration with supporting evidence; its validity and the driver's eligibility are not evaluated by TES and must be verified.")
  const profile: RequirementsProfile = {
    version: SCOPE_RULES_VERSION,
    scopeKind: scope.kind,
    applicationRegion: us && ca ? "Cross-Border" : us ? "United States" : "Canada",
    employmentHistoryYears: usCdl ? 10 : 3,
    sections: { clearinghouse: usCdl, psp: usCmv && ch.pspIntended, dotDrugAlcoholHistory: usCdl },
    verification,
    manualVerification: manual,
    usJurisdictions: scope.usJurisdictions,
    caJurisdictions: scope.caJurisdictions,
  }
  return { issuable: true, reason: null, profile, limitations: LIMITATIONS }
}

/** Rebuilds a normalized scope from a stored row (used by the service). */
export function scopeFromRow(row: { scope_kind: string; components: string[]; us_jurisdictions: string[]; ca_jurisdictions: string[]; characteristics: Record<string, unknown> }): NormalizedScope | null {
  const v = validateScopeInput({ kind: row.scope_kind, components: row.components, usJurisdictions: row.us_jurisdictions, caJurisdictions: row.ca_jurisdictions, characteristics: row.characteristics })
  return v.ok ? v.value : null
}
