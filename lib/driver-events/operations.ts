import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { isValidDateOnly } from "@/lib/dates/date-only"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType } from "@/lib/master-register/types"
import { BI_CONTRACT_VERSION, deriveFact, type FactAction, type FactConsequence, type FactEvent, type FactEvidence, type FactRestriction } from "./bi"
import { DriverEventConflictError, DriverEventNotFoundError, DriverEventStateError, DriverEventValidationError } from "./errors"
import { ACTION_TYPES, CONSEQUENCE_KINDS, EVENT_RELATIONSHIPS, EVENT_STATUSES, EVIDENCE_ROLES, RESTRICTION_KINDS } from "./operations-constants"
import { deriveObligations, type Obligations } from "./obligations"
import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY } from "@/lib/driver-performance-schema"
import { closureEvidenceIssues, referencedEvidenceIds } from "./child-collections"
import { diffPrepared, prepareEvent, type EventInput, type PreparedEvent } from "./validation"

export { ACTION_TYPES, CONSEQUENCE_KINDS, EVENT_RELATIONSHIPS, EVENT_STATUSES, EVIDENCE_ROLES, RESTRICTION_KINDS }
export type EventContext = { client: PoolClient; actor: { id: string; actorType: ActorType }; masterRegister: MasterRegisterRepository }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT_TO_EVENT = new Set(["DUPLICATE_OF", "SAME_OCCURRENCE", "CAUSED_BY", "CAUSES", "FOLLOW_UP_OF", "RELATED"])

const uuid = (value: unknown, field: string) => {
  if (typeof value !== "string" || !UUID.test(value.trim())) throw new DriverEventValidationError(field, `${field} must be a record id.`)
  return value.trim()
}
const text = (value: unknown, field: string, max: number, required = false): string | null => {
  if (value === undefined || value === null || value === "") {
    if (required) throw new DriverEventValidationError(field, `${field} is required.`)
    return null
  }
  if (typeof value !== "string") throw new DriverEventValidationError(field, `${field} must be text.`)
  const v = value.trim()
  if (!v) { if (required) throw new DriverEventValidationError(field, `${field} is required.`); return null }
  if (v.length > max) throw new DriverEventValidationError(field, `${field} is too long (maximum ${max} characters).`)
  return v
}
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new DriverEventValidationError(field, `${field} is not an allowed value.`)
  return value as T
}

/** Maps a database refusal to the canonical error classes. Our own RAISE texts are safe to show; a bare constraint failure is generic. */
function database(error: unknown): never {
  const e = error as { code?: string; message?: string; constraint?: string }
  if (e?.code === "23505") throw new DriverEventConflictError("That record already exists or is already counted elsewhere.")
  if (e?.code === "23514" && !e.constraint) throw new DriverEventStateError(e.message ?? "The change is not allowed in the event's current state.")
  if (e?.code === "23514") throw new DriverEventValidationError("record", "A value is outside what the record allows.")
  if (e?.code === "23503") throw new DriverEventValidationError("record", "A linked record does not exist for this company.")
  throw error
}
async function sql<T extends Record<string, unknown> = Record<string, unknown>>(ctx: EventContext, text_: string, params: unknown[] = []): Promise<T[]> {
  try {
    return (await ctx.client.query(text_, params)).rows as T[]
  } catch (error) {
    return database(error)
  }
}

async function mr(ctx: EventContext, eventType: string, operation: string, eventId: string, organizationId: string, subjects: string[], change?: { field: string; value: string }) {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: { resourceType: "driver_event", resourceId: eventId, companyId: organizationId, subjectReferences: [`organization:${organizationId}`, ...subjects] },
    source: { sourceType: "APPLICATION", component: "driver-events", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: {
      changedFields: [change?.field ?? "record"],
      fieldChanges: [{ field: change?.field ?? "record", after: change ? { kind: "LITERAL", value: change.value } : { kind: "REFERENCE", reference: `driver_event:${eventId}` } }],
    },
    outcome: { result: "SUCCESS" },
  } as never)
}

async function addHistory(ctx: EventContext, eventId: string, organizationId: string, entryType: string, extra: { version?: number; snapshot?: unknown; changes?: unknown[]; reason?: string | null } = {}) {
  await sql(
    ctx,
    `INSERT INTO public.driver_event_history (event_id, organization_id, seq, entry_type, record_version, snapshot, changes, reason, actor_id)
     VALUES ($1, $2, (SELECT coalesce(max(seq), 0) + 1 FROM public.driver_event_history WHERE event_id = $1), $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [eventId, organizationId, entryType, extra.version ?? null, extra.snapshot === undefined ? null : JSON.stringify(extra.snapshot), JSON.stringify(extra.changes ?? []), extra.reason ?? null, ctx.actor.id],
  )
}

type EventRow = FactEvent & { title: string; subtype: string | null; closure_reason: string | null }

async function lockEvent(ctx: EventContext, organizationId: string, eventId: string): Promise<EventRow> {
  const rows = await sql<EventRow>(ctx, `SELECT * FROM public.driver_events WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [eventId, organizationId])
  if (!rows[0]) throw new DriverEventNotFoundError("Event not found.")
  return rows[0]
}

async function requireOrganization(ctx: EventContext, organizationId: string) {
  const rows = await sql<{ ok: boolean }>(ctx, `SELECT tes_security.driver_event_organization_exists($1) AS ok`, [organizationId])
  if (rows[0]?.ok !== true) throw new DriverEventNotFoundError("Company not found.")
}

async function resolveLink(ctx: EventContext, organizationId: string, kind: "driver" | "vehicle", relationshipId: string | null, field: string): Promise<string | null> {
  if (!relationshipId) return null
  const fn = kind === "driver" ? "driver_event_link_driver" : "driver_event_link_vehicle"
  const rows = await sql<{ id: string | null }>(ctx, `SELECT tes_security.${fn}($1, $2) AS id`, [organizationId, relationshipId])
  if (!rows[0]?.id) throw new DriverEventValidationError(field, `That ${kind} is not an active ${kind} record of this company.`)
  return rows[0].id
}

const snapshotOf = (p: PreparedEvent) => ({ ...p, quality: p.quality })

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Analytical fact (contract v1)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export async function refreshFact(ctx: EventContext, organizationId: string, eventId: string) {
  const [event] = await sql<EventRow & { local_date_text: string | null }>(ctx, `SELECT *, to_char(occurred_local_date, 'YYYY-MM-DD') AS local_date_text FROM public.driver_events WHERE id = $1 AND organization_id = $2`, [eventId, organizationId])
  if (!event) throw new DriverEventNotFoundError("Event not found.")
  const evidence = await sql<FactEvidence>(
    ctx,
    `SELECT l.link_status, l.verification_state, tes_security.driver_event_evidence_state(l.organization_id, l.evidence_document_id) AS lifecycle_state FROM public.driver_event_evidence l WHERE l.event_id = $1`,
    [eventId],
  )
  const consequences = await sql<FactConsequence>(ctx, `SELECT kind, measurement_state, confidence, quantity, unit, amount_minor, currency, started_at, ended_at, state FROM public.driver_event_consequences WHERE event_id = $1`, [eventId])
  const actions = await sql<FactAction>(ctx, `SELECT required, status, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM public.driver_event_actions WHERE event_id = $1`, [eventId])
  const restrictions = await sql<FactRestriction>(ctx, `SELECT state, mandatory FROM public.driver_event_restrictions WHERE event_id = $1`, [eventId])
  const [{ n }] = await sql<{ n: string }>(ctx, `SELECT count(*)::text AS n FROM public.driver_event_history WHERE event_id = $1 AND entry_type = 'CORRECTION'`, [eventId])
  const normalized = {
    ...event,
    occurred_at: event.occurred_at ? new Date(event.occurred_at).toISOString() : null,
    reported_at: event.reported_at ? new Date(event.reported_at).toISOString() : null,
    closed_at: event.closed_at ? new Date(event.closed_at).toISOString() : null,
    created_at: new Date(event.created_at).toISOString(),
    occurred_local_date: event.local_date_text,
  } as FactEvent
  const fact = deriveFact({ event: normalized, evidence, consequences, actions, restrictions, corrections: Number(n) })
  const keys = Object.keys(fact) as (keyof typeof fact)[]
  const jsonKeys = new Set(["quality_flags", "exposure_basis", "measurement_profile"])
  const cols = keys.map((k) => `"${k}"`).join(", ")
  const vals = keys.map((k, i) => (jsonKeys.has(k) ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(", ")
  const updates = keys.filter((k) => k !== "event_id" && k !== "record_version").map((k) => `"${k}" = EXCLUDED."${k}"`).join(", ")
  await sql(ctx, `INSERT INTO public.driver_event_bi_facts (${cols}) VALUES (${vals}) ON CONFLICT (event_id, record_version) DO UPDATE SET ${updates}, derived_at = clock_timestamp()`, keys.map((k) => fact[k]))
  return fact
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Obligations: restrictions and required follow-up that the recorded facts oblige
// ---------------------------------------------------------------------------------------------------------------------------------------------------

async function ensureObligations(ctx: EventContext, row: { id: string; organization_id: string; driver_relationship_id: string | null; vehicle_id: string | null; trailer_vehicle_id: string | null }, obligations: Obligations, sourceReference: string | null) {
  for (const r of obligations.restrictions) {
    const existing = await sql(ctx, `SELECT 1 FROM public.driver_event_restrictions WHERE event_id = $1 AND restriction_kind = $2 AND state = 'ACTIVE'`, [row.id, r.restrictionKind])
    if (existing.length) continue
    // a restriction that was already released stays released: a corrected answer does not re-open it, a new order does (issue a new restriction explicitly)
    const released = await sql(ctx, `SELECT 1 FROM public.driver_event_restrictions WHERE event_id = $1 AND restriction_kind = $2 AND state = 'RELEASED'`, [row.id, r.restrictionKind])
    if (released.length) continue
    const driver = r.subjectType === "DRIVER" ? row.driver_relationship_id : null
    const vehicle = r.subjectType === "VEHICLE" ? row.vehicle_id : r.subjectType === "TRAILER" ? row.trailer_vehicle_id : null
    const label = driver || vehicle ? null : `${r.subjectType.toLowerCase()} named in the event (not linked to a canonical record)`
    await sql(
      ctx,
      `INSERT INTO public.driver_event_restrictions (event_id, organization_id, restriction_kind, authority, mandatory, subject_type, subject_driver_relationship_id, subject_vehicle_id, subject_label, source_reference, required_correction, created_by_actor_id)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, $10, $11)`,
      [row.id, row.organization_id, r.restrictionKind, r.authority, r.subjectType, driver, vehicle, label, sourceReference, r.requiredCorrection ?? r.basis, ctx.actor.id],
    )
    await addHistory(ctx, row.id, row.organization_id, "RESTRICTION_ISSUED", { changes: [{ field: "restriction", after: r.restrictionKind, basis: r.basis }] })
  }
  for (const a of obligations.actions) {
    const existing = await sql(ctx, `SELECT 1 FROM public.driver_event_actions WHERE event_id = $1 AND title = $2`, [row.id, a.title])
    if (existing.length) continue
    await sql(
      ctx,
      `INSERT INTO public.driver_event_actions (event_id, organization_id, action_type, title, description, required, owner_label, created_by_actor_id) VALUES ($1, $2, $3, $4, $5, true, 'Unassigned (assign an owner)', $6)`,
      [row.id, row.organization_id, a.actionType, a.title, a.description, ctx.actor.id],
    )
    await addHistory(ctx, row.id, row.organization_id, "ACTION_ADDED", { changes: [{ field: "action", after: a.title, required: true }] })
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------------------------------------------------------------

const INSERT_COLUMNS = [
  "category", "category_code", "subtype", "schema_version", "title", "narrative", "record_state", "occurrence_precision", "occurred_at", "occurred_time_zone", "occurred_local_date", "occurred_local_time",
  "reported_at", "reported_local_date", "reporter_label", "source_type", "source_reference", "ingestion_origin", "driver_relationship_id", "driver_person_id", "vehicle_relationship_id", "vehicle_id",
  "trailer_relationship_id", "trailer_vehicle_id", "trip_reference", "load_reference", "shipment_reference", "customer_reference", "location_text", "city", "state_province", "country", "jurisdiction_code",
  "latitude", "longitude", "observed_severity", "potential_severity", "data_quality", "record",
] as const

function columnValues(p: PreparedEvent, links: { driverPerson: string | null; vehicle: string | null; trailer: string | null }): unknown[] {
  return [
    p.category, p.categoryCode, p.subtype, p.schemaVersion, p.title, p.narrative, p.recordState, p.occurrencePrecision, p.occurredAt, p.occurredTimeZone, p.occurredLocalDate, p.occurredLocalTime,
    p.reportedAt, p.reportedLocalDate, p.reporterLabel, p.sourceType, p.sourceReference, p.ingestionOrigin, p.driverRelationshipId, links.driverPerson, p.vehicleRelationshipId, links.vehicle,
    p.trailerRelationshipId, links.trailer, p.tripReference, p.loadReference, p.shipmentReference, p.customerReference, p.locationText, p.city, p.stateProvince, p.country, p.jurisdictionCode,
    p.latitude, p.longitude, p.observedSeverity, p.potentialSeverity, JSON.stringify(p.quality), JSON.stringify(p.record),
  ]
}

export async function findPossibleDuplicates(ctx: EventContext, organizationId: string, p: Pick<PreparedEvent, "categoryCode" | "occurredAt" | "occurredLocalDate" | "driverRelationshipId" | "vehicleRelationshipId">, excludeEventId?: string) {
  if (!p.occurredLocalDate) return []
  return sql<{ id: string; title: string; status: string; occurred_at: string | null; occurrence_precision: string; basis: string }>(
    ctx,
    `SELECT e.id, e.title, e.status, e.occurred_at, e.occurrence_precision,
            CASE WHEN $4::uuid IS NOT NULL AND e.driver_relationship_id = $4::uuid AND $5::uuid IS NOT NULL AND e.vehicle_relationship_id = $5::uuid THEN 'SAME_DRIVER_AND_VEHICLE'
                 WHEN $4::uuid IS NOT NULL AND e.driver_relationship_id = $4::uuid THEN 'SAME_DRIVER' ELSE 'SAME_VEHICLE' END AS basis
       FROM public.driver_events e
      WHERE e.organization_id = $1 AND e.category_code = $2 AND e.occurred_local_date = $3::date AND ($6::uuid IS NULL OR e.id <> $6::uuid)
        AND (($4::uuid IS NOT NULL AND e.driver_relationship_id = $4::uuid) OR ($5::uuid IS NOT NULL AND e.vehicle_relationship_id = $5::uuid))
        AND ($7::timestamptz IS NULL OR e.occurred_at IS NULL OR abs(extract(epoch FROM (e.occurred_at - $7::timestamptz))) <= 7200)
        AND NOT EXISTS (SELECT 1 FROM public.driver_event_relationships r WHERE r.from_event_id = e.id AND r.relationship_type = 'DUPLICATE_OF' AND r.status = 'active')
      ORDER BY e.created_at LIMIT 10`,
    [organizationId, p.categoryCode, p.occurredLocalDate, p.driverRelationshipId, p.vehicleRelationshipId, excludeEventId ?? null, p.occurredAt],
  )
}

export async function createEvent(ctx: EventContext, organizationId: string, input: EventInput) {
  await requireOrganization(ctx, organizationId)
  const prepared = prepareEvent(input)
  const links = {
    driverPerson: await resolveLink(ctx, organizationId, "driver", prepared.driverRelationshipId, "driverRelationshipId"),
    vehicle: await resolveLink(ctx, organizationId, "vehicle", prepared.vehicleRelationshipId, "vehicleRelationshipId"),
    trailer: await resolveLink(ctx, organizationId, "vehicle", prepared.trailerRelationshipId, "trailerRelationshipId"),
  }
  if (prepared.sourceReference) {
    const same = await sql<{ id: string }>(ctx, `SELECT id FROM public.driver_events WHERE organization_id = $1 AND category = $2 AND source_type = $3 AND source_reference = $4`, [organizationId, prepared.category, prepared.sourceType, prepared.sourceReference])
    if (same[0]) throw new DriverEventConflictError(`This source record is already recorded as event ${same[0].id}.`)
  }
  const duplicates = await findPossibleDuplicates(ctx, organizationId, prepared)
  const id = randomUUID()
  const cols = ["id", "organization_id", ...INSERT_COLUMNS, "created_by_actor_id", "reporter_actor_id"]
  const values = [id, organizationId, ...columnValues(prepared, links), ctx.actor.id, ctx.actor.id]
  const placeholders = cols.map((c, i) => (c === "data_quality" || c === "record" ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(", ")
  await sql(ctx, `INSERT INTO public.driver_events (${cols.join(", ")}) VALUES (${placeholders})`, values)
  await addHistory(ctx, id, organizationId, "CREATED", { version: 1, snapshot: snapshotOf(prepared), changes: [] })
  // A restriction follows the stated answer, not the record state: a draft that says "out of service: yes" holds the subject exactly as a recorded event does.
  await ensureObligations(ctx, { id, organization_id: organizationId, driver_relationship_id: prepared.driverRelationshipId, vehicle_id: links.vehicle, trailer_vehicle_id: links.trailer }, deriveObligations(prepared.categoryCode, prepared.record.facts), prepared.sourceReference)
  await refreshFact(ctx, organizationId, id)
  await mr(ctx, "RECORD_CREATED", "driver-event-create", id, organizationId, [`driver_event:${id}`], { field: "category", value: prepared.category })
  return { id, version: 1, possibleDuplicates: duplicates }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Revise / correct
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export async function reviseEvent(ctx: EventContext, organizationId: string, eventId: string, input: { expectedVersion: number; event: EventInput; reason?: string | null }) {
  const row = await lockEvent(ctx, organizationId, eventId)
  if (!Number.isInteger(input.expectedVersion)) throw new DriverEventValidationError("expectedVersion", "expectedVersion is required.")
  if (row.current_version !== input.expectedVersion) throw new DriverEventConflictError("The event changed since you opened it. Reload and apply your correction again.")
  if (row.status === "Closed") throw new DriverEventStateError("The event is closed; reopen it with a reason before correcting it.")
  if (!input.event || input.event.category !== row.category) throw new DriverEventValidationError("category", "The category of an event cannot be changed; record a new event instead.")
  const wasRecorded = (row as unknown as { record_state: string }).record_state === "RECORDED"
  const reason = text(input.reason, "reason", 1000, wasRecorded)
  const linkedEvidence = new Set((await sql<{ d: string }>(ctx, `SELECT evidence_document_id::text AS d FROM public.driver_event_evidence WHERE event_id = $1 AND link_status = 'active'`, [eventId])).map((r) => r.d))
  const prepared = prepareEvent(input.event, new Date(), linkedEvidence)
  if (wasRecorded && prepared.recordState === "DRAFT") throw new DriverEventStateError("A recorded event cannot return to draft.")
  const links = {
    driverPerson: await resolveLink(ctx, organizationId, "driver", prepared.driverRelationshipId, "driverRelationshipId"),
    vehicle: await resolveLink(ctx, organizationId, "vehicle", prepared.vehicleRelationshipId, "vehicleRelationshipId"),
    trailer: await resolveLink(ctx, organizationId, "vehicle", prepared.trailerRelationshipId, "trailerRelationshipId"),
  }
  // A correction cannot dissolve a safety restriction: if the earlier facts obliged a restriction that the corrected facts no longer do, and it is still
  // active, it has to be released (documented) first.
  const before = deriveObligations(row.category_code, (row.record.facts ?? {}) as never)
  const after = deriveObligations(prepared.categoryCode, prepared.record.facts)
  const kept = new Set(after.restrictions.map((r) => r.restrictionKind))
  for (const r of before.restrictions) {
    if (kept.has(r.restrictionKind)) continue
    const active = await sql(ctx, `SELECT 1 FROM public.driver_event_restrictions WHERE event_id = $1 AND restriction_kind = $2 AND state = 'ACTIVE'`, [eventId, r.restrictionKind])
    if (active.length) throw new DriverEventStateError("This correction would remove the basis of an active safety restriction. Release the restriction with its documented correction first; it cannot be cleared by editing the answer.")
  }
  if (prepared.sourceReference && (prepared.sourceReference !== (row as unknown as { source_reference: string | null }).source_reference || prepared.sourceType !== row.source_type)) {
    const same = await sql<{ id: string }>(ctx, `SELECT id FROM public.driver_events WHERE organization_id = $1 AND category = $2 AND source_type = $3 AND source_reference = $4 AND id <> $5`, [organizationId, prepared.category, prepared.sourceType, prepared.sourceReference, eventId])
    if (same[0]) throw new DriverEventConflictError("Another event already uses that source record.")
  }
  const [prevSnapshot] = await sql<{ snapshot: PreparedEvent }>(ctx, `SELECT snapshot FROM public.driver_event_history WHERE event_id = $1 AND record_version = $2 ORDER BY seq DESC LIMIT 1`, [eventId, row.current_version])
  const changes = prevSnapshot ? diffPrepared(prevSnapshot.snapshot, prepared) : []
  if (!changes.length) throw new DriverEventValidationError("event", "Nothing changed.")
  const nextVersion = row.current_version + 1
  const setCols = INSERT_COLUMNS.filter((c) => c !== "category" && c !== "category_code")
  const allValues = columnValues(prepared, links)
  const valueByCol = new Map<string, unknown>(INSERT_COLUMNS.map((c, i) => [c, allValues[i]]))
  const sets = [...setCols.map((c, i) => `${c} = $${i + 3}${c === "data_quality" || c === "record" ? "::jsonb" : ""}`), `current_version = $${setCols.length + 3}`]
  await sql(ctx, `UPDATE public.driver_events SET ${sets.join(", ")} WHERE id = $1 AND organization_id = $2`, [eventId, organizationId, ...setCols.map((c) => valueByCol.get(c)), nextVersion])
  await addHistory(ctx, eventId, organizationId, wasRecorded ? "CORRECTION" : "VERSION", { version: nextVersion, snapshot: snapshotOf(prepared), changes, reason })
  await ensureObligations(ctx, { id: eventId, organization_id: organizationId, driver_relationship_id: prepared.driverRelationshipId, vehicle_id: links.vehicle, trailer_vehicle_id: links.trailer }, after, prepared.sourceReference)
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, wasRecorded ? "RECORD_CORRECTED" : "RECORD_UPDATED", wasRecorded ? "driver-event-correct" : "driver-event-update", eventId, organizationId, [`driver_event:${eventId}`], { field: changes[0].field, value: String(changes[0].after ?? "") })
  return { id: eventId, version: nextVersion, changedFields: changes.map((c) => c.field) }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Status / closure / reopening
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Closing is the point where "the approved workflow requires evidence" can be enforced on the canonical store: evidence is linked to the SAVED event, so it cannot exist at
 * creation. A category whose policy requires evidence cannot be closed without at least one active linked document (stored and scanned: linking guarantees it), and an obtained
 * uploaded-document Driver Statement must reference its linked evidence. Categories whose policy does not require evidence are not affected.
 */
async function assertClosureEvidence(ctx: EventContext, organizationId: string, eventId: string, row: EventRow) {
  const definition = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.find((d) => d.code === row.category_code)
  if (definition?.evidenceRequired) {
    const links = await sql<{ n: string }>(ctx, `SELECT count(*)::text AS n FROM public.driver_event_evidence l WHERE l.event_id = $1 AND l.organization_id = $2 AND l.link_status = 'active' AND tes_security.driver_event_evidence_state(l.organization_id, l.evidence_document_id) = 'stored'`, [eventId, organizationId])
    if (Number(links[0]?.n ?? 0) < 1) throw new DriverEventStateError("This category requires supporting evidence. Link at least one stored document to the event before closing it.")
  }
  const missing = closureEvidenceIssues(((row.record as { childCollections?: unknown } | undefined)?.childCollections ?? {}) as Record<string, unknown>)
  if (missing.length) throw new DriverEventStateError(missing[0])
}

export async function changeStatus(ctx: EventContext, organizationId: string, eventId: string, input: { to: string; reason?: string | null }) {
  const row = await lockEvent(ctx, organizationId, eventId)
  const to = oneOf(input.to, EVENT_STATUSES, "to")
  const from = row.status
  if (from === to) throw new DriverEventValidationError("to", "The event already has that status.")
  const record_state = (row as unknown as { record_state: string }).record_state
  if (to === "Closed" && record_state !== "RECORDED") throw new DriverEventStateError("A draft cannot be closed; record it first.")
  const reopening = from === "Closed"
  const reason = text(input.reason, "reason", 1000, to === "Closed" || reopening)
  if (to === "Closed") {
    await sql(ctx, `UPDATE public.driver_events SET status = 'Closed', closed_at = clock_timestamp(), closed_by_actor_id = $3, closure_reason = $4 WHERE id = $1 AND organization_id = $2`, [eventId, organizationId, ctx.actor.id, reason])
  } else {
    await sql(ctx, `UPDATE public.driver_events SET status = $3, closed_at = NULL, closed_by_actor_id = NULL, closure_reason = NULL WHERE id = $1 AND organization_id = $2`, [eventId, organizationId, to])
  }
  // after the update, so a refusal by the database guards (an active restriction, open required follow-up) is reported first; a refusal here rolls the whole change back
  if (to === "Closed") await assertClosureEvidence(ctx, organizationId, eventId, row)
  await addHistory(ctx, eventId, organizationId, to === "Closed" ? "CLOSED" : reopening ? "REOPENED" : "STATUS_CHANGED", { changes: [{ field: "status", before: from, after: to }], reason })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "RECORD_STATUS_CHANGED", "driver-event-status", eventId, organizationId, [`driver_event:${eventId}`], { field: "status", value: to })
  return { id: eventId, status: to }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Evidence (real files go through the existing GCS lifecycle; this links the resulting evidence document)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

async function evidenceState(ctx: EventContext, organizationId: string, documentId: string): Promise<string | null> {
  const rows = await sql<{ state: string | null }>(ctx, `SELECT tes_security.driver_event_evidence_state($1, $2) AS state`, [organizationId, documentId])
  return rows[0]?.state ?? null
}

export async function linkEvidence(ctx: EventContext, organizationId: string, eventId: string, input: { documentId: string; role: string; note?: string | null }) {
  await lockEvent(ctx, organizationId, eventId)
  const documentId = uuid(input.documentId, "documentId")
  const role = oneOf(input.role, EVIDENCE_ROLES, "role")
  const note = text(input.note, "note", 1000)
  const state = await evidenceState(ctx, organizationId, documentId)
  if (state === null) throw new DriverEventNotFoundError("Evidence not found for this company.")
  if (state !== "stored") throw new DriverEventStateError(`That file is ${state}; it can be linked once it has finished upload and scanning.`)
  const id = randomUUID()
  await sql(ctx, `INSERT INTO public.driver_event_evidence (id, event_id, organization_id, evidence_document_id, role, note, linked_by_actor_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, eventId, organizationId, documentId, role, note, ctx.actor.id])
  await addHistory(ctx, eventId, organizationId, "EVIDENCE_LINKED", { changes: [{ field: "evidence", after: documentId, role }] })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "EVIDENCE_ASSOCIATED", "driver-event-evidence-link", eventId, organizationId, [`driver_event:${eventId}`, `evidence_document:${documentId}`], { field: "evidence", value: documentId })
  return { id, documentId, role, verificationState: "UNVERIFIED" as const }
}

export async function verifyEvidence(ctx: EventContext, organizationId: string, eventId: string, linkId: string, input: { decision: string; note?: string | null }) {
  await lockEvent(ctx, organizationId, eventId)
  const decision = oneOf(input.decision, ["VERIFIED", "REJECTED"] as const, "decision")
  const note = text(input.note, "note", 1000, decision === "REJECTED")
  const [link] = await sql<{ id: string; evidence_document_id: string; link_status: string }>(ctx, `SELECT id, evidence_document_id, link_status FROM public.driver_event_evidence WHERE id = $1 AND event_id = $2 AND organization_id = $3 FOR UPDATE`, [uuid(linkId, "linkId"), eventId, organizationId])
  if (!link) throw new DriverEventNotFoundError("Evidence link not found.")
  if (link.link_status !== "active") throw new DriverEventStateError("That evidence is no longer linked.")
  if ((await evidenceState(ctx, organizationId, link.evidence_document_id)) !== "stored") throw new DriverEventStateError("Only stored evidence can be verified.")
  await sql(ctx, `UPDATE public.driver_event_evidence SET verification_state = $2, verified_by_actor_id = $3, verified_at = clock_timestamp(), verification_note = $4 WHERE id = $1`, [link.id, decision, ctx.actor.id, note])
  const links = await sql<{ verification_state: string }>(ctx, `SELECT verification_state FROM public.driver_event_evidence WHERE event_id = $1 AND link_status = 'active'`, [eventId])
  const v = links.filter((l) => l.verification_state === "VERIFIED").length
  const r = links.filter((l) => l.verification_state === "REJECTED").length
  const next = v === links.length ? "VERIFIED" : v > 0 ? "PARTIALLY_VERIFIED" : r === links.length ? "UNABLE_TO_VERIFY" : "UNVERIFIED"
  await sql(ctx, `UPDATE public.driver_events SET verification_state = $3 WHERE id = $1 AND organization_id = $2`, [eventId, organizationId, next])
  await addHistory(ctx, eventId, organizationId, "EVIDENCE_VERIFICATION", { changes: [{ field: "evidence.verification", evidence: link.evidence_document_id, after: decision }], reason: note })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "RECORD_UPDATED", "driver-event-evidence-verify", eventId, organizationId, [`driver_event:${eventId}`], { field: "evidence.verification", value: decision })
  return { id: link.id, verificationState: decision, eventVerificationState: next }
}

export async function unlinkEvidence(ctx: EventContext, organizationId: string, eventId: string, linkId: string, input: { reason: string }) {
  await lockEvent(ctx, organizationId, eventId)
  const reason = text(input.reason, "reason", 1000, true)
  const [link] = await sql<{ id: string; evidence_document_id: string; link_status: string }>(ctx, `SELECT id, evidence_document_id, link_status FROM public.driver_event_evidence WHERE id = $1 AND event_id = $2 AND organization_id = $3 FOR UPDATE`, [uuid(linkId, "linkId"), eventId, organizationId])
  if (!link) throw new DriverEventNotFoundError("Evidence link not found.")
  if (link.link_status !== "active") throw new DriverEventStateError("That evidence is already unlinked.")
  const used = await sql(ctx, `SELECT 1 FROM public.driver_event_restrictions WHERE event_id = $1 AND release_evidence_document_id = $2`, [eventId, link.evidence_document_id])
  if (used.length) throw new DriverEventStateError("That evidence documents a restriction release and cannot be unlinked.")
  const event = await lockEvent(ctx, organizationId, eventId)
  if (referencedEvidenceIds(((event.record as { childCollections?: unknown } | undefined)?.childCollections ?? {}) as Record<string, unknown>).has(link.evidence_document_id)) throw new DriverEventStateError("A detail item of this event references that evidence. Remove the reference with a correction first.")
  const definition = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.find((d) => d.code === event.category_code)
  if (event.status === "Closed" && definition?.evidenceRequired) {
    const rest = await sql<{ n: string }>(ctx, `SELECT count(*)::text AS n FROM public.driver_event_evidence WHERE event_id = $1 AND link_status = 'active' AND id <> $2`, [eventId, link.id])
    if (Number(rest[0]?.n ?? 0) < 1) throw new DriverEventStateError("This closed event needs its supporting evidence. Reopen it with a reason before unlinking its last document.")
  }
  await sql(ctx, `UPDATE public.driver_event_evidence SET link_status = 'unlinked', unlinked_at = clock_timestamp(), unlinked_by_actor_id = $2, unlink_reason = $3 WHERE id = $1`, [link.id, ctx.actor.id, reason])
  await addHistory(ctx, eventId, organizationId, "EVIDENCE_UNLINKED", { changes: [{ field: "evidence", before: link.evidence_document_id }], reason })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "RECORD_UPDATED", "driver-event-evidence-unlink", eventId, organizationId, [`driver_event:${eventId}`], { field: "evidence", value: "unlinked" })
  return { id: link.id }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Relationships and de-duplication
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export async function addRelationship(ctx: EventContext, organizationId: string, eventId: string, input: { type: string; toEventId?: string | null; recordRef?: string | null; note?: string | null }) {
  await lockEvent(ctx, organizationId, eventId)
  const type = oneOf(input.type, EVENT_RELATIONSHIPS, "type")
  const note = text(input.note, "note", 1000)
  const id = randomUUID()
  if (EVENT_TO_EVENT.has(type)) {
    const toEventId = uuid(input.toEventId, "toEventId")
    if (toEventId === eventId) throw new DriverEventValidationError("toEventId", "An event cannot be related to itself.")
    const [target] = await sql<{ id: string }>(ctx, `SELECT id FROM public.driver_events WHERE id = $1 AND organization_id = $2`, [toEventId, organizationId])
    if (!target) throw new DriverEventNotFoundError("The related event was not found in this company.")
    if (type === "DUPLICATE_OF") {
      const restricted = await sql(ctx, `SELECT 1 FROM public.driver_event_restrictions WHERE event_id = $1 AND state = 'ACTIVE' AND mandatory`, [eventId])
      if (restricted.length) throw new DriverEventStateError("An event with an active mandatory safety restriction cannot be marked a duplicate. Release the restriction first, or record the restriction on the original event.")
      const loops = await sql(ctx, `SELECT 1 FROM public.driver_event_relationships WHERE relationship_type = 'DUPLICATE_OF' AND status = 'active' AND ((from_event_id = $1 AND to_event_id = $2) OR (from_event_id = $2) OR (to_event_id = $1))`, [toEventId, eventId])
      if (loops.length) throw new DriverEventStateError("Point a duplicate at the ORIGINAL event: the target is itself a duplicate, or this event already has duplicates of its own.")
    }
    await sql(ctx, `INSERT INTO public.driver_event_relationships (id, organization_id, from_event_id, relationship_type, to_event_id, note, created_by_actor_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, organizationId, eventId, type, toEventId, note, ctx.actor.id])
  } else {
    const ref = text(input.recordRef, "recordRef", 200, true)!
    try {
      await ctx.client.query("SAVEPOINT rel")
      await ctx.client.query(`INSERT INTO public.driver_event_relationships (id, organization_id, from_event_id, relationship_type, to_record_type, to_record_ref, note, created_by_actor_id) VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`, [id, organizationId, eventId, type, ref, note, ctx.actor.id])
      await ctx.client.query("RELEASE SAVEPOINT rel")
    } catch (error) {
      await ctx.client.query("ROLLBACK TO SAVEPOINT rel")
      if ((error as { code?: string }).code === "23505") throw new DriverEventConflictError("That record is already attached to an event, so it is not counted again here.")
      return database(error)
    }
  }
  await addHistory(ctx, eventId, organizationId, "RELATIONSHIP_ADDED", { changes: [{ field: "relationship", after: type, target: input.toEventId ?? input.recordRef }] })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "RECORD_LINK_ESTABLISHED", "driver-event-relationship", eventId, organizationId, [`driver_event:${eventId}`], { field: "relationship", value: type })
  return { id, type }
}

export async function removeRelationship(ctx: EventContext, organizationId: string, eventId: string, relationshipId: string, input: { reason: string }) {
  await lockEvent(ctx, organizationId, eventId)
  const reason = text(input.reason, "reason", 1000, true)
  const rows = await sql<{ id: string; relationship_type: string }>(ctx, `UPDATE public.driver_event_relationships SET status = 'removed', removed_at = clock_timestamp(), removed_by_actor_id = $4, removal_reason = $5 WHERE id = $1 AND from_event_id = $2 AND organization_id = $3 AND status = 'active' RETURNING id, relationship_type`, [uuid(relationshipId, "relationshipId"), eventId, organizationId, ctx.actor.id, reason])
  if (!rows[0]) throw new DriverEventNotFoundError("Relationship not found.")
  await addHistory(ctx, eventId, organizationId, "RELATIONSHIP_REMOVED", { changes: [{ field: "relationship", before: rows[0].relationship_type }], reason })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "RECORD_UPDATED", "driver-event-relationship-remove", eventId, organizationId, [`driver_event:${eventId}`], { field: "relationship", value: "removed" })
  return { id: rows[0].id }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Consequences
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type ConsequenceInput = {
  kind: string
  measurementState: string
  quantity?: number | null
  unit?: string | null
  amountMinor?: number | null
  currency?: string | null
  startedAt?: string | null
  endedAt?: string | null
  measuredOn?: string | null
  source: string
  confidence: string
  linkType?: string | null
  linkRef?: string | null
  note?: string | null
}

export async function recordConsequence(ctx: EventContext, organizationId: string, eventId: string, input: ConsequenceInput) {
  await lockEvent(ctx, organizationId, eventId)
  const kind = oneOf(input.kind, CONSEQUENCE_KINDS, "kind")
  const state = oneOf(input.measurementState, ["MEASURED", "NONE_CONFIRMED", "NOT_COLLECTED", "UNKNOWN"] as const, "measurementState")
  const source = text(input.source, "source", 120, true)!
  const confidence = oneOf(input.confidence, ["CONFIRMED", "ESTIMATED", "UNVERIFIED"] as const, "confidence")
  const linkType = text(input.linkType, "linkType", 60)
  const linkRef = text(input.linkRef, "linkRef", 200)
  if ((linkType === null) !== (linkRef === null)) throw new DriverEventValidationError("linkRef", "A source record is named by its type and its reference together.")
  const num = (v: unknown, field: string) => {
    if (v === undefined || v === null) return null
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new DriverEventValidationError(field, `${field} must be zero or more.`)
    return v
  }
  const quantity = num(input.quantity, "quantity")
  const amountMinor = num(input.amountMinor, "amountMinor")
  if (amountMinor !== null && !Number.isInteger(amountMinor)) throw new DriverEventValidationError("amountMinor", "Amounts are whole minor units (cents).")
  const currency = text(input.currency, "currency", 3)
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new DriverEventValidationError("currency", "Currency must be a three-letter code.")
  if ((amountMinor === null) !== (currency === null)) throw new DriverEventValidationError("currency", "An amount and its currency are entered together.")
  const unit = text(input.unit, "unit", 30)
  if (quantity !== null && !unit) throw new DriverEventValidationError("unit", "A quantity needs its unit.")
  const startedAt = input.startedAt ? new Date(input.startedAt) : null
  const endedAt = input.endedAt ? new Date(input.endedAt) : null
  if ((startedAt && Number.isNaN(startedAt.getTime())) || (endedAt && Number.isNaN(endedAt.getTime()))) throw new DriverEventValidationError("startedAt", "The start or end time is not valid.")
  if (startedAt && endedAt && endedAt < startedAt) throw new DriverEventValidationError("endedAt", "The end cannot be before the start.")
  const measuredOn = input.measuredOn ?? null
  if (measuredOn !== null && !isValidDateOnly(measuredOn)) throw new DriverEventValidationError("measuredOn", "The measurement date is not valid.")
  const hasMeasure = quantity !== null || amountMinor !== null || (startedAt && endedAt)
  if (state === "MEASURED" && !hasMeasure) throw new DriverEventValidationError("quantity", "A measured consequence needs a quantity, an amount or a start and end time.")
  if (state !== "MEASURED" && (quantity !== null || amountMinor !== null || startedAt || endedAt)) throw new DriverEventValidationError("measurementState", "Only a measured consequence carries a measurement. Missing is not zero: choose NONE_CONFIRMED only when someone confirmed there was none.")
  const dedupeKey = linkType ? `${linkType}:${linkRef}` : `EVENT:${eventId}:${source.toLowerCase()}`

  const clash = await sql<{ id: string; event_id: string }>(ctx, `SELECT id, event_id FROM public.driver_event_consequences WHERE organization_id = $1 AND kind = $2 AND dedupe_key = $3 AND state = 'ACTIVE' FOR UPDATE`, [organizationId, kind, dedupeKey])
  if (clash[0] && clash[0].event_id !== eventId) throw new DriverEventConflictError("That source record is already counted for another event, so it cannot be counted again here.")
  const id = randomUUID()
  if (clash[0]) {
    // same source, same event: the new measurement supersedes the old one (the old row stays as history)
    await sql(ctx, `UPDATE public.driver_event_consequences SET state = 'SUPERSEDED', superseded_by_id = $2 WHERE id = $1`, [clash[0].id, id])
  }
  await sql(
    ctx,
    `INSERT INTO public.driver_event_consequences (id, event_id, organization_id, kind, measurement_state, quantity, unit, amount_minor, currency, started_at, ended_at, measured_on, source, confidence, link_type, link_ref, dedupe_key, note, recorded_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [id, eventId, organizationId, kind, state, quantity, unit, amountMinor, currency, startedAt?.toISOString() ?? null, endedAt?.toISOString() ?? null, measuredOn, source, confidence, linkType, linkRef, dedupeKey, text(input.note, "note", 1000), ctx.actor.id],
  )
  if (clash[0]) await addHistory(ctx, eventId, organizationId, "CONSEQUENCE_SUPERSEDED", { changes: [{ field: "consequence", before: clash[0].id, after: id, kind }], reason: "Replaced by a newer measurement from the same source." })
  await addHistory(ctx, eventId, organizationId, "CONSEQUENCE_RECORDED", { changes: [{ field: "consequence", after: id, kind, measurementState: state }] })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "RECORD_UPDATED", "driver-event-consequence", eventId, organizationId, [`driver_event:${eventId}`], { field: "consequence", value: kind })
  return { id, kind, superseded: clash[0]?.id ?? null }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Corrective actions and required follow-up
// ---------------------------------------------------------------------------------------------------------------------------------------------------


export async function addAction(ctx: EventContext, organizationId: string, eventId: string, input: { actionType: string; title: string; description?: string | null; required?: boolean; ownerLabel?: string | null; ownerActorId?: string | null; dueDate?: string | null }) {
  await lockEvent(ctx, organizationId, eventId)
  const actionType = oneOf(input.actionType, ACTION_TYPES, "actionType")
  const title = text(input.title, "title", 300, true)!
  const ownerLabel = text(input.ownerLabel, "ownerLabel", 200)
  const ownerActorId = input.ownerActorId ? uuid(input.ownerActorId, "ownerActorId") : null
  const required = input.required === true
  if (required && !ownerLabel && !ownerActorId) throw new DriverEventValidationError("ownerLabel", "Required follow-up needs a named owner.")
  if (input.dueDate && !isValidDateOnly(input.dueDate)) throw new DriverEventValidationError("dueDate", "The due date is not valid.")
  const id = randomUUID()
  await sql(ctx, `INSERT INTO public.driver_event_actions (id, event_id, organization_id, action_type, title, description, required, owner_actor_id, owner_label, due_date, created_by_actor_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [id, eventId, organizationId, actionType, title, text(input.description, "description", 2000), required, ownerActorId, ownerLabel, input.dueDate ?? null, ctx.actor.id])
  await addHistory(ctx, eventId, organizationId, "ACTION_ADDED", { changes: [{ field: "action", after: title, required }] })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "RECORD_UPDATED", "driver-event-action", eventId, organizationId, [`driver_event:${eventId}`], { field: "action", value: title })
  return { id }
}

export async function updateAction(ctx: EventContext, organizationId: string, eventId: string, actionId: string, input: { status: string; note?: string | null; ownerLabel?: string | null; dueDate?: string | null }) {
  await lockEvent(ctx, organizationId, eventId)
  const status = oneOf(input.status, ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const, "status")
  const finishing = status === "COMPLETED" || status === "CANCELLED"
  const note = text(input.note, "note", 1000, finishing)
  if (input.dueDate && !isValidDateOnly(input.dueDate)) throw new DriverEventValidationError("dueDate", "The due date is not valid.")
  const rows = await sql<{ id: string; title: string }>(
    ctx,
    finishing
      ? `UPDATE public.driver_event_actions SET status = $4, completed_at = clock_timestamp(), completed_by_actor_id = $5, completion_note = $6 WHERE id = $1 AND event_id = $2 AND organization_id = $3 RETURNING id, title`
      : `UPDATE public.driver_event_actions SET status = $4, owner_label = coalesce($7, owner_label), due_date = coalesce($8::date, due_date) WHERE id = $1 AND event_id = $2 AND organization_id = $3 RETURNING id, title`,
    finishing ? [uuid(actionId, "actionId"), eventId, organizationId, status, ctx.actor.id, note] : [uuid(actionId, "actionId"), eventId, organizationId, status, null, null, text(input.ownerLabel, "ownerLabel", 200), input.dueDate ?? null],
  )
  if (!rows[0]) throw new DriverEventNotFoundError("Action not found.")
  await addHistory(ctx, eventId, organizationId, "ACTION_STATUS", { changes: [{ field: "action", target: rows[0].title, after: status }], reason: note })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "RECORD_UPDATED", "driver-event-action-status", eventId, organizationId, [`driver_event:${eventId}`], { field: "action", value: status })
  return { id: rows[0].id, status }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Safety restrictions
// ---------------------------------------------------------------------------------------------------------------------------------------------------


export async function issueRestriction(ctx: EventContext, organizationId: string, eventId: string, input: { restrictionKind: string; authority: string; subjectType: string; subjectLabel?: string | null; sourceReference?: string | null; issuedAt?: string | null; requiredCorrection?: string | null; responseDeadline?: string | null; mandatory?: boolean }) {
  const row = await lockEvent(ctx, organizationId, eventId)
  if (row.status === "Closed") throw new DriverEventStateError("The event is closed; reopen it with a reason first.")
  const restrictionKind = oneOf(input.restrictionKind, RESTRICTION_KINDS, "restrictionKind")
  const authority = oneOf(input.authority, ["ENFORCEMENT", "REGULATOR", "COMPANY", "OTHER"] as const, "authority")
  const subjectType = oneOf(input.subjectType, ["DRIVER", "VEHICLE", "TRAILER", "CARGO", "OTHER"] as const, "subjectType")
  if ((authority === "ENFORCEMENT" || authority === "REGULATOR") && input.mandatory === false) throw new DriverEventValidationError("mandatory", "An enforcement or regulator restriction is always mandatory.")
  const driver = subjectType === "DRIVER" ? row.driver_relationship_id : null
  const vehicle = subjectType === "VEHICLE" ? row.vehicle_id : subjectType === "TRAILER" ? row.trailer_vehicle_id : null
  const label = text(input.subjectLabel, "subjectLabel", 300, !driver && !vehicle)
  if (input.responseDeadline && !isValidDateOnly(input.responseDeadline)) throw new DriverEventValidationError("responseDeadline", "The response deadline is not valid.")
  const issuedAt = input.issuedAt ? new Date(input.issuedAt) : null
  if (issuedAt && Number.isNaN(issuedAt.getTime())) throw new DriverEventValidationError("issuedAt", "The issue time is not valid.")
  const id = randomUUID()
  await sql(ctx, `INSERT INTO public.driver_event_restrictions (id, event_id, organization_id, restriction_kind, authority, mandatory, subject_type, subject_driver_relationship_id, subject_vehicle_id, subject_label, source_reference, issued_at, required_correction, response_deadline, created_by_actor_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`, [id, eventId, organizationId, restrictionKind, authority, input.mandatory !== false, subjectType, driver, vehicle, label, text(input.sourceReference, "sourceReference", 200), issuedAt?.toISOString() ?? null, text(input.requiredCorrection, "requiredCorrection", 2000), input.responseDeadline ?? null, ctx.actor.id])
  await addHistory(ctx, eventId, organizationId, "RESTRICTION_ISSUED", { changes: [{ field: "restriction", after: restrictionKind, authority }] })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "RECORD_UPDATED", "driver-event-restriction-issue", eventId, organizationId, [`driver_event:${eventId}`], { field: "restriction", value: restrictionKind })
  return { id }
}

export type ReleaseSteps = { enterRelease: () => Promise<void>; enterManage: () => Promise<void> }

/** The release is the ONLY way a safety restriction ends. It runs under the dedicated release capability and needs the documented correction. */
export async function releaseRestriction(ctx: EventContext, organizationId: string, eventId: string, restrictionId: string, input: { releaseBasis: string; evidenceDocumentId?: string | null; correctionSummary: string; releaseNote?: string | null }, steps: ReleaseSteps) {
  await steps.enterManage()
  await lockEvent(ctx, organizationId, eventId)
  const [restriction] = await sql<{ id: string; state: string; authority: string; restriction_kind: string }>(ctx, `SELECT id, state, authority, restriction_kind FROM public.driver_event_restrictions WHERE id = $1 AND event_id = $2 AND organization_id = $3`, [uuid(restrictionId, "restrictionId"), eventId, organizationId]) // the event row lock serialises releases; FOR UPDATE here would need the release policy
  if (!restriction) throw new DriverEventNotFoundError("Restriction not found.")
  if (restriction.state !== "ACTIVE") throw new DriverEventStateError("That restriction is already released.", "ALREADY_RELEASED")
  const basis = oneOf(input.releaseBasis, ["AUTHORITY_RELEASE_DOCUMENTED", "CORRECTED_AND_AUTHORITY_CONFIRMED", "COMPANY_CLEARANCE"] as const, "releaseBasis")
  const correctionSummary = text(input.correctionSummary, "correctionSummary", 2000, true)!
  const evidenceId = input.evidenceDocumentId ? uuid(input.evidenceDocumentId, "evidenceDocumentId") : null
  const authoritative = restriction.authority === "ENFORCEMENT" || restriction.authority === "REGULATOR"
  if (authoritative) {
    if (basis === "COMPANY_CLEARANCE") throw new DriverEventStateError("An enforcement or regulator restriction cannot be cleared by the company. It needs the documented authoritative release.", "COMPANY_CLEARANCE_REFUSED")
    if (!evidenceId) throw new DriverEventValidationError("evidenceDocumentId", "The release document is required for an enforcement restriction.")
    const ok = await sql(ctx, `SELECT 1 FROM public.driver_event_evidence l WHERE l.event_id = $1 AND l.evidence_document_id = $2 AND l.role = 'RELEASE_EVIDENCE' AND l.link_status = 'active'`, [eventId, evidenceId])
    if (!ok.length) throw new DriverEventStateError("Link the release document to this event with the role Release Evidence first.", "RELEASE_DOCUMENT_NOT_LINKED")
    const verified = await sql(ctx, `SELECT 1 FROM public.driver_event_evidence l WHERE l.event_id = $1 AND l.evidence_document_id = $2 AND l.role = 'RELEASE_EVIDENCE' AND l.link_status = 'active' AND l.verification_state = 'VERIFIED'`, [eventId, evidenceId])
    if (!verified.length) throw new DriverEventStateError("A person must verify the release document before it can release the restriction.", "RELEASE_DOCUMENT_UNVERIFIED")
  }
  await steps.enterRelease()
  let released: number | null = 0
  try {
    released = (await ctx.client.query(`UPDATE public.driver_event_restrictions SET state = 'RELEASED', release_basis = $2, release_evidence_document_id = $3, correction_summary = $4, release_note = $5, released_by_actor_id = $6, released_at = clock_timestamp() WHERE id = $1 AND state = 'ACTIVE'`, [restriction.id, basis, evidenceId, correctionSummary, text(input.releaseNote, "releaseNote", 1000), ctx.actor.id])).rowCount
  } catch (error) {
    return database(error)
  }
  // Row-level security filters silently: a release that touched nothing must never be reported as done.
  if (released !== 1) throw new DriverEventStateError("The restriction could not be released.", "RELEASE_NOT_APPLIED")
  await steps.enterManage()
  await addHistory(ctx, eventId, organizationId, "RESTRICTION_RELEASED", { changes: [{ field: "restriction", before: restriction.restriction_kind, after: "RELEASED", basis }], reason: correctionSummary })
  await refreshFact(ctx, organizationId, eventId)
  await mr(ctx, "RECORD_STATUS_CHANGED", "driver-event-restriction-release", eventId, organizationId, [`driver_event:${eventId}`], { field: "restriction", value: "RELEASED" })
  return { id: restriction.id, state: "RELEASED" as const }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export async function getEvent(ctx: EventContext, organizationId: string, eventId: string) {
  // Calendar dates and wall-clock times leave the database as TEXT: a DATE read into a JavaScript Date would shift with the server's time zone.
  const [event] = await sql(ctx, `SELECT to_jsonb(e) || jsonb_build_object('occurred_local_date', to_char(e.occurred_local_date, 'YYYY-MM-DD'), 'reported_local_date', to_char(e.reported_local_date, 'YYYY-MM-DD'), 'occurred_local_time', to_char(e.occurred_local_time, 'HH24:MI')) AS j FROM public.driver_events e WHERE e.id = $1 AND e.organization_id = $2`, [uuid(eventId, "eventId"), organizationId]).then((r) => r.map((x) => (x as { j: Record<string, unknown> }).j))
  if (!event) throw new DriverEventNotFoundError("Event not found.")
  const [history, evidence, relationships, consequences, actions, restrictions, facts] = await Promise.all([
    sql(ctx, `SELECT id, seq, entry_type, record_version, changes, reason, actor_id, occurred_at FROM public.driver_event_history WHERE event_id = $1 ORDER BY seq`, [eventId]),
    sql(ctx, `SELECT l.*, tes_security.driver_event_evidence_state(l.organization_id, l.evidence_document_id) AS lifecycle_state FROM public.driver_event_evidence l WHERE l.event_id = $1 ORDER BY l.linked_at`, [eventId]),
    sql(ctx, `SELECT * FROM public.driver_event_relationships WHERE (from_event_id = $1 OR to_event_id = $1) AND organization_id = $2 ORDER BY created_at`, [eventId, organizationId]),
    sql(ctx, `SELECT to_jsonb(c) || jsonb_build_object('measured_on', to_char(c.measured_on, 'YYYY-MM-DD')) AS j FROM public.driver_event_consequences c WHERE c.event_id = $1 ORDER BY c.recorded_at`, [eventId]).then((r) => r.map((x) => (x as { j: unknown }).j)),
    sql(ctx, `SELECT to_jsonb(a) || jsonb_build_object('due_date', to_char(a.due_date, 'YYYY-MM-DD')) AS j FROM public.driver_event_actions a WHERE a.event_id = $1 ORDER BY a.created_at`, [eventId]).then((r) => r.map((x) => (x as { j: unknown }).j)),
    sql(ctx, `SELECT to_jsonb(r) || jsonb_build_object('response_deadline', to_char(r.response_deadline, 'YYYY-MM-DD')) AS j FROM public.driver_event_restrictions r WHERE r.event_id = $1 ORDER BY r.created_at`, [eventId]).then((r) => r.map((x) => (x as { j: unknown }).j)),
    sql(ctx, `SELECT * FROM public.driver_event_bi_facts WHERE event_id = $1 ORDER BY record_version DESC LIMIT 1`, [eventId]),
  ])
  return { event, history, evidence, relationships, consequences, actions, restrictions, fact: facts[0] ?? null, contractVersion: BI_CONTRACT_VERSION }
}

export async function getVersion(ctx: EventContext, organizationId: string, eventId: string, version: number) {
  const rows = await sql(ctx, `SELECT seq, entry_type, record_version, snapshot, reason, actor_id, occurred_at FROM public.driver_event_history WHERE event_id = $1 AND organization_id = $2 AND record_version = $3 ORDER BY seq`, [uuid(eventId, "eventId"), organizationId, version])
  if (!rows.length) throw new DriverEventNotFoundError("Version not found.")
  return rows
}

export type ListFilters = { category?: string; status?: string; driverRelationshipId?: string; vehicleId?: string; from?: string; to?: string; limit?: number; before?: string }

export async function listEvents(ctx: EventContext, organizationId: string, f: ListFilters = {}) {
  const where = ["e.organization_id = $1"]
  const params: unknown[] = [organizationId]
  const add = (clause: string, value: unknown) => { params.push(value); where.push(clause.replace("?", `$${params.length}`)) }
  if (f.category) add("e.category = ?", f.category)
  if (f.status) add("e.status = ?", oneOf(f.status, EVENT_STATUSES, "status"))
  if (f.driverRelationshipId) add("e.driver_relationship_id = ?", uuid(f.driverRelationshipId, "driverRelationshipId"))
  if (f.vehicleId) add("e.vehicle_id = ?", uuid(f.vehicleId, "vehicleId"))
  if (f.from) { if (!isValidDateOnly(f.from)) throw new DriverEventValidationError("from", "from is not a valid date."); add("e.occurred_local_date >= ?::date", f.from) }
  if (f.to) { if (!isValidDateOnly(f.to)) throw new DriverEventValidationError("to", "to is not a valid date."); add("e.occurred_local_date <= ?::date", f.to) }
  if (f.before) add("e.created_at < (SELECT created_at FROM public.driver_events WHERE id = ? AND organization_id = $1)", uuid(f.before, "before"))
  const limit = Math.min(Math.max(Math.trunc(f.limit ?? 50), 1), 200)
  const rows = await sql(
    ctx,
    `SELECT e.id, e.category, e.category_code, e.title, e.status, e.record_state, e.occurrence_precision, e.occurred_at, to_char(e.occurred_local_date, 'YYYY-MM-DD') AS occurred_local_date, e.occurred_time_zone, e.observed_severity, e.verification_state,
            e.driver_relationship_id, e.vehicle_id, e.current_version, e.created_at,
            (SELECT count(*) FROM public.driver_event_restrictions r WHERE r.event_id = e.id AND r.state = 'ACTIVE')::int AS active_restrictions,
            EXISTS (SELECT 1 FROM public.driver_event_relationships r WHERE r.from_event_id = e.id AND r.relationship_type = 'DUPLICATE_OF' AND r.status = 'active') AS is_duplicate
       FROM public.driver_events e WHERE ${where.join(" AND ")} ORDER BY e.created_at DESC, e.id LIMIT ${limit}`,
    params,
  )
  return rows
}

/** Contract v1 rows for the analytics layer: one per current, non-duplicate event. */
export async function listFacts(ctx: EventContext, organizationId: string, f: { from?: string; to?: string; categoryCode?: string; limit?: number } = {}) {
  const where = ["organization_id = $1"]
  const params: unknown[] = [organizationId]
  if (f.from) { if (!isValidDateOnly(f.from)) throw new DriverEventValidationError("from", "from is not a valid date."); params.push(f.from); where.push(`occurred_local_date >= $${params.length}::date`) }
  if (f.to) { if (!isValidDateOnly(f.to)) throw new DriverEventValidationError("to", "to is not a valid date."); params.push(f.to); where.push(`occurred_local_date <= $${params.length}::date`) }
  if (f.categoryCode) { params.push(f.categoryCode); where.push(`category_code = $${params.length}`) }
  const limit = Math.min(Math.max(Math.trunc(f.limit ?? 1000), 1), 5000)
  return sql(ctx, `SELECT * FROM public.driver_event_facts_v1 WHERE ${where.join(" AND ")} ORDER BY occurred_local_date NULLS LAST, event_id LIMIT ${limit}`, params)
}

/** Active safety restrictions for a driver (by person or relationship) and/or a vehicle, in one company. The call every dispatch, assignment, movement or HOS workflow makes before putting them to use. */
export async function listActiveRestrictions(ctx: EventContext, organizationId: string, f: { personId?: string; driverRelationshipId?: string; vehicleId?: string }) {
  if (!f.personId && !f.driverRelationshipId && !f.vehicleId) throw new DriverEventValidationError("subject", "Name a driver or a vehicle.")
  const person = f.personId ? uuid(f.personId, "personId") : null
  const rel = f.driverRelationshipId ? uuid(f.driverRelationshipId, "driverRelationshipId") : null
  const vehicle = f.vehicleId ? uuid(f.vehicleId, "vehicleId") : null
  return sql(
    ctx,
    `SELECT * FROM public.driver_event_active_restrictions_v1
      WHERE organization_id = $1 AND ((subject_type = 'DRIVER' AND ($2::uuid IS NOT NULL AND subject_person_id = $2::uuid OR $3::uuid IS NOT NULL AND subject_driver_relationship_id = $3::uuid))
         OR ($4::uuid IS NOT NULL AND subject_vehicle_id = $4::uuid))
      ORDER BY created_at`,
    [organizationId, person, rel, vehicle],
  )
}
