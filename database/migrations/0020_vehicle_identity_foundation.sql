-- TES Core Operational Identity Graph: Vehicle foundation
-- Migration: 0020
-- Canonical physical vehicle identity is global; organization relationships and registration facts are effective-dated.
-- Documents/evidence remain outside PostgreSQL. No RLS is added here because SYSTEM scope has no tenant context.

CREATE TABLE public.vehicle_types (
  code text PRIMARY KEY,
  display_name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL UNIQUE,
  CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  CHECK (btrim(display_name) <> '')
);
INSERT INTO public.vehicle_types(code,display_name,sort_order) VALUES
 ('TRUCK_TRACTOR','Truck Tractor',10),('STRAIGHT_TRUCK','Straight Truck',20),('TRAILER','Trailer',30),('OTHER','Other',90);

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_type_code text NOT NULL REFERENCES public.vehicle_types(code),
  vin_display text,
  vin_normalized text,
  model_year integer,
  make text,
  model text,
  record_status text NOT NULL DEFAULT 'active',
  merged_into_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vin_display IS NULL OR btrim(vin_display) <> ''),
  CHECK (vin_normalized IS NULL OR vin_normalized ~ '^[A-HJ-NPR-Z0-9]{11,17}$'),
  CHECK (model_year IS NULL OR model_year BETWEEN 1900 AND 2200),
  CHECK (make IS NULL OR btrim(make) <> ''),
  CHECK (model IS NULL OR btrim(model) <> ''),
  CHECK (record_status IN ('active','archived','merged')),
  CHECK (merged_into_vehicle_id IS NULL OR merged_into_vehicle_id <> id),
  CHECK ((record_status='merged' AND merged_into_vehicle_id IS NOT NULL) OR (record_status<>'merged' AND merged_into_vehicle_id IS NULL)),
  CHECK ((record_status='archived' AND archived_at IS NOT NULL) OR (record_status<>'archived' AND archived_at IS NULL))
);
CREATE UNIQUE INDEX vehicles_vin_current_uq ON public.vehicles(vin_normalized)
 WHERE vin_normalized IS NOT NULL AND record_status <> 'merged';
CREATE INDEX vehicles_status_idx ON public.vehicles(record_status);

CREATE TABLE public.organization_vehicle_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  relationship_type text NOT NULL,
  unit_number_display text,
  unit_number_normalized text,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  record_status text NOT NULL DEFAULT 'active',
  corrected_at timestamptz,
  superseded_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (relationship_type IN ('OPERATES','OWNS','LEASES')),
  CHECK (unit_number_display IS NULL OR btrim(unit_number_display) <> ''),
  CHECK (unit_number_normalized IS NULL OR btrim(unit_number_normalized) <> ''),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (record_status IN ('active','corrected','voided')),
  CHECK ((record_status='active' AND corrected_at IS NULL AND superseded_by_id IS NULL) OR
         (record_status='corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL) OR
         (record_status='voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)),
  CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),
  UNIQUE(id,organization_id,vehicle_id),
  FOREIGN KEY(superseded_by_id,organization_id,vehicle_id)
    REFERENCES public.organization_vehicle_relationships(id,organization_id,vehicle_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX organization_vehicle_current_relationship_uq
 ON public.organization_vehicle_relationships(organization_id,vehicle_id,relationship_type)
 WHERE record_status='active' AND effective_to IS NULL;
CREATE UNIQUE INDEX organization_vehicle_current_unit_uq
 ON public.organization_vehicle_relationships(organization_id,unit_number_normalized)
 WHERE relationship_type='OPERATES' AND unit_number_normalized IS NOT NULL AND record_status='active' AND effective_to IS NULL;
CREATE INDEX organization_vehicle_vehicle_history_idx ON public.organization_vehicle_relationships(vehicle_id,effective_from);

CREATE TABLE public.vehicle_registration_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  registration_kind text NOT NULL DEFAULT 'BASE',
  registration_number_display text,
  registration_number_normalized text,
  plate_display text,
  plate_normalized text,
  jurisdiction_country text NOT NULL,
  jurisdiction_region text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  record_status text NOT NULL DEFAULT 'active',
  corrected_at timestamptz,
  superseded_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (registration_kind IN ('BASE','APPORTIONED')),
  CHECK (registration_number_display IS NULL OR btrim(registration_number_display) <> ''),
  CHECK (registration_number_normalized IS NULL OR btrim(registration_number_normalized) <> ''),
  CHECK (plate_display IS NULL OR btrim(plate_display) <> ''),
  CHECK (plate_normalized IS NULL OR btrim(plate_normalized) <> ''),
  CHECK (btrim(jurisdiction_country) <> '' AND btrim(jurisdiction_region) <> ''),
  CHECK (registration_number_normalized IS NOT NULL OR plate_normalized IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (record_status IN ('active','corrected','voided')),
  CHECK ((record_status='active' AND corrected_at IS NULL AND superseded_by_id IS NULL) OR
         (record_status='corrected' AND corrected_at IS NOT NULL AND superseded_by_id IS NOT NULL) OR
         (record_status='voided' AND corrected_at IS NOT NULL AND superseded_by_id IS NULL)),
  CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),
  UNIQUE(id,vehicle_id,organization_id),
  FOREIGN KEY(superseded_by_id,vehicle_id,organization_id)
    REFERENCES public.vehicle_registration_periods(id,vehicle_id,organization_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX vehicle_registration_current_kind_uq
 ON public.vehicle_registration_periods(vehicle_id,organization_id,registration_kind)
 WHERE record_status='active' AND effective_to IS NULL;
CREATE UNIQUE INDEX vehicle_registration_current_plate_uq
 ON public.vehicle_registration_periods(jurisdiction_country,jurisdiction_region,plate_normalized)
 WHERE plate_normalized IS NOT NULL AND record_status='active' AND effective_to IS NULL;
CREATE INDEX vehicle_registration_vehicle_history_idx ON public.vehicle_registration_periods(vehicle_id,effective_from);

CREATE OR REPLACE FUNCTION tes_security.guard_vehicle_operational_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE os text; vs text;
BEGIN
 SELECT status INTO os FROM public.organizations WHERE id=NEW.organization_id FOR UPDATE;
 IF os IS NULL THEN RAISE EXCEPTION 'Organization does not exist' USING ERRCODE='23503'; END IF;
 IF os <> 'active' THEN RAISE EXCEPTION 'Organization must be active' USING ERRCODE='23514'; END IF;
 SELECT record_status INTO vs FROM public.vehicles WHERE id=NEW.vehicle_id FOR UPDATE;
 IF vs IS NULL THEN RAISE EXCEPTION 'Vehicle does not exist' USING ERRCODE='23503'; END IF;
 IF vs <> 'active' THEN RAISE EXCEPTION 'Vehicle must be active' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tes_security.guard_vehicle_history_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.record_status <> 'active' THEN RAISE EXCEPTION 'Historical/corrected row is frozen' USING ERRCODE='23514'; END IF;
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.vehicle_id<>OLD.vehicle_id OR NEW.effective_from<>OLD.effective_from THEN
   RAISE EXCEPTION 'Identity/business start is immutable; correct by supersession' USING ERRCODE='23514';
 END IF;
 IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
   RAISE EXCEPTION 'Ended row is frozen' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tes_security.prevent_vehicle_identity_removal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'TES canonical vehicle identity/history is append-preserving' USING ERRCODE='23514'; END $$;

CREATE TRIGGER organization_vehicle_relationships_insert_guard BEFORE INSERT ON public.organization_vehicle_relationships
 FOR EACH ROW EXECUTE FUNCTION tes_security.guard_vehicle_operational_insert();
CREATE TRIGGER vehicle_registration_periods_insert_guard BEFORE INSERT ON public.vehicle_registration_periods
 FOR EACH ROW EXECUTE FUNCTION tes_security.guard_vehicle_operational_insert();
CREATE TRIGGER organization_vehicle_relationships_update_guard BEFORE UPDATE ON public.organization_vehicle_relationships
 FOR EACH ROW EXECUTE FUNCTION tes_security.guard_vehicle_history_update();
CREATE TRIGGER vehicle_registration_periods_update_guard BEFORE UPDATE ON public.vehicle_registration_periods
 FOR EACH ROW EXECUTE FUNCTION tes_security.guard_vehicle_history_update();
CREATE TRIGGER vehicles_no_delete BEFORE DELETE OR TRUNCATE ON public.vehicles
 FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_vehicle_identity_removal();
CREATE TRIGGER organization_vehicle_relationships_no_delete BEFORE DELETE OR TRUNCATE ON public.organization_vehicle_relationships
 FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_vehicle_identity_removal();
CREATE TRIGGER vehicle_registration_periods_no_delete BEFORE DELETE OR TRUNCATE ON public.vehicle_registration_periods
 FOR EACH STATEMENT EXECUTE FUNCTION tes_security.prevent_vehicle_identity_removal();

REVOKE ALL ON FUNCTION tes_security.guard_vehicle_operational_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.guard_vehicle_history_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION tes_security.prevent_vehicle_identity_removal() FROM PUBLIC;

INSERT INTO public.capabilities(code,display_name,description,is_active,sort_order) VALUES
 ('VEHICLE_READ','Vehicle read','Read the canonical Vehicle registry. Intended scope: SYSTEM.',true,200),
 ('VEHICLE_MANAGE','Vehicle manage','Manage canonical Vehicle identity and Organization relationships. Intended scope: SYSTEM.',true,201);

REVOKE ALL ON public.vehicle_types,public.vehicles,public.organization_vehicle_relationships,public.vehicle_registration_periods FROM PUBLIC;
GRANT SELECT ON public.vehicle_types,public.vehicles,public.organization_vehicle_relationships,public.vehicle_registration_periods TO "tes-backend@tes-production-510007.iam";
GRANT INSERT(id,vehicle_type_code,vin_display,vin_normalized,model_year,make,model) ON public.vehicles TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE(vehicle_type_code,vin_display,vin_normalized,model_year,make,model,record_status,merged_into_vehicle_id,archived_at,updated_at) ON public.vehicles TO "tes-backend@tes-production-510007.iam";
GRANT INSERT(id,organization_id,vehicle_id,relationship_type,unit_number_display,unit_number_normalized,effective_from,effective_to) ON public.organization_vehicle_relationships TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE(effective_to,record_status,corrected_at,superseded_by_id,updated_at) ON public.organization_vehicle_relationships TO "tes-backend@tes-production-510007.iam";
GRANT INSERT(id,vehicle_id,organization_id,registration_kind,registration_number_display,registration_number_normalized,plate_display,plate_normalized,jurisdiction_country,jurisdiction_region,effective_from,effective_to) ON public.vehicle_registration_periods TO "tes-backend@tes-production-510007.iam";
GRANT UPDATE(effective_to,record_status,corrected_at,superseded_by_id,updated_at) ON public.vehicle_registration_periods TO "tes-backend@tes-production-510007.iam";
