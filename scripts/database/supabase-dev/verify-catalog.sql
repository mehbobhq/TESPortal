-- READ-ONLY catalogue checks for the Supabase development database. Run as the migrator inside
-- BEGIN TRANSACTION READ ONLY by verify-readonly.sh. Emits `check|PASS/FAIL|detail` (counts and object names
-- only; no row data). psql variables: expected_rls_tables, expected_policies.
WITH
roles AS (SELECT * FROM pg_roles WHERE rolname IN ('tes-backend@tes-production-510007.iam','tes-database-migrator@tes-production-510007.iam')),
tes_ns AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public','tes_system','tes_security')),
dapi AS (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
own_objs AS (   -- every TES-schema object not owned by an extension
  SELECT n.nspname, c.relname AS obj, c.relkind::text AS kind, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN tes_ns n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p','v','m','S','f')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e','i') AND d.classid = 'pg_class'::regclass AND d.refclassid <> 'pg_class'::regclass)
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'a' AND d.classid = 'pg_class'::regclass)
  UNION ALL
  SELECT n.nspname, p.proname, 'f', pg_get_userbyid(p.proowner)
    FROM pg_proc p JOIN tes_ns n ON n.oid = p.pronamespace
   WHERE NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
),
chk AS (
SELECT 1 AS ord, 'roles_attributes' AS name,
  CASE WHEN (SELECT count(*) FROM roles) = 2 AND NOT EXISTS (SELECT 1 FROM roles WHERE rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR NOT rolcanlogin)
       THEN 'PASS' ELSE 'FAIL' END AS status,
  (SELECT count(*) FROM roles)||' TES roles; elevated/missing attribute count='||(SELECT count(*) FROM roles WHERE rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR NOT rolcanlogin) AS detail
UNION ALL SELECT 2, 'roles_no_memberships',
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_auth_members am JOIN roles r ON r.oid = am.member)
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members am JOIN roles r ON r.oid = am.roleid WHERE am.inherit_option OR am.set_option)
       THEN 'PASS' ELSE 'FAIL' END,
  'TES roles are in no role; nobody inherits or can SET ROLE to them'
UNION ALL SELECT 3, 'dataapi_not_in_tes_roles',
  CASE WHEN NOT EXISTS (SELECT 1 FROM dapi d CROSS JOIN roles r WHERE pg_has_role(d.rolname, r.oid, 'MEMBER')) THEN 'PASS' ELSE 'FAIL' END,
  'anon/authenticated/service_role hold no TES role (directly or by inheritance)'
UNION ALL SELECT 4, 'schema_ownership',
  CASE WHEN (SELECT count(*) FROM pg_namespace WHERE nspname IN ('public','tes_system','tes_security') AND pg_get_userbyid(nspowner) = 'tes-database-migrator@tes-production-510007.iam') = 3 THEN 'PASS' ELSE 'FAIL' END,
  'public, tes_system, tes_security owned by the migrator'
UNION ALL SELECT 5, 'object_ownership',
  CASE WHEN NOT EXISTS (SELECT 1 FROM own_objs WHERE owner <> 'tes-database-migrator@tes-production-510007.iam') THEN 'PASS' ELSE 'FAIL' END,
  (SELECT count(*) FROM own_objs)||' TES objects; not owned by the migrator='||(SELECT count(*) FROM own_objs WHERE owner <> 'tes-database-migrator@tes-production-510007.iam')
UNION ALL SELECT 6, 'rls_table_count',
  CASE WHEN (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND c.relrowsecurity) = :expected_rls_tables THEN 'PASS' ELSE 'FAIL' END,
  'rls_tables='||(SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND c.relrowsecurity)||' expected='||:expected_rls_tables
UNION ALL SELECT 7, 'policy_count',
  CASE WHEN (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'public'::regnamespace) = :expected_policies THEN 'PASS' ELSE 'FAIL' END,
  'policies='||(SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'public'::regnamespace)||' expected='||:expected_policies
UNION ALL SELECT 8, 'policy_roles_and_quals',
  CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_policy p WHERE EXISTS (SELECT 1 FROM dapi d WHERE d.rolname::regrole::oid = ANY (p.polroles))
            OR btrim(pg_get_expr(p.polqual, p.polrelid)) = 'true' OR btrim(pg_get_expr(p.polwithcheck, p.polrelid)) = 'true')
       THEN 'PASS' ELSE 'FAIL' END,
  'no policy names a Data API role or is a literal true'
UNION ALL SELECT 9, 'definer_functions',
  CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN tes_ns n ON n.oid = p.pronamespace
          WHERE p.prosecdef AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
            AND (pg_get_userbyid(p.proowner) <> 'tes-database-migrator@tes-production-510007.iam'
                 OR NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%')
                 OR EXISTS (SELECT 1 FROM pg_roles o WHERE o.oid = p.proowner AND (o.rolsuper OR o.rolbypassrls))))
       THEN 'PASS' ELSE 'FAIL' END,
  'SECURITY DEFINER functions='||(SELECT count(*) FROM pg_proc p JOIN tes_ns n ON n.oid = p.pronamespace WHERE p.prosecdef)||'; all owned by the migrator (no BYPASSRLS/superuser) with a fixed search_path'
UNION ALL SELECT 10, 'dataapi_relation_privileges',
  CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_class c JOIN tes_ns n ON n.oid = c.relnamespace CROSS JOIN dapi d
          WHERE c.relkind IN ('r','p','v','m','S','f')
            AND (CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(d.rolname, c.oid, 'USAGE,SELECT,UPDATE')
                      ELSE has_table_privilege(d.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') END
                 OR (c.relkind <> 'S' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                       AND has_column_privilege(d.rolname, c.oid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')))))
       THEN 'PASS' ELSE 'FAIL' END,
  'anon/authenticated/service_role (incl. PUBLIC and inherited) hold no privilege on any TES relation or column'
UNION ALL SELECT 11, 'dataapi_schema_privileges',
  CASE WHEN NOT EXISTS (
         SELECT 1 FROM dapi d WHERE has_schema_privilege(d.rolname, 'tes_system', 'USAGE,CREATE') OR has_schema_privilege(d.rolname, 'tes_security', 'USAGE,CREATE') OR has_schema_privilege(d.rolname, 'public', 'CREATE'))
        AND NOT has_schema_privilege('tes-backend@tes-production-510007.iam', 'tes_system', 'USAGE,CREATE')
        AND NOT has_schema_privilege('tes-backend@tes-production-510007.iam', 'public', 'CREATE')
        AND NOT has_schema_privilege('tes-backend@tes-production-510007.iam', 'tes_security', 'CREATE')
       THEN 'PASS' ELSE 'FAIL' END,
  'Data API roles: no USAGE on tes_system/tes_security, no CREATE on public; backend: no CREATE anywhere, no tes_system access'
UNION ALL SELECT 12, 'dataapi_reachable_functions',
  CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN tes_ns n ON n.oid = p.pronamespace CROSS JOIN dapi d
          WHERE NOT EXISTS (SELECT 1 FROM pg_depend x WHERE x.objid = p.oid AND x.deptype = 'e')
            AND has_function_privilege(d.rolname, p.oid, 'EXECUTE') AND has_schema_privilege(d.rolname, n.oid, 'USAGE'))
       THEN 'PASS' ELSE 'FAIL' END,
  'no TES function is both executable and name-resolvable by a Data API role (executable-but-unreachable trigger functions='||
  (SELECT count(*) FROM pg_proc p JOIN tes_ns n ON n.oid = p.pronamespace WHERE has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_schema_privilege('anon', n.oid, 'USAGE'))||')'
UNION ALL SELECT 13, 'default_acl_no_dataapi',
  CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_default_acl da CROSS JOIN LATERAL aclexplode(da.defaclacl) a
          WHERE da.defaclrole IN (SELECT oid FROM roles) AND a.grantee IN (SELECT d.rolname::regrole::oid FROM dapi d))
       THEN 'PASS' ELSE 'FAIL' END,
  'no default privilege created by a TES role grants anything to a Data API role'
UNION ALL SELECT 14, 'backend_owns_nothing',
  CASE WHEN NOT EXISTS (SELECT 1 FROM own_objs WHERE owner = 'tes-backend@tes-production-510007.iam') AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND pg_get_userbyid(datdba) = 'tes-backend@tes-production-510007.iam')
       THEN 'PASS' ELSE 'FAIL' END,
  'the runtime role owns no TES object, so row-level security always applies to it'
UNION ALL SELECT 15, 'extension_btree_gist',
  CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN 'PASS' ELSE 'FAIL' END,
  coalesce((SELECT 'schema='||n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'btree_gist'), 'missing')
UNION ALL SELECT 16, 'server_version',
  CASE WHEN current_setting('server_version_num')::int >= :min_server_version_num THEN 'PASS' ELSE 'FAIL' END,
  'server_version='||current_setting('server_version')
)
SELECT name||'|'||status||'|'||detail FROM chk ORDER BY ord;
