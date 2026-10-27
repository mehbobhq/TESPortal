import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveDatabaseTarget } from "@/lib/database/postgres-config"

const ROLE = "tes-backend@tes-production-510007.iam"
const REF = "abcdefghijklmnopqrst"
const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----"
const url = (user = `${ROLE}.${REF}`, host = "aws-0-us-east-1.pooler.supabase.com", port = 6543, extra = "") =>
  `postgresql://${encodeURIComponent(user)}:s3cret%2Fpw@${host}:${port}/postgres${extra}`
const dev = (over: Record<string, string | undefined> = {}) => ({
  TES_DATABASE_PROVIDER: "supabase-dev",
  TES_SUPABASE_DEV_DATABASE_URL: url(),
  TES_SUPABASE_DEV_CA_PEM: CA,
  ...over,
})
const rejects = (env: Record<string, string | undefined>, re: RegExp) => assert.throws(() => resolveDatabaseTarget(env), re)

describe("database target selection", () => {
  it("defaults to Cloud SQL and ignores nothing silently", () => {
    assert.deepEqual(resolveDatabaseTarget({}), { kind: "cloud-sql" })
    assert.deepEqual(resolveDatabaseTarget({ TES_DATABASE_PROVIDER: "cloud-sql", TES_CLOUD_SQL_INSTANCE: "p:r:i" }), { kind: "cloud-sql" })
  })

  it("Cloud SQL refuses stray Supabase variables instead of ignoring them", () => {
    rejects({ TES_SUPABASE_DEV_DATABASE_URL: url() }, /Supabase development variables are set/)
    rejects({ TES_DATABASE_PROVIDER: "cloud-sql", TES_SUPABASE_DEV_CA_PEM: CA }, /Supabase development variables are set/)
  })

  it("rejects unknown providers", () => rejects({ TES_DATABASE_PROVIDER: "supabase" }, /must be cloud-sql or supabase-dev/))

  it("accepts a complete Supabase development configuration, verifying TLS", () => {
    const t = resolveDatabaseTarget(dev())
    assert.equal(t.kind, "supabase-dev")
    if (t.kind !== "supabase-dev") return
    assert.equal(t.connection.user, `${ROLE}.${REF}`)
    assert.equal(t.connection.password, "s3cret/pw")
    assert.equal(t.connection.port, 6543)
    assert.equal(t.connection.transactionPooler, true)
    assert.equal(t.connection.ssl.rejectUnauthorized, true)
    assert.equal(t.connection.ssl.servername, "aws-0-us-east-1.pooler.supabase.com")
    assert.match(t.connection.ssl.ca, /BEGIN CERTIFICATE/)
  })

  it("accepts the bare role name, the session port and escaped newlines in the CA", () => {
    const t = resolveDatabaseTarget(dev({ TES_SUPABASE_DEV_DATABASE_URL: url(ROLE, "db.abc.supabase.co", 5432), TES_SUPABASE_DEV_CA_PEM: CA.replace(/\n/g, "\\n") }))
    assert.equal(t.kind === "supabase-dev" && t.connection.transactionPooler, false)
  })

  it("fails closed on missing pieces", () => {
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: undefined }), /TES_SUPABASE_DEV_DATABASE_URL is required/)
    rejects(dev({ TES_SUPABASE_DEV_CA_PEM: undefined }), /TES_SUPABASE_DEV_CA_PEM is required/)
    rejects(dev({ TES_SUPABASE_DEV_CA_PEM: "not a certificate" }), /PEM certificate/)
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: "not a url" }), /not a valid URL/)
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: `postgresql://${encodeURIComponent(ROLE)}@aws-0.pooler.supabase.com:6543/postgres` }), /no password/)
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: `postgresql://${encodeURIComponent(ROLE)}:x@aws-0.pooler.supabase.com:6543` }), /no database/)
  })

  it("fails closed on contradictory configuration", () => {
    rejects(dev({ TES_CLOUD_SQL_INSTANCE: "tes-production-510007:us-central1:tes-postgres-prod" }), /Cloud SQL variables are set/)
    rejects(dev({ TES_POSTGRES_IAM_USER: "x" }), /Cloud SQL variables are set/)
    rejects(dev({ VERCEL_ENV: "production" }), /not permitted in a production deployment/)
    rejects(dev({ TES_ENVIRONMENT: "production" }), /not permitted in a production deployment/)
    assert.equal(resolveDatabaseTarget(dev({ VERCEL_ENV: "preview" })).kind, "supabase-dev")
  })

  it("rejects other roles, hosts, ports and connection-string options", () => {
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: url("postgres." + REF) }), /tes-backend role/)
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: url("tes-database-migrator@tes-production-510007.iam") }), /tes-backend role/)
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: url(undefined, "db.example.com") }), /Supabase host/)
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: url(undefined, "tes-postgres-prod.supabase.com") }), /production Cloud SQL/)
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: url(undefined, undefined, 5433) }), /port must be/)
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: url(undefined, undefined, 6543, "?sslmode=disable") }), /unsupported connection-string option sslmode/)
    rejects(dev({ TES_SUPABASE_DEV_DATABASE_URL: url(undefined, undefined, 6543, "?options=-c%20role%3Dpostgres") }), /unsupported connection-string option options/)
    assert.equal(resolveDatabaseTarget(dev({ TES_SUPABASE_DEV_DATABASE_URL: url(undefined, undefined, 6543, "?sslmode=verify-full") })).kind, "supabase-dev")
  })

  it("never puts a secret value in an error", () => {
    for (const env of [dev({ TES_CLOUD_SQL_INSTANCE: "x" }), dev({ TES_SUPABASE_DEV_DATABASE_URL: url(undefined, "db.example.com") }), dev({ TES_SUPABASE_DEV_CA_PEM: "bad" })]) {
      try { resolveDatabaseTarget(env) } catch (e) { assert.doesNotMatch(String((e as Error).message), /s3cret|BEGIN CERT|db\.example\.com/) }
    }
  })
})
