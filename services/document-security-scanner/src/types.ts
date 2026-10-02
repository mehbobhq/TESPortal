/**
 * TES Document Security Scanner - Phase 1 types.
 *
 * This scanner is a separate, isolated component from the Next.js portal.
 * It does not import from, and is not imported by, app/api/document-intake,
 * lib/google/*, or any other portal code.
 *
 * Vocabulary note: TES does not use the word "REJECTED" anywhere in this
 * service - see SecurityDecision below. A scan failure is never proof a
 * document is malicious, and an unsupported/mismatched file type is a
 * technical uncertainty, not a legitimacy judgment.
 */

/** Raw ClamAV engine-execution result, before it is mapped to a SecurityDecision. */
export type ScanOutcome = "CLEAN" | "THREAT_DETECTED" | "SCAN_ERROR";

/**
 * The scanner's security decision for a quarantine object. This is the only
 * vocabulary exposed in results/logs/API responses - never "REJECTED",
 * "INVALID", or "REJECTED_DOCUMENT".
 */
export type SecurityDecision = "CLEARED" | "THREAT_DETECTED" | "REVIEW_REQUIRED" | "UNABLE_TO_SCAN";

export type ReasonCode =
  | "MALWARE_SIGNATURE_DETECTED"
  | "SCAN_ENGINE_ERROR"
  | "SIGNATURE_DATABASE_UNAVAILABLE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_SIGNATURE_MISMATCH"
  | "FILE_TOO_LARGE"
  | "INVALID_SOURCE_PATH"
  | "SOURCE_DOWNLOAD_FAILED"
  | "INTAKE_PROMOTION_FAILED"
  | "INTEGRITY_CHECK_FAILED"
  /** The Eventarc event carried no usable object generation, so no exact source generation can be assessed or promoted. */
  | "SOURCE_GENERATION_MISSING"
  /** The assessed source generation was replaced/removed (or reported a different generation) - it is not promotable and a newer generation is never substituted. */
  | "SOURCE_GENERATION_CHANGED"
  | "CONFIGURATION_ERROR";

/**
 * Whether, and how, a CLEARED source was promoted to Intake.
 *
 * "PROMOTED" and "ALREADY_EXISTS_VERIFIED_IDENTICAL" are the only two
 * statuses meaning promotion is fully, verifiedly successful - both require
 * a destination SHA-256 that was actually re-read from GCS and compared
 * against the source hash, never assumed. Every other status means the
 * destination's integrity relative to the source is NOT confirmed and must
 * not be treated as a successful promotion, even where a copy operation
 * itself technically succeeded or a destination object technically exists.
 */
export type PromotionStatus =
  | "NOT_ATTEMPTED"
  | "PROMOTED"
  | "PROMOTED_INTEGRITY_MISMATCH"
  | "ALREADY_EXISTS_VERIFIED_IDENTICAL"
  | "ALREADY_EXISTS_HASH_MISMATCH"
  | "FAILED";

/** Parsed identity extracted from a validated quarantine object path. */
export interface QuarantineObjectIdentity {
  companyId: string;
  batchId: string;
  sourceFileId: string;
}

/**
 * The structured result of one security assessment. Not persisted anywhere
 * in this phase - see the service README's "Persistence gap" section. It is
 * returned from the assessment function and logged in sanitized form only;
 * a future PostgreSQL layer is expected to persist this shape.
 */
export interface SecurityAssessment {
  securityAssessmentId: string;
  companyId?: string;
  batchId?: string;
  sourceFileId?: string;
  sourceObjectName: string;
  sourceGeneration?: string;
  sourceSize?: number;
  claimedMimeType?: string;
  detectedFileType?: string;
  sha256?: string;
  scanner: string;
  scannerVersion?: string;
  signatureVersion?: string;
  scanStartedAt: string;
  scanCompletedAt?: string;
  scanOutcome?: ScanOutcome;
  securityDecision: SecurityDecision;
  reasonCodes: ReasonCode[];
  threatName?: string;
  intakeObjectName?: string;
  promotionStatus: PromotionStatus;
}
