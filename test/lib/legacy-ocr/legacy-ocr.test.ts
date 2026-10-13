import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

type Policy = typeof import("../../../lib/legacy-ocr/upload-policy.ts");
let P: Policy;

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16 - values.length).fill(0)]);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d); // %PDF-
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const EXE = bytes(0x4d, 0x5a); // MZ

describe("legacy OCR upload policy", () => {
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    P = await import("@/lib/legacy-ocr/upload-policy");
  });

  it("accepts a PDF and an image whose bytes match the declared type", () => {
    assert.equal(P.validateLegacyOcrFile({ name: "a.pdf", type: "application/pdf", size: 10, prefix: PDF }, 100), "application/pdf");
    assert.equal(P.validateLegacyOcrFile({ name: "a.png", type: "image/png", size: 10, prefix: PNG }, 100), "image/png");
  });

  it("treats an empty declared type as PDF only for a .pdf name, and the signature must still confirm it", () => {
    assert.equal(P.validateLegacyOcrFile({ name: "scan.PDF", type: "", size: 10, prefix: PDF }, 100), "application/pdf");
    assert.throws(() => P.validateLegacyOcrFile({ name: "scan.pdf", type: "", size: 10, prefix: EXE }, 100), P.LegacyOcrUploadError);
    assert.throws(() => P.validateLegacyOcrFile({ name: "scan.bin", type: "", size: 10, prefix: PDF }, 100), P.LegacyOcrUploadError);
  });

  it("rejects a disguised executable, an unsupported type, an empty file and an oversized file", () => {
    assert.throws(() => P.validateLegacyOcrFile({ name: "x.pdf", type: "application/pdf", size: 10, prefix: EXE }, 100), /does not match/);
    assert.throws(() => P.validateLegacyOcrFile({ name: "x.exe", type: "application/x-msdownload", size: 10, prefix: EXE }, 100), /supported/);
    assert.throws(() => P.validateLegacyOcrFile({ name: "x.pdf", type: "application/pdf", size: 0, prefix: PDF }, 100), P.LegacyOcrUploadError);
    const big = (() => { try { P.validateLegacyOcrFile({ name: "x.pdf", type: "application/pdf", size: 101, prefix: PDF }, 100); } catch (error) { return error as InstanceType<typeof P.LegacyOcrUploadError>; } })();
    assert.equal(big?.status, 413);
  });

  it("production default is CLOSED; an exception must be a real, future, bounded date", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    assert.deepEqual(P.legacyOcrAvailability({}, now), { open: false, reason: "closed_by_default" });
    assert.deepEqual(P.legacyOcrAvailability({ TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL: "" }, now), { open: false, reason: "closed_by_default" });
    assert.deepEqual(P.legacyOcrAvailability({ TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL: "true" }, now), { open: false, reason: "exception_invalid" });
    assert.deepEqual(P.legacyOcrAvailability({ TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL: "2026-02-30" }, now), { open: false, reason: "exception_invalid" });
    assert.deepEqual(P.legacyOcrAvailability({ TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL: "2026-10-12" }, now), { open: false, reason: "exception_expired" });
    assert.deepEqual(P.legacyOcrAvailability({ TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL: "2027-01-01" }, now), { open: false, reason: "exception_too_long" });
    assert.deepEqual(P.legacyOcrAvailability({ TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL: "2026-10-20" }, now), { open: true, exceptionUntil: "2026-10-20" });
    assert.deepEqual(P.legacyOcrAvailability({ TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL: "2026-11-12" }, now), { open: true, exceptionUntil: "2026-11-12" }, "30 days is the maximum");
    assert.equal(P.legacyOcrAvailability({ TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL: "2026-11-13" }, now).open, false);
  });

  it("the explicit disable flag overrides any exception", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    assert.deepEqual(P.legacyOcrAvailability({ TES_LEGACY_OCR_DISABLED: " TRUE ", TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL: "2026-10-20" }, now), { open: false, reason: "disabled" });
  });
});

describe("legacy OCR routes (static ordering)", () => {
  for (const file of ["app/api/document-ai/route.ts", "app/api/business-document-ocr/route.ts"]) {
    it(`${file}: kill switch, then authorization, then the form is parsed and the file validated, before any Google call`, () => {
      const code = read(file);
      const order = ["legacyOcrAvailability()", "authorizeLegacyOcr()", "formData()", "validateLegacyOcrFile(", "getGoogleAccessToken()"].map((needle) => code.indexOf(needle));
      assert.ok(order.every((index) => index >= 0), "all steps are present");
      assert.deepEqual([...order].sort((a, b) => a - b), order, "steps are in the safe order");
    });
  }
});

describe("legacy OCR routes (production-default behavior)", () => {
  const ROUTES = [
    ["document-ai", "@/app/api/document-ai/route"],
    ["business-document-ocr", "@/app/api/business-document-ocr/route"],
  ] as const;

  for (const [name, module] of ROUTES) {
    it(`${name}: with no exception configured, an unscanned browser upload never reaches Document AI, Google auth, or even the form body`, async () => {
      await import("../../helpers/register-auth-test-loader.mjs");
      const saved = { ...process.env };
      delete process.env.TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL;
      delete process.env.TES_LEGACY_OCR_DISABLED;
      const realFetch = globalThis.fetch;
      const outbound: string[] = [];
      globalThis.fetch = (async (input: unknown) => { outbound.push(String(input)); throw new Error("no network in this test"); }) as typeof fetch;
      try {
        const route = await import(module);
        const form = new FormData();
        form.append("file", new File([PDF], "scan.pdf", { type: "application/pdf" }));
        let bodyRead = false;
        const request = new Request("http://localhost/api", { method: "POST", body: form }) as Request & { formData: () => Promise<FormData> };
        const original = request.formData.bind(request);
        request.formData = async () => { bodyRead = true; return original(); };
        const response = await route.POST(request as never);
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.match(body.error, /manual/i);
        assert.equal(bodyRead, false, "the upload is not even read");
        assert.deepEqual(outbound, [], "no outbound request of any kind");
      } finally {
        globalThis.fetch = realFetch;
        process.env = saved;
      }
    });
  }

  it("an expired or malformed exception leaves both routes closed", async () => {
    const P2 = await import("@/lib/legacy-ocr/upload-policy");
    for (const value of ["2020-01-01", "yes", "9999-12-31"]) {
      assert.equal(P2.legacyOcrAvailability({ TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL: value }).open, false, value);
    }
  });
});
