/**
 * Server-owned Corporate Identity identifier definitions.
 *
 * Callers supply SEMANTIC input - a kind, a value and (where the kind needs one) a legal jurisdiction. They never supply
 * identifier_type, namespace, normalized_value or a normalization rule version: those are derived here, so the
 * authoritative collision key in PostgreSQL (organization_identifiers_active_identity_uq) cannot be bypassed by a
 * spelling variant of the persistence vocabulary.
 *
 *   INCORPORATION                  the entity's own legal formation number. Country required; region required for the
 *                                  US, optional for Canada (no region = federal).
 *   CRA_BN                         CRA Business Number ROOT (9 digits). Always CA. A program account (RT0001 ...) is
 *                                  NOT a Business Number root and is rejected.
 *   IRS_EIN                        US Employer Identification Number (9 digits). Always US. Independent of BN.
 *   EXTRA_PROVINCIAL_REGISTRATION  registration in a jurisdiction other than the formation jurisdiction. Country and
 *                                  region required. Never the primary corporate identity.
 *
 * Normalization is versioned. A stored normalization_rule_version names a rule that is kept forever in RULES; a changed
 * rule is a NEW version, selected by corporateRegistrationRule(), so historical rows stay interpretable and
 * jurisdiction-specific rules can be added without touching what was already stored.
 */

import { CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"
import {
  parseCountryCode,
  parseOptionalRegion,
  parseRegionCode,
  type CountryCode,
  type Jurisdiction,
} from "@/lib/corporate-identity/jurisdiction"

export const CORPORATE_IDENTIFIER_KINDS = [
  "INCORPORATION",
  "CRA_BN",
  "IRS_EIN",
  "EXTRA_PROVINCIAL_REGISTRATION",
] as const

export type CorporateIdentifierKind = (typeof CORPORATE_IDENTIFIER_KINDS)[number]

export type CorporateIdentifierInput =
  | { kind: "INCORPORATION"; value: string; country: string; region?: string | null }
  | { kind: "CRA_BN"; value: string }
  | { kind: "IRS_EIN"; value: string }
  | { kind: "EXTRA_PROVINCIAL_REGISTRATION"; value: string; country: string; region: string }

/** The persistence form of one identifier, fully derived by this module. */
export type PreparedCorporateIdentifier = {
  kind: CorporateIdentifierKind
  identifierType: string
  namespace: string
  jurisdictionCountry: CountryCode | null
  jurisdictionRegion: string | null
  value: string
  normalizedValue: string
  normalizationRuleVersion: string
}

type PersistenceVocabulary = { identifierType: string; namespace: string }

const VOCABULARY: Record<CorporateIdentifierKind, PersistenceVocabulary> = {
  INCORPORATION: { identifierType: "incorporation_number", namespace: "corporate_registry" },
  CRA_BN: { identifierType: "business_number", namespace: "cra" },
  IRS_EIN: { identifierType: "employer_identification_number", namespace: "irs" },
  EXTRA_PROVINCIAL_REGISTRATION: { identifierType: "extra_provincial_registration", namespace: "corporate_registry" },
}

/** Reverse lookup for reads; undefined for a stored vocabulary this service does not own. */
export function kindForPersistedType(identifierType: string, namespace: string): CorporateIdentifierKind | undefined {
  return CORPORATE_IDENTIFIER_KINDS.find(
    (kind) => VOCABULARY[kind].identifierType === identifierType && VOCABULARY[kind].namespace === namespace,
  )
}

export function persistedVocabularyFor(kind: CorporateIdentifierKind): Readonly<PersistenceVocabulary> {
  return VOCABULARY[kind]
}

// ---------------------------------------------------------------------------------------------------------------
// Versioned normalization rules
// ---------------------------------------------------------------------------------------------------------------

export type NormalizationRule = {
  readonly version: string
  /** Returns the normalized value, or a string describing why the raw value is not acceptable. */
  readonly apply: (raw: string) => { ok: true; normalized: string } | { ok: false; reason: string }
}

const BN_PROGRAM_ACCOUNT = /^\d{9}\s*[A-Za-z]{2}\s*\d{4}$/

const CRA_BN_V1: NormalizationRule = {
  version: "cra_bn.v1",
  apply(raw) {
    const value = raw.trim()
    if (BN_PROGRAM_ACCOUNT.test(value)) {
      return { ok: false, reason: "A CRA program account (for example RT0001) is not a Business Number root; enter the 9-digit root." }
    }
    // 9 digits, optionally grouped 3-3-3 with spaces or hyphens. Anything else is not a BN root.
    if (!/^(\d{9}|\d{3}[ -]\d{3}[ -]\d{3})$/.test(value)) {
      return { ok: false, reason: "A CRA Business Number root is exactly 9 digits." }
    }
    const digits = value.replace(/\D/g, "")
    if (/^0+$/.test(digits)) return { ok: false, reason: "A CRA Business Number root cannot be all zeros." }
    return { ok: true, normalized: digits }
  },
}

const IRS_EIN_V1: NormalizationRule = {
  version: "irs_ein.v1",
  apply(raw) {
    const value = raw.trim()
    if (!/^\d{2}-?\d{7}$/.test(value)) {
      return { ok: false, reason: "An EIN is 9 digits, written 123456789 or 12-3456789." }
    }
    const digits = value.replace(/\D/g, "")
    if (/^0+$/.test(digits)) return { ok: false, reason: "An EIN cannot be all zeros." }
    return { ok: true, normalized: digits }
  },
}

/**
 * Default registry-number rule: letters and digits only, upper case, 3-32 characters, with spaces, hyphens, periods and
 * slashes treated as formatting. Used for INCORPORATION and EXTRA_PROVINCIAL_REGISTRATION until a jurisdiction needs
 * something stricter, which is then added as a NEW version and selected in corporateRegistrationRule().
 */
const CORPORATE_REGISTRATION_DEFAULT_V1: NormalizationRule = {
  version: "corporate_registration.default.v1",
  apply(raw) {
    const normalized = raw.normalize("NFKC").trim().toUpperCase().replace(/[\s\-./]+/g, "")
    if (!/^[A-Z0-9]{3,32}$/.test(normalized)) {
      return { ok: false, reason: "A registration number must be 3-32 letters or digits (spaces, hyphens, periods and slashes are ignored)." }
    }
    return { ok: true, normalized }
  },
}

/** Every rule version ever stored must remain here, unchanged. */
export const NORMALIZATION_RULES: Readonly<Record<string, NormalizationRule>> = {
  [CRA_BN_V1.version]: CRA_BN_V1,
  [IRS_EIN_V1.version]: IRS_EIN_V1,
  [CORPORATE_REGISTRATION_DEFAULT_V1.version]: CORPORATE_REGISTRATION_DEFAULT_V1,
}

/**
 * Selects the rule for a registry-number identifier by kind and jurisdiction. This is the single extension point for
 * jurisdiction-specific incorporation formats: add a new versioned rule above and route to it here. Existing stored
 * versions keep resolving through NORMALIZATION_RULES.
 */
export function corporateRegistrationRule(
  _kind: "INCORPORATION" | "EXTRA_PROVINCIAL_REGISTRATION",
  _jurisdiction: Jurisdiction,
): NormalizationRule {
  return CORPORATE_REGISTRATION_DEFAULT_V1
}

// ---------------------------------------------------------------------------------------------------------------
// Input -> persistence form
// ---------------------------------------------------------------------------------------------------------------

const VALUE_MAX_LENGTH = 64

const ALLOWED_KEYS: Record<CorporateIdentifierKind, readonly string[]> = {
  INCORPORATION: ["kind", "value", "country", "region"],
  CRA_BN: ["kind", "value"],
  IRS_EIN: ["kind", "value"],
  EXTRA_PROVINCIAL_REGISTRATION: ["kind", "value", "country", "region"],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isCorporateIdentifierKind(value: unknown): value is CorporateIdentifierKind {
  return typeof value === "string" && (CORPORATE_IDENTIFIER_KINDS as readonly string[]).includes(value)
}

/**
 * Validates one semantic identifier and derives its persistence form. Unknown keys are rejected, which is what keeps
 * raw persistence vocabulary (identifierType, namespace, normalizedValue, normalizationRuleVersion, jurisdictionCountry
 * ...) out even when a caller bypasses the TypeScript types.
 */
export function prepareCorporateIdentifier(input: unknown, field = "identifier"): PreparedCorporateIdentifier {
  if (!isRecord(input)) throw new CorporateIdentityValidationError(field, `${field} must be an object.`)

  const kind = input.kind
  if (!isCorporateIdentifierKind(kind)) {
    throw new CorporateIdentityValidationError(`${field}.kind`, `${field}.kind must be one of ${CORPORATE_IDENTIFIER_KINDS.join(", ")}.`)
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS[kind].includes(key)) {
      throw new CorporateIdentityValidationError(`${field}.${key}`, `${field}.${key} is not accepted for ${kind}.`)
    }
  }

  const rawValue = input.value
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    throw new CorporateIdentityValidationError(`${field}.value`, `${field}.value is required.`)
  }
  const value = rawValue.trim()
  if (value.length > VALUE_MAX_LENGTH) {
    throw new CorporateIdentityValidationError(`${field}.value`, `${field}.value must not exceed ${VALUE_MAX_LENGTH} characters.`)
  }

  let country: CountryCode | null
  let region: string | null
  let rule: NormalizationRule

  switch (kind) {
    case "CRA_BN":
      country = "CA"
      region = null
      rule = CRA_BN_V1
      break
    case "IRS_EIN":
      country = "US"
      region = null
      rule = IRS_EIN_V1
      break
    case "INCORPORATION": {
      country = parseCountryCode(input.country, `${field}.country`)
      // Canada may incorporate federally (no region); a US entity is always formed in a state.
      region = parseOptionalRegion(country, input.region, `${field}.region`)
      if (country === "US" && region === null) {
        throw new CorporateIdentityValidationError(`${field}.region`, `${field}.region is required for a US incorporation.`)
      }
      rule = corporateRegistrationRule(kind, { country, region })
      break
    }
    case "EXTRA_PROVINCIAL_REGISTRATION": {
      country = parseCountryCode(input.country, `${field}.country`)
      region = parseRegionCode(country, input.region, `${field}.region`)
      rule = corporateRegistrationRule(kind, { country, region })
      break
    }
  }

  const result = rule.apply(value)
  if (!result.ok) throw new CorporateIdentityValidationError(`${field}.value`, result.reason)

  return {
    kind,
    ...VOCABULARY[kind],
    jurisdictionCountry: country,
    jurisdictionRegion: region,
    value,
    normalizedValue: result.normalized,
    normalizationRuleVersion: rule.version,
  }
}

/** The jurisdiction a prepared identifier is registered in (never null for INCORPORATION / EXTRA_PROVINCIAL). */
export function identifierJurisdiction(prepared: PreparedCorporateIdentifier): Jurisdiction | null {
  return prepared.jurisdictionCountry === null
    ? null
    : { country: prepared.jurisdictionCountry, region: prepared.jurisdictionRegion }
}

/** Stable key for detecting two identical identifiers inside one request (mirrors the database collision key). */
export function collisionKey(prepared: PreparedCorporateIdentifier): string {
  return [
    prepared.namespace,
    prepared.identifierType,
    prepared.jurisdictionCountry ?? "",
    prepared.jurisdictionRegion ?? "",
    prepared.normalizedValue,
  ].join("|")
}
