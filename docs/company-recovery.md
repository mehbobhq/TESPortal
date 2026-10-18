# Company workflow recovery

Branch `claude/company-recovery-clean` (from `main`, which includes PR #18). **No migration, no schema/grant/policy/capability change, no
production data change, no IAM change.** Every write goes through the existing domain operations modules (own validation, own Master
Register event) under the existing authorization wrappers and row-level security. This repairs integration defects; it does not
redesign, replace or simplify the product.

## Root causes

1. **Creation wrote only a fragment.** It persisted the organization, its identifiers and the customer row. Everything else the form
   collected (operating region, the three addresses, contact, phone/email, USDOT / MC / NSC / MVID, IRP / IFTA / other tax accounts,
   SCAC, carrier code, service start date) was dropped before persistence with no message.
2. **The profile never read the canonical domains** (identity only) and filled the gap with invented numbers.
3. **No contract between form and domains**, so nothing refused an unsupported field.
4. **Company-scoped chrome and four workspaces resolved the company from `localStorage` (`tes_companies`)**, so a canonical company was "not found" there.
5. **A failed lookup was reported as "Company not found".**
6. **Insurance and credentials mutations ignored the company in the URL.**
7. **Vehicle creation was two transactions** (orphan vehicle if the relationship failed).
8. **`businessNo` was set to the EIN for US-only companies** by the form, which would create a false CRA Business Number identifier in the canonical identity domain.

## What was repaired

| Area | Change |
| --- | --- |
| `lib/company-directory/creation-input.ts` | The form-to-domain contract: strict parsing, every problem reported at once, unsupported / unknown non-empty fields refused, address blocks all-or-nothing, carrier numbers need an explicit kind and issuing jurisdiction, no derived values |
| `lib/company-directory/create-company.ts` | One transaction: organization (+identifiers, trade name), customer + onboarding engagement, operating scope, three independent addresses, primary contact + channels, authorities, tax registrations. Per-field capability pre-check |
| `lib/company-directory/capability-context.ts` | Re-proves each domain's capability on the same connection; runs each domain's deferred integrity checks at its boundary (nothing skipped) |
| `lib/company-directory/read-profile.ts` | Profile assembled from the canonical domains; a section the reader may not see is `not_permitted`, never "empty" |
| `lib/company-directory/update-company.ts` | Edit of operating region and addresses: *change* (history kept) or *correct* (wrong version flagged); unchanged values not re-saved; validated before any write |
| `app/api/companies/**` | create / edit / profile / summary / contacts / settings / vehicles routes with canonical error mapping |
| Creation form | **Every original field kept.** Fields with no canonical storage are shown exactly as defined, disabled and labelled "Unavailable" with a banner **before** submission. Primary Contact keeps its Full Name field; given/family inputs beside it are pre-filled from it for the user to confirm (no silent name splitting). Carrier/IRP/IFTA gain the explicit "which number / who issued it" choices the canonical domains require |
| Profile | Original layout kept: Service Type/Status, End Date, Payment Method, Cargo, Website, Fleet cards, Check Status / New Case / Quick Note are present (the controls that never had a function are disabled and say so); no value is invented |
| `LegacyWorkspaceGate` | The **existing** Contacts, Settings, Citations and Driver-detail workspaces still open, unchanged, for canonical companies under an explicit "browser-local workspace (not the TES database)" banner. Where a canonical workspace exists (Contacts, Settings) it is the default tab and the existing one is a click away. Browser data is never deleted/overwritten/migrated; a canonical company is only **added** to `tes_companies` as a marked `canonical-projection` so the old screens can find it |
| Contacts, Settings | New canonical workspaces (company-scoped API + UI) |
| `lib/company-lookup.ts`, `components/company-missing.tsx` | Failed lookup is not "not found" |
| Sidebar / header | Canonical company resolution (browser fallback is read-only) |
| `lib/insurance`, `lib/company-credentials` | URL-company scope guard (mismatch looks like a missing record) |
| `lib/operational-identity/service.ts` | Atomic vehicle + relationship |
| `scripts/database/assessment/*.sql` | Read-only production assessment and creator-capability check |
| `scripts/ci/normalize-tsc-diagnostics.py` | Order-normalizes every printed string-literal union (inside `Omit<…>` too) |
| `scripts/verification/company-recovery-browser/` | Reproducible browser harness (test-only; stubs auth and the DB connection) |

## Database changes

None.

## Authorization review (`create-company`, `capability-context`, `read-profile`, `update-company`)

- `withAuthorizedSystem("ORGANIZATION_CREATE")` proves the actor and capability, then sets the transaction-local `tes.system_actor_id` /
  `tes.system_capability`. `tes_security.system_context_authorized()` (migration 0024) is **not** satisfied by those settings alone: it
  re-derives from the authorization tables whether that actor (Master Account, or active TES_STAFF + SYSTEM assignment + active grant)
  holds that capability. Switching `tes.system_capability` inside the transaction therefore only succeeds for a capability the actor
  really holds; `enterSystemCapability` throws `TesAuthorizationDeniedError` otherwise. The actor id is never changed.
- Before any write the app also calls `hasAdditionalSystemCapability` (same evaluator) for every capability the submission needs and
  reports all missing ones (`403`, nothing created).
- Master Register events are written through a repository bound to the same client in the same transaction: a rollback removes them too.
- No tenant context is established (SYSTEM scope is not tenant access); no policy, RLS setting or audit enforcement was touched.
- Verified by `company-creation.db.test.ts` (capability switch denied by RLS; refused creation leaves no organization and no event; a
  successful creation records ≥ 10 events under the creating actor; a failed one records none) and in the browser (`isolation.mjs`).

### Do the production creators hold the capabilities? — **not verifiable from here**

This environment has no Google Cloud / production database access, so the production grants were **not** read. Run, as a read-only
operator, `scripts/database/assessment/creator-capability-check.sql` (it mirrors the RLS gate; a test proves it reports exactly which
capabilities an actor lacks). Master Account actors pass for every active capability. A TES_STAFF actor needs, to create **and** edit a
complete customer: `ORGANIZATION_CREATE`, `COMPANY_PROFILE_MANAGE`, `CUSTOMER_ESTABLISH`, `ORGANIZATION_UPDATE`, `CONTACT_MANAGE`,
`TAX_REGISTRATION_MANAGE`, and to open the full profile: `ORGANIZATION_REGISTRY_READ`, `CUSTOMER_RELATIONSHIP_READ`,
`COMPANY_PROFILE_READ`, `PERSON_REGISTRY_READ`, `TAX_REGISTRATION_READ`. A user lacking some can still create a smaller record (each field
group needs only its own capability) and sees "Not permitted to view" for sections they may not read.

**Least-privilege correction, only if the check shows a gap (not executed; needs approval):** grant *only the missing capability codes*
to the specific actor's existing active TES_STAFF SYSTEM assignment through the project's reviewed change process (grants are
evaluation-only at runtime, so this is an operator/migrator action), with: the actor id and sign-in identity, the output of the check
before and after, the change ticket/approval, and the Master Register/ledger entry the process requires. No new roles, no Master Account
designation, no policy change, no IAM change. Template (review before use; adjust ids):

```sql
-- INSERT only after approval. One row per missing capability for ONE actor.
INSERT INTO public.relationship_capability_grants (relationship_id, capability_id, assignment_id, status, granted_by_actor_id)
SELECT ar.id, c.id, ra.id, 'active', :approver_actor_id
  FROM public.actor_relationships ar
  JOIN public.relationship_assignments ra ON ra.relationship_id = ar.id AND ra.scope_type = 'SYSTEM' AND ra.status = 'active'
  JOIN public.capabilities c ON c.code = ANY(:'missing_codes'::text[]) AND c.is_active
 WHERE ar.actor_id = :target_actor_id AND ar.relationship_type = 'TES_STAFF' AND ar.status = 'active';
```

## Field-by-field persistence verification

Verified by `company-creation.db.test.ts` (each value read from the canonical table **and** from the profile) and by the browser run
(create → reload → every value shown).

| Form field | Canonical home | Edit |
| --- | --- | --- |
| companyName, dba | `organizations.legal_name`/`display_name`; `organization_aliases` (TRADE_NAME) | Edit page |
| companyType | `organization_classifications` (primary); Customer also `customers` + `customer_engagements` | not editable |
| regCorpCountry / regCorpState | `organizations.country_code` / `region_code` | not editable |
| incorpNo, businessNo, ein | `organization_identifiers` INCORPORATION / CRA_BN / IRS_EIN (never derived from each other) | Edit page |
| opRegion | `company_operating_scope_periods` | Edit page, Settings |
| startDate (Customer) | `customer_engagements.started_at` (stage ONBOARDING) | lifecycle |
| contactPerson → given/family (confirmed) | `persons`, `person_name_versions`, `organization_person_relationships` (PRIMARY) | Contacts |
| phone / email / billingEmail | `organization_channels` (GENERAL / GENERAL / ACCOUNTING) | Contacts |
| reg_*, mail_*, yard_* | `locations` + `organization_location_assignments` REGISTERED / MAILING / HOME_YARD (independent; mail/yard Customer only) | Edit page |
| usdot, mc, mvid(+kind/region), nsc(+kind/region), accIrp(+base) | `operating_authorities` | Authorities |
| accIfta(+base), accNyhut, accNm, accKyu, accOr, accCt, scac, carrierCode | `registrations` | Tax Filing |
| website | `organization_channels` WEBSITE / GENERAL (http/https, normalized) | Edit page |
| cargoTypes (Customer) | `company_cargo_category_periods` + `cargo_categories` (migration 0033; descriptive, not a compliance claim) | Edit page |
| eldProvider, gpsProvider, fuelProvider (Customer) | `company_fleet_providers` (one identity per name) + `company_fleet_provider_periods` per service category ELD_HOS / GPS_TELEMATICS / FUEL_SERVICES (migration 0033; a name, no Organization is created) | Edit page |
| payMethod (Customer) | `customer_billing_preference_periods` + `billing_payment_methods` (migration 0033; a preference, not contract terms) | Edit page |
| svcType, status, endDate, assessmentDate | **derived and read-only**: signed contract package, engagement stage, engagement end (end-service workflow); the assessment date is "Not yet assessed" until a documentation assessment engine exists | contract / lifecycle / assessment |
| **gstHst** | **no canonical owner (no registration program): kept on the form, disabled; the server refuses it** | – |

## Workspace-by-workspace verification

Browser = real Chromium against the real Next.js app, real route handlers, real authorization wrappers and a real PostgreSQL with all
migrations, as the runtime role (auth and the DB connection stubbed; see Limitations). DB = database test.

| Workspace | Status | Verified |
| --- | --- | --- |
| Directory / New company | Operational | Browser + DB |
| Profile | Operational (all original cards kept) | Browser + DB |
| Edit | Operational for identity, region, addresses | Browser + DB |
| Onboarding | Operational (unchanged) | Browser opens; existing suites |
| Business | Partially integrated (canonical identity; documents/shareholders/returns deferred by Block 01 D/E) | Browser opens |
| Contacts | Operational (canonical) + existing workspace one click away | Browser + DB |
| Insurance | Operational; mutations scoped to the URL company | Browser opens + DB scoping |
| Authorities / Tax Filing | Operational (unchanged) | Browser opens; existing suites |
| Vehicles | Operational; creation atomic; scoped | Browser (A shows it, B empty) + DB |
| Drivers | Partially integrated: canonical list; detailed compliance record is the existing browser-local workspace under a banner | Browser opens |
| Credentials | Operational; mutations scoped; secrets stay references | Browser opens + DB scoping |
| Settings | Operational (canonical) + existing workspace one click away | Browser + DB |
| Citations | Existing workspace, browser-local (not canonical), unchanged, under a banner | Browser |
| Record of events, Customs, Programs | No page existed on `main` (links 404); an explicit notice page now | Browser |
| Legacy (non-canonical) company ids | Existing workspaces unchanged, no banner | Browser |

## Architectural conflicts found (stopped, reported)

1. **Mandatory "Cargo Information" for Customers.** The original form requires it, but there is no canonical storage and none may be invented. The field and its definition stay (disabled); the rule is kept in code behind `CARGO_STORAGE_AVAILABLE = false` and cannot be enforced until a canonical owner exists. **Decision needed.**
2. **Block 01 D/E cutover (already on `main`, before this work)** replaced the rich Vehicles, Drivers, Insurance, Credentials and Business pages with canonical views (`0e8e8c3`, `0ba9436`, `e4fa336`, `971e15e`; originals in `2644183`), and `phase-de-cutover-boundaries.test.ts` pins that decision. Restoring the old UIs would reverse an approved decision, so it was **not** done; they remain recoverable from those commits. **Decision needed** if they should return as browser-local tabs like Contacts.
3. **`businessNo := EIN` for US-only companies** was removed (it would fabricate a CRA BN). This corrects a defect rather than removing a field.
4. **Service Status at creation**: a new Customer starts in ONBOARDING; the field stays visible but disabled.

## Production data protection

- **Power Way Logistics Inc and every existing record are untouched**: no production access was used, nothing here writes, merges or deletes. Locate it read-only with `SELECT id, legal_name, created_at FROM public.organizations WHERE normalized_legal_name LIKE '%power way logistics%';` and run the assessment SQL. Values the old form discarded before persistence **cannot be claimed as recovered**: no evidence of them exists in the database; only a source such as the original submission or documents could justify re-entering them, through the normal edit screens.
- Possible duplicate organizations are report-only.

## Remaining blockers and limitations

- **Vercel preview deployment and production capability check could not be done**: no Vercel or Google Cloud credentials exist in this environment. The browser evidence is from a local run of the same code; `docs/evidence/company-recovery/` holds it. Run the manual checklist below on a preview before approving.
- The browser harness stubs the Clerk session and the Cloud SQL connector (it does not exercise Clerk, WIF or Cloud SQL).
- Fields without canonical homes (table above) need business decisions on where they belong; no storage was invented.
- Identity edit and details edit are separate canonical transactions (both validated first).
- Browser-only prototype data is not migrated and is not canonical.
- The client-side duplicate hint is advisory; only strong identifiers are enforced by the database.
- Inherited failures: 41 database tests and 4 static tests fail identically on `main` (listed in the PR).

## Preview checklist (manual, signed in as a real creator)

Create a test Customer with representative fields → profile shows them → Edit region and registered address → reopen → Contacts add/end a line → Settings set scope → open Authorities, Tax Filing, Insurance, Credentials, Vehicles, Drivers, Citations (banner) → try a duplicate EIN (refused, nothing created) → confirm with the assessment SQL that only the test company was added.

## Deployment and rollback

1. Approve the PR; run `creator-capability-check.sql` and the assessment SQL (read-only) and keep the output; correct gaps only per the procedure above.
2. Deploy to a Vercel **preview** and run the checklist.
3. Promote to production (no migrations). 4. Re-run the assessment; counts unchanged until users act.
5. Rollback: promote the previous Vercel deployment. Nothing in the database needs to be rolled back; records created by this version are ordinary canonical rows the previous version still reads (identity only).
