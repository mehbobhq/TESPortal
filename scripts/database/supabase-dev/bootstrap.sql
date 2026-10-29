-- TES Supabase DEVELOPMENT database bootstrap.
--
-- Scope: the Supabase Free project "tes-portal-dev" ONLY. Never run this
-- against Cloud SQL / production: the production roles are IAM principals
-- managed by Google, not password roles.
--
-- Run once as the project's admin role (`postgres`, non-superuser) BEFORE the
-- first migration, and again at any time: every statement is idempotent.
--
--   psql "$ADMIN_CONNECTION_STRING" -v ON_ERROR_STOP=1 \
--        -f scripts/database/supabase-dev/bootstrap.sql
--
-- Required environment (read with \getenv; never written on a command line):
--   TES_DEV_BOOTSTRAP_CONFIRM   must equal: supabase-dev
--   TES_DEV_BACKEND_PASSWORD    >= 24 printable ASCII characters
--   TES_DEV_MIGRATOR_PASSWORD   >= 24 printable ASCII characters, different from the backend's
--
-- The role names are the production names, hard-coded in migrations
-- 0001-0044, and are preserved exactly. Passwords replace IAM authentication.
-- A plaintext password in ALTER ROLE can appear in server statement logs when
-- logging captures DDL; a precomputed 'SCRAM-SHA-256$...' verifier is also
-- accepted by PostgreSQL and avoids that. Rotate by re-running this script.
--
-- This script grants nothing on any TES object (none exists yet) and nothing
-- to anon / authenticated / service_role.

\set ON_ERROR_STOP on

\getenv tes_confirm TES_DEV_BOOTSTRAP_CONFIRM
\getenv tes_backend_password TES_DEV_BACKEND_PASSWORD
\getenv tes_migrator_password TES_DEV_MIGRATOR_PASSWORD

\if :{?tes_confirm}
\else
  \echo 'ERROR: TES_DEV_BOOTSTRAP_CONFIRM is not set.'
  DO $$ BEGIN RAISE EXCEPTION 'bootstrap refused: see the preceding message' USING ERRCODE = 'P0001'; END $$;
\endif
\if :{?tes_backend_password}
\else
  \echo 'ERROR: TES_DEV_BACKEND_PASSWORD is not set.'
  DO $$ BEGIN RAISE EXCEPTION 'bootstrap refused: see the preceding message' USING ERRCODE = 'P0001'; END $$;
\endif
\if :{?tes_migrator_password}
\else
  \echo 'ERROR: TES_DEV_MIGRATOR_PASSWORD is not set.'
  DO $$ BEGIN RAISE EXCEPTION 'bootstrap refused: see the preceding message' USING ERRCODE = 'P0001'; END $$;
\endif

SELECT :'tes_confirm' = 'supabase-dev'                          AS confirm_ok,
       length(:'tes_backend_password') >= 24
         AND length(:'tes_migrator_password') >= 24
         AND :'tes_backend_password' <> :'tes_migrator_password'
         AND :'tes_backend_password' ~ '^[!-~]([ -~]*[!-~])?$'
         AND :'tes_migrator_password' ~ '^[!-~]([ -~]*[!-~])?$' AS passwords_ok
\gset

\if :confirm_ok
\else
  \echo 'ERROR: TES_DEV_BOOTSTRAP_CONFIRM must equal supabase-dev.'
  DO $$ BEGIN RAISE EXCEPTION 'bootstrap refused: see the preceding message' USING ERRCODE = 'P0001'; END $$;
\endif
\if :passwords_ok
\else
  \echo 'ERROR: passwords must be >= 24 printable ASCII characters (no other characters: the stored hash depends on the client encoding), without leading/trailing blanks, and different from each other.'
  DO $$ BEGIN RAISE EXCEPTION 'bootstrap refused: see the preceding message' USING ERRCODE = 'P0001'; END $$;
\endif

-- ---------------------------------------------------------------------
-- 0. Environment guards (fail closed)
-- ---------------------------------------------------------------------
DO $guard$
BEGIN
  IF current_setting('is_superuser') = 'on' THEN
    RAISE EXCEPTION 'bootstrap must run as the non-superuser project admin role, not as a superuser';
  END IF;
  IF current_setting('server_version_num')::int < 160000 THEN
    RAISE EXCEPTION 'PostgreSQL 16 or newer is required (target: 17) (found %)', current_setting('server_version');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    RAISE EXCEPTION 'this does not look like a Supabase database (anon/authenticated/service_role roles or the extensions schema are missing)';
  END IF;
  IF current_database() ~* '(prod|production)' OR current_user ~* '(prod|production)' THEN
    RAISE EXCEPTION 'refusing to run: the database or user name looks like production';
  END IF;
  IF NOT (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the bootstrap role needs CREATEROLE to manage the TES roles';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------
-- 1. Roles: exact production names, no elevated attributes
-- ---------------------------------------------------------------------
DO $roles$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'tes-backend@tes-production-510007.iam',
    'tes-database-migrator@tes-production-510007.iam'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- SUPERUSER, BYPASSRLS and REPLICATION default to off. A non-superuser
      -- admin may not even name them, so they are asserted in section 5.
      EXECUTE format('CREATE ROLE %I', r);
    END IF;
    EXECUTE format('ALTER ROLE %I WITH LOGIN NOCREATEDB NOCREATEROLE INHERIT', r);
  END LOOP;
END
$roles$;

ALTER ROLE "tes-backend@tes-production-510007.iam" WITH PASSWORD :'tes_backend_password';
ALTER ROLE "tes-database-migrator@tes-production-510007.iam" WITH PASSWORD :'tes_migrator_password';

-- Role-level settings survive transaction poolers (startup parameters may
-- not). The application relies on these instead of connection options.
ALTER ROLE "tes-backend@tes-production-510007.iam" SET statement_timeout = '30s';
ALTER ROLE "tes-backend@tes-production-510007.iam" SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE "tes-backend@tes-production-510007.iam" SET search_path = public;
ALTER ROLE "tes-database-migrator@tes-production-510007.iam" SET statement_timeout = '20min';
ALTER ROLE "tes-database-migrator@tes-production-510007.iam" SET idle_in_transaction_session_timeout = '10min';
ALTER ROLE "tes-database-migrator@tes-production-510007.iam" SET search_path = public;

-- ---------------------------------------------------------------------
-- 2. Database privileges: CONNECT for both, CREATE (schemas) for the
--    migrator only. Migration 0004 creates schema tes_security and
--    migrate.sh creates tes_system.
-- ---------------------------------------------------------------------
DO $db$
DECLARE
  b constant text := 'tes-backend@tes-production-510007.iam';
  m constant text := 'tes-database-migrator@tes-production-510007.iam';
BEGIN
  IF NOT has_database_privilege(b, current_database(), 'CONNECT') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), b);
  END IF;
  IF NOT has_database_privilege(m, current_database(), 'CONNECT') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), m);
  END IF;
  IF NOT has_database_privilege(m, current_database(), 'CREATE') THEN
    BEGIN
      EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), m);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'cannot grant CREATE on database % to the migrator (the admin role is not the database owner and has no grant option)', current_database();
    END;
    -- GRANT by a role without grant option only WARNs ("no privileges were
    -- granted"); verify the effect rather than trusting the statement.
    IF NOT has_database_privilege(m, current_database(), 'CREATE') THEN
      RAISE EXCEPTION 'CREATE on database % could not be granted to the migrator (the admin role is not the database owner and has no grant option)', current_database();
    END IF;
  END IF;
  IF has_database_privilege(b, current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'the runtime role must not hold CREATE on the database';
  END IF;
END
$db$;

-- ---------------------------------------------------------------------
-- 3. Schema public is owned by the migration identity (as the migrator
--    owns every other TES schema). Ownership lets migration 0001 revoke
--    PUBLIC/backend CREATE and grant backend USAGE exactly as in production.
--    The temporary membership is removed in the same transaction.
-- ---------------------------------------------------------------------
BEGIN;
DO $pre$
BEGIN
  -- While the admin role still owns public, remove CREATE from PUBLIC and the
  -- Data API roles (they only need USAGE for PostgREST to resolve names).
  IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') = current_user THEN
    REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END
$pre$;
DO $own$
DECLARE
  m constant text := 'tes-database-migrator@tes-production-510007.iam';
  cur_owner text;
BEGIN
  SELECT pg_get_userbyid(nspowner) INTO cur_owner FROM pg_namespace WHERE nspname = 'public';
  IF cur_owner IS DISTINCT FROM m THEN
    EXECUTE format('GRANT %I TO %I WITH INHERIT FALSE, SET TRUE', m, current_user);
    EXECUTE format('ALTER SCHEMA public OWNER TO %I', m);
    EXECUTE format('REVOKE %I FROM %I', m, current_user);
  END IF;
END
$own$;
COMMIT;

-- ---------------------------------------------------------------------
-- 4. btree_gist (migration 0023 uses CREATE EXTENSION IF NOT EXISTS and
--    exclusion constraints). Installed here, in Supabase's `extensions`
--    schema, so its helper functions stay out of the schema that the
--    PostgREST Data API exposes. 0023 then finds it present.
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ---------------------------------------------------------------------
-- 5. Post-conditions (fail closed)
-- ---------------------------------------------------------------------
DO $post$
DECLARE
  b constant text := 'tes-backend@tes-production-510007.iam';
  m constant text := 'tes-database-migrator@tes-production-510007.iam';
  bad int;
BEGIN
  SELECT count(*) INTO bad FROM pg_roles
   WHERE rolname IN (b, m)
     AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR NOT rolcanlogin);
  IF bad <> 0 THEN RAISE EXCEPTION 'a TES role has an elevated or missing attribute'; END IF;

  SELECT count(*) INTO bad FROM pg_auth_members am
   WHERE am.member IN (SELECT oid FROM pg_roles WHERE rolname IN (b, m));
  IF bad <> 0 THEN RAISE EXCEPTION 'a TES role is a member of another role'; END IF;

  IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') <> m THEN
    RAISE EXCEPTION 'schema public is not owned by the migrator';
  END IF;
  IF has_schema_privilege(b, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'the runtime role can create objects in public';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname IN ('tes_system', 'tes_security')
      AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))
  ) THEN
    RAISE EXCEPTION 'anon/authenticated/service_role hold privileges on a TES schema';
  END IF;
END
$post$;

\echo 'TES Supabase development bootstrap: OK'
