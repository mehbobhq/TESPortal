import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"
import type { PoolClient } from "pg"
import { withPostgresTransaction } from "@/lib/database/postgres-transaction"

/**
 * The APPLICANT access scope. An applicant has no TES login and no database identity: possession of the invitation secret opens a server-side
 * session (only its SHA-256 is stored), and every later request presents that session cookie. This module is the ONLY unauthenticated database
 * entry point. It runs nothing but the narrow SECURITY DEFINER functions of migration 0041 (and the Master Register insert policy that lets an
 * applicant record material actions as THEIR OWN actor); it never sets staff, customer or tenant context and never reads a table directly.
 *
 *   openApplicantSession   invitation secret -> session (creates the applicant actor + application once per invitation)
 *   withApplicantSession   validates session (+ CSRF for writes), runs `work` on ONE transaction inside that applicant context
 *   applicantRateCheck     persistent fixed-window rate limit (no personal data)
 */

export const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")

export class ApplicantSessionError extends Error {
  readonly status: 401 | 403 | 429
  constructor(status: 401 | 403 | 429, message: string) {
    super(message)
    this.name = "ApplicantSessionError"
    this.status = status
  }
}

export interface ApplicantSession {
  sessionId: string
  applicationId: string
  organizationId: string
  actorId: string
  applicationStatus: "DRAFT" | "SUBMITTED"
}

export async function applicantRateCheck(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  return withPostgresTransaction(async (client) => {
    const r = await client.query<{ ok: boolean }>(`SELECT tes_security.applicant_rate_check($1, $2, $3) AS ok`, [sha256Hex(key), limit, windowSeconds])
    return r.rows[0]?.ok === true
  })
}

export async function openApplicantSession(input: { secretHash: string; sessionHash: string; csrfHash: string; ttlSeconds: number; clientHash: string | null }) {
  return withPostgresTransaction(async (client) => {
    const r = await client.query<{ session_id: string; application_id: string; expires_at: Date }>(
      `SELECT * FROM tes_security.open_applicant_session($1, $2, $3, $4, $5)`,
      [input.secretHash, input.sessionHash, input.csrfHash, input.ttlSeconds, input.clientHash],
    )
    const row = r.rows[0]
    return row ? { sessionId: row.session_id, applicationId: row.application_id, expiresAt: row.expires_at.toISOString() } : null
  })
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Runs `work` in the applicant context of a valid session. Writes must also present the CSRF token issued with the session (compared to its stored hash).
 * An unknown, expired, revoked or superseded session is indistinguishable: 401.
 */
export async function withApplicantSession<T>(
  sessionToken: string | null | undefined,
  options: { csrfToken?: string | null; requireCsrf: boolean },
  work: (client: PoolClient, session: ApplicantSession) => Promise<T>,
): Promise<T> {
  if (!sessionToken || sessionToken.length < 20 || sessionToken.length > 200) throw new ApplicantSessionError(401, "Your session has ended. Open the link from your email again.")
  return withPostgresTransaction(async (client) => {
    const r = await client.query<{ session_id: string; application_id: string; organization_id: string; actor_id: string; csrf_hash: string; application_status: "DRAFT" | "SUBMITTED" }>(
      `SELECT * FROM tes_security.enter_applicant_context($1)`,
      [sha256Hex(sessionToken)],
    )
    const row = r.rows[0]
    if (!row) throw new ApplicantSessionError(401, "Your session has ended. Open the link from your email again.")
    if (options.requireCsrf && (!options.csrfToken || !safeEqual(sha256Hex(options.csrfToken), row.csrf_hash))) throw new ApplicantSessionError(403, "The request could not be verified. Reload the page and try again.")
    return work(client, { sessionId: row.session_id, applicationId: row.application_id, organizationId: row.organization_id, actorId: row.actor_id, applicationStatus: row.application_status })
  })
}
