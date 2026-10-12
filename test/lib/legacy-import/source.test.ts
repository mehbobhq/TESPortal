// @ts-nocheck
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { prepareLegacySourceRecord, sha256, stableJson } from "../../../lib/legacy-import/source.ts"

describe("legacy import source preparation", () => {
  it("hashes objects deterministically regardless of key order", () => {
    const a = { id: "CMP-1", name: "Alpha", nested: { b: 2, a: 1 } }
    const b = { nested: { a: 1, b: 2 }, name: "Alpha", id: "CMP-1" }

    assert.equal(stableJson(a), stableJson(b))
    assert.equal(sha256(a), sha256(b))
  })

  it("prepares source key, sha256 and unsupported fields without mutating the snapshot", () => {
    const snapshot = { id: "CMP-1", name: "Alpha Transport", oldPrototypeFlag: true }
    const prepared = prepareLegacySourceRecord({
      importBatchId: "00000000-0000-4000-8000-000000000001",
      sourceSystem: "tes-browser-localstorage",
      sourceNamespace: "user-1:2026-10-11",
      legacyEntityType: "COMPANY",
      legacyId: "CMP-1",
      sourceSnapshot: snapshot,
      supportedFields: ["id", "name"],
    })

    assert.equal(prepared.sourceKey, "COMPANY:CMP-1")
    assert.match(prepared.sourceSha256, /^[0-9a-f]{64}$/)
    assert.deepEqual(prepared.unsupportedFields, ["oldPrototypeFlag"])
    assert.deepEqual(prepared.sourceUnsupportedFields, ["oldPrototypeFlag"])
    assert.deepEqual(snapshot, { id: "CMP-1", name: "Alpha Transport", oldPrototypeFlag: true })
  })

  it("rejects dirty namespaces, invalid source systems and non-object snapshots", () => {
    assert.throws(() => prepareLegacySourceRecord({
      importBatchId: "batch",
      sourceSystem: "TES Browser",
      sourceNamespace: "user-1",
      legacyEntityType: "COMPANY",
      legacyId: "CMP-1",
      sourceSnapshot: { id: "CMP-1" },
    }))

    assert.throws(() => prepareLegacySourceRecord({
      importBatchId: "batch",
      sourceSystem: "tes-browser",
      sourceNamespace: " user-1",
      legacyEntityType: "COMPANY",
      legacyId: "CMP-1",
      sourceSnapshot: { id: "CMP-1" },
    }))

    assert.throws(() => prepareLegacySourceRecord({
      importBatchId: "batch",
      sourceSystem: "tes-browser",
      sourceNamespace: "user-1",
      legacyEntityType: "COMPANY",
      legacyId: "CMP-1",
      sourceSnapshot: [] as never,
    }))
  })
})
