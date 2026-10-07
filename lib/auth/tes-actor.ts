import "server-only"

import { auth } from "@clerk/nextjs/server"
import { getPostgresPool } from "@/lib/database/postgres"

const CLERK_PROVIDER = "clerk"

export type TesActor = {
  id: string
  actorType: "HUMAN" | "SYSTEM" | "AUTOMATION" | "INTEGRATION" | "SERVICE_ACCOUNT"
}

export class TesIdentityRequiredError extends Error {
  readonly code = "TES_IDENTITY_REQUIRED"

  constructor() {
    super("TES identity is not available for this authenticated session.")
    this.name = "TesIdentityRequiredError"
  }
}

type ActorIdentityRow = {
  actor_id: string
  actor_type: TesActor["actorType"]
  actor_status: string
  identity_status: string
}

async function resolveLinkedActor(providerSubject: string): Promise<TesActor | null> {
  const pool = await getPostgresPool()

  const result = await pool.query<ActorIdentityRow>(
    `SELECT
       ai.actor_id,
       a.actor_type,
       a.status AS actor_status,
       ai.status AS identity_status
     FROM public.authentication_identities AS ai
     INNER JOIN public.actors AS a
       ON a.id = ai.actor_id
     WHERE ai.provider = $1
       AND ai.provider_subject = $2
     LIMIT 1`,
    [CLERK_PROVIDER, providerSubject],
  )

  const row = result.rows[0]
  if (!row || row.identity_status !== "active" || row.actor_status !== "active") {
    return null
  }

  await pool.query(
    `UPDATE public.authentication_identities
     SET last_authenticated_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE provider = $1
       AND provider_subject = $2
       AND status = 'active'`,
    [CLERK_PROVIDER, providerSubject],
  )

  return {
    id: row.actor_id,
    actorType: row.actor_type,
  }
}

/**
 * Resolves the current authenticated Clerk session to TES's permanent actor ID.
 *
 * This function never provisions an actor and never uses email as an identity
 * anchor. A valid Clerk session without an existing active TES identity link
 * fails closed.
 */
export async function requireTesActor(): Promise<TesActor> {
  const { userId } = await auth()

  if (!userId) {
    throw new TesIdentityRequiredError()
  }

  const actor = await resolveLinkedActor(userId)
  if (!actor) {
    throw new TesIdentityRequiredError()
  }

  return actor
}
