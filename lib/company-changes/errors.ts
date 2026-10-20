import type { Blocker } from "@/lib/company-changes/definitions"

export class CompanyChangeValidationError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = "CompanyChangeValidationError"
    this.field = field
  }
}

export class CompanyChangeNotFoundError extends Error {
  constructor(what = "Change request") {
    super(`${what} was not found.`)
    this.name = "CompanyChangeNotFoundError"
  }
}

export class CompanyChangeStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CompanyChangeStateError"
  }
}

/** A gated change cannot be applied yet: lists exactly what is missing. The canonical record is left untouched. */
export class CompanyChangeBlockedStateError extends CompanyChangeStateError {
  readonly blockers: Blocker[]
  constructor(blockers: Blocker[]) {
    super(`The change cannot be applied yet: ${blockers.map((b) => b.message).join(" ")}`)
    this.name = "CompanyChangeBlockedStateError"
    this.blockers = blockers
  }
}
