#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

psql --no-password --set=ON_ERROR_STOP=1 <<'SQL'
BEGIN;

DO $verify$
DECLARE
  runtime_role constant text := 'tes-backend@tes-production-510007.iam';
BEGIN
  IF to_regclass('public.master_register_events') IS NULL THEN
    RAISE EXCEPTION 'master_register_events does not exist';
  END IF;

  IF NOT has_table_privilege(runtime_role, 'public.master_register_events', 'SELECT') THEN
    RAISE EXCEPTION 'runtime role is missing SELECT on master_register_events';
  END IF;
  IF NOT has_table_privilege(runtime_role, 'public.master_register_events', 'INSERT') THEN
    RAISE EXCEPTION 'runtime role is missing INSERT on master_register_events';
  END IF;
  IF has_table_privilege(runtime_role, 'public.master_register_events', 'UPDATE') THEN
    RAISE EXCEPTION 'runtime role unexpectedly has UPDATE on master_register_events';
  END IF;
  IF has_table_privilege(runtime_role, 'public.master_register_events', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role unexpectedly has DELETE on master_register_events';
  END IF;
  IF has_table_privilege(runtime_role, 'public.master_register_events', 'TRUNCATE') THEN
    RAISE EXCEPTION 'runtime role unexpectedly has TRUNCATE on master_register_events';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.master_register_events'::regclass
      AND tgname = 'master_register_events_immutable'
      AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Master Register immutability trigger is missing or disabled';
  END IF;
END
$verify$;

INSERT INTO public.actors (id, actor_type)
VALUES ('7b1c2e5e-10cb-4e8f-8b48-0f64fdc8a001', 'SYSTEM');

INSERT INTO public.master_register_events (
  event_id, event_type, event_family, schema_version, catalogue_version,
  actor_type, actor_id, occurred_at, recorded_at, source,
  target, relationships, outcome
)
VALUES (
  '7b1c2e5e-10cb-4e8f-8b48-0f64fdc8b001',
  'RECORD_CREATED',
  'RECORD_DATA',
  1,
  1,
  'SYSTEM',
  '7b1c2e5e-10cb-4e8f-8b48-0f64fdc8a001',
  clock_timestamp(),
  clock_timestamp(),
  '{"sourceType":"PRODUCTION_VERIFICATION","component":"master-register-verification"}'::jsonb,
  '{"companyId":"verification-company","resourceType":"VERIFICATION","resourceId":"verification-resource"}'::jsonb,
  '{"correlationId":"verification-correlation","assessmentId":"verification-assessment","automationRunId":"verification-automation","integrationOperationId":"verification-integration"}'::jsonb,
  '{"result":"SUCCESS"}'::jsonb
);

DO $verify$
DECLARE
  row_count integer;
BEGIN
  SELECT count(*) INTO row_count
  FROM public.master_register_events
  WHERE event_id = '7b1c2e5e-10cb-4e8f-8b48-0f64fdc8b001';

  IF row_count <> 1 THEN
    RAISE EXCEPTION 'Master Register append/read verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.master_register_events
    WHERE company_id = 'verification-company'
      AND correlation_id = 'verification-correlation'
      AND assessment_id = 'verification-assessment'
      AND automation_run_id = 'verification-automation'
      AND integration_operation_id = 'verification-integration'
  ) THEN
    RAISE EXCEPTION 'Master Register generated query projections failed';
  END IF;
END
$verify$;

DO $verify$
BEGIN
  BEGIN
    INSERT INTO public.master_register_events (
      event_id, event_type, event_family, schema_version, catalogue_version,
      actor_type, actor_id, occurred_at, recorded_at, source
    )
    VALUES (
      '7b1c2e5e-10cb-4e8f-8b48-0f64fdc8b001',
      'RECORD_CREATED',
      'RECORD_DATA',
      1,
      1,
      'SYSTEM',
      '7b1c2e5e-10cb-4e8f-8b48-0f64fdc8a001',
      clock_timestamp(),
      clock_timestamp(),
      '{"sourceType":"PRODUCTION_VERIFICATION"}'::jsonb
    );
    RAISE EXCEPTION 'duplicate event_id was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END
$verify$;

DO $verify$
BEGIN
  BEGIN
    UPDATE public.master_register_events
    SET event_type = 'RECORD_UPDATED'
    WHERE event_id = '7b1c2e5e-10cb-4e8f-8b48-0f64fdc8b001';
    RAISE EXCEPTION 'Master Register UPDATE unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      NULL;
  END;

  BEGIN
    DELETE FROM public.master_register_events
    WHERE event_id = '7b1c2e5e-10cb-4e8f-8b48-0f64fdc8b001';
    RAISE EXCEPTION 'Master Register DELETE unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      NULL;
  END;
END
$verify$;

ROLLBACK;

SELECT
  to_regclass('public.master_register_events') IS NOT NULL AS master_register_exists,
  has_table_privilege(
    'tes-backend@tes-production-510007.iam',
    'public.master_register_events',
    'SELECT'
  ) AS runtime_select,
  has_table_privilege(
    'tes-backend@tes-production-510007.iam',
    'public.master_register_events',
    'INSERT'
  ) AS runtime_insert,
  NOT has_table_privilege(
    'tes-backend@tes-production-510007.iam',
    'public.master_register_events',
    'UPDATE'
  ) AS runtime_update_denied,
  NOT has_table_privilege(
    'tes-backend@tes-production-510007.iam',
    'public.master_register_events',
    'DELETE'
  ) AS runtime_delete_denied,
  NOT has_table_privilege(
    'tes-backend@tes-production-510007.iam',
    'public.master_register_events',
    'TRUNCATE'
  ) AS runtime_truncate_denied,
  (
    SELECT count(*)
    FROM public.master_register_events
    WHERE event_id = '7b1c2e5e-10cb-4e8f-8b48-0f64fdc8b001'
  ) = 0 AS verification_event_rolled_back;
SQL

echo "Master Register production persistence verification passed."
