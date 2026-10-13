import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

type V = typeof import("../../../lib/evidence-payload/validation.ts");
let V: V;

const pdf = Buffer.from("%PDF-1.7\nbody");
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12)]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(4)]);
const heic = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(4)]);

const good = (over: Record<string, unknown> = {}) => ({ documentType: "CUSTOMER_AUTHORITY_NOTICE", documentTitle: "Notice", mimeType: "application/pdf", originalFilename: "n.pdf", bytes: pdf, ...over });

describe("evidence payload validation", () => {
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    V = await import("@/lib/evidence-payload/validation");
  });

  it("accepts each allowed type when the magic bytes agree and hashes the bytes", () => {
    for (const [mimeType, bytes] of [["application/pdf", pdf], ["image/png", png], ["image/jpeg", jpeg], ["image/webp", webp], ["image/heic", heic]] as const) {
      const validated = V.validateUpload(good({ mimeType, bytes }));
      assert.equal(validated.mimeType, mimeType);
      assert.equal(validated.byteSize, bytes.byteLength);
      assert.match(validated.sha256, /^[a-f0-9]{64}$/);
      assert.equal(validated.sha256, V.sha256Hex(bytes));
    }
  });

  it("rejects a MIME type that the bytes do not support, and every type outside the allow-list", () => {
    assert.throws(() => V.validateUpload(good({ mimeType: "image/png" })), V.PayloadValidationError);
    assert.throws(() => V.validateUpload(good({ mimeType: "application/pdf", bytes: png })), V.PayloadValidationError);
    for (const mimeType of ["text/html", "application/zip", "application/x-msdownload", "image/svg+xml", "", "application/octet-stream"]) {
      assert.throws(() => V.validateUpload(good({ mimeType })), V.PayloadValidationError, mimeType);
    }
  });

  it("enforces size limits on the actual bytes, not a claim", () => {
    assert.throws(() => V.validateUpload(good({ bytes: Buffer.alloc(0) })), V.PayloadValidationError);
    assert.throws(() => V.validateUpload(good({ bytes: Buffer.concat([pdf, Buffer.alloc(25 * 1024 * 1024)]) })), V.PayloadValidationError);
    assert.doesNotThrow(() => V.validateUpload(good({ bytes: Buffer.concat([pdf, Buffer.alloc(25 * 1024 * 1024 - pdf.byteLength)]) })));
  });

  it("validates document type and title", () => {
    for (const documentType of ["lower", "HAS SPACE", "A", "", 5, null]) assert.throws(() => V.validateUpload(good({ documentType })), V.PayloadValidationError);
    for (const documentTitle of ["", "   ", "x".repeat(241), "bad\u0007title", 5]) assert.throws(() => V.validateUpload(good({ documentTitle })), V.PayloadValidationError);
    assert.equal(V.validateUpload(good({ documentTitle: "  trimmed  " })).documentTitle, "trimmed");
  });

  it("sanitizes the original filename into display metadata (no path, no control characters, bounded)", () => {
    assert.equal(V.sanitizeOriginalFilename("../../etc/passwd"), "passwd");
    assert.equal(V.sanitizeOriginalFilename("C:\\Users\\x\\scan.pdf"), "scan.pdf");
    assert.equal(V.sanitizeOriginalFilename("a\r\nb.pdf"), "ab.pdf");
    assert.equal(V.sanitizeOriginalFilename(""), "uploaded-document");
    assert.equal(V.sanitizeOriginalFilename("\u0000\u0001"), "uploaded-document");
    const long = V.sanitizeOriginalFilename(`${"a".repeat(400)}.pdf`);
    assert.equal(long.length, 255);
    assert.ok(long.endsWith(".pdf"));
  });
});
