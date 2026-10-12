/**
 * Server-owned vocabulary of the vehicle merge ledger. PostgreSQL (migration 0026) enforces the same values with CHECK
 * constraints; a drift test proves the two agree.
 */

export const MERGE_REASONS = ["DUPLICATE_RECORD", "IDENTIFIER_CORRECTION", "RESOLUTION_REVIEW"] as const
export type MergeReason = (typeof MERGE_REASONS)[number]

export const MERGE_STATUSES = ["active", "reversed"] as const
export type MergeStatus = (typeof MERGE_STATUSES)[number]

export const VEHICLE_RECORD_STATUSES = ["active", "archived", "merged"] as const
export type VehicleRecordStatus = (typeof VEHICLE_RECORD_STATUSES)[number]

/**
 * Upper bound on the hops resolveVehicle follows. A chain is one hop per merge of a surviving vehicle, so this is far
 * above anything real; it exists so a corrupted chain can never loop or run unbounded.
 */
export const MAX_RESOLUTION_HOPS = 32

export function isMergeReason(value: unknown): value is MergeReason {
  return typeof value === "string" && (MERGE_REASONS as readonly string[]).includes(value)
}
