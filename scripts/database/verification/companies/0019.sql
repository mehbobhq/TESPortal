
-- ============================================================================================================
-- Migration 0019 (0019_company_operating_profile_foundation.sql)
-- ============================================================================================================

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'pre' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public' AND c.relname IN ('company_profile_rules','company_operating_scope_periods','company_rule_applicability_periods','company_driver_requirement_periods')) THEN
    RAISE EXCEPTION 'a 0019 table already exists before 0019';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_company_profile_data_removal','guard_company_rule_applicability_insert','guard_company_operating_scope_update','guard_company_rule_applicability_update','guard_company_driver_requirement_update')) THEN
    RAISE EXCEPTION 'a 0019 trigger function already exists before 0019';
  END IF;
  IF EXISTS (SELECT 1 FROM public.capabilities WHERE code IN ('COMPANY_PROFILE_READ','COMPANY_PROFILE_MANAGE')) THEN
    RAISE EXCEPTION 'a 0019 capability already exists before 0019';
  END IF;
  RAISE NOTICE 'OK no 0019 table, function or capability exists before 0019';
END
$verify$;

DO $verify$
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tes_system.schema_migrations WHERE version = '0019' AND filename = '0019_company_operating_profile_foundation.sql') THEN
    RAISE EXCEPTION 'ledger has no 0019 entry with the expected filename';
  END IF;
  RAISE NOTICE 'OK ledger records 0019_company_operating_profile_foundation.sql';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0019' THEN RETURN; END IF;

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
credential_secret_slots
company_profile_rules
company_operating_scope_periods
company_rule_applicability_periods
company_driver_requirement_periods$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')) AS a(l)
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
credential_secret_slots
company_profile_rules
company_operating_scope_periods
company_rule_applicability_periods
company_driver_requirement_periods$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'public relations through 0019 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK public relations through 0019 (64 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0019' THEN RETURN; END IF;

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
COMPANY_PROFILE_MANAGE|Manage Company Operating Profile|Record, change and correct company operating scope, rule applicability and driver requirement facts. Intended scope: SYSTEM only.|true|180$exp$, E'\n')) AS l
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
COMPANY_PROFILE_MANAGE|Manage Company Operating Profile|Record, change and correct company operating scope, rule applicability and driver requirement facts. Intended scope: SYSTEM only.|true|180$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'capability catalogue through 0019 (full rows) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK capability catalogue through 0019 (full rows) (18 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0019' THEN RETURN; END IF;

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
guard_company_driver_requirement_update$exp$, E'\n')) AS l
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
guard_company_driver_requirement_update$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'tes_security function set through 0019 differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK tes_security function set through 0019 (79 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;
  IF current_setting('tes.verify_through') <> '0019' THEN RETURN; END IF;

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
section text NOT NULL default=-
display_name text NOT NULL default=-
applies_to_region text NOT NULL default=-
default_applicability text NULL default=-
registration_program_code text NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.company_profile_rules'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.company_profile_rules'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$code text NOT NULL default=-
section text NOT NULL default=-
display_name text NOT NULL default=-
applies_to_region text NOT NULL default=-
default_applicability text NULL default=-
registration_program_code text NULL default=-
is_active boolean NOT NULL default=true
sort_order integer NOT NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'company_profile_rules columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK company_profile_rules columns (name, data type, nullability, default) (10 entries) match the design exactly';
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
operating_scope text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.company_operating_scope_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.company_operating_scope_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
operating_scope text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'company_operating_scope_periods columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK company_operating_scope_periods columns (name, data type, nullability, default) (10 entries) match the design exactly';
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
rule_code text NOT NULL default=-
applicability text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.company_rule_applicability_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.company_rule_applicability_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
rule_code text NOT NULL default=-
applicability text NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'company_rule_applicability_periods columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK company_rule_applicability_periods columns (name, data type, nullability, default) (11 entries) match the design exactly';
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
minimum_driver_age_years smallint NOT NULL default=-
minimum_driver_experience_months smallint NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.company_driver_requirement_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END || ' default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-') FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = 'public.company_driver_requirement_periods'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$id uuid NOT NULL default=gen_random_uuid()
organization_id uuid NOT NULL default=-
minimum_driver_age_years smallint NOT NULL default=-
minimum_driver_experience_months smallint NOT NULL default=-
effective_from timestamp with time zone NOT NULL default=-
effective_to timestamp with time zone NULL default=-
record_status text NOT NULL default='active'::text
corrected_at timestamp with time zone NULL default=-
superseded_by_period_id uuid NULL default=-
created_at timestamp with time zone NOT NULL default=now()
updated_at timestamp with time zone NOT NULL default=now()$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'company_driver_requirement_periods columns (name, data type, nullability, default) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK company_driver_requirement_periods columns (name, data type, nullability, default) (11 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$company_profile_rules company_profile_rules_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,47}$'::text)) deferrable=false deferred=false
company_profile_rules company_profile_rules_default_valid c CHECK (((default_applicability IS NULL) OR (default_applicability = 'APPLIES'::text))) deferrable=false deferred=false
company_profile_rules company_profile_rules_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
company_profile_rules company_profile_rules_pkey p PRIMARY KEY (code) deferrable=false deferred=false
company_profile_rules company_profile_rules_program_only_for_tax c CHECK (((registration_program_code IS NULL) OR (section = 'TAX'::text))) deferrable=false deferred=false
company_profile_rules company_profile_rules_region_valid c CHECK ((applies_to_region = ANY (ARRAY['CANADA'::text, 'UNITED_STATES'::text, 'BOTH'::text]))) deferrable=false deferred=false
company_profile_rules company_profile_rules_registration_program_code_fkey f FOREIGN KEY (registration_program_code) REFERENCES registration_programs(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
company_profile_rules company_profile_rules_section_valid c CHECK ((section = ANY (ARRAY['CARGO'::text, 'OPERATIONS'::text, 'TAX'::text, 'DRIVERS'::text, 'PROGRAMS'::text]))) deferrable=false deferred=false
company_profile_rules company_profile_rules_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_scope_valid c CHECK ((operating_scope = ANY (ARRAY['CANADA'::text, 'UNITED_STATES'::text, 'CANADA_AND_UNITED_STATES'::text]))) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, organization_id) REFERENCES company_operating_scope_periods(id, organization_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
company_rule_applicability_periods company_rule_applicability_periods_applicability_valid c CHECK ((applicability = ANY (ARRAY['APPLIES'::text, 'DOES_NOT_APPLY'::text]))) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_id_scope_uq u UNIQUE (id, organization_id, rule_code) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_rule_code_fkey f FOREIGN KEY (rule_code) REFERENCES company_profile_rules(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, organization_id, rule_code) REFERENCES company_rule_applicability_periods(id, organization_id, rule_code) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
company_driver_requirement_periods company_driver_requirement_periods_age_valid c CHECK (((minimum_driver_age_years >= 16) AND (minimum_driver_age_years <= 100))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_experience_valid c CHECK (((minimum_driver_experience_months >= 0) AND (minimum_driver_experience_months <= 600))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, organization_id) REFERENCES company_driver_requirement_periods(id, organization_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT conrelid::regclass::text || ' ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) || ' deferrable=' || condeferrable || ' deferred=' || condeferred FROM pg_constraint WHERE contype <> 't' AND conrelid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$company_profile_rules company_profile_rules_code_valid c CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,47}$'::text)) deferrable=false deferred=false
company_profile_rules company_profile_rules_default_valid c CHECK (((default_applicability IS NULL) OR (default_applicability = 'APPLIES'::text))) deferrable=false deferred=false
company_profile_rules company_profile_rules_display_name_not_blank c CHECK ((btrim(display_name) <> ''::text)) deferrable=false deferred=false
company_profile_rules company_profile_rules_pkey p PRIMARY KEY (code) deferrable=false deferred=false
company_profile_rules company_profile_rules_program_only_for_tax c CHECK (((registration_program_code IS NULL) OR (section = 'TAX'::text))) deferrable=false deferred=false
company_profile_rules company_profile_rules_region_valid c CHECK ((applies_to_region = ANY (ARRAY['CANADA'::text, 'UNITED_STATES'::text, 'BOTH'::text]))) deferrable=false deferred=false
company_profile_rules company_profile_rules_registration_program_code_fkey f FOREIGN KEY (registration_program_code) REFERENCES registration_programs(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
company_profile_rules company_profile_rules_section_valid c CHECK ((section = ANY (ARRAY['CARGO'::text, 'OPERATIONS'::text, 'TAX'::text, 'DRIVERS'::text, 'PROGRAMS'::text]))) deferrable=false deferred=false
company_profile_rules company_profile_rules_sort_order_uq u UNIQUE (sort_order) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_scope_valid c CHECK ((operating_scope = ANY (ARRAY['CANADA'::text, 'UNITED_STATES'::text, 'CANADA_AND_UNITED_STATES'::text]))) deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, organization_id) REFERENCES company_operating_scope_periods(id, organization_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
company_rule_applicability_periods company_rule_applicability_periods_applicability_valid c CHECK ((applicability = ANY (ARRAY['APPLIES'::text, 'DOES_NOT_APPLY'::text]))) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_id_scope_uq u UNIQUE (id, organization_id, rule_code) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_rule_code_fkey f FOREIGN KEY (rule_code) REFERENCES company_profile_rules(code) ON UPDATE RESTRICT ON DELETE RESTRICT deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, organization_id, rule_code) REFERENCES company_rule_applicability_periods(id, organization_id, rule_code) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true
company_driver_requirement_periods company_driver_requirement_periods_age_valid c CHECK (((minimum_driver_age_years >= 16) AND (minimum_driver_age_years <= 100))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_correction_state_consistent c CHECK ((((record_status = 'active'::text) AND (corrected_at IS NULL) AND (superseded_by_period_id IS NULL)) OR ((record_status = 'corrected'::text) AND (corrected_at IS NOT NULL) AND (superseded_by_period_id IS NOT NULL)))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_effective_window_valid c CHECK (((effective_to IS NULL) OR (effective_to > effective_from))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_experience_valid c CHECK (((minimum_driver_experience_months >= 0) AND (minimum_driver_experience_months <= 600))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_id_organization_uq u UNIQUE (id, organization_id) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_not_superseded_by_self c CHECK (((superseded_by_period_id IS NULL) OR (superseded_by_period_id <> id))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_organization_id_fkey f FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_pkey p PRIMARY KEY (id) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_record_status_valid c CHECK ((record_status = ANY (ARRAY['active'::text, 'corrected'::text]))) deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_superseded_by_fk f FOREIGN KEY (superseded_by_period_id, organization_id) REFERENCES company_driver_requirement_periods(id, organization_id) DEFERRABLE INITIALLY DEFERRED deferrable=true deferred=true$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0019 constraints (definition, deferrability) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0019 constraints (definition, deferrability) (38 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$company_driver_requirement_periods company_driver_requirement_periods_pkey CREATE UNIQUE INDEX company_driver_requirement_periods_pkey ON public.company_driver_requirement_periods USING btree (id)
company_driver_requirement_periods company_driver_requirement_periods_id_organization_uq CREATE UNIQUE INDEX company_driver_requirement_periods_id_organization_uq ON public.company_driver_requirement_periods USING btree (id, organization_id)
company_driver_requirement_periods company_driver_requirement_periods_current_uq CREATE UNIQUE INDEX company_driver_requirement_periods_current_uq ON public.company_driver_requirement_periods USING btree (organization_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
company_driver_requirement_periods company_driver_requirement_periods_history_idx CREATE INDEX company_driver_requirement_periods_history_idx ON public.company_driver_requirement_periods USING btree (organization_id, effective_from)
company_operating_scope_periods company_operating_scope_periods_pkey CREATE UNIQUE INDEX company_operating_scope_periods_pkey ON public.company_operating_scope_periods USING btree (id)
company_operating_scope_periods company_operating_scope_periods_id_organization_uq CREATE UNIQUE INDEX company_operating_scope_periods_id_organization_uq ON public.company_operating_scope_periods USING btree (id, organization_id)
company_operating_scope_periods company_operating_scope_periods_current_uq CREATE UNIQUE INDEX company_operating_scope_periods_current_uq ON public.company_operating_scope_periods USING btree (organization_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
company_operating_scope_periods company_operating_scope_periods_history_idx CREATE INDEX company_operating_scope_periods_history_idx ON public.company_operating_scope_periods USING btree (organization_id, effective_from)
company_profile_rules company_profile_rules_pkey CREATE UNIQUE INDEX company_profile_rules_pkey ON public.company_profile_rules USING btree (code)
company_profile_rules company_profile_rules_sort_order_uq CREATE UNIQUE INDEX company_profile_rules_sort_order_uq ON public.company_profile_rules USING btree (sort_order)
company_profile_rules company_profile_rules_program_uq CREATE UNIQUE INDEX company_profile_rules_program_uq ON public.company_profile_rules USING btree (registration_program_code) WHERE (registration_program_code IS NOT NULL)
company_rule_applicability_periods company_rule_applicability_periods_pkey CREATE UNIQUE INDEX company_rule_applicability_periods_pkey ON public.company_rule_applicability_periods USING btree (id)
company_rule_applicability_periods company_rule_applicability_periods_id_scope_uq CREATE UNIQUE INDEX company_rule_applicability_periods_id_scope_uq ON public.company_rule_applicability_periods USING btree (id, organization_id, rule_code)
company_rule_applicability_periods company_rule_applicability_periods_current_uq CREATE UNIQUE INDEX company_rule_applicability_periods_current_uq ON public.company_rule_applicability_periods USING btree (organization_id, rule_code) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
company_rule_applicability_periods company_rule_applicability_periods_history_idx CREATE INDEX company_rule_applicability_periods_history_idx ON public.company_rule_applicability_periods USING btree (organization_id, rule_code, effective_from)$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('company_profile_rules','company_operating_scope_periods','company_rule_applicability_periods','company_driver_requirement_periods')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tablename || ' ' || indexname || ' ' || regexp_replace(indexdef, E'\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('company_profile_rules','company_operating_scope_periods','company_rule_applicability_periods','company_driver_requirement_periods')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$company_driver_requirement_periods company_driver_requirement_periods_pkey CREATE UNIQUE INDEX company_driver_requirement_periods_pkey ON public.company_driver_requirement_periods USING btree (id)
company_driver_requirement_periods company_driver_requirement_periods_id_organization_uq CREATE UNIQUE INDEX company_driver_requirement_periods_id_organization_uq ON public.company_driver_requirement_periods USING btree (id, organization_id)
company_driver_requirement_periods company_driver_requirement_periods_current_uq CREATE UNIQUE INDEX company_driver_requirement_periods_current_uq ON public.company_driver_requirement_periods USING btree (organization_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
company_driver_requirement_periods company_driver_requirement_periods_history_idx CREATE INDEX company_driver_requirement_periods_history_idx ON public.company_driver_requirement_periods USING btree (organization_id, effective_from)
company_operating_scope_periods company_operating_scope_periods_pkey CREATE UNIQUE INDEX company_operating_scope_periods_pkey ON public.company_operating_scope_periods USING btree (id)
company_operating_scope_periods company_operating_scope_periods_id_organization_uq CREATE UNIQUE INDEX company_operating_scope_periods_id_organization_uq ON public.company_operating_scope_periods USING btree (id, organization_id)
company_operating_scope_periods company_operating_scope_periods_current_uq CREATE UNIQUE INDEX company_operating_scope_periods_current_uq ON public.company_operating_scope_periods USING btree (organization_id) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
company_operating_scope_periods company_operating_scope_periods_history_idx CREATE INDEX company_operating_scope_periods_history_idx ON public.company_operating_scope_periods USING btree (organization_id, effective_from)
company_profile_rules company_profile_rules_pkey CREATE UNIQUE INDEX company_profile_rules_pkey ON public.company_profile_rules USING btree (code)
company_profile_rules company_profile_rules_sort_order_uq CREATE UNIQUE INDEX company_profile_rules_sort_order_uq ON public.company_profile_rules USING btree (sort_order)
company_profile_rules company_profile_rules_program_uq CREATE UNIQUE INDEX company_profile_rules_program_uq ON public.company_profile_rules USING btree (registration_program_code) WHERE (registration_program_code IS NOT NULL)
company_rule_applicability_periods company_rule_applicability_periods_pkey CREATE UNIQUE INDEX company_rule_applicability_periods_pkey ON public.company_rule_applicability_periods USING btree (id)
company_rule_applicability_periods company_rule_applicability_periods_id_scope_uq CREATE UNIQUE INDEX company_rule_applicability_periods_id_scope_uq ON public.company_rule_applicability_periods USING btree (id, organization_id, rule_code)
company_rule_applicability_periods company_rule_applicability_periods_current_uq CREATE UNIQUE INDEX company_rule_applicability_periods_current_uq ON public.company_rule_applicability_periods USING btree (organization_id, rule_code) WHERE ((record_status = 'active'::text) AND (effective_to IS NULL))
company_rule_applicability_periods company_rule_applicability_periods_history_idx CREATE INDEX company_rule_applicability_periods_history_idx ON public.company_rule_applicability_periods USING btree (organization_id, rule_code, effective_from)$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0019 indexes (exact definitions) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0019 indexes (exact definitions) (15 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$company_operating_scope_periods company_operating_scope_periods_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_guard_insert enabled=O type=7 function=tes_security.guard_company_rule_applicability_insert args= constraint=false deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_guard_update enabled=O type=19 function=tes_security.guard_company_operating_scope_update args= constraint=false deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_guard_update enabled=O type=19 function=tes_security.guard_company_rule_applicability_update args= constraint=false deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_guard_update enabled=O type=19 function=tes_security.guard_company_driver_requirement_update args= constraint=false deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_no_delete enabled=O type=11 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_no_delete enabled=O type=11 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_no_delete enabled=O type=11 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_no_truncate enabled=O type=34 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_no_truncate enabled=O type=34 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_no_truncate enabled=O type=34 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text || ' type=' || tgtype || ' function=' || tgfoid::regproc::text || ' args=' || replace(encode(tgargs, 'escape'), E'\\000', ',') || ' constraint=' || (tgconstraint <> 0) || ' deferrable=' || tgdeferrable || ' deferred=' || tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$company_operating_scope_periods company_operating_scope_periods_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_guard_active_organization enabled=O type=7 function=tes_security.guard_active_organization args=organization_id, constraint=false deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_guard_insert enabled=O type=7 function=tes_security.guard_company_rule_applicability_insert args= constraint=false deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_guard_update enabled=O type=19 function=tes_security.guard_company_operating_scope_update args= constraint=false deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_guard_update enabled=O type=19 function=tes_security.guard_company_rule_applicability_update args= constraint=false deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_guard_update enabled=O type=19 function=tes_security.guard_company_driver_requirement_update args= constraint=false deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_no_delete enabled=O type=11 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_no_delete enabled=O type=11 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_no_delete enabled=O type=11 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false
company_operating_scope_periods company_operating_scope_periods_no_truncate enabled=O type=34 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false
company_rule_applicability_periods company_rule_applicability_periods_no_truncate enabled=O type=34 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false
company_driver_requirement_periods company_driver_requirement_periods_no_truncate enabled=O type=34 function=tes_security.prevent_company_profile_data_removal args= constraint=false deferrable=false deferred=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0019 triggers (enabled flag, type, function, arguments, deferral) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0019 triggers (enabled flag, type, function, arguments, deferral) (13 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$prevent_company_profile_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=7661afd4c42bb81f3cd357c040d64314 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_company_rule_applicability_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=ca80ffa72e6bc8357f4fbb3200b9227f owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_company_driver_requirement_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=b53a1241c4f0d7efdced3f360dace2eb owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_company_rule_applicability_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=5b46ea2fce20f2ca09ac41fabb3edfe0 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_company_operating_scope_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=81d23f5d22b33485122fcac8b4452fa2 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_company_profile_data_removal','guard_company_rule_applicability_insert','guard_company_operating_scope_update','guard_company_rule_applicability_update','guard_company_driver_requirement_update')) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT p.proname || ' secdef=' || p.prosecdef || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-') || ' volatility=' || p.provolatile::text || ' language=' || l.lanname || ' returns=' || format_type(p.prorettype, NULL) || ' args=' || pg_get_function_arguments(p.oid) || ' body=' || md5(p.prosrc) || ' owner=' || pg_get_userbyid(p.proowner) || ' public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE') || ' runtime_execute=' || has_function_privilege('tes-backend@tes-production-510007.iam', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_company_profile_data_removal','guard_company_rule_applicability_insert','guard_company_operating_scope_update','guard_company_rule_applicability_update','guard_company_driver_requirement_update')) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$prevent_company_profile_data_removal secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=7661afd4c42bb81f3cd357c040d64314 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_company_rule_applicability_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=ca80ffa72e6bc8357f4fbb3200b9227f owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_company_driver_requirement_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=b53a1241c4f0d7efdced3f360dace2eb owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_company_rule_applicability_insert secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=5b46ea2fce20f2ca09ac41fabb3edfe0 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false
guard_company_operating_scope_update secdef=false config=search_path=pg_catalog volatility=v language=plpgsql returns=trigger args= body=81d23f5d22b33485122fcac8b4452fa2 owner=tes-database-migrator@tes-production-510007.iam public_execute=false runtime_execute=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0019 trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0019 trigger functions (SECURITY INVOKER, fixed search_path, body checksum, no PUBLIC/runtime execute) (5 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$company_profile_rules owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
company_operating_scope_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
company_rule_applicability_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
company_driver_requirement_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass)) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' forcerls=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass)) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$company_profile_rules owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
company_operating_scope_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
company_rule_applicability_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false
company_driver_requirement_periods owner=tes-database-migrator@tes-production-510007.iam rls=false forcerls=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0019 table ownership and RLS flags differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0019 table ownership and RLS flags (4 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$company_profile_rules tes-backend@tes-production-510007.iam SELECT grantable=false
company_operating_scope_periods tes-backend@tes-production-510007.iam SELECT grantable=false
company_rule_applicability_periods tes-backend@tes-production-510007.iam SELECT grantable=false
company_driver_requirement_periods tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass) AND x.grantee <> c.relowner) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass) AND x.grantee <> c.relowner) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$company_profile_rules tes-backend@tes-production-510007.iam SELECT grantable=false
company_operating_scope_periods tes-backend@tes-production-510007.iam SELECT grantable=false
company_rule_applicability_periods tes-backend@tes-production-510007.iam SELECT grantable=false
company_driver_requirement_periods tes-backend@tes-production-510007.iam SELECT grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0019 table ACL (every non-owner grantee) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0019 table ACL (every non-owner grantee) (4 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$company_operating_scope_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
company_operating_scope_periods.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_operating_scope_periods.operating_scope tes-backend@tes-production-510007.iam INSERT grantable=false
company_operating_scope_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
company_operating_scope_periods.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
company_operating_scope_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
company_operating_scope_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
company_operating_scope_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_operating_scope_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
company_operating_scope_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_rule_applicability_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.rule_code tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.applicability tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
company_rule_applicability_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
company_rule_applicability_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_rule_applicability_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
company_rule_applicability_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_driver_requirement_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.minimum_driver_age_years tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.minimum_driver_experience_months tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
company_driver_requirement_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
company_driver_requirement_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_driver_requirement_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
company_driver_requirement_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT c.relname || '.' || a.attname || ' ' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ' ' || x.privilege_type || ' grantable=' || x.is_grantable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x WHERE a.attrelid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass) AND a.attacl IS NOT NULL AND NOT a.attisdropped) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$company_operating_scope_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
company_operating_scope_periods.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_operating_scope_periods.operating_scope tes-backend@tes-production-510007.iam INSERT grantable=false
company_operating_scope_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
company_operating_scope_periods.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
company_operating_scope_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
company_operating_scope_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
company_operating_scope_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_operating_scope_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
company_operating_scope_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_rule_applicability_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.rule_code tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.applicability tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
company_rule_applicability_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
company_rule_applicability_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
company_rule_applicability_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_rule_applicability_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
company_rule_applicability_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_driver_requirement_periods.id tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.organization_id tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.minimum_driver_age_years tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.minimum_driver_experience_months tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.effective_from tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.effective_to tes-backend@tes-production-510007.iam INSERT grantable=false
company_driver_requirement_periods.effective_to tes-backend@tes-production-510007.iam UPDATE grantable=false
company_driver_requirement_periods.record_status tes-backend@tes-production-510007.iam UPDATE grantable=false
company_driver_requirement_periods.corrected_at tes-backend@tes-production-510007.iam UPDATE grantable=false
company_driver_requirement_periods.superseded_by_period_id tes-backend@tes-production-510007.iam UPDATE grantable=false
company_driver_requirement_periods.updated_at tes-backend@tes-production-510007.iam UPDATE grantable=false$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION '0019 column ACL (every column-specific grant) differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK 0019 column ACL (every column-specific grant) (32 entries) match the design exactly';
END
$verify$;

DO $verify$
DECLARE
  missing text;
  extra text;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  SELECT string_agg(l, E'\n' ORDER BY l) INTO missing FROM (
    SELECT unnest(string_to_array($exp$DG_CANADA|CARGO|Dangerous goods in Canada|CANADA|APPLIES|-|true|10
DG_US|CARGO|Hazardous materials in the United States|UNITED_STATES|APPLIES|-|true|20
DG_WV_NV|CARGO|Dangerous goods in West Virginia or Nevada|UNITED_STATES|-|-|true|30
DG_COLORADO|CARGO|Dangerous goods in Colorado|UNITED_STATES|-|-|true|40
DG_IDAHO|CARGO|Dangerous goods in Idaho|UNITED_STATES|-|-|true|50
TOBACCO_ONTARIO|CARGO|Tobacco transport in Ontario|CANADA|-|-|true|60
ALCOHOL_US|CARGO|Alcohol transport in the United States|UNITED_STATES|-|-|true|70
ALCOHOL_NJ|CARGO|Alcohol transport in New Jersey|UNITED_STATES|-|-|true|80
ALCOHOL_TX|CARGO|Alcohol transport in Texas|UNITED_STATES|-|-|true|90
ALCOHOL_KY|CARGO|Alcohol transport in Kentucky|UNITED_STATES|-|-|true|100
ALCOHOL_IN|CARGO|Alcohol transport in Indiana|UNITED_STATES|-|-|true|110
ALCOHOL_OH|CARGO|Alcohol transport in Ohio|UNITED_STATES|-|-|true|120
ALCOHOL_NY|CARGO|Alcohol transport in New York|UNITED_STATES|-|-|true|130
REEFER_CALIFORNIA|OPERATIONS|Refrigerated operations in California|UNITED_STATES|-|-|true|140
IFTA|TAX|IFTA|BOTH|-|IFTA|true|150
CT_HUF|TAX|Connecticut Highway Use Fee|UNITED_STATES|-|CT_HUF|true|160
NY_HUT|TAX|New York Highway Use Tax|UNITED_STATES|-|NY_HUT|true|170
KYU|TAX|Kentucky Weight Distance Tax / KYU|UNITED_STATES|-|KYU|true|180
NM_WDT|TAX|New Mexico Weight Distance Tax|UNITED_STATES|-|NM_WDT|true|190
OR_WMT|TAX|Oregon Weight-Mile Tax|UNITED_STATES|-|OR_WMT|true|200
FORM_2290|TAX|Federal Heavy Highway Vehicle Use Tax — Form 2290|UNITED_STATES|-|-|true|210
FUEL_CHARGE_REGISTRATION|TAX|Fuel Charge Registration|CANADA|-|FUEL_CHARGE|true|220
TEXAS_EXCISE_TAX|TAX|Texas Excise Tax|UNITED_STATES|-|TX_EXCISE|true|230
ARKANSAS_MOTOR_FUEL_TAX|TAX|Arkansas Motor Fuel Tax|UNITED_STATES|-|AR_MFT|true|240
ONTARIO_TOBACCO_TAX|TAX|Ontario Tobacco Tax|CANADA|-|ON_TOBACCO|true|250
BACKGROUND_CHECK|DRIVERS|Background check|BOTH|APPLIES|-|true|260
ANNUAL_ROAD_TEST|DRIVERS|Annual road test|BOTH|APPLIES|-|true|270
PRE_EMPLOYMENT_ROAD_TEST|DRIVERS|Pre-employment road test|BOTH|APPLIES|-|true|280
PSP|DRIVERS|PSP screening|UNITED_STATES|-|-|true|290
CANADIAN_DRUG_ALCOHOL|DRIVERS|Drug & alcohol testing for Canadian drivers|CANADA|APPLIES|-|true|300
TAX_DOCUMENTS|DRIVERS|Driver tax documents|BOTH|APPLIES|-|true|310
WORK_PERMIT|DRIVERS|Work permit|BOTH|-|-|true|320
PERMANENT_RESIDENT_CARD|DRIVERS|Permanent resident card|BOTH|-|-|true|330
STAFF_INCORPORATION|DRIVERS|Staff incorporation documents|BOTH|-|-|true|340
PASSPORT_US|DRIVERS|Passport for US operations|UNITED_STATES|APPLIES|-|true|350
VISA_US|DRIVERS|Visa for US operations|UNITED_STATES|-|-|true|360
CTPAT|PROGRAMS|CTPAT|UNITED_STATES|-|-|true|370
FAST|PROGRAMS|FAST|BOTH|-|-|true|380
PIP|PROGRAMS|PIP|CANADA|-|-|true|390
CSA|PROGRAMS|Customs Self Assessment|CANADA|-|-|true|400
SMARTWAY|PROGRAMS|EPA SmartWay|UNITED_STATES|-|-|true|410
COR|PROGRAMS|COR|CANADA|-|-|true|420
PIC|PROGRAMS|Partners in Compliance|CANADA|-|-|true|430
WEIGHT_TO_GO|PROGRAMS|Weight to Go|CANADA|-|-|true|440
PREMIUM_CARRIER|PROGRAMS|Premium carrier designation|BOTH|-|-|true|450$exp$, E'\n')) AS l
    EXCEPT
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(section::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(applies_to_region::text, '-') || '|' || COALESCE(default_applicability::text, '-') || '|' || COALESCE(registration_program_code::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.company_profile_rules) AS a(l)
  ) d;
  SELECT string_agg(l, E'\n' ORDER BY l) INTO extra FROM (
    SELECT l FROM (SELECT COALESCE(code::text, '-') || '|' || COALESCE(section::text, '-') || '|' || COALESCE(display_name::text, '-') || '|' || COALESCE(applies_to_region::text, '-') || '|' || COALESCE(default_applicability::text, '-') || '|' || COALESCE(registration_program_code::text, '-') || '|' || COALESCE(is_active::text, '-') || '|' || COALESCE(sort_order::text, '-') FROM public.company_profile_rules) AS a(l)
    EXCEPT
    SELECT unnest(string_to_array($exp$DG_CANADA|CARGO|Dangerous goods in Canada|CANADA|APPLIES|-|true|10
DG_US|CARGO|Hazardous materials in the United States|UNITED_STATES|APPLIES|-|true|20
DG_WV_NV|CARGO|Dangerous goods in West Virginia or Nevada|UNITED_STATES|-|-|true|30
DG_COLORADO|CARGO|Dangerous goods in Colorado|UNITED_STATES|-|-|true|40
DG_IDAHO|CARGO|Dangerous goods in Idaho|UNITED_STATES|-|-|true|50
TOBACCO_ONTARIO|CARGO|Tobacco transport in Ontario|CANADA|-|-|true|60
ALCOHOL_US|CARGO|Alcohol transport in the United States|UNITED_STATES|-|-|true|70
ALCOHOL_NJ|CARGO|Alcohol transport in New Jersey|UNITED_STATES|-|-|true|80
ALCOHOL_TX|CARGO|Alcohol transport in Texas|UNITED_STATES|-|-|true|90
ALCOHOL_KY|CARGO|Alcohol transport in Kentucky|UNITED_STATES|-|-|true|100
ALCOHOL_IN|CARGO|Alcohol transport in Indiana|UNITED_STATES|-|-|true|110
ALCOHOL_OH|CARGO|Alcohol transport in Ohio|UNITED_STATES|-|-|true|120
ALCOHOL_NY|CARGO|Alcohol transport in New York|UNITED_STATES|-|-|true|130
REEFER_CALIFORNIA|OPERATIONS|Refrigerated operations in California|UNITED_STATES|-|-|true|140
IFTA|TAX|IFTA|BOTH|-|IFTA|true|150
CT_HUF|TAX|Connecticut Highway Use Fee|UNITED_STATES|-|CT_HUF|true|160
NY_HUT|TAX|New York Highway Use Tax|UNITED_STATES|-|NY_HUT|true|170
KYU|TAX|Kentucky Weight Distance Tax / KYU|UNITED_STATES|-|KYU|true|180
NM_WDT|TAX|New Mexico Weight Distance Tax|UNITED_STATES|-|NM_WDT|true|190
OR_WMT|TAX|Oregon Weight-Mile Tax|UNITED_STATES|-|OR_WMT|true|200
FORM_2290|TAX|Federal Heavy Highway Vehicle Use Tax — Form 2290|UNITED_STATES|-|-|true|210
FUEL_CHARGE_REGISTRATION|TAX|Fuel Charge Registration|CANADA|-|FUEL_CHARGE|true|220
TEXAS_EXCISE_TAX|TAX|Texas Excise Tax|UNITED_STATES|-|TX_EXCISE|true|230
ARKANSAS_MOTOR_FUEL_TAX|TAX|Arkansas Motor Fuel Tax|UNITED_STATES|-|AR_MFT|true|240
ONTARIO_TOBACCO_TAX|TAX|Ontario Tobacco Tax|CANADA|-|ON_TOBACCO|true|250
BACKGROUND_CHECK|DRIVERS|Background check|BOTH|APPLIES|-|true|260
ANNUAL_ROAD_TEST|DRIVERS|Annual road test|BOTH|APPLIES|-|true|270
PRE_EMPLOYMENT_ROAD_TEST|DRIVERS|Pre-employment road test|BOTH|APPLIES|-|true|280
PSP|DRIVERS|PSP screening|UNITED_STATES|-|-|true|290
CANADIAN_DRUG_ALCOHOL|DRIVERS|Drug & alcohol testing for Canadian drivers|CANADA|APPLIES|-|true|300
TAX_DOCUMENTS|DRIVERS|Driver tax documents|BOTH|APPLIES|-|true|310
WORK_PERMIT|DRIVERS|Work permit|BOTH|-|-|true|320
PERMANENT_RESIDENT_CARD|DRIVERS|Permanent resident card|BOTH|-|-|true|330
STAFF_INCORPORATION|DRIVERS|Staff incorporation documents|BOTH|-|-|true|340
PASSPORT_US|DRIVERS|Passport for US operations|UNITED_STATES|APPLIES|-|true|350
VISA_US|DRIVERS|Visa for US operations|UNITED_STATES|-|-|true|360
CTPAT|PROGRAMS|CTPAT|UNITED_STATES|-|-|true|370
FAST|PROGRAMS|FAST|BOTH|-|-|true|380
PIP|PROGRAMS|PIP|CANADA|-|-|true|390
CSA|PROGRAMS|Customs Self Assessment|CANADA|-|-|true|400
SMARTWAY|PROGRAMS|EPA SmartWay|UNITED_STATES|-|-|true|410
COR|PROGRAMS|COR|CANADA|-|-|true|420
PIC|PROGRAMS|Partners in Compliance|CANADA|-|-|true|430
WEIGHT_TO_GO|PROGRAMS|Weight to Go|CANADA|-|-|true|440
PREMIUM_CARRIER|PROGRAMS|Premium carrier designation|BOTH|-|-|true|450$exp$, E'\n'))
  ) d;
  IF missing IS NOT NULL OR extra IS NOT NULL THEN
    RAISE EXCEPTION 'company_profile_rules seed rows differ from the design. MISSING: % EXTRA: %', coalesce(missing, '-'), coalesce(extra, '-');
  END IF;
  RAISE NOTICE 'OK company_profile_rules seed rows (45 entries) match the design exactly';
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

  FOREACH tbl IN ARRAY ARRAY['company_profile_rules','company_operating_scope_periods','company_rule_applicability_periods','company_driver_requirement_periods'] LOOP
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

  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.company_profile_rules'::regclass) AND a.attnum > 0 AND NOT a.attisdropped AND (has_column_privilege(runtime_role, a.attrelid, a.attnum, 'INSERT') OR has_column_privilege(runtime_role, a.attrelid, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'runtime can write a 0019 catalogue (changed only by migrations)';
  END IF;
  IF migrator_role = runtime_role THEN RAISE EXCEPTION 'migrator and runtime identities are the same'; END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass) AND (relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.company_profile_rules'::regclass,'public.company_operating_scope_periods'::regclass,'public.company_rule_applicability_periods'::regclass,'public.company_driver_requirement_periods'::regclass)) THEN
    RAISE EXCEPTION 'RLS or a policy exists on a 0019 table (not part of the approved design)';
  END IF;

  RAISE NOTICE 'OK 0019 runtime: SELECT + column-specific INSERT/UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; no PUBLIC privilege; no RLS / policy';
END
$verify$;

DO $verify$
DECLARE
  bad bigint;
BEGIN
  IF current_setting('tes.verify_phase') <> 'post' THEN RETURN; END IF;

  IF current_setting('tes.verify_expect_empty') = '1' THEN
    IF (SELECT count(*) FROM public.company_operating_scope_periods) <> 0 OR (SELECT count(*) FROM public.company_rule_applicability_periods) <> 0 OR (SELECT count(*) FROM public.company_driver_requirement_periods) <> 0 THEN
      RAISE EXCEPTION 'a 0019 business table is not empty (set TES_VERIFY_EXPECT_EMPTY=0 when verifying a live system)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id
               WHERE c.code IN ('COMPANY_PROFILE_READ','COMPANY_PROFILE_MANAGE')) THEN
      RAISE EXCEPTION 'a 0019 capability is granted to someone (0019 grants nothing; set TES_VERIFY_EXPECT_EMPTY=0 once grants are made deliberately)';
    END IF;
  END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.company_operating_scope_periods WHERE record_status = 'active' AND effective_to IS NULL
    GROUP BY organization_id HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Organization(s) with more than one current operating scope', bad; END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.company_rule_applicability_periods WHERE record_status = 'active' AND effective_to IS NULL
    GROUP BY organization_id, rule_code HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% rule assertion(s) with more than one current period', bad; END IF;

  SELECT count(*) INTO bad FROM (SELECT 1 FROM public.company_driver_requirement_periods WHERE record_status = 'active' AND effective_to IS NULL
    GROUP BY organization_id HAVING count(*) > 1) d;
  IF bad <> 0 THEN RAISE EXCEPTION '% Organization(s) with more than one current driver requirement', bad; END IF;

  SELECT count(*) INTO bad FROM public.company_rule_applicability_periods a JOIN public.company_rule_applicability_periods b
    ON a.organization_id = b.organization_id AND a.rule_code = b.rule_code AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active'
   AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz);
  IF bad <> 0 THEN RAISE EXCEPTION '% pair(s) of overlapping rule applicability periods', bad; END IF;

  SELECT count(*) INTO bad FROM public.company_profile_rules r
   WHERE r.registration_program_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.registration_programs p WHERE p.code = r.registration_program_code);
  IF bad <> 0 THEN RAISE EXCEPTION '% rule(s) point at a missing registration program', bad; END IF;

  RAISE NOTICE 'OK 0019 row conditions hold (company_operating_scope_periods, company_rule_applicability_periods, company_driver_requirement_periods counted separately in the ROWCOUNT lines)';
END
$verify$;
