#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0013 (Authorities: operating-authority foundation).
#
# The whole check runs in a READ ONLY transaction: it performs no INSERT, UPDATE,
# DELETE, DDL or temp-table creation, creates no authorities, versions or status
# periods, and ends with ROLLBACK. Runtime privileges are verified through catalog
# functions and ACLs, not by switching roles.
#
# TES_VERIFY_PHASE=pre   Before 0013 is applied: the ledger holds exactly the
#                        repository's 0001-0012 checksums (and no 0013), none of the
#                        four tables or seven trigger functions exist, the capability
#                        catalogue is still the six approved capabilities, and baseline
#                        row counts are logged.
# TES_VERIFY_PHASE=post  After 0013 is applied (default): the ledger holds 0001-0013 with
#                        the repository checksums (so 0001-0012 are unchanged); the four
#                        tables exist with exactly the designed columns (name, data type,
#                        nullability, default), constraints (definitions), indexes
#                        (definitions), triggers, trigger functions (SECURITY INVOKER,
#                        fixed search_path, body checksum, no PUBLIC execute), the
#                        authority_kinds catalogue holds exactly the seven seed rows,
#                        runtime privileges are exactly the designed table and column
#                        grants (no DELETE, no TRUNCATE, no PUBLIC privilege), there is
#                        no RLS or policy, no SECURITY DEFINER function and no capability
#                        was added, and the data satisfies the invariants the schema is
#                        meant to guarantee.
#
# TES_VERIFY_EXPECT_EMPTY=1 (default) additionally requires the three business tables
# (operating_authorities, operating_authority_versions, operating_authority_status_periods)
# to hold ZERO rows, the expected state immediately after the migration. Set it to 0 for
# a later verification of a live system; the invariant checks still run.
#
# TES_VERIFY_BASELINE_COUNTS (optional, post phase) is a comma-separated list of
# table=count pairs captured from the PRE run's ROWCOUNT lines. When set, every listed
# table must still hold exactly that many rows, proving baseline data is unchanged.
#
# The expected catalogue below was generated from a database migrated with the repository
# 0013 file, using the same queries as run here, and is compared EXACTLY.

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

BASELINE_COUNTS="${TES_VERIFY_BASELINE_COUNTS:-}"
if [[ -n "$BASELINE_COUNTS" && ! "$BASELINE_COUNTS" =~ ^[a-z_0-9]+=[0-9]+(,[a-z_0-9]+=[0-9]+)*$ ]]; then
  echo "TES_VERIFY_BASELINE_COUNTS must look like table=count,table=count." >&2
  exit 1
fi

MIGRATIONS_DIR="${MIGRATIONS_DIR:-database/migrations}"
MIGRATION_0013="$MIGRATIONS_DIR/0013_operating_authorities_foundation.sql"

if [[ ! -f "$MIGRATION_0013" ]]; then
  echo "Repository migration 0013 not found: $MIGRATION_0013" >&2
  exit 1
fi

# The migration must stay additive: no destructive or data-changing statement except the
# catalogue seed, no DELETE / TRUNCATE / ALL grant, no other table touched, and no
# SECURITY DEFINER, RLS, capability or tenant-context structure.
sql_only="$(grep -Ev '^[[:space:]]*--' "$MIGRATION_0013")"
if grep -Eiq '^[[:space:]]*(DROP|TRUNCATE|DELETE|UPDATE)[[:space:]]' <<<"$sql_only"; then
  echo "Migration 0013 contains a destructive or data-changing statement." >&2
  exit 1
fi
if grep -Ei '^[[:space:]]*INSERT[[:space:]]' <<<"$sql_only" | grep -Eivq 'INSERT[[:space:]]+INTO[[:space:]]+public\.authority_kinds([[:space:]]|$)'; then
  echo "Migration 0013 inserts into a table other than authority_kinds." >&2
  exit 1
fi
if grep -Eiq 'GRANT[^;]*(DELETE|TRUNCATE|ALL)' <<<"$sql_only"; then
  echo "Migration 0013 grants DELETE, TRUNCATE or ALL." >&2
  exit 1
fi
if grep -Eiq 'SECURITY[[:space:]]+DEFINER|ROW[[:space:]]+LEVEL[[:space:]]+SECURITY|CREATE[[:space:]]+POLICY|public\.capabilities|relationship_capability_grants|set_config' <<<"$sql_only"; then
  echo "Migration 0013 contains a structure outside the approved design." >&2
  exit 1
fi
if grep -Eiq '^[[:space:]]*ALTER[[:space:]]+TABLE[[:space:]]+(ONLY[[:space:]]+)?public\.(authority_kinds|operating_authorit)' <<<"$sql_only" \
   || grep -Eiq '^[[:space:]]*ALTER[[:space:]]+TABLE[[:space:]]+(ONLY[[:space:]]+)?public\.' <<<"$(grep -Eiv 'ALTER[[:space:]]+TABLE[[:space:]]+(ONLY[[:space:]]+)?public\.(authority_kinds|operating_authorit)' <<<"$sql_only")"; then
  echo "Migration 0013 alters a table." >&2
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
  --set=baseline="$BASELINE_COUNTS" \
  --set=manifest="$manifest" <<'SQL'
BEGIN READ ONLY;

SELECT set_config('tes.verify_phase', :'phase', true),
       set_config('tes.verify_expect_empty', :'expect_empty', true),
       set_config('tes.verify_baseline', :'baseline', true),
       set_config('tes.verify_manifest', :'manifest', true);

-- ============================================================
-- Ledger vs repository (both phases): 0001-0012 byte-for-byte unchanged
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
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0013'
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
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0013'
  ) d;
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'ledger contains migration(s) the repository does not expect for phase %: %', phase, unexpected;
  END IF;

  IF (SELECT count(*) FROM tes_system.schema_migrations WHERE version <= '0012') <> 12 THEN
    RAISE EXCEPTION 'the ledger does not hold exactly migrations 0001-0012 at or below 0012';
  END IF;
  IF phase = 'pre' AND EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version >= '0013') THEN
    RAISE EXCEPTION 'the ledger already records 0013 (or later) before 0013 is applied';
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums for phase % (% migrations; 0001-0012 unchanged)',
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
    RAISE EXCEPTION 'the capability catalogue changed (0013 adds no capability): %', got;
  END IF;
  IF (SELECT count(*) FROM public.capabilities WHERE is_active IS NOT TRUE) <> 0 THEN
    RAISE NOTICE 'NOTE a capability is inactive (informational; 0013 changes none)';
  END IF;
  RAISE NOTICE 'OK the six approved capabilities are unchanged';
END
$verify$;

-- ============================================================
-- Pre phase: nothing from 0013 exists yet
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public'
               AND (c.relname LIKE 'operating\_authorit%' OR c.relname = 'authority_kinds')) THEN
    RAISE EXCEPTION 'a 0013 table, index or sequence already exists before 0013';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security'
               AND p.proname IN ('prevent_authority_data_removal','guard_authority_update','guard_authority_version_insert',
                                 'guard_authority_version_update','guard_authority_status_period_insert',
                                 'guard_authority_status_period_update','require_authority_current_state')) THEN
    RAISE EXCEPTION 'a 0013 trigger function already exists before 0013';
  END IF;
  RAISE NOTICE 'OK no 0013 table or function exists before 0013';
END
$verify$;

-- ============================================================
-- Post phase: ledger entry and the exact catalogue below
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations
                 WHERE version = '0013' AND filename = '0013_operating_authorities_foundation.sql') THEN
    RAISE EXCEPTION 'ledger has no 0013 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records 0013_operating_authorities_foundation.sql';
END
$verify$;

-- ============================================================
-- Post phase: exact catalogue (generated from the repository 0013 migration)
-- ============================================================

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$organizations
organization_identifiers
organization_aliases
organization_classification_types
organization_classifications
customers
customer_engagements
actors
authentication_identities
master_account_authority
actor_relationships
relationship_assignments
capabilities
relationship_capability_grants
master_register_events
legacy_record_map
legacy_record_snapshots
locations
location_addresses
organization_location_assignments
authority_kinds
operating_authorities
operating_authority_versions
operating_authority_status_periods$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$organizations
organization_identifiers
organization_aliases
organization_classification_types
organization_classifications
customers
customer_engagements
actors
authentication_identities
master_account_authority
actor_relationships
relationship_assignments
capabilities
relationship_capability_grants
master_register_events
legacy_record_map
legacy_record_snapshots
locations
location_addresses
organization_location_assignments
authority_kinds
operating_authorities
operating_authority_versions
operating_authority_status_periods$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'public relations (0001-0012 plus the four 0013 tables) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK public relations (0001-0012 plus the four 0013 tables) (24 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NULL default=-
jurisdiction_scope text NOT NULL default=-
issuer_country text NULL default=-
region_required boolean NOT NULL default=-
fixed_region text NULL default=-
has_expiry boolean NOT NULL default=-
one_current_per_organization boolean NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.authority_kinds'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.authority_kinds'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NULL default=-
jurisdiction_scope text NOT NULL default=-
issuer_country text NULL default=-
region_required boolean NOT NULL default=-
fixed_region text NULL default=-
has_expiry boolean NOT NULL default=-
one_current_per_organization boolean NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'authority_kinds columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK authority_kinds columns (name, data type, nullability, default) (13 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
kind text NOT NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.operating_authorities'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.operating_authorities'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
kind text NOT NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'operating_authorities columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK operating_authorities columns (name, data type, nullability, default) (7 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
authority_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
kind text NOT NULL default=-
number_display text NOT NULL default=-
number_normalized text NOT NULL default=-
normalization_rule_version text NOT NULL default=-
jurisdiction_country text NOT NULL default=-
jurisdiction_region text NULL default=-
issued_on date NULL default=-
expires_on date NULL default=-
version_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_version_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.operating_authority_versions'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.operating_authority_versions'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
authority_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
kind text NOT NULL default=-
number_display text NOT NULL default=-
number_normalized text NOT NULL default=-
normalization_rule_version text NOT NULL default=-
jurisdiction_country text NOT NULL default=-
jurisdiction_region text NULL default=-
issued_on date NULL default=-
expires_on date NULL default=-
version_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_version_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'operating_authority_versions columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK operating_authority_versions columns (name, data type, nullability, default) (19 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
authority_id uuid NOT NULL default=-
authority_status text NOT NULL default=-
period_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.operating_authority_status_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.operating_authority_status_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
authority_id uuid NOT NULL default=-
authority_status text NOT NULL default=-
period_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'operating_authority_status_periods columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK operating_authority_status_periods columns (name, data type, nullability, default) (11 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$authority_kinds authority_kinds_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
authority_kinds authority_kinds_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
authority_kinds authority_kinds_fixed_region_valid c CHECK (((fixed_region IS NULL) OR (fixed_region ~ '^[A-Z0-9]{1,8}$'::text))) deferrable=false deferred=false
authority_kinds authority_kinds_issuer_country_valid c CHECK (((issuer_country IS NULL) OR (issuer_country ~ '^[A-Z]{2}$'::text))) deferrable=false deferred=false
authority_kinds authority_kinds_jurisdiction_scope_valid c CHECK ((jurisdiction_scope = ANY (ARRAY['NATIONAL'::text, 'COUNTRY_REGION'::text, 'BASE_JURISDICTION'::text]))) deferrable=false deferred=false
authority_kinds authority_kinds_pkey p PRIMARY KEY (code) deferrable=false deferred=false
authority_kinds authority_kinds_scope_shape_consistent c CHECK ((((jurisdiction_scope = 'NATIONAL'::text) AND (issuer_country IS NOT NULL) AND (region_required = false) AND (fixed_region IS NULL)) OR ((jurisdiction_scope = 'COUNTRY_REGION'::text) AND (issuer_country IS NOT NULL) AND (region_required = true)) OR ((jurisdiction_scope = 'BASE_JURISDICTION'::text) AND (region_required = true) AND (fixed_region IS NULL)))) deferrable=false deferred=false
authority_kinds authority_kinds_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
operating_authorities operating_authorities_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
operating_authorities operating_authorities_id_kind_uq u UNIQUE (id, kind) deferrable=false deferred=false
operating_authorities operating_authorities_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
operating_authorities operating_authorities_kind_fkey f FOREIGN KEY (kind) REFERENCES authority_kinds(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
operating_authorities operating_authorities_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
operating_authorities operating_authorities_pkey p PRIMARY KEY (id) deferrable=false deferred=false
operating_authorities operating_authorities_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_authority_fk f FOREIGN KEY (authority_id, kind) REFERENCES operating_authorities(id, kind) ON DELETE RESTRICT deferrable=false deferred=false
operating_authority_versions operating_authority_versions_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_version_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_version_id IS NOT NULL)))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_country_valid c CHECK ((jurisdiction_country ~ '^[A-Z]{2}$'::text)) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_document_dates_valid c CHECK (((issued_on IS NULL) OR (expires_on IS NULL) OR (expires_on >= issued_on))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_id_authority_uq u UNIQUE (id, authority_id) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_not_superseded_by_self c CHECK (((superseded_by_version_id IS NULL) OR (superseded_by_version_id <> id))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_number_display_not_blank c CHECK ((btrim(number_display) <> ''::text)) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_number_normalized_not_blank c CHECK ((btrim(number_normalized) <> ''::text)) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_organization_fk f FOREIGN KEY (authority_id, organization_id) REFERENCES operating_authorities(id, organization_id) ON DELETE RESTRICT deferrable=false deferred=false
operating_authority_versions operating_authority_versions_pkey p PRIMARY KEY (id) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_reason_valid c CHECK ((version_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_region_valid c CHECK (((jurisdiction_region IS NULL) OR (jurisdiction_region ~ '^[A-Z0-9]{1,8}$'::text))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_rule_version_not_blank c CHECK ((btrim(normalization_rule_version) <> ''::text)) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_superseded_by_fk f FOREIGN KEY (superseded_by_version_id, authority_id) REFERENCES operating_authority_versions(id, authority_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
operating_authority_status_periods operating_authority_status_periods_authority_id_fkey f FOREIGN KEY (authority_id) REFERENCES operating_authorities(id) ON DELETE RESTRICT deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_id_authority_uq u UNIQUE (id, authority_id) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_reason_valid c CHECK ((period_reason = ANY (ARRAY['INITIAL'::text, 'TRANSITION'::text, 'REACTIVATION'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_status_valid c CHECK ((authority_status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'INACTIVE'::text, 'SUSPENDED'::text, 'REVOKED'::text, 'CANCELED'::text]))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, authority_id) REFERENCES operating_authority_status_periods(id, authority_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.authority_kinds'::regclass,'public.operating_authorities'::regclass,'public.operating_authority_versions'::regclass,'public.operating_authority_status_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.authority_kinds'::regclass,'public.operating_authorities'::regclass,'public.operating_authority_versions'::regclass,'public.operating_authority_status_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$authority_kinds authority_kinds_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
authority_kinds authority_kinds_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
authority_kinds authority_kinds_fixed_region_valid c CHECK (((fixed_region IS NULL) OR (fixed_region ~ '^[A-Z0-9]{1,8}$'::text))) deferrable=false deferred=false
authority_kinds authority_kinds_issuer_country_valid c CHECK (((issuer_country IS NULL) OR (issuer_country ~ '^[A-Z]{2}$'::text))) deferrable=false deferred=false
authority_kinds authority_kinds_jurisdiction_scope_valid c CHECK ((jurisdiction_scope = ANY (ARRAY['NATIONAL'::text, 'COUNTRY_REGION'::text, 'BASE_JURISDICTION'::text]))) deferrable=false deferred=false
authority_kinds authority_kinds_pkey p PRIMARY KEY (code) deferrable=false deferred=false
authority_kinds authority_kinds_scope_shape_consistent c CHECK ((((jurisdiction_scope = 'NATIONAL'::text) AND (issuer_country IS NOT NULL) AND (region_required = false) AND (fixed_region IS NULL)) OR ((jurisdiction_scope = 'COUNTRY_REGION'::text) AND (issuer_country IS NOT NULL) AND (region_required = true)) OR ((jurisdiction_scope = 'BASE_JURISDICTION'::text) AND (region_required = true) AND (fixed_region IS NULL)))) deferrable=false deferred=false
authority_kinds authority_kinds_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
operating_authorities operating_authorities_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
operating_authorities operating_authorities_id_kind_uq u UNIQUE (id, kind) deferrable=false deferred=false
operating_authorities operating_authorities_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
operating_authorities operating_authorities_kind_fkey f FOREIGN KEY (kind) REFERENCES authority_kinds(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
operating_authorities operating_authorities_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
operating_authorities operating_authorities_pkey p PRIMARY KEY (id) deferrable=false deferred=false
operating_authorities operating_authorities_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_authority_fk f FOREIGN KEY (authority_id, kind) REFERENCES operating_authorities(id, kind) ON DELETE RESTRICT deferrable=false deferred=false
operating_authority_versions operating_authority_versions_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_version_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_version_id IS NOT NULL)))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_country_valid c CHECK ((jurisdiction_country ~ '^[A-Z]{2}$'::text)) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_document_dates_valid c CHECK (((issued_on IS NULL) OR (expires_on IS NULL) OR (expires_on >= issued_on))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_id_authority_uq u UNIQUE (id, authority_id) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_not_superseded_by_self c CHECK (((superseded_by_version_id IS NULL) OR (superseded_by_version_id <> id))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_number_display_not_blank c CHECK ((btrim(number_display) <> ''::text)) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_number_normalized_not_blank c CHECK ((btrim(number_normalized) <> ''::text)) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_organization_fk f FOREIGN KEY (authority_id, organization_id) REFERENCES operating_authorities(id, organization_id) ON DELETE RESTRICT deferrable=false deferred=false
operating_authority_versions operating_authority_versions_pkey p PRIMARY KEY (id) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_reason_valid c CHECK ((version_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_region_valid c CHECK (((jurisdiction_region IS NULL) OR (jurisdiction_region ~ '^[A-Z0-9]{1,8}$'::text))) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_rule_version_not_blank c CHECK ((btrim(normalization_rule_version) <> ''::text)) deferrable=false deferred=false
operating_authority_versions operating_authority_versions_superseded_by_fk f FOREIGN KEY (superseded_by_version_id, authority_id) REFERENCES operating_authority_versions(id, authority_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
operating_authority_status_periods operating_authority_status_periods_authority_id_fkey f FOREIGN KEY (authority_id) REFERENCES operating_authorities(id) ON DELETE RESTRICT deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_id_authority_uq u UNIQUE (id, authority_id) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_reason_valid c CHECK ((period_reason = ANY (ARRAY['INITIAL'::text, 'TRANSITION'::text, 'REACTIVATION'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_status_valid c CHECK ((authority_status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'INACTIVE'::text, 'SUSPENDED'::text, 'REVOKED'::text, 'CANCELED'::text]))) deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, authority_id) REFERENCES operating_authority_status_periods(id, authority_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0013 constraints (definition, deferrability) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0013 constraints (definition, deferrability) (41 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$authority_kinds authority_kinds_pkey CREATE UNIQUE INDEX authority_kinds_pkey ON public.authority_kinds USING btree (code)
authority_kinds authority_kinds_sort_order_uq CREATE UNIQUE INDEX authority_kinds_sort_order_uq ON public.authority_kinds USING btree (sort_order)
operating_authorities operating_authorities_pkey CREATE UNIQUE INDEX operating_authorities_pkey ON public.operating_authorities USING btree (id)
operating_authorities operating_authorities_id_kind_uq CREATE UNIQUE INDEX operating_authorities_id_kind_uq ON public.operating_authorities USING btree (id, kind)
operating_authorities operating_authorities_id_organization_uq CREATE UNIQUE INDEX operating_authorities_id_organization_uq ON public.operating_authorities USING btree (id, organization_id)
operating_authorities operating_authorities_organization_idx CREATE INDEX operating_authorities_organization_idx ON public.operating_authorities USING btree (organization_id, kind)
operating_authority_status_periods operating_authority_status_periods_pkey CREATE UNIQUE INDEX operating_authority_status_periods_pkey ON public.operating_authority_status_periods USING btree (id)
operating_authority_status_periods operating_authority_status_periods_id_authority_uq CREATE UNIQUE INDEX operating_authority_status_periods_id_authority_uq ON public.operating_authority_status_periods USING btree (id, authority_id)
operating_authority_status_periods operating_authority_status_periods_current_uq CREATE UNIQUE INDEX operating_authority_status_periods_current_uq ON public.operating_authority_status_periods USING btree (authority_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
operating_authority_status_periods operating_authority_status_periods_history_idx CREATE INDEX operating_authority_status_periods_history_idx ON public.operating_authority_status_periods USING btree (authority_id, effective_from)
operating_authority_versions operating_authority_versions_pkey CREATE UNIQUE INDEX operating_authority_versions_pkey ON public.operating_authority_versions USING btree (id)
operating_authority_versions operating_authority_versions_id_authority_uq CREATE UNIQUE INDEX operating_authority_versions_id_authority_uq ON public.operating_authority_versions USING btree (id, authority_id)
operating_authority_versions operating_authority_versions_current_uq CREATE UNIQUE INDEX operating_authority_versions_current_uq ON public.operating_authority_versions USING btree (authority_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
operating_authority_versions operating_authority_versions_current_identity_uq CREATE UNIQUE INDEX operating_authority_versions_current_identity_uq ON public.operating_authority_versions USING btree (organization_id, kind) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL) AND (kind = 'USDOT'::text))
operating_authority_versions operating_authority_versions_current_number_uq CREATE UNIQUE INDEX operating_authority_versions_current_number_uq ON public.operating_authority_versions USING btree (kind, jurisdiction_country, jurisdiction_region, number_normalized) NULLS NOT DISTINCT WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
operating_authority_versions operating_authority_versions_history_idx CREATE INDEX operating_authority_versions_history_idx ON public.operating_authority_versions USING btree (authority_id, effective_from)
operating_authority_versions operating_authority_versions_number_lookup_idx CREATE INDEX operating_authority_versions_number_lookup_idx ON public.operating_authority_versions USING btree (kind, number_normalized)$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('authority_kinds','operating_authorities','operating_authority_versions','operating_authority_status_periods')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('authority_kinds','operating_authorities','operating_authority_versions','operating_authority_status_periods')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$authority_kinds authority_kinds_pkey CREATE UNIQUE INDEX authority_kinds_pkey ON public.authority_kinds USING btree (code)
authority_kinds authority_kinds_sort_order_uq CREATE UNIQUE INDEX authority_kinds_sort_order_uq ON public.authority_kinds USING btree (sort_order)
operating_authorities operating_authorities_pkey CREATE UNIQUE INDEX operating_authorities_pkey ON public.operating_authorities USING btree (id)
operating_authorities operating_authorities_id_kind_uq CREATE UNIQUE INDEX operating_authorities_id_kind_uq ON public.operating_authorities USING btree (id, kind)
operating_authorities operating_authorities_id_organization_uq CREATE UNIQUE INDEX operating_authorities_id_organization_uq ON public.operating_authorities USING btree (id, organization_id)
operating_authorities operating_authorities_organization_idx CREATE INDEX operating_authorities_organization_idx ON public.operating_authorities USING btree (organization_id, kind)
operating_authority_status_periods operating_authority_status_periods_pkey CREATE UNIQUE INDEX operating_authority_status_periods_pkey ON public.operating_authority_status_periods USING btree (id)
operating_authority_status_periods operating_authority_status_periods_id_authority_uq CREATE UNIQUE INDEX operating_authority_status_periods_id_authority_uq ON public.operating_authority_status_periods USING btree (id, authority_id)
operating_authority_status_periods operating_authority_status_periods_current_uq CREATE UNIQUE INDEX operating_authority_status_periods_current_uq ON public.operating_authority_status_periods USING btree (authority_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
operating_authority_status_periods operating_authority_status_periods_history_idx CREATE INDEX operating_authority_status_periods_history_idx ON public.operating_authority_status_periods USING btree (authority_id, effective_from)
operating_authority_versions operating_authority_versions_pkey CREATE UNIQUE INDEX operating_authority_versions_pkey ON public.operating_authority_versions USING btree (id)
operating_authority_versions operating_authority_versions_id_authority_uq CREATE UNIQUE INDEX operating_authority_versions_id_authority_uq ON public.operating_authority_versions USING btree (id, authority_id)
operating_authority_versions operating_authority_versions_current_uq CREATE UNIQUE INDEX operating_authority_versions_current_uq ON public.operating_authority_versions USING btree (authority_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
operating_authority_versions operating_authority_versions_current_identity_uq CREATE UNIQUE INDEX operating_authority_versions_current_identity_uq ON public.operating_authority_versions USING btree (organization_id, kind) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL) AND (kind = 'USDOT'::text))
operating_authority_versions operating_authority_versions_current_number_uq CREATE UNIQUE INDEX operating_authority_versions_current_number_uq ON public.operating_authority_versions USING btree (kind, jurisdiction_country, jurisdiction_region, number_normalized) NULLS NOT DISTINCT WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
operating_authority_versions operating_authority_versions_history_idx CREATE INDEX operating_authority_versions_history_idx ON public.operating_authority_versions USING btree (authority_id, effective_from)
operating_authority_versions operating_authority_versions_number_lookup_idx CREATE INDEX operating_authority_versions_number_lookup_idx ON public.operating_authority_versions USING btree (kind, number_normalized)$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0013 indexes (exact definitions) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0013 indexes (exact definitions) (17 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$operating_authorities operating_authorities_guard_update enabled=O type=19 function=tes_security.guard_authority_update constraint=false deferrable=false deferred=false
operating_authorities operating_authorities_require_current_state enabled=O type=5 function=tes_security.require_authority_current_state constraint=true deferrable=true deferred=true
operating_authority_versions operating_authority_versions_guard_insert enabled=O type=7 function=tes_security.guard_authority_version_insert constraint=false deferrable=false deferred=false
operating_authority_versions operating_authority_versions_guard_update enabled=O type=19 function=tes_security.guard_authority_version_update constraint=false deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_guard_insert enabled=O type=7 function=tes_security.guard_authority_status_period_insert constraint=false deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_guard_update enabled=O type=19 function=tes_security.guard_authority_status_period_update constraint=false deferrable=false deferred=false
operating_authorities operating_authorities_no_delete enabled=O type=11 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false
operating_authority_versions operating_authority_versions_no_delete enabled=O type=11 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_no_delete enabled=O type=11 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false
operating_authorities operating_authorities_no_truncate enabled=O type=34 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false
operating_authority_versions operating_authority_versions_no_truncate enabled=O type=34 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_no_truncate enabled=O type=34 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.authority_kinds'::regclass,'public.operating_authorities'::regclass,'public.operating_authority_versions'::regclass,'public.operating_authority_status_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.authority_kinds'::regclass,'public.operating_authorities'::regclass,'public.operating_authority_versions'::regclass,'public.operating_authority_status_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$operating_authorities operating_authorities_guard_update enabled=O type=19 function=tes_security.guard_authority_update constraint=false deferrable=false deferred=false
operating_authorities operating_authorities_require_current_state enabled=O type=5 function=tes_security.require_authority_current_state constraint=true deferrable=true deferred=true
operating_authority_versions operating_authority_versions_guard_insert enabled=O type=7 function=tes_security.guard_authority_version_insert constraint=false deferrable=false deferred=false
operating_authority_versions operating_authority_versions_guard_update enabled=O type=19 function=tes_security.guard_authority_version_update constraint=false deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_guard_insert enabled=O type=7 function=tes_security.guard_authority_status_period_insert constraint=false deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_guard_update enabled=O type=19 function=tes_security.guard_authority_status_period_update constraint=false deferrable=false deferred=false
operating_authorities operating_authorities_no_delete enabled=O type=11 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false
operating_authority_versions operating_authority_versions_no_delete enabled=O type=11 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_no_delete enabled=O type=11 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false
operating_authorities operating_authorities_no_truncate enabled=O type=34 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false
operating_authority_versions operating_authority_versions_no_truncate enabled=O type=34 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false
operating_authority_status_periods operating_authority_status_periods_no_truncate enabled=O type=34 function=tes_security.prevent_authority_data_removal constraint=false deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0013 triggers (enabled flag, type, function, deferral) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0013 triggers (enabled flag, type, function, deferral) (12 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$guard_authority_status_period_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=709d95513bd0c54cb269f9244f5d74e6 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
prevent_authority_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=d07ce02061974c624af1176df4a0f55c owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_authority_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=f261b28cee12e42c5b75fb23162ef523 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_authority_version_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=baddbaed331c091efbf73f2f0893f858 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_authority_version_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=38441a2158875028ffd1ea3001cc590f owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_authority_status_period_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=e2bbed08da08d403f50d2f3d60989221 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_authority_current_state secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=401a250212a339630e20b4f01165de8e owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_authority_data_removal','guard_authority_update','guard_authority_version_insert','guard_authority_version_update','guard_authority_status_period_insert','guard_authority_status_period_update','require_authority_current_state')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_authority_data_removal','guard_authority_update','guard_authority_version_insert','guard_authority_version_update','guard_authority_status_period_insert','guard_authority_status_period_update','require_authority_current_state')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$guard_authority_status_period_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=709d95513bd0c54cb269f9244f5d74e6 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
prevent_authority_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=d07ce02061974c624af1176df4a0f55c owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_authority_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=f261b28cee12e42c5b75fb23162ef523 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_authority_version_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=baddbaed331c091efbf73f2f0893f858 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_authority_version_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=38441a2158875028ffd1ea3001cc590f owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_authority_status_period_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=e2bbed08da08d403f50d2f3d60989221 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_authority_current_state secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=401a250212a339630e20b4f01165de8e owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0013 trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0013 trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute) (7 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$prevent_location_data_removal
current_customer_id
prevent_master_register_mutation
prevent_legacy_record_mutation
guard_legacy_record_map_update
resolve_legacy_company
guard_location_address_update
guard_location_update
guard_assignment_insert
guard_assignment_update
require_current_location_address
prevent_authority_data_removal
guard_authority_update
guard_authority_version_insert
guard_authority_status_period_insert
guard_authority_version_update
guard_authority_status_period_update
require_authority_current_state$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security') AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security') AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$prevent_location_data_removal
current_customer_id
prevent_master_register_mutation
prevent_legacy_record_mutation
guard_legacy_record_map_update
resolve_legacy_company
guard_location_address_update
guard_location_update
guard_assignment_insert
guard_assignment_update
require_current_location_address
prevent_authority_data_removal
guard_authority_update
guard_authority_version_insert
guard_authority_status_period_insert
guard_authority_version_update
guard_authority_status_period_update
require_authority_current_state$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'tes_security function set differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK tes_security function set (18 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function set differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK SECURITY DEFINER function set (1 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$operating_authority_status_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
authority_kinds owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
operating_authorities owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
operating_authority_versions owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.authority_kinds'::regclass,'public.operating_authorities'::regclass,'public.operating_authority_versions'::regclass,'public.operating_authority_status_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.authority_kinds'::regclass,'public.operating_authorities'::regclass,'public.operating_authority_versions'::regclass,'public.operating_authority_status_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$operating_authority_status_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
authority_kinds owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
operating_authorities owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
operating_authority_versions owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0013 table ownership and RLS flags differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0013 table ownership and RLS flags (4 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$operating_authority_status_periods tes-backend@tes-production-510007.iam SELECT grantable=false
authority_kinds tes-backend@tes-production-510007.iam SELECT grantable=false
operating_authorities tes-backend@tes-production-510007.iam SELECT grantable=false
operating_authority_versions tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.authority_kinds'::regclass,'public.operating_authorities'::regclass,'public.operating_authority_versions'::regclass,'public.operating_authority_status_periods'::regclass) AND x.grantee <> c.relowner) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.authority_kinds'::regclass,'public.operating_authorities'::regclass,'public.operating_authority_versions'::regclass,'public.operating_authority_status_periods'::regclass) AND x.grantee <> c.relowner) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$operating_authority_status_periods tes-backend@tes-production-510007.iam SELECT grantable=false
authority_kinds tes-backend@tes-production-510007.iam SELECT grantable=false
operating_authorities tes-backend@tes-production-510007.iam SELECT grantable=false
operating_authority_versions tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0013 table ACL (every non-owner grantee) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0013 table ACL (every non-owner grantee) (4 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$operating_authorities.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authorities.kind tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authorities.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authorities.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authorities.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_versions.id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.authority_id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.kind tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.number_display tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.number_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.normalization_rule_version tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.jurisdiction_country tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.jurisdiction_region tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.issued_on tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.expires_on tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.version_reason tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_versions.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_versions.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_versions.superseded_by_version_id tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_versions.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_status_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_status_periods.authority_id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_status_periods.authority_status tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_status_periods.period_reason tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_status_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_status_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_status_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_status_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_status_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_status_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.authority_kinds'::regclass,'public.operating_authorities'::regclass,'public.operating_authority_versions'::regclass,'public.operating_authority_status_periods'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.authority_kinds'::regclass,'public.operating_authorities'::regclass,'public.operating_authority_versions'::regclass,'public.operating_authority_status_periods'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$operating_authorities.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authorities.kind tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authorities.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authorities.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authorities.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_versions.id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.authority_id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.kind tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.number_display tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.number_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.normalization_rule_version tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.jurisdiction_country tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.jurisdiction_region tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.issued_on tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.expires_on tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.version_reason tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_versions.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_versions.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_versions.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_versions.superseded_by_version_id tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_versions.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_status_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_status_periods.authority_id tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_status_periods.authority_status tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_status_periods.period_reason tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_status_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
operating_authority_status_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_status_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_status_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_status_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
operating_authority_status_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0013 column ACL (every column-specific grant) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0013 column ACL (every column-specific grant) (33 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$USDOT|USDOT Number|FMCSA USDOT number: assigned once to a legal person, non-transferable. National (US) number space; at most one current per Organization.|NATIONAL|US|false|-|false|true|true|10
MC|MC Docket (Operating Authority)|FMCSA MC-prefixed docket number of an operating authority registration (FF and MX dockets are different prefixes and are not modelled). National (US) number space; an Organization may hold more than one.|NATIONAL|US|false|-|false|false|true|20
MVID|MVID|Provincial motor vehicle client identifier (Alberta Registries uses MVID). Issuing province recorded per version; number space per issuing province.|COUNTRY_REGION|CA|true|-|false|false|true|30
RIN|RIN|Ontario Registrant Identification Number (MTO / ServiceOntario): a nine-digit number identifying a registrant of vehicles. Ontario number space.|COUNTRY_REGION|CA|true|ON|false|false|true|40
CVOR|CVOR|Ontario Commercial Vehicle Operator's Registration: nine-digit operator number on the CVOR certificate. Ontario number space.|COUNTRY_REGION|CA|true|ON|true|false|true|50
SAFETY_FITNESS|NSC / Safety Fitness Certificate|Canadian National Safety Code carrier number / safety fitness certificate assigned by the carrier's home province or territory. Number space per issuing province / territory.|COUNTRY_REGION|CA|true|-|true|false|true|60
IRP|IRP Account|International Registration Plan account issued by the registrant's base jurisdiction. Number space per base jurisdiction, which may change over time; an Organization may hold more than one.|BASE_JURISDICTION|-|true|-|false|false|true|70$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT code || '|' || display_name || '|' || COALESCE(description, '-') || '|' || jurisdiction_scope || '|' || COALESCE(issuer_country, '-') || '|' || region_required || '|' || COALESCE(fixed_region, '-') || '|' || has_expiry || '|' || one_current_per_organization || '|' || is_active || '|' || sort_order FROM public.authority_kinds) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT code || '|' || display_name || '|' || COALESCE(description, '-') || '|' || jurisdiction_scope || '|' || COALESCE(issuer_country, '-') || '|' || region_required || '|' || COALESCE(fixed_region, '-') || '|' || has_expiry || '|' || one_current_per_organization || '|' || is_active || '|' || sort_order FROM public.authority_kinds) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$USDOT|USDOT Number|FMCSA USDOT number: assigned once to a legal person, non-transferable. National (US) number space; at most one current per Organization.|NATIONAL|US|false|-|false|true|true|10
MC|MC Docket (Operating Authority)|FMCSA MC-prefixed docket number of an operating authority registration (FF and MX dockets are different prefixes and are not modelled). National (US) number space; an Organization may hold more than one.|NATIONAL|US|false|-|false|false|true|20
MVID|MVID|Provincial motor vehicle client identifier (Alberta Registries uses MVID). Issuing province recorded per version; number space per issuing province.|COUNTRY_REGION|CA|true|-|false|false|true|30
RIN|RIN|Ontario Registrant Identification Number (MTO / ServiceOntario): a nine-digit number identifying a registrant of vehicles. Ontario number space.|COUNTRY_REGION|CA|true|ON|false|false|true|40
CVOR|CVOR|Ontario Commercial Vehicle Operator's Registration: nine-digit operator number on the CVOR certificate. Ontario number space.|COUNTRY_REGION|CA|true|ON|true|false|true|50
SAFETY_FITNESS|NSC / Safety Fitness Certificate|Canadian National Safety Code carrier number / safety fitness certificate assigned by the carrier's home province or territory. Number space per issuing province / territory.|COUNTRY_REGION|CA|true|-|true|false|true|60
IRP|IRP Account|International Registration Plan account issued by the registrant's base jurisdiction. Number space per base jurisdiction, which may change over time; an Organization may hold more than one.|BASE_JURISDICTION|-|true|-|false|false|true|70$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'authority_kinds seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK authority_kinds seed rows (7 entries) match the design exactly';
END
$verify$;

-- ============================================================
-- Post phase: runtime privileges beyond the exact ACLs above
-- ============================================================
DO $verify$
DECLARE
  runtime_role constant text := 'tes-backend@tes-production-510007.iam';
  migrator_role constant text := 'tes-database-migrator@tes-production-510007.iam';
  tbl text;
  priv text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  FOREACH tbl IN ARRAY ARRAY['authority_kinds','operating_authorities','operating_authority_versions','operating_authority_status_periods'] LOOP
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
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('public', 'public.' || tbl, priv) THEN
        RAISE EXCEPTION 'PUBLIC has % on %', priv, tbl;
      END IF;
    END LOOP;
  END LOOP;

  -- the runtime catalogue (authority_kinds) can never be written by the runtime identity
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = 'public.authority_kinds'::regclass AND a.attnum > 0 AND NOT a.attisdropped
               AND (has_column_privilege(runtime_role, a.attrelid, a.attnum, 'INSERT')
                    OR has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'runtime can write authority_kinds (changed only by migrations)';
  END IF;

  IF migrator_role = runtime_role THEN RAISE EXCEPTION 'migrator and runtime identities are the same'; END IF;

  RAISE NOTICE 'OK runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; no PUBLIC privilege';
END
$verify$;

-- ============================================================
-- Post phase: no RLS / policies on these global canonical tables
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM pg_class
             WHERE oid IN ('public.authority_kinds'::regclass, 'public.operating_authorities'::regclass,
                           'public.operating_authority_versions'::regclass, 'public.operating_authority_status_periods'::regclass)
               AND (relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policy
                WHERE polrelid IN ('public.authority_kinds'::regclass, 'public.operating_authorities'::regclass,
                                   'public.operating_authority_versions'::regclass, 'public.operating_authority_status_periods'::regclass)) THEN
    RAISE EXCEPTION 'RLS or a policy exists on a 0013 table (not part of the approved design)';
  END IF;
  RAISE NOTICE 'OK no RLS / policy on the global canonical 0013 tables (visibility is enforced by the server)';
END
$verify$;

-- ============================================================
-- Post phase: row conditions
--   - zero business rows immediately after the migration (TES_VERIFY_EXPECT_EMPTY=1)
--   - always: the invariants the schema is meant to guarantee hold for whatever rows exist
-- ============================================================
DO $verify$
DECLARE
  bad bigint;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF current_setting('tes.verify_expect_empty') = '1' THEN
    IF (SELECT count(*) FROM public.operating_authorities) <> 0
       OR (SELECT count(*) FROM public.operating_authority_versions) <> 0
       OR (SELECT count(*) FROM public.operating_authority_status_periods) <> 0 THEN
      RAISE EXCEPTION 'a 0013 business table is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
  END IF;

  SELECT count(*) INTO bad FROM public.operating_authorities a
  WHERE NOT EXISTS (SELECT 1 FROM public.operating_authority_versions v WHERE v.authority_id = a.id AND v.record_status = 'active' AND v.effective_to IS NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% authority(ies) have no current version', bad; END IF;

  SELECT count(*) INTO bad FROM public.operating_authorities a
  WHERE NOT EXISTS (SELECT 1 FROM public.operating_authority_status_periods s WHERE s.authority_id = a.id AND s.record_status = 'active' AND s.effective_to IS NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% authority(ies) have no current status period', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT authority_id FROM public.operating_authority_versions WHERE record_status = 'active' AND effective_to IS NULL GROUP BY authority_id HAVING count(*) > 1
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% authority(ies) have more than one current version', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT authority_id FROM public.operating_authority_status_periods WHERE record_status = 'active' AND effective_to IS NULL GROUP BY authority_id HAVING count(*) > 1
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% authority(ies) have more than one current status period', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT organization_id FROM public.operating_authority_versions
    WHERE kind = 'USDOT' AND record_status = 'active' AND effective_to IS NULL GROUP BY organization_id HAVING count(*) > 1
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Organization(s) hold more than one current USDOT', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT kind, jurisdiction_country, jurisdiction_region, number_normalized FROM public.operating_authority_versions
    WHERE record_status = 'active' AND effective_to IS NULL
    GROUP BY kind, jurisdiction_country, jurisdiction_region, number_normalized HAVING count(*) > 1
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% authority number(s) are held by more than one current version in one namespace', bad; END IF;

  SELECT count(*) INTO bad FROM public.operating_authority_versions c
  LEFT JOIN public.operating_authority_versions r ON r.id = c.superseded_by_version_id
  WHERE c.record_status = 'corrected'
    AND (r.id IS NULL OR r.authority_id <> c.authority_id OR r.effective_from <> c.effective_from OR c.effective_to IS NOT NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% corrected version(s) lack a replacement for the same authority and business start, or were ended', bad; END IF;

  SELECT count(*) INTO bad FROM public.operating_authority_status_periods c
  LEFT JOIN public.operating_authority_status_periods r ON r.id = c.superseded_by_period_id
  WHERE c.record_status = 'corrected'
    AND (r.id IS NULL OR r.authority_id <> c.authority_id OR r.effective_from <> c.effective_from OR c.effective_to IS NOT NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% corrected status period(s) lack a replacement for the same authority and business start, or were ended', bad; END IF;

  SELECT count(*) INTO bad FROM public.operating_authority_versions v
  JOIN public.authority_kinds k ON k.code = v.kind
  WHERE (v.expires_on IS NOT NULL AND NOT k.has_expiry)
     OR (k.jurisdiction_scope = 'NATIONAL' AND (v.jurisdiction_region IS NOT NULL OR v.jurisdiction_country <> k.issuer_country))
     OR (k.region_required AND v.jurisdiction_region IS NULL)
     OR (k.fixed_region IS NOT NULL AND v.jurisdiction_region IS DISTINCT FROM k.fixed_region);
  IF bad <> 0 THEN RAISE EXCEPTION '% version(s) violate the rules of their authority kind', bad; END IF;

  SELECT count(*) INTO bad FROM public.operating_authority_status_periods
  WHERE authority_status NOT IN ('PENDING','ACTIVE','INACTIVE','SUSPENDED','REVOKED','CANCELED');
  IF bad <> 0 THEN RAISE EXCEPTION '% status period(s) hold a status outside the six approved statuses', bad; END IF;

  RAISE NOTICE 'OK row conditions hold (rows: authorities=%, versions=%, status periods=%)',
    (SELECT count(*) FROM public.operating_authorities),
    (SELECT count(*) FROM public.operating_authority_versions),
    (SELECT count(*) FROM public.operating_authority_status_periods);
END
$verify$;

-- ============================================================
-- Post phase: baseline data unchanged (optional, from the PRE run's ROWCOUNT lines)
-- ============================================================
DO $verify$
DECLARE
  pair text;
  tbl text;
  expected bigint;
  actual bigint;
  checked integer := 0;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' OR current_setting('tes.verify_baseline') = '' THEN RETURN; END IF;

  FOREACH pair IN ARRAY string_to_array(current_setting('tes.verify_baseline'), ',') LOOP
    tbl := split_part(pair, '=', 1);
    expected := split_part(pair, '=', 2)::bigint;
    IF tbl IN ('authority_kinds','operating_authorities','operating_authority_versions','operating_authority_status_periods') THEN
      RAISE EXCEPTION 'baseline list names a 0013 table: %', tbl;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO actual;
    IF actual <> expected THEN
      RAISE EXCEPTION 'baseline row count changed for %: expected %, found %', tbl, expected, actual;
    END IF;
    checked := checked + 1;
  END LOOP;
  RAISE NOTICE 'OK baseline row counts unchanged for % table(s)', checked;
END
$verify$;

ROLLBACK;

SELECT current_setting('server_version') AS server_version,
       (SELECT count(*) FROM tes_system.schema_migrations) AS applied_migrations,
       (SELECT count(*) FROM public.capabilities) AS capabilities;
SQL

echo "Production operating authorities (${PHASE}) verification passed."
