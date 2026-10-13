import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

const good = {
  GOOGLE_CLOUD_PROJECT_ID: "tes-test", GOOGLE_GCS_QUARANTINE_BUCKET: "tes-q", GOOGLE_GCS_INTAKE_BUCKET: "tes-i", GOOGLE_GCS_EVIDENCE_BUCKET: "tes-e",
};
const production = { ...good, GOOGLE_CLOUD_PROJECT_NUMBER: "1", GOOGLE_WIF_POOL_ID: "p", GOOGLE_WIF_PROVIDER_ID: "v", GOOGLE_BACKEND_SERVICE_ACCOUNT: "sa@x.iam.gserviceaccount.com", GOOGLE_WIF_OIDC_AUDIENCE: "aud" };

describe("evidence storage configuration verifier (fails safe)", () => {
  before(async () => {
    mod = await import("../../../scripts/storage/verify-evidence-storage-config.mjs");
  });

  it("passes a complete, keyless, three-bucket environment", () => {
    assert.deepEqual(mod.checkStorageEnvironment(good), []);
    assert.deepEqual(mod.checkStorageEnvironment(production, { production: true }), []);
  });

  it("fails when a bucket variable is missing, malformed or shared between roles", () => {
    assert.ok(mod.checkStorageEnvironment({ ...good, GOOGLE_GCS_EVIDENCE_BUCKET: "" }).some((p: string) => /GOOGLE_GCS_EVIDENCE_BUCKET/.test(p)));
    assert.ok(mod.checkStorageEnvironment({ ...good, GOOGLE_GCS_INTAKE_BUCKET: "Not A Bucket!" }).some((p: string) => /intake bucket name/.test(p)));
    assert.ok(mod.checkStorageEnvironment({ ...good, GOOGLE_GCS_INTAKE_BUCKET: "tes-q" }).some((p: string) => /three different buckets/.test(p)));
    assert.ok(mod.checkStorageEnvironment(good, { production: true }).some((p: string) => /GOOGLE_WIF_POOL_ID/.test(p)));
  });

  it("fails on any static credential and on browser-exposed storage settings, without echoing values", () => {
    const problems: string[] = mod.checkStorageEnvironment({ ...good, GOOGLE_PRIVATE_KEY: "super-secret-value", PGPASSWORD: "hunter2", NEXT_PUBLIC_GCS_BUCKET: "tes-e" });
    assert.ok(problems.some((p) => /GOOGLE_PRIVATE_KEY/.test(p)));
    assert.ok(problems.some((p) => /PGPASSWORD/.test(p)));
    assert.ok(problems.some((p) => /NEXT_PUBLIC_GCS_BUCKET/.test(p)));
    assert.ok(problems.every((p) => !/super-secret-value|hunter2/.test(p)), "values are never printed");
  });

  it("judges bucket safety: uniform access, enforced public-access prevention, versioning and retention on evidence, no public principals", () => {
    const safe = { iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "enforced" }, versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: "604800" } };
    assert.deepEqual(mod.checkBucketSafety("evidence", safe, ["serviceAccount:a@b.iam.gserviceaccount.com"]), []);
    assert.deepEqual(mod.checkBucketSafety("quarantine", { iamConfiguration: safe.iamConfiguration }, []), []);
    assert.ok(mod.checkBucketSafety("intake", { iamConfiguration: { uniformBucketLevelAccess: { enabled: false }, publicAccessPrevention: "enforced" } }, []).length === 1);
    assert.ok(mod.checkBucketSafety("intake", { iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "inherited" } }, []).length === 1);
    assert.ok(mod.checkBucketSafety("evidence", { iamConfiguration: safe.iamConfiguration }, []).length === 2);
    assert.ok(mod.checkBucketSafety("evidence", safe, ["allUsers"]).some((p: string) => /allUsers/.test(p)));
    assert.ok(mod.checkBucketSafety("evidence", safe, ["allAuthenticatedUsers"]).some((p: string) => /allAuthenticatedUsers/.test(p)));
    assert.ok(mod.checkBucketSafety("evidence", undefined, []).length >= 3, "unknown metadata fails safe");
  });
});
