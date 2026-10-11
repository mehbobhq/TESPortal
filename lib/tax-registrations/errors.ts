/**
 * Tax-registration errors: domain outcomes the future API layer maps to responses. None carries database detail, and the
 * collision error names another Organization ONLY when the caller also holds TAX_REGISTRATION_READ.
 */

export type RegistrationErrorCode =
  | "REGISTRATION_INVALID"
  | "REGISTRATION_NOT_FOUND"
  | "REGISTRATION_STATE"
  | "REGISTRATION_CONFLICT"
  | "REGISTRATION_NUMBER_COLLISION"

export class RegistrationError extends Error {
  readonly code: RegistrationErrorCode

  constructor(code: RegistrationErrorCode, message: string) {
    super(message)
    this.name = "RegistrationError"
    this.code = code
  }
}

/** Input failed validation. `field` names the semantic input field, never a database column. */
export class RegistrationValidationError extends RegistrationError {
  readonly field: string

  constructor(field: string, message: string) {
    super("REGISTRATION_INVALID", message)
    this.name = "RegistrationValidationError"
    this.field = field
  }
}

export class RegistrationNotFoundError extends RegistrationError {
  constructor(what = "Registration") {
    super("REGISTRATION_NOT_FOUND", `${what} was not found.`)
    this.name = "RegistrationNotFoundError"
  }
}

/** The operation is not valid for the current state of the Organization or registration. */
export class RegistrationStateError extends RegistrationError {
  constructor(message: string) {
    super("REGISTRATION_STATE", message)
    this.name = "RegistrationStateError"
  }
}

/** A concurrent writer prevents the change (the database is the final arbiter). */
export class RegistrationConflictError extends RegistrationError {
  constructor(message: string) {
    super("REGISTRATION_CONFLICT", message)
    this.name = "RegistrationConflictError"
  }
}

export type CollisionRecommendedAction = "OPEN_EXISTING" | "RESTORE_ARCHIVED"

/** Details of the colliding registration. Present on a collision ONLY for callers holding TAX_REGISTRATION_READ. */
export type NumberCollisionMatch = {
  organizationId: string
  organizationLegalName: string
  registrationId: string
  versionId: string
  registrationRecordStatus: "active" | "archived"
  registrationStatus: string | null
  recommendedAction: CollisionRecommendedAction
}

/**
 * The registration number is already held by a current registration version in the same number namespace. There is no
 * override and nothing is reused silently. Without registry access `match` is undefined and the error says only that the
 * number is already registered.
 */
export class RegistrationNumberCollisionError extends RegistrationError {
  readonly program: string
  readonly match: NumberCollisionMatch | undefined

  constructor(program: string, match: NumberCollisionMatch | undefined) {
    super("REGISTRATION_NUMBER_COLLISION", "This registration number is already registered.")
    this.name = "RegistrationNumberCollisionError"
    this.program = program
    this.match = match
  }
}
