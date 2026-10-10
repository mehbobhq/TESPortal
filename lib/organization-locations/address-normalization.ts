/**
 * Address validation, display cleaning and ADVISORY match keys for Locations.
 *
 * Two kinds of value come out of an address:
 *   - display values: exactly what the human entered, trimmed and whitespace-collapsed. These are what is stored and shown.
 *   - match keys: aggressively normalized strings used only to SUGGEST that two places may be the same. They are never
 *     unique, never merge anything, and never prove identity. A building-level key ignores the unit so "Suite 100" and
 *     "Suite 200" at one civic address are found together; a unit-level key includes the unit (and line 2) so they stay
 *     distinguishable.
 *
 * Country support is a SERVICE boundary decision (CA and US via the existing jurisdiction utilities); the database stores
 * ISO-style alpha-2 country codes and short region codes and does not restrict them.
 */

import {
  parseCountryCode,
  parseRegionCode,
} from "@/lib/corporate-identity/jurisdiction"
import { CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"
import { OrganizationLocationValidationError } from "@/lib/organization-locations/errors"

export type AddressInput = {
  country: string
  region: string
  locality: string
  postalCode?: string | null
  addressLine1: string
  addressLine2?: string | null
  unit?: string | null
}

export type PreparedAddress = {
  countryCode: string
  regionCode: string
  locality: string
  postalCode: string | null
  postalCodeNormalized: string | null
  addressLine1: string
  addressLine2: string | null
  unit: string | null
  matchKeyBuilding: string
  matchKeyUnit: string
}

const ALLOWED_KEYS = ["country", "region", "locality", "postalCode", "addressLine1", "addressLine2", "unit"]
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

function clean(value: unknown, field: string, maxLength: number, required: boolean): string | null {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    if (required) throw new OrganizationLocationValidationError(field, `${field} is required.`)
    return null
  }
  if (typeof value !== "string") {
    throw new OrganizationLocationValidationError(field, `${field} must be text.`)
  }
  const cleaned = value.normalize("NFC").replace(/\s+/g, " ").trim()
  if (cleaned.length > maxLength) {
    throw new OrganizationLocationValidationError(field, `${field} must not exceed ${maxLength} characters.`)
  }
  if (CONTROL_CHARACTERS.test(cleaned)) {
    throw new OrganizationLocationValidationError(field, `${field} contains invalid characters.`)
  }
  return cleaned
}

function viaJurisdiction<T>(field: string, parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof CorporateIdentityValidationError) {
      throw new OrganizationLocationValidationError(field, error.message)
    }
    throw error
  }
}

// Canadian postal codes never use D, F, I, O, Q or U, and never start with D F I O Q U W or Z.
const CA_POSTAL = /^[ABCEGHJKLMNPRSTVXY][0-9][ABCEGHJKLMNPRSTVWXYZ][0-9][ABCEGHJKLMNPRSTVWXYZ][0-9]$/
const US_POSTAL = /^[0-9]{5}([0-9]{4})?$/

function normalizePostalCode(country: string, postalCode: string | null, field: string): string | null {
  if (postalCode === null) return null
  const compact = postalCode.toUpperCase().replace(/[\s-]/g, "")
  const valid = country === "CA" ? CA_POSTAL.test(compact) : US_POSTAL.test(compact)
  if (!valid) {
    throw new OrganizationLocationValidationError(field, `${field} is not a valid ${country === "CA" ? "Canadian postal code" : "ZIP code"}.`)
  }
  return compact
}

const foldDiacritics = (value: string): string => value.normalize("NFD").replace(/\p{M}+/gu, "")

const STREET_TOKENS: Record<string, string> = {
  STR: "STREET", RD: "ROAD", AVE: "AVENUE", AV: "AVENUE", BLVD: "BOULEVARD", BVD: "BOULEVARD",
  DR: "DRIVE", LN: "LANE", CT: "COURT", CRT: "COURT", HWY: "HIGHWAY", PKWY: "PARKWAY", CRES: "CRESCENT",
  CR: "CRESCENT", TR: "TRAIL", TRL: "TRAIL", PL: "PLACE", CIR: "CIRCLE", SQ: "SQUARE", TERR: "TERRACE",
  TER: "TERRACE", RTE: "ROUTE", FWY: "FREEWAY", EXPY: "EXPRESSWAY", PK: "PARK", IND: "INDUSTRIAL",
  N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST", NE: "NORTHEAST", NW: "NORTHWEST", SE: "SOUTHEAST", SW: "SOUTHWEST",
}

/** Aggressive, lossy: used only to build advisory match keys. */
function matchTokens(value: string): string[] {
  return foldDiacritics(value)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
}

function normalizeStreetForMatch(value: string): string {
  const tokens = matchTokens(value)
  return tokens
    .map((token, index) => {
      // The first token is a civic number or a name word, so it is never expanded.
      if (index === 0) return token
      // "ST" is a street suffix near the end ("Main St", "Main St NW") but a saint inside a name ("St Albert Trail").
      if (token === "ST") return index >= tokens.length - 2 ? "STREET" : "SAINT"
      return STREET_TOKENS[token] ?? token
    })
    .join(" ")
}

function normalizeLocalityForMatch(value: string): string {
  return matchTokens(value)
    .map((token, index) => (index === 0 && token === "ST" ? "SAINT" : index === 0 && token === "STE" ? "SAINTE" : token))
    .join(" ")
}

const UNIT_DESIGNATORS = new Set(["UNIT", "SUITE", "STE", "APT", "APARTMENT", "BAY", "NO", "NUMBER"])

function normalizeUnitForMatch(value: string | null): string {
  if (value === null) return ""
  const tokens = matchTokens(value)
  while (tokens.length > 1 && UNIT_DESIGNATORS.has(tokens[0])) tokens.shift()
  return tokens.join("")
}

/** First five digits for a US ZIP (ZIP+4 and ZIP match at building level); the full code for Canada. */
const postalBase = (country: string, normalized: string | null): string =>
  normalized === null ? "" : country === "US" ? normalized.slice(0, 5) : normalized

/**
 * Validates one address and derives its display values and advisory match keys. Unknown keys are rejected so raw
 * persistence columns (match keys, normalized postal code, coordinates, timezone ...) cannot be supplied by a caller.
 */
export function prepareAddress(input: unknown, field = "address"): PreparedAddress {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new OrganizationLocationValidationError(field, `${field} must be an object.`)
  }
  const source = input as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new OrganizationLocationValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
    }
  }

  const countryCode = viaJurisdiction(`${field}.country`, () => parseCountryCode(source.country, `${field}.country`))
  const regionCode = viaJurisdiction(`${field}.region`, () => parseRegionCode(countryCode, source.region, `${field}.region`))
  const locality = clean(source.locality, `${field}.locality`, 100, true) as string
  const addressLine1 = clean(source.addressLine1, `${field}.addressLine1`, 200, true) as string
  const addressLine2 = clean(source.addressLine2, `${field}.addressLine2`, 200, false)
  const unit = clean(source.unit, `${field}.unit`, 40, false)
  const postalCode = clean(source.postalCode, `${field}.postalCode`, 20, false)
  const postalCodeNormalized = normalizePostalCode(countryCode, postalCode, `${field}.postalCode`)

  const matchKeyBuilding = [
    countryCode,
    regionCode,
    normalizeLocalityForMatch(locality),
    postalBase(countryCode, postalCodeNormalized),
    normalizeStreetForMatch(addressLine1),
  ].join("|")
  const matchKeyUnit = [
    matchKeyBuilding,
    normalizeUnitForMatch(unit),
    addressLine2 === null ? "" : matchTokens(addressLine2).join(" "),
  ].join("|")

  return {
    countryCode,
    regionCode,
    locality,
    postalCode,
    postalCodeNormalized,
    addressLine1,
    addressLine2,
    unit,
    matchKeyBuilding,
    matchKeyUnit,
  }
}

/** True when two prepared addresses carry identical displayable content. */
export function sameAddressContent(a: PreparedAddress, b: PreparedAddress): boolean {
  return (
    a.countryCode === b.countryCode &&
    a.regionCode === b.regionCode &&
    a.locality === b.locality &&
    a.postalCode === b.postalCode &&
    a.addressLine1 === b.addressLine1 &&
    a.addressLine2 === b.addressLine2 &&
    a.unit === b.unit
  )
}
