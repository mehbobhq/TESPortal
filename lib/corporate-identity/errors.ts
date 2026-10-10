/**
 * Corporate Identity errors. These are domain outcomes the future API layer maps to responses; none of them carries
 * database detail, and the collision error carries a matched Organization ONLY when the caller was allowed to see it.
 */

export type CorporateIdentityErrorCode =
  | "CORPORATE_IDENTITY_INVALID"
  | "CORPORATE_IDENTITY_NOT_FOUND"
  | "CORPORATE_IDENTITY_STATE"
  | "CORPORATE_IDENTIFIER_COLLISION"
  | "CORPORATE_IDENTITY_CONFLICT"

export class CorporateIdentityError extends Error {
  readonly code: CorporateIdentityErrorCode

  constructor(code: CorporateIdentityErrorCode, message: string) {
    super(message)
    this.name = "CorporateIdentityError"
    this.code = code
  }
}

/** Input failed validation. `field` names the semantic input field, never a database column. */
export class CorporateIdentityValidationError extends CorporateIdentityError {
  readonly field: string

  constructor(field: string, message: string) {
    super("CORPORATE_IDENTITY_INVALID", message)
    this.name = "CorporateIdentityValidationError"
    this.field = field
  }
}

export class CorporateIdentityNotFoundError extends CorporateIdentityError {
  constructor(what = "Organization") {
    super("CORPORATE_IDENTITY_NOT_FOUND", `${what} was not found.`)
    this.name = "CorporateIdentityNotFoundError"
  }
}

/** The operation is not valid for the Organization's (or record's) current state. */
export class CorporateIdentityStateError extends CorporateIdentityError {
  constructor(message: string) {
    super("CORPORATE_IDENTITY_STATE", message)
    this.name = "CorporateIdentityStateError"
  }
}

/** A different record already holds this value (alias/classification), within the same Organization. */
export class CorporateIdentityConflictError extends CorporateIdentityError {
  constructor(message: string) {
    super("CORPORATE_IDENTITY_CONFLICT", message)
    this.name = "CorporateIdentityConflictError"
  }
}

export type CollisionRecommendedAction = "OPEN_EXISTING" | "RESTORE_ARCHIVED" | "USE_SURVIVOR"

/** Details of the colliding Organization. Present on a collision ONLY for callers holding ORGANIZATION_REGISTRY_READ. */
export type CollisionMatch = {
  organizationId: string
  legalName: string
  displayName: string | null
  status: "active" | "archived" | "merged"
  mergedIntoOrganizationId: string | null
  identifierId: string
  recommendedAction: CollisionRecommendedAction
}

/**
 * An authoritative corporate identifier is already registered to an active identifier row. There is no override:
 * the only resolutions are to use, restore, or follow the existing Organization.
 *
 * Without ORGANIZATION_REGISTRY_READ `match` is undefined and the error says only that the identifier is registered.
 */
export class CorporateIdentifierCollisionError extends CorporateIdentityError {
  readonly kind: string
  readonly match: CollisionMatch | undefined

  constructor(kind: string, match: CollisionMatch | undefined) {
    super("CORPORATE_IDENTIFIER_COLLISION", "This corporate identifier is already registered.")
    this.name = "CorporateIdentifierCollisionError"
    this.kind = kind
    this.match = match
  }
}
