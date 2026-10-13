# Company workflow recovery

Branch `claude/zen-feynman-lexcbv`, baseline `main` including PR #18. **No migration, no schema change, no production data change.**
Every write goes through the existing domain operations modules (own validation, own Master Register event), under the existing
authorization wrappers and row-level security.

## Root causes

1. **Creation wrote only a fragment.** `createCompanyDirectoryRecord` persisted the organization, its identifiers and the customer
   row. Every other field the form collected (operating region, the three addresses, the contact and its phone/email, USDOT / MC /
   NSC / MVID, IRP / IFTA and the other tax accounts, SCAC, carrier code, service start date) was dropped without any message.
2. **The profile never read the canonical domains.** It returned identity only, so a field that *had* been saved elsewhere could not
   be shown, and the page padded the gap with invented statistics.
3. **No contract between form and domains.** Nothing refused an unsupported field; "Save" always looked successful.
4. **Company-scoped workspaces resolved the company from `localStorage` (`tes_companies`)**, so a canonical company opened from the
   directory was "not found" in the sidebar/header, and some workspaces kept browser-only records under a canonical id.
5. **Failed lookups were reported as "Company not found".**
6. **Insurance and credentials mutations ignored the company in the URL**: a policy/credential id from another company could be
   changed through any company's route.
7. **Vehicle creation was two separate transactions** (vehicle, then relationship), so a failure left an orphan vehicle.

## What changed

| Area | Change |
| --- | --- |
| `lib/company-directory/creation-input.ts` (new) | The form-to-domain contract: strict parsing, every problem reported at once, unsupported / unknown non-empty fields refused, address blocks all-or-nothing, carrier numbers need an explicit kind and issuing region, no derived values |
| `lib/company-directory/create-company.ts` (new) | One transaction: organization (+identifiers, trade name), customer + onboarding engagement, operating scope, three independent addresses, primary contact + channels, authorities, tax registrations. Per-field capability pre-check |
| `lib/company-directory/capability-context.ts` (new) | Re-proves each domain's capability on the same connection and runs that domain's deferred integrity checks at its boundary (nothing skipped) |
| `lib/company-directory/read-profile.ts` (new) | Profile assembled from the canonical domains; a section the reader may not see is `not_permitted`, never "empty" |
| `lib/company-directory/update-company.ts` (new) | Edit of operating region and addresses: *change* (history kept) or *correct* (wrong version flagged); unchanged values are not re-saved; everything validated before anything is written |
| `lib/company-directory/service.ts` | `createCompanyDirectoryRecord`, `getCompanyProfile`, `editCompany`, `getCompanyIdentitySummary` |
| `app/api/companies/**` | create / edit / profile / summary / contacts / settings / vehicles routes; canonical error mapping (400 / 403 / 404 / 409, no 500 for expected cases) |
| `lib/insurance/operations.ts`, `lib/company-credentials/operations.ts` | `organizationId` scope guard: a mismatch looks exactly like a missing record |
| `lib/operational-identity/service.ts` | `createVehicleForOrganization`: vehicle + relationship atomically |
| `app/companies/new`, `[id]/profile`, `[id]/edit` | Form shows every refusal; profile shows real values and honest empty states; edit covers identity, region and addresses |
| `[id]/contacts`, `[id]/settings` | Canonical workspaces (company-scoped API + UI) for canonical companies |
| `LegacyWorkspaceGate`, deferred pages | Workspaces with no canonical storage say so explicitly for canonical companies; legacy ids keep the old component untouched |
| `lib/company-lookup.ts`, `components/company-missing.tsx` | Failed lookup vs missing company |
| `components/use-company-summary.ts`, sidebar, header | Canonical company resolution |
| `scripts/database/assessment/company-recovery-assessment.sql` | Read-only production assessment |

Tests: `test/lib/company-directory/{company-creation-input.test.ts, company-creation.db.test.ts, company-workspaces.db.test.ts, recovery-assessment.db.test.ts, company-directory-boundaries.test.ts}`; updated `phase-de-cutover-boundaries.test.ts` (latest migration is 0032) and `company-credentials-boundaries.test.ts` (new scope key).

## Database changes

None. No migration, grant, policy or capability was added or altered. The migration ledger is untouched.

## Field-by-field persistence verification

Verified by `company-creation.db.test.ts` ("persists every supported field of a Customer … and the profile reads the same values back": each
value is read from the canonical table by SQL **and** from the profile).

| Form field | Canonical home | Edit |
| --- | --- | --- |
| companyName | `organizations.legal_name` / `display_name` | Edit page |
| dba | `organization_aliases` (TRADE_NAME) | Edit page |
| companyType | `organization_classifications` (primary); Customer also `customers` + `customer_engagements` | not editable |
| regCorpCountry / regCorpState | `organizations.country_code` / `region_code` | not editable |
| incorpNo, businessNo, ein | `organization_identifiers` INCORPORATION / CRA_BN / IRS_EIN | Edit page |
| opRegion | `company_operating_scope_periods` | Edit page, Settings |
| startDate (Customer) | `customer_engagements.started_at` | lifecycle |
| contactGivenName / contactFamilyName | `persons`, `person_name_versions`, `organization_person_relationships` (PRIMARY) | Contacts |
| phone / email / billingEmail | `organization_channels` (GENERAL / GENERAL / ACCOUNTING) | Contacts |
| reg_*, mail_* (Customer), yard_* (Customer) | `locations` + `organization_location_assignments` REGISTERED / MAILING / HOME_YARD, independent | Edit page |
| usdot, mc, mvid(+Kind/Region), nsc(+Kind/Region), accIrp(+irpBase) | `operating_authorities` | Authorities |
| accIfta(+iftaBase), accNyhut, accNm, accKyu, accOr, accCt, scac, carrierCode | `registrations` | Tax Filing |
| gstHst, website, svcType, payMethod, assessmentDate, cargoTypes, gpsProvider, fuelProvider, cargoInfo, status, endDate | **no canonical home — refused with an explicit message when non-empty, never dropped** | – |

## Workspace-by-workspace functional verification

"Verified" means a database test through the real authorization wrappers and the runtime role, plus a clean TypeScript check and
production build. **No browser end-to-end run was possible from this environment**; UI behaviour is verified by build, types and
static boundary tests only.

| Workspace | Status | Basis |
| --- | --- | --- |
| Directory / New company | Operational | creation tests (atomicity, rollback, retry, duplicate refusal, per-field authorization) |
| Profile | Operational | read-back tests; `not_permitted` sections; unknown / malformed id → 404 |
| Edit | Operational for identity, region, addresses; other fields point to their workspace | edit tests (change / correct / unchanged / validate-before-write / capability) |
| Onboarding | Operational (unchanged, canonical) | existing suites |
| Business | Partially integrated: canonical identity read-only; corporate documents, shareholders, annual returns deferred | page lists the deferred items |
| Contacts | Operational for canonical companies (view, add contact, add / end company line); legacy-id companies keep the old component | scoping test |
| Insurance | Operational; mutations now scoped to the URL company | scoping test + existing suite |
| Authorities | Operational (unchanged) | existing suite |
| Tax Filing | Operational (unchanged) | existing suite |
| Vehicles | Operational; creation atomic | atomicity + scoping test |
| Drivers | Partially integrated: list is canonical; driver creation / editing and the driver detail page are deferred (gated) | existing suite |
| Citations / Events | Intentionally deferred (no canonical store); explicit notice for canonical companies | boundary test |
| Credentials | Operational; mutations scoped to the URL company; secrets stay references only | scoping test + existing suite |
| Settings | Operational for canonical companies (scope, rule applicability, driver minimums) | settings test |
| Record of events, Customs, Programs | Intentionally deferred; explicit notice | boundary test |

## Remaining limitations (not invented, not faked)

- Fields with no canonical home (table above) need a **business decision** on where they belong: GST/HST, website, service type, payment
  method, assessment date, cargo types, fleet provider names.
- A new Customer always starts in the ONBOARDING stage; the old "Service Status" at creation is refused rather than honoured. Decision needed if another initial stage is wanted.
- Creating a full record now requires, besides `ORGANIZATION_CREATE`, the capability of every domain the submission touches (`COMPANY_PROFILE_MANAGE` always; plus `CUSTOMER_ESTABLISH`, `ORGANIZATION_UPDATE`, `CONTACT_MANAGE`, `TAX_REGISTRATION_MANAGE` as used). A missing one is named in a 403 and nothing is created.
- The identity edit and the details edit are separate canonical transactions (both are validated first, so a bad submission changes nothing; the response states what was saved).
- Browser-only prototype data (contacts, settings, citations, local companies) is **not migrated, merged or deleted**; it is only reachable for legacy ids.
- The client-side duplicate-name hint is advisory; only strong identifiers (EIN, BN, authority numbers) are enforced by the database.
- The profile activity feed is deferred.

## Production data risks

- Companies created by the old form hold only identity (and customer) data. Addresses, contacts, region and numbers the user typed were never stored and cannot be reconstructed; the profile will show them as not recorded. Do not infer them.
- Possible duplicate organizations (same normalized name) must be reviewed by a person; nothing here merges them.
- Run the assessment before and after deployment and compare.

## Read-only assessment

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'BEGIN READ ONLY' \
  -f scripts/database/assessment/company-recovery-assessment.sql -c 'ROLLBACK'
```

Counts and ids only; its test proves every statement runs read-only and changes no row. Repair of any finding is a separate, reviewed
procedure: each finding lists canonical ids; a repair is performed only through the corresponding domain operation by an authorized
person, with the source evidence (the original submission or document) attached to the Master Register entry. Ambiguous identities
(possible duplicates) are never repaired automatically.

## Safe deployment and rollback

1. Confirm the staff roles that create companies hold the capabilities listed above (read-only query on the grants tables); grant through the normal reviewed process if not. Do not broaden IAM.
2. Run the assessment SQL and keep the output.
3. Deploy the branch to a Vercel **preview** and open one canonical company in each workspace.
4. Promote to production. Do not run migrations (there are none).
5. Re-run the assessment; row counts must be unchanged until a user creates or edits a record.

Rollback: promote the previous Vercel deployment. No schema or data rollback is needed. Records created by this version are normal canonical rows and remain valid for the previous version (which reads identity only).
