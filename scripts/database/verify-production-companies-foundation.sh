#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for the Companies foundation migrations 0016-0019:
#   0016 Tax / Registration, 0017 Insurance, 0018 Company Credentials, 0019 Company Operating Profile.
#
# ONE shared script verifies the whole pending batch or any contiguous slice of it. Each migration stays independently
# identifiable: it has its own expectation fragment (scripts/database/verification/companies/NNNN.sql), its own ledger
# check and its own section labels in the log.
#
# The whole check runs in a READ ONLY transaction: it performs no INSERT, UPDATE, DELETE, DDL or temp-table creation and
# ends with ROLLBACK. Runtime privileges are verified through catalog functions and ACLs, not by switching roles.
#
# TES_VERIFY_FROM     first migration of the batch under verification (default 0016)
# TES_VERIFY_THROUGH  last migration of the batch under verification (default 0019)
#
# TES_VERIFY_PHASE=pre   Before the batch is applied: the ledger holds EXACTLY the repository's checksums for every migration
#                        below FROM (so 0001-0015 are unchanged) and nothing at or above FROM; none of the tables, trigger
#                        functions or capabilities of FROM..THROUGH exists; baseline row counts are logged.
# TES_VERIFY_PHASE=post  After the batch is applied (default): the ledger holds exactly 0001..THROUGH with the repository
#                        checksums; for each migration in FROM..THROUGH its tables exist with exactly the designed columns,
#                        constraints, indexes, triggers (with arguments) and trigger functions (SECURITY INVOKER, fixed
#                        search_path, body checksum, no PUBLIC execute); seed catalogues hold exactly their rows; owners, table
#                        and column ACLs are exactly the designed grants (no DELETE, TRUNCATE, PUBLIC privilege or catalogue
#                        write); there is no RLS or policy; no SECURITY DEFINER function exists; the capability catalogue is
#                        exactly the approved set through THROUGH (full rows); nothing is granted to anyone; and the data
#                        satisfies the invariants the schema is meant to guarantee.
#
# TES_VERIFY_EXPECT_EMPTY=1 (default) additionally requires every business table of the batch to hold ZERO rows and no new
# capability to be granted, the expected state immediately after the migrations. Use 0 for a later verification of a live
# system; the invariant checks still run.
#
# TES_VERIFY_BASELINE_COUNTS (optional, post phase) is a comma-separated list of table=count pairs captured from the PRE run's
# ROWCOUNT lines; every listed table must still hold exactly that many rows, proving baseline data is unchanged.
#
# The expected catalogue was generated from a database migrated with the repository migration files, using the same
# queries as run here, by scripts/database/verification/companies/generate-expectations.py, and is compared EXACTLY.
# Representation differences between PostgreSQL versions (local 16 vs production 17) are neutralised by comparing structured
# catalog fields and whitespace-normalised definitions.

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

PHASE="${TES_VERIFY_PHASE:-post}"
case "$PHASE" in
  pre|post) ;;
  *) echo "TES_VERIFY_PHASE must be 'pre' or 'post'." >&2; exit 1 ;;
esac

FROM="${TES_VERIFY_FROM:-0016}"
THROUGH="${TES_VERIFY_THROUGH:-0019}"
for value in "$FROM" "$THROUGH"; do
  case "$value" in
    0016|0017|0018|0019) ;;
    *) echo "TES_VERIFY_FROM / TES_VERIFY_THROUGH must each be one of 0016 0017 0018 0019." >&2; exit 1 ;;
  esac
done
if [[ "$FROM" > "$THROUGH" ]]; then
  echo "TES_VERIFY_FROM must not be greater than TES_VERIFY_THROUGH." >&2
  exit 1
fi

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
FRAGMENTS_DIR="${FRAGMENTS_DIR:-scripts/database/verification/companies}"

declare -A MIGRATION_FILE=(
  [0016]="0016_tax_registration_foundation.sql"
  [0017]="0017_insurance_foundation.sql"
  [0018]="0018_company_credentials_foundation.sql"
  [0019]="0019_company_operating_profile_foundation.sql"
)
# The only tables a migration may INSERT into (catalogue seeds; capabilities are always allowed).
declare -A SEED_TABLES=(
  [0016]="registration_programs"
  [0017]="insurance_coverage_types"
  [0018]="credential_categories"
  [0019]="company_profile_rules"
)

selected=()
for version in 0016 0017 0018 0019; do
  if [[ ! "$version" < "$FROM" && ! "$version" > "$THROUGH" ]]; then
    selected+=("$version")
  fi
done

# Every selected migration must stay additive: no destructive or data-changing statement except its catalogue seeds and
# capability rows, no ALTER of an existing object, no DELETE / TRUNCATE / ALL grant, no SECURITY DEFINER, RLS, tenant context,
# capability grant, or structure outside the approved domain.
for version in "${selected[@]}"; do
  file="$MIGRATIONS_DIR/${MIGRATION_FILE[$version]}"
  if [[ ! -f "$file" ]]; then
    echo "Repository migration $version not found: $file" >&2
    exit 1
  fi
  sql_only="$(grep -Ev '^[[:space:]]*--' "$file")"
  if grep -Eiq '^[[:space:]]*(DROP|TRUNCATE|DELETE|UPDATE|ALTER)[[:space:]]' <<<"$sql_only"; then
    echo "Migration $version contains a destructive, altering or data-changing statement." >&2
    exit 1
  fi
  allowed="capabilities|${SEED_TABLES[$version]}"
  if grep -Ei '^[[:space:]]*INSERT[[:space:]]' <<<"$sql_only" | grep -Eivq "INSERT[[:space:]]+INTO[[:space:]]+public\.(${allowed})([[:space:]]|\$)"; then
    echo "Migration $version inserts into a table other than its catalogue / capabilities." >&2
    exit 1
  fi
  if grep -Eiq 'GRANT[^;]*(DELETE|TRUNCATE|ALL)' <<<"$sql_only"; then
    echo "Migration $version grants DELETE, TRUNCATE or ALL." >&2
    exit 1
  fi
  if grep -Eiq 'SECURITY[[:space:]]+DEFINER|ROW[[:space:]]+LEVEL[[:space:]]+SECURITY|CREATE[[:space:]]+POLICY|relationship_capability_grants|relationship_assignments|actor_relationships|set_config|current_customer_id' <<<"$sql_only"; then
    echo "Migration $version contains a structure outside the approved design." >&2
    exit 1
  fi
done

# Repository manifest: version:sha256 for every migration file.
manifest=""
for path in "$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$path")"
  version="${base%%_*}"
  checksum="$(sha256sum "$path" | awk '{print $1}')"
  manifest+="${version}:${checksum},"
done
manifest="${manifest%,}"

sql_file="$(mktemp)"
trap 'rm -f "$sql_file"' EXIT

cat > "$sql_file" <<'SQL'
BEGIN READ ONLY;

SELECT set_config('tes.verify_phase', :'phase', true),
       set_config('tes.verify_from', :'from_version', true),
       set_config('tes.verify_through', :'through_version', true),
       set_config('tes.verify_expect_empty', :'expect_empty', true),
       set_config('tes.verify_baseline', :'baseline', true),
       set_config('tes.verify_manifest', :'manifest', true);

-- ============================================================
-- Ledger vs repository: every migration below FROM (0001-0015 at least) byte-for-byte unchanged and present; in the post
-- phase every migration through THROUGH present with the repository checksum and nothing beyond.
-- ============================================================
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  from_version text := current_setting('tes.verify_from');
  through_version text := current_setting('tes.verify_through');
  manifest text := current_setting('tes.verify_manifest');
  upper_bound text;
  missing text;
  unexpected text;
BEGIN
  upper_bound := CASE WHEN phase = 'pre' THEN (SELECT max(split_part(e, ':', 1)) FROM unnest(string_to_array(manifest, ',')) AS e WHERE split_part(e, ':', 1) < from_version) ELSE through_version END;

  SELECT string_agg(version, ',' ORDER BY version) INTO missing
  FROM (
    SELECT split_part(e, ':', 1) AS version, split_part(e, ':', 2) AS sha
    FROM unnest(string_to_array(manifest, ',')) AS e
    WHERE split_part(e, ':', 1) <= upper_bound
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
    WHERE split_part(e, ':', 1) <= upper_bound
  ) d;
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'ledger contains migration(s) the repository does not expect for phase % (through %): %', phase, upper_bound, unexpected;
  END IF;

  IF (SELECT count(*) FROM tes_system.schema_migrations WHERE version <= '0015') <> 15 THEN
    RAISE EXCEPTION 'the ledger does not hold exactly migrations 0001-0015 at or below 0015';
  END IF;
  IF (SELECT count(*) FROM tes_system.schema_migrations) <> upper_bound::integer THEN
    RAISE EXCEPTION 'the ledger does not hold exactly % contiguous migrations', upper_bound::integer;
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums for phase % (% migrations through %; 0001-0015 unchanged)',
    phase, (SELECT count(*) FROM tes_system.schema_migrations), upper_bound;
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
SQL

for version in "${selected[@]}"; do
  fragment="$FRAGMENTS_DIR/$version.sql"
  if [[ ! -f "$fragment" ]]; then
    echo "Verification fragment for $version not found: $fragment" >&2
    exit 1
  fi
  cat "$fragment" >> "$sql_file"
done
cat "$FRAGMENTS_DIR/baseline.sql" >> "$sql_file"

cat >> "$sql_file" <<'SQL'

ROLLBACK;

SELECT current_setting('server_version') AS server_version,
       (SELECT count(*) FROM tes_system.schema_migrations) AS applied_migrations,
       (SELECT count(*) FROM public.capabilities) AS capabilities;
SQL

psql \
  --no-password \
  --set=ON_ERROR_STOP=1 \
  --set=phase="$PHASE" \
  --set=from_version="$FROM" \
  --set=through_version="$THROUGH" \
  --set=expect_empty="$EXPECT_EMPTY" \
  --set=baseline="$BASELINE_COUNTS" \
  --set=manifest="$manifest" \
  --file="$sql_file"

echo "Production Companies foundation (${PHASE}, ${FROM}..${THROUGH}) verification passed."
