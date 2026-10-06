-- TES production database foundation
-- Migration: 0001
-- Scope: application schema privileges only; no business/domain tables.

-- PUBLIC must not be able to create arbitrary application objects.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- The dedicated migration identity owns DDL. The runtime identity may resolve
-- objects in public but does not receive CREATE authority.
GRANT USAGE ON SCHEMA public
TO "tes-backend@tes-production-510007.iam";

REVOKE CREATE ON SCHEMA public
FROM "tes-backend@tes-production-510007.iam";

-- Objects created by the migration identity in public receive only the runtime
-- privileges required by the application. These defaults apply to FUTURE
-- objects created by this migration identity; migrations must still review
-- object-specific privilege needs deliberately.
ALTER DEFAULT PRIVILEGES FOR ROLE "tes-database-migrator@tes-production-510007.iam" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO "tes-backend@tes-production-510007.iam";

ALTER DEFAULT PRIVILEGES FOR ROLE "tes-database-migrator@tes-production-510007.iam" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES
  TO "tes-backend@tes-production-510007.iam";

-- Do not grant EXECUTE on future functions to PUBLIC. Function execution must
-- be granted explicitly when a migration introduces a function that runtime
-- code is allowed to call.
ALTER DEFAULT PRIVILEGES FOR ROLE "tes-database-migrator@tes-production-510007.iam" IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Defense-in-depth: the runtime identity must never inherit access to the
-- migration-control schema. This is intentionally explicit even though the
-- bootstrap already revoked PUBLIC access.
REVOKE ALL ON SCHEMA tes_system
FROM "tes-backend@tes-production-510007.iam";

REVOKE ALL ON TABLE tes_system.schema_migrations
FROM "tes-backend@tes-production-510007.iam";
