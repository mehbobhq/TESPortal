# Deploying the document security scanner

Reproducible and least-privilege. **Nothing here has been applied.** `deploy.sh` defaults to a read-only PLAN, and `--apply` is an owner
action that needs an exact confirmation string.

## Existing production (read this first)
The service (`document-security-scanner`, us-central1), the Eventarc trigger (`tes-quarantine-document-scanner`, location `us`), the trigger identity (`tes-eventarc-scanner-trigger`)
and the scanner identity already exist, and the script's defaults match them, so a plan reuses them and creates nothing. Bucket IAM has drifted from the table below;
reconcile it first with `reconcile-iam.sh` and `docs/gcs-iam-reconciliation-plan.md` (the deploy plan reports the drift as blockers until then).

## What the script does and refuses
- **Discovers before changing.** It reads the real state of: enabled APIs, the quarantine bucket's location (to choose the Eventarc trigger
  location: a single region maps to itself, a multi-region to that multi-region, and a dual-region is refused for the owner to decide), Eventarc
  availability there, service accounts, custom roles, bucket and project IAM, the Artifact Registry repository and image, the Cloud Run service and
  its invoker policy, and the Eventarc trigger.
- **Never recreates, overwrites or repairs.** Existing resources are reused unchanged. A custom role whose permissions differ from the expected set,
  a scanner binding broader than expected (or any binding for it on the evidence bucket or the project), a trigger with a different filter/destination/identity,
  a Cloud Run service running as another account, a public invoker, or a disabled service account is a **blocker** that stops the script. The owner fixes it by hand.
- **Plan performs no mutation.** All discovery goes through a wrapper that refuses any mutating gcloud verb; the only code that can change anything runs
  after `--apply`. `deploy/test/deploy.test.sh` proves this against a fake gcloud (plan makes no mutating call in any scenario).
- **`--apply` needs `--confirm <PROJECT_ID>:<first 12 chars of the commit>`**, re-runs every check, refuses on any blocker, and refuses to make the two
  project-level grants unless `--grant-project-roles` is also given.
- **Source is pinned.** `REVIEWED_COMMIT` (40 hex) must equal `HEAD`, the tree must be clean, and for `--apply` the commit must be contained in
  `origin/main`. The image is built from `git archive <commit>` (never the working tree), tagged with the full commit, and deployed **by digest**.
- **Provenance is verified, with a stated limit.** After the build the script requires `status=SUCCESS`, a `sha256:` digest, and Cloud Build provenance attached
  to exactly that digest (`gcloud artifacts docker images describe IMAGE@DIGEST --show-provenance`). An existing image already tagged with the commit
  is reused only if its provenance verifies. If the provenance field is absent or has a different shape, the script fails closed. Cloud Build provenance
  proves *that Cloud Build built that digest*; binding the digest to the commit rests on building from `git archive` of that commit and tagging it with the
  SHA. Stronger guarantees (repository tag immutability, Binary Authorization, rebuild-and-compare) are optional hardening, not provided here.

## Pieces
| Piece | Definition |
| --- | --- |
| Cloud Run service `document-security-scanner` (private, min 1 instance, 2 vCPU / 4 GiB, concurrency 1) | `deploy/service.yaml` |
| Scanner service account (runs the service) | `tes-security-scanner@PROJECT.iam.gserviceaccount.com` *(confirm the name)* |
| Trigger identity (Eventarc authenticates as it) | `tes-scanner-invoker@PROJECT.iam.gserviceaccount.com` |
| Eventarc trigger `scanner-quarantine-finalized` | created by `deploy.sh`, in the quarantine bucket's own location |
| Custom roles `tesScannerQuarantineReader`, `tesScannerIntakeWriter` | created by `deploy.sh` if absent; verified exactly if present |

## Least-privilege IAM (exact)
| Principal | Resource | Role / permissions |
| --- | --- | --- |
| Scanner SA | bucket quarantine | `tesScannerQuarantineReader` = `storage.objects.get` |
| Scanner SA | bucket intake | `tesScannerIntakeWriter` = `storage.objects.create`, `storage.objects.get` (read-back after the create-only copy) |
| Scanner SA | evidence bucket, project | **nothing** (a blocker if present) |
| Trigger identity | Cloud Run service | `roles/run.invoker` |
| Trigger identity | project | `roles/eventarc.eventReceiver` (Eventarc requires it of a trigger identity; project-level grant) |
| Cloud Storage service agent `service-NUM@gs-project-accounts.iam.gserviceaccount.com` | project | `roles/pubsub.publisher` (Google's prerequisite for Cloud Storage events; project-level grant) |
| Eventarc service agent `service-NUM@gcp-sa-eventarc.iam.gserviceaccount.com` | project | `roles/eventarc.serviceAgent` (created when the Eventarc API is enabled; the script only verifies it) |
| Deployer | project | enough to run the script: Cloud Run admin, Cloud Build editor, Artifact Registry admin or writer + repo creator, Eventarc admin, Service Account admin and `iam.serviceAccountUser` on the trigger identity, custom-role admin, and bucket IAM admin on quarantine and intake. Not the scanner or portal identity. |

The two project-level grants are the only ones; both are narrow roles and both require `--grant-project-roles`. The portal backend identity gets nothing
from this script. Never add `allUsers` / `allAuthenticatedUsers` as invoker.

## Minimum safe deployment sequence (owner)
1. In the repository: merge PR #17 and check out the merged commit; `git rev-parse HEAD` gives `REVIEWED_COMMIT`.
2. Owner enables the APIs the plan reports missing (`run`, `eventarc`, `artifactregistry`, `cloudbuild`, `pubsub`, `storage`, `iam`).
3. `REVIEWED_COMMIT=<sha> REGION=<cloud run region> services/document-security-scanner/deploy/deploy.sh` (PLAN). Read every finding. Resolve every blocker by hand. Confirm the
   discovered Eventarc location equals the quarantine bucket's location and that `REGION` is where the scanner should run.
4. `REVIEWED_COMMIT=<sha> REGION=<region> deploy/deploy.sh --apply --confirm PROJECT_ID:<12 chars> --grant-project-roles` (omit the flag if the plan listed no project grants).
5. Verify (read-only): service `Ready=True` on the new revision at 100% traffic; `/health/ready` 200; `gcloud eventarc triggers describe` is ACTIVE with the right bucket, destination and
   identity; `gcloud run services get-iam-policy` lists only the trigger identity; the bucket policies show only the two custom-role bindings for the scanner.
6. Run the **nonproduction** checks N1-N5 in `docs/evidence-lifecycle-production-acceptance.md` before any production test data exists. Add the log-based alerts below.

## Retry (what is and is not guaranteed)
- The scanner returns 2xx for every final decision and **503 only for a transient failure**, and stops returning 503 once the object is older than
  `SCANNER_MAX_RETRY_AGE_MS` (6 h in `service.yaml`) or when the event has no usable creation time.
- Eventarc redelivers a non-2xx for its own platform-defined window (Google documents a default; *confirm the current figure for your trigger type*). Retry is
  **bounded, not indefinite, and not a delivery guarantee**. After either limit, an unscanned object stays in `quarantine` and its payload stays `quarantined`.
- Those objects must be found and re-driven by an operator. `auditEvidencePayloads` reports them (`SCAN_STALLED`) but needs `storage.objects.list`, which neither the
  portal nor the scanner holds; who runs it is an open owner decision.
- Manual re-drive: POST a CloudEvent-style body (`bucket`, `name`, the object's current `generation`, `contentType`, `size`, `timeCreated`) to the service with an identity token for
  the trigger identity. Everything is pinned to the event's generation and promotion is create-only, so a replay is idempotent.

## Logs and alerts
Scanner logs are one JSON object per line (`level`, `securityAssessmentId`, `securityDecision`, `reasonCode`, `message`; never bytes, credentials or raw errors). Create log-based alerts for:
- `resource.type="cloud_run_revision" AND resource.labels.service_name="document-security-scanner" AND jsonPayload.message:"requesting redelivery"`
- the same resource with `severity>=ERROR`
- `jsonPayload.securityDecision="THREAT_DETECTED"` (informational; a threat is a final, acknowledged decision)
- Cloud Run `request_count` with `response_code_class="5xx"` above zero for 15 minutes.

## Rollback
- **Bad revision:** `gcloud run services update-traffic document-security-scanner --region REGION --to-revisions PREVIOUS_REVISION=100`. Revisions are kept (apply only adds one), and
  the previous image digest is recorded in the plan output ("current image").
- **Stop scanning (fails safe):** `gcloud eventarc triggers delete scanner-quarantine-finalized --location LOCATION`. New uploads then stay `quarantined` and nothing is promoted. Re-run
  the script to re-create the trigger, then re-drive objects that arrived meanwhile.
- **Remove access:** `gcloud storage buckets remove-iam-policy-binding` for the two bucket bindings; remove the two project grants only if nothing else uses them. Custom roles can stay.
- **Never** roll back by loosening the scanner: skipping the scan, promoting without a hash check, or giving the portal write access to intake.
