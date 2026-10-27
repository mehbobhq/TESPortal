-- LOCAL TEST FIXTURE ONLY. Emulates the parts of a Supabase project that the
-- TES development bootstrap depends on, on a disposable local PostgreSQL
-- cluster whose bootstrap superuser is `supabase_admin`:
--   * `postgres` is a NON-superuser (CREATEROLE CREATEDB BYPASSRLS REPLICATION)
--   * anon / authenticated / service_role / authenticator Data API roles
--   * schema `extensions`
--   * default privileges that hand every future public object created by
--     `postgres` or `supabase_admin` to the Data API roles
-- Never run against a real database.
--
-- psql variable: db_owner (default supabase_admin)

\set ON_ERROR_STOP on
\if :{?db_owner}
\else
  \set db_owner supabase_admin
\endif

CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator NOINHERIT LOGIN;
GRANT anon, authenticated, service_role TO authenticator;

CREATE ROLE postgres LOGIN CREATEROLE CREATEDB REPLICATION BYPASSRLS;
GRANT anon, authenticated, service_role TO postgres;

CREATE DATABASE tes_dev OWNER :"db_owner";
\connect tes_dev

CREATE SCHEMA extensions AUTHORIZATION postgres;
ALTER SCHEMA public OWNER TO postgres;

GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
