
-- ============================================================================================================
-- Migration 0026 (0026_vehicle_merge_ledger.sql)
-- ============================================================================================================

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public' AND c.relname IN ('vehicle_merges')) THEN
    RAISE EXCEPTION 'a 0026 table already exists before 0026';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_vehicle_merge_data_removal','guard_vehicle_merge_insert','guard_vehicle_merge_update','require_vehicle_merge_consistency')) THEN
    RAISE EXCEPTION 'a 0026 trigger function already exists before 0026';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'public.vehicles'::regclass AND tgname IN ('vehicles_require_merge_consistency')) THEN
    RAISE EXCEPTION 'a 0026 trigger on vehicles already exists before 0026';
  END IF;
  RAISE NOTICE 'OK no 0026 table, function or added trigger exists before 0026';
END
$verify$;

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE record_status = 'merged' OR merged_into_vehicle_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a vehicle is already merged before 0026; 0026 has no backfill for the merge ledger';
  END IF;
  RAISE NOTICE 'OK no vehicle is merged before 0026';
END
$verify$;

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0026' AND filename = '0026_vehicle_merge_ledger.sql') THEN
    RAISE EXCEPTION 'ledger has no 0026 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records 0026_vehicle_merge_ledger.sql';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0026' THEN RETURN; END IF;

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
insurance_coverage_vehicles
vehicle_merges$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')) AS a(l)
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
insurance_coverage_vehicles
vehicle_merges$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'public relations through 0026 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK public relations through 0026 (77 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0026' THEN RETURN; END IF;

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
    RAISE EXCEPTION 'capability catalogue through 0026 (full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue through 0026 (full rows) (25 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0026' THEN RETURN; END IF;

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
prevent_vehicle_merge_data_removal
guard_vehicle_merge_insert
guard_vehicle_merge_update
require_vehicle_merge_consistency
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
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security') AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security') AS a(l)
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
prevent_vehicle_merge_data_removal
guard_vehicle_merge_insert
guard_vehicle_merge_update
require_vehicle_merge_consistency
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
    RAISE EXCEPTION 'tes_security function set through 0026 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK tes_security function set through 0026 (104 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0026' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company
tes_security.accessible_customers_for_actor
tes_security.guard_insurance_schedule_vehicle$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company
tes_security.accessible_customers_for_actor
tes_security.guard_insurance_schedule_vehicle$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function set through 0026 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK SECURITY DEFINER function set through 0026 (3 entries) match the design exactly';
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
source_vehicle_id uuid NOT NULL default=-
target_vehicle_id uuid NOT NULL default=-
merge_reason text NOT NULL default=-
record_status text NOT NULL default='active'::text
merged_at timestamp with time zone NOT NULL default=now()
reversed_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.vehicle_merges'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.vehicle_merges'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
source_vehicle_id uuid NOT NULL default=-
target_vehicle_id uuid NOT NULL default=-
merge_reason text NOT NULL default=-
record_status text NOT NULL default='active'::text
merged_at timestamp with time zone NOT NULL default=now()
reversed_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'vehicle_merges columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK vehicle_merges columns (name, data type, nullability, default) (9 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$vehicle_merges vehicle_merges_not_self c CHECK ((source_vehicle_id <> target_vehicle_id)) deferrable=false deferred=false
vehicle_merges vehicle_merges_pkey p PRIMARY KEY (id) deferrable=false deferred=false
vehicle_merges vehicle_merges_reason_valid c CHECK ((merge_reason = ANY (ARRAY['DUPLICATE_RECORD'::text, 'IDENTIFIER_CORRECTION'::text, 'RESOLUTION_REVIEW'::text]))) deferrable=false deferred=false
vehicle_merges vehicle_merges_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'reversed'::text]))) deferrable=false deferred=false
vehicle_merges vehicle_merges_reversal_state_consistent c CHECK ((((record_status = 'active'::text) AND (reversed_at IS NULL)) OR ((record_status = 'reversed'::text) AND (reversed_at IS NOT NULL) AND (reversed_at >= merged_at)))) deferrable=false deferred=false
vehicle_merges vehicle_merges_source_vehicle_id_fkey f FOREIGN KEY (source_vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT deferrable=false deferred=false
vehicle_merges vehicle_merges_target_vehicle_id_fkey f FOREIGN KEY (target_vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.vehicle_merges'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.vehicle_merges'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$vehicle_merges vehicle_merges_not_self c CHECK ((source_vehicle_id <> target_vehicle_id)) deferrable=false deferred=false
vehicle_merges vehicle_merges_pkey p PRIMARY KEY (id) deferrable=false deferred=false
vehicle_merges vehicle_merges_reason_valid c CHECK ((merge_reason = ANY (ARRAY['DUPLICATE_RECORD'::text, 'IDENTIFIER_CORRECTION'::text, 'RESOLUTION_REVIEW'::text]))) deferrable=false deferred=false
vehicle_merges vehicle_merges_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'reversed'::text]))) deferrable=false deferred=false
vehicle_merges vehicle_merges_reversal_state_consistent c CHECK ((((record_status = 'active'::text) AND (reversed_at IS NULL)) OR ((record_status = 'reversed'::text) AND (reversed_at IS NOT NULL) AND (reversed_at >= merged_at)))) deferrable=false deferred=false
vehicle_merges vehicle_merges_source_vehicle_id_fkey f FOREIGN KEY (source_vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT deferrable=false deferred=false
vehicle_merges vehicle_merges_target_vehicle_id_fkey f FOREIGN KEY (target_vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0026 constraints (definition, deferrability) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0026 constraints (definition, deferrability) (7 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$vehicle_merges vehicle_merges_pkey CREATE UNIQUE INDEX vehicle_merges_pkey ON public.vehicle_merges USING btree (id)
vehicle_merges vehicle_merges_active_source_uq CREATE UNIQUE INDEX vehicle_merges_active_source_uq ON public.vehicle_merges USING btree (source_vehicle_id) WHERE (record_status = 'active'::text)
vehicle_merges vehicle_merges_target_idx CREATE INDEX vehicle_merges_target_idx ON public.vehicle_merges USING btree (target_vehicle_id)$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('vehicle_merges')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('vehicle_merges')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$vehicle_merges vehicle_merges_pkey CREATE UNIQUE INDEX vehicle_merges_pkey ON public.vehicle_merges USING btree (id)
vehicle_merges vehicle_merges_active_source_uq CREATE UNIQUE INDEX vehicle_merges_active_source_uq ON public.vehicle_merges USING btree (source_vehicle_id) WHERE (record_status = 'active'::text)
vehicle_merges vehicle_merges_target_idx CREATE INDEX vehicle_merges_target_idx ON public.vehicle_merges USING btree (target_vehicle_id)$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0026 indexes (exact definitions) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0026 indexes (exact definitions) (3 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$vehicle_merges vehicle_merges_guard_insert enabled=O type=7 function=tes_security.guard_vehicle_merge_insert args= constraint=false deferrable=false deferred=false
vehicle_merges vehicle_merges_guard_update enabled=O type=19 function=tes_security.guard_vehicle_merge_update args= constraint=false deferrable=false deferred=false
vehicle_merges vehicle_merges_require_consistency enabled=O type=21 function=tes_security.require_vehicle_merge_consistency args= constraint=true deferrable=true deferred=true
vehicle_merges vehicle_merges_no_delete enabled=O type=11 function=tes_security.prevent_vehicle_merge_data_removal args= constraint=false deferrable=false deferred=false
vehicle_merges vehicle_merges_no_truncate enabled=O type=34 function=tes_security.prevent_vehicle_merge_data_removal args= constraint=false deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.vehicle_merges'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.vehicle_merges'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$vehicle_merges vehicle_merges_guard_insert enabled=O type=7 function=tes_security.guard_vehicle_merge_insert args= constraint=false deferrable=false deferred=false
vehicle_merges vehicle_merges_guard_update enabled=O type=19 function=tes_security.guard_vehicle_merge_update args= constraint=false deferrable=false deferred=false
vehicle_merges vehicle_merges_require_consistency enabled=O type=21 function=tes_security.require_vehicle_merge_consistency args= constraint=true deferrable=true deferred=true
vehicle_merges vehicle_merges_no_delete enabled=O type=11 function=tes_security.prevent_vehicle_merge_data_removal args= constraint=false deferrable=false deferred=false
vehicle_merges vehicle_merges_no_truncate enabled=O type=34 function=tes_security.prevent_vehicle_merge_data_removal args= constraint=false deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0026 triggers (enabled flag, type, function, arguments, deferral) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0026 triggers (enabled flag, type, function, arguments, deferral) (5 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$vehicles vehicles_require_merge_consistency enabled=O type=21 function=tes_security.require_vehicle_merge_consistency args= constraint=true deferrable=true deferred=true$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.vehicles'::regclass) AND tgname IN ('vehicles_require_merge_consistency')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.vehicles'::regclass) AND tgname IN ('vehicles_require_merge_consistency')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$vehicles vehicles_require_merge_consistency enabled=O type=21 function=tes_security.require_vehicle_merge_consistency args= constraint=true deferrable=true deferred=true$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0026 triggers added to existing table vehicles differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0026 triggers added to existing table vehicles (1 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$prevent_vehicle_merge_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=09a79c6949b3f9ca1cf76a65d2e2b803 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_vehicle_merge_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=7d6348894d0a08630bd5a034b61e7821 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_vehicle_merge_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=cf8b0bd895fd56189a47e4571d5b27ee owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_vehicle_merge_consistency secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=71f8a5479c419430483b338c35245476 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_vehicle_merge_data_removal','guard_vehicle_merge_insert','guard_vehicle_merge_update','require_vehicle_merge_consistency')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_vehicle_merge_data_removal','guard_vehicle_merge_insert','guard_vehicle_merge_update','require_vehicle_merge_consistency')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$prevent_vehicle_merge_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=09a79c6949b3f9ca1cf76a65d2e2b803 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_vehicle_merge_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=7d6348894d0a08630bd5a034b61e7821 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_vehicle_merge_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=cf8b0bd895fd56189a47e4571d5b27ee owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_vehicle_merge_consistency secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=71f8a5479c419430483b338c35245476 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0026 functions (fixed search_path, body checksum, SECURITY DEFINER only where designed, no PUBLIC/runtime execute) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0026 functions (fixed search_path, body checksum, SECURITY DEFINER only where designed, no PUBLIC/runtime execute) (4 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$vehicle_merges owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.vehicle_merges'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.vehicle_merges'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$vehicle_merges owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0026 table ownership and RLS flags (enabled, not forced) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0026 table ownership and RLS flags (enabled, not forced) (1 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$vehicle_merges vehicle_merges_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['VEHICLE_READ'::text, 'VEHICLE_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['VEHICLE_MANAGE'::text])$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || p.polname || ' cmd=' || p.polcmd::text || ' permissive=' || p.polpermissive || ' roles=' || CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC' ELSE (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) AS r) END || ' using=' || COALESCE(regexp_replace(pg_get_expr(p.polqual, p.polrelid), E'\\s+', ' ', 'g'), '-') || ' check=' || COALESCE(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), E'\\s+', ' ', 'g'), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polrelid IN ('public.vehicle_merges'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || p.polname || ' cmd=' || p.polcmd::text || ' permissive=' || p.polpermissive || ' roles=' || CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC' ELSE (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) AS r) END || ' using=' || COALESCE(regexp_replace(pg_get_expr(p.polqual, p.polrelid), E'\\s+', ' ', 'g'), '-') || ' check=' || COALESCE(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), E'\\s+', ' ', 'g'), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polrelid IN ('public.vehicle_merges'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$vehicle_merges vehicle_merges_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['VEHICLE_READ'::text, 'VEHICLE_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['VEHICLE_MANAGE'::text])$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0026 row-level security policies (name, command, permissive, roles, USING, WITH CHECK) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0026 row-level security policies (name, command, permissive, roles, USING, WITH CHECK) (1 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$vehicle_merges tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.vehicle_merges'::regclass) AND x.grantee <> c.relowner) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.vehicle_merges'::regclass) AND x.grantee <> c.relowner) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$vehicle_merges tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0026 table ACL (every non-owner grantee) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0026 table ACL (every non-owner grantee) (1 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$vehicle_merges.id tes-backend@tes-production-510007.iam INSERT grantable=false
vehicle_merges.source_vehicle_id tes-backend@tes-production-510007.iam INSERT grantable=false
vehicle_merges.target_vehicle_id tes-backend@tes-production-510007.iam INSERT grantable=false
vehicle_merges.merge_reason tes-backend@tes-production-510007.iam INSERT grantable=false
vehicle_merges.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
vehicle_merges.reversed_at tes-backend@tes-production-510007.iam UPDATE grantable=false
vehicle_merges.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.vehicle_merges'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.vehicle_merges'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$vehicle_merges.id tes-backend@tes-production-510007.iam INSERT grantable=false
vehicle_merges.source_vehicle_id tes-backend@tes-production-510007.iam INSERT grantable=false
vehicle_merges.target_vehicle_id tes-backend@tes-production-510007.iam INSERT grantable=false
vehicle_merges.merge_reason tes-backend@tes-production-510007.iam INSERT grantable=false
vehicle_merges.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
vehicle_merges.reversed_at tes-backend@tes-production-510007.iam UPDATE grantable=false
vehicle_merges.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0026 column ACL (every column-specific grant) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0026 column ACL (every column-specific grant) (7 entries) match the design exactly';
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

  FOREACH tbl IN ARRAY ARRAY['vehicle_merges'] LOOP
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
    RAISE EXCEPTION 'runtime can write a 0026 catalogue (changed only by migrations)';
  END IF;
  IF migrator_role = runtime_role THEN RAISE EXCEPTION 'migrator and runtime identities are the same'; END IF;

  IF NOT (SELECT bool_and(relrowsecurity AND NOT relforcerowsecurity) FROM pg_class WHERE oid IN ('public.vehicle_merges'::regclass)) THEN
    RAISE EXCEPTION 'a 0026 table does not have RLS enabled (and not forced)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN ('public.vehicle_merges'::regclass) AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)) THEN
    RAISE EXCEPTION 'a 0026 table has RLS enabled but no policy';
  END IF;

  RAISE NOTICE 'OK 0026 runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; no PUBLIC privilege; RLS enabled on every table with policies (exact policy set verified separately)';
END
$verify$;

DO $verify$
DECLARE
  bad bigint;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF current_setting('tes.verify_expect_empty') = '1' THEN
    IF (SELECT count(*) FROM public.vehicle_merges) <> 0 THEN
      RAISE EXCEPTION 'a 0026 business table is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
  END IF;

  SELECT count(*) INTO bad FROM public.vehicles v
   WHERE CASE WHEN v.record_status = 'merged'
              THEN (SELECT count(*) FROM public.vehicle_merges m WHERE m.source_vehicle_id = v.id AND m.record_status = 'active') <> 1
                OR (SELECT count(*) FROM public.vehicle_merges m WHERE m.source_vehicle_id = v.id AND m.record_status = 'active'
                       AND m.target_vehicle_id = v.merged_into_vehicle_id) <> 1
              ELSE EXISTS (SELECT 1 FROM public.vehicle_merges m WHERE m.source_vehicle_id = v.id AND m.record_status = 'active')
         END;
  IF bad <> 0 THEN RAISE EXCEPTION '% vehicle(s) whose merged state and active merge-ledger row disagree', bad; END IF;

  WITH RECURSIVE walk(start_id, cur_id, path) AS (
    SELECT v.id, v.merged_into_vehicle_id, ARRAY[v.id] FROM public.vehicles v WHERE v.merged_into_vehicle_id IS NOT NULL
    UNION ALL
    SELECT w.start_id, v.merged_into_vehicle_id, w.path || v.id
      FROM walk w JOIN public.vehicles v ON v.id = w.cur_id
     WHERE v.merged_into_vehicle_id IS NOT NULL AND NOT v.id = ANY (w.path)
  )
  SELECT count(DISTINCT start_id) INTO bad FROM walk WHERE cur_id = start_id;
  IF bad <> 0 THEN RAISE EXCEPTION '% vehicle(s) on a merge cycle through merged_into_vehicle_id', bad; END IF;

  SELECT count(*) INTO bad FROM public.vehicle_merges
   WHERE (record_status = 'reversed' AND (reversed_at IS NULL OR reversed_at < merged_at)) OR (record_status = 'active' AND reversed_at IS NOT NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% merge-ledger row(s) with an inconsistent reversal (reversed_at must be set and >= merged_at only on reversed rows)', bad; END IF;

  SELECT count(*) INTO bad FROM public.vehicle_merges m JOIN public.vehicles t ON t.id = m.target_vehicle_id
   WHERE m.record_status = 'active' AND t.record_status = 'merged';
  IF bad <> 0 THEN RAISE EXCEPTION '% active merge-ledger row(s) whose survivor is itself merged away', bad; END IF;

  RAISE NOTICE 'OK 0026 row conditions hold (vehicle_merges counted separately in the ROWCOUNT lines)';
END
$verify$;
