import assert from "node:assert/strict";
import { test } from "node:test";

import { isRetryableAssessment } from "../src/retry.js";
import type { PromotionStatus, ReasonCode, SecurityDecision } from "../src/types.js";

const r = (securityDecision: SecurityDecision, reasonCodes: ReasonCode[], promotionStatus: PromotionStatus = "NOT_ATTEMPTED") => isRetryableAssessment({ securityDecision, reasonCodes, promotionStatus });

test("transient scan-engine and read failures request redelivery", () => {
  assert.equal(r("UNABLE_TO_SCAN", ["SCAN_ENGINE_ERROR"]), true);
  assert.equal(r("UNABLE_TO_SCAN", ["SIGNATURE_DATABASE_UNAVAILABLE"]), true);
  assert.equal(r("UNABLE_TO_SCAN", ["SOURCE_DOWNLOAD_FAILED"]), true);
});

test("a failed promotion or failed read-back is retried only while nothing is proven about the bytes", () => {
  assert.equal(r("REVIEW_REQUIRED", ["INTAKE_PROMOTION_FAILED"], "FAILED"), true);
  assert.equal(r("REVIEW_REQUIRED", ["INTEGRITY_CHECK_FAILED"], "FAILED"), true);
});

test("a hash mismatch is a security finding and is never retried", () => {
  assert.equal(r("REVIEW_REQUIRED", ["INTEGRITY_CHECK_FAILED"], "PROMOTED_INTEGRITY_MISMATCH"), false);
  assert.equal(r("REVIEW_REQUIRED", ["INTEGRITY_CHECK_FAILED"], "ALREADY_EXISTS_HASH_MISMATCH"), false);
});

test("final decisions are acknowledged, never retried", () => {
  assert.equal(r("CLEARED", [], "PROMOTED"), false);
  assert.equal(r("THREAT_DETECTED", ["MALWARE_SIGNATURE_DETECTED"]), false);
  assert.equal(r("REVIEW_REQUIRED", ["UNSUPPORTED_FILE_TYPE"]), false);
  assert.equal(r("REVIEW_REQUIRED", ["FILE_SIGNATURE_MISMATCH"]), false);
  assert.equal(r("REVIEW_REQUIRED", ["SOURCE_GENERATION_CHANGED"], "FAILED"), false);
  assert.equal(r("UNABLE_TO_SCAN", ["FILE_TOO_LARGE"]), false);
  assert.equal(r("UNABLE_TO_SCAN", ["SOURCE_GENERATION_MISSING"]), false);
  assert.equal(r("UNABLE_TO_SCAN", ["SOURCE_GENERATION_CHANGED"]), false);
  assert.equal(r("UNABLE_TO_SCAN", ["CONFIGURATION_ERROR"]), false);
});
