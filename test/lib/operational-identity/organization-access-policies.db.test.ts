// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Regression tests for migration 0027 (Organization access policies). They drive the REAL operational identity and insurance
// services through the REAL authorization wrappers and Clerk-to-actor resolution, on pooled connections that log in as the
// RUNTIME role (policy-bound by the row-level security of migration 0024), with the real Master Register. Fixtures and
// owner-level checks use the admin (table owner) pool, which bypasses RLS.
//
// Migration 0027 widens ONLY the USING (visibility) expression of organizations_system and
// organization_person_relationships_system. These tests prove the operations that need that visibility work under exactly
// their own capability, and that nothing was widened for writes, for other capabilities or for CUSTOMER scope.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    sys: await import("@/lib/auth/tes-system-context"),
    cust: await import("@/lib/auth/tes-customer-context"),
    oi: await import("@/lib/operational-identity/service"),
    ins: await import("@/lib/insurance/service"),
    insErrors: await import("@/lib/insurance/errors"),
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

// The USING / WITH CHECK capability sets of the two policies after migration 0027.
const ORGANIZATIONS_USING = [
  "CREDENTIAL_MANAGE", "CREDENTIAL_READ", "CUSTOMER_ESTABLISH", "DRIVER_MANAGE", "DRIVER_READ", "IDENTITY_RESOLUTION_MANAGE", "INSURANCE_MANAGE",
  "INSURANCE_READ", "ORGANIZATION_ARCHIVE", "ORGANIZATION_CREATE", "ORGANIZATION_REGISTRY_READ", "ORGANIZATION_UPDATE", "VEHICLE_MANAGE", "VEHICLE_READ",
];
const ORGANIZATIONS_CHECK = ["CREDENTIAL_MANAGE", "CUSTOMER_ESTABLISH", "INSURANCE_MANAGE", "ORGANIZATION_ARCHIVE", "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE"];
const RELATIONSHIPS_USING = ["CONTACT_MANAGE", "INSURANCE_MANAGE", "PERSON_REGISTRY_READ"];
const RELATIONSHIPS_CHECK = ["CONTACT_MANAGE"];

// The capabilities whose operations must see an Organization (the six added by 0027 plus the unchanged ones that matter here).
const SEES_ORGANIZATIONS = ["VEHICLE_READ", "VEHICLE_MANAGE", "DRIVER_READ", "DRIVER_MANAGE", "IDENTITY_RESOLUTION_MANAGE", "INSURANCE_MANAGE"] as const;
const BLIND_TO_ORGANIZATIONS = ["IDENTITY_RESOLUTION_READ", "MASTER_REGISTER_READ", "TAX_REGISTRATION_READ"] as const;

const AL = () => ({ coverageType: "AUTO_LIABILITY", limitAmount: "1000000", currency: "CAD", limitBasis: "COMBINED_SINGLE_LIMIT" });

type PgError = Error & { code?: string };
type Attempt = { rowCount: number | null; code?: string; message?: string };
class RollBack extends Error {}

describe("Organization access policies of migration 0027 (real authorization, real transactions)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
  let scopeOrganizations: string[] = [];
  let persons: string[] = [];
  let vehicles: string[] = [];

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  const run = randomUUID().slice(0, 8).toUpperCase();
  let counter = 0;
  const n = () => ++counter;

  /** Removes everything a scenario created. The no-delete triggers are lifted only here, by the table owner, in a transaction. */
  async function purge() {
    const triggers: Array<[string, string]> = [
      ["insurance_policies", "insurance_policies_no_delete"],
      ["insurance_policy_terms", "insurance_policy_terms_no_delete"],
      ["insurance_endorsements", "insurance_endorsements_no_delete"],
      ["insurance_coverages", "insurance_coverages_no_delete"],
      ["insurance_broker_periods", "insurance_broker_periods_no_delete"],
      ["vehicles", "vehicles_no_delete"],
      ["organization_vehicle_relationships", "organization_vehicle_relationships_no_delete"],
      ["driver_profiles", "driver_profiles_no_delete"],
      ["driver_licences", "driver_licences_no_delete"],
      ["organization_driver_relationships", "organization_driver_relationships_no_delete"],
      ["entity_resolution_cases", "entity_resolution_cases_no_delete"],
      ["persons", "persons_no_delete"],
      ["person_name_versions", "person_name_versions_no_delete"],
      ["organization_person_relationships", "organization_person_relationships_no_delete"],
    ];
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const [table, trigger] of triggers) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`);
      const policies = `(SELECT id FROM public.insurance_policies WHERE organization_id = ANY($1::uuid[]) OR insurer_organization_id = ANY($1::uuid[]))`;
      await client.query(`DELETE FROM public.insurance_coverages WHERE policy_id IN ${policies}`, [scopeOrganizations]);
      await client.query(`DELETE FROM public.insurance_endorsements WHERE policy_id IN ${policies}`, [scopeOrganizations]);
      await client.query(`DELETE FROM public.insurance_broker_periods WHERE policy_id IN ${policies}`, [scopeOrganizations]);
      await client.query(`DELETE FROM public.insurance_policy_terms WHERE policy_id IN ${policies}`, [scopeOrganizations]);
      await client.query(`DELETE FROM public.insurance_policies WHERE organization_id = ANY($1::uuid[]) OR insurer_organization_id = ANY($1::uuid[])`, [scopeOrganizations]);
      await client.query(`DELETE FROM public.entity_resolution_cases WHERE organization_context_id = ANY($1::uuid[])`, [scopeOrganizations]);
      await client.query(`DELETE FROM public.organization_vehicle_relationships WHERE organization_id = ANY($1::uuid[]) OR vehicle_id = ANY($2::uuid[])`, [scopeOrganizations, vehicles]);
      await client.query(`DELETE FROM public.vehicles WHERE id = ANY($1::uuid[])`, [vehicles]);
      await client.query(`DELETE FROM public.organization_driver_relationships WHERE organization_id = ANY($1::uuid[]) OR person_id = ANY($2::uuid[])`, [scopeOrganizations, persons]);
      await client.query(`DELETE FROM public.driver_licences WHERE person_id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.driver_profiles WHERE person_id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.organization_person_relationships WHERE person_id = ANY($1::uuid[]) OR organization_id = ANY($2::uuid[])`, [persons, scopeOrganizations]);
      await client.query(`DELETE FROM public.person_name_versions WHERE person_id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.persons WHERE id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const [table, trigger] of [...triggers].reverse()) await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const scenario = (name: string, body: () => Promise<void>) =>
    it(name, async () => {
      fx = new K.db.AuthFixtures(pools.admin);
      organizations = [];
      scopeOrganizations = [];
      persons = [];
      vehicles = [];
      K.db.setClerkUser(null);
      try {
        await body();
      } finally {
        K.db.setClerkUser(null);
        await purge();
        await fx.cleanup();
      }
    });

  // ---- fixtures ------------------------------------------------------------------------------------------------

  async function org(label = "Org", status: "active" | "archived" = "active"): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `OAP ${label} ${id.slice(0, 8)} ${n()}`]);
    organizations.push(id);
    scopeOrganizations.push(id);
    if (status === "archived") await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [id]);
    return id;
  }

  /** A person (with a name version, as the Contacts domain creates one), optionally holding an ACTIVE relationship with an Organization. */
  async function person(organizationId?: string): Promise<{ personId: string; relationshipId: string | null }> {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      const personId = (await client.query<{ id: string }>(`INSERT INTO public.persons DEFAULT VALUES RETURNING id`)).rows[0].id;
      await client.query(
        `INSERT INTO public.person_name_versions (person_id, given_name, family_name, name_normalized, change_reason, effective_from) VALUES ($1, 'Test', $2, $3, 'INITIAL', '2020-01-01Z')`,
        [personId, `Oap${n()}`, `test oap${counter}`],
      );
      let relationshipId: string | null = null;
      if (organizationId) {
        relationshipId = (
          await client.query<{ id: string }>(`INSERT INTO public.organization_person_relationships (organization_id, person_id, effective_from) VALUES ($1, $2, '2020-01-01Z') RETURNING id`, [organizationId, personId])
        ).rows[0].id;
      }
      await client.query("COMMIT");
      persons.push(personId);
      return { personId, relationshipId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function staff(...capabilities: string[]): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    return actor;
  }
  /** Signs in a staff actor holding EXACTLY these capabilities. */
  async function only(...capabilities: string[]) {
    const actor = await staff(...capabilities);
    K.db.setClerkUser(actor.clerkSubject);
    return actor;
  }

  const vinOf = () => `TV${run}${String(n()).padStart(7, "0")}`;
  async function createVehicle(): Promise<string> {
    const created = await K.oi.createVehicle({ vehicleTypeCode: "TRUCK_TRACTOR", vin: vinOf(), make: "Testmake" });
    assert.equal(created.kind, "CREATED");
    vehicles.push(created.vehicleId);
    return created.vehicleId;
  }

  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const errorMessage = (promise: Promise<unknown>, message: string) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof Error, "an Error is thrown");
      assert.equal(error.message, message);
      return true;
    });

  /** Runs one statement inside a SYSTEM transaction carrying `capability`, then always rolls back; reports the rows affected or the SQLSTATE. */
  async function attempt(capability: Parameters<Kit["sys"]["withAuthorizedSystem"]>[0], sql: string, params: unknown[] = []): Promise<Attempt> {
    let result: Attempt = { rowCount: null };
    try {
      await K.sys.withAuthorizedSystem(capability, async (client) => {
        await client.query("SAVEPOINT attempt");
        try {
          result = { rowCount: (await client.query(sql, params)).rowCount };
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT attempt");
          result = { rowCount: null, code: (error as PgError).code, message: (error as PgError).message };
        }
        throw new RollBack();
      });
    } catch (error) {
      if (!(error instanceof RollBack)) throw error;
    }
    return result;
  }
  /** Rows of a SELECT visible inside a SYSTEM transaction carrying `capability`. */
  const visible = (capability: Parameters<Kit["sys"]["withAuthorizedSystem"]>[0], sql: string, params: unknown[] = []) =>
    K.sys.withAuthorizedSystem(capability, async (client) => (await client.query<{ id: string }>(sql, params)).rows.map((row) => row.id));

  // ---- 1. Organization-Vehicle ---------------------------------------------------------------------------------

  describe("establishOrganizationVehicle under VEHICLE_MANAGE only", () => {
    scenario("succeeds for an active Organization; unknown and archived Organizations are refused as before", async () => {
      await only("VEHICLE_MANAGE");
      const organizationId = await org("Operator");
      const vehicleId = await createVehicle();
      const established = await K.oi.establishOrganizationVehicle({ organizationId, vehicleId, relationshipType: "OPERATES", unitNumber: "u-1", effectiveFrom: "2024-01-01T00:00:00Z" });
      assert.match(established.relationshipId, /^[0-9a-f-]{36}$/);
      assert.equal(await count(`SELECT count(*) FROM public.organization_vehicle_relationships WHERE id = $1 AND organization_id = $2 AND vehicle_id = $3`, [established.relationshipId, organizationId, vehicleId]), 1);

      const input = (organization: string) => ({ organizationId: organization, vehicleId, relationshipType: "OWNS" as const, effectiveFrom: "2024-01-01T00:00:00Z" });
      await errorMessage(K.oi.establishOrganizationVehicle(input(randomUUID())), "Organization not found.");
      await errorMessage(K.oi.establishOrganizationVehicle(input(await org("Archived", "archived"))), "Organization must be active.");
      assert.equal(await count(`SELECT count(*) FROM public.organization_vehicle_relationships WHERE vehicle_id = $1`, [vehicleId]), 1, "refusals created nothing");
    });
  });

  // ---- 2. Organization-Driver, driver operations ----------------------------------------------------------------

  describe("driver operations under DRIVER_MANAGE only", () => {
    scenario("establishOrganizationDriver succeeds for an active Organization; unknown and archived are refused as before", async () => {
      await only("DRIVER_MANAGE");
      const organizationId = await org("Employer");
      const { personId } = await person();
      assert.deepEqual(await K.oi.createDriverProfile({ personId }), { personId });
      const established = await K.oi.establishOrganizationDriver({ organizationId, personId, relationshipType: "EMPLOYEE", driverNumber: "d-1", status: "ACTIVE", effectiveFrom: "2024-01-01" });
      assert.match(established.relationshipId, /^[0-9a-f-]{36}$/);
      assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE id = $1 AND organization_id = $2 AND person_id = $3`, [established.relationshipId, organizationId, personId]), 1);

      const input = (organization: string) => ({ organizationId: organization, personId, relationshipType: "CONTRACTOR" as const, status: "ACTIVE" as const, effectiveFrom: "2024-01-01" });
      await errorMessage(K.oi.establishOrganizationDriver(input(randomUUID())), "Organization not found.");
      await errorMessage(K.oi.establishOrganizationDriver(input(await org("Archived", "archived"))), "Organization must be active.");
      assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE person_id = $1`, [personId]), 1, "refusals created nothing");
    });

    scenario("createDriverProfile and addDriverLicence still pass under DRIVER_MANAGE", async () => {
      await only("DRIVER_MANAGE");
      const { personId } = await person();
      assert.deepEqual(await K.oi.createDriverProfile({ personId }), { personId });
      const licence = await K.oi.addDriverLicence({ personId, jurisdictionCountry: "CA", jurisdictionRegion: "ON", licenceNumber: `T${run}${n()}`, effectiveFrom: "2024-01-01" });
      assert.equal(licence.kind, "CREATED");
      assert.equal(await count(`SELECT count(*) FROM public.driver_profiles WHERE person_id = $1`, [personId]), 1);
      assert.equal(await count(`SELECT count(*) FROM public.driver_licences WHERE person_id = $1`, [personId]), 1);
    });
  });

  // ---- 3. Entity resolution --------------------------------------------------------------------------------------

  describe("beginEntityResolution in an Organization context under IDENTITY_RESOLUTION_MANAGE only", () => {
    scenario("opens a case for an active Organization; unknown and archived Organizations are refused", async () => {
      await only("IDENTITY_RESOLUTION_MANAGE");
      const organizationId = await org("Context");
      const input = (organizationContextId: string, key: string) => ({ entityType: "VEHICLE" as const, sourceSystem: `OAP-${run}`, sourceRecordKey: `${key}-${n()}`, organizationContextId });
      const opened = await K.oi.beginEntityResolution(input(organizationId, "ok"));
      assert.equal(opened.kind, "CREATED");
      assert.equal(await count(`SELECT count(*) FROM public.entity_resolution_cases WHERE organization_context_id = $1`, [organizationId]), 1);
      await errorMessage(K.oi.beginEntityResolution(input(randomUUID(), "unknown")), "Organization not found.");
      await errorMessage(K.oi.beginEntityResolution(input(await org("Archived", "archived"), "archived")), "Organization must be active.");
    });
  });

  // ---- 3b. Catalog level: which capability sees an Organization -------------------------------------------------

  describe("which single capability can see (and lock) an Organization", () => {
    for (const capability of SEES_ORGANIZATIONS) {
      scenario(`${capability} alone can SELECT the Organization FOR UPDATE`, async () => {
        const organizationId = await org("Visible");
        await only(capability);
        assert.deepEqual(await visible(capability, `SELECT id FROM public.organizations WHERE id = $1 FOR UPDATE`, [organizationId]), [organizationId]);
        assert.deepEqual(await visible(capability, `SELECT id FROM public.organizations WHERE id = $1`, [organizationId]), [organizationId]);
      });
    }
    for (const capability of BLIND_TO_ORGANIZATIONS) {
      scenario(`${capability} alone sees no Organization`, async () => {
        const organizationId = await org("Hidden");
        await only(capability);
        assert.deepEqual(await visible(capability, `SELECT id FROM public.organizations WHERE id = $1 FOR UPDATE`, [organizationId]), []);
        assert.deepEqual(await visible(capability, `SELECT id FROM public.organizations`), []);
      });
    }
  });

  // ---- 4. Writes are not widened ---------------------------------------------------------------------------------

  describe("writes are not widened", () => {
    for (const capability of ["VEHICLE_MANAGE", "DRIVER_MANAGE", "IDENTITY_RESOLUTION_MANAGE"] as const) {
      scenario(`${capability} cannot update or insert an Organization`, async () => {
        const organizationId = await org("Protected");
        await only(capability);
        const update = await attempt(capability, `UPDATE public.organizations SET display_name = 'Renamed' WHERE id = $1`, [organizationId]);
        const insert = await attempt(capability, `INSERT INTO public.organizations (legal_name, normalized_legal_name) VALUES ('Intruder', 'intruder')`);
        // The row is visible, so the UPDATE passes USING and the database refuses it at WITH CHECK; the INSERT is refused at WITH CHECK.
        for (const [name, outcome] of [["UPDATE", update], ["INSERT", insert]] as const) {
          assert.equal(outcome.code, "42501", `${name} refused (rows ${outcome.rowCount}, ${outcome.message})`);
          assert.match(outcome.message ?? "", /row-level security policy/, `${name} is refused by the row-level security policy, not by a missing privilege`);
        }
        assert.equal(await count(`SELECT count(*) FROM public.organizations WHERE id = $1 AND display_name IS NOT NULL`, [organizationId]), 0, "row unchanged");
        assert.equal(await count(`SELECT count(*) FROM public.organizations WHERE legal_name = 'Intruder'`), 0, "nothing inserted");
      });
    }

    scenario("INSURANCE_MANAGE cannot insert or update an organization_person_relationships row", async () => {
      const organizationId = await org("Brokerage");
      const { personId, relationshipId } = await person(organizationId);
      const other = await person();
      await only("INSURANCE_MANAGE");
      const update = await attempt("INSURANCE_MANAGE", `UPDATE public.organization_person_relationships SET effective_to = now() WHERE id = $1`, [relationshipId]);
      // The insert guard of migration 0014 also reads the person, which INSURANCE_MANAGE cannot see; it is lifted here (by the table
      // owner, restored in finally) so that the INSERT reaches the row-level security WITH CHECK that this test is about.
      await pools.admin.query(`ALTER TABLE public.organization_person_relationships DISABLE TRIGGER organization_person_relationships_guard_insert`);
      let insert: Attempt;
      try {
        insert = await attempt("INSURANCE_MANAGE", `INSERT INTO public.organization_person_relationships (organization_id, person_id, effective_from) VALUES ($1, $2, '2020-01-01Z')`, [organizationId, other.personId]);
      } finally {
        await pools.admin.query(`ALTER TABLE public.organization_person_relationships ENABLE TRIGGER organization_person_relationships_guard_insert`);
      }
      for (const [name, outcome] of [["UPDATE", update], ["INSERT", insert]] as const) {
        assert.equal(outcome.code, "42501", `${name} refused (rows ${outcome.rowCount}, ${outcome.message})`);
        assert.match(outcome.message ?? "", /row-level security policy/, `${name} is refused by the row-level security policy, not by a missing privilege`);
      }
      assert.equal(await count(`SELECT count(*) FROM public.organization_person_relationships WHERE id = $1 AND effective_to IS NULL`, [relationshipId]), 1, "relationship unchanged");
      assert.equal(await count(`SELECT count(*) FROM public.organization_person_relationships WHERE person_id = $1`, [other.personId]), 0, "nothing inserted");
      assert.equal(await count(`SELECT count(*) FROM public.organization_person_relationships WHERE person_id = $1`, [personId]), 1);
    });

    scenario("a CUSTOMER actor still sees only its own Organization and its related insurer and broker", async () => {
      const { organizationId: customerOrganization, customerId } = await fx.organizationAndCustomer("Customer");
      scopeOrganizations.push(customerOrganization);
      const insurer = await org("Insurer");
      const brokerage = await org("Brokerage");
      const unrelated = await org("Unrelated");
      const contact = await person(brokerage);

      await only("INSURANCE_MANAGE");
      await K.ins.createPolicy({
        organizationId: customerOrganization, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: `OAP-${run}-${n()}`,
        termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()], broker: { brokerOrganizationId: brokerage, brokerPersonId: contact.personId },
      });

      const customer = await fx.actor();
      const relationshipId = await fx.relationship(customer.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      K.db.setClerkUser(customer.clerkSubject);

      const seen = await K.cust.withAuthorizedCustomer(customerId, "ORGANIZATION_READ", async (client) => ({
        organizations: (await client.query<{ id: string }>(`SELECT id FROM public.organizations`)).rows.map((row) => row.id).sort(),
        unrelated: (await client.query(`SELECT id FROM public.organizations WHERE id = $1`, [unrelated])).rowCount,
        brokerContacts: (await client.query(`SELECT id FROM public.organization_person_relationships WHERE organization_id = $1`, [brokerage])).rowCount,
      }));
      assert.deepEqual(seen.organizations, [customerOrganization, insurer, brokerage].sort());
      assert.equal(seen.unrelated, 0);
      assert.equal(seen.brokerContacts, 0, "a customer does not see the brokerage's contact relationships");
    });
  });

  // ---- 5. Insurance broker contact -------------------------------------------------------------------------------

  describe("createPolicy with a broker contact under INSURANCE_MANAGE only", () => {
    const policy = (insured: string, insurer: string, broker: Record<string, unknown>) => ({
      organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: `OAP-${run}-${n()}`,
      termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()], broker,
    });

    scenario("a broker contact with an active relationship is accepted and linked to that relationship", async () => {
      await only("INSURANCE_MANAGE");
      const insured = await org("Insured");
      const insurer = await org("Insurer");
      const brokerage = await org("Brokerage");
      const contact = await person(brokerage);
      const view = await K.ins.createPolicy(policy(insured, insurer, { brokerOrganizationId: brokerage, brokerPersonId: contact.personId }));
      assert.deepEqual([view.brokerPeriods[0].brokerOrganizationId, view.brokerPeriods[0].brokerPersonId, view.brokerPeriods[0].brokerRelationshipId], [brokerage, contact.personId, contact.relationshipId]);
    });

    scenario("the guard still guards: no relationship, an ended relationship or another brokerage's relationship is refused", async () => {
      await only("INSURANCE_MANAGE");
      const insured = await org("Insured");
      const insurer = await org("Insurer");
      const brokerage = await org("Brokerage");
      const otherFirm = await org("Other firm");
      const message = "The broker contact must hold an active relationship with the brokerage firm.";
      const refused = (broker: Record<string, unknown>) =>
        assert.rejects(K.ins.createPolicy(policy(insured, insurer, broker)), (error: unknown) => {
          assert.ok(error instanceof K.insErrors.InsuranceValidationError, `expected InsuranceValidationError, got ${String(error)}`);
          assert.ok(error.message.includes(message), error.message);
          return true;
        });

      await refused({ brokerOrganizationId: brokerage, brokerPersonId: (await person()).personId });
      await refused({ brokerOrganizationId: brokerage, brokerPersonId: (await person(otherFirm)).personId });
      const ended = await person(brokerage);
      await pools.admin.query(`UPDATE public.organization_person_relationships SET effective_to = now() WHERE id = $1`, [ended.relationshipId]);
      await refused({ brokerOrganizationId: brokerage, brokerPersonId: ended.personId });
      assert.equal(await count(`SELECT count(*) FROM public.insurance_policies WHERE organization_id = $1`, [insured]), 0, "no policy was created");
    });
  });

  // ---- 7. Policy definitions -------------------------------------------------------------------------------------

  describe("policy definitions", () => {
    type PolicyRow = { policyname: string; table: string; command: string; permissive: boolean; using: string; check: string | null };
    const capabilitiesOf = (expression: string | null) => {
      const match = expression?.match(/ARRAY\[(.*?)\]/);
      return match ? [...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort() : [];
    };
    async function policiesOf(table: string): Promise<PolicyRow[]> {
      return (
        await pools.admin.query<PolicyRow>(
          `SELECT p.polname AS policyname, c.relname AS "table", p.polcmd AS command, p.polpermissive AS permissive,
                  pg_get_expr(p.polqual, p.polrelid) AS "using", pg_get_expr(p.polwithcheck, p.polrelid) AS "check"
             FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'public' AND c.relname = $1 ORDER BY p.polname`,
          [table],
        )
      ).rows;
    }

    it("organizations_system: USING widened by exactly the six capabilities, WITH CHECK unchanged, FOR ALL and permissive", async () => {
      const rows = await policiesOf("organizations");
      assert.deepEqual(rows.map((r) => r.policyname), ["organizations_customer_read", "organizations_system"]);
      const system = rows.find((r) => r.policyname === "organizations_system");
      assert.ok(system);
      assert.deepEqual(capabilitiesOf(system.using), ORGANIZATIONS_USING);
      assert.deepEqual(capabilitiesOf(system.check), ORGANIZATIONS_CHECK);
      assert.equal(system.command, "*", "FOR ALL");
      assert.equal(system.permissive, true, "not restrictive");
      assert.match(system.using, /system_context_authorized/);
      assert.match(system.check ?? "", /system_context_authorized/);
    });

    it("organization_person_relationships_system: USING widened by INSURANCE_MANAGE only, WITH CHECK unchanged, FOR ALL and permissive", async () => {
      const rows = await policiesOf("organization_person_relationships");
      assert.deepEqual(rows.map((r) => r.policyname), ["organization_person_relationships_customer", "organization_person_relationships_system"]);
      const system = rows.find((r) => r.policyname === "organization_person_relationships_system");
      assert.ok(system);
      assert.deepEqual(capabilitiesOf(system.using), RELATIONSHIPS_USING);
      assert.deepEqual(capabilitiesOf(system.check), RELATIONSHIPS_CHECK);
      assert.equal(system.command, "*", "FOR ALL");
      assert.equal(system.permissive, true, "not restrictive");
    });

    it("the CUSTOMER policies are unchanged and read-only", async () => {
      const organizations = (await policiesOf("organizations")).find((r) => r.policyname === "organizations_customer_read");
      const relationships = (await policiesOf("organization_person_relationships")).find((r) => r.policyname === "organization_person_relationships_customer");
      assert.ok(organizations && relationships);
      assert.equal(organizations.command, "r");
      assert.equal(relationships.command, "r");
      assert.deepEqual(capabilitiesOf(organizations.using), ["ORGANIZATION_READ"]);
      assert.deepEqual(capabilitiesOf(relationships.using), ["ORGANIZATION_READ"]);
      assert.equal(organizations.check, null);
      assert.equal(relationships.check, null);
    });
  });
});
