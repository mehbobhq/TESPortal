import assert from "node:assert/strict";
import { test } from "node:test";

import { claimedTypeMatchesDetectedFamily, detectFileFamily } from "../src/fileSignature.js";

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(text: string): number[] {
  return Array.from(text).map((char) => char.charCodeAt(0));
}

test("detects a PDF signature", () => {
  assert.equal(detectFileFamily(bytes(ascii("%PDF-1.7"))), "application/pdf");
});

test("detects a JPEG signature", () => {
  assert.equal(detectFileFamily(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), "image/jpeg");
});

test("detects a PNG signature", () => {
  assert.equal(detectFileFamily(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
});

test("detects a WebP signature (RIFF....WEBP)", () => {
  const prefix = new Uint8Array(16);
  prefix.set(ascii("RIFF"), 0);
  prefix.set([0, 0, 0, 0], 4);
  prefix.set(ascii("WEBP"), 8);
  assert.equal(detectFileFamily(prefix), "image/webp");
});

test("detects a HEIC/HEIF ISO BMFF ftyp box", () => {
  const prefix = new Uint8Array(16);
  prefix.set([0, 0, 0, 24], 0);
  prefix.set(ascii("ftyp"), 4);
  prefix.set(ascii("heic"), 8);
  assert.equal(detectFileFamily(prefix), "image/heic-or-heif");
});

test("returns null for an unrecognized/empty prefix", () => {
  assert.equal(detectFileFamily(new Uint8Array(16)), null);
});

test("returns null for an executable signature (MZ header)", () => {
  assert.equal(detectFileFamily(bytes([0x4d, 0x5a, 0, 0, 0, 0, 0, 0])), null);
});

test("claimed PDF matches detected PDF", () => {
  assert.equal(claimedTypeMatchesDetectedFamily("application/pdf", "application/pdf"), true);
});

test("claimed PDF does not match detected PNG (signature mismatch case)", () => {
  assert.equal(claimedTypeMatchesDetectedFamily("application/pdf", "image/png"), false);
});

test("claimed HEIC matches the shared heic-or-heif detected family", () => {
  assert.equal(claimedTypeMatchesDetectedFamily("image/heic", "image/heic-or-heif"), true);
});

test("claimed HEIF also matches the shared heic-or-heif detected family", () => {
  assert.equal(claimedTypeMatchesDetectedFamily("image/heif", "image/heic-or-heif"), true);
});
