/**
 * Operating-authority errors: domain outcomes the future API layer maps to responses. None carries database detail,
 * and the collision error names another Organization ONLY when the caller holds ORGANIZATION_REGISTRY_READ.
 */

export type OperatingAuthorityErrorCode =
  | "OPERATING_AUTHORITY_INVALID"
  | "OPERATING_AUTHORITY_NOT_FOUND"
  | "OPERATING_AUTHORITY_STATE"
  | "OPERATING_AUTHORITY_CONFLICT"
  | "OPERATING_AUTHORITY_NUMBER_COLLISION"

export class OperatingAuthorityError extends Error {
  readonly code: OperatingAuthorityErrorCode

  constructor(code: OperatingAuthorityErrorCode, message: string) {
    super(message)
    this.name = "OperatingAuthorityError"
    this.code = code
  }
}

/** Input failed validation. `field` names the semantic input field, never a database column. */
export class OperatingAuthorityValidationError extends OperatingAuthorityError {
  readonly field: string

  constructor(field: string, message: string) {
    super("OPERATING_AUTHORITY_INVALID", message)
    this.name = "OperatingAuthorityValidationError"
    this.field = field
  }
}

export class OperatingAuthorityNotFoundError extends OperatingAuthorityError {
  constructor(what = "Authority") {
    super("OPERATING_AUTHORITY_NOT_FOUND", `${what} was not found.`)
    this.name = "OperatingAuthorityNotFoundError"
  }
}

/** The operation is not valid for the current state of the Organization or authority. */
export class OperatingAuthorityStateError extends OperatingAuthorityError {
  constructor(message: string) {
    super("OPERATING_AUTHORITY_STATE", message)
    this.name = "OperatingAuthorityStateError"
  }
}

/** An existing current record or a concurrent writer prevents the change (the database is the final arbiter). */
export class OperatingAuthorityConflictError extends OperatingAuthorityError {
  constructor(message: string) {
    super("OPERATING_AUTHORITY_CONFLICT", message)
    this.name = "OperatingAuthorityConflictError"
  }
}

export type CollisionRecommendedAction = "OPEN_EXISTING" | "RESTORE_ARCHIVED"

/** Details of the colliding authority. Present on a collision ONLY for callers holding ORGANIZATION_REGISTRY_READ. */
export type NumberCollisionMatch = {
  organizationId: string
  organizationLegalName: string
  authorityId: string
  versionId: string
  authorityRecordStatus: "active" | "archived"
  authorityStatus: string | null
  recommendedAction: CollisionRecommendedAction
}

/**
 * The authority number is already held by a current authority version in the same number namespace. There is no
 * override and nothing is reused silently. Without registry access `match` is undefined and the error says only that
 * the number is already registered.
 */
export class AuthorityNumberCollisionError extends OperatingAuthorityError {
  readonly kind: string
  readonly match: NumberCollisionMatch | undefined

  constructor(kind: string, match: NumberCollisionMatch | undefined) {
    super("OPERATING_AUTHORITY_NUMBER_COLLISION", "This authority number is already registered.")
    this.name = "AuthorityNumberCollisionError"
    this.kind = kind
    this.match = match
  }
}
