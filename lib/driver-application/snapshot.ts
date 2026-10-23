import { sha256Canonical } from "./canonical"
import type { ApplicationPlan } from "./plan"
import { applicableFields, type Answers } from "./validate"

export interface SnapshotInput {
  plan: ApplicationPlan
  planSha256: string
  answers: Answers
  consents: Array<{ key: string; version: string; textSha256: string; acceptedAt: string; signatureName: string }>
  presentations: Array<{ key: string; version: string; textSha256: string; presentedAt: string }>
  uploads: Array<{ fieldId: string; slot: string; documentId: string; documentClass: string; filename: string; byteSize: number; state: string }>
  sensitiveCollected: string[]
}

/**
 * The frozen, applicant-declared snapshot of a submitted application. Everything in it is "APPLICANT_DECLARED": nothing here is verified.
 * Answers to questions that did not apply are listed separately and are not current facts. Sensitive identifiers never appear (only that they were collected).
 */
export function buildSnapshot(input: SnapshotInput) {
  const { plan } = input
  const applicable = applicableFields(plan, input.answers)
  const applicableIds = new Set(applicable.map((a) => a.field.id))
  const fields = applicable
    .filter(({ field }) => field.type !== "upload" && field.type !== "sensitive")
    .map(({ field, required }) => ({
      id: field.id,
      section: field.section,
      label: field.label,
      type: field.type,
      purpose: field.purpose,
      sensitivity: field.sensitivity,
      required,
      value: input.answers[field.id] ?? null,
      status: "APPLICANT_DECLARED" as const,
    }))
  const retainedNotApplicable = plan.fields.filter((f) => f.type !== "upload" && f.type !== "sensitive" && !applicableIds.has(f.id) && input.answers[f.id] !== undefined && input.answers[f.id] !== null && input.answers[f.id] !== "").map((f) => f.id).sort()
  const sensitiveFields = applicable.filter(({ field }) => field.type === "sensitive")
  return {
    snapshotVersion: 1,
    catalogueVersion: plan.catalogueVersion,
    rulesVersion: plan.rulesVersion,
    planSha256: input.planSha256,
    collectionStage: plan.collectionStage,
    declaredBy: "APPLICANT",
    fields,
    retainedNotApplicable,
    uploads: [...input.uploads].sort((a, b) => (a.fieldId + a.slot).localeCompare(b.fieldId + b.slot)),
    sensitive: sensitiveFields.filter(({ field }) => field.collection.enabled).map(({ field }) => ({ fieldId: field.id, collected: input.sensitiveCollected.includes(field.id) })),
    sensitiveNotCollected: sensitiveFields.filter(({ field }) => !field.collection.enabled).map(({ field }) => ({ fieldId: field.id, reason: field.collection.disabledReason ?? "Collection is off." })),
    consents: [...input.consents].sort((a, b) => a.key.localeCompare(b.key)),
    presentations: [...input.presentations].sort((a, b) => (a.key + a.version).localeCompare(b.key + b.version)),
    externalProcesses: plan.consents.filter((c) => c.external).map((c) => ({ key: c.key, legalStatus: c.legalStatus })),
    regulatoryReviewRequirements: plan.regulatoryReviewRequirements,
  }
}

export type ApplicationSnapshot = ReturnType<typeof buildSnapshot>
export const snapshotSha256 = (snapshot: ApplicationSnapshot) => sha256Canonical(snapshot)
