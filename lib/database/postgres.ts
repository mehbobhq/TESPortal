import "server-only"

import { AuthTypes, Connector, IpAddressTypes } from "@google-cloud/cloud-sql-connector"
import pg from "pg"
import { getGoogleAuthClient } from "@/lib/google/auth"
import {
  cloudSqlInstanceConnectionName,
  postgresDatabaseName,
  postgresIamUser,
} from "@/lib/google/config"

const { Pool } = pg

/**
 * TES PostgreSQL connection.
 *
 * Production authentication:
 * Vercel OIDC -> Google WIF -> tes-backend -> Cloud SQL Connector
 * -> automatic IAM database authentication -> PostgreSQL.
 *
 * No database password, service-account key, static access token, or direct
 * public-IP credential is stored here.
 */

type PostgresPool = InstanceType<typeof Pool>

type DatabaseState = {
  connector: Connector
  pool: PostgresPool
}

let statePromise: Promise<DatabaseState> | null = null

async function createDatabaseState(): Promise<DatabaseState> {
  const connector = new Connector({
    // Reuse TES's existing fail-closed Google auth boundary. In Vercel
    // Production this is the WIF IdentityPoolClient; outside production it is
    // ADC, exactly as defined by lib/google/auth.ts.
    auth: getGoogleAuthClient(),
  })

  try {
    const connectorOptions = await connector.getOptions({
      instanceConnectionName: cloudSqlInstanceConnectionName(),
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.IAM,
    })

    const pool = new Pool({
      ...connectorOptions,
      user: postgresIamUser(),
      database: postgresDatabaseName(),

      // Keep each warm Vercel runtime's pool deliberately small.
      max: 3,
      min: 0,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,

      // Bound database work so a forgotten operation cannot occupy a
      // connection indefinitely.
      statement_timeout: 30_000,
      query_timeout: 35_000,

      // Do not add pg's `ssl` option here. The Cloud SQL Connector supplies
      // the authenticated TLS socket itself.
    })

    pool.on("error", () => {
      // Do not log raw driver errors here. Authentication/network errors can
      // contain infrastructure detail; callers receive sanitized failures.
    })

    return { connector, pool }
  } catch (error) {
    connector.close()
    throw error
  }
}

async function databaseState(): Promise<DatabaseState> {
  if (!statePromise) {
    statePromise = createDatabaseState().catch((error) => {
      // Permit a later invocation to retry initialization after a transient
      // failure rather than permanently caching a rejected Promise.
      statePromise = null
      throw error
    })
  }

  return statePromise
}

export class PostgresConnectionError extends Error {
  readonly code = "POSTGRES_CONNECTION_FAILED"

  constructor() {
    super("TES could not establish a PostgreSQL connection.")
    this.name = "PostgresConnectionError"
  }
}

/**
 * Returns the shared pg Pool for the current warm server runtime.
 * Never import this module into a Client Component.
 */
export async function getPostgresPool(): Promise<PostgresPool> {
  try {
    return (await databaseState()).pool
  } catch {
    throw new PostgresConnectionError()
  }
}

/**
 * Read-only connectivity probe for the controlled production verification
 * gate. It returns no secret material and creates/modifies no database object.
 */
export async function probePostgresConnection(): Promise<{
  database: string
  user: string
  serverTime: string
}> {
  try {
    const pool = await getPostgresPool()
    const result = await pool.query<{
      database: string
      user: string
      server_time: Date
    }>(
      `SELECT
         current_database() AS database,
         current_user AS user,
         CURRENT_TIMESTAMP AS server_time`,
    )

    const row = result.rows[0]
    if (!row) throw new Error("empty database probe result")

    return {
      database: row.database,
      user: row.user,
      serverTime: row.server_time.toISOString(),
    }
  } catch {
    throw new PostgresConnectionError()
  }
}
