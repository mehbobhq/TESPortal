/**
 * Common Performance Investigation Engine - generic workflow derivation with explanatory reasons.
 *
 * Answers two questions, from real underlying obligations (never from an arbitrary stored badge):
 *   1. what is the workflow state?   2. WHY?
 *
 * Derived states: NOT_REQUIRED, OPEN, IN_REVIEW, READY_TO_CLOSE, CLOSED.
 * READY_TO_CLOSE never becomes CLOSED automatically: only closePerformanceEventWorkflow records a deliberate closure.
 *
 * COMPATIBILITY DECISION: the stored PerformanceEventRecord.workflowState enum (NOT_REQUIRED | OPEN | IN_REVIEW | COMPLETED)
 * is deliberately NOT widened or written by this engine. Existing records and Roadside keep writing it exactly as before. The
 * new states live only in this derived result; the only persisted workflow artefact is the append-only
 * PerformanceEventRecord.workflowClosures array, which load-time migration preserves (events are spread, not remapped).
 *
 * Roadside, Collision and Near Miss are NOT wired in here. A category adopts the engine by registering a provider.
 */

import type { PerformanceWorkflowClosure } from "@/types/drivers"
import type { FoundationEvent, PerformanceFoundationState } from "@/lib/performance-foundation-state"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { PerformanceFoundationError, foundationId, foundationNow, requireText } from "./performance-foundation-state.ts"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { getInvestigationsForEvent } from "./performance-investigation.ts"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { evaluateRequiredAction, getCompanyActionsForEvent } from "./performance-company-actions.ts"

export type PerformanceDerivedWorkflowState = "NOT_REQUIRED" | "OPEN" | "IN_REVIEW" | "READY_TO_CLOSE" | "CLOSED"

export type WorkflowReasonCode =
  | "UNSAFE_CONDITION_REMAINS"
  | "INVESTIGATION_INCOMPLETE"
  | "ADDITIONAL_INVESTIGATION_REQUIRED"
  | "DRIVER_STATEMENT_REQUIRED"
  | "REQUIRED_EVIDENCE_MISSING"
  | "CORRECTIVE_ACTION_OUTSTANDING"
  | "REQUIRED_REVIEW_OUTSTANDING"
  | "FOLLOW_UP_OUTSTANDING"
  | "FINAL_CLOSURE_REVIEW"
  | "REGULATORY_ASSESSMENT_REQUIRED"
  | "REGULATORY_NOTIFICATION_INCOMPLETE"
  | "REGULATORY_REPORT_INCOMPLETE"
  | "CLEANUP_VERIFICATION_PENDING"
  | "COMPLAINT_ASSESSMENT_PENDING"
  | "CUSTOMER_RESPONSE_PENDING"
  | "SITE_REVIEW_REQUIRED"
  | "RECOGNITION_REVIEW_PENDING"

/** OBLIGATION = work remains. REVIEW = waiting / review-type condition. CLOSURE = the final deliberate review. */
export type WorkflowReasonKind = "OBLIGATION" | "REVIEW" | "CLOSURE"

/** One catalogue for every family. Priority: lower number = listed first. */
export const WORKFLOW_REASON_CATALOGUE: Readonly<Record<WorkflowReasonCode, { label: string; resolvedLabel: string; priority: number }>> = {
  UNSAFE_CONDITION_REMAINS: { label: "Unsafe condition remains", resolvedLabel: "Unsafe condition resolved", priority: 10 },
  INVESTIGATION_INCOMPLETE: { label: "Investigation incomplete", resolvedLabel: "Investigation completed", priority: 20 },
  ADDITIONAL_INVESTIGATION_REQUIRED: { label: "Additional investigation required", resolvedLabel: "Additional investigation completed", priority: 25 },
  DRIVER_STATEMENT_REQUIRED: { label: "Driver statement required", resolvedLabel: "Driver statement received", priority: 30 },
  REQUIRED_EVIDENCE_MISSING: { label: "Required evidence missing", resolvedLabel: "Required evidence provided", priority: 40 },
  CORRECTIVE_ACTION_OUTSTANDING: { label: "Corrective action outstanding", resolvedLabel: "Required corrective action completed", priority: 50 },
  REQUIRED_REVIEW_OUTSTANDING: { label: "Required review outstanding", resolvedLabel: "Required review completed", priority: 60 },
  FOLLOW_UP_OUTSTANDING: { label: "Follow-up action outstanding", resolvedLabel: "Follow-up action completed", priority: 70 },
  FINAL_CLOSURE_REVIEW: { label: "Final closure review pending", resolvedLabel: "Final closure review completed", priority: 90 },
  REGULATORY_ASSESSMENT_REQUIRED: { label: "Regulatory assessment required", resolvedLabel: "Regulatory assessment completed", priority: 32 },
  REGULATORY_NOTIFICATION_INCOMPLETE: { label: "Regulatory notification incomplete", resolvedLabel: "Regulatory notification completed", priority: 34 },
  REGULATORY_REPORT_INCOMPLETE: { label: "Regulatory report incomplete", resolvedLabel: "Regulatory report completed", priority: 36 },
  CLEANUP_VERIFICATION_PENDING: { label: "Cleanup verification pending", resolvedLabel: "Cleanup verification completed", priority: 45 },
  COMPLAINT_ASSESSMENT_PENDING: { label: "Complaint assessment pending", resolvedLabel: "Complaint assessment completed", priority: 31 },
  CUSTOMER_RESPONSE_PENDING: { label: "Customer response pending", resolvedLabel: "Customer response provided", priority: 33 },
  SITE_REVIEW_REQUIRED: { label: "Site review required", resolvedLabel: "Site review completed", priority: 37 },
  RECOGNITION_REVIEW_PENDING: { label: "Recognition review pending", resolvedLabel: "Recognition review completed", priority: 38 },
}

export interface WorkflowReason {
  code: WorkflowReasonCode
  /** Open label while unresolved, resolved label once resolved. */
  label: string
  source: { type: string; id: string }
  priority: number
  kind: WorkflowReasonKind
  /** Optional per-source context (e.g. an action title). */
  detail?: string
  /** When the obligation came into existence (used to detect obligations created after a closure). */
  createdAt?: string
  resolvedAt?: string
  resolvedBy?: string
}

export interface WorkflowObligation extends WorkflowReason {
  resolved: boolean
}

export interface WorkflowProvider {
  id: string
  collect(event: FoundationEvent, state: PerformanceFoundationState): WorkflowObligation[]
}

export function makeObligation(code: WorkflowReasonCode, source: { type: string; id: string }, resolved: boolean, extra: Partial<Pick<WorkflowObligation, "kind" | "detail" | "createdAt" | "resolvedAt" | "resolvedBy">> = {}): WorkflowObligation {
  const entry = WORKFLOW_REASON_CATALOGUE[code]
  return { code, label: resolved ? entry.resolvedLabel : entry.label, source, priority: entry.priority, kind: extra.kind || "OBLIGATION", detail: extra.detail, createdAt: extra.createdAt, resolvedAt: resolved ? extra.resolvedAt : undefined, resolvedBy: resolved ? extra.resolvedBy : undefined, resolved }
}

// ---------------------------------------------------------------------------
// Built-in providers (generic - none is Near-Miss-specific)
// ---------------------------------------------------------------------------

export const investigationProvider: WorkflowProvider = {
  id: "investigation",
  collect(event, state) {
    const out: WorkflowObligation[] = []
    const investigations = getInvestigationsForEvent(state, event.id)
    const requirement = event.investigationRequirement
    if (requirement?.required) {
      const completed = investigations.filter((item) => item.status === "COMPLETED").pop()
      const inProgress = investigations.filter((item) => item.status === "OPEN" || item.status === "AWAITING_INFORMATION").pop()
      if (completed) out.push(makeObligation("INVESTIGATION_INCOMPLETE", { type: "Investigation", id: completed.id }, true, { createdAt: requirement.setAt, resolvedAt: completed.completedAt, resolvedBy: completed.completedBy }))
      else if (inProgress) out.push(makeObligation("INVESTIGATION_INCOMPLETE", { type: "Investigation", id: inProgress.id }, false, { kind: inProgress.status === "AWAITING_INFORMATION" ? "REVIEW" : "OBLIGATION", createdAt: requirement.setAt }))
      // Required but never started, or only cancelled: the requirement is still unmet (release it with an explicit requirement change).
      else out.push(makeObligation("INVESTIGATION_INCOMPLETE", { type: "Event", id: event.id }, false, { createdAt: requirement.setAt, detail: "Investigation required - not started" }))
    }
    // No investigation record, or one that is merely open while NOT required, never counts as "incomplete" by itself.
    for (const investigation of investigations) {
      if (investigation.status !== "CANCELLED" && investigation.additionalInvestigationRequired?.required) {
        out.push(makeObligation("ADDITIONAL_INVESTIGATION_REQUIRED", { type: "Investigation", id: investigation.id }, false, { createdAt: investigation.updatedAt, detail: investigation.additionalInvestigationRequired.reason }))
      }
    }
    return out
  },
}

export const companyActionProvider: WorkflowProvider = {
  id: "company-actions",
  collect(event, state) {
    const out: WorkflowObligation[] = []
    for (const action of getCompanyActionsForEvent(state, event.id)) {
      const evaluation = evaluateRequiredAction(action)
      if (!evaluation.relevant) continue
      const source = { type: "CompanyAction", id: action.id }
      const base = { createdAt: action.createdAt, detail: action.title }
      if (evaluation.resolved) out.push(makeObligation("CORRECTIVE_ACTION_OUTSTANDING", source, true, { ...base, resolvedAt: evaluation.resolvedAt, resolvedBy: evaluation.resolvedBy }))
      else if (evaluation.pending === "VERIFICATION_PENDING") out.push(makeObligation("REQUIRED_REVIEW_OUTSTANDING", source, false, { ...base, kind: "REVIEW", detail: `${action.title || "Action"} - verification pending` }))
      else out.push(makeObligation("CORRECTIVE_ACTION_OUTSTANDING", source, false, { ...base, detail: evaluation.pending === "VERIFICATION_FAILED" ? `${action.title || "Action"} - verification failed` : action.title }))
    }
    return out
  },
}

/** The existing generic follow-up flag on the event. */
export const followUpProvider: WorkflowProvider = {
  id: "follow-up",
  collect(event) {
    return event.followUpActionRequired ? [makeObligation("FOLLOW_UP_OUTSTANDING", { type: "Event", id: event.id }, false, { createdAt: event.createdAt, detail: event.followUpActionSummary })] : []
  },
}

export const DEFAULT_WORKFLOW_PROVIDERS: readonly WorkflowProvider[] = [investigationProvider, companyActionProvider, followUpProvider]

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export interface DerivedWorkflow {
  state: PerformanceDerivedWorkflowState
  /** The explanation for the CURRENT state, ordered. OPEN/IN_REVIEW: the open reasons. READY_TO_CLOSE / CLOSED: resolved reasons + the closure-review reason. */
  reasons: WorkflowReason[]
  openReasons: WorkflowReason[]
  resolvedReasons: WorkflowReason[]
  /** Latest deliberate closure on record (kept even when no longer in force). */
  closure?: PerformanceWorkflowClosure
  /** A closure exists but is no longer in force (a later obligation appeared). The closure record itself is never erased. */
  closureSuperseded: boolean
  /** Obligations created AFTER the latest closure (the surfaced "new obligation" signal). */
  obligationsSinceClosure: WorkflowReason[]
}

const strip = ({ resolved: _resolved, ...reason }: WorkflowObligation): WorkflowReason => reason

const byOrder = (a: WorkflowReason, b: WorkflowReason) => a.priority - b.priority || (a.createdAt || "").localeCompare(b.createdAt || "") || a.source.type.localeCompare(b.source.type) || a.source.id.localeCompare(b.source.id)

export function latestWorkflowClosure(event: FoundationEvent): PerformanceWorkflowClosure | undefined {
  const closures = event.workflowClosures || []
  return closures.length ? [...closures].sort((a, b) => a.closedAt.localeCompare(b.closedAt) || a.id.localeCompare(b.id)).pop() : undefined
}

/**
 * Pure and deterministic: the same inputs always produce the same state and the same reason order.
 *
 * Post-closure rule (documented decision): a closure stays on record forever. It is "in force" only while no obligation was
 * created after it. If a new obligation appears later the state moves to OPEN/IN_REVIEW (closureSuperseded = true,
 * obligationsSinceClosure lists the new ones). When those are resolved the state is READY_TO_CLOSE again - a NEW deliberate
 * closure is required; the old closure is never silently reused or erased.
 */
export function deriveWorkflow(event: FoundationEvent, state: PerformanceFoundationState, providers: readonly WorkflowProvider[] = DEFAULT_WORKFLOW_PROVIDERS): DerivedWorkflow {
  const obligations = providers.flatMap((provider) => provider.collect(event, state))
  const open = obligations.filter((item) => !item.resolved).map(strip).sort(byOrder)
  const resolved = obligations.filter((item) => item.resolved).map(strip).sort(byOrder)
  const closure = latestWorkflowClosure(event)
  const since = closure ? obligations.filter((item) => item.createdAt && item.createdAt > closure.closedAt).map(strip).sort(byOrder) : []
  const base = { openReasons: open, resolvedReasons: resolved, closure, obligationsSinceClosure: since }

  if (!obligations.length && !closure) return { ...base, state: "NOT_REQUIRED", reasons: [], closureSuperseded: false }
  if (open.length) {
    return { ...base, state: open.every((item) => item.kind === "REVIEW") ? "IN_REVIEW" : "OPEN", reasons: open, closureSuperseded: Boolean(closure) }
  }
  const closureInForce = Boolean(closure) && since.length === 0
  const entry = WORKFLOW_REASON_CATALOGUE.FINAL_CLOSURE_REVIEW
  if (closureInForce && closure) {
    const finalReview: WorkflowReason = { code: "FINAL_CLOSURE_REVIEW", label: entry.resolvedLabel, source: { type: "Event", id: event.id }, priority: entry.priority, kind: "CLOSURE", detail: closure.note, createdAt: closure.closedAt, resolvedAt: closure.closedAt, resolvedBy: closure.closedBy }
    return { ...base, state: "CLOSED", reasons: [...resolved, finalReview], closureSuperseded: false }
  }
  const pendingReview: WorkflowReason = { code: "FINAL_CLOSURE_REVIEW", label: entry.label, source: { type: "Event", id: event.id }, priority: entry.priority, kind: "CLOSURE" }
  return { ...base, state: "READY_TO_CLOSE", reasons: [...resolved, pendingReview], closureSuperseded: Boolean(closure) }
}

/** Plain-text explanation lines for later presentation (no UI in this slice). */
export function explainWorkflow(derived: DerivedWorkflow): string[] {
  return derived.reasons.map((reason) => {
    const who = reason.resolvedBy ? ` by ${reason.resolvedBy}` : ""
    const when = reason.resolvedAt ? ` on ${reason.resolvedAt.slice(0, 10)}` : ""
    const detail = reason.detail ? ` (${reason.detail})` : ""
    return reason.code === "FINAL_CLOSURE_REVIEW" && reason.resolvedAt ? `${reason.label}${who}${when}` : `${reason.label}${detail}`
  })
}

// ---------------------------------------------------------------------------
// Writers: explicit requirement + deliberate closure
// ---------------------------------------------------------------------------

function replaceEvent<S extends PerformanceFoundationState>(state: S, next: FoundationEvent): S {
  return { ...state, events: state.events.map((item) => (item.id === next.id ? { ...item, ...next } : item)) as S["events"] }
}

export function setPerformanceInvestigationRequirement<S extends PerformanceFoundationState>(state: S, eventId: string, input: { required: boolean; reason?: string; setBy: string; at?: string }): { state: S; event: FoundationEvent } {
  const event = state.events.find((item) => item.id === eventId)
  if (!event) throw new PerformanceFoundationError("EVENT_NOT_FOUND", `Performance event ${eventId} was not found.`)
  const setBy = requireText(input.setBy, "setBy")
  const next: FoundationEvent = { ...event, investigationRequirement: { required: input.required, reason: input.reason?.trim() || undefined, setAt: foundationNow(input.at), setBy } }
  return { state: replaceEvent(state, next), event: next }
}

export function closePerformanceEventWorkflow<S extends PerformanceFoundationState>(state: S, eventId: string, input: { closedBy: string; note?: string; at?: string; providers?: readonly WorkflowProvider[] }): { state: S; closure: PerformanceWorkflowClosure } {
  const event = state.events.find((item) => item.id === eventId)
  if (!event) throw new PerformanceFoundationError("EVENT_NOT_FOUND", `Performance event ${eventId} was not found.`)
  const closedBy = requireText(input.closedBy, "closedBy")
  const derived = deriveWorkflow(event, state, input.providers)
  if (derived.state !== "READY_TO_CLOSE") {
    throw new PerformanceFoundationError("CLOSURE_NOT_ALLOWED", `Event ${eventId} cannot be closed while its workflow state is ${derived.state}${derived.openReasons.length ? `: ${derived.openReasons.map((reason) => reason.label).join("; ")}` : ""}.`)
  }
  const closure: PerformanceWorkflowClosure = { id: foundationId("WFC"), closedAt: foundationNow(input.at), closedBy, note: input.note?.trim() || undefined }
  const next: FoundationEvent = { ...event, workflowClosures: [...(event.workflowClosures || []), closure] }
  return { state: replaceEvent(state, next), closure }
}
