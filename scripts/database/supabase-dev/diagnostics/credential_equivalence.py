#!/usr/bin/env python3
"""TEMPORARY one-time credential-equivalence diagnostic (Supabase development backend password). Remove after use.

Question answered: is the SUPABASE_DEV_BACKEND_PASSWORD GitHub secret byte-for-byte the password that works locally?
Answer given: exactly one word, MATCH, MISMATCH or INCONCLUSIVE. Nothing else is printed by either side.

  local    run on YOUR machine. Reads the working password from the terminal (no echo, never argv, never a file or
           the environment), makes a fresh 256-bit one-time key, computes HMAC-SHA-256(key, label || password) and
           stores ONLY the key and that MAC as two GitHub environment secrets through `gh` (value on stdin). The
           password itself is never sent anywhere; neither the key nor the MAC is printed or written to disk.
  compare  run by the GitHub workflow. Recomputes the MAC from the SUPABASE_DEV_BACKEND_PASSWORD secret with the same
           key and compares in constant time. Prints the verdict only.
  cleanup  deletes the two one-time secrets with `gh`.

Python 3 standard library only. Run with `python3 -I` so no local module can shadow the standard library.
"""
import getpass
import hashlib
import hmac
import os
import secrets
import subprocess
import sys

REPO = "mehbobhq/TESPortal"
ENVIRONMENT = "supabase-dev"
KEY_SECRET = "SUPABASE_DEV_CMP_KEY"
MAC_SECRET = "SUPABASE_DEV_CMP_EXPECTED"
LABEL = b"tes-supabase-dev-backend-password-equivalence-v1\x00"


def mac(key_hex: str, password: str) -> str:
    key = bytes.fromhex(key_hex)
    if len(key) != 32:
        raise ValueError("key length")
    return hmac.new(key, LABEL + password.encode("utf-8"), hashlib.sha256).hexdigest()


def verdict(env) -> str:
    """MATCH / MISMATCH / INCONCLUSIVE from the environment; never raises, never leaks."""
    try:
        password = env.get("SUPABASE_DEV_BACKEND_PASSWORD", "")
        key_hex = env.get(KEY_SECRET, "")
        expected = env.get(MAC_SECRET, "")
        if not password or not key_hex or not expected:
            return "INCONCLUSIVE"
        if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
            return "INCONCLUSIVE"
        return "MATCH" if hmac.compare_digest(mac(key_hex, password), expected) else "MISMATCH"
    except BaseException:  # noqa: BLE001 - any failure is inconclusive, and its text could contain a value
        return "INCONCLUSIVE"


def gh_run(args, value=None) -> bool:
    try:
        r = subprocess.run(["gh", *args], input=value, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        return r.returncode == 0
    except BaseException:  # noqa: BLE001
        return False


def read_password() -> str:
    if sys.stdin.isatty():
        return getpass.getpass("Working backend password (not echoed): ")
    line = sys.stdin.readline()
    return line[:-1] if line.endswith("\n") else line  # only the line terminator is removed


def main(argv) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    if mode == "compare":
        v = verdict(os.environ)
        print(v)
        return 0 if v == "MATCH" else 1
    if mode == "local":
        password = read_password()
        if not password:
            print("INCONCLUSIVE: no password was entered.")
            return 1
        key_hex = secrets.token_hex(32)
        expected = mac(key_hex, password)
        del password
        target = ["--env", ENVIRONMENT, "--repo", REPO]
        ok = gh_run(["secret", "set", KEY_SECRET, *target], key_hex.encode()) and gh_run(["secret", "set", MAC_SECRET, *target], expected.encode())
        if not ok:
            gh_run(["secret", "delete", KEY_SECRET, *target])
            gh_run(["secret", "delete", MAC_SECRET, *target])
            print("INCONCLUSIVE: the one-time secrets could not be stored (is `gh` installed, logged in and allowed to write environment secrets?). Nothing was kept.")
            return 1
        print("Stored the one-time comparison secrets. Now dispatch the 'Supabase Dev Credential Equivalence' workflow, then run: python3 -I %s cleanup" % os.path.basename(argv[0]))
        return 0
    if mode == "cleanup":
        target = ["--env", ENVIRONMENT, "--repo", REPO]
        a = gh_run(["secret", "delete", KEY_SECRET, *target])
        b = gh_run(["secret", "delete", MAC_SECRET, *target])
        print("Deleted both one-time secrets." if a and b else "Could not confirm deletion of both secrets; delete SUPABASE_DEV_CMP_KEY and SUPABASE_DEV_CMP_EXPECTED in the environment settings.")
        return 0 if a and b else 1
    print("usage: credential_equivalence.py local|compare|cleanup", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
