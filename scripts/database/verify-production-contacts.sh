#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0014 (Contacts / People foundation).
#
# The whole check runs in a READ ONLY transaction: it performs no INSERT, UPDATE,
# DELETE, DDL or temp-table creation, creates no authorities, versions or status
# periods, and ends with ROLLBACK. Runtime privileges are verified through catalog
# functions and ACLs, not by switching roles.
#
# TES_VERIFY_PHASE=pre   Before 0014 is applied: the ledger holds exactly the repository's 0001-0013 checksums (and no
#                        0014), none of the eight tables or nine trigger functions exist, the capability catalogue is
#                        exactly the six approved capabilities (full rows), and baseline row counts are logged.
# TES_VERIFY_PHASE=post  After 0014 is applied (default): the ledger holds 0001-0014 with the repository checksums (so
#                        0001-0013 are unchanged); the eight tables exist with exactly the designed columns (name, data
#                        type, nullability, default), constraints (definitions), indexes (definitions), triggers, trigger
#                        functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC execute), the purpose
#                        catalogue holds exactly the six seed rows, the capability catalogue is exactly the six originals
#                        (unchanged) plus PERSON_REGISTRY_READ and CONTACT_MANAGE (full rows), runtime privileges are
#                        exactly the designed table and column grants (no DELETE, no TRUNCATE, no PUBLIC privilege), there
#                        is no RLS or policy, no SECURITY DEFINER function was added, nothing was granted to anyone, and
#                        the data satisfies the invariants the schema is meant to guarantee.
#
# TES_VERIFY_EXPECT_EMPTY=1 (default) additionally requires the seven business tables to hold ZERO rows, the expected
# state immediately after the migration. Set it to 0 for a later verification of a live system; the invariant checks
# still run.
#
# TES_VERIFY_BASELINE_COUNTS (optional, post phase) is a comma-separated list of table=count pairs captured from the PRE
# run's ROWCOUNT lines. When set, every listed table must still hold exactly that many rows, proving baseline data is
# unchanged.
#
# The expected catalogue below was generated from a database migrated with the repository 0014 file, using the same
# queries as run here, and is compared EXACTLY. Representation differences between PostgreSQL versions (local 16 vs
# production 17) are neutralised by comparing structured catalog fields and whitespace-normalised definitions.

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
MIGRATION_0014="$MIGRATIONS_DIR/0014_contacts_people_foundation.sql"

if [[ ! -f "$MIGRATION_0014" ]]; then
  echo "Repository migration 0014 not found: $MIGRATION_0014" >&2
  exit 1
fi

# The migration must stay additive: no destructive or data-changing statement except the catalogue seeds
# (contact_purpose_types and the two capabilities), no DELETE / TRUNCATE / ALL grant, no existing table altered, and no
# SECURITY DEFINER, RLS, tenant-context, capability-grant or driver-data structure.
sql_only="$(grep -Ev '^[[:space:]]*--' "$MIGRATION_0014")"
if grep -Eiq '^[[:space:]]*(DROP|TRUNCATE|DELETE|UPDATE)[[:space:]]' <<<"$sql_only"; then
  echo "Migration 0014 contains a destructive or data-changing statement." >&2
  exit 1
fi
if grep -Ei '^[[:space:]]*INSERT[[:space:]]' <<<"$sql_only" | grep -Eivq 'INSERT[[:space:]]+INTO[[:space:]]+public\.(contact_purpose_types|capabilities)([[:space:]]|$)'; then
  echo "Migration 0014 inserts into a table other than contact_purpose_types / capabilities." >&2
  exit 1
fi
if grep -Eiq 'GRANT[^;]*(DELETE|TRUNCATE|ALL)' <<<"$sql_only"; then
  echo "Migration 0014 grants DELETE, TRUNCATE or ALL." >&2
  exit 1
fi
if grep -Eiq 'SECURITY[[:space:]]+DEFINER|ROW[[:space:]]+LEVEL[[:space:]]+SECURITY|CREATE[[:space:]]+POLICY|relationship_capability_grants|relationship_assignments|actor_relationships|set_config|current_customer_id|licen[cs]e|date_of_birth|medical|passport' <<<"$sql_only"; then
  echo "Migration 0014 contains a structure outside the approved design." >&2
  exit 1
fi
if grep -Eiq '^[[:space:]]*ALTER[[:space:]]+TABLE[[:space:]]' <<<"$sql_only"; then
  echo "Migration 0014 alters a table." >&2
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
-- Ledger vs repository (both phases): 0001-0013 byte-for-byte unchanged
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
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0014'
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
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0014'
  ) d;
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'ledger contains migration(s) the repository does not expect for phase %: %', phase, unexpected;
  END IF;

  IF (SELECT count(*) FROM tes_system.schema_migrations WHERE version <= '0013') <> 13 THEN
    RAISE EXCEPTION 'the ledger does not hold exactly migrations 0001-0013 at or below 0013';
  END IF;
  IF phase = 'pre' AND EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version >= '0014') THEN
    RAISE EXCEPTION 'the ledger already records 0014 (or later) before 0014 is applied';
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums for phase % (% migrations; 0001-0013 unchanged)',
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
-- Pre phase: nothing from 0014 exists yet
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public'
               AND c.relname IN ('contact_purpose_types','persons','person_name_versions','person_channels','organization_channels',
                                 'organization_person_relationships','organization_person_titles','contact_purpose_assignments')) THEN
    RAISE EXCEPTION 'a 0014 table already exists before 0014';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security'
               AND p.proname IN ('prevent_contact_data_removal','guard_person_update','guard_contact_period_update',
                                 'guard_person_dependent_insert','guard_organization_channel_insert','guard_relationship_insert',
                                 'guard_relationship_update','guard_relationship_dependent_insert','guard_purpose_assignment_insert')) THEN
    RAISE EXCEPTION 'a 0014 trigger function already exists before 0014';
  END IF;
  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code IN ('PERSON_REGISTRY_READ','CONTACT_MANAGE')) THEN
    RAISE EXCEPTION 'a 0014 capability already exists before 0014';
  END IF;
  RAISE NOTICE 'OK no 0014 table or function exists before 0014';
END
$verify$;

-- ============================================================
-- Post phase: ledger entry and the exact catalogue below
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations
                 WHERE version = '0014' AND filename = '0014_contacts_people_foundation.sql') THEN
    RAISE EXCEPTION 'ledger has no 0014 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records 0014_contacts_people_foundation.sql';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$ORGANIZATION_READ|Read Organization|Read the canonical Organization behind an already-authorized Customer. Does not authorize Organization directory listing or search. Intended scope: CUSTOMER only.|true|10
ORGANIZATION_REGISTRY_READ|Read Organization Registry|SYSTEM-wide Organization registry access: list and search Organizations, read any Organization, view duplicate-match details, and list Customers. Intended scope: SYSTEM only.|true|20
ORGANIZATION_CREATE|Create Organization|Create a canonical Organization. Does not establish a TES Customer relationship. Intended scope: SYSTEM only.|true|30
ORGANIZATION_UPDATE|Update Organization|Modify canonical Organization facts: names, aliases, appropriate identifiers, registration jurisdiction and organization classifications. Does not authorize independent domains such as Authorities, Tax, Customs, Vehicles, Drivers, Contacts or Credentials. Intended scope: SYSTEM only.|true|40
ORGANIZATION_ARCHIVE|Archive Organization|Archive or restore a canonical Organization while preserving history. There is no Organization delete capability. Intended scope: SYSTEM only.|true|50
CUSTOMER_ESTABLISH|Establish Customer|Establish the TES Customer relationship for an existing canonical Organization and begin the Customer engagement. A combined create-and-establish workflow also requires ORGANIZATION_CREATE. Intended scope: SYSTEM only.|true|60$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$ORGANIZATION_READ|Read Organization|Read the canonical Organization behind an already-authorized Customer. Does not authorize Organization directory listing or search. Intended scope: CUSTOMER only.|true|10
ORGANIZATION_REGISTRY_READ|Read Organization Registry|SYSTEM-wide Organization registry access: list and search Organizations, read any Organization, view duplicate-match details, and list Customers. Intended scope: SYSTEM only.|true|20
ORGANIZATION_CREATE|Create Organization|Create a canonical Organization. Does not establish a TES Customer relationship. Intended scope: SYSTEM only.|true|30
ORGANIZATION_UPDATE|Update Organization|Modify canonical Organization facts: names, aliases, appropriate identifiers, registration jurisdiction and organization classifications. Does not authorize independent domains such as Authorities, Tax, Customs, Vehicles, Drivers, Contacts or Credentials. Intended scope: SYSTEM only.|true|40
ORGANIZATION_ARCHIVE|Archive Organization|Archive or restore a canonical Organization while preserving history. There is no Organization delete capability. Intended scope: SYSTEM only.|true|50
CUSTOMER_ESTABLISH|Establish Customer|Establish the TES Customer relationship for an existing canonical Organization and begin the Customer engagement. A combined create-and-establish workflow also requires ORGANIZATION_CREATE. Intended scope: SYSTEM only.|true|60$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'capability catalogue before 0014 (the six approved capabilities, full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue before 0014 (the six approved capabilities, full rows) (6 entries) match the design exactly';
END
$verify$;

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
operating_authority_status_periods
contact_purpose_types
persons
person_name_versions
person_channels
organization_channels
organization_person_relationships
organization_person_titles
contact_purpose_assignments$exp$, E'\n')) AS l
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
operating_authority_status_periods
contact_purpose_types
persons
person_name_versions
person_channels
organization_channels
organization_person_relationships
organization_person_titles
contact_purpose_assignments$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'public relations (0001-0013 plus the eight 0014 tables) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK public relations (0001-0013 plus the eight 0014 tables) (32 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$ORGANIZATION_READ|Read Organization|Read the canonical Organization behind an already-authorized Customer. Does not authorize Organization directory listing or search. Intended scope: CUSTOMER only.|true|10
ORGANIZATION_REGISTRY_READ|Read Organization Registry|SYSTEM-wide Organization registry access: list and search Organizations, read any Organization, view duplicate-match details, and list Customers. Intended scope: SYSTEM only.|true|20
ORGANIZATION_CREATE|Create Organization|Create a canonical Organization. Does not establish a TES Customer relationship. Intended scope: SYSTEM only.|true|30
ORGANIZATION_UPDATE|Update Organization|Modify canonical Organization facts: names, aliases, appropriate identifiers, registration jurisdiction and organization classifications. Does not authorize independent domains such as Authorities, Tax, Customs, Vehicles, Drivers, Contacts or Credentials. Intended scope: SYSTEM only.|true|40
ORGANIZATION_ARCHIVE|Archive Organization|Archive or restore a canonical Organization while preserving history. There is no Organization delete capability. Intended scope: SYSTEM only.|true|50
CUSTOMER_ESTABLISH|Establish Customer|Establish the TES Customer relationship for an existing canonical Organization and begin the Customer engagement. A combined create-and-establish workflow also requires ORGANIZATION_CREATE. Intended scope: SYSTEM only.|true|60
PERSON_REGISTRY_READ|Read Person and Contact Registry|SYSTEM-wide read access to canonical people and Organization contact data: read the contacts of any Organization, find potential duplicate people, and view matched people across Organizations. Intended scope: SYSTEM only.|true|70
CONTACT_MANAGE|Manage Contacts|Create and maintain people, their channels, Organization contact channels, Organization-person relationships, titles and contact purposes, including corrections and ending history. Does not authorize reading people across Organizations. Intended scope: SYSTEM only.|true|80$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$ORGANIZATION_READ|Read Organization|Read the canonical Organization behind an already-authorized Customer. Does not authorize Organization directory listing or search. Intended scope: CUSTOMER only.|true|10
ORGANIZATION_REGISTRY_READ|Read Organization Registry|SYSTEM-wide Organization registry access: list and search Organizations, read any Organization, view duplicate-match details, and list Customers. Intended scope: SYSTEM only.|true|20
ORGANIZATION_CREATE|Create Organization|Create a canonical Organization. Does not establish a TES Customer relationship. Intended scope: SYSTEM only.|true|30
ORGANIZATION_UPDATE|Update Organization|Modify canonical Organization facts: names, aliases, appropriate identifiers, registration jurisdiction and organization classifications. Does not authorize independent domains such as Authorities, Tax, Customs, Vehicles, Drivers, Contacts or Credentials. Intended scope: SYSTEM only.|true|40
ORGANIZATION_ARCHIVE|Archive Organization|Archive or restore a canonical Organization while preserving history. There is no Organization delete capability. Intended scope: SYSTEM only.|true|50
CUSTOMER_ESTABLISH|Establish Customer|Establish the TES Customer relationship for an existing canonical Organization and begin the Customer engagement. A combined create-and-establish workflow also requires ORGANIZATION_CREATE. Intended scope: SYSTEM only.|true|60
PERSON_REGISTRY_READ|Read Person and Contact Registry|SYSTEM-wide read access to canonical people and Organization contact data: read the contacts of any Organization, find potential duplicate people, and view matched people across Organizations. Intended scope: SYSTEM only.|true|70
CONTACT_MANAGE|Manage Contacts|Create and maintain people, their channels, Organization contact channels, Organization-person relationships, titles and contact purposes, including corrections and ending history. Does not authorize reading people across Organizations. Intended scope: SYSTEM only.|true|80$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'capability catalogue after 0014 (six unchanged + PERSON_REGISTRY_READ + CONTACT_MANAGE, full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue after 0014 (six unchanged + PERSON_REGISTRY_READ + CONTACT_MANAGE, full rows) (8 entries) match the design exactly';
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
primary_mode text NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.contact_purpose_types'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.contact_purpose_types'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NULL default=-
primary_mode text NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'contact_purpose_types columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK contact_purpose_types columns (name, data type, nullability, default) (8 entries) match the design exactly';
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
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.persons'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.persons'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'persons columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK persons columns (name, data type, nullability, default) (5 entries) match the design exactly';
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
person_id uuid NOT NULL default=-
given_name text NULL default=-
family_name text NULL default=-
name_normalized text NOT NULL default=-
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.person_name_versions'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.person_name_versions'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
person_id uuid NOT NULL default=-
given_name text NULL default=-
family_name text NULL default=-
name_normalized text NOT NULL default=-
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'person_name_versions columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK person_name_versions columns (name, data type, nullability, default) (13 entries) match the design exactly';
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
person_id uuid NOT NULL default=-
channel_type text NOT NULL default=-
value_display text NOT NULL default=-
value_normalized text NOT NULL default=-
normalization_rule_version text NOT NULL default=-
extension text NULL default=-
is_preferred boolean NOT NULL default=false
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.person_channels'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.person_channels'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
person_id uuid NOT NULL default=-
channel_type text NOT NULL default=-
value_display text NOT NULL default=-
value_normalized text NOT NULL default=-
normalization_rule_version text NOT NULL default=-
extension text NULL default=-
is_preferred boolean NOT NULL default=false
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'person_channels columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK person_channels columns (name, data type, nullability, default) (16 entries) match the design exactly';
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
channel_type text NOT NULL default=-
channel_usage text NOT NULL default=-
value_display text NOT NULL default=-
value_normalized text NOT NULL default=-
normalization_rule_version text NOT NULL default=-
extension text NULL default=-
is_preferred boolean NOT NULL default=false
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.organization_channels'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.organization_channels'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
channel_type text NOT NULL default=-
channel_usage text NOT NULL default=-
value_display text NOT NULL default=-
value_normalized text NOT NULL default=-
normalization_rule_version text NOT NULL default=-
extension text NULL default=-
is_preferred boolean NOT NULL default=false
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'organization_channels columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK organization_channels columns (name, data type, nullability, default) (17 entries) match the design exactly';
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
person_id uuid NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.organization_person_relationships'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.organization_person_relationships'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
person_id uuid NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'organization_person_relationships columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK organization_person_relationships columns (name, data type, nullability, default) (9 entries) match the design exactly';
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
relationship_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
person_id uuid NOT NULL default=-
title_display text NOT NULL default=-
title_normalized text NOT NULL default=-
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.organization_person_titles'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.organization_person_titles'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
relationship_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
person_id uuid NOT NULL default=-
title_display text NOT NULL default=-
title_normalized text NOT NULL default=-
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'organization_person_titles columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK organization_person_titles columns (name, data type, nullability, default) (14 entries) match the design exactly';
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
relationship_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
person_id uuid NOT NULL default=-
purpose_code text NOT NULL default=-
is_primary boolean NOT NULL default=false
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.contact_purpose_assignments'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.contact_purpose_assignments'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
relationship_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
person_id uuid NOT NULL default=-
purpose_code text NOT NULL default=-
is_primary boolean NOT NULL default=false
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'contact_purpose_assignments columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK contact_purpose_assignments columns (name, data type, nullability, default) (14 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$organization_channels organization_channels_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
organization_channels organization_channels_superseded_by_fk f FOREIGN KEY (superseded_by_id, organization_id) REFERENCES organization_channels(id, organization_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
contact_purpose_assignments contact_purpose_assignments_pkey p PRIMARY KEY (id) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_id_relationship_uq u UNIQUE (id, relationship_id) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_purpose_code_fkey f FOREIGN KEY (purpose_code) REFERENCES contact_purpose_types(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_relationship_fk f FOREIGN KEY (relationship_id, organization_id, person_id) REFERENCES organization_person_relationships(id, organization_id, person_id) ON DELETE RESTRICT deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_superseded_by_fk f FOREIGN KEY (superseded_by_id, relationship_id) REFERENCES contact_purpose_assignments(id, relationship_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
contact_purpose_types contact_purpose_types_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
contact_purpose_types contact_purpose_types_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
contact_purpose_types contact_purpose_types_primary_mode_valid c CHECK ((primary_mode = ANY (ARRAY['NONE'::text, 'OPTIONAL'::text, 'SINGLE'::text]))) deferrable=false deferred=false
contact_purpose_types contact_purpose_types_pkey p PRIMARY KEY (code) deferrable=false deferred=false
contact_purpose_types contact_purpose_types_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
persons persons_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
persons persons_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
persons persons_pkey p PRIMARY KEY (id) deferrable=false deferred=false
person_name_versions person_name_versions_given_name_not_blank c CHECK (((given_name IS NULL) OR (btrim(given_name) <> ''::text))) deferrable=false deferred=false
person_name_versions person_name_versions_family_name_not_blank c CHECK (((family_name IS NULL) OR (btrim(family_name) <> ''::text))) deferrable=false deferred=false
person_name_versions person_name_versions_has_a_name c CHECK (((given_name IS NOT NULL) OR (family_name IS NOT NULL))) deferrable=false deferred=false
person_name_versions person_name_versions_name_normalized_not_blank c CHECK ((btrim(name_normalized) <> ''::text)) deferrable=false deferred=false
person_name_versions person_name_versions_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
person_name_versions person_name_versions_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
person_name_versions person_name_versions_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
person_name_versions person_name_versions_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)))) deferrable=false deferred=false
person_name_versions person_name_versions_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
person_name_versions person_name_versions_pkey p PRIMARY KEY (id) deferrable=false deferred=false
person_name_versions person_name_versions_id_person_uq u UNIQUE (id, person_id) deferrable=false deferred=false
person_name_versions person_name_versions_person_id_fkey f FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT deferrable=false deferred=false
person_name_versions person_name_versions_superseded_by_fk f FOREIGN KEY (superseded_by_id, person_id) REFERENCES person_name_versions(id, person_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
person_channels person_channels_channel_type_valid c CHECK ((channel_type ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
person_channels person_channels_value_display_not_blank c CHECK ((btrim(value_display) <> ''::text)) deferrable=false deferred=false
person_channels person_channels_value_normalized_not_blank c CHECK ((btrim(value_normalized) <> ''::text)) deferrable=false deferred=false
person_channels person_channels_rule_version_not_blank c CHECK ((btrim(normalization_rule_version) <> ''::text)) deferrable=false deferred=false
person_channels person_channels_extension_not_blank c CHECK (((extension IS NULL) OR (btrim(extension) <> ''::text))) deferrable=false deferred=false
person_channels person_channels_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
person_channels person_channels_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
person_channels person_channels_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
person_channels person_channels_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
person_channels person_channels_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
person_channels person_channels_pkey p PRIMARY KEY (id) deferrable=false deferred=false
person_channels person_channels_id_person_uq u UNIQUE (id, person_id) deferrable=false deferred=false
person_channels person_channels_person_id_fkey f FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT deferrable=false deferred=false
person_channels person_channels_superseded_by_fk f FOREIGN KEY (superseded_by_id, person_id) REFERENCES person_channels(id, person_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
organization_channels organization_channels_channel_type_valid c CHECK ((channel_type ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
organization_channels organization_channels_channel_usage_valid c CHECK ((channel_usage ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
organization_channels organization_channels_value_display_not_blank c CHECK ((btrim(value_display) <> ''::text)) deferrable=false deferred=false
organization_channels organization_channels_value_normalized_not_blank c CHECK ((btrim(value_normalized) <> ''::text)) deferrable=false deferred=false
organization_channels organization_channels_rule_version_not_blank c CHECK ((btrim(normalization_rule_version) <> ''::text)) deferrable=false deferred=false
organization_channels organization_channels_extension_not_blank c CHECK (((extension IS NULL) OR (btrim(extension) <> ''::text))) deferrable=false deferred=false
organization_channels organization_channels_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
organization_channels organization_channels_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
organization_channels organization_channels_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
organization_channels organization_channels_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
organization_channels organization_channels_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
organization_channels organization_channels_pkey p PRIMARY KEY (id) deferrable=false deferred=false
organization_channels organization_channels_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'voided'::text]))) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_void_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL)))) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_pkey p PRIMARY KEY (id) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_id_org_person_uq u UNIQUE (id, organization_id, person_id) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
organization_person_relationships organization_person_relationships_person_id_fkey f FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT deferrable=false deferred=false
organization_person_titles organization_person_titles_title_display_not_blank c CHECK ((btrim(title_display) <> ''::text)) deferrable=false deferred=false
organization_person_titles organization_person_titles_title_normalized_not_blank c CHECK ((btrim(title_normalized) <> ''::text)) deferrable=false deferred=false
organization_person_titles organization_person_titles_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
organization_person_titles organization_person_titles_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
organization_person_titles organization_person_titles_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
organization_person_titles organization_person_titles_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
organization_person_titles organization_person_titles_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
organization_person_titles organization_person_titles_pkey p PRIMARY KEY (id) deferrable=false deferred=false
organization_person_titles organization_person_titles_id_relationship_uq u UNIQUE (id, relationship_id) deferrable=false deferred=false
organization_person_titles organization_person_titles_relationship_fk f FOREIGN KEY (relationship_id, organization_id, person_id) REFERENCES organization_person_relationships(id, organization_id, person_id) ON DELETE RESTRICT deferrable=false deferred=false
organization_person_titles organization_person_titles_superseded_by_fk f FOREIGN KEY (superseded_by_id, relationship_id) REFERENCES organization_person_titles(id, relationship_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
contact_purpose_assignments contact_purpose_assignments_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.contact_purpose_types'::regclass,'public.persons'::regclass,'public.person_name_versions'::regclass,'public.person_channels'::regclass,'public.organization_channels'::regclass,'public.organization_person_relationships'::regclass,'public.organization_person_titles'::regclass,'public.contact_purpose_assignments'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.contact_purpose_types'::regclass,'public.persons'::regclass,'public.person_name_versions'::regclass,'public.person_channels'::regclass,'public.organization_channels'::regclass,'public.organization_person_relationships'::regclass,'public.organization_person_titles'::regclass,'public.contact_purpose_assignments'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$organization_channels organization_channels_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
organization_channels organization_channels_superseded_by_fk f FOREIGN KEY (superseded_by_id, organization_id) REFERENCES organization_channels(id, organization_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
contact_purpose_assignments contact_purpose_assignments_pkey p PRIMARY KEY (id) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_id_relationship_uq u UNIQUE (id, relationship_id) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_purpose_code_fkey f FOREIGN KEY (purpose_code) REFERENCES contact_purpose_types(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_relationship_fk f FOREIGN KEY (relationship_id, organization_id, person_id) REFERENCES organization_person_relationships(id, organization_id, person_id) ON DELETE RESTRICT deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_superseded_by_fk f FOREIGN KEY (superseded_by_id, relationship_id) REFERENCES contact_purpose_assignments(id, relationship_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
contact_purpose_types contact_purpose_types_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
contact_purpose_types contact_purpose_types_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
contact_purpose_types contact_purpose_types_primary_mode_valid c CHECK ((primary_mode = ANY (ARRAY['NONE'::text, 'OPTIONAL'::text, 'SINGLE'::text]))) deferrable=false deferred=false
contact_purpose_types contact_purpose_types_pkey p PRIMARY KEY (code) deferrable=false deferred=false
contact_purpose_types contact_purpose_types_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
persons persons_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
persons persons_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
persons persons_pkey p PRIMARY KEY (id) deferrable=false deferred=false
person_name_versions person_name_versions_given_name_not_blank c CHECK (((given_name IS NULL) OR (btrim(given_name) <> ''::text))) deferrable=false deferred=false
person_name_versions person_name_versions_family_name_not_blank c CHECK (((family_name IS NULL) OR (btrim(family_name) <> ''::text))) deferrable=false deferred=false
person_name_versions person_name_versions_has_a_name c CHECK (((given_name IS NOT NULL) OR (family_name IS NOT NULL))) deferrable=false deferred=false
person_name_versions person_name_versions_name_normalized_not_blank c CHECK ((btrim(name_normalized) <> ''::text)) deferrable=false deferred=false
person_name_versions person_name_versions_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
person_name_versions person_name_versions_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
person_name_versions person_name_versions_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
person_name_versions person_name_versions_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)))) deferrable=false deferred=false
person_name_versions person_name_versions_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
person_name_versions person_name_versions_pkey p PRIMARY KEY (id) deferrable=false deferred=false
person_name_versions person_name_versions_id_person_uq u UNIQUE (id, person_id) deferrable=false deferred=false
person_name_versions person_name_versions_person_id_fkey f FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT deferrable=false deferred=false
person_name_versions person_name_versions_superseded_by_fk f FOREIGN KEY (superseded_by_id, person_id) REFERENCES person_name_versions(id, person_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
person_channels person_channels_channel_type_valid c CHECK ((channel_type ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
person_channels person_channels_value_display_not_blank c CHECK ((btrim(value_display) <> ''::text)) deferrable=false deferred=false
person_channels person_channels_value_normalized_not_blank c CHECK ((btrim(value_normalized) <> ''::text)) deferrable=false deferred=false
person_channels person_channels_rule_version_not_blank c CHECK ((btrim(normalization_rule_version) <> ''::text)) deferrable=false deferred=false
person_channels person_channels_extension_not_blank c CHECK (((extension IS NULL) OR (btrim(extension) <> ''::text))) deferrable=false deferred=false
person_channels person_channels_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
person_channels person_channels_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
person_channels person_channels_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
person_channels person_channels_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
person_channels person_channels_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
person_channels person_channels_pkey p PRIMARY KEY (id) deferrable=false deferred=false
person_channels person_channels_id_person_uq u UNIQUE (id, person_id) deferrable=false deferred=false
person_channels person_channels_person_id_fkey f FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT deferrable=false deferred=false
person_channels person_channels_superseded_by_fk f FOREIGN KEY (superseded_by_id, person_id) REFERENCES person_channels(id, person_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
organization_channels organization_channels_channel_type_valid c CHECK ((channel_type ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
organization_channels organization_channels_channel_usage_valid c CHECK ((channel_usage ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
organization_channels organization_channels_value_display_not_blank c CHECK ((btrim(value_display) <> ''::text)) deferrable=false deferred=false
organization_channels organization_channels_value_normalized_not_blank c CHECK ((btrim(value_normalized) <> ''::text)) deferrable=false deferred=false
organization_channels organization_channels_rule_version_not_blank c CHECK ((btrim(normalization_rule_version) <> ''::text)) deferrable=false deferred=false
organization_channels organization_channels_extension_not_blank c CHECK (((extension IS NULL) OR (btrim(extension) <> ''::text))) deferrable=false deferred=false
organization_channels organization_channels_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
organization_channels organization_channels_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
organization_channels organization_channels_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
organization_channels organization_channels_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
organization_channels organization_channels_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
organization_channels organization_channels_pkey p PRIMARY KEY (id) deferrable=false deferred=false
organization_channels organization_channels_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'voided'::text]))) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_void_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL)))) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_pkey p PRIMARY KEY (id) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_id_org_person_uq u UNIQUE (id, organization_id, person_id) deferrable=false deferred=false
organization_person_relationships organization_person_relationships_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
organization_person_relationships organization_person_relationships_person_id_fkey f FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT deferrable=false deferred=false
organization_person_titles organization_person_titles_title_display_not_blank c CHECK ((btrim(title_display) <> ''::text)) deferrable=false deferred=false
organization_person_titles organization_person_titles_title_normalized_not_blank c CHECK ((btrim(title_normalized) <> ''::text)) deferrable=false deferred=false
organization_person_titles organization_person_titles_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
organization_person_titles organization_person_titles_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
organization_person_titles organization_person_titles_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
organization_person_titles organization_person_titles_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
organization_person_titles organization_person_titles_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
organization_person_titles organization_person_titles_pkey p PRIMARY KEY (id) deferrable=false deferred=false
organization_person_titles organization_person_titles_id_relationship_uq u UNIQUE (id, relationship_id) deferrable=false deferred=false
organization_person_titles organization_person_titles_relationship_fk f FOREIGN KEY (relationship_id, organization_id, person_id) REFERENCES organization_person_relationships(id, organization_id, person_id) ON DELETE RESTRICT deferrable=false deferred=false
organization_person_titles organization_person_titles_superseded_by_fk f FOREIGN KEY (superseded_by_id, relationship_id) REFERENCES organization_person_titles(id, relationship_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
contact_purpose_assignments contact_purpose_assignments_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0014 constraints (definition, deferrability) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0014 constraints (definition, deferrability) (78 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$contact_purpose_types contact_purpose_types_pkey CREATE UNIQUE INDEX contact_purpose_types_pkey ON public.contact_purpose_types USING btree (code)
contact_purpose_types contact_purpose_types_sort_order_uq CREATE UNIQUE INDEX contact_purpose_types_sort_order_uq ON public.contact_purpose_types USING btree (sort_order)
persons persons_pkey CREATE UNIQUE INDEX persons_pkey ON public.persons USING btree (id)
person_name_versions person_name_versions_pkey CREATE UNIQUE INDEX person_name_versions_pkey ON public.person_name_versions USING btree (id)
person_name_versions person_name_versions_id_person_uq CREATE UNIQUE INDEX person_name_versions_id_person_uq ON public.person_name_versions USING btree (id, person_id)
person_name_versions person_name_versions_current_uq CREATE UNIQUE INDEX person_name_versions_current_uq ON public.person_name_versions USING btree (person_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
person_name_versions person_name_versions_history_idx CREATE INDEX person_name_versions_history_idx ON public.person_name_versions USING btree (person_id, effective_from)
person_name_versions person_name_versions_match_idx CREATE INDEX person_name_versions_match_idx ON public.person_name_versions USING btree (name_normalized) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
person_channels person_channels_pkey CREATE UNIQUE INDEX person_channels_pkey ON public.person_channels USING btree (id)
person_channels person_channels_id_person_uq CREATE UNIQUE INDEX person_channels_id_person_uq ON public.person_channels USING btree (id, person_id)
person_channels person_channels_current_value_uq CREATE UNIQUE INDEX person_channels_current_value_uq ON public.person_channels USING btree (person_id, channel_type, value_normalized, COALESCE(extension, ''::text)) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
person_channels person_channels_current_preferred_uq CREATE UNIQUE INDEX person_channels_current_preferred_uq ON public.person_channels USING btree (person_id, channel_type) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL) AND is_preferred)
person_channels person_channels_history_idx CREATE INDEX person_channels_history_idx ON public.person_channels USING btree (person_id, effective_from)
person_channels person_channels_match_idx CREATE INDEX person_channels_match_idx ON public.person_channels USING btree (channel_type, value_normalized) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
organization_channels organization_channels_pkey CREATE UNIQUE INDEX organization_channels_pkey ON public.organization_channels USING btree (id)
organization_channels organization_channels_id_organization_uq CREATE UNIQUE INDEX organization_channels_id_organization_uq ON public.organization_channels USING btree (id, organization_id)
organization_channels organization_channels_current_value_uq CREATE UNIQUE INDEX organization_channels_current_value_uq ON public.organization_channels USING btree (organization_id, channel_type, channel_usage, value_normalized, COALESCE(extension, ''::text)) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
organization_channels organization_channels_current_preferred_uq CREATE UNIQUE INDEX organization_channels_current_preferred_uq ON public.organization_channels USING btree (organization_id, channel_type, channel_usage) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL) AND is_preferred)
organization_channels organization_channels_history_idx CREATE INDEX organization_channels_history_idx ON public.organization_channels USING btree (organization_id, effective_from)
organization_channels organization_channels_match_idx CREATE INDEX organization_channels_match_idx ON public.organization_channels USING btree (channel_type, value_normalized) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
organization_person_relationships organization_person_relationships_pkey CREATE UNIQUE INDEX organization_person_relationships_pkey ON public.organization_person_relationships USING btree (id)
organization_person_relationships organization_person_relationships_id_org_person_uq CREATE UNIQUE INDEX organization_person_relationships_id_org_person_uq ON public.organization_person_relationships USING btree (id, organization_id, person_id)
organization_person_relationships organization_person_relationships_current_uq CREATE UNIQUE INDEX organization_person_relationships_current_uq ON public.organization_person_relationships USING btree (organization_id, person_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
organization_person_relationships organization_person_relationships_org_history_idx CREATE INDEX organization_person_relationships_org_history_idx ON public.organization_person_relationships USING btree (organization_id, effective_from)
organization_person_relationships organization_person_relationships_person_idx CREATE INDEX organization_person_relationships_person_idx ON public.organization_person_relationships USING btree (person_id)
organization_person_titles organization_person_titles_id_relationship_uq CREATE UNIQUE INDEX organization_person_titles_id_relationship_uq ON public.organization_person_titles USING btree (id, relationship_id)
organization_person_titles organization_person_titles_pkey CREATE UNIQUE INDEX organization_person_titles_pkey ON public.organization_person_titles USING btree (id)
organization_person_titles organization_person_titles_current_uq CREATE UNIQUE INDEX organization_person_titles_current_uq ON public.organization_person_titles USING btree (relationship_id, title_normalized) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
organization_person_titles organization_person_titles_history_idx CREATE INDEX organization_person_titles_history_idx ON public.organization_person_titles USING btree (relationship_id, effective_from)
contact_purpose_assignments contact_purpose_assignments_pkey CREATE UNIQUE INDEX contact_purpose_assignments_pkey ON public.contact_purpose_assignments USING btree (id)
contact_purpose_assignments contact_purpose_assignments_id_relationship_uq CREATE UNIQUE INDEX contact_purpose_assignments_id_relationship_uq ON public.contact_purpose_assignments USING btree (id, relationship_id)
contact_purpose_assignments contact_purpose_assignments_current_uq CREATE UNIQUE INDEX contact_purpose_assignments_current_uq ON public.contact_purpose_assignments USING btree (relationship_id, purpose_code) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
contact_purpose_assignments contact_purpose_assignments_current_primary_uq CREATE UNIQUE INDEX contact_purpose_assignments_current_primary_uq ON public.contact_purpose_assignments USING btree (organization_id, purpose_code) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL) AND is_primary)
contact_purpose_assignments contact_purpose_assignments_history_idx CREATE INDEX contact_purpose_assignments_history_idx ON public.contact_purpose_assignments USING btree (relationship_id, effective_from)
contact_purpose_assignments contact_purpose_assignments_org_purpose_idx CREATE INDEX contact_purpose_assignments_org_purpose_idx ON public.contact_purpose_assignments USING btree (organization_id, purpose_code)$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('contact_purpose_types','persons','person_name_versions','person_channels','organization_channels','organization_person_relationships','organization_person_titles','contact_purpose_assignments')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('contact_purpose_types','persons','person_name_versions','person_channels','organization_channels','organization_person_relationships','organization_person_titles','contact_purpose_assignments')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$contact_purpose_types contact_purpose_types_pkey CREATE UNIQUE INDEX contact_purpose_types_pkey ON public.contact_purpose_types USING btree (code)
contact_purpose_types contact_purpose_types_sort_order_uq CREATE UNIQUE INDEX contact_purpose_types_sort_order_uq ON public.contact_purpose_types USING btree (sort_order)
persons persons_pkey CREATE UNIQUE INDEX persons_pkey ON public.persons USING btree (id)
person_name_versions person_name_versions_pkey CREATE UNIQUE INDEX person_name_versions_pkey ON public.person_name_versions USING btree (id)
person_name_versions person_name_versions_id_person_uq CREATE UNIQUE INDEX person_name_versions_id_person_uq ON public.person_name_versions USING btree (id, person_id)
person_name_versions person_name_versions_current_uq CREATE UNIQUE INDEX person_name_versions_current_uq ON public.person_name_versions USING btree (person_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
person_name_versions person_name_versions_history_idx CREATE INDEX person_name_versions_history_idx ON public.person_name_versions USING btree (person_id, effective_from)
person_name_versions person_name_versions_match_idx CREATE INDEX person_name_versions_match_idx ON public.person_name_versions USING btree (name_normalized) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
person_channels person_channels_pkey CREATE UNIQUE INDEX person_channels_pkey ON public.person_channels USING btree (id)
person_channels person_channels_id_person_uq CREATE UNIQUE INDEX person_channels_id_person_uq ON public.person_channels USING btree (id, person_id)
person_channels person_channels_current_value_uq CREATE UNIQUE INDEX person_channels_current_value_uq ON public.person_channels USING btree (person_id, channel_type, value_normalized, COALESCE(extension, ''::text)) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
person_channels person_channels_current_preferred_uq CREATE UNIQUE INDEX person_channels_current_preferred_uq ON public.person_channels USING btree (person_id, channel_type) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL) AND is_preferred)
person_channels person_channels_history_idx CREATE INDEX person_channels_history_idx ON public.person_channels USING btree (person_id, effective_from)
person_channels person_channels_match_idx CREATE INDEX person_channels_match_idx ON public.person_channels USING btree (channel_type, value_normalized) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
organization_channels organization_channels_pkey CREATE UNIQUE INDEX organization_channels_pkey ON public.organization_channels USING btree (id)
organization_channels organization_channels_id_organization_uq CREATE UNIQUE INDEX organization_channels_id_organization_uq ON public.organization_channels USING btree (id, organization_id)
organization_channels organization_channels_current_value_uq CREATE UNIQUE INDEX organization_channels_current_value_uq ON public.organization_channels USING btree (organization_id, channel_type, channel_usage, value_normalized, COALESCE(extension, ''::text)) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
organization_channels organization_channels_current_preferred_uq CREATE UNIQUE INDEX organization_channels_current_preferred_uq ON public.organization_channels USING btree (organization_id, channel_type, channel_usage) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL) AND is_preferred)
organization_channels organization_channels_history_idx CREATE INDEX organization_channels_history_idx ON public.organization_channels USING btree (organization_id, effective_from)
organization_channels organization_channels_match_idx CREATE INDEX organization_channels_match_idx ON public.organization_channels USING btree (channel_type, value_normalized) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
organization_person_relationships organization_person_relationships_pkey CREATE UNIQUE INDEX organization_person_relationships_pkey ON public.organization_person_relationships USING btree (id)
organization_person_relationships organization_person_relationships_id_org_person_uq CREATE UNIQUE INDEX organization_person_relationships_id_org_person_uq ON public.organization_person_relationships USING btree (id, organization_id, person_id)
organization_person_relationships organization_person_relationships_current_uq CREATE UNIQUE INDEX organization_person_relationships_current_uq ON public.organization_person_relationships USING btree (organization_id, person_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
organization_person_relationships organization_person_relationships_org_history_idx CREATE INDEX organization_person_relationships_org_history_idx ON public.organization_person_relationships USING btree (organization_id, effective_from)
organization_person_relationships organization_person_relationships_person_idx CREATE INDEX organization_person_relationships_person_idx ON public.organization_person_relationships USING btree (person_id)
organization_person_titles organization_person_titles_id_relationship_uq CREATE UNIQUE INDEX organization_person_titles_id_relationship_uq ON public.organization_person_titles USING btree (id, relationship_id)
organization_person_titles organization_person_titles_pkey CREATE UNIQUE INDEX organization_person_titles_pkey ON public.organization_person_titles USING btree (id)
organization_person_titles organization_person_titles_current_uq CREATE UNIQUE INDEX organization_person_titles_current_uq ON public.organization_person_titles USING btree (relationship_id, title_normalized) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
organization_person_titles organization_person_titles_history_idx CREATE INDEX organization_person_titles_history_idx ON public.organization_person_titles USING btree (relationship_id, effective_from)
contact_purpose_assignments contact_purpose_assignments_pkey CREATE UNIQUE INDEX contact_purpose_assignments_pkey ON public.contact_purpose_assignments USING btree (id)
contact_purpose_assignments contact_purpose_assignments_id_relationship_uq CREATE UNIQUE INDEX contact_purpose_assignments_id_relationship_uq ON public.contact_purpose_assignments USING btree (id, relationship_id)
contact_purpose_assignments contact_purpose_assignments_current_uq CREATE UNIQUE INDEX contact_purpose_assignments_current_uq ON public.contact_purpose_assignments USING btree (relationship_id, purpose_code) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
contact_purpose_assignments contact_purpose_assignments_current_primary_uq CREATE UNIQUE INDEX contact_purpose_assignments_current_primary_uq ON public.contact_purpose_assignments USING btree (organization_id, purpose_code) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL) AND is_primary)
contact_purpose_assignments contact_purpose_assignments_history_idx CREATE INDEX contact_purpose_assignments_history_idx ON public.contact_purpose_assignments USING btree (relationship_id, effective_from)
contact_purpose_assignments contact_purpose_assignments_org_purpose_idx CREATE INDEX contact_purpose_assignments_org_purpose_idx ON public.contact_purpose_assignments USING btree (organization_id, purpose_code)$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0014 indexes (exact definitions) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0014 indexes (exact definitions) (35 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$persons persons_require_current_name enabled=O type=5 function=tes_security.require_current_person_name constraint=true deferrable=true deferred=true
person_name_versions person_name_versions_require_current_name enabled=O type=21 function=tes_security.require_current_person_name constraint=true deferrable=true deferred=true
persons persons_guard_update enabled=O type=19 function=tes_security.guard_person_update constraint=false deferrable=false deferred=false
person_name_versions person_name_versions_guard_insert enabled=O type=7 function=tes_security.guard_person_dependent_insert constraint=false deferrable=false deferred=false
person_name_versions person_name_versions_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
person_channels person_channels_guard_insert enabled=O type=7 function=tes_security.guard_person_dependent_insert constraint=false deferrable=false deferred=false
person_channels person_channels_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
organization_channels organization_channels_guard_insert enabled=O type=7 function=tes_security.guard_organization_channel_insert constraint=false deferrable=false deferred=false
organization_channels organization_channels_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
organization_person_relationships organization_person_relationships_guard_insert enabled=O type=7 function=tes_security.guard_relationship_insert constraint=false deferrable=false deferred=false
organization_person_relationships organization_person_relationships_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
organization_person_relationships organization_person_relationships_guard_dependents enabled=O type=19 function=tes_security.guard_relationship_update constraint=false deferrable=false deferred=false
organization_person_titles organization_person_titles_guard_insert enabled=O type=7 function=tes_security.guard_relationship_dependent_insert constraint=false deferrable=false deferred=false
organization_person_titles organization_person_titles_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_guard_insert enabled=O type=7 function=tes_security.guard_relationship_dependent_insert constraint=false deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_guard_purpose enabled=O type=7 function=tes_security.guard_purpose_assignment_insert constraint=false deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
persons persons_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
person_name_versions person_name_versions_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
person_channels person_channels_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_channels organization_channels_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_person_relationships organization_person_relationships_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_person_titles organization_person_titles_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
persons persons_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
person_name_versions person_name_versions_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
person_channels person_channels_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_channels organization_channels_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_person_relationships organization_person_relationships_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_person_titles organization_person_titles_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.contact_purpose_types'::regclass,'public.persons'::regclass,'public.person_name_versions'::regclass,'public.person_channels'::regclass,'public.organization_channels'::regclass,'public.organization_person_relationships'::regclass,'public.organization_person_titles'::regclass,'public.contact_purpose_assignments'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.contact_purpose_types'::regclass,'public.persons'::regclass,'public.person_name_versions'::regclass,'public.person_channels'::regclass,'public.organization_channels'::regclass,'public.organization_person_relationships'::regclass,'public.organization_person_titles'::regclass,'public.contact_purpose_assignments'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$persons persons_require_current_name enabled=O type=5 function=tes_security.require_current_person_name constraint=true deferrable=true deferred=true
person_name_versions person_name_versions_require_current_name enabled=O type=21 function=tes_security.require_current_person_name constraint=true deferrable=true deferred=true
persons persons_guard_update enabled=O type=19 function=tes_security.guard_person_update constraint=false deferrable=false deferred=false
person_name_versions person_name_versions_guard_insert enabled=O type=7 function=tes_security.guard_person_dependent_insert constraint=false deferrable=false deferred=false
person_name_versions person_name_versions_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
person_channels person_channels_guard_insert enabled=O type=7 function=tes_security.guard_person_dependent_insert constraint=false deferrable=false deferred=false
person_channels person_channels_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
organization_channels organization_channels_guard_insert enabled=O type=7 function=tes_security.guard_organization_channel_insert constraint=false deferrable=false deferred=false
organization_channels organization_channels_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
organization_person_relationships organization_person_relationships_guard_insert enabled=O type=7 function=tes_security.guard_relationship_insert constraint=false deferrable=false deferred=false
organization_person_relationships organization_person_relationships_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
organization_person_relationships organization_person_relationships_guard_dependents enabled=O type=19 function=tes_security.guard_relationship_update constraint=false deferrable=false deferred=false
organization_person_titles organization_person_titles_guard_insert enabled=O type=7 function=tes_security.guard_relationship_dependent_insert constraint=false deferrable=false deferred=false
organization_person_titles organization_person_titles_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_guard_insert enabled=O type=7 function=tes_security.guard_relationship_dependent_insert constraint=false deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_guard_purpose enabled=O type=7 function=tes_security.guard_purpose_assignment_insert constraint=false deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_guard_update enabled=O type=19 function=tes_security.guard_contact_period_update constraint=false deferrable=false deferred=false
persons persons_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
person_name_versions person_name_versions_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
person_channels person_channels_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_channels organization_channels_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_person_relationships organization_person_relationships_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_person_titles organization_person_titles_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_no_delete enabled=O type=11 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
persons persons_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
person_name_versions person_name_versions_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
person_channels person_channels_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_channels organization_channels_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_person_relationships organization_person_relationships_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
organization_person_titles organization_person_titles_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false
contact_purpose_assignments contact_purpose_assignments_no_truncate enabled=O type=34 function=tes_security.prevent_contact_data_removal constraint=false deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0014 triggers (enabled flag, type, function, deferral) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0014 triggers (enabled flag, type, function, deferral) (31 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$guard_person_dependent_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=20750a06e8f2835c79278d5a2927ea16 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_organization_channel_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=efeac2b47fbcf7eb804835094624f62d owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
prevent_contact_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=1a554d5e90244d3a596000e9464b3dd1 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_person_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=64fc1ec8de6b3cbd7d0b3fc30bc08b55 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_contact_period_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=f77818cbb607e19d0738a8a03d4e049c owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_relationship_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=0e40e640fa1d8d938afdc2b2108aabca owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_relationship_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=ed828ea2d087e82851c3d68ec4f0f643 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_relationship_dependent_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=8798774716e171b5ac501a906715bebc owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_purpose_assignment_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=f572a3fe756607fe58e014219e6a14bc owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_current_person_name secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=4f858f889697f0f0ea56d2bd8fae9d8f owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_contact_data_removal','guard_person_update','guard_contact_period_update','guard_person_dependent_insert','guard_organization_channel_insert','guard_relationship_insert','guard_relationship_update','guard_relationship_dependent_insert','guard_purpose_assignment_insert','require_current_person_name')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_contact_data_removal','guard_person_update','guard_contact_period_update','guard_person_dependent_insert','guard_organization_channel_insert','guard_relationship_insert','guard_relationship_update','guard_relationship_dependent_insert','guard_purpose_assignment_insert','require_current_person_name')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$guard_person_dependent_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=20750a06e8f2835c79278d5a2927ea16 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_organization_channel_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=efeac2b47fbcf7eb804835094624f62d owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
prevent_contact_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=1a554d5e90244d3a596000e9464b3dd1 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_person_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=64fc1ec8de6b3cbd7d0b3fc30bc08b55 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_contact_period_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=f77818cbb607e19d0738a8a03d4e049c owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_relationship_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=0e40e640fa1d8d938afdc2b2108aabca owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_relationship_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=ed828ea2d087e82851c3d68ec4f0f643 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_relationship_dependent_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=8798774716e171b5ac501a906715bebc owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_purpose_assignment_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=f572a3fe756607fe58e014219e6a14bc owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_current_person_name secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=4f858f889697f0f0ea56d2bd8fae9d8f owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0014 trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0014 trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute) (10 entries) match the design exactly';
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
guard_person_dependent_insert
guard_organization_channel_insert
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
require_authority_current_state
prevent_contact_data_removal
guard_person_update
guard_contact_period_update
guard_relationship_insert
guard_relationship_update
guard_relationship_dependent_insert
guard_purpose_assignment_insert
require_current_person_name$exp$, E'\n')) AS l
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
guard_person_dependent_insert
guard_organization_channel_insert
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
require_authority_current_state
prevent_contact_data_removal
guard_person_update
guard_contact_period_update
guard_relationship_insert
guard_relationship_update
guard_relationship_dependent_insert
guard_purpose_assignment_insert
require_current_person_name$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'tes_security function set differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK tes_security function set (28 entries) match the design exactly';
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
    SELECT unnest(string_to_array($exp$contact_purpose_types owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
persons owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
person_name_versions owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
person_channels owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
organization_channels owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
organization_person_relationships owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
organization_person_titles owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
contact_purpose_assignments owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.contact_purpose_types'::regclass,'public.persons'::regclass,'public.person_name_versions'::regclass,'public.person_channels'::regclass,'public.organization_channels'::regclass,'public.organization_person_relationships'::regclass,'public.organization_person_titles'::regclass,'public.contact_purpose_assignments'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.contact_purpose_types'::regclass,'public.persons'::regclass,'public.person_name_versions'::regclass,'public.person_channels'::regclass,'public.organization_channels'::regclass,'public.organization_person_relationships'::regclass,'public.organization_person_titles'::regclass,'public.contact_purpose_assignments'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$contact_purpose_types owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
persons owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
person_name_versions owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
person_channels owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
organization_channels owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
organization_person_relationships owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
organization_person_titles owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
contact_purpose_assignments owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0014 table ownership and RLS flags differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0014 table ownership and RLS flags (8 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$contact_purpose_types tes-backend@tes-production-510007.iam SELECT grantable=false
persons tes-backend@tes-production-510007.iam SELECT grantable=false
person_name_versions tes-backend@tes-production-510007.iam SELECT grantable=false
person_channels tes-backend@tes-production-510007.iam SELECT grantable=false
organization_channels tes-backend@tes-production-510007.iam SELECT grantable=false
organization_person_relationships tes-backend@tes-production-510007.iam SELECT grantable=false
organization_person_titles tes-backend@tes-production-510007.iam SELECT grantable=false
contact_purpose_assignments tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.contact_purpose_types'::regclass,'public.persons'::regclass,'public.person_name_versions'::regclass,'public.person_channels'::regclass,'public.organization_channels'::regclass,'public.organization_person_relationships'::regclass,'public.organization_person_titles'::regclass,'public.contact_purpose_assignments'::regclass) AND x.grantee <> c.relowner) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.contact_purpose_types'::regclass,'public.persons'::regclass,'public.person_name_versions'::regclass,'public.person_channels'::regclass,'public.organization_channels'::regclass,'public.organization_person_relationships'::regclass,'public.organization_person_titles'::regclass,'public.contact_purpose_assignments'::regclass) AND x.grantee <> c.relowner) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$contact_purpose_types tes-backend@tes-production-510007.iam SELECT grantable=false
persons tes-backend@tes-production-510007.iam SELECT grantable=false
person_name_versions tes-backend@tes-production-510007.iam SELECT grantable=false
person_channels tes-backend@tes-production-510007.iam SELECT grantable=false
organization_channels tes-backend@tes-production-510007.iam SELECT grantable=false
organization_person_relationships tes-backend@tes-production-510007.iam SELECT grantable=false
organization_person_titles tes-backend@tes-production-510007.iam SELECT grantable=false
contact_purpose_assignments tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0014 table ACL (every non-owner grantee) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0014 table ACL (every non-owner grantee) (8 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$persons.id tes-backend@tes-production-510007.iam INSERT grantable=false
persons.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
persons.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
persons.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
person_name_versions.id tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.person_id tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.given_name tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.family_name tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.name_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
person_name_versions.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
person_name_versions.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
person_name_versions.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
person_name_versions.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
person_channels.id tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.person_id tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.channel_type tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.value_display tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.value_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.normalization_rule_version tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.extension tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.is_preferred tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
person_channels.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
person_channels.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
person_channels.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
person_channels.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_channels.id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.channel_type tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.channel_usage tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.value_display tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.value_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.normalization_rule_version tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.extension tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.is_preferred tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_channels.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_channels.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_channels.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_channels.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_relationships.id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_relationships.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_relationships.person_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_relationships.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_relationships.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_relationships.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_relationships.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_relationships.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_titles.id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.relationship_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.person_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.title_display tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.title_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_titles.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_titles.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_titles.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_titles.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
contact_purpose_assignments.id tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.relationship_id tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.person_id tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.purpose_code tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.is_primary tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
contact_purpose_assignments.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
contact_purpose_assignments.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
contact_purpose_assignments.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
contact_purpose_assignments.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.contact_purpose_types'::regclass,'public.persons'::regclass,'public.person_name_versions'::regclass,'public.person_channels'::regclass,'public.organization_channels'::regclass,'public.organization_person_relationships'::regclass,'public.organization_person_titles'::regclass,'public.contact_purpose_assignments'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.contact_purpose_types'::regclass,'public.persons'::regclass,'public.person_name_versions'::regclass,'public.person_channels'::regclass,'public.organization_channels'::regclass,'public.organization_person_relationships'::regclass,'public.organization_person_titles'::regclass,'public.contact_purpose_assignments'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$persons.id tes-backend@tes-production-510007.iam INSERT grantable=false
persons.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
persons.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
persons.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
person_name_versions.id tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.person_id tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.given_name tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.family_name tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.name_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
person_name_versions.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
person_name_versions.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
person_name_versions.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
person_name_versions.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
person_name_versions.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
person_channels.id tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.person_id tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.channel_type tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.value_display tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.value_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.normalization_rule_version tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.extension tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.is_preferred tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
person_channels.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
person_channels.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
person_channels.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
person_channels.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
person_channels.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_channels.id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.channel_type tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.channel_usage tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.value_display tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.value_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.normalization_rule_version tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.extension tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.is_preferred tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
organization_channels.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_channels.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_channels.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_channels.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_channels.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_relationships.id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_relationships.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_relationships.person_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_relationships.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_relationships.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_relationships.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_relationships.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_relationships.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_titles.id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.relationship_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.person_id tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.title_display tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.title_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
organization_person_titles.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_titles.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_titles.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_titles.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
organization_person_titles.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
contact_purpose_assignments.id tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.relationship_id tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.person_id tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.purpose_code tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.is_primary tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
contact_purpose_assignments.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
contact_purpose_assignments.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
contact_purpose_assignments.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
contact_purpose_assignments.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
contact_purpose_assignments.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0014 column ACL (every column-specific grant) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0014 column ACL (every column-specific grant) (81 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$PRIMARY|Primary contact|The Organization's primary point of contact. At most one current holder per Organization.|SINGLE|true|10
BILLING|Billing|Billing, invoicing and accounts-payable contact.|OPTIONAL|true|20
SAFETY|Safety|Safety contact.|OPTIONAL|true|30
OPERATIONS|Operations|Dispatch and day-to-day operations contact.|OPTIONAL|true|40
COMPLIANCE|Compliance|Regulatory compliance contact.|OPTIONAL|true|50
EMERGENCY|Emergency|Emergency contact.|OPTIONAL|true|60$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT code || '|' || display_name || '|' || COALESCE(description, '-') || '|' || primary_mode || '|' || is_active || '|' || sort_order FROM public.contact_purpose_types) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT code || '|' || display_name || '|' || COALESCE(description, '-') || '|' || primary_mode || '|' || is_active || '|' || sort_order FROM public.contact_purpose_types) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$PRIMARY|Primary contact|The Organization's primary point of contact. At most one current holder per Organization.|SINGLE|true|10
BILLING|Billing|Billing, invoicing and accounts-payable contact.|OPTIONAL|true|20
SAFETY|Safety|Safety contact.|OPTIONAL|true|30
OPERATIONS|Operations|Dispatch and day-to-day operations contact.|OPTIONAL|true|40
COMPLIANCE|Compliance|Regulatory compliance contact.|OPTIONAL|true|50
EMERGENCY|Emergency|Emergency contact.|OPTIONAL|true|60$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'contact_purpose_types seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK contact_purpose_types seed rows (6 entries) match the design exactly';
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

  FOREACH tbl IN ARRAY ARRAY['contact_purpose_types','persons','person_name_versions','person_channels','organization_channels','organization_person_relationships','organization_person_titles','contact_purpose_assignments'] LOOP
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

  -- the runtime catalogue (contact_purpose_types) can never be written by the runtime identity
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = 'public.contact_purpose_types'::regclass AND a.attnum > 0 AND NOT a.attisdropped
               AND (has_column_privilege(runtime_role, a.attrelid, a.attnum, 'INSERT')
                    OR has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'runtime can write contact_purpose_types (changed only by migrations)';
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
             WHERE oid IN ('public.contact_purpose_types'::regclass, 'public.persons'::regclass, 'public.person_name_versions'::regclass,
                           'public.person_channels'::regclass, 'public.organization_channels'::regclass,
                           'public.organization_person_relationships'::regclass, 'public.organization_person_titles'::regclass,
                           'public.contact_purpose_assignments'::regclass)
               AND (relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policy
                WHERE polrelid IN ('public.contact_purpose_types'::regclass, 'public.persons'::regclass, 'public.person_name_versions'::regclass,
                                   'public.person_channels'::regclass, 'public.organization_channels'::regclass,
                                   'public.organization_person_relationships'::regclass, 'public.organization_person_titles'::regclass,
                                   'public.contact_purpose_assignments'::regclass)) THEN
    RAISE EXCEPTION 'RLS or a policy exists on a 0014 table (not part of the approved design)';
  END IF;
  RAISE NOTICE 'OK no RLS / policy on the global canonical 0014 tables (visibility is enforced by the server)';
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
    IF (SELECT count(*) FROM public.persons) <> 0
       OR (SELECT count(*) FROM public.person_name_versions) <> 0
       OR (SELECT count(*) FROM public.person_channels) <> 0
       OR (SELECT count(*) FROM public.organization_channels) <> 0
       OR (SELECT count(*) FROM public.organization_person_relationships) <> 0
       OR (SELECT count(*) FROM public.organization_person_titles) <> 0
       OR (SELECT count(*) FROM public.contact_purpose_assignments) <> 0 THEN
      RAISE EXCEPTION 'a 0014 business table is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id
               WHERE c.code IN ('PERSON_REGISTRY_READ', 'CONTACT_MANAGE')) THEN
      RAISE EXCEPTION 'a 0014 capability is granted to someone (0014 grants nothing; set TES_VERIFY_EXPECT_EMPTY=0 once grants are made deliberately)';
    END IF;
  END IF;

  SELECT count(*) INTO bad FROM public.persons p
  WHERE NOT EXISTS (SELECT 1 FROM public.person_name_versions v WHERE v.person_id = p.id AND v.record_status = 'active' AND v.effective_to IS NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% person(s) have no current name', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT person_id FROM public.person_name_versions WHERE record_status = 'active' AND effective_to IS NULL GROUP BY person_id HAVING count(*) > 1
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% person(s) have more than one current name', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT organization_id, person_id FROM public.organization_person_relationships WHERE record_status = 'active' AND effective_to IS NULL GROUP BY organization_id, person_id HAVING count(*) > 1
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Organization/person pair(s) have more than one open relationship', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT organization_id, purpose_code FROM public.contact_purpose_assignments WHERE record_status = 'active' AND effective_to IS NULL AND is_primary GROUP BY organization_id, purpose_code HAVING count(*) > 1
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Organization purpose(s) have more than one current primary contact', bad; END IF;

  SELECT count(*) INTO bad FROM public.contact_purpose_assignments a
  JOIN public.contact_purpose_types k ON k.code = a.purpose_code
  WHERE (k.primary_mode = 'NONE' AND a.is_primary) OR (k.primary_mode = 'SINGLE' AND NOT a.is_primary);
  IF bad <> 0 THEN RAISE EXCEPTION '% purpose assignment(s) violate their purpose primary_mode', bad; END IF;

  SELECT count(*) INTO bad FROM public.persons p
  WHERE p.record_status = 'archived'
    AND EXISTS (SELECT 1 FROM public.organization_person_relationships r WHERE r.person_id = p.id AND r.record_status = 'active' AND r.effective_to IS NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% archived person(s) still have a current relationship', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT t.id FROM public.organization_person_titles t JOIN public.organization_person_relationships r ON r.id = t.relationship_id
     WHERE t.record_status = 'active' AND (r.record_status <> 'active' OR t.effective_from < r.effective_from OR (r.effective_to IS NOT NULL AND (t.effective_to IS NULL OR t.effective_to > r.effective_to)))
    UNION ALL
    SELECT a.id FROM public.contact_purpose_assignments a JOIN public.organization_person_relationships r ON r.id = a.relationship_id
     WHERE a.record_status = 'active' AND (r.record_status <> 'active' OR a.effective_from < r.effective_from OR (r.effective_to IS NOT NULL AND (a.effective_to IS NULL OR a.effective_to > r.effective_to)))
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% title / purpose row(s) fall outside their relationship', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT id FROM public.person_name_versions WHERE record_status = 'corrected' AND (superseded_by_id IS NULL OR effective_to IS NOT NULL)
    UNION ALL SELECT id FROM public.person_channels WHERE (record_status = 'corrected' AND (superseded_by_id IS NULL OR effective_to IS NOT NULL)) OR (record_status = 'voided' AND (superseded_by_id IS NOT NULL OR effective_to IS NOT NULL))
    UNION ALL SELECT id FROM public.organization_channels WHERE (record_status = 'corrected' AND (superseded_by_id IS NULL OR effective_to IS NOT NULL)) OR (record_status = 'voided' AND (superseded_by_id IS NOT NULL OR effective_to IS NOT NULL))
    UNION ALL SELECT id FROM public.organization_person_titles WHERE (record_status = 'corrected' AND (superseded_by_id IS NULL OR effective_to IS NOT NULL)) OR (record_status = 'voided' AND (superseded_by_id IS NOT NULL OR effective_to IS NOT NULL))
    UNION ALL SELECT id FROM public.contact_purpose_assignments WHERE (record_status = 'corrected' AND (superseded_by_id IS NULL OR effective_to IS NOT NULL)) OR (record_status = 'voided' AND (superseded_by_id IS NOT NULL OR effective_to IS NOT NULL))
    UNION ALL SELECT id FROM public.organization_person_relationships WHERE record_status = 'voided' AND effective_to IS NOT NULL
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% corrected / voided row(s) were ended or lack/carry an unexpected replacement', bad; END IF;

  RAISE NOTICE 'OK row conditions hold (rows: persons=%, relationships=%, person channels=%, organization channels=%, titles=%, purposes=%)',
    (SELECT count(*) FROM public.persons),
    (SELECT count(*) FROM public.organization_person_relationships),
    (SELECT count(*) FROM public.person_channels),
    (SELECT count(*) FROM public.organization_channels),
    (SELECT count(*) FROM public.organization_person_titles),
    (SELECT count(*) FROM public.contact_purpose_assignments);
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
    IF tbl IN ('contact_purpose_types','persons','person_name_versions','person_channels','organization_channels','organization_person_relationships','organization_person_titles','contact_purpose_assignments') THEN
      RAISE EXCEPTION 'baseline list names a 0014 table: %', tbl;
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

echo "Production contacts (${PHASE}) verification passed."
