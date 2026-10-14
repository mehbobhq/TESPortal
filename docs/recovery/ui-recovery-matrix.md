# TES UI recovery matrix (branch `claude/ui-recovery`, base PR #20 checkpoint `d6782ee`)

Per-control detail lives in `docs/recovery/matrix/<workspace>.md`. This page is the index. "Unverified visually" means no browser
run has yet been made against the restored interface (see `ui-recovery-verification-report.md`); it does not mean untested at the
domain layer.

| Workspace | Original source | Restored component (mounted as canonical tab of `LegacyWorkspaceGate`) | Canonical operations connected | Remaining missing operations / domains |
| --- | --- | --- | --- | --- |
| Vehicles | `0e8e8c3^` page + `src/components/vehicles` | `src/restored/vehicles/**` | list/search/filters, add vehicle, unit-number correction, archive/restore, registration add/change/correct/void (new ops, `VEHICLE_MANAGE`), relationship end/unit change | ownership detail, permits, inspections, maintenance, repair bills, service providers, per-unit settings; vehicle evidence target; edit of type/VIN/year/make/model (no history semantics approved) |
| Drivers | `0e8e8c3^` + `src/components/drivers` | `src/restored/drivers/**` (register + 7-tab detail) | create driver (person + profile + licence + relationship, atomic), add existing driver, name/email/phone change or correct, relationship change/correct/end, licence add/correct/void, medical periods add/change/correct/void | DOB/address/region, applications, hiring, training, performance, HOS, company actions, citations, evaluations, non-medical screenings, driver evidence |
| Insurance | `0ba9436^` | `src/restored/insurance/**` | create (transportation / WCB / bond), correct vs endorse, renew, broker change/correct, archive (+reason in event), restore, organization resolution via company registry and Contacts | notes, WCB jurisdiction, COI group, policy evidence link, OCR, Trailer Interchange coverage, insurer correction |
| Authorities | `a36acf1^` | `src/restored/authorities/**` | create/edit/status/archive/restore with change-vs-correct, number check, version+status history | MCS150, UCR, PHMSA, OTHER kinds, display name, notes, safety snapshots, audit records, evidence/OCR link |
| Tax Filing | `a36acf1^` | `src/restored/tax-filing/**` | profile create/edit/status/archive/restore, number check, applicability from company rules, history | frequency history, calendar, manual periods, filing records, Form 2290, verification fields |
| Credentials | `e4fa336^` | `src/restored/credentials/**` | list, add (credential + recovery slots atomically), status change/correct, verification record/void, metadata, replace login, slot declare/retire, secret-reference link, archive/restore, portal registry maintenance | secret values and recovery answers (approved: no storage), question text, recovery labels |
| Business | `971e15e^` | `src/restored/business/**` | CRA BN / EIN register, change, correct, retire (history kept); corporate documents via evidence lifecycle (`OTHER_EVIDENCE`) | incorporation date, directors/shareholders, annual returns, GST/HST, state sales tax, change ledger, audit cases |
| Contacts | contacts page pre-cutover | `src/restored/contacts/**` | manual add (person, title, PRIMARY purpose, channels), existing-person link, name/phone/email/role change or correct, primary designation, archive/restore, purposes, company phone/email lines | DOB, licence fields, notes, document intake/OCR confirm, Master Register revision read |
| Settings | settings page pre-cutover | `src/restored/settings/**` | six-section profile: operating scope, rule applicability, driver minimums; save runs one canonical op per item; correction vs change | clearing a rule to "Not configured", clearing driver minimums |
| Company Profile / Creation | PR #20 | `app/companies/[id]/profile`, `app/companies/new` | atomic creation, canonical duplicate/name panel (this branch), edit with change/correct | ten fields with no canonical owner (see `canonical-field-ownership.md`) |
| Citations | pre-cutover | unchanged, browser-local, banner | none: no canonical domain | whole domain (decision required) |

## Rules enforced mechanically
- `test/lib/ui-recovery/restored-ui-boundaries.test.ts`: nothing under `src/restored/**` (or transitively imported at runtime) uses browser storage, `tes_*` keys, legacy audit/OCR/evidence stores.
- Evidence-payload importer ratchet and Phase D/E cut-over tests untouched.
- Every writing operation takes the company from the URL, answers another company's record as not found, and writes its Master Register event in the same transaction (DB tests `test/lib/ui-recovery/*.db.test.ts`).
