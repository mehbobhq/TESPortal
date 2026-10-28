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
// Connection settings come EITHER from one URL OR from separate parts (easier to enter and to inspect in a dashboard).
const SUPABASE_PART_VARIABLES = ["TES_SUPABASE_DEV_DB_HOST", "TES_SUPABASE_DEV_DB_USER", "TES_SUPABASE_DEV_DB_PASSWORD", "TES_SUPABASE_DEV_DB_PORT", "TES_SUPABASE_DEV_DB_NAME"] as const
const SUPABASE_VARIABLES = ["TES_SUPABASE_DEV_DATABASE_URL", "TES_SUPABASE_DEV_CA_PEM", ...SUPABASE_PART_VARIABLES] as const

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
  if (!set(env, "TES_SUPABASE_DEV_CA_PEM")) throw new DatabaseConfigurationError("TES_SUPABASE_DEV_CA_PEM is required for supabase-dev")
  const parts = SUPABASE_PART_VARIABLES.filter((name) => set(env, name))
  const urlGiven = set(env, "TES_SUPABASE_DEV_DATABASE_URL")
  if (urlGiven && parts.length > 0) {
    throw new DatabaseConfigurationError(`TES_SUPABASE_DEV_DATABASE_URL and the separate connection variables (${parts.join(", ")}) are both set; use only one form`)
  }

  let host: string
  let user: string
  let password: string
  let database: string
  let port: number

  if (urlGiven) {
    let url: URL
    try {
      url = new URL(env.TES_SUPABASE_DEV_DATABASE_URL as string)
    } catch {
      throw new DatabaseConfigurationError("TES_SUPABASE_DEV_DATABASE_URL is not a valid URL")
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new DatabaseConfigurationError("TES_SUPABASE_DEV_DATABASE_URL must be a postgres:// URL")
    }
    // Connection-string options could weaken TLS or smuggle startup parameters past the pooler.
    for (const [key, value] of url.searchParams) {
      if (!(key === "sslmode" && value === "verify-full")) {
        throw new DatabaseConfigurationError(`unsupported connection-string option ${key} (TLS is always verified; only sslmode=verify-full is accepted)`)
      }
    }
    try {
      host = url.hostname.toLowerCase()
      user = decodeURIComponent(url.username)
      password = decodeURIComponent(url.password)
      database = decodeURIComponent(url.pathname.replace(/^\//, ""))
    } catch {
      throw new DatabaseConfigurationError("the connection string user, password or database has invalid percent-encoding")
    }
    port = url.port === "" ? 5432 : Number(url.port)
  } else {
    for (const name of ["TES_SUPABASE_DEV_DB_HOST", "TES_SUPABASE_DEV_DB_USER", "TES_SUPABASE_DEV_DB_PASSWORD"] as const) {
      if (!set(env, name)) throw new DatabaseConfigurationError(`${name} is required for supabase-dev (or set TES_SUPABASE_DEV_DATABASE_URL instead)`)
    }
    // Used exactly as given: no URL building, encoding or decoding, so special characters in the password cannot be altered.
    host = (env.TES_SUPABASE_DEV_DB_HOST as string).trim().toLowerCase()
    const probe = new URL("postgresql://placeholder.invalid/")
    probe.hostname = host
    if (probe.hostname !== host) {
      throw new DatabaseConfigurationError("TES_SUPABASE_DEV_DB_HOST must be a bare host name (no https://, port, path or spaces)")
    }
    user = (env.TES_SUPABASE_DEV_DB_USER as string).trim()
    password = env.TES_SUPABASE_DEV_DB_PASSWORD as string
    database = set(env, "TES_SUPABASE_DEV_DB_NAME") ? (env.TES_SUPABASE_DEV_DB_NAME as string).trim() : "postgres"
    const wantedPort = set(env, "TES_SUPABASE_DEV_DB_PORT") ? (env.TES_SUPABASE_DEV_DB_PORT as string).trim() : "6543"
    if (!/^(5432|6543)$/.test(wantedPort)) throw new DatabaseConfigurationError("TES_SUPABASE_DEV_DB_PORT must be 5432 or 6543")
    port = Number(wantedPort)
  }

  if (!(host.endsWith(".supabase.com") || host.endsWith(".supabase.co"))) {
    throw new DatabaseConfigurationError("the database host must be a Supabase host")
  }
  if (/510007|tes-production|tes-postgres-prod|cloudsql/i.test(host + "/" + database)) {
    throw new DatabaseConfigurationError("the database target looks like production Cloud SQL")
  }
  const base = user.split(/\.(?=[a-z0-9]{20}$)/)[0] // optional pooler tenant suffix: <role>.<project-ref>
  if (base !== SUPABASE_DEV_BACKEND_ROLE) {
    throw new DatabaseConfigurationError("the connection must authenticate as the tes-backend role")
  }
  if (/[^\x20-\x7e]/.test(password) || /[^\x20-\x7e]/.test(user)) {
    // A non-ASCII password authenticates only if the client that set it sent the same bytes as this one.
    throw new DatabaseConfigurationError("the connection user and password must be printable ASCII")
  }
  if (password === "") throw new DatabaseConfigurationError("the connection carries no password")
  if (database === "") throw new DatabaseConfigurationError("the connection names no database")
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
