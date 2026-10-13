#!/usr/bin/env bash
# Reproducible, least-privilege deployment of the document security scanner and its Eventarc trigger.
#
#   REVIEWED_COMMIT=<40-hex sha> deploy/deploy.sh
#       PLAN (default). Read-only discovery and validation, then prints what --apply WOULD do. Performs no mutation.
#   REVIEWED_COMMIT=<sha> deploy/deploy.sh --apply --confirm <PROJECT_ID>:<first 12 of the sha> [--grant-project-roles]
#       APPLY. Re-runs every check, refuses on any blocker, and mutates only what the plan listed.
#
# Principles: discover before changing; never recreate, overwrite or "repair" an existing resource (a mismatch is a blocker the
# owner resolves by hand); never suppress an error; no key, password or token appears here. Run as a human operator or a
# dedicated deployer identity, never as the scanner or portal identity.
set -euo pipefail

GCLOUD="${GCLOUD:-gcloud}"
APPLY=0
CONFIRM=""
GRANT_PROJECT_ROLES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --confirm) CONFIRM="${2:-}"; shift ;;
    --confirm=*) CONFIRM="${1#--confirm=}" ;;
    --grant-project-roles) GRANT_PROJECT_ROLES=1 ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

: "${PROJECT_ID:=tes-production-510007}"
: "${QUARANTINE_BUCKET:=tes-production-quarantine}"
: "${INTAKE_BUCKET:=tes-production-intake}"
: "${EVIDENCE_BUCKET:=tes-production-evidence}"
: "${SCANNER_SA:=tes-security-scanner@${PROJECT_ID}.iam.gserviceaccount.com}"
: "${INVOKER_SA:=tes-scanner-invoker@${PROJECT_ID}.iam.gserviceaccount.com}"
: "${REPOSITORY:=tes-scanner}"
: "${SERVICE:=document-security-scanner}"
: "${TRIGGER_NAME:=scanner-quarantine-finalized}"
: "${REVIEWED_COMMIT:?set REVIEWED_COMMIT to the full 40-character sha of the reviewed, merged commit being deployed}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/../../.." && pwd)"
SHORT="${REVIEWED_COMMIT:0:12}"

QUARANTINE_ROLE="tesScannerQuarantineReader"; QUARANTINE_PERMS="storage.objects.get"
INTAKE_ROLE="tesScannerIntakeWriter";         INTAKE_PERMS="storage.objects.create,storage.objects.get"
REQUIRED_APIS="run.googleapis.com eventarc.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com pubsub.googleapis.com storage.googleapis.com iam.googleapis.com"

BLOCKERS=(); PLAN=(); NOTES=()
block() { BLOCKERS+=("$1"); }
note()  { NOTES+=("$1"); }
plan()  { PLAN+=("$1|$2"); }          # plan KEY "text": KEY drives what --apply runs, text is shown to the operator
planned() { local p; for p in "${PLAN[@]:-}"; do [[ "${p%%|*}" == "$1" ]] && return 0; done; return 1; }

# --- guarded access to gcloud -------------------------------------------------------------------------------------------------
# read_g runs only read-only subcommands and refuses anything that could mutate, so discovery can never change production.
FORBIDDEN=" create delete add-iam-policy-binding remove-iam-policy-binding set-iam-policy replace submit deploy update update-traffic enable disable patch import undelete "
ALLOWED=" describe list get-iam-policy "
read_g() {
  local ok=0 arg
  for arg in "$@"; do
    [[ "${FORBIDDEN}" == *" ${arg} "* ]] && { echo "internal error: read_g refused mutating verb '${arg}'" >&2; exit 70; }
    [[ "${ALLOWED}" == *" ${arg} "* ]] && ok=1
  done
  [[ $ok -eq 1 ]] || { echo "internal error: read_g refused a command with no read-only verb: $*" >&2; exit 70; }
  "${GCLOUD}" "$@"
}
# mutate_g is the ONLY place that can change anything. In plan mode it records and prints; it never executes.
mutate_g() {
  if [[ $APPLY -eq 1 ]]; then echo "+ $*"; "${GCLOUD}" "$@"; fi
}
py() { python3 -c "import json,sys
d=json.load(sys.stdin)
$1"; }

# --- 1. source and provenance inputs ------------------------------------------------------------------------------------------
[[ "${REVIEWED_COMMIT}" =~ ^[0-9a-f]{40}$ ]] || { echo "REVIEWED_COMMIT must be a full 40-character lowercase sha" >&2; exit 2; }
HEAD_SHA="$(git -C "${ROOT}" rev-parse HEAD)"
[[ "${HEAD_SHA}" == "${REVIEWED_COMMIT}" ]] || block "checked-out HEAD (${HEAD_SHA:0:12}) is not REVIEWED_COMMIT (${SHORT}); check out the reviewed commit"
[[ -z "$(git -C "${ROOT}" status --porcelain)" ]] || block "working tree is not clean; deploy only committed, reviewed source"
git -C "${ROOT}" fetch -q origin main 2>/dev/null || note "could not fetch origin/main; merge status below may be stale"
if git -C "${ROOT}" merge-base --is-ancestor "${REVIEWED_COMMIT}" origin/main 2>/dev/null; then :; else
  if [[ $APPLY -eq 1 ]]; then block "REVIEWED_COMMIT is not contained in origin/main; only merged, reviewed commits are deployed"; else note "WARNING: REVIEWED_COMMIT is not (yet) in origin/main. Plan is informational; --apply will refuse until it is merged."; fi
fi

# --- 2. identity and APIs -----------------------------------------------------------------------------------------------------
ACTIVE="$(read_g auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1 || true)"
[[ -n "${ACTIVE}" ]] || { echo "No active gcloud identity: cannot discover production state, so no plan can be produced. Run 'gcloud auth login' (operator) first." >&2; exit 3; }
note "operator identity: ${ACTIVE} (it must not be the scanner or portal service account)"
[[ "${ACTIVE}" != "${SCANNER_SA}" && "${ACTIVE}" != "${INVOKER_SA}" ]] || block "run as a separate operator/deployer identity, not ${ACTIVE}"
ENABLED="$(read_g services list --enabled --project "${PROJECT_ID}" --format='value(config.name)')"
for api in ${REQUIRED_APIS}; do grep -qx "${api}" <<<"${ENABLED}" || block "API not enabled: ${api} (owner: gcloud services enable ${api} --project ${PROJECT_ID})"; done
PROJECT_NUMBER="$(read_g projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
[[ "${PROJECT_NUMBER}" =~ ^[0-9]+$ ]] || block "could not read the project number for ${PROJECT_ID}"

# --- 3. bucket locations and Eventarc region ----------------------------------------------------------------------------------
bucket_json() { read_g storage buckets describe "gs://$1" --project "${PROJECT_ID}" --format=json; }
Q_JSON="$(bucket_json "${QUARANTINE_BUCKET}" 2>/dev/null || true)"; I_JSON="$(bucket_json "${INTAKE_BUCKET}" 2>/dev/null || true)"; E_JSON="$(bucket_json "${EVIDENCE_BUCKET}" 2>/dev/null || true)"
for pair in "quarantine:${Q_JSON}" "intake:${I_JSON}" "evidence:${E_JSON}"; do [[ -n "${pair#*:}" ]] || block "bucket not readable or missing: ${pair%%:*}"; done
TRIGGER_LOCATION=""; BUCKET_LOCATION_TYPE=""
if [[ -n "${Q_JSON}" ]]; then
  BUCKET_LOCATION="$(py 'print(str(d.get("location","")).lower())' <<<"${Q_JSON}")"
  BUCKET_LOCATION_TYPE="$(py 'print(str(d.get("location_type","")).lower())' <<<"${Q_JSON}")"
  case "${BUCKET_LOCATION_TYPE}" in
    region|multi-region) TRIGGER_LOCATION="${BUCKET_LOCATION}" ;;
    *) block "quarantine bucket location type '${BUCKET_LOCATION_TYPE}' (${BUCKET_LOCATION}) is not supported by this script; the owner must choose the Eventarc location" ;;
  esac
  note "quarantine bucket: location=${BUCKET_LOCATION} type=${BUCKET_LOCATION_TYPE} -> Eventarc trigger location=${TRIGGER_LOCATION:-?}"
  if [[ -n "${TRIGGER_LOCATION}" ]]; then
    read_g eventarc locations list --format=json | py 'import sys
sys.exit(0 if any(x.get("locationId")=="'"${TRIGGER_LOCATION}"'" for x in d) else 1)' || block "Eventarc is not available in ${TRIGGER_LOCATION}"
  fi
fi
# Cloud Run region: must be explicit unless the bucket is single-region (then it defaults to the bucket's region).
if [[ -z "${REGION:-}" ]]; then
  if [[ "${BUCKET_LOCATION_TYPE}" == "region" ]]; then REGION="${BUCKET_LOCATION}"; else block "set REGION (Cloud Run region); the quarantine bucket is not single-region"; fi
fi
REGION="${REGION:-unset}"
[[ -n "${I_JSON}" && -n "${E_JSON}" && -n "${Q_JSON}" ]] && { [[ "${QUARANTINE_BUCKET}" != "${INTAKE_BUCKET}" && "${QUARANTINE_BUCKET}" != "${EVIDENCE_BUCKET}" && "${INTAKE_BUCKET}" != "${EVIDENCE_BUCKET}" ]] || block "the three buckets must be different"; }

# --- 4. service accounts (reuse; never recreate) ------------------------------------------------------------------------------
SA_LIST="$(read_g iam service-accounts list --project "${PROJECT_ID}" --format=json)"
sa_exists() { py 'import sys
sys.exit(0 if any(x.get("email")=="'"$1"'" and not x.get("disabled",False) for x in d) else 1)' <<<"${SA_LIST}"; }
for sa in "${SCANNER_SA}" "${INVOKER_SA}"; do
  if sa_exists "${sa}"; then note "service account exists, reused unchanged: ${sa}"
  elif py 'import sys
sys.exit(0 if any(x.get("email")=="'"${sa}"'" for x in d) else 1)' <<<"${SA_LIST}"; then block "service account exists but is DISABLED: ${sa}"
  else plan "sa:${sa}" "create service account ${sa}"; fi
done

# --- 5. custom roles: exact permissions, or a blocker -------------------------------------------------------------------------
ROLE_LIST="$(read_g iam roles list --project "${PROJECT_ID}" --show-deleted --format=json)"
check_role() { # name perms
  local name="$1" perms="$2" status
  status="$(py 'import sys
want=sorted("'"${perms}"'".split(","))
for r in d:
    if r.get("name","").endswith("/roles/'"${name}"'"):
        have=sorted(r.get("includedPermissions",[]))
        if r.get("deleted"): print("DELETED")
        elif have!=want: print("MISMATCH have="+",".join(have))
        elif r.get("stage") not in (None,"GA"): print("STAGE "+str(r.get("stage")))
        else: print("OK")
        break
else:
    print("ABSENT")' <<<"${ROLE_LIST}")"
  case "${status}" in
    OK) note "custom role ${name} exists with exactly: ${perms}" ;;
    ABSENT) plan "role:${name}" "create custom role ${name} with exactly: ${perms}" ;;
    *) block "custom role ${name}: ${status} (expected exactly ${perms}); resolve by hand, this script will not edit it" ;;
  esac
}
check_role "${QUARANTINE_ROLE}" "${QUARANTINE_PERMS}"; check_role "${INTAKE_ROLE}" "${INTAKE_PERMS}"

# --- 6. bucket bindings: only the expected one for the scanner; nothing for it on evidence --------------------------------------
member_roles() { # policy-json member -> lines "role|conditional"
  py 'for b in d.get("bindings",[]):
    if "'"$1"'" in b.get("members",[]): print(b["role"]+"|"+("cond" if b.get("condition") else "plain"))' <<<"$2"
}
check_bucket() { # bucket expected-role-short
  local bucket="$1" want="projects/${PROJECT_ID}/roles/$2" pol roles
  pol="$(read_g storage buckets get-iam-policy "gs://${bucket}" --project "${PROJECT_ID}" --format=json 2>/dev/null || true)"
  [[ -n "${pol}" ]] || { block "cannot read the IAM policy of gs://${bucket}"; return; }
  roles="$(member_roles "serviceAccount:${SCANNER_SA}" "${pol}")"
  if [[ "${roles}" == "${want}|plain" ]]; then note "gs://${bucket}: scanner binding already exactly ${want}"
  elif [[ -z "${roles}" ]]; then plan "bind:${bucket}" "bind ${SCANNER_SA} -> ${want} on gs://${bucket}"
  else block "gs://${bucket}: scanner has unexpected bindings [$(tr '\n' ' ' <<<"${roles}")]; expected only ${want} (unconditional). Remove the extras by hand."; fi
  if py 'import sys
sys.exit(0 if any(m in ("allUsers","allAuthenticatedUsers") for b in d.get("bindings",[]) for m in b.get("members",[])) else 1)' <<<"${pol}"; then block "gs://${bucket} grants access to allUsers/allAuthenticatedUsers"; fi
}
check_bucket "${QUARANTINE_BUCKET}" "${QUARANTINE_ROLE}"; check_bucket "${INTAKE_BUCKET}" "${INTAKE_ROLE}"
EV_POL="$(read_g storage buckets get-iam-policy "gs://${EVIDENCE_BUCKET}" --project "${PROJECT_ID}" --format=json 2>/dev/null || true)"
if [[ -n "${EV_POL}" ]]; then
  [[ -z "$(member_roles "serviceAccount:${SCANNER_SA}" "${EV_POL}")" ]] || block "the scanner service account has a binding on the evidence bucket; it must have none"
fi

# --- 7. project-level roles and the service agents -----------------------------------------------------------------------------
PROJ_POL="$(read_g projects get-iam-policy "${PROJECT_ID}" --format=json)"
STORAGE_AGENT="service-${PROJECT_NUMBER}@gs-project-accounts.iam.gserviceaccount.com"
EVENTARC_AGENT="service-${PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com"
SCN_PROJ="$(member_roles "serviceAccount:${SCANNER_SA}" "${PROJ_POL}")"
[[ -z "${SCN_PROJ}" ]] || block "the scanner service account holds project-level roles [$(tr '\n' ' ' <<<"${SCN_PROJ}")]; it must hold none"
INV_PROJ="$(member_roles "serviceAccount:${INVOKER_SA}" "${PROJ_POL}")"
if [[ "${INV_PROJ}" == "roles/eventarc.eventReceiver|plain" ]]; then note "trigger identity already holds roles/eventarc.eventReceiver"
elif [[ -z "${INV_PROJ}" ]]; then plan "grant:eventreceiver" "grant ${INVOKER_SA} roles/eventarc.eventReceiver on project ${PROJECT_ID} (required for an Eventarc trigger identity) [needs --grant-project-roles]"; NEED_PROJECT_GRANTS=1
else block "the trigger identity holds unexpected project-level roles [$(tr '\n' ' ' <<<"${INV_PROJ}")]; expected only roles/eventarc.eventReceiver"; fi
if member_roles "serviceAccount:${STORAGE_AGENT}" "${PROJ_POL}" | grep -qx "roles/pubsub.publisher|plain"; then note "Cloud Storage service agent already holds roles/pubsub.publisher"
else plan "grant:publisher" "grant ${STORAGE_AGENT} roles/pubsub.publisher on project ${PROJECT_ID} (Google's prerequisite for Cloud Storage events) [needs --grant-project-roles]"; NEED_PROJECT_GRANTS=1; fi
member_roles "serviceAccount:${EVENTARC_AGENT}" "${PROJ_POL}" | grep -q "^roles/eventarc.serviceAgent|" || block "the Eventarc service agent ${EVENTARC_AGENT} lacks roles/eventarc.serviceAgent; enabling the Eventarc API creates it (owner action)"
NEED_PROJECT_GRANTS="${NEED_PROJECT_GRANTS:-0}"

# --- 8. image: pinned to the reviewed commit, by digest -----------------------------------------------------------------------
REPO_PATH="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
IMAGE_BASE="${REPO_PATH}/${SERVICE}"
AR_LIST="$(read_g artifacts repositories list --project "${PROJECT_ID}" --location "${REGION}" --format=json 2>/dev/null || echo '[]')"
if py 'import sys
sys.exit(0 if any(x.get("name","").endswith("/repositories/'"${REPOSITORY}"'") for x in d) else 1)' <<<"${AR_LIST}"; then
  IMG_LIST="$(read_g artifacts docker images list "${IMAGE_BASE}" --include-tags --format=json 2>/dev/null || echo '[]')"
  EXISTING_DIGEST="$(py 'for x in d:
    if "'"${REVIEWED_COMMIT}"'" in (x.get("tags") or []): print(x.get("version","") or x.get("digest","")); break' <<<"${IMG_LIST}")"
else
  plan "repo" "create Artifact Registry Docker repository ${REPOSITORY} in ${REGION}"; EXISTING_DIGEST=""
fi
IMAGE_DIGEST="${EXISTING_DIGEST}"
verify_provenance() { # digest -> 0 if Cloud Build provenance is attached to that exact digest
  read_g artifacts docker images describe "${IMAGE_BASE}@$1" --show-provenance --format=json 2>/dev/null | py 'import sys
s=json.dumps(d)
ok = bool(d.get("provenance_summary",{}).get("provenance")) if isinstance(d,dict) else False
sys.exit(0 if ok else 1)'
}
if [[ -n "${IMAGE_DIGEST}" ]]; then
  if verify_provenance "${IMAGE_DIGEST}"; then note "image ${IMAGE_BASE}:${REVIEWED_COMMIT} exists as ${IMAGE_DIGEST} with Cloud Build provenance; reused, not rebuilt"
  else block "image tag ${REVIEWED_COMMIT} exists (${IMAGE_DIGEST}) but has no verifiable Cloud Build provenance; refusing to deploy it"; fi
else plan "build" "build the scanner from 'git archive ${SHORT}' with Cloud Build, tag ${REVIEWED_COMMIT}, verify provenance, deploy by digest"; fi

# --- 9. existing Cloud Run service and Eventarc trigger (verify; never overwrite blindly) -------------------------------------
RUN_LIST="$(read_g run services list --project "${PROJECT_ID}" --region "${REGION}" --format=json 2>/dev/null || echo '[]')"
RUN_JSON="$(py 'for x in d:
    if x.get("metadata",{}).get("name")=="'"${SERVICE}"'": print(json.dumps(x)); break' <<<"${RUN_LIST}")"
if [[ -n "${RUN_JSON}" ]]; then
  CUR_SA="$(py 'print(d.get("spec",{}).get("template",{}).get("spec",{}).get("serviceAccountName",""))' <<<"${RUN_JSON}")"
  CUR_IMG="$(py 'print((d.get("spec",{}).get("template",{}).get("spec",{}).get("containers") or [{}])[0].get("image",""))' <<<"${RUN_JSON}")"
  [[ "${CUR_SA}" == "${SCANNER_SA}" ]] || block "existing Cloud Run service runs as '${CUR_SA}', not ${SCANNER_SA}; the owner must resolve this (the script will not replace it)"
  note "Cloud Run service exists (current image: ${CUR_IMG}); apply creates a NEW revision only, and previous revisions are kept for rollback"
  RUN_POL="$(read_g run services get-iam-policy "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format=json)"
  py 'import sys
sys.exit(0 if any(m in ("allUsers","allAuthenticatedUsers") for b in d.get("bindings",[]) for m in b.get("members",[])) else 1)' <<<"${RUN_POL}" && block "the Cloud Run service is publicly invokable (allUsers/allAuthenticatedUsers); remove that by hand"
  INV_ROLES="$(member_roles "serviceAccount:${INVOKER_SA}" "${RUN_POL}")"
  if [[ "${INV_ROLES}" == "roles/run.invoker|plain" ]]; then note "invoker binding already present on the service"; elif [[ -z "${INV_ROLES}" ]]; then plan "invoker" "bind ${INVOKER_SA} -> roles/run.invoker on the service"; else block "unexpected invoker-account roles on the service [$(tr '\n' ' ' <<<"${INV_ROLES}")]"; fi
else
  plan "service" "create Cloud Run service ${SERVICE} in ${REGION} from deploy/service.yaml (private; runs as ${SCANNER_SA})"; plan "invoker" "bind ${INVOKER_SA} -> roles/run.invoker on the service"
fi
TRG_JSON=""
if [[ -n "${TRIGGER_LOCATION}" ]]; then
  TRG_LIST="$(read_g eventarc triggers list --project "${PROJECT_ID}" --location "${TRIGGER_LOCATION}" --format=json 2>/dev/null || echo '[]')"
  TRG_JSON="$(py 'for x in d:
    if x.get("name","").endswith("/triggers/'"${TRIGGER_NAME}"'"): print(json.dumps(x)); break' <<<"${TRG_LIST}")"
fi
if [[ -n "${TRG_JSON}" ]]; then
  TRG_STATUS="$(py 'f={ (x.get("attribute"),x.get("value")) for x in d.get("eventFilters",[]) }
dest=d.get("destination",{}).get("cloudRun",{})
problems=[]
if ("type","google.cloud.storage.object.v1.finalized") not in f: problems.append("event type")
if ("bucket","'"${QUARANTINE_BUCKET}"'") not in f: problems.append("bucket filter")
if dest.get("service")!="'"${SERVICE}"'": problems.append("destination service")
if dest.get("region")!="'"${REGION}"'": problems.append("destination region")
if d.get("serviceAccount")!="'"${INVOKER_SA}"'": problems.append("trigger identity")
print(",".join(problems) or "OK")' <<<"${TRG_JSON}")"
  [[ "${TRG_STATUS}" == "OK" ]] && note "Eventarc trigger ${TRIGGER_NAME} exists and matches; left unchanged" || block "Eventarc trigger ${TRIGGER_NAME} exists but differs in: ${TRG_STATUS}; the owner must resolve this (the script will not overwrite it)"
elif [[ -n "${TRIGGER_LOCATION}" ]]; then plan "trigger" "create Eventarc trigger ${TRIGGER_NAME} in ${TRIGGER_LOCATION}: object finalized in gs://${QUARANTINE_BUCKET} -> ${SERVICE} (${REGION}) as ${INVOKER_SA}"; fi

# --- report -------------------------------------------------------------------------------------------------------------------
echo "== Mode: $([[ $APPLY -eq 1 ]] && echo APPLY || echo PLAN)  project=${PROJECT_ID}  commit=${SHORT}  run-region=${REGION}  eventarc-location=${TRIGGER_LOCATION:-?}"
echo "-- Findings"; for n in "${NOTES[@]:-}"; do [[ -n "$n" ]] && echo "   ok: $n"; done
echo "-- Planned changes ($([[ $APPLY -eq 1 ]] && echo 'will run' || echo 'NOT executed in plan mode'))"; for p in "${PLAN[@]:-}"; do [[ -n "$p" ]] && echo "   * ${p#*|}"; done
if [[ ${#BLOCKERS[@]} -gt 0 ]]; then echo "-- BLOCKERS"; for b in "${BLOCKERS[@]}"; do echo "   ! $b"; done; echo "Refusing: resolve the blockers above." >&2; exit 1; fi
[[ $APPLY -eq 1 ]] || { echo "Plan complete: no blockers. Nothing was changed. To apply: add --apply --confirm ${PROJECT_ID}:${SHORT}$([[ ${NEED_PROJECT_GRANTS} -eq 1 ]] && echo ' --grant-project-roles')"; exit 0; }

# --- apply --------------------------------------------------------------------------------------------------------------------
[[ "${CONFIRM}" == "${PROJECT_ID}:${SHORT}" ]] || { echo "--apply requires --confirm ${PROJECT_ID}:${SHORT}" >&2; exit 4; }
if [[ ${NEED_PROJECT_GRANTS} -eq 1 && ${GRANT_PROJECT_ROLES} -ne 1 ]]; then echo "project-level grants are required (listed above); re-run with --grant-project-roles to approve exactly those two grants" >&2; exit 4; fi

for sa in "${SCANNER_SA}" "${INVOKER_SA}"; do planned "sa:${sa}" && mutate_g iam service-accounts create "${sa%@*}" --project "${PROJECT_ID}" --display-name "TES ${sa%%@*}"; done
planned "role:${QUARANTINE_ROLE}" && mutate_g iam roles create "${QUARANTINE_ROLE}" --project "${PROJECT_ID}" --title "TES scanner quarantine reader" --permissions "${QUARANTINE_PERMS}" --stage GA
planned "role:${INTAKE_ROLE}" && mutate_g iam roles create "${INTAKE_ROLE}" --project "${PROJECT_ID}" --title "TES scanner intake writer" --permissions "${INTAKE_PERMS}" --stage GA
planned "bind:${QUARANTINE_BUCKET}" && mutate_g storage buckets add-iam-policy-binding "gs://${QUARANTINE_BUCKET}" --project "${PROJECT_ID}" --member "serviceAccount:${SCANNER_SA}" --role "projects/${PROJECT_ID}/roles/${QUARANTINE_ROLE}"
planned "bind:${INTAKE_BUCKET}" && mutate_g storage buckets add-iam-policy-binding "gs://${INTAKE_BUCKET}" --project "${PROJECT_ID}" --member "serviceAccount:${SCANNER_SA}" --role "projects/${PROJECT_ID}/roles/${INTAKE_ROLE}"
planned "grant:eventreceiver" && mutate_g projects add-iam-policy-binding "${PROJECT_ID}" --member "serviceAccount:${INVOKER_SA}" --role roles/eventarc.eventReceiver --condition=None
planned "grant:publisher" && mutate_g projects add-iam-policy-binding "${PROJECT_ID}" --member "serviceAccount:${STORAGE_AGENT}" --role roles/pubsub.publisher --condition=None
planned "repo" && mutate_g artifacts repositories create "${REPOSITORY}" --project "${PROJECT_ID}" --location "${REGION}" --repository-format docker --description "TES scanner images"

if [[ -z "${IMAGE_DIGEST}" ]]; then
  SRC="$(mktemp -d)"; trap 'rm -rf "${SRC}"' EXIT
  git -C "${ROOT}" archive "${REVIEWED_COMMIT}" services/document-security-scanner | tar -x -C "${SRC}"   # exactly the reviewed commit, never the working tree
  BUILD_JSON="$("${GCLOUD}" builds submit "${SRC}/services/document-security-scanner" --project "${PROJECT_ID}" --tag "${IMAGE_BASE}:${REVIEWED_COMMIT}" --format=json)"
  py 'import sys
r=d[0] if isinstance(d,list) else d
sys.exit(0 if r.get("status")=="SUCCESS" else 1)' <<<"${BUILD_JSON}" || { echo "Cloud Build did not succeed" >&2; exit 5; }
  IMAGE_DIGEST="$(py 'r=d[0] if isinstance(d,list) else d
print((r.get("results",{}).get("images") or [{}])[0].get("digest",""))' <<<"${BUILD_JSON}")"
  [[ "${IMAGE_DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "build produced no image digest" >&2; exit 5; }
  verify_provenance "${IMAGE_DIGEST}" || { echo "no Cloud Build provenance is attached to ${IMAGE_DIGEST}; refusing to deploy" >&2; exit 5; }
fi
IMAGE="${IMAGE_BASE}@${IMAGE_DIGEST}"
echo "Deploying image ${IMAGE} (built from ${REVIEWED_COMMIT})"

RENDERED="$(mktemp)"; trap 'rm -f "${RENDERED}"; [[ -n "${SRC:-}" ]] && rm -rf "${SRC}"' EXIT
sed -e "s|\${PROJECT_ID}|${PROJECT_ID}|g" -e "s|\${IMAGE}|${IMAGE}|g" -e "s|\${SCANNER_SA}|${SCANNER_SA}|g" \
    -e "s|\${QUARANTINE_BUCKET}|${QUARANTINE_BUCKET}|g" -e "s|\${INTAKE_BUCKET}|${INTAKE_BUCKET}|g" "${HERE}/service.yaml" > "${RENDERED}"
if grep -q '\${' "${RENDERED}"; then echo "unrendered placeholder in service.yaml" >&2; exit 1; fi
mutate_g run services replace "${RENDERED}" --project "${PROJECT_ID}" --region "${REGION}"
planned "invoker" && mutate_g run services add-iam-policy-binding "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --member "serviceAccount:${INVOKER_SA}" --role roles/run.invoker
planned "trigger" && mutate_g eventarc triggers create "${TRIGGER_NAME}" --project "${PROJECT_ID}" --location "${TRIGGER_LOCATION}" \
  --event-filters "type=google.cloud.storage.object.v1.finalized" --event-filters "bucket=${QUARANTINE_BUCKET}" \
  --destination-run-service "${SERVICE}" --destination-run-region "${REGION}" --service-account "${INVOKER_SA}"
echo "Applied. Run the post-deploy checks in DEPLOYMENT.md before trusting the pipeline."
