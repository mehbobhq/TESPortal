#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0010 (legacy company identity continuity).
#
# The whole check runs in a READ ONLY transaction: it performs no INSERT, UPDATE,
# DELETE, DDL or temp-table creation, creates no mappings or test rows, and ends
# with ROLLBACK. Runtime privileges are verified through catalog functions, not by
# switching roles.
#
# TES_VERIFY_PHASE=pre   Before 0010 is applied: ledger holds exactly the repository's
#                        0001-0009 with matching checksums, no 0010 object exists, and
#                        baseline row counts are logged.
# TES_VERIFY_PHASE=post  After 0010 is applied (default): every 0010 structure,
#                        constraint, trigger, privilege and function property is checked
#                        and the same row counts are logged again for comparison.

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

PHASE="${TES_VERIFY_PHASE:-post}"
case "$PHASE" in
  pre|post) ;;
  *) echo "TES_VERIFY_PHASE must be 'pre' or 'post'." >&2; exit 1 ;;
esac

MIGRATIONS_DIR="${MIGRATIONS_DIR:-database/migrations}"
MIGRATION_0010="$MIGRATIONS_DIR/0010_legacy_company_identity_continuity.sql"

if [[ ! -f "$MIGRATION_0010" ]]; then
  echo "Repository migration 0010 not found: $MIGRATION_0010" >&2
  exit 1
fi

# The migration must be structure-only: no data statements.
if grep -Eiq '^[[:space:]]*(INSERT|UPDATE|DELETE|COPY)[[:space:]]' "$MIGRATION_0010"; then
  echo "Migration 0010 contains a data-modifying statement." >&2
  exit 1
fi

# Repository manifest: version:sha256 for every migration file, in the same form the
# migration runner records in tes_system.schema_migrations.
manifest=""
for path in "$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$path")"
  version="${base%%_*}"
  checksum="$(sha256sum "$path" | awk '{print $1}')"
  manifest+="${version}:${checksum},"
done
manifest="${manifest%,}"

psql \
  --no-password \
  --set=ON_ERROR_STOP=1 \
  --set=phase="$PHASE" \
  --set=manifest="$manifest" <<'SQL'
BEGIN READ ONLY;

SELECT set_config('tes.verify_phase', :'phase', true),
       set_config('tes.verify_manifest', :'manifest', true);

-- ============================================================
-- Ledger vs repository (both phases)
-- ============================================================
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  manifest text := current_setting('tes.verify_manifest');
  missing text;
  unexpected text;
BEGIN
  SELECT string_agg(version, ',' ORDER BY version) INTO missing
  FROM (
    SELECT split_part(e, ':', 1) AS version, split_part(e, ':', 2) AS sha
    FROM unnest(string_to_array(manifest, ',')) AS e
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0010'
    EXCEPT
    SELECT version, sha256 FROM tes_system.schema_migrations
  ) d;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'ledger is missing, or has a different checksum for, repository migration(s): %', missing;
  END IF;

  SELECT string_agg(version, ',' ORDER BY version) INTO unexpected
  FROM (
    SELECT version, sha256 FROM tes_system.schema_migrations
    EXCEPT
    SELECT split_part(e, ':', 1), split_part(e, ':', 2)
    FROM unnest(string_to_array(manifest, ',')) AS e
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0010'
  ) d;

  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'ledger contains migration(s) that the repository does not expect for phase %: %', phase, unexpected;
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums for phase % (% migrations)',
    phase, (SELECT count(*) FROM tes_system.schema_migrations);
END
$verify$;

-- ============================================================
-- Baseline / comparison row counts (both phases; informational)
-- ============================================================
DO $verify$
DECLARE
  t record;
  n bigint;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t.relname) INTO n;
    RAISE NOTICE 'ROWCOUNT %=%', t.relname, n;
  END LOOP;
END
$verify$;

-- ============================================================
-- Pre phase: no 0010 object may exist
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;

  IF to_regclass('public.legacy_record_map') IS NOT NULL
     OR to_regclass('public.legacy_record_snapshots') IS NOT NULL THEN
    RAISE EXCEPTION 'a 0010 table already exists before 0010 is applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security'
               AND p.proname IN ('resolve_legacy_company','prevent_legacy_record_mutation','guard_legacy_record_map_update')) THEN
    RAISE EXCEPTION 'a 0010 function already exists before 0010 is applied';
  END IF;
  RAISE NOTICE 'OK no 0010 object exists yet';
END
$verify$;

-- ============================================================
-- Post phase: items 1-3 (ledger entry, tables), 4 (zero rows)
-- ============================================================
DO $verify$
DECLARE
  map_rows bigint;
  snap_rows bigint;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations
                 WHERE version = '0010' AND filename = '0010_legacy_company_identity_continuity.sql') THEN
    RAISE EXCEPTION 'ledger has no 0010 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK 1-2 ledger contains 0010 with a checksum equal to the repository file';

  IF to_regclass('public.legacy_record_map') IS NULL OR to_regclass('public.legacy_record_snapshots') IS NULL THEN
    RAISE EXCEPTION 'a 0010 table is missing';
  END IF;
  RAISE NOTICE 'OK 3 both tables exist';

  SELECT count(*) INTO map_rows FROM public.legacy_record_map;
  SELECT count(*) INTO snap_rows FROM public.legacy_record_snapshots;
  IF map_rows <> 0 OR snap_rows <> 0 THEN
    RAISE EXCEPTION 'expected zero rows after 0010; map=% snapshots=%', map_rows, snap_rows;
  END IF;
  RAISE NOTICE 'OK 4 both tables contain zero rows';
END
$verify$;

-- ============================================================
-- Post phase: item 5 (structure) and 6 (mapping_status rules)
-- ============================================================
DO $verify$
DECLARE
  got text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum) INTO got
  FROM pg_attribute a WHERE a.attrelid = 'public.legacy_record_map'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF got IS DISTINCT FROM 'id:uuid:true,source_system:text:true,source_namespace:text:true,legacy_entity_type:text:true,legacy_id:text:true,organization_id:uuid:true,mapping_status:text:true,superseded_at:timestamp with time zone:false,import_batch_id:uuid:true,imported_at:timestamp with time zone:true' THEN
    RAISE EXCEPTION 'legacy_record_map columns differ from approved design: %', got;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.legacy_record_map'::regclass AND attname IN ('customer_id','resolution_status') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'legacy_record_map has a column excluded by the approved design';
  END IF;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum) INTO got
  FROM pg_attribute a WHERE a.attrelid = 'public.legacy_record_snapshots'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF got IS DISTINCT FROM 'id:uuid:true,legacy_record_map_id:uuid:true,source_sha256:text:true,snapshot:jsonb:true,import_batch_id:uuid:true,imported_at:timestamp with time zone:true' THEN
    RAISE EXCEPTION 'legacy_record_snapshots columns differ from approved design: %', got;
  END IF;

  SELECT string_agg(conname || ':' || contype::text, ',' ORDER BY conname) INTO got
  FROM pg_constraint WHERE conrelid = 'public.legacy_record_map'::regclass;
  IF got IS DISTINCT FROM 'legacy_record_map_entity_type_valid:c,legacy_record_map_legacy_id_valid:c,legacy_record_map_mapping_status_valid:c,legacy_record_map_organization_id_fkey:f,legacy_record_map_pkey:p,legacy_record_map_source_namespace_valid:c,legacy_record_map_source_system_valid:c,legacy_record_map_supersede_not_before_import:c,legacy_record_map_supersede_state_consistent:c' THEN
    RAISE EXCEPTION 'legacy_record_map constraints differ from approved design: %', got;
  END IF;

  SELECT string_agg(conname || ':' || contype::text, ',' ORDER BY conname) INTO got
  FROM pg_constraint WHERE conrelid = 'public.legacy_record_snapshots'::regclass;
  IF got IS DISTINCT FROM 'legacy_record_snapshots_legacy_record_map_id_fkey:f,legacy_record_snapshots_map_content_uq:u,legacy_record_snapshots_pkey:p,legacy_record_snapshots_sha256_valid:c,legacy_record_snapshots_snapshot_is_object:c' THEN
    RAISE EXCEPTION 'legacy_record_snapshots constraints differ from approved design: %', got;
  END IF;

  -- Restrictive foreign keys to canonical/immutable parents.
  SELECT string_agg(conrelid::regclass::text || '->' || confrelid::regclass::text || ' del=' || confdeltype::text, ',' ORDER BY conrelid::regclass::text) INTO got
  FROM pg_constraint WHERE contype = 'f' AND conrelid IN ('public.legacy_record_map'::regclass, 'public.legacy_record_snapshots'::regclass);
  IF got IS DISTINCT FROM 'legacy_record_map->organizations del=r,legacy_record_snapshots->legacy_record_map del=r' THEN
    RAISE EXCEPTION 'foreign keys are not the approved RESTRICT references: %', got;
  END IF;

  SELECT string_agg(indexrelid::regclass::text || ':' || indisunique::text, ',' ORDER BY indexrelid::regclass::text) INTO got
  FROM pg_index WHERE indrelid IN ('public.legacy_record_map'::regclass, 'public.legacy_record_snapshots'::regclass);
  IF got IS DISTINCT FROM 'legacy_record_map_active_source_key_uq:true,legacy_record_map_legacy_lookup_idx:false,legacy_record_map_organization_idx:false,legacy_record_map_pkey:true,legacy_record_snapshots_map_content_uq:true,legacy_record_snapshots_pkey:true' THEN
    RAISE EXCEPTION 'indexes differ from approved design: %', got;
  END IF;

  IF pg_get_indexdef('public.legacy_record_map_active_source_key_uq'::regclass)
     IS DISTINCT FROM 'CREATE UNIQUE INDEX legacy_record_map_active_source_key_uq ON public.legacy_record_map USING btree (source_system, source_namespace, legacy_entity_type, legacy_id) WHERE (mapping_status = ''active''::text)' THEN
    RAISE EXCEPTION 'source-scoped active-mapping unique index definition differs from approved design';
  END IF;
  RAISE NOTICE 'OK 5 columns, PK/FK(RESTRICT)/unique/check constraints and indexes match the approved design';

  -- mapping_status rules.
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'legacy_record_map_mapping_status_valid')
       IS DISTINCT FROM $d$CHECK ((mapping_status = ANY (ARRAY['active'::text, 'superseded'::text])))$d$
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'legacy_record_map_supersede_state_consistent')
       IS DISTINCT FROM $d$CHECK ((((mapping_status = 'active'::text) AND (superseded_at IS NULL)) OR ((mapping_status = 'superseded'::text) AND (superseded_at IS NOT NULL))))$d$ THEN
    RAISE EXCEPTION 'mapping_status rules differ from approved design';
  END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'public.legacy_record_map'::regclass AND a.attname = 'mapping_status') IS DISTINCT FROM '''active''::text' THEN
    RAISE EXCEPTION 'mapping_status default is not active';
  END IF;
  RAISE NOTICE 'OK 6 mapping_status is active/superseded with the approved consistency rule and default';
END
$verify$;

-- ============================================================
-- Post phase: item 7 (immutability triggers)
-- ============================================================
DO $verify$
DECLARE
  got text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(tgrelid::regclass::text || '.' || tgname || ':' || tgenabled::text || ':' || tgtype::text, ',' ORDER BY tgname) INTO got
  FROM pg_trigger
  WHERE tgrelid IN ('public.legacy_record_map'::regclass, 'public.legacy_record_snapshots'::regclass) AND NOT tgisinternal;

  -- tgtype: 27 = row BEFORE UPDATE+DELETE+INSERT bits per PostgreSQL; compared via exact set below
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgrelid IN ('public.legacy_record_map'::regclass, 'public.legacy_record_snapshots'::regclass)
        AND NOT tgisinternal AND tgenabled = 'O') <> 5 THEN
    RAISE EXCEPTION 'expected exactly 5 enabled immutability triggers; found: %', got;
  END IF;

  IF (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
      WHERE tgrelid IN ('public.legacy_record_map'::regclass, 'public.legacy_record_snapshots'::regclass) AND NOT tgisinternal)
     IS DISTINCT FROM ARRAY['legacy_record_map_guard_update','legacy_record_map_no_delete','legacy_record_map_no_truncate','legacy_record_snapshots_no_truncate','legacy_record_snapshots_no_update_delete'] THEN
    RAISE EXCEPTION 'trigger set differs from approved design: %', got;
  END IF;

  -- BEFORE (tgtype bit 2) triggers; TRUNCATE (bit 32) statement-level; UPDATE (16) / DELETE (8) row-level (bit 1).
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'legacy_record_map_no_truncate'
                   AND (tgtype & 2) = 2 AND (tgtype & 32) = 32 AND (tgtype & 1) = 0)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'legacy_record_snapshots_no_truncate'
                   AND (tgtype & 2) = 2 AND (tgtype & 32) = 32 AND (tgtype & 1) = 0)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'legacy_record_map_no_delete'
                   AND (tgtype & 2) = 2 AND (tgtype & 8) = 8 AND (tgtype & 1) = 1)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'legacy_record_map_guard_update'
                   AND (tgtype & 2) = 2 AND (tgtype & 16) = 16 AND (tgtype & 1) = 1)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'legacy_record_snapshots_no_update_delete'
                   AND (tgtype & 2) = 2 AND (tgtype & 16) = 16 AND (tgtype & 8) = 8 AND (tgtype & 1) = 1) THEN
    RAISE EXCEPTION 'trigger timing/event/level differs from approved design';
  END IF;
  RAISE NOTICE 'OK 7 five immutability triggers exist, are enabled, and cover UPDATE/DELETE/TRUNCATE';
END
$verify$;

-- ============================================================
-- Post phase: items 8-9 (table privileges), 16 (no RLS)
-- ============================================================
DO $verify$
DECLARE
  runtime_role constant text := 'tes-backend@tes-production-510007.iam';
  migrator_role constant text := 'tes-database-migrator@tes-production-510007.iam';
  tbl text;
  priv text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  FOREACH tbl IN ARRAY ARRAY['public.legacy_record_map', 'public.legacy_record_snapshots'] LOOP
    IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = tbl::regclass)) <> migrator_role THEN
      RAISE EXCEPTION '% is not owned by the migration identity', tbl;
    END IF;

    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(runtime_role, tbl, priv) THEN
        RAISE EXCEPTION 'runtime role unexpectedly has table-level % on %', priv, tbl;
      END IF;
    END LOOP;

    IF has_any_column_privilege(runtime_role, tbl, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'runtime role unexpectedly has a column-level privilege on %', tbl;
    END IF;

    -- Only the owner may appear in the ACL: no PUBLIC (grantee 0), no runtime, nobody else.
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, '{}'::aclitem[])) x
               WHERE c.oid = tbl::regclass AND x.grantee <> c.relowner) THEN
      RAISE EXCEPTION '% has an ACL entry for a role other than its owner (including PUBLIC)', tbl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = tbl::regclass AND a.attacl IS NOT NULL) THEN
      RAISE EXCEPTION '% has column-level ACL entries', tbl;
    END IF;

    -- Item 16: no RLS, no policies.
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = tbl::regclass AND (relrowsecurity OR relforcerowsecurity))
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = tbl::regclass) THEN
      RAISE EXCEPTION 'row level security or a policy exists on % (not part of the approved design)', tbl;
    END IF;
  END LOOP;

  RAISE NOTICE 'OK 8-9 runtime and PUBLIC have no table or column privilege on either table; ACL is owner-only';
  RAISE NOTICE 'OK 16 no RLS enabled or forced, and no policy, on either table';
END
$verify$;

-- ============================================================
-- Post phase: items 10-15 (resolver)
-- ============================================================
DO $verify$
DECLARE
  runtime_role constant text := 'tes-backend@tes-production-510007.iam';
  migrator_role constant text := 'tes-database-migrator@tes-production-510007.iam';
  fn regprocedure;
  p pg_proc%ROWTYPE;
  other_grantees text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  fn := to_regprocedure('tes_security.resolve_legacy_company(text,text,text)');
  IF fn IS NULL THEN
    RAISE EXCEPTION 'resolver tes_security.resolve_legacy_company(text,text,text) does not exist';
  END IF;
  SELECT * INTO p FROM pg_proc WHERE oid = fn;

  IF pg_get_function_arguments(fn) <> 'p_source_system text, p_source_namespace text, p_legacy_id text'
     OR pg_get_function_result(fn) <> 'TABLE(resolved_organization_id uuid, resolved_customer_id uuid)' THEN
    RAISE EXCEPTION 'resolver signature/result differs from approved design';
  END IF;
  IF (SELECT count(*) FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace
      WHERE n.nspname = 'tes_security' AND pp.proname LIKE '%legacy%' AND pp.proname LIKE '%resolve%') <> 1 THEN
    RAISE EXCEPTION 'there is more than one legacy resolver (a bare lookup must not exist)';
  END IF;
  RAISE NOTICE 'OK 10 resolver exists with the approved three-part-key signature and result';

  IF NOT p.prosecdef THEN RAISE EXCEPTION 'resolver is not SECURITY DEFINER'; END IF;
  IF p.provolatile <> 's' THEN RAISE EXCEPTION 'resolver is not STABLE'; END IF;
  IF NOT p.proisstrict THEN RAISE EXCEPTION 'resolver is not STRICT'; END IF;
  IF p.prokind <> 'f' OR p.proleakproof OR p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'sql') THEN
    RAISE EXCEPTION 'resolver is not a plain, non-leakproof SQL function';
  END IF;
  IF pg_get_userbyid(p.proowner) <> migrator_role THEN
    RAISE EXCEPTION 'resolver owner is not the migration identity';
  END IF;
  RAISE NOTICE 'OK 11-12 resolver is SECURITY DEFINER, STABLE, STRICT, plain SQL, owned by the migration identity';

  IF p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] THEN
    RAISE EXCEPTION 'resolver search_path is not the approved fixed value: %', p.proconfig;
  END IF;
  -- Schema-qualified relations only: the body must not reference unqualified legacy/customer tables.
  IF p.prosrc ~* '(from|join)[[:space:]]+(legacy_record_map|customers)([[:space:]]|$)' THEN
    RAISE EXCEPTION 'resolver body contains an unqualified relation reference';
  END IF;
  RAISE NOTICE 'OK 13 resolver search_path is fixed to pg_catalog, pg_temp and relations are schema-qualified';

  -- A NULL function ACL is PostgreSQL's default, which grants EXECUTE to PUBLIC.
  IF p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC can execute the resolver';
  END IF;
  RAISE NOTICE 'OK 14 PUBLIC cannot execute the resolver';

  IF NOT has_function_privilege(runtime_role, fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime role cannot execute the resolver';
  END IF;
  SELECT string_agg(pg_get_userbyid(x.grantee), ',') INTO other_grantees
  FROM aclexplode(p.proacl) x
  WHERE x.grantee NOT IN (p.proowner, (SELECT oid FROM pg_roles WHERE rolname = runtime_role));
  IF other_grantees IS NOT NULL THEN
    RAISE EXCEPTION 'resolver is executable by unexpected role(s): %', other_grantees;
  END IF;
  IF has_function_privilege(runtime_role, 'tes_security.prevent_legacy_record_mutation()', 'EXECUTE')
     OR has_function_privilege(runtime_role, 'tes_security.guard_legacy_record_map_update()', 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime role can execute a 0010 trigger function';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc pp
             WHERE pp.oid IN ('tes_security.prevent_legacy_record_mutation()'::regprocedure, 'tes_security.guard_legacy_record_map_update()'::regprocedure)
               AND (pp.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(pp.proacl) x WHERE x.grantee = 0))) THEN
    RAISE EXCEPTION 'PUBLIC can execute a 0010 trigger function';
  END IF;
  RAISE NOTICE 'OK 15 only the owner and the runtime role can execute the resolver; trigger functions are not executable by runtime or PUBLIC';

  -- The resolver is the only SECURITY DEFINER function outside system schemas.
  IF (SELECT array_agg(n.nspname || '.' || pp.proname ORDER BY pp.proname) FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace
      WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) IS DISTINCT FROM ARRAY['tes_security.resolve_legacy_company'] THEN
    RAISE EXCEPTION 'unexpected SECURITY DEFINER function set';
  END IF;
  RAISE NOTICE 'OK resolver is the only SECURITY DEFINER function outside system schemas';
END
$verify$;

-- ============================================================
-- Post phase: item 17 (nothing else changed) and legacy IDs not in canonical identifiers
-- ============================================================
DO $verify$
DECLARE
  got text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(c.relname, ',' ORDER BY c.relname) INTO got
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f');
  IF got IS DISTINCT FROM 'actor_relationships,actors,authentication_identities,capabilities,customer_engagements,customers,legacy_record_map,legacy_record_snapshots,master_account_authority,master_register_events,organization_aliases,organization_classification_types,organization_classifications,organization_identifiers,organizations,relationship_assignments,relationship_capability_grants' THEN
    RAISE EXCEPTION 'public relations differ from 0001-0009 plus exactly the two 0010 tables: %', got;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'tes_security' AND c.relkind IN ('r','p','v','m','S','f')) THEN
    RAISE EXCEPTION 'unexpected relation in tes_security';
  END IF;

  IF (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security')
     IS DISTINCT FROM ARRAY['current_customer_id','guard_legacy_record_map_update','prevent_legacy_record_mutation','prevent_master_register_mutation','resolve_legacy_company'] THEN
    RAISE EXCEPTION 'tes_security function set differs from 0004/0007/0008 plus the three 0010 functions';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_identifiers
             WHERE upper(identifier_type) LIKE '%LEGACY%' OR upper(namespace) LIKE '%LEGACY%' OR upper(value) LIKE 'CMP-%') THEN
    RAISE EXCEPTION 'organization_identifiers contains legacy CMP-style data';
  END IF;

  RAISE NOTICE 'OK 17-18 no extra relation or function was created; 0001-0009 ledger checksums equal the repository (see ledger check); compare ROWCOUNT lines with the pre-phase run';
END
$verify$;

ROLLBACK;

SELECT current_setting('server_version') AS server_version,
       (SELECT count(*) FROM tes_system.schema_migrations) AS applied_migrations;
SQL

echo "Production legacy-continuity (${PHASE}) verification passed."
