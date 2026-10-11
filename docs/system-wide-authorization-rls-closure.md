# TES System-wide Authorization + RLS Closure

## Governing model

This program closes database enforcement for migrations 0001-0024. A requested customer UUID is never authority. CUSTOMER business-row access requires a transaction-local customer, authenticated TES actor, and capability whose effective CUSTOMER authorization path is re-proven by PostgreSQL. SYSTEM business-row access similarly requires the exact actor + SYSTEM capability and is re-proven against the authorization kernel. No static `system=true` bypass exists.

RLS is enabled on runtime-facing canonical business tables. It is intentionally not FORCEd because the migration owner is distinct from the application runtime; the backend runtime is checked to be neither a table owner nor BYPASSRLS. This preserves owner-side migrations/verifiers while enforcing every backend query.

Customer access is read-only in this foundation and uses `ORGANIZATION_READ`. Credentials and entity-resolution provenance remain SYSTEM-only. Master Register appends remain available to authorized operations, while enumeration requires explicit `MASTER_REGISTER_READ`.

## Complete table classification through 0024

### Security / authorization kernel — global SYSTEM infrastructure, no RLS
These tables are needed to authenticate and authorize *before* a tenant context exists. Runtime access remains privilege-limited and they are never customer business-data entry points:

- `actors`
- `authentication_identities`
- `master_account_authority`
- `actor_relationships`
- `relationship_assignments`
- `capabilities`
- `relationship_capability_grants`

### Migration / legacy control — global SYSTEM infrastructure, no customer access
- `tes_system.schema_migrations`
- `legacy_record_map`
- `legacy_record_snapshots`

The legacy tables retain their pre-existing controlled resolver/privilege boundary; they are not tenant business tables.

### Shared reference catalogues — global read-only vocabulary, no tenant ownership
- `organization_classification_types`
- `location_kinds`
- `authority_kinds`
- `contact_purpose_types`
- `engagement_types`
- `engagement_stage_types`
- `product_levels`
- `service_catalogue`
- `engagement_end_reasons`
- `registration_programs`
- `insurance_coverage_types`
- `credential_categories`
- `company_profile_rules`
- `vehicle_types`

### Customer-visible canonical graph — RLS
Corporate identity/customer:
- `organizations`, `organization_identifiers`, `organization_aliases`, `organization_classifications`, `customers`, `customer_engagements`

Locations:
- `locations`, `location_addresses`, `organization_location_assignments`

Authorities:
- `operating_authorities`, `operating_authority_versions`, `operating_authority_status_periods`

Contacts / people:
- `persons`, `person_name_versions`, `person_channels`, `organization_channels`, `organization_person_relationships`, `organization_person_titles`, `contact_purpose_assignments`

Customer relationship:
- `customer_engagement_stages`, `customer_engagement_terminations`, `customer_agreements`, `customer_agreement_versions`, `engagement_service_scopes`, `engagement_responsibility_periods`

Tax / registration:
- `registrations`, `registration_versions`, `registration_status_periods`

Insurance:
- `insurance_policies`, `insurance_policy_terms`, `insurance_endorsements`, `insurance_coverages`, `insurance_broker_periods`

Operating profile:
- `company_operating_scope_periods`, `company_rule_applicability_periods`, `company_driver_requirement_periods`

Vehicles:
- `vehicles`, `organization_vehicle_relationships`, `vehicle_registration_periods`

Drivers:
- `driver_profiles`, `driver_licences`, `organization_driver_relationships`, `driver_medical_qualification_periods`

Customer visibility follows permanent/historical organization relationships, not only current status, so legitimate historical audit data does not disappear when a relationship ends.

### Sensitive SYSTEM-only canonical data — RLS, no CUSTOMER policy
Credentials:
- `credential_systems`, `credential_system_aliases`, `company_credentials`, `credential_status_periods`, `credential_verifications`, `credential_secret_slots`

Entity resolution:
- `entity_resolution_cases`, `entity_resolution_signals`, `entity_resolution_candidates`

### Accountability — RLS
- `master_register_events`

Authorized SYSTEM or CUSTOMER operations may append in their proven context. Reading the register is SYSTEM-only and requires `MASTER_REGISTER_READ`.

## Cross-domain rules

1. Customer A cannot see Customer B by direct ID, join, historical row, person, vehicle, identifier, provider, or resolution provenance.
2. Shared Person and Vehicle identities are visible to a customer only when that identity has a relationship to that customer's Organization. Historical relationships count for historical audit continuity.
3. External insurer/broker Organizations are visible only when referenced by the customer's own insurance graph. This does not expose those providers' unrelated customers or business records.
4. Credential rows never have a CUSTOMER policy.
5. Entity-resolution provenance never has a CUSTOMER policy.
6. SYSTEM access is capability-specific. A `VEHICLE_READ` context cannot read Credentials, Tax, Driver, or entity-resolution tables.
7. Customer context and SYSTEM context do not inherit from one another.
8. RLS does not replace Master Register, capability authorization, immutable history, or database constraints.
9. Accessible-customer discovery is the only pre-selection business-directory exception. It runs through a fixed SECURITY DEFINER function that reproduces the actor's effective CUSTOMER authorization paths and returns only assigned customers.
10. The backend runtime must never receive BYPASSRLS or table ownership.

## Closure boundary

This block owns authorization-to-database context binding, table classification, RLS policies, cross-tenant isolation, SYSTEM capability isolation, runtime RLS posture, accessible-customer discovery under RLS, adversarial verification, and production PRE/APPLY/POST.

It does **not** create new business domains, evidence/GCS storage, OCR, Rules Pool, or UI. Those are downstream systems, not unfinished RLS work.
