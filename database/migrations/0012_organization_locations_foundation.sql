-- TES Companies: Addresses, Physical Locations and Home Yard foundation
-- Migration: 0012
--
-- Scope (additive only):
--   1. public.locations                          durable identity of a business / operational place
--   2. public.location_addresses                 immutable, effective-dated address versions of a Location
--   3. public.organization_location_assignments  an Organization's REGISTERED / MAILING / HOME_YARD role at a Location
--
-- Three concepts, deliberately separate:
--   - a Location is a place. Its identity is an opaque UUID, never an address string, so a corrected or renumbered
--     civic address does not change which place it is.
--   - a location address is what the place's postal / civic address was, with business-time validity and an explicit
--     correction mechanism.
--   - an assignment is an Organization's role at a place, with business-time validity. The same Location can carry
--     several roles and several Organizations; a role change never rewrites the place or another Organization.
--
-- Global canonical facts: like organizations / organization_identifiers (0003) these tables have no tenant column and no
-- row-level security. A global canonical record is NOT a globally visible record: visibility is enforced by the server
-- (customer reads start from an authorized Customer; Location search is a SYSTEM registry operation).
--
-- Business / operational places only: this registry must not hold driver residences or other personal addresses. A
-- PII-aware domain with its own access control is required for those.
--
-- Business time vs record time:
--   - effective_from / effective_to describe when a fact was true in the real world and may be backdated.
--   - created_at / updated_at are database record times and are never used to simulate business history.
--
-- Correction vs real-world change (location_addresses):
--   - real-world change: the old version stays status = 'active' and gets effective_to = T; the new version starts at T
--     (version_reason = 'POSTAL_CHANGE'). Both are true business history.
--   - correction: the recorded version was wrong. It is kept, flagged status = 'corrected' with corrected_at and a
--     pointer to its replacement (superseded_by_address_id), and its effective_to is NOT used to end it. The replacement
--     (version_reason = 'CORRECTION') carries the business time the correct address held. "As of" queries read only
--     status = 'active' rows, so a known-wrong row is never reported as a genuine historical fact, yet it is preserved.
--
-- Correction vs real-world change (organization_location_assignments), parallel to the address model:
--   - real-world change: the old assignment stays status = 'active' and is ended (effective_to = T, end_reason
--     CHANGED / CEASED, which are real-world lifecycle events); a new assignment starts at T.
--   - correction: the assignment was recorded wrongly. It is kept, flagged status = 'corrected' with corrected_at and a
--     pointer to its replacement (superseded_by_assignment_id), and it is NOT ended: no CHANGED / CEASED is invented and
--     its effective_to / end_reason stay exactly as recorded. The replacement (same Organization and role) carries the
--     business time of the assignment it corrects. Current and as-of reads use status = 'active' rows only, so a
--     known-wrong assignment is never reported as genuine business history, yet it is preserved for audit.
--
-- Geographic extensibility: country_code is an ISO-style alpha-2 code and region_code a short code. Neither is restricted
-- to Canada / United States here; the current server boundary supports CA and US.
--
-- This migration intentionally does NOT:
--   - add a merge column, a merge operation, or a merged status
--   - add coordinates, timezone, geocoding fields, external facility identifiers, source or confidence columns
--   - add ownership (owned / leased / shared) semantics
--   - add capabilities, row-level security, or touch any existing object
--   - grant DELETE or TRUNCATE on anything


-- ============================================================
-- 1. Locations
-- ============================================================

CREATE TABLE public.locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- PHYSICAL: a place where operations can physically happen (a yard).
    -- POSTAL_ONLY: a delivery point that is not an operating place (PO box,
    -- registered-office service address). Only PHYSICAL places can be a Home Yard.
    kind text NOT NULL,

    status text NOT NULL DEFAULT 'active',
    archived_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT locations_kind_valid
        CHECK (kind IN ('PHYSICAL', 'POSTAL_ONLY')),

    CONSTRAINT locations_status_valid
        CHECK (status IN ('active', 'archived')),

    CONSTRAINT locations_archive_state_consistent
        CHECK (
            (status = 'archived' AND archived_at IS NOT NULL)
            OR
            (status = 'active' AND archived_at IS NULL)
        ),

    -- Target of the (location_id, location_kind) foreign key on assignments.
    CONSTRAINT locations_id_kind_uq
        UNIQUE (id, kind)
);


-- ============================================================
-- 2. Location addresses (immutable content versions)
-- ============================================================

CREATE TABLE public.location_addresses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    location_id uuid NOT NULL
        REFERENCES public.locations(id)
        ON DELETE RESTRICT,

    -- Displayable address, exactly as recorded (trimmed, whitespace collapsed).
    country_code text NOT NULL,
    region_code text NOT NULL,
    locality text NOT NULL,
    postal_code text,
    address_line_1 text NOT NULL,
    address_line_2 text,
    unit text,

    -- Normalized postal code, for matching only.
    postal_code_normalized text,

    -- ADVISORY matching keys derived by the server. They are never unique and
    -- never prove that two Locations are the same place:
    --   building: country | region | locality | postal base | street line
    --   unit:     building key | unit | line 2   (distinct suites stay distinct)
    match_key_building text NOT NULL,
    match_key_unit text NOT NULL,

    -- How this version came to exist.
    version_reason text NOT NULL,

    -- Business time (may be backdated).
    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    -- 'active': asserted true for [effective_from, effective_to).
    -- 'corrected': known to have been wrongly recorded; preserved, never a
    -- genuine business fact. effective_to is not used to end a corrected row.
    status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_address_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT location_addresses_country_code_valid
        CHECK (country_code ~ '^[A-Z]{2}$'),

    CONSTRAINT location_addresses_region_code_valid
        CHECK (region_code ~ '^[A-Z0-9]{1,8}$'),

    CONSTRAINT location_addresses_locality_not_blank
        CHECK (btrim(locality) <> ''),

    CONSTRAINT location_addresses_line_1_not_blank
        CHECK (btrim(address_line_1) <> ''),

    CONSTRAINT location_addresses_optional_text_not_blank
        CHECK (
            (postal_code IS NULL OR btrim(postal_code) <> '')
            AND (address_line_2 IS NULL OR btrim(address_line_2) <> '')
            AND (unit IS NULL OR btrim(unit) <> '')
        ),

    CONSTRAINT location_addresses_postal_pair_consistent
        CHECK (
            (postal_code IS NULL) = (postal_code_normalized IS NULL)
            AND (postal_code_normalized IS NULL OR btrim(postal_code_normalized) <> '')
        ),

    CONSTRAINT location_addresses_match_keys_not_blank
        CHECK (btrim(match_key_building) <> '' AND btrim(match_key_unit) <> ''),

    CONSTRAINT location_addresses_version_reason_valid
        CHECK (version_reason IN ('INITIAL', 'POSTAL_CHANGE', 'CORRECTION')),

    CONSTRAINT location_addresses_status_valid
        CHECK (status IN ('active', 'corrected')),

    CONSTRAINT location_addresses_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT location_addresses_correction_state_consistent
        CHECK (
            (status = 'active' AND corrected_at IS NULL AND superseded_by_address_id IS NULL)
            OR
            (status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_address_id IS NOT NULL)
        ),

    CONSTRAINT location_addresses_not_superseded_by_self
        CHECK (superseded_by_address_id IS NULL OR superseded_by_address_id <> id),

    -- Target of the same-location replacement foreign key below.
    CONSTRAINT location_addresses_id_location_uq
        UNIQUE (id, location_id),

    -- A corrected version points to its replacement, which must belong to the
    -- same Location. Deferred so the correction can mark the old row and create
    -- its replacement in either order inside one transaction.
    CONSTRAINT location_addresses_superseded_by_fk
        FOREIGN KEY (superseded_by_address_id, location_id)
        REFERENCES public.location_addresses (id, location_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- Exactly one CURRENT address version per Location. Corrected rows never count.
CREATE UNIQUE INDEX location_addresses_current_uq
    ON public.location_addresses (location_id)
    WHERE status = 'active' AND effective_to IS NULL;

-- History / as-of reads for one Location.
CREATE INDEX location_addresses_location_history_idx
    ON public.location_addresses (location_id, effective_from);

-- Advisory matching (deliberately NOT unique).
CREATE INDEX location_addresses_match_building_idx
    ON public.location_addresses (match_key_building)
    WHERE status = 'active' AND effective_to IS NULL;

CREATE INDEX location_addresses_match_unit_idx
    ON public.location_addresses (match_key_unit)
    WHERE status = 'active' AND effective_to IS NULL;


-- ============================================================
-- 3. Organization location assignments
-- ============================================================

CREATE TABLE public.organization_location_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    location_id uuid NOT NULL,

    -- Copy of locations.kind, bound by the composite foreign key below so the
    -- database itself guarantees a HOME_YARD can only be a PHYSICAL Location.
    -- locations.kind cannot change while any assignment references it.
    location_kind text NOT NULL,

    role text NOT NULL,

    -- Business time (may be backdated).
    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    -- CHANGED: replaced by another assignment of the same role.
    -- CEASED: the Organization stopped using the role with no replacement.
    end_reason text,

    -- 'active': asserted true for [effective_from, effective_to).
    -- 'corrected': known to have been wrongly recorded; preserved, never a genuine
    -- business fact, and never ended (effective_to / end_reason stay as recorded).
    status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_assignment_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT organization_location_assignments_location_fk
        FOREIGN KEY (location_id, location_kind)
        REFERENCES public.locations (id, kind)
        ON DELETE RESTRICT,

    CONSTRAINT organization_location_assignments_role_valid
        CHECK (role IN ('REGISTERED', 'MAILING', 'HOME_YARD')),

    CONSTRAINT organization_location_assignments_home_yard_physical
        CHECK (role <> 'HOME_YARD' OR location_kind = 'PHYSICAL'),

    CONSTRAINT organization_location_assignments_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT organization_location_assignments_end_state_consistent
        CHECK (
            (effective_to IS NULL AND end_reason IS NULL)
            OR
            (effective_to IS NOT NULL AND end_reason IN ('CHANGED', 'CEASED'))
        ),

    CONSTRAINT organization_location_assignments_status_valid
        CHECK (status IN ('active', 'corrected')),

    CONSTRAINT organization_location_assignments_correction_state_consistent
        CHECK (
            (status = 'active' AND corrected_at IS NULL AND superseded_by_assignment_id IS NULL)
            OR
            (status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_assignment_id IS NOT NULL)
        ),

    CONSTRAINT organization_location_assignments_not_superseded_by_self
        CHECK (superseded_by_assignment_id IS NULL OR superseded_by_assignment_id <> id),

    -- Target of the same-Organization-and-role replacement foreign key below.
    CONSTRAINT organization_location_assignments_id_org_role_uq
        UNIQUE (id, organization_id, role),

    -- A corrected assignment points to its replacement, which must belong to the
    -- same Organization and role. Deferred so the correction can mark the old row
    -- and create its replacement in either order inside one transaction.
    CONSTRAINT organization_location_assignments_superseded_by_fk
        FOREIGN KEY (superseded_by_assignment_id, organization_id, role)
        REFERENCES public.organization_location_assignments (id, organization_id, role)
        DEFERRABLE INITIALLY DEFERRED
);

-- At most one CURRENT assignment per Organization per role. Corrected rows never
-- count (they are known-wrong and never ended). The server
-- serializes writers with a row lock on the Organization; this index is the
-- final concurrency backstop. The same Location may hold several roles.
CREATE UNIQUE INDEX organization_location_assignments_current_role_uq
    ON public.organization_location_assignments (organization_id, role)
    WHERE status = 'active' AND effective_to IS NULL;

CREATE INDEX organization_location_assignments_org_history_idx
    ON public.organization_location_assignments (organization_id, role, effective_from);

-- Which Organizations use a Location; also supports the foreign key checks.
CREATE INDEX organization_location_assignments_location_idx
    ON public.organization_location_assignments (location_id);


-- ============================================================
-- 4. Integrity triggers
--
-- Enforced in the database so they do not depend on application code and apply
-- to the table owner as well (same approach as 0008 / 0010).
-- ============================================================

-- No hard delete or truncate of Location data, ever.
CREATE FUNCTION tes_security.prevent_location_data_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Location data is preserved; % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- Address content is immutable. Only these one-way changes are permitted:
--   - effective_to: NULL -> value (a real-world change ends the version)
--   - status: active -> corrected, together with corrected_at and
--     superseded_by_address_id (a known-wrong version is superseded)
-- A corrected version is frozen entirely.
CREATE FUNCTION tes_security.guard_location_address_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected location address version is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.location_id IS DISTINCT FROM OLD.location_id
       OR NEW.country_code IS DISTINCT FROM OLD.country_code
       OR NEW.region_code IS DISTINCT FROM OLD.region_code
       OR NEW.locality IS DISTINCT FROM OLD.locality
       OR NEW.postal_code IS DISTINCT FROM OLD.postal_code
       OR NEW.postal_code_normalized IS DISTINCT FROM OLD.postal_code_normalized
       OR NEW.address_line_1 IS DISTINCT FROM OLD.address_line_1
       OR NEW.address_line_2 IS DISTINCT FROM OLD.address_line_2
       OR NEW.unit IS DISTINCT FROM OLD.unit
       OR NEW.match_key_building IS DISTINCT FROM OLD.match_key_building
       OR NEW.match_key_unit IS DISTINCT FROM OLD.match_key_unit
       OR NEW.version_reason IS DISTINCT FROM OLD.version_reason
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Location address content is immutable; record a change or a correction as a new version'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended location address version cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- Location identity and kind are immutable. A Location with a current
-- assignment cannot be archived.
CREATE FUNCTION tes_security.guard_location_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Location identity and kind are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'active' AND NEW.status = 'archived' THEN
        IF EXISTS (
            SELECT 1
              FROM public.organization_location_assignments AS a
             WHERE a.location_id = OLD.id
               AND a.status = 'active'
               AND a.effective_to IS NULL
        ) THEN
            RAISE EXCEPTION 'A Location with a current Organization assignment cannot be archived'
                USING ERRCODE = '55000',
                      CONSTRAINT = 'locations_archive_requires_no_current_assignment';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- A new assignment must reference an ACTIVE Location. The row is locked FOR
-- SHARE so a concurrent archive (which updates the row) and a concurrent
-- assignment cannot both succeed.
CREATE FUNCTION tes_security.guard_assignment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.locations AS l
         WHERE l.id = NEW.location_id
           AND l.status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'An assignment must reference an active Location'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'organization_location_assignments_location_active';
    END IF;

    RETURN NEW;
END;
$$;

-- An assignment keeps its identity. The only permitted changes are one-way:
--   - ending it once (effective_to + end_reason, a real-world lifecycle event)
--   - active -> corrected with corrected_at and superseded_by_assignment_id (a
--     known-wrong record is superseded; it is NOT ended, so its effective_to and
--     end_reason must stay exactly as recorded)
-- A corrected assignment is frozen entirely.
CREATE FUNCTION tes_security.guard_assignment_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected Organization location assignment is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.location_id IS DISTINCT FROM OLD.location_id
       OR NEW.location_kind IS DISTINCT FROM OLD.location_kind
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Organization location assignments are immutable except ending or correcting them'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL
       AND (NEW.effective_to IS DISTINCT FROM OLD.effective_to
            OR NEW.end_reason IS DISTINCT FROM OLD.end_reason)
    THEN
        RAISE EXCEPTION 'An ended Organization location assignment cannot be changed'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.status = 'corrected'
       AND (NEW.effective_to IS DISTINCT FROM OLD.effective_to
            OR NEW.end_reason IS DISTINCT FROM OLD.end_reason)
    THEN
        RAISE EXCEPTION 'A correction does not end an assignment; it must not set effective_to or end_reason'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- Every Location must have a current address version by the end of the
-- transaction that created it.
CREATE FUNCTION tes_security.require_current_location_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.location_addresses AS a
         WHERE a.location_id = NEW.id
           AND a.status = 'active'
           AND a.effective_to IS NULL
    ) THEN
        RAISE EXCEPTION 'A Location must have a current address version'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'locations_require_current_address';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_location_data_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_location_address_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_location_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_assignment_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_assignment_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.require_current_location_address() FROM PUBLIC;

CREATE TRIGGER locations_guard_update
BEFORE UPDATE ON public.locations
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_location_update();

CREATE CONSTRAINT TRIGGER locations_require_current_address
AFTER INSERT ON public.locations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_current_location_address();

CREATE TRIGGER location_addresses_guard_update
BEFORE UPDATE ON public.location_addresses
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_location_address_update();

CREATE TRIGGER organization_location_assignments_guard_insert
BEFORE INSERT ON public.organization_location_assignments
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_assignment_insert();

CREATE TRIGGER organization_location_assignments_guard_update
BEFORE UPDATE ON public.organization_location_assignments
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_assignment_update();

CREATE TRIGGER locations_no_delete
BEFORE DELETE ON public.locations
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_location_data_removal();

CREATE TRIGGER location_addresses_no_delete
BEFORE DELETE ON public.location_addresses
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_location_data_removal();

CREATE TRIGGER organization_location_assignments_no_delete
BEFORE DELETE ON public.organization_location_assignments
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_location_data_removal();

CREATE TRIGGER locations_no_truncate
BEFORE TRUNCATE ON public.locations
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_location_data_removal();

CREATE TRIGGER location_addresses_no_truncate
BEFORE TRUNCATE ON public.location_addresses
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_location_data_removal();

CREATE TRIGGER organization_location_assignments_no_truncate
BEFORE TRUNCATE ON public.organization_location_assignments
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_location_data_removal();


-- ============================================================
-- 5. Runtime privileges
--
-- Migration 0002 removed automatic runtime privileges, so everything below is
-- deliberate and object-specific. The runtime identity gets no DELETE and no
-- TRUNCATE, may not rewrite address content or assignment identity, and may not
-- change a Location's identity or kind.
-- ============================================================

REVOKE ALL
ON TABLE
    public.locations,
    public.location_addresses,
    public.organization_location_assignments
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.locations,
    public.location_addresses,
    public.organization_location_assignments
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (kind)
ON public.locations
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (status, archived_at, updated_at)
ON public.locations
TO "tes-backend@tes-production-510007.iam";

-- id is insertable so a correction can name its replacement before creating it.
GRANT INSERT (
    id,
    location_id,
    country_code,
    region_code,
    locality,
    postal_code,
    postal_code_normalized,
    address_line_1,
    address_line_2,
    unit,
    match_key_building,
    match_key_unit,
    version_reason,
    effective_from
)
ON public.location_addresses
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, status, corrected_at, superseded_by_address_id, updated_at)
ON public.location_addresses
TO "tes-backend@tes-production-510007.iam";

-- id is insertable so a correction can name its replacement before creating it.
-- effective_to / end_reason are insertable so that the replacement of an already
-- ended assignment (a correction of history) can carry the same business window.
GRANT INSERT (
    id,
    organization_id,
    location_id,
    location_kind,
    role,
    effective_from,
    effective_to,
    end_reason
)
ON public.organization_location_assignments
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, end_reason, status, corrected_at, superseded_by_assignment_id, updated_at)
ON public.organization_location_assignments
TO "tes-backend@tes-production-510007.iam";
