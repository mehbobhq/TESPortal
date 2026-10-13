#!/usr/bin/env python3
"""Read-only stand-in for gcloud for iam-preflight tests. Scenario flags in $FAKE_FLAGS; every call is logged to $FAKE_LOG."""
import json, os, sys

args = sys.argv[1:]
flags = set(filter(None, os.environ.get("FAKE_FLAGS", "").split(",")))
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(" ".join(args) + "\n")
P = "tes-production-510007"
SA = lambda n: f"serviceAccount:{n}@{P}.iam.gserviceaccount.com"
COMMIT = os.environ.get("FAKE_COMMIT", "a" * 40)
DIGEST = "sha256:" + "b" * 64
PRE = {
    "roles/storage.objectAdmin": ["storage.objects.get", "storage.objects.create", "storage.objects.list", "storage.objects.delete", "storage.objects.update", "storage.objects.setIamPolicy"],
    "roles/storage.objectCreator": ["storage.objects.create"],
    "roles/editor": ["storage.objects.get", "storage.objects.create", "storage.objects.list", "storage.objects.delete", "storage.objects.update", "storage.objects.setIamPolicy", "storage.buckets.get"],
    "roles/viewer": ["storage.buckets.get"],
    "roles/run.invoker": ["run.routes.invoke"],
}
CUSTOM = {
    "tesScannerQuarantineReader": ["storage.objects.get"], "tesScannerIntakeWriter": ["storage.objects.create", "storage.objects.get"],
    "tesPortalObjectReader": ["storage.objects.get"], "tesPortalEvidenceWriter": ["storage.objects.create", "storage.objects.get"],
}
after_add = "after_add" in flags
buckets = {
    "tes-production-quarantine": [{"role": "roles/storage.objectCreator", "members": [SA("tes-backend")]}, {"role": "roles/storage.objectAdmin", "members": [SA("tes-security-scanner"), SA("tes-ai-doc-processor")]}],
    "tes-production-intake": [{"role": "roles/storage.objectAdmin", "members": [SA("tes-backend"), SA("tes-ai-doc-processor")]}, {"role": "roles/storage.objectCreator", "members": [SA("tes-security-scanner")]}],
    "tes-production-evidence": [{"role": "roles/storage.objectAdmin", "members": [SA("tes-backend"), SA("tes-ai-doc-processor")]}],
}
if after_add:
    buckets["tes-production-quarantine"].append({"role": f"projects/{P}/roles/tesScannerQuarantineReader", "members": [SA("tes-security-scanner")]})
    buckets["tes-production-intake"] += [{"role": f"projects/{P}/roles/tesPortalObjectReader", "members": [SA("tes-backend")]}, {"role": f"projects/{P}/roles/tesScannerIntakeWriter", "members": [SA("tes-security-scanner")]}]
    buckets["tes-production-evidence"].append({"role": f"projects/{P}/roles/tesPortalEvidenceWriter", "members": [SA("tes-backend")]})
project = [{"role": "roles/run.invoker", "members": [SA("tes-eventarc-scanner-trigger")]}]
if "editor_inherited" in flags:
    project.append({"role": "roles/editor", "members": [SA("tes-backend")]})
if "group_binding" in flags:
    project.append({"role": "roles/editor", "members": ["group:ops@example.com"]})
if "conditional_inherited" in flags:
    project.append({"role": "roles/editor", "members": [SA("tes-security-scanner")], "condition": {"title": "t", "expression": "true"}})
folder = [{"role": "roles/viewer", "members": ["group:everyone@example.com"]}]
org = []

def out(o):
    print(o if isinstance(o, str) else json.dumps(o)); sys.exit(0)
def fail(msg="ERROR"):
    sys.stderr.write(msg + "\n"); sys.exit(1)
def has(*w): return all(x in args for x in w)

if "--help" in args:
    if "unsupported" in flags and "policy-troubleshoot" in args: fail("unrecognized command")
    text = "usage: gcloud ... --show-provenance\n" if "images" in args else "usage: gcloud ...\n"
    out(text)
if args[:1] == ["version"]: out("Google Cloud SDK 999.0.0\n")
if has("auth", "list"): out("operator@example.com\n")
if has("storage", "buckets", "describe"):
    out({"location": "US", "location_type": "multi-region", "uniform_bucket_level_access": True, "public_access_prevention": "enforced"})
if has("storage", "buckets", "get-iam-policy"):
    b = [a for a in args if a.startswith("gs://")][0][5:]
    if "bucket_unreadable" in flags and b.endswith("evidence"): fail("403")
    out({"bindings": buckets[b]})
if has("projects", "get-ancestors"):
    out([{"id": P, "type": "project"}, {"id": "111", "type": "folder"}, {"id": "222", "type": "organization"}])
if has("projects", "get-iam-policy"): out({"bindings": project})
if has("resource-manager", "folders", "get-iam-policy"):
    if "ancestor_unreadable" in flags: fail("403")
    out({"bindings": folder})
if has("organizations", "get-iam-policy"):
    if "ancestor_unreadable" in flags: fail("403")
    out({"bindings": org})
if has("iam", "roles", "describe"):
    name = [a for a in args if a not in ("iam", "roles", "describe", "--project", P, "--format=json") and not a.startswith("--")][0]
    key = name.split("/")[-1]
    if name in PRE: out({"name": name, "includedPermissions": PRE[name]})
    if key in CUSTOM: out({"name": f"projects/{P}/roles/{key}", "includedPermissions": CUSTOM[key]})
    fail("not found")
if has("iam", "roles", "list"):
    out([{"name": f"projects/{P}/roles/{k}", "includedPermissions": v, "stage": "GA"} for k, v in CUSTOM.items()] if after_add else [])
if has("policy-troubleshoot", "iam"):
    if "ts_unknown" in flags: out("UNKNOWN_INFO_DENIED")
    res = [a for a in args if a.startswith("//")][0]; b = res.rsplit("/", 1)[1]
    email = [a for a in args if a.startswith("--principal-email=")][0].split("=", 1)[1]; perm = [a for a in args if a.startswith("--permission=")][0].split("=", 1)[1]
    granted = False
    for pol in (buckets[b], project, folder, org):
        for bd in pol:
            if f"serviceAccount:{email}" in bd["members"] and not bd.get("condition"):
                r = bd["role"]; perms = PRE.get(r) or CUSTOM.get(r.split("/")[-1], [])
                granted = granted or perm in perms
    out("GRANTED" if granted else "NOT_GRANTED")
if has("run", "services", "describe"):
    sa = f"tes-backend@{P}.iam.gserviceaccount.com" if "scanner_wrong_account" in flags else f"tes-security-scanner@{P}.iam.gserviceaccount.com"
    out({"status": {"latestReadyRevisionName": "document-security-scanner-00007"}, "spec": {"template": {"spec": {"serviceAccountName": sa, "containers": [{"image": f"us-central1-docker.pkg.dev/{P}/tes-scanner/document-security-scanner:latest"}]}}}})
if has("run", "revisions", "describe"): out({"status": {"imageDigest": f"us-central1-docker.pkg.dev/{P}/tes-scanner/document-security-scanner@{DIGEST}"}})
if has("artifacts", "docker", "images", "describe"):
    if "no_provenance" in flags: fail("no provenance")
    out({"provenance_summary": {"provenance": [{"kind": "BUILD", "build": {"provenance": {"id": f"projects/{P}/locations/global/builds/11111111-2222-3333-4444-555555555555"}}}]}})
if has("builds", "describe"):
    if "storage_source" in flags: out({"source": {"storageSource": {"bucket": "x", "object": "y"}}})
    out({"source": {"repoSource": {"commitSha": COMMIT}}, "substitutions": {}})
if has("eventarc", "triggers", "describe"):
    out({"serviceAccount": f"tes-eventarc-scanner-trigger@{P}.iam.gserviceaccount.com", "destination": {"cloudRun": {"service": "document-security-scanner", "region": "us-central1"}}, "eventFilters": [{"attribute": "bucket", "value": "tes-production-quarantine"}]})
sys.stderr.write("fake gcloud: unhandled: " + " ".join(args) + "\n"); sys.exit(99)
