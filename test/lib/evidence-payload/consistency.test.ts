import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

type C = typeof import("../../../lib/evidence-payload/consistency.ts");
let C: C;

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-10-13T12:00:00Z");

const row = (n: number, over: Record<string, unknown> = {}) => ({
  payloadId: uuid(n), documentId: uuid(100 + n), organizationId: ORG, state: "stored" as const,
  quarantineObjectName: `quarantine/${ORG}/${uuid(200 + n)}/${uuid(300 + n)}/source`,
  intakeObjectName: `intake/${ORG}/${uuid(200 + n)}/${uuid(300 + n)}/source`, intakeGeneration: "7",
  evidenceObjectName: `evidence/${ORG}/${uuid(100 + n)}/source`, evidenceGeneration: "9", byteSize: 100, createdAt: "2026-10-13T11:00:00.000000Z", ...over,
});
const object = (name: string, over: Record<string, unknown> = {}) => ({ name, generation: "9", size: 100, ...over });

describe("payload consistency classification", () => {
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    C = await import("@/lib/evidence-payload/consistency");
  });

  it("is clean when every row has its object and every object has its row", () => {
    const r = row(1);
    assert.deepEqual(C.classifyPayloadConsistency({ rows: [r], evidence: [object(r.evidenceObjectName)], intake: [object(r.intakeObjectName, { generation: "7" })], now: NOW }), []);
  });

  it("reports missing, resized and regenerated evidence objects as critical", () => {
    const [a, b, c] = [row(1), row(2), row(3)];
    const findings = C.classifyPayloadConsistency({
      rows: [a, b, c],
      evidence: [object(b.evidenceObjectName, { size: 5 }), object(c.evidenceObjectName, { generation: "10" })],
      now: NOW,
    });
    assert.deepEqual(findings.map((f) => `${f.code}:${f.documentId}`).sort(), [
      `EVIDENCE_GENERATION_MISMATCH:${c.documentId}`, `EVIDENCE_SIZE_MISMATCH:${b.documentId}`, `MISSING_EVIDENCE_OBJECT:${a.documentId}`,
    ].sort());
    assert.ok(findings.every((f) => f.severity === "critical"));
  });

  it("reports orphan objects in every bucket and unrecognized names", () => {
    const findings = C.classifyPayloadConsistency({
      rows: [],
      quarantine: [object(`quarantine/${ORG}/${uuid(1)}/${uuid(2)}/source`)],
      intake: [object(`intake/${ORG}/${uuid(1)}/${uuid(2)}/source`)],
      evidence: [object(`evidence/${ORG}/${uuid(3)}/source`), object("evidence/readme.txt"), object(`intake/${ORG}/${uuid(1)}/${uuid(2)}/source`)],
      now: NOW,
    });
    assert.deepEqual(findings.map((f) => f.code).sort(), ["ORPHAN_EVIDENCE_OBJECT", "ORPHAN_INTAKE_OBJECT", "ORPHAN_QUARANTINE_OBJECT", "UNRECOGNIZED_OBJECT", "UNRECOGNIZED_OBJECT"].sort());
  });

  it("flags a scan that has not completed after the threshold, and a cleared payload that lost its intake object", () => {
    const stalled = row(1, { state: "quarantined", intakeObjectName: null, intakeGeneration: null, evidenceObjectName: null, evidenceGeneration: null, createdAt: "2026-10-10T00:00:00.000000Z" });
    const fresh = row(2, { state: "quarantined", intakeObjectName: null, intakeGeneration: null, evidenceObjectName: null, evidenceGeneration: null });
    const cleared = row(3, { state: "cleared", evidenceObjectName: null, evidenceGeneration: null });
    const findings = C.classifyPayloadConsistency({ rows: [stalled, fresh, cleared], intake: [], evidence: [], now: NOW });
    assert.deepEqual(findings.map((f) => `${f.code}:${f.documentId}`).sort(), [`MISSING_INTAKE_OBJECT:${cleared.documentId}`, `SCAN_STALLED:${stalled.documentId}`].sort());
  });

  it("reports an object recorded under another tenant as cross-tenant", () => {
    const r = row(1, { organizationId: OTHER });
    const findings = C.classifyPayloadConsistency({ rows: [r], evidence: [object(r.evidenceObjectName)], now: NOW });
    assert.ok(findings.some((f) => f.code === "CROSS_TENANT_OBJECT"));
  });

  it("skips a check when the corresponding listing was not provided (least-privilege audits)", () => {
    assert.deepEqual(C.classifyPayloadConsistency({ rows: [row(1)], now: NOW }), []);
  });
});
