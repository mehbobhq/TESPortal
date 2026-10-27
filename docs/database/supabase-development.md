# Supabase development database

Target: Supabase Free project `tes-portal-dev` (PostgreSQL 17.11), branch `main`. **Development only.** Production stays on Cloud SQL with IAM authentication; migrations 0001–0043 are unchanged.

## Components

| Piece | File |
|---|---|
| Role/privilege bootstrap (run once as Supabase `postgres`, idempotent) | `scripts/database/supabase-dev/bootstrap.sql` |
| Target guard shared by the scripts | `scripts/database/supabase-dev/guard-target.sh` |
| Guarded migration entry point (wraps the unchanged `scripts/database/migrate.sh`) | `scripts/database/supabase-dev/migrate-dev.sh` |
| Read-only verification | `scripts/database/supabase-dev/verify-readonly.sh`, `verify-catalog.sql`, `verify-runtime.sql` |
| Application adapter | `lib/database/postgres-config.ts`, `lib/database/postgres.ts` |
| Manual workflow (not run automatically) | `.github/workflows/supabase-dev-database.yml` |
| Local proof on a disposable Supabase-shaped cluster | `scripts/database/supabase-dev/test/` and `.github/workflows/supabase-dev-tooling-ci.yml` |

## Role model

The hard-coded production role names are kept exactly: `tes-backend@tes-production-510007.iam` (runtime) and `tes-database-migrator@tes-production-510007.iam` (DDL). Both are password roles here (`LOGIN`, no `SUPERUSER`, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, `REPLICATION`) and members of no role.

* Migrator: `CONNECT` and `CREATE` on the database (migration 0004 creates `tes_security`, the runner creates `tes_system`), and **owner of schema `public`** so migration 0001 can revoke `CREATE` and grant `USAGE` exactly as in production. The bootstrap first removes `CREATE` on `public` from PUBLIC, `anon`, `authenticated` and `service_role`.
* Backend: `CONNECT` only; no `CREATE` anywhere. Table access comes from the migrator's default privileges in migration 0001/0002. It owns nothing, so row-level security always applies to it.
* `btree_gist` (migration 0023) is installed by the bootstrap into Supabase's `extensions` schema so its helpers stay out of the schema the Data API exposes.
* Role-level `statement_timeout` (30 s backend, 20 min migrator) replaces the connection startup parameter, which poolers may reject.
* Nothing is granted to `anon`, `authenticated` or `service_role`. Objects created by the migrator receive none of Supabase's default grants (those are defined per creator role, `postgres` / `supabase_admin`). The verifier proves this by `has_*_privilege` sweeps, which include PUBLIC and inheritance.
* Tenant isolation is unchanged: no policy was added or relaxed. The Data API is not used by TES; the browser never talks to the database and Supabase Auth is not used.

## Connection adapter

`TES_DATABASE_PROVIDER` selects the target. Unset or `cloud-sql` is the production path, unchanged. `supabase-dev` uses a password connection string and requires:

| Variable | Content |
|---|---|
| `TES_DATABASE_PROVIDER` | `supabase-dev` |
| `TES_SUPABASE_DEV_DATABASE_URL` | `postgresql://<backend role>[.<project-ref>]:<password>@<pooler host>:6543/postgres` (server-side secret) |
| `TES_SUPABASE_DEV_CA_PEM` | Supabase CA certificate, PEM (`\n` escapes accepted) |

It fails closed (`DatabaseConfigurationError`, messages never contain values) when: a Supabase variable is set while the provider is Cloud SQL; Cloud SQL variables are set with `supabase-dev`; `VERCEL_ENV` or `TES_ENVIRONMENT` is `production`; the host is not `*.supabase.com/.co` or looks like Cloud SQL; the user is not the backend role; the password, database, CA or port (5432/6543) is missing or wrong; or the URL carries any option other than `sslmode=verify-full`. TLS is always on with `rejectUnauthorized: true` and the CA pinned.

Transaction-pooler (port 6543) safety: the application uses only `BEGIN … COMMIT` on one client, `set_config(…, true)` (transaction-local) for authorization context, `pg_advisory_xact_lock`, and unnamed statements. It uses no `LISTEN`, session `SET`, temp tables, cursors, named prepared statements or session advisory locks. No startup parameters are sent in this mode; `withPostgresTransaction` issues `SET LOCAL statement_timeout` per transaction. The migration runner needs a **session** advisory lock and one stable connection, so migrations use the session pooler (5432) and the guard rejects other ports.

## Development-secret exception (narrow)

TES's design rule is "no database password" (`FORBIDDEN_ENV` in `scripts/storage/verify-evidence-storage-config.mjs` rejects `PGPASSWORD`). That rule is **not changed**. The exception is scoped by construction: the dev passwords exist only as secrets of the GitHub environment `supabase-dev`, are read only by `supabase-dev-database.yml`, and the dev workflow does not run the storage verifier. A unit test asserts that `FORBIDDEN_ENV` is unchanged, that the dev workflow has no Google/Cloud SQL credentials, and that no other workflow references the dev secrets. The Vercel Production environment must never carry them (the adapter refuses `VERCEL_ENV=production`).

## Secrets and configuration

GitHub environment `supabase-dev` (add required reviewers), secrets: `SUPABASE_DEV_POOLER_HOST`, `SUPABASE_DEV_DATABASE`, `SUPABASE_DEV_CA_PEM`, `SUPABASE_DEV_MIGRATOR_USER`, `SUPABASE_DEV_MIGRATOR_PASSWORD`, `SUPABASE_DEV_BACKEND_USER`, `SUPABASE_DEV_BACKEND_PASSWORD`; optional variable `SUPABASE_DEV_BACKEND_PORT` (6543 to verify the transaction pooler). `*_USER` values are the role name plus the pooler tenant suffix `.<project-ref>`.

Bootstrap (operator machine, once): `TES_DEV_BOOTSTRAP_CONFIRM=supabase-dev TES_DEV_BACKEND_PASSWORD=… TES_DEV_MIGRATOR_PASSWORD=… psql "<admin connection>" -v ON_ERROR_STOP=1 -f scripts/database/supabase-dev/bootstrap.sql`. Passwords ≥ 24 chars and different. A `SCRAM-SHA-256$…` verifier is accepted in place of plaintext to keep plaintext out of server logs.

## Controlled execution sequence (requires approval; nothing has been run)

1. Create the `supabase-dev` GitHub environment, secrets and reviewers. Download the Supabase CA.
2. Run the bootstrap as `postgres` (fails closed if `postgres` is not the database owner — see compatibility issues).
3. Dispatch `Supabase Development Database` with action `migrate`.
4. Dispatch with action `verify` (session port), then again with `SUPABASE_DEV_BACKEND_PORT=6543`. Expected: 43 ledger entries, RLS 116, policies 198, no FAIL.
5. Run the adversarial matrix (`test/database/system-wide-authorization-rls.sql`) against the dev database only if an owner-approved superuser path exists; otherwise rely on CI.
6. Configure a Vercel **Preview** environment (never Production) with the three adapter variables.

## Open compatibility issues (cannot be settled without a remote connection)

1. Whether Supabase `postgres` owns the database or holds a grant option for `CREATE` on it. Without it the migrator cannot create schemas; the bootstrap detects this and stops (tested). Migration 0004 does not tolerate a pre-created `tes_security`.
2. Whether Supavisor accepts role names containing `.` and `@` with the `.<project-ref>` suffix (the names are fixed by migrations 0001–0043). If it does not, the session pooler is unusable for these roles; fallback is the direct connection (IPv6 only on Free) or the IPv4 add-on.
3. Whether the transaction pooler honours role-level settings (expected) and drops startup parameters (the verifier does not depend on them; it sets `default_transaction_read_only` best-effort and always wraps queries in `READ ONLY` transactions).
4. Free plan: no backups or PITR, project pauses after inactivity, 500 MB limit.
5. Supabase event triggers or defaults that add grants outside the cases swept by the verifier would appear as FAIL; none exist in the local emulation, which was built from general knowledge of Supabase, not from a real project.
