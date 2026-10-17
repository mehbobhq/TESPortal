// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// A physical vehicle is a GLOBAL identity that several companies can hold through their own relationships. One company ending its
// relationship must not archive the vehicle, change another company's access, or erase history; one company cannot archive a vehicle
// another company still has on its current record. Real authorization, runtime role, real Master Register.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    oi: await import("@/lib/operational-identity/service"),
    reads: await import("@/lib/operational-identity/vehicle-workspace-reads"),
    listing: await import("@/lib/operational-identity/reads"),
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

describe("shared vehicle lifecycle (global vehicle, per-company relationships)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().replace(/\D/g, "").slice(0, 6).padEnd(6, "3");
  let counter = 0;
  const n = () => ++counter;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    for (const fx of fixtures) await fx.cleanup().catch(() => undefined);
    await K.db.closePools();
  });

  async function signInWith(...capabilities: string[]) {
    const fx = new K.db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability as never, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
    return actor;
  }
  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `SVL ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }
  const BOTH = ["VEHICLE_READ", "VEHICLE_MANAGE"];
  const vin = () => `1HG${run}${String(n()).padStart(8, "0")}`;
  const row = async (sql: string, params: unknown[] = []) => (await pools.admin.query(sql, params)).rows[0];
  const state = (promise: Promise<unknown>) => assert.rejects(promise, (e: unknown) => e instanceof Error && /StateError|NotFoundError/.test(e.constructor.name));

  /** Company A creates the vehicle; company B then holds the same vehicle through its own relationship. */
  async function sharedVehicle() {
    const a = await organization("A");
    const b = await organization("B");
    const made = await K.oi.createVehicleForOrganization({ vehicleTypeCode: "TRUCK_TRACTOR", vin: vin(), make: "Testmake" }, { organizationId: a, relationshipType: "OPERATES", unitNumber: `A-${n()}`, effectiveFrom: new Date(Date.now() - 60_000).toISOString() });
    const vehicleId = made.vehicle.vehicleId;
    const second = await K.oi.createVehicleForOrganization({ vehicleTypeCode: "TRUCK_TRACTOR", vin: (await row(`SELECT vin_display FROM public.vehicles WHERE id=$1`, [vehicleId])).vin_display }, { organizationId: b, relationshipType: "OPERATES", unitNumber: `B-${n()}`, effectiveFrom: new Date(Date.now() - 30_000).toISOString() });
    assert.equal(second.vehicle.kind, "EXISTING");
    assert.equal(second.vehicle.vehicleId, vehicleId, "the same vehicle identity, not a copy");
    return { a, b, vehicleId, relA: made.relationship.relationshipId, relB: second.relationship.relationshipId };
  }

  it("ending one company's relationship does not archive the vehicle or change the other company's access", async () => {
    const actor = await signInWith(...BOTH);
    const { a, b, vehicleId, relA, relB } = await sharedVehicle();
    await K.oi.addVehicleRegistration({ organizationId: a, vehicleId, plate: `PA${run}${n()}`, registrationNumber: `RA${n()}`, jurisdictionCountry: "CA", jurisdictionRegion: "ON", effectiveFrom: "2024-01-01" });
    const bBefore = await K.reads.getOrganizationVehicleWorkspace(b);
    assert.equal(bBefore.length, 1);

    const before = await row(`SELECT count(*)::int AS n FROM public.master_register_events WHERE actor_id = $1::uuid`, [actor.actorId]);
    await K.oi.endVehicleRelationship({ organizationId: a, relationshipId: relA });

    assert.equal((await row(`SELECT record_status FROM public.vehicles WHERE id=$1`, [vehicleId])).record_status, "active", "the global vehicle stays active");
    const ended = await row(`SELECT record_status, effective_to IS NOT NULL AS ended FROM public.organization_vehicle_relationships WHERE id=$1`, [relA]);
    assert.deepEqual(ended, { record_status: "active", ended: true }, "A's relationship row is kept, with an end date");
    const live = await row(`SELECT effective_to IS NULL AS open FROM public.organization_vehicle_relationships WHERE id=$1`, [relB]);
    assert.equal(live.open, true, "B's relationship is untouched");
    const bAfter = await K.reads.getOrganizationVehicleWorkspace(b);
    assert.deepEqual(bAfter.map((v) => v.vehicleId), bBefore.map((v) => v.vehicleId), "B still sees the vehicle");
    assert.equal(bAfter[0].vehicleStatus, "active");
    assert.equal((await K.listing.listOrganizationVehicles(b)).length, 1);
    const after = await row(`SELECT count(*)::int AS n FROM public.master_register_events WHERE actor_id = $1::uuid`, [actor.actorId]);
    assert.ok(after.n > before.n, "the end is recorded in the Master Register");
    const types = (await pools.admin.query(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid`, [actor.actorId])).rows.map((r) => r.event_type);
    assert.ok(types.includes("RECORD_UPDATED"));
    assert.equal(await row(`SELECT count(*)::int AS n FROM public.vehicle_registration_periods WHERE vehicle_id=$1`, [vehicleId]).then((r) => r.n), 1, "registration history is kept");
  });

  it("B cannot see A's registration history, before or after A ends its relationship", async () => {
    await signInWith(...BOTH);
    const { a, b, vehicleId, relA } = await sharedVehicle();
    const plate = `PRIV${run}${n()}`;
    await K.oi.addVehicleRegistration({ organizationId: a, vehicleId, plate, registrationNumber: `RN${n()}`, jurisdictionCountry: "CA", jurisdictionRegion: "ON", effectiveFrom: "2024-01-01" });
    const visible = (workspace: unknown) => JSON.stringify(workspace).includes(plate);
    assert.equal(visible(await K.reads.getOrganizationVehicleWorkspace(b)), false);
    await K.oi.endVehicleRelationship({ organizationId: a, relationshipId: relA });
    assert.equal(visible(await K.reads.getOrganizationVehicleWorkspace(b)), false);
  });

  it("archive: refused while another company has the vehicle current; after A ends, A cannot archive it, and B (now the only holder) can", async () => {
    await signInWith(...BOTH);
    const { a, b, vehicleId, relA } = await sharedVehicle();
    await state(K.oi.archiveVehicle({ organizationId: a, vehicleId }));
    await state(K.oi.archiveVehicle({ organizationId: b, vehicleId }));
    assert.equal((await row(`SELECT record_status FROM public.vehicles WHERE id=$1`, [vehicleId])).record_status, "active");
    await K.oi.endVehicleRelationship({ organizationId: a, relationshipId: relA });
    await state(K.oi.archiveVehicle({ organizationId: a, vehicleId }));
    assert.equal((await row(`SELECT record_status FROM public.vehicles WHERE id=$1`, [vehicleId])).record_status, "active", "A, no longer holding it, cannot archive it");
    await K.oi.archiveVehicle({ organizationId: b, vehicleId });
    assert.equal((await row(`SELECT record_status FROM public.vehicles WHERE id=$1`, [vehicleId])).record_status, "archived");
  });

  it("a relationship of one company cannot be ended through the other company", async () => {
    await signInWith(...BOTH);
    const { a, b, relA, relB } = await sharedVehicle();
    await state(K.oi.endVehicleRelationship({ organizationId: b, relationshipId: relA }));
    await state(K.oi.endVehicleRelationship({ organizationId: a, relationshipId: relB }));
    assert.equal((await row(`SELECT count(*)::int AS n FROM public.organization_vehicle_relationships WHERE id IN ($1,$2) AND effective_to IS NULL`, [relA, relB])).n, 2);
  });
});
