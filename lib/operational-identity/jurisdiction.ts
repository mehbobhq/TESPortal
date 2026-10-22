/**
 * Server-authoritative jurisdiction and licence-number canonicalization for driver identity.
 *
 * The SAME mapping is implemented in the database (tes_security.canonical_country_code / canonical_region_code /
 * canonical_licence_number, migration 0037). The database is the authority: it re-canonicalizes every licence on insert, so a
 * caller that skips this module still cannot store a non-canonical spelling. This module exists so application code compares and
 * reports on the same canonical form before (and without) the migration. test/lib/operational-identity asserts the two agree.
 *
 * GENERATED from the mapping table also embedded in migration 0037; change both together.
 */
const COUNTRIES: Readonly<Record<string, string>> = {
  "CA": "CA",
  "CAN": "CA",
  "CANADA": "CA",
  "US": "US",
  "USA": "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  "MX": "MX",
  "MEX": "MX",
  "MEXICO": "MX",
}
const REGIONS: Readonly<Record<string, string>> = {
  "ALBERTA": "AB",
  "BRITISH COLUMBIA": "BC",
  "MANITOBA": "MB",
  "NEW BRUNSWICK": "NB",
  "NEWFOUNDLAND AND LABRADOR": "NL",
  "NEWFOUNDLAND": "NL",
  "NOVA SCOTIA": "NS",
  "NORTHWEST TERRITORIES": "NT",
  "NUNAVUT": "NU",
  "ONTARIO": "ON",
  "PRINCE EDWARD ISLAND": "PE",
  "QUEBEC": "QC",
  "SASKATCHEWAN": "SK",
  "YUKON": "YT",
  "ALABAMA": "AL",
  "ALASKA": "AK",
  "ARIZONA": "AZ",
  "ARKANSAS": "AR",
  "CALIFORNIA": "CA",
  "COLORADO": "CO",
  "CONNECTICUT": "CT",
  "DELAWARE": "DE",
  "DISTRICT OF COLUMBIA": "DC",
  "WASHINGTON DC": "DC",
  "FLORIDA": "FL",
  "GEORGIA": "GA",
  "HAWAII": "HI",
  "IDAHO": "ID",
  "ILLINOIS": "IL",
  "INDIANA": "IN",
  "IOWA": "IA",
  "KANSAS": "KS",
  "KENTUCKY": "KY",
  "LOUISIANA": "LA",
  "MAINE": "ME",
  "MARYLAND": "MD",
  "MASSACHUSETTS": "MA",
  "MICHIGAN": "MI",
  "MINNESOTA": "MN",
  "MISSISSIPPI": "MS",
  "MISSOURI": "MO",
  "MONTANA": "MT",
  "NEBRASKA": "NE",
  "NEVADA": "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  "OHIO": "OH",
  "OKLAHOMA": "OK",
  "OREGON": "OR",
  "PENNSYLVANIA": "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  "TENNESSEE": "TN",
  "TEXAS": "TX",
  "UTAH": "UT",
  "VERMONT": "VT",
  "VIRGINIA": "VA",
  "WASHINGTON": "WA",
  "WEST VIRGINIA": "WV",
  "WISCONSIN": "WI",
  "WYOMING": "WY",
  "PUERTO RICO": "PR",
  "GUAM": "GU",
  "US VIRGIN ISLANDS": "VI",
  "UNITED STATES VIRGIN ISLANDS": "VI",
  "AMERICAN SAMOA": "AS",
  "NORTHERN MARIANA ISLANDS": "MP",
  "AGUASCALIENTES": "AGU",
  "BAJA CALIFORNIA": "BCN",
  "BAJA CALIFORNIA SUR": "BCS",
  "CAMPECHE": "CAM",
  "CHIAPAS": "CHP",
  "CHIHUAHUA": "CHH",
  "CIUDAD DE MEXICO": "CMX",
  "MEXICO CITY": "CMX",
  "DISTRITO FEDERAL": "CMX",
  "COAHUILA": "COA",
  "COLIMA": "COL",
  "DURANGO": "DUR",
  "GUANAJUATO": "GUA",
  "GUERRERO": "GRO",
  "HIDALGO": "HID",
  "JALISCO": "JAL",
  "ESTADO DE MEXICO": "MEX",
  "MICHOACAN": "MIC",
  "MORELOS": "MOR",
  "NAYARIT": "NAY",
  "NUEVO LEON": "NLE",
  "OAXACA": "OAX",
  "PUEBLA": "PUE",
  "QUERETARO": "QUE",
  "QUINTANA ROO": "ROO",
  "SAN LUIS POTOSI": "SLP",
  "SINALOA": "SIN",
  "SONORA": "SON",
  "TABASCO": "TAB",
  "TAMAULIPAS": "TAM",
  "TLAXCALA": "TLA",
  "VERACRUZ": "VER",
  "YUCATAN": "YUC",
  "ZACATECAS": "ZAC",
}
/** The country that owns each canonical region code (province, state or territory). Codes are unique across the supported countries. */
const REGION_COUNTRY: Readonly<Record<string, string>> = {
  "AB": "CA",
  "BC": "CA",
  "MB": "CA",
  "NB": "CA",
  "NL": "CA",
  "NS": "CA",
  "NT": "CA",
  "NU": "CA",
  "ON": "CA",
  "PE": "CA",
  "QC": "CA",
  "SK": "CA",
  "YT": "CA",
  "AL": "US",
  "AK": "US",
  "AZ": "US",
  "AR": "US",
  "CA": "US",
  "CO": "US",
  "CT": "US",
  "DE": "US",
  "DC": "US",
  "FL": "US",
  "GA": "US",
  "HI": "US",
  "ID": "US",
  "IL": "US",
  "IN": "US",
  "IA": "US",
  "KS": "US",
  "KY": "US",
  "LA": "US",
  "ME": "US",
  "MD": "US",
  "MA": "US",
  "MI": "US",
  "MN": "US",
  "MS": "US",
  "MO": "US",
  "MT": "US",
  "NE": "US",
  "NV": "US",
  "NH": "US",
  "NJ": "US",
  "NM": "US",
  "NY": "US",
  "NC": "US",
  "ND": "US",
  "OH": "US",
  "OK": "US",
  "OR": "US",
  "PA": "US",
  "RI": "US",
  "SC": "US",
  "SD": "US",
  "TN": "US",
  "TX": "US",
  "UT": "US",
  "VT": "US",
  "VA": "US",
  "WA": "US",
  "WV": "US",
  "WI": "US",
  "WY": "US",
  "PR": "US",
  "GU": "US",
  "VI": "US",
  "AS": "US",
  "MP": "US",
  "AGU": "MX",
  "BCN": "MX",
  "BCS": "MX",
  "CAM": "MX",
  "CHP": "MX",
  "CHH": "MX",
  "CMX": "MX",
  "COA": "MX",
  "COL": "MX",
  "DUR": "MX",
  "GUA": "MX",
  "GRO": "MX",
  "HID": "MX",
  "JAL": "MX",
  "MEX": "MX",
  "MIC": "MX",
  "MOR": "MX",
  "NAY": "MX",
  "NLE": "MX",
  "OAX": "MX",
  "PUE": "MX",
  "QUE": "MX",
  "ROO": "MX",
  "SLP": "MX",
  "SIN": "MX",
  "SON": "MX",
  "TAB": "MX",
  "TAM": "MX",
  "TLA": "MX",
  "VER": "MX",
  "YUC": "MX",
  "ZAC": "MX",
}

function squash(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_-]+/g, " ").trim().replace(/[a-z]+/g, (m) => m.toUpperCase()).replace(/\./g, "").replace(/,/g, "")
}

/** "Canada", " can ", "CA" -> "CA". An unrecognised value is returned squashed and upper-cased (and later rejected by isCanonicalCountry). */
export function canonicalCountryCode(value: string | null | undefined): string {
  const v = squash(value)
  return Object.prototype.hasOwnProperty.call(COUNTRIES, v) ? COUNTRIES[v] : v
}

/** "Ontario", " on. ", "ON" -> "ON". */
export function canonicalRegionCode(value: string | null | undefined): string {
  const v = squash(value)
  return Object.prototype.hasOwnProperty.call(REGIONS, v) ? REGIONS[v] : v
}

/** Letters and digits only, upper-case: "d1234-567 890" -> "D1234567890". */
export function canonicalLicenceNumber(value: string | null | undefined): string {
  return (value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase()
}

/** The recognised spellings, for the SQL/TypeScript parity test. */
export const JURISDICTION_VOCABULARY = { countries: Object.keys(COUNTRIES), regions: Object.keys(REGIONS) } as const

/** Supported licence countries for NEW writes. Older rows in another spelling or country stay readable and are never rewritten. */
export const isCanonicalCountry = (code: string): boolean => Object.prototype.hasOwnProperty.call(REGION_COUNTRY_VALUES, code)
export const isCanonicalRegion = (code: string): boolean => Object.prototype.hasOwnProperty.call(REGION_COUNTRY, code)
/** The country that owns a canonical region code, or null. */
export const regionCountry = (code: string): string | null => (Object.prototype.hasOwnProperty.call(REGION_COUNTRY, code) ? REGION_COUNTRY[code] : null)
/** A country-region pair is valid only when the region belongs to the country ("ON" with "US" is not). */
export const isValidJurisdiction = (country: string, region: string): boolean => isCanonicalCountry(country) && REGION_COUNTRY[region] === country

const REGION_COUNTRY_VALUES: Readonly<Record<string, true>> = { CA: true, US: true, MX: true }

export interface CanonicalLicenceKey { country: string; region: string; number: string }

export function canonicalLicenceKey(country: string | null | undefined, region: string | null | undefined, number: string | null | undefined): CanonicalLicenceKey {
  return { country: canonicalCountryCode(country), region: canonicalRegionCode(region), number: canonicalLicenceNumber(number) }
}

export const sameCanonicalLicence = (a: CanonicalLicenceKey, b: CanonicalLicenceKey): boolean => a.country === b.country && a.region === b.region && a.number === b.number
