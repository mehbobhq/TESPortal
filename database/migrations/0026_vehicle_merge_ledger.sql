-- TES Core Operational Identity Graph: Vehicle merge ledger and reversal
-- Migration: 0026
--
-- Scope (additive only):
--   1. public.vehicle_merges   the ledger of every merge of one vehicle into another, and of its reversal
--   2. integrity functions and triggers, row-level security consistent with migration 0024
--
-- Migration 0020 gave a vehicle the states active / archived / merged with vehicles.merged_into_vehicle_id and 0023 forbids merge
-- cycles, but a merge left no record of why or when it happened and could not be undone safely: flipping the columns back is
-- indistinguishable from an edit and silently re-claims the VIN namespace. This ledger makes both directions first-class:
--   * a merge is an alias / supersession, never a foreign-key rewrite and never a delete: history stays attached to the vehicle
--     that earned it and reads follow merged_into_vehicle_id;
--   * the merged vehicle leaves the VIN namespace (0020's partial unique index ignores merged vehicles); a reversal returns it
--     and fails, as a unique violation on that index, when the VIN has been taken since;
--   * both vehicles of a merge are ACTIVE when it is made, so there is no chain through a merged vehicle and no self-merge;
--   * a reversal is allowed only while the merged vehicle's survivor is itself not merged away (reverse the later merge first);
--   * a vehicle is 'merged' exactly while it has an ACTIVE ledger row pointing at its merged_into_vehicle_id, enforced at the end
--     of the transaction, so the vehicle columns and the ledger cannot disagree;
--   * ledger content is immutable; the only change is the one-way transition active -> reversed.
-- Persons and drivers have no merge representation in 0021; merging them would redefine identity and is outside this ledger.
--
-- SYSTEM-only (VEHICLE_READ / VEHICLE_MANAGE from 0020), row-level security as in 0024. All functions are SECURITY INVOKER with
-- a fixed search_path. No DELETE or TRUNCATE is granted and none is possible. No existing object is altered.


CREATE TABLE public.vehicle_merges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    source_vehicle_id uuid NOT NULL
        REFERENCES public.vehicles(id)
        ON DELETE RESTRICT,

    target_vehicle_id uuid NOT NULL
        REFERENCES public.vehicles(id)
        ON DELETE RESTRICT,

    merge_reason text NOT NULL,

    record_status text NOT NULL DEFAULT 'active',

    merged_at timestamptz NOT NULL DEFAULT now(),
    reversed_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT vehicle_merges_not_self
        CHECK (source_vehicle_id <> target_vehicle_id),

    CONSTRAINT vehicle_merges_reason_valid
        CHECK (merge_reason IN ('DUPLICATE_RECORD', 'IDENTIFIER_CORRECTION', 'RESOLUTION_REVIEW')),

    CONSTRAINT vehicle_merges_record_status_valid
        CHECK (record_status IN ('active', 'reversed')),

    CONSTRAINT vehicle_merges_reversal_state_consistent
        CHECK (
            (record_status = 'active' AND reversed_at IS NULL)
            OR
            (record_status = 'reversed' AND reversed_at IS NOT NULL AND reversed_at >= merged_at)
        )
);

-- A vehicle is merged away at most once at a time.
CREATE UNIQUE INDEX vehicle_merges_active_source_uq
    ON public.vehicle_merges (source_vehicle_id)
    WHERE record_status = 'active';

CREATE INDEX vehicle_merges_target_idx
    ON public.vehicle_merges (target_vehicle_id);


CREATE FUNCTION tes_security.prevent_vehicle_merge_data_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Vehicle merge history is preserved; % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- Both vehicles are locked in id order and must be ACTIVE: no merge into or out of a merged or archived vehicle.
CREATE FUNCTION tes_security.guard_vehicle_merge_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE active_count integer; BEGIN
    PERFORM 1
       FROM public.vehicles AS v
      WHERE v.id IN (NEW.source_vehicle_id, NEW.target_vehicle_id)
      ORDER BY v.id
        FOR UPDATE;

    SELECT count(*) INTO active_count
      FROM public.vehicles AS v
     WHERE v.id IN (NEW.source_vehicle_id, NEW.target_vehicle_id)
       AND v.record_status = 'active';

    IF NEW.record_status <> 'active' OR active_count <> 2 THEN
        RAISE EXCEPTION 'Both vehicles of a merge must be active'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'vehicle_merges_both_active';
    END IF;

    RETURN NEW;
END;
$$;

-- Content is immutable; the only change is the one-way reversal, and only while the survivor is not itself merged away.
CREATE FUNCTION tes_security.guard_vehicle_merge_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE target_state text; BEGIN
    IF OLD.record_status = 'reversed' THEN
        RAISE EXCEPTION 'A reversed vehicle merge is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.source_vehicle_id IS DISTINCT FROM OLD.source_vehicle_id
       OR NEW.target_vehicle_id IS DISTINCT FROM OLD.target_vehicle_id
       OR NEW.merge_reason IS DISTINCT FROM OLD.merge_reason
       OR NEW.merged_at IS DISTINCT FROM OLD.merged_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Vehicle merge content is immutable; the only change is a reversal'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'reversed' THEN
        SELECT v.record_status INTO target_state FROM public.vehicles AS v WHERE v.id = OLD.target_vehicle_id FOR SHARE;
        IF target_state = 'merged' THEN
            RAISE EXCEPTION 'The surviving vehicle is itself merged away; reverse that merge first'
                USING ERRCODE = '55000',
                      CONSTRAINT = 'vehicle_merges_survivor_not_merged';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Consistency by the end of the transaction, checked from both sides: a merged vehicle has exactly one ACTIVE ledger row that
-- points at its merged_into_vehicle_id, and a vehicle with an ACTIVE ledger row is merged into that target.
CREATE FUNCTION tes_security.require_vehicle_merge_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE subject uuid; state text; into_id uuid; active_merges integer; matching_merges integer; BEGIN
    subject := CASE TG_TABLE_NAME WHEN 'vehicles' THEN NEW.id ELSE (to_jsonb(NEW) ->> 'source_vehicle_id')::uuid END;

    SELECT v.record_status, v.merged_into_vehicle_id INTO state, into_id FROM public.vehicles AS v WHERE v.id = subject;
    IF state IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT count(*), count(*) FILTER (WHERE m.target_vehicle_id = into_id)
      INTO active_merges, matching_merges
      FROM public.vehicle_merges AS m
     WHERE m.source_vehicle_id = subject AND m.record_status = 'active';

    IF state = 'merged' AND (active_merges <> 1 OR matching_merges <> 1) THEN
        RAISE EXCEPTION 'A merged vehicle must have exactly one active merge record pointing at its survivor'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'vehicles_merged_state_consistent';
    END IF;

    IF state <> 'merged' AND active_merges <> 0 THEN
        RAISE EXCEPTION 'A vehicle with an active merge record must be merged'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'vehicles_merged_state_consistent';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_vehicle_merge_data_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_vehicle_merge_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_vehicle_merge_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.require_vehicle_merge_consistency() FROM PUBLIC;

CREATE TRIGGER vehicle_merges_guard_insert
BEFORE INSERT ON public.vehicle_merges
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_vehicle_merge_insert();

CREATE TRIGGER vehicle_merges_guard_update
BEFORE UPDATE ON public.vehicle_merges
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_vehicle_merge_update();

CREATE CONSTRAINT TRIGGER vehicle_merges_require_consistency
AFTER INSERT OR UPDATE ON public.vehicle_merges
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_vehicle_merge_consistency();

CREATE CONSTRAINT TRIGGER vehicles_require_merge_consistency
AFTER INSERT OR UPDATE OF record_status, merged_into_vehicle_id ON public.vehicles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_vehicle_merge_consistency();

CREATE TRIGGER vehicle_merges_no_delete
BEFORE DELETE ON public.vehicle_merges
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_vehicle_merge_data_removal();

CREATE TRIGGER vehicle_merges_no_truncate
BEFORE TRUNCATE ON public.vehicle_merges
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_vehicle_merge_data_removal();


REVOKE ALL
ON TABLE public.vehicle_merges
FROM PUBLIC;

GRANT SELECT
ON TABLE public.vehicle_merges
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, source_vehicle_id, target_vehicle_id, merge_reason)
ON public.vehicle_merges
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, reversed_at, updated_at)
ON public.vehicle_merges
TO "tes-backend@tes-production-510007.iam";

ALTER TABLE public.vehicle_merges ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_merges_system ON public.vehicle_merges FOR ALL USING (tes_security.system_context_authorized(ARRAY['VEHICLE_READ','VEHICLE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['VEHICLE_MANAGE']));
