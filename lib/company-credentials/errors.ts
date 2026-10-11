/**
 * Company Credentials errors: domain outcomes the future API layer maps to responses. None carries database detail, and
 * none ever echoes a submitted username, system name, URL or secret reference back to the caller.
 */

export type CompanyCredentialErrorCode =
  | "COMPANY_CREDENTIAL_INVALID"
  | "COMPANY_CREDENTIAL_NOT_FOUND"
  | "COMPANY_CREDENTIAL_STATE"
  | "COMPANY_CREDENTIAL_CONFLICT"

export class CompanyCredentialError extends Error {
  readonly code: CompanyCredentialErrorCode

  constructor(code: CompanyCredentialErrorCode, message: string) {
    super(message)
    this.name = "CompanyCredentialError"
    this.code = code
  }
}

/** Input failed validation. `field` names the semantic input field, never a database column. */
export class CompanyCredentialValidationError extends CompanyCredentialError {
  readonly field: string

  constructor(field: string, message: string) {
    super("COMPANY_CREDENTIAL_INVALID", message)
    this.name = "CompanyCredentialValidationError"
    this.field = field
  }
}

export class CompanyCredentialNotFoundError extends CompanyCredentialError {
  constructor(what = "Credential record") {
    super("COMPANY_CREDENTIAL_NOT_FOUND", `${what} was not found.`)
    this.name = "CompanyCredentialNotFoundError"
  }
}

/** The operation is not valid for the current state of the Organization, system or record. */
export class CompanyCredentialStateError extends CompanyCredentialError {
  constructor(message: string) {
    super("COMPANY_CREDENTIAL_STATE", message)
    this.name = "CompanyCredentialStateError"
  }
}

/** An existing record or a concurrent writer prevents the change (the database is the final arbiter). */
export class CompanyCredentialConflictError extends CompanyCredentialError {
  constructor(message: string) {
    super("COMPANY_CREDENTIAL_CONFLICT", message)
    this.name = "CompanyCredentialConflictError"
  }
}
