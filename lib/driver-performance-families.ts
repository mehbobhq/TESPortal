/**
 * Driver Performance - event families, display titles and Roadside workflow actions.
 *
 * TES Performance records real occurrences. Several stored categories describe
 * the same real-world family (e.g. Cargo Damage / Cargo Theft are both a Cargo
 * Incident). This module is a PRESENTATION layer over the existing category
 * registry: stored `eventType` values are unchanged, so no persisted record is
 * rewritten and every legacy record keeps rendering. It decides how categories
 * are grouped for creation and how an event's human-facing title reads.
 *
 * It also holds the pure Roadside workflow rules (driver statement required /
 * provided, open actions) so the UI and the store enforce the same logic.
 *
 * Pure: no storage access, so it is unit-testable under Node's native runner.
 */

import type { EventType, PerformanceChildCollection } from "@/types/drivers"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { ROADSIDE_OUTCOME_LABELS, deriveRoadsideOverallOutcome } from "./driver-performance-child-facts.ts"

export interface PerformanceEventFamilyMember {
  eventType: EventType
  /** Shown after the family label: "Cargo Incident: Damage". Omitted for single-member families. */
  subtypeLabel?: string
}

export interface PerformanceEventFamily {
  key: string
  label: string
  members: PerformanceEventFamilyMember[]
  /** Only available where TES has the context to establish it; never reported routinely. */
  conditionalCapability?: boolean
}

export const PERFORMANCE_EVENT_FAMILIES: readonly PerformanceEventFamily[] = [
  { key: "COLLISION", label: "Collision", members: [{ eventType: "Collision" }] },
  { key: "NEAR_MISS", label: "Near Miss", members: [{ eventType: "Near Miss" }] },
  { key: "ROADSIDE_INSPECTION", label: "Roadside Inspection", members: [{ eventType: "Roadside Inspection" }] },
  { key: "CARGO_INCIDENT", label: "Cargo Incident", members: [{ eventType: "Cargo Incident" }, { eventType: "Cargo Damage", subtypeLabel: "Damage" }, { eventType: "Cargo Theft", subtypeLabel: "Theft" }] },
  { key: "SPILL_OR_RELEASE", label: "Spill or Release", members: [{ eventType: "Spill or Release" }] },
  { key: "CUSTOMER_EVENT", label: "Customer Event", members: [{ eventType: "Customer Complaint", subtypeLabel: "Complaint" }, { eventType: "Customer Commendation", subtypeLabel: "Commendation" }, { eventType: "Customer-Site Behavior", subtypeLabel: "Site Behavior" }] },
  { key: "SECURITY_INCIDENT", label: "Security Incident", members: [{ eventType: "Security Incident" }] },
  { key: "EQUIPMENT_FAILURE", label: "Equipment Failure / Critical Defect", members: [{ eventType: "Equipment Failure / Critical Defect" }] },
  { key: "DEVICE_DATA_INTEGRITY", label: "Device / Data Integrity", members: [{ eventType: "Device / Data Integrity" }] },
  { key: "HOS_FATIGUE", label: "HOS / Fatigue Related", members: [{ eventType: "Fatigue Indicator", subtypeLabel: "Fatigue Indicator" }] },
  { key: "EMERGENCY_EVENT", label: "Emergency Event", members: [{ eventType: "Emergency Event" }] },
  { key: "SPEEDING", label: "Speeding", members: [{ eventType: "Speeding" }] },
  { key: "HARSH_DRIVING", label: "Harsh Driving Event", members: [{ eventType: "Harsh Braking", subtypeLabel: "Harsh Braking" }, { eventType: "Harsh Acceleration", subtypeLabel: "Harsh Acceleration" }, { eventType: "Harsh Cornering", subtypeLabel: "Harsh Cornering" }] },
  { key: "FOLLOWING_DISTANCE", label: "Following Distance", members: [{ eventType: "Following Distance" }] },
  { key: "DISTRACTED_DRIVING", label: "Distracted Driving", members: [{ eventType: "Distracted Driving" }] },
  { key: "IDLE_TIME", label: "Idle Time", members: [{ eventType: "Idle Time" }] },
  { key: "ROUTE_DEVIATION", label: "Route Deviation", conditionalCapability: true, members: [{ eventType: "Route Deviation" }] },
]

/**
 * Stored categories that no longer represent a top-level event. They stay in the
 * registry (legacy records keep rendering) but are not offered for NEW creation:
 * - Out-of-Service Order / Warning / Violation / Stop Sign / Red Light / Railroad Crossing:
 *   outcomes or findings beneath a Roadside Inspection.
 * - Injury: a consequence of a Collision (road/transport injury only).
 * - Cargo Damage / Cargo Theft: outcome modules of the single Cargo Incident event (history stays readable, never rewritten).
 * - Safety Observation / Trip Completion / Service Performance / Backing: not Performance events.
 */
export const LEGACY_ONLY_PERFORMANCE_EVENT_TYPES: readonly EventType[] = [
  "Out-of-Service Order", "Warning", "Violation", "Stop Sign / Red Light", "Railroad Crossing",
  "Cargo Damage", "Cargo Theft", "Injury", "Safety Observation", "Trip Completion / Service Performance", "Backing", "Lane Departure", "PPE / Safety Protocol",
]

const MEMBER_INDEX = new Map<EventType, { family: PerformanceEventFamily; member: PerformanceEventFamilyMember }>()
for (const family of PERFORMANCE_EVENT_FAMILIES) for (const member of family.members) MEMBER_INDEX.set(member.eventType, { family, member })

export const performanceEventFamilyOf = (eventType: EventType): PerformanceEventFamily | undefined => MEMBER_INDEX.get(eventType)?.family

export const isLegacyOnlyPerformanceEventType = (eventType: EventType): boolean => LEGACY_ONLY_PERFORMANCE_EVENT_TYPES.includes(eventType)

export interface FactKeyField { key: string; dataPointId: string }

/** Rebuilds a { fieldKey: value } map from an event's structured facts using the category's field list. */
export function eventFactsByKey(event: { structuredEventFacts?: Array<{ dataPointId: string; value: unknown }> }, fields: readonly FactKeyField[]): Record<string, unknown> {
  return Object.fromEntries((event.structuredEventFacts || []).map((fact) => [fields.find((field) => field.dataPointId === fact.dataPointId)?.key || fact.dataPointId, fact.value]))
}

/** Human-facing Roadside Overall Outcome label, or undefined when it cannot be established. */
export function roadsideOverallOutcomeLabel(factsByKey: Record<string, unknown>, violations: PerformanceChildCollection | undefined): string | undefined {
  const outcome = deriveRoadsideOverallOutcome(factsByKey, violations)
  return outcome === "UNKNOWN" ? undefined : ROADSIDE_OUTCOME_LABELS[outcome]
}

/**
 * Human-facing event title. Stored `eventType` is never altered.
 * - Roadside Inspection: "Roadside Inspection: <Overall Outcome>" (plain title when the outcome is unknown)
 * - Family members with a subtype: "Cargo Incident: Damage"
 * - Everything else (including legacy categories): the stored category name.
 */
export function performanceEventTitle(eventType: EventType, roadsideOutcomeLabel?: string): string {
  if (eventType === "Roadside Inspection") return roadsideOutcomeLabel ? `Roadside Inspection: ${roadsideOutcomeLabel}` : "Roadside Inspection"
  const entry = MEMBER_INDEX.get(eventType)
  if (entry?.member.subtypeLabel) return `${entry.family.label}: ${entry.member.subtypeLabel}`
  return eventType
}

// ---------------------------------------------------------------------------
// Roadside workflow: Driver Statement and open actions
// ---------------------------------------------------------------------------

export const ROADSIDE_STATEMENT_COLLECTION = "DRV.PERF.ROADSIDE_INSPECTION.DRIVER_STATEMENTS"

export interface RoadsideStatementState {
  /** Required by a recorded determination (reviewer / policy) or because a statement was formally requested. Never derived from Overall Outcome. */
  required: boolean
  /** A statement has actually been obtained. Separate concept from `required`. */
  provided: boolean
}

export function roadsideDriverStatementState(event: { childCollections?: PerformanceChildCollection[] }, factsByKey: Record<string, unknown>): RoadsideStatementState {
  const items = event.childCollections?.find((collection) => collection.collectionId === ROADSIDE_STATEMENT_COLLECTION)?.items || []
  const provided = items.some((item) => item.facts.status === "OBTAINED")
  const requested = items.some((item) => item.facts.status === "REQUESTED")
  return { required: factsByKey.driverStatementRequired === "YES" || requested, provided }
}

export interface RoadsideOpenAction {
  key: "DRIVER_STATEMENT" | "FOLLOW_UP"
  label: string
}

/**
 * Required actions still outstanding on a Roadside Inspection. Citations are
 * deliberately NOT included: a Citation has its own lifecycle and never gates
 * Roadside closure.
 */
export function getRoadsideOpenActions(event: { childCollections?: PerformanceChildCollection[]; followUpActionRequired?: boolean }, factsByKey: Record<string, unknown>): RoadsideOpenAction[] {
  const actions: RoadsideOpenAction[] = []
  const statement = roadsideDriverStatementState(event, factsByKey)
  if (statement.required && !statement.provided) actions.push({ key: "DRIVER_STATEMENT", label: "Driver Statement required - not yet provided" })
  if (event.followUpActionRequired) actions.push({ key: "FOLLOW_UP", label: "Follow-up action outstanding" })
  return actions
}

/** Workflow status for a newly recorded Roadside Inspection: Open while any required action is outstanding, otherwise Closed. */
export const initialRoadsideStatus = (openActions: readonly RoadsideOpenAction[]): "Open" | "Closed" => (openActions.length ? "Open" : "Closed")
