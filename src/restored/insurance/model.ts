/**
 * Canonical Insurance (PostgreSQL: policies, terms, coverages, broker periods) -> the record shapes the original interface renders.
 *
 * One UI record = one policy. Its fields are read from the policy's latest GENUINE term (a corrected term is a preserved wrong
 * record and never shown as current) and that term's current coverage rows. Nothing is invented: a field with no canonical home
 * (WCB jurisdiction, notes, certificate group, evidence link) is simply absent and rendered "Not recorded".
 *
 * Pure: no fetch, no browser state. Types come from the canonical domain (type-only) and the original interface contracts.
 */

import { COVERAGE_TYPES, termStateOn, type CoverageType, type TermState } from "@/lib/insurance/definitions"
import type { BrokerPeriodRecord, CoverageRecord, OrganizationInsuranceView, PolicyView, TermRecord } from "@/lib/insurance/types"
import type { BondRecord, BrokerReference, CoverageItem, TransportationInsuranceRecord, WorkersInsuranceRecord } from "@/src/components/insurance/insurance-domain"

export const COVERAGE_LABELS: Record<CoverageType, string> = {
  AUTO_LIABILITY: "Auto Liability",
  MOTOR_TRUCK_CARGO: "Motor Truck Cargo",
  GENERAL_LIABILITY: "General Liability",
  PHYSICAL_DAMAGE: "Physical Damage",
  UMBRELLA_EXCESS: "Umbrella / Excess",
  REEFER_BREAKDOWN: "Reefer Breakdown",
  WORKERS_COMPENSATION: "Workers Compensation",
  BOND_FREIGHT_BROKER: "BMC-84 (Freight Broker)",
  BOND_CUSTOMS: "Customs / In-Transit Bond",
  BOND_PERFORMANCE: "Performance Bond",
}

/** Original form option value -> canonical coverage type. "Trailer Interchange" has none (see the matrix). */
export const TRANSPORTATION_TYPE_OPTIONS: Record<string, CoverageType | null> = {
  "Auto Liability": "AUTO_LIABILITY",
  "Motor Truck Cargo": "MOTOR_TRUCK_CARGO",
  "General Liability": "GENERAL_LIABILITY",
  "Physical Damage": "PHYSICAL_DAMAGE",
  "Umbrella / Excess": "UMBRELLA_EXCESS",
  "Reefer Breakdown": "REEFER_BREAKDOWN",
  "Trailer Interchange": null,
}

export const BOND_TYPE_OPTIONS: Record<string, CoverageType> = {
  "BMC-84 (Freight Broker)": "BOND_FREIGHT_BROKER",
  "Customs / In-Transit Bond": "BOND_CUSTOMS",
  "Performance Bond": "BOND_PERFORMANCE",
}

export type DirectoryOrganization = { id: string; name: string; kind?: string; status?: string; region?: string }

/** Contact data of one person at a brokerage, read from the Contacts domain. */
export type BrokerContactInfo = { personId: string; name: string; phone?: string; email?: string }

/** What the canonical record adds to the original record shape (ids the operations need, derived state). */
export type CanonicalExtras = {
  policyId: string
  termId: string
  /** The coverage the card shows and the edit form changes (the first in-force coverage of the term). */
  coverageId: string | null
  insurerOrganizationId: string
  /** Derived from dates + the cancellation fact; never stored. */
  termState: TermState
  cancelledOn: string | null
  /** The date the deadline engine reads: the cancellation date when cancelled, otherwise the stated end (undefined = continuous). */
  deadlineDate: string | undefined
  /** Number of genuine terms (> 1 means this policy has been renewed as new terms). */
  termCount: number
  renewsPolicyId: string | null
  /** Active broker period id (to correct), when the policy has a broker of record. */
  brokerPeriodId: string | null
  /** The coverages of the current term (a policy can carry several). */
  coverages: Array<{ id: string; coverageType: CoverageType; label: string; limitAmount: string | null; deductibleAmount: string | null; currency: string | null; limitBasis: string | null; scheduledVehiclesOnly: boolean }>
}

export type TransportationRecord = TransportationInsuranceRecord & CanonicalExtras
export type WorkersRecord = WorkersInsuranceRecord & CanonicalExtras
export type BondEntry = BondRecord & CanonicalExtras

export type InsuranceModel = {
  asOfDate: string
  transportation: TransportationRecord[]
  workers: WorkersRecord[]
  bonds: BondEntry[]
  /** Liability limits in force today, per currency (the original "Total Liability" card, now date-correct). */
  liabilityByCurrency: Record<string, number>
}

export const EMPTY_MODEL: InsuranceModel = { asOfDate: "", transportation: [], workers: [], bonds: [], liabilityByCurrency: {} }

const order = (type: CoverageType) => COVERAGE_TYPES.indexOf(type)

function currentCoverages(view: PolicyView, term: TermRecord): CoverageRecord[] {
  const rows = view.terms.find((entry) => entry.term.id === term.id)?.coverages ?? []
  const genuine = rows.filter((row) => row.recordStatus === "active")
  const open = genuine.filter((row) => row.effectiveTo === null)
  return [...(open.length > 0 ? open : genuine)].sort((a, b) => order(a.coverageType) - order(b.coverageType))
}

function brokerReference(broker: BrokerPeriodRecord | null, directory: Map<string, DirectoryOrganization>, contacts: Map<string, BrokerContactInfo>): BrokerReference | undefined {
  if (!broker) return undefined
  const contact = broker.brokerPersonId ? contacts.get(broker.brokerPersonId) : undefined
  return {
    organizationId: broker.brokerOrganizationId,
    organizationName: directory.get(broker.brokerOrganizationId)?.name ?? broker.brokerOrganizationId,
    contactId: broker.brokerPersonId ?? undefined,
    contactName: contact?.name,
    contactPhone: contact?.phone,
    contactEmail: contact?.email,
  }
}

export type MappedPolicy =
  | { family: "INSURANCE"; record: TransportationRecord }
  | { family: "WORKERS_COMPENSATION"; record: WorkersRecord }
  | { family: "BOND"; record: BondEntry }

export function mapPolicy(view: PolicyView, asOfDate: string, directory: Map<string, DirectoryOrganization>, contacts: Map<string, BrokerContactInfo>): MappedPolicy | null {
  const term = view.current.latestTerm
  if (!term) return null
  const rows = currentCoverages(view, term)
  const primary = rows[0]
  const state = termStateOn(term, asOfDate)
  const archived = view.policy.recordStatus === "archived"
  const status: "Active" | "Expired" | "Archived" = archived ? "Archived" : state === "EXPIRED" || state === "CANCELLED" ? "Expired" : "Active"
  const insurerName = directory.get(view.policy.insurerOrganizationId)?.name ?? view.policy.insurerOrganizationId
  const genuineTerms = view.terms.filter((entry) => entry.term.recordStatus === "active").length
  const extras: CanonicalExtras = {
    policyId: view.policy.id,
    termId: term.id,
    coverageId: primary?.id ?? null,
    insurerOrganizationId: view.policy.insurerOrganizationId,
    termState: state,
    cancelledOn: term.cancelledOn,
    deadlineDate: term.cancelledOn ?? term.termEnd ?? undefined,
    termCount: genuineTerms,
    renewsPolicyId: view.policy.renewsPolicyId,
    brokerPeriodId: view.current.broker?.id ?? null,
    coverages: rows.map((row) => ({ id: row.id, coverageType: row.coverageType, label: COVERAGE_LABELS[row.coverageType], limitAmount: row.limitAmount, deductibleAmount: row.deductibleAmount, currency: row.currency, limitBasis: row.limitBasis, scheduledVehiclesOnly: row.scheduledVehiclesOnly })),
  }
  // The original "renewed lineage" badge read previousRecordId; here the lineage is real (a later term, or a policy that renews another).
  const previousRecordId = genuineTerms > 1 || view.policy.renewsPolicyId !== null ? (view.policy.renewsPolicyId ?? view.policy.id) : undefined
  const archivedAt = view.policy.archivedAt ?? undefined

  if (view.policy.family === "INSURANCE") {
    const items: CoverageItem[] = rows.map((row) => ({
      id: row.id,
      coverageType: COVERAGE_LABELS[row.coverageType],
      limitAmount: Number(row.limitAmount ?? 0),
      deductibleAmount: row.deductibleAmount === null ? undefined : Number(row.deductibleAmount),
      currency: (row.currency ?? "CAD") as "CAD" | "USD",
      scheduledVehiclesOnly: row.scheduledVehiclesOnly,
    }))
    return {
      family: "INSURANCE",
      record: {
        ...extras,
        id: view.policy.id,
        insuranceType: primary ? COVERAGE_LABELS[primary.coverageType] : "Not recorded",
        policyNumber: term.numberDisplay,
        insurerId: view.policy.insurerOrganizationId,
        insurerName,
        effectiveDate: term.termStart,
        expiryDate: term.termEnd ?? "",
        coverageAmount: Number(primary?.limitAmount ?? 0),
        coverageItems: items,
        broker: brokerReference(view.current.broker, directory, contacts),
        status,
        previousRecordId,
        archivedAt,
      },
    }
  }
  if (view.policy.family === "WORKERS_COMPENSATION") {
    return {
      family: "WORKERS_COMPENSATION",
      record: {
        ...extras,
        id: view.policy.id,
        // No canonical home for the WCB jurisdiction: shown as "Not recorded", never guessed from the board's name.
        jurisdiction: "",
        providerId: view.policy.insurerOrganizationId,
        providerName: insurerName,
        accountNumber: term.numberDisplay,
        effectiveDate: term.termStart,
        expiryDate: term.termEnd ?? "",
        status,
        archivedAt,
      },
    }
  }
  return {
    family: "BOND",
    record: {
      ...extras,
      id: view.policy.id,
      bondType: primary ? COVERAGE_LABELS[primary.coverageType] : "Not recorded",
      suretyOrganizationId: view.policy.insurerOrganizationId,
      suretyName: insurerName,
      bondNumber: term.numberDisplay,
      // The principal of a bond is the insured Organization itself (the company whose workspace this is).
      principalName: directory.get(view.policy.organizationId)?.name ?? "",
      bondAmount: Number(primary?.limitAmount ?? 0),
      effectiveDate: term.termStart,
      expiryDate: term.termEnd ?? undefined,
      source: "Manual",
      status,
      archivedAt,
    },
  }
}

export function buildModel(view: OrganizationInsuranceView, directory: DirectoryOrganization[], contacts: BrokerContactInfo[], companyName: string): InsuranceModel {
  const byId = new Map(directory.map((entry) => [entry.id, entry]))
  if (!byId.has(view.organizationId)) byId.set(view.organizationId, { id: view.organizationId, name: companyName })
  const byPerson = new Map(contacts.map((entry) => [entry.personId, entry]))
  const model: InsuranceModel = { asOfDate: view.asOfDate, transportation: [], workers: [], bonds: [], liabilityByCurrency: {} }
  for (const policy of view.policies) {
    const mapped = mapPolicy(policy, view.asOfDate, byId, byPerson)
    if (!mapped) continue
    if (mapped.family === "INSURANCE") model.transportation.push(mapped.record)
    else if (mapped.family === "WORKERS_COMPENSATION") model.workers.push(mapped.record)
    else model.bonds.push(mapped.record)
    if (mapped.family === "INSURANCE" && policy.policy.recordStatus === "active") {
      for (const coverage of policy.asOf.coverages) {
        if ((coverage.coverageType === "AUTO_LIABILITY" || coverage.coverageType === "GENERAL_LIABILITY") && coverage.limitAmount !== null) {
          const currency = coverage.currency ?? "CAD"
          model.liabilityByCurrency[currency] = (model.liabilityByCurrency[currency] ?? 0) + Number(coverage.limitAmount)
        }
      }
    }
  }
  // Newest term first, as the original list showed the most recently added record first.
  const newest = (a: { effectiveDate: string }, b: { effectiveDate: string }) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : 0)
  model.transportation.sort(newest)
  model.workers.sort(newest)
  model.bonds.sort(newest)
  return model
}
