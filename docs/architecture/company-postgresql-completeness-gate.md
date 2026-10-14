# Company PostgreSQL completeness — implementation gate

Status: PRE-IMPLEMENTATION / NOT APPROVED FOR PRODUCTION
Base: October 8 product specification (db0b478); separate working branch.
Do not replace mature UI with generic panels or introduce browser-local canonical persistence.

## Verified source facts
- Oct 13 `app/companies/[id]/edit/page.tsx` submits exactly five fields: companyName, dba, incorpNo, businessNo, ein.
- Oct 13 `lib/company-directory/service.ts` has five-field `UpdateCompanyDirectoryInput` and an incomplete `CreateCompanyDirectoryInput`; `getCompanyProfile` returns null for contact, phone, website, email, billingEmail.
- `updateCompanyDirectoryRecord` performs multiple independently authorized corporate-identity operations. It is **not** a single all-or-nothing edit transaction; a later failure can leave earlier edits committed. Do not claim atomic form save.
- Source migrations 0012 (locations), 0014 (people/channels), 0015 (customer engagement), 0019 (operating profile) provide foundations. Production application state NOT verified.
- The current baseline working branch includes only CS-01 migration-runner hardening; no company cutover implementation is approved here.

## Required field-ownership matrix before coding
For each October 8 field record: original label, type, required/conditional rules, source, canonical table and key, owning domain, API read/write method, validation, permissions, evidence, history, import mapping, regression test, and round-trip result.
Domains:
1. Corporate identity: legal name, DBA, incorporation jurisdiction/number, CRA BN, IRS EIN.
2. Locations: registered, mailing, home yard; current and historical address versions.
3. Contacts: people, primary contact, phone, website, account email, billing email, communication purposes.
4. Customer relationship: customer/prospect status, service type, dates, payment method, cargo, engagement lifecycle.
5. Operating profile: operating region, cargo/operational applicability and rules.
6. Authorities and taxes: USDOT, MC, NSC/CVOR, MVID/RIN, GST/HST, IRP/IFTA and jurisdiction-specific registrations; linked canonical domain records rather than duplicate standalone strings.
7. Other business identifiers and providers: SCAC, carrier code, GPS and fuel provider, assessment date.

## Non-negotiable gates
1. Read-only production ledger check: compare version, filename, checksum against exact migration files. Never run migrate.sh for inspection (it can apply migrations).
2. Inventory existing PostgreSQL rows and legacy browser records with authorized read-only methods; do not export secrets or customer data to logs.
3. Preserve Oct 8 fields, duplicate detection, conditional region/customer rules, company identity continuity and historical relationships.
4. Define complete API request schema; reject unsupported keys instead of silently dropping data.
5. Implement a single atomic save per logical form operation or clearly separated independent section saves with explicit partial-failure UI.
6. Use authorization, company scoping, Master Register evidence, no hard delete, and optimistic concurrency/clear conflict handling.
7. Test create/read/update/reload, omitted versus cleared fields, invalid values, duplicate identifiers, failure rollback, cross-tenant denial, concurrent edits and legacy import reconciliation on disposable PostgreSQL.
8. Validate all company-dependent screens (Contacts, Settings, Citations, Drivers, sidebar) against PostgreSQL company identity; retire browser authority only after parity.
9. Preserve selected clean visual direction; responsive and accessible fields, Cancel and Save.
10. No merge to main, production migrations, or deployment without founder approval and test evidence.

## Current blockers
- Actual production migration ledger and checksums unknown.
- Migration and API operation bodies not fully reviewed line-by-line.
- No disposable PostgreSQL 17 integration test evidence.
- Current edit service lacks atomic multi-field updates.
- No demonstrated full legacy-to-PostgreSQL import and read-back parity.

Next code change must be scoped to one tested domain, with a changed-file list and rollback procedure. This document is a gate, not a claim that the functionality is implemented.
