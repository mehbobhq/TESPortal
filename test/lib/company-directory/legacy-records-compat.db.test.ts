// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Release compatibility for records that exist BEFORE the Company/Customer profile facts (migration 0033): records written by the
// original form (identity plus a customer relationship, no website, cargo, provider or payment preference). They must stay
// readable, must never be merged, overwritten or deleted - including a duplicate-looking pair - and nothing must write profile facts
// for them implicitly. Real authorization wrappers, the RUNTIME role and the real Master Register.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    dir: await import("@/lib/company-directory/service"),
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

const ALL = [
  "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CONTACT_MANAGE", "PERSON_REGISTRY_READ",
  "COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ", "CUSTOMER_ESTABLISH",
  "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "CONTRACT_READ",
];

describe("Existing company and customer records survive the profile-facts release (migration 0033)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 8).toUpperCase();
  const created: { organizations: string[] } = { organizations: [] };

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    for (const fx of fixtures) await fx.cleanup();
    await K.db.closePools();
  });

  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pools.admin.query(sql, params)).rows as T[];
  const count = async (sql: string, params: unknown[] = []) => Number((await rows<{ n: string }>(sql, params))[0].n);

  async function signInWith(...capabilities: string[]) {
    const fx = new K.db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
  }

  /** A record exactly as the original form saved it: an organization, a customer and an open ONBOARDING engagement. Nothing else. */
  async function legacyCustomer(name: string) {
    const organizationId = randomUUID();
    const customerId = randomUUID();
    const engagementId = randomUUID();
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO public.organizations (id, legal_name, display_name, normalized_legal_name, country_code, region_code) VALUES ($1, $2, $2, lower($2), 'CA', 'ON')`, [organizationId, name]);
      await client.query(`INSERT INTO public.customers (id, organization_id) VALUES ($1, $2)`, [customerId, organizationId]);
      await client.query(`INSERT INTO public.customer_engagements (id, customer_id, engagement_type, started_at) VALUES ($1, $2, 'RECURRING', '2024-03-01T00:00:00Z')`, [engagementId, customerId]);
      await client.query(`INSERT INTO public.customer_engagement_stages (id, engagement_id, stage_code, change_reason, effective_from) VALUES (gen_random_uuid(), $1, 'ONBOARDING', 'INITIAL', '2024-03-01T00:00:00Z')`, [engagementId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    created.organizations.push(organizationId);
    return { organizationId, customerId, engagementId };
  }

  const factRows = (organizationId: string) =>
    count(
      `SELECT (SELECT count(*) FROM public.company_cargo_category_periods WHERE organization_id = $1)
            + (SELECT count(*) FROM public.company_fleet_providers WHERE organization_id = $1)
            + (SELECT count(*) FROM public.company_fleet_provider_periods WHERE organization_id = $1)
            + (SELECT count(*) FROM public.customer_billing_preference_periods WHERE organization_id = $1) AS n`,
      [organizationId],
    );
  const identityRows = (organizationIds: string[]) =>
    rows(`SELECT o.id, o.legal_name, o.status, c.id AS customer_id, e.id AS engagement_id, e.started_at::text, e.ended_at::text
            FROM public.organizations o JOIN public.customers c ON c.organization_id = o.id JOIN public.customer_engagements e ON e.customer_id = c.id
           WHERE o.id = ANY($1::uuid[]) ORDER BY o.id`, [organizationIds]);

  it("original records stay readable: every profile section reads, with no fact invented, and a read writes nothing", async () => {
    await signInWith(...ALL);
    const a = await legacyCustomer(`Legacy ${run} Haulage Inc`);
    const before = await identityRows([a.organizationId]);
    const profile = await K.dir.getCompanyProfile(a.organizationId);
    assert.ok(profile, "the profile opens");
    assert.equal(profile.name, `Legacy ${run} Haulage Inc`);
    assert.equal(profile.kind, "Customer");
    assert.deepEqual([profile.website, profile.eldProvider, profile.gpsProvider, profile.fuelProvider, profile.payMethod], [null, null, null, null, null]);
    assert.deepEqual(profile.cargoTypes, []);
    assert.deepEqual(profile.serviceType, { state: "not_contracted" });
    assert.deepEqual(profile.assessment, { state: "not_yet_assessed" });
    assert.equal(profile.startDate, "2024-03-01");
    assert.equal(profile.serviceStage, "ONBOARDING");
    assert.deepEqual(Object.values(profile.sections), Object.values(profile.sections).map(() => "ok"), "no section is withheld or broken");
    const edit = await K.dir.getCompanyEditRecord(a.organizationId);
    assert.equal(edit.companyName, `Legacy ${run} Haulage Inc`);
    assert.equal(await factRows(a.organizationId), 0, "reading creates no profile fact");
    assert.deepEqual(await identityRows([a.organizationId]), before, "reading changes no existing row");
  });

  it("a duplicate-looking pair is never merged, overwritten or deleted - by reads, listing, an edit of one, or creating a similar new company", async () => {
    await signInWith(...ALL);
    const first = await legacyCustomer(`Legacy ${run} Twin Inc`);
    const second = await legacyCustomer(`Legacy ${run} Twin Inc.`);
    const ids = [first.organizationId, second.organizationId];
    const before = await identityRows(ids);
    assert.equal(before.length, 2);

    const listed = (await K.dir.listCustomerDirectory()).filter((row) => ids.includes(row.organizationId));
    assert.equal(listed.length, 2, "both customers are listed, separately");
    assert.notEqual(listed[0].id, listed[1].id);

    // editing one touches only that one
    await K.dir.editCompany(first.organizationId, { website: "https://twin-one.example.com", cargoTypes: JSON.stringify(["General Freight"]) });
    assert.equal((await K.dir.getCompanyProfile(first.organizationId))?.website, "https://twin-one.example.com");
    assert.equal((await K.dir.getCompanyProfile(second.organizationId))?.website, null);
    assert.equal(await factRows(second.organizationId), 0, "the look-alike received no fact");

    // creating a new, similarly named company makes a NEW record; the existing ones are untouched
    const similar = await K.dir.createCompanyDirectoryRecord({
      companyName: `Legacy ${run} Twin Inc..`, companyType: "Customer", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada",
      startDate: "2024-05-01", cargoTypes: JSON.stringify(["Bulk & Other"]),
    });
    created.organizations.push(similar.company.id);
    assert.ok(!ids.includes(similar.company.id));

    const after = await identityRows(ids);
    assert.deepEqual(after, before, "neither original organization, customer or engagement changed");
    assert.equal(await count(`SELECT count(*) AS n FROM public.organizations WHERE id = ANY($1::uuid[]) AND status = 'active'`, [ids]), 2);
    assert.equal(await count(`SELECT count(*) AS n FROM public.customers WHERE organization_id = ANY($1::uuid[])`, [ids]), 2, "no customer was merged or removed");
  });

  it("a non-customer company (a supplier recorded before the release) stays readable and editable", async () => {
    await signInWith(...ALL);
    const organizationId = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, display_name, normalized_legal_name, country_code, region_code) VALUES ($1, $2, $2, lower($2), 'CA', 'AB')`, [organizationId, `Legacy ${run} Supplier Ltd`]);
    created.organizations.push(organizationId);
    const profile = await K.dir.getCompanyProfile(organizationId);
    assert.ok(profile);
    assert.notEqual(profile.kind, "Customer");
    assert.equal(profile.serviceType, null);
    await K.dir.editCompany(organizationId, { website: "legacy-supplier.example.com" });
    assert.equal((await K.dir.getCompanyProfile(organizationId))?.website, "legacy-supplier.example.com");
    assert.equal(await count(`SELECT count(*) AS n FROM public.customers WHERE organization_id = $1`, [organizationId]), 0, "no customer relationship was created implicitly");
  });
});
