-- TES Core Operational Identity Graph: temporal overlap and merge integrity hardening
-- Migration: 0023
-- PostgreSQL exclusion constraints make temporal identity races authoritative at the database layer.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.organization_vehicle_relationships
 ADD CONSTRAINT organization_vehicle_relationships_no_overlap
 EXCLUDE USING gist (organization_id WITH =, vehicle_id WITH =, relationship_type WITH =,
   tstzrange(effective_from,effective_to,'[)') WITH &&)
 WHERE (record_status='active');

ALTER TABLE public.vehicle_registration_periods
 ADD CONSTRAINT vehicle_registration_periods_no_overlap
 EXCLUDE USING gist (vehicle_id WITH =, organization_id WITH =, registration_kind WITH =,
   daterange(effective_from,effective_to,'[)') WITH &&)
 WHERE (record_status='active');

ALTER TABLE public.driver_licences
 ADD CONSTRAINT driver_licences_identity_no_overlap
 EXCLUDE USING gist (jurisdiction_country WITH =, jurisdiction_region WITH =, licence_number_normalized WITH =,
   daterange(effective_from,effective_to,'[)') WITH &&)
 WHERE (record_status='active');

ALTER TABLE public.organization_driver_relationships
 ADD CONSTRAINT organization_driver_relationships_no_overlap
 EXCLUDE USING gist (organization_id WITH =, person_id WITH =, daterange(effective_from,effective_to,'[)') WITH &&)
 WHERE (record_status='active');

ALTER TABLE public.driver_medical_qualification_periods
 ADD CONSTRAINT driver_medical_qualification_periods_no_overlap
 EXCLUDE USING gist (person_id WITH =, qualification_type WITH =, jurisdiction_country WITH =,
   COALESCE(jurisdiction_region,'') WITH =, daterange(effective_from,effective_to,'[)') WITH &&)
 WHERE (record_status='active');

CREATE OR REPLACE FUNCTION tes_security.prevent_vehicle_merge_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE cursor_id uuid;
DECLARE
 IF NEW.record_status<>'merged' THEN RETURN NEW; END IF;
 cursor_id:=NEW.merged_into_vehicle_id;
 WHILE cursor_id IS NOT NULL LOOP
   IF cursor_id=NEW.id THEN RAISE EXCEPTION 'Vehicle merge cycle is not allowed' USING ERRCODE='23514'; END IF;
   SELECT merged_into_vehicle_id INTO cursor_id FROM public.vehicles WHERE id=cursor_id AND record_status='merged';
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER vehicles_merge_cycle_guard BEFORE INSERT OR UPDATE OF record_status,merged_into_vehicle_id ON public.vehicles
 FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_vehicle_merge_cycle();
REVOKE ALL ON FUNCTION tes_security.prevent_vehicle_merge_cycle() FROM PUBLIC;

CREATE OR REPLACE FUNCTION tes_security.prevent_person_archive_with_driver_relationship() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE
 IF NEW.record_status='archived' AND OLD.record_status='active' AND EXISTS(
   SELECT 1 FROM public.organization_driver_relationships r
    WHERE r.person_id=NEW.id AND r.record_status='active' AND r.effective_to IS NULL
 ) THEN RAISE EXCEPTION 'Person with a current driver relationship cannot be archived' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER persons_driver_archive_guard BEFORE UPDATE OF record_status ON public.persons
 FOR EACH ROW EXECUTE FUNCTION tes_security.prevent_person_archive_with_driver_relationship();
REVOKE ALL ON FUNCTION tes_security.prevent_person_archive_with_driver_relationship() FROM PUBLIC;
