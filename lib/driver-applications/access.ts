import "server-only"

import { auth } from "@clerk/nextjs/server"
import { withAuthorizedSystem } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import { createDriverInvitationToken } from "@/lib/driver-invitation-token"
import {
  InvitationProviderError,
  unavailableInvitationRecords,
  type InvitationDeps,
  type OutboundInvitation,
} from "@/lib/driver-applications/invitation"

/**
 * Applicant submissions can be read only by a TES actor holding DRIVER_READ, AND only for applications whose owning
 * customer is established by a canonical server record. The server-side submission store (.tes-data) records no owner, so
 * the read is closed: this guard exists so the route authenticates and authorizes first and can be re-opened later by
 * adding the ownership check here, not by loosening the route.
 */
export const APPLICANT_SUBMISSION_READ_UNAVAILABLE_MESSAGE =
  "Applicant submission retrieval is temporarily unavailable while canonical application records are being established."

export async function authorizeApplicantSubmissionRead(): Promise<void> {
  await withAuthorizedSystem("DRIVER_READ", async () => undefined)
}

export const APPLICANT_SUBMISSION_WRITE_UNAVAILABLE_MESSAGE =
  "Application submission is temporarily unavailable. Your answers were not saved on the server; please try again later."

const FROM = "TES <applications@truckease.co>"

/** Statuses on which Resend explicitly did not process the request. Everything else is treated as an unknown outcome. */
const CONFIRMED_REFUSAL_STATUSES = new Set([400, 401, 403, 422, 429])

async function sendWithResend(message: OutboundInvitation): Promise<{ messageId: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new InvitationProviderError("REJECTED") // nothing was attempted
  let response: Response
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey },
      body: JSON.stringify({ from: FROM, to: [message.to], subject: message.subject, html: message.html }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new InvitationProviderError("UNKNOWN") // network failure or timeout: the request may have been processed
  }
  const result = (await response.json().catch(() => null)) as { id?: string } | null
  if (response.ok && typeof result?.id === "string" && result.id) return { messageId: result.id }
  throw new InvitationProviderError(!response.ok && result !== null && CONFIRMED_REFUSAL_STATUSES.has(response.status) ? "REJECTED" : "UNKNOWN")
}

export function productionInvitationDeps(origin: string): InvitationDeps {
  return {
    getAuthenticatedSubject: async () => (await auth()).userId ?? null,
    runAuthorized: (work) =>
      withAuthorizedSystem("DRIVER_MANAGE", (client, decision) =>
        work({
          client,
          actor: { id: decision.actor.id, actorType: decision.actor.actorType },
          register: new PostgresMasterRegisterRepository(client),
        }),
      ),
    records: unavailableInvitationRecords,
    emailConfigured: () => Boolean(process.env.RESEND_API_KEY),
    createToken: createDriverInvitationToken,
    sendEmail: sendWithResend,
    now: () => new Date(),
    origin,
  }
}
