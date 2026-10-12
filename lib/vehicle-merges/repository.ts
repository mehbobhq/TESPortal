/**
 * Vehicle-merge repository: SQL only, on a caller-supplied transaction client.
 *
 * No authorization, validation or Master Register logic lives here. Every function takes the client the authorization
 * wrapper checked out, so authorization and persistence share one connection and one transaction. Nothing here issues
 * DELETE (the runtime role has none, and the table forbids it).
 *
 * Timestamps are returned as text with microsecond precision, because a JS Date would truncate to milliseconds.
 */

import type { PoolClient } from "pg"
import type { MergeReason, MergeStatus, VehicleRecordStatus } from "@/lib/vehicle-merges/definitions"
import type { VehicleMergeRecord } from "@/lib/vehicle-merges/types"

export type Queryable = Pick<PoolClient, "query">

/** Database backstops (migrations 0020, 0023 and 0026) the operations translate into domain errors. */
export const VIN_NAMESPACE_CONSTRAINT = "vehicles_vin_current_uq"
export const ACTIVE_SOURCE_CONSTRAINT = "vehicle_merges_active_source_uq"
export const BOTH_ACTIVE_CONSTRAINT = "vehicle_merges_both_active"
export const SURVIVOR_NOT_MERGED_CONSTRAINT = "vehicle_merges_survivor_not_merged"
export const MERGED_STATE_CONSTRAINT = "vehicles_merged_state_consistent"

const MICRO_ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

// --- vehicles -----------------------------------------------------------------------------------------------------

export type VehicleRow = {
  id: string
  recordStatus: VehicleRecordStatus
  mergedIntoVehicleId: string | null
}

type VehicleDbRow = { id: string; record_status: VehicleRecordStatus; merged_into_vehicle_id: string | null }
const toVehicle = (row: VehicleDbRow): VehicleRow => ({
  id: row.id,
  recordStatus: row.record_status,
  mergedIntoVehicleId: row.merged_into_vehicle_id,
})

export async function getVehicle(client: Queryable, vehicleId: string): Promise<VehicleRow | undefined> {
  const result = await client.query<VehicleDbRow>(`SELECT id, record_status, merged_into_vehicle_id FROM public.vehicles WHERE id = $1`, [vehicleId])
  return result.rows[0] ? toVehicle(result.rows[0]) : undefined
}

/**
 * Row-locks the given vehicles in uuid order, the one global lock order for vehicles, so two writers that share vehicles
 * can never wait on each other in a cycle. Vehicles that do not exist are simply absent from the result.
 */
export async function lockVehicles(client: Queryable, vehicleIds: readonly string[]): Promise<VehicleRow[]> {
  const result = await client.query<VehicleDbRow>(
    `SELECT id, record_status, merged_into_vehicle_id FROM public.vehicles WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [[...vehicleIds]],
  )
  return result.rows.map(toVehicle)
}

export async function markVehicleMerged(client: Queryable, vehicleId: string, survivorId: string): Promise<void> {
  await client.query(
    `UPDATE public.vehicles SET record_status = 'merged', merged_into_vehicle_id = $2, updated_at = now() WHERE id = $1`,
    [vehicleId, survivorId],
  )
}

export async function markVehicleActive(client: Queryable, vehicleId: string): Promise<void> {
  await client.query(
    `UPDATE public.vehicles SET record_status = 'active', merged_into_vehicle_id = NULL, updated_at = now() WHERE id = $1`,
    [vehicleId],
  )
}

/** The other current (not merged away) vehicle that holds the same VIN as `vehicleId`, if any. Returns the id only. */
export async function findVinHolder(client: Queryable, vehicleId: string): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    `SELECT other.id
       FROM public.vehicles AS subject
       JOIN public.vehicles AS other
         ON other.vin_normalized = subject.vin_normalized AND other.id <> subject.id AND other.record_status <> 'merged'
      WHERE subject.id = $1 AND subject.vin_normalized IS NOT NULL
      ORDER BY other.id
      LIMIT 1`,
    [vehicleId],
  )
  return result.rows[0]?.id
}

// --- savepoints ---------------------------------------------------------------------------------------------------

/** Lets a statement that may fail with a unique violation be undone without aborting the surrounding transaction. */
export async function savepoint(client: Queryable, name: "vehicle_merge_step"): Promise<void> {
  await client.query(`SAVEPOINT ${name}`)
}

export async function rollbackToSavepoint(client: Queryable, name: "vehicle_merge_step"): Promise<void> {
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`)
}

export async function releaseSavepoint(client: Queryable, name: "vehicle_merge_step"): Promise<void> {
  await client.query(`RELEASE SAVEPOINT ${name}`)
}

// --- ledger -------------------------------------------------------------------------------------------------------

type MergeDbRow = {
  id: string
  source_vehicle_id: string
  target_vehicle_id: string
  merge_reason: MergeReason
  record_status: MergeStatus
  merged_at: string
  reversed_at: string | null
  created_at: string
}
const MERGE_COLUMNS = `id, source_vehicle_id, target_vehicle_id, merge_reason, record_status,
  ${MICRO_ISO("merged_at")} AS merged_at, ${MICRO_ISO("reversed_at")} AS reversed_at, ${MICRO_ISO("created_at")} AS created_at`
const toMerge = (row: MergeDbRow): VehicleMergeRecord => ({
  id: row.id,
  mergedVehicleId: row.source_vehicle_id,
  survivorVehicleId: row.target_vehicle_id,
  reason: row.merge_reason,
  status: row.record_status,
  mergedAt: row.merged_at,
  reversedAt: row.reversed_at,
  createdAt: row.created_at,
})

export async function getMerge(client: Queryable, mergeId: string, options: { lock: boolean }): Promise<VehicleMergeRecord | undefined> {
  const result = await client.query<MergeDbRow>(
    `SELECT ${MERGE_COLUMNS} FROM public.vehicle_merges WHERE id = $1${options.lock ? " FOR UPDATE" : ""}`,
    [mergeId],
  )
  return result.rows[0] ? toMerge(result.rows[0]) : undefined
}

export async function insertMerge(
  client: Queryable,
  merge: { id: string; mergedId: string; survivorId: string; reason: MergeReason },
): Promise<VehicleMergeRecord> {
  const result = await client.query<MergeDbRow>(
    `INSERT INTO public.vehicle_merges (id, source_vehicle_id, target_vehicle_id, merge_reason)
     VALUES ($1, $2, $3, $4)
     RETURNING ${MERGE_COLUMNS}`,
    [merge.id, merge.mergedId, merge.survivorId, merge.reason],
  )
  return toMerge(result.rows[0])
}

/**
 * The one-way transition active -> reversed. The reversal instant is the database clock at the statement (not the
 * transaction start), so it can never precede the instant the merge was made.
 */
export async function markMergeReversed(client: Queryable, mergeId: string): Promise<VehicleMergeRecord> {
  const result = await client.query<MergeDbRow>(
    `UPDATE public.vehicle_merges
        SET record_status = 'reversed', reversed_at = clock_timestamp(), updated_at = now()
      WHERE id = $1
      RETURNING ${MERGE_COLUMNS}`,
    [mergeId],
  )
  return toMerge(result.rows[0])
}

/** Every ledger row in which the vehicle is the merged vehicle or the survivor, oldest first. */
export async function listMerges(client: Queryable, vehicleId: string): Promise<VehicleMergeRecord[]> {
  const result = await client.query<MergeDbRow>(
    `SELECT ${MERGE_COLUMNS} FROM public.vehicle_merges
      WHERE source_vehicle_id = $1 OR target_vehicle_id = $1
      ORDER BY merged_at, id`,
    [vehicleId],
  )
  return result.rows.map(toMerge)
}

// --- resolution ---------------------------------------------------------------------------------------------------

export type ResolvedChain = {
  /** The last vehicle reached. Still 'merged' only when the chain did not end (a loop or the hop bound). */
  last: VehicleRow
  hops: number
}

/**
 * Follows merged_into_vehicle_id from `vehicleId` in ONE statement (one consistent snapshot). The walk never revisits a
 * vehicle and never exceeds `maxHops`, so a corrupted chain cannot loop or run unbounded.
 */
export async function resolveChain(client: Queryable, vehicleId: string, maxHops: number): Promise<ResolvedChain | undefined> {
  const result = await client.query<VehicleDbRow & { hops: number }>(
    `WITH RECURSIVE chain (id, record_status, merged_into_vehicle_id, hops, path) AS (
       SELECT v.id, v.record_status, v.merged_into_vehicle_id, 0, ARRAY[v.id]
         FROM public.vehicles AS v
        WHERE v.id = $1
       UNION ALL
       SELECT v.id, v.record_status, v.merged_into_vehicle_id, c.hops + 1, c.path || v.id
         FROM chain AS c
         JOIN public.vehicles AS v ON v.id = c.merged_into_vehicle_id
        WHERE c.record_status = 'merged' AND c.hops < $2 AND NOT (v.id = ANY (c.path))
     )
     SELECT id, record_status, merged_into_vehicle_id, hops FROM chain ORDER BY hops DESC LIMIT 1`,
    [vehicleId, maxHops],
  )
  const row = result.rows[0]
  return row ? { last: toVehicle(row), hops: row.hops } : undefined
}
