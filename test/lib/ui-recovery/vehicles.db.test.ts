// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_* URLs.
//
// Vehicle lifecycle operations (registration periods, archive / restore, relationship end, unit number) through the REAL
// authorization wrappers, the RUNTIME role (row-level security of migration 0024) and the REAL Master Register. Fixtures and
// owner-level checks use the admin pool. Disposable database: nothing here is deleted afterwards except the auth fixtures.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    authz: await import("@/lib/auth/tes-authorization"),
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

const RUNTIME_ROLE = "tes-backend@tes-production-510007.iam";
const BOTH = ["VEHICLE_READ", "VEHICLE_MANAGE"];

describe("Vehicle lifecycle (real authorization, runtime role, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 8).toUpperCase();
  let counter = 0;
  const n = () => ++counter;

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
    return actor;
  }
  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `VL ${label} ${run} ${n()}`]);
    return id;
  }
  const vinOf = () => `VL${run}${String(n()).padStart(7, "0")}`;
  /** A vehicle on a company's record through the existing atomic create operation. */
  async function fleetVehicle(organizationId: string, unit: string) {
    const made = await K.oi.createVehicleForOrganization({ vehicleTypeCode: "TRUCK_TRACTOR", vin: vinOf(), make: "Testmake" }, { organizationId, relationshipType: "OPERATES", unitNumber: unit, effectiveFrom: new Date(Date.now() - 60_000).toISOString() });
    return { vehicleId: made.vehicle.vehicleId, relationshipId: made.relationship.relationshipId };
  }
  const plate = () => `VL${run.slice(0, 4)}${n()}`;
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const notFound = (promise: Promise<unknown>) => rejectsWith(promise, K.oi.VehicleOperationNotFoundError);
  const stateError = (promise: Promise<unknown>) => rejectsWith(promise, K.oi.VehicleOperationStateError);
  const conflict = (promise: Promise<unknown>) => rejectsWith(promise, K.oi.VehicleOperationConflictError);
  const invalid = (promise: Promise<unknown>) => assert.rejects(promise, (error: unknown) => error instanceof Error && error.constructor.name.endsWith("ValidationError"));
  const events = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string; target: { resourceType: string; subjectReferences: string[] }; change_set: unknown }>(
      `SELECT event_type, target, change_set FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`,
      [actorId],
    )).rows;
  const registrations = async (vehicleId: string) =>
    (await pools.admin.query<{ id: string; record_status: string; effective_from: string; effective_to: string | null; plate_display: string | null; superseded_by_id: string | null; corrected_at: string | null }>(
      `SELECT id, record_status, effective_from::text, effective_to::text, plate_display, superseded_by_id, corrected_at::text FROM public.vehicle_registration_periods WHERE vehicle_id = $1 ORDER BY created_at, id`,
      [vehicleId],
    )).rows;

  const reg = (organizationId: string, vehicleId: string, over: Record<string, unknown> = {}) => ({
    organizationId, vehicleId, plate: plate(), registrationNumber: `RN-${n()}`, jurisdictionCountry: "CA", jurisdictionRegion: "ON", effectiveFrom: "2024-01-01", ...over,
  });

  it("runs as the runtime role: the application connects as the policy-bound role", async () => {
    const who = await pools.runtime.query<{ current_user: string }>("SELECT current_user");
    assert.equal(who.rows[0].current_user, RUNTIME_ROLE);
  });

  it("authorization: no capability and read-only actors cannot change anything, and nothing is written", async () => {
    const org = await organization("AuthZ");
    const seeded = await signInWith(...BOTH);
    const { vehicleId, relationshipId } = await fleetVehicle(org, `AZ-${n()}`);
    const regId = (await K.oi.addVehicleRegistration(reg(org, vehicleId))).registrationId;

    const none = await signInWith();
    await assert.rejects(K.oi.addVehicleRegistration(reg(org, vehicleId)), K.authz.TesAuthorizationDeniedError);
    await assert.rejects(K.oi.archiveVehicle({ organizationId: org, vehicleId }), K.authz.TesAuthorizationDeniedError);
    await assert.rejects(K.reads.getOrganizationVehicleWorkspace(org), K.authz.TesAuthorizationDeniedError);

    await signInWith("VEHICLE_READ");
    await assert.rejects(K.oi.voidVehicleRegistration({ organizationId: org, registrationId: regId }), K.authz.TesAuthorizationDeniedError);
    await assert.rejects(K.oi.changeVehicleUnitNumber({ organizationId: org, relationshipId, unitNumber: "ZZ" }), K.authz.TesAuthorizationDeniedError);
    assert.equal((await K.reads.getOrganizationVehicleWorkspace(org)).length, 1, "VEHICLE_READ can read");

    await signInWith("VEHICLE_MANAGE");
    await assert.rejects(K.reads.getOrganizationVehicleWorkspace(org), K.authz.TesAuthorizationDeniedError);

    assert.equal((await registrations(vehicleId))[0].record_status, "active");
    assert.equal((await events(none.actorId)).length, 0);
    assert.equal((await events(seeded.actorId)).length, 3, "only the three accepted creations of the seeding actor");
  });

  it("registration periods: add, change keeps history, correct flags the mistaken row, void keeps the row; every step has a Master Register event", async () => {
    const actor = await signInWith(...BOTH);
    const org = await organization("Reg");
    const { vehicleId } = await fleetVehicle(org, `RG-${n()}`);
    const oldPlate = plate();
    const added = await K.oi.addVehicleRegistration(reg(org, vehicleId, { plate: oldPlate, effectiveFrom: "2023-01-01" }));
    assert.equal((await registrations(vehicleId)).length, 1);

    // a second current BASE registration for the same vehicle is refused (the schema allows one)
    await conflict(K.oi.addVehicleRegistration(reg(org, vehicleId)));

    // real-world change: the new plate starts 2024-06-01, the old period ends the same day
    const newPlate = plate();
    const changed = await K.oi.changeVehicleRegistration({ ...reg(org, vehicleId, { plate: newPlate, effectiveFrom: "2024-06-01" }), registrationId: added.registrationId });
    let rows = await registrations(vehicleId);
    assert.equal(rows.length, 2, "history is kept");
    const ended = rows.find((r) => r.id === added.registrationId)!;
    assert.equal(ended.record_status, "active");
    assert.equal(ended.effective_to, "2024-06-01");
    assert.equal(rows.find((r) => r.id === changed.registrationId)!.effective_to, null);
    await stateError(K.oi.changeVehicleRegistration({ ...reg(org, vehicleId, { effectiveFrom: "2025-01-01" }), registrationId: added.registrationId }));
    await invalid(K.oi.changeVehicleRegistration({ ...reg(org, vehicleId, { effectiveFrom: "2024-06-01" }), registrationId: changed.registrationId }));

    // mistaken plate: corrected by supersession, same business start
    const fixedPlate = plate();
    const corrected = await K.oi.correctVehicleRegistration({ organizationId: org, registrationId: changed.registrationId, plate: fixedPlate });
    rows = await registrations(vehicleId);
    const mistaken = rows.find((r) => r.id === changed.registrationId)!;
    assert.equal(mistaken.record_status, "corrected");
    assert.equal(mistaken.superseded_by_id, corrected.registrationId);
    assert.ok(mistaken.corrected_at);
    assert.equal(mistaken.plate_display, newPlate, "the mistaken value is kept, flagged, never overwritten");
    const replacement = rows.find((r) => r.id === corrected.registrationId)!;
    assert.equal(replacement.record_status, "active");
    assert.equal(replacement.plate_display, fixedPlate);
    assert.equal(replacement.effective_from, "2024-06-01");
    await stateError(K.oi.correctVehicleRegistration({ organizationId: org, registrationId: changed.registrationId, plate: plate() }));

    // void
    await K.oi.voidVehicleRegistration({ organizationId: org, registrationId: corrected.registrationId });
    rows = await registrations(vehicleId);
    assert.equal(rows.length, 3, "nothing was deleted");
    assert.equal(rows.find((r) => r.id === corrected.registrationId)!.record_status, "voided");
    await stateError(K.oi.voidVehicleRegistration({ organizationId: org, registrationId: corrected.registrationId }));

    // read model shows the history, current first
    const workspace = (await K.reads.getOrganizationVehicleWorkspace(org))[0];
    assert.equal(workspace.registrations.length, 3);
    assert.deepEqual(workspace.registrations.map((r) => r.recordStatus).sort(), ["active", "corrected", "voided"]);

    const recorded = await events(actor.actorId);
    assert.equal(recorded.filter((e) => e.event_type === "RECORD_CORRECTED").length, 2, "one correction, one void");
    const fixture = JSON.stringify(recorded);
    for (const secret of [oldPlate, newPlate, fixedPlate, "RN-"]) assert.equal(fixture.includes(secret), false, "plates and registration numbers never reach the Master Register");
    for (const event of recorded.filter((e) => ["vehicle_registration_periods"].includes(e.target.resourceType))) {
      assert.deepEqual(event.target.subjectReferences.sort(), [`organization:${org}`, `vehicle:${vehicleId}`].sort());
    }
  });

  it("registration validation and plate uniqueness: invalid input and a plate already on a current registration are refused", async () => {
    await signInWith(...BOTH);
    const org = await organization("RegVal");
    const a = await fleetVehicle(org, `RV-${n()}`);
    const b = await fleetVehicle(org, `RV-${n()}`);
    await invalid(K.oi.addVehicleRegistration({ organizationId: org, vehicleId: a.vehicleId, jurisdictionCountry: "CA", jurisdictionRegion: "ON", effectiveFrom: "2024-01-01" }));
    await invalid(K.oi.addVehicleRegistration(reg(org, a.vehicleId, { jurisdictionRegion: "ZZ" })));
    await invalid(K.oi.addVehicleRegistration(reg(org, a.vehicleId, { effectiveFrom: "2024-02-31" })));
    await invalid(K.oi.addVehicleRegistration(reg(org, a.vehicleId, { effectiveTo: "2023-01-01" })));
    const shared = plate();
    await K.oi.addVehicleRegistration(reg(org, a.vehicleId, { plate: shared }));
    await conflict(K.oi.addVehicleRegistration(reg(org, b.vehicleId, { plate: shared })));
    assert.equal(await count(`SELECT count(*) FROM public.vehicle_registration_periods WHERE vehicle_id = $1`, [b.vehicleId]), 0, "the refused add left nothing behind");
  });

  it("company isolation: another company cannot read, register, correct, archive or renumber this company's vehicle", async () => {
    await signInWith(...BOTH);
    const a = await organization("IsoA");
    const b = await organization("IsoB");
    const { vehicleId, relationshipId } = await fleetVehicle(a, `IA-${n()}`);
    const regId = (await K.oi.addVehicleRegistration(reg(a, vehicleId))).registrationId;

    assert.deepEqual(await K.reads.getOrganizationVehicleWorkspace(b), [], "the other company sees an honest empty list");
    await notFound(K.oi.addVehicleRegistration(reg(b, vehicleId)));
    await notFound(K.oi.correctVehicleRegistration({ organizationId: b, registrationId: regId, plate: plate() }));
    await notFound(K.oi.changeVehicleRegistration({ ...reg(b, vehicleId, { effectiveFrom: "2025-01-01" }), registrationId: regId }));
    await notFound(K.oi.voidVehicleRegistration({ organizationId: b, registrationId: regId }));
    await notFound(K.oi.archiveVehicle({ organizationId: b, vehicleId }));
    await notFound(K.oi.endVehicleRelationship({ organizationId: b, relationshipId }));
    await notFound(K.oi.changeVehicleUnitNumber({ organizationId: b, relationshipId, unitNumber: "HIJACK" }));
    await notFound(K.oi.correctVehicleUnitNumber({ organizationId: b, relationshipId, unitNumber: "HIJACK" }));
    // a body-supplied organization is never trusted: the operation scopes by the organization it is given (the route's URL)
    const state = await registrations(vehicleId);
    assert.equal(state.length, 1);
    assert.equal(state[0].record_status, "active");
    assert.equal((await K.listing.listOrganizationVehicles(a))[0].unitNumber?.startsWith("IA-"), true, "wrong-company requests changed nothing");
    assert.equal((await pools.admin.query(`SELECT record_status FROM public.vehicles WHERE id = $1`, [vehicleId])).rows[0].record_status, "active");
  });

  it("archive and restore: a status, not a delete; a vehicle another company still has is not archived from here", async () => {
    const actor = await signInWith(...BOTH);
    const a = await organization("Arch");
    const { vehicleId } = await fleetVehicle(a, `AR-${n()}`);
    await K.oi.archiveVehicle({ organizationId: a, vehicleId });
    let row = (await pools.admin.query(`SELECT record_status, archived_at FROM public.vehicles WHERE id = $1`, [vehicleId])).rows[0];
    assert.equal(row.record_status, "archived");
    assert.ok(row.archived_at);
    assert.equal((await K.reads.getOrganizationVehicleWorkspace(a))[0].vehicleStatus, "archived", "the archived vehicle stays readable with its history");
    await stateError(K.oi.archiveVehicle({ organizationId: a, vehicleId }));
    await stateError(K.oi.addVehicleRegistration(reg(a, vehicleId)));
    await K.oi.restoreVehicle({ organizationId: a, vehicleId });
    row = (await pools.admin.query(`SELECT record_status, archived_at FROM public.vehicles WHERE id = $1`, [vehicleId])).rows[0];
    assert.equal(row.record_status, "active");
    assert.equal(row.archived_at, null);
    await stateError(K.oi.restoreVehicle({ organizationId: a, vehicleId }));
    const types = (await events(actor.actorId)).map((e) => e.event_type);
    assert.ok(types.includes("RECORD_ARCHIVED") && types.includes("RECORD_RESTORED"));

    // shared physical vehicle
    const b = await organization("ArchShared");
    await K.oi.establishOrganizationVehicle({ organizationId: b, vehicleId, relationshipType: "OWNS", effectiveFrom: new Date(Date.now() - 1000).toISOString() });
    await stateError(K.oi.archiveVehicle({ organizationId: a, vehicleId }));
    assert.equal((await pools.admin.query(`SELECT record_status FROM public.vehicles WHERE id = $1`, [vehicleId])).rows[0].record_status, "active");
  });

  it("relationship: end keeps the row; unit change keeps history; unit correction flags the mistaken row; duplicates are refused", async () => {
    const actor = await signInWith(...BOTH);
    const org = await organization("Unit");
    const first = await fleetVehicle(org, `U1-${n()}`);
    const second = await fleetVehicle(org, `U2-${n()}`);
    const unitRows = async (vehicleId: string) =>
      (await pools.admin.query<{ id: string; unit_number_display: string; record_status: string; effective_to: string | null; superseded_by_id: string | null }>(
        `SELECT id, unit_number_display, record_status, effective_to::text, superseded_by_id FROM public.organization_vehicle_relationships WHERE vehicle_id = $1 AND organization_id = $2 ORDER BY created_at, id`,
        [vehicleId, org],
      )).rows;

    const newUnit = `N1-${n()}`;
    const changed = await K.oi.changeVehicleUnitNumber({ organizationId: org, relationshipId: first.relationshipId, unitNumber: newUnit });
    let rows = await unitRows(first.vehicleId);
    assert.equal(rows.length, 2, "history kept");
    assert.ok(rows.find((r) => r.id === first.relationshipId)!.effective_to);
    assert.equal(rows.find((r) => r.id === changed.relationshipId)!.unit_number_display, newUnit);
    await stateError(K.oi.changeVehicleUnitNumber({ organizationId: org, relationshipId: first.relationshipId, unitNumber: "again" }));
    await stateError(K.oi.changeVehicleUnitNumber({ organizationId: org, relationshipId: changed.relationshipId, unitNumber: newUnit.toLowerCase() }));
    const second_unit = (await unitRows(second.vehicleId))[0].unit_number_display;
    await conflict(K.oi.changeVehicleUnitNumber({ organizationId: org, relationshipId: changed.relationshipId, unitNumber: second_unit }));
    assert.equal((await unitRows(first.vehicleId)).length, 2, "the refused change left nothing behind");

    const typo = `N2-${n()}`;
    const corrected = await K.oi.correctVehicleUnitNumber({ organizationId: org, relationshipId: changed.relationshipId, unitNumber: typo });
    rows = await unitRows(first.vehicleId);
    const mistaken = rows.find((r) => r.id === changed.relationshipId)!;
    assert.equal(mistaken.record_status, "corrected");
    assert.equal(mistaken.superseded_by_id, corrected.relationshipId);
    assert.equal(mistaken.unit_number_display, newUnit, "the mistaken number stays as history");
    assert.equal((await K.listing.listOrganizationVehicles(org)).find((v) => v.vehicleId === first.vehicleId)!.unitNumber, typo);

    await K.oi.endVehicleRelationship({ organizationId: org, relationshipId: corrected.relationshipId });
    assert.equal((await K.listing.listOrganizationVehicles(org)).some((v) => v.vehicleId === first.vehicleId), false, "an ended relationship leaves the current list");
    assert.equal((await unitRows(first.vehicleId)).length, 3, "and stays in the database");
    await stateError(K.oi.endVehicleRelationship({ organizationId: org, relationshipId: corrected.relationshipId }));
    await invalid(K.oi.endVehicleRelationship({ organizationId: org, relationshipId: second.relationshipId, effectiveTo: "2000-01-01T00:00:00Z" }));
    await notFound(K.oi.addVehicleRegistration(reg(org, first.vehicleId)));
    assert.ok((await events(actor.actorId)).length >= 8);
  });

  it("rollback: a Master Register failure undoes the registration change in the same transaction", async () => {
    await signInWith(...BOTH);
    const org = await organization("Rollback");
    const { vehicleId } = await fleetVehicle(org, `RB-${n()}`);
    const added = await K.oi.addVehicleRegistration(reg(org, vehicleId, { effectiveFrom: "2023-01-01" }));
    await pools.admin.query(`
      CREATE OR REPLACE FUNCTION public.tes_test_fail_vehicle_master_register() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'RECORD_CREATED' AND NEW.action->>'operation' = 'VEHICLE_REGISTRATION_CHANGE' THEN RAISE EXCEPTION 'test: master register write refused'; END IF;
        RETURN NEW;
      END $$`);
    await pools.admin.query(`CREATE TRIGGER tes_test_fail_vehicle_master_register BEFORE INSERT ON public.master_register_events FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_vehicle_master_register()`);
    try {
      await assert.rejects(K.oi.changeVehicleRegistration({ ...reg(org, vehicleId, { effectiveFrom: "2024-06-01" }), registrationId: added.registrationId }));
    } finally {
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_vehicle_master_register ON public.master_register_events`);
      await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_vehicle_master_register()`);
    }
    const rows = await registrations(vehicleId);
    assert.equal(rows.length, 1, "the new period was rolled back");
    assert.equal(rows[0].effective_to, null, "the old period was not ended");
  });
});
