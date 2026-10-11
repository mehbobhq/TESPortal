import type { EngagementEndReason, EngagementStage, EngagementType, ProductLevel } from "@/lib/customer-relationship/definitions"

export type RecordStatus = "active" | "corrected" | "voided"
export type ChangeReason = "INITIAL" | "CHANGE" | "CORRECTION" | "AMENDMENT"

/** Every business-time value is an ISO-8601 UTC string with microsecond precision. */
export type CustomerRecord = { id: string; organizationId: string; createdAt: string }

export type EngagementRecord = {
  id: string
  customerId: string
  engagementType: EngagementType
  startedAt: string
  /** THE authoritative termination fact. The ENDED stage is its synchronized projection. */
  endedAt: string | null
  /** Structural termination reason (controlled catalogue); null exactly while the Engagement is open. */
  endReason: EngagementEndReason | null
}

/** One recorded termination fact. The 'active' row mirrors the canonical columns; 'corrected' rows are the preserved history. */
export type TerminationRecord = {
  id: string
  engagementId: string
  endedAt: string
  endReason: EngagementEndReason
  changeReason: "INITIAL" | "CORRECTION"
  recordStatus: "active" | "corrected"
  correctedAt: string | null
  supersededById: string | null
}

type Period = {
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: RecordStatus
  correctedAt: string | null
  supersededById: string | null
}

export type StageRecord = Period & {
  id: string
  engagementId: string
  stage: EngagementStage
  plannedEndAt: string | null
  changeReason: ChangeReason
}

export type ScopeRecord = Period & {
  id: string
  engagementId: string
  productLevel: ProductLevel
  serviceCode: string | null
  agreementId: string | null
  changeReason: ChangeReason
}

export type ResponsibilityRecord = Period & {
  id: string
  engagementId: string
  scopeId: string
  changeReason: ChangeReason
}

export type AgreementVersionRecord = Period & {
  id: string
  agreementId: string
  agreementReference: string | null
  signedOn: string | null
  changeReason: ChangeReason
}

export type AgreementRecord = {
  id: string
  customerId: string
  recordStatus: "active" | "archived"
  archivedAt: string | null
  versions: AgreementVersionRecord[]
}

export type EngagementView = {
  engagement: EngagementRecord
  stages: StageRecord[]
  scopes: ScopeRecord[]
  responsibilities: ResponsibilityRecord[]
  /** Every recorded termination, original first; empty while the Engagement has never ended. */
  terminations: TerminationRecord[]
  /** What is true now: genuine ('active') rows that have not ended. Corrected / voided rows never appear here. */
  current: {
    termination: TerminationRecord | null
    stage: StageRecord | null
    scopes: ScopeRecord[]
    responsibilities: ResponsibilityRecord[]
  }
  asOf: null | {
    at: string
    engagementInForce: boolean
    stage: StageRecord | null
    scopes: ScopeRecord[]
    responsibilities: ResponsibilityRecord[]
  }
}

export type CustomerRelationshipView = {
  organizationId: string
  customer: CustomerRecord | null
  engagements: EngagementView[]
  openEngagement: EngagementView | null
  agreements: AgreementRecord[]
}

export type EstablishResult = {
  createdCustomer: boolean
  customer: CustomerRecord
  engagement: EngagementView
}
