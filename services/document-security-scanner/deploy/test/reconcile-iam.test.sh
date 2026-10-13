#!/usr/bin/env bash
# Offline tests for reconcile-iam.sh against a stateful fake gcloud that starts from the OBSERVED production drift.
# Run: bash services/document-security-scanner/deploy/test/reconcile-iam.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "${WORK}"' EXIT
SCRIPT="${HERE}/../reconcile-iam.sh"
P=tes-production-510007
B="serviceAccount:tes-backend@${P}.iam.gserviceaccount.com"; S="serviceAccount:tes-security-scanner@${P}.iam.gserviceaccount.com"; A="serviceAccount:tes-ai-doc-processor@${P}.iam.gserviceaccount.com"
printf '#!/usr/bin/env bash\nexec python3 %s/fake-gcloud-iam.py "$@"\n' "${HERE}" > "${WORK}/gcloud"; chmod +x "${WORK}/gcloud"
export FAKE_STATE="${WORK}/state.json" FAKE_LOG="${WORK}/calls.log" GCLOUD="${WORK}/gcloud"
export MISSING_OBJECT_BEHAVIOR_EVIDENCE=404 SCANNER_SOURCE_CONFIRMED=yes AI_RETIREMENT_APPROVED=yes
FAIL=0
reset_state() { python3 - <<PY
import json
b = lambda role, *m: {"role": role, "members": list(m)}
json.dump({"roles": [], "buckets": {
  "tes-production-quarantine": [b("roles/storage.objectCreator", "$B"), b("roles/storage.objectAdmin", "$S", "$A")],
  "tes-production-intake": [b("roles/storage.objectAdmin", "$B", "$A"), b("roles/storage.objectCreator", "$S")],
  "tes-production-evidence": [b("roles/storage.objectAdmin", "$B", "$A")]}}, open("${FAKE_STATE}", "w"))
PY
: > "${FAKE_LOG}"; }
run() { local name="$1" want="$2"; shift 2; bash "${SCRIPT}" "$@" > "${WORK}/out.txt" 2> "${WORK}/err.txt"; local got=$?
  if [[ $got -eq $want ]]; then echo "ok   ${name}"; else echo "FAIL ${name}: exit ${got}, wanted ${want}"; sed 's/^/   /' "${WORK}/out.txt" "${WORK}/err.txt" | tail -12; FAIL=1; fi; }
mutations() { grep -E ' (create|add-iam-policy-binding|remove-iam-policy-binding|set-iam-policy|update|delete) ' "${FAKE_LOG}" || true; }
has_role() { python3 -c "
import json,sys
s=json.load(open('${FAKE_STATE}'))
sys.exit(0 if any(x['role']=='$2' and '$3' in x['members'] for x in s['buckets']['$1']) else 1)"; }
check() { if "$@"; then echo "ok   state: $*"; else echo "FAIL state: $*"; FAIL=1; fi; }
notcheck() { if "$@"; then echo "FAIL state (should not hold): $*"; FAIL=1; else echo "ok   state not: $*"; fi; }
CR="projects/${P}/roles"

reset_state; run "plan on observed drift" 0 ; [[ -z "$(mutations)" ]] && echo "ok   plan made no mutating call" || { echo "FAIL plan mutated"; FAIL=1; }
grep -q "current=\[roles/storage.objectAdmin" "${WORK}/out.txt" && echo "ok   plan shows the current Object Admin bindings" || { echo "FAIL plan output"; FAIL=1; }

reset_state; run "add without --confirm refuses" 4 --phase add; [[ -z "$(mutations)" ]] && echo "ok   refusal made no mutation" || FAIL=1
run "remove before add refuses (target missing)" 5 --phase remove --only backend --confirm "${P}:remove:backend"; [[ -z "$(mutations)" ]] && echo "ok   precondition stopped removal" || { echo "FAIL removed without target"; FAIL=1; }
run "remove with wrong confirmation refuses" 4 --phase remove --only backend --confirm nope
run "remove without --only refuses" 2 --phase remove --confirm x

run "verify fails before add" 1 --phase verify
run "add" 0 --phase add --confirm "${P}:add"
check has_role tes-production-intake "${CR}/tesPortalObjectReader" "$B"
check has_role tes-production-intake "${CR}/tesScannerIntakeWriter" "$S"
check has_role tes-production-evidence "${CR}/tesPortalEvidenceWriter" "$B"
check has_role tes-production-quarantine "${CR}/tesScannerQuarantineReader" "$S"
check has_role tes-production-intake roles/storage.objectAdmin "$B"   # add never removes
run "verify passes after add" 0 --phase verify
run "final verify FAILS while Object Admin remains" 1 --phase verify --final
: > "${FAKE_LOG}"; run "add is idempotent" 0 --phase add --confirm "${P}:add"; [[ -z "$(mutations)" ]] && echo "ok   second add changed nothing" || { echo "FAIL second add mutated:"; mutations; FAIL=1; }

run "remove backend" 0 --phase remove --only backend --confirm "${P}:remove:backend"
notcheck has_role tes-production-intake roles/storage.objectAdmin "$B"
notcheck has_role tes-production-evidence roles/storage.objectAdmin "$B"
check has_role tes-production-quarantine roles/storage.objectCreator "$B"
check has_role tes-production-intake roles/storage.objectAdmin "$A"   # other identities untouched
run "remove scanner" 0 --phase remove --only scanner --confirm "${P}:remove:scanner"
notcheck has_role tes-production-quarantine roles/storage.objectAdmin "$S"
notcheck has_role tes-production-intake roles/storage.objectCreator "$S"
run "remove ai" 0 --phase remove --only ai --confirm "${P}:remove:ai"
for bucket in quarantine intake evidence; do notcheck has_role tes-production-$bucket roles/storage.objectAdmin "$A"; done
run "verify still passes after all removals" 0 --phase verify
: > "${FAKE_LOG}"
run "final verify passes once excess is gone" 0 --phase verify --final
FAKE_UNKNOWN=1 run "final verify fails closed when denial cannot be proven" 1 --phase verify --final
run "remove is idempotent" 0 --phase remove --only ai --confirm "${P}:remove:ai"; [[ -z "$(mutations)" ]] || { echo "FAIL idempotent remove mutated"; FAIL=1; }

: > "${FAKE_LOG}"; run "rollback ai" 0 --phase rollback --only ai --confirm "${P}:rollback:ai"
for bucket in quarantine intake evidence; do check has_role tes-production-$bucket roles/storage.objectAdmin "$A"; done
check has_role tes-production-intake "${CR}/tesScannerIntakeWriter" "$S"   # rollback of one identity leaves the targets
run "rollback needs confirmation" 4 --phase rollback --only ai

# attestation guards
reset_state; bash "${SCRIPT}" --phase add --confirm "${P}:add" >/dev/null 2>&1
MISSING_OBJECT_BEHAVIOR_EVIDENCE= run "backend removal refused without missing-object evidence" 5 --phase remove --only backend --confirm "${P}:remove:backend"
SCANNER_SOURCE_CONFIRMED= run "scanner removal refused without confirmed source" 5 --phase remove --only scanner --confirm "${P}:remove:scanner"
AI_RETIREMENT_APPROVED= run "AI removal refused without separate approval" 5 --phase remove --only ai --confirm "${P}:remove:ai"
check has_role tes-production-intake roles/storage.objectAdmin "$B"
check has_role tes-production-evidence roles/storage.objectAdmin "$A"

# safety blockers
reset_state; python3 - <<PY
import json
s = json.load(open("${FAKE_STATE}")); s["buckets"]["tes-production-intake"].append({"role": "roles/storage.admin", "members": ["$S"]}); json.dump(s, open("${FAKE_STATE}", "w"))
PY
run "unlisted extra binding blocks" 1; grep -q "UNLISTED" "${WORK}/out.txt" "${WORK}/err.txt" && echo "ok   names the unlisted binding" || FAIL=1
reset_state; python3 - <<PY
import json
s = json.load(open("${FAKE_STATE}")); s["buckets"]["tes-production-evidence"].append({"role": "roles/storage.objectViewer", "members": ["allUsers"]}); json.dump(s, open("${FAKE_STATE}", "w"))
PY
run "public principal blocks" 1
reset_state; python3 - <<PY
import json
s = json.load(open("${FAKE_STATE}")); s["roles"].append({"name": "projects/${P}/roles/tesPortalObjectReader", "includedPermissions": ["storage.objects.get", "storage.objects.delete"], "stage": "GA"}); json.dump(s, open("${FAKE_STATE}", "w"))
PY
run "existing custom role with wrong permissions blocks" 1; grep -q "tesPortalObjectReader" "${WORK}/out.txt" "${WORK}/err.txt" && echo "ok   names the role" || FAIL=1
exit ${FAIL}
