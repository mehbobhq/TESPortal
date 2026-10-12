import type { MergeReason, MergeStatus, VehicleRecordStatus } from "@/lib/vehicle-merges/definitions"

export type MergeVehiclesInput = {
  /** The vehicle that stays: it keeps its identity and its identifiers. */
  survivorId: string
  /** The duplicate that is merged away: it keeps its history and leaves the VIN namespace. */
  mergedId: string
  reason: MergeReason
}

export type ReverseVehicleMergeInput = {
  mergeId: string
}

/** One ledger row. Identifiers and vocabulary only: no VIN, plate or unit number. */
export type VehicleMergeRecord = {
  id: string
  /** The vehicle that was merged away. */
  mergedVehicleId: string
  /** The vehicle it was merged into. */
  survivorVehicleId: string
  reason: MergeReason
  status: MergeStatus
  mergedAt: string
  reversedAt: string | null
  createdAt: string
}

/** The vehicle a merge changed, as the merge or its reversal left it. */
export type MergedVehicleState = {
  id: string
  recordStatus: VehicleRecordStatus
  mergedIntoVehicleId: string | null
}

export type VehicleMergeResult = {
  merge: VehicleMergeRecord
  mergedVehicle: MergedVehicleState
}

export type VehicleResolution = {
  requestedVehicleId: string
  /** The vehicle that currently stands for the requested one: the requested vehicle itself when it was never merged away. */
  resolvedVehicleId: string
  /** Number of merged_into_vehicle_id links followed. */
  hops: number
  resolvedRecordStatus: VehicleRecordStatus
}

/** Every merge a vehicle took part in, as the merged vehicle or as the survivor. Reversed rows are flagged. */
export type VehicleMergeHistory = {
  vehicleId: string
  merges: Array<VehicleMergeRecord & { role: "MERGED" | "SURVIVOR"; reversed: boolean }>
}
