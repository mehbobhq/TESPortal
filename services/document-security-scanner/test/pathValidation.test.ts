import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { deriveIntakeObjectName, parseQuarantineObjectName } from "../src/pathValidation.js";

const VALID_COMPANY_ID = "acme-co_123";
const VALID_BATCH_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const VALID_SOURCE_FILE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

test("parses a well-formed quarantine object name", () => {
  const objectName = `quarantine/${VALID_COMPANY_ID}/${VALID_BATCH_ID}/${VALID_SOURCE_FILE_ID}/source`;
  const identity = parseQuarantineObjectName(objectName);
  assert.deepEqual(identity, { companyId: VALID_COMPANY_ID, batchId: VALID_BATCH_ID, sourceFileId: VALID_SOURCE_FILE_ID });
});

test("rejects a path with too few segments", () => {
  assert.equal(parseQuarantineObjectName(`quarantine/${VALID_COMPANY_ID}/${VALID_BATCH_ID}/source`), null);
});

test("rejects a path with the wrong prefix", () => {
  assert.equal(parseQuarantineObjectName(`intake/${VALID_COMPANY_ID}/${VALID_BATCH_ID}/${VALID_SOURCE_FILE_ID}/source`), null);
});

test("rejects a path with the wrong suffix", () => {
  assert.equal(parseQuarantineObjectName(`quarantine/${VALID_COMPANY_ID}/${VALID_BATCH_ID}/${VALID_SOURCE_FILE_ID}/original`), null);
});

test("rejects a companyId containing a path separator (traversal attempt)", () => {
  assert.equal(parseQuarantineObjectName(`quarantine/../etc/${VALID_BATCH_ID}/${VALID_SOURCE_FILE_ID}/source`), null);
});

test("rejects a companyId with '..' segments", () => {
  assert.equal(parseQuarantineObjectName(`quarantine/..%2F../${VALID_BATCH_ID}/${VALID_SOURCE_FILE_ID}/source`), null);
});

test("rejects a batchId that is not a UUID", () => {
  assert.equal(parseQuarantineObjectName(`quarantine/${VALID_COMPANY_ID}/not-a-uuid/${VALID_SOURCE_FILE_ID}/source`), null);
});

test("rejects a sourceFileId that is not a UUID", () => {
  assert.equal(parseQuarantineObjectName(`quarantine/${VALID_COMPANY_ID}/${VALID_BATCH_ID}/not-a-uuid/source`), null);
});

test("rejects an empty companyId", () => {
  assert.equal(parseQuarantineObjectName(`quarantine//${VALID_BATCH_ID}/${VALID_SOURCE_FILE_ID}/source`), null);
});

test("rejects a companyId over the 128-character limit", () => {
  const longId = "a".repeat(129);
  assert.equal(parseQuarantineObjectName(`quarantine/${longId}/${VALID_BATCH_ID}/${VALID_SOURCE_FILE_ID}/source`), null);
});

test("derives the intake object name only from the parsed identity", () => {
  const identity = { companyId: VALID_COMPANY_ID, batchId: VALID_BATCH_ID, sourceFileId: VALID_SOURCE_FILE_ID };
  assert.equal(
    deriveIntakeObjectName(identity),
    `intake/${VALID_COMPANY_ID}/${VALID_BATCH_ID}/${VALID_SOURCE_FILE_ID}/source`,
  );
});

test("canonical ids generated exactly the way the portal generates them (crypto.randomUUID) always pass validation", () => {
  for (let i = 0; i < 50; i += 1) {
    const batchId = randomUUID();
    const sourceFileId = randomUUID();
    const identity = parseQuarantineObjectName(`quarantine/${VALID_COMPANY_ID}/${batchId}/${sourceFileId}/source`);
    assert.deepEqual(identity, { companyId: VALID_COMPANY_ID, batchId, sourceFileId });
  }
});

test("placeholder ids that are not canonical UUIDs are rejected (the validation is deliberately NOT relaxed to accept them)", () => {
  assert.equal(parseQuarantineObjectName(`quarantine/${VALID_COMPANY_ID}/batch-phaseb-clean-001/source-phaseb-clean-001/source`), null);
  assert.equal(parseQuarantineObjectName(`quarantine/${VALID_COMPANY_ID}/${VALID_BATCH_ID}/source-phaseb-clean-001/source`), null);
  assert.equal(parseQuarantineObjectName(`quarantine/${VALID_COMPANY_ID}/batch-phaseb-clean-001/${VALID_SOURCE_FILE_ID}/source`), null);
});

test("a UUID with a trailing/leading extra character or segment is rejected", () => {
  assert.equal(parseQuarantineObjectName(`quarantine/${VALID_COMPANY_ID}/${VALID_BATCH_ID}x/${VALID_SOURCE_FILE_ID}/source`), null);
  assert.equal(parseQuarantineObjectName(`quarantine/${VALID_COMPANY_ID}/${VALID_BATCH_ID}/${VALID_SOURCE_FILE_ID}/source/extra`), null);
});
