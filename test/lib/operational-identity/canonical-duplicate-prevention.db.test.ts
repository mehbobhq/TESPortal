// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh). Migration 0038 and the system-wide duplicate-prevention changes.
//
// Real services, real authorization wrappers, the RUNTIME role (row-level security applies), the real Master Register; fixtures and owner-level
// checks use the admin pool. Domains whose duplicate prevention already existed are proven by their own suites (named in the report); this file
// covers what this work package added or hardened: vehicles, jurisdiction-spelling collisions, company duplicate candidates, concurrent creation,
// people reuse without merging, evidence independence, and confidential conflict responses.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    fixtures: await import("@/test/helpers/evidence-payload-fixtures"),
    oi: await import("@/lib/operational-identity/service"),
    errors: await import("@/lib/operational-identity/errors"),
    dir: await import("@/lib/company-directory/service"),
    corp: await import("@/lib/corporate-identity/errors"),
    contacts: await import("@/lib/contacts/service"),
    response: await import("@/lib/api/canonical-response"),
  };
}
type Kit = Awaited<ReturnType<typeof loadKit>>;
const K = {} as Kit;

const enabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
if (!enabled && process.env.TES_REQUIRE_DB_TESTS === "1") {
  it("requires a disposable test database (TES_REQUIRE_DB_TESTS=1)", () => assert.fail("TES_TEST_ADMIN_DATABASE_URL and TES_TEST_RUNTIME_DATABASE_URL must be set"));
}

type PgError = Error & { code?: string; constraint?: string };
const digits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join("");

describe("System-wide duplicate prevention (migration 0038)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let has0038 = false;
  const run = randomUUID().slice(0, 8).toUpperCase();
  let counter = 0;
  const n = () => ++counter;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
    has0038 = (await pools.admin.query(`SELECT to_regclass('public.organization_vehicle_open_operator_uq') IS NOT NULL AS p`)).rows[0].p;
  });
  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  const scenario = (name: string, body: () => Promise<void>, needs0038: boolean | "pre" = false) =>
    it(`${needs0038 === "pre" ? "[pre-0038] " : needs0038 ? "[0038] " : ""}${name}`, async (t) => {
      if (needs0038 === true && !has0038) return t.skip("database has no 0038");
      if (needs0038 === "pre" && has0038) return t.skip("database already has 0038");
      fx = new K.db.AuthFixtures(pools.admin);
      K.db.setClerkUser(null);
      try {
        await body();
      } finally {
        K.db.setClerkUser(null);
        await fx.cleanup().catch(() => undefined);
      }
    });

  async function org(label = "Org"): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `DUP ${label} ${id.slice(0, 8)} ${n()}`]);
    return id;
  }
  async function only(...capabilities: string[]): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
    return actor;
  }
  const rows = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await pools.admin.query(sql, params)).rows as T[];
  const count = async (sql: string, params: unknown[] = []) => Number((await rows<{ count: string }>(sql, params))[0].count);
  const refused = async (promise: Promise<unknown>): Promise<Error> => {
    try {
      await promise;
    } catch (error) {
      return error as Error;
    }
    return assert.fail("expected the operation to be refused");
  };
  const vinOf = () => `TV${run}${String(n()).padStart(7, "0")}`;
  const vehicleInput = (vin: string) => ({ vehicleTypeCode: "TRUCK_TRACTOR" as const, vin, make: "Testmake" });
  const rel = (organizationId: string, type: "OPERATES" | "OWNS" | "LEASES" = "OPERATES") => ({ organizationId, relationshipType: type, unitNumber: `U${n()}`, effectiveFrom: "2024-01-01T00:00:00Z" });
  const openRelationships = (vehicleId: string) => count(`SELECT count(*) FROM public.organization_vehicle_relationships WHERE vehicle_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [vehicleId]);
  const end = (vehicleId: string, organizationId: string) =>
    pools.admin.query(`UPDATE public.organization_vehicle_relationships SET effective_to = '2024-06-01T00:00:00Z' WHERE vehicle_id = $1 AND organization_id = $2 AND effective_to IS NULL`, [vehicleId, organizationId]);
  const register = (operation: string, resourceId: string) =>
    rows<{ actor_id: string }>(`SELECT actor_id FROM public.master_register_events WHERE action->>'operation' = $1 AND target->>'resourceId' = $2`, [operation, resourceId]);

  // ---- vehicles ---------------------------------------------------------------------------------------------------

  describe("vehicles: VIN identity, one current owner and operator, no silent cross-company reuse", () => {
    scenario("an existing vehicle (any VIN spelling) is detected; one in use elsewhere is never silently reused; ended history is preserved; legitimate reuse works", async () => {
      const actor = await only("VEHICLE_MANAGE");
      const [a, b, c] = await Promise.all([org("VehA"), org("VehB"), org("VehC")]);
      const vin = vinOf();
      const first = await K.oi.createVehicleForOrganization(vehicleInput(vin), rel(a));
      assert.equal(first.vehicle.kind, "CREATED");
      const vehicleId = first.vehicle.vehicleId;

      // another company submits the same VIN in a different spelling: refused with a safe 409, nothing created, nothing disclosed
      const spelled = vin.toLowerCase().replace(/(.{4})/g, "$1-");
      const error = await refused(K.oi.createVehicleForOrganization(vehicleInput(spelled), rel(b)));
      assert.ok(error instanceof K.errors.VehicleIdentityConflictError);
      const response = K.response.canonicalFailure(error, "x");
      assert.equal(response.status, 409);
      const text = JSON.stringify(await response.json()) + error.message;
      for (const secret of [a, vehicleId, vin]) assert.ok(!text.includes(secret), "no identifier of the other company or vehicle in the response");
      assert.equal(await count(`SELECT count(*) FROM public.vehicles WHERE vin_normalized = $1`, [vin]), 1);
      assert.equal(await count(`SELECT count(*) FROM public.organization_vehicle_relationships WHERE organization_id = $1 AND vehicle_id = $2`, [b, vehicleId]), 0);

      // owner and operator may be different companies; two owners or two operators may not; the same company cannot repeat itself
      const owns = await K.oi.establishOrganizationVehicle({ ...rel(b, "OWNS"), vehicleId });
      assert.ok(owns.relationshipId);
      assert.ok((await refused(K.oi.establishOrganizationVehicle({ ...rel(c, "OWNS"), vehicleId }))) instanceof K.errors.VehicleIdentityConflictError, "second owner");
      assert.ok((await refused(K.oi.establishOrganizationVehicle({ ...rel(c, "OPERATES"), vehicleId }))) instanceof K.errors.VehicleIdentityConflictError, "second operator");
      assert.equal((await refused(K.oi.establishOrganizationVehicle({ ...rel(b, "OWNS"), vehicleId }))).message, K.errors.VEHICLE_HELD_HERE_MESSAGE, "same company");
      await K.oi.establishOrganizationVehicle({ ...rel(c, "LEASES"), vehicleId }); // LEASES is not exclusive
      assert.equal(await openRelationships(vehicleId), 3);
      assert.ok((await refused(K.oi.establishOrganizationVehicle({ ...rel(a), vehicleId: randomUUID() }))) instanceof K.errors.VehicleIdentityNotFoundError);

      // while ANY other company holds the vehicle it cannot be created-and-linked for a new company
      await end(vehicleId, a);
      assert.ok((await refused(K.oi.createVehicleForOrganization(vehicleInput(vin), rel(c, "OPERATES")))) instanceof K.errors.VehicleIdentityConflictError, "B still owns it");
      // once nobody holds it, reuse is legitimate: the SAME vehicle is linked (no duplicate), and the earlier history is untouched
      await end(vehicleId, b);
      await end(vehicleId, c);
      const reused = await K.oi.createVehicleForOrganization(vehicleInput(vin), rel(c, "OPERATES"));
      assert.equal(reused.vehicle.kind, "EXISTING");
      assert.equal(reused.vehicle.vehicleId, vehicleId);
      assert.equal(await count(`SELECT count(*) FROM public.vehicles WHERE vin_normalized = $1`, [vin]), 1);
      assert.equal(await count(`SELECT count(*) FROM public.organization_vehicle_relationships WHERE vehicle_id = $1`, [vehicleId]), 4, "every relationship is preserved");
      assert.equal(await openRelationships(vehicleId), 1);

      // accountability: the Master Register names the actor; refused attempts recorded nothing
      assert.equal((await register("ORGANIZATION_VEHICLE_ESTABLISH", owns.relationshipId))[0].actor_id, actor.actorId);
      assert.equal(await count(`SELECT count(*) FROM public.master_register_events WHERE action->>'operation' = 'ORGANIZATION_VEHICLE_ESTABLISH' AND target->>'resourceId' IN (SELECT id::text FROM public.organization_vehicle_relationships WHERE vehicle_id = $1)`, [vehicleId]), 4);
    });

    scenario("legitimate arrangements are NOT rejected: an owner-operator, a lessor and its lessee, a replacement operator after an explicit end, a second vehicle for the same unit", async () => {
      await only("VEHICLE_MANAGE");
      const [a, b] = await Promise.all([org("ArrA"), org("ArrB")]);
      const { vehicleId } = await K.oi.createVehicle(vehicleInput(vinOf()));
      // one company may both own and operate its own vehicle
      await K.oi.establishOrganizationVehicle({ ...rel(a, "OWNS"), vehicleId });
      await K.oi.establishOrganizationVehicle({ ...rel(a, "OPERATES"), vehicleId });
      assert.equal(await openRelationships(vehicleId), 2);
      // the operator can be replaced by another company once the first relationship is ended explicitly (history kept)
      await end(vehicleId, a); // ends both of A's open rows
      // a relationship overlapping an earlier period of the SAME company gets its own accurate message, not the "another company" one
      assert.equal((await refused(K.oi.establishOrganizationVehicle({ ...rel(a, "OWNS"), vehicleId, effectiveFrom: "2024-03-01T00:00:00Z" }))).message, K.errors.VEHICLE_OVERLAP_MESSAGE);
      await K.oi.establishOrganizationVehicle({ ...rel(b, "OPERATES"), vehicleId, effectiveFrom: "2024-06-01T00:00:00Z" });
      await K.oi.establishOrganizationVehicle({ ...rel(a, "OWNS"), vehicleId, effectiveFrom: "2024-06-01T00:00:00Z" }); // A owns again, B operates: lessor / lessee
      assert.equal(await openRelationships(vehicleId), 2, "A owns, B operates");
      assert.equal(await count(`SELECT count(*) FROM public.organization_vehicle_relationships WHERE vehicle_id = $1`, [vehicleId]), 4);
      // a vehicle without a VIN is never merged by VIN, and the same unit number in ANOTHER company is a different unit
      const unit = `UNIT${n()}`;
      const v1 = await K.oi.createVehicle({ vehicleTypeCode: "TRAILER" });
      const v2 = await K.oi.createVehicle({ vehicleTypeCode: "TRAILER" });
      assert.equal(v1.kind, "CREATED");
      assert.equal(v2.kind, "CREATED");
      assert.notEqual(v1.vehicleId, v2.vehicleId);
      await K.oi.establishOrganizationVehicle({ organizationId: a, vehicleId: v1.vehicleId, relationshipType: "OPERATES", unitNumber: unit, effectiveFrom: "2024-01-01T00:00:00Z" });
      await K.oi.establishOrganizationVehicle({ organizationId: b, vehicleId: v2.vehicleId, relationshipType: "OPERATES", unitNumber: unit, effectiveFrom: "2024-01-01T00:00:00Z" });
    });

    scenario("simultaneous creation: two companies racing for one new VIN produce ONE vehicle, one winner and a safe conflict for the other", async () => {
      await only("VEHICLE_MANAGE");
      const [a, b] = await Promise.all([org("RaceVA"), org("RaceVB")]);
      const vins = Array.from({ length: 6 }, () => vinOf());
      const results = await Promise.allSettled(vins.flatMap((vin) => [a, b].map((organizationId) => K.oi.createVehicleForOrganization(vehicleInput(vin), rel(organizationId)))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, vins.length, "one winner per VIN");
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.errors.VehicleIdentityConflictError, String(r.reason));
      for (const vin of vins) {
        assert.equal(await count(`SELECT count(*) FROM public.vehicles WHERE vin_normalized = $1`, [vin]), 1);
        assert.equal(await openRelationships((await rows<{ id: string }>(`SELECT id FROM public.vehicles WHERE vin_normalized = $1`, [vin]))[0].id), 1);
      }
    });

    scenario("simultaneous relationship attempts on an existing vehicle: exactly one current operator", async () => {
      await only("VEHICLE_MANAGE");
      const orgs = await Promise.all([org("OpA"), org("OpB"), org("OpC")]);
      const { vehicleId } = await K.oi.createVehicle(vehicleInput(vinOf()));
      const results = await Promise.allSettled(orgs.map((organizationId) => K.oi.establishOrganizationVehicle({ ...rel(organizationId), vehicleId })));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.errors.VehicleIdentityConflictError, String(r.reason));
      assert.equal(await openRelationships(vehicleId), 1);
    });

    scenario("a writer that bypasses the service is stopped by the database: concurrent raw inserts and the exclusive types", async () => {
      const [a, b, c] = await Promise.all([org("RawVA"), org("RawVB"), org("RawVC")]);
      const vehicleId = randomUUID();
      await pools.admin.query(`INSERT INTO public.vehicles (id, vehicle_type_code, vin_normalized, vin_display) VALUES ($1, 'TRUCK_TRACTOR', $2, $2)`, [vehicleId, vinOf()]);
      const insert = `INSERT INTO public.organization_vehicle_relationships (organization_id, vehicle_id, relationship_type, effective_from) VALUES ($1, $2, $3, '2024-01-01T00:00:00Z')`;
      const c1 = await pools.admin.connect();
      const c2 = await pools.admin.connect();
      try {
        await c1.query("BEGIN");
        await c1.query(insert, [a, vehicleId, "OPERATES"]);
        await c2.query("BEGIN");
        const second = c2.query(insert, [b, vehicleId, "OPERATES"]).then(() => undefined, (e: PgError) => e);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await c1.query("COMMIT");
        const error = await second;
        assert.equal(error?.code, "23505");
        assert.equal(error?.constraint, "organization_vehicle_open_operator_uq");
        await c2.query("ROLLBACK");
      } finally {
        c1.release();
        c2.release();
      }
      await pools.admin.query(insert, [a, vehicleId, "OWNS"]);
      assert.equal(((await pools.admin.query(insert, [b, vehicleId, "OWNS"]).catch((e: PgError) => e)) as PgError).constraint, "organization_vehicle_open_owner_uq");
      await pools.admin.query(insert, [b, vehicleId, "LEASES"]);
      await pools.admin.query(insert, [c, vehicleId, "LEASES"]);
    }, true);

    scenario("capability and tenant boundaries hold: a read-only caller cannot establish", async () => {
      const a = await org("CapV");
      await only("VEHICLE_MANAGE");
      const { vehicleId } = await K.oi.createVehicle(vehicleInput(vinOf()));
      await only("VEHICLE_READ");
      assert.equal((await refused(K.oi.establishOrganizationVehicle({ ...rel(a), vehicleId }))).constructor.name, "TesAuthorizationDeniedError");
      assert.equal(await openRelationships(vehicleId), 0);
    });
  });

  // ---- jurisdiction-spelling collisions ----------------------------------------------------------------------------

  describe("natural keys are unique on the canonical jurisdiction, in their own namespaces", () => {
    /** Runs work in a transaction that is ALWAYS rolled back (the deferred integrity triggers of the parent rows never fire). */
    async function inRolledBack<T>(work: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        return await work(client);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    }
    const attempt = async (client: import("pg").PoolClient, sql: string, params: unknown[]) => {
      await client.query("SAVEPOINT s");
      try {
        await client.query(sql, params);
        await client.query("RELEASE SAVEPOINT s");
        return undefined;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT s");
        return error as PgError;
      }
    };

    scenario("company identifiers: 'Canada'/'CA' and 'Ontario'/'ON' are one jurisdiction; another region or another type is not a collision", async () => {
      const [a, b] = await Promise.all([org("IdA"), org("IdB")]);
      const value = digits(9);
      await inRolledBack(async (client) => {
        const insert = `INSERT INTO public.organization_identifiers (organization_id, identifier_type, namespace, jurisdiction_country, jurisdiction_region, value, normalized_value) VALUES ($1, $2, $3, $4, $5, $6, $6)`;
        assert.equal(await attempt(client, insert, [a, "incorporation_number", "corporate_registry", "CA", "ON", value]), undefined);
        for (const [country, region] of [["CA", "ON"], ["Canada", "Ontario"], ["can", " on. "], ["CANADA", "ONTARIO"]]) {
          const error = await attempt(client, insert, [b, "incorporation_number", "corporate_registry", country, region, value]);
          // an equivalent SPELLING is refused outright by the new scope check; the canonical key backs it for rows written before the check existed
          assert.ok(["23505", "23514"].includes(error?.code ?? ""), `${country}/${region}: ${error?.code}`);
        }
        assert.equal(await attempt(client, insert, [b, "incorporation_number", "corporate_registry", "CA", "BC", value]), undefined, "another region");
        assert.equal(await attempt(client, insert, [b, "extra_provincial_registration", "corporate_registry", "CA", "ON", value]), undefined, "another identifier type");
        assert.equal(await attempt(client, insert, [b, "business_number", "cra", "CA", null, value]), undefined, "another namespace, no region");
      });
    }, true);

    scenario("registrations: the same number in the same program and jurisdiction collides under any spelling; another jurisdiction does not", async () => {
      const [a, b] = await Promise.all([org("RgA"), org("RgB")]);
      await inRolledBack(async (client) => {
        const registration = async (organizationId: string, program: string) =>
          (await client.query<{ id: string }>(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, $2) RETURNING id`, [organizationId, program])).rows[0].id;
        const version = (registrationId: string, organizationId: string, program: string, country: string, region: string | null, number: string) =>
          attempt(client, `INSERT INTO public.registration_versions (registration_id, organization_id, program_code, jurisdiction_country, jurisdiction_region, number_display, number_normalized, normalization_rule_version, version_reason, effective_from) VALUES ($1, $2, $3, $4, $5, $6, $6, 'v1', 'INITIAL', now())`, [registrationId, organizationId, program, country, region, number]);
        const number = `R${digits(8)}`;
        assert.equal(await version(await registration(a, "IFTA"), a, "IFTA", "CA", "ON", number), undefined);
        assert.equal((await version(await registration(b, "IFTA"), b, "IFTA", "CA", "ON", number))?.code, "23505", "same number, same program and jurisdiction");
        // a full-name spelling cannot be stored at all: the program's jurisdiction rule (existing) rejects it before the key is reached; the canonical key backs it
        assert.ok(["23505", "23514"].includes((await version(await registration(b, "IFTA"), b, "IFTA", "CA", "ONTARIO", number))?.code ?? ""), "ONTARIO is refused");
        assert.equal(await version(await registration(b, "IFTA"), b, "IFTA", "CA", "BC", number), undefined, "another jurisdiction");
      });
    }, true);

    scenario("current plates: the same plate under an equivalent jurisdiction spelling is one plate; another jurisdiction is not", async () => {
      const [a, b] = await Promise.all([org("PlA"), org("PlB")]);
      await inRolledBack(async (client) => {
        const vehicle = async () => (await client.query<{ id: string }>(`INSERT INTO public.vehicles (vehicle_type_code, vin_normalized, vin_display) VALUES ('TRUCK_TRACTOR', $1, $1) RETURNING id`, [vinOf()])).rows[0].id;
        const [v1, v2] = [await vehicle(), await vehicle()];
        for (const [vehicleId, organizationId] of [[v1, a], [v2, b]]) {
          await client.query(`INSERT INTO public.organization_vehicle_relationships (organization_id, vehicle_id, relationship_type, effective_from) VALUES ($1, $2, 'OPERATES', '2024-01-01T00:00:00Z')`, [organizationId, vehicleId]);
        }
        const plate = `P${digits(6)}`;
        const insert = (vehicleId: string, organizationId: string, country: string, region: string) =>
          attempt(client, `INSERT INTO public.vehicle_registration_periods (vehicle_id, organization_id, plate_display, plate_normalized, jurisdiction_country, jurisdiction_region, effective_from) VALUES ($1, $2, $3, $3, $4, $5, '2024-01-01')`, [vehicleId, organizationId, plate, country, region]);
        assert.equal(await insert(v1, a, "CA", "ON"), undefined);
        for (const [country, region] of [["CA", "ON"], ["Canada", "Ontario"], ["can", " on. "]]) assert.equal((await insert(v2, b, country, region))?.code, "23505", `${country}/${region}`);
        assert.equal(await insert(v2, b, "CA", "QC"), undefined, "another jurisdiction");
      });
    }, true);

    scenario("nullable jurisdiction (company identifiers): omitting a required jurisdiction cannot create a second identity, and different registries are not collided", async () => {
      const [a, b] = await Promise.all([org("NlA"), org("NlB")]);
      const value = digits(9);
      await inRolledBack(async (client) => {
        const insert = (organizationId: string, type: string, namespace: string, country: string | null, region: string | null, v: string, status = "active") =>
          attempt(client, `INSERT INTO public.organization_identifiers (organization_id, identifier_type, namespace, jurisdiction_country, jurisdiction_region, value, normalized_value, status${status === "superseded" ? ", superseded_at" : ""}) VALUES ($1, $2, $3, $4, $5, $6, $6, $7${status === "superseded" ? ", now()" : ""})`, [organizationId, type, namespace, country, region, v, status]);
        // CRA business number: ONE national number space. The jurisdiction columns cannot be omitted or changed to dodge the key
        assert.equal(await insert(a, "business_number", "cra", "CA", null, value), undefined);
        for (const [country, region] of [["CA", null], [null, null], ["US", null], ["CA", "ON"], ["Canada", null]] as const) {
          const error = await insert(b, "business_number", "cra", country, region, value);
          assert.ok(["23505", "23514"].includes(error?.code ?? ""), `BN ${country}/${region}: ${error?.code}`);
        }
        // EIN likewise
        assert.equal(await insert(a, "employer_identification_number", "irs", "US", null, value), undefined);
        assert.ok(["23505", "23514"].includes((await insert(b, "employer_identification_number", "irs", null, null, value))?.code ?? ""));
        assert.equal((await insert(b, "employer_identification_number", "irs", "CA", null, `9${value}`))?.code, "23514", "an EIN is a US number");
        // incorporation: a registry-scoped number. Federal (no region) and a province are DIFFERENT registries; the country can never be omitted; a US entity needs its state
        assert.equal(await insert(a, "incorporation_number", "corporate_registry", "CA", null, value), undefined, "federal");
        assert.equal(await insert(b, "incorporation_number", "corporate_registry", "CA", "ON", value), undefined, "same number, Ontario registry: a different identity");
        assert.equal(await insert(b, "incorporation_number", "corporate_registry", "CA", "BC", value), undefined, "same number, British Columbia registry");
        assert.equal((await insert(b, "incorporation_number", "corporate_registry", "CA", "ON", value))?.code, "23505", "the same registry twice");
        assert.equal((await insert(b, "incorporation_number", "corporate_registry", null, null, `1${value}`))?.code, "23514", "country omitted");
        assert.equal((await insert(b, "incorporation_number", "corporate_registry", "US", null, `2${value}`))?.code, "23514", "a US incorporation needs its state");
        assert.equal(await insert(b, "incorporation_number", "corporate_registry", "US", "DE", `3${value}`), undefined);
        // extra-provincial registration needs both
        assert.equal((await insert(b, "extra_provincial_registration", "corporate_registry", "CA", null, `4${value}`))?.code, "23514");
        assert.equal(await insert(b, "extra_provincial_registration", "corporate_registry", "CA", "AB", `4${value}`), undefined);
        // a superseded (historical) row is never constrained by the scope rule, and an identifier type this service does not own is left alone
        assert.equal(await insert(b, "business_number", "cra", null, null, `5${value}`, "superseded"), undefined);
        assert.equal(await insert(b, "some_other_identifier", "other_registry", null, null, `6${value}`), undefined);
      });
    }, true);

    scenario("explicitly UNRESOLVED registration jurisdictions (migration 0034): kept for review; two unresolved records of one number collide; unresolved never silently merges with resolved", async () => {
      const [a, b, c] = await Promise.all([org("UnA"), org("UnB"), org("UnC")]);
      await inRolledBack(async (client) => {
        const registration = async (organizationId: string) => (await client.query<{ id: string }>(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'IFTA') RETURNING id`, [organizationId])).rows[0].id;
        const version = (registrationId: string, organizationId: string, country: string | null, region: string | null, number: string) =>
          attempt(client, `INSERT INTO public.registration_versions (registration_id, organization_id, program_code, jurisdiction_country, jurisdiction_region, number_display, number_normalized, normalization_rule_version, version_reason, effective_from) VALUES ($1, $2, 'IFTA', $3, $4, $5, $5, 'v1', 'INITIAL', now())`, [registrationId, organizationId, country, region, number]);
        const number = `U${digits(8)}`;
        assert.equal(await version(await registration(a), a, null, null, number), undefined, "an unresolved record is a legitimate pending state");
        assert.equal((await version(await registration(b), b, null, null, number))?.code, "23505", "two unresolved records of one number are one number");
        assert.equal(await version(await registration(c), c, "CA", "ON", number), undefined, "a resolved record is a different key: surfaced for review, not merged");
        assert.equal(await count2(client, number), 2);
      });
      async function count2(client: import("pg").PoolClient, number: string) {
        return Number((await client.query(`SELECT count(*) FROM public.registration_versions WHERE number_normalized = $1`, [number])).rows[0].count);
      }
    }, true);

    scenario("operating authorities carry the same canonical natural key (catalog) and keep their own check on the stored form", async () => {
      const found = await rows<{ indexname: string; indexdef: string }>(`SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'operating_authority_versions_current_canonical_number_uq'`);
      assert.equal(found.length, 1);
      assert.match(found[0].indexdef, /canonical_country_code/);
      assert.match(found[0].indexdef, /canonical_region_code/);
      assert.match(found[0].indexdef, /\(kind,/);
    }, true);
  });

  // ---- companies --------------------------------------------------------------------------------------------------

  describe("company creation: duplicate candidates are advisory; regulatory identifiers decide", () => {
    const payload = (name: string, over: Record<string, unknown> = {}) => ({
      companyName: name, companyType: "Owner Operator", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada", ...over,
    });

    scenario("a company with the same legal name is CREATED and reported as a candidate (only to registry readers); a name is never an identity", async () => {
      const name = `Dup Candidate ${run} ${n()} Transport Ltd`;
      await only("ORGANIZATION_CREATE", "COMPANY_PROFILE_MANAGE", "ORGANIZATION_REGISTRY_READ");
      const first = await K.dir.createCompanyDirectoryRecord(payload(name));
      assert.deepEqual(first.possibleDuplicates, []);
      const second = await K.dir.createCompanyDirectoryRecord(payload(name.toUpperCase().replace(/ LTD$/, " LTD.")));
      assert.notEqual(second.company.id, first.company.id, "two separate canonical companies: nothing was merged, linked or rejected");
      const candidates = second.possibleDuplicates.map((c) => [c.organizationId, c.reason]);
      assert.ok(candidates.some(([id, reason]) => id === first.company.id && reason === "SAME_LEGAL_NAME"), JSON.stringify(candidates));
      // a caller without registry read still creates the record but learns nothing about the other company
      await only("ORGANIZATION_CREATE", "COMPANY_PROFILE_MANAGE");
      const third = await K.dir.createCompanyDirectoryRecord(payload(name));
      assert.deepEqual(third.possibleDuplicates, []);
      assert.equal(await count(`SELECT count(*) FROM public.organizations WHERE normalized_legal_name = (SELECT normalized_legal_name FROM public.organizations WHERE id = $1)`, [first.company.id]), 3);
    });

    scenario("the same regulatory identifier decides: a second company is refused without disclosing the holder; simultaneous creates produce one holder", async () => {
      await only("ORGANIZATION_CREATE", "COMPANY_PROFILE_MANAGE");
      const ein = `${digits(2)}-${digits(7)}`;
      const holder = await K.dir.createCompanyDirectoryRecord(payload(`EIN Holder ${run} ${n()} Ltd`, { ein }));
      const error = await refused(K.dir.createCompanyDirectoryRecord(payload(`EIN Taker ${run} ${n()} Ltd`, { ein })));
      assert.match(error.constructor.name, /Collision|Conflict/);
      const response = K.response.canonicalFailure(error, "x");
      assert.equal(response.status, 409);
      const text = JSON.stringify(await response.json()) + error.message;
      assert.ok(!text.includes(holder.company.id) && !text.includes("EIN Holder"), "the holder is not disclosed to a caller without registry read");
      assert.equal(await count(`SELECT count(*) FROM public.organizations WHERE legal_name LIKE $1`, [`EIN Taker ${run}%`]), 0, "the refused creation left nothing behind");

      const raced = `${digits(2)}-${digits(7)}`;
      const results = await Promise.allSettled([1, 2, 3].map((i) => K.dir.createCompanyDirectoryRecord(payload(`EIN Race ${run} ${n()}-${i} Ltd`, { ein: raced }))).flat());
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) if (r.status === "rejected") assert.match((r.reason as Error).constructor.name, /Collision|Conflict/, String(r.reason));
      assert.equal(await count(`SELECT count(*) FROM public.organization_identifiers WHERE normalized_value = $1 AND status = 'active'`, [raced.replace("-", "")]), 1);
    });
  });

  // ---- people ------------------------------------------------------------------------------------------------------

  describe("people: one canonical person may serve several companies; uncertain identities are never merged", () => {
    scenario("a same-name-and-email contact in a second company is reported as a candidate (registry readers only); reuse is explicit and keeps separate histories", async () => {
      const [a, b] = await Promise.all([org("PeA"), org("PeB")]);
      await only("CONTACT_MANAGE", "PERSON_REGISTRY_READ", "ORGANIZATION_REGISTRY_READ");
      const email = `shared-${run.toLowerCase()}-${n()}@example.test`;
      const name = { givenName: "Casey", familyName: `Dupe${n()}` };
      const first = await K.contacts.createContact({ organizationId: a, name, channels: [{ type: "EMAIL", value: email, preferred: true }] });
      const second = await K.contacts.createContact({ organizationId: b, name, channels: [{ type: "EMAIL", value: email, preferred: true }] });
      assert.notEqual(second.contact.person.id, first.contact.person.id, "uncertain identities are NOT merged automatically");
      assert.ok(second.matches.some((m: any) => m.personId === first.contact.person.id && m.reasons.includes("NAME") && m.reasons.includes("EMAIL")));
      // explicit reuse: the existing person gets a second company relationship; both relationships keep their own history
      const linked = await K.contacts.addRelationship({ organizationId: b, personId: first.contact.person.id });
      assert.equal(linked.person.id, first.contact.person.id);
      assert.equal(await count(`SELECT count(*) FROM public.organization_person_relationships WHERE person_id = $1`, [first.contact.person.id]), 2);
      assert.equal(await count(`SELECT count(DISTINCT organization_id) FROM public.organization_person_relationships WHERE person_id = $1 AND record_status = 'active'`, [first.contact.person.id]), 2);
      // without registry read the candidate list is empty (nothing about another company's people is disclosed)
      await only("CONTACT_MANAGE");
      const blind = await K.contacts.createContact({ organizationId: a, name, channels: [{ type: "EMAIL", value: email }] });
      assert.deepEqual(blind.matches, []);
    });
  });

  // ---- evidence ------------------------------------------------------------------------------------------------------

  describe("evidence: identical bytes are not an identical legal record", () => {
    scenario("no uniqueness is keyed on a file hash; documents are owned per company and may be referenced more than once", async () => {
      const hashUnique = await rows(
        `SELECT i.indexrelid::regclass::text AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
          WHERE i.indisunique AND c.relname IN ('evidence_documents', 'evidence_payloads') AND a.attname IN ('sha256', 'declared_sha256', 'verified_sha256') AND NOT i.indisprimary`,
      );
      // evidence_payloads_source_file_uq (batch, source file) and evidence_documents_gcs_object_uq (object) are the ONLY identity keys; hashes are not
      for (const row of hashUnique) assert.ok(!/^[a-z_]*sha256[a-z_]*$/.test(row.name), `no hash-only unique key: ${row.name}`);
      const [a, b] = await Promise.all([org("EvA"), org("EvB")]);
      const actor = await only("DRIVER_MANAGE");
      const docA = await K.fixtures.seedPayloadBackedDocument(pools.admin, { organizationId: a, actorId: actor.actorId, documentType: "OTHER_EVIDENCE", status: "verified", stage: "stored" });
      const docB = await K.fixtures.seedPayloadBackedDocument(pools.admin, { organizationId: b, actorId: actor.actorId, documentType: "OTHER_EVIDENCE", status: "verified", stage: "stored" });
      const sha = (await rows<{ sha256: string }>(`SELECT sha256 FROM public.evidence_documents WHERE id = $1`, [docA]))[0].sha256;
      const twinned = await pools.admin.query(`UPDATE public.evidence_documents SET sha256 = $2 WHERE id = $1`, [docB, sha]).then(() => true, () => false);
      if (twinned) assert.equal(await count(`SELECT count(*) FROM public.evidence_documents WHERE sha256 = $1`, [sha]), 2, "identical hash, two independent company-owned documents");
      assert.notEqual(docA, docB);
      // ownership is enforced by the composite key (document, company): a verification cannot cite another company's document
      assert.equal((await rows(`SELECT 1 FROM public.evidence_documents WHERE id = $1 AND organization_id = $2`, [docA, b])).length, 0);
    });
  });

  // ---- before the migration ------------------------------------------------------------------------------------------

  describe("before migration 0038 is applied", () => {
    scenario("existing conflicts make the migration REFUSE (changing nothing), the preflight lists them, and it applies once they are resolved", async () => {
      await only("VEHICLE_MANAGE");
      // the application-level rules already hold without the indexes
      const [a, b] = await Promise.all([org("PreA"), org("PreB")]);
      const guarded = await K.oi.createVehicle(vehicleInput(vinOf()));
      await K.oi.establishOrganizationVehicle({ ...rel(a), vehicleId: guarded.vehicleId });
      assert.ok((await refused(K.oi.establishOrganizationVehicle({ ...rel(b), vehicleId: guarded.vehicleId }))) instanceof K.errors.VehicleIdentityConflictError);

      // two current operators, created the way an unguarded writer could before the indexes existed
      const vehicleId = randomUUID();
      await pools.admin.query(`INSERT INTO public.vehicles (id, vehicle_type_code, vin_normalized, vin_display) VALUES ($1, 'TRUCK_TRACTOR', $2, $2)`, [vehicleId, vinOf()]);
      for (const organizationId of [a, b]) {
        await pools.admin.query(`INSERT INTO public.organization_vehicle_relationships (organization_id, vehicle_id, relationship_type, effective_from) VALUES ($1, $2, 'OPERATES', '2024-01-01T00:00:00Z')`, [organizationId, vehicleId]);
      }
      // legacy company identifiers: one business number recorded twice, once with the jurisdiction OMITTED; plus an unresolved row with no collision
      const legacyBn = digits(9);
      const insertIdentifier = (organizationId: string, country: string | null, value: string) =>
        pools.admin.query(`INSERT INTO public.organization_identifiers (organization_id, identifier_type, namespace, jurisdiction_country, value, normalized_value) VALUES ($1, 'business_number', 'cra', $2, $3, $3) RETURNING id`, [organizationId, country, value]);
      await insertIdentifier(a, "CA", legacyBn);
      await insertIdentifier(b, null, legacyBn);
      const lonely = (await insertIdentifier(a, null, digits(9))).rows[0].id as string;
      const sql = readFileSync(path.join(process.cwd(), "database/migrations/0038_canonical_duplicate_prevention.sql"), "utf8");
      const error = (await pools.admin.query(sql).catch((e: PgError) => e)) as PgError;
      assert.match(error.message, /Migration 0038 cannot be applied: \d+ vehicle\(s\) have more than one current operator/);
      assert.equal((await rows(`SELECT to_regclass('public.organization_vehicle_open_operator_uq') AS t`))[0].t, null, "nothing was applied");

      const preflight = readFileSync(path.join(process.cwd(), "scripts/database/preflight-0038-duplicate-prevention.sql"), "utf8").split("\n").filter((line) => !line.startsWith("\\")).join("\n");
      const client = await pools.admin.connect();
      let results: Array<{ command: string; rows: any[] }>;
      try {
        results = (await client.query(preflight)) as never;
      } finally {
        await client.query("RESET default_transaction_read_only").catch(() => undefined);
        client.release();
      }
      const select = results.filter((r) => r.command === "SELECT");
      assert.equal(select.length, 9, "every refusal rule has a section, plus the two informational ones");
      assert.ok(select[1].rows.some((r) => r.vehicle_id === vehicleId && Number(r.open_operators) === 2), "the vehicle with two operators is listed");
      assert.ok(select[3].rows.some((r) => r.normalized_value === legacyBn && Number(r.rows) === 2), "the national number held twice (one with the jurisdiction omitted) is listed");
      assert.ok(select[7].rows.some((r) => r.identifier_id === lonely), "an unresolved identifier is listed for review, not rejected");

      await end(vehicleId, b); // resolved by an authorized review; the migration never does it
      const second = (await pools.admin.query(sql).catch((e: PgError) => e)) as PgError;
      assert.match(second.message, /national number\(s\) .* are held by more than one active company identifier/, "the next rule refuses on its own");
      assert.equal((await rows(`SELECT to_regclass('public.organization_identifiers_active_national_number_uq') AS t`))[0].t, null, "still nothing applied");
      await pools.admin.query(`UPDATE public.organization_identifiers SET status = 'superseded', superseded_at = now() WHERE organization_id = $1 AND normalized_value = $2 AND jurisdiction_country IS NULL`, [b, legacyBn]);
      await pools.admin.query(sql);
      has0038 = true;
      assert.equal(await count(`SELECT count(*) FROM public.organization_vehicle_relationships WHERE vehicle_id = $1`, [vehicleId]), 2, "history preserved");
      // the unresolved legacy identifier is kept exactly as it was (NOT VALID check), and correcting it by supersede is never blocked
      assert.equal(await count(`SELECT count(*) FROM public.organization_identifiers WHERE id = $1 AND jurisdiction_country IS NULL AND status = 'active'`, [lonely]), 1);
      await pools.admin.query(`UPDATE public.organization_identifiers SET status = 'superseded', superseded_at = now() WHERE id = $1`, [lonely]);
      assert.equal((await pools.admin.query(`INSERT INTO public.organization_identifiers (organization_id, identifier_type, namespace, value, normalized_value) VALUES ($1, 'business_number', 'cra', 'x1', 'x1')`, [a]).catch((e: PgError) => e) as PgError).code, "23514", "new unresolved rows are refused");
      assert.equal((await rows(`SELECT to_regclass('public.organization_vehicle_open_operator_uq') AS t`))[0].t, "organization_vehicle_open_operator_uq");
    }, "pre");
  });
});
