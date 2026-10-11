\set ON_ERROR_STOP on
BEGIN;

-- Owner-side fixture creation. All rows roll back.
INSERT INTO public.organizations(legal_name,normalized_legal_name,status)
VALUES ('RLS Tenant A','rls tenant a','active') RETURNING id \gset oa_
INSERT INTO public.organizations(legal_name,normalized_legal_name,status)
VALUES ('RLS Tenant B','rls tenant b','active') RETURNING id \gset ob_
INSERT INTO public.customers(organization_id) VALUES (:'oa_id') RETURNING id \gset ca_
INSERT INTO public.customers(organization_id) VALUES (:'ob_id') RETURNING id \gset cb_

INSERT INTO public.actors(actor_type,status) VALUES ('HUMAN','active') RETURNING id \gset actor_
INSERT INTO public.actor_relationships(actor_id,relationship_type,status)
VALUES (:'actor_id','TES_STAFF','active') RETURNING id \gset rel_
INSERT INTO public.relationship_assignments(relationship_id,scope_type,customer_id,status)
VALUES (:'rel_id','CUSTOMER',:'ca_id','active') RETURNING id \gset cra_
INSERT INTO public.relationship_assignments(relationship_id,scope_type,status)
VALUES (:'rel_id','SYSTEM','active') RETURNING id \gset sra_
INSERT INTO public.relationship_capability_grants(relationship_id,capability_id,assignment_id,status)
SELECT :'rel_id',id,:'cra_id','active' FROM public.capabilities WHERE code='ORGANIZATION_READ';
INSERT INTO public.relationship_capability_grants(relationship_id,capability_id,assignment_id,status)
SELECT :'rel_id',id,:'sra_id','active' FROM public.capabilities WHERE code='VEHICLE_READ';

INSERT INTO public.registrations(organization_id,program_code) VALUES (:'oa_id','IFTA') RETURNING id \gset rega_
INSERT INTO public.registrations(organization_id,program_code) VALUES (:'ob_id','IFTA') RETURNING id \gset regb_

INSERT INTO public.vehicles(vehicle_type_code,vin_display,vin_normalized) VALUES ('TRUCK_TRACTOR','1M8GDM9AXKP042788','1M8GDM9AXKP042788') RETURNING id \gset va_
INSERT INTO public.vehicles(vehicle_type_code,vin_display,vin_normalized) VALUES ('TRUCK_TRACTOR','1M8GDM9AXKP042789','1M8GDM9AXKP042789') RETURNING id \gset vb_
INSERT INTO public.organization_vehicle_relationships(organization_id,vehicle_id,relationship_type,unit_number_display,unit_number_normalized,effective_from)
VALUES (:'oa_id',:'va_id','OPERATES','A-1','A1',now()-interval '2 years');
INSERT INTO public.organization_vehicle_relationships(organization_id,vehicle_id,relationship_type,unit_number_display,unit_number_normalized,effective_from)
VALUES (:'ob_id',:'vb_id','OPERATES','B-1','B1',now()-interval '2 years');

INSERT INTO public.persons DEFAULT VALUES RETURNING id \gset pa_
INSERT INTO public.person_name_versions(person_id,given_name,family_name,name_normalized,change_reason,effective_from)
VALUES (:'pa_id','Alice','TenantA','alice tenanta','RLS_TEST',now()-interval '2 years');
INSERT INTO public.driver_profiles(person_id) VALUES (:'pa_id');
INSERT INTO public.organization_driver_relationships(organization_id,person_id,relationship_type,status,effective_from)
VALUES (:'oa_id',:'pa_id','EMPLOYEE','ACTIVE',current_date-700);

INSERT INTO public.persons DEFAULT VALUES RETURNING id \gset pb_
INSERT INTO public.person_name_versions(person_id,given_name,family_name,name_normalized,change_reason,effective_from)
VALUES (:'pb_id','Bob','TenantB','bob tenantb','RLS_TEST',now()-interval '2 years');
INSERT INTO public.driver_profiles(person_id) VALUES (:'pb_id');
INSERT INTO public.organization_driver_relationships(organization_id,person_id,relationship_type,status,effective_from)
VALUES (:'ob_id',:'pb_id','EMPLOYEE','ACTIVE',current_date-700);

INSERT INTO public.credential_systems(display_name,display_name_normalized,record_status)
VALUES ('RLS Secret Portal','rls secret portal','active') RETURNING id \gset cs_
INSERT INTO public.entity_resolution_cases(entity_type,source_system,source_record_key)
VALUES ('ORGANIZATION','rls-test','secret-case') RETURNING id \gset er_

SET LOCAL ROLE "tes-backend@tes-production-510007.iam";

-- No context: business/sensitive registries fail closed.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.organizations WHERE legal_name IN ('RLS Tenant A','RLS Tenant B')) THEN RAISE EXCEPTION 'organization visible without context'; END IF;
 IF EXISTS(SELECT 1 FROM public.vehicles WHERE id IN (:'va_id'::uuid,:'vb_id'::uuid)) THEN RAISE EXCEPTION 'vehicle visible without context'; END IF;
 IF EXISTS(SELECT 1 FROM public.credential_systems WHERE id=:'cs_id'::uuid) THEN RAISE EXCEPTION 'credential registry visible without context'; END IF;
END $$;

-- Forging only a tenant id is insufficient: business policies also require a proven actor/capability path.
SELECT set_config('tes.customer_id',:'cb_id',true);
SELECT set_config('tes.customer_actor_id',:'actor_id',true);
SELECT set_config('tes.customer_capability','ORGANIZATION_READ',true);
DO $$
BEGIN
 IF tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) THEN RAISE EXCEPTION 'actor forged access to unassigned tenant B'; END IF;
 IF EXISTS(SELECT 1 FROM public.registrations WHERE organization_id=:'ob_id'::uuid) THEN RAISE EXCEPTION 'cross-tenant registration leaked'; END IF;
END $$;

-- Authorized tenant A sees its complete graph, never tenant B, and never SYSTEM-only registries.
SELECT set_config('tes.customer_id',:'ca_id',true);
DO $$
BEGIN
 IF NOT tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ']) THEN RAISE EXCEPTION 'authorized customer context rejected'; END IF;
 IF (SELECT count(*) FROM public.organizations WHERE id IN (:'oa_id'::uuid,:'ob_id'::uuid))<>1 THEN RAISE EXCEPTION 'organization isolation failed'; END IF;
 IF (SELECT count(*) FROM public.registrations WHERE id IN (:'rega_id'::uuid,:'regb_id'::uuid))<>1 THEN RAISE EXCEPTION 'registration isolation failed'; END IF;
 IF (SELECT count(*) FROM public.vehicles WHERE id IN (:'va_id'::uuid,:'vb_id'::uuid))<>1 THEN RAISE EXCEPTION 'vehicle isolation failed'; END IF;
 IF (SELECT count(*) FROM public.persons WHERE id IN (:'pa_id'::uuid,:'pb_id'::uuid))<>1 THEN RAISE EXCEPTION 'person/driver isolation failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.credential_systems WHERE id=:'cs_id'::uuid) THEN RAISE EXCEPTION 'customer saw credentials'; END IF;
 IF EXISTS(SELECT 1 FROM public.entity_resolution_cases WHERE id=:'er_id'::uuid) THEN RAISE EXCEPTION 'customer saw entity resolution provenance'; END IF;
END $$;

-- Historical graph remains visible to the owning customer after relationship end.
RESET ROLE;
UPDATE public.organization_vehicle_relationships SET effective_to=now()-interval '1 day' WHERE vehicle_id=:'va_id';
SET LOCAL ROLE "tes-backend@tes-production-510007.iam";
SELECT set_config('tes.customer_id',:'ca_id',true);
SELECT set_config('tes.customer_actor_id',:'actor_id',true);
SELECT set_config('tes.customer_capability','ORGANIZATION_READ',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=:'va_id'::uuid) THEN RAISE EXCEPTION 'historical owned vehicle disappeared'; END IF;
END $$;

-- SYSTEM access is capability-bound, not a universal bypass.
SELECT set_config('tes.customer_id','',true);
SELECT set_config('tes.customer_actor_id','',true);
SELECT set_config('tes.customer_capability','',true);
SELECT set_config('tes.system_actor_id',:'actor_id',true);
SELECT set_config('tes.system_capability','VEHICLE_READ',true);
DO $$ BEGIN
 IF NOT tes_security.system_context_authorized(ARRAY['VEHICLE_READ']) THEN RAISE EXCEPTION 'valid system context rejected'; END IF;
 IF (SELECT count(*) FROM public.vehicles WHERE id IN (:'va_id'::uuid,:'vb_id'::uuid))<>2 THEN RAISE EXCEPTION 'system vehicle read failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.credential_systems WHERE id=:'cs_id'::uuid) THEN RAISE EXCEPTION 'VEHICLE_READ bypassed credential boundary'; END IF;
END $$;
SELECT set_config('tes.system_capability','CREDENTIAL_READ',true);
DO $$ BEGIN
 IF tes_security.system_context_authorized(ARRAY['CREDENTIAL_READ']) THEN RAISE EXCEPTION 'ungranted system capability accepted'; END IF;
 IF EXISTS(SELECT 1 FROM public.credential_systems WHERE id=:'cs_id'::uuid) THEN RAISE EXCEPTION 'ungranted credential capability leaked'; END IF;
END $$;

RESET ROLE;
ROLLBACK;
\echo 'System-wide authorization + RLS adversarial matrix passed.'
