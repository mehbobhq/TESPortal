/** The class NAME decides the HTTP status (lib/api/canonical-response.ts). Messages never name another company or person. */
export class DriverProspectValidationError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.field = field
  }
}
export class DriverProspectNotFoundError extends Error {}
export class DriverProspectStateError extends Error {}
export class DriverProspectConflictError extends Error {}
