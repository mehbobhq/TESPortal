import type { ApplicationPlan } from "./plan"
import type { PdfInput, PdfReview } from "./pdf/render"
import type { getApplicationReview } from "./review"

type ReviewApplication = Awaited<ReturnType<typeof getApplicationReview>>["applications"][number]

/**
 * Builds the carrier dossier input from a submitted application's review record. The applicant's declaration (snapshot, consents, plan) is passed through
 * untouched; everything the carrier recorded goes into the separate `review` block. Restricted documents are listed without file details unless the reader
 * holds the sensitive-read capability, and the applicant's restricted values never enter the document (the snapshot only ever holds masked values).
 */
export function buildDossierInput(app: ReviewApplication, ctx: { plan: ApplicationPlan; planSha256: string; companyName: string; canSeeSensitive: boolean; preparedAt: string; preparedBy: string; logoPng?: Uint8Array | null }): PdfInput {
  if (app.status !== "SUBMITTED" || !app.snapshot || !app.receiptId || !app.submittedAt || !app.snapshotSha256) throw new Error("Only a submitted application with an intact snapshot has a dossier.")
  const answers = new Map(app.snapshot.fields.map((f) => [f.id, f.value]))
  const text = (id: string) => (typeof answers.get(id) === "string" ? (answers.get(id) as string) : "")
  const applicantName = [text("identity.legal_first_name"), text("identity.legal_middle_name"), text("identity.legal_last_name")].filter(Boolean).join(" ") || "Applicant"
  const latest = app.decisions[app.decisions.length - 1]
  const fieldDef = new Map(ctx.plan.fields.map((f) => [f.id, f]))
  const shown = (fieldId: string, value: unknown) => {
    const def = fieldDef.get(fieldId)
    if (!def || def.sensitivity === "RESTRICTED" || (def.pdf.mask && def.pdf.mask !== "NONE")) return "(not shown in this document)"
    return value === null || value === undefined || value === "" ? "(none)" : typeof value === "object" ? JSON.stringify(value) : String(value)
  }
  const reasonText = (reasons: unknown) => (Array.isArray(reasons) ? (reasons as unknown[]).map(String).join("; ") : reasons ? JSON.stringify(reasons) : null)
  const review: PdfReview = {
    decision: latest ? { status: latest.decision, decidedAt: latest.decidedAt, decidedBy: `Staff actor ${latest.decidedByActorId}`, rationale: reasonText(latest.reasons) } : null,
    decisions: app.decisions.map((d) => ({ status: d.decision, decidedAt: d.decidedAt, decidedBy: `Staff actor ${d.decidedByActorId}`, rationale: reasonText(d.reasons) })),
    blockers: app.blockers,
    corrections: app.corrections.map((c) => ({ fieldId: c.fieldId, label: fieldDef.get(c.fieldId)?.label ?? c.fieldId, previous: shown(c.fieldId, c.previousValue), corrected: shown(c.fieldId, c.correctedValue), reason: c.reason, recordedAt: c.recordedAt, recordedBy: `Staff actor ${c.recordedByActorId}` })),
    checks: app.requirements.map((r) => ({
      title: r.title,
      type: r.type,
      required: r.requiredForQualification,
      status: r.current?.status ?? "PENDING",
      note: r.current?.note ?? null,
      recordedAt: r.current?.recordedAt ?? null,
      recordedBy: r.current ? `Staff actor ${r.current.recordedByActorId}` : null,
      evidenceDocumentId: r.current?.evidenceDocumentId ?? null,
    })),
    evidence: app.uploads
      .filter((u) => u.current && u.fieldId !== "system.application_pdf")
      .map((u) => {
        const restricted = u.sensitivity !== "normal" && !ctx.canSeeSensitive
        const label = ctx.plan.fields.find((f) => f.id === u.fieldId)?.label ?? u.fieldId
        return { documentId: u.documentId, label, filename: restricted ? null : u.filename ?? null, byteSize: restricted ? null : u.byteSize ?? null, sha256: null, restricted, state: u.state }
      }),
    audit: [
      { at: app.submittedAt, actor: "Applicant", event: "Application submitted and signed", detail: `Receipt ${app.receiptId}` },
      ...app.requirements.flatMap((r) => r.history.map((h) => ({ at: h.recordedAt, actor: `Staff actor ${h.recordedByActorId}`, event: `${r.title}: ${h.status.replace(/_/g, " ").toLowerCase()}`, detail: h.note }))),
      ...app.corrections.map((c) => ({ at: c.recordedAt, actor: `Staff actor ${c.recordedByActorId}`, event: `Correction recorded for ${c.fieldId}`, detail: c.reason })),
      ...app.decisions.map((d) => ({ at: d.decidedAt, actor: `Staff actor ${d.decidedByActorId}`, event: `Decision: ${d.decision.replace(/_/g, " ").toLowerCase()}`, detail: null })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
    preparedAt: ctx.preparedAt,
    preparedBy: ctx.preparedBy,
  }
  return {
    audience: "carrier",
    review,
    logoPng: ctx.logoPng ?? null,
    applicationId: app.id,
    companyName: ctx.companyName,
    applicantName,
    receiptId: app.receiptId,
    submittedAt: app.submittedAt,
    plan: ctx.plan,
    planSha256: ctx.planSha256,
    snapshot: app.snapshot,
    snapshotSha256: app.snapshotSha256,
    consents: app.consents.map((c) => ({ key: c.key, version: c.version, textSha256: c.textSha256, acceptedAt: c.acceptedAt, signatureName: c.signatureName, legalStatus: c.legalStatus, jurisdiction: c.jurisdiction, purpose: c.purpose })),
  }
}
