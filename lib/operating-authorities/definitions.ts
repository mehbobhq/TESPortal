/**
 * Server-owned authority kind definitions, number normalization and status vocabulary.
 *
 * PostgreSQL's authority_kinds catalogue (migration 0013) is the persisted source of truth for which kinds exist and
 * for their jurisdiction / expiry / concurrency shape; the database triggers and indexes enforce that shape. This module
 * owns the pieces the database cannot express - the per-kind number normalization rules (versioned, kept forever) - and
 * a drift test proves the two agree.
 *
 * Collision namespace per kind (the legally meaningful number space):
 *   USDOT, MC           NATIONAL           one US-wide number space
 *   MVID                COUNTRY_REGION     per issuing province / territory
 *   RIN, CVOR           COUNTRY_REGION     Ontario programs (region fixed to ON)
 *
 * MC records the regulatory DOCKET NUMBER (the canonical MC identity). Individual operating-authority entitlements that
 * share a docket (legacy FMCSA records) or that have their own docket (Motus) are a deferred, additive child concept; see
 * the migration header and docs/operating-authorities-regulatory-semantics.md.
 *   SAFETY_FITNESS      COUNTRY_REGION     per issuing province / territory (NSC number / safety fitness certificate)
 *   IRP                 BASE_JURISDICTION  per base jurisdiction (CA province or US state); the base may change over time
 *
 * Number validation is classified per kind and the rule NAME says which:
 *   AUTHORITATIVE   the exact format is documented by the issuing regulator (CVOR: nine digits, Ontario MTO)
 *   PERMISSIVE      the issuing format is not authoritatively locked; the rule only guarantees a safe, comparable token
 *                   (rule names contain "permissive" and are NOT regulatory-format validation)
 * Tightening a rule is done by adding a NEW rule version (v2, v3 ...) and pointing the kind at it. Every version ever
 * stored stays resolvable in NORMALIZATION_RULES, so historical records are never rewritten or re-validated.
 */

import { CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"
import { parseCountryCode, parseRegionCode } from "@/lib/corporate-identity/jurisdiction"
import { OperatingAuthorityValidationError } from "@/lib/operating-authorities/errors"

export const AUTHORITY_KINDS = ["USDOT", "MC", "MVID", "RIN", "CVOR", "SAFETY_FITNESS", "IRP"] as const
export type AuthorityKind = (typeof AUTHORITY_KINDS)[number]

export const AUTHORITY_STATUSES = ["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED", "REVOKED", "CANCELED"] as const
export type AuthorityStatus = (typeof AUTHORITY_STATUSES)[number]

export type JurisdictionScope = "NATIONAL" | "COUNTRY_REGION" | "BASE_JURISDICTION"

export function isAuthorityKind(value: unknown): value is AuthorityKind {
  return typeof value === "string" && (AUTHORITY_KINDS as readonly string[]).includes(value)
}

export function isAuthorityStatus(value: unknown): value is AuthorityStatus {
  return typeof value === "string" && (AUTHORITY_STATUSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------------------------------------------
// Versioned number normalization
// ---------------------------------------------------------------------------------------------------------------

export type RuleClassification = "AUTHORITATIVE" | "PERMISSIVE"

export type NormalizationRule = {
  readonly version: string
  readonly classification: RuleClassification
  /** Where an AUTHORITATIVE format comes from; absent for PERMISSIVE rules. */
  readonly source?: string
  readonly apply: (raw: string) => { ok: true; normalized: string } | { ok: false; reason: string }
}

const stripLeadingZeros = (digits: string): string => digits.replace(/^0+/, "")

/**
 * FMCSA numbers (USDOT; MC docket) are numeric but FMCSA does not publish a stable length, and it has announced changes
 * to how docket numbers are issued, so only "digits" is asserted. An optional kind prefix is display convention. Leading
 * zeros are not significant (treating them as equal can only make collision protection stricter).
 */
function numericPermissiveRule(version: string, prefix: RegExp, label: string): NormalizationRule {
  return {
    version,
    classification: "PERMISSIVE",
    apply(raw) {
      const body = raw.normalize("NFKC").trim().replace(prefix, "").replace(/[\s-]/g, "")
      if (!/^\d{1,12}$/.test(body)) return { ok: false, reason: `${label} must be digits (an optional prefix and spaces or hyphens are accepted).` }
      const normalized = stripLeadingZeros(body)
      return normalized === "" ? { ok: false, reason: `${label} cannot be zero.` } : { ok: true, normalized }
    },
  }
}

const USDOT_PERMISSIVE = numericPermissiveRule("usdot.numeric_permissive.v1", /^(?:US\s*DOT|USDOT|DOT)\s*[#:\-]?\s*/i, "A USDOT number")

/**
 * MC kind = MC-prefixed FMCSA dockets only. FF (freight forwarder) and MX (Mexico-domiciled) dockets are different
 * prefixes of the same docket system; they are out of scope for this kind (not a format judgement), so they are refused
 * rather than silently stored as MC numbers.
 */
const MC_PERMISSIVE: NormalizationRule = (() => {
  const numeric = numericPermissiveRule("mc.numeric_permissive.v1", /^MC\s*[#:\-]?\s*/i, "An MC number")
  return {
    ...numeric,
    apply(raw) {
      if (/^(?:FF|MX)\b/i.test(raw.normalize("NFKC").trim())) {
        return { ok: false, reason: "FF (freight forwarder) and MX (Mexico) dockets are not MC dockets; this kind records MC dockets only." }
      }
      return numeric.apply(raw)
    },
  }
})()

/**
 * CVOR: nine digits (spaces and hyphens are formatting, not part of the number). The Ontario Ministry of Transportation
 * states that the CVOR certificate carries a unique nine-digit identification number (Commercial Vehicle Operators'
 * Safety Manual); the ministry does not document check digits or reserved ranges, so none are asserted. Digits are
 * kept as issued.
 */
const CVOR_NINE_DIGIT: NormalizationRule = {
  version: "cvor.ontario_nine_digit.v1",
  classification: "AUTHORITATIVE",
  source: "Ontario MTO Commercial Vehicle Operators' Safety Manual: the CVOR certificate carries a unique nine-digit identification number",
  apply(raw) {
    const body = raw.normalize("NFKC").trim().replace(/[\s-]/g, "")
    return /^\d{9}$/.test(body) ? { ok: true, normalized: body } : { ok: false, reason: "A CVOR number is nine digits." }
  },
}

/**
 * The issuing format is not authoritatively locked (MVID, NSC / safety fitness numbers and IRP account numbers are
 * issued by many jurisdictions, each with its own format; the Ontario RIN is described by ServiceOntario forms as a
 * 9-digit number, but no published format specification was available, so it is not asserted). The rule keeps letters and digits only (case, spaces,
 * hyphens, periods and slashes ignored) so numbers are comparable and safe to index. NOT regulatory-format validation.
 */
const IDENTIFIER_PERMISSIVE: NormalizationRule = {
  version: "authority_identifier.permissive.v1",
  classification: "PERMISSIVE",
  apply(raw) {
    const normalized = raw.normalize("NFKC").trim().toUpperCase().replace(/[\s\-./]+/g, "")
    return /^[A-Z0-9]{1,32}$/.test(normalized)
      ? { ok: true, normalized }
      : { ok: false, reason: "The number must be 1-32 letters or digits (spaces, hyphens, periods and slashes are ignored)." }
  },
}

/** Every rule version ever stored must remain here, unchanged. */
export const NORMALIZATION_RULES: Readonly<Record<string, NormalizationRule>> = {
  [USDOT_PERMISSIVE.version]: USDOT_PERMISSIVE,
  [MC_PERMISSIVE.version]: MC_PERMISSIVE,
  [CVOR_NINE_DIGIT.version]: CVOR_NINE_DIGIT,
  [IDENTIFIER_PERMISSIVE.version]: IDENTIFIER_PERMISSIVE,
}

// ---------------------------------------------------------------------------------------------------------------
// Kind definitions (must agree with the authority_kinds catalogue; a drift test proves it)
// ---------------------------------------------------------------------------------------------------------------

export type KindDefinition = {
  readonly kind: AuthorityKind
  readonly jurisdictionScope: JurisdictionScope
  /** The single issuing country, or null when several are supported. */
  readonly issuerCountry: "US" | "CA" | null
  readonly regionRequired: boolean
  readonly fixedRegion: string | null
  readonly hasExpiry: boolean
  /**
   * Whether regulator documentation supports at most one CURRENT record per Organization. Only USDOT does; for every
   * other kind the number (unique in its namespace) is what distinguishes records.
   */
  readonly oneCurrentPerOrganization: boolean
  /** Current normalization rule. Older stored versions remain resolvable through NORMALIZATION_RULES. */
  readonly rule: NormalizationRule
}

export const KIND_DEFINITIONS: Readonly<Record<AuthorityKind, KindDefinition>> = {
  USDOT: { kind: "USDOT", jurisdictionScope: "NATIONAL", issuerCountry: "US", regionRequired: false, fixedRegion: null, hasExpiry: false, oneCurrentPerOrganization: true, rule: USDOT_PERMISSIVE },
  MC: { kind: "MC", jurisdictionScope: "NATIONAL", issuerCountry: "US", regionRequired: false, fixedRegion: null, hasExpiry: false, oneCurrentPerOrganization: false, rule: MC_PERMISSIVE },
  MVID: { kind: "MVID", jurisdictionScope: "COUNTRY_REGION", issuerCountry: "CA", regionRequired: true, fixedRegion: null, hasExpiry: false, oneCurrentPerOrganization: false, rule: IDENTIFIER_PERMISSIVE },
  RIN: { kind: "RIN", jurisdictionScope: "COUNTRY_REGION", issuerCountry: "CA", regionRequired: true, fixedRegion: "ON", hasExpiry: false, oneCurrentPerOrganization: false, rule: IDENTIFIER_PERMISSIVE },
  CVOR: { kind: "CVOR", jurisdictionScope: "COUNTRY_REGION", issuerCountry: "CA", regionRequired: true, fixedRegion: "ON", hasExpiry: true, oneCurrentPerOrganization: false, rule: CVOR_NINE_DIGIT },
  SAFETY_FITNESS: { kind: "SAFETY_FITNESS", jurisdictionScope: "COUNTRY_REGION", issuerCountry: "CA", regionRequired: true, fixedRegion: null, hasExpiry: true, oneCurrentPerOrganization: false, rule: IDENTIFIER_PERMISSIVE },
  IRP: { kind: "IRP", jurisdictionScope: "BASE_JURISDICTION", issuerCountry: null, regionRequired: true, fixedRegion: null, hasExpiry: false, oneCurrentPerOrganization: false, rule: IDENTIFIER_PERMISSIVE },
}

export type PreparedNumber = { display: string; normalized: string; ruleVersion: string }

export function prepareAuthorityNumber(kind: AuthorityKind, value: unknown, field = "number"): PreparedNumber {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OperatingAuthorityValidationError(field, `${field} is required.`)
  }
  const display = value.normalize("NFC").replace(/\s+/g, " ").trim()
  if (display.length > 40) throw new OperatingAuthorityValidationError(field, `${field} must not exceed 40 characters.`)
  const rule = KIND_DEFINITIONS[kind].rule
  const result = rule.apply(display)
  if (!result.ok) throw new OperatingAuthorityValidationError(field, result.reason)
  return { display, normalized: result.normalized, ruleVersion: rule.version }
}

// ---------------------------------------------------------------------------------------------------------------
// Jurisdiction
// ---------------------------------------------------------------------------------------------------------------

export type JurisdictionInput = { country?: string; region: string }
export type ResolvedJurisdiction = { country: string; region: string | null }

function viaJurisdiction<T>(field: string, parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof CorporateIdentityValidationError) throw new OperatingAuthorityValidationError(field, error.message)
    throw error
  }
}

/**
 * Resolves the issuing jurisdiction of one version from the caller's input and the kind's rules. National kinds take no
 * jurisdiction (it is the issuing country); CVOR defaults to its fixed region; everything else needs a region.
 */
export function resolveJurisdiction(kind: AuthorityKind, input: unknown, field = "jurisdiction"): ResolvedJurisdiction {
  const definition = KIND_DEFINITIONS[kind]
  const provided = input !== undefined && input !== null

  if (definition.jurisdictionScope === "NATIONAL") {
    if (provided) throw new OperatingAuthorityValidationError(field, `${kind} is a national number; it takes no jurisdiction.`)
    return { country: definition.issuerCountry as string, region: null }
  }

  if (!provided) {
    if (definition.fixedRegion) return { country: definition.issuerCountry as string, region: definition.fixedRegion }
    throw new OperatingAuthorityValidationError(field, `${field} is required for ${kind}.`)
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    throw new OperatingAuthorityValidationError(field, `${field} must be an object.`)
  }
  const source = input as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (key !== "country" && key !== "region") {
      throw new OperatingAuthorityValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
    }
  }

  const country = viaJurisdiction(`${field}.country`, () =>
    parseCountryCode(source.country ?? definition.issuerCountry, `${field}.country`),
  )
  if (definition.issuerCountry && country !== definition.issuerCountry) {
    throw new OperatingAuthorityValidationError(`${field}.country`, `${kind} is issued in ${definition.issuerCountry}.`)
  }
  const region = viaJurisdiction(`${field}.region`, () => parseRegionCode(country, source.region, `${field}.region`))
  if (definition.fixedRegion && region !== definition.fixedRegion) {
    throw new OperatingAuthorityValidationError(`${field}.region`, `${kind} is issued in ${definition.fixedRegion}.`)
  }
  return { country, region }
}

// ---------------------------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------------------------
//
// The status history records OBSERVED regulatory status. There is deliberately no universal transition matrix and no
// archive-by-status rule here: which changes are legally possible differs by regulator and kind, so kind-specific
// transition policy belongs to the Rules / authority-policy layer. The only checks the foundation makes are
// integrity checks (the status must differ from the current one, the record must not be archived, and business time
// must move forward). Archive is TES record lifecycle and is independent of regulatory status.
