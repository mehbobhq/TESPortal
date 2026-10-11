#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0015 (Customer Relationship foundation).
#
# The whole check runs in a READ ONLY transaction: it performs no INSERT, UPDATE,
# DELETE, DDL or temp-table creation, creates no authorities, versions or status
# periods, and ends with ROLLBACK. Runtime privileges are verified through catalog
# functions and ACLs, not by switching roles.
#
# TES_VERIFY_PHASE=pre   Before 0015 is applied: the ledger holds exactly the repository's 0001-0014 checksums (and no
#                        0015), none of the eleven tables, fourteen trigger functions or customer_engagements.engagement_type / end_reason_code
#                        exists, the capability catalogue is exactly the eight approved capabilities (full rows), and
#                        baseline row counts are logged.
# TES_VERIFY_PHASE=post  After 0015 is applied (default): the ledger holds 0001-0015 with the repository checksums (so
#                        0001-0014 are unchanged); the eleven tables exist with exactly the designed columns (name, data
#                        type, nullability, default), constraints, indexes, triggers and trigger functions (SECURITY
#                        INVOKER, fixed search_path, body checksum, no PUBLIC execute); customer_engagements and customers
#                        carry exactly the designed columns, constraints, indexes, triggers and privileges; the catalogues
#                        hold exactly their seed rows (no services); the capability catalogue is exactly the eight
#                        originals (unchanged) plus CUSTOMER_RELATIONSHIP_READ and CUSTOMER_RELATIONSHIP_MANAGE (full
#                        rows); runtime privileges are exactly the designed table and column grants (no DELETE, no
#                        TRUNCATE, no PUBLIC privilege); there is no RLS or policy; no SECURITY DEFINER function was
#                        added; nothing was granted to anyone; and the data satisfies the invariants the schema is meant
#                        to guarantee (one current stage, gap-free history, termination agreement, dependents inside
#                        their Engagement, ...).
#
# TES_VERIFY_EXPECT_EMPTY=1 (default) additionally requires the seven business tables to hold ZERO rows, the expected
# state immediately after the migration. Set it to 0 for a later verification of a live system; the invariant checks
# still run.
#
# TES_VERIFY_BASELINE_COUNTS (optional, post phase) is a comma-separated list of table=count pairs captured from the PRE
# run's ROWCOUNT lines. When set, every listed table must still hold exactly that many rows, proving baseline data is
# unchanged.
#
# The expected catalogue below was generated from a database migrated with the repository 0015 file, using the same
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
MIGRATION_0015="$MIGRATIONS_DIR/0015_customer_relationship_foundation.sql"

if [[ ! -f "$MIGRATION_0015" ]]; then
  echo "Repository migration 0015 not found: $MIGRATION_0015" >&2
  exit 1
fi

# The migration must stay additive: no destructive or data-changing statement except the catalogue seeds
# (engagement_types, engagement_stage_types, product_levels, engagement_end_reasons and the two capabilities), no DELETE / TRUNCATE / ALL grant,
# no table altered except customer_engagements (ADD COLUMN / ADD CONSTRAINT only), and no SECURITY DEFINER, RLS,
# tenant-context, capability-grant, pricing, document, vehicle, driver, insurance or tax structure.
sql_only="$(grep -Ev '^[[:space:]]*--' "$MIGRATION_0015")"
if grep -Eiq '^[[:space:]]*(DROP|TRUNCATE|DELETE|UPDATE)[[:space:]]' <<<"$sql_only"; then
  echo "Migration 0015 contains a destructive or data-changing statement." >&2
  exit 1
fi
if grep -Ei '^[[:space:]]*INSERT[[:space:]]' <<<"$sql_only" | grep -Eivq 'INSERT[[:space:]]+INTO[[:space:]]+public\.(engagement_types|engagement_stage_types|product_levels|engagement_end_reasons|capabilities)([[:space:]]|$)'; then
  echo "Migration 0015 inserts into a table other than the catalogues / capabilities." >&2
  exit 1
fi
if grep -Eiq 'GRANT[^;]*(DELETE|TRUNCATE|ALL)' <<<"$sql_only"; then
  echo "Migration 0015 grants DELETE, TRUNCATE or ALL." >&2
  exit 1
fi
if grep -Eiq 'SECURITY[[:space:]]+DEFINER|ROW[[:space:]]+LEVEL[[:space:]]+SECURITY|CREATE[[:space:]]+POLICY|relationship_capability_grants|relationship_assignments|actor_relationships|set_config|current_customer_id' <<<"$sql_only"; then
  echo "Migration 0015 contains a structure outside the approved design." >&2
  exit 1
fi
if grep -Ei '^[[:space:]]*ALTER[[:space:]]+TABLE[[:space:]]' <<<"$sql_only" | grep -Eivq 'ALTER[[:space:]]+TABLE[[:space:]]+public\.customer_engagements$'; then
  echo "Migration 0015 alters a table other than customer_engagements." >&2
  exit 1
fi
if grep -Ei '^[[:space:]]+(DROP|ALTER|RENAME)[[:space:]]' <<<"$sql_only" | grep -Eiq '.'; then
  echo "Migration 0015 drops, alters or renames an existing column or constraint." >&2
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
-- Ledger vs repository (both phases): 0001-0014 byte-for-byte unchanged
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
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0015'
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
    WHERE phase = 'post' OR split_part(e, ':', 1) <> '0015'
  ) d;
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'ledger contains migration(s) the repository does not expect for phase %: %', phase, unexpected;
  END IF;

  IF (SELECT count(*) FROM tes_system.schema_migrations WHERE version <= '0014') <> 14 THEN
    RAISE EXCEPTION 'the ledger does not hold exactly migrations 0001-0014 at or below 0014';
  END IF;
  IF phase = 'pre' AND EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version >= '0015') THEN
    RAISE EXCEPTION 'the ledger already records 0015 (or later) before 0015 is applied';
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums for phase % (% migrations; 0001-0014 unchanged)',
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
-- Pre phase: nothing from 0015 exists yet
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public'
               AND c.relname IN ('engagement_types','engagement_stage_types','product_levels','service_catalogue','engagement_end_reasons',
                                 'customer_engagement_stages','customer_engagement_terminations','engagement_service_scopes','engagement_responsibility_periods','customer_agreements','customer_agreement_versions')) THEN
    RAISE EXCEPTION 'a 0015 table already exists before 0015';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security'
               AND p.proname IN ('prevent_customer_relationship_removal','guard_engagement_insert','guard_engagement_update','guard_engagement_child_update',
                                 'guard_engagement_stage_insert','guard_engagement_scope_insert','guard_engagement_scope_update',
                                 'guard_engagement_responsibility_insert','guard_engagement_termination_insert','guard_engagement_termination_update','guard_customer_agreement_update','guard_customer_agreement_version_insert',
                                 'require_engagement_consistency','require_customer_agreement_version')) THEN
    RAISE EXCEPTION 'a 0015 trigger function already exists before 0015';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_engagements'::regclass AND attname IN ('engagement_type', 'end_reason_code') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'customer_engagements.engagement_type / end_reason_code already exists before 0015';
  END IF;
  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code IN ('CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE')) THEN
    RAISE EXCEPTION 'a 0015 capability already exists before 0015';
  END IF;
  RAISE NOTICE 'OK no 0015 table, function or column exists before 0015';
END
$verify$;

-- ============================================================
-- Post phase: ledger entry and the exact catalogue below
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations
                 WHERE version = '0015' AND filename = '0015_customer_relationship_foundation.sql') THEN
    RAISE EXCEPTION 'ledger has no 0015 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records 0015_customer_relationship_foundation.sql';
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
    RAISE EXCEPTION 'capability catalogue before 0015 (the eight approved capabilities, full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue before 0015 (the eight approved capabilities, full rows) (8 entries) match the design exactly';
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
contact_purpose_assignments
customer_engagements
engagement_types
engagement_stage_types
product_levels
service_catalogue
engagement_end_reasons
customer_engagement_stages
customer_engagement_terminations
engagement_service_scopes
engagement_responsibility_periods
customer_agreements
customer_agreement_versions$exp$, E'\n')) AS l
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
contact_purpose_assignments
customer_engagements
engagement_types
engagement_stage_types
product_levels
service_catalogue
engagement_end_reasons
customer_engagement_stages
customer_engagement_terminations
engagement_service_scopes
engagement_responsibility_periods
customer_agreements
customer_agreement_versions$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'public relations (0001-0014 plus the eleven 0015 tables) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK public relations (0001-0014 plus the eleven 0015 tables) (43 entries) match the design exactly';
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
CONTACT_MANAGE|Manage Contacts|Create and maintain people, their channels, Organization contact channels, Organization-person relationships, titles and contact purposes, including corrections and ending history. Does not authorize reading people across Organizations. Intended scope: SYSTEM only.|true|80
CUSTOMER_RELATIONSHIP_READ|Read Customer Relationship|SYSTEM-wide read access to Customer relationship state: Customers, Engagements, their stage history, service scope, TES responsibility windows and agreements. Intended scope: SYSTEM only.|true|90
CUSTOMER_RELATIONSHIP_MANAGE|Manage Customer Relationship|Manage an already-established Customer relationship: change and correct Engagement stages, end an Engagement, maintain service scope, TES responsibility windows and agreements. Does not establish a Customer (CUSTOMER_ESTABLISH). Intended scope: SYSTEM only.|true|100$exp$, E'\n')) AS l
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
CONTACT_MANAGE|Manage Contacts|Create and maintain people, their channels, Organization contact channels, Organization-person relationships, titles and contact purposes, including corrections and ending history. Does not authorize reading people across Organizations. Intended scope: SYSTEM only.|true|80
CUSTOMER_RELATIONSHIP_READ|Read Customer Relationship|SYSTEM-wide read access to Customer relationship state: Customers, Engagements, their stage history, service scope, TES responsibility windows and agreements. Intended scope: SYSTEM only.|true|90
CUSTOMER_RELATIONSHIP_MANAGE|Manage Customer Relationship|Manage an already-established Customer relationship: change and correct Engagement stages, end an Engagement, maintain service scope, TES responsibility windows and agreements. Does not establish a Customer (CUSTOMER_ESTABLISH). Intended scope: SYSTEM only.|true|100$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'capability catalogue after 0015 (eight unchanged + CUSTOMER_RELATIONSHIP_READ + CUSTOMER_RELATIONSHIP_MANAGE, full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue after 0015 (eight unchanged + CUSTOMER_RELATIONSHIP_READ + CUSTOMER_RELATIONSHIP_MANAGE, full rows) (10 entries) match the design exactly';
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
description text NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.engagement_types'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.engagement_types'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'engagement_types columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK engagement_types columns (name, data type, nullability, default) (5 entries) match the design exactly';
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
description text NOT NULL default=-
is_bounded boolean NOT NULL default=false
is_terminal boolean NOT NULL default=false
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.engagement_stage_types'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.engagement_stage_types'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NOT NULL default=-
is_bounded boolean NOT NULL default=false
is_terminal boolean NOT NULL default=false
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'engagement_stage_types columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK engagement_stage_types columns (name, data type, nullability, default) (7 entries) match the design exactly';
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
description text NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.product_levels'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.product_levels'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'product_levels columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK product_levels columns (name, data type, nullability, default) (5 entries) match the design exactly';
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
product_level_code text NOT NULL default=-
display_name text NOT NULL default=-
description text NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.service_catalogue'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.service_catalogue'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
product_level_code text NOT NULL default=-
display_name text NOT NULL default=-
description text NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'service_catalogue columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK service_catalogue columns (name, data type, nullability, default) (6 entries) match the design exactly';
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
description text NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.engagement_end_reasons'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.engagement_end_reasons'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'engagement_end_reasons columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK engagement_end_reasons columns (name, data type, nullability, default) (5 entries) match the design exactly';
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
engagement_id uuid NOT NULL default=-
stage_code text NOT NULL default=-
planned_end_at timestamp with time zone NULL default=-
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.customer_engagement_stages'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.customer_engagement_stages'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
engagement_id uuid NOT NULL default=-
stage_code text NOT NULL default=-
planned_end_at timestamp with time zone NULL default=-
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
    RAISE EXCEPTION 'customer_engagement_stages columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK customer_engagement_stages columns (name, data type, nullability, default) (12 entries) match the design exactly';
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
engagement_id uuid NOT NULL default=-
ended_at timestamp with time zone NOT NULL default=-
end_reason_code text NOT NULL default=-
change_reason text NOT NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.customer_engagement_terminations'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.customer_engagement_terminations'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
engagement_id uuid NOT NULL default=-
ended_at timestamp with time zone NOT NULL default=-
end_reason_code text NOT NULL default=-
change_reason text NOT NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'customer_engagement_terminations columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK customer_engagement_terminations columns (name, data type, nullability, default) (10 entries) match the design exactly';
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
engagement_id uuid NOT NULL default=-
product_level_code text NOT NULL default=-
service_code text NULL default=-
agreement_id uuid NULL default=-
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.engagement_service_scopes'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.engagement_service_scopes'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
engagement_id uuid NOT NULL default=-
product_level_code text NOT NULL default=-
service_code text NULL default=-
agreement_id uuid NULL default=-
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
    RAISE EXCEPTION 'engagement_service_scopes columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK engagement_service_scopes columns (name, data type, nullability, default) (13 entries) match the design exactly';
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
engagement_id uuid NOT NULL default=-
scope_id uuid NOT NULL default=-
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.engagement_responsibility_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.engagement_responsibility_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
engagement_id uuid NOT NULL default=-
scope_id uuid NOT NULL default=-
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
    RAISE EXCEPTION 'engagement_responsibility_periods columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK engagement_responsibility_periods columns (name, data type, nullability, default) (11 entries) match the design exactly';
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
customer_id uuid NOT NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.customer_agreements'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.customer_agreements'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
customer_id uuid NOT NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'customer_agreements columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK customer_agreements columns (name, data type, nullability, default) (6 entries) match the design exactly';
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
agreement_id uuid NOT NULL default=-
agreement_reference text NULL default=-
signed_on date NULL default=-
change_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.customer_agreement_versions'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.customer_agreement_versions'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
agreement_id uuid NOT NULL default=-
agreement_reference text NULL default=-
signed_on date NULL default=-
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
    RAISE EXCEPTION 'customer_agreement_versions columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK customer_agreement_versions columns (name, data type, nullability, default) (12 entries) match the design exactly';
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
customer_id uuid NOT NULL default=-
started_at timestamp with time zone NOT NULL default=-
ended_at timestamp with time zone NULL default=-
end_reason text NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()
engagement_type text NULL default=-
end_reason_code text NULL default=-$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.customer_engagements'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.customer_engagements'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
customer_id uuid NOT NULL default=-
started_at timestamp with time zone NOT NULL default=-
ended_at timestamp with time zone NULL default=-
end_reason text NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()
engagement_type text NULL default=-
end_reason_code text NULL default=-$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'customer_engagements columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK customer_engagements columns (name, data type, nullability, default) (9 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$customers customers_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customers customers_organization_id_key u UNIQUE (organization_id) deferrable=false deferred=false
customers customers_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagements customer_engagements_dates_valid c CHECK (((ended_at IS NULL) OR (ended_at >= started_at))) deferrable=false deferred=false
customer_engagements customer_engagements_end_reason_consistent c CHECK (((ended_at IS NOT NULL) OR (end_reason IS NULL))) deferrable=false deferred=false
customer_engagements customer_engagements_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customer_engagements customer_engagements_customer_id_fkey f FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_engagement_id_fkey f FOREIGN KEY (engagement_id) REFERENCES customer_engagements(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_end_reason_code_fkey f FOREIGN KEY (end_reason_code) REFERENCES engagement_end_reasons(code) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_superseded_by_fk f FOREIGN KEY (superseded_by_id, engagement_id) REFERENCES customer_engagement_terminations(id, engagement_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
engagement_types engagement_types_code_shape c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_service_fk f FOREIGN KEY (service_code, product_level_code) REFERENCES service_catalogue(code, product_level_code) ON DELETE RESTRICT deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_superseded_by_fk f FOREIGN KEY (superseded_by_id, engagement_id) REFERENCES engagement_service_scopes(id, engagement_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
engagement_types engagement_types_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
engagement_types engagement_types_pkey p PRIMARY KEY (code) deferrable=false deferred=false
engagement_types engagement_types_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
engagement_stage_types engagement_stage_types_code_shape c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)) deferrable=false deferred=false
engagement_stage_types engagement_stage_types_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
engagement_stage_types engagement_stage_types_not_bounded_and_terminal c CHECK ((NOT (is_bounded AND is_terminal))) deferrable=false deferred=false
engagement_stage_types engagement_stage_types_pkey p PRIMARY KEY (code) deferrable=false deferred=false
engagement_stage_types engagement_stage_types_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
product_levels product_levels_code_shape c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)) deferrable=false deferred=false
product_levels product_levels_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
product_levels product_levels_pkey p PRIMARY KEY (code) deferrable=false deferred=false
product_levels product_levels_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
service_catalogue service_catalogue_code_shape c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)) deferrable=false deferred=false
service_catalogue service_catalogue_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
service_catalogue service_catalogue_pkey p PRIMARY KEY (code) deferrable=false deferred=false
service_catalogue service_catalogue_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
service_catalogue service_catalogue_code_level_uq u UNIQUE (code, product_level_code) deferrable=false deferred=false
service_catalogue service_catalogue_product_level_code_fkey f FOREIGN KEY (product_level_code) REFERENCES product_levels(code) ON DELETE RESTRICT deferrable=false deferred=false
engagement_end_reasons engagement_end_reasons_code_shape c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)) deferrable=false deferred=false
engagement_end_reasons engagement_end_reasons_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
engagement_end_reasons engagement_end_reasons_pkey p PRIMARY KEY (code) deferrable=false deferred=false
engagement_end_reasons engagement_end_reasons_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
customer_engagements customer_engagements_engagement_type_fk f FOREIGN KEY (engagement_type) REFERENCES engagement_types(code) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagements customer_engagements_end_reason_code_fk f FOREIGN KEY (end_reason_code) REFERENCES engagement_end_reasons(code) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagements customer_engagements_ended_after_start c CHECK (((ended_at IS NULL) OR (ended_at > started_at))) deferrable=false deferred=false
customer_engagements customer_engagements_end_reason_code_with_end c CHECK (((ended_at IS NULL) = (end_reason_code IS NULL))) deferrable=false deferred=false
customer_engagements customer_engagements_end_reason_retired c CHECK ((end_reason IS NULL)) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_planned_end_after_start c CHECK (((planned_end_at IS NULL) OR (planned_end_at > effective_from))) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)))) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_id_engagement_uq u UNIQUE (id, engagement_id) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_engagement_id_fkey f FOREIGN KEY (engagement_id) REFERENCES customer_engagements(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_stage_code_fkey f FOREIGN KEY (stage_code) REFERENCES engagement_stage_types(code) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_superseded_by_fk f FOREIGN KEY (superseded_by_id, engagement_id) REFERENCES customer_engagement_stages(id, engagement_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
customer_engagement_terminations customer_engagement_terminations_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)))) deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_id_engagement_uq u UNIQUE (id, engagement_id) deferrable=false deferred=false
customer_agreements customer_agreements_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
customer_agreements customer_agreements_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
customer_agreements customer_agreements_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customer_agreements customer_agreements_customer_id_fkey f FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_reference_shape c CHECK (((agreement_reference IS NULL) OR ((btrim(agreement_reference) <> ''::text) AND (char_length(agreement_reference) <= 100)))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'AMENDMENT'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_id_agreement_uq u UNIQUE (id, agreement_id) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_agreement_id_fkey f FOREIGN KEY (agreement_id) REFERENCES customer_agreements(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_superseded_by_fk f FOREIGN KEY (superseded_by_id, agreement_id) REFERENCES customer_agreement_versions(id, agreement_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
engagement_service_scopes engagement_service_scopes_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_pkey p PRIMARY KEY (id) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_id_engagement_uq u UNIQUE (id, engagement_id) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_engagement_id_fkey f FOREIGN KEY (engagement_id) REFERENCES customer_engagements(id) ON DELETE RESTRICT deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_product_level_code_fkey f FOREIGN KEY (product_level_code) REFERENCES product_levels(code) ON DELETE RESTRICT deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_agreement_id_fkey f FOREIGN KEY (agreement_id) REFERENCES customer_agreements(id) ON DELETE RESTRICT deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_id_engagement_uq u UNIQUE (id, engagement_id) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_engagement_id_fkey f FOREIGN KEY (engagement_id) REFERENCES customer_engagements(id) ON DELETE RESTRICT deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_scope_fk f FOREIGN KEY (scope_id, engagement_id) REFERENCES engagement_service_scopes(id, engagement_id) ON DELETE RESTRICT deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_superseded_by_fk f FOREIGN KEY (superseded_by_id, engagement_id) REFERENCES engagement_responsibility_periods(id, engagement_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.engagement_types'::regclass,'public.engagement_stage_types'::regclass,'public.product_levels'::regclass,'public.service_catalogue'::regclass,'public.engagement_end_reasons'::regclass,'public.customer_engagement_stages'::regclass,'public.customer_engagement_terminations'::regclass,'public.engagement_service_scopes'::regclass,'public.engagement_responsibility_periods'::regclass,'public.customer_agreements'::regclass,'public.customer_agreement_versions'::regclass,'public.customer_engagements'::regclass,'public.customers'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.engagement_types'::regclass,'public.engagement_stage_types'::regclass,'public.product_levels'::regclass,'public.service_catalogue'::regclass,'public.engagement_end_reasons'::regclass,'public.customer_engagement_stages'::regclass,'public.customer_engagement_terminations'::regclass,'public.engagement_service_scopes'::regclass,'public.engagement_responsibility_periods'::regclass,'public.customer_agreements'::regclass,'public.customer_agreement_versions'::regclass,'public.customer_engagements'::regclass,'public.customers'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$customers customers_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customers customers_organization_id_key u UNIQUE (organization_id) deferrable=false deferred=false
customers customers_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagements customer_engagements_dates_valid c CHECK (((ended_at IS NULL) OR (ended_at >= started_at))) deferrable=false deferred=false
customer_engagements customer_engagements_end_reason_consistent c CHECK (((ended_at IS NOT NULL) OR (end_reason IS NULL))) deferrable=false deferred=false
customer_engagements customer_engagements_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customer_engagements customer_engagements_customer_id_fkey f FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_engagement_id_fkey f FOREIGN KEY (engagement_id) REFERENCES customer_engagements(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_end_reason_code_fkey f FOREIGN KEY (end_reason_code) REFERENCES engagement_end_reasons(code) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_superseded_by_fk f FOREIGN KEY (superseded_by_id, engagement_id) REFERENCES customer_engagement_terminations(id, engagement_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
engagement_types engagement_types_code_shape c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_service_fk f FOREIGN KEY (service_code, product_level_code) REFERENCES service_catalogue(code, product_level_code) ON DELETE RESTRICT deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_superseded_by_fk f FOREIGN KEY (superseded_by_id, engagement_id) REFERENCES engagement_service_scopes(id, engagement_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
engagement_types engagement_types_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
engagement_types engagement_types_pkey p PRIMARY KEY (code) deferrable=false deferred=false
engagement_types engagement_types_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
engagement_stage_types engagement_stage_types_code_shape c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)) deferrable=false deferred=false
engagement_stage_types engagement_stage_types_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
engagement_stage_types engagement_stage_types_not_bounded_and_terminal c CHECK ((NOT (is_bounded AND is_terminal))) deferrable=false deferred=false
engagement_stage_types engagement_stage_types_pkey p PRIMARY KEY (code) deferrable=false deferred=false
engagement_stage_types engagement_stage_types_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
product_levels product_levels_code_shape c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)) deferrable=false deferred=false
product_levels product_levels_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
product_levels product_levels_pkey p PRIMARY KEY (code) deferrable=false deferred=false
product_levels product_levels_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
service_catalogue service_catalogue_code_shape c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)) deferrable=false deferred=false
service_catalogue service_catalogue_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
service_catalogue service_catalogue_pkey p PRIMARY KEY (code) deferrable=false deferred=false
service_catalogue service_catalogue_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
service_catalogue service_catalogue_code_level_uq u UNIQUE (code, product_level_code) deferrable=false deferred=false
service_catalogue service_catalogue_product_level_code_fkey f FOREIGN KEY (product_level_code) REFERENCES product_levels(code) ON DELETE RESTRICT deferrable=false deferred=false
engagement_end_reasons engagement_end_reasons_code_shape c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)) deferrable=false deferred=false
engagement_end_reasons engagement_end_reasons_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
engagement_end_reasons engagement_end_reasons_pkey p PRIMARY KEY (code) deferrable=false deferred=false
engagement_end_reasons engagement_end_reasons_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
customer_engagements customer_engagements_engagement_type_fk f FOREIGN KEY (engagement_type) REFERENCES engagement_types(code) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagements customer_engagements_end_reason_code_fk f FOREIGN KEY (end_reason_code) REFERENCES engagement_end_reasons(code) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagements customer_engagements_ended_after_start c CHECK (((ended_at IS NULL) OR (ended_at > started_at))) deferrable=false deferred=false
customer_engagements customer_engagements_end_reason_code_with_end c CHECK (((ended_at IS NULL) = (end_reason_code IS NULL))) deferrable=false deferred=false
customer_engagements customer_engagements_end_reason_retired c CHECK ((end_reason IS NULL)) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_planned_end_after_start c CHECK (((planned_end_at IS NULL) OR (planned_end_at > effective_from))) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)))) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_id_engagement_uq u UNIQUE (id, engagement_id) deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_engagement_id_fkey f FOREIGN KEY (engagement_id) REFERENCES customer_engagements(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_stage_code_fkey f FOREIGN KEY (stage_code) REFERENCES engagement_stage_types(code) ON DELETE RESTRICT deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_superseded_by_fk f FOREIGN KEY (superseded_by_id, engagement_id) REFERENCES customer_engagement_stages(id, engagement_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
customer_engagement_terminations customer_engagement_terminations_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)))) deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_id_engagement_uq u UNIQUE (id, engagement_id) deferrable=false deferred=false
customer_agreements customer_agreements_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
customer_agreements customer_agreements_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
customer_agreements customer_agreements_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customer_agreements customer_agreements_customer_id_fkey f FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_reference_shape c CHECK (((agreement_reference IS NULL) OR ((btrim(agreement_reference) <> ''::text) AND (char_length(agreement_reference) <= 100)))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'AMENDMENT'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_pkey p PRIMARY KEY (id) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_id_agreement_uq u UNIQUE (id, agreement_id) deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_agreement_id_fkey f FOREIGN KEY (agreement_id) REFERENCES customer_agreements(id) ON DELETE RESTRICT deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_superseded_by_fk f FOREIGN KEY (superseded_by_id, agreement_id) REFERENCES customer_agreement_versions(id, agreement_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
engagement_service_scopes engagement_service_scopes_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_pkey p PRIMARY KEY (id) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_id_engagement_uq u UNIQUE (id, engagement_id) deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_engagement_id_fkey f FOREIGN KEY (engagement_id) REFERENCES customer_engagements(id) ON DELETE RESTRICT deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_product_level_code_fkey f FOREIGN KEY (product_level_code) REFERENCES product_levels(code) ON DELETE RESTRICT deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_agreement_id_fkey f FOREIGN KEY (agreement_id) REFERENCES customer_agreements(id) ON DELETE RESTRICT deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_change_reason_valid c CHECK ((change_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text, 'voided'::text]))) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NOT NULL)) OR ((record_status = 'voided'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_id IS NULL)))) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_not_superseded_by_self c CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id))) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_id_engagement_uq u UNIQUE (id, engagement_id) deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_engagement_id_fkey f FOREIGN KEY (engagement_id) REFERENCES customer_engagements(id) ON DELETE RESTRICT deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_scope_fk f FOREIGN KEY (scope_id, engagement_id) REFERENCES engagement_service_scopes(id, engagement_id) ON DELETE RESTRICT deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_superseded_by_fk f FOREIGN KEY (superseded_by_id, engagement_id) REFERENCES engagement_responsibility_periods(id, engagement_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0015 + customer_engagements constraints (definition, deferrability) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0015 + customer_engagements constraints (definition, deferrability) (91 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$customers customers_pkey CREATE UNIQUE INDEX customers_pkey ON public.customers USING btree (id)
customers customers_organization_id_key CREATE UNIQUE INDEX customers_organization_id_key ON public.customers USING btree (organization_id)
customer_engagements customer_engagements_pkey CREATE UNIQUE INDEX customer_engagements_pkey ON public.customer_engagements USING btree (id)
customer_engagements customer_engagements_one_open_uq CREATE UNIQUE INDEX customer_engagements_one_open_uq ON public.customer_engagements USING btree (customer_id) WHERE (ended_at IS NULL)
customer_engagements customer_engagements_customer_idx CREATE INDEX customer_engagements_customer_idx ON public.customer_engagements USING btree (customer_id)
customer_engagements customer_engagements_started_at_idx CREATE INDEX customer_engagements_started_at_idx ON public.customer_engagements USING btree (started_at)
engagement_types engagement_types_pkey CREATE UNIQUE INDEX engagement_types_pkey ON public.engagement_types USING btree (code)
engagement_types engagement_types_sort_order_uq CREATE UNIQUE INDEX engagement_types_sort_order_uq ON public.engagement_types USING btree (sort_order)
engagement_stage_types engagement_stage_types_pkey CREATE UNIQUE INDEX engagement_stage_types_pkey ON public.engagement_stage_types USING btree (code)
engagement_stage_types engagement_stage_types_sort_order_uq CREATE UNIQUE INDEX engagement_stage_types_sort_order_uq ON public.engagement_stage_types USING btree (sort_order)
product_levels product_levels_pkey CREATE UNIQUE INDEX product_levels_pkey ON public.product_levels USING btree (code)
product_levels product_levels_sort_order_uq CREATE UNIQUE INDEX product_levels_sort_order_uq ON public.product_levels USING btree (sort_order)
service_catalogue service_catalogue_pkey CREATE UNIQUE INDEX service_catalogue_pkey ON public.service_catalogue USING btree (code)
service_catalogue service_catalogue_sort_order_uq CREATE UNIQUE INDEX service_catalogue_sort_order_uq ON public.service_catalogue USING btree (sort_order)
service_catalogue service_catalogue_code_level_uq CREATE UNIQUE INDEX service_catalogue_code_level_uq ON public.service_catalogue USING btree (code, product_level_code)
engagement_end_reasons engagement_end_reasons_pkey CREATE UNIQUE INDEX engagement_end_reasons_pkey ON public.engagement_end_reasons USING btree (code)
engagement_end_reasons engagement_end_reasons_sort_order_uq CREATE UNIQUE INDEX engagement_end_reasons_sort_order_uq ON public.engagement_end_reasons USING btree (sort_order)
customer_engagement_stages customer_engagement_stages_history_idx CREATE INDEX customer_engagement_stages_history_idx ON public.customer_engagement_stages USING btree (engagement_id, effective_from)
customer_engagement_stages customer_engagement_stages_pkey CREATE UNIQUE INDEX customer_engagement_stages_pkey ON public.customer_engagement_stages USING btree (id)
customer_engagement_stages customer_engagement_stages_id_engagement_uq CREATE UNIQUE INDEX customer_engagement_stages_id_engagement_uq ON public.customer_engagement_stages USING btree (id, engagement_id)
customer_engagement_stages customer_engagement_stages_current_uq CREATE UNIQUE INDEX customer_engagement_stages_current_uq ON public.customer_engagement_stages USING btree (engagement_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
customer_engagement_terminations customer_engagement_terminations_pkey CREATE UNIQUE INDEX customer_engagement_terminations_pkey ON public.customer_engagement_terminations USING btree (id)
customer_engagement_terminations customer_engagement_terminations_id_engagement_uq CREATE UNIQUE INDEX customer_engagement_terminations_id_engagement_uq ON public.customer_engagement_terminations USING btree (id, engagement_id)
customer_engagement_terminations customer_engagement_terminations_current_uq CREATE UNIQUE INDEX customer_engagement_terminations_current_uq ON public.customer_engagement_terminations USING btree (engagement_id) WHERE (record_status = 'active'::text)
customer_engagement_terminations customer_engagement_terminations_history_idx CREATE INDEX customer_engagement_terminations_history_idx ON public.customer_engagement_terminations USING btree (engagement_id, created_at)
engagement_service_scopes engagement_service_scopes_pkey CREATE UNIQUE INDEX engagement_service_scopes_pkey ON public.engagement_service_scopes USING btree (id)
engagement_service_scopes engagement_service_scopes_id_engagement_uq CREATE UNIQUE INDEX engagement_service_scopes_id_engagement_uq ON public.engagement_service_scopes USING btree (id, engagement_id)
engagement_service_scopes engagement_service_scopes_current_uq CREATE UNIQUE INDEX engagement_service_scopes_current_uq ON public.engagement_service_scopes USING btree (engagement_id, product_level_code, COALESCE(service_code, ''::text)) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
engagement_service_scopes engagement_service_scopes_history_idx CREATE INDEX engagement_service_scopes_history_idx ON public.engagement_service_scopes USING btree (engagement_id, effective_from)
engagement_service_scopes engagement_service_scopes_agreement_idx CREATE INDEX engagement_service_scopes_agreement_idx ON public.engagement_service_scopes USING btree (agreement_id) WHERE (agreement_id IS NOT NULL)
engagement_responsibility_periods engagement_responsibility_periods_pkey CREATE UNIQUE INDEX engagement_responsibility_periods_pkey ON public.engagement_responsibility_periods USING btree (id)
engagement_responsibility_periods engagement_responsibility_periods_id_engagement_uq CREATE UNIQUE INDEX engagement_responsibility_periods_id_engagement_uq ON public.engagement_responsibility_periods USING btree (id, engagement_id)
engagement_responsibility_periods engagement_responsibility_periods_current_uq CREATE UNIQUE INDEX engagement_responsibility_periods_current_uq ON public.engagement_responsibility_periods USING btree (scope_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
engagement_responsibility_periods engagement_responsibility_periods_history_idx CREATE INDEX engagement_responsibility_periods_history_idx ON public.engagement_responsibility_periods USING btree (scope_id, effective_from)
engagement_responsibility_periods engagement_responsibility_periods_engagement_idx CREATE INDEX engagement_responsibility_periods_engagement_idx ON public.engagement_responsibility_periods USING btree (engagement_id)
customer_agreements customer_agreements_pkey CREATE UNIQUE INDEX customer_agreements_pkey ON public.customer_agreements USING btree (id)
customer_agreements customer_agreements_customer_idx CREATE INDEX customer_agreements_customer_idx ON public.customer_agreements USING btree (customer_id)
customer_agreement_versions customer_agreement_versions_pkey CREATE UNIQUE INDEX customer_agreement_versions_pkey ON public.customer_agreement_versions USING btree (id)
customer_agreement_versions customer_agreement_versions_id_agreement_uq CREATE UNIQUE INDEX customer_agreement_versions_id_agreement_uq ON public.customer_agreement_versions USING btree (id, agreement_id)
customer_agreement_versions customer_agreement_versions_current_uq CREATE UNIQUE INDEX customer_agreement_versions_current_uq ON public.customer_agreement_versions USING btree (agreement_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
customer_agreement_versions customer_agreement_versions_history_idx CREATE INDEX customer_agreement_versions_history_idx ON public.customer_agreement_versions USING btree (agreement_id, effective_from)$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('engagement_types','engagement_stage_types','product_levels','service_catalogue','engagement_end_reasons','customer_engagement_stages','customer_engagement_terminations','engagement_service_scopes','engagement_responsibility_periods','customer_agreements','customer_agreement_versions','customer_engagements','customers')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('engagement_types','engagement_stage_types','product_levels','service_catalogue','engagement_end_reasons','customer_engagement_stages','customer_engagement_terminations','engagement_service_scopes','engagement_responsibility_periods','customer_agreements','customer_agreement_versions','customer_engagements','customers')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$customers customers_pkey CREATE UNIQUE INDEX customers_pkey ON public.customers USING btree (id)
customers customers_organization_id_key CREATE UNIQUE INDEX customers_organization_id_key ON public.customers USING btree (organization_id)
customer_engagements customer_engagements_pkey CREATE UNIQUE INDEX customer_engagements_pkey ON public.customer_engagements USING btree (id)
customer_engagements customer_engagements_one_open_uq CREATE UNIQUE INDEX customer_engagements_one_open_uq ON public.customer_engagements USING btree (customer_id) WHERE (ended_at IS NULL)
customer_engagements customer_engagements_customer_idx CREATE INDEX customer_engagements_customer_idx ON public.customer_engagements USING btree (customer_id)
customer_engagements customer_engagements_started_at_idx CREATE INDEX customer_engagements_started_at_idx ON public.customer_engagements USING btree (started_at)
engagement_types engagement_types_pkey CREATE UNIQUE INDEX engagement_types_pkey ON public.engagement_types USING btree (code)
engagement_types engagement_types_sort_order_uq CREATE UNIQUE INDEX engagement_types_sort_order_uq ON public.engagement_types USING btree (sort_order)
engagement_stage_types engagement_stage_types_pkey CREATE UNIQUE INDEX engagement_stage_types_pkey ON public.engagement_stage_types USING btree (code)
engagement_stage_types engagement_stage_types_sort_order_uq CREATE UNIQUE INDEX engagement_stage_types_sort_order_uq ON public.engagement_stage_types USING btree (sort_order)
product_levels product_levels_pkey CREATE UNIQUE INDEX product_levels_pkey ON public.product_levels USING btree (code)
product_levels product_levels_sort_order_uq CREATE UNIQUE INDEX product_levels_sort_order_uq ON public.product_levels USING btree (sort_order)
service_catalogue service_catalogue_pkey CREATE UNIQUE INDEX service_catalogue_pkey ON public.service_catalogue USING btree (code)
service_catalogue service_catalogue_sort_order_uq CREATE UNIQUE INDEX service_catalogue_sort_order_uq ON public.service_catalogue USING btree (sort_order)
service_catalogue service_catalogue_code_level_uq CREATE UNIQUE INDEX service_catalogue_code_level_uq ON public.service_catalogue USING btree (code, product_level_code)
engagement_end_reasons engagement_end_reasons_pkey CREATE UNIQUE INDEX engagement_end_reasons_pkey ON public.engagement_end_reasons USING btree (code)
engagement_end_reasons engagement_end_reasons_sort_order_uq CREATE UNIQUE INDEX engagement_end_reasons_sort_order_uq ON public.engagement_end_reasons USING btree (sort_order)
customer_engagement_stages customer_engagement_stages_history_idx CREATE INDEX customer_engagement_stages_history_idx ON public.customer_engagement_stages USING btree (engagement_id, effective_from)
customer_engagement_stages customer_engagement_stages_pkey CREATE UNIQUE INDEX customer_engagement_stages_pkey ON public.customer_engagement_stages USING btree (id)
customer_engagement_stages customer_engagement_stages_id_engagement_uq CREATE UNIQUE INDEX customer_engagement_stages_id_engagement_uq ON public.customer_engagement_stages USING btree (id, engagement_id)
customer_engagement_stages customer_engagement_stages_current_uq CREATE UNIQUE INDEX customer_engagement_stages_current_uq ON public.customer_engagement_stages USING btree (engagement_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
customer_engagement_terminations customer_engagement_terminations_pkey CREATE UNIQUE INDEX customer_engagement_terminations_pkey ON public.customer_engagement_terminations USING btree (id)
customer_engagement_terminations customer_engagement_terminations_id_engagement_uq CREATE UNIQUE INDEX customer_engagement_terminations_id_engagement_uq ON public.customer_engagement_terminations USING btree (id, engagement_id)
customer_engagement_terminations customer_engagement_terminations_current_uq CREATE UNIQUE INDEX customer_engagement_terminations_current_uq ON public.customer_engagement_terminations USING btree (engagement_id) WHERE (record_status = 'active'::text)
customer_engagement_terminations customer_engagement_terminations_history_idx CREATE INDEX customer_engagement_terminations_history_idx ON public.customer_engagement_terminations USING btree (engagement_id, created_at)
engagement_service_scopes engagement_service_scopes_pkey CREATE UNIQUE INDEX engagement_service_scopes_pkey ON public.engagement_service_scopes USING btree (id)
engagement_service_scopes engagement_service_scopes_id_engagement_uq CREATE UNIQUE INDEX engagement_service_scopes_id_engagement_uq ON public.engagement_service_scopes USING btree (id, engagement_id)
engagement_service_scopes engagement_service_scopes_current_uq CREATE UNIQUE INDEX engagement_service_scopes_current_uq ON public.engagement_service_scopes USING btree (engagement_id, product_level_code, COALESCE(service_code, ''::text)) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
engagement_service_scopes engagement_service_scopes_history_idx CREATE INDEX engagement_service_scopes_history_idx ON public.engagement_service_scopes USING btree (engagement_id, effective_from)
engagement_service_scopes engagement_service_scopes_agreement_idx CREATE INDEX engagement_service_scopes_agreement_idx ON public.engagement_service_scopes USING btree (agreement_id) WHERE (agreement_id IS NOT NULL)
engagement_responsibility_periods engagement_responsibility_periods_pkey CREATE UNIQUE INDEX engagement_responsibility_periods_pkey ON public.engagement_responsibility_periods USING btree (id)
engagement_responsibility_periods engagement_responsibility_periods_id_engagement_uq CREATE UNIQUE INDEX engagement_responsibility_periods_id_engagement_uq ON public.engagement_responsibility_periods USING btree (id, engagement_id)
engagement_responsibility_periods engagement_responsibility_periods_current_uq CREATE UNIQUE INDEX engagement_responsibility_periods_current_uq ON public.engagement_responsibility_periods USING btree (scope_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
engagement_responsibility_periods engagement_responsibility_periods_history_idx CREATE INDEX engagement_responsibility_periods_history_idx ON public.engagement_responsibility_periods USING btree (scope_id, effective_from)
engagement_responsibility_periods engagement_responsibility_periods_engagement_idx CREATE INDEX engagement_responsibility_periods_engagement_idx ON public.engagement_responsibility_periods USING btree (engagement_id)
customer_agreements customer_agreements_pkey CREATE UNIQUE INDEX customer_agreements_pkey ON public.customer_agreements USING btree (id)
customer_agreements customer_agreements_customer_idx CREATE INDEX customer_agreements_customer_idx ON public.customer_agreements USING btree (customer_id)
customer_agreement_versions customer_agreement_versions_pkey CREATE UNIQUE INDEX customer_agreement_versions_pkey ON public.customer_agreement_versions USING btree (id)
customer_agreement_versions customer_agreement_versions_id_agreement_uq CREATE UNIQUE INDEX customer_agreement_versions_id_agreement_uq ON public.customer_agreement_versions USING btree (id, agreement_id)
customer_agreement_versions customer_agreement_versions_current_uq CREATE UNIQUE INDEX customer_agreement_versions_current_uq ON public.customer_agreement_versions USING btree (agreement_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
customer_agreement_versions customer_agreement_versions_history_idx CREATE INDEX customer_agreement_versions_history_idx ON public.customer_agreement_versions USING btree (agreement_id, effective_from)$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0015 + customer_engagements indexes (exact definitions) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0015 + customer_engagements indexes (exact definitions) (41 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$customer_engagements customer_engagements_guard_insert enabled=O type=7 function=tes_security.guard_engagement_insert constraint=false deferrable=false deferred=false
customer_engagements customer_engagements_guard_update enabled=O type=19 function=tes_security.guard_engagement_update constraint=false deferrable=false deferred=false
customer_engagements customer_engagements_require_consistency enabled=O type=21 function=tes_security.require_engagement_consistency constraint=true deferrable=true deferred=true
customer_engagement_stages customer_engagement_stages_guard_insert enabled=O type=7 function=tes_security.guard_engagement_stage_insert constraint=false deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_guard_update enabled=O type=19 function=tes_security.guard_engagement_child_update constraint=false deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_require_consistency enabled=O type=21 function=tes_security.require_engagement_consistency constraint=true deferrable=true deferred=true
customer_engagement_terminations customer_engagement_terminations_guard_insert enabled=O type=7 function=tes_security.guard_engagement_termination_insert constraint=false deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_guard_update enabled=O type=19 function=tes_security.guard_engagement_termination_update constraint=false deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_require_consistency enabled=O type=21 function=tes_security.require_engagement_consistency constraint=true deferrable=true deferred=true
engagement_service_scopes engagement_service_scopes_guard_insert enabled=O type=7 function=tes_security.guard_engagement_scope_insert constraint=false deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_guard_update enabled=O type=19 function=tes_security.guard_engagement_child_update constraint=false deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_guard_dependents enabled=O type=19 function=tes_security.guard_engagement_scope_update constraint=false deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_require_consistency enabled=O type=21 function=tes_security.require_engagement_consistency constraint=true deferrable=true deferred=true
engagement_responsibility_periods engagement_responsibility_periods_guard_insert enabled=O type=7 function=tes_security.guard_engagement_responsibility_insert constraint=false deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_guard_update enabled=O type=19 function=tes_security.guard_engagement_child_update constraint=false deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_require_consistency enabled=O type=21 function=tes_security.require_engagement_consistency constraint=true deferrable=true deferred=true
customer_agreements customer_agreements_guard_update enabled=O type=19 function=tes_security.guard_customer_agreement_update constraint=false deferrable=false deferred=false
customer_agreements customer_agreements_require_version enabled=O type=5 function=tes_security.require_customer_agreement_version constraint=true deferrable=true deferred=true
customer_agreement_versions customer_agreement_versions_guard_insert enabled=O type=7 function=tes_security.guard_customer_agreement_version_insert constraint=false deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_guard_update enabled=O type=19 function=tes_security.guard_engagement_child_update constraint=false deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_require_version enabled=O type=21 function=tes_security.require_customer_agreement_version constraint=true deferrable=true deferred=true
customer_engagement_stages customer_engagement_stages_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_agreements customer_agreements_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_agreements customer_agreements_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.engagement_types'::regclass,'public.engagement_stage_types'::regclass,'public.product_levels'::regclass,'public.service_catalogue'::regclass,'public.engagement_end_reasons'::regclass,'public.customer_engagement_stages'::regclass,'public.customer_engagement_terminations'::regclass,'public.engagement_service_scopes'::regclass,'public.engagement_responsibility_periods'::regclass,'public.customer_agreements'::regclass,'public.customer_agreement_versions'::regclass,'public.customer_engagements'::regclass,'public.customers'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.engagement_types'::regclass,'public.engagement_stage_types'::regclass,'public.product_levels'::regclass,'public.service_catalogue'::regclass,'public.engagement_end_reasons'::regclass,'public.customer_engagement_stages'::regclass,'public.customer_engagement_terminations'::regclass,'public.engagement_service_scopes'::regclass,'public.engagement_responsibility_periods'::regclass,'public.customer_agreements'::regclass,'public.customer_agreement_versions'::regclass,'public.customer_engagements'::regclass,'public.customers'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$customer_engagements customer_engagements_guard_insert enabled=O type=7 function=tes_security.guard_engagement_insert constraint=false deferrable=false deferred=false
customer_engagements customer_engagements_guard_update enabled=O type=19 function=tes_security.guard_engagement_update constraint=false deferrable=false deferred=false
customer_engagements customer_engagements_require_consistency enabled=O type=21 function=tes_security.require_engagement_consistency constraint=true deferrable=true deferred=true
customer_engagement_stages customer_engagement_stages_guard_insert enabled=O type=7 function=tes_security.guard_engagement_stage_insert constraint=false deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_guard_update enabled=O type=19 function=tes_security.guard_engagement_child_update constraint=false deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_require_consistency enabled=O type=21 function=tes_security.require_engagement_consistency constraint=true deferrable=true deferred=true
customer_engagement_terminations customer_engagement_terminations_guard_insert enabled=O type=7 function=tes_security.guard_engagement_termination_insert constraint=false deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_guard_update enabled=O type=19 function=tes_security.guard_engagement_termination_update constraint=false deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_require_consistency enabled=O type=21 function=tes_security.require_engagement_consistency constraint=true deferrable=true deferred=true
engagement_service_scopes engagement_service_scopes_guard_insert enabled=O type=7 function=tes_security.guard_engagement_scope_insert constraint=false deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_guard_update enabled=O type=19 function=tes_security.guard_engagement_child_update constraint=false deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_guard_dependents enabled=O type=19 function=tes_security.guard_engagement_scope_update constraint=false deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_require_consistency enabled=O type=21 function=tes_security.require_engagement_consistency constraint=true deferrable=true deferred=true
engagement_responsibility_periods engagement_responsibility_periods_guard_insert enabled=O type=7 function=tes_security.guard_engagement_responsibility_insert constraint=false deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_guard_update enabled=O type=19 function=tes_security.guard_engagement_child_update constraint=false deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_require_consistency enabled=O type=21 function=tes_security.require_engagement_consistency constraint=true deferrable=true deferred=true
customer_agreements customer_agreements_guard_update enabled=O type=19 function=tes_security.guard_customer_agreement_update constraint=false deferrable=false deferred=false
customer_agreements customer_agreements_require_version enabled=O type=5 function=tes_security.require_customer_agreement_version constraint=true deferrable=true deferred=true
customer_agreement_versions customer_agreement_versions_guard_insert enabled=O type=7 function=tes_security.guard_customer_agreement_version_insert constraint=false deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_guard_update enabled=O type=19 function=tes_security.guard_engagement_child_update constraint=false deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_require_version enabled=O type=21 function=tes_security.require_customer_agreement_version constraint=true deferrable=true deferred=true
customer_engagement_stages customer_engagement_stages_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_agreements customer_agreements_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_no_delete enabled=O type=11 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_engagement_stages customer_engagement_stages_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_engagement_terminations customer_engagement_terminations_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
engagement_service_scopes engagement_service_scopes_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
engagement_responsibility_periods engagement_responsibility_periods_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_agreements customer_agreements_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false
customer_agreement_versions customer_agreement_versions_no_truncate enabled=O type=34 function=tes_security.prevent_customer_relationship_removal constraint=false deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0015 + customer_engagements triggers (enabled flag, type, function, deferral) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0015 + customer_engagements triggers (enabled flag, type, function, deferral) (33 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$prevent_customer_relationship_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=bf26768f418ea5ccdf46e57b23abe916 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_termination_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=712639a2e112c939da452dfb016f62fc owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=4384ce8b5b26242d18373612b0848b21 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=ec6473d80a0a67ff41936657b1183023 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_child_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=cde8c84201c94de1e39b324048d23daa owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_stage_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=152a9bf332a7173c154e10dd25738e02 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_termination_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=b7e2466ada645b71c2ffc3d21629059a owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_scope_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=7857c61b6321569e8e02c89f7017af19 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_scope_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=4d046d9a3e0e98c576405a3272f42333 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_responsibility_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=5ebac3dd23bef8d54669cbcb538dfd73 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_customer_agreement_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=475a810f529357e4d44ba05c6b3fd8fe owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_customer_agreement_version_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=792b7701c59f358aacc6057aa24570e3 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_engagement_consistency secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=db88377c4e1600c0e8d3adf8f069f158 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_customer_agreement_version secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=0acf419bd07933d637dc50db9ad397ca owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_customer_relationship_removal','guard_engagement_insert','guard_engagement_update','guard_engagement_child_update','guard_engagement_stage_insert','guard_engagement_termination_insert','guard_engagement_termination_update','guard_engagement_scope_insert','guard_engagement_scope_update','guard_engagement_responsibility_insert','guard_customer_agreement_update','guard_customer_agreement_version_insert','require_engagement_consistency','require_customer_agreement_version')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_customer_relationship_removal','guard_engagement_insert','guard_engagement_update','guard_engagement_child_update','guard_engagement_stage_insert','guard_engagement_termination_insert','guard_engagement_termination_update','guard_engagement_scope_insert','guard_engagement_scope_update','guard_engagement_responsibility_insert','guard_customer_agreement_update','guard_customer_agreement_version_insert','require_engagement_consistency','require_customer_agreement_version')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$prevent_customer_relationship_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=bf26768f418ea5ccdf46e57b23abe916 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_termination_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=712639a2e112c939da452dfb016f62fc owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=4384ce8b5b26242d18373612b0848b21 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=ec6473d80a0a67ff41936657b1183023 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_child_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=cde8c84201c94de1e39b324048d23daa owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_stage_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=152a9bf332a7173c154e10dd25738e02 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_termination_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=b7e2466ada645b71c2ffc3d21629059a owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_scope_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=7857c61b6321569e8e02c89f7017af19 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_scope_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=4d046d9a3e0e98c576405a3272f42333 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_engagement_responsibility_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=5ebac3dd23bef8d54669cbcb538dfd73 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_customer_agreement_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=475a810f529357e4d44ba05c6b3fd8fe owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_customer_agreement_version_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=792b7701c59f358aacc6057aa24570e3 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_engagement_consistency secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=db88377c4e1600c0e8d3adf8f069f158 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_customer_agreement_version secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=0acf419bd07933d637dc50db9ad397ca owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0015 trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0015 trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute) (14 entries) match the design exactly';
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
require_current_person_name
prevent_customer_relationship_removal
guard_engagement_termination_insert
guard_engagement_insert
guard_engagement_update
guard_engagement_child_update
guard_engagement_stage_insert
guard_engagement_termination_update
guard_engagement_scope_insert
guard_engagement_scope_update
guard_engagement_responsibility_insert
guard_customer_agreement_update
guard_customer_agreement_version_insert
require_engagement_consistency
require_customer_agreement_version$exp$, E'\n')) AS l
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
require_current_person_name
prevent_customer_relationship_removal
guard_engagement_termination_insert
guard_engagement_insert
guard_engagement_update
guard_engagement_child_update
guard_engagement_stage_insert
guard_engagement_termination_update
guard_engagement_scope_insert
guard_engagement_scope_update
guard_engagement_responsibility_insert
guard_customer_agreement_update
guard_customer_agreement_version_insert
require_engagement_consistency
require_customer_agreement_version$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'tes_security function set differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK tes_security function set (42 entries) match the design exactly';
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
    SELECT unnest(string_to_array($exp$customers owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
customer_engagements owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
engagement_types owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
engagement_stage_types owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
product_levels owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
service_catalogue owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
engagement_end_reasons owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
customer_engagement_stages owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
customer_engagement_terminations owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
engagement_service_scopes owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
engagement_responsibility_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
customer_agreements owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
customer_agreement_versions owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.engagement_types'::regclass,'public.engagement_stage_types'::regclass,'public.product_levels'::regclass,'public.service_catalogue'::regclass,'public.engagement_end_reasons'::regclass,'public.customer_engagement_stages'::regclass,'public.customer_engagement_terminations'::regclass,'public.engagement_service_scopes'::regclass,'public.engagement_responsibility_periods'::regclass,'public.customer_agreements'::regclass,'public.customer_agreement_versions'::regclass,'public.customer_engagements'::regclass,'public.customers'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.engagement_types'::regclass,'public.engagement_stage_types'::regclass,'public.product_levels'::regclass,'public.service_catalogue'::regclass,'public.engagement_end_reasons'::regclass,'public.customer_engagement_stages'::regclass,'public.customer_engagement_terminations'::regclass,'public.engagement_service_scopes'::regclass,'public.engagement_responsibility_periods'::regclass,'public.customer_agreements'::regclass,'public.customer_agreement_versions'::regclass,'public.customer_engagements'::regclass,'public.customers'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$customers owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
customer_engagements owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
engagement_types owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
engagement_stage_types owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
product_levels owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
service_catalogue owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
engagement_end_reasons owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
customer_engagement_stages owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
customer_engagement_terminations owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
engagement_service_scopes owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
engagement_responsibility_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
customer_agreements owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
customer_agreement_versions owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0015 table ownership and RLS flags (including customers and customer_engagements) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0015 table ownership and RLS flags (including customers and customer_engagements) (13 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$customers tes-backend@tes-production-510007.iam SELECT grantable=false
customer_engagements tes-backend@tes-production-510007.iam SELECT grantable=false
engagement_types tes-backend@tes-production-510007.iam SELECT grantable=false
engagement_stage_types tes-backend@tes-production-510007.iam SELECT grantable=false
product_levels tes-backend@tes-production-510007.iam SELECT grantable=false
service_catalogue tes-backend@tes-production-510007.iam SELECT grantable=false
engagement_end_reasons tes-backend@tes-production-510007.iam SELECT grantable=false
customer_engagement_stages tes-backend@tes-production-510007.iam SELECT grantable=false
customer_engagement_terminations tes-backend@tes-production-510007.iam SELECT grantable=false
engagement_service_scopes tes-backend@tes-production-510007.iam SELECT grantable=false
engagement_responsibility_periods tes-backend@tes-production-510007.iam SELECT grantable=false
customer_agreements tes-backend@tes-production-510007.iam SELECT grantable=false
customer_agreement_versions tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.engagement_types'::regclass,'public.engagement_stage_types'::regclass,'public.product_levels'::regclass,'public.service_catalogue'::regclass,'public.engagement_end_reasons'::regclass,'public.customer_engagement_stages'::regclass,'public.customer_engagement_terminations'::regclass,'public.engagement_service_scopes'::regclass,'public.engagement_responsibility_periods'::regclass,'public.customer_agreements'::regclass,'public.customer_agreement_versions'::regclass,'public.customer_engagements'::regclass,'public.customers'::regclass) AND x.grantee <> c.relowner) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.engagement_types'::regclass,'public.engagement_stage_types'::regclass,'public.product_levels'::regclass,'public.service_catalogue'::regclass,'public.engagement_end_reasons'::regclass,'public.customer_engagement_stages'::regclass,'public.customer_engagement_terminations'::regclass,'public.engagement_service_scopes'::regclass,'public.engagement_responsibility_periods'::regclass,'public.customer_agreements'::regclass,'public.customer_agreement_versions'::regclass,'public.customer_engagements'::regclass,'public.customers'::regclass) AND x.grantee <> c.relowner) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$customers tes-backend@tes-production-510007.iam SELECT grantable=false
customer_engagements tes-backend@tes-production-510007.iam SELECT grantable=false
engagement_types tes-backend@tes-production-510007.iam SELECT grantable=false
engagement_stage_types tes-backend@tes-production-510007.iam SELECT grantable=false
product_levels tes-backend@tes-production-510007.iam SELECT grantable=false
service_catalogue tes-backend@tes-production-510007.iam SELECT grantable=false
engagement_end_reasons tes-backend@tes-production-510007.iam SELECT grantable=false
customer_engagement_stages tes-backend@tes-production-510007.iam SELECT grantable=false
customer_engagement_terminations tes-backend@tes-production-510007.iam SELECT grantable=false
engagement_service_scopes tes-backend@tes-production-510007.iam SELECT grantable=false
engagement_responsibility_periods tes-backend@tes-production-510007.iam SELECT grantable=false
customer_agreements tes-backend@tes-production-510007.iam SELECT grantable=false
customer_agreement_versions tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0015 table ACL (every non-owner grantee, including customers and customer_engagements) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0015 table ACL (every non-owner grantee, including customers and customer_engagements) (13 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$customers.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.customer_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.started_at tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.ended_at tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.ended_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagements.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagements.engagement_type tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.end_reason_code tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.end_reason_code tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_stages.id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.engagement_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.stage_code tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.planned_end_at tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_stages.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_stages.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_stages.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_stages.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_terminations.id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_terminations.engagement_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_terminations.ended_at tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_terminations.end_reason_code tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_terminations.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_terminations.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_terminations.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_terminations.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_terminations.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreements.id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreements.customer_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreements.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreements.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreements.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreement_versions.id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.agreement_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.agreement_reference tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.signed_on tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreement_versions.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreement_versions.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreement_versions.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreement_versions.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_service_scopes.id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.engagement_id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.product_level_code tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.service_code tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.agreement_id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_service_scopes.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_service_scopes.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_service_scopes.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_service_scopes.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_responsibility_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.engagement_id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.scope_id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_responsibility_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_responsibility_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_responsibility_periods.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_responsibility_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.engagement_types'::regclass,'public.engagement_stage_types'::regclass,'public.product_levels'::regclass,'public.service_catalogue'::regclass,'public.engagement_end_reasons'::regclass,'public.customer_engagement_stages'::regclass,'public.customer_engagement_terminations'::regclass,'public.engagement_service_scopes'::regclass,'public.engagement_responsibility_periods'::regclass,'public.customer_agreements'::regclass,'public.customer_agreement_versions'::regclass,'public.customer_engagements'::regclass,'public.customers'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.engagement_types'::regclass,'public.engagement_stage_types'::regclass,'public.product_levels'::regclass,'public.service_catalogue'::regclass,'public.engagement_end_reasons'::regclass,'public.customer_engagement_stages'::regclass,'public.customer_engagement_terminations'::regclass,'public.engagement_service_scopes'::regclass,'public.engagement_responsibility_periods'::regclass,'public.customer_agreements'::regclass,'public.customer_agreement_versions'::regclass,'public.customer_engagements'::regclass,'public.customers'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$customers.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.customer_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.started_at tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.ended_at tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.ended_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagements.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagements.engagement_type tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.end_reason_code tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagements.end_reason_code tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_stages.id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.engagement_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.stage_code tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.planned_end_at tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_stages.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_stages.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_stages.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_stages.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_stages.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_terminations.id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_terminations.engagement_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_terminations.ended_at tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_terminations.end_reason_code tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_terminations.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
customer_engagement_terminations.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_terminations.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_terminations.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_engagement_terminations.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreements.id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreements.customer_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreements.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreements.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreements.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreement_versions.id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.agreement_id tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.agreement_reference tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.signed_on tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
customer_agreement_versions.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreement_versions.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreement_versions.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreement_versions.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
customer_agreement_versions.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_service_scopes.id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.engagement_id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.product_level_code tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.service_code tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.agreement_id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_service_scopes.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_service_scopes.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_service_scopes.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_service_scopes.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_service_scopes.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_responsibility_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.engagement_id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.scope_id tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.change_reason tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
engagement_responsibility_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_responsibility_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_responsibility_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_responsibility_periods.superseded_by_id tes-backend@tes-production-510007.iam UPDATE grantable=false
engagement_responsibility_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0015 column ACL (every column-specific grant, including customers and customer_engagements) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0015 column ACL (every column-specific grant, including customers and customer_engagements) (71 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$RECURRING|Recurring|An ongoing service relationship without a fixed end.|true|10
ONE_OFF|One-off|A bounded, transactional service relationship for a specific piece of work. The Customer identity is the same as for any other Engagement.|true|20$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.engagement_types) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.engagement_types) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$RECURRING|Recurring|An ongoing service relationship without a fixed end.|true|10
ONE_OFF|One-off|A bounded, transactional service relationship for a specific piece of work. The Customer identity is the same as for any other Engagement.|true|20$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'engagement_types seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK engagement_types seed rows (2 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$ONBOARDING|Onboarding|TES is setting the Customer up; service has not fully started.|false|false|true|10
TRIAL|Trial|A time-boxed evaluation period.|true|false|true|20
ACTIVE|Active|Service is being delivered in the ordinary way.|false|false|true|30
MANAGED_PROBATION|Managed probation|A time-boxed period of closer management. The maximum length is policy, not schema.|true|false|true|40
SUSPENDED|Suspended|The Engagement is open but service is paused.|false|false|true|50
ENDED|Ended|The Engagement has ended. A projection of customer_engagements.ended_at, never an independent fact.|false|true|true|60$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_bounded::text, '-') || '|' || COALESCE(is_terminal::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.engagement_stage_types) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_bounded::text, '-') || '|' || COALESCE(is_terminal::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.engagement_stage_types) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$ONBOARDING|Onboarding|TES is setting the Customer up; service has not fully started.|false|false|true|10
TRIAL|Trial|A time-boxed evaluation period.|true|false|true|20
ACTIVE|Active|Service is being delivered in the ordinary way.|false|false|true|30
MANAGED_PROBATION|Managed probation|A time-boxed period of closer management. The maximum length is policy, not schema.|true|false|true|40
SUSPENDED|Suspended|The Engagement is open but service is paused.|false|false|true|50
ENDED|Ended|The Engagement has ended. A projection of customer_engagements.ended_at, never an independent fact.|false|true|true|60$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'engagement_stage_types seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK engagement_stage_types seed rows (6 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$COMPLIANCE|Compliance|Regulatory and safety compliance services.|true|10
BUSINESS_INTELLIGENCE|Business intelligence|Reporting and insight services.|true|20
DECISION_SUPPORT|Decision support|Advisory and decision-support services.|true|30$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.product_levels) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.product_levels) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$COMPLIANCE|Compliance|Regulatory and safety compliance services.|true|10
BUSINESS_INTELLIGENCE|Business intelligence|Reporting and insight services.|true|20
DECISION_SUPPORT|Decision support|Advisory and decision-support services.|true|30$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'product_levels seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK product_levels seed rows (3 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(product_level_code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.service_catalogue) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(product_level_code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.service_catalogue) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'service_catalogue seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK service_catalogue seed rows (0 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$COMPLETED|Completed|The agreed work or term was completed.|true|10
CUSTOMER_TERMINATED|Ended by the Customer|The Customer ended the relationship.|true|20
TES_TERMINATED|Ended by TES|TES ended the relationship.|true|30
MUTUAL_AGREEMENT|Ended by mutual agreement|Both parties agreed to end the relationship.|true|40
ENTERED_IN_ERROR|Entered in error|The Engagement should never have been established. The row is kept as history.|true|50$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.engagement_end_reasons) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.engagement_end_reasons) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$COMPLETED|Completed|The agreed work or term was completed.|true|10
CUSTOMER_TERMINATED|Ended by the Customer|The Customer ended the relationship.|true|20
TES_TERMINATED|Ended by TES|TES ended the relationship.|true|30
MUTUAL_AGREEMENT|Ended by mutual agreement|Both parties agreed to end the relationship.|true|40
ENTERED_IN_ERROR|Entered in error|The Engagement should never have been established. The row is kept as history.|true|50$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'engagement_end_reasons seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK engagement_end_reasons seed rows (5 entries) match the design exactly';
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

  FOREACH tbl IN ARRAY ARRAY['engagement_types','engagement_stage_types','product_levels','service_catalogue','engagement_end_reasons','customer_engagement_stages','customer_engagement_terminations','engagement_service_scopes','engagement_responsibility_periods','customer_agreements','customer_agreement_versions','customer_engagements','customers'] LOOP
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

  -- the catalogues can never be written by the runtime identity
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid IN ('public.engagement_types'::regclass, 'public.engagement_stage_types'::regclass, 'public.product_levels'::regclass, 'public.service_catalogue'::regclass, 'public.engagement_end_reasons'::regclass)
               AND a.attnum > 0 AND NOT a.attisdropped
               AND (has_column_privilege(runtime_role, a.attrelid, a.attnum, 'INSERT')
                    OR has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'runtime can write a 0015 catalogue (changed only by migrations)';
  END IF;

  -- immutable Engagement / Customer identity: no content column is updatable
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = 'public.customers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
               AND has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE')) THEN
    RAISE EXCEPTION 'runtime can update customers';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = 'public.customer_engagements'::regclass AND a.attnum > 0 AND NOT a.attisdropped
               AND a.attname NOT IN ('ended_at', 'end_reason_code', 'updated_at')
               AND has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE')) THEN
    RAISE EXCEPTION 'runtime can update an Engagement column other than ended_at / end_reason_code / updated_at';
  END IF;

  -- the retired free-text reason is unwritable by the runtime; the termination audit rows are immutable (lifecycle columns only)
  IF has_column_privilege(runtime_role, 'public.customer_engagements', 'end_reason', 'INSERT')
     OR has_column_privilege(runtime_role, 'public.customer_engagements', 'end_reason', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime can write the retired free-text customer_engagements.end_reason';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = 'public.customer_engagement_terminations'::regclass AND a.attnum > 0 AND NOT a.attisdropped
               AND a.attname NOT IN ('record_status', 'corrected_at', 'superseded_by_id', 'updated_at')
               AND has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE')) THEN
    RAISE EXCEPTION 'runtime can rewrite a termination record beyond superseding it';
  END IF;

  IF migrator_role = runtime_role THEN RAISE EXCEPTION 'migrator and runtime identities are the same'; END IF;

  RAISE NOTICE 'OK runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; no PUBLIC privilege';
END
$verify$;

-- ============================================================
-- Post phase: no RLS / policies on these internal SYSTEM tables
-- ============================================================
DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM pg_class
             WHERE oid IN ('public.engagement_types'::regclass, 'public.engagement_stage_types'::regclass, 'public.product_levels'::regclass,
                           'public.service_catalogue'::regclass, 'public.engagement_end_reasons'::regclass, 'public.customer_engagement_stages'::regclass, 'public.customer_engagement_terminations'::regclass, 'public.engagement_service_scopes'::regclass,
                           'public.engagement_responsibility_periods'::regclass, 'public.customer_agreements'::regclass, 'public.customer_agreement_versions'::regclass,
                           'public.customer_engagements'::regclass, 'public.customers'::regclass)
               AND (relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policy
                WHERE polrelid IN ('public.engagement_types'::regclass, 'public.engagement_stage_types'::regclass, 'public.product_levels'::regclass,
                                   'public.service_catalogue'::regclass, 'public.engagement_end_reasons'::regclass, 'public.customer_engagement_stages'::regclass, 'public.customer_engagement_terminations'::regclass, 'public.engagement_service_scopes'::regclass,
                                   'public.engagement_responsibility_periods'::regclass, 'public.customer_agreements'::regclass, 'public.customer_agreement_versions'::regclass,
                                   'public.customer_engagements'::regclass, 'public.customers'::regclass)) THEN
    RAISE EXCEPTION 'RLS or a policy exists on a 0015 table (not part of the approved design)';
  END IF;
  RAISE NOTICE 'OK no RLS / policy on the internal Customer Relationship tables (visibility is enforced by the server)';
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
    IF (SELECT count(*) FROM public.customer_engagement_stages) <> 0
       OR (SELECT count(*) FROM public.customer_engagement_terminations) <> 0
       OR (SELECT count(*) FROM public.engagement_service_scopes) <> 0
       OR (SELECT count(*) FROM public.engagement_responsibility_periods) <> 0
       OR (SELECT count(*) FROM public.customer_agreements) <> 0
       OR (SELECT count(*) FROM public.customer_agreement_versions) <> 0
       OR (SELECT count(*) FROM public.service_catalogue) <> 0 THEN
      RAISE EXCEPTION 'a 0015 business table or the service catalogue is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id
               WHERE c.code IN ('CUSTOMER_RELATIONSHIP_READ', 'CUSTOMER_RELATIONSHIP_MANAGE')) THEN
      RAISE EXCEPTION 'a 0015 capability is granted to someone (0015 grants nothing; set TES_VERIFY_EXPECT_EMPTY=0 once grants are made deliberately)';
    END IF;
  END IF;

  -- every Engagement has a type
  SELECT count(*) INTO bad FROM public.customer_engagements WHERE engagement_type IS NULL;
  IF bad <> 0 THEN RAISE EXCEPTION '% Engagement(s) have no engagement type', bad; END IF;

  -- at most one Customer per Organization and one open Engagement per Customer
  SELECT count(*) INTO bad FROM (SELECT organization_id FROM public.customers GROUP BY organization_id HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Organization(s) have more than one Customer', bad; END IF;
  SELECT count(*) INTO bad FROM (SELECT customer_id FROM public.customer_engagements WHERE ended_at IS NULL GROUP BY customer_id HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Customer(s) have more than one open Engagement', bad; END IF;

  -- Engagements of one Customer do not overlap
  SELECT count(*) INTO bad FROM public.customer_engagements a JOIN public.customer_engagements b
    ON a.customer_id = b.customer_id AND a.id < b.id
   AND a.started_at < COALESCE(b.ended_at, 'infinity'::timestamptz) AND b.started_at < COALESCE(a.ended_at, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping Engagements of one Customer', bad; END IF;

  -- stage history: exactly one current stage, starts with the Engagement, contiguous
  SELECT count(*) INTO bad FROM public.customer_engagements e
  WHERE (SELECT count(*) FROM public.customer_engagement_stages s WHERE s.engagement_id = e.id AND s.record_status = 'active' AND s.effective_to IS NULL) <> 1;
  IF bad <> 0 THEN RAISE EXCEPTION '% Engagement(s) do not have exactly one current stage', bad; END IF;

  SELECT count(*) INTO bad FROM public.customer_engagements e
  WHERE (SELECT min(s.effective_from) FROM public.customer_engagement_stages s WHERE s.engagement_id = e.id AND s.record_status = 'active') IS DISTINCT FROM e.started_at;
  IF bad <> 0 THEN RAISE EXCEPTION '% Engagement(s) whose stage history does not begin when the Engagement began', bad; END IF;

  SELECT count(*) INTO bad FROM public.customer_engagement_stages s
  WHERE s.record_status = 'active' AND s.effective_to IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.customer_engagement_stages n WHERE n.engagement_id = s.engagement_id AND n.record_status = 'active' AND n.effective_from = s.effective_to);
  IF bad <> 0 THEN RAISE EXCEPTION '% stage row(s) are followed by a gap in the stage history', bad; END IF;

  SELECT count(*) INTO bad FROM public.customer_engagement_stages a JOIN public.customer_engagement_stages b
    ON a.engagement_id = b.engagement_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping stage periods', bad; END IF;

  -- ONE termination truth: ended_at <=> the current stage is ENDED starting exactly at ended_at
  SELECT count(*) INTO bad FROM public.customer_engagements e
  JOIN public.customer_engagement_stages s ON s.engagement_id = e.id AND s.record_status = 'active' AND s.effective_to IS NULL
  JOIN public.engagement_stage_types t ON t.code = s.stage_code
  WHERE (e.ended_at IS NULL AND t.is_terminal) OR (e.ended_at IS NOT NULL AND (NOT t.is_terminal OR s.effective_from <> e.ended_at));
  IF bad <> 0 THEN RAISE EXCEPTION '% Engagement(s) whose ended_at and ENDED stage disagree', bad; END IF;

  SELECT count(*) INTO bad FROM public.customer_engagement_stages s JOIN public.engagement_stage_types t ON t.code = s.stage_code
  WHERE s.record_status = 'active' AND t.is_terminal AND s.effective_to IS NOT NULL;
  IF bad <> 0 THEN RAISE EXCEPTION '% ended-stage row(s) have an end', bad; END IF;

  SELECT count(*) INTO bad FROM public.customer_engagement_stages s JOIN public.engagement_stage_types t ON t.code = s.stage_code
  WHERE (t.is_bounded AND s.planned_end_at IS NULL) OR (NOT t.is_bounded AND s.planned_end_at IS NOT NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% stage row(s) violate the bounded-stage rule', bad; END IF;

  -- termination: a structural reason exactly when ended, the retired free text unused, and the audit row mirrors the canonical columns
  SELECT count(*) INTO bad FROM public.customer_engagements
  WHERE (ended_at IS NULL) <> (end_reason_code IS NULL) OR end_reason IS NOT NULL;
  IF bad <> 0 THEN RAISE EXCEPTION '% Engagement(s) with an inconsistent or free-text end reason', bad; END IF;

  SELECT count(*) INTO bad FROM public.customer_engagements e
  WHERE (e.ended_at IS NULL AND EXISTS (SELECT 1 FROM public.customer_engagement_terminations t WHERE t.engagement_id = e.id AND t.record_status = 'active'))
     OR (e.ended_at IS NOT NULL AND (SELECT count(*) FROM public.customer_engagement_terminations t WHERE t.engagement_id = e.id AND t.record_status = 'active') <> 1)
     OR (e.ended_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customer_engagement_terminations t WHERE t.engagement_id = e.id AND t.record_status = 'active' AND t.ended_at = e.ended_at AND t.end_reason_code = e.end_reason_code));
  IF bad <> 0 THEN RAISE EXCEPTION '% Engagement(s) whose termination record does not mirror ended_at / end_reason_code', bad; END IF;

  SELECT count(*) INTO bad FROM public.customer_engagement_terminations t JOIN public.customer_engagements e ON e.id = t.engagement_id
  WHERE t.ended_at <= e.started_at OR (t.record_status = 'corrected' AND t.superseded_by_id IS NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% termination record(s) end before their Engagement or lack their replacement', bad; END IF;

  -- scopes: inside the Engagement, never overlapping for the same level / service
  SELECT count(*) INTO bad FROM public.engagement_service_scopes sc JOIN public.customer_engagements e ON e.id = sc.engagement_id
  WHERE sc.record_status = 'active'
    AND (sc.effective_from < e.started_at OR (e.ended_at IS NOT NULL AND (sc.effective_from >= e.ended_at OR sc.effective_to IS NULL OR sc.effective_to > e.ended_at)));
  IF bad <> 0 THEN RAISE EXCEPTION '% scope(s) fall outside their Engagement', bad; END IF;

  SELECT count(*) INTO bad FROM public.engagement_service_scopes a JOIN public.engagement_service_scopes b
    ON a.engagement_id = b.engagement_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.product_level_code = b.product_level_code AND (a.service_code IS NULL OR b.service_code IS NULL OR a.service_code = b.service_code)
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping scopes', bad; END IF;

  -- responsibility: inside its scope and Engagement, never before TES took over, never overlapping
  SELECT count(*) INTO bad FROM public.engagement_responsibility_periods r
  JOIN public.engagement_service_scopes sc ON sc.id = r.scope_id
  JOIN public.customer_engagements e ON e.id = r.engagement_id
  WHERE r.record_status = 'active'
    AND (sc.record_status <> 'active'
         OR r.effective_from < sc.effective_from OR r.effective_from < e.started_at
         OR (sc.effective_to IS NOT NULL AND (r.effective_to IS NULL OR r.effective_to > sc.effective_to))
         OR (e.ended_at IS NOT NULL AND (r.effective_from >= e.ended_at OR r.effective_to IS NULL OR r.effective_to > e.ended_at)));
  IF bad <> 0 THEN RAISE EXCEPTION '% responsibility window(s) fall outside their scope or Engagement', bad; END IF;

  SELECT count(*) INTO bad FROM public.engagement_responsibility_periods a JOIN public.engagement_responsibility_periods b
    ON a.scope_id = b.scope_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping responsibility windows', bad; END IF;

  -- agreements: at least one version, versions never overlap, scopes reference an agreement of their own Customer
  SELECT count(*) INTO bad FROM public.customer_agreements a
  WHERE NOT EXISTS (SELECT 1 FROM public.customer_agreement_versions v WHERE v.agreement_id = a.id AND v.record_status = 'active');
  IF bad <> 0 THEN RAISE EXCEPTION '% agreement(s) have no version', bad; END IF;

  SELECT count(*) INTO bad FROM public.customer_agreement_versions a JOIN public.customer_agreement_versions b
    ON a.agreement_id = b.agreement_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping agreement versions', bad; END IF;

  SELECT count(*) INTO bad FROM public.engagement_service_scopes sc
  JOIN public.customer_engagements e ON e.id = sc.engagement_id
  JOIN public.customer_agreements a ON a.id = sc.agreement_id
  WHERE a.customer_id <> e.customer_id;
  IF bad <> 0 THEN RAISE EXCEPTION '% scope(s) reference another Customer''s agreement', bad; END IF;

  -- corrected / voided rows were never ended and carry (or lack) a replacement as designed
  SELECT count(*) INTO bad FROM (
    SELECT id FROM public.customer_engagement_stages WHERE record_status = 'corrected' AND (superseded_by_id IS NULL)
    UNION ALL SELECT id FROM public.customer_engagement_terminations WHERE record_status = 'corrected' AND superseded_by_id IS NULL
    UNION ALL SELECT id FROM public.engagement_service_scopes WHERE (record_status = 'corrected' AND superseded_by_id IS NULL) OR (record_status = 'voided' AND superseded_by_id IS NOT NULL)
    UNION ALL SELECT id FROM public.engagement_responsibility_periods WHERE (record_status = 'corrected' AND superseded_by_id IS NULL) OR (record_status = 'voided' AND superseded_by_id IS NOT NULL)
    UNION ALL SELECT id FROM public.customer_agreement_versions WHERE (record_status = 'corrected' AND superseded_by_id IS NULL) OR (record_status = 'voided' AND superseded_by_id IS NOT NULL)
  ) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% corrected / voided row(s) lack or carry an unexpected replacement', bad; END IF;

  SELECT count(*) INTO bad FROM public.customer_agreements a
  WHERE a.record_status = 'archived'
    AND EXISTS (SELECT 1 FROM public.customer_agreement_versions v WHERE v.agreement_id = a.id AND v.record_status = 'active' AND v.effective_to IS NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% archived agreement(s) still have a current version', bad; END IF;

  RAISE NOTICE 'OK row conditions hold (customers=%, engagements=%, stages=%, scopes=%, responsibility windows=%, agreements=%, agreement versions=%)',
    (SELECT count(*) FROM public.customers),
    (SELECT count(*) FROM public.customer_engagements),
    (SELECT count(*) FROM public.customer_engagement_stages),
    (SELECT count(*) FROM public.engagement_service_scopes),
    (SELECT count(*) FROM public.engagement_responsibility_periods),
    (SELECT count(*) FROM public.customer_agreements),
    (SELECT count(*) FROM public.customer_agreement_versions);
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
    IF tbl IN ('engagement_types','engagement_stage_types','product_levels','service_catalogue','engagement_end_reasons','customer_engagement_stages','customer_engagement_terminations','engagement_service_scopes','engagement_responsibility_periods','customer_agreements','customer_agreement_versions') THEN
      RAISE EXCEPTION 'baseline list names a 0015 table: %', tbl;
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

echo "Production customer relationship (${PHASE}) verification passed."
