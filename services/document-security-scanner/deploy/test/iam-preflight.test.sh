#!/usr/bin/env bash
# Offline tests for iam-preflight.py. Run: bash services/document-security-scanner/deploy/test/iam-preflight.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "${WORK}"' EXIT
REPO="${WORK}/repo"; mkdir -p "${REPO}/services/document-security-scanner/src"
echo 'export const x = 1;' > "${REPO}/services/document-security-scanner/src/a.ts"
git -C "${REPO}" init -q -b main && git -C "${REPO}" -c user.email=t@t -c user.name=t add -A && git -C "${REPO}" -c user.email=t@t -c user.name=t commit -q -m ok
git -C "${REPO}" remote add origin "${REPO}" && git -C "${REPO}" fetch -q origin main
GOOD="$(git -C "${REPO}" rev-parse HEAD)"
echo 'await file.delete();' >> "${REPO}/services/document-security-scanner/src/a.ts"
git -C "${REPO}" -c user.email=t@t -c user.name=t commit -qam bad && git -C "${REPO}" push -q origin HEAD:main 2>/dev/null || git -C "${REPO}" fetch -q origin
git -C "${REPO}" update-ref refs/remotes/origin/main HEAD
BAD="$(git -C "${REPO}" rev-parse HEAD)"
printf '#!/usr/bin/env bash\nexec python3 %s/fake-gcloud-preflight.py "$@"\n' "${HERE}" > "${WORK}/gcloud"; chmod +x "${WORK}/gcloud"
export GCLOUD="${WORK}/gcloud" FAKE_LOG="${WORK}/calls.log"
FAIL=0
run() { # name flags commit extra-env...
  local name="$1" flags="$2" commit="$3"; shift 3
  : > "${FAKE_LOG}"
  env FAKE_FLAGS="${flags}" FAKE_COMMIT="${commit}" "$@" python3 "${HERE}/../iam-preflight.py" --repo-dir "${REPO}" > "${WORK}/out.txt" 2> "${WORK}/err.txt"; echo $? > "${WORK}/rc"
}
rc() { cat "${WORK}/rc"; }
decision() { grep "^DECISION $1:" "${WORK}/out.txt" | sed 's/.*: //'; }
expect() { if [[ "$2" == "$3" ]]; then echo "ok   $1"; else echo "FAIL $1: got '$3', wanted '$2'"; FAIL=1; fi; }
has_out() { if grep -q -- "$2" "${WORK}/out.txt" "${WORK}/err.txt"; then echo "ok   $1"; else echo "FAIL $1: missing '$2'"; sed 's/^/   /' "${WORK}/out.txt" | tail -25; FAIL=1; fi; }
NOLOG() { if grep -E ' (create|delete|add-iam-policy-binding|remove-iam-policy-binding|set-iam-policy|update|replace|enable|disable|set|config|login) ' "${FAKE_LOG}" >/dev/null; then echo "FAIL $1: a non-read-only gcloud verb was issued"; FAIL=1; else echo "ok   $1 (only read-only gcloud verbs)"; fi; }

run observed "" "${GOOD}"
expect "observed drift: completes" 0 "$(rc)"; NOLOG "observed drift"
expect "observed drift: add is GO" GO "$(decision add-replacement-permissions)"
expect "observed drift: removing backend is NO-GO" NO-GO "$(decision remove-backend-broad-permissions)"
has_out "observed drift: says target binding missing" "is not present on"
has_out "observed drift: missing-object behavior unresolved" "UNRESOLVED"
expect "AI retirement is never decided here" NO-GO "$(decision retire-ai-processor-access)"
has_out "matrix is printed with target and current" "G / DENY"
has_out "scanner confirmed from provenance + code" "CONFIRMED_NO_DELETE"

run after_add "after_add" "${GOOD}" MISSING_OBJECT_BEHAVIOR_EVIDENCE=404
expect "after add + evidence: backend removal GO" GO "$(decision remove-backend-broad-permissions)"
expect "after add + evidence + confirmed source: scanner removal GO" GO "$(decision remove-scanner-broad-permissions)"
run after_add_no_evidence "after_add" "${GOOD}"
expect "after add without missing-object evidence: backend NO-GO" NO-GO "$(decision remove-backend-broad-permissions)"

run bad_source "after_add" "${BAD}" MISSING_OBJECT_BEHAVIOR_EVIDENCE=404
expect "scanner code that deletes blocks scanner removal" NO-GO "$(decision remove-scanner-broad-permissions)"; has_out "reports DELETES" "DELETES"
expect "...but not backend removal" GO "$(decision remove-backend-broad-permissions)"
run storage_source "after_add,storage_source" "${GOOD}" MISSING_OBJECT_BEHAVIOR_EVIDENCE=404
expect "uploaded-archive build: scanner removal NO-GO" NO-GO "$(decision remove-scanner-broad-permissions)"; has_out "reports UNKNOWN" "scanner verdict: UNKNOWN"
run no_prov "after_add,no_provenance" "${GOOD}" MISSING_OBJECT_BEHAVIOR_EVIDENCE=404
expect "no provenance: scanner removal NO-GO" NO-GO "$(decision remove-scanner-broad-permissions)"; has_out "no provenance is UNKNOWN" "scanner verdict: UNKNOWN"
run wrong_acct "after_add,scanner_wrong_account" "${GOOD}" MISSING_OBJECT_BEHAVIOR_EVIDENCE=404
expect "scanner service on another account blocks scanner removal" NO-GO "$(decision remove-scanner-broad-permissions)"

run ts_unknown "ts_unknown" "${GOOD}"
expect "inconclusive Policy Troubleshooter: add NO-GO" NO-GO "$(decision add-replacement-permissions)"; has_out "UNKNOWN is reported, not 'denied'" "UNKNOWN"
if grep -q "N / " "${WORK}/out.txt"; then echo "FAIL inconclusive answers were shown as denial"; FAIL=1; else echo "ok   no inconclusive answer was shown as NOT_GRANTED"; fi
run editor "after_add,editor_inherited" "${GOOD}" MISSING_OBJECT_BEHAVIOR_EVIDENCE=404
expect "inherited Editor blocks backend removal" NO-GO "$(decision remove-backend-broad-permissions)"; has_out "names the surviving permission" "STILL hold"
run ancestors "after_add,ancestor_unreadable" "${GOOD}" MISSING_OBJECT_BEHAVIOR_EVIDENCE=404
expect "unreadable ancestor policy: add NO-GO" NO-GO "$(decision add-replacement-permissions)"
expect "unreadable ancestor policy: removal NO-GO" NO-GO "$(decision remove-backend-broad-permissions)"
run groups "after_add,group_binding" "${GOOD}" MISSING_OBJECT_BEHAVIOR_EVIDENCE=404
expect "group with storage permissions: removal NO-GO (membership unknown)" NO-GO "$(decision remove-backend-broad-permissions)"
run cond "after_add,conditional_inherited" "${GOOD}" MISSING_OBJECT_BEHAVIOR_EVIDENCE=404
expect "conditional inherited grant: scanner removal NO-GO" NO-GO "$(decision remove-scanner-broad-permissions)"
run bucket_unreadable "bucket_unreadable" "${GOOD}"
expect "unreadable bucket policy: add NO-GO" NO-GO "$(decision add-replacement-permissions)"
run unsupported "unsupported" "${GOOD}"
expect "unsupported gcloud command stops the preflight" 3 "$(rc)"; has_out "names the unsupported command" "policy-troubleshoot iam"; NOLOG "unsupported"
exit ${FAIL}
