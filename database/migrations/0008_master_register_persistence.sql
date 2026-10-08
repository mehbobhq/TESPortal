-- TES Master Register PostgreSQL persistence
-- Migration: 0008
--
-- Scope:
--   - persist the existing MasterRegisterEvent contract in PostgreSQL
--   - enforce append-only history at the database boundary
--   - expose the exact query paths required by MasterRegisterRepository
--
-- The Master Register is accountability infrastructure, not an operational
-- tenant CRUD table. It can contain system-wide and cross-customer security
-- events, so ordinary customer RLS is intentionally not applied here.
--
-- Runtime may INSERT and SELECT. Runtime may never UPDATE, DELETE or TRUNCATE.
-- Corrections are new events.

CREATE TABLE public.master_register_events (
    event_id uuid PRIMARY KEY,
    event_type text NOT NULL,
    event_family text NOT NULL,
    schema_version integer NOT NULL,
    catalogue_version integer NOT NULL,

    actor_type text NOT NULL,
    actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,

    occurred_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL,

    action jsonb,
    target jsonb,
    source jsonb NOT NULL,
    classification jsonb,
    change_set jsonb,
    evidence jsonb,
    relationships jsonb,
    outcome jsonb,
    coverage jsonb,
    governance jsonb,
    integrity jsonb,

    company_id text GENERATED ALWAYS AS (target ->> 'companyId') STORED,
    correlation_id text GENERATED ALWAYS AS (relationships ->> 'correlationId') STORED,
    assessment_id text GENERATED ALWAYS AS (relationships ->> 'assessmentId') STORED,
    automation_run_id text GENERATED ALWAYS AS (relationships ->> 'automationRunId') STORED,
    integration_operation_id text GENERATED ALWAYS AS (relationships ->> 'integrationOperationId') STORED,

    CONSTRAINT master_register_event_type_not_blank CHECK (btrim(event_type) <> ''),
    CONSTRAINT master_register_event_family_not_blank CHECK (btrim(event_family) <> ''),
    CONSTRAINT master_register_schema_version_positive CHECK (schema_version > 0),
    CONSTRAINT master_register_catalogue_version_positive CHECK (catalogue_version > 0),
    CONSTRAINT master_register_actor_type_valid
        CHECK (actor_type IN ('HUMAN','SYSTEM','AUTOMATION','INTEGRATION','SERVICE_ACCOUNT'))
);

CREATE INDEX master_register_events_recorded_at_idx
    ON public.master_register_events (recorded_at DESC, event_id);
CREATE INDEX master_register_events_actor_idx
    ON public.master_register_events (actor_id, recorded_at DESC);
CREATE INDEX master_register_events_company_idx
    ON public.master_register_events (company_id, recorded_at DESC)
    WHERE company_id IS NOT NULL;
CREATE INDEX master_register_events_correlation_idx
    ON public.master_register_events (correlation_id, recorded_at ASC)
    WHERE correlation_id IS NOT NULL;
CREATE INDEX master_register_events_assessment_idx
    ON public.master_register_events (assessment_id, recorded_at ASC)
    WHERE assessment_id IS NOT NULL;
CREATE INDEX master_register_events_automation_run_idx
    ON public.master_register_events (automation_run_id, recorded_at ASC)
    WHERE automation_run_id IS NOT NULL;
CREATE INDEX master_register_events_integration_operation_idx
    ON public.master_register_events (integration_operation_id, recorded_at ASC)
    WHERE integration_operation_id IS NOT NULL;

CREATE FUNCTION tes_security.prevent_master_register_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Master Register events are append-only and immutable'
        USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_master_register_mutation() FROM PUBLIC;

CREATE TRIGGER master_register_events_immutable
BEFORE UPDATE OR DELETE ON public.master_register_events
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_master_register_mutation();

GRANT SELECT, INSERT ON TABLE public.master_register_events
TO "tes-backend@tes-production-510007.iam";

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.master_register_events
FROM "tes-backend@tes-production-510007.iam";
