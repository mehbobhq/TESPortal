/**
 * Pure mapping tables from the legacy browser Tax Filing vocabulary (src/components/tax-filing) to the canonical
 * registration vocabulary, so a later deterministic, reconcilable import has an agreed mapping.
 *
 * This module reads no browser storage and touches no database. A legacy value with no canonical counterpart maps to an
 * explicit result (`null` / "UNMAPPABLE" / "NO_REGISTRATION_IDENTITY"), never a guess.
 */

import type { ProgramCode, RegistrationStatus } from "@/lib/tax-registrations/definitions"

/** Federal Form 2290 is filed under the Organization's EIN; it has no registration identity of its own. */
export type NoRegistrationIdentity = "NO_REGISTRATION_IDENTITY"
export type Unmappable = "UNMAPPABLE"

export type LegacyProgramMapping = ProgramCode | NoRegistrationIdentity | Unmappable

const LEGACY_TAX_CODE_TO_PROGRAM: Readonly<Record<string, ProgramCode | NoRegistrationIdentity>> = Object.freeze({
  ifta: "IFTA",
  ct_huf: "CT_HUF",
  ny_hut: "NY_HUT",
  kyu: "KYU",
  nm_wdt: "NM_WDT",
  or_wmt: "OR_WMT",
  form_2290: "NO_REGISTRATION_IDENTITY",
  fuel_charge_registration: "FUEL_CHARGE",
  texas_excise_tax: "TX_EXCISE",
  arkansas_motor_fuel_tax: "AR_MFT",
  ontario_tobacco_tax: "ON_TOBACCO",
})

/** Legacy TaxCode (src/components/tax-filing/types.ts) -> canonical program code. Exact, case-sensitive match only. */
export function legacyTaxCodeToProgram(legacyCode: unknown): LegacyProgramMapping {
  if (typeof legacyCode !== "string") return "UNMAPPABLE"
  return Object.prototype.hasOwnProperty.call(LEGACY_TAX_CODE_TO_PROGRAM, legacyCode) ? LEGACY_TAX_CODE_TO_PROGRAM[legacyCode] : "UNMAPPABLE"
}

const LEGACY_STATUS_TO_STATUS: Readonly<Record<string, RegistrationStatus>> = Object.freeze({
  Active: "ACTIVE",
  Pending: "PENDING",
  Suspended: "SUSPENDED",
  Inactive: "INACTIVE",
  Closed: "CLOSED",
})

/** Legacy TaxProfileStatus -> canonical registration status, or null when the legacy value is not one of the five. */
export function legacyStatusToRegistrationStatus(legacyStatus: unknown): RegistrationStatus | null {
  if (typeof legacyStatus !== "string") return null
  return Object.prototype.hasOwnProperty.call(LEGACY_STATUS_TO_STATUS, legacyStatus) ? LEGACY_STATUS_TO_STATUS[legacyStatus] : null
}

const LEGACY_ACCOUNT_FIELD_TO_PROGRAM: Readonly<Record<string, ProgramCode>> = Object.freeze({
  accIfta: "IFTA",
  accCt: "CT_HUF",
  accNyhut: "NY_HUT",
  accKyu: "KYU",
  accNm: "NM_WDT",
  accOr: "OR_WMT",
})

/**
 * Legacy company account-number field (accIfta, accCt, accNyhut, accKyu, accNm, accOr) -> the program whose registration
 * number it carried, or null for any other field. These fields hold only the number: the issuing base jurisdiction of an
 * IFTA account was never recorded, so an import cannot invent one.
 */
export function legacyAccountNumberFieldToProgram(field: unknown): ProgramCode | null {
  if (typeof field !== "string") return null
  return Object.prototype.hasOwnProperty.call(LEGACY_ACCOUNT_FIELD_TO_PROGRAM, field) ? LEGACY_ACCOUNT_FIELD_TO_PROGRAM[field] : null
}

export const LEGACY_TAX_CODES = Object.freeze(Object.keys(LEGACY_TAX_CODE_TO_PROGRAM))
export const LEGACY_ACCOUNT_NUMBER_FIELDS = Object.freeze(Object.keys(LEGACY_ACCOUNT_FIELD_TO_PROGRAM))
