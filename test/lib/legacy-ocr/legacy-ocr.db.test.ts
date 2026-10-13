// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
// The legacy OCR routes call authorizeLegacyOcr() before reading a single byte of the upload.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

const enabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
if (!enabled && process.env.TES_REQUIRE_DB_TESTS === "1") {
  it("requires a disposable test database (TES_REQUIRE_DB_TESTS=1)", () => assert.fail("TES_TEST_*_DATABASE_URL must be set"));
}

describe("legacy OCR authorization (real authorization kernel)", { skip: !enabled }, () => {
  let pools: Pools;
  let db: typeof import("@/test/helpers/auth-db");
  let authorize: typeof import("@/lib/legacy-ocr/authorize");
  let authz: typeof import("@/lib/auth/tes-authorization");
  const fixtures: AuthFixtures[] = [];

  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    db = await import("@/test/helpers/auth-db");
    authorize = await import("@/lib/legacy-ocr/authorize");
    authz = await import("@/lib/auth/tes-authorization");
    pools = db.openPools();
  });
  after(async () => {
    db.setClerkUser(null);
    for (const fx of fixtures) await fx.cleanup();
    await db.closePools();
  });

  async function signInWith(...capabilities: string[]) {
    const fx = new db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    db.setClerkUser(actor.clerkSubject);
  }

  it("a signed-in actor with no capability is denied", async () => {
    await signInWith();
    await assert.rejects(authorize.authorizeLegacyOcr(), authz.TesAuthorizationDeniedError);
  });

  it("read-only evidence access is not enough", async () => {
    await signInWith("EVIDENCE_READ");
    await assert.rejects(authorize.authorizeLegacyOcr(), authz.TesAuthorizationDeniedError);
  });

  it("an unrelated capability is denied", async () => {
    await signInWith("CONTRACT_MANAGE");
    await assert.rejects(authorize.authorizeLegacyOcr(), authz.TesAuthorizationDeniedError);
  });

  it("EVIDENCE_MANAGE is allowed", async () => {
    await signInWith("EVIDENCE_MANAGE");
    await authorize.authorizeLegacyOcr();
  });
});
