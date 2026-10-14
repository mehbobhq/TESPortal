/**
 * Driver operation errors. The names follow the convention lib/api/canonical-response.ts maps to HTTP statuses
 * (...ValidationError 400, ...NotFoundError 404, ...StateError / ...ConflictError 409). None carries database detail, and a
 * driver that does not belong to the Organization in the URL is reported exactly like one that does not exist.
 */
export class DriverValidationError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = "DriverValidationError"
    this.field = field
  }
}

export class DriverNotFoundError extends Error {
  constructor(what = "Driver") {
    super(`${what} was not found.`)
    this.name = "DriverNotFoundError"
  }
}

export class DriverStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DriverStateError"
  }
}

export class DriverConflictError extends Error {
  /** When the conflict is "this licence already identifies a driver", the person it identifies. */
  readonly existingPersonId?: string
  constructor(message: string, existingPersonId?: string) {
    super(message)
    this.name = "DriverConflictError"
    this.existingPersonId = existingPersonId
  }
}
