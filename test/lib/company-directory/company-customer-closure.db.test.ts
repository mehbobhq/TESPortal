// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Company and Customer persistence closure (migration 0033, second pass): fleet provider service categories with current-state
// accuracy, the server-side mandatory Cargo rule, a truthful Assessment Date, the join / leave / rejoin lifecycle on one
// Customer, and the atomicity of a whole edit. Real authorization wrappers, the RUNTIME role (row-level security applies) and
// the real Master Register; fixtures and owner-level checks use the admin pool.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    dir: await import("@/lib/company-directory/service"),
    create: await import("@/lib/company-directory/create-company"),
    input: await import("@/lib/company-directory/creation-input"),
    sys: await import("@/lib/auth/tes-system-context"),
    cr: await import("@/lib/customer-relationship/service"),
    crDefs: await import("@/lib/customer-relationship/definitions"),
    onboarding: await import("@/lib/onboarding-foundation/service"),
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
  "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "CONTRACT_READ", "EVIDENCE_READ",
];
const without = (...removed: string[]) => ALL.filter((capability) => !removed.includes(capability));
/** A random, Luhn-valid 9-digit Canadian Business Number (unique per run, so other suites' fixed numbers never collide). */
function luhnBusinessNumber(): string {
  const body = Array.from({ length: 8 }, () => randomInt(0, 10));
  const sum = [...body, 0].reverse().reduce((total, digit, index) => {
    let value = digit;
    if (index % 2 === 1) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    return total + value;
  }, 0);
  return [...body, (10 - (sum % 10)) % 10].join("");
}
const digits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join("");

describe("Company and Customer persistence closure (fleet categories, cargo rule, lifecycle, atomic edit)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 8).toUpperCase();

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
    return actor.actorId;
  }

  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pools.admin.query(sql, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
  const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(sql, params)).n);

  const CARGO = JSON.stringify(["General Freight"]);
  async function createCustomer(label: string, overrides: Record<string, unknown> = {}) {
    const created = await K.dir.createCompanyDirectoryRecord({
      companyName: `Closure ${run} ${label}${digits(4)} Transport Ltd`,
      companyType: "Customer",
      opRegion: "Canada Only",
      regCorpState: "ON",
      regCorpCountry: "Canada",
      startDate: "2024-01-15",
      cargoTypes: CARGO,
      ...overrides,
    });
    return created.company.id;
  }
  const validationOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof K.input.CompanyCreationValidationError) return error.issues;
      throw error;
    }
    assert.fail("expected a CompanyCreationValidationError");
  };
  const periods = (organizationId: string) =>
    rows<{ category: string; name: string; open: boolean; status: string; provider_id: string }>(
      `SELECT p.service_category_code AS category, v.provider_name AS name, (p.effective_to IS NULL) AS open, p.record_status AS status, p.provider_id
         FROM public.company_fleet_provider_periods p JOIN public.company_fleet_providers v ON v.id = p.provider_id
        WHERE p.organization_id = $1 ORDER BY p.service_category_code, p.effective_from, p.created_at`,
      [organizationId],
    );

  // ===========================================================================================================
  it("FLEET PROVIDERS: ELD/HOS, GPS/Telematics and Fuel are distinct categories; one vendor serving several keeps ONE identity", async () => {
    await signInWith(...ALL);
    const id = await createCustomer("F1", { eldProvider: "Motive", gpsProvider: "motive", fuelProvider: "WEX Fleet" });

    const created = await periods(id);
    assert.deepEqual(created.map((p) => [p.category, p.name, p.open]), [["ELD_HOS", "Motive", true], ["FUEL_SERVICES", "WEX Fleet", true], ["GPS_TELEMATICS", "Motive", true]]);
    assert.equal(await count(`SELECT count(*) AS n FROM public.company_fleet_providers WHERE organization_id = $1`, [id]), 2, "Motive is one identity serving two categories");
    assert.equal(created[0].provider_id, created[2].provider_id);
    assert.equal(await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name ILIKE 'Motive%' OR legal_name ILIKE 'WEX%'`), 0, "a provider name never creates an Organization");

    const profile = await K.dir.getCompanyProfile(id);
    assert.deepEqual([profile?.eldProvider, profile?.gpsProvider, profile?.fuelProvider], ["Motive", "Motive", "WEX Fleet"]);

    // edit -> reload: clearing one category does not disturb the other category of the same vendor
    await K.dir.editCompany(id, { eldProvider: "" });
    const afterClear = await K.dir.getCompanyProfile(id);
    assert.deepEqual([afterClear?.eldProvider, afterClear?.gpsProvider], [null, "Motive"]);
    assert.equal(await count(`SELECT count(*) AS n FROM public.company_fleet_providers WHERE organization_id = $1`, [id]), 2, "ending a period keeps the identity");
  });

  it("FLEET PROVIDERS: FleetHunt -> Motive replacement shows only the current provider and keeps the effective-dated history", async () => {
    await signInWith(...ALL);
    const id = await createCustomer("F2", { gpsProvider: "FleetHunt" });
    assert.equal((await K.dir.getCompanyProfile(id))?.gpsProvider, "FleetHunt");

    const replaced = await K.dir.editCompany(id, { gpsProvider: "Motive" });
    assert.deepEqual(replaced.details?.fleetProviders.map((p) => [p.kind, p.result.created, p.result.ended]), [["GPS", 1, 1]]);

    const profile = await K.dir.getCompanyProfile(id);
    assert.equal(profile?.gpsProvider, "Motive", "the current provider, not the superseded one");
    assert.ok(!JSON.stringify(profile).includes("FleetHunt"), "the superseded provider is not on the profile");

    const history = await rows<{ name: string; from: string; to: string | null; status: string }>(
      `SELECT v.provider_name AS name, p.effective_from AS "from", p.effective_to AS "to", p.record_status AS status
         FROM public.company_fleet_provider_periods p JOIN public.company_fleet_providers v ON v.id = p.provider_id
        WHERE p.organization_id = $1 AND p.service_category_code = 'GPS_TELEMATICS' ORDER BY p.effective_from, p.created_at`,
      [id],
    );
    assert.deepEqual(history.map((h) => [h.name, h.to !== null, h.status]), [["FleetHunt", true, "active"], ["Motive", false, "active"]]);
    assert.equal(String(history[0].to), String(history[1].from), "the new provider starts exactly when the old one ended");

    // repeating the same name (any case) is not a change; Motive can then also take over ELD with no second identity
    const again = await K.dir.editCompany(id, { gpsProvider: "MOTIVE", eldProvider: "Motive" });
    assert.deepEqual(again.details?.fleetProviders.map((p) => [p.kind, p.result.changed]), [["ELD", true], ["GPS", false]]);
    assert.equal(await count(`SELECT count(*) AS n FROM public.company_fleet_providers WHERE organization_id = $1 AND provider_name_normalized = 'motive'`, [id]), 1);

    // a correction (FleetHunt was never used; the customer said Motive all along) keeps the wrong record, flagged
    const id2 = await createCustomer("F3", { fuelProvider: "Shell" });
    await K.dir.editCompany(id2, { factMode: "correct", fuelProvider: "Petro-Canada" });
    const corrected = await periods(id2);
    assert.deepEqual(corrected.map((p) => [p.name, p.status]), [["Shell", "corrected"], ["Petro-Canada", "active"]]);
    assert.equal((await K.dir.getCompanyProfile(id2))?.fuelProvider, "Petro-Canada");

    // provider names are business data: they never go into Master Register events
    assert.equal(await count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text ILIKE '%FleetHunt%' OR e::text ILIKE '%Petro-Canada%'`), 0);
  });

  it("FLEET PROVIDERS: tenant isolation, and the vehicle-level path is preserved but not implemented", async () => {
    await signInWith(...ALL);
    const a = await createCustomer("F4", { gpsProvider: "SharedName" });
    const b = await createCustomer("F5", { gpsProvider: "SharedName" });
    const identities = await rows<{ organization_id: string; id: string }>(`SELECT organization_id, id FROM public.company_fleet_providers WHERE organization_id = ANY($1::uuid[])`, [[a, b]]);
    assert.equal(identities.length, 2, "each company has its own identity row for the same name");
    assert.notEqual(identities[0].id, identities[1].id);

    await K.dir.editCompany(b, { gpsProvider: "Changed" });
    assert.equal((await K.dir.getCompanyProfile(a))?.gpsProvider, "SharedName", "company A is untouched");
    // a period cannot point at another company's provider
    await assert.rejects(
      pools.admin.query(`INSERT INTO public.company_fleet_provider_periods (organization_id, provider_id, service_category_code, effective_from) VALUES ($1, $2, 'ELD_HOS', now())`, [a, identities.find((i) => i.organization_id === b)!.id]),
      /company_fleet_provider_periods_provider_fk/,
    );
    // today every assignment is company-wide; a per-vehicle assignment is a future additive extension, not silently accepted
    await assert.rejects(
      pools.admin.query(`INSERT INTO public.company_fleet_provider_periods (organization_id, provider_id, service_category_code, assignment_scope, effective_from)
                          SELECT organization_id, provider_id, 'ELD_HOS', 'VEHICLE', now() FROM public.company_fleet_provider_periods WHERE organization_id = $1 LIMIT 1`, [a]),
      /company_fleet_provider_periods_scope_valid/,
    );
  });

  it("FLEET PROVIDERS: the database refuses overlapping periods (closed or current) for the same company, category and scope", async () => {
    await signInWith(...ALL);
    const id = await createCustomer("O1", { gpsProvider: "FleetHunt" });
    await K.dir.editCompany(id, { gpsProvider: "Motive" }); // clean hand-over: FleetHunt [t0,t1) then Motive [t1,)
    await K.dir.editCompany(id, { gpsProvider: "Samsara" }); // Motive [t1,t2) then Samsara [t2,)
    const gps = await rows<{ provider_id: string; from: string; to: string | null; name: string }>(
      `SELECT p.provider_id, p.effective_from::text AS "from", p.effective_to::text AS "to", v.provider_name AS name
         FROM public.company_fleet_provider_periods p JOIN public.company_fleet_providers v ON v.id = p.provider_id
        WHERE p.organization_id = $1 AND p.service_category_code = 'GPS_TELEMATICS' ORDER BY p.effective_from`,
      [id],
    );
    assert.deepEqual(gps.map((g) => g.name), ["FleetHunt", "Motive", "Samsara"]);
    assert.equal(gps[0].to, gps[1].from, "the hand-over is exact");
    assert.equal(gps[2].to, null);

    const insert = (provider: string, category: string, from: string, to: string | null, org = id, client: { query: (sql: string, params: unknown[]) => Promise<unknown> } = pools.admin) =>
      client.query(
        `INSERT INTO public.company_fleet_provider_periods (organization_id, provider_id, service_category_code, effective_from, effective_to) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
        [org, provider, category, from, to],
      );
    const overlap = /company_fleet_provider_periods_no_overlap/;
    const refused = /company_fleet_provider_periods_(no_overlap|current_uq)/; // an open-ended duplicate is caught first by the one-current index
    // direct writes (owner): inside a closed period, straddling a boundary, covering everything, and inside the open-ended current one
    await assert.rejects(insert(gps[0].provider_id, "GPS_TELEMATICS", gps[0].from, gps[0].to), overlap, "an exact duplicate of a closed period");
    const midpoint = await one<{ t: string }>(`SELECT ($1::timestamptz + ($2::timestamptz - $1::timestamptz) / 2)::text AS t`, [gps[0].from, gps[0].to]);
    await assert.rejects(insert(gps[0].provider_id, "GPS_TELEMATICS", midpoint.t, gps[1].to), overlap, "straddling a hand-over");
    await assert.rejects(insert(gps[1].provider_id, "GPS_TELEMATICS", "1999-01-01T00:00:00Z", null), refused, "an open-ended period covering history");
    await assert.rejects(insert(gps[1].provider_id, "GPS_TELEMATICS", "2999-01-01T00:00:00Z", null), refused, "an open-ended period inside the current open-ended one");
    await assert.rejects(insert(gps[1].provider_id, "GPS_TELEMATICS", "1999-01-01T00:00:00Z", "1999-06-01T00:00:00Z").then(() => insert(gps[1].provider_id, "GPS_TELEMATICS", "1999-03-01T00:00:00Z", "1999-09-01T00:00:00Z")), overlap, "two closed periods that overlap each other");

    // the same refusal through the RUNTIME role (which holds INSERT on effective_to), so it is not only an owner-level rule
    await assert.rejects(
      K.sys.withAuthorizedSystem("COMPANY_PROFILE_MANAGE", async (client) => {
        await insert(gps[0].provider_id, "GPS_TELEMATICS", gps[0].from, gps[0].to, id, client);
      }),
      overlap,
    );

    // what must stay legal: a clean hand-over, another category by the same vendor, another company, a voided or corrected row
    const handoverAt = await one<{ t: string }>(`SELECT (now() + interval '10 years')::text AS t`);
    await K.dir.editCompany(id, { eldProvider: "Samsara" }); // same vendor identity, different category, concurrent in time
    assert.equal((await K.dir.getCompanyProfile(id))?.eldProvider, "Samsara");
    assert.equal(await count(`SELECT count(DISTINCT service_category_code)::int AS n FROM public.company_fleet_provider_periods WHERE organization_id = $1 AND provider_id = $2`, [id, gps[2].provider_id]), 2, "one vendor, two categories, overlapping in time");
    const other = await createCustomer("O2", { gpsProvider: "FleetHunt" });
    assert.equal((await K.dir.getCompanyProfile(other))?.gpsProvider, "FleetHunt", "another company's identical window never conflicts");
    await K.dir.editCompany(id, { factMode: "correct", gpsProvider: "Samsara Networks" }); // marks the wrong row corrected, then inserts the same window
    const corrected = await rows<{ status: string; name: string; same: boolean }>(
      `SELECT old.record_status AS status, v.provider_name AS name, (old.effective_from = new.effective_from AND old.effective_to IS NOT DISTINCT FROM new.effective_to) AS same
         FROM public.company_fleet_provider_periods old JOIN public.company_fleet_provider_periods new ON new.id = old.superseded_by_period_id JOIN public.company_fleet_providers v ON v.id = old.provider_id
        WHERE old.organization_id = $1 AND old.service_category_code = 'GPS_TELEMATICS'`,
      [id],
    );
    assert.deepEqual(corrected.map((c) => [c.status, c.name, c.same]), [["corrected", "Samsara", true]], "a correction reuses the exact window of the row it replaces");
    await K.dir.editCompany(id, { factMode: "correct", gpsProvider: "" }); // void
    assert.equal((await K.dir.getCompanyProfile(id))?.gpsProvider, null);
    await K.dir.editCompany(id, { gpsProvider: "Geotab" }); // a fresh period after a void
    assert.equal((await K.dir.getCompanyProfile(id))?.gpsProvider, "Geotab");
    void handoverAt;

    // history is preserved: nothing was removed or rewritten by any of the above
    const statuses = await rows<{ status: string }>(`SELECT record_status AS status FROM public.company_fleet_provider_periods WHERE organization_id = $1 AND service_category_code = 'GPS_TELEMATICS' ORDER BY effective_from, created_at`, [id]);
    assert.ok(statuses.length >= 5, "FleetHunt, Motive, the corrected and replacement Samsara rows, the voided and the Geotab rows are all kept");
    assert.ok(statuses.some((r) => r.status === "corrected") && statuses.some((r) => r.status === "voided"));
  });

  // ===========================================================================================================
  it("CARGO RULE: a Customer needs at least one cargo category at the server, on create and on edit; other company types are unaffected", async () => {
    await signInWith(...ALL);
    const before = await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Closure ${run} C%`]);
    for (const cargoTypes of [undefined, "", "[]", JSON.stringify([])]) {
      const payload: Record<string, unknown> = { companyName: `Closure ${run} C${digits(4)} Transport Ltd`, companyType: "Customer", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada", startDate: "2024-01-15" };
      if (cargoTypes !== undefined) payload.cargoTypes = cargoTypes;
      const issues = await validationOf(K.dir.createCompanyDirectoryRecord(payload));
      assert.deepEqual(issues.map((i) => i.field), ["cargoTypes"], `cargo ${JSON.stringify(cargoTypes)} is refused`);
      assert.match(issues[0].message, /mandatory for a Customer/);
    }
    assert.equal(await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Closure ${run} C%`]), before, "a refused create leaves nothing behind");

    const id = await createCustomer("C2");
    const issues = await validationOf(K.dir.editCompany(id, { cargoTypes: "[]" }));
    assert.deepEqual(issues.map((i) => i.field), ["cargoTypes"]);
    assert.equal((await K.dir.getCompanyProfile(id))?.cargoTypes.length, 1, "the existing cargo is untouched");

    // an edit that does not mention cargo never trips the rule (e.g. a Customer recorded before the rule existed)
    await pools.admin.query(`UPDATE public.company_cargo_category_periods SET effective_to = now() WHERE organization_id = $1 AND effective_to IS NULL`, [id]);
    assert.deepEqual((await K.dir.getCompanyProfile(id))?.cargoTypes, []);
    const edited = await K.dir.editCompany(id, { dba: "Still Editable" });
    assert.equal(edited.company.dba, "Still Editable");

    // other classifications do not carry cargo
    const broker = await K.dir.createCompanyDirectoryRecord({ companyName: `Closure ${run} C${digits(4)} Brokerage`, companyType: "Insurance Broker", opRegion: "Canada Only" });
    assert.ok(broker.company.id);
  });

  // ===========================================================================================================
  it("ASSESSMENT DATE: no documentation assessment exists, so every Customer is 'Not yet assessed'; a readiness snapshot is never relabelled", async () => {
    await signInWith(...ALL, "EVIDENCE_MANAGE");
    const id = await createCustomer("A1");
    assert.deepEqual((await K.dir.getCompanyProfile(id))?.assessment, { state: "not_yet_assessed" });
    const engagementId = (await one<{ id: string }>(`SELECT e.id FROM public.customer_engagements e JOIN public.customers c ON c.id = e.customer_id WHERE c.organization_id = $1`, [id])).id;
    await K.onboarding.snapshotReadiness({ organizationId: id, engagementId, readinessStatus: "ready_for_contract", completedCount: 3, totalCount: 3, blockers: [] });
    assert.equal(await count(`SELECT count(*) AS n FROM public.onboarding_readiness_snapshots WHERE organization_id = $1`, [id]), 1);
    assert.deepEqual((await K.dir.getCompanyProfile(id))?.assessment, { state: "not_yet_assessed" });
    assert.ok(!("assessmentDate" in ((await K.dir.getCompanyProfile(id)) ?? {})), "there is no assessment date to show");
  });

  // ===========================================================================================================
  it("LIFECYCLE: join -> leave -> rejoin is one Customer with one engagement per stay, history kept, and the profile shows the current stay", async () => {
    await signInWith(...ALL);
    const id = await createCustomer("L1");
    const customerOf = () => rows<{ id: string }>(`SELECT id FROM public.customers WHERE organization_id = $1`, [id]);
    const [{ id: customerId }] = await customerOf();

    // join: the profile shows the first start; the customer is in ONBOARDING
    let profile = await K.dir.getCompanyProfile(id);
    assert.deepEqual([profile?.startDate, profile?.endDate, profile?.serviceStage], ["2024-01-15", null, "ONBOARDING"]);
    assert.equal(profile?.engagements.length, 1);
    const first = (await one<{ id: string }>(`SELECT id FROM public.customer_engagements WHERE customer_id = $1`, [customerId])).id;

    // rejoining while a stay is open is refused
    await assert.rejects(K.cr.establishCustomerRelationship({ organizationId: id, engagementType: "RECURRING", stage: "ONBOARDING", startedAt: "2024-02-01T00:00:00Z" }), /already has an open Engagement/);

    // leave: the end date comes only from the end-service workflow (with a structural reason)
    await K.cr.endEngagement({ engagementId: first, endedAt: "2024-06-01T00:00:00Z", endReason: K.crDefs.ENGAGEMENT_END_REASONS[0] });
    profile = await K.dir.getCompanyProfile(id);
    assert.deepEqual([profile?.startDate, profile?.endDate, profile?.serviceStage], ["2024-01-15", "2024-06-01", "ENDED"], "a customer who left shows when they left");

    // a rejoin cannot start before the previous stay ended
    await assert.rejects(K.cr.establishCustomerRelationship({ organizationId: id, engagementType: "RECURRING", stage: "ONBOARDING", startedAt: "2024-05-01T00:00:00Z" }), /cannot start before the previous Engagement ended/);

    // rejoin: the SAME company and the SAME customer, a new engagement, nothing overwritten
    const orgsBefore = await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Closure ${run} L1%`]);
    const rejoined = await K.cr.establishCustomerRelationship({ organizationId: id, engagementType: "RECURRING", stage: "ONBOARDING", startedAt: "2024-09-01T00:00:00Z" });
    assert.equal(rejoined.createdCustomer, false);
    assert.equal(await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Closure ${run} L1%`]), orgsBefore, "no duplicate company");
    assert.equal(await count(`SELECT count(*) AS n FROM public.customers WHERE organization_id = $1`, [id]), 1, "customer uniqueness holds");
    assert.equal(await count(`SELECT count(*) AS n FROM public.customer_engagements WHERE customer_id = $1`, [customerId]), 2);

    profile = await K.dir.getCompanyProfile(id);
    assert.deepEqual([profile?.startDate, profile?.endDate, profile?.serviceStage], ["2024-09-01", null, "ONBOARDING"], "the profile shows the CURRENT stay");
    assert.deepEqual(profile?.engagements.map((e) => [e.startedAt, e.endedAt, e.current]), [["2024-01-15", "2024-06-01", false], ["2024-09-01", null, true]], "both stays are kept");
    const firstRow = await one<{ ended_at: string | null; end_reason_code: string | null }>(`SELECT ended_at, end_reason_code FROM public.customer_engagements WHERE id = $1`, [first]);
    assert.ok(firstRow.ended_at && firstRow.end_reason_code, "the first stay's end and reason were not overwritten");

    // a rejoin is not a service decision: no contract, no scope, no signed authority was created or used
    assert.equal(await count(`SELECT count(*) AS n FROM public.customer_contracts WHERE organization_id = $1`, [id]), 0);
    assert.deepEqual((await K.dir.getCompanyProfile(id))?.serviceType, { state: "not_contracted" });

    // edit -> reload on the rejoined customer still works and does not touch the stays
    await K.dir.editCompany(id, { website: "https://rejoin.example.com", gpsProvider: "Motive" });
    profile = await K.dir.getCompanyProfile(id);
    assert.deepEqual([profile?.website, profile?.gpsProvider, profile?.startDate], ["https://rejoin.example.com", "Motive", "2024-09-01"]);
    assert.equal(profile?.engagements.length, 2);

    // the start date itself stays non-editable (no verified-correction ledger exists)
    const issues = await validationOf(K.dir.editCompany(id, { startDate: "2024-09-02" }));
    assert.equal(issues[0].field, "startDate");
  });

  // ===========================================================================================================
  it("ATOMIC EDIT: identity and details commit together or not at all", async () => {
    await signInWith(...ALL);
    const id = await createCustomer("T1", { dba: "Original Trade" });
    const original = await K.dir.getCompanyEditRecord(id);
    const eventCount = () => count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%' || $1 || '%'`, [id]);
    const snapshot = async () => ({
      name: (await K.dir.getCompanyEditRecord(id)).companyName,
      dba: (await K.dir.getCompanyEditRecord(id)).dba,
      events: await eventCount(),
      billing: await count(`SELECT count(*) AS n FROM public.customer_billing_preference_periods WHERE organization_id = $1`, [id]),
    });
    const baseline = await snapshot();

    // 1. the actor may change the identity but not the billing preference: the whole edit is refused and the name is NOT changed
    await signInWith(...without("CUSTOMER_RELATIONSHIP_MANAGE"));
    await assert.rejects(
      K.dir.editCompany(id, { companyName: `${original.companyName} Renamed`, dba: "Changed Trade", payMethod: "Cheque" }),
      (error: unknown) => error instanceof K.create.CompanyCreationCapabilityError && error.missing.includes("CUSTOMER_RELATIONSHIP_MANAGE"),
    );
    assert.deepEqual(await snapshot(), baseline, "no partial identity change, no billing row, no Master Register event");

    // 2. an identifier collision after earlier steps: the earlier name change rolls back with it
    await signInWith(...ALL);
    const taken = luhnBusinessNumber();
    const other = await createCustomer("T2", { businessNo: taken });
    assert.ok(other);
    await assert.rejects(K.dir.editCompany(id, { companyName: `${original.companyName} Collides`, businessNo: taken, gpsProvider: "Motive" }));
    assert.deepEqual(await snapshot(), baseline, "the name, provider and events are exactly as before the failed edit");
    assert.equal(await count(`SELECT count(*) AS n FROM public.company_fleet_provider_periods WHERE organization_id = $1`, [id]), 0);

    // 3. the same edit without the collision commits as one unit
    const done = await K.dir.editCompany(id, { companyName: `${original.companyName} Renamed`, dba: "Changed Trade", gpsProvider: "Motive", payMethod: "Cheque" });
    assert.equal(done.company.companyName, `${original.companyName} Renamed`);
    assert.equal(done.details?.billingPreference?.created, 1);
    const profile = await K.dir.getCompanyProfile(id);
    assert.deepEqual([profile?.dba, profile?.gpsProvider, profile?.payMethod], ["Changed Trade", "Motive", "Cheque"]);
  });
});
