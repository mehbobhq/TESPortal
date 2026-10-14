import type { ProgramCode } from "@/lib/tax-registrations/definitions"
import type { TaxProfile } from "@/src/components/tax-filing/types"

export type EditMode = "change" | "correct"

export type TaxVersionHistory = {
  id: string
  number: string
  region?: string
  country?: string
  issuedOn?: string
  expiresOn?: string
  reason: "INITIAL" | "CHANGE" | "CORRECTION"
  effectiveFrom: string
  effectiveTo: string | null
  /** A corrected version was recorded wrongly: kept for audit, never genuine history. */
  corrected: boolean
}

export type TaxStatusHistory = {
  id: string
  status: string
  reason: "INITIAL" | "TRANSITION" | "REACTIVATION" | "CORRECTION"
  effectiveFrom: string
  effectiveTo: string | null
  corrected: boolean
}

/**
 * The original tax profile plus what the canonical registration adds: the canonical program, the issued / expiry dates and
 * issuing jurisdiction of the current version, the record lifecycle and the full history. `persisted` is false for a draft that
 * has not been saved yet (the original "Needs setup" flow).
 */
export type RestoredTaxProfile = TaxProfile & {
  program?: ProgramCode
  persisted: boolean
  issuedOn?: string
  expiresOn?: string
  jurisdictionCountry?: string
  jurisdictionRegion?: string
  isArchived?: boolean
  versions?: TaxVersionHistory[]
  statusPeriods?: TaxStatusHistory[]
}
