# TES — System Integrity, Discrepancy, Leakage, Completion & UI/UX Audit

- **Audit date:** 2026-10-03
- **Repository state audited:** branch `main`, HEAD `4b1b804`, clean working tree at audit start.
- **Method:** static code reading plus `tsc --noEmit --incremental false` and targeted searches. No production source file, config or lockfile was modified. This document is the only file created.
- **Evidence convention:** `file:line` or `file → function`. Secret values were never read into this document (environment variable **names** only).
- **Confidence labels:** CONFIRMED (the code path was read end to end), HIGH (code read, runtime not exercised), MEDIUM (inference from code plus a known deployment fact), LOW / NEEDS VERIFICATION.

---

## Executive Summary

TES is, today, a **single-browser prototype with a thin server shell**, and several surfaces present it as more than that.

- **No authentication or authorization exists anywhere** (`lib/current-user.ts` returns a hardcoded "System Administrator"; there is no `middleware.ts`; none of the 5 API routes checks a caller). Company isolation is therefore not a boundary at all: it is a `localStorage` key prefix and a URL parameter.
- **All business records live in browser `localStorage` / IndexedDB.** The only server-side persistence is a JSON file under `.tes-data/` (applicant submissions), which is unlikely to survive a serverless deployment.
- **Fabricated data reaches canonical-looking records.** Three "OCR" paths (insurance, citations, contacts) are simulations that return hardcoded people, insurers, policy numbers and dates, and the dashboard shows invented KPIs.
- **A shared `DriverMaster` is silently overwritten** by any company, with no history and no actor. The invitation flow does this *before* the email is sent.
- **Several workflow states exist in the type system but are never written** (`Started`, `In Progress`, `Expired`, `Invitation Cancelled`), so the application lifecycle the UI implies does not exist.
- **The safety nets are off:** `ignoreBuildErrors: true` hides 139 type diagnostics (including at least one genuine runtime `ReferenceError`), and the app has no error boundary at all.

Several things are built well and are called out so they are not "fixed" by accident: the Google WIF auth path, the create-only quarantine intake, HMAC verification with `timingSafeEqual`, immutable submission semantics, and the `Invitation Ready → Invited` rule that waits for the provider to accept.

**Counts: P0 = 4, P1 = 10, P2 = 15, P3 = 9 (38 findings).** Fixation plan: see the final section (segments are small, ordered, and mark which can run in parallel).

---

## Repository Areas Inspected

| Area | Depth |
|---|---|
| `app/api/**` (all 5 routes) | Full read |
| `lib/driver-invitation-token.ts`, `lib/server/driver-application-submission-repository.ts`, `lib/google/{auth,config,storage}.ts` | Full read |
| `app/driver-application/**` (entry page, store, workspace key sections) | Entry page + store full; workspace targeted |
| `lib/driver-data.ts` (stores, createDriver, profile/licence/address mutations, application, evidence, performance event write path) | Targeted, ~60% |
| `app/companies/[id]/drivers/**`, `src/components/drivers/DriverWorkspace.tsx` (invitation + evidence handlers), `DriverProfileTab.tsx` | Targeted |
| `lib/audit-log.ts`, `audit-logger.ts`, `activity-log.ts`, `audit.ts`, `audit-log-auth.ts`, `current-user.ts` | Full read of heads and write paths |
| `lib/auto-save-roadside.ts`, `lib/ingestion-entity-resolver.ts` | Targeted |
| Insurance, citations, contacts "OCR" paths; vehicles seed/draft functions; `app/page.tsx`, `/drivers`, `/customers`, `/companies` lists | Targeted |
| Storage-key inventory across `app lib src components` | Grep-complete |
| `tsc` full-project diagnostics, `.gitignore`, tracked-file hygiene, `next.config.mjs` | Complete |
| `services/document-security-scanner`, `lib/master-register`, `lib/ingestion` | Wiring/callers only (internals were audited in earlier sessions) |

## Areas Not Fully Verifiable

- **Live runtime behavior was not exercised in this audit.** Findings marked HIGH rest on code and `tsc`, not on a browser run (notably F-014 and F-020).
- **Deployed environment** (Vercel filesystem semantics, env vars actually set, Vercel Analytics query-string handling, Eventarc→scanner wiring in production). F-010 is MEDIUM for this reason.
- **Vehicles, Tax Filing, Authorities, Insurance, Citations, Repair, Maintenance, Business/Corporate Documents:** only sampled (storage keys, OCR/simulation paths, date patterns). Their internal state machines, evidence linkage, and calculation correctness were **not** audited line by line. Each deserves its own pass.
- **Responsive / wide-monitor / mobile behavior:** not tested. Only code-level counts were taken (modal implementations).
- **Audit Preparedness engine (1,889 lines), driver performance model, deadline engine:** correctness of derived statuses and scores not verified.
- **Document AI processor configuration and quota/cost exposure:** not inspected (needs GCP console access, which is out of bounds).
- **Whether `.tes-data/driver-application-submissions.json` (6 stored submissions locally) contains real personal data:** content deliberately not read.

---

## P0 Findings

### F-001 — Unauthenticated invitation endpoint is an open email relay from the TES sender domain
- **Category:** Security / access control. **Severity:** P0. **Confidence:** CONFIRMED.
- **Workflow / files / function:** Driver Application invitation. `app/api/driver-applications/send-invitation/route.ts → POST`.
- **Observed:** The route requires only that `RESEND_API_KEY` exists. It accepts caller-supplied `companyName`, `driverName`, `recipientEmail`, `companyAddress/Phone/Email` and sends an HTML email from `TES <applications@truckease.co>` containing a validly signed link. There is no caller check, no rate limit, and no check that `companyId`/`driverMasterId`/`applicationId` correspond to anything.
- **Expected / inferred:** Only an authenticated TES user acting for a real company may send an invitation, and company identity should come from a server-side record, not the request body. The route's own comments elsewhere ("not generally client-accessible until a real authorization gate exists") acknowledge this for another route.
- **Evidence:** Route reads `body` and validates only non-empty strings and an email regex. HTML escaping (`esc`) is correct, so this is not injection. The abuse is **authentic-looking mail with attacker-chosen company name and recipient**, signed and sent by TES's verified domain.
- **Why it matters:** Phishing and brand abuse from `truckease.co`; Resend quota/reputation damage; a validly signed token can be minted for any `applicationId` string (see F-005, F-023).
- **Potential impact:** Domain reputation loss, spam blocklisting, fraudulent "TES driver application" lures harvesting licence/SIN-class data.
- **Also:** The `catch` returns `error.message` to the client (e.g. "TES invitation signing secret is not configured."), and Resend's error text is passed through verbatim.
- **Dependencies:** D-01 (authentication approach). Interim hardening possible without it (SEG03).
- **Recommended repair boundary:** One server-side caller gate (`requireCaller()`) shared by all routes (SEG05), plus per-route input caps and sanitized errors (SEG03).
- **Verification after repair:** Unauthenticated POST returns 401/403 and sends nothing; error bodies contain no internal messages; sending for an `applicationId` unknown to the caller's company fails.

### F-002 — No authentication or authorization anywhere; tenant isolation is client-side convention only
- **Category:** Tenant isolation / access control. **Severity:** P0. **Confidence:** CONFIRMED (architecture). Individual exploit paths below are CONFIRMED by code; actual attacker model depends on deployment.
- **Workflow / files:** Entire portal. `lib/current-user.ts → getCurrentUser()` (hardcoded `USR-SYSADMIN`, role `SYSTEM_ADMIN`); no `middleware.ts`; all `app/companies/[id]/**` pages; `lib/driver-data.ts`; `lib/audit-log-auth.ts`.
- **Observed:**
  - Every company route reads whatever `companyId` is in the URL and loads `tes_company_*_{companyId}` from `localStorage`. There is no ownership check because there is no owner.
  - `DriverMaster` PII (DOB, licence history, address history, email, phone) is one global store (`tes_driver_masters_v1`) readable and writable from any company page.
  - The global contacts store (`tes_contacts_v5`) is filtered by `relationships.companyId` **in the browser** (`app/companies/[id]/contacts/page.tsx`), so every company page holds every company's contacts in memory.
  - The "Audit Log" admin PIN (`lib/audit-log-auth.ts`) stores a SHA-256 hash and lockout state in browser storage and gates a UI section; it is not a server control and can be cleared or bypassed through DevTools.
  - Component-level admin labelling is cosmetic (`components/app-sidebar.tsx` footer "System Admin").
- **Expected / inferred:** Multi-company TES (per the audit brief and per `types/drivers.ts` where `CompanyDriverRelationship` is the per-company boundary) needs a server-enforced identity and company membership.
- **Evidence:** `getCurrentUser()` body; absence of `middleware.ts`; grep of storage keys (42 uses of `tes_companies`, global `tes_driver_masters_v1`, `tes_contacts_v5`).
- **Why it matters:** The system cannot, today, honestly claim company isolation, evidence privacy or access auditing. Today it is "safe" only because it is single-user in one browser.
- **Potential impact:** Any user of the app sees and edits every company's data; once deployed publicly with real data, every API in F-001/F-004/F-005 is also open.
- **Dependencies:** D-01, D-04 (system of record). Many downstream findings (F-001, F-004, F-005, F-013, F-027) are blocked on this.
- **Recommended repair boundary:** Decision first (D-01). Do **not** attempt a piecemeal "company check" in individual pages; one server-side identity + membership layer, then route-by-route adoption.
- **Verification after repair:** Cross-company URL/ID manipulation returns 403 server-side; `DriverMaster` reads for a driver with no relationship to the caller's company are denied.

### F-003 — Company records are hard-deleted from the main Companies list with no cascade and no archival
- **Category:** Data destruction / orphaning. **Severity:** P0. **Confidence:** CONFIRMED.
- **Workflow / files / function:** Company management. `app/companies/page.tsx → handleDelete`; `app/customers/page.tsx → handleDelete` (labelled "DEV MODE" in its confirm text, but unconditional).
- **Observed:** `handleDelete` filters the company out of `tes_companies` and `tes_customers` after a native `confirm()`. Nothing else is touched.
- **Expected / inferred:** The repo's own rule (`lib/audit.ts → devOnlyHardDelete`: "Use archiveRecord instead") and every domain store (`archive.isArchived`) say records are archived, not deleted.
- **Evidence:** The two handlers; no reference to `tes_company_drivers_{id}`, `tes_company_vehicles_{id}`, authorities, tax, insurance, citations, activity or IndexedDB evidence.
- **Why it matters:** The company vanishes from the UI, but its driver relationships, vehicles, evidence payloads and audit entries remain, now unreachable and counted nowhere. `DriverMaster`s keep relationships to a company that no longer exists.
- **Potential impact:** Unrecoverable loss of the company-level view, orphaned compliance history, silent change in system-wide results (e.g. Existing-Driver affiliations skip a deleted company).
- **Dependencies:** D-02 (archive semantics for a company: status vs flag).
- **Recommended repair boundary:** Replace delete with archive on both pages; do not add cascading deletion.
- **Verification after repair:** An archived company disappears from default lists, is restorable, and its stores are untouched.

### F-004 — Document and OCR endpoints are unauthenticated; `document-ai` has no size/type limits; intake accepts any `companyId`
- **Category:** Security / abuse / cost. **Severity:** P0. **Confidence:** CONFIRMED.
- **Workflow / files:** `app/api/document-ai/route.ts → POST`, `app/api/business-document-ocr/route.ts → POST`, `app/api/document-intake/route.ts → POST`.
- **Observed:**
  - `document-ai`: accepts any `File`, no size cap, no MIME allowlist (only `file.type || "application/pdf"`), loads any bytes with `PDFDocument.load` when the type or name looks like PDF, and fans out chunked paid Document AI calls.
  - `business-document-ocr`: type allowlist and 20 MB cap, but unauthenticated and paid.
  - `document-intake`: good validation (size, MIME, magic bytes, path-safe ids, quarantine-only create-only write) but the caller-supplied `companyId` is "accepted as-is" (stated in the route's own SECURITY BOUNDARY comment), so any caller can write into any company's quarantine namespace.
- **Expected / inferred:** The same limits that `document-intake` enforces should exist on every ingestion route, and `companyId` should come from the authenticated membership.
- **Evidence:** Route source; `MAX_INTAKE_FILE_BYTES` and `SUPPORTED_MIME_TYPES` exist only in `document-intake`.
- **Why it matters:** Unbounded cost and abuse (a large multi-hundred-page PDF drives hundreds of Document AI calls); quarantine pollution under another company's prefix.
- **Potential impact:** Cloud spend, quota exhaustion for legitimate OCR, malicious uploads reaching a paid third-party processor unscanned.
- **Dependencies:** D-01 for the auth half; the limits half is independent (SEG04).
- **Recommended repair boundary:** SEG04 (limits), SEG05 (gate).
- **Verification after repair:** Oversize or disallowed uploads return 413/400 before any Google call; unauthenticated calls are rejected.

---

## P1 Findings

### F-005 — Submissions API: unauthenticated read and write, and the write does not verify the invitation token
- **Category:** Security / evidence integrity. **Severity:** P1. **Confidence:** CONFIRMED (code). Exploitability: LIKELY LOW-MEDIUM, because it requires a valid `applicationId` (a UUID-based `APP-<uuid>`).
- **Workflow / files / function:** Driver Application submission. `app/api/driver-applications/submissions/route.ts → POST, GET`; `lib/server/driver-application-submission-repository.ts`.
- **Observed:**
  - `POST` accepts any JSON with `applicationId, submittedAt, receiptId, completedSteps, draft`. It never verifies the invitation token or its expiry, so an expired or revoked invitation can still submit, and anyone who learns an `applicationId` can pre-submit (squat) it. Because the store is immutable per `applicationId`, the real applicant then gets a permanent 409 (see F-015).
  - `GET ?applicationIds=a,b,…` returns the full submitted draft (personal data, licence, employment history, criminal/medical disclosures, signed authorizations) for up to 50 ids with no caller check.
- **Expected / inferred:** The submitter proves possession of the invitation (token bound to that `applicationId`); readers must be an authenticated TES user of the owning company.
- **Evidence:** Route code; `verifyDriverInvitationToken` is called only by `app/driver-application/page.tsx`.
- **Why it matters:** The immutable submission is the evidentiary record of an application. Anyone can create or read it.
- **Potential impact:** PII disclosure; denial of the real applicant's submission; contaminated hiring file.
- **Dependencies:** SEG01 (token binding for POST) is independent of D-01. Locking GET needs D-01.
- **Recommended repair boundary:** POST: verify token (HMAC, expiry, `applicationId` match). GET: after D-01.
- **Verification after repair:** POST with a wrong or expired token returns 401; a POST for a different `applicationId` than the token's returns 403.

### F-006 — Shared `DriverMaster` is overwritten with no history, actor or company attribution (and the invitation flow does it *before* sending)
- **Category:** Data integrity / cross-company mutation. **Severity:** P1. **Confidence:** CONFIRMED.
- **Workflow / files / function:** Driver identity maintenance. `lib/driver-data.ts → updateDriverMasterIdentity`, `updateDriverProfileAtomic`, `auditDriverMutation`; `src/components/drivers/DriverWorkspace.tsx → handleCreateApplication`.
- **Observed:**
  - `updateDriverMasterIdentity(driverId, patch)` has no `companyId` parameter, no effective-dating and no history. It replaces name/DOB/email in place. Its audit call passes `companyId: ""`.
  - `auditDriverMutation` hardcodes `actor: ""` and `role: ""`.
  - `updateDriverProfileAtomic` also overwrites identity in place, while the same function **does** effective-date the address. Identity and address are therefore governed by different rules in one function.
  - In `handleCreateApplication`, `updateDriverMasterIdentity(master.id, { email: recipientEmail })` runs *before* the `fetch` to `send-invitation`. If the send then fails, the global email has already changed.
- **Expected / inferred:** Per TES's "mutable historical records" concern: a change to shared identity must preserve the previous value, say who changed it and for which company, and must not occur as a side effect of an operation that may fail.
- **Evidence:** Function bodies above; call ordering in the handler.
- **Why it matters:** `DriverMaster.email`/`phone` are exactly the match keys of the new Existing-Driver check. Company A can change the email that Company B uses and relies on, with no trace of who did it or what it was.
- **Potential impact:** Wrong-person matching, lost prior values, no accountability for identity edits across tenants.
- **Dependencies:** D-03 (policy: who may change shared identity, and whether it needs the other companies' awareness).
- **Recommended repair boundary:** SEG11 (move the email write to after provider acceptance and do not overwrite a non-empty value silently), then SEG12 (history + attribution) after D-03.
- **Verification after repair:** A failed send leaves `master.identity.email` unchanged; any identity change produces a record with old/new value, actor and company.

### F-007 — "OCR" in three modules is a simulation that produces fabricated, plausible facts
- **Category:** False canonical data. **Severity:** P1. **Confidence:** CONFIRMED.
- **Workflow / files / function:**
  - Insurance: `app/companies/[id]/insurance/page.tsx → handleStartOCRWorkflow` (lines ~1359–1384) and `handleCommitOCR`.
  - Citations: `app/companies/[id]/citations/page.tsx → handleFileUpload` (lines ~818–830).
  - Contacts: `src/components/contacts/contact-helpers.ts → simulateOCRExtraction` (lines ~187–217), used at `app/companies/[id]/contacts/page.tsx:580`.
- **Observed:**
  - Insurance: after `setTimeout(…, 900)` pre-fills insurer "Northbridge General Insurance Corporation", a random `NBC-######` policy number, broker "Sarah Jenkins", $2,000,000 limits, `effectiveDate = today`, `expiryDate = today + 365 days`, `confidence: 0.92`, attached to the user's real uploaded file. `handleCommitOCR` uses `formData.get(x) || ocrDraft.x`, so **a field the user clears is silently restored to the fabricated value**. Commit also creates canonical insurer and broker organisations/contacts in the shared contacts store.
  - Citations: sets `reportNumber = INSP-<random>`, `officerName = "Officer J. Miller"`, `officerBadge = "Badge #4928"`.
  - Contacts: always returns the same person (Amandeep Dhillon, DOB 1988-04-12, a licence number, class "A / AZ"), and marks the evidence `status: "verified"` with confidence 93 for files over 20 KB.
- **Expected / inferred:** A feature labelled OCR/extraction must either extract or say it did not; unknown must remain unknown.
- **Evidence:** Source above; the real Document AI route exists (`/api/document-ai`) but is only wired to roadside inspections.
- **Why it matters:** These records feed audit readiness. A fabricated policy period or "verified" evidence status is a false compliance fact with provenance pointing at a real document.
- **Potential impact:** False "insured" status, fake organisations in the shared directory, an audit trail that asserts verification that never happened.
- **Dependencies:** None. D-08 (what the manual-entry replacement should look like) is trivial.
- **Recommended repair boundary:** One module per segment (SEG07, SEG08, SEG09): remove fabricated values and present an empty draft requiring manual entry or an explicit "OCR not available" state.
- **Verification after repair:** Uploading a file produces an empty draft; no organisation/contact is created until the user enters values; evidence status is not `verified`.

### F-008 — Dashboard and `/drivers` display invented metrics
- **Category:** Misleading business meaning. **Severity:** P1. **Confidence:** CONFIRMED.
- **Workflow / files:** `app/page.tsx` (StatCards "Compliance score 96%", "Active vehicles 128 of 134", "Open filings 4", "Items expiring 12"); `components/discovery-feed.tsx` ("Driver: David Smith", "Unit 104", "Fleet Readiness: 94%"); `app/drivers/page.tsx` ("Medical expiring: 1"); `lib/data.ts` (all arrays empty).
- **Observed:** Literal strings, not derived from any store. The backing arrays in `lib/data.ts` are empty, so the table sections are empty while the KPI cards claim fleet-level results.
- **Expected / inferred:** KPIs must be derived from records or shown as not available.
- **Evidence:** Source; `lib/data.ts` `= []`.
- **Why it matters:** The landing page asserts compliance health that no record supports. Also `app/drivers/page.tsx` is an unreachable-in-practice global page (the real list is `/companies/[id]/drivers`) whose "Add driver" button does nothing.
- **Potential impact:** Users and stakeholders relying on a fictitious score.
- **Dependencies:** None (SEG10).
- **Recommended repair boundary:** Replace with empty/"not yet calculated" states; do not invent replacement calculations here.
- **Verification after repair:** No hardcoded numeric KPI remains on `/`, `/drivers`.

### F-009 — Applicant identity and document uploads are never transmitted, yet the UI treats them as provided
- **Category:** Evidence gap / false completion. **Severity:** P1. **Confidence:** CONFIRMED.
- **Workflow / files / function:** `app/driver-application/DriverApplicationWorkspace.tsx → fileSelection, identityReady`; `applicant-application-store.ts → ApplicantFileSelection`.
- **Observed:** `fileSelection(file)` stores only `{name, type, size}`. The store header says "File bytes are NOT persisted here." `identityReady` is true when three such metadata objects exist. The entry page lists these documents as "required … before your application can be submitted."
- **Expected / inferred:** A document required for submission must reach durable evidence storage, or the UI must not call it provided.
- **Evidence:** Source; `ApplicantSubmittedSnapshot.draft.identity` contains metadata only; the Phase B quarantine route (`/api/document-intake`) has no caller.
- **Why it matters:** TES staff receive a "Submitted" application whose licence photo and abstract do not exist anywhere.
- **Potential impact:** False file completeness; hiring decisions on records with no evidence.
- **Dependencies:** D-05 (how the unauthenticated applicant uploads: token-gated quarantine intake is the natural fit given Phase B).
- **Recommended repair boundary:** Interim honesty segment (SEG15); the real fix is SEG19 (wiring).
- **Verification after repair:** Submission cannot complete with a required document that has no stored object, or the UI says plainly that files are not yet uploaded.

### F-010 — Applicant submissions are persisted to a local JSON file; failures are masked
- **Category:** Persistence / production readiness. **Severity:** P1. **Confidence:** CONFIRMED (code); production impact MEDIUM.
- **Workflow / files / function:** `lib/server/driver-application-submission-repository.ts → readDatabase, writeDatabase, saveApplicantSubmission`; `submissions/route.ts`.
- **Observed:**
  - Writes `process.cwd()/.tes-data/driver-application-submissions.json`. On a read-only or ephemeral serverless filesystem, `mkdir`/`writeFile` fails or the file is lost between invocations (MEDIUM: depends on the deployment target, which the project has been deploying to Vercel).
  - `readDatabase` swallows every error and returns an empty database, so an unreadable file is indistinguishable from "no submissions" (`GET` → `{ submissions: [] }` with 200).
  - `POST`'s `catch` maps **all** errors, including filesystem errors, to HTTP 409 with the error message.
  - The read-modify-write is not serialized and uses a single fixed `.tmp` filename, so two concurrent submissions can lose one.
- **Expected / inferred:** Submission is the "shared boundary" the store comment says replaces browser-only storage. It needs durable storage or an honest failure.
- **Evidence:** Repository code; stated limitation in the store header comment ("Production must replace the development repository").
- **Why it matters:** A submitted application can be reported to the applicant as saved (browser copy) while TES never receives it, or can be lost.
- **Potential impact:** Lost applications; staff see "Invited" forever.
- **Dependencies:** D-04 (system of record, i.e. the Phase C0 decision). Interim error-semantics fix is independent (SEG13).
- **Recommended repair boundary:** SEG13 interim; replace the store after D-04.
- **Verification after repair:** Filesystem failure returns 5xx, `GET` read failure returns 5xx, concurrent submissions both persist.

### F-011 — The Driver Application lifecycle in the type system does not exist in the code
- **Category:** Workflow / state machine. **Severity:** P1. **Confidence:** CONFIRMED.
- **Workflow / files:** `types/drivers.ts → DriverApplicationStatus`; writers: `DriverWorkspace.tsx → handleCreateApplication`, `lib/driver-data.ts → ingestApplicantSubmissionSnapshot / reconcileApplicantSubmissionHandoffs`.
- **Observed:** The enum has `Started`, `In Progress`, `Expired`, `Invitation Cancelled` (and `Withdrawn`/`Under Review` etc.). A repo-wide search finds **no writer** for `Started`, `In Progress`, `Expired`, `Invitation Cancelled`. `invitationExpiresAt` is stored but nothing compares it to the clock. The only inbound signal from the applicant is the final submission.
- **Expected / inferred:** The brief's chain: record created ≠ invitation ready ≠ sent ≠ opened ≠ started ≠ submitted ≠ reviewed. Today TES distinguishes only `Invitation Ready` → `Invited` (provider accepted) → `Submitted`.
- **Evidence:** Searches for the literals; `Invited` is set only from the Resend `messageId`.
- **Why it matters:** An invitation that expired after 7 days still reads `Invited`. "Invited" means "Resend accepted the request", not delivered or opened, but is shown as the settled state.
- **Potential impact:** Staff chase applicants who cannot enter; stale applications appear live; no basis for reminders.
- **Dependencies:** None for a *derived* expiry display (SEG16). Opened/Started signals need a server write path (D-04).
- **Recommended repair boundary:** Derive "Expired" at read time from `invitationExpiresAt`; do **not** store a derived status; make the labels honest ("Invitation accepted by email provider").
- **Verification after repair:** An application whose `invitationExpiresAt` is in the past displays as expired without any store write.

### F-012 — Evidence is browser-only; the quarantined-intake pipeline has no caller; evidence metadata is written before its payload
- **Category:** Evidence / provenance / persistence. **Severity:** P1. **Confidence:** CONFIRMED.
- **Workflow / files / function:**
  - `src/components/drivers/DriverWorkspace.tsx → handleSelectFile` (lines ~709–745): `addDriverEvidence(...dataUrl: "")` then `putEvidencePayload(...)`.
  - `lib/evidence-payload-store.ts` (IndexedDB `tes_evidence_payloads`), `lib/evidence-file-store.ts` (IndexedDB `tes-evidence-files`, used by vehicles), `src/components/contacts/evidence-storage.ts` (IndexedDB `tes_evidence_store`).
  - `lib/driver-data.ts → addDriverEvidence`.
- **Observed:**
  - Three separate IndexedDB evidence mechanisms plus legacy inline base64 in `localStorage`. None is shared and none leaves the browser.
  - Metadata is saved first, payload second. If the payload write fails (quota, private mode), a canonical evidence record exists with no file; the UI later says "present, but its document payload is unavailable".
  - `/api/document-intake` (the scanned, create-only quarantine path) has **zero callers**. The unscanned file is sent straight to `/api/document-ai`.
  - `business-document-ocr` tells the user "The evidence is saved and can still be reviewed manually" while "saved" means browser storage on one machine.
- **Expected / inferred:** "Permanent evidence" implies durable, access-controlled, scanned storage; the Master Register work and Phase B were built for that.
- **Evidence:** Caller search for `document-intake`, `master-register`, `lib/ingestion` (none outside tests and the route).
- **Why it matters:** Evidence disappears with the browser profile; a second device or user sees records pointing at files that do not exist; scanning is bypassed for Document AI.
- **Potential impact:** Loss of audit evidence; compliance claims without retrievable proof.
- **Dependencies:** D-01, D-04, D-05.
- **Recommended repair boundary:** SEG18 (write payload first, roll back metadata on failure) is small and independent; SEG19 (client wiring to intake) is blocked.
- **Verification after repair:** A failed payload write leaves no evidence metadata; driver evidence is retrievable from a clean browser profile (after SEG19).

### F-013 — Audit trail is fragmented, locally stored, silently lossy and unattributed
- **Category:** Evidence / audit integrity. **Severity:** P1. **Confidence:** CONFIRMED.
- **Workflow / files:**
  - `lib/audit-log.ts` (NDJSON in `localStorage tes_audit_log`; `logAuditEvent` "Never throw. Never alert. Silent."; flag at 4 MB, no stop).
  - `lib/audit-logger.ts` (`tes_audit_events`, truncated to the latest 500: `list.length = 500`).
  - `lib/activity-log.ts` (`tes_activity_{companyId}`, capped at 1000).
  - `lib/audit.ts` (console-only "Immutable Master Register", no importers).
  - `lib/master-register/*` (the real immutable ledger; no importers outside tests).
  - `lib/driver-data.ts → auditDriverMutation` (`actor: ""`, `role: ""`).
  - 59 hardcoded `"System Administrator"` literals; `getCurrentUser()` has 3 callers; `RegistrationTab.tsx` invents "Authenticated TES user (prototype fallback)".
- **Observed:** Five logging systems with different schemas and retention; the two that are live both live in the user's own browser, can be edited or cleared, and one deliberately discards history beyond 500. Quota failures drop audit events silently. Driver mutations carry no actor and, for identity edits, no company.
- **Expected / inferred:** One append-only, server-held, attributed log (the Master Register was built for this).
- **Evidence:** Sources above; `grep` importer counts (`audit.ts` 0, `master-register` 0 outside tests).
- **Why it matters:** The product claims auditability ("SENSITIVE_RECORD_ACCESSED", "Immutable") that the storage cannot deliver.
- **Potential impact:** Audit log cannot be relied on as evidence; actions cannot be attributed.
- **Dependencies:** D-01 (who is the actor), D-04, D-06 (relationship of Master Register to these loggers).
- **Recommended repair boundary:** Small attribution fix in `auditDriverMutation` (SEG34) now; consolidation after D-06.
- **Verification after repair:** Driver mutation audit entries have a non-empty actor and the correct company.

### F-014 — Known runtime `ReferenceError` in MaintenanceTab, with no error boundary anywhere
- **Category:** Core functional failure / error handling. **Severity:** P1. **Confidence:** HIGH (tsc TS2304 plus source; not executed).
- **Workflow / files / function:** Vehicle maintenance. `src/components/vehicles/maintenance/MaintenanceTab.tsx → InspectionFindingsPanel` (lines 231–232) and `MaintenanceItemsPanel` (lines 295–297).
- **Observed:** Both components use `className={inputClass}` but neither declares nor receives `inputClass` (it is a prop of other components, line 97/396). Opening the "add finding" / "add maintenance item" form renders this expression and throws. There is no `error.tsx`, `global-error.tsx`, `not-found.tsx` or `ErrorBoundary` in the repo, so the exception unmounts the whole app tree.
- **Expected / inferred:** The form renders.
- **Evidence:** `tsc` TS2304 ×5 at those lines; grep for `error.tsx`/`ErrorBoundary` returns nothing.
- **Why it matters:** A core vehicle workflow crashes into a blank page; any other render exception does the same.
- **Potential impact:** Users lose unsaved input and the app state.
- **Dependencies:** None.
- **Recommended repair boundary:** SEG20 (one-file fix), SEG21 (add boundaries).
- **Verification after repair:** Both forms open; a thrown render error shows a recoverable screen.

---

## P2 Findings

### F-015 — Applicant submit retry can deadlock after a lost response
- **Category:** Error recovery / retry. **Severity:** P2. **Confidence:** CONFIRMED (logic).
- **Files:** `applicant-application-store.ts → submitApplication`; repository `saveApplicantSubmission`.
- **Observed:** Each attempt builds a **new** `submittedAt` and `receiptId`. If the server persisted attempt 1 but the response was lost, attempt 2 differs, and the repository's immutability check throws "A different immutable submission already exists" (surfaced as 409). The applicant is stuck with an error while TES holds a submission the applicant never received a receipt for.
- **Expected:** Retry of the same submission is idempotent.
- **Why/impact:** Applicant can never finish; support burden. **Dependencies:** none. **Repair boundary:** persist the pending `submittedAt`/`receiptId` locally before POST and reuse them (SEG14). **Verify:** simulated dropped response then retry succeeds with the same receipt.

### F-016 — Each invitation attempt creates a new application record; failed attempts remain `Invitation Ready`
- **Category:** Duplicate/orphan records. **Severity:** P2. **Confidence:** CONFIRMED.
- **Files:** `DriverWorkspace.tsx → handleCreateApplication`.
- **Observed:** Every click calls `addDriverApplication` (new `APP-<uuid>`) before the send. A failure leaves the record at `Invitation Ready` with `invitationLastError`, and the retry creates another. There is no "Resend" for the existing record. (This part of the design, `Invitation Ready` until the provider accepts, is correct.)
- **Why/impact:** Multiple parallel applications for one driver; confusing hiring file; `Superseded` handling does not apply. **Dependencies:** SEG11 (same file, do first). **Repair boundary:** retry reuses the pending `Invitation Ready` record (SEG17). **Verify:** two failed attempts then one success leaves one application.

### F-017 — The Add Driver "existing driver check" is enforced only in the page
- **Category:** Validation gap. **Severity:** P2. **Confidence:** CONFIRMED.
- **Files:** `app/companies/[id]/drivers/page.tsx → submit`; `lib/driver-data.ts → createDriver`.
- **Observed:** `createDriver` still permits creation without a check unless the legacy matcher finds a match (licence / name+DOB). The new `acknowledgeDistinctPerson` option and the reuse option are caller-asserted.
- **Why/impact:** Any other caller (or future surface; `DriverList.tsx` contains an unreachable second create path with a missing import) bypasses the mandatory check. **Dependencies:** none. **Repair boundary:** SEG25. **Verify:** `createDriver` without a matching check key fails.

### F-018 — `ignoreBuildErrors: true` hides 139 type diagnostics
- **Category:** Technical debt with runtime consequences. **Severity:** P2. **Confidence:** CONFIRMED.
- **Files:** `next.config.mjs`; full `tsc --noEmit` run.
- **Observed:** 139 diagnostics: TS2322 ×51, TS5097 ×28 (the `.ts` extension imports that exist for Node-native tests), TS2345 ×16, TS2304 ×9, TS18047 ×7, TS2307 ×6. TS2304 includes F-014 and `lib/expiry-rules.ts` (a file whose entire content is pseudo-code, 0 importers). TS2307 are unresolved type-only imports (`../types`, `../../types/ocr` etc.), so they erase at runtime but leave the affected types as `any`.
- **Why/impact:** The build cannot catch new runtime errors. **Repair boundary:** add a baseline-comparing typecheck script (SEG40), then fix TS2304/TS2307 individually (SEG41). Do not flip `ignoreBuildErrors` until the baseline is clean. **Verify:** typecheck count never rises.

### F-019 — OCR auto-save resolves the **company** from OCR text, and the write path does not require a relationship
- **Category:** Cross-record linkage / cross-company write. **Severity:** P2. **Confidence:** HIGH (gated by `REVIEW_REQUIRED`, so it rarely fires, as the file's own header says).
- **Files:** `lib/auto-save-roadside.ts → autoSaveRoadsideInspection`; `lib/ingestion-entity-resolver.ts → resolveEntities, normalizeCompanyName`; `lib/driver-data.ts → addPerformanceEvent`.
- **Observed:** The target company is `entities.company` from NSC/USDOT or a normalized carrier-name match (`inc|ltd|corp|co|llc|limited|incorporated` stripped, so "ABC Transport Inc" equals "ABC Transport Ltd"; flagged `"FUZZY"` but still saved). It is not the company workspace in which the file was uploaded. The driver is matched globally by licence. `addPerformanceEvent` computes `companyDriverRelationshipId` with `activeRelationship(...)?.id` and silently proceeds with `undefined` when the driver has no relationship with that company.
- **Why/impact:** An event can be written into a company where the driver has no relationship (orphan, `companyDriverRelationshipId` undefined), or into the wrong similarly named carrier. **Dependencies:** none. **Repair boundary:** require an active relationship in `addPerformanceEvent`, and make auto-save use the invoking company (SEG24). **Verify:** auto-save into a company with no relationship returns REVIEW_REQUIRED.

### F-020 — `Not Established` driver status exists in the model but not in the Profile editor
- **Category:** Discrepancy (duplicated enum). **Severity:** P2. **Confidence:** HIGH (source read; not exercised in a browser).
- **Source A:** `types/drivers.ts → DriverStatus` includes `"Not Established"`; `app/companies/[id]/drivers/page.tsx` (`STATUSES`, default `driverStatus: "Not Established"`).
- **Source B:** `src/components/drivers/DriverProfileTab.tsx` `DRIVER_STATUSES` (lines 49–55) omits it; `lib/driver-taxonomy.ts → DRIVER_STATUSES` also omits it.
- **Why they disagree:** Four copies of the status list. A relationship created as `Not Established` opens in a `<select>` whose value matches no option, so the control displays the first option, "Active", while the stored value is unchanged.
- **Canonical layer:** `types/drivers.ts` (the type). **Consequence:** the editor shows "Active" for a driver who is not established, which is exactly the "Active before employment is established" class of error. **Repair boundary:** one list in `lib/driver-taxonomy.ts` used by both (SEG22). **Verify:** the profile of a `Not Established` driver shows "Not Established".

### F-021 — Evidence records without a `driverMasterId` are shown to every driver in the company
- **Category:** Within-tenant leakage / wrong linkage. **Severity:** P2. **Confidence:** CONFIRMED.
- **File:** `app/companies/[id]/drivers/[driverId]/page.tsx` (evidence filter: `if ("driverMasterId" in record) return record.driverMasterId === master.id; return true`).
- **Observed:** A record lacking the key is returned for **every** driver.
- **Why/impact:** Another driver's legacy evidence appears in this driver's workspace. **Dependencies:** check which legacy records lack the key before changing semantics (verification step in SEG23). **Repair boundary:** one file. **Verify:** a keyless record appears for no driver (or is surfaced in a "unassigned" list).

### F-022 — "Today" is computed in UTC in 61 places; there is no local-date helper
- **Category:** Date / timezone integrity. **Severity:** P2. **Confidence:** CONFIRMED (pattern); impact HIGH.
- **Files:** 61 occurrences of `new Date().toISOString().slice(0,10)` / `.split("T")[0]` across `app/companies/[id]/{business,citations,contacts,insurance,profile,vehicles}`, `src/components/{business,drivers,insurance}`, `lib/{authorities/model,driver-performance-model,effective-dating,vehicle-data}`. `lib/driver-date.ts` normalizes inputs but offers no "today".
- **Observed:** For a user in a North American evening, the UTC date is already tomorrow, so `createdDate`, "issued today", default effective dates and expiry comparisons are off by one day.
- **Why/impact:** Effective-dated history (licence, address, status) rejects or mis-orders entries entered "today"; expiry boundaries shift. **Repair boundary:** one helper (SEG26) then adoption per module (SEG27a–e). **Verify:** at 22:00 local, "today" equals the local calendar date.

### F-023 — Invitation token design: signing key falls back to the email API key; payload is readable PII in the URL; no revocation or single use
- **Category:** Security / token handling. **Severity:** P2. **Confidence:** CONFIRMED.
- **File:** `lib/driver-invitation-token.ts → signingSecret, createDriverInvitationToken, verifyDriverInvitationToken`.
- **Observed:** `TES_INVITATION_SECRET || RESEND_API_KEY` signs the token, so `TES_INVITATION_SECRET` is not set in the local env (name list) and the Resend key is the HMAC key. The payload is base64url JSON (name, email, company contact) in a query string, therefore visible in server logs, browser history, and possibly analytics. No `jti` or revocation list, so a leaked link is reusable until `expiresAt` (7 days). Verification (HMAC, `timingSafeEqual`, expiry, version) is otherwise sound.
- **Why/impact:** Rotating the Resend key silently invalidates every outstanding invitation; a leak of that key allows forging invitations. **Dependencies:** SEG02 needs the env var set by the user in the hosting environment. **Repair boundary:** require a dedicated secret and fail closed; token contents and revocation are D-09 (policy). **Verify:** missing secret fails closed; rotating Resend key leaves tokens valid.

### F-024 — "Invite Applicant" button says the feature is not activated while the invitation flow is live
- **Category:** UI/behaviour contradiction. **Severity:** P2. **Confidence:** CONFIRMED.
- **Files:** `app/companies/[id]/drivers/page.tsx` (line ~62, `alert("Secure applicant invitation is intentionally not activated…")`) versus `DriverWorkspace.tsx → handleCreateApplication` which actually sends email.
- **Why/impact:** Two surfaces give opposite answers about the same capability; one is a dead button. **Repair boundary:** remove or wire the list-page button (SEG30). **Verify:** no UI claims the capability is off when it is on.

### F-025 — Reads have write side effects; visiting a made-up company id creates stores
- **Category:** State / persistence. **Severity:** P2. **Confidence:** CONFIRMED.
- **Files:** `lib/driver-data.ts → loadCompanyDriverStore` (writes when `!raw` or any migration condition), `loadDriverMasterStore` (writes on migration), `reconcileApplicantSubmissionHandoffs` (reads the **applicant's** `tes_applicant_application_submitted_*` keys from the same browser origin and mutates company applications on every load); `app/companies/[id]/drivers/page.tsx → hydrate` runs before the "company not found" check.
- **Observed:** `/companies/ANYTHING/drivers` writes `tes_company_drivers_ANYTHING`. The master store gains normalization fields on load.
- **Why/impact:** Phantom stores; a "view" mutates records; applicant-browser state leaks into TES state when both run in one browser (testing) and masks the server boundary. **Repair boundary:** do not persist on load for unknown companies (SEG31). **Verify:** visiting an unknown company id writes nothing.

### F-026 — Company shape is defined five times and read through alias fields
- **Category:** Duplicate sources of truth. **Severity:** P2. **Confidence:** CONFIRMED.
- **Files:** `Company` types in `lib/authorities/types.ts`, `src/components/tax-filing/types.ts`, `src/types.ts`, `app/companies/page.tsx`, `app/companies/[id]/citations/page.tsx`; `DriverWorkspace.tsx` builds the invitation address from `reg_street || regStreet || registeredStreet || addressLine1` (and equivalents for city/state/zip/country/phone/email).
- **Why/impact:** There is no single canonical field for the registered address; the invitation silently picks whichever alias is populated. **Dependencies:** D-07. **Verify:** one `Company` type; one address accessor.

### F-027 — Global contacts store is filtered by company in the browser; legacy v3/v4/v5 keys coexist
- **Category:** Tenant leakage (client-side filtering) / duplicate stores. **Severity:** P2. **Confidence:** CONFIRMED.
- **Files:** `app/companies/[id]/contacts/page.tsx`; `insurance/page.tsx → resolveBrokerContact`; keys `tes_contacts_v3/v4/v5`.
- **Observed:** The whole contact book is loaded for every company page and filtered by `relationships.companyId`. Insurance writes into the same global store (including snapshot rollback of the whole store).
- **Why/impact:** Part of F-002; plus three generations of the key persist with fallback reads. **Dependencies:** D-01. **Verify:** after the gate exists, a company view cannot read other companies' contacts.

### F-028 — Unknown/not-yet-collected collapses into "not applicable" or "clear" by default
- **Category:** Semantic collapse. **Severity:** P2. **Confidence:** CONFIRMED.
- **Files and values:**
  - `applicant-application-store.ts → createEmptyApplicantDraft`: `workPermitConditions: "not-applicable"` and `failedRehabilitationOrReturnToDuty: "not-applicable"` are the starting values of questions the applicant has not been asked; they are not in the readiness checks, so they can be submitted untouched.
  - `lib/driver-data.ts → createDriver`: `identityResolution: { status: input.stateProvince === input.licenceJurisdiction ? "CLEAR" : "REVIEW" }`. `CLEAR` is a stored judgment assigned from a string equality at creation, with no review (the enum also has `UNREVIEWED`).
  - `app/companies/[id]/drivers/page.tsx:56` `status: company.status ?? "Active"`; `app/companies/[id]/edit/page.tsx` `defaultValue={company.status || "Active"}` (saving the edit form writes `Active` when status was unknown).
  - `handleCommitOCR` (F-007): empty field replaced by a value.
- **Why/impact:** Absence of an answer reads as an answer. **Repair boundary:** SEG28 (applicant defaults), SEG29 (identity resolution), SEG32 (company status). **Verify:** defaults are blank/UNREVIEWED/Unknown and readiness requires an explicit choice.

### F-029 — No concurrency control: whole-store rewrites, last-write-wins across tabs, snapshot rollbacks
- **Category:** Persistence / integrity. **Severity:** P2. **Confidence:** CONFIRMED (pattern).
- **Files:** `lib/driver-data.ts → read/write/save*Store` (every mutation reloads and rewrites the entire JSON); `insurance/page.tsx → captureCrossStoreSnapshot / rollbackCrossStoreSnapshot` and `business/page.tsx` (restore whole-key snapshots of `tes_companies`).
- **Observed:** Two tabs (or an invitation reconcile racing a user edit) overwrite each other. A rollback restores a stale full copy of shared keys such as `tes_companies`/`tes_contacts_v5`, discarding concurrent changes. `QuotaExceededError` surfaces only where the caller catches it.
- **Why/impact:** Silent lost updates; large inline evidence legacy risks quota failure. **Dependencies:** D-04 (a real system of record removes the class). **Verify:** n/a until D-04.

---

## P3 Findings

### F-030 — The driver workspace opens an **archived** relationship as if live
`app/companies/[id]/drivers/[driverId]/page.tsx`: `relationships.find(not archived) ?? relationships.find(any)`. A driver whose only relationship is archived opens in full-edit mode; `updateDriverProfileAtomic` then throws "Driver record not found" for non-archived lookup, a confusing failure. **Confidence:** CONFIRMED. **Repair:** show an archived banner and make it read-only (SEG33).

### F-031 — Company header treats missing status as `Active`
`drivers/page.tsx:56`. Covered under F-028; separately a UI-only hierarchy issue because the badge reads as established fact. **Confidence:** CONFIRMED.

### F-032 — Dialog and confirmation patterns are inconsistent
40 files build hand-rolled `fixed inset-0` overlays; 1 file uses the shared Dialog primitive; only 7 occurrences of `role="dialog"`/`aria-modal`. 42 native `alert()/confirm()` calls (including destructive confirmations: company delete, settings). **Impact:** inconsistent focus/escape/backdrop behavior and accessibility; destructive actions look like routine prompts. **Confidence:** CONFIRMED (counts). **Repair:** incremental, per modal (SEG46).

### F-033 — Development routes and stale bundles are shipped/tracked
`app/design-system` and `app/design-system-reference` are production routes; `repo_bundle.md` (20.7 MB), `repomix-output.xml` (15.7 MB) and `tsconfig.tsbuildinfo` (467 KB) are tracked in git. A pattern check (private-key blocks, `re_…`, `AIza…`, env assignments) found **no secrets** in the two bundles, but they are stale full-source snapshots (Sep 12). **Confidence:** CONFIRMED. **Repair:** SEG36, SEG37.

### F-034 — Console logging of extracted driver data
33 `console.log` calls; 3 serialize Document AI / roadside results with `JSON.stringify` (`DriverWorkspace.tsx` `[OCR]` / `[AUTO-SAVE]` logs, driver name, licence, DOB) to the browser console in production builds. **Confidence:** CONFIRMED. **Repair:** SEG38.

### F-035 — Dead or contradicting modules remain
- `lib/asset-validation.ts` (0 importers): asserts "A driver cannot be active in two separate companies simultaneously", which contradicts the multi-company `DriverMaster` model; also would disclose another company's unit number.
- `lib/vehicle-data.ts → emptyVehicleDraft`, `getDefaultSeedVehicles` (0 callers): fabricated vehicles, `inspectionPassed: true`, "Verified compliance…" permit notes, random cab-card/permit numbers.
- `lib/audit.ts` (0 importers), `lib/expiry-rules.ts` (non-code content, 0 importers).
- `src/components/drivers/DriverList.tsx`: an unreachable second Add Driver path.
- `getDefaultSeedVehicles` / `emptyVehicleDraft` are latent hazards, since anyone wiring them in creates fabricated compliance facts.
**Confidence:** CONFIRMED. **Repair:** SEG39 after confirming no external use.

### F-036 — Long-lived Google credential variable still present in the local env
`.env.local` (gitignored, never committed: `git log --all -- .env.local` empty) contains `GOOGLE_APPLICATION_CREDENTIALS_JSON`. The code deliberately never reads it (`lib/google/auth.ts` says so). Hygiene: after confirming nothing uses it, revoke that key in GCP and remove the variable. No value was read. Also `.gitignore` contains one UTF-16-mangled line (harmless, `.env*` is intact). **Confidence:** CONFIRMED (name only). **Action:** user task (SEG47); no code change.

### F-037 — Test coverage is thin and one static test is line-ending fragile
11 test files for a ~40-route app; no UI, workflow or API tests. `test/lib/ingestion/object-paths.test.ts` ("raw upload helper targets the QUARANTINE bucket…") fails when `lib/google/storage.ts` has CRLF (it slices with `"\n}\n"`). Same class as the earlier scanner `entrypoint.sh` test. **Confidence:** CONFIRMED. **Repair:** SEG42.

### F-038 — Several ID generators fall back to `Math.random()` / `Date.now()`
`lib/driver-data.ts → uid` falls back when `crypto.randomUUID` is missing; 20+ other sites use `Math.random()`/`Date.now()` for ids and human-facing numbers (`INSP-######`, `CMP-<rand>` with a collision check). Low practical risk in browsers with `crypto`; recorded for completeness. **Confidence:** CONFIRMED (pattern). **Repair:** none now; address with D-04.

---

## Cross-System Contradictions

| # | Source A | Source B | Why they disagree | Canonical layer | Consequence |
|---|---|---|---|---|---|
| X-1 | Invitation is **live**: `DriverWorkspace.handleCreateApplication` sends email | `drivers/page.tsx` "Invite Applicant" alerts it is "intentionally not activated" | Two surfaces, opposite statements | The working handler | Users told it is off while emails go out (F-024) |
| X-2 | `DriverApplicationStatus` enum: `Started`, `In Progress`, `Expired`, `Invitation Cancelled` | No code ever writes them | Lifecycle declared, not implemented | Code (reality) | Dead states; expired invitations stay `Invited` (F-011) |
| X-3 | `DriverStatus` includes `Not Established` (`types/drivers.ts`, drivers page) | `DriverProfileTab`, `driver-taxonomy` omit it | Four copies of one enum | `types/drivers.ts` | Editor displays "Active" for unestablished drivers (F-020) |
| X-4 | Multi-company `DriverMaster` + per-company `CompanyDriverRelationship` (the real model; Existing-Driver check shows multiple affiliations) | `lib/asset-validation.ts`: "cannot be active in two companies" | Dead rule contradicts the live model | The relationship model | Latent wrong rule if wired (F-035) |
| X-5 | Applicant UI: documents "required … before submission" | Store: "File bytes are NOT persisted" | Required but never stored | Store (reality) | False completeness (F-009) |
| X-6 | Landing dashboard: 96% / 128 vehicles / 4 filings | `lib/data.ts` arrays empty; no calculation | KPIs not derived | Records (nothing) | Fictitious health score (F-008) |
| X-7 | Audit log labelled "append-only / Immutable Master Register" | Browser `localStorage`, truncated at 500, silent failures; Master Register unwired | Claim exceeds storage | Storage | Not evidence-grade (F-013) |
| X-8 | `business-document-ocr` message: "The evidence is saved" | Evidence = one browser's IndexedDB | "Saved" has no durability | Storage | Overstated assurance (F-012) |
| X-9 | `DriverMaster.identityResolution = "CLEAR"` at creation | No identity review occurred | Stored judgement from string equality | `UNREVIEWED` is the true state | False "clear" (F-028) |
| X-10 | Applicant draft `workPermitConditions = "not-applicable"` default | Citizenship may be Work Permit | Default answers a question not asked | Unknown | Silent N/A (F-028) |
| X-11 | Company `status` unset | Header and edit form show/write `Active` | Unknown → Active | Unknown | F-028/F-031 |
| X-12 | Phase B ingestion built: quarantine → scan → intake | Driver/vehicle/insurance/contacts evidence uses three IndexedDB stores; intake route has no caller | Parallel evidence systems | Neither is the single truth | Duplicate sources of truth (F-012) |
| X-13 | `Company` address: `reg_street` | `regStreet`, `registeredStreet`, `addressLine1` | Alias fields for one fact | Undefined | Invitation address depends on which alias exists (F-026) |

---

## Data / Tenant Leakage Findings

Classification: **CONFIRMED** = code path read; **LIKELY** = code plus a reasonable attacker model; **POSSIBLE** = needs verification.

| ID | Finding | Class | Code path |
|---|---|---|---|
| L-1 | Any caller reads any company's submitted applications by `applicationId` | CONFIRMED path; guessability LOW (`APP-<uuid>`) | `submissions/route.ts GET` (F-005) |
| L-2 | Any caller writes into any company's quarantine namespace by `companyId` | CONFIRMED | `document-intake/route.ts` (F-004) |
| L-3 | Company pages read any `companyId` from the URL with no membership check | CONFIRMED | all `app/companies/[id]/**` (F-002) |
| L-4 | Global `DriverMaster` PII readable/writable from any company; no history/actor | CONFIRMED | `updateDriverMasterIdentity`, `createDriver` (F-006) |
| L-5 | Contacts of all companies loaded into every company page | CONFIRMED | contacts page (F-027) |
| L-6 | Existing-Driver check reveals other companies' names and driver status | CONFIRMED (specified behavior) | `lib/driver-existing-check.ts` (cross-tenant by design; becomes a leak once tenants exist) |
| L-7 | Licence uniqueness error reveals another `DriverMaster` id | CONFIRMED | `addLicence` throws "already linked to Driver Master ${other.id}" |
| L-8 | Ownerless evidence appears for every driver of a company | CONFIRMED (within tenant) | `[driverId]/page.tsx` (F-021) |
| L-9 | Applicant-browser submitted snapshots are read by TES code in the same origin | CONFIRMED (testing configuration only) | `reconcileApplicantSubmissionHandoffs` (F-025) |
| L-10 | `request.nextUrl.origin` builds the invitation link; depends on trusted Host header handling | POSSIBLE / NEEDS VERIFICATION | `send-invitation/route.ts` |
| L-11 | Invitation token (readable PII) in URLs may appear in server/analytics logs | POSSIBLE / NEEDS VERIFICATION | `driver-application/page.tsx`, `<Analytics />` |
| L-12 | GCS signed URLs / evidence retrieval | Not applicable: no read/signed-URL path exists (retrieval is browser IndexedDB only) | n/a |

---

## Security Findings

- **Unauthenticated routes (all 5):** F-001, F-004, F-005. No rate limiting anywhere.
- **Secrets:** no secret values reached client code (`server-only` on the Google auth module; no `NEXT_PUBLIC_*` secrets; only variable names inspected). Token signing reuses the email API key (F-023). A dormant long-lived Google key variable exists locally (F-036). Pattern scan of the two tracked 36 MB bundles found no keys.
- **Server error disclosure:** `send-invitation` returns raw `error.message` and provider messages; `submissions POST` returns raw messages.
- **Upload handling:** `document-intake` is strong (size before read, MIME allowlist, magic bytes, filename sanitisation, create-only quarantine). `document-ai` has none of these (F-004). Applicant uploads are not uploaded at all (F-009).
- **PII in logs:** F-034. **PII in URLs:** F-023, L-11.
- **Admin PIN** is a browser-side control (F-002).
- **Positive controls observed (do not regress):** production Google auth fails closed with no credential fallback (`lib/google/auth.ts`); HMAC compared with `timingSafeEqual`; submissions are immutable per `applicationId`; email HTML escapes every interpolated value; quarantine writes are create-only.

---

## Unfinished Systems

| System | State | Reachable? |
|---|---|---|
| Applicant document upload | Metadata only (F-009) | Yes, applicant flow |
| Server persistence for submissions | Dev JSON file (F-010) | Yes |
| Master Register (immutable ledger) | Built and tested; no caller | No (orphan) |
| Document intake + scanner pipeline | Built; no UI caller | No (orphan) |
| Authentication / roles | Hardcoded actor (F-002) | Yes |
| OCR for insurance, citations, contacts | Simulations (F-007) | Yes |
| OCR for corporate docs and roadside | Real Document AI | Yes |
| Dashboard KPIs, `/drivers`, `/vehicles` global pages | Static / empty (F-008) | Yes |
| `Reports`, `Customs`, `Credentials`, `Programs`, `Trip Compliance`, `Decision Support`, `Business Intelligence` pages | Sample data "emptied"; shells | Yes (navigable) |
| Application statuses `Started/In Progress/Expired/Invitation Cancelled` | Declared, never written (F-011) | n/a |
| Licence-based Existing-Driver re-check | Reserved parameter only (per earlier decision) | Intentionally deferred |
| TODOs of note | `lib/audit.ts` DB inserts; `ingestion-entity-resolver.ts` name+DOB fallback; `auto-save-citation.ts` fields; `DriverPerformanceEventWorkflow.tsx` officer/driver/carrier mapping | Mixed; only the last is reachable |

---

## Workflow / State-Machine Problems

**Driver Application (reconstructed from code):** `Invitation Ready` (record created) → [Resend accepted] `Invited` → [applicant final submit, reconciled on next workspace open] `Submitted` → [staff] `Under Review` / determination. Missing: *delivered*, *opened*, *started*, *in progress*, *expired*, *cancelled*, *resent*. A lost submit response deadlocks the applicant (F-015). Reconciliation of `Submitted` only happens when someone opens the driver workspace (one fetch per mount) and only for ids in that company.

**Driver creation:** state is sound after this week's change (mandatory check, explicit resolution, reuse never touches other companies). Residual: gate is page-level (F-017); identity-conflict handling is "typed values discarded" with no reconciliation path.

**Archive:** company → hard delete (F-003); relationship → archived but openable as live (F-030); driver master → `archive.isArchived` exists but no UI path audited.

**Evidence → performance event:** evidence metadata saved before payload (F-012); OCR auto-save can target a company other than the one in view (F-019).

**Refresh/reload:** applicant drafts survive via `localStorage`; a different browser or device cannot resume. TES records survive only in that browser.

---

## Persistence / Production-Readiness Gaps

| Record | Where it lives | Class | Consequence |
|---|---|---|---|
| Companies, customers | `localStorage` | browser-only | Per-browser; deletion destroys (F-003) |
| DriverMaster, company driver stores, applications, hiring, screening, training, events | `localStorage` | browser-only | One browser; quota; no concurrency control (F-029) |
| Vehicles, insurance, authorities, tax, citations, business records, repair stores | `localStorage` per company | browser-only | Same |
| Contacts | `localStorage` global (`tes_contacts_v3/v4/v5`) | browser-only | Cross-company in one store (F-027) |
| Evidence payloads (drivers) | IndexedDB `tes_evidence_payloads` | browser-only | Lost with profile (F-012) |
| Evidence files (vehicles) | IndexedDB `tes-evidence-files` | browser-only | Same |
| Evidence (contacts) | IndexedDB `tes_evidence_store` | browser-only | Same |
| Audit log / audit events / activity | `localStorage` | browser-only, lossy | F-013 |
| Applicant draft | applicant's `localStorage` | browser-only (by design, dev) | Cannot resume elsewhere |
| Applicant submission | `.tes-data/…json` on server filesystem | temporary persistent | Unlikely durable on serverless (F-010) |
| Quarantine/intake objects | GCS buckets | production persistent | Correct but not connected to any UI (F-012) |
| Master Register | repository interface + in-memory test impl | mock | No production repository bound |
| Dashboard figures | hardcoded | mock | F-008 |
| Admin PIN hash | `localStorage` | browser-only | Not a server control (F-002) |

Production persistent today: **GCS quarantine/intake only**, with no user-facing path into it. Everything the UI presents as records is browser-only. This is the subject of D-04 (the Phase C0 decision), which should be resolved before any of the "blocked" segments.

---

## Evidence / Provenance Problems

- Applicant document files never reach any store (F-009); the submitted snapshot references file *names*.
- Driver evidence payloads are browser-only; metadata can exist without a payload (F-012).
- Fabricated values carry provenance of a real uploaded file (F-007): evidence record appears to substantiate a policy number it does not contain.
- Contacts evidence is marked `verified` by simulation (F-007).
- `DriverMaster` identity changes keep neither the previous value nor an actor (F-006); licence and address are effective-dated, identity is not.
- Auto-saved events can lack `companyDriverRelationshipId` (F-019).
- `reconcileDriverApplicationEvidence` / applicant-vs-master comparison exists (not audited), but applicant evidence has no files to reconcile.
- Cross-record links not verified for: Inspection ↔ Repair, Violation ↔ Repair, Tax Filing ↔ Evidence, Authority ↔ Evidence, Insurance ↔ Evidence, Generated Document ↔ Source Data (see "Areas Not Fully Verifiable").

---

## UI/UX Contradictions

1. **Invite Applicant** says "not activated" (F-024) while the real invitation is live.
2. **Editor shows `Active`** for `Not Established` (F-020), the "Active before employment is established" pattern.
3. **KPI cards present results** that are not computed (F-008); `/drivers` "Add driver" button is inert.
4. **"Simulated" values appear as extracted** with confidence scores and "verified" badges (F-007).
5. **Evidence "saved"** message versus browser-only storage (F-012).
6. **Applicant pages** list documents as required, accept a file selection, and proceed though nothing is stored (F-009).
7. **Dialog/confirm patterns:** hand-rolled overlays versus the shared primitive; native `confirm()` for company deletion (F-032).
8. **Footers:** Add Driver and Create Company now share the footer pattern; other forms were not compared (not verified).
9. **Status terminology:** "Invited" means "provider accepted", "Submitted" means "snapshot reconciled", and neither wording says so.
10. **Responsive/wide-monitor behavior:** not verified.

---

## Dead / Orphaned / Duplicate Systems

- **Orphaned:** `/api/document-intake` + scanner pipeline; `lib/master-register`; `lib/ingestion/*` (only the route); `lib/audit.ts`; `lib/asset-validation.ts`; `lib/expiry-rules.ts`; `emptyVehicleDraft`/`getDefaultSeedVehicles`; `DriverList.tsx` create path; `lib/data.ts` arrays.
- **Duplicate:** 5 audit/log systems (F-013); 3 IndexedDB evidence stores plus inline base64 legacy (F-012); 5 `Company` types (F-026); 4 `DriverStatus` lists (F-020); 3 contacts store versions (F-027); a global `/drivers` and `/vehicles` page next to company-scoped ones.
- **Tracked artifacts:** `repo_bundle.md`, `repomix-output.xml`, `tsconfig.tsbuildinfo` (F-033).

---

## Decision Required Items

| ID | Decision | Competing interpretations |
|---|---|---|
| D-01 | **Authentication/authorization approach** (blocks F-001, F-002, F-004, F-005 GET, F-013, F-027) | Managed auth provider vs self-hosted sessions; what a "company member" is; roles beyond admin. The repo does not establish this. |
| D-02 | Company "delete" semantics | Archive flag (repo convention) vs retained hard delete with cascade for a defined admin role |
| D-03 | Who may change shared `DriverMaster` identity | Any company with history, vs only the originating company, vs a reviewed change request visible to affiliated companies |
| D-04 | System of record (the Phase C0 persistence decision; no vendor chosen) | Blocks F-010, F-012 (real fix), F-029, F-038 |
| D-05 | How an unauthenticated applicant uploads files | Token-gated quarantine intake (fits Phase B) vs presigned direct upload vs defer file requirement |
| D-06 | Relationship of Master Register to `audit-log`/`audit-logger`/`activity-log` | Replace all vs keep activity feed separate (the repo says Activity and Audit Log "must never be merged") |
| D-07 | Canonical Company field names/address | Pick one of the alias sets; migration of stored records |
| D-08 | Replacement UX for simulated OCR | Manual-entry-only vs "OCR unavailable" banner vs wire real extraction later |
| D-09 | Invitation token policy | Short-lived link + OTP vs bearer link; revocation list; whether PII belongs in the token |

---

## Root-Cause Map

**RC-1 No identity boundary and browser-only system of record**
→ F-001, F-002, F-004, F-005, F-010, F-012, F-013, F-025, F-027, F-029, F-038
→ Symptoms: open APIs, PII in global stores, lost evidence, unattributed audit, phantom stores.

**RC-2 Prototype/simulation code in production paths**
→ F-007, F-008, F-009, F-024, F-035
→ Symptoms: fabricated people/policies/KPIs, "required" documents not stored, contradictory buttons.

**RC-3 Shared `DriverMaster` without ownership, history or relationship enforcement**
→ F-006, F-017, F-019, F-021, F-030
→ Symptoms: silent identity overwrite, cross-company effects, orphan events, unscoped evidence.

**RC-4 Status/state semantics not modeled, and enums duplicated**
→ F-011, F-016, F-020, F-028, F-031, F-026
→ Symptoms: Unknown shown as Active/N/A/Clear, declared-but-unwritten states, duplicated lists and company shapes.

**RC-5 Safety nets disabled**
→ F-014, F-018, F-037
→ Symptoms: runtime crashes that the build ignores, no error boundary, thin tests.

**RC-6 No local-date primitive** → F-022 (one helper plus adoption).

**RC-7 Destructive default actions** → F-003, F-032.

---

## Fixation Plan

**Rules for every segment:** one logical problem, one commit, independently revertible. Nothing in this plan is to be started before authorization of that specific segment. "Parallel-safe" means disjoint files and no ordering dependency. Segments marked **BLOCKED** need the named decision first and should not be started.

**Recommended order:** 01 → (02, 03, 04 in parallel) → 20, 21 → 06 → 07–10 (parallel) → 11 → 17 → 18 → 13 → 14 → remainder by priority → blocked segments after decisions.

---

### SEGMENT 01 — Submissions POST requires and binds the invitation token
- **Problem:** F-005 write side: no token check; squatting; expired invitations can submit.
- **Exact scope:** `POST /api/driver-applications/submissions` verifies an `Authorization: Bearer <token>` (or equivalent) with `verifyDriverInvitationToken`; requires `payload.applicationId === body.applicationId`; rejects otherwise. The applicant store sends the token. GET unchanged.
- **Files expected to change:** `app/api/driver-applications/submissions/route.ts`, `app/driver-application/applicant-application-store.ts` (and its callers passing the token: `DriverApplicationWorkspace.tsx`), one new test.
- **Files explicitly out of scope:** repository, GET behavior, token format, UI.
- **Dependencies:** none. (Parallel-safe with 02–04.)
- **Implementation actions:** thread `token` into `submitApplication`; add header; server verification and 401/403 responses.
- **Regression risks:** applicant flow must still submit; existing local submitted snapshots must still re-POST.
- **Acceptance criteria:** wrong, expired, or mismatched token → 401/403 and nothing stored; valid token → stored as before.
- **Tests/checks:** unit test for the route handler; `tsc` count unchanged; manual applicant submit.
- **Stop condition:** any need to change token format or add auth beyond the existing token.

### SEGMENT 02 — Dedicated invitation signing secret, fail closed
- **Problem:** F-023 secret fallback to the email API key.
- **Exact scope:** `signingSecret()` requires `TES_INVITATION_SECRET`; no fallback.
- **Files expected to change:** `lib/driver-invitation-token.ts`, one test.
- **Out of scope:** payload contents, revocation (D-09).
- **Dependencies:** the user must set `TES_INVITATION_SECRET` in the hosting environment before deploy (user action; not done by this segment). Parallel-safe with 01.
- **Implementation actions:** remove `|| process.env.RESEND_API_KEY`; clear error when missing.
- **Regression risks:** invitations signed before the change become invalid (they were signed with the Resend key).
- **Acceptance criteria:** missing secret fails closed; token created and verified with the new secret.
- **Tests/checks:** unit test create/verify; missing-secret test.
- **Stop condition:** if existing outstanding invitations must remain valid, stop and ask (dual-secret verification window).

### SEGMENT 03 — send-invitation: input caps and sanitized errors (interim hardening)
- **Problem:** F-001 partial: unbounded input, internal error text returned.
- **Exact scope:** length caps on all string fields; generic client error for 5xx; provider errors mapped to stable messages; no behavior change for valid requests.
- **Files expected to change:** `app/api/driver-applications/send-invitation/route.ts`, one test.
- **Out of scope:** authentication (SEG05), email template.
- **Dependencies:** none. Does **not** close the open-relay risk; that needs D-01.
- **Regression risks:** overly tight caps rejecting real company data.
- **Acceptance criteria:** oversize input → 400; thrown errors never echo internal messages.
- **Tests/checks:** unit test with oversize body and forced failure.
- **Stop condition:** if caps need product input, ask.

### SEGMENT 04 — document-ai route: size, type and page limits
- **Problem:** F-004 unbounded paid processing.
- **Exact scope:** apply the intake route's size cap and MIME allowlist plus a maximum page count and chunk count.
- **Files expected to change:** `app/api/document-ai/route.ts`, one test (and optionally a shared constants module if reuse is simpler than duplicating, which then adds one file).
- **Out of scope:** auth, processor config, chunking logic.
- **Dependencies:** none. Parallel-safe.
- **Regression risks:** legitimately large roadside bundles; choose the cap with the user.
- **Acceptance criteria:** oversize/unsupported/too-many-pages rejected before any Google request.
- **Tests/checks:** unit tests; manual 15-page and 16-page PDFs.
- **Stop condition:** page cap conflicts with the documented chunking use case.

### SEGMENT 05 — Server-side caller gate for all API routes (BLOCKED by D-01)
- **Problem:** F-001, F-002, F-004, F-005 GET.
- **Exact scope:** one `requireCaller()` helper and its application to the 5 routes; `companyId` derived from membership.
- **Files expected to change:** new helper, 5 route files, tests (7+ files: justified because the gate is only meaningful applied to all routes at once).
- **Out of scope:** page-level changes.
- **Dependencies:** **D-01.** **Do not start.**
- **Acceptance criteria:** unauthenticated requests to all routes return 401/403.
- **Stop condition:** auth design not decided.

### SEGMENT 06 — Companies and customers: archive instead of hard delete
- **Problem:** F-003.
- **Exact scope:** replace `handleDelete` on both pages with an archive action (status flag), hide archived by default, keep stores untouched.
- **Files expected to change:** `app/companies/page.tsx`, `app/customers/page.tsx`.
- **Out of scope:** cascades, restore UI beyond a simple toggle.
- **Dependencies:** D-02 (low controversy; the repo convention is archive). Parallel-safe with 07–10.
- **Regression risks:** other pages that list companies must respect the archived flag (check `readCompanies` consumers).
- **Acceptance criteria:** archived company disappears from lists but all of its stores remain.
- **Tests/checks:** manual archive/restore; grep that no `removeItem`/filter-delete of `tes_companies` remains.
- **Stop condition:** a consumer cannot tolerate an archived company.

### SEGMENT 07 — Insurance: remove simulated OCR prefill
- **Problem:** F-007 insurance.
- **Exact scope:** `handleStartOCRWorkflow` opens an empty review draft (or manual-entry state); remove fabricated values; remove `|| ocrDraft.x` fallbacks that restore cleared fields.
- **Files expected to change:** `app/companies/[id]/insurance/page.tsx`.
- **Out of scope:** real extraction, directory resolution logic.
- **Dependencies:** D-08 (trivial). Parallel-safe.
- **Regression risks:** the review dialog assumes populated defaults.
- **Acceptance criteria:** an upload yields an empty draft; no organisation/contact is created until the user types values; an emptied field stays empty.
- **Tests/checks:** manual upload; check `tes_contacts_v5` unchanged until commit.
- **Stop condition:** commit logic depends on prefilled values in more places than expected.

### SEGMENT 08 — Citations: remove simulated OCR values
- **Problem:** F-007 citations.
- **Exact scope:** drop fabricated `reportNumber`, officer name and badge in `handleFileUpload`.
- **Files expected to change:** `app/companies/[id]/citations/page.tsx`.
- **Out of scope:** the rest of the citation form.
- **Dependencies:** none. Parallel-safe.
- **Acceptance criteria:** uploaded evidence yields blank fields.
- **Tests/checks:** manual.
- **Stop condition:** form validation requires a non-empty report number to proceed (then discuss).

### SEGMENT 09 — Contacts: remove simulated licence OCR
- **Problem:** F-007 contacts.
- **Exact scope:** `simulateOCRExtraction` no longer returns a fixed person or `verified` status.
- **Files expected to change:** `src/components/contacts/contact-helpers.ts`, `app/companies/[id]/contacts/page.tsx`.
- **Dependencies:** none. Parallel-safe.
- **Acceptance criteria:** upload produces an empty draft with evidence status not `verified`.
- **Tests/checks:** manual; grep for the hardcoded names.
- **Stop condition:** other components import the simulator's output shape.

### SEGMENT 10 — Dashboard and `/drivers`: remove invented KPIs
- **Problem:** F-008.
- **Exact scope:** replace literal KPI values with an explicit "not calculated" state; remove invented discovery items and the inert "Add driver" button.
- **Files expected to change:** `app/page.tsx`, `components/discovery-feed.tsx`, `app/drivers/page.tsx`.
- **Out of scope:** building real KPI calculations.
- **Dependencies:** none. Parallel-safe.
- **Acceptance criteria:** no hardcoded numeric KPI or named person remains.
- **Tests/checks:** grep; visual check.
- **Stop condition:** a real calculation is wanted in the same change (separate segment).

### SEGMENT 11 — Invitation: do not overwrite the shared master email before send
- **Problem:** F-006 ordering.
- **Exact scope:** move `updateDriverMasterIdentity({email})` to after provider acceptance; do not overwrite a non-empty master email with a different value silently (require explicit confirmation or keep the master value and record the invitation recipient only).
- **Files expected to change:** `src/components/drivers/DriverWorkspace.tsx`.
- **Out of scope:** history/attribution (SEG12).
- **Dependencies:** none. Must precede 17 and 18 (same file).
- **Regression risks:** the Existing-Driver check keys on master email.
- **Acceptance criteria:** failed send leaves master email unchanged.
- **Tests/checks:** simulate a failed send; compare master store before and after.
- **Stop condition:** product wants a different overwrite policy (D-03).

### SEGMENT 12 — DriverMaster identity change history and attribution (BLOCKED by D-03)
- **Problem:** F-006.
- **Exact scope:** effective-dated or logged identity change with old/new, actor, company.
- **Files expected to change:** `lib/driver-data.ts`, `types/drivers.ts`, tests (3–4).
- **Dependencies:** D-03. **Do not start.**
- **Stop condition:** policy undecided.

### SEGMENT 13 — Submission repository: honest errors and atomic write
- **Problem:** F-010 error semantics.
- **Exact scope:** read errors other than "file not found" propagate; `GET` returns 5xx on read failure; `POST` distinguishes immutability conflict (409) from storage failure (500); unique temp file and a serialization lock.
- **Files expected to change:** `lib/server/driver-application-submission-repository.ts`, `app/api/driver-applications/submissions/route.ts`, test.
- **Out of scope:** replacing the file store (D-04).
- **Dependencies:** none; do after 01 (same route file).
- **Acceptance criteria:** forced filesystem failure → 500 on both verbs; two concurrent saves both persist.
- **Tests/checks:** unit tests with a temp directory and injected failure.
- **Stop condition:** locking requires a new dependency.

### SEGMENT 14 — Applicant submit idempotency
- **Problem:** F-015.
- **Exact scope:** persist pending `submittedAt`/`receiptId` before POST; reuse on retry.
- **Files expected to change:** `app/driver-application/applicant-application-store.ts`.
- **Dependencies:** none (after 01 touches the same file, do sequentially).
- **Acceptance criteria:** retry after a simulated dropped response succeeds with the original receipt.
- **Tests/checks:** unit test of the store with a mocked fetch.
- **Stop condition:** none expected.

### SEGMENT 15 — Applicant file requirement: say what is true (BLOCKED by D-05)
- **Problem:** F-009.
- **Exact scope:** until uploads exist, label file selections as "not uploaded" and do not count them as complete, or block submission per D-05.
- **Files expected to change:** `DriverApplicationWorkspace.tsx`, possibly the entry page.
- **Dependencies:** D-05. **Do not start.**

### SEGMENT 16 — Derived invitation expiry display
- **Problem:** F-011.
- **Exact scope:** one pure helper `effectiveApplicationStatus(application, now)`; show "Invitation expired" when `Invited` and `invitationExpiresAt < now`; relabel "Invited" as "Invitation accepted by email provider". Do not store the derived value.
- **Files expected to change:** one new helper module, `DriverDocumentsTab.tsx` (or wherever status renders), one test (3 files).
- **Dependencies:** none. Parallel-safe.
- **Acceptance criteria:** expired invitations show as expired with no store write.
- **Tests/checks:** unit test around the boundary.
- **Stop condition:** status is rendered in more than 2 places, so list them first.

### SEGMENT 17 — Invitation retry reuses the pending record
- **Problem:** F-016.
- **Exact scope:** `handleCreateApplication` reuses an existing `Invitation Ready` application for the same driver instead of creating another.
- **Files expected to change:** `src/components/drivers/DriverWorkspace.tsx`.
- **Dependencies:** after SEG11.
- **Acceptance criteria:** repeated failures plus one success yield one application.
- **Tests/checks:** manual with a forced failure (invalid API key in a local run).
- **Stop condition:** none.

### SEGMENT 18 — Evidence write ordering
- **Problem:** F-012 (partial write).
- **Exact scope:** store the payload first, then the metadata; on payload failure create no metadata; on metadata failure remove the payload.
- **Files expected to change:** `src/components/drivers/DriverWorkspace.tsx` (`handleSelectFile`), possibly `lib/driver-data.ts`.
- **Dependencies:** after SEG17 (same file).
- **Acceptance criteria:** failing `putEvidencePayload` leaves no evidence item.
- **Tests/checks:** inject a failing IndexedDB in a unit test or manual quota simulation.
- **Stop condition:** payload id depends on metadata id (then allocate the id first, in the caller).

### SEGMENT 19 — Wire driver evidence to quarantine intake (BLOCKED by D-01, D-04, D-05)
- **Problem:** F-012.
- **Dependencies:** D-01, D-04, D-05. **Do not start.** A design pass is required first.

### SEGMENT 20 — MaintenanceTab `inputClass` ReferenceError
- **Problem:** F-014.
- **Exact scope:** declare/receive `inputClass` in the two panel components.
- **Files expected to change:** `src/components/vehicles/maintenance/MaintenanceTab.tsx`.
- **Dependencies:** none. Parallel-safe.
- **Acceptance criteria:** the add-finding and add-maintenance-item forms render; `tsc` TS2304 count drops by 5.
- **Tests/checks:** `tsc` diff; manual open of both forms.
- **Stop condition:** the prop threading touches the parent signature in more than one place.

### SEGMENT 21 — Error boundaries
- **Problem:** F-014 (no recovery).
- **Exact scope:** add `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` with a recoverable message.
- **Files expected to change:** 3 new files.
- **Dependencies:** none. Parallel-safe.
- **Acceptance criteria:** a thrown render error shows a recovery screen, not a blank page.
- **Tests/checks:** temporary throw in a dev build (reverted).
- **Stop condition:** none.

### SEGMENT 22 — Single `DriverStatus` list
- **Problem:** F-020.
- **Exact scope:** one exported list including `Not Established`; Profile tab and taxonomy import it.
- **Files expected to change:** `lib/driver-taxonomy.ts`, `src/components/drivers/DriverProfileTab.tsx`.
- **Dependencies:** none. Parallel-safe.
- **Acceptance criteria:** a `Not Established` driver shows that value in the editor.
- **Tests/checks:** manual; `tsc` unchanged.
- **Stop condition:** other consumers of the taxonomy list rely on the 5-item list.

### SEGMENT 23 — Ownerless evidence must not appear for every driver
- **Problem:** F-021.
- **Exact scope:** change the fallthrough `return true` and report what keyless records exist.
- **Files expected to change:** `app/companies/[id]/drivers/[driverId]/page.tsx`.
- **Dependencies:** first inspect which stored records lack `driverMasterId` (verification step, no change).
- **Acceptance criteria:** keyless evidence appears for no driver.
- **Tests/checks:** seed a keyless record; verify.
- **Stop condition:** legitimate company-level evidence relies on the fallthrough.

### SEGMENT 24 — Events require an active relationship; auto-save uses the invoking company
- **Problem:** F-019.
- **Exact scope:** `addPerformanceEvent` throws when no active relationship exists; `autoSaveRoadsideInspection` takes the company from the caller and treats a different resolved company as REVIEW_REQUIRED.
- **Files expected to change:** `lib/driver-data.ts`, `lib/auto-save-roadside.ts`, `lib/ingestion-entity-resolver.ts`, and one test (4 files).
- **Dependencies:** none.
- **Acceptance criteria:** no event is created without a relationship; company mismatch → REVIEW_REQUIRED.
- **Tests/checks:** unit tests for both.
- **Stop condition:** existing flows create events before relationships legitimately.

### SEGMENT 25 — `createDriver` enforces the existing-driver check
- **Problem:** F-017.
- **Exact scope:** require a check key (and resolution) argument that `createDriver` re-verifies by recomputing the match.
- **Files expected to change:** `lib/driver-data.ts`, `app/companies/[id]/drivers/page.tsx`, test.
- **Dependencies:** none.
- **Acceptance criteria:** direct `createDriver` without a valid key fails.
- **Tests/checks:** unit test; the Add Driver flow still works.
- **Stop condition:** other callers must be enumerated first (DriverList is unreachable).

### SEGMENT 26 — Local-date helper
- **Problem:** F-022 (primitive).
- **Exact scope:** add `todayLocalISO()` (and tests around midnight/timezone) to `lib/driver-date.ts`; no adoption yet.
- **Files expected to change:** `lib/driver-date.ts`, one test.
- **Dependencies:** none. Parallel-safe.
- **Acceptance criteria:** at 22:00 local the helper returns the local date.
- **Tests/checks:** unit test with a fixed timezone.
- **Stop condition:** none.

### SEGMENT 27 — Adopt the helper (repeat per module as separate commits: a drivers, b vehicles, c insurance, d tax/authorities, e citations/contacts/business/profile)
- **Problem:** F-022.
- **Exact scope:** replace `toISOString().slice(0,10)` used as "today" in the named module only.
- **Files expected to change:** 1–6 per sub-segment (the module's own files).
- **Dependencies:** SEG26. Sub-segments are parallel-safe with each other.
- **Acceptance criteria:** no UTC-based "today" in that module.
- **Tests/checks:** grep; manual at an evening time via a timezone override.
- **Stop condition:** a site uses the UTC date intentionally (leave it, annotate).

### SEGMENT 28 — Applicant draft defaults: blank, not "not-applicable"
- **Problem:** F-028 applicant.
- **Exact scope:** default `workPermitConditions` and `failedRehabilitationOrReturnToDuty` to `""`; readiness requires an answer only where the question applies.
- **Files expected to change:** `applicant-application-store.ts`, `DriverApplicationWorkspace.tsx`.
- **Dependencies:** none (coordinate with 14/01, same store file).
- **Acceptance criteria:** an unanswered question is stored as unanswered.
- **Tests/checks:** manual flow for a Citizen and a Work Permit holder.
- **Stop condition:** the conditional visibility logic is larger than expected.

### SEGMENT 29 — `identityResolution` honest at creation
- **Problem:** F-028 identity.
- **Exact scope:** new masters start `UNREVIEWED`; the residence-vs-licence jurisdiction mismatch still opens a jurisdiction review.
- **Files expected to change:** `lib/driver-data.ts`, test.
- **Dependencies:** none.
- **Acceptance criteria:** no master is `CLEAR` without a review action.
- **Tests/checks:** unit test; check consumers of `CLEAR`.
- **Stop condition:** consumers treat `UNREVIEWED` as blocking.

### SEGMENT 30 — Remove contradictory "Invite Applicant" alert
- **Problem:** F-024.
- **Exact scope:** remove the dead button from the list page (or navigate to the driver where the real invitation lives).
- **Files expected to change:** `app/companies/[id]/drivers/page.tsx`.
- **Dependencies:** none. Coordinate with whoever edits this file concurrently.
- **Acceptance criteria:** no UI states that invitation is disabled.
- **Tests/checks:** visual.
- **Stop condition:** concurrent edits conflict (rebase first).

### SEGMENT 31 — Reads must not create stores for unknown companies
- **Problem:** F-025.
- **Exact scope:** `hydrate` runs only after the company exists; `loadCompanyDriverStore` does not persist for an id absent from `tes_companies`.
- **Files expected to change:** `lib/driver-data.ts`, `app/companies/[id]/drivers/page.tsx`.
- **Dependencies:** none.
- **Acceptance criteria:** visiting `/companies/XYZ/drivers` writes no key.
- **Tests/checks:** `localStorage` diff.
- **Stop condition:** a legitimate flow relies on first-load creation (new company).

### SEGMENT 32 — Company status: unknown is not Active
- **Problem:** F-028/F-031.
- **Exact scope:** header and edit form show/keep Unknown when status is unset.
- **Files expected to change:** `app/companies/[id]/drivers/page.tsx`, `app/companies/[id]/edit/page.tsx`.
- **Dependencies:** none.
- **Acceptance criteria:** saving the edit form never writes `Active` unless chosen.
- **Tests/checks:** manual.
- **Stop condition:** status is required by the schema elsewhere.

### SEGMENT 33 — Archived relationship banner / read-only
- **Problem:** F-030.
- **Exact scope:** when the resolved relationship is archived, show a banner and disable edits.
- **Files expected to change:** `app/companies/[id]/drivers/[driverId]/page.tsx`, `DriverWorkspace.tsx` (2 files).
- **Dependencies:** none.
- **Acceptance criteria:** archived relationships cannot be edited.
- **Tests/checks:** manual.
- **Stop condition:** workspace has many editing entry points (list them first).

### SEGMENT 34 — Driver audit events carry actor and company
- **Problem:** F-013 (attribution).
- **Exact scope:** `auditDriverMutation` takes the actor from `getCurrentUser()` and requires a companyId.
- **Files expected to change:** `lib/driver-data.ts`.
- **Dependencies:** D-01 for a real actor; the helper works today with the hardcoded user.
- **Acceptance criteria:** no driver audit event has an empty actor.
- **Tests/checks:** unit test of the emitted event.
- **Stop condition:** identity edits have no company context by design (then flag).

### SEGMENT 35 — Remove dead `lib/audit.ts` (after confirmation) (BLOCKED by D-06 for the consolidation; the removal itself is independent)
- **Problem:** F-013/F-035.
- **Files expected to change:** `lib/audit.ts` (delete).
- **Dependencies:** confirm zero importers again at execution time.
- **Acceptance criteria:** build and tsc unchanged.
- **Stop condition:** an importer appears.

### SEGMENT 36 — Untrack bundles and build info
- **Problem:** F-033.
- **Exact scope:** `git rm --cached` for `repo_bundle.md`, `repomix-output.xml`, `tsconfig.tsbuildinfo`; add to `.gitignore` (and fix the mangled line).
- **Files expected to change:** `.gitignore` plus the three index removals (the files remain on disk).
- **Dependencies:** none.
- **Acceptance criteria:** the files are untracked and ignored.
- **Tests/checks:** `git ls-files`.
- **Stop condition:** the user wants the snapshots retained in history only (then leave).

### SEGMENT 37 — Guard development reference routes
- **Problem:** F-033.
- **Exact scope:** return not-found in production for `design-system` and `design-system-reference`.
- **Files expected to change:** 2 page files.
- **Dependencies:** none.
- **Acceptance criteria:** production build returns 404 for both.
- **Tests/checks:** `next build` plus start.
- **Stop condition:** the design system pages are intentionally public.

### SEGMENT 38 — Remove PII console logging
- **Problem:** F-034.
- **Exact scope:** delete the `console.log` calls that serialize extraction results.
- **Files expected to change:** `src/components/drivers/DriverWorkspace.tsx`.
- **Dependencies:** after SEG18 (same file).
- **Acceptance criteria:** none of the three JSON-stringify logs remain.
- **Tests/checks:** grep.
- **Stop condition:** none.

### SEGMENT 39 — Delete confirmed-dead modules
- **Problem:** F-035.
- **Exact scope:** remove `lib/asset-validation.ts`, `lib/expiry-rules.ts`, `emptyVehicleDraft` and `getDefaultSeedVehicles`, and the unreachable create path in `DriverList.tsx`.
- **Files expected to change:** `lib/asset-validation.ts`, `lib/expiry-rules.ts`, `lib/vehicle-data.ts`, `src/components/drivers/DriverList.tsx` (4).
- **Dependencies:** re-verify zero callers at execution time; user confirmation before deletion.
- **Acceptance criteria:** build passes, tsc diagnostic count does not rise (it should fall).
- **Tests/checks:** grep, build, tsc.
- **Stop condition:** any caller found.

### SEGMENT 40 — Typecheck baseline gate
- **Problem:** F-018.
- **Exact scope:** a script that runs `tsc --noEmit --incremental false` and fails if the count exceeds a recorded baseline (139 today); no config or lockfile change.
- **Files expected to change:** `scripts/typecheck-baseline.mjs`, a baseline file, and a `package.json` script entry (3 files; the `package.json` edit is a script line only).
- **Dependencies:** none.
- **Acceptance criteria:** adding a type error fails the script.
- **Tests/checks:** run before and after introducing a deliberate error (reverted).
- **Stop condition:** the user does not want `package.json` touched.

### SEGMENT 41 — Fix unresolved type-only imports (TS2307)
- **Problem:** F-018.
- **Exact scope:** correct the six relative import paths (`../types`, `../../types/*`).
- **Files expected to change:** `lib/deadline-engine.ts`, `lib/vehicle-data.ts`, `src/components/shared/{EntityLink,EntityPicker,EvidencePanel,OCRReview}.tsx` (6).
- **Dependencies:** none.
- **Acceptance criteria:** TS2307 count 0; no new diagnostics; the types start being enforced, which may surface new TS errors that are then recorded in the baseline.
- **Tests/checks:** `tsc`, build.
- **Stop condition:** fixing the paths surfaces more than ~20 new errors (then split).

### SEGMENT 42 — CRLF-robust static test
- **Problem:** F-037.
- **Exact scope:** normalize line endings before slicing in the one failing test.
- **Files expected to change:** `test/lib/ingestion/object-paths.test.ts`.
- **Dependencies:** none. Parallel-safe.
- **Acceptance criteria:** the test passes with LF and CRLF copies.
- **Tests/checks:** run the suite.
- **Stop condition:** none.

### SEGMENT 43 — Canonical Company type and address accessor (BLOCKED by D-07)
- **Problem:** F-026. **Dependencies:** D-07. **Do not start.**

### SEGMENT 44 — Company-scoped contact access (BLOCKED by D-01)
- **Problem:** F-027. **Dependencies:** D-01. **Do not start.**

### SEGMENT 45 — Versioned writes / system of record (BLOCKED by D-04)
- **Problem:** F-010 (replace), F-029, F-038. **Dependencies:** D-04. **Do not start.**

### SEGMENT 46 — Modal and destructive-confirmation consistency (incremental, one modal/page per commit)
- **Problem:** F-032.
- **Exact scope:** migrate a single hand-rolled modal or native `confirm()` per commit to the shared Dialog; start with destructive confirmations.
- **Files expected to change:** 1–2 per commit.
- **Dependencies:** none. Each commit is parallel-safe with others unless it touches the same page.
- **Acceptance criteria:** the targeted dialog has focus trap, Escape, backdrop and `role="dialog"`.
- **Tests/checks:** manual per dialog.
- **Stop condition:** a dialog depends on bespoke layout.

### SEGMENT 47 — Retire the legacy Google credential variable (user/operations task, no code)
- **Problem:** F-036.
- **Exact scope:** after confirming nothing uses `GOOGLE_APPLICATION_CREDENTIALS_JSON`, revoke that key and remove the variable from the local and hosting environments.
- **Files expected to change:** none in the repo.
- **Dependencies:** user authorization (GCP/Vercel changes are outside this assistant's remit unless explicitly granted).
- **Acceptance criteria:** the variable is absent and the app still authenticates locally and in production.
- **Tests/checks:** local ADC run; production request to a Google-backed route.
- **Stop condition:** any consumer is found.

---

### Segment index

| Parallel group | Segments |
|---|---|
| First (independent, security) | 01, 02, 03, 04 |
| Immediately after (crash/recovery, independent) | 20, 21 |
| Data-truth cluster (independent of each other) | 06, 07, 08, 09, 10, 16, 22, 26, 36, 37, 42 |
| Same-file sequences (do in order) | `DriverWorkspace.tsx`: 11 → 17 → 18 → 38; `applicant-application-store.ts`: 01 → 14 → 28; `submissions/route.ts`: 01 → 13; `drivers/page.tsx`: 30 → 31 → 32 |
| Mid-risk | 23, 24, 25, 29, 33, 34, 35, 39, 40, 41 |
| Blocked on decisions | 05 (D-01), 12 (D-03), 15 (D-05), 19 (D-01/D-04/D-05), 43 (D-07), 44 (D-01), 45 (D-04) |
| Operations/user | 47 |
| Incremental | 27a–e, 46 |

**Total: 47 segments** (7 blocked on decisions; 1 operations task; two segments, 27 and 46, are repeated per module/dialog).
