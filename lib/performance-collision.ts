/**
 * Collision - one parent Performance Event with related child structures.
 *
 * Collision owns OCCURRENCE facts and Collision-specific structure (classification, event sequence, involved parties, immediate
 * outcomes, injured persons, driver statement). Preventability, responsibility, root cause, contributing factors, investigation
 * conclusions and corrective actions belong to the common investigation engine and are NOT duplicated here.
 *
 * Pure functions over the stored event shape. Business logic compares canonical values; label helpers are presentation only.
 * Legacy records (collisionDetails / the old flat facts) stay readable and are never rewritten.
 */

import type { PerformanceChildCollection, PerformanceChildFactItem, PerformanceEventRecord, StructuredEventFact } from "@/types/drivers"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import * as taxonomy from "./performance-collision-taxonomy.ts"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { NEAR_MISS_DIRECTIONS_OF_TRAVEL } from "./performance-near-miss-taxonomy.ts"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { isValidIanaTimeZone } from "./performance-near-miss.ts"
import type { FoundationEvent, PerformanceFoundationState } from "@/lib/performance-foundation-state"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { makeObligation } from "./performance-workflow.ts"
import type { WorkflowObligation, WorkflowProvider } from "@/lib/performance-workflow"
type Option = { value: string; label: string }
const T = taxonomy as {
  COLLISION_TYPES: readonly Option[]; COLLISION_MANNERS: readonly Option[]; COLLISION_FIRST_HARMFUL_EVENTS: readonly Option[]
  COLLISION_DRIVER_ACTIVITIES: readonly Option[]; COLLISION_DRIVER_ACTIONS: readonly Option[]; COLLISION_VISIBILITY: readonly Option[]; COLLISION_TRAFFIC: readonly Option[]
  COLLISION_YES_NO_UNKNOWN: readonly Option[]; COLLISION_INJURY_STATUSES: readonly Option[]; COLLISION_POLICE_RESPONSES: readonly Option[]; COLLISION_ENFORCEMENT: readonly Option[]
  COLLISION_CARGO_IMPACT: readonly Option[]; COLLISION_HAZMAT: readonly Option[]; COLLISION_REPORTABILITY: readonly Option[]; COLLISION_SEQUENCE_EVENTS: readonly Option[]
  COLLISION_PARTY_ROLES: readonly Option[]; COLLISION_OTHER_PARTY_TYPES: readonly Option[]; COLLISION_DAMAGE_STATUSES: readonly Option[]; COLLISION_DRIVABILITY: readonly Option[]
  COLLISION_TOW_STATUSES: readonly Option[]; COLLISION_IMPACT_POINTS: readonly Option[]; COLLISION_SPEED_UNITS: readonly Option[]; COLLISION_PERSON_ROLES: readonly Option[]
  COLLISION_INJURY_SEVERITIES: readonly Option[]; COLLISION_TREATMENT_STATUSES: readonly Option[]; COLLISION_ACCESS_CLASSES: readonly Option[]
  COLLISION_STATEMENT_STATUSES: readonly Option[]; COLLISION_STATEMENT_METHODS: readonly Option[]; COLLISION_SOURCES: readonly Option[]; LEGACY_COLLISION_CONFIGURATIONS: readonly Option[]
  COLLISION_COLLECTION_IDS: Readonly<Record<"EVENT_SEQUENCE" | "INVOLVED_PARTIES" | "INJURED_PERSONS" | "DRIVER_STATEMENTS", string>>
  collisionOptionLabel: (list: readonly Option[], value: string | null | undefined) => string
  collisionValues: (list: readonly Option[]) => string[]
}
const DIRECTIONS = NEAR_MISS_DIRECTIONS_OF_TRAVEL as readonly Option[]

export type CollisionEvent = Pick<PerformanceEventRecord, "id" | "eventType"> &
  Partial<Pick<PerformanceEventRecord, "driverMasterId" | "eventDate" | "eventTime" | "location" | "city" | "stateProvince" | "country" | "vehicleId" | "canonicalLinks" | "structuredEventFacts" | "structuredFacts" | "childCollections" | "evidenceIds" | "provenance" | "summary" | "createdAt" | "collisionDetails">>

/** Stable data point ids (mirrors lib/driver-performance-schema.ts; a test asserts they match the registry). */
export const COLLISION_DATA_POINTS = {
  classType: "DRV.PERF.COLLISION.CLASS_TYPE", manner: "DRV.PERF.COLLISION.MANNER", firstHarmfulEvent: "DRV.PERF.COLLISION.FIRST_HARMFUL_EVENT",
  driverActivity: "DRV.PERF.COLLISION.DRIVER_ACTIVITY", driverAction: "DRV.PERF.COLLISION.DRIVER_ACTION",
  eventTimeZone: "DRV.PERF.COLLISION.EVENT_TIME_ZONE", roadHighway: "DRV.PERF.COLLISION.ROAD_HIGHWAY", directionOfTravel: "DRV.PERF.COLLISION.DIRECTION_OF_TRAVEL",
  weather: "DRV.PERF.SHARED.WEATHER_CONDITION", roadCondition: "DRV.PERF.SHARED.ROAD_SURFACE", lightCondition: "DRV.PERF.SHARED.LIGHTING_CONDITION",
  visibility: "DRV.PERF.COLLISION.VISIBILITY", traffic: "DRV.PERF.COLLISION.TRAFFIC", workZone: "DRV.PERF.COLLISION.WORK_ZONE", speed: "DRV.PERF.COLLISION.SPEEDATOCCURRENCE",
  injuryStatus: "DRV.PERF.COLLISION.INJURY_STATUS", policeResponse: "DRV.PERF.COLLISION.POLICE_RESPONSE", policeReportReference: "DRV.PERF.COLLISION.POLICE_REPORT_REFERENCE",
  enforcement: "DRV.PERF.COLLISION.ENFORCEMENT", cargoImpact: "DRV.PERF.COLLISION.CARGO_IMPACT", hazmat: "DRV.PERF.COLLISION.HAZMAT", serviceInterruption: "DRV.PERF.COLLISION.SERVICE_INTERRUPTION",
  downtimeHours: "DRV.PERF.COLLISION.DOWNTIMEHOURS", reportability: "DRV.PERF.COLLISION.REPORTABILITYRESULT", driverStatementRequired: "DRV.PERF.COLLISION.DRIVER_STATEMENT_REQUIRED",
  legacyConfiguration: "DRV.PERF.COLLISION.COLLISIONTYPE", legacyOtherParty: "DRV.PERF.COLLISION.OTHERPARTYOBJECT", legacyInjuries: "DRV.PERF.COLLISION.INJURIESCOUNT", legacyFatalities: "DRV.PERF.COLLISION.FATALITIESCOUNT",
  legacyTow: "DRV.PERF.COLLISION.TOWREQUIRED", legacyPolice: "DRV.PERF.COLLISION.POLICEATTENDED", legacyPropertyDamage: "DRV.PERF.COLLISION.PROPERTYDAMAGE",
  legacyDriverStatement: "DRV.PERF.COLLISION.DRIVERSTATEMENT", legacyInvestigationNotes: "DRV.PERF.COLLISION.INVESTIGATIONNOTES",
} as const

const LEGACY_FACT_IDS = [COLLISION_DATA_POINTS.legacyConfiguration, COLLISION_DATA_POINTS.legacyOtherParty, COLLISION_DATA_POINTS.legacyInjuries, COLLISION_DATA_POINTS.legacyFatalities, COLLISION_DATA_POINTS.legacyTow, COLLISION_DATA_POINTS.legacyPolice, COLLISION_DATA_POINTS.legacyPropertyDamage, COLLISION_DATA_POINTS.legacyDriverStatement, COLLISION_DATA_POINTS.legacyInvestigationNotes]

const CID = T.COLLISION_COLLECTION_IDS
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")
const label = (list: readonly Option[], value: unknown) => T.collisionOptionLabel(list, typeof value === "string" ? value : undefined)
const inList = (list: readonly Option[], value: string) => T.collisionValues(list).includes(value)

export function collisionFact(event: Pick<CollisionEvent, "structuredEventFacts">, dataPointId: string): StructuredEventFact["value"] | undefined {
  return event.structuredEventFacts?.find((fact) => fact.dataPointId === dataPointId)?.value
}
const factText = (event: CollisionEvent, id: string) => text(collisionFact(event, id))
const factNumber = (event: CollisionEvent, id: string) => { const value = collisionFact(event, id); return typeof value === "number" ? value : undefined }

/** New-taxonomy records carry the Collision Type data point; everything else is legacy. */
export const isNewTaxonomyCollision = (event: CollisionEvent) => Boolean(factText(event, COLLISION_DATA_POINTS.classType))
export const isLegacyCollision = (event: CollisionEvent) => event.eventType === "Collision" && !isNewTaxonomyCollision(event)

// ---------------------------------------------------------------------------
// Child collections (PerformanceChildCollection; array position is never the ordering authority for the sequence)
// ---------------------------------------------------------------------------

const newItemId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`
const unique = (items: readonly string[] | undefined) => [...new Set((items || []).filter(Boolean))]
const collectionOf = (event: Pick<CollisionEvent, "childCollections">, id: string) => event.childCollections?.find((collection) => collection.collectionId === id)

export interface CollisionSequenceInput { itemId?: string; ordinal: number; eventValue?: string; description?: string; notes?: string; evidenceIds?: string[] }
export interface CollisionPartyInput {
  itemId?: string; role: string; linkedVehicleId?: string; partyType?: string; description?: string; identifier?: string
  damageStatus?: string; drivability?: string; towStatus?: string; speed?: number | null; speedUnit?: string; impactPoint?: string; evidenceIds?: string[]
}
export interface CollisionPersonInput {
  itemId?: string; role: string; name?: string; linkedPartyId?: string; injurySeverity?: string; transportedFromScene?: string; treatmentStatus?: string
  facility?: string; fatalityDate?: string; notes?: string; accessClassification?: string; evidenceIds?: string[]
}
export interface CollisionStatementInput { itemId?: string; status: string; date?: string; time?: string; method?: string; content?: string; source?: string; evidenceIds?: string[] }

const nullable = (value: unknown): string | number | null => (typeof value === "number" ? value : text(value) || null)

function build(collectionId: string, itemType: string, items: PerformanceChildFactItem[]): PerformanceChildCollection | undefined {
  return items.length ? { collectionId, collectionVersion: "1.0", itemType, completeness: "COMPLETE", items } : undefined
}

export const buildCollisionSequenceCollection = (inputs: readonly CollisionSequenceInput[]) => build(CID.EVENT_SEQUENCE, "COLLISION_SEQUENCE_STEP", inputs.map((input) => ({
  itemId: input.itemId || newItemId("CSQ"), evidenceIds: unique(input.evidenceIds),
  facts: { ordinal: input.ordinal, eventValue: nullable(input.eventValue), description: nullable(input.description), notes: nullable(input.notes) },
})))

export const buildCollisionPartiesCollection = (inputs: readonly CollisionPartyInput[]) => build(CID.INVOLVED_PARTIES, "COLLISION_INVOLVED_PARTY", inputs.map((input) => ({
  itemId: input.itemId || newItemId("CPT"), evidenceIds: unique(input.evidenceIds),
  facts: { role: input.role, linkedVehicleId: nullable(input.linkedVehicleId), partyType: nullable(input.partyType), description: nullable(input.description), identifier: nullable(input.identifier), damageStatus: nullable(input.damageStatus), drivability: nullable(input.drivability), towStatus: nullable(input.towStatus), speed: typeof input.speed === "number" ? input.speed : null, speedUnit: nullable(input.speedUnit), impactPoint: nullable(input.impactPoint) },
})))

export const buildCollisionPersonsCollection = (inputs: readonly CollisionPersonInput[]) => build(CID.INJURED_PERSONS, "COLLISION_INJURED_PERSON", inputs.map((input) => ({
  itemId: input.itemId || newItemId("CIP"), evidenceIds: unique(input.evidenceIds),
  facts: { role: input.role, name: nullable(input.name), linkedPartyId: nullable(input.linkedPartyId), injurySeverity: nullable(input.injurySeverity), transportedFromScene: nullable(input.transportedFromScene), treatmentStatus: nullable(input.treatmentStatus), facility: nullable(input.facility), fatalityDate: nullable(input.fatalityDate), notes: nullable(input.notes), accessClassification: nullable(input.accessClassification) },
})))

export const buildCollisionStatementCollection = (inputs: readonly CollisionStatementInput[]) => build(CID.DRIVER_STATEMENTS, "COLLISION_DRIVER_STATEMENT", inputs.map((input) => {
  const itemId = input.itemId || newItemId("CST")
  return {
    itemId, evidenceIds: unique(input.evidenceIds),
    facts: { status: input.status, date: nullable(input.date), time: nullable(input.time), method: nullable(input.method), content: nullable(input.content), source: nullable(input.source) },
    provenance: { sourceType: "SOURCE_FACT" as const, source: text(input.source) || "Driver Statement", capturedAt: new Date().toISOString(), ingestionTimestamp: new Date().toISOString(), sourceConfidence: "UNKNOWN" as const, dataQuality: "UNKNOWN" as const },
  }
}))

const factsOf = (item: PerformanceChildFactItem, key: string) => item.facts[key]
const str = (item: PerformanceChildFactItem, key: string) => text(factsOf(item, key))

export function readCollisionSequence(event: Pick<CollisionEvent, "childCollections">) {
  const items = collectionOf(event, CID.EVENT_SEQUENCE)?.items || []
  return items.map((item) => ({ itemId: item.itemId, ordinal: Number(item.facts.ordinal), eventValue: str(item, "eventValue"), description: str(item, "description"), notes: str(item, "notes"), evidenceIds: item.evidenceIds }))
    .sort((a, b) => a.ordinal - b.ordinal || a.itemId.localeCompare(b.itemId))
}
export function readCollisionParties(event: Pick<CollisionEvent, "childCollections">) {
  return (collectionOf(event, CID.INVOLVED_PARTIES)?.items || []).map((item) => ({
    itemId: item.itemId, role: str(item, "role"), linkedVehicleId: str(item, "linkedVehicleId"), partyType: str(item, "partyType"), description: str(item, "description"), identifier: str(item, "identifier"),
    damageStatus: str(item, "damageStatus"), drivability: str(item, "drivability"), towStatus: str(item, "towStatus"), speed: typeof item.facts.speed === "number" ? item.facts.speed : undefined, speedUnit: str(item, "speedUnit"), impactPoint: str(item, "impactPoint"), evidenceIds: item.evidenceIds,
  }))
}
export function readCollisionPersons(event: Pick<CollisionEvent, "childCollections">) {
  return (collectionOf(event, CID.INJURED_PERSONS)?.items || []).map((item) => ({
    itemId: item.itemId, role: str(item, "role"), name: str(item, "name"), linkedPartyId: str(item, "linkedPartyId"), injurySeverity: str(item, "injurySeverity"), transportedFromScene: str(item, "transportedFromScene"),
    treatmentStatus: str(item, "treatmentStatus"), facility: str(item, "facility"), fatalityDate: str(item, "fatalityDate"), notes: str(item, "notes"), accessClassification: str(item, "accessClassification"), evidenceIds: item.evidenceIds,
  }))
}
export function readCollisionStatements(event: Pick<CollisionEvent, "childCollections">) {
  return (collectionOf(event, CID.DRIVER_STATEMENTS)?.items || []).map((item) => ({
    itemId: item.itemId, status: str(item, "status"), date: str(item, "date"), time: str(item, "time"), method: str(item, "method"), content: str(item, "content"), source: str(item, "source"), evidenceIds: item.evidenceIds,
  }))
}

// ---------------------------------------------------------------------------
// Validation (NEW records only; legacy records are never held to these rules)
// ---------------------------------------------------------------------------

export type NewCollisionCandidate = CollisionEvent & { driverMasterId?: string }

const MEDICAL_PERSON_FIELDS = ["injurySeverity", "transportedFromScene", "treatmentStatus", "facility", "fatalityDate", "notes"] as const
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const hasDuplicates = (items: readonly string[]) => items.some((item, index) => items.indexOf(item) !== index)

export type CollisionValidationStep = "OCCURRENCE" | "COLLISION_FACTS" | "COLLISION_PARTIES" | "COLLISION_ENVIRONMENT" | "COLLISION_OUTCOMES" | "COLLISION_INJURIES" | "EVIDENCE" | "REVIEW"
export interface CollisionValidationIssue { step: CollisionValidationStep; message: string }

export const validateNewCollision = (data: NewCollisionCandidate): string[] => validateNewCollisionDetailed(data).map((issue) => issue.message)

/** Same rules, each issue tagged with the wizard step that owns it so the UI can surface the right one. */
export function validateNewCollisionDetailed(data: NewCollisionCandidate): CollisionValidationIssue[] {
  const issues: CollisionValidationIssue[] = []
  let step: CollisionValidationStep = "OCCURRENCE"
  const err = (message: string) => { issues.push({ step, message }) }
  const f = (id: string) => factText(data, id)
  const checkControlled = (id: string, list: readonly Option[], name: string, required = false) => {
    const value = f(id)
    if (!value) { if (required) err(`${name} is required.`); return }
    if (!inList(list, value)) err(`${name} must be a controlled value.`)
  }
  if (!text(data.eventDate)) err("Event Date is required.")
  if (!text(data.eventTime)) err("Event Time is required.")
  if (!text(data.driverMasterId)) err("Driver is required.")
  const powerUnitId = text(data.vehicleId) || text(data.canonicalLinks?.find((link) => link.relationshipKey === "vehicle" && link.entityType === "Vehicle")?.recordId)
  step = "COLLISION_PARTIES"
  if (!powerUnitId) err("Power Unit is required.")
  step = "OCCURRENCE"
  if (!text(data.location)) err("Location is required.")
  if (!text(data.country)) err("Country is required.")
  if (!inList(T.COLLISION_SOURCES, text(data.provenance?.source))) err("Source is required and must be a Collision source.")

  step = "COLLISION_FACTS"
  checkControlled(COLLISION_DATA_POINTS.classType, T.COLLISION_TYPES, "Collision Type", true)
  checkControlled(COLLISION_DATA_POINTS.manner, T.COLLISION_MANNERS, "Manner of Collision", true)
  checkControlled(COLLISION_DATA_POINTS.firstHarmfulEvent, T.COLLISION_FIRST_HARMFUL_EVENTS, "First Harmful Event", true)
  checkControlled(COLLISION_DATA_POINTS.driverActivity, T.COLLISION_DRIVER_ACTIVITIES, "Driver Activity")
  checkControlled(COLLISION_DATA_POINTS.driverAction, T.COLLISION_DRIVER_ACTIONS, "Driver Action")
  step = "COLLISION_ENVIRONMENT"
  checkControlled(COLLISION_DATA_POINTS.visibility, T.COLLISION_VISIBILITY, "Visibility")
  checkControlled(COLLISION_DATA_POINTS.traffic, T.COLLISION_TRAFFIC, "Traffic")
  checkControlled(COLLISION_DATA_POINTS.workZone, T.COLLISION_YES_NO_UNKNOWN, "Work Zone")
  step = "OCCURRENCE"
  checkControlled(COLLISION_DATA_POINTS.directionOfTravel, DIRECTIONS, "Direction of Travel")
  step = "COLLISION_OUTCOMES"
  checkControlled(COLLISION_DATA_POINTS.injuryStatus, T.COLLISION_INJURY_STATUSES, "Injury Status", true)
  checkControlled(COLLISION_DATA_POINTS.policeResponse, T.COLLISION_POLICE_RESPONSES, "Police Response")
  checkControlled(COLLISION_DATA_POINTS.enforcement, T.COLLISION_ENFORCEMENT, "Enforcement")
  checkControlled(COLLISION_DATA_POINTS.cargoImpact, T.COLLISION_CARGO_IMPACT, "Cargo")
  checkControlled(COLLISION_DATA_POINTS.hazmat, T.COLLISION_HAZMAT, "Hazmat")
  checkControlled(COLLISION_DATA_POINTS.serviceInterruption, T.COLLISION_YES_NO_UNKNOWN, "Service Interruption")
  checkControlled(COLLISION_DATA_POINTS.reportability, T.COLLISION_REPORTABILITY, "Reportability Determination")
  checkControlled(COLLISION_DATA_POINTS.driverStatementRequired, T.COLLISION_YES_NO_UNKNOWN.filter((item) => item.value !== "UNKNOWN"), "Driver Statement Required")
  step = "OCCURRENCE"
  const zone = f(COLLISION_DATA_POINTS.eventTimeZone)
  if (zone && !isValidIanaTimeZone(zone)) err("Time Zone must be an IANA identifier such as America/Edmonton.")
  step = "REVIEW"
  for (const id of LEGACY_FACT_IDS) if (collisionFact(data, id) !== undefined) { err("Legacy Collision fields cannot be written on a new record; use the structured classification, outcomes, parties, injured persons and statement."); break }

  const evidence = new Set(data.evidenceIds || [])
  const refs = (ids: readonly string[], where: string) => { for (const id of ids) if (!evidence.has(id)) err(`${where} references evidence that is not linked to this Collision: ${id}.`) }

  // Parties & equipment
  step = "COLLISION_PARTIES"
  const parties = readCollisionParties(data)
  const partyIds = parties.map((party) => party.itemId)
  if (hasDuplicates(partyIds) || partyIds.some((id) => !id)) err("Involved-party record ids must be present and unique.")
  const powerUnits = parties.filter((party) => party.role === "CARRIER_POWER_UNIT")
  if (powerUnits.length !== 1) err("Exactly one Carrier Power Unit party record is required.")
  else if (powerUnitId && powerUnits[0].linkedVehicleId !== powerUnitId) err("The Carrier Power Unit party must reference the selected Power Unit.")
  const trailerLinks = new Set((data.canonicalLinks || []).filter((link) => link.relationshipKey === "trailer").map((link) => link.recordId))
  for (const party of parties) {
    if (!inList(T.COLLISION_PARTY_ROLES, party.role)) { err("Involved-party role must be a controlled value."); continue }
    if (party.role === "CARRIER_TRAILER" && !trailerLinks.has(party.linkedVehicleId)) err("A Carrier Trailer party must reference a linked Trailer.")
    if (party.role !== "OTHER_PARTY" && !party.linkedVehicleId) err("Carrier equipment parties must reference a canonical Vehicle.")
    if (party.role === "OTHER_PARTY") {
      if (party.linkedVehicleId) err("An other-party record must not reference a canonical company Vehicle.")
      if (!party.partyType) err("Other-party type is required.")
      else if (!inList(T.COLLISION_OTHER_PARTY_TYPES, party.partyType)) err("Other-party type must be a controlled value.")
      if (party.partyType === "OTHER" && !party.description) err("Describe the Other party / object.")
    }
    if (party.damageStatus && !inList(T.COLLISION_DAMAGE_STATUSES, party.damageStatus)) err("Damage status must be a controlled value.")
    if (party.drivability && !inList(T.COLLISION_DRIVABILITY, party.drivability)) err("Drivability must be a controlled value.")
    if (party.towStatus && !inList(T.COLLISION_TOW_STATUSES, party.towStatus)) err("Tow status must be a controlled value.")
    if (party.impactPoint && !inList(T.COLLISION_IMPACT_POINTS, party.impactPoint)) err("Impact point must be a controlled value.")
    if (party.speed !== undefined) {
      if (!(party.speed >= 0)) err("Party speed must be zero or greater.")
      if (!inList(T.COLLISION_SPEED_UNITS, party.speedUnit)) err("Party speed requires an explicit unit (MPH or KMH).")
    }
    refs(party.evidenceIds, "An involved party")
  }

  // Event sequence
  step = "COLLISION_FACTS"
  const sequence = readCollisionSequence(data)
  const sequenceItems = collectionOf(data, CID.EVENT_SEQUENCE)?.items || []
  if (hasDuplicates(sequenceItems.map((item) => item.itemId))) err("Event sequence item ids must be unique.")
  const ordinals = sequence.map((step) => step.ordinal)
  if (ordinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1)) err("Event sequence ordinals must be positive whole numbers.")
  if (hasDuplicates(ordinals.map(String))) err("Event sequence ordinals must be unique.")
  for (const step of sequence) {
    if (!step.eventValue && !step.description) err("Each event sequence step needs a controlled event or a description.")
    if (step.eventValue && !inList(T.COLLISION_SEQUENCE_EVENTS, step.eventValue)) err("Event sequence event must be a controlled value.")
    refs(step.evidenceIds, "An event sequence step")
  }

  // Injured persons
  step = "COLLISION_INJURIES"
  const persons = readCollisionPersons(data)
  const personItems = collectionOf(data, CID.INJURED_PERSONS)?.items || []
  if (hasDuplicates(personItems.map((item) => item.itemId))) err("Injured-person record ids must be unique.")
  const injuryStatus = f(COLLISION_DATA_POINTS.injuryStatus)
  for (const person of persons) {
    if (!inList(T.COLLISION_PERSON_ROLES, person.role)) err("Injured-person role must be a controlled value.")
    if (person.injurySeverity && !inList(T.COLLISION_INJURY_SEVERITIES, person.injurySeverity)) err("Injury severity must be a controlled value.")
    if (person.treatmentStatus && !inList(T.COLLISION_TREATMENT_STATUSES, person.treatmentStatus)) err("Treatment status must be a controlled value.")
    if (person.transportedFromScene && !inList(T.COLLISION_YES_NO_UNKNOWN, person.transportedFromScene)) err("Transported-from-scene must be Yes, No or Unknown.")
    if (person.linkedPartyId && !partyIds.includes(person.linkedPartyId)) err("An injured person references an involved party that does not exist.")
    const hasMedical = MEDICAL_PERSON_FIELDS.some((key) => Boolean(person[key]))
    if (hasMedical && !person.accessClassification) err("Person-level medical information requires an access classification.")
    if (person.accessClassification && !inList(T.COLLISION_ACCESS_CLASSES, person.accessClassification)) err("Access classification must be a controlled value.")
    if (person.fatalityDate) {
      if (person.injurySeverity !== "FATAL") err("A fatality date requires a Fatal injury severity.")
      if (!ISO_DATE.test(person.fatalityDate)) err("Fatality date must be a valid date.")
      else if (text(data.eventDate) && person.fatalityDate < text(data.eventDate)) err("Fatality date cannot be before the Collision date.")
    }
    refs(person.evidenceIds, "An injured person")
  }
  if (persons.length && injuryStatus === "NO_INJURY_REPORTED") err("Injured persons cannot be recorded when Injury Status is No injury reported.")
  const fatal = persons.filter((person) => person.injurySeverity === "FATAL").length
  if (fatal && injuryStatus !== "FATALITY_REPORTED") err("A fatal injured person requires Injury Status = Fatality reported.")
  if (injuryStatus === "FATALITY_REPORTED" && persons.length && !fatal) err("Injury Status is Fatality reported but no injured person is recorded as fatal.")

  // Driver statement
  step = "EVIDENCE"
  const statements = readCollisionStatements(data)
  const statementItems = collectionOf(data, CID.DRIVER_STATEMENTS)?.items || []
  if (statements.length > 1) err("A Collision records at most one Driver Statement.")
  if (hasDuplicates(statementItems.map((item) => item.itemId))) err("Driver statement ids must be unique.")
  for (const statement of statements) {
    if (!inList(T.COLLISION_STATEMENT_STATUSES, statement.status)) err("Driver Statement status must be a controlled value.")
    if (statement.method && !inList(T.COLLISION_STATEMENT_METHODS, statement.method)) err("Driver Statement method must be a controlled value.")
    if (statement.status === "OBTAINED" && !statement.content) err("Driver Statement content is required when the status is Obtained.")
    if (statement.status === "OBTAINED" && !statement.method) err("Driver Statement method is required when the status is Obtained.")
    if (statement.method === "UPLOADED_DOCUMENT" && !statement.evidenceIds.length) err("An uploaded-document Driver Statement must reference its evidence.")
    refs(statement.evidenceIds, "The Driver Statement")
  }
  return issues
}

// ---------------------------------------------------------------------------
// Derived injury counts (never overwrite legacy numeric counts)
// ---------------------------------------------------------------------------

export interface CollisionInjuryCounts { injured: number; fatalities: number; source: "PERSON_RECORDS" | "LEGACY_COUNTS" }

export function deriveCollisionInjuryCounts(event: CollisionEvent): CollisionInjuryCounts | undefined {
  if (isNewTaxonomyCollision(event)) {
    const persons = readCollisionPersons(event)
    if (!persons.length) return undefined
    const fatalities = persons.filter((person) => person.injurySeverity === "FATAL").length
    return { injured: persons.length - fatalities, fatalities, source: "PERSON_RECORDS" }
  }
  const injured = factNumber(event, COLLISION_DATA_POINTS.legacyInjuries) ?? event.collisionDetails?.injuriesCount
  const fatalities = factNumber(event, COLLISION_DATA_POINTS.legacyFatalities) ?? event.collisionDetails?.fatalitiesCount
  if (injured === undefined && fatalities === undefined) return undefined
  return { injured: injured ?? 0, fatalities: fatalities ?? 0, source: "LEGACY_COUNTS" }
}

/** Reportability is a manual determination: never derived from other facts. */
export const getCollisionReportability = (event: CollisionEvent): "REPORTABLE" | "NOT_REPORTABLE" | "UNABLE_TO_DETERMINE" | "NOT_RECORDED" => {
  const value = factText(event, COLLISION_DATA_POINTS.reportability)
  if (value === "REPORTABLE" || value === "NOT_REPORTABLE" || value === "UNABLE_TO_DETERMINE") return value
  if (event.collisionDetails?.dotReportable !== undefined) return event.collisionDetails.dotReportable ? "REPORTABLE" : "NOT_REPORTABLE"
  return "NOT_RECORDED"
}

// ---------------------------------------------------------------------------
// Workflow provider (registered with the common workflow engine)
// ---------------------------------------------------------------------------

const factSource = (event: Pick<CollisionEvent, "id">, key: string) => ({ type: "EventFact", id: `${event.id}#${key}` })

export const collisionWorkflowProvider: WorkflowProvider = {
  id: "collision",
  collect(foundationEvent: FoundationEvent, state: PerformanceFoundationState): WorkflowObligation[] {
    if (foundationEvent.eventType !== "Collision") return []
    const event = foundationEvent as CollisionEvent & FoundationEvent
    const out: WorkflowObligation[] = []
    const createdAt = event.createdAt
    // A Collision existing by itself creates NO obligation. Investigation, reviewer requirements, required Company Actions and
    // verification come from the common providers; the only Collision-specific obligation is an explicitly required Driver Statement.
    if (factText(event, COLLISION_DATA_POINTS.driverStatementRequired) === "YES") {
      const obtained = readCollisionStatements(event).find((statement) => statement.status === "OBTAINED")
      out.push(makeObligation("DRIVER_STATEMENT_REQUIRED", factSource(event, "driverStatementRequired"), Boolean(obtained), { createdAt, resolvedAt: obtained ? `${obtained.date || ""}`.trim() || undefined : undefined }))
    }
    return out
  },
}

// ---------------------------------------------------------------------------
// Presentation (labels only; never used for business comparisons)
// ---------------------------------------------------------------------------

export interface CollisionDescription {
  legacy: boolean
  classification: { type?: string; manner?: string; firstHarmfulEvent?: string; driverActivity?: string; driverAction?: string; legacyConfiguration?: string }
  sequence: Array<{ ordinal: number; event?: string; description?: string; notes?: string; evidenceCount: number }>
  parties: Array<{ id: string; role: string; carrier: boolean; vehicle?: string; type?: string; description?: string; identifier?: string; damage?: string; drivability?: string; tow?: string; speed?: string; impact?: string }>
  environment: { timeZone?: string; roadHighway?: string; direction?: string; visibility?: string; traffic?: string; workZone?: string }
  outcomes: { injuryStatus?: string; police?: string; policeReference?: string; enforcement?: string; cargo?: string; hazmat?: string; serviceInterruption?: string; downtimeHours?: number; reportability?: string }
  injuredPersons: Array<{ id: string; role: string; name?: string; severity?: string; transported?: string; treatment?: string; facility?: string; fatalityDate?: string; notes?: string; accessClass?: string; party?: string }>
  injuryCounts?: CollisionInjuryCounts
  statement?: { status: string; date?: string; time?: string; method?: string; content?: string; source?: string }
  statementRequired?: boolean
  legacyDetails?: { driverStatement?: string; investigationNarrative?: string; otherParty?: string; tow?: string; propertyDamage?: string; police?: string; policeReportNumber?: string; estimatedCost?: string; witnessStatements?: string; reportability?: string }
}

const yesNo = (value: unknown) => (value === true ? "Yes" : value === false ? "No" : undefined)

export function describeCollision(event: CollisionEvent): CollisionDescription {
  const legacy = isLegacyCollision(event)
  const carrierLabel = (vehicleId: string) => event.canonicalLinks?.find((link) => link.recordId === vehicleId)?.label || vehicleId
  const parties = readCollisionParties(event)
  const partyLabel = (id: string) => { const party = parties.find((item) => item.itemId === id); return party ? (party.role === "OTHER_PARTY" ? label(T.COLLISION_OTHER_PARTY_TYPES, party.partyType) || "Other party" : carrierLabel(party.linkedVehicleId)) : undefined }
  const legacyConfig = factText(event, COLLISION_DATA_POINTS.legacyConfiguration)
  const details = event.collisionDetails
  const statement = readCollisionStatements(event)[0]
  const persons = readCollisionPersons(event)
  const downtime = factNumber(event, COLLISION_DATA_POINTS.downtimeHours)
  const legacyReportability = getCollisionReportability(event)
  return {
    legacy,
    classification: {
      type: label(T.COLLISION_TYPES, factText(event, COLLISION_DATA_POINTS.classType)) || undefined,
      manner: label(T.COLLISION_MANNERS, factText(event, COLLISION_DATA_POINTS.manner)) || undefined,
      firstHarmfulEvent: label(T.COLLISION_FIRST_HARMFUL_EVENTS, factText(event, COLLISION_DATA_POINTS.firstHarmfulEvent)) || undefined,
      driverActivity: label(T.COLLISION_DRIVER_ACTIVITIES, factText(event, COLLISION_DATA_POINTS.driverActivity)) || undefined,
      driverAction: label(T.COLLISION_DRIVER_ACTIONS, factText(event, COLLISION_DATA_POINTS.driverAction)) || undefined,
      legacyConfiguration: (legacyConfig ? label(T.LEGACY_COLLISION_CONFIGURATIONS, legacyConfig) : text(details?.collisionType)) || undefined,
    },
    sequence: readCollisionSequence(event).map((step) => ({ ordinal: step.ordinal, event: label(T.COLLISION_SEQUENCE_EVENTS, step.eventValue) || undefined, description: step.description || undefined, notes: step.notes || undefined, evidenceCount: step.evidenceIds.length })),
    parties: parties.map((party) => ({
      id: party.itemId, role: label(T.COLLISION_PARTY_ROLES, party.role), carrier: party.role !== "OTHER_PARTY", vehicle: party.linkedVehicleId ? carrierLabel(party.linkedVehicleId) : undefined,
      type: label(T.COLLISION_OTHER_PARTY_TYPES, party.partyType) || undefined, description: party.description || undefined, identifier: party.identifier || undefined,
      damage: label(T.COLLISION_DAMAGE_STATUSES, party.damageStatus) || undefined, drivability: label(T.COLLISION_DRIVABILITY, party.drivability) || undefined, tow: label(T.COLLISION_TOW_STATUSES, party.towStatus) || undefined,
      speed: party.speed !== undefined ? `${party.speed} ${label(T.COLLISION_SPEED_UNITS, party.speedUnit)}` : undefined, impact: label(T.COLLISION_IMPACT_POINTS, party.impactPoint) || undefined,
    })),
    environment: {
      timeZone: factText(event, COLLISION_DATA_POINTS.eventTimeZone) || undefined, roadHighway: factText(event, COLLISION_DATA_POINTS.roadHighway) || undefined,
      direction: label(DIRECTIONS, factText(event, COLLISION_DATA_POINTS.directionOfTravel)) || undefined, visibility: label(T.COLLISION_VISIBILITY, factText(event, COLLISION_DATA_POINTS.visibility)) || undefined,
      traffic: label(T.COLLISION_TRAFFIC, factText(event, COLLISION_DATA_POINTS.traffic)) || undefined, workZone: label(T.COLLISION_YES_NO_UNKNOWN, factText(event, COLLISION_DATA_POINTS.workZone)) || undefined,
    },
    outcomes: {
      injuryStatus: label(T.COLLISION_INJURY_STATUSES, factText(event, COLLISION_DATA_POINTS.injuryStatus)) || undefined,
      police: label(T.COLLISION_POLICE_RESPONSES, factText(event, COLLISION_DATA_POINTS.policeResponse)) || undefined,
      policeReference: factText(event, COLLISION_DATA_POINTS.policeReportReference) || undefined,
      enforcement: label(T.COLLISION_ENFORCEMENT, factText(event, COLLISION_DATA_POINTS.enforcement)) || undefined,
      cargo: label(T.COLLISION_CARGO_IMPACT, factText(event, COLLISION_DATA_POINTS.cargoImpact)) || undefined,
      hazmat: label(T.COLLISION_HAZMAT, factText(event, COLLISION_DATA_POINTS.hazmat)) || undefined,
      serviceInterruption: label(T.COLLISION_YES_NO_UNKNOWN, factText(event, COLLISION_DATA_POINTS.serviceInterruption)) || undefined,
      downtimeHours: downtime,
      reportability: legacyReportability === "NOT_RECORDED" ? undefined : label(T.COLLISION_REPORTABILITY, legacyReportability),
    },
    injuredPersons: persons.map((person) => ({
      id: person.itemId, role: label(T.COLLISION_PERSON_ROLES, person.role), name: person.name || undefined, severity: label(T.COLLISION_INJURY_SEVERITIES, person.injurySeverity) || undefined,
      transported: label(T.COLLISION_YES_NO_UNKNOWN, person.transportedFromScene) || undefined, treatment: label(T.COLLISION_TREATMENT_STATUSES, person.treatmentStatus) || undefined, facility: person.facility || undefined,
      fatalityDate: person.fatalityDate || undefined, notes: person.notes || undefined, accessClass: label(T.COLLISION_ACCESS_CLASSES, person.accessClassification) || undefined, party: person.linkedPartyId ? partyLabel(person.linkedPartyId) : undefined,
    })),
    injuryCounts: deriveCollisionInjuryCounts(event),
    statement: statement ? { status: label(T.COLLISION_STATEMENT_STATUSES, statement.status), date: statement.date || undefined, time: statement.time || undefined, method: label(T.COLLISION_STATEMENT_METHODS, statement.method) || undefined, content: statement.content || undefined, source: statement.source || undefined } : undefined,
    statementRequired: factText(event, COLLISION_DATA_POINTS.driverStatementRequired) === "YES" ? true : undefined,
    legacyDetails: legacy ? {
      driverStatement: factText(event, COLLISION_DATA_POINTS.legacyDriverStatement) || text(details?.driverStatement) || undefined,
      investigationNarrative: factText(event, COLLISION_DATA_POINTS.legacyInvestigationNotes) || undefined,
      otherParty: factText(event, COLLISION_DATA_POINTS.legacyOtherParty) || undefined,
      tow: yesNo(collisionFact(event, COLLISION_DATA_POINTS.legacyTow) ?? details?.towRequired),
      propertyDamage: yesNo(collisionFact(event, COLLISION_DATA_POINTS.legacyPropertyDamage)),
      police: yesNo(collisionFact(event, COLLISION_DATA_POINTS.legacyPolice) ?? details?.policeAttended),
      policeReportNumber: text(details?.policeReportNumber) || undefined,
      estimatedCost: text(details?.estimatedCost) || undefined,
      witnessStatements: text(details?.witnessStatements) || undefined,
      reportability: legacyReportability === "NOT_RECORDED" ? undefined : label(T.COLLISION_REPORTABILITY, legacyReportability),
    } : undefined,
  }
}

export interface CollisionSummary { title: string; outcomeLine?: string; contextLine: string }

const formatDate = (iso: string | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "")
  if (!match) return iso || ""
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[Number(match[2]) - 1] || match[2]} ${Number(match[3])}, ${match[1]}`
}

export function buildCollisionSummary(event: CollisionEvent): CollisionSummary {
  const description = describeCollision(event)
  const power = event.canonicalLinks?.find((link) => link.relationshipKey === "vehicle" && link.label)?.label
  const place = [text(event.location) || description.environment.roadHighway, text(event.city), text(event.stateProvince)].filter(Boolean).join(", ")
  const classification = description.classification.type || (description.classification.legacyConfiguration ? `${description.classification.legacyConfiguration} (legacy)` : "")
  return { title: "Collision", outcomeLine: description.outcomes.injuryStatus, contextLine: [formatDate(event.eventDate), classification, power, place].filter(Boolean).join(" · ") }
}

// ---------------------------------------------------------------------------
// Wizard draft -> canonical child collections (pure, so the same conversion is unit tested)
// ---------------------------------------------------------------------------

export interface CollisionDraftSequence { itemId: string; ordinal: string; eventValue: string; description: string; notes: string; evidenceIds: string[] }
export interface CollisionDraftUnitDetail { damageStatus: string; drivability: string; towStatus: string; speed: string; speedUnit: string; impactPoint: string; evidenceIds: string[] }
export interface CollisionDraftOtherParty extends CollisionDraftUnitDetail { itemId: string; partyType: string; description: string; identifier: string }
export interface CollisionDraftPerson { itemId: string; role: string; name: string; linkedPartyId: string; injurySeverity: string; transported: string; treatmentStatus: string; facility: string; fatalityDate: string; notes: string; accessClassification: string; evidenceIds: string[] }
export interface CollisionDraftStatement { itemId: string; status: string; date: string; time: string; method: string; content: string; evidenceIds: string[] }
export interface CollisionDraft {
  sequence: CollisionDraftSequence[]
  carriers: Record<string, CollisionDraftUnitDetail>
  others: CollisionDraftOtherParty[]
  persons: CollisionDraftPerson[]
  statement: CollisionDraftStatement
  powerUnitId: string
  trailerIds: string[]
}

export const emptyUnitDetail = (): CollisionDraftUnitDetail => ({ damageStatus: "", drivability: "", towStatus: "", speed: "", speedUnit: "", impactPoint: "", evidenceIds: [] })
export const emptyCollisionDraft = (): CollisionDraft => ({ sequence: [], carriers: {}, others: [], persons: [], statement: { itemId: newItemId("CST"), status: "", date: "", time: "", method: "", content: "", evidenceIds: [] }, powerUnitId: "", trailerIds: [] })
export const carrierPartyItemId = (vehicleId: string) => `CPT-CARRIER-${vehicleId}`

const toSpeed = (value: string) => (value.trim() === "" ? null : Number(value))

export function collisionDraftToChildren(draft: CollisionDraft, vehicles: ReadonlyArray<{ id: string; label: string }>) {
  const vehicleLabel = (id: string) => vehicles.find((vehicle) => vehicle.id === id)?.label || id
  const carrier = (role: string, vehicleId: string): CollisionPartyInput => {
    const detail = draft.carriers[vehicleId] || emptyUnitDetail()
    return { itemId: carrierPartyItemId(vehicleId), role, linkedVehicleId: vehicleId, damageStatus: detail.damageStatus, drivability: detail.drivability, towStatus: detail.towStatus, speed: toSpeed(detail.speed), speedUnit: detail.speedUnit, impactPoint: detail.impactPoint, evidenceIds: detail.evidenceIds }
  }
  const parties: CollisionPartyInput[] = [
    ...(draft.powerUnitId ? [carrier("CARRIER_POWER_UNIT", draft.powerUnitId)] : []),
    ...draft.trailerIds.map((id) => carrier("CARRIER_TRAILER", id)),
    ...draft.others.map((party) => ({ itemId: party.itemId, role: "OTHER_PARTY", partyType: party.partyType, description: party.description, identifier: party.identifier, damageStatus: party.damageStatus, drivability: party.drivability, towStatus: party.towStatus, speed: toSpeed(party.speed), speedUnit: party.speedUnit, impactPoint: party.impactPoint, evidenceIds: party.evidenceIds })),
  ]
  const collections = [
    buildCollisionSequenceCollection(draft.sequence.map((step) => ({ itemId: step.itemId, ordinal: Number(step.ordinal), eventValue: step.eventValue, description: step.description, notes: step.notes, evidenceIds: step.evidenceIds }))),
    buildCollisionPartiesCollection(parties),
    buildCollisionPersonsCollection(draft.persons.map((person) => ({ itemId: person.itemId, role: person.role, name: person.name, linkedPartyId: person.linkedPartyId, injurySeverity: person.injurySeverity, transportedFromScene: person.transported, treatmentStatus: person.treatmentStatus, facility: person.facility, fatalityDate: person.fatalityDate, notes: person.notes, accessClassification: person.accessClassification, evidenceIds: person.evidenceIds }))),
    draft.statement.status ? buildCollisionStatementCollection([{ itemId: draft.statement.itemId, status: draft.statement.status, date: draft.statement.date, time: draft.statement.time, method: draft.statement.method, content: draft.statement.content, source: draft.statement.method ? label(T.COLLISION_STATEMENT_METHODS, draft.statement.method) : undefined, evidenceIds: draft.statement.evidenceIds }]) : undefined,
  ].filter((collection): collection is PerformanceChildCollection => Boolean(collection))
  const canonicalLinks = [
    ...(draft.powerUnitId ? [{ entityType: "Vehicle" as const, recordId: draft.powerUnitId, label: vehicleLabel(draft.powerUnitId), relationshipKey: "vehicle", source: "CANONICAL_STORE" as const }] : []),
    ...draft.trailerIds.map((id) => ({ entityType: "Trailer" as const, recordId: id, label: vehicleLabel(id), relationshipKey: "trailer", source: "CANONICAL_STORE" as const })),
  ]
  return { collections, canonicalLinks, vehicleId: draft.powerUnitId || undefined }
}
