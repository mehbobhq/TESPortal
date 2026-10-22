-- TES: pre-migration conflict inspection for migration 0038 (duplicate prevention). Run AFTER 0037 is applied (it uses the 0037 canonical functions).
-- READ ONLY: SELECT statements only. Nothing is merged, ended, corrected or deleted.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/database/preflight-0038-duplicate-prevention.sql
-- Every query returns zero rows when the migration can be applied. Any row is a pre-existing conflict to be resolved by an authorized review first
-- (migration 0038 refuses to apply while one exists). The output contains internal record ids: keep it inside TES.
SET default_transaction_read_only = on;

\echo '1. Vehicles with more than one CURRENT OWNER'
SELECT vehicle_id, count(*) AS open_owners, array_agg(organization_id ORDER BY organization_id) AS organization_ids
  FROM public.organization_vehicle_relationships WHERE relationship_type = 'OWNS' AND record_status = 'active' AND effective_to IS NULL
 GROUP BY vehicle_id HAVING count(*) > 1;

\echo '2. Vehicles with more than one CURRENT OPERATOR'
SELECT vehicle_id, count(*) AS open_operators, array_agg(organization_id ORDER BY organization_id) AS organization_ids
  FROM public.organization_vehicle_relationships WHERE relationship_type = 'OPERATES' AND record_status = 'active' AND effective_to IS NULL
 GROUP BY vehicle_id HAVING count(*) > 1;

\echo '3. Company identifiers colliding under equivalent jurisdiction spellings'
SELECT lower(btrim(namespace)) AS namespace, lower(btrim(identifier_type)) AS identifier_type, tes_security.canonical_country_code(jurisdiction_country) AS country,
       tes_security.canonical_region_code(jurisdiction_region) AS region, normalized_value, count(*) AS rows, array_agg(organization_id ORDER BY organization_id) AS organization_ids
  FROM public.organization_identifiers WHERE status = 'active'
 GROUP BY 1, 2, 3, 4, 5 HAVING count(*) > 1;

\echo '3b. National numbers (CRA business number / IRS EIN) held by more than one active identifier, whatever jurisdiction was recorded'
SELECT lower(btrim(namespace)) AS namespace, lower(btrim(identifier_type)) AS identifier_type, normalized_value, count(*) AS rows,
       array_agg(organization_id ORDER BY organization_id) AS organization_ids, array_agg(jurisdiction_country ORDER BY organization_id) AS recorded_countries
  FROM public.organization_identifiers
 WHERE status = 'active'
   AND ((lower(btrim(namespace)) = 'cra' AND lower(btrim(identifier_type)) = 'business_number')
     OR (lower(btrim(namespace)) = 'irs' AND lower(btrim(identifier_type)) = 'employer_identification_number'))
 GROUP BY 1, 2, 3 HAVING count(*) > 1;

\echo '4. Registrations colliding under equivalent jurisdiction spellings'
SELECT program_code, tes_security.canonical_country_code(jurisdiction_country) AS country, tes_security.canonical_region_code(jurisdiction_region) AS region,
       number_normalized, count(*) AS rows, array_agg(registration_id ORDER BY registration_id) AS registration_ids
  FROM public.registration_versions WHERE record_status = 'active' AND effective_to IS NULL
 GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;

\echo '5. Operating authorities colliding under equivalent jurisdiction spellings'
SELECT kind, tes_security.canonical_country_code(jurisdiction_country) AS country, tes_security.canonical_region_code(jurisdiction_region) AS region,
       number_normalized, count(*) AS rows, array_agg(authority_id ORDER BY authority_id) AS authority_ids
  FROM public.operating_authority_versions WHERE record_status = 'active' AND effective_to IS NULL
 GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;

\echo '6. Current plates colliding under equivalent jurisdiction spellings'
SELECT tes_security.canonical_country_code(jurisdiction_country) AS country, tes_security.canonical_region_code(jurisdiction_region) AS region,
       plate_normalized, count(*) AS rows, array_agg(vehicle_id ORDER BY vehicle_id) AS vehicle_ids
  FROM public.vehicle_registration_periods WHERE plate_normalized IS NOT NULL AND record_status = 'active' AND effective_to IS NULL
 GROUP BY 1, 2, 3 HAVING count(*) > 1;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- INFORMATIONAL (these do NOT make the migration refuse; they are explicit unresolved records kept for review)
-- ---------------------------------------------------------------------------------------------------------------------------------------------

\echo '7. Active company identifiers whose jurisdiction does not satisfy the new scope rule (kept as they are; NOT VALID check; review and correct by supersede)'
SELECT id AS identifier_id, organization_id, identifier_type, namespace, jurisdiction_country, jurisdiction_region
  FROM public.organization_identifiers
 WHERE status = 'active' AND NOT COALESCE(
   CASE
     WHEN lower(btrim(namespace)) = 'cra' AND lower(btrim(identifier_type)) = 'business_number' THEN jurisdiction_country = 'CA' AND jurisdiction_region IS NULL
     WHEN lower(btrim(namespace)) = 'irs' AND lower(btrim(identifier_type)) = 'employer_identification_number' THEN jurisdiction_country = 'US' AND jurisdiction_region IS NULL
     WHEN lower(btrim(namespace)) = 'corporate_registry' AND lower(btrim(identifier_type)) = 'incorporation_number'
       THEN jurisdiction_country ~ '^[A-Z]{2}$' AND (jurisdiction_country <> 'US' OR jurisdiction_region IS NOT NULL) AND (jurisdiction_region IS NULL OR jurisdiction_region ~ '^[A-Z0-9]{1,3}$')
     WHEN lower(btrim(namespace)) = 'corporate_registry' AND lower(btrim(identifier_type)) = 'extra_provincial_registration'
       THEN jurisdiction_country ~ '^[A-Z]{2}$' AND jurisdiction_region ~ '^[A-Z0-9]{1,3}$'
     ELSE true
   END, false);

\echo '8. Current registrations and authorities with an explicitly UNRESOLVED (NULL) jurisdiction (legitimate pending state, migration 0034) that share a number with another current record: review for a duplicate'
SELECT 'REGISTRATION' AS domain, u.program_code AS kind, u.number_normalized, u.registration_id AS unresolved_id, r.registration_id AS other_id
  FROM public.registration_versions u JOIN public.registration_versions r
    ON r.program_code = u.program_code AND r.number_normalized = u.number_normalized AND r.id <> u.id AND r.record_status = 'active' AND r.effective_to IS NULL
 WHERE u.record_status = 'active' AND u.effective_to IS NULL AND u.jurisdiction_country IS NULL AND u.program_code IN ('IFTA')
UNION ALL
SELECT 'AUTHORITY', u.kind, u.number_normalized, u.authority_id, r.authority_id
  FROM public.operating_authority_versions u JOIN public.operating_authority_versions r
    ON r.kind = u.kind AND r.number_normalized = u.number_normalized AND r.id <> u.id AND r.record_status = 'active' AND r.effective_to IS NULL
 WHERE u.record_status = 'active' AND u.effective_to IS NULL AND (u.jurisdiction_country IS NULL OR u.jurisdiction_region IS NULL);
