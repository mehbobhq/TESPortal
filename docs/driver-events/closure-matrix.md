# Driver Events — independent review: closure matrix

Commit under review: `829a628` (delivered) → corrective commits on top (see the end). Status vocabulary: **PASS** (demonstrated by a test or run listed), **FAIL** (known defect, none open), **NOT VERIFIED** (could not be demonstrated in this environment — the reason is stated).

**Development-complete ≠ production-ready.** Everything below marked PASS is development-complete. Production readiness additionally needs the NOT VERIFIED items, the owner decisions and the approvals listed at the end. Nothing has been pushed, merged, deployed or migrated in production.

## 1. Review baseline
| Item | Status | Evidence |
|---|---|---|
| Delivered commit descends from `origin/main` `0327263`, which contains migrations 0040 and 0041 | PASS | `git merge-base --is-ancestor 0327263 HEAD`; `git log` shows 0040 `b24a92e`, 0041 `44557af` below `0327263` |
| Self-contained review bundle | PASS | `driver-events-review-full.bundle` (complete history of HEAD, clonable with no other repository) and `driver-events-delta-0327263.bundle` (`0327263..HEAD`, needs `0327263`); SHA-256 in the final message |
| No new branch, no production change | PASS | detached commits only |

## 2. Architecture against the code
| Check | Status | Evidence (`test/lib/driver-events/driver-events.db.test.ts` unless stated) |
|---|---|---|
| Tenant isolation, cross-company identifiers | PASS | other company: get / status / link evidence → not found; list empty; foreign driver/vehicle relationship refused; foreign evidence refused (service **and** database trigger); RLS returns no rows without an authorized context; browser: 404 through another company |
| Capabilities / API authorization | PASS | no capability, read-only, wrong capability → 403 (service tests and browser); release needs its own capability (service and database policy) |
| Stale writes | PASS | wrong `expectedVersion` → conflict; second writer on the same version loses |
| Immutable history, no deletion | PASS | history UPDATE/DELETE refused for the owner role; event DELETE refused; every version keeps its snapshot |
| Duplicate handling, double counting | PASS | candidates offered; duplicate leaves analytics; downstream record attaches once; one source reference carries one active consequence per kind; superseded rows kept |
| Master Register | PASS | creation, correction, status, link and evidence events attributed (test 1 and lifecycle) |
| Unauthorized safety release | PASS | manage-only actor denied; row not updatable under manage; direct SQL refused by trigger |
| Analytical fact derivation | PASS | `bi.test.ts` (42 unit tests in the folder) + database lifecycle |
| Record of Events UI | PASS | browser: workflow 25/25, 15 category forms, 6 wizards, correction flow 5/5 |

## 3. Safety enforcement across the wider system
See [safety-enforcement.md](safety-enforcement.md).
| Check | Status |
|---|---|
| Event closure / Not Applicable / duplicate marking / correction / draft / non-mandatory order bypasses closed | PASS (tests) |
| Driver activation refused while restricted | PASS (test, refused for the stated reason) |
| Driver transfer refused while restricted | NOT VERIFIED by an automated test (implemented; needs a verified-identity fixture) |
| Dispatch, trip, load assignment, movement, driver–vehicle assignment, hours of service | NOT APPLICABLE — **no canonical workflow exists**; the lookup (view, SQL function, API) is ready; system-wide enforcement is **not** claimed |
| Cross-company visibility of a driver's order | NOT IMPLEMENTED (owner decision on disclosure needed) |
| Legacy browser-local driver/vehicle workspaces | NOT ENFORCED (no link to the canonical store) |

## 4. Evidence against the real lifecycle
| Check | Status | Evidence |
|---|---|---|
| Real GCS buckets and the real malware scanner | **NOT VERIFIED** | no bucket configuration, credentials or scanner exist in this environment; nothing was pointed at production resources |
| Lifecycle state machine (quarantine → scanner output → hash re-verification → evidence), with an in-memory port that enforces create-only writes, pinned reads and a scanner as sole writer of intake | PASS | repository's own `evidence-payload/lifecycle.db.test.ts` (in the full suite) + this work's tests |
| Wrong company | PASS | refused (not found), and refused by trigger beneath the service |
| Unscanned (quarantined) | PASS | cannot be linked |
| Failed scan / swapped bytes | PASS | payload `blocked`; cannot be linked |
| Linked but unverified; rejected; wrong role | PASS | none can release a restriction |
| Release evidence requirement | PASS | stored + scanned + same company + role RELEASE_EVIDENCE + person-verified, enforced in service and trigger |

## 5. Correction integrity (child collections)
| Check | Status |
|---|---|
| Versioned, attributed correction of items (add / change / remove), reason required, history names each item and its before/after, earlier version readable in full | PASS (database test + browser) |
| Server validates structure and Roadside collection rules (one power unit, equipment required, violations, statements) | PASS |
| Header values the form does not edit are carried through a correction unchanged | PASS (browser run showed and fixed a lost reporter label) |
| Cross-field rules of the Collision / Cargo / Spill / Customer wizards re-run on the server | NOT VERIFIED / not done — they reference browser-held evidence ids; server enforces structure, registry facts and units |
| Controlled values inside non-Roadside child items checked against taxonomies on the server | not done |

## 6. Test reconciliation
See [test-reconciliation.md](test-reconciliation.md).

## 7. Category and analytical completeness
| Check | Status |
|---|---|
| All 21 recordable categories: create, reload, correct, link and verify evidence, consequences, close, fact, cross-company invisibility | PASS (one database test loops the registry) |
| Shared workflow omits no category-specific field | PASS — every creatable registry field of every category is reachable in its workflow (test); required and conditional facts are enforced by the server (a missing one is refused) |
| Consequence refreshes the fact, no double counting | PASS |
| Measured / estimated / unverified / none confirmed / unknown distinguishable | PASS (`measurement_profile`, confirmed vs unconfirmed cost) |

## Production readiness — open items
1. Real GCS and scanner verification in an authorized non-production environment.
2. Owner decision: cross-company disclosure of a driver's out-of-service status.
3. Regulatory applicability review (49 CFR 390.15 / 396.9 and Canadian provincial rules) before any automatic determination.
4. Dispatch / trip / assignment / HOS workflows, when built, must consult the active-restriction lookup.
5. Telematics / ELD ingestion; trip, shipment and customer canonical records.
6. Server-side re-run of the detailed-wizard cross-field validators.
7. Approval to push, merge and apply migrations 0042 and 0043 to production.

## Corrective commits (on top of delivered `829a628`)
| Commit | Content |
|---|---|
| `23c2254` | direct category-to-form entry (both selection cards removed), versioned child-collection corrections, safety-restriction bypasses closed, migration 0043, confidence-aware facts, tests |
| `6390b72` | closure matrix, test reconciliation, final verification results |
| final | navigation check output; closure matrix corrections |

Final regression on `23c2254`: unit 1074/1071/2/1; DB 1371/1328/40/3 (failing set identical to `0327263`); tsc 104; `next build --webpack` exit 0.
