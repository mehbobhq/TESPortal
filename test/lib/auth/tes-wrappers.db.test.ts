// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh); see tes-authorization-core.db.test.ts.
//
// These tests drive the REAL K.sys.withAuthorizedSystem / K.cust.withAuthorizedCustomer / K.access.listAccessibleCustomers (and the real
// lib/auth/tes-actor.ts) through the Clerk stand-in, on a pooled connection that logs in as the RUNTIME role.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

/**
 * Loads the code under test AFTER registering the test loader. Static imports would be resolved before the loader
 * exists, so these tests work under any invocation (`node --test`, a glob, or scripts/test/run-auth-tests.sh).
 */
async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    actor: await import("@/lib/auth/tes-actor"),
    access: await import("@/lib/auth/tes-accessible-customers"),
    authz: await import("@/lib/auth/tes-authorization"),
    cust: await import("@/lib/auth/tes-customer-context"),
    sys: await import("@/lib/auth/tes-system-context"),
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

const globals = globalThis as Record<string, unknown>;

describe("TES authorization wrappers (real transaction, real Clerk-to-actor resolution)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  const scenario = (name: string, body: () => Promise<void>) =>
    it(name, async () => {
      fx = new K.db.AuthFixtures(pools.admin);
      K.db.setClerkUser(null);
      try {
        await body();
      } finally {
        K.db.setClerkUser(null);
        await fx.cleanup();
      }
    });

  const signIn = (actor: TestActor) => K.db.setClerkUser(actor.clerkSubject);

  /** Runs `fn` with the application's pool replaced by a single-connection pool (so "the same connection" is certain). */
  async function withSingleConnectionPool<T>(fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
    const previous = globals.__tesTestRuntimePool;
    const pool = new pg.Pool({ connectionString: process.env[K.db.DB_ENV.runtime], max: 1 });
    globals.__tesTestRuntimePool = pool;
    try {
      return await fn(pool);
    } finally {
      globals.__tesTestRuntimePool = previous;
      await pool.end();
    }
  }

  const lastAuthenticatedAt = async (actor: TestActor) =>
    (
      await pools.admin.query<{ last_authenticated_at: Date | null }>(
        `SELECT last_authenticated_at FROM public.authentication_identities WHERE provider_subject = $1`,
        [actor.clerkSubject],
      )
    ).rows[0].last_authenticated_at;

  async function systemStaff(capability: "ORGANIZATION_CREATE" | "ORGANIZATION_UPDATE" = "ORGANIZATION_CREATE") {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    await fx.grant(relationshipId, capability, { assignmentId });
    return actor;
  }

  async function customerUser(customerId: string) {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER");
    const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId });
    await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
    return actor;
  }

  const TXN_PROBE = `SELECT
      i.last_authenticated_at AS authenticated_at,
      now() AS transaction_now,
      txid_current() AS txid,
      pg_backend_pid() AS backend_pid,
      current_setting('tes.customer_id', true) AS raw_context,
      tes_security.current_customer_id()::text AS resolved_context
    FROM public.authentication_identities i WHERE i.provider_subject = $1`;

  describe("withAuthorizedSystem", () => {
    scenario("authorized: work runs in the SAME transaction as authorization, with no tenant context", async () => {
      const actor = await systemStaff();
      signIn(actor);
      let calls = 0;

      const seen = await K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async (client, decision) => {
        calls += 1;
        const inside = (await client.query(TXN_PROBE, [actor.clerkSubject])).rows[0];
        const fromAnotherConnection = await lastAuthenticatedAt(actor);
        return { decision, inside, fromAnotherConnection };
      });

      assert.equal(calls, 1);
      assert.deepEqual(seen.decision.scope, { type: "SYSTEM" });
      assert.equal(seen.decision.allowed, true);
      assert.equal(seen.decision.capability, "ORGANIZATION_CREATE");
      assert.equal(seen.decision.actor.id, actor.actorId);

      // Same transaction: the authorization step's UPDATE is visible to the work (and carries this transaction's
      // timestamp), but is invisible to every other connection until commit.
      assert.ok(seen.inside.authenticated_at, "work sees the authorization step's uncommitted write");
      assert.equal(seen.inside.authenticated_at.getTime(), seen.inside.transaction_now.getTime());
      assert.equal(seen.fromAnotherConnection, null, "another connection cannot see it before commit");
      assert.ok(await lastAuthenticatedAt(actor), "committed after the work finished");

      // SYSTEM never establishes tenant context.
      assert.ok(seen.inside.raw_context === null || seen.inside.raw_context === "");
      assert.equal(seen.inside.resolved_context, null);
    });

    scenario("work and authorization share one backend connection and one transaction id", async () => {
      const actor = await systemStaff();
      signIn(actor);
      await withSingleConnectionPool(async (pool) => {
        const sampled: Array<{ pid: number; txid: string }> = [];
        const original = pool.connect.bind(pool);
        let connects = 0;
        (pool as unknown as { connect: typeof original }).connect = (async () => {
          connects += 1;
          return original();
        }) as typeof original;

        await K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async (client) => {
          const a = (await client.query(`SELECT pg_backend_pid() AS pid, txid_current()::text AS txid`)).rows[0];
          const b = (await client.query(`SELECT pg_backend_pid() AS pid, txid_current()::text AS txid`)).rows[0];
          sampled.push(a, b);
        });

        assert.equal(connects, 1, "exactly one pooled connection for authorization AND work");
        assert.equal(sampled[0].pid, sampled[1].pid);
        assert.equal(sampled[0].txid, sampled[1].txid);
      });
    });

    scenario("denied: the callback NEVER runs and the authorization step's write is rolled back", async () => {
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      await fx.assignment(relationshipId, { type: "SYSTEM" }); // assignment but no grant
      signIn(actor);
      let ran = false;
      await assert.rejects(
        K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async () => {
          ran = true;
        }),
        K.authz.TesAuthorizationDeniedError,
      );
      assert.equal(ran, false);
      assert.equal(await lastAuthenticatedAt(actor), null, "the transaction was rolled back");
    });

    scenario("a CUSTOMER_USER with a SYSTEM assignment and grant is denied and the callback never runs", async () => {
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
      await fx.grant(relationshipId, "ORGANIZATION_CREATE", { assignmentId });
      signIn(actor);
      let ran = false;
      await assert.rejects(
        K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async () => {
          ran = true;
        }),
        K.authz.TesAuthorizationDeniedError,
      );
      assert.equal(ran, false);
    });

    scenario("Master Account is supported without any relationship, grant or assignment", async () => {
      const actor = await fx.actor();
      await fx.master(actor.actorId);
      signIn(actor);
      const decision = await K.sys.withAuthorizedSystem("ORGANIZATION_ARCHIVE", async (_client, d) => d);
      assert.equal(decision.isMasterAccount, true);
      assert.deepEqual(decision.scope, { type: "SYSTEM" });
    });

    scenario("Master Account still cannot use a nonexistent or wrong-scope capability; the callback never runs", async () => {
      const actor = await fx.actor();
      await fx.master(actor.actorId);
      signIn(actor);
      let ran = false;
      const work = async () => {
        ran = true;
      };
      await assert.rejects(K.sys.withAuthorizedSystem("ORGANIZTION_UPDATE" as never, work), K.authz.TesUnknownCapabilityError);
      await assert.rejects(K.sys.withAuthorizedSystem("ORGANIZATION_READ" as never, work), K.authz.TesCapabilityScopeError);
      assert.equal(ran, false);
    });

    scenario("a CUSTOMER-scope grant does not authorize SYSTEM work (no inheritance)", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const actor = await customerUser(customerId);
      signIn(actor);
      let ran = false;
      await assert.rejects(
        K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async () => {
          ran = true;
        }),
        K.authz.TesAuthorizationDeniedError,
      );
      assert.equal(ran, false);
    });

    scenario("an error thrown by the work rolls the transaction back and propagates unchanged", async () => {
      const actor = await systemStaff();
      signIn(actor);
      const boom = new Error("work failed");
      await assert.rejects(
        K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async () => {
          throw boom;
        }),
        (error) => error === boom,
      );
      assert.equal(await lastAuthenticatedAt(actor), null);
    });
  });

  describe("withAuthorizedCustomer", () => {
    scenario("authorized: sets TRANSACTION-LOCAL tenant context on the same transaction, gone after commit", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const actor = await customerUser(customerId);
      signIn(actor);

      await withSingleConnectionPool(async (pool) => {
        const seen = await K.cust.withAuthorizedCustomer(customerId.toUpperCase(), "ORGANIZATION_READ", async (client, decision) => {
          const inside = (await client.query(TXN_PROBE, [actor.clerkSubject])).rows[0];
          const fromAnotherConnection = await lastAuthenticatedAt(actor);
          return { decision, inside, fromAnotherConnection };
        });

        assert.deepEqual(seen.decision.scope, { type: "CUSTOMER", customerId });
        assert.equal(seen.inside.raw_context, customerId);
        assert.equal(seen.inside.resolved_context, customerId);
        assert.equal(seen.inside.authenticated_at.getTime(), seen.inside.transaction_now.getTime());
        assert.equal(seen.fromAnotherConnection, null);

        // The ONLY pooled connection is now idle again: it must carry no tenant context.
        for (let i = 0; i < 3; i += 1) {
          const after = (
            await pool.query(`SELECT current_setting('tes.customer_id', true) AS raw, tes_security.current_customer_id()::text AS resolved`)
          ).rows[0];
          assert.ok(after.raw === null || after.raw === "", `context leaked onto the pooled connection: ${after.raw}`);
          assert.equal(after.resolved, null);
        }
      });
    });

    scenario("a wrong customer is denied and the callback never runs", async () => {
      const a = await fx.organizationAndCustomer("A");
      const b = await fx.organizationAndCustomer("B");
      const actor = await customerUser(a.customerId);
      signIn(actor);
      let ran = false;
      await assert.rejects(
        K.cust.withAuthorizedCustomer(b.customerId, "ORGANIZATION_READ", async () => {
          ran = true;
        }),
        K.authz.TesAuthorizationDeniedError,
      );
      assert.equal(ran, false);
    });

    scenario("a SYSTEM-scope grant does not open a customer (no inheritance); a wrong-scope capability is rejected", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const actor = await systemStaff("ORGANIZATION_CREATE");
      signIn(actor);
      let ran = false;
      const work = async () => {
        ran = true;
      };
      await assert.rejects(K.cust.withAuthorizedCustomer(customerId, "ORGANIZATION_READ", work), K.authz.TesAuthorizationDeniedError);
      await assert.rejects(K.cust.withAuthorizedCustomer(customerId, "ORGANIZATION_CREATE" as never, work), K.authz.TesCapabilityScopeError);
      assert.equal(ran, false);
    });

    scenario("Master Account opens an existing customer (context set) but never a nonexistent one", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const actor = await fx.actor();
      await fx.master(actor.actorId);
      signIn(actor);

      const context = await K.cust.withAuthorizedCustomer(customerId, "ORGANIZATION_READ", async (client, decision) => {
        const row = (await client.query(`SELECT tes_security.current_customer_id()::text AS id`)).rows[0];
        return { id: row.id, master: decision.isMasterAccount };
      });
      assert.deepEqual(context, { id: customerId, master: true });

      let ran = false;
      await assert.rejects(
        K.cust.withAuthorizedCustomer(randomUUID(), "ORGANIZATION_READ", async () => {
          ran = true;
        }),
        K.authz.TesAuthorizationDeniedError,
      );
      assert.equal(ran, false);
    });

    scenario("a malformed customer id fails before any work", async () => {
      const actor = await fx.actor();
      await fx.master(actor.actorId);
      signIn(actor);
      let ran = false;
      for (const bad of ["", "nope", "11111111-1111-4111-7111-111111111111"]) {
        await assert.rejects(
          K.cust.withAuthorizedCustomer(bad, "ORGANIZATION_READ", async () => {
            ran = true;
          }),
          K.cust.TesCustomerContextError,
        );
      }
      assert.equal(ran, false);
    });
  });

  describe("authentication boundary", () => {
    scenario("no session, an unknown subject, and a suspended actor are all rejected before authorization", async () => {
      const suspended = await fx.actor({ status: "suspended" });
      let ran = false;
      const work = async () => {
        ran = true;
      };

      K.db.setClerkUser(null);
      await assert.rejects(K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", work), K.actor.TesIdentityRequiredError);
      K.db.setClerkUser(`user_unknown_${randomUUID()}`);
      await assert.rejects(K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", work), K.actor.TesIdentityRequiredError);
      signIn(suspended);
      await assert.rejects(K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", work), K.actor.TesIdentityRequiredError);
      assert.equal(ran, false);
    });
  });

  describe("tenant-context hygiene", () => {
    scenario("a connection carrying a session-level tenant setting is rejected by BOTH wrappers; clean connection works", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const master = await fx.actor();
      await fx.master(master.actorId);
      signIn(master);

      await withSingleConnectionPool(async (pool) => {
        for (const poison of [customerId, "garbage-not-a-uuid"]) {
          // session-level (is_local = false): survives the transaction and stays on the pooled connection
          await pool.query(`SELECT set_config('tes.customer_id', $1, false)`, [poison]);

          let ran = false;
          const work = async () => {
            ran = true;
          };
          await assert.rejects(K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", work), K.sys.TesTenantContextPresentError);
          await assert.rejects(
            K.cust.withAuthorizedCustomer(customerId, "ORGANIZATION_READ", work),
            K.sys.TesTenantContextPresentError,
          );
          assert.equal(ran, false, `callback must not run on a poisoned connection (${poison})`);
        }

        await pool.query(`SELECT set_config('tes.customer_id', '', false)`);
        assert.equal(await K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async () => "ran"), "ran");
        assert.equal(await K.cust.withAuthorizedCustomer(customerId, "ORGANIZATION_READ", async () => "ran"), "ran");
      });
    });
  });

  describe("nesting and connection hygiene", () => {
    scenario("a wrapper entered inside another wrapper is rejected before taking a second connection", async () => {
      const { customerId } = await fx.organizationAndCustomer();
      const master = await fx.actor();
      await fx.master(master.actorId);
      signIn(master);

      await withSingleConnectionPool(async () => {
        // With a ONE-connection pool a real nested wrapper would deadlock; rejection must be immediate.
        const outcome = await K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async () => {
          const results: unknown[] = [];
          for (const nested of [
            () => K.sys.withAuthorizedSystem("ORGANIZATION_UPDATE", async () => "inner"),
            () => K.cust.withAuthorizedCustomer(customerId, "ORGANIZATION_READ", async () => "inner"),
            () => K.access.listAccessibleCustomers(),
          ]) {
            results.push(await nested().then(() => "allowed", (error) => error));
          }
          return results;
        });
        for (const result of outcome) assert.ok(result instanceof K.sys.TesNestedAuthorizationError);
      });
    });

    scenario("independent concurrent wrappers are allowed (the guard is per call chain)", async () => {
      const actor = await systemStaff();
      signIn(actor);
      const results = await Promise.all(
        [1, 2, 3, 4].map((n) => K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async () => n)),
      );
      assert.deepEqual(results, [1, 2, 3, 4]);
    });

    scenario("connections are always released: denials and failures cannot exhaust a one-connection pool", async () => {
      const actor = await systemStaff();
      const stranger = await fx.actor();
      await withSingleConnectionPool(async () => {
        for (let i = 0; i < 6; i += 1) {
          signIn(stranger);
          await assert.rejects(K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async () => 0), K.authz.TesAuthorizationDeniedError);
          signIn(actor);
          await assert.rejects(
            K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async () => {
              throw new Error("fail");
            }),
          );
        }
        assert.equal(await K.sys.withAuthorizedSystem("ORGANIZATION_CREATE", async () => "still works"), "still works");
      });
    });
  });

  describe("listAccessibleCustomers", () => {
    scenario("an ordinary actor gets exactly its own customers, and no tenant context is left behind", async () => {
      const a = await fx.organizationAndCustomer("A");
      await fx.organizationAndCustomer("B"); // exists, not assigned
      const actor = await customerUser(a.customerId);
      signIn(actor);
      await withSingleConnectionPool(async (pool) => {
        const result = await K.access.listAccessibleCustomers();
        assert.equal(result.kind, "ASSIGNED");
        assert.deepEqual(
          result.kind === "ASSIGNED" ? result.customers.map((c) => c.customerId) : null,
          [a.customerId],
        );
        const after = (await pool.query(`SELECT current_setting('tes.customer_id', true) AS raw`)).rows[0];
        assert.ok(after.raw === null || after.raw === "");
      });
    });

    scenario("registry-only SYSTEM staff gets no customers (registry visibility is not tenant access)", async () => {
      await fx.organizationAndCustomer();
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
      await fx.grant(relationshipId, "ORGANIZATION_REGISTRY_READ", { assignmentId });
      signIn(actor);
      assert.deepEqual(await K.access.listAccessibleCustomers(), { kind: "ASSIGNED", customers: [] });
    });

    scenario("Master Account gets the non-enumerating tagged result and selects no customer", async () => {
      await fx.organizationAndCustomer();
      const actor = await fx.actor();
      await fx.master(actor.actorId);
      signIn(actor);
      assert.deepEqual(await K.access.listAccessibleCustomers(), { kind: "MASTER_ACCOUNT_ANY_CUSTOMER" });
    });

    scenario("no session is rejected", async () => {
      K.db.setClerkUser(null);
      await assert.rejects(K.access.listAccessibleCustomers(), K.actor.TesIdentityRequiredError);
    });
  });
});
