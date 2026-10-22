-- TES: system-wide duplicate prevention at the database (companion to 0037, which it requires)
-- Migration: 0038
--
-- ADDITIVE. Migrations 0001-0037 are not edited and no existing row is rewritten, merged, ended or removed. It adds only unique indexes:
--
--   1. Vehicles: ONE current owner and ONE current operator per vehicle across TES (open organization_vehicle_relationships rows).
--      LEASES is not exclusive. Ended relationships are history and never conflict. (Existing: one current VIN per vehicle, one current plate
--      per jurisdiction, one current relationship of a type per company.)
--   2. Jurisdiction-spelling collisions: the existing natural-key indexes compare the jurisdiction as TEXT, so "Canada"/"CA" or "Ontario"/"ON"
--      written by a path that does not canonicalize would make two rows for one regulatory number. These indexes repeat each natural key on the
--      0037 canonical jurisdiction functions (tes_security.canonical_country_code / canonical_region_code), for:
--        organization_identifiers      (namespace, type, jurisdiction, value)            corporate registry / CRA BN / IRS EIN
--        registration_versions         (program, jurisdiction, number)                   GST/HST, IFTA, IRP, ...
--        operating_authority_versions  (kind, jurisdiction, number)                      USDOT, MC, CVOR, ...
--        vehicle_registration_periods  (jurisdiction, plate)                             licence plates
--      The stored values are not changed. The namespaces stay exactly as before: the number is unique inside its own program / kind /
--      jurisdiction, never across them.
--
--   3. Nullable jurisdiction (organization_identifiers has no program trigger, unlike registrations and authorities). A key that only compares the
--      jurisdiction columns lets a row that OMITS a required jurisdiction coexist with the same number recorded with it. Correct scope per kind:
--        CRA business number, IRS EIN   one national number space: unique on (namespace, type, value) whatever the jurisdiction columns say
--        incorporation number           registry-scoped: unique per (country, region, value); country required; region required for the US
--                                       (a Canadian federal incorporation has no region: a different registry from a province, NOT a collision)
--        extra-provincial registration  country and region required
--      The jurisdiction-scope CHECK is NOT VALID and applies to ACTIVE rows only: existing rows are not scanned, rewritten or rejected, they
--      stay as explicit unresolved records for review (the preflight lists them), and superseding one is never blocked.
--      Registrations and operating authorities already enforce their per-program jurisdiction rules in a trigger (0016/0013, relaxed only for an
--      EXPLICITLY unresolved initial version by 0034). An unresolved number is a deliberate pending state: two unresolved records of one number
--      collide (NULL is one value in the canonical key), and an unresolved number is surfaced for review next to a resolved one by the existing
--      number check, never silently merged with it.
--
-- The migration REFUSES to apply (nothing changes) when existing rows already violate a rule it would enforce; scripts/database/
-- preflight-0038-duplicate-prevention.sql lists the offending rows. No record is merged, ended or deleted automatically.

-- ============================================================
-- 1. Refuse to apply over existing conflicts (nothing is changed)
-- ============================================================

DO $$
DECLARE
    owners integer;
    operators integer;
    identifiers integer;
    registrations integer;
    authorities integer;
    plates integer;
    national integer;
BEGIN
    IF to_regprocedure('tes_security.canonical_country_code(text)') IS NULL THEN
        RAISE EXCEPTION 'Migration 0038 requires migration 0037 (canonical jurisdiction functions). Nothing was changed.';
    END IF;

    SELECT count(*) INTO owners FROM (
        SELECT vehicle_id FROM public.organization_vehicle_relationships
         WHERE relationship_type = 'OWNS' AND record_status = 'active' AND effective_to IS NULL
         GROUP BY vehicle_id HAVING count(*) > 1) g;
    IF owners > 0 THEN
        RAISE EXCEPTION 'Migration 0038 cannot be applied: % vehicle(s) have more than one current owner. Nothing was changed; see scripts/database/preflight-0038-duplicate-prevention.sql.', owners
            USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO operators FROM (
        SELECT vehicle_id FROM public.organization_vehicle_relationships
         WHERE relationship_type = 'OPERATES' AND record_status = 'active' AND effective_to IS NULL
         GROUP BY vehicle_id HAVING count(*) > 1) g;
    IF operators > 0 THEN
        RAISE EXCEPTION 'Migration 0038 cannot be applied: % vehicle(s) have more than one current operator. Nothing was changed; see scripts/database/preflight-0038-duplicate-prevention.sql.', operators
            USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO identifiers FROM (
        SELECT 1 FROM public.organization_identifiers WHERE status = 'active'
         GROUP BY lower(btrim(namespace)), lower(btrim(identifier_type)), tes_security.canonical_country_code(jurisdiction_country),
                  tes_security.canonical_region_code(jurisdiction_region), normalized_value
        HAVING count(*) > 1) g;
    IF identifiers > 0 THEN
        RAISE EXCEPTION 'Migration 0038 cannot be applied: % group(s) of company identifiers collide under equivalent jurisdiction spellings. Nothing was changed; see scripts/database/preflight-0038-duplicate-prevention.sql.', identifiers
            USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO national FROM (
        SELECT 1 FROM public.organization_identifiers
         WHERE status = 'active'
           AND ((lower(btrim(namespace)) = 'cra' AND lower(btrim(identifier_type)) = 'business_number')
             OR (lower(btrim(namespace)) = 'irs' AND lower(btrim(identifier_type)) = 'employer_identification_number'))
         GROUP BY lower(btrim(namespace)), lower(btrim(identifier_type)), normalized_value
        HAVING count(*) > 1) g;
    IF national > 0 THEN
        RAISE EXCEPTION 'Migration 0038 cannot be applied: % national number(s) (CRA business number / IRS EIN) are held by more than one active company identifier, whatever jurisdiction was recorded. Nothing was changed; see scripts/database/preflight-0038-duplicate-prevention.sql.', national
            USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO registrations FROM (
        SELECT 1 FROM public.registration_versions WHERE record_status = 'active' AND effective_to IS NULL
         GROUP BY program_code, tes_security.canonical_country_code(jurisdiction_country), tes_security.canonical_region_code(jurisdiction_region), number_normalized
        HAVING count(*) > 1) g;
    IF registrations > 0 THEN
        RAISE EXCEPTION 'Migration 0038 cannot be applied: % group(s) of registrations collide under equivalent jurisdiction spellings. Nothing was changed; see scripts/database/preflight-0038-duplicate-prevention.sql.', registrations
            USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO authorities FROM (
        SELECT 1 FROM public.operating_authority_versions WHERE record_status = 'active' AND effective_to IS NULL
         GROUP BY kind, tes_security.canonical_country_code(jurisdiction_country), tes_security.canonical_region_code(jurisdiction_region), number_normalized
        HAVING count(*) > 1) g;
    IF authorities > 0 THEN
        RAISE EXCEPTION 'Migration 0038 cannot be applied: % group(s) of operating authorities collide under equivalent jurisdiction spellings. Nothing was changed; see scripts/database/preflight-0038-duplicate-prevention.sql.', authorities
            USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO plates FROM (
        SELECT 1 FROM public.vehicle_registration_periods WHERE plate_normalized IS NOT NULL AND record_status = 'active' AND effective_to IS NULL
         GROUP BY tes_security.canonical_country_code(jurisdiction_country), tes_security.canonical_region_code(jurisdiction_region), plate_normalized
        HAVING count(*) > 1) g;
    IF plates > 0 THEN
        RAISE EXCEPTION 'Migration 0038 cannot be applied: % group(s) of current plates collide under equivalent jurisdiction spellings. Nothing was changed; see scripts/database/preflight-0038-duplicate-prevention.sql.', plates
            USING ERRCODE = '23505';
    END IF;
END;
$$;

-- ============================================================
-- 2. Vehicles: one current owner, one current operator
-- ============================================================

CREATE UNIQUE INDEX organization_vehicle_open_owner_uq
    ON public.organization_vehicle_relationships (vehicle_id)
    WHERE relationship_type = 'OWNS' AND record_status = 'active' AND effective_to IS NULL;

CREATE UNIQUE INDEX organization_vehicle_open_operator_uq
    ON public.organization_vehicle_relationships (vehicle_id)
    WHERE relationship_type = 'OPERATES' AND record_status = 'active' AND effective_to IS NULL;

-- ============================================================
-- 3. Natural keys repeated on the canonical jurisdiction
-- ============================================================

CREATE UNIQUE INDEX organization_identifiers_active_canonical_identity_uq
    ON public.organization_identifiers (
        lower(btrim(namespace)),
        lower(btrim(identifier_type)),
        tes_security.canonical_country_code(jurisdiction_country),
        tes_security.canonical_region_code(jurisdiction_region),
        normalized_value
    )
    WHERE status = 'active';

-- National number spaces: one business number / EIN, whatever the jurisdiction columns hold (including none).
CREATE UNIQUE INDEX organization_identifiers_active_national_number_uq
    ON public.organization_identifiers (lower(btrim(namespace)), lower(btrim(identifier_type)), normalized_value)
    WHERE status = 'active'
      AND ((lower(btrim(namespace)) = 'cra' AND lower(btrim(identifier_type)) = 'business_number')
        OR (lower(btrim(namespace)) = 'irs' AND lower(btrim(identifier_type)) = 'employer_identification_number'));

-- The jurisdiction each corporate identifier kind REQUIRES. NOT VALID: enforced for new and changed active rows, existing rows are left as they are.
-- COALESCE: a NULL column must FAIL the rule, not pass it (a CHECK treats NULL as satisfied).
ALTER TABLE public.organization_identifiers
    ADD CONSTRAINT organization_identifiers_jurisdiction_scope CHECK (
        status <> 'active'
        OR COALESCE(
            CASE
                WHEN lower(btrim(namespace)) = 'cra' AND lower(btrim(identifier_type)) = 'business_number'
                    THEN jurisdiction_country = 'CA' AND jurisdiction_region IS NULL
                WHEN lower(btrim(namespace)) = 'irs' AND lower(btrim(identifier_type)) = 'employer_identification_number'
                    THEN jurisdiction_country = 'US' AND jurisdiction_region IS NULL
                WHEN lower(btrim(namespace)) = 'corporate_registry' AND lower(btrim(identifier_type)) = 'incorporation_number'
                    THEN jurisdiction_country ~ '^[A-Z]{2}$' AND (jurisdiction_country <> 'US' OR jurisdiction_region IS NOT NULL)
                         AND (jurisdiction_region IS NULL OR jurisdiction_region ~ '^[A-Z0-9]{1,3}$')
                WHEN lower(btrim(namespace)) = 'corporate_registry' AND lower(btrim(identifier_type)) = 'extra_provincial_registration'
                    THEN jurisdiction_country ~ '^[A-Z]{2}$' AND jurisdiction_region ~ '^[A-Z0-9]{1,3}$'
                ELSE true
            END,
            false)
    ) NOT VALID;

CREATE UNIQUE INDEX registration_versions_current_canonical_number_uq
    ON public.registration_versions (
        program_code,
        tes_security.canonical_country_code(jurisdiction_country),
        tes_security.canonical_region_code(jurisdiction_region),
        number_normalized
    )
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE UNIQUE INDEX operating_authority_versions_current_canonical_number_uq
    ON public.operating_authority_versions (
        kind,
        tes_security.canonical_country_code(jurisdiction_country),
        tes_security.canonical_region_code(jurisdiction_region),
        number_normalized
    )
    WHERE record_status = 'active' AND effective_to IS NULL;

CREATE UNIQUE INDEX vehicle_registration_current_canonical_plate_uq
    ON public.vehicle_registration_periods (
        tes_security.canonical_country_code(jurisdiction_country),
        tes_security.canonical_region_code(jurisdiction_region),
        plate_normalized
    )
    WHERE plate_normalized IS NOT NULL AND record_status = 'active' AND effective_to IS NULL;
