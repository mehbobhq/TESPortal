// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// POST /api/companies/[id]/vehicles through the REAL route, authorization kernel and runtime role: every refusal of a vehicle
// creation has its own response class (400 / 404 / 409), authorization stays 403, and a refused creation leaves nothing behind.
// Before this classification, every one of these cases was a generic 500 "Unable to create vehicle."

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    route: await import("@/app/api/companies/[id]/vehicles/route"),
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

describe("vehicle creation responses (real route, real kernel, runtime role)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().replace(/\D/g, "").slice(0, 6).padEnd(6, "1");
  let counter = 0;
  const vin = () => `1HG${run}${String(++counter).padStart(8, "0")}`;

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
  async function organization(label: string, status = "active"): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name, status, archived_at) VALUES ($1, $2, lower($2), $3, CASE WHEN $3 = 'archived' THEN now() END)`, [id, `VCE ${label} ${run} ${++counter}`, status]);
    return id;
  }
  async function post(organizationId: string, body: Record<string, unknown>) {
    const request = new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const response = await K.route.POST(request as never, { params: Promise.resolve({ id: organizationId }) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
  const base = (over: Record<string, unknown> = {}) => ({ vehicleTypeCode: "TRUCK_TRACTOR", vin: vin(), make: "Test", relationshipType: "OPERATES", unitNumber: `U-${++counter}`, effectiveFrom: "2024-01-01T00:00:00Z", ...over });
  const vehicles = async () => Number((await pools.admin.query(`SELECT count(*) FROM public.vehicles`)).rows[0].count);
  const links = async (org: string) => Number((await pools.admin.query(`SELECT count(*) FROM public.organization_vehicle_relationships WHERE organization_id=$1`, [org])).rows[0].count);

  it("creates a vehicle (201) and the same unit number is then a 409, not a 500", async () => {
    await signInWith("VEHICLE_MANAGE", "VEHICLE_READ");
    const org = await organization("unit");
    const first = await post(org, base({ unitNumber: "SAME-1" }));
    assert.equal(first.status, 201);
    const before = { v: await vehicles(), l: await links(org) };
    const clash = await post(org, base({ unitNumber: "SAME-1" }));
    assert.equal(clash.status, 409);
    assert.deepEqual(Object.keys(clash.body), ["error"]);
    assert.doesNotMatch(String(clash.body.error), /SAME-1|violates|constraint|organization_vehicle/i);
    assert.deepEqual({ v: await vehicles(), l: await links(org) }, before, "the refused creation left no vehicle or link behind");
  });

  it("the same VIN for the same company is a 409 (already a current vehicle), not a 500", async () => {
    await signInWith("VEHICLE_MANAGE", "VEHICLE_READ");
    const org = await organization("dupvin");
    const v = vin();
    assert.equal((await post(org, base({ vin: v }))).status, 201);
    const again = await post(org, base({ vin: v }));
    assert.equal(again.status, 409);
    assert.equal(await links(org), 1);
  });

  it("invalid input is a 400 and creates nothing", async () => {
    await signInWith("VEHICLE_MANAGE", "VEHICLE_READ");
    const org = await organization("invalid");
    const before = { v: await vehicles(), l: await links(org) };
    for (const [label, over] of [
      ["VIN with excluded letters", { vin: "1HGIOQ00000000000" }],
      ["VIN too short", { vin: "SHORT" }],
      ["unknown vehicle type", { vehicleTypeCode: "SPACESHIP" }],
      ["missing vehicle type", { vehicleTypeCode: undefined }],
      ["unknown relationship type", { relationshipType: "BOGUS" }],
    ] as const) {
      const r = await post(org, base(over as Record<string, unknown>));
      assert.equal(r.status, 400, label);
    }
    assert.deepEqual({ v: await vehicles(), l: await links(org) }, before);
  });

  it("an unknown company is a 404 and an inactive company is a 409; nothing is created", async () => {
    await signInWith("VEHICLE_MANAGE", "VEHICLE_READ");
    const before = await vehicles();
    assert.equal((await post(randomUUID(), base())).status, 404);
    const inactive = await organization("archived", "archived");
    assert.equal((await post(inactive, base())).status, 409);
    assert.equal(await vehicles(), before);
  });

  it("authorization still fails closed: no VEHICLE_MANAGE is 403 and signed-out is 403", async () => {
    const org = await organization("auth");
    await signInWith("VEHICLE_READ");
    const before = await vehicles();
    const denied = await post(org, base());
    assert.equal(denied.status, 403);
    K.db.setClerkUser(null);
    assert.equal((await post(org, base())).status, 403);
    assert.equal(await vehicles(), before);
  });

  it("classification uses explicit codes, never constructor.name", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/operational-identity/vehicle-create-failure.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(source, /constructor\.name/);
    assert.match(source, /"23505"/);
  });
});
