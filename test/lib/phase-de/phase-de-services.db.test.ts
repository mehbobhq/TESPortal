// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Block 01 Phase D/E: the company edit service and the additive vehicle/driver read services, through the REAL
// authorization wrappers and the RUNTIME role (row-level security of migration 0024 applies). Fixtures use the admin pool.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    dir: await import("@/lib/company-directory/service"),
    reads: await import("@/lib/operational-identity/reads"),
    oi: await import("@/lib/operational-identity/service"),
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

describe("Phase D/E canonical-backed services (real authorization, real transactions)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  const run = randomUUID().slice(0, 8).toUpperCase();

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  async function signInWith(...capabilities: string[]) {
    fx = new K.db.AuthFixtures(pools.admin);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
  }

  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `PDE ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }

  it("edits trade name and identifiers through corporate-identity operations; the registered legal name is gated", async () => {
    await signInWith("ORGANIZATION_REGISTRY_READ", "ORGANIZATION_UPDATE");
    try {
      const id = await organization("Edit");
      const before = await K.dir.getCompanyEditRecord(id);
      assert.equal(before.dba, "");
      assert.equal(before.businessNo, "");

      // the registered legal name is NOT changed by an ordinary edit (it needs the evidence + authority gate): refused, nothing saved
      const renamed = `Renamed ${run} ${id.slice(0, 6)} Ltd`;
      await assert.rejects(K.dir.updateCompanyDirectoryRecord(id, { companyName: renamed, dba: "Trade One" }), /legal-name change procedure/);
      assert.equal((await K.dir.getCompanyEditRecord(id)).dba, "", "the refused edit saved nothing");
      const first = await K.dir.updateCompanyDirectoryRecord(id, { companyName: before.companyName, dba: "Trade One", businessNo: "123456782", ein: "12-3456789" });
      assert.equal(first.companyName, before.companyName);
      assert.equal(first.dba, "Trade One");
      assert.equal(first.businessNo, "123456782");
      assert.equal(first.ein, "12-3456789");

      const second = await K.dir.updateCompanyDirectoryRecord(id, { dba: "", businessNo: "" });
      assert.equal(second.dba, "");
      assert.equal(second.businessNo, "");
      assert.equal(second.ein, first.ein, "omitted fields are left alone");

      const reread = await K.dir.getCompanyEditRecord(id);
      assert.deepEqual(reread, second);
      await assert.rejects(K.dir.updateCompanyDirectoryRecord(id, { companyName: "   " }), (error: unknown) => error instanceof K.dir.CompanyDirectoryValidationError);
      await assert.rejects(K.dir.updateCompanyDirectoryRecord(id, { incorpNo: "ABC123" }), (error: unknown) => error instanceof K.dir.CompanyDirectoryValidationError);
    } finally {
      K.db.setClerkUser(null);
      await fx.cleanup();
    }
  });

  it("lists an Organization's current vehicles under VEHICLE_READ only", async () => {
    const id = await organization("Fleet");
    await signInWith("VEHICLE_MANAGE");
    const created = await K.oi.createVehicle({ vehicleTypeCode: "TRUCK_TRACTOR", vin: `PD${run}${String(Date.now() % 10000000).padStart(7, "0")}`, make: "Testmake", modelYear: 2022 });
    await K.oi.establishOrganizationVehicle({ organizationId: id, vehicleId: created.vehicleId, relationshipType: "OPERATES", unitNumber: "pde-1", effectiveFrom: "2024-01-01T00:00:00Z" });
    K.db.setClerkUser(null);
    await fx.cleanup();

    await signInWith("VEHICLE_READ");
    try {
      const rows = await K.reads.listOrganizationVehicles(id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].vehicleId, created.vehicleId);
      assert.equal(rows[0].unitNumber, "pde-1");
      assert.equal(rows[0].relationshipType, "OPERATES");
      assert.equal(rows[0].make, "Testmake");
      assert.deepEqual(await K.reads.listOrganizationVehicles(await organization("Empty")), []);
    } finally {
      K.db.setClerkUser(null);
      await fx.cleanup();
    }
  });

  it("refuses the vehicle and driver reads without their capability", async () => {
    await signInWith("ORGANIZATION_REGISTRY_READ");
    try {
      await assert.rejects(K.reads.listOrganizationVehicles(randomUUID()));
      await assert.rejects(K.reads.listOrganizationDrivers(randomUUID()));
    } finally {
      K.db.setClerkUser(null);
      await fx.cleanup();
    }
  });

  it("lists an Organization's current drivers with name and licence under DRIVER_READ only", async () => {
    const id = await organization("Drivers");
    const personId = randomUUID();
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO public.persons (id) VALUES ($1)`, [personId]);
      await client.query(
        `INSERT INTO public.person_name_versions (person_id, given_name, family_name, name_normalized, change_reason, effective_from) VALUES ($1, 'Dana', $2, $3, 'INITIAL', '2020-01-01Z')`,
        [personId, `Driver${run}`, `dana driver${run.toLowerCase()}`],
      );
      await client.query(`INSERT INTO public.driver_profiles (person_id) VALUES ($1)`, [personId]);
      await client.query(
        `INSERT INTO public.driver_licences (person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_number_normalized, licence_class, effective_from)
         VALUES ($1, 'CA', 'ON', $2, $2, 'AZ', '2020-01-01')`,
        [personId, `D${run}${Date.now() % 100000}`],
      );
      await client.query(
        `INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, driver_number_display, driver_number_normalized, status, effective_from)
         VALUES ($1, $2, 'EMPLOYEE', 'D-1', 'D1', 'ACTIVE', '2024-01-01')`,
        [id, personId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    await signInWith("DRIVER_READ");
    try {
      const rows = await K.reads.listOrganizationDrivers(id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].personId, personId);
      assert.equal(rows[0].givenName, "Dana");
      assert.equal(rows[0].familyName, `Driver${run}`);
      assert.equal(rows[0].status, "ACTIVE");
      assert.equal(rows[0].licence?.licenceClass, "AZ");
      assert.equal(rows[0].licence?.jurisdictionRegion, "ON");
    } finally {
      K.db.setClerkUser(null);
      await fx.cleanup();
    }
  });
});
