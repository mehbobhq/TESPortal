/**
 * Customer Event - one top-level Performance Event with an immutable subtype: COMPLAINT, COMMENDATION or SITE_BEHAVIOR.
 *
 * The subtypes share one occurrence architecture but are NOT symmetrical, and they are never flattened into one form.
 *
 * Semantic layers kept separate at every step:
 *   customer statement != confirmed fact      | site behavior observation != violation
 *   observer != subject                        | person behavior != site condition
 *   commendation != positive complaint         | customer acceptance != case closure
 *   owning driver != responsible driver        | initial report != investigation determination
 *
 * Customer Event owns occurrence facts, parties, the original statement, claims, subtype facts, the response timeline, resolution,
 * customer outcome, raw financial facts and explicit workflow-control facts. Classification, substantiation, responsibility,
 * preventability, root cause and conclusions belong to the common investigation engine.
 *
 * Customer and site references are event-local free text: TES has no canonical carrier -> customer / site / shipment model.
 * No SLA, scoring, BI or automation lives here. Pure functions over the stored event shape; labels are presentation only.
 * Legacy Customer Complaint / Commendation / Customer-Site Behavior records are read-only history and are never rewritten.
 */

import type { CanonicalEntityLink, PerformanceChildCollection, PerformanceChildFactItem, PerformanceEventRecord, StructuredEventFact } from "@/types/drivers"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import * as taxonomy from "./performance-customer-event-taxonomy.ts"
import type { FoundationEvent, PerformanceFoundationState } from "@/lib/performance-foundation-state"
import type { WorkflowObligation, WorkflowProvider } from "@/lib/performance-workflow"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { makeObligation } from "./performance-workflow.ts"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { getActiveDetermination, getInvestigationsForEvent } from "./performance-investigation.ts"

type Option = { value: string; label: string }
const T = taxonomy as unknown as Record<string, readonly Option[]> & {
  CE_COLLECTION_IDS: Readonly<Record<"PARTIES" | "STATEMENTS" | "CLAIMS" | "COMMENDATION" | "BEHAVIORS" | "CONDITIONS" | "TIMELINE" | "RESOLUTION" | "OUTCOME" | "FINANCIAL" | "REVIEWS" | "STATUS_HISTORY", string>>
  CE_FINANCIAL_KINDS: readonly string[]
  CE_FINANCIAL_LABELS: Readonly<Record<string, string>>
  CE_CLAIM_ASSERTION_REPORTED: string
  customerOptionLabel: (list: readonly Option[], value: string | null | undefined) => string
  customerValues: (list: readonly Option[]) => string[]
}
const CID = T.CE_COLLECTION_IDS
const L = (list: readonly Option[], value: unknown) => T.customerOptionLabel(list, typeof value === "string" ? value : undefined)
const inList = (list: readonly Option[], value: string) => T.customerValues(list).includes(value)

export type CustomerEvent = Pick<PerformanceEventRecord, "id" | "eventType"> &
  Partial<Pick<PerformanceEventRecord, "driverMasterId" | "eventDate" | "eventTime" | "reportedDate" | "occurrencePrecision" | "location" | "city" | "stateProvince" | "country" | "canonicalLinks" | "structuredEventFacts" | "structuredFacts" | "childCollections" | "evidenceIds" | "provenance" | "summary" | "createdAt">>

const dp = (suffix: string) => `DRV.PERF.CUSTOMER_EVENT.${suffix}`
/** Stable data point ids (mirrors lib/driver-performance-schema.ts; a test asserts they match the registry). */
export const CE_DATA_POINTS = {
  customerEventType: dp("CUSTOMER_EVENT_TYPE"), intakeChannel: dp("INTAKE_CHANNEL"),
  windowStart: dp("OCCURRENCE_WINDOW_START"), windowEnd: dp("OCCURRENCE_WINDOW_END"), windowBasis: dp("OCCURRENCE_WINDOW_BASIS"), discoveryDate: dp("DISCOVERY_DATE"), discoveryTime: dp("DISCOVERY_TIME"), reportedTime: dp("REPORTED_TIME"), eventTimeZone: dp("EVENT_TIME_ZONE"),
  customerName: dp("CUSTOMER_NAME"), customerRole: dp("CUSTOMER_ROLE"), customerContact: dp("CUSTOMER_CONTACT"), customerSite: dp("CUSTOMER_SITE"), siteArea: dp("SITE_AREA"), shipperName: dp("SHIPPER_NAME"), receiverName: dp("RECEIVER_NAME"), brokerName: dp("BROKER_NAME"),
  loadReference: dp("LOAD_REFERENCE"), shipmentReference: dp("SHIPMENT_REFERENCE"), bolPro: dp("BOL_PRO"), origin: dp("ORIGIN"), destination: dp("DESTINATION"), appointmentReference: dp("APPOINTMENT_REFERENCE"), routeReference: dp("ROUTE_REFERENCE"), serviceType: dp("SERVICE_TYPE"), operatingStage: dp("OPERATING_STAGE"),
  normalizedNarrative: dp("NORMALIZED_NARRATIVE"),
  complaintPrimaryCategory: dp("COMPLAINT_PRIMARY_CATEGORY"), complaintSecondaryCategories: dp("COMPLAINT_SECONDARY_CATEGORIES"), customerImpactNote: dp("CUSTOMER_IMPACT_NOTE"), operationalInterruption: dp("OPERATIONAL_INTERRUPTION"), safetySignificance: dp("SAFETY_SIGNIFICANCE"), regulatorySignificance: dp("REGULATORY_SIGNIFICANCE"),
  coachingGiven: dp("RESPONSE_COACHING_GIVEN"), activityStopped: dp("RESPONSE_ACTIVITY_STOPPED"), supervisorContacted: dp("RESPONSE_SUPERVISOR_CONTACTED"), securityContacted: dp("RESPONSE_SECURITY_CONTACTED"), emergencyServicesContacted: dp("RESPONSE_EMERGENCY_SERVICES_CONTACTED"), areaSecured: dp("RESPONSE_AREA_SECURED"), noImmediateAction: dp("RESPONSE_NO_IMMEDIATE_ACTION"), otherImmediateAction: dp("RESPONSE_OTHER"), otherImmediateActionNote: dp("RESPONSE_OTHER_NOTE"),
  complaintAssessmentRequired: dp("REQUIRE_COMPLAINT_ASSESSMENT"), customerResponseRequired: dp("REQUIRE_CUSTOMER_RESPONSE"), siteReviewRequired: dp("REQUIRE_SITE_REVIEW"), recognitionReviewRequired: dp("REQUIRE_RECOGNITION_REVIEW"),
} as const

export const CE_RESPONSE_FACT_KEYS = ["coachingGiven", "activityStopped", "supervisorContacted", "securityContacted", "emergencyServicesContacted", "areaSecured", "noImmediateAction", "otherImmediateAction"] as const
export const CE_RESPONSE_FACT_LABELS: Readonly<Record<string, string>> = { coachingGiven: "Coaching Given", activityStopped: "Activity Stopped", supervisorContacted: "Supervisor Contacted", securityContacted: "Security Contacted", emergencyServicesContacted: "Emergency Services Contacted", areaSecured: "Area Secured", noImmediateAction: "No Immediate Action", otherImmediateAction: "Other" }
export const CE_REQUIREMENT_KEYS = ["complaintAssessmentRequired", "customerResponseRequired", "siteReviewRequired", "recognitionReviewRequired"] as const
const COMPLAINT_FACT_KEYS = ["complaintPrimaryCategory", "complaintSecondaryCategories", "customerImpactNote", "operationalInterruption", "safetySignificance", "regulatorySignificance"] as const
const LEGACY_TYPES = ["Customer Complaint", "Customer Commendation", "Customer-Site Behavior"] as const

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")
export function customerFact(event: Pick<CustomerEvent, "structuredEventFacts">, dataPointId: string): StructuredEventFact["value"] | undefined {
  return event.structuredEventFacts?.find((fact) => fact.dataPointId === dataPointId)?.value
}
const factText = (event: CustomerEvent, id: string) => text(customerFact(event, id))

export const isCustomerEvent = (event: Pick<CustomerEvent, "eventType">) => event.eventType === "Customer Event"
export const isLegacyCustomerEvent = (event: Pick<CustomerEvent, "eventType">) => (LEGACY_TYPES as readonly string[]).includes(event.eventType)
export const customerEventSubtype = (event: CustomerEvent): string => (isCustomerEvent(event) ? factText(event, CE_DATA_POINTS.customerEventType) : "")
/** A new canonical Customer Event carries the subtype fact. */
export const isNewTaxonomyCustomerEvent = (event: CustomerEvent) => isCustomerEvent(event) && Boolean(customerEventSubtype(event))

export const idsToFact = (ids: readonly string[] | undefined): string | null => (ids && ids.length ? [...new Set(ids)].join("|") : null)
export const idsFromFact = (value: unknown): string[] => (typeof value === "string" && value ? value.split("|").filter(Boolean) : [])

// ---------------------------------------------------------------------------
// Money { value, currencyCode }: stored as <name> + <name>Currency (+ <name>Basis). Local to Customer Event.
// ---------------------------------------------------------------------------

export interface CustomerMoney { value: number; currencyCode: string; basis?: string }
const SUPPORTED_CURRENCIES = (() => { try { return new Set<string>((Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf("currency")) } catch { return new Set<string>(["CAD", "USD"]) } })()
export const isSupportedCustomerCurrency = (code: string) => /^[A-Z]{3}$/.test(code) && (SUPPORTED_CURRENCIES.has(code) || code === "CAD" || code === "USD")
const nullable = (value: unknown): string | number | null => (typeof value === "number" ? value : text(value) || null)
const numberOrNull = (value: string | number | undefined | null): number | null => { if (value === undefined || value === null || String(value).trim() === "") return null; const n = Number(value); return Number.isNaN(n) ? NaN : n }

// ---------------------------------------------------------------------------
// Wizard draft -> canonical child collections (pure, unit tested)
// ---------------------------------------------------------------------------

const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`
const unique = (items: readonly string[] | undefined) => [...new Set((items || []).filter(Boolean))]

export interface CustomerDraftParty { itemId: string; capacities: string[]; personType: string; isOwningDriver: boolean; name: string; organization: string; certainty: string; accessClassification: string; evidenceIds: string[] }
export interface CustomerDraftStatement { itemId: string; text: string; providedByPartyId: string; accessClassification: string; evidenceIds: string[] }
export interface CustomerDraftClaim { itemId: string; claimType: string; reportedStatement: string; reportedIssue: string; source: string; evidenceIds: string[] }
export interface CustomerDraftBehavior { itemId: string; subjectPartyId: string; primaryCategory: string; secondaryCategories: string[]; description: string; certainty: string; evidenceIds: string[] }
export interface CustomerDraftCondition { itemId: string; category: string; description: string; certainty: string; immediateRisk: string; evidenceIds: string[] }
export interface CustomerDraftCommendation { recognitionCategory: string; recognizedPartyId: string; recognitionSource: string; recognitionLevel: string; positiveBehaviorCategory: string; positiveBehaviorDescription: string; businessImpactNote: string; recognitionAction: string; shareConsent: string; evidenceIds: string[] }
export interface CustomerDraftStep { itemId: string; ordinal: string; action: string; actionOther: string; timestamp: string; actor: string; note: string; evidenceIds: string[] }
export interface CustomerDraftResolution { status: string; summary: string; responseProvided: string; responseProvidedAt: string; resolutionProvidedAt: string; owner: string; evidenceIds: string[] }
export interface CustomerDraftOutcome { acceptance: string; customerResponseReceivedAt: string; followUpRequested: string; note: string; evidenceIds: string[] }
export interface CustomerDraftFinancial { [key: string]: string }
export interface CustomerDraft {
  parties: CustomerDraftParty[]; statements: CustomerDraftStatement[]; claims: CustomerDraftClaim[]; behaviors: CustomerDraftBehavior[]; conditions: CustomerDraftCondition[]; commendation: CustomerDraftCommendation | null
  steps: CustomerDraftStep[]; resolution: CustomerDraftResolution | null; outcome: CustomerDraftOutcome | null; financial: CustomerDraftFinancial; precision: string
}

export const emptyCustomerParty = (): CustomerDraftParty => ({ itemId: newId("CEP"), capacities: [], personType: "", isOwningDriver: false, name: "", organization: "", certainty: "IDENTIFIED", accessClassification: "", evidenceIds: [] })
export const emptyCustomerStatement = (): CustomerDraftStatement => ({ itemId: newId("CES"), text: "", providedByPartyId: "", accessClassification: "RESTRICTED_INTERNAL", evidenceIds: [] })
export const emptyCustomerClaim = (): CustomerDraftClaim => ({ itemId: newId("CEC"), claimType: "", reportedStatement: "", reportedIssue: "", source: "CUSTOMER", evidenceIds: [] })
export const emptyCustomerBehavior = (): CustomerDraftBehavior => ({ itemId: newId("CEB"), subjectPartyId: "", primaryCategory: "", secondaryCategories: [], description: "", certainty: "REPORTED", evidenceIds: [] })
export const emptyCustomerCondition = (): CustomerDraftCondition => ({ itemId: newId("CEK"), category: "", description: "", certainty: "OBSERVED", immediateRisk: "", evidenceIds: [] })
export const emptyCustomerCommendation = (): CustomerDraftCommendation => ({ recognitionCategory: "", recognizedPartyId: "", recognitionSource: "CUSTOMER", recognitionLevel: "", positiveBehaviorCategory: "", positiveBehaviorDescription: "", businessImpactNote: "", recognitionAction: "", shareConsent: "", evidenceIds: [] })
export const emptyCustomerStep = (ordinal: number): CustomerDraftStep => ({ itemId: newId("CER"), ordinal: String(ordinal), action: "", actionOther: "", timestamp: "", actor: "", note: "", evidenceIds: [] })
export const emptyCustomerResolution = (): CustomerDraftResolution => ({ status: "", summary: "", responseProvided: "", responseProvidedAt: "", resolutionProvidedAt: "", owner: "", evidenceIds: [] })
export const emptyCustomerOutcome = (): CustomerDraftOutcome => ({ acceptance: "", customerResponseReceivedAt: "", followUpRequested: "", note: "", evidenceIds: [] })
export const emptyCustomerFinancial = (): CustomerDraftFinancial => ({})
export const emptyCustomerDraft = (): CustomerDraft => ({ parties: [], statements: [], claims: [], behaviors: [], conditions: [], commendation: null, steps: [], resolution: null, outcome: null, financial: {}, precision: "EXACT_DATETIME" })

const child = (itemId: string, facts: Record<string, string | number | null>, evidenceIds: string[]): PerformanceChildFactItem => ({ itemId, facts, evidenceIds: unique(evidenceIds) })
const collection = (collectionId: string, itemType: string, items: PerformanceChildFactItem[]): PerformanceChildCollection | undefined => (items.length ? { collectionId, collectionVersion: "1.0", itemType, completeness: "COMPLETE", items } : undefined)

const FIXED_IDS = { COMMENDATION: "CEM-1", RESOLUTION: "CEZ-1", OUTCOME: "CEO-1", FINANCIAL: "CEF-1" } as const

export function customerFinancialFacts(financial: CustomerDraftFinancial): Record<string, string | number | null> | undefined {
  const facts: Record<string, string | number | null> = {}
  let any = false
  for (const kind of T.CE_FINANCIAL_KINDS) {
    const amount = numberOrNull(financial[kind])
    if (amount !== null) any = true
    facts[kind] = amount
    facts[`${kind}Currency`] = amount === null ? null : text(financial[`${kind}Currency`]) || null
    if (kind !== "revenueAtRisk") facts[`${kind}Basis`] = amount === null ? null : text(financial[`${kind}Basis`]) || null
  }
  if (text(financial.otherLabel)) facts.otherLabel = text(financial.otherLabel)
  return any ? facts : undefined
}

export function customerDraftToChildren(draft: CustomerDraft, options: { driverMasterId?: string; now?: string } = {}) {
  const financial = customerFinancialFacts(draft.financial)
  const collections = [
    collection(CID.PARTIES, "CUSTOMER_EVENT_PARTY", draft.parties.map((p) => child(p.itemId, { capacities: idsToFact(p.capacities), personType: nullable(p.personType), linkedDriverMasterId: p.isOwningDriver && options.driverMasterId ? options.driverMasterId : null, name: nullable(p.name), organization: nullable(p.organization), certainty: nullable(p.certainty), accessClassification: nullable(p.accessClassification) }, p.evidenceIds))),
    collection(CID.STATEMENTS, "CUSTOMER_EVENT_ORIGINAL_STATEMENT", draft.statements.map((s) => child(s.itemId, { statementText: nullable(s.text), providedByPartyId: nullable(s.providedByPartyId), accessClassification: nullable(s.accessClassification) }, s.evidenceIds))),
    collection(CID.CLAIMS, "CUSTOMER_EVENT_COMPLAINT_CLAIM", draft.claims.map((c) => child(c.itemId, { claimType: nullable(c.claimType), reportedStatement: nullable(c.reportedStatement), reportedIssue: nullable(c.reportedIssue), source: nullable(c.source), assertionStatus: T.CE_CLAIM_ASSERTION_REPORTED }, c.evidenceIds))),
    draft.commendation ? collection(CID.COMMENDATION, "CUSTOMER_EVENT_COMMENDATION", [child(FIXED_IDS.COMMENDATION, { recognitionCategory: nullable(draft.commendation.recognitionCategory), recognizedPartyId: nullable(draft.commendation.recognizedPartyId), recognitionSource: nullable(draft.commendation.recognitionSource), recognitionLevel: nullable(draft.commendation.recognitionLevel), positiveBehaviorCategory: nullable(draft.commendation.positiveBehaviorCategory), positiveBehaviorDescription: nullable(draft.commendation.positiveBehaviorDescription), businessImpactNote: nullable(draft.commendation.businessImpactNote), recognitionAction: nullable(draft.commendation.recognitionAction), shareConsent: nullable(draft.commendation.shareConsent) }, draft.commendation.evidenceIds)]) : undefined,
    collection(CID.BEHAVIORS, "CUSTOMER_EVENT_SITE_PERSON_BEHAVIOR", draft.behaviors.map((b) => child(b.itemId, { subjectPartyId: nullable(b.subjectPartyId), primaryCategory: nullable(b.primaryCategory), secondaryCategories: idsToFact(b.secondaryCategories), description: nullable(b.description), certainty: nullable(b.certainty) }, b.evidenceIds))),
    collection(CID.CONDITIONS, "CUSTOMER_EVENT_SITE_CONDITION", draft.conditions.map((k) => child(k.itemId, { category: nullable(k.category), description: nullable(k.description), certainty: nullable(k.certainty), immediateRisk: nullable(k.immediateRisk) }, k.evidenceIds))),
    collection(CID.TIMELINE, "CUSTOMER_EVENT_RESPONSE_STEP", draft.steps.map((s) => child(s.itemId, { ordinal: numberOrNull(s.ordinal), action: nullable(s.action), actionOther: nullable(s.actionOther), timestamp: nullable(s.timestamp), actor: nullable(s.actor), note: nullable(s.note) }, s.evidenceIds))),
    draft.resolution ? collection(CID.RESOLUTION, "CUSTOMER_EVENT_RESOLUTION", [child(FIXED_IDS.RESOLUTION, { status: nullable(draft.resolution.status), summary: nullable(draft.resolution.summary), responseProvided: nullable(draft.resolution.responseProvided), responseProvidedAt: nullable(draft.resolution.responseProvidedAt), resolutionProvidedAt: nullable(draft.resolution.resolutionProvidedAt), owner: nullable(draft.resolution.owner) }, draft.resolution.evidenceIds)]) : undefined,
    draft.outcome ? collection(CID.OUTCOME, "CUSTOMER_EVENT_OUTCOME", [child(FIXED_IDS.OUTCOME, { acceptance: nullable(draft.outcome.acceptance), customerResponseReceivedAt: nullable(draft.outcome.customerResponseReceivedAt), followUpRequested: nullable(draft.outcome.followUpRequested), note: nullable(draft.outcome.note) }, draft.outcome.evidenceIds)]) : undefined,
    financial ? collection(CID.FINANCIAL, "CUSTOMER_EVENT_FINANCIAL_FACTS", [child(FIXED_IDS.FINANCIAL, financial, [])]) : undefined,
  ].filter((entry): entry is PerformanceChildCollection => Boolean(entry))
  const canonicalLinks: CanonicalEntityLink[] = []
  return { collections, canonicalLinks, occurrencePrecision: draft.precision, now: options.now }
}

// ---------------------------------------------------------------------------
// Readers (numbers stay numbers; unknown stays undefined, never zero)
// ---------------------------------------------------------------------------

const collectionOf = (event: Pick<CustomerEvent, "childCollections">, id: string) => event.childCollections?.find((entry) => entry.collectionId === id)
const num = (facts: Record<string, unknown>, key: string) => (typeof facts[key] === "number" ? (facts[key] as number) : undefined)
const str = (facts: Record<string, unknown>, key: string) => text(facts[key])
type EventChildren = Pick<CustomerEvent, "childCollections">
const moneyOf = (facts: Record<string, unknown>, name: string): CustomerMoney | undefined => { const value = facts[name]; const currency = facts[`${name}Currency`]; return typeof value === "number" && typeof currency === "string" && currency ? { value, currencyCode: currency, basis: str(facts, `${name}Basis`) || undefined } : undefined }

export function readCustomerParties(event: EventChildren) {
  return (collectionOf(event, CID.PARTIES)?.items || []).map((item) => ({ itemId: item.itemId, capacities: idsFromFact(item.facts.capacities), personType: str(item.facts, "personType"), linkedDriverMasterId: str(item.facts, "linkedDriverMasterId"), name: str(item.facts, "name"), organization: str(item.facts, "organization"), certainty: str(item.facts, "certainty"), accessClassification: str(item.facts, "accessClassification"), evidenceIds: item.evidenceIds }))
}
export function readCustomerStatements(event: EventChildren) {
  return (collectionOf(event, CID.STATEMENTS)?.items || []).map((item) => ({ itemId: item.itemId, text: str(item.facts, "statementText"), providedByPartyId: str(item.facts, "providedByPartyId"), accessClassification: str(item.facts, "accessClassification"), evidenceIds: item.evidenceIds }))
}
export function readCustomerClaims(event: EventChildren) {
  return (collectionOf(event, CID.CLAIMS)?.items || []).map((item) => ({ itemId: item.itemId, claimType: str(item.facts, "claimType"), reportedStatement: str(item.facts, "reportedStatement"), reportedIssue: str(item.facts, "reportedIssue"), source: str(item.facts, "source"), assertionStatus: str(item.facts, "assertionStatus"), evidenceIds: item.evidenceIds }))
}
export function readCustomerCommendation(event: EventChildren) {
  const item = collectionOf(event, CID.COMMENDATION)?.items[0]
  if (!item) return undefined
  const f = item.facts
  return { itemId: item.itemId, recognitionCategory: str(f, "recognitionCategory"), recognizedPartyId: str(f, "recognizedPartyId"), recognitionSource: str(f, "recognitionSource"), recognitionLevel: str(f, "recognitionLevel"), positiveBehaviorCategory: str(f, "positiveBehaviorCategory"), positiveBehaviorDescription: str(f, "positiveBehaviorDescription"), businessImpactNote: str(f, "businessImpactNote"), recognitionAction: str(f, "recognitionAction"), shareConsent: str(f, "shareConsent"), evidenceIds: item.evidenceIds }
}
export function readCustomerBehaviors(event: EventChildren) {
  return (collectionOf(event, CID.BEHAVIORS)?.items || []).map((item) => ({ itemId: item.itemId, subjectPartyId: str(item.facts, "subjectPartyId"), primaryCategory: str(item.facts, "primaryCategory"), secondaryCategories: idsFromFact(item.facts.secondaryCategories), description: str(item.facts, "description"), certainty: str(item.facts, "certainty"), evidenceIds: item.evidenceIds }))
}
export function readCustomerConditions(event: EventChildren) {
  return (collectionOf(event, CID.CONDITIONS)?.items || []).map((item) => ({ itemId: item.itemId, category: str(item.facts, "category"), description: str(item.facts, "description"), certainty: str(item.facts, "certainty"), immediateRisk: str(item.facts, "immediateRisk"), evidenceIds: item.evidenceIds }))
}
export function readCustomerTimeline(event: EventChildren) {
  return (collectionOf(event, CID.TIMELINE)?.items || []).map((item) => ({ itemId: item.itemId, ordinal: Number(item.facts.ordinal), action: str(item.facts, "action"), actionOther: str(item.facts, "actionOther"), timestamp: str(item.facts, "timestamp"), actor: str(item.facts, "actor"), note: str(item.facts, "note"), evidenceIds: item.evidenceIds }))
    .sort((a, b) => a.ordinal - b.ordinal || a.itemId.localeCompare(b.itemId))
}
export function readCustomerResolution(event: EventChildren) {
  const item = collectionOf(event, CID.RESOLUTION)?.items[0]
  return item ? { itemId: item.itemId, status: str(item.facts, "status"), summary: str(item.facts, "summary"), responseProvided: str(item.facts, "responseProvided"), responseProvidedAt: str(item.facts, "responseProvidedAt"), resolutionProvidedAt: str(item.facts, "resolutionProvidedAt"), owner: str(item.facts, "owner"), evidenceIds: item.evidenceIds } : undefined
}
export function readCustomerOutcome(event: EventChildren) {
  const item = collectionOf(event, CID.OUTCOME)?.items[0]
  return item ? { itemId: item.itemId, acceptance: str(item.facts, "acceptance"), customerResponseReceivedAt: str(item.facts, "customerResponseReceivedAt"), followUpRequested: str(item.facts, "followUpRequested"), note: str(item.facts, "note"), evidenceIds: item.evidenceIds } : undefined
}
export function readCustomerFinancial(event: EventChildren) {
  const facts = collectionOf(event, CID.FINANCIAL)?.items[0]?.facts
  if (!facts) return undefined
  const rows = T.CE_FINANCIAL_KINDS.map((kind) => ({ kind, money: moneyOf(facts, kind) })).filter((row) => row.money)
  return { rows: rows as Array<{ kind: string; money: CustomerMoney }>, otherLabel: str(facts, "otherLabel") }
}
export function readCustomerReviews(event: EventChildren) {
  return (collectionOf(event, CID.REVIEWS)?.items || []).map((item) => ({ itemId: item.itemId, reviewType: str(item.facts, "reviewType"), reviewedAt: str(item.facts, "reviewedAt"), reviewedBy: str(item.facts, "reviewedBy"), note: str(item.facts, "note"), evidenceIds: item.evidenceIds }))
}
export function readCustomerStatusHistory(event: EventChildren) {
  return (collectionOf(event, CID.STATUS_HISTORY)?.items || []).map((item) => ({ itemId: item.itemId, field: str(item.facts, "field"), from: str(item.facts, "fromValue"), to: str(item.facts, "toValue"), changedAt: str(item.facts, "changedAt"), changedBy: str(item.facts, "changedBy"), note: str(item.facts, "note") }))
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.itemId.localeCompare(b.itemId))
}
export const secondaryCategoriesOf = (event: CustomerEvent) => idsFromFact(factText(event, CE_DATA_POINTS.complaintSecondaryCategories))

// ---------------------------------------------------------------------------
// Derived values (never stored, never operator determinations)
// ---------------------------------------------------------------------------

const stampOf = (date: string | undefined, time: string | undefined) => (date ? (time ? `${date}T${time}` : date) : "")
const earlier = (a: string, b: string) => (a.length >= 16 && b.length >= 16 ? a.slice(0, 16) < b.slice(0, 16) : a.slice(0, 10) < b.slice(0, 10))
const MINUTES = (stamp: string) => { const ms = Date.parse(`${stamp.length === 10 ? `${stamp}T00:00` : stamp.slice(0, 16)}:00Z`); return Number.isNaN(ms) ? undefined : ms / 60000 }
const minutesBetween = (a: string, b: string) => { if (a.length < 16 || b.length < 16) return undefined; const x = MINUTES(a); const y = MINUTES(b); return x === undefined || y === undefined ? undefined : y - x }

/** Occurrence -> discovery -> received delays, derived only when both ends are exact enough. Never stored. */
export function deriveCustomerTimingDelays(event: CustomerEvent) {
  const occurrence = event.occurrencePrecision === "EXACT_DATETIME" ? stampOf(event.eventDate, event.eventTime) : ""
  const discovery = stampOf(factText(event, CE_DATA_POINTS.discoveryDate), factText(event, CE_DATA_POINTS.discoveryTime))
  const received = stampOf(event.reportedDate, factText(event, CE_DATA_POINTS.reportedTime))
  return { occurrenceToDiscoveryMinutes: minutesBetween(occurrence, discovery), discoveryToReceivedMinutes: minutesBetween(discovery, received), occurrenceToReceivedMinutes: minutesBetween(occurrence, received) }
}
/** Latencies between response-timeline steps. Derived at read time; never stored. */
export function deriveCustomerResponseDelays(event: EventChildren) {
  const steps = readCustomerTimeline(event)
  const at = (action: string) => steps.find((step) => step.action === action && step.timestamp)?.timestamp || ""
  const received = at("RECEIVED_RECORDED")
  return {
    receivedToAcknowledgedMinutes: minutesBetween(received, at("ACKNOWLEDGED")), receivedToAssignedMinutes: minutesBetween(received, at("ASSIGNED")), receivedToInvestigationStartedMinutes: minutesBetween(received, at("INVESTIGATION_STARTED")),
    receivedToResponseMinutes: minutesBetween(received, at("RESPONSE_SENT")), receivedToResolutionMinutes: minutesBetween(received, at("RESOLUTION_PROVIDED")),
  }
}

/** The owning driver's role is DERIVED from the party linked to the owning driver. It is never a responsibility. */
export function deriveOwningDriverRole(event: CustomerEvent) {
  const linked = readCustomerParties(event).find((party) => party.linkedDriverMasterId && party.linkedDriverMasterId === event.driverMasterId)
  return linked ? { recorded: true as const, capacities: linked.capacities, labels: linked.capacities.map((value) => L(T.CE_CAPACITIES, value)) } : { recorded: false as const, capacities: [] as string[], labels: [] as string[] }
}

// ---------------------------------------------------------------------------
// Validation (NEW records only; legacy Customer records are never validated against these rules)
// ---------------------------------------------------------------------------

export type CustomerValidationStep = "OCCURRENCE" | "CE_CUSTOMER" | "CE_OPERATIONS" | "CE_PARTIES" | "CE_DESCRIPTION" | "CE_SUBTYPE" | "CE_RESPONSE" | "EVIDENCE" | "REVIEW"
export interface CustomerValidationIssue { step: CustomerValidationStep; message: string }
export type NewCustomerCandidate = CustomerEvent & { driverMasterId?: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const TIME = /^\d{2}:\d{2}$/
const hasDup = (items: readonly string[]) => items.some((item, index) => items.indexOf(item) !== index)

export const validateNewCustomerEvent = (data: NewCustomerCandidate): string[] => validateNewCustomerEventDetailed(data).map((issue) => issue.message)

export function validateNewCustomerEventDetailed(data: NewCustomerCandidate): CustomerValidationIssue[] {
  const issues: CustomerValidationIssue[] = []
  let step: CustomerValidationStep = "OCCURRENCE"
  const err = (message: string) => { issues.push({ step, message }) }
  const f = (id: string) => factText(data, id)
  const controlled = (id: string, list: readonly Option[], name: string) => { const value = f(id); if (value && !inList(list, value)) err(`${name} must be a controlled value.`) }
  const pick = (value: string, list: readonly Option[], name: string) => { if (value && !inList(list, value)) err(`${name} must be a controlled value.`) }
  const evidence = new Set(data.evidenceIds || [])
  const refs = (ids: readonly string[], where: string) => { for (const id of ids) if (!evidence.has(id)) err(`${where} references evidence that is not linked to this Customer Event: ${id}.`) }
  const dateTime = (value: string, label: string) => { if (value && !DATETIME.test(value)) err(`${label} must be a valid date / time.`) }
  const ids = (items: PerformanceChildFactItem[], what: string) => { if (hasDup(items.map((item) => item.itemId)) || items.some((item) => !item.itemId)) err(`${what} ids must be present and unique.`) }

  // Subtype (immutable parent fact) -------------------------------------------
  const subtype = f(CE_DATA_POINTS.customerEventType)
  if (!subtype) err("Customer Event type is required (Complaint, Commendation or Site Behavior).")
  else if (!inList(T.CE_SUBTYPES, subtype)) err("Customer Event type must be a controlled value.")
  const isComplaint = subtype === "COMPLAINT"; const isCommendation = subtype === "COMMENDATION"; const isSite = subtype === "SITE_BEHAVIOR"

  // Occurrence and the two clocks --------------------------------------------
  const precision = text(data.occurrencePrecision)
  if (!text(data.eventDate)) err("Event Date is required.")
  else if (!DATE.test(text(data.eventDate))) err("Event Date must be a valid date.")
  if (!inList(T.CE_OCCURRENCE_PRECISIONS, precision)) err("Occurrence precision must be exact, date only, approximate or unknown.")
  if (precision === "EXACT_DATETIME" && !text(data.eventTime)) err("Event Time is required when the occurrence is exact.")
  if (text(data.eventTime) && !TIME.test(text(data.eventTime))) err("Event Time must be a valid time.")
  if (!text(data.driverMasterId)) err("The owning Driver is required.")
  if (!inList(T.CE_SOURCES, text(data.provenance?.source))) err("Source is required and must be a Customer Event source.")
  controlled(CE_DATA_POINTS.intakeChannel, T.CE_INTAKE_CHANNELS, "Intake channel")
  const zone = f(CE_DATA_POINTS.eventTimeZone)
  if (zone) { try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }) } catch { err("Time zone must be a valid IANA zone.") } }
  const windowStart = f(CE_DATA_POINTS.windowStart); const windowEnd = f(CE_DATA_POINTS.windowEnd)
  if (windowStart || windowEnd) {
    if (!windowStart || !windowEnd) err("An estimated occurrence window needs both a start and an end.")
    else if (!DATETIME.test(windowStart) || !DATETIME.test(windowEnd)) err("The occurrence window must use valid dates / times.")
    else if (earlier(windowEnd, windowStart)) err("The occurrence window end cannot be before its start.")
  }
  const discoveryDate = f(CE_DATA_POINTS.discoveryDate); const discoveryTime = f(CE_DATA_POINTS.discoveryTime)
  if (discoveryTime && !discoveryDate) err("A discovery time needs a discovery date.")
  if (discoveryDate && !DATE.test(discoveryDate)) err("Discovery date must be a valid date.")
  if (discoveryTime && !TIME.test(discoveryTime)) err("Discovery time must be a valid time.")
  const reportedTime = f(CE_DATA_POINTS.reportedTime)
  if (reportedTime && !text(data.reportedDate)) err("A received time needs a received / reported date.")
  const occurrenceEarliest = windowStart && DATETIME.test(windowStart) ? windowStart : precision === "UNKNOWN" ? "" : stampOf(text(data.eventDate), precision === "EXACT_DATETIME" ? text(data.eventTime) : "")
  const discovery = stampOf(discoveryDate, discoveryTime)
  const received = stampOf(text(data.reportedDate), reportedTime)
  if (discovery && occurrenceEarliest && earlier(discovery, occurrenceEarliest)) err("Discovery cannot be before the occurrence.")
  if (received && discovery && earlier(received, discovery)) err("The feedback cannot be received before it was discovered.")
  if (received && occurrenceEarliest && earlier(received, occurrenceEarliest)) err("The feedback cannot be received before the occurrence.")
  const notBeforeOccurrence = (value: string, label: string) => { if (value && DATETIME.test(value) && occurrenceEarliest && earlier(value, occurrenceEarliest)) err(`${label} cannot be before the occurrence.`) }

  // Customer / site / operations are free text; no canonical link may be created ---------
  step = "CE_CUSTOMER"
  if ((data.canonicalLinks || []).length) err("A Customer Event has no canonical links: customer, site and shipment references are free text.")
  step = "CE_OPERATIONS"
  step = "CE_DESCRIPTION"
  if (Object.keys(data.structuredFacts || {}).length) err("New Customer Events use structured facts only.")

  // Parties ---------------------------------------------------------------------
  step = "CE_PARTIES"
  const partyItems = collectionOf(data, CID.PARTIES)?.items || []
  ids(partyItems, "Party")
  const parties = readCustomerParties(data)
  const partyIds = new Set(partyItems.map((item) => item.itemId))
  for (const party of parties) {
    if (!party.capacities.length) err("Every party needs at least one capacity (reporter, observer, subject, recognized party, recorded by or involved).")
    if (hasDup(party.capacities)) err("A party lists the same capacity more than once.")
    for (const capacity of party.capacities) if (!inList(T.CE_CAPACITIES, capacity)) err("Party capacity must be a controlled value.")
    pick(party.personType, T.CE_PERSON_TYPES, "Person type")
    pick(party.certainty, T.CE_IDENTIFICATION_CERTAINTIES, "Identification certainty")
    pick(party.accessClassification, T.CE_ACCESS_CLASSES, "Access classification")
    if (party.linkedDriverMasterId && party.linkedDriverMasterId !== text(data.driverMasterId)) err("A linked driver must be this event's owning Driver.")
    if (party.linkedDriverMasterId && party.personType && party.personType !== "CARRIER_DRIVER") err("Only a carrier driver can be linked to the owning Driver.")
    refs(party.evidenceIds, "A party")
  }
  if (parties.filter((party) => party.linkedDriverMasterId).length > 1) err("Only one party can be linked to the owning Driver.")
  const partyHas = (id: string, capacity: string) => parties.find((party) => party.itemId === id)?.capacities.includes(capacity) || false

  // Original statement ------------------------------------------------------------
  step = "CE_DESCRIPTION"
  const statementItems = collectionOf(data, CID.STATEMENTS)?.items || []
  ids(statementItems, "Original statement")
  for (const statement of readCustomerStatements(data)) {
    if (!statement.text) err("An original statement record needs the statement text.")
    if (!statement.accessClassification) err("An original statement needs an access classification.")
    pick(statement.accessClassification, T.CE_ACCESS_CLASSES, "Access classification")
    if (statement.providedByPartyId && !partyIds.has(statement.providedByPartyId)) err("An original statement references a party that does not exist.")
    refs(statement.evidenceIds, "An original statement")
  }

  // Subtype blocks: data belongs only to the matching subtype ---------------------------
  step = "CE_SUBTYPE"
  const claims = collectionOf(data, CID.CLAIMS)?.items || []
  const commendationItems = collectionOf(data, CID.COMMENDATION)?.items || []
  const behaviorItems = collectionOf(data, CID.BEHAVIORS)?.items || []
  const conditionItems = collectionOf(data, CID.CONDITIONS)?.items || []
  const complaintFactPresent = COMPLAINT_FACT_KEYS.some((key) => f(CE_DATA_POINTS[key]))
  if (subtype && !isComplaint && (claims.length || complaintFactPresent)) err("Complaint claims, categories and impact facts belong only to a Complaint.")
  if (subtype && !isCommendation && commendationItems.length) err("A commendation record belongs only to a Commendation.")
  if (subtype && !isSite && (behaviorItems.length || conditionItems.length)) err("Site person-behavior and site-condition records belong only to a Site Behavior event.")

  // Complaint
  const primary = f(CE_DATA_POINTS.complaintPrimaryCategory)
  controlled(CE_DATA_POINTS.complaintPrimaryCategory, T.CE_COMPLAINT_CATEGORIES, "Complaint primary category")
  const secondaries = secondaryCategoriesOf(data)
  if (secondaries.length) {
    if (!primary) err("Choose the primary complaint category before secondary categories.")
    if (hasDup(secondaries)) err("A secondary complaint category is listed more than once.")
    for (const category of secondaries) { if (!inList(T.CE_COMPLAINT_CATEGORIES, category)) err("Secondary complaint category must be a controlled value."); if (category === primary) err("A secondary complaint category cannot repeat the primary category.") }
  }
  for (const key of ["operationalInterruption", "safetySignificance", "regulatorySignificance"] as const) controlled(CE_DATA_POINTS[key], T.CE_YES_NO_UNKNOWN, key === "operationalInterruption" ? "Operational interruption" : key === "safetySignificance" ? "Safety significance" : "Regulatory significance")
  ids(claims, "Claim")
  for (const claim of readCustomerClaims(data)) {
    if (!claim.claimType) err("Every claim needs a claim type.")
    pick(claim.claimType, T.CE_CLAIM_TYPES, "Claim type")
    pick(claim.source, T.CE_CLAIM_SOURCES, "Claim source")
    if (claim.assertionStatus !== T.CE_CLAIM_ASSERTION_REPORTED) err("A claim is an allegation as reported; it cannot be recorded as confirmed, proven, substantiated or false.")
    refs(claim.evidenceIds, "A claim")
  }

  // Commendation
  if (commendationItems.length > 1) err("A Commendation has one commendation record.")
  const commendation = readCustomerCommendation(data)
  if (commendation) {
    pick(commendation.recognitionCategory, T.CE_RECOGNITION_CATEGORIES, "Recognition category")
    pick(commendation.recognitionSource, T.CE_RECOGNITION_SOURCES, "Recognition source")
    pick(commendation.recognitionLevel, T.CE_RECOGNITION_LEVELS, "Recognition level")
    pick(commendation.positiveBehaviorCategory, T.CE_POSITIVE_BEHAVIORS, "Positive behavior category")
    pick(commendation.shareConsent, T.CE_YES_NO_UNKNOWN, "Share consent")
    if (!commendation.recognizedPartyId) err("A commendation needs a recognized party (use an Unidentified party if the name is not known).")
    else if (!partyIds.has(commendation.recognizedPartyId)) err("The recognized party does not exist.")
    else if (!partyHas(commendation.recognizedPartyId, "RECOGNIZED_PARTY")) err("The recognized party needs the Recognized Party capacity.")
    refs(commendation.evidenceIds, "The commendation")
  }

  // Site Behavior: person behavior and site condition are separate records ---------------------
  ids(behaviorItems, "Site behavior")
  for (const behavior of readCustomerBehaviors(data)) {
    if (!behavior.subjectPartyId) err("A person-behavior record needs the party who is the subject of the observation.")
    else if (!partyIds.has(behavior.subjectPartyId)) err("A person-behavior record references a subject party that does not exist.")
    else {
      if (!partyHas(behavior.subjectPartyId, "SUBJECT")) err("The subject of an observation needs the Subject capacity.")
      if (partyHas(behavior.subjectPartyId, "OBSERVER")) err("The observer and the subject of an observation must be distinct: a party cannot hold both capacities.")
    }
    if (!behavior.description) err("A person-behavior record needs a description of what was observed.")
    pick(behavior.primaryCategory, T.CE_BEHAVIOR_CATEGORIES, "Behavior category")
    if (behavior.secondaryCategories.length) {
      if (!behavior.primaryCategory) err("Choose the primary behavior category before secondary categories.")
      if (hasDup(behavior.secondaryCategories)) err("A secondary behavior category is listed more than once.")
      for (const category of behavior.secondaryCategories) { pick(category, T.CE_BEHAVIOR_CATEGORIES, "Secondary behavior category"); if (category === behavior.primaryCategory) err("A secondary behavior category cannot repeat the primary category.") }
    }
    pick(behavior.certainty, T.CE_CERTAINTIES, "Observation certainty")
    refs(behavior.evidenceIds, "A person-behavior record")
  }
  ids(conditionItems, "Site condition")
  for (const condition of readCustomerConditions(data)) {
    if (!condition.category) err("A site-condition record needs a category.")
    pick(condition.category, T.CE_SITE_CONDITION_CATEGORIES, "Site condition category")
    if (!condition.description) err("A site-condition record needs a description.")
    pick(condition.certainty, T.CE_CERTAINTIES, "Site condition certainty")
    pick(condition.immediateRisk, T.CE_YES_NO_UNKNOWN, "Immediate risk")
    refs(condition.evidenceIds, "A site-condition record")
  }

  // Immediate response ------------------------------------------------------------------
  step = "CE_RESPONSE"
  for (const key of CE_RESPONSE_FACT_KEYS) controlled(CE_DATA_POINTS[key], T.CE_YES_NO_UNKNOWN, CE_RESPONSE_FACT_LABELS[key])
  if (f(CE_DATA_POINTS.otherImmediateAction) === "YES" && !f(CE_DATA_POINTS.otherImmediateActionNote)) err("Describe the Other immediate action.")
  if (f(CE_DATA_POINTS.otherImmediateActionNote) && f(CE_DATA_POINTS.otherImmediateAction) !== "YES") err("An immediate-action note belongs only to Other = Yes.")
  const timelineItems = collectionOf(data, CID.TIMELINE)?.items || []
  ids(timelineItems, "Response step")
  const timeline = readCustomerTimeline(data)
  const ordinals = timeline.map((entry) => entry.ordinal)
  if (ordinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1)) err("Response ordinals must be positive whole numbers.")
  if (hasDup(ordinals.map(String))) err("Response ordinals must be unique.")
  let previous = ""
  for (const entry of timeline) {
    if (!entry.action) err("Every response step needs an action.")
    pick(entry.action, T.CE_RESPONSE_ACTIONS, "Response action")
    if (entry.action === "OTHER" && !entry.actionOther) err("Describe the Other response action.")
    if (entry.actionOther && entry.action !== "OTHER") err("An action description belongs only to the Other action.")
    dateTime(entry.timestamp, "A response timestamp")
    notBeforeOccurrence(entry.timestamp, "A response step")
    if (entry.timestamp && DATETIME.test(entry.timestamp)) { if (previous && earlier(entry.timestamp, previous)) err("Response steps must be in chronological order of their sequence numbers."); previous = entry.timestamp }
    refs(entry.evidenceIds, "A response step")
  }

  // Resolution, customer outcome, financial facts (Complaint / Site Behavior only) -------------------------
  const resolutionItems = collectionOf(data, CID.RESOLUTION)?.items || []
  const outcomeItems = collectionOf(data, CID.OUTCOME)?.items || []
  const financialItems = collectionOf(data, CID.FINANCIAL)?.items || []
  if (isCommendation && (resolutionItems.length || outcomeItems.length || financialItems.length)) err("Resolution, customer outcome and financial facts do not apply to a Commendation.")
  if (resolutionItems.length > 1) err("A Customer Event has one resolution record.")
  const resolution = readCustomerResolution(data)
  if (resolution) {
    pick(resolution.status, T.CE_RESOLUTION_STATUSES, "Resolution status")
    pick(resolution.responseProvided, T.CE_YES_NO_UNKNOWN, "Response provided")
    dateTime(resolution.responseProvidedAt, "The response provided time"); dateTime(resolution.resolutionProvidedAt, "The resolution provided time")
    notBeforeOccurrence(resolution.responseProvidedAt, "The response"); notBeforeOccurrence(resolution.resolutionProvidedAt, "The resolution")
    if (resolution.responseProvidedAt && resolution.responseProvided !== "YES") err("A response provided time needs Response provided = Yes.")
    if (resolution.resolutionProvidedAt && resolution.status !== "PROVIDED") err("A resolution provided time needs the resolution status Provided.")
    if (resolution.responseProvidedAt && resolution.resolutionProvidedAt && DATETIME.test(resolution.responseProvidedAt) && DATETIME.test(resolution.resolutionProvidedAt) && earlier(resolution.resolutionProvidedAt, resolution.responseProvidedAt)) err("The resolution cannot be provided before the response.")
    refs(resolution.evidenceIds, "The resolution")
  }
  if (outcomeItems.length > 1) err("A Customer Event has one customer-outcome record.")
  const outcome = readCustomerOutcome(data)
  if (outcome) {
    pick(outcome.followUpRequested, T.CE_YES_NO_UNKNOWN, "Follow-up requested")
    pick(outcome.acceptance, T.CE_CUSTOMER_ACCEPTANCES, "Customer acceptance")
    dateTime(outcome.customerResponseReceivedAt, "The customer response received time"); notBeforeOccurrence(outcome.customerResponseReceivedAt, "The customer response")
    // The customer reaction is checked against the TES response / resolution chronology only when those times are known. Nothing is invented.
    const provided = [resolution?.responseProvidedAt || "", resolution?.resolutionProvidedAt || ""].filter((value) => value && DATETIME.test(value)).sort()[0]
    if (outcome.customerResponseReceivedAt && DATETIME.test(outcome.customerResponseReceivedAt) && provided && earlier(outcome.customerResponseReceivedAt, provided)) err("The customer cannot respond before TES provided a response or resolution.")
    refs(outcome.evidenceIds, "The customer outcome")
  }
  if (financialItems.length > 1) err("A Customer Event has one set of financial facts.")
  if (financialItems[0]) {
    const facts = financialItems[0].facts
    for (const kind of T.CE_FINANCIAL_KINDS) {
      const value = facts[kind]; const currency = text(facts[`${kind}Currency`]); const basis = text(facts[`${kind}Basis`]); const label = T.CE_FINANCIAL_LABELS[kind]
      if (value === null || value === undefined) continue
      if (typeof value !== "number" || Number.isNaN(value) || value < 0) { err(`${label} must be zero or greater.`); continue }
      if (!currency) err(`${label} needs an ISO currency code.`); else if (!isSupportedCustomerCurrency(currency)) err(`${label} currency must be a valid ISO 4217 code.`)
      if (kind !== "revenueAtRisk") { if (!basis) err(`${label} needs a basis (Actual or Potential).`); else if (!inList(T.CE_FINANCIAL_BASES, basis)) err(`${label} basis must be Actual or Potential.`) }
    }
    if (facts.otherLabel && (facts.other === null || facts.other === undefined)) err("An Other financial label needs an Other amount.")
  }

  // Explicit workflow-control facts: independent of every outcome fact ------------------------------
  step = "CE_SUBTYPE"
  for (const key of CE_REQUIREMENT_KEYS) {
    const value = f(CE_DATA_POINTS[key])
    if (!value) continue
    if (value !== "YES" && value !== "NO") { err(`${T.CE_REQUIREMENT_FIELDS.find((item) => item.value === key)?.label || key} must be Yes or No.`); continue }
    if (key === "complaintAssessmentRequired" && subtype && !isComplaint) err("Complaint assessment can be required only for a Complaint.")
    if (key === "customerResponseRequired" && isCommendation) err("A customer response requirement does not apply to a Commendation.")
    if (key === "siteReviewRequired" && subtype && !isSite) err("Site review can be required only for a Site Behavior event.")
    if (key === "recognitionReviewRequired" && subtype && !isCommendation) err("Recognition review can be required only for a Commendation.")
  }
  const reviewItems = collectionOf(data, CID.REVIEWS)?.items || []
  ids(reviewItems, "Review")
  for (const review of readCustomerReviews(data)) {
    if (!inList(T.CE_REVIEW_TYPES, review.reviewType)) err("Review type must be a controlled value.")
    if (review.reviewType === "SITE" && subtype && !isSite) err("A site review belongs only to a Site Behavior event.")
    if (review.reviewType === "RECOGNITION" && subtype && !isCommendation) err("A recognition review belongs only to a Commendation.")
    if (!review.reviewedBy) err("A review record needs who reviewed it.")
    if (!review.reviewedAt) err("A review record needs when it was completed.")
    dateTime(review.reviewedAt, "The review time"); notBeforeOccurrence(review.reviewedAt, "The review")
    refs(review.evidenceIds, "A review")
  }
  step = "REVIEW"
  return issues
}

// ---------------------------------------------------------------------------
// Downstream enrichment writers (progressive enrichment; every result is re-validated; history is preserved)
// ---------------------------------------------------------------------------

const ID_PREFIX: Readonly<Record<string, string>> = { [CID.PARTIES]: "CEP", [CID.STATEMENTS]: "CES", [CID.CLAIMS]: "CEC", [CID.BEHAVIORS]: "CEB", [CID.CONDITIONS]: "CEK", [CID.TIMELINE]: "CER", [CID.REVIEWS]: "CEV" }
const SINGLE: Readonly<Record<string, string>> = { [CID.COMMENDATION]: FIXED_IDS.COMMENDATION, [CID.RESOLUTION]: FIXED_IDS.RESOLUTION, [CID.OUTCOME]: FIXED_IDS.OUTCOME, [CID.FINANCIAL]: FIXED_IDS.FINANCIAL }
const ITEM_TYPE: Readonly<Record<string, string>> = { [CID.PARTIES]: "CUSTOMER_EVENT_PARTY", [CID.STATEMENTS]: "CUSTOMER_EVENT_ORIGINAL_STATEMENT", [CID.CLAIMS]: "CUSTOMER_EVENT_COMPLAINT_CLAIM", [CID.BEHAVIORS]: "CUSTOMER_EVENT_SITE_PERSON_BEHAVIOR", [CID.CONDITIONS]: "CUSTOMER_EVENT_SITE_CONDITION", [CID.TIMELINE]: "CUSTOMER_EVENT_RESPONSE_STEP", [CID.REVIEWS]: "CUSTOMER_EVENT_REVIEW", [CID.COMMENDATION]: "CUSTOMER_EVENT_COMMENDATION", [CID.RESOLUTION]: "CUSTOMER_EVENT_RESOLUTION", [CID.OUTCOME]: "CUSTOMER_EVENT_OUTCOME", [CID.FINANCIAL]: "CUSTOMER_EVENT_FINANCIAL_FACTS" }
export const CE_EDITABLE_COLLECTIONS: readonly string[] = [...Object.keys(ID_PREFIX), ...Object.keys(SINGLE)]

const assertValid = <E extends CustomerEvent>(next: E): E => {
  const issues = validateNewCustomerEvent(next as unknown as NewCustomerCandidate)
  if (issues.length) throw new Error(issues[0])
  return next
}
const withCollections = <E extends CustomerEvent>(event: E, replaced: PerformanceChildCollection[]): E => ({ ...event, childCollections: [...(event.childCollections || []).filter((entry) => !replaced.some((next) => next.collectionId === entry.collectionId)), ...replaced] })

/**
 * Create or update ONE child record. Facts merge (null/blank clears a fact). The subtype can never be changed here, and a claim can never be
 * written as anything but Reported. The whole event is re-validated, so a downstream edit cannot leave the record inconsistent.
 */
export function upsertCustomerChild<E extends CustomerEvent>(event: E, input: { collectionId: string; itemId?: string; facts: Record<string, string | number | null>; evidenceIds?: string[]; now?: string }): { event: E; itemId: string } {
  if (!isNewTaxonomyCustomerEvent(event)) throw new Error("Legacy customer records cannot be enriched; they are read-only history.")
  if (!CE_EDITABLE_COLLECTIONS.includes(input.collectionId)) throw new Error("Unknown Customer Event record type.")
  const now = input.now || new Date().toISOString()
  const existing = collectionOf(event, input.collectionId)
  const single = SINGLE[input.collectionId]
  const current = single ? existing?.items[0] : input.itemId ? existing?.items.find((item) => item.itemId === input.itemId) : undefined
  if (!single && input.itemId && !current && !input.itemId.startsWith(ID_PREFIX[input.collectionId])) throw new Error("Customer Event record not found.")
  const facts = { ...(current?.facts || {}), ...input.facts } as Record<string, string | number | null>
  if (input.collectionId === CID.CLAIMS) facts.assertionStatus = T.CE_CLAIM_ASSERTION_REPORTED
  if (!current) {
    if (input.collectionId === CID.TIMELINE && facts.ordinal === undefined) facts.ordinal = Math.max(0, ...(existing?.items || []).map((item) => Number(item.facts.ordinal) || 0)) + 1
    if (input.collectionId === CID.REVIEWS && facts.reviewedAt === undefined) facts.reviewedAt = now.slice(0, 16)
  }
  for (const key of Object.keys(facts)) if (facts[key] === "") facts[key] = null
  const itemId = current?.itemId || single || input.itemId || newId(ID_PREFIX[input.collectionId])
  const nextItem: PerformanceChildFactItem = { itemId, facts, evidenceIds: input.evidenceIds ? unique(input.evidenceIds) : current?.evidenceIds || [] }
  const items = current ? (existing?.items || []).map((item) => (item.itemId === itemId ? nextItem : item)) : [...(existing?.items || []), nextItem]
  const next = withCollections(event, [{ collectionId: input.collectionId, collectionVersion: existing?.collectionVersion || "1.0", itemType: ITEM_TYPE[input.collectionId], completeness: "COMPLETE", items }])
  return { event: assertValid(next), itemId }
}

/** Set or clear an explicit workflow-control requirement. The prior value stays in append-only history. Never changes the subtype. */
export function setCustomerRequirement<E extends CustomerEvent>(event: E, input: { field: (typeof CE_REQUIREMENT_KEYS)[number]; to: "YES" | "NO"; changedBy: string; note?: string; at?: string }): E {
  if (!isNewTaxonomyCustomerEvent(event)) throw new Error("Legacy customer records cannot be changed; they are read-only history.")
  if (!CE_REQUIREMENT_KEYS.includes(input.field)) throw new Error("Unknown Customer Event requirement.")
  if (!text(input.changedBy)) throw new Error("changedBy is required.")
  if (input.to !== "YES" && input.to !== "NO") throw new Error("A requirement must be Yes or No.")
  const dataPointId = CE_DATA_POINTS[input.field]
  const from = factText(event, dataPointId)
  const at = input.at || new Date().toISOString()
  const facts = (event.structuredEventFacts || []).filter((fact) => fact.dataPointId !== dataPointId)
  const nextFact: StructuredEventFact = { dataPointId, value: input.to, valueType: "string" }
  const entry: PerformanceChildFactItem = { itemId: newId("CEH"), facts: { field: input.field, fromValue: from || null, toValue: input.to, changedAt: at, changedBy: text(input.changedBy), note: text(input.note) || null }, evidenceIds: [] }
  const history = collectionOf(event, CID.STATUS_HISTORY)
  const next = withCollections({ ...event, structuredEventFacts: [...facts, nextFact] }, [{ collectionId: CID.STATUS_HISTORY, collectionVersion: "1.0", itemType: "CUSTOMER_EVENT_REQUIREMENT_CHANGE", completeness: "COMPLETE", items: [...(history?.items || []), entry] }])
  return assertValid(next)
}

// ---------------------------------------------------------------------------
// Workflow provider (registered with the common workflow engine)
// ---------------------------------------------------------------------------

const hasSubstantiation = (state: PerformanceFoundationState, eventId: string) => {
  for (const investigation of getInvestigationsForEvent(state, eventId)) { const determination = getActiveDetermination(state, investigation.id, "SUBSTANTIATION"); if (determination) return determination }
  return undefined
}

/**
 * A bare Customer Event creates NO obligation, and the subtype alone never does. Obligations come ONLY from explicit stored facts:
 *   Complaint assessment required = Yes and no active substantiation           -> COMPLAINT_ASSESSMENT_PENDING
 *   Customer response required = Yes and no explicit response provided         -> CUSTOMER_RESPONSE_PENDING
 *   Site review required = Yes and no completed site review record             -> SITE_REVIEW_REQUIRED
 *   Recognition review required = Yes and no completed recognition review      -> RECOGNITION_REVIEW_PENDING
 * Customer acceptance or rejection, a substantiation finding, category, impact, financial amounts and site conditions are never obligations.
 * Investigation, Company Actions, verification and follow-up come from the common providers.
 */
export const customerEventWorkflowProvider: WorkflowProvider = {
  id: "customer-event",
  collect(foundationEvent: FoundationEvent, state: PerformanceFoundationState): WorkflowObligation[] {
    if (foundationEvent.eventType !== "Customer Event") return []
    const event = foundationEvent as CustomerEvent & FoundationEvent
    if (!isNewTaxonomyCustomerEvent(event)) return []
    const out: WorkflowObligation[] = []
    const history = readCustomerStatusHistory(event)
    const createdAtOf = (field: string) => history.filter((entry) => entry.field === field && entry.to === "YES").pop()?.changedAt || event.createdAt
    const required = (key: (typeof CE_REQUIREMENT_KEYS)[number]) => factText(event, CE_DATA_POINTS[key]) === "YES"
    const source = (suffix: string) => ({ type: "CustomerRequirement", id: `${event.id}#${suffix}` })
    if (required("complaintAssessmentRequired")) {
      const determination = hasSubstantiation(state, event.id)
      out.push(makeObligation("COMPLAINT_ASSESSMENT_PENDING", source("assessment"), Boolean(determination), { createdAt: createdAtOf("complaintAssessmentRequired"), kind: "OBLIGATION", resolvedAt: determination?.createdAt, resolvedBy: determination?.determinedBy }))
    }
    if (required("customerResponseRequired")) {
      const resolution = readCustomerResolution(event)
      const provided = resolution?.responseProvided === "YES"
      out.push(makeObligation("CUSTOMER_RESPONSE_PENDING", source("response"), provided, { createdAt: createdAtOf("customerResponseRequired"), kind: "OBLIGATION", resolvedAt: resolution?.responseProvidedAt || undefined }))
    }
    const reviews = readCustomerReviews(event)
    if (required("siteReviewRequired")) {
      const done = reviews.find((review) => review.reviewType === "SITE")
      out.push(makeObligation("SITE_REVIEW_REQUIRED", source("site-review"), Boolean(done), { createdAt: createdAtOf("siteReviewRequired"), kind: "REVIEW", resolvedAt: done?.reviewedAt, resolvedBy: done?.reviewedBy }))
    }
    if (required("recognitionReviewRequired")) {
      const done = reviews.find((review) => review.reviewType === "RECOGNITION")
      out.push(makeObligation("RECOGNITION_REVIEW_PENDING", source("recognition-review"), Boolean(done), { createdAt: createdAtOf("recognitionReviewRequired"), kind: "REVIEW", resolvedAt: done?.reviewedAt, resolvedBy: done?.reviewedBy }))
    }
    return out
  },
}

// ---------------------------------------------------------------------------
// Presentation (neutral language; labels only, never used for business comparisons)
// ---------------------------------------------------------------------------

const moneyLabel = (money: CustomerMoney | undefined) => (money ? `${money.value.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${money.currencyCode}${money.basis ? ` (${L(T.CE_FINANCIAL_BASES, money.basis)})` : ""}` : undefined)

export function describeCustomerEvent(event: CustomerEvent) {
  const parties = readCustomerParties(event)
  const partyName = (id: string) => { const party = parties.find((entry) => entry.itemId === id); return party ? [party.name || L(T.CE_PERSON_TYPES, party.personType) || "Unnamed party", party.organization].filter(Boolean).join(" - ") : id }
  const fact = (key: keyof typeof CE_DATA_POINTS) => factText(event, CE_DATA_POINTS[key])
  const subtype = customerEventSubtype(event)
  const owning = deriveOwningDriverRole(event)
  const financial = readCustomerFinancial(event)
  const row = (label: string, key: keyof typeof CE_DATA_POINTS) => ({ label, value: fact(key) })
  return {
    subtype, subtypeLabel: L(T.CE_SUBTYPES, subtype) || undefined, intakeChannel: L(T.CE_INTAKE_CHANNELS, fact("intakeChannel")) || undefined,
    owningDriver: { recorded: owning.recorded, roles: owning.labels, text: owning.recorded ? `Owning driver's role: ${owning.labels.join(", ")}` : "Owning driver's role not recorded" },
    time: {
      precision: L(T.CE_OCCURRENCE_PRECISIONS, event.occurrencePrecision) || undefined, timeZone: fact("eventTimeZone") || undefined, windowStart: fact("windowStart") || undefined, windowEnd: fact("windowEnd") || undefined, windowBasis: fact("windowBasis") || undefined,
      discovery: [fact("discoveryDate"), fact("discoveryTime")].filter(Boolean).join(" ") || undefined, received: [text(event.reportedDate), fact("reportedTime")].filter(Boolean).join(" ") || undefined, delays: deriveCustomerTimingDelays(event),
    },
    customer: [row("Customer", "customerName"), row("Customer role", "customerRole"), row("Customer contact", "customerContact"), row("Customer site / facility", "customerSite"), row("Site area / dock / yard", "siteArea"), row("Shipper", "shipperName"), row("Receiver", "receiverName"), row("Broker", "brokerName")].filter((r) => r.value),
    operations: [row("Load Reference", "loadReference"), row("Shipment Reference", "shipmentReference"), row("BOL / PRO", "bolPro"), row("Origin", "origin"), row("Destination", "destination"), row("Appointment Reference", "appointmentReference"), row("Route Reference", "routeReference"), row("Service Type", "serviceType"), row("Operating Stage", "operatingStage")].filter((r) => r.value),
    summary: text(event.summary) || undefined, normalizedNarrative: fact("normalizedNarrative") || undefined,
    parties: parties.map((party) => ({ id: party.itemId, name: party.name || undefined, organization: party.organization || undefined, personType: L(T.CE_PERSON_TYPES, party.personType) || undefined, capacities: party.capacities.map((value) => L(T.CE_CAPACITIES, value)), owningDriver: Boolean(party.linkedDriverMasterId), certainty: L(T.CE_IDENTIFICATION_CERTAINTIES, party.certainty) || undefined, access: L(T.CE_ACCESS_CLASSES, party.accessClassification) || undefined })),
    statements: readCustomerStatements(event).map((statement) => ({ id: statement.itemId, text: statement.text, from: statement.providedByPartyId ? partyName(statement.providedByPartyId) : undefined, access: L(T.CE_ACCESS_CLASSES, statement.accessClassification) || undefined })),
    complaint: subtype === "COMPLAINT" ? {
      primaryCategory: L(T.CE_COMPLAINT_CATEGORIES, fact("complaintPrimaryCategory")) || undefined, secondaryCategories: secondaryCategoriesOf(event).map((value) => L(T.CE_COMPLAINT_CATEGORIES, value)),
      claims: readCustomerClaims(event).map((claim) => ({ id: claim.itemId, type: L(T.CE_CLAIM_TYPES, claim.claimType), reportedStatement: claim.reportedStatement || undefined, reportedIssue: claim.reportedIssue || undefined, source: L(T.CE_CLAIM_SOURCES, claim.source) || undefined, status: "Reported (not established)" })),
      impact: { customerImpactNote: fact("customerImpactNote") || undefined, operationalInterruption: L(T.CE_YES_NO_UNKNOWN, fact("operationalInterruption")) || undefined, safetySignificance: L(T.CE_YES_NO_UNKNOWN, fact("safetySignificance")) || undefined, regulatorySignificance: L(T.CE_YES_NO_UNKNOWN, fact("regulatorySignificance")) || undefined },
    } : undefined,
    commendation: (() => { const c = readCustomerCommendation(event); return c ? { category: L(T.CE_RECOGNITION_CATEGORIES, c.recognitionCategory) || undefined, recognizedParty: c.recognizedPartyId ? partyName(c.recognizedPartyId) : undefined, source: L(T.CE_RECOGNITION_SOURCES, c.recognitionSource) || undefined, level: L(T.CE_RECOGNITION_LEVELS, c.recognitionLevel) || undefined, positiveBehavior: L(T.CE_POSITIVE_BEHAVIORS, c.positiveBehaviorCategory) || undefined, positiveBehaviorDescription: c.positiveBehaviorDescription || undefined, businessImpactNote: c.businessImpactNote || undefined, recognitionAction: c.recognitionAction || undefined, shareConsent: L(T.CE_YES_NO_UNKNOWN, c.shareConsent) || undefined } : undefined })(),
    behaviors: readCustomerBehaviors(event).map((b) => ({ id: b.itemId, subject: b.subjectPartyId ? partyName(b.subjectPartyId) : undefined, primaryCategory: L(T.CE_BEHAVIOR_CATEGORIES, b.primaryCategory) || undefined, secondaryCategories: b.secondaryCategories.map((value) => L(T.CE_BEHAVIOR_CATEGORIES, value)), description: b.description, certainty: L(T.CE_CERTAINTIES, b.certainty) || undefined })),
    conditions: readCustomerConditions(event).map((k) => ({ id: k.itemId, category: L(T.CE_SITE_CONDITION_CATEGORIES, k.category), description: k.description, certainty: L(T.CE_CERTAINTIES, k.certainty) || undefined, immediateRisk: L(T.CE_YES_NO_UNKNOWN, k.immediateRisk) || undefined })),
    response: CE_RESPONSE_FACT_KEYS.map((key) => ({ key, label: CE_RESPONSE_FACT_LABELS[key], value: L(T.CE_YES_NO_UNKNOWN, fact(key)) })).filter((r) => r.value),
    responseNote: fact("otherImmediateActionNote") || undefined,
    timeline: readCustomerTimeline(event).map((s) => ({ id: s.itemId, ordinal: s.ordinal, action: s.action === "OTHER" && s.actionOther ? `Other: ${s.actionOther}` : L(T.CE_RESPONSE_ACTIONS, s.action), timestamp: s.timestamp || undefined, actor: s.actor || undefined, note: s.note || undefined })),
    responseDelays: deriveCustomerResponseDelays(event),
    resolution: (() => { const r = readCustomerResolution(event); return r ? { status: L(T.CE_RESOLUTION_STATUSES, r.status) || undefined, summary: r.summary || undefined, responseProvided: L(T.CE_YES_NO_UNKNOWN, r.responseProvided) || undefined, responseProvidedAt: r.responseProvidedAt || undefined, resolutionProvidedAt: r.resolutionProvidedAt || undefined, owner: r.owner || undefined } : undefined })(),
    outcome: (() => { const c = readCustomerOutcome(event); return c ? { acceptance: L(T.CE_CUSTOMER_ACCEPTANCES, c.acceptance) || undefined, customerResponseReceivedAt: c.customerResponseReceivedAt || undefined, followUpRequested: L(T.CE_YES_NO_UNKNOWN, c.followUpRequested) || undefined, note: c.note || undefined } : undefined })(),
    /** Combined chronology READ from the two canonical records (Resolution owns the TES response times; Customer Outcome owns the customer reaction). Nothing is copied. */
    chronology: (() => { const r = readCustomerResolution(event); const c = readCustomerOutcome(event); return [r?.responseProvidedAt && { label: "TES response provided", at: r.responseProvidedAt }, r?.resolutionProvidedAt && { label: "Resolution provided", at: r.resolutionProvidedAt }, c?.customerResponseReceivedAt && { label: "Customer response received", at: c.customerResponseReceivedAt }].filter((row): row is { label: string; at: string } => Boolean(row)).sort((a, b) => a.at.localeCompare(b.at)) })(),
    financial: financial ? { rows: financial.rows.map((r) => ({ kind: r.kind, label: r.kind === "other" && financial.otherLabel ? `Other: ${financial.otherLabel}` : T.CE_FINANCIAL_LABELS[r.kind], amount: moneyLabel(r.money) as string })) } : undefined,
    requirements: CE_REQUIREMENT_KEYS.map((key) => ({ key, label: T.CE_REQUIREMENT_FIELDS.find((item) => item.value === key)?.label || key, value: L(T.CE_YES_NO, fact(key)) })).filter((r) => r.value),
    reviews: readCustomerReviews(event).map((r) => ({ id: r.itemId, type: L(T.CE_REVIEW_TYPES, r.reviewType), by: r.reviewedBy, at: r.reviewedAt, note: r.note || undefined })),
    statusHistory: readCustomerStatusHistory(event).map((entry) => ({ field: T.CE_REQUIREMENT_FIELDS.find((item) => item.value === entry.field)?.label || entry.field, from: entry.from || undefined, to: entry.to, by: entry.changedBy, at: entry.changedAt, note: entry.note || undefined })),
  }
}
export type CustomerEventDescription = ReturnType<typeof describeCustomerEvent>

/** Legacy Customer Complaint / Commendation / Customer-Site Behavior: read-only compatibility readback. Nothing is mapped into the new model. */
export function describeLegacyCustomerEvent(event: CustomerEvent & { complaintDetails?: Record<string, unknown>; commendationDetails?: Record<string, unknown> }) {
  const value = (suffix: string) => event.structuredEventFacts?.find((fact) => fact.dataPointId.endsWith(`.${suffix}`))?.value
  const t = (suffix: string) => text(value(suffix)) || undefined
  const kind = event.eventType === "Customer Commendation" ? ("COMMENDATION" as const) : event.eventType === "Customer-Site Behavior" ? ("SITE_BEHAVIOR" as const) : ("COMPLAINT" as const)
  const details = (event.complaintDetails || event.commendationDetails || {}) as Record<string, unknown>
  return {
    kind, source: text(event.provenance?.source) || undefined, customerName: t("CUSTOMERNAME"),
    complaintCategory: t("COMPLAINTCATEGORY"), receivedDate: t("RECEIVEDDATE"), complaintNarrative: t("COMPLAINTNARRATIVE"), substantiationStatus: t("SUBSTANTIATIONSTATUS") || (text(details.substantiationStatus) || undefined),
    reviewNotes: text(details.reviewNotes) || undefined, loadNumber: text(details.loadNumber) || undefined,
    commendationType: t("COMMENDATIONTYPE"), recognizedBy: t("RECOGNIZEDBY"), recognitionDate: t("RECOGNITIONDATE"), recognitionNarrative: t("RECOGNITIONNARRATIVE"),
    behaviorType: t("BEHAVIORTYPE"), behaviorNarrative: t("BEHAVIORNARRATIVE"),
  }
}

export function buildCustomerEventSummary(event: CustomerEvent) {
  const d = describeCustomerEvent(event)
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(event.eventDate || "")
  const date = match ? `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}` : event.eventDate || ""
  const customer = d.customer.find((row) => row.label === "Customer")?.value
  const category = d.subtype === "COMPLAINT" ? d.complaint?.primaryCategory : d.subtype === "COMMENDATION" ? d.commendation?.positiveBehavior : d.behaviors[0]?.primaryCategory || d.conditions[0]?.category
  return { title: "Customer Event", subtypeLine: [d.subtypeLabel, category].filter(Boolean).join(" - ") || undefined, contextLine: [date, customer, text(event.summary)].filter(Boolean).join(" · ") }
}

/**
 * Driver Performance counter bucket. A canonical Customer Event counts through its subtype; legacy records keep counting through their own
 * stored type, so nothing is counted twice. Presentation counters only: no weighting, score or severity.
 */
export function customerEventCounterBucket(event: CustomerEvent): "complaint" | "commendation" | "operational" | undefined {
  if (event.eventType === "Customer Complaint") return "complaint"
  if (event.eventType === "Customer Commendation") return "commendation"
  if (event.eventType === "Customer-Site Behavior") return "operational"
  const subtype = customerEventSubtype(event)
  return subtype === "COMPLAINT" ? "complaint" : subtype === "COMMENDATION" ? "commendation" : subtype === "SITE_BEHAVIOR" ? "operational" : undefined
}
