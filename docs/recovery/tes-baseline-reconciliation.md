# TES baseline reconciliation

Status: working document for PR #20 (`claude/company-recovery-clean`). It **adds** to, and does not replace, the historical records
(`docs/canonical-data-cutover-browser-authority-retirement.md`, `docs/*-boundaries.md`, `docs/system-wide-authorization-rls-closure.md`,
`docs/contracts-foundation.md`, `docs/evidence-*.md`, `docs/audits/TES_SYSTEM_INTEGRITY_AUDIT.md`, `docs/company-recovery.md`).

## How this was produced

A read-only audit of the repository (migrations 0001-0032, services, RLS policies, capability definitions, Master Register, tests, docs
and git history including the root snapshot `2644183` and the Block 01 D/E cutover commits) by an independent reviewer, then spot-checked
and extended by the implementer. **Where the repository cannot establish a historical approval the item is marked unresolved; nothing
here invents an approval.** The repository has no document that defines "the 19 blocks" or records a human approval of them: the only
named block is "Block 01" (canonical data cutover). "Closed" below therefore means *a document or a production-closure workflow in the
repository says so*, never "approved by the owner".

Evidence limits worth stating: (a) `2644183` is a root commit that adds the whole prototype (603 files); UI history before it is not
recoverable file by file; (b) the integrity audit cites a HEAD (`4b1b804`) that is not in this repository; (c) several early
migrations were edited after first commit (0013, 0014, 0020-0024) before their production-closure runs; whether production applied earlier
text cannot be proven from the repository (the checksum guard would have blocked a divergence); (d) `docs/canonical-data-cutover-browser-authority-retirement.md`
was last edited before the Phase D/E cutover commits and is stale.

## Classification summary (state audited: 12dbaf8; updated for this PR's later commits in the right-hand column)

| # | Block | Classification | Change in this PR |
| --- | --- | --- | --- |
| 1 | Database foundation, migration governance | Foundation implemented and verified | none (no migration touched) |
| 2 | Organization and customer/tenant | Implemented, integration incomplete | creation/profile/edit completed on canonical domains; 10 form fields still have no canonical owner |
| 3 | Tenant isolation and RLS | Implemented and verified (SYSTEM-scope caveat) | none; capability switching reviewed (see docs/company-recovery.md) |
| 4 | Authentication and authorization | Implemented and verified (send-invitation route lacks a TES capability check) | none; **open finding, not changed here** |
| 5 | Master Register | Implemented and verified (no viewer UI; legacy audit stores unreconciled) | events verified for create/edit; viewer not built |
| 6 | Operating profile and locations | Implemented, integration incomplete | Settings and Edit workspaces connected |
| 7 | Contacts and person identity | Implemented, integration incomplete | Contacts workspace exposes name change/correction, titles, purposes, primary, end/archive/restore, duplicate review |
| 8 | Customer relationships and onboarding | Implemented, integration incomplete | start date at creation; ending service with a reason from Edit |
| 9 | Vehicle identity | Existing functionality regressed (UI) | atomic creation, counts, scoping; rich UI NOT restored (conflict, see regression matrix) |
| 10 | Driver identity/qualification | Existing functionality regressed | original workspace reachable (browser-local tab); canonical creation still absent |
| 11 | Operating authorities | Existing functionality regressed (UI) | edit/correct/history over existing operations; original workspace reachable (browser-local tab) |
| 12 | Tax registrations and filings | Existing functionality regressed (filing workspace) | edit/correct/history; original workspace reachable (browser-local tab); filing calendar/records still no canonical home |
| 13 | Insurance | Existing functionality regressed | renew and cancel over existing operations; original workspace reachable (browser-local tab) |
| 14 | Credentials | Metadata integrated; secret custody unresolved | parity fix (new credentials start "needs verification"), search/filter, verification picker; original workspace reachable (browser-local tab, never stored secrets) |
| 15 | Evidence and document references | Implemented, integration incomplete | none |
| 16 | Settings and rule applicability | Implemented, integration incomplete | canonical Settings workspace (scope, rules, driver minimums) |
| 17 | Company navigation | Implemented, integration incomplete | canonical company resolution in sidebar/header |
| 18 | OCR / document intake | Approved architecture not yet implemented | none (legacy OCR remains closed by default) |
| 19 | Business Intelligence / Decision Support | Approved architecture not yet implemented | none |

The detailed per-block matrix follows verbatim from the audit (purpose, migration and dependency order, tables, authorization and
tenant boundary, services, Master Register/evidence requirements, tests/docs, status, UI integration, gaps).

---

# TES Portal foundations audit (read-only; evidence: repo files + git history)

HEAD audited: 12dbaf8 on branch claude/company-recovery-clean (main = cfc54cc-ish ancestor chain; PR #18 included). Migrations 0001-0032 contiguous.
Caveat: commit 2644183 ("Build Core Operational Identity Graph foundation", 2026-10-11) is a ROOT commit (no parent) that adds 603 files / ~1.0M lines,
i.e. the whole pre-existing app/ prototype appears in git only as that snapshot. UI history before 2644183 is not recoverable file-by-file.
The integrity audit (docs/audits/TES_SYSTEM_INTEGRITY_AUDIT.md) cites HEAD 4b1b804, which is not in this repo.
NO document in the repo defines the "19 blocks" or records a human approval; "Block 01" (canonical data cutover) is the only named block. Anything about
"approved by owner" is therefore UNRESOLVED except where a doc says CLOSED / owner-approved / production-closure workflow was run.

## A. Declared closure status from docs
| Item | Declared | Source |
|---|---|---|
| Companies foundation 0016-0019 | "CLOSED at 0019", 0020 not required | docs/companies-foundation-boundaries.md (last section) |
| Core Operational Identity 0020-0023 | closed; production closure workflow run 2026-10-11 | docs/core-operational-identity-boundaries.md; commits c4f5cae/cc00a03/80f4fb1 |
| System-wide Authorization+RLS 0024 | "Close ... foundation" da896ee; prod closure d3cbe44 | docs/system-wide-authorization-rls-closure.md |
| Identity additions 0025-0028 | PR #5 merged; policy-only 0027/0028 | docs/identity-additions-boundaries.md |
| Block 01 Phase A, B | CLOSED | docs/canonical-data-cutover-browser-authority-retirement.md |
| Block 01 Phase C (0029 import infra) | IN PROGRESS; DB fixture + prod verifier never run in doc's env; PR #6/#7 merged | same doc |
| Block 01 Phase D (runtime cutover) | "NOT CLOSED" in doc (doc last edited fb5b758, BEFORE the D/E cutover commits) | same doc; git log of file |
| Block 01 Phase E (verification/permanent retirement) | NOT CLOSED | same doc |
| Overall: "Block 01 is not closed through E" | yes | same doc |
| Onboarding evidence + contracts 0030 | production closure workflow run (e4fdd00) | .github/workflows/onboarding-evidence-contracts-production-closure.yml |
| Contracts 0031 | merged PR #15; prod verify workflow exists; "Production" section says apply+verify later; closure run for 0031 not evidenced | docs/contracts-foundation.md |
| Evidence payload 0032 | docs/evidence-lifecycle-production-acceptance.md says "Infrastructure gates for 0032 are closed (ledger 32; storage config verified). Nothing here has been executed in production." Smoke test P1-P9 NOT run; scanner deploy "Not applied"; stalled-payload job "Not implemented" | that doc |
| Company recovery | repair of integration defects, no migration; "Remaining blockers": no preview/prod capability check | docs/company-recovery.md |

Rules on browser storage (canonical-data-cutover doc, "Closure Rule"): PostgreSQL is canonical for supported domains. Browser storage may remain ONLY for
explicitly approved non-authoritative UI state, temporary drafts, or migration source snapshots; it "must not create, restore, overwrite, or govern durable
business records". Approved-to-remain: sidebar cookie; applicant draft (temporary). Everything else in the Phase A inventory is "must be retired/reconciled"
or "unsupported/unresolved: snapshot only" (citations, repair invoices, repair intake, vehicle activity, vehicle settings, service providers, tes_system_settings,
IndexedDB evidence stores). Phase D required order: companies/customers -> locations/contacts -> vehicles/drivers -> authorities -> tax/profile -> insurance -> credentials;
"remove localStorage fallback paths that silently recreate canonical business records".
Modules actually cut over (git): company creation a80c1e2; directory (companies/customers list, profile read) 989d1ef/fd4f160 (PR merge 2755255); profile+edit 2657be9;
authorities+tax a36acf1; insurance 0ba9436; credentials e4fa336; vehicles+drivers 0e8e8c3; business identity 971e15e; orphan insurance UI removed 38cffb8; merge b63573b.
Contacts + Settings got canonical workspaces only in company-recovery (b203608, 661b521) with legacy browser workspace still default-reachable (LegacyWorkspaceGate).
NOT cut over: Citations, Driver detail (/drivers/[driverId]), legacy Contacts tab, legacy Settings tab, /settings (system), driver-application local draft/submission store.

## B. Git timeline (app/ UI, file level)
- 2026-08-20 .. 09-30: scanner/ClamAV work (services/document-security-scanner), validation/clamd-phase1.
- 2026-10-02: Master Register foundation 1b360d1/272663a; ingestion contracts f5d4abc; quarantine ingestion 3f7c084.
- 2026-10-10: authorization execution tests e9891f0; corporate-identity/locations/authorities/contacts server layers + 0012-0014 (no UI).
- 2026-10-11: 0015; 0016-0019 + server layers (8c3eac6..82daa06); 2644183 root snapshot: ALL prototype app pages in browser-localStorage form
  (authorities 1576 lines, tax-filing 1511, insurance 1923, vehicles 1061, credentials 1258, business 996, citations 1266, contacts 934, settings 1127,
  companies/new 2531, profile 504, edit 484, drivers 109 + [driverId] 233; api: document-ai 172, document-intake 247, business-document-ocr 51,
  driver-applications x2) + 0020-0022; identity CI/closure fixes (edits to 0020-0023 same day, before production closure run); 0024 RLS closure (1265888..da896ee).
- 2026-10-12: 0025-0028 (PR #5); 0029 legacy import infra (PR #6/#7, lib/legacy-import, no UI/route); Block 01 D/E cutover (PR merge b63573b):
  profile/edit -> /api/companies/[id]; authorities 1576->23 lines (CanonicalRegistryPanel), tax-filing 1511->23, insurance 1923->267, vehicles 1061->183,
  drivers 109->95 (list only, "Adding a driver is deferred"), credentials 1258->252, business 996->102; 10 insurance components deleted (38cffb8), others orphaned
  (src/components/{authorities,business,tax-filing,vehicles,drivers,insurance}/... no importers). New routes under app/api/companies/[id]/{authorities,tax-registrations,insurance,credentials,vehicles,drivers,profile}, app/api/credential-systems.
  Tests pin it: test/lib/phase-de/phase-de-cutover-boundaries.test.ts ("keeps every cut-over page off browser persistence").
- 2026-10-12/13: onboarding workspace (ab39893..108d250; app/companies/[id]/onboarding/page.tsx + api/onboarding); 0030 evidence/contracts shell (d47999a);
  0031 contracts (PR #15, contracts-panel.tsx); 0032 evidence payload lifecycle (PR #16/#17: evidence-panel.tsx, api/companies/[id]/evidence*, document-intake rewritten to quarantine-only,
  document-ai + business-document-ocr CLOSED by default via lib/legacy-ocr, 121dd3a/e4e476a/ede014b); scanner deploy hardening 0706290; GCS IAM scripts d4b2564.
- Company recovery (branch claude/company-recovery-clean, 5c00c45..12dbaf8): canonical create-company (fixes data-dropping creation), profile from canonical domains, edit of region+addresses,
  LegacyWorkspaceGate (existing browser workspaces reopened for canonical companies), canonical Contacts and Settings workspaces, company-lookup (failed != not found), URL-company guard on insurance/credentials,
  atomic vehicle creation, placeholder pages for record-of-events/customs/programs (previously 404), CI + browser harness.

## C. Matrix (one block per section)

### 1. Database foundation & migration governance
- Purpose: contiguous, immutable, checksummed, transactional migrations via dedicated migrator identity; runtime has no DDL or tes_system access. (database/README.md)
- Migrations: 0001_database_foundation (schema privileges), 0002_runtime_privilege_hardening (no default grants; explicit per object). Runner scripts/database/migrate.sh: advisory lock 741938221,
  tes_system.schema_migrations(version, filename UNIQUE, sha256, applied_at, applied_by), bidirectional repo<->ledger reconciliation, rejects BEGIN/COMMIT/psql metacommands.
- Tables: tes_system.schema_migrations only.
- Authz: SYSTEM infrastructure, REVOKE ALL from PUBLIC; migration identity tes-database-migrator@tes-production-510007.iam; runtime tes-backend@...iam.
- Services: none (scripts/database/*). Workflows: production-database-migration.yml (workflow_dispatch, main only, WIF, Cloud SQL proxy pinned sha256);
  CI chain tests (system-wide-authorization-rls-ci.yml builds DBs at 24/28/29/30/31/32 and asserts ledger count); ~20 production-*-verification workflows + scripts/database/verify-production-*.sh;
  verification fragments scripts/database/verification/companies/{0016..0019,0025..0028,baseline}.sql generated by generate-expectations.py.
- Evidence reqs: n/a. Tests/docs: database/README.md; test/database/*.sql; test/lib/auth/*.db.test.ts; scripts/test/run-auth-tests.sh.
- Status: implemented and verified (CI + prod ledger 32 per evidence-lifecycle doc).
- UI: none. Gaps: (a) 0013, 0014, 0020-0024 each have multiple commits (git log -- file: 0013 x3 edits, 0014 x2, 0020 x4, 0021 x6, 0022 x5, 0023 x2, 0024 x4) so "immutable once applied" was honoured only if none were applied before the edits
  -> edits dated before prod closure runs, but whether prod had applied earlier text is UNRESOLVED from repo (checksum guard would have blocked divergence);
  (b) next.config.mjs:4 ignoreBuildErrors: true; TS is only a diff-vs-base gate in CI (normalize-tsc-diagnostics.py); (c) package.json has only "test:auth" script; many test dirs rely on node --test invoked per workflow;
  (d) no CI for the app lint/build on PR other than TS-diff gates; (e) 41 DB + 4 static tests "fail identically on main" (docs/company-recovery.md).

### 2. Organization + customer/tenant foundation
- Purpose: canonical organization identity (legal/display name, identifiers, aliases, classifications); a Customer is a tenant/relationship of an Organization; engagements. (0003 header)
- Migration: 0003_canonical_organization_customer_foundation (after 0001-0002); capability seeds in 0011_companies_capability_catalogue; legacy continuity 0010; guard 0016 guard_active_organization.
- Tables: organizations, organization_identifiers, organization_aliases, organization_classification_types, organization_classifications, customers, customer_engagements.
- Authz: SYSTEM caps ORGANIZATION_REGISTRY_READ/CREATE/UPDATE/ARCHIVE, CUSTOMER_ESTABLISH; CUSTOMER cap ORGANIZATION_READ (lib/auth/tes-capabilities.ts). RLS 0024: organizations_system, organizations_customer_read, customers_system, customers_requested_scope_read, organization_{identifiers,aliases,classifications}_{system,customer}; amended by 0027 (organizations_system) and 0028 (final list + identifiers/aliases/classifications/engagement_stages).
- Services: lib/corporate-identity/{service,operations,repository,identifier-definitions,normalization,jurisdiction}.ts; lib/company-directory/{service,create-company,update-company,read-profile,creation-input,capability-context}.ts; lib/customer-relationship (engagement).
- MR/evidence: operations append RECORD_CREATED/UPDATED/CORRECTED/STATUS_CHANGED/ARCHIVED in same transaction. Evidence: none required.
- Tests/docs: test/lib/corporate-identity, test/lib/company-directory (company-creation.db.test.ts), docs/companies-foundation-boundaries.md, docs/company-recovery.md.
- Status: Foundation implemented but integration incomplete (create/read/edit canonical; edit limited to identity, region, addresses; Customer fields without storage disabled).
- UI: app/companies/page.tsx, app/customers/page.tsx (API /api/companies, /api/customers), app/companies/new/page.tsx -> POST /api/companies, [id]/edit, [id]/profile, app/profile/page.tsx.
- Gaps: no canonical home for website, gstHst, svcType, status, endDate, payMethod, cargoTypes, gpsProvider, fuelProvider, assessmentDate (company-recovery table); CARGO_STORAGE_AVAILABLE=false; no archive/delete UI (audit F-003 hard-delete was in prototype); companyType not editable.

### 3. Tenant isolation & RLS
- Purpose: customer UUID is never authority; CUSTOMER access = transaction-local customer + actor + capability re-proven by PostgreSQL; SYSTEM capability-specific; RLS enabled not forced; runtime not owner/BYPASSRLS. (docs/system-wide-authorization-rls-closure.md)
- Migrations: 0004_tenant_isolation_foundation (tes_security schema, current_customer_id), 0007_tenant_context_hardening (UUID-version relaxation), 0024_system_wide_authorization_rls_closure (RLS on ~32 stmt ENABLE sites, helper fns system_context_authorized, customer_context_authorized, accessible_customers_for_actor, current_*), 0025/0026 (new-table policies), 0027 + 0028 (policy-only ALTER POLICY), 0020-0022/0023 deferred RLS to 0024.
- Tables: all canonical business tables (classification list in doc); credentials + entity resolution SYSTEM-only; master_register_events RLS; 0029-0032 tables SYSTEM-only policies (*_system_read/insert/update) with no CUSTOMER path.
- Policy names: <table>_system and <table>_customer(_read) per 0024; vehicle_merges_system; insurance_coverage_vehicles_{system,customer}; legacy_* *_system_{read,insert,update}; evidence_payloads_system_*.
- Services: lib/auth/tes-customer-context.ts, tes-system-context.ts, tes-accessible-customers.ts, tes-transaction-guard.ts, tes-authorization-sql.ts.
- Tests: test/database/system-wide-authorization-rls.sql, test/lib/system-rls/system-policy-closure.db.test.ts, scripts/database/test-system-wide-rls-mutations.sh (mutation-kill), workflows system-wide-authorization-rls-ci.yml, -production-closure.yml, production-authorization-verification.yml.
- Status: Foundation implemented and verified for 0001-0028; later tables (0029-0032) are SYSTEM-only verified by their own verifiers.
- UI: not directly; all company API routes use withAuthorizedSystem. No CUSTOMER-scope UI exists (customer-facing portal absent: src/components/client-portal is orphaned; docs say "no customer-facing evidence access").
- Gaps: SYSTEM capabilities are global to TES staff (evidence doc "Scope note"): within SYSTEM scope tenant isolation is by query predicate, not RLS (core-operational-identity-boundaries.md "RLS boundary"); RLS not FORCEd; 0027/0028 patched capability omissions found only by later operations => policy/operation drift risk; production capability grants for company creators "not verifiable" (company-recovery).

### 4. Authentication & authorization context
- Purpose: Clerk -> TES Actor boundary; Master Account authority; capability evaluation; wrappers withAuthorizedSystem / withAuthorizedCustomer keep auth and work in one transaction.
- Migrations: 0005_actor_authentication_identity_foundation (actors, authentication_identities), 0006_authorization_foundation (master_account_authority, actor_relationships, relationship_assignments, capabilities, relationship_capability_grants), 0011 (6 caps), later seeds in 0014-0022, 0024 (MASTER_REGISTER_READ), 0029, 0030.
- Code: lib/auth/{tes-actor,tes-authorization-core,tes-authorization,tes-capabilities,tes-system-context,tes-customer-context,tes-accessible-customers}.ts; proxy.ts (Clerk middleware, auth.protect except /driver-application and POST submissions).
- Authz scope: caps declared in TES_CAPABILITY_SCOPES (32 codes); drift test test/lib/auth/tes-capabilities.test.ts vs DB.
- Bootstrap: scripts/database/bootstrap-first-actor.sh, bootstrap-first-master-account.sh + production-first-* workflows.
- Tests: test/lib/auth/*.db.test.ts, tes-boundaries.test.ts; docs: system-wide-authorization-rls-closure.md.
- Status: Foundation implemented and verified. UI: every /api/companies/** route; app/api/driver-applications/send-invitation has NO TES actor/capability check (Clerk sign-in only through proxy.ts).
- Gaps: audit D-01 (auth approach) predates; no role/RBAC UI; grants are operator SQL only; send-invitation route lacks withAuthorized*; lib/current-user.ts is a hard-coded "System Administrator" used by app/settings/page.tsx (check) ; no customer-scope capability other than ORGANIZATION_READ.

### 5. Master Register & immutable accountability
- Purpose: append-only event register with versioned event catalogue (20 families), actor/customer/resource/subject dimensions.
- Migrations: 0008_master_register_persistence (master_register_events, append-only triggers), 0009_master_register_customer_context (customer_id generated from target.customerId; legacy_company_id), 0024 RLS (read needs MASTER_REGISTER_READ; append allowed to authorized ops).
- Code: lib/master-register/{event-types,record-event,postgres-repository,repository,coverage,limits,actor-identity,assessment,server,index}.ts. Fix 18db400: append() no RETURNING under RLS.
- Tests: test/lib/master-register/*, postgres-repository-rls.db.test.ts; workflow production-master-register-verification.yml.
- MR requirement: each domain operation records an event in the same DB transaction (verified via grep of eventType usage across lib/*/operations.ts); evidence payload views write DOCUMENT_VIEWED before bytes.
- Status: Foundation implemented and verified. UI: NO read/viewer UI (record-of-events page is a DeferredWorkspace notice; lib/master-register/index.ts header lists localStorage buffers as non-canonical).
- Gaps: legacy client-side audit/activity stores (lib/audit-log.ts, audit-logger.ts, activity-log.ts, audit-case-store.ts) still exist and are used by citations/driver detail (audit F-013, D-06 unresolved); no consolidation decision; no Master Register backfill from browser history by design.

### 6. Company operating profile & locations
- Purpose: effective-dated operating scope/region, rule applicability, driver requirement minimums (0019); locations/addresses/home yard (0012).
- Migrations: 0012_organization_locations_foundation (after 0003); 0019_company_operating_profile_foundation (after 0003, 0016 programs).
- Tables: locations, location_addresses, organization_location_assignments; company_profile_rules (45-rule catalogue), company_operating_scope_periods, company_rule_applicability_periods, company_driver_requirement_periods.
- Authz: 0012 reuses ORGANIZATION_REGISTRY_READ/ORGANIZATION_UPDATE; 0019 COMPANY_PROFILE_READ/MANAGE; RLS via 0024 (locations_system/customer etc., company_*_system/customer).
- Code: lib/organization-locations/*, lib/company-profile/{service,operations,legacy,definitions}.ts.
- Tests: test/lib/organization-locations, test/lib/company-profile, companies-foundation-boundaries.test.ts; workflow production-organization-locations-verification.yml.
- Status: Foundation implemented but integration incomplete. UI: addresses via create/edit forms (company-directory); settings tab app/companies/[id]/settings/canonical-settings.tsx -> /api/companies/[id]/settings; no standalone locations page.
- Gaps: legacy settings tab (1127 lines, localStorage tes_company_compliance_settings_*) remains reachable, default tab is canonical; rule applicability/driver-minimum UI coverage unverified; app/settings (system settings) browser-only with unresolved target.

### 7. Contacts & person identity
- Migration: 0014_contacts_people_foundation. Tables: contact_purpose_types, persons, person_name_versions, person_channels, organization_channels, organization_person_relationships, organization_person_titles, contact_purpose_assignments.
- Authz: PERSON_REGISTRY_READ, CONTACT_MANAGE (SYSTEM); RLS 0024 *_system/*_customer; 0027 adds INSURANCE_MANAGE to organization_person_relationships_system.
- Code: lib/contacts/*. Tests: test/lib/contacts; workflow production-contacts-verification.yml; commit 6bc8d87 (current name per person).
- MR: RECORD_* events. Status: Foundation implemented but integration incomplete.
- UI: app/companies/[id]/contacts/canonical-contacts.tsx + /api/companies/[id]/contacts (added b203608, recovery branch); page still wraps 934-line browser-local legacy workspace via LegacyWorkspaceGate; app/contacts/page.tsx (global) not canonical.
- Gaps: legacy contacts store v3/v4/v5 (audit F-027) still writable; person merges not represented (identity-additions doc); legacy contacts page includes simulated licence OCR (audit F-007/Segment 09) - status unknown.

### 8. Customer relationships & onboarding
- Migrations: 0015_customer_relationship_foundation (engagement types, stages, product levels, service catalogue, agreements, scopes, responsibility periods); 0030_onboarding_evidence_contracts_foundation (evidence_documents, evidence_links, onboarding_evidence_requirements, onboarding_readiness_snapshots, customer_authority_assignments, customer_contracts, line items); 0031 contracts (see 15/extra).
- Authz: CUSTOMER_RELATIONSHIP_READ/MANAGE, CUSTOMER_ESTABLISH; EVIDENCE_*; CONTRACT_READ/MANAGE (SYSTEM). 0030/0031 policies SYSTEM-only (*_system_read/insert/update); 0024 policies for 0015 tables.
- Code: lib/customer-relationship/*, lib/customer-onboarding/service.ts (getCustomerOnboarding, applyCustomerOnboardingAction), lib/onboarding-foundation/service.ts, lib/contracts/{service,operations,definitions}.ts.
- MR/evidence: onboarding readiness counts only verified/waived/not_applicable evidence; contract gates tes_security.contract_gate_failures; every contract status/authority change needs verified evidence + MR event.
- Tests: test/lib/customer-relationship, customer-onboarding/onboarding-boundaries.test.ts, onboarding-foundation, contracts/*; docs/contracts-foundation.md; workflows contracts-foundation-ci.yml, onboarding-evidence-contracts-production-closure.yml, production-customer-relationship-verification.yml.
- Status: Foundation implemented but integration incomplete (0030 closed in prod; 0031 prod closure not evidenced; 0032 smoke tests unrun).
- UI: app/companies/[id]/onboarding/page.tsx, contracts-panel.tsx, evidence-panel.tsx; API /onboarding, /contracts, /evidence.
- Gaps: invoices/billing/e-signature out of scope; Service Status/PayMethod at company level have no home; onboarding page is dependent on all other (reduced) panels.

### 9. Vehicle identity & relationships
- Migrations: 0020_vehicle_identity_foundation, 0022 entity resolution, 0023 temporal/merge integrity hardening, 0025_insurance_scheduled_vehicles_foundation, 0026_vehicle_merge_ledger, 0027 (org policy).
- Tables: vehicle_types, vehicles, organization_vehicle_relationships, vehicle_registration_periods, insurance_coverage_vehicles, vehicle_merges.
- Authz: VEHICLE_READ/MANAGE, IDENTITY_RESOLUTION_*; vehicles policies in 0024 (system+customer via relationship); vehicle_merges_system only.
- Code: lib/operational-identity/{service,operations,reads,legacy,normalization}.ts, lib/vehicle-merges/*, lib/insurance (schedule ops).
- Tests: test/lib/operational-identity, identity-graph/identity-additions-boundaries.test.ts, vehicle-merges; docs core-operational-identity-boundaries.md, identity-additions-boundaries.md; workflows core-operational-identity-ci/production-closure.
- Status: Existing functionality regressed (UI) on top of an implemented, verified foundation. Foundation: verified. UI: app/companies/[id]/vehicles/page.tsx (183 lines, create + list via /api/companies/[id]/vehicles) replaced 1061-line workspace; page footer line 178 says permits, inspections, repair bills, ownership/registration docs, vehicle evidence deferred.
- Gaps: src/components/vehicles/* (maintenance, inspections, permits, registration, ownership, settings, activity) orphaned with their localStorage keys; vehicle settings/activity/repair have no canonical owner (doc Phase B "unresolved"); no UI for merge/schedule/registration periods; vehicle-driver assignment deliberately not canonical.

### 10. Driver/person identity & qualification
- Migration: 0021_driver_person_identity_foundation (+0022, 0023). Tables: driver_profiles, driver_licences, organization_driver_relationships, driver_medical_qualification_periods. Authz DRIVER_READ/MANAGE; 0024 policies.
- Code: lib/operational-identity (same), driver legacy lib/driver-data.ts (browser), lib/driver-performance-*.ts (browser/schema stubs), lib/server/driver-application-submission-repository.ts (JSON file store).
- Tests: test/lib/operational-identity, test/lib/drivers/* (performance suites).
- Status: Existing functionality regressed / integration incomplete. UI: app/companies/[id]/drivers/page.tsx (95 lines) lists drivers from /api/companies/[id]/drivers; "Adding a driver is deferred"; app/companies/[id]/drivers/[driverId]/page.tsx still DriverWorkspace on lib/driver-data (localStorage/IndexedDB) under LegacyWorkspaceGate; src/components/drivers/DriverList, DriverIntelligenceView orphaned.
- Gaps: no createPerson/driver creation service ("no canonical service that creates a standalone Person yet" - drivers page.tsx:89); DOB/addresses/performance events/citations/training/screening/evidence have no canonical storage; audit F-006 (shared DriverMaster overwrite) persists in the legacy path; driver application invitation/submission flow is JSON-file + localStorage (audit F-010); person/driver merge not designed.

### 11. Operating authorities
- Migration: 0013_operating_authorities_foundation. Tables authority_kinds, operating_authorities, operating_authority_versions, operating_authority_status_periods. Kinds USDOT, MC (docket identity), MVID, RIN, CVOR, SAFETY_FITNESS, IRP (docs/operating-authorities-regulatory-semantics.md).
- Authz: ORGANIZATION_REGISTRY_READ / ORGANIZATION_UPDATE (no dedicated authority capability); 0024 policies operating_authorities_system/customer etc.
- Code: lib/operating-authorities/{service,operations,definitions,repository}.ts. Tests: test/lib/operating-authorities (definitions + db). Workflow production-operating-authorities-verification.yml; verifier edited after merge discussions (0d8bd3c).
- Status: Foundation implemented, integration incomplete / UI regressed. UI: app/companies/[id]/authorities/page.tsx = CanonicalRegistryPanel (23 lines) -> /api/companies/[id]/authorities(+/[authorityId]); replaced 1576-line page with OCR workspace, safety/audit records, evidence. Orphans: src/components/authorities/ocr-workspace.tsx, record-inspector.tsx; lib/authorities/model.ts (browser).
- Gaps: MC entitlements (authority grants per docket) deferred "additive child table"; safety records, audit records, authority evidence, OCR intake have no canonical storage; app/authorities/page.tsx global is static; lib/audit-regimes/* browser-based.

### 12. Tax registrations
- Migration: 0016_tax_registration_foundation. Tables registration_programs (seeded), registrations, registration_versions, registration_status_periods. Authz TAX_REGISTRATION_READ/MANAGE; 0028 widens registrations_system USING by COMPANY_PROFILE_READ.
- Code: lib/tax-registrations/*. Tests test/lib/tax-registrations; shared verifier scripts/database/verify-production-companies-foundation.sh (fragments 0016.sql).
- Scope exclusions: filing obligations, returns, payments, decals, portal logins, evidence; IRP/USDOT/MC in 0013; Form 2290.
- Status: Foundation implemented, UI regressed. UI: app/companies/[id]/tax-filing/page.tsx = CanonicalRegistryPanel (23 lines) -> /api/companies/[id]/tax-registrations; replaced 1511-line workspace (TaxProfileWorkspace, FilingCalendarWorkspace, FilingRecordsWorkspace now orphaned). Gaps: filing calendar/records/evidence "no canonical PostgreSQL storage yet" (page.tsx:19); no filing-obligation domain approved (unresolved).

### 13. Insurance
- Migrations: 0017_insurance_foundation, 0025 scheduled vehicles, 0027 policy (INSURANCE_MANAGE reads organization_person_relationships). Tables insurance_coverage_types, insurance_policies, insurance_policy_terms, insurance_endorsements, insurance_coverages, insurance_broker_periods, insurance_coverage_vehicles.
- Authz INSURANCE_READ/MANAGE; 0024 policies; 0025 insurance_coverage_vehicles_{system,customer}.
- Code: lib/insurance/{service,operations,repository,legacy,definitions}.ts. Tests test/lib/insurance; docs companies-foundation-boundaries.md, identity-additions-boundaries.md.
- MR/evidence: stable ids insurance_policy_terms.id as evidence attachment; no certificates/COI groups, no evidence link yet.
- Status: Foundation implemented and verified; UI integration incomplete/regressed. UI: app/companies/[id]/insurance/page.tsx (267 lines; GET/POST/PATCH /api/companies/[id]/insurance[/policyId]) replaced 1923-line page; 10 components deleted (38cffb8) incl. InsuranceOCRWorkspace, WorkersCompSection, SuretyBondsSection, BrokerUpdateDialog; some remain orphaned (InsuranceSummary, InsuranceDocumentIntake, InsuranceArchiveDialog).
- Gaps: certificates, certificate evidence, OCR intake deferred (page.tsx:263); no schedule-vehicle UI; renewals do not carry schedule (by design).

### 14. Credentials & sensitive info
- Migration: 0018_company_credentials_foundation. Tables credential_categories, credential_systems, credential_system_aliases, company_credentials, credential_status_periods, credential_verifications, credential_secret_slots (slot state + opaque secret-store reference ONLY).
- Authz CREDENTIAL_READ/MANAGE (SYSTEM only; no CUSTOMER policy by design). Code lib/company-credentials/*. Event CREDENTIAL_READ in code. Tests test/lib/company-credentials; phase-de test forbids password/secretValue fields.
- Status: Foundation implemented; UI integration complete for metadata only (app/companies/[id]/credentials/page.tsx 252 lines; /api/companies/[id]/credentials, /api/credential-systems). Secret custody: approved-design excluded ("storing them is deferred until the secret-handling workflow is approved", credentials page.tsx:248) => Unresolved architectural decision for secret store.
- Gaps: 1258-line prior UI replaced (regression of functionality, intentional); legacy tes_company_credentials_* / tes_portal_registry_v1 remain in browser until Phase E; no secret manager integration.

### 15. Evidence & document references
- Migrations: 0030 (evidence_documents, evidence_links, onboarding_evidence_requirements), 0031 (contract_evidence_rules, contract evidence requirements), 0032_evidence_payload_lifecycle (evidence_payloads, evidence_payload_access_events).
- Authz EVIDENCE_READ/MANAGE (SYSTEM only), RLS evidence_payloads_system_*; tests test/database/evidence-payload-rls.sql.
- Code lib/evidence-payload/{service,operations,gcs-adapter,object-keys,validation,consistency,ports}.ts, lib/google/{storage,create-only-write,auth}.ts; scanner services/document-security-scanner (quarantine -> intake -> evidence; forward-only states quarantined/cleared/stored/blocked/superseded/archived).
- MR: DOCUMENT_INGESTED, RECORD_STATUS_CHANGED, DOCUMENT_VIEWED (before bytes), VALIDATION_COMPLETED, EVIDENCE_ASSOCIATED, DOCUMENT_ARCHIVED, DOCUMENT_SUPERSEDED.
- Tests/docs: test/lib/evidence-payload/*, services/document-security-scanner/test, docs/evidence-payload-lifecycle.md, docs/evidence-lifecycle-production-acceptance.md, docs/bulk-ingestion-architecture.md; workflows evidence-payload-lifecycle-ci.yml, production-evidence-payload-lifecycle-verification.yml, scripts/storage/verify-evidence-storage-config.mjs.
- Status: Foundation implemented but integration incomplete. UI: only app/companies/[id]/onboarding/evidence-panel.tsx and /api/companies/[id]/evidence[/documentId]; app/api/document-intake route now quarantines (compat).
- Gaps: acceptance P1-P9 smoke test not run; scanner deployment "Not applied" in doc; stalled-payload audit job not implemented; processed/ prefix unused (no OCR on stored evidence); legacy IndexedDB evidence stores (lib/evidence-payload-store.ts, evidence-file-store.ts, src/components/contacts/evidence-storage.ts) still used by contacts/driver UIs; business/insurance/authority/vehicle/driver evidence UIs removed or deferred; no watermark/download policy; hosting body-size limit < 25MB possible.

### 16. Settings & compliance-rule applicability
- Migration 0019 (see 6). Code lib/company-profile/{legacy.ts maps tes_company_compliance_settings_*}. UI app/companies/[id]/settings: CanonicalSettings default + LegacyWorkspaceGate legacy tab (still localStorage x3).
- Status: Foundation implemented but integration incomplete. Gaps: "Rules Pool / derived Rules configuration" not built (docs: "downstream"); tes_system_settings (app/settings/page.tsx, 870 lines, localStorage) unresolved target ("unresolved target blocks cutover").

### 17. Company navigation & workspace resolution
- Code: lib/company-navigation.ts (COMPANY_NAVIGATION_ITEMS, 15 items), lib/nav.ts, components/app-sidebar.tsx, components/site-header.tsx, components/use-company-summary.ts, lib/company-lookup.ts, components/company-missing.tsx, src/components/shared/LegacyWorkspaceGate.tsx, src/components/shared/CompanyWorkspaceHeader.tsx; API /api/companies/[id]/summary and /profile.
- No migration; no dedicated test beyond test/lib/company-directory and company-recovery browser harness (scripts/verification/company-recovery-browser, docs/evidence/company-recovery/*.png). No app/companies/[id]/layout.tsx exists (only app/layout.tsx) despite comment saying "/companies/[id] tab layout must consume this list".
- Status: Foundation implemented but integration incomplete / partially regressed-then-recovered. Gaps: site-header still reads tes_company_vehicles_*, tes_driver_masters_v1, tes_company_drivers_* from localStorage (components/site-header.tsx:119,134,150); use-company-summary.ts:34 falls back to localStorage tes_companies; LegacyWorkspaceGate.projectCanonicalCompany WRITES a canonical company into localStorage tes_companies (contradicts closure rule 'must not create ... durable business records' unless treated as migration-source projection); Record of Events, Customs, Programs are placeholder pages; top-level pages (/vehicles, /drivers, /insurance, /customs, /programs, /reports, /tax-filing, /trip-compliance, /credentials, /authorities, /contacts) are static/empty-data shells (lib/data.ts "Empty data store").

### 18. Existing OCR / document intake boundaries
- Code: app/api/document-ai/route.ts (chunking <=15 pages, Google Document AI roadside processor), app/api/business-document-ocr/route.ts, app/api/document-intake/route.ts, lib/legacy-ocr/{authorize,upload-policy}.ts, lib/google-document-ai-provider.ts, lib/machine-acquisition.ts, lib/roadside-machine-*.ts, lib/ingestion/* (contracts), services/document-security-scanner/*.
- Rules: legacy OCR routes CLOSED by default (503 before reading upload) unless TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL (<=30 days) and then EVIDENCE_MANAGE + PDF/JPEG/PNG/WebP <=25MB (20MB corporate); neither is tenant-scoped nor reads stored evidence; permanent OCR of cleared evidence NOT implemented (nothing writes processed/). docs/evidence-payload-lifecycle.md "Known limits".
- Tests: test/lib/legacy-ocr/*, test/lib/ingestion/*, scanner tests. Status: Approved architecture not yet implemented (OCR over cleared evidence); legacy routes intentionally degraded.
- Gaps: screens still calling closed routes: DriverWorkspace via lib/roadside-machine-client.ts; CorporateDocumentsSection (now orphaned after business cutover); simulated OCR (audit F-007) status in insurance/citations/contacts unverified; bulk ingestion architecture doc (docs/bulk-ingestion-architecture.md) is design only; Master Register OCR event family exists, no producer.

### 19. Business Intelligence & Decision Support
- Code: app/business-intelligence/page.tsx (101 lines), app/decision-support/page.tsx (117), components/bi-charts.tsx, app/reports/page.tsx, lib/data.ts (empty arrays). Entries in lib/nav.ts.
- Migrations/tables/capabilities: none. Docs: only mentions as downstream ("Rules / BI / DS read these facts", companies-foundation-boundaries.md). No tests.
- Status: Approved architecture not yet implemented (placeholder shells showing "$0 / No data available", empty recommendations). Audit F-008 invented KPIs addressed by emptying data. Boundary rule (from docs): BI/DS must read canonical facts only; Rules/DQF interpretation downstream of identity; unresolved: data source, authorization capability, MR logging of reads.

## D. Classification summary
1 DB foundation & governance: Foundation implemented and verified.
2 Organization+customer: Foundation implemented but integration incomplete.
3 Tenant isolation/RLS: Foundation implemented and verified (SYSTEM-scope isolation caveat).
4 AuthN/AuthZ context: Foundation implemented and verified (send-invitation route gap).
5 Master Register: Foundation implemented and verified (no read UI; legacy audit stores unreconciled).
6 Operating profile & locations: Foundation implemented but integration incomplete.
7 Contacts & person identity: Foundation implemented but integration incomplete.
8 Customer relationship & onboarding: Foundation implemented but integration incomplete.
9 Vehicles: Existing functionality regressed (UI) over a verified foundation.
10 Drivers: Existing functionality regressed (UI; no driver/person creation).
11 Operating authorities: Existing functionality regressed (UI).
12 Tax registrations: Existing functionality regressed (filing workspace removed).
13 Insurance: Existing functionality regressed (OCR/surety/WC/cert UI removed; registry works).
14 Credentials: Foundation implemented, metadata integrated; secret custody = Unresolved architectural decision.
15 Evidence & documents: Foundation implemented but integration incomplete.
16 Settings & rule applicability: Foundation implemented but integration incomplete (+ system settings unresolved).
17 Navigation & workspace resolution: Foundation implemented but integration incomplete.
18 OCR/document intake: Approved architecture not yet implemented.
19 BI & Decision Support: Approved architecture not yet implemented.

## E. Top risks / gaps
1. Block 01 declared NOT closed (Phases C partial, D, E open) while doc is stale (not updated after D/E cutover); no recorded Phase E reconciliation. Browser stores remain authority for citations, driver detail, legacy contacts/settings, system settings, driver application.
2. Cutover removed functionality before canonical replacements existed: authorities 1576->23 lines, tax-filing 1511->23, insurance 1923->267, vehicles 1061->183, business 996->102; phase-de test pins this. Orphaned components hold ~50 files of unmigrated behaviour.
3. Data stranded: browser localStorage data never imported (0029 infra has no route/UI/executor; lib/legacy-import not imported by app). Users cannot see prior data; "Phase C remaining work" never completed.
4. No driver/person creation service; drivers list is read-only; driver detail still legacy.
5. LegacyWorkspaceGate writes canonical companies into localStorage tes_companies; site-header/use-company-summary still read browser keys: violates closure rule and keeps split-brain.
6. Evidence lifecycle unproven in production (smoke test, scanner deploy, stalled audit job pending); legacy OCR routes closed leaving manual-entry fallback; no OCR of cleared evidence.
7. Fields collected in forms with no canonical owner (10 company fields + cargo rule) - business decisions outstanding.
8. Migration immutability: 0013/0014/0020-0024 edited multiple times; prod apply timing vs edits not provable from repo. next.config ignoreBuildErrors true; baseline TS diagnostics tolerated; 41 DB + 4 static tests fail on main.
9. SYSTEM-scope isolation relies on query predicates, not RLS; capabilities global to staff; policies drifted from operations (0027/0028 patches); production creators' capability grants unverified.
10. send-invitation and driver-application submission paths remain outside TES authorization/PostgreSQL (JSON file store, Clerk-only gate); audit P0/P1 (F-001, F-005, F-010) unresolved in repo evidence; BI/DS and Master Register viewer absent.

---

## Addendum: UI recovery on `claude/ui-recovery` (appended; nothing above was changed)

Blocks 9-13 (Vehicles, Drivers, Authorities, Tax, Insurance) and 14 (Credentials), plus Contacts, Settings and Business, moved from
"UI regressed" to "original interface restored over canonical operations, with the unavailable actions named in place". Per-workspace
state is in `ui-recovery-matrix.md`. Still incomplete after this work: citations (no domain), evidence links for vehicles/drivers/
policies/authorities/tax, the filing/obligation domain, ownership percentages and annual returns, OCR/document intake (retired by
decision), the ten company fields without an owner, the Master Register read UI, legacy-data import (0029 has no route/UI), and the
send-invitation / driver-application paths. Risks 1-10 above remain open unless a matrix says otherwise; none was closed by assertion.
