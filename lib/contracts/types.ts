import type {
  AuthorityType,
  ContractStatus,
  FeeCurrency,
  GateCode,
  HistoryTreatment,
  PricingBasis,
  ResponsibilityBoundary,
  ResponsibleParty,
} from "@/lib/contracts/definitions"

/** Every instant is an ISO-8601 UTC string with microsecond precision; every calendar date is YYYY-MM-DD. */

export type PackageDefinitionRecord = {
  id: string
  packageCode: string
  packageName: string
  pricingBasis: PricingBasis
  packageStatus: "active" | "retired"
}

export type EvidenceRuleRecord = {
  ruleCode: string
  ruleLabel: string
  requiredDocumentType: string
  requiredBeforeStatus: "ready_for_signature" | "signed"
  ruleStatus: "active" | "retired"
}

export type LinePricingRecord = {
  id: string
  lineItemId: string
  pricingBasis: PricingBasis
  packageCode: string | null
  feeMinorUnits: number | null
  feeCurrency: FeeCurrency | null
  feePeriod: "none" | "monthly" | "one_time"
  decidedByAssignmentId: string
  decisionEvidenceDocumentId: string
  masterRegisterEventId: string
}

export type ResponsibilityRowRecord = {
  id: string
  lineItemId: string
  responsibilityArea: string
  responsibleParty: ResponsibleParty
  effectiveResponsibilityDate: string
  historyTreatment: HistoryTreatment
  historyAssumedFrom: string | null
  historyEvidenceDocumentId: string | null
  decidedByAssignmentId: string
  decisionEvidenceDocumentId: string
  masterRegisterEventId: string
}

export type ContractLineView = {
  id: string
  contractId: string
  scopeId: string
  lineStatus: "draft" | "ready" | "signed" | "removed"
  responsibilityBoundary: ResponsibilityBoundary
  pricing: LinePricingRecord | null
  responsibilities: ResponsibilityRowRecord[]
}

export type ContractEvidenceRequirementView = {
  ruleCode: string
  ruleLabel: string
  requiredDocumentType: string
  requiredBeforeStatus: "ready_for_signature" | "signed"
  requirementStatus: "missing" | "verified"
  evidenceDocumentId: string | null
  masterRegisterEventId: string | null
}

export type ContractStatusEventRecord = {
  id: string
  fromStatus: ContractStatus | null
  toStatus: ContractStatus
  evidenceDocumentId: string | null
  masterRegisterEventId: string
  createdAt: string
}

export type ContractReadiness = {
  /** The status the next advance would reach; null for a contract that cannot advance. */
  target: ContractStatus | null
  failures: GateCode[]
  ready: boolean
}

export type ContractView = {
  id: string
  customerId: string
  organizationId: string
  engagementId: string
  contractStatus: ContractStatus
  contractReference: string | null
  serviceDecisionAuthorityAssignmentId: string | null
  contractSignatoryAssignmentId: string | null
  lines: ContractLineView[]
  evidenceRequirements: ContractEvidenceRequirementView[]
  statusHistory: ContractStatusEventRecord[]
  readiness: ContractReadiness
}

export type AuthorityAssignmentView = {
  id: string
  customerId: string
  personId: string
  authorityType: AuthorityType
  assignmentStatus: "active" | "superseded" | "voided"
  effectiveFrom: string
  effectiveTo: string | null
  replacementReason: string | null
  noticeEvidenceDocumentId: string | null
}

export type AuthorityChangeEventRecord = {
  id: string
  authorityType: AuthorityType
  changeType: "assigned" | "replaced" | "revoked"
  newAssignmentId: string | null
  priorAssignmentId: string | null
  noticeEvidenceDocumentId: string
  masterRegisterEventId: string
  createdAt: string
}

export type AuthorityState = {
  serviceDecisionAuthority: AuthorityAssignmentView | null
  contractSignatory: AuthorityAssignmentView | null
  /** The same person may hold both roles; two different people may hold one each. */
  samePerson: boolean | null
  assignments: AuthorityAssignmentView[]
  changes: AuthorityChangeEventRecord[]
}

export type ContractsView = {
  organizationId: string
  customerId: string | null
  packages: PackageDefinitionRecord[]
  evidenceRules: EvidenceRuleRecord[]
  authorities: AuthorityState
  contracts: ContractView[]
}
