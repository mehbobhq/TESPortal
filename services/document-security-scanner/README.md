# TES Document Security Scanner (Phase 1)

An isolated malware/security scanner for TES's production document
ingestion pipeline. This is a standalone deployable component (Google Cloud
Run, triggered by Eventarc) - it is not part of the Next.js portal, does not
depend on Vercel, and shares no code or `node_modules` with the root
application. Nothing in `app/`, `lib/google/`, or any other portal file was
modified to build this.

## Conceptual pipeline

```
External upload -> Quarantine -> Eventarc -> this scanner
  -> CLEARED   -> copy exact original bytes to Intake
  -> otherwise -> leave the source isolated in Quarantine (never promoted, never deleted)
```

OCR, classification, segmentation, entity resolution, and canonical record
creation must never operate on an uncleared quarantine object - this
service is the only thing that promotes a quarantine object to Intake, and
it does so only for a `CLEARED` result.

## Security decision vocabulary

TES does not use the word "REJECTED" anywhere in this service. Outcomes are:

- `CLEARED` - ClamAV reported clean AND the file's actual byte signature is
  one of TES's allowed families (PDF, JPEG, PNG, WebP, HEIC, HEIF) and is
  consistent with its claimed MIME type.
- `THREAT_DETECTED` - ClamAV identified a malware signature.
- `REVIEW_REQUIRED` - a clean scan on a file type TES does not recognize or
  trust as claimed. Not a legitimacy judgment about the document's content.
- `UNABLE_TO_SCAN` - a technical failure (download, scan-engine, oversized
  object). Never treated as clean. A scan failure is not proof of malice.

ClamAV is one layer, not the entire security decision - see
`src/decision.ts` for the exact precedence rules, and its extension points
for future checks (suspicious embedded content, active PDF content,
malformed-structure detection, additional engines) that are deliberately
not built in this phase.

## Persistence gap (explicitly documented, not solved here)

**This service does not persist `SecurityAssessment` records anywhere.**
Every assessment is returned from `assessQuarantineObject()` to the HTTP
handler, logged in sanitized form (see `src/logger.ts`'s field allowlist),
and then discarded. There is no database in this repository yet (matching
the rest of TES's current architecture). A future PostgreSQL layer -
already identified as needed by the Phase 2 architecture inspection for the
document-intake pipeline as a whole - is expected to persist this shape.
Do not treat the current log output as a durable record.

## Destination integrity verification (full SHA-256, now enabled)

The scanner's current bucket permissions are:

- Quarantine: `tes-security-scanner` -> Storage Object Admin
- Intake: `tes-security-scanner` -> Storage Object Creator **and Storage Object Viewer**

With Object Viewer now granted on Intake, every promotion path re-downloads
the destination object and re-hashes it with SHA-256, comparing against the
source hash computed from the quarantine bytes - the destination is never
assumed identical merely because a copy call succeeded or an object was
found to exist. See `src/integrity.ts`'s `resolvePromotionIntegrity` for the
exact, pure decision table:

| Promotion path | Hashes match | `PromotionStatus` | `SecurityDecision` |
|---|---|---|---|
| Freshly copied by this invocation | yes | `PROMOTED` | `CLEARED` |
| Freshly copied by this invocation | no | `PROMOTED_INTEGRITY_MISMATCH` | `REVIEW_REQUIRED` |
| Destination already existed (412 from the copy precondition) | yes | `ALREADY_EXISTS_VERIFIED_IDENTICAL` | `CLEARED` |
| Destination already existed (412 from the copy precondition) | no | `ALREADY_EXISTS_HASH_MISMATCH` | `REVIEW_REQUIRED` |

In every mismatch case: neither object is deleted, neither is overwritten or
"repaired," and both remain in place for investigation. The `ifGenerationMatch: 0`
precondition on the copy call is kept exactly as before - it remains the
mechanism that guarantees the destination is never overwritten, independent
of the now-available read permission.

If the destination cannot even be downloaded for verification (a transient
GCS error, for example), the outcome is `PromotionStatus: "FAILED"` /
`SecurityDecision: "REVIEW_REQUIRED"` with `INTEGRITY_CHECK_FAILED` - a
promotion is never silently reported as successful when its integrity
could not actually be confirmed.

## Signature update strategy (Phase 1 simplification - documented limitation)

- The Docker image runs `freshclam` once at **build time**, so the image
  ships with a working signature database and needs no network access to be
  usable at all.
- The container's `entrypoint.sh` makes one best-effort `freshclam` attempt
  at **startup**, bounded to 30 seconds, before starting the Node server. If
  it fails or times out, the server starts anyway using whatever database is
  already on disk (the build-time one, or a previously-fetched one).

**What this does NOT provide, and would need improvement for production
scale**:
- No guarantee of a *fresh* database on a long-lived Cloud Run instance -
  ClamAV signature updates are only fetched at container start, not
  periodically while an instance keeps running. A production design should
  add either a scheduled Cloud Run Job / Cloud Scheduler trigger that
  refreshes a shared, persisted database (e.g. in a mounted volume or GCS),
  or move to a managed ClamAV mirror strategy, so long-lived instances don't
  scan against a slowly-staling database.
- No shared database cache across instances - each cold-started instance
  redoes its own `freshclam` call, which is wasteful at any real scale and
  adds cold-start latency. A shared, centrally-updated database (fetched
  once, read by all instances) is the natural next step.
- The readiness check (`src/clamav.ts`'s `scannerReadiness()`) goes one step
  beyond confirming `clamscan` merely runs: it performs one real scan of a
  small, harmless, locally generated temp file, and reports not-ready
  (`{ready: false, reason: "SCANNER_SIGNATURES_UNAVAILABLE"}`) if ClamAV
  cannot complete that scan (e.g. no signature database loaded, or a
  corrupted one) - a `GET /health/ready` failure now means the scanner would
  genuinely fail closed on every real request, not just that the binary is
  missing. It still does **not** confirm the database is *current* - only
  that one is present and usable right now. Periodic freshness verification
  for long-lived Cloud Run instances remains the same future production-hardening
  item described above, not solved by this check.

## Object-size limit

`SCANNER_MAX_OBJECT_BYTES` (default 25 MiB, matching the current canonical
intake limit) is checked against GCS object *metadata* - before any byte is
downloaded or any temp file is allocated. See `src/assessment.ts`.

## Testing

`npm test` builds the TypeScript and runs `node --test` against the
compiled output. All tests are pure-logic (path validation, file-signature
detection, ClamAV exit-code mapping, security-decision mapping) - none of
them touch a live GCS bucket or a real ClamAV installation, and none put
real malware in this repository.

**EICAR testing (documented only, not added to this repository)**: the
standard, harmless way to exercise the `THREAT_DETECTED` path end-to-end
against a real ClamAV installation is the EICAR test string
(https://www.eicar.org/download-anti-malware-testfile/) - a file ClamAV (and
essentially every AV engine) is specifically designed to flag, containing no
actual malicious code. This should be done manually against a deployed
instance, or in a CI step that generates the EICAR string at test-run time
and deletes it afterward - it must never be committed to source control, per
the task's explicit instruction, and is not included here.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT_ID` | yes | GCS project |
| `GOOGLE_GCS_QUARANTINE_BUCKET` | yes | The only bucket this service will ever read from |
| `GOOGLE_GCS_INTAKE_BUCKET` | yes | The only bucket this service will ever promote into |
| `SCANNER_MAX_OBJECT_BYTES` | no (default 26214400 / 25 MiB) | Maximum object size the scanner will process |
| `SCANNER_CLAMSCAN_TIMEOUT_MS` | no (default 60000) | Per-invocation ClamAV wall-clock timeout |
| `PORT` | no (default 8080, Cloud Run sets this automatically) | HTTP listen port |

No `NEXT_PUBLIC_*` variable is used or read anywhere in this service. No
credentials are read from an environment variable or baked into the image -
authentication is Application Default Credentials via the Cloud Run
service's attached identity.

## Deployment requirements (not performed by this task)

- Deploy as a **private** Cloud Run service (`--no-allow-unauthenticated`).
- Attach the `tes-security-scanner@tes-production-510007.iam.gserviceaccount.com`
  service account to the Cloud Run service.
- Configure an Eventarc trigger on `google.cloud.storage.object.v1.finalized`
  for the `tes-production-quarantine` bucket, invoking this service with a
  dedicated invoker service account.
- This service has no in-app authentication of its own; access control is
  entirely the Cloud Run/Eventarc IAM layer. Deploying it without
  `--no-allow-unauthenticated` would expose it publicly - a deployment
  configuration error, not something this code can detect or prevent.
