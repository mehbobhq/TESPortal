-- READ-ONLY: identify the existing "Power Way Logistics Inc" organization by its CANONICAL id and summarise what is recorded for it.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'BEGIN READ ONLY' \
--        -f scripts/database/assessment/power-way-identification.sql -c 'ROLLBACK'
--
-- Needs the migrator/read identity (the runtime role cannot read public.legacy_record_map). Writes nothing, merges nothing, deletes
-- nothing. Possible duplicates are only REPORTED. Values the old creation form discarded before persistence are not in the database
-- and cannot be reconstructed from it; this file never invents them.

-- name: 01 candidate organizations by name (canonical ids; more than one row is a duplicate to REVIEW, never to merge)
SELECT o.id AS organization_id, o.legal_name, o.display_name, o.status, o.created_at,
       EXISTS (SELECT 1 FROM public.customers c WHERE c.organization_id = o.id) AS is_customer
  FROM public.organizations o
 WHERE o.normalized_legal_name LIKE '%power way logistics%'
    OR lower(coalesce(o.display_name, '')) LIKE '%power way logistics%'
 ORDER BY o.created_at, o.id;

-- name: 02 identifiers recorded for those organizations
SELECT o.id AS organization_id, i.identifier_type, i.namespace, i.value, i.status
  FROM public.organizations o
  JOIN public.organization_identifiers i ON i.organization_id = o.id
 WHERE o.normalized_legal_name LIKE '%power way logistics%' OR lower(coalesce(o.display_name, '')) LIKE '%power way logistics%'
 ORDER BY o.id, i.identifier_type;

-- name: 03 legacy (browser-prototype) ids mapped to those organizations, if the controlled import ever mapped any
SELECT m.organization_id, m.source_system, m.source_namespace, m.legacy_entity_type, m.legacy_id, m.mapping_status, m.imported_at
  FROM public.legacy_record_map m
  JOIN public.organizations o ON o.id = m.organization_id
 WHERE o.normalized_legal_name LIKE '%power way logistics%' OR lower(coalesce(o.display_name, '')) LIKE '%power way logistics%'
 ORDER BY m.organization_id, m.imported_at;

-- name: 04 what is recorded under each candidate (counts only)
SELECT o.id AS organization_id,
       (SELECT count(*) FROM public.organization_location_assignments a WHERE a.organization_id = o.id) AS location_assignments,
       (SELECT count(*) FROM public.organization_person_relationships r WHERE r.organization_id = o.id) AS contact_relationships,
       (SELECT count(*) FROM public.organization_channels ch WHERE ch.organization_id = o.id) AS company_channels,
       (SELECT count(*) FROM public.operating_authorities x WHERE x.organization_id = o.id) AS authorities,
       (SELECT count(*) FROM public.registrations g WHERE g.organization_id = o.id) AS tax_registrations,
       (SELECT count(*) FROM public.company_operating_scope_periods p WHERE p.organization_id = o.id) AS operating_scope_periods,
       (SELECT count(*) FROM public.organization_vehicle_relationships v WHERE v.organization_id = o.id) AS vehicle_relationships,
       (SELECT count(*) FROM public.organization_driver_relationships d WHERE d.organization_id = o.id) AS driver_relationships
  FROM public.organizations o
 WHERE o.normalized_legal_name LIKE '%power way logistics%' OR lower(coalesce(o.display_name, '')) LIKE '%power way logistics%'
 ORDER BY o.id;
