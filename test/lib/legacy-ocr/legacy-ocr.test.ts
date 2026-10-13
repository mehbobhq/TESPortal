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

  it("the kill switch is off unless explicitly set to true", () => {
    assert.equal(P.legacyOcrDisabled({}), false);
    assert.equal(P.legacyOcrDisabled({ TES_LEGACY_OCR_DISABLED: "false" }), false);
    assert.equal(P.legacyOcrDisabled({ TES_LEGACY_OCR_DISABLED: " TRUE " }), true);
  });
});

describe("legacy OCR routes (static ordering)", () => {
  for (const file of ["app/api/document-ai/route.ts", "app/api/business-document-ocr/route.ts"]) {
    it(`${file}: kill switch, then authorization, then the form is parsed and the file validated, before any Google call`, () => {
      const code = read(file);
      const order = ["legacyOcrDisabled()", "authorizeLegacyOcr()", "formData()", "validateLegacyOcrFile(", "getGoogleAccessToken()"].map((needle) => code.indexOf(needle));
      assert.ok(order.every((index) => index >= 0), "all steps are present");
      assert.deepEqual([...order].sort((a, b) => a - b), order, "steps are in the safe order");
    });
  }
});
