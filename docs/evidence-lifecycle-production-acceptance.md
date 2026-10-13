# Evidence lifecycle: production acceptance plan

Infrastructure gates for migration 0032 are closed (ledger 32; storage configuration verified). This plan covers what remains before
customer evidence intake may be called production-ready. Nothing here has been executed in production.

## Owner action checklist (all require owner access; none needs a password, key or secret value)

1. **Vercel** (Project > Settings > Environment Variables, scope *Production*): confirm these exist, and record names only: `GOOGLE_CLOUD_PROJECT_ID`
   (`tes-production-510007`), `GOOGLE_CLOUD_PROJECT_NUMBER`, `GOOGLE_GCS_QUARANTINE_BUCKET` (`tes-production-quarantine`),
   `GOOGLE_GCS_INTAKE_BUCKET` (`tes-production-intake`), `GOOGLE_GCS_EVIDENCE_BUCKET` (`tes-production-evidence`), `GOOGLE_WIF_POOL_ID`,
   `GOOGLE_WIF_PROVIDER_ID`, `GOOGLE_BACKEND_SERVICE_ACCOUNT`, `GOOGLE_WIF_OIDC_AUDIENCE`, `TES_CLOUD_SQL_INSTANCE`, `TES_POSTGRES_DATABASE`,
   `TES_POSTGRES_IAM_USER`. There must be no `GOOGLE_PRIVATE_KEY`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `GCS_KEY`, or `NEXT_PUBLIC_*`
   variable naming a bucket.
2. **Vercel** (Project > Deployments): record the Production deployment's commit SHA and status. It must be `17e581c` or later (this branch's
   merge once approved), *Ready*, and built after 2026-10-13 09:16 UTC.
3. **Google Cloud** (IAM > Service accounts): record the service account in `GOOGLE_BACKEND_SERVICE_ACCOUNT` (portal backend) and the
   scanner account (`tes-security-scanner@tes-production-510007.iam.gserviceaccount.com` per the scanner README).
4. **Google Cloud** (Storage > each bucket > Permissions): expected bindings, and nothing broader:
   | Bucket | Portal backend SA | Scanner SA |
   | --- | --- | --- |
   | quarantine | `storage.objects.create` only | `storage.objects.get` |
   | intake | `storage.objects.get` only | `storage.objects.create`, `get` (read-back) |
   | evidence | `storage.objects.create`, `get` | none |
   Also confirm: no project-level Storage Admin/Object Admin/Owner/Editor on either account; no user-managed keys on either account
   (IAM > Service accounts > Keys); no `allUsers`/`allAuthenticatedUsers`.
5. **Google Cloud Run**: confirm service `document-security-scanner` exists, is *not* publicly invokable (no `allUsers` invoker), runs as the
   scanner SA, and `/health/ready` reports ready (ClamAV signatures loaded). Deploy it if it does not exist.
6. **Google Cloud Eventarc**: confirm a trigger of type `google.cloud.storage.object.v1.finalized` on bucket `tes-production-quarantine` targets that
   service, uses a dedicated invoker SA holding only `run.invoker` on it, and has retry enabled.
7. **Google Cloud Logging**: a log-based alert on scanner `UNABLE_TO_SCAN` / `requesting redelivery` and on Cloud Run 5xx for the scanner.
8. **Stalled-payload detection**: `auditEvidencePayloads` needs `storage.objects.list`, which the portal backend deliberately lacks. Decide who runs
   it (an operator identity, or a scheduled job with a dedicated list-only SA) and how its findings are escalated. Not implemented.
9. **Smoke-test approval** (below): name the non-customer test organization, the test identities and the scope.

## Production smoke-test plan (not started; needs item 9)

Prerequisites: items 1-7 confirmed; a dedicated non-customer organization (state its id and why it has no customer data); an actor with
`EVIDENCE_MANAGE`+`EVIDENCE_READ`; an actor with no evidence capability; a second non-customer organization (cross-tenant); a harmless PDF
(plus the standard EICAR test string in a `.pdf`-named file, which a conforming scanner must not clear).

| # | Step | Expected | Failure condition |
| --- | --- | --- | --- |
| 1 | Upload the PDF in the Evidence panel as the manager | 201 `quarantined`; row in `evidence_payloads`; object `quarantine/{org}/{batch}/{file}/source`; Master Register event | any other state, or an object outside quarantine |
| 2 | Wait for the scanner | scan log with `CLEARED`; object `intake/{org}/{batch}/{file}/source` with the same SHA-256 | still quarantined after the Eventarc retry window |
| 3 | Finalize (panel action) | state `stored`; `evidence/{org}/{doc}/source` created create-only; `verified_sha256` set | hash mismatch, or an overwrite |
| 4 | View as the manager | inline bytes; one `evidence_payload_access_events` row and a `RECORD_VIEWED` Master Register event written before the bytes | no audit row |
| 5 | View as the actor with no capability | 403, no storage call, no audit row for bytes | any bytes returned |
| 6 | Request the document under the other organization id | 404/403 | any bytes returned |
| 7 | Upload the EICAR file | never reaches intake; payload stays `quarantined` (scanner `THREAT_DETECTED`) | reaches intake or evidence |
| 8 | Stop the scanner (or break ClamAV) and upload | scanner returns 503 and Eventarc redelivers; clears after recovery | acknowledged and stuck |
| 9 | Re-deliver step 2's event | idempotent: `ALREADY_EXISTS_VERIFIED_IDENTICAL`, no second object | duplicate or overwritten object |
| 10 | Legacy routes: call `/api/document-ai` as the no-capability actor | 403 | 200 |

Archival, not deletion: archive the test documents through the panel (`archived` is terminal and keeps the payload); evidence rows and
objects are never deleted, and the evidence bucket is versioned. Record the object names and document ids in the acceptance report.
