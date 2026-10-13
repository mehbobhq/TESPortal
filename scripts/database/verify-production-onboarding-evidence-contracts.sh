#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0030 (onboarding evidence, readiness,
# customer authority roles, and contracts foundation).
#
# TES_VERIFY_PHASE=pre  checks production is still at 0029 and has no 0030 objects.
# TES_VERIFY_PHASE=post checks 0030 is applied and the foundation is present.

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-database/migrations}"
MIGRATION_0030="$MIGRATIONS_DIR/0030_onboarding_evidence_contracts_foundation.sql"
PHASE="${TES_VERIFY_PHASE:-post}"

if [[ "$PHASE" != "pre" && "$PHASE" != "post" ]]; then
  echo "TES_VERIFY_PHASE must be pre or post; got: $PHASE" >&2
  exit 1
fi

if [[ ! -f "$MIGRATION_0030" ]]; then
  echo "Repository migration 0030 not found: $MIGRATION_0030" >&2
  exit 1
fi

sql_only="$(grep -Ev '^[[:space:]]*--' "$MIGRATION_0030")"
if grep -Eiq '^[[:space:]]*(DELETE|TRUNCATE|DROP)[[:space:]]' <<<"$sql_only"; then
  echo "Migration 0030 contains a destructive statement." >&2
  exit 1
fi
if grep -Eiq 'INSERT[[:space:]]+INTO[[:space:]]+public\.(organizations|customers|customer_engagements|vehicles|persons|operating_authorities|registrations|insurance_policies|company_credentials|master_register_events)\b' <<<"$sql_only"; then
  echo "Migration 0030 writes existing canonical business data." >&2
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
  upper_bound text := CASE WHEN phase = 'pre' THEN '0029' ELSE '0030' END;
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

  IF phase = 'pre' AND EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version >= '0030') THEN
    RAISE EXCEPTION 'pre phase expected production before 0030, but ledger already contains 0030 or later';
  END IF;
  IF phase = 'post' AND NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0030') THEN
    RAISE EXCEPTION 'post phase expected migration 0030 to be applied';
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums through % for phase %', upper_bound, phase;
END
$verify$;

DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  table_name text;
  present text;
  missing text;
BEGIN
  IF phase = 'pre' THEN
    SELECT string_agg(expected.object_name, ',' ORDER BY expected.object_name) INTO present
    FROM (VALUES
      ('evidence_documents'),
      ('evidence_links'),
      ('onboarding_evidence_requirements'),
      ('onboarding_readiness_snapshots'),
      ('customer_authority_assignments'),
      ('customer_contracts'),
      ('customer_contract_line_items')
    ) AS expected(object_name)
    WHERE to_regclass('public.' || expected.object_name) IS NOT NULL;
    IF present IS NOT NULL THEN
      RAISE EXCEPTION 'pre phase found 0030 table(s) already present: %', present;
    END IF;

    IF to_regprocedure('tes_security.prevent_onboarding_foundation_delete_or_truncate()') IS NOT NULL THEN
      RAISE EXCEPTION 'pre phase found 0030 trigger function already present';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.capabilities
      WHERE code IN ('EVIDENCE_READ', 'EVIDENCE_MANAGE', 'CONTRACT_READ', 'CONTRACT_MANAGE')
    ) THEN
      RAISE EXCEPTION 'pre phase found 0030 capability row(s) already present';
    END IF;

    RAISE NOTICE 'OK pre phase: 0030 onboarding/evidence/contract objects are absent';
    RETURN;
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'evidence_documents',
    'evidence_links',
    'onboarding_evidence_requirements',
    'onboarding_readiness_snapshots',
    'customer_authority_assignments',
    'customer_contracts',
    'customer_contract_line_items'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'missing 0030 table: %', table_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on %', table_name;
    END IF;
  END LOOP;

  IF to_regprocedure('tes_security.prevent_onboarding_foundation_delete_or_truncate()') IS NULL THEN
    RAISE EXCEPTION 'missing no-delete/no-truncate trigger function';
  END IF;

  SELECT string_agg(capability_code, ',' ORDER BY capability_code) INTO missing
  FROM (VALUES ('EVIDENCE_READ'), ('EVIDENCE_MANAGE'), ('CONTRACT_READ'), ('CONTRACT_MANAGE')) AS expected(capability_code)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.capabilities c
    WHERE c.code = expected.capability_code AND c.is_active
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing active capability row(s): %', missing;
  END IF;

  RAISE NOTICE 'OK 0030 tables, RLS, trigger function, and capabilities exist';
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

  SELECT string_agg(policy_name, ',' ORDER BY policy_name) INTO missing
  FROM (VALUES
    ('evidence_documents_system_read'),
    ('evidence_documents_system_insert'),
    ('evidence_documents_system_update'),
    ('evidence_links_system_read'),
    ('evidence_links_system_insert'),
    ('evidence_links_system_update'),
    ('onboarding_evidence_requirements_system_read'),
    ('onboarding_evidence_requirements_system_insert'),
    ('onboarding_evidence_requirements_system_update'),
    ('onboarding_readiness_snapshots_system_read'),
    ('onboarding_readiness_snapshots_system_insert'),
    ('customer_authority_assignments_system_read'),
    ('customer_authority_assignments_system_insert'),
    ('customer_authority_assignments_system_update'),
    ('customer_contracts_system_read'),
    ('customer_contracts_system_insert'),
    ('customer_contracts_system_update'),
    ('customer_contract_line_items_system_read'),
    ('customer_contract_line_items_system_insert'),
    ('customer_contract_line_items_system_update')
  ) AS expected(policy_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.policyname = expected.policy_name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing policy/policies: %', missing;
  END IF;

  RAISE NOTICE 'OK 0030 RLS policy catalogue exists';
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

  SELECT string_agg(table_name, ',' ORDER BY table_name) INTO missing
  FROM (VALUES
    ('evidence_documents'),
    ('evidence_links'),
    ('onboarding_evidence_requirements'),
    ('onboarding_readiness_snapshots'),
    ('customer_authority_assignments'),
    ('customer_contracts'),
    ('customer_contract_line_items')
  ) AS expected(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name = expected.table_name
      AND g.grantee = 'tes-backend@tes-production-510007.iam'
      AND g.privilege_type = 'SELECT'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'runtime role lacks SELECT on table(s): %', missing;
  END IF;

  SELECT string_agg(index_name, ',' ORDER BY index_name) INTO missing
  FROM (VALUES
    ('evidence_documents_gcs_object_uq'),
    ('evidence_links_active_target_uq'),
    ('onboarding_evidence_requirements_current_uq'),
    ('customer_authority_assignments_one_active_uq'),
    ('customer_contract_line_items_scope_uq')
  ) AS expected(index_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_indexes i
    WHERE i.schemaname = 'public' AND i.indexname = expected.index_name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing uniqueness/index contract(s): %', missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE grantee = 'tes-backend@tes-production-510007.iam'
      AND table_schema = 'public'
      AND table_name IN (
        'evidence_documents',
        'evidence_links',
        'onboarding_evidence_requirements',
        'onboarding_readiness_snapshots',
        'customer_authority_assignments',
        'customer_contracts',
        'customer_contract_line_items'
      )
      AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) THEN
    RAISE EXCEPTION 'runtime role has forbidden destructive/ownership-adjacent grants on 0030 table(s)';
  END IF;

  RAISE NOTICE 'OK 0030 grants and uniqueness contracts are present';
END
$verify$;

COMMIT;
SQL

echo "Onboarding evidence/contracts production verification (${PHASE}) passed."
