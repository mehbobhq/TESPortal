import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

type Keys = typeof import("../../../lib/evidence-payload/object-keys.ts");
type Defs = typeof import("../../../lib/evidence-payload/definitions.ts");
let K: Keys;
let D: Defs;

const ORG = "a1111111-1111-4111-8111-11111111111b";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BATCH = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";
const DOC = "55555555-5555-4555-8555-555555555555";

describe("evidence object keys", () => {
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    K = await import("@/lib/evidence-payload/object-keys");
    D = await import("@/lib/evidence-payload/definitions");
  });

  it("builds the canonical, tenant-scoped names for each stage", () => {
    assert.equal(K.quarantineKey({ organizationId: ORG, batchId: BATCH, sourceFileId: FILE }), `quarantine/${ORG}/${BATCH}/${FILE}/source`);
    assert.equal(K.intakeKey({ organizationId: ORG, batchId: BATCH, sourceFileId: FILE }), `intake/${ORG}/${BATCH}/${FILE}/source`);
    assert.equal(K.evidenceKey({ organizationId: ORG, documentId: DOC }), `evidence/${ORG}/${DOC}/source`);
    assert.equal(K.processedKey({ organizationId: ORG, documentId: DOC, artifact: "ocr-text.json" }), `processed/${ORG}/${DOC}/ocr-text.json`);
  });

  it("refuses anything that is not a canonical lower-case UUID, so a key can never be steered by input", () => {
    const bad = ["", "..", "../x", `${ORG}/..`, ORG.toUpperCase(), "CMP-123", `${ORG}\u0000`, "a/b", " " + ORG];
    for (const value of bad) {
      assert.throws(() => K.evidenceKey({ organizationId: value, documentId: DOC }), K.InvalidObjectKeyError, value);
      assert.throws(() => K.evidenceKey({ organizationId: ORG, documentId: value }), K.InvalidObjectKeyError, value);
      assert.throws(() => K.quarantineKey({ organizationId: ORG, batchId: value, sourceFileId: FILE }), K.InvalidObjectKeyError, value);
      assert.throws(() => K.intakeKey({ organizationId: ORG, batchId: BATCH, sourceFileId: value }), K.InvalidObjectKeyError, value);
    }
  });

  it("allows only the closed list of processed artifacts", () => {
    for (const artifact of ["source", "../source", "ocr-text.json/", "OCR-TEXT.JSON", "x.exe"]) {
      assert.throws(() => K.processedKey({ organizationId: ORG, documentId: DOC, artifact }), K.InvalidObjectKeyError, artifact);
    }
    for (const artifact of K.PROCESSED_ARTIFACTS) assert.doesNotThrow(() => K.processedKey({ organizationId: ORG, documentId: DOC, artifact }));
  });

  it("parses exactly the canonical shapes and nothing else", () => {
    assert.deepEqual(K.parseObjectKey(`quarantine/${ORG}/${BATCH}/${FILE}/source`), { stage: "quarantine", organizationId: ORG, batchId: BATCH, sourceFileId: FILE });
    assert.deepEqual(K.parseObjectKey(`intake/${ORG}/${BATCH}/${FILE}/source`), { stage: "intake", organizationId: ORG, batchId: BATCH, sourceFileId: FILE });
    assert.deepEqual(K.parseObjectKey(`evidence/${ORG}/${DOC}/source`), { stage: "evidence", organizationId: ORG, documentId: DOC });
    assert.deepEqual(K.parseObjectKey(`processed/${ORG}/${DOC}/preview.png`), { stage: "processed", organizationId: ORG, documentId: DOC, artifact: "preview.png" });
    const rejected = [
      `evidence/${ORG}/${DOC}/source/extra`,
      `evidence/${ORG}/${DOC}/SOURCE`,
      `evidence/${ORG}//${DOC}/source`,
      `evidence/${ORG}/../${DOC}/source`,
      `evidence/${ORG.toUpperCase()}/${DOC}/source`,
      `/evidence/${ORG}/${DOC}/source`,
      `public/${ORG}/${DOC}/source`,
      `processed/${ORG}/${DOC}/anything.bin`,
      `quarantine/${ORG}/${BATCH}/source`,
      "x".repeat(500),
    ];
    for (const name of rejected) assert.equal(K.parseObjectKey(name), null, name);
  });

  it("the tenant check ties a stored name to its organization", () => {
    const name = K.evidenceKey({ organizationId: ORG, documentId: DOC });
    assert.equal(K.keyBelongsToOrganization(name, ORG), true);
    assert.equal(K.keyBelongsToOrganization(name, OTHER), false);
    assert.equal(K.keyBelongsToOrganization(`evidence/${OTHER}/${DOC}/source`, ORG), false);
    assert.equal(K.keyBelongsToOrganization("garbage", ORG), false);
  });

  it("agrees with the scanner contract for the shapes the scanner reads and writes", () => {
    // Same shapes the document-security-scanner validates (quarantine) and derives (intake): the portal never diverges.
    const q = K.quarantineKey({ organizationId: ORG, batchId: BATCH, sourceFileId: FILE });
    assert.equal(q.replace(/^quarantine\//, "intake/"), K.intakeKey({ organizationId: ORG, batchId: BATCH, sourceFileId: FILE }));
  });

  it("lifecycle transitions are forward-only and never delete", () => {
    assert.equal(D.canTransitionPayload("quarantined", "cleared"), true);
    assert.equal(D.canTransitionPayload("cleared", "stored"), true);
    assert.equal(D.canTransitionPayload("stored", "superseded"), true);
    for (const [from, to] of [["stored", "cleared"], ["stored", "quarantined"], ["cleared", "quarantined"], ["quarantined", "stored"], ["blocked", "stored"], ["archived", "stored"]] as const) {
      assert.equal(D.canTransitionPayload(from, to), false, `${from}->${to}`);
    }
    assert.deepEqual(D.LIFECYCLE_TRANSITIONS.archived, []);
    assert.equal(D.LIFECYCLE_STATES.includes("deleted" as never), false);
    assert.deepEqual([...D.VIEWABLE_STATES].sort(), ["archived", "stored", "superseded"]);
  });
});
