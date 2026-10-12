import type { CancellationReason, Currency, EndorsementKind, InsuranceFamily, LimitBasis, ScheduleReason, TermReason, TermState, CoverageType } from "@/lib/insurance/definitions"
import type { PolicyNumberHolder } from "@/lib/insurance/errors"

export type CorrectableStatus = "active" | "corrected"

/** Calendar dates are "YYYY-MM-DD"; instants are ISO-8601 UTC with microsecond precision; amounts are two-decimal strings. */
type Correctable = {
  recordStatus: CorrectableStatus
  correctedAt: string | null
  supersededById: string | null
}

export type PolicyRecord = {
  id: string
  /** The insured / employer / bond principal. */
  organizationId: string
  /** The insurer / carrier / surety / workers' compensation board. */
  insurerOrganizationId: string
  family: InsuranceFamily
  /** Predecessor policy when a renewal is a NEW policy identity. */
  renewsPolicyId: string | null
  /** Record lifecycle, NOT policy status. */
  recordStatus: "active" | "archived"
  archivedAt: string | null
  createdAt: string
}

export type TermRecord = Correctable & {
  id: string
  policyId: string
  numberDisplay: string
  numberNormalized: string
  normalizationRuleVersion: string
  termStart: string
  /** null only for a continuous bond. */
  termEnd: string | null
  cancelledOn: string | null
  cancellationReason: CancellationReason | null
  termReason: TermReason
}

export type EndorsementRecord = Correctable & {
  id: string
  termId: string
  numberDisplay: string | null
  numberNormalized: string | null
  kind: EndorsementKind
  effectiveOn: string
}

export type CoverageRecord = Correctable & {
  id: string
  termId: string
  coverageType: CoverageType
  limitAmount: string | null
  deductibleAmount: string | null
  currency: Currency | null
  limitBasis: LimitBasis | null
  scheduledVehiclesOnly: boolean
  effectiveFrom: string
  /** null = until the end of the term. */
  effectiveTo: string | null
  endorsementId: string | null
  endedByEndorsementId: string | null
}

export type BrokerPeriodRecord = Correctable & {
  id: string
  policyId: string
  brokerOrganizationId: string
  brokerRelationshipId: string | null
  brokerPersonId: string | null
  effectiveFrom: string
  effectiveTo: string | null
}

export type TermView = {
  term: TermRecord
  /** Derived from the dates and the cancellation fact on the as-of date; nothing is stored. */
  state: TermState
  endorsements: EndorsementRecord[]
  coverages: CoverageRecord[]
}

export type PolicyView = {
  policy: PolicyRecord
  /** Every term, corrected ones included (flagged), earliest first. */
  terms: TermView[]
  /** Every broker period, corrected ones included (flagged), earliest first. */
  brokerPeriods: BrokerPeriodRecord[]
  /** What is true on the as-of date (genuine rows only; a corrected term and its coverages never count). */
  asOf: {
    date: string
    inForce: boolean
    term: TermRecord | null
    coverages: CoverageRecord[]
    broker: BrokerPeriodRecord | null
  }
  /** The most recent genuine term and the broker of record now (genuine, not ended), regardless of the as-of date. */
  current: {
    latestTerm: TermRecord | null
    broker: BrokerPeriodRecord | null
  }
}

export type OrganizationInsuranceView = {
  organizationId: string
  /** The as-of calendar date the derived fields use (the database date when none was requested). */
  asOfDate: string
  policies: PolicyView[]
}

export type PolicyNumberCheckResult = {
  insurerOrganizationId: string
  number: { display: string; normalized: string; ruleVersion: string }
  registered: boolean
  holder: PolicyNumberHolder | null
}

/** One vehicle on a vehicle-scheduled coverage. The window is calendar dates, half-open [effectiveFrom, effectiveTo). */
export type ScheduledVehicleRecord = Correctable & {
  id: string
  coverageId: string
  vehicleId: string
  /** The insured Organization (always the coverage's). */
  organizationId: string
  scheduleReason: ScheduleReason
  effectiveFrom: string
  /** null = until the coverage ends. */
  effectiveTo: string | null
}

export type CoverageScheduleView = {
  coverageId: string
  organizationId: string
  asOfDate: string
  coverage: CoverageRecord
  /** The genuine schedule rows in force on the as-of date (empty when the coverage or its term was corrected, or the coverage had ended by then). */
  scheduled: ScheduledVehicleRecord[]
  /** Every schedule row of the coverage, corrected ones included (flagged), earliest first. */
  history: ScheduledVehicleRecord[]
}

export type VehicleScheduledCoverage = {
  schedule: ScheduledVehicleRecord
  coverage: CoverageRecord
  policyId: string
  /** The insured Organization. */
  organizationId: string
}

/** A vehicle and the vehicles that answer for it: its survivor after following vehicles.merged_into_vehicle_id, and everything merged into that survivor. */
export type VehicleFamily = {
  /** The vehicle that was asked about. */
  vehicleId: string
  /** The surviving vehicle (equal to vehicleId when it was never merged away). */
  resolvedVehicleId: string
  /** The survivor and every vehicle merged into it, directly or through other merged vehicles, in id order. */
  vehicleIds: string[]
}

export type VehicleInsuranceView = {
  /** The vehicle that was asked about. */
  vehicleId: string
  /** The surviving vehicle after following the merges (equal to vehicleId when it was never merged away). */
  resolvedVehicleId: string
  asOfDate: string
  /** The genuine coverages that schedule the vehicle (or a vehicle merged into it) on the as-of date. */
  scheduled: VehicleScheduledCoverage[]
  /** Every schedule row of the vehicle family, corrected ones included (flagged), earliest first. */
  history: ScheduledVehicleRecord[]
}
