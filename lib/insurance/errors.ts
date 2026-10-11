/**
 * Insurance errors: domain outcomes the future API layer maps to responses. None carries database detail, and the
 * policy-number collision error names another policy / Organization ONLY when the caller also holds INSURANCE_READ.
 */

export type InsuranceErrorCode =
  | "INSURANCE_INVALID"
  | "INSURANCE_NOT_FOUND"
  | "INSURANCE_STATE"
  | "INSURANCE_CONFLICT"
  | "INSURANCE_NUMBER_COLLISION"

export class InsuranceError extends Error {
  readonly code: InsuranceErrorCode

  constructor(code: InsuranceErrorCode, message: string) {
    super(message)
    this.name = "InsuranceError"
    this.code = code
  }
}

/** Input failed validation. `field` names the semantic input field, never a database column. */
export class InsuranceValidationError extends InsuranceError {
  readonly field: string

  constructor(field: string, message: string) {
    super("INSURANCE_INVALID", message)
    this.name = "InsuranceValidationError"
    this.field = field
  }
}

export class InsuranceNotFoundError extends InsuranceError {
  constructor(what = "Insurance record") {
    super("INSURANCE_NOT_FOUND", `${what} was not found.`)
    this.name = "InsuranceNotFoundError"
  }
}

/** The operation is not valid for the current state of the Organization, policy, term or record. */
export class InsuranceStateError extends InsuranceError {
  constructor(message: string) {
    super("INSURANCE_STATE", message)
    this.name = "InsuranceStateError"
  }
}

/** An existing current record or a concurrent writer prevents the change (the database is the final arbiter). */
export class InsuranceConflictError extends InsuranceError {
  constructor(message: string) {
    super("INSURANCE_CONFLICT", message)
    this.name = "InsuranceConflictError"
  }
}

export type CollisionRecommendedAction = "OPEN_EXISTING" | "RESTORE_ARCHIVED"

/** The holder of a policy number inside one insurer's namespace. */
export type PolicyNumberHolder = {
  policyId: string
  termId: string
  /** The insured Organization of the holding policy. */
  organizationId: string
  organizationLegalName: string
  family: string
  policyRecordStatus: "active" | "archived"
  recommendedAction: CollisionRecommendedAction
}

/**
 * The policy number is already held, within the same insurer, by another policy. There is no override and nothing is reused
 * silently. Without INSURANCE_READ `match` is undefined and the error says only that the number is already registered.
 */
export class PolicyNumberCollisionError extends InsuranceError {
  readonly match: PolicyNumberHolder | undefined

  constructor(match: PolicyNumberHolder | undefined) {
    super("INSURANCE_NUMBER_COLLISION", "This policy number is already registered with that insurer.")
    this.name = "PolicyNumberCollisionError"
    this.match = match
  }
}
