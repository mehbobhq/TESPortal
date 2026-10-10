/**
 * Server-owned authority kind definitions, number normalization and status policy.
 *
 * PostgreSQL's authority_kinds catalogue (migration 0013) is the persisted source of truth for which kinds exist and
 * for their jurisdiction / expiry shape; the database triggers enforce that shape. This module owns the pieces the
 * database cannot express - the per-kind number normalization rules (versioned, kept forever) and the allowed status
 * TRANSITIONS - and a drift test proves the two agree.
 *
 * Collision namespace per kind (the legally meaningful number space):
 *   USDOT, MC           NATIONAL           one US-wide number space
 *   MVID, RIN           COUNTRY_REGION     per issuing Canadian province / territory
 *   CVOR                COUNTRY_REGION     Ontario only
 *   SAFETY_FITNESS      COUNTRY_REGION     per issuing Canadian province / territory
 *   IRP                 BASE_JURISDICTION  per base jurisdiction (CA province or US state); the base may change over time
 *
 * Normalization is deliberately structural. It does not claim a registry has verified the number, and the formats of
 * MVID, RIN, SAFETY_FITNESS and IRP are generic alphanumeric until their issuing formats are confirmed; a stricter
 * rule is added as a NEW version without rewriting stored history.
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

export type NormalizationRule = {
  readonly version: string
  readonly apply: (raw: string) => { ok: true; normalized: string } | { ok: false; reason: string }
}

const stripLeadingZeros = (digits: string): string => digits.replace(/^0+/, "")

/** USDOT: optional "USDOT" / "US DOT" / "DOT" prefix, then 1-8 digits; leading zeros are not significant. */
const USDOT_V1: NormalizationRule = {
  version: "usdot.v1",
  apply(raw) {
    const body = raw.normalize("NFKC").trim().replace(/^(?:US\s*DOT|USDOT|DOT)\s*[#:\-]?\s*/i, "")
    if (!/^\d{1,8}$/.test(body)) return { ok: false, reason: "A USDOT number is 1-8 digits (an optional USDOT prefix is accepted)." }
    const normalized = stripLeadingZeros(body)
    return normalized === "" ? { ok: false, reason: "A USDOT number cannot be zero." } : { ok: true, normalized }
  },
}

/** MC: optional "MC" prefix, then 1-8 digits. FF (freight forwarder) and MX (Mexico) dockets are different authorities. */
const MC_V1: NormalizationRule = {
  version: "mc.v1",
  apply(raw) {
    const value = raw.normalize("NFKC").trim()
    if (/^(?:FF|MX)\b/i.test(value)) {
      return { ok: false, reason: "FF (freight forwarder) and MX (Mexico) dockets are not MC operating authorities." }
    }
    const body = value.replace(/^MC\s*[#:\-]?\s*/i, "")
    if (!/^\d{1,8}$/.test(body)) return { ok: false, reason: "An MC number is 1-8 digits (an optional MC prefix is accepted)." }
    const normalized = stripLeadingZeros(body)
    return normalized === "" ? { ok: false, reason: "An MC number cannot be zero." } : { ok: true, normalized }
  },
}

/** CVOR: nine digits; spaces and hyphens are formatting. */
const CVOR_V1: NormalizationRule = {
  version: "cvor.v1",
  apply(raw) {
    const body = raw.normalize("NFKC").trim().replace(/[\s-]/g, "")
    if (!/^\d{9}$/.test(body)) return { ok: false, reason: "A CVOR number is nine digits." }
    return /^0+$/.test(body) ? { ok: false, reason: "A CVOR number cannot be all zeros." } : { ok: true, normalized: body }
  },
}

/** Generic structural rule for identifiers whose issuing format is not confirmed: 3-24 letters or digits. */
function genericRule(version: string, label: string): NormalizationRule {
  return {
    version,
    apply(raw) {
      const normalized = raw.normalize("NFKC").trim().toUpperCase().replace(/[\s\-./]+/g, "")
      return /^[A-Z0-9]{3,24}$/.test(normalized)
        ? { ok: true, normalized }
        : { ok: false, reason: `${label} must be 3-24 letters or digits (spaces, hyphens, periods and slashes are ignored).` }
    },
  }
}

const MVID_V1 = genericRule("mvid.v1", "An MVID")
const RIN_V1 = genericRule("rin.v1", "A RIN")
const SAFETY_FITNESS_V1 = genericRule("safety_fitness.v1", "A safety fitness certificate number")
const IRP_V1 = genericRule("irp.v1", "An IRP account number")

/** Every rule version ever stored must remain here, unchanged. */
export const NORMALIZATION_RULES: Readonly<Record<string, NormalizationRule>> = {
  [USDOT_V1.version]: USDOT_V1,
  [MC_V1.version]: MC_V1,
  [MVID_V1.version]: MVID_V1,
  [RIN_V1.version]: RIN_V1,
  [CVOR_V1.version]: CVOR_V1,
  [SAFETY_FITNESS_V1.version]: SAFETY_FITNESS_V1,
  [IRP_V1.version]: IRP_V1,
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
  /** Whether the issuing jurisdiction is part of the authority's identity (one per province). */
  readonly identityIncludesJurisdiction: boolean
  /** Current normalization rule. Older stored versions remain resolvable through NORMALIZATION_RULES. */
  readonly rule: NormalizationRule
}

export const KIND_DEFINITIONS: Readonly<Record<AuthorityKind, KindDefinition>> = {
  USDOT: { kind: "USDOT", jurisdictionScope: "NATIONAL", issuerCountry: "US", regionRequired: false, fixedRegion: null, hasExpiry: false, identityIncludesJurisdiction: false, rule: USDOT_V1 },
  MC: { kind: "MC", jurisdictionScope: "NATIONAL", issuerCountry: "US", regionRequired: false, fixedRegion: null, hasExpiry: false, identityIncludesJurisdiction: false, rule: MC_V1 },
  MVID: { kind: "MVID", jurisdictionScope: "COUNTRY_REGION", issuerCountry: "CA", regionRequired: true, fixedRegion: null, hasExpiry: false, identityIncludesJurisdiction: true, rule: MVID_V1 },
  RIN: { kind: "RIN", jurisdictionScope: "COUNTRY_REGION", issuerCountry: "CA", regionRequired: true, fixedRegion: null, hasExpiry: false, identityIncludesJurisdiction: true, rule: RIN_V1 },
  CVOR: { kind: "CVOR", jurisdictionScope: "COUNTRY_REGION", issuerCountry: "CA", regionRequired: true, fixedRegion: "ON", hasExpiry: true, identityIncludesJurisdiction: true, rule: CVOR_V1 },
  SAFETY_FITNESS: { kind: "SAFETY_FITNESS", jurisdictionScope: "COUNTRY_REGION", issuerCountry: "CA", regionRequired: true, fixedRegion: null, hasExpiry: true, identityIncludesJurisdiction: true, rule: SAFETY_FITNESS_V1 },
  IRP: { kind: "IRP", jurisdictionScope: "BASE_JURISDICTION", issuerCountry: null, regionRequired: true, fixedRegion: null, hasExpiry: false, identityIncludesJurisdiction: false, rule: IRP_V1 },
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
// Status policy
// ---------------------------------------------------------------------------------------------------------------

/**
 * Allowed regulatory status transitions. This is server POLICY, not schema: it can evolve (and become kind-specific)
 * without rewriting stored history. A move back to ACTIVE from a non-PENDING status is a REACTIVATION and goes through
 * its own operation so the authority's identity is visibly preserved.
 */
const TRANSITIONS: Readonly<Record<AuthorityStatus, readonly AuthorityStatus[]>> = {
  PENDING: ["ACTIVE", "CANCELED"],
  ACTIVE: ["INACTIVE", "SUSPENDED", "REVOKED", "CANCELED"],
  INACTIVE: ["ACTIVE", "SUSPENDED", "REVOKED", "CANCELED"],
  SUSPENDED: ["ACTIVE", "INACTIVE", "REVOKED", "CANCELED"],
  REVOKED: ["ACTIVE", "CANCELED"],
  CANCELED: ["ACTIVE"],
}

export function isAllowedTransition(from: AuthorityStatus, to: AuthorityStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** ACTIVE reached from anything but PENDING. */
export function isReactivation(from: AuthorityStatus, to: AuthorityStatus): boolean {
  return to === "ACTIVE" && from !== "PENDING" && from !== "ACTIVE"
}

/** Statuses in which the record may be archived (record lifecycle, not regulatory status). */
export const ARCHIVABLE_STATUSES: readonly AuthorityStatus[] = ["INACTIVE", "REVOKED", "CANCELED"]
