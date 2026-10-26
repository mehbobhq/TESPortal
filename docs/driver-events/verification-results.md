# Driver Events — verification results (closure, tree `f4cf3bc` plus documents)

Run on a disposable PostgreSQL cluster with all migrations 0001–0043 applied by the repository's runner; the application connects as the runtime role under row-level security. Nothing was pushed, deployed or run against production. Raw outputs: `docs/driver-events/test-results/`.

| Check | Result | Baseline `0327263` |
|---|---|---|
| Unit tests (non-database) | 1082 tests, 1079 pass, 2 fail, 1 skipped (+8 new: workflow rules) | same 2 pre-existing failures (`authorization layer boundaries / SYSTEM wrapper never writes tenant context`, `driver-application/plan.test.ts`) |
| Database + RLS suite (`run-auth-tests.sh`) | 1375 tests, 1332 pass, 40 fail, 3 skipped | 1320 / 1277 / 40 / 3; failing-name sets identical, no new failure |
| Driver Events database scenarios (`driver-events.db.test.ts`) | 21 / 21 pass (+2 in closure: evidence requirements through the lifecycle; durable denied-release audit) | — |
| `tsc --noEmit` | 104 errors | 104 (unchanged) |
| `next build --webpack` | exit 0 | passes |
| Browser — workflow (Chromium, real app, real PostgreSQL, evidence lifecycle with simulated scanner) | 26 / 26 | — |
| Browser — each own-workflow category through its form | 16 / 16 | — |
| Browser — each of the 6 detailed wizards saved to the server | 6 / 6 | — |
| Browser — child-collection correction versions | 5 / 5 | — |

Browser runs use a simulated scanner, not the real one (see below).
| Direct category → form navigation, all categories incl. Others, no selection cards | verified (`navigation-check.txt` in the review pack) | — |

## Not verified
- Real GCS buckets, credentials and malware scanner: **NOT VERIFIED**. No credentialed account, bucket configuration or scanner endpoint exists in this environment (`gcloud auth list`: no credentialed accounts; no bucket/scanner variables). The in-memory storage and simulated scanner prove the application's state machine, not the real integration. See `production-gate-corrections.md`.
- (resolved in the production gate) Driver transfer safety enforcement now has automated tests, including fail-closed cases.
- Cross-company disclosure of a driver's out-of-service status: not implemented; owner decision needed.
- (resolved in the production gate) The detailed workflows' controlled-value and cross-field rules now run on the server. Not applied: rules that require a child item to reference already-linked evidence.
- Regulatory applicability and deadlines (49 CFR 390.15, 396.9): no conclusion computed.
- Dispatch, trip, assignment, movement and HOS enforcement: no canonical workflow exists, so system-wide enforcement is not claimed (see `safety-enforcement.md`).

Development-complete: yes, for the scope above. Production-ready: no — needs the NOT VERIFIED items resolved, production migrations 0042–0043 approved and run by the owner.
