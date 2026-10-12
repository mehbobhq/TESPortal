import "server-only"

import type { PoolClient } from "pg"
import { hasAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as operations from "@/lib/vehicle-merges/operations"
import type { VehicleMergeHistory, VehicleMergeResult, VehicleResolution } from "@/lib/vehicle-merges/types"

export * from "@/lib/vehicle-merges/errors"
export * from "@/lib/vehicle-merges/definitions"
export type * from "@/lib/vehicle-merges/types"

/**
 * Vehicle merge service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorizedSystem (authorization + one transaction) -> operations -> repository -> PostgreSQL
 *                                                                         \-> Master Register, same transaction
 *
 * Capabilities enforced (SYSTEM scope only; there is no CUSTOMER-facing path):
 *   VEHICLE_READ    resolveVehicle, listVehicleMerges
 *   VEHICLE_MANAGE  mergeVehicles, reverseVehicleMerge
 *
 * A merge is an alias: records of other domains (organization relationships, registrations, insurance schedules) stay on
 * the vehicle that earned them, and readers that want the vehicle as it stands today follow resolveVehicle.
 * A reversal that would return a taken VIN to the namespace names the holder only when the caller ALSO holds VEHICLE_READ.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): operations.OperationContext {
  let readAllowed: Promise<boolean> | undefined
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
    canReadVehicles: () => (readAllowed ??= hasAdditionalSystemCapability(client, decision, "VEHICLE_READ")),
  }
}

// --- reads (no Master Register events) ------------------------------------------------------------------------------

/** The vehicle that stands for this one today (itself, or the survivor at the end of its merge chain). */
export async function resolveVehicle(vehicleId: string): Promise<VehicleResolution> {
  return withAuthorizedSystem("VEHICLE_READ", (client) => operations.resolveVehicle(client, vehicleId))
}

/** Every merge the vehicle took part in, as the merged vehicle or as the survivor; reversed merges are flagged. */
export async function listVehicleMerges(vehicleId: string): Promise<VehicleMergeHistory> {
  return withAuthorizedSystem("VEHICLE_READ", (client) => operations.listVehicleMerges(client, vehicleId))
}

// --- mutations (VEHICLE_MANAGE) -------------------------------------------------------------------------------------

function manage<T>(work: (ctx: operations.OperationContext) => Promise<T>): Promise<T> {
  return withAuthorizedSystem("VEHICLE_MANAGE", (client, decision) => work(context(client, decision)))
}

/** Merges a duplicate vehicle into the surviving vehicle. Both must be active; nothing is copied, overwritten or deleted. */
export const mergeVehicles = (input: unknown): Promise<VehicleMergeResult> => manage((ctx) => operations.mergeVehicles(ctx, input))
/** Reverses one merge. Refused for a reversed merge, while the survivor is merged away, or when the VIN was taken since. */
export const reverseVehicleMerge = (input: unknown): Promise<VehicleMergeResult> => manage((ctx) => operations.reverseVehicleMerge(ctx, input))
