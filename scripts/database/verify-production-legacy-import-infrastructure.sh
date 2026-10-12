#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0029 (legacy import infrastructure).
#
# The check runs in a READ ONLY transaction. It performs no INSERT, UPDATE,
# DELETE, DDL, temp-table creation, import work, or browser cleanup.
#
# TES_VERIFY_PHASE=pre  checks production is still at 0028 and has no 0029 objects.
# TES_VERIFY_PHASE=post checks 0029 is applied and the import infrastructure is present.

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-database/migrations}"
MIGRATION_0029="$MIGRATIONS_DIR/0029_canonical_data_cutover_import_infrastructure.sql"
PHASE="${TES_VERIFY_PHASE:-post}"

if [[ "$PHASE" != "pre" && "$PHASE" != "post" ]]; then
  echo "TES_VERIFY_PHASE must be pre or post; got: $PHASE" >&2
  exit 1
fi

if [[ ! -f "$MIGRATION_0029" ]]; then
  echo "Repository migration 0029 not found: $MIGRATION_0029" >&2
  exit 1
fi

sql_only="$(grep -Ev '^[[:space:]]*--' "$MIGRATION_0029")"
if grep -Eiq '^[[:space:]]*(DELETE|TRUNCATE|DROP)[[:space:]]' <<<"$sql_only"; then
  echo "Migration 0029 contains a destructive statement." >&2
  exit 1
fi
if grep -Eiq 'INSERT[[:space:]]+INTO[[:space:]]+public\.(organizations|customers|vehicles|persons|operating_authorities|tax_registrations|insurance_policies|company_credentials|master_register_events)\b' <<<"$sql_only"; then
  echo "Migration 0029 writes canonical business data." >&2
  exit 1
fi

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
  --set=manifest="$manifest" \
  --set=phase="$PHASE" <<'SQL'
BEGIN READ ONLY;

SELECT set_config('tes.verify_manifest', :'manifest', true);
SELECT set_config('tes.verify_phase', :'phase', true);

DO $verify$
DECLARE
  manifest text := current_setting('tes.verify_manifest');
  phase text := current_setting('tes.verify_phase');
  upper_bound text := CASE WHEN phase = 'pre' THEN '0028' ELSE '0029' END;
  missing text;
  unexpected text;
BEGIN
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
    WHERE version <= upper_bound
    EXCEPT
    SELECT split_part(e, ':', 1), split_part(e, ':', 2)
    FROM unnest(string_to_array(manifest, ',')) AS e
    WHERE split_part(e, ':', 1) <= upper_bound
  ) d;
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'ledger contains unexpected migration(s) at or below %: %', upper_bound, unexpected;
  END IF;

  IF phase = 'pre' AND EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version >= '0029') THEN
    RAISE EXCEPTION 'pre phase expected production before 0029, but ledger already contains 0029 or later';
  END IF;
  IF phase = 'post' AND NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0029') THEN
    RAISE EXCEPTION 'post phase expected migration 0029 to be applied';
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums through % for phase %', upper_bound, phase;
END
$verify$;

DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  table_name text;
  present text;
BEGIN
  IF phase = 'pre' THEN
    SELECT string_agg(expected.object_name, ',' ORDER BY expected.object_name) INTO present
    FROM (VALUES
      ('legacy_import_batches'),
      ('legacy_canonical_record_map'),
      ('legacy_import_records'),
      ('legacy_import_checkpoints'),
      ('legacy_import_review_decisions')
    ) AS expected(object_name)
    WHERE to_regclass('public.' || expected.object_name) IS NOT NULL;
    IF present IS NOT NULL THEN
      RAISE EXCEPTION 'pre phase found 0029 table(s) already present: %', present;
    END IF;

    IF to_regprocedure('tes_security.prevent_legacy_import_delete_or_truncate()') IS NOT NULL THEN
      RAISE EXCEPTION 'pre phase found 0029 trigger function already present';
    END IF;

    IF EXISTS (SELECT 1 FROM public.capabilities WHERE code IN ('LEGACY_IMPORT_READ', 'LEGACY_IMPORT_MANAGE')) THEN
      RAISE EXCEPTION 'pre phase found 0029 capability row(s) already present';
    END IF;

    RAISE NOTICE 'OK pre phase: 0029 legacy import objects are absent';
    RETURN;
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'legacy_import_batches',
    'legacy_canonical_record_map',
    'legacy_import_records',
    'legacy_import_checkpoints',
    'legacy_import_review_decisions'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'missing 0029 table: %', table_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on %', table_name;
    END IF;
  END LOOP;

  IF to_regprocedure('tes_security.prevent_legacy_import_delete_or_truncate()') IS NULL THEN
    RAISE EXCEPTION 'missing no-delete/no-truncate trigger function';
  END IF;

  RAISE NOTICE 'OK 0029 tables, RLS, and immutable import trigger function exist';
END
$verify$;

DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  missing text;
BEGIN
  IF phase = 'pre' THEN
    RETURN;
  END IF;

  SELECT string_agg(capability_code, ',' ORDER BY capability_code) INTO missing
  FROM (VALUES ('LEGACY_IMPORT_READ'), ('LEGACY_IMPORT_MANAGE')) AS expected(capability_code)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.capabilities c WHERE c.code = expected.capability_code
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing capability row(s): %', missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN (
        'legacy_import_batches',
        'legacy_canonical_record_map',
        'legacy_import_records',
        'legacy_import_checkpoints',
        'legacy_import_review_decisions'
      )
      AND privilege_type IN ('DELETE', 'TRUNCATE')
      AND grantee <> current_user
  ) THEN
    RAISE EXCEPTION 'legacy import table has DELETE or TRUNCATE privilege';
  END IF;

  RAISE NOTICE 'OK capabilities exist and destructive privileges are absent';
END
$verify$;

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

ROLLBACK;
SQL
