# Universal driver hiring application (migration 0041)

One application engine for every operating scenario. A single, versioned catalogue (`lib/driver-application/catalogue`) holds every question, authorization, verification requirement and legal source. The server-side resolver (`plan.ts`) selects from it for the driver's **operating scope** (US intrastate / interstate, Canada intraprovincial / interprovincial, cross-border from either country's carrier), the carrier's **HR configuration**, and the **collection stage**. The resolved plan is hashed (SHA-256 of canonical JSON) and **frozen with the invitation**; the application, its snapshot and its PDF all name the exact catalogue, rules and plan versions they were produced under.

## Layers
- **Regulatory / operational**: questions and checks that follow from the operation (history years, Clearinghouse, PSP intent, DOT history, medical, licence).
- **Carrier HR**: optional items from a legal matrix (ALLOWED / RESTRICTED / PROHIBITED by country × stage; cross-border applies the strictest). Prohibited items cannot be enabled; restricted ones need an explicit acknowledgement.
- **Stages**: `PRE_OFFER`, `CONDITIONAL_OFFER`, `POST_OFFER`. A later stage is a **separate supplementary application** that references the original; the original is never edited.

## Applicant access
Invitation secret (in the URL **fragment**, never sent to a server in a URL) → server-side session (HttpOnly, SameSite=Strict cookie; only a hash is stored) + CSRF header. Each invitation gets its own applicant actor, so Master Register entries are individually attributable. The applicant has **no table access**: every read and write is a `SECURITY DEFINER` function bound to the transaction-local session. Rate limits are persistent in PostgreSQL. Drafts autosave to PostgreSQL with optimistic concurrency; submit is validated on the server, idempotent, and issues the receipt and timestamp in the database.

## Evidence, authorizations, PDF
- Uploads use the existing quarantine → scanner → intake → evidence pipeline (tenant-scoped object keys, SHA-256 re-verification).
- Every authorization is presented (text + SHA-256 + purpose + scope + parties) and then signed by affirmative action plus typed name. Rows are append-only.
- The signed PDF is generated deterministically from the stored snapshot (fixed metadata dates, standard fonts, no random ids), stored as `DRIVER_APPLICATION_PDF` evidence and attached once. Sensitive identifiers are never in it.

## Employer review
Submission never qualifies anyone. Per-requirement verification outcomes (`DECLARED`, `EVIDENCE_RECEIVED`, `PENDING`, `VERIFIED`, `EXCEPTION`, `REJECTED`), corrections and the qualification decision are separate, append-only, attributed records. `VERIFIED` is refused where the relied-on authorization is missing, revoked or **pending legal review**; `QUALIFIED` needs every required check verified or a recorded, acknowledged exception. Approving a prospect requires a `QUALIFIED` decision on each submitted application.

## What is intentionally OFF until others act
1. **Authorization wording** is draft: every text is `PENDING_LEGAL_REVIEW` and every legal source is `UNVERIFIED_BY_COUNSEL`. Counsel-approved text must replace it in the catalogue (new version) before reliance. TES consent never replaces the FMCSA Clearinghouse full-query consent or the standalone PSP disclosure/authorization; those are recorded as external processes.
2. **Sensitive identifiers** (SSN, SIN, passport number) are not collected until BOTH `TES_SENSITIVE_DATA_KEY` (+`TES_SENSITIVE_DATA_KEY_ID`) is configured AND each field is listed in `TES_SENSITIVE_FIELDS_APPROVED` after legal approval. Staff read needs the separate `DRIVER_SENSITIVE_READ` capability and every reveal is recorded. The key is currently an environment secret; wrapping it with Cloud KMS is a recommended hardening step.
3. Provincial/state specifics, cross-border applicability and retention periods are listed as **regulatory review requirements** on each plan; TES does not evaluate them.
