// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Driver identity disclosure. A licence is a global identity signal, but a company must learn nothing about ANOTHER company's driver
// from it: no name, no global person id, no licence or employment detail, no counts. Same-company behaviour is unchanged, linking a
// driver across companies is refused (no consent / identity-resolution workflow exists), and responses are uniform enough that
// they cannot be used to enumerate people. Real route handlers, real kernel, runtime role.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    oi: await import("@/lib/operational-identity/service"),
    detail: await import("@/lib/operational-identity/driver-reads"),
    check: await import("@/app/api/companies/[id]/drivers/check/route"),
    drivers: await import("@/app/api/companies/[id]/drivers/route"),
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

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("driver identity disclosure (minimum disclosure across companies)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().replace(/\D/g, "").slice(0, 6).padEnd(6, "7");
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
  }
  const MANAGE = ["DRIVER_MANAGE", "DRIVER_READ"];
  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `DID ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }
  const licenceNo = () => `ID${run}${String(n()).padStart(6, "0")}`;
  const lookupOf = (licenceNumber: string) => ({ jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber });
  async function driver(organizationId: string, licenceNumber: string, over: Record<string, unknown> = {}) {
    return K.oi.createDriver({
      organizationId, givenName: `Private${run}`, familyName: `Person${n()}`, email: `p.${run}.${n()}@example.test`, phone: `+1403555${String(1000 + (n() % 9000)).padStart(4, "0")}`,
      relationshipType: "EMPLOYEE", status: "ACTIVE", driverNumber: `DN${run}${n()}`, effectiveFrom: "2024-01-01",
      licence: { ...lookupOf(licenceNumber), licenceClass: "AZ", effectiveFrom: "2024-01-01" }, ...over,
    });
  }
  async function post<T extends (r: never, c: never) => Promise<Response>>(handler: T, organizationId: string, body: unknown) {
    const request = new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const response = await handler(request as never, { params: Promise.resolve({ id: organizationId }) } as never);
    return { status: response.status, text: await response.text() };
  }
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);

  it("same company: the full match (own driver's name and id) is still returned", async () => {
    await signInWith(...MANAGE);
    const a = await organization("same");
    const lic = licenceNo();
    const created = await driver(a, lic, { givenName: "Own", familyName: `Driver${run}` });
    const match = await K.oi.checkExistingDriver(a, lookupOf(lic));
    assert.deepEqual(match, { found: true, scope: "THIS_ORGANIZATION", personId: created.personId, givenName: "Own", familyName: `Driver${run}`, activeAtThisOrganization: true });
  });

  it("cross company: the match reveals nothing about the person (exact response, no uuid, no name, no counts)", async () => {
    await signInWith(...MANAGE);
    const a = await organization("owner");
    const b = await organization("searcher");
    const lic = licenceNo();
    const created = await driver(a, lic, { givenName: "Hidden", familyName: `Name${run}`, email: `hidden.${run}@example.test` });
    const match = await K.oi.checkExistingDriver(b, lookupOf(lic));
    assert.deepEqual(match, { found: true, scope: "OTHER_ORGANIZATION" });
    const viaRoute = await post(K.check.POST, b, lookupOf(lic));
    assert.equal(viaRoute.status, 200);
    assert.deepEqual(JSON.parse(viaRoute.text), { match: { found: true, scope: "OTHER_ORGANIZATION" } });
    for (const leak of [created.personId, "Hidden", `Name${run}`, `hidden.${run}`, lic]) assert.ok(!viaRoute.text.includes(leak), `response must not contain ${leak}`);
    assert.doesNotMatch(viaRoute.text, UUID);
  });

  it("enumeration resistance: different drivers at different companies are indistinguishable, and the response never carries a stable id", async () => {
    await signInWith(...MANAGE);
    const searcher = await organization("enum-searcher");
    const lics: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const owner = await organization(`enum-owner-${i}`);
      const lic = licenceNo();
      lics.push(lic);
      await driver(owner, lic);
    }
    const texts = new Set<string>();
    for (const lic of lics) texts.add((await post(K.check.POST, searcher, lookupOf(lic))).text);
    assert.equal(texts.size, 1, "every cross-company match yields the identical body");
    const unknown = (await post(K.check.POST, searcher, lookupOf(licenceNo()))).text;
    assert.deepEqual(JSON.parse(unknown), { match: { found: false } });
    assert.notEqual([...texts][0], unknown, "only the existence of the licence is learned, as creating would also reveal");
  });

  it("cross company: creating a driver with that licence is refused generically (no id, no linking offer) and creates nothing", async () => {
    await signInWith(...MANAGE);
    const a = await organization("create-owner");
    const b = await organization("create-searcher");
    const lic = licenceNo();
    await driver(a, lic);
    const people = await count(`SELECT count(*) FROM public.driver_profiles`);
    const rels = await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE organization_id = $1`, [b]);
    const attempt = await post(K.drivers.POST, b, { mode: "create", givenName: "Copy", familyName: "Cat", email: `copy.${run}@example.test`, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2024-02-01", licence: lookupOf(lic) });
    assert.equal(attempt.status, 409);
    assert.doesNotMatch(attempt.text, UUID);
    assert.doesNotMatch(attempt.text, /existing driver to the Organization|Add the existing/i);
    assert.equal(await count(`SELECT count(*) FROM public.driver_profiles`), people);
    assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE organization_id = $1`, [b]), rels);
  });

  it("cross company: linking another company's driver is refused and is indistinguishable from an unknown person", async () => {
    await signInWith(...MANAGE);
    const a = await organization("link-owner");
    const b = await organization("link-searcher");
    const created = await driver(a, licenceNo());
    const body = (personId: string) => ({ mode: "add-existing", personId, relationshipType: "CONTRACTOR", status: "ACTIVE", effectiveFrom: "2024-06-01" });
    const real = await post(K.drivers.POST, b, body(created.personId));
    const fake = await post(K.drivers.POST, b, body(randomUUID()));
    assert.equal(real.status, 404);
    assert.equal(real.text, fake.text, "a real person id and an invented one are answered identically");
    assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE organization_id = $1`, [b]), 0);
  });

  it("licence conflicts on an existing driver do not carry the holder's person id", async () => {
    await signInWith(...MANAGE);
    const a = await organization("lic-owner");
    const b = await organization("lic-other");
    const lic = licenceNo();
    await driver(a, lic);
    const mine = await driver(b, licenceNo());
    await assert.rejects(K.oi.recordDriverLicence({ organizationId: b, personId: mine.personId, licence: { ...lookupOf(lic), effectiveFrom: "2024-03-01" } }), (error: unknown) => {
      assert.ok(error instanceof Error && /DriverConflictError/.test(error.constructor.name));
      assert.equal((error as { existingPersonId?: string }).existingPersonId, undefined);
      assert.doesNotMatch(error.message, UUID);
      return true;
    });
  });

  it("the driver detail read exposes nothing about other companies", async () => {
    await signInWith(...MANAGE);
    const a = await organization("detail");
    const created = await driver(a, licenceNo());
    const detail = await K.detail.getOrganizationDriverDetail(a, created.personId);
    assert.equal("otherOrganizationCount" in detail, false);
  });

  it("unauthorized callers: no DRIVER_READ is denied, DRIVER_MANAGE alone cannot look up, signed-out is denied; nothing about the licence is revealed", async () => {
    await signInWith(...MANAGE);
    const a = await organization("auth-owner");
    const b = await organization("auth-searcher");
    const lic = licenceNo();
    await driver(a, lic);
    for (const caps of [[], ["DRIVER_MANAGE"], ["VEHICLE_READ", "CONTACT_MANAGE"]]) {
      await signInWith(...caps);
      const r = await post(K.check.POST, b, lookupOf(lic));
      assert.equal(r.status, 403, `capabilities [${caps}]`);
      assert.ok(!/found|scope/.test(r.text));
    }
    K.db.setClerkUser(null);
    assert.equal((await post(K.check.POST, b, lookupOf(lic))).status, 403);
  });

  it("same company: after a relationship ends the same person can be re-engaged (new relationship only, person untouched)", async () => {
    await signInWith(...MANAGE);
    const a = await organization("rehire");
    const lic = licenceNo();
    const created = await driver(a, lic);
    await K.oi.endDriverRelationship({ organizationId: a, personId: created.personId, effectiveTo: "2024-03-01" });
    const match = await K.oi.checkExistingDriver(a, lookupOf(lic));
    assert.equal(match.found && match.scope === "THIS_ORGANIZATION" && match.activeAtThisOrganization === false, true);
    const added = await K.oi.addExistingDriver({ organizationId: a, personId: created.personId, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2024-06-01" });
    assert.ok(added.relationshipId);
    assert.equal(await count(`SELECT count(*) FROM public.driver_profiles WHERE person_id = $1`, [created.personId]), 1);
  });
});
