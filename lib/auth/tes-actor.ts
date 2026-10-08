import "server-only"

import { auth } from "@clerk/nextjs/server"
import type { Pool, PoolClient } from "pg"
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

type ActorQueryable = Pick<Pool | PoolClient, "query">

async function resolveLinkedActor(
  providerSubject: string,
  database: ActorQueryable,
): Promise<TesActor | null> {
  const result = await database.query<ActorIdentityRow>(
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

  await database.query(
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

async function requireAuthenticatedClerkSubject(): Promise<string> {
  const { userId } = await auth()

  if (!userId) {
    throw new TesIdentityRequiredError()
  }

  return userId
}

async function requireTesActorWithDatabase(
  database: ActorQueryable,
): Promise<TesActor> {
  const providerSubject = await requireAuthenticatedClerkSubject()

  const actor = await resolveLinkedActor(providerSubject, database)
  if (!actor) {
    throw new TesIdentityRequiredError()
  }

  return actor
}

/**
 * Resolves the current authenticated Clerk session to TES's permanent actor ID.
 *
 * This function never provisions an actor and never uses email as an identity
 * anchor. A valid Clerk session without an existing active TES identity link
 * fails closed.
 */
export async function requireTesActor(): Promise<TesActor> {
  const pool = await getPostgresPool()
  return requireTesActorWithDatabase(pool)
}

/**
 * Transaction-bound variant of requireTesActor().
 *
 * Clerk still establishes the authenticated provider subject server-side, but
 * all PostgreSQL identity resolution and authentication timestamp updates run
 * through the caller's already checked-out transaction client.
 */
export async function requireTesActorWithClient(
  client: PoolClient,
): Promise<TesActor> {
  return requireTesActorWithDatabase(client)
}
