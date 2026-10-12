
-- ============================================================================================================
-- Migration 0017 (0017_insurance_foundation.sql)
-- ============================================================================================================

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public' AND c.relname IN ('insurance_coverage_types','insurance_policies','insurance_policy_terms','insurance_endorsements','insurance_coverages','insurance_broker_periods')) THEN
    RAISE EXCEPTION 'a 0017 table already exists before 0017';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_insurance_data_removal','guard_insurance_policy_update','guard_insurance_term_insert','guard_insurance_term_update','guard_insurance_endorsement_insert','guard_insurance_endorsement_update','guard_insurance_coverage_insert','guard_insurance_coverage_update','guard_insurance_broker_period_insert','guard_insurance_broker_period_update','require_insurance_policy_state','require_insurance_term_coverage')) THEN
    RAISE EXCEPTION 'a 0017 trigger function already exists before 0017';
  END IF;
  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code IN ('INSURANCE_READ','INSURANCE_MANAGE')) THEN
    RAISE EXCEPTION 'a 0017 capability already exists before 0017';
  END IF;
  RAISE NOTICE 'OK no 0017 table, function, capability exists before 0017';
END
$verify$;

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0017' AND filename = '0017_insurance_foundation.sql') THEN
    RAISE EXCEPTION 'ledger has no 0017 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records 0017_insurance_foundation.sql';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0017' THEN RETURN; END IF;

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
insurance_policies
insurance_policy_terms
insurance_endorsements
insurance_coverages
insurance_broker_periods
insurance_coverage_types
organization_classifications$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT IN ('company_credentials','company_driver_requirement_periods','company_operating_scope_periods','company_profile_rules','company_rule_applicability_periods','credential_categories','credential_secret_slots','credential_status_periods','credential_system_aliases','credential_systems','credential_verifications','driver_licences','driver_medical_qualification_periods','driver_profiles','entity_resolution_candidates','entity_resolution_cases','entity_resolution_signals','insurance_coverage_vehicles','organization_driver_relationships','organization_vehicle_relationships','vehicle_merges','vehicle_registration_periods','vehicle_types','vehicles')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT IN ('company_credentials','company_driver_requirement_periods','company_operating_scope_periods','company_profile_rules','company_rule_applicability_periods','credential_categories','credential_secret_slots','credential_status_periods','credential_system_aliases','credential_systems','credential_verifications','driver_licences','driver_medical_qualification_periods','driver_profiles','entity_resolution_candidates','entity_resolution_cases','entity_resolution_signals','insurance_coverage_vehicles','organization_driver_relationships','organization_vehicle_relationships','vehicle_merges','vehicle_registration_periods','vehicle_types','vehicles')) AS a(l)
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
insurance_policies
insurance_policy_terms
insurance_endorsements
insurance_coverages
insurance_broker_periods
insurance_coverage_types
organization_classifications$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'public relations through 0017 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK public relations through 0017 (53 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0017' THEN RETURN; END IF;

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
TAX_REGISTRATION_MANAGE|Manage Tax Registrations|Create, change, correct, archive and restore Organization registrations and record their status history. Does not file returns or store credentials. Intended scope: SYSTEM only.|true|120
INSURANCE_READ|Read Insurance|SYSTEM-wide read access to Organization insurance policies, terms, coverages, endorsements, workers' compensation accounts, bonds and broker-of-record history, and to the policy-number registry. Intended scope: SYSTEM only.|true|130
INSURANCE_MANAGE|Manage Insurance|Create, renew, cancel, endorse, correct, archive and restore Organization insurance policies, coverages and broker-of-record assignments. Does not store certificates or evidence. Intended scope: SYSTEM only.|true|140$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities WHERE code NOT IN ('COMPANY_PROFILE_MANAGE','COMPANY_PROFILE_READ','CREDENTIAL_MANAGE','CREDENTIAL_READ','DRIVER_MANAGE','DRIVER_READ','IDENTITY_RESOLUTION_MANAGE','IDENTITY_RESOLUTION_READ','MASTER_REGISTER_READ','VEHICLE_MANAGE','VEHICLE_READ')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities WHERE code NOT IN ('COMPANY_PROFILE_MANAGE','COMPANY_PROFILE_READ','CREDENTIAL_MANAGE','CREDENTIAL_READ','DRIVER_MANAGE','DRIVER_READ','IDENTITY_RESOLUTION_MANAGE','IDENTITY_RESOLUTION_READ','MASTER_REGISTER_READ','VEHICLE_MANAGE','VEHICLE_READ')) AS a(l)
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
TAX_REGISTRATION_MANAGE|Manage Tax Registrations|Create, change, correct, archive and restore Organization registrations and record their status history. Does not file returns or store credentials. Intended scope: SYSTEM only.|true|120
INSURANCE_READ|Read Insurance|SYSTEM-wide read access to Organization insurance policies, terms, coverages, endorsements, workers' compensation accounts, bonds and broker-of-record history, and to the policy-number registry. Intended scope: SYSTEM only.|true|130
INSURANCE_MANAGE|Manage Insurance|Create, renew, cancel, endorse, correct, archive and restore Organization insurance policies, coverages and broker-of-record assignments. Does not store certificates or evidence. Intended scope: SYSTEM only.|true|140$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'capability catalogue through 0017 (full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue through 0017 (full rows) (14 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0017' THEN RETURN; END IF;

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
guard_active_organization
prevent_insurance_data_removal
guard_insurance_policy_update
guard_insurance_term_insert
guard_insurance_term_update
guard_insurance_endorsement_insert
guard_insurance_endorsement_update
guard_insurance_coverage_insert
guard_insurance_coverage_update
guard_insurance_broker_period_insert
guard_insurance_broker_period_update
require_insurance_policy_state
require_insurance_term_coverage$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname NOT IN ('accessible_customers_for_actor','current_customer_actor_id','current_customer_capability','current_system_actor_id','current_system_capability','customer_context_authorized','guard_company_credential_insert','guard_company_credential_update','guard_company_driver_requirement_update','guard_company_operating_scope_update','guard_company_rule_applicability_insert','guard_company_rule_applicability_update','guard_credential_alias','guard_credential_secret_slot_insert','guard_credential_secret_slot_update','guard_credential_status_period_insert','guard_credential_status_period_update','guard_credential_system_name','guard_credential_verification_insert','guard_credential_verification_update','guard_driver_history_update','guard_driver_operational_insert','guard_entity_resolution_case_update','guard_insurance_schedule_insert','guard_insurance_schedule_update','guard_insurance_schedule_vehicle','guard_vehicle_history_update','guard_vehicle_merge_insert','guard_vehicle_merge_update','guard_vehicle_operational_insert','prevent_company_profile_data_removal','prevent_credential_data_removal','prevent_driver_identity_removal','prevent_entity_resolution_removal','prevent_insurance_schedule_data_removal','prevent_person_archive_with_driver_relationship','prevent_vehicle_identity_removal','prevent_vehicle_merge_cycle','prevent_vehicle_merge_data_removal','require_credential_current_state','require_vehicle_merge_consistency','system_context_authorized')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname NOT IN ('accessible_customers_for_actor','current_customer_actor_id','current_customer_capability','current_system_actor_id','current_system_capability','customer_context_authorized','guard_company_credential_insert','guard_company_credential_update','guard_company_driver_requirement_update','guard_company_operating_scope_update','guard_company_rule_applicability_insert','guard_company_rule_applicability_update','guard_credential_alias','guard_credential_secret_slot_insert','guard_credential_secret_slot_update','guard_credential_status_period_insert','guard_credential_status_period_update','guard_credential_system_name','guard_credential_verification_insert','guard_credential_verification_update','guard_driver_history_update','guard_driver_operational_insert','guard_entity_resolution_case_update','guard_insurance_schedule_insert','guard_insurance_schedule_update','guard_insurance_schedule_vehicle','guard_vehicle_history_update','guard_vehicle_merge_insert','guard_vehicle_merge_update','guard_vehicle_operational_insert','prevent_company_profile_data_removal','prevent_credential_data_removal','prevent_driver_identity_removal','prevent_entity_resolution_removal','prevent_insurance_schedule_data_removal','prevent_person_archive_with_driver_relationship','prevent_vehicle_identity_removal','prevent_vehicle_merge_cycle','prevent_vehicle_merge_data_removal','require_credential_current_state','require_vehicle_merge_consistency','system_context_authorized')) AS a(l)
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
guard_active_organization
prevent_insurance_data_removal
guard_insurance_policy_update
guard_insurance_term_insert
guard_insurance_term_update
guard_insurance_endorsement_insert
guard_insurance_endorsement_update
guard_insurance_coverage_insert
guard_insurance_coverage_update
guard_insurance_broker_period_insert
guard_insurance_broker_period_update
require_insurance_policy_state
require_insurance_term_coverage$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'tes_security function set through 0017 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK tes_security function set through 0017 (62 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0017' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname || '.' || pp.proname NOT IN ('tes_security.accessible_customers_for_actor','tes_security.current_customer_actor_id','tes_security.current_customer_capability','tes_security.current_system_actor_id','tes_security.current_system_capability','tes_security.customer_context_authorized','tes_security.guard_company_credential_insert','tes_security.guard_company_credential_update','tes_security.guard_company_driver_requirement_update','tes_security.guard_company_operating_scope_update','tes_security.guard_company_rule_applicability_insert','tes_security.guard_company_rule_applicability_update','tes_security.guard_credential_alias','tes_security.guard_credential_secret_slot_insert','tes_security.guard_credential_secret_slot_update','tes_security.guard_credential_status_period_insert','tes_security.guard_credential_status_period_update','tes_security.guard_credential_system_name','tes_security.guard_credential_verification_insert','tes_security.guard_credential_verification_update','tes_security.guard_driver_history_update','tes_security.guard_driver_operational_insert','tes_security.guard_entity_resolution_case_update','tes_security.guard_insurance_schedule_insert','tes_security.guard_insurance_schedule_update','tes_security.guard_insurance_schedule_vehicle','tes_security.guard_vehicle_history_update','tes_security.guard_vehicle_merge_insert','tes_security.guard_vehicle_merge_update','tes_security.guard_vehicle_operational_insert','tes_security.prevent_company_profile_data_removal','tes_security.prevent_credential_data_removal','tes_security.prevent_driver_identity_removal','tes_security.prevent_entity_resolution_removal','tes_security.prevent_insurance_schedule_data_removal','tes_security.prevent_person_archive_with_driver_relationship','tes_security.prevent_vehicle_identity_removal','tes_security.prevent_vehicle_merge_cycle','tes_security.prevent_vehicle_merge_data_removal','tes_security.require_credential_current_state','tes_security.require_vehicle_merge_consistency','tes_security.system_context_authorized')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname || '.' || pp.proname NOT IN ('tes_security.accessible_customers_for_actor','tes_security.current_customer_actor_id','tes_security.current_customer_capability','tes_security.current_system_actor_id','tes_security.current_system_capability','tes_security.customer_context_authorized','tes_security.guard_company_credential_insert','tes_security.guard_company_credential_update','tes_security.guard_company_driver_requirement_update','tes_security.guard_company_operating_scope_update','tes_security.guard_company_rule_applicability_insert','tes_security.guard_company_rule_applicability_update','tes_security.guard_credential_alias','tes_security.guard_credential_secret_slot_insert','tes_security.guard_credential_secret_slot_update','tes_security.guard_credential_status_period_insert','tes_security.guard_credential_status_period_update','tes_security.guard_credential_system_name','tes_security.guard_credential_verification_insert','tes_security.guard_credential_verification_update','tes_security.guard_driver_history_update','tes_security.guard_driver_operational_insert','tes_security.guard_entity_resolution_case_update','tes_security.guard_insurance_schedule_insert','tes_security.guard_insurance_schedule_update','tes_security.guard_insurance_schedule_vehicle','tes_security.guard_vehicle_history_update','tes_security.guard_vehicle_merge_insert','tes_security.guard_vehicle_merge_update','tes_security.guard_vehicle_operational_insert','tes_security.prevent_company_profile_data_removal','tes_security.prevent_credential_data_removal','tes_security.prevent_driver_identity_removal','tes_security.prevent_entity_resolution_removal','tes_security.prevent_insurance_schedule_data_removal','tes_security.prevent_person_archive_with_driver_relationship','tes_security.prevent_vehicle_identity_removal','tes_security.prevent_vehicle_merge_cycle','tes_security.prevent_vehicle_merge_data_removal','tes_security.require_credential_current_state','tes_security.require_vehicle_merge_consistency','tes_security.system_context_authorized')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function set through 0017 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK SECURITY DEFINER function set through 0017 (1 entries) match the design exactly';
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
family text NOT NULL default=-
limit_required boolean NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_coverage_types'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_coverage_types'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NULL default=-
family text NOT NULL default=-
limit_required boolean NOT NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'insurance_coverage_types columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK insurance_coverage_types columns (name, data type, nullability, default) (9 entries) match the design exactly';
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
insurer_organization_id uuid NOT NULL default=-
family text NOT NULL default=-
renews_policy_id uuid NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_policies'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_policies'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
insurer_organization_id uuid NOT NULL default=-
family text NOT NULL default=-
renews_policy_id uuid NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'insurance_policies columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK insurance_policies columns (name, data type, nullability, default) (9 entries) match the design exactly';
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
policy_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
insurer_organization_id uuid NOT NULL default=-
family text NOT NULL default=-
number_display text NOT NULL default=-
number_normalized text NOT NULL default=-
normalization_rule_version text NOT NULL default=-
term_start date NOT NULL default=-
term_end date NULL default=-
cancelled_on date NULL default=-
cancellation_reason text NULL default=-
term_reason text NOT NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_term_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_policy_terms'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_policy_terms'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
policy_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
insurer_organization_id uuid NOT NULL default=-
family text NOT NULL default=-
number_display text NOT NULL default=-
number_normalized text NOT NULL default=-
normalization_rule_version text NOT NULL default=-
term_start date NOT NULL default=-
term_end date NULL default=-
cancelled_on date NULL default=-
cancellation_reason text NULL default=-
term_reason text NOT NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_term_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'insurance_policy_terms columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK insurance_policy_terms columns (name, data type, nullability, default) (18 entries) match the design exactly';
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
term_id uuid NOT NULL default=-
policy_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
family text NOT NULL default=-
number_display text NULL default=-
number_normalized text NULL default=-
endorsement_kind text NOT NULL default=-
effective_on date NOT NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_endorsement_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_endorsements'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_endorsements'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
term_id uuid NOT NULL default=-
policy_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
family text NOT NULL default=-
number_display text NULL default=-
number_normalized text NULL default=-
endorsement_kind text NOT NULL default=-
effective_on date NOT NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_endorsement_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'insurance_endorsements columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK insurance_endorsements columns (name, data type, nullability, default) (14 entries) match the design exactly';
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
term_id uuid NOT NULL default=-
policy_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
family text NOT NULL default=-
coverage_type text NOT NULL default=-
limit_amount numeric(14,2) NULL default=-
deductible_amount numeric(14,2) NULL default=-
currency text NULL default=-
limit_basis text NULL default=-
scheduled_vehicles_only boolean NOT NULL default=false
effective_from date NOT NULL default=-
effective_to date NULL default=-
endorsement_id uuid NULL default=-
ended_by_endorsement_id uuid NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_coverage_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_coverages'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_coverages'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
term_id uuid NOT NULL default=-
policy_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
family text NOT NULL default=-
coverage_type text NOT NULL default=-
limit_amount numeric(14,2) NULL default=-
deductible_amount numeric(14,2) NULL default=-
currency text NULL default=-
limit_basis text NULL default=-
scheduled_vehicles_only boolean NOT NULL default=false
effective_from date NOT NULL default=-
effective_to date NULL default=-
endorsement_id uuid NULL default=-
ended_by_endorsement_id uuid NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_coverage_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'insurance_coverages columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK insurance_coverages columns (name, data type, nullability, default) (20 entries) match the design exactly';
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
policy_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
broker_organization_id uuid NOT NULL default=-
broker_relationship_id uuid NULL default=-
broker_person_id uuid NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_broker_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_broker_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
policy_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
broker_organization_id uuid NOT NULL default=-
broker_relationship_id uuid NULL default=-
broker_person_id uuid NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'insurance_broker_periods columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK insurance_broker_periods columns (name, data type, nullability, default) (13 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_coverage_types insurance_coverage_types_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,39}$'::text)) deferrable=false deferred=false
insurance_coverage_types insurance_coverage_types_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
insurance_coverage_types insurance_coverage_types_family_valid c CHECK ((family = ANY (ARRAY['INSURANCE'::text, 'WORKERS_COMPENSATION'::text, 'BOND'::text]))) deferrable=false deferred=false
insurance_coverage_types insurance_coverage_types_pkey p PRIMARY KEY (code) deferrable=false deferred=false
insurance_coverage_types insurance_coverage_types_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
insurance_coverage_types insurance_coverage_types_code_family_uq u UNIQUE (code, family) deferrable=false deferred=false
insurance_policies insurance_policies_family_valid c CHECK ((family = ANY (ARRAY['INSURANCE'::text, 'WORKERS_COMPENSATION'::text, 'BOND'::text]))) deferrable=false deferred=false
insurance_policies insurance_policies_insurer_differs_from_insured c CHECK ((insurer_organization_id <> organization_id)) deferrable=false deferred=false
insurance_policies insurance_policies_not_renewal_of_self c CHECK (((renews_policy_id IS NULL) OR (renews_policy_id <> id))) deferrable=false deferred=false
insurance_policies insurance_policies_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
insurance_policies insurance_policies_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
insurance_policies insurance_policies_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_policies insurance_policies_id_organization_family_uq u UNIQUE (id, organization_id, family) deferrable=false deferred=false
insurance_policies insurance_policies_id_scope_uq u UNIQUE (id, organization_id, insurer_organization_id, family) deferrable=false deferred=false
insurance_policies insurance_policies_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
insurance_policies insurance_policies_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_policies insurance_policies_insurer_organization_id_fkey f FOREIGN KEY (insurer_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_policies insurance_policies_renews_fk f FOREIGN KEY (renews_policy_id, organization_id, family) REFERENCES insurance_policies(id, organization_id, family) ON DELETE RESTRICT deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_number_display_not_blank c CHECK ((btrim(number_display) <> ''::text)) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_number_normalized_not_blank c CHECK ((btrim(number_normalized) <> ''::text)) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_rule_version_not_blank c CHECK ((btrim(normalization_rule_version) <> ''::text)) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_period_valid c CHECK (((term_end IS NULL) OR (term_end > term_start))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_expiry_required c CHECK (((term_end IS NOT NULL) OR (family = 'BOND'::text))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_cancellation_state_consistent c CHECK (((cancelled_on IS NULL) = (cancellation_reason IS NULL))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_cancellation_reason_valid c CHECK (((cancellation_reason IS NULL) OR (cancellation_reason = ANY (ARRAY['INSURED_REQUEST'::text, 'INSURER_CANCELLATION'::text, 'NON_PAYMENT'::text, 'REPLACED_BY_NEW_POLICY'::text])))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_cancellation_within_term c CHECK (((cancelled_on IS NULL) OR ((cancelled_on >= term_start) AND ((term_end IS NULL) OR (cancelled_on <= term_end))))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_reason_valid c CHECK ((term_reason = ANY (ARRAY['INITIAL'::text, 'RENEWAL'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_term_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_term_id IS NOT NULL)))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_not_superseded_by_self c CHECK (((superseded_by_term_id IS NULL) OR (superseded_by_term_id <> id))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_id_policy_uq u UNIQUE (id, policy_id) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_id_scope_uq u UNIQUE (id, policy_id, organization_id, family) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_policy_fk f FOREIGN KEY (policy_id, organization_id, insurer_organization_id, family) REFERENCES insurance_policies(id, organization_id, insurer_organization_id, family) ON DELETE RESTRICT deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_superseded_by_fk f FOREIGN KEY (superseded_by_term_id, policy_id) REFERENCES insurance_policy_terms(id, policy_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
insurance_endorsements insurance_endorsements_number_pair c CHECK (((number_display IS NULL) = (number_normalized IS NULL))) deferrable=false deferred=false
insurance_coverages insurance_coverages_limit_positive c CHECK (((limit_amount IS NULL) OR (limit_amount > (0)::numeric))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_number_not_blank c CHECK (((number_display IS NULL) OR ((btrim(number_display) <> ''::text) AND (btrim(number_normalized) <> ''::text)))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_kind_valid c CHECK ((endorsement_kind = ANY (ARRAY['COVERAGE_ADDED'::text, 'COVERAGE_CHANGED'::text, 'COVERAGE_REMOVED'::text]))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_endorsement_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_endorsement_id IS NOT NULL)))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_not_superseded_by_self c CHECK (((superseded_by_endorsement_id IS NULL) OR (superseded_by_endorsement_id <> id))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_id_term_uq u UNIQUE (id, term_id) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_term_fk f FOREIGN KEY (term_id, policy_id, organization_id, family) REFERENCES insurance_policy_terms(id, policy_id, organization_id, family) ON DELETE RESTRICT deferrable=false deferred=false
insurance_endorsements insurance_endorsements_superseded_by_fk f FOREIGN KEY (superseded_by_endorsement_id, term_id) REFERENCES insurance_endorsements(id, term_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
insurance_coverages insurance_coverages_deductible_non_negative c CHECK (((deductible_amount IS NULL) OR (deductible_amount >= (0)::numeric))) deferrable=false deferred=false
insurance_coverages insurance_coverages_currency_state_consistent c CHECK (((currency IS NULL) = ((limit_amount IS NULL) AND (deductible_amount IS NULL)))) deferrable=false deferred=false
insurance_coverages insurance_coverages_currency_valid c CHECK (((currency IS NULL) OR (currency = ANY (ARRAY['CAD'::text, 'USD'::text])))) deferrable=false deferred=false
insurance_coverages insurance_coverages_limit_basis_valid c CHECK (((limit_basis IS NULL) OR (limit_basis = ANY (ARRAY['COMBINED_SINGLE_LIMIT'::text, 'PER_OCCURRENCE'::text, 'PER_VEHICLE'::text, 'AGGREGATE'::text, 'PENAL_SUM'::text])))) deferrable=false deferred=false
insurance_coverages insurance_coverages_limit_basis_needs_limit c CHECK (((limit_basis IS NULL) OR (limit_amount IS NOT NULL))) deferrable=false deferred=false
insurance_coverages insurance_coverages_period_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
insurance_coverages insurance_coverages_end_endorsement_needs_end c CHECK (((ended_by_endorsement_id IS NULL) OR (effective_to IS NOT NULL))) deferrable=false deferred=false
insurance_coverages insurance_coverages_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
insurance_coverages insurance_coverages_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_coverage_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_coverage_id IS NOT NULL)))) deferrable=false deferred=false
insurance_coverages insurance_coverages_not_superseded_by_self c CHECK (((superseded_by_coverage_id IS NULL) OR (superseded_by_coverage_id <> id))) deferrable=false deferred=false
insurance_coverages insurance_coverages_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_coverages insurance_coverages_id_term_uq u UNIQUE (id, term_id) deferrable=false deferred=false
insurance_coverages insurance_coverages_term_fk f FOREIGN KEY (term_id, policy_id, organization_id, family) REFERENCES insurance_policy_terms(id, policy_id, organization_id, family) ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverages insurance_coverages_type_fk f FOREIGN KEY (coverage_type, family) REFERENCES insurance_coverage_types(code, family) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverages insurance_coverages_endorsement_fk f FOREIGN KEY (endorsement_id, term_id) REFERENCES insurance_endorsements(id, term_id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverages insurance_coverages_ended_by_endorsement_fk f FOREIGN KEY (ended_by_endorsement_id, term_id) REFERENCES insurance_endorsements(id, term_id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverages insurance_coverages_superseded_by_fk f FOREIGN KEY (superseded_by_coverage_id, term_id) REFERENCES insurance_coverages(id, term_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
insurance_broker_periods insurance_broker_periods_contact_pair c CHECK (((broker_relationship_id IS NULL) = (broker_person_id IS NULL))) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_id_policy_uq u UNIQUE (id, policy_id) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_broker_organization_id_fkey f FOREIGN KEY (broker_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_policy_fk f FOREIGN KEY (policy_id, organization_id) REFERENCES insurance_policies(id, organization_id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_contact_fk f FOREIGN KEY (broker_relationship_id, broker_organization_id, broker_person_id) REFERENCES organization_person_relationships(id, organization_id, person_id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, policy_id) REFERENCES insurance_broker_periods(id, policy_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_coverage_types insurance_coverage_types_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,39}$'::text)) deferrable=false deferred=false
insurance_coverage_types insurance_coverage_types_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
insurance_coverage_types insurance_coverage_types_family_valid c CHECK ((family = ANY (ARRAY['INSURANCE'::text, 'WORKERS_COMPENSATION'::text, 'BOND'::text]))) deferrable=false deferred=false
insurance_coverage_types insurance_coverage_types_pkey p PRIMARY KEY (code) deferrable=false deferred=false
insurance_coverage_types insurance_coverage_types_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
insurance_coverage_types insurance_coverage_types_code_family_uq u UNIQUE (code, family) deferrable=false deferred=false
insurance_policies insurance_policies_family_valid c CHECK ((family = ANY (ARRAY['INSURANCE'::text, 'WORKERS_COMPENSATION'::text, 'BOND'::text]))) deferrable=false deferred=false
insurance_policies insurance_policies_insurer_differs_from_insured c CHECK ((insurer_organization_id <> organization_id)) deferrable=false deferred=false
insurance_policies insurance_policies_not_renewal_of_self c CHECK (((renews_policy_id IS NULL) OR (renews_policy_id <> id))) deferrable=false deferred=false
insurance_policies insurance_policies_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
insurance_policies insurance_policies_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
insurance_policies insurance_policies_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_policies insurance_policies_id_organization_family_uq u UNIQUE (id, organization_id, family) deferrable=false deferred=false
insurance_policies insurance_policies_id_scope_uq u UNIQUE (id, organization_id, insurer_organization_id, family) deferrable=false deferred=false
insurance_policies insurance_policies_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
insurance_policies insurance_policies_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_policies insurance_policies_insurer_organization_id_fkey f FOREIGN KEY (insurer_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_policies insurance_policies_renews_fk f FOREIGN KEY (renews_policy_id, organization_id, family) REFERENCES insurance_policies(id, organization_id, family) ON DELETE RESTRICT deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_number_display_not_blank c CHECK ((btrim(number_display) <> ''::text)) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_number_normalized_not_blank c CHECK ((btrim(number_normalized) <> ''::text)) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_rule_version_not_blank c CHECK ((btrim(normalization_rule_version) <> ''::text)) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_period_valid c CHECK (((term_end IS NULL) OR (term_end > term_start))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_expiry_required c CHECK (((term_end IS NOT NULL) OR (family = 'BOND'::text))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_cancellation_state_consistent c CHECK (((cancelled_on IS NULL) = (cancellation_reason IS NULL))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_cancellation_reason_valid c CHECK (((cancellation_reason IS NULL) OR (cancellation_reason = ANY (ARRAY['INSURED_REQUEST'::text, 'INSURER_CANCELLATION'::text, 'NON_PAYMENT'::text, 'REPLACED_BY_NEW_POLICY'::text])))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_cancellation_within_term c CHECK (((cancelled_on IS NULL) OR ((cancelled_on >= term_start) AND ((term_end IS NULL) OR (cancelled_on <= term_end))))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_reason_valid c CHECK ((term_reason = ANY (ARRAY['INITIAL'::text, 'RENEWAL'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_term_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_term_id IS NOT NULL)))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_not_superseded_by_self c CHECK (((superseded_by_term_id IS NULL) OR (superseded_by_term_id <> id))) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_id_policy_uq u UNIQUE (id, policy_id) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_id_scope_uq u UNIQUE (id, policy_id, organization_id, family) deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_policy_fk f FOREIGN KEY (policy_id, organization_id, insurer_organization_id, family) REFERENCES insurance_policies(id, organization_id, insurer_organization_id, family) ON DELETE RESTRICT deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_superseded_by_fk f FOREIGN KEY (superseded_by_term_id, policy_id) REFERENCES insurance_policy_terms(id, policy_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
insurance_endorsements insurance_endorsements_number_pair c CHECK (((number_display IS NULL) = (number_normalized IS NULL))) deferrable=false deferred=false
insurance_coverages insurance_coverages_limit_positive c CHECK (((limit_amount IS NULL) OR (limit_amount > (0)::numeric))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_number_not_blank c CHECK (((number_display IS NULL) OR ((btrim(number_display) <> ''::text) AND (btrim(number_normalized) <> ''::text)))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_kind_valid c CHECK ((endorsement_kind = ANY (ARRAY['COVERAGE_ADDED'::text, 'COVERAGE_CHANGED'::text, 'COVERAGE_REMOVED'::text]))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_endorsement_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_endorsement_id IS NOT NULL)))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_not_superseded_by_self c CHECK (((superseded_by_endorsement_id IS NULL) OR (superseded_by_endorsement_id <> id))) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_id_term_uq u UNIQUE (id, term_id) deferrable=false deferred=false
insurance_endorsements insurance_endorsements_term_fk f FOREIGN KEY (term_id, policy_id, organization_id, family) REFERENCES insurance_policy_terms(id, policy_id, organization_id, family) ON DELETE RESTRICT deferrable=false deferred=false
insurance_endorsements insurance_endorsements_superseded_by_fk f FOREIGN KEY (superseded_by_endorsement_id, term_id) REFERENCES insurance_endorsements(id, term_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
insurance_coverages insurance_coverages_deductible_non_negative c CHECK (((deductible_amount IS NULL) OR (deductible_amount >= (0)::numeric))) deferrable=false deferred=false
insurance_coverages insurance_coverages_currency_state_consistent c CHECK (((currency IS NULL) = ((limit_amount IS NULL) AND (deductible_amount IS NULL)))) deferrable=false deferred=false
insurance_coverages insurance_coverages_currency_valid c CHECK (((currency IS NULL) OR (currency = ANY (ARRAY['CAD'::text, 'USD'::text])))) deferrable=false deferred=false
insurance_coverages insurance_coverages_limit_basis_valid c CHECK (((limit_basis IS NULL) OR (limit_basis = ANY (ARRAY['COMBINED_SINGLE_LIMIT'::text, 'PER_OCCURRENCE'::text, 'PER_VEHICLE'::text, 'AGGREGATE'::text, 'PENAL_SUM'::text])))) deferrable=false deferred=false
insurance_coverages insurance_coverages_limit_basis_needs_limit c CHECK (((limit_basis IS NULL) OR (limit_amount IS NOT NULL))) deferrable=false deferred=false
insurance_coverages insurance_coverages_period_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
insurance_coverages insurance_coverages_end_endorsement_needs_end c CHECK (((ended_by_endorsement_id IS NULL) OR (effective_to IS NOT NULL))) deferrable=false deferred=false
insurance_coverages insurance_coverages_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
insurance_coverages insurance_coverages_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_coverage_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_coverage_id IS NOT NULL)))) deferrable=false deferred=false
insurance_coverages insurance_coverages_not_superseded_by_self c CHECK (((superseded_by_coverage_id IS NULL) OR (superseded_by_coverage_id <> id))) deferrable=false deferred=false
insurance_coverages insurance_coverages_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_coverages insurance_coverages_id_term_uq u UNIQUE (id, term_id) deferrable=false deferred=false
insurance_coverages insurance_coverages_term_fk f FOREIGN KEY (term_id, policy_id, organization_id, family) REFERENCES insurance_policy_terms(id, policy_id, organization_id, family) ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverages insurance_coverages_type_fk f FOREIGN KEY (coverage_type, family) REFERENCES insurance_coverage_types(code, family) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverages insurance_coverages_endorsement_fk f FOREIGN KEY (endorsement_id, term_id) REFERENCES insurance_endorsements(id, term_id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverages insurance_coverages_ended_by_endorsement_fk f FOREIGN KEY (ended_by_endorsement_id, term_id) REFERENCES insurance_endorsements(id, term_id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverages insurance_coverages_superseded_by_fk f FOREIGN KEY (superseded_by_coverage_id, term_id) REFERENCES insurance_coverages(id, term_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
insurance_broker_periods insurance_broker_periods_contact_pair c CHECK (((broker_relationship_id IS NULL) = (broker_person_id IS NULL))) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_id_policy_uq u UNIQUE (id, policy_id) deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_broker_organization_id_fkey f FOREIGN KEY (broker_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_policy_fk f FOREIGN KEY (policy_id, organization_id) REFERENCES insurance_policies(id, organization_id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_contact_fk f FOREIGN KEY (broker_relationship_id, broker_organization_id, broker_person_id) REFERENCES organization_person_relationships(id, organization_id, person_id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, policy_id) REFERENCES insurance_broker_periods(id, policy_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0017 constraints (definition, deferrability) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0017 constraints (definition, deferrability) (74 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_endorsements insurance_endorsements_pkey CREATE UNIQUE INDEX insurance_endorsements_pkey ON public.insurance_endorsements USING btree (id)
insurance_endorsements insurance_endorsements_id_term_uq CREATE UNIQUE INDEX insurance_endorsements_id_term_uq ON public.insurance_endorsements USING btree (id, term_id)
insurance_endorsements insurance_endorsements_number_uq CREATE UNIQUE INDEX insurance_endorsements_number_uq ON public.insurance_endorsements USING btree (term_id, number_normalized) WHERE ((record_status = 'active'::text) AND (number_normalized IS NOT NULL))
insurance_endorsements insurance_endorsements_term_idx CREATE INDEX insurance_endorsements_term_idx ON public.insurance_endorsements USING btree (term_id, effective_on)
insurance_coverages insurance_coverages_pkey CREATE UNIQUE INDEX insurance_coverages_pkey ON public.insurance_coverages USING btree (id)
insurance_coverages insurance_coverages_id_term_uq CREATE UNIQUE INDEX insurance_coverages_id_term_uq ON public.insurance_coverages USING btree (id, term_id)
insurance_coverages insurance_coverages_current_uq CREATE UNIQUE INDEX insurance_coverages_current_uq ON public.insurance_coverages USING btree (term_id, coverage_type) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
insurance_coverages insurance_coverages_term_idx CREATE INDEX insurance_coverages_term_idx ON public.insurance_coverages USING btree (term_id, coverage_type, effective_from)
insurance_coverages insurance_coverages_organization_idx CREATE INDEX insurance_coverages_organization_idx ON public.insurance_coverages USING btree (organization_id, coverage_type)
insurance_coverage_types insurance_coverage_types_pkey CREATE UNIQUE INDEX insurance_coverage_types_pkey ON public.insurance_coverage_types USING btree (code)
insurance_coverage_types insurance_coverage_types_sort_order_uq CREATE UNIQUE INDEX insurance_coverage_types_sort_order_uq ON public.insurance_coverage_types USING btree (sort_order)
insurance_coverage_types insurance_coverage_types_code_family_uq CREATE UNIQUE INDEX insurance_coverage_types_code_family_uq ON public.insurance_coverage_types USING btree (code, family)
insurance_broker_periods insurance_broker_periods_pkey CREATE UNIQUE INDEX insurance_broker_periods_pkey ON public.insurance_broker_periods USING btree (id)
insurance_broker_periods insurance_broker_periods_id_policy_uq CREATE UNIQUE INDEX insurance_broker_periods_id_policy_uq ON public.insurance_broker_periods USING btree (id, policy_id)
insurance_broker_periods insurance_broker_periods_current_uq CREATE UNIQUE INDEX insurance_broker_periods_current_uq ON public.insurance_broker_periods USING btree (policy_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
insurance_broker_periods insurance_broker_periods_history_idx CREATE INDEX insurance_broker_periods_history_idx ON public.insurance_broker_periods USING btree (policy_id, effective_from)
insurance_broker_periods insurance_broker_periods_broker_idx CREATE INDEX insurance_broker_periods_broker_idx ON public.insurance_broker_periods USING btree (broker_organization_id)
insurance_policies insurance_policies_pkey CREATE UNIQUE INDEX insurance_policies_pkey ON public.insurance_policies USING btree (id)
insurance_policies insurance_policies_id_organization_family_uq CREATE UNIQUE INDEX insurance_policies_id_organization_family_uq ON public.insurance_policies USING btree (id, organization_id, family)
insurance_policies insurance_policies_id_scope_uq CREATE UNIQUE INDEX insurance_policies_id_scope_uq ON public.insurance_policies USING btree (id, organization_id, insurer_organization_id, family)
insurance_policies insurance_policies_id_organization_uq CREATE UNIQUE INDEX insurance_policies_id_organization_uq ON public.insurance_policies USING btree (id, organization_id)
insurance_policies insurance_policies_organization_idx CREATE INDEX insurance_policies_organization_idx ON public.insurance_policies USING btree (organization_id, family)
insurance_policies insurance_policies_insurer_idx CREATE INDEX insurance_policies_insurer_idx ON public.insurance_policies USING btree (insurer_organization_id)
insurance_policies insurance_policies_renews_idx CREATE INDEX insurance_policies_renews_idx ON public.insurance_policies USING btree (renews_policy_id) WHERE (renews_policy_id IS NOT NULL)
insurance_policy_terms insurance_policy_terms_pkey CREATE UNIQUE INDEX insurance_policy_terms_pkey ON public.insurance_policy_terms USING btree (id)
insurance_policy_terms insurance_policy_terms_id_policy_uq CREATE UNIQUE INDEX insurance_policy_terms_id_policy_uq ON public.insurance_policy_terms USING btree (id, policy_id)
insurance_policy_terms insurance_policy_terms_id_scope_uq CREATE UNIQUE INDEX insurance_policy_terms_id_scope_uq ON public.insurance_policy_terms USING btree (id, policy_id, organization_id, family)
insurance_policy_terms insurance_policy_terms_policy_idx CREATE INDEX insurance_policy_terms_policy_idx ON public.insurance_policy_terms USING btree (policy_id, term_start)
insurance_policy_terms insurance_policy_terms_number_lookup_idx CREATE INDEX insurance_policy_terms_number_lookup_idx ON public.insurance_policy_terms USING btree (insurer_organization_id, number_normalized) WHERE (record_status = 'active'::text)
insurance_policy_terms insurance_policy_terms_organization_idx CREATE INDEX insurance_policy_terms_organization_idx ON public.insurance_policy_terms USING btree (organization_id, term_start)$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('insurance_coverage_types','insurance_policies','insurance_policy_terms','insurance_endorsements','insurance_coverages','insurance_broker_periods')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('insurance_coverage_types','insurance_policies','insurance_policy_terms','insurance_endorsements','insurance_coverages','insurance_broker_periods')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_endorsements insurance_endorsements_pkey CREATE UNIQUE INDEX insurance_endorsements_pkey ON public.insurance_endorsements USING btree (id)
insurance_endorsements insurance_endorsements_id_term_uq CREATE UNIQUE INDEX insurance_endorsements_id_term_uq ON public.insurance_endorsements USING btree (id, term_id)
insurance_endorsements insurance_endorsements_number_uq CREATE UNIQUE INDEX insurance_endorsements_number_uq ON public.insurance_endorsements USING btree (term_id, number_normalized) WHERE ((record_status = 'active'::text) AND (number_normalized IS NOT NULL))
insurance_endorsements insurance_endorsements_term_idx CREATE INDEX insurance_endorsements_term_idx ON public.insurance_endorsements USING btree (term_id, effective_on)
insurance_coverages insurance_coverages_pkey CREATE UNIQUE INDEX insurance_coverages_pkey ON public.insurance_coverages USING btree (id)
insurance_coverages insurance_coverages_id_term_uq CREATE UNIQUE INDEX insurance_coverages_id_term_uq ON public.insurance_coverages USING btree (id, term_id)
insurance_coverages insurance_coverages_current_uq CREATE UNIQUE INDEX insurance_coverages_current_uq ON public.insurance_coverages USING btree (term_id, coverage_type) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
insurance_coverages insurance_coverages_term_idx CREATE INDEX insurance_coverages_term_idx ON public.insurance_coverages USING btree (term_id, coverage_type, effective_from)
insurance_coverages insurance_coverages_organization_idx CREATE INDEX insurance_coverages_organization_idx ON public.insurance_coverages USING btree (organization_id, coverage_type)
insurance_coverage_types insurance_coverage_types_pkey CREATE UNIQUE INDEX insurance_coverage_types_pkey ON public.insurance_coverage_types USING btree (code)
insurance_coverage_types insurance_coverage_types_sort_order_uq CREATE UNIQUE INDEX insurance_coverage_types_sort_order_uq ON public.insurance_coverage_types USING btree (sort_order)
insurance_coverage_types insurance_coverage_types_code_family_uq CREATE UNIQUE INDEX insurance_coverage_types_code_family_uq ON public.insurance_coverage_types USING btree (code, family)
insurance_broker_periods insurance_broker_periods_pkey CREATE UNIQUE INDEX insurance_broker_periods_pkey ON public.insurance_broker_periods USING btree (id)
insurance_broker_periods insurance_broker_periods_id_policy_uq CREATE UNIQUE INDEX insurance_broker_periods_id_policy_uq ON public.insurance_broker_periods USING btree (id, policy_id)
insurance_broker_periods insurance_broker_periods_current_uq CREATE UNIQUE INDEX insurance_broker_periods_current_uq ON public.insurance_broker_periods USING btree (policy_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
insurance_broker_periods insurance_broker_periods_history_idx CREATE INDEX insurance_broker_periods_history_idx ON public.insurance_broker_periods USING btree (policy_id, effective_from)
insurance_broker_periods insurance_broker_periods_broker_idx CREATE INDEX insurance_broker_periods_broker_idx ON public.insurance_broker_periods USING btree (broker_organization_id)
insurance_policies insurance_policies_pkey CREATE UNIQUE INDEX insurance_policies_pkey ON public.insurance_policies USING btree (id)
insurance_policies insurance_policies_id_organization_family_uq CREATE UNIQUE INDEX insurance_policies_id_organization_family_uq ON public.insurance_policies USING btree (id, organization_id, family)
insurance_policies insurance_policies_id_scope_uq CREATE UNIQUE INDEX insurance_policies_id_scope_uq ON public.insurance_policies USING btree (id, organization_id, insurer_organization_id, family)
insurance_policies insurance_policies_id_organization_uq CREATE UNIQUE INDEX insurance_policies_id_organization_uq ON public.insurance_policies USING btree (id, organization_id)
insurance_policies insurance_policies_organization_idx CREATE INDEX insurance_policies_organization_idx ON public.insurance_policies USING btree (organization_id, family)
insurance_policies insurance_policies_insurer_idx CREATE INDEX insurance_policies_insurer_idx ON public.insurance_policies USING btree (insurer_organization_id)
insurance_policies insurance_policies_renews_idx CREATE INDEX insurance_policies_renews_idx ON public.insurance_policies USING btree (renews_policy_id) WHERE (renews_policy_id IS NOT NULL)
insurance_policy_terms insurance_policy_terms_pkey CREATE UNIQUE INDEX insurance_policy_terms_pkey ON public.insurance_policy_terms USING btree (id)
insurance_policy_terms insurance_policy_terms_id_policy_uq CREATE UNIQUE INDEX insurance_policy_terms_id_policy_uq ON public.insurance_policy_terms USING btree (id, policy_id)
insurance_policy_terms insurance_policy_terms_id_scope_uq CREATE UNIQUE INDEX insurance_policy_terms_id_scope_uq ON public.insurance_policy_terms USING btree (id, policy_id, organization_id, family)
insurance_policy_terms insurance_policy_terms_policy_idx CREATE INDEX insurance_policy_terms_policy_idx ON public.insurance_policy_terms USING btree (policy_id, term_start)
insurance_policy_terms insurance_policy_terms_number_lookup_idx CREATE INDEX insurance_policy_terms_number_lookup_idx ON public.insurance_policy_terms USING btree (insurer_organization_id, number_normalized) WHERE (record_status = 'active'::text)
insurance_policy_terms insurance_policy_terms_organization_idx CREATE INDEX insurance_policy_terms_organization_idx ON public.insurance_policy_terms USING btree (organization_id, term_start)$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0017 indexes (exact definitions) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0017 indexes (exact definitions) (30 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_policies insurance_policies_guard_update enabled=O type=19 function=tes_security.guard_insurance_policy_update args= constraint=false deferrable=false deferred=false
insurance_policies insurance_policies_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id,insurer_organization_id, constraint=false deferrable=false deferred=false
insurance_policies insurance_policies_require_active_term enabled=O type=5 function=tes_security.require_insurance_policy_state args= constraint=true deferrable=true deferred=true
insurance_policy_terms insurance_policy_terms_guard_insert enabled=O type=7 function=tes_security.guard_insurance_term_insert args= constraint=false deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id,insurer_organization_id, constraint=false deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_guard_update enabled=O type=19 function=tes_security.guard_insurance_term_update args= constraint=false deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_require_coverage enabled=O type=5 function=tes_security.require_insurance_term_coverage args= constraint=true deferrable=true deferred=true
insurance_endorsements insurance_endorsements_guard_insert enabled=O type=7 function=tes_security.guard_insurance_endorsement_insert args= constraint=false deferrable=false deferred=false
insurance_endorsements insurance_endorsements_guard_update enabled=O type=19 function=tes_security.guard_insurance_endorsement_update args= constraint=false deferrable=false deferred=false
insurance_coverages insurance_coverages_guard_insert enabled=O type=7 function=tes_security.guard_insurance_coverage_insert args= constraint=false deferrable=false deferred=false
insurance_coverages insurance_coverages_guard_update enabled=O type=19 function=tes_security.guard_insurance_coverage_update args= constraint=false deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_guard_insert enabled=O type=7 function=tes_security.guard_insurance_broker_period_insert args= constraint=false deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id,broker_organization_id, constraint=false deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_guard_update enabled=O type=19 function=tes_security.guard_insurance_broker_period_update args= constraint=false deferrable=false deferred=false
insurance_policies insurance_policies_no_delete enabled=O type=11 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_no_delete enabled=O type=11 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_endorsements insurance_endorsements_no_delete enabled=O type=11 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_coverages insurance_coverages_no_delete enabled=O type=11 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_no_delete enabled=O type=11 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_policies insurance_policies_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_endorsements insurance_endorsements_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_coverages insurance_coverages_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_policies insurance_policies_guard_update enabled=O type=19 function=tes_security.guard_insurance_policy_update args= constraint=false deferrable=false deferred=false
insurance_policies insurance_policies_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id,insurer_organization_id, constraint=false deferrable=false deferred=false
insurance_policies insurance_policies_require_active_term enabled=O type=5 function=tes_security.require_insurance_policy_state args= constraint=true deferrable=true deferred=true
insurance_policy_terms insurance_policy_terms_guard_insert enabled=O type=7 function=tes_security.guard_insurance_term_insert args= constraint=false deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id,insurer_organization_id, constraint=false deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_guard_update enabled=O type=19 function=tes_security.guard_insurance_term_update args= constraint=false deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_require_coverage enabled=O type=5 function=tes_security.require_insurance_term_coverage args= constraint=true deferrable=true deferred=true
insurance_endorsements insurance_endorsements_guard_insert enabled=O type=7 function=tes_security.guard_insurance_endorsement_insert args= constraint=false deferrable=false deferred=false
insurance_endorsements insurance_endorsements_guard_update enabled=O type=19 function=tes_security.guard_insurance_endorsement_update args= constraint=false deferrable=false deferred=false
insurance_coverages insurance_coverages_guard_insert enabled=O type=7 function=tes_security.guard_insurance_coverage_insert args= constraint=false deferrable=false deferred=false
insurance_coverages insurance_coverages_guard_update enabled=O type=19 function=tes_security.guard_insurance_coverage_update args= constraint=false deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_guard_insert enabled=O type=7 function=tes_security.guard_insurance_broker_period_insert args= constraint=false deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id,broker_organization_id, constraint=false deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_guard_update enabled=O type=19 function=tes_security.guard_insurance_broker_period_update args= constraint=false deferrable=false deferred=false
insurance_policies insurance_policies_no_delete enabled=O type=11 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_no_delete enabled=O type=11 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_endorsements insurance_endorsements_no_delete enabled=O type=11 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_coverages insurance_coverages_no_delete enabled=O type=11 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_no_delete enabled=O type=11 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_policies insurance_policies_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_policy_terms insurance_policy_terms_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_endorsements insurance_endorsements_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_coverages insurance_coverages_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false
insurance_broker_periods insurance_broker_periods_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_data_removal args= constraint=false deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0017 triggers (enabled flag, type, function, arguments, deferral) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0017 triggers (enabled flag, type, function, arguments, deferral) (24 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$prevent_insurance_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=0fbf4313a0a5b62e2728c75b7e194787 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_policy_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=63541ddc1773cef4c901530019e10a47 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_term_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=e3daa9afd91ac6318c792b1a6270ef1d owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_term_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=85950dfd6d47d3aef5b2bd81c9536966 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_endorsement_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=96126f8a3ae2b799bd32d425b5ce7945 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_endorsement_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=e955d44dc1c334adec3e949715dadd7c owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_coverage_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=9ad2a490c9992b811b9e6c560d4914b0 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_coverage_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=6d3abf0486a8b95bd8a3615842a9d0f3 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_broker_period_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=8fe03c5c1d4de4ebb755b21a97817956 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_broker_period_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=a7aba64db4cd8a64e27e6bf075636831 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_insurance_policy_state secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=11d18db763d2132220df7e28e870efd7 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_insurance_term_coverage secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=4f3ee4044b1d144563f02a7b006cc1ce owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_insurance_data_removal','guard_insurance_policy_update','guard_insurance_term_insert','guard_insurance_term_update','guard_insurance_endorsement_insert','guard_insurance_endorsement_update','guard_insurance_coverage_insert','guard_insurance_coverage_update','guard_insurance_broker_period_insert','guard_insurance_broker_period_update','require_insurance_policy_state','require_insurance_term_coverage')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_insurance_data_removal','guard_insurance_policy_update','guard_insurance_term_insert','guard_insurance_term_update','guard_insurance_endorsement_insert','guard_insurance_endorsement_update','guard_insurance_coverage_insert','guard_insurance_coverage_update','guard_insurance_broker_period_insert','guard_insurance_broker_period_update','require_insurance_policy_state','require_insurance_term_coverage')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$prevent_insurance_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=0fbf4313a0a5b62e2728c75b7e194787 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_policy_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=63541ddc1773cef4c901530019e10a47 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_term_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=e3daa9afd91ac6318c792b1a6270ef1d owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_term_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=85950dfd6d47d3aef5b2bd81c9536966 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_endorsement_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=96126f8a3ae2b799bd32d425b5ce7945 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_endorsement_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=e955d44dc1c334adec3e949715dadd7c owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_coverage_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=9ad2a490c9992b811b9e6c560d4914b0 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_coverage_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=6d3abf0486a8b95bd8a3615842a9d0f3 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_broker_period_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=8fe03c5c1d4de4ebb755b21a97817956 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_broker_period_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=a7aba64db4cd8a64e27e6bf075636831 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_insurance_policy_state secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=11d18db763d2132220df7e28e870efd7 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_insurance_term_coverage secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=4f3ee4044b1d144563f02a7b006cc1ce owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0017 functions (fixed search_path, body checksum, SECURITY DEFINER only where designed, no PUBLIC/runtime execute) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0017 functions (fixed search_path, body checksum, SECURITY DEFINER only where designed, no PUBLIC/runtime execute) (12 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_coverage_types owner=tes-database-migrator@tes-production-510007.iam
insurance_policies owner=tes-database-migrator@tes-production-510007.iam
insurance_policy_terms owner=tes-database-migrator@tes-production-510007.iam
insurance_endorsements owner=tes-database-migrator@tes-production-510007.iam
insurance_coverages owner=tes-database-migrator@tes-production-510007.iam
insurance_broker_periods owner=tes-database-migrator@tes-production-510007.iam$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_coverage_types owner=tes-database-migrator@tes-production-510007.iam
insurance_policies owner=tes-database-migrator@tes-production-510007.iam
insurance_policy_terms owner=tes-database-migrator@tes-production-510007.iam
insurance_endorsements owner=tes-database-migrator@tes-production-510007.iam
insurance_coverages owner=tes-database-migrator@tes-production-510007.iam
insurance_broker_periods owner=tes-database-migrator@tes-production-510007.iam$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0017 table ownership differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0017 table ownership (6 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_coverage_types tes-backend@tes-production-510007.iam SELECT grantable=false
insurance_policies tes-backend@tes-production-510007.iam SELECT grantable=false
insurance_policy_terms tes-backend@tes-production-510007.iam SELECT grantable=false
insurance_endorsements tes-backend@tes-production-510007.iam SELECT grantable=false
insurance_coverages tes-backend@tes-production-510007.iam SELECT grantable=false
insurance_broker_periods tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass) AND x.grantee <> c.relowner) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass) AND x.grantee <> c.relowner) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_coverage_types tes-backend@tes-production-510007.iam SELECT grantable=false
insurance_policies tes-backend@tes-production-510007.iam SELECT grantable=false
insurance_policy_terms tes-backend@tes-production-510007.iam SELECT grantable=false
insurance_endorsements tes-backend@tes-production-510007.iam SELECT grantable=false
insurance_coverages tes-backend@tes-production-510007.iam SELECT grantable=false
insurance_broker_periods tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0017 table ACL (every non-owner grantee) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0017 table ACL (every non-owner grantee) (6 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_policies.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policies.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policies.insurer_organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policies.family tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policies.renews_policy_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policies.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policies.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policies.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.policy_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.insurer_organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.family tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.number_display tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.number_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.normalization_rule_version tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.term_start tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.term_end tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.cancelled_on tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.cancellation_reason tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.term_reason tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.superseded_by_term_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_endorsements.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.term_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.policy_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.family tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.number_display tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.number_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.endorsement_kind tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.effective_on tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_endorsements.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_endorsements.superseded_by_endorsement_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_endorsements.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.term_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.policy_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.family tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.coverage_type tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.limit_amount tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.deductible_amount tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.currency tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.limit_basis tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.scheduled_vehicles_only tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.endorsement_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.ended_by_endorsement_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.superseded_by_coverage_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_broker_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.policy_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.broker_organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.broker_relationship_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.broker_person_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_broker_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_broker_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_broker_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_broker_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_policies.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policies.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policies.insurer_organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policies.family tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policies.renews_policy_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policies.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policies.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policies.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.policy_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.insurer_organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.family tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.number_display tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.number_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.normalization_rule_version tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.term_start tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.term_end tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.cancelled_on tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.cancellation_reason tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.term_reason tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_policy_terms.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.superseded_by_term_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_policy_terms.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_endorsements.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.term_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.policy_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.family tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.number_display tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.number_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.endorsement_kind tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.effective_on tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_endorsements.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_endorsements.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_endorsements.superseded_by_endorsement_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_endorsements.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.term_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.policy_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.family tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.coverage_type tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.limit_amount tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.deductible_amount tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.currency tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.limit_basis tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.scheduled_vehicles_only tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.endorsement_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverages.ended_by_endorsement_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.superseded_by_coverage_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverages.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_broker_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.policy_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.broker_organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.broker_relationship_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.broker_person_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_broker_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_broker_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_broker_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_broker_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_broker_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0017 column ACL (every column-specific grant) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0017 column ACL (every column-specific grant) (70 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$AUTO_LIABILITY|Auto Liability|Motor carrier / commercial auto liability (limits are normally a combined single limit).|INSURANCE|true|true|10
MOTOR_TRUCK_CARGO|Motor Truck Cargo|Cargo (freight in transit) coverage.|INSURANCE|true|true|20
GENERAL_LIABILITY|General Liability|Commercial general liability.|INSURANCE|true|true|30
PHYSICAL_DAMAGE|Physical Damage|Physical damage to scheduled or owned equipment.|INSURANCE|true|true|40
UMBRELLA_EXCESS|Umbrella / Excess Liability|Umbrella or excess liability above underlying limits.|INSURANCE|true|true|50
REEFER_BREAKDOWN|Reefer Breakdown|Refrigeration unit breakdown coverage.|INSURANCE|true|true|60
WORKERS_COMPENSATION|Workers' Compensation Account|Employer account with a workers' compensation board or insurer. Coverage is statutory: no limit is recorded.|WORKERS_COMPENSATION|false|true|70
BOND_FREIGHT_BROKER|Freight Broker Surety Bond (BMC-84)|Freight broker / freight forwarder surety bond; the limit is the penal sum.|BOND|true|true|80
BOND_CUSTOMS|Customs / In-Transit Bond|Customs, in-bond or in-transit surety bond; the limit is the penal sum.|BOND|true|true|90
BOND_PERFORMANCE|Performance Bond|Performance surety bond; the limit is the penal sum.|BOND|true|true|100$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(family::text, '-') || '|' || COALESCE(limit_required::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.insurance_coverage_types) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(family::text, '-') || '|' || COALESCE(limit_required::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.insurance_coverage_types) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$AUTO_LIABILITY|Auto Liability|Motor carrier / commercial auto liability (limits are normally a combined single limit).|INSURANCE|true|true|10
MOTOR_TRUCK_CARGO|Motor Truck Cargo|Cargo (freight in transit) coverage.|INSURANCE|true|true|20
GENERAL_LIABILITY|General Liability|Commercial general liability.|INSURANCE|true|true|30
PHYSICAL_DAMAGE|Physical Damage|Physical damage to scheduled or owned equipment.|INSURANCE|true|true|40
UMBRELLA_EXCESS|Umbrella / Excess Liability|Umbrella or excess liability above underlying limits.|INSURANCE|true|true|50
REEFER_BREAKDOWN|Reefer Breakdown|Refrigeration unit breakdown coverage.|INSURANCE|true|true|60
WORKERS_COMPENSATION|Workers' Compensation Account|Employer account with a workers' compensation board or insurer. Coverage is statutory: no limit is recorded.|WORKERS_COMPENSATION|false|true|70
BOND_FREIGHT_BROKER|Freight Broker Surety Bond (BMC-84)|Freight broker / freight forwarder surety bond; the limit is the penal sum.|BOND|true|true|80
BOND_CUSTOMS|Customs / In-Transit Bond|Customs, in-bond or in-transit surety bond; the limit is the penal sum.|BOND|true|true|90
BOND_PERFORMANCE|Performance Bond|Performance surety bond; the limit is the penal sum.|BOND|true|true|100$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'insurance_coverage_types seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK insurance_coverage_types seed rows (10 entries) match the design exactly';
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

  FOREACH tbl IN ARRAY ARRAY['insurance_coverage_types','insurance_policies','insurance_policy_terms','insurance_endorsements','insurance_coverages','insurance_broker_periods'] LOOP
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

  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.insurance_coverage_types'::regclass) AND a.attnum > 0 AND NOT a.attisdropped AND (has_column_privilege(runtime_role, a.attrelid, a.attnum, 'INSERT') OR has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'runtime can write a 0017 catalogue (changed only by migrations)';
  END IF;
  IF migrator_role = runtime_role THEN RAISE EXCEPTION 'migrator and runtime identities are the same'; END IF;

  IF current_setting('tes.verify_through') < '0020' AND (
       EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass) AND (relrowsecurity OR relforcerowsecurity))
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.insurance_coverage_types'::regclass,'public.insurance_policies'::regclass,'public.insurance_policy_terms'::regclass,'public.insurance_endorsements'::regclass,'public.insurance_coverages'::regclass,'public.insurance_broker_periods'::regclass))) THEN
    RAISE EXCEPTION 'RLS or a policy exists on a 0017 table (not part of the approved design before 0020)';
  END IF;

  RAISE NOTICE 'OK 0017 runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; no PUBLIC privilege; no RLS / policy before 0020 (RLS closure of 0024 is verified by its own script)';
END
$verify$;

DO $verify$
DECLARE
  bad bigint;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF current_setting('tes.verify_expect_empty') = '1' THEN
    IF (SELECT count(*) FROM public.insurance_policies) <> 0 OR (SELECT count(*) FROM public.insurance_policy_terms) <> 0 OR (SELECT count(*) FROM public.insurance_endorsements) <> 0 OR (SELECT count(*) FROM public.insurance_coverages) <> 0 OR (SELECT count(*) FROM public.insurance_broker_periods) <> 0 THEN
      RAISE EXCEPTION 'a 0017 business table is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id
               WHERE c.code IN ('INSURANCE_READ','INSURANCE_MANAGE')) THEN
      RAISE EXCEPTION 'a 0017 capability is granted to someone (0017 grants nothing; set TES_VERIFY_EXPECT_EMPTY=0 once grants are made deliberately)';
    END IF;
  END IF;

  SELECT count(*) INTO bad FROM public.insurance_policies p
   WHERE NOT EXISTS (SELECT 1 FROM public.insurance_policy_terms t WHERE t.policy_id = p.id AND t.record_status = 'active');
  IF bad <> 0 THEN RAISE EXCEPTION '% insurance policy(ies) have no active term', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_policy_terms t
   WHERE t.record_status = 'active' AND NOT EXISTS (SELECT 1 FROM public.insurance_coverages c WHERE c.term_id = t.id AND c.record_status = 'active');
  IF bad <> 0 THEN RAISE EXCEPTION '% active insurance term(s) have no coverage', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_policy_terms a JOIN public.insurance_policy_terms b
    ON a.policy_id = b.policy_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND daterange(a.term_start, a.term_end, '[)') && daterange(b.term_start, b.term_end, '[)');
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping terms of one policy', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_policy_terms a JOIN public.insurance_policy_terms b
    ON a.insurer_organization_id = b.insurer_organization_id AND a.number_normalized = b.number_normalized
   AND a.policy_id < b.policy_id AND a.record_status = 'active' AND b.record_status = 'active';
  IF bad <> 0 THEN RAISE EXCEPTION '% policy number(s) held by more than one policy of the same insurer', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverages c JOIN public.insurance_policy_terms t ON t.id = c.term_id
   WHERE c.record_status = 'active' AND t.record_status = 'active'
     AND (c.effective_from < t.term_start OR (t.term_end IS NOT NULL AND c.effective_from >= t.term_end)
          OR (c.effective_to IS NOT NULL AND t.term_end IS NOT NULL AND c.effective_to > t.term_end));
  IF bad <> 0 THEN RAISE EXCEPTION '% coverage row(s) fall outside their term', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverages a JOIN public.insurance_coverages b
    ON a.term_id = b.term_id AND a.coverage_type = b.coverage_type AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND daterange(a.effective_from, a.effective_to, '[)') && daterange(b.effective_from, b.effective_to, '[)');
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping coverage rows of one type', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverages c JOIN public.insurance_coverage_types k ON k.code = c.coverage_type
   WHERE k.limit_required <> (c.limit_amount IS NOT NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% coverage row(s) violate their type''s limit rule', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_broker_periods a JOIN public.insurance_broker_periods b
    ON a.policy_id = b.policy_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping broker periods', bad; END IF;

  RAISE NOTICE 'OK 0017 row conditions hold (insurance_policies, insurance_policy_terms, insurance_endorsements, insurance_coverages, insurance_broker_periods counted separately in the ROWCOUNT lines)';
END
$verify$;
