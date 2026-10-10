/**
 * Contacts errors: domain outcomes the future API layer maps to responses. None carries database detail, and a person or
 * relationship the caller may not see is reported exactly like one that does not exist.
 */

export type ContactErrorCode =
  | "CONTACT_INVALID"
  | "CONTACT_NOT_FOUND"
  | "CONTACT_STATE"
  | "CONTACT_CONFLICT"

export class ContactError extends Error {
  readonly code: ContactErrorCode

  constructor(code: ContactErrorCode, message: string) {
    super(message)
    this.name = "ContactError"
    this.code = code
  }
}

/** Input failed validation. `field` names the semantic input field, never a database column. */
export class ContactValidationError extends ContactError {
  readonly field: string

  constructor(field: string, message: string) {
    super("CONTACT_INVALID", message)
    this.name = "ContactValidationError"
    this.field = field
  }
}

export class ContactNotFoundError extends ContactError {
  constructor(what = "Contact record") {
    super("CONTACT_NOT_FOUND", `${what} was not found.`)
    this.name = "ContactNotFoundError"
  }
}

/** The operation is not valid for the current state of the Organization, person or record. */
export class ContactStateError extends ContactError {
  constructor(message: string) {
    super("CONTACT_STATE", message)
    this.name = "ContactStateError"
  }
}

/** An existing current record or a concurrent writer prevents the change (the database is the final arbiter). */
export class ContactConflictError extends ContactError {
  constructor(message: string) {
    super("CONTACT_CONFLICT", message)
    this.name = "ContactConflictError"
  }
}
