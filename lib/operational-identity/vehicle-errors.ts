/**
 * Errors of the vehicle lifecycle operations (registration periods, archive/restore, relationship end, unit number).
 * The class names end in ValidationError / NotFoundError / StateError / ConflictError so `canonicalFailure` maps them to
 * 400 / 404 / 409. None carries database text, a VIN, a plate or a unit number.
 */
export class VehicleOperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VehicleOperationError"
  }
}

export class VehicleOperationValidationError extends VehicleOperationError {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = "VehicleOperationValidationError"
    this.field = field
  }
}

/** Also the answer for a record that belongs to another company: the caller cannot tell the two apart. */
export class VehicleOperationNotFoundError extends VehicleOperationError {
  constructor(what = "Vehicle record") {
    super(`${what} was not found for this company.`)
    this.name = "VehicleOperationNotFoundError"
  }
}

export class VehicleOperationStateError extends VehicleOperationError {
  constructor(message: string) {
    super(message)
    this.name = "VehicleOperationStateError"
  }
}

export class VehicleOperationConflictError extends VehicleOperationError {
  constructor(message: string) {
    super(message)
    this.name = "VehicleOperationConflictError"
  }
}
