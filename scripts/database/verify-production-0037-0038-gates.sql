-- TES: READ-ONLY production gate checks for migrations 0037 and 0038. Run by an operator with a read-only role BEFORE approving either migration, then
-- again AFTER applying them. It changes nothing. Every "expect" line says what a safe database returns. (This repository cannot run it against
-- production: the production gates stay UNVERIFIED until an operator has run it and attached the output.)
SET default_transaction_read_only = on;

\echo 'G1 ledger: the highest applied migration. Expect 36 before 0037, 37 before 0038, 38 afterwards (the runtime role may not read it; use the migrator).'
SELECT max(filename) AS highest_applied_file, count(*) AS applied_count FROM tes_system.schema_migrations;

\echo 'G2 encoding: expect UTF8 (0037 refuses to apply otherwise)'
SELECT getdatabaseencoding() AS encoding, current_setting('server_version') AS server_version;

\echo 'G3 roles: expect both rows'
SELECT rolname FROM pg_roles WHERE rolname IN ('tes-backend@tes-production-510007.iam', 'tes-database-migrator@tes-production-510007.iam') ORDER BY 1;

\echo 'G4 (after 0037) the two SECURITY DEFINER functions. Expect: owner = the migrator; prosecdef true for both; proconfig pins search_path to pg_catalog, pg_temp; public_can_execute false;'
\echo '   runtime_can_execute true ONLY for driver_identity_unresolved (the authorized pre-check) and false for the trigger function; source_names_a_role false (no principal name in a security decision)'
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
       has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute,
       has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') AS runtime_can_execute,
       (p.prosrc ~* 'iam|tes-backend|session_user|current_user') AS source_names_a_role
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'tes_security' AND p.proname IN ('driver_identity_unresolved', 'guard_driver_assignment_identity', 'canonical_country_code', 'canonical_region_code', 'canonical_licence_number', 'region_country');

\echo 'G4b (after 0037) EXECUTE ACL of the pre-check: expect grantees = the owner and the runtime principal only'
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee, a.privilege_type
  FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 WHERE p.oid = 'tes_security.driver_identity_unresolved(uuid)'::regprocedure ORDER BY 1;

\echo 'G4c the runtime principal must NOT be a member of the role that owns the definer functions and the resolution tables: expect false'
SELECT pg_has_role('tes-backend@tes-production-510007.iam', pg_get_userbyid(p.proowner)::name, 'MEMBER') AS runtime_is_member_of_owner
  FROM pg_proc p WHERE p.oid = 'tes_security.driver_identity_unresolved(uuid)'::regprocedure;

\echo 'G5 (after 0037) the definer function reads entity-resolution tables as their owner: expect owner of the tables = owner of the function, force-RLS false, RLS enabled'
SELECT c.relname, pg_get_userbyid(c.relowner) AS table_owner, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
  FROM pg_class c WHERE c.oid IN ('public.entity_resolution_cases'::regclass, 'public.entity_resolution_candidates'::regclass);

\echo 'G6 (after 0037) the runtime role holds no direct SELECT widening on the resolution tables beyond the existing 0022 grant: expect only SELECT'
SELECT table_name, privilege_type FROM information_schema.role_table_grants
 WHERE grantee = 'tes-backend@tes-production-510007.iam' AND table_name IN ('entity_resolution_cases', 'entity_resolution_candidates') ORDER BY 1, 2;

\echo 'G7 RLS on the new table (after 0037): expect rls_enabled = true and one policy'
SELECT c.relname, c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c WHERE c.relname = 'driver_identity_verifications';

\echo 'G8 conflicts: run scripts/database/preflight-0037-driver-identity.sql (before 0037) and scripts/database/preflight-0038-duplicate-prevention.sql (before 0038). Expect zero rows in every section.'
\echo 'G9 unresolved identities: persons named by unresolved PERSON resolution cases that already hold an open driver assignment (they would be blocked from transfer/verification). Expect zero or a reviewed list.'
SELECT DISTINCT c.candidate_person_id AS person_id
  FROM public.entity_resolution_candidates c JOIN public.entity_resolution_cases k ON k.id = c.resolution_case_id
  JOIN public.organization_driver_relationships r ON r.person_id = c.candidate_person_id AND r.record_status = 'active' AND r.effective_to IS NULL
 WHERE k.entity_type = 'PERSON' AND k.resolution_state IN ('PENDING', 'REVIEW_REQUIRED');
