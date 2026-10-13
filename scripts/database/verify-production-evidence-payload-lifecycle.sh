#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0032 (evidence payload lifecycle: GCS-backed document payload metadata, the secure-view
# access ledger, and the database guards that bind evidence verification to a stored, hash-verified payload).
#
# TES_VERIFY_PHASE=pre  checks production is still at 0031 and has no 0032 object.
# TES_VERIFY_PHASE=post checks 0032 is applied and every table, policy, grant, constraint, index and trigger is present.
#
# The script only ever reads (BEGIN READ ONLY). It never applies, repairs or alters anything, and it never reads a payload.
# It cannot see storage: bucket configuration is checked by scripts/storage/verify-evidence-storage-config.mjs.

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-database/migrations}"
MIGRATION_0032="$MIGRATIONS_DIR/0032_evidence_payload_lifecycle.sql"
PHASE="${TES_VERIFY_PHASE:-post}"

if [[ "$PHASE" != "pre" && "$PHASE" != "post" ]]; then
  echo "TES_VERIFY_PHASE must be pre or post; got: $PHASE" >&2
  exit 1
fi

if [[ ! -f "$MIGRATION_0032" ]]; then
  echo "Repository migration 0032 not found: $MIGRATION_0032" >&2
  exit 1
fi

sql_only="$(grep -Ev '^[[:space:]]*--' "$MIGRATION_0032")"
if grep -Eiq '^[[:space:]]*(DELETE|TRUNCATE|DROP|UPDATE)[[:space:]]' <<<"$sql_only"; then
  echo "Migration 0032 contains a destructive or data-rewriting statement." >&2
  exit 1
fi
if grep -Eiq 'ALTER[[:space:]]+TABLE[[:space:]]+public\.(evidence_documents|evidence_links|onboarding_evidence_requirements|onboarding_readiness_snapshots|customer_authority_assignments|customer_contracts|customer_contract_line_items|organizations|customers|master_register_events)\b' <<<"$sql_only"; then
  echo "Migration 0032 alters an existing table." >&2
  exit 1
fi
if grep -Eiq 'INSERT[[:space:]]+INTO' <<<"$sql_only"; then
  echo "Migration 0032 writes data." >&2
  exit 1
fi
if grep -Eiq '\b(bytea|base64|signed_url|public_url)\b' <<<"$sql_only"; then
  echo "Migration 0032 introduces a payload-carrying column." >&2
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

-- 1. Ledger and checksums
DO $verify$
DECLARE
  manifest text := current_setting('tes.verify_manifest');
  phase text := current_setting('tes.verify_phase');
  upper_bound text := CASE WHEN phase = 'pre' THEN '0031' ELSE '0032' END;
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

  IF phase = 'pre' AND EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version >= '0032') THEN
    RAISE EXCEPTION 'pre phase expected production before 0032, but the ledger already contains 0032 or later';
  END IF;
  IF phase = 'pre' AND (SELECT count(*) FROM tes_system.schema_migrations) <> 31 THEN
    RAISE EXCEPTION 'pre phase expected exactly 31 ledger rows';
  END IF;
  IF phase = 'post' AND NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0032') THEN
    RAISE EXCEPTION 'post phase expected migration 0032 to be applied';
  END IF;
  IF phase = 'post' AND (SELECT count(*) FROM tes_system.schema_migrations WHERE version <= '0032') <> 32 THEN
    RAISE EXCEPTION 'post phase expected exactly 32 ledger rows through 0032';
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums through % for phase %', upper_bound, phase;
END
$verify$;

-- 2. Tables, functions, RLS (PRE: all absent and 0030/0031 unguarded)
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  tbl text;
  function_name text;
  present text;
BEGIN
  IF phase = 'pre' THEN
    SELECT string_agg(expected.object_name, ',' ORDER BY expected.object_name) INTO present
    FROM (VALUES ('evidence_payloads'), ('evidence_payload_access_events')) AS expected(object_name)
    WHERE to_regclass('public.' || expected.object_name) IS NOT NULL;
    IF present IS NOT NULL THEN
      RAISE EXCEPTION 'pre phase found 0032 table(s) already present: %', present;
    END IF;

    SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO present
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tes_security'
      AND p.proname IN (
        'evidence_organization_exists', 'prevent_evidence_payload_delete_or_truncate', 'prevent_evidence_payload_ledger_mutation',
        'guard_evidence_payload_insert', 'guard_evidence_payload_update', 'guard_evidence_payload_access_event_insert',
        'guard_evidence_document_write', 'guard_onboarding_evidence_requirement_write'
      );
    IF present IS NOT NULL THEN
      RAISE EXCEPTION 'pre phase found 0032 function(s) already present: %', present;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND t.tgname IN ('evidence_documents_guard_write', 'onboarding_evidence_requirements_guard_write')
    ) THEN
      RAISE EXCEPTION 'pre phase found 0032 guard trigger(s) already present on 0030 tables';
    END IF;

    -- the 0030 / 0031 foundations that 0032 builds on must be present and intact
    IF to_regclass('public.evidence_documents') IS NULL OR to_regclass('public.onboarding_evidence_requirements') IS NULL
       OR to_regclass('public.customer_contracts') IS NULL OR to_regclass('public.customer_contract_status_events') IS NULL THEN
      RAISE EXCEPTION 'pre phase: the 0030 / 0031 foundations are not present';
    END IF;

    RAISE NOTICE 'OK pre phase: 0032 evidence payload objects are absent and 0030/0031 are present';
    RETURN;
  END IF;

  FOREACH tbl IN ARRAY ARRAY['evidence_payloads', 'evidence_payload_access_events']
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE EXCEPTION 'missing 0032 table: %', tbl;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = tbl AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on %', tbl;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY ARRAY[
    'tes_security.evidence_organization_exists(uuid)',
    'tes_security.prevent_evidence_payload_delete_or_truncate()',
    'tes_security.prevent_evidence_payload_ledger_mutation()',
    'tes_security.guard_evidence_payload_insert()',
    'tes_security.guard_evidence_payload_update()',
    'tes_security.guard_evidence_payload_access_event_insert()',
    'tes_security.guard_evidence_document_write()',
    'tes_security.guard_onboarding_evidence_requirement_write()'
  ]
  LOOP
    IF to_regprocedure(function_name) IS NULL THEN
      RAISE EXCEPTION 'missing 0032 function: %', function_name;
    END IF;
  END LOOP;

  -- the only SECURITY DEFINER function is the boolean organization predicate; every guard is SECURITY INVOKER
  SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO present
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'tes_security' AND p.prosecdef
    AND (p.proname LIKE 'guard\_evidence%' OR p.proname LIKE 'guard\_onboarding\_evidence%' OR p.proname LIKE 'prevent\_evidence\_payload%');
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'a 0032 guard function is SECURITY DEFINER: %', present;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tes_security' AND p.proname = 'evidence_organization_exists' AND p.prosecdef AND p.prorettype = 'boolean'::regtype
  ) THEN
    RAISE EXCEPTION 'evidence_organization_exists must be a SECURITY DEFINER boolean predicate';
  END IF;
  IF has_function_privilege('public', to_regprocedure('tes_security.evidence_organization_exists(uuid)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'evidence_organization_exists is executable by PUBLIC';
  END IF;
  IF NOT has_function_privilege('tes-backend@tes-production-510007.iam', to_regprocedure('tes_security.evidence_organization_exists(uuid)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'the runtime role cannot execute evidence_organization_exists';
  END IF;

  -- no payload-carrying column anywhere in the new tables
  SELECT string_agg(table_name || '.' || column_name, ',' ORDER BY table_name, column_name) INTO present
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name IN ('evidence_payloads', 'evidence_payload_access_events')
    AND (data_type = 'bytea' OR column_name ~* '(payload_bytes|content|base64|data_url|signed_url|public_url)');
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'a 0032 table carries payload data: %', present;
  END IF;

  RAISE NOTICE 'OK 0032 tables, RLS and functions exist';
END
$verify$;

-- 3. Policies: SYSTEM EVIDENCE_* only; the access ledger accepts no UPDATE policy
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  missing text;
  extra text;
BEGIN
  IF phase = 'pre' THEN
    RETURN;
  END IF;

  SELECT string_agg(policy_name, ',' ORDER BY policy_name) INTO missing
  FROM (VALUES
    ('evidence_payloads_system_read'),
    ('evidence_payloads_system_insert'),
    ('evidence_payloads_system_update'),
    ('evidence_payload_access_events_system_read'),
    ('evidence_payload_access_events_system_insert')
  ) AS expected(policy_name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = expected.policy_name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing policy/policies: %', missing;
  END IF;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('evidence_payloads', 'evidence_payload_access_events')) <> 5 THEN
    RAISE EXCEPTION 'unexpected number of 0032 policies';
  END IF;

  SELECT string_agg(policyname, ',' ORDER BY policyname) INTO extra
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'evidence_payload_access_events' AND cmd NOT IN ('SELECT', 'INSERT');
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION 'the append-only access ledger has an UPDATE/DELETE/ALL policy: %', extra;
  END IF;

  SELECT string_agg(policyname, ',' ORDER BY policyname) INTO extra
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('evidence_payloads', 'evidence_payload_access_events')
    AND (coalesce(qual, '') || coalesce(with_check, '') !~ 'system_context_authorized'
         OR coalesce(qual, '') || coalesce(with_check, '') !~ 'EVIDENCE_(READ|MANAGE)'
         OR coalesce(qual, '') || coalesce(with_check, '') ~ 'customer_context_authorized');
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION '0032 policy is not SYSTEM EVIDENCE_* scoped: %', extra;
  END IF;

  RAISE NOTICE 'OK 0032 RLS policy catalogue exists and is SYSTEM EVIDENCE_* scoped';
END
$verify$;

-- 4. Grants, constraints, indexes and triggers
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  missing text;
BEGIN
  IF phase = 'pre' THEN
    RETURN;
  END IF;

  SELECT string_agg(t.table_name, ',' ORDER BY t.table_name) INTO missing
  FROM (VALUES ('evidence_payloads'), ('evidence_payload_access_events')) AS t(table_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public' AND g.table_name = t.table_name
      AND g.grantee = 'tes-backend@tes-production-510007.iam' AND g.privilege_type = 'SELECT'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'runtime role lacks SELECT on table(s): %', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'tes-backend@tes-production-510007.iam' AND table_schema = 'public' AND table_name = 'evidence_payloads' AND privilege_type = 'UPDATE'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'tes-backend@tes-production-510007.iam' AND table_schema = 'public' AND table_name = 'evidence_payloads' AND privilege_type = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'runtime role must hold INSERT and UPDATE on evidence_payloads';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'tes-backend@tes-production-510007.iam' AND table_schema = 'public' AND table_name = 'evidence_payload_access_events'
      AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) OR EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'tes-backend@tes-production-510007.iam' AND table_schema = 'public' AND table_name = 'evidence_payloads'
      AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) THEN
    RAISE EXCEPTION 'runtime role holds a forbidden grant on a 0032 table';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'PUBLIC' AND table_schema = 'public' AND table_name IN ('evidence_payloads', 'evidence_payload_access_events')
  ) THEN
    RAISE EXCEPTION 'PUBLIC holds a grant on a 0032 table';
  END IF;

  SELECT string_agg(index_name, ',' ORDER BY index_name) INTO missing
  FROM (VALUES
    ('evidence_payloads_document_uq'),
    ('evidence_payloads_source_file_uq')
  ) AS expected(index_name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = expected.index_name AND i.indexdef LIKE 'CREATE UNIQUE INDEX%');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing unique index(es): %', missing;
  END IF;

  SELECT string_agg(constraint_name, ',' ORDER BY constraint_name) INTO missing
  FROM (VALUES
    ('evidence_payloads_state_valid'),
    ('evidence_payloads_quarantine_name_valid'),
    ('evidence_payloads_intake_name_valid'),
    ('evidence_payloads_evidence_name_valid'),
    ('evidence_payloads_buckets_valid'),
    ('evidence_payloads_hash_valid'),
    ('evidence_payloads_mime_valid'),
    ('evidence_payloads_size_valid'),
    ('evidence_payloads_state_shape_valid'),
    ('evidence_payload_access_events_kind_valid')
  ) AS expected(constraint_name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = expected.constraint_name AND c.contype = 'c');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing check constraint(s): %', missing;
  END IF;

  -- the tenant-scoped naming rule must literally tie the organization into the object name
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'evidence_payloads_evidence_name_valid'
      AND pg_get_constraintdef(c.oid) LIKE '%organization_id%' AND pg_get_constraintdef(c.oid) LIKE '%evidence_document_id%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'evidence_payloads_quarantine_name_valid'
      AND pg_get_constraintdef(c.oid) LIKE '%organization_id%' AND pg_get_constraintdef(c.oid) LIKE '%batch_id%' AND pg_get_constraintdef(c.oid) LIKE '%source_file_id%'
  ) THEN
    RAISE EXCEPTION 'object-name constraints no longer bind the organization and ids into the name';
  END IF;

  -- Master Register accountability for views is a foreign key
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.evidence_payload_access_events'::regclass AND c.contype = 'f' AND c.confrelid = 'public.master_register_events'::regclass
  ) THEN
    RAISE EXCEPTION 'evidence_payload_access_events has no foreign key to the Master Register';
  END IF;

  SELECT string_agg(trigger_name, ',' ORDER BY trigger_name) INTO missing
  FROM (VALUES
    ('evidence_payloads_no_delete'), ('evidence_payloads_no_truncate'),
    ('evidence_payload_access_events_no_delete'), ('evidence_payload_access_events_no_truncate'),
    ('evidence_payload_access_events_immutable'),
    ('evidence_payloads_guard_insert'), ('evidence_payloads_guard_update'),
    ('evidence_payload_access_events_guard_insert'),
    ('evidence_documents_guard_write'), ('onboarding_evidence_requirements_guard_write')
  ) AS expected(trigger_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname = expected.trigger_name AND t.tgenabled = 'O'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing or disabled trigger(s): %', missing;
  END IF;

  RAISE NOTICE 'OK 0032 grants, constraints, indexes and triggers are present';
END
$verify$;

-- 5. The closed foundations are intact (0032 must not have disturbed them)
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN
      ('evidence_documents', 'evidence_links', 'onboarding_evidence_requirements', 'onboarding_readiness_snapshots',
       'customer_authority_assignments', 'customer_contracts', 'customer_contract_line_items')) <> 20 THEN
    RAISE EXCEPTION 'the 0030 policy set changed';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN
      ('contract_package_definitions', 'contract_evidence_rules', 'customer_contract_line_pricing', 'customer_contract_responsibility_matrix',
       'customer_contract_evidence_requirements', 'customer_contract_status_events', 'customer_authority_change_events')) <> 17 THEN
    RAISE EXCEPTION 'the 0031 policy set changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'customer_authority_assignments_one_active_uq')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'evidence_documents_gcs_object_uq') THEN
    RAISE EXCEPTION 'a 0030 uniqueness contract is missing';
  END IF;
  IF to_regprocedure('tes_security.contract_gate_failures(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'the 0031 readiness gate function is missing';
  END IF;
  RAISE NOTICE 'OK 0030 and 0031 foundations intact (phase %)', phase;
END
$verify$;

COMMIT;
SQL

echo "Evidence payload lifecycle production verification (${PHASE}) passed."
