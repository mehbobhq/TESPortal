# Evidence lifecycle: production acceptance

Infrastructure gates for migration 0032 are closed (ledger 32; storage configuration verified). This document separates what must happen
before PR #17 merges, what the owner must configure in production, and what the owner must approve before any production test data exists.
Nothing here has been executed in production.

## A. Code changes needed before merge (this PR)
- Legacy OCR routes closed by default; temporary, expiring exception required for any use (`lib/legacy-ocr/`, tests in `test/lib/legacy-ocr/`).
- Scanner redelivery restricted to transient failures and bounded by object age (`services/document-security-scanner/src/retry.ts`).
- Reproducible scanner deployment (`services/document-security-scanner/deploy/`). Not applied.
- Owner decision before merging: nobody needs to take an action for the routes to close; merging closes them on the next Vercel production
  build. Staff who use Corporate Documents OCR or roadside OCR will see the manual-review message until an exception is set or OCR of cleared
  evidence exists. If that interruption is unacceptable, set the exception date in Vercel *before* the deployment goes live.

## B. Production infrastructure configuration (owner access; no passwords, keys or secret values are needed)
1. **Vercel > Project > Settings > Environment Variables (Production):** names present: `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT_NUMBER`,
   `GOOGLE_GCS_QUARANTINE_BUCKET`, `GOOGLE_GCS_INTAKE_BUCKET`, `GOOGLE_GCS_EVIDENCE_BUCKET`, `GOOGLE_WIF_POOL_ID`, `GOOGLE_WIF_PROVIDER_ID`,
   `GOOGLE_BACKEND_SERVICE_ACCOUNT`, `GOOGLE_WIF_OIDC_AUDIENCE`, `TES_CLOUD_SQL_INSTANCE`, `TES_POSTGRES_DATABASE`, `TES_POSTGRES_IAM_USER`.
   Absent: `GOOGLE_PRIVATE_KEY`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `GCS_KEY`, any `NEXT_PUBLIC_*` variable naming a bucket.
   Record whether `TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL` is set (it should not be unless section A's decision says so).
2. **Vercel > Deployments:** the Production deployment's commit SHA and status (`17e581c` or later, Ready, built after 2026-10-13 09:16 UTC).
3. **Google Cloud > IAM > Service accounts:** record `GOOGLE_BACKEND_SERVICE_ACCOUNT` and the scanner account; no user-managed keys on either.
4. **Google Cloud > Storage > each bucket > Permissions:** portal backend SA: quarantine `storage.objects.create` only; intake `storage.objects.get`
   only; evidence `storage.objects.create` and `get`. Scanner SA: quarantine `get`; intake `create` and `get`. No project-level Storage Admin,
   Object Admin, Owner or Editor on either account; no `allUsers` / `allAuthenticatedUsers`.
5. **Scanner deployment:** follow the sequence in `services/document-security-scanner/deploy/DEPLOYMENT.md`. Merge PR #17, set `REVIEWED_COMMIT` to the merged
   commit, run `deploy.sh` (read-only PLAN) and resolve every blocker by hand, confirm the discovered Eventarc location and your chosen Cloud Run `REGION`, then
   run `--apply --confirm PROJECT_ID:<12 chars> [--grant-project-roles]`. The two project-level grants (`roles/eventarc.eventReceiver` for the trigger identity,
   `roles/pubsub.publisher` for the Cloud Storage service agent) are the only project-wide roles and need that explicit flag. Enable any missing APIs first.
6. **Alerts:** the log-based alerts listed in `DEPLOYMENT.md`.
7. **Stalled-payload job:** decide who runs `auditEvidencePayloads` (it needs `storage.objects.list`, which the portal and scanner deliberately lack), with
   which identity, and who receives findings. Not implemented.

## C. Owner approval required before the production smoke test
Name, in writing: (1) the dedicated non-customer test organization id and why it holds no customer data; (2) a second non-customer organization for
cross-tenant denial; (3) the test identities (one with `EVIDENCE_MANAGE`+`EVIDENCE_READ`, one with no evidence capability); (4) which steps below are
approved to run in production. Also required: section B items 1-6 confirmed, and the nonproduction checks below passed.

## Test fixtures and what each proves
- **Harmless valid PDF** (normal clearance): generate a real one-page PDF at test time (for example with `pdf-lib`, already a dependency) so it has a
  valid structure, not just a `%PDF-` prefix. Proves upload validation, scan-clean, promotion and view.
- **Malware test fixture** (EICAR, generated at test time, never committed). Two different questions, kept apart:
  - *Upload validation* is the portal's job. It checks size, allowed MIME type and magic bytes, so a plain-text EICAR file is **rejected at
    upload** (400) and never reaches the scanner. That proves validation only, not malware detection.
  - *Malware detection* is ClamAV's job inside the scanner. To reach it through the portal the file must pass upload validation, for example a file
    that begins with `%PDF-` and contains the EICAR string. **Whether ClamAV flags that specific container is not assumed**: prove it first in
    nonproduction (below). If ClamAV does not flag it, record "malware detection through the portal path: not verified" and do not substitute a
    different claim.
  - The scanner's own `THREAT_DETECTED` path is also exercisable directly with the EICAR file (plain `.com`/text form) against a nonproduction
    scanner instance, since the scanner decides threat before file type.

## Nonproduction checks (no approval needed; no production data)
| # | Check | Expected |
| --- | --- | --- |
| N1 | Run the scanner container locally or in a staging project with the harmless PDF event | `CLEARED`, intake object created create-only, hashes equal |
| N2 | Same with the EICAR fixture (both plain and `%PDF-`-prefixed) | `THREAT_DETECTED` for each form ClamAV recognizes; record exactly which forms were flagged |
| N3 | Failure injection: stop `clamd` or make signatures unavailable in staging, send an event | HTTP 503 with `retry:true` while the object is younger than `SCANNER_MAX_RETRY_AGE_MS`; 200 once older |
| N4 | Replay the same event twice | second result `ALREADY_EXISTS_VERIFIED_IDENTICAL`; no second object; no overwrite |
| N5 | Pre-create a different object at the intake name, then send the event | `REVIEW_REQUIRED` with `ALREADY_EXISTS_HASH_MISMATCH`; acknowledged (200), not retried; nothing overwritten |

## Production smoke test (needs section C; archive, never delete)
| # | Step | Expected | Failure condition |
| --- | --- | --- | --- |
| P1 | Upload the generated harmless PDF in the Evidence panel as the manager | 201 `quarantined`; `evidence_payloads` row; object `quarantine/{org}/{batch}/{file}/source`; Master Register event | any other state, or an object outside quarantine |
| P2 | Wait for the scanner | log shows `CLEARED`; `intake/{org}/{batch}/{file}/source` exists with the same SHA-256 | still quarantined well past a normal scan time; see below |
| P3 | Finalize (panel action) | state `stored`; `evidence/{org}/{doc}/source` created create-only; `verified_sha256` set | hash mismatch, or an overwrite |
| P4 | View as the manager | inline bytes; one `evidence_payload_access_events` row and a `RECORD_VIEWED` Master Register event written before the bytes | no audit row |
| P5 | Request the same document as the actor with no capability | 403; no storage call; no byte-access audit row | any bytes returned |
| P6 | Request the document under the other organization's id | 404 or 403 | any bytes returned |
| P7 | Upload a plain-text EICAR file | rejected at upload (400); never reaches storage. **This tests upload validation only.** | stored in any bucket |
| P8 | *Only if N2 showed ClamAV flags the `%PDF-`-prefixed form:* upload that file | stays `quarantined`; scanner logs `THREAT_DETECTED`; nothing in intake | reaches intake or evidence |
| P9 | Legacy routes in the default configuration: call `/api/document-ai` and `/api/business-document-ocr` as the manager | 503 and the manual-review message; no Document AI call | 200 or any upstream call |

Not part of the routine production test: stopping or degrading the production scanner. A production resilience exercise (scanner outage, then
recovery within the retry window) is a separate exercise that needs its own owner approval, a maintenance window, and an agreed rollback; the
equivalent failure injection runs in nonproduction (N3). Nothing in this plan assumes Eventarc retries forever: if P2 does not complete, the
payload stays `quarantined` until an operator re-drives it, and `SCAN_STALLED` reporting requires the stalled-payload job (B7).

Archival: archive each test document through the panel (`archived` is terminal and keeps the payload); evidence rows and objects are never deleted
and the evidence bucket is versioned. Record every object name and document id in the acceptance report.
