import "server-only"

import { createHash } from "node:crypto"
import { readJsonBody } from "@/lib/api/canonical-response"
import type { DriverInvitationTokenPayload } from "@/lib/driver-invitation-token"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import { recordEvent } from "@/lib/master-register/server"

/**
 * Driver Application invitation sending, contained.
 *
 * The previous route trusted every field in the request body (company name, address, phone, email, driver, application,
 * recipient) and was reachable by any signed-in Clerk user. This module changes the trust model:
 *
 *   1. the caller must be an authenticated TES actor holding DRIVER_MANAGE (SYSTEM scope), proven by the authorization kernel;
 *   2. the request carries only references (company, driver, application, intended recipient). Everything that appears in
 *      the email and the invitation token (company identity, contact details, driver name, application type, region) comes
 *      from AUTHORITATIVE server records, resolved through InvitationRecordsPort inside the authorized transaction;
 *   3. the intended recipient must equal the driver's address on the authoritative record;
 *   4. an intent event is appended to the Master Register BEFORE anything is sent (no event, no send), and the outcome is
 *      appended afterwards.
 *
 * Canonical driver and application records do not exist in PostgreSQL yet (docs/canonical-data-cutover-browser-authority-
 * retirement.md, Phases C-E not closed): applications and driver masters live in browser storage, which is not authoritative.
 * The production port therefore reports UNAVAILABLE and the endpoint FAILS CLOSED: nothing is sent. It must be replaced by a
 * PostgreSQL-backed implementation as part of the cutover; no allow-list, browser data or caller-supplied identifier is
 * accepted in its place.
 */

export const INVITATION_UNAVAILABLE_MESSAGE =
  "Driver Application invitations are temporarily unavailable while canonical application records are being established. Nothing was sent."
export const INVITATION_NOT_FOUND_MESSAGE = "The invitation could not be prepared for the supplied records."
export const INVITATION_RECIPIENT_MESSAGE = "The recipient does not match the Driver address on file."

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_REFERENCE_LENGTH = 200
const MAX_EMAIL_LENGTH = 254
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

export type OperatingRegion = "Canada" | "United States" | "Cross-Border"

export type InvitationRequest = {
  companyId: string
  driverMasterId: string
  applicationId: string
  recipientEmail: string
}

/** Everything the email and token may contain. Only an InvitationRecordsPort may produce this. */
export type AuthoritativeInvitationContext = {
  companyId: string
  companyName: string
  companyAddress?: { street?: string; city?: string; stateProvince?: string; postalCode?: string; country?: string }
  companyPhone?: string
  companyEmail?: string
  driverMasterId: string
  driverName: string
  /** The Driver's address on the authoritative record. The caller's intended recipient must equal it. */
  driverEmail: string
  applicationId: string
  applicationType: string
  operatingRegion: OperatingRegion
}

export type InvitationRecordsResult =
  | { status: "VERIFIED"; context: AuthoritativeInvitationContext }
  | { status: "NOT_FOUND" }
  | { status: "UNAVAILABLE" }

export interface InvitationRecordsPort {
  /** Called inside the authorized transaction. `client` is the transaction's PostgreSQL client. */
  resolve(client: unknown, request: Pick<InvitationRequest, "companyId" | "driverMasterId" | "applicationId">): Promise<InvitationRecordsResult>
}

/**
 * Production port. Canonical application ownership cannot be established yet, so it never verifies anything.
 * Deliberately has no allow-list and never inspects browser storage or the request.
 */
export const unavailableInvitationRecords: InvitationRecordsPort = {
  async resolve() {
    return { status: "UNAVAILABLE" }
  },
}

export type AuthorizedScope = {
  client: unknown
  actor: { id: string; actorType: "HUMAN" | "SYSTEM" | "AUTOMATION" | "INTEGRATION" | "SERVICE_ACCOUNT" }
  register: MasterRegisterRepository
}

export type OutboundInvitation = {
  to: string
  subject: string
  html: string
  idempotencyKey: string
}

export class InvitationProviderError extends Error {
  constructor() {
    super("The email provider did not accept the invitation.")
    this.name = "InvitationProviderError"
  }
}

export interface InvitationDeps {
  /** Clerk subject of the current session, or null. */
  getAuthenticatedSubject(): Promise<string | null>
  /** Runs `work` in one transaction after proving the TES actor holds DRIVER_MANAGE. Throws on denial; `work` never runs then. */
  runAuthorized<T>(work: (scope: AuthorizedScope) => Promise<T>): Promise<T>
  records: InvitationRecordsPort
  emailConfigured(): boolean
  createToken(payload: DriverInvitationTokenPayload): string
  sendEmail(message: OutboundInvitation): Promise<{ messageId: string }>
  now(): Date
  origin: string
}

export type InvitationOutcome =
  | { status: 401 | 400 | 404 | 422 | 502 | 503; error: string }
  | { status: 200; messageId: string; sentAt: string; expiresAt: string; auditRecorded: boolean }

const normalizeEmail = (value: string) => value.trim().toLowerCase()
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c))

function parseRequest(body: Record<string, unknown>): InvitationRequest | null {
  const read = (key: string, max = MAX_REFERENCE_LENGTH) => {
    const value = body[key]
    return typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null
  }
  const companyId = read("companyId")
  const driverMasterId = read("driverMasterId")
  const applicationId = read("applicationId")
  const recipient = read("recipientEmail", MAX_EMAIL_LENGTH)
  if (!companyId || !driverMasterId || !applicationId || !recipient || !EMAIL.test(recipient)) return null
  return { companyId, driverMasterId, applicationId, recipientEmail: normalizeEmail(recipient) }
}

function buildEmail(context: AuthoritativeInvitationContext, invitationUrl: string): { subject: string; html: string } {
  return {
    subject: `${context.companyName} — Complete your driver application`,
    html: `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,sans-serif;color:#172033"><div style="max-width:620px;margin:32px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden"><div style="padding:24px 28px;border-bottom:1px solid #e5e7eb"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280">Powered by TES</div><h1 style="font-size:22px;margin:8px 0 0">Driver Application</h1></div><div style="padding:28px"><p>Hello ${esc(context.driverName)},</p><p>${esc(context.companyName)} has invited you to complete your driver application through TES.</p><p style="font-size:13px;color:#6b7280"><strong>Application:</strong> ${esc(context.applicationId)}<br><strong>Type:</strong> ${esc(context.applicationType)}<br><strong>Operating region:</strong> ${esc(context.operatingRegion)}</p><p style="margin:28px 0"><a href="${esc(invitationUrl)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open Driver Application</a></p><p style="font-size:12px;color:#6b7280">This secure invitation expires in 7 days. If you were not expecting it, do not use the link.</p></div><div style="padding:16px 28px;background:#fafafa;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280">TES · Trucking compliance technology · truckease.co</div></div></body></html>`,
  }
}

function eventBase(scope: AuthorizedScope, context: AuthoritativeInvitationContext, operation: string) {
  return {
    actor: { actorType: scope.actor.actorType, actorId: scope.actor.id },
    action: { operation },
    target: {
      resourceType: "driver_application_invitation",
      resourceId: context.applicationId,
      subjectReferences: [`organization:${context.companyId}`, `driver:${context.driverMasterId}`],
    },
    source: { sourceType: "APPLICATION", component: "driver-applications", workflow: operation },
    classification: { materiality: "MATERIAL" as const, sensitivity: "CONFIDENTIAL" as const },
    // The recipient is recorded only as a hash.
    change: {
      changedFields: ["recipientEmail"],
      fieldChanges: [{ field: "recipientEmail", after: { kind: "HASH" as const, algorithm: "SHA-256", value: sha256(context.driverEmail) } }],
    },
  }
}

/**
 * Handles one invitation request. Order is the safety property: session, then TES authorization, then the body, then
 * authoritative records, then audit-before-send, then the provider.
 */
export async function handleInvitationRequest(request: Request, deps: InvitationDeps): Promise<InvitationOutcome> {
  if (!(await deps.getAuthenticatedSubject())) return { status: 401, error: "Authentication required." }

  // Throws TesAuthorizationDeniedError / TesIdentityRequiredError (mapped to 403 by the route) before the body is read.
  await deps.runAuthorized(async () => undefined)

  const input = parseRequest(await readJsonBody(request))
  if (!input) return { status: 400, error: "The invitation request is incomplete." }

  type Prepared =
    | { kind: "STOP"; outcome: InvitationOutcome }
    | { kind: "SEND"; context: AuthoritativeInvitationContext; message: OutboundInvitation; intentEventId: string; expiresAt: string }

  const prepared = await deps.runAuthorized<Prepared>(async (scope) => {
    const resolved = await deps.records.resolve(scope.client, input)
    if (resolved.status === "UNAVAILABLE") return { kind: "STOP", outcome: { status: 503, error: INVITATION_UNAVAILABLE_MESSAGE } }
    if (resolved.status !== "VERIFIED") return { kind: "STOP", outcome: { status: 404, error: INVITATION_NOT_FOUND_MESSAGE } }

    // A port bug must not turn into a send for a different record.
    const { context } = resolved
    if (context.companyId !== input.companyId || context.driverMasterId !== input.driverMasterId || context.applicationId !== input.applicationId) {
      return { kind: "STOP", outcome: { status: 404, error: INVITATION_NOT_FOUND_MESSAGE } }
    }
    if (normalizeEmail(context.driverEmail) !== input.recipientEmail || !EMAIL.test(context.driverEmail)) {
      return { kind: "STOP", outcome: { status: 422, error: INVITATION_RECIPIENT_MESSAGE } }
    }
    if (!deps.emailConfigured()) return { kind: "STOP", outcome: { status: 503, error: INVITATION_UNAVAILABLE_MESSAGE } }

    const expiresAt = new Date(deps.now().getTime() + INVITATION_LIFETIME_MS).toISOString()
    let token: string
    try {
      token = deps.createToken({
        version: 1,
        companyId: context.companyId,
        companyName: context.companyName,
        companyAddress: context.companyAddress,
        companyPhone: context.companyPhone,
        companyEmail: context.companyEmail,
        driverMasterId: context.driverMasterId,
        applicationId: context.applicationId,
        recipientEmail: normalizeEmail(context.driverEmail),
        driverName: context.driverName,
        operatingRegion: context.operatingRegion,
        expiresAt,
      })
    } catch {
      return { kind: "STOP", outcome: { status: 503, error: INVITATION_UNAVAILABLE_MESSAGE } }
    }

    const { subject, html } = buildEmail(context, `${deps.origin}/driver-application?token=${encodeURIComponent(token)}`)
    // Audit before send: if this append fails the transaction rolls back and nothing is sent.
    const intent = await recordEvent(scope.register, {
      ...eventBase(scope, context, "prepare_driver_application_invitation"),
      eventType: "NOTIFICATION_CREATED",
      outcome: { result: "UNRESOLVED", reasonCode: "INVITATION_PREPARED" },
    })
    return {
      kind: "SEND",
      context,
      expiresAt,
      intentEventId: intent.eventId,
      message: { to: normalizeEmail(context.driverEmail), subject, html, idempotencyKey: `driver-application/${context.applicationId}` },
    }
  })

  if (prepared.kind === "STOP") return prepared.outcome

  const outcomeEvent = (result: "SUCCESS" | "FAILURE", reasonCode: string, providerMessageId?: string) =>
    deps.runAuthorized((scope) =>
      recordEvent(scope.register, {
        ...eventBase(scope, prepared.context, "send_driver_application_invitation"),
        eventType: "COMMUNICATION_SENT",
        relationships: { causationEventId: prepared.intentEventId },
        ...(providerMessageId ? { evidence: { supportingReferences: [`resend:message:${providerMessageId}`] } } : {}),
        outcome: { result, reasonCode },
      }),
    )

  let messageId: string
  try {
    messageId = (await deps.sendEmail(prepared.message)).messageId
  } catch {
    try {
      await outcomeEvent("FAILURE", "PROVIDER_REJECTED")
    } catch {
      // The intent event already records that a send was attempted; the failure outcome is the only thing missing.
    }
    return { status: 502, error: "The email provider did not accept the invitation. Nothing was delivered." }
  }

  let auditRecorded = true
  try {
    await outcomeEvent("SUCCESS", "PROVIDER_ACCEPTED", messageId)
  } catch {
    // The email is already sent and cannot be recalled. The intent event exists; surface the gap, never claim a full record.
    auditRecorded = false
  }
  return { status: 200, messageId, sentAt: deps.now().toISOString(), expiresAt: prepared.expiresAt, auditRecorded }
}
