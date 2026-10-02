import test from "node:test";
import assert from "node:assert/strict";

import {
  isValidProcessingStateTransition,
  isValidStorageLocationTransition,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/ingestion/state.ts";

test("a document can move from NOT_STARTED only to PROCESSING", () => {
  assert.equal(isValidProcessingStateTransition("NOT_STARTED", "PROCESSING"), true);
  assert.equal(isValidProcessingStateTransition("NOT_STARTED", "PROCESSED"), false);
  assert.equal(isValidProcessingStateTransition("NOT_STARTED", "PROCESSING_FAILED"), false);
});

test("PROCESSING may conclude as PROCESSED, PROCESSING_FAILED, or PROCESSING_PARTIAL", () => {
  assert.equal(isValidProcessingStateTransition("PROCESSING", "PROCESSED"), true);
  assert.equal(isValidProcessingStateTransition("PROCESSING", "PROCESSING_FAILED"), true);
  assert.equal(isValidProcessingStateTransition("PROCESSING", "PROCESSING_PARTIAL"), true);
});

test("PROCESSED is terminal - nothing can follow it", () => {
  assert.equal(isValidProcessingStateTransition("PROCESSED", "PROCESSING"), false);
  assert.equal(isValidProcessingStateTransition("PROCESSED", "PROCESSING_FAILED"), false);
  assert.equal(isValidProcessingStateTransition("PROCESSED", "PROCESSED"), false);
});

test("a retry must pass back through PROCESSING, never jump directly to another terminal state", () => {
  assert.equal(isValidProcessingStateTransition("PROCESSING_FAILED", "PROCESSING"), true);
  assert.equal(isValidProcessingStateTransition("PROCESSING_FAILED", "PROCESSED"), false);
  assert.equal(isValidProcessingStateTransition("PROCESSING_PARTIAL", "PROCESSING"), true);
  assert.equal(isValidProcessingStateTransition("PROCESSING_PARTIAL", "PROCESSED"), false);
});

test("storage location only ever advances QUARANTINE -> INTAKE -> EVIDENCE, never backward", () => {
  assert.equal(isValidStorageLocationTransition("QUARANTINE", "INTAKE"), true);
  assert.equal(isValidStorageLocationTransition("INTAKE", "EVIDENCE"), true);
  assert.equal(isValidStorageLocationTransition("QUARANTINE", "EVIDENCE"), false);
  assert.equal(isValidStorageLocationTransition("INTAKE", "QUARANTINE"), false);
  assert.equal(isValidStorageLocationTransition("EVIDENCE", "INTAKE"), false);
  assert.equal(isValidStorageLocationTransition("EVIDENCE", "QUARANTINE"), false);
});
