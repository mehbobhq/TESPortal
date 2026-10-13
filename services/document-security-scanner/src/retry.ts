import type { PromotionStatus, ReasonCode, SecurityDecision } from "./types.js";

export interface RetryInput {
  securityDecision: SecurityDecision;
  reasonCodes: ReasonCode[];
  promotionStatus: PromotionStatus;
}

const TRANSIENT_SCAN_REASONS: ReadonlySet<ReasonCode> = new Set(["SCAN_ENGINE_ERROR", "SIGNATURE_DATABASE_UNAVAILABLE", "SOURCE_DOWNLOAD_FAILED"]);
const TRANSIENT_PROMOTION_REASONS: ReadonlySet<ReasonCode> = new Set(["INTAKE_PROMOTION_FAILED", "INTEGRITY_CHECK_FAILED"]);

/**
 * True only for outcomes caused by a transient infrastructure failure, where asking Eventarc to redeliver the event can
 * produce a different result: the scan engine or its signatures were unavailable, the pinned source could not be read, or
 * the create-only promotion (or its read-back) failed with nothing proven about the bytes.
 *
 * Everything else is a final, acknowledged decision and is never retried: THREAT_DETECTED, CLEARED, an unsupported or
 * mismatched file type, an oversized object, a missing or changed source generation, and any hash mismatch between the
 * scanned bytes and an existing or fresh Intake object (promotionStatus PROMOTED_INTEGRITY_MISMATCH or
 * ALREADY_EXISTS_HASH_MISMATCH is a security finding, not a glitch).
 *
 * Redelivery is safe: the scan is repeated on the same pinned generation, promotion is create-only (`ifGenerationMatch: 0`)
 * and an existing Intake object is hash-compared and never overwritten.
 */
export function isRetryableAssessment(input: RetryInput): boolean {
  if (input.securityDecision === "UNABLE_TO_SCAN") {
    return input.reasonCodes.some((code) => TRANSIENT_SCAN_REASONS.has(code));
  }
  if (input.securityDecision === "REVIEW_REQUIRED") {
    return input.promotionStatus === "FAILED" && input.reasonCodes.some((code) => TRANSIENT_PROMOTION_REASONS.has(code));
  }
  return false;
}
