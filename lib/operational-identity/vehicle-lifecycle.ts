/**
 * Vehicle lifecycle operations over the approved migration 0020 / 0023 schema (no new table, column or policy):
 *
 *   registration periods   add / change (real-world change) / correct (mistaken value) / void
 *   vehicle                archive / restore
 *   relationship           end / change unit number (real-world change) / correct unit number (mistaken value)
 *
 * Semantics follow the schema's own history model:
 *   - a CHANGE ends the current row (effective_to) and starts a new row at the same instant, so the earlier fact stays true
 *     for its own period;
 *   - a CORRECTION marks the mistaken row `corrected` (corrected_at, superseded_by_id = the replacement) and inserts the
 *     replacement with the same business start; the mistaken row stays visible as history and is never edited or deleted;
 *   - VOID marks a row that should never have existed `voided` (corrected_at set, no replacement);
 *   - archive is a status (record_status = 'archived', archived_at); nothing is deleted, restore returns it to 'active'.
 *
 * Every operation runs on the transaction client the authorization wrapper checked out and writes its Master Register event
 * in that SAME transaction. Company isolation: every operation takes the organization from the caller (the route's URL), and
 * a vehicle, relationship or registration that does not belong to that organization is answered as not found.
 *
 * Identifiers (VIN, plate, registration and unit numbers) and dates never reach the Master Register: events carry references
 * and controlled status words only.
 *
 * No "server-only" import: plain domain logic, testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import { parseCountryCode, parseRegionCode } from "@/lib/corporate-identity/jurisdiction"
import { recordEvent } from "@/lib/master-register/record-event"
import type { FieldChange } from "@/lib/master-register/types"
import { normalizePlate, normalizeUnitNumber } from "./normalization"
import type { IdentityContext } from "./operations"
import * as repo from "./repository"
import * as lifecycle from "./vehicle-lifecycle-repository"
import {
  VehicleOperationConflictError,
  VehicleOperationError,
  VehicleOperationNotFoundError,
  VehicleOperationStateError,
  VehicleOperationValidationError,
} from "./vehicle-errors"

export type RegistrationKind = "BASE" | "APPORTIONED"

export type RegistrationFields = {
  registrationKind?: RegistrationKind
  registrationNumber?: string | null
  plate?: string | null
  jurisdictionCountry?: string
  jurisdictionRegion?: string
  effectiveFrom?: string
  effectiveTo?: string | null
}

export type AddRegistrationInput = RegistrationFields & {
  organizationId: string
  vehicleId: string
  jurisdictionCountry: string
  jurisdictionRegion: string
  effectiveFrom: string
}
export type ChangeRegistrationInput = RegistrationFields & {
  organizationId: string
  registrationId: string
  jurisdictionCountry: string
  jurisdictionRegion: string
  effectiveFrom: string
}
export type CorrectRegistrationInput = RegistrationFields & { organizationId: string; registrationId: string }
export type VoidRegistrationInput = { organizationId: string; registrationId: string }
export type VehicleLifecycleInput = { organizationId: string; vehicleId: string }
export type EndRelationshipInput = { organizationId: string; relationshipId: string; effectiveTo?: string }
export type UnitNumberInput = { organizationId: string; relationshipId: string; unitNumber: string }

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function parseUuid(value: unknown, field: string): string {
  if (typeof value === "string" && UUID.test(value.trim().toLowerCase())) return value.trim().toLowerCase()
  throw new VehicleOperationValidationError(field, `${field} must be a UUID.`)
}

function parseDate(value: unknown, field: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const text = value.trim()
    const parsed = new Date(`${text}T00:00:00Z`)
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text) return text
  }
  throw new VehicleOperationValidationError(field, `${field} must be a calendar date (YYYY-MM-DD).`)
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new VehicleOperationValidationError(field, `${field} must be text.`)
  const text = value.trim()
  if (text.length > max) throw new VehicleOperationValidationError(field, `${field} must be at most ${max} characters.`)
  return text === "" ? null : text
}

function parseKind(value: unknown): RegistrationKind {
  if (value === undefined || value === null) return "BASE"
  if (value === "BASE" || value === "APPORTIONED") return value
  throw new VehicleOperationValidationError("registrationKind", "registrationKind must be BASE or APPORTIONED.")
}

type ParsedRegistration = {
  registrationKind: RegistrationKind
  registrationDisplay: string | null
  registrationNormalized: string | null
  plateDisplay: string | null
  plateNormalized: string | null
  country: string
  region: string
  effectiveFrom: string
  effectiveTo: string | null
}

function parseRegistration(fields: RegistrationFields & { jurisdictionCountry: unknown; jurisdictionRegion: unknown; effectiveFrom: unknown }): ParsedRegistration {
  const registrationDisplay = optionalText(fields.registrationNumber, "registrationNumber", 40)
  const plateDisplay = optionalText(fields.plate, "plate", 20)
  const registrationNormalized = registrationDisplay ? normalizePlate(registrationDisplay) : null
  const plateNormalized = plateDisplay ? normalizePlate(plateDisplay) : null
  if (registrationDisplay && !registrationNormalized) throw new VehicleOperationValidationError("registrationNumber", "registrationNumber must contain letters or digits.")
  if (plateDisplay && !plateNormalized) throw new VehicleOperationValidationError("plate", "plate must contain letters or digits.")
  if (!registrationNormalized && !plateNormalized) throw new VehicleOperationValidationError("plate", "A plate or a registration number is required.")
  const country = parseCountryCode(fields.jurisdictionCountry, "jurisdictionCountry")
  const region = parseRegionCode(country, fields.jurisdictionRegion, "jurisdictionRegion")
  const effectiveFrom = parseDate(fields.effectiveFrom, "effectiveFrom")
  const effectiveTo = fields.effectiveTo === undefined || fields.effectiveTo === null || fields.effectiveTo === "" ? null : parseDate(fields.effectiveTo, "effectiveTo")
  if (effectiveTo !== null && effectiveTo <= effectiveFrom) throw new VehicleOperationValidationError("effectiveTo", "effectiveTo must be after effectiveFrom.")
  return { registrationKind: parseKind(fields.registrationKind), registrationDisplay, registrationNormalized, plateDisplay, plateNormalized, country, region, effectiveFrom, effectiveTo }
}

// ---------------------------------------------------------------------------------------------------------------
// Database error translation
// ---------------------------------------------------------------------------------------------------------------

function errorField(error: unknown, key: "code" | "constraint"): string | undefined {
  return typeof error === "object" && error !== null ? ((error as Record<string, string | undefined>)[key] ?? undefined) : undefined
}

/** Translates the documented database backstops into domain errors; domain errors pass through; anything else propagates. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof VehicleOperationError) throw error
    switch (errorField(error, "constraint")) {
      case "vehicle_registration_current_plate_uq":
        throw new VehicleOperationConflictError("That plate is already on a current registration in that jurisdiction.")
      case "vehicle_registration_current_kind_uq":
      case "vehicle_registration_periods_no_overlap":
        throw new VehicleOperationConflictError("A registration of this kind already covers those dates; change or correct it instead.")
      case "organization_vehicle_current_unit_uq":
        throw new VehicleOperationConflictError("That unit number is already used by another current vehicle of this company.")
      case "organization_vehicle_current_relationship_uq":
      case "organization_vehicle_relationships_no_overlap":
        throw new VehicleOperationConflictError("This company already has a current relationship of that type with the vehicle.")
      default:
        break
    }
    switch (errorField(error, "code")) {
      case "40P01":
      case "40001":
        throw new VehicleOperationConflictError("A concurrent change was made; retry the operation.")
      case "23514":
        throw new VehicleOperationStateError("The change is not permitted in the current state of the record.")
      case "23505":
      case "23P01":
        throw new VehicleOperationConflictError("A concurrent change was made; retry the operation.")
      default:
        throw error
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName = "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_CORRECTED" | "RECORD_ARCHIVED" | "RECORD_RESTORED"
type ResourceType = "vehicles" | "vehicle_registration_periods" | "organization_vehicle_relationships"

const literal = (value: string | null): { kind: "LITERAL"; value: string | null } => ({ kind: "LITERAL", value })
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({ kind: "REFERENCE", reference: `${table}:${id}` })

async function record(
  ctx: IdentityContext,
  eventType: EventTypeName,
  operation: string,
  target: { resourceType: ResourceType; resourceId: string; organizationId: string; vehicleId: string },
  fieldChanges: FieldChange[],
): Promise<void> {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: {
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      subjectReferences: [`organization:${target.organizationId}`, `vehicle:${target.vehicleId}`],
    },
    source: { sourceType: "APPLICATION", component: "operational-identity", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: { result: "SUCCESS" },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------------------------------------------

async function activeOrganization(ctx: IdentityContext, organizationId: string): Promise<void> {
  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new VehicleOperationNotFoundError("Company")
  if (organization.status !== "active") throw new VehicleOperationStateError("The company must be active.")
}

/** The vehicle must currently be on this company's record (any current relationship); otherwise it is "not found" for this company. */
async function lockedVehicleOfCompany(ctx: IdentityContext, organizationId: string, vehicleId: string, options: { requireActive: boolean }) {
  const vehicle = await lifecycle.lockVehicle(ctx.client, vehicleId)
  if (!vehicle) throw new VehicleOperationNotFoundError("Vehicle")
  const relationships = await lifecycle.currentRelationships(ctx.client, organizationId, vehicleId)
  if (relationships.length === 0) throw new VehicleOperationNotFoundError("Vehicle")
  if (vehicle.recordStatus === "merged") throw new VehicleOperationStateError("This vehicle has been merged into another vehicle record.")
  if (options.requireActive && vehicle.recordStatus !== "active") throw new VehicleOperationStateError("The vehicle is archived; restore it first.")
  return { vehicle, relationships }
}

async function scopedRegistration(ctx: IdentityContext, organizationId: string, registrationId: string) {
  const registration = await lifecycle.lockRegistration(ctx.client, registrationId)
  if (!registration || registration.organizationId !== organizationId) throw new VehicleOperationNotFoundError("Registration")
  if (registration.recordStatus !== "active") throw new VehicleOperationStateError("This registration has already been corrected or voided.")
  await lockedVehicleOfCompany(ctx, organizationId, registration.vehicleId, { requireActive: true })
  return registration
}

async function scopedRelationship(ctx: IdentityContext, organizationId: string, relationshipId: string) {
  const relationship = await lifecycle.lockRelationship(ctx.client, relationshipId)
  if (!relationship || relationship.organizationId !== organizationId) throw new VehicleOperationNotFoundError("Vehicle relationship")
  if (relationship.recordStatus !== "active" || relationship.effectiveTo !== null) throw new VehicleOperationStateError("This relationship has already ended or been corrected.")
  await lockedVehicleOfCompany(ctx, organizationId, relationship.vehicleId, { requireActive: true })
  return relationship
}

// ---------------------------------------------------------------------------------------------------------------
// Registration periods
// ---------------------------------------------------------------------------------------------------------------

export async function addVehicleRegistration(ctx: IdentityContext, input: AddRegistrationInput) {
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const vehicleId = parseUuid(input.vehicleId, "vehicleId")
  const parsed = parseRegistration(input)
  return guarded(async () => {
    await activeOrganization(ctx, organizationId)
    await lockedVehicleOfCompany(ctx, organizationId, vehicleId, { requireActive: true })
    const id = randomUUID()
    await lifecycle.insertRegistration(ctx.client, { id, vehicleId, organizationId, ...parsed })
    await record(ctx, "RECORD_CREATED", "VEHICLE_REGISTRATION_ADD", { resourceType: "vehicle_registration_periods", resourceId: id, organizationId, vehicleId }, [
      { field: "record", after: reference("vehicle_registration_periods", id) },
      { field: "record_status", after: literal("active") },
    ])
    return { registrationId: id }
  })
}

/** A real-world change (new plate / jurisdiction from a date): the current period ends on that date and a new one starts. */
export async function changeVehicleRegistration(ctx: IdentityContext, input: ChangeRegistrationInput) {
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const registrationId = parseUuid(input.registrationId, "registrationId")
  const parsed = parseRegistration({ ...input, effectiveTo: input.effectiveTo })
  return guarded(async () => {
    await activeOrganization(ctx, organizationId)
    const current = await scopedRegistration(ctx, organizationId, registrationId)
    if (current.effectiveTo !== null) throw new VehicleOperationStateError("Only the current registration can be changed; add a new period instead.")
    if (parsed.effectiveFrom <= current.effectiveFrom) throw new VehicleOperationValidationError("effectiveFrom", "The change must take effect after the current registration started.")
    const id = randomUUID()
    await lifecycle.endRegistration(ctx.client, current.id, parsed.effectiveFrom)
    await lifecycle.insertRegistration(ctx.client, { id, vehicleId: current.vehicleId, organizationId, ...parsed, registrationKind: input.registrationKind ? parsed.registrationKind : current.registrationKind })
    const target = { organizationId, vehicleId: current.vehicleId }
    await record(ctx, "RECORD_UPDATED", "VEHICLE_REGISTRATION_CHANGE", { resourceType: "vehicle_registration_periods", resourceId: current.id, ...target }, [
      { field: "effective_to", before: literal(null), after: literal("ended") },
    ])
    await record(ctx, "RECORD_CREATED", "VEHICLE_REGISTRATION_CHANGE", { resourceType: "vehicle_registration_periods", resourceId: id, ...target }, [
      { field: "record", after: reference("vehicle_registration_periods", id) },
      { field: "record_status", after: literal("active") },
    ])
    return { registrationId: id, previousRegistrationId: current.id }
  })
}

/** A mistaken value is corrected by supersession: the mistaken row is flagged `corrected` and kept; the replacement keeps the business period unless it is corrected too. */
export async function correctVehicleRegistration(ctx: IdentityContext, input: CorrectRegistrationInput) {
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const registrationId = parseUuid(input.registrationId, "registrationId")
  return guarded(async () => {
    await activeOrganization(ctx, organizationId)
    const mistaken = await scopedRegistration(ctx, organizationId, registrationId)
    const merged = {
      registrationKind: input.registrationKind ?? mistaken.registrationKind,
      registrationNumber: input.registrationNumber === undefined ? mistaken.registrationDisplay : input.registrationNumber,
      plate: input.plate === undefined ? mistaken.plateDisplay : input.plate,
      jurisdictionCountry: input.jurisdictionCountry ?? mistaken.country,
      jurisdictionRegion: input.jurisdictionRegion ?? mistaken.region,
      effectiveFrom: input.effectiveFrom ?? mistaken.effectiveFrom,
      effectiveTo: input.effectiveTo === undefined ? mistaken.effectiveTo : input.effectiveTo,
    }
    const parsed = parseRegistration(merged)
    const id = randomUUID()
    // Flag the mistaken row first so its unique/overlap constraints no longer apply, then insert the replacement (deferred foreign key).
    await lifecycle.supersedeRegistration(ctx.client, mistaken.id, id)
    await lifecycle.insertRegistration(ctx.client, { id, vehicleId: mistaken.vehicleId, organizationId, ...parsed })
    const target = { organizationId, vehicleId: mistaken.vehicleId }
    await record(ctx, "RECORD_CORRECTED", "VEHICLE_REGISTRATION_CORRECT", { resourceType: "vehicle_registration_periods", resourceId: mistaken.id, ...target }, [
      { field: "record_status", before: literal("active"), after: literal("corrected") },
      { field: "superseded_by", after: reference("vehicle_registration_periods", id) },
    ])
    await record(ctx, "RECORD_CREATED", "VEHICLE_REGISTRATION_CORRECT", { resourceType: "vehicle_registration_periods", resourceId: id, ...target }, [
      { field: "record", after: reference("vehicle_registration_periods", id) },
      { field: "record_status", after: literal("active") },
    ])
    return { registrationId: id, correctedRegistrationId: mistaken.id }
  })
}

/** A registration that should never have been recorded is voided (kept, flagged, no replacement). */
export async function voidVehicleRegistration(ctx: IdentityContext, input: VoidRegistrationInput) {
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const registrationId = parseUuid(input.registrationId, "registrationId")
  return guarded(async () => {
    await activeOrganization(ctx, organizationId)
    const registration = await scopedRegistration(ctx, organizationId, registrationId)
    await lifecycle.voidRegistration(ctx.client, registration.id)
    await record(ctx, "RECORD_CORRECTED", "VEHICLE_REGISTRATION_VOID", { resourceType: "vehicle_registration_periods", resourceId: registration.id, organizationId, vehicleId: registration.vehicleId }, [
      { field: "record_status", before: literal("active"), after: literal("voided") },
    ])
    return { registrationId: registration.id }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Vehicle archive / restore
// ---------------------------------------------------------------------------------------------------------------

/**
 * Archives the physical vehicle record. It is one global row, so it is refused while another company still has the vehicle
 * on its current record: this company's archive must never hide the vehicle from them.
 */
export async function archiveVehicle(ctx: IdentityContext, input: VehicleLifecycleInput) {
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const vehicleId = parseUuid(input.vehicleId, "vehicleId")
  return guarded(async () => {
    await activeOrganization(ctx, organizationId)
    const { vehicle } = await lockedVehicleOfCompany(ctx, organizationId, vehicleId, { requireActive: false })
    if (vehicle.recordStatus === "archived") throw new VehicleOperationStateError("The vehicle is already archived.")
    if ((await lifecycle.otherOrganizationsCurrentlyOnRecord(ctx.client, organizationId, vehicleId)) > 0) {
      throw new VehicleOperationStateError("Another company still has this vehicle on its current record, so it cannot be archived here.")
    }
    await lifecycle.setVehicleArchived(ctx.client, vehicleId)
    await record(ctx, "RECORD_ARCHIVED", "VEHICLE_ARCHIVE", { resourceType: "vehicles", resourceId: vehicleId, organizationId, vehicleId }, [
      { field: "record_status", before: literal("active"), after: literal("archived") },
    ])
    return { vehicleId, recordStatus: "archived" as const }
  })
}

export async function restoreVehicle(ctx: IdentityContext, input: VehicleLifecycleInput) {
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const vehicleId = parseUuid(input.vehicleId, "vehicleId")
  return guarded(async () => {
    await activeOrganization(ctx, organizationId)
    const { vehicle } = await lockedVehicleOfCompany(ctx, organizationId, vehicleId, { requireActive: false })
    if (vehicle.recordStatus !== "archived") throw new VehicleOperationStateError("Only an archived vehicle can be restored.")
    await lifecycle.setVehicleActive(ctx.client, vehicleId)
    await record(ctx, "RECORD_RESTORED", "VEHICLE_RESTORE", { resourceType: "vehicles", resourceId: vehicleId, organizationId, vehicleId }, [
      { field: "record_status", before: literal("archived"), after: literal("active") },
    ])
    return { vehicleId, recordStatus: "active" as const }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Relationship end / unit number
// ---------------------------------------------------------------------------------------------------------------

function parseInstant(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  throw new VehicleOperationValidationError(field, `${field} must be a valid date and time.`)
}

function parseUnit(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") {
    const unit = value.trim()
    if (unit.length > 40) throw new VehicleOperationValidationError("unitNumber", "unitNumber must be at most 40 characters.")
    return unit
  }
  throw new VehicleOperationValidationError("unitNumber", "unitNumber is required.")
}

/** Ends the company's current relationship with the vehicle (the row is kept with its end date). */
export async function endVehicleRelationship(ctx: IdentityContext, input: EndRelationshipInput) {
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const relationshipId = parseUuid(input.relationshipId, "relationshipId")
  const effectiveTo = input.effectiveTo === undefined ? new Date().toISOString() : parseInstant(input.effectiveTo, "effectiveTo")
  return guarded(async () => {
    await activeOrganization(ctx, organizationId)
    const relationship = await scopedRelationship(ctx, organizationId, relationshipId)
    if (new Date(effectiveTo).getTime() <= relationship.effectiveFrom.getTime()) {
      throw new VehicleOperationValidationError("effectiveTo", "The end must be after the relationship started.")
    }
    await lifecycle.endRelationship(ctx.client, relationship.id, effectiveTo)
    await record(ctx, "RECORD_UPDATED", "ORGANIZATION_VEHICLE_END", { resourceType: "organization_vehicle_relationships", resourceId: relationship.id, organizationId, vehicleId: relationship.vehicleId }, [
      { field: "effective_to", before: literal(null), after: literal("ended") },
    ])
    return { relationshipId: relationship.id }
  })
}

/** A real-world renumbering: the current relationship row ends now and a new row (same type) starts now with the new unit number. */
export async function changeVehicleUnitNumber(ctx: IdentityContext, input: UnitNumberInput) {
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const relationshipId = parseUuid(input.relationshipId, "relationshipId")
  const unit = parseUnit(input.unitNumber)
  return guarded(async () => {
    await activeOrganization(ctx, organizationId)
    const current = await scopedRelationship(ctx, organizationId, relationshipId)
    if (current.unitDisplay !== null && normalizeUnitNumber(current.unitDisplay) === normalizeUnitNumber(unit)) {
      throw new VehicleOperationStateError("The vehicle already has that unit number.")
    }
    const now = new Date().toISOString()
    if (new Date(now).getTime() <= current.effectiveFrom.getTime()) throw new VehicleOperationStateError("The relationship starts in the future; correct it instead.")
    const id = randomUUID()
    await lifecycle.endRelationship(ctx.client, current.id, now)
    await lifecycle.insertRelationship(ctx.client, { id, organizationId, vehicleId: current.vehicleId, relationshipType: current.relationshipType, unitDisplay: unit, unitNormalized: normalizeUnitNumber(unit), effectiveFrom: now, effectiveTo: null })
    await record(ctx, "RECORD_UPDATED", "ORGANIZATION_VEHICLE_UNIT_CHANGE", { resourceType: "organization_vehicle_relationships", resourceId: current.id, organizationId, vehicleId: current.vehicleId }, [
      { field: "effective_to", before: literal(null), after: literal("ended") },
    ])
    await record(ctx, "RECORD_CREATED", "ORGANIZATION_VEHICLE_UNIT_CHANGE", { resourceType: "organization_vehicle_relationships", resourceId: id, organizationId, vehicleId: current.vehicleId }, [
      { field: "record", after: reference("organization_vehicle_relationships", id) },
      { field: "record_status", after: literal("active") },
    ])
    return { relationshipId: id, previousRelationshipId: current.id }
  })
}

/** A mistyped unit number is corrected by supersession: the mistaken row is flagged `corrected`, the replacement has the same business start. */
export async function correctVehicleUnitNumber(ctx: IdentityContext, input: UnitNumberInput) {
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const relationshipId = parseUuid(input.relationshipId, "relationshipId")
  const unit = parseUnit(input.unitNumber)
  return guarded(async () => {
    await activeOrganization(ctx, organizationId)
    const mistaken = await scopedRelationship(ctx, organizationId, relationshipId)
    if (mistaken.unitDisplay !== null && mistaken.unitDisplay === unit) throw new VehicleOperationStateError("The unit number is already recorded exactly like that.")
    const id = randomUUID()
    await lifecycle.supersedeRelationship(ctx.client, mistaken.id, id)
    await lifecycle.insertRelationship(ctx.client, {
      id,
      organizationId,
      vehicleId: mistaken.vehicleId,
      relationshipType: mistaken.relationshipType,
      unitDisplay: unit,
      unitNormalized: normalizeUnitNumber(unit),
      effectiveFrom: mistaken.effectiveFrom.toISOString(),
      effectiveTo: null,
    })
    await record(ctx, "RECORD_CORRECTED", "ORGANIZATION_VEHICLE_UNIT_CORRECT", { resourceType: "organization_vehicle_relationships", resourceId: mistaken.id, organizationId, vehicleId: mistaken.vehicleId }, [
      { field: "record_status", before: literal("active"), after: literal("corrected") },
      { field: "superseded_by", after: reference("organization_vehicle_relationships", id) },
    ])
    await record(ctx, "RECORD_CREATED", "ORGANIZATION_VEHICLE_UNIT_CORRECT", { resourceType: "organization_vehicle_relationships", resourceId: id, organizationId, vehicleId: mistaken.vehicleId }, [
      { field: "record", after: reference("organization_vehicle_relationships", id) },
      { field: "record_status", after: literal("active") },
    ])
    return { relationshipId: id, correctedRelationshipId: mistaken.id }
  })
}
