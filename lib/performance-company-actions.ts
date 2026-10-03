/**
 * Common Performance Investigation Engine - Company Action enrichment helpers.
 *
 * CompanyActionRecord is reused (no parallel corrective-action record). This module adds only: reverse selectors,
 * validated enrichment writers, and the closure-obligation rule used by the workflow engine.
 *
 * Locked rules:
 *  - Only closureRequirement === "REQUIRED" actions can block event closure (missing = NOT_REQUIRED).
 *  - If verification.required, completion alone is not enough until verification.status === "VERIFIED".
 *  - Effectiveness review NEVER gates event closure.
 */

import type { ActionEffectiveness, ActionEffectivenessStatus, ActionVerification, ActionVerificationStatus, CompanyActionRecord, ActionClosureRequirement } from "@/types/drivers"
import type { PerformanceFoundationState } from "@/lib/performance-foundation-state"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { PerformanceFoundationError, assertEvidenceIdsExist, foundationNow, requireText } from "./performance-foundation-state.ts"

export const CLOSURE_REQUIREMENTS: readonly ActionClosureRequirement[] = ["REQUIRED", "NOT_REQUIRED"]
export const ACTION_VERIFICATION_STATUSES: readonly ActionVerificationStatus[] = ["NOT_REQUIRED", "PENDING", "VERIFIED", "FAILED"]
export const ACTION_EFFECTIVENESS_STATUSES: readonly ActionEffectivenessStatus[] = ["NOT_YET_EVALUATED", "EFFECTIVE", "PARTIALLY_EFFECTIVE", "NOT_EFFECTIVE", "CANNOT_DETERMINE"]

const actionsOf = (state: PerformanceFoundationState) => state.companyActions || []

/** Actions that point at the event directly (linkedEventIds) or through one of its investigations (investigationId). */
export function getCompanyActionsForEvent(state: PerformanceFoundationState, eventId: string): CompanyActionRecord[] {
  const investigationIds = new Set((state.performanceInvestigations || []).filter((item) => item.eventId === eventId).map((item) => item.id))
  return actionsOf(state).filter((action) => !action.isArchived && ((action.linkedEventIds || []).includes(eventId) || (action.investigationId !== undefined && investigationIds.has(action.investigationId))))
}

export function getCompanyActionsForInvestigation(state: PerformanceFoundationState, investigationId: string): CompanyActionRecord[] {
  return actionsOf(state).filter((action) => !action.isArchived && action.investigationId === investigationId)
}

export function validateActionEnrichment(patch: Partial<Pick<CompanyActionRecord, "closureRequirement" | "verification" | "effectiveness" | "completionEvidenceIds" | "actionOwner" | "assignedAt">>): string[] {
  const errors: string[] = []
  if (patch.closureRequirement !== undefined && !CLOSURE_REQUIREMENTS.includes(patch.closureRequirement)) errors.push("closureRequirement must be REQUIRED or NOT_REQUIRED.")
  if (patch.verification) {
    if (!ACTION_VERIFICATION_STATUSES.includes(patch.verification.status)) errors.push("Unknown verification status.")
    if (typeof patch.verification.required !== "boolean") errors.push("verification.required must be true or false.")
    if (patch.verification.status === "VERIFIED" && (!patch.verification.verifiedBy?.trim() || !patch.verification.verifiedAt)) errors.push("A VERIFIED action needs verifiedBy and verifiedAt.")
  }
  if (patch.effectiveness) {
    if (!ACTION_EFFECTIVENESS_STATUSES.includes(patch.effectiveness.status)) errors.push("Unknown effectiveness status.")
    if (patch.effectiveness.status !== "NOT_YET_EVALUATED" && (!patch.effectiveness.reviewedBy?.trim() || !patch.effectiveness.reviewedAt)) errors.push("An evaluated effectiveness review needs reviewedBy and reviewedAt.")
  }
  return errors
}

export type CompanyActionEnrichmentPatch = Partial<Pick<CompanyActionRecord, "actionOwner" | "actionOwnerRole" | "assignedAt" | "investigationId" | "closureRequirement" | "completionEvidenceIds">> & {
  verification?: ActionVerification
  effectiveness?: ActionEffectiveness
}

export function updateCompanyActionEnrichment<S extends PerformanceFoundationState>(state: S, actionId: string, patch: CompanyActionEnrichmentPatch, input: { at?: string } = {}): { state: S; action: CompanyActionRecord } {
  const current = actionsOf(state).find((item) => item.id === actionId)
  if (!current) throw new PerformanceFoundationError("ACTION_NOT_FOUND", `Company action ${actionId} was not found.`)
  const errors = validateActionEnrichment(patch)
  if (errors.length) throw new PerformanceFoundationError("INVALID_ACTION_ENRICHMENT", errors[0])
  if (patch.investigationId && !(state.performanceInvestigations || []).some((item) => item.id === patch.investigationId)) throw new PerformanceFoundationError("INVESTIGATION_NOT_FOUND", `Investigation ${patch.investigationId} was not found.`)
  assertEvidenceIdsExist(state, patch.completionEvidenceIds, "completionEvidenceIds")
  assertEvidenceIdsExist(state, patch.verification?.evidenceIds, "verification evidenceIds")
  assertEvidenceIdsExist(state, patch.effectiveness?.evidenceIds, "effectiveness evidenceIds")
  if (patch.actionOwner !== undefined) requireText(patch.actionOwner, "actionOwner")
  const next: CompanyActionRecord = { ...current, ...patch, updatedAt: foundationNow(input.at) }
  return { state: { ...state, companyActions: actionsOf(state).map((item) => (item.id === next.id ? next : item)) }, action: next }
}

export interface RequiredActionEvaluation {
  /** false = the action does not participate in event closure at all. */
  relevant: boolean
  resolved: boolean
  /** Why it is unresolved (when relevant && !resolved). */
  pending?: "ACTION_INCOMPLETE" | "VERIFICATION_PENDING" | "VERIFICATION_FAILED"
  resolvedAt?: string
  resolvedBy?: string
}

export function evaluateRequiredAction(action: CompanyActionRecord): RequiredActionEvaluation {
  if (action.isArchived || action.closureRequirement !== "REQUIRED" || action.status === "Rescinded") return { relevant: false, resolved: true }
  if (action.status !== "Completed") return { relevant: true, resolved: false, pending: "ACTION_INCOMPLETE" }
  if (action.verification?.required) {
    if (action.verification.status === "VERIFIED") return { relevant: true, resolved: true, resolvedAt: action.verification.verifiedAt || action.actualCompletionDate || action.updatedAt, resolvedBy: action.verification.verifiedBy || action.actionOwner }
    return { relevant: true, resolved: false, pending: action.verification.status === "FAILED" ? "VERIFICATION_FAILED" : "VERIFICATION_PENDING" }
  }
  return { relevant: true, resolved: true, resolvedAt: action.actualCompletionDate || action.updatedAt, resolvedBy: action.actionOwner }
}
