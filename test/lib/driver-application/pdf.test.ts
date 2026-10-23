import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { canonicalJson } from "@/lib/driver-application/canonical";
import { pdfSafe, renderApplicationPdf, type PdfInput } from "@/lib/driver-application/pdf/render";
import { planSha256, resolvePlan } from "@/lib/driver-application/plan";
import { buildSnapshot, snapshotSha256 } from "@/lib/driver-application/snapshot";
import { evaluateScope, validateScopeInput } from "@/lib/driver-prospects/operating-scope";
import { pdfText } from "../../helpers/pdf-text";
import { validAnswers } from "../../helpers/driver-application-fill";

function fixture(over: { name?: string; submittedAt?: string } = {}): PdfInput {
  const v = validateScopeInput({ kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: { cmvOperation: "YES", cdlRequired: "YES", pspIntended: true } });
  assert.ok(v.ok);
  const e = evaluateScope(v.ok ? v.value : null);
  const plan = resolvePlan({ scope: (v as unknown as { value: never }).value, profile: e.profile!, carrierCountry: "US", hrSelections: {}, gates: { vaultReady: false, approvedSensitiveFields: [] } });
  const answers = validAnswers(plan, { "identity.legal_first_name": over.name ?? "Zoë", "identity.legal_last_name": "Tremblay", "licence.has_commercial_licence": "yes", "licence.number": "D1234567890" });
  const consents = plan.consents.filter((c) => !c.external).map((c) => ({ key: c.key, version: c.version, textSha256: c.textSha256, acceptedAt: "2026-03-01T15:04:05.000Z", signatureName: `${answers["identity.legal_first_name"]} Tremblay`, legalStatus: c.legalStatus, jurisdiction: "US", purpose: c.purpose }));
  const snapshot = buildSnapshot({
    plan, planSha256: planSha256(plan), answers,
    consents: consents.map(({ key, version, textSha256, acceptedAt, signatureName }) => ({ key, version, textSha256, acceptedAt, signatureName })),
    presentations: [], uploads: [{ fieldId: "licence.front", slot: "", documentId: "00000000-0000-4000-8000-000000000001", documentClass: "LICENCE", filename: "front.png", byteSize: 70, state: "quarantined" }], sensitiveCollected: [],
  });
  return { companyName: "Prairie Freight Ltd", applicantName: `${answers["identity.legal_first_name"]} Tremblay`, receiptId: "TES-DA-TEST0001", submittedAt: over.submittedAt ?? "2026-03-01T15:10:00.000Z", plan, planSha256: planSha256(plan), snapshot, snapshotSha256: snapshotSha256(snapshot), consents };
}

describe("application PDF", () => {
  it("is reproducible: the same record always yields byte-identical output (no clock, no random ids)", async () => {
    const a = await renderApplicationPdf(fixture());
    await new Promise((r) => setTimeout(r, 1100));
    await renderApplicationPdf(fixture({ name: "Someone Else" })); // unrelated work in between must not change the next output
    const b = await renderApplicationPdf(fixture());
    assert.equal(createHash("sha256").update(a).digest("hex"), createHash("sha256").update(b).digest("hex"));
  });

  it("changes when the record changes, and carries the hashes that identify it", async () => {
    const base = fixture();
    const other = fixture({ name: "Pat" });
    const a = await renderApplicationPdf(base);
    const b = await renderApplicationPdf(other);
    assert.notEqual(createHash("sha256").update(a).digest("hex"), createHash("sha256").update(b).digest("hex"));
    const text = pdfText(a);
    assert.ok(text.includes(base.snapshotSha256));
    assert.ok(text.includes(base.planSha256));
    assert.ok(text.includes(base.receiptId));
  });

  it("is a valid PDF with fixed metadata dates, one page per authorization and a numbered footer", async () => {
    const input = fixture();
    const bytes = await renderApplicationPdf(input);
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    assert.equal(doc.getCreationDate()?.toISOString(), input.submittedAt);
    assert.equal(doc.getModificationDate()?.toISOString(), input.submittedAt);
    const text = pdfText(bytes);
    for (const c of input.consents) {
      const title = input.plan.consents.find((x) => x.key === c.key)!.title;
      assert.ok(text.includes(pdfSafe(title).slice(0, 24)), `authorization "${title}" has its own page`);
    }
    assert.ok(new RegExp(`Page 1 of ${doc.getPageCount()}`).test(text));
  });

  it("never claims anything is verified, and states the pending-legal-review status of unapproved wording", async () => {
    const text = pdfText(await renderApplicationPdf(fixture()));
    assert.ok(/APPLICANT-DECLARED/.test(text));
    assert.ok(/not been verified|not verified/i.test(text));
    assert.ok(/PENDING LEGAL REVIEW/.test(text));
    for (const line of text.split("\n").filter((l) => /\bverified\b/i.test(l))) assert.ok(/PENDING|not (been )?verified|nothing in this document|counsel|unverified/i.test(line), `a line claims verification: ${line}`);
    assert.ok(/separate, official or standalone process/.test(text), "the PSP process is shown as external");
  });

  it("masks identifiers: the licence number shows only its last four characters, and no restricted identifier appears", async () => {
    const text = pdfText(await renderApplicationPdf(fixture()));
    assert.ok(!text.includes("D1234567890"));
    assert.ok(text.includes("7890"));
    assert.ok(!/\b\d{3}-?\d{2}-?\d{4}\b/.test(text));
  });

  it("copes with characters outside the PDF character set without failing", async () => {
    assert.equal(pdfSafe("Nguyễn “quote” — ok"), 'Nguy?n "quote" - ok');
    const bytes = await renderApplicationPdf(fixture({ name: "Nguyễn" }));
    assert.ok(bytes.byteLength > 1000);
  });

  it("the snapshot hash it prints is the hash of the canonical snapshot JSON (independently recomputable)", () => {
    const input = fixture();
    assert.equal(createHash("sha256").update(canonicalJson(input.snapshot), "utf8").digest("hex"), input.snapshotSha256);
  });
});
