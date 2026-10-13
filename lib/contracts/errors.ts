/**
 * Contracts errors: domain outcomes the API layer maps to responses. Names follow the canonical convention read by
 * lib/api/canonical-response.ts (...ValidationError, ...NotFoundError, ...StateError, ...ConflictError). None carries
 * database detail.
 */

export class ContractValidationError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = "ContractValidationError"
    this.field = field
  }
}

export class ContractNotFoundError extends Error {
  constructor(what = "Contract record") {
    super(`${what} was not found.`)
    this.name = "ContractNotFoundError"
  }
}

/** The operation is not valid for the current state, or a database gate refused it. */
export class ContractStateError extends Error {
  /** Readiness gate codes that failed, when the refusal came from the readiness gates. */
  readonly gates: string[]

  constructor(message: string, gates: string[] = []) {
    super(message)
    this.name = "ContractStateError"
    this.gates = gates
  }
}

export class ContractConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ContractConflictError"
  }
}
