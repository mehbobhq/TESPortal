/**
 * Lightweight, prefix-only magic-byte detection - no full file parsing, no
 * inference of business/document identity. This is a standalone copy of the
 * same signature families the canonical intake endpoint checks
 * (app/api/document-intake/route.ts); this service does not import that
 * code (isolation requirement), so the two must be kept in sync in spirit,
 * not by shared code.
 *
 * TES's allowed document families (no executables, no archives):
 * PDF, JPEG, PNG, WebP, HEIC, HEIF.
 */
export type DetectedFileFamily = "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/heic-or-heif";

const HEIC_HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

function bytesEqual(prefix: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((byte, index) => prefix[offset + index] === byte);
}

function asciiAt(prefix: Uint8Array, offset: number, length: number): string {
  return Array.from(prefix.slice(offset, offset + length))
    .map((byte) => String.fromCharCode(byte))
    .join("");
}

/**
 * Detects the file family from a byte prefix (16 bytes is sufficient for
 * every signature checked here). Returns null if the bytes do not match any
 * TES-allowed family - this is a "technical uncertainty" signal, not a
 * legitimacy judgment; callers must not treat null as proof of anything
 * beyond "not a recognized TES-allowed container format".
 */
export function detectFileFamily(prefix: Uint8Array): DetectedFileFamily | null {
  if (asciiAt(prefix, 0, 5) === "%PDF-") return "application/pdf";
  if (bytesEqual(prefix, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytesEqual(prefix, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (asciiAt(prefix, 0, 4) === "RIFF" && asciiAt(prefix, 8, 4) === "WEBP") return "image/webp";
  if (asciiAt(prefix, 4, 4) === "ftyp" && HEIC_HEIF_BRANDS.has(asciiAt(prefix, 8, 4))) return "image/heic-or-heif";
  return null;
}

/**
 * Whether a claimed MIME type is at least consistent with the detected
 * family. HEIC and HEIF share the same ISO BMFF container signature and are
 * treated as one detected family for this purpose - this service does not
 * attempt to distinguish them from bytes alone.
 */
export function claimedTypeMatchesDetectedFamily(claimedMimeType: string, detected: DetectedFileFamily): boolean {
  if (detected === "image/heic-or-heif") return claimedMimeType === "image/heic" || claimedMimeType === "image/heif";
  return claimedMimeType === detected;
}
