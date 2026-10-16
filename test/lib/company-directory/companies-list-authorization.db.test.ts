// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// GET /api/companies through the REAL route handler, the REAL authorization kernel and the RUNTIME role (row-level security
// applies): an authorization denial is reported as 403 "Not authorized.", never as the generic 500, and nothing is listed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    route: await import("@/app/api/companies/route"),
  };
}
type Kit = Awaited<ReturnType<typeof loadKit>>;
const K = {} as Kit;

const enabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
if (!enabled && process.env.TES_REQUIRE_DB_TESTS === "1") {
  it("requires a disposable test database (TES_REQUIRE_DB_TESTS=1)", () => {
    assert.fail("TES_TEST_ADMIN_DATABASE_URL and TES_TEST_RUNTIME_DATABASE_URL must be set");
  });
}

describe("GET /api/companies authorization responses (real kernel, runtime role)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    for (const fx of fixtures) await fx.cleanup();
    await K.db.closePools();
  });

  async function signInWith(...capabilities: string[]) {
    const fx = new K.db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
  }

  it("returns 403 (not 500) and lists nothing when nobody is signed in", async () => {
    K.db.setClerkUser(null);
    const response = await K.route.GET();
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.deepEqual(body, { error: "Not authorized." });
  });

  it("returns 403 (not 500) for a signed-in actor without ORGANIZATION_REGISTRY_READ", async () => {
    await signInWith("CONTACT_MANAGE");
    const response = await K.route.GET();
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Not authorized." });
  });

  it("returns 200 with the company list for an actor holding ORGANIZATION_REGISTRY_READ", async () => {
    await signInWith("ORGANIZATION_REGISTRY_READ");
    const response = await K.route.GET();
    assert.equal(response.status, 200);
    const body = (await response.json()) as { companies: unknown[] };
    assert.ok(Array.isArray(body.companies));
  });

  it("keeps the failure path generic: the GET catch block delegates to canonicalFailure with the generic message", () => {
    const source = readFileSync(path.join(process.cwd(), "app/api/companies/route.ts"), "utf8");
    const get = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST"));
    assert.match(get, /catch \(error\) \{[\s\S]*canonicalFailure\(error, "Unable to load companies\."\)/);
    assert.doesNotMatch(get, /constructor\.name/);
  });
});
