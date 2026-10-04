/**
 * Cargo Incident - one parent Performance Event. Damage and Theft are OUTCOME MODULES of that parent, never competing events.
 *
 * Cargo owns occurrence facts, cargo items, outcome modules, temperature observations, the custody chain and security controls.
 * Preventability, responsibility, root cause, contributing factors and conclusions belong to the common investigation engine.
 * "Reported / Suspected Cause" is occurrence data and is never a TES root cause.
 *
 * Pure functions over the stored event shape. Business logic compares canonical values; labels are presentation only.
 * Legacy "Cargo Damage" / "Cargo Theft" records are read-only history and are never rewritten or reinterpreted.
 */

import type { CanonicalEntityLink, PerformanceChildCollection, PerformanceChildFactItem, PerformanceEventRecord, StructuredEventFact } from "@/types/drivers"
// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution (unit tested under `node --test`); tsconfig is intentionally left unchanged.
import * as taxonomy from "./performance-cargo-taxonomy.ts"
import type { FoundationEvent, PerformanceFoundationState } from "@/lib/performance-foundation-state"
import type { WorkflowObligation, WorkflowProvider } from "@/lib/performance-workflow"

type Option = { value: string; label: string }
const T = taxonomy as unknown as Record<string, readonly Option[]> & {
  CARGO_SECONDARY_BY_FAMILY: Readonly<Record<string, readonly Option[]>>
  CARGO_COLLECTION_IDS: Readonly<Record<"ITEMS" | "ITEM_STATUS_HISTORY" | "DAMAGE_OUTCOME" | "TEMPERATURE" | "THEFT_OUTCOME" | "CUSTODY" | "SECURITY_CONTROLS", string>>
  cargoOptionLabel: (list: readonly Option[], value: string | null | undefined) => string
  cargoValues: (list: readonly Option[]) => string[]
}
const CID = T.CARGO_COLLECTION_IDS
const L = (list: readonly Option[], value: unknown) => T.cargoOptionLabel(list, typeof value === "string" ? value : undefined)
const inList = (list: readonly Option[], value: string) => T.cargoValues(list).includes(value)

export type CargoEvent = Pick<PerformanceEventRecord, "id" | "eventType"> &
  Partial<Pick<PerformanceEventRecord, "driverMasterId" | "eventDate" | "eventTime" | "reportedDate" | "occurrencePrecision" | "location" | "city" | "stateProvince" | "country" | "vehicleId" | "canonicalLinks" | "structuredEventFacts" | "structuredFacts" | "childCollections" | "evidenceIds" | "provenance" | "summary" | "createdAt">>

/** Stable data point ids (mirrors lib/driver-performance-schema.ts; a test asserts they match the registry). */
export const CARGO_DATA_POINTS = {
  cargoContextStatus: "DRV.PERF.CARGO_INCIDENT.CARGO_CONTEXT_STATUS", cargoGeneralDescription: "DRV.PERF.CARGO_INCIDENT.CARGO_GENERAL_DESCRIPTION",
  primaryFamily: "DRV.PERF.CARGO_INCIDENT.PRIMARY_FAMILY", secondaryClassification: "DRV.PERF.CARGO_INCIDENT.SECONDARY_CLASSIFICATION", custodyStage: "DRV.PERF.CARGO_INCIDENT.CUSTODY_STAGE",
  windowStart: "DRV.PERF.CARGO_INCIDENT.OCCURRENCE_WINDOW_START", windowEnd: "DRV.PERF.CARGO_INCIDENT.OCCURRENCE_WINDOW_END", windowBasis: "DRV.PERF.CARGO_INCIDENT.OCCURRENCE_WINDOW_BASIS",
  discoveryDate: "DRV.PERF.CARGO_INCIDENT.DISCOVERY_DATE", discoveryTime: "DRV.PERF.CARGO_INCIDENT.DISCOVERY_TIME", reportedTime: "DRV.PERF.CARGO_INCIDENT.REPORTED_TIME",
  loadReference: "DRV.PERF.CARGO_INCIDENT.LOAD_REFERENCE", bolPro: "DRV.PERF.CARGO_INCIDENT.BOL_PRO", shipmentReference: "DRV.PERF.CARGO_INCIDENT.SHIPMENT_REFERENCE",
  customerName: "DRV.PERF.CARGO_INCIDENT.CUSTOMER_NAME", shipperName: "DRV.PERF.CARGO_INCIDENT.SHIPPER_NAME", receiverName: "DRV.PERF.CARGO_INCIDENT.RECEIVER_NAME", brokerName: "DRV.PERF.CARGO_INCIDENT.BROKER_NAME",
  origin: "DRV.PERF.CARGO_INCIDENT.ORIGIN", destination: "DRV.PERF.CARGO_INCIDENT.DESTINATION", facilitySite: "DRV.PERF.CARGO_INCIDENT.FACILITY_SITE",
  plannedRoute: "DRV.PERF.CARGO_INCIDENT.PLANNED_ROUTE_REFERENCE", actualRoute: "DRV.PERF.CARGO_INCIDENT.ACTUAL_ROUTE_REFERENCE",
  dispatchNotified: "DRV.PERF.CARGO_INCIDENT.RESPONSE_DISPATCH_NOTIFIED", customerNotified: "DRV.PERF.CARGO_INCIDENT.RESPONSE_CUSTOMER_NOTIFIED", policeNotified: "DRV.PERF.CARGO_INCIDENT.RESPONSE_POLICE_NOTIFIED",
  insurerNotified: "DRV.PERF.CARGO_INCIDENT.RESPONSE_INSURER_NOTIFIED", securityNotified: "DRV.PERF.CARGO_INCIDENT.RESPONSE_SECURITY_NOTIFIED", cargoSecured: "DRV.PERF.CARGO_INCIDENT.RESPONSE_CARGO_SECURED",
  emergencyResponse: "DRV.PERF.CARGO_INCIDENT.RESPONSE_EMERGENCY", recoveryInitiated: "DRV.PERF.CARGO_INCIDENT.RESPONSE_RECOVERY_INITIATED",
  incidentNarrative: "DRV.PERF.CARGO_INCIDENT.INCIDENT_NARRATIVE",
} as const

export const CARGO_RESPONSE_FACT_KEYS = ["dispatchNotified", "customerNotified", "policeNotified", "insurerNotified", "securityNotified", "cargoSecured", "emergencyResponse", "recoveryInitiated"] as const

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")
export function cargoFact(event: Pick<CargoEvent, "structuredEventFacts">, dataPointId: string): StructuredEventFact["value"] | undefined {
  return event.structuredEventFacts?.find((fact) => fact.dataPointId === dataPointId)?.value
}
const factText = (event: CargoEvent, id: string) => text(cargoFact(event, id))

export const isCargoIncident = (event: Pick<CargoEvent, "eventType">) => event.eventType === "Cargo Incident"
export const isLegacyCargoEvent = (event: Pick<CargoEvent, "eventType">) => event.eventType === "Cargo Damage" || event.eventType === "Cargo Theft"

// ---------------------------------------------------------------------------
// Money: { value, currencyCode }. Child facts are scalar, so it is stored as <name> + <name>Currency and read back as one shape.
// ---------------------------------------------------------------------------

export interface CargoMoney { value: number; currencyCode: string }
const SUPPORTED_CURRENCIES = (() => { try { return new Set<string>((Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf("currency")) } catch { return new Set<string>(["CAD", "USD"]) } })()
export const isSupportedCurrencyCode = (code: string) => /^[A-Z]{3}$/.test(code) && (SUPPORTED_CURRENCIES.has(code) || code === "CAD" || code === "USD")

const nullable = (value: unknown): string | number | null => (typeof value === "number" ? value : text(value) || null)
const numberOrNull = (value: string | number | undefined | null): number | null => { if (value === undefined || value === null || String(value).trim() === "") return null; const n = Number(value); return Number.isNaN(n) ? NaN : n }
const moneyFacts = (name: string, value: string | number | undefined, currency: string | undefined): Record<string, string | number | null> => { const amount = numberOrNull(value); return { [name]: amount, [`${name}Currency`]: amount === null ? null : text(currency) || null } }
export const readCargoMoney = (facts: Record<string, unknown>, name: string): CargoMoney | undefined => {
  const value = facts[name]; const currency = facts[`${name}Currency`]
  return typeof value === "number" && typeof currency === "string" && currency ? { value, currencyCode: currency } : undefined
}

// ---------------------------------------------------------------------------
// Wizard draft -> canonical child collections (pure, unit tested)
// ---------------------------------------------------------------------------

const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`
const unique = (items: readonly string[] | undefined) => [...new Set((items || []).filter(Boolean))]
export const idsToFact = (ids: readonly string[] | undefined): string | null => (ids && ids.length ? [...new Set(ids)].join("|") : null)
export const idsFromFact = (value: unknown): string[] => (typeof value === "string" && value ? value.split("|").filter(Boolean) : [])

export interface CargoDraftItem {
  itemId: string; commodity: string; itemCode: string; quantity: string; quantityUnit: string; affectedQuantity: string; damagedQuantity: string; stolenQuantity: string; recoveredQuantity: string
  condition: string; hazmat: string; temperatureSensitive: string
  declaredValue: string; declaredCurrency: string; insuredValue: string; insuredCurrency: string; affectedValue: string; affectedCurrency: string
  notes: string; evidenceIds: string[]
}
export interface CargoDraftDamage { damageType: string; scope: string; discoveryPoint: string; affectedItemIds: string[]; damagedValue: string; damagedCurrency: string; disposition: string; origin: string; reportedCause: string; reportedCauseOther: string; narrative: string; evidenceIds: string[] }
export interface CargoDraftTheft {
  status: string; method: string; target: string; locationType: string; locationContext: string; timeCertainty: string; exactTime: string; windowStart: string; windowEnd: string; windowBasis: string
  discoveryMethod: string; trackingStatus: string; sealState: string; policeResponse: string; policeReference: string; recoveryStatus: string
  stolenValue: string; stolenCurrency: string; recoveredValue: string; recoveredCurrency: string; narrative: string; evidenceIds: string[]
}
export interface CargoDraftTemperature { itemId: string; setpoint: string; minimum: string; maximum: string; unit: string; excursionMinutes: string; reeferStatus: string; reeferFuel: string; doorOpen: string; source: string; observedAt: string; note: string; evidenceIds: string[] }
export interface CargoDraftCustody { itemId: string; ordinal: string; role: string; event: string; timestamp: string; location: string; custodian: string; itemIds: string[]; linkedVehicleId: string; sealState: string; gpsState: string; verificationMethod: string; expectedState: string; observedState: string; anomalyType: string; exception: string; evidenceIds: string[] }
export interface CargoDraftControl { itemId: string; controlType: string; expectedState: string; actualState: string; source: string; note: string; evidenceIds: string[] }
export interface CargoDraft {
  items: CargoDraftItem[]; damage: CargoDraftDamage | null; theft: CargoDraftTheft | null; temperatures: CargoDraftTemperature[]; custody: CargoDraftCustody[]; controls: CargoDraftControl[]
  powerUnitId: string; trailerIds: string[]; precision: string
}

export const emptyCargoItem = (): CargoDraftItem => ({ itemId: newId("CGI"), commodity: "", itemCode: "", quantity: "", quantityUnit: "", affectedQuantity: "", damagedQuantity: "", stolenQuantity: "", recoveredQuantity: "", condition: "", hazmat: "", temperatureSensitive: "", declaredValue: "", declaredCurrency: "CAD", insuredValue: "", insuredCurrency: "CAD", affectedValue: "", affectedCurrency: "CAD", notes: "", evidenceIds: [] })
export const emptyCargoDamage = (): CargoDraftDamage => ({ damageType: "", scope: "", discoveryPoint: "", affectedItemIds: [], damagedValue: "", damagedCurrency: "CAD", disposition: "", origin: "", reportedCause: "", reportedCauseOther: "", narrative: "", evidenceIds: [] })
export const emptyCargoTheft = (): CargoDraftTheft => ({ status: "", method: "", target: "", locationType: "", locationContext: "", timeCertainty: "", exactTime: "", windowStart: "", windowEnd: "", windowBasis: "", discoveryMethod: "", trackingStatus: "", sealState: "", policeResponse: "", policeReference: "", recoveryStatus: "", stolenValue: "", stolenCurrency: "CAD", recoveredValue: "", recoveredCurrency: "CAD", narrative: "", evidenceIds: [] })
export const emptyCargoTemperature = (): CargoDraftTemperature => ({ itemId: newId("CTO"), setpoint: "", minimum: "", maximum: "", unit: "C", excursionMinutes: "", reeferStatus: "", reeferFuel: "", doorOpen: "", source: "", observedAt: "", note: "", evidenceIds: [] })
export const emptyCargoCustody = (ordinal: number): CargoDraftCustody => ({ itemId: newId("CCU"), ordinal: String(ordinal), role: "NORMAL_CUSTODY", event: "", timestamp: "", location: "", custodian: "", itemIds: [], linkedVehicleId: "", sealState: "", gpsState: "", verificationMethod: "", expectedState: "", observedState: "", anomalyType: "", exception: "", evidenceIds: [] })
export const emptyCargoControl = (): CargoDraftControl => ({ itemId: newId("CSC"), controlType: "", expectedState: "", actualState: "", source: "", note: "", evidenceIds: [] })
export const emptyCargoDraft = (): CargoDraft => ({ items: [], damage: null, theft: null, temperatures: [], custody: [], controls: [], powerUnitId: "", trailerIds: [], precision: "EXACT_DATETIME" })

const child = (itemId: string, facts: Record<string, string | number | null>, evidenceIds: string[]): PerformanceChildFactItem => ({ itemId, facts, evidenceIds: unique(evidenceIds) })
const collection = (collectionId: string, itemType: string, items: PerformanceChildFactItem[]): PerformanceChildCollection | undefined => (items.length ? { collectionId, collectionVersion: "1.0", itemType, completeness: "COMPLETE", items } : undefined)

export function cargoItemFacts(item: CargoDraftItem): Record<string, string | number | null> {
  return {
    commodity: nullable(item.commodity), itemCode: nullable(item.itemCode), quantity: numberOrNull(item.quantity), quantityUnit: nullable(item.quantityUnit), affectedQuantity: numberOrNull(item.affectedQuantity), damagedQuantity: numberOrNull(item.damagedQuantity),
    stolenQuantity: numberOrNull(item.stolenQuantity), recoveredQuantity: numberOrNull(item.recoveredQuantity), condition: nullable(item.condition), hazmat: nullable(item.hazmat), temperatureSensitive: nullable(item.temperatureSensitive),
    ...moneyFacts("declaredValue", item.declaredValue, item.declaredCurrency), ...moneyFacts("insuredValue", item.insuredValue, item.insuredCurrency), ...moneyFacts("affectedValue", item.affectedValue, item.affectedCurrency), notes: nullable(item.notes),
  }
}

export function cargoDraftToChildren(draft: CargoDraft, vehicles: ReadonlyArray<{ id: string; label: string }>) {
  const vehicleLabel = (id: string) => vehicles.find((vehicle) => vehicle.id === id)?.label || id
  const collections = [
    collection(CID.ITEMS, "CARGO_ITEM", draft.items.map((item) => child(item.itemId, cargoItemFacts(item), item.evidenceIds))),
    draft.damage ? collection(CID.DAMAGE_OUTCOME, "CARGO_DAMAGE_OUTCOME", [child(newId("CDM"), {
      damageType: nullable(draft.damage.damageType), scope: nullable(draft.damage.scope), discoveryPoint: nullable(draft.damage.discoveryPoint), affectedItemIds: idsToFact(draft.damage.affectedItemIds), ...moneyFacts("damagedValue", draft.damage.damagedValue, draft.damage.damagedCurrency),
      disposition: nullable(draft.damage.disposition), origin: nullable(draft.damage.origin), reportedCause: nullable(draft.damage.reportedCause), reportedCauseOther: nullable(draft.damage.reportedCauseOther), narrative: nullable(draft.damage.narrative),
    }, draft.damage.evidenceIds)]) : undefined,
    collection(CID.TEMPERATURE, "CARGO_TEMPERATURE_OBSERVATION", draft.temperatures.map((obs) => child(obs.itemId, {
      setpoint: numberOrNull(obs.setpoint), minimum: numberOrNull(obs.minimum), maximum: numberOrNull(obs.maximum), unit: nullable(obs.unit), excursionMinutes: numberOrNull(obs.excursionMinutes), reeferStatus: nullable(obs.reeferStatus),
      reeferFuel: nullable(obs.reeferFuel), doorOpen: nullable(obs.doorOpen), source: nullable(obs.source), observedAt: nullable(obs.observedAt), note: nullable(obs.note),
    }, obs.evidenceIds))),
    draft.theft ? collection(CID.THEFT_OUTCOME, "CARGO_THEFT_OUTCOME", [child(newId("CTH"), {
      status: nullable(draft.theft.status), method: nullable(draft.theft.method), target: nullable(draft.theft.target), locationType: nullable(draft.theft.locationType), locationContext: nullable(draft.theft.locationContext), timeCertainty: nullable(draft.theft.timeCertainty),
      exactTime: nullable(draft.theft.exactTime), windowStart: nullable(draft.theft.windowStart), windowEnd: nullable(draft.theft.windowEnd), windowBasis: nullable(draft.theft.windowBasis), discoveryMethod: nullable(draft.theft.discoveryMethod),
      trackingStatus: nullable(draft.theft.trackingStatus), sealState: nullable(draft.theft.sealState), policeResponse: nullable(draft.theft.policeResponse), policeReference: nullable(draft.theft.policeReference), recoveryStatus: nullable(draft.theft.recoveryStatus),
      ...moneyFacts("stolenValue", draft.theft.stolenValue, draft.theft.stolenCurrency), ...moneyFacts("recoveredValue", draft.theft.recoveredValue, draft.theft.recoveredCurrency), narrative: nullable(draft.theft.narrative),
    }, draft.theft.evidenceIds)]) : undefined,
    collection(CID.CUSTODY, "CARGO_CUSTODY_RECORD", draft.custody.map((entry) => child(entry.itemId, {
      ordinal: numberOrNull(entry.ordinal), role: nullable(entry.role), event: nullable(entry.event), timestamp: nullable(entry.timestamp), location: nullable(entry.location), custodian: nullable(entry.custodian), itemIds: idsToFact(entry.itemIds),
      linkedVehicleId: nullable(entry.linkedVehicleId), sealState: nullable(entry.sealState), gpsState: nullable(entry.gpsState), verificationMethod: nullable(entry.verificationMethod), expectedState: nullable(entry.expectedState),
      observedState: nullable(entry.observedState), anomalyType: nullable(entry.anomalyType), exception: nullable(entry.exception),
    }, entry.evidenceIds))),
    collection(CID.SECURITY_CONTROLS, "CARGO_SECURITY_CONTROL", draft.controls.map((control) => child(control.itemId, {
      controlType: nullable(control.controlType), expectedState: nullable(control.expectedState), actualState: nullable(control.actualState), source: nullable(control.source), note: nullable(control.note),
    }, control.evidenceIds))),
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

const collectionOf = (event: Pick<CargoEvent, "childCollections">, id: string) => event.childCollections?.find((entry) => entry.collectionId === id)
const num = (facts: Record<string, unknown>, key: string) => (typeof facts[key] === "number" ? (facts[key] as number) : undefined)
const str = (facts: Record<string, unknown>, key: string) => text(facts[key])

export function readCargoItems(event: Pick<CargoEvent, "childCollections">) {
  return (collectionOf(event, CID.ITEMS)?.items || []).map((item) => ({
    itemId: item.itemId, commodity: str(item.facts, "commodity"), itemCode: str(item.facts, "itemCode"), quantity: num(item.facts, "quantity"), quantityUnit: str(item.facts, "quantityUnit"),
    affectedQuantity: num(item.facts, "affectedQuantity"), damagedQuantity: num(item.facts, "damagedQuantity"), stolenQuantity: num(item.facts, "stolenQuantity"), recoveredQuantity: num(item.facts, "recoveredQuantity"),
    condition: str(item.facts, "condition"), hazmat: str(item.facts, "hazmat"), temperatureSensitive: str(item.facts, "temperatureSensitive"),
    declaredValue: readCargoMoney(item.facts, "declaredValue"), insuredValue: readCargoMoney(item.facts, "insuredValue"), affectedValue: readCargoMoney(item.facts, "affectedValue"), notes: str(item.facts, "notes"), evidenceIds: item.evidenceIds,
  }))
}
export function readCargoDamage(event: Pick<CargoEvent, "childCollections">) {
  const item = collectionOf(event, CID.DAMAGE_OUTCOME)?.items[0]
  if (!item) return undefined
  return { itemId: item.itemId, damageType: str(item.facts, "damageType"), scope: str(item.facts, "scope"), discoveryPoint: str(item.facts, "discoveryPoint"), affectedItemIds: idsFromFact(item.facts.affectedItemIds), damagedValue: readCargoMoney(item.facts, "damagedValue"), disposition: str(item.facts, "disposition"), origin: str(item.facts, "origin"), reportedCause: str(item.facts, "reportedCause"), reportedCauseOther: str(item.facts, "reportedCauseOther"), narrative: str(item.facts, "narrative"), evidenceIds: item.evidenceIds }
}
export function readCargoTheft(event: Pick<CargoEvent, "childCollections">) {
  const item = collectionOf(event, CID.THEFT_OUTCOME)?.items[0]
  if (!item) return undefined
  const f = item.facts
  return { itemId: item.itemId, status: str(f, "status"), method: str(f, "method"), target: str(f, "target"), locationType: str(f, "locationType"), locationContext: str(f, "locationContext"), timeCertainty: str(f, "timeCertainty"), exactTime: str(f, "exactTime"), windowStart: str(f, "windowStart"), windowEnd: str(f, "windowEnd"), windowBasis: str(f, "windowBasis"), discoveryMethod: str(f, "discoveryMethod"), trackingStatus: str(f, "trackingStatus"), sealState: str(f, "sealState"), policeResponse: str(f, "policeResponse"), policeReference: str(f, "policeReference"), recoveryStatus: str(f, "recoveryStatus"), stolenValue: readCargoMoney(f, "stolenValue"), recoveredValue: readCargoMoney(f, "recoveredValue"), narrative: str(f, "narrative"), evidenceIds: item.evidenceIds }
}
export function readCargoTemperatures(event: Pick<CargoEvent, "childCollections">) {
  return (collectionOf(event, CID.TEMPERATURE)?.items || []).map((item) => ({ itemId: item.itemId, setpoint: num(item.facts, "setpoint"), minimum: num(item.facts, "minimum"), maximum: num(item.facts, "maximum"), unit: str(item.facts, "unit"), excursionMinutes: num(item.facts, "excursionMinutes"), reeferStatus: str(item.facts, "reeferStatus"), reeferFuel: str(item.facts, "reeferFuel"), doorOpen: str(item.facts, "doorOpen"), source: str(item.facts, "source"), observedAt: str(item.facts, "observedAt"), note: str(item.facts, "note"), evidenceIds: item.evidenceIds }))
}
export function readCargoCustody(event: Pick<CargoEvent, "childCollections">) {
  return (collectionOf(event, CID.CUSTODY)?.items || []).map((item) => ({ itemId: item.itemId, ordinal: Number(item.facts.ordinal), role: str(item.facts, "role"), event: str(item.facts, "event"), timestamp: str(item.facts, "timestamp"), location: str(item.facts, "location"), custodian: str(item.facts, "custodian"), itemIds: idsFromFact(item.facts.itemIds), linkedVehicleId: str(item.facts, "linkedVehicleId"), sealState: str(item.facts, "sealState"), gpsState: str(item.facts, "gpsState"), verificationMethod: str(item.facts, "verificationMethod"), expectedState: str(item.facts, "expectedState"), observedState: str(item.facts, "observedState"), anomalyType: str(item.facts, "anomalyType"), exception: str(item.facts, "exception"), evidenceIds: item.evidenceIds }))
    .sort((a, b) => a.ordinal - b.ordinal || a.itemId.localeCompare(b.itemId))
}
export function readCargoControls(event: Pick<CargoEvent, "childCollections">) {
  return (collectionOf(event, CID.SECURITY_CONTROLS)?.items || []).map((item) => ({ itemId: item.itemId, controlType: str(item.facts, "controlType"), expectedState: str(item.facts, "expectedState"), actualState: str(item.facts, "actualState"), source: str(item.facts, "source"), note: str(item.facts, "note"), evidenceIds: item.evidenceIds }))
}
export function readCargoStatusHistory(event: Pick<CargoEvent, "childCollections">) {
  return (collectionOf(event, CID.ITEM_STATUS_HISTORY)?.items || []).map((item) => ({ itemId: item.itemId, cargoItemId: str(item.facts, "cargoItemId"), fromStatus: str(item.facts, "fromStatus"), toStatus: str(item.facts, "toStatus"), changedAt: str(item.facts, "changedAt"), changedBy: str(item.facts, "changedBy"), note: str(item.facts, "note") }))
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.itemId.localeCompare(b.itemId))
}

// ---------------------------------------------------------------------------
// Derived values (never stored, never operator determinations)
// ---------------------------------------------------------------------------

export type CargoControlGap = "GAP" | "NO_GAP" | "UNDETERMINED"
/** Expected vs actual. The operator never chooses "Control Gap = Yes". */
export function deriveCargoControlGap(control: { expectedState: string; actualState: string }): CargoControlGap {
  if (!control.expectedState || !control.actualState || control.expectedState === "UNKNOWN" || control.actualState === "UNKNOWN") return "UNDETERMINED"
  if (control.expectedState === "NOT_REQUIRED") return "NO_GAP"
  if (control.expectedState === "IN_PLACE_FUNCTIONING") return control.actualState === "IN_PLACE_FUNCTIONING" ? "NO_GAP" : control.actualState === "NOT_REQUIRED" ? "UNDETERMINED" : "GAP"
  return "UNDETERMINED"
}
/** A discrepancy between expected and observed custody state is a FACT/exception: not theft, misconduct or root cause. */
export const deriveCargoCustodyDiscrepancy = (entry: { expectedState: string; observedState: string }) => Boolean(entry.expectedState && entry.observedState && entry.expectedState.trim().toLowerCase() !== entry.observedState.trim().toLowerCase())

const stampOf = (date: string | undefined, time: string | undefined) => (date ? (time ? `${date}T${time}` : date) : "")
const earlier = (a: string, b: string) => (a.length >= 16 && b.length >= 16 ? a.slice(0, 16) < b.slice(0, 16) : a.slice(0, 10) < b.slice(0, 10))
const MINUTES = (stamp: string) => { const ms = Date.parse(`${stamp.length === 10 ? `${stamp}T00:00` : stamp.slice(0, 16)}:00Z`); return Number.isNaN(ms) ? undefined : ms / 60000 }

/** Occurrence -> discovery -> report delays, derived only when both ends are exact enough. */
export function deriveCargoTimingDelays(event: CargoEvent) {
  const occurrence = event.occurrencePrecision === "EXACT_DATETIME" ? stampOf(event.eventDate, event.eventTime) : ""
  const discovery = stampOf(factText(event, CARGO_DATA_POINTS.discoveryDate), factText(event, CARGO_DATA_POINTS.discoveryTime))
  const reported = stampOf(event.reportedDate, factText(event, CARGO_DATA_POINTS.reportedTime))
  const gap = (a: string, b: string) => (a.length >= 16 && b.length >= 16 ? (MINUTES(b) ?? NaN) - (MINUTES(a) ?? NaN) : undefined)
  const valid = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? undefined : n)
  return { occurrenceToDiscoveryMinutes: valid(gap(occurrence, discovery)), discoveryToReportMinutes: valid(gap(discovery, reported)), occurrenceToReportMinutes: valid(gap(occurrence, reported)) }
}

// ---------------------------------------------------------------------------
// Validation (NEW records only; legacy Cargo Damage / Cargo Theft are never validated against these rules)
// ---------------------------------------------------------------------------

export type CargoValidationStep = "OCCURRENCE" | "CARGO_SHIPMENT" | "CARGO_CARRIER" | "CARGO_ITEMS" | "CARGO_CLASSIFICATION" | "CARGO_RESPONSE" | "CARGO_OUTCOMES" | "CARGO_CUSTODY" | "EVIDENCE" | "REVIEW"
export interface CargoValidationIssue { step: CargoValidationStep; message: string }
export type NewCargoCandidate = CargoEvent & { driverMasterId?: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const TIME = /^\d{2}:\d{2}$/
const hasDup = (items: readonly string[]) => items.some((item, index) => items.indexOf(item) !== index)

export const validateNewCargoIncident = (data: NewCargoCandidate): string[] => validateNewCargoIncidentDetailed(data).map((issue) => issue.message)

export function validateNewCargoIncidentDetailed(data: NewCargoCandidate): CargoValidationIssue[] {
  const issues: CargoValidationIssue[] = []
  let step: CargoValidationStep = "OCCURRENCE"
  const err = (message: string) => { issues.push({ step, message }) }
  const f = (id: string) => factText(data, id)
  const controlled = (id: string, list: readonly Option[], name: string) => { const value = f(id); if (value && !inList(list, value)) err(`${name} must be a controlled value.`) }
  const evidence = new Set(data.evidenceIds || [])
  const refs = (ids: readonly string[], where: string) => { for (const id of ids) if (!evidence.has(id)) err(`${where} references evidence that is not linked to this Cargo Incident: ${id}.`) }
  const money = (facts: Record<string, unknown>, name: string, label: string) => {
    const value = facts[name]; const currency = text(facts[`${name}Currency`])
    if (value === null || value === undefined) return
    if (typeof value !== "number" || Number.isNaN(value) || value < 0) { err(`${label} must be zero or greater.`); return }
    if (!currency) err(`${label} needs an ISO currency code.`)
    else if (!isSupportedCurrencyCode(currency)) err(`${label} currency must be a valid ISO 4217 code.`)
  }
  const nonNegative = (facts: Record<string, unknown>, key: string, label: string) => { const value = facts[key]; if (value !== null && value !== undefined && (typeof value !== "number" || Number.isNaN(value) || value < 0)) err(`${label} must be zero or greater.`) }

  // Occurrence / time model
  const precision = text(data.occurrencePrecision)
  if (!text(data.eventDate)) err("Event Date is required.")
  else if (!DATE.test(text(data.eventDate))) err("Event Date must be a valid date.")
  if (!inList(T.CARGO_OCCURRENCE_PRECISIONS, precision)) err("Occurrence precision must be exact, date only, approximate or unknown.")
  if (precision === "EXACT_DATETIME" && !text(data.eventTime)) err("Event Time is required when the occurrence is exact.")
  if (text(data.eventTime) && !TIME.test(text(data.eventTime))) err("Event Time must be a valid time.")
  if (!text(data.driverMasterId)) err("Driver is required.")
  if (!text(data.location)) err("Location is required.")
  if (!text(data.country)) err("Country is required.")
  if (!inList(T.CARGO_SOURCES, text(data.provenance?.source))) err("Source is required and must be a Cargo Incident source.")
  const windowStart = f(CARGO_DATA_POINTS.windowStart); const windowEnd = f(CARGO_DATA_POINTS.windowEnd)
  if (windowStart || windowEnd) {
    if (!windowStart || !windowEnd) err("An estimated occurrence window needs both a start and an end.")
    else if (!DATETIME.test(windowStart) || !DATETIME.test(windowEnd)) err("The occurrence window must use valid dates / times.")
    else if (earlier(windowEnd, windowStart)) err("The occurrence window end cannot be before its start.")
  }
  const discoveryDate = f(CARGO_DATA_POINTS.discoveryDate); const discoveryTime = f(CARGO_DATA_POINTS.discoveryTime)
  if (discoveryTime && !discoveryDate) err("A discovery time needs a discovery date.")
  if (discoveryDate && !DATE.test(discoveryDate)) err("Discovery date must be a valid date.")
  if (discoveryTime && !TIME.test(discoveryTime)) err("Discovery time must be a valid time.")
  const reportedTime = f(CARGO_DATA_POINTS.reportedTime)
  if (reportedTime && !text(data.reportedDate)) err("A reported time needs a reported date.")
  const occurrenceEarliest = windowStart && DATETIME.test(windowStart) ? windowStart : precision === "UNKNOWN" ? "" : stampOf(text(data.eventDate), precision === "EXACT_DATETIME" ? text(data.eventTime) : "")
  const discovery = stampOf(discoveryDate, discoveryTime)
  const reported = stampOf(text(data.reportedDate), reportedTime)
  if (discovery && occurrenceEarliest && earlier(discovery, occurrenceEarliest)) err("Discovery cannot be before the occurrence.")
  if (reported && discovery && earlier(reported, discovery)) err("The report cannot be dated before discovery.")
  if (reported && occurrenceEarliest && earlier(reported, occurrenceEarliest)) err("The report cannot be dated before the occurrence.")

  step = "CARGO_CARRIER"
  const powerUnitId = text(data.vehicleId) || text(data.canonicalLinks?.find((link) => link.relationshipKey === "vehicle" && link.entityType === "Vehicle")?.recordId)
  if (!powerUnitId) err("Power Unit is required.")
  controlled(CARGO_DATA_POINTS.custodyStage, T.CARGO_CUSTODY_STAGES, "Custody Stage")

  step = "CARGO_CLASSIFICATION"
  const family = f(CARGO_DATA_POINTS.primaryFamily)
  if (!family) err("Primary Incident Family is required.")
  else if (!inList(T.CARGO_PRIMARY_FAMILIES, family)) err("Primary Incident Family must be a controlled value.")
  const secondary = f(CARGO_DATA_POINTS.secondaryClassification)
  if (secondary) {
    const allowed = T.CARGO_SECONDARY_BY_FAMILY[family] || []
    if (!family) err("Choose the Primary Incident Family before a Secondary Classification.")
    else if (!allowed.some((item) => item.value === secondary)) err("Secondary Classification does not belong to the selected Primary Incident Family.")
  }

  step = "CARGO_RESPONSE"
  for (const key of CARGO_RESPONSE_FACT_KEYS) controlled(CARGO_DATA_POINTS[key], T.CARGO_YES_NO_UNKNOWN, "Immediate response")

  step = "CARGO_ITEMS"
  const itemCollection = collectionOf(data, CID.ITEMS)?.items || []
  // Detailed Cargo Items are OPTIONAL: an incident is recordable before exact commodity / quantity detail is known.
  // Lightweight context never creates an item. Everything below applies only to items that exist.
  const contextStatus = f(CARGO_DATA_POINTS.cargoContextStatus)
  if (contextStatus && !inList(T.CARGO_CONTEXT_STATUSES, contextStatus)) err("Cargo context must be a controlled value.")
  if (contextStatus === "KNOWN_GENERAL" && !f(CARGO_DATA_POINTS.cargoGeneralDescription)) err("Describe the general cargo when the cargo context is known.")
  if (contextStatus === "NOT_ESTABLISHED" && f(CARGO_DATA_POINTS.cargoGeneralDescription)) err("A cargo description cannot accompany 'Cargo not yet established'.")
  const items = readCargoItems(data)
  if (hasDup(itemCollection.map((item) => item.itemId)) || itemCollection.some((item) => !item.itemId)) err("Cargo Item ids must be present and unique.")
  const itemIds = new Set(itemCollection.map((item) => item.itemId))
  for (const [index, item] of itemCollection.entries()) {
    const read = items[index]
    if (!read.commodity) err("Every Cargo Item needs a commodity / description.")
    for (const key of ["quantity", "affectedQuantity", "damagedQuantity", "stolenQuantity", "recoveredQuantity"]) nonNegative(item.facts, key, "Cargo Item quantity")
    const anyQuantity = ["quantity", "affectedQuantity", "damagedQuantity", "stolenQuantity", "recoveredQuantity"].some((key) => typeof item.facts[key] === "number")
    if (anyQuantity && !read.quantityUnit) err("Cargo Item quantities need a unit.")
    if (read.quantityUnit && !inList(T.CARGO_QUANTITY_UNITS, read.quantityUnit)) err("Cargo Item unit must be a controlled value.")
    if (read.condition && !inList(T.CARGO_ITEM_STATUSES, read.condition)) err("Cargo Item condition must be a controlled value.")
    for (const [value, name] of [[read.hazmat, "hazmat"], [read.temperatureSensitive, "temperature-sensitive"]] as const) if (value && !inList(T.CARGO_YES_NO_UNKNOWN, value)) err(`Cargo Item ${name} status must be Yes, No or Unknown.`)
    for (const [key, name] of [["declaredValue", "Declared Value"], ["insuredValue", "Insured Value"], ["affectedValue", "Affected Value"]]) money(item.facts, key, name)
    // Unknown stays unknown: quantity relationships are only checked where both sides are known.
    if (read.quantity !== undefined) {
      for (const [value, name] of [[read.affectedQuantity, "affected"], [read.damagedQuantity, "damaged"], [read.stolenQuantity, "stolen"]] as const) if (value !== undefined && value > read.quantity) err(`The ${name} quantity cannot exceed the item quantity.`)
    }
    if (read.recoveredQuantity !== undefined && read.stolenQuantity !== undefined && read.recoveredQuantity > read.stolenQuantity) err("The recovered quantity cannot exceed the stolen quantity.")
    refs(read.evidenceIds, "A Cargo Item")
  }
  const history = readCargoStatusHistory(data)
  for (const entry of history) {
    if (!itemIds.has(entry.cargoItemId)) err("A status-history entry references a Cargo Item that does not exist.")
    if (!inList(T.CARGO_ITEM_STATUSES, entry.toStatus)) err("A status-history entry has an invalid status.")
    if (!entry.changedBy || !entry.changedAt) err("A status-history entry needs who and when.")
  }

  step = "CARGO_OUTCOMES"
  const damage = readCargoDamage(data)
  const damageItem = collectionOf(data, CID.DAMAGE_OUTCOME)?.items[0]
  if ((collectionOf(data, CID.DAMAGE_OUTCOME)?.items.length || 0) > 1) err("A Cargo Incident has at most one Damage outcome.")
  if (damage && damageItem) {
    for (const [value, list, name] of [[damage.damageType, T.CARGO_DAMAGE_TYPES, "Damage type"], [damage.scope, T.CARGO_DAMAGE_SCOPES, "Damage scope"], [damage.discoveryPoint, T.CARGO_CUSTODY_STAGES, "Damage discovery point"], [damage.disposition, T.CARGO_DISPOSITIONS, "Damage disposition"], [damage.origin, T.CARGO_DAMAGE_ORIGINS, "Damage origin"], [damage.reportedCause, T.CARGO_REPORTED_CAUSES, "Reported / Suspected Cause"]] as Array<[string, readonly Option[], string]>) if (value && !inList(list, value)) err(`${name} must be a controlled value.`)
    if (damage.reportedCause === "OTHER" && !damage.reportedCauseOther) err("Describe the Other Reported / Suspected Cause.")
    if (damage.affectedItemIds.some((id) => !itemIds.has(id))) err("The Damage outcome references a Cargo Item that does not exist.")
    money(damageItem.facts, "damagedValue", "Damaged Value")
    refs(damage.evidenceIds, "The Damage outcome")
  }
  if ((collectionOf(data, CID.THEFT_OUTCOME)?.items.length || 0) > 1) err("A Cargo Incident has at most one Theft outcome.")
  const theft = readCargoTheft(data)
  const theftItem = collectionOf(data, CID.THEFT_OUTCOME)?.items[0]
  if (theft && theftItem) {
    for (const [value, list, name] of [[theft.status, T.CARGO_THEFT_STATUSES, "Theft status"], [theft.method, T.CARGO_THEFT_METHODS, "Theft method"], [theft.target, T.CARGO_THEFT_TARGETS, "Theft target"], [theft.locationType, T.CARGO_LOCATION_TYPES, "Theft location type"], [theft.timeCertainty, T.CARGO_TIME_CERTAINTIES, "Theft time certainty"], [theft.discoveryMethod, T.CARGO_DISCOVERY_METHODS, "Discovery method"], [theft.trackingStatus, T.CARGO_TRACKING_STATUSES, "Tracking status"], [theft.sealState, T.CARGO_SEAL_STATES, "Seal state"], [theft.policeResponse, T.CARGO_POLICE_RESPONSES, "Police response"], [theft.recoveryStatus, T.CARGO_RECOVERY_STATUSES, "Recovery status"]] as Array<[string, readonly Option[], string]>) if (value && !inList(list, value)) err(`${name} must be a controlled value.`)
    if (theft.timeCertainty === "EXACT") {
      if (!theft.exactTime) err("An exact theft time is required when the time certainty is Exact.")
      else if (!DATETIME.test(theft.exactTime)) err("The theft time must be a valid date / time.")
      if (theft.windowStart || theft.windowEnd) err("An exact theft time cannot also carry an estimated window.")
    } else if (theft.timeCertainty === "ESTIMATED_WINDOW") {
      if (!theft.windowStart || !theft.windowEnd) err("An estimated theft window needs both a start and an end.")
      else if (!DATETIME.test(theft.windowStart) || !DATETIME.test(theft.windowEnd)) err("The theft window must use valid dates / times.")
      else if (earlier(theft.windowEnd, theft.windowStart)) err("The theft window end cannot be before its start.")
      if (theft.exactTime) err("An estimated theft window cannot also carry an exact time.")
    } else if (theft.exactTime || theft.windowStart || theft.windowEnd) err("Theft time details require the time certainty to be Exact or Estimated window; an exact time is never assumed.")
    money(theftItem.facts, "stolenValue", "Stolen Value"); money(theftItem.facts, "recoveredValue", "Recovered Value")
    if (theft.stolenValue && theft.recoveredValue && theft.stolenValue.currencyCode === theft.recoveredValue.currencyCode && theft.recoveredValue.value > theft.stolenValue.value) err("The recovered value cannot exceed the stolen value.")
    refs(theft.evidenceIds, "The Theft outcome")
  }
  const temperatures = readCargoTemperatures(data)
  const temperatureItems = collectionOf(data, CID.TEMPERATURE)?.items || []
  if (hasDup(temperatureItems.map((item) => item.itemId))) err("Temperature observation ids must be unique.")
  for (const observation of temperatures) {
    const hasTemperature = [observation.setpoint, observation.minimum, observation.maximum].some((value) => value !== undefined)
    if (hasTemperature && !inList(T.CARGO_TEMPERATURE_UNITS, observation.unit)) err("Temperature readings need a unit (C or F).")
    if (observation.minimum !== undefined && observation.maximum !== undefined && observation.minimum > observation.maximum) err("The minimum temperature cannot exceed the maximum.")
    if (observation.excursionMinutes !== undefined && observation.excursionMinutes < 0) err("Excursion duration must be zero or greater.")
    if (observation.source && !inList(T.CARGO_MEASUREMENT_SOURCES, observation.source)) err("Measurement source must be a controlled value.")
    if (hasTemperature && !observation.source) err("A temperature observation needs its measurement source (use Unknown if it is not known).")
    for (const [value, list, name] of [[observation.reeferStatus, T.CARGO_REEFER_STATUSES, "Reefer status"], [observation.reeferFuel, T.CARGO_REEFER_FUEL, "Reefer fuel status"], [observation.doorOpen, T.CARGO_YES_NO_UNKNOWN, "Door-open"]] as Array<[string, readonly Option[], string]>) if (value && !inList(list, value)) err(`${name} must be a controlled value.`)
    if (observation.observedAt && !DATETIME.test(observation.observedAt)) err("The observation time must be a valid date / time.")
    refs(observation.evidenceIds, "A temperature observation")
  }

  step = "CARGO_CUSTODY"
  const custody = readCargoCustody(data)
  const custodyItems = collectionOf(data, CID.CUSTODY)?.items || []
  if (hasDup(custodyItems.map((item) => item.itemId))) err("Custody record ids must be unique.")
  const ordinals = custody.map((entry) => entry.ordinal)
  if (ordinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1)) err("Custody ordinals must be positive whole numbers.")
  if (hasDup(ordinals.map(String))) err("Custody ordinals must be unique.")
  if (custody.filter((entry) => entry.role === "LAST_KNOWN_GOOD").length > 1) err("Only one Last Known Good custody record is allowed.")
  if (custody.filter((entry) => entry.role === "FIRST_SECURITY_ANOMALY").length > 1) err("Only one First Security Anomaly custody record is allowed.")
  const trailerLinks = new Set((data.canonicalLinks || []).filter((link) => link.relationshipKey === "trailer").map((link) => link.recordId))
  for (const entry of custody) {
    if (!inList(T.CARGO_CUSTODY_ROLES, entry.role)) err("Custody role must be a controlled value.")
    if (entry.anomalyType && entry.role !== "FIRST_SECURITY_ANOMALY") err("An anomaly type belongs only on the First Security Anomaly record.")
    if (entry.role === "FIRST_SECURITY_ANOMALY" && !entry.anomalyType) err("The First Security Anomaly needs an anomaly type (use Unknown if it is not known).")
    if (entry.anomalyType && !inList(T.CARGO_ANOMALY_TYPES, entry.anomalyType)) err("Anomaly type must be a controlled value.")
    if (!entry.event && !entry.role) err("Each custody record needs an event.")
    if (entry.itemIds.some((id) => !itemIds.has(id))) err("A custody record references a Cargo Item that does not exist.")
    if (entry.linkedVehicleId && entry.linkedVehicleId !== powerUnitId && !trailerLinks.has(entry.linkedVehicleId)) err("A custody record references a vehicle that is not linked to this Cargo Incident.")
    if (entry.timestamp && !DATETIME.test(entry.timestamp)) err("A custody timestamp must be a valid date / time.")
    for (const [value, list, name] of [[entry.sealState, T.CARGO_SEAL_STATES, "Seal state"], [entry.gpsState, T.CARGO_GPS_STATES, "GPS state"], [entry.verificationMethod, T.CARGO_VERIFICATION_METHODS, "Verification method"]] as Array<[string, readonly Option[], string]>) if (value && !inList(list, value)) err(`${name} must be a controlled value.`)
    refs(entry.evidenceIds, "A custody record")
  }
  const controls = readCargoControls(data)
  const controlItems = collectionOf(data, CID.SECURITY_CONTROLS)?.items || []
  if (hasDup(controlItems.map((item) => item.itemId))) err("Security control ids must be unique.")
  for (const [index, control] of controls.entries()) {
    if (!inList(T.CARGO_CONTROL_TYPES, control.controlType)) err("Security control type must be a controlled value.")
    if (control.expectedState && !inList(T.CARGO_CONTROL_STATES, control.expectedState)) err("Expected control state must be a controlled value.")
    if (control.actualState && !inList(T.CARGO_CONTROL_STATES, control.actualState)) err("Actual control state must be a controlled value.")
    if (control.source && !inList(T.CARGO_MEASUREMENT_SOURCES, control.source)) err("Control source must be a controlled value.")
    if (Object.keys(controlItems[index].facts).some((key) => /gap/i.test(key))) err("A control gap is derived from expected vs actual and cannot be stored as a determination.")
    refs(control.evidenceIds, "A security control")
  }
  step = "REVIEW"
  if (Object.keys(data.structuredFacts || {}).length) err("New Cargo Incidents use structured facts only.")
  return issues
}

// ---------------------------------------------------------------------------
// Item status history (append-only)
// ---------------------------------------------------------------------------

/** The item's current condition changes; every prior state is preserved in the companion history collection. */
export function appendCargoItemStatusChange<E extends CargoEvent>(event: E, input: { cargoItemId: string; toStatus: string; changedBy: string; note?: string; at?: string }): E {
  const changedBy = text(input.changedBy)
  if (!changedBy) throw new Error("changedBy is required.")
  if (!inList(T.CARGO_ITEM_STATUSES, input.toStatus)) throw new Error("Cargo Item status must be a controlled value.")
  const items = collectionOf(event, CID.ITEMS)
  const current = items?.items.find((item) => item.itemId === input.cargoItemId)
  if (!items || !current) throw new Error("Cargo Item not found.")
  const fromStatus = text(current.facts.condition)
  const at = input.at || new Date().toISOString()
  const entry: PerformanceChildFactItem = { itemId: newId("CSH"), facts: { cargoItemId: input.cargoItemId, fromStatus: fromStatus || null, toStatus: input.toStatus, changedAt: at, changedBy, note: text(input.note) || null }, evidenceIds: [] }
  const history = collectionOf(event, CID.ITEM_STATUS_HISTORY)
  const nextHistory: PerformanceChildCollection = history ? { ...history, items: [...history.items, entry] } : { collectionId: CID.ITEM_STATUS_HISTORY, collectionVersion: "1.0", itemType: "CARGO_ITEM_STATUS_CHANGE", completeness: "COMPLETE", items: [entry] }
  const nextItems: PerformanceChildCollection = { ...items, items: items.items.map((item) => (item.itemId === input.cargoItemId ? { ...item, facts: { ...item.facts, condition: input.toStatus } } : item)) }
  return { ...event, childCollections: [...(event.childCollections || []).filter((entry2) => entry2.collectionId !== CID.ITEMS && entry2.collectionId !== CID.ITEM_STATUS_HISTORY), nextItems, nextHistory] }
}

// ---------------------------------------------------------------------------
// Workflow provider (registered with the common workflow engine)
// ---------------------------------------------------------------------------

/**
 * A bare Cargo Incident creates NO obligation merely because it exists. Cargo has no obligation of its own in the stored data, so the
 * obligations come only from the common providers (reviewer-required investigation, required Company Actions, verification,
 * follow-up). Registered so the family is an explicit extension point when a Cargo requirement is genuinely stored later.
 */
export const cargoWorkflowProvider: WorkflowProvider = {
  id: "cargo-incident",
  collect(foundationEvent: FoundationEvent, _state: PerformanceFoundationState): WorkflowObligation[] {
    void foundationEvent
    return []
  },
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const moneyLabel = (money: CargoMoney | undefined) => (money ? `${money.value.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${money.currencyCode}` : undefined)
const qtyLabel = (value: number | undefined, unit: string) => (value === undefined ? undefined : `${value}${unit ? ` ${L(T.CARGO_QUANTITY_UNITS, unit)}` : ""}`)

export function describeCargoIncident(event: CargoEvent) {
  const itemRows = readCargoItems(event)
  const nameOf = (id: string) => itemRows.find((item) => item.itemId === id)?.commodity || id
  const vehicleLabel = (id: string) => event.canonicalLinks?.find((link) => link.recordId === id)?.label || id
  const damage = readCargoDamage(event)
  const theft = readCargoTheft(event)
  const family = factText(event, CARGO_DATA_POINTS.primaryFamily)
  const secondary = factText(event, CARGO_DATA_POINTS.secondaryClassification)
  return {
    cargoContext: { status: L(T.CARGO_CONTEXT_STATUSES, factText(event, CARGO_DATA_POINTS.cargoContextStatus)) || undefined, description: factText(event, CARGO_DATA_POINTS.cargoGeneralDescription) || undefined },
    classification: { family: L(T.CARGO_PRIMARY_FAMILIES, family) || undefined, secondary: L(T.CARGO_SECONDARY_ALL, secondary) || undefined, custodyStage: L(T.CARGO_CUSTODY_STAGES, factText(event, CARGO_DATA_POINTS.custodyStage)) || undefined },
    time: {
      precision: L(T.CARGO_OCCURRENCE_PRECISIONS, event.occurrencePrecision) || undefined, windowStart: factText(event, CARGO_DATA_POINTS.windowStart) || undefined, windowEnd: factText(event, CARGO_DATA_POINTS.windowEnd) || undefined,
      windowBasis: factText(event, CARGO_DATA_POINTS.windowBasis) || undefined, discovery: [factText(event, CARGO_DATA_POINTS.discoveryDate), factText(event, CARGO_DATA_POINTS.discoveryTime)].filter(Boolean).join(" ") || undefined,
      reported: [text(event.reportedDate), factText(event, CARGO_DATA_POINTS.reportedTime)].filter(Boolean).join(" ") || undefined, delays: deriveCargoTimingDelays(event),
    },
    shipment: [["Load Reference", "loadReference"], ["BOL / PRO", "bolPro"], ["Shipment Reference", "shipmentReference"], ["Customer", "customerName"], ["Shipper", "shipperName"], ["Receiver", "receiverName"], ["Broker", "brokerName"], ["Origin", "origin"], ["Destination", "destination"], ["Facility / Site", "facilitySite"], ["Planned Route", "plannedRoute"], ["Actual Route", "actualRoute"]]
      .map(([name, key]) => ({ label: name, value: factText(event, CARGO_DATA_POINTS[key as keyof typeof CARGO_DATA_POINTS]) })).filter((row) => row.value),
    carrier: { powerUnit: (event.canonicalLinks || []).filter((link) => link.relationshipKey === "vehicle").map((link) => link.label || link.recordId).join(", ") || undefined, trailers: (event.canonicalLinks || []).filter((link) => link.relationshipKey === "trailer").map((link) => link.label || link.recordId).join(", ") || undefined },
    items: itemRows.map((item) => ({
      id: item.itemId, commodity: item.commodity, code: item.itemCode || undefined, quantity: qtyLabel(item.quantity, item.quantityUnit), affected: qtyLabel(item.affectedQuantity, item.quantityUnit), damaged: qtyLabel(item.damagedQuantity, item.quantityUnit), stolen: qtyLabel(item.stolenQuantity, item.quantityUnit), recovered: qtyLabel(item.recoveredQuantity, item.quantityUnit),
      status: L(T.CARGO_ITEM_STATUSES, item.condition) || undefined, hazmat: L(T.CARGO_YES_NO_UNKNOWN, item.hazmat) || undefined, temperatureSensitive: L(T.CARGO_YES_NO_UNKNOWN, item.temperatureSensitive) || undefined,
      declared: moneyLabel(item.declaredValue), insured: moneyLabel(item.insuredValue), affectedValue: moneyLabel(item.affectedValue), notes: item.notes || undefined,
    })),
    statusHistory: readCargoStatusHistory(event).map((entry) => ({ item: nameOf(entry.cargoItemId), from: L(T.CARGO_ITEM_STATUSES, entry.fromStatus) || undefined, to: L(T.CARGO_ITEM_STATUSES, entry.toStatus), by: entry.changedBy, at: entry.changedAt, note: entry.note || undefined })),
    damage: damage ? { type: L(T.CARGO_DAMAGE_TYPES, damage.damageType) || undefined, scope: L(T.CARGO_DAMAGE_SCOPES, damage.scope) || undefined, discoveryPoint: L(T.CARGO_CUSTODY_STAGES, damage.discoveryPoint) || undefined, affectedItems: damage.affectedItemIds.map(nameOf), damagedValue: moneyLabel(damage.damagedValue), disposition: L(T.CARGO_DISPOSITIONS, damage.disposition) || undefined, origin: L(T.CARGO_DAMAGE_ORIGINS, damage.origin) || undefined, reportedCause: damage.reportedCause === "OTHER" && damage.reportedCauseOther ? `Other: ${damage.reportedCauseOther}` : L(T.CARGO_REPORTED_CAUSES, damage.reportedCause) || undefined, narrative: damage.narrative || undefined } : undefined,
    temperature: readCargoTemperatures(event).map((obs) => ({ id: obs.itemId, setpoint: obs.setpoint !== undefined ? `${obs.setpoint} ${L(T.CARGO_TEMPERATURE_UNITS, obs.unit)}` : undefined, range: obs.minimum !== undefined || obs.maximum !== undefined ? `${obs.minimum ?? "?"} to ${obs.maximum ?? "?"} ${L(T.CARGO_TEMPERATURE_UNITS, obs.unit)}` : undefined, excursion: obs.excursionMinutes !== undefined ? `${obs.excursionMinutes} min` : undefined, reefer: L(T.CARGO_REEFER_STATUSES, obs.reeferStatus) || undefined, fuel: L(T.CARGO_REEFER_FUEL, obs.reeferFuel) || undefined, doorOpen: L(T.CARGO_YES_NO_UNKNOWN, obs.doorOpen) || undefined, source: L(T.CARGO_MEASUREMENT_SOURCES, obs.source) || undefined, observedAt: obs.observedAt || undefined, note: obs.note || undefined })),
    theft: theft ? { status: L(T.CARGO_THEFT_STATUSES, theft.status) || undefined, method: L(T.CARGO_THEFT_METHODS, theft.method) || undefined, target: L(T.CARGO_THEFT_TARGETS, theft.target) || undefined, locationType: L(T.CARGO_LOCATION_TYPES, theft.locationType) || undefined, locationContext: theft.locationContext || undefined, timeCertainty: L(T.CARGO_TIME_CERTAINTIES, theft.timeCertainty) || undefined, time: theft.timeCertainty === "EXACT" ? theft.exactTime.replace("T", " ") : theft.timeCertainty === "ESTIMATED_WINDOW" ? `${theft.windowStart.replace("T", " ")} to ${theft.windowEnd.replace("T", " ")}${theft.windowBasis ? ` (${theft.windowBasis})` : ""}` : undefined, discoveryMethod: L(T.CARGO_DISCOVERY_METHODS, theft.discoveryMethod) || undefined, tracking: L(T.CARGO_TRACKING_STATUSES, theft.trackingStatus) || undefined, seal: L(T.CARGO_SEAL_STATES, theft.sealState) || undefined, police: [L(T.CARGO_POLICE_RESPONSES, theft.policeResponse), theft.policeReference].filter(Boolean).join(" - ") || undefined, recovery: L(T.CARGO_RECOVERY_STATUSES, theft.recoveryStatus) || undefined, stolenValue: moneyLabel(theft.stolenValue), recoveredValue: moneyLabel(theft.recoveredValue), narrative: theft.narrative || undefined } : undefined,
    custody: readCargoCustody(event).map((entry) => ({ id: entry.itemId, ordinal: entry.ordinal, role: L(T.CARGO_CUSTODY_ROLES, entry.role), event: entry.event || undefined, timestamp: entry.timestamp || undefined, location: entry.location || undefined, custodian: entry.custodian || undefined, items: entry.itemIds.map(nameOf), vehicle: entry.linkedVehicleId ? vehicleLabel(entry.linkedVehicleId) : undefined, seal: L(T.CARGO_SEAL_STATES, entry.sealState) || undefined, gps: L(T.CARGO_GPS_STATES, entry.gpsState) || undefined, verification: L(T.CARGO_VERIFICATION_METHODS, entry.verificationMethod) || undefined, expected: entry.expectedState || undefined, observed: entry.observedState || undefined, discrepancy: deriveCargoCustodyDiscrepancy(entry), anomaly: L(T.CARGO_ANOMALY_TYPES, entry.anomalyType) || undefined, exception: entry.exception || undefined })),
    controls: readCargoControls(event).map((control) => ({ id: control.itemId, type: L(T.CARGO_CONTROL_TYPES, control.controlType), expected: L(T.CARGO_CONTROL_STATES, control.expectedState) || undefined, actual: L(T.CARGO_CONTROL_STATES, control.actualState) || undefined, gap: deriveCargoControlGap(control), source: L(T.CARGO_MEASUREMENT_SOURCES, control.source) || undefined, note: control.note || undefined })),
    response: CARGO_RESPONSE_FACT_KEYS.map((key) => ({ key, value: L(T.CARGO_YES_NO_UNKNOWN, factText(event, CARGO_DATA_POINTS[key])) })).filter((row) => row.value),
    narrative: factText(event, CARGO_DATA_POINTS.incidentNarrative) || undefined,
  }
}
export type CargoDescription = ReturnType<typeof describeCargoIncident>

/** Legacy Cargo Damage / Cargo Theft: read-only compatibility readback. Old fields are shown as recorded; nothing is mapped into the new model. */
export function describeLegacyCargo(event: CargoEvent) {
  const byId = (suffix: string) => event.structuredEventFacts?.find((fact) => fact.dataPointId.endsWith(suffix))
  const value = (suffix: string) => byId(suffix)?.value
  const yesNo = (suffix: string) => (value(suffix) === true ? "Yes" : value(suffix) === false ? "No" : undefined)
  const LEGACY_ISSUES: Record<string, string> = { DAMAGE: "Damage", SHORTAGE: "Shortage", LOSS: "Loss", CONTAMINATION: "Contamination", SECUREMENT_CONCERN: "Securement Concern", OTHER: "Other" }
  const issue = text(value(".CARGOISSUETYPE"))
  const loss = byId(".ESTIMATEDLOSSAMOUNT")
  return {
    kind: event.eventType === "Cargo Theft" ? ("THEFT" as const) : ("DAMAGE" as const),
    cargoIssue: issue ? LEGACY_ISSUES[issue] || issue : undefined,
    description: text(value(".CARGODESCRIPTION")) || undefined,
    quantityAffected: typeof value(".QUANTITYAFFECTED") === "number" ? (value(".QUANTITYAFFECTED") as number) : undefined,
    estimatedLoss: typeof loss?.value === "number" ? `${loss.value}${loss.unit && loss.unit !== "currency" ? ` ${loss.unit}` : ""}` : undefined,
    packagingFailure: yesNo(".PACKAGINGFAILURE"), securementConcern: yesNo(".SECUREMENTCONCERN"), sealCompromised: yesNo(".SEALCOMPROMISED"),
    lastKnownLocation: text(value(".LASTKNOWNLOCATION")) || undefined, lastKnownDate: text(value(".LASTKNOWNDATE")) || undefined,
    damageNarrative: text(value(".DAMAGENOTES")) || undefined, theftNarrative: text(value(".THEFTNARRATIVE")) || undefined, source: text(event.provenance?.source) || undefined,
  }
}

export function buildCargoSummary(event: CargoEvent) {
  const description = describeCargoIncident(event)
  const power = event.canonicalLinks?.find((link) => link.relationshipKey === "vehicle" && link.label)?.label
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(event.eventDate || "")
  const date = match ? `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}` : event.eventDate || ""
  const place = [text(event.location), text(event.city), text(event.stateProvince)].filter(Boolean).join(", ")
  const outcomes = [description.damage ? "Damage" : "", description.theft ? "Theft" : ""].filter(Boolean).join(" + ")
  return { title: "Cargo Incident", familyLine: [description.classification.family, description.classification.secondary].filter(Boolean).join(" - ") || undefined, outcomeLine: outcomes ? `Outcomes: ${outcomes}` : undefined, contextLine: [date, power, place].filter(Boolean).join(" · ") }
}
