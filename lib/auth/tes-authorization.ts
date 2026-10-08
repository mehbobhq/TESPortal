import "server-only"

import type { Pool, PoolClient } from "pg"
import { getPostgresPool } from "@/lib/database/postgres"
import {
  requireTesActor,
  requireTesActorWithClient,
  type TesActor,
} from "@/lib/auth/tes-actor"

export type TesAuthorizationScope =
  | { type: "SYSTEM" }
  | { type: "CUSTOMER"; customerId: string }

export type TesAuthorizationRequest = {
  capability: string
  scope: TesAuthorizationScope
}

export type TesAuthorizationPrincipal = {
  actor: TesActor
  isMasterAccount: boolean
}

export type TesAuthorizationDecision = TesAuthorizationPrincipal & {
  allowed: true
  capability: string
  scope: TesAuthorizationScope
}

export class TesAuthorizationDeniedError extends Error {
  readonly code = "TES_AUTHORIZATION_DENIED"

  constructor() {
    super("TES authorization denied.")
    this.name = "TesAuthorizationDeniedError"
  }
}

type MasterAccountRow = {
  is_master_account: boolean
}

type AuthorizationRow = {
  allowed: boolean
}

function normalizeCapabilityCode(capability: string): string {
  const normalized = capability.trim().toUpperCase()
  if (!normalized) throw new TesAuthorizationDeniedError()
  return normalized
}

/**
 * Resolves the authenticated TES actor and its system-level Master Account
 * authority. Authentication and authorization remain separate boundaries.
 */
type AuthorizationQueryable = Pick<Pool | PoolClient, "query">

async function resolveTesAuthorizationPrincipal(
  actor: TesActor,
  database: AuthorizationQueryable,
): Promise<TesAuthorizationPrincipal> {
  const result = await database.query<MasterAccountRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM public.master_account_authority AS maa
       WHERE maa.actor_id = $1
         AND maa.status = 'active'
     ) AS is_master_account`,
    [actor.id],
  )

  const row = result.rows[0]
  if (!row) throw new TesAuthorizationDeniedError()

  return {
    actor,
    isMasterAccount: row.is_master_account,
  }
}

export async function requireTesAuthorizationPrincipal(): Promise<TesAuthorizationPrincipal> {
  const actor = await requireTesActor()
  const pool = await getPostgresPool()
  return resolveTesAuthorizationPrincipal(actor, pool)
}

/**
 * Transaction-aware principal resolution for server workflows that must keep
 * authorization and later tenant context on one checked-out connection.
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
 * authentication, Master Register accountability, or integrity controls.
 */
export async function requireTesMasterAccount(): Promise<TesAuthorizationPrincipal> {
  const principal = await requireTesAuthorizationPrincipal()

  if (!principal.isMasterAccount) {
    throw new TesAuthorizationDeniedError()
  }

  return principal
}

/**
 * Requires an ordinary TES capability within an explicit scope.
 *
 * Master Account is the centralized authority path and is allowed before
 * ordinary relationship/grant evaluation. Ordinary actors are default-deny.
 *
 * A broad grant (assignment_id IS NULL) is still constrained by the active
 * assignment selected for this request. An assignment-specific grant must
 * point to that exact assignment. This also guarantees that a grant cannot
 * borrow an assignment belonging to another relationship.
 */
async function evaluateTesAuthorization(
  principal: TesAuthorizationPrincipal,
  request: TesAuthorizationRequest,
  database: AuthorizationQueryable,
): Promise<TesAuthorizationDecision> {
  const capability = normalizeCapabilityCode(request.capability)

  if (principal.isMasterAccount) {
    return {
      ...principal,
      allowed: true,
      capability,
      scope: request.scope,
    }
  }

  const scopeType = request.scope.type
  const customerId =
    request.scope.type === "CUSTOMER" ? request.scope.customerId.trim() : null

  if (scopeType === "CUSTOMER" && !customerId) {
    throw new TesAuthorizationDeniedError()
  }

  const result = await database.query<AuthorizationRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM public.actor_relationships AS ar
       INNER JOIN public.relationship_assignments AS ra
         ON ra.relationship_id = ar.id
        AND ra.status = 'active'
        AND ra.scope_type = $3
        AND (
          ($3 = 'SYSTEM' AND ra.customer_id IS NULL)
          OR
          ($3 = 'CUSTOMER' AND ra.customer_id = $4::uuid)
        )
       INNER JOIN public.relationship_capability_grants AS rcg
         ON rcg.relationship_id = ar.id
        AND rcg.status = 'active'
        AND (
          rcg.assignment_id IS NULL
          OR rcg.assignment_id = ra.id
        )
       INNER JOIN public.capabilities AS c
         ON c.id = rcg.capability_id
        AND c.is_active = true
        AND c.code = $2
       WHERE ar.actor_id = $1
         AND ar.status = 'active'
     ) AS allowed`,
    [principal.actor.id, capability, scopeType, customerId],
  )

  if (result.rows[0]?.allowed !== true) {
    throw new TesAuthorizationDeniedError()
  }

  return {
    ...principal,
    allowed: true,
    capability,
    scope: request.scope,
  }
}

export async function requireTesAuthorization(
  request: TesAuthorizationRequest,
): Promise<TesAuthorizationDecision> {
  const principal = await requireTesAuthorizationPrincipal()
  const pool = await getPostgresPool()
  return evaluateTesAuthorization(principal, request, pool)
}

/**
 * Transaction-aware authorization. Clerk establishes the authenticated subject,
 * while TES Actor resolution, principal resolution, and authorization evaluation
 * all use the supplied checked-out transaction client.
 */
export async function requireTesAuthorizationWithClient(
  client: PoolClient,
  request: TesAuthorizationRequest,
): Promise<TesAuthorizationDecision> {
  const principal = await requireTesAuthorizationPrincipalWithClient(client)
  return evaluateTesAuthorization(principal, request, client)
}
