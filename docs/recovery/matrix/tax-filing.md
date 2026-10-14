# Tax Filing: UI recovery matrix

Original: `git show 'a36acf1^:app/companies/[id]/tax-filing/page.tsx'` (1511 lines, browser-local `tes_company_tax_filing_<id>` and
`tes_company_compliance_settings_<id>`), extracted unchanged as `app/companies/[id]/tax-filing/legacy-tax-filing.tsx` (second tab; untouched).
Canonical: `lib/tax-registrations` (migration 0016; 12 programs; registrations with versions and status periods; NO filing, obligation,
frequency or evidence entities) and company-profile TAX rule applicability (migration 0019).
Restored UI: `src/restored/tax-filing/**`, mounted by `app/companies/[id]/tax-filing/page.tsx` as the canonical tab of `LegacyWorkspaceGate`.

## Component map

| Original file | Recovered implementation | Notes |
|---|---|---|
| `tax-filing/page.tsx` (tabs Tax Profile / Filing Calendar / Filing Records, summary strip, applicability warning, unsaved prompt) | `RestoredTaxFiling.tsx` | storage, audit logger and obligation generation removed; same layout and components |
| `TaxProgramList.tsx`, `FilingCalendarWorkspace.tsx`, `FilingRecordsWorkspace.tsx`, `FrequencyAssignmentForm.tsx`, `FilingRecordForm.tsx`, `tax-definitions.ts`, `tax-helpers.ts`, `types.ts` | reused unchanged from `src/components/tax-filing` | pure presentation; they import no storage module, so no copy was needed (the boundary test passes transitively) |
| `TaxProfileWorkspace.tsx` | `src/restored/tax-filing/TaxProfileWorkspace.tsx` (copy + additions) | + Issued On / Expires On / Base Jurisdiction, Registration History (versions + status periods), Archive / Restore, inline error, unavailable notes |
| `TaxProfileForm.tsx` | `src/restored/tax-filing/TaxProfileForm.tsx` (copy + additions) | + Base Jurisdiction (IFTA; required by the canonical rule), Issued On, Expires On, number check, change-vs-correct choice, unavailable note for verification fields |
| (new) | `adapter.ts` (`useCanonicalTaxFiling`), `model.ts`, `types.ts` | only the adapter talks to the API |
| (new) | `app/api/companies/[id]/tax-registrations/check/route.ts` | advisory registry check (existing `checkRegistrationNumber`, `TAX_REGISTRATION_READ`) |

## Control classification

| Restored control | Class | Canonical operation / behaviour |
|---|---|---|
| Applicable Tax Programs list (11 original programs) | read | `GET /settings` rules: each program's applicability = effective applicability of the mapped catalogue rule (`IFTA`, `CT_HUF`, ..., `FORM_2290`, `FUEL_CHARGE_REGISTRATION`, `TEXAS_EXCISE_TAX`, `ARKANSAS_MOTOR_FUEL_TAX`, `ONTARIO_TOBACCO_TAX`); "not configured" stays "not configured"; unreadable settings assume nothing. A program with an existing registration is never hidden |
| Summary strip, applicability warning, Company Settings link | read | `/profile` + settings |
| Profile (account number, status, effective date) | read | `GET /tax-registrations` -> `mapRegistrationView` |
| Needs setup -> new profile -> Save Record | create | `POST /tax-registrations` (program, number, base jurisdiction for IFTA, issuedOn, expiresOn, status, effectiveFrom from Effective Date) |
| Edit Profile, real-world change | update | `PATCH {action: "version"}` (renewed period dates; IFTA number / base move) and `{action: "status"}`; Closure Date = `effectiveFrom` of the Closed status |
| Edit Profile, recorded value was wrong | correct | `{action: "correctVersion"}` / `{action: "correctStatus"}`; wrong value kept and flagged. Non-IFTA numbers and jurisdictions only correct (server rule, pre-checked in the UI) |
| Number check | read | `POST /tax-registrations/check` -> `checkRegistrationNumber`; duplicate creation also blocked in the transaction |
| Account Status | lifecycle | PENDING/ACTIVE/SUSPENDED/INACTIVE/CLOSED (same five as the original) |
| Archive / Restore Registration | lifecycle | added control; `{action: "archive"}` / `{action: "restore"}` (the original used the Closed status only) |
| Registration History | read | `versions` + `statusPeriods`, corrected rows flagged |
| Verification Source / Reference / Last Verified Date / By, Notes | missing domain | no canonical home: shown; a profile that fills them is refused |
| Filing Frequency (current) and Frequency History, Add Change, Save Frequency | missing domain | no frequency in the canonical model: frequency shows "Not set" (never defaulted), history empty, the assignment form opens and Save refuses |
| Filing Calendar (generate year / generate active / manual period / year selector / Upload) | missing domain | no obligation entity: the calendar is honestly empty; generate / manual / upload refuse with a note. No domain was invented |
| Filing Records tab | missing domain | honestly empty |
| Record Filing Submission form (return type, method, date, amounts, payment status, confirmation no., notes) with the **evidence-required** rule | missing domain | form and the "Filing Evidence Required" panel stay visible (added entry button because no period can be selected); Save shows the original evidence-required message and the unavailable reason; nothing is stored |
| Upload evidence / Upload Filed Return / Add Supporting Document / preview | missing domain | the evidence lifecycle is organization-level with no link to a registration or filing: controls kept, unavailable note naming the gap, no bytes stored in the browser |
| Form 2290 | missing domain | in the list when applicable; no registration identity (federal, filed under the EIN): Save refuses, number check refuses |
| SCAC, CA carrier code (canonical programs not in the original workspace) | read | not shown in the restored program list; every canonical registration (including these two) remains visible in the "Simplified TES records list" below the workspace (`CanonicalRegistryPanel`, kept for that purpose) |
| Company master sync (`tes_companies` acc* fields) | removed | the canonical registration is the source of the profile account fields |

## Known limitation

The original model held one profile per program. Canonical allows several registrations per program (for example more than one
IFTA base); the restored list opens the newest non-archived one. The simplified list below shows all of them.

## Verification

- `test/lib/ui-recovery/authorities-tax.db.test.ts` (DB, runtime role): "tax: every action stays inside the URL company...", "tax: a renewed period is a real change, an IFTA base move changes in place, other programs only correct, and the restored mapping shows it", "tax: SCAC and the CA carrier code are canonical but not original tax programs, and Form 2290 has no registration identity", "tax: applicability comes from the canonical company-profile TAX rules and 'not configured' stays honest", "tax: authorization is enforced and a refused Master Register event rolls the creation back".
- Static: `restored-ui-boundaries.test.ts`, `phase-de-cutover-boundaries.test.ts`, `company-directory-boundaries.test.ts` (panel still satisfies `CompanyMissing`).
- Not verified here (no browser run): visual layout, overlay stacking.
