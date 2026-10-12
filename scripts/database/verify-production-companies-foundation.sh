#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for the Companies foundation migrations 0016-0019 and the Core Operational Identity additions
# 0025, 0026 and 0027:
#   0016 Tax / Registration, 0017 Insurance, 0018 Company Credentials, 0019 Company Operating Profile,
#   0025 Insurance scheduled vehicles (insurance_coverage_vehicles), 0026 Vehicle merge ledger (vehicle_merges),
#   0027 Organization access policies (POLICY-ONLY: widens the USING expression of organizations_system and
#        organization_person_relationships_system; creates no table, function, trigger, capability or seed row).
# Migrations 0020-0024 (Core Operational Identity, system-wide RLS closure) are verified by their own scripts; they are not
# selectable here, but their objects are known to the expectations, so a run THROUGH 0025 / 0026 / 0027 verifies the full current
# catalogue (relations, tes_security functions, SECURITY DEFINER functions, capabilities) exactly.
#
# ONE shared script verifies the whole pending batch or any contiguous slice of it. Each migration stays independently
# identifiable: it has its own expectation fragment (scripts/database/verification/companies/NNNN.sql), its own ledger
# check and its own section labels in the log.
#
# The whole check runs in a READ ONLY transaction: it performs no INSERT, UPDATE, DELETE, DDL or temp-table creation and
# ends with ROLLBACK. Runtime privileges are verified through catalog functions and ACLs, not by switching roles.
#
# TES_VERIFY_FROM     first migration of the batch under verification (default 0025)
# TES_VERIFY_THROUGH  last migration of the batch under verification (default 0027)
#                     Each of the two is one of 0016 0017 0018 0019 0025 0026 0027.
#
# TES_VERIFY_PHASE=pre   Before the batch is applied: the ledger holds EXACTLY the repository's checksums for every migration
#                        below FROM (so 0001-0015 are unchanged) and nothing at or above FROM; none of the tables, trigger
#                        functions or capabilities of FROM..THROUGH exists; for 0027 the complete policy sets of public.organizations
#                        and public.organization_person_relationships are EXACTLY the 0024 definitions; baseline row counts are logged.
# TES_VERIFY_PHASE=post  After the batch is applied (default): the ledger holds exactly 0001..THROUGH with the repository
#                        checksums; for each migration in FROM..THROUGH its tables exist with exactly the designed columns,
#                        constraints, indexes, triggers (with arguments) and trigger functions (SECURITY INVOKER, fixed
#                        search_path, body checksum, no PUBLIC execute); seed catalogues hold exactly their rows; owners, table
#                        and column ACLs are exactly the designed grants (no DELETE, TRUNCATE, PUBLIC privilege or catalogue
#                        write); 0016-0019 enable no RLS and have no policy (checked while THROUGH < 0020; the RLS closure of
#                        0024 is verified by its own script), whereas 0025 / 0026 tables have RLS enabled (not forced) and
#                        exactly the designed policies; 0027 (policy-only) has no table of its own: the complete policy set of the two
#                        tables it alters is exact (post-0027 USING, unchanged WITH CHECK, no extra or missing policy) and RLS is
#                        enabled (not forced) on both; the SECURITY DEFINER function set and the capability catalogue are
#                        exactly the approved set through THROUGH (full rows; only 0025's guard_insurance_schedule_vehicle is
#                        SECURITY DEFINER among these migrations); nothing is granted to anyone; and the data satisfies the
#                        invariants the schema is meant to guarantee.
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

FROM="${TES_VERIFY_FROM:-0025}"
THROUGH="${TES_VERIFY_THROUGH:-0027}"
for value in "$FROM" "$THROUGH"; do
  case "$value" in
    0016|0017|0018|0019|0025|0026|0027) ;;
    *) echo "TES_VERIFY_FROM / TES_VERIFY_THROUGH must each be one of 0016 0017 0018 0019 0025 0026 0027." >&2; exit 1 ;;
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
  [0025]="0025_insurance_scheduled_vehicles_foundation.sql"
  [0026]="0026_vehicle_merge_ledger.sql"
  [0027]="0027_operational_identity_organization_access_policies.sql"
)
# The only tables a migration may INSERT into (catalogue seeds; capabilities are always allowed).
declare -A SEED_TABLES=(
  [0016]="registration_programs"
  [0017]="insurance_coverage_types"
  [0018]="credential_categories"
  [0019]="company_profile_rules"
  [0025]="-"
  [0026]="-"
  [0027]="-"
)
# The only table a migration may ENABLE ROW LEVEL SECURITY on / create policies for (0016-0019: none).
declare -A RLS_TABLE=(
  [0025]="insurance_coverage_vehicles"
  [0026]="vehicle_merges"
)
# Expected number of SECURITY DEFINER functions per migration, and the one allowed (0016-0019, 0026: none).
declare -A DEFINER_FUNCTION=(
  [0025]="guard_insurance_schedule_vehicle"
)

selected=()
for version in 0016 0017 0018 0019 0025 0026 0027; do
  if [[ ! "$version" < "$FROM" && ! "$version" > "$THROUGH" ]]; then
    selected+=("$version")
  fi
done

# Every selected migration must stay additive: no destructive or data-changing statement except its catalogue seeds and
# capability rows, no ALTER of an existing object, no DELETE / TRUNCATE / ALL grant, no tenant context, capability grant, or
# structure outside the approved domain.
# 0027 is policy-only and is checked separately below (exactly two ALTER POLICY ... USING statements, nothing else).
# 0016-0019 additionally contain no SECURITY DEFINER, RLS or policy at all. 0025 and 0026 enable RLS on their own table and add
# its policies (nothing else is allowed to ALTER anything), and 0025 alone has exactly one SECURITY DEFINER function.
for version in "${selected[@]}"; do
  file="$MIGRATIONS_DIR/${MIGRATION_FILE[$version]}"
  if [[ ! -f "$file" ]]; then
    echo "Repository migration $version not found: $file" >&2
    exit 1
  fi
  sql_only="$(grep -Ev '^[[:space:]]*--' "$file")"

  if [[ "$version" == "0027" ]]; then
    # Policy-only: exactly one single-line ALTER POLICY ... USING (...) per policy, on the two approved policies, calling only
    # tes_security.system_context_authorized(ARRAY[...]); every other statement (and any WITH CHECK, DROP, UPDATE, DELETE,
    # INSERT, CREATE, GRANT, other ALTER, SECURITY DEFINER) is forbidden.
    statements="$(grep -Ev '^[[:space:]]*$' <<<"$sql_only" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/; /;\n/g')"
    expected_statements=2
    if [[ "$(grep -c '' <<<"$statements")" != "$expected_statements" ]]; then
      echo "Migration 0027 must contain exactly $expected_statements statements." >&2
      exit 1
    fi
    system_helper="tes_security\.system_context_authorized\(ARRAY\[('[A-Z_]+')(,'[A-Z_]+')*\]\)"
    organizations_policy="^ALTER POLICY organizations_system ON public\.organizations USING \(${system_helper}\);\$"
    relationships_policy="^ALTER POLICY organization_person_relationships_system ON public\.organization_person_relationships USING \(${system_helper}\);\$"
    if [[ "$(grep -Ec "$organizations_policy" <<<"$statements")" != "1" ]] || [[ "$(grep -Ec "$relationships_policy" <<<"$statements")" != "1" ]]; then
      echo "Migration 0027 must contain exactly one ALTER POLICY ... USING for organizations_system and one for organization_person_relationships_system, and nothing else." >&2
      exit 1
    fi
    # capability codes such as ORGANIZATION_CREATE live inside quoted literals: scan with the literals removed
    if sed -E "s/'[^']*'//g" <<<"$sql_only" | grep -Eiq '\b(WITH[[:space:]]+CHECK|SECURITY[[:space:]]+DEFINER|DROP|UPDATE|DELETE|INSERT|CREATE|GRANT|REVOKE|TRUNCATE|set_config|relationship_capability_grants|relationship_assignments|actor_relationships)\b'; then
      echo "Migration 0027 contains a statement or clause other than the two ALTER POLICY ... USING statements." >&2
      exit 1
    fi
    continue
  fi
  rls_table="${RLS_TABLE[$version]:-}"
  definer_function="${DEFINER_FUNCTION[$version]:-}"

  # The only statements lifted out of the strict scans below: ENABLE ROW LEVEL SECURITY and single-line CREATE POLICY on the
  # migration's own table.
  checked_sql="$sql_only"
  if [[ -n "$rls_table" ]]; then
    checked_sql="$(grep -Ev "^ALTER TABLE public\.${rls_table} ENABLE ROW LEVEL SECURITY;\$" <<<"$sql_only" || true)"
    policy_lines="$(grep -E "^CREATE POLICY [a-z_0-9]+ ON public\.${rls_table} FOR (ALL|SELECT) USING \(.*\);\$" <<<"$checked_sql" || true)"
    checked_sql="$(grep -Ev "^CREATE POLICY [a-z_0-9]+ ON public\.${rls_table} FOR (ALL|SELECT) USING \(.*\);\$" <<<"$checked_sql" || true)"
    if [[ -z "$policy_lines" ]] || ! grep -Eq "^ALTER TABLE public\.${rls_table} ENABLE ROW LEVEL SECURITY;\$" <<<"$sql_only"; then
      echo "Migration $version must enable RLS on public.${rls_table} and create its policies." >&2
      exit 1
    fi
    # Policies may call only the approved context helpers and read the customer's Organization.
    if grep -Eio '(tes_security|public)\.[a-z_0-9]+\(' <<<"$policy_lines" | grep -Eivq '^tes_security\.(system_context_authorized|customer_context_authorized|current_customer_id)\($'; then
      echo "Migration $version has a policy that calls something other than the approved context helpers." >&2
      exit 1
    fi
  fi

  if grep -Eiq '^[[:space:]]*(DROP|TRUNCATE|DELETE|UPDATE|ALTER)[[:space:]]' <<<"$checked_sql"; then
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
  if grep -Eiq 'ROW[[:space:]]+LEVEL[[:space:]]+SECURITY|CREATE[[:space:]]+POLICY|current_customer_id|system_context_authorized|customer_context_authorized' <<<"$checked_sql"; then
    echo "Migration $version contains RLS, a policy or a tenant-context call outside the approved statements." >&2
    exit 1
  fi
  if grep -Eiq 'relationship_capability_grants|relationship_assignments|actor_relationships|set_config' <<<"$sql_only"; then
    echo "Migration $version contains a structure outside the approved design." >&2
    exit 1
  fi
  # SECURITY DEFINER: none, except the single designed function (the CREATE FUNCTION header it belongs to is checked).
  definers="$(awk 'tolower($0) ~ /^create function / {fn=$3} tolower($0) ~ /security[[:space:]]+definer/ {print fn}' <<<"$sql_only")"
  if [[ -z "$definer_function" ]]; then
    if [[ -n "$definers" ]] || grep -Eiq 'SECURITY[[:space:]]+DEFINER' <<<"$sql_only"; then
      echo "Migration $version contains a SECURITY DEFINER function." >&2
      exit 1
    fi
  else
    if [[ "$definers" != "tes_security.${definer_function}()" ]] || [[ "$(grep -Eic 'SECURITY[[:space:]]+DEFINER' <<<"$sql_only")" != "1" ]]; then
      echo "Migration $version must contain exactly one SECURITY DEFINER function: tes_security.${definer_function}()." >&2
      exit 1
    fi
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
