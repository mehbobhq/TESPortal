// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Migration 0024 enables row-level security on master_register_events: every SYSTEM actor may INSERT, but only
// MASTER_REGISTER_READ may SELECT. Recording an event must therefore never read the inserted row back, or it would fail for
// every capability except MASTER_REGISTER_READ. These tests run the real repository on the runtime role under a capability that
// cannot read the Register.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    system: await import("@/lib/auth/tes-system-context"),
    repository: await import("@/lib/master-register/postgres-repository"),
    registerRepository: await import("@/lib/master-register/repository"),
    record: await import("@/lib/master-register/record-event"),
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

describe("Master Register append under row-level security", { skip: !enabled }, () => {
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

  async function signedInStaff(capability: string) {
    fx = new K.db.AuthFixtures(pools.admin);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    await fx.grant(relationshipId, capability, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
    return actor;
  }

  it("a SYSTEM actor without MASTER_REGISTER_READ can append, gets the stored event back and cannot read the Register", async () => {
    const actor = await signedInStaff("VEHICLE_MANAGE");
    try {
      const outcome = await K.system.withAuthorizedSystem("VEHICLE_MANAGE", async (client, decision) => {
        const repository = new K.repository.PostgresMasterRegisterRepository(client);
        const event = await K.record.recordEvent(repository, {
          eventType: "RECORD_CREATED",
          actor: { actorType: decision.actor.actorType, actorId: decision.actor.id },
          action: { operation: "RLS_REGRESSION" },
          target: { resourceType: "vehicles", resourceId: randomUUID(), subjectReferences: [] },
          source: { sourceType: "APPLICATION", component: "master-register-test", workflow: "RLS_REGRESSION" },
          classification: { materiality: "MATERIAL" },
          outcome: { result: "SUCCESS" },
        });
        const readBack = await repository.getById(event.eventId);
        return { event, readBack };
      });

      assert.equal(outcome.event.eventType, "RECORD_CREATED");
      assert.equal(outcome.event.actor.actorId, actor.actorId);
      assert.equal(outcome.event.occurredAt, new Date(outcome.event.occurredAt).toISOString());
      assert.equal(outcome.readBack, undefined, "the same capability cannot read the Register back");

      const stored = await pools.admin.query<{ event_type: string; actor_id: string }>(
        `SELECT event_type, actor_id FROM public.master_register_events WHERE event_id = $1::uuid`,
        [outcome.event.eventId],
      );
      assert.deepEqual(stored.rows, [{ event_type: "RECORD_CREATED", actor_id: actor.actorId }]);
    } finally {
      K.db.setClerkUser(null);
      await fx.cleanup();
    }
  });

  it("appending the same event twice is still a DuplicateEventError", async () => {
    await signedInStaff("VEHICLE_MANAGE");
    try {
      await assert.rejects(
        K.system.withAuthorizedSystem("VEHICLE_MANAGE", async (client, decision) => {
          const repository = new K.repository.PostgresMasterRegisterRepository(client);
          const event = K.record.buildMasterRegisterEvent({
            eventType: "RECORD_CREATED",
            actor: { actorType: decision.actor.actorType, actorId: decision.actor.id },
            action: { operation: "RLS_REGRESSION" },
            target: { resourceType: "vehicles", resourceId: randomUUID(), subjectReferences: [] },
            source: { sourceType: "APPLICATION", component: "master-register-test", workflow: "RLS_REGRESSION" },
            classification: { materiality: "MATERIAL" },
            outcome: { result: "SUCCESS" },
          });
          await repository.append(event);
          await repository.append(event);
        }),
        (error: unknown) => error instanceof K.registerRepository.DuplicateEventError,
      );
    } finally {
      K.db.setClerkUser(null);
      await fx.cleanup();
    }
  });
});
