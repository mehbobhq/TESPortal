-- TES Core Operational Identity Graph: Organization access policies for operational identity and insurance
-- Migration: 0027
--
-- Policy-only (no table, column, index, function or trigger is created or changed). Migration 0024 closed row-level security on
-- the canonical tables but two SYSTEM policies omit capabilities whose operations must read or lock the rows they protect:
--
--   1. organizations_system. Establishing an Organization-Vehicle or Organization-Driver relationship, and opening an entity
--      resolution case in an Organization context, lock the active Organization (SELECT ... FOR UPDATE) and the insert guards of
--      migration 0020 / 0021 read it again. Under the single capability the transaction carries (VEHICLE_MANAGE, DRIVER_MANAGE,
--      IDENTITY_RESOLUTION_MANAGE) the Organization was invisible, so the operation reported "Organization not found".
--   2. organization_person_relationships_system. Creating an insurance policy with a broker contact validates the broker
--      contact's active relationship with the brokerage Organization (migration 0017); under INSURANCE_MANAGE the relationship
--      was invisible, so the policy was refused.
--
-- Only the USING (visibility) expression of each policy is widened, by exactly the capabilities named above. The WITH CHECK
-- expressions are not changed, so none of these capabilities can insert, update or re-parent a row of either table. CUSTOMER
-- policies are not touched. No capability is granted to anyone; the six capabilities already exist.

ALTER POLICY organizations_system ON public.organizations
  USING (tes_security.system_context_authorized(ARRAY['ORGANIZATION_REGISTRY_READ','ORGANIZATION_CREATE','ORGANIZATION_UPDATE','ORGANIZATION_ARCHIVE','CUSTOMER_ESTABLISH','INSURANCE_READ','INSURANCE_MANAGE','CREDENTIAL_READ','CREDENTIAL_MANAGE','VEHICLE_READ','VEHICLE_MANAGE','DRIVER_READ','DRIVER_MANAGE','IDENTITY_RESOLUTION_MANAGE']));

ALTER POLICY organization_person_relationships_system ON public.organization_person_relationships
  USING (tes_security.system_context_authorized(ARRAY['PERSON_REGISTRY_READ','CONTACT_MANAGE','INSURANCE_MANAGE']));
