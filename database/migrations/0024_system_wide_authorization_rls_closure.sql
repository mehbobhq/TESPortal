-- TES system-wide authorization + RLS closure
-- Migration: 0024
--
-- Security model:
--   * authentication/authorization kernel and immutable migration controls remain global SYSTEM infrastructure;
--   * shared vocabularies remain read-only reference data;
--   * canonical business tables are protected by RLS for the runtime role;
--   * CUSTOMER reads require BOTH an authorized CUSTOMER context and ownership/relationship to that customer;
--   * SYSTEM access requires the exact authorized SYSTEM capability established for the transaction;
--   * there is no unconditional runtime SYSTEM bypass.
--
-- RLS is ENABLED (not FORCEd): the table owner is the migration identity, not the application runtime.
-- This lets protected helper/verification work execute as owner while every query made by the backend runtime remains
-- policy-bound. The backend role has no BYPASSRLS privilege.

CREATE OR REPLACE FUNCTION tes_security.current_system_actor_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT CASE WHEN btrim(current_setting('tes.system_actor_id',true))
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN btrim(current_setting('tes.system_actor_id',true))::uuid ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION tes_security.current_system_capability()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT nullif(btrim(current_setting('tes.system_capability',true)),'')
$$;

CREATE OR REPLACE FUNCTION tes_security.current_customer_actor_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT CASE WHEN btrim(current_setting('tes.customer_actor_id',true))
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN btrim(current_setting('tes.customer_actor_id',true))::uuid ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION tes_security.current_customer_capability()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT nullif(btrim(current_setting('tes.customer_capability',true)),'')
$$;

CREATE OR REPLACE FUNCTION tes_security.system_context_authorized(required_capabilities text[] DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
  WITH ctx AS (
    SELECT tes_security.current_system_actor_id() actor_id,
           tes_security.current_system_capability() capability,
           statement_timestamp() as_of
  )
  SELECT COALESCE((
    SELECT c.is_active
      AND (required_capabilities IS NULL OR c.code=ANY(required_capabilities))
      AND (
        EXISTS (
          SELECT 1 FROM public.master_account_authority maa
          WHERE maa.actor_id=ctx.actor_id AND maa.status='active'
            AND maa.designated_at<=ctx.as_of AND (maa.ended_at IS NULL OR maa.ended_at>ctx.as_of)
        )
        OR EXISTS (
          SELECT 1
          FROM public.actor_relationships ar
          JOIN public.relationship_assignments ra ON ra.relationship_id=ar.id
          JOIN public.relationship_capability_grants rcg ON rcg.relationship_id=ar.id
          WHERE ar.actor_id=ctx.actor_id AND ar.relationship_type='TES_STAFF' AND ar.status='active'
            AND ar.starts_at<=ctx.as_of AND (ar.ends_at IS NULL OR ar.ends_at>ctx.as_of)
            AND ra.scope_type='SYSTEM' AND ra.customer_id IS NULL AND ra.status='active'
            AND ra.starts_at<=ctx.as_of AND (ra.ends_at IS NULL OR ra.ends_at>ctx.as_of)
            AND rcg.capability_id=c.id AND rcg.status='active'
            AND rcg.granted_at<=ctx.as_of AND (rcg.ended_at IS NULL OR rcg.ended_at>ctx.as_of)
            AND (rcg.assignment_id IS NULL OR rcg.assignment_id=ra.id)
        )
      )
    FROM ctx JOIN public.capabilities c ON c.code=ctx.capability
  ),false)
$$;

CREATE OR REPLACE FUNCTION tes_security.customer_context_authorized(required_capabilities text[] DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
  WITH ctx AS (
    SELECT tes_security.current_customer_actor_id() actor_id,
           tes_security.current_customer_capability() capability,
           tes_security.current_customer_id() customer_id,
           statement_timestamp() as_of
  )
  SELECT COALESCE((
    SELECT c.is_active
      AND ctx.customer_id IS NOT NULL
      AND (required_capabilities IS NULL OR c.code=ANY(required_capabilities))
      AND (
        EXISTS (
          SELECT 1 FROM public.master_account_authority maa
          WHERE maa.actor_id=ctx.actor_id AND maa.status='active'
            AND maa.designated_at<=ctx.as_of AND (maa.ended_at IS NULL OR maa.ended_at>ctx.as_of)
        )
        OR EXISTS (
          SELECT 1
          FROM public.actor_relationships ar
          JOIN public.relationship_assignments ra ON ra.relationship_id=ar.id
          JOIN public.relationship_capability_grants rcg ON rcg.relationship_id=ar.id
          WHERE ar.actor_id=ctx.actor_id AND ar.status='active'
            AND ar.starts_at<=ctx.as_of AND (ar.ends_at IS NULL OR ar.ends_at>ctx.as_of)
            AND ra.scope_type='CUSTOMER' AND ra.customer_id=ctx.customer_id AND ra.status='active'
            AND ra.starts_at<=ctx.as_of AND (ra.ends_at IS NULL OR ra.ends_at>ctx.as_of)
            AND rcg.capability_id=c.id AND rcg.status='active'
            AND rcg.granted_at<=ctx.as_of AND (rcg.ended_at IS NULL OR rcg.ended_at>ctx.as_of)
            AND (rcg.assignment_id IS NULL OR rcg.assignment_id=ra.id)
        )
      )
    FROM ctx JOIN public.capabilities c ON c.code=ctx.capability
  ),false)
$$;

CREATE OR REPLACE FUNCTION tes_security.accessible_customers_for_actor(p_actor_id uuid,p_capability text,p_limit integer)
RETURNS TABLE(customer_id uuid,organization_id uuid,legal_name text,display_name text,organization_status text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $access$
  SELECT DISTINCT cu.id,o.id,o.legal_name,o.display_name,o.status
  FROM public.actor_relationships ar
  JOIN public.relationship_assignments ra ON ra.relationship_id=ar.id
  JOIN public.relationship_capability_grants rcg ON rcg.relationship_id=ar.id
  JOIN public.capabilities c ON c.id=rcg.capability_id
  JOIN public.customers cu ON cu.id=ra.customer_id
  JOIN public.organizations o ON o.id=cu.organization_id
  WHERE p_limit BETWEEN 1 AND 500
    AND ar.actor_id=p_actor_id AND ar.status='active'
    AND ar.starts_at<=statement_timestamp() AND (ar.ends_at IS NULL OR ar.ends_at>statement_timestamp())
    AND ra.scope_type='CUSTOMER' AND ra.customer_id IS NOT NULL AND ra.status='active'
    AND ra.starts_at<=statement_timestamp() AND (ra.ends_at IS NULL OR ra.ends_at>statement_timestamp())
    AND rcg.status='active' AND rcg.granted_at<=statement_timestamp()
    AND (rcg.ended_at IS NULL OR rcg.ended_at>statement_timestamp())
    AND (rcg.assignment_id IS NULL OR rcg.assignment_id=ra.id)
    AND c.code=p_capability AND c.is_active
  ORDER BY lower(coalesce(o.display_name,o.legal_name)),cu.id
  LIMIT p_limit
$access$;

REVOKE ALL ON FUNCTION tes_security.accessible_customers_for_actor(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.accessible_customers_for_actor(uuid,text,integer)
TO "tes-backend@tes-production-510007.iam";

REVOKE ALL ON FUNCTION tes_security.current_system_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.current_system_capability() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.current_customer_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.current_customer_capability() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.system_context_authorized(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.customer_context_authorized(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tes_security.current_system_actor_id(),tes_security.current_system_capability(),
  tes_security.current_customer_actor_id(),tes_security.current_customer_capability(),
  tes_security.system_context_authorized(text[]),tes_security.customer_context_authorized(text[])
TO "tes-backend@tes-production-510007.iam";

INSERT INTO public.capabilities(code,display_name,description,is_active,sort_order)
VALUES ('MASTER_REGISTER_READ','Master Register read','Read the immutable Master Register. Intended scope: SYSTEM.',true,206);

-- Helper macro is expressed as explicit policies so pg_policy remains auditable and mutation-testable.
-- Corporate identity + customer root.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_system ON public.organizations FOR ALL
  USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_CREATE','ORGANIZATION_UPDATE','ORGANIZATION_ARCHIVE','CUSTOMER_ESTABLISH','INSURANCE_READ','INSURANCE_MANAGE','CREDENTIAL_READ','CREDENTIAL_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_CREATE','ORGANIZATION_UPDATE','ORGANIZATION_ARCHIVE','CUSTOMER_ESTABLISH','INSURANCE_MANAGE','CREDENTIAL_MANAGE']));
CREATE POLICY organizations_customer_read ON public.organizations FOR SELECT USING (
  tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'])
  AND (
    id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id())
    OR EXISTS (SELECT 1 FROM public.insurance_policies p WHERE p.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()) AND p.insurer_organization_id=organizations.id)
    OR EXISTS (SELECT 1 FROM public.insurance_broker_periods b WHERE b.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()) AND b.broker_organization_id=organizations.id)
  )
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_system ON public.customers FOR ALL
  USING (tes_security.system_context_authorized(ARRAY['CUSTOMER_ESTABLISH','CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE','ORGANIZATION_REGISTRY_READ']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CUSTOMER_ESTABLISH','CUSTOMER_RELATIONSHIP_MANAGE']));
-- Requested scope is allowed to see only its own customer anchor during authorization; this is narrowing, not authorization.
CREATE POLICY customers_requested_scope_read ON public.customers FOR SELECT USING (id=tes_security.current_customer_id());

-- Organization-owned direct tables.
DO $rls$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY[
  'organization_identifiers','organization_aliases','organization_classifications',
  'organization_channels','organization_person_relationships','organization_person_titles','contact_purpose_assignments',
  'operating_authorities','operating_authority_versions',
  'registrations','registration_versions',
  'insurance_policies','insurance_policy_terms','insurance_endorsements','insurance_coverages','insurance_broker_periods',
  'company_operating_scope_periods','company_rule_applicability_periods','company_driver_requirement_periods',
  'organization_vehicle_relationships','vehicle_registration_periods','organization_driver_relationships'
 ] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $rls$;

-- Corporate identity children.
CREATE POLICY organization_identifiers_system ON public.organization_identifiers FOR ALL USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_UPDATE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE']));
CREATE POLICY organization_identifiers_customer ON public.organization_identifiers FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY organization_aliases_system ON public.organization_aliases FOR ALL USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_UPDATE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE']));
CREATE POLICY organization_aliases_customer ON public.organization_aliases FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY organization_classifications_system ON public.organization_classifications FOR ALL USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_UPDATE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE']));
CREATE POLICY organization_classifications_customer ON public.organization_classifications FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));

-- Locations.
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_location_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY locations_system ON public.locations FOR ALL USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_UPDATE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE']));
CREATE POLICY locations_customer ON public.locations FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.organization_location_assignments a WHERE a.location_id=locations.id AND a.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id())));
CREATE POLICY location_addresses_system ON public.location_addresses FOR ALL USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_UPDATE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE']));
CREATE POLICY location_addresses_customer ON public.location_addresses FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.organization_location_assignments a WHERE a.location_id=location_addresses.location_id AND a.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id())));
CREATE POLICY organization_location_assignments_system ON public.organization_location_assignments FOR ALL USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_UPDATE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE']));
CREATE POLICY organization_location_assignments_customer ON public.organization_location_assignments FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));

-- Authorities.
CREATE POLICY operating_authorities_system ON public.operating_authorities FOR ALL USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_UPDATE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE']));
CREATE POLICY operating_authorities_customer ON public.operating_authorities FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY operating_authority_versions_system ON public.operating_authority_versions FOR ALL USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_UPDATE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE']));
CREATE POLICY operating_authority_versions_customer ON public.operating_authority_versions FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
ALTER TABLE public.operating_authority_status_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY operating_authority_status_periods_system ON public.operating_authority_status_periods FOR ALL USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_UPDATE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_UPDATE']));
CREATE POLICY operating_authority_status_periods_customer ON public.operating_authority_status_periods FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.operating_authorities a WHERE a.id=operating_authority_status_periods.authority_id AND a.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id())));

-- Contacts / people.
ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_name_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY persons_system ON public.persons FOR ALL USING (tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ','CONTACT_MANAGE','DRIVER_READ','DRIVER_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE','DRIVER_MANAGE']));
CREATE POLICY persons_customer ON public.persons FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND (
 EXISTS (SELECT 1 FROM public.organization_person_relationships r WHERE r.person_id=persons.id AND r.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()))
 OR EXISTS (SELECT 1 FROM public.organization_driver_relationships r WHERE r.person_id=persons.id AND r.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()))
));
CREATE POLICY person_name_versions_system ON public.person_name_versions FOR ALL USING (tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ','CONTACT_MANAGE','DRIVER_READ','DRIVER_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE','DRIVER_MANAGE']));
CREATE POLICY person_name_versions_customer ON public.person_name_versions FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.persons p WHERE p.id=person_name_versions.person_id));
CREATE POLICY person_channels_system ON public.person_channels FOR ALL USING (tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ','CONTACT_MANAGE','DRIVER_READ','DRIVER_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE','DRIVER_MANAGE']));
CREATE POLICY person_channels_customer ON public.person_channels FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.persons p WHERE p.id=person_channels.person_id));
CREATE POLICY organization_channels_system ON public.organization_channels FOR ALL USING (tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ','CONTACT_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE']));
CREATE POLICY organization_channels_customer ON public.organization_channels FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY organization_person_relationships_system ON public.organization_person_relationships FOR ALL USING (tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ','CONTACT_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE']));
CREATE POLICY organization_person_relationships_customer ON public.organization_person_relationships FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY organization_person_titles_system ON public.organization_person_titles FOR ALL USING (tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ','CONTACT_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE']));
CREATE POLICY organization_person_titles_customer ON public.organization_person_titles FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY contact_purpose_assignments_system ON public.contact_purpose_assignments FOR ALL USING (tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ','CONTACT_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE']));
CREATE POLICY contact_purpose_assignments_customer ON public.contact_purpose_assignments FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));

-- Customer relationship graph.
ALTER TABLE public.customer_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_engagement_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_engagement_terminations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_agreement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_service_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_responsibility_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_engagements_system ON public.customer_engagements FOR ALL USING (tes_security.system_context_authorized(ARRAY['CUSTOMER_ESTABLISH','CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CUSTOMER_ESTABLISH','CUSTOMER_RELATIONSHIP_MANAGE']));
CREATE POLICY customer_engagements_customer ON public.customer_engagements FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND customer_id=tes_security.current_customer_id());
CREATE POLICY customer_engagement_stages_system ON public.customer_engagement_stages FOR ALL USING (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_MANAGE']));
CREATE POLICY customer_engagement_stages_customer ON public.customer_engagement_stages FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.customer_engagements e WHERE e.id=customer_engagement_stages.engagement_id AND e.customer_id=tes_security.current_customer_id()));
CREATE POLICY customer_engagement_terminations_system ON public.customer_engagement_terminations FOR ALL USING (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_MANAGE']));
CREATE POLICY customer_engagement_terminations_customer ON public.customer_engagement_terminations FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.customer_engagements e WHERE e.id=customer_engagement_terminations.engagement_id AND e.customer_id=tes_security.current_customer_id()));
CREATE POLICY customer_agreements_system ON public.customer_agreements FOR ALL USING (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_MANAGE']));
CREATE POLICY customer_agreements_customer ON public.customer_agreements FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND customer_id=tes_security.current_customer_id());
CREATE POLICY customer_agreement_versions_system ON public.customer_agreement_versions FOR ALL USING (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_MANAGE']));
CREATE POLICY customer_agreement_versions_customer ON public.customer_agreement_versions FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.customer_agreements a WHERE a.id=customer_agreement_versions.agreement_id AND a.customer_id=tes_security.current_customer_id()));
CREATE POLICY engagement_service_scopes_system ON public.engagement_service_scopes FOR ALL USING (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_MANAGE']));
CREATE POLICY engagement_service_scopes_customer ON public.engagement_service_scopes FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.customer_engagements e WHERE e.id=engagement_service_scopes.engagement_id AND e.customer_id=tes_security.current_customer_id()));
CREATE POLICY engagement_responsibility_periods_system ON public.engagement_responsibility_periods FOR ALL USING (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CUSTOMER_RELATIONSHIP_MANAGE']));
CREATE POLICY engagement_responsibility_periods_customer ON public.engagement_responsibility_periods FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.customer_engagements e JOIN public.engagement_service_scopes s ON s.engagement_id=e.id WHERE s.id=engagement_responsibility_periods.scope_id AND e.customer_id=tes_security.current_customer_id()));

-- Tax / registration.
CREATE POLICY registrations_system ON public.registrations FOR ALL USING (tes_security.system_context_authorized(ARRAY['TAX_REGISTRATION_READ','TAX_REGISTRATION_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['TAX_REGISTRATION_MANAGE']));
CREATE POLICY registrations_customer ON public.registrations FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY registration_versions_system ON public.registration_versions FOR ALL USING (tes_security.system_context_authorized(ARRAY['TAX_REGISTRATION_READ','TAX_REGISTRATION_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['TAX_REGISTRATION_MANAGE']));
CREATE POLICY registration_versions_customer ON public.registration_versions FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
ALTER TABLE public.registration_status_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY registration_status_periods_system ON public.registration_status_periods FOR ALL USING (tes_security.system_context_authorized(ARRAY['TAX_REGISTRATION_READ','TAX_REGISTRATION_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['TAX_REGISTRATION_MANAGE']));
CREATE POLICY registration_status_periods_customer ON public.registration_status_periods FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.registrations r WHERE r.id=registration_status_periods.registration_id AND r.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id())));

-- Insurance.
CREATE POLICY insurance_policies_system ON public.insurance_policies FOR ALL USING (tes_security.system_context_authorized(ARRAY['INSURANCE_READ','INSURANCE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['INSURANCE_MANAGE']));
CREATE POLICY insurance_policies_customer ON public.insurance_policies FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY insurance_policy_terms_system ON public.insurance_policy_terms FOR ALL USING (tes_security.system_context_authorized(ARRAY['INSURANCE_READ','INSURANCE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['INSURANCE_MANAGE']));
CREATE POLICY insurance_policy_terms_customer ON public.insurance_policy_terms FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY insurance_endorsements_system ON public.insurance_endorsements FOR ALL USING (tes_security.system_context_authorized(ARRAY['INSURANCE_READ','INSURANCE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['INSURANCE_MANAGE']));
CREATE POLICY insurance_endorsements_customer ON public.insurance_endorsements FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY insurance_coverages_system ON public.insurance_coverages FOR ALL USING (tes_security.system_context_authorized(ARRAY['INSURANCE_READ','INSURANCE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['INSURANCE_MANAGE']));
CREATE POLICY insurance_coverages_customer ON public.insurance_coverages FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY insurance_broker_periods_system ON public.insurance_broker_periods FOR ALL USING (tes_security.system_context_authorized(ARRAY['INSURANCE_READ','INSURANCE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['INSURANCE_MANAGE']));
CREATE POLICY insurance_broker_periods_customer ON public.insurance_broker_periods FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));

-- Credentials are SYSTEM-only. Customer portal has no credential access.
ALTER TABLE public.credential_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_system_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_status_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_secret_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY credential_systems_system ON public.credential_systems FOR ALL USING (tes_security.system_context_authorized(ARRAY['CREDENTIAL_READ','CREDENTIAL_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CREDENTIAL_MANAGE']));
CREATE POLICY credential_system_aliases_system ON public.credential_system_aliases FOR ALL USING (tes_security.system_context_authorized(ARRAY['CREDENTIAL_READ','CREDENTIAL_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CREDENTIAL_MANAGE']));
CREATE POLICY company_credentials_system ON public.company_credentials FOR ALL USING (tes_security.system_context_authorized(ARRAY['CREDENTIAL_READ','CREDENTIAL_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CREDENTIAL_MANAGE']));
CREATE POLICY credential_status_periods_system ON public.credential_status_periods FOR ALL USING (tes_security.system_context_authorized(ARRAY['CREDENTIAL_READ','CREDENTIAL_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CREDENTIAL_MANAGE']));
CREATE POLICY credential_verifications_system ON public.credential_verifications FOR ALL USING (tes_security.system_context_authorized(ARRAY['CREDENTIAL_READ','CREDENTIAL_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CREDENTIAL_MANAGE']));
CREATE POLICY credential_secret_slots_system ON public.credential_secret_slots FOR ALL USING (tes_security.system_context_authorized(ARRAY['CREDENTIAL_READ','CREDENTIAL_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['CREDENTIAL_MANAGE']));

-- Company operating profile.
CREATE POLICY company_operating_scope_periods_system ON public.company_operating_scope_periods FOR ALL USING (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_READ','COMPANY_PROFILE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_MANAGE']));
CREATE POLICY company_operating_scope_periods_customer ON public.company_operating_scope_periods FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY company_rule_applicability_periods_system ON public.company_rule_applicability_periods FOR ALL USING (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_READ','COMPANY_PROFILE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_MANAGE']));
CREATE POLICY company_rule_applicability_periods_customer ON public.company_rule_applicability_periods FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY company_driver_requirement_periods_system ON public.company_driver_requirement_periods FOR ALL USING (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_READ','COMPANY_PROFILE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['COMPANY_PROFILE_MANAGE']));
CREATE POLICY company_driver_requirement_periods_customer ON public.company_driver_requirement_periods FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));

-- Vehicles.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_system ON public.vehicles FOR ALL USING (tes_security.system_context_authorized(ARRAY['VEHICLE_READ','VEHICLE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['VEHICLE_MANAGE']));
CREATE POLICY vehicles_customer ON public.vehicles FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.organization_vehicle_relationships r WHERE r.vehicle_id=vehicles.id AND r.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id())));
CREATE POLICY organization_vehicle_relationships_system ON public.organization_vehicle_relationships FOR ALL USING (tes_security.system_context_authorized(ARRAY['VEHICLE_READ','VEHICLE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['VEHICLE_MANAGE']));
CREATE POLICY organization_vehicle_relationships_customer ON public.organization_vehicle_relationships FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY vehicle_registration_periods_system ON public.vehicle_registration_periods FOR ALL USING (tes_security.system_context_authorized(ARRAY['VEHICLE_READ','VEHICLE_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['VEHICLE_MANAGE']));
CREATE POLICY vehicle_registration_periods_customer ON public.vehicle_registration_periods FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));

-- Drivers.
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_medical_qualification_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_profiles_system ON public.driver_profiles FOR ALL USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ','DRIVER_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY driver_profiles_customer ON public.driver_profiles FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.organization_driver_relationships r WHERE r.person_id=driver_profiles.person_id AND r.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id())));
CREATE POLICY driver_licences_system ON public.driver_licences FOR ALL USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ','DRIVER_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY driver_licences_customer ON public.driver_licences FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.organization_driver_relationships r WHERE r.person_id=driver_licences.person_id AND r.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id())));
CREATE POLICY organization_driver_relationships_system ON public.organization_driver_relationships FOR ALL USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ','DRIVER_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY organization_driver_relationships_customer ON public.organization_driver_relationships FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id()));
CREATE POLICY driver_medical_qualification_periods_system ON public.driver_medical_qualification_periods FOR ALL USING (tes_security.system_context_authorized(ARRAY['DRIVER_READ','DRIVER_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['DRIVER_MANAGE']));
CREATE POLICY driver_medical_qualification_periods_customer ON public.driver_medical_qualification_periods FOR SELECT USING (tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) AND EXISTS (SELECT 1 FROM public.organization_driver_relationships r WHERE r.person_id=driver_medical_qualification_periods.person_id AND r.organization_id=(SELECT organization_id FROM public.customers WHERE id=tes_security.current_customer_id())));

-- Entity resolution provenance is SYSTEM-only.
ALTER TABLE public.entity_resolution_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_resolution_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_resolution_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY entity_resolution_cases_system ON public.entity_resolution_cases FOR ALL USING (tes_security.system_context_authorized(ARRAY['IDENTITY_RESOLUTION_READ','IDENTITY_RESOLUTION_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['IDENTITY_RESOLUTION_MANAGE']));
CREATE POLICY entity_resolution_signals_system ON public.entity_resolution_signals FOR ALL USING (tes_security.system_context_authorized(ARRAY['IDENTITY_RESOLUTION_READ','IDENTITY_RESOLUTION_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['IDENTITY_RESOLUTION_MANAGE']));
CREATE POLICY entity_resolution_candidates_system ON public.entity_resolution_candidates FOR ALL USING (tes_security.system_context_authorized(ARRAY['IDENTITY_RESOLUTION_READ','IDENTITY_RESOLUTION_MANAGE'])) WITH CHECK (tes_security.system_context_authorized(ARRAY['IDENTITY_RESOLUTION_MANAGE']));

-- Master Register: every authorized operation may append; only explicit MASTER_REGISTER_READ may enumerate.
ALTER TABLE public.master_register_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY master_register_system_insert ON public.master_register_events FOR INSERT WITH CHECK (tes_security.system_context_authorized(NULL));
CREATE POLICY master_register_customer_insert ON public.master_register_events FOR INSERT WITH CHECK (tes_security.customer_context_authorized(NULL) AND customer_id=tes_security.current_customer_id());
CREATE POLICY master_register_system_read ON public.master_register_events FOR SELECT USING (tes_security.system_context_authorized(ARRAY['MASTER_REGISTER_READ']));

-- Runtime must never own tables or bypass RLS.
DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tes-backend@tes-production-510007.iam' AND rolbypassrls) THEN
   RAISE EXCEPTION 'TES backend runtime role must not have BYPASSRLS';
 END IF;
 IF EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_roles r ON r.oid=c.relowner
   WHERE n.nspname='public' AND c.relkind='r' AND r.rolname='tes-backend@tes-production-510007.iam'
 ) THEN RAISE EXCEPTION 'TES backend runtime role must not own public tables'; END IF;
END $guard$;
