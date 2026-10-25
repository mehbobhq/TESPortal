-- 0043: Driver Events - corrections from the independent review of 0042.
--
--   1. A mandatory safety restriction cannot be hidden by marking the event "Not Applicable" or as a duplicate (closing was already blocked).
--   2. An enforcement or regulator restriction is always mandatory (it could otherwise be issued as non-mandatory and then not block closure).
--   3. A reusable, tenant-safe lookup of ACTIVE restrictions for a driver or a vehicle, for every workflow that puts a driver or vehicle to use:
--        driver_event_active_restrictions_v1  (view, event capability)
--        tes_security.driver_event_person_restricted(org, person)  (boolean only, for driver administration; no event detail is disclosed)
--   4. The analytical fact distinguishes confirmed from unconfirmed amounts and carries a per-kind measurement profile, so measured, estimated, unverified,
--      none-confirmed and unknown values stay distinguishable (contract driver-event-fact/1 gains columns; none is removed or renamed).

-- ---------------------------------------------------------------------------------------------------------------------------------------------------
-- 1. Guard: not closed and not "Not Applicable" while a mandatory restriction is active
-- ---------------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tes_security.driver_event_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.category_code IS DISTINCT FROM OLD.category_code OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'An event keeps its company, category and creator' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'closed_at' - 'closed_by_actor_id' - 'closure_reason' - 'verification_state' - 'updated_at' - 'current_version')
       IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'closed_at' - 'closed_by_actor_id' - 'closure_reason' - 'verification_state' - 'updated_at' - 'current_version') THEN
        IF NEW.current_version <> OLD.current_version + 1 THEN
            RAISE EXCEPTION 'A changed event record is a new version' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.current_version IS DISTINCT FROM OLD.current_version THEN
        RAISE EXCEPTION 'The version only advances with the record' USING ERRCODE = '23514';
    END IF;
    IF OLD.record_state = 'RECORDED' AND NEW.record_state = 'DRAFT' THEN
        RAISE EXCEPTION 'A recorded event cannot return to draft' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IN ('Closed', 'Not Applicable') AND OLD.status IS DISTINCT FROM NEW.status THEN
        IF EXISTS (SELECT 1 FROM public.driver_event_restrictions r WHERE r.event_id = NEW.id AND r.state = 'ACTIVE' AND r.mandatory) THEN
            RAISE EXCEPTION 'The event has an unresolved mandatory safety restriction; release it with its documented correction before closing or setting it aside' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF NEW.status = 'Closed' AND OLD.status IS DISTINCT FROM 'Closed' THEN
        IF EXISTS (SELECT 1 FROM public.driver_event_actions a WHERE a.event_id = NEW.id AND a.required AND a.status IN ('OPEN', 'IN_PROGRESS')) THEN
            RAISE EXCEPTION 'The event has required follow-up that is not complete' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------
-- 2. Enforcement and regulator restrictions are always mandatory; a restriction event cannot be marked a duplicate while one is active
-- ---------------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.driver_event_restrictions
    ADD CONSTRAINT driver_event_restrictions_authority_mandatory CHECK (authority NOT IN ('ENFORCEMENT', 'REGULATOR') OR mandatory);

CREATE FUNCTION tes_security.driver_event_duplicate_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.relationship_type = 'DUPLICATE_OF' AND NEW.status = 'active' AND EXISTS (
        SELECT 1 FROM public.driver_event_restrictions r WHERE r.event_id = NEW.from_event_id AND r.state = 'ACTIVE' AND r.mandatory
    ) THEN
        RAISE EXCEPTION 'An event with an active mandatory safety restriction cannot be marked a duplicate; release the restriction or record the restriction on the original' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_duplicate_guard() FROM PUBLIC;
CREATE TRIGGER driver_event_relationships_duplicate_guard BEFORE INSERT ON public.driver_event_relationships FOR EACH ROW EXECUTE FUNCTION tes_security.driver_event_duplicate_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------------------------
-- 3. Active restrictions: what a workflow must consult before it puts a driver or a vehicle to use
-- ---------------------------------------------------------------------------------------------------------------------------------------------------
CREATE VIEW public.driver_event_active_restrictions_v1 WITH (security_invoker = true) AS
SELECT r.id AS restriction_id, r.event_id, r.organization_id, r.restriction_kind, r.authority, r.mandatory, r.subject_type,
       r.subject_driver_relationship_id, e.driver_person_id AS subject_person_id, r.subject_vehicle_id, r.subject_label,
       r.source_reference, r.issued_at, r.required_correction, r.response_deadline, r.created_at
  FROM public.driver_event_restrictions r
  JOIN public.driver_events e ON e.id = r.event_id AND e.organization_id = r.organization_id
 WHERE r.state = 'ACTIVE';
COMMENT ON VIEW public.driver_event_active_restrictions_v1 IS 'Every ACTIVE safety restriction. A dispatch, assignment, movement or hours-of-service workflow must refuse to put the subject driver or vehicle to use while a mandatory row exists for it.';
REVOKE ALL ON public.driver_event_active_restrictions_v1 FROM PUBLIC;
GRANT SELECT ON public.driver_event_active_restrictions_v1 TO "tes-backend@tes-production-510007.iam";

-- Boolean only, for driver administration (which holds no event capability): is this person under an active mandatory DRIVER restriction in this company?
-- It discloses no event, no authority and no date. It answers only inside a driver-management or driver-event context.
CREATE FUNCTION tes_security.driver_event_person_restricted(p_org uuid, p_person uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE
        WHEN NOT tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE', 'DRIVER_EVENT_READ', 'DRIVER_EVENT_MANAGE']) THEN NULL
        ELSE EXISTS (
            SELECT 1
              FROM public.driver_event_restrictions r
              JOIN public.driver_events e ON e.id = r.event_id AND e.organization_id = r.organization_id
             WHERE r.organization_id = p_org AND e.driver_person_id = p_person AND r.subject_type = 'DRIVER'
               AND r.state = 'ACTIVE' AND r.mandatory
        )
    END;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_event_person_restricted(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.driver_event_person_restricted(uuid, uuid) TO "tes-backend@tes-production-510007.iam";

-- ---------------------------------------------------------------------------------------------------------------------------------------------------
-- 4. Analytical fact: confirmed versus unconfirmed amounts, and a per-kind measurement profile
-- ---------------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.driver_event_bi_facts
    ADD COLUMN cost_actual_confirmed_minor bigint,
    ADD COLUMN cost_actual_unconfirmed_minor bigint,
    ADD COLUMN measurement_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.driver_event_bi_facts.cost_actual_confirmed_minor IS 'Part of cost_actual_minor whose consequence confidence is CONFIRMED. NULL when no actual cost is measured. cost_actual_minor = confirmed + unconfirmed.';
COMMENT ON COLUMN public.driver_event_bi_facts.cost_actual_unconfirmed_minor IS 'Part of cost_actual_minor whose confidence is ESTIMATED or UNVERIFIED.';
COMMENT ON COLUMN public.driver_event_bi_facts.measurement_profile IS 'Per consequence kind: counts by measurement state (MEASURED / NONE_CONFIRMED / NOT_COLLECTED / UNKNOWN) and by confidence (CONFIRMED / ESTIMATED / UNVERIFIED) of the active consequences. A kind that is absent was never addressed.';

-- the view lists the table columns when it is created: recreate it so the new columns appear
DROP VIEW public.driver_event_facts_v1;
CREATE VIEW public.driver_event_facts_v1 WITH (security_invoker = true) AS
SELECT f.*
  FROM public.driver_event_bi_facts f
  JOIN public.driver_events e ON e.id = f.event_id AND e.organization_id = f.organization_id AND e.current_version = f.record_version
 WHERE NOT EXISTS (
        SELECT 1 FROM public.driver_event_relationships r
         WHERE r.from_event_id = e.id AND r.relationship_type = 'DUPLICATE_OF' AND r.status = 'active'
       );
COMMENT ON VIEW public.driver_event_facts_v1 IS 'Contract v1: one row per current, non-duplicate Driver Event. NULL means not collected, never zero. Join keys: driver_relationship_id, vehicle_id, occurred_local_date.';
REVOKE ALL ON public.driver_event_facts_v1 FROM PUBLIC;
GRANT SELECT ON public.driver_event_facts_v1 TO "tes-backend@tes-production-510007.iam";
