-- TES Core Operational Identity Graph: Insurance scheduled-vehicle link
-- Migration: 0025
--
-- Scope (additive only):
--   1. public.insurance_coverage_vehicles   which vehicles a vehicle-scheduled insurance coverage insures, over time
--   2. integrity functions and triggers, and row-level security consistent with migration 0024
--
-- Migration 0017 deliberately left "scheduled vehicle" as a later link to insurance_coverages.id because no stable vehicle
-- identity existed. It does now (0020), so the link is a canonical relationship between two existing entities and is owned
-- here, with no change to either side:
--   * only a coverage flagged scheduled_vehicles_only can schedule vehicles (a coverage that covers the whole fleet does not
--     list vehicles; inventing a list for it would make a false claim);
--   * the insured Organization of the coverage must OPERATE the vehicle on the schedule's first day
--     (organization_vehicle_relationships, 0020) - another carrier's equipment cannot be scheduled;
--   * the schedule window lies inside the coverage window (the coverage row's dates, bounded by its term and cancellation);
--   * a vehicle appears at most once as currently scheduled per coverage, and active schedule windows never overlap;
--   * the vehicle and the Organization must be active; a merged or archived vehicle cannot be newly scheduled (reads follow
--     vehicles.merged_into_vehicle_id).
-- Windows are calendar dates, like the coverage and term dates they hang from. A removal ends the window; a wrong entry is
-- corrected (preserved, flagged, frozen, replaced). Whether the schedule is SUFFICIENT for the fleet is a Rules determination,
-- not a stored fact. Capabilities: this link is managed with INSURANCE_MANAGE and read with INSURANCE_READ (0017).
--
-- Row-level security follows 0024: SYSTEM access needs the exact INSURANCE capability established for the transaction and a
-- CUSTOMER reads only its own Organization's rows. The one cross-domain integrity check (vehicle active and operated by the
-- insured Organization) must read vehicle tables that are protected by VEHICLE_* policies while the transaction carries an
-- INSURANCE capability; that single check is therefore a SECURITY DEFINER trigger function with a fixed search_path that
-- returns nothing to the caller, cannot be executed by the runtime role and raises only a constraint error.
-- No DELETE or TRUNCATE is granted and none is possible. No existing object is touched.


CREATE TABLE public.insurance_coverage_vehicles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    coverage_id uuid NOT NULL
        REFERENCES public.insurance_coverages(id)
        ON DELETE RESTRICT,

    vehicle_id uuid NOT NULL
        REFERENCES public.vehicles(id)
        ON DELETE RESTRICT,

    -- The insured Organization (equal to the coverage's, enforced by trigger).
    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    schedule_reason text NOT NULL,

    effective_from date NOT NULL,
    effective_to date,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_schedule_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT insurance_coverage_vehicles_reason_valid
        CHECK (schedule_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT insurance_coverage_vehicles_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT insurance_coverage_vehicles_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT insurance_coverage_vehicles_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_schedule_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_schedule_id IS NOT NULL)
        ),

    CONSTRAINT insurance_coverage_vehicles_not_superseded_by_self
        CHECK (superseded_by_schedule_id IS NULL OR superseded_by_schedule_id <> id),

    CONSTRAINT insurance_coverage_vehicles_id_coverage_uq
        UNIQUE (id, coverage_id),

    CONSTRAINT insurance_coverage_vehicles_superseded_by_fk
        FOREIGN KEY (superseded_by_schedule_id, coverage_id)
        REFERENCES public.insurance_coverage_vehicles (id, coverage_id)
        DEFERRABLE INITIALLY DEFERRED,

    CONSTRAINT insurance_coverage_vehicles_no_overlap
        EXCLUDE USING gist (coverage_id WITH =, vehicle_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&)
        WHERE (record_status = 'active')
);

CREATE INDEX insurance_coverage_vehicles_vehicle_idx
    ON public.insurance_coverage_vehicles (vehicle_id, effective_from);

CREATE INDEX insurance_coverage_vehicles_coverage_idx
    ON public.insurance_coverage_vehicles (coverage_id, effective_from);


CREATE FUNCTION tes_security.prevent_insurance_schedule_data_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Insurance schedule data is preserved; % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- A scheduled vehicle belongs to an ACTIVE, vehicle-scheduled coverage of the SAME insured Organization, lies inside the
-- coverage window and is operated by that Organization when the schedule starts.
CREATE FUNCTION tes_security.guard_insurance_schedule_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE coverage_row record; window_end date; BEGIN
    SELECT c.organization_id, c.scheduled_vehicles_only, c.effective_from, c.effective_to, c.record_status, t.record_status AS term_status,
           t.term_end, t.cancelled_on
      INTO coverage_row
      FROM public.insurance_coverages AS c
      JOIN public.insurance_policy_terms AS t ON t.id = c.term_id
     WHERE c.id = NEW.coverage_id
       FOR SHARE OF c;

    IF coverage_row.organization_id IS NULL OR coverage_row.record_status <> 'active' OR coverage_row.term_status <> 'active' THEN
        RAISE EXCEPTION 'A schedule must belong to an active coverage of an active term'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'insurance_coverage_vehicles_coverage_active';
    END IF;

    IF coverage_row.organization_id <> NEW.organization_id THEN
        RAISE EXCEPTION 'The scheduled Organization must be the insured Organization of the coverage'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_coverage_vehicles_same_organization';
    END IF;

    IF NOT coverage_row.scheduled_vehicles_only THEN
        RAISE EXCEPTION 'Only a coverage that applies to scheduled vehicles can list vehicles'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_coverage_vehicles_coverage_is_scheduled';
    END IF;

    -- The coverage ends at the earliest of its own end, its term's end and its term's cancellation (NULLs ignored).
    window_end := LEAST(coverage_row.effective_to, coverage_row.term_end, coverage_row.cancelled_on);
    IF NEW.effective_from < coverage_row.effective_from
       OR (window_end IS NOT NULL AND (NEW.effective_from >= window_end OR (NEW.effective_to IS NOT NULL AND NEW.effective_to > window_end)))
    THEN
        RAISE EXCEPTION 'The schedule must lie inside the coverage window'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_coverage_vehicles_inside_coverage';
    END IF;

    RETURN NEW;
END;
$$;

-- Vehicle facts for a new active schedule row. SECURITY DEFINER only so that it can read the VEHICLE-protected tables while the
-- transaction carries an INSURANCE capability (see the header); it returns nothing, takes no input beyond the row being
-- inserted, has a fixed search_path and is not executable by anyone but the migration identity.
CREATE FUNCTION tes_security.guard_insurance_schedule_vehicle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$ DECLARE vehicle_state text; BEGIN
    IF NEW.record_status <> 'active' THEN
        RETURN NEW;
    END IF;

    SELECT v.record_status INTO vehicle_state FROM public.vehicles AS v WHERE v.id = NEW.vehicle_id FOR SHARE;
    IF vehicle_state IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'The scheduled vehicle must be active'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'insurance_coverage_vehicles_vehicle_active';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.organization_vehicle_relationships AS r
         WHERE r.vehicle_id = NEW.vehicle_id
           AND r.organization_id = NEW.organization_id
           AND r.relationship_type = 'OPERATES'
           AND r.record_status = 'active'
           AND tstzrange(r.effective_from, r.effective_to, '[)') @> NEW.effective_from::timestamptz
    ) THEN
        RAISE EXCEPTION 'The vehicle must be operated by the insured Organization when the schedule starts'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'insurance_coverage_vehicles_vehicle_operated';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION tes_security.guard_insurance_schedule_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected insurance schedule is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.coverage_id IS DISTINCT FROM OLD.coverage_id
       OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.schedule_reason IS DISTINCT FROM OLD.schedule_reason
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Insurance schedule content is immutable; record a change or a correction as a new row'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended insurance schedule cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end an insurance schedule'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_insurance_schedule_data_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_schedule_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_schedule_vehicle() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_insurance_schedule_update() FROM PUBLIC;

CREATE TRIGGER insurance_coverage_vehicles_guard_vehicle
BEFORE INSERT ON public.insurance_coverage_vehicles
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_schedule_vehicle();

CREATE TRIGGER insurance_coverage_vehicles_guard_active_organization
BEFORE INSERT ON public.insurance_coverage_vehicles
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER insurance_coverage_vehicles_guard_insert
BEFORE INSERT ON public.insurance_coverage_vehicles
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_schedule_insert();

CREATE TRIGGER insurance_coverage_vehicles_guard_update
BEFORE UPDATE ON public.insurance_coverage_vehicles
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_insurance_schedule_update();

CREATE TRIGGER insurance_coverage_vehicles_no_delete
BEFORE DELETE ON public.insurance_coverage_vehicles
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_insurance_schedule_data_removal();

CREATE TRIGGER insurance_coverage_vehicles_no_truncate
BEFORE TRUNCATE ON public.insurance_coverage_vehicles
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_insurance_schedule_data_removal();


REVOKE ALL
ON TABLE public.insurance_coverage_vehicles
FROM PUBLIC;

GRANT SELECT
ON TABLE public.insurance_coverage_vehicles
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, coverage_id, vehicle_id, organization_id, schedule_reason, effective_from, effective_to)
ON public.insurance_coverage_vehicles
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_schedule_id, updated_at)
ON public.insurance_coverage_vehicles
TO "tes-backend@tes-production-510007.iam";

ALTER TABLE public.insurance_coverage_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY insurance_coverage_vehicles_system ON public.insurance_coverage_vehicles FOR ALL USING (tes_security.system_context_authorized(ARRAY['INSURANCE_READ','INSURANCE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['INSURANCE_MANAGE']));
CREATE POLICY insurance_coverage_vehicles_customer ON public.insurance_coverage_vehicles FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
