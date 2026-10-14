# Insurance workspace: UI recovery matrix

Original interface: `git show '0ba9436^:app/companies/[id]/insurance/page.tsx'` (1923 lines, browser-local), kept unchanged as the second tab
(`app/companies/[id]/insurance/legacy-insurance.tsx`, "browser-local, not canonical").
Restored interface: `src/restored/insurance/**`, mounted by `app/companies/[id]/insurance/page.tsx` as the `LegacyWorkspaceGate` canonical tab.
Canonical domain: `lib/insurance/*` (migrations 0017 / 0025), policies, terms, coverages, endorsements, broker periods, Master Register events.

Classification legend: READ = canonical read; CREATE; CORRECT = correction (wrong rows kept and flagged); CHANGE = real-world change (history kept);
LIFECYCLE = archive / restore; NEW-OP = approved domain, application operation implemented here; GAP-OP = approved domain, no application operation
needed/implemented; GAP-DOMAIN = no canonical domain (decision needed); the control stays and refuses honestly.

## Data model mapping

| Original record | Canonical source | Notes |
|---|---|---|
| Transportation record (`INS-*`) | one policy, family `INSURANCE`, its latest genuine term and that term's current coverages | card shows the first coverage; further coverages are listed on the card |
| Workers record (`WCB-*`) | policy, family `WORKERS_COMPENSATION`, coverage `WORKERS_COMPENSATION` (statutory, no limit) | account number = term number |
| Bond record (`BND-*`) | policy, family `BOND`, bond coverage, limit basis `PENAL_SUM`, continuous = `termEnd` null | principal = the insured company itself |
| Status Active / Expired / Archived | derived: `termStateOn(term, asOfDate)` + `policy.recordStatus`; nothing is stored | `asOfDate` is the database date returned by `GET /insurance` |
| Renewed Lineage badge (`previousRecordId`) | a policy with more than one genuine term, or `policy.renewsPolicyId` | |
| Insurer / surety / provider name | `policy.insurerOrganizationId` -> `GET /api/companies` directory | |
| Broker (org, agent, phone, email) | current broker period (`brokerOrganizationId`, `brokerPersonId`); agent name / phone / email from that brokerage's Contacts (`GET /api/companies/[brokerageId]/contacts`) | |
| Summary cards | computed from the same records and the canonical as-of date (`selectors.ts`, `deadline.ts`) | Total Liability = Canadian-dollar AUTO_LIABILITY + GENERAL_LIABILITY limits in force today (other currencies listed beside it) |
| 30-day expiry warning | `deadlineDate` (= cancellation date, else term end) vs as-of date | continuous bond = "No Deadline" |

Fields with no canonical home and how they behave: notes, certificate (COI) group, evidence link, WCB jurisdiction, archive reason *on the record*.
They are never invented and never silently dropped (see rows below).

## Component matrix

| Original component / file | Current (canonical page before recovery) | Recovered implementation | Restored controls | Canonical operations connected | Missing (exact gap) | Verified by |
|---|---|---|---|---|---|---|
| `page.tsx` shell (header, banners, tabs, state) | `app/.../insurance/page.tsx`: list + one-coverage add form + renew/cancel `details` | `src/restored/insurance/RestoredInsurance.tsx` over `adapter.ts` (hook `useCanonicalInsurance`, no browser storage); page keeps `fetch(` for the company lookup and the "deferred" Unavailable-actions footer | header actions (Document / OCR, Add Transportation Policy, WCB, Bond), error and notice banners, load-failure and directory-failure banners | READ `GET /insurance` (+ `asOf`), `GET /api/companies`, `GET /api/companies/[brokerage]/contacts` | none | `restored-ui-boundaries`, `phase-de-cutover-boundaries` static tests; tsc gate |
| `InsuranceSummary` (6 cards) | absent | original component reused unchanged, fed by `getInsuranceSummaryMetrics(model)` | Active, Healthy, Watch, Urgent, Critical/Expired ("Breach Risk"), Total Liability | READ | Total Liability shows CAD only; other currencies in a note | tsc; selector logic is pure |
| `InsuranceNavigation` (tabs, search, show historical) | absent | original component reused unchanged | Transportation / Workers Comp-WCB / Surety Bonds / All Records, search, "Show Historical / Archived" | READ (client-side filtering) | none | tsc |
| `TransportationPoliciesSection` | policy list rows | `TransportationPoliciesSection.tsx` (copy) | cards, status/deadline badge with days, "Expiry Approaching" (<=30d), Renewed Lineage badge, coverage list, broker box + Edit Broker, Edit, Renew Policy, Archive, Restore, evidence row | see form rows | COI Group badge cannot appear (no certificate group home) | tsc |
| `TransportationPolicyForm` (create) | add form, one coverage | `TransportationPolicyForm.tsx` (copy, same fields) | coverage type (+ Reefer Breakdown), policy no., insurer (name), limit, effective, expiry, broker firm / agent / phone / email, notes | CREATE `POST /insurance` -> `createPolicy` (+ first broker period) | notes: GAP-DOMAIN, non-empty notes are refused (`CanonicalOperationUnavailableError`) with an inline note; "Trailer Interchange" has no canonical coverage type: GAP-DOMAIN, refused | `insurance.db.test.ts` (workers/bond creation, broker start) |
| `TransportationPolicyForm` (edit) | none (no edit) | same form + "what kind of change" choice | CORRECT = `correctCoverage` / `correctTerm` / `correctBroker`; CHANGE = `addEndorsement` (COVERAGE_CHANGED) / `changeBroker` | NEW-OP `PATCH action:"edit"` -> `lib/insurance-workspace/edit-policy.ts` (one transaction composing the existing operations; company-scoped) | changing the insurer of a recorded policy: GAP-OP (no correction operation; refused, use Renew); endorsement cannot change number/dates/type (refused); only the first coverage of a multi-coverage policy is edited here; `correctEndorsement` and endorse-add/remove of other coverages have no control | `insurance.db.test.ts`: CORRECTION, ENDORSEMENT, rollback, isolation |
| Renew (`isRenewalMode`) | renew `details` form | same form, renewal mode | previous end as default start, number, dates, limit, broker | `PATCH action:"renew"` -> `renewPolicy` (new TERM of the same policy); a different insurer -> `POST` with `renewsPolicyId` (NEW policy that renews the old one). Broker change after renew = second `edit` call | the broker change after a same-insurer renewal is a second request (not atomic with the renewal); a notice reports a failure of the second step | `insurance.db.test.ts` (existing renew suites); matrix of actions in `adapter.ts` |
| `BrokerUpdateDialog` | none | `BrokerUpdateDialog.tsx` (copy) | brokerage firm, agent name / phone / email, "apply to COI group" (disabled, with note), new checkbox "recorded broker was a mistake" | `PATCH action:"edit" { broker }` -> `changeBroker` (real change, previous period kept) or `correctBroker` (mistake, wrong period flagged) | certificate group cascade: GAP-DOMAIN (applies to this policy only); a typed phone/email for an existing contact is not added to it (Contacts owns channels) and a notice says so; removing a broker has no operation (refused) | `insurance.db.test.ts` broker test |
| `OrganizationResolutionDialog` | none (id picker from directory) | `OrganizationResolutionDialog.tsx` (copy; the original's Cancel never called `onCancel`, fixed) | Case A exact name -> reuse; Case B similar (>= 0.75) -> operator chooses or creates; Case C no match -> explicit "Create New Organization" confirmation | READ `GET /api/companies` for matches; create through the existing company creation operation `POST /api/companies` ({ companyName, companyType }) | creation needs the company-creation capability; if refused the message is shown and nothing is saved. A "Surety Company" is created as record type "Other" (no surety type exists). A policy save that fails after a new organization / contact was created leaves that organization / contact (no physical delete; it is visible in the directory) | static tests; behaviour reviewed in code |
| Broker agent resolution (`resolveBrokerContact`) | none | `resolveBrokerAgent` in `adapter.ts` | match by email, phone, then name among the brokerage's own contacts; otherwise create | existing Contacts `createContact` via `POST /api/companies/[brokerage]/contacts` (person + active relationship) | an agent matched only at another organization is not linked (a new person is created for this brokerage) | `insurance.db.test.ts` (contact must belong to the brokerage) |
| `WorkersCompSection` / `WorkersCompForm` | list | copies; `Renew` added (needed to record a new period; original had none) | jurisdiction select (default "Not recorded"), provider, account no., dates, notes, edit, archive, restore | CREATE `createPolicy` family WORKERS_COMPENSATION; edit = CORRECT `correctTerm`; renew = `renewPolicy` / renewing policy | jurisdiction: GAP-DOMAIN, picking one is refused; notes refused; changing the provider: GAP-OP, refused | `insurance.db.test.ts` WCB/bond test |
| `SuretyBondsSection` / `SuretyBondForm` | list | copies; `Renew` added | bond type (BMC-84 / Customs / Performance), surety, number, amount, effective, optional expiry (continuous) | CREATE `createPolicy` family BOND (PENAL_SUM, USD); edit = CORRECT `correctCoverage` + `correctTerm`; renew | changing the surety: GAP-OP, refused; renewing a continuous bond needs it cancelled first (domain rule, message shown); bond cancellation control not part of the original | `insurance.db.test.ts` WCB/bond test |
| `InsuranceArchiveDialog` | Archive button, no reason | original dialog reused unchanged (reason mandatory) | reason textarea, Archive Record | LIFECYCLE `archivePolicy` with `reason`, stored in the Master Register archive event (`outcome.reason`) in the same transaction | the reason is not shown on the card (the Master Register has no read route in the UI); the card says it is kept in the audit trail. This reuses an existing event field; flagged for review as a decision | `insurance.db.test.ts` archive test (event reason, 501-char refusal, wrong company) |
| Restore | Restore button | card Restore | | LIFECYCLE `restorePolicy` | none | `insurance.db.test.ts` archive test |
| `InsuranceDocumentIntake` (source picker, camera) | none | original component reused; "Document / OCR" header button opens it | picker + camera stay | none: a chosen file is not read or uploaded; an inline unavailable note and the page footer say so | legacy OCR is retired (endpoints answer 503, not re-enabled); no approved extraction operation: GAP-DOMAIN | static boundary tests (no upload code) |
| `InsuranceOCRWorkspace` (review split screen) | none | not rendered | none | none | needs an extraction draft; there is no approved extraction. Not recoverable without a decision | n/a |
| `InsuranceEvidenceViewer` / evidence row | none | `EvidenceNote.tsx`: "Evidence: not recorded" + Attach Evidence on every card | attach control stays visible, shows the exact gap | none | a policy has no canonical link to an uploaded document (the evidence lifecycle stores company documents, not policy attachments): GAP-DOMAIN. The original viewer used `SecureDocumentViewer`, which imports the legacy audit log (forbidden), so it is not carried over | static boundary tests (evidence ratchet untouched) |
| `insurance-selectors.ts` | n/a | `selectors.ts` (copy; imports no deadline engine) | | | | tsc |
| `insurance-domain.ts` | n/a | reused for types and shared contracts only | | | | tsc |

## Operations routed / added

| Operation | Route | Scope guard | Change |
|---|---|---|---|
| `getOrganizationInsurance` | `GET /api/companies/[id]/insurance?asOf=YYYY-MM-DD` | company from URL | `asOf` now accepted (validated by the operation) |
| `createPolicy` | `POST /api/companies/[id]/insurance` | body `organizationId` overwritten by the URL | none (now also used with `renewsPolicyId` and `broker`) |
| `renewPolicy`, `cancelTerm`, `archivePolicy`, `restorePolicy` | `PATCH .../[policyId]` | `assertScopedOrganization` | `archivePolicy` takes an optional `reason`, kept in the archive event |
| `correctTerm`, `correctCoverage`, `addEndorsement`, `changeBroker`, `correctBroker` | `PATCH .../[policyId] { action:"edit" }` (composed) | **added** `organizationId` + `assertScopedOrganization` to each (`lib/insurance/operations.ts`) | company scope guard added to the six operations that lacked it (these five plus `correctEndorsement`) |
| `editPolicyRecord` (new composed operation) | `PATCH .../[policyId] { action:"edit" }` | explicit owner check, then each operation re-checks | new files `lib/insurance-workspace/edit-policy.ts` (operation) and `lib/insurance-workspace/service.ts` (INSURANCE_MANAGE entry point) |
| Not routed (no control in this workspace) | `correctEndorsement` (guard added, no route), `scheduleVehicle`, `removeScheduledVehicle`, `changeSchedule`, `correctSchedule`, `checkPolicyNumber`, `getCoverageSchedule`, `getVehicleInsurance` | n/a | scheduled-vehicle management belongs to the Vehicles workspace; a policy-number collision is already reported by `createPolicy` / `renewPolicy` |

Why the composed operation is not in `lib/insurance/`: `test/lib/insurance/insurance-boundaries.test.ts` pins `lib/insurance/service.ts` to exactly the designed operation
list and forbids any other file in that folder from reaching the authorization wrappers. Following the pattern (a new file beside the domain, an
`INSURANCE_MANAGE` wrapper) therefore means a sibling folder; the approved test is untouched and green.

## Not done / needs a decision

- OCR review workspace and extraction: not rendered (no approved extraction path; legacy OCR stays retired).
- Evidence attach / preview for policies: needs a domain link between a policy and an evidence document.
- Policy notes, certificate (COI) groups, WCB jurisdiction: need a canonical home (migration or an agreed existing field).
- Archive reason on the record: kept in the Master Register event only; display needs an events read route or a column.
- "Trailer Interchange / Non-Owned" coverage: no canonical coverage type (a migration to the catalogue would add one).
- Changing the insurer of a recorded policy and removing a broker: no operation; both refuse with an explanation.
- Edit of coverages other than the first of a multi-coverage policy; adding / removing a coverage (endorsement kinds COVERAGE_ADDED / COVERAGE_REMOVED): operations exist, no original control.

## Verification

- Static: `restored-ui-boundaries`, `phase-de-cutover-boundaries`, `evidence-payload-boundaries`, `test/lib/company-directory/*`, `test/lib/insurance/*` (the boundary suite includes "the service exposes exactly the designed operations").
- DB (`TES_TEST_FILES=test/lib/ui-recovery/insurance.db.test.ts`): isolation (every edit / correction operation refuses another company and changes nothing), CORRECTION keeps and flags wrong rows with events, ENDORSEMENT and broker change keep history, rollback of a composed edit, archive reason in the Master Register event, WCB / continuous bond, authorization (INSURANCE_MANAGE required).
- Browser verification is left to the coordinator (no dev server was started).
