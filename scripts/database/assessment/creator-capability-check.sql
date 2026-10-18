-- READ-ONLY: which actors can create and edit a complete company today?
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'BEGIN READ ONLY' \
--        -f scripts/database/assessment/creator-capability-check.sql -c 'ROLLBACK'
--
-- It mirrors tes_security.system_context_authorized() (migration 0024): an actor holds a SYSTEM capability when it is an active
-- Master Account, or an active TES_STAFF relationship has an active SYSTEM-scope assignment and an active grant of that
-- capability. It reads authorization tables only and reports actor ids and provider subjects, never credentials.
-- Nothing is granted by this file. A missing capability is corrected only by the reviewed procedure in docs/company-recovery.md.
--
-- Capabilities used by the recovery release:
--   writes (create + edit): ORGANIZATION_CREATE (always), COMPANY_PROFILE_MANAGE (always), CUSTOMER_ESTABLISH (Customer),
--                           ORGANIZATION_UPDATE (addresses, authorities, edits), CONTACT_MANAGE (contact/channels),
--                           TAX_REGISTRATION_MANAGE (tax accounts)
--   reads  (profile):       ORGANIZATION_REGISTRY_READ, CUSTOMER_RELATIONSHIP_READ, COMPANY_PROFILE_READ, PERSON_REGISTRY_READ,
--                           TAX_REGISTRATION_READ

-- name: 01 required capabilities exist and are active in the catalogue
SELECT r.code, c.id IS NOT NULL AS in_catalogue, COALESCE(c.is_active, false) AS is_active
  FROM unnest(ARRAY['ORGANIZATION_CREATE','COMPANY_PROFILE_MANAGE','CUSTOMER_ESTABLISH','ORGANIZATION_UPDATE','CONTACT_MANAGE','TAX_REGISTRATION_MANAGE',
                    'ORGANIZATION_REGISTRY_READ','CUSTOMER_RELATIONSHIP_READ','COMPANY_PROFILE_READ','PERSON_REGISTRY_READ','TAX_REGISTRATION_READ']) AS r(code)
  LEFT JOIN public.capabilities c ON c.code = r.code
 ORDER BY r.code;

-- name: 02 per-actor effective capabilities (one row per active actor with a TES_STAFF relationship or Master Account authority)
WITH required(code) AS (
  VALUES ('ORGANIZATION_CREATE'),('COMPANY_PROFILE_MANAGE'),('CUSTOMER_ESTABLISH'),('ORGANIZATION_UPDATE'),('CONTACT_MANAGE'),('TAX_REGISTRATION_MANAGE'),
         ('ORGANIZATION_REGISTRY_READ'),('CUSTOMER_RELATIONSHIP_READ'),('COMPANY_PROFILE_READ'),('PERSON_REGISTRY_READ'),('TAX_REGISTRATION_READ')
), actors_in_scope AS (
  SELECT a.id AS actor_id
    FROM public.actors a
   WHERE EXISTS (SELECT 1 FROM public.master_account_authority m WHERE m.actor_id = a.id AND m.status = 'active' AND m.ended_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.actor_relationships r WHERE r.actor_id = a.id AND r.relationship_type = 'TES_STAFF' AND r.status = 'active')
), effective AS (
  SELECT s.actor_id, q.code,
         (
           EXISTS (SELECT 1 FROM public.master_account_authority m
                    WHERE m.actor_id = s.actor_id AND m.status = 'active' AND m.designated_at <= statement_timestamp() AND (m.ended_at IS NULL OR m.ended_at > statement_timestamp()))
           OR EXISTS (
             SELECT 1
               FROM public.actor_relationships ar
               JOIN public.relationship_assignments ra ON ra.relationship_id = ar.id
               JOIN public.relationship_capability_grants g ON g.relationship_id = ar.id
               JOIN public.capabilities c ON c.id = g.capability_id
              WHERE ar.actor_id = s.actor_id AND ar.relationship_type = 'TES_STAFF' AND ar.status = 'active'
                AND ar.starts_at <= statement_timestamp() AND (ar.ends_at IS NULL OR ar.ends_at > statement_timestamp())
                AND ra.scope_type = 'SYSTEM' AND ra.customer_id IS NULL AND ra.status = 'active'
                AND ra.starts_at <= statement_timestamp() AND (ra.ends_at IS NULL OR ra.ends_at > statement_timestamp())
                AND g.status = 'active' AND g.granted_at <= statement_timestamp() AND (g.ended_at IS NULL OR g.ended_at > statement_timestamp())
                AND (g.assignment_id IS NULL OR g.assignment_id = ra.id)
                AND c.code = q.code AND c.is_active)
         ) AS held
    FROM actors_in_scope s CROSS JOIN required q
)
SELECT e.actor_id,
       EXISTS (SELECT 1 FROM public.master_account_authority m WHERE m.actor_id = e.actor_id AND m.status = 'active' AND m.ended_at IS NULL) AS master_account,
       (SELECT string_agg(i.provider || ':' || i.provider_subject, ', ') FROM public.authentication_identities i WHERE i.actor_id = e.actor_id AND i.status = 'active') AS sign_in_identities,
       bool_and(e.held) FILTER (WHERE e.code IN ('ORGANIZATION_CREATE','COMPANY_PROFILE_MANAGE')) AS can_create_minimal_company,
       bool_and(e.held) FILTER (WHERE e.code IN ('ORGANIZATION_CREATE','COMPANY_PROFILE_MANAGE','CUSTOMER_ESTABLISH','ORGANIZATION_UPDATE','CONTACT_MANAGE','TAX_REGISTRATION_MANAGE')) AS can_create_complete_customer,
       bool_and(e.held) FILTER (WHERE e.code IN ('ORGANIZATION_REGISTRY_READ','CUSTOMER_RELATIONSHIP_READ','COMPANY_PROFILE_READ','PERSON_REGISTRY_READ','TAX_REGISTRATION_READ')) AS can_read_complete_profile,
       array_agg(e.code ORDER BY e.code) FILTER (WHERE NOT e.held) AS missing_capabilities
  FROM effective e
 GROUP BY e.actor_id
 ORDER BY e.actor_id;
