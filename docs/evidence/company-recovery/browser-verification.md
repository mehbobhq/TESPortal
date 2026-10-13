# Browser verification evidence (company recovery)

Run on the final code of `claude/company-recovery-clean`: real Chromium → real Next.js dev server → real route handlers, services,
authorization wrappers and Master Register → real PostgreSQL (all repository migrations applied) as the **runtime role**.
Stubbed (test-only, in `scripts/verification/company-recovery-browser/`): the Clerk session (a file names the signed-in subject) and the
Cloud SQL connector (a local connection string). **This is not a Vercel preview and does not exercise Clerk, WIF or Cloud SQL.**

Actors: `user_e2e_staff` (TES_STAFF with every active capability) and `user_e2e_limited` (ORGANIZATION_CREATE + ORGANIZATION_REGISTRY_READ only).

| Step | Result | Screenshot |
| --- | --- | --- |
| Creation form announces unavailable fields up front; originals kept, disabled and labelled | PASS | 01-new-form-initial |
| Full name suggests confirmable given/family names | PASS | – |
| Create a Customer with representative supported fields → canonical id → reload → every value shown | PASS | 02-new-form-filled, 03-profile-after-create-reopened |
| Profile keeps unavailable original fields as "Not recorded (no canonical storage yet)" | PASS | 03 |
| Edit name, region, registered address → reopen shows them; mailing/yard untouched | PASS | 04-edit-form, 05-profile-after-edit |
| Refused edit (incomplete address) changes nothing, including the name | PASS | 06-edit-refused |
| Contacts: canonical contact and line shown; add a contact; read back after reload | PASS | 07-contacts-added |
| Existing browser-local Contacts workspace one click away, with its non-canonical banner | PASS | 08-contacts-browser-local |
| Settings: operating scope and rule applicability persist | PASS | 09-settings |
| Authorities, Tax Filing, Insurance, Credentials, Vehicles, Drivers, Business, Onboarding open for the canonical company | PASS | 10-* |
| Citations: existing workspace, unchanged, under the browser-local banner | PASS | 10-citations |
| Vehicle created through the company route appears for that company only; second company shows "No vehicles yet." | PASS | 11-vehicles-A, 12-vehicles-B-empty |
| Second company's Contacts show none of the first company's contacts | PASS | 13-contacts-B-empty |
| Duplicate EIN (UI): reason shown, form stays open, organizations/persons/locations/Master Register events unchanged | PASS | 16, 17 |
| Duplicate EIN and unsupported field (API): 409 / 400 with issues, nothing created | PASS | – |
| Unknown company id → "Company Not Found" | PASS | – |
| Limited actor: profile shows "Not permitted to view"; creation refused with 403 naming the missing capabilities and creates nothing; Contacts refused | PASS | 14, 15 |
| Legacy (non-canonical) id still opens its existing workspace, no canonical banner | PASS | 18 |
| Existing browser data untouched; canonical company only added as a marked projection | PASS | 19 |
| No uncaught page errors | PASS | – |

Weak check, stated plainly: "a record id from another company is refused" in the browser only proves the insurance item route rejects a
POST (405); the real scoping proof is the database test `company-workspaces.db.test.ts`.

Reproduce: see `scripts/verification/company-recovery-browser/README.md`.
