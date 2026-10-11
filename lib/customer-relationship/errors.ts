/**
 * Customer Relationship errors: domain outcomes the future API layer maps to responses. None carries database detail.
 */

export type CustomerRelationshipErrorCode =
  | "CUSTOMER_RELATIONSHIP_INVALID"
  | "CUSTOMER_RELATIONSHIP_NOT_FOUND"
  | "CUSTOMER_RELATIONSHIP_STATE"
  | "CUSTOMER_RELATIONSHIP_CONFLICT"

export class CustomerRelationshipError extends Error {
  readonly code: CustomerRelationshipErrorCode

  constructor(code: CustomerRelationshipErrorCode, message: string) {
    super(message)
    this.name = "CustomerRelationshipError"
    this.code = code
  }
}

/** Input failed validation. `field` names the semantic input field, never a database column. */
export class CustomerRelationshipValidationError extends CustomerRelationshipError {
  readonly field: string

  constructor(field: string, message: string) {
    super("CUSTOMER_RELATIONSHIP_INVALID", message)
    this.name = "CustomerRelationshipValidationError"
    this.field = field
  }
}

export class CustomerRelationshipNotFoundError extends CustomerRelationshipError {
  constructor(what = "Customer relationship record") {
    super("CUSTOMER_RELATIONSHIP_NOT_FOUND", `${what} was not found.`)
    this.name = "CustomerRelationshipNotFoundError"
  }
}

/** The operation is not valid for the current state of the Organization, Engagement or record. */
export class CustomerRelationshipStateError extends CustomerRelationshipError {
  constructor(message: string) {
    super("CUSTOMER_RELATIONSHIP_STATE", message)
    this.name = "CustomerRelationshipStateError"
  }
}

/** An existing current record or a concurrent writer prevents the change (the database is the final arbiter). */
export class CustomerRelationshipConflictError extends CustomerRelationshipError {
  constructor(message: string) {
    super("CUSTOMER_RELATIONSHIP_CONFLICT", message)
    this.name = "CustomerRelationshipConflictError"
  }
}
