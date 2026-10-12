
-- ============================================================================================================
-- Migration 0027 (0027_operational_identity_organization_access_policies.sql) - policy-only: ALTER POLICY ... USING on organizations_system, organization_person_relationships_system
-- ============================================================================================================

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$organizations organizations_customer_read cmd=r permissive=true roles=PUBLIC using=(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND ((id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) OR (EXISTS ( SELECT 1 FROM insurance_policies p WHERE ((p.organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) AND (p.insurer_organization_id = organizations.id)))) OR (EXISTS ( SELECT 1 FROM insurance_broker_periods b WHERE ((b.organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) AND (b.broker_organization_id = organizations.id)))))) check=-
organizations organizations_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ'::text, 'ORGANIZATION_CREATE'::text, 'ORGANIZATION_UPDATE'::text, 'ORGANIZATION_ARCHIVE'::text, 'CUSTOMER_ESTABLISH'::text, 'INSURANCE_READ'::text, 'INSURANCE_MANAGE'::text, 'CREDENTIAL_READ'::text, 'CREDENTIAL_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['ORGANIZATION_CREATE'::text, 'ORGANIZATION_UPDATE'::text, 'ORGANIZATION_ARCHIVE'::text, 'CUSTOMER_ESTABLISH'::text, 'INSURANCE_MANAGE'::text, 'CREDENTIAL_MANAGE'::text])
organization_person_relationships organization_person_relationships_customer cmd=r permissive=true roles=PUBLIC using=(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND (organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id())))) check=-
organization_person_relationships organization_person_relationships_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ'::text, 'CONTACT_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE'::text])$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || p.polname || ' cmd=' || p.polcmd::text || ' permissive=' || p.polpermissive || ' roles=' || CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC' ELSE (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) AS r) END || ' using=' || COALESCE(regexp_replace(pg_get_expr(p.polqual, p.polrelid), E'\\s+', ' ', 'g'), '-') || ' check=' || COALESCE(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), E'\\s+', ' ', 'g'), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polrelid IN ('public.organizations'::regclass,'public.organization_person_relationships'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || p.polname || ' cmd=' || p.polcmd::text || ' permissive=' || p.polpermissive || ' roles=' || CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC' ELSE (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) AS r) END || ' using=' || COALESCE(regexp_replace(pg_get_expr(p.polqual, p.polrelid), E'\\s+', ' ', 'g'), '-') || ' check=' || COALESCE(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), E'\\s+', ' ', 'g'), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polrelid IN ('public.organizations'::regclass,'public.organization_person_relationships'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$organizations organizations_customer_read cmd=r permissive=true roles=PUBLIC using=(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND ((id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) OR (EXISTS ( SELECT 1 FROM insurance_policies p WHERE ((p.organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) AND (p.insurer_organization_id = organizations.id)))) OR (EXISTS ( SELECT 1 FROM insurance_broker_periods b WHERE ((b.organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) AND (b.broker_organization_id = organizations.id)))))) check=-
organizations organizations_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ'::text, 'ORGANIZATION_CREATE'::text, 'ORGANIZATION_UPDATE'::text, 'ORGANIZATION_ARCHIVE'::text, 'CUSTOMER_ESTABLISH'::text, 'INSURANCE_READ'::text, 'INSURANCE_MANAGE'::text, 'CREDENTIAL_READ'::text, 'CREDENTIAL_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['ORGANIZATION_CREATE'::text, 'ORGANIZATION_UPDATE'::text, 'ORGANIZATION_ARCHIVE'::text, 'CUSTOMER_ESTABLISH'::text, 'INSURANCE_MANAGE'::text, 'CREDENTIAL_MANAGE'::text])
organization_person_relationships organization_person_relationships_customer cmd=r permissive=true roles=PUBLIC using=(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND (organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id())))) check=-
organization_person_relationships organization_person_relationships_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ'::text, 'CONTACT_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE'::text])$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0027: pre-0027 (0024) row-level security policies of organizations, organization_person_relationships (name, command, permissive, roles, USING, WITH CHECK) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0027: pre-0027 (0024) row-level security policies of organizations, organization_person_relationships (name, command, permissive, roles, USING, WITH CHECK) (4 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$organizations owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false
organization_person_relationships owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.organizations'::regclass,'public.organization_person_relationships'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.organizations'::regclass,'public.organization_person_relationships'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$organizations owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false
organization_person_relationships owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0027: RLS flags and owners of organizations, organization_person_relationships (enabled, not forced) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0027: RLS flags and owners of organizations, organization_person_relationships (enabled, not forced) (2 entries) match the design exactly';
END
$verify$;

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0027' AND filename = '0027_operational_identity_organization_access_policies.sql') THEN
    RAISE EXCEPTION 'ledger has no 0027 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records 0027_operational_identity_organization_access_policies.sql';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0027' THEN RETURN; END IF;

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
    RAISE EXCEPTION 'public relations through 0027 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK public relations through 0027 (77 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0027' THEN RETURN; END IF;

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
    RAISE EXCEPTION 'capability catalogue through 0027 (full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue through 0027 (full rows) (25 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0027' THEN RETURN; END IF;

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
    RAISE EXCEPTION 'tes_security function set through 0027 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK tes_security function set through 0027 (104 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0027' THEN RETURN; END IF;

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
    RAISE EXCEPTION 'SECURITY DEFINER function set through 0027 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK SECURITY DEFINER function set through 0027 (3 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$organizations organizations_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ'::text, 'ORGANIZATION_CREATE'::text, 'ORGANIZATION_UPDATE'::text, 'ORGANIZATION_ARCHIVE'::text, 'CUSTOMER_ESTABLISH'::text, 'INSURANCE_READ'::text, 'INSURANCE_MANAGE'::text, 'CREDENTIAL_READ'::text, 'CREDENTIAL_MANAGE'::text, 'VEHICLE_READ'::text, 'VEHICLE_MANAGE'::text, 'DRIVER_READ'::text, 'DRIVER_MANAGE'::text, 'IDENTITY_RESOLUTION_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['ORGANIZATION_CREATE'::text, 'ORGANIZATION_UPDATE'::text, 'ORGANIZATION_ARCHIVE'::text, 'CUSTOMER_ESTABLISH'::text, 'INSURANCE_MANAGE'::text, 'CREDENTIAL_MANAGE'::text])
organizations organizations_customer_read cmd=r permissive=true roles=PUBLIC using=(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND ((id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) OR (EXISTS ( SELECT 1 FROM insurance_policies p WHERE ((p.organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) AND (p.insurer_organization_id = organizations.id)))) OR (EXISTS ( SELECT 1 FROM insurance_broker_periods b WHERE ((b.organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) AND (b.broker_organization_id = organizations.id)))))) check=-
organization_person_relationships organization_person_relationships_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ'::text, 'CONTACT_MANAGE'::text, 'INSURANCE_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE'::text])
organization_person_relationships organization_person_relationships_customer cmd=r permissive=true roles=PUBLIC using=(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND (organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id())))) check=-$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || p.polname || ' cmd=' || p.polcmd::text || ' permissive=' || p.polpermissive || ' roles=' || CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC' ELSE (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) AS r) END || ' using=' || COALESCE(regexp_replace(pg_get_expr(p.polqual, p.polrelid), E'\\s+', ' ', 'g'), '-') || ' check=' || COALESCE(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), E'\\s+', ' ', 'g'), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polrelid IN ('public.organizations'::regclass,'public.organization_person_relationships'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || p.polname || ' cmd=' || p.polcmd::text || ' permissive=' || p.polpermissive || ' roles=' || CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC' ELSE (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) AS r) END || ' using=' || COALESCE(regexp_replace(pg_get_expr(p.polqual, p.polrelid), E'\\s+', ' ', 'g'), '-') || ' check=' || COALESCE(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), E'\\s+', ' ', 'g'), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polrelid IN ('public.organizations'::regclass,'public.organization_person_relationships'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$organizations organizations_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ'::text, 'ORGANIZATION_CREATE'::text, 'ORGANIZATION_UPDATE'::text, 'ORGANIZATION_ARCHIVE'::text, 'CUSTOMER_ESTABLISH'::text, 'INSURANCE_READ'::text, 'INSURANCE_MANAGE'::text, 'CREDENTIAL_READ'::text, 'CREDENTIAL_MANAGE'::text, 'VEHICLE_READ'::text, 'VEHICLE_MANAGE'::text, 'DRIVER_READ'::text, 'DRIVER_MANAGE'::text, 'IDENTITY_RESOLUTION_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['ORGANIZATION_CREATE'::text, 'ORGANIZATION_UPDATE'::text, 'ORGANIZATION_ARCHIVE'::text, 'CUSTOMER_ESTABLISH'::text, 'INSURANCE_MANAGE'::text, 'CREDENTIAL_MANAGE'::text])
organizations organizations_customer_read cmd=r permissive=true roles=PUBLIC using=(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND ((id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) OR (EXISTS ( SELECT 1 FROM insurance_policies p WHERE ((p.organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) AND (p.insurer_organization_id = organizations.id)))) OR (EXISTS ( SELECT 1 FROM insurance_broker_periods b WHERE ((b.organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id()))) AND (b.broker_organization_id = organizations.id)))))) check=-
organization_person_relationships organization_person_relationships_system cmd=* permissive=true roles=PUBLIC using=tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ'::text, 'CONTACT_MANAGE'::text, 'INSURANCE_MANAGE'::text]) check=tes_security.system_context_authorized(ARRAY['CONTACT_MANAGE'::text])
organization_person_relationships organization_person_relationships_customer cmd=r permissive=true roles=PUBLIC using=(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND (organization_id = ( SELECT customers.organization_id FROM customers WHERE (customers.id = tes_security.current_customer_id())))) check=-$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0027: row-level security policies of organizations, organization_person_relationships - the complete policy set (name, command, permissive, roles, USING, WITH CHECK) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0027: row-level security policies of organizations, organization_person_relationships - the complete policy set (name, command, permissive, roles, USING, WITH CHECK) (4 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$organizations owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false
organization_person_relationships owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.organizations'::regclass,'public.organization_person_relationships'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.organizations'::regclass,'public.organization_person_relationships'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$organizations owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false
organization_person_relationships owner=tes-database-migrator@tes-production-510007.iam rls=true forcerls=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0027: RLS flags and owners of organizations, organization_person_relationships (enabled, not forced) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0027: RLS flags and owners of organizations, organization_person_relationships (enabled, not forced) (2 entries) match the design exactly';
END
$verify$;

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT (SELECT bool_and(relrowsecurity AND NOT relforcerowsecurity) FROM pg_class WHERE oid IN ('public.organizations'::regclass,'public.organization_person_relationships'::regclass)) THEN
    RAISE EXCEPTION 'a 0027 table does not have RLS enabled (and not forced)';
  END IF;
  RAISE NOTICE 'OK 0027 policy-only: no table, function, trigger, capability or seed row of its own; RLS enabled (not forced) on organizations, organization_person_relationships';
END
$verify$;
