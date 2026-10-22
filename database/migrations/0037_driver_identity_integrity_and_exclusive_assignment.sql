-- TES Drivers: identity integrity and exclusive company assignment
-- Migration: 0037
--
-- Scope (ADDITIVE; migrations 0001-0036 are not edited; no existing driver, licence or relationship row is rewritten, merged, ended or removed):
--   1. ONE server-authoritative jurisdiction and licence-number canonicalization, in the database, so uniqueness cannot be bypassed through case,
--      whitespace or an equivalent jurisdiction spelling ("Canada" = "CA", "Ontario" = "ON"):
--        tes_security.canonical_country_code / canonical_region_code / canonical_licence_number   (IMMUTABLE)
--        BEFORE INSERT trigger on driver_licences that stores ONLY the canonical forms (whatever the caller supplied)
--        unique index + exclusion constraint on the canonical expressions, which also catch older rows stored in a non-canonical spelling
--   2. Exclusive assignment: one driver identity may hold only ONE open company assignment across TES
--        organization_driver_open_assignment_uq           one open (effective_to IS NULL) active row per person
--        organization_driver_assignment_no_overlap        no two active periods of one person overlap, in ANY company
--      ONBOARDING, ACTIVE, SUSPENDED and ON_LEAVE are all open assignments. ON_LEAVE is added to the status vocabulary.
--   3. Safe end and transfer: closing a row records WHEN (closed_at, one clock reading shared with the successor's activated_at) and WHY
--      (end_reason), links the two rows of a transfer (transfer_id), and a same-day end is allowed (effective_to >= effective_from; the empty
--      period [D, D) never overlaps the successor's [D, ...)).
--      Two time dimensions: business dates (effective_from/to) and recording instants (activated_at/closed_at); an empty same-day period is
--      legal only with instants, and the instants of one driver never overlap.
--      A driver pending identity review (unresolved PERSON resolution case) cannot get a new open assignment from ANY caller (narrow
--      SECURITY DEFINER check; no identity-resolution visibility is granted).
--   Jurisdictions are validated as pairs: the region must belong to the country (Canada, United States, Mexico; tes_security.region_country).
--   4. Verified identity: driver_identity_verifications, an append-only, evidence-backed event log. Capability DRIVER_IDENTITY_VERIFY (SYSTEM).
--
-- The migration REFUSES to apply (nothing changes) when existing rows already violate a rule it would enforce; the message names the rule and
-- scripts/database/preflight-0037-driver-identity.sql lists the offending rows. No record is ever merged, ended or deleted automatically.

-- ============================================================
-- 1. Canonical jurisdiction and licence-number functions
-- ============================================================

-- The canonical functions fold accents (NFC normalization, accent stripping) and therefore need a UTF8 database.
DO $$
BEGIN
    IF pg_catalog.getdatabaseencoding() <> 'UTF8' THEN
        RAISE EXCEPTION 'Migration 0037 needs a UTF8 database (this one is %). Nothing was changed.', pg_catalog.getdatabaseencoding();
    END IF;
END;
$$;

CREATE FUNCTION tes_security.canonical_country_code(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE v text;
BEGIN
    v := replace(replace(upper(btrim(regexp_replace(translate(normalize(coalesce(p_value, ''), NFC), 'ÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÑÇáàâäéèêëíìîïóòôöúùûüñç', 'AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc'), '[\s_-]+', ' ', 'g'))), '.', ''), ',', '');
    RETURN CASE
      WHEN v IN ('CA', 'CAN', 'CANADA') THEN 'CA'
      WHEN v IN ('US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA') THEN 'US'
      WHEN v IN ('MX', 'MEX', 'MEXICO') THEN 'MX'
      ELSE v
    END;
END;
$$;

CREATE FUNCTION tes_security.canonical_region_code(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE v text;
BEGIN
    v := replace(replace(upper(btrim(regexp_replace(translate(normalize(coalesce(p_value, ''), NFC), 'ÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÑÇáàâäéèêëíìîïóòôöúùûüñç', 'AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc'), '[\s_-]+', ' ', 'g'))), '.', ''), ',', '');
    RETURN CASE
      WHEN v IN ('ALBERTA') THEN 'AB'
      WHEN v IN ('BRITISH COLUMBIA') THEN 'BC'
      WHEN v IN ('MANITOBA') THEN 'MB'
      WHEN v IN ('NEW BRUNSWICK') THEN 'NB'
      WHEN v IN ('NEWFOUNDLAND AND LABRADOR', 'NEWFOUNDLAND') THEN 'NL'
      WHEN v IN ('NOVA SCOTIA') THEN 'NS'
      WHEN v IN ('NORTHWEST TERRITORIES') THEN 'NT'
      WHEN v IN ('NUNAVUT') THEN 'NU'
      WHEN v IN ('ONTARIO') THEN 'ON'
      WHEN v IN ('PRINCE EDWARD ISLAND') THEN 'PE'
      WHEN v IN ('QUEBEC') THEN 'QC'
      WHEN v IN ('SASKATCHEWAN') THEN 'SK'
      WHEN v IN ('YUKON') THEN 'YT'
      WHEN v IN ('ALABAMA') THEN 'AL'
      WHEN v IN ('ALASKA') THEN 'AK'
      WHEN v IN ('ARIZONA') THEN 'AZ'
      WHEN v IN ('ARKANSAS') THEN 'AR'
      WHEN v IN ('CALIFORNIA') THEN 'CA'
      WHEN v IN ('COLORADO') THEN 'CO'
      WHEN v IN ('CONNECTICUT') THEN 'CT'
      WHEN v IN ('DELAWARE') THEN 'DE'
      WHEN v IN ('DISTRICT OF COLUMBIA', 'WASHINGTON DC') THEN 'DC'
      WHEN v IN ('FLORIDA') THEN 'FL'
      WHEN v IN ('GEORGIA') THEN 'GA'
      WHEN v IN ('HAWAII') THEN 'HI'
      WHEN v IN ('IDAHO') THEN 'ID'
      WHEN v IN ('ILLINOIS') THEN 'IL'
      WHEN v IN ('INDIANA') THEN 'IN'
      WHEN v IN ('IOWA') THEN 'IA'
      WHEN v IN ('KANSAS') THEN 'KS'
      WHEN v IN ('KENTUCKY') THEN 'KY'
      WHEN v IN ('LOUISIANA') THEN 'LA'
      WHEN v IN ('MAINE') THEN 'ME'
      WHEN v IN ('MARYLAND') THEN 'MD'
      WHEN v IN ('MASSACHUSETTS') THEN 'MA'
      WHEN v IN ('MICHIGAN') THEN 'MI'
      WHEN v IN ('MINNESOTA') THEN 'MN'
      WHEN v IN ('MISSISSIPPI') THEN 'MS'
      WHEN v IN ('MISSOURI') THEN 'MO'
      WHEN v IN ('MONTANA') THEN 'MT'
      WHEN v IN ('NEBRASKA') THEN 'NE'
      WHEN v IN ('NEVADA') THEN 'NV'
      WHEN v IN ('NEW HAMPSHIRE') THEN 'NH'
      WHEN v IN ('NEW JERSEY') THEN 'NJ'
      WHEN v IN ('NEW MEXICO') THEN 'NM'
      WHEN v IN ('NEW YORK') THEN 'NY'
      WHEN v IN ('NORTH CAROLINA') THEN 'NC'
      WHEN v IN ('NORTH DAKOTA') THEN 'ND'
      WHEN v IN ('OHIO') THEN 'OH'
      WHEN v IN ('OKLAHOMA') THEN 'OK'
      WHEN v IN ('OREGON') THEN 'OR'
      WHEN v IN ('PENNSYLVANIA') THEN 'PA'
      WHEN v IN ('RHODE ISLAND') THEN 'RI'
      WHEN v IN ('SOUTH CAROLINA') THEN 'SC'
      WHEN v IN ('SOUTH DAKOTA') THEN 'SD'
      WHEN v IN ('TENNESSEE') THEN 'TN'
      WHEN v IN ('TEXAS') THEN 'TX'
      WHEN v IN ('UTAH') THEN 'UT'
      WHEN v IN ('VERMONT') THEN 'VT'
      WHEN v IN ('VIRGINIA') THEN 'VA'
      WHEN v IN ('WASHINGTON') THEN 'WA'
      WHEN v IN ('WEST VIRGINIA') THEN 'WV'
      WHEN v IN ('WISCONSIN') THEN 'WI'
      WHEN v IN ('WYOMING') THEN 'WY'
      WHEN v IN ('PUERTO RICO') THEN 'PR'
      WHEN v IN ('GUAM') THEN 'GU'
      WHEN v IN ('US VIRGIN ISLANDS', 'UNITED STATES VIRGIN ISLANDS') THEN 'VI'
      WHEN v IN ('AMERICAN SAMOA') THEN 'AS'
      WHEN v IN ('NORTHERN MARIANA ISLANDS') THEN 'MP'
      WHEN v IN ('AGUASCALIENTES') THEN 'AGU'
      WHEN v IN ('BAJA CALIFORNIA') THEN 'BCN'
      WHEN v IN ('BAJA CALIFORNIA SUR') THEN 'BCS'
      WHEN v IN ('CAMPECHE') THEN 'CAM'
      WHEN v IN ('CHIAPAS') THEN 'CHP'
      WHEN v IN ('CHIHUAHUA') THEN 'CHH'
      WHEN v IN ('CIUDAD DE MEXICO', 'MEXICO CITY', 'DISTRITO FEDERAL') THEN 'CMX'
      WHEN v IN ('COAHUILA') THEN 'COA'
      WHEN v IN ('COLIMA') THEN 'COL'
      WHEN v IN ('DURANGO') THEN 'DUR'
      WHEN v IN ('GUANAJUATO') THEN 'GUA'
      WHEN v IN ('GUERRERO') THEN 'GRO'
      WHEN v IN ('HIDALGO') THEN 'HID'
      WHEN v IN ('JALISCO') THEN 'JAL'
      WHEN v IN ('ESTADO DE MEXICO') THEN 'MEX'
      WHEN v IN ('MICHOACAN') THEN 'MIC'
      WHEN v IN ('MORELOS') THEN 'MOR'
      WHEN v IN ('NAYARIT') THEN 'NAY'
      WHEN v IN ('NUEVO LEON') THEN 'NLE'
      WHEN v IN ('OAXACA') THEN 'OAX'
      WHEN v IN ('PUEBLA') THEN 'PUE'
      WHEN v IN ('QUERETARO') THEN 'QUE'
      WHEN v IN ('QUINTANA ROO') THEN 'ROO'
      WHEN v IN ('SAN LUIS POTOSI') THEN 'SLP'
      WHEN v IN ('SINALOA') THEN 'SIN'
      WHEN v IN ('SONORA') THEN 'SON'
      WHEN v IN ('TABASCO') THEN 'TAB'
      WHEN v IN ('TAMAULIPAS') THEN 'TAM'
      WHEN v IN ('TLAXCALA') THEN 'TLA'
      WHEN v IN ('VERACRUZ') THEN 'VER'
      WHEN v IN ('YUCATAN') THEN 'YUC'
      WHEN v IN ('ZACATECAS') THEN 'ZAC'
      ELSE v
    END;
END;
$$;

-- The country that owns a CANONICAL region code (province, state or territory), or NULL. Region codes are unique across the supported
-- countries (Canada, United States, Mexico), so a code identifies its country; a country-region pair is valid only when they agree.
CREATE FUNCTION tes_security.region_country(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ SELECT CASE
      WHEN p_code IN ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT') THEN 'CA'
      WHEN p_code IN ('AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'GU', 'VI', 'AS', 'MP') THEN 'US'
      WHEN p_code IN ('AGU', 'BCN', 'BCS', 'CAM', 'CHP', 'CHH', 'CMX', 'COA', 'COL', 'DUR', 'GUA', 'GRO', 'HID', 'JAL', 'MEX', 'MIC', 'MOR', 'NAY', 'NLE', 'OAX', 'PUE', 'QUE', 'ROO', 'SLP', 'SIN', 'SON', 'TAB', 'TAM', 'TLA', 'VER', 'YUC', 'ZAC') THEN 'MX'
      ELSE NULL
    END $$;

CREATE FUNCTION tes_security.canonical_licence_number(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ SELECT upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g')) $$;

REVOKE ALL ON FUNCTION tes_security.canonical_country_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.canonical_region_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.canonical_licence_number(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.region_country(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.canonical_country_code(text) TO "tes-backend@tes-production-510007.iam";
GRANT EXECUTE ON FUNCTION tes_security.canonical_region_code(text) TO "tes-backend@tes-production-510007.iam";
GRANT EXECUTE ON FUNCTION tes_security.canonical_licence_number(text) TO "tes-backend@tes-production-510007.iam";
GRANT EXECUTE ON FUNCTION tes_security.region_country(text) TO "tes-backend@tes-production-510007.iam";

-- ============================================================
-- 2. Refuse to apply over existing conflicts (nothing is changed)
-- ============================================================

DO $$
DECLARE
    colliding integer;
    overlapping integer;
    open_multi integer;
    assignment_overlap integer;
BEGIN
    SELECT count(*) INTO colliding FROM (
        SELECT 1 FROM public.driver_licences
         WHERE record_status = 'active' AND effective_to IS NULL
         GROUP BY tes_security.canonical_country_code(jurisdiction_country), tes_security.canonical_region_code(jurisdiction_region), tes_security.canonical_licence_number(licence_number_normalized)
        HAVING count(*) > 1
    ) g;
    IF colliding > 0 THEN
        RAISE EXCEPTION 'Migration 0037 cannot be applied: % group(s) of current driver licences hold the same licence under equivalent jurisdiction representations (for example "Canada" and "CA"). Nothing was changed. Resolve them first; scripts/database/preflight-0037-driver-identity.sql lists them.', colliding
            USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO overlapping FROM public.driver_licences a JOIN public.driver_licences b ON a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
        AND tes_security.canonical_country_code(a.jurisdiction_country) = tes_security.canonical_country_code(b.jurisdiction_country)
        AND tes_security.canonical_region_code(a.jurisdiction_region) = tes_security.canonical_region_code(b.jurisdiction_region)
        AND tes_security.canonical_licence_number(a.licence_number_normalized) = tes_security.canonical_licence_number(b.licence_number_normalized)
        AND daterange(a.effective_from, a.effective_to, '[)') && daterange(b.effective_from, b.effective_to, '[)');
    IF overlapping > 0 THEN
        RAISE EXCEPTION 'Migration 0037 cannot be applied: % pair(s) of driver licence periods overlap under equivalent jurisdiction representations. Nothing was changed.', overlapping
            USING ERRCODE = '23P01';
    END IF;

    SELECT count(*) INTO open_multi FROM (
        SELECT person_id FROM public.organization_driver_relationships
         WHERE record_status = 'active' AND effective_to IS NULL
         GROUP BY person_id HAVING count(*) > 1
    ) g;
    IF open_multi > 0 THEN
        RAISE EXCEPTION 'Migration 0037 cannot be applied: % driver identit(y/ies) hold more than one open company assignment. TES allows one. Nothing was changed; they must be resolved by an authorized review (no record is merged or ended automatically). See scripts/database/preflight-0037-driver-identity.sql.', open_multi
            USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO assignment_overlap FROM public.organization_driver_relationships a JOIN public.organization_driver_relationships b ON a.id < b.id AND a.person_id = b.person_id
        AND a.record_status = 'active' AND b.record_status = 'active'
        AND daterange(a.effective_from, a.effective_to, '[)') && daterange(b.effective_from, b.effective_to, '[)');
    IF assignment_overlap > 0 THEN
        RAISE EXCEPTION 'Migration 0037 cannot be applied: % pair(s) of driver assignment periods overlap for one driver identity. Nothing was changed. See scripts/database/preflight-0037-driver-identity.sql.', assignment_overlap
            USING ERRCODE = '23P01';
    END IF;
END;
$$;

-- ============================================================
-- 3. driver_licences: canonical storage and canonical uniqueness
-- ============================================================

CREATE FUNCTION tes_security.canonicalize_driver_licence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.jurisdiction_country := tes_security.canonical_country_code(NEW.jurisdiction_country);
    NEW.jurisdiction_region := tes_security.canonical_region_code(NEW.jurisdiction_region);
    NEW.licence_number_normalized := tes_security.canonical_licence_number(NEW.licence_number_display);
    IF NEW.jurisdiction_country NOT IN ('CA', 'US', 'MX') THEN
        RAISE EXCEPTION 'The licence country must be Canada, the United States or Mexico' USING ERRCODE = '23514';
    END IF;
    IF tes_security.region_country(NEW.jurisdiction_region) IS DISTINCT FROM NEW.jurisdiction_country THEN
        RAISE EXCEPTION 'The licence jurisdiction must be a province, state or territory of the licence country' USING ERRCODE = '23514';
    END IF;
    IF NEW.licence_number_normalized = '' THEN
        RAISE EXCEPTION 'The licence number must contain letters or digits' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.canonicalize_driver_licence() FROM PUBLIC;

-- Fires BEFORE driver_licences_insert_guard (triggers run in name order), so the guard and every index see canonical values.
CREATE TRIGGER driver_licences_canonical_identity
    BEFORE INSERT ON public.driver_licences
    FOR EACH ROW EXECUTE FUNCTION tes_security.canonicalize_driver_licence();

CREATE UNIQUE INDEX driver_licences_current_canonical_identity_uq
    ON public.driver_licences (
        tes_security.canonical_country_code(jurisdiction_country),
        tes_security.canonical_region_code(jurisdiction_region),
        tes_security.canonical_licence_number(licence_number_normalized)
    )
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE UNIQUE INDEX driver_licences_person_current_canonical_jurisdiction_uq
    ON public.driver_licences (
        person_id,
        tes_security.canonical_country_code(jurisdiction_country),
        tes_security.canonical_region_code(jurisdiction_region)
    )
    WHERE record_status = 'active' AND effective_to IS NULL;

ALTER TABLE public.driver_licences
    ADD CONSTRAINT driver_licences_canonical_identity_no_overlap
    EXCLUDE USING gist (
        tes_security.canonical_country_code(jurisdiction_country) WITH =,
        tes_security.canonical_region_code(jurisdiction_region) WITH =,
        tes_security.canonical_licence_number(licence_number_normalized) WITH =,
        daterange(effective_from, effective_to, '[)') WITH &&
    )
    WHERE (record_status = 'active');

-- ============================================================
-- 4. organization_driver_relationships: vocabulary, same-day end, close/transfer bookkeeping
-- ============================================================

DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'public.organization_driver_relationships'::regclass AND contype = 'c'
           AND (pg_get_constraintdef(oid) LIKE '%ONBOARDING%' OR pg_get_constraintdef(oid) LIKE '%effective_to > effective_from%')
    LOOP
        EXECUTE format('ALTER TABLE public.organization_driver_relationships DROP CONSTRAINT %I', c.conname);
    END LOOP;
END;
$$;

ALTER TABLE public.organization_driver_relationships
    ADD CONSTRAINT organization_driver_relationships_status_vocabulary
        CHECK (status IN ('ONBOARDING', 'ACTIVE', 'SUSPENDED', 'ON_LEAVE', 'ENDED')),
    ADD CONSTRAINT organization_driver_relationships_period_order
        CHECK (effective_to IS NULL OR effective_to >= effective_from);

ALTER TABLE public.organization_driver_relationships
    ADD COLUMN activated_at timestamptz,
    ADD COLUMN closed_at timestamptz,
    ADD COLUMN end_reason text,
    ADD COLUMN transfer_id uuid;

ALTER TABLE public.organization_driver_relationships
    ADD CONSTRAINT organization_driver_relationships_end_reason_valid
        CHECK (end_reason IS NULL OR end_reason IN ('ENDED', 'TRANSFERRED')),
    ADD CONSTRAINT organization_driver_relationships_close_consistent
        CHECK ((closed_at IS NULL AND end_reason IS NULL)
            OR (closed_at IS NOT NULL AND end_reason IS NOT NULL AND effective_to IS NOT NULL AND status = 'ENDED')),
    ADD CONSTRAINT organization_driver_relationships_transfer_reason
        CHECK (transfer_id IS NULL OR end_reason IS NULL OR end_reason = 'TRANSFERRED');

-- Two time dimensions, deliberately kept apart:
--   effective_from / effective_to   BUSINESS dates ([from, to) ): when the assignment applied. Two periods of one driver never overlap.
--   activated_at / closed_at        RECORDING instants: when TES opened and closed the row (microsecond clock; a transfer shares ONE instant).
-- A same-day period [D, D) is empty as a date range, so the date constraint cannot see it; it is therefore only legal when it carries both
-- instants, and the instants of one driver's rows never overlap (so a same-day A -> B -> A chain is ordered, and a phantom same-day row for
-- a company cannot be inserted while another company holds the driver). Legacy rows (no instants) stay protected by the date constraint.
ALTER TABLE public.organization_driver_relationships
    ADD CONSTRAINT organization_driver_relationships_instants_ordered
        CHECK (activated_at IS NULL OR closed_at IS NULL OR closed_at >= activated_at),
    ADD CONSTRAINT organization_driver_relationships_closed_needs_instant
        CHECK (activated_at IS NULL OR effective_to IS NULL OR closed_at IS NOT NULL),
    ADD CONSTRAINT organization_driver_relationships_same_day_needs_instants
        CHECK (effective_to IS DISTINCT FROM effective_from OR (activated_at IS NOT NULL AND closed_at IS NOT NULL));

-- Exclusive assignment: ONE open assignment per driver identity across ALL companies, and no overlapping periods in any company.
CREATE UNIQUE INDEX organization_driver_open_assignment_uq
    ON public.organization_driver_relationships (person_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

ALTER TABLE public.organization_driver_relationships
    ADD CONSTRAINT organization_driver_assignment_no_overlap
    EXCLUDE USING gist (person_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&)
    WHERE (record_status = 'active');

ALTER TABLE public.organization_driver_relationships
    ADD CONSTRAINT organization_driver_assignment_instants_no_overlap
    EXCLUDE USING gist (person_id WITH =, tstzrange(activated_at, COALESCE(closed_at, 'infinity'::timestamptz), '[)') WITH &&)
    WHERE (record_status = 'active' AND activated_at IS NOT NULL);

-- A driver whose identity is pending review (an unresolved PERSON entity-resolution case names it) cannot be given a new open assignment, by ANY
-- writer: the application, a runtime session with any capability, or the table owner. Two functions, no role name in either:
--   guard_driver_assignment_identity()   the TRIGGER. SECURITY DEFINER so it can read the resolution tables whatever the writer may see; it returns
--                                        no data (a trigger function cannot be called from SQL), so it cannot be used as an oracle.
--   driver_identity_unresolved(uuid)     the SERVICE's pre-check, for a clean message. SECURITY DEFINER but it answers ONLY a caller whose system
--                                        context is authorized for driver management or verification (the same tes_security.system_context_authorized
--                                        test every RLS policy uses); any other caller, including a runtime session with no or another capability, is
--                                        refused with 42501. It returns one boolean for one person and widens no identity-resolution visibility.
-- Both pin search_path (pg_catalog, pg_temp last) and schema-qualify every object. Only the runtime principal is granted EXECUTE on the pre-check
-- (the repository's established GRANT pattern); nothing is granted on the trigger function.
CREATE FUNCTION tes_security.driver_identity_unresolved(p_person_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NOT tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE', 'DRIVER_IDENTITY_VERIFY']) THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
    RETURN EXISTS (
        SELECT 1 FROM public.entity_resolution_candidates c
          JOIN public.entity_resolution_cases k ON k.id = c.resolution_case_id
         WHERE c.candidate_person_id = p_person_id AND k.entity_type = 'PERSON' AND k.resolution_state IN ('PENDING', 'REVIEW_REQUIRED')
    );
END;
$$;
REVOKE ALL ON FUNCTION tes_security.driver_identity_unresolved(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.driver_identity_unresolved(uuid) TO "tes-backend@tes-production-510007.iam";

CREATE FUNCTION tes_security.guard_driver_assignment_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.record_status = 'active' AND NEW.effective_to IS NULL AND EXISTS (
        SELECT 1 FROM public.entity_resolution_candidates c
          JOIN public.entity_resolution_cases k ON k.id = c.resolution_case_id
         WHERE c.candidate_person_id = NEW.person_id AND k.entity_type = 'PERSON' AND k.resolution_state IN ('PENDING', 'REVIEW_REQUIRED')
    ) THEN
        RAISE EXCEPTION 'Driver identity is pending review; an assignment cannot be recorded until it is resolved' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_driver_assignment_identity() FROM PUBLIC;
CREATE TRIGGER organization_driver_relationships_identity_guard
    BEFORE INSERT ON public.organization_driver_relationships
    FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_assignment_identity();

GRANT INSERT (activated_at, transfer_id) ON public.organization_driver_relationships TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE (closed_at, end_reason, transfer_id) ON public.organization_driver_relationships TO "tes-backend@tes-production-510007.iam";

-- ============================================================
-- 5. Verified driver identity (append-only, evidence-backed)
-- ============================================================

INSERT INTO public.capabilities(code, display_name, description, is_active, sort_order)
VALUES (
    'DRIVER_IDENTITY_VERIFY',
    'Driver identity verification',
    'Record or revoke the verification of a driver identity against verified evidence. A matching name, date of birth or licence number never verifies identity. Intended scope: SYSTEM only.',
    true,
    265
);

CREATE TABLE public.driver_identity_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id uuid NOT NULL REFERENCES public.driver_profiles(person_id) ON DELETE RESTRICT,
    verification_status text NOT NULL,
    method text,
    organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
    evidence_document_id uuid,
    licence_id uuid,
    reason text,
    verified_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
    master_register_event_id uuid,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT driver_identity_verifications_status_valid CHECK (verification_status IN ('VERIFIED', 'REVOKED')),
    CONSTRAINT driver_identity_verifications_method_valid CHECK (method IS NULL OR method IN ('LICENCE_DOCUMENT_REVIEW', 'GOVERNMENT_ID_REVIEW', 'REGISTRY_CONFIRMATION')),
    CONSTRAINT driver_identity_verifications_reason_valid CHECK (reason IS NULL OR btrim(reason) <> ''),
    CONSTRAINT driver_identity_verifications_verified_needs_evidence CHECK (
        verification_status <> 'VERIFIED'
        OR (method IS NOT NULL AND organization_id IS NOT NULL AND evidence_document_id IS NOT NULL AND master_register_event_id IS NOT NULL)
    ),
    CONSTRAINT driver_identity_verifications_revoked_needs_reason CHECK (verification_status <> 'REVOKED' OR (reason IS NOT NULL AND master_register_event_id IS NOT NULL)),
    CONSTRAINT driver_identity_verifications_evidence_fk
        FOREIGN KEY (evidence_document_id, organization_id) REFERENCES public.evidence_documents (id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT driver_identity_verifications_licence_fk
        FOREIGN KEY (licence_id, person_id) REFERENCES public.driver_licences (id, person_id) ON DELETE RESTRICT
);
CREATE INDEX driver_identity_verifications_person_idx ON public.driver_identity_verifications (person_id, recorded_at DESC, id);
-- The same evidence document may support any number of events for the SAME driver (verify, revoke, verify again): re-verification never needs
-- a duplicate upload. It can never support a different driver: identity evidence is about one person.
CREATE FUNCTION tes_security.guard_driver_identity_evidence_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.evidence_document_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(NEW.evidence_document_id::text, 37));
        IF EXISTS (SELECT 1 FROM public.driver_identity_verifications v WHERE v.evidence_document_id = NEW.evidence_document_id AND v.person_id <> NEW.person_id) THEN
            RAISE EXCEPTION 'This evidence document already supports a different driver identity' USING ERRCODE = '23505';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tes_security.guard_driver_identity_evidence_person() FROM PUBLIC;
CREATE TRIGGER driver_identity_verifications_evidence_person BEFORE INSERT ON public.driver_identity_verifications
    FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_identity_evidence_person();

CREATE FUNCTION tes_security.prevent_driver_identity_verification_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Driver identity verification events are append-only'
        USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION tes_security.prevent_driver_identity_verification_mutation() FROM PUBLIC;

CREATE TRIGGER driver_identity_verifications_no_update BEFORE UPDATE ON public.driver_identity_verifications
    FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_identity_verification_mutation();
CREATE TRIGGER driver_identity_verifications_no_delete BEFORE DELETE ON public.driver_identity_verifications
    FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_driver_identity_verification_mutation();
CREATE TRIGGER driver_identity_verifications_no_truncate BEFORE TRUNCATE ON public.driver_identity_verifications
    FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_identity_verification_mutation();

ALTER TABLE public.driver_identity_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_identity_verifications_system ON public.driver_identity_verifications FOR ALL
    USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ', 'DRIVER_MANAGE', 'DRIVER_IDENTITY_VERIFY']))
    WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_IDENTITY_VERIFY']));

REVOKE ALL ON TABLE public.driver_identity_verifications FROM PUBLIC;
GRANT SELECT ON TABLE public.driver_identity_verifications TO "tes-backend@tes-production-510007.iam";
GRANT INSERT (id, person_id, verification_status, method, organization_id, evidence_document_id, licence_id, reason, verified_by_actor_id, master_register_event_id, recorded_at)
    ON TABLE public.driver_identity_verifications TO "tes-backend@tes-production-510007.iam";
