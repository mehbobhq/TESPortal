import "server-only"

import type { PoolClient } from "pg"
import {
  requireTesAuthorizationWithClient,
  type TesAuthorizationDecision,
} from "@/lib/auth/tes-authorization"
import type { TesCustomerCapability } from "@/lib/auth/tes-capabilities"
import {
  assertNoTenantContext,
  runExclusiveAuthorizedWork,
} from "@/lib/auth/tes-transaction-guard"
import { withPostgresTransaction } from "@/lib/database/postgres-transaction"

export class TesCustomerContextError extends Error {
  readonly code = "TES_CUSTOMER_CONTEXT_INVALID"

  constructor() {
    super("TES customer context is invalid.")
    this.name = "TesCustomerContextError"
  }
}

function normalizeCustomerId(customerId: string): string {
  const normalized = customerId.trim().toLowerCase()

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  ) {
    throw new TesCustomerContextError()
  }

  return normalized
}

export type CustomerAuthorizationDecision = TesAuthorizationDecision<{
  type: "CUSTOMER"
  customerId: string
}>

export type AuthorizedCustomerWork<T> = (
  client: PoolClient,
  decision: CustomerAuthorizationDecision,
) => Promise<T>

/**
 * Authorizes the authenticated TES actor for one customer and, only after
 * authorization succeeds, establishes transaction-local PostgreSQL tenant
 * context on the same checked-out connection used by the caller's work.
 *
 * Browser/request customer IDs are requests for scope, never proof of access.
 *
 * CUSTOMER scope does not inherit from, and is not inherited by, SYSTEM scope:
 * an actor needs an effective CUSTOMER assignment for this exact customer (or
 * Master Account, for a customer that exists). The connection must carry no tenant
 * context when this starts. Nested withAuthorized* calls are rejected.
 */
export async function withAuthorizedCustomer<T>(
  customerId: string,
  capability: TesCustomerCapability,
  work: AuthorizedCustomerWork<T>,
): Promise<T> {
  const normalizedCustomerId = normalizeCustomerId(customerId)

  return runExclusiveAuthorizedWork(() =>
    withPostgresTransaction(async (client) => {
      await assertNoTenantContext(client)

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

      return work(client, decision as CustomerAuthorizationDecision)
    }),
  )
}
