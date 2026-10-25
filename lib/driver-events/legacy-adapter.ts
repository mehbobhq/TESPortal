import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE } from "@/lib/driver-performance-schema"
import type { CanonicalEntityLink, DriverPerformanceEvent, StructuredEventFact } from "@/types/drivers"
import type { EventInput, FactState, Scalar } from "./validation"

/**
 * The six detailed workflows (Collision, Near Miss, Roadside Inspection, Cargo Incident, Spill or Release, Customer Event) build a PerformanceEventRecord
 * draft. This adapter turns that draft into the server's EventInput so the SAME wizards can save to PostgreSQL instead of the browser:
 * structured facts are re-keyed by registry field, units are kept, child collections are keyed by collection id, canonical vehicle links become
 * the event's vehicle relationship columns, and a requested follow-up becomes a follow-up action. Nothing is dropped silently: a fact the registry does
 * not define is sent as-is and the server names it in its refusal.
 */

export type WizardPayload = Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">

const SOURCE_LABEL: Record<string, string> = {
  DRIVER_REPORT: "Driver Report", COMPANY_STAFF: "Company Staff", ROADSIDE_INSPECTION: "Roadside Inspection", ELD_TELEMATICS: "ELD / Telematics", CAMERA: "Camera",
  CUSTOMER: "Customer", CITATION: "Citation", MAINTENANCE: "Maintenance", TRAINING: "Training", OTHER: "Other",
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEVERITY = new Set(["Low", "Moderate", "High", "Critical", "Not Applicable"])

export type AdaptContext = { driverRelationshipId: string; timeZone: string }
export type AdaptedEvent = { input: EventInput; followUp: { title: string; dueDate: string | null } | null }

export function wizardPayloadToEventInput(payload: WizardPayload, context: AdaptContext): AdaptedEvent {
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[payload.eventType]
  if (!definition) throw new Error(`Unsupported category: ${payload.eventType}`)
  const byDataPoint = new Map(definition.fields.map((f) => [f.dataPointId, f]))
  const facts: Record<string, Scalar> = {}
  const factStates: Record<string, FactState> = {}
  const factUnits: Record<string, string> = {}
  for (const fact of (payload.structuredEventFacts ?? []) as StructuredEventFact[]) {
    const key = byDataPoint.get(fact.dataPointId)?.key ?? fact.dataPointId
    if (fact.value === null || fact.value === undefined || fact.value === "") continue
    facts[key] = fact.value
    if (fact.unit) factUnits[key] = fact.unit
  }
  const links = (payload.canonicalLinks ?? []) as CanonicalEntityLink[]
  const vehicle = [payload.vehicleId, ...links.filter((l) => l.entityType === "Vehicle").map((l) => l.recordId)].find((id): id is string => typeof id === "string" && UUID.test(id)) ?? null
  const trailer = links.filter((l) => l.entityType === "Trailer").map((l) => l.recordId).find((id) => UUID.test(id)) ?? null

  const sourceFact = typeof facts.sourceType === "string" ? SOURCE_LABEL[facts.sourceType] : undefined
  const sourceType = sourceFact && (definition.sources as readonly string[]).includes(sourceFact) ? sourceFact : definition.sources[0]
  const sourceRecord = typeof facts.sourceRecordId === "string" && facts.sourceRecordId.trim() ? facts.sourceRecordId.trim() : null
  const zone = typeof facts.eventTimeZone === "string" && facts.eventTimeZone ? facts.eventTimeZone : context.timeZone
  const country = payload.country && /^[A-Za-z]{2}$/.test(payload.country) ? payload.country.toUpperCase() : null
  const region = payload.stateProvince && /^[A-Za-z]{2,3}$/.test(payload.stateProvince) ? payload.stateProvince.toUpperCase() : null
  const collections: Record<string, unknown> = {}
  for (const c of payload.childCollections ?? []) collections[c.collectionId] = c

  const input: EventInput = {
    category: payload.eventType,
    title: (payload.summary || `${payload.eventType} event`).slice(0, 300),
    narrative: payload.description || null,
    recordState: "RECORDED",
    occurrence: { date: payload.eventDate, time: payload.eventTime || null, timeZone: zone, approximate: payload.occurrencePrecision === "APPROXIMATE" },
    reportedDate: payload.reportedDate || null,
    sourceType,
    sourceReference: sourceRecord,
    ingestionOrigin: "MANUAL_ENTRY",
    driverRelationshipId: context.driverRelationshipId,
    vehicleRelationshipId: vehicle,
    trailerRelationshipId: trailer,
    location: { text: payload.location || null, city: payload.city || null, stateProvince: payload.stateProvince || null, country, jurisdictionCode: country && region ? `${country}-${region}` : null },
    observedSeverity: SEVERITY.has(payload.severity) ? payload.severity : "Unknown",
    facts,
    factStates,
    factUnits,
    childCollections: collections,
  }
  const followUp = payload.followUpActionRequired ? { title: (payload.followUpActionSummary || "Follow-up required").slice(0, 300), dueDate: payload.followUpDueDate || null } : null
  return { input, followUp }
}
