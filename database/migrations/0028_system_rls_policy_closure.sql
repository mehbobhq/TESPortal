-- TES system-wide RLS: SYSTEM policy closure
-- Migration: 0028
--
-- Policy-only (no table, column, index, function, trigger, capability or grant is created or changed). Migration 0024 closed
-- row-level security with one SYSTEM policy per table, but several policies omit capabilities whose existing service operations
-- must read, lock or write the rows they protect. Under the single capability a transaction carries (see 0024) those rows were
-- invisible or unwritable, so the operations failed ("Organization was not found.", "new row violates row-level security
-- policy"). Every capability added below is required by an existing operation and was proven required by removing it and
-- watching that operation's tests fail; nothing is added "for symmetry".
--
--   1. organizations_system (USING). The Organization is locked (SELECT ... FOR UPDATE) or checked for existence by:
--        VEHICLE_MANAGE, DRIVER_MANAGE, IDENTITY_RESOLUTION_MANAGE   operational identity relationships and resolution cases
--        CUSTOMER_RELATIONSHIP_READ / _MANAGE                        customer relationship reads and mutations
--        TAX_REGISTRATION_READ / _MANAGE                             registration reads and mutations
--        COMPANY_PROFILE_READ / _MANAGE                              operating profile reads and mutations
--        CONTACT_MANAGE, PERSON_REGISTRY_READ                        contact relationships, and the Organization checks of reads
--      This is the final list: it supersedes the list of 0027, which also named VEHICLE_READ and DRIVER_READ. No existing
--      operation reads an Organization under those two capabilities, so they are removed again (least privilege).
--      WITH CHECK is unchanged: none of these capabilities can insert or update an Organization.
--   2. customer_engagement_stages_system (USING and WITH CHECK). Establishing a Customer relationship runs under
--      CUSTOMER_ESTABLISH and writes the engagement's first stage.
--   3. organization_identifiers_system, organization_aliases_system, organization_classifications_system (USING and WITH CHECK).
--      Creating an Organization runs under ORGANIZATION_CREATE and writes its identifiers, aliases and classifications.
--      Archiving and restoring an Organization run under ORGANIZATION_ARCHIVE and read those three tables to return the
--      Organization with its history (USING only: ORGANIZATION_ARCHIVE gains no write path on them).
--   4. registrations_system and registration_status_periods_system (USING only). The operating profile (0019) compares every
--      TAX rule with the Organization's registrations and their current status period, a read of the Tax / Registration tables
--      made under COMPANY_PROFILE_READ (company-profile repository, listTaxRuleRegistrationPresence). Without it the comparison
--      silently reported NOT_CONFIGURED for a registered program. Both tables are needed (either alone does not fix it); the
--      registration numbers live in registration_versions, which stays unreadable under that capability. No write path.
--
-- CUSTOMER policies are not touched. No capability is granted to anyone.

ALTER POLICY organizations_system ON public.organizations
  USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_CREATE','ORGANIZATION_UPDATE','ORGANIZATION_ARCHIVE','CUSTOMER_ESTABLISH','INSURANCE_READ','INSURANCE_MANAGE','CREDENTIAL_READ','CREDENTIAL_MANAGE','VEHICLE_MANAGE','DRIVER_MANAGE','IDENTITY_RESOLUTION_MANAGE','CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE','TAX_REGISTRATION_READ','TAX_REGISTRATION_MANAGE','COMPANY_PROFILE_READ','COMPANY_PROFILE_MANAGE','CONTACT_MANAGE','PERSON_REGISTRY_READ']));

ALTER POLICY customer_engagement_stages_system ON public.customer_engagement_stages
  USING (tes_security.system_context_authorized(ARRAY['CUSTOMER_ESTABLISH','CUSTOMER_RELATIONSHIP_READ','CUSTOMER_RELATIONSHIP_MANAGE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['CUSTOMER_ESTABLISH','CUSTOMER_RELATIONSHIP_MANAGE']));

ALTER POLICY organization_identifiers_system ON public.organization_identifiers
  USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_CREATE','ORGANIZATION_UPDATE','ORGANIZATION_ARCHIVE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_CREATE','ORGANIZATION_UPDATE']));

ALTER POLICY organization_aliases_system ON public.organization_aliases
  USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_CREATE','ORGANIZATION_UPDATE','ORGANIZATION_ARCHIVE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_CREATE','ORGANIZATION_UPDATE']));

ALTER POLICY organization_classifications_system ON public.organization_classifications
  USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_CREATE','ORGANIZATION_UPDATE','ORGANIZATION_ARCHIVE']))
  WITH CHECK (tes_security.system_context_authorized(ARRAY['ORGANIZATION_CREATE','ORGANIZATION_UPDATE']));

ALTER POLICY registrations_system ON public.registrations
  USING (tes_security.system_context_authorized(ARRAY['TAX_REGISTRATION_READ','TAX_REGISTRATION_MANAGE','COMPANY_PROFILE_READ']));

ALTER POLICY registration_status_periods_system ON public.registration_status_periods
  USING (tes_security.system_context_authorized(ARRAY['TAX_REGISTRATION_READ','TAX_REGISTRATION_MANAGE','COMPANY_PROFILE_READ']));
