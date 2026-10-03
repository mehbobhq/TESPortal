/**
 * Common Performance Investigation Engine - canonical Event <-> Event relationships.
 *
 * One directional row per relationship; the inverse view is derived by selector and never stored twice. Rows are never
 * hard-deleted by the normal writer: a relationship is WITHDRAWN (history preserved). The historical eventType of either
 * event is never touched - reclassification is a relationship, not a mutation.
 *
 * No analytics semantics live here (whether a reclassified record counts in a metric is Performance Intelligence's decision).
 */

import type { PerformanceEventRelationship, PerformanceEventRelationshipType } from "@/types/drivers"
import type { PerformanceFoundationState } from "@/lib/performance-foundation-state"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { PerformanceFoundationError, foundationId, foundationNow, requireText } from "./performance-foundation-state.ts"

export const EVENT_RELATIONSHIP_SCHEMA_VERSION = 1 as const
export const EVENT_RELATIONSHIP_TYPES: readonly PerformanceEventRelationshipType[] = ["RECLASSIFIED_AS", "ORIGINATED_FROM", "RELATED_TO", "SUPERSEDES", "DUPLICATE_OF", "SAME_OCCURRENCE_AS"]

/** Label of the relationship as seen from the TARGET event. Symmetric types read the same from both sides. */
export const INVERSE_RELATIONSHIP_LABEL: Readonly<Record<PerformanceEventRelationshipType, string>> = {
  RECLASSIFIED_AS: "ORIGINATED_FROM",
  ORIGINATED_FROM: "RECLASSIFIED_AS",
  RELATED_TO: "RELATED_TO",
  SUPERSEDES: "SUPERSEDED_BY",
  DUPLICATE_OF: "HAS_DUPLICATE",
  SAME_OCCURRENCE_AS: "SAME_OCCURRENCE_AS",
}

const SYMMETRIC: readonly PerformanceEventRelationshipType[] = ["RELATED_TO", "SAME_OCCURRENCE_AS"]

const rowsOf = (state: PerformanceFoundationState) => state.eventRelationships || []
const isActive = (row: PerformanceEventRelationship) => row.status === "ACTIVE"

/** ORIGINATED_FROM(a -> b) is the same fact as RECLASSIFIED_AS(b -> a). Validation always reasons on the reclassification form. */
function asReclassification(row: { type: PerformanceEventRelationshipType; fromEventId: string; toEventId: string }) {
  if (row.type === "RECLASSIFIED_AS") return { from: row.fromEventId, to: row.toEventId }
  if (row.type === "ORIGINATED_FROM") return { from: row.toEventId, to: row.fromEventId }
  return null
}

function activeReclassificationEdges(state: PerformanceFoundationState) {
  return rowsOf(state).filter(isActive).map(asReclassification).filter((edge): edge is { from: string; to: string } => Boolean(edge))
}

export interface EventRelationshipView {
  relationship: PerformanceEventRelationship
  direction: "OUTGOING" | "INCOMING"
  /** The relationship type as seen from the requested event. */
  effectiveType: string
  otherEventId: string
}

export function getEventRelationships(state: PerformanceFoundationState, eventId: string, options: { includeWithdrawn?: boolean } = {}): EventRelationshipView[] {
  return rowsOf(state)
    .filter((row) => (options.includeWithdrawn || isActive(row)) && (row.fromEventId === eventId || row.toEventId === eventId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((row) =>
      row.fromEventId === eventId
        ? { relationship: row, direction: "OUTGOING" as const, effectiveType: row.type, otherEventId: row.toEventId }
        : { relationship: row, direction: "INCOMING" as const, effectiveType: INVERSE_RELATIONSHIP_LABEL[row.type], otherEventId: row.fromEventId },
    )
}

/** The single active reclassification for an event, in either stored form, expressed as { fromEventId: thisEvent, toEventId: resultingEvent }. */
export function getActiveReclassification(state: PerformanceFoundationState, eventId: string): { relationship: PerformanceEventRelationship; resultingEventId: string } | undefined {
  for (const row of rowsOf(state).filter(isActive)) {
    const edge = asReclassification(row)
    if (edge && edge.from === eventId) return { relationship: row, resultingEventId: edge.to }
  }
  return undefined
}

export interface CreateEventRelationshipInput {
  fromEventId: string
  toEventId: string
  type: PerformanceEventRelationshipType
  createdBy: string
  basisInvestigationId?: string
  basisDeterminationId?: string
  note?: string
  /**
   * RECLASSIFIED_AS only. When the source event already has an active reclassification, the writer refuses unless this is set;
   * when set, the old relationship is WITHDRAWN (history preserved) and the new one becomes active in the same call.
   */
  replaceActiveReclassification?: boolean
  at?: string
  id?: string
}

export function createPerformanceEventRelationship<S extends PerformanceFoundationState>(state: S, input: CreateEventRelationshipInput): { state: S; relationship: PerformanceEventRelationship; withdrawn?: PerformanceEventRelationship } {
  const createdBy = requireText(input.createdBy, "createdBy")
  if (!EVENT_RELATIONSHIP_TYPES.includes(input.type)) throw new PerformanceFoundationError("INVALID_RELATIONSHIP_TYPE", `Unknown event relationship type ${String(input.type)}.`)
  if (input.fromEventId === input.toEventId) throw new PerformanceFoundationError("SELF_RELATIONSHIP", "An event cannot be related to itself.")
  const from = state.events.find((item) => item.id === input.fromEventId)
  const to = state.events.find((item) => item.id === input.toEventId)
  if (!from) throw new PerformanceFoundationError("EVENT_NOT_FOUND", `Performance event ${input.fromEventId} was not found.`)
  if (!to) throw new PerformanceFoundationError("EVENT_NOT_FOUND", `Performance event ${input.toEventId} was not found.`)
  if (from.companyId !== to.companyId) throw new PerformanceFoundationError("CROSS_COMPANY_RELATIONSHIP", "Both events must belong to the same company store.")

  const active = rowsOf(state).filter(isActive)
  const duplicate = active.some((row) => {
    if (row.type !== input.type) return false
    const sameDirection = row.fromEventId === input.fromEventId && row.toEventId === input.toEventId
    const reverse = row.fromEventId === input.toEventId && row.toEventId === input.fromEventId
    return sameDirection || (SYMMETRIC.includes(input.type) && reverse)
  })
  if (duplicate) throw new PerformanceFoundationError("DUPLICATE_RELATIONSHIP", "This relationship already exists and is active.")

  const at = foundationNow(input.at)
  let withdrawn: PerformanceEventRelationship | undefined
  const reclass = asReclassification({ type: input.type, fromEventId: input.fromEventId, toEventId: input.toEventId })
  if (reclass) {
    // Acyclic: following active reclassifications from the target must never reach the source.
    const edges = activeReclassificationEdges(state)
    const seen = new Set<string>()
    const stack = [reclass.to]
    while (stack.length) {
      const node = stack.pop() as string
      if (node === reclass.from) throw new PerformanceFoundationError("RECLASSIFICATION_CYCLE", "This reclassification would create a cycle.")
      if (seen.has(node)) continue
      seen.add(node)
      for (const edge of edges) if (edge.from === node) stack.push(edge.to)
    }
    // Maximum ONE active reclassification out of an event.
    const existing = getActiveReclassification(state, reclass.from)
    if (existing) {
      if (!input.replaceActiveReclassification) throw new PerformanceFoundationError("RECLASSIFICATION_EXISTS", `Event ${reclass.from} already has an active reclassification (${existing.relationship.id}); pass replaceActiveReclassification to withdraw it first.`)
      withdrawn = { ...existing.relationship, status: "WITHDRAWN", withdrawnAt: at, withdrawnBy: createdBy }
    }
  }

  const relationship: PerformanceEventRelationship = {
    id: input.id || foundationId("ERL"),
    schemaVersion: EVENT_RELATIONSHIP_SCHEMA_VERSION,
    companyId: from.companyId,
    fromEventId: input.fromEventId,
    toEventId: input.toEventId,
    type: input.type,
    basisInvestigationId: input.basisInvestigationId,
    basisDeterminationId: input.basisDeterminationId,
    note: input.note?.trim() || undefined,
    status: "ACTIVE",
    createdAt: at,
    createdBy,
  }
  const kept = rowsOf(state).map((row) => (withdrawn && row.id === withdrawn.id ? withdrawn : row))
  return { state: { ...state, eventRelationships: [...kept, relationship] }, relationship, withdrawn }
}

export function withdrawPerformanceEventRelationship<S extends PerformanceFoundationState>(state: S, relationshipId: string, input: { by: string; at?: string }): { state: S; relationship: PerformanceEventRelationship } {
  const by = requireText(input.by, "by")
  const current = rowsOf(state).find((row) => row.id === relationshipId)
  if (!current) throw new PerformanceFoundationError("RELATIONSHIP_NOT_FOUND", `Event relationship ${relationshipId} was not found.`)
  if (!isActive(current)) throw new PerformanceFoundationError("RELATIONSHIP_NOT_ACTIVE", "Only an ACTIVE relationship can be withdrawn.")
  const next: PerformanceEventRelationship = { ...current, status: "WITHDRAWN", withdrawnAt: foundationNow(input.at), withdrawnBy: by }
  return { state: { ...state, eventRelationships: rowsOf(state).map((row) => (row.id === next.id ? next : row)) }, relationship: next }
}
