#!/usr/bin/env bash
# Reproducible, least-privilege deployment of the document security scanner and its Eventarc trigger.
#
#   deploy/deploy.sh                 DRY RUN: prints every command, changes nothing (default)
#   deploy/deploy.sh --apply         runs them; requires an operator identity with the permissions listed in DEPLOYMENT.md
#
# No key, password or token appears here. Run as a human operator or a deployer service account, never as the scanner or portal identity.
set -euo pipefail

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

: "${PROJECT_ID:=tes-production-510007}"
: "${REGION:=us-east4}"                      # Cloud Run region
: "${BUCKET_LOCATION:=us-east4}"             # the quarantine bucket's location; the Eventarc trigger must be in the same location
: "${QUARANTINE_BUCKET:=tes-production-quarantine}"
: "${INTAKE_BUCKET:=tes-production-intake}"
: "${SCANNER_SA:=tes-security-scanner@${PROJECT_ID}.iam.gserviceaccount.com}"
: "${INVOKER_SA:=tes-scanner-invoker@${PROJECT_ID}.iam.gserviceaccount.com}"
: "${REPOSITORY:=tes-scanner}"               # Artifact Registry Docker repository
: "${IMAGE_TAG:?set IMAGE_TAG to the git SHA being deployed}"
SERVICE=document-security-scanner
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE}:${IMAGE_TAG}"
HERE="$(cd "$(dirname "$0")" && pwd)"

run() {
  echo "+ $*"
  if [[ $APPLY -eq 1 ]]; then "$@"; fi
}

echo "Mode: $([[ $APPLY -eq 1 ]] && echo APPLY || echo DRY RUN)  project=${PROJECT_ID} region=${REGION}"

# 1. Accounts (idempotent). The invoker account can do exactly one thing: invoke this service.
if [[ $APPLY -eq 0 ]] || ! gcloud iam service-accounts describe "${SCANNER_SA}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  run gcloud iam service-accounts create "${SCANNER_SA%@*}" --project "${PROJECT_ID}" --display-name "TES document security scanner"
fi
if [[ $APPLY -eq 0 ]] || ! gcloud iam service-accounts describe "${INVOKER_SA}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  run gcloud iam service-accounts create "${INVOKER_SA%@*}" --project "${PROJECT_ID}" --display-name "TES scanner Eventarc invoker"
fi

# 2. Least-privilege bucket roles. Custom roles hold only the permissions below, and are bound per bucket, never on the project.
run gcloud iam roles create tesScannerQuarantineReader --project "${PROJECT_ID}" --title "TES scanner quarantine reader" \
  --permissions storage.objects.get --stage GA || echo "(role may already exist; verify with: gcloud iam roles describe tesScannerQuarantineReader --project ${PROJECT_ID})"
run gcloud iam roles create tesScannerIntakeWriter --project "${PROJECT_ID}" --title "TES scanner intake writer" \
  --permissions storage.objects.create,storage.objects.get --stage GA || echo "(role may already exist; verify with: gcloud iam roles describe tesScannerIntakeWriter --project ${PROJECT_ID})"
run gcloud storage buckets add-iam-policy-binding "gs://${QUARANTINE_BUCKET}" --project "${PROJECT_ID}" \
  --member "serviceAccount:${SCANNER_SA}" --role "projects/${PROJECT_ID}/roles/tesScannerQuarantineReader"
run gcloud storage buckets add-iam-policy-binding "gs://${INTAKE_BUCKET}" --project "${PROJECT_ID}" \
  --member "serviceAccount:${SCANNER_SA}" --role "projects/${PROJECT_ID}/roles/tesScannerIntakeWriter"

# 3. Build the image (Cloud Build) and deploy the service from the declarative definition.
run gcloud builds submit "${HERE}/.." --project "${PROJECT_ID}" --tag "${IMAGE}"
RENDERED="$(mktemp)"
trap 'rm -f "${RENDERED}"' EXIT
sed -e "s|\${PROJECT_ID}|${PROJECT_ID}|g" -e "s|\${IMAGE}|${IMAGE}|g" -e "s|\${SCANNER_SA}|${SCANNER_SA}|g" \
    -e "s|\${QUARANTINE_BUCKET}|${QUARANTINE_BUCKET}|g" -e "s|\${INTAKE_BUCKET}|${INTAKE_BUCKET}|g" "${HERE}/service.yaml" > "${RENDERED}"
if grep -q '\${' "${RENDERED}"; then echo "unrendered placeholder in service.yaml" >&2; exit 1; fi
run gcloud run services replace "${RENDERED}" --project "${PROJECT_ID}" --region "${REGION}"

# 4. Only the invoker account may call the service (no allUsers / allAuthenticatedUsers).
run gcloud run services add-iam-policy-binding "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" \
  --member "serviceAccount:${INVOKER_SA}" --role roles/run.invoker

# 5. Trigger: object finalized in the quarantine bucket -> the service. Eventarc authenticates as the invoker account.
run gcloud eventarc triggers create scanner-quarantine-finalized --project "${PROJECT_ID}" --location "${BUCKET_LOCATION}" \
  --event-filters "type=google.cloud.storage.object.v1.finalized" --event-filters "bucket=${QUARANTINE_BUCKET}" \
  --destination-run-service "${SERVICE}" --destination-run-region "${REGION}" --service-account "${INVOKER_SA}"

echo "Done. Next: verify with the checks in DEPLOYMENT.md (no traffic is trusted until /health/ready is 200 and the trigger is ACTIVE)."
