import "server-only"

import { getPostgresPool } from "@/lib/database/postgres"
import { requireTesActor, type TesActor } from "@/lib/auth/tes-actor"

export type TesAuthorizationPrincipal = {
  actor: TesActor
  isMasterAccount: boolean
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

/**
 * Resolves the authenticated TES actor and its system-level Master Account
 * authority. Authentication and authorization remain separate boundaries.
 *
 * This function does not establish customer context and does not grant ordinary
 * relationship/capability access. Those decisions are evaluated separately.
 */
export async function requireTesAuthorizationPrincipal(): Promise<TesAuthorizationPrincipal> {
  const actor = await requireTesActor()
  const pool = await getPostgresPool()

  const result = await pool.query<MasterAccountRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM public.master_account_authority AS maa
       WHERE maa.actor_id = $1
         AND maa.status = 'active'
     ) AS is_master_account`,
    [actor.id],
  )

  const row = result.rows[0]
  if (!row) {
    throw new TesAuthorizationDeniedError()
  }

  return {
    actor,
    isMasterAccount: row.is_master_account,
  }
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
