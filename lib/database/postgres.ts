import "server-only"

import { AuthTypes, Connector, IpAddressTypes } from "@google-cloud/cloud-sql-connector"
import pg from "pg"
import { getGoogleAuthClient } from "@/lib/google/auth"
import { resolveDatabaseTarget } from "@/lib/database/postgres-config"
import { logSafeError } from "@/lib/database/safe-error"
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
 *
 * Development alternative (TES_DATABASE_PROVIDER=supabase-dev): the Supabase
 * development database, password authentication through a server-side secret
 * connection string, TLS with certificate verification. Selected only by that
 * explicit variable; see postgres-config.ts and docs/database/supabase-development.md.
 * The Cloud SQL branch below is unchanged.
 */

type PostgresPool = InstanceType<typeof Pool>

type DatabaseState = {
  connector: Connector | null
  pool: PostgresPool
}

let statePromise: Promise<DatabaseState> | null = null

async function createSupabaseDevState(
  connection: Extract<ReturnType<typeof resolveDatabaseTarget>, { kind: "supabase-dev" }>["connection"],
): Promise<DatabaseState> {
  const pool = new Pool({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl: connection.ssl,

    max: 3,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,

    // No `statement_timeout` startup parameter: poolers may reject startup
    // parameters. The role carries statement_timeout (bootstrap.sql) and
    // withPostgresTransaction() re-applies it with SET LOCAL. query_timeout is
    // client-side only.
    query_timeout: 35_000,
  })

  pool.on("error", () => {
    // See the Cloud SQL branch: do not log raw driver errors.
  })

  return { connector: null, pool }
}

async function createDatabaseState(): Promise<DatabaseState> {
  const target = resolveDatabaseTarget()
  if (target.kind === "supabase-dev") return createSupabaseDevState(target.connection)

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
  } catch (error) {
    logSafeError("database pool", error)
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
