/**
 * Restored (original) interfaces keep every control the product had. A control whose canonical operation does not exist yet must
 * NOT pretend to work and must NOT fall back to browser storage: it refuses with this error, and the UI shows the message.
 * "No canonical operation" is a statement about the approved architecture (see docs/recovery/*), never a silent no-op.
 */
export class CanonicalOperationUnavailableError extends Error {
  readonly action: string
  readonly reason: string
  constructor(action: string, reason: string) {
    super(`${action} is not available yet: ${reason}`)
    this.name = "CanonicalOperationUnavailableError"
    this.action = action
    this.reason = reason
  }
}

export const isUnavailable = (error: unknown): error is CanonicalOperationUnavailableError => error instanceof CanonicalOperationUnavailableError

/** Message safe to show to a user for any error coming back from a restored control. */
export const userMessage = (error: unknown, fallback = "The change could not be saved."): string =>
  error instanceof Error && error.message ? error.message : fallback
