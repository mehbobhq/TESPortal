# Deploying the document security scanner

Reproducible and least-privilege. **Nothing here has been applied.** `deploy.sh` is a dry run unless given `--apply`, and applying it is an
owner action. Values marked *confirm* are assumptions from the repository (Cloud SQL is in `us-east4`; the quarantine bucket's location was
not visible to the author).

## Pieces
| Piece | Definition |
| --- | --- |
| Cloud Run service `document-security-scanner` (private, min 1 instance, 2 vCPU / 4 GiB, concurrency 1) | `deploy/service.yaml` |
| Scanner service account (runs the service) | `tes-security-scanner@PROJECT.iam.gserviceaccount.com` *(name from the README; confirm it exists)* |
| Invoker service account (Eventarc authenticates as it) | `tes-scanner-invoker@PROJECT.iam.gserviceaccount.com` |
| Eventarc trigger `scanner-quarantine-finalized` (`google.cloud.storage.object.v1.finalized` on the quarantine bucket) | `deploy/deploy.sh` |
| Custom roles `tesScannerQuarantineReader`, `tesScannerIntakeWriter` | `deploy/deploy.sh` |

## Least-privilege IAM (exact)
| Principal | Resource | Role / permissions |
| --- | --- | --- |
| Scanner SA | bucket `tes-production-quarantine` | `tesScannerQuarantineReader` = `storage.objects.get` |
| Scanner SA | bucket `tes-production-intake` | `tesScannerIntakeWriter` = `storage.objects.create`, `storage.objects.get` (read-back after the create-only copy) |
| Invoker SA | Cloud Run service `document-security-scanner` | `roles/run.invoker` |
| Cloud Storage service agent (`service-PROJECT_NUMBER@gs-project-accounts.iam.gserviceaccount.com`) | project | `roles/pubsub.publisher` (Eventarc requires it to deliver Cloud Storage events; this is the one project-level grant and is Google's documented prerequisite) |
| Deployer (human or deployer SA) | project | enough to run the script: Cloud Run admin, Cloud Build editor, Artifact Registry writer, Eventarc admin, Service Account admin/user, role admin for the two custom roles. Not the scanner or portal identity. |

The scanner SA gets **no** access to the evidence bucket, **no** delete/update/list anywhere, and no project-level role. The portal backend SA gets
nothing from this script. Do not add `allUsers` / `allAuthenticatedUsers` as invoker. If the scanner SA already has other bindings
(for example Storage Object Viewer from earlier work), review and remove anything broader than the table above after cutover.

## Readiness
The container is not ready until a real ClamAV scan of a test string succeeds (`GET /health/ready`, used as the Cloud Run startup probe,
allowing up to 5 minutes for the signature database). `GET /health` is the liveness probe. A revision that cannot scan never receives traffic.
After deploying: `gcloud run services describe document-security-scanner --region REGION --format='value(status.conditions)'` must show
`Ready=True`, and the new revision must serve 100% of traffic.

## Retry (what is and is not guaranteed)
- The scanner returns 2xx for every final decision and **503 only for a transient failure** (scan engine or signatures unavailable, source read
  failed, promotion or read-back failed). It stops returning 503 once the object is older than `SCANNER_MAX_RETRY_AGE_MS` (6 h in `service.yaml`),
  or when the event carries no usable creation time.
- Eventarc retries a non-2xx delivery with backoff, but only for the transport's own retention window (for standard Eventarc triggers this is
  Google's documented Pub/Sub-backed behavior, 24 h by default; *confirm the current figure for your trigger type*). **Retry is bounded, not
  indefinite and not a delivery guarantee.** After the window, an unscanned object stays in `quarantine` and the payload stays `quarantined`.
- Those objects must be found and re-driven by an operator. `auditEvidencePayloads` reports them as `SCAN_STALLED` (quarantined more than 24 h
  with no intake object) but needs `storage.objects.list`, which neither the portal nor the scanner holds; who runs it is an open owner decision.
- Manual re-drive: POST a CloudEvent-style body (`bucket`, `name`, the object's current `generation`, `contentType`, `size`, `timeCreated`) to
  the service with an identity token for the invoker SA. The scanner pins everything to the generation in the event; promotion is create-only, so a
  replay is idempotent.

## Logs and alerts
Scanner logs are one JSON object per line (`level`, `securityAssessmentId`, `securityDecision`, `reasonCode`, `message`; never bytes, credentials or raw errors).
Create log-based alerts in Cloud Logging for:
- `resource.type="cloud_run_revision" AND resource.labels.service_name="document-security-scanner" AND jsonPayload.message:"requesting redelivery"` (transient failures)
- the same resource with `severity>=ERROR`
- `jsonPayload.securityDecision="THREAT_DETECTED"` (informational; a threat is a final, acknowledged decision)
- Cloud Run `request_count` with `response_code_class="5xx"` above zero for 15 minutes.

## Verification after applying (read-only unless noted)
1. `gcloud eventarc triggers describe scanner-quarantine-finalized --location LOCATION` is `ACTIVE`, targets the service, uses the invoker SA, and filters the quarantine bucket.
2. `gcloud run services get-iam-policy document-security-scanner --region REGION` lists only the invoker SA as `roles/run.invoker`.
3. `gcloud storage buckets get-iam-policy gs://BUCKET` for quarantine and intake shows the scanner SA only with the two custom roles above.
4. Staging/nonproduction: run the scanner end to end with a harmless PDF and an AV test fixture before the production smoke test (see `docs/evidence-lifecycle-production-acceptance.md`).

## Rollback
- Bad revision: `gcloud run services update-traffic document-security-scanner --region REGION --to-revisions PREVIOUS_REVISION=100`.
- Stop scanning (fails safe): `gcloud eventarc triggers delete scanner-quarantine-finalized --location LOCATION`. New uploads then stay `quarantined`;
  nothing is promoted. Re-create the trigger with the script and re-drive any objects that arrived meanwhile.
- Remove access: delete the two bucket bindings with `gcloud storage buckets remove-iam-policy-binding`. Custom roles may be left in place.
- Never "roll back" by loosening the scanner (skipping the scan, promoting without a hash check, or granting the portal write access to intake).
