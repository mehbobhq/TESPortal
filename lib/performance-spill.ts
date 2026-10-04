/**
 * Spill or Release - one top-level Performance Event.
 *
 * Semantic chain kept separate at every step:
 *   reported observation -> canonical fact -> interpretation -> determination -> action.
 *
 * Spill owns the occurrence facts: material records, release facts (determination / condition / cleanup status are three
 * different dimensions), quantities, people, environmental media, the response timeline, cleanup records and the regulatory
 * assessment / execution child records. Root cause, preventability, responsibility, contributing factors and conclusions belong
 * to the common investigation engine. A release mechanism is occurrence information, never a root cause.
 *
 * There is NO regulatory rules engine here: no reportable quantities, thresholds or jurisdiction logic. Workflow obligations are
 * driven only by explicit stored states. Unknown stays distinct from zero, No, Not Required and Not Observed.
 *
 * Pure functions over the stored event shape. Business logic compares canonical values; labels are presentation only.
 * Legacy Spill / Release records (no release determination) are read-only history and are never rewritten or reinterpreted.
 */

import type { CanonicalEntityLink, PerformanceChildCollection, PerformanceChildFactItem, PerformanceEventRecord, StructuredEventFact } from "@/types/drivers"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import * as taxonomy from "./performance-spill-taxonomy.ts"
import type { FoundationEvent, PerformanceFoundationState } from "@/lib/performance-foundation-state"
import type { WorkflowObligation, WorkflowProvider } from "@/lib/performance-workflow"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import { makeObligation } from "./performance-workflow.ts"

type Option = { value: string; label: string }
const T = taxonomy as unknown as Record<string, readonly Option[]> & {
  SPILL_COLLECTION_IDS: Readonly<Record<"MATERIALS" | "QUANTITIES" | "PERSONS" | "ENVIRONMENTAL_MEDIA" | "RESPONSE_TIMELINE" | "CLEANUP" | "REGULATORY_ASSESSMENTS" | "REGULATORY_EXECUTIONS" | "FINANCIAL" | "STATUS_HISTORY", string>>
  spillOptionLabel: (list: readonly Option[], value: string | null | undefined) => string
  spillValues: (list: readonly Option[]) => string[]
}
const CID = T.SPILL_COLLECTION_IDS
const L = (list: readonly Option[], value: unknown) => T.spillOptionLabel(list, typeof value === "string" ? value : undefined)
const inList = (list: readonly Option[], value: string) => T.spillValues(list).includes(value)

export type SpillEvent = Pick<PerformanceEventRecord, "id" | "eventType"> &
  Partial<Pick<PerformanceEventRecord, "driverMasterId" | "eventDate" | "eventTime" | "reportedDate" | "occurrencePrecision" | "location" | "city" | "stateProvince" | "country" | "vehicleId" | "canonicalLinks" | "structuredEventFacts" | "structuredFacts" | "childCollections" | "evidenceIds" | "provenance" | "summary" | "createdAt">>

/** Stable data point ids (mirrors lib/driver-performance-schema.ts; a test asserts they match the registry). */
const dp = (suffix: string) => `DRV.PERF.SPILL_RELEASE.${suffix}`
export const SPILL_DATA_POINTS = {
  releaseDetermination: dp("RELEASE_DETERMINATION"), releaseCondition: dp("RELEASE_CONDITION"), cleanupStatus: dp("CLEANUP_STATUS"), releaseForm: dp("RELEASE_FORM"), releaseMechanism: dp("RELEASE_MECHANISM"), releaseMechanismOther: dp("RELEASE_MECHANISM_OTHER"),
  sourceCategory: dp("SOURCE_CATEGORY"), sourceSubsystem: dp("SOURCE_SUBSYSTEM"), sourceComponent: dp("SOURCE_COMPONENT"),
  windowStart: dp("OCCURRENCE_WINDOW_START"), windowEnd: dp("OCCURRENCE_WINDOW_END"), windowBasis: dp("OCCURRENCE_WINDOW_BASIS"), discoveryDate: dp("DISCOVERY_DATE"), discoveryTime: dp("DISCOVERY_TIME"), reportedTime: dp("REPORTED_TIME"), eventTimeZone: dp("EVENT_TIME_ZONE"),
  loadReference: dp("LOAD_REFERENCE"), bolPro: dp("BOL_PRO"), shipmentReference: dp("SHIPMENT_REFERENCE"), customerName: dp("CUSTOMER_NAME"), shipperName: dp("SHIPPER_NAME"), receiverName: dp("RECEIVER_NAME"),
  origin: dp("ORIGIN"), destination: dp("DESTINATION"), facilitySite: dp("FACILITY_SITE"), routeReference: dp("ROUTE_REFERENCE"), operatingStage: dp("OPERATING_STAGE"),
  waterwayRisk: dp("RISK_WATERWAY"), publicExposureRisk: dp("RISK_PUBLIC_EXPOSURE"), continuingDanger: dp("RISK_CONTINUING_DANGER"),
  roadwayInterruption: dp("IMPACT_ROADWAY_INTERRUPTION"), operationalInterruption: dp("IMPACT_OPERATIONAL_INTERRUPTION"), serviceImpact: dp("IMPACT_SERVICE"), otherImpactNote: dp("IMPACT_OTHER_NOTE"),
  vehicleStopped: dp("RESPONSE_VEHICLE_STOPPED"), engineShutOff: dp("RESPONSE_ENGINE_SHUT_OFF"), valveClosed: dp("RESPONSE_VALVE_CLOSED"), absorbentApplied: dp("RESPONSE_ABSORBENT_APPLIED"), drainProtected: dp("RESPONSE_DRAIN_PROTECTED"),
  dispatchContacted: dp("RESPONSE_DISPATCH_CONTACTED"), emergencyServicesContacted: dp("RESPONSE_EMERGENCY_SERVICES_CONTACTED"), evacuationPerformed: dp("RESPONSE_EVACUATION"), hazmatResponseContacted: dp("RESPONSE_HAZMAT_RESPONSE_CONTACTED"),
  areaSecured: dp("RESPONSE_AREA_SECURED"), ignitionSourcesRemoved: dp("RESPONSE_IGNITION_SOURCES_REMOVED"), ppeUsed: dp("RESPONSE_PPE_USED"),
  reporterNarrative: dp("RESPONSENOTES"),
} as const

export const SPILL_RESPONSE_FACT_KEYS = ["vehicleStopped", "engineShutOff", "valveClosed", "absorbentApplied", "drainProtected", "dispatchContacted", "emergencyServicesContacted", "evacuationPerformed", "hazmatResponseContacted", "areaSecured", "ignitionSourcesRemoved", "ppeUsed"] as const
export const SPILL_RISK_FACT_KEYS = ["waterwayRisk", "publicExposureRisk", "continuingDanger"] as const
export const SPILL_IMPACT_FACT_KEYS = ["roadwayInterruption", "operationalInterruption", "serviceImpact"] as const
export const SPILL_RESPONSE_FACT_LABELS: Readonly<Record<string, string>> = {
  vehicleStopped: "Vehicle Stopped", engineShutOff: "Engine Shut Off", valveClosed: "Valve Closed", absorbentApplied: "Absorbent Applied", drainProtected: "Drain Protected", dispatchContacted: "Dispatch Contacted",
  emergencyServicesContacted: "911 / Emergency Services Contacted", evacuationPerformed: "Evacuation Performed", hazmatResponseContacted: "Hazmat Response Contacted", areaSecured: "Area Secured", ignitionSourcesRemoved: "Ignition Sources Removed", ppeUsed: "PPE Used",
  waterwayRisk: "Waterway Risk", publicExposureRisk: "Public Exposure Risk", continuingDanger: "Continuing Danger", roadwayInterruption: "Roadway Interruption", operationalInterruption: "Operational Interruption", serviceImpact: "Service Impact",
}
const LEGACY_SUFFIXES = { material: "MATERIAL", quantity: "QUANTITYRELEASED", environment: "RELEASEENVIRONMENT", containment: "CONTAINMENTPERFORMED", emergency: "EMERGENCYRESPONSE", notes: "RESPONSENOTES" } as const

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")
export function spillFact(event: Pick<SpillEvent, "structuredEventFacts">, dataPointId: string): StructuredEventFact["value"] | undefined {
  return event.structuredEventFacts?.find((fact) => fact.dataPointId === dataPointId)?.value
}
const factText = (event: SpillEvent, id: string) => text(spillFact(event, id))

export const isSpillRelease = (event: Pick<SpillEvent, "eventType">) => event.eventType === "Spill or Release"
/** New-taxonomy records carry the Release Determination data point; every other Spill / Release record is legacy. */
export const isNewTaxonomySpill = (event: SpillEvent) => isSpillRelease(event) && Boolean(factText(event, SPILL_DATA_POINTS.releaseDetermination))
export const isLegacySpill = (event: SpillEvent) => isSpillRelease(event) && !isNewTaxonomySpill(event)

// ---------------------------------------------------------------------------
// Money: { value, currencyCode } stored as <name> + <name>Currency scalar child facts. Local to Spill (no shared accounting primitive).
// ---------------------------------------------------------------------------

export interface SpillMoney { value: number; currencyCode: string }
const SUPPORTED_CURRENCIES = (() => { try { return new Set<string>((Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf("currency")) } catch { return new Set<string>(["CAD", "USD"]) } })()
export const isSupportedSpillCurrency = (code: string) => /^[A-Z]{3}$/.test(code) && (SUPPORTED_CURRENCIES.has(code) || code === "CAD" || code === "USD")
const nullable = (value: unknown): string | number | null => (typeof value === "number" ? value : text(value) || null)
const numberOrNull = (value: string | number | undefined | null): number | null => { if (value === undefined || value === null || String(value).trim() === "") return null; const n = Number(value); return Number.isNaN(n) ? NaN : n }
const moneyFacts = (name: string, value: string | number | undefined, currency: string | undefined): Record<string, string | number | null> => { const amount = numberOrNull(value); return { [name]: amount, [`${name}Currency`]: amount === null ? null : text(currency) || null } }
export const readSpillMoney = (facts: Record<string, unknown>, name: string): SpillMoney | undefined => {
  const value = facts[name]; const currency = facts[`${name}Currency`]
  return typeof value === "number" && typeof currency === "string" && currency ? { value, currencyCode: currency } : undefined
}

// ---------------------------------------------------------------------------
// Wizard draft -> canonical child collections (pure, unit tested)
// ---------------------------------------------------------------------------

const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`
const unique = (items: readonly string[] | undefined) => [...new Set((items || []).filter(Boolean))]
const boolText = (value: boolean | undefined) => (value ? "YES" : null)

export interface SpillDraftMaterial {
  itemId: string; category: string; description: string; properShippingName: string; technicalName: string; unId: string; hazardClass: string; packingGroup: string; physicalState: string
  identificationStatus: string; materialSource: string; sdsStatus: string; sdsReference: string; placardRequired: string; placardDisplayed: string; shippingPapersStatus: string; notes: string; evidenceIds: string[]
}
export interface SpillDraftQuantity { itemId: string; dimension: string; materialId: string; value: string; unit: string; method: string; status: string; notes: string; evidenceIds: string[] }
export interface SpillDraftPerson { itemId: string; role: string; name: string; isEventDriver: boolean; exposureStatus: string; exposureRoute: string; symptomsReported: string; injuryStatus: string; injuryDescription: string; firstAid: string; medicalEvaluation: string; transported: string; hospitalized: string; fatality: string; notes: string; accessClassification: string; evidenceIds: string[] }
export interface SpillDraftMedium { itemId: string; medium: string; impactStatus: string; note: string; evidenceIds: string[] }
export interface SpillDraftStep { itemId: string; ordinal: string; action: string; actionOther: string; timestamp: string; actor: string; location: string; source: string; notes: string; evidenceIds: string[] }
export interface SpillDraftCleanup {
  itemId: string; startedAt: string; completedAt: string; vendor: string; method: string; materialId: string; materialRemoved: string; quantityRemoved: string; quantityUnit: string; disposalMethod: string; disposalManifest: string; wasteClassification: string
  restorationStatus: string; verificationStatus: string; verificationNote: string; cost: string; costCurrency: string; notes: string; evidenceIds: string[]
}
export interface SpillDraftObligation {
  assessmentId: string; jurisdiction: string; authority: string; basis: string; assessmentStatus: string; assessmentNote: string
  executionId: string; notificationRequired: string; notificationDeadline: string; notificationStatus: string; notifiedAt: string; reportRequired: string; reportDeadline: string; reportStatus: string; submittedAt: string; reportControlNumber: string; submissionReference: string; evidenceIds: string[]
}
export interface SpillDraftFinancial { materialValue: string; materialValueCurrency: string; cleanupCost: string; cleanupCostCurrency: string; remediationCost: string; remediationCostCurrency: string; repairCost: string; repairCostCurrency: string }
export interface SpillDraft {
  materials: SpillDraftMaterial[]; quantities: SpillDraftQuantity[]; persons: SpillDraftPerson[]; media: SpillDraftMedium[]; steps: SpillDraftStep[]; cleanups: SpillDraftCleanup[]; obligations: SpillDraftObligation[]; financial: SpillDraftFinancial
  powerUnitId: string; trailerIds: string[]; precision: string
}

export const emptySpillMaterial = (): SpillDraftMaterial => ({ itemId: newId("SPM"), category: "", description: "", properShippingName: "", technicalName: "", unId: "", hazardClass: "", packingGroup: "", physicalState: "", identificationStatus: "", materialSource: "", sdsStatus: "", sdsReference: "", placardRequired: "", placardDisplayed: "", shippingPapersStatus: "", notes: "", evidenceIds: [] })
export const emptySpillQuantity = (): SpillDraftQuantity => ({ itemId: newId("SPQ"), dimension: "RELEASED", materialId: "", value: "", unit: "", method: "", status: "", notes: "", evidenceIds: [] })
export const emptySpillPerson = (): SpillDraftPerson => ({ itemId: newId("SPP"), role: "", name: "", isEventDriver: false, exposureStatus: "", exposureRoute: "", symptomsReported: "", injuryStatus: "", injuryDescription: "", firstAid: "", medicalEvaluation: "", transported: "", hospitalized: "", fatality: "", notes: "", accessClassification: "", evidenceIds: [] })
export const emptySpillMedium = (): SpillDraftMedium => ({ itemId: newId("SPE"), medium: "", impactStatus: "", note: "", evidenceIds: [] })
export const emptySpillStep = (ordinal: number): SpillDraftStep => ({ itemId: newId("SPR"), ordinal: String(ordinal), action: "", actionOther: "", timestamp: "", actor: "", location: "", source: "", notes: "", evidenceIds: [] })
export const emptySpillCleanup = (): SpillDraftCleanup => ({ itemId: newId("SPC"), startedAt: "", completedAt: "", vendor: "", method: "", materialId: "", materialRemoved: "", quantityRemoved: "", quantityUnit: "", disposalMethod: "", disposalManifest: "", wasteClassification: "", restorationStatus: "", verificationStatus: "", verificationNote: "", cost: "", costCurrency: "CAD", notes: "", evidenceIds: [] })
export const emptySpillObligation = (): SpillDraftObligation => ({ assessmentId: newId("SPA"), jurisdiction: "", authority: "", basis: "", assessmentStatus: "NOT_ASSESSED", assessmentNote: "", executionId: newId("SPX"), notificationRequired: "", notificationDeadline: "", notificationStatus: "", notifiedAt: "", reportRequired: "", reportDeadline: "", reportStatus: "", submittedAt: "", reportControlNumber: "", submissionReference: "", evidenceIds: [] })
export const emptySpillFinancial = (): SpillDraftFinancial => ({ materialValue: "", materialValueCurrency: "CAD", cleanupCost: "", cleanupCostCurrency: "CAD", remediationCost: "", remediationCostCurrency: "CAD", repairCost: "", repairCostCurrency: "CAD" })
export const emptySpillDraft = (): SpillDraft => ({ materials: [], quantities: [], persons: [], media: [], steps: [], cleanups: [], obligations: [], financial: emptySpillFinancial(), powerUnitId: "", trailerIds: [], precision: "EXACT_DATETIME" })

const child = (itemId: string, facts: Record<string, string | number | null>, evidenceIds: string[]): PerformanceChildFactItem => ({ itemId, facts, evidenceIds: unique(evidenceIds) })
const collection = (collectionId: string, itemType: string, items: PerformanceChildFactItem[]): PerformanceChildCollection | undefined => (items.length ? { collectionId, collectionVersion: "1.0", itemType, completeness: "COMPLETE", items } : undefined)

export function spillMaterialFacts(item: SpillDraftMaterial): Record<string, string | number | null> {
  return {
    category: nullable(item.category), description: nullable(item.description), properShippingName: nullable(item.properShippingName), technicalName: nullable(item.technicalName), unId: nullable(item.unId), hazardClass: nullable(item.hazardClass), packingGroup: nullable(item.packingGroup),
    physicalState: nullable(item.physicalState), identificationStatus: nullable(item.identificationStatus), materialSource: nullable(item.materialSource), sdsStatus: nullable(item.sdsStatus), sdsReference: nullable(item.sdsReference),
    placardRequired: nullable(item.placardRequired), placardDisplayed: nullable(item.placardDisplayed), shippingPapersStatus: nullable(item.shippingPapersStatus), notes: nullable(item.notes),
  }
}
export const spillFinancialIsEmpty = (financial: SpillDraftFinancial) => [financial.materialValue, financial.cleanupCost, financial.remediationCost, financial.repairCost].every((value) => String(value).trim() === "")

export function spillDraftToChildren(draft: SpillDraft, vehicles: ReadonlyArray<{ id: string; label: string }>, options: { driverMasterId?: string; now?: string } = {}) {
  const now = options.now || new Date().toISOString()
  const vehicleLabel = (id: string) => vehicles.find((vehicle) => vehicle.id === id)?.label || id
  const execution = (o: SpillDraftObligation) => [o.notificationRequired, o.notificationDeadline, o.notificationStatus, o.notifiedAt, o.reportRequired, o.reportDeadline, o.reportStatus, o.submittedAt, o.reportControlNumber, o.submissionReference].some((value) => text(value))
  const collections = [
    collection(CID.MATERIALS, "SPILL_MATERIAL", draft.materials.map((item) => child(item.itemId, spillMaterialFacts(item), item.evidenceIds))),
    collection(CID.QUANTITIES, "SPILL_QUANTITY", draft.quantities.map((item) => child(item.itemId, { dimension: nullable(item.dimension), materialId: nullable(item.materialId), value: numberOrNull(item.value), unit: nullable(item.unit), method: nullable(item.method), status: nullable(item.status), notes: nullable(item.notes) }, item.evidenceIds))),
    collection(CID.PERSONS, "SPILL_PERSON", draft.persons.map((item) => child(item.itemId, { role: nullable(item.role), name: nullable(item.name), linkedDriverMasterId: item.isEventDriver && options.driverMasterId ? options.driverMasterId : null, exposureStatus: nullable(item.exposureStatus), exposureRoute: nullable(item.exposureRoute), symptomsReported: nullable(item.symptomsReported), injuryStatus: nullable(item.injuryStatus), injuryDescription: item.injuryStatus === "YES" ? nullable(item.injuryDescription) : null, firstAid: nullable(item.firstAid), medicalEvaluation: nullable(item.medicalEvaluation), transported: nullable(item.transported), hospitalized: nullable(item.hospitalized), fatality: nullable(item.fatality), notes: nullable(item.notes), accessClassification: nullable(item.accessClassification) }, item.evidenceIds))),
    collection(CID.ENVIRONMENTAL_MEDIA, "SPILL_ENVIRONMENTAL_MEDIUM", draft.media.map((item) => child(item.itemId, { medium: nullable(item.medium), impactStatus: nullable(item.impactStatus), note: nullable(item.note) }, item.evidenceIds))),
    collection(CID.RESPONSE_TIMELINE, "SPILL_RESPONSE_STEP", draft.steps.map((item) => child(item.itemId, { ordinal: numberOrNull(item.ordinal), action: nullable(item.action), actionOther: nullable(item.actionOther), timestamp: nullable(item.timestamp), actor: nullable(item.actor), location: nullable(item.location), source: nullable(item.source), notes: nullable(item.notes) }, item.evidenceIds))),
    collection(CID.CLEANUP, "SPILL_CLEANUP", draft.cleanups.map((item) => child(item.itemId, {
      recordedAt: now, startedAt: nullable(item.startedAt), completedAt: nullable(item.completedAt), vendor: nullable(item.vendor), method: nullable(item.method), materialId: nullable(item.materialId), materialRemoved: nullable(item.materialRemoved), quantityRemoved: numberOrNull(item.quantityRemoved), quantityUnit: nullable(item.quantityUnit),
      disposalMethod: nullable(item.disposalMethod), disposalManifest: nullable(item.disposalManifest), wasteClassification: nullable(item.wasteClassification), restorationStatus: nullable(item.restorationStatus), verificationStatus: nullable(item.verificationStatus), verificationNote: nullable(item.verificationNote), ...moneyFacts("cost", item.cost, item.costCurrency), notes: nullable(item.notes),
    }, item.evidenceIds))),
    collection(CID.REGULATORY_ASSESSMENTS, "SPILL_REGULATORY_ASSESSMENT", draft.obligations.map((item) => child(item.assessmentId, { recordedAt: now, jurisdiction: nullable(item.jurisdiction), authority: nullable(item.authority), basis: nullable(item.basis), assessmentStatus: nullable(item.assessmentStatus), note: nullable(item.assessmentNote) }, []))),
    collection(CID.REGULATORY_EXECUTIONS, "SPILL_REGULATORY_EXECUTION", draft.obligations.filter(execution).map((item) => child(item.executionId, {
      assessmentId: item.assessmentId, recordedAt: now, notificationRequired: nullable(item.notificationRequired), notificationRequiredAt: item.notificationRequired === "YES" ? now : null, notificationDeadline: nullable(item.notificationDeadline), notificationStatus: nullable(item.notificationStatus), notifiedAt: nullable(item.notifiedAt),
      reportRequired: nullable(item.reportRequired), reportRequiredAt: item.reportRequired === "YES" ? now : null, reportDeadline: nullable(item.reportDeadline), reportStatus: nullable(item.reportStatus), submittedAt: nullable(item.submittedAt), reportControlNumber: nullable(item.reportControlNumber), submissionReference: nullable(item.submissionReference),
    }, item.evidenceIds))),
    spillFinancialIsEmpty(draft.financial) ? undefined : collection(CID.FINANCIAL, "SPILL_FINANCIAL_FACTS", [child("SPF-1", { ...moneyFacts("materialValue", draft.financial.materialValue, draft.financial.materialValueCurrency), ...moneyFacts("cleanupCost", draft.financial.cleanupCost, draft.financial.cleanupCostCurrency), ...moneyFacts("remediationCost", draft.financial.remediationCost, draft.financial.remediationCostCurrency), ...moneyFacts("repairCost", draft.financial.repairCost, draft.financial.repairCostCurrency) }, [])]),
  ].filter((entry): entry is PerformanceChildCollection => Boolean(entry))
  const canonicalLinks: CanonicalEntityLink[] = [
    ...(draft.powerUnitId ? [{ entityType: "Vehicle" as const, recordId: draft.powerUnitId, label: vehicleLabel(draft.powerUnitId), relationshipKey: "vehicle", source: "CANONICAL_STORE" as const }] : []),
    ...draft.trailerIds.map((id) => ({ entityType: "Trailer" as const, recordId: id, label: vehicleLabel(id), relationshipKey: "trailer", source: "CANONICAL_STORE" as const })),
  ]
  return { collections, canonicalLinks, vehicleId: draft.powerUnitId || undefined, occurrencePrecision: draft.precision }
}

// ---------------------------------------------------------------------------
// Readers (numbers stay numbers; unknown stays undefined, never zero)
// ---------------------------------------------------------------------------

const collectionOf = (event: Pick<SpillEvent, "childCollections">, id: string) => event.childCollections?.find((entry) => entry.collectionId === id)
const num = (facts: Record<string, unknown>, key: string) => (typeof facts[key] === "number" ? (facts[key] as number) : undefined)
const str = (facts: Record<string, unknown>, key: string) => text(facts[key])
type EventChildren = Pick<SpillEvent, "childCollections">

export function readSpillMaterials(event: EventChildren) {
  return (collectionOf(event, CID.MATERIALS)?.items || []).map((item) => ({
    itemId: item.itemId, category: str(item.facts, "category"), description: str(item.facts, "description"), properShippingName: str(item.facts, "properShippingName"), technicalName: str(item.facts, "technicalName"), unId: str(item.facts, "unId"), hazardClass: str(item.facts, "hazardClass"), packingGroup: str(item.facts, "packingGroup"),
    physicalState: str(item.facts, "physicalState"), identificationStatus: str(item.facts, "identificationStatus"), materialSource: str(item.facts, "materialSource"), sdsStatus: str(item.facts, "sdsStatus"), sdsReference: str(item.facts, "sdsReference"),
    placardRequired: str(item.facts, "placardRequired"), placardDisplayed: str(item.facts, "placardDisplayed"), shippingPapersStatus: str(item.facts, "shippingPapersStatus"), notes: str(item.facts, "notes"), evidenceIds: item.evidenceIds,
  }))
}
export function readSpillQuantities(event: EventChildren) {
  return (collectionOf(event, CID.QUANTITIES)?.items || []).map((item) => ({ itemId: item.itemId, dimension: str(item.facts, "dimension"), materialId: str(item.facts, "materialId"), value: num(item.facts, "value"), unit: str(item.facts, "unit"), method: str(item.facts, "method"), status: str(item.facts, "status"), notes: str(item.facts, "notes"), evidenceIds: item.evidenceIds }))
}
export function readSpillPersons(event: EventChildren) {
  return (collectionOf(event, CID.PERSONS)?.items || []).map((item) => ({
    itemId: item.itemId, role: str(item.facts, "role"), name: str(item.facts, "name"), linkedDriverMasterId: str(item.facts, "linkedDriverMasterId"), exposureStatus: str(item.facts, "exposureStatus"), exposureRoute: str(item.facts, "exposureRoute"), symptomsReported: str(item.facts, "symptomsReported"), injuryStatus: str(item.facts, "injuryStatus"), injuryDescription: str(item.facts, "injuryDescription"),
    firstAid: str(item.facts, "firstAid"), medicalEvaluation: str(item.facts, "medicalEvaluation"), transported: str(item.facts, "transported"), hospitalized: str(item.facts, "hospitalized"), fatality: str(item.facts, "fatality"), notes: str(item.facts, "notes"), accessClassification: str(item.facts, "accessClassification"), evidenceIds: item.evidenceIds,
  }))
}
export function readSpillMedia(event: EventChildren) {
  return (collectionOf(event, CID.ENVIRONMENTAL_MEDIA)?.items || []).map((item) => ({ itemId: item.itemId, medium: str(item.facts, "medium"), impactStatus: str(item.facts, "impactStatus"), note: str(item.facts, "note"), evidenceIds: item.evidenceIds }))
}
export function readSpillTimeline(event: EventChildren) {
  return (collectionOf(event, CID.RESPONSE_TIMELINE)?.items || []).map((item) => ({ itemId: item.itemId, ordinal: Number(item.facts.ordinal), action: str(item.facts, "action"), actionOther: str(item.facts, "actionOther"), timestamp: str(item.facts, "timestamp"), actor: str(item.facts, "actor"), location: str(item.facts, "location"), source: str(item.facts, "source"), notes: str(item.facts, "notes"), evidenceIds: item.evidenceIds }))
    .sort((a, b) => a.ordinal - b.ordinal || a.itemId.localeCompare(b.itemId))
}
export function readSpillCleanups(event: EventChildren) {
  return (collectionOf(event, CID.CLEANUP)?.items || []).map((item) => ({
    itemId: item.itemId, recordedAt: str(item.facts, "recordedAt"), startedAt: str(item.facts, "startedAt"), completedAt: str(item.facts, "completedAt"), vendor: str(item.facts, "vendor"), method: str(item.facts, "method"), materialId: str(item.facts, "materialId"), materialRemoved: str(item.facts, "materialRemoved"),
    quantityRemoved: num(item.facts, "quantityRemoved"), quantityUnit: str(item.facts, "quantityUnit"), disposalMethod: str(item.facts, "disposalMethod"), disposalManifest: str(item.facts, "disposalManifest"), wasteClassification: str(item.facts, "wasteClassification"),
    restorationStatus: str(item.facts, "restorationStatus"), verificationStatus: str(item.facts, "verificationStatus"), verificationNote: str(item.facts, "verificationNote"), cost: readSpillMoney(item.facts, "cost"), notes: str(item.facts, "notes"), evidenceIds: item.evidenceIds,
  }))
}
export function readSpillAssessments(event: EventChildren) {
  return (collectionOf(event, CID.REGULATORY_ASSESSMENTS)?.items || []).map((item) => ({ itemId: item.itemId, recordedAt: str(item.facts, "recordedAt"), jurisdiction: str(item.facts, "jurisdiction"), authority: str(item.facts, "authority"), basis: str(item.facts, "basis"), assessmentStatus: str(item.facts, "assessmentStatus"), note: str(item.facts, "note"), evidenceIds: item.evidenceIds }))
}
export function readSpillExecutions(event: EventChildren) {
  return (collectionOf(event, CID.REGULATORY_EXECUTIONS)?.items || []).map((item) => ({
    itemId: item.itemId, assessmentId: str(item.facts, "assessmentId"), recordedAt: str(item.facts, "recordedAt"), notificationRequired: str(item.facts, "notificationRequired"), notificationRequiredAt: str(item.facts, "notificationRequiredAt"), notificationDeadline: str(item.facts, "notificationDeadline"), notificationStatus: str(item.facts, "notificationStatus"), notifiedAt: str(item.facts, "notifiedAt"),
    reportRequired: str(item.facts, "reportRequired"), reportRequiredAt: str(item.facts, "reportRequiredAt"), reportDeadline: str(item.facts, "reportDeadline"), reportStatus: str(item.facts, "reportStatus"), submittedAt: str(item.facts, "submittedAt"), reportControlNumber: str(item.facts, "reportControlNumber"), submissionReference: str(item.facts, "submissionReference"), evidenceIds: item.evidenceIds,
  }))
}
export function readSpillFinancial(event: EventChildren) {
  const facts = collectionOf(event, CID.FINANCIAL)?.items[0]?.facts
  return facts ? { materialValue: readSpillMoney(facts, "materialValue"), cleanupCost: readSpillMoney(facts, "cleanupCost"), remediationCost: readSpillMoney(facts, "remediationCost"), repairCost: readSpillMoney(facts, "repairCost") } : undefined
}
export function readSpillStatusHistory(event: EventChildren) {
  return (collectionOf(event, CID.STATUS_HISTORY)?.items || []).map((item) => ({ itemId: item.itemId, field: str(item.facts, "field"), from: str(item.facts, "fromValue"), to: str(item.facts, "toValue"), changedAt: str(item.facts, "changedAt"), changedBy: str(item.facts, "changedBy"), note: str(item.facts, "note") }))
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.itemId.localeCompare(b.itemId))
}

// ---------------------------------------------------------------------------
// Derived values (never stored, never operator determinations)
// ---------------------------------------------------------------------------

export interface SpillPersonCounts { recorded: number; exposed: number; withSymptoms: number; injured: number; transported: number; hospitalized: number; fatalities: number }
/** Counts are derived from person records. There is no editable duplicate total. Undefined means no person records. */
export function deriveSpillPersonCounts(event: EventChildren): SpillPersonCounts | undefined {
  const persons = readSpillPersons(event)
  if (!persons.length) return undefined
  return {
    recorded: persons.length, exposed: persons.filter((person) => person.exposureStatus === "EXPOSED").length, withSymptoms: persons.filter((person) => person.symptomsReported === "YES").length, injured: persons.filter((person) => person.injuryStatus === "YES").length,
    transported: persons.filter((person) => person.transported === "YES").length, hospitalized: persons.filter((person) => person.hospitalized === "YES").length, fatalities: persons.filter((person) => person.fatality === "YES").length,
  }
}

const stampOf = (date: string | undefined, time: string | undefined) => (date ? (time ? `${date}T${time}` : date) : "")
const earlier = (a: string, b: string) => (a.length >= 16 && b.length >= 16 ? a.slice(0, 16) < b.slice(0, 16) : a.slice(0, 10) < b.slice(0, 10))
const MINUTES = (stamp: string) => { const ms = Date.parse(`${stamp.length === 10 ? `${stamp}T00:00` : stamp.slice(0, 16)}:00Z`); return Number.isNaN(ms) ? undefined : ms / 60000 }
const minutesBetween = (a: string, b: string) => { if (a.length < 16 || b.length < 16) return undefined; const x = MINUTES(a); const y = MINUTES(b); return x === undefined || y === undefined ? undefined : y - x }

/** Occurrence -> discovery -> report delays, derived only when both ends are exact enough. Never stored. */
export function deriveSpillTimingDelays(event: SpillEvent) {
  const occurrence = event.occurrencePrecision === "EXACT_DATETIME" ? stampOf(event.eventDate, event.eventTime) : ""
  const discovery = stampOf(factText(event, SPILL_DATA_POINTS.discoveryDate), factText(event, SPILL_DATA_POINTS.discoveryTime))
  const reported = stampOf(event.reportedDate, factText(event, SPILL_DATA_POINTS.reportedTime))
  return { occurrenceToDiscoveryMinutes: minutesBetween(occurrence, discovery), discoveryToReportMinutes: minutesBetween(discovery, reported), occurrenceToReportMinutes: minutesBetween(occurrence, reported) }
}
/** Latencies between response-timeline steps. Derived at read time; future BI derives the same way from the stored timestamps. */
export function deriveSpillResponseDelays(event: EventChildren) {
  const steps = readSpillTimeline(event)
  const at = (action: string) => steps.find((step) => step.action === action && step.timestamp)?.timestamp || ""
  const discovered = at("RELEASE_DISCOVERED")
  return {
    discoveryToEmergencyNotificationMinutes: minutesBetween(discovered, at("EMERGENCY_SERVICES_NOTIFIED")),
    discoveryToContainmentMinutes: minutesBetween(discovered, at("RELEASE_CONTAINED")),
    cleanupDurationMinutes: minutesBetween(at("CLEANUP_STARTED"), at("CLEANUP_COMPLETED")),
  }
}

// ---------------------------------------------------------------------------
// Validation (NEW records only; legacy Spill / Release records are never validated against these rules)
// ---------------------------------------------------------------------------

export type SpillValidationStep = "OCCURRENCE" | "SPILL_MATERIAL" | "SPILL_RELEASE" | "SPILL_OPERATIONS" | "SPILL_IMPACT" | "SPILL_RESPONSE" | "SPILL_CLEANUP" | "SPILL_REGULATORY" | "EVIDENCE" | "REVIEW"
export interface SpillValidationIssue { step: SpillValidationStep; message: string }
export type NewSpillCandidate = SpillEvent & { driverMasterId?: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const TIME = /^\d{2}:\d{2}$/
const hasDup = (items: readonly string[]) => items.some((item, index) => items.indexOf(item) !== index)
const IDENTITY_KEYS = ["properShippingName", "unId", "hazardClass", "packingGroup"] as const

export const validateNewSpillRelease = (data: NewSpillCandidate): string[] => validateNewSpillReleaseDetailed(data).map((issue) => issue.message)

export function validateNewSpillReleaseDetailed(data: NewSpillCandidate): SpillValidationIssue[] {
  const issues: SpillValidationIssue[] = []
  let step: SpillValidationStep = "OCCURRENCE"
  const err = (message: string) => { issues.push({ step, message }) }
  const f = (id: string) => factText(data, id)
  const controlled = (id: string, list: readonly Option[], name: string) => { const value = f(id); if (value && !inList(list, value)) err(`${name} must be a controlled value.`) }
  const evidence = new Set(data.evidenceIds || [])
  const refs = (ids: readonly string[], where: string) => { for (const id of ids) if (!evidence.has(id)) err(`${where} references evidence that is not linked to this Spill / Release: ${id}.`) }
  const pick = (value: string, list: readonly Option[], name: string) => { if (value && !inList(list, value)) err(`${name} must be a controlled value.`) }
  const nonNegative = (facts: Record<string, unknown>, key: string, label: string) => { const value = facts[key]; if (value !== null && value !== undefined && (typeof value !== "number" || Number.isNaN(value) || value < 0)) err(`${label} must be zero or greater.`) }
  const money = (facts: Record<string, unknown>, name: string, label: string) => {
    const value = facts[name]; const currency = text(facts[`${name}Currency`])
    if (value === null || value === undefined) return
    if (typeof value !== "number" || Number.isNaN(value) || value < 0) { err(`${label} must be zero or greater.`); return }
    if (!currency) err(`${label} needs an ISO currency code.`)
    else if (!isSupportedSpillCurrency(currency)) err(`${label} currency must be a valid ISO 4217 code.`)
  }
  const dateTime = (value: string, label: string) => { if (value && !DATETIME.test(value)) err(`${label} must be a valid date / time.`) }

  // Occurrence / time model --------------------------------------------------
  const precision = text(data.occurrencePrecision)
  if (!text(data.eventDate)) err("Event Date is required.")
  else if (!DATE.test(text(data.eventDate))) err("Event Date must be a valid date.")
  if (!inList(T.SPILL_OCCURRENCE_PRECISIONS, precision)) err("Occurrence precision must be exact, date only, approximate or unknown.")
  if (precision === "EXACT_DATETIME" && !text(data.eventTime)) err("Event Time is required when the occurrence is exact.")
  if (text(data.eventTime) && !TIME.test(text(data.eventTime))) err("Event Time must be a valid time.")
  if (!text(data.driverMasterId)) err("Driver is required.")
  if (!text(data.location)) err("Location is required.")
  if (!text(data.country)) err("Country is required.")
  if (!inList(T.SPILL_SOURCES, text(data.provenance?.source))) err("Source is required and must be a Spill / Release source.")
  const zone = f(SPILL_DATA_POINTS.eventTimeZone)
  if (zone) { try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }) } catch { err("Time zone must be a valid IANA zone.") } }
  const windowStart = f(SPILL_DATA_POINTS.windowStart); const windowEnd = f(SPILL_DATA_POINTS.windowEnd)
  if (windowStart || windowEnd) {
    if (!windowStart || !windowEnd) err("An estimated occurrence window needs both a start and an end.")
    else if (!DATETIME.test(windowStart) || !DATETIME.test(windowEnd)) err("The occurrence window must use valid dates / times.")
    else if (earlier(windowEnd, windowStart)) err("The occurrence window end cannot be before its start.")
  }
  const discoveryDate = f(SPILL_DATA_POINTS.discoveryDate); const discoveryTime = f(SPILL_DATA_POINTS.discoveryTime)
  if (discoveryTime && !discoveryDate) err("A discovery time needs a discovery date.")
  if (discoveryDate && !DATE.test(discoveryDate)) err("Discovery date must be a valid date.")
  if (discoveryTime && !TIME.test(discoveryTime)) err("Discovery time must be a valid time.")
  const reportedTime = f(SPILL_DATA_POINTS.reportedTime)
  if (reportedTime && !text(data.reportedDate)) err("A reported time needs a reported date.")
  const occurrenceEarliest = windowStart && DATETIME.test(windowStart) ? windowStart : precision === "UNKNOWN" ? "" : stampOf(text(data.eventDate), precision === "EXACT_DATETIME" ? text(data.eventTime) : "")
  const discovery = stampOf(discoveryDate, discoveryTime)
  const reported = stampOf(text(data.reportedDate), reportedTime)
  if (discovery && occurrenceEarliest && earlier(discovery, occurrenceEarliest)) err("Discovery cannot be before the occurrence.")
  if (reported && discovery && earlier(reported, discovery)) err("The report cannot be dated before discovery.")
  if (reported && occurrenceEarliest && earlier(reported, occurrenceEarliest)) err("The report cannot be dated before the occurrence.")
  const notBeforeOccurrence = (value: string, label: string) => { if (value && DATETIME.test(value) && occurrenceEarliest && earlier(value, occurrenceEarliest)) err(`${label} cannot be before the occurrence.`) }

  // Release facts ------------------------------------------------------------
  step = "SPILL_RELEASE"
  const determination = f(SPILL_DATA_POINTS.releaseDetermination)
  if (!determination) err("Release Determination is required (use Unknown if it is not yet known).")
  else if (!inList(T.SPILL_RELEASE_DETERMINATIONS, determination)) err("Release Determination must be a controlled value.")
  const condition = f(SPILL_DATA_POINTS.releaseCondition)
  if (!condition) err("Release Condition is required (use Unknown if it is not yet known).")
  else if (!inList(T.SPILL_RELEASE_CONDITIONS, condition)) err("Release Condition must be a controlled value.")
  controlled(SPILL_DATA_POINTS.releaseForm, T.SPILL_RELEASE_FORMS, "Release Form")
  controlled(SPILL_DATA_POINTS.releaseMechanism, T.SPILL_RELEASE_MECHANISMS, "Release Mechanism")
  if (f(SPILL_DATA_POINTS.releaseMechanism) === "OTHER" && !f(SPILL_DATA_POINTS.releaseMechanismOther)) err("Describe the Other release mechanism.")
  if (f(SPILL_DATA_POINTS.releaseMechanismOther) && f(SPILL_DATA_POINTS.releaseMechanism) !== "OTHER") err("A release-mechanism description belongs only to the Other mechanism.")
  controlled(SPILL_DATA_POINTS.sourceCategory, T.SPILL_SOURCE_CATEGORIES, "Release source category")
  step = "SPILL_CLEANUP"
  controlled(SPILL_DATA_POINTS.cleanupStatus, T.SPILL_CLEANUP_STATUSES, "Cleanup Status")

  // Carrier context: canonical Power Unit / Trailers are optional (a release may involve a package or a facility asset).
  step = "SPILL_RELEASE"
  const powerUnitId = text(data.vehicleId) || text(data.canonicalLinks?.find((link) => link.relationshipKey === "vehicle" && link.entityType === "Vehicle")?.recordId)
  const vehicleLinkId = text(data.canonicalLinks?.find((link) => link.relationshipKey === "vehicle" && link.entityType === "Vehicle")?.recordId)
  if (vehicleLinkId && powerUnitId && vehicleLinkId !== powerUnitId) err("The Power Unit link does not match the event vehicle.")
  if (text(data.vehicleId) && !vehicleLinkId) err("A Power Unit must be linked through the canonical Vehicle relationship.")

  // Operations and impact facts ------------------------------------------------
  step = "SPILL_OPERATIONS"
  step = "SPILL_IMPACT"
  for (const key of SPILL_RISK_FACT_KEYS) controlled(SPILL_DATA_POINTS[key], T.SPILL_YES_NO_UNKNOWN, SPILL_RESPONSE_FACT_LABELS[key])
  for (const key of SPILL_IMPACT_FACT_KEYS) controlled(SPILL_DATA_POINTS[key], T.SPILL_YES_NO_UNKNOWN, SPILL_RESPONSE_FACT_LABELS[key])
  step = "SPILL_RESPONSE"
  for (const key of SPILL_RESPONSE_FACT_KEYS) controlled(SPILL_DATA_POINTS[key], T.SPILL_YES_NO_UNKNOWN, SPILL_RESPONSE_FACT_LABELS[key])

  // Materials ------------------------------------------------------------------
  step = "SPILL_MATERIAL"
  const materialItems = collectionOf(data, CID.MATERIALS)?.items || []
  if (hasDup(materialItems.map((item) => item.itemId)) || materialItems.some((item) => !item.itemId)) err("Material ids must be present and unique.")
  const materialIds = new Set(materialItems.map((item) => item.itemId))
  for (const material of readSpillMaterials(data)) {
    if (!material.description && !material.category) err("Describe each material, or choose a category (use 'Unknown substance' when it is not known).")
    pick(material.category, T.SPILL_MATERIAL_CATEGORIES, "Material category")
    pick(material.identificationStatus, T.SPILL_IDENTIFICATION_STATUSES, "Identification status")
    pick(material.materialSource, T.SPILL_MATERIAL_SOURCES, "Material source")
    pick(material.physicalState, T.SPILL_PHYSICAL_STATES, "Physical state")
    pick(material.packingGroup, T.SPILL_PACKING_GROUPS, "Packing group")
    pick(material.sdsStatus, T.SPILL_SDS_STATUSES, "SDS status")
    pick(material.shippingPapersStatus, T.SPILL_SHIPPING_PAPER_STATUSES, "Shipping-papers status")
    for (const [value, name] of [[material.placardRequired, "Placard required"], [material.placardDisplayed, "Placard displayed"]] as const) pick(value, T.SPILL_YES_NO_UNKNOWN, name)
    if (!material.identificationStatus) err("Every material needs an identification status (use Unknown or Pending Identification when it is not established).")
    if (material.identificationStatus === "CONFIRMED" && !material.materialSource) err("A Confirmed material identification needs its source.")
    // An unknown / pending observation must never carry an authoritative regulatory identity.
    if ((material.identificationStatus === "UNKNOWN" || material.identificationStatus === "PENDING_IDENTIFICATION") && IDENTITY_KEYS.some((key) => material[key])) err("An Unknown or Pending Identification material cannot carry a proper shipping name, UN/ID, hazard class or packing group.")
    refs(material.evidenceIds, "A material")
  }

  // Quantities -----------------------------------------------------------------
  step = "SPILL_RELEASE"
  const quantityItems = collectionOf(data, CID.QUANTITIES)?.items || []
  if (hasDup(quantityItems.map((item) => item.itemId)) || quantityItems.some((item) => !item.itemId)) err("Quantity ids must be present and unique.")
  const quantities = readSpillQuantities(data)
  for (const [index, quantity] of quantities.entries()) {
    nonNegative(quantityItems[index].facts, "value", "A quantity")
    pick(quantity.dimension, T.SPILL_QUANTITY_DIMENSIONS, "Quantity type")
    if (!quantity.dimension) err("Every quantity needs a type (involved, released, recovered, disposed or remaining).")
    pick(quantity.unit, T.SPILL_QUANTITY_UNITS, "Quantity unit")
    pick(quantity.method, T.SPILL_ESTIMATION_METHODS, "Estimation method")
    pick(quantity.status, T.SPILL_QUANTITY_STATUSES, "Quantity status")
    if (quantity.value !== undefined && !quantity.unit) err("A quantity value needs a unit.")
    if (quantity.value !== undefined && !quantity.status) err("A quantity value needs its status (measured, estimated or reported).")
    if (quantity.value !== undefined && quantity.status === "UNKNOWN") err("A quantity cannot have a value and an Unknown status.")
    if (quantity.materialId && !materialIds.has(quantity.materialId)) err("A quantity references a material that does not exist.")
    refs(quantity.evidenceIds, "A quantity")
  }
  const seenQuantity = new Set<string>()
  for (const quantity of quantities) { const key = `${quantity.dimension}|${quantity.materialId}`; if (seenQuantity.has(key)) err("Each quantity type is recorded once per material (or once for the whole event)."); seenQuantity.add(key) }
  // Coherence is checked only when both sides are MEASURED, comparable (same material scope and unit) and numeric. Estimates are never policed.
  for (const dimension of ["RECOVERED", "DISPOSED"]) {
    for (const part of quantities.filter((entry) => entry.dimension === dimension && entry.status === "MEASURED" && entry.value !== undefined)) {
      const released = quantities.find((entry) => entry.dimension === "RELEASED" && entry.materialId === part.materialId && entry.status === "MEASURED" && entry.value !== undefined && entry.unit === part.unit)
      if (released && (part.value as number) > (released.value as number)) err(`The ${dimension.toLowerCase()} quantity cannot exceed the released quantity when both are measured in the same unit.`)
    }
  }

  // People ---------------------------------------------------------------------
  step = "SPILL_IMPACT"
  const personItems = collectionOf(data, CID.PERSONS)?.items || []
  if (hasDup(personItems.map((item) => item.itemId)) || personItems.some((item) => !item.itemId)) err("Person ids must be present and unique.")
  for (const person of readSpillPersons(data)) {
    pick(person.role, T.SPILL_PERSON_ROLES, "Person role")
    if (!person.role) err("Every person record needs a role (use Unknown if it is not known).")
    pick(person.exposureStatus, T.SPILL_EXPOSURE_STATUSES, "Exposure status")
    pick(person.exposureRoute, T.SPILL_EXPOSURE_ROUTES, "Exposure route")
    pick(person.medicalEvaluation, T.SPILL_MEDICAL_EVALUATIONS, "Medical evaluation")
    pick(person.accessClassification, T.SPILL_ACCESS_CLASSES, "Access classification")
    for (const [value, name] of [[person.symptomsReported, "Symptoms reported"], [person.injuryStatus, "Injury status"], [person.firstAid, "First aid"], [person.transported, "Transported"], [person.hospitalized, "Hospitalization"], [person.fatality, "Fatality"]] as const) pick(value, T.SPILL_YES_NO_UNKNOWN, name)
    if (person.injuryDescription && person.injuryStatus !== "YES") err("An injury description belongs only to Injury Status Yes.")
    const medical = [person.symptomsReported, person.injuryStatus, person.firstAid, person.medicalEvaluation, person.transported, person.hospitalized, person.fatality].some((value) => value && value !== "UNKNOWN")
    if (medical && !person.accessClassification) err("Person-level medical information requires an access classification.")
    if (person.linkedDriverMasterId && person.role !== "CARRIER_DRIVER") err("Only a carrier driver can be linked to the event driver.")
    if (person.linkedDriverMasterId && person.linkedDriverMasterId !== text(data.driverMasterId)) err("A linked driver must be this event's driver.")
    refs(person.evidenceIds, "A person record")
  }

  // Environmental media --------------------------------------------------------
  const mediumItems = collectionOf(data, CID.ENVIRONMENTAL_MEDIA)?.items || []
  if (hasDup(mediumItems.map((item) => item.itemId)) || mediumItems.some((item) => !item.itemId)) err("Environmental medium ids must be present and unique.")
  const media = readSpillMedia(data)
  if (hasDup(media.map((entry) => entry.medium).filter(Boolean))) err("Each environmental medium is recorded once.")
  for (const medium of media) {
    if (!medium.medium) err("Every environmental record needs a medium.")
    pick(medium.medium, T.SPILL_ENVIRONMENTAL_MEDIA, "Environmental medium")
    if (!medium.impactStatus) err("Every environmental record needs an impact status (use Unknown when it is not established).")
    pick(medium.impactStatus, T.SPILL_IMPACT_STATUSES, "Impact status")
    refs(medium.evidenceIds, "An environmental record")
  }

  // Response timeline ----------------------------------------------------------
  step = "SPILL_RESPONSE"
  const timelineItems = collectionOf(data, CID.RESPONSE_TIMELINE)?.items || []
  if (hasDup(timelineItems.map((item) => item.itemId)) || timelineItems.some((item) => !item.itemId)) err("Response step ids must be present and unique.")
  const timeline = readSpillTimeline(data)
  const ordinals = timeline.map((entry) => entry.ordinal)
  if (ordinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1)) err("Response ordinals must be positive whole numbers.")
  if (hasDup(ordinals.map(String))) err("Response ordinals must be unique.")
  let previous = ""
  for (const entry of timeline) {
    pick(entry.action, T.SPILL_RESPONSE_ACTIONS, "Response action")
    if (!entry.action) err("Every response step needs an action.")
    if (entry.action === "OTHER" && !entry.actionOther) err("Describe the Other response action.")
    if (entry.actionOther && entry.action !== "OTHER") err("An action description belongs only to the Other action.")
    pick(entry.source, T.SPILL_STEP_SOURCES, "Response source")
    dateTime(entry.timestamp, "A response timestamp")
    notBeforeOccurrence(entry.timestamp, "A response step")
    if (entry.timestamp && DATETIME.test(entry.timestamp)) {
      if (previous && earlier(entry.timestamp, previous)) err("Response steps must be in chronological order of their sequence numbers.")
      previous = entry.timestamp
    }
    refs(entry.evidenceIds, "A response step")
  }

  // Cleanup --------------------------------------------------------------------
  step = "SPILL_CLEANUP"
  const cleanupItems = collectionOf(data, CID.CLEANUP)?.items || []
  if (hasDup(cleanupItems.map((item) => item.itemId)) || cleanupItems.some((item) => !item.itemId)) err("Cleanup record ids must be present and unique.")
  for (const [index, cleanup] of readSpillCleanups(data).entries()) {
    dateTime(cleanup.startedAt, "The cleanup start"); dateTime(cleanup.completedAt, "The cleanup completion")
    if (cleanup.startedAt && cleanup.completedAt && DATETIME.test(cleanup.startedAt) && DATETIME.test(cleanup.completedAt) && earlier(cleanup.completedAt, cleanup.startedAt)) err("Cleanup cannot complete before it starts.")
    notBeforeOccurrence(cleanup.startedAt, "Cleanup start"); notBeforeOccurrence(cleanup.completedAt, "Cleanup completion")
    nonNegative(cleanupItems[index].facts, "quantityRemoved", "The quantity removed")
    if (cleanup.quantityRemoved !== undefined && !cleanup.quantityUnit) err("A quantity removed needs a unit.")
    pick(cleanup.quantityUnit, T.SPILL_QUANTITY_UNITS, "Cleanup unit")
    pick(cleanup.restorationStatus, T.SPILL_RESTORATION_STATUSES, "Site restoration status")
    pick(cleanup.verificationStatus, T.SPILL_VERIFICATION_STATUSES, "Cleanup verification status")
    if (cleanup.materialId && !materialIds.has(cleanup.materialId)) err("A cleanup record references a material that does not exist.")
    money(cleanupItems[index].facts, "cost", "Cleanup cost")
    refs(cleanup.evidenceIds, "A cleanup record")
  }
  const financialItems = collectionOf(data, CID.FINANCIAL)?.items || []
  if (financialItems.length > 1) err("Spill / Release has one set of financial facts.")
  for (const [name, label] of [["materialValue", "Material value"], ["cleanupCost", "Cleanup cost"], ["remediationCost", "Remediation / environmental cost"], ["repairCost", "Repair cost"]]) if (financialItems[0]) money(financialItems[0].facts, name, label)

  // Regulatory assessment / execution (data architecture only) -----------------
  step = "SPILL_REGULATORY"
  const assessmentItems = collectionOf(data, CID.REGULATORY_ASSESSMENTS)?.items || []
  if (hasDup(assessmentItems.map((item) => item.itemId)) || assessmentItems.some((item) => !item.itemId)) err("Regulatory obligation ids must be present and unique.")
  const assessmentIds = new Set(assessmentItems.map((item) => item.itemId))
  for (const assessment of readSpillAssessments(data)) {
    if (!assessment.assessmentStatus) err("Every regulatory obligation needs an assessment status.")
    pick(assessment.assessmentStatus, T.SPILL_ASSESSMENT_STATUSES, "Assessment status")
    if (!assessment.jurisdiction && !assessment.authority) err("A regulatory obligation needs a jurisdiction or an authority.")
    refs(assessment.evidenceIds, "A regulatory assessment")
  }
  const executionItems = collectionOf(data, CID.REGULATORY_EXECUTIONS)?.items || []
  if (hasDup(executionItems.map((item) => item.itemId)) || executionItems.some((item) => !item.itemId)) err("Regulatory execution ids must be present and unique.")
  const executions = readSpillExecutions(data)
  if (hasDup(executions.map((entry) => entry.assessmentId))) err("Each regulatory obligation has at most one execution record.")
  for (const execution of executions) {
    if (!assessmentIds.has(execution.assessmentId)) err("A regulatory execution references an obligation that does not exist.")
    pick(execution.notificationRequired, T.SPILL_YES_NO_UNKNOWN, "Notification required")
    pick(execution.reportRequired, T.SPILL_YES_NO_UNKNOWN, "Report required")
    pick(execution.notificationStatus, T.SPILL_EXECUTION_STATUSES, "Notification status")
    pick(execution.reportStatus, T.SPILL_EXECUTION_STATUSES, "Report status")
    for (const [value, name] of [[execution.notificationDeadline, "The notification deadline"], [execution.notifiedAt, "The notified time"], [execution.reportDeadline, "The report deadline"], [execution.submittedAt, "The submitted time"]] as const) { dateTime(value, name); notBeforeOccurrence(value, name) }
    if (execution.notifiedAt && (!execution.notificationStatus || execution.notificationStatus === "NOT_STARTED")) err("A notified time cannot accompany a notification that is Not started.")
    if (execution.submittedAt && (!execution.reportStatus || execution.reportStatus === "NOT_STARTED")) err("A submitted time cannot accompany a report that is Not started.")
    if (execution.notificationStatus === "COMPLETED" && execution.notificationRequired === "NO") err("A notification marked completed cannot also be recorded as not required; clear the requirement or the status.")
    if (execution.reportStatus === "COMPLETED" && execution.reportRequired === "NO") err("A report marked completed cannot also be recorded as not required; clear the requirement or the status.")
    refs(execution.evidenceIds, "A regulatory execution")
  }

  step = "REVIEW"
  if (Object.keys(data.structuredFacts || {}).length) err("New Spill / Release records use structured facts only.")
  return issues
}

// ---------------------------------------------------------------------------
// Downstream enrichment writers (progressive enrichment; every result is re-validated; history is preserved)
// ---------------------------------------------------------------------------

const ID_PREFIX: Readonly<Record<string, string>> = { [CID.MATERIALS]: "SPM", [CID.QUANTITIES]: "SPQ", [CID.PERSONS]: "SPP", [CID.ENVIRONMENTAL_MEDIA]: "SPE", [CID.RESPONSE_TIMELINE]: "SPR", [CID.CLEANUP]: "SPC", [CID.REGULATORY_ASSESSMENTS]: "SPA", [CID.REGULATORY_EXECUTIONS]: "SPX" }
const ITEM_TYPE: Readonly<Record<string, string>> = { [CID.MATERIALS]: "SPILL_MATERIAL", [CID.QUANTITIES]: "SPILL_QUANTITY", [CID.PERSONS]: "SPILL_PERSON", [CID.ENVIRONMENTAL_MEDIA]: "SPILL_ENVIRONMENTAL_MEDIUM", [CID.RESPONSE_TIMELINE]: "SPILL_RESPONSE_STEP", [CID.CLEANUP]: "SPILL_CLEANUP", [CID.REGULATORY_ASSESSMENTS]: "SPILL_REGULATORY_ASSESSMENT", [CID.REGULATORY_EXECUTIONS]: "SPILL_REGULATORY_EXECUTION" }
export const SPILL_EDITABLE_COLLECTIONS: readonly string[] = Object.keys(ID_PREFIX)

const assertValid = <E extends SpillEvent>(next: E): E => {
  const issues = validateNewSpillRelease(next as unknown as NewSpillCandidate)
  if (issues.length) throw new Error(issues[0])
  return next
}
const withCollections = <E extends SpillEvent>(event: E, replaced: PerformanceChildCollection[]): E => ({ ...event, childCollections: [...(event.childCollections || []).filter((entry) => !replaced.some((next) => next.collectionId === entry.collectionId)), ...replaced] })

/**
 * Create or update ONE child record. Facts merge (null clears a fact). New records get a stable id; response steps get the next ordinal
 * unless one is given. The whole event is re-validated, so a downstream edit can never leave the record inconsistent.
 */
export function upsertSpillChild<E extends SpillEvent>(event: E, input: { collectionId: string; itemId?: string; facts: Record<string, string | number | null>; evidenceIds?: string[]; now?: string }): { event: E; itemId: string } {
  if (!isNewTaxonomySpill(event)) throw new Error("Legacy Spill / Release records cannot be enriched; they are read-only history.")
  if (!SPILL_EDITABLE_COLLECTIONS.includes(input.collectionId)) throw new Error("Unknown Spill / Release record type.")
  const now = input.now || new Date().toISOString()
  const existing = collectionOf(event, input.collectionId)
  const current = input.itemId ? existing?.items.find((item) => item.itemId === input.itemId) : undefined
  if (input.itemId && !current && !input.itemId.startsWith(ID_PREFIX[input.collectionId])) throw new Error("Spill / Release record not found.")
  const facts = { ...(current?.facts || {}), ...input.facts } as Record<string, string | number | null>
  if (!current) {
    if (input.collectionId === CID.RESPONSE_TIMELINE && facts.ordinal === undefined) facts.ordinal = Math.max(0, ...(existing?.items || []).map((item) => Number(item.facts.ordinal) || 0)) + 1
    if (input.collectionId === CID.CLEANUP || input.collectionId === CID.REGULATORY_ASSESSMENTS || input.collectionId === CID.REGULATORY_EXECUTIONS) facts.recordedAt = now
  }
  if (input.collectionId === CID.REGULATORY_EXECUTIONS) {
    const prior = current?.facts || {}
    if (facts.notificationRequired === "YES" && prior.notificationRequired !== "YES") facts.notificationRequiredAt = now
    if (facts.reportRequired === "YES" && prior.reportRequired !== "YES") facts.reportRequiredAt = now
  }
  for (const key of Object.keys(facts)) if (facts[key] === "" ) facts[key] = null
  const itemId = current?.itemId || input.itemId || newId(ID_PREFIX[input.collectionId])
  const nextItem: PerformanceChildFactItem = { itemId, facts, evidenceIds: input.evidenceIds ? unique(input.evidenceIds) : current?.evidenceIds || [] }
  const items = current ? (existing?.items || []).map((item) => (item.itemId === itemId ? nextItem : item)) : [...(existing?.items || []), nextItem]
  const next = withCollections(event, [{ collectionId: input.collectionId, collectionVersion: existing?.collectionVersion || "1.0", itemType: ITEM_TYPE[input.collectionId], completeness: "COMPLETE", items }])
  return { event: assertValid(next), itemId }
}

const STATUS_FACTS: Readonly<Record<string, { dataPointId: string; list: string }>> = {
  releaseDetermination: { dataPointId: SPILL_DATA_POINTS.releaseDetermination, list: "SPILL_RELEASE_DETERMINATIONS" },
  releaseCondition: { dataPointId: SPILL_DATA_POINTS.releaseCondition, list: "SPILL_RELEASE_CONDITIONS" },
  cleanupStatus: { dataPointId: SPILL_DATA_POINTS.cleanupStatus, list: "SPILL_CLEANUP_STATUSES" },
}
/** Change one of the three separate status dimensions. The prior value stays in the append-only status history. */
export function setSpillStatus<E extends SpillEvent>(event: E, input: { field: "releaseDetermination" | "releaseCondition" | "cleanupStatus"; to: string; changedBy: string; note?: string; at?: string }): E {
  if (!isNewTaxonomySpill(event)) throw new Error("Legacy Spill / Release records cannot be changed; they are read-only history.")
  const meta = STATUS_FACTS[input.field]
  if (!meta) throw new Error("Unknown Spill / Release status.")
  if (!text(input.changedBy)) throw new Error("changedBy is required.")
  if (!inList(T[meta.list], input.to)) throw new Error("The status must be a controlled value.")
  const from = factText(event, meta.dataPointId)
  const at = input.at || new Date().toISOString()
  const facts = (event.structuredEventFacts || []).filter((fact) => fact.dataPointId !== meta.dataPointId)
  const nextFact: StructuredEventFact = { dataPointId: meta.dataPointId, value: input.to, valueType: "string" }
  const entry: PerformanceChildFactItem = { itemId: newId("SPH"), facts: { field: input.field, fromValue: from || null, toValue: input.to, changedAt: at, changedBy: text(input.changedBy), note: text(input.note) || null }, evidenceIds: [] }
  const history = collectionOf(event, CID.STATUS_HISTORY)
  const next = withCollections({ ...event, structuredEventFacts: [...facts, nextFact] }, [{ collectionId: CID.STATUS_HISTORY, collectionVersion: "1.0", itemType: "SPILL_STATUS_CHANGE", completeness: "COMPLETE", items: [...(history?.items || []), entry] }])
  return assertValid(next)
}

// ---------------------------------------------------------------------------
// Workflow provider (registered with the common workflow engine)
// ---------------------------------------------------------------------------

const source = (type: string, id: string) => ({ type, id })

/**
 * A bare Spill / Release creates NO obligation merely because it exists, and no obligation is ever inferred from material, quantity,
 * category or the absence of a regulatory record. Obligations come ONLY from explicit stored states:
 *   - an obligation record still Not Assessed / Under Review          -> REGULATORY_ASSESSMENT_REQUIRED
 *   - assessment Required + notification required Yes, not completed  -> REGULATORY_NOTIFICATION_INCOMPLETE
 *   - assessment Required + report required Yes, not completed        -> REGULATORY_REPORT_INCOMPLETE
 *   - Cleanup Status = Verification Pending                           -> CLEANUP_VERIFICATION_PENDING
 * Reviewer-required investigation, Company Actions, verification and follow-up come from the common providers.
 */
export const spillWorkflowProvider: WorkflowProvider = {
  id: "spill-release",
  collect(foundationEvent: FoundationEvent, _state: PerformanceFoundationState): WorkflowObligation[] {
    void _state
    if (foundationEvent.eventType !== "Spill or Release") return []
    const event = foundationEvent as SpillEvent & FoundationEvent
    if (!isNewTaxonomySpill(event)) return []
    const out: WorkflowObligation[] = []
    const eventCreated = event.createdAt
    const executions = readSpillExecutions(event)
    for (const assessment of readSpillAssessments(event)) {
      const detail = [assessment.jurisdiction, assessment.authority].filter(Boolean).join(" / ") || undefined
      const base = { createdAt: assessment.recordedAt || eventCreated, detail }
      const status = assessment.assessmentStatus
      if (status === "NOT_ASSESSED" || status === "UNDER_REVIEW") {
        out.push(makeObligation("REGULATORY_ASSESSMENT_REQUIRED", source("SpillRegulatory", `${assessment.itemId}#assessment`), false, { ...base, kind: status === "UNDER_REVIEW" ? "REVIEW" : "OBLIGATION" }))
        continue
      }
      if (status !== "REQUIRED") continue
      out.push(makeObligation("REGULATORY_ASSESSMENT_REQUIRED", source("SpillRegulatory", `${assessment.itemId}#assessment`), true, base))
      const execution = executions.find((entry) => entry.assessmentId === assessment.itemId)
      if (execution?.notificationRequired === "YES") out.push(makeObligation("REGULATORY_NOTIFICATION_INCOMPLETE", source("SpillRegulatory", `${assessment.itemId}#notification`), execution.notificationStatus === "COMPLETED", { createdAt: execution.notificationRequiredAt || execution.recordedAt || eventCreated, detail, resolvedAt: execution.notifiedAt || undefined }))
      if (execution?.reportRequired === "YES") out.push(makeObligation("REGULATORY_REPORT_INCOMPLETE", source("SpillRegulatory", `${assessment.itemId}#report`), execution.reportStatus === "COMPLETED", { createdAt: execution.reportRequiredAt || execution.recordedAt || eventCreated, detail, resolvedAt: execution.submittedAt || undefined }))
    }
    // Verification Pending episodes come only from the explicit status and its append-only history. A record created already at
    // Verification Pending starts its episode at creation; leaving the status later resolves it.
    const cleanupHistory = readSpillStatusHistory(event).filter((entry) => entry.field === "cleanupStatus")
    let pendingSince: string | undefined = cleanupHistory[0]?.from === "VERIFICATION_PENDING" ? eventCreated : undefined
    let episode = 0
    for (const entry of cleanupHistory) {
      if (entry.from === "VERIFICATION_PENDING" && pendingSince !== undefined) {
        episode += 1
        out.push(makeObligation("CLEANUP_VERIFICATION_PENDING", source("SpillCleanup", `${event.id}#cleanup-${episode}`), true, { createdAt: pendingSince, kind: "REVIEW", resolvedAt: entry.changedAt, resolvedBy: entry.changedBy || undefined }))
        pendingSince = undefined
      }
      if (entry.to === "VERIFICATION_PENDING") pendingSince = entry.changedAt
    }
    if (factText(event, SPILL_DATA_POINTS.cleanupStatus) === "VERIFICATION_PENDING") out.push(makeObligation("CLEANUP_VERIFICATION_PENDING", source("SpillCleanup", `${event.id}#cleanup`), false, { createdAt: pendingSince || eventCreated, kind: "REVIEW" }))
    return out
  },
}

// ---------------------------------------------------------------------------
// Presentation (labels only; never used for business comparisons)
// ---------------------------------------------------------------------------

const moneyLabel = (money: SpillMoney | undefined) => (money ? `${money.value.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${money.currencyCode}` : undefined)
const qtyLabel = (value: number | undefined, unit: string) => (value === undefined ? undefined : `${value}${unit ? ` ${L(T.SPILL_QUANTITY_UNITS, unit)}` : ""}`)

export function describeSpillRelease(event: SpillEvent) {
  const materials = readSpillMaterials(event)
  const materialName = (id: string) => { const material = materials.find((entry) => entry.itemId === id); return material ? material.description || L(T.SPILL_MATERIAL_CATEGORIES, material.category) || id : id }
  const assessments = readSpillAssessments(event)
  const executions = readSpillExecutions(event)
  const quantities = readSpillQuantities(event)
  const mechanism = factText(event, SPILL_DATA_POINTS.releaseMechanism)
  const financial = readSpillFinancial(event)
  const counts = deriveSpillPersonCounts(event)
  const fact = (key: keyof typeof SPILL_DATA_POINTS) => factText(event, SPILL_DATA_POINTS[key])
  return {
    time: {
      precision: L(T.SPILL_OCCURRENCE_PRECISIONS, event.occurrencePrecision) || undefined, timeZone: fact("eventTimeZone") || undefined, windowStart: fact("windowStart") || undefined, windowEnd: fact("windowEnd") || undefined, windowBasis: fact("windowBasis") || undefined,
      discovery: [fact("discoveryDate"), fact("discoveryTime")].filter(Boolean).join(" ") || undefined, reported: [text(event.reportedDate), fact("reportedTime")].filter(Boolean).join(" ") || undefined, delays: deriveSpillTimingDelays(event),
    },
    release: {
      determination: L(T.SPILL_RELEASE_DETERMINATIONS, fact("releaseDetermination")) || undefined, condition: L(T.SPILL_RELEASE_CONDITIONS, fact("releaseCondition")) || undefined, cleanupStatus: L(T.SPILL_CLEANUP_STATUSES, fact("cleanupStatus")) || undefined,
      form: L(T.SPILL_RELEASE_FORMS, fact("releaseForm")) || undefined, mechanism: mechanism === "OTHER" && fact("releaseMechanismOther") ? `Other: ${fact("releaseMechanismOther")}` : L(T.SPILL_RELEASE_MECHANISMS, mechanism) || undefined,
      sourceCategory: L(T.SPILL_SOURCE_CATEGORIES, fact("sourceCategory")) || undefined, subsystem: fact("sourceSubsystem") || undefined, component: fact("sourceComponent") || undefined,
      powerUnit: (event.canonicalLinks || []).filter((link) => link.relationshipKey === "vehicle").map((link) => link.label || link.recordId).join(", ") || undefined, trailers: (event.canonicalLinks || []).filter((link) => link.relationshipKey === "trailer").map((link) => link.label || link.recordId).join(", ") || undefined,
      narrative: fact("reporterNarrative") || undefined,
    },
    operations: [["Load Reference", "loadReference"], ["BOL / PRO", "bolPro"], ["Shipment Reference", "shipmentReference"], ["Customer", "customerName"], ["Shipper", "shipperName"], ["Receiver", "receiverName"], ["Origin", "origin"], ["Destination", "destination"], ["Facility / Site", "facilitySite"], ["Route Reference", "routeReference"], ["Operating Stage", "operatingStage"]]
      .map(([name, key]) => ({ label: name, value: fact(key as keyof typeof SPILL_DATA_POINTS) })).filter((row) => row.value),
    materials: materials.map((material) => ({
      id: material.itemId, title: material.description || L(T.SPILL_MATERIAL_CATEGORIES, material.category) || "Material", category: L(T.SPILL_MATERIAL_CATEGORIES, material.category) || undefined, status: L(T.SPILL_IDENTIFICATION_STATUSES, material.identificationStatus) || undefined, source: L(T.SPILL_MATERIAL_SOURCES, material.materialSource) || undefined,
      properShippingName: material.properShippingName || undefined, technicalName: material.technicalName || undefined, unId: material.unId || undefined, hazardClass: material.hazardClass || undefined, packingGroup: L(T.SPILL_PACKING_GROUPS, material.packingGroup) || undefined, physicalState: L(T.SPILL_PHYSICAL_STATES, material.physicalState) || undefined,
      sds: [L(T.SPILL_SDS_STATUSES, material.sdsStatus), material.sdsReference].filter(Boolean).join(" - ") || undefined, placardRequired: L(T.SPILL_YES_NO_UNKNOWN, material.placardRequired) || undefined, placardDisplayed: L(T.SPILL_YES_NO_UNKNOWN, material.placardDisplayed) || undefined, shippingPapers: L(T.SPILL_SHIPPING_PAPER_STATUSES, material.shippingPapersStatus) || undefined, notes: material.notes || undefined,
      identificationPending: material.identificationStatus === "UNKNOWN" || material.identificationStatus === "PENDING_IDENTIFICATION",
    })),
    quantities: quantities.map((quantity) => ({ id: quantity.itemId, type: L(T.SPILL_QUANTITY_DIMENSIONS, quantity.dimension), material: quantity.materialId ? materialName(quantity.materialId) : undefined, amount: qtyLabel(quantity.value, quantity.unit) || (quantity.status === "UNKNOWN" ? "Not established" : "No value recorded"), status: L(T.SPILL_QUANTITY_STATUSES, quantity.status) || undefined, method: L(T.SPILL_ESTIMATION_METHODS, quantity.method) || undefined, notes: quantity.notes || undefined })),
    releasedQuantityEstablished: quantities.some((quantity) => quantity.dimension === "RELEASED" && quantity.value !== undefined),
    persons: readSpillPersons(event).map((person) => ({ id: person.itemId, role: L(T.SPILL_PERSON_ROLES, person.role), name: person.name || undefined, eventDriver: Boolean(person.linkedDriverMasterId), exposure: L(T.SPILL_EXPOSURE_STATUSES, person.exposureStatus) || undefined, route: L(T.SPILL_EXPOSURE_ROUTES, person.exposureRoute) || undefined, symptoms: L(T.SPILL_YES_NO_UNKNOWN, person.symptomsReported) || undefined, injury: L(T.SPILL_YES_NO_UNKNOWN, person.injuryStatus) || undefined, injuryDescription: person.injuryDescription || undefined, firstAid: L(T.SPILL_YES_NO_UNKNOWN, person.firstAid) || undefined, medical: L(T.SPILL_MEDICAL_EVALUATIONS, person.medicalEvaluation) || undefined, transported: L(T.SPILL_YES_NO_UNKNOWN, person.transported) || undefined, hospitalized: L(T.SPILL_YES_NO_UNKNOWN, person.hospitalized) || undefined, fatality: L(T.SPILL_YES_NO_UNKNOWN, person.fatality) || undefined, access: L(T.SPILL_ACCESS_CLASSES, person.accessClassification) || undefined, notes: person.notes || undefined })),
    personCounts: counts,
    media: readSpillMedia(event).map((medium) => ({ id: medium.itemId, medium: L(T.SPILL_ENVIRONMENTAL_MEDIA, medium.medium), status: L(T.SPILL_IMPACT_STATUSES, medium.impactStatus), note: medium.note || undefined })),
    risk: SPILL_RISK_FACT_KEYS.map((key) => ({ key, label: SPILL_RESPONSE_FACT_LABELS[key], value: L(T.SPILL_YES_NO_UNKNOWN, fact(key)) })).filter((row) => row.value),
    otherImpact: { facts: SPILL_IMPACT_FACT_KEYS.map((key) => ({ key, label: SPILL_RESPONSE_FACT_LABELS[key], value: L(T.SPILL_YES_NO_UNKNOWN, fact(key)) })).filter((row) => row.value), note: fact("otherImpactNote") || undefined },
    response: SPILL_RESPONSE_FACT_KEYS.map((key) => ({ key, label: SPILL_RESPONSE_FACT_LABELS[key], value: L(T.SPILL_YES_NO_UNKNOWN, fact(key)) })).filter((row) => row.value),
    timeline: readSpillTimeline(event).map((step) => ({ id: step.itemId, ordinal: step.ordinal, action: step.action === "OTHER" && step.actionOther ? `Other: ${step.actionOther}` : L(T.SPILL_RESPONSE_ACTIONS, step.action), timestamp: step.timestamp || undefined, actor: step.actor || undefined, location: step.location || undefined, source: L(T.SPILL_STEP_SOURCES, step.source) || undefined, notes: step.notes || undefined })),
    responseDelays: deriveSpillResponseDelays(event),
    cleanups: readSpillCleanups(event).map((cleanup) => ({ id: cleanup.itemId, started: cleanup.startedAt || undefined, completed: cleanup.completedAt || undefined, vendor: cleanup.vendor || undefined, method: cleanup.method || undefined, material: cleanup.materialId ? materialName(cleanup.materialId) : cleanup.materialRemoved || undefined, removed: qtyLabel(cleanup.quantityRemoved, cleanup.quantityUnit), disposalMethod: cleanup.disposalMethod || undefined, manifest: cleanup.disposalManifest || undefined, wasteClassification: cleanup.wasteClassification || undefined, restoration: L(T.SPILL_RESTORATION_STATUSES, cleanup.restorationStatus) || undefined, verification: L(T.SPILL_VERIFICATION_STATUSES, cleanup.verificationStatus) || undefined, verificationNote: cleanup.verificationNote || undefined, cost: moneyLabel(cleanup.cost), notes: cleanup.notes || undefined })),
    financial: financial ? { materialValue: moneyLabel(financial.materialValue), cleanupCost: moneyLabel(financial.cleanupCost), remediationCost: moneyLabel(financial.remediationCost), repairCost: moneyLabel(financial.repairCost) } : undefined,
    regulatory: assessments.map((assessment) => {
      const execution = executions.find((entry) => entry.assessmentId === assessment.itemId)
      return {
        id: assessment.itemId, jurisdiction: assessment.jurisdiction || undefined, authority: assessment.authority || undefined, basis: assessment.basis || undefined, assessment: L(T.SPILL_ASSESSMENT_STATUSES, assessment.assessmentStatus), note: assessment.note || undefined, executionId: execution?.itemId,
        notificationRequired: L(T.SPILL_YES_NO_UNKNOWN, execution?.notificationRequired) || undefined, notificationDeadline: execution?.notificationDeadline || undefined, notificationStatus: L(T.SPILL_EXECUTION_STATUSES, execution?.notificationStatus) || undefined, notifiedAt: execution?.notifiedAt || undefined,
        reportRequired: L(T.SPILL_YES_NO_UNKNOWN, execution?.reportRequired) || undefined, reportDeadline: execution?.reportDeadline || undefined, reportStatus: L(T.SPILL_EXECUTION_STATUSES, execution?.reportStatus) || undefined, submittedAt: execution?.submittedAt || undefined, reportControlNumber: execution?.reportControlNumber || undefined, submissionReference: execution?.submissionReference || undefined,
      }
    }),
    statusHistory: readSpillStatusHistory(event).map((entry) => ({ field: entry.field === "cleanupStatus" ? "Cleanup Status" : entry.field === "releaseCondition" ? "Release Condition" : "Release Determination", from: entry.from ? L(entry.field === "cleanupStatus" ? T.SPILL_CLEANUP_STATUSES : entry.field === "releaseCondition" ? T.SPILL_RELEASE_CONDITIONS : T.SPILL_RELEASE_DETERMINATIONS, entry.from) : undefined, to: L(entry.field === "cleanupStatus" ? T.SPILL_CLEANUP_STATUSES : entry.field === "releaseCondition" ? T.SPILL_RELEASE_CONDITIONS : T.SPILL_RELEASE_DETERMINATIONS, entry.to), by: entry.changedBy, at: entry.changedAt, note: entry.note || undefined })),
  }
}
export type SpillDescription = ReturnType<typeof describeSpillRelease>

/** Legacy Spill / Release: read-only compatibility readback. Old fields are shown as recorded; nothing is mapped into the new model. */
export function describeLegacySpill(event: SpillEvent) {
  const byId = (suffix: string) => event.structuredEventFacts?.find((fact) => fact.dataPointId.endsWith(`.${suffix}`))
  const value = (suffix: string) => byId(suffix)?.value
  const yesNo = (suffix: string) => (value(suffix) === true ? "Yes" : value(suffix) === false ? "No" : undefined)
  const quantity = byId(LEGACY_SUFFIXES.quantity)
  return {
    material: text(value(LEGACY_SUFFIXES.material)) || undefined,
    quantityReleased: typeof quantity?.value === "number" ? `${quantity.value}${quantity.unit ? ` ${quantity.unit}` : ""}` : undefined,
    releaseEnvironment: text(value(LEGACY_SUFFIXES.environment)) || undefined,
    containmentPerformed: yesNo(LEGACY_SUFFIXES.containment), emergencyResponse: yesNo(LEGACY_SUFFIXES.emergency), responseNotes: text(value(LEGACY_SUFFIXES.notes)) || undefined, source: text(event.provenance?.source) || undefined,
  }
}

export function buildSpillSummary(event: SpillEvent) {
  const description = describeSpillRelease(event)
  const power = event.canonicalLinks?.find((link) => link.relationshipKey === "vehicle" && link.label)?.label
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(event.eventDate || "")
  const date = match ? `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}` : event.eventDate || ""
  const place = [text(event.location), text(event.city), text(event.stateProvince)].filter(Boolean).join(", ")
  const materialLine = description.materials.length ? description.materials.map((material) => material.title).join(", ") : undefined
  return { title: "Spill or Release", releaseLine: [description.release.determination && `Release ${description.release.determination}`, description.release.condition && `Condition ${description.release.condition}`].filter(Boolean).join(" - ") || undefined, materialLine, contextLine: [date, power, place].filter(Boolean).join(" · ") }
}
