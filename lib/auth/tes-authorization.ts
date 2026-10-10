import "server-only"

import type { PoolClient } from "pg"
import { getPostgresPool } from "@/lib/database/postgres"
import {
  requireTesActor,
  requireTesActorWithClient,
} from "@/lib/auth/tes-actor"
import {
  TesAuthorizationDeniedError,
  evaluateTesAuthorization,
  resolveTesAuthorizationPrincipal,
  type TesAuthorizationDecision,
  type TesAuthorizationPrincipal,
  type TesAuthorizationRequest,
} from "@/lib/auth/tes-authorization-core"

/**
 * Server entry for TES authorization.
 *
 * The decision logic lives in tes-authorization-core.ts (database only, testable
 * without Clerk). This module binds it to the authenticated Clerk -> TES Actor
 * boundary. Application code should not call these functions directly: use
 * withAuthorizedSystem() or withAuthorizedCustomer(), which keep authorization
 * and the caller's work on one PostgreSQL transaction and keep SYSTEM and
 * CUSTOMER scopes distinct.
 */

export {
  TesAuthorizationDeniedError,
  TesCapabilityScopeError,
  TesUnknownCapabilityError,
  type TesAuthorizationDecision,
  type TesAuthorizationPrincipal,
  type TesAuthorizationRequest,
  type TesAuthorizationScope,
} from "@/lib/auth/tes-authorization-core"

/**
 * Resolves the authenticated actor and its Master Account authority on a pooled
 * connection.
 *
 * Only for guards that do no further database work. Anything that goes on to
 * touch tenant or business data must use a withAuthorized* wrapper so that the
 * authorization decision and the work share one connection and transaction.
 */
export async function requireTesAuthorizationPrincipal(): Promise<TesAuthorizationPrincipal> {
  const actor = await requireTesActor()
  const pool = await getPostgresPool()
  return resolveTesAuthorizationPrincipal(actor, pool)
}

/**
 * Transaction-aware principal resolution for server workflows that must keep
 * authorization and later work on one checked-out connection.
 *
 * The authenticated actor still comes exclusively from the Clerk -> TES Actor
 * boundary; callers cannot supply or impersonate an actor ID.
 */
export async function requireTesAuthorizationPrincipalWithClient(
  client: PoolClient,
): Promise<TesAuthorizationPrincipal> {
  const actor = await requireTesActorWithClient(client)
  return resolveTesAuthorizationPrincipal(actor, client)
}

/**
 * Requires TES's centralized Master Account authority.
 *
 * This is an application authorization decision only. It does not bypass RLS,
 * authentication, Master Register accountability, or integrity controls. Like
 * requireTesAuthorizationPrincipal(), it is for guards with no further database
 * work.
 */
export async function requireTesMasterAccount(): Promise<TesAuthorizationPrincipal> {
  const principal = await requireTesAuthorizationPrincipal()

  if (!principal.isMasterAccount) {
    throw new TesAuthorizationDeniedError()
  }

  return principal
}

/**
 * Transaction-aware authorization. Clerk establishes the authenticated subject,
 * while TES Actor resolution, principal resolution, and authorization evaluation
 * all use the supplied checked-out transaction client.
 *
 * The capability is a typed TesCapability and is validated against
 * public.capabilities (existence and active state) for every actor, including
 * Master Account. See tes-authorization-core.ts for the exact rules.
 */
export async function requireTesAuthorizationWithClient(
  client: PoolClient,
  request: TesAuthorizationRequest,
): Promise<TesAuthorizationDecision> {
  const principal = await requireTesAuthorizationPrincipalWithClient(client)
  return evaluateTesAuthorization(principal, request, client)
}
