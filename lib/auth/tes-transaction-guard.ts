/**
 * Guards shared by the authorization wrappers.
 *
 * Plain Node/PostgreSQL helpers with no "server-only" import so they are
 * testable; they are only ever reached through the server-only wrappers.
 */

import { AsyncLocalStorage } from "node:async_hooks"
import type { PoolClient } from "pg"

/**
 * An authorization wrapper was entered while another one was already running in
 * the same async call chain. Each wrapper holds a pooled connection for its whole
 * transaction and the pool is deliberately tiny (max 3), so nesting would take a
 * second connection and can starve the pool. It would also run the inner work in
 * a different transaction from the outer authorization. This is a programming
 * error and fails before any connection is taken.
 *
 * The guard follows the async call chain, so it is deliberately conservative: a
 * wrapper started from work that was scheduled inside a callback and outlives it
 * is rejected too. Independent concurrent requests are unaffected.
 */
export class TesNestedAuthorizationError extends Error {
  readonly code = "TES_NESTED_AUTHORIZATION"

  constructor() {
    super("TES authorized work cannot be nested.")
    this.name = "TesNestedAuthorizationError"
  }
}

/**
 * A tenant context (tes.customer_id) was already present on the checked-out
 * connection before the wrapper established anything. A SYSTEM request must never
 * run with tenant context, and a CUSTOMER request must never inherit one, so the
 * wrappers fail closed instead of trusting or overwriting it.
 */
export class TesTenantContextPresentError extends Error {
  readonly code = "TES_TENANT_CONTEXT_PRESENT"

  constructor() {
    super("TES tenant context is already present on this connection.")
    this.name = "TesTenantContextPresentError"
  }
}

const authorizedWork = new AsyncLocalStorage<true>()

export function runExclusiveAuthorizedWork<T>(work: () => Promise<T>): Promise<T> {
  if (authorizedWork.getStore()) {
    return Promise.reject(new TesNestedAuthorizationError())
  }
  return authorizedWork.run(true, work)
}

/**
 * Asserts the connection carries no tenant context. Both "never set" (NULL) and
 * "set earlier in a transaction that has since ended" (an empty string, which is
 * how PostgreSQL reports a reset custom setting) mean no context. Anything else,
 * including a malformed value, is rejected.
 */
export async function assertNoTenantContext(
  client: Pick<PoolClient, "query">,
): Promise<void> {
  const result = await client.query<{ raw: string | null; resolved: string | null }>(
    `SELECT
       current_setting('tes.customer_id', true) AS raw,
       tes_security.current_customer_id()::text AS resolved`,
  )

  const row = result.rows[0]
  if (!row) throw new TesTenantContextPresentError()

  const raw = row.raw === null ? "" : row.raw.trim()
  if (raw !== "" || row.resolved !== null) {
    throw new TesTenantContextPresentError()
  }
}
