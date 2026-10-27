import "server-only"

import type { PoolClient } from "pg"
import { getPostgresPool } from "@/lib/database/postgres"
import { isSupabaseDevDatabase } from "@/lib/database/postgres-config"

export type PostgresTransactionWork<T> = (client: PoolClient) => Promise<T>

/**
 * Executes work on one checked-out PostgreSQL connection and one transaction.
 *
 * Tenant context must be established with SET LOCAL / set_config(..., true)
 * through this same client before tenant-owned queries are executed.
 */
export async function withPostgresTransaction<T>(
  work: PostgresTransactionWork<T>,
): Promise<T> {
  const pool = await getPostgresPool()
  const client = await pool.connect()

  try {
    await client.query("BEGIN")
    if (isSupabaseDevDatabase()) {
      // Behind a pooler the startup parameter is not available; the bound is
      // re-applied per transaction (and is transaction-local).
      await client.query("SET LOCAL statement_timeout = '30s'")
    }
    const result = await work(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // Preserve the original failure. The pool will dispose/recover the
      // connection according to pg's normal lifecycle.
    }
    throw error
  } finally {
    client.release()
  }
}
