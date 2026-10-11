-- TES Companies: Company Operating Profile foundation
-- Migration: 0019
--
-- Scope (additive only):
--   1. public.company_profile_rules                  controlled catalogue of compliance applicability rules (seeded)
--   2. public.company_operating_scope_periods        effective-dated operating region of a company
--   3. public.company_rule_applicability_periods     effective-dated "this rule applies / does not apply to this company"
--   4. public.company_driver_requirement_periods     effective-dated company driver minimums (age, experience)
--   5. tes_security trigger functions and two SYSTEM-only capabilities (catalogue rows only, granted to nobody)
--
-- WHAT BELONGS HERE. Only settings that are genuinely company-scoped business facts that change what compliance
-- requirements TES derives for the company, and whose history matters (an audit asks "what did TES believe applied to this
-- company on that date?"). Each is a structured, validated, effective-dated fact with correction history:
--   - operating region     CANADA | UNITED_STATES | CANADA_AND_UNITED_STATES
--   - rule applicability   APPLIES | DOES_NOT_APPLY for a catalogued rule (dangerous goods, alcohol, tax programs, driver
--                          document requirements, memberships ...). A rule with no current assertion is NOT CONFIGURED
--                          (absence is meaningful); ending an assertion without replacing it returns the rule to
--                          not-configured.
--   - driver minimums      minimum driver age (years) and experience (months) the company requires
--
-- WHAT DOES NOT BELONG HERE (and where it lives):
--   Organization identity (0003), Locations (0012), operating authorities (0013), Contacts (0014), the Customer
--   relationship (0015), tax / carrier-code registrations (0016), insurance (0017), credentials (0018): all canonical in
--   their own domains and never mirrored. Application preferences (layout, saved tab) and user preferences are not company
--   business facts: they stay in the application / user-preference layer and receive no heavyweight history. Derived Rules
--   configuration is computed by the Rules layer from these facts and is never stored as a second source of truth. There
--   is deliberately NO generic key/value settings table: every persisted setting is a typed, validated column.
--
-- Catalogue. company_profile_rules is seeded from the rule vocabulary the Settings workspace already uses (45 rules in
-- sections CARGO, OPERATIONS, TAX, DRIVERS, PROGRAMS). Tax rules that correspond to a registration program point at it
-- (registration_program_code, 0016) so applicability and the actual registration can be compared without duplicating
-- either; Form 2290 has no registration identity and points at nothing. applies_to_region says which operating regions
-- the rule is relevant to (BOTH = either); default_applicability is the TES default assumption for a rule with no
-- assertion (informational, never written as an assertion). Adding a rule is a migration, so the vocabulary stays
-- controlled.
--
-- History conventions follow migrations 0012-0018: a real change ends the old period and starts a new one; a correction
-- marks the wrong period 'corrected' (never ended) with a deferred same-subject pointer to its replacement, which inherits
-- the business time; reads use 'active' periods only; nothing is deleted.
--
-- Global Organization facts: no tenant column and no row-level security; visibility is enforced by the server. All new
-- functions are SECURITY INVOKER with a fixed search_path; none is SECURITY DEFINER. No DELETE or TRUNCATE is granted and
-- none is possible (triggers). No existing object is touched. Reuses tes_security.guard_active_organization (0016).


-- ============================================================
-- 1. Rule catalogue
-- ============================================================

CREATE TABLE public.company_profile_rules (
    code text PRIMARY KEY,
    section text NOT NULL,
    display_name text NOT NULL,
    applies_to_region text NOT NULL,
    default_applicability text,

    -- The registration program (0016) this rule corresponds to, when there is one.
    registration_program_code text
        REFERENCES public.registration_programs(code)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT company_profile_rules_code_valid
        CHECK (code ~ '^[A-Z][A-Z0-9_]{1,47}$'),

    CONSTRAINT company_profile_rules_section_valid
        CHECK (section IN ('CARGO', 'OPERATIONS', 'TAX', 'DRIVERS', 'PROGRAMS')),

    CONSTRAINT company_profile_rules_display_name_not_blank
        CHECK (btrim(display_name) <> ''),

    CONSTRAINT company_profile_rules_region_valid
        CHECK (applies_to_region IN ('CANADA', 'UNITED_STATES', 'BOTH')),

    CONSTRAINT company_profile_rules_default_valid
        CHECK (default_applicability IS NULL OR default_applicability = 'APPLIES'),

    CONSTRAINT company_profile_rules_program_only_for_tax
        CHECK (registration_program_code IS NULL OR section = 'TAX'),

    CONSTRAINT company_profile_rules_sort_order_uq
        UNIQUE (sort_order)
);

CREATE UNIQUE INDEX company_profile_rules_program_uq
    ON public.company_profile_rules (registration_program_code)
    WHERE registration_program_code IS NOT NULL;

INSERT INTO public.company_profile_rules
    (code, section, display_name, applies_to_region, default_applicability, registration_program_code, sort_order)
VALUES
    ('DG_CANADA', 'CARGO', 'Dangerous goods in Canada', 'CANADA', 'APPLIES', NULL, 10),
    ('DG_US', 'CARGO', 'Hazardous materials in the United States', 'UNITED_STATES', 'APPLIES', NULL, 20),
    ('DG_WV_NV', 'CARGO', 'Dangerous goods in West Virginia or Nevada', 'UNITED_STATES', NULL, NULL, 30),
    ('DG_COLORADO', 'CARGO', 'Dangerous goods in Colorado', 'UNITED_STATES', NULL, NULL, 40),
    ('DG_IDAHO', 'CARGO', 'Dangerous goods in Idaho', 'UNITED_STATES', NULL, NULL, 50),
    ('TOBACCO_ONTARIO', 'CARGO', 'Tobacco transport in Ontario', 'CANADA', NULL, NULL, 60),
    ('ALCOHOL_US', 'CARGO', 'Alcohol transport in the United States', 'UNITED_STATES', NULL, NULL, 70),
    ('ALCOHOL_NJ', 'CARGO', 'Alcohol transport in New Jersey', 'UNITED_STATES', NULL, NULL, 80),
    ('ALCOHOL_TX', 'CARGO', 'Alcohol transport in Texas', 'UNITED_STATES', NULL, NULL, 90),
    ('ALCOHOL_KY', 'CARGO', 'Alcohol transport in Kentucky', 'UNITED_STATES', NULL, NULL, 100),
    ('ALCOHOL_IN', 'CARGO', 'Alcohol transport in Indiana', 'UNITED_STATES', NULL, NULL, 110),
    ('ALCOHOL_OH', 'CARGO', 'Alcohol transport in Ohio', 'UNITED_STATES', NULL, NULL, 120),
    ('ALCOHOL_NY', 'CARGO', 'Alcohol transport in New York', 'UNITED_STATES', NULL, NULL, 130),
    ('REEFER_CALIFORNIA', 'OPERATIONS', 'Refrigerated operations in California', 'UNITED_STATES', NULL, NULL, 140),
    ('IFTA', 'TAX', 'IFTA', 'BOTH', NULL, 'IFTA', 150),
    ('CT_HUF', 'TAX', 'Connecticut Highway Use Fee', 'UNITED_STATES', NULL, 'CT_HUF', 160),
    ('NY_HUT', 'TAX', 'New York Highway Use Tax', 'UNITED_STATES', NULL, 'NY_HUT', 170),
    ('KYU', 'TAX', 'Kentucky Weight Distance Tax / KYU', 'UNITED_STATES', NULL, 'KYU', 180),
    ('NM_WDT', 'TAX', 'New Mexico Weight Distance Tax', 'UNITED_STATES', NULL, 'NM_WDT', 190),
    ('OR_WMT', 'TAX', 'Oregon Weight-Mile Tax', 'UNITED_STATES', NULL, 'OR_WMT', 200),
    ('FORM_2290', 'TAX', 'Federal Heavy Highway Vehicle Use Tax — Form 2290', 'UNITED_STATES', NULL, NULL, 210),
    ('FUEL_CHARGE_REGISTRATION', 'TAX', 'Fuel Charge Registration', 'CANADA', NULL, 'FUEL_CHARGE', 220),
    ('TEXAS_EXCISE_TAX', 'TAX', 'Texas Excise Tax', 'UNITED_STATES', NULL, 'TX_EXCISE', 230),
    ('ARKANSAS_MOTOR_FUEL_TAX', 'TAX', 'Arkansas Motor Fuel Tax', 'UNITED_STATES', NULL, 'AR_MFT', 240),
    ('ONTARIO_TOBACCO_TAX', 'TAX', 'Ontario Tobacco Tax', 'CANADA', NULL, 'ON_TOBACCO', 250),
    ('BACKGROUND_CHECK', 'DRIVERS', 'Background check', 'BOTH', 'APPLIES', NULL, 260),
    ('ANNUAL_ROAD_TEST', 'DRIVERS', 'Annual road test', 'BOTH', 'APPLIES', NULL, 270),
    ('PRE_EMPLOYMENT_ROAD_TEST', 'DRIVERS', 'Pre-employment road test', 'BOTH', 'APPLIES', NULL, 280),
    ('PSP', 'DRIVERS', 'PSP screening', 'UNITED_STATES', NULL, NULL, 290),
    ('CANADIAN_DRUG_ALCOHOL', 'DRIVERS', 'Drug & alcohol testing for Canadian drivers', 'CANADA', 'APPLIES', NULL, 300),
    ('TAX_DOCUMENTS', 'DRIVERS', 'Driver tax documents', 'BOTH', 'APPLIES', NULL, 310),
    ('WORK_PERMIT', 'DRIVERS', 'Work permit', 'BOTH', NULL, NULL, 320),
    ('PERMANENT_RESIDENT_CARD', 'DRIVERS', 'Permanent resident card', 'BOTH', NULL, NULL, 330),
    ('STAFF_INCORPORATION', 'DRIVERS', 'Staff incorporation documents', 'BOTH', NULL, NULL, 340),
    ('PASSPORT_US', 'DRIVERS', 'Passport for US operations', 'UNITED_STATES', 'APPLIES', NULL, 350),
    ('VISA_US', 'DRIVERS', 'Visa for US operations', 'UNITED_STATES', NULL, NULL, 360),
    ('CTPAT', 'PROGRAMS', 'CTPAT', 'UNITED_STATES', NULL, NULL, 370),
    ('FAST', 'PROGRAMS', 'FAST', 'BOTH', NULL, NULL, 380),
    ('PIP', 'PROGRAMS', 'PIP', 'CANADA', NULL, NULL, 390),
    ('CSA', 'PROGRAMS', 'Customs Self Assessment', 'CANADA', NULL, NULL, 400),
    ('SMARTWAY', 'PROGRAMS', 'EPA SmartWay', 'UNITED_STATES', NULL, NULL, 410),
    ('COR', 'PROGRAMS', 'COR', 'CANADA', NULL, NULL, 420),
    ('PIC', 'PROGRAMS', 'Partners in Compliance', 'CANADA', NULL, NULL, 430),
    ('WEIGHT_TO_GO', 'PROGRAMS', 'Weight to Go', 'CANADA', NULL, NULL, 440),
    ('PREMIUM_CARRIER', 'PROGRAMS', 'Premium carrier designation', 'BOTH', NULL, NULL, 450);


-- ============================================================
-- 2. Operating scope periods
-- ============================================================

CREATE TABLE public.company_operating_scope_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    operating_scope text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_period_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT company_operating_scope_periods_scope_valid
        CHECK (operating_scope IN ('CANADA', 'UNITED_STATES', 'CANADA_AND_UNITED_STATES')),

    CONSTRAINT company_operating_scope_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT company_operating_scope_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT company_operating_scope_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_period_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NOT NULL)
        ),

    CONSTRAINT company_operating_scope_periods_not_superseded_by_self
        CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id),

    CONSTRAINT company_operating_scope_periods_id_organization_uq
        UNIQUE (id, organization_id),

    CONSTRAINT company_operating_scope_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_period_id, organization_id)
        REFERENCES public.company_operating_scope_periods (id, organization_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX company_operating_scope_periods_current_uq
    ON public.company_operating_scope_periods (organization_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX company_operating_scope_periods_history_idx
    ON public.company_operating_scope_periods (organization_id, effective_from);


-- ============================================================
-- 3. Rule applicability periods
-- ============================================================

CREATE TABLE public.company_rule_applicability_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    rule_code text NOT NULL
        REFERENCES public.company_profile_rules(code)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    applicability text NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_period_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT company_rule_applicability_periods_applicability_valid
        CHECK (applicability IN ('APPLIES', 'DOES_NOT_APPLY')),

    CONSTRAINT company_rule_applicability_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT company_rule_applicability_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT company_rule_applicability_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_period_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NOT NULL)
        ),

    CONSTRAINT company_rule_applicability_periods_not_superseded_by_self
        CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id),

    CONSTRAINT company_rule_applicability_periods_id_scope_uq
        UNIQUE (id, organization_id, rule_code),

    CONSTRAINT company_rule_applicability_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_period_id, organization_id, rule_code)
        REFERENCES public.company_rule_applicability_periods (id, organization_id, rule_code)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX company_rule_applicability_periods_current_uq
    ON public.company_rule_applicability_periods (organization_id, rule_code)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX company_rule_applicability_periods_history_idx
    ON public.company_rule_applicability_periods (organization_id, rule_code, effective_from);


-- ============================================================
-- 4. Driver requirement periods
-- ============================================================

CREATE TABLE public.company_driver_requirement_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    minimum_driver_age_years smallint NOT NULL,
    minimum_driver_experience_months smallint NOT NULL,

    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_period_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT company_driver_requirement_periods_age_valid
        CHECK (minimum_driver_age_years BETWEEN 16 AND 100),

    CONSTRAINT company_driver_requirement_periods_experience_valid
        CHECK (minimum_driver_experience_months BETWEEN 0 AND 600),

    CONSTRAINT company_driver_requirement_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT company_driver_requirement_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT company_driver_requirement_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_period_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NOT NULL)
        ),

    CONSTRAINT company_driver_requirement_periods_not_superseded_by_self
        CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id),

    CONSTRAINT company_driver_requirement_periods_id_organization_uq
        UNIQUE (id, organization_id),

    CONSTRAINT company_driver_requirement_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_period_id, organization_id)
        REFERENCES public.company_driver_requirement_periods (id, organization_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX company_driver_requirement_periods_current_uq
    ON public.company_driver_requirement_periods (organization_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX company_driver_requirement_periods_history_idx
    ON public.company_driver_requirement_periods (organization_id, effective_from);


-- ============================================================
-- 5. Integrity triggers
-- ============================================================

CREATE FUNCTION tes_security.prevent_company_profile_data_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Company profile data is preserved; % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- A rule assertion may only be recorded against an ACTIVE catalogue rule.
CREATE FUNCTION tes_security.guard_company_rule_applicability_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.company_profile_rules AS r
         WHERE r.code = NEW.rule_code
           AND r.is_active
    ) THEN
        RAISE EXCEPTION 'The rule is not an active company profile rule'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'company_rule_applicability_periods_rule_active';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION tes_security.guard_company_operating_scope_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected operating scope period is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.operating_scope IS DISTINCT FROM OLD.operating_scope
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Operating scope period content is immutable; record a change or a correction as a new period'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended operating scope period cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end an operating scope period'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION tes_security.guard_company_rule_applicability_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected rule applicability period is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.rule_code IS DISTINCT FROM OLD.rule_code
       OR NEW.applicability IS DISTINCT FROM OLD.applicability
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Rule applicability period content is immutable; record a change or a correction as a new period'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended rule applicability period cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end a rule applicability period'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION tes_security.guard_company_driver_requirement_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected driver requirement period is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.minimum_driver_age_years IS DISTINCT FROM OLD.minimum_driver_age_years
       OR NEW.minimum_driver_experience_months IS DISTINCT FROM OLD.minimum_driver_experience_months
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Driver requirement period content is immutable; record a change or a correction as a new period'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended driver requirement period cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end a driver requirement period'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_company_profile_data_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_company_rule_applicability_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_company_operating_scope_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_company_rule_applicability_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_company_driver_requirement_update() FROM PUBLIC;

CREATE TRIGGER company_operating_scope_periods_guard_active_organization
BEFORE INSERT ON public.company_operating_scope_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER company_rule_applicability_periods_guard_active_organization
BEFORE INSERT ON public.company_rule_applicability_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER company_driver_requirement_periods_guard_active_organization
BEFORE INSERT ON public.company_driver_requirement_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER company_rule_applicability_periods_guard_insert
BEFORE INSERT ON public.company_rule_applicability_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_rule_applicability_insert();

CREATE TRIGGER company_operating_scope_periods_guard_update
BEFORE UPDATE ON public.company_operating_scope_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_operating_scope_update();

CREATE TRIGGER company_rule_applicability_periods_guard_update
BEFORE UPDATE ON public.company_rule_applicability_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_rule_applicability_update();

CREATE TRIGGER company_driver_requirement_periods_guard_update
BEFORE UPDATE ON public.company_driver_requirement_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_company_driver_requirement_update();

CREATE TRIGGER company_operating_scope_periods_no_delete
BEFORE DELETE ON public.company_operating_scope_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER company_rule_applicability_periods_no_delete
BEFORE DELETE ON public.company_rule_applicability_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER company_driver_requirement_periods_no_delete
BEFORE DELETE ON public.company_driver_requirement_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER company_operating_scope_periods_no_truncate
BEFORE TRUNCATE ON public.company_operating_scope_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER company_rule_applicability_periods_no_truncate
BEFORE TRUNCATE ON public.company_rule_applicability_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();

CREATE TRIGGER company_driver_requirement_periods_no_truncate
BEFORE TRUNCATE ON public.company_driver_requirement_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_company_profile_data_removal();


-- ============================================================
-- 6. Capabilities (catalogue rows only)
--
-- Capability existence and assignment are separate: this migration creates no relationship, assignment or grant. Both are
-- SYSTEM-only; customers receive no access to company profile facts through this migration.
-- ============================================================

INSERT INTO public.capabilities (code, display_name, description, is_active, sort_order)
VALUES
    (
        'COMPANY_PROFILE_READ',
        'Read Company Operating Profile',
        'SYSTEM-wide read access to company operating scope, rule applicability and driver requirement facts and their history. Intended scope: SYSTEM only.',
        true,
        170
    ),
    (
        'COMPANY_PROFILE_MANAGE',
        'Manage Company Operating Profile',
        'Record, change and correct company operating scope, rule applicability and driver requirement facts. Intended scope: SYSTEM only.',
        true,
        180
    );


-- ============================================================
-- 7. Runtime privileges
--
-- Migration 0002 removed automatic runtime privileges, so everything below is deliberate and object-specific. The runtime
-- identity gets no DELETE and no TRUNCATE, may not rewrite period content, and has read-only access to the rule catalogue.
-- effective_to is insertable so a correction of an already-ended period can create its replacement with the same window (the
-- open-period unique index would otherwise forbid inserting it open and ending it afterwards).
-- ============================================================

REVOKE ALL
ON TABLE
    public.company_profile_rules,
    public.company_operating_scope_periods,
    public.company_rule_applicability_periods,
    public.company_driver_requirement_periods
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.company_profile_rules,
    public.company_operating_scope_periods,
    public.company_rule_applicability_periods,
    public.company_driver_requirement_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, operating_scope, effective_from, effective_to)
ON public.company_operating_scope_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_period_id, updated_at)
ON public.company_operating_scope_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, rule_code, applicability, effective_from, effective_to)
ON public.company_rule_applicability_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_period_id, updated_at)
ON public.company_rule_applicability_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (id, organization_id, minimum_driver_age_years, minimum_driver_experience_months, effective_from, effective_to)
ON public.company_driver_requirement_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_period_id, updated_at)
ON public.company_driver_requirement_periods
TO "tes-backend@tes-production-510007.iam";
