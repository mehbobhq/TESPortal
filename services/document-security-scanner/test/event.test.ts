import assert from "node:assert/strict";
import { test } from "node:test";

import { parseGcsFinalizeEvent } from "../src/event.js";

const QUARANTINE_BUCKET = "tes-production-quarantine";
const OBJECT_NAME = "quarantine/acme-co/3fa85f64-5717-4562-b3fc-2c963f66afa6/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/source";

function gcsObject(overrides: Record<string, unknown> = {}) {
  return { bucket: QUARANTINE_BUCKET, name: OBJECT_NAME, generation: 1730000000000000, contentType: "application/pdf", size: "1024", ...overrides };
}

test("binary content mode: the raw body is the GCS object resource", () => {
  const result = parseGcsFinalizeEvent(JSON.stringify(gcsObject()), true, QUARANTINE_BUCKET);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.request.objectName, OBJECT_NAME);
    assert.equal(result.request.bucket, QUARANTINE_BUCKET);
    assert.equal(result.request.generation, "1730000000000000");
    assert.equal(result.request.size, 1024);
  }
});

test("structured content mode: the GCS object resource is under `data`", () => {
  const result = parseGcsFinalizeEvent(JSON.stringify({ type: "google.cloud.storage.object.v1.finalized", data: gcsObject() }), false, QUARANTINE_BUCKET);
  assert.equal(result.ok, true);
});

test("a malformed JSON body is rejected with 400", () => {
  const result = parseGcsFinalizeEvent("{not json", true, QUARANTINE_BUCKET);
  assert.deepEqual(result, { ok: false, status: 400, error: "Malformed event payload." });
});

test("an empty body is rejected with 400 (unrecognized shape), never treated as an event", () => {
  const result = parseGcsFinalizeEvent("", true, QUARANTINE_BUCKET);
  assert.equal(result.ok, false);
});

test("structured mode without `data` is rejected with 400", () => {
  const result = parseGcsFinalizeEvent(JSON.stringify({ type: "x" }), false, QUARANTINE_BUCKET);
  assert.deepEqual(result, { ok: false, status: 400, error: "Unrecognized event payload shape." });
});

test("an event missing bucket or name is rejected with 400", () => {
  assert.deepEqual(
    parseGcsFinalizeEvent(JSON.stringify({ name: OBJECT_NAME }), true, QUARANTINE_BUCKET),
    { ok: false, status: 400, error: "Event payload is missing required fields." },
  );
  assert.deepEqual(
    parseGcsFinalizeEvent(JSON.stringify({ bucket: QUARANTINE_BUCKET }), true, QUARANTINE_BUCKET),
    { ok: false, status: 400, error: "Event payload is missing required fields." },
  );
});

test("a wrong-bucket event is rejected - the event's own bucket is never trusted to select what gets read or promoted", () => {
  const result = parseGcsFinalizeEvent(JSON.stringify(gcsObject({ bucket: "tes-production-intake" })), true, QUARANTINE_BUCKET);
  assert.deepEqual(result, { ok: false, status: 400, error: "Event does not reference the configured quarantine bucket." });
});

test("an event for the INTAKE bucket cannot be used to trigger a scan/promotion loop", () => {
  const result = parseGcsFinalizeEvent(
    JSON.stringify(gcsObject({ bucket: "tes-production-intake", name: OBJECT_NAME.replace(/^quarantine\//, "intake/") })),
    true,
    QUARANTINE_BUCKET,
  );
  assert.equal(result.ok, false);
});
