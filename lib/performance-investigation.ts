/**
 * Common Performance Investigation Engine - investigations, determinations, contributing factors, preventability.
 *
 * Pure. No storage access. Authoritative foreign keys live on the CHILD record (investigation.eventId,
 * determination.investigationId); the reverse direction is obtained through the selectors below.
 *
 * New semantics NEVER depend on CompanyDetermination.determinationType / determinationValue: load-time migration in
 * lib/driver-data.ts remaps those enums (canonical values are not in its label-keyed maps), so new records are keyed by
 * `subject` + `investigationId` + `assessment`, which survive load/save.
 */

import type {
  ClassificationOutcome,
  CompanyDetermination,
  DeterminationAssessment,
  DeterminationSubject,
  PerformanceChildCollection,
  PerformanceInvestigationRecord,
  PerformanceInvestigationStatus,
  PreventabilityValue,
  ResponsibilityParty,
  ResponsibilityStandalone,
  RootCauseRole,
  RootCauseStatus,
} from "@/types/drivers"
import type { FoundationEvent, PerformanceFoundationState } from "@/lib/performance-foundation-state"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { PerformanceFoundationError, assertEvidenceIdsExist, foundationId, foundationNow, requireText } from "./performance-foundation-state.ts"

// ---------------------------------------------------------------------------
// Controlled catalogues (versionable: bump the version when values change; never reuse a value for a new meaning)
// ---------------------------------------------------------------------------

export const INVESTIGATION_SCHEMA_VERSION = 1 as const
export const DETERMINATION_ASSESSMENT_SCHEMA_VERSION = 1
export const RESPONSIBILITY_CATALOGUE_VERSION = 1

export const INVESTIGATION_STATUSES: readonly PerformanceInvestigationStatus[] = ["OPEN", "AWAITING_INFORMATION", "COMPLETED", "CANCELLED"]
export const CLASSIFICATION_OUTCOMES: readonly ClassificationOutcome[] = ["CONFIRMED_AS_REPORTED", "RECLASSIFIED", "DUPLICATE", "INSUFFICIENT_INFORMATION", "NOT_SAFETY_RELATED"]
export const PREVENTABILITY_VALUES: readonly PreventabilityValue[] = ["PREVENTABLE", "NOT_PREVENTABLE", "PARTIALLY_PREVENTABLE", "UNDETERMINED"]
export const RESPONSIBILITY_PARTIES: readonly ResponsibilityParty[] = ["CARRIER_DRIVER", "OTHER_ROAD_USER", "THIRD_PARTY", "OPERATIONAL_PROCESS", "EQUIPMENT_MAINTENANCE", "ENVIRONMENT_SITE"]
export const RESPONSIBILITY_STANDALONE: readonly ResponsibilityStandalone[] = ["NO_DETERMINATION", "UNDETERMINED"]
export const ROOT_CAUSE_STATUSES: readonly RootCauseStatus[] = ["DETERMINED", "PROBABLE", "UNDETERMINED"]
export const ROOT_CAUSE_ROLES: readonly RootCauseRole[] = ["PRIMARY", "CONTRIBUTING"]
export const CONTRIBUTING_FACTOR_DOMAINS = ["DRIVER_STATE", "DRIVER_BEHAVIOR", "OTHER_ROAD_USER", "ROAD_WEATHER", "VEHICLE_EQUIPMENT", "OPERATIONS", "SITE_CUSTOMER", "LOADING_UNLOADING", "CARGO_SECUREMENT", "SECURITY", "FRAUD_CRIME", "PROCESS_POLICY"] as const
export type ContributingFactorDomain = (typeof CONTRIBUTING_FACTOR_DOMAINS)[number]
export const CONTRIBUTING_FACTORS_COLLECTION_ID = "DRV.PERF.INVESTIGATION.CONTRIBUTING_FACTORS"
export const CONTRIBUTING_FACTORS_COLLECTION_VERSION = "1.0"

const EDITABLE_STATUSES: readonly PerformanceInvestigationStatus[] = ["OPEN", "AWAITING_INFORMATION"]
const TRANSITIONS: Readonly<Record<PerformanceInvestigationStatus, readonly PerformanceInvestigationStatus[]>> = {
  OPEN: ["AWAITING_INFORMATION", "COMPLETED", "CANCELLED"],
  AWAITING_INFORMATION: ["OPEN", "COMPLETED", "CANCELLED"],
  COMPLETED: ["OPEN"],
  CANCELLED: ["OPEN"],
}

// ---------------------------------------------------------------------------
// Selectors (reverse directions are derived, never stored as duplicate ids)
// ---------------------------------------------------------------------------

const investigationsOf = (state: PerformanceFoundationState) => state.performanceInvestigations || []
const determinationsOf = (state: PerformanceFoundationState) => state.companyDeterminations || []

export const isDeterminationActive = (determination: CompanyDetermination) => !determination.isArchived && (determination.status ?? "ACTIVE") === "ACTIVE"

export function getInvestigationsForEvent(state: PerformanceFoundationState, eventId: string): PerformanceInvestigationRecord[] {
  return investigationsOf(state)
    .filter((investigation) => investigation.eventId === eventId)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id))
}

export const getInvestigation = (state: PerformanceFoundationState, investigationId: string) => investigationsOf(state).find((item) => item.id === investigationId)

export function getDeterminationsForInvestigation(state: PerformanceFoundationState, investigationId: string, options: { includeInactive?: boolean } = {}): CompanyDetermination[] {
  return determinationsOf(state).filter((determination) => determination.investigationId === investigationId && (options.includeInactive || isDeterminationActive(determination)))
}

export function getActiveDeterminations(state: PerformanceFoundationState, investigationId: string, subject: DeterminationSubject): CompanyDetermination[] {
  return getDeterminationsForInvestigation(state, investigationId).filter((determination) => determination.subject === subject)
}

/** At most one active determination exists for the unique subjects; for ROOT_CAUSE pass the role to pick PRIMARY. */
export function getActiveDetermination(state: PerformanceFoundationState, investigationId: string, subject: DeterminationSubject, rootCauseRole?: RootCauseRole): CompanyDetermination | undefined {
  const active = getActiveDeterminations(state, investigationId, subject)
  if (subject === "ROOT_CAUSE" && rootCauseRole) return active.find((determination) => determination.assessment?.subject === "ROOT_CAUSE" && determination.assessment.role === rootCauseRole)
  return active[0]
}

// ---------------------------------------------------------------------------
// Assessment validation
// ---------------------------------------------------------------------------

export function validateDeterminationAssessment(assessment: DeterminationAssessment): string[] {
  const errors: string[] = []
  switch (assessment.subject) {
    case "PREVENTABILITY":
      if (!PREVENTABILITY_VALUES.includes(assessment.value)) errors.push("Preventability must be Preventable, Not Preventable, Partially Preventable or Undetermined.")
      break
    case "CLASSIFICATION":
      if (!CLASSIFICATION_OUTCOMES.includes(assessment.outcome)) errors.push("Classification outcome is not recognised.")
      break
    case "RESPONSIBILITY": {
      const parties = assessment.parties || []
      if (assessment.standalone !== undefined && !RESPONSIBILITY_STANDALONE.includes(assessment.standalone)) errors.push("Unknown standalone responsibility state.")
      if (assessment.standalone && parties.length) errors.push("A standalone responsibility state (No Determination / Undetermined) cannot coexist with assigned parties.")
      if (!assessment.standalone && !parties.length) errors.push("Responsibility needs at least one party or a standalone state.")
      const seen = new Set<string>()
      for (const entry of parties) {
        if (!RESPONSIBILITY_PARTIES.includes(entry.party)) errors.push(`Unknown responsibility party ${String(entry.party)}.`)
        if (entry.role !== "PRIMARY" && entry.role !== "CONTRIBUTING") errors.push(`Invalid responsibility role for ${String(entry.party)}.`)
        if (seen.has(entry.party)) errors.push(`Responsibility party ${entry.party} is listed more than once.`)
        seen.add(entry.party)
      }
      if (parties.filter((entry) => entry.role === "PRIMARY").length > 1) errors.push("Responsibility allows at most one PRIMARY party.")
      break
    }
    case "ROOT_CAUSE":
      if (!assessment.category?.trim()) errors.push("Root cause category is required.")
      if (!ROOT_CAUSE_STATUSES.includes(assessment.status)) errors.push("Root cause status must be Determined, Probable or Undetermined.")
      if (!ROOT_CAUSE_ROLES.includes(assessment.role)) errors.push("Root cause role must be PRIMARY or CONTRIBUTING.")
      // Certainty is never forced: a finding is only required once a cause is at least probable.
      if (assessment.status !== "UNDETERMINED" && !assessment.finding?.trim()) errors.push("A root cause finding is required unless the status is Undetermined.")
      if (assessment.evidenceIds && !assessment.evidenceIds.every((id) => typeof id === "string" && id)) errors.push("Root cause evidenceIds must be non-empty strings.")
      break
    case "GENERAL_FINDING":
      break
    default:
      errors.push("Unknown determination subject.")
  }
  return errors
}

// ---------------------------------------------------------------------------
// Investigation writers
// ---------------------------------------------------------------------------

function findEvent(state: PerformanceFoundationState, eventId: string): FoundationEvent {
  const event = state.events.find((item) => item.id === eventId)
  if (!event) throw new PerformanceFoundationError("EVENT_NOT_FOUND", `Performance event ${eventId} was not found.`)
  return event
}

function replaceInvestigation<S extends PerformanceFoundationState>(state: S, next: PerformanceInvestigationRecord): S {
  return { ...state, performanceInvestigations: investigationsOf(state).map((item) => (item.id === next.id ? next : item)) }
}

function requireInvestigation(state: PerformanceFoundationState, investigationId: string): PerformanceInvestigationRecord {
  const investigation = getInvestigation(state, investigationId)
  if (!investigation) throw new PerformanceFoundationError("INVESTIGATION_NOT_FOUND", `Investigation ${investigationId} was not found.`)
  return investigation
}

function requireEditable(investigation: PerformanceInvestigationRecord) {
  if (!EDITABLE_STATUSES.includes(investigation.status)) {
    throw new PerformanceFoundationError("INVESTIGATION_NOT_EDITABLE", `Investigation ${investigation.id} is ${investigation.status}; reopen it before changing it.`)
  }
}

export interface OpenInvestigationInput {
  eventId: string
  openedBy: string
  openingReason?: string
  assignedInvestigator?: string
  evidenceIds?: string[]
  at?: string
  id?: string
}

export function openPerformanceInvestigation<S extends PerformanceFoundationState>(state: S, input: OpenInvestigationInput): { state: S; investigation: PerformanceInvestigationRecord } {
  const event = findEvent(state, input.eventId)
  const openedBy = requireText(input.openedBy, "openedBy")
  if (getInvestigationsForEvent(state, event.id).some((item) => EDITABLE_STATUSES.includes(item.status))) {
    throw new PerformanceFoundationError("INVESTIGATION_ALREADY_ACTIVE", `Event ${event.id} already has an open investigation; reopen or complete it instead.`)
  }
  assertEvidenceIdsExist(state, input.evidenceIds, "evidenceIds")
  const at = foundationNow(input.at)
  const investigation: PerformanceInvestigationRecord = {
    id: input.id || foundationId("INV"),
    schemaVersion: INVESTIGATION_SCHEMA_VERSION,
    companyId: event.companyId,
    eventId: event.id,
    status: "OPEN",
    statusHistory: [{ status: "OPEN", at, by: openedBy }],
    openedAt: at,
    openedBy,
    openingReason: input.openingReason?.trim() || undefined,
    assignedInvestigator: input.assignedInvestigator?.trim() || undefined,
    evidenceIds: [...new Set(input.evidenceIds || [])],
    createdAt: at,
    updatedAt: at,
  }
  return { state: { ...state, performanceInvestigations: [...investigationsOf(state), investigation] }, investigation }
}

export interface UpdateInvestigationInput {
  by: string
  at?: string
  assignedInvestigator?: string
  openingReason?: string
  conclusion?: { summary?: string; openQuestions?: string }
  additionalInvestigationRequired?: { required: boolean; reason?: string }
  /** Evidence ids are only ever ADDED here (evidence is stored once; unlinking is a deliberate separate decision). */
  addEvidenceIds?: string[]
}

export function updatePerformanceInvestigation<S extends PerformanceFoundationState>(state: S, investigationId: string, input: UpdateInvestigationInput): { state: S; investigation: PerformanceInvestigationRecord } {
  const current = requireInvestigation(state, investigationId)
  requireText(input.by, "by")
  requireEditable(current)
  assertEvidenceIdsExist(state, input.addEvidenceIds, "addEvidenceIds")
  const next: PerformanceInvestigationRecord = {
    ...current,
    assignedInvestigator: input.assignedInvestigator !== undefined ? input.assignedInvestigator.trim() || undefined : current.assignedInvestigator,
    openingReason: input.openingReason !== undefined ? input.openingReason.trim() || undefined : current.openingReason,
    conclusion: input.conclusion ? { ...current.conclusion, ...input.conclusion } : current.conclusion,
    additionalInvestigationRequired: input.additionalInvestigationRequired ?? current.additionalInvestigationRequired,
    evidenceIds: input.addEvidenceIds ? [...new Set([...current.evidenceIds, ...input.addEvidenceIds])] : current.evidenceIds,
    updatedAt: foundationNow(input.at),
  }
  return { state: replaceInvestigation(state, next), investigation: next }
}

export interface TransitionInput {
  to: PerformanceInvestigationStatus
  by: string
  reason?: string
  at?: string
}

export function transitionPerformanceInvestigation<S extends PerformanceFoundationState>(state: S, investigationId: string, input: TransitionInput): { state: S; investigation: PerformanceInvestigationRecord } {
  const current = requireInvestigation(state, investigationId)
  const by = requireText(input.by, "by")
  if (!TRANSITIONS[current.status].includes(input.to)) {
    throw new PerformanceFoundationError("INVALID_TRANSITION", `Investigation cannot move from ${current.status} to ${input.to}.`)
  }
  const at = foundationNow(input.at)
  let next: PerformanceInvestigationRecord = { ...current, status: input.to, updatedAt: at, statusHistory: [...current.statusHistory, { status: input.to, at, by, reason: input.reason?.trim() || undefined }] }

  if (input.to === "COMPLETED") {
    if (!current.conclusion?.summary?.trim()) throw new PerformanceFoundationError("COMPLETION_REQUIRES_CONCLUSION", "An investigation needs a conclusion summary before it can be completed.")
    if (!getActiveDetermination(state, current.id, "CLASSIFICATION")) throw new PerformanceFoundationError("COMPLETION_REQUIRES_CLASSIFICATION", "An investigation needs an active Classification determination before it can be completed.")
    next = { ...next, completedAt: at, completedBy: by, cancelledReason: undefined }
  } else if (input.to === "CANCELLED") {
    const reason = requireText(input.reason, "A cancellation reason")
    next = { ...next, cancelledReason: reason, completedAt: undefined, completedBy: undefined }
  } else if (input.to === "OPEN" && (current.status === "COMPLETED" || current.status === "CANCELLED")) {
    // Reopening: the earlier completion/cancellation stays in statusHistory; only the CURRENT-state fields are cleared.
    next = { ...next, completedAt: undefined, completedBy: undefined, cancelledReason: undefined }
  }
  return { state: replaceInvestigation(state, next), investigation: next }
}

export const completePerformanceInvestigation = <S extends PerformanceFoundationState>(state: S, investigationId: string, input: { by: string; at?: string; reason?: string }) => transitionPerformanceInvestigation(state, investigationId, { ...input, to: "COMPLETED" })
export const cancelPerformanceInvestigation = <S extends PerformanceFoundationState>(state: S, investigationId: string, input: { by: string; reason: string; at?: string }) => transitionPerformanceInvestigation(state, investigationId, { ...input, to: "CANCELLED" })
export const reopenPerformanceInvestigation = <S extends PerformanceFoundationState>(state: S, investigationId: string, input: { by: string; at?: string; reason?: string }) => transitionPerformanceInvestigation(state, investigationId, { ...input, to: "OPEN" })

// ---------------------------------------------------------------------------
// Contributing factors (generic PerformanceChildCollection)
// ---------------------------------------------------------------------------

export interface ContributingFactorInput {
  domain: ContributingFactorDomain
  factor: string
  role: "PRIMARY" | "SECONDARY"
  evidenceIds?: string[]
  note?: string
}

export function validateContributingFactors(items: readonly ContributingFactorInput[]): string[] {
  const errors: string[] = []
  for (const item of items) {
    if (!CONTRIBUTING_FACTOR_DOMAINS.includes(item.domain)) errors.push(`Unknown contributing-factor domain ${String(item.domain)}.`)
    if (!item.factor?.trim()) errors.push("Every contributing factor needs a factor.")
    if (item.role !== "PRIMARY" && item.role !== "SECONDARY") errors.push("Contributing factor role must be PRIMARY or SECONDARY.")
  }
  if (items.filter((item) => item.role === "PRIMARY").length > 1) errors.push("At most one contributing factor may be PRIMARY.")
  return errors
}

export function setInvestigationContributingFactors<S extends PerformanceFoundationState>(state: S, investigationId: string, items: readonly ContributingFactorInput[], input: { by: string; at?: string }): { state: S; investigation: PerformanceInvestigationRecord } {
  const current = requireInvestigation(state, investigationId)
  requireText(input.by, "by")
  requireEditable(current)
  const errors = validateContributingFactors(items)
  if (errors.length) throw new PerformanceFoundationError("INVALID_CONTRIBUTING_FACTORS", errors[0])
  for (const item of items) assertEvidenceIdsExist(state, item.evidenceIds, "contributing factor evidenceIds")
  const collection: PerformanceChildCollection = {
    collectionId: CONTRIBUTING_FACTORS_COLLECTION_ID,
    collectionVersion: CONTRIBUTING_FACTORS_COLLECTION_VERSION,
    itemType: "INVESTIGATION_CONTRIBUTING_FACTOR",
    completeness: "COMPLETE",
    items: items.map((item) => ({
      itemId: foundationId("ICF"),
      facts: { domain: item.domain, factor: item.factor.trim(), role: item.role, note: item.note?.trim() || null },
      evidenceIds: [...new Set(item.evidenceIds || [])],
    })),
  }
  const next: PerformanceInvestigationRecord = { ...current, contributingFactors: collection, updatedAt: foundationNow(input.at) }
  return { state: replaceInvestigation(state, next), investigation: next }
}

// ---------------------------------------------------------------------------
// Determination writers (supersede, never overwrite)
// ---------------------------------------------------------------------------

export interface RecordDeterminationInput {
  investigationId: string
  assessment: DeterminationAssessment
  determinedBy: string
  determinationDate: string
  rationale?: string
  source?: string
  notes?: string
  evidenceIds?: string[]
  /** Optional explicit amendment target (required to amend a non-unique subject such as a CONTRIBUTING root cause). */
  supersedesDeterminationId?: string
  at?: string
  id?: string
}

// Legacy-typed bridge only so the record satisfies the existing type. Consumers must use `subject`, not these.
const LEGACY_TYPE_BRIDGE: Readonly<Record<DeterminationSubject, NonNullable<CompanyDetermination["determinationType"]>>> = {
  PREVENTABILITY: "INVESTIGATION_FINDING",
  RESPONSIBILITY: "INVESTIGATION_FINDING",
  CLASSIFICATION: "INVESTIGATION_FINDING",
  GENERAL_FINDING: "INVESTIGATION_FINDING",
  ROOT_CAUSE: "ROOT_CAUSE_ANALYSIS",
}

export function recordPerformanceDetermination<S extends PerformanceFoundationState>(state: S, input: RecordDeterminationInput): { state: S; determination: CompanyDetermination; superseded?: CompanyDetermination } {
  const investigation = requireInvestigation(state, input.investigationId)
  requireEditable(investigation)
  const determinedBy = requireText(input.determinedBy, "determinedBy")
  const determinationDate = requireText(input.determinationDate, "determinationDate")
  const errors = validateDeterminationAssessment(input.assessment)
  if (errors.length) throw new PerformanceFoundationError("INVALID_ASSESSMENT", errors[0])
  assertEvidenceIdsExist(state, input.evidenceIds, "evidenceIds")
  if (input.assessment.subject === "ROOT_CAUSE") assertEvidenceIdsExist(state, input.assessment.evidenceIds, "root cause evidenceIds")
  const event = findEvent(state, investigation.eventId)
  const subject = input.assessment.subject
  const at = foundationNow(input.at)

  // Which existing ACTIVE determination (if any) does this one replace?
  let target: CompanyDetermination | undefined
  if (input.supersedesDeterminationId) {
    target = determinationsOf(state).find((item) => item.id === input.supersedesDeterminationId)
    if (!target || target.investigationId !== investigation.id || target.subject !== subject || !isDeterminationActive(target)) {
      throw new PerformanceFoundationError("INVALID_SUPERSEDE_TARGET", "supersedesDeterminationId must be an ACTIVE determination of the same subject on the same investigation.")
    }
  } else if (subject === "ROOT_CAUSE") {
    if (input.assessment.subject === "ROOT_CAUSE" && input.assessment.role === "PRIMARY") target = getActiveDetermination(state, investigation.id, "ROOT_CAUSE", "PRIMARY")
  } else if (subject !== "GENERAL_FINDING") {
    target = getActiveDetermination(state, investigation.id, subject)
  }
  // An amendment that turns another root cause into a second PRIMARY must be rejected rather than silently allowed.
  if (subject === "ROOT_CAUSE" && input.assessment.subject === "ROOT_CAUSE" && input.assessment.role === "PRIMARY") {
    const existingPrimary = getActiveDetermination(state, investigation.id, "ROOT_CAUSE", "PRIMARY")
    if (existingPrimary && target && existingPrimary.id !== target.id) throw new PerformanceFoundationError("SECOND_PRIMARY_ROOT_CAUSE", "An investigation may have only one active PRIMARY root cause.")
  }

  const determination: CompanyDetermination = {
    id: input.id || foundationId("DET"),
    companyId: investigation.companyId,
    driverMasterId: event.driverMasterId || "",
    // New determinations hang off the INVESTIGATION (not the event id) so legacy event-keyed lookups are never shadowed.
    relatedRecordType: "Investigation",
    relatedRecordId: investigation.id,
    determinationType: LEGACY_TYPE_BRIDGE[subject],
    subject,
    investigationId: investigation.id,
    assessment: input.assessment,
    assessmentSchemaVersion: DETERMINATION_ASSESSMENT_SCHEMA_VERSION,
    status: "ACTIVE",
    supersedesDeterminationId: target?.id,
    rationale: input.rationale?.trim() || undefined,
    determinedBy,
    determinationDate,
    source: input.source?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    evidenceIds: [...new Set(input.evidenceIds || [])],
    isArchived: false,
    createdAt: at,
    updatedAt: at,
  }
  const superseded = target ? ({ ...target, status: "SUPERSEDED", updatedAt: at } as CompanyDetermination) : undefined
  const nextList = determinationsOf(state).map((item) => (superseded && item.id === superseded.id ? superseded : item))
  return { state: { ...state, companyDeterminations: [...nextList, determination] }, determination, superseded }
}

export function withdrawPerformanceDetermination<S extends PerformanceFoundationState>(state: S, determinationId: string, input: { by: string; reason: string; at?: string }): { state: S; determination: CompanyDetermination } {
  requireText(input.by, "by")
  const reason = requireText(input.reason, "A withdrawal reason")
  const current = determinationsOf(state).find((item) => item.id === determinationId)
  if (!current || !current.investigationId) throw new PerformanceFoundationError("DETERMINATION_NOT_FOUND", "Only investigation determinations can be withdrawn through this writer.")
  if (!isDeterminationActive(current)) throw new PerformanceFoundationError("DETERMINATION_NOT_ACTIVE", "Only an ACTIVE determination can be withdrawn.")
  const next = { ...current, status: "WITHDRAWN", notes: [current.notes, `Withdrawn by ${input.by.trim()}: ${reason}`].filter(Boolean).join("\n"), updatedAt: foundationNow(input.at) } as CompanyDetermination
  return { state: { ...state, companyDeterminations: determinationsOf(state).map((item) => (item.id === next.id ? next : item)) }, determination: next }
}

// ---------------------------------------------------------------------------
// Preventability resolution (new architecture first, legacy second, deprecated field last)
// ---------------------------------------------------------------------------

export type PreventabilitySource = "INVESTIGATION" | "LEGACY_DETERMINATION" | "DEPRECATED_COLLISION_FIELD"

export interface ResolvedPreventability {
  value: PreventabilityValue
  source: PreventabilitySource
  determinationId?: string
  investigationId?: string
}

function normalizeLegacyPreventability(raw: unknown): PreventabilityValue | undefined {
  const text = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s_-]+/g, "") : ""
  if (!text) return undefined
  if (text === "preventable") return "PREVENTABLE"
  if (text === "nonpreventable" || text === "notpreventable") return "NOT_PREVENTABLE"
  if (text === "partiallypreventable") return "PARTIALLY_PREVENTABLE"
  if (text === "undetermined" || text === "unabletodetermine") return "UNDETERMINED"
  return undefined
}

/**
 * Does not alter, migrate or rewrite any legacy field. The legacy reads tolerate BOTH canonical and `legacy*` fields because
 * load-time migration moves canonical determinationType/Value into legacy* strings.
 */
export function resolvePreventability(state: PerformanceFoundationState, event: FoundationEvent): ResolvedPreventability | null {
  // 1. Active new PREVENTABILITY determination on any of the event's investigations (latest wins, deterministically).
  const fresh = getInvestigationsForEvent(state, event.id)
    .flatMap((investigation) => getActiveDeterminations(state, investigation.id, "PREVENTABILITY"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .pop()
  if (fresh && fresh.assessment?.subject === "PREVENTABILITY") {
    return { value: fresh.assessment.value, source: "INVESTIGATION", determinationId: fresh.id, investigationId: fresh.investigationId }
  }

  // 2. Legacy Collision determination keyed by the event id.
  const legacy = determinationsOf(state)
    .filter((item) => !item.isArchived && !item.subject && item.relatedRecordId === event.id && (item.determinationType || item.legacyDeterminationType) === "COLLISION_PREVENTABILITY")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .pop()
  if (legacy) {
    const value = normalizeLegacyPreventability(legacy.determinationValue || legacy.legacyDeterminationValue) ?? normalizeLegacyPreventability(legacy.preventabilityFinding || legacy.legacyPreventabilityFinding) ?? "UNDETERMINED"
    return { value, source: "LEGACY_DETERMINATION", determinationId: legacy.id }
  }

  // 3. Deprecated collisionDetails.preventability, only when nothing above exists.
  const deprecated = normalizeLegacyPreventability(event.collisionDetails?.preventability)
  if (deprecated) return { value: deprecated, source: "DEPRECATED_COLLISION_FIELD" }
  return null
}
