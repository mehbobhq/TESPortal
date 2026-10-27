import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"

const wf = readFileSync(".github/workflows/supabase-dev-database.yml", "utf8")
const code = (t: string) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")
const bootstrap = readFileSync("scripts/database/supabase-dev/bootstrap.sql", "utf8")
const guard = readFileSync("scripts/database/supabase-dev/guard-target.sh", "utf8")
const migrateDev = readFileSync("scripts/database/supabase-dev/migrate-dev.sh", "utf8")
const diagnose = readFileSync("scripts/database/supabase-dev/diagnose-backend-auth.sh", "utf8")
const verify = readFileSync("scripts/database/supabase-dev/verify-readonly.sh", "utf8")

describe("Supabase development workflow", () => {
  it("is manual, main-only, confirmed, serialized and read-only on contents", () => {
    assert.match(wf, /on:\s*\n\s*workflow_dispatch:/)
    assert.doesNotMatch(code(wf), /\n\s*(push|pull_request|schedule):/)
    assert.match(wf, /if: github\.ref == 'refs\/heads\/main' && inputs\.environment == 'supabase-dev' && inputs\.confirm == 'supabase-dev'/)
    assert.match(wf, /environment: supabase-dev/)
    assert.match(wf, /permissions:\s*\n\s*contents: read\s*\n/)
    assert.match(wf, /cancel-in-progress: false/)
  })
  it("cannot reach Google Cloud or production", () => {
    assert.doesNotMatch(code(wf), /id-token|google-github-actions|cloud-sql|TES_CLOUD_SQL|TES_POSTGRES_IAM|GCP_|production-database/i)
    assert.deepEqual([...new Set([...wf.matchAll(/\$\{\{\s*(secrets|vars)\.([A-Z_]+)/g)].map((m) => `${m[1]}.${m[2]}`))].sort(), [
      "secrets.SUPABASE_DEV_BACKEND_PASSWORD", "secrets.SUPABASE_DEV_BACKEND_USER", "secrets.SUPABASE_DEV_CA_PEM", "secrets.SUPABASE_DEV_DATABASE",
      "secrets.SUPABASE_DEV_MIGRATOR_PASSWORD", "secrets.SUPABASE_DEV_MIGRATOR_USER", "secrets.SUPABASE_DEV_POOLER_HOST", "vars.SUPABASE_DEV_BACKEND_PORT",
    ])
  })
  it("uses the session pooler port, verified TLS and the existing runner", () => {
    assert.match(wf, /PGPORT: "5432"/)
    assert.match(wf, /PGSSLMODE: verify-full/)
    assert.match(wf, /scripts\/database\/supabase-dev\/migrate-dev\.sh/)
    assert.match(migrateDev, /scripts\/database\/migrate\.sh|\.\.\/migrate\.sh/)
    assert.doesNotMatch(code(migrateDev), /psql[^\n]*-f\s+database\/migrations/)
  })
  it("never prints secrets", () => {
    assert.doesNotMatch(code(wf) + code(migrateDev) + code(verify), /set -x|echo[^\n]*(PASSWORD|CA_PEM)|printenv|\benv\s*$/m)
  })
  it("target guard refuses non-Supabase, unencrypted, production-looking and transaction-pooler targets", () => {
    for (const re of [/supabase\.com/, /verify-full/, /tes-production\|tes-postgres-prod/, /cloudsql/, /session mode/, /TES_DATABASE_TARGET/]) assert.match(guard, re)
  })
  it("bootstrap keeps the exact production role names and grants nothing to Data API roles", () => {
    for (const r of ["tes-backend@tes-production-510007.iam", "tes-database-migrator@tes-production-510007.iam"]) assert.ok(bootstrap.includes(r))
    assert.doesNotMatch(bootstrap.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n"), /GRANT[^;]*\bTO\b[^;]*\b(anon|authenticated|service_role)\b/i)
    assert.match(bootstrap, /rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication/)
    assert.match(bootstrap, /is_superuser/)
  })

  it("the development-secret exception is narrow: secret detection is not weakened and no other workflow can read the dev secrets", () => {
    const storage = readFileSync("scripts/storage/verify-evidence-storage-config.mjs", "utf8")
    assert.match(storage, /FORBIDDEN_ENV = \["GOOGLE_APPLICATION_CREDENTIALS_JSON", "GOOGLE_PRIVATE_KEY", "GOOGLE_CLIENT_SECRET", "GCS_KEY", "GCS_SERVICE_ACCOUNT_KEY", "PGPASSWORD"\]/)
    assert.doesNotMatch(wf, /verify-evidence-storage-config/)
    for (const f of readdirSync(".github/workflows")) {
      if (f === "supabase-dev-database.yml") continue
      assert.doesNotMatch(readFileSync(`.github/workflows/${f}`, "utf8"), /secrets\.SUPABASE_DEV|vars\.SUPABASE_DEV|TES_SUPABASE_DEV|environment: supabase-dev/, `${f} must not reference the Supabase development secrets`)
    }
    const adapter = readFileSync("lib/database/postgres-config.ts", "utf8")
    assert.match(adapter, /VERCEL_ENV === "production"/)
  })

  it("the auth diagnostic is read-only, secret-safe and offered only as a workflow action", () => {
    assert.match(wf, /- diagnose-auth/)
    assert.match(wf, /if: inputs\.action == 'diagnose-auth'/)
    const d = code(diagnose)
    assert.doesNotMatch(d, /set -x|printenv|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCREATE\b|\bALTER\b|\bDROP\b|\bGRANT\b|migrate\.sh/i)
    assert.match(d, /BEGIN TRANSACTION READ ONLY/)
    assert.doesNotMatch(d, /echo[^\n]*\$\{?(BU|BP|MU|MP|PGHOST|PGDATABASE|TES_[A-Z_]*PASSWORD|TES_[A-Z_]*USER)\b/)
  })
})
