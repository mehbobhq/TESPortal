/**
 * Client-safe interpretation of the two driver-application endpoints' answers for the Driver workspace.
 *
 * This module has no server-only imports and performs no I/O. It exists so the rules that decide whether the workspace may
 * offer "Send" again, and whether a paused applicant-submission service is shown to staff, are testable.
 *
 * Limitation: the "delivery unconfirmed" state is recorded in the same browser-local Driver store as the rest of the
 * application workflow. It survives refresh and remount in that browser, but it is NOT durable server-side tracking. Durable
 * retry prevention requires canonical PostgreSQL invitation records and a transactional outbox (see
 * docs/driver-application-invitation-containment.md). Until then the server keeps invitation sending closed.
 */

export const INVITATION_DELIVERY_UNCONFIRMED_STATUS = "Invitation Delivery Unconfirmed" as const

export const INVITATION_DELIVERY_UNCONFIRMED_MESSAGE =
  "TES could not confirm whether this invitation was delivered. It may have been sent. Do not send another until delivery has been checked."

export type InvitationClientOutcome =
  | { kind: "SENT"; messageId: string; sentAt?: string; expiresAt?: string; auditRecorded: boolean }
  /** Nothing was sent: a refusal before sending, or a provider refusal. Safe to correct and try again. */
  | { kind: "NOT_SENT"; message: string }
  /** The request may have been processed. Never retry automatically; never offer Send again for this driver. */
  | { kind: "UNKNOWN"; message: string }

type ResponseLike = { status: number; body: unknown; networkError?: boolean }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Statuses our handler returns strictly before any email is attempted. */
const BEFORE_SEND = new Set([400, 401, 403, 404, 422, 503])

export function interpretInvitationResponse(response: ResponseLike): InvitationClientOutcome {
  const body = record(response.body)
  const error = typeof body?.error === "string" && body.error ? body.error : undefined

  if (response.networkError) return { kind: "UNKNOWN", message: INVITATION_DELIVERY_UNCONFIRMED_MESSAGE }

  if (response.status === 200 && typeof body?.messageId === "string" && body.messageId) {
    return {
      kind: "SENT",
      messageId: body.messageId,
      sentAt: typeof body.sentAt === "string" ? body.sentAt : undefined,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
      auditRecorded: body.auditRecorded !== false,
    }
  }

  if (response.status === 502 && body?.delivery === "REJECTED") {
    return { kind: "NOT_SENT", message: error ?? "The email provider refused the invitation. Nothing was sent." }
  }

  // Our own pre-send refusals carry a JSON error. The same status without one (for example an infrastructure 503 or a
  // gateway page) says nothing about whether the provider was reached, so it is treated as unknown.
  if (BEFORE_SEND.has(response.status) && error) return { kind: "NOT_SENT", message: error }

  // 502 UNKNOWN, 200 without a message id, 5xx, gateway timeouts, malformed bodies: the outcome cannot be established.
  return { kind: "UNKNOWN", message: INVITATION_DELIVERY_UNCONFIRMED_MESSAGE }
}

/** Sending stays closed for a driver while any of that driver's applications has an unconfirmed invitation. */
export function hasUnconfirmedInvitation(
  applications: ReadonlyArray<{ driverMasterId: string; status: string }>,
  driverMasterId: string,
): boolean {
  return applications.some(
    (application) => application.driverMasterId === driverMasterId && application.status === INVITATION_DELIVERY_UNCONFIRMED_STATUS,
  )
}

export const SUBMISSION_SYNC_PAUSED_NOTICE =
  "Applicant submission synchronization is temporarily unavailable. Submitted applications cannot be retrieved right now, so a missing submission does not mean the applicant has not responded. Applicants who tried to submit were asked to try again later; nothing has been discarded."

/** Do not ask the paused service again for this long. */
export const SUBMISSION_SYNC_COOLDOWN_MS = 10 * 60 * 1000

export type SubmissionSyncState = "OK" | "PAUSED" | "FAILED"

export function classifySubmissionSyncStatus(status: number): SubmissionSyncState {
  if (status >= 200 && status < 300) return "OK"
  if (status === 503) return "PAUSED"
  return "FAILED"
}

export function shouldSkipSubmissionSync(nowMs: number, pausedAtMs: number | null | undefined): boolean {
  return typeof pausedAtMs === "number" && Number.isFinite(pausedAtMs) && nowMs - pausedAtMs >= 0 && nowMs - pausedAtMs < SUBMISSION_SYNC_COOLDOWN_MS
}
