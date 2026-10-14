# UI recovery verification report (`claude/ui-recovery`)

## Results on the merged tree (head after the Drivers merge)
| Gate | Result |
| --- | --- |
| `tsc` vs unmodified-main baseline | 110 diagnostics, identical set to baseline. One new diagnostic (contacts page re-exporting non-page values) was found and fixed. |
| Static tests (all non-DB `*.test.ts`) | 908 run, 905 pass, 3 fail. All three also fail on `main`: `tes-boundaries` ("SYSTEM wrapper never writes tenant context": `lib/auth` unchanged, `main` has the same `set_config`), `identity-additions` migrations list (`main` contains 0029, test predates it), `operational-identity/normalization`. |
| Full DB suite (`scripts/test/run-auth-tests.sh`, throwaway PG, real migrations, runtime role) | 1194 run, 1154 pass, 40 fail. Every failing name is in `docs/recovery/inherited-failures-on-main.txt` (comparison by name: zero new). |
| New DB tests (`test/lib/ui-recovery/*.db.test.ts`) | vehicles 8, drivers 12, insurance 8, authorities-tax 10, contacts-settings 16, credentials-business 7: all pass (as part of the full run). |
| `pnpm build` | passes. |
| Boundary tests (restored UI no browser storage; evidence ratchet; Phase D/E) | pass; no existing test was edited or weakened. |

Note: worker worktrees under `.claude/worktrees/` made the repository-scanning boundary tests fail until they were removed; they were
removed (branches kept).

## What the DB tests prove, per workspace
Company isolation of every write, change-vs-correction history, Master Register events in the same transaction (without personal
data), rollback when the Master Register write is refused, authorization (read vs manage, signed-out), no secret leak (credentials).

## NOT verified (honest status)
- **Browser end-to-end and screenshots of the recovered app: not done.** The disposable-database harness
  (`scripts/verification/company-recovery-browser/`) could not be started: the sandbox's permission classifier refused the script
  that creates the throwaway local PostgreSQL (it uses production-named roles on 127.0.0.1). It was not retried or bypassed.
  Layout, modal stacking, and interactive flows of all restored workspaces are therefore unverified by eye; every worker flagged the
  same checklist (see each `matrix/<workspace>.md`). Previous-phase screenshots in `docs/evidence/company-recovery/` predate the restoration.
- The browser harness stubs Clerk and the database pool; even when run it proves UI behavior against a disposable DB, not production connectivity.
- The new duplicate/name panel in `app/companies/new` is covered by typecheck and static tests only.
- No preview or production environment was touched.
