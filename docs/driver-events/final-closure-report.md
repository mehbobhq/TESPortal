# TES Driver Events — final closure report

Reviewed release `23b90b0` (migrations 0042, 0043). Corrected tree: code commit `f4cf3bc`, plus this documentation commit. `origin/main` was `0327263` when checked (read-only `git ls-remote`); the release is `0327263` plus a linear history, with migrations 0040/0041 below it and 0042/0043 after. Nothing was pushed, merged, deployed or migrated; no branch was created; no cloud resource was touched; the unidentified `CLOUDSDK_AUTH_ACCESS_TOKEN` was not used.

## Decisions
| Gate | Result | Consequence if not PASS |
|---|---|---|
| Driver Events functional completeness | **PASS** | — |
| Server-side validation and corrections | **PASS** | — |
| Evidence lifecycle enforcement in application/database | **PASS** (one real bypass found and fixed) | — |
| Real GCS/scanner acceptance | **NOT VERIFIED** | The real bucket permissions, Eventarc delivery and ClamAV behaviour for Driver Events uploads are unproven by this work. Not a development defect: Driver Events reuses the existing evidence-payload lifecycle and scanner unchanged (`services/` is identical to `origin/main`). It is a deployment-time check. |
| Tenant isolation and authorization | **PASS** | — |
| OOS restrictions and release enforcement | **PASS** | — |
| Denied-release audit durability | **PASS** (was FAIL; fixed, no migration) | — |
| Master Register and BI integration | **PASS** | — |
| Regression against baseline | **PASS** | 2 unit and 40 database failures plus 104 `tsc` errors are inherited from `0327263`, identical by name; no new failure. |
| Release artifact integrity | **PASS** | — |
| Additional spending required | **NO** | — |
| Development closure recommendation | **ACCEPT** | — |
| Production deployment recommendation | **HOLD** | Not a code defect. Production needs, from the owner: approval to push/merge, to apply migrations 0042–0043, and the existing production smoke test (`docs/evidence-lifecycle-production-acceptance.md`, P1–P9, under that document's own approval conditions) run once after deploy. Until then the real GCS/scanner path for Driver Events is unproven. |

**Can Driver Events development be closed now without another development cycle? YES.** Everything that remains is owner approval, deployment and deployment-time verification, or work outside Driver Events (below).

## Spending
**Is any additional spending genuinely necessary to finish Driver Events development? NO.** No development requirement needs paid infrastructure. The only thing that needs a real cloud is live GCS/scanner verification, and that is a production-deployment verification requirement, not a development blocker. It can use the infrastructure TES already has, as the existing production smoke test, with no new resources or cost. A zero-cost partial check (building the scanner container locally and running the N1–N5 checks with Docker) exists but was not run here. No staging environment is recommended.

## Evidence question: can required evidence validation be bypassed later?
Traced: creation → upload → scanner verdict → storage → link → verification → correction → closure/release (`lib/driver-events/operations.ts`, `lib/evidence-payload`).
- **Found and fixed (real bypass):** 19 of 21 recordable categories carry the policy `evidenceRequired: true` (the legacy wizard blocked saving without evidence). The canonical store enforced nothing, so such an event could be recorded and **closed with no evidence**, or have its last document unlinked after closing; and detail items could name arbitrary document ids, and an obtained uploaded-document statement needed no evidence at all.
- **Fix, narrow:** closing needs ≥1 active stored linked document where the category requires it; the last document of a closed event cannot be unlinked; items may reference only documents actively linked to this event (none at creation); referenced documents cannot be unlinked; an obtained uploaded-document statement must reference linked evidence to close; evidence-reference changes are now part of the correction history. Categories that do not require evidence (e.g. Other Event) are unaffected, and **verification is not demanded to close**. The closure rule is a service rule; this application is the only writer.
- **Already enforced, unchanged:** linking only `stored`, same-company documents (service and trigger); verification only for stored evidence; enforcement-release needs a linked, person-verified, stored `RELEASE_EVIDENCE` document, in the service and by trigger (`driver_event_release_evidence_ok`, migration 0042 line ~694).
- **Tests:** `driver-events.db.test.ts` "required evidence cannot be bypassed by recording, correcting, verifying, unlinking or closing" (fails when the closure check is disabled).

## Denied-release audit
Previously a refusal rolled back with the transaction and left no durable record. Now it is appended to the Master Register (`RESOURCE_ACCESS_ATTEMPTED`, outcome `FAILURE`, fixed reason code, actor, time, request id) in a separate transaction; no migration was needed because the Master Register, its event type and its append-only/read-restricted policies already exist. Details, limits and tests: [safety-enforcement.md](safety-enforcement.md). Limit: an actor holding no SYSTEM capability cannot write the register; such a denial appears only in the structured server log line.

## Boundary of real-cloud verification
1. **Verified application and database behaviour:** all rows above, against a disposable PostgreSQL with migrations 0001–0043, with an in-memory storage port and a simulated scanner for the byte-level steps.
2. **Verified by code and automated tests (no cloud):** portal storage port is create-only and generation-pinned (`lib/google/storage.ts`, `create-only-write.ts`); the scanner has its own decision, retry, integrity and lifecycle tests and a deployment-script test against a fake `gcloud` (`services/document-security-scanner/test`, `deploy/test/deploy.test.sh`); **they were not run in this assignment** and are not part of the root suite, so they are cited as existing, not as results.
3. **Unverified (needs a real environment):** the live bucket IAM, uniform access and public-access settings, Eventarc delivery, ClamAV in Cloud Run, the Workload Identity Federation path, and whether the real scanner flags a `%PDF-`-prefixed EICAR file. Simulated tests do not prove any of these.

## Regression (final tree `f4cf3bc`; baseline `0327263`)
| Check | Result | Baseline |
|---|---|---|
| Unit tests | 1082 / 1079 pass / 2 fail / 1 skipped | same 2 failures |
| Database + RLS suite | 1375 / 1332 / 40 / 3 | 1320 / 1277 / 40 / 3; failing-name sets identical |
| Driver Events database file | 21 / 21 | — |
| Security, tenant isolation, evidence lifecycle, OOS release | included above; mutation checks confirm the two new scenarios fail when their fix is disabled | — |
| `tsc --noEmit` | 104 errors | 104 |
| `next build --webpack` | exit 0 | exit 0 |
| Browser (real app + PostgreSQL, simulated scanner) | flow 26/26, forms 16/16, wizards 6/6, child corrections 5/5 | — |
| Migrations | 0001–0043 apply in sequence; none added in this assignment | — |

Reproduce: `bash scripts/test/run-auth-tests.sh` (database); `node --experimental-strip-types --import ./test/helpers/register-alias-loader.mjs --test $(git ls-files 'test/*.test.ts' | grep -v '\.db\.test\.ts')` (unit); `npx tsc --noEmit -p .`; `npx next build --webpack`. Raw outputs: `docs/driver-events/test-results/`.

## Files changed in this assignment
`lib/driver-events/operations.ts`, `service.ts`, `errors.ts`, `child-collections.ts`, `validation.ts`; `app/api/companies/[id]/driver-events/[eventId]/restrictions/route.ts` (passes `x-request-id`); `test/lib/driver-events/driver-events.db.test.ts` (+2 scenarios); `docs/driver-events/*`. **Migration added: none** (the audit reuses the Master Register).

## Verification of the release as delivered (section 1)
All 21 recordable categories exist in the registry and pass create → correct → evidence → close → fact → cross-company invisibility in one database test; the new-event workflow opens the category form directly (no chooser cards; navigation check in `test-results/navigation-check.txt`); the five detailed workflows and Roadside run their rules on the server, on create and every versioned correction; persistence is PostgreSQL with RLS, history is append-only (UPDATE/DELETE refused); Master Register attribution and BI facts are tested with consequence de-duplication; activation and transfer fail closed (tests with the lookup missing, NULL, raising); the Record of Events page and its API contain no `localStorage`, `sessionStorage` or IndexedDB use.

## Remaining limitations outside Driver Events development
Inherited baseline failures (2 unit, 40 database, 104 `tsc`); the legacy browser-local Driver workspace for drivers never moved; no canonical dispatch/trip/assignment/hours-of-service workflow exists (they must consult the active-restriction lookup when built); owner decision on cross-company disclosure of a driver's out-of-service status; regulatory-applicability review (49 CFR 390.15 / 396.9); a Roadside uploaded-document statement can only be added by correction after its evidence is linked.
