import assert from "node:assert/strict";
import { test } from "node:test";

import { isRetryableAssessment, withinRetryWindow } from "../src/retry.js";
import type { PromotionStatus, ReasonCode, SecurityDecision } from "../src/types.js";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const FRESH = "2026-10-13T11:59:00Z";
const MAX = 6 * 60 * 60 * 1000;
const r = (securityDecision: SecurityDecision, reasonCodes: ReasonCode[], promotionStatus: PromotionStatus = "NOT_ATTEMPTED", timeCreated: string | null = FRESH) =>
  isRetryableAssessment({ securityDecision, reasonCodes, promotionStatus }, { timeCreated: timeCreated ?? undefined, now: NOW, maxAgeMs: MAX });

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

test("redelivery is bounded by the scanner itself: an old object, or one with no usable creation time, is acknowledged", () => {
  assert.equal(r("UNABLE_TO_SCAN", ["SCAN_ENGINE_ERROR"], "NOT_ATTEMPTED", "2026-10-13T05:59:59Z"), false, "older than 6 hours");
  assert.equal(r("UNABLE_TO_SCAN", ["SCAN_ENGINE_ERROR"], "NOT_ATTEMPTED", "2026-10-13T06:00:01Z"), true, "just inside 6 hours");
  assert.equal(r("UNABLE_TO_SCAN", ["SCAN_ENGINE_ERROR"], "NOT_ATTEMPTED", null), false, "unknown age fails closed");
  assert.equal(r("UNABLE_TO_SCAN", ["SCAN_ENGINE_ERROR"], "NOT_ATTEMPTED", "not a date"), false);
  assert.equal(withinRetryWindow({ timeCreated: "2026-10-13T12:30:00Z", now: NOW, maxAgeMs: MAX }), false, "an event from the future is not trusted");
});

test("every retryable reason is transient by construction: nothing that proves a property of the bytes is ever retried", () => {
  const permanent: Array<[SecurityDecision, ReasonCode[], PromotionStatus]> = [
    ["THREAT_DETECTED", ["MALWARE_SIGNATURE_DETECTED"], "NOT_ATTEMPTED"],
    ["REVIEW_REQUIRED", ["UNSUPPORTED_FILE_TYPE"], "NOT_ATTEMPTED"],
    ["REVIEW_REQUIRED", ["FILE_SIGNATURE_MISMATCH"], "NOT_ATTEMPTED"],
    ["REVIEW_REQUIRED", ["INTEGRITY_CHECK_FAILED"], "PROMOTED_INTEGRITY_MISMATCH"],
    ["REVIEW_REQUIRED", ["INTEGRITY_CHECK_FAILED"], "ALREADY_EXISTS_HASH_MISMATCH"],
    ["UNABLE_TO_SCAN", ["FILE_TOO_LARGE"], "NOT_ATTEMPTED"],
    ["UNABLE_TO_SCAN", ["INVALID_SOURCE_PATH"], "NOT_ATTEMPTED"],
    ["UNABLE_TO_SCAN", ["CONFIGURATION_ERROR"], "NOT_ATTEMPTED"],
  ];
  for (const [decision, reasons, promotion] of permanent) assert.equal(r(decision, reasons, promotion), false, `${decision} ${reasons} ${promotion}`);
});
