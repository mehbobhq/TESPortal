# Recovery Batch 2: canonical operational workspaces

Local only (`recovery/batch2-canonical-workspaces`, based on Batch 1 `030a0ff`). Not pushed, merged or deployed.

Source: `claude/ui-recovery` (PR #21), seven workspaces only. Cherry-picked with `-x`: scaffolding `5a61a19`, Credentials `19587a1`,
Authorities + Tax Filing `6a35e20`, Insurance `ff24824`, Contacts + Settings `fd12fdc` + `0a84e67`, Business `4d83565`, DB tests and matrices
`191feff 0695ae9 9ae8b16 54ccffb`. Not taken: Vehicles (`bc7fdf9 cef5beb`), Drivers (`3e5b599 6785b79 4f12c6b`), `5d2be97` (new-company panel), `18ffc73` (index/reports).
The only conflict was the test-runner glob (union). Every workspace mounts through `LegacyWorkspaceGate canonical={...}`; the gate still never renders legacy code.

| Workspace | Canonical read/write | Not operational (shown as unavailable, refuses rather than drops) |
|---|---|---|
| Authorities | list, add, edit (change vs correct), status, archive/restore, number check | MCS-150/UCR/PHMSA/Other kinds, safety snapshots, audits, notes/dates/issuer text, evidence attach/OCR, deadline settings |
| Tax Filing | tax registrations and applicability read; profile from Settings | filing calendar/records have no canonical store |
| Insurance | policies, terms, renew, cancel, endorsements, broker, WCB, bonds, archive with reason in the Master Register event | OCR, policy evidence, notes, COI groups, WCB jurisdiction, insurer change, coverage add/remove UI |
| Credentials | credential create/replace/metadata/status/verification, secret SLOTS declared (never values), portal registry | secret values, security-question text, portal legal name/services |
| Business | incorporation read; CRA BN and IRS EIN register/retire (history) | directors/shareholders, annual returns, GST/HST programs, state sales-tax IDs, corporate papers evidence, change ledger read |
| Contacts | person, channels, titles, purposes, primary, relationships, archive/restore | DOB, licence, notes, evidence/OCR |
| Settings | operating scope, rule applicability, driver minimums (change vs correct) | clearing a rule answer, atomic multi-item save |

`LegacyWorkspaceGate` now reports a 401/403 lookup as "not permitted" (before: a temporary failure with Try again).
Verification: `docs/recovery/batch2-verification.md` is not separate; see the Batch 2 report and `test/lib/ui-recovery/*`, `scripts/verification/company-recovery-browser/pw/b2-*.mjs`.
