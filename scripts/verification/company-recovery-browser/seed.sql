DO $$
DECLARE
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.actors (id, actor_type, status) VALUES (a1,'HUMAN','active'),(a2,'HUMAN','active');
  INSERT INTO public.authentication_identities (actor_id, provider, provider_subject) VALUES (a1,'clerk','user_e2e_staff'),(a2,'clerk','user_e2e_limited');
  INSERT INTO public.actor_relationships (id, actor_id, relationship_type, status, starts_at) VALUES (r1,a1,'TES_STAFF','active',now()-interval '1 day'),(r2,a2,'TES_STAFF','active',now()-interval '1 day');
  INSERT INTO public.relationship_assignments (id, relationship_id, scope_type, status, starts_at) VALUES (s1,r1,'SYSTEM','active',now()-interval '1 day'),(s2,r2,'SYSTEM','active',now()-interval '1 day');
  INSERT INTO public.relationship_capability_grants (relationship_id, capability_id, assignment_id, status, granted_at)
    SELECT r1, c.id, s1, 'active', now()-interval '1 day' FROM public.capabilities c WHERE c.is_active;
  INSERT INTO public.relationship_capability_grants (relationship_id, capability_id, assignment_id, status, granted_at)
    SELECT r2, c.id, s2, 'active', now()-interval '1 day' FROM public.capabilities c WHERE c.code IN ('ORGANIZATION_CREATE','ORGANIZATION_REGISTRY_READ');
END $$;
-- A third staff actor with NO capability grants (denial checks: pages and APIs must refuse, never show data).
DO $$
DECLARE a3 uuid := gen_random_uuid(); r3 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.actors (id, actor_type, status) VALUES (a3,'HUMAN','active');
  INSERT INTO public.authentication_identities (actor_id, provider, provider_subject) VALUES (a3,'clerk','user_e2e_none');
  INSERT INTO public.actor_relationships (id, actor_id, relationship_type, status, starts_at) VALUES (r3,a3,'TES_STAFF','active',now()-interval '1 day');
  INSERT INTO public.relationship_assignments (id, relationship_id, scope_type, status, starts_at) VALUES (s3,r3,'SYSTEM','active',now()-interval '1 day');
END $$;
SELECT count(*) AS full_staff_grants FROM public.relationship_capability_grants;
