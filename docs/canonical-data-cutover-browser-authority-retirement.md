# TES Block 01 - Canonical Data Cutover + Browser Authority Retirement

Status: Phases A-B closed, Phases C-E not closed

Date: 2026-10-11
Repository: `mehbobhq/TESPortal`

## Closure Rule

PostgreSQL is the canonical authority for supported TES business domains. Browser storage may remain only for explicitly approved non-authoritative UI state, temporary drafts, or migration source snapshots. It must not create, restore, overwrite, or govern durable business records.

## Phase A - Repository-Wide Persistence Preflight

Status: CLOSED

### Browser Persistence Inventory

The repository still contains broad durable browser persistence across operational modules. The current usage is not limited to harmless UI state.

Important localStorage/sessionStorage/IndexedDB keys and paths:

| Persistence key or family | Current owner/path | Current role | Classification |
| --- | --- | --- | --- |
| `tes_companies` | `app/companies/page.tsx`, `app/companies/new/page.tsx`, `app/companies/[id]/edit/page.tsx`, `lib/vehicle-data.ts`, `lib/driver-data.ts`, shared nav/header | Company/customer root data and cross-module company lookup | Canonical business data in browser, must be retired |
| `tes_customers` | `app/customers/page.tsx`, `app/companies/page.tsx`, `app/companies/new/page.tsx`, `app/companies/[id]/edit/page.tsx` | Customer list and customer/company synchronization | Canonical business data in browser, must be retired |
| `tes_company_vehicles_${companyId}` | `app/companies/[id]/vehicles/page.tsx`, `lib/vehicle-data.ts`, `components/site-header.tsx` | Vehicle records, registration/maintenance/inspection workspace state | Canonical operational data in browser, must be retired where PostgreSQL supports vehicles |
| `tes_driver_masters_v1` | `lib/driver-data.ts`, `components/site-header.tsx` | Driver master identities | Canonical operational identity data in browser, must be reconciled |
| `tes_company_drivers_${companyId}` | `lib/driver-data.ts`, `app/companies/[id]/drivers/page.tsx`, `app/companies/[id]/citations/page.tsx` | Driver/company relationships and driver operational data | Canonical operational data in browser, must be reconciled |
| `tes_company_authorities_${companyId}` | `app/companies/[id]/authorities/page.tsx`, `lib/authorities/model.ts` | Operating authority records | Duplicate of PostgreSQL-supported authorities domain |
| `tes_company_tax_filing_${companyId}` | `app/companies/[id]/tax-filing/page.tsx` | Tax filing/registration workspace data | Duplicate of PostgreSQL-supported registration domain |
| `tes_company_compliance_settings_${companyId}` | `app/companies/[id]/settings/page.tsx`, `app/companies/[id]/tax-filing/page.tsx`, `src/components/vehicles/settings/SettingsTab.tsx` | Operating profile/rule applicability/settings | Duplicate of PostgreSQL-supported company operating profile domain |
| `tes_company_insurance_${companyId}` | `app/companies/[id]/insurance/page.tsx` | Insurance policy/workers comp/surety state | Duplicate of PostgreSQL-supported insurance domain |
| `tes_contacts_v5` plus legacy `v4`/`v3` | `app/companies/[id]/contacts/page.tsx`, `app/companies/[id]/insurance/page.tsx` | Contact/person metadata | Duplicate of PostgreSQL-supported contacts/persons domain |
| `tes_company_credentials_${companyId}` and `tes_portal_registry_v1` | `app/companies/[id]/credentials/page.tsx` | Credential metadata and portal registry | Duplicate of PostgreSQL-supported credential metadata domain; secret custody excluded from this block |
| `tes_business_records_${companyId}` and `tes_business_corporate_documents_${companyId}` | `app/companies/[id]/business/page.tsx`, `src/components/business/CorporateDocumentsSection.tsx` | Corporate/tax/business papers metadata | Partly canonical/partly evidence metadata; requires mapping review before migration |
| `tes_company_citations_${companyId}` | `app/companies/[id]/citations/page.tsx`, `lib/driver-data.ts`, relationship-resolution helpers | Citations/roadside events and evidence references | Browser-only operational records; not fully supported by current PostgreSQL domain |
| `tes_vehicle_activity_${companyId}_${vehicleId}` | `app/companies/[id]/vehicles/page.tsx` | Vehicle activity history | Browser-only derived/activity data; requires domain decision |
| `tes_vehicle_settings_${companyId}_${vehicleId}` | `src/components/vehicles/settings/SettingsTab.tsx` | Vehicle-specific settings | Browser-only durable settings; requires domain decision |
| `tes_repair_invoice_store_v4_${companyId}` plus legacy `v3`/`v2` | `lib/repair-invoice-data.ts` | Repair invoice records | Browser-only operational records; not covered by current PostgreSQL schema |
| `tes_repair_document_intake_v1` | `lib/repair-document-intake.ts` | Repair document intake tracking | Browser-only intake state; future GCS/intake block boundary |
| `tes_service_provider_store_v1` | `lib/service-provider-data.ts` | Service provider registry | Browser-only registry; needs canonical owner decision |
| `tes_part_catalog` | `lib/part-catalog-data.ts` | Part catalogue | Explicitly local prototype/catalogue data; likely presentation/reference until productized |
| `tes_activity_${companyId}` | `lib/activity-log.ts` | Per-company activity feed | Duplicate/competitor to Master Register if treated as audit truth |
| `tes_audit_events`, `tes_audit_log`, `tes_audit_export_required` | `lib/audit-logger.ts`, `lib/audit-log.ts` | Client-side audit/security buffers | Must not remain final accountability authority; Master Register is canonical |
| `tes_audit_pin_hash`, `tes_audit_attempts`, `tes_audit_lockout`, `tes_audit_verified`, `tes_sid` | `lib/audit-log-auth.ts`, `lib/audit-log.ts` | Local audit UI/session protection | Security-sensitive local state; not a durable authorization boundary |
| `tes_system_settings` | `app/settings/page.tsx`, `lib/vehicle-data.ts`, `lib/authorities/model.ts`, citations | System configuration | Durable settings in browser; must move to server if it affects product behavior |
| `tes_applicant_application_draft_${applicationId}` | `app/driver-application/applicant-application-store.ts` | Applicant draft | May remain temporary draft if non-authoritative and submitted through server |
| `tes_applicant_application_submitted_${applicationId}` | `app/driver-application/applicant-application-store.ts`, `lib/driver-data.ts` | Submitted application snapshot | Server repository exists; browser snapshot must not be production truth |
| IndexedDB `tes_evidence_payloads` | `lib/evidence-payload-store.ts` | Driver evidence payloads | Browser evidence payload storage; future GCS/evidence boundary |
| IndexedDB `tes_evidence_store` | `src/components/contacts/evidence-storage.ts` | Contact evidence payloads | Browser evidence payload storage; future GCS/evidence boundary |
| IndexedDB evidence file store | `lib/evidence-file-store.ts` | File payloads outside localStorage | Browser evidence payload storage; future GCS/evidence boundary |
| Cookie `sidebar_state` | `components/ui/sidebar.tsx` | UI sidebar preference | Approved non-authoritative UI state candidate |

### PostgreSQL Canonical Foundation Present

The repository contains migrations through `0024_system_wide_authorization_rls_closure.sql`.

Canonical domains already represented in PostgreSQL include:

| Domain | Migration(s) | Tables/structures |
| --- | --- | --- |
| Organization/customer root | `0003` | `organizations`, `organization_identifiers`, `organization_aliases`, `organization_classifications`, `customers`, `customer_engagements` |
| Legacy company continuity | `0010` | `legacy_record_map`, `legacy_record_snapshots`, `tes_security.resolve_legacy_company()` |
| Locations | `0012` | `locations`, `location_addresses`, `organization_location_assignments` |
| Authorities | `0013` | `authority_kinds`, `operating_authorities`, `operating_authority_versions`, `operating_authority_status_periods` |
| Contacts/persons | `0014` | `persons`, `person_name_versions`, `person_channels`, `organization_channels`, `organization_person_relationships`, `organization_person_titles`, `contact_purpose_assignments` |
| Customer relationship | `0015` | Engagement, agreement, service-scope, and responsibility tables |
| Tax/registration | `0016` | `registration_programs`, `registrations`, `registration_versions`, `registration_status_periods` |
| Insurance | `0017` | `insurance_policies`, `insurance_policy_terms`, `insurance_endorsements`, `insurance_coverages`, `insurance_broker_periods` |
| Credential metadata | `0018` | `credential_categories`, `credential_systems`, `company_credentials`, status/verifications/secret-slot metadata |
| Operating profile | `0019` | `company_profile_rules`, operating scope, rule applicability, driver requirement periods |
| Vehicles | `0020` | `vehicle_types`, `vehicles`, `organization_vehicle_relationships`, `vehicle_registration_periods` |
| Drivers/person identity | `0021` | `driver_profiles`, `driver_licences`, `organization_driver_relationships`, `driver_medical_qualification_periods` |
| Entity resolution | `0022` | `entity_resolution_cases`, `entity_resolution_signals`, `entity_resolution_candidates` |
| Authorization/RLS closure | `0024` | RLS policies across canonical business tables and Master Register events |

The service layer already exposes server-only authorized PostgreSQL boundaries for major supported domains, including:

| Domain | Service boundary |
| --- | --- |
| Corporate identity | `lib/corporate-identity/service.ts` |
| Customer relationship | `lib/customer-relationship/service.ts` |
| Organization locations | `lib/organization-locations/service.ts` |
| Contacts | `lib/contacts/service.ts` |
| Operating authorities | `lib/operating-authorities/service.ts` |
| Tax registrations | `lib/tax-registrations/service.ts` |
| Insurance | `lib/insurance/service.ts` |
| Credential metadata | `lib/company-credentials/service.ts` |
| Company operating profile | `lib/company-profile/service.ts` |
| Vehicle/driver identity | `lib/operational-identity/service.ts` |

### Existing Reconciliation Assets

The repository already contains useful deterministic mapping boundaries:

| Asset | Purpose |
| --- | --- |
| `lib/company-profile/legacy.ts` | Maps legacy settings/tax/rule values to canonical operating profile concepts without persistence |
| `lib/operational-identity/legacy.ts` | Maps legacy vehicle and driver shapes into canonical identity commands without persistence |
| `database/migrations/0010_legacy_company_identity_continuity.sql` | Provides immutable company legacy mapping/snapshot infrastructure |
| `database/migrations/0022_entity_resolution_foundation.sql` | Provides entity resolution case/signal/candidate structure |

### Phase A Findings

1. Browser storage is still the active runtime authority for many supported domains.
2. PostgreSQL canonical tables and authorized service boundaries exist for most Block 01 target domains.
3. Runtime pages generally do not call those service boundaries yet; they read/write browser storage directly.
4. Existing legacy continuity only accepts `legacy_entity_type = 'COMPANY'`; it does not yet support legacy vehicle, driver, contact, credential, authority, insurance, tax, or document identity mappings.
5. There is no repository-wide controlled import job yet: no migration batch table, checkpoint table, import status table, dry-run report table, or privileged import route was found.
6. Some browser stores are outside the current canonical schema, especially citations/roadside events, repair invoices, repair intake, vehicle activity, service providers, and evidence payloads. These cannot be honestly closed under Block 01 without either adding canonical schemas or explicitly excluding them from supported-domain closure.
7. Client-side audit buffers and activity logs still exist. They may be useful as temporary buffers, but cannot be final accountability authority beside Master Register.

## Phase B - Canonical Mapping and Reconciliation

Status: CLOSED

Phase B closes the design boundary only. It does not import data, change runtime authority, or remove browser persistence.

### Source Namespace Rule

Every browser export/import must identify a source dataset with:

| Field | Rule |
| --- | --- |
| `source_system` | Stable machine-readable source, for example `tes-browser-localstorage` |
| `source_namespace` | Human/workspace/brower-export scoped namespace, for example `clerk-user-id:export-timestamp` or another explicit export batch namespace |
| `legacy_entity_type` | Canonical legacy entity type; must not reuse `COMPANY` for non-company records |
| `legacy_id` | The original browser record id/key inside that namespace |

No browser id is globally meaningful. Identical local ids from different source namespaces must not collide or auto-merge.

### Continuity Infrastructure Decision

`legacy_record_map` currently accepts only `legacy_entity_type = 'COMPANY'`. Phase C must extend continuity support before importing non-company operational records.

Required canonical legacy entity types:

| Legacy entity type | Canonical target |
| --- | --- |
| `COMPANY` | `organizations.id` plus `customers.id` where applicable |
| `CUSTOMER` | `customers.id` through organization/customer relationship |
| `LOCATION` | `locations.id` and `organization_location_assignments.id` |
| `PERSON` | `persons.id` |
| `CONTACT_RELATIONSHIP` | `organization_person_relationships.id` |
| `VEHICLE` | `vehicles.id` |
| `ORGANIZATION_VEHICLE_RELATIONSHIP` | `organization_vehicle_relationships.id` |
| `DRIVER_PROFILE` | `driver_profiles.person_id` / `persons.id` |
| `ORGANIZATION_DRIVER_RELATIONSHIP` | `organization_driver_relationships.id` |
| `AUTHORITY` | `operating_authorities.id` |
| `TAX_REGISTRATION` | `registrations.id` |
| `INSURANCE_POLICY` | `insurance_policies.id` |
| `CREDENTIAL_SYSTEM` | `credential_systems.id` |
| `COMPANY_CREDENTIAL` | `company_credentials.id` |

If a record maps to multiple canonical rows, the import report must name the primary canonical row and list secondary rows in a relationship payload. It must not hide the split.

### Source-to-Target Ownership Matrix

| Legacy store | Canonical owner | Mapping action | Collision/review rule |
| --- | --- | --- | --- |
| `tes_companies` | `organizations`, identifiers, aliases, classifications, `customers` | Create or match organization, establish customer when customer facts exist, snapshot source | Identifier collision blocks import unless resolved; name-only similarity is review, not auto-merge |
| `tes_customers` | `customers`, `customer_engagements`, customer relationship tables | Attach customer lifecycle/service facts to canonical organization | If no mapped company exists, hold for review |
| `tes_company_vehicles_${companyId}` | `vehicles`, `organization_vehicle_relationships`, `vehicle_registration_periods` | Resolve company first, map each vehicle via VIN/plate/unit signals | VIN conflict blocks; unit/plate-only match is review unless exact current relationship exists |
| `tes_driver_masters_v1` | `persons`, `driver_profiles`, `driver_licences` | Create/resolve person, create driver profile, import licences | Licence-number and DOB/name conflicts become entity-resolution cases, not silent merges |
| `tes_company_drivers_${companyId}` | `organization_driver_relationships`, driver status facts | Resolve company and person/driver first, then establish relationship | Missing driver or company blocks relationship import |
| `tes_company_authorities_${companyId}` | `operating_authorities`, versions, status periods | Map authority kind, number, jurisdiction, dates and status | Existing active number collision blocks unless same organization/current authority |
| `tes_company_tax_filing_${companyId}` | `registrations`, versions, status periods | Map tax program, jurisdiction, account number, dates/status | Registration number collision blocks unless same organization/current registration |
| `tes_company_compliance_settings_${companyId}` | `company_operating_scope_periods`, `company_rule_applicability_periods`, `company_driver_requirement_periods` | Use `lib/company-profile/legacy.ts`; defaults are not assertions | Invalid or unmappable rule values go to exceptions; untouched defaults are skipped |
| `tes_company_insurance_${companyId}` | `insurance_policies`, terms, coverages, endorsements, broker periods | Map family, insurer, policy/term/coverage/broker facts | Policy number collision by insurer blocks unless same canonical policy |
| `tes_contacts_v5` and `tes_contacts_v4/v3` | `persons`, channels, organization-person relationships, titles, purposes | Import v5 as source of record; legacy v4/v3 only for matching/review unless explicitly selected | Shared phone/email is advisory; no automatic merge |
| `tes_company_credentials_${companyId}` | `credential_systems`, aliases, `company_credentials`, status, verifications, secret slots | Import metadata only: system, URL, username, category, MFA method/status | Duplicate system alias/naming conflict requires review; secrets are excluded from this block |
| `tes_portal_registry_v1` | `credential_systems`, `credential_system_aliases` | Create canonical system registry entries and aliases | Canonical duplicate system names/aliases block import |
| `tes_business_records_${companyId}` | `organizations`, identifiers, tax identifiers, corporate history where supported | Map supported legal/tax facts only | Unsupported corporate document metadata stays exception until evidence/GCS domain |
| `tes_business_corporate_documents_${companyId}` | Future evidence/GCS document metadata | Do not import as canonical business truth in Block 01 | Preserve snapshot only; defer to GCS/evidence block |
| `tes_company_citations_${companyId}` | Not fully supported by current PostgreSQL schema | Exclude from supported-domain closure; snapshot for future Roadside/Citations program | No runtime cutover until schema exists |
| `tes_repair_invoice_store_v4_${companyId}` | Not fully supported by current PostgreSQL schema | Exclude from supported-domain closure; snapshot for future Maintenance/Repair domain | No runtime cutover until schema exists |
| `tes_repair_document_intake_v1` | Future GCS/document intake | Exclude from this block except snapshot | Defer to GCS/intake program |
| `tes_vehicle_activity_${companyId}_${vehicleId}` | No canonical activity table besides Master Register | Treat as derived/history candidate; do not import as canonical unless target is created | Snapshot only |
| `tes_vehicle_settings_${companyId}_${vehicleId}` | No complete canonical vehicle-settings table found | Hold as unresolved | Snapshot only until product owner approves target |
| `tes_service_provider_store_v1` | Organizations/service-provider classifications where supported | Import as organizations only if provider identity is clear | Ambiguous provider records require review |
| `tes_activity_${companyId}` | Master Register is canonical accountability | Do not import as authoritative audit history | Snapshot only; may be reference/provenance |
| `tes_audit_events`, `tes_audit_log` | `master_register_events` | Do not treat as final immutable record; possible reference snapshot only | No automatic Master Register backfill without explicit review |
| `tes_system_settings` | Server-side system/customer settings target not fully identified | Split: UI defaults vs operational settings | Operational behavior settings cannot remain browser authority; unresolved target blocks cutover |
| Applicant draft/submitted local keys | Server driver application repository exists | Draft may remain temporary; submitted must sync to server | Submitted browser-only application cannot be final authority |
| IndexedDB evidence payload stores | Future GCS/evidence pipeline | Excluded from canonical data cutover except metadata/snapshot | Defer payload custody to GCS block |
| Sidebar cookie | Browser UI state | Retain | Non-authoritative |

### Field Classification Rules

| Classification | Meaning | Import behavior |
| --- | --- | --- |
| Canonical | Durable business fact supported by PostgreSQL | Import through authorized/canonical operation or import-only equivalent |
| Derived | Recomputable from canonical facts | Do not import unless needed for provenance/reporting |
| Presentation-only | UI labels, open tabs, filters, display preferences | May remain in browser; not part of canonical cutover |
| Obsolete | Prototype-only field with no current meaning | Preserve in snapshot; do not write canonical table |
| Unresolved | Business fact exists but canonical owner is missing/unclear | Hold as exception; cannot be silently dropped |
| Unsupported | Domain not represented in current PostgreSQL scope | Snapshot only; excluded from Block 01 supported-domain closure |

### Reconciliation Acceptance Criteria

Phase C import code must refuse to commit a domain unless:

1. Its source snapshot has a stable hash.
2. Its legacy ids resolve through a namespace-scoped continuity map.
3. Required parent mappings exist before child imports.
4. All canonical writes are idempotent.
5. Collisions are reported and held for review, not overwritten.
6. Unsupported fields are listed in the report.
7. Re-running the same import produces no duplicate canonical rows.

### Approved Phase C Execution Sequence

1. Extend continuity/import infrastructure.
2. Import and reconcile Companies/Customers first.
3. Import Locations and Contacts.
4. Import Vehicles and Drivers/Persons.
5. Import Authorities.
6. Import Tax/Registration and Company Operating Profile.
7. Import Insurance.
8. Import Credential metadata only.
9. Snapshot but exclude unsupported domains.
10. Only after successful import/reconciliation, begin runtime cutover.

## Phase C - Controlled Migration Infrastructure

Status: IN PROGRESS

Implemented so far:

1. `database/migrations/0029_canonical_data_cutover_import_infrastructure.sql`
   - Adds `LEGACY_IMPORT_READ` and `LEGACY_IMPORT_MANAGE`.
   - Preserves the original company-only `legacy_record_map`.
   - Adds `legacy_canonical_record_map` for non-company legacy entity continuity with target table/id.
   - Adds `legacy_import_batches`.
   - Adds `legacy_import_records`.
   - Adds `legacy_import_checkpoints`.
   - Adds `legacy_import_review_decisions`.
   - Adds no-delete/no-truncate guards.
   - Enables RLS and grants runtime access only through SYSTEM import capabilities.
2. `lib/auth/tes-capabilities.ts`
   - Adds the two new SYSTEM capability codes.
3. `lib/legacy-import/*`
   - Adds server-only authorized service/repository functions for batch lifecycle, source record insertion, status updates and review decisions.
   - Adds a safe non-company canonical-record mapping writer that refuses to remap an active legacy key to a different canonical record.
   - Adds deterministic source normalization, stable JSON hashing and unsupported-field detection.
   - Adds restart-safe staging: identical source-key/hash replays are accepted, but the same source key with changed source content is rejected.
   - Adds checkpoint writes at staging start, completion and failure.
   - Adds batch report reads for dry-run/commit summaries by status, entity type, exceptions and unsupported fields.
4. `lib/legacy-import/domains/companies.ts`
   - Adds a deterministic Companies/Customers domain staging plan for browser `tes_companies`.
   - Emits `COMPANY` source records for every browser company row and `CUSTOMER` child records for customer/prospect rows.
   - Preserves source snapshots, lists unmapped fields for review and explicitly does not write canonical `organizations` or `customers` rows.
5. `lib/legacy-import/domains/browser-stores.ts`
   - Adds deterministic staging plans for supported browser stores beyond Companies/Customers:
     - Locations/Contacts
     - Vehicles/Drivers
     - Authorities
     - Tax/Profile
     - Insurance
     - Credential metadata
   - Preserves parent company legacy ids where source stores are company-scoped.
   - Excludes credential secrets and evidence payload custody.
   - Explicitly keeps canonical writes disabled while Phase C remains infrastructure/staging only.
6. `scripts/database/verify-production-legacy-import-infrastructure.sh`
   - Adds a read-only production verification script for migration `0029`.
   - Checks migration ledger checksums, import tables, RLS, capabilities and absence of destructive privileges.
   - Logs public table row counts for pre/post comparison without changing data.
7. `test/lib/legacy-import/legacy-import-boundaries.test.ts`
   - Adds static boundary checks proving 0029 is infrastructure-only, preserves company continuity semantics, enables RLS, uses SYSTEM-only capabilities and records provenance/exception fields.
8. `test/lib/legacy-import/source.test.ts`
   - Proves source hashing is deterministic across object key order and unsupported fields are detected without mutating source snapshots.
9. `test/lib/legacy-import/companies-domain-boundaries.test.ts`
   - Proves the Companies/Customers staging adapter is scoped to `tes_companies`, emits company/customer records, keeps canonical writes disabled and preserves deterministic source keys.
10. `test/lib/legacy-import/browser-stores-domain-boundaries.test.ts`
   - Proves every supported non-company Phase C domain has a staging config and credential metadata excludes secrets.
11. `test/lib/legacy-import/repository-boundaries.test.ts`
   - Proves idempotency and checkpoint guardrails remain present in the repository layer.
12. `test/lib/legacy-import/legacy-import.db.test.ts`
   - Adds executable DB-backed fixtures for the real authorized legacy import service.
   - Proves batch creation/start, supported record staging, review-required unsupported-field reporting, idempotent replay and changed-content rejection.
   - Verifies those import operations do not mutate canonical organization/customer rows.
13. `scripts/test/run-auth-tests.sh`
   - Includes `test/lib/legacy-import/*.db.test.ts` in the disposable PostgreSQL authorization test suite.

### Recovery Procedure

Failed or partially completed Phase C batches are recovered through append-only correction, not destructive cleanup:

1. Keep the failed batch and all `legacy_import_records` as immutable evidence.
2. Read the batch report and checkpoint state to identify the failed domain and last processed source key.
3. Fix source export data or domain mapping code outside the failed batch.
4. Create a new import batch with the same `source_system` and `source_namespace`.
5. Re-stage the corrected records. Identical source-key/hash records replay idempotently; changed content under the same source key is blocked and must be represented by a corrected source snapshot.
6. Use `legacy_import_review_decisions` for manual resolutions. Do not overwrite canonical rows from an unresolved collision.
7. Only commit canonical writes after dry-run reports show no failed records, no unresolved parent mappings and no unsupported canonical fields.
8. Browser source stores remain read-only migration inputs until Phase D runtime cutover and Phase E retirement verification are complete.

Verification so far:

1. `node --test test/lib/legacy-import/legacy-import-boundaries.test.ts test/lib/legacy-import/source.test.ts test/lib/legacy-import/companies-domain-boundaries.test.ts test/lib/legacy-import/browser-stores-domain-boundaries.test.ts test/lib/legacy-import/repository-boundaries.test.ts` passed.
2. Full TypeScript still fails from existing repository errors, but targeted grep of the TypeScript output shows no errors from `lib/legacy-import`, `test/lib/legacy-import`, `lib/auth/tes-capabilities.ts`, or `0029_canonical_data_cutover_import_infrastructure.sql`.
3. `bash scripts/test/run-auth-tests.sh --test-name-pattern='Legacy import infrastructure'` could not run in this environment because PostgreSQL server binaries (`initdb`) are unavailable and no `TES_TEST_ADMIN_DATABASE_URL` / `TES_TEST_RUNTIME_DATABASE_URL` disposable DB URLs are configured.

Remaining work before Phase C can close:

1. Run the existing DB-backed legacy import fixture against PostgreSQL once server binaries or disposable `TES_TEST_*` URLs are available.
2. Run `scripts/database/verify-production-legacy-import-infrastructure.sh` against a real migrated database.

## Phase D - Application Runtime Cutover

Status: NOT CLOSED

Required next work:

1. Add server routes/actions for canonical reads/writes over the existing service layer.
2. Cut over Companies/customers first because every module depends on them.
3. Cut over dependent modules in this order:
   - Locations/contacts
   - Vehicles/drivers identity
   - Authorities
   - Tax/registration and operating profile
   - Insurance
   - Credential metadata
4. Remove localStorage fallback paths that silently recreate canonical business records.
5. Keep only explicitly approved UI-state persistence.

## Phase E - Verification and Permanent Retirement

Status: NOT CLOSED

Required next work:

1. Compare source snapshots to imported canonical rows.
2. Verify app behavior across browser reloads, different browsers, and authenticated sessions.
3. Test RLS and unauthorized/cross-company access.
4. Verify Master Register coverage for runtime operations.
5. Run regression tests across affected modules.
6. Keep legacy source snapshots until recovery conditions are satisfied.
7. Remove obsolete browser persistence code only after successful cutover validation.

## Current Closure Decision

Phase A is closed because the repository-wide persistence surface, PostgreSQL ownership, security boundary, and implementation gaps are now identified.

Block 01 is not closed through E. The repository still has browser-authoritative business records in production paths. Phase C now has core import infrastructure, supported-domain staging, recovery procedure documentation, database-backed collision/idempotency fixtures and a production verification script, but it is not closed until those database checks run against PostgreSQL.

