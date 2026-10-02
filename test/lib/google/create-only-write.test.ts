import test from "node:test";
import assert from "node:assert/strict";

import {
  ObjectAlreadyExistsError,
  saveCreateOnly,
  type CreateOnlySaveOptions,
  type CreateOnlyWritable,
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/google/create-only-write.ts";

function fakeFile(behavior?: () => Promise<void>) {
  const saves: Array<{ data: Buffer; options: CreateOnlySaveOptions }> = [];
  const file: CreateOnlyWritable = {
    async save(data, options) {
      saves.push({ data, options });
      if (behavior) await behavior();
    },
  };
  return { file, saves };
}

test("uploads always carry the atomic create-only precondition, so an existing quarantine object is never overwritten", async () => {
  const { file, saves } = fakeFile();
  await saveCreateOnly(file, Buffer.from("bytes"), { contentType: "application/pdf", metadata: { batchId: "b" } });
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0]!.options.preconditionOpts, { ifGenerationMatch: 0 });
  assert.equal(saves[0]!.options.resumable, false);
  assert.equal(saves[0]!.options.contentType, "application/pdf");
  assert.deepEqual(saves[0]!.options.metadata, { metadata: { batchId: "b" } });
});

test("the bytes written are exactly the bytes supplied (Uint8Array is copied faithfully)", async () => {
  const { file, saves } = fakeFile();
  await saveCreateOnly(file, new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual([...saves[0]!.data], [1, 2, 3, 4]);
});

test("a 412 from GCS surfaces as ObjectAlreadyExistsError, never as a silent success", async () => {
  const { file } = fakeFile(async () => {
    throw Object.assign(new Error("Precondition Failed"), { code: 412 });
  });
  await assert.rejects(() => saveCreateOnly(file, Buffer.from("x")), ObjectAlreadyExistsError);
});

test("any other upload failure propagates unchanged", async () => {
  const boom = Object.assign(new Error("backend"), { code: 503 });
  const { file } = fakeFile(async () => {
    throw boom;
  });
  await assert.rejects(() => saveCreateOnly(file, Buffer.from("x")), (error) => error === boom);
});
