
-- ============================================================================================================
-- Migration 0016 (0016_tax_registration_foundation.sql)
-- ============================================================================================================

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public' AND c.relname IN ('registration_programs','registrations','registration_versions','registration_status_periods')) THEN
    RAISE EXCEPTION 'a 0016 table already exists before 0016';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_registration_data_removal','guard_registration_update','guard_registration_version_insert','guard_registration_version_update','guard_registration_status_period_insert','guard_registration_status_period_update','require_registration_current_state','guard_active_organization')) THEN
    RAISE EXCEPTION 'a 0016 trigger function already exists before 0016';
  END IF;
  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code IN ('TAX_REGISTRATION_READ','TAX_REGISTRATION_MANAGE')) THEN
    RAISE EXCEPTION 'a 0016 capability already exists before 0016';
  END IF;
  RAISE NOTICE 'OK no 0016 table, function, capability exists before 0016';
END
$verify$;

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0016' AND filename = '0016_tax_registration_foundation.sql') THEN
    RAISE EXCEPTION 'ledger has no 0016 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records 0016_tax_registration_foundation.sql';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0016' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$organization_classification_types
organizations
customers
organization_identifiers
actors
authentication_identities
organization_aliases
master_account_authority
actor_relationships
relationship_assignments
capabilities
relationship_capability_grants
master_register_events
legacy_record_map
legacy_record_snapshots
locations
location_addresses
organization_location_assignments
authority_kinds
operating_authorities
operating_authority_versions
operating_authority_status_periods
contact_purpose_types
organization_channels
organization_person_relationships
organization_person_titles
contact_purpose_assignments
persons
person_name_versions
person_channels
customer_engagements
engagement_types
engagement_stage_types
product_levels
service_catalogue
engagement_end_reasons
customer_engagement_stages
customer_engagement_terminations
customer_agreements
customer_agreement_versions
engagement_service_scopes
engagement_responsibility_periods
registrations
registration_programs
registration_versions
registration_status_periods
organization_classifications$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT IN ('company_credentials','company_driver_requirement_periods','company_operating_scope_periods','company_profile_rules','company_rule_applicability_periods','credential_categories','credential_secret_slots','credential_status_periods','credential_system_aliases','credential_systems','credential_verifications','driver_licences','driver_medical_qualification_periods','driver_profiles','entity_resolution_candidates','entity_resolution_cases','entity_resolution_signals','insurance_broker_periods','insurance_coverage_types','insurance_coverage_vehicles','insurance_coverages','insurance_endorsements','insurance_policies','insurance_policy_terms','organization_driver_relationships','organization_vehicle_relationships','vehicle_merges','vehicle_registration_periods','vehicle_types','vehicles')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT IN ('company_credentials','company_driver_requirement_periods','company_operating_scope_periods','company_profile_rules','company_rule_applicability_periods','credential_categories','credential_secret_slots','credential_status_periods','credential_system_aliases','credential_systems','credential_verifications','driver_licences','driver_medical_qualification_periods','driver_profiles','entity_resolution_candidates','entity_resolution_cases','entity_resolution_signals','insurance_broker_periods','insurance_coverage_types','insurance_coverage_vehicles','insurance_coverages','insurance_endorsements','insurance_policies','insurance_policy_terms','organization_driver_relationships','organization_vehicle_relationships','vehicle_merges','vehicle_registration_periods','vehicle_types','vehicles')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$organization_classification_types
organizations
customers
organization_identifiers
actors
authentication_identities
organization_aliases
master_account_authority
actor_relationships
relationship_assignments
capabilities
relationship_capability_grants
master_register_events
legacy_record_map
legacy_record_snapshots
locations
location_addresses
organization_location_assignments
authority_kinds
operating_authorities
operating_authority_versions
operating_authority_status_periods
contact_purpose_types
organization_channels
organization_person_relationships
organization_person_titles
contact_purpose_assignments
persons
person_name_versions
person_channels
customer_engagements
engagement_types
engagement_stage_types
product_levels
service_catalogue
engagement_end_reasons
customer_engagement_stages
customer_engagement_terminations
customer_agreements
customer_agreement_versions
engagement_service_scopes
engagement_responsibility_periods
registrations
registration_programs
registration_versions
registration_status_periods
organization_classifications$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'public relations through 0016 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK public relations through 0016 (47 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0016' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$ORGANIZATION_READ|Read Organization|Read the canonical Organization behind an already-authorized Customer. Does not authorize Organization directory listing or search. Intended scope: CUSTOMER only.|true|10
ORGANIZATION_REGISTRY_READ|Read Organization Registry|SYSTEM-wide Organization registry access: list and search Organizations, read any Organization, view duplicate-match details, and list Customers. Intended scope: SYSTEM only.|true|20
ORGANIZATION_CREATE|Create Organization|Create a canonical Organization. Does not establish a TES Customer relationship. Intended scope: SYSTEM only.|true|30
ORGANIZATION_UPDATE|Update Organization|Modify canonical Organization facts: names, aliases, appropriate identifiers, registration jurisdiction and organization classifications. Does not authorize independent domains such as Authorities, Tax, Customs, Vehicles, Drivers, Contacts or Credentials. Intended scope: SYSTEM only.|true|40
ORGANIZATION_ARCHIVE|Archive Organization|Archive or restore a canonical Organization while preserving history. There is no Organization delete capability. Intended scope: SYSTEM only.|true|50
CUSTOMER_ESTABLISH|Establish Customer|Establish the TES Customer relationship for an existing canonical Organization and begin the Customer engagement. A combined create-and-establish workflow also requires ORGANIZATION_CREATE. Intended scope: SYSTEM only.|true|60
PERSON_REGISTRY_READ|Read Person and Contact Registry|SYSTEM-wide read access to canonical people and Organization contact data: read the contacts of any Organization, find potential duplicate people, and view matched people across Organizations. Intended scope: SYSTEM only.|true|70
CONTACT_MANAGE|Manage Contacts|Create and maintain people, their channels, Organization contact channels, Organization-person relationships, titles and contact purposes, including corrections and ending history. Does not authorize reading people across Organizations. Intended scope: SYSTEM only.|true|80
CUSTOMER_RELATIONSHIP_READ|Read Customer Relationship|SYSTEM-wide read access to Customer relationship state: Customers, Engagements, their stage history, service scope, TES responsibility windows and agreements. Intended scope: SYSTEM only.|true|90
CUSTOMER_RELATIONSHIP_MANAGE|Manage Customer Relationship|Manage an already-established Customer relationship: change and correct Engagement stages, end an Engagement, maintain service scope, TES responsibility windows and agreements. Does not establish a Customer (CUSTOMER_ESTABLISH). Intended scope: SYSTEM only.|true|100
TAX_REGISTRATION_READ|Read Tax Registrations|SYSTEM-wide read access to Organization tax, fuel-tax, highway-use, weight-distance and carrier-code registrations, their number / jurisdiction history and status history, and to the registration-number collision registry. Intended scope: SYSTEM only.|true|110
TAX_REGISTRATION_MANAGE|Manage Tax Registrations|Create, change, correct, archive and restore Organization registrations and record their status history. Does not file returns or store credentials. Intended scope: SYSTEM only.|true|120$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities WHERE code NOT IN ('COMPANY_PROFILE_MANAGE','COMPANY_PROFILE_READ','CREDENTIAL_MANAGE','CREDENTIAL_READ','DRIVER_MANAGE','DRIVER_READ','IDENTITY_RESOLUTION_MANAGE','IDENTITY_RESOLUTION_READ','INSURANCE_MANAGE','INSURANCE_READ','MASTER_REGISTER_READ','VEHICLE_MANAGE','VEHICLE_READ')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities WHERE code NOT IN ('COMPANY_PROFILE_MANAGE','COMPANY_PROFILE_READ','CREDENTIAL_MANAGE','CREDENTIAL_READ','DRIVER_MANAGE','DRIVER_READ','IDENTITY_RESOLUTION_MANAGE','IDENTITY_RESOLUTION_READ','INSURANCE_MANAGE','INSURANCE_READ','MASTER_REGISTER_READ','VEHICLE_MANAGE','VEHICLE_READ')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$ORGANIZATION_READ|Read Organization|Read the canonical Organization behind an already-authorized Customer. Does not authorize Organization directory listing or search. Intended scope: CUSTOMER only.|true|10
ORGANIZATION_REGISTRY_READ|Read Organization Registry|SYSTEM-wide Organization registry access: list and search Organizations, read any Organization, view duplicate-match details, and list Customers. Intended scope: SYSTEM only.|true|20
ORGANIZATION_CREATE|Create Organization|Create a canonical Organization. Does not establish a TES Customer relationship. Intended scope: SYSTEM only.|true|30
ORGANIZATION_UPDATE|Update Organization|Modify canonical Organization facts: names, aliases, appropriate identifiers, registration jurisdiction and organization classifications. Does not authorize independent domains such as Authorities, Tax, Customs, Vehicles, Drivers, Contacts or Credentials. Intended scope: SYSTEM only.|true|40
ORGANIZATION_ARCHIVE|Archive Organization|Archive or restore a canonical Organization while preserving history. There is no Organization delete capability. Intended scope: SYSTEM only.|true|50
CUSTOMER_ESTABLISH|Establish Customer|Establish the TES Customer relationship for an existing canonical Organization and begin the Customer engagement. A combined create-and-establish workflow also requires ORGANIZATION_CREATE. Intended scope: SYSTEM only.|true|60
PERSON_REGISTRY_READ|Read Person and Contact Registry|SYSTEM-wide read access to canonical people and Organization contact data: read the contacts of any Organization, find potential duplicate people, and view matched people across Organizations. Intended scope: SYSTEM only.|true|70
CONTACT_MANAGE|Manage Contacts|Create and maintain people, their channels, Organization contact channels, Organization-person relationships, titles and contact purposes, including corrections and ending history. Does not authorize reading people across Organizations. Intended scope: SYSTEM only.|true|80
CUSTOMER_RELATIONSHIP_READ|Read Customer Relationship|SYSTEM-wide read access to Customer relationship state: Customers, Engagements, their stage history, service scope, TES responsibility windows and agreements. Intended scope: SYSTEM only.|true|90
CUSTOMER_RELATIONSHIP_MANAGE|Manage Customer Relationship|Manage an already-established Customer relationship: change and correct Engagement stages, end an Engagement, maintain service scope, TES responsibility windows and agreements. Does not establish a Customer (CUSTOMER_ESTABLISH). Intended scope: SYSTEM only.|true|100
TAX_REGISTRATION_READ|Read Tax Registrations|SYSTEM-wide read access to Organization tax, fuel-tax, highway-use, weight-distance and carrier-code registrations, their number / jurisdiction history and status history, and to the registration-number collision registry. Intended scope: SYSTEM only.|true|110
TAX_REGISTRATION_MANAGE|Manage Tax Registrations|Create, change, correct, archive and restore Organization registrations and record their status history. Does not file returns or store credentials. Intended scope: SYSTEM only.|true|120$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'capability catalogue through 0016 (full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue through 0016 (full rows) (12 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0016' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$prevent_location_data_removal
current_customer_id
prevent_master_register_mutation
prevent_legacy_record_mutation
guard_legacy_record_map_update
guard_person_dependent_insert
guard_organization_channel_insert
resolve_legacy_company
guard_location_address_update
guard_location_update
guard_assignment_insert
guard_assignment_update
require_current_location_address
prevent_authority_data_removal
guard_authority_update
guard_authority_version_insert
guard_authority_status_period_insert
guard_authority_version_update
guard_authority_status_period_update
require_authority_current_state
prevent_contact_data_removal
guard_person_update
guard_contact_period_update
guard_relationship_insert
guard_relationship_update
guard_relationship_dependent_insert
guard_purpose_assignment_insert
require_current_person_name
prevent_customer_relationship_removal
guard_engagement_termination_insert
guard_engagement_insert
guard_engagement_update
guard_engagement_child_update
guard_engagement_stage_insert
guard_engagement_termination_update
guard_engagement_scope_insert
prevent_registration_data_removal
guard_engagement_scope_update
guard_engagement_responsibility_insert
guard_customer_agreement_update
guard_customer_agreement_version_insert
require_engagement_consistency
require_customer_agreement_version
guard_registration_update
guard_registration_version_insert
guard_registration_version_update
guard_registration_status_period_insert
guard_registration_status_period_update
require_registration_current_state
guard_active_organization$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname NOT IN ('accessible_customers_for_actor','current_customer_actor_id','current_customer_capability','current_system_actor_id','current_system_capability','customer_context_authorized','guard_company_credential_insert','guard_company_credential_update','guard_company_driver_requirement_update','guard_company_operating_scope_update','guard_company_rule_applicability_insert','guard_company_rule_applicability_update','guard_credential_alias','guard_credential_secret_slot_insert','guard_credential_secret_slot_update','guard_credential_status_period_insert','guard_credential_status_period_update','guard_credential_system_name','guard_credential_verification_insert','guard_credential_verification_update','guard_driver_history_update','guard_driver_operational_insert','guard_entity_resolution_case_update','guard_insurance_broker_period_insert','guard_insurance_broker_period_update','guard_insurance_coverage_insert','guard_insurance_coverage_update','guard_insurance_endorsement_insert','guard_insurance_endorsement_update','guard_insurance_policy_update','guard_insurance_schedule_insert','guard_insurance_schedule_update','guard_insurance_schedule_vehicle','guard_insurance_term_insert','guard_insurance_term_update','guard_vehicle_history_update','guard_vehicle_merge_insert','guard_vehicle_merge_update','guard_vehicle_operational_insert','prevent_company_profile_data_removal','prevent_credential_data_removal','prevent_driver_identity_removal','prevent_entity_resolution_removal','prevent_insurance_data_removal','prevent_insurance_schedule_data_removal','prevent_person_archive_with_driver_relationship','prevent_vehicle_identity_removal','prevent_vehicle_merge_cycle','prevent_vehicle_merge_data_removal','require_credential_current_state','require_insurance_policy_state','require_insurance_term_coverage','require_vehicle_merge_consistency','system_context_authorized')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname NOT IN ('accessible_customers_for_actor','current_customer_actor_id','current_customer_capability','current_system_actor_id','current_system_capability','customer_context_authorized','guard_company_credential_insert','guard_company_credential_update','guard_company_driver_requirement_update','guard_company_operating_scope_update','guard_company_rule_applicability_insert','guard_company_rule_applicability_update','guard_credential_alias','guard_credential_secret_slot_insert','guard_credential_secret_slot_update','guard_credential_status_period_insert','guard_credential_status_period_update','guard_credential_system_name','guard_credential_verification_insert','guard_credential_verification_update','guard_driver_history_update','guard_driver_operational_insert','guard_entity_resolution_case_update','guard_insurance_broker_period_insert','guard_insurance_broker_period_update','guard_insurance_coverage_insert','guard_insurance_coverage_update','guard_insurance_endorsement_insert','guard_insurance_endorsement_update','guard_insurance_policy_update','guard_insurance_schedule_insert','guard_insurance_schedule_update','guard_insurance_schedule_vehicle','guard_insurance_term_insert','guard_insurance_term_update','guard_vehicle_history_update','guard_vehicle_merge_insert','guard_vehicle_merge_update','guard_vehicle_operational_insert','prevent_company_profile_data_removal','prevent_credential_data_removal','prevent_driver_identity_removal','prevent_entity_resolution_removal','prevent_insurance_data_removal','prevent_insurance_schedule_data_removal','prevent_person_archive_with_driver_relationship','prevent_vehicle_identity_removal','prevent_vehicle_merge_cycle','prevent_vehicle_merge_data_removal','require_credential_current_state','require_insurance_policy_state','require_insurance_term_coverage','require_vehicle_merge_consistency','system_context_authorized')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$prevent_location_data_removal
current_customer_id
prevent_master_register_mutation
prevent_legacy_record_mutation
guard_legacy_record_map_update
guard_person_dependent_insert
guard_organization_channel_insert
resolve_legacy_company
guard_location_address_update
guard_location_update
guard_assignment_insert
guard_assignment_update
require_current_location_address
prevent_authority_data_removal
guard_authority_update
guard_authority_version_insert
guard_authority_status_period_insert
guard_authority_version_update
guard_authority_status_period_update
require_authority_current_state
prevent_contact_data_removal
guard_person_update
guard_contact_period_update
guard_relationship_insert
guard_relationship_update
guard_relationship_dependent_insert
guard_purpose_assignment_insert
require_current_person_name
prevent_customer_relationship_removal
guard_engagement_termination_insert
guard_engagement_insert
guard_engagement_update
guard_engagement_child_update
guard_engagement_stage_insert
guard_engagement_termination_update
guard_engagement_scope_insert
prevent_registration_data_removal
guard_engagement_scope_update
guard_engagement_responsibility_insert
guard_customer_agreement_update
guard_customer_agreement_version_insert
require_engagement_consistency
require_customer_agreement_version
guard_registration_update
guard_registration_version_insert
guard_registration_version_update
guard_registration_status_period_insert
guard_registration_status_period_update
require_registration_current_state
guard_active_organization$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'tes_security function set through 0016 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK tes_security function set through 0016 (50 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0016' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname || '.' || pp.proname NOT IN ('tes_security.accessible_customers_for_actor','tes_security.current_customer_actor_id','tes_security.current_customer_capability','tes_security.current_system_actor_id','tes_security.current_system_capability','tes_security.customer_context_authorized','tes_security.guard_company_credential_insert','tes_security.guard_company_credential_update','tes_security.guard_company_driver_requirement_update','tes_security.guard_company_operating_scope_update','tes_security.guard_company_rule_applicability_insert','tes_security.guard_company_rule_applicability_update','tes_security.guard_credential_alias','tes_security.guard_credential_secret_slot_insert','tes_security.guard_credential_secret_slot_update','tes_security.guard_credential_status_period_insert','tes_security.guard_credential_status_period_update','tes_security.guard_credential_system_name','tes_security.guard_credential_verification_insert','tes_security.guard_credential_verification_update','tes_security.guard_driver_history_update','tes_security.guard_driver_operational_insert','tes_security.guard_entity_resolution_case_update','tes_security.guard_insurance_broker_period_insert','tes_security.guard_insurance_broker_period_update','tes_security.guard_insurance_coverage_insert','tes_security.guard_insurance_coverage_update','tes_security.guard_insurance_endorsement_insert','tes_security.guard_insurance_endorsement_update','tes_security.guard_insurance_policy_update','tes_security.guard_insurance_schedule_insert','tes_security.guard_insurance_schedule_update','tes_security.guard_insurance_schedule_vehicle','tes_security.guard_insurance_term_insert','tes_security.guard_insurance_term_update','tes_security.guard_vehicle_history_update','tes_security.guard_vehicle_merge_insert','tes_security.guard_vehicle_merge_update','tes_security.guard_vehicle_operational_insert','tes_security.prevent_company_profile_data_removal','tes_security.prevent_credential_data_removal','tes_security.prevent_driver_identity_removal','tes_security.prevent_entity_resolution_removal','tes_security.prevent_insurance_data_removal','tes_security.prevent_insurance_schedule_data_removal','tes_security.prevent_person_archive_with_driver_relationship','tes_security.prevent_vehicle_identity_removal','tes_security.prevent_vehicle_merge_cycle','tes_security.prevent_vehicle_merge_data_removal','tes_security.require_credential_current_state','tes_security.require_insurance_policy_state','tes_security.require_insurance_term_coverage','tes_security.require_vehicle_merge_consistency','tes_security.system_context_authorized')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname || '.' || pp.proname NOT IN ('tes_security.accessible_customers_for_actor','tes_security.current_customer_actor_id','tes_security.current_customer_capability','tes_security.current_system_actor_id','tes_security.current_system_capability','tes_security.customer_context_authorized','tes_security.guard_company_credential_insert','tes_security.guard_company_credential_update','tes_security.guard_company_driver_requirement_update','tes_security.guard_company_operating_scope_update','tes_security.guard_company_rule_applicability_insert','tes_security.guard_company_rule_applicability_update','tes_security.guard_credential_alias','tes_security.guard_credential_secret_slot_insert','tes_security.guard_credential_secret_slot_update','tes_security.guard_credential_status_period_insert','tes_security.guard_credential_status_period_update','tes_security.guard_credential_system_name','tes_security.guard_credential_verification_insert','tes_security.guard_credential_verification_update','tes_security.guard_driver_history_update','tes_security.guard_driver_operational_insert','tes_security.guard_entity_resolution_case_update','tes_security.guard_insurance_broker_period_insert','tes_security.guard_insurance_broker_period_update','tes_security.guard_insurance_coverage_insert','tes_security.guard_insurance_coverage_update','tes_security.guard_insurance_endorsement_insert','tes_security.guard_insurance_endorsement_update','tes_security.guard_insurance_policy_update','tes_security.guard_insurance_schedule_insert','tes_security.guard_insurance_schedule_update','tes_security.guard_insurance_schedule_vehicle','tes_security.guard_insurance_term_insert','tes_security.guard_insurance_term_update','tes_security.guard_vehicle_history_update','tes_security.guard_vehicle_merge_insert','tes_security.guard_vehicle_merge_update','tes_security.guard_vehicle_operational_insert','tes_security.prevent_company_profile_data_removal','tes_security.prevent_credential_data_removal','tes_security.prevent_driver_identity_removal','tes_security.prevent_entity_resolution_removal','tes_security.prevent_insurance_data_removal','tes_security.prevent_insurance_schedule_data_removal','tes_security.prevent_person_archive_with_driver_relationship','tes_security.prevent_vehicle_identity_removal','tes_security.prevent_vehicle_merge_cycle','tes_security.prevent_vehicle_merge_data_removal','tes_security.require_credential_current_state','tes_security.require_insurance_policy_state','tes_security.require_insurance_term_coverage','tes_security.require_vehicle_merge_consistency','tes_security.system_context_authorized')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function set through 0016 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK SECURITY DEFINER function set through 0016 (1 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NULL default=-
program_family text NOT NULL default=-
jurisdiction_scope text NOT NULL default=-
issuer_country text NULL default=-
region_required boolean NOT NULL default=-
fixed_region text NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.registration_programs'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.registration_programs'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NULL default=-
program_family text NOT NULL default=-
jurisdiction_scope text NOT NULL default=-
issuer_country text NULL default=-
region_required boolean NOT NULL default=-
fixed_region text NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'registration_programs columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK registration_programs columns (name, data type, nullability, default) (12 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
program_code text NOT NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.registrations'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.registrations'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
program_code text NOT NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'registrations columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK registrations columns (name, data type, nullability, default) (7 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
registration_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
program_code text NOT NULL default=-
number_display text NOT NULL default=-
number_normalized text NOT NULL default=-
normalization_rule_version text NOT NULL default=-
jurisdiction_country text NULL default=-
jurisdiction_region text NULL default=-
issued_on date NULL default=-
expires_on date NULL default=-
version_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_version_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.registration_versions'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.registration_versions'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
registration_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
program_code text NOT NULL default=-
number_display text NOT NULL default=-
number_normalized text NOT NULL default=-
normalization_rule_version text NOT NULL default=-
jurisdiction_country text NULL default=-
jurisdiction_region text NULL default=-
issued_on date NULL default=-
expires_on date NULL default=-
version_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_version_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'registration_versions columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK registration_versions columns (name, data type, nullability, default) (19 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
registration_id uuid NOT NULL default=-
registration_status text NOT NULL default=-
period_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.registration_status_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.registration_status_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
registration_id uuid NOT NULL default=-
registration_status text NOT NULL default=-
period_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'registration_status_periods columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK registration_status_periods columns (name, data type, nullability, default) (11 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$registration_programs registration_programs_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
registration_programs registration_programs_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
registration_programs registration_programs_family_valid c CHECK ((program_family = ANY (ARRAY['FUEL_TAX'::text, 'HIGHWAY_USE_TAX'::text, 'WEIGHT_DISTANCE_TAX'::text, 'EXCISE_TAX'::text, 'CARRIER_CODE'::text]))) deferrable=false deferred=false
registration_programs registration_programs_fixed_region_valid c CHECK (((fixed_region IS NULL) OR (fixed_region ~ '^[A-Z0-9]{1,8}$'::text))) deferrable=false deferred=false
registration_programs registration_programs_issuer_country_valid c CHECK (((issuer_country IS NULL) OR (issuer_country ~ '^[A-Z]{2}$'::text))) deferrable=false deferred=false
registration_programs registration_programs_jurisdiction_scope_valid c CHECK ((jurisdiction_scope = ANY (ARRAY['GLOBAL'::text, 'NATIONAL'::text, 'COUNTRY_REGION'::text, 'BASE_JURISDICTION'::text]))) deferrable=false deferred=false
registration_programs registration_programs_pkey p PRIMARY KEY (code) deferrable=false deferred=false
registration_programs registration_programs_scope_shape_consistent c CHECK ((((jurisdiction_scope = 'GLOBAL'::text) AND (issuer_country IS NULL) AND (region_required = false) AND (fixed_region IS NULL)) OR ((jurisdiction_scope = 'NATIONAL'::text) AND (issuer_country IS NOT NULL) AND (region_required = false) AND (fixed_region IS NULL)) OR ((jurisdiction_scope = 'COUNTRY_REGION'::text) AND (issuer_country IS NOT NULL) AND (region_required = true)) OR ((jurisdiction_scope = 'BASE_JURISDICTION'::text) AND (region_required = true) AND (fixed_region IS NULL)))) deferrable=false deferred=false
registration_programs registration_programs_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
registrations registrations_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
registrations registrations_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
registrations registrations_id_program_uq u UNIQUE (id, program_code) deferrable=false deferred=false
registrations registrations_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
registrations registrations_pkey p PRIMARY KEY (id) deferrable=false deferred=false
registrations registrations_program_code_fkey f FOREIGN KEY (program_code) REFERENCES registration_programs(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
registrations registrations_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
registration_versions registration_versions_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_version_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_version_id IS NOT NULL)))) deferrable=false deferred=false
registration_versions registration_versions_country_valid c CHECK (((jurisdiction_country IS NULL) OR (jurisdiction_country ~ '^[A-Z]{2}$'::text))) deferrable=false deferred=false
registration_versions registration_versions_document_dates_valid c CHECK (((issued_on IS NULL) OR (expires_on IS NULL) OR (expires_on >= issued_on))) deferrable=false deferred=false
registration_versions registration_versions_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
registration_versions registration_versions_id_registration_uq u UNIQUE (id, registration_id) deferrable=false deferred=false
registration_versions registration_versions_not_superseded_by_self c CHECK (((superseded_by_version_id IS NULL) OR (superseded_by_version_id <> id))) deferrable=false deferred=false
registration_versions registration_versions_number_display_not_blank c CHECK ((btrim(number_display) <> ''::text)) deferrable=false deferred=false
registration_versions registration_versions_number_normalized_not_blank c CHECK ((btrim(number_normalized) <> ''::text)) deferrable=false deferred=false
registration_versions registration_versions_organization_fk f FOREIGN KEY (registration_id, organization_id) REFERENCES registrations(id, organization_id) ON DELETE RESTRICT deferrable=false deferred=false
registration_versions registration_versions_pkey p PRIMARY KEY (id) deferrable=false deferred=false
registration_versions registration_versions_reason_valid c CHECK ((version_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
registration_versions registration_versions_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
registration_versions registration_versions_region_needs_country c CHECK (((jurisdiction_region IS NULL) OR (jurisdiction_country IS NOT NULL))) deferrable=false deferred=false
registration_versions registration_versions_region_valid c CHECK (((jurisdiction_region IS NULL) OR (jurisdiction_region ~ '^[A-Z0-9]{1,8}$'::text))) deferrable=false deferred=false
registration_versions registration_versions_registration_fk f FOREIGN KEY (registration_id, program_code) REFERENCES registrations(id, program_code) ON DELETE RESTRICT deferrable=false deferred=false
registration_versions registration_versions_rule_version_not_blank c CHECK ((btrim(normalization_rule_version) <> ''::text)) deferrable=false deferred=false
registration_versions registration_versions_superseded_by_fk f FOREIGN KEY (superseded_by_version_id, registration_id) REFERENCES registration_versions(id, registration_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
registration_status_periods registration_status_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
registration_status_periods registration_status_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
registration_status_periods registration_status_periods_id_registration_uq u UNIQUE (id, registration_id) deferrable=false deferred=false
registration_status_periods registration_status_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
registration_status_periods registration_status_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
registration_status_periods registration_status_periods_reason_valid c CHECK ((period_reason = ANY (ARRAY['INITIAL'::text, 'TRANSITION'::text, 'REACTIVATION'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
registration_status_periods registration_status_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
registration_status_periods registration_status_periods_registration_id_fkey f FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE RESTRICT deferrable=false deferred=false
registration_status_periods registration_status_periods_status_valid c CHECK ((registration_status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'INACTIVE'::text, 'CLOSED'::text]))) deferrable=false deferred=false
registration_status_periods registration_status_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, registration_id) REFERENCES registration_status_periods(id, registration_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$registration_programs registration_programs_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
registration_programs registration_programs_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
registration_programs registration_programs_family_valid c CHECK ((program_family = ANY (ARRAY['FUEL_TAX'::text, 'HIGHWAY_USE_TAX'::text, 'WEIGHT_DISTANCE_TAX'::text, 'EXCISE_TAX'::text, 'CARRIER_CODE'::text]))) deferrable=false deferred=false
registration_programs registration_programs_fixed_region_valid c CHECK (((fixed_region IS NULL) OR (fixed_region ~ '^[A-Z0-9]{1,8}$'::text))) deferrable=false deferred=false
registration_programs registration_programs_issuer_country_valid c CHECK (((issuer_country IS NULL) OR (issuer_country ~ '^[A-Z]{2}$'::text))) deferrable=false deferred=false
registration_programs registration_programs_jurisdiction_scope_valid c CHECK ((jurisdiction_scope = ANY (ARRAY['GLOBAL'::text, 'NATIONAL'::text, 'COUNTRY_REGION'::text, 'BASE_JURISDICTION'::text]))) deferrable=false deferred=false
registration_programs registration_programs_pkey p PRIMARY KEY (code) deferrable=false deferred=false
registration_programs registration_programs_scope_shape_consistent c CHECK ((((jurisdiction_scope = 'GLOBAL'::text) AND (issuer_country IS NULL) AND (region_required = false) AND (fixed_region IS NULL)) OR ((jurisdiction_scope = 'NATIONAL'::text) AND (issuer_country IS NOT NULL) AND (region_required = false) AND (fixed_region IS NULL)) OR ((jurisdiction_scope = 'COUNTRY_REGION'::text) AND (issuer_country IS NOT NULL) AND (region_required = true)) OR ((jurisdiction_scope = 'BASE_JURISDICTION'::text) AND (region_required = true) AND (fixed_region IS NULL)))) deferrable=false deferred=false
registration_programs registration_programs_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
registrations registrations_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
registrations registrations_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
registrations registrations_id_program_uq u UNIQUE (id, program_code) deferrable=false deferred=false
registrations registrations_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
registrations registrations_pkey p PRIMARY KEY (id) deferrable=false deferred=false
registrations registrations_program_code_fkey f FOREIGN KEY (program_code) REFERENCES registration_programs(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
registrations registrations_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
registration_versions registration_versions_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_version_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_version_id IS NOT NULL)))) deferrable=false deferred=false
registration_versions registration_versions_country_valid c CHECK (((jurisdiction_country IS NULL) OR (jurisdiction_country ~ '^[A-Z]{2}$'::text))) deferrable=false deferred=false
registration_versions registration_versions_document_dates_valid c CHECK (((issued_on IS NULL) OR (expires_on IS NULL) OR (expires_on >= issued_on))) deferrable=false deferred=false
registration_versions registration_versions_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
registration_versions registration_versions_id_registration_uq u UNIQUE (id, registration_id) deferrable=false deferred=false
registration_versions registration_versions_not_superseded_by_self c CHECK (((superseded_by_version_id IS NULL) OR (superseded_by_version_id <> id))) deferrable=false deferred=false
registration_versions registration_versions_number_display_not_blank c CHECK ((btrim(number_display) <> ''::text)) deferrable=false deferred=false
registration_versions registration_versions_number_normalized_not_blank c CHECK ((btrim(number_normalized) <> ''::text)) deferrable=false deferred=false
registration_versions registration_versions_organization_fk f FOREIGN KEY (registration_id, organization_id) REFERENCES registrations(id, organization_id) ON DELETE RESTRICT deferrable=false deferred=false
registration_versions registration_versions_pkey p PRIMARY KEY (id) deferrable=false deferred=false
registration_versions registration_versions_reason_valid c CHECK ((version_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
registration_versions registration_versions_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
registration_versions registration_versions_region_needs_country c CHECK (((jurisdiction_region IS NULL) OR (jurisdiction_country IS NOT NULL))) deferrable=false deferred=false
registration_versions registration_versions_region_valid c CHECK (((jurisdiction_region IS NULL) OR (jurisdiction_region ~ '^[A-Z0-9]{1,8}$'::text))) deferrable=false deferred=false
registration_versions registration_versions_registration_fk f FOREIGN KEY (registration_id, program_code) REFERENCES registrations(id, program_code) ON DELETE RESTRICT deferrable=false deferred=false
registration_versions registration_versions_rule_version_not_blank c CHECK ((btrim(normalization_rule_version) <> ''::text)) deferrable=false deferred=false
registration_versions registration_versions_superseded_by_fk f FOREIGN KEY (superseded_by_version_id, registration_id) REFERENCES registration_versions(id, registration_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
registration_status_periods registration_status_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
registration_status_periods registration_status_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
registration_status_periods registration_status_periods_id_registration_uq u UNIQUE (id, registration_id) deferrable=false deferred=false
registration_status_periods registration_status_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
registration_status_periods registration_status_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
registration_status_periods registration_status_periods_reason_valid c CHECK ((period_reason = ANY (ARRAY['INITIAL'::text, 'TRANSITION'::text, 'REACTIVATION'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
registration_status_periods registration_status_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
registration_status_periods registration_status_periods_registration_id_fkey f FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE RESTRICT deferrable=false deferred=false
registration_status_periods registration_status_periods_status_valid c CHECK ((registration_status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'INACTIVE'::text, 'CLOSED'::text]))) deferrable=false deferred=false
registration_status_periods registration_status_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, registration_id) REFERENCES registration_status_periods(id, registration_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0016 constraints (definition, deferrability) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0016 constraints (definition, deferrability) (43 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$registration_programs registration_programs_pkey CREATE UNIQUE INDEX registration_programs_pkey ON public.registration_programs USING btree (code)
registration_programs registration_programs_sort_order_uq CREATE UNIQUE INDEX registration_programs_sort_order_uq ON public.registration_programs USING btree (sort_order)
registration_status_periods registration_status_periods_pkey CREATE UNIQUE INDEX registration_status_periods_pkey ON public.registration_status_periods USING btree (id)
registration_status_periods registration_status_periods_id_registration_uq CREATE UNIQUE INDEX registration_status_periods_id_registration_uq ON public.registration_status_periods USING btree (id, registration_id)
registration_status_periods registration_status_periods_current_uq CREATE UNIQUE INDEX registration_status_periods_current_uq ON public.registration_status_periods USING btree (registration_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
registration_status_periods registration_status_periods_history_idx CREATE INDEX registration_status_periods_history_idx ON public.registration_status_periods USING btree (registration_id, effective_from)
registration_versions registration_versions_pkey CREATE UNIQUE INDEX registration_versions_pkey ON public.registration_versions USING btree (id)
registration_versions registration_versions_id_registration_uq CREATE UNIQUE INDEX registration_versions_id_registration_uq ON public.registration_versions USING btree (id, registration_id)
registration_versions registration_versions_current_uq CREATE UNIQUE INDEX registration_versions_current_uq ON public.registration_versions USING btree (registration_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
registration_versions registration_versions_current_number_uq CREATE UNIQUE INDEX registration_versions_current_number_uq ON public.registration_versions USING btree (program_code, jurisdiction_country, jurisdiction_region, number_normalized) NULLS NOT DISTINCT WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
registration_versions registration_versions_history_idx CREATE INDEX registration_versions_history_idx ON public.registration_versions USING btree (registration_id, effective_from)
registration_versions registration_versions_number_lookup_idx CREATE INDEX registration_versions_number_lookup_idx ON public.registration_versions USING btree (program_code, number_normalized)
registrations registrations_pkey CREATE UNIQUE INDEX registrations_pkey ON public.registrations USING btree (id)
registrations registrations_id_program_uq CREATE UNIQUE INDEX registrations_id_program_uq ON public.registrations USING btree (id, program_code)
registrations registrations_id_organization_uq CREATE UNIQUE INDEX registrations_id_organization_uq ON public.registrations USING btree (id, organization_id)
registrations registrations_organization_idx CREATE INDEX registrations_organization_idx ON public.registrations USING btree (organization_id, program_code)$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('registration_programs','registrations','registration_versions','registration_status_periods')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('registration_programs','registrations','registration_versions','registration_status_periods')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$registration_programs registration_programs_pkey CREATE UNIQUE INDEX registration_programs_pkey ON public.registration_programs USING btree (code)
registration_programs registration_programs_sort_order_uq CREATE UNIQUE INDEX registration_programs_sort_order_uq ON public.registration_programs USING btree (sort_order)
registration_status_periods registration_status_periods_pkey CREATE UNIQUE INDEX registration_status_periods_pkey ON public.registration_status_periods USING btree (id)
registration_status_periods registration_status_periods_id_registration_uq CREATE UNIQUE INDEX registration_status_periods_id_registration_uq ON public.registration_status_periods USING btree (id, registration_id)
registration_status_periods registration_status_periods_current_uq CREATE UNIQUE INDEX registration_status_periods_current_uq ON public.registration_status_periods USING btree (registration_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
registration_status_periods registration_status_periods_history_idx CREATE INDEX registration_status_periods_history_idx ON public.registration_status_periods USING btree (registration_id, effective_from)
registration_versions registration_versions_pkey CREATE UNIQUE INDEX registration_versions_pkey ON public.registration_versions USING btree (id)
registration_versions registration_versions_id_registration_uq CREATE UNIQUE INDEX registration_versions_id_registration_uq ON public.registration_versions USING btree (id, registration_id)
registration_versions registration_versions_current_uq CREATE UNIQUE INDEX registration_versions_current_uq ON public.registration_versions USING btree (registration_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
registration_versions registration_versions_current_number_uq CREATE UNIQUE INDEX registration_versions_current_number_uq ON public.registration_versions USING btree (program_code, jurisdiction_country, jurisdiction_region, number_normalized) NULLS NOT DISTINCT WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
registration_versions registration_versions_history_idx CREATE INDEX registration_versions_history_idx ON public.registration_versions USING btree (registration_id, effective_from)
registration_versions registration_versions_number_lookup_idx CREATE INDEX registration_versions_number_lookup_idx ON public.registration_versions USING btree (program_code, number_normalized)
registrations registrations_pkey CREATE UNIQUE INDEX registrations_pkey ON public.registrations USING btree (id)
registrations registrations_id_program_uq CREATE UNIQUE INDEX registrations_id_program_uq ON public.registrations USING btree (id, program_code)
registrations registrations_id_organization_uq CREATE UNIQUE INDEX registrations_id_organization_uq ON public.registrations USING btree (id, organization_id)
registrations registrations_organization_idx CREATE INDEX registrations_organization_idx ON public.registrations USING btree (organization_id, program_code)$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0016 indexes (exact definitions) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0016 indexes (exact definitions) (16 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$registrations registrations_guard_update enabled=O type=19 function=tes_security.guard_registration_update args= constraint=false deferrable=false deferred=false
registrations registrations_require_current_state enabled=O type=5 function=tes_security.require_registration_current_state args= constraint=true deferrable=true deferred=true
registration_versions registration_versions_guard_insert enabled=O type=7 function=tes_security.guard_registration_version_insert args= constraint=false deferrable=false deferred=false
registration_versions registration_versions_guard_update enabled=O type=19 function=tes_security.guard_registration_version_update args= constraint=false deferrable=false deferred=false
registration_status_periods registration_status_periods_guard_insert enabled=O type=7 function=tes_security.guard_registration_status_period_insert args= constraint=false deferrable=false deferred=false
registration_status_periods registration_status_periods_guard_update enabled=O type=19 function=tes_security.guard_registration_status_period_update args= constraint=false deferrable=false deferred=false
registrations registrations_no_delete enabled=O type=11 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registration_versions registration_versions_no_delete enabled=O type=11 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registration_status_periods registration_status_periods_no_delete enabled=O type=11 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registrations registrations_no_truncate enabled=O type=34 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registration_versions registration_versions_no_truncate enabled=O type=34 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registration_status_periods registration_status_periods_no_truncate enabled=O type=34 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registrations registrations_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
registration_versions registration_versions_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$registrations registrations_guard_update enabled=O type=19 function=tes_security.guard_registration_update args= constraint=false deferrable=false deferred=false
registrations registrations_require_current_state enabled=O type=5 function=tes_security.require_registration_current_state args= constraint=true deferrable=true deferred=true
registration_versions registration_versions_guard_insert enabled=O type=7 function=tes_security.guard_registration_version_insert args= constraint=false deferrable=false deferred=false
registration_versions registration_versions_guard_update enabled=O type=19 function=tes_security.guard_registration_version_update args= constraint=false deferrable=false deferred=false
registration_status_periods registration_status_periods_guard_insert enabled=O type=7 function=tes_security.guard_registration_status_period_insert args= constraint=false deferrable=false deferred=false
registration_status_periods registration_status_periods_guard_update enabled=O type=19 function=tes_security.guard_registration_status_period_update args= constraint=false deferrable=false deferred=false
registrations registrations_no_delete enabled=O type=11 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registration_versions registration_versions_no_delete enabled=O type=11 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registration_status_periods registration_status_periods_no_delete enabled=O type=11 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registrations registrations_no_truncate enabled=O type=34 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registration_versions registration_versions_no_truncate enabled=O type=34 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registration_status_periods registration_status_periods_no_truncate enabled=O type=34 function=tes_security.prevent_registration_data_removal args= constraint=false deferrable=false deferred=false
registrations registrations_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
registration_versions registration_versions_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0016 triggers (enabled flag, type, function, arguments, deferral) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0016 triggers (enabled flag, type, function, arguments, deferral) (14 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$prevent_registration_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=766d40c38b9c9720d3f95d5bf3b3c244 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_registration_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=dc039146db6fc421fbef6fdf0388f025 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_registration_version_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=4d1c04755e54d54838b99a00dbfada05 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_registration_version_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=979fb0fc5f91c717c8c7a7b6ed8dbbbe owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_registration_status_period_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=ac2183f77595d4c8ea82af67a099f53b owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_registration_status_period_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=7f2aea7bbd92da9df58ad2a74d529ca8 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_registration_current_state secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=31a29c586813b99df3ff98c3d7a9dff8 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_active_organization secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=c8d389cb28be7e20ab55c6a6cb14eda9 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_registration_data_removal','guard_registration_update','guard_registration_version_insert','guard_registration_version_update','guard_registration_status_period_insert','guard_registration_status_period_update','require_registration_current_state','guard_active_organization')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_registration_data_removal','guard_registration_update','guard_registration_version_insert','guard_registration_version_update','guard_registration_status_period_insert','guard_registration_status_period_update','require_registration_current_state','guard_active_organization')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$prevent_registration_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=766d40c38b9c9720d3f95d5bf3b3c244 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_registration_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=dc039146db6fc421fbef6fdf0388f025 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_registration_version_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=4d1c04755e54d54838b99a00dbfada05 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_registration_version_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=979fb0fc5f91c717c8c7a7b6ed8dbbbe owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_registration_status_period_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=ac2183f77595d4c8ea82af67a099f53b owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_registration_status_period_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=7f2aea7bbd92da9df58ad2a74d529ca8 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_registration_current_state secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=31a29c586813b99df3ff98c3d7a9dff8 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_active_organization secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=c8d389cb28be7e20ab55c6a6cb14eda9 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0016 functions (fixed search_path, body checksum, SECURITY DEFINER only where designed, no PUBLIC/runtime execute) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0016 functions (fixed search_path, body checksum, SECURITY DEFINER only where designed, no PUBLIC/runtime execute) (8 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$registration_programs owner=tes-database-migrator@tes-production-510007.iam
registrations owner=tes-database-migrator@tes-production-510007.iam
registration_versions owner=tes-database-migrator@tes-production-510007.iam
registration_status_periods owner=tes-database-migrator@tes-production-510007.iam$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$registration_programs owner=tes-database-migrator@tes-production-510007.iam
registrations owner=tes-database-migrator@tes-production-510007.iam
registration_versions owner=tes-database-migrator@tes-production-510007.iam
registration_status_periods owner=tes-database-migrator@tes-production-510007.iam$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0016 table ownership differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0016 table ownership (4 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$registration_programs tes-backend@tes-production-510007.iam SELECT grantable=false
registrations tes-backend@tes-production-510007.iam SELECT grantable=false
registration_versions tes-backend@tes-production-510007.iam SELECT grantable=false
registration_status_periods tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass) AND x.grantee <> c.relowner) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass) AND x.grantee <> c.relowner) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$registration_programs tes-backend@tes-production-510007.iam SELECT grantable=false
registrations tes-backend@tes-production-510007.iam SELECT grantable=false
registration_versions tes-backend@tes-production-510007.iam SELECT grantable=false
registration_status_periods tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0016 table ACL (every non-owner grantee) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0016 table ACL (every non-owner grantee) (4 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$registrations.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
registrations.program_code tes-backend@tes-production-510007.iam INSERT grantable=false
registrations.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
registrations.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
registrations.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_versions.id tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.registration_id tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.program_code tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.number_display tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.number_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.normalization_rule_version tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.jurisdiction_country tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.jurisdiction_region tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.issued_on tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.expires_on tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.version_reason tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_versions.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_versions.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_versions.superseded_by_version_id tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_versions.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_status_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
registration_status_periods.registration_id tes-backend@tes-production-510007.iam INSERT grantable=false
registration_status_periods.registration_status tes-backend@tes-production-510007.iam INSERT grantable=false
registration_status_periods.period_reason tes-backend@tes-production-510007.iam INSERT grantable=false
registration_status_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
registration_status_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_status_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_status_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_status_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_status_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$registrations.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
registrations.program_code tes-backend@tes-production-510007.iam INSERT grantable=false
registrations.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
registrations.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
registrations.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_versions.id tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.registration_id tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.program_code tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.number_display tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.number_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.normalization_rule_version tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.jurisdiction_country tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.jurisdiction_region tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.issued_on tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.expires_on tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.version_reason tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
registration_versions.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_versions.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_versions.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_versions.superseded_by_version_id tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_versions.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_status_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
registration_status_periods.registration_id tes-backend@tes-production-510007.iam INSERT grantable=false
registration_status_periods.registration_status tes-backend@tes-production-510007.iam INSERT grantable=false
registration_status_periods.period_reason tes-backend@tes-production-510007.iam INSERT grantable=false
registration_status_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
registration_status_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_status_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_status_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_status_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
registration_status_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0016 column ACL (every column-specific grant) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0016 column ACL (every column-specific grant) (33 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$IFTA|IFTA Licence|International Fuel Tax Agreement licence / account issued by the licensee's base jurisdiction. The base jurisdiction (which may change over time), licence number and licence period are recorded; quarterly returns (Tax Filing) and decals (Vehicles) are separate concepts.|FUEL_TAX|BASE_JURISDICTION|-|true|-|true|10
CT_HUF|Connecticut Highway Use Fee|Connecticut highway use fee registration (CT DRS). Connecticut number space.|HIGHWAY_USE_TAX|COUNTRY_REGION|US|true|CT|true|20
NY_HUT|New York Highway Use Tax|New York highway use tax certificate of registration (NY DTF). New York number space.|HIGHWAY_USE_TAX|COUNTRY_REGION|US|true|NY|true|30
KYU|Kentucky Weight Distance Tax (KYU)|Kentucky weight-distance tax account (KYU). Kentucky number space.|WEIGHT_DISTANCE_TAX|COUNTRY_REGION|US|true|KY|true|40
NM_WDT|New Mexico Weight Distance Tax|New Mexico weight-distance tax account. New Mexico number space.|WEIGHT_DISTANCE_TAX|COUNTRY_REGION|US|true|NM|true|50
OR_WMT|Oregon Weight-Mile Tax|Oregon weight-mile tax account (Oregon DOT Motor Carrier). Oregon number space.|WEIGHT_DISTANCE_TAX|COUNTRY_REGION|US|true|OR|true|60
FUEL_CHARGE|Federal Fuel Charge Registration|Canada federal fuel charge registration. Retained for outstanding historical obligations. Canadian number space.|FUEL_TAX|NATIONAL|CA|false|-|true|70
TX_EXCISE|Texas Excise / Motor Fuel Tax Account|Texas excise / motor-fuel tax account where separate from IFTA. Texas number space.|EXCISE_TAX|COUNTRY_REGION|US|true|TX|true|80
AR_MFT|Arkansas Motor Fuel Tax Account|Arkansas motor fuel tax account where separate from IFTA. Arkansas number space.|EXCISE_TAX|COUNTRY_REGION|US|true|AR|true|90
ON_TOBACCO|Ontario Tobacco Tax Account|Ontario tobacco tax account / permit for interjurisdictional transport activity. Ontario number space.|EXCISE_TAX|COUNTRY_REGION|CA|true|ON|true|100
SCAC|SCAC|Standard Carrier Alpha Code issued by NMFTA: a stable carrier code (two to four letters) carried on border and freight documents. One worldwide number space.|CARRIER_CODE|GLOBAL|-|false|-|true|110
CA_CARRIER_CODE|Canadian Carrier Code (CBSA)|Carrier code issued by the Canada Border Services Agency for eManifest. Canadian number space.|CARRIER_CODE|NATIONAL|CA|false|-|true|120$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(program_family::text, '-') || '|' || COALESCE(jurisdiction_scope::text, '-') || '|' || COALESCE(issuer_country::text, '-') || '|' || COALESCE(region_required::text, '-') || '|' || COALESCE(fixed_region::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.registration_programs) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(program_family::text, '-') || '|' || COALESCE(jurisdiction_scope::text, '-') || '|' || COALESCE(issuer_country::text, '-') || '|' || COALESCE(region_required::text, '-') || '|' || COALESCE(fixed_region::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.registration_programs) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$IFTA|IFTA Licence|International Fuel Tax Agreement licence / account issued by the licensee's base jurisdiction. The base jurisdiction (which may change over time), licence number and licence period are recorded; quarterly returns (Tax Filing) and decals (Vehicles) are separate concepts.|FUEL_TAX|BASE_JURISDICTION|-|true|-|true|10
CT_HUF|Connecticut Highway Use Fee|Connecticut highway use fee registration (CT DRS). Connecticut number space.|HIGHWAY_USE_TAX|COUNTRY_REGION|US|true|CT|true|20
NY_HUT|New York Highway Use Tax|New York highway use tax certificate of registration (NY DTF). New York number space.|HIGHWAY_USE_TAX|COUNTRY_REGION|US|true|NY|true|30
KYU|Kentucky Weight Distance Tax (KYU)|Kentucky weight-distance tax account (KYU). Kentucky number space.|WEIGHT_DISTANCE_TAX|COUNTRY_REGION|US|true|KY|true|40
NM_WDT|New Mexico Weight Distance Tax|New Mexico weight-distance tax account. New Mexico number space.|WEIGHT_DISTANCE_TAX|COUNTRY_REGION|US|true|NM|true|50
OR_WMT|Oregon Weight-Mile Tax|Oregon weight-mile tax account (Oregon DOT Motor Carrier). Oregon number space.|WEIGHT_DISTANCE_TAX|COUNTRY_REGION|US|true|OR|true|60
FUEL_CHARGE|Federal Fuel Charge Registration|Canada federal fuel charge registration. Retained for outstanding historical obligations. Canadian number space.|FUEL_TAX|NATIONAL|CA|false|-|true|70
TX_EXCISE|Texas Excise / Motor Fuel Tax Account|Texas excise / motor-fuel tax account where separate from IFTA. Texas number space.|EXCISE_TAX|COUNTRY_REGION|US|true|TX|true|80
AR_MFT|Arkansas Motor Fuel Tax Account|Arkansas motor fuel tax account where separate from IFTA. Arkansas number space.|EXCISE_TAX|COUNTRY_REGION|US|true|AR|true|90
ON_TOBACCO|Ontario Tobacco Tax Account|Ontario tobacco tax account / permit for interjurisdictional transport activity. Ontario number space.|EXCISE_TAX|COUNTRY_REGION|CA|true|ON|true|100
SCAC|SCAC|Standard Carrier Alpha Code issued by NMFTA: a stable carrier code (two to four letters) carried on border and freight documents. One worldwide number space.|CARRIER_CODE|GLOBAL|-|false|-|true|110
CA_CARRIER_CODE|Canadian Carrier Code (CBSA)|Carrier code issued by the Canada Border Services Agency for eManifest. Canadian number space.|CARRIER_CODE|NATIONAL|CA|false|-|true|120$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'registration_programs seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK registration_programs seed rows (12 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  runtime_role constant text := 'tes-backend@tes-production-510007.iam';
  migrator_role constant text := 'tes-database-migrator@tes-production-510007.iam';
  tbl text;
  priv text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  FOREACH tbl IN ARRAY ARRAY['registration_programs','registrations','registration_versions','registration_status_periods'] LOOP
    IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = ('public.' || tbl)::regclass)) <> migrator_role THEN
      RAISE EXCEPTION '% is not owned by the migration identity', tbl;
    END IF;
    IF NOT has_table_privilege(runtime_role, 'public.' || tbl, 'SELECT') THEN
      RAISE EXCEPTION 'runtime lacks SELECT on %', tbl;
    END IF;
    FOREACH priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(runtime_role, 'public.' || tbl, priv) THEN
        RAISE EXCEPTION 'runtime has table-level % on % (grants must be column-specific, and never DELETE / TRUNCATE)', priv, tbl;
      END IF;
    END LOOP;
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('public', 'public.' || tbl, priv) THEN
        RAISE EXCEPTION 'PUBLIC has % on %', priv, tbl;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.registration_programs'::regclass) AND a.attnum > 0 AND NOT a.attisdropped AND (has_column_privilege(runtime_role, a.attrelid, a.attnum, 'INSERT') OR has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'runtime can write a 0016 catalogue (changed only by migrations)';
  END IF;
  IF migrator_role = runtime_role THEN RAISE EXCEPTION 'migrator and runtime identities are the same'; END IF;

  IF current_setting('tes.verify_through') < '0020' AND (
       EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass) AND (relrowsecurity OR relforcerowsecurity))
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.registration_programs'::regclass,'public.registrations'::regclass,'public.registration_versions'::regclass,'public.registration_status_periods'::regclass))) THEN
    RAISE EXCEPTION 'RLS or a policy exists on a 0016 table (not part of the approved design before 0020)';
  END IF;

  RAISE NOTICE 'OK 0016 runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; no PUBLIC privilege; no RLS / policy before 0020 (RLS closure of 0024 is verified by its own script)';
END
$verify$;

DO $verify$
DECLARE
  bad bigint;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF current_setting('tes.verify_expect_empty') = '1' THEN
    IF (SELECT count(*) FROM public.registrations) <> 0 OR (SELECT count(*) FROM public.registration_versions) <> 0 OR (SELECT count(*) FROM public.registration_status_periods) <> 0 THEN
      RAISE EXCEPTION 'a 0016 business table is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id
               WHERE c.code IN ('TAX_REGISTRATION_READ','TAX_REGISTRATION_MANAGE')) THEN
      RAISE EXCEPTION 'a 0016 capability is granted to someone (0016 grants nothing; set TES_VERIFY_EXPECT_EMPTY=0 once grants are made deliberately)';
    END IF;
  END IF;

  SELECT count(*) INTO bad FROM public.registrations r
   WHERE (SELECT count(*) FROM public.registration_versions v WHERE v.registration_id = r.id AND v.record_status = 'active' AND v.effective_to IS NULL) <> 1
      OR (SELECT count(*) FROM public.registration_status_periods p WHERE p.registration_id = r.id AND p.record_status = 'active' AND p.effective_to IS NULL) <> 1;
  IF bad <> 0 THEN RAISE EXCEPTION '% registration(s) do not have exactly one current version and one current status period', bad; END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.registration_versions WHERE record_status = 'active' AND effective_to IS NULL
    GROUP BY program_code, jurisdiction_country, jurisdiction_region, number_normalized HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% registration number(s) held by more than one current version in their namespace', bad; END IF;

  SELECT count(*) INTO bad FROM public.registration_versions v JOIN public.registration_programs k ON k.code = v.program_code
   WHERE NOT ((k.jurisdiction_scope = 'GLOBAL' AND v.jurisdiction_country IS NULL AND v.jurisdiction_region IS NULL)
      OR (k.jurisdiction_scope = 'NATIONAL' AND v.jurisdiction_country = k.issuer_country AND v.jurisdiction_region IS NULL)
      OR (k.jurisdiction_scope = 'COUNTRY_REGION' AND v.jurisdiction_country = k.issuer_country AND v.jurisdiction_region IS NOT NULL AND (k.fixed_region IS NULL OR v.jurisdiction_region = k.fixed_region))
      OR (k.jurisdiction_scope = 'BASE_JURISDICTION' AND v.jurisdiction_country IS NOT NULL AND v.jurisdiction_region IS NOT NULL AND (k.issuer_country IS NULL OR v.jurisdiction_country = k.issuer_country)));
  IF bad <> 0 THEN RAISE EXCEPTION '% registration version(s) violate their program''s jurisdiction rules', bad; END IF;

  SELECT count(*) INTO bad FROM public.registration_versions a JOIN public.registration_versions b
    ON a.registration_id = b.registration_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping registration versions', bad; END IF;

  SELECT count(*) INTO bad FROM public.registration_status_periods a JOIN public.registration_status_periods b
    ON a.registration_id = b.registration_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping registration status periods', bad; END IF;

  RAISE NOTICE 'OK 0016 row conditions hold (registrations, registration_versions, registration_status_periods counted separately in the ROWCOUNT lines)';
END
$verify$;
