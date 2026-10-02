import assert from "node:assert/strict";
import { test } from "node:test";

import { copyCreateOnly, type CopyableObject } from "../src/storage.js";

type CopyCall = { destination: unknown; options: unknown };

function fakeSource(behavior: (call: CopyCall) => Promise<[unknown, unknown]>) {
  const calls: CopyCall[] = [];
  const source: CopyableObject = {
    async copy(destination, options) {
      const call = { destination, options };
      calls.push(call);
      return behavior(call);
    },
  };
  return { source, calls };
}

test("promotion always sends the atomic create-only precondition (ifGenerationMatch: 0), so an existing Intake object can never be overwritten", async () => {
  const { source, calls } = fakeSource(async () => [{}, { size: "10", generation: "42" }]);
  const destination = { name: "intake/x" };

  const outcome = await copyCreateOnly(source, destination);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.options, { preconditionOpts: { ifGenerationMatch: 0 } });
  assert.equal(calls[0]!.destination, destination);
  assert.deepEqual(outcome, { status: "PROMOTED", size: 10, generation: "42" });
});

test("a 412 (destination already exists) maps to SKIPPED_ALREADY_EXISTS, never to a successful overwrite", async () => {
  const { source } = fakeSource(async () => {
    throw Object.assign(new Error("Precondition Failed"), { code: 412 });
  });
  assert.deepEqual(await copyCreateOnly(source, {}), { status: "SKIPPED_ALREADY_EXISTS" });
});

test("any other copy failure maps to FAILED (fail closed), not success", async () => {
  const boom = Object.assign(new Error("backend error"), { code: 503 });
  const { source } = fakeSource(async () => {
    throw boom;
  });
  const outcome = await copyCreateOnly(source, {});
  assert.equal(outcome.status, "FAILED");
});

test("a copy error with no numeric code (e.g. a network error) is FAILED, not SKIPPED_ALREADY_EXISTS", async () => {
  const { source } = fakeSource(async () => {
    throw new Error("socket hang up");
  });
  assert.equal((await copyCreateOnly(source, {})).status, "FAILED");
});

// ---------------------------------------------------------------------------
// Source-generation pinning
// ---------------------------------------------------------------------------

import { Storage } from "@google-cloud/storage";

import { isValidGeneration, pinnedSource, SourceGenerationUnavailableError } from "../src/storage.js";

const GEN = "1730000000000000";

test("isValidGeneration accepts only plain positive decimal integers the GCS client can pin exactly", () => {
  assert.equal(isValidGeneration(GEN), true);
  for (const bad of ["", "0", "-1", "1.5", "1e15", "abc", " 1730000000000000", "1730000000000000 ", "99999999999999999999", undefined, null, 1730000000000000]) {
    assert.equal(isValidGeneration(bad), false, JSON.stringify(bad));
  }
});

test("pinnedSource opens the object scoped to the exact generation, and never calls the bucket for an invalid generation", () => {
  const opened: Array<{ name: string; options: unknown }> = [];
  const bucket = { file: (name: string, options: { generation: string }) => { opened.push({ name, options }); return {}; } };

  pinnedSource(bucket, "quarantine/x/source", GEN);
  assert.deepEqual(opened, [{ name: "quarantine/x/source", options: { generation: GEN } }]);

  assert.throws(() => pinnedSource(bucket, "quarantine/x/source", "not-a-generation"), SourceGenerationUnavailableError);
  assert.equal(opened.length, 1, "an unvalidated generation must never reach the GCS client (it would silently become an unpinned request)");
});

test("the real GCS client's pinned metadata read sends the exact generation as a query parameter", async () => {
  const storage = new Storage({ projectId: "test-project" });
  const bucket = storage.bucket("quarantine-bucket");
  let captured: { qs?: Record<string, unknown> } | undefined;
  (bucket as unknown as { request: (opts: typeof captured, cb: (err: unknown, resp: unknown) => void) => void }).request = (opts, cb) => {
    captured = opts;
    cb(null, { size: "3", generation: GEN });
  };
  const file = pinnedSource(bucket, "quarantine/x/source", GEN);
  assert.equal(file.generation, Number(GEN));
  await file.getMetadata();
  assert.equal(captured?.qs?.generation, Number(GEN));
});

test("the real GCS client's promotion copy sends sourceGeneration = the scanned generation AND ifGenerationMatch = 0 on the destination", async () => {
  const storage = new Storage({ projectId: "test-project" });
  const sourceBucket = storage.bucket("quarantine-bucket");
  const destination = storage.bucket("intake-bucket").file("intake/x/source");

  let captured: { uri?: string; qs?: Record<string, unknown> } | undefined;
  (sourceBucket as unknown as { request: (opts: typeof captured, cb: (err: unknown, resp: unknown) => void) => void }).request = (opts, cb) => {
    captured = opts;
    cb(null, { size: "3", generation: "9" });
  };

  const outcome = await copyCreateOnly(pinnedSource(sourceBucket, "quarantine/x/source", GEN), destination);

  assert.equal(outcome.status, "PROMOTED");
  assert.equal(captured?.qs?.sourceGeneration, Number(GEN), "the copy is pinned to the scanned source generation");
  assert.equal(captured?.qs?.ifGenerationMatch, 0, "the destination remains create-only");
  assert.match(String(captured?.uri), /rewriteTo\/b\/intake-bucket\/o\//);
});

test("an UNPINNED source handle would send no sourceGeneration - proving the pin above is what makes the difference", async () => {
  const storage = new Storage({ projectId: "test-project" });
  const sourceBucket = storage.bucket("quarantine-bucket");
  let captured: { qs?: Record<string, unknown> } | undefined;
  (sourceBucket as unknown as { request: (opts: typeof captured, cb: (err: unknown, resp: unknown) => void) => void }).request = (opts, cb) => {
    captured = opts;
    cb(null, {});
  };
  await copyCreateOnly(sourceBucket.file("quarantine/x/source"), storage.bucket("intake-bucket").file("intake/x/source"));
  assert.equal(captured?.qs?.sourceGeneration, undefined);
});

test("a 404 from the pinned copy means the scanned generation is gone: SOURCE_GENERATION_UNAVAILABLE, never a promotion of anything else", async () => {
  const { source } = fakeSource(async () => {
    throw Object.assign(new Error("No such object"), { code: 404 });
  });
  assert.deepEqual(await copyCreateOnly(source, {}), { status: "SOURCE_GENERATION_UNAVAILABLE" });
});

test("a 412 (destination exists) is still distinct from a 404 (source generation gone)", async () => {
  const dest = fakeSource(async () => {
    throw Object.assign(new Error("Precondition Failed"), { code: 412 });
  });
  const src = fakeSource(async () => {
    throw Object.assign(new Error("No such object"), { code: 404 });
  });
  assert.equal((await copyCreateOnly(dest.source, {})).status, "SKIPPED_ALREADY_EXISTS");
  assert.equal((await copyCreateOnly(src.source, {})).status, "SOURCE_GENERATION_UNAVAILABLE");
});
