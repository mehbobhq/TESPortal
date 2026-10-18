#!/usr/bin/env bash
set -euo pipefail

# Read-only verification for migration 0033 (Company and Customer profile facts: cargo categories, fleet providers and the
# customer billing preference, each effective-dated with history).
#
# TES_VERIFY_PHASE=pre  checks the ledger is exactly 0001-0032 with the repository checksums, that no 0033 object exists, that the
#                       objects 0033 builds on are present, and prints a FINGERPRINT of the existing company and customer data.
# TES_VERIFY_PHASE=post checks 0033 is applied with the APPROVED checksum, that every table, policy, grant, constraint, index,
#                       trigger and seeded catalogue row is present, and, when TES_VERIFY_FINGERPRINT (the value printed by the pre
#                       phase) is given, that the existing company and customer data is byte-for-byte unchanged.
#
# The script only ever reads (BEGIN READ ONLY). It never applies, repairs or alters anything, and it reads no business content
# beyond identifiers used for the fingerprint.

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

APPROVED_SHA256_0033="47f3e9e12489a0feecb4aefda209dbbdf7dc22cb45db6109b540a2ec28256eb7"
RUNTIME_ROLE="${TES_RUNTIME_ROLE:-tes-backend@tes-production-510007.iam}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-database/migrations}"
MIGRATION_0033="$MIGRATIONS_DIR/0033_company_customer_profile_facts.sql"
PHASE="${TES_VERIFY_PHASE:-post}"
FINGERPRINT="${TES_VERIFY_FINGERPRINT:-}"

if [[ "$PHASE" != "pre" && "$PHASE" != "post" ]]; then
  echo "TES_VERIFY_PHASE must be pre or post; got: $PHASE" >&2
  exit 1
fi
if [[ ! -f "$MIGRATION_0033" ]]; then
  echo "Repository migration 0033 not found: $MIGRATION_0033" >&2
  exit 1
fi

repository_sha="$(sha256sum "$MIGRATION_0033" | awk '{print $1}')"
if [[ "$repository_sha" != "$APPROVED_SHA256_0033" ]]; then
  echo "Repository migration 0033 differs from the approved checksum." >&2
  echo "  approved:   $APPROVED_SHA256_0033" >&2
  echo "  repository: $repository_sha" >&2
  exit 1
fi

sql_only="$(grep -Ev '^[[:space:]]*--' "$MIGRATION_0033")"
if grep -Eiq '^[[:space:]]*(DELETE|TRUNCATE|DROP|UPDATE)[[:space:]]' <<<"$sql_only"; then
  echo "Migration 0033 contains a destructive or data-rewriting statement." >&2
  exit 1
fi
if grep -Eiq 'ALTER[[:space:]]+TABLE[[:space:]]+public\.(organizations|customers|customer_engagements|organization_channels|persons|master_register_events)\b' <<<"$sql_only"; then
  echo "Migration 0033 alters an existing table." >&2
  exit 1
fi
if grep -Eiq 'INSERT[[:space:]]+INTO[[:space:]]+public\.(organizations|customers|customer_engagements|organization_channels)\b' <<<"$sql_only"; then
  echo "Migration 0033 writes company or customer data." >&2
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
  --set=phase="$PHASE" \
  --set=approved="$APPROVED_SHA256_0033" \
  --set=runtime_role="$RUNTIME_ROLE" \
  --set=expected_fingerprint="$FINGERPRINT" <<'SQL'
BEGIN READ ONLY;

SELECT set_config('tes.verify_manifest', :'manifest', true);
SELECT set_config('tes.verify_phase', :'phase', true);
SELECT set_config('tes.verify_approved', :'approved', true);
SELECT set_config('tes.verify_runtime_role', :'runtime_role', true);
SELECT set_config('tes.verify_expected_fingerprint', :'expected_fingerprint', true);

-- 1. Ledger and checksums
DO $verify$
DECLARE
  manifest text := current_setting('tes.verify_manifest');
  phase text := current_setting('tes.verify_phase');
  approved text := current_setting('tes.verify_approved');
  upper_bound text := CASE WHEN phase = 'pre' THEN '0032' ELSE '0033' END;
  missing text;
  unexpected text;
  ledger_sha text;
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

  IF (SELECT count(*) FROM tes_system.schema_migrations WHERE version > upper_bound) > 0 THEN
    RAISE EXCEPTION 'the ledger contains migration(s) after %; this release does not apply to that database', upper_bound;
  END IF;

  IF phase = 'pre' AND (SELECT count(*) FROM tes_system.schema_migrations) <> 32 THEN
    RAISE EXCEPTION 'pre phase expected exactly 32 ledger rows (0001-0032); applying 0033 would ALSO apply every pending migration below it';
  END IF;
  IF phase = 'post' THEN
    IF (SELECT count(*) FROM tes_system.schema_migrations) <> 33 THEN
      RAISE EXCEPTION 'post phase expected exactly 33 ledger rows';
    END IF;
    SELECT sha256 INTO ledger_sha FROM tes_system.schema_migrations WHERE version = '0033';
    IF ledger_sha IS DISTINCT FROM approved THEN
      RAISE EXCEPTION 'the ledger checksum for 0033 is not the approved checksum';
    END IF;
  END IF;

  RAISE NOTICE 'OK ledger matches repository checksums through % for phase %', upper_bound, phase;
END
$verify$;

-- 2. Prerequisites (both phases): what 0033 builds on
DO $verify$
BEGIN
  IF to_regclass('public.organizations') IS NULL OR to_regclass('public.customers') IS NULL OR to_regclass('public.customer_engagements') IS NULL THEN
    RAISE EXCEPTION 'prerequisite tables (organizations, customers, customer_engagements) are missing';
  END IF;
  IF to_regprocedure('tes_security.guard_active_organization()') IS NULL
     OR to_regprocedure('tes_security.prevent_company_profile_data_removal()') IS NULL
     OR to_regprocedure('tes_security.system_context_authorized(text[])') IS NULL THEN
    RAISE EXCEPTION 'prerequisite functions (0016 / 0019 / 0024) are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION 'extension btree_gist (created by 0023) is not installed';
  END IF;
  IF (SELECT count(*) FROM public.capabilities WHERE code IN ('COMPANY_PROFILE_READ', 'COMPANY_PROFILE_MANAGE', 'CUSTOMER_RELATIONSHIP_READ', 'CUSTOMER_RELATIONSHIP_MANAGE', 'CONTACT_MANAGE', 'CONTRACT_READ') AND is_active) <> 6 THEN
    RAISE EXCEPTION 'a capability this release uses is missing or inactive';
  END IF;
  IF to_regclass('public.customer_contracts') IS NULL OR to_regclass('public.contract_package_definitions') IS NULL THEN
    RAISE EXCEPTION 'the contracts foundation (0030 / 0031) is missing: the profile derives Service Type from it';
  END IF;
  RAISE NOTICE 'OK prerequisites present';
END
$verify$;

-- 3. Fingerprint of the existing company and customer data. Valid only when no application write happens between the pre and
--    post phases (the release procedure runs both inside the write-quiesced release window).
SELECT 'FINGERPRINT=' || md5(concat_ws('|',
  (SELECT count(*)::text || ':' || coalesce(md5(string_agg(o::text, '' ORDER BY o.id)), '') FROM public.organizations o),
  (SELECT count(*)::text || ':' || coalesce(md5(string_agg(c::text, '' ORDER BY c.id)), '') FROM public.customers c),
  (SELECT count(*)::text || ':' || coalesce(md5(string_agg(e::text, '' ORDER BY e.id)), '') FROM public.customer_engagements e),
  (SELECT count(*)::text || ':' || coalesce(md5(string_agg(ch::text, '' ORDER BY ch.id)), '') FROM public.organization_channels ch)
)) AS fingerprint \gset
\echo :fingerprint

-- 4. Objects: absent before, present and correct after
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  runtime_role text := current_setting('tes.verify_runtime_role');
  tbl text;
  present text;
  data_tables text[] := ARRAY['company_cargo_category_periods', 'company_fleet_providers', 'company_fleet_provider_periods', 'customer_billing_preference_periods'];
  catalogues text[] := ARRAY['cargo_categories', 'billing_payment_methods', 'fleet_service_categories'];
  privilege text;
BEGIN
  IF phase = 'pre' THEN
    SELECT string_agg(t, ',' ORDER BY t) INTO present
    FROM unnest(data_tables || catalogues) AS t WHERE to_regclass('public.' || t) IS NOT NULL;
    IF present IS NOT NULL THEN
      RAISE EXCEPTION 'pre phase found 0033 table(s) already present: %', present;
    END IF;
    SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO present
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tes_security' AND p.proname IN (
      'guard_company_cargo_category_insert', 'guard_customer_billing_preference_insert', 'guard_company_fact_period_update',
      'guard_company_fleet_provider_period_insert', 'prevent_company_fleet_provider_update');
    IF present IS NOT NULL THEN
      RAISE EXCEPTION 'pre phase found 0033 function(s) already present: %', present;
    END IF;
    RAISE NOTICE 'OK pre phase: no 0033 object exists';
    RETURN;
  END IF;

  FOREACH tbl IN ARRAY data_tables
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN RAISE EXCEPTION 'missing 0033 table: %', tbl; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = tbl AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'RLS is not enabled on %', tbl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND qual LIKE '%system_context_authorized%') THEN
      RAISE EXCEPTION 'no SYSTEM-gated policy on %', tbl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND (qual IS NULL OR qual NOT LIKE '%system_context_authorized%')) THEN
      RAISE EXCEPTION 'a policy on % is not gated on an authorization context', tbl;
    END IF;
    FOREACH privilege IN ARRAY ARRAY['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(runtime_role, 'public.' || tbl, privilege) THEN RAISE EXCEPTION 'the runtime role holds % on %', privilege, tbl; END IF;
      IF has_table_privilege('public', 'public.' || tbl, privilege) THEN RAISE EXCEPTION 'PUBLIC holds % on %', privilege, tbl; END IF;
    END LOOP;
    IF has_table_privilege('public', 'public.' || tbl, 'SELECT') THEN RAISE EXCEPTION 'PUBLIC can read %', tbl; END IF;
    IF NOT has_table_privilege(runtime_role, 'public.' || tbl, 'SELECT') THEN RAISE EXCEPTION 'the runtime role cannot read %', tbl; END IF;
    IF has_table_privilege(runtime_role, 'public.' || tbl, 'UPDATE') THEN RAISE EXCEPTION 'the runtime role holds table-wide UPDATE on %', tbl; END IF;
  END LOOP;

  FOREACH tbl IN ARRAY catalogues
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN RAISE EXCEPTION 'missing 0033 catalogue: %', tbl; END IF;
    IF has_any_column_privilege(runtime_role, 'public.' || tbl, 'INSERT') OR has_any_column_privilege(runtime_role, 'public.' || tbl, 'UPDATE')
       OR has_table_privilege(runtime_role, 'public.' || tbl, 'DELETE') OR has_table_privilege(runtime_role, 'public.' || tbl, 'TRUNCATE') THEN
      RAISE EXCEPTION 'the runtime role can write the catalogue %', tbl;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.cargo_categories WHERE is_active) <> 6 THEN RAISE EXCEPTION 'cargo_categories is not seeded with 6 active rows'; END IF;
  IF (SELECT count(*) FROM public.billing_payment_methods WHERE is_active) <> 4 THEN RAISE EXCEPTION 'billing_payment_methods is not seeded with 4 active rows'; END IF;
  IF (SELECT count(*) FROM public.fleet_service_categories WHERE is_active) <> 3 THEN RAISE EXCEPTION 'fleet_service_categories is not seeded with 3 active rows'; END IF;

  -- the integrity constraints and indexes that make history and "one current" a database rule
  FOREACH tbl IN ARRAY ARRAY[
    'company_cargo_category_periods_no_overlap', 'company_fleet_provider_periods_no_overlap', 'customer_billing_preference_periods_no_overlap'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tbl AND contype = 'x') THEN RAISE EXCEPTION 'missing exclusion constraint %', tbl; END IF;
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY[
    'company_cargo_category_periods_current_uq', 'company_fleet_provider_periods_current_uq', 'customer_billing_preference_periods_current_uq'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN RAISE EXCEPTION 'missing unique index %', tbl; END IF;
  END LOOP;

  -- every new function is SECURITY INVOKER with a fixed search_path and no PUBLIC execute
  SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO present
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'tes_security' AND p.proname IN (
      'guard_company_cargo_category_insert', 'guard_customer_billing_preference_insert', 'guard_company_fact_period_update',
      'guard_company_fleet_provider_period_insert', 'prevent_company_fleet_provider_update')
    AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] OR has_function_privilege('public', p.oid, 'EXECUTE'));
  IF present IS NOT NULL THEN RAISE EXCEPTION '0033 function(s) are not invoker / fixed-search_path / no-PUBLIC-execute: %', present; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname IN (
      'guard_company_cargo_category_insert', 'guard_customer_billing_preference_insert', 'guard_company_fact_period_update',
      'guard_company_fleet_provider_period_insert', 'prevent_company_fleet_provider_update')) <> 5 THEN
    RAISE EXCEPTION 'expected 5 0033 functions';
  END IF;

  -- the guard triggers exist (no delete / truncate / content rewrite)
  FOREACH tbl IN ARRAY ARRAY[
    'company_cargo_category_periods_guard_update', 'company_cargo_category_periods_no_delete', 'company_cargo_category_periods_no_truncate',
    'company_fleet_provider_periods_guard_update', 'company_fleet_provider_periods_no_delete', 'company_fleet_provider_periods_no_truncate',
    'company_fleet_providers_no_update', 'company_fleet_providers_no_delete', 'company_fleet_providers_no_truncate',
    'customer_billing_preference_periods_guard_update', 'customer_billing_preference_periods_no_delete', 'customer_billing_preference_periods_no_truncate'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = tbl AND NOT tgisinternal) THEN RAISE EXCEPTION 'missing trigger %', tbl; END IF;
  END LOOP;

  -- no existing table was changed: 0033 only adds objects, so the existing company and customer tables carry no 0033 column
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('organizations', 'customers', 'customer_engagements', 'organization_channels')
             AND column_name LIKE ANY (ARRAY['cargo%', 'fleet%', 'billing_preference%'])) THEN
    RAISE EXCEPTION 'an existing company or customer table carries a 0033 column';
  END IF;

  RAISE NOTICE 'OK post phase: every 0033 object, policy, grant, constraint, index, trigger and catalogue row is present';
END
$verify$;

-- 5. Existing company and customer data unchanged (post phase, when the pre-phase fingerprint is supplied)
DO $verify$
DECLARE
  phase text := current_setting('tes.verify_phase');
  expected text := current_setting('tes.verify_expected_fingerprint');
  actual text;
BEGIN
  IF phase <> 'post' OR expected = '' THEN RETURN; END IF;
  SELECT 'FINGERPRINT=' || md5(concat_ws('|',
    (SELECT count(*)::text || ':' || coalesce(md5(string_agg(o::text, '' ORDER BY o.id)), '') FROM public.organizations o),
    (SELECT count(*)::text || ':' || coalesce(md5(string_agg(c::text, '' ORDER BY c.id)), '') FROM public.customers c),
    (SELECT count(*)::text || ':' || coalesce(md5(string_agg(e::text, '' ORDER BY e.id)), '') FROM public.customer_engagements e),
    (SELECT count(*)::text || ':' || coalesce(md5(string_agg(ch::text, '' ORDER BY ch.id)), '') FROM public.organization_channels ch)
  )) INTO actual;
  IF actual <> expected THEN
    RAISE EXCEPTION 'existing company and customer data CHANGED since the pre phase (expected %, found %)', expected, actual;
  END IF;
  RAISE NOTICE 'OK existing organizations, customers, engagements and channels are byte-for-byte unchanged';
END
$verify$;

ROLLBACK;
SQL
