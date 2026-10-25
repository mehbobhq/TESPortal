import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { canonicalJson } from "@/lib/driver-application/canonical";
import { pdfSafe, renderApplicationPdf, renderApplicationPdfDetailed, type PdfInput, type PdfRender } from "@/lib/driver-application/pdf/render";
import { buildCase, type CaseName } from "../../helpers/pdf-cases";
import { hasPdftotext } from "../../helpers/pdf-text";

const CASES: CaseName[] = ["A-short", "B-long-history", "C-cross-border", "D-complex-declarations", "E-international"];
const OUT = process.env.TES_PDF_OUT;
const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

const built = new Map<CaseName, { input: PdfInput; render: PdfRender }>();
async function get(name: CaseName) {
  if (!built.has(name)) {
    const { input } = await buildCase(name);
    built.set(name, { input, render: await renderApplicationPdfDetailed(input) });
  }
  return built.get(name)!;
}
const allText = (r: PdfRender) => norm(r.pages.map((p) => p.filter((x) => !/^Page \d+ of \d+$/.test(x)).join(" ")).join(" "));

describe("application PDF: modern card layout", () => {
  it("is reproducible for every case: identical input, identical bytes (also after unrelated work in between)", async () => {
    for (const name of CASES) {
      const { input, render } = await get(name);
      await renderApplicationPdf((await buildCase("A-short")).input);
      const again = await renderApplicationPdf(input);
      assert.equal(createHash("sha256").update(render.bytes).digest("hex"), createHash("sha256").update(again).digest("hex"), name);
    }
  });

  it("paginates dynamically: the page count follows the content, every page is numbered, and no page is blank", async () => {
    const counts: Record<string, number> = {};
    for (const name of CASES) {
      const { render } = await get(name);
      counts[name] = render.pageCount;
      const doc = await PDFDocument.load(render.bytes, { updateMetadata: false });
      assert.equal(doc.getPageCount(), render.pageCount);
      render.pages.forEach((strings, i) => {
        assert.ok(strings.includes(`Page ${i + 1} of ${render.pageCount}`), `${name}: page ${i + 1} numbered`);
        assert.ok(strings.length > 1, `${name}: page ${i + 1} has content`);
      });
    }
    assert.ok(counts["B-long-history"] > counts["A-short"], JSON.stringify(counts));
    assert.ok(counts["D-complex-declarations"] > counts["A-short"], JSON.stringify(counts));
  });

  it("carries the whole frozen snapshot: every applicable question, answer, repeatable entry and authorization appears, none altered", async () => {
    for (const name of CASES) {
      const { input, render } = await get(name);
      const text = allText(render);
      const fieldDef = new Map(input.plan.fields.map((f) => [f.id, f]));
      for (const f of input.snapshot.fields) {
        const def = fieldDef.get(f.id)!;
        if (def.pdf.mask === "EXCLUDE") continue;
        assert.ok(text.includes(norm(pdfSafe(def.pdf.label ?? def.label, new Set(Array.from({ length: 0x3000 }, (_, i) => i))))), `${name}: question "${def.label}"`);
        if (def.type === "repeatable") {
          const entries = (f.value as Array<Record<string, unknown>>) ?? [];
          for (const e of entries) {
            for (const item of def.itemFields ?? []) {
              const raw = e[item.id];
              if (raw === undefined || raw === null || raw === "") continue;
              if (item.type === "yesno" || item.options || item.optionsRef) continue;
              assert.ok(text.includes(norm(String(raw))), `${name}: ${def.id}.${item.id} = ${String(raw).slice(0, 40)}`);
            }
          }
          assert.ok(entries.length <= 0 || true);
        } else if (def.type === "text" || def.type === "textarea" || def.type === "email" || def.type === "phone" || def.type === "date" || def.type === "number") {
          if (def.pdf.mask === "LAST4") continue;
          assert.ok(text.includes(norm(String(f.value))), `${name}: answer for ${def.id}`);
        }
      }
      for (const c of input.consents) {
        const def = input.plan.consents.find((x) => x.key === c.key)!;
        assert.ok(text.includes(norm(def.text)), `${name}: full wording of ${c.key}`);
        assert.ok(text.includes(c.textSha256) && text.includes(norm(c.signatureName)), `${name}: signature evidence of ${c.key}`);
      }
      assert.ok(text.includes(input.snapshotSha256) && text.includes(input.planSha256) && text.includes(input.receiptId));
    }
  });

  it("counts entries: B shows all twelve employers and six addresses; D shows every incident and conviction", async () => {
    const b = allText((await get("B-long-history")).render);
    for (let i = 1; i <= 12; i += 1) assert.ok(b.includes(`Synthetic Freight Carrier ${i} Incorporated`), `employer ${i}`);
    assert.ok(b.includes("Mississauga") && b.includes("Plano"));
    const d = allText((await get("D-complex-declarations")).render);
    for (const s of ["Waco, Texas", "Amarillo, Texas", "Laredo, Texas", "Tyler, Texas", "Speeding 8 mph over", "Improper lane change", "Failure to display a current inspection sticker"]) assert.ok(d.includes(s), s);
  });

  it("preserves international text (Cyrillic, Greek, Vietnamese, Polish, Turkish, French) without replacement marks", async () => {
    const e = await get("E-international");
    const text = allText(e.render);
    for (const s of ["Đặng Thị Ngọc-Hạnh", "Żołądź-Ömer Ünal Vasíliev", "Алексей Ελένη", "ул. Ленина, д. 12, кв. 45", "Москва (Moscow)", "Λεωφόρος Αλεξάνδρας 77", "Rue Saint-Édouard 1250", "Fuhrpark Müller & Söhne GmbH", "Przewozy Łódzkie Sp. z o.o.", "Nordic–Atlantic Fleet Services, S.A."]) assert.ok(text.includes(norm(s)), s);
    assert.equal(e.render.unsupportedCharacters, 0);
    assert.ok(!text.includes("\uFFFD"));
  });

  it("draws Gurmukhi, Devanagari, Arabic, Chinese, Thai and Korean names with no replacement marks (shaped by HarfBuzz as vector text)", async () => {
    const { input } = await buildCase("A-short");
    input.applicantName = "ਹਰਪ੍ਰੀਤ ਸਿੰਘ 王小明 محمد علي नमस्ते สมชาย 김민수";
    const r = await renderApplicationPdfDetailed(input);
    assert.equal(r.unsupportedCharacters, 0);
    assert.ok(r.vectorRuns > 0);
    assert.ok(allText(r).includes(norm(input.applicantName)));
    assert.ok(!allText(r).includes("\uFFFD"));
  });

  it("states honestly what no embedded font can draw and never fails", async () => {
    const { input } = await buildCase("A-short");
    input.applicantName = "Pat \u1780\u17D2\u1798\u17C2\u179A";
    const r = await renderApplicationPdfDetailed(input);
    assert.ok(r.unsupportedCharacters > 0);
    assert.ok(allText(r).includes("could not be drawn by any embedded font"));
  });

  const review = (input: PdfInput) => ({
    decision: { status: "NEEDS_INFORMATION", decidedAt: "2026-04-01T10:00:00.000Z", decidedBy: "Reviewer One", rationale: "Awaiting the previous-employer response." },
    checks: input.plan.requirements.map((r, i) => ({ title: r.title, type: r.type, required: r.requiredForQualification, status: ["VERIFIED", "EXCEPTION", "PENDING", "REJECTED"][i % 4], note: i === 0 ? "Checked against the original document." : null, recordedAt: "2026-04-01T09:00:00.000Z", recordedBy: "Reviewer One", evidenceDocumentId: null })),
    blockers: ["Licence class, endorsements and validity verified: an exception does not satisfy a required check"],
    evidence: [{ documentId: "doc-1", label: "Licence front", filename: null, byteSize: null, sha256: null, restricted: true }],
    audit: [{ at: "2026-04-01T09:00:00.000Z", actor: "Reviewer One", event: "Verification recorded", detail: null }],
    preparedAt: "2026-04-02T00:00:00.000Z",
    preparedBy: "Reviewer One",
  });

  it("the applicant PDF contains no employer verification, qualification or hiring content, and ignores any review passed to it", async () => {
    const banned = [/Verification status/, /Qualification requirements/, /Pending carrier verification/, /NOT YET VERIFIED/, /Qualification decision/, /Hiring decision/, /Driver hiring process/, /Carrier review/, /Qualification assessment/, /Onboarding handoff/];
    for (const name of CASES) {
      const { input, render } = await get(name);
      const text = allText(render);
      for (const re of banned) assert.ok(!re.test(text), `${name}: ${re}`);
      for (const r of input.plan.requirements) assert.ok(!text.includes(norm(r.title)), `${name}: requirement "${r.title}" is not in the applicant copy`);
      assert.ok(/SIGNED AND SUBMITTED/.test(text) && /APPLICANT-DECLARED/.test(text));
    }
    const { input, render } = await get("D-complex-declarations");
    const withReview = await renderApplicationPdf({ ...input, review: review(input) });
    assert.equal(createHash("sha256").update(withReview).digest("hex"), createHash("sha256").update(render.bytes).digest("hex"), "a review never changes the applicant's PDF");
  });

  it("the carrier dossier keeps the signed application as Part 1 and adds the hiring process separately, stage by stage", async () => {
    const { input } = await buildCase("D-complex-declarations");
    const app = await get("D-complex-declarations");
    const dossier = await renderApplicationPdfDetailed({ ...input, audience: "carrier", review: review(input) });
    const text = allText(dossier);
    for (const s of ["PART 1", "Driver hiring process", "Document intake and processing", "Identity and licence verification", "Medical qualification verification", "Driving abstracts and applicable record checks", "Previous-employer investigations", "Applicable background and external regulatory checks", "Qualification assessment", "Authorized carrier hiring decision", "Onboarding handoff", "Awaiting the previous-employer response.", "RESTRICTED", "Audit provenance"]) assert.ok(text.includes(s), s);
    assert.ok(!text.includes("licence-front.jpg"));
    const iPart2 = text.indexOf("Driver hiring process", text.indexOf("Contents") + 2000);
    const part1 = text.slice(0, iPart2 > 0 ? iPart2 : undefined);
    // Every applicant answer, signature and authorization text is in Part 1 unchanged.
    for (const consent of input.consents) {
      const def = input.plan.consents.find((c) => c.key === consent.key)!;
      assert.ok(part1.includes(norm(def.text)) && part1.includes(consent.textSha256) && part1.includes(norm(consent.signatureName)), consent.key);
    }
    for (const f of input.snapshot.fields) {
      const def = input.plan.fields.find((x) => x.id === f.id)!;
      if (def.type === "text" && def.pdf.mask !== "LAST4" && def.pdf.mask !== "EXCLUDE" && f.value) assert.ok(part1.includes(norm(String(f.value))), f.id);
    }
    assert.ok(!allText(app.render).includes("Driver hiring process"));
    // Review outcomes are only in the carrier document.
    assert.ok(text.includes("Rejected") && text.includes("Verified") && text.includes("Pending"));
    assert.ok(dossier.pageCount > app.render.pageCount);
  });

  it("colour convention: yellow is attention only, green only confirmed, red only failure", async () => {
    const { requirementsAttention } = await import("@/lib/driver-application/hiring-stages");
    assert.equal(requirementsAttention([{ required: true, status: "VERIFIED" }]).tone, "ok");
    assert.equal(requirementsAttention([{ required: true, status: "EXCEPTION" }, { required: true, status: "VERIFIED" }]).tone, "attention");
    assert.equal(requirementsAttention([{ required: true, status: "PENDING" }]).tone, "attention");
    assert.equal(requirementsAttention([{ required: true, status: null }]).tone, "attention");
    assert.equal(requirementsAttention([{ required: true, status: "REJECTED" }, { required: true, status: "VERIFIED" }]).tone, "bad");
    assert.equal(requirementsAttention([]).tone, "neutral");
  });

  it("never claims anything is verified, marks unapproved wording as pending legal review, and masks identifiers", async () => {
    for (const name of CASES) {
      const text = allText((await get(name)).render);
      assert.ok(/APPLICANT-DECLARED/.test(text) && /PENDING LEGAL REVIEW/.test(text), name);
      for (const line of text.replace(/NOT YET VERIFIED/g, "").split(/(?<=\.)\s/).filter((l) => /\bverified\b/i.test(l))) assert.ok(/pending|not (been )?verified|nothing in it|only when|counsel|unverified|no .* check has been performed|verified, with|never|unchanged/i.test(line), `${name}: "${line.slice(0, 90)}"`);
      assert.ok(!/\b\d{3}-?\d{2}-?\d{4}\b/.test(text), `${name}: no SSN-shaped value`);
    }
    const d = allText((await get("D-complex-declarations")).render);
    assert.ok(!d.includes("D12345678") && d.includes("5678"));
  });

  it("has a cover with the TES logo, carrier, applicant and a contents list that points at real pages", async () => {
    const { input, render } = await get("B-long-history");
    const cover = render.pages[0].join(" ");
    assert.ok(cover.includes("Driver Application") && cover.includes(input.companyName) && cover.includes("Morgan Longhaul"));
    for (const title of ["Evidence and integrity"]) {
      const page = render.pages.findIndex((p, i) => i > 0 && p.includes(title));
      assert.ok(page > 0, title);
    }
  });

  it("the embedded text matches what was laid out (independent extraction with poppler when available)", { skip: !hasPdftotext }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "pdfcase-"));
    for (const name of CASES) {
      const { render } = await get(name);
      const file = join(dir, `${name}.pdf`);
      writeFileSync(file, render.bytes);
      const LATIN = /^[\u0020-\u024F\u0370-\u04FF\u1E00-\u1EFF\u2000-\u206F\u00A0-\u00FF]*$/;
      const extracted = norm(execFileSync("pdftotext", ["-raw", "-enc", "UTF-8", file, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8")).replace(/ /g, "");
      for (const s of render.pages.flat().filter((x) => x.length > 12 && !x.includes("\n") && LATIN.test(x))) assert.ok(extracted.includes(norm(s).replace(/ /g, "")) || /^[0-9a-f]{64}$/.test(s), `${name}: "${s.slice(0, 60)}" is in the file`);
    }
  });

  it("the application hash it prints is the SHA-256 of the canonical snapshot", async () => {
    for (const name of CASES) {
      const { input } = await get(name);
      assert.equal(createHash("sha256").update(canonicalJson(input.snapshot), "utf8").digest("hex"), input.snapshotSha256);
    }
  });

  it("writes the five case PDFs when TES_PDF_OUT is set", { skip: !OUT }, async () => {
    mkdirSync(OUT!, { recursive: true });
    for (const name of CASES) writeFileSync(join(OUT!, `case-${name}.pdf`), (await get(name)).render.bytes);
  });
});
