import "server-only"

import { requireTesAuthorizationPrincipalWithClient } from "@/lib/auth/tes-authorization"
import {
  findAccessibleCustomers,
  type AccessibleCustomer,
} from "@/lib/auth/tes-authorization-core"
import {
  assertNoTenantContext,
  runExclusiveAuthorizedWork,
} from "@/lib/auth/tes-transaction-guard"
import { withPostgresTransaction } from "@/lib/database/postgres-transaction"

export type { AccessibleCustomer } from "@/lib/auth/tes-authorization-core"

export type AccessibleCustomersResult =
  | {
      /** An ordinary actor: exactly the customers its own authorization paths reach. */
      kind: "ASSIGNED"
      customers: AccessibleCustomer[]
    }
  | {
      /**
       * Master Account may open any EXISTING customer, mirroring the evaluator. It
       * is deliberately not enumerated here: customer listing is a SYSTEM registry
       * operation (paginated, ORGANIZATION_REGISTRY_READ), and this helper must not
       * become a second, unbounded directory. The caller selects a customer
       * explicitly and each request then goes through withAuthorizedCustomer().
       */
      kind: "MASTER_ACCOUNT_ANY_CUSTOMER"
    }

/**
 * "Which Customers can the current actor actually open?"
 *
 * For an ordinary actor the answer comes from the actor's own effective
 * relationship + CUSTOMER-scope assignment + ORGANIZATION_READ grant + active
 * capability - the very predicate withAuthorizedCustomer() enforces - and never
 * from the customers table at large. Registry visibility (SYSTEM scope,
 * ORGANIZATION_REGISTRY_READ) is not tenant access and contributes nothing.
 *
 * Establishes no tenant context, selects no customer, and records no Master
 * Register event (authorization mechanics are not business events).
 */
export async function listAccessibleCustomers(): Promise<AccessibleCustomersResult> {
  return runExclusiveAuthorizedWork(() =>
    withPostgresTransaction(async (client) => {
      await assertNoTenantContext(client)

      const principal = await requireTesAuthorizationPrincipalWithClient(client)

      if (principal.isMasterAccount) {
        return { kind: "MASTER_ACCOUNT_ANY_CUSTOMER" } as const
      }

      return {
        kind: "ASSIGNED",
        customers: await findAccessibleCustomers(client, principal.actor.id),
      } as const
    }),
  )
}
