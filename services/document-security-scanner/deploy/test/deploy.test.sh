#!/usr/bin/env bash
# Offline tests for deploy.sh using a fake gcloud. Proves: plan mode never mutates; mismatches block; apply needs confirmation and
# deploys by digest. Run: bash services/document-security-scanner/deploy/test/deploy.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "${WORK}"' EXIT
REPO="${WORK}/repo"; mkdir -p "${REPO}/services/document-security-scanner"
cp -r "${HERE}/.." "${REPO}/services/document-security-scanner/deploy"
rm -rf "${REPO}/services/document-security-scanner/deploy/test"
echo '{}' > "${REPO}/services/document-security-scanner/package.json"
git -C "${REPO}" init -q -b main && git -C "${REPO}" -c user.email=t@t -c user.name=t add -A && git -C "${REPO}" -c user.email=t@t -c user.name=t commit -q -m t
git -C "${REPO}" remote add origin "${REPO}" && git -C "${REPO}" fetch -q origin main
SHA="$(git -C "${REPO}" rev-parse HEAD)"
SCRIPT="${REPO}/services/document-security-scanner/deploy/deploy.sh"
FAIL=0
LOG="${WORK}/calls.log"
cat > "${WORK}/gcloud" <<SH
#!/usr/bin/env bash
exec python3 "${HERE}/fake-gcloud.py" "\$@"
SH
chmod +x "${WORK}/gcloud"

run() { # name expected-exit flags args...
  local name="$1" want="$2" flags="$3"; shift 3
  : > "${LOG}"
  FAKE_FLAGS="${flags}" FAKE_LOG="${LOG}" FAKE_SHA="${SHA}" GCLOUD="${WORK}/gcloud" REVIEWED_COMMIT="${SHA}" REGION="" \
    bash "${SCRIPT}" "$@" > "${WORK}/out.txt" 2> "${WORK}/err.txt"
  local got=$?
  if [[ $got -ne $want ]]; then echo "FAIL ${name}: exit ${got}, wanted ${want}"; sed 's/^/   /' "${WORK}/out.txt" "${WORK}/err.txt" | tail -15; FAIL=1; else echo "ok   ${name}"; fi
}
mutations() { grep -E ' (create|replace|add-iam-policy-binding|submit|delete|update|set-iam-policy) ' "${LOG}" || true; }
expect_none() { if [[ -n "$(mutations)" ]]; then echo "FAIL $1: plan mutated production:"; mutations; FAIL=1; else echo "ok   $1 (no mutating call)"; fi; }
expect_out() { if grep -q "$2" "${WORK}/out.txt" "${WORK}/err.txt"; then echo "ok   $1 mentions '$2'"; else echo "FAIL $1: missing '$2'"; sed 's/^/   /' "${WORK}/out.txt" "${WORK}/err.txt" | tail -12; FAIL=1; fi; }

run "greenfield plan" 0 "" ;                       expect_none "greenfield plan"; expect_out "greenfield plan" "create custom role tesScannerQuarantineReader"; expect_out "greenfield plan" "eventarc.eventReceiver"
run "existing plan is a no-op" 0 "existing" ;      expect_none "existing plan"; expect_out "existing plan" "left unchanged"
run "role permission mismatch blocks" 1 "existing,role_mismatch" ; expect_out "role mismatch" "tesScannerQuarantineReader"
run "broader scanner binding blocks" 1 "existing,scanner_broad_intake" ; expect_out "broad binding" "unexpected bindings"
run "scanner binding on evidence blocks" 1 "existing,scanner_on_evidence" ; expect_out "evidence binding" "evidence bucket"
run "trigger mismatch blocks" 1 "existing,trigger_mismatch" ; expect_out "trigger mismatch" "will not overwrite"
run "service account mismatch blocks" 1 "existing,service_wrong_sa" ; expect_out "service mismatch" "not "
run "public service blocks" 1 "existing,public_service" ; expect_out "public service" "publicly invokable"
run "dual-region bucket blocks" 1 "dual_region" ; expect_out "dual region" "not supported"
run "missing Eventarc service agent role blocks" 1 "no_eventarc_agent" ; expect_out "eventarc agent" "serviceAgent"
run "image without provenance blocks" 1 "existing,no_provenance" ; expect_out "no provenance" "provenance"
# wrong commit: HEAD differs from REVIEWED_COMMIT
: > "${LOG}"; FAKE_FLAGS="" FAKE_LOG="${LOG}" GCLOUD="${WORK}/gcloud" REVIEWED_COMMIT="$(printf 'b%.0s' {1..40})" REGION="" bash "${SCRIPT}" > "${WORK}/out.txt" 2> "${WORK}/err.txt"; [[ $? -eq 1 ]] && echo "ok   wrong REVIEWED_COMMIT blocks" || { echo "FAIL wrong REVIEWED_COMMIT"; FAIL=1; }

run "apply without --confirm refuses" 4 "" --apply ;     expect_none "apply without confirm"
run "apply with wrong confirm refuses" 4 "" --apply --confirm nope ;  expect_none "apply wrong confirm"
run "apply without --grant-project-roles refuses" 4 "" --apply --confirm "tes-production-510007:${SHA:0:12}" ; expect_none "apply without grant flag"
run "apply on a blocker refuses" 1 "existing,trigger_mismatch" --apply --confirm "tes-production-510007:${SHA:0:12}" ; expect_none "apply on blocker"
run "greenfield apply" 0 "" --apply --confirm "tes-production-510007:${SHA:0:12}" --grant-project-roles
for needle in "iam service-accounts create tes-security-scanner" "iam roles create tesScannerQuarantineReader" "storage buckets add-iam-policy-binding gs://tes-production-intake" "builds submit" "run services replace" "eventarc triggers create scanner-quarantine-finalized --project tes-production-510007 --location us-east4"; do
  grep -q -- "${needle}" "${LOG}" && echo "ok   apply ran: ${needle}" || { echo "FAIL apply did not run: ${needle}"; FAIL=1; }
done
grep -q "image: .*@sha256:a\{64\}" "${LOG}.yaml" && echo "ok   service deployed by digest, not by tag" || { echo "FAIL service not deployed by digest"; FAIL=1; }
grep -q "serviceAccountName: tes-security-scanner@" "${LOG}.yaml" && echo "ok   service runs as the scanner account" || { echo "FAIL scanner service account missing"; FAIL=1; }
run "existing apply changes nothing but the revision" 0 "existing" --apply --confirm "tes-production-510007:${SHA:0:12}"
if [[ "$(mutations | grep -v 'run services replace' | wc -l)" -ne 0 ]]; then echo "FAIL existing apply made extra mutations:"; mutations; FAIL=1; else echo "ok   existing apply only replaced the service revision"; fi
exit ${FAIL}
