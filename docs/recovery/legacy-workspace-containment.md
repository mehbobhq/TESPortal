# Legacy workspace containment (Batch 1 correction)

Status: implemented locally on `recovery/batch1-pr20-on-security-rc`; not pushed, merged or deployed.

## Rule
The six browser-local workspaces (`legacy-authorities`, `legacy-business`, `legacy-credentials`, `legacy-drivers`, `legacy-insurance`,
`legacy-tax-filing`) and the in-page legacy Citations, Contacts, Settings and driver-detail implementations are **preserved as source and
never rendered**. `src/components/shared/LegacyWorkspaceGate.tsx` is the single choke point: it accepts the legacy implementation as
`children` (call shape unchanged, so PR #21's `canonical=` mounting still works) and deliberately does not place it in the output.

From the gate:
- no operational data is entered into a browser-local workspace;
- nothing is written to localStorage, sessionStorage or IndexedDB, and no `tes_companies` entry is created;
- the legacy credentials workspace (portal registry, credential entry, recovery detail) is unreachable.

## What the user sees
| Case | Result |
|---|---|
| Canonical company, module with a canonical workspace | the canonical workspace only |
| Canonical company, no canonical workspace yet | "… is not connected to the canonical records yet" with a link to the profile |
| Id that is not a TES company (old prototype id) | "This company is not a TES record" with a link to `/companies` |
| Lookup failure | "could not be opened" with Try again (never "not found") |

There is no preview mechanism for the legacy screens; none was invented. Restoring a legacy screen means integrating its canonical
replacement (Batch 2/3) and passing it as `canonical`.

## Corrections to earlier documents
Documents that describe companies "reachable as a browser-local tab", a `tes_companies` projection written by the gate, or the legacy
Credentials/Citations/Contacts/Settings behavior (`docs/company-recovery.md`, `docs/recovery/functional-regression-matrix.md`,
`docs/recovery/verification-report.md`, `docs/recovery/release-readiness.md`, `docs/recovery/tes-baseline-reconciliation.md`,
`docs/evidence/company-recovery/browser-verification.md`) describe the behavior **before** this correction and are superseded by this file.

## Enforcement
`test/lib/company-directory/legacy-workspace-containment.test.ts` (static) and the browser scenarios under
`scripts/verification/company-recovery-browser/pw` (`edit`, `workspaces`, `features`, `legacy`).
`components/use-company-summary.ts` still reads (never writes) a `tes_companies` fallback for navigation chrome.
