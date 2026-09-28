
export type DeadlineStatus =
  | "Healthy"
  | "Watch"
  | "Urgent"
  | "Critical"
  | "Expired"
  | "No Deadline"

export type DeadlineRules = {
  healthyMinDays: number
  watchMinDays: number
  urgentMinDays: number
  criticalMinDays: number
  criticalMaxDays: number
}

export type Company = {
  id: string
  name: string
  kind?: string
  status?: string
  tone?: string

  /*
    DO NOT RENAME.
    These fields are already connected across TES.
  */
  regCorpState?: string
  regCorpCountry?: string
  region?: string

  usdot?: string
  mc?: string
  mvid?: string
  nsc?: string
  accIrp?: string
  accIfta?: string
  accNyhut?: string
  accNm?: string
  accKyu?: string
  accOr?: string
  accCt?: string
  scac?: string
  carrierCode?: string

  cargoTypes?: string[]
  cargoInformation?: unknown
  hazmat?: boolean

  [key: string]: any
}

export type AuthorityCategory =
  | "canadian"
  | "us_federal"
  | "operating_registration"

export type AuthorityType =
  | "PROVINCIAL_CARRIER_IDENTIFIER"
  | "CANADIAN_SAFETY_AUTHORITY"
  | "USDOT"
  | "MC"
  | "MCS150"
  | "UCR"
  | "PHMSA"
  | "OTHER"

export type SafetySystem =
  | "CARRIER_PROFILE_CVOR"
  | "SMS_PROFILE"

export type SourceType =
  | "OCR"
  | "Manual"

export type DocumentSource =
  | "camera"
  | "device"

export interface AuthorityEvidence {
  id: string
  recordId?: string
  fileName: string
  mimeType: string
  dataUrl: string
  documentDate: string
  uploadedAt: string
  source: DocumentSource
  ocrConfidence?: number
}

export interface AuthorityRecord {
  id: string
  category: AuthorityCategory
  authorityType: AuthorityType
  name: string
  number: string
  issuingAuthority: string
  jurisdictionCode: string
  jurisdictionLabel: string
  country: string
  status:
    | "Active"
    | "Pending"
    | "Inactive"
    | "Suspended"
    | "Expired"
    | "Archived"
  issueDate?: string
  effectiveDate?: string
  expiryDate?: string
  eventDate?: string
  nextActionDate?: string
  notes?: string
  evidenceIds: string[]
  source: SourceType
  createdAt: string
  updatedAt: string
  isArchived?: boolean
  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

export interface SafetyRecord {
  id: string
  system: SafetySystem
  jurisdictionCode: string
  jurisdictionLabel: string
  country: string
  reviewDate: string
  summary: string
  notes?: string
  evidenceIds: string[]
  source: SourceType
  createdAt: string
  updatedAt: string
  isArchived?: boolean
  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

export interface AuditRecord {
  id: string
  auditType: string
  regulator: string
  jurisdictionCode: string
  jurisdictionLabel: string
  country: string
  referenceNumber: string
  noticeDate?: string
  dueDate?: string
  completedDate?: string
  status:
    | "Open"
    | "Scheduled"
    | "In Progress"
    | "Completed"
    | "Closed"
  outcome?: string
  score?: string
  followUpRequired: boolean
  followUpDueDate?: string
  notes?: string
  evidenceIds: string[]
  source: SourceType
  createdAt: string
  updatedAt: string
  isArchived?: boolean
  archivedAt?: string
  archivedBy?: string
  archiveReason?: string
}

export interface StoredAuthoritiesData {
  version: number
  authorities: AuthorityRecord[]
  safety: SafetyRecord[]
  audits: AuditRecord[]
  evidence: AuthorityEvidence[]
}

export type SelectedRecord =
  | {
      kind: "authority"
      record: AuthorityRecord
    }
  | {
      kind: "safety"
      record: SafetyRecord
    }
  | {
      kind: "audit"
      record: AuditRecord
    }

export interface AuthorityDraft {
  category: AuthorityCategory
  authorityType: AuthorityType
  name: string
  number: string
  issuingAuthority: string
  jurisdictionCode: string
  jurisdictionLabel: string
  country: string
  status: AuthorityRecord["status"]
  issueDate: string
  effectiveDate: string
  expiryDate: string
  eventDate: string
  nextActionDate: string
  notes: string
}

export interface SafetyDraft {
  system: SafetySystem
  jurisdictionCode: string
  jurisdictionLabel: string
  country: string
  reviewDate: string
  summary: string
  notes: string
}

export interface AuditDraft {
  auditType: string
  regulator: string
  jurisdictionCode: string
  jurisdictionLabel: string
  country: string
  referenceNumber: string
  noticeDate: string
  dueDate: string
  completedDate: string
  status: AuditRecord["status"]
  outcome: string
  score: string
  followUpRequired: boolean
  followUpDueDate: string
  notes: string
}

export interface OCRSession {
  mode:
    | "authority"
    | "safety"
    | "audit"
  source: DocumentSource
  file: File
  dataUrl: string
  processing: boolean
  extractionComplete: boolean
  confidence?: number
  documentDate: string
  authorityDraft?: AuthorityDraft
  safetyDraft?: SafetyDraft
  auditDraft?: AuditDraft
}
