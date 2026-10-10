import "server-only"

import type { PoolClient } from "pg"
import {
  requireTesAuthorizationWithClient,
  TesCapabilityScopeError,
  type TesAuthorizationDecision,
} from "@/lib/auth/tes-authorization"
import type { TesSystemCapability } from "@/lib/auth/tes-capabilities"
import {
  assertNoTenantContext,
  runExclusiveAuthorizedWork,
} from "@/lib/auth/tes-transaction-guard"
import { withPostgresTransaction } from "@/lib/database/postgres-transaction"

export { TesNestedAuthorizationError, TesTenantContextPresentError } from "@/lib/auth/tes-transaction-guard"

export type SystemAuthorizationDecision = TesAuthorizationDecision<{ type: "SYSTEM" }>

export type AuthorizedSystemWork<T> = (
  client: PoolClient,
  decision: SystemAuthorizationDecision,
) => Promise<T>

/**
 * Authorizes the authenticated TES actor for SYSTEM scope and runs `work` on the
 * SAME checked-out connection and transaction as the authorization decision.
 *
 * SYSTEM scope is global TES authority. It is deliberately not tenant access:
 *
 *   - tes.customer_id is never established, so RLS-protected tenant tables return
 *     nothing under a SYSTEM request. Opening a customer is a separate act that
 *     goes through withAuthorizedCustomer().
 *   - the connection must carry no tenant context when this starts (fail closed).
 *   - SYSTEM and CUSTOMER scopes do not inherit from each other.
 *
 * `work` runs only after authorization succeeds; on any denial it never runs and
 * the transaction is rolled back. Master Account is supported by the evaluator
 * (relationship-free) but still needs a real, active capability.
 *
 * Do not call another withAuthorized* wrapper from inside `work`: it would take a
 * second pooled connection in a different transaction, so it is rejected.
 */
export async function withAuthorizedSystem<T>(
  capability: TesSystemCapability,
  work: AuthorizedSystemWork<T>,
): Promise<T> {
  return runExclusiveAuthorizedWork(() =>
    withPostgresTransaction(async (client) => {
      await assertNoTenantContext(client)

      const decision = await requireTesAuthorizationWithClient(client, {
        capability,
        scope: { type: "SYSTEM" },
      })

      if (decision.scope.type !== "SYSTEM") {
        throw new TesCapabilityScopeError()
      }

      return work(client, decision as SystemAuthorizationDecision)
    }),
  )
}
