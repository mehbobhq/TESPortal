// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// getContractsWorkspace() degrades the optional contact candidates to an empty list when the actor lacks PERSON_REGISTRY_READ,
// and ONLY for an authorization denial. It must recognise the denial by its stable code, not by constructor.name: a production
// build minifies class bindings (`class i extends Error`). The REAL error class is renamed here the way a minifier renames it.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    authz: await import("@/lib/auth/tes-authorization"),
    ct: await import("@/lib/contracts/service"),
    cr: await import("@/lib/customer-relationship/service"),
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

describe("Contracts workspace: denial of the optional contacts read under minified class names", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  let organizationId = "";

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

  before(async () => {
    // Fixture: one Organization with a customer relationship, established by a staff actor who may do so.
    organizationId = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [organizationId, `Contracts classification ${organizationId.slice(0, 8)}`]);
    await signInWith("CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE");
    await K.cr.establishCustomerRelationship({ organizationId, engagementType: "RECURRING", stage: "ONBOARDING", startedAt: "2020-01-01T00:00:00Z" });
    K.db.setClerkUser(null);
  });

  /** Renames the real class binding for the duration of `work`, as a production build does. */
  async function minified<T>(work: () => Promise<T>): Promise<T> {
    const C = K.authz.TesAuthorizationDeniedError as unknown as { name: string };
    const original = Object.getOwnPropertyDescriptor(C, "name");
    Object.defineProperty(C, "name", { value: "i", configurable: true });
    try {
      assert.equal(new K.authz.TesAuthorizationDeniedError().constructor.name, "i", "the class really is renamed");
      return await work();
    } finally {
      if (original) Object.defineProperty(C, "name", original);
    }
  }

  const READERS = ["CONTRACT_READ", "EVIDENCE_READ", "CUSTOMER_RELATIONSHIP_READ"]; // no PERSON_REGISTRY_READ

  it("without PERSON_REGISTRY_READ the workspace loads with an empty people list (class name intact)", async () => {
    await signInWith(...READERS);
    const workspace = await K.ct.getContractsWorkspace(organizationId);
    assert.deepEqual(workspace.people, []);
  });

  it("without PERSON_REGISTRY_READ the workspace still loads with an empty people list when the class binding is minified", async () => {
    await signInWith(...READERS);
    const workspace = await minified(() => K.ct.getContractsWorkspace(organizationId));
    assert.deepEqual(workspace.people, []);
  });

  it("a denial of the workspace itself (no CONTRACT_READ) is still a denial, minified or not: nothing is degraded", async () => {
    await signInWith("EVIDENCE_READ", "CUSTOMER_RELATIONSHIP_READ", "PERSON_REGISTRY_READ");
    for (const run of [() => K.ct.getContractsWorkspace(organizationId), () => minified(() => K.ct.getContractsWorkspace(organizationId))]) {
      await assert.rejects(run(), (error: unknown) => error instanceof K.authz.TesAuthorizationDeniedError);
    }
  });

  it("no Clerk session is not degraded either: the identity error propagates", async () => {
    K.db.setClerkUser(null);
    await assert.rejects(minified(() => K.ct.getContractsWorkspace(organizationId)), (error: unknown) => (error as { code?: string }).code === "TES_IDENTITY_REQUIRED");
  });
});
