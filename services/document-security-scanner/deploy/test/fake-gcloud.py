#!/usr/bin/env python3
"""Offline stand-in for gcloud, used only by deploy.test.sh. Logs every call; answers from a scenario chosen by FAKE_FLAGS."""
import json, os, sys

args = sys.argv[1:]
flags = set(filter(None, os.environ.get("FAKE_FLAGS", "").split(",")))
P = "tes-production-510007"
NUM = "123456789012"
SCN = f"tes-security-scanner@{P}.iam.gserviceaccount.com"
INV = f"tes-scanner-invoker@{P}.iam.gserviceaccount.com"
SHA = os.environ.get("FAKE_SHA", "0" * 40)
DIGEST = "sha256:" + "a" * 64
existing = "existing" in flags
cmd = " ".join(args)
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(cmd + "\n")

def out(obj):
    print(json.dumps(obj) if not isinstance(obj, str) else obj)
    sys.exit(0)

def has(*words):
    return all(w in args for w in words)

def policy(bindings):
    return {"bindings": bindings, "etag": "x"}

QROLE = f"projects/{P}/roles/tesScannerQuarantineReader"
IROLE = f"projects/{P}/roles/tesScannerIntakeWriter"

if has("auth", "list"):
    out("operator@example.com\n")
if has("services", "list", "--enabled"):
    out("\n".join(["run.googleapis.com", "eventarc.googleapis.com", "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "pubsub.googleapis.com", "storage.googleapis.com", "iam.googleapis.com"]) + "\n")
if has("projects", "describe"):
    out(NUM + "\n")
if has("eventarc", "locations", "list"):
    out([{"locationId": "us-east4"}, {"locationId": "us"}])
if has("storage", "buckets", "describe"):
    loc, typ = ("us-east4", "region")
    if "dual_region" in flags: loc, typ = ("nam4", "dual-region")
    out({"location": loc.upper(), "location_type": typ})
if has("iam", "service-accounts", "list"):
    out([{"email": SCN}, {"email": INV}] if existing else [])
if has("iam", "roles", "list"):
    if not existing: out([])
    q = ["storage.objects.get"]
    if "role_mismatch" in flags: q = ["storage.objects.get", "storage.objects.delete"]
    out([{"name": f"projects/{P}/roles/tesScannerQuarantineReader", "includedPermissions": q, "stage": "GA"},
         {"name": f"projects/{P}/roles/tesScannerIntakeWriter", "includedPermissions": ["storage.objects.create", "storage.objects.get"], "stage": "GA"}])
if has("storage", "buckets", "get-iam-policy"):
    target = args[args.index("get-iam-policy") + 1]
    b = []
    if existing:
        if target.endswith("quarantine"): b = [{"role": QROLE, "members": [f"serviceAccount:{SCN}"]}]
        if target.endswith("intake"):
            b = [{"role": IROLE, "members": [f"serviceAccount:{SCN}"]}]
            if "scanner_broad_intake" in flags: b.append({"role": "roles/storage.objectAdmin", "members": [f"serviceAccount:{SCN}"]})
        if target.endswith("evidence") and "scanner_on_evidence" in flags: b = [{"role": "roles/storage.objectViewer", "members": [f"serviceAccount:{SCN}"]}]
    out(policy(b))
if has("projects", "get-iam-policy"):
    b = [{"role": "roles/eventarc.serviceAgent", "members": [f"serviceAccount:service-{NUM}@gcp-sa-eventarc.iam.gserviceaccount.com"]}]
    if "no_eventarc_agent" in flags: b = []
    if existing or "grants_present" in flags:
        b += [{"role": "roles/eventarc.eventReceiver", "members": [f"serviceAccount:{INV}"]},
              {"role": "roles/pubsub.publisher", "members": [f"serviceAccount:service-{NUM}@gs-project-accounts.iam.gserviceaccount.com"]}]
    out(policy(b))
if has("artifacts", "repositories", "list"):
    out([{"name": f"projects/{P}/locations/us-east4/repositories/tes-scanner"}] if existing else [])
if has("artifacts", "docker", "images", "list"):
    out([{"package": "x", "version": DIGEST, "tags": [SHA]}] if existing else [])
if has("artifacts", "docker", "images", "describe"):
    out({"provenance_summary": {"provenance": [{"kind": "BUILD"}]}} if "no_provenance" not in flags else {"image_summary": {}})
if has("run", "services", "list"):
    if not existing: out([])
    out([{"metadata": {"name": "document-security-scanner"}, "spec": {"template": {"spec": {"serviceAccountName": INV if "service_wrong_sa" in flags else SCN, "containers": [{"image": "old"}]}}}}])
if has("run", "services", "get-iam-policy"):
    members = [f"serviceAccount:{INV}"] + (["allUsers"] if "public_service" in flags else [])
    out(policy([{"role": "roles/run.invoker", "members": members}]))
if has("eventarc", "triggers", "list"):
    if not existing: out([])
    bucket = "tes-production-other" if "trigger_mismatch" in flags else "tes-production-quarantine"
    out([{"name": f"projects/{P}/locations/us-east4/triggers/scanner-quarantine-finalized",
          "eventFilters": [{"attribute": "type", "value": "google.cloud.storage.object.v1.finalized"}, {"attribute": "bucket", "value": bucket}],
          "destination": {"cloudRun": {"service": "document-security-scanner", "region": "us-east4"}}, "serviceAccount": INV}])
if has("builds", "submit"):
    out([{"status": "SUCCESS", "results": {"images": [{"digest": DIGEST}]}}])
if "replace" in args:
    import shutil
    shutil.copy(args[args.index("replace") + 1], os.environ["FAKE_LOG"] + ".yaml")
# any mutating command the script is allowed to run in apply mode succeeds silently
if any(w in args for w in ("create", "replace", "add-iam-policy-binding")):
    sys.exit(0)
sys.stderr.write(f"fake gcloud: unhandled command: {cmd}\n")
sys.exit(99)
