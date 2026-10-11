#!/usr/bin/env bash
set -euo pipefail
: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
PHASE="${TES_VERIFY_PHASE:-post}"
[[ "$PHASE" == pre || "$PHASE" == post ]] || { echo "TES_VERIFY_PHASE must be pre or post" >&2; exit 2; }
[[ -z "${TES_EXPECTED_SHA:-}" || "${GITHUB_SHA:-$TES_EXPECTED_SHA}" == "$TES_EXPECTED_SHA" ]] || { echo "Exact SHA mismatch" >&2; exit 3; }

manifest=""
for path in database/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  b="$(basename "$path")"; v="${b%%_*}"; h="$(sha256sum "$path"|awk '{print $1}')"; manifest+="${v}:${h},"
done
manifest="${manifest%,}"

psql --no-password --set=ON_ERROR_STOP=1 --set=phase="$PHASE" --set=manifest="$manifest" <<'SQL'
BEGIN READ ONLY;
SELECT set_config('tes.verify_phase',:'phase',true),set_config('tes.verify_manifest',:'manifest',true);

DO $v$
DECLARE phase text:=current_setting('tes.verify_phase'); manifest text:=current_setting('tes.verify_manifest');
        upperv text:=CASE WHEN phase='pre' THEN '0023' ELSE '0024' END; bad text;
BEGIN
 SELECT string_agg(version,',' ORDER BY version) INTO bad FROM (
   SELECT split_part(e,':',1) version,split_part(e,':',2) sha FROM unnest(string_to_array(manifest,',')) e
   WHERE split_part(e,':',1)<=upperv
   EXCEPT SELECT version,sha256 FROM tes_system.schema_migrations
 ) q;
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'ledger/repository checksum mismatch: %',bad; END IF;
 SELECT string_agg(version,',' ORDER BY version) INTO bad FROM (
   SELECT version,sha256 FROM tes_system.schema_migrations
   EXCEPT SELECT split_part(e,':',1),split_part(e,':',2) FROM unnest(string_to_array(manifest,',')) e
   WHERE split_part(e,':',1)<=upperv
 ) q;
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'unexpected production migration: %',bad; END IF;
 IF (SELECT count(*) FROM tes_system.schema_migrations)<>upperv::int THEN RAISE EXCEPTION 'expected exactly % migrations',upperv; END IF;
END $v$;

DO $v$
DECLARE phase text:=current_setting('tes.verify_phase'); actual text[]; expected text[]:=ARRAY[
'organizations','organization_identifiers','organization_aliases','organization_classifications','customers','customer_engagements',
'locations','location_addresses','organization_location_assignments',
'operating_authorities','operating_authority_versions','operating_authority_status_periods',
'persons','person_name_versions','person_channels','organization_channels','organization_person_relationships','organization_person_titles','contact_purpose_assignments',
'customer_engagement_stages','customer_engagement_terminations','customer_agreements','customer_agreement_versions','engagement_service_scopes','engagement_responsibility_periods',
'registrations','registration_versions','registration_status_periods',
'insurance_policies','insurance_policy_terms','insurance_endorsements','insurance_coverages','insurance_broker_periods',
'credential_systems','credential_system_aliases','company_credentials','credential_status_periods','credential_verifications','credential_secret_slots',
'company_operating_scope_periods','company_rule_applicability_periods','company_driver_requirement_periods',
'vehicles','organization_vehicle_relationships','vehicle_registration_periods',
'driver_profiles','driver_licences','organization_driver_relationships','driver_medical_qualification_periods',
'entity_resolution_cases','entity_resolution_signals','entity_resolution_candidates','master_register_events'];
BEGIN
 SELECT array_agg(c.relname ORDER BY c.relname) INTO actual
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity;
 SELECT array_agg(x ORDER BY x) INTO expected FROM unnest(expected) x;
 IF phase='pre' THEN
   IF coalesce(cardinality(actual),0)<>0 THEN RAISE EXCEPTION 'PRE expected zero RLS tables, got %',actual; END IF;
 ELSE
   IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'RLS table set mismatch. actual=% expected=%',actual,expected; END IF;
   IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relforcerowsecurity)
     THEN RAISE EXCEPTION 'FORCE RLS unexpectedly enabled; owner/runtime separation contract changed'; END IF;
 END IF;
END $v$;

DO $v$
DECLARE phase text:=current_setting('tes.verify_phase'); n int;
BEGIN
 SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public';
 IF phase='pre' AND n<>0 THEN RAISE EXCEPTION 'PRE expected no policies, got %',n; END IF;
 IF phase='post' AND n<>98 THEN RAISE EXCEPTION 'POST expected exactly 98 policies, got %',n; END IF;
END $v$;

DO $v$
DECLARE phase text:=current_setting('tes.verify_phase');
BEGIN
 IF phase='post' THEN
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tes-backend@tes-production-510007.iam' AND rolbypassrls)
      THEN RAISE EXCEPTION 'backend has BYPASSRLS'; END IF;
   IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
             WHERE n.nspname='public' AND c.relkind='r' AND r.rolname='tes-backend@tes-production-510007.iam')
      THEN RAISE EXCEPTION 'backend owns public table'; END IF;
   IF (SELECT count(*) FROM public.capabilities)<>25 THEN RAISE EXCEPTION 'capability catalogue count is not 25'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.capabilities WHERE code='MASTER_REGISTER_READ' AND is_active)
      THEN RAISE EXCEPTION 'MASTER_REGISTER_READ missing'; END IF;
   IF NOT has_function_privilege('tes-backend@tes-production-510007.iam','tes_security.system_context_authorized(text[])','EXECUTE')
      OR NOT has_function_privilege('tes-backend@tes-production-510007.iam','tes_security.customer_context_authorized(text[])','EXECUTE')
      OR NOT has_function_privilege('tes-backend@tes-production-510007.iam','tes_security.accessible_customers_for_actor(uuid,text,integer)','EXECUTE')
      THEN RAISE EXCEPTION 'runtime helper EXECUTE grant missing'; END IF;
   IF has_function_privilege('public','tes_security.system_context_authorized(text[])','EXECUTE')
      OR has_function_privilege('public','tes_security.customer_context_authorized(text[])','EXECUTE')
      OR has_function_privilege('public','tes_security.accessible_customers_for_actor(uuid,text,integer)','EXECUTE')
      THEN RAISE EXCEPTION 'PUBLIC can execute protected RLS helper'; END IF;
   IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE grantee='tes-backend@tes-production-510007.iam' AND privilege_type IN ('DELETE','TRUNCATE'))
      THEN RAISE EXCEPTION 'backend has destructive table privilege'; END IF;
 END IF;
END $v$;

ROLLBACK;
SELECT current_setting('server_version') server_version,(SELECT count(*) FROM tes_system.schema_migrations) applied_migrations;
SQL
echo "System-wide Authorization + RLS ${PHASE} verification passed."
