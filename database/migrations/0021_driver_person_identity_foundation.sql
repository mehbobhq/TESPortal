-- TES Core Operational Identity Graph: Driver/Person foundation
-- Migration: 0021
-- Person remains the canonical human identity from 0014. Driver is an operational role/profile of that Person.

CREATE TABLE public.driver_profiles (
  person_id uuid PRIMARY KEY REFERENCES public.persons(id) ON DELETE RESTRICT,
  record_status text NOT NULL DEFAULT 'active',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (record_status IN ('active','archived')),
  CHECK ((record_status='archived' AND archived_at IS NOT NULL) OR (record_status='active' AND archived_at IS NULL))
);

CREATE TABLE public.driver_licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.driver_profiles(person_id) ON DELETE RESTRICT,
  jurisdiction_country text NOT NULL,
  jurisdiction_region text NOT NULL,
  licence_number_display text NOT NULL,
  licence_number_normalized text NOT NULL,
  licence_class text,
  issue_date date,
  expiry_date date,
  effective_from date NOT NULL,
  effective_to date,
  record_status text NOT NULL DEFAULT 'active',
  corrected_at timestamptz,
  superseded_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(jurisdiction_country)<>'' AND btrim(jurisdiction_region)<>''),
  CHECK (btrim(licence_number_display)<>'' AND btrim(licence_number_normalized)<>''),
  CHECK (licence_class IS NULL OR btrim(licence_class)<>''),
  CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date>=issue_date),
  CHECK (effective_to IS NULL OR effective_to>effective_from),
  CHECK (record_status IN ('active','corrected','voided')),
  CHECK ((record_status='active' AND corrected_at IS NULL AND superseded_by_id IS NULL) OR
         (record_status='corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL) OR
         (record_status='voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)),
  CHECK (superseded_by_id IS NULL OR superseded_by_id<>id),
  UNIQUE(id,person_id),
  FOREIGN KEY(superseded_by_id,person_id) REFERENCES public.driver_licences(id,person_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX driver_licences_current_identity_uq
 ON public.driver_licences(jurisdiction_country,jurisdiction_region,licence_number_normalized)
 WHERE record_status='active' AND effective_to IS NULL;
CREATE UNIQUE INDEX driver_licences_person_current_jurisdiction_uq
 ON public.driver_licences(person_id,jurisdiction_country,jurisdiction_region)
 WHERE record_status='active' AND effective_to IS NULL;
CREATE INDEX driver_licences_person_history_idx ON public.driver_licences(person_id,effective_from);

CREATE TABLE public.organization_driver_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES public.driver_profiles(person_id) ON DELETE RESTRICT,
  relationship_type text NOT NULL,
  driver_number_display text,
  driver_number_normalized text,
  status text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  record_status text NOT NULL DEFAULT 'active',
  corrected_at timestamptz,
  superseded_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (relationship_type IN ('EMPLOYEE','CONTRACTOR','OWNER_OPERATOR')),
  CHECK (status IN ('ONBOARDING','ACTIVE','SUSPENDED','ENDED')),
  CHECK (driver_number_display IS NULL OR btrim(driver_number_display)<>''),
  CHECK (driver_number_normalized IS NULL OR btrim(driver_number_normalized)<>''),
  CHECK (effective_to IS NULL OR effective_to>effective_from),
  CHECK ((status='ENDED' AND effective_to IS NOT NULL) OR status<>'ENDED'),
  CHECK (record_status IN ('active','corrected','voided')),
  CHECK ((record_status='active' AND corrected_at IS NULL AND superseded_by_id IS NULL) OR
         (record_status='corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL) OR
         (record_status='voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)),
  CHECK (superseded_by_id IS NULL OR superseded_by_id<>id),
  UNIQUE(id,organization_id,person_id),
  FOREIGN KEY(superseded_by_id,organization_id,person_id)
    REFERENCES public.organization_driver_relationships(id,organization_id,person_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX organization_driver_current_uq
 ON public.organization_driver_relationships(organization_id,person_id)
 WHERE record_status='active' AND effective_to IS NULL;
CREATE UNIQUE INDEX organization_driver_current_number_uq
 ON public.organization_driver_relationships(organization_id,driver_number_normalized)
 WHERE driver_number_normalized IS NOT NULL AND record_status='active' AND effective_to IS NULL;
CREATE INDEX organization_driver_person_history_idx ON public.organization_driver_relationships(person_id,effective_from);

CREATE TABLE public.driver_medical_qualification_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.driver_profiles(person_id) ON DELETE RESTRICT,
  jurisdiction_country text NOT NULL,
  jurisdiction_region text,
  qualification_type text NOT NULL,
  issued_on date,
  expires_on date,
  effective_from date NOT NULL,
  effective_to date,
  record_status text NOT NULL DEFAULT 'active',
  corrected_at timestamptz,
  superseded_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(jurisdiction_country)<>''),
  CHECK (qualification_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on>=issued_on),
  CHECK (effective_to IS NULL OR effective_to>effective_from),
  CHECK (record_status IN ('active','corrected','voided')),
  CHECK ((record_status='active' AND corrected_at IS NULL AND superseded_by_id IS NULL) OR
         (record_status='corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL) OR
         (record_status='voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)),
  CHECK (superseded_by_id IS NULL OR superseded_by_id<>id),
  UNIQUE(id,person_id),
  FOREIGN KEY(superseded_by_id,person_id)
    REFERENCES public.driver_medical_qualification_periods(id,person_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX driver_medical_current_uq
 ON public.driver_medical_qualification_periods(person_id,qualification_type,jurisdiction_country,COALESCE(jurisdiction_region,''))
 WHERE record_status='active' AND effective_to IS NULL;

CREATE OR REPLACE FUNCTION tes_security.guard_driver_operational_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE ps text; os text;
BEGIN
 SELECT record_status INTO ps FROM public.driver_profiles WHERE person_id=NEW.person_id FOR UPDATE;
 IF ps IS NULL THEN RAISE EXCEPTION 'Driver profile does not exist' USING ERRCODE='23503'; END IF;
 IF ps<>'active' THEN RAISE EXCEPTION 'Driver profile must be active' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='organization_driver_relationships' THEN
   SELECT status INTO os FROM public.organizations WHERE id=NEW.organization_id FOR UPDATE;
   IF os IS NULL THEN RAISE EXCEPTION 'Organization does not exist' USING ERRCODE='23503'; END IF;
   IF os<>'active' THEN RAISE EXCEPTION 'Organization must be active' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tes_security.guard_driver_history_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.record_status<>'active' THEN RAISE EXCEPTION 'Historical/corrected row is frozen' USING ERRCODE='23514'; END IF;
 IF NEW.id<>OLD.id OR NEW.person_id<>OLD.person_id OR NEW.effective_from<>OLD.effective_from
    OR (TG_TABLE_NAME='organization_driver_relationships' AND (to_jsonb(NEW)->>'organization_id') IS DISTINCT FROM (to_jsonb(OLD)->>'organization_id')) THEN
   RAISE EXCEPTION 'Identity/business start is immutable; correct by supersession' USING ERRCODE='23514';
 END IF;
 IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
   RAISE EXCEPTION 'Ended row is frozen' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tes_security.prevent_driver_identity_removal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'TES canonical driver identity/history is append-preserving' USING ERRCODE='23514'; END $$;

CREATE TRIGGER driver_licences_insert_guard BEFORE INSERT ON public.driver_licences FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_operational_insert();
CREATE TRIGGER organization_driver_relationships_insert_guard BEFORE INSERT ON public.organization_driver_relationships FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_operational_insert();
CREATE TRIGGER driver_medical_qualification_periods_insert_guard BEFORE INSERT ON public.driver_medical_qualification_periods FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_operational_insert();
CREATE TRIGGER driver_licences_update_guard BEFORE UPDATE ON public.driver_licences FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_history_update();
CREATE TRIGGER organization_driver_relationships_update_guard BEFORE UPDATE ON public.organization_driver_relationships FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_history_update();
CREATE TRIGGER driver_medical_qualification_periods_update_guard BEFORE UPDATE ON public.driver_medical_qualification_periods FOR EACH ROW EXECUTE FUNCTION tes_security.guard_driver_history_update();
CREATE TRIGGER driver_profiles_no_delete BEFORE DELETE OR TRUNCATE ON public.driver_profiles FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_identity_removal();
CREATE TRIGGER driver_licences_no_delete BEFORE DELETE OR TRUNCATE ON public.driver_licences FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_identity_removal();
CREATE TRIGGER organization_driver_relationships_no_delete BEFORE DELETE OR TRUNCATE ON public.organization_driver_relationships FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_identity_removal();
CREATE TRIGGER driver_medical_qualification_periods_no_delete BEFORE DELETE OR TRUNCATE ON public.driver_medical_qualification_periods FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_driver_identity_removal();

REVOKE ALL ON FUNCTION tes_security.guard_driver_operational_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_driver_history_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.prevent_driver_identity_removal() FROM PUBLIC;

INSERT INTO public.capabilities(code,display_name,description,is_active,sort_order) VALUES
 ('DRIVER_READ','Driver read','Read canonical Driver operational identity. Intended scope: SYSTEM.',true,202),
 ('DRIVER_MANAGE','Driver manage','Manage canonical Driver role, licence and Organization relationships. Intended scope: SYSTEM.',true,203);

REVOKE ALL ON public.driver_profiles,public.driver_licences,public.organization_driver_relationships,public.driver_medical_qualification_periods FROM PUBLIC;
GRANT SELECT ON public.driver_profiles,public.driver_licences,public.organization_driver_relationships,public.driver_medical_qualification_periods TO tes_app_runtime;
GRANT INSERT(person_id) ON public.driver_profiles TO tes_app_runtime;
GRANT UPDATE(record_status,archived_at,updated_at) ON public.driver_profiles TO tes_app_runtime;
GRANT INSERT(id,person_id,jurisdiction_country,jurisdiction_region,licence_number_display,licence_number_normalized,licence_class,issue_date,expiry_date,effective_from,effective_to) ON public.driver_licences TO tes_app_runtime;
GRANT UPDATE(effective_to,record_status,corrected_at,superseded_by_id,updated_at) ON public.driver_licences TO tes_app_runtime;
GRANT INSERT(id,organization_id,person_id,relationship_type,driver_number_display,driver_number_normalized,status,effective_from,effective_to) ON public.organization_driver_relationships TO tes_app_runtime;
GRANT UPDATE(status,effective_to,record_status,corrected_at,superseded_by_id,updated_at) ON public.organization_driver_relationships TO tes_app_runtime;
GRANT INSERT(id,person_id,jurisdiction_country,jurisdiction_region,qualification_type,issued_on,expires_on,effective_from,effective_to) ON public.driver_medical_qualification_periods TO tes_app_runtime;
GRANT UPDATE(effective_to,record_status,corrected_at,superseded_by_id,updated_at) ON public.driver_medical_qualification_periods TO tes_app_runtime;
