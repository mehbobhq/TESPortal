/**
 * Evidence payload errors. Names follow the canonical convention read by lib/api/canonical-response.ts
 * (...ValidationError, ...NotFoundError, ...StateError, ...ConflictError). None carries storage detail.
 */

export class EvidenceValidationError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = "EvidenceValidationError"
    this.field = field
  }
}

/** Also what a cross-tenant request gets: the document either does not exist for this organization or is not yours to see. */
export class EvidenceNotFoundError extends Error {
  constructor(what = "Evidence document") {
    super(`${what} was not found.`)
    this.name = "EvidenceNotFoundError"
  }
}

export class EvidenceStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EvidenceStateError"
  }
}

export class EvidenceConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EvidenceConflictError"
  }
}
