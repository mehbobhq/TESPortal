import { signatureMatchesDeclaredMimeType } from "@/lib/evidence-payload/validation"

/**
 * Interim control for the legacy browser-to-Document-AI routes (/api/document-ai, /api/business-document-ocr).
 *
 * These routes take bytes straight from the browser and send them to Document AI with no quarantine and no malware scan, and
 * they persist nothing. File-type and magic-byte checks below are input hygiene, NOT malware clearance, and holding
 * EVIDENCE_MANAGE is not a reason to skip quarantine. The production default is therefore CLOSED: both routes answer 503 and
 * never read the upload or call Google, and callers fall back to manual review/entry.
 *
 * Continued use needs an explicit, temporary, owner-set exception: TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL=YYYY-MM-DD, a date
 * that is still in the future and no more than 30 days away. It expires by itself and cannot be set open-ended. The exception
 * accepts the risk of unscanned bytes reaching Document AI for that period only; it does not make those bytes evidence.
 * TES_LEGACY_OCR_DISABLED=true closes the routes regardless. The permanent replacement is OCR of scanner-cleared, stored evidence
 * (not implemented: nothing writes `processed/`).
 */
export const LEGACY_OCR_EXCEPTION_MAX_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export type LegacyOcrAvailability = { open: true; exceptionUntil: string } | { open: false; reason: "closed_by_default" | "disabled" | "exception_invalid" | "exception_expired" | "exception_too_long" }

export function legacyOcrAvailability(env: Record<string, string | undefined> = process.env, now: number = Date.now()): LegacyOcrAvailability {
  if (env.TES_LEGACY_OCR_DISABLED?.trim().toLowerCase() === "true") return { open: false, reason: "disabled" }
  const raw = env.TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL?.trim()
  if (!raw) return { open: false, reason: "closed_by_default" }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { open: false, reason: "exception_invalid" }
  const day = Date.parse(`${raw}T00:00:00Z`)
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== raw) return { open: false, reason: "exception_invalid" }
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`)
  // The named day is the last day of the exception (UTC), counted in calendar days from today.
  if (day < today) return { open: false, reason: "exception_expired" }
  if ((day - today) / DAY_MS > LEGACY_OCR_EXCEPTION_MAX_DAYS) return { open: false, reason: "exception_too_long" }
  return { open: true, exceptionUntil: raw }
}

/** The response when the routes are closed: no detail about configuration, and a clear manual fallback for the caller. */
export const LEGACY_OCR_CLOSED_MESSAGE = "Automated OCR is unavailable because uploads must be malware-scanned first. The document is not affected: review it and enter the details manually."

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
