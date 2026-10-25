import { isValidDateOnly, todayInZone } from "@/lib/dates/date-only"
import { isValidTimeZone, zonedLocalToInstant } from "@/lib/dates/zoned"
import {
  DRIVER_PERFORMANCE_CATEGORY_BY_VALUE,
  PERFORMANCE_CATEGORY_OWNERSHIP,
  PERFORMANCE_EVENT_SCHEMA_VERSION,
  resolvePerformanceApplicability,
  type PerformanceCategoryDefinition,
  type PerformanceFieldDefinition,
} from "@/lib/driver-performance-schema"
import type { EventType } from "@/types/drivers"
import { diffChildCollections, validateChildCollections } from "./child-collections"
import { DriverEventValidationError } from "./errors"

/**
 * Server-side validation of a Driver Event. It is driven by the SAME category registry the browser workflows use, so a field defined once is validated
 * everywhere; the browser is never trusted. Unknown keys are rejected, a value outside a controlled list is rejected, a date-only occurrence never gets an
 * invented instant, and "unknown / not applicable / not collected" are stated explicitly rather than inferred from a blank.
 */

export const SEVERITIES = ["Low", "Moderate", "High", "Critical", "Not Applicable", "Unknown"] as const
export const FACT_STATES = ["PROVIDED", "UNKNOWN", "NOT_APPLICABLE", "NOT_COLLECTED"] as const
export type FactState = (typeof FACT_STATES)[number]
export const RECORD_SCHEMA = "driver-event-record/1"
export const SOURCE_TYPES = ["Driver Report", "Company Staff", "Customer", "Roadside Inspection", "Citation", "Camera", "ELD / Telematics", "Maintenance", "Police / Authority", "Insurer", "Other"] as const
export const INGESTION_ORIGINS = ["MANUAL_ENTRY", "DOCUMENT_OCR", "API_INTEGRATION", "SYSTEM_DERIVED", "TELEMATICS_INGESTION", "ELD_INGESTION"] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_TEXT = 2000
const MAX_AREA = 10000
const MAX_CHILD_BYTES = 200_000

export type Scalar = string | number | boolean | null
export type EventInput = {
  category: string
  title: string
  narrative?: string | null
  recordState?: "DRAFT" | "RECORDED"
  subtype?: string | null
  occurrence?: { date?: string | null; time?: string | null; timeZone?: string | null; approximate?: boolean }
  reportedAt?: string | null
  /** When only the calendar day of the report is known. Ignored if reportedAt is given. */
  reportedDate?: string | null
  reporterLabel?: string | null
  sourceType: string
  sourceReference?: string | null
  ingestionOrigin?: string
  driverRelationshipId?: string | null
  vehicleRelationshipId?: string | null
  trailerRelationshipId?: string | null
  tripReference?: string | null
  loadReference?: string | null
  shipmentReference?: string | null
  customerReference?: string | null
  location?: { text?: string | null; city?: string | null; stateProvince?: string | null; country?: string | null; jurisdictionCode?: string | null; latitude?: number | null; longitude?: number | null }
  observedSeverity?: string
  potentialSeverity?: string | null
  facts?: Record<string, Scalar>
  factStates?: Record<string, FactState>
  /** Explicit unit for a measurement whose field offers several (for example km/h or mph). A bare number without its unit is refused. */
  factUnits?: Record<string, string>
  /** Existing rich-workflow child collections, keyed by collection id. */
  childCollections?: Record<string, unknown>
}

export type PreparedEvent = {
  category: string
  categoryCode: string
  subtype: string | null
  schemaVersion: string
  title: string
  narrative: string | null
  recordState: "DRAFT" | "RECORDED"
  occurrencePrecision: "EXACT_DATETIME" | "DATE_ONLY" | "APPROXIMATE" | "UNKNOWN"
  occurredAt: string | null
  occurredTimeZone: string | null
  occurredLocalDate: string | null
  occurredLocalTime: string | null
  reportedAt: string | null
  reportedLocalDate: string | null
  reporterLabel: string | null
  sourceType: string
  sourceReference: string | null
  ingestionOrigin: string
  driverRelationshipId: string | null
  vehicleRelationshipId: string | null
  trailerRelationshipId: string | null
  tripReference: string | null
  loadReference: string | null
  shipmentReference: string | null
  customerReference: string | null
  locationText: string | null
  city: string | null
  stateProvince: string | null
  country: string | null
  jurisdictionCode: string | null
  latitude: number | null
  longitude: number | null
  observedSeverity: string
  potentialSeverity: string | null
  record: { schema: typeof RECORD_SCHEMA; registrySchemaVersion: string; facts: Record<string, Scalar>; factStates: Record<string, FactState>; factUnits: Record<string, string>; childCollections: Record<string, unknown> }
  quality: { requiredTotal: number; requiredMissing: number; missingKeys: string[]; flags: string[] }
}

type Issue = { field: string; message: string }

const str = (value: unknown, field: string, max: number, issues: Issue[], required = false): string | null => {
  if (value === undefined || value === null || value === "") {
    if (required) issues.push({ field, message: `${field} is required.` })
    return null
  }
  if (typeof value !== "string") { issues.push({ field, message: `${field} must be text.` }); return null }
  const v = value.trim()
  if (!v) { if (required) issues.push({ field, message: `${field} is required.` }); return null }
  if (v.length > max) { issues.push({ field, message: `${field} is too long (maximum ${max} characters).` }); return null }
  return v
}

const uuidOrNull = (value: unknown, field: string, issues: Issue[]): string | null => {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string" || !UUID.test(value.trim())) { issues.push({ field, message: `${field} must be a record id.` }); return null }
  return value.trim()
}

export function recordableCategory(value: unknown): PerformanceCategoryDefinition {
  if (typeof value !== "string") throw new DriverEventValidationError("category", "category is required.")
  const definition = (DRIVER_PERFORMANCE_CATEGORY_BY_VALUE as Record<string, PerformanceCategoryDefinition | undefined>)[value]
  if (!definition) throw new DriverEventValidationError("category", "Unknown event category.")
  if (PERFORMANCE_CATEGORY_OWNERSHIP[value as EventType] !== "RECORDABLE_EVENT") {
    throw new DriverEventValidationError("category", `${definition.label} is not recorded as a new event (it is read-only history, a separate company action or an authoritative linked record).`)
  }
  return definition
}

export function fieldIsVisible(field: PerformanceFieldDefinition, facts: Record<string, unknown>): boolean {
  if (field.visibleWhen) {
    const ok = Object.entries(field.visibleWhen).every(([key, values]) => values.includes(String(facts[key] ?? "")))
    if (!ok) return false
  }
  const state = resolvePerformanceApplicability(field.applicability, facts)
  return state !== "HIDDEN" && state !== "NOT_APPLICABLE"
}

function validateFact(field: PerformanceFieldDefinition, value: unknown, issues: Issue[]): Scalar {
  const name = `facts.${field.key}`
  switch (field.kind) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) { issues.push({ field: name, message: `${field.label} must be a number.` }); return null }
      const min = field.validation?.min ?? 0
      if (value < min) issues.push({ field: name, message: `${field.label} cannot be less than ${min}.` })
      if (field.validation?.max !== undefined && value > field.validation.max) issues.push({ field: name, message: `${field.label} cannot exceed ${field.validation.max}.` })
      return value
    }
    case "boolean":
      if (typeof value !== "boolean") { issues.push({ field: name, message: `${field.label} must be yes or no.` }); return null }
      return value
    case "date":
      if (typeof value !== "string" || !isValidDateOnly(value)) { issues.push({ field: name, message: `${field.label} must be a valid date (YYYY-MM-DD).` }); return null }
      return value
    case "time":
      if (typeof value !== "string" || !TIME.test(value)) { issues.push({ field: name, message: `${field.label} must be a time (HH:MM).` }); return null }
      return value
    case "select": {
      if (typeof value !== "string") { issues.push({ field: name, message: `${field.label} must be one of the listed values.` }); return null }
      // Options that depend on another answer (optionsWhen) are validated by the category workflow's own provider; here the value must still be a controlled token.
      if (field.options && !field.optionsWhen && !field.options.some((o) => o.value === value)) { issues.push({ field: name, message: `${field.label} has a value that is not allowed.` }); return null }
      if (value.length > 120) { issues.push({ field: name, message: `${field.label} is too long.` }); return null }
      return value
    }
    default: {
      if (typeof value !== "string") { issues.push({ field: name, message: `${field.label} must be text.` }); return null }
      const max = field.kind === "textarea" ? MAX_AREA : field.validation?.maxLength ?? MAX_TEXT
      if (value.length > max) { issues.push({ field: name, message: `${field.label} is too long (maximum ${max} characters).` }); return null }
      if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(value)) issues.push({ field: name, message: `${field.label} is not in the expected format.` })
      return value.trim()
    }
  }
}

/** Validates and normalises an event. `now` is injected so tests are deterministic. Throws one DriverEventValidationError carrying every issue. */
export function prepareEvent(input: EventInput, now: Date = new Date()): PreparedEvent {
  if (!input || typeof input !== "object") throw new DriverEventValidationError("body", "An event is required.")
  const definition = recordableCategory(input.category)
  const issues: Issue[] = []
  const recordState = input.recordState === "DRAFT" ? "DRAFT" : "RECORDED"
  const title = str(input.title, "title", 300, issues, true)
  const narrative = str(input.narrative, "narrative", MAX_AREA * 2, issues)
  const subtype = str(input.subtype, "subtype", 120, issues)

  // ---- occurrence ----
  const occ = input.occurrence ?? {}
  const date = typeof occ.date === "string" && occ.date ? occ.date : null
  const time = typeof occ.time === "string" && occ.time ? occ.time : null
  const timeZone = typeof occ.timeZone === "string" && occ.timeZone ? occ.timeZone : null
  let precision: PreparedEvent["occurrencePrecision"] = "UNKNOWN"
  let occurredAt: string | null = null
  if (date && !isValidDateOnly(date)) issues.push({ field: "occurrence.date", message: "The occurrence date is not a valid date." })
  else if (date) {
    if (time && !TIME.test(time)) issues.push({ field: "occurrence.time", message: "The occurrence time must be HH:MM." })
    else if (time) {
      if (!timeZone || !isValidTimeZone(timeZone)) issues.push({ field: "occurrence.timeZone", message: "An exact occurrence needs the time zone it was observed in." })
      else {
        const r = zonedLocalToInstant(`${date}T${time}`, timeZone)
        if (!r.ok) issues.push({ field: "occurrence.time", message: r.reason === "gap" ? "That local time does not exist in the zone (clocks moved forward)." : "The occurrence time is not valid." })
        else {
          occurredAt = r.instant
          precision = occ.approximate ? "APPROXIMATE" : "EXACT_DATETIME"
          if (Date.parse(r.instant) > now.getTime() + 5 * 60_000) issues.push({ field: "occurrence", message: "The occurrence cannot be in the future." })
        }
      }
    } else {
      precision = occ.approximate ? "APPROXIMATE" : "DATE_ONLY"
      if (timeZone && !isValidTimeZone(timeZone)) issues.push({ field: "occurrence.timeZone", message: "The time zone is not valid." })
      if (date > todayInZone(timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC", new Date(now.getTime() + 24 * 3600_000))) issues.push({ field: "occurrence.date", message: "The occurrence cannot be in the future." })
    }
  } else if (recordState === "RECORDED") issues.push({ field: "occurrence.date", message: "The date the event occurred is required." })
  // a date-only / approximate-without-time occurrence has NO instant; the DB constraint enforces the same

  let reportedAt: string | null = null
  let reportedLocalDate: string | null = null
  if (input.reportedAt) {
    const ms = typeof input.reportedAt === "string" ? Date.parse(input.reportedAt) : NaN
    if (!Number.isFinite(ms)) issues.push({ field: "reportedAt", message: "The reported time is not valid." })
    else {
      reportedAt = new Date(ms).toISOString()
      reportedLocalDate = reportedAt.slice(0, 10)
      if (ms > now.getTime() + 5 * 60_000) issues.push({ field: "reportedAt", message: "The reported time cannot be in the future." })
      if (occurredAt && ms < Date.parse(occurredAt)) issues.push({ field: "reportedAt", message: "The event cannot be reported before it occurred." })
    }
  } else if (input.reportedDate) {
    if (!isValidDateOnly(input.reportedDate)) issues.push({ field: "reportedDate", message: "The reported date is not a valid date." })
    else {
      reportedLocalDate = input.reportedDate
      if (input.reportedDate > todayInZone("UTC", new Date(now.getTime() + 24 * 3600_000))) issues.push({ field: "reportedDate", message: "The reported date cannot be in the future." })
      if (date && input.reportedDate < date) issues.push({ field: "reportedDate", message: "The event cannot be reported before it occurred." })
    }
  }

  // ---- source ----
  const sourceType = str(input.sourceType, "sourceType", 80, issues, true)
  if (sourceType && !(definition.sources as readonly string[]).includes(sourceType)) {
    issues.push({ field: "sourceType", message: "That source is not allowed for this category." })
  }
  const origin = input.ingestionOrigin ?? "MANUAL_ENTRY"
  if (!(INGESTION_ORIGINS as readonly string[]).includes(origin)) issues.push({ field: "ingestionOrigin", message: "Unknown ingestion origin." })

  // ---- location ----
  const loc = input.location ?? {}
  const country = str(loc.country, "location.country", 2, issues)
  if (country && !/^[A-Z]{2}$/.test(country)) issues.push({ field: "location.country", message: "Country must be a two-letter code." })
  const jurisdictionCode = str(loc.jurisdictionCode, "location.jurisdictionCode", 6, issues)
  if (jurisdictionCode && !/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(jurisdictionCode)) issues.push({ field: "location.jurisdictionCode", message: "Jurisdiction must look like CA-ON or US-TX." })
  const lat = loc.latitude ?? null
  const lon = loc.longitude ?? null
  if ((lat === null) !== (lon === null)) issues.push({ field: "location.latitude", message: "Latitude and longitude are entered together." })
  else if (lat !== null && lon !== null && (typeof lat !== "number" || typeof lon !== "number" || lat < -90 || lat > 90 || lon < -180 || lon > 180)) issues.push({ field: "location.latitude", message: "The coordinates are out of range." })

  // ---- severity ----
  const severity = input.observedSeverity ?? "Not Applicable"
  if (!(SEVERITIES as readonly string[]).includes(severity)) issues.push({ field: "observedSeverity", message: "Unknown severity." })
  const potential = input.potentialSeverity ?? null
  if (potential !== null && !(SEVERITIES as readonly string[]).includes(potential)) issues.push({ field: "potentialSeverity", message: "Unknown potential severity." })

  // ---- category facts ----
  const byKey = new Map(definition.fields.map((f) => [f.key, f]))
  const rawFacts = input.facts && typeof input.facts === "object" ? input.facts : {}
  const rawStates = input.factStates && typeof input.factStates === "object" ? input.factStates : {}
  const facts: Record<string, Scalar> = {}
  const factStates: Record<string, FactState> = {}
  for (const key of Object.keys(rawFacts)) if (!byKey.has(key)) issues.push({ field: `facts.${key}`, message: `"${key}" is not a field of ${definition.label}.` })
  for (const key of Object.keys(rawStates)) if (!byKey.has(key)) issues.push({ field: `factStates.${key}`, message: `"${key}" is not a field of ${definition.label}.` })
  const answers: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(rawFacts)) if (v !== null && v !== undefined && v !== "") answers[key] = v
  for (const field of definition.fields) {
    if (!(field.key in rawFacts) && !(field.key in rawStates)) continue
    const state = rawStates[field.key]
    if (state !== undefined && !(FACT_STATES as readonly string[]).includes(state)) { issues.push({ field: `factStates.${field.key}`, message: "Unknown fact state." }); continue }
    const value = rawFacts[field.key]
    const present = value !== null && value !== undefined && value !== ""
    if (field.hiddenInCreation && present) { issues.push({ field: `facts.${field.key}`, message: `${field.label} is legacy-only and cannot be recorded on a new event.` }); continue }
    if (present && !fieldIsVisible(field, answers)) { issues.push({ field: `facts.${field.key}`, message: `${field.label} does not apply to the answers given.` }); continue }
    if (present) {
      if (state && state !== "PROVIDED") { issues.push({ field: `factStates.${field.key}`, message: `${field.label} has a value, so it cannot be marked ${state.toLowerCase().replace(/_/g, " ")}.` }); continue }
      facts[field.key] = validateFact(field, value, issues)
      factStates[field.key] = "PROVIDED"
    } else if (state && state !== "PROVIDED") factStates[field.key] = state
  }

  // units: a measurement whose field offers several units must say which one
  const rawUnits = input.factUnits && typeof input.factUnits === "object" ? input.factUnits : {}
  const factUnits: Record<string, string> = {}
  for (const key of Object.keys(rawUnits)) if (!byKey.has(key)) issues.push({ field: `factUnits.${key}`, message: `"${key}" is not a field of ${definition.label}.` })
  for (const field of definition.fields) {
    if (!field.unitOptions?.length) {
      // A fixed-unit field may restate its own unit (the detailed workflows do); any other unit is refused.
      if (field.key in rawUnits && String(rawUnits[field.key]).toLowerCase() !== String(field.unit ?? "").toLowerCase()) issues.push({ field: `factUnits.${field.key}`, message: `${field.label} has a fixed unit${field.unit ? ` (${field.unit})` : ""}.` })
      continue
    }
    const unit = rawUnits[field.key]
    if (field.key in facts) {
      if (typeof unit !== "string" || !field.unitOptions.includes(unit)) issues.push({ field: `factUnits.${field.key}`, message: `${field.label} needs its unit (${field.unitOptions.join(", ")}).` })
      else factUnits[field.key] = unit
    } else if (unit !== undefined) issues.push({ field: `factUnits.${field.key}`, message: `${field.label} has a unit but no value.` })
  }

  // required / conditionally required fields
  const missingKeys: string[] = []
  let requiredTotal = 0
  for (const field of definition.fields) {
    if (field.hiddenInCreation) continue
    if (!fieldIsVisible(field, answers)) continue
    const applicability = resolvePerformanceApplicability(field.applicability, answers)
    const required = field.required === true || applicability === "REQUIRED"
    if (!required) continue
    requiredTotal += 1
    const s = factStates[field.key]
    const answered = field.key in facts || s === "UNKNOWN" || s === "NOT_APPLICABLE"
    if (!answered) missingKeys.push(field.key)
  }
  if (recordState === "RECORDED" && missingKeys.length) {
    for (const key of missingKeys) issues.push({ field: `facts.${key}`, message: `${byKey.get(key)?.label ?? key} is required.` })
  }

  // ---- children ----
  const children = input.childCollections ?? {}
  if (typeof children !== "object" || Array.isArray(children)) issues.push({ field: "childCollections", message: "Child collections must be an object." })
  else if (JSON.stringify(children).length > MAX_CHILD_BYTES) issues.push({ field: "childCollections", message: "Child collections are too large." })
  else if (recordState === "RECORDED") issues.push(...validateChildCollections(definition.code, facts, children as Record<string, unknown>))

  // ---- canonical links ----
  const driverRelationshipId = uuidOrNull(input.driverRelationshipId, "driverRelationshipId", issues)
  const vehicleRelationshipId = uuidOrNull(input.vehicleRelationshipId, "vehicleRelationshipId", issues)
  const trailerRelationshipId = uuidOrNull(input.trailerRelationshipId, "trailerRelationshipId", issues)

  if (issues.length) throw new DriverEventValidationError(issues[0].field, issues[0].message, issues)

  const flags: string[] = []
  if (precision === "DATE_ONLY") flags.push("OCCURRENCE_DATE_ONLY")
  if (precision === "APPROXIMATE") flags.push("OCCURRENCE_APPROXIMATE")
  if (precision === "UNKNOWN") flags.push("OCCURRENCE_UNKNOWN")
  if (!driverRelationshipId) flags.push("NO_DRIVER_LINK")
  if (!vehicleRelationshipId) flags.push("NO_VEHICLE_LINK")
  if (!jurisdictionCode) flags.push("NO_JURISDICTION")
  if (missingKeys.length) flags.push("REQUIRED_FIELDS_MISSING")
  if (origin === "TELEMATICS_INGESTION" || origin === "ELD_INGESTION") flags.push("DEVICE_SOURCED")

  return {
    category: definition.value,
    categoryCode: definition.code,
    subtype,
    schemaVersion: PERFORMANCE_EVENT_SCHEMA_VERSION,
    title: title!,
    narrative,
    recordState,
    occurrencePrecision: precision,
    occurredAt,
    occurredTimeZone: timeZone,
    occurredLocalDate: date,
    occurredLocalTime: precision === "EXACT_DATETIME" || (precision === "APPROXIMATE" && occurredAt) ? time : null,
    reportedAt,
    reportedLocalDate,
    reporterLabel: str(input.reporterLabel, "reporterLabel", 200, []),
    sourceType: sourceType!,
    sourceReference: str(input.sourceReference, "sourceReference", 200, []),
    ingestionOrigin: origin,
    driverRelationshipId,
    vehicleRelationshipId,
    trailerRelationshipId,
    tripReference: str(input.tripReference, "tripReference", 200, []),
    loadReference: str(input.loadReference, "loadReference", 200, []),
    shipmentReference: str(input.shipmentReference, "shipmentReference", 200, []),
    customerReference: str(input.customerReference, "customerReference", 200, []),
    locationText: str(loc.text, "location.text", 500, []),
    city: str(loc.city, "location.city", 120, []),
    stateProvince: str(loc.stateProvince, "location.stateProvince", 120, []),
    country,
    jurisdictionCode,
    latitude: lat,
    longitude: lon,
    observedSeverity: severity,
    potentialSeverity: potential,
    record: { schema: RECORD_SCHEMA, registrySchemaVersion: PERFORMANCE_EVENT_SCHEMA_VERSION, facts, factStates, factUnits, childCollections: children as Record<string, unknown> },
    quality: { requiredTotal, requiredMissing: missingKeys.length, missingKeys, flags },
  }
}

/** Header + record differences between two prepared events, for the immutable history ("what changed"). */
export function diffPrepared(before: PreparedEvent, after: PreparedEvent): { field: string; before: unknown; after: unknown }[] {
  const out: { field: string; before: unknown; after: unknown }[] = []
  const flat = (p: PreparedEvent) => {
    const { record, quality: _q, ...header } = p
    const o: Record<string, unknown> = { ...header }
    for (const [k, v] of Object.entries(record.facts)) o[`facts.${k}`] = v
    for (const [k, v] of Object.entries(record.factStates)) if (v !== "PROVIDED") o[`factStates.${k}`] = v
    for (const [k, v] of Object.entries(record.factUnits ?? {})) o[`factUnits.${k}`] = v
    return o
  }
  const a = flat(before), b = flat(after)
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) out.push({ field: key, before: a[key] ?? null, after: b[key] ?? null })
  for (const c of diffChildCollections(before.record.childCollections, after.record.childCollections)) out.push({ field: c.field, before: { change: c.change, ...(c.before !== null ? { facts: c.before } : {}) }, after: { change: c.change, ...(c.after !== null ? { facts: c.after } : {}) } })
  return out
}
