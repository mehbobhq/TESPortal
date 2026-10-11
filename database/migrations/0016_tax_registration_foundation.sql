-- TES Companies: Tax / Registration / Customs-identifier foundation
-- Migration: 0016
--
-- Scope (additive only):
--   1. public.registration_programs          controlled catalogue of registration programs (seeded)
--   2. public.registrations                  stable registration / account identity (one row per registration record)
--   3. public.registration_versions          effective-dated number / jurisdiction / licence-period history
--   4. public.registration_status_periods    effective-dated registration status history
--   5. tes_security.guard_active_organization  generic insert-time backstop shared by the Companies foundation tables
--   6. two SYSTEM-only capabilities (catalogue rows only, granted to nobody)
--
-- WHAT A REGISTRATION IS. A registration is the canonical, company-level identity of an Organization's account or
-- registration with a tax, fuel-tax, highway-use, weight-distance or carrier-code program: "this Organization is
-- registered with this program under this number, issued by this jurisdiction". It is NOT:
--   - an operating authority (USDOT, MC, MVID, RIN, CVOR, NSC, IRP live in 0013 and are canonical there; IRP is NOT
--     recreated here);
--   - a filing obligation, a periodic filing / return / payment (Tax Filing, a later domain);
--   - a portal login (Credentials, 0018);
--   - a per-vehicle permit, decal or cab card (Vehicles, a later domain; IFTA decals are vehicle-specific);
--   - an evidence document (GCS; this schema only keeps stable ids that evidence can reference later).
--
-- Programs seeded (exactly): IFTA, CT_HUF, NY_HUT, KYU, NM_WDT, OR_WMT, FUEL_CHARGE, TX_EXCISE, AR_MFT, ON_TOBACCO, SCAC,
-- CA_CARRIER_CODE. Deliberately NOT programs here:
--   - Federal Form 2290: it is filed under the Organization's EIN and has no separate registration identity.
--   - C-TPAT, PIP, Customs Self Assessment, FAST, SmartWay, COR, PIC, Weight to Go: partnership / certification
--     memberships (the Programs domain), not number-bearing tax or carrier-code registrations.
--   - A generic "CUSTOMS" bucket. Only SCAC (NMFTA, worldwide namespace) and the Canadian Carrier Code (CBSA, Canadian
--     namespace) are modelled, because each is a stable company-level code that border documents carry.
--
-- IFTA is the licence / account identity only: the base jurisdiction (the issuing jurisdiction of the version, which may
-- change over time), the licence number and the licence period (issued_on / expires_on). Quarterly IFTA returns belong to
-- Tax Filing; decals belong to Vehicles.
--
-- Stable identity vs history. A registration is one row; it survives renewals, status changes, a change of base
-- jurisdiction and corrections. A renewal that changes dates or re-issues the number is a new VERSION of the same
-- registration. Registration and filing are separate concepts for every program: absence of a filing never implies
-- absence of a registration and vice versa.
--
-- Uniqueness / collision namespace is a property of the program (registration_programs.jurisdiction_scope):
--   GLOBAL            one worldwide number space                                        (SCAC)
--   NATIONAL          one number space for the whole issuing country                    (FUEL_CHARGE, CA_CARRIER_CODE)
--   COUNTRY_REGION    number space per issuing country + region                         (CT_HUF, NY_HUT, KYU, NM_WDT, OR_WMT, TX_EXCISE, AR_MFT, ON_TOBACCO)
--   BASE_JURISDICTION number space per base jurisdiction, which may change over time    (IFTA)
-- A CURRENT, non-corrected version holds its number in its namespace, whether or not its registration is closed or
-- archived (reuse must be an explicit reviewed decision). No program claims "one current registration per
-- Organization": regulator documentation was not established for any of them, so the database makes no such claim; the
-- number (unique in its namespace) is what distinguishes records.
--
-- Business time vs record time, and correction vs real-world change, follow migrations 0012 / 0013 exactly: a real
-- change ends the old row (effective_to) and starts a new one; a correction marks the old row 'corrected' (never ended)
-- with a deferred, same-registration pointer to its replacement, which inherits the business time. Reads use
-- 'active' rows only. Archive is RECORD lifecycle (registrations.record_status), not registration status.
-- Status vocabulary (observed): PENDING, ACTIVE, SUSPENDED, INACTIVE, CLOSED. No transition matrix is enforced;
-- program-specific transition policy belongs to the Rules layer.
--
-- Requirement is not stored here: whether an Organization needs a registration is a Rules / Company Profile
-- determination (0019 stores applicability). These tables hold only actual registrations.
--
-- Global Organization facts: no tenant column and no row-level security. Visibility is enforced by the server.
-- All new functions are SECURITY INVOKER with a fixed search_path; none is SECURITY DEFINER. No DELETE or TRUNCATE is
-- granted and none is possible (triggers). No existing object is touched.


-- ============================================================
-- 1. Registration program catalogue
-- ============================================================

CREATE TABLE public.registration_programs (
    code text PRIMARY KEY,
    display_name text NOT NULL,
    description text,

    -- Controlled grouping used for navigation and rules (not an identity).
    program_family text NOT NULL,

    -- Collision / identity namespace (see header).
    jurisdiction_scope text NOT NULL,
    issuer_country text,
    region_required boolean NOT NULL,
    fixed_region text,

    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT registration_programs_code_valid
        CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),

    CONSTRAINT registration_programs_display_name_not_blank
        CHECK (btrim(display_name) <> ''),

    CONSTRAINT registration_programs_family_valid
        CHECK (program_family IN ('FUEL_TAX', 'HIGHWAY_USE_TAX', 'WEIGHT_DISTANCE_TAX', 'EXCISE_TAX', 'CARRIER_CODE')),

    CONSTRAINT registration_programs_jurisdiction_scope_valid
        CHECK (jurisdiction_scope IN ('GLOBAL', 'NATIONAL', 'COUNTRY_REGION', 'BASE_JURISDICTION')),

    CONSTRAINT registration_programs_issuer_country_valid
        CHECK (issuer_country IS NULL OR issuer_country ~ '^[A-Z]{2}$'),

    CONSTRAINT registration_programs_fixed_region_valid
        CHECK (fixed_region IS NULL OR fixed_region ~ '^[A-Z0-9]{1,8}$'),

    CONSTRAINT registration_programs_scope_shape_consistent
        CHECK (
            (jurisdiction_scope = 'GLOBAL'
                AND issuer_country IS NULL AND region_required = false AND fixed_region IS NULL)
            OR
            (jurisdiction_scope = 'NATIONAL'
                AND issuer_country IS NOT NULL AND region_required = false AND fixed_region IS NULL)
            OR
            (jurisdiction_scope = 'COUNTRY_REGION'
                AND issuer_country IS NOT NULL AND region_required = true)
            OR
            (jurisdiction_scope = 'BASE_JURISDICTION'
                AND region_required = true AND fixed_region IS NULL)
        ),

    CONSTRAINT registration_programs_sort_order_uq
        UNIQUE (sort_order)
);

INSERT INTO public.registration_programs
    (code, display_name, description, program_family, jurisdiction_scope, issuer_country, region_required, fixed_region, sort_order)
VALUES
    ('IFTA', 'IFTA Licence',
        'International Fuel Tax Agreement licence / account issued by the licensee''s base jurisdiction. The base jurisdiction (which may change over time), licence number and licence period are recorded; quarterly returns (Tax Filing) and decals (Vehicles) are separate concepts.',
        'FUEL_TAX', 'BASE_JURISDICTION', NULL, true, NULL, 10),
    ('CT_HUF', 'Connecticut Highway Use Fee',
        'Connecticut highway use fee registration (CT DRS). Connecticut number space.',
        'HIGHWAY_USE_TAX', 'COUNTRY_REGION', 'US', true, 'CT', 20),
    ('NY_HUT', 'New York Highway Use Tax',
        'New York highway use tax certificate of registration (NY DTF). New York number space.',
        'HIGHWAY_USE_TAX', 'COUNTRY_REGION', 'US', true, 'NY', 30),
    ('KYU', 'Kentucky Weight Distance Tax (KYU)',
        'Kentucky weight-distance tax account (KYU). Kentucky number space.',
        'WEIGHT_DISTANCE_TAX', 'COUNTRY_REGION', 'US', true, 'KY', 40),
    ('NM_WDT', 'New Mexico Weight Distance Tax',
        'New Mexico weight-distance tax account. New Mexico number space.',
        'WEIGHT_DISTANCE_TAX', 'COUNTRY_REGION', 'US', true, 'NM', 50),
    ('OR_WMT', 'Oregon Weight-Mile Tax',
        'Oregon weight-mile tax account (Oregon DOT Motor Carrier). Oregon number space.',
        'WEIGHT_DISTANCE_TAX', 'COUNTRY_REGION', 'US', true, 'OR', 60),
    ('FUEL_CHARGE', 'Federal Fuel Charge Registration',
        'Canada federal fuel charge registration. Retained for outstanding historical obligations. Canadian number space.',
        'FUEL_TAX', 'NATIONAL', 'CA', false, NULL, 70),
    ('TX_EXCISE', 'Texas Excise / Motor Fuel Tax Account',
        'Texas excise / motor-fuel tax account where separate from IFTA. Texas number space.',
        'EXCISE_TAX', 'COUNTRY_REGION', 'US', true, 'TX', 80),
    ('AR_MFT', 'Arkansas Motor Fuel Tax Account',
        'Arkansas motor fuel tax account where separate from IFTA. Arkansas number space.',
        'EXCISE_TAX', 'COUNTRY_REGION', 'US', true, 'AR', 90),
    ('ON_TOBACCO', 'Ontario Tobacco Tax Account',
        'Ontario tobacco tax account / permit for interjurisdictional transport activity. Ontario number space.',
        'EXCISE_TAX', 'COUNTRY_REGION', 'CA', true, 'ON', 100),
    ('SCAC', 'SCAC',
        'Standard Carrier Alpha Code issued by NMFTA: a stable carrier code (two to four letters) carried on border and freight documents. One worldwide number space.',
        'CARRIER_CODE', 'GLOBAL', NULL, false, NULL, 110),
    ('CA_CARRIER_CODE', 'Canadian Carrier Code (CBSA)',
        'Carrier code issued by the Canada Border Services Agency for eManifest. Canadian number space.',
        'CARRIER_CODE', 'NATIONAL', 'CA', false, NULL, 120);



-- ============================================================
-- 2. Registrations (stable identity)
-- ============================================================

CREATE TABLE public.registrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id uuid NOT NULL
        REFERENCES public.organizations(id)
        ON DELETE RESTRICT,

    program_code text NOT NULL
        REFERENCES public.registration_programs(code)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,

    -- Record lifecycle (NOT regulatory status).
    record_status text NOT NULL DEFAULT 'active',
    archived_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT registrations_record_status_valid
        CHECK (record_status IN ('active', 'archived')),

    CONSTRAINT registrations_archive_state_consistent
        CHECK (
            (record_status = 'archived' AND archived_at IS NOT NULL)
            OR
            (record_status = 'active' AND archived_at IS NULL)
        ),

    -- Targets of the composite foreign keys on versions.
    CONSTRAINT registrations_id_program_uq
        UNIQUE (id, program_code),

    CONSTRAINT registrations_id_organization_uq
        UNIQUE (id, organization_id)
);

CREATE INDEX registrations_organization_idx
    ON public.registrations (organization_id, program_code);


-- ============================================================
-- 3. Registration versions (number, jurisdiction, dates)
-- ============================================================

CREATE TABLE public.registration_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    registration_id uuid NOT NULL,

    -- Copies of registrations.organization_id and .program_code, bound by the composite foreign keys
    -- below, so the identity and collision indexes can be single-table indexes without trusting
    -- application code.
    organization_id uuid NOT NULL,
    program_code text NOT NULL,

    -- Displayable number exactly as recorded, the normalized form used for matching and collision, and
    -- the version of the program-specific normalization rule that produced it.
    number_display text NOT NULL,
    number_normalized text NOT NULL,
    normalization_rule_version text NOT NULL,

    -- Issuing jurisdiction of THIS version (the namespace the number is unique in).
    -- NULL only for GLOBAL programs (one worldwide number space, e.g. SCAC).
    jurisdiction_country text,
    jurisdiction_region text,

    -- Regulatory document dates (expires_on is the printed licence / certificate period end where the issuer states one).
    issued_on date,
    expires_on date,

    -- How this version came to exist.
    version_reason text NOT NULL,

    -- Business time (may be backdated).
    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    -- 'active': asserted true for [effective_from, effective_to).
    -- 'corrected': known to have been wrongly recorded; preserved, never a genuine business fact.
    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_version_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT registration_versions_registration_fk
        FOREIGN KEY (registration_id, program_code)
        REFERENCES public.registrations (id, program_code)
        ON DELETE RESTRICT,

    CONSTRAINT registration_versions_organization_fk
        FOREIGN KEY (registration_id, organization_id)
        REFERENCES public.registrations (id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT registration_versions_number_display_not_blank
        CHECK (btrim(number_display) <> ''),

    CONSTRAINT registration_versions_number_normalized_not_blank
        CHECK (btrim(number_normalized) <> ''),

    CONSTRAINT registration_versions_rule_version_not_blank
        CHECK (btrim(normalization_rule_version) <> ''),

    CONSTRAINT registration_versions_country_valid
        CHECK (jurisdiction_country IS NULL OR jurisdiction_country ~ '^[A-Z]{2}$'),

    CONSTRAINT registration_versions_region_needs_country
        CHECK (jurisdiction_region IS NULL OR jurisdiction_country IS NOT NULL),

    CONSTRAINT registration_versions_region_valid
        CHECK (jurisdiction_region IS NULL OR jurisdiction_region ~ '^[A-Z0-9]{1,8}$'),

    CONSTRAINT registration_versions_document_dates_valid
        CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on),

    CONSTRAINT registration_versions_reason_valid
        CHECK (version_reason IN ('INITIAL', 'CHANGE', 'CORRECTION')),

    CONSTRAINT registration_versions_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT registration_versions_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT registration_versions_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_version_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_version_id IS NOT NULL)
        ),

    CONSTRAINT registration_versions_not_superseded_by_self
        CHECK (superseded_by_version_id IS NULL OR superseded_by_version_id <> id),

    -- Target of the same-registration replacement foreign key below.
    CONSTRAINT registration_versions_id_registration_uq
        UNIQUE (id, registration_id),

    -- A corrected version points to its replacement, which must belong to the same registration.
    -- Deferred so a correction can mark the old row and create its replacement in either order inside
    -- one transaction.
    CONSTRAINT registration_versions_superseded_by_fk
        FOREIGN KEY (superseded_by_version_id, registration_id)
        REFERENCES public.registration_versions (id, registration_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- Exactly one CURRENT version per registration. Corrected rows never count.
CREATE UNIQUE INDEX registration_versions_current_uq
    ON public.registration_versions (registration_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

-- Authoritative collision protection: a CURRENT, non-corrected version holds its number in its
-- namespace. Independent of whether the registration's status is cancelled or the record archived.
CREATE UNIQUE INDEX registration_versions_current_number_uq
    ON public.registration_versions (program_code, jurisdiction_country, jurisdiction_region, number_normalized)
    NULLS NOT DISTINCT
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX registration_versions_history_idx
    ON public.registration_versions (registration_id, effective_from);

-- Review lookups across all versions (ended and corrected included). Not unique.
CREATE INDEX registration_versions_number_lookup_idx
    ON public.registration_versions (program_code, number_normalized);


-- ============================================================
-- 4. Registration status periods (registration status history)
-- ============================================================

CREATE TABLE public.registration_status_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    registration_id uuid NOT NULL
        REFERENCES public.registrations(id)
        ON DELETE RESTRICT,

    registration_status text NOT NULL,

    -- How this period came to exist. REACTIVATION is a real transition back to ACTIVE.
    period_reason text NOT NULL,

    -- Business time (may be backdated).
    effective_from timestamptz NOT NULL,
    effective_to timestamptz,

    record_status text NOT NULL DEFAULT 'active',
    corrected_at timestamptz,
    superseded_by_period_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT registration_status_periods_status_valid
        CHECK (registration_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'CLOSED')),

    CONSTRAINT registration_status_periods_reason_valid
        CHECK (period_reason IN ('INITIAL', 'TRANSITION', 'REACTIVATION', 'CORRECTION')),

    CONSTRAINT registration_status_periods_effective_window_valid
        CHECK (effective_to IS NULL OR effective_to > effective_from),

    CONSTRAINT registration_status_periods_record_status_valid
        CHECK (record_status IN ('active', 'corrected')),

    CONSTRAINT registration_status_periods_correction_state_consistent
        CHECK (
            (record_status = 'active' AND corrected_at IS NULL AND superseded_by_period_id IS NULL)
            OR
            (record_status = 'corrected' AND corrected_at IS NOT NULL AND superseded_by_period_id IS NOT NULL)
        ),

    CONSTRAINT registration_status_periods_not_superseded_by_self
        CHECK (superseded_by_period_id IS NULL OR superseded_by_period_id <> id),

    CONSTRAINT registration_status_periods_id_registration_uq
        UNIQUE (id, registration_id),

    CONSTRAINT registration_status_periods_superseded_by_fk
        FOREIGN KEY (superseded_by_period_id, registration_id)
        REFERENCES public.registration_status_periods (id, registration_id)
        DEFERRABLE INITIALLY DEFERRED
);

-- Exactly one CURRENT status period per registration. Corrected rows never count.
CREATE UNIQUE INDEX registration_status_periods_current_uq
    ON public.registration_status_periods (registration_id)
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE INDEX registration_status_periods_history_idx
    ON public.registration_status_periods (registration_id, effective_from);


-- ============================================================
-- 5. Integrity triggers
--
-- Enforced in the database so they do not depend on application code and apply to the table owner as
-- well (same approach as 0008 / 0010 / 0012). All functions are SECURITY INVOKER with a fixed
-- search_path; none is SECURITY DEFINER.
-- ============================================================

-- No hard delete or truncate of registration data, ever.
CREATE FUNCTION tes_security.prevent_registration_data_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    RAISE EXCEPTION 'Registration data is preserved; % on %.% is not permitted',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

-- Registration identity is immutable. Only the record lifecycle (archive / restore) may change.
CREATE FUNCTION tes_security.guard_registration_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.program_code IS DISTINCT FROM OLD.program_code
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Registration identity is immutable; only the record lifecycle can change'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- A new version must belong to an ACTIVE (non-archived) registration record (the row is locked FOR SHARE
-- so a concurrent archive and a concurrent version cannot both succeed) and must satisfy its program_code's
-- jurisdiction and expiry rules.
CREATE FUNCTION tes_security.guard_registration_version_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.registrations AS a
         WHERE a.id = NEW.registration_id
           AND a.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A version must belong to an active registration record'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'registration_versions_registration_active';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.registration_programs AS k
         WHERE k.code = NEW.program_code
           AND k.is_active
           AND (
               (k.jurisdiction_scope = 'GLOBAL'
                   AND NEW.jurisdiction_country IS NULL
                   AND NEW.jurisdiction_region IS NULL)
               OR
               (k.jurisdiction_scope = 'NATIONAL'
                   AND NEW.jurisdiction_country = k.issuer_country
                   AND NEW.jurisdiction_region IS NULL)
               OR
               (k.jurisdiction_scope = 'COUNTRY_REGION'
                   AND NEW.jurisdiction_country = k.issuer_country
                   AND NEW.jurisdiction_region IS NOT NULL
                   AND (k.fixed_region IS NULL OR NEW.jurisdiction_region = k.fixed_region))
               OR
               (k.jurisdiction_scope = 'BASE_JURISDICTION'
                   AND NEW.jurisdiction_country IS NOT NULL
                   AND NEW.jurisdiction_region IS NOT NULL
                   AND (k.issuer_country IS NULL OR NEW.jurisdiction_country = k.issuer_country))
           )
    ) THEN
        RAISE EXCEPTION 'The version jurisdiction does not satisfy the rules of its registration program'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'registration_versions_jurisdiction_rules';
    END IF;

    RETURN NEW;
END;
$$;

-- Version content is immutable. Only these one-way changes are permitted:
--   - effective_to: NULL -> value (a real-world change ends the version)
--   - record_status: active -> corrected, together with corrected_at and superseded_by_version_id
--     (a known-wrong version is superseded; it is NOT ended)
-- A corrected version is frozen entirely.
CREATE FUNCTION tes_security.guard_registration_version_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected registration version is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.registration_id IS DISTINCT FROM OLD.registration_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.program_code IS DISTINCT FROM OLD.program_code
       OR NEW.number_display IS DISTINCT FROM OLD.number_display
       OR NEW.number_normalized IS DISTINCT FROM OLD.number_normalized
       OR NEW.normalization_rule_version IS DISTINCT FROM OLD.normalization_rule_version
       OR NEW.jurisdiction_country IS DISTINCT FROM OLD.jurisdiction_country
       OR NEW.jurisdiction_region IS DISTINCT FROM OLD.jurisdiction_region
       OR NEW.issued_on IS DISTINCT FROM OLD.issued_on
       OR NEW.expires_on IS DISTINCT FROM OLD.expires_on
       OR NEW.version_reason IS DISTINCT FROM OLD.version_reason
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Registration version content is immutable; record a change or a correction as a new version'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended registration version cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end a version; it must not set effective_to'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- A new status period must belong to an ACTIVE (non-archived) registration record.
CREATE FUNCTION tes_security.guard_registration_status_period_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.registrations AS a
         WHERE a.id = NEW.registration_id
           AND a.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A status period must belong to an active registration record'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'registration_status_periods_registration_active';
    END IF;

    RETURN NEW;
END;
$$;

-- Status period content is immutable; same one-way changes as versions. A corrected period is frozen
-- and a correction never ends the period (no regulatory transition is invented).
CREATE FUNCTION tes_security.guard_registration_status_period_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF OLD.record_status = 'corrected' THEN
        RAISE EXCEPTION 'A corrected registration status period is frozen'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.registration_id IS DISTINCT FROM OLD.registration_id
       OR NEW.registration_status IS DISTINCT FROM OLD.registration_status
       OR NEW.period_reason IS DISTINCT FROM OLD.period_reason
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Registration status period content is immutable; record a transition or a correction as a new period'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'An ended registration status period cannot be re-dated'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.record_status = 'corrected' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A correction does not end a status period; it must not set effective_to'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

-- Every registration must have a current version and a current status period by the end of the
-- transaction that created it.
CREATE FUNCTION tes_security.require_registration_current_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.registration_versions AS v
         WHERE v.registration_id = NEW.id
           AND v.record_status = 'active'
           AND v.effective_to IS NULL
    ) THEN
        RAISE EXCEPTION 'An registration must have a current version'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'registrations_require_current_version';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.registration_status_periods AS p
         WHERE p.registration_id = NEW.id
           AND p.record_status = 'active'
           AND p.effective_to IS NULL
    ) THEN
        RAISE EXCEPTION 'An registration must have a current status period'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'registrations_require_current_status';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.prevent_registration_data_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_registration_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_registration_version_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_registration_version_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_registration_status_period_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_registration_status_period_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.require_registration_current_state() FROM PUBLIC;

CREATE TRIGGER registrations_guard_update
BEFORE UPDATE ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_registration_update();

CREATE CONSTRAINT TRIGGER registrations_require_current_state
AFTER INSERT ON public.registrations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tes_security.require_registration_current_state();

CREATE TRIGGER registration_versions_guard_insert
BEFORE INSERT ON public.registration_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_registration_version_insert();

CREATE TRIGGER registration_versions_guard_update
BEFORE UPDATE ON public.registration_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_registration_version_update();

CREATE TRIGGER registration_status_periods_guard_insert
BEFORE INSERT ON public.registration_status_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_registration_status_period_insert();

CREATE TRIGGER registration_status_periods_guard_update
BEFORE UPDATE ON public.registration_status_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_registration_status_period_update();

CREATE TRIGGER registrations_no_delete
BEFORE DELETE ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_registration_data_removal();

CREATE TRIGGER registration_versions_no_delete
BEFORE DELETE ON public.registration_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_registration_data_removal();

CREATE TRIGGER registration_status_periods_no_delete
BEFORE DELETE ON public.registration_status_periods
FOR EACH ROW
EXECUTE FUNCTION tes_security.prevent_registration_data_removal();

CREATE TRIGGER registrations_no_truncate
BEFORE TRUNCATE ON public.registrations
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_registration_data_removal();

CREATE TRIGGER registration_versions_no_truncate
BEFORE TRUNCATE ON public.registration_versions
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_registration_data_removal();

CREATE TRIGGER registration_status_periods_no_truncate
BEFORE TRUNCATE ON public.registration_status_periods
FOR EACH STATEMENT
EXECUTE FUNCTION tes_security.prevent_registration_data_removal();


-- ============================================================
-- 6. Generic insert-time Organization lifecycle backstop
--
-- A row that names an Organization (as insured / owner / issuer / operator) may only be created while that Organization
-- is active. The Organization row is locked FOR SHARE so a concurrent archive / merge and a concurrent insert cannot both
-- succeed. Trigger arguments name the columns to check. The server layer enforces the same rule (and locks the
-- Organization FOR UPDATE first); this is the backstop that does not depend on application code.
-- ============================================================

CREATE FUNCTION tes_security.guard_active_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ DECLARE column_name text; referenced text; BEGIN
    FOREACH column_name IN ARRAY TG_ARGV LOOP
        referenced := to_jsonb(NEW) ->> column_name;
        IF referenced IS NOT NULL AND NOT EXISTS (
            SELECT 1
              FROM public.organizations AS o
             WHERE o.id = referenced::uuid
               AND o.status = 'active'
               FOR SHARE
        ) THEN
            RAISE EXCEPTION 'The Organization referenced by % is not active', column_name
                USING ERRCODE = '55000',
                      CONSTRAINT = 'organization_must_be_active';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION tes_security.guard_active_organization() FROM PUBLIC;

CREATE TRIGGER registrations_guard_active_organization
BEFORE INSERT ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');

CREATE TRIGGER registration_versions_guard_active_organization
BEFORE INSERT ON public.registration_versions
FOR EACH ROW
EXECUTE FUNCTION tes_security.guard_active_organization('organization_id');


-- ============================================================
-- 7. Capabilities (catalogue rows only)
--
-- Capability existence and capability assignment are separate: this migration creates no relationship, assignment or
-- grant. Both are SYSTEM-only; customers receive no access to registrations.
-- ============================================================

INSERT INTO public.capabilities (code, display_name, description, is_active, sort_order)
VALUES
    (
        'TAX_REGISTRATION_READ',
        'Read Tax Registrations',
        'SYSTEM-wide read access to Organization tax, fuel-tax, highway-use, weight-distance and carrier-code registrations, their number / jurisdiction history and status history, and to the registration-number collision registry. Intended scope: SYSTEM only.',
        true,
        110
    ),
    (
        'TAX_REGISTRATION_MANAGE',
        'Manage Tax Registrations',
        'Create, change, correct, archive and restore Organization registrations and record their status history. Does not file returns or store credentials. Intended scope: SYSTEM only.',
        true,
        120
    );



-- ============================================================
-- 8. Runtime privileges
--
-- Migration 0002 removed automatic runtime privileges, so everything below is deliberate and
-- object-specific. The runtime identity gets no DELETE and no TRUNCATE, may not rewrite version or
-- status-period content or registration identity, and has read-only access to the program_code catalogue
-- (changed only by migrations).
-- ============================================================

REVOKE ALL
ON TABLE
    public.registration_programs,
    public.registrations,
    public.registration_versions,
    public.registration_status_periods
FROM PUBLIC;

GRANT SELECT
ON TABLE
    public.registration_programs,
    public.registrations,
    public.registration_versions,
    public.registration_status_periods
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (organization_id, program_code)
ON public.registrations
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (record_status, archived_at, updated_at)
ON public.registrations
TO "tes-backend@tes-production-510007.iam";

-- id is insertable so a correction can name its replacement before creating it.
GRANT INSERT (
    id,
    registration_id,
    organization_id,
    program_code,
    number_display,
    number_normalized,
    normalization_rule_version,
    jurisdiction_country,
    jurisdiction_region,
    issued_on,
    expires_on,
    version_reason,
    effective_from
)
ON public.registration_versions
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_version_id, updated_at)
ON public.registration_versions
TO "tes-backend@tes-production-510007.iam";

GRANT INSERT (
    id,
    registration_id,
    registration_status,
    period_reason,
    effective_from
)
ON public.registration_status_periods
TO "tes-backend@tes-production-510007.iam";

GRANT UPDATE (effective_to, record_status, corrected_at, superseded_by_period_id, updated_at)
ON public.registration_status_periods
TO "tes-backend@tes-production-510007.iam";
