#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0012 (Addresses / Physical Locations / Home Yard foundation).
#
# The whole check runs in a READ ONLY transaction: it performs no INSERT, UPDATE,
# DELETE, DDL or temp-table creation, creates no locations, addresses or
# assignments, and ends with ROLLBACK. Runtime privileges are verified through
# catalog functions, not by switching roles.
#
# TES_VERIFY_PHASE=pre   Before 0012 is applied: the ledger holds exactly the
#                        repository's 0001-0011 checksums, none of the three
#                        tables or six trigger functions exist, the capability
#                        catalogue is still the six approved capabilities, and
#                        baseline row counts are logged.
# TES_VERIFY_PHASE=post  After 0012 is applied (default): the ledger holds 0001-0012
#                        with the repository checksums (so 0001-0011 are unchanged),
#                        the three tables exist with exactly the designed columns
#                        (including the correction columns on assignments),
#                        constraints, indexes, triggers and privileges (runtime has
#                        no DELETE / TRUNCATE and no write access to address content
#                        or assignment identity), no RLS, no SECURITY DEFINER
#                        function was added, no capability was added, and the data
#                        satisfies the invariants the schema is meant to guarantee.
#
# TES_VERIFY_EXPECT_EMPTY=1 (default) additionally requires the three tables to hold
# ZERO rows, which is the expected state immediately after the migration and before
# any application use. Set it to 0 for a later verification of a live system; the
# invariant checks still run against whatever rows exist.

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

PHASE="${TES_VERIFY_PHASE:-post}"
case "$PHASE" in
  pre|post) ;;
  *) echo "TES_VERIFY_PHASE must be 'pre' or 'post'." >&2; exit 1 ;;
esac

EXPECT_EMPTY="${TES_VERIFY_EXPECT_EMPTY:-1}"
case "$EXPECT_EMPTY" in
  0|1) ;;
  *) echo "TES_VERIFY_EXPECT_EMPTY must be 0 or 1." >&2; exit 1 ;;
esac

MIGRATIONS_DIR="${MIGRATIONS_DIR:-database/migrations}"
MIGRATION_0012="$MIGRATIONS_DIR/0012_organization_locations_foundation.sql"

if [[ ! -f "$MIGRATION_0012" ]]; then
  echo "Repository migration 0012 not found: $MIGRATION_0012" >&2
  exit 1
fi

# The migration must stay additive and must not grant DELETE / TRUNCATE / ALL, touch
# any other table, or add merge, coordinate, timezone or SECURITY DEFINER structures.
sql_only="$(grep -Ev '^[[:space:]]*--' "$MIGRATION_0012")"
if grep -Eiq '^[[:space:]]*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)[[:space:]]' <<<"$sql_only"; then
  echo "Migration 0012 contains a destructive or data-changing statement." >&2
  exit 1
fi
if grep -Eiq 'GRANT[^;]*(DELETE|TRUNCATE|ALL)' <<<"$sql_only"; then
  echo "Migration 0012 grants DELETE, TRUNCATE or ALL." >&2
  exit 1
fi
if grep -Eiq 'SECURITY[[:space:]]+DEFINER|ROW[[:space:]]+LEVEL[[:space:]]+SECURITY|merged_into|latitude|longitude|timezone' <<<"$sql_only"; then
  echo "Migration 0012 contains a structure outside the approved design." >&2
  exit 1
fi
if grep -Eiq '^[[:space:]]*ALTER[[:space:]]+TABLE[[:space:]]+(ONLY[[:space:]]+)?public\.' <<<"$sql_only"; then
  echo "Migration 0012 alters an existing table." >&2
  exit 1
fi

# Repository manifest: version:sha256 for every migration file.
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
  --set=expect_empty="$EXPECT_EMPTY" \
  --set=manifest="$manifest" <<'SQL'
BEGIN READ ONLY;

SELECT set_config('tes.verify_phase', :'phase', true),
       set_config('tes.verify_expect_empty', :'expect_empty', true),
       set_config('tes.verify_manifest', :'manifest', true);

-- ============================================================
-- Ledger vs repository (both phases): 0001-0011 byte-for-byte unchanged
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
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0012'
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
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0012'
  ) d;
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'ledger contains migration(s) the repository does not expect for phase %: %', phase, unexpected;
  END IF;

  IF (SELECT count(*) FROM tes_system.schema_migrations WHERE version <= '0011') <> 11 THEN
    RAISE EXCEPTION 'the ledger does not hold exactly migrations 0001-0011 below 0012';
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums for phase % (% migrations; 0001-0011 unchanged)',
    phase, (SELECT count(*) FROM tes_system.schema_migrations);
END
$verify$;

-- ============================================================
-- Row counts for every public table (both phases; for before/after comparison)
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
-- Both phases: authorization and catalogue untouched
-- ============================================================
DO $verify$
DECLARE
  got text;
BEGIN
  SELECT string_agg(code, ',' ORDER BY code) INTO got FROM public.capabilities;
  IF got IS DISTINCT FROM 'CUSTOMER_ESTABLISH,ORGANIZATION_ARCHIVE,ORGANIZATION_CREATE,ORGANIZATION_READ,ORGANIZATION_REGISTRY_READ,ORGANIZATION_UPDATE' THEN
    RAISE EXCEPTION 'the capability catalogue changed (0012 adds no capability): %', got;
  END IF;
  IF (SELECT count(*) FROM public.actor_relationships) <> 0
     OR (SELECT count(*) FROM public.relationship_assignments) <> 0
     OR (SELECT count(*) FROM public.relationship_capability_grants) <> 0 THEN
    RAISE NOTICE 'NOTE relationships / assignments / grants exist (informational; 0012 creates none)';
  END IF;
  RAISE NOTICE 'OK the six approved capabilities are unchanged';
END
$verify$;

-- ============================================================
-- Pre phase: nothing from 0012 exists yet
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public'
               AND c.relname IN ('locations', 'location_addresses', 'organization_location_assignments')) THEN
    RAISE EXCEPTION 'a 0012 table already exists before 0012';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security'
               AND p.proname IN ('prevent_location_data_removal','guard_location_address_update','guard_location_update',
                                 'guard_assignment_insert','guard_assignment_update','require_current_location_address')) THEN
    RAISE EXCEPTION 'a 0012 trigger function already exists before 0012';
  END IF;
  RAISE NOTICE 'OK no 0012 table or function exists before 0012';
END
$verify$;

-- ============================================================
-- Post phase: schema shape
-- ============================================================
DO $verify$
DECLARE
  got text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations
                 WHERE version = '0012' AND filename = '0012_organization_locations_foundation.sql') THEN
    RAISE EXCEPTION 'ledger has no 0012 entry with the expected filename';
  END IF;

  SELECT string_agg(c.relname, ',' ORDER BY c.relname) INTO got
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f');
  IF got IS DISTINCT FROM 'actor_relationships,actors,authentication_identities,capabilities,customer_engagements,customers,legacy_record_map,legacy_record_snapshots,location_addresses,locations,master_account_authority,master_register_events,organization_aliases,organization_classification_types,organization_classifications,organization_identifiers,organization_location_assignments,organizations,relationship_assignments,relationship_capability_grants' THEN
    RAISE EXCEPTION 'public relations differ from 0001-0011 plus the three 0012 tables: %', got;
  END IF;

  -- exact columns
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO got
  FROM pg_attribute a WHERE a.attrelid = 'public.locations'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF got IS DISTINCT FROM 'archived_at,created_at,id,kind,status,updated_at' THEN
    RAISE EXCEPTION 'locations columns differ from the design: %', got;
  END IF;
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO got
  FROM pg_attribute a WHERE a.attrelid = 'public.location_addresses'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF got IS DISTINCT FROM 'address_line_1,address_line_2,corrected_at,country_code,created_at,effective_from,effective_to,id,locality,location_id,match_key_building,match_key_unit,postal_code,postal_code_normalized,region_code,status,superseded_by_address_id,unit,updated_at,version_reason' THEN
    RAISE EXCEPTION 'location_addresses columns differ from the design: %', got;
  END IF;
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO got
  FROM pg_attribute a WHERE a.attrelid = 'public.organization_location_assignments'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF got IS DISTINCT FROM 'corrected_at,created_at,effective_from,effective_to,end_reason,id,location_id,location_kind,organization_id,role,status,superseded_by_assignment_id,updated_at' THEN
    RAISE EXCEPTION 'organization_location_assignments columns differ from the design: %', got;
  END IF;

  -- exact constraints (primary key, unique, check, foreign key)
  SELECT string_agg(conname, ',' ORDER BY conname) INTO got
  FROM pg_constraint WHERE conrelid = 'public.locations'::regclass;
  IF got IS DISTINCT FROM 'locations_archive_state_consistent,locations_id_kind_uq,locations_kind_valid,locations_pkey,locations_require_current_address,locations_status_valid' THEN
    RAISE EXCEPTION 'locations constraints differ from the design: %', got;
  END IF;
  SELECT string_agg(conname, ',' ORDER BY conname) INTO got
  FROM pg_constraint WHERE conrelid = 'public.location_addresses'::regclass;
  IF got IS DISTINCT FROM 'location_addresses_correction_state_consistent,location_addresses_country_code_valid,location_addresses_effective_window_valid,location_addresses_id_location_uq,location_addresses_line_1_not_blank,location_addresses_locality_not_blank,location_addresses_location_id_fkey,location_addresses_match_keys_not_blank,location_addresses_not_superseded_by_self,location_addresses_optional_text_not_blank,location_addresses_pkey,location_addresses_postal_pair_consistent,location_addresses_region_code_valid,location_addresses_status_valid,location_addresses_superseded_by_fk,location_addresses_version_reason_valid' THEN
    RAISE EXCEPTION 'location_addresses constraints differ from the design: %', got;
  END IF;
  SELECT string_agg(conname, ',' ORDER BY conname) INTO got
  FROM pg_constraint WHERE conrelid = 'public.organization_location_assignments'::regclass;
  IF got IS DISTINCT FROM 'organization_location_assignments_correction_state_consistent,organization_location_assignments_effective_window_valid,organization_location_assignments_end_state_consistent,organization_location_assignments_home_yard_physical,organization_location_assignments_id_org_role_uq,organization_location_assignments_location_fk,organization_location_assignments_not_superseded_by_self,organization_location_assignments_organization_id_fkey,organization_location_assignments_pkey,organization_location_assignments_role_valid,organization_location_assignments_status_valid,organization_location_assignments_superseded_by_fk' THEN
    RAISE EXCEPTION 'organization_location_assignments constraints differ from the design: %', got;
  END IF;

  -- geographic extensibility: no country / region allow-list in the database
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.location_addresses'::regclass
               AND conname IN ('location_addresses_country_code_valid', 'location_addresses_region_code_valid')
               AND (pg_get_constraintdef(oid) ~ '''(CA|US)''' OR pg_get_constraintdef(oid) ~* 'canada|united states')) THEN
    RAISE EXCEPTION 'a country / region constraint hard-codes CA / US';
  END IF;

  -- the deferred (same-location) replacement foreign key and the current-address trigger are deferrable by design
  IF (SELECT count(*) FROM pg_constraint
      WHERE conname IN ('location_addresses_superseded_by_fk', 'organization_location_assignments_superseded_by_fk')
        AND condeferrable AND condeferred) <> 2 THEN
    RAISE EXCEPTION 'a correction replacement foreign key is not DEFERRABLE INITIALLY DEFERRED';
  END IF;

  RAISE NOTICE 'OK 0012 tables, columns and constraints match the design';
END
$verify$;

-- ============================================================
-- Post phase: indexes (definitions compared exactly)
-- ============================================================
DO $verify$
DECLARE
  got text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(indexname, ',' ORDER BY indexname) INTO got
  FROM pg_indexes WHERE schemaname = 'public'
    AND tablename IN ('locations', 'location_addresses', 'organization_location_assignments');
  IF got IS DISTINCT FROM 'location_addresses_current_uq,location_addresses_id_location_uq,location_addresses_location_history_idx,location_addresses_match_building_idx,location_addresses_match_unit_idx,location_addresses_pkey,locations_id_kind_uq,locations_pkey,organization_location_assignments_current_role_uq,organization_location_assignments_id_org_role_uq,organization_location_assignments_location_idx,organization_location_assignments_org_history_idx,organization_location_assignments_pkey' THEN
    RAISE EXCEPTION '0012 index set differs from the design: %', got;
  END IF;

  IF (SELECT indexdef FROM pg_indexes WHERE indexname = 'location_addresses_current_uq')
     IS DISTINCT FROM $d$CREATE UNIQUE INDEX location_addresses_current_uq ON public.location_addresses USING btree (location_id) WHERE ((status = 'active'::text) AND (effective_to IS NULL))$d$ THEN
    RAISE EXCEPTION 'location_addresses_current_uq (one current address per Location) differs from the design';
  END IF;
  IF (SELECT indexdef FROM pg_indexes WHERE indexname = 'organization_location_assignments_current_role_uq')
     IS DISTINCT FROM $d$CREATE UNIQUE INDEX organization_location_assignments_current_role_uq ON public.organization_location_assignments USING btree (organization_id, role) WHERE ((status = 'active'::text) AND (effective_to IS NULL))$d$ THEN
    RAISE EXCEPTION 'organization_location_assignments_current_role_uq (one current assignment per role) differs from the design';
  END IF;

  -- advisory match keys are indexed but never unique
  IF EXISTS (SELECT 1 FROM pg_index i
             JOIN pg_class ic ON ic.oid = i.indexrelid
             WHERE ic.relname IN ('location_addresses_match_building_idx', 'location_addresses_match_unit_idx') AND i.indisunique) THEN
    RAISE EXCEPTION 'an advisory match-key index is unique';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
             WHERE i.indrelid = 'public.location_addresses'::regclass AND i.indisunique
               AND a.attname IN ('match_key_building', 'match_key_unit', 'postal_code', 'postal_code_normalized', 'address_line_1')) THEN
    RAISE EXCEPTION 'a unique index covers address content or match keys';
  END IF;

  RAISE NOTICE 'OK indexes match the design; match keys are advisory (non-unique)';
END
$verify$;

-- ============================================================
-- Post phase: triggers and trigger functions
-- ============================================================
DO $verify$
DECLARE
  got text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(tgrelid::regclass::text || '.' || tgname || ':' || tgenabled::text, ',' ORDER BY tgrelid::regclass::text, tgname) INTO got
  FROM pg_trigger
  WHERE NOT tgisinternal
    AND tgrelid IN ('public.locations'::regclass, 'public.location_addresses'::regclass, 'public.organization_location_assignments'::regclass);
  IF got IS DISTINCT FROM 'location_addresses.location_addresses_guard_update:O,location_addresses.location_addresses_no_delete:O,location_addresses.location_addresses_no_truncate:O,locations.locations_guard_update:O,locations.locations_no_delete:O,locations.locations_no_truncate:O,locations.locations_require_current_address:O,organization_location_assignments.organization_location_assignments_guard_insert:O,organization_location_assignments.organization_location_assignments_guard_update:O,organization_location_assignments.organization_location_assignments_no_delete:O,organization_location_assignments.organization_location_assignments_no_truncate:O' THEN
    RAISE EXCEPTION 'trigger set (or an enabled flag) differs from the design: %', got;
  END IF;

  IF (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security')
     IS DISTINCT FROM ARRAY['current_customer_id','guard_assignment_insert','guard_assignment_update','guard_legacy_record_map_update','guard_location_address_update','guard_location_update','prevent_legacy_record_mutation','prevent_location_data_removal','prevent_master_register_mutation','require_current_location_address','resolve_legacy_company'] THEN
    RAISE EXCEPTION 'tes_security function set differs from 0004/0007/0008/0010/0012';
  END IF;

  -- 0012 functions are SECURITY INVOKER with a fixed search_path and no PUBLIC execute
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security'
               AND p.proname IN ('prevent_location_data_removal','guard_location_address_update','guard_location_update',
                                 'guard_assignment_insert','guard_assignment_update','require_current_location_address')
               AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
                    OR has_function_privilege('public', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'a 0012 trigger function is SECURITY DEFINER, has no fixed search_path, or is executable by PUBLIC';
  END IF;

  -- the current-address check is a deferred constraint trigger
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'locations_require_current_address' AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred) THEN
    RAISE EXCEPTION 'locations_require_current_address is not a deferred constraint trigger';
  END IF;

  IF (SELECT array_agg(n.nspname || '.' || pp.proname ORDER BY pp.proname) FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace
      WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) IS DISTINCT FROM ARRAY['tes_security.resolve_legacy_company'] THEN
    RAISE EXCEPTION 'unexpected SECURITY DEFINER function set';
  END IF;

  RAISE NOTICE 'OK triggers enabled as designed; 0012 functions are SECURITY INVOKER, fixed search_path, no PUBLIC execute; SECURITY DEFINER set unchanged';
END
$verify$;

-- ============================================================
-- Post phase: privileges (runtime has no DELETE / TRUNCATE and no content rewrite)
-- ============================================================
DO $verify$
DECLARE
  runtime_role constant text := 'tes-backend@tes-production-510007.iam';
  migrator_role constant text := 'tes-database-migrator@tes-production-510007.iam';
  tbl text;
  priv text;
  col record;
  expected_insert jsonb := jsonb_build_object(
    'locations', 'kind',
    'location_addresses', 'address_line_1,address_line_2,country_code,effective_from,id,locality,location_id,match_key_building,match_key_unit,postal_code,postal_code_normalized,region_code,unit,version_reason',
    'organization_location_assignments', 'effective_from,effective_to,end_reason,id,location_id,location_kind,organization_id,role');
  expected_update jsonb := jsonb_build_object(
    'locations', 'archived_at,status,updated_at',
    'location_addresses', 'corrected_at,effective_to,status,superseded_by_address_id,updated_at',
    'organization_location_assignments', 'corrected_at,effective_to,end_reason,status,superseded_by_assignment_id,updated_at');
  got text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  FOREACH tbl IN ARRAY ARRAY['locations','location_addresses','organization_location_assignments'] LOOP
    IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = ('public.' || tbl)::regclass)) <> migrator_role THEN
      RAISE EXCEPTION '% is not owned by the migration identity', tbl;
    END IF;

    IF NOT has_table_privilege(runtime_role, 'public.' || tbl, 'SELECT') THEN
      RAISE EXCEPTION 'runtime lacks SELECT on %', tbl;
    END IF;
    FOREACH priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(runtime_role, 'public.' || tbl, priv) THEN
        RAISE EXCEPTION 'runtime has table-level % on % (grants must be column-specific, and never DELETE / TRUNCATE)', priv, tbl;
      END IF;
    END LOOP;

    -- ACL: owner + runtime only (no PUBLIC, no other role)
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) x
               WHERE c.oid = ('public.' || tbl)::regclass
                 AND x.grantee NOT IN (c.relowner, (SELECT oid FROM pg_roles WHERE rolname = runtime_role))) THEN
      RAISE EXCEPTION '% has an ACL entry for a role other than owner/runtime (including PUBLIC)', tbl;
    END IF;

    -- exact column-level INSERT and UPDATE sets
    SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO got
    FROM pg_attribute a
    WHERE a.attrelid = ('public.' || tbl)::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege(runtime_role, ('public.' || tbl)::regclass, a.attnum, 'INSERT');
    IF got IS DISTINCT FROM expected_insert ->> tbl THEN
      RAISE EXCEPTION 'runtime column INSERT privileges on % differ from the design: %', tbl, got;
    END IF;
    SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO got
    FROM pg_attribute a
    WHERE a.attrelid = ('public.' || tbl)::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege(runtime_role, ('public.' || tbl)::regclass, a.attnum, 'UPDATE');
    IF got IS DISTINCT FROM expected_update ->> tbl THEN
      RAISE EXCEPTION 'runtime column UPDATE privileges on % differ from the design: %', tbl, got;
    END IF;
  END LOOP;

  -- the migration identity is not the runtime identity
  IF migrator_role = runtime_role THEN RAISE EXCEPTION 'migrator and runtime identities are the same'; END IF;

  RAISE NOTICE 'OK runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; ACL owner + runtime';
END
$verify$;

-- ============================================================
-- Post phase: no RLS / policies on these global canonical tables
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM pg_class
             WHERE oid IN ('public.locations'::regclass, 'public.location_addresses'::regclass, 'public.organization_location_assignments'::regclass)
               AND (relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policy
                WHERE polrelid IN ('public.locations'::regclass, 'public.location_addresses'::regclass, 'public.organization_location_assignments'::regclass)) THEN
    RAISE EXCEPTION 'RLS or a policy exists on a 0012 table (not part of the approved design)';
  END IF;
  RAISE NOTICE 'OK no RLS / policy on the global canonical 0012 tables (visibility is enforced by the server)';
END
$verify$;

-- ============================================================
-- Post phase: row conditions
--   - zero rows immediately after the migration (TES_VERIFY_EXPECT_EMPTY=1)
--   - always: the invariants the schema is meant to guarantee hold for whatever rows exist
-- ============================================================
DO $verify$
DECLARE
  bad bigint;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF current_setting('tes.verify_expect_empty') = '1' THEN
    IF (SELECT count(*) FROM public.locations) <> 0
       OR (SELECT count(*) FROM public.location_addresses) <> 0
       OR (SELECT count(*) FROM public.organization_location_assignments) <> 0 THEN
      RAISE EXCEPTION 'a 0012 table is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
  END IF;

  SELECT count(*) INTO bad FROM public.locations l
  WHERE NOT EXISTS (SELECT 1 FROM public.location_addresses a WHERE a.location_id = l.id AND a.status = 'active' AND a.effective_to IS NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% Location(s) have no current address version', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT location_id FROM public.location_addresses WHERE status = 'active' AND effective_to IS NULL GROUP BY location_id HAVING count(*) > 1
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Location(s) have more than one current address version', bad; END IF;

  SELECT count(*) INTO bad FROM public.location_addresses c
  JOIN public.location_addresses r ON r.id = c.superseded_by_address_id
  WHERE c.status = 'corrected' AND (r.location_id <> c.location_id OR r.status <> 'active' AND r.status <> 'corrected');
  IF bad <> 0 THEN RAISE EXCEPTION '% corrected address version(s) point at an invalid replacement', bad; END IF;

  SELECT count(*) INTO bad FROM public.organization_location_assignments a
  JOIN public.locations l ON l.id = a.location_id
  WHERE a.role = 'HOME_YARD' AND l.kind <> 'PHYSICAL';
  IF bad <> 0 THEN RAISE EXCEPTION '% Home Yard assignment(s) reference a non-PHYSICAL Location', bad; END IF;

  SELECT count(*) INTO bad FROM public.organization_location_assignments a
  JOIN public.locations l ON l.id = a.location_id
  WHERE a.location_kind <> l.kind;
  IF bad <> 0 THEN RAISE EXCEPTION '% assignment(s) carry a stale location_kind', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT organization_id, role FROM public.organization_location_assignments WHERE status = 'active' AND effective_to IS NULL GROUP BY organization_id, role HAVING count(*) > 1
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Organization role(s) have more than one current assignment', bad; END IF;

  SELECT count(*) INTO bad FROM public.locations l
  WHERE l.status = 'archived'
    AND EXISTS (SELECT 1 FROM public.organization_location_assignments a WHERE a.location_id = l.id AND a.status = 'active' AND a.effective_to IS NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% archived Location(s) still have a current assignment', bad; END IF;

  SELECT count(*) INTO bad FROM public.organization_location_assignments c
  LEFT JOIN public.organization_location_assignments r ON r.id = c.superseded_by_assignment_id
  WHERE c.status = 'corrected'
    AND (r.id IS NULL OR r.organization_id <> c.organization_id OR r.role <> c.role OR r.effective_from <> c.effective_from);
  IF bad <> 0 THEN RAISE EXCEPTION '% corrected assignment(s) lack a replacement for the same Organization, role and business start', bad; END IF;

  SELECT count(*) INTO bad FROM public.organization_location_assignments a
  JOIN public.locations l ON l.id = a.location_id
  WHERE a.created_at < l.created_at;
  IF bad <> 0 THEN RAISE EXCEPTION '% assignment(s) were created before their Location', bad; END IF;

  RAISE NOTICE 'OK row conditions hold (rows: locations=%, addresses=%, assignments=%)',
    (SELECT count(*) FROM public.locations),
    (SELECT count(*) FROM public.location_addresses),
    (SELECT count(*) FROM public.organization_location_assignments);
END
$verify$;

ROLLBACK;

SELECT current_setting('server_version') AS server_version,
       (SELECT count(*) FROM tes_system.schema_migrations) AS applied_migrations,
       (SELECT count(*) FROM public.capabilities) AS capabilities;
SQL

echo "Production organization locations (${PHASE}) verification passed."
