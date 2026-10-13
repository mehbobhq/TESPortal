/**
 * Evidence payload validation: pure functions over bytes and strings. No I/O.
 *
 * These checks are a first line only. The authoritative security decision is the isolated document-security-scanner;
 * nothing here judges a document's legitimacy.
 */

import { createHash } from "node:crypto"
import {
  DOCUMENT_TYPE_PATTERN,
  FILENAME_FALLBACK,
  MAX_FILENAME_LENGTH,
  MAX_PAYLOAD_BYTES,
  TITLE_MAX_LENGTH,
  isAllowedMimeType,
  type AllowedMimeType,
} from "@/lib/evidence-payload/definitions"

export class PayloadValidationError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = "PayloadValidationError"
    this.field = field
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** Strips path components and control characters; the result is metadata for display only, never part of an object key. */
export function sanitizeOriginalFilename(rawName: string): string {
  const withoutPath = rawName.split(/[\\/]/).pop() ?? ""
  // eslint-disable-next-line no-control-regex
  const withoutControlChars = withoutPath.replace(/[\x00-\x1F\x7F]/g, "").trim()
  if (!withoutControlChars) return FILENAME_FALLBACK
  if (withoutControlChars.length <= MAX_FILENAME_LENGTH) return withoutControlChars
  const lastDot = withoutControlChars.lastIndexOf(".")
  const hasReasonableExtension = lastDot > 0 && withoutControlChars.length - lastDot <= 16
  if (!hasReasonableExtension) return withoutControlChars.slice(0, MAX_FILENAME_LENGTH)
  const extension = withoutControlChars.slice(lastDot)
  const base = withoutControlChars.slice(0, lastDot)
  return `${base.slice(0, Math.max(0, MAX_FILENAME_LENGTH - extension.length))}${extension}` || FILENAME_FALLBACK
}

/** Prefix-only magic-byte check: the declared MIME type must be consistent with the actual bytes. */
export function signatureMatchesDeclaredMimeType(prefix: Uint8Array, mimeType: string): boolean {
  const bytesEqual = (offset: number, expected: number[]) => expected.every((byte, index) => prefix[offset + index] === byte)
  const asciiAt = (offset: number, length: number) =>
    Array.from(prefix.slice(offset, offset + length))
      .map((byte) => String.fromCharCode(byte))
      .join("")

  switch (mimeType) {
    case "application/pdf":
      return asciiAt(0, 5) === "%PDF-"
    case "image/jpeg":
      return bytesEqual(0, [0xff, 0xd8, 0xff])
    case "image/png":
      return bytesEqual(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case "image/webp":
      return asciiAt(0, 4) === "RIFF" && asciiAt(8, 4) === "WEBP"
    case "image/heic":
    case "image/heif": {
      if (asciiAt(4, 4) !== "ftyp") return false
      return new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]).has(asciiAt(8, 4))
    }
    default:
      return false
  }
}

export type ValidatedUpload = {
  documentType: string
  documentTitle: string
  mimeType: AllowedMimeType
  originalFilename: string
  byteSize: number
  sha256: string
}

export function validateUpload(input: { documentType: unknown; documentTitle: unknown; mimeType: unknown; originalFilename: unknown; bytes: Uint8Array }): ValidatedUpload {
  if (typeof input.documentType !== "string" || !DOCUMENT_TYPE_PATTERN.test(input.documentType)) {
    throw new PayloadValidationError("documentType", "Document type must be UPPER_SNAKE_CASE.")
  }
  if (typeof input.documentTitle !== "string") throw new PayloadValidationError("documentTitle", "A document title is required.")
  const title = input.documentTitle.trim()
  // eslint-disable-next-line no-control-regex
  if (title.length === 0 || title.length > TITLE_MAX_LENGTH || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(title)) {
    throw new PayloadValidationError("documentTitle", `The document title must be 1-${TITLE_MAX_LENGTH} printable characters.`)
  }
  if (input.bytes.byteLength === 0) throw new PayloadValidationError("file", "The uploaded file is empty.")
  if (input.bytes.byteLength > MAX_PAYLOAD_BYTES) throw new PayloadValidationError("file", "The uploaded document exceeds the maximum allowed size.")
  if (!isAllowedMimeType(input.mimeType)) throw new PayloadValidationError("file", "Unsupported file type.")
  if (!signatureMatchesDeclaredMimeType(input.bytes.slice(0, 16), input.mimeType)) {
    throw new PayloadValidationError("file", "The uploaded file format could not be verified.")
  }
  return {
    documentType: input.documentType,
    documentTitle: title,
    mimeType: input.mimeType,
    originalFilename: sanitizeOriginalFilename(typeof input.originalFilename === "string" ? input.originalFilename : ""),
    byteSize: input.bytes.byteLength,
    sha256: sha256Hex(input.bytes),
  }
}
