/**
 * Organization Location domain operations.
 *
 * Every operation runs on the transaction client the authorization wrapper checked out and records its Master Register
 * event through a repository bound to that SAME client, so the business mutation and its accountability commit or roll
 * back together. Authorization has already happened when these run; the only capability evaluated here is the secondary
 * ORGANIZATION_REGISTRY_READ check (`canViewRegistry`, lazy, same client) that decides whether cross-Organization
 * information may be disclosed or a Location registry operation is permitted.
 *
 * Lock order (always): Organization row, then Location row, then dependent rows. A role change is serialized per
 * Organization by the Organization row lock; the partial unique indexes from migration 0012 are the final backstop.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  prepareAddress,
  sameAddressContent,
  type PreparedAddress,
} from "@/lib/organization-locations/address-normalization"
import {
  OrganizationLocationConflictError,
  OrganizationLocationNotFoundError,
  OrganizationLocationStateError,
  OrganizationLocationValidationError,
} from "@/lib/organization-locations/errors"
import * as repo from "@/lib/organization-locations/repository"
import {
  ASSIGNMENT_ROLES,
  LOCATION_KINDS,
  type AddressChangeResult,
  type AddressRecord,
  type AssignedLocation,
  type AssignLocationResult,
  type AssignmentRecord,
  type AssignmentRole,
  type CorrectAssignmentResult,
  type CreateLocationResult,
  type LocationKind,
  type LocationMatch,
  type LocationRecord,
  type OrganizationLocationsView,
} from "@/lib/organization-locations/types"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType, FieldChange } from "@/lib/master-register/types"

export type OperationContext = {
  client: PoolClient
  actor: { id: string; actorType: ActorType }
  /** Master Register repository bound to `client`. */
  masterRegister: MasterRegisterRepository
  /** Lazily decides whether this actor holds ORGANIZATION_REGISTRY_READ (same transaction, memoized). */
  canViewRegistry: () => Promise<boolean>
}

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

function requireObject(value: unknown, field: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OrganizationLocationValidationError(field, `${field} must be an object.`)
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new OrganizationLocationValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
    }
  }
  return value as Record<string, unknown>
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new OrganizationLocationValidationError(field, `${field} must be a UUID.`)
}

function parseRole(value: unknown, field: string): AssignmentRole {
  if (typeof value === "string" && (ASSIGNMENT_ROLES as readonly string[]).includes(value)) return value as AssignmentRole
  throw new OrganizationLocationValidationError(field, `${field} must be one of ${ASSIGNMENT_ROLES.join(", ")}.`)
}

function parseKind(value: unknown, field: string): LocationKind {
  if (typeof value === "string" && (LOCATION_KINDS as readonly string[]).includes(value)) return value as LocationKind
  throw new OrganizationLocationValidationError(field, `${field} must be one of ${LOCATION_KINDS.join(", ")}.`)
}

/** An explicit business instant: an ISO-8601 string with an offset. Returned as a canonical UTC string. */
function parseInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    throw new OrganizationLocationValidationError(field, `${field} must be an ISO-8601 instant with a time zone.`)
  }
  const date = new Date(value.trim())
  if (Number.isNaN(date.getTime())) {
    throw new OrganizationLocationValidationError(field, `${field} is not a valid instant.`)
  }
  return date.toISOString()
}

/** ISO instant at microsecond width so string comparison matches database ordering. */
const toMicro = (iso: string): string => (/\.\d{3}Z$/.test(iso) ? iso.replace(/Z$/, "000Z") : iso)

type AssignmentRequestParsed = { organizationId: string; role: AssignmentRole; effectiveFrom: string | null }

function parseAssignmentRequest(value: unknown, field: string, extraKeys: readonly string[] = []): Record<string, unknown> & AssignmentRequestParsed {
  const object = requireObject(value, field, ["organizationId", "role", "effectiveFrom", ...extraKeys])
  return {
    ...object,
    organizationId: parseUuid(object.organizationId, `${field}.organizationId`),
    role: parseRole(object.role, `${field}.role`),
    effectiveFrom: object.effectiveFrom === undefined ? null : parseInstant(object.effectiveFrom, `${field}.effectiveFrom`),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Database error translation
// ---------------------------------------------------------------------------------------------------------------

function constraintOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? ((error as { constraint?: string }).constraint ?? undefined) : undefined
}

/** Translates the documented database backstops into domain errors; anything else propagates unchanged. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    switch (constraintOf(error)) {
      case repo.CURRENT_ROLE_CONSTRAINT:
      case repo.CURRENT_ADDRESS_CONSTRAINT:
        throw new OrganizationLocationConflictError("A concurrent change was made; retry the operation.")
      case repo.ARCHIVE_BLOCKED_CONSTRAINT:
        throw new OrganizationLocationStateError("A Location with a current Organization assignment cannot be archived.")
      case repo.LOCATION_NOT_ACTIVE_CONSTRAINT:
        throw new OrganizationLocationStateError("An assignment must reference an active Location.")
      case repo.ASSIGNMENT_WINDOW_CONSTRAINT:
      case repo.ADDRESS_WINDOW_CONSTRAINT:
        throw new OrganizationLocationValidationError("effectiveFrom", "The effective date must be after the current record began.")
      default:
        throw error
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName =
  | "RECORD_CREATED"
  | "RECORD_UPDATED"
  | "RECORD_CORRECTED"
  | "RECORD_ARCHIVED"
  | "RECORD_RESTORED"
  | "RECORD_LINK_ESTABLISHED"
  | "RECORD_LINK_REMOVED"

const literal = (value: string | number | boolean | null): { kind: "LITERAL"; value: string | number | boolean | null } => ({
  kind: "LITERAL",
  value,
})
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({
  kind: "REFERENCE",
  reference: `${table}:${id}`,
})

/**
 * Address text is never copied into the Master Register: events reference the location_addresses / locations /
 * organization_location_assignments rows, which are the record of what the address was.
 */
async function record(
  ctx: OperationContext,
  eventType: EventTypeName,
  operation: string,
  target: { resourceType: string; resourceId: string; subjectReferences: string[] },
  fieldChanges: FieldChange[],
): Promise<void> {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target,
    source: { sourceType: "APPLICATION", component: "organization-locations", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: { result: "SUCCESS" },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------------------------

const toLocationRecord = (core: repo.LocationCore, currentAddress: AddressRecord | null): LocationRecord => ({
  ...core,
  currentAddress,
})

async function lockActiveOrganization(ctx: OperationContext, organizationId: string): Promise<void> {
  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new OrganizationLocationNotFoundError("Organization")
  if (organization.status !== "active") {
    throw new OrganizationLocationStateError(
      organization.status === "merged"
        ? "This Organization has been merged; its locations can no longer be changed."
        : "This Organization is archived; restore it before changing its locations.",
    )
  }
}

/** The effective instant for a new fact: the caller's backdated value (never in the future) or the database clock. */
async function resolveInstant(ctx: OperationContext, explicit: string | null, field: string): Promise<string> {
  if (explicit === null) return repo.databaseNow(ctx.client)
  if (!(await repo.isNotInFuture(ctx.client, explicit))) {
    throw new OrganizationLocationValidationError(field, `${field} cannot be in the future.`)
  }
  return explicit
}

async function buildMatches(client: PoolClient, address: PreparedAddress, excludeLocationId: string | null): Promise<LocationMatch[]> {
  const found = await repo.findBuildingMatches(client, address, excludeLocationId)
  const matches: LocationMatch[] = []
  for (const item of found) {
    matches.push({
      location: toLocationRecord(item.location, item.currentAddress),
      buildingMatch: true,
      unitMatch: item.unitMatch,
      currentOrganizationIds: await repo.currentOrganizationIdsAt(client, item.location.id),
    })
  }
  return matches
}

type Placement = { assignment: AssignmentRecord; endedAssignment: AssignmentRecord | null }

/**
 * Makes `location` the Organization's current location for `role` from `effectiveFrom`: ends the current assignment of that
 * role (if any) and starts the new one, with both Master Register link events, inside the caller's transaction.
 */
async function placeAssignment(
  ctx: OperationContext,
  request: { organizationId: string; role: AssignmentRole; location: repo.LocationCore; at: string },
): Promise<Placement> {
  const { organizationId, role, location, at } = request

  if (location.status !== "active") throw new OrganizationLocationStateError("An archived Location cannot be assigned.")
  if (role === "HOME_YARD" && location.kind !== "PHYSICAL") {
    throw new OrganizationLocationValidationError("role", "A Home Yard must be a PHYSICAL Location.")
  }

  const current = await repo.getCurrentAssignment(ctx.client, organizationId, role, true)
  if (current && current.locationId === location.id) {
    throw new OrganizationLocationStateError("This Location is already the Organization's current assignment for that role.")
  }

  let endedAssignment: AssignmentRecord | null = null
  if (current) {
    await guarded(() => repo.endAssignmentRow(ctx.client, current.id, at, "CHANGED"))
    endedAssignment = { ...current, effectiveTo: at, endReason: "CHANGED" }
    await record(
      ctx,
      "RECORD_LINK_REMOVED",
      "changeAssignment",
      {
        resourceType: "organization_location_assignment",
        resourceId: current.id,
        subjectReferences: [`organization:${organizationId}`, `location:${current.locationId}`],
      },
      [
        { field: "role", before: literal(role) },
        { field: "location", before: reference("locations", current.locationId) },
        { field: "effectiveTo", after: literal(at) },
        { field: "endReason", after: literal("CHANGED") },
      ],
    )
  }

  const assignment = await guarded(() =>
    repo.insertAssignment(ctx.client, { organizationId, locationId: location.id, locationKind: location.kind, role, effectiveFrom: at }),
  )
  await record(
    ctx,
    "RECORD_LINK_ESTABLISHED",
    "assignLocation",
    {
      resourceType: "organization_location_assignment",
      resourceId: assignment.id,
      subjectReferences: [`organization:${organizationId}`, `location:${location.id}`],
    },
    [
      { field: "role", after: literal(role) },
      { field: "location", after: reference("locations", location.id) },
      { field: "effectiveFrom", after: literal(at) },
    ],
  )

  return { assignment, endedAssignment }
}

// ---------------------------------------------------------------------------------------------------------------
// create Location (+ initial address, + optional initial assignment)
// ---------------------------------------------------------------------------------------------------------------

/** Creates a Location and its INITIAL address version (true from `at`) and records RECORD_CREATED. */
async function insertNewLocation(
  ctx: OperationContext,
  kind: LocationKind,
  address: PreparedAddress,
  at: string,
): Promise<{ core: repo.LocationCore; initial: AddressRecord }> {
  const locationId = await repo.insertLocation(ctx.client, kind)
  const initial = await repo.insertAddressVersion(ctx.client, {
    id: randomUUID(),
    locationId,
    address,
    versionReason: "INITIAL",
    effectiveFrom: at,
  })
  await record(
    ctx,
    "RECORD_CREATED",
    "createLocation",
    { resourceType: "location", resourceId: locationId, subjectReferences: [] },
    [
      { field: "kind", after: literal(kind) },
      { field: "address", after: reference("location_addresses", initial.id) },
    ],
  )
  const core = await repo.getLocation(ctx.client, locationId)
  if (!core) throw new OrganizationLocationNotFoundError()
  return { core, initial }
}

export async function createLocation(ctx: OperationContext, rawInput: unknown): Promise<CreateLocationResult> {
  const input = requireObject(rawInput, "input", ["kind", "address", "assignment"])
  const kind = parseKind(input.kind, "kind")
  const address = prepareAddress(input.address, "address")
  const request = input.assignment === undefined ? null : parseAssignmentRequest(input.assignment, "assignment")
  if (request && request.role === "HOME_YARD" && kind !== "PHYSICAL") {
    throw new OrganizationLocationValidationError("assignment.role", "A Home Yard must be a PHYSICAL Location.")
  }

  // Advisory only, and only for callers who may see the registry. Nothing is reused automatically.
  const matches = (await ctx.canViewRegistry()) ? await buildMatches(ctx.client, address, null) : []

  if (request) await lockActiveOrganization(ctx, request.organizationId)

  // The initial address is true from the assignment's business time when one is given, else from now.
  const at = await resolveInstant(ctx, request?.effectiveFrom ?? null, "assignment.effectiveFrom")

  const { core, initial } = await insertNewLocation(ctx, kind, address, at)

  const placement = request ? await placeAssignment(ctx, { organizationId: request.organizationId, role: request.role, location: core, at }) : null

  return {
    location: toLocationRecord(core, initial),
    assignment: placement?.assignment ?? null,
    endedAssignment: placement?.endedAssignment ?? null,
    matches,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// explicit reuse: assign an existing Location
// ---------------------------------------------------------------------------------------------------------------

export async function assignLocation(ctx: OperationContext, rawInput: unknown): Promise<AssignLocationResult> {
  const input = parseAssignmentRequest(rawInput, "input", ["locationId"])
  const locationId = parseUuid(input.locationId, "locationId")

  await lockActiveOrganization(ctx, input.organizationId)

  const location = await repo.getLocation(ctx.client, locationId)
  // A Location is visible for reuse when the caller can read the registry, or when this very Organization has used it
  // before (for example returning to a former yard). Otherwise it looks exactly like a Location that does not exist.
  const visible =
    location !== undefined &&
    ((await repo.organizationHasUsedLocation(ctx.client, input.organizationId, locationId, false)) || (await ctx.canViewRegistry()))
  if (!location || !visible) throw new OrganizationLocationNotFoundError()

  const at = await resolveInstant(ctx, input.effectiveFrom, "effectiveFrom")
  return placeAssignment(ctx, { organizationId: input.organizationId, role: input.role, location, at })
}

// ---------------------------------------------------------------------------------------------------------------
// correct an assignment (NOT a real-world transition)
// ---------------------------------------------------------------------------------------------------------------

/**
 * CORRECTION. The assignment was recorded wrongly. It is preserved but flagged 'corrected' and pointed at its
 * replacement; it is NOT ended, so no CHANGED / CEASED lifecycle event is invented, and current / as-of reads never treat it
 * as genuine history. The replacement keeps the Organization and role and inherits the business time (effective_from, and
 * effective_to / end_reason when the corrected assignment had already ended). created_at is the real insertion time.
 * One RECORD_CORRECTED event records it; no link event is written, because nothing really started or stopped.
 */
export async function correctAssignment(ctx: OperationContext, rawInput: unknown): Promise<CorrectAssignmentResult> {
  const input = requireObject(rawInput, "input", ["organizationId", "assignmentId", "locationId", "location"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const assignmentId = parseUuid(input.assignmentId, "assignmentId")
  if ((input.locationId === undefined) === (input.location === undefined)) {
    throw new OrganizationLocationValidationError("input", "Supply exactly one of locationId or location.")
  }
  const requestedLocationId = input.locationId === undefined ? null : parseUuid(input.locationId, "locationId")
  let newLocation: { kind: LocationKind; address: PreparedAddress } | null = null
  if (input.location !== undefined) {
    const object = requireObject(input.location, "location", ["kind", "address"])
    newLocation = { kind: parseKind(object.kind, "location.kind"), address: prepareAddress(object.address, "location.address") }
  }

  await lockActiveOrganization(ctx, organizationId)

  const wrong = await repo.getAssignment(ctx.client, organizationId, assignmentId, true)
  if (!wrong) throw new OrganizationLocationNotFoundError("Assignment")
  if (wrong.status !== "active") throw new OrganizationLocationStateError("This assignment has already been corrected.")
  if (wrong.role === "HOME_YARD" && newLocation && newLocation.kind !== "PHYSICAL") {
    throw new OrganizationLocationValidationError("location.kind", "A Home Yard must be a PHYSICAL Location.")
  }

  let target: repo.LocationCore
  let createdLocation: LocationRecord | null = null
  if (requestedLocationId !== null) {
    if (requestedLocationId === wrong.locationId) {
      throw new OrganizationLocationStateError("The assignment already references that Location; nothing to correct.")
    }
    const found = await repo.getLocation(ctx.client, requestedLocationId)
    // Same visibility rule as explicit reuse: the caller can read the registry, or this Organization has genuinely used it.
    const visible =
      found !== undefined &&
      ((await repo.organizationHasUsedLocation(ctx.client, organizationId, requestedLocationId, false)) || (await ctx.canViewRegistry()))
    if (!found || !visible) throw new OrganizationLocationNotFoundError()
    target = found
  } else {
    const created = await insertNewLocation(ctx, (newLocation as NonNullable<typeof newLocation>).kind, (newLocation as NonNullable<typeof newLocation>).address, wrong.effectiveFrom)
    target = created.core
    createdLocation = toLocationRecord(created.core, created.initial)
  }

  if (target.status !== "active") throw new OrganizationLocationStateError("An archived Location cannot be assigned.")
  if (wrong.role === "HOME_YARD" && target.kind !== "PHYSICAL") {
    throw new OrganizationLocationValidationError("locationId", "A Home Yard must be a PHYSICAL Location.")
  }

  const replacementId = randomUUID()
  await guarded(() => repo.markAssignmentCorrected(ctx.client, wrong.id, replacementId))
  const replacement = await guarded(() =>
    repo.insertAssignment(ctx.client, {
      id: replacementId,
      organizationId,
      locationId: target.id,
      locationKind: target.kind,
      role: wrong.role,
      effectiveFrom: wrong.effectiveFrom,
      effectiveTo: wrong.effectiveTo,
      endReason: wrong.endReason,
    }),
  )
  await record(
    ctx,
    "RECORD_CORRECTED",
    "correctAssignment",
    {
      resourceType: "organization_location_assignment",
      resourceId: replacement.id,
      subjectReferences: [`organization:${organizationId}`, `location:${target.id}`, `location:${wrong.locationId}`],
    },
    [
      { field: "role", after: literal(wrong.role) },
      {
        field: "assignment",
        before: reference("organization_location_assignments", wrong.id),
        after: reference("organization_location_assignments", replacement.id),
      },
      { field: "location", before: reference("locations", wrong.locationId), after: reference("locations", target.id) },
    ],
  )

  const correctedAssignment = (await repo.getAssignment(ctx.client, organizationId, wrong.id)) as AssignmentRecord
  return { correctedAssignment, assignment: replacement, createdLocation }
}

// ---------------------------------------------------------------------------------------------------------------
// end an assignment
// ---------------------------------------------------------------------------------------------------------------

export async function endAssignment(ctx: OperationContext, rawInput: unknown): Promise<AssignmentRecord> {
  const input = requireObject(rawInput, "input", ["organizationId", "role", "effectiveTo"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const role = parseRole(input.role, "role")
  const explicit = input.effectiveTo === undefined ? null : parseInstant(input.effectiveTo, "effectiveTo")

  await lockActiveOrganization(ctx, organizationId)
  const current = await repo.getCurrentAssignment(ctx.client, organizationId, role, true)
  if (!current) throw new OrganizationLocationNotFoundError("Assignment")

  const at = await resolveInstant(ctx, explicit, "effectiveTo")
  await guarded(() => repo.endAssignmentRow(ctx.client, current.id, at, "CEASED"))
  await record(
    ctx,
    "RECORD_LINK_REMOVED",
    "endAssignment",
    {
      resourceType: "organization_location_assignment",
      resourceId: current.id,
      subjectReferences: [`organization:${organizationId}`, `location:${current.locationId}`],
    },
    [
      { field: "role", before: literal(role) },
      { field: "location", before: reference("locations", current.locationId) },
      { field: "effectiveTo", after: literal(at) },
      { field: "endReason", after: literal("CEASED") },
    ],
  )
  return { ...current, effectiveTo: at, endReason: "CEASED" }
}

// ---------------------------------------------------------------------------------------------------------------
// address revisions: real-world change vs correction
// ---------------------------------------------------------------------------------------------------------------

type Revision = {
  organizationId: string | null
  location: repo.LocationCore
  current: AddressRecord
  address: PreparedAddress
  usedByOtherOrganizations: boolean | undefined
  explicitInstant: string | null
}

/**
 * Shared preparation for a change or a correction. A caller revises a Location's address on behalf of an Organization
 * that currently uses it; only a registry reader may revise a Location without naming one. Any other caller sees "not
 * found", never the existence of a Location it has no relationship to.
 */
async function prepareRevision(ctx: OperationContext, rawInput: unknown, allowEffectiveFrom: boolean): Promise<Revision> {
  const input = requireObject(rawInput, "input", ["organizationId", "locationId", "address", ...(allowEffectiveFrom ? ["effectiveFrom"] : [])])
  const organizationId = input.organizationId === undefined ? null : parseUuid(input.organizationId, "organizationId")
  const locationId = parseUuid(input.locationId, "locationId")
  const address = prepareAddress(input.address, "address")
  const explicitInstant = input.effectiveFrom === undefined ? null : parseInstant(input.effectiveFrom, "effectiveFrom")

  if (organizationId) await lockActiveOrganization(ctx, organizationId)

  const location = await repo.getLocation(ctx.client, locationId, "update")
  const related = location !== undefined && organizationId !== null && (await repo.organizationHasUsedLocation(ctx.client, organizationId, locationId, true))
  const visible = related || (location !== undefined && (await ctx.canViewRegistry()))
  if (!location || !visible) throw new OrganizationLocationNotFoundError()
  if (location.status !== "active") throw new OrganizationLocationStateError("An archived Location's address cannot be revised.")

  const current = await repo.getCurrentAddress(ctx.client, locationId, true)
  if (!current) throw new OrganizationLocationNotFoundError("Address")

  const currentPrepared = prepareAddress(
    {
      country: current.country,
      region: current.region,
      locality: current.locality,
      postalCode: current.postalCode,
      addressLine1: current.addressLine1,
      addressLine2: current.addressLine2,
      unit: current.unit,
    },
    "address",
  )
  if (sameAddressContent(currentPrepared, address)) {
    throw new OrganizationLocationValidationError("address", "The address is unchanged.")
  }

  let usedByOtherOrganizations: boolean | undefined
  if (await ctx.canViewRegistry()) {
    const organizations = await repo.currentOrganizationIdsAt(ctx.client, locationId)
    usedByOtherOrganizations = organizations.some((id) => id !== organizationId)
  }

  return { organizationId, location, current, address, usedByOtherOrganizations, explicitInstant }
}

/**
 * REAL-WORLD CHANGE. The previous address was true until T and the new one became true at T: the old version stays
 * 'active' with effective_to = T, and both are genuine business history. Applies to everyone using the Location.
 */
export async function changeLocationAddress(ctx: OperationContext, rawInput: unknown): Promise<AddressChangeResult> {
  const revision = await prepareRevision(ctx, rawInput, true)
  const at = await resolveInstant(ctx, revision.explicitInstant, "effectiveFrom")

  await guarded(() => repo.endAddressVersion(ctx.client, revision.current.id, at))
  const replacement = await guarded(() =>
    repo.insertAddressVersion(ctx.client, {
      id: randomUUID(),
      locationId: revision.location.id,
      address: revision.address,
      versionReason: "POSTAL_CHANGE",
      effectiveFrom: at,
    }),
  )
  await record(
    ctx,
    "RECORD_UPDATED",
    "changeLocationAddress",
    { resourceType: "location_address", resourceId: replacement.id, subjectReferences: [`location:${revision.location.id}`] },
    [
      {
        field: "address",
        before: reference("location_addresses", revision.current.id),
        after: reference("location_addresses", replacement.id),
      },
      { field: "effectiveFrom", after: literal(at) },
    ],
  )
  return { address: replacement, usedByOtherOrganizations: revision.usedByOtherOrganizations }
}

/**
 * CORRECTION. The recorded address was wrong. The wrong version is preserved but flagged 'corrected' and pointed at its
 * replacement; it is never reported as genuine history. The replacement inherits the business time the address was
 * recorded as holding (effective_from of the version it corrects). Applies to everyone using the Location.
 */
export async function correctLocationAddress(ctx: OperationContext, rawInput: unknown): Promise<AddressChangeResult> {
  const revision = await prepareRevision(ctx, rawInput, false)
  const replacementId = randomUUID()

  await guarded(() => repo.markAddressCorrected(ctx.client, revision.current.id, replacementId))
  const replacement = await guarded(() =>
    repo.insertAddressVersion(ctx.client, {
      id: replacementId,
      locationId: revision.location.id,
      address: revision.address,
      versionReason: "CORRECTION",
      effectiveFrom: revision.current.effectiveFrom,
    }),
  )
  await record(
    ctx,
    "RECORD_CORRECTED",
    "correctLocationAddress",
    { resourceType: "location_address", resourceId: replacement.id, subjectReferences: [`location:${revision.location.id}`] },
    [
      {
        field: "address",
        before: reference("location_addresses", revision.current.id),
        after: reference("location_addresses", replacement.id),
      },
    ],
  )
  return { address: replacement, usedByOtherOrganizations: revision.usedByOtherOrganizations }
}

// ---------------------------------------------------------------------------------------------------------------
// archive / restore a Location (registry operations)
// ---------------------------------------------------------------------------------------------------------------

async function lockRegistryLocation(ctx: OperationContext, rawLocationId: unknown): Promise<repo.LocationCore> {
  const locationId = parseUuid(rawLocationId, "locationId")
  const location = await repo.getLocation(ctx.client, locationId, "update")
  if (!location || !(await ctx.canViewRegistry())) throw new OrganizationLocationNotFoundError()
  return location
}

export async function archiveLocation(ctx: OperationContext, locationId: string): Promise<LocationRecord> {
  const location = await lockRegistryLocation(ctx, locationId)
  if (location.status !== "active") throw new OrganizationLocationStateError("This Location is already archived.")
  await guarded(() => repo.setLocationStatus(ctx.client, location.id, "archived"))
  await record(
    ctx,
    "RECORD_ARCHIVED",
    "archiveLocation",
    { resourceType: "location", resourceId: location.id, subjectReferences: [] },
    [{ field: "status", before: literal("active"), after: literal("archived") }],
  )
  const updated = (await repo.getLocation(ctx.client, location.id)) as repo.LocationCore
  return toLocationRecord(updated, (await repo.getCurrentAddress(ctx.client, location.id)) ?? null)
}

export async function restoreLocation(ctx: OperationContext, locationId: string): Promise<LocationRecord> {
  const location = await lockRegistryLocation(ctx, locationId)
  if (location.status !== "archived") throw new OrganizationLocationStateError("Only an archived Location can be restored.")
  await repo.setLocationStatus(ctx.client, location.id, "active")
  await record(
    ctx,
    "RECORD_RESTORED",
    "restoreLocation",
    { resourceType: "location", resourceId: location.id, subjectReferences: [] },
    [{ field: "status", before: literal("archived"), after: literal("active") }],
  )
  const updated = (await repo.getLocation(ctx.client, location.id)) as repo.LocationCore
  return toLocationRecord(updated, (await repo.getCurrentAddress(ctx.client, location.id)) ?? null)
}

// ---------------------------------------------------------------------------------------------------------------
// reads (never write a Master Register event)
// ---------------------------------------------------------------------------------------------------------------

/** SYSTEM registry lookup: advisory building-level matches for an address. */
export async function findLocationMatches(client: PoolClient, rawAddress: unknown): Promise<LocationMatch[]> {
  const address = prepareAddress(rawAddress, "address")
  return buildMatches(client, address, null)
}

const emptyRoles = (): Record<AssignmentRole, AssignedLocation | null> => ({ REGISTERED: null, MAILING: null, HOME_YARD: null })

/**
 * One Organization's locations: what is true now, optionally what was true at an instant, and the full assignment
 * history. Corrected address versions appear only in `versions` and corrected assignments only in `history` (both flagged
 * status = 'corrected'); `current`, `asOf` and every address answer come from genuine ('active') rows only. Reads only the
 * named Organization's assignments.
 */
export async function readOrganizationLocations(
  client: PoolClient,
  organizationId: string,
  options: { asOf?: string } = {},
): Promise<OrganizationLocationsView> {
  const id = parseUuid(organizationId, "organizationId")
  const exists = await client.query(`SELECT 1 FROM public.organizations WHERE id = $1`, [id])
  if (exists.rowCount === 0) throw new OrganizationLocationNotFoundError("Organization")
  const asOf = options.asOf === undefined ? null : parseInstant(options.asOf, "asOf")

  const assignments = await repo.listAssignments(client, id)
  const locationIds = [...new Set(assignments.map((assignment) => assignment.locationId))]
  const locations = await repo.getLocationsByIds(client, locationIds)
  const versions = await repo.listAddressVersions(client, locationIds)

  const assemble = async (assignment: AssignmentRecord, at: string | null): Promise<AssignedLocation> => {
    const location = locations.get(assignment.locationId) as repo.LocationCore
    const all = versions.get(assignment.locationId) ?? []
    const address =
      at === null
        ? (all.find((version) => version.status === "active" && version.effectiveTo === null) ?? null)
        : ((await repo.getAddressAsOf(client, assignment.locationId, at)) ?? null)
    return { assignment, location, address, versions: all }
  }

  const current = emptyRoles()
  for (const assignment of assignments) {
    if (assignment.status === "active" && assignment.effectiveTo === null) current[assignment.role] = await assemble(assignment, null)
  }

  let asOfView: OrganizationLocationsView["asOf"] = null
  if (asOf !== null) {
    const at = toMicro(asOf)
    const roles = emptyRoles()
    for (const assignment of assignments) {
      if (assignment.status === "active" && assignment.effectiveFrom <= at && (assignment.effectiveTo === null || at < assignment.effectiveTo)) {
        roles[assignment.role] = await assemble(assignment, asOf)
      }
    }
    asOfView = { at: asOf, assignments: roles }
  }

  const history: AssignedLocation[] = []
  for (const assignment of assignments) {
    const location = locations.get(assignment.locationId) as repo.LocationCore
    history.push({ assignment, location, address: null, versions: versions.get(assignment.locationId) ?? [] })
  }

  return { organizationId: id, current, asOf: asOfView, history }
}
