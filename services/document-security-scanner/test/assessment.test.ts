import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { assessQuarantineObject, type ScanDependencies, type ScanRequest } from "../src/assessment.js";
import { computeSha256 } from "../src/integrity.js";
import type { ClamAvResult } from "../src/clamav.js";
import { SourceGenerationUnavailableError, type PromotionOutcome } from "../src/storage.js";

const COMPANY_ID = "acme-co_123";
const GEN_N = "1730000000000000";
const GEN_N_PLUS_1 = "1730000000000001";
const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
const OTHER_BYTES = Buffer.from("%PDF-1.7\nDIFFERENT CONTENT ENTIRELY\n");

function canonicalIds() {
  return { batchId: randomUUID(), sourceFileId: randomUUID() };
}

function objectNameFor(ids: { batchId: string; sourceFileId: string }) {
  return `quarantine/${COMPANY_ID}/${ids.batchId}/${ids.sourceFileId}/source`;
}

function intakeNameFor(ids: { batchId: string; sourceFileId: string }) {
  return `intake/${COMPANY_ID}/${ids.batchId}/${ids.sourceFileId}/source`;
}

function requestFor(objectName: string, overrides: Partial<ScanRequest> = {}): ScanRequest {
  return { bucket: "tes-production-quarantine", objectName, generation: GEN_N, contentType: "application/pdf", ...overrides };
}

/** A tiny model of the two buckets: the LIVE quarantine generation + its bytes, and the Intake objects. Shared across deliveries to model redelivery. */
interface FakeStore {
  live: string;
  bytes: Buffer;
  intake: Map<string, Buffer>;
}

function store(overrides: Partial<FakeStore> = {}): FakeStore {
  return { live: GEN_N, bytes: PDF_BYTES, intake: new Map(), ...overrides };
}

interface Harness {
  deps: ScanDependencies;
  store: FakeStore;
  calls: {
    promote: Array<{ source: string; destination: string; generation: string }>;
    metadata: Array<{ name: string; generation: string }>;
    quarantineDownloads: Array<{ name: string; generation: string }>;
    intakeDownloads: string[];
    scans: number;
  };
}

function harness(options: {
  store?: FakeStore;
  size?: number;
  maxBytes?: number;
  scan?: ClamAvResult;
  metadataError?: boolean;
  metadataReportsGeneration?: string;
  downloadError?: boolean;
  promotion?: PromotionOutcome;
  intakeBytes?: Buffer;
  intakeDownloadError?: boolean;
  /** Runs at the start of each step so a test can change the live generation at an exact point. */
  beforeMetadata?: (s: FakeStore) => void;
  beforeDownload?: (s: FakeStore) => void;
  duringScan?: (s: FakeStore) => void;
} = {}): Harness {
  const s = options.store ?? store();
  const calls: Harness["calls"] = { promote: [], metadata: [], quarantineDownloads: [], intakeDownloads: [], scans: 0 };
  const deps: ScanDependencies = {
    async getQuarantineObjectMetadata(name, generation) {
      calls.metadata.push({ name, generation });
      options.beforeMetadata?.(s);
      if (options.metadataError) throw new Error("not found");
      // A pinned read of a generation that is no longer live fails; it never serves a newer generation.
      if (generation !== s.live) throw new SourceGenerationUnavailableError();
      return { size: options.size ?? s.bytes.length, generation: options.metadataReportsGeneration ?? generation, contentType: "application/pdf" };
    },
    async downloadQuarantineObject(name, generation) {
      calls.quarantineDownloads.push({ name, generation });
      options.beforeDownload?.(s);
      if (options.downloadError) throw new Error("download failed");
      if (generation !== s.live) throw new SourceGenerationUnavailableError();
      return s.bytes;
    },
    async promoteQuarantineObjectToIntake(source, destination, generation) {
      calls.promote.push({ source, destination, generation });
      // Pinned copy: if the scanned generation is no longer live, GCS answers 404 and nothing is written.
      if (generation !== s.live) return { status: "SOURCE_GENERATION_UNAVAILABLE" };
      if (options.promotion) return options.promotion;
      // Create-only destination: an existing object is left untouched.
      if (s.intake.has(destination)) return { status: "SKIPPED_ALREADY_EXISTS" };
      s.intake.set(destination, s.bytes);
      return { status: "PROMOTED" };
    },
    async downloadIntakeObject(name) {
      calls.intakeDownloads.push(name);
      if (options.intakeDownloadError) throw new Error("intake read failed");
      return options.intakeBytes ?? s.intake.get(name) ?? s.bytes;
    },
    async scanFile() {
      calls.scans += 1;
      options.duringScan?.(s);
      return options.scan ?? { outcome: "CLEAN" as const };
    },
    maxObjectBytes: () => options.maxBytes ?? 25 * 1024 * 1024,
    clamScanTimeoutMs: () => 60_000,
  };
  return { deps, store: s, calls };
}

test("generation N: metadata, download and promotion all carry generation N, and a CLEAN file is promoted to the canonical Intake path with verified integrity", async () => {
  const ids = canonicalIds();
  const h = harness();
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(ids)), h.deps);

  assert.equal(assessment.securityDecision, "CLEARED");
  assert.equal(assessment.promotionStatus, "PROMOTED");
  assert.equal(assessment.sourceGeneration, GEN_N);
  assert.equal(assessment.intakeObjectName, intakeNameFor(ids));
  assert.deepEqual(h.calls.metadata, [{ name: objectNameFor(ids), generation: GEN_N }]);
  assert.deepEqual(h.calls.quarantineDownloads, [{ name: objectNameFor(ids), generation: GEN_N }]);
  assert.deepEqual(h.calls.promote, [{ source: objectNameFor(ids), destination: intakeNameFor(ids), generation: GEN_N }]);
  assert.equal(assessment.sha256, computeSha256(PDF_BYTES));
  assert.deepEqual(h.calls.intakeDownloads, [intakeNameFor(ids)], "post-copy: the destination must be re-read and re-hashed, never assumed");
});

test("promotion is explicitly pinned to the scanned source generation (the generation from the event), not discovered at promotion time", async () => {
  const h = harness();
  await assessQuarantineObject(requestFor(objectNameFor(canonicalIds()), { generation: GEN_N }), h.deps);
  assert.equal(h.calls.promote.length, 1);
  assert.equal(h.calls.promote[0]!.generation, GEN_N);
});

test("generation changes BEFORE the metadata read: nothing is scanned or promoted, and N+1 is never treated as N", async () => {
  const h = harness({ beforeMetadata: (s) => { s.live = GEN_N_PLUS_1; } });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);

  assert.equal(assessment.securityDecision, "UNABLE_TO_SCAN");
  assert.deepEqual(assessment.reasonCodes, ["SOURCE_GENERATION_CHANGED"]);
  assert.equal(h.calls.quarantineDownloads.length, 0);
  assert.equal(h.calls.scans, 0);
  assert.equal(h.calls.promote.length, 0);
  assert.equal(h.store.intake.size, 0);
});

test("generation changes between the metadata read and the download: the N+1 bytes are never returned or scanned as N", async () => {
  const h = harness({ beforeDownload: (s) => { s.live = GEN_N_PLUS_1; s.bytes = OTHER_BYTES; } });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);

  assert.equal(assessment.securityDecision, "UNABLE_TO_SCAN");
  assert.deepEqual(assessment.reasonCodes, ["SOURCE_GENERATION_CHANGED"]);
  assert.equal(h.calls.scans, 0);
  assert.equal(assessment.sha256, undefined, "no hash of any bytes was ever taken");
  assert.equal(h.calls.promote.length, 0);
  assert.equal(h.store.intake.size, 0);
});

test("generation changes AFTER the scan but BEFORE promotion: the newer generation is not promoted, the result is not CLEARED, and Intake stays empty", async () => {
  const ids = canonicalIds();
  const h = harness({ duringScan: (s) => { s.live = GEN_N_PLUS_1; s.bytes = OTHER_BYTES; } });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(ids)), h.deps);

  assert.notEqual(assessment.securityDecision, "CLEARED");
  assert.equal(assessment.securityDecision, "REVIEW_REQUIRED");
  assert.deepEqual(assessment.reasonCodes, ["SOURCE_GENERATION_CHANGED"]);
  assert.equal(assessment.promotionStatus, "FAILED");
  // The one promotion attempt was pinned to N; it did not copy N+1.
  assert.deepEqual(h.calls.promote, [{ source: objectNameFor(ids), destination: intakeNameFor(ids), generation: GEN_N }]);
  assert.equal(h.store.intake.size, 0, "no bytes - scanned or not - reached Intake");
  assert.equal(h.calls.intakeDownloads.length, 0);
});

test("the object disappearing after the scan is handled the same way: not CLEARED, nothing promoted", async () => {
  const h = harness({ duringScan: (s) => { s.live = "0"; } });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.equal(assessment.securityDecision, "REVIEW_REQUIRED");
  assert.deepEqual(assessment.reasonCodes, ["SOURCE_GENERATION_CHANGED"]);
  assert.equal(h.store.intake.size, 0);
});

test("a pinned metadata read that reports a DIFFERENT generation is rejected (defense in depth)", async () => {
  const h = harness({ metadataReportsGeneration: GEN_N_PLUS_1 });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.equal(assessment.securityDecision, "UNABLE_TO_SCAN");
  assert.deepEqual(assessment.reasonCodes, ["SOURCE_GENERATION_CHANGED"]);
  assert.equal(h.calls.quarantineDownloads.length, 0);
});

test("an event with no generation fails closed before any storage call - the current generation is never substituted", async () => {
  const h = harness();
  const request = requestFor(objectNameFor(canonicalIds()));
  delete request.generation;
  const assessment = await assessQuarantineObject(request, h.deps);

  assert.equal(assessment.securityDecision, "UNABLE_TO_SCAN");
  assert.deepEqual(assessment.reasonCodes, ["SOURCE_GENERATION_MISSING"]);
  assert.equal(h.calls.metadata.length, 0);
  assert.equal(h.calls.quarantineDownloads.length, 0);
  assert.equal(h.calls.scans, 0);
  assert.equal(h.calls.promote.length, 0);
});

test("a malformed generation (anything the GCS client would silently turn into an UNPINNED request) fails closed", async () => {
  for (const generation of ["", "abc", "0", "-5", "1.5", "1e15", "1730000000000000x", " 1730000000000000", "99999999999999999999"]) {
    const h = harness();
    const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds()), { generation }), h.deps);
    assert.deepEqual(assessment.reasonCodes, ["SOURCE_GENERATION_MISSING"], JSON.stringify(generation));
    assert.equal(h.calls.metadata.length, 0, JSON.stringify(generation));
    assert.equal(h.calls.promote.length, 0, JSON.stringify(generation));
  }
});

test("promotion never deletes or modifies the quarantine source: the only mutation attempted is one create-only copy into Intake", async () => {
  const ids = canonicalIds();
  const h = harness();
  await assessQuarantineObject(requestFor(objectNameFor(ids)), h.deps);
  assert.equal(h.calls.promote.length, 1);
  assert.equal(h.store.live, GEN_N, "the quarantine source generation is untouched");
  // ScanDependencies exposes no delete/overwrite operation at all - the quarantine source cannot be removed by this flow.
  assert.equal(Object.keys(h.deps).some((key) => /delete|remove|overwrite/i.test(key)), false);
});

test("a detected threat is never promoted", async () => {
  const h = harness({ scan: { outcome: "THREAT_DETECTED", threatName: "Eicar-Test-Signature" } });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.equal(assessment.securityDecision, "THREAT_DETECTED");
  assert.equal(assessment.promotionStatus, "NOT_ATTEMPTED");
  assert.equal(h.calls.promote.length, 0);
  assert.equal(h.calls.intakeDownloads.length, 0);
});

test("a scan engine failure is UNABLE_TO_SCAN (fail closed) - never promoted, never confused with a threat", async () => {
  const h = harness({ scan: { outcome: "SCAN_ERROR" } });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.equal(assessment.securityDecision, "UNABLE_TO_SCAN");
  assert.deepEqual(assessment.reasonCodes, ["SCAN_ENGINE_ERROR"]);
  assert.equal(h.calls.promote.length, 0);
});

test("a clean scan on an unsupported file type is REVIEW_REQUIRED and never promoted", async () => {
  const h = harness({ store: store({ bytes: Buffer.from("MZ\x90\x00 not a document at all") }) });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.equal(assessment.securityDecision, "REVIEW_REQUIRED");
  assert.equal(h.calls.promote.length, 0);
});

test("a file whose bytes contradict its claimed MIME type is REVIEW_REQUIRED and never promoted", async () => {
  const h = harness();
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds()), { contentType: "image/png" }), h.deps);
  assert.equal(assessment.securityDecision, "REVIEW_REQUIRED");
  assert.deepEqual(assessment.reasonCodes, ["FILE_SIGNATURE_MISMATCH"]);
  assert.equal(h.calls.promote.length, 0);
});

test("a non-canonical (non-UUID) quarantine path is declined before any storage or scan call is made", async () => {
  const h = harness();
  const assessment = await assessQuarantineObject(
    requestFor(`quarantine/${COMPANY_ID}/batch-phaseb-clean-001/source-phaseb-clean-001/source`),
    h.deps,
  );
  assert.equal(assessment.securityDecision, "REVIEW_REQUIRED");
  assert.deepEqual(assessment.reasonCodes, ["INVALID_SOURCE_PATH"]);
  assert.equal(h.calls.metadata.length, 0);
  assert.equal(h.calls.quarantineDownloads.length, 0);
  assert.equal(h.calls.scans, 0);
  assert.equal(h.calls.promote.length, 0);
});

test("an intake-prefixed object name is never processed as a quarantine object", async () => {
  const ids = canonicalIds();
  const h = harness();
  const assessment = await assessQuarantineObject(requestFor(intakeNameFor(ids)), h.deps);
  assert.deepEqual(assessment.reasonCodes, ["INVALID_SOURCE_PATH"]);
  assert.equal(h.calls.promote.length, 0);
});

test("a missing quarantine object (generic metadata read failure) is UNABLE_TO_SCAN and never promoted", async () => {
  const h = harness({ metadataError: true });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.equal(assessment.securityDecision, "UNABLE_TO_SCAN");
  assert.deepEqual(assessment.reasonCodes, ["SOURCE_DOWNLOAD_FAILED"]);
  assert.equal(h.calls.promote.length, 0);
});

test("a failed source download is UNABLE_TO_SCAN and never promoted", async () => {
  const h = harness({ downloadError: true });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.equal(assessment.securityDecision, "UNABLE_TO_SCAN");
  assert.deepEqual(assessment.reasonCodes, ["SOURCE_DOWNLOAD_FAILED"]);
  assert.equal(h.calls.scans, 0);
  assert.equal(h.calls.promote.length, 0);
});

test("an oversized object is UNABLE_TO_SCAN before any byte is downloaded", async () => {
  const h = harness({ size: 1000, maxBytes: 10 });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.deepEqual(assessment.reasonCodes, ["FILE_TOO_LARGE"]);
  assert.equal(h.calls.quarantineDownloads.length, 0);
});

test("a failed promotion is REVIEW_REQUIRED/INTAKE_PROMOTION_FAILED - never reported as CLEARED", async () => {
  const h = harness({ promotion: { status: "FAILED", error: new Error("backend") } });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.equal(assessment.securityDecision, "REVIEW_REQUIRED");
  assert.equal(assessment.promotionStatus, "FAILED");
  assert.deepEqual(assessment.reasonCodes, ["INTAKE_PROMOTION_FAILED"]);
  assert.equal(h.calls.intakeDownloads.length, 0);
});

test("duplicate Eventarc delivery (same generation) is safe and idempotent: the existing identical Intake object is re-verified by hash, not rewritten", async () => {
  const ids = canonicalIds();
  const shared = store();
  const first = harness({ store: shared });
  const second = harness({ store: shared });

  const a = await assessQuarantineObject(requestFor(objectNameFor(ids)), first.deps);
  const intakeAfterFirst = shared.intake.get(intakeNameFor(ids));
  const b = await assessQuarantineObject(requestFor(objectNameFor(ids)), second.deps);

  assert.equal(a.promotionStatus, "PROMOTED");
  assert.equal(b.securityDecision, "CLEARED");
  assert.equal(b.promotionStatus, "ALREADY_EXISTS_VERIFIED_IDENTICAL");
  assert.deepEqual(first.calls.promote, second.calls.promote, "a redelivery targets the identical pinned generation and canonical destination");
  assert.equal(second.calls.intakeDownloads.length, 1, "the existing destination is re-read and re-hashed, not assumed");
  assert.equal(shared.intake.size, 1);
  assert.equal(shared.intake.get(intakeNameFor(ids)), intakeAfterFirst, "the Intake object was not rewritten");
});

test("an existing Intake object with DIFFERENT bytes is never overwritten or accepted: REVIEW_REQUIRED/ALREADY_EXISTS_HASH_MISMATCH and the object is untouched", async () => {
  const ids = canonicalIds();
  const shared = store({ intake: new Map([[intakeNameFor(ids), OTHER_BYTES]]) });
  const h = harness({ store: shared });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(ids)), h.deps);

  assert.equal(assessment.securityDecision, "REVIEW_REQUIRED");
  assert.equal(assessment.promotionStatus, "ALREADY_EXISTS_HASH_MISMATCH");
  assert.deepEqual(assessment.reasonCodes, ["INTEGRITY_CHECK_FAILED"]);
  assert.equal(h.calls.promote.length, 1, "exactly one create-only attempt; no repair or second write");
  assert.equal(shared.intake.get(intakeNameFor(ids)), OTHER_BYTES, "the pre-existing Intake object is byte-for-byte untouched");
});

test("post-copy SHA-256 verification still runs: a freshly copied destination whose hash differs from the scanned bytes is REVIEW_REQUIRED/PROMOTED_INTEGRITY_MISMATCH", async () => {
  const h = harness({ intakeBytes: OTHER_BYTES });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.equal(h.calls.intakeDownloads.length, 1);
  assert.equal(assessment.securityDecision, "REVIEW_REQUIRED");
  assert.equal(assessment.promotionStatus, "PROMOTED_INTEGRITY_MISMATCH");
});

test("if the destination cannot be re-read for verification, the result is REVIEW_REQUIRED/INTEGRITY_CHECK_FAILED, never CLEARED", async () => {
  const h = harness({ intakeDownloadError: true });
  const assessment = await assessQuarantineObject(requestFor(objectNameFor(canonicalIds())), h.deps);
  assert.equal(assessment.securityDecision, "REVIEW_REQUIRED");
  assert.equal(assessment.promotionStatus, "FAILED");
  assert.deepEqual(assessment.reasonCodes, ["INTEGRITY_CHECK_FAILED"]);
});

test("the intake destination is derived only from the validated quarantine identity, never from any request-supplied destination field", async () => {
  const ids = canonicalIds();
  const h = harness();
  const request = { ...requestFor(objectNameFor(ids)), destination: "intake/attacker/chosen/path/source" } as ScanRequest;
  const assessment = await assessQuarantineObject(request, h.deps);
  assert.equal(assessment.intakeObjectName, intakeNameFor(ids));
});
