import type { PromotionStatus, ReasonCode, SecurityDecision } from "./types.js";

export interface RetryInput {
  securityDecision: SecurityDecision;
  reasonCodes: ReasonCode[];
  promotionStatus: PromotionStatus;
}

export interface RetryWindow {
  /** GCS `timeCreated` of the object being assessed (ISO 8601). Unknown or unparseable means no retry. */
  timeCreated: string | undefined;
  now: number;
  maxAgeMs: number;
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
 * Several of these reasons can also be permanent for one particular object or deployment (a file that crashes the engine, a
 * revoked permission). The scanner therefore also bounds redelivery itself: it asks for a retry only while the object is
 * younger than SCANNER_MAX_RETRY_AGE_MS (default 6 hours), whatever the transport would allow.
 *
 * Redelivery is safe: the scan is repeated on the same pinned generation, promotion is create-only (`ifGenerationMatch: 0`)
 * and an existing Intake object is hash-compared and never overwritten.
 */
export function isRetryableAssessment(input: RetryInput, window: RetryWindow): boolean {
  return isTransientOutcome(input) && withinRetryWindow(window);
}

/** A bounded retry needs a known object age: an event with no usable `timeCreated`, or one older than the cap, is acknowledged (fail closed; the payload stays quarantined and is reported as SCAN_STALLED). */
export function withinRetryWindow(window: RetryWindow): boolean {
  if (window.timeCreated === undefined) return false;
  const created = Date.parse(window.timeCreated);
  if (!Number.isFinite(created)) return false;
  const age = window.now - created;
  return age >= -60_000 && age <= window.maxAgeMs;
}

function isTransientOutcome(input: RetryInput): boolean {
  if (input.securityDecision === "UNABLE_TO_SCAN") {
    return input.reasonCodes.some((code) => TRANSIENT_SCAN_REASONS.has(code));
  }
  if (input.securityDecision === "REVIEW_REQUIRED") {
    return input.promotionStatus === "FAILED" && input.reasonCodes.some((code) => TRANSIENT_PROMOTION_REASONS.has(code));
  }
  return false;
}
