export const LEGACY_IMPORT_ENTITY_TYPES = [
  "COMPANY",
  "CUSTOMER",
  "LOCATION",
  "PERSON",
  "CONTACT_RELATIONSHIP",
  "VEHICLE",
  "ORGANIZATION_VEHICLE_RELATIONSHIP",
  "DRIVER_PROFILE",
  "ORGANIZATION_DRIVER_RELATIONSHIP",
  "AUTHORITY",
  "TAX_REGISTRATION",
  "INSURANCE_POLICY",
  "CREDENTIAL_SYSTEM",
  "COMPANY_CREDENTIAL",
  "UNSUPPORTED",
] as const

export type LegacyImportEntityType = (typeof LEGACY_IMPORT_ENTITY_TYPES)[number]
export type LegacyImportMode = "dry_run" | "commit"
export type LegacyImportBatchStatus = "draft" | "running" | "completed" | "failed" | "cancelled"
export type LegacyImportRecordStatus = "pending" | "imported" | "review_required" | "unsupported" | "skipped" | "failed"
export type LegacyImportDomainCode =
  | "COMPANIES"
  | "CUSTOMERS"
  | "LOCATIONS"
  | "CONTACTS"
  | "VEHICLES"
  | "DRIVERS"
  | "AUTHORITIES"
  | "TAX_REGISTRATIONS"
  | "COMPANY_PROFILE"
  | "INSURANCE"
  | "CREDENTIAL_METADATA"
  | "UNSUPPORTED_SNAPSHOTS"

export type LegacyImportBatch = {
  id: string
  sourceSystem: string
  sourceNamespace: string
  sourceDescription: string | null
  importMode: LegacyImportMode
  batchStatus: LegacyImportBatchStatus
  requestedByActorId: string
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
}

export type CreateLegacyImportBatchInput = {
  sourceSystem: string
  sourceNamespace: string
  sourceDescription?: string | null
  importMode: LegacyImportMode
}

export type LegacyImportRecordInput = {
  importBatchId: string
  sourceSystem: string
  sourceNamespace: string
  legacyEntityType: LegacyImportEntityType
  legacyId: string
  sourceKey: string
  sourceSha256: string
  sourceSnapshot: Record<string, unknown>
  parentLegacyIds?: Record<string, unknown>
  unsupportedFields?: unknown[]
}

export type PreparedLegacySourceRecord = LegacyImportRecordInput & {
  sourceUnsupportedFields: string[]
}

export type LegacyImportRecord = {
  id: string
  importBatchId: string
  sourceSystem: string
  sourceNamespace: string
  legacyEntityType: LegacyImportEntityType
  legacyId: string
  sourceKey: string
  sourceSha256: string
  recordStatus: LegacyImportRecordStatus
  canonicalTable: string | null
  canonicalId: string | null
  legacyCompanyRecordMapId: string | null
  legacyCanonicalRecordMapId: string | null
  exceptionSummary: string | null
  createdAt: string
  updatedAt: string
}

export type LegacyImportRecordStatusInput = {
  recordId: string
  recordStatus: LegacyImportRecordStatus
  canonicalTable?: string | null
  canonicalId?: string | null
  legacyCompanyRecordMapId?: string | null
  legacyCanonicalRecordMapId?: string | null
  secondaryCanonicalRows?: unknown[]
  unsupportedFields?: unknown[]
  exceptionSummary?: string | null
  exceptionDetails?: Record<string, unknown>
}

export type LegacyImportReviewDecisionInput = {
  importRecordId: string
  decision: "approve_match" | "create_new" | "skip" | "mark_unsupported" | "reject_source"
  decisionReason: string
  decisionPayload?: Record<string, unknown>
}

export type CreateLegacyCanonicalRecordMapInput = {
  sourceSystem: string
  sourceNamespace: string
  legacyEntityType: Exclude<LegacyImportEntityType, "COMPANY" | "UNSUPPORTED">
  legacyId: string
  canonicalTable: string
  canonicalId: string
  importBatchId: string
}

export type LegacyImportBatchReport = {
  importBatchId: string
  totalRecords: number
  byStatus: Record<LegacyImportRecordStatus, number>
  byEntityType: Partial<Record<LegacyImportEntityType, number>>
  exceptionCount: number
  unsupportedFieldCount: number
}

export type LegacyImportCheckpointInput = {
  importBatchId: string
  domainCode: LegacyImportDomainCode
  checkpointStatus: "pending" | "running" | "completed" | "blocked" | "failed" | "skipped"
  processedCount: number
  importedCount?: number
  reviewCount?: number
  unsupportedCount?: number
  failedCount?: number
  lastSourceKey?: string | null
  checkpointPayload?: Record<string, unknown>
}

export type LegacyImportStageRecordsInput = {
  importBatchId: string
  domainCode: LegacyImportDomainCode
  records: PreparedLegacySourceRecord[]
  checkpointPayload?: Record<string, unknown>
}

export type LegacyImportStageRecordsResult = {
  records: LegacyImportRecord[]
  checkpoint: LegacyImportCheckpointInput
}
