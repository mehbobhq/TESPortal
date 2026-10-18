-- TES Companies: GST/HST registration program and explicitly unresolved issuing / base jurisdiction
-- Migration: 0034
--
-- Scope (additive and forward-only; migrations 0001-0033 are not edited):
--   1. public.registration_programs   one new program, GST_HST (Canada federal GST/HST program account), and the
--                                     program family it needs (SALES_TAX).
--   2. tes_security.guard_authority_version_insert / guard_registration_version_insert
--                                     accept an EXPLICITLY UNRESOLVED issuing / base jurisdiction on an INITIAL version, for the
--                                     number kinds whose jurisdiction cannot be derived from the number itself: MVID, NSC
--                                     (SAFETY_FITNESS) and IRP (operating authorities) and the IFTA licence (tax registrations).
--   3. public.operating_authority_versions.jurisdiction_country   NOT NULL is dropped, so an IRP account can be recorded before
--                                     its base jurisdiction (which may be Canadian or American) is known.
--
-- WHY. The company creation form no longer asks for the issuing province of an MVID / NSC or the base jurisdiction of an IRP / IFTA
-- account: asking for something the person has just typed in another form is noise, and guessing it (for example from the place
-- of incorporation, which is not necessarily the place of regulatory base) would invent a fact. The number is recorded as soon
-- as it is known; its jurisdiction stays UNRESOLVED (NULL) until it is established, and is then set by a CORRECTION of the version
-- in the registration-management workflow (Authorities / Tax Filing), which keeps the unresolved version as history.
--
-- What is deliberately NOT relaxed:
--   - Only an INITIAL version may be unresolved. A change or a correction always names a jurisdiction, so a known jurisdiction can
--     never be erased back to unknown.
--   - Kinds with a fixed or national jurisdiction (USDOT, MC, RIN, CVOR, FUEL_CHARGE, SCAC and every state program, GST_HST) are
--     unchanged: their jurisdiction is a property of the kind and is always recorded.
--   - Uniqueness is unchanged: the current-number indexes already treat a NULL region as one value (NULLS NOT DISTINCT), so two
--     unresolved records of the same number still collide, and an unresolved number never collides with a resolved one (it is
--     reviewed by the number check, as before).
--
-- GST_HST. The GST/HST program account is "<9-digit Business Number> RT <4-digit reference>" and is administered by the Canada
-- Revenue Agency for the whole country: NATIONAL scope, issuer CA, no region. A registration does not claim the company collects
-- tax, files returns or is currently in good standing; it records the account the company gave. No filing, invoicing or payment
-- concept is introduced.
--
-- All replaced functions stay SECURITY INVOKER with a fixed search_path and keep their owner and (revoked) PUBLIC privileges.
-- No table, trigger, grant or policy is added. No DELETE or TRUNCATE is granted.

-- ============================================================
-- 1. GST_HST program
-- ============================================================

ALTER TABLE public.registration_programs
    DROP CONSTRAINT registration_programs_family_valid;

ALTER TABLE public.registration_programs
    ADD CONSTRAINT registration_programs_family_valid
        CHECK (program_family IN ('FUEL_TAX', 'HIGHWAY_USE_TAX', 'WEIGHT_DISTANCE_TAX', 'EXCISE_TAX', 'CARRIER_CODE', 'SALES_TAX'));

INSERT INTO public.registration_programs
    (code, display_name, description, program_family, jurisdiction_scope, issuer_country, region_required, fixed_region, sort_order)
VALUES
    ('GST_HST', 'GST/HST Program Account',
        'Canada Revenue Agency GST/HST program account: the nine-digit Business Number followed by RT and a four-digit reference number. One Canadian number space. Registration only; returns, remittances and invoicing are separate concepts.',
        'SALES_TAX', 'NATIONAL', 'CA', false, NULL, 130);

-- ============================================================
-- 2. Operating authorities: an unresolved jurisdiction on an INITIAL version
-- ============================================================

ALTER TABLE public.operating_authority_versions
    ALTER COLUMN jurisdiction_country DROP NOT NULL;

-- A region always needs its country; an unresolved version has neither region nor (for IRP) country.
ALTER TABLE public.operating_authority_versions
    ADD CONSTRAINT operating_authority_versions_region_needs_country
        CHECK (jurisdiction_region IS NULL OR jurisdiction_country IS NOT NULL);

CREATE OR REPLACE FUNCTION tes_security.guard_authority_version_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.operating_authorities AS a
         WHERE a.id = NEW.authority_id
           AND a.record_status = 'active'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'A version must belong to an active authority record'
            USING ERRCODE = '55000',
                  CONSTRAINT = 'operating_authority_versions_authority_active';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.authority_kinds AS k
         WHERE k.code = NEW.kind
           AND k.is_active
           AND (
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
                   AND NEW.jurisdiction_region IS NOT NULL
                   AND NEW.jurisdiction_country IS NOT NULL
                   AND (k.issuer_country IS NULL OR NEW.jurisdiction_country = k.issuer_country))
               OR
               -- Explicitly unresolved: only an INITIAL version, only where the kind does not fix its own region.
               (NEW.version_reason = 'INITIAL'
                   AND NEW.jurisdiction_region IS NULL
                   AND k.fixed_region IS NULL
                   AND (
                       (k.jurisdiction_scope = 'COUNTRY_REGION' AND NEW.jurisdiction_country = k.issuer_country)
                       OR
                       (k.jurisdiction_scope = 'BASE_JURISDICTION' AND NEW.jurisdiction_country IS NULL)
                   ))
           )
    ) THEN
        RAISE EXCEPTION 'The version jurisdiction does not satisfy the rules of its authority kind'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'operating_authority_versions_jurisdiction_rules';
    END IF;

    IF NEW.expires_on IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM public.authority_kinds AS k
         WHERE k.code = NEW.kind
           AND k.has_expiry
    ) THEN
        RAISE EXCEPTION 'An expiry date does not apply to this authority kind'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'operating_authority_versions_expiry_applicable';
    END IF;

    RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Tax registrations: an unresolved base jurisdiction (IFTA) on an INITIAL version
-- ============================================================

CREATE OR REPLACE FUNCTION tes_security.guard_registration_version_insert()
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
               OR
               -- Explicitly unresolved base jurisdiction: only an INITIAL version.
               (k.jurisdiction_scope = 'BASE_JURISDICTION'
                   AND NEW.version_reason = 'INITIAL'
                   AND NEW.jurisdiction_country IS NULL
                   AND NEW.jurisdiction_region IS NULL)
           )
    ) THEN
        RAISE EXCEPTION 'The version jurisdiction does not satisfy the rules of its registration program'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'registration_versions_jurisdiction_rules';
    END IF;

    RETURN NEW;
END;
$$;
