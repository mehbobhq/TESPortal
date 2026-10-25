/**
 * Driver Event analytical fact, CONTRACT v1. Pure derivation: the same inputs always give the same fact, and every rule below is part of the contract.
 *
 *   - NULL means "not collected / not established". It is NEVER silently zero. A zero appears only when someone recorded NONE_CONFIRMED.
 *   - Money is in minor units of ONE currency. A mix of currencies yields NULL amounts and a MIXED_CURRENCY flag rather than an invented conversion.
 *   - An occurrence with only a date has a local date and NO instant; hours-based rates must use events whose precision is EXACT_DATETIME.
 *   - Exposure (distance, driving hours) is NOT stored on the event. exposure_basis names the keys to join to trip / ELD facts in the wider analytics layer.
 *   - Duplicates (DUPLICATE_OF) are excluded by the driver_event_facts_v1 view; costs attached to an occurrence are counted once (database-enforced).
 */
export const BI_CONTRACT_VERSION = "driver-event-fact/1"

export type FactEvent = {
  id: string
  organization_id: string
  category: string
  category_code: string
  schema_version: string
  status: string
  record_state: string
  current_version: number
  occurrence_precision: string
  occurred_at: string | null
  occurred_time_zone: string | null
  occurred_local_date: string | null
  reported_at: string | null
  observed_severity: string
  potential_severity: string | null
  source_type: string
  ingestion_origin: string
  driver_relationship_id: string | null
  driver_person_id: string | null
  vehicle_id: string | null
  trailer_vehicle_id: string | null
  jurisdiction_code: string | null
  country: string | null
  state_province: string | null
  load_reference: string | null
  shipment_reference: string | null
  customer_reference: string | null
  verification_state: string
  closed_at: string | null
  created_at: string
  record: { facts?: Record<string, string | number | boolean | null> }
  data_quality: { requiredTotal?: number; requiredMissing?: number; flags?: string[] }
}
export type FactEvidence = { link_status: string; verification_state: string; lifecycle_state: string | null }
export type FactConsequence = {
  kind: string; measurement_state: string; quantity: string | number | null; unit: string | null; amount_minor: string | number | null; currency: string | null
  started_at: string | null; ended_at: string | null; state: string
}
export type FactAction = { required: boolean; status: string; due_date: string | null }
export type FactRestriction = { state: string; mandatory: boolean }

const num = (v: string | number | null) => (v === null || v === undefined ? null : Number(v))
const OPEN_ACTION = new Set(["OPEN", "IN_PROGRESS"])

function minutesOf(c: FactConsequence): number | null {
  if (c.measurement_state !== "MEASURED") return null
  if (c.quantity !== null && c.quantity !== undefined) {
    const q = Number(c.quantity)
    const u = (c.unit ?? "").toLowerCase()
    if (u === "minutes" || u === "minute" || u === "min") return q
    if (u === "hours" || u === "hour" || u === "h") return q * 60
    if (u === "days" || u === "day") return q * 1440
    return null
  }
  if (c.started_at && c.ended_at) return (Date.parse(c.ended_at) - Date.parse(c.started_at)) / 60000
  return null
}

/** Sum of a duration kind: null if nothing was recorded or nothing could be measured, 0 only when NONE_CONFIRMED is the sole statement. */
function durationFor(rows: FactConsequence[]): number | null {
  if (!rows.length) return null
  const measured = rows.map(minutesOf).filter((v): v is number => v !== null)
  if (measured.length) return Math.round(measured.reduce((a, b) => a + b, 0) * 100) / 100
  return rows.every((r) => r.measurement_state === "NONE_CONFIRMED") ? 0 : null
}

function moneyFor(rows: FactConsequence[]): { amount: number | null; currencies: string[] } {
  if (!rows.length) return { amount: null, currencies: [] }
  const measured = rows.filter((r) => r.measurement_state === "MEASURED" && r.amount_minor !== null)
  const currencies = [...new Set(measured.map((r) => r.currency!).filter(Boolean))]
  if (measured.length) return { amount: measured.reduce((a, r) => a + Number(r.amount_minor), 0), currencies }
  return { amount: rows.every((r) => r.measurement_state === "NONE_CONFIRMED") ? 0 : null, currencies }
}

function countFor(rows: FactConsequence[], unit: string): number | null {
  if (!rows.length) return null
  const measured = rows.filter((r) => r.measurement_state === "MEASURED" && (r.unit ?? "").toLowerCase() === unit && r.quantity !== null)
  if (measured.length) return measured.reduce((a, r) => a + Number(r.quantity), 0)
  return rows.every((r) => r.measurement_state === "NONE_CONFIRMED") ? 0 : null
}

const ynu = (v: unknown): "YES" | "NO" | "UNKNOWN" | null => (v === "YES" || v === "NO" || v === "UNKNOWN" ? v : null)

export function deriveReliability(e: Pick<FactEvent, "source_type" | "ingestion_origin">, evidence: { verified: number; stored: number }): "AUTHORITATIVE" | "CORROBORATED" | "SELF_REPORTED" | "DEVICE_UNVERIFIED" | "UNKNOWN" {
  if (["Roadside Inspection", "Citation", "Police / Authority"].includes(e.source_type) && evidence.verified > 0) return "AUTHORITATIVE"
  if (evidence.verified > 0) return "CORROBORATED"
  if (e.ingestion_origin === "TELEMATICS_INGESTION" || e.ingestion_origin === "ELD_INGESTION") return "DEVICE_UNVERIFIED"
  if (["Driver Report", "Company Staff", "Customer"].includes(e.source_type)) return "SELF_REPORTED"
  return "UNKNOWN"
}

export type DerivedFact = ReturnType<typeof deriveFact>

export function deriveFact(input: {
  event: FactEvent
  evidence: FactEvidence[]
  consequences: FactConsequence[]
  actions: FactAction[]
  restrictions: FactRestriction[]
  corrections: number
}) {
  const { event: e } = input
  const flags = new Set<string>(e.data_quality.flags ?? [])
  const active = input.evidence.filter((l) => l.link_status === "active")
  const stored = active.filter((l) => l.lifecycle_state === "stored").length
  const verified = active.filter((l) => l.verification_state === "VERIFIED").length
  if (!active.length) flags.add("NO_EVIDENCE")
  else if (!verified) flags.add("EVIDENCE_UNVERIFIED")

  const rows = input.consequences.filter((c) => c.state === "ACTIVE")
  const of = (...kinds: string[]) => rows.filter((c) => kinds.includes(c.kind))
  const est = moneyFor(of("COST_ESTIMATED")), act = moneyFor(of("COST_ACTUAL")), claim = moneyFor(of("CLAIM")), rec = moneyFor(of("RECOVERY"))
  const currencies = [...new Set([...est.currencies, ...act.currencies, ...claim.currencies, ...rec.currencies])]
  const mixed = currencies.length > 1
  if (mixed) flags.add("MIXED_CURRENCY")
  const money = (v: number | null) => (mixed ? null : v)
  const net = !mixed && act.amount !== null && rec.amount !== null ? act.amount - rec.amount : null
  if (act.amount !== null && rec.amount === null && of("RECOVERY").length === 0) flags.add("RECOVERY_NOT_COLLECTED")

  const delay = durationFor(of("OPERATIONAL_DELAY"))
  const downtime = durationFor(of("ASSET_DOWNTIME"))
  const facts = e.record.facts ?? {}

  const lagMinutes = e.occurred_at && e.reported_at ? Math.round((Date.parse(e.reported_at) - Date.parse(e.occurred_at)) / 60000) : null
  if (lagMinutes !== null && lagMinutes < 0) flags.add("REPORTED_BEFORE_OCCURRED")

  const actionsOpen = input.actions.filter((a) => OPEN_ACTION.has(a.status))
  const requiredOpen = actionsOpen.filter((a) => a.required)
  const due = actionsOpen.map((a) => a.due_date).filter((d): d is string => !!d).sort()[0] ?? null
  const restrictionsActive = input.restrictions.filter((r) => r.state === "ACTIVE").length
  const resolution = e.status === "Closed" ? "CLOSED" : e.record_state === "DRAFT" ? "DRAFT" : restrictionsActive > 0 ? "RESTRICTED" : requiredOpen.length > 0 ? "AWAITING_ACTIONS" : "OPEN"

  const total = e.data_quality.requiredTotal ?? null
  const missing = e.data_quality.requiredMissing ?? null
  const score = total && total > 0 && missing !== null ? Math.round((1 - missing / total) * 1000) / 1000 : null

  return {
    event_id: e.id,
    organization_id: e.organization_id,
    record_version: e.current_version,
    contract_version: BI_CONTRACT_VERSION,
    category: e.category,
    category_code: e.category_code,
    schema_version: e.schema_version,
    status: e.status,
    record_state: e.record_state,
    occurrence_precision: e.occurrence_precision,
    occurred_at: e.occurred_at,
    occurred_time_zone: e.occurred_time_zone,
    occurred_local_date: e.occurred_local_date,
    reported_at: e.reported_at,
    reporting_lag_minutes: lagMinutes,
    severity_observed: e.observed_severity,
    severity_potential: e.potential_severity,
    source_type: e.source_type,
    ingestion_origin: e.ingestion_origin,
    source_reliability: deriveReliability(e, { verified, stored }),
    driver_relationship_id: e.driver_relationship_id,
    driver_person_id: e.driver_person_id,
    vehicle_id: e.vehicle_id,
    trailer_vehicle_id: e.trailer_vehicle_id,
    jurisdiction_code: e.jurisdiction_code,
    country: e.country,
    state_province: e.state_province,
    load_reference: e.load_reference,
    shipment_reference: e.shipment_reference,
    customer_reference: e.customer_reference,
    verification_state: e.verification_state,
    evidence_links_active: active.length,
    evidence_stored: stored,
    evidence_verified: verified,
    data_quality_score: score,
    required_fields_total: total,
    required_fields_missing: missing,
    quality_flags: JSON.stringify([...flags].sort()),
    injuries_count: countFor(of("INJURY"), "injuries"),
    fatalities_count: countFor(of("INJURY"), "fatalities"),
    tow_away: ynu(facts.towAway),
    property_damage: ynu(facts.propertyDamageState),
    delay_minutes: delay,
    downtime_minutes: downtime,
    service_interrupted: ynu(facts.serviceInterrupted),
    missed_service: of("MISSED_SERVICE").length ? (of("MISSED_SERVICE").some((c) => c.measurement_state === "MEASURED") ? "YES" : of("MISSED_SERVICE").every((c) => c.measurement_state === "NONE_CONFIRMED") ? "NO" : "UNKNOWN") : null,
    currency: mixed ? null : currencies[0] ?? null,
    cost_estimated_minor: money(est.amount),
    cost_actual_minor: money(act.amount),
    claim_amount_minor: money(claim.amount),
    recovery_amount_minor: money(rec.amount),
    net_impact_minor: net,
    actions_total: input.actions.length,
    actions_open: actionsOpen.length,
    required_actions_open: requiredOpen.length,
    next_action_due: due,
    restrictions_active: restrictionsActive,
    restrictions_released: input.restrictions.filter((r) => r.state === "RELEASED").length,
    resolution_state: resolution,
    closed_at: e.closed_at,
    hours_to_close: e.closed_at ? Math.round(((Date.parse(e.closed_at) - Date.parse(e.created_at)) / 3600000) * 100) / 100 : null,
    recurrence_driver_key: e.driver_relationship_id ? `${e.category_code}|driver:${e.driver_relationship_id}` : null,
    recurrence_vehicle_key: e.vehicle_id ? `${e.category_code}|vehicle:${e.vehicle_id}` : null,
    exposure_basis: JSON.stringify({ join: ["driver_relationship_id", "vehicle_id", "occurred_local_date"], note: "Distance and driving hours are joined from trip/ELD facts; they are not stored on the event." }),
    corrections_count: input.corrections,
  }
}
