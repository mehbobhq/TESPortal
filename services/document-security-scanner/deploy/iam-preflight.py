#!/usr/bin/env python3
"""STRICTLY READ-ONLY production IAM preflight (Cloud Shell).

    python3 iam-preflight.py [--repo-dir PATH]

It issues only read-only gcloud commands (an allow-list refuses everything else, including `config set`), writes nothing, and never
treats an inconclusive answer as a denial: GRANTED and NOT_GRANTED are the only conclusive answers; everything else is UNKNOWN.
If a required gcloud command is not supported by this Cloud Shell's gcloud, it STOPS (exit 3) instead of substituting another command.

Exit codes: 0 completed (read the DECISION lines), 3 unsupported gcloud command or no active identity, 2 usage.
"""
import json
import os
import re
import subprocess
import sys
from collections import OrderedDict

GCLOUD = os.environ.get("GCLOUD", "gcloud").split()
P = os.environ.get("PROJECT_ID", "tes-production-510007")
R = os.environ.get("REGION", "us-central1")
TRIGGER_LOCATION = os.environ.get("TRIGGER_LOCATION", "us")
SERVICE = os.environ.get("SERVICE", "document-security-scanner")
TRIGGER = os.environ.get("TRIGGER_NAME", "tes-quarantine-document-scanner")
BUCKETS = OrderedDict([("Q", os.environ.get("QUARANTINE_BUCKET", "tes-production-quarantine")),
                       ("I", os.environ.get("INTAKE_BUCKET", "tes-production-intake")),
                       ("E", os.environ.get("EVIDENCE_BUCKET", "tes-production-evidence"))])
SA = lambda n: f"{n}@{P}.iam.gserviceaccount.com"
IDENT = OrderedDict([("backend", SA("tes-backend")), ("scanner", SA("tes-security-scanner")), ("ai", SA("tes-ai-doc-processor")),
                     ("trigger", SA("tes-eventarc-scanner-trigger"))])
PERMS = ["get", "create", "list", "delete", "update", "setIamPolicy"]
FULL = {p: f"storage.objects.{p}" for p in PERMS}
# What each identity may do in the TARGET state; every other (bucket, permission) must be denied.
TARGET_ALLOWED = {
    "backend": {"Q": {"create"}, "I": {"get"}, "E": {"create", "get"}},
    "scanner": {"Q": {"get"}, "I": {"create", "get"}, "E": set()},
    "ai": {"Q": set(), "I": set(), "E": set()},   # informational only: its retirement is a separate decision
}
TARGET_ROLES = {   # bucket-level bindings the add phase creates
    ("Q", "backend"): f"roles/storage.objectCreator", ("Q", "scanner"): f"projects/{P}/roles/tesScannerQuarantineReader",
    ("I", "backend"): f"projects/{P}/roles/tesPortalObjectReader", ("I", "scanner"): f"projects/{P}/roles/tesScannerIntakeWriter",
    ("E", "backend"): f"projects/{P}/roles/tesPortalEvidenceWriter",
}
RECORDED_DRIFT = {("Q", "scanner"): "roles/storage.objectAdmin", ("Q", "ai"): "roles/storage.objectAdmin", ("I", "backend"): "roles/storage.objectAdmin",
                  ("I", "scanner"): "roles/storage.objectCreator", ("I", "ai"): "roles/storage.objectAdmin", ("E", "backend"): "roles/storage.objectAdmin",
                  ("E", "ai"): "roles/storage.objectAdmin", ("Q", "backend"): "roles/storage.objectCreator"}
CUSTOM_ROLES = {"tesScannerQuarantineReader": ["storage.objects.get"], "tesScannerIntakeWriter": ["storage.objects.create", "storage.objects.get"],
                "tesPortalObjectReader": ["storage.objects.get"], "tesPortalEvidenceWriter": ["storage.objects.create", "storage.objects.get"]}
BROAD_ROLES = {"roles/owner", "roles/editor"}

FORBIDDEN = {"create", "delete", "add-iam-policy-binding", "remove-iam-policy-binding", "set-iam-policy", "replace", "submit", "deploy", "update",
             "update-traffic", "enable", "disable", "patch", "import", "undelete", "set", "config", "activate-service-account", "login", "revoke"}
ALLOWED = {"describe", "list", "get-iam-policy", "get-ancestors", "policy-troubleshoot", "version", "--help"}


def gcloud(args, *, check_json=False):
    """Run one read-only gcloud command. Returns (rc, stdout, stderr). Refuses anything that is not on the read-only allow-list."""
    bad = [a for a in args if a in FORBIDDEN]
    if bad or not any(a in ALLOWED for a in args):
        print(f"INTERNAL ERROR: refusing non-read-only gcloud command: {' '.join(args)}", file=sys.stderr)
        sys.exit(70)
    env = dict(os.environ, CLOUDSDK_CORE_DISABLE_PROMPTS="1", CLOUDSDK_PAGER="")
    proc = subprocess.run(GCLOUD + args, capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)
    return proc.returncode, proc.stdout, proc.stderr


def gjson(args):
    rc, out, _ = gcloud(args + ["--format=json"])
    if rc != 0:
        return None
    try:
        return json.loads(out) if out.strip() else None
    except ValueError:
        return None


# ---------------------------------------------------------------------------------------------------------------- 0. environment
def header(t):
    print(f"\n=== {t}")


print("TES production IAM preflight (read-only)")
rc, ver, _ = gcloud(["version"])
print("gcloud:", (ver.strip().splitlines() or ["(no output)"])[0])

header("1. Command support (stops on any unsupported command; nothing is substituted)")
PROBES = [["auth", "list"], ["storage", "buckets", "describe"], ["storage", "buckets", "get-iam-policy"], ["projects", "get-iam-policy"],
          ["projects", "get-ancestors"], ["resource-manager", "folders", "get-iam-policy"], ["organizations", "get-iam-policy"],
          ["iam", "roles", "describe"], ["iam", "roles", "list"], ["policy-troubleshoot", "iam"], ["run", "services", "describe"],
          ["run", "revisions", "describe"], ["artifacts", "docker", "images", "describe"], ["builds", "describe"], ["eventarc", "triggers", "describe"]]
unsupported = []
for probe in PROBES:
    rc, out, err = gcloud(probe + ["--help"])
    if rc != 0:
        unsupported.append(" ".join(probe))
    elif probe[:3] == ["artifacts", "docker", "images"] and "--show-provenance" not in out:
        unsupported.append("artifacts docker images describe --show-provenance")
    else:
        print(f"   supported: gcloud {' '.join(probe)}")
if unsupported:
    print("\nSTOP: this gcloud does not support:", file=sys.stderr)
    for u in unsupported:
        print(f"   - gcloud {u}", file=sys.stderr)
    print("Do not substitute other commands. Update Cloud Shell's gcloud (or use a newer one) and re-run.", file=sys.stderr)
    sys.exit(3)

rc, acct, _ = gcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"])
operator = acct.strip().splitlines()[0] if acct.strip() else ""
if not operator:
    print("STOP: no active gcloud identity.", file=sys.stderr)
    sys.exit(3)
print(f"operator identity: {operator}")
if operator in IDENT.values():
    print("STOP: run as a human operator, not one of the service accounts under test.", file=sys.stderr)
    sys.exit(3)

UNKNOWN_REASONS = []   # every inconclusive item, listed in the report


def unknown(msg):
    UNKNOWN_REASONS.append(msg)
    print(f"   UNKNOWN: {msg}")


# ---------------------------------------------------------------------------------------------------------------- 2. bucket policies
header("2. Bucket IAM policies (bucket-level only; NOT assumed to show effective access)")
bucket_policy = {}
for b, name in BUCKETS.items():
    pol = gjson(["storage", "buckets", "get-iam-policy", f"gs://{name}", "--project", P])
    if pol is None:
        unknown(f"cannot read the IAM policy of gs://{name}")
    bucket_policy[b] = pol
    meta = gjson(["storage", "buckets", "describe", f"gs://{name}", "--project", P])
    if meta:
        print(f"   {name}: location={meta.get('location')} type={meta.get('location_type')} uniform={meta.get('uniform_bucket_level_access')} pap={meta.get('public_access_prevention')}")
    else:
        unknown(f"cannot read gs://{name} metadata")

blockers_add = []
for b, pol in bucket_policy.items():
    if pol is None:
        continue
    for binding in pol.get("bindings", []):
        members = binding.get("members", [])
        if any(m in ("allUsers", "allAuthenticatedUsers") for m in members):
            blockers_add.append(f"gs://{BUCKETS[b]} grants {binding['role']} to a public principal")
        for who, email in IDENT.items():
            if f"serviceAccount:{email}" in members:
                known = {TARGET_ROLES.get((b, who)), RECORDED_DRIFT.get((b, who))}
                if binding.get("condition"):
                    blockers_add.append(f"{who} has a CONDITIONAL binding {binding['role']} on gs://{BUCKETS[b]}")
                elif binding["role"] not in known:
                    blockers_add.append(f"{who} has an UNLISTED binding {binding['role']} on gs://{BUCKETS[b]}")

# ---------------------------------------------------------------------------------------------------------------- 3. project + ancestors
header("3. Project and ancestor IAM (folders, organization)")
levels = []   # (label, policy or None)
anc = gjson(["projects", "get-ancestors", P])
if anc is None:
    unknown("cannot read the project's ancestors")
    anc = []
levels.append((f"project/{P}", gjson(["projects", "get-iam-policy", P])))
for node in anc:
    t, i = node.get("type"), node.get("id")
    if t == "folder":
        levels.append((f"folder/{i}", gjson(["resource-manager", "folders", "get-iam-policy", str(i)])))
    elif t == "organization":
        levels.append((f"organization/{i}", gjson(["organizations", "get-iam-policy", str(i)])))
for label, pol in levels:
    if pol is None:
        unknown(f"cannot read the IAM policy of {label}")
    else:
        print(f"   read {label}: {len(pol.get('bindings', []))} bindings")

role_cache = {}


def role_permissions(role):
    """Permissions of a role, or None if it cannot be read."""
    if role in role_cache:
        return role_cache[role]
    if role.startswith("projects/"):
        d = gjson(["iam", "roles", "describe", role.rsplit("/", 1)[1], "--project", P])
    elif role.startswith("organizations/"):
        d = gjson(["iam", "roles", "describe", role.rsplit("/", 1)[1], "--organization", role.split("/")[1]])
    else:
        d = gjson(["iam", "roles", "describe", role])
    role_cache[role] = None if d is None else set(d.get("includedPermissions", []))
    return role_cache[role]


def storage_relevant(perms):
    return {p for p in perms if p.startswith("storage.objects.") or p.startswith("storage.buckets.")} if perms else set()


inherited = {who: set() for who in IDENT}        # unconditional permissions granted at project/ancestor level
inherited_unknown = {who: [] for who in IDENT}   # conditional / unreadable / group-based
group_notes = []
for label, pol in levels:
    if pol is None:
        continue
    for binding in pol.get("bindings", []):
        members, role = binding.get("members", []), binding["role"]
        perms = role_permissions(role)
        for who, email in IDENT.items():
            if f"serviceAccount:{email}" in members:
                if perms is None:
                    inherited_unknown[who].append(f"{role} at {label} (role definition unreadable)")
                elif binding.get("condition"):
                    if storage_relevant(perms):
                        inherited_unknown[who].append(f"{role} at {label} is CONDITIONAL")
                else:
                    inherited[who] |= perms
                    if role in BROAD_ROLES or any(p in perms for p in FULL.values()):
                        print(f"   inherited: {who} holds {role} at {label}")
        for m in members:
            if m.split(":")[0] in ("group", "domain") and perms is not None and storage_relevant(perms) & set(FULL.values()):
                group_notes.append(f"{m} holds {role} at {label}: membership of the service accounts cannot be checked read-only")
for note in sorted(set(group_notes)):
    unknown(note)
for who, items in inherited_unknown.items():
    for it in items:
        unknown(f"{who}: {it}")

# ---------------------------------------------------------------------------------------------------------------- 4. matrix
header("4. Permission matrix (Policy Troubleshooter, cross-checked against the policies above)")
print("   Each cell is: current / target.  G=GRANTED  N=NOT_GRANTED  ?=UNKNOWN (never read as denial).")
print("   A cell is conclusive only when the troubleshooter and the project/ancestor/bucket policies agree; otherwise it is '?'.")
bucket_sets = {}   # (b, who) -> permissions from bucket-level bindings


def derive(b, who):
    """Permissions from bucket-level plus inherited bindings. Returns (set_of_granted, uncertain)."""
    pol = bucket_policy.get(b)
    if pol is None:
        return set(), True
    perms, uncertain = set(), bool(inherited_unknown[who]) or any(pol is None for _, pol in levels)
    for binding in pol.get("bindings", []):
        if f"serviceAccount:{IDENT[who]}" in binding.get("members", []):
            rp = role_permissions(binding["role"])
            if rp is None or binding.get("condition"):
                uncertain = True
            else:
                perms |= rp
    return perms | inherited[who], uncertain or bool(group_notes)


cells = {}
for who in ("backend", "scanner", "ai"):
    for b, name in BUCKETS.items():
        derived, uncertain = derive(b, who)
        for p in PERMS:
            rc, out, _ = gcloud(["policy-troubleshoot", "iam", f"//storage.googleapis.com/projects/_/buckets/{name}",
                                 f"--principal-email={IDENT[who]}", f"--permission={FULL[p]}", "--format=value(access)"])
            t = out.strip() if rc == 0 else ""
            tv = t if t in ("GRANTED", "NOT_GRANTED") else "UNKNOWN"
            if FULL[p] in derived:
                dv = "GRANTED"
            else:
                dv = "UNKNOWN" if uncertain else "NOT_GRANTED"
            final = tv if tv == dv else "UNKNOWN"
            if final == "UNKNOWN" and tv != dv:
                why = f"troubleshooter said '{t or 'no answer'}', policies imply {dv}"
                unknown(f"{who} {FULL[p]} on {name}: {why}")
            cells[(who, b, p)] = final
for who in ("backend", "scanner", "ai"):
    print(f"   {who}")
    print("      " + "perm".ljust(14) + "".join(f"{label:>14}" for label in ("quarantine", "intake", "evidence")))
    for p in PERMS:
        row = ""
        for b in BUCKETS:
            target = "ALLOW" if p in TARGET_ALLOWED[who][b] else "DENY"
            now = {"GRANTED": "G", "NOT_GRANTED": "N", "UNKNOWN": "?"}[cells[(who, b, p)]]
            row += f"{now + ' / ' + target:>14}"
        print("      " + p.ljust(14) + row)

# ---------------------------------------------------------------------------------------------------------------- 5. roles
header("5. Custom roles")
roles = gjson(["iam", "roles", "list", "--project", P, "--show-deleted"]) or []
role_problems = []
for name, want in CUSTOM_ROLES.items():
    r = next((x for x in roles if x.get("name", "").endswith(f"/roles/{name}")), None)
    if r is None:
        print(f"   {name}: absent (the add phase would create it with exactly {','.join(want)})")
    elif r.get("deleted") or sorted(r.get("includedPermissions", [])) != sorted(want):
        role_problems.append(f"custom role {name} exists but differs (deleted={r.get('deleted')}, permissions={r.get('includedPermissions')})")
    else:
        print(f"   {name}: present, exact")

# ---------------------------------------------------------------------------------------------------------------- 6. scanner
header("6. Deployed scanner: image digest, build provenance, repository commit, code inspection")
scanner_status, scanner_reason = "UNKNOWN", ""
repo = "."
if "--repo-dir" in sys.argv:
    repo = sys.argv[sys.argv.index("--repo-dir") + 1]
svc = gjson(["run", "services", "describe", SERVICE, "--region", R, "--project", P])
digest, image, rev, svc_account = "", "", "", ""
if svc is None:
    scanner_reason = "cannot read the Cloud Run service"
else:
    spec = svc.get("spec", {}).get("template", {}).get("spec", {})
    image = (spec.get("containers") or [{}])[0].get("image", "")
    svc_account = spec.get("serviceAccountName", "")
    rev = svc.get("status", {}).get("latestReadyRevisionName", "")
    print(f"   service account: {svc_account}\n   image: {image}\n   latest ready revision: {rev}")
    if svc_account != IDENT["scanner"]:
        unknown(f"the scanner service runs as '{svc_account}', not {IDENT['scanner']}")
    m = re.search(r"@(sha256:[0-9a-f]{64})", image)
    if m:
        digest = m.group(1)
    elif rev:
        rd = gjson(["run", "revisions", "describe", rev, "--region", R, "--project", P])
        digest = ((rd or {}).get("status", {}).get("imageDigest", "") or "")
        digest = digest.split("@")[-1] if digest else ""
    if not digest:
        scanner_reason = "the deployed image digest cannot be determined"
if digest and image:
    base = image.split("@")[0].split(":")[0]
    print(f"   digest: {digest}")
    prov = gjson(["artifacts", "docker", "images", "describe", f"{base}@{digest}", "--show-provenance"])
    if prov is None:
        scanner_reason = "no build provenance could be read for that digest"
    else:
        blob = json.dumps(prov)
        builds = sorted(set(re.findall(r"builds/([0-9a-f-]{36})", blob)) | set(re.findall(r'"build_?[iI]d"\s*:\s*"([0-9a-f-]{36})"', blob)))
        commits = set()
        for build_id in builds:
            bd = gjson(["builds", "describe", build_id, "--project", P])
            if bd is None:
                continue
            src = json.dumps(bd.get("source", {})) + json.dumps(bd.get("sourceProvenance", {})) + json.dumps(bd.get("substitutions", {}))
            commits |= set(re.findall(r"\b[0-9a-f]{40}\b", src))
            if "storageSource" in bd.get("source", {}) and not commits:
                scanner_reason = f"build {build_id} came from an uploaded source archive, not a git commit"
        print(f"   build ids in provenance: {builds or 'none'}\n   commits recorded: {sorted(commits) or 'none'}")
        if len(commits) == 1:
            commit = next(iter(commits))
            ok = subprocess.run(["git", "-C", repo, "cat-file", "-e", f"{commit}^{{commit}}"], capture_output=True).returncode == 0
            if not ok:
                scanner_reason = f"commit {commit[:12]} is not in this clone (fetch origin first)"
            else:
                reach = subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", commit, "origin/main"], capture_output=True).returncode == 0
                grep = subprocess.run(["git", "-C", repo, "grep", "-n", "-E", r"\.(delete|deleteFiles|move|rename|setMetadata|makePublic)\(", commit, "--",
                                       "services/document-security-scanner/src"], capture_output=True, text=True)
                if not reach:
                    scanner_reason = f"commit {commit[:12]} is not on origin/main"
                elif grep.returncode == 0:
                    scanner_status, scanner_reason = "DELETES", "the code at that commit contains a delete/move/rename call:\n" + grep.stdout
                else:
                    scanner_status, scanner_reason = "CONFIRMED_NO_DELETE", f"image built from {commit[:12]} (on origin/main); its scanner source has no delete/move/rename/setMetadata/makePublic call"
        elif not scanner_reason:
            scanner_reason = "provenance does not identify exactly one source commit" if commits else "provenance does not record a source commit"
print(f"   scanner verdict: {scanner_status} - {scanner_reason}")
if scanner_status != "CONFIRMED_NO_DELETE":
    print("   => the exact source is not established: scanner Admin-role removal stays BLOCKED")

# ---------------------------------------------------------------------------------------------------------------- 7. trigger (informational)
header("7. Eventarc trigger (informational)")
trg = gjson(["eventarc", "triggers", "describe", TRIGGER, "--location", TRIGGER_LOCATION, "--project", P])
if trg is None:
    unknown(f"cannot read trigger {TRIGGER} in {TRIGGER_LOCATION}")
else:
    print(f"   identity={trg.get('serviceAccount')} destination={trg.get('destination')} filters={trg.get('eventFilters')}")

# ---------------------------------------------------------------------------------------------------------------- 8. decisions
header("8. Decisions")


def baseline_unknowns(whos):
    return [f"{w} {FULL[p]} on {BUCKETS[b]}" for w in whos for b in BUCKETS for p in PERMS if cells[(w, b, p)] == "UNKNOWN"]


def removal_gate(who):
    reasons = []
    for b in BUCKETS:
        role = TARGET_ROLES.get((b, who))
        if role and not any(role == x["role"] and f"serviceAccount:{IDENT[who]}" in x.get("members", []) and not x.get("condition")
                            for x in (bucket_policy[b] or {}).get("bindings", [])):
            reasons.append(f"target binding {role} for {who} is not present on {BUCKETS[b]} (run the add phase first)")
    for b in BUCKETS:
        for p in TARGET_ALLOWED[who][b]:
            if cells[(who, b, p)] != "GRANTED":
                reasons.append(f"required {FULL[p]} for {who} on {BUCKETS[b]} is {cells[(who, b, p)]}")
    # Project/ancestor roles apply to every bucket, so a permission inherited from above must be allowed on ALL three buckets to be harmless.
    exposure = sorted(FULL[p] for p in PERMS if FULL[p] in inherited[who] and any(p not in TARGET_ALLOWED[who][b] for b in BUCKETS))
    if exposure:
        reasons.append(f"{who} would STILL hold {exposure} through project/ancestor roles after bucket-level removal")
    if inherited_unknown[who]:
        reasons.append(f"{who} has conditional/unreadable inherited grants: {inherited_unknown[who]}")
    if baseline_unknowns([who]):
        reasons.append(f"{len(baseline_unknowns([who]))} matrix cells for {who} are UNKNOWN")
    if group_notes:
        reasons.append("group/domain bindings with storage permissions exist (membership unknown)")
    if any(pol is None for _, pol in levels):
        reasons.append("a project or ancestor policy could not be read")
    if os.environ.get("MISSING_OBJECT_BEHAVIOR_EVIDENCE", "") != "404":
        reasons.append("GCS missing-object behavior under a get-only identity is UNRESOLVED (needs a separately approved test; set MISSING_OBJECT_BEHAVIOR_EVIDENCE=404 only with that evidence)")
    return reasons


def decide(name, reasons):
    print(f"DECISION {name}: {'NO-GO' if reasons else 'GO'}")
    for r in reasons:
        print(f"   - {r}")


add_reasons = list(blockers_add) + role_problems
if any(bucket_policy[b] is None for b in BUCKETS):
    add_reasons.append("a bucket IAM policy is unreadable")
if baseline_unknowns(["backend", "scanner"]):
    add_reasons.append(f"{len(baseline_unknowns(['backend', 'scanner']))} backend/scanner matrix cells are UNKNOWN, so the baseline is not established (Policy Troubleshooter must work to verify the add phase)")
if any(pol is None for _, pol in levels):
    add_reasons.append("a project or ancestor policy could not be read")
decide("add-replacement-permissions", add_reasons)
decide("remove-backend-broad-permissions", removal_gate("backend"))
scanner_reasons = removal_gate("scanner")
if scanner_status != "CONFIRMED_NO_DELETE":
    scanner_reasons.append(f"scanner source is {scanner_status}: {scanner_reason.splitlines()[0] if scanner_reason else 'not established'}")
if svc_account and svc_account != IDENT["scanner"]:
    scanner_reasons.append("the scanner service does not run as the scanner account")
decide("remove-scanner-broad-permissions", scanner_reasons)
decide("retire-ai-processor-access", ["not decided here: the AI processor's access and key stay unchanged until a separate dependency assessment is approved"])
print(f"\nUNKNOWN items: {len(UNKNOWN_REASONS)}")
