import { createHash } from "node:crypto";

import type { PromotionStatus, ReasonCode, SecurityDecision } from "./types.js";

export function computeSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Which promotion path produced the destination bytes being verified. */
export type PromotionIntegrityContext = "FRESH_COPY" | "EXISTING_DESTINATION";

export interface PromotionIntegrityResult {
  promotionStatus: PromotionStatus;
  decision: SecurityDecision;
  reasonCodes: ReasonCode[];
}

/**
 * Pure mapping from (which promotion path x whether the destination SHA-256
 * matches the source SHA-256) to a promotion/decision outcome. Isolated from
 * all GCS I/O so it can be unit tested directly.
 *
 * The destination is NEVER overwritten or repaired by any caller of this
 * function regardless of the result - a mismatch only ever changes what is
 * reported, never triggers a delete/overwrite of either object. Both a
 * freshly copied object and a pre-existing object that a prior
 * (possibly duplicate-delivered) invocation promoted are held to the exact
 * same standard: the destination is only ever treated as a genuine success
 * once its bytes have actually been re-read from GCS and hashed - never
 * assumed identical merely because the copy call succeeded or the object
 * was merely found to exist.
 */
export function resolvePromotionIntegrity(
  context: PromotionIntegrityContext,
  sourceSha256: string,
  destinationSha256: string,
): PromotionIntegrityResult {
  const matches = sourceSha256 === destinationSha256;

  if (context === "FRESH_COPY") {
    return matches
      ? { promotionStatus: "PROMOTED", decision: "CLEARED", reasonCodes: [] }
      : { promotionStatus: "PROMOTED_INTEGRITY_MISMATCH", decision: "REVIEW_REQUIRED", reasonCodes: ["INTEGRITY_CHECK_FAILED"] };
  }

  // context === "EXISTING_DESTINATION"
  return matches
    ? { promotionStatus: "ALREADY_EXISTS_VERIFIED_IDENTICAL", decision: "CLEARED", reasonCodes: [] }
    : { promotionStatus: "ALREADY_EXISTS_HASH_MISMATCH", decision: "REVIEW_REQUIRED", reasonCodes: ["INTEGRITY_CHECK_FAILED"] };
}
