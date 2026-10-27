-- Post-migration security hardening for the Supabase DEVELOPMENT database. Run as the migrator by migrate-dev.sh after
-- every successful migration run. Idempotent. It does not modify any migration.
--
-- Why: PostgreSQL grants EXECUTE on new functions to PUBLIC unless revoked. Migrations 0001-0043 revoke it from most
-- functions, but 20 SECURITY INVOKER trigger functions in tes_security keep the default. Anon/authenticated/service_role
-- receive that through PUBLIC. They cannot name the schema today (no USAGE) and trigger functions cannot be called
-- directly, so the exposure is defence-in-depth only, but nothing in a Data API-enabled project should depend on that.
--
-- Scope is deliberately narrow: only trigger-returning functions owned by the migrator in the TES schemas. A trigger does
-- not need the firing user to hold EXECUTE (it is checked when the trigger is created), so the backend role is unaffected.
-- Any OTHER function that stays executable by a Data API role is reported by verify-readonly.sh as a FAIL, forcing an
-- explicit decision instead of a silent blanket revoke.
\set ON_ERROR_STOP on

DO $harden$
DECLARE
  m constant text := 'tes-database-migrator@tes-production-510007.iam';
  f regprocedure;
  revoked int := 0;
BEGIN
  IF current_user <> m THEN
    RAISE EXCEPTION 'hardening must run as the migrator (current_user is %)', current_user;
  END IF;

  FOR f IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'tes_security', 'tes_system')
       AND p.prorettype = 'trigger'::regtype
       AND pg_get_userbyid(p.proowner) = m
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
    revoked := revoked + 1;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'tes_security', 'tes_system')
       AND p.prorettype = 'trigger'::regtype
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'a trigger function is still executable by a Data API role after hardening';
  END IF;
  RAISE NOTICE 'TES hardening: revoked PUBLIC EXECUTE on % trigger function(s)', revoked;
END
$harden$;
