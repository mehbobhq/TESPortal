/**
 * Canonical Generic Evidence Model for TES Compliance Portal.
 * Designed for cross-module document linking without data cloning or domain coupling.
 */

export type EvidenceSource = "camera" | "upload" | "manual" | "system_generated" | "integration";

export type EvidenceVerificationState =
  | "unverified"
  | "pending_review"
  | "verified"
  | "rejected"
  | "superseded";

export interface OCRMetadata {
  overallConfidence: number;
  extractedFieldKeys: string[];
  adapterName?: string;
  adapterVersion?: string;
  processedAt?: string;
}

export interface ArchiveMetadata {
  isArchived: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  authorizationRef?: string;
}

export interface EvidenceRecord {
  id: string;
  companyId: string;
  entityType: string; // e.g. "Vehicle", "Driver", "Company", "TaxFiling", "InsurancePolicy", "Permit"
  entityId: string;
  documentType: string; // e.g. "CabCard", "CVIP", "COI", "CDL", "MedicalCard", "QuarterlyReport", "Decal"
  fileName: string;
  mimeType: string;
  fileReference: string; // URL, storage key, or local DataURL representation
  fileSize?: number;
  documentDate?: string;
  uploadedAt: string;
  uploadedBy: string;
  source: EvidenceSource;
  verificationState: EvidenceVerificationState;
  ocrMetadata?: OCRMetadata;
  notes?: string;
  archive?: ArchiveMetadata;
}

export interface EvidenceReference {
  evidenceId: string;
  documentType: string;
  fileName: string;
  verificationState: EvidenceVerificationState;
  documentDate?: string;
}
