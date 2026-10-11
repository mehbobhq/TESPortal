/**
 * Legacy browser vocabulary -> canonical Insurance vocabulary.
 *
 * PURE mapping tables and functions for the legacy store (src/components/insurance/insurance-domain.ts:
 * TransportationInsuranceRecord, WorkersInsuranceRecord, BondRecord, CoverageItem). They read no browser storage and touch no
 * database; they exist so a later deterministic, reconcilable import has an agreed mapping.
 *
 * Rules: an unmappable legacy value maps to an explicit UNMAPPABLE result (never a guess); a legacy "Expired" status is NOT
 * stored (expiry is derived from the dates); a legacy `previousRecordId` is turned into a typed renewal-strategy result for
 * the importer to reconcile; legacy evidence, certificate grouping, free-text notes and archive reasons have no canonical
 * home in this domain and are reported as NOT_MIGRATED rather than dropped silently.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node.
 */

import {
  COVERAGE_TYPE_DEFINITIONS,
  isCalendarDate,
  prepareNumber,
  type CoverageType,
  type Currency,
  type InsuranceFamily,
  type LimitBasis,
} from "@/lib/insurance/definitions"
import { InsuranceValidationError } from "@/lib/insurance/errors"

export type Unmappable = { readonly status: "UNMAPPABLE"; readonly input: unknown; readonly reason: string }
export type Mapped<T> = { readonly status: "MAPPED" } & T

const unmappable = (input: unknown, reason: string): Unmappable => ({ status: "UNMAPPABLE", input, reason })

/** Case-, spacing- and punctuation-insensitive comparison key for a legacy label. */
const labelKey = (value: unknown): string =>
  typeof value === "string"
    ? value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : ""

// --- coverage types -------------------------------------------------------------------------------------------------

type CoverageMapping = { coverageType: CoverageType; limitBasis: LimitBasis | null }

/** Legacy `insuranceType` / `CoverageItem.coverageType` labels (keyed by labelKey). "CSL" is a combined single limit. */
const LEGACY_COVERAGE_LABELS: Readonly<Record<string, CoverageMapping>> = {
  "auto liability": { coverageType: "AUTO_LIABILITY", limitBasis: null },
  "auto liability csl": { coverageType: "AUTO_LIABILITY", limitBasis: "COMBINED_SINGLE_LIMIT" },
  "auto liability combined single limit": { coverageType: "AUTO_LIABILITY", limitBasis: "COMBINED_SINGLE_LIMIT" },
  "commercial auto liability": { coverageType: "AUTO_LIABILITY", limitBasis: null },
  "motor truck cargo": { coverageType: "MOTOR_TRUCK_CARGO", limitBasis: null },
  "cargo": { coverageType: "MOTOR_TRUCK_CARGO", limitBasis: null },
  "general liability": { coverageType: "GENERAL_LIABILITY", limitBasis: null },
  "commercial general liability": { coverageType: "GENERAL_LIABILITY", limitBasis: null },
  "physical damage": { coverageType: "PHYSICAL_DAMAGE", limitBasis: null },
  "umbrella": { coverageType: "UMBRELLA_EXCESS", limitBasis: null },
  "umbrella liability": { coverageType: "UMBRELLA_EXCESS", limitBasis: null },
  "excess liability": { coverageType: "UMBRELLA_EXCESS", limitBasis: null },
  "umbrella excess liability": { coverageType: "UMBRELLA_EXCESS", limitBasis: null },
  "reefer breakdown": { coverageType: "REEFER_BREAKDOWN", limitBasis: null },
}

export function mapLegacyCoverageType(value: unknown): Mapped<CoverageMapping> | Unmappable {
  const mapping = LEGACY_COVERAGE_LABELS[labelKey(value)]
  return mapping ? { status: "MAPPED", ...mapping } : unmappable(value, "This coverage label has no canonical coverage type.")
}

// --- bond types -----------------------------------------------------------------------------------------------------

const LEGACY_BOND_LABELS: Readonly<Record<string, CoverageType>> = {
  "bmc 84 freight broker": "BOND_FREIGHT_BROKER",
  "bmc 84": "BOND_FREIGHT_BROKER",
  "customs in transit bond": "BOND_CUSTOMS",
  "performance bond": "BOND_PERFORMANCE",
}

/** Legacy `BondRecord.bondType`. Every bond limit is a penal sum. */
export function mapLegacyBondType(value: unknown): Mapped<{ coverageType: CoverageType; limitBasis: "PENAL_SUM" }> | Unmappable {
  const coverageType = LEGACY_BOND_LABELS[labelKey(value)]
  return coverageType ? { status: "MAPPED", coverageType, limitBasis: "PENAL_SUM" } : unmappable(value, "This bond label has no canonical bond type.")
}

// --- currency, amounts, dates ---------------------------------------------------------------------------------------

export function mapLegacyCurrency(value: unknown): Mapped<{ currency: Currency }> | Unmappable {
  return value === "CAD" || value === "USD" ? { status: "MAPPED", currency: value } : unmappable(value, "Only CAD and USD are supported currencies.")
}

/** A legacy amount (number or numeric string) as the canonical two-decimal string; anything else is UNMAPPABLE. */
export function mapLegacyAmount(value: unknown, options: { allowZero?: boolean } = {}): Mapped<{ amount: string }> | Unmappable {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : ""
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) return unmappable(value, "The amount is not a plain decimal with at most 12 digits and 2 decimals.")
  const amount = `${match[1].replace(/^0+(?=\d)/, "")}.${(match[2] ?? "").padEnd(2, "0")}`
  if (!options.allowZero && /^0+\.00$/.test(amount)) return unmappable(value, "The amount must be greater than zero.")
  return { status: "MAPPED", amount }
}

export function mapLegacyDate(value: unknown): Mapped<{ date: string }> | Unmappable {
  return typeof value === "string" && isCalendarDate(value.trim()) ? { status: "MAPPED", date: value.trim() } : unmappable(value, "The value is not a calendar date (YYYY-MM-DD).")
}

// --- status ---------------------------------------------------------------------------------------------------------

export type LegacyStatusMapping = {
  /** Canonical RECORD lifecycle of the policy. */
  recordStatus: "active" | "archived"
  /** True when the legacy status carried a fact that is derived (never stored) in the canonical model. */
  derivedFromDates: boolean
  note: string
}

/**
 * Legacy `status`: Active -> active record; Archived -> archived record; Expired -> an ACTIVE record whose expiry is read from
 * the dates (it is not stored), so the import must supply the real dates and nothing else.
 */
export function mapLegacyStatus(value: unknown): Mapped<LegacyStatusMapping> | Unmappable {
  switch (value) {
    case "Active":
      return { status: "MAPPED", recordStatus: "active", derivedFromDates: false, note: "In force is derived from the dates." }
    case "Expired":
      return { status: "MAPPED", recordStatus: "active", derivedFromDates: true, note: "Expired is not stored; it is derived from the term dates." }
    case "Archived":
      return { status: "MAPPED", recordStatus: "archived", derivedFromDates: false, note: "Archive is record lifecycle only." }
    default:
      return unmappable(value, "Unknown legacy status.")
  }
}

// --- renewal lineage ------------------------------------------------------------------------------------------------

export type RenewalStrategy =
  | { strategy: "NONE" }
  | { strategy: "NEW_TERM_SAME_POLICY"; predecessorLegacyId: string }
  | { strategy: "NEW_POLICY_RENEWS_POLICY"; predecessorLegacyId: string }
  | { strategy: "UNRESOLVED"; predecessorLegacyId: string; reason: string }

type LegacyPolicyKey = { insurerId?: unknown; policyNumber?: unknown }

/**
 * Turns the legacy `previousRecordId` into a typed strategy. The same insurer and the same normalized policy number mean the
 * carrier kept one policy identity (a NEW TERM of the same policy); a different number or insurer means the carrier issued a
 * new policy (a NEW POLICY with renews_policy_id). Without the predecessor's key the importer must reconcile it by hand.
 */
export function mapLegacyRenewal(previousRecordId: unknown, current: LegacyPolicyKey, predecessor: LegacyPolicyKey | null | undefined): RenewalStrategy {
  if (previousRecordId === undefined || previousRecordId === null || previousRecordId === "") return { strategy: "NONE" }
  if (typeof previousRecordId !== "string") return { strategy: "UNRESOLVED", predecessorLegacyId: String(previousRecordId), reason: "previousRecordId is not text." }
  if (!predecessor) return { strategy: "UNRESOLVED", predecessorLegacyId: previousRecordId, reason: "The predecessor record was not provided." }
  const normalize = (value: unknown): string | null => {
    try {
      return prepareNumber(value).normalized
    } catch (error) {
      if (error instanceof InsuranceValidationError) return null
      throw error
    }
  }
  const [a, b] = [normalize(current.policyNumber), normalize(predecessor.policyNumber)]
  if (a === null || b === null) return { strategy: "UNRESOLVED", predecessorLegacyId: previousRecordId, reason: "A policy number is not usable." }
  if (typeof current.insurerId !== "string" || typeof predecessor.insurerId !== "string") {
    return { strategy: "UNRESOLVED", predecessorLegacyId: previousRecordId, reason: "An insurer is missing." }
  }
  return current.insurerId === predecessor.insurerId && a === b
    ? { strategy: "NEW_TERM_SAME_POLICY", predecessorLegacyId: previousRecordId }
    : { strategy: "NEW_POLICY_RENEWS_POLICY", predecessorLegacyId: previousRecordId }
}

// --- whole records --------------------------------------------------------------------------------------------------

/** Legacy fields with no canonical home in this domain: reported, never silently dropped. */
export const LEGACY_NOT_MIGRATED: Readonly<Record<string, string>> = {
  evidenceId: "Evidence / documents are linked later by stable ids (Evidence domain).",
  groupId: "Certificate (COI) grouping is out of scope for the insurance foundation.",
  dataUrl: "File content is never stored in PostgreSQL.",
  notes: "Free-text notes have no structural home.",
  archiveReason: "Archive is record lifecycle; the reason is a future notes/evidence record.",
  archivedBy: "Archive actors are recorded in the Master Register.",
  archivedAt: "Archive time is recorded by the database.",
  jurisdiction: "A workers' compensation board is the insurer Organization; the jurisdiction is not a policy column.",
  principalName: "The principal is the insured Organization on the policy.",
  source: "Capture source (Manual / OCR) is not part of the structured facts.",
}

export type LegacyCoverageDraft = {
  coverageType: CoverageType
  limitBasis: LimitBasis | null
  limitAmount: string | null
  deductibleAmount: string | null
  currency: Currency | null
  scheduledVehiclesOnly: boolean
}

export type LegacyPolicyDraft = {
  family: InsuranceFamily
  /** The legacy insurer / provider / surety id (a canonical CMP-* company id), to be resolved to an Organization by the importer. */
  legacyInsurerId: string | null
  policyNumber: string | null
  termStart: string | null
  termEnd: string | null
  recordStatus: "active" | "archived"
  coverages: LegacyCoverageDraft[]
  /** Fields the importer must still supply or reconcile before the draft can be applied (e.g. a bond's currency). */
  unresolved: string[]
  /** Legacy members present on the record that are intentionally not migrated, with the reason. */
  notMigrated: Record<string, string>
}

type Draft = Mapped<LegacyPolicyDraft> | Unmappable
type Loose = Record<string, unknown>
const isRecord = (value: unknown): value is Loose => typeof value === "object" && value !== null && !Array.isArray(value)

function notMigrated(record: Loose): Record<string, string> {
  return Object.fromEntries(Object.entries(LEGACY_NOT_MIGRATED).filter(([key]) => record[key] !== undefined && record[key] !== null && record[key] !== ""))
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null)

function coverageFromItem(item: unknown): LegacyCoverageDraft | Unmappable {
  if (!isRecord(item)) return unmappable(item, "A coverage item must be an object.")
  const type = mapLegacyCoverageType(item.coverageType)
  if (type.status === "UNMAPPABLE") return type
  const limit = mapLegacyAmount(item.limitAmount)
  if (limit.status === "UNMAPPABLE") return limit
  const deductible = item.deductibleAmount === undefined || item.deductibleAmount === null ? null : mapLegacyAmount(item.deductibleAmount, { allowZero: true })
  if (deductible !== null && deductible.status === "UNMAPPABLE") return deductible
  const currency = mapLegacyCurrency(item.currency)
  if (currency.status === "UNMAPPABLE") return currency
  return {
    coverageType: type.coverageType,
    limitBasis: type.limitBasis,
    limitAmount: limit.amount,
    deductibleAmount: deductible === null ? null : deductible.amount,
    currency: currency.currency,
    scheduledVehiclesOnly: item.scheduledVehiclesOnly === true,
  }
}

/**
 * TransportationInsuranceRecord -> an INSURANCE policy draft. The record's own `insuranceType` is the fallback coverage when
 * `coverageItems` is absent (its `coverageAmount` is then the limit, in an unresolved currency).
 */
export function mapLegacyTransportationRecord(record: unknown): Draft {
  if (!isRecord(record)) return unmappable(record, "A legacy record must be an object.")
  const status = mapLegacyStatus(record.status)
  if (status.status === "UNMAPPABLE") return status
  const start = mapLegacyDate(record.effectiveDate)
  const end = mapLegacyDate(record.expiryDate)
  if (start.status === "UNMAPPABLE") return unmappable(record.effectiveDate, "effectiveDate: " + start.reason)
  if (end.status === "UNMAPPABLE") return unmappable(record.expiryDate, "expiryDate: " + end.reason)
  const unresolved: string[] = []
  const coverages: LegacyCoverageDraft[] = []
  if (Array.isArray(record.coverageItems) && record.coverageItems.length > 0) {
    for (const item of record.coverageItems) {
      const draft = coverageFromItem(item)
      if ("status" in draft) return draft
      coverages.push(draft)
    }
  } else {
    const type = mapLegacyCoverageType(record.insuranceType)
    if (type.status === "UNMAPPABLE") return type
    const limit = mapLegacyAmount(record.coverageAmount)
    if (limit.status === "UNMAPPABLE") return limit
    coverages.push({ coverageType: type.coverageType, limitBasis: type.limitBasis, limitAmount: limit.amount, deductibleAmount: null, currency: null, scheduledVehiclesOnly: false })
    unresolved.push("currency")
  }
  if (new Set(coverages.map((row) => row.coverageType)).size !== coverages.length) return unmappable(record.coverageItems, "A coverage type is listed more than once.")
  if (coverages.some((row) => COVERAGE_TYPE_DEFINITIONS[row.coverageType].family !== "INSURANCE")) return unmappable(record.coverageItems, "A transportation record can hold insurance coverages only.")
  return {
    status: "MAPPED",
    family: "INSURANCE",
    legacyInsurerId: textOrNull(record.insurerId),
    policyNumber: textOrNull(record.policyNumber),
    termStart: start.date,
    termEnd: end.date,
    recordStatus: status.recordStatus,
    coverages,
    unresolved,
    notMigrated: notMigrated(record),
  }
}

/** WorkersInsuranceRecord -> a WORKERS_COMPENSATION account draft (the board is the insurer; the account number is the policy number). */
export function mapLegacyWorkersRecord(record: unknown): Draft {
  if (!isRecord(record)) return unmappable(record, "A legacy record must be an object.")
  const status = mapLegacyStatus(record.status)
  if (status.status === "UNMAPPABLE") return status
  const start = mapLegacyDate(record.effectiveDate)
  const end = mapLegacyDate(record.expiryDate)
  if (start.status === "UNMAPPABLE") return unmappable(record.effectiveDate, "effectiveDate: " + start.reason)
  if (end.status === "UNMAPPABLE") return unmappable(record.expiryDate, "expiryDate: " + end.reason)
  return {
    status: "MAPPED",
    family: "WORKERS_COMPENSATION",
    legacyInsurerId: textOrNull(record.providerId),
    policyNumber: textOrNull(record.accountNumber),
    termStart: start.date,
    termEnd: end.date,
    recordStatus: status.recordStatus,
    coverages: [{ coverageType: "WORKERS_COMPENSATION", limitBasis: null, limitAmount: null, deductibleAmount: null, currency: null, scheduledVehiclesOnly: false }],
    unresolved: [],
    notMigrated: notMigrated(record),
  }
}

/** BondRecord -> a BOND draft. The legacy bond has no currency, so it is always reported as unresolved; no expiry means a continuous bond. */
export function mapLegacyBondRecord(record: unknown): Draft {
  if (!isRecord(record)) return unmappable(record, "A legacy record must be an object.")
  const status = mapLegacyStatus(record.status)
  if (status.status === "UNMAPPABLE") return status
  const type = mapLegacyBondType(record.bondType)
  if (type.status === "UNMAPPABLE") return type
  const amount = mapLegacyAmount(record.bondAmount)
  if (amount.status === "UNMAPPABLE") return amount
  const start = mapLegacyDate(record.effectiveDate)
  if (start.status === "UNMAPPABLE") return unmappable(record.effectiveDate, "effectiveDate: " + start.reason)
  let termEnd: string | null = null
  if (record.expiryDate !== undefined && record.expiryDate !== null && record.expiryDate !== "") {
    const end = mapLegacyDate(record.expiryDate)
    if (end.status === "UNMAPPABLE") return unmappable(record.expiryDate, "expiryDate: " + end.reason)
    termEnd = end.date
  }
  return {
    status: "MAPPED",
    family: "BOND",
    legacyInsurerId: textOrNull(record.suretyOrganizationId),
    policyNumber: textOrNull(record.bondNumber),
    termStart: start.date,
    termEnd,
    recordStatus: status.recordStatus,
    coverages: [{ coverageType: type.coverageType, limitBasis: type.limitBasis, limitAmount: amount.amount, deductibleAmount: null, currency: null, scheduledVehiclesOnly: false }],
    unresolved: ["currency"],
    notMigrated: notMigrated(record),
  }
}
