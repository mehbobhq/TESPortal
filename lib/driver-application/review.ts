import { randomUUID } from "node:crypto"
import { hasAdditionalSystemCapability, requireAdditionalSystemCapability, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { enterSystemCapability } from "@/lib/company-directory/capability-context"
import { DriverProspectNotFoundError, DriverProspectStateError, DriverProspectValidationError } from "@/lib/driver-prospects/errors"
import { mr, uuid, type ProspectContext } from "@/lib/driver-prospects/operations"
import type { ApplicationPlan, HrSelections } from "./plan"
import { validateHrSelections } from "./plan"
import { getCatalogue, CURRENT_CATALOGUE_VERSION, STAGE_ORDER, type Stage } from "./catalogue"
import { snapshotSha256, type ApplicationSnapshot } from "./snapshot"
import { decryptSensitive } from "./sensitive"

/**
 * Employer review. The submitted application is APPLICANT-DECLARED and never changes. Everything the carrier does about it is a separate, append-only,
 * attributed record: verification outcomes per requirement, corrections/supplements, and a qualification decision. A submission never qualifies anyone.
 */

export const VERIFICATION_STATUSES = ["DECLARED", "EVIDENCE_RECEIVED", "PENDING", "VERIFIED", "EXCEPTION", "REJECTED"] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]
export const DECISIONS = ["QUALIFIED", "NOT_QUALIFIED", "NEEDS_INFORMATION"] as const
export type Decision = (typeof DECISIONS)[number]

interface AppRow {
  id: string
  status: "DRAFT" | "SUBMITTED"
  collection_stage: Stage
  receipt_id: string | null
  submitted_at: Date | null
  plan: ApplicationPlan
  plan_sha256: string
  snapshot_sha256: string | null
  supplements_application_id: string | null
  pdf_evidence_document_id: string | null
  pdf_sha256: string | null
  created_at: Date
}

async function applicationsOf(ctx: ProspectContext, organizationId: string, prospectId: string): Promise<AppRow[]> {
  const r = await ctx.client.query<AppRow>(
    `SELECT id, status, collection_stage, receipt_id, submitted_at, plan, plan_sha256, snapshot_sha256, supplements_application_id, pdf_evidence_document_id, pdf_sha256, created_at
       FROM public.driver_applications WHERE organization_id = $1 AND prospect_id = $2 ORDER BY created_at`,
    [organizationId, prospectId],
  )
  return r.rows
}

async function loadApplication(ctx: ProspectContext, organizationId: string, applicationId: string, opts: { lock?: boolean } = {}): Promise<AppRow & { prospect_id: string }> {
  const r = await ctx.client.query<AppRow & { prospect_id: string }>(
    `SELECT id, prospect_id, status, collection_stage, receipt_id, submitted_at, plan, plan_sha256, snapshot_sha256, supplements_application_id, pdf_evidence_document_id, pdf_sha256, created_at
       FROM public.driver_applications WHERE id = $1 AND organization_id = $2`,
    [applicationId, organizationId],
  )
  // The runtime role may not lock application rows (only definer functions update them); concurrent reviewers of one application are serialized with an advisory lock instead.
  if (opts.lock && r.rows[0]) await ctx.client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`driver-application-review:${applicationId}`])
  if (!r.rows[0]) throw new DriverProspectNotFoundError("Application not found.")
  return r.rows[0]
}

export interface RequirementState {
  key: string
  title: string
  type: string
  requiredForQualification: boolean
  external: boolean
  consentKey: string | null
  /** The authorization this requirement relies on, as the applicant signed it. */
  consent: { signed: boolean; legalStatus: string | null; relianceAllowed: boolean; reason: string | null } | null
  current: { status: VerificationStatus; note: string | null; evidenceDocumentId: string | null; recordedAt: string; recordedByActorId: string } | null
  history: Array<{ status: VerificationStatus; note: string | null; evidenceDocumentId: string | null; recordedAt: string; recordedByActorId: string }>
}

export async function getApplicationReview(ctx: ProspectContext, decision: SystemAuthorizationDecision, input: { organizationId: string; prospectId: string }) {
  const organizationId = uuid(input.organizationId, "organizationId")
  const prospectId = uuid(input.prospectId, "prospectId")
  const apps = await applicationsOf(ctx, organizationId, prospectId)
  const canSeeSensitive = await hasAdditionalSystemCapability(ctx.client, decision, "DRIVER_SENSITIVE_READ")
  const out = []
  for (const app of apps) {
    const base = {
      id: app.id, status: app.status, stage: app.collection_stage, receiptId: app.receipt_id, submittedAt: app.submitted_at?.toISOString() ?? null,
      planSha256: app.plan_sha256, snapshotSha256: app.snapshot_sha256, supplementsApplicationId: app.supplements_application_id,
      pdf: app.pdf_evidence_document_id ? { documentId: app.pdf_evidence_document_id, sha256: app.pdf_sha256 } : null,
    }
    if (app.status !== "SUBMITTED") {
      out.push({ ...base, snapshot: null, requirements: [], consents: [], uploads: [], decisions: [], corrections: [], sensitive: [], reviewRequirements: [], canQualify: false, blockers: ["The applicant has not submitted this application."] })
      continue
    }
    const snap = await ctx.client.query<{ payload: ApplicationSnapshot; payload_sha256: string }>(`SELECT payload, payload_sha256 FROM public.driver_application_snapshots WHERE application_id = $1`, [app.id])
    const snapshot = snap.rows[0]
    const intact = Boolean(snapshot) && snapshotSha256(snapshot.payload) === snapshot.payload_sha256
    const consents = await ctx.client.query<{ id: string; consent_key: string; consent_version: string; text_sha256: string; legal_status: string; accepted_at: Date; signature_name: string; jurisdiction: string | null; purpose: string }>(
      `SELECT id, consent_key, consent_version, text_sha256, legal_status, accepted_at, signature_name, jurisdiction, purpose FROM public.driver_application_consents WHERE application_id = $1 ORDER BY accepted_at`, [app.id])
    const revoked = await ctx.client.query<{ consent_id: string }>(`SELECT consent_id FROM public.driver_application_consent_revocations WHERE application_id = $1`, [app.id])
    const revokedIds = new Set(revoked.rows.map((x) => x.consent_id))
    const ver = await ctx.client.query<{ requirement_key: string; status: VerificationStatus; note: string | null; evidence_document_id: string | null; recorded_at: Date; recorded_by_actor_id: string }>(
      `SELECT requirement_key, status, note, evidence_document_id, recorded_at, recorded_by_actor_id FROM public.driver_application_verifications WHERE application_id = $1 ORDER BY recorded_at, id`, [app.id])
    const requirements: RequirementState[] = app.plan.requirements.map((r) => {
      const history = ver.rows.filter((v) => v.requirement_key === r.key).map((v) => ({ status: v.status, note: v.note, evidenceDocumentId: v.evidence_document_id, recordedAt: v.recorded_at.toISOString(), recordedByActorId: v.recorded_by_actor_id }))
      return { key: r.key, title: r.title, type: r.type, requiredForQualification: r.requiredForQualification, external: Boolean(r.external), consentKey: r.consentKey ?? null, consent: relianceOf(r.consentKey, consents.rows, revokedIds), current: history.length ? history[history.length - 1] : null, history }
    })
    const uploads = await ctx.client.query<{ field_id: string; slot: string; evidence_document_id: string; document_class: string; sensitivity: string; created_at: Date; superseded_at: Date | null; state: string | null; filename: string | null; byte_size: string | null }>(
      `SELECT u.field_id, u.slot, u.evidence_document_id, u.document_class, u.sensitivity, u.created_at, u.superseded_at, p.lifecycle_state AS state, p.original_filename AS filename, p.byte_size
         FROM public.driver_application_uploads u LEFT JOIN public.evidence_payloads p ON p.evidence_document_id = u.evidence_document_id WHERE u.application_id = $1 ORDER BY u.created_at`, [app.id])
    const decisions = await ctx.client.query<{ id: string; decision: Decision; reasons: unknown; snapshot_sha256: string; decided_by_actor_id: string; decided_at: Date }>(
      `SELECT id, decision, reasons, snapshot_sha256, decided_by_actor_id, decided_at FROM public.driver_application_decisions WHERE application_id = $1 ORDER BY decided_at`, [app.id])
    const corrections = await ctx.client.query<{ id: string; field_id: string; previous_value: unknown; corrected_value: unknown; reason: string; evidence_document_id: string | null; recorded_by_actor_id: string; recorded_at: Date }>(
      `SELECT id, field_id, previous_value, corrected_value, reason, evidence_document_id, recorded_by_actor_id, recorded_at FROM public.driver_application_corrections WHERE application_id = $1 ORDER BY recorded_at`, [app.id])
    let sensitive: Array<{ fieldId: string; collected: true; masked?: string }> = []
    if (canSeeSensitive) {
      await enterSystemCapability(ctx.client, "DRIVER_SENSITIVE_READ")
      const s = await ctx.client.query<{ field_id: string; masked_display: string }>(`SELECT field_id, masked_display FROM public.driver_sensitive_values WHERE application_id = $1 AND superseded_at IS NULL ORDER BY field_id`, [app.id])
      sensitive = s.rows.map((x) => ({ fieldId: x.field_id, collected: true as const, masked: x.masked_display }))
      await enterSystemCapability(ctx.client, "DRIVER_READ")
    } else {
      sensitive = (intact ? snapshot.payload.sensitive : []).filter((x) => x.collected).map((x) => ({ fieldId: x.fieldId, collected: true as const }))
    }
    const gate = qualificationGate(app.plan, requirements)
    out.push({
      ...base,
      snapshot: intact ? snapshot.payload : null,
      snapshotIntact: intact,
      requirements,
      consents: consents.rows.map((c) => ({ id: c.id, key: c.consent_key, version: c.consent_version, textSha256: c.text_sha256, legalStatus: c.legal_status, acceptedAt: c.accepted_at.toISOString(), signatureName: c.signature_name, jurisdiction: c.jurisdiction, purpose: c.purpose, revoked: revokedIds.has(c.id) })),
      uploads: uploads.rows.map((u) => ({ fieldId: u.field_id, slot: u.slot, documentId: u.evidence_document_id, documentClass: u.document_class, sensitivity: u.sensitivity, uploadedAt: u.created_at.toISOString(), current: u.superseded_at === null, state: u.state, filename: u.filename, byteSize: u.byte_size ? Number(u.byte_size) : null })),
      decisions: decisions.rows.map((d) => ({ id: d.id, decision: d.decision, reasons: d.reasons, snapshotSha256: d.snapshot_sha256, decidedByActorId: d.decided_by_actor_id, decidedAt: d.decided_at.toISOString() })),
      corrections: corrections.rows.map((c) => ({ id: c.id, fieldId: c.field_id, previousValue: c.previous_value, correctedValue: c.corrected_value, reason: c.reason, evidenceDocumentId: c.evidence_document_id, recordedByActorId: c.recorded_by_actor_id, recordedAt: c.recorded_at.toISOString() })),
      sensitive,
      reviewRequirements: app.plan.regulatoryReviewRequirements,
      canQualify: gate.blockers.length === 0,
      blockers: gate.blockers,
    })
  }
  return { applications: out, canSeeSensitive }
}

function relianceOf(consentKey: string | undefined, consents: Array<{ id: string; consent_key: string; legal_status: string }>, revoked: Set<string>): RequirementState["consent"] {
  if (!consentKey) return null
  const signed = consents.find((c) => c.consent_key === consentKey)
  if (!signed) return { signed: false, legalStatus: null, relianceAllowed: false, reason: "The applicant has not given this authorization on this application." }
  if (revoked.has(signed.id)) return { signed: true, legalStatus: signed.legal_status, relianceAllowed: false, reason: "The applicant revoked this authorization." }
  if (signed.legal_status !== "APPROVED") return { signed: true, legalStatus: signed.legal_status, relianceAllowed: false, reason: "The authorization wording is pending legal review, so it cannot be relied on yet." }
  return { signed: true, legalStatus: signed.legal_status, relianceAllowed: true, reason: null }
}

/** What stands between this application and a QUALIFIED decision. Required requirements must be VERIFIED, or carry a recorded EXCEPTION that the decision lists. */
export function qualificationGate(plan: ApplicationPlan, requirements: RequirementState[]): { blockers: string[]; exceptions: string[] } {
  const blockers: string[] = []
  const exceptions: string[] = []
  for (const r of requirements) {
    if (!r.requiredForQualification) continue
    const status = r.current?.status
    if (status === "VERIFIED") continue
    if (status === "EXCEPTION") {
      exceptions.push(r.key)
      continue
    }
    blockers.push(`${r.title}: ${status ? status.toLowerCase().replace("_", " ") : "not started"}`)
  }
  void plan
  return { blockers, exceptions }
}

export async function recordVerification(
  ctx: ProspectContext,
  input: { organizationId: string; applicationId: string; requirementKey: string; status: string; note?: string | null; evidenceDocumentId?: string | null },
) {
  const organizationId = uuid(input.organizationId, "organizationId")
  const app = await loadApplication(ctx, organizationId, uuid(input.applicationId, "applicationId"), { lock: true })
  if (app.status !== "SUBMITTED") throw new DriverProspectStateError("Only a submitted application can be reviewed.")
  const requirement = app.plan.requirements.find((r) => r.key === input.requirementKey)
  if (!requirement) throw new DriverProspectValidationError("requirementKey", "That requirement is not part of this application.")
  if (!(VERIFICATION_STATUSES as readonly string[]).includes(input.status)) throw new DriverProspectValidationError("status", "Choose a valid verification status.")
  const status = input.status as VerificationStatus
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null
  if (note && note.length > 1000) throw new DriverProspectValidationError("note", "Keep the note under 1000 characters.")
  const evidenceId = input.evidenceDocumentId ? uuid(input.evidenceDocumentId, "evidenceDocumentId") : null
  if ((status === "VERIFIED" || status === "EXCEPTION" || status === "REJECTED") && !note && !evidenceId) {
    throw new DriverProspectValidationError("note", "Record the evidence or a note explaining how this was verified. “Verified” is never recorded without support.")
  }
  if (evidenceId) {
    const ok = await ctx.client.query(`SELECT 1 FROM public.evidence_documents WHERE id = $1 AND organization_id = $2`, [evidenceId, organizationId])
    if (!ok.rowCount) throw new DriverProspectNotFoundError("That evidence document was not found for this company.")
  }
  let consentId: string | null = null
  if (requirement.consentKey) {
    const c = await ctx.client.query<{ id: string; legal_status: string }>(`SELECT id, legal_status FROM public.driver_application_consents WHERE application_id = $1 AND consent_key = $2 ORDER BY accepted_at DESC LIMIT 1`, [app.id, requirement.consentKey])
    const revoked = c.rows[0] ? await ctx.client.query(`SELECT 1 FROM public.driver_application_consent_revocations WHERE consent_id = $1`, [c.rows[0].id]) : { rowCount: 0 }
    consentId = c.rows[0]?.id ?? null
    // Reliance block: a check that depends on the applicant's authorization cannot be marked VERIFIED on an authorization that is missing, revoked or not legally approved.
    if (status === "VERIFIED") {
      if (!c.rows[0]) throw new DriverProspectStateError("This check relies on an authorization the applicant did not give. It cannot be marked verified.")
      if (revoked.rowCount) throw new DriverProspectStateError("The applicant revoked the authorization this check relies on. It cannot be marked verified.")
      if (c.rows[0].legal_status !== "APPROVED") throw new DriverProspectStateError("The authorization this check relies on is pending legal review, so the check cannot be marked verified. Record an exception with your reason if you proceed on another lawful basis.")
    }
  }
  if (requirement.external && status === "VERIFIED" && !note) throw new DriverProspectValidationError("note", "Describe the external process that was completed (for example the official query and its date).")
  const id = randomUUID()
  await ctx.client.query(
    `INSERT INTO public.driver_application_verifications (id, application_id, organization_id, requirement_key, verification_type, status, consent_id, evidence_document_id, note, recorded_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, app.id, organizationId, requirement.key, requirement.type, status, consentId, evidenceId, note, ctx.actor.id],
  )
  await mr(ctx, "RECORD_CREATED", "DRIVER_APPLICATION_VERIFICATION_RECORD", "driver_application_verifications", id, organizationId, [`driver_application:${app.id}`, `requirement:${requirement.key}`], { field: "status", value: status })
  return { verificationId: id, requirementKey: requirement.key, status }
}

export async function recordDecision(
  ctx: ProspectContext,
  input: { organizationId: string; applicationId: string; decision: string; reasons?: unknown; acknowledgeExceptions?: boolean; acknowledgeReviewRequirements?: boolean },
) {
  const organizationId = uuid(input.organizationId, "organizationId")
  const app = await loadApplication(ctx, organizationId, uuid(input.applicationId, "applicationId"), { lock: true })
  if (app.status !== "SUBMITTED" || !app.snapshot_sha256) throw new DriverProspectStateError("Only a submitted application can be decided.")
  if (!(DECISIONS as readonly string[]).includes(input.decision)) throw new DriverProspectValidationError("decision", "Choose Qualified, Not qualified or Needs information.")
  const reasons = Array.isArray(input.reasons) ? input.reasons.filter((r): r is string => typeof r === "string" && r.trim() !== "").map((r) => r.trim().slice(0, 500)).slice(0, 20) : []
  if (input.decision !== "QUALIFIED" && reasons.length === 0) throw new DriverProspectValidationError("reasons", "Give at least one reason.")
  const detail: Record<string, unknown> = { reasons }
  if (input.decision === "QUALIFIED") {
    const review = await getRequirementStates(ctx, organizationId, app)
    const gate = qualificationGate(app.plan, review)
    if (gate.blockers.length) throw new DriverProspectStateError(`This application cannot be marked qualified yet: ${gate.blockers.join("; ")}.`)
    if (gate.exceptions.length && input.acknowledgeExceptions !== true) throw new DriverProspectValidationError("acknowledgeExceptions", `Required checks are recorded as exceptions (${gate.exceptions.join(", ")}). Confirm that you accept them.`)
    if (app.plan.regulatoryReviewRequirements.length && input.acknowledgeReviewRequirements !== true) {
      throw new DriverProspectValidationError("acknowledgeReviewRequirements", "Open regulatory review items apply to this application. Confirm that you have reviewed them.")
    }
    detail.exceptions = gate.exceptions
    detail.acknowledgedReviewRequirementIds = app.plan.regulatoryReviewRequirements.map((r) => r.id)
  }
  const id = randomUUID()
  await ctx.client.query(
    `INSERT INTO public.driver_application_decisions (id, application_id, organization_id, decision, reasons, snapshot_sha256, decided_by_actor_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [id, app.id, organizationId, input.decision, JSON.stringify(detail.exceptions || detail.acknowledgedReviewRequirementIds ? [...reasons.map((text) => ({ text })), { exceptions: detail.exceptions, acknowledgedReviewRequirementIds: detail.acknowledgedReviewRequirementIds }] : reasons.map((text) => ({ text }))), app.snapshot_sha256, ctx.actor.id],
  )
  await mr(ctx, "RECORD_CREATED", "DRIVER_APPLICATION_DECISION_RECORD", "driver_application_decisions", id, organizationId, [`driver_application:${app.id}`], { field: "decision", value: input.decision })
  return { decisionId: id, decision: input.decision as Decision }
}

async function getRequirementStates(ctx: ProspectContext, organizationId: string, app: AppRow): Promise<RequirementState[]> {
  const ver = await ctx.client.query<{ requirement_key: string; status: VerificationStatus; note: string | null; evidence_document_id: string | null; recorded_at: Date; recorded_by_actor_id: string }>(
    `SELECT requirement_key, status, note, evidence_document_id, recorded_at, recorded_by_actor_id FROM public.driver_application_verifications WHERE application_id = $1 AND organization_id = $2 ORDER BY recorded_at, id`, [app.id, organizationId])
  return app.plan.requirements.map((r) => {
    const history = ver.rows.filter((v) => v.requirement_key === r.key).map((v) => ({ status: v.status, note: v.note, evidenceDocumentId: v.evidence_document_id, recordedAt: v.recorded_at.toISOString(), recordedByActorId: v.recorded_by_actor_id }))
    return { key: r.key, title: r.title, type: r.type, requiredForQualification: r.requiredForQualification, external: Boolean(r.external), consentKey: r.consentKey ?? null, consent: null, current: history.length ? history[history.length - 1] : null, history }
  })
}

/** A correction never edits the signed application. It is a separate record naming the field, the declared value, the corrected value and the reason. */
export async function recordCorrection(ctx: ProspectContext, input: { organizationId: string; applicationId: string; fieldId: string; correctedValue: unknown; reason: string; evidenceDocumentId?: string | null }) {
  const organizationId = uuid(input.organizationId, "organizationId")
  const app = await loadApplication(ctx, organizationId, uuid(input.applicationId, "applicationId"), { lock: true })
  if (app.status !== "SUBMITTED") throw new DriverProspectStateError("Only a submitted application can be corrected.")
  const field = app.plan.fields.find((f) => f.id === input.fieldId)
  if (!field || field.type === "upload" || field.type === "sensitive") throw new DriverProspectValidationError("fieldId", "That answer cannot be corrected here.")
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (!reason || reason.length > 1000) throw new DriverProspectValidationError("reason", "Explain the correction (up to 1000 characters).")
  const json = JSON.stringify(input.correctedValue ?? null)
  if (json.length > 20_000) throw new DriverProspectValidationError("correctedValue", "That value is too long.")
  const snap = await ctx.client.query<{ payload: ApplicationSnapshot }>(`SELECT payload FROM public.driver_application_snapshots WHERE application_id = $1`, [app.id])
  const previous = snap.rows[0]?.payload.fields.find((f) => f.id === field.id)?.value ?? null
  const evidenceId = input.evidenceDocumentId ? uuid(input.evidenceDocumentId, "evidenceDocumentId") : null
  if (evidenceId && !(await ctx.client.query(`SELECT 1 FROM public.evidence_documents WHERE id = $1 AND organization_id = $2`, [evidenceId, organizationId])).rowCount) {
    throw new DriverProspectNotFoundError("That evidence document was not found for this company.")
  }
  const id = randomUUID()
  await ctx.client.query(
    `INSERT INTO public.driver_application_corrections (id, application_id, organization_id, field_id, previous_value, corrected_value, reason, evidence_document_id, recorded_by_actor_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
    [id, app.id, organizationId, field.id, JSON.stringify(previous), json, reason, evidenceId, ctx.actor.id],
  )
  await mr(ctx, "RECORD_CREATED", "DRIVER_APPLICATION_CORRECTION_RECORD", "driver_application_corrections", id, organizationId, [`driver_application:${app.id}`, `field:${field.id}`], { field: field.id, value: "CORRECTED" })
  return { correctionId: id }
}

/** Reveals one sensitive identifier. Needs the dedicated capability; a stated purpose is required; every reveal is recorded in the access ledger and the Master Register. */
export async function revealSensitive(ctx: ProspectContext, decision: SystemAuthorizationDecision, input: { organizationId: string; applicationId: string; fieldId: string; purpose: string }) {
  const organizationId = uuid(input.organizationId, "organizationId")
  await requireAdditionalSystemCapability(ctx.client, decision, "DRIVER_SENSITIVE_READ")
  const purpose = typeof input.purpose === "string" ? input.purpose.trim() : ""
  if (!purpose || purpose.length > 300) throw new DriverProspectValidationError("purpose", "State why you need to see this (up to 300 characters).")
  const app = await loadApplication(ctx, organizationId, uuid(input.applicationId, "applicationId"))
  await enterSystemCapability(ctx.client, "DRIVER_SENSITIVE_READ")
  const r = await ctx.client.query<{ id: string; ciphertext: Buffer; nonce: Buffer }>(
    `SELECT id, ciphertext, nonce FROM public.driver_sensitive_values WHERE application_id = $1 AND organization_id = $2 AND field_id = $3 AND superseded_at IS NULL`,
    [app.id, organizationId, input.fieldId],
  )
  if (!r.rows[0]) throw new DriverProspectNotFoundError("That information was not collected.")
  // The access is recorded BEFORE the value is returned; if recording fails nothing is revealed.
  await ctx.client.query(`INSERT INTO public.driver_sensitive_access_events (value_id, organization_id, actor_id, purpose) VALUES ($1, $2, $3, $4)`, [r.rows[0].id, organizationId, ctx.actor.id, purpose])
  await mr(ctx, "RECORD_VIEWED", "DRIVER_SENSITIVE_REVEAL", "driver_sensitive_values", r.rows[0].id, organizationId, [`driver_application:${app.id}`, `field:${input.fieldId}`], { field: "sensitiveValue", value: "REVEALED" })
  const value = decryptSensitive(app.id, input.fieldId, r.rows[0].ciphertext, r.rows[0].nonce)
  await enterSystemCapability(ctx.client, "DRIVER_READ")
  return { value }
}

/** A document belongs to the review only if it is one of this application's uploads (or its PDF). Restricted documents also need the sensitive capability. */
export async function authorizeDocumentView(ctx: ProspectContext, decision: SystemAuthorizationDecision, input: { organizationId: string; applicationId: string; documentId: string }) {
  const organizationId = uuid(input.organizationId, "organizationId")
  const applicationId = uuid(input.applicationId, "applicationId")
  const documentId = uuid(input.documentId, "documentId")
  const r = await ctx.client.query<{ sensitivity: string }>(
    `SELECT sensitivity FROM (
        SELECT u.sensitivity FROM public.driver_application_uploads u WHERE u.application_id = $1 AND u.organization_id = $2 AND u.evidence_document_id = $3
        UNION ALL
        SELECT 'sensitive' FROM public.driver_applications a WHERE a.id = $1 AND a.organization_id = $2 AND a.pdf_evidence_document_id = $3
     ) s LIMIT 1`,
    [applicationId, organizationId, documentId],
  )
  if (!r.rows[0]) throw new DriverProspectNotFoundError("Document not found.")
  if (r.rows[0].sensitivity === "restricted") await requireAdditionalSystemCapability(ctx.client, decision, "DRIVER_SENSITIVE_READ")
  return { organizationId, documentId }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Carrier HR configuration
// ---------------------------------------------------------------------------------------------------------------------------------------

export async function getHrProfile(ctx: ProspectContext, organizationIdInput: string) {
  const organizationId = uuid(organizationIdInput, "organizationId")
  const catalogue = getCatalogue(CURRENT_CATALOGUE_VERSION)
  const r = await ctx.client.query<{ version: number; selections: HrSelections; created_at: Date }>(
    `SELECT version, selections, created_at FROM public.organization_hr_screening_profiles WHERE organization_id = $1 AND superseded_at IS NULL`, [organizationId])
  return {
    version: r.rows[0]?.version ?? 0,
    selections: r.rows[0]?.selections ?? {},
    items: catalogue.hrItems.map((i) => ({
      id: i.id, title: i.title, description: i.description,
      rules: { US: i.matrix.US, CA: i.matrix.CA } as Record<"US" | "CA", Record<Stage, string>>,
    })),
    legalNotice: "The legal matrix is a configuration aid. It has not been verified by counsel; the carrier remains responsible for what it asks.",
  }
}

export async function saveHrProfile(ctx: ProspectContext, input: { organizationId: string; selections: unknown }) {
  const organizationId = uuid(input.organizationId, "organizationId")
  if (!input.selections || typeof input.selections !== "object" || Array.isArray(input.selections)) throw new DriverProspectValidationError("selections", "Selections must be an object.")
  const selections: HrSelections = {}
  for (const [id, raw] of Object.entries(input.selections as Record<string, unknown>)) {
    const s = raw as { enabled?: unknown; acknowledgedRestriction?: unknown }
    selections[id] = { enabled: s?.enabled === true, ...(s?.acknowledgedRestriction === true ? { acknowledgedRestriction: true } : {}) }
  }
  // The profile is validated for the strictest case it could meet: every stage, both countries. An item that is prohibited anywhere it could apply is refused here
  // and, independently, is dropped again at issuance for the specific driver.
  const errors: Array<{ itemId: string; message: string }> = []
  for (const stage of ["PRE_OFFER", "CONDITIONAL_OFFER", "POST_OFFER"] as Stage[]) {
    void STAGE_ORDER
    for (const scope of [{ involvesUS: true, involvesCA: false }, { involvesUS: false, involvesCA: true }]) {
      const res = validateHrSelections(selections, scope, stage)
      for (const e of res.errors) if (!errors.some((x) => x.itemId === e.itemId && x.message.startsWith("Unknown")) && e.message.startsWith("Unknown")) errors.push(e)
    }
  }
  const unknown = errors.filter((e) => e.message.startsWith("Unknown"))
  if (unknown.length) throw new DriverProspectValidationError("selections", `Unknown screening item: ${unknown.map((e) => e.itemId).join(", ")}.`)
  // Items that are PROHIBITED at every stage in both countries can never be enabled.
  const catalogue = getCatalogue(CURRENT_CATALOGUE_VERSION)
  for (const item of catalogue.hrItems) {
    if (!selections[item.id]?.enabled) continue
    const everywhere = (["US", "CA"] as const).every((c) => (["PRE_OFFER", "CONDITIONAL_OFFER", "POST_OFFER"] as Stage[]).every((st) => item.matrix[c][st] === "PROHIBITED"))
    if (everywhere) throw new DriverProspectValidationError("selections", `${item.title} cannot be enabled.`)
  }
  const prev = await ctx.client.query<{ id: string; version: number }>(`SELECT id, version FROM public.organization_hr_screening_profiles WHERE organization_id = $1 AND superseded_at IS NULL FOR UPDATE`, [organizationId])
  if (prev.rows[0]) await ctx.client.query(`UPDATE public.organization_hr_screening_profiles SET superseded_at = clock_timestamp() WHERE id = $1`, [prev.rows[0].id])
  const id = randomUUID()
  const version = (prev.rows[0]?.version ?? 0) + 1
  await ctx.client.query(
    `INSERT INTO public.organization_hr_screening_profiles (id, organization_id, version, catalogue_version, selections, created_by_actor_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [id, organizationId, version, catalogue.version, JSON.stringify(selections), ctx.actor.id],
  )
  await mr(ctx, prev.rows[0] ? "RECORD_UPDATED" : "RECORD_CREATED", "ORGANIZATION_HR_PROFILE_SAVE", "organization_hr_screening_profiles", id, organizationId, [], { field: "hrSelections", value: `v${version}` })
  return { version }
}

