/**
 * Vehicle-merge errors: domain outcomes the future API layer maps to responses. None carries database detail, and none
 * ever carries a VIN, plate or unit number. The VIN collision error names the vehicle holding the VIN namespace ONLY when
 * the caller also holds VEHICLE_READ.
 */

export type VehicleMergeErrorCode =
  | "VEHICLE_MERGE_INVALID"
  | "VEHICLE_MERGE_NOT_FOUND"
  | "VEHICLE_MERGE_STATE"
  | "VEHICLE_MERGE_CONFLICT"
  | "VEHICLE_MERGE_VIN_COLLISION"

export class VehicleMergeError extends Error {
  readonly code: VehicleMergeErrorCode

  constructor(code: VehicleMergeErrorCode, message: string) {
    super(message)
    this.name = "VehicleMergeError"
    this.code = code
  }
}

/** Input failed validation. `field` names the semantic input field, never a database column. */
export class VehicleMergeValidationError extends VehicleMergeError {
  readonly field: string

  constructor(field: string, message: string) {
    super("VEHICLE_MERGE_INVALID", message)
    this.name = "VehicleMergeValidationError"
    this.field = field
  }
}

export class VehicleMergeNotFoundError extends VehicleMergeError {
  constructor(what = "Vehicle") {
    super("VEHICLE_MERGE_NOT_FOUND", `${what} was not found.`)
    this.name = "VehicleMergeNotFoundError"
  }
}

/** The operation is not valid for the current state of the vehicles or of the merge. */
export class VehicleMergeStateError extends VehicleMergeError {
  constructor(message: string) {
    super("VEHICLE_MERGE_STATE", message)
    this.name = "VehicleMergeStateError"
  }
}

/** A concurrent writer prevented the change (a deadlock or serialization failure); the operation can be retried. */
export class VehicleMergeConflictError extends VehicleMergeError {
  constructor(message: string) {
    super("VEHICLE_MERGE_CONFLICT", message)
    this.name = "VehicleMergeConflictError"
  }
}

/**
 * Reversal would return the merged vehicle to the VIN namespace, but another current vehicle now holds that VIN. Nothing
 * is changed and nothing is overwritten. The holder is named only for callers who also hold VEHICLE_READ; the message
 * never contains the VIN.
 */
export class VehicleVinCollisionError extends VehicleMergeError {
  readonly holderVehicleId: string | undefined

  constructor(holderVehicleId: string | undefined) {
    super("VEHICLE_MERGE_VIN_COLLISION", "The vehicle identifier is now held by another vehicle, so this merge cannot be reversed.")
    this.name = "VehicleVinCollisionError"
    this.holderVehicleId = holderVehicleId
  }
}
