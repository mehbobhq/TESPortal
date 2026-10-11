/**
 * Company Operating Profile errors: domain outcomes the future API layer maps to responses. None carries database detail.
 */

export type CompanyProfileErrorCode =
  | "COMPANY_PROFILE_INVALID"
  | "COMPANY_PROFILE_NOT_FOUND"
  | "COMPANY_PROFILE_STATE"
  | "COMPANY_PROFILE_CONFLICT"

export class CompanyProfileError extends Error {
  readonly code: CompanyProfileErrorCode

  constructor(code: CompanyProfileErrorCode, message: string) {
    super(message)
    this.name = "CompanyProfileError"
    this.code = code
  }
}

/** Input failed validation. `field` names the semantic input field, never a database column. */
export class CompanyProfileValidationError extends CompanyProfileError {
  readonly field: string

  constructor(field: string, message: string) {
    super("COMPANY_PROFILE_INVALID", message)
    this.name = "CompanyProfileValidationError"
    this.field = field
  }
}

export class CompanyProfileNotFoundError extends CompanyProfileError {
  constructor(what = "Company profile record") {
    super("COMPANY_PROFILE_NOT_FOUND", `${what} was not found.`)
    this.name = "CompanyProfileNotFoundError"
  }
}

/** The operation is not valid for the current state of the Organization or record. */
export class CompanyProfileStateError extends CompanyProfileError {
  constructor(message: string) {
    super("COMPANY_PROFILE_STATE", message)
    this.name = "CompanyProfileStateError"
  }
}

/** An existing current record (including a repeated identical assertion) or a concurrent writer prevents the change. */
export class CompanyProfileConflictError extends CompanyProfileError {
  constructor(message: string) {
    super("COMPANY_PROFILE_CONFLICT", message)
    this.name = "CompanyProfileConflictError"
  }
}
