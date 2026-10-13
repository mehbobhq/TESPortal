#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0031 (Contracts foundation: package/pricing metadata, responsibility matrix,
# evidence rule catalogue, contract status ledger, customer authority change ledger, and the database-enforced readiness gates).
#
# TES_VERIFY_PHASE=pre  checks production is still at 0030 and has no 0031 objects.
# TES_VERIFY_PHASE=post checks 0031 is applied and the foundation is present.
#
# The script only ever reads (BEGIN READ ONLY). It never applies, repairs or alters anything.

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-database/migrations}"
MIGRATION_0031="$MIGRATIONS_DIR/0031_contracts_foundation.sql"
PHASE="${TES_VERIFY_PHASE:-post}"

if [[ "$PHASE" != "pre" && "$PHASE" != "post" ]]; then
  echo "TES_VERIFY_PHASE must be pre or post; got: $PHASE" >&2
  exit 1
fi

if [[ ! -f "$MIGRATION_0031" ]]; then
  echo "Repository migration 0031 not found: $MIGRATION_0031" >&2
  exit 1
fi

sql_only="$(grep -Ev '^[[:space:]]*--' "$MIGRATION_0031")"
if grep -Eiq '^[[:space:]]*(DELETE|TRUNCATE|DROP|UPDATE)[[:space:]]' <<<"$sql_only"; then
  echo "Migration 0031 contains a destructive or data-rewriting statement." >&2
  exit 1
fi
if grep -Eiq 'ALTER[[:space:]]+TABLE[[:space:]]+public\.(evidence_documents|evidence_links|onboarding_evidence_requirements|onboarding_readiness_snapshots|customer_authority_assignments|customer_contracts|customer_contract_line_items|organizations|customers|master_register_events)\b' <<<"$sql_only"; then
  echo "Migration 0031 alters an existing table." >&2
  exit 1
fi
if grep -Eiq 'INSERT[[:space:]]+INTO[[:space:]]+public\.(organizations|customers|customer_engagements|vehicles|persons|operating_authorities|registrations|insurance_policies|company_credentials|master_register_events|capabilities|evidence_documents|customer_contracts|customer_authority_assignments)\b' <<<"$sql_only"; then
  echo "Migration 0031 writes existing canonical business data." >&2
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
  upper_bound text := CASE WHEN phase = 'pre' THEN '0030' ELSE '0031' END;
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

  IF phase = 'pre' AND EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version >= '0031') THEN
    RAISE EXCEPTION 'pre phase expected production before 0031, but ledger already contains 0031 or later';
  END IF;
  IF phase = 'post' AND NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0031') THEN
    RAISE EXCEPTION 'post phase expected migration 0031 to be applied';
  END IF;
  IF phase = 'post' AND (SELECT count(*) FROM tes_system.schema_migrations) <> 31 THEN
    RAISE EXCEPTION 'post phase expected exactly 31 ledger rows';
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums through % for phase %', upper_bound, phase;
END
$verify$;

-- 2. Tables, functions and RLS (PRE: all absent)
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  table_name text;
  function_name text;
  present text;
  missing text;
BEGIN
  IF phase = 'pre' THEN
    SELECT string_agg(expected.object_name, ',' ORDER BY expected.object_name) INTO present
    FROM (VALUES
      ('contract_package_definitions'),
      ('contract_evidence_rules'),
      ('customer_contract_line_pricing'),
      ('customer_contract_responsibility_matrix'),
      ('customer_contract_evidence_requirements'),
      ('customer_contract_status_events'),
      ('customer_authority_change_events')
    ) AS expected(object_name)
    WHERE to_regclass('public.' || expected.object_name) IS NOT NULL;
    IF present IS NOT NULL THEN
      RAISE EXCEPTION 'pre phase found 0031 table(s) already present: %', present;
    END IF;

    SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO present
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tes_security'
      AND p.proname IN (
        'contract_evidence_document_acceptable', 'contract_person_is_organization_contact', 'contract_customer_matches_organization',
        'contract_engagement_is_open_for_customer', 'contract_scope_is_current_in_engagement', 'contract_scope_responsibility_start',
        'contract_required_settings_present', 'contract_gate_failures', 'prevent_contracts_foundation_delete_or_truncate',
        'prevent_contracts_ledger_mutation', 'guard_customer_authority_insert', 'guard_customer_authority_update',
        'assert_customer_authority_change_recorded', 'guard_customer_authority_change_event_insert', 'guard_contract_decision_row',
        'guard_contract_line_item', 'guard_contract_evidence_requirement', 'guard_contract_status_event_insert', 'guard_customer_contract_update'
      );
    IF present IS NOT NULL THEN
      RAISE EXCEPTION 'pre phase found 0031 function(s) already present: %', present;
    END IF;

    -- 0030 must be intact and untouched by any 0031 trigger
    IF EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND t.tgname IN ('customer_contracts_guard_update', 'customer_contract_line_items_guard', 'customer_authority_assignments_guard_insert',
                         'customer_authority_assignments_guard_update', 'customer_authority_assignments_change_recorded')
    ) THEN
      RAISE EXCEPTION 'pre phase found 0031 guard trigger(s) already present on 0030 tables';
    END IF;

    RAISE NOTICE 'OK pre phase: 0031 contracts objects are absent';
    RETURN;
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'contract_package_definitions',
    'contract_evidence_rules',
    'customer_contract_line_pricing',
    'customer_contract_responsibility_matrix',
    'customer_contract_evidence_requirements',
    'customer_contract_status_events',
    'customer_authority_change_events'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'missing 0031 table: %', table_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on %', table_name;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY ARRAY[
    'tes_security.contract_evidence_document_acceptable(uuid,uuid,text)',
    'tes_security.contract_person_is_organization_contact(uuid,uuid)',
    'tes_security.contract_customer_matches_organization(uuid,uuid)',
    'tes_security.contract_engagement_is_open_for_customer(uuid,uuid)',
    'tes_security.contract_scope_is_current_in_engagement(uuid,uuid)',
    'tes_security.contract_scope_responsibility_start(uuid)',
    'tes_security.contract_required_settings_present(uuid)',
    'tes_security.contract_gate_failures(uuid,text)',
    'tes_security.prevent_contracts_foundation_delete_or_truncate()',
    'tes_security.prevent_contracts_ledger_mutation()',
    'tes_security.guard_customer_authority_insert()',
    'tes_security.guard_customer_authority_update()',
    'tes_security.assert_customer_authority_change_recorded()',
    'tes_security.guard_customer_authority_change_event_insert()',
    'tes_security.guard_contract_decision_row()',
    'tes_security.guard_contract_line_item()',
    'tes_security.guard_contract_evidence_requirement()',
    'tes_security.guard_contract_status_event_insert()',
    'tes_security.guard_customer_contract_update()'
  ]
  LOOP
    IF to_regprocedure(function_name) IS NULL THEN
      RAISE EXCEPTION 'missing 0031 function: %', function_name;
    END IF;
  END LOOP;

  -- SECURITY DEFINER is limited to the seven narrow boolean/date predicates; nothing else may be definer
  SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO present
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'tes_security' AND p.proname LIKE 'contract\_%' AND p.prosecdef
    AND p.prorettype NOT IN ('boolean'::regtype, 'date'::regtype);
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER contract function returns something other than boolean/date: %', present;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tes_security' AND (p.proname LIKE 'guard\_%contract%' OR p.proname LIKE 'guard\_customer\_authority%' OR p.proname = 'contract_gate_failures' OR p.proname LIKE 'prevent\_contracts%' OR p.proname = 'assert_customer_authority_change_recorded')
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'a 0031 guard or gate function is SECURITY DEFINER; it must be SECURITY INVOKER';
  END IF;

  -- predicates must not be executable by PUBLIC
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tes_security' AND p.proname LIKE 'contract\_%' AND has_function_privilege('public', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'a 0031 contract function is executable by PUBLIC';
  END IF;

  RAISE NOTICE 'OK 0031 tables, RLS and functions exist';
END
$verify$;

-- 3. Evidence rule catalogue seed and capability reuse
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  missing text;
BEGIN
  IF phase = 'pre' THEN
    RETURN;
  END IF;

  SELECT string_agg(expected.rule_code, ',' ORDER BY expected.rule_code) INTO missing
  FROM (VALUES
    ('CUSTOMER_AUTHORITY_NOTICE', 'ready_for_signature'),
    ('SERVICE_SCOPE_CONFIRMATION', 'ready_for_signature'),
    ('RESPONSIBILITY_START_CONFIRMATION', 'ready_for_signature'),
    ('REQUIRED_SETTINGS_CONFIRMATION', 'ready_for_signature'),
    ('PRICING_PACKAGE_CONFIRMATION', 'ready_for_signature'),
    ('SIGNED_CONTRACT_DOCUMENT', 'signed')
  ) AS expected(rule_code, before_status)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contract_evidence_rules r
    WHERE r.rule_code = expected.rule_code AND r.required_before_status = expected.before_status
      AND r.required_document_type = expected.rule_code AND r.rule_status = 'active'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing evidence rule catalogue row(s): %', missing;
  END IF;

  IF (SELECT count(*) FROM public.contract_evidence_rules) <> 6 THEN
    RAISE EXCEPTION 'unexpected evidence rule catalogue size';
  END IF;

  -- 0031 adds no capability: only the four 0030 capabilities back contracts
  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code LIKE 'CONTRACT\_%' AND code NOT IN ('CONTRACT_READ', 'CONTRACT_MANAGE')) THEN
    RAISE EXCEPTION 'unexpected contract capability present';
  END IF;

  RAISE NOTICE 'OK 0031 evidence rule catalogue and capabilities';
END
$verify$;

-- 4. Policies
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
    ('contract_package_definitions_system_read'),
    ('contract_package_definitions_system_insert'),
    ('contract_package_definitions_system_update'),
    ('contract_evidence_rules_system_read'),
    ('customer_contract_line_pricing_system_read'),
    ('customer_contract_line_pricing_system_insert'),
    ('customer_contract_line_pricing_system_update'),
    ('customer_contract_responsibility_matrix_system_read'),
    ('customer_contract_responsibility_matrix_system_insert'),
    ('customer_contract_responsibility_matrix_system_update'),
    ('customer_contract_evidence_requirements_system_read'),
    ('customer_contract_evidence_requirements_system_insert'),
    ('customer_contract_evidence_requirements_system_update'),
    ('customer_contract_status_events_system_read'),
    ('customer_contract_status_events_system_insert'),
    ('customer_authority_change_events_system_read'),
    ('customer_authority_change_events_system_insert')
  ) AS expected(policy_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = expected.policy_name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing policy/policies: %', missing;
  END IF;

  -- ledgers and the rule catalogue accept no UPDATE policy; no policy on a 0031 table may be anything but SYSTEM CONTRACT_*
  SELECT string_agg(policyname, ',' ORDER BY policyname) INTO extra
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('customer_contract_status_events', 'customer_authority_change_events', 'contract_evidence_rules')
    AND cmd NOT IN ('SELECT', 'INSERT');
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION 'append-only table has an UPDATE/DELETE/ALL policy: %', extra;
  END IF;

  SELECT string_agg(policyname, ',' ORDER BY policyname) INTO extra
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'contract_package_definitions', 'contract_evidence_rules', 'customer_contract_line_pricing', 'customer_contract_responsibility_matrix',
      'customer_contract_evidence_requirements', 'customer_contract_status_events', 'customer_authority_change_events'
    )
    AND (qual NOT LIKE '%system_context_authorized%' AND with_check NOT LIKE '%system_context_authorized%'
         OR coalesce(qual, '') || coalesce(with_check, '') !~ 'CONTRACT_(READ|MANAGE)'
         OR coalesce(qual, '') || coalesce(with_check, '') ~ 'customer_context_authorized');
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION '0031 policy is not SYSTEM CONTRACT_* scoped: %', extra;
  END IF;

  RAISE NOTICE 'OK 0031 RLS policy catalogue exists and is SYSTEM CONTRACT_* scoped';
END
$verify$;

-- 5. Grants, constraints, indexes and triggers
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  missing text;
  tbl text;
BEGIN
  IF phase = 'pre' THEN
    RETURN;
  END IF;

  SELECT string_agg(t.table_name, ',' ORDER BY t.table_name) INTO missing
  FROM (VALUES
    ('contract_package_definitions'), ('contract_evidence_rules'), ('customer_contract_line_pricing'),
    ('customer_contract_responsibility_matrix'), ('customer_contract_evidence_requirements'),
    ('customer_contract_status_events'), ('customer_authority_change_events')
  ) AS t(table_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public' AND g.table_name = t.table_name
      AND g.grantee = 'tes-backend@tes-production-510007.iam' AND g.privilege_type = 'SELECT'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'runtime role lacks SELECT on table(s): %', missing;
  END IF;

  -- append-only tables may be INSERTed but never UPDATEd by the runtime role; the catalogue is read-only
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'tes-backend@tes-production-510007.iam' AND table_schema = 'public'
      AND ((table_name IN ('customer_contract_status_events', 'customer_authority_change_events') AND privilege_type IN ('UPDATE'))
        OR (table_name = 'contract_evidence_rules' AND privilege_type IN ('INSERT', 'UPDATE')))
  ) THEN
    RAISE EXCEPTION 'runtime role holds a write privilege that an append-only/read-only 0031 table must not grant';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'tes-backend@tes-production-510007.iam' AND table_schema = 'public'
      AND table_name IN (
        'contract_package_definitions', 'contract_evidence_rules', 'customer_contract_line_pricing', 'customer_contract_responsibility_matrix',
        'customer_contract_evidence_requirements', 'customer_contract_status_events', 'customer_authority_change_events'
      )
      AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) THEN
    RAISE EXCEPTION 'runtime role has forbidden destructive/ownership-adjacent grants on 0031 table(s)';
  END IF;

  SELECT string_agg(index_name, ',' ORDER BY index_name) INTO missing
  FROM (VALUES
    ('contract_package_definitions_code_uq'),
    ('customer_contract_line_pricing_line_uq'),
    ('customer_contract_responsibility_area_uq'),
    ('customer_contract_evidence_requirements_rule_uq'),
    ('customer_contract_status_events_seq_uq'),
    ('customer_authority_assignments_one_active_uq')
  ) AS expected(index_name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = expected.index_name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing uniqueness/index contract(s): %', missing;
  END IF;

  SELECT string_agg(constraint_name, ',' ORDER BY constraint_name) INTO missing
  FROM (VALUES
    ('customer_contract_line_pricing_shape_valid'),
    ('customer_contract_responsibility_history_shape_valid'),
    ('customer_contract_evidence_requirements_shape_valid'),
    ('customer_contract_status_events_transition_valid'),
    ('customer_contract_status_events_evidence_required'),
    ('customer_authority_change_events_shape_valid')
  ) AS expected(constraint_name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = expected.constraint_name AND c.contype = 'c');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing check constraint(s): %', missing;
  END IF;

  -- Master Register accountability is a foreign key, not a convention
  FOREACH tbl IN ARRAY ARRAY['customer_contract_line_pricing', 'customer_contract_responsibility_matrix', 'customer_contract_status_events', 'customer_authority_change_events']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = ('public.' || tbl)::regclass AND c.contype = 'f' AND c.confrelid = 'public.master_register_events'::regclass
    ) THEN
      RAISE EXCEPTION '% has no foreign key to the Master Register', tbl;
    END IF;
  END LOOP;

  -- every new table: no-delete + no-truncate guards; ledgers also immutable
  SELECT string_agg(trigger_name, ',' ORDER BY trigger_name) INTO missing
  FROM (
    SELECT t.table_name || '_no_delete' AS trigger_name
      FROM (VALUES ('contract_package_definitions'), ('contract_evidence_rules'), ('customer_contract_line_pricing'),
                   ('customer_contract_responsibility_matrix'), ('customer_contract_evidence_requirements'),
                   ('customer_contract_status_events'), ('customer_authority_change_events')) AS t(table_name)
    UNION ALL
    SELECT t.table_name || '_no_truncate'
      FROM (VALUES ('contract_package_definitions'), ('contract_evidence_rules'), ('customer_contract_line_pricing'),
                   ('customer_contract_responsibility_matrix'), ('customer_contract_evidence_requirements'),
                   ('customer_contract_status_events'), ('customer_authority_change_events')) AS t(table_name)
    UNION ALL SELECT 'customer_contract_status_events_immutable'
    UNION ALL SELECT 'customer_authority_change_events_immutable'
    UNION ALL SELECT 'contract_evidence_rules_immutable'
    UNION ALL SELECT 'customer_contract_line_pricing_guard'
    UNION ALL SELECT 'customer_contract_responsibility_matrix_guard'
    UNION ALL SELECT 'customer_contract_evidence_requirements_guard'
    UNION ALL SELECT 'customer_contract_status_events_guard_insert'
    UNION ALL SELECT 'customer_authority_change_events_guard_insert'
    UNION ALL SELECT 'customer_authority_assignments_guard_insert'
    UNION ALL SELECT 'customer_authority_assignments_guard_update'
    UNION ALL SELECT 'customer_authority_assignments_change_recorded'
    UNION ALL SELECT 'customer_contract_line_items_guard'
    UNION ALL SELECT 'customer_contracts_guard_update'
  ) expected
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname = expected.trigger_name AND t.tgenabled = 'O'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing or disabled trigger(s): %', missing;
  END IF;

  -- the authority change-recorded check must be a deferred constraint trigger
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t WHERE t.tgname = 'customer_authority_assignments_change_recorded' AND t.tgconstraint <> 0 AND t.tgdeferrable AND t.tginitdeferred
  ) THEN
    RAISE EXCEPTION 'customer_authority_assignments_change_recorded is not a deferred constraint trigger';
  END IF;

  RAISE NOTICE 'OK 0031 grants, constraints, indexes and triggers are present';
END
$verify$;

-- 6. 0030 objects are still intact (0031 must not have disturbed them)
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
BEGIN
  IF to_regclass('public.customer_authority_assignments') IS NULL OR to_regclass('public.customer_contracts') IS NULL
     OR to_regclass('public.customer_contract_line_items') IS NULL OR to_regclass('public.evidence_documents') IS NULL THEN
    RAISE EXCEPTION '0030 foundation tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'customer_authority_assignments_one_active_uq') THEN
    RAISE EXCEPTION 'the 0030 one-active-holder index is missing';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN
      ('evidence_documents', 'evidence_links', 'onboarding_evidence_requirements', 'onboarding_readiness_snapshots',
       'customer_authority_assignments', 'customer_contracts', 'customer_contract_line_items')) <> 20 THEN
    RAISE EXCEPTION 'the 0030 policy set changed';
  END IF;
  RAISE NOTICE 'OK 0030 foundation intact (phase %)', phase;
END
$verify$;

COMMIT;
SQL

echo "Contracts foundation production verification (${PHASE}) passed."
