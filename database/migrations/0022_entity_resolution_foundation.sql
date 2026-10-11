-- TES Core Operational Identity Graph: entity resolution and provenance
-- Migration: 0022
-- Resolution cases are durable intake/import decisions; deterministic keys provide idempotency without silently merging ambiguity.

CREATE TABLE public.entity_resolution_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  source_system text NOT NULL,
  source_record_key text NOT NULL,
  organization_context_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  resolution_state text NOT NULL DEFAULT 'PENDING',
  outcome text,
  resolved_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  resolved_person_id uuid REFERENCES public.persons(id) ON DELETE RESTRICT,
  resolved_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  resolution_method text,
  confidence_basis text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (entity_type IN ('ORGANIZATION','PERSON','VEHICLE')),
  CHECK (btrim(source_system)<>'' AND btrim(source_record_key)<>''),
  CHECK (resolution_state IN ('PENDING','REVIEW_REQUIRED','RESOLVED','REJECTED','INVALIDATED')),
  CHECK (outcome IS NULL OR outcome IN ('EXACT_IDENTITY_MATCH','STRONG_PROBABLE_MATCH','AMBIGUOUS_MATCH','NEW_ENTITY','CONFLICT')),
  CHECK (resolution_method IS NULL OR btrim(resolution_method)<>''),
  CHECK (confidence_basis IS NULL OR btrim(confidence_basis)<>''),
  CHECK (
    (resolution_state='RESOLVED' AND outcome IS NOT NULL AND resolved_at IS NOT NULL AND
      ((entity_type='ORGANIZATION' AND resolved_organization_id IS NOT NULL AND resolved_person_id IS NULL AND resolved_vehicle_id IS NULL) OR
       (entity_type='PERSON' AND resolved_person_id IS NOT NULL AND resolved_organization_id IS NULL AND resolved_vehicle_id IS NULL) OR
       (entity_type='VEHICLE' AND resolved_vehicle_id IS NOT NULL AND resolved_organization_id IS NULL AND resolved_person_id IS NULL)))
    OR
    (resolution_state<>'RESOLVED' AND resolved_organization_id IS NULL AND resolved_person_id IS NULL AND resolved_vehicle_id IS NULL AND resolved_at IS NULL)
  ),
  UNIQUE(source_system,source_record_key,entity_type)
);
CREATE INDEX entity_resolution_state_idx ON public.entity_resolution_cases(resolution_state,entity_type);
CREATE INDEX entity_resolution_org_context_idx ON public.entity_resolution_cases(organization_context_id) WHERE organization_context_id IS NOT NULL;

CREATE TABLE public.entity_resolution_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_case_id uuid NOT NULL REFERENCES public.entity_resolution_cases(id) ON DELETE RESTRICT,
  signal_type text NOT NULL,
  signal_hash text,
  signal_reference text,
  strength text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (signal_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CHECK ((signal_hash IS NOT NULL)::int + (signal_reference IS NOT NULL)::int = 1),
  CHECK (signal_hash IS NULL OR signal_hash ~ '^[0-9a-f]{64}$'),
  CHECK (signal_reference IS NULL OR btrim(signal_reference)<>''),
  CHECK (strength IN ('DETERMINISTIC','STRONG','SUPPORTING','CONFLICTING'))
);
CREATE UNIQUE INDEX entity_resolution_signals_identity_uq
 ON public.entity_resolution_signals(resolution_case_id,signal_type,COALESCE(signal_hash,signal_reference));

CREATE TABLE public.entity_resolution_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_case_id uuid NOT NULL REFERENCES public.entity_resolution_cases(id) ON DELETE RESTRICT,
  candidate_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  candidate_person_id uuid REFERENCES public.persons(id) ON DELETE RESTRICT,
  candidate_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  match_class text NOT NULL,
  basis text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (((candidate_organization_id IS NOT NULL)::int + (candidate_person_id IS NOT NULL)::int + (candidate_vehicle_id IS NOT NULL)::int)=1),
  CHECK (match_class IN ('EXACT_IDENTITY_MATCH','STRONG_PROBABLE_MATCH','AMBIGUOUS_MATCH','CONFLICT')),
  CHECK (btrim(basis)<>'')
);
CREATE UNIQUE INDEX entity_resolution_candidate_org_uq ON public.entity_resolution_candidates(resolution_case_id,candidate_organization_id) WHERE candidate_organization_id IS NOT NULL;
CREATE UNIQUE INDEX entity_resolution_candidate_person_uq ON public.entity_resolution_candidates(resolution_case_id,candidate_person_id) WHERE candidate_person_id IS NOT NULL;
CREATE UNIQUE INDEX entity_resolution_candidate_vehicle_uq ON public.entity_resolution_candidates(resolution_case_id,candidate_vehicle_id) WHERE candidate_vehicle_id IS NOT NULL;

CREATE OR REPLACE FUNCTION tes_security.guard_entity_resolution_case_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.resolution_state IN ('RESOLVED','REJECTED','INVALIDATED') THEN
   RAISE EXCEPTION 'Final entity-resolution cases are immutable; create a new case to correct provenance' USING ERRCODE='23514';
 END IF;
 IF NEW.id<>OLD.id OR NEW.entity_type<>OLD.entity_type OR NEW.source_system<>OLD.source_system OR NEW.source_record_key<>OLD.source_record_key OR NEW.organization_context_id IS DISTINCT FROM OLD.organization_context_id THEN
   RAISE EXCEPTION 'Entity-resolution source identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tes_security.prevent_entity_resolution_removal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'TES entity-resolution provenance is append-preserving' USING ERRCODE='23514'; END $$;

CREATE TRIGGER entity_resolution_cases_update_guard BEFORE UPDATE ON public.entity_resolution_cases FOR EACH ROW EXECUTE FUNCTION tes_security.guard_entity_resolution_case_update();
CREATE TRIGGER entity_resolution_cases_no_delete BEFORE DELETE OR TRUNCATE ON public.entity_resolution_cases FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_entity_resolution_removal();
CREATE TRIGGER entity_resolution_signals_no_delete BEFORE DELETE OR TRUNCATE ON public.entity_resolution_signals FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_entity_resolution_removal();
CREATE TRIGGER entity_resolution_candidates_no_delete BEFORE DELETE OR TRUNCATE ON public.entity_resolution_candidates FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_entity_resolution_removal();

REVOKE ALL ON FUNCTION tes_security.guard_entity_resolution_case_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.prevent_entity_resolution_removal() FROM PUBLIC;

INSERT INTO public.capabilities(code,display_name,description,is_active,sort_order) VALUES
 ('IDENTITY_RESOLUTION_READ','Identity resolution read','Read identity-resolution cases and provenance. Intended scope: SYSTEM.',true,204),
 ('IDENTITY_RESOLUTION_MANAGE','Identity resolution manage','Manage identity-resolution cases and provenance. Intended scope: SYSTEM.',true,205);

REVOKE ALL ON public.entity_resolution_cases,public.entity_resolution_signals,public.entity_resolution_candidates FROM PUBLIC;
GRANT SELECT ON public.entity_resolution_cases,public.entity_resolution_signals,public.entity_resolution_candidates TO tes_app_runtime;
GRANT INSERT(id,entity_type,source_system,source_record_key,organization_context_id,resolution_state,outcome,resolved_organization_id,resolved_person_id,resolved_vehicle_id,resolution_method,confidence_basis,resolved_at)
 ON public.entity_resolution_cases TO tes_app_runtime;
GRANT UPDATE(resolution_state,outcome,resolved_organization_id,resolved_person_id,resolved_vehicle_id,resolution_method,confidence_basis,resolved_at,updated_at)
 ON public.entity_resolution_cases TO tes_app_runtime;
GRANT INSERT(id,resolution_case_id,signal_type,signal_hash,signal_reference,strength) ON public.entity_resolution_signals TO tes_app_runtime;
GRANT INSERT(id,resolution_case_id,candidate_organization_id,candidate_person_id,candidate_vehicle_id,match_class,basis) ON public.entity_resolution_candidates TO tes_app_runtime;
