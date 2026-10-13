#!/usr/bin/env python3
"""Stateful offline stand-in for gcloud, used only by reconcile-iam.test.sh. State lives in $FAKE_STATE; every call is logged to $FAKE_LOG."""
import json, os, sys

args = sys.argv[1:]
cmd = " ".join(args)
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(cmd + "\n")
state_path = os.environ["FAKE_STATE"]
state = json.load(open(state_path))
P = "tes-production-510007"
PREDEFINED = {
    "roles/storage.objectAdmin": {"storage.objects.get", "storage.objects.create", "storage.objects.delete", "storage.objects.update", "storage.objects.list", "storage.objects.setIamPolicy"},
    "roles/storage.objectCreator": {"storage.objects.create"},
}

def opt(name):
    for a in args:
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    if name in args:
        return args[args.index(name) + 1]
    return None

def save():
    json.dump(state, open(state_path, "w"))

def role_perms(role):
    if role in PREDEFINED:
        return PREDEFINED[role]
    for r in state["roles"]:
        if r["name"].endswith("/roles/" + role.split("/")[-1]) and not r.get("deleted"):
            return set(r["includedPermissions"])
    return set()

if args[:2] == ["auth", "list"]:
    print("operator@example.com"); sys.exit(0)
if "get-iam-policy" in args:
    b = args[args.index("get-iam-policy") + 1].replace("gs://", "")
    print(json.dumps({"bindings": state["buckets"][b], "etag": "x"})); sys.exit(0)
if args[:3] == ["iam", "roles", "list"]:
    print(json.dumps(state["roles"])); sys.exit(0)
if args[:3] == ["iam", "roles", "create"]:
    state["roles"].append({"name": f"projects/{P}/roles/{args[3]}", "includedPermissions": opt("--permissions").split(","), "stage": "GA"}); save(); sys.exit(0)
if "add-iam-policy-binding" in args or "remove-iam-policy-binding" in args:
    b = [a for a in args if a.startswith("gs://")][0].replace("gs://", "")
    member, role = opt("--member"), opt("--role")
    bindings = state["buckets"][b]
    if "add-iam-policy-binding" in args:
        for x in bindings:
            if x["role"] == role and not x.get("condition"):
                if member not in x["members"]: x["members"].append(member)
                break
        else:
            bindings.append({"role": role, "members": [member]})
    else:
        for x in list(bindings):
            if x["role"] == role and member in x["members"] and not x.get("condition"):
                x["members"].remove(member)
                if not x["members"]: bindings.remove(x)
    save(); sys.exit(0)
if args[:2] == ["policy-troubleshoot", "iam"]:
    b = args[2].rsplit("/", 1)[1]
    email, perm = opt("--principal-email"), opt("--permission")
    granted = any(f"serviceAccount:{email}" in x["members"] and perm in role_perms(x["role"]) for x in state["buckets"][b])
    print("GRANTED" if granted else "NOT_GRANTED"); sys.exit(0)
sys.stderr.write(f"fake gcloud: unhandled command: {cmd}\n")
sys.exit(99)
