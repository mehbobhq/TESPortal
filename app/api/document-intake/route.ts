import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { uploadIntakeObject } from "@/lib/google/storage"
import type { DocumentIntakeResult, DocumentSourceFile, DocumentUploadBatch } from "@/types/document-intake"

/**
 * TES Canonical Document Intake — Phase 1.
 *
 * Server-side foundation only: receives one uploaded file, validates it
 * minimally, assigns stable server-generated ids, and stores the ORIGINAL,
 * unmodified bytes in the existing production-verified GCS intake bucket via
 * lib/google/storage.ts's uploadIntakeObject(). Returns structured metadata.
 *
 * This route does not perform OCR, entity matching, or domain-record
 * creation, and does not decide anything about document legitimacy — see
 * types/document-intake.ts for the neutral status vocabulary this
 * deliberately uses instead of REJECTED/INVALID_DOCUMENT/WRONG_DOCUMENT.
 *
 * SECURITY BOUNDARY: TES has no real authentication/authorization system yet
 * (see lib/current-user.ts). The caller-supplied companyId below is accepted
 * as-is and is NOT verified against any authenticated identity — there is no
 * such identity to check it against. This route must not be treated as
 * generally client-accessible until a real authorization gate exists in
 * front of it; today it is safe only insofar as its caller is trusted.
 */

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
])

/** Named, centralized so this can later become configuration without changing intake semantics. */
const MAX_INTAKE_FILE_BYTES = 25 * 1024 * 1024

/** Conservative identifier allow-list for companyId as used in a GCS object path. Not authorization - see the SECURITY BOUNDARY note above. */
const COMPANY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const FILENAME_FALLBACK = "uploaded-document"
const MAX_FILENAME_LENGTH = 255

function sanitizedErrorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

function loggedErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}

/**
 * Sanitizes an original filename for safe use as a GCS custom-metadata value
 * and in the intake result's returned metadata. This preserves the source
 * filename semantically (for traceability/display) - it does not preserve
 * unsafe control/path syntax byte-for-byte, and it never touches the
 * document's actual bytes.
 */
function sanitizeOriginalFilename(rawName: string): string {
  // Strip any path components a client may have submitted (both separators).
  const withoutPath = rawName.split(/[\\/]/).pop() ?? ""
  // Remove ASCII control characters (including CR/LF) and trim whitespace.
  // eslint-disable-next-line no-control-regex
  const withoutControlChars = withoutPath.replace(/[\x00-\x1F\x7F]/g, "").trim()

  if (!withoutControlChars) return FILENAME_FALLBACK
  if (withoutControlChars.length <= MAX_FILENAME_LENGTH) return withoutControlChars

  // Truncate while preserving the extension where reasonably possible.
  const lastDot = withoutControlChars.lastIndexOf(".")
  const hasReasonableExtension = lastDot > 0 && withoutControlChars.length - lastDot <= 16
  if (!hasReasonableExtension) return withoutControlChars.slice(0, MAX_FILENAME_LENGTH)

  const extension = withoutControlChars.slice(lastDot)
  const base = withoutControlChars.slice(0, lastDot)
  const truncatedBase = base.slice(0, Math.max(0, MAX_FILENAME_LENGTH - extension.length))
  return `${truncatedBase}${extension}` || FILENAME_FALLBACK
}

/**
 * Lightweight, prefix-only magic-byte checks - no full file parsing, no
 * inference of business/document identity. Confirms the declared MIME type
 * is at least consistent with the actual bytes; does not itself validate the
 * declared MIME is in SUPPORTED_MIME_TYPES (callers must check that first).
 */
function signatureMatchesDeclaredMimeType(prefix: Uint8Array, mimeType: string): boolean {
  const bytesEqual = (offset: number, expected: number[]) =>
    expected.every((byte, index) => prefix[offset + index] === byte)
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
      // ISO BMFF "ftyp" box: 4-byte box size, then "ftyp", then a 4-byte
      // major brand. Accepted conservatively against the documented
      // HEIC/HEIF-compatible brand set only - this is a container-format
      // check, not a full ISO BMFF parse.
      if (asciiAt(4, 4) !== "ftyp") return false
      const majorBrand = asciiAt(8, 4)
      const acceptedBrands = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"])
      return acceptedBrands.has(majorBrand)
    }
    default:
      return false
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file")
    const rawCompanyId = formData.get("companyId")

    if (!(file instanceof File)) {
      return sanitizedErrorResponse(400, "A file is required.")
    }
    if (typeof rawCompanyId !== "string" || !rawCompanyId.trim()) {
      return sanitizedErrorResponse(400, "A companyId is required.")
    }

    // Identifier validation only - NOT authorization. See the SECURITY
    // BOUNDARY note above: this only rejects companyId values that would be
    // structurally unsafe as a GCS object-path segment; it does not verify
    // the caller is entitled to act on this companyId.
    const companyId = rawCompanyId.trim()
    if (!COMPANY_ID_PATTERN.test(companyId)) {
      return sanitizedErrorResponse(400, "companyId is invalid.")
    }

    if (file.size === 0) {
      return sanitizedErrorResponse(400, "The uploaded file is empty.")
    }
    // Checked before any byte read/allocation, per requirement.
    if (file.size > MAX_INTAKE_FILE_BYTES) {
      return sanitizedErrorResponse(413, "The uploaded document exceeds the maximum allowed size.")
    }

    const mimeType = file.type || "application/octet-stream"
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      return sanitizedErrorResponse(400, "Unsupported file type.")
    }

    const originalFilename = sanitizeOriginalFilename(file.name)

    // Read only the minimum prefix necessary for signature checking, per the
    // Web File API's Blob.slice - this does not read the whole file.
    const signaturePrefix = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    if (!signatureMatchesDeclaredMimeType(signaturePrefix, mimeType)) {
      return sanitizedErrorResponse(400, "The uploaded file format could not be verified.")
    }

    const now = new Date().toISOString()
    const batchId = randomUUID()
    const sourceFileId = randomUUID()
    const documentId = randomUUID()
    const intakeObjectName = `intake/${companyId}/${batchId}/${sourceFileId}/source`

    const arrayBuffer = await file.arrayBuffer()

    try {
      await uploadIntakeObject(intakeObjectName, Buffer.from(arrayBuffer), {
        contentType: mimeType,
        metadata: { companyId, batchId, sourceFileId, documentId, originalFilename },
      })
    } catch (error) {
      console.error("Document intake: GCS upload failed:", loggedErrorMessage(error))
      const batch: DocumentUploadBatch = {
        batchId,
        companyId,
        createdAt: now,
        source: "api_upload",
        status: "UNABLE_TO_PROCESS",
      }
      const sourceFile: DocumentSourceFile = {
        sourceFileId,
        documentId,
        batchId,
        companyId,
        originalFilename,
        mimeType,
        byteSize: file.size,
        intakeObjectName,
        uploadedAt: now,
        processingStatus: "UNABLE_TO_PROCESS",
      }
      const result: DocumentIntakeResult = { batch, sourceFile }
      return NextResponse.json({ error: "Document intake could not be completed.", result }, { status: 502 })
    }

    const batch: DocumentUploadBatch = {
      batchId,
      companyId,
      createdAt: now,
      source: "api_upload",
      status: "STORED",
    }
    const sourceFile: DocumentSourceFile = {
      sourceFileId,
      documentId,
      batchId,
      companyId,
      originalFilename,
      mimeType,
      byteSize: file.size,
      intakeObjectName,
      uploadedAt: now,
      processingStatus: "STORED",
    }
    const result: DocumentIntakeResult = { batch, sourceFile }
    return NextResponse.json({ result })
  } catch (error) {
    // Server-side only: never surfaced to the client. See lib/google/auth.ts's
    // GoogleAuthConfigurationError and app/api/document-ai/route.ts for the
    // same fail-closed, no-detail-leak convention this route follows.
    console.error("Document intake API error:", loggedErrorMessage(error))
    return sanitizedErrorResponse(500, "Document intake could not be completed.")
  }
}
