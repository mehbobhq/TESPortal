import assert from "node:assert/strict";
import { test } from "node:test";

import { computeSha256, resolvePromotionIntegrity } from "../src/integrity.js";

const SOURCE_SHA256 = computeSha256(Buffer.from("original quarantine bytes"));
const MATCHING_SHA256 = computeSha256(Buffer.from("original quarantine bytes"));
const DIFFERENT_SHA256 = computeSha256(Buffer.from("corrupted or substituted bytes"));

test("successful matching hash after a fresh copy is a fully verified success", () => {
  const result = resolvePromotionIntegrity("FRESH_COPY", SOURCE_SHA256, MATCHING_SHA256);
  assert.equal(result.promotionStatus, "PROMOTED");
  assert.equal(result.decision, "CLEARED");
  assert.deepEqual(result.reasonCodes, []);
});

test("copied destination hash mismatch is never reported as a successful promotion", () => {
  const result = resolvePromotionIntegrity("FRESH_COPY", SOURCE_SHA256, DIFFERENT_SHA256);
  assert.equal(result.promotionStatus, "PROMOTED_INTEGRITY_MISMATCH");
  assert.equal(result.decision, "REVIEW_REQUIRED");
  assert.deepEqual(result.reasonCodes, ["INTEGRITY_CHECK_FAILED"]);
});

test("an existing destination with a matching hash is a safe, verified idempotent outcome", () => {
  const result = resolvePromotionIntegrity("EXISTING_DESTINATION", SOURCE_SHA256, MATCHING_SHA256);
  assert.equal(result.promotionStatus, "ALREADY_EXISTS_VERIFIED_IDENTICAL");
  assert.equal(result.decision, "CLEARED");
  assert.deepEqual(result.reasonCodes, []);
});

test("an existing destination with a mismatching hash is never silently assumed identical", () => {
  const result = resolvePromotionIntegrity("EXISTING_DESTINATION", SOURCE_SHA256, DIFFERENT_SHA256);
  assert.equal(result.promotionStatus, "ALREADY_EXISTS_HASH_MISMATCH");
  assert.equal(result.decision, "REVIEW_REQUIRED");
  assert.deepEqual(result.reasonCodes, ["INTEGRITY_CHECK_FAILED"]);
});

test("computeSha256 is deterministic for identical bytes and different for different bytes", () => {
  assert.equal(computeSha256(Buffer.from("abc")), computeSha256(Buffer.from("abc")));
  assert.notEqual(computeSha256(Buffer.from("abc")), computeSha256(Buffer.from("abd")));
});
