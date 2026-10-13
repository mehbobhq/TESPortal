import { signatureMatchesDeclaredMimeType } from "@/lib/evidence-payload/validation"

/**
 * Temporary restriction for the legacy browser-to-Document-AI routes (/api/document-ai, /api/business-document-ocr).
 *
 * These routes are NOT part of the evidence payload lifecycle: they receive bytes straight from the browser and send them to
 * Document AI without quarantine or malware scanning, and they persist nothing. Until OCR is rebuilt on the cleared-evidence
 * path (the scanner promotes to intake; OCR reads only cleared, stored evidence), the routes stay available to the workflows
 * that use them, but only for authorized TES staff and only for bounded, signature-checked files.
 */
export const LEGACY_OCR_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const
export type LegacyOcrMimeType = (typeof LEGACY_OCR_MIME_TYPES)[number]

export class LegacyOcrUploadError extends Error {
  readonly status: 400 | 413
  constructor(message: string, status: 400 | 413 = 400) {
    super(message)
    this.name = "LegacyOcrUploadError"
    this.status = status
  }
}

/** Owner-controlled kill switch: set TES_LEGACY_OCR_DISABLED=true in the deployment to stop both routes without a code change. */
export function legacyOcrDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TES_LEGACY_OCR_DISABLED?.trim().toLowerCase() === "true"
}

/**
 * Resolves and verifies the file's real type. The declared MIME type must be allowed and consistent with the leading bytes;
 * an empty declared type is accepted only for a `.pdf` filename, which the PDF signature must then confirm.
 */
export function validateLegacyOcrFile(file: { name: string; type: string; size: number; prefix: Uint8Array }, maxBytes: number): LegacyOcrMimeType {
  if (file.size <= 0) throw new LegacyOcrUploadError("A non-empty PDF or image is required.")
  if (file.size > maxBytes) throw new LegacyOcrUploadError(`Maximum OCR file size is ${Math.floor(maxBytes / (1024 * 1024))} MB.`, 413)
  const declared = file.type.trim().toLowerCase() || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "")
  if (!(LEGACY_OCR_MIME_TYPES as readonly string[]).includes(declared)) throw new LegacyOcrUploadError("A supported PDF or image is required.")
  if (!signatureMatchesDeclaredMimeType(file.prefix, declared)) throw new LegacyOcrUploadError("The file content does not match its declared type.")
  return declared as LegacyOcrMimeType
}
