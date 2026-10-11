
-- ============================================================================================================
-- Migration 0018 (0018_company_credentials_foundation.sql)
-- ============================================================================================================

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public' AND c.relname IN ('credential_categories','credential_systems','credential_system_aliases','company_credentials','credential_status_periods','credential_verifications','credential_secret_slots')) THEN
    RAISE EXCEPTION 'a 0018 table already exists before 0018';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_credential_data_removal','guard_credential_system_name','guard_credential_alias','guard_company_credential_insert','guard_company_credential_update','guard_credential_status_period_insert','guard_credential_status_period_update','require_credential_current_state','guard_credential_verification_insert','guard_credential_verification_update','guard_credential_secret_slot_insert','guard_credential_secret_slot_update')) THEN
    RAISE EXCEPTION 'a 0018 trigger function already exists before 0018';
  END IF;
  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code IN ('CREDENTIAL_READ','CREDENTIAL_MANAGE')) THEN
    RAISE EXCEPTION 'a 0018 capability already exists before 0018';
  END IF;
  RAISE NOTICE 'OK no 0018 table, function or capability exists before 0018';
END
$verify$;

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0018' AND filename = '0018_company_credentials_foundation.sql') THEN
    RAISE EXCEPTION 'ledger has no 0018 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records 0018_company_credentials_foundation.sql';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0018' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$organizations
organization_identifiers
organization_aliases
organization_classification_types
organization_classifications
customers
actors
authentication_identities
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
persons
person_name_versions
person_channels
organization_channels
organization_person_relationships
organization_person_titles
contact_purpose_assignments
customer_engagements
engagement_types
engagement_stage_types
product_levels
service_catalogue
engagement_end_reasons
customer_engagement_stages
customer_engagement_terminations
engagement_service_scopes
engagement_responsibility_periods
customer_agreements
customer_agreement_versions
registration_programs
registrations
registration_versions
registration_status_periods
insurance_coverage_types
insurance_policies
insurance_policy_terms
insurance_endorsements
insurance_coverages
insurance_broker_periods
credential_categories
credential_systems
credential_system_aliases
company_credentials
credential_status_periods
credential_verifications
credential_secret_slots$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT IN ('company_driver_requirement_periods','company_operating_scope_periods','company_profile_rules','company_rule_applicability_periods')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT IN ('company_driver_requirement_periods','company_operating_scope_periods','company_profile_rules','company_rule_applicability_periods')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$organizations
organization_identifiers
organization_aliases
organization_classification_types
organization_classifications
customers
actors
authentication_identities
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
persons
person_name_versions
person_channels
organization_channels
organization_person_relationships
organization_person_titles
contact_purpose_assignments
customer_engagements
engagement_types
engagement_stage_types
product_levels
service_catalogue
engagement_end_reasons
customer_engagement_stages
customer_engagement_terminations
engagement_service_scopes
engagement_responsibility_periods
customer_agreements
customer_agreement_versions
registration_programs
registrations
registration_versions
registration_status_periods
insurance_coverage_types
insurance_policies
insurance_policy_terms
insurance_endorsements
insurance_coverages
insurance_broker_periods
credential_categories
credential_systems
credential_system_aliases
company_credentials
credential_status_periods
credential_verifications
credential_secret_slots$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'public relations through 0018 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK public relations through 0018 (60 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0018' THEN RETURN; END IF;

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
CREDENTIAL_MANAGE|Manage Company Credentials|Maintain the canonical system registry and company credential metadata: create, replace, archive and verify credentials, record status changes and attach secret-store references. Never handles secret values. Intended scope: SYSTEM only.|true|160$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities WHERE code NOT IN ('COMPANY_PROFILE_MANAGE','COMPANY_PROFILE_READ')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT code || '|' || display_name || '|' || description || '|' || is_active || '|' || sort_order FROM public.capabilities WHERE code NOT IN ('COMPANY_PROFILE_MANAGE','COMPANY_PROFILE_READ')) AS a(l)
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
CREDENTIAL_MANAGE|Manage Company Credentials|Maintain the canonical system registry and company credential metadata: create, replace, archive and verify credentials, record status changes and attach secret-store references. Never handles secret values. Intended scope: SYSTEM only.|true|160$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'capability catalogue through 0018 (full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue through 0018 (full rows) (16 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0018' THEN RETURN; END IF;

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
guard_credential_secret_slot_insert$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname NOT IN ('guard_company_driver_requirement_update','guard_company_operating_scope_update','guard_company_rule_applicability_insert','guard_company_rule_applicability_update','prevent_company_profile_data_removal')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname NOT IN ('guard_company_driver_requirement_update','guard_company_operating_scope_update','guard_company_rule_applicability_insert','guard_company_rule_applicability_update','prevent_company_profile_data_removal')) AS a(l)
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
guard_credential_secret_slot_insert$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'tes_security function set through 0018 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK tes_security function set through 0018 (74 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0018' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT n.nspname || '.' || pp.proname FROM pg_proc pp JOIN pg_namespace n ON n.oid = pp.pronamespace WHERE pp.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$tes_security.resolve_legacy_company$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER function set (nothing in the Companies foundation is SECURITY DEFINER) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK SECURITY DEFINER function set (nothing in the Companies foundation is SECURITY DEFINER) (1 entries) match the design exactly';
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
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_categories'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_categories'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
display_name text NOT NULL default=-
description text NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'credential_categories columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK credential_categories columns (name, data type, nullability, default) (7 entries) match the design exactly';
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
display_name text NOT NULL default=-
display_name_normalized text NOT NULL default=-
provider_organization_id uuid NULL default=-
jurisdiction_country text NULL default=-
jurisdiction_region text NULL default=-
login_url text NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_systems'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_systems'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
display_name text NOT NULL default=-
display_name_normalized text NOT NULL default=-
provider_organization_id uuid NULL default=-
jurisdiction_country text NULL default=-
jurisdiction_region text NULL default=-
login_url text NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'credential_systems columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK credential_systems columns (name, data type, nullability, default) (11 entries) match the design exactly';
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
system_id uuid NOT NULL default=-
alias_display text NOT NULL default=-
alias_normalized text NOT NULL default=-
record_status text NOT NULL default='active'::text
retired_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_system_aliases'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_system_aliases'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
system_id uuid NOT NULL default=-
alias_display text NOT NULL default=-
alias_normalized text NOT NULL default=-
record_status text NOT NULL default='active'::text
retired_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'credential_system_aliases columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK credential_system_aliases columns (name, data type, nullability, default) (8 entries) match the design exactly';
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
system_id uuid NOT NULL default=-
category text NOT NULL default=-
username_display text NOT NULL default=-
username_normalized text NOT NULL default=-
mfa_method text NULL default=-
replaces_credential_id uuid NULL default=-
replacement_reason text NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.company_credentials'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.company_credentials'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
system_id uuid NOT NULL default=-
category text NOT NULL default=-
username_display text NOT NULL default=-
username_normalized text NOT NULL default=-
mfa_method text NULL default=-
replaces_credential_id uuid NULL default=-
replacement_reason text NULL default=-
record_status text NOT NULL default='active'::text
archived_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'company_credentials columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK company_credentials columns (name, data type, nullability, default) (13 entries) match the design exactly';
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
credential_id uuid NOT NULL default=-
credential_status text NOT NULL default=-
period_reason text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_status_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_status_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
credential_id uuid NOT NULL default=-
credential_status text NOT NULL default=-
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
    RAISE EXCEPTION 'credential_status_periods columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK credential_status_periods columns (name, data type, nullability, default) (11 entries) match the design exactly';
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
credential_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
outcome text NOT NULL default=-
method text NOT NULL default=-
verified_at timestamp with time zone NOT NULL default=-
recorded_by_actor_id uuid NOT NULL default=-
record_status text NOT NULL default='active'::text
voided_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_verifications'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_verifications'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
credential_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
outcome text NOT NULL default=-
method text NOT NULL default=-
verified_at timestamp with time zone NOT NULL default=-
recorded_by_actor_id uuid NOT NULL default=-
record_status text NOT NULL default='active'::text
voided_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'credential_verifications columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK credential_verifications columns (name, data type, nullability, default) (11 entries) match the design exactly';
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
credential_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
slot_kind text NOT NULL default=-
secret_state text NOT NULL default='UNRESOLVED'::text
secret_store text NULL default=-
secret_reference text NULL default=-
stored_at timestamp with time zone NULL default=-
retired_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_secret_slots'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.credential_secret_slots'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
credential_id uuid NOT NULL default=-
organization_id uuid NOT NULL default=-
slot_kind text NOT NULL default=-
secret_state text NOT NULL default='UNRESOLVED'::text
secret_store text NULL default=-
secret_reference text NULL default=-
stored_at timestamp with time zone NULL default=-
retired_at timestamp with time zone NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'credential_secret_slots columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK credential_secret_slots columns (name, data type, nullability, default) (11 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$credential_secret_slots credential_secret_slots_store_pair c CHECK (((secret_store IS NULL) = (secret_reference IS NULL))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_state_consistent c CHECK ((((secret_state = 'UNRESOLVED'::text) AND (secret_reference IS NULL) AND (stored_at IS NULL) AND (retired_at IS NULL)) OR ((secret_state = 'STORED'::text) AND (secret_reference IS NOT NULL) AND (stored_at IS NOT NULL) AND (retired_at IS NULL)) OR ((secret_state = 'RETIRED'::text) AND (retired_at IS NOT NULL)))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_pkey p PRIMARY KEY (id) deferrable=false deferred=false
credential_categories credential_categories_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
credential_categories credential_categories_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
credential_categories credential_categories_pkey p PRIMARY KEY (code) deferrable=false deferred=false
credential_categories credential_categories_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
credential_systems credential_systems_display_name_not_blank c CHECK (((btrim(display_name) <> ''::text) AND (display_name = btrim(display_name)))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_credential_fk f FOREIGN KEY (credential_id, organization_id) REFERENCES company_credentials(id, organization_id) ON DELETE RESTRICT deferrable=false deferred=false
credential_systems credential_systems_name_normalized_valid c CHECK (((display_name_normalized ~ '^[a-z0-9]+( [a-z0-9]+)*$'::text) AND (length(display_name_normalized) <= 120))) deferrable=false deferred=false
credential_systems credential_systems_country_valid c CHECK (((jurisdiction_country IS NULL) OR (jurisdiction_country ~ '^[A-Z]{2}$'::text))) deferrable=false deferred=false
credential_systems credential_systems_region_valid c CHECK (((jurisdiction_region IS NULL) OR ((jurisdiction_region ~ '^[A-Z0-9]{1,8}$'::text) AND (jurisdiction_country IS NOT NULL)))) deferrable=false deferred=false
credential_systems credential_systems_login_url_valid c CHECK (((login_url IS NULL) OR ((length(login_url) <= 500) AND (login_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]?#]*)?$'::text)))) deferrable=false deferred=false
credential_systems credential_systems_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
credential_systems credential_systems_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
credential_systems credential_systems_pkey p PRIMARY KEY (id) deferrable=false deferred=false
credential_systems credential_systems_name_normalized_uq u UNIQUE (display_name_normalized) deferrable=false deferred=false
credential_systems credential_systems_provider_organization_id_fkey f FOREIGN KEY (provider_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
credential_system_aliases credential_system_aliases_display_not_blank c CHECK (((btrim(alias_display) <> ''::text) AND (alias_display = btrim(alias_display)))) deferrable=false deferred=false
credential_system_aliases credential_system_aliases_normalized_valid c CHECK (((alias_normalized ~ '^[a-z0-9]+( [a-z0-9]+)*$'::text) AND (length(alias_normalized) <= 120))) deferrable=false deferred=false
credential_system_aliases credential_system_aliases_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'retired'::text]))) deferrable=false deferred=false
credential_system_aliases credential_system_aliases_retire_state_consistent c CHECK ((((record_status = 'retired'::text) AND (retired_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (retired_at IS NULL)))) deferrable=false deferred=false
credential_system_aliases credential_system_aliases_pkey p PRIMARY KEY (id) deferrable=false deferred=false
credential_system_aliases credential_system_aliases_system_id_fkey f FOREIGN KEY (system_id) REFERENCES credential_systems(id) ON DELETE RESTRICT deferrable=false deferred=false
company_credentials company_credentials_username_display_not_blank c CHECK (((btrim(username_display) <> ''::text) AND (username_display = btrim(username_display)) AND (length(username_display) <= 254))) deferrable=false deferred=false
company_credentials company_credentials_username_normalized_valid c CHECK (((btrim(username_normalized) <> ''::text) AND (username_normalized = btrim(username_normalized)) AND (username_normalized = lower(username_normalized)))) deferrable=false deferred=false
company_credentials company_credentials_mfa_method_valid c CHECK (((mfa_method IS NULL) OR (mfa_method = ANY (ARRAY['NONE'::text, 'AUTHENTICATOR_APP'::text, 'SMS'::text, 'EMAIL'::text, 'HARDWARE_KEY'::text, 'OTHER'::text])))) deferrable=false deferred=false
company_credentials company_credentials_replacement_state_consistent c CHECK (((replaces_credential_id IS NULL) = (replacement_reason IS NULL))) deferrable=false deferred=false
company_credentials company_credentials_replacement_reason_valid c CHECK (((replacement_reason IS NULL) OR (replacement_reason = ANY (ARRAY['USERNAME_CHANGED'::text, 'CORRECTION'::text])))) deferrable=false deferred=false
company_credentials company_credentials_not_replacement_of_self c CHECK (((replaces_credential_id IS NULL) OR (replaces_credential_id <> id))) deferrable=false deferred=false
company_credentials company_credentials_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
company_credentials company_credentials_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
company_credentials company_credentials_pkey p PRIMARY KEY (id) deferrable=false deferred=false
company_credentials company_credentials_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
company_credentials company_credentials_id_scope_uq u UNIQUE (id, organization_id, system_id) deferrable=false deferred=false
company_credentials company_credentials_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
company_credentials company_credentials_system_id_fkey f FOREIGN KEY (system_id) REFERENCES credential_systems(id) ON DELETE RESTRICT deferrable=false deferred=false
company_credentials company_credentials_category_fkey f FOREIGN KEY (category) REFERENCES credential_categories(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
company_credentials company_credentials_replaces_fk f FOREIGN KEY (replaces_credential_id, organization_id, system_id) REFERENCES company_credentials(id, organization_id, system_id) ON DELETE RESTRICT deferrable=false deferred=false
credential_status_periods credential_status_periods_status_valid c CHECK ((credential_status = ANY (ARRAY['ACTIVE'::text, 'NEEDS_VERIFICATION'::text, 'LOCKED'::text, 'DISABLED'::text]))) deferrable=false deferred=false
credential_status_periods credential_status_periods_reason_valid c CHECK ((period_reason = ANY (ARRAY['INITIAL'::text, 'TRANSITION'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
credential_status_periods credential_status_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
credential_status_periods credential_status_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
credential_status_periods credential_status_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
credential_status_periods credential_status_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
credential_status_periods credential_status_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
credential_status_periods credential_status_periods_id_credential_uq u UNIQUE (id, credential_id) deferrable=false deferred=false
credential_status_periods credential_status_periods_credential_id_fkey f FOREIGN KEY (credential_id) REFERENCES company_credentials(id) ON DELETE RESTRICT deferrable=false deferred=false
credential_status_periods credential_status_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, credential_id) REFERENCES credential_status_periods(id, credential_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
credential_verifications credential_verifications_outcome_valid c CHECK ((outcome = ANY (ARRAY['VERIFIED'::text, 'FAILED'::text, 'LOCKED_OUT'::text]))) deferrable=false deferred=false
credential_verifications credential_verifications_method_valid c CHECK ((method = ANY (ARRAY['MANUAL_LOGIN'::text, 'PORTAL_CHECK'::text, 'CLIENT_CONFIRMATION'::text]))) deferrable=false deferred=false
credential_verifications credential_verifications_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'voided'::text]))) deferrable=false deferred=false
credential_verifications credential_verifications_void_state_consistent c CHECK ((((record_status = 'active'::text) AND (voided_at IS NULL)) OR ((record_status = 'voided'::text) AND (voided_at IS NOT NULL)))) deferrable=false deferred=false
credential_verifications credential_verifications_pkey p PRIMARY KEY (id) deferrable=false deferred=false
credential_verifications credential_verifications_recorded_by_actor_id_fkey f FOREIGN KEY (recorded_by_actor_id) REFERENCES actors(id) ON DELETE RESTRICT deferrable=false deferred=false
credential_verifications credential_verifications_credential_fk f FOREIGN KEY (credential_id, organization_id) REFERENCES company_credentials(id, organization_id) ON DELETE RESTRICT deferrable=false deferred=false
credential_secret_slots credential_secret_slots_kind_valid c CHECK ((slot_kind = ANY (ARRAY['PASSWORD'::text, 'MFA_SECRET'::text, 'RECOVERY_EMAIL'::text, 'RECOVERY_PHONE'::text, 'RECOVERY_PIN'::text, 'BACKUP_CODES'::text, 'SECURITY_ANSWER'::text, 'OTHER_RECOVERY'::text]))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_state_valid c CHECK ((secret_state = ANY (ARRAY['UNRESOLVED'::text, 'STORED'::text, 'RETIRED'::text]))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_store_valid c CHECK (((secret_store IS NULL) OR (secret_store = 'GCP_SECRET_MANAGER'::text))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_reference_shape c CHECK (((secret_reference IS NULL) OR ((length(secret_reference) <= 400) AND (secret_reference ~ '^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/secrets/[A-Za-z0-9_-]{1,255}(/versions/([0-9]+|latest))?$'::text)))) deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$credential_secret_slots credential_secret_slots_store_pair c CHECK (((secret_store IS NULL) = (secret_reference IS NULL))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_state_consistent c CHECK ((((secret_state = 'UNRESOLVED'::text) AND (secret_reference IS NULL) AND (stored_at IS NULL) AND (retired_at IS NULL)) OR ((secret_state = 'STORED'::text) AND (secret_reference IS NOT NULL) AND (stored_at IS NOT NULL) AND (retired_at IS NULL)) OR ((secret_state = 'RETIRED'::text) AND (retired_at IS NOT NULL)))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_pkey p PRIMARY KEY (id) deferrable=false deferred=false
credential_categories credential_categories_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)) deferrable=false deferred=false
credential_categories credential_categories_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
credential_categories credential_categories_pkey p PRIMARY KEY (code) deferrable=false deferred=false
credential_categories credential_categories_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
credential_systems credential_systems_display_name_not_blank c CHECK (((btrim(display_name) <> ''::text) AND (display_name = btrim(display_name)))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_credential_fk f FOREIGN KEY (credential_id, organization_id) REFERENCES company_credentials(id, organization_id) ON DELETE RESTRICT deferrable=false deferred=false
credential_systems credential_systems_name_normalized_valid c CHECK (((display_name_normalized ~ '^[a-z0-9]+( [a-z0-9]+)*$'::text) AND (length(display_name_normalized) <= 120))) deferrable=false deferred=false
credential_systems credential_systems_country_valid c CHECK (((jurisdiction_country IS NULL) OR (jurisdiction_country ~ '^[A-Z]{2}$'::text))) deferrable=false deferred=false
credential_systems credential_systems_region_valid c CHECK (((jurisdiction_region IS NULL) OR ((jurisdiction_region ~ '^[A-Z0-9]{1,8}$'::text) AND (jurisdiction_country IS NOT NULL)))) deferrable=false deferred=false
credential_systems credential_systems_login_url_valid c CHECK (((login_url IS NULL) OR ((length(login_url) <= 500) AND (login_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]?#]*)?$'::text)))) deferrable=false deferred=false
credential_systems credential_systems_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
credential_systems credential_systems_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
credential_systems credential_systems_pkey p PRIMARY KEY (id) deferrable=false deferred=false
credential_systems credential_systems_name_normalized_uq u UNIQUE (display_name_normalized) deferrable=false deferred=false
credential_systems credential_systems_provider_organization_id_fkey f FOREIGN KEY (provider_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
credential_system_aliases credential_system_aliases_display_not_blank c CHECK (((btrim(alias_display) <> ''::text) AND (alias_display = btrim(alias_display)))) deferrable=false deferred=false
credential_system_aliases credential_system_aliases_normalized_valid c CHECK (((alias_normalized ~ '^[a-z0-9]+( [a-z0-9]+)*$'::text) AND (length(alias_normalized) <= 120))) deferrable=false deferred=false
credential_system_aliases credential_system_aliases_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'retired'::text]))) deferrable=false deferred=false
credential_system_aliases credential_system_aliases_retire_state_consistent c CHECK ((((record_status = 'retired'::text) AND (retired_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (retired_at IS NULL)))) deferrable=false deferred=false
credential_system_aliases credential_system_aliases_pkey p PRIMARY KEY (id) deferrable=false deferred=false
credential_system_aliases credential_system_aliases_system_id_fkey f FOREIGN KEY (system_id) REFERENCES credential_systems(id) ON DELETE RESTRICT deferrable=false deferred=false
company_credentials company_credentials_username_display_not_blank c CHECK (((btrim(username_display) <> ''::text) AND (username_display = btrim(username_display)) AND (length(username_display) <= 254))) deferrable=false deferred=false
company_credentials company_credentials_username_normalized_valid c CHECK (((btrim(username_normalized) <> ''::text) AND (username_normalized = btrim(username_normalized)) AND (username_normalized = lower(username_normalized)))) deferrable=false deferred=false
company_credentials company_credentials_mfa_method_valid c CHECK (((mfa_method IS NULL) OR (mfa_method = ANY (ARRAY['NONE'::text, 'AUTHENTICATOR_APP'::text, 'SMS'::text, 'EMAIL'::text, 'HARDWARE_KEY'::text, 'OTHER'::text])))) deferrable=false deferred=false
company_credentials company_credentials_replacement_state_consistent c CHECK (((replaces_credential_id IS NULL) = (replacement_reason IS NULL))) deferrable=false deferred=false
company_credentials company_credentials_replacement_reason_valid c CHECK (((replacement_reason IS NULL) OR (replacement_reason = ANY (ARRAY['USERNAME_CHANGED'::text, 'CORRECTION'::text])))) deferrable=false deferred=false
company_credentials company_credentials_not_replacement_of_self c CHECK (((replaces_credential_id IS NULL) OR (replaces_credential_id <> id))) deferrable=false deferred=false
company_credentials company_credentials_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'archived'::text]))) deferrable=false deferred=false
company_credentials company_credentials_archive_state_consistent c CHECK ((((record_status = 'archived'::text) AND (archived_at IS NOT NULL)) OR ((record_status = 'active'::text) AND (archived_at IS NULL)))) deferrable=false deferred=false
company_credentials company_credentials_pkey p PRIMARY KEY (id) deferrable=false deferred=false
company_credentials company_credentials_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
company_credentials company_credentials_id_scope_uq u UNIQUE (id, organization_id, system_id) deferrable=false deferred=false
company_credentials company_credentials_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
company_credentials company_credentials_system_id_fkey f FOREIGN KEY (system_id) REFERENCES credential_systems(id) ON DELETE RESTRICT deferrable=false deferred=false
company_credentials company_credentials_category_fkey f FOREIGN KEY (category) REFERENCES credential_categories(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
company_credentials company_credentials_replaces_fk f FOREIGN KEY (replaces_credential_id, organization_id, system_id) REFERENCES company_credentials(id, organization_id, system_id) ON DELETE RESTRICT deferrable=false deferred=false
credential_status_periods credential_status_periods_status_valid c CHECK ((credential_status = ANY (ARRAY['ACTIVE'::text, 'NEEDS_VERIFICATION'::text, 'LOCKED'::text, 'DISABLED'::text]))) deferrable=false deferred=false
credential_status_periods credential_status_periods_reason_valid c CHECK ((period_reason = ANY (ARRAY['INITIAL'::text, 'TRANSITION'::text, 'CORRECTION'::text]))) deferrable=false deferred=false
credential_status_periods credential_status_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
credential_status_periods credential_status_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
credential_status_periods credential_status_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
credential_status_periods credential_status_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
credential_status_periods credential_status_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
credential_status_periods credential_status_periods_id_credential_uq u UNIQUE (id, credential_id) deferrable=false deferred=false
credential_status_periods credential_status_periods_credential_id_fkey f FOREIGN KEY (credential_id) REFERENCES company_credentials(id) ON DELETE RESTRICT deferrable=false deferred=false
credential_status_periods credential_status_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, credential_id) REFERENCES credential_status_periods(id, credential_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
credential_verifications credential_verifications_outcome_valid c CHECK ((outcome = ANY (ARRAY['VERIFIED'::text, 'FAILED'::text, 'LOCKED_OUT'::text]))) deferrable=false deferred=false
credential_verifications credential_verifications_method_valid c CHECK ((method = ANY (ARRAY['MANUAL_LOGIN'::text, 'PORTAL_CHECK'::text, 'CLIENT_CONFIRMATION'::text]))) deferrable=false deferred=false
credential_verifications credential_verifications_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'voided'::text]))) deferrable=false deferred=false
credential_verifications credential_verifications_void_state_consistent c CHECK ((((record_status = 'active'::text) AND (voided_at IS NULL)) OR ((record_status = 'voided'::text) AND (voided_at IS NOT NULL)))) deferrable=false deferred=false
credential_verifications credential_verifications_pkey p PRIMARY KEY (id) deferrable=false deferred=false
credential_verifications credential_verifications_recorded_by_actor_id_fkey f FOREIGN KEY (recorded_by_actor_id) REFERENCES actors(id) ON DELETE RESTRICT deferrable=false deferred=false
credential_verifications credential_verifications_credential_fk f FOREIGN KEY (credential_id, organization_id) REFERENCES company_credentials(id, organization_id) ON DELETE RESTRICT deferrable=false deferred=false
credential_secret_slots credential_secret_slots_kind_valid c CHECK ((slot_kind = ANY (ARRAY['PASSWORD'::text, 'MFA_SECRET'::text, 'RECOVERY_EMAIL'::text, 'RECOVERY_PHONE'::text, 'RECOVERY_PIN'::text, 'BACKUP_CODES'::text, 'SECURITY_ANSWER'::text, 'OTHER_RECOVERY'::text]))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_state_valid c CHECK ((secret_state = ANY (ARRAY['UNRESOLVED'::text, 'STORED'::text, 'RETIRED'::text]))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_store_valid c CHECK (((secret_store IS NULL) OR (secret_store = 'GCP_SECRET_MANAGER'::text))) deferrable=false deferred=false
credential_secret_slots credential_secret_slots_reference_shape c CHECK (((secret_reference IS NULL) OR ((length(secret_reference) <= 400) AND (secret_reference ~ '^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/secrets/[A-Za-z0-9_-]{1,255}(/versions/([0-9]+|latest))?$'::text)))) deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0018 constraints (definition, deferrability) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0018 constraints (definition, deferrability) (60 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$credential_status_periods credential_status_periods_pkey CREATE UNIQUE INDEX credential_status_periods_pkey ON public.credential_status_periods USING btree (id)
credential_status_periods credential_status_periods_id_credential_uq CREATE UNIQUE INDEX credential_status_periods_id_credential_uq ON public.credential_status_periods USING btree (id, credential_id)
credential_status_periods credential_status_periods_current_uq CREATE UNIQUE INDEX credential_status_periods_current_uq ON public.credential_status_periods USING btree (credential_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
credential_status_periods credential_status_periods_history_idx CREATE INDEX credential_status_periods_history_idx ON public.credential_status_periods USING btree (credential_id, effective_from)
credential_verifications credential_verifications_pkey CREATE UNIQUE INDEX credential_verifications_pkey ON public.credential_verifications USING btree (id)
credential_verifications credential_verifications_history_idx CREATE INDEX credential_verifications_history_idx ON public.credential_verifications USING btree (credential_id, verified_at)
credential_secret_slots credential_secret_slots_pkey CREATE UNIQUE INDEX credential_secret_slots_pkey ON public.credential_secret_slots USING btree (id)
credential_secret_slots credential_secret_slots_single_live_uq CREATE UNIQUE INDEX credential_secret_slots_single_live_uq ON public.credential_secret_slots USING btree (credential_id, slot_kind) WHERE ((secret_state <> 'RETIRED'::text) AND (slot_kind = ANY (ARRAY['PASSWORD'::text, 'MFA_SECRET'::text])))
credential_secret_slots credential_secret_slots_credential_idx CREATE INDEX credential_secret_slots_credential_idx ON public.credential_secret_slots USING btree (credential_id, slot_kind)
credential_categories credential_categories_pkey CREATE UNIQUE INDEX credential_categories_pkey ON public.credential_categories USING btree (code)
credential_categories credential_categories_sort_order_uq CREATE UNIQUE INDEX credential_categories_sort_order_uq ON public.credential_categories USING btree (sort_order)
credential_systems credential_systems_pkey CREATE UNIQUE INDEX credential_systems_pkey ON public.credential_systems USING btree (id)
credential_systems credential_systems_name_normalized_uq CREATE UNIQUE INDEX credential_systems_name_normalized_uq ON public.credential_systems USING btree (display_name_normalized)
credential_systems credential_systems_provider_idx CREATE INDEX credential_systems_provider_idx ON public.credential_systems USING btree (provider_organization_id) WHERE (provider_organization_id IS NOT NULL)
credential_system_aliases credential_system_aliases_pkey CREATE UNIQUE INDEX credential_system_aliases_pkey ON public.credential_system_aliases USING btree (id)
credential_system_aliases credential_system_aliases_active_uq CREATE UNIQUE INDEX credential_system_aliases_active_uq ON public.credential_system_aliases USING btree (alias_normalized) WHERE (record_status = 'active'::text)
credential_system_aliases credential_system_aliases_system_idx CREATE INDEX credential_system_aliases_system_idx ON public.credential_system_aliases USING btree (system_id)
company_credentials company_credentials_pkey CREATE UNIQUE INDEX company_credentials_pkey ON public.company_credentials USING btree (id)
company_credentials company_credentials_id_organization_uq CREATE UNIQUE INDEX company_credentials_id_organization_uq ON public.company_credentials USING btree (id, organization_id)
company_credentials company_credentials_id_scope_uq CREATE UNIQUE INDEX company_credentials_id_scope_uq ON public.company_credentials USING btree (id, organization_id, system_id)
company_credentials company_credentials_active_account_uq CREATE UNIQUE INDEX company_credentials_active_account_uq ON public.company_credentials USING btree (organization_id, system_id, username_normalized) WHERE (record_status = 'active'::text)
company_credentials company_credentials_organization_idx CREATE INDEX company_credentials_organization_idx ON public.company_credentials USING btree (organization_id, category)
company_credentials company_credentials_system_idx CREATE INDEX company_credentials_system_idx ON public.company_credentials USING btree (system_id)$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('credential_categories','credential_systems','credential_system_aliases','company_credentials','credential_status_periods','credential_verifications','credential_secret_slots')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('credential_categories','credential_systems','credential_system_aliases','company_credentials','credential_status_periods','credential_verifications','credential_secret_slots')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$credential_status_periods credential_status_periods_pkey CREATE UNIQUE INDEX credential_status_periods_pkey ON public.credential_status_periods USING btree (id)
credential_status_periods credential_status_periods_id_credential_uq CREATE UNIQUE INDEX credential_status_periods_id_credential_uq ON public.credential_status_periods USING btree (id, credential_id)
credential_status_periods credential_status_periods_current_uq CREATE UNIQUE INDEX credential_status_periods_current_uq ON public.credential_status_periods USING btree (credential_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
credential_status_periods credential_status_periods_history_idx CREATE INDEX credential_status_periods_history_idx ON public.credential_status_periods USING btree (credential_id, effective_from)
credential_verifications credential_verifications_pkey CREATE UNIQUE INDEX credential_verifications_pkey ON public.credential_verifications USING btree (id)
credential_verifications credential_verifications_history_idx CREATE INDEX credential_verifications_history_idx ON public.credential_verifications USING btree (credential_id, verified_at)
credential_secret_slots credential_secret_slots_pkey CREATE UNIQUE INDEX credential_secret_slots_pkey ON public.credential_secret_slots USING btree (id)
credential_secret_slots credential_secret_slots_single_live_uq CREATE UNIQUE INDEX credential_secret_slots_single_live_uq ON public.credential_secret_slots USING btree (credential_id, slot_kind) WHERE ((secret_state <> 'RETIRED'::text) AND (slot_kind = ANY (ARRAY['PASSWORD'::text, 'MFA_SECRET'::text])))
credential_secret_slots credential_secret_slots_credential_idx CREATE INDEX credential_secret_slots_credential_idx ON public.credential_secret_slots USING btree (credential_id, slot_kind)
credential_categories credential_categories_pkey CREATE UNIQUE INDEX credential_categories_pkey ON public.credential_categories USING btree (code)
credential_categories credential_categories_sort_order_uq CREATE UNIQUE INDEX credential_categories_sort_order_uq ON public.credential_categories USING btree (sort_order)
credential_systems credential_systems_pkey CREATE UNIQUE INDEX credential_systems_pkey ON public.credential_systems USING btree (id)
credential_systems credential_systems_name_normalized_uq CREATE UNIQUE INDEX credential_systems_name_normalized_uq ON public.credential_systems USING btree (display_name_normalized)
credential_systems credential_systems_provider_idx CREATE INDEX credential_systems_provider_idx ON public.credential_systems USING btree (provider_organization_id) WHERE (provider_organization_id IS NOT NULL)
credential_system_aliases credential_system_aliases_pkey CREATE UNIQUE INDEX credential_system_aliases_pkey ON public.credential_system_aliases USING btree (id)
credential_system_aliases credential_system_aliases_active_uq CREATE UNIQUE INDEX credential_system_aliases_active_uq ON public.credential_system_aliases USING btree (alias_normalized) WHERE (record_status = 'active'::text)
credential_system_aliases credential_system_aliases_system_idx CREATE INDEX credential_system_aliases_system_idx ON public.credential_system_aliases USING btree (system_id)
company_credentials company_credentials_pkey CREATE UNIQUE INDEX company_credentials_pkey ON public.company_credentials USING btree (id)
company_credentials company_credentials_id_organization_uq CREATE UNIQUE INDEX company_credentials_id_organization_uq ON public.company_credentials USING btree (id, organization_id)
company_credentials company_credentials_id_scope_uq CREATE UNIQUE INDEX company_credentials_id_scope_uq ON public.company_credentials USING btree (id, organization_id, system_id)
company_credentials company_credentials_active_account_uq CREATE UNIQUE INDEX company_credentials_active_account_uq ON public.company_credentials USING btree (organization_id, system_id, username_normalized) WHERE (record_status = 'active'::text)
company_credentials company_credentials_organization_idx CREATE INDEX company_credentials_organization_idx ON public.company_credentials USING btree (organization_id, category)
company_credentials company_credentials_system_idx CREATE INDEX company_credentials_system_idx ON public.company_credentials USING btree (system_id)$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0018 indexes (exact definitions) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0018 indexes (exact definitions) (23 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$credential_systems credential_systems_guard_name enabled=O type=23 function=tes_security.guard_credential_system_name args= constraint=false deferrable=false deferred=false
credential_systems credential_systems_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=provider_organization_id, constraint=false deferrable=false deferred=false
credential_system_aliases credential_system_aliases_guard enabled=O type=23 function=tes_security.guard_credential_alias args= constraint=false deferrable=false deferred=false
company_credentials company_credentials_guard_insert enabled=O type=7 function=tes_security.guard_company_credential_insert args= constraint=false deferrable=false deferred=false
company_credentials company_credentials_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
company_credentials company_credentials_guard_update enabled=O type=19 function=tes_security.guard_company_credential_update args= constraint=false deferrable=false deferred=false
company_credentials company_credentials_require_current_state enabled=O type=5 function=tes_security.require_credential_current_state args= constraint=true deferrable=true deferred=true
credential_status_periods credential_status_periods_guard_insert enabled=O type=7 function=tes_security.guard_credential_status_period_insert args= constraint=false deferrable=false deferred=false
credential_status_periods credential_status_periods_guard_update enabled=O type=19 function=tes_security.guard_credential_status_period_update args= constraint=false deferrable=false deferred=false
credential_verifications credential_verifications_guard_insert enabled=O type=7 function=tes_security.guard_credential_verification_insert args= constraint=false deferrable=false deferred=false
credential_verifications credential_verifications_guard_update enabled=O type=19 function=tes_security.guard_credential_verification_update args= constraint=false deferrable=false deferred=false
credential_secret_slots credential_secret_slots_guard_insert enabled=O type=7 function=tes_security.guard_credential_secret_slot_insert args= constraint=false deferrable=false deferred=false
credential_secret_slots credential_secret_slots_guard_update enabled=O type=19 function=tes_security.guard_credential_secret_slot_update args= constraint=false deferrable=false deferred=false
credential_systems credential_systems_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_system_aliases credential_system_aliases_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
company_credentials company_credentials_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_status_periods credential_status_periods_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_verifications credential_verifications_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_secret_slots credential_secret_slots_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_systems credential_systems_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_system_aliases credential_system_aliases_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
company_credentials company_credentials_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_status_periods credential_status_periods_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_verifications credential_verifications_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_secret_slots credential_secret_slots_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$credential_systems credential_systems_guard_name enabled=O type=23 function=tes_security.guard_credential_system_name args= constraint=false deferrable=false deferred=false
credential_systems credential_systems_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=provider_organization_id, constraint=false deferrable=false deferred=false
credential_system_aliases credential_system_aliases_guard enabled=O type=23 function=tes_security.guard_credential_alias args= constraint=false deferrable=false deferred=false
company_credentials company_credentials_guard_insert enabled=O type=7 function=tes_security.guard_company_credential_insert args= constraint=false deferrable=false deferred=false
company_credentials company_credentials_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
company_credentials company_credentials_guard_update enabled=O type=19 function=tes_security.guard_company_credential_update args= constraint=false deferrable=false deferred=false
company_credentials company_credentials_require_current_state enabled=O type=5 function=tes_security.require_credential_current_state args= constraint=true deferrable=true deferred=true
credential_status_periods credential_status_periods_guard_insert enabled=O type=7 function=tes_security.guard_credential_status_period_insert args= constraint=false deferrable=false deferred=false
credential_status_periods credential_status_periods_guard_update enabled=O type=19 function=tes_security.guard_credential_status_period_update args= constraint=false deferrable=false deferred=false
credential_verifications credential_verifications_guard_insert enabled=O type=7 function=tes_security.guard_credential_verification_insert args= constraint=false deferrable=false deferred=false
credential_verifications credential_verifications_guard_update enabled=O type=19 function=tes_security.guard_credential_verification_update args= constraint=false deferrable=false deferred=false
credential_secret_slots credential_secret_slots_guard_insert enabled=O type=7 function=tes_security.guard_credential_secret_slot_insert args= constraint=false deferrable=false deferred=false
credential_secret_slots credential_secret_slots_guard_update enabled=O type=19 function=tes_security.guard_credential_secret_slot_update args= constraint=false deferrable=false deferred=false
credential_systems credential_systems_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_system_aliases credential_system_aliases_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
company_credentials company_credentials_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_status_periods credential_status_periods_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_verifications credential_verifications_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_secret_slots credential_secret_slots_no_delete enabled=O type=11 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_systems credential_systems_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_system_aliases credential_system_aliases_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
company_credentials company_credentials_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_status_periods credential_status_periods_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_verifications credential_verifications_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false
credential_secret_slots credential_secret_slots_no_truncate enabled=O type=34 function=tes_security.prevent_credential_data_removal args= constraint=false deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0018 triggers (enabled flag, type, function, arguments, deferral) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0018 triggers (enabled flag, type, function, arguments, deferral) (25 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$guard_company_credential_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=2af8debcfdfa807be129b2de14b0065b owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_secret_slot_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=73fe0f5baecff14588762950c4925213 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
prevent_credential_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=c587728b0d38341cd4c417a2de502de4 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_system_name secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=f6e23ef646feb64ae231536190d4b3fe owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_alias secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=be4ce125921c120a0841313ce788a817 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_company_credential_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=e1cd08a3bf84b306937a13a320f22331 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_status_period_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=fad0f31398f6a343005d0750d60b2d20 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_status_period_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=3dd030a2622123cbf08dd55a2bbb8b24 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_credential_current_state secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=1336d6e956884f06218b95281a296bed owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_verification_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=1f23c3d93694fe08afa5bab23375819c owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_verification_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=56ace16fc3d188c4d331579e83649b25 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_secret_slot_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=98432c7e618897b143ffdba599164a0e owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_credential_data_removal','guard_credential_system_name','guard_credential_alias','guard_company_credential_insert','guard_company_credential_update','guard_credential_status_period_insert','guard_credential_status_period_update','require_credential_current_state','guard_credential_verification_insert','guard_credential_verification_update','guard_credential_secret_slot_insert','guard_credential_secret_slot_update')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_credential_data_removal','guard_credential_system_name','guard_credential_alias','guard_company_credential_insert','guard_company_credential_update','guard_credential_status_period_insert','guard_credential_status_period_update','require_credential_current_state','guard_credential_verification_insert','guard_credential_verification_update','guard_credential_secret_slot_insert','guard_credential_secret_slot_update')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$guard_company_credential_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=2af8debcfdfa807be129b2de14b0065b owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_secret_slot_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=73fe0f5baecff14588762950c4925213 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
prevent_credential_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=c587728b0d38341cd4c417a2de502de4 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_system_name secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=f6e23ef646feb64ae231536190d4b3fe owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_alias secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=be4ce125921c120a0841313ce788a817 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_company_credential_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=e1cd08a3bf84b306937a13a320f22331 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_status_period_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=fad0f31398f6a343005d0750d60b2d20 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_status_period_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=3dd030a2622123cbf08dd55a2bbb8b24 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
require_credential_current_state secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=1336d6e956884f06218b95281a296bed owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_verification_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=1f23c3d93694fe08afa5bab23375819c owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_verification_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=56ace16fc3d188c4d331579e83649b25 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_credential_secret_slot_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=98432c7e618897b143ffdba599164a0e owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0018 trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0018 trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute) (12 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$credential_categories owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
credential_systems owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
credential_system_aliases owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
company_credentials owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
credential_status_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
credential_verifications owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
credential_secret_slots owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$credential_categories owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
credential_systems owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
credential_system_aliases owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
company_credentials owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
credential_status_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
credential_verifications owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
credential_secret_slots owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0018 table ownership and RLS flags differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0018 table ownership and RLS flags (7 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$credential_categories tes-backend@tes-production-510007.iam SELECT grantable=false
credential_systems tes-backend@tes-production-510007.iam SELECT grantable=false
credential_system_aliases tes-backend@tes-production-510007.iam SELECT grantable=false
company_credentials tes-backend@tes-production-510007.iam SELECT grantable=false
credential_status_periods tes-backend@tes-production-510007.iam SELECT grantable=false
credential_verifications tes-backend@tes-production-510007.iam SELECT grantable=false
credential_secret_slots tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass) AND x.grantee <> c.relowner) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass) AND x.grantee <> c.relowner) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$credential_categories tes-backend@tes-production-510007.iam SELECT grantable=false
credential_systems tes-backend@tes-production-510007.iam SELECT grantable=false
credential_system_aliases tes-backend@tes-production-510007.iam SELECT grantable=false
company_credentials tes-backend@tes-production-510007.iam SELECT grantable=false
credential_status_periods tes-backend@tes-production-510007.iam SELECT grantable=false
credential_verifications tes-backend@tes-production-510007.iam SELECT grantable=false
credential_secret_slots tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0018 table ACL (every non-owner grantee) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0018 table ACL (every non-owner grantee) (7 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$credential_systems.id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.display_name tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.display_name tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.display_name_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.display_name_normalized tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.provider_organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.provider_organization_id tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.jurisdiction_country tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.jurisdiction_country tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.jurisdiction_region tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.jurisdiction_region tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.login_url tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.login_url tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_system_aliases.id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_system_aliases.system_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_system_aliases.alias_display tes-backend@tes-production-510007.iam INSERT grantable=false
credential_system_aliases.alias_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
credential_system_aliases.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_system_aliases.retired_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_system_aliases.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_credentials.id tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.system_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.category tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.category tes-backend@tes-production-510007.iam UPDATE grantable=false
company_credentials.username_display tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.username_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.mfa_method tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.mfa_method tes-backend@tes-production-510007.iam UPDATE grantable=false
company_credentials.replaces_credential_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.replacement_reason tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
company_credentials.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_credentials.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_status_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_status_periods.credential_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_status_periods.credential_status tes-backend@tes-production-510007.iam INSERT grantable=false
credential_status_periods.period_reason tes-backend@tes-production-510007.iam INSERT grantable=false
credential_status_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
credential_status_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_status_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_status_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_status_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_status_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_verifications.id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.credential_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.outcome tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.method tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.verified_at tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.recorded_by_actor_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_verifications.voided_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_verifications.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_secret_slots.credential_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_secret_slots.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_secret_slots.slot_kind tes-backend@tes-production-510007.iam INSERT grantable=false
credential_secret_slots.secret_state tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.secret_store tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.secret_reference tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.stored_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.retired_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$credential_systems.id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.display_name tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.display_name tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.display_name_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.display_name_normalized tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.provider_organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.provider_organization_id tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.jurisdiction_country tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.jurisdiction_country tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.jurisdiction_region tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.jurisdiction_region tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.login_url tes-backend@tes-production-510007.iam INSERT grantable=false
credential_systems.login_url tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_systems.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_system_aliases.id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_system_aliases.system_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_system_aliases.alias_display tes-backend@tes-production-510007.iam INSERT grantable=false
credential_system_aliases.alias_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
credential_system_aliases.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_system_aliases.retired_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_system_aliases.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_credentials.id tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.system_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.category tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.category tes-backend@tes-production-510007.iam UPDATE grantable=false
company_credentials.username_display tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.username_normalized tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.mfa_method tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.mfa_method tes-backend@tes-production-510007.iam UPDATE grantable=false
company_credentials.replaces_credential_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.replacement_reason tes-backend@tes-production-510007.iam INSERT grantable=false
company_credentials.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
company_credentials.archived_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_credentials.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_status_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_status_periods.credential_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_status_periods.credential_status tes-backend@tes-production-510007.iam INSERT grantable=false
credential_status_periods.period_reason tes-backend@tes-production-510007.iam INSERT grantable=false
credential_status_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
credential_status_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_status_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_status_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_status_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_status_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_verifications.id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.credential_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.outcome tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.method tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.verified_at tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.recorded_by_actor_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_verifications.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_verifications.voided_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_verifications.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_secret_slots.credential_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_secret_slots.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
credential_secret_slots.slot_kind tes-backend@tes-production-510007.iam INSERT grantable=false
credential_secret_slots.secret_state tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.secret_store tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.secret_reference tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.stored_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.retired_at tes-backend@tes-production-510007.iam UPDATE grantable=false
credential_secret_slots.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0018 column ACL (every column-specific grant) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0018 column ACL (every column-specific grant) (67 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$FLEET|Fleet|Fleet management, telematics and ELD systems.|true|10
COMPLIANCE|Compliance|Regulatory compliance and safety systems.|true|20
REGISTRATION|Registration|Registration, licensing and permit systems.|true|30
INSURANCE|Insurance|Insurer, broker and workers' compensation portals.|true|40
ACCOUNTING|Accounting|Accounting, payroll and banking systems.|true|50
FUEL|Fuel|Fuel card and fuel-tax systems.|true|60
OTHER|Other|Systems that fit no other category.|true|70$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.credential_categories) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(description::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.credential_categories) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$FLEET|Fleet|Fleet management, telematics and ELD systems.|true|10
COMPLIANCE|Compliance|Regulatory compliance and safety systems.|true|20
REGISTRATION|Registration|Registration, licensing and permit systems.|true|30
INSURANCE|Insurance|Insurer, broker and workers' compensation portals.|true|40
ACCOUNTING|Accounting|Accounting, payroll and banking systems.|true|50
FUEL|Fuel|Fuel card and fuel-tax systems.|true|60
OTHER|Other|Systems that fit no other category.|true|70$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'credential_categories seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK credential_categories seed rows (7 entries) match the design exactly';
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

  FOREACH tbl IN ARRAY ARRAY['credential_categories','credential_systems','credential_system_aliases','company_credentials','credential_status_periods','credential_verifications','credential_secret_slots'] LOOP
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

  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.credential_categories'::regclass) AND a.attnum > 0 AND NOT a.attisdropped AND (has_column_privilege(runtime_role, a.attrelid, a.attnum, 'INSERT') OR has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'runtime can write a 0018 catalogue (changed only by migrations)';
  END IF;
  IF migrator_role = runtime_role THEN RAISE EXCEPTION 'migrator and runtime identities are the same'; END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass) AND (relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.credential_categories'::regclass,'public.credential_systems'::regclass,'public.credential_system_aliases'::regclass,'public.company_credentials'::regclass,'public.credential_status_periods'::regclass,'public.credential_verifications'::regclass,'public.credential_secret_slots'::regclass)) THEN
    RAISE EXCEPTION 'RLS or a policy exists on a 0018 table (not part of the approved design)';
  END IF;

  RAISE NOTICE 'OK 0018 runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; no PUBLIC privilege; no RLS / policy';
END
$verify$;

DO $verify$
DECLARE
  bad bigint;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF current_setting('tes.verify_expect_empty') = '1' THEN
    IF (SELECT count(*) FROM public.credential_systems) <> 0 OR (SELECT count(*) FROM public.credential_system_aliases) <> 0 OR (SELECT count(*) FROM public.company_credentials) <> 0 OR (SELECT count(*) FROM public.credential_status_periods) <> 0 OR (SELECT count(*) FROM public.credential_verifications) <> 0 OR (SELECT count(*) FROM public.credential_secret_slots) <> 0 THEN
      RAISE EXCEPTION 'a 0018 business table is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id
               WHERE c.code IN ('CREDENTIAL_READ','CREDENTIAL_MANAGE')) THEN
      RAISE EXCEPTION 'a 0018 capability is granted to someone (0018 grants nothing; set TES_VERIFY_EXPECT_EMPTY=0 once grants are made deliberately)';
    END IF;
  END IF;

  SELECT count(*) INTO bad FROM public.company_credentials c
   WHERE (SELECT count(*) FROM public.credential_status_periods p WHERE p.credential_id = c.id AND p.record_status = 'active' AND p.effective_to IS NULL) <> 1;
  IF bad <> 0 THEN RAISE EXCEPTION '% credential(s) do not have exactly one current status period', bad; END IF;

  SELECT count(*) INTO bad FROM public.credential_status_periods a JOIN public.credential_status_periods b
    ON a.credential_id = b.credential_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping credential status periods', bad; END IF;

  SELECT count(*) INTO bad FROM public.credential_system_aliases a JOIN public.credential_systems s
    ON s.display_name_normalized = a.alias_normalized AND s.id <> a.system_id WHERE a.record_status = 'active';
  IF bad <> 0 THEN RAISE EXCEPTION '% alias(es) equal another system''s canonical name', bad; END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.company_credentials WHERE record_status = 'active'
    GROUP BY organization_id, system_id, username_normalized HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% duplicate active credential account(s)', bad; END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.credential_secret_slots WHERE secret_state <> 'RETIRED' AND slot_kind IN ('PASSWORD','MFA_SECRET')
    GROUP BY credential_id, slot_kind HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% credential(s) with more than one live PASSWORD / MFA_SECRET slot', bad; END IF;

  SELECT count(*) INTO bad FROM public.credential_secret_slots
   WHERE (secret_state = 'UNRESOLVED' AND secret_reference IS NOT NULL) OR (secret_state = 'STORED' AND secret_reference IS NULL);
  IF bad <> 0 THEN RAISE EXCEPTION '% secret slot(s) whose state and reference disagree', bad; END IF;

  RAISE NOTICE 'OK 0018 row conditions hold (credential_systems, credential_system_aliases, company_credentials, credential_status_periods, credential_verifications, credential_secret_slots counted separately in the ROWCOUNT lines)';
END
$verify$;
