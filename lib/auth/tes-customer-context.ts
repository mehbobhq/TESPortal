import "server-only"

import type { PoolClient } from "pg"
import {
  requireTesAuthorizationWithClient,
  type TesAuthorizationDecision,
} from "@/lib/auth/tes-authorization"
import { withPostgresTransaction } from "@/lib/database/postgres-transaction"

export class TesCustomerContextError extends Error {
  readonly code = "TES_CUSTOMER_CONTEXT_INVALID"

  constructor() {
    super("TES customer context is invalid.")
    this.name = "TesCustomerContextError"
  }
}

function normalizeCustomerId(customerId: string): string {
  const normalized = customerId.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new TesCustomerContextError()
  }
  return normalized
}

export type AuthorizedCustomerWork<T> = (
  client: PoolClient,
  decision: TesAuthorizationDecision,
) => Promise<T>

/**
 * Authorizes the authenticated TES actor for one customer and, only after
 * authorization succeeds, establishes transaction-local PostgreSQL tenant
 * context on the same checked-out connection used by the caller's work.
 *
 * Browser/request customer IDs are requests for scope, never proof of access.
 */
export async function withAuthorizedCustomer<T>(
  customerId: string,
  capability: string,
  work: AuthorizedCustomerWork<T>,
): Promise<T> {
  const normalizedCustomerId = normalizeCustomerId(customerId)

  return withPostgresTransaction(async (client) => {
    const decision = await requireTesAuthorizationWithClient(client, {
      capability,
      scope: {
        type: "CUSTOMER",
        customerId: normalizedCustomerId,
      },
    })

    await client.query(
      `SELECT set_config('tes.customer_id', $1, true)`,
      [normalizedCustomerId],
    )

    const context = await client.query<{ customer_id: string | null }>(
      `SELECT tes_security.current_customer_id()::text AS customer_id`,
    )

    if (context.rows[0]?.customer_id !== normalizedCustomerId) {
      throw new TesCustomerContextError()
    }

    return work(client, decision)
  })
}
