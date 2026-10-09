#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0011 (Companies capability catalogue).
#
# The whole check runs in a READ ONLY transaction: it performs no INSERT, UPDATE,
# DELETE, DDL or temp-table creation, creates no relationships, assignments or
# grants, and ends with ROLLBACK. Runtime privileges are verified through catalog
# functions, not by switching roles.
#
# TES_VERIFY_PHASE=pre   Before 0011 is applied: the ledger holds exactly the
#                        repository's 0001-0010 checksums, none of the six
#                        capabilities exist, no relationship/assignment/grant exists,
#                        and baseline row counts are logged.
# TES_VERIFY_PHASE=post  After 0011 is applied (default): the ledger holds 0001-0011,
#                        exactly the six approved capabilities exist, nothing was
#                        granted or assigned, privileges and schema are unchanged,
#                        and the same row counts are logged for comparison.

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
MIGRATION_0011="$MIGRATIONS_DIR/0011_companies_capability_catalogue.sql"

if [[ ! -f "$MIGRATION_0011" ]]; then
  echo "Repository migration 0011 not found: $MIGRATION_0011" >&2
  exit 1
fi

# The migration must be a seed of exactly one INSERT into public.capabilities.
if grep -Eiq '^[[:space:]]*(UPDATE|DELETE|COPY|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)[[:space:]]' "$MIGRATION_0011"; then
  echo "Migration 0011 contains a statement other than the capability seed." >&2
  exit 1
fi
if [[ "$(grep -Eic '^[[:space:]]*INSERT[[:space:]]+INTO[[:space:]]' "$MIGRATION_0011")" != "1" ]] \
   || ! grep -Eiq '^[[:space:]]*INSERT[[:space:]]+INTO[[:space:]]+public\.capabilities[[:space:]]*\(' "$MIGRATION_0011"; then
  echo "Migration 0011 must contain exactly one INSERT INTO public.capabilities." >&2
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
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0011'
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
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0011'
  ) d;
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'ledger contains migration(s) the repository does not expect for phase %: %', phase, unexpected;
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums for phase % (% migrations; 0001-0010 unchanged)',
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
-- Nothing granted or assigned (both phases): ordinary actors remain unauthorized
-- ============================================================
DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.actor_relationships) <> 0 THEN
    RAISE EXCEPTION 'unexpected actor_relationships rows exist';
  END IF;
  IF (SELECT count(*) FROM public.relationship_assignments) <> 0 THEN
    RAISE EXCEPTION 'unexpected relationship_assignments rows exist';
  END IF;
  IF (SELECT count(*) FROM public.relationship_capability_grants) <> 0 THEN
    RAISE EXCEPTION 'unexpected relationship_capability_grants rows exist';
  END IF;
  -- The evaluator's join chain can match nothing when no relationship, assignment or grant exists.
  IF EXISTS (
    SELECT 1
    FROM public.actor_relationships ar
    JOIN public.relationship_assignments ra ON ra.relationship_id = ar.id
    JOIN public.relationship_capability_grants rcg ON rcg.relationship_id = ar.id
    JOIN public.capabilities c ON c.id = rcg.capability_id
  ) THEN
    RAISE EXCEPTION 'an ordinary actor can be authorized for a capability';
  END IF;
  RAISE NOTICE 'OK no relationships, assignments or grants exist; no ordinary actor can be authorized';
END
$verify$;

-- ============================================================
-- Pre phase: none of the six may exist yet
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;

  IF (SELECT count(*) FROM public.capabilities) <> 0 THEN
    RAISE EXCEPTION 'public.capabilities is not empty before 0011 (% rows)', (SELECT count(*) FROM public.capabilities);
  END IF;
  RAISE NOTICE 'OK capabilities catalogue is empty before 0011';
END
$verify$;

-- ============================================================
-- Post phase: the six approved capabilities, exactly
-- ============================================================
DO $verify$
DECLARE
  got text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations
                 WHERE version = '0011' AND filename = '0011_companies_capability_catalogue.sql') THEN
    RAISE EXCEPTION 'ledger has no 0011 entry with the expected filename';
  END IF;

  IF (SELECT count(*) FROM public.capabilities) <> 6 THEN
    RAISE EXCEPTION 'expected exactly 6 capabilities; found %', (SELECT count(*) FROM public.capabilities);
  END IF;

  SELECT string_agg(code || '|' || display_name || '|' || is_active::text || '|' || sort_order::text, ';' ORDER BY sort_order) INTO got
  FROM public.capabilities;
  IF got IS DISTINCT FROM 'ORGANIZATION_READ|Read Organization|true|10;ORGANIZATION_REGISTRY_READ|Read Organization Registry|true|20;ORGANIZATION_CREATE|Create Organization|true|30;ORGANIZATION_UPDATE|Update Organization|true|40;ORGANIZATION_ARCHIVE|Archive Organization|true|50;CUSTOMER_ESTABLISH|Establish Customer|true|60' THEN
    RAISE EXCEPTION 'capability codes/display names/active/sort_order differ from the approved catalogue: %', got;
  END IF;

  IF (SELECT count(DISTINCT sort_order) FROM public.capabilities) <> 6 THEN
    RAISE EXCEPTION 'sort_order values are not unique';
  END IF;

  IF EXISTS (SELECT 1 FROM public.capabilities WHERE description IS NULL OR btrim(description) = '') THEN
    RAISE EXCEPTION 'a capability has no description';
  END IF;

  -- Documented scope: CUSTOMER only for ORGANIZATION_READ, SYSTEM only for the other five.
  IF NOT (SELECT description LIKE '%Intended scope: CUSTOMER only.' AND description NOT LIKE '%SYSTEM only%'
          FROM public.capabilities WHERE code = 'ORGANIZATION_READ') THEN
    RAISE EXCEPTION 'ORGANIZATION_READ description does not state CUSTOMER-only scope';
  END IF;
  IF (SELECT count(*) FROM public.capabilities
      WHERE code <> 'ORGANIZATION_READ'
        AND description LIKE '%Intended scope: SYSTEM only.' AND description NOT LIKE '%CUSTOMER only%') <> 5 THEN
    RAISE EXCEPTION 'a SYSTEM capability description does not state SYSTEM-only scope';
  END IF;

  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code LIKE '%DELETE%') THEN
    RAISE EXCEPTION 'a DELETE capability exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'CUSTOMER_CREATE') THEN
    RAISE EXCEPTION 'CUSTOMER_CREATE exists (it was replaced by CUSTOMER_ESTABLISH)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.capabilities WHERE code = 'CUSTOMER_ESTABLISH') THEN
    RAISE EXCEPTION 'CUSTOMER_ESTABLISH is missing';
  END IF;

  RAISE NOTICE 'OK exactly six approved capabilities: codes, names, active, unique stable sort_order, documented scopes; no DELETE; no CUSTOMER_CREATE; CUSTOMER_ESTABLISH present';
END
$verify$;

-- ============================================================
-- Post phase: privilege model unchanged
-- ============================================================
DO $verify$
DECLARE
  runtime_role constant text := 'tes-backend@tes-production-510007.iam';
  migrator_role constant text := 'tes-database-migrator@tes-production-510007.iam';
  tbl text;
  priv text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.capabilities'::regclass)) <> migrator_role THEN
    RAISE EXCEPTION 'capabilities is not owned by the migration identity';
  END IF;

  -- Runtime keeps SELECT only on the catalogue.
  IF NOT has_table_privilege(runtime_role, 'public.capabilities', 'SELECT') THEN
    RAISE EXCEPTION 'runtime lost SELECT on capabilities';
  END IF;
  FOREACH priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(runtime_role, 'public.capabilities', priv) THEN
      RAISE EXCEPTION 'runtime unexpectedly has % on capabilities', priv;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.capabilities'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'capabilities has column-level ACL entries';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) x
             WHERE c.oid = 'public.capabilities'::regclass
               AND x.grantee NOT IN (c.relowner, (SELECT oid FROM pg_roles WHERE rolname = runtime_role))) THEN
    RAISE EXCEPTION 'capabilities has an ACL entry for a role other than owner/runtime (including PUBLIC)';
  END IF;

  -- Runtime remains read-only on the rest of the authorization model.
  FOREACH tbl IN ARRAY ARRAY['public.actor_relationships','public.relationship_assignments','public.relationship_capability_grants','public.master_account_authority'] LOOP
    FOREACH priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(runtime_role, tbl, priv) THEN
        RAISE EXCEPTION 'runtime unexpectedly has % on %', priv, tbl;
      END IF;
    END LOOP;
    IF has_any_column_privilege(runtime_role, tbl, 'INSERT,UPDATE') THEN
      RAISE EXCEPTION 'runtime unexpectedly has a column write privilege on %', tbl;
    END IF;
  END LOOP;

  RAISE NOTICE 'OK runtime has SELECT only on capabilities and no write on the authorization tables; ACL is owner + runtime SELECT';
END
$verify$;

-- ============================================================
-- Post phase: no unrelated schema objects, no RLS/triggers on the catalogue
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
    RAISE EXCEPTION 'public relations differ from 0001-0010: %', got;
  END IF;

  IF (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security')
     IS DISTINCT FROM ARRAY['current_customer_id','guard_legacy_record_map_update','prevent_legacy_record_mutation','prevent_master_register_mutation','resolve_legacy_company'] THEN
    RAISE EXCEPTION 'tes_security function set differs from 0004/0007/0008/0010';
  END IF;

  SELECT string_agg(indexrelid::regclass::text, ',' ORDER BY indexrelid::regclass::text) INTO got
  FROM pg_index WHERE indrelid = 'public.capabilities'::regclass;
  IF got IS DISTINCT FROM 'capabilities_active_sort_idx,capabilities_code_uq,capabilities_pkey' THEN
    RAISE EXCEPTION 'capabilities indexes differ from 0006: %', got;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.capabilities'::regclass AND NOT tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.capabilities'::regclass AND (relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.capabilities'::regclass) THEN
    RAISE EXCEPTION 'capabilities has a trigger, RLS or policy (not part of the design)';
  END IF;

  IF (SELECT array_agg(n.nspname || '.' || pp.proname ORDER BY pp.proname) FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace
      WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) IS DISTINCT FROM ARRAY['tes_security.resolve_legacy_company'] THEN
    RAISE EXCEPTION 'unexpected SECURITY DEFINER function set';
  END IF;

  RAISE NOTICE 'OK no unrelated relation, function, trigger, RLS or index was created; SECURITY DEFINER set unchanged';
END
$verify$;

ROLLBACK;

SELECT current_setting('server_version') AS server_version,
       (SELECT count(*) FROM tes_system.schema_migrations) AS applied_migrations,
       (SELECT count(*) FROM public.capabilities) AS capabilities;
SQL

echo "Production Companies capability catalogue (${PHASE}) verification passed."
