/**
 * Common Performance Investigation Engine - shared shape.
 *
 * The engine's writers/selectors are pure functions over this structural subset of CompanyDriverStore. A real
 * CompanyDriverStore satisfies it, and unit tests can pass minimal literals. Writers return a NEW state object
 * (never mutating the input); persistence is the caller's job (see updateCompanyDriverStore in lib/driver-data.ts).
 *
 * Lifecycle facts are kept on the records themselves (statusHistory, supersede chains, withdrawn relationships,
 * workflowClosures) so a later immutable audit/Master Register layer can be fed from them. They are NOT Master
 * Register events today.
 */

import type {
  CompanyActionRecord,
  CompanyDetermination,
  DriverEvidenceItem,
  PerformanceEventRecord,
  PerformanceEventRelationship,
  PerformanceInvestigationRecord,
} from "@/types/drivers"

export type FoundationEvent = Pick<PerformanceEventRecord, "id" | "companyId" | "eventType"> &
  Partial<
    Pick<
      PerformanceEventRecord,
      | "driverMasterId"
      | "createdAt"
      | "isArchived"
      | "followUpActionRequired"
      | "followUpActionSummary"
      | "followUpDueDate"
      | "investigationRequirement"
      | "workflowClosures"
      | "collisionDetails"
      | "structuredEventFacts"
      | "structuredFacts"
      | "childCollections"
    >
  >

export interface PerformanceFoundationState {
  events: FoundationEvent[]
  performanceInvestigations?: PerformanceInvestigationRecord[]
  companyDeterminations?: CompanyDetermination[]
  companyActions?: CompanyActionRecord[]
  eventRelationships?: PerformanceEventRelationship[]
  /** Optional. When present, evidence ids referenced by new records are checked against it. */
  evidence?: Array<Pick<DriverEvidenceItem, "id"> & Partial<Pick<DriverEvidenceItem, "isArchived">>>
}

export class PerformanceFoundationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "PerformanceFoundationError"
    this.code = code
  }
}

export const foundationNow = (at?: string) => at || new Date().toISOString()

export const foundationId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`

export function requireText(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) throw new PerformanceFoundationError("REQUIRED_FIELD", `${field} is required.`)
  return text
}

export function assertEvidenceIdsExist(state: PerformanceFoundationState, ids: readonly string[] | undefined, field: string) {
  if (!ids?.length || !state.evidence) return
  const known = new Set(state.evidence.filter((item) => !item.isArchived).map((item) => item.id))
  const missing = ids.filter((id) => !known.has(id))
  if (missing.length) throw new PerformanceFoundationError("UNKNOWN_EVIDENCE", `${field} references evidence that does not exist: ${missing.join(", ")}.`)
}
