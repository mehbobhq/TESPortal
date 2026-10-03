/**
 * Near Miss - first event-family consumer of the Common Performance Investigation Engine.
 *
 * Near Miss owns OCCURRENCE facts and Near-Miss-specific taxonomy only. Classification, preventability, responsibility,
 * contributing factors, root cause and conclusions belong to the investigation engine and are NOT duplicated here.
 *
 * Pure functions over the stored event shape; persistence is the caller's job. Business logic compares canonical values; the
 * label helpers are presentation only.
 */

import type { PerformanceChildCollection, PerformanceChildFactItem, PerformanceEventRecord, StructuredEventFact } from "@/types/drivers"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import * as taxonomy from "./performance-near-miss-taxonomy.ts"
import type { FoundationEvent, PerformanceFoundationState } from "@/lib/performance-foundation-state"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { DEFAULT_WORKFLOW_PROVIDERS, deriveWorkflow, makeObligation } from "./performance-workflow.ts"
import type { WorkflowObligation, WorkflowProvider } from "@/lib/performance-workflow"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { getInvestigationsForEvent } from "./performance-investigation.ts"

type Option = { value: string; label: string }
const T = taxonomy as {
  NEAR_MISS_PRIMARY_TYPES: readonly Option[]
  NEAR_MISS_OPERATING_ACTIVITIES: readonly Option[]
  NEAR_MISS_OTHER_PARTY_TYPES: readonly Option[]
  NEAR_MISS_POTENTIAL_CONSEQUENCES: readonly Option[]
  NEAR_MISS_POTENTIAL_SEVERITIES: readonly Option[]
  NEAR_MISS_IMMEDIATE_RESPONSES: readonly Option[]
  NEAR_MISS_UNSAFE_CONDITION_STATES: readonly Option[]
  NEAR_MISS_SOURCES: readonly Option[]
  NEAR_MISS_DIRECTIONS_OF_TRAVEL: readonly Option[]
  NEAR_MISS_TYPE_GROUP_BY_VALUE: Readonly<Record<string, string>>
  NEAR_MISS_COLLECTION_IDS: Readonly<Record<"SECONDARY_TYPES" | "POTENTIAL_CONSEQUENCES" | "IMMEDIATE_RESPONSES" | "UNSAFE_CONDITION_RESOLUTIONS", string>>
  LEGACY_NEAR_MISS_TYPES: readonly Option[]
  LEGACY_NEAR_MISS_TRIGGER_SOURCES: readonly Option[]
  IANA_TIME_ZONES: readonly Option[]
  nearMissOptionLabel: (list: readonly Option[], value: string | null | undefined) => string
}

export type NearMissEvent = Pick<PerformanceEventRecord, "id" | "eventType"> &
  Partial<Pick<PerformanceEventRecord, "driverMasterId" | "eventDate" | "eventTime" | "location" | "city" | "stateProvince" | "country" | "vehicleId" | "canonicalLinks" | "structuredEventFacts" | "structuredFacts" | "childCollections" | "evidenceIds" | "provenance" | "summary" | "createdAt">>

/** Stable data point ids for the Near Miss facts (mirrors lib/driver-performance-schema.ts). */
export const NEAR_MISS_DATA_POINTS = {
  primaryType: "DRV.PERF.NEAR_MISS.PRIMARY_TYPE",
  operatingActivity: "DRV.PERF.NEAR_MISS.OPERATING_ACTIVITY",
  eventTimeZone: "DRV.PERF.NEAR_MISS.EVENT_TIME_ZONE",
  roadHighway: "DRV.PERF.NEAR_MISS.ROAD_HIGHWAY",
  directionOfTravel: "DRV.PERF.NEAR_MISS.DIRECTION_OF_TRAVEL",
  otherPartyType: "DRV.PERF.NEAR_MISS.OTHER_PARTY_TYPE",
  otherPartyObject: "DRV.PERF.NEAR_MISS.OTHERPARTYOBJECT",
  potentialSeverityReported: "DRV.PERF.NEAR_MISS.POTENTIAL_SEVERITY_REPORTED",
  potentialSeverityAssessed: "DRV.PERF.NEAR_MISS.POTENTIAL_SEVERITY_ASSESSED",
  potentialSeverityAssessedBy: "DRV.PERF.NEAR_MISS.POTENTIAL_SEVERITY_ASSESSED_BY",
  potentialSeverityAssessedAt: "DRV.PERF.NEAR_MISS.POTENTIAL_SEVERITY_ASSESSED_AT",
  potentialConsequenceOther: "DRV.PERF.NEAR_MISS.POTENTIAL_CONSEQUENCE_OTHER",
  immediateResponseOther: "DRV.PERF.NEAR_MISS.IMMEDIATE_RESPONSE_OTHER",
  unsafeConditionRemains: "DRV.PERF.NEAR_MISS.UNSAFE_CONDITION_REMAINS",
  reporterDescription: "DRV.PERF.NEAR_MISS.REPORTER_DESCRIPTION",
  distanceToImpact: "DRV.PERF.NEAR_MISS.DISTANCETOIMPACT",
  timeToCollision: "DRV.PERF.NEAR_MISS.TIMETOCOLLISION",
  speed: "DRV.PERF.NEAR_MISS.SPEED",
  zoneType: "DRV.PERF.SHARED.ZONE_TYPE",
  contextNotes: "DRV.PERF.NEAR_MISS.CONTEXTNOTES",
  legacyType: "DRV.PERF.NEAR_MISS.NEARMISSTYPE",
  legacyTriggerSource: "DRV.PERF.NEAR_MISS.TRIGGERSOURCE",
  legacyAvoidanceAction: "DRV.PERF.NEAR_MISS.AVOIDANCEACTION",
} as const

export const UNSAFE_CONDITION_RESOLUTION_OUTCOMES = ["RESOLVED", "CLARIFIED_NO_UNSAFE_CONDITION"] as const
export type UnsafeConditionResolutionOutcome = (typeof UNSAFE_CONDITION_RESOLUTION_OUTCOMES)[number]
export type NearMissPotentialSeverity = "LOW" | "MODERATE" | "SERIOUS" | "CATASTROPHIC"
export type NearMissSeverityBasis = "TES_ASSESSED" | "SOURCE_REPORTED"

const values = (list: readonly Option[]) => list.map((item) => item.value)
const labelIn = (list: readonly Option[], value: string | null | undefined) => T.nearMissOptionLabel(list, value)

// ---------------------------------------------------------------------------
// Fact / collection access
// ---------------------------------------------------------------------------

export function nearMissFact(event: Pick<NearMissEvent, "structuredEventFacts">, dataPointId: string): StructuredEventFact["value"] | undefined {
  return event.structuredEventFacts?.find((fact) => fact.dataPointId === dataPointId)?.value
}
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")
const factText = (event: NearMissEvent, dataPointId: string) => text(nearMissFact(event, dataPointId))

/** New-taxonomy records carry the Primary Near-Miss Type data point; everything else is a legacy record. */
export const isNewTaxonomyNearMiss = (event: NearMissEvent) => Boolean(factText(event, NEAR_MISS_DATA_POINTS.primaryType))
export const isLegacyNearMiss = (event: NearMissEvent) => event.eventType === "Near Miss" && !isNewTaxonomyNearMiss(event)

export function readNearMissMultiValues(event: Pick<NearMissEvent, "childCollections">, collectionId: string): string[] {
  const collection = event.childCollections?.find((item) => item.collectionId === collectionId)
  return collection ? collection.items.map((item) => text(item.facts.value)).filter(Boolean) : []
}

export function buildNearMissMultiValueCollection(collectionId: string, selected: readonly string[]): PerformanceChildCollection | undefined {
  const unique = [...new Set(selected.filter(Boolean))]
  if (!unique.length) return undefined
  const items: PerformanceChildFactItem[] = unique.map((value) => ({ itemId: `${collectionId}:${value}`, facts: { value }, evidenceIds: [] }))
  return { collectionId, collectionVersion: "1.0", itemType: "NEAR_MISS_CONTROLLED_VALUE", completeness: "COMPLETE", items }
}

// ---------------------------------------------------------------------------
// Validation (new records only - legacy records are never validated against these rules)
// ---------------------------------------------------------------------------

export interface NearMissMultiValueInput {
  primary?: string
  secondary?: readonly string[]
  consequences?: readonly string[]
  consequenceOtherDescription?: string
  responses?: readonly string[]
  responseOtherDescription?: string
}

const duplicates = (items: readonly string[]) => items.filter((item, index) => items.indexOf(item) !== index)

export function validateNearMissMultiValues(input: NearMissMultiValueInput): string[] {
  const errors: string[] = []
  const secondary = input.secondary || []
  const secondaryAllowed = values(T.NEAR_MISS_PRIMARY_TYPES)
  if (secondary.some((value) => !secondaryAllowed.includes(value))) errors.push("Secondary Near-Miss Types must come from the Near Miss taxonomy.")
  if (duplicates(secondary).length) errors.push("Secondary Near-Miss Types must be unique.")
  if (input.primary && secondary.includes(input.primary)) errors.push("The Primary Near-Miss Type cannot also be a Secondary Near-Miss Type.")
  const consequences = input.consequences || []
  if (consequences.some((value) => !values(T.NEAR_MISS_POTENTIAL_CONSEQUENCES).includes(value))) errors.push("Potential Consequences must be controlled values.")
  if (duplicates(consequences).length) errors.push("Potential Consequences must be unique.")
  if (consequences.includes("OTHER") && !text(input.consequenceOtherDescription)) errors.push("Describe the Other Potential Consequence.")
  const responses = input.responses || []
  if (responses.some((value) => !values(T.NEAR_MISS_IMMEDIATE_RESPONSES).includes(value))) errors.push("Immediate Responses must be controlled values.")
  if (duplicates(responses).length) errors.push("Immediate Responses must be unique.")
  if (responses.includes("OTHER") && !text(input.responseOtherDescription)) errors.push("Describe the Other Immediate Response.")
  return errors
}

export const isValidIanaTimeZone = (value: string) => {
  if (!/^[A-Za-z]+(\/[A-Za-z0-9_+\-]+)+$/.test(value)) return false
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true } catch { return false }
}

export type NewNearMissCandidate = NearMissEvent & { driverMasterId?: string }

/** Rules for a NEW Near Miss write. Returns every problem so the UI/data layer can report the first and tests can assert all. */
export function validateNewNearMiss(data: NewNearMissCandidate): string[] {
  const errors: string[] = []
  const f = (dataPointId: string) => factText(data, dataPointId)
  if (!text(data.eventDate)) errors.push("Event Date is required.")
  if (!text(data.eventTime)) errors.push("Event Time is required.")
  if (!text(data.driverMasterId)) errors.push("Driver is required.")
  const hasPowerUnit = Boolean(text(data.vehicleId)) || Boolean(data.canonicalLinks?.some((link) => link.relationshipKey === "vehicle" && link.entityType === "Vehicle" && text(link.recordId)))
  if (!hasPowerUnit) errors.push("Power Unit is required.")
  if (!text(data.location)) errors.push("Location is required.")
  if (!text(data.country)) errors.push("Country is required.")
  const activity = f(NEAR_MISS_DATA_POINTS.operatingActivity)
  if (!activity) errors.push("Operating Activity is required.")
  else if (!values(T.NEAR_MISS_OPERATING_ACTIVITIES).includes(activity)) errors.push("Operating Activity must be a controlled value.")
  const primary = f(NEAR_MISS_DATA_POINTS.primaryType)
  if (!primary) errors.push("Primary Near-Miss Type is required.")
  else if (!values(T.NEAR_MISS_PRIMARY_TYPES).includes(primary)) errors.push("Primary Near-Miss Type must be a Near Miss taxonomy value.")
  if (!values(T.NEAR_MISS_SOURCES).includes(text(data.provenance?.source))) errors.push("Source is required and must be a Near Miss source.")

  errors.push(...validateNearMissMultiValues({
    primary: primary || undefined,
    secondary: readNearMissMultiValues(data, T.NEAR_MISS_COLLECTION_IDS.SECONDARY_TYPES),
    consequences: readNearMissMultiValues(data, T.NEAR_MISS_COLLECTION_IDS.POTENTIAL_CONSEQUENCES),
    consequenceOtherDescription: f(NEAR_MISS_DATA_POINTS.potentialConsequenceOther),
    responses: readNearMissMultiValues(data, T.NEAR_MISS_COLLECTION_IDS.IMMEDIATE_RESPONSES),
    responseOtherDescription: f(NEAR_MISS_DATA_POINTS.immediateResponseOther),
  }))

  const otherParty = f(NEAR_MISS_DATA_POINTS.otherPartyType)
  if (otherParty && !values(T.NEAR_MISS_OTHER_PARTY_TYPES).includes(otherParty)) errors.push("Other Party / Object must be a controlled value.")
  if (otherParty === "OTHER" && !f(NEAR_MISS_DATA_POINTS.otherPartyObject)) errors.push("Describe the Other Party / Object.")
  const reported = f(NEAR_MISS_DATA_POINTS.potentialSeverityReported)
  // Blank must not become a second uncertainty state: UNKNOWN already means "not known".
  const unsafeAnswer = f(NEAR_MISS_DATA_POINTS.unsafeConditionRemains)
  if (!unsafeAnswer) errors.push("Unsafe Condition Remains? is required (Yes, No or Unknown).")
  if (reported && !values(T.NEAR_MISS_POTENTIAL_SEVERITIES).includes(reported)) errors.push("Reported Potential Severity must be a controlled value.")
  const assessed = f(NEAR_MISS_DATA_POINTS.potentialSeverityAssessed)
  if (assessed) {
    if (!values(T.NEAR_MISS_POTENTIAL_SEVERITIES).includes(assessed)) errors.push("TES-Assessed Potential Severity must be a controlled value.")
    if (!f(NEAR_MISS_DATA_POINTS.potentialSeverityAssessedBy) || !f(NEAR_MISS_DATA_POINTS.potentialSeverityAssessedAt)) errors.push("A TES-Assessed Potential Severity must name who assessed it and when.")
  }
  const unsafe = f(NEAR_MISS_DATA_POINTS.unsafeConditionRemains)
  if (unsafe && !values(T.NEAR_MISS_UNSAFE_CONDITION_STATES).includes(unsafe)) errors.push("Unsafe Condition Remains must be Yes, No or Unknown.")
  const zone = f(NEAR_MISS_DATA_POINTS.eventTimeZone)
  if (zone && !isValidIanaTimeZone(zone)) errors.push("Time Zone must be an IANA identifier such as America/Edmonton.")
  const direction = f(NEAR_MISS_DATA_POINTS.directionOfTravel)
  if (direction && !values(T.NEAR_MISS_DIRECTIONS_OF_TRAVEL).includes(direction)) errors.push("Direction of Travel must be a controlled value.")

  // One source of truth: new records never carry the legacy trigger source / configuration / avoidance facts.
  for (const legacyId of [NEAR_MISS_DATA_POINTS.legacyType, NEAR_MISS_DATA_POINTS.legacyTriggerSource, NEAR_MISS_DATA_POINTS.legacyAvoidanceAction]) {
    if (nearMissFact(data, legacyId) !== undefined) errors.push("Legacy Near Miss fields cannot be written on a new record; use the Primary Near-Miss Type, Source and Immediate Response.")
  }
  return errors
}

// ---------------------------------------------------------------------------
// Potential severity - reported vs TES-assessed provenance
// ---------------------------------------------------------------------------

export interface NearMissPotentialSeverityView {
  reported?: NearMissPotentialSeverity
  assessed?: NearMissPotentialSeverity
  assessedBy?: string
  assessedAt?: string
  /** TES-assessed when one legitimately exists, otherwise the source-reported value. Never relabelled. */
  effective?: { value: NearMissPotentialSeverity; basis: NearMissSeverityBasis }
}

const asSeverity = (value: string): NearMissPotentialSeverity | undefined => (values(T.NEAR_MISS_POTENTIAL_SEVERITIES).includes(value) ? (value as NearMissPotentialSeverity) : undefined)

export function getNearMissPotentialSeverity(event: NearMissEvent): NearMissPotentialSeverityView {
  const reported = asSeverity(factText(event, NEAR_MISS_DATA_POINTS.potentialSeverityReported))
  const assessed = asSeverity(factText(event, NEAR_MISS_DATA_POINTS.potentialSeverityAssessed))
  const effective = assessed ? { value: assessed, basis: "TES_ASSESSED" as const } : reported ? { value: reported, basis: "SOURCE_REPORTED" as const } : undefined
  return { reported, assessed, assessedBy: factText(event, NEAR_MISS_DATA_POINTS.potentialSeverityAssessedBy) || undefined, assessedAt: factText(event, NEAR_MISS_DATA_POINTS.potentialSeverityAssessedAt) || undefined, effective }
}

function withFacts<E extends NearMissEvent>(event: E, updates: Array<[string, string | undefined]>): E {
  const ids = new Set(updates.map(([id]) => id))
  const kept = (event.structuredEventFacts || []).filter((fact) => !ids.has(fact.dataPointId))
  const added: StructuredEventFact[] = updates.filter(([, value]) => value !== undefined).map(([dataPointId, value]) => ({ dataPointId, value: value as string, valueType: "string", source: "TES_ASSESSMENT" }))
  return { ...event, structuredEventFacts: [...kept, ...added] }
}

/** Data-model writer for the TES assessment (no UI in this slice). The reported value is left untouched. */
export function setNearMissAssessedPotentialSeverity<E extends NearMissEvent>(event: E, input: { value: NearMissPotentialSeverity; assessedBy: string; at?: string }): E {
  if (!asSeverity(input.value)) throw new Error("TES-Assessed Potential Severity must be Low, Moderate, Serious or Catastrophic.")
  const assessedBy = text(input.assessedBy)
  if (!assessedBy) throw new Error("assessedBy is required for a TES-Assessed Potential Severity.")
  return withFacts(event, [[NEAR_MISS_DATA_POINTS.potentialSeverityAssessed, input.value], [NEAR_MISS_DATA_POINTS.potentialSeverityAssessedBy, assessedBy], [NEAR_MISS_DATA_POINTS.potentialSeverityAssessedAt, input.at || new Date().toISOString()]])
}

// ---------------------------------------------------------------------------
// Unsafe condition
// ---------------------------------------------------------------------------

export type UnsafeConditionState = "YES" | "NO" | "UNKNOWN" | "NOT_CAPTURED"
export const getUnsafeConditionState = (event: NearMissEvent): UnsafeConditionState => {
  const value = factText(event, NEAR_MISS_DATA_POINTS.unsafeConditionRemains)
  return value === "YES" || value === "NO" || value === "UNKNOWN" ? value : "NOT_CAPTURED"
}

export function getUnsafeConditionResolution(event: Pick<NearMissEvent, "childCollections">): { outcome: UnsafeConditionResolutionOutcome; resolvedBy?: string; resolvedAt?: string; note?: string } | undefined {
  const collection = event.childCollections?.find((item) => item.collectionId === T.NEAR_MISS_COLLECTION_IDS.UNSAFE_CONDITION_RESOLUTIONS)
  const item = collection?.items.slice().sort((a, b) => text(a.facts.resolvedAt).localeCompare(text(b.facts.resolvedAt))).pop()
  if (!item) return undefined
  const outcome = text(item.facts.outcome) as UnsafeConditionResolutionOutcome
  return { outcome, resolvedBy: text(item.facts.resolvedBy) || undefined, resolvedAt: text(item.facts.resolvedAt) || undefined, note: text(item.facts.note) || undefined }
}

/** Append-only: a resolution never edits the occurrence fact the reporter recorded. */
export function resolveNearMissUnsafeCondition<E extends NearMissEvent>(event: E, input: { outcome?: UnsafeConditionResolutionOutcome; resolvedBy: string; note?: string; at?: string }): E {
  const resolvedBy = text(input.resolvedBy)
  if (!resolvedBy) throw new Error("resolvedBy is required.")
  const state = getUnsafeConditionState(event)
  if (state !== "YES" && state !== "UNKNOWN") throw new Error("Only an unsafe condition recorded as Yes or Unknown can be resolved or clarified.")
  const outcome = input.outcome || "RESOLVED"
  if (!UNSAFE_CONDITION_RESOLUTION_OUTCOMES.includes(outcome)) throw new Error("Unsupported unsafe-condition resolution outcome.")
  const at = input.at || new Date().toISOString()
  const existing = event.childCollections?.find((item) => item.collectionId === T.NEAR_MISS_COLLECTION_IDS.UNSAFE_CONDITION_RESOLUTIONS)
  const item: PerformanceChildFactItem = { itemId: `NMUR-${globalThis.crypto.randomUUID()}`, facts: { outcome, resolvedBy, resolvedAt: at, note: text(input.note) || null }, evidenceIds: [] }
  const collection: PerformanceChildCollection = existing
    ? { ...existing, items: [...existing.items, item] }
    : { collectionId: T.NEAR_MISS_COLLECTION_IDS.UNSAFE_CONDITION_RESOLUTIONS, collectionVersion: "1.0", itemType: "NEAR_MISS_UNSAFE_CONDITION_RESOLUTION", completeness: "COMPLETE", items: [item] }
  return { ...event, childCollections: [...(event.childCollections || []).filter((entry) => entry.collectionId !== collection.collectionId), collection] }
}

// ---------------------------------------------------------------------------
// Investigation requirement policy
// ---------------------------------------------------------------------------

export type NearMissInvestigationTrigger = "TES_ASSESSED_SEVERITY" | "UNSAFE_CONDITION_REMAINS" | "REVIEWER_REQUIRED"

export interface NearMissInvestigationPolicyResult {
  /** policyRequired || reviewerRequired. */
  required: boolean
  triggers: NearMissInvestigationTrigger[]
  /** Hard policy requirement (TES-assessed Serious/Catastrophic, or the original unsafe condition = Yes). A reviewer cannot release it. */
  policyRequired: boolean
  /** Explicit reviewer decision; the reviewer may add or withdraw only this one. */
  reviewerRequired: boolean
  /** A reviewer withdrew their own requirement (setPerformanceInvestigationRequirement required:false). It never overrides policyRequired. */
  explicitlyReleased: boolean
  /** Reported Serious/Catastrophic that TES has not assessed: needs review, but is NOT treated as a TES assessment. */
  reportedSeverityAwaitsAssessment: boolean
}

type RequirementCarrier = NearMissEvent & Pick<FoundationEvent, "investigationRequirement">

/**
 * Locked initial triggers: TES-assessed Serious/Catastrophic, unsafe condition remains = Yes, or a reviewer explicitly marks
 * investigation required. Reported severity alone never triggers. A reviewer release withdraws only a reviewer requirement; it never
 * overrides a policy requirement, and resolving the unsafe condition later does not erase the original policy trigger.
 */
export function evaluateNearMissInvestigationRequirement(event: RequirementCarrier): NearMissInvestigationPolicyResult {
  const severity = getNearMissPotentialSeverity(event)
  const triggers: NearMissInvestigationTrigger[] = []
  if (severity.assessed === "SERIOUS" || severity.assessed === "CATASTROPHIC") triggers.push("TES_ASSESSED_SEVERITY")
  if (getUnsafeConditionState(event) === "YES") triggers.push("UNSAFE_CONDITION_REMAINS")
  const explicit = event.investigationRequirement
  if (explicit?.required) triggers.push("REVIEWER_REQUIRED")
  const explicitlyReleased = explicit?.required === false
  const policyRequired = triggers.includes("TES_ASSESSED_SEVERITY") || triggers.includes("UNSAFE_CONDITION_REMAINS")
  const reviewerRequired = triggers.includes("REVIEWER_REQUIRED")
  return {
    required: policyRequired || reviewerRequired,
    triggers,
    policyRequired,
    reviewerRequired,
    explicitlyReleased,
    reportedSeverityAwaitsAssessment: !severity.assessed && (severity.reported === "SERIOUS" || severity.reported === "CATASTROPHIC"),
  }
}

// ---------------------------------------------------------------------------
// Workflow provider
// ---------------------------------------------------------------------------

/** Source reference for an obligation that comes from one occurrence fact of the event. */
const factSource = (event: Pick<NearMissEvent, "id">, key: string) => ({ type: "EventFact", id: `${event.id}#${key}` })

export const nearMissWorkflowProvider: WorkflowProvider = {
  id: "near-miss",
  collect(foundationEvent: FoundationEvent, state: PerformanceFoundationState): WorkflowObligation[] {
    if (foundationEvent.eventType !== "Near Miss") return []
    const event = foundationEvent as RequirementCarrier
    const out: WorkflowObligation[] = []
    const createdAt = event.createdAt
    const unsafe = getUnsafeConditionState(event)
    const resolution = getUnsafeConditionResolution(event)

    if (unsafe === "YES") {
      out.push(makeObligation("UNSAFE_CONDITION_REMAINS", factSource(event, "unsafeConditionRemains"), Boolean(resolution), { createdAt, resolvedAt: resolution?.resolvedAt, resolvedBy: resolution?.resolvedBy, detail: resolution?.note }))
    } else if (unsafe === "UNKNOWN") {
      // Unknown is never treated as No: it surfaces a clarification review until someone records the outcome.
      out.push(makeObligation("REQUIRED_REVIEW_OUTSTANDING", factSource(event, "unsafeConditionRemains"), Boolean(resolution), { kind: "REVIEW", createdAt, resolvedAt: resolution?.resolvedAt, resolvedBy: resolution?.resolvedBy, detail: "Unsafe-condition status is unknown - clarification needed" }))
    }

    const policy = evaluateNearMissInvestigationRequirement(event)
    const severity = getNearMissPotentialSeverity(event)
    if (severity.reported === "SERIOUS" || severity.reported === "CATASTROPHIC") {
      // The review is resolved only by a genuine TES assessment (any value); the reported value is never promoted to one.
      out.push(makeObligation("REQUIRED_REVIEW_OUTSTANDING", factSource(event, "potentialSeverityReported"), Boolean(severity.assessed), { kind: "REVIEW", createdAt, resolvedAt: severity.assessedAt, resolvedBy: severity.assessedBy, detail: "Reported potential severity awaits TES assessment" }))
    }
    // An explicit reviewer requirement is already surfaced by the generic investigation provider; only add the policy-derived ones.
    if (policy.policyRequired && !policy.reviewerRequired) {
      const investigations = getInvestigationsForEvent(state, event.id)
      const completed = investigations.filter((item: { status: string }) => item.status === "COMPLETED").pop()
      const inProgress = investigations.filter((item: { status: string }) => item.status === "OPEN" || item.status === "AWAITING_INFORMATION").pop()
      if (completed) out.push(makeObligation("INVESTIGATION_INCOMPLETE", { type: "Investigation", id: completed.id }, true, { createdAt, resolvedAt: completed.completedAt, resolvedBy: completed.completedBy }))
      else if (inProgress) out.push(makeObligation("INVESTIGATION_INCOMPLETE", { type: "Investigation", id: inProgress.id }, false, { kind: inProgress.status === "AWAITING_INFORMATION" ? "REVIEW" : "OBLIGATION", createdAt, detail: inProgress.status === "AWAITING_INFORMATION" ? "Awaiting additional information" : undefined }))
      else out.push(makeObligation("INVESTIGATION_INCOMPLETE", factSource(event, "investigationRequired"), false, { createdAt, detail: "Investigation required - not started" }))
    }
    return out
  },
}

export const NEAR_MISS_WORKFLOW_PROVIDERS: readonly WorkflowProvider[] = [...DEFAULT_WORKFLOW_PROVIDERS, nearMissWorkflowProvider]

export function deriveNearMissWorkflow(event: FoundationEvent, state: PerformanceFoundationState) {
  return deriveWorkflow(event, state, NEAR_MISS_WORKFLOW_PROVIDERS)
}

// ---------------------------------------------------------------------------
// Presentation (labels only - never used for business comparisons)
// ---------------------------------------------------------------------------

const SEVERITY_BASIS_LABEL: Record<NearMissSeverityBasis, string> = { TES_ASSESSED: "TES-assessed", SOURCE_REPORTED: "source-reported" }
const severityLabel = (value: string | undefined) => labelIn(T.NEAR_MISS_POTENTIAL_SEVERITIES, value)

const formatEventDate = (iso: string | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "")
  if (!match) return iso || ""
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[Number(match[2]) - 1] || match[2]} ${Number(match[3])}, ${match[1]}`
}

export interface NearMissDescription {
  legacy: boolean
  primaryType: string
  primaryTypeGroup?: string
  secondaryTypes: string[]
  operatingActivity?: string
  timeZone?: string
  otherParty?: string
  otherPartyDescription?: string
  potentialConsequences: string[]
  potentialConsequenceOther?: string
  severity: { reported?: string; assessed?: string; assessedBy?: string; assessedAt?: string; effective?: string; effectiveBasis?: string }
  immediateResponses: string[]
  immediateResponseOther?: string
  unsafeCondition?: string
  unsafeConditionResolution?: string
  reporterDescription?: string
  source?: string
  legacyTriggerSource?: string
  legacyAvoidanceAction?: string
  roadHighway?: string
  directionOfTravel?: string
  measurements: Array<{ label: string; value: string }>
}

const legacyFactValue = (event: NearMissEvent, dataPointId: string, key: string) => text(nearMissFact(event, dataPointId)) || text(event.structuredFacts?.[key])

export function describeNearMiss(event: NearMissEvent): NearMissDescription {
  const legacy = isLegacyNearMiss(event)
  const primary = factText(event, NEAR_MISS_DATA_POINTS.primaryType)
  const legacyType = legacyFactValue(event, NEAR_MISS_DATA_POINTS.legacyType, "nearMissType")
  const severity = getNearMissPotentialSeverity(event)
  const resolution = getUnsafeConditionResolution(event)
  const sourceLabel = text(event.provenance?.source)
  const triggerValue = legacyFactValue(event, NEAR_MISS_DATA_POINTS.legacyTriggerSource, "triggerSource")
  const measurement = (id: string, label: string, unit: string) => {
    const fact = event.structuredEventFacts?.find((item) => item.dataPointId === id)
    return fact ? { label, value: `${fact.value}${fact.unit || unit ? ` ${fact.unit || unit}` : ""}` } : undefined
  }
  const consequences = readNearMissMultiValues(event, T.NEAR_MISS_COLLECTION_IDS.POTENTIAL_CONSEQUENCES)
  const responses = readNearMissMultiValues(event, T.NEAR_MISS_COLLECTION_IDS.IMMEDIATE_RESPONSES)
  return {
    legacy,
    primaryType: primary ? labelIn(T.NEAR_MISS_PRIMARY_TYPES, primary) : legacyType ? `${labelIn(T.LEGACY_NEAR_MISS_TYPES, legacyType)} (legacy)` : "",
    primaryTypeGroup: primary ? T.NEAR_MISS_TYPE_GROUP_BY_VALUE[primary] : undefined,
    secondaryTypes: readNearMissMultiValues(event, T.NEAR_MISS_COLLECTION_IDS.SECONDARY_TYPES).map((value) => labelIn(T.NEAR_MISS_PRIMARY_TYPES, value)),
    operatingActivity: labelIn(T.NEAR_MISS_OPERATING_ACTIVITIES, factText(event, NEAR_MISS_DATA_POINTS.operatingActivity)) || undefined,
    timeZone: factText(event, NEAR_MISS_DATA_POINTS.eventTimeZone) || undefined,
    otherParty: labelIn(T.NEAR_MISS_OTHER_PARTY_TYPES, factText(event, NEAR_MISS_DATA_POINTS.otherPartyType)) || undefined,
    otherPartyDescription: text(nearMissFact(event, "DRV.PERF.OTHERPARTYOBJECT")) || factText(event, NEAR_MISS_DATA_POINTS.otherPartyObject) || text(event.structuredFacts?.otherPartyObject) || undefined,
    potentialConsequences: consequences.map((value) => labelIn(T.NEAR_MISS_POTENTIAL_CONSEQUENCES, value)),
    potentialConsequenceOther: factText(event, NEAR_MISS_DATA_POINTS.potentialConsequenceOther) || undefined,
    severity: {
      reported: severity.reported ? severityLabel(severity.reported) : undefined,
      assessed: severity.assessed ? severityLabel(severity.assessed) : undefined,
      assessedBy: severity.assessedBy,
      assessedAt: severity.assessedAt,
      effective: severity.effective ? severityLabel(severity.effective.value) : undefined,
      effectiveBasis: severity.effective ? SEVERITY_BASIS_LABEL[severity.effective.basis] : undefined,
    },
    immediateResponses: responses.map((value) => labelIn(T.NEAR_MISS_IMMEDIATE_RESPONSES, value)),
    immediateResponseOther: factText(event, NEAR_MISS_DATA_POINTS.immediateResponseOther) || undefined,
    unsafeCondition: labelIn(T.NEAR_MISS_UNSAFE_CONDITION_STATES, factText(event, NEAR_MISS_DATA_POINTS.unsafeConditionRemains)) || undefined,
    unsafeConditionResolution: resolution ? `${resolution.outcome === "RESOLVED" ? "Resolved" : "Clarified: no unsafe condition"}${resolution.resolvedBy ? ` by ${resolution.resolvedBy}` : ""}${resolution.resolvedAt ? ` on ${resolution.resolvedAt.slice(0, 10)}` : ""}` : undefined,
    reporterDescription: factText(event, NEAR_MISS_DATA_POINTS.reporterDescription) || undefined,
    source: sourceLabel || undefined,
    legacyTriggerSource: triggerValue ? labelIn(T.LEGACY_NEAR_MISS_TRIGGER_SOURCES, triggerValue) : undefined,
    legacyAvoidanceAction: legacyFactValue(event, NEAR_MISS_DATA_POINTS.legacyAvoidanceAction, "avoidanceAction") || undefined,
    roadHighway: factText(event, NEAR_MISS_DATA_POINTS.roadHighway) || undefined,
    directionOfTravel: labelIn(T.NEAR_MISS_DIRECTIONS_OF_TRAVEL, factText(event, NEAR_MISS_DATA_POINTS.directionOfTravel)) || undefined,
    measurements: [measurement(NEAR_MISS_DATA_POINTS.distanceToImpact, "Distance to Impact", "m"), measurement(NEAR_MISS_DATA_POINTS.timeToCollision, "Time to Collision", "s"), measurement(NEAR_MISS_DATA_POINTS.speed, "Vehicle Speed", "")].filter((item): item is { label: string; value: string } => Boolean(item)),
  }
}

export interface NearMissSummary {
  title: string
  severityLine?: string
  contextLine: string
}

/** Compact hierarchy: event, potential severity, occurrence context. Workflow state/reasons are rendered from the workflow engine. */
export function buildNearMissSummary(event: NearMissEvent): NearMissSummary {
  const description = describeNearMiss(event)
  const power = event.canonicalLinks?.find((link) => link.relationshipKey === "vehicle" && link.label)?.label
  const place = [text(event.location) || description.roadHighway, text(event.city), text(event.stateProvince)].filter(Boolean).join(", ")
  const severityLine = description.severity.effective ? `Potential Severity: ${description.severity.effective}${description.severity.effectiveBasis === "source-reported" ? " (reported)" : ""}` : undefined
  const contextLine = [formatEventDate(event.eventDate), description.primaryType, power, place].filter(Boolean).join(" · ")
  return { title: "Near Miss", severityLine, contextLine }
}
