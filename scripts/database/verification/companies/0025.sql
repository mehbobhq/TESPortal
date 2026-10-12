
-- ============================================================================================================
-- Migration 0025 (0025_insurance_scheduled_vehicles_foundation.sql)
-- ============================================================================================================

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public' AND c.relname IN ('insurance_coverage_vehicles')) THEN
    RAISE EXCEPTION 'a 0025 table already exists before 0025';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_insurance_schedule_data_removal','guard_insurance_schedule_insert','guard_insurance_schedule_vehicle','guard_insurance_schedule_update')) THEN
    RAISE EXCEPTION 'a 0025 trigger function already exists before 0025';
  END IF;
  RAISE NOTICE 'OK no 0025 table, function exists before 0025';
END
$verify$;

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0025' AND filename = '0025_insurance_scheduled_vehicles_foundation.sql') THEN
    RAISE EXCEPTION 'ledger has no 0025 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records 0025_insurance_scheduled_vehicles_foundation.sql';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0025' THEN RETURN; END IF;

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
credential_systems
credential_system_aliases
company_credentials
credential_categories
credential_status_periods
credential_verifications
credential_secret_slots
company_operating_scope_periods
company_profile_rules
company_rule_applicability_periods
company_driver_requirement_periods
organization_vehicle_relationships
vehicle_types
vehicle_registration_periods
vehicles
organization_classifications
organization_driver_relationships
driver_profiles
driver_licences
driver_medical_qualification_periods
entity_resolution_cases
entity_resolution_signals
entity_resolution_candidates
insurance_coverage_vehicles$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT IN ('vehicle_merges')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT IN ('vehicle_merges')) AS a(l)
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
credential_systems
credential_system_aliases
company_credentials
credential_categories
credential_status_periods
credential_verifications
credential_secret_slots
company_operating_scope_periods
company_profile_rules
company_rule_applicability_periods
company_driver_requirement_periods
organization_vehicle_relationships
vehicle_types
vehicle_registration_periods
vehicles
organization_classifications
organization_driver_relationships
driver_profiles
driver_licences
driver_medical_qualification_periods
entity_resolution_cases
entity_resolution_signals
entity_resolution_candidates
insurance_coverage_vehicles$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'public relations through 0025 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK public relations through 0025 (76 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0025' THEN RETURN; END IF;

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
INSURANCE_MANAGE|Manage Insurance|Create, renew, cancel, endorse, correct, archive and restore Organization insurance policies, coverages and broker-of-record assignments. Does not store certificates or evidence. Intended scope: SYSTEM only.|true|140
CREDENTIAL_READ|Read Company Credentials|SYSTEM-wide read access to company credential metadata: systems, accounts, status and verification history and secret-slot state. Never returns a secret. Intended scope: SYSTEM only.|true|150
CREDENTIAL_MANAGE|Manage Company Credentials|Maintain the canonical system registry and company credential metadata: create, replace, archive and verify credentials, record status changes and attach secret-store references. Never handles secret values. Intended scope: SYSTEM only.|true|160
COMPANY_PROFILE_READ|Read Company Operating Profile|SYSTEM-wide read access to company operating scope, rule applicability and driver requirement facts and their history. Intended scope: SYSTEM only.|true|170
COMPANY_PROFILE_MANAGE|Manage Company Operating Profile|Record, change and correct company operating scope, rule applicability and driver requirement facts. Intended scope: SYSTEM only.|true|180
VEHICLE_READ|Vehicle read|Read the canonical Vehicle registry. Intended scope: SYSTEM.|true|200
VEHICLE_MANAGE|Vehicle manage|Manage canonical Vehicle identity and Organization relationships. Intended scope: SYSTEM.|true|201
DRIVER_READ|Driver read|Read canonical Driver operational identity. Intended scope: SYSTEM.|true|202
DRIVER_MANAGE|Driver manage|Manage canonical Driver role, licence and Organization relationships. Intended scope: SYSTEM.|true|203
IDENTITY_RESOLUTION_READ|Identity resolution read|Read identity-resolution cases and provenance. Intended scope: SYSTEM.|true|204
IDENTITY_RESOLUTION_MANAGE|Identity resolution manage|Manage identity-resolution cases and provenance. Intended scope: SYSTEM.|true|205
MASTER_REGISTER_READ|Master Register read|Read the immutable Master Register. Intended scope: SYSTEM.|true|206$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities) AS a(l)
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
INSURANCE_MANAGE|Manage Insurance|Create, renew, cancel, endorse, correct, archive and restore Organization insurance policies, coverages and broker-of-record assignments. Does not store certificates or evidence. Intended scope: SYSTEM only.|true|140
CREDENTIAL_READ|Read Company Credentials|SYSTEM-wide read access to company credential metadata: systems, accounts, status and verification history and secret-slot state. Never returns a secret. Intended scope: SYSTEM only.|true|150
CREDENTIAL_MANAGE|Manage Company Credentials|Maintain the canonical system registry and company credential metadata: create, replace, archive and verify credentials, record status changes and attach secret-store references. Never handles secret values. Intended scope: SYSTEM only.|true|160
COMPANY_PROFILE_READ|Read Company Operating Profile|SYSTEM-wide read access to company operating scope, rule applicability and driver requirement facts and their history. Intended scope: SYSTEM only.|true|170
COMPANY_PROFILE_MANAGE|Manage Company Operating Profile|Record, change and correct company operating scope, rule applicability and driver requirement facts. Intended scope: SYSTEM only.|true|180
VEHICLE_READ|Vehicle read|Read the canonical Vehicle registry. Intended scope: SYSTEM.|true|200
VEHICLE_MANAGE|Vehicle manage|Manage canonical Vehicle identity and Organization relationships. Intended scope: SYSTEM.|true|201
DRIVER_READ|Driver read|Read canonical Driver operational identity. Intended scope: SYSTEM.|true|202
DRIVER_MANAGE|Driver manage|Manage canonical Driver role, licence and Organization relationships. Intended scope: SYSTEM.|true|203
IDENTITY_RESOLUTION_READ|Identity resolution read|Read identity-resolution cases and provenance. Intended scope: SYSTEM.|true|204
IDENTITY_RESOLUTION_MANAGE|Identity resolution manage|Manage identity-resolution cases and provenance. Intended scope: SYSTEM.|true|205
MASTER_REGISTER_READ|Master Register read|Read the immutable Master Register. Intended scope: SYSTEM.|true|206$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'capability catalogue through 0025 (full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue through 0025 (full rows) (25 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0025' THEN RETURN; END IF;

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
require_insurance_term_coverage
guard_company_credential_update
prevent_credential_data_removal
guard_credential_system_name
guard_credential_alias
guard_company_credential_insert
guard_credential_status_period_insert
guard_credential_secret_slot_update
guard_credential_status_period_update
require_credential_current_state
guard_credential_verification_insert
guard_credential_verification_update
guard_credential_secret_slot_insert
prevent_company_profile_data_removal
guard_company_rule_applicability_insert
guard_company_operating_scope_update
guard_company_rule_applicability_update
guard_company_driver_requirement_update
guard_vehicle_operational_insert
guard_vehicle_history_update
prevent_vehicle_identity_removal
guard_driver_operational_insert
prevent_driver_identity_removal
guard_driver_history_update
guard_entity_resolution_case_update
prevent_entity_resolution_removal
prevent_vehicle_merge_cycle
prevent_person_archive_with_driver_relationship
accessible_customers_for_actor
current_system_actor_id
current_system_capability
current_customer_actor_id
current_customer_capability
system_context_authorized
customer_context_authorized
prevent_insurance_schedule_data_removal
guard_insurance_schedule_insert
guard_insurance_schedule_vehicle
guard_insurance_schedule_update$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname NOT IN ('guard_vehicle_merge_insert','guard_vehicle_merge_update','prevent_vehicle_merge_data_removal','require_vehicle_merge_consistency')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname NOT IN ('guard_vehicle_merge_insert','guard_vehicle_merge_update','prevent_vehicle_merge_data_removal','require_vehicle_merge_consistency')) AS a(l)
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
require_insurance_term_coverage
guard_company_credential_update
prevent_credential_data_removal
guard_credential_system_name
guard_credential_alias
guard_company_credential_insert
guard_credential_status_period_insert
guard_credential_secret_slot_update
guard_credential_status_period_update
require_credential_current_state
guard_credential_verification_insert
guard_credential_verification_update
guard_credential_secret_slot_insert
prevent_company_profile_data_removal
guard_company_rule_applicability_insert
guard_company_operating_scope_update
guard_company_rule_applicability_update
guard_company_driver_requirement_update
guard_vehicle_operational_insert
guard_vehicle_history_update
prevent_vehicle_identity_removal
guard_driver_operational_insert
prevent_driver_identity_removal
guard_driver_history_update
guard_entity_resolution_case_update
prevent_entity_resolution_removal
prevent_vehicle_merge_cycle
prevent_person_archive_with_driver_relationship
accessible_customers_for_actor
current_system_actor_id
current_system_capability
current_customer_actor_id
current_customer_capability
system_context_authorized
customer_context_authorized
prevent_insurance_schedule_data_removal
guard_insurance_schedule_insert
guard_insurance_schedule_vehicle
guard_insurance_schedule_update$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'tes_security function set through 0025 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK tes_security function set through 0025 (100 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0025' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company
tes_security.accessible_customers_for_actor
tes_security.guard_insurance_schedule_vehicle$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname || '.' || pp.proname NOT IN ('tes_security.guard_vehicle_merge_insert','tes_security.guard_vehicle_merge_update','tes_security.prevent_vehicle_merge_data_removal','tes_security.require_vehicle_merge_consistency')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname || '.' || pp.proname NOT IN ('tes_security.guard_vehicle_merge_insert','tes_security.guard_vehicle_merge_update','tes_security.prevent_vehicle_merge_data_removal','tes_security.require_vehicle_merge_consistency')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company
tes_security.accessible_customers_for_actor
tes_security.guard_insurance_schedule_vehicle$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function set through 0025 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK SECURITY DEFINER function set through 0025 (3 entries) match the design exactly';
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
coverage_id uuid NOT NULL default=-
vehicle_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
schedule_reason text NOT NULL default=-
effective_from date NOT NULL default=-
effective_to date NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_schedule_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_coverage_vehicles'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.insurance_coverage_vehicles'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
coverage_id uuid NOT NULL default=-
vehicle_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
schedule_reason text NOT NULL default=-
effective_from date NOT NULL default=-
effective_to date NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_schedule_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'insurance_coverage_vehicles columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK insurance_coverage_vehicles columns (name, data type, nullability, default) (12 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles insurance_coverage_vehicles_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_schedule_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_schedule_id IS NOT NULL)))) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_coverage_id_fkey f FOREIGN KEY (coverage_id) REFERENCES insurance_coverages(id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_id_coverage_uq u UNIQUE (id, coverage_id) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_no_overlap x EXCLUDE USING gist (coverage_id WITH =, vehicle_id WITH =, daterange(effective_from, effective_to, '[)'::text) WITH &&) WHERE ((record_status = 'active'::text)) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_not_superseded_by_self c CHECK (((superseded_by_schedule_id IS NULL) OR (superseded_by_schedule_id <> id))) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_reason_valid c CHECK ((schedule_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_superseded_by_fk f FOREIGN KEY (superseded_by_schedule_id, coverage_id) REFERENCES insurance_coverage_vehicles(id, coverage_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
insurance_coverage_vehicles insurance_coverage_vehicles_vehicle_id_fkey f FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.insurance_coverage_vehicles'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.insurance_coverage_vehicles'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles insurance_coverage_vehicles_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_schedule_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_schedule_id IS NOT NULL)))) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_coverage_id_fkey f FOREIGN KEY (coverage_id) REFERENCES insurance_coverages(id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_id_coverage_uq u UNIQUE (id, coverage_id) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_no_overlap x EXCLUDE USING gist (coverage_id WITH =, vehicle_id WITH =, daterange(effective_from, effective_to, '[)'::text) WITH &&) WHERE ((record_status = 'active'::text)) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_not_superseded_by_self c CHECK (((superseded_by_schedule_id IS NULL) OR (superseded_by_schedule_id <> id))) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_pkey p PRIMARY KEY (id) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_reason_valid c CHECK ((schedule_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_superseded_by_fk f FOREIGN KEY (superseded_by_schedule_id, coverage_id) REFERENCES insurance_coverage_vehicles(id, coverage_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
insurance_coverage_vehicles insurance_coverage_vehicles_vehicle_id_fkey f FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0025 constraints (definition, deferrability) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0025 constraints (definition, deferrability) (12 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles insurance_coverage_vehicles_pkey CREATE UNIQUE INDEX insurance_coverage_vehicles_pkey ON public.insurance_coverage_vehicles USING btree (id)
insurance_coverage_vehicles insurance_coverage_vehicles_id_coverage_uq CREATE UNIQUE INDEX insurance_coverage_vehicles_id_coverage_uq ON public.insurance_coverage_vehicles USING btree (id, coverage_id)
insurance_coverage_vehicles insurance_coverage_vehicles_no_overlap CREATE INDEX insurance_coverage_vehicles_no_overlap ON public.insurance_coverage_vehicles USING gist (coverage_id, vehicle_id, daterange(effective_from, effective_to, '[)'::text)) WHERE (record_status = 'active'::text)
insurance_coverage_vehicles insurance_coverage_vehicles_vehicle_idx CREATE INDEX insurance_coverage_vehicles_vehicle_idx ON public.insurance_coverage_vehicles USING btree (vehicle_id, effective_from)
insurance_coverage_vehicles insurance_coverage_vehicles_coverage_idx CREATE INDEX insurance_coverage_vehicles_coverage_idx ON public.insurance_coverage_vehicles USING btree (coverage_id, effective_from)$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('insurance_coverage_vehicles')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('insurance_coverage_vehicles')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles insurance_coverage_vehicles_pkey CREATE UNIQUE INDEX insurance_coverage_vehicles_pkey ON public.insurance_coverage_vehicles USING btree (id)
insurance_coverage_vehicles insurance_coverage_vehicles_id_coverage_uq CREATE UNIQUE INDEX insurance_coverage_vehicles_id_coverage_uq ON public.insurance_coverage_vehicles USING btree (id, coverage_id)
insurance_coverage_vehicles insurance_coverage_vehicles_no_overlap CREATE INDEX insurance_coverage_vehicles_no_overlap ON public.insurance_coverage_vehicles USING gist (coverage_id, vehicle_id, daterange(effective_from, effective_to, '[)'::text)) WHERE (record_status = 'active'::text)
insurance_coverage_vehicles insurance_coverage_vehicles_vehicle_idx CREATE INDEX insurance_coverage_vehicles_vehicle_idx ON public.insurance_coverage_vehicles USING btree (vehicle_id, effective_from)
insurance_coverage_vehicles insurance_coverage_vehicles_coverage_idx CREATE INDEX insurance_coverage_vehicles_coverage_idx ON public.insurance_coverage_vehicles USING btree (coverage_id, effective_from)$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0025 indexes (exact definitions) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0025 indexes (exact definitions) (5 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles insurance_coverage_vehicles_guard_vehicle enabled=O type=7 function=tes_security.guard_insurance_schedule_vehicle args= constraint=false deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_guard_insert enabled=O type=7 function=tes_security.guard_insurance_schedule_insert args= constraint=false deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_guard_update enabled=O type=19 function=tes_security.guard_insurance_schedule_update args= constraint=false deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_no_delete enabled=O type=11 function=tes_security.prevent_insurance_schedule_data_removal args= constraint=false deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_schedule_data_removal args= constraint=false deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.insurance_coverage_vehicles'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.insurance_coverage_vehicles'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles insurance_coverage_vehicles_guard_vehicle enabled=O type=7 function=tes_security.guard_insurance_schedule_vehicle args= constraint=false deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_guard_insert enabled=O type=7 function=tes_security.guard_insurance_schedule_insert args= constraint=false deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_guard_update enabled=O type=19 function=tes_security.guard_insurance_schedule_update args= constraint=false deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_no_delete enabled=O type=11 function=tes_security.prevent_insurance_schedule_data_removal args= constraint=false deferrable=false deferred=false
insurance_coverage_vehicles insurance_coverage_vehicles_no_truncate enabled=O type=34 function=tes_security.prevent_insurance_schedule_data_removal args= constraint=false deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0025 triggers (enabled flag, type, function, arguments, deferral) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0025 triggers (enabled flag, type, function, arguments, deferral) (6 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$prevent_insurance_schedule_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=d2477500f9cf35977a6a5e77d8662f34 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_schedule_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=c223dc3943420d153fd9e073498e1a4d owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_schedule_vehicle secdef=true config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=f9854eca0a90b4490e221203af7953df owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_schedule_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=63dd11ec254d0cc8b04b92d0b8ffb29a owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_insurance_schedule_data_removal','guard_insurance_schedule_insert','guard_insurance_schedule_vehicle','guard_insurance_schedule_update')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_insurance_schedule_data_removal','guard_insurance_schedule_insert','guard_insurance_schedule_vehicle','guard_insurance_schedule_update')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$prevent_insurance_schedule_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=d2477500f9cf35977a6a5e77d8662f34 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_schedule_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=c223dc3943420d153fd9e073498e1a4d owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_schedule_vehicle secdef=true config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=f9854eca0a90b4490e221203af7953df owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_insurance_schedule_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=63dd11ec254d0cc8b04b92d0b8ffb29a owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0025 functions (fixed search_path, body checksum, SECURITY DEFINER only where designed, no PUBLIC/runtime execute) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0025 functions (fixed search_path, body checksum, SECURITY DEFINER only where designed, no PUBLIC/runtime execute) (4 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.insurance_coverage_vehicles'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.insurance_coverage_vehicles'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0025 table ownership and RLS flags (enabled, not forced) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0025 table ownership and RLS flags (enabled, not forced) (1 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles insurance_coverage_vehicles_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['INSURANCE_READ'::text, 'INSURANCE_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['INSURANCE_MANAGE'::text])
insurance_coverage_vehicles insurance_coverage_vehicles_customer cmd=r permissive=true roles=PUBLIC using=(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND (organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id())))) check=-$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || p.polname || ' cmd=' || p.polcmd::text || ' permissive=' || p.polpermissive || ' roles=' || CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC' ELSE (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) AS r) END || ' using=' || COALESCE(regexp_replace(pg_get_expr(p.polqual, p.polrelid), E'\\s+', ' ', 'g'), '-') || ' check=' || COALESCE(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), E'\\s+', ' ', 'g'), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polrelid IN ('public.insurance_coverage_vehicles'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || p.polname || ' cmd=' || p.polcmd::text || ' permissive=' || p.polpermissive || ' roles=' || CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC' ELSE (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) AS r) END || ' using=' || COALESCE(regexp_replace(pg_get_expr(p.polqual, p.polrelid), E'\\s+', ' ', 'g'), '-') || ' check=' || COALESCE(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), E'\\s+', ' ', 'g'), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polrelid IN ('public.insurance_coverage_vehicles'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles insurance_coverage_vehicles_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['INSURANCE_READ'::text, 'INSURANCE_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['INSURANCE_MANAGE'::text])
insurance_coverage_vehicles insurance_coverage_vehicles_customer cmd=r permissive=true roles=PUBLIC using=(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND (organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id())))) check=-$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0025 row-level security policies (name, command, permissive, roles, USING, WITH CHECK) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0025 row-level security policies (name, command, permissive, roles, USING, WITH CHECK) (2 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.insurance_coverage_vehicles'::regclass) AND x.grantee <> c.relowner) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.insurance_coverage_vehicles'::regclass) AND x.grantee <> c.relowner) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0025 table ACL (every non-owner grantee) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0025 table ACL (every non-owner grantee) (1 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.coverage_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.vehicle_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.schedule_reason tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverage_vehicles.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverage_vehicles.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverage_vehicles.superseded_by_schedule_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverage_vehicles.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.insurance_coverage_vehicles'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.insurance_coverage_vehicles'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$insurance_coverage_vehicles.id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.coverage_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.vehicle_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.schedule_reason tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
insurance_coverage_vehicles.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverage_vehicles.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverage_vehicles.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverage_vehicles.superseded_by_schedule_id tes-backend@tes-production-510007.iam UPDATE grantable=false
insurance_coverage_vehicles.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0025 column ACL (every column-specific grant) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0025 column ACL (every column-specific grant) (12 entries) match the design exactly';
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

  FOREACH tbl IN ARRAY ARRAY['insurance_coverage_vehicles'] LOOP
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

  IF false THEN
    RAISE EXCEPTION 'runtime can write a 0025 catalogue (changed only by migrations)';
  END IF;
  IF migrator_role = runtime_role THEN RAISE EXCEPTION 'migrator and runtime identities are the same'; END IF;

  IF NOT (SELECT bool_and(relrowsecurity AND NOT relforcerowsecurity) FROM pg_class WHERE oid IN ('public.insurance_coverage_vehicles'::regclass)) THEN
    RAISE EXCEPTION 'a 0025 table does not have RLS enabled (and not forced)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN ('public.insurance_coverage_vehicles'::regclass) AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)) THEN
    RAISE EXCEPTION 'a 0025 table has RLS enabled but no policy';
  END IF;

  RAISE NOTICE 'OK 0025 runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; no PUBLIC privilege; RLS enabled on every table with policies (exact policy set verified separately)';
END
$verify$;

DO $verify$
DECLARE
  bad bigint;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF current_setting('tes.verify_expect_empty') = '1' THEN
    IF (SELECT count(*) FROM public.insurance_coverage_vehicles) <> 0 THEN
      RAISE EXCEPTION 'a 0025 business table is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
  END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles s JOIN public.insurance_coverages c ON c.id = s.coverage_id
   WHERE s.record_status = 'active' AND (NOT c.scheduled_vehicles_only OR c.record_status <> 'active');
  IF bad <> 0 THEN RAISE EXCEPTION '% active schedule row(s) on a coverage that is not an active scheduled_vehicles_only coverage', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles s JOIN public.insurance_coverages c ON c.id = s.coverage_id
   WHERE s.record_status = 'active' AND s.organization_id <> c.organization_id;
  IF bad <> 0 THEN RAISE EXCEPTION '% active schedule row(s) whose Organization is not the insured Organization of the coverage', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles s JOIN public.insurance_coverages c ON c.id = s.coverage_id
    JOIN public.insurance_policy_terms t ON t.id = c.term_id
   WHERE s.record_status = 'active'
     AND (s.effective_from < c.effective_from
          OR (LEAST(c.effective_to, t.term_end, t.cancelled_on) IS NOT NULL
              AND (s.effective_from >= LEAST(c.effective_to, t.term_end, t.cancelled_on)
                   OR (s.effective_to IS NOT NULL AND s.effective_to > LEAST(c.effective_to, t.term_end, t.cancelled_on)))));
  IF bad <> 0 THEN RAISE EXCEPTION '% active schedule row(s) outside their coverage / term window', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles s
   WHERE s.record_status = 'active' AND NOT EXISTS (
     SELECT 1 FROM public.organization_vehicle_relationships r
      WHERE r.vehicle_id = s.vehicle_id AND r.organization_id = s.organization_id AND r.relationship_type = 'OPERATES'
        AND r.record_status = 'active' AND tstzrange(r.effective_from, r.effective_to, '[)') @> s.effective_from::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% active schedule row(s) for a vehicle the Organization did not operate on the first day', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles a JOIN public.insurance_coverage_vehicles b
    ON a.coverage_id = b.coverage_id AND a.vehicle_id = b.vehicle_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND daterange(a.effective_from, a.effective_to, '[)') && daterange(b.effective_from, b.effective_to, '[)');
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping active schedule windows for one vehicle on one coverage', bad; END IF;

  SELECT count(*) INTO bad FROM public.insurance_coverage_vehicles s
   WHERE s.record_status = 'corrected' AND NOT EXISTS (
     SELECT 1 FROM public.insurance_coverage_vehicles n WHERE n.id = s.superseded_by_schedule_id AND n.coverage_id = s.coverage_id);
  IF bad <> 0 THEN RAISE EXCEPTION '% corrected schedule row(s) without a successor in the same coverage', bad; END IF;

  RAISE NOTICE 'OK 0025 row conditions hold (insurance_coverage_vehicles counted separately in the ROWCOUNT lines)';
END
$verify$;
