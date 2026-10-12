/**
 * Vehicle merge and reversal operations.
 *
 * Every operation runs on the transaction client the authorization wrapper checked out and records its Master Register
 * events through a repository bound to that SAME client, so the business mutation and its accountability commit or roll
 * back together. Authorization has already happened when these run; the only capability evaluated here is the secondary
 * VEHICLE_READ check (`canReadVehicles`, lazy, same client, memoized) that decides whether a VIN collision may name the
 * vehicle holding the identifier.
 *
 * Merge semantics (alias / supersession, never a rewrite):
 *   - the merged vehicle becomes record_status 'merged' with merged_into_vehicle_id = the survivor, and the ledger row
 *     (vehicle_merges) records why and when; both change in ONE transaction and the deferred consistency triggers of
 *     migration 0026 verify at commit that they agree;
 *   - NOTHING is copied, overwritten or deleted: the survivor keeps its own identifiers, the merged vehicle keeps its VIN
 *     (it only leaves the current VIN namespace, because migration 0020's unique index ignores merged vehicles), and two
 *     different non-null VINs are allowed, they were distinct identifiers of one physical vehicle;
 *   - organization relationships, registration periods, insurance schedules and every other record stay attached to the
 *     vehicle that earned them. Readers of other domains that want "the vehicle as it stands today" call resolveVehicle
 *     and follow it to the surviving vehicle; no foreign key is rewritten.
 *
 * Reversal returns the merged vehicle to 'active'. It fails as a VIN collision when the VIN was taken since, and it is
 * refused while the survivor is itself merged away (the later merge is reversed first).
 *
 * Lock order (always): vehicle rows in uuid order, then the ledger row. Reversal reads the ledger row once without a lock
 * only to learn which vehicles to lock, then re-reads it under lock.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType, FieldChange } from "@/lib/master-register/types"
import { MAX_RESOLUTION_HOPS, MERGE_REASONS, isMergeReason, type MergeReason } from "@/lib/vehicle-merges/definitions"
import {
  VehicleMergeConflictError,
  VehicleMergeError,
  VehicleMergeNotFoundError,
  VehicleMergeStateError,
  VehicleMergeValidationError,
  VehicleVinCollisionError,
} from "@/lib/vehicle-merges/errors"
import * as repo from "@/lib/vehicle-merges/repository"
import type {
  MergeVehiclesInput,
  ReverseVehicleMergeInput,
  VehicleMergeHistory,
  VehicleMergeResult,
  VehicleResolution,
} from "@/lib/vehicle-merges/types"

export type OperationContext = {
  client: PoolClient
  actor: { id: string; actorType: ActorType }
  /** Master Register repository bound to `client`. */
  masterRegister: MasterRegisterRepository
  /** Lazily decides whether this actor also holds VEHICLE_READ (same transaction, memoized). */
  canReadVehicles: () => Promise<boolean>
}

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

function requireObject(value: unknown, field: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VehicleMergeValidationError(field, `${field} must be an object.`)
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new VehicleMergeValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
    }
  }
  return value as Record<string, unknown>
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new VehicleMergeValidationError(field, `${field} must be a UUID.`)
}

function parseReason(value: unknown): MergeReason {
  if (isMergeReason(value)) return value
  throw new VehicleMergeValidationError("reason", `reason must be one of ${MERGE_REASONS.join(", ")}.`)
}

function parseMergeInput(input: unknown): MergeVehiclesInput {
  const object = requireObject(input, "input", ["survivorId", "mergedId", "reason"])
  const survivorId = parseUuid(object.survivorId, "survivorId")
  const mergedId = parseUuid(object.mergedId, "mergedId")
  const reason = parseReason(object.reason)
  if (survivorId === mergedId) {
    throw new VehicleMergeValidationError("mergedId", "A vehicle cannot be merged into itself.")
  }
  return { survivorId, mergedId, reason }
}

function parseReverseInput(input: unknown): ReverseVehicleMergeInput {
  const object = requireObject(input, "input", ["mergeId"])
  return { mergeId: parseUuid(object.mergeId, "mergeId") }
}

// ---------------------------------------------------------------------------------------------------------------
// Database error translation
// ---------------------------------------------------------------------------------------------------------------

function errorField(error: unknown, key: "code" | "constraint"): string | undefined {
  return typeof error === "object" && error !== null ? ((error as Record<string, string | undefined>)[key] ?? undefined) : undefined
}

/**
 * Translates the documented database backstops into domain errors; anything else propagates unchanged. Domain errors
 * never carry database text.
 */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof VehicleMergeError) throw error
    switch (errorField(error, "constraint")) {
      case repo.ACTIVE_SOURCE_CONSTRAINT:
        throw new VehicleMergeStateError("This vehicle has already been merged into another vehicle.")
      case repo.BOTH_ACTIVE_CONSTRAINT:
        throw new VehicleMergeStateError("Both vehicles of a merge must be active.")
      case repo.SURVIVOR_NOT_MERGED_CONSTRAINT:
        throw new VehicleMergeStateError("The surviving vehicle has itself been merged away; reverse that merge first.")
      case repo.MERGED_STATE_CONSTRAINT:
        throw new VehicleMergeStateError("The vehicle state and its merge record disagree.")
      default:
        break
    }
    switch (errorField(error, "code")) {
      case "40P01":
      case "40001":
        throw new VehicleMergeConflictError("A concurrent change was made; retry the operation.")
      case "55000":
      case "23514":
        throw new VehicleMergeStateError("The merge is not permitted in the current state of the vehicles.")
      case "23505":
        throw new VehicleMergeConflictError("A concurrent change was made; retry the operation.")
      default:
        throw error
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName = "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_STATUS_CHANGED"

const literal = (value: string | null): { kind: "LITERAL"; value: string | null } => ({ kind: "LITERAL", value })
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({
  kind: "REFERENCE",
  reference: `${table}:${id}`,
})

/**
 * Identifiers (VIN, plate, unit number) and dates never reach the Master Register: events reference the vehicles and the
 * ledger row, which are the record of what they were. Status words are small controlled vocabulary.
 */
async function record(
  ctx: OperationContext,
  eventType: EventTypeName,
  operation: string,
  target: { resourceType: "vehicles" | "vehicle_merges"; resourceId: string; vehicleIds: readonly string[] },
  fieldChanges: FieldChange[],
): Promise<void> {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: {
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      subjectReferences: target.vehicleIds.map((id) => `vehicle:${id}`),
    },
    source: { sourceType: "APPLICATION", component: "vehicle-merges", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: { result: "SUCCESS" },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Reads (VEHICLE_READ)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The vehicle that stands for `vehicleId` today: the vehicle itself unless it was merged away, otherwise the surviving
 * vehicle at the end of the merged_into_vehicle_id chain. Other domains keep their records on the vehicle that earned
 * them and use this to find the surviving vehicle.
 */
export async function resolveVehicle(client: PoolClient, vehicleId: unknown): Promise<VehicleResolution> {
  const requestedVehicleId = parseUuid(vehicleId, "vehicleId")
  const chain = await repo.resolveChain(client, requestedVehicleId, MAX_RESOLUTION_HOPS)
  if (!chain) throw new VehicleMergeNotFoundError("Vehicle")
  if (chain.last.recordStatus === "merged") {
    throw new VehicleMergeStateError("The vehicle merge chain could not be resolved to a surviving vehicle.")
  }
  return {
    requestedVehicleId,
    resolvedVehicleId: chain.last.id,
    hops: chain.hops,
    resolvedRecordStatus: chain.last.recordStatus,
  }
}

/** Every merge the vehicle took part in, as the merged vehicle or as the survivor; reversed rows are flagged. */
export async function listVehicleMerges(client: PoolClient, vehicleId: unknown): Promise<VehicleMergeHistory> {
  const id = parseUuid(vehicleId, "vehicleId")
  if (!(await repo.getVehicle(client, id))) throw new VehicleMergeNotFoundError("Vehicle")
  const merges = await repo.listMerges(client, id)
  return {
    vehicleId: id,
    merges: merges.map((merge) => ({
      ...merge,
      role: merge.mergedVehicleId === id ? ("MERGED" as const) : ("SURVIVOR" as const),
      reversed: merge.status === "reversed",
    })),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Mutations (VEHICLE_MANAGE)
// ---------------------------------------------------------------------------------------------------------------

/** Merges `mergedId` into `survivorId`. Both must be active. Nothing is copied, overwritten or deleted. */
export async function mergeVehicles(ctx: OperationContext, input: unknown): Promise<VehicleMergeResult> {
  const { survivorId, mergedId, reason } = parseMergeInput(input)

  return guarded(async () => {
    const locked = await repo.lockVehicles(ctx.client, [survivorId, mergedId])
    const survivor = locked.find((vehicle) => vehicle.id === survivorId)
    const merged = locked.find((vehicle) => vehicle.id === mergedId)
    if (!survivor) throw new VehicleMergeNotFoundError("The surviving vehicle")
    if (!merged) throw new VehicleMergeNotFoundError("The vehicle to merge")
    if (survivor.recordStatus !== "active") {
      throw new VehicleMergeStateError("The surviving vehicle must be active.")
    }
    if (merged.recordStatus !== "active") {
      throw new VehicleMergeStateError("The vehicle to merge must be active.")
    }

    const mergeId = randomUUID()
    const merge = await repo.insertMerge(ctx.client, { id: mergeId, mergedId, survivorId, reason })
    await repo.markVehicleMerged(ctx.client, mergedId, survivorId)

    const vehicleIds = [survivorId, mergedId]
    await record(ctx, "RECORD_CREATED", "VEHICLE_MERGE", { resourceType: "vehicle_merges", resourceId: mergeId, vehicleIds }, [
      { field: "record", after: reference("vehicle_merges", mergeId) },
      { field: "merge_reason", after: literal(reason) },
      { field: "record_status", after: literal("active") },
    ])
    await record(ctx, "RECORD_STATUS_CHANGED", "VEHICLE_MERGE", { resourceType: "vehicles", resourceId: mergedId, vehicleIds }, [
      { field: "record_status", before: literal("active"), after: literal("merged") },
      { field: "merged_into_vehicle_id", before: literal(null), after: reference("vehicles", survivorId) },
    ])

    return { merge, mergedVehicle: { id: mergedId, recordStatus: "merged" as const, mergedIntoVehicleId: survivorId } }
  })
}

/**
 * Reverses one merge: the ledger row becomes 'reversed' (kept forever) and the merged vehicle returns to 'active'. A
 * reversal is a new fact about the same ledger row; nothing is deleted.
 */
export async function reverseVehicleMerge(ctx: OperationContext, input: unknown): Promise<VehicleMergeResult> {
  const { mergeId } = parseReverseInput(input)

  return guarded(async () => {
    const unlocked = await repo.getMerge(ctx.client, mergeId, { lock: false })
    if (!unlocked) throw new VehicleMergeNotFoundError("Vehicle merge")

    const { mergedVehicleId, survivorVehicleId } = unlocked
    await repo.lockVehicles(ctx.client, [mergedVehicleId, survivorVehicleId])
    const merge = await repo.getMerge(ctx.client, mergeId, { lock: true })
    if (!merge) throw new VehicleMergeNotFoundError("Vehicle merge")
    if (merge.status === "reversed") throw new VehicleMergeStateError("This merge has already been reversed.")

    await repo.savepoint(ctx.client, "vehicle_merge_step")
    try {
      await repo.markVehicleActive(ctx.client, mergedVehicleId)
    } catch (error) {
      if (errorField(error, "constraint") !== repo.VIN_NAMESPACE_CONSTRAINT) throw error
      await repo.rollbackToSavepoint(ctx.client, "vehicle_merge_step")
      const holder = (await ctx.canReadVehicles()) ? await repo.findVinHolder(ctx.client, mergedVehicleId) : undefined
      throw new VehicleVinCollisionError(holder)
    }
    await repo.releaseSavepoint(ctx.client, "vehicle_merge_step")
    const reversed = await repo.markMergeReversed(ctx.client, mergeId)

    const vehicleIds = [survivorVehicleId, mergedVehicleId]
    await record(ctx, "RECORD_UPDATED", "VEHICLE_MERGE_REVERSE", { resourceType: "vehicle_merges", resourceId: mergeId, vehicleIds }, [
      { field: "record_status", before: literal("active"), after: literal("reversed") },
    ])
    await record(ctx, "RECORD_STATUS_CHANGED", "VEHICLE_MERGE_REVERSE", { resourceType: "vehicles", resourceId: mergedVehicleId, vehicleIds }, [
      { field: "record_status", before: literal("merged"), after: literal("active") },
      { field: "merged_into_vehicle_id", before: reference("vehicles", survivorVehicleId), after: literal(null) },
    ])

    return { merge: reversed, mergedVehicle: { id: mergedVehicleId, recordStatus: "active" as const, mergedIntoVehicleId: null } }
  })
}
