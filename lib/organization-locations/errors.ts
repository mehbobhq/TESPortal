/**
 * Organization Location errors: domain outcomes the future API layer maps to responses. None carries database detail, and
 * none reveals another Organization's use of a Location to a caller without ORGANIZATION_REGISTRY_READ.
 */

export type OrganizationLocationErrorCode =
  | "ORGANIZATION_LOCATION_INVALID"
  | "ORGANIZATION_LOCATION_NOT_FOUND"
  | "ORGANIZATION_LOCATION_STATE"
  | "ORGANIZATION_LOCATION_CONFLICT"

export class OrganizationLocationError extends Error {
  readonly code: OrganizationLocationErrorCode

  constructor(code: OrganizationLocationErrorCode, message: string) {
    super(message)
    this.name = "OrganizationLocationError"
    this.code = code
  }
}

/** Input failed validation. `field` names the semantic input field, never a database column. */
export class OrganizationLocationValidationError extends OrganizationLocationError {
  readonly field: string

  constructor(field: string, message: string) {
    super("ORGANIZATION_LOCATION_INVALID", message)
    this.name = "OrganizationLocationValidationError"
    this.field = field
  }
}

/**
 * The Organization, Location or assignment does not exist OR is not visible to this caller. The two cases are
 * deliberately indistinguishable so that a caller without registry access cannot probe for Locations.
 */
export class OrganizationLocationNotFoundError extends OrganizationLocationError {
  constructor(what = "Location") {
    super("ORGANIZATION_LOCATION_NOT_FOUND", `${what} was not found.`)
    this.name = "OrganizationLocationNotFoundError"
  }
}

/** The operation is not valid for the current state of the Organization, Location or assignment. */
export class OrganizationLocationStateError extends OrganizationLocationError {
  constructor(message: string) {
    super("ORGANIZATION_LOCATION_STATE", message)
    this.name = "OrganizationLocationStateError"
  }
}

/** A concurrent writer or an existing current record prevents the change (the database is the final arbiter). */
export class OrganizationLocationConflictError extends OrganizationLocationError {
  constructor(message: string) {
    super("ORGANIZATION_LOCATION_CONFLICT", message)
    this.name = "OrganizationLocationConflictError"
  }
}
