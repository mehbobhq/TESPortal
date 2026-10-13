-- READ-ONLY assessment of company records before/after the Company recovery release.
--
-- Run as a read-only identity (or the migrator) inside a read-only transaction; it never writes:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'BEGIN READ ONLY' -f scripts/database/assessment/company-recovery-assessment.sql -c 'ROLLBACK'
-- (or paste it into a session that has already issued BEGIN READ ONLY).
--
-- It reports COUNTS and canonical ids only. Nothing is repaired, merged or deleted by this file. Every finding is evidence for a
-- human to review; "possible duplicate" rows in particular are NEVER to be merged automatically (see docs/company-recovery.md).
-- Each statement is independent and starts with a `-- name:` line so the output can be attributed.

-- name: 01 record counts
SELECT 'organizations' AS table_name, count(*) AS rows FROM public.organizations
UNION ALL SELECT 'customers', count(*) FROM public.customers
UNION ALL SELECT 'customer_engagements', count(*) FROM public.customer_engagements
UNION ALL SELECT 'locations', count(*) FROM public.locations
UNION ALL SELECT 'organization_location_assignments', count(*) FROM public.organization_location_assignments
UNION ALL SELECT 'persons', count(*) FROM public.persons
UNION ALL SELECT 'organization_person_relationships', count(*) FROM public.organization_person_relationships
UNION ALL SELECT 'organization_channels', count(*) FROM public.organization_channels
UNION ALL SELECT 'operating_authorities', count(*) FROM public.operating_authorities
UNION ALL SELECT 'registrations', count(*) FROM public.registrations
UNION ALL SELECT 'company_operating_scope_periods', count(*) FROM public.company_operating_scope_periods
UNION ALL SELECT 'vehicles', count(*) FROM public.vehicles
UNION ALL SELECT 'organization_vehicle_relationships', count(*) FROM public.organization_vehicle_relationships
UNION ALL SELECT 'organization_driver_relationships', count(*) FROM public.organization_driver_relationships
ORDER BY table_name;

-- name: 02 organizations without a primary classification (partial creation, or created before classifications existed)
SELECT o.id, o.legal_name, o.created_at
  FROM public.organizations o
 WHERE NOT EXISTS (SELECT 1 FROM public.organization_classifications c WHERE c.organization_id = o.id AND c.is_primary AND c.effective_to IS NULL)
 ORDER BY o.created_at, o.id;

-- name: 03 customers without any engagement (a customer must have one engagement stage)
SELECT c.id AS customer_id, c.organization_id, o.legal_name
  FROM public.customers c
  JOIN public.organizations o ON o.id = c.organization_id
 WHERE NOT EXISTS (SELECT 1 FROM public.customer_engagements e WHERE e.customer_id = c.id)
 ORDER BY o.legal_name, c.id;

-- name: 04 customers with more than one open engagement (should be impossible)
SELECT customer_id, count(*) AS open_engagements
  FROM public.customer_engagements
 WHERE ended_at IS NULL
 GROUP BY customer_id
HAVING count(*) > 1;

-- name: 05 organizations with no current location assignment at all (nothing recorded yet, or the pre-recovery form dropped it)
SELECT o.id, o.legal_name,
       EXISTS (SELECT 1 FROM public.customers c WHERE c.organization_id = o.id) AS is_customer
  FROM public.organizations o
 WHERE NOT EXISTS (SELECT 1 FROM public.organization_location_assignments a WHERE a.organization_id = o.id AND a.effective_to IS NULL AND a.status = 'active')
 ORDER BY o.legal_name, o.id;

-- name: 06 organizations with a current location but no REGISTERED address
SELECT o.id, o.legal_name
  FROM public.organizations o
 WHERE EXISTS (SELECT 1 FROM public.organization_location_assignments a WHERE a.organization_id = o.id AND a.effective_to IS NULL AND a.status = 'active')
   AND NOT EXISTS (SELECT 1 FROM public.organization_location_assignments a WHERE a.organization_id = o.id AND a.role = 'REGISTERED' AND a.effective_to IS NULL AND a.status = 'active')
 ORDER BY o.legal_name, o.id;

-- name: 07 organizations with no operating scope recorded
SELECT o.id, o.legal_name
  FROM public.organizations o
 WHERE NOT EXISTS (SELECT 1 FROM public.company_operating_scope_periods p WHERE p.organization_id = o.id AND p.effective_to IS NULL AND p.record_status = 'active')
 ORDER BY o.legal_name, o.id;

-- name: 08 customers with no current contact person and no company phone/email line
SELECT c.organization_id, o.legal_name
  FROM public.customers c
  JOIN public.organizations o ON o.id = c.organization_id
 WHERE NOT EXISTS (SELECT 1 FROM public.organization_person_relationships r WHERE r.organization_id = c.organization_id AND r.effective_to IS NULL AND r.record_status = 'active')
   AND NOT EXISTS (SELECT 1 FROM public.organization_channels ch WHERE ch.organization_id = c.organization_id AND ch.effective_to IS NULL AND ch.record_status = 'active')
 ORDER BY o.legal_name, c.organization_id;

-- name: 09 POSSIBLE duplicate identities: active organizations that share a normalized legal name (REVIEW ONLY - never merge automatically)
SELECT normalized_legal_name, count(*) AS organizations, array_agg(id ORDER BY created_at, id) AS organization_ids
  FROM public.organizations
 WHERE status = 'active'
 GROUP BY normalized_legal_name
HAVING count(*) > 1
 ORDER BY normalized_legal_name;

-- name: 10 locations nobody uses (created by an interrupted creation, or released)
SELECT l.id, l.kind, l.created_at
  FROM public.locations l
 WHERE NOT EXISTS (SELECT 1 FROM public.organization_location_assignments a WHERE a.location_id = l.id)
 ORDER BY l.created_at, l.id;

-- name: 11 persons with no organization relationship (contacts left behind by an interrupted creation)
SELECT p.id, p.created_at
  FROM public.persons p
 WHERE NOT EXISTS (SELECT 1 FROM public.organization_person_relationships r WHERE r.person_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM public.organization_driver_relationships d WHERE d.person_id = p.id)
 ORDER BY p.created_at, p.id;

-- name: 12 vehicles with no organization relationship
SELECT v.id, v.created_at
  FROM public.vehicles v
 WHERE NOT EXISTS (SELECT 1 FROM public.organization_vehicle_relationships r WHERE r.vehicle_id = v.id)
 ORDER BY v.created_at, v.id;

-- name: 13 organizations that carry company-scoped records but no identity at all (no identifier, no alias, no classification)
SELECT o.id, o.legal_name
  FROM public.organizations o
 WHERE NOT EXISTS (SELECT 1 FROM public.organization_identifiers i WHERE i.organization_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM public.organization_classifications c WHERE c.organization_id = o.id)
 ORDER BY o.legal_name, o.id;
