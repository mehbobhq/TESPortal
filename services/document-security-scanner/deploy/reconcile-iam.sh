#!/usr/bin/env bash
# Reconciles the EXISTING production bucket IAM with least privilege. Idempotent, phased, dry-run first.
#
#   reconcile-iam.sh                              PLAN (default): read-only; shows current vs target and what each phase would do
#   reconcile-iam.sh --phase add      --confirm PROJECT:add                add missing custom roles and TARGET bindings (never removes)
#   reconcile-iam.sh --phase verify [--final]                             read-only: Policy Troubleshooter proves required permissions are granted;
#                                                                         --final also proves delete/update/setIamPolicy are DENIED for all three identities
#   reconcile-iam.sh --phase remove   --only backend|scanner|ai --confirm PROJECT:remove:WHO
#                                                                         remove the excess bindings of ONE identity, only if its TARGET is present and verified
#   reconcile-iam.sh --phase rollback --only backend|scanner|ai --confirm PROJECT:rollback:WHO
#                                                                         re-add that identity's original bindings (the exact drift recorded below)
#
# Never creates a service account, bucket, key or project-level binding; never deletes or disables a key; never touches the Cloud Run
# service or the Eventarc trigger. A binding that is not in the recorded drift or the target is reported and left alone.
set -euo pipefail

GCLOUD="${GCLOUD:-gcloud}"
PHASE=plan; CONFIRM=""; ONLY=""; FINAL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase) PHASE="${2:-}"; shift ;;
    --confirm) CONFIRM="${2:-}"; shift ;;
    --only) ONLY="${2:-}"; shift ;;
    --final) FINAL=1 ;;
    -h|--help) sed -n 2,14p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
case "${PHASE}" in plan|add|verify|remove|rollback) ;; *) echo "unknown phase ${PHASE}" >&2; exit 2 ;; esac
if [[ "${PHASE}" == remove || "${PHASE}" == rollback ]]; then [[ "${ONLY}" =~ ^(backend|scanner|ai)$ ]] || { echo "--only backend|scanner|ai is required for ${PHASE}" >&2; exit 2; }; fi

: "${PROJECT_ID:=tes-production-510007}"
: "${QUARANTINE_BUCKET:=tes-production-quarantine}"
: "${INTAKE_BUCKET:=tes-production-intake}"
: "${EVIDENCE_BUCKET:=tes-production-evidence}"
BACKEND_SA="tes-backend@${PROJECT_ID}.iam.gserviceaccount.com"
SCANNER_SA="tes-security-scanner@${PROJECT_ID}.iam.gserviceaccount.com"
AI_SA="tes-ai-doc-processor@${PROJECT_ID}.iam.gserviceaccount.com"
TRIGGER_SA="tes-eventarc-scanner-trigger@${PROJECT_ID}.iam.gserviceaccount.com"
CR="projects/${PROJECT_ID}/roles"

declare -A BUCKET=( [Q]="${QUARANTINE_BUCKET}" [I]="${INTAKE_BUCKET}" [E]="${EVIDENCE_BUCKET}" )
declare -A MEMBER=( [backend]="${BACKEND_SA}" [scanner]="${SCANNER_SA}" [ai]="${AI_SA}" [trigger]="${TRIGGER_SA}" )
# custom roles: name -> exact permission set
declare -A ROLE_PERMS=(
  [tesScannerQuarantineReader]="storage.objects.get"
  [tesScannerIntakeWriter]="storage.objects.create,storage.objects.get"
  [tesPortalObjectReader]="storage.objects.get"
  [tesPortalEvidenceWriter]="storage.objects.create,storage.objects.get"
)
# TARGET: bucket|identity|role   (what each identity needs, from the repository audit)
TARGET=(
  "Q|backend|roles/storage.objectCreator"
  "Q|scanner|${CR}/tesScannerQuarantineReader"
  "I|backend|${CR}/tesPortalObjectReader"
  "I|scanner|${CR}/tesScannerIntakeWriter"
  "E|backend|${CR}/tesPortalEvidenceWriter"
)
# EXCESS: the observed drift to remove, bucket|identity|role
EXCESS=(
  "Q|scanner|roles/storage.objectAdmin"
  "Q|ai|roles/storage.objectAdmin"
  "I|backend|roles/storage.objectAdmin"
  "I|scanner|roles/storage.objectCreator"
  "I|ai|roles/storage.objectAdmin"
  "E|backend|roles/storage.objectAdmin"
  "E|ai|roles/storage.objectAdmin"
)
# permissions each TARGET row must grant, and permissions that must be DENIED once the excess is gone
need_perms() { case "$1" in
  "Q|backend") echo "storage.objects.create";; "Q|scanner") echo "storage.objects.get";;
  "I|backend") echo "storage.objects.get";;    "I|scanner") echo "storage.objects.create storage.objects.get";;
  "E|backend") echo "storage.objects.create storage.objects.get";; esac; }
DENIED_PERMS="storage.objects.delete storage.objects.update storage.objects.setIamPolicy"

BLOCKERS=(); NOTES=()
block() { BLOCKERS+=("$1"); }
note() { NOTES+=("$1"); }
FORBIDDEN=" create delete add-iam-policy-binding remove-iam-policy-binding set-iam-policy replace submit deploy update enable disable patch "
ALLOWED=" describe list get-iam-policy policy-troubleshoot "
read_g() { local a ok=0; for a in "$@"; do
    [[ "${FORBIDDEN}" == *" ${a} "* ]] && { echo "internal error: read_g refused '${a}'" >&2; exit 70; }
    [[ "${ALLOWED}" == *" ${a} "* ]] && ok=1; done
  [[ $ok -eq 1 ]] || { echo "internal error: read_g refused: $*" >&2; exit 70; }
  "${GCLOUD}" "$@"; }
mutate_g() { echo "+ $*"; "${GCLOUD}" "$@"; }
py() { python3 -c "import json,sys
d=json.load(sys.stdin)
$1"; }

[[ -n "$(read_g auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)" ]] || { echo "No active gcloud identity: cannot read production IAM." >&2; exit 3; }

# --- discovery (read-only, every phase) ---------------------------------------------------------------------------------------
declare -A POLICY
for b in Q I E; do
  POLICY[$b]="$(read_g storage buckets get-iam-policy "gs://${BUCKET[$b]}" --project "${PROJECT_ID}" --format=json 2>/dev/null || true)"
  [[ -n "${POLICY[$b]}" ]] || block "cannot read the IAM policy of gs://${BUCKET[$b]}"
done
has_binding() { # bucket identity role -> 0 if present and unconditional
  [[ -n "${POLICY[$1]}" ]] && py 'import sys
m="serviceAccount:'"${MEMBER[$2]}"'"
sys.exit(0 if any(b["role"]=="'"$3"'" and m in b.get("members",[]) and not b.get("condition") for b in d.get("bindings",[])) else 1)' <<<"${POLICY[$1]}"; }
roles_of() { py 'm="serviceAccount:'"${MEMBER[$2]}"'"
for b in d.get("bindings",[]):
    if m in b.get("members",[]): print(b["role"]+("|conditional" if b.get("condition") else ""))' <<<"${POLICY[$1]}"; }
listed() { local row r; for row in "${TARGET[@]}" "${EXCESS[@]}"; do [[ "$row" == "$1|$2|$3" ]] && return 0; done; return 1; }

for b in Q I E; do
  [[ -n "${POLICY[$b]}" ]] || continue
  for who in backend scanner ai trigger; do
    while IFS= read -r r; do
      [[ -n "$r" ]] || continue
      if [[ "$r" == *"|conditional" ]]; then block "gs://${BUCKET[$b]}: ${who} has a CONDITIONAL binding (${r%|conditional}); inspect by hand"
      elif ! listed "$b" "$who" "$r"; then block "gs://${BUCKET[$b]}: ${who} has an UNLISTED binding ${r}; neither target nor recorded drift, inspect by hand"; fi
    done < <(roles_of "$b" "$who")
  done
  py 'import sys
sys.exit(0 if any(m in ("allUsers","allAuthenticatedUsers") for x in d.get("bindings",[]) for m in x.get("members",[])) else 1)' <<<"${POLICY[$b]}" && block "gs://${BUCKET[$b]} grants access to allUsers/allAuthenticatedUsers"
done
ROLES_JSON="$(read_g iam roles list --project "${PROJECT_ID}" --show-deleted --format=json)"
role_state() { py 'want=sorted("'"$2"'".split(","))
for r in d:
    if r.get("name","").endswith("/roles/'"$1"'"):
        have=sorted(r.get("includedPermissions",[]))
        print("DELETED" if r.get("deleted") else ("MISMATCH" if have!=want else "OK")); break
else: print("ABSENT")' <<<"${ROLES_JSON}"; }
for r in "${!ROLE_PERMS[@]}"; do
  s="$(role_state "$r" "${ROLE_PERMS[$r]}")"
  [[ "$s" == OK || "$s" == ABSENT ]] || block "custom role ${r} is ${s} (expected exactly ${ROLE_PERMS[$r]}); resolve by hand"
done

verify_target() { # prints FAIL lines; returns 1 if any required permission is not granted
  local row b who perm bad=0
  for row in "${TARGET[@]}"; do IFS='|' read -r b who _ <<<"$row"
    [[ -z "${ONLY}" || "${ONLY}" == "${who}" || "${PHASE}" == verify ]] || continue
    for perm in $(need_perms "${b}|${who}"); do
      out="$(read_g policy-troubleshoot iam "//storage.googleapis.com/projects/_/buckets/${BUCKET[$b]}" --principal-email="${MEMBER[$who]}" --permission="${perm}" --format='value(access)' 2>/dev/null || true)"
      if [[ "${out}" == GRANTED ]]; then echo "   PASS ${who} ${perm} on ${BUCKET[$b]}"; else echo "   FAIL ${who} ${perm} on ${BUCKET[$b]} (got '${out:-no answer}')"; bad=1; fi
    done
  done; return $bad; }

report() {
  echo "== PHASE ${PHASE}${ONLY:+ (only ${ONLY})}  project=${PROJECT_ID}"
  for n in "${NOTES[@]:-}"; do [[ -n "$n" ]] && echo "   note: $n"; done
  if [[ ${#BLOCKERS[@]} -gt 0 ]]; then echo "-- BLOCKERS"; for x in "${BLOCKERS[@]}"; do echo "   ! $x"; done; echo "Refusing: resolve the blockers above by hand." >&2; exit 1; fi; }

# --- phases -------------------------------------------------------------------------------------------------------------------
case "${PHASE}" in
plan)
  report
  echo "-- Current vs target (per bucket and identity)"
  for b in Q I E; do for who in backend scanner ai; do
    cur="$(roles_of "$b" "$who" | tr '\n' ' ')"; tgt=""
    for row in "${TARGET[@]}"; do [[ "$row" == "$b|$who|"* ]] && tgt="${row##*|}"; done
    printf '   %-28s %-8s current=[%s] target=[%s]\n' "${BUCKET[$b]}" "$who" "${cur:-none}" "${tgt:-none}"
  done; done
  echo "-- Steps (nothing below was executed)"
  echo "   1. --phase add      create missing custom roles; add the TARGET bindings that are absent (never removes)"
  echo "   2. --phase verify   Policy Troubleshooter must GRANT every required permission"
  echo "   3. --phase remove --only <identity>   one identity at a time: backend, then scanner, then ai (each re-verifies first)"
  echo "   Rollback per identity: --phase rollback --only <identity>"
  ;;
add)
  report
  [[ "${CONFIRM}" == "${PROJECT_ID}:add" ]] || { echo "--phase add requires --confirm ${PROJECT_ID}:add" >&2; exit 4; }
  for r in "${!ROLE_PERMS[@]}"; do
    [[ "$(role_state "$r" "${ROLE_PERMS[$r]}")" == ABSENT ]] && mutate_g iam roles create "$r" --project "${PROJECT_ID}" --title "TES ${r}" --permissions "${ROLE_PERMS[$r]}" --stage GA
  done
  for row in "${TARGET[@]}"; do IFS='|' read -r b who role <<<"$row"
    if has_binding "$b" "$who" "$role"; then echo "   already present: ${who} ${role} on ${BUCKET[$b]}"
    else mutate_g storage buckets add-iam-policy-binding "gs://${BUCKET[$b]}" --project "${PROJECT_ID}" --member "serviceAccount:${MEMBER[$who]}" --role "${role}"; fi
  done
  echo "Added only. Run --phase verify next; nothing was removed." ;;
verify)
  report
  verify_target && echo "All required permissions are granted." || { echo "Verification failed: do not remove anything." >&2; exit 1; }
  if [[ ${FINAL} -eq 1 ]]; then
    bad=0
    for b in Q I E; do for who in backend scanner ai; do for perm in ${DENIED_PERMS}; do
      out="$(read_g policy-troubleshoot iam "//storage.googleapis.com/projects/_/buckets/${BUCKET[$b]}" --principal-email="${MEMBER[$who]}" --permission="${perm}" --format='value(access)' 2>/dev/null || true)"
      # Only an explicit NOT_GRANTED proves denial. GRANTED, UNKNOWN_CONDITIONAL, UNKNOWN_INFO_DENIED or no answer all fail closed.
      if [[ "${out}" == NOT_GRANTED ]]; then echo "   PASS ${who} denied ${perm} on ${BUCKET[$b]}"; else echo "   FAIL ${who} ${perm} on ${BUCKET[$b]} is not proven denied (got '${out:-no answer}')"; bad=1; fi
    done; done; done
    [[ $bad -eq 0 ]] || { echo "Final verification failed: an excess permission remains or denial could not be proven (check inherited project/folder/org roles and your Policy Troubleshooter access)." >&2; exit 1; }
    echo "Final state verified: delete/update/setIamPolicy are denied for backend, scanner and ai on all three buckets."
  fi ;;
remove)
  report
  [[ "${CONFIRM}" == "${PROJECT_ID}:remove:${ONLY}" ]] || { echo "--phase remove requires --confirm ${PROJECT_ID}:remove:${ONLY}" >&2; exit 4; }
  for row in "${TARGET[@]}"; do IFS='|' read -r b who role <<<"$row"
    [[ "$who" == "$ONLY" ]] && ! has_binding "$b" "$who" "$role" && { echo "Precondition failed: target ${role} for ${who} on ${BUCKET[$b]} is not present; run --phase add first." >&2; exit 5; }
  done
  verify_target || { echo "Precondition failed: required permissions are not granted; nothing removed." >&2; exit 5; }
  for row in "${EXCESS[@]}"; do IFS='|' read -r b who role <<<"$row"; [[ "$who" == "$ONLY" ]] || continue
    if has_binding "$b" "$who" "$role"; then mutate_g storage buckets remove-iam-policy-binding "gs://${BUCKET[$b]}" --project "${PROJECT_ID}" --member "serviceAccount:${MEMBER[$who]}" --role "${role}"
    else echo "   already absent: ${who} ${role} on ${BUCKET[$b]}"; fi
  done
  echo "Removed ${ONLY}'s excess bindings. Re-run --phase verify, then watch the checks in the plan before the next identity." ;;
rollback)
  [[ "${CONFIRM}" == "${PROJECT_ID}:rollback:${ONLY}" ]] || { echo "--phase rollback requires --confirm ${PROJECT_ID}:rollback:${ONLY}" >&2; exit 4; }
  for row in "${EXCESS[@]}"; do IFS='|' read -r b who role <<<"$row"; [[ "$who" == "$ONLY" ]] || continue
    if has_binding "$b" "$who" "$role"; then echo "   already present: ${who} ${role} on ${BUCKET[$b]}"
    else mutate_g storage buckets add-iam-policy-binding "gs://${BUCKET[$b]}" --project "${PROJECT_ID}" --member "serviceAccount:${MEMBER[$who]}" --role "${role}"; fi
  done
  echo "Restored ${ONLY}'s original bindings (target bindings were left in place)." ;;
esac
