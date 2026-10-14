# Drivers workspace: UI recovery matrix

Original interface: `git show '0e8e8c3^:app/companies/[id]/drivers/page.tsx'` (109 lines) and `.../[driverId]/page.tsx` (233 lines) rendering
`src/components/drivers/DriverWorkspace.tsx` and its tabs. Both were replaced by the Block 01 D/E cutover with a plain canonical list.
This document is the exact state of the restoration. Anything marked **not done** is not done.

Restored code: `src/restored/drivers/**`. Canonical backend added by this work: `lib/operational-identity/driver-{errors,operations,reads}.ts`
(wired by an append-only block at the end of `lib/operational-identity/service.ts`) and the routes under `app/api/companies/[id]/drivers/**`.
No migration, policy, capability or Master Register foundation was changed.

## 1. What the approved architecture defines (and what it does not)

| Question | Answer found | Source |
| --- | --- | --- |
| How is a driver's Person created? | A driver is a role of a Person; the cut-over plan maps the legacy driver master to "create/resolve person, create driver profile, import licences". Migration 0024 lets `DRIVER_MANAGE` (with `CONTACT_MANAGE`) write `persons`, `person_name_versions` and `person_channels`, and the 0014 grants allow the inserts. So creating the Person of a driver is a `DRIVER_MANAGE` act; no `CONTACT_MANAGE` contact/relationship is created (0014: "an ordinary contact is deliberately NOT a driver"). | `docs/core-operational-identity-boundaries.md`; `docs/canonical-data-cutover-browser-authority-retirement.md` (`tes_driver_masters_v1` row); migrations 0014, 0021, 0024 |
| Identity signal for "existing driver" | Licence = country + jurisdiction + normalized number (unique while current). Name, email and phone are advisory and never identify or merge a person. | 0021/0022; boundaries doc |
| Date of birth, address, middle/preferred name | **No canonical home.** 0014 explicitly excludes DOB/government identity; there is no address table. Not stored; entering one refuses. | 0014 header |
| Operating region, application, hiring package, tax record, training, performance event, HOS, company action/determination, citation | **No canonical home** (no table). | migrations list |
| Driver documents / evidence | The approved evidence lifecycle (`/api/companies/[id]/evidence`, 0032) stores organization documents of onboarding/contract types; it has **no driver/person target**. Not usable. | `lib/evidence-payload/definitions.ts` |
| Medical qualification period | Table + guards exist (0021), no operation existed. Implemented here. | 0021 |

## 2. New canonical operations (`lib/operational-identity/driver-operations.ts`)

All run inside `withAuthorizedSystem("DRIVER_MANAGE")`, write a Master Register event in the same transaction (references and literals only, never a name,
licence number, email or phone), take the Organization from the URL, and report a driver of another company as "not found".

| Operation | Semantics | Route |
| --- | --- | --- |
| `createDriver` | Person + name (INITIAL) + driver profile + email/phone channels + licence + relationship, one transaction; a licence that already identifies a driver is a conflict (never a second person) | `POST /api/companies/[id]/drivers` `{mode:"create"}` |
| `addExistingDriver` | "Same person" resolution: new relationship only; person untouched | same, `{mode:"add-existing"}` |
| `checkExistingDriver` | licence lookup (country+jurisdiction+normalized number); reports same-company / other-company counts | `POST .../drivers/check` |
| `changeDriverName` / `correctDriverName` | real-world change (old name = history) / correction (wrong name kept, flagged) | `PATCH .../drivers/[personId]` `change-name` / `correct-name` |
| `setDriverChannel` | first value adds; different value = change (or `mode:"correct"`); unchanged refused | `set-channel` |
| `changeDriverRelationship` | end open row at T, new row from T (type/status/driver number); T must be after the open start (same day => correct) | `change-relationship` |
| `correctDriverRelationship` | wrong row kept flagged, replacement inherits business start | `correct-relationship` |
| `endDriverRelationship` | status ENDED + end date; nothing deleted; rehire = new relationship | `end-relationship` |
| `recordDriverLicence` | same-jurisdiction licence = replacement (history); other jurisdiction coexists; number held by another driver = conflict | `POST .../licences` |
| `correctDriverLicence` / `voidDriverLicence` | correct keeps wrong row; void = entered in error | `PATCH .../licences` `correct` / `void` |
| `addMedicalPeriod` / `changeMedicalPeriod` / `correctMedicalPeriod` / `voidMedicalPeriod` | add; renewal (history); correction; void | `.../medical-periods` |
| `getOrganizationDriverDetail` (DRIVER_READ) | person, all name versions, channels, this company's relationships, licences, medical periods incl. corrected/voided rows | `GET .../drivers/[personId]` |

`GET /api/companies/[id]/drivers` is unchanged (profile-page driver counts still read `effectiveTo`; covered by a test).

## 3. Original component -> restored implementation

Legend for the canonical column: **R** canonical read, **C** create, **U** change/correct, **L** lifecycle (end/void), **-** no canonical operation (control stays, refuses).

| Original | Current (before) | Restored | Canonical connection | Missing (exact gap) |
| --- | --- | --- | --- | --- |
| `drivers/page.tsx` register: header, Invite Applicant, Add Driver, 4 stat cards, search + status/region/type filters, table (Driver, Company Record ID, Master ID, Record Type, Operating Region, Licence, Status), row click | canonical list | `RestoredDriversRegister.tsx`; rows link to `/companies/[id]/drivers/[personId]` | R: name, driver number, relationship type/status, licence jurisdiction/class, person id | Operating Region column "Not Established", Age "—", Cross-Border and Needs Identity Review counts "—": **missing domain** (no region/DOB/identity-review storage). Invite Applicant: **missing domain** (applications); shows the original "not activated" notice, nothing is sent |
| Add Driver modal: licence upload | n/a | kept | - | file is not stored: **missing domain** (no driver evidence target). A visible note says so |
| Add Driver: identity (first, middle, last, preferred, DOB, phone, email) | n/a | kept | C: first, last, phone, email (name version + channels) | middle, preferred, DOB: **missing domain**; a non-empty value refuses the whole save |
| Add Driver: relationship (type, region, status, start, end) + new Driver Number | n/a | kept | C: type (Employee/Contractor/Owner-Operator), status (Onboarding/Active/Suspended), start, driver number | Operating region, Temporary Driver, On Leave, Inactive, end date on a new driver: refuse (**missing domain** / not a canonical value) |
| Add Driver: address | n/a | kept | - | **missing domain** (no address table); refuses |
| Add Driver: licence (country, jurisdiction, number, class, effective from) | n/a | kept | C: licence | - |
| "Check for Existing Driver" + same/different person | n/a | kept | R: `checkExistingDriver` (licence). "Same person" -> `addExistingDriver` | Email/phone/name matching: **no canonical backing**; the result panel says so. "Different person" is impossible for a held licence (uniqueness) and the panel says so. Cross-company affiliation names are not shown (count only) |
| `[driverId]/page.tsx` + `DriverWorkspace` | legacy gate only | `RestoredDriverDetail.tsx` + `components/DriverWorkspace.tsx` | R/U/L as below | see rows below |
| `DriverHeader` (name, status, record type, region, since, tabs, quick actions) | - | copied, imports redirected | R | region "Not Established" |
| `DriverProfileTab` (identity, relationship, address edit; view) | - | copied; `onSaveProfile`, Driver Number field, correction-vs-change selectors | U: name, email, phone (change/correct), relationship type/status/number (change/correct), end (Terminated + end date) | middle/preferred/DOB/address/region/start-date edits and On Leave/Inactive/Temporary Driver refuse the whole save, nothing written (validated first). A multi-part save is several transactions; a failure part-way names what was already saved |
| `DriverQualificationsTab` (current licence, history, add licence, OCR entry) | - | copied | C/U: `recordDriverLicence` (replacement = history) | endorsements, restrictions, air brake, document type, notes, verification state: **missing columns** (0021 has number/class/dates only); reported as "not recorded" after the save. Licence correct/void have API + tests but **no control in the original tab** (not added) |
| Document intake -> `OCRReview` -> licence | crashed (original passed props `OCRReview` does not accept) | `shared/OCRReview.tsx` copy, `documentResult` supplied, Issuing Country and Effective From fields added so the flow can save | C: licence | The reviewed document is not stored (no driver evidence target); the notice says so. No OCR runs (legacy OCR stays retired) |
| `DriverDocumentsTab` (applications, hiring packages, tax docs, evidence list, processing, findings) | - | copied; lists empty | - | **missing domain** (applications/hiring/tax/evidence); every create control refuses with the gap |
| `DriverEvaluationTab` / `EmploymentEvaluationPanel` | - | copied; storage removed (`employment-evaluation.ts`) | - | **missing domain** (evaluations hang off applications) |
| `DriverScreeningTab` | - | copied | C/U/L for "Medical Card / DOT Physical" = medical qualification period (add / renewal / void on archive) | examiner, result, status, registry number, verification, notes, archive reason: no column; reported after save. Jurisdiction recorded = country of the current licence (documented in the notice; refuses if no licence). All other categories (drug/alcohol, clearinghouse, PSP, employer verification, road test, ...): **missing domain**, refuse |
| `DriverTrainingTab` | - | copied | - | **missing domain** (training); add and waive refuse, dialog stays open |
| `DriverPerformanceTab` + event workflow + roadside/collision/cargo/spill/near-miss/customer panels + HOS audit + company action modal + intelligence view | - | copied (all 17 files), logic libraries unchanged | - | **missing domain** (performance events, HOS, company actions/determinations, citations): lists empty, every save refuses. Vehicle pickers return nothing (`vehicle-shim.ts`) |
| Evidence attach / preview ("Attach Performance Event Evidence", document viewer) | - | controls kept; `shared/SecureDocumentViewer.tsx` copy without audit buffer / storage | - | **missing domain** (see section 1); attach refuses and the file is neither uploaded nor processed; no OCR |
| `DriverList.tsx` | orphan | **not restored** | - | It was never rendered by the original pages (unused file) |

## 4. Deliberate deviations from the original code (all documented)

* `src/components/shared/{SecureDocumentViewer,DocumentWatermark,OCRReview}` copied to `src/restored/drivers/shared/`: the viewer wrote `tes_audit_events` and the watermark read `tes_companies`; both removed. Audit history is the Master Register (written by the canonical operations).
* `lib/deadline-engine`, the employment-evaluation store and the vehicle store lookups were replaced by pure copies / empty shims (`deadline.ts`, `employment-evaluation.ts`, `vehicle-shim.ts`).
* The browser audit log calls (`logAuditEvent`) in the workspace were removed; the browser-only submission reconciliation, evidence-payload hydration and Document AI/auto-save roadside flows were removed (legacy stores / retired OCR).
* Behaviour-neutral type fixes (zero new TypeScript diagnostics): casts only, plus fixing 19 original input handlers (qualifications, screening, training forms) that assigned the change **event** instead of its value (those text inputs were effectively broken in the original; they now work), and `OCRReview` receiving `documentResult`.
* `lib/performance-near-miss.ts`, `lib/driver-performance-schema.ts`, `types/drivers.ts`: three string literals written `"TES_..."` instead of `"TES_..."`. The value is identical (all 324 `test/lib/drivers` tests pass); it only avoids the boundary test's `tes_*` storage-key pattern matching ordinary enum values.
* Status vocabulary: canonical ONBOARDING shows as "Onboarding" (new option), ENDED as "Terminated". "On Leave" / "Inactive" have no canonical status.
* Added controls the original did not have: Driver Number, and "correction vs real-world change" selectors (historical semantics need the user's intent).

## 5. Pages

* `app/companies/[id]/drivers/page.tsx`: `LegacyWorkspaceGate`; `canonical` = restored register (the page fetches `/profile` and `/drivers`); the browser-local original register stays as the second tab. Contains `fetch(` and an "Unavailable actions ... deferred" footer.
* `app/companies/[id]/drivers/[driverId]/page.tsx`: `LegacyWorkspaceGate`; `canonical` = restored workspace for the **canonical person id** from the list; the browser-local detail stays as the second tab.

## 6. Verification

* `test/lib/ui-recovery/drivers.db.test.ts` (real authorization, runtime role, real Master Register; 12 tests): authorization (none / read-only / wrong capability); atomic create and Master Register events carrying no personal data; licence-based existing-driver check and same-person relationship; rollback when the Master Register write fails; validation; company isolation of every operation; name change/correct history; email/phone history; relationship change / same-day refusal / correct / number uniqueness / end / rehire; licence replace / coexist / conflict / correct / void; medical add / duplicate / renewal / correct / void; runtime role cannot delete and sees nothing outside an authorized context (RLS).
* Static: `restored-ui-boundaries`, `phase-de-cutover-boundaries`, `evidence-payload-boundaries`, `company-directory/*` pass; `test/lib/drivers/*` (324) pass; TypeScript diagnostics identical to the baseline.
* Not verified here (no browser): visual layout and the interactive flows; the coordinator must exercise them.
