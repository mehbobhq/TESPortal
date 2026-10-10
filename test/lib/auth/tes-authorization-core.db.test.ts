// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh), which builds a disposable PostgreSQL with the real
// migrations. Without a configured database these tests skip (and fail loudly when TES_REQUIRE_DB_TESTS=1).
// The REAL lib/auth modules run, with `server-only`, Clerk and the Cloud SQL pool replaced by local stand-ins.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";
import type { TesAuthorizationRequest } from "@/lib/auth/tes-authorization-core";
import type { TesCapability } from "@/lib/auth/tes-capabilities";

/**
 * Loads the code under test AFTER registering the test loader. Static imports would be resolved before the loader
 * exists, so these tests work under any invocation (`node --test`, a glob, or scripts/test/run-auth-tests.sh).
 */
async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    core: await import("@/lib/auth/tes-authorization-core"),
    sql: await import("@/lib/auth/tes-authorization-sql"),
    caps: await import("@/lib/auth/tes-capabilities"),
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

// The code under test runs as the RUNTIME role; fixtures are written by the migration owner.
describe("TES authorization core (real PostgreSQL, runtime role)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    await K.db.closePools();
  });

  // A fresh fixture set per test; always removed, even on failure.
  const scenario = (name: string, body: () => Promise<void>) =>
    it(name, async () => {
      fx = new K.db.AuthFixtures(pools.admin);
      try {
        await body();
      } finally {
        await fx.cleanup();
      }
    });

  const principalOf = (actor: TestActor) =>
    K.core.resolveTesAuthorizationPrincipal({ id: actor.actorId, actorType: "HUMAN" }, pools.runtime);

  const evaluate = async (actor: TestActor, request: TesAuthorizationRequest) =>
    K.core.evaluateTesAuthorization(await principalOf(actor), request, pools.runtime);

  const SYSTEM = { type: "SYSTEM" } as const;
  const customerScope = (customerId: string) => ({ type: "CUSTOMER", customerId }) as const;

  const assertAllowed = async (actor: TestActor, request: TesAuthorizationRequest) => {
    const decision = await evaluate(actor, request);
    assert.equal(decision.allowed, true);
    return decision;
  };
  const assertDenied = (actor: TestActor, request: TesAuthorizationRequest) =>
    assert.rejects(evaluate(actor, request), K.core.TesAuthorizationDeniedError);

  /** A TES_STAFF actor with an effective SYSTEM assignment (and optionally one grant on it). */
  async function systemStaff(grantCode?: TesCapability, grantOptions: { broad?: boolean } = {}) {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, SYSTEM);
    if (grantCode) {
      await fx.grant(relationshipId, grantCode, grantOptions.broad ? {} : { assignmentId });
    }
    return { actor, relationshipId, assignmentId };
  }

  describe("SYSTEM scope", () => {
    scenario("S1 authorized TES_STAFF with an assignment-specific grant is allowed", async () => {
      const { actor } = await systemStaff("ORGANIZATION_CREATE");
      const decision = await assertAllowed(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
      assert.deepEqual(decision.scope, { type: "SYSTEM" });
      assert.equal(decision.isMasterAccount, false);
      assert.equal(decision.actor.id, actor.actorId);
    });

    scenario("S13 a broad grant with an effective SYSTEM assignment is allowed", async () => {
      const { actor } = await systemStaff("ORGANIZATION_UPDATE", { broad: true });
      await assertAllowed(actor, { capability: "ORGANIZATION_UPDATE", scope: SYSTEM });
    });

    scenario("S2 a SYSTEM assignment without a grant is denied", async () => {
      const { actor } = await systemStaff();
      await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    scenario("a grant of a different capability does not authorize the requested one", async () => {
      const { actor } = await systemStaff("ORGANIZATION_UPDATE");
      await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    scenario("S3 a grant with only a CUSTOMER assignment is denied for SYSTEM (no scope inheritance)", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      await fx.assignment(relationshipId, customerScope(customerId));
      await fx.grant(relationshipId, "ORGANIZATION_CREATE"); // broad grant, but no SYSTEM assignment
      await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    for (const type of ["CUSTOMER_USER", "DRIVER"] as const) {
      scenario(`S4/S5 a ${type} can never exercise SYSTEM even with a SYSTEM assignment and grant`, async () => {
        const actor = await fx.actor();
        const relationshipId = await fx.relationship(actor.actorId, type);
        const assignmentId = await fx.assignment(relationshipId, SYSTEM);
        await fx.grant(relationshipId, "ORGANIZATION_CREATE", { assignmentId });
        await fx.grant(relationshipId, "ORGANIZATION_REGISTRY_READ"); // broad grant too
        await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
        await assertDenied(actor, { capability: "ORGANIZATION_REGISTRY_READ", scope: SYSTEM });
      });
    }

    scenario("S6 Master Account is allowed with no relationship, assignment or grant", async () => {
      const actor = await fx.actor();
      await fx.master(actor.actorId);
      const decision = await assertAllowed(actor, { capability: "ORGANIZATION_ARCHIVE", scope: SYSTEM });
      assert.equal(decision.isMasterAccount, true);
    });

    scenario("S7a Master Account with a typo'd capability is rejected, not allowed", async () => {
      const actor = await fx.actor();
      await fx.master(actor.actorId);
      await assert.rejects(
        evaluate(actor, { capability: "ORGANIZTION_UPDATE" as TesCapability, scope: SYSTEM }),
        K.core.TesUnknownCapabilityError,
      );
      await assert.rejects(
        evaluate(actor, { capability: "organization_update" as TesCapability, scope: SYSTEM }),
        K.core.TesUnknownCapabilityError,
      );
    });

    scenario("S7b Master Account with a code known to the app but missing from PostgreSQL is rejected", async () => {
      const actor = await fx.actor();
      await fx.master(actor.actorId);
      await fx.removeCapability("ORGANIZATION_ARCHIVE");
      await assert.rejects(
        evaluate(actor, { capability: "ORGANIZATION_ARCHIVE", scope: SYSTEM }),
        K.core.TesUnknownCapabilityError,
      );
    });

    scenario("S8 Master Account with an inactive capability is denied", async () => {
      const actor = await fx.actor();
      await fx.master(actor.actorId);
      await fx.setCapabilityActive("ORGANIZATION_CREATE", false);
      await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    scenario("S9 an ordinary actor with a nonexistent capability gets the unknown-capability error", async () => {
      const { actor } = await systemStaff("ORGANIZATION_CREATE");
      await assert.rejects(
        evaluate(actor, { capability: "ORGANIZATION_CREAT" as TesCapability, scope: SYSTEM }),
        K.core.TesUnknownCapabilityError,
      );
    });

    scenario("S10 an ordinary actor with a valid grant but an inactive capability is denied", async () => {
      const { actor } = await systemStaff("ORGANIZATION_CREATE");
      await fx.setCapabilityActive("ORGANIZATION_CREATE", false);
      await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    for (const status of ["suspended", "ended"] as const) {
      scenario(`S11 a ${status} relationship, assignment or grant is denied`, async () => {
        for (const broken of ["relationship", "assignment", "grant"] as const) {
          const actor = await fx.actor();
          const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF", {
            status: broken === "relationship" ? status : "active",
          });
          const assignmentId = await fx.assignment(relationshipId, SYSTEM, {
            status: broken === "assignment" ? status : "active",
          });
          await fx.grant(relationshipId, "ORGANIZATION_CREATE", {
            assignmentId,
            status: broken === "grant" ? status : "active",
          });
          await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
        }
      });
    }

    scenario("S12 a capability requested under the wrong scope is a server defect for everyone", async () => {
      const master = await fx.actor();
      await fx.master(master.actorId);
      const { customerId } = await fx.organizationAndCustomer();
      for (const actor of [master, (await systemStaff("ORGANIZATION_CREATE")).actor]) {
        // ORGANIZATION_READ is CUSTOMER-only; ORGANIZATION_CREATE is SYSTEM-only.
        await assert.rejects(
          evaluate(actor, { capability: "ORGANIZATION_READ", scope: SYSTEM }),
          K.core.TesCapabilityScopeError,
        );
        await assert.rejects(
          evaluate(actor, { capability: "ORGANIZATION_CREATE", scope: customerScope(customerId) }),
          K.core.TesCapabilityScopeError,
        );
      }
    });

    scenario("a Master Account designation that is future-dated or ended confers nothing", async () => {
      const future = await fx.actor();
      await fx.master(future.actorId, { designatedAt: K.db.iso(K.db.DAY_MS) });
      const ended = await fx.actor();
      await fx.master(ended.actorId, { status: "ended" });
      assert.equal((await principalOf(future)).isMasterAccount, false);
      assert.equal((await principalOf(ended)).isMasterAccount, false);
      await assertDenied(future, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });
  });

  describe("assignment, relationship and grant effective time", () => {
    scenario("T1 a future-dated assignment is denied", async () => {
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      const assignmentId = await fx.assignment(relationshipId, SYSTEM, { startsAt: K.db.iso(K.db.DAY_MS) });
      await fx.grant(relationshipId, "ORGANIZATION_CREATE", { assignmentId });
      await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    scenario("T2 a currently effective assignment is allowed", async () => {
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      const assignmentId = await fx.assignment(relationshipId, SYSTEM, { startsAt: K.db.iso(-K.db.DAY_MS) });
      await fx.grant(relationshipId, "ORGANIZATION_CREATE", { assignmentId });
      await assertAllowed(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    scenario("T7a a future-dated relationship is denied", async () => {
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF", { startsAt: K.db.iso(K.db.DAY_MS) });
      const assignmentId = await fx.assignment(relationshipId, SYSTEM);
      await fx.grant(relationshipId, "ORGANIZATION_CREATE", { assignmentId });
      await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    scenario("T7b a future-dated grant is denied", async () => {
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      const assignmentId = await fx.assignment(relationshipId, SYSTEM);
      await fx.grant(relationshipId, "ORGANIZATION_CREATE", { assignmentId, grantedAt: K.db.iso(K.db.DAY_MS) });
      await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    scenario("T5 an ended assignment is denied even when its recorded end is in the future", async () => {
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      const assignmentId = await fx.assignment(relationshipId, SYSTEM, { status: "ended", endsAt: K.db.iso(K.db.DAY_MS) });
      await fx.grant(relationshipId, "ORGANIZATION_CREATE", { assignmentId });
      await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    scenario("T6 the schema makes a NULL start and an active-with-end impossible (documents the assumptions)", async () => {
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      await assert.rejects(
        pools.admin.query(
          `INSERT INTO public.relationship_assignments (relationship_id, scope_type, starts_at) VALUES ($1, 'SYSTEM', NULL)`,
          [relationshipId],
        ),
        { code: "23502" },
      );
      await assert.rejects(
        pools.admin.query(
          `INSERT INTO public.relationship_assignments (relationship_id, scope_type, status, ends_at)
           VALUES ($1, 'SYSTEM', 'active', now() + interval '1 day')`,
          [relationshipId],
        ),
        { code: "23514" },
      );
    });

    scenario("T3 boundary: the start instant is inclusive, one microsecond earlier is not", async () => {
      const startsAt = "2031-01-01T00:00:00.000000Z";
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      const assignmentId = await fx.assignment(relationshipId, SYSTEM, { startsAt });
      await fx.grant(relationshipId, "ORGANIZATION_CREATE", { assignmentId });

      const allowedAt = async (asOf: string) => {
        const result = await pools.runtime.query<{ allowed: boolean }>(
          K.sql.authorizationDecisionSql("SYSTEM", `'${asOf}'::timestamptz`),
          [actor.actorId, "ORGANIZATION_CREATE"],
        );
        return result.rows[0].allowed;
      };

      assert.equal(await allowedAt("2031-01-01T00:00:00.000000Z"), true, "exactly at starts_at");
      assert.equal(await allowedAt("2031-01-01T00:00:00.000001Z"), true, "one microsecond after");
      assert.equal(await allowedAt("2030-12-31T23:59:59.999999Z"), false, "one microsecond before");
      // And on the real database clock this future row is not effective.
      await assertDenied(actor, { capability: "ORGANIZATION_CREATE", scope: SYSTEM });
    });

    scenario("T3b boundary: the end instant is exclusive (checked with the end constraint lifted in a rolled-back transaction)", async () => {
      // The schema only allows an end timestamp on an 'ended' row, so the end clause cannot be reached with real data.
      // To prove it is correct anyway (it becomes live if scheduled expiry is ever permitted), lift the CHECK inside a
      // transaction that is always rolled back.
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        await client.query(`ALTER TABLE public.relationship_assignments DROP CONSTRAINT relationship_assignments_end_state_consistent`);
        const actorId = randomUUID();
        const relationshipId = randomUUID();
        await client.query(`INSERT INTO public.actors (id, actor_type) VALUES ($1, 'HUMAN')`, [actorId]);
        await client.query(
          `INSERT INTO public.actor_relationships (id, actor_id, relationship_type, starts_at) VALUES ($1, $2, 'TES_STAFF', '2030-01-01T00:00:00Z')`,
          [relationshipId, actorId],
        );
        const assignmentId = randomUUID();
        await client.query(
          `INSERT INTO public.relationship_assignments (id, relationship_id, scope_type, status, starts_at, ends_at)
           VALUES ($1, $2, 'SYSTEM', 'active', '2030-01-01T00:00:00Z', '2031-01-01T00:00:00Z')`,
          [assignmentId, relationshipId],
        );
        await client.query(
          `INSERT INTO public.relationship_capability_grants (relationship_id, capability_id, assignment_id, granted_at)
           SELECT $1, id, $2, '2030-01-01T00:00:00Z' FROM public.capabilities WHERE code = 'ORGANIZATION_CREATE'`,
          [relationshipId, assignmentId],
        );
        const allowedAt = async (asOf: string) =>
          (
            await client.query<{ allowed: boolean }>(K.sql.authorizationDecisionSql("SYSTEM", `'${asOf}'::timestamptz`), [
              actorId,
              "ORGANIZATION_CREATE",
            ])
          ).rows[0].allowed;
        assert.equal(await allowedAt("2030-06-01T00:00:00.000000Z"), true, "inside the window");
        assert.equal(await allowedAt("2030-12-31T23:59:59.999999Z"), true, "one microsecond before the end");
        assert.equal(await allowedAt("2031-01-01T00:00:00.000000Z"), false, "exactly at the end (exclusive)");
        assert.equal(await allowedAt("2031-01-01T00:00:00.000001Z"), false, "after the end");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    scenario("T8b the evaluator actually sends the default database-time SQL and only [actor, capability] parameters", async () => {
      const { actor } = await systemStaff("ORGANIZATION_CREATE");
      const seen: Array<{ sql: string; params: unknown[] }> = [];
      const spy = {
        query: (sql: string, params?: unknown[]) => {
          seen.push({ sql: String(sql), params: params ?? [] });
          return pools.runtime.query(sql, params);
        },
      } as unknown as Parameters<typeof K.core.resolveTesAuthorizationPrincipal>[1];

      const principal = await K.core.resolveTesAuthorizationPrincipal({ id: actor.actorId, actorType: "HUMAN" }, spy);
      await K.core.evaluateTesAuthorization(principal, { capability: "ORGANIZATION_CREATE", scope: SYSTEM }, spy);

      assert.equal(seen.length, 2, "one principal query and one decision query");
      assert.equal(seen[0].sql, K.sql.masterAccountSql());
      assert.deepEqual(seen[0].params, [actor.actorId]);
      assert.equal(seen[1].sql, K.sql.authorizationDecisionSql("SYSTEM"));
      assert.deepEqual(seen[1].params, [actor.actorId, "ORGANIZATION_CREATE"]);
    });

    scenario("T8 evaluation uses database time only: no application timestamp is a query parameter", async () => {
      const sql = K.sql.authorizationDecisionSql("SYSTEM");
      assert.match(sql, /statement_timestamp\(\)/);
      assert.doesNotMatch(sql, /\bnow\(\)/);
      // SYSTEM decisions take exactly $1 actor and $2 capability.
      assert.doesNotMatch(sql, /\$[3-9]/);
    });
  });

  describe("CUSTOMER scope", () => {
    scenario("C1 the correct customer with an assignment-specific grant is allowed; ids are normalized", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, customerScope(customerId));
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      const decision = await assertAllowed(actor, {
        capability: "ORGANIZATION_READ",
        scope: customerScope(`  ${customerId.toUpperCase()}  `),
      });
      assert.deepEqual(decision.scope, { type: "CUSTOMER", customerId });
    });

    scenario("C2 a different customer is denied", async () => {
      const a = await fx.organizationAndCustomer("A");
      const b = await fx.organizationAndCustomer("B");
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, customerScope(a.customerId));
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      await assertAllowed(actor, { capability: "ORGANIZATION_READ", scope: customerScope(a.customerId) });
      await assertDenied(actor, { capability: "ORGANIZATION_READ", scope: customerScope(b.customerId) });
    });

    scenario("C3 a grant tied to one assignment cannot be used through another assignment of the same relationship", async () => {
      const a = await fx.organizationAndCustomer("A");
      const b = await fx.organizationAndCustomer("B");
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      const assignmentA = await fx.assignment(relationshipId, customerScope(a.customerId));
      await fx.assignment(relationshipId, customerScope(b.customerId));
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId: assignmentA });
      await assertAllowed(actor, { capability: "ORGANIZATION_READ", scope: customerScope(a.customerId) });
      await assertDenied(actor, { capability: "ORGANIZATION_READ", scope: customerScope(b.customerId) });
    });

    scenario("C4 a broad grant applies to every assigned customer and to no other", async () => {
      const a = await fx.organizationAndCustomer("A");
      const b = await fx.organizationAndCustomer("B");
      const c = await fx.organizationAndCustomer("C");
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      await fx.assignment(relationshipId, customerScope(a.customerId));
      await fx.assignment(relationshipId, customerScope(b.customerId));
      await fx.grant(relationshipId, "ORGANIZATION_READ");
      await assertAllowed(actor, { capability: "ORGANIZATION_READ", scope: customerScope(a.customerId) });
      await assertAllowed(actor, { capability: "ORGANIZATION_READ", scope: customerScope(b.customerId) });
      await assertDenied(actor, { capability: "ORGANIZATION_READ", scope: customerScope(c.customerId) });
    });

    for (const status of ["suspended", "ended"] as const) {
      scenario(`C5/C6/C9 a ${status} relationship, assignment or grant is denied for a customer`, async () => {
        for (const broken of ["relationship", "assignment", "grant"] as const) {
          const { customerId } = await fx.organizationAndCustomer();
          const actor = await fx.actor();
          const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER", {
            status: broken === "relationship" ? status : "active",
          });
          const assignmentId = await fx.assignment(relationshipId, customerScope(customerId), {
            status: broken === "assignment" ? status : "active",
          });
          await fx.grant(relationshipId, "ORGANIZATION_READ", {
            assignmentId,
            status: broken === "grant" ? status : "active",
          });
          await assertDenied(actor, { capability: "ORGANIZATION_READ", scope: customerScope(customerId) });
        }
      });
    }

    scenario("C7 an inactive capability is denied", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, customerScope(customerId));
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      await fx.setCapabilityActive("ORGANIZATION_READ", false);
      await assertDenied(actor, { capability: "ORGANIZATION_READ", scope: customerScope(customerId) });
    });

    scenario("C8 a SYSTEM assignment plus a broad ORGANIZATION_READ grant opens no customer (no scope inheritance)", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const { actor } = await systemStaff("ORGANIZATION_READ", { broad: true });
      await assertDenied(actor, { capability: "ORGANIZATION_READ", scope: customerScope(customerId) });
    });

    scenario("C10 another actor's assignments and grants cannot be borrowed", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const owner = await fx.actor();
      const relationshipId = await fx.relationship(owner.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, customerScope(customerId));
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      const other = await fx.actor();
      await assertAllowed(owner, { capability: "ORGANIZATION_READ", scope: customerScope(customerId) });
      await assertDenied(other, { capability: "ORGANIZATION_READ", scope: customerScope(customerId) });
    });

    scenario("Master Account may open an existing customer but not a nonexistent one", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const master = await fx.actor();
      await fx.master(master.actorId);
      const decision = await assertAllowed(master, { capability: "ORGANIZATION_READ", scope: customerScope(customerId) });
      assert.equal(decision.isMasterAccount, true);
      await assertDenied(master, { capability: "ORGANIZATION_READ", scope: customerScope(randomUUID()) });
    });

    scenario("a malformed customer id is denied", async () => {
      const master = await fx.actor();
      await fx.master(master.actorId);
      for (const bad of ["", "   ", "not-a-uuid", "11111111-1111-4111-7111-111111111111", "'; DROP TABLE x;--"]) {
        await assertDenied(master, { capability: "ORGANIZATION_READ", scope: customerScope(bad) });
      }
    });
  });

  describe("accessible customers", () => {
    async function customerUser(options: { broad?: boolean } = {}) {
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER");
      return { actor, relationshipId, broad: options.broad ?? false };
    }
    const idsOf = async (actor: TestActor) =>
      (await K.core.findAccessibleCustomers(pools.runtime, actor.actorId)).map((c) => c.customerId);

    scenario("A1 zero: an actor with no assignments can open nothing", async () => {
      const { actor } = await customerUser();
      assert.deepEqual(await idsOf(actor), []);
    });

    scenario("A2/A3 one and several, ordered by organization name, with organization detail", async () => {
      const zed = await fx.organizationAndCustomer("Zed");
      const alpha = await fx.organizationAndCustomer("Alpha");
      const mid = await fx.organizationAndCustomer("Mid");
      const { actor, relationshipId } = await customerUser();
      for (const c of [zed, alpha, mid]) {
        const assignmentId = await fx.assignment(relationshipId, customerScope(c.customerId));
        await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      }
      const found = await K.core.findAccessibleCustomers(pools.runtime, actor.actorId);
      assert.deepEqual(
        found.map((c) => c.customerId),
        [alpha.customerId, mid.customerId, zed.customerId],
      );
      assert.equal(found[0].organizationId, alpha.organizationId);
      assert.match(found[0].legalName, /^Alpha /);
      assert.equal(found[0].displayName, null);
      assert.equal(found[0].organizationStatus, "active");
    });

    scenario("A4 duplicate authorization paths yield one entry", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const actor = await fx.actor();
      // Two relationships, both reaching the same customer; broad AND specific grants on one of them.
      const staff = await fx.relationship(actor.actorId, "TES_STAFF");
      const staffAssignment = await fx.assignment(staff, customerScope(customerId));
      await fx.grant(staff, "ORGANIZATION_READ");
      await fx.grant(staff, "ORGANIZATION_READ", { assignmentId: staffAssignment });
      const user = await fx.relationship(actor.actorId, "CUSTOMER_USER");
      const userAssignment = await fx.assignment(user, customerScope(customerId));
      await fx.grant(user, "ORGANIZATION_READ", { assignmentId: userAssignment });
      assert.deepEqual(await idsOf(actor), [customerId]);
    });

    scenario("A5 future, suspended and ended assignments are excluded; the effective one is kept", async () => {
      const effective = await fx.organizationAndCustomer("Effective");
      const future = await fx.organizationAndCustomer("Future");
      const suspended = await fx.organizationAndCustomer("Suspended");
      const ended = await fx.organizationAndCustomer("Ended");
      const { actor } = await customerUser();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      await fx.assignment(relationshipId, customerScope(effective.customerId));
      await fx.assignment(relationshipId, customerScope(future.customerId), { startsAt: K.db.iso(K.db.DAY_MS) });
      await fx.assignment(relationshipId, customerScope(suspended.customerId), { status: "suspended" });
      await fx.assignment(relationshipId, customerScope(ended.customerId), { status: "ended" });
      await fx.grant(relationshipId, "ORGANIZATION_READ"); // broad
      assert.deepEqual(await idsOf(actor), [effective.customerId]);
    });

    scenario("A6 an inactive capability, and an inactive relationship, give nothing", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const { actor, relationshipId } = await customerUser();
      const assignmentId = await fx.assignment(relationshipId, customerScope(customerId));
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      assert.deepEqual(await idsOf(actor), [customerId]);
      await fx.setCapabilityActive("ORGANIZATION_READ", false);
      assert.deepEqual(await idsOf(actor), []);

      const other = await fx.actor();
      const suspended = await fx.relationship(other.actorId, "CUSTOMER_USER", { status: "suspended" });
      const otherAssignment = await fx.assignment(suspended, customerScope(customerId));
      await fx.grant(suspended, "ORGANIZATION_READ", { assignmentId: otherAssignment });
      await fx.setCapabilityActive("ORGANIZATION_READ", true);
      assert.deepEqual(await idsOf(other), []);
    });

    scenario("A7/A8 other capabilities, SYSTEM assignments and ORGANIZATION_REGISTRY_READ contribute nothing", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      const customerAssignment = await fx.assignment(relationshipId, customerScope(customerId));
      const systemAssignment = await fx.assignment(relationshipId, SYSTEM);
      await fx.grant(relationshipId, "ORGANIZATION_UPDATE", { assignmentId: customerAssignment }); // wrong capability
      await fx.grant(relationshipId, "ORGANIZATION_REGISTRY_READ", { assignmentId: systemAssignment });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId: systemAssignment }); // right code, SYSTEM assignment
      assert.deepEqual(await idsOf(actor), []);
    });

    scenario("A9 consistency: a customer is listed if and only if the evaluator allows it", async () => {
      const customers = [];
      for (const label of ["P", "Q", "R", "S", "T"]) customers.push(await fx.organizationAndCustomer(label));
      const actor = await fx.actor();
      const staff = await fx.relationship(actor.actorId, "TES_STAFF");
      const user = await fx.relationship(actor.actorId, "CUSTOMER_USER");
      const p = await fx.assignment(staff, customerScope(customers[0].customerId));
      await fx.assignment(staff, customerScope(customers[1].customerId)); // broad grant below reaches it
      await fx.assignment(staff, customerScope(customers[2].customerId), { startsAt: K.db.iso(K.db.DAY_MS) }); // future
      const r = await fx.assignment(user, customerScope(customers[3].customerId), { status: "suspended" });
      await fx.grant(staff, "ORGANIZATION_READ", { assignmentId: p });
      await fx.grant(staff, "ORGANIZATION_UPDATE"); // unrelated capability
      await fx.grant(user, "ORGANIZATION_READ", { assignmentId: r });
      // customers[4]: no assignment at all
      const listed = new Set(await idsOf(actor));
      for (const c of customers) {
        let allowed = true;
        try {
          await evaluate(actor, { capability: "ORGANIZATION_READ", scope: customerScope(c.customerId) });
        } catch (error) {
          assert.ok(error instanceof K.core.TesAuthorizationDeniedError);
          allowed = false;
        }
        assert.equal(listed.has(c.customerId), allowed, `customer ${c.customerId}: listed=${listed.has(c.customerId)} allowed=${allowed}`);
      }
      assert.equal(listed.size, 1);
    });

    scenario("a SYSTEM-scoped capability cannot be used for discovery", async () => {
      const { actor } = await customerUser();
      await assert.rejects(
        K.core.findAccessibleCustomers(pools.runtime, actor.actorId, "ORGANIZATION_CREATE" as never),
        K.core.TesCapabilityScopeError,
      );
      await assert.rejects(
        K.core.findAccessibleCustomers(pools.runtime, actor.actorId, "NOPE" as never),
        K.core.TesUnknownCapabilityError,
      );
    });
  });

  describe("capability catalogue drift (TypeScript references vs PostgreSQL)", () => {
    it("K2 every TypeScript capability exists and is active in public.capabilities", async () => {
      const result = await pools.admin.query<{ code: string; is_active: boolean }>(
        `SELECT code, is_active FROM public.capabilities WHERE code = ANY($1::text[])`,
        [K.caps.TES_CAPABILITY_CODES],
      );
      const byCode = new Map(result.rows.map((row) => [row.code, row.is_active]));
      for (const code of K.caps.TES_CAPABILITY_CODES) {
        assert.equal(byCode.get(code), true, `${code} must exist and be active in PostgreSQL`);
      }
    });

    it("K2b every active PostgreSQL capability has a TypeScript reference (seeded but unreferenced would be dead)", async () => {
      const result = await pools.admin.query<{ code: string }>(`SELECT code FROM public.capabilities WHERE is_active`);
      const known = new Set<string>(K.caps.TES_CAPABILITY_CODES);
      assert.deepEqual(result.rows.map((r) => r.code).filter((code) => !known.has(code)), []);
    });

    it("K3 the declared TypeScript scope equals the 'Intended scope' sentence in the database description", async () => {
      const result = await pools.admin.query<{ code: string; description: string }>(
        `SELECT code, description FROM public.capabilities WHERE code = ANY($1::text[])`,
        [K.caps.TES_CAPABILITY_CODES],
      );
      assert.equal(result.rows.length, K.caps.TES_CAPABILITY_CODES.length);
      for (const row of result.rows) {
        const match = /Intended scope: (SYSTEM|CUSTOMER) only\.$/.exec(row.description);
        assert.ok(match, `${row.code} description must end with its intended scope`);
        assert.equal(
          match[1],
          K.caps.TES_CAPABILITY_SCOPES[row.code as TesCapability],
          `${row.code}: database says ${match[1]} only`,
        );
      }
    });
  });
});
