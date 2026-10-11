#!/usr/bin/env bash
set -euo pipefail
: "${PGHOST:?PGHOST is required}"; : "${PGPORT:?PGPORT is required}"; : "${PGDATABASE:?PGDATABASE is required}"; : "${PGUSER:?PGUSER is required}"
phase="${TES_VERIFY_PHASE:-post}"
expected="${TES_EXPECTED_SHA:?TES_EXPECTED_SHA is required}"
actual="${GITHUB_SHA:-}"
[[ -z "$actual" || "$actual" == "$expected" ]] || { echo "SHA mismatch: expected $expected got $actual" >&2; exit 1; }

expected_ledger=19
[[ "$phase" == post ]] && expected_ledger=23

psql --no-password --set=ON_ERROR_STOP=1 --set=expected_ledger="$expected_ledger" --set=phase="$phase" <<'SQL'
BEGIN READ ONLY;
SELECT current_setting('server_version') AS postgres_version;
SELECT count(*) = :'expected_ledger'::int AS ledger_count_ok FROM tes_system.schema_migrations \gset
\if :ledger_count_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'Unexpected migration ledger count'; END $$;
\endif

SELECT NOT EXISTS(
 SELECT 1 FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name IN (
  'vehicle_types','vehicles','organization_vehicle_relationships','vehicle_registration_periods',
  'driver_profiles','driver_licences','organization_driver_relationships','driver_medical_qualification_periods',
  'entity_resolution_cases','entity_resolution_signals','entity_resolution_candidates')
 AND grantee='PUBLIC'
) AS no_public \gset
\if :no_public
\else
 DO $$ BEGIN RAISE EXCEPTION 'PUBLIC privilege drift'; END $$;
\endif

\if :{?phase}
\endif
SELECT (:'phase'='pre') OR (
 to_regclass('public.vehicles') IS NOT NULL AND
 to_regclass('public.driver_profiles') IS NOT NULL AND
 to_regclass('public.entity_resolution_cases') IS NOT NULL
) AS required_relations \gset
\if :required_relations
\else
 DO $$ BEGIN RAISE EXCEPTION 'Operational identity relation missing'; END $$;
\endif

SELECT (:'phase'='pre') OR (
 (SELECT count(*) FROM public.capabilities WHERE code IN
 ('VEHICLE_READ','VEHICLE_MANAGE','DRIVER_READ','DRIVER_MANAGE','IDENTITY_RESOLUTION_READ','IDENTITY_RESOLUTION_MANAGE'))=6
) AS capabilities_ok \gset
\if :capabilities_ok
\else
 DO $$ BEGIN RAISE EXCEPTION 'Operational identity capability drift'; END $$;
\endif

SELECT (:'phase'='pre') OR NOT EXISTS(
 SELECT 1 FROM information_schema.role_table_grants
 WHERE table_schema='public'
 AND table_name IN ('vehicles','organization_vehicle_relationships','vehicle_registration_periods','driver_profiles','driver_licences','organization_driver_relationships','driver_medical_qualification_periods','entity_resolution_cases','entity_resolution_signals','entity_resolution_candidates')
 AND grantee='tes_app_runtime' AND privilege_type IN ('DELETE','TRUNCATE','REFERENCES','TRIGGER')
) AS runtime_no_destructive \gset
\if :runtime_no_destructive
\else
 DO $$ BEGIN RAISE EXCEPTION 'Runtime destructive privilege drift'; END $$;
\endif

ROLLBACK;
\echo 'Core Operational Identity Graph production verification passed.'
SQL
