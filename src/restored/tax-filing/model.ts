/**
 * Pure model helpers of the restored Tax Filing workspace: the mapping between the original 11 tax programs and the canonical
 * registration programs / company-profile rule codes, and the mapping of a canonical registration to the original profile
 * shape. No browser storage, no filing / obligation domain (the canonical system has none; see adapter.ts).
 */

import { JURISDICTIONS } from "@/lib/jurisdictions"
import { PROGRAM_DEFINITIONS, type ProgramCode } from "@/lib/tax-registrations/definitions"
import type { RegistrationView, VersionRecord } from "@/lib/tax-registrations/types"
import type { RuleValue, TaxCode, TaxProfile, TaxProfileStatus } from "@/src/components/tax-filing/types"
import type { RestoredTaxProfile, TaxStatusHistory, TaxVersionHistory } from "./types"

/** Original program code -> canonical registration program. Form 2290 is federal, filed under the EIN: no registration identity. */
export const PROGRAM_BY_TAX_CODE: Readonly<Record<TaxCode, ProgramCode | null>> = {
  ifta: "IFTA",
  ct_huf: "CT_HUF",
  ny_hut: "NY_HUT",
  kyu: "KYU",
  nm_wdt: "NM_WDT",
  or_wmt: "OR_WMT",
  form_2290: null,
  fuel_charge_registration: "FUEL_CHARGE",
  texas_excise_tax: "TX_EXCISE",
  arkansas_motor_fuel_tax: "AR_MFT",
  ontario_tobacco_tax: "ON_TOBACCO",
}

export const TAX_CODE_BY_PROGRAM: Readonly<Partial<Record<ProgramCode, TaxCode>>> = Object.fromEntries(
  Object.entries(PROGRAM_BY_TAX_CODE).flatMap(([taxCode, program]) => (program ? [[program, taxCode]] : [])),
)

/** Company-profile rule code (canonical settings catalogue) whose applicability gates each original program. */
export const RULE_CODE_BY_TAX_CODE: Readonly<Record<TaxCode, string>> = {
  ifta: "IFTA",
  ct_huf: "CT_HUF",
  ny_hut: "NY_HUT",
  kyu: "KYU",
  nm_wdt: "NM_WDT",
  or_wmt: "OR_WMT",
  form_2290: "FORM_2290",
  fuel_charge_registration: "FUEL_CHARGE_REGISTRATION",
  texas_excise_tax: "TEXAS_EXCISE_TAX",
  arkansas_motor_fuel_tax: "ARKANSAS_MOTOR_FUEL_TAX",
  ontario_tobacco_tax: "ONTARIO_TOBACCO_TAX",
}

export function applicabilityFromCanonical(effective: string | undefined): RuleValue {
  return effective === "APPLIES" ? "applies" : effective === "DOES_NOT_APPLY" ? "does-not-apply" : "not-configured"
}

const STATUS_TO_UI: Record<string, TaxProfileStatus> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  INACTIVE: "Inactive",
  CLOSED: "Closed",
}
export const STATUS_TO_CANONICAL: Record<string, string> = Object.fromEntries(Object.entries(STATUS_TO_UI).map(([canonical, ui]) => [ui, canonical]))

export const isBaseJurisdictionProgram = (program: ProgramCode) => PROGRAM_DEFINITIONS[program].jurisdictionScope === "BASE_JURISDICTION"
/** Whether a number or issuing jurisdiction may change in place as a real-world change (IFTA base moves). */
export const programAllowsIdentityChange = (program: ProgramCode) => isBaseJurisdictionProgram(program)

const day = (value: string | null | undefined): string | undefined => (value ? value.slice(0, 10) : undefined)

function mapVersion(version: VersionRecord): TaxVersionHistory {
  return {
    id: version.id,
    number: version.numberDisplay,
    region: version.jurisdictionRegion ?? undefined,
    country: version.jurisdictionCountry ?? undefined,
    issuedOn: day(version.issuedOn),
    expiresOn: day(version.expiresOn),
    reason: version.versionReason,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    corrected: version.recordStatus === "corrected",
  }
}

export function regionLabel(country: string | null | undefined, region: string | null | undefined): string {
  if (!region) return country === "CA" ? "Canada" : country === "US" ? "United States" : ""
  const found = JURISDICTIONS.find((item) => item.code === region && item.country === (country === "CA" ? "Canada" : "United States"))
  return found ? `${found.label} (${found.code})` : region
}

/** Canonical registration -> the tax profile shape the original workspace expects. Fields with no canonical home are left empty. */
export function mapRegistrationView(view: RegistrationView): RestoredTaxProfile | null {
  const program = view.registration.program
  const taxCode = TAX_CODE_BY_PROGRAM[program]
  if (!taxCode) return null // SCAC and the CA carrier code are not part of the original tax programs.
  const version = view.current.version ?? [...view.versions].filter((item) => item.recordStatus === "active").sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? view.versions[0]
  const status = STATUS_TO_UI[view.current.status?.registrationStatus ?? ""] ?? "Pending"
  const touched = [view.registration.createdAt, ...view.versions.map((item) => item.createdAt), ...view.statusPeriods.map((item) => item.createdAt)].sort()
  const base: TaxProfile = {
    id: view.registration.id,
    taxCode,
    accountNumber: version?.numberDisplay,
    accountStatus: status,
    // The canonical store records no filing frequency: never defaulted, shown as "Not set".
    filingFrequency: "not-set",
    frequencyHistory: [],
    effectiveDate: day(version?.effectiveFrom),
    // A closure is the moment the registration status became Closed.
    closureDate: status === "Closed" ? day(view.current.status?.effectiveFrom) : "",
    verificationSource: "",
    createdAt: view.registration.createdAt,
    updatedAt: touched[touched.length - 1] ?? view.registration.createdAt,
  }
  return {
    ...base,
    program,
    persisted: true,
    issuedOn: day(version?.issuedOn),
    expiresOn: day(version?.expiresOn),
    jurisdictionCountry: version?.jurisdictionCountry ?? undefined,
    jurisdictionRegion: version?.jurisdictionRegion ?? undefined,
    isArchived: view.registration.recordStatus === "archived",
    versions: view.versions.map(mapVersion),
    statusPeriods: view.statusPeriods.map(
      (period): TaxStatusHistory => ({
        id: period.id,
        status: STATUS_TO_UI[period.registrationStatus] ?? period.registrationStatus,
        reason: period.periodReason,
        effectiveFrom: period.effectiveFrom,
        effectiveTo: period.effectiveTo,
        corrected: period.recordStatus === "corrected",
      }),
    ),
  }
}
