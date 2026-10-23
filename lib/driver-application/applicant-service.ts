import "server-only"

import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { PoolClient } from "pg"
import { applicantRateCheck, ApplicantSessionError, openApplicantSession, sha256Hex, withApplicantSession, type ApplicantSession } from "@/lib/auth/tes-applicant-context"
import { MAX_PAYLOAD_BYTES } from "@/lib/evidence-payload/definitions"
import { quarantineKey } from "@/lib/evidence-payload/object-keys"
import type { EvidenceStoragePort } from "@/lib/evidence-payload/ports"
import { validateUpload } from "@/lib/evidence-payload/validation"
import { recordApplicantEvent } from "./audit"
import { sha256Canonical } from "./canonical"
import type { ApplicationPlan, PlanField } from "./plan"
import { encryptSensitive, normalizeSensitive, SensitiveValueError, vaultReady } from "./sensitive"
import { buildSnapshot, snapshotSha256, type ApplicationSnapshot } from "./snapshot"
import { renderApplicationPdf } from "./pdf/render"
import { applicableFields, normalizeName, validateAnswers, type Answers, type ValidationExtras, type ValidationResult } from "./validate"

/**
 * The applicant-facing service. Every function runs inside `withApplicantSession`: a server-side session (cookie, hash stored), CSRF for writes,
 * and the narrow SECURITY DEFINER functions of migration 0041. Nothing here trusts a company, application, scope or plan from the browser: they all
 * come from the session and the plan frozen with the invitation.
 */

export const SESSION_TTL_SECONDS = 8 * 60 * 60
const MAX_FIELD_JSON_BYTES = 100_000
const MAX_PATCH_BYTES = 400_000

export class ApplicantInputError extends Error {
  readonly status: 400 | 404 | 409 | 413 | 422 | 429
  readonly details?: unknown
  constructor(status: 400 | 404 | 409 | 413 | 422 | 429, message: string, details?: unknown) {
    super(message)
    this.name = "ApplicantInputError"
    this.status = status
    this.details = details
  }
}

type DbApplication = {
  application: { id: string; status: "DRAFT" | "SUBMITTED"; collectionStage: string; catalogueVersion: string; receiptId: string | null; submittedAt: string | null; planSha256: string; pdfDocumentId: string | null; pdfSha256: string | null }
  snapshot: { payload: ApplicationSnapshot; payloadSha256: string } | null
  plan: ApplicationPlan
  answers: Answers
  answersVersion: number
  companyName: string
  applicantGivenName: string | null
  applicantFamilyName: string | null
  applicantEmail: string
  consents: Array<{ key: string; version: string; textSha256: string; acceptedAt: string; signatureName: string; legalStatus: string; jurisdiction: string | null; purpose: string }>
  presentations: Array<{ key: string; version: string; textSha256: string; presentedAt: string }>
  uploads: Array<{ fieldId: string; slot: string; documentId: string; documentClass: string; state: string; filename: string; byteSize: number; uploadedAt: string }>
  sensitiveCollected: string[]
}

async function loadDb(client: PoolClient): Promise<DbApplication> {
  const r = await client.query<{ doc: DbApplication | null }>(`SELECT tes_security.applicant_get_application() AS doc`)
  const doc = r.rows[0]?.doc
  if (!doc) throw new ApplicantSessionError(401, "Your session has ended. Open the link from your email again.")
  return doc
}

const extrasOf = (db: DbApplication): ValidationExtras => ({
  uploads: db.uploads.map((u) => ({ fieldId: u.fieldId, slot: u.slot, state: u.state })),
  sensitiveCollected: db.sensitiveCollected,
  consents: db.consents.map((c) => ({ key: c.key, version: c.version, textSha256: c.textSha256 })),
})

function legalNameOf(db: DbApplication): string {
  const first = typeof db.answers["identity.legal_first_name"] === "string" ? (db.answers["identity.legal_first_name"] as string) : db.applicantGivenName ?? ""
  const last = typeof db.answers["identity.legal_last_name"] === "string" ? (db.answers["identity.legal_last_name"] as string) : db.applicantFamilyName ?? ""
  return `${first} ${last}`.trim()
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------------------------------------------------------------------

export type StartSessionResult =
  | { ok: true; sessionToken: string; csrfToken: string; expiresAt: string }
  | { ok: false; reason: "RATE_LIMITED" | "INVALID_LINK" }

/** Exchanges the invitation secret for a server-side session. Every failure to open looks the same (no distinction between unknown, expired, revoked, used). */
export async function startApplicantSession(input: { secret: unknown; ip: string; userAgent: string }): Promise<StartSessionResult> {
  const secret = typeof input.secret === "string" ? input.secret.trim() : ""
  if (secret.length < 20 || secret.length > 200) return { ok: false, reason: "INVALID_LINK" }
  const secretHash = sha256Hex(secret)
  const within = (await applicantRateCheck(`session-open:ip:${input.ip}`, 30, 600)) && (await applicantRateCheck(`session-open:secret:${secretHash}`, 20, 600))
  if (!within) return { ok: false, reason: "RATE_LIMITED" }
  const sessionToken = randomBytes(32).toString("base64url")
  const csrfToken = randomBytes(24).toString("base64url")
  const opened = await openApplicantSession({ secretHash, sessionHash: sha256Hex(sessionToken), csrfHash: sha256Hex(csrfToken), ttlSeconds: SESSION_TTL_SECONDS, clientHash: sha256Hex(`${input.ip}|${input.userAgent}`) })
  if (!opened) return { ok: false, reason: "INVALID_LINK" }
  // Material event, recorded as the applicant's own actor in a session-scoped transaction.
  await withApplicantSession(sessionToken, { requireCsrf: false }, async (client, session) => {
    await recordApplicantEvent(client, session, {
      eventType: "RECORD_CREATED", operation: "DRIVER_APPLICATION_SESSION_OPEN", resourceType: "driver_application_sessions", resourceId: opened.sessionId, field: "session",
      after: { kind: "REFERENCE", reference: `driver_application_sessions:${opened.sessionId}` },
    })
  })
  return { ok: true, sessionToken, csrfToken, expiresAt: opened.expiresAt }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------------------------------------------------------

export interface ApplicantView {
  application: DbApplication["application"]
  plan: ApplicationPlan
  answers: Answers
  answersVersion: number
  companyName: string
  applicantName: string
  applicantEmail: string
  consents: DbApplication["consents"]
  presentations: DbApplication["presentations"]
  uploads: DbApplication["uploads"]
  sensitiveCollected: string[]
  /** Which applicable fields are in force right now, and what is still missing for submission (advisory). */
  validation: Pick<ValidationResult, "errors" | "itemErrors" | "applicable" | "missingConsents">
}

export async function loadApplicantApplication(sessionToken: string | null): Promise<ApplicantView> {
  return withApplicantSession(sessionToken, { requireCsrf: false }, async (client) => {
    const db = await loadDb(client)
    const v = validateAnswers(db.plan, db.answers, "submit", extrasOf(db))
    return {
      application: db.application, plan: db.plan, answers: db.answers, answersVersion: db.answersVersion, companyName: db.companyName,
      applicantName: [db.applicantGivenName, db.applicantFamilyName].filter(Boolean).join(" "), applicantEmail: db.applicantEmail,
      consents: db.consents, presentations: db.presentations, uploads: db.uploads, sensitiveCollected: db.sensitiveCollected,
      validation: { errors: v.errors, itemErrors: v.itemErrors, applicable: v.applicable, missingConsents: v.missingConsents },
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------------------------------------------------------------------

const planFieldMap = (plan: ApplicationPlan) => new Map(plan.fields.map((f) => [f.id, f]))

/** A draft patch may only touch answer fields of THIS plan (never uploads or sensitive identifiers) and only JSON of sane size and shape. */
function checkPatch(plan: ApplicationPlan, patch: unknown): Answers {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ApplicantInputError(400, "The draft must be an object.")
  const fields = planFieldMap(plan)
  const clean: Answers = {}
  let total = 0
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const field = fields.get(key)
    if (!field) throw new ApplicantInputError(422, "That question is not part of this application.", { field: key })
    if (field.type === "upload" || field.type === "sensitive") throw new ApplicantInputError(422, "That information is not saved with the draft.", { field: key })
    const json = JSON.stringify(value ?? null)
    if (json.length > MAX_FIELD_JSON_BYTES) throw new ApplicantInputError(413, "That answer is too long.", { field: key })
    total += json.length
    if (total > MAX_PATCH_BYTES) throw new ApplicantInputError(413, "Too much data in one save.")
    clean[key] = value ?? null
  }
  return clean
}

export async function saveApplicantDraft(sessionToken: string | null, csrf: string | null, input: { version: unknown; patch: unknown }): Promise<{ version: number; errors: Record<string, string>; itemErrors: ValidationResult["itemErrors"] }> {
  return withApplicantSession(sessionToken, { requireCsrf: true, csrfToken: csrf }, async (client, session) => {
    if (!(await applicantRateCheck(`draft:${session.sessionId}`, 240, 60))) throw new ApplicantInputError(429, "You are saving too quickly. Wait a moment.")
    if (typeof input.version !== "number" || !Number.isInteger(input.version) || input.version < 0) throw new ApplicantInputError(400, "A draft version is required.")
    const db = await loadDb(client)
    if (db.application.status !== "DRAFT") throw new ApplicantInputError(409, "This application has been submitted and can no longer be edited.")
    const patch = checkPatch(db.plan, input.patch)
    try {
      const r = await client.query<{ v: number }>(`SELECT tes_security.applicant_save_draft($1, $2::jsonb) AS v`, [input.version, JSON.stringify(patch)])
      const merged = { ...db.answers, ...patch }
      const v = validateAnswers(db.plan, merged, "draft", extrasOf(db))
      return { version: r.rows[0].v, errors: v.errors, itemErrors: v.itemErrors }
    } catch (error) {
      if ((error as { code?: string }).code === "40001") throw new ApplicantInputError(409, "This application was changed in another window. Reload to continue.")
      throw error
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Sensitive identifiers (write-only)
// ---------------------------------------------------------------------------------------------------------------------------------------

export async function saveApplicantSensitive(sessionToken: string | null, csrf: string | null, input: { fieldId: unknown; value: unknown }): Promise<{ fieldId: string; masked: string }> {
  return withApplicantSession(sessionToken, { requireCsrf: true, csrfToken: csrf }, async (client, session) => {
    if (!(await applicantRateCheck(`sensitive:${session.sessionId}`, 20, 600))) throw new ApplicantInputError(429, "Too many attempts. Wait a few minutes.")
    const db = await loadDb(client)
    if (db.application.status !== "DRAFT") throw new ApplicantInputError(409, "This application has been submitted.")
    const field = typeof input.fieldId === "string" ? db.plan.fields.find((f) => f.id === input.fieldId && f.type === "sensitive") : undefined
    if (!field) throw new ApplicantInputError(404, "That information is not requested.")
    const applicable = applicableFields(db.plan, db.answers).some((a) => a.field.id === field.id)
    if (!applicable) throw new ApplicantInputError(404, "That information is not requested.")
    // Collection is gated: the plan froze the gate state at issuance AND the key must still be present now. Neither is bypassable from the browser.
    if (!field.collection.enabled || !vaultReady()) throw new ApplicantInputError(409, "This information is not collected yet.")
    if (typeof input.value !== "string") throw new ApplicantInputError(422, "Enter a value.")
    try {
      const { normalized, masked } = normalizeSensitive(field.id, input.value)
      const sealed = encryptSensitive(db.application.id, field.id, normalized)
      const r = await client.query<{ id: string }>(`SELECT tes_security.applicant_save_sensitive($1, $2, $3, $4, $5) AS id`, [field.id, sealed.ciphertext, sealed.nonce, sealed.keyId, masked])
      await recordApplicantEvent(client, session, {
        eventType: "RECORD_CREATED", operation: "DRIVER_APPLICATION_SENSITIVE_COLLECTED", resourceType: "driver_sensitive_values", resourceId: r.rows[0].id, field: "sensitiveValue",
        after: { kind: "REFERENCE", reference: `driver_sensitive_values:${r.rows[0].id}` },
      })
      return { fieldId: field.id, masked }
    } catch (error) {
      if (error instanceof SensitiveValueError) throw new ApplicantInputError(422, error.message)
      throw error
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Authorizations
// ---------------------------------------------------------------------------------------------------------------------------------------

export interface PresentedConsent {
  key: string
  version: string
  title: string
  purpose: string
  text: string
  textSha256: string
  legalStatus: string
  external: boolean
  standalone: boolean
  authorizedParties: string[]
  presentationId: string | null
  presentedAt: string
}

export async function presentApplicantConsent(sessionToken: string | null, csrf: string | null, key: unknown): Promise<PresentedConsent> {
  return withApplicantSession(sessionToken, { requireCsrf: true, csrfToken: csrf }, async (client, session) => {
    if (!(await applicantRateCheck(`consent:${session.sessionId}`, 120, 600))) throw new ApplicantInputError(429, "Too many requests. Wait a moment.")
    const db = await loadDb(client)
    const consent = typeof key === "string" ? db.plan.consents.find((c) => c.key === key) : undefined
    if (!consent) throw new ApplicantInputError(404, "That authorization is not part of this application.")
    let presentationId: string | null = null
    if (!consent.external) {
      const r = await client.query<{ id: string }>(`SELECT tes_security.applicant_present_consent($1, $2, $3, $4, $5) AS id`, [consent.key, consent.version, consent.text, consent.textSha256, consent.legalStatus])
      presentationId = r.rows[0].id
    }
    return {
      key: consent.key, version: consent.version, title: consent.title, purpose: consent.purpose, text: consent.text, textSha256: consent.textSha256, legalStatus: consent.legalStatus,
      external: Boolean(consent.external), standalone: Boolean(consent.standalone), authorizedParties: consent.authorizedParties, presentationId, presentedAt: new Date().toISOString(),
    }
  })
}

export async function acceptApplicantConsent(sessionToken: string | null, csrf: string | null, input: { key: unknown; signatureName: unknown; affirmed?: unknown }): Promise<{ consentId: string; acceptedAt: string }> {
  return withApplicantSession(sessionToken, { requireCsrf: true, csrfToken: csrf }, async (client, session) => {
    if (!(await applicantRateCheck(`consent:${session.sessionId}`, 120, 600))) throw new ApplicantInputError(429, "Too many requests. Wait a moment.")
    const db = await loadDb(client)
    if (db.application.status !== "DRAFT") throw new ApplicantInputError(409, "This application has been submitted.")
    const consent = typeof input.key === "string" ? db.plan.consents.find((c) => c.key === input.key) : undefined
    if (!consent) throw new ApplicantInputError(404, "That authorization is not part of this application.")
    if (consent.external) throw new ApplicantInputError(409, "This authorization is given through a separate official process, not on this page.")
    if (input.affirmed !== true) throw new ApplicantInputError(422, "Confirm that you have read and agree to this authorization.", { field: "affirmed" })
    const typed = typeof input.signatureName === "string" ? input.signatureName : ""
    if (!typed.trim() || normalizeName(typed) !== normalizeName(legalNameOf(db))) throw new ApplicantInputError(422, "Type your full legal name exactly as entered in this application to sign.", { field: "signatureName" })
    const presented = db.presentations.find((p) => p.key === consent.key && p.version === consent.version && p.textSha256 === consent.textSha256)
    if (!presented) throw new ApplicantInputError(409, "Read the authorization before signing it.")
    const pid = await client.query<{ id: string }>(`SELECT tes_security.applicant_present_consent($1, $2, $3, $4, $5) AS id`, [consent.key, consent.version, consent.text, consent.textSha256, consent.legalStatus])
    const parties = JSON.stringify(consent.authorizedParties)
    const jurisdiction = db.plan.context.involvesUS && db.plan.context.involvesCA ? "US+CA" : db.plan.context.involvesUS ? "US" : "CA"
    const r = await client.query<{ id: string }>(
      `SELECT tes_security.applicant_accept_consent($1, $2, $3, $4::jsonb, $5::jsonb, $6) AS id`,
      [pid.rows[0].id, typed.trim(), consent.purpose, JSON.stringify(consent.scope), parties, jurisdiction],
    )
    const consentId = r.rows[0].id
    const after = await loadDb(client)
    const accepted = after.consents.find((c) => c.key === consent.key && c.version === consent.version && c.textSha256 === consent.textSha256)
    if (!accepted) throw new ApplicantInputError(409, "The authorization could not be recorded.")
    await recordApplicantEvent(client, session, {
      eventType: "RECORD_CREATED", operation: "DRIVER_APPLICATION_CONSENT_ACCEPT", resourceType: "driver_application_consents", resourceId: consentId, field: "consent",
      after: { kind: "HASH", algorithm: "SHA-256", value: consent.textSha256 }, subjects: [`consent:${consent.key}@${consent.version}`],
    })
    return { consentId, acceptedAt: accepted.acceptedAt }
  })
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Documents (existing evidence pipeline: quarantine -> scanner -> evidence)
// ---------------------------------------------------------------------------------------------------------------------------------------

async function defaultPort(): Promise<EvidenceStoragePort> {
  const { createGcsEvidenceStoragePort } = await import("@/lib/evidence-payload/gcs-adapter")
  return createGcsEvidenceStoragePort()
}

export async function uploadApplicantDocument(
  sessionToken: string | null,
  csrf: string | null,
  input: { fieldId: unknown; slot?: unknown; bytes: Uint8Array; mimeType: unknown; filename: unknown },
  port?: EvidenceStoragePort,
): Promise<{ documentId: string; state: "quarantined" }> {
  if (input.bytes.byteLength > MAX_PAYLOAD_BYTES) throw new ApplicantInputError(413, "That file is too large.")
  return withApplicantSession(sessionToken, { requireCsrf: true, csrfToken: csrf }, async (client, session) => {
    if (!(await applicantRateCheck(`upload:${session.sessionId}`, 40, 600))) throw new ApplicantInputError(429, "Too many uploads. Wait a few minutes.")
    const db = await loadDb(client)
    if (db.application.status !== "DRAFT") throw new ApplicantInputError(409, "This application has been submitted.")
    const field = typeof input.fieldId === "string" ? db.plan.fields.find((f) => f.id === input.fieldId && f.type === "upload") : undefined
    if (!field || !field.evidence || !applicableFields(db.plan, db.answers).some((a) => a.field.id === field.id)) throw new ApplicantInputError(404, "That document is not requested.")
    const slot = typeof input.slot === "string" && /^[a-z0-9_-]{0,40}$/.test(input.slot) ? input.slot : ""
    const evidence = field.evidence
    const documentType = `DRIVER_APPLICATION_${evidence.documentClass}`
    let validated
    try {
      validated = validateUpload({ documentType, documentTitle: `${field.label}`.slice(0, 200), mimeType: input.mimeType, originalFilename: input.filename, bytes: input.bytes })
    } catch (error) {
      throw new ApplicantInputError(422, error instanceof Error ? error.message : "That file cannot be accepted.")
    }
    if (!evidence.accept.includes(validated.mimeType)) throw new ApplicantInputError(422, "That file type is not accepted for this document.")

    const storage = port ?? (await defaultPort())
    const ids = { documentId: randomUUID(), batchId: randomUUID(), sourceFileId: randomUUID() }
    const objectName = quarantineKey({ organizationId: session.organizationId, batchId: ids.batchId, sourceFileId: ids.sourceFileId })
    // Create-only write to quarantine, BEFORE the database learns about it: a crash leaves an unreferenced quarantine object (reported by the audit, never served).
    const put = await storage.putQuarantine(objectName, Buffer.from(input.bytes), {
      contentType: validated.mimeType,
      metadata: { companyId: session.organizationId, batchId: ids.batchId, sourceFileId: ids.sourceFileId, documentId: ids.documentId, originalFilename: validated.originalFilename },
    })
    await client.query(
      `SELECT tes_security.applicant_register_upload($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'client_upload')`,
      [field.id, slot, evidence.documentClass, evidence.sensitivity, documentType, validated.documentTitle, ids.documentId, ids.batchId, ids.sourceFileId, storage.bucketNames().quarantine, objectName, put.generation, validated.sha256, validated.mimeType, validated.byteSize, validated.originalFilename],
    )
    await recordApplicantEvent(client, session, {
      eventType: "RECORD_CREATED", operation: "DRIVER_APPLICATION_UPLOAD", resourceType: "evidence_document", resourceId: ids.documentId, field: "upload",
      after: { kind: "HASH", algorithm: "SHA-256", value: validated.sha256 }, subjects: [`evidence_document:${ids.documentId}`],
    })
    return { documentId: ids.documentId, state: "quarantined" as const }
  })
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------------------------------------------------------------------

export type SubmitResult =
  | { ok: true; receiptId: string; submittedAt: string; alreadySubmitted: boolean; snapshotSha256: string | null; applicationId: string }
  | { ok: false; errors: Record<string, string>; itemErrors: ValidationResult["itemErrors"]; missingConsents: string[] }

/** Validates the whole application on the server and submits it. The receipt id and timestamp are generated by the database; a repeat call returns the original. */
export async function submitApplicantApplication(sessionToken: string | null, csrf: string | null): Promise<SubmitResult> {
  return withApplicantSession(sessionToken, { requireCsrf: true, csrfToken: csrf }, async (client, session) => {
    if (!(await applicantRateCheck(`submit:${session.sessionId}`, 10, 600))) throw new ApplicantInputError(429, "Too many attempts. Wait a few minutes.")
    const db = await loadDb(client)
    if (db.application.status === "SUBMITTED") {
      return { ok: true as const, receiptId: db.application.receiptId!, submittedAt: db.application.submittedAt!, alreadySubmitted: true, snapshotSha256: null, applicationId: db.application.id }
    }
    const v = validateAnswers(db.plan, db.answers, "submit", extrasOf(db))
    // Uploads must not be blocked, and every applicable required upload must exist (validated above); a blocked file does not count.
    if (!v.ok) return { ok: false as const, errors: v.errors, itemErrors: v.itemErrors, missingConsents: v.missingConsents }
    const snapshot = buildSnapshot({ plan: db.plan, planSha256: db.application.planSha256, answers: db.answers, consents: db.consents, presentations: db.presentations, uploads: db.uploads, sensitiveCollected: db.sensitiveCollected })
    const hash = snapshotSha256(snapshot)
    try {
      const r = await client.query<{ receipt_id: string; submitted_at: Date; already_submitted: boolean }>(`SELECT * FROM tes_security.applicant_finalize($1::jsonb, $2, $3)`, [JSON.stringify(snapshot), hash, db.answersVersion])
      const row = r.rows[0]
      if (!row.already_submitted) {
        await recordApplicantEvent(client, session, {
          eventType: "RECORD_UPDATED", operation: "DRIVER_APPLICATION_SUBMIT", resourceType: "driver_applications", resourceId: db.application.id, field: "status",
          after: { kind: "LITERAL", value: "SUBMITTED" }, subjects: [`receipt:${row.receipt_id}`, `snapshot:${hash}`],
        })
      }
      return { ok: true as const, receiptId: row.receipt_id, submittedAt: row.submitted_at.toISOString(), alreadySubmitted: row.already_submitted, snapshotSha256: hash, applicationId: db.application.id }
    } catch (error) {
      if ((error as { code?: string }).code === "40001") throw new ApplicantInputError(409, "This application was changed in another window. Reload and submit again.")
      throw error
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Signed PDF
// ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * Generates the deterministic PDF of a SUBMITTED application from its stored snapshot and stores it as controlled evidence (quarantine -> scanner -> intake ->
 * evidence, like every other document). It is attached to the application once; calling again returns the attached document. Failure never undoes the
 * submission: the receipt is already issued and the PDF is produced on the next call.
 */
export async function ensureApplicationPdf(sessionToken: string | null, port?: EvidenceStoragePort): Promise<{ documentId: string; sha256: string; created: boolean } | null> {
  return withApplicantSession(sessionToken, { requireCsrf: false }, async (client, session) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`driver-application-pdf:${session.applicationId}`])
    const db = await loadDb(client)
    if (db.application.status !== "SUBMITTED" || !db.snapshot) return null
    if (db.application.pdfDocumentId && db.application.pdfSha256) return { documentId: db.application.pdfDocumentId, sha256: db.application.pdfSha256, created: false }
    if (snapshotSha256(db.snapshot.payload) !== db.snapshot.payloadSha256) throw new Error("The stored application snapshot does not match its hash; the PDF was not generated.")
    const logoPng = await readFile(join(process.cwd(), "public", "branding", "TES-Logo.png")).then((b) => new Uint8Array(b)).catch(() => null)
    const bytes = await renderApplicationPdf({
      logoPng,
      companyName: db.companyName,
      applicantName: [db.applicantGivenName, db.applicantFamilyName].filter(Boolean).join(" ") || legalNameOf(db),
      receiptId: db.application.receiptId!,
      submittedAt: new Date(db.application.submittedAt!).toISOString(),
      plan: db.plan, planSha256: db.application.planSha256, snapshot: db.snapshot.payload, snapshotSha256: db.snapshot.payloadSha256, consents: db.consents,
    })
    const validated = validateUpload({ documentType: "DRIVER_APPLICATION_PDF", documentTitle: `Signed driver application ${db.application.receiptId}`, mimeType: "application/pdf", originalFilename: `driver-application-${db.application.receiptId}.pdf`, bytes })
    const storage = port ?? (await defaultPort())
    const ids = { documentId: randomUUID(), batchId: randomUUID(), sourceFileId: randomUUID() }
    const objectName = quarantineKey({ organizationId: session.organizationId, batchId: ids.batchId, sourceFileId: ids.sourceFileId })
    const put = await storage.putQuarantine(objectName, Buffer.from(bytes), {
      contentType: "application/pdf",
      metadata: { companyId: session.organizationId, batchId: ids.batchId, sourceFileId: ids.sourceFileId, documentId: ids.documentId, originalFilename: validated.originalFilename },
    })
    await client.query(
      `SELECT tes_security.applicant_register_upload($1, '', 'PDF', 'sensitive', 'DRIVER_APPLICATION_PDF', $2, $3, $4, $5, $6, $7, $8, $9, 'application/pdf', $10, $11, 'system_generated')`,
      ["system.application_pdf", validated.documentTitle, ids.documentId, ids.batchId, ids.sourceFileId, storage.bucketNames().quarantine, objectName, put.generation, validated.sha256, validated.byteSize, validated.originalFilename],
    )
    await client.query(`SELECT tes_security.applicant_attach_pdf($1, $2)`, [ids.documentId, validated.sha256])
    await recordApplicantEvent(client, session, {
      eventType: "RECORD_CREATED", operation: "DRIVER_APPLICATION_PDF_GENERATED", resourceType: "evidence_document", resourceId: ids.documentId, field: "pdf",
      after: { kind: "HASH", algorithm: "SHA-256", value: validated.sha256 }, subjects: [`evidence_document:${ids.documentId}`, `snapshot:${db.snapshot.payloadSha256}`],
    })
    return { documentId: ids.documentId, sha256: validated.sha256, created: true }
  })
}

export const snapshotDigest = (value: unknown) => sha256Canonical(value)
export type { ApplicantSession, PlanField }
