# TES Production Database Migrations

This directory is the source-controlled migration history for the TES production PostgreSQL database.

## Identities

- **Migration identity:** `tes-database-migrator@tes-production-510007.iam`
  - Used only by the production database migration workflow.
  - Owns migration-created DDL and has the PostgreSQL privileges required to evolve the schema.
  - Does not use a database password or service-account key.
- **Runtime identity:** `tes-backend@tes-production-510007.iam`
  - Used by the TES application runtime.
  - Must not receive database/schema creation authority or access to the migration-control schema.

## Bootstrap prerequisite

The migration identity must already be able to connect to `tes_prod` and create schemas. This prerequisite is intentionally outside the migration history because the migration engine needs it before migrations can run.

Administrative bootstrap grant:

```sql
GRANT CREATE ON DATABASE tes_prod
TO "tes-database-migrator@tes-production-510007.iam";
```

The runtime identity must not receive this grant.

## Migration-control schema

The migration runner bootstraps and owns:

- `tes_system.schema_migrations`

`tes_system` is migration-control infrastructure. The application runtime must not have access to it.

## Migration files

Migration filenames use four-digit sequential versions:

```text
0001_database_foundation.sql
0002_example.sql
0003_example.sql
```

Rules:

1. Versions are contiguous and unique.
2. Once a migration has been applied, its filename and contents are immutable.
3. Never edit, rename, delete, or renumber an applied migration. Correct production state with a new migration.
4. The runner records a SHA-256 checksum and refuses divergent history.
5. Each migration is executed transactionally by the runner. Migration files must not contain their own `BEGIN`, `COMMIT`, `ROLLBACK`, or psql meta-commands.
6. Production migrations are not run automatically during Vercel deployment. They are executed through the dedicated production database migration workflow.
7. Business/domain tables must not be added casually to a foundation migration.

## Privilege model established by 0001

`0001_database_foundation.sql` establishes the initial application privilege boundary:

- `PUBLIC` cannot create objects in the `public` schema.
- The runtime identity can use the `public` schema but cannot create objects there.
- Future tables created by the migration identity in `public` default to runtime `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges.
- Future sequences created by the migration identity in `public` default to runtime `USAGE` and `SELECT` privileges.
- Future functions do not default to `PUBLIC` execution; function execution is granted deliberately per function.
- The runtime identity has no access to `tes_system` or its migration ledger.

Default privileges are creator-specific. These defaults apply to objects created by `tes-database-migrator@tes-production-510007.iam`; they are not a substitute for reviewing grants in each migration.

## Tenant isolation / RLS gate

`0001` does not invent tenant Row-Level Security before tenant-owned tables and the authenticated session-context mechanism exist.

Before the first tenant-owned application table is exposed to runtime traffic, the migration introducing that data model must establish and prove the TES tenant-isolation mechanism, including the canonical `customer_id` boundary and PostgreSQL RLS where adopted. Application URL parameters or supplied company/customer IDs must never establish authorization by themselves.

## Operating procedure

For every production migration:

1. Design and review the SQL before execution.
2. Add exactly the next sequential migration file.
3. Commit and push it to `main`.
4. Trigger the production database migration workflow manually.
5. Verify the workflow succeeded and the ledger recorded the expected version/checksum.
6. Verify runtime privileges and security boundaries introduced by the migration.
7. If a migration fails, investigate the exact failure; do not rewrite an already-applied migration.
