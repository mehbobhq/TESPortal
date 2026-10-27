/**
 * Selects and validates the database target from the environment. Pure (no I/O, no
 * `server-only`) so the selection rules are unit-testable.
 *
 * Two targets exist:
 *   - "cloud-sql" (default): production architecture, IAM authentication through the
 *     Cloud SQL Connector. Selected when TES_DATABASE_PROVIDER is unset or "cloud-sql".
 *   - "supabase-dev": the Supabase DEVELOPMENT database, password authentication through
 *     a connection string held in a server-side secret, TLS with certificate verification.
 *
 * Everything fails closed: contradictory or incomplete configuration throws instead of
 * falling back to the other target.
 */

export const SUPABASE_DEV_PROVIDER = "supabase-dev"
export const CLOUD_SQL_PROVIDER = "cloud-sql"
export const SUPABASE_DEV_BACKEND_ROLE = "tes-backend@tes-production-510007.iam"

const CLOUD_SQL_VARIABLES = ["TES_CLOUD_SQL_INSTANCE", "TES_POSTGRES_IAM_USER"] as const
const SUPABASE_VARIABLES = ["TES_SUPABASE_DEV_DATABASE_URL", "TES_SUPABASE_DEV_CA_PEM"] as const

export type SupabaseDevConnection = {
  host: string
  port: number
  database: string
  user: string
  password: string
  /** TLS is always on and always verified. */
  ssl: { ca: string; rejectUnauthorized: true; servername: string }
  /** 6543 is the transaction pooler: no session state may be relied upon. */
  transactionPooler: boolean
}

export type DatabaseTarget =
  | { kind: "cloud-sql" }
  | { kind: "supabase-dev"; connection: SupabaseDevConnection }

export class DatabaseConfigurationError extends Error {
  readonly code = "POSTGRES_CONFIGURATION_INVALID"
  constructor(reason: string) {
    // The reason names variables and rules only; it never contains a value.
    super(`TES database configuration rejected: ${reason}`)
    this.name = "DatabaseConfigurationError"
  }
}

type Env = Record<string, string | undefined>

const set = (env: Env, name: string) => (env[name] ?? "").trim() !== ""

export function resolveDatabaseTarget(env: Env = process.env): DatabaseTarget {
  const provider = (env.TES_DATABASE_PROVIDER ?? "").trim() || CLOUD_SQL_PROVIDER

  if (provider === CLOUD_SQL_PROVIDER) {
    const stray = SUPABASE_VARIABLES.filter((name) => set(env, name))
    if (stray.length > 0) {
      throw new DatabaseConfigurationError(
        `Supabase development variables are set (${stray.join(", ")}) but the provider is ${CLOUD_SQL_PROVIDER}`,
      )
    }
    return { kind: "cloud-sql" }
  }

  if (provider !== SUPABASE_DEV_PROVIDER) {
    throw new DatabaseConfigurationError("TES_DATABASE_PROVIDER must be cloud-sql or supabase-dev")
  }

  // The development database must never serve production traffic.
  if (env.VERCEL_ENV === "production" || env.TES_ENVIRONMENT === "production") {
    throw new DatabaseConfigurationError("the Supabase development database is not permitted in a production deployment")
  }
  const cloud = CLOUD_SQL_VARIABLES.filter((name) => set(env, name))
  if (cloud.length > 0) {
    throw new DatabaseConfigurationError(`Cloud SQL variables are set (${cloud.join(", ")}) together with supabase-dev`)
  }
  for (const name of SUPABASE_VARIABLES) {
    if (!set(env, name)) throw new DatabaseConfigurationError(`${name} is required for supabase-dev`)
  }

  let url: URL
  try {
    url = new URL(env.TES_SUPABASE_DEV_DATABASE_URL as string)
  } catch {
    throw new DatabaseConfigurationError("TES_SUPABASE_DEV_DATABASE_URL is not a valid URL")
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DatabaseConfigurationError("TES_SUPABASE_DEV_DATABASE_URL must be a postgres:// URL")
  }
  const host = url.hostname.toLowerCase()
  if (!(host.endsWith(".supabase.com") || host.endsWith(".supabase.co"))) {
    throw new DatabaseConfigurationError("the database host must be a Supabase host")
  }
  if (/510007|tes-production|tes-postgres-prod|cloudsql/i.test(host + url.pathname)) {
    throw new DatabaseConfigurationError("the database target looks like production Cloud SQL")
  }
  // Connection-string options could weaken TLS or smuggle startup parameters past the pooler.
  for (const [key, value] of url.searchParams) {
    if (!(key === "sslmode" && value === "verify-full")) {
      throw new DatabaseConfigurationError(`unsupported connection-string option ${key}`)
    }
  }

  const user = decodeURIComponent(url.username)
  const base = user.split(/\.(?=[a-z0-9]{20}$)/)[0] // optional pooler tenant suffix: <role>.<project-ref>
  if (base !== SUPABASE_DEV_BACKEND_ROLE) {
    throw new DatabaseConfigurationError("the connection must authenticate as the tes-backend role")
  }
  const password = decodeURIComponent(url.password)
  if (password === "") throw new DatabaseConfigurationError("the connection string carries no password")

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""))
  if (database === "") throw new DatabaseConfigurationError("the connection string names no database")

  const port = url.port === "" ? 5432 : Number(url.port)
  if (port !== 5432 && port !== 6543) throw new DatabaseConfigurationError("the port must be 5432 or 6543")

  const ca = (env.TES_SUPABASE_DEV_CA_PEM as string).replace(/\\n/g, "\n").trim()
  if (!ca.includes("BEGIN CERTIFICATE")) throw new DatabaseConfigurationError("TES_SUPABASE_DEV_CA_PEM does not contain a PEM certificate")

  return {
    kind: "supabase-dev",
    connection: {
      host,
      port,
      database,
      user,
      password,
      ssl: { ca, rejectUnauthorized: true, servername: host },
      transactionPooler: port === 6543,
    },
  }
}

/** True only for a valid supabase-dev configuration; invalid configuration is treated as "not Supabase" here and rejected when the pool is created. */
export function isSupabaseDevDatabase(env: Env = process.env): boolean {
  try {
    return resolveDatabaseTarget(env).kind === "supabase-dev"
  } catch {
    return false
  }
}
