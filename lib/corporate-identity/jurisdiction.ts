/**
 * Canonical jurisdiction codes at the Corporate Identity boundary.
 *
 * Countries are ISO 3166-1 alpha-2 and regions are the provinces/states/DC in lib/jurisdictions.ts (the codes TES
 * already uses). Callers must supply CODES; names such as "Canada" are not accepted here - turning prototype strings into
 * codes is a browser-migration concern, not something the persistence boundary guesses at.
 *
 * A jurisdiction here is always a LEGAL FORMATION / REGISTRATION jurisdiction. It is never an operating area, IRP base,
 * tax jurisdiction, address, or yard.
 */

import { JURISDICTIONS } from "@/lib/jurisdictions"
import { CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"

export type CountryCode = "CA" | "US"

const COUNTRY_BY_NAME: Record<string, CountryCode> = {
  Canada: "CA",
  "United States": "US",
}

const REGIONS: Record<CountryCode, ReadonlySet<string>> = (() => {
  const regions: Record<CountryCode, Set<string>> = { CA: new Set(), US: new Set() }
  for (const jurisdiction of JURISDICTIONS) {
    regions[COUNTRY_BY_NAME[jurisdiction.country]].add(jurisdiction.code.toUpperCase())
  }
  return regions
})()

export function parseCountryCode(value: unknown, field: string): CountryCode {
  if (typeof value === "string") {
    const code = value.trim().toUpperCase()
    if (code === "CA" || code === "US") return code
  }
  throw new CorporateIdentityValidationError(field, `${field} must be a supported country code (CA or US).`)
}

/** `region` must be a province/state code of `country`. */
export function parseRegionCode(country: CountryCode, value: unknown, field: string): string {
  if (typeof value === "string") {
    const code = value.trim().toUpperCase()
    if (REGIONS[country].has(code)) return code
  }
  throw new CorporateIdentityValidationError(field, `${field} must be a region code belonging to country ${country}.`)
}

export type Jurisdiction = { country: CountryCode; region: string | null }

/**
 * Parses an optional region: absent/null/blank means "none" (for example a federal incorporation), otherwise it must be
 * a valid region of the country.
 */
export function parseOptionalRegion(country: CountryCode, value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === "string" && value.trim() === "") return null
  return parseRegionCode(country, value, field)
}

export function sameJurisdiction(a: Jurisdiction, b: Jurisdiction): boolean {
  return a.country === b.country && a.region === b.region
}
