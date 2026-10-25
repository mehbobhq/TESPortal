/** The class NAME decides the HTTP status (lib/api/canonical-response.ts). Messages never name another company or person. */
export class DriverEventValidationError extends Error {
  readonly field: string
  readonly issues: { field: string; message: string }[]
  constructor(field: string, message: string, issues?: { field: string; message: string }[]) {
    super(message)
    this.field = field
    this.issues = issues ?? [{ field, message }]
  }
}
export class DriverEventNotFoundError extends Error {}
/** The action is not allowed in the current state (closed event, unreleased restriction, evidence not stored ...). */
export class DriverEventStateError extends Error {}
/** The request lost a race or repeats something that already exists (stale version, already-counted downstream record). */
export class DriverEventConflictError extends Error {}
