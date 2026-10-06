-- TES production runtime privilege hardening
-- Migration: 0002
-- Scope: remove automatic runtime privileges from future migration-created
-- application objects. Each future migration must grant runtime privileges
-- explicitly per object.

-- 0001 established broad creator-specific defaults for the runtime identity.
-- Remove those defaults before the first business/domain table is introduced.
ALTER DEFAULT PRIVILEGES
FOR ROLE "tes-database-migrator@tes-production-510007.iam"
IN SCHEMA public
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES
FROM "tes-backend@tes-production-510007.iam";

ALTER DEFAULT PRIVILEGES
FOR ROLE "tes-database-migrator@tes-production-510007.iam"
IN SCHEMA public
REVOKE USAGE, SELECT ON SEQUENCES
FROM "tes-backend@tes-production-510007.iam";
