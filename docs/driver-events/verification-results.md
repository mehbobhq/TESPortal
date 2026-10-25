# Driver Events — verification results

Run against the committed tree on a disposable PostgreSQL cluster (all migrations 0001–0042 applied with the repository's own runner; the application connects as the runtime role under row-level security). Nothing was pushed, deployed or run against production.

| Check | Result | Baseline before this work |
|---|---|---|
| Unit tests (all non-database `*.test.ts`) | 1066 pass, 2 fail | the same 2 known failures (`authorization layer boundaries / SYSTEM wrapper`, `driver-application/plan.test.ts`) |
| New unit tests (`test/lib/driver-events/*.test.ts` except `.db`) | 37 pass: validation of all 21 recordable categories, units, time zones, conditional facts, BI derivation, obligations, workflows, wizard adapter, reconciliation | — |
| Database + RLS suite (`scripts/test/run-auth-tests.sh`) | 1367 tests, 1324 pass, 40 fail | 40 failures; the failing set is a subset of the baseline set (one baseline failure now passes) |
| New database tests (`driver-events.db.test.ts`) | 13 / 13 pass | — |
| `tsc --noEmit` | 104 errors | 104 (same set) |
| `next build --webpack` | compiled successfully; `/companies/[id]/record-of-events` built | passes |
| Browser — workflow (Chromium, real app, real PostgreSQL, real evidence lifecycle with a scanner simulation) | 25 / 25 | — |
| Browser — each of the 15 own-workflow categories created through its form | 15 / 15 (+ no page errors) | — |
| Browser — each of the 6 detailed wizards saved to the server | 6 / 6 | — |

What the database tests prove (`driver-events.db.test.ts`): create / reload / version / correct with reason / stale-write refusal; immutable history and no deletion; **every recordable category** through create → correct → evidence link → verify → close → fact, invisible to another company; roadside out-of-service creates a mandatory restriction that status change, correction and company clearance cannot clear, release only by the dedicated capability with verified, stored, same-company release evidence; evidence lifecycle (quarantined cannot be linked, stored can, other company's file refused); duplicate exclusion and one-owner downstream records; consequence de-duplication, supersession, missing-is-not-zero and mixed-currency handling; read-only / no-capability / cross-company denial and row-level security with no context; every documented BI example query.

What the browser run proves: the Record of Events page works only through the server API (no TES key ever in localStorage / sessionStorage / IndexedDB); required facts and units are enforced by the server and shown; a quarantined upload is not linked until it is stored; a person verifies evidence; a correction needs a reason and creates version 2 with the earlier version in the history; an unsafe-vehicle answer holds the vehicle; closing is refused while the hold is active and, after release, while required follow-up is open; release is refused without the dedicated capability; a read-only member cannot write; another company sees nothing.

Not covered by an automated check: the visual design of the screens was reviewed from screenshots only; regulatory applicability (see architecture, "Not verified or not done").
