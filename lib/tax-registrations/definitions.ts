/**
 * Server-owned registration program definitions, number normalization and status vocabulary.
 *
 * PostgreSQL's registration_programs catalogue (migration 0016) is the persisted source of truth for which programs exist
 * and for their jurisdiction shape; the database triggers and indexes enforce that shape. This module owns the pieces the
 * database cannot express - the per-program number normalization rules (versioned, kept forever) - and a drift test proves
 * the two agree.
 *
 * Collision namespace per program (the legally meaningful number space):
 *   SCAC                                                  GLOBAL             one worldwide number space (NMFTA)
 *   FUEL_CHARGE, CA_CARRIER_CODE                          NATIONAL           one Canadian number space
 *   CT_HUF, NY_HUT, KYU, NM_WDT, OR_WMT, TX_EXCISE,
 *   AR_MFT, ON_TOBACCO                                    COUNTRY_REGION     the issuing state / province (fixed per program)
 *   IFTA                                                  BASE_JURISDICTION  per base jurisdiction (US state or CA province); the base may change
 *
 * A registration is NOT an operating authority (those live in lib/operating-authorities; IRP is canonical there and is
 * deliberately absent here), a filing, a payment, a decal or a credential.
 *
 * Number validation is classified per program and the rule NAME says which:
 *   AUTHORITATIVE   the exact format is documented by the issuing body (SCAC: two to four letters, NMFTA)
 *   PERMISSIVE      the issuing format is not authoritatively locked; the rule only guarantees a safe, comparable token
 *                   (rule names contain "permissive" and are NOT regulatory-format validation)
 * Tightening a rule is done by adding a NEW rule version (v2, v3 ...) and pointing the program at it. Every version ever
 * stored stays resolvable in NORMALIZATION_RULES, so historical records are never rewritten or re-validated.
 */

import { CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"
import { parseCountryCode, parseRegionCode } from "@/lib/corporate-identity/jurisdiction"
import { RegistrationValidationError } from "@/lib/tax-registrations/errors"

export const PROGRAM_CODES = [
  "IFTA",
  "CT_HUF",
  "NY_HUT",
  "KYU",
  "NM_WDT",
  "OR_WMT",
  "FUEL_CHARGE",
  "TX_EXCISE",
  "AR_MFT",
  "ON_TOBACCO",
  "SCAC",
  "CA_CARRIER_CODE",
] as const
export type ProgramCode = (typeof PROGRAM_CODES)[number]

export const REGISTRATION_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE", "CLOSED"] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

export type JurisdictionScope = "GLOBAL" | "NATIONAL" | "COUNTRY_REGION" | "BASE_JURISDICTION"
export type ProgramFamily = "FUEL_TAX" | "HIGHWAY_USE_TAX" | "WEIGHT_DISTANCE_TAX" | "EXCISE_TAX" | "CARRIER_CODE"

export function isProgramCode(value: unknown): value is ProgramCode {
  return typeof value === "string" && (PROGRAM_CODES as readonly string[]).includes(value)
}

export function isRegistrationStatus(value: unknown): value is RegistrationStatus {
  return typeof value === "string" && (REGISTRATION_STATUSES as readonly string[]).includes(value)
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

/**
 * SCAC: two to four letters, issued by NMFTA (Standard Carrier Alpha Code). Case is not significant; the normalized form
 * is upper case. Digits and punctuation are not part of a SCAC.
 */
const SCAC_TWO_TO_FOUR_LETTERS: NormalizationRule = {
  version: "scac.nmfta_two_to_four_letters.v1",
  classification: "AUTHORITATIVE",
  source: "NMFTA Standard Carrier Alpha Code (SCAC): a unique two-to-four letter carrier code",
  apply(raw) {
    const body = raw.normalize("NFKC").trim().toUpperCase()
    return /^[A-Z]{2,4}$/.test(body) ? { ok: true, normalized: body } : { ok: false, reason: "A SCAC is two to four letters." }
  },
}

/**
 * The issuing format of every other registration program (IFTA licence, state highway-use / weight-distance / excise
 * accounts, the federal fuel charge registration and the CBSA carrier code) is issued with its own jurisdiction-specific
 * format that is not authoritatively locked here. The rule keeps letters and digits only (case, spaces, hyphens, periods
 * and slashes ignored) so numbers are comparable and safe to index. NOT regulatory-format validation.
 */
const IDENTIFIER_PERMISSIVE: NormalizationRule = {
  version: "registration_identifier.permissive.v1",
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
  [SCAC_TWO_TO_FOUR_LETTERS.version]: SCAC_TWO_TO_FOUR_LETTERS,
  [IDENTIFIER_PERMISSIVE.version]: IDENTIFIER_PERMISSIVE,
}

// ---------------------------------------------------------------------------------------------------------------
// Program definitions (must agree with the registration_programs catalogue; a drift test proves it)
// ---------------------------------------------------------------------------------------------------------------

export type ProgramDefinition = {
  readonly program: ProgramCode
  readonly family: ProgramFamily
  readonly jurisdictionScope: JurisdictionScope
  /** The single issuing country, or null for GLOBAL programs and for BASE_JURISDICTION (US or CA). */
  readonly issuerCountry: "US" | "CA" | null
  readonly regionRequired: boolean
  readonly fixedRegion: string | null
  readonly sortOrder: number
  /** Current normalization rule. Older stored versions remain resolvable through NORMALIZATION_RULES. */
  readonly rule: NormalizationRule
}

const define = (
  program: ProgramCode,
  family: ProgramFamily,
  jurisdictionScope: JurisdictionScope,
  issuerCountry: "US" | "CA" | null,
  regionRequired: boolean,
  fixedRegion: string | null,
  sortOrder: number,
  rule: NormalizationRule = IDENTIFIER_PERMISSIVE,
): ProgramDefinition => ({ program, family, jurisdictionScope, issuerCountry, regionRequired, fixedRegion, sortOrder, rule })

export const PROGRAM_DEFINITIONS: Readonly<Record<ProgramCode, ProgramDefinition>> = {
  IFTA: define("IFTA", "FUEL_TAX", "BASE_JURISDICTION", null, true, null, 10),
  CT_HUF: define("CT_HUF", "HIGHWAY_USE_TAX", "COUNTRY_REGION", "US", true, "CT", 20),
  NY_HUT: define("NY_HUT", "HIGHWAY_USE_TAX", "COUNTRY_REGION", "US", true, "NY", 30),
  KYU: define("KYU", "WEIGHT_DISTANCE_TAX", "COUNTRY_REGION", "US", true, "KY", 40),
  NM_WDT: define("NM_WDT", "WEIGHT_DISTANCE_TAX", "COUNTRY_REGION", "US", true, "NM", 50),
  OR_WMT: define("OR_WMT", "WEIGHT_DISTANCE_TAX", "COUNTRY_REGION", "US", true, "OR", 60),
  FUEL_CHARGE: define("FUEL_CHARGE", "FUEL_TAX", "NATIONAL", "CA", false, null, 70),
  TX_EXCISE: define("TX_EXCISE", "EXCISE_TAX", "COUNTRY_REGION", "US", true, "TX", 80),
  AR_MFT: define("AR_MFT", "EXCISE_TAX", "COUNTRY_REGION", "US", true, "AR", 90),
  ON_TOBACCO: define("ON_TOBACCO", "EXCISE_TAX", "COUNTRY_REGION", "CA", true, "ON", 100),
  SCAC: define("SCAC", "CARRIER_CODE", "GLOBAL", null, false, null, 110, SCAC_TWO_TO_FOUR_LETTERS),
  CA_CARRIER_CODE: define("CA_CARRIER_CODE", "CARRIER_CODE", "NATIONAL", "CA", false, null, 120),
}

/** Whether a number or issuing jurisdiction may change IN PLACE as a real-world change (IFTA base moves re-issue the licence). */
export const allowsInPlaceIdentityChange = (program: ProgramCode): boolean =>
  PROGRAM_DEFINITIONS[program].jurisdictionScope === "BASE_JURISDICTION"

export type PreparedNumber = { display: string; normalized: string; ruleVersion: string }

export function prepareRegistrationNumber(program: ProgramCode, value: unknown, field = "number"): PreparedNumber {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RegistrationValidationError(field, `${field} is required.`)
  }
  const display = value.normalize("NFC").replace(/\s+/g, " ").trim()
  if (display.length > 40) throw new RegistrationValidationError(field, `${field} must not exceed 40 characters.`)
  const rule = PROGRAM_DEFINITIONS[program].rule
  const result = rule.apply(display)
  if (!result.ok) throw new RegistrationValidationError(field, result.reason)
  return { display, normalized: result.normalized, ruleVersion: rule.version }
}

// ---------------------------------------------------------------------------------------------------------------
// Jurisdiction
// ---------------------------------------------------------------------------------------------------------------

export type JurisdictionInput = { country?: string; region?: string }
/** `country` is null only for GLOBAL programs (no jurisdiction at all). */
export type ResolvedJurisdiction = { country: string | null; region: string | null }

function viaJurisdiction<T>(field: string, parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof CorporateIdentityValidationError) throw new RegistrationValidationError(field, error.message)
    throw error
  }
}

/**
 * Resolves the issuing jurisdiction of one version from the caller's input and the program's rules.
 *   GLOBAL            takes no jurisdiction at all (SCAC)
 *   NATIONAL          takes no region; a country, if given, must be the issuing country
 *   COUNTRY_REGION    defaults to the program's fixed region; anything given must match it
 *   BASE_JURISDICTION requires a country (US or CA) and a region of that country
 */
export function resolveJurisdiction(program: ProgramCode, input: unknown, field = "jurisdiction"): ResolvedJurisdiction {
  const definition = PROGRAM_DEFINITIONS[program]
  const provided = input !== undefined && input !== null

  if (definition.jurisdictionScope === "GLOBAL") {
    if (provided) throw new RegistrationValidationError(field, `${program} has a single worldwide number space; it takes no jurisdiction.`)
    return { country: null, region: null }
  }

  if (!provided) {
    if (definition.jurisdictionScope === "NATIONAL") return { country: definition.issuerCountry as string, region: null }
    if (definition.fixedRegion) return { country: definition.issuerCountry as string, region: definition.fixedRegion }
    throw new RegistrationValidationError(field, `${field} is required for ${program}.`)
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    throw new RegistrationValidationError(field, `${field} must be an object.`)
  }
  const source = input as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (key !== "country" && key !== "region") {
      throw new RegistrationValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
    }
  }

  if (definition.jurisdictionScope === "NATIONAL") {
    if (source.region !== undefined && source.region !== null) {
      throw new RegistrationValidationError(`${field}.region`, `${program} is a national number; it takes no region.`)
    }
    const country = viaJurisdiction(`${field}.country`, () => parseCountryCode(source.country ?? definition.issuerCountry, `${field}.country`))
    if (country !== definition.issuerCountry) {
      throw new RegistrationValidationError(`${field}.country`, `${program} is issued in ${definition.issuerCountry}.`)
    }
    return { country, region: null }
  }

  const country = viaJurisdiction(`${field}.country`, () =>
    parseCountryCode(source.country ?? definition.issuerCountry, `${field}.country`),
  )
  if (definition.issuerCountry && country !== definition.issuerCountry) {
    throw new RegistrationValidationError(`${field}.country`, `${program} is issued in ${definition.issuerCountry}.`)
  }
  const region = viaJurisdiction(`${field}.region`, () => parseRegionCode(country, source.region ?? definition.fixedRegion, `${field}.region`))
  if (definition.fixedRegion && region !== definition.fixedRegion) {
    throw new RegistrationValidationError(`${field}.region`, `${program} is issued in ${definition.fixedRegion}.`)
  }
  return { country, region }
}

// ---------------------------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------------------------
//
// The status history records OBSERVED registration status. There is deliberately no transition matrix and no
// archive-by-status rule here: which changes are possible differs by program and issuer, so program-specific transition
// policy belongs to the Rules layer. The only checks the foundation makes are integrity checks (the status must differ from
// the current one, the record must not be archived, and business time must move forward). Archive is TES record lifecycle
// and is independent of registration status. There is no expiry gating: expires_on / issued_on are optional documents dates
// for every program and never change the status.
