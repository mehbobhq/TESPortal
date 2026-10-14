# Verification report

Scope: PR #20 (`claude/company-recovery-clean`). **Nothing in this report was executed against production or against a shared database.**
All database and browser runs used a throwaway local PostgreSQL built from the repository's real migrations (0001-0032) and queried as the
real runtime role, so row-level security applied.

## 1. Automated tests

| Suite | Result | Notes |
| --- | --- | --- |
| Full `scripts/test/run-auth-tests.sh` (all DB suites, real authorization, runtime role, real Master Register) | 1133 tests, 1093 pass, **40 fail** | The same failures occur on unmodified `origin/main` (70 suite/test names, listed in `inherited-failures-on-main.txt`). **0 new**; **1 fewer** than `main` (the authorization-boundary offender `lib/company-directory/service.ts` no longer imports the authorization core). They are in authorization-core, insurance, credentials, contacts and RLS-backstop suites this work does not touch, and reproduce when those files run alone. Local PostgreSQL is 16.15 while CI/production use 17; that is a hypothesis, **not proven** |
| Company recovery DB tests (`test/lib/company-directory/*.db.test.ts`) | all pass locally; **pass on PostgreSQL 17 in CI** (`Company Recovery CI`) | creation of every field, rollback + retry, duplicate refusal, per-field capability errors, RLS capability switch, Master Register events for success and failure, edit change/correct/validate-first, contacts operations, insurance renewal scoping, credentials/vehicle scoping, customer service end, read-only assessment SQL |
| Static tests (895) | 892 pass, **3 fail, all identical on `main`** | `authorization layer boundaries` (leaf "SYSTEM wrapper never writes tenant context", in `lib/auth`, untouched), `Identity graph additions: migrations`, `operational-identity normalization`, (the other failing leaf of that suite, the authorization-core import, is fixed) |
| TypeScript regression gate (`scripts/ci/normalize-tsc-diagnostics.py`) | 110 diagnostics, **0 new** vs `origin/main` | the gate normalisation was extended to every printed string-literal union; no threshold was changed |
| `pnpm build` | passes | |
| CI on the PR | `Company Recovery CI` and the other four triggered jobs passed on the earlier head; re-check on the final head before approval | |

Tests that encode approved decisions were **not weakened**. One approved ratchet **blocked** a restoration and was respected (legacy Vehicles,
see the regression matrix).

## 2. Browser verification (real Chromium, real Next.js, real services and RLS, disposable database)

73 checks across seven scripts in `scripts/verification/company-recovery-browser/pw/`, all passing on the final code; screenshots in
`docs/evidence/company-recovery/`.

- **Create / reopen**: Customer created through the real form with representative supported data → canonical id → reload → every value shown; unavailable fields kept, disabled and labelled before submission.
- **Edit / reopen**: region and registered address changed; mailing and yard untouched; an invalid edit changes nothing (identity included); customer service ended with a reason.
- **Workspaces**: Contacts (change name, add title, search, end contact, archive person), Settings, Authorities (real change keeps history; correction flags the wrong version), Insurance (renewal adds a term; cancellation), Credentials (new = needs verification, search, verification outcome/method, open-portal link), Vehicles, Drivers, Business, Tax Filing, Onboarding, Citations all open for the canonical company.
- **Legacy**: the original Business, Insurance, Authorities, Tax Filing, Credentials, Drivers, Contacts, Settings and Citations workspaces open unchanged as labelled browser-local tabs; browser data is untouched; a canonical company is only added as a marked projection while such a tab is open and removed when it closes; a non-canonical legacy id still opens its workspace.
- **Isolation / authorization**: a vehicle appears under its own company only; another company's contacts are not shown; a limited actor sees "Not permitted to view", cannot create (403 naming the missing capabilities) and creates nothing; unknown id → not found.
- **Rollback**: duplicate identifier through the UI and API → refused, form stays open, organizations / persons / locations / Master Register event counts unchanged.

### What the browser evidence is NOT

- **Authentication and the database connection were stubbed** (a file names the signed-in Clerk subject; the Cloud SQL connector is replaced by a local connection string). It exercises the real routes, services, authorization wrappers, RLS and Master Register, but **not Clerk, Workload Identity Federation or Cloud SQL**. It is not evidence that production sign-in or connectivity works.
- **No Vercel preview verification.** Vercel built a preview for the PR (the build succeeded), but it could not be opened from this environment (no network path, no sign-in), and its database target is unknown. **A preview must not be used for write tests until its database target is identified and proven non-production; if it points at production, only read-only checks are allowed.**
- Dev-server console shows two benign messages (a 404 for a static asset and a UI-library "uncontrolled default value" warning); no uncaught page errors.

## 3. Authorization and accountability checks

- Capability switching inside the creation transaction is re-proven by `tes_security.system_context_authorized()` against the actor's real grants (the transaction-local setting alone grants nothing); actor identity is never changed; a missing capability is refused before any write (403 naming it) and again by RLS (tested).
- Master Register: a successful creation records at least ten events under the creating actor; a refused or failed creation records none; edits record events under the editing actor (tested).
- Company-scoped mutations cannot reach another company: insurance (archive, restore, cancel, renew), credentials, contacts, vehicles, engagement (tested).
- No grant, policy, RLS setting or capability was changed. The production creator-capability assessment remains **read-only** (`scripts/database/assessment/creator-capability-check.sql`) and **was not run against production** (no access).

## 4. Status buckets

1. **Recovered and verified (local, disposable database)**: atomic company creation and read-back of every supported field; profile with real values; edit (identity, region, addresses, ending service); Contacts and Settings canonical workspaces; Authorities/Tax edit-correct-history; Insurance renew/cancel; Credentials parity/search; atomic vehicles; company navigation; failed-lookup vs not-found; legacy preservation; rollback behaviour.
2. **Implemented, awaiting real-environment verification**: everything above against Clerk, WIF and Cloud SQL on a preview whose database target is proven safe; production creator-role capabilities; PostgreSQL 17 re-run of the full local suite (CI covers only the recovery suites).
3. **Preserved but not canonically integrated**: original Business, Insurance, Authorities, Tax Filing, Credentials, Drivers, Contacts, Settings and Citations workspaces (browser-local tabs, labelled, never presented as canonical).
4. **Blocked by approved architectural decisions**: legacy Vehicles (evidence-store ratchet); mandatory Cargo rule and the ten fields without a canonical owner (`canonical-field-ownership.md`); Block 01 D/E cutover reversal of the rich pages (not reversed); persons/drivers creation, vehicle registration/archive operations, medical qualification operations, tax filing calendar/records, insurance evidence/OCR, authority safety/audit records.
5. **Requires production authorization or release approval**: merge, deploy, creator-role grants (if the read-only check shows a gap), any import of browser-local data (the staged import infrastructure from migration 0029 exists but needs its controlled workflow and human decisions).
