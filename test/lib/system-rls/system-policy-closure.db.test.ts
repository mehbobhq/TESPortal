// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Regression tests for migration 0028 (SYSTEM policy closure). They drive the REAL services through the REAL authorization
// wrappers and Clerk-to-actor resolution, on pooled connections that log in as the RUNTIME role (policy-bound by the row-level
// security of migration 0024), with the real Master Register. Fixtures and owner-level checks use the admin (table owner) pool,
// which bypasses RLS. Every actor in a scenario holds EXACTLY ONE capability, so a missing policy capability shows up as the
// operation of that capability failing.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    sys: await import("@/lib/auth/tes-system-context"),
    oi: await import("@/lib/operational-identity/service"),
    tr: await import("@/lib/tax-registrations/service"),
    cp: await import("@/lib/company-profile/service"),
    ct: await import("@/lib/contacts/service"),
    cr: await import("@/lib/customer-relationship/service"),
    ci: await import("@/lib/corporate-identity/service"),
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

type SystemCapability = Parameters<Kit["sys"]["withAuthorizedSystem"]>[0];
type Attempt = { rowCount: number | null; code?: string; message?: string };
type PgError = Error & { code?: string };
class RollBack extends Error {}

const MONTH = (m: number) => `2020-${String(m).padStart(2, "0")}-01T00:00:00Z`;
const RLS_MESSAGE = /row-level security policy/;

// The capabilities added to organizations_system by 0028 (and kept from 0027) whose operations lock or check an Organization.
const ORGANIZATION_CAPABILITIES = [
  "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "TAX_REGISTRATION_READ", "TAX_REGISTRATION_MANAGE", "COMPANY_PROFILE_READ",
  "COMPANY_PROFILE_MANAGE", "CONTACT_MANAGE", "PERSON_REGISTRY_READ", "VEHICLE_MANAGE", "DRIVER_MANAGE", "IDENTITY_RESOLUTION_MANAGE",
] as const satisfies readonly SystemCapability[];
const BLIND_TO_ORGANIZATIONS = ["VEHICLE_READ", "DRIVER_READ", "IDENTITY_RESOLUTION_READ", "MASTER_REGISTER_READ"] as const satisfies readonly SystemCapability[];

const ORGANIZATIONS_USING = [
  "COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ", "CONTACT_MANAGE", "CREDENTIAL_MANAGE", "CREDENTIAL_READ", "CUSTOMER_ESTABLISH",
  "CUSTOMER_RELATIONSHIP_MANAGE", "CUSTOMER_RELATIONSHIP_READ", "DRIVER_MANAGE", "IDENTITY_RESOLUTION_MANAGE", "INSURANCE_MANAGE", "INSURANCE_READ",
  "ORGANIZATION_ARCHIVE", "ORGANIZATION_CREATE", "ORGANIZATION_REGISTRY_READ", "ORGANIZATION_UPDATE", "PERSON_REGISTRY_READ",
  "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ", "VEHICLE_MANAGE",
];
const ORGANIZATIONS_CHECK = ["CREDENTIAL_MANAGE", "CUSTOMER_ESTABLISH", "INSURANCE_MANAGE", "ORGANIZATION_ARCHIVE", "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE"];
const POLICIES: Array<{ table: string; policy: string; using: string[]; check: string[] }> = [
  { table: "organizations", policy: "organizations_system", using: ORGANIZATIONS_USING, check: ORGANIZATIONS_CHECK },
  {
    table: "customer_engagement_stages", policy: "customer_engagement_stages_system",
    using: ["CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_MANAGE", "CUSTOMER_RELATIONSHIP_READ"], check: ["CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_MANAGE"],
  },
  ...["organization_identifiers", "organization_aliases", "organization_classifications"].map((table) => ({
    table, policy: `${table}_system`,
    using: ["ORGANIZATION_ARCHIVE", "ORGANIZATION_CREATE", "ORGANIZATION_REGISTRY_READ", "ORGANIZATION_UPDATE"], check: ["ORGANIZATION_CREATE", "ORGANIZATION_UPDATE"],
  })),
  ...["registrations", "registration_status_periods"].map((table) => ({
    table, policy: `${table}_system`,
    using: ["COMPANY_PROFILE_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ"], check: ["TAX_REGISTRATION_MANAGE"],
  })),
  // Unchanged by 0028: registration numbers stay unreadable to the operating profile.
  { table: "registration_versions", policy: "registration_versions_system", using: ["TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ"], check: ["TAX_REGISTRATION_MANAGE"] },
];

// The 0024 customer policies on the five tables, as pg_get_expr prints them on a freshly migrated database.
const CUSTOMER_POLICIES: Array<{ table: string; policy: string; using: string }> = [
  { table: "customer_engagement_stages", policy: "customer_engagement_stages_customer", using: "(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND (EXISTS ( SELECT 1\n   FROM customer_engagements e\n  WHERE ((e.id = customer_engagement_stages.engagement_id) AND (e.customer_id = tes_security.current_customer_id())))))" },
  { table: "organization_aliases", policy: "organization_aliases_customer", using: "(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND (organization_id = ( SELECT customers.organization_id\n   FROM customers\n  WHERE (customers.id = tes_security.current_customer_id()))))" },
  { table: "organization_classifications", policy: "organization_classifications_customer", using: "(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND (organization_id = ( SELECT customers.organization_id\n   FROM customers\n  WHERE (customers.id = tes_security.current_customer_id()))))" },
  { table: "organization_identifiers", policy: "organization_identifiers_customer", using: "(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND (organization_id = ( SELECT customers.organization_id\n   FROM customers\n  WHERE (customers.id = tes_security.current_customer_id()))))" },
  { table: "organizations", policy: "organizations_customer_read", using: "(tes_security.customer_context_authorized(ARRAY['ORGANIZATION_READ'::text]) AND ((id = ( SELECT customers.organization_id\n   FROM customers\n  WHERE (customers.id = tes_security.current_customer_id()))) OR (EXISTS ( SELECT 1\n   FROM insurance_policies p\n  WHERE ((p.organization_id = ( SELECT customers.organization_id\n           FROM customers\n          WHERE (customers.id = tes_security.current_customer_id()))) AND (p.insurer_organization_id = organizations.id)))) OR (EXISTS ( SELECT 1\n   FROM insurance_broker_periods b\n  WHERE ((b.organization_id = ( SELECT customers.organization_id\n           FROM customers\n          WHERE (customers.id = tes_security.current_customer_id()))) AND (b.broker_organization_id = organizations.id))))))" },
];

describe("SYSTEM policy closure of migration 0028 (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
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

  // Every table a scenario can create rows in, children first. Only these have their triggers lifted, and only inside the purge.
  const PURGED_TABLES = [
    "master_register_events", "customer_engagement_stages", "customer_engagements", "customers",
    "registration_status_periods", "registration_versions", "registrations", "company_operating_scope_periods",
    "organization_driver_relationships", "driver_profiles", "organization_vehicle_relationships", "vehicles", "entity_resolution_cases",
    "organization_person_relationships", "person_name_versions", "persons",
    "organization_classifications", "organization_aliases", "organization_identifiers", "organizations",
  ] as const;

  /** Removes everything a scenario created. The no-delete triggers and the register's immutability are lifted only here, by the table owner. */
  async function purge() {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const table of PURGED_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`);
      const customers = `(SELECT id FROM public.customers WHERE organization_id = ANY($1::uuid[]))`;
      const registrations = `(SELECT id FROM public.registrations WHERE organization_id = ANY($1::uuid[]))`;
      const related = (await client.query<{ person_id: string }>(`SELECT person_id FROM public.organization_person_relationships WHERE organization_id = ANY($1::uuid[])`, [organizations])).rows.map((row) => row.person_id);
      const allPersons = [...persons, ...related];
      await client.query(`DELETE FROM public.master_register_events WHERE customer_id IN ${customers}`, [organizations]);
      await client.query(`DELETE FROM public.customer_engagement_stages WHERE engagement_id IN (SELECT id FROM public.customer_engagements WHERE customer_id IN ${customers})`, [organizations]);
      await client.query(`DELETE FROM public.customer_engagements WHERE customer_id IN ${customers}`, [organizations]);
      await client.query(`DELETE FROM public.customers WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.registration_status_periods WHERE registration_id IN ${registrations}`, [organizations]);
      await client.query(`DELETE FROM public.registration_versions WHERE registration_id IN ${registrations}`, [organizations]);
      await client.query(`DELETE FROM public.registrations WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.company_operating_scope_periods WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.organization_driver_relationships WHERE organization_id = ANY($1::uuid[]) OR person_id = ANY($2::uuid[])`, [organizations, allPersons]);
      await client.query(`DELETE FROM public.driver_profiles WHERE person_id = ANY($1::uuid[])`, [allPersons]);
      await client.query(`DELETE FROM public.organization_vehicle_relationships WHERE organization_id = ANY($1::uuid[]) OR vehicle_id = ANY($2::uuid[])`, [organizations, vehicles]);
      await client.query(`DELETE FROM public.vehicles WHERE id = ANY($1::uuid[])`, [vehicles]);
      await client.query(`DELETE FROM public.entity_resolution_cases WHERE organization_context_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.organization_person_relationships WHERE organization_id = ANY($1::uuid[]) OR person_id = ANY($2::uuid[])`, [organizations, allPersons]);
      await client.query(`DELETE FROM public.person_name_versions WHERE person_id = ANY($1::uuid[])`, [allPersons]);
      await client.query(`DELETE FROM public.persons WHERE id = ANY($1::uuid[])`, [allPersons]);
      for (const table of ["organization_classifications", "organization_aliases", "organization_identifiers"]) {
        await client.query(`DELETE FROM public.${table} WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      }
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const table of [...PURGED_TABLES].reverse()) await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`);
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

  async function org(label = "Org"): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `SPC ${label} ${id.slice(0, 8)} ${n()}`]);
    organizations.push(id);
    return id;
  }
  async function customerOrganization(): Promise<string> {
    const { organizationId } = await fx.organizationAndCustomer("SPC Customer");
    organizations.push(organizationId);
    return organizationId;
  }
  async function person(): Promise<string> {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      const personId = (await client.query<{ id: string }>(`INSERT INTO public.persons DEFAULT VALUES RETURNING id`)).rows[0].id;
      await client.query(
        `INSERT INTO public.person_name_versions (person_id, given_name, family_name, name_normalized, change_reason, effective_from) VALUES ($1, 'Test', $2, $3, 'INITIAL', '2020-01-01Z')`,
        [personId, `Spc${n()}`, `test spc${counter}`],
      );
      await client.query("COMMIT");
      persons.push(personId);
      return personId;
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

  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);

  /** Runs one statement inside a SYSTEM transaction carrying `capability`, then always rolls back; reports the rows affected or the SQLSTATE. */
  async function attempt(capability: SystemCapability, sql: string, params: unknown[] = []): Promise<Attempt> {
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
  const visible = (capability: SystemCapability, sql: string, params: unknown[] = []) =>
    K.sys.withAuthorizedSystem(capability, async (client) => (await client.query<{ id: string }>(sql, params)).rows.map((row) => row.id));
  const refusedByPolicy = (name: string, outcome: Attempt) => {
    assert.equal(outcome.code, "42501", `${name} refused (rows ${outcome.rowCount}, ${outcome.message})`);
    assert.match(outcome.message ?? "", RLS_MESSAGE, `${name} is refused by the row-level security policy, not by a missing privilege`);
  };

  const digits = () => String(1_000_000 + randomInt(0, 8_000_000)) + String(++counter);
  const vinOf = () => `TV${run}${String(n()).padStart(7, "0")}`;
  const establishCustomer = (organizationId: string) =>
    K.cr.establishCustomerRelationship({ organizationId, engagementType: "RECURRING", stage: "ONBOARDING", startedAt: MONTH(1) });

  // ---- (a) the Organization is visible to the operations that lock or check it -------------------------------------

  type Prepared = { organizationId: string; state: string };
  type Case = { prepare?: () => Promise<Prepared>; operate: (organizationId: string, state: string) => Promise<void> };
  const CASES: Record<(typeof ORGANIZATION_CAPABILITIES)[number], Case> = {
    CUSTOMER_RELATIONSHIP_READ: {
      prepare: async () => ({ organizationId: await customerOrganization(), state: "" }),
      operate: async (organizationId) => {
        assert.equal((await K.cr.getCustomerRelationship(organizationId)).openEngagement, null);
      },
    },
    CUSTOMER_RELATIONSHIP_MANAGE: {
      prepare: async () => {
        const organizationId = await org("Engaged");
        await only("CUSTOMER_ESTABLISH");
        return { organizationId, state: (await establishCustomer(organizationId)).engagement.engagement.id };
      },
      operate: async (_organizationId, engagementId) => {
        const view = await K.cr.changeStage({ engagementId, stage: "MANAGED_PROBATION", plannedEndAt: MONTH(4), effectiveFrom: MONTH(2) });
        assert.equal(view.engagement.id, engagementId);
      },
    },
    TAX_REGISTRATION_READ: {
      operate: async (organizationId) => {
        assert.equal((await K.tr.getOrganizationRegistrations(organizationId)).organizationId, organizationId);
      },
    },
    TAX_REGISTRATION_MANAGE: {
      operate: async (organizationId) => {
        const { view } = await K.tr.createRegistration({ organizationId, program: "IFTA", number: `IF${digits()}`, jurisdiction: { country: "US", region: "TX" } });
        assert.equal(await count(`SELECT count(*) FROM public.registrations WHERE id = $1 AND organization_id = $2`, [view.registration.id, organizationId]), 1);
      },
    },
    COMPANY_PROFILE_READ: {
      operate: async (organizationId) => {
        assert.equal((await K.cp.getCompanyProfile(organizationId)).organizationId, organizationId);
      },
    },
    COMPANY_PROFILE_MANAGE: {
      operate: async (organizationId) => {
        assert.equal((await K.cp.setOperatingScope({ organizationId, operatingScope: "CANADA" })).organizationId, organizationId);
      },
    },
    CONTACT_MANAGE: {
      operate: async (organizationId) => {
        const { contact } = await K.ct.createContact({ organizationId, name: { givenName: `Pat${run}`, familyName: `Tester${n()}` }, effectiveFrom: MONTH(1) });
        assert.equal(contact.relationship.organizationId, organizationId);
      },
    },
    PERSON_REGISTRY_READ: {
      operate: async (organizationId) => {
        assert.deepEqual((await K.ct.getOrganizationContacts(organizationId)).contacts, []);
      },
    },
    VEHICLE_MANAGE: {
      operate: async (organizationId) => {
        const created = await K.oi.createVehicle({ vehicleTypeCode: "TRUCK_TRACTOR", vin: vinOf(), make: "Testmake" });
        vehicles.push(created.vehicleId);
        const established = await K.oi.establishOrganizationVehicle({ organizationId, vehicleId: created.vehicleId, relationshipType: "OPERATES", effectiveFrom: "2024-01-01T00:00:00Z" });
        assert.equal(await count(`SELECT count(*) FROM public.organization_vehicle_relationships WHERE id = $1 AND organization_id = $2`, [established.relationshipId, organizationId]), 1);
      },
    },
    DRIVER_MANAGE: {
      prepare: async () => ({ organizationId: await org("Employer"), state: await person() }),
      operate: async (organizationId, personId) => {
        await K.oi.createDriverProfile({ personId });
        const established = await K.oi.establishOrganizationDriver({ organizationId, personId, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2024-01-01" });
        assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE id = $1 AND organization_id = $2`, [established.relationshipId, organizationId]), 1);
      },
    },
    IDENTITY_RESOLUTION_MANAGE: {
      operate: async (organizationId) => {
        const opened = await K.oi.beginEntityResolution({ entityType: "VEHICLE", sourceSystem: `SPC-${run}`, sourceRecordKey: `K-${n()}`, organizationContextId: organizationId });
        assert.equal(opened.kind, "CREATED");
      },
    },
  };

  describe("a single capability sees and locks the Organization its operations need", () => {
    for (const capability of ORGANIZATION_CAPABILITIES) {
      scenario(`${capability}: SELECT ... FOR UPDATE sees the Organization and the domain operation succeeds`, async () => {
        const prepared = await (CASES[capability].prepare ?? (async () => ({ organizationId: await org(), state: "" })))();
        await only(capability);
        assert.deepEqual(await visible(capability, `SELECT id FROM public.organizations WHERE id = $1 FOR UPDATE`, [prepared.organizationId]), [prepared.organizationId]);
        await CASES[capability].operate(prepared.organizationId, prepared.state);
      });
    }

    for (const capability of BLIND_TO_ORGANIZATIONS) {
      scenario(`${capability} alone still sees no Organization`, async () => {
        const organizationId = await org("Hidden");
        await only(capability);
        assert.deepEqual(await visible(capability, `SELECT id FROM public.organizations WHERE id = $1 FOR UPDATE`, [organizationId]), []);
        assert.deepEqual(await visible(capability, `SELECT id FROM public.organizations`), []);
      });
    }

    scenario("none of these capabilities can UPDATE or INSERT an Organization", async () => {
      const organizationId = await org("Protected");
      for (const capability of ORGANIZATION_CAPABILITIES) {
        await only(capability);
        refusedByPolicy(`${capability} UPDATE`, await attempt(capability, `UPDATE public.organizations SET display_name = 'Renamed' WHERE id = $1`, [organizationId]));
        refusedByPolicy(`${capability} INSERT`, await attempt(capability, `INSERT INTO public.organizations (legal_name, normalized_legal_name) VALUES ('Intruder', 'intruder')`));
      }
      assert.equal(await count(`SELECT count(*) FROM public.organizations WHERE id = $1 AND display_name IS NOT NULL`, [organizationId]), 0, "row unchanged");
      assert.equal(await count(`SELECT count(*) FROM public.organizations WHERE legal_name = 'Intruder'`), 0, "nothing inserted");
    });
  });

  // ---- (b) establishing a Customer relationship writes the first engagement stage -----------------------------------

  describe("establishCustomerRelationship under CUSTOMER_ESTABLISH only", () => {
    scenario("succeeds; the first stage exists and is readable by the three customer-relationship capabilities", async () => {
      const organizationId = await org("Customer");
      await only("CUSTOMER_ESTABLISH");
      const established = await establishCustomer(organizationId);
      const engagementId = established.engagement.engagement.id;
      assert.equal(await count(`SELECT count(*) FROM public.customer_engagement_stages WHERE engagement_id = $1 AND stage_code = 'ONBOARDING'`, [engagementId]), 1);
      for (const capability of ["CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE"] as const) {
        await only(capability);
        assert.equal((await visible(capability, `SELECT id FROM public.customer_engagement_stages WHERE engagement_id = $1`, [engagementId])).length, 1, `${capability} reads the stage`);
      }
    });

    scenario("a stage cannot be inserted under CUSTOMER_RELATIONSHIP_READ or an unrelated capability", async () => {
      const organizationId = await org("Customer");
      await only("CUSTOMER_ESTABLISH");
      const engagementId = (await establishCustomer(organizationId)).engagement.engagement.id;
      // The insert guard of migration 0015 is lifted (by the table owner, restored in finally) so the INSERT reaches the WITH CHECK.
      await pools.admin.query(`ALTER TABLE public.customer_engagement_stages DISABLE TRIGGER customer_engagement_stages_guard_insert`);
      try {
        for (const capability of ["CUSTOMER_RELATIONSHIP_READ", "ORGANIZATION_REGISTRY_READ"] as const) {
          await only(capability);
          refusedByPolicy(
            `${capability} INSERT`,
            await attempt(capability, `INSERT INTO public.customer_engagement_stages (engagement_id, stage_code, change_reason, effective_from) VALUES ($1, 'ONBOARDING', 'intruder', now())`, [engagementId]),
          );
        }
      } finally {
        await pools.admin.query(`ALTER TABLE public.customer_engagement_stages ENABLE TRIGGER customer_engagement_stages_guard_insert`);
      }
      assert.equal(await count(`SELECT count(*) FROM public.customer_engagement_stages WHERE engagement_id = $1`, [engagementId]), 1, "nothing inserted");
    });
  });

  // ---- (c) creating an Organization writes identifiers, aliases and classifications ----------------------------------

  describe("createOrganization under ORGANIZATION_CREATE only", () => {
    scenario("persists its identifier, alias and classification", async () => {
      await only("ORGANIZATION_CREATE");
      const { organization } = await K.ci.createOrganization({
        legalName: `SPC Created ${run} ${n()}`,
        identifiers: [{ kind: "CRA_BN", value: String(100_000_000 + randomInt(0, 800_000_000)) }],
        aliases: [{ alias: `SPC Alias ${run} ${n()}`, aliasType: "TRADE_NAME" }],
        classifications: [{ code: "owner_operator", isPrimary: true }],
      });
      organizations.push(organization.id);
      for (const table of ["organization_identifiers", "organization_aliases", "organization_classifications"]) {
        assert.equal(await count(`SELECT count(*) FROM public.${table} WHERE organization_id = $1`, [organization.id]), 1, table);
      }
    });

    scenario("archiveOrganization and restoreOrganization under ORGANIZATION_ARCHIVE only return the Organization with its identifier, alias and classification", async () => {
      await only("ORGANIZATION_CREATE");
      const { organization } = await K.ci.createOrganization({
        legalName: `SPC Archived ${run} ${n()}`,
        identifiers: [{ kind: "CRA_BN", value: String(100_000_000 + randomInt(0, 800_000_000)) }],
        aliases: [{ alias: `SPC Archive Alias ${run} ${n()}`, aliasType: "TRADE_NAME" }],
        classifications: [{ code: "owner_operator", isPrimary: true }],
      });
      organizations.push(organization.id);
      await only("ORGANIZATION_ARCHIVE");
      const archived = await K.ci.archiveOrganization(organization.id, { reason: "regression" });
      assert.equal(archived.organization.status, "archived");
      const restored = await K.ci.restoreOrganization(organization.id, { reason: "regression" });
      assert.equal(restored.organization.status, "active");
      for (const result of [archived, restored]) {
        assert.equal(result.organization.identifiers.length, 1, "identifier returned");
        assert.equal(result.organization.aliases.length, 1, "alias returned");
        assert.equal(result.organization.classifications.length, 1, "classification returned");
      }
    });

    scenario("ORGANIZATION_ARCHIVE cannot INSERT or UPDATE identifier, alias or classification rows even though it reads them", async () => {
      await only("ORGANIZATION_CREATE");
      const { organization } = await K.ci.createOrganization({
        legalName: `SPC Guarded ${run} ${n()}`,
        identifiers: [{ kind: "CRA_BN", value: String(100_000_000 + randomInt(0, 800_000_000)) }],
        aliases: [{ alias: `SPC Guard Alias ${run} ${n()}`, aliasType: "TRADE_NAME" }],
        classifications: [{ code: "owner_operator", isPrimary: true }],
      });
      organizations.push(organization.id);
      await only("ORGANIZATION_ARCHIVE");
      const writes: Array<[string, string]> = [
        ["organization_identifiers", `UPDATE public.organization_identifiers SET status = status WHERE organization_id = $1`],
        ["organization_aliases", `UPDATE public.organization_aliases SET status = status WHERE organization_id = $1`],
        ["organization_classifications", `UPDATE public.organization_classifications SET is_primary = is_primary WHERE organization_id = $1`],
        ["organization_identifiers", `INSERT INTO public.organization_identifiers (organization_id, identifier_type, namespace, value, normalized_value, status) VALUES ($1, 'CRA_BN', 'CRA', '123456782', '123456782', 'active')`],
        ["organization_aliases", `INSERT INTO public.organization_aliases (organization_id, alias, normalized_alias, alias_type, status) VALUES ($1, 'Intruder', 'intruder', 'trade_name', 'active')`],
        ["organization_classifications", `INSERT INTO public.organization_classifications (organization_id, classification_code, is_primary) VALUES ($1, 'service_provider', false)`],
      ];
      for (const [table, sql] of writes) refusedByPolicy(`ORGANIZATION_ARCHIVE ${sql.split(" ")[0]} ${table}`, await attempt("ORGANIZATION_ARCHIVE", sql, [organization.id]));
      for (const table of ["organization_identifiers", "organization_aliases", "organization_classifications"]) {
        assert.equal(await count(`SELECT count(*) FROM public.${table} WHERE organization_id = $1`, [organization.id]), 1, `${table} untouched`);
      }
    });

    scenario("ORGANIZATION_REGISTRY_READ cannot insert them; ORGANIZATION_UPDATE still can through its service", async () => {
      const organizationId = await org("Target");
      const inserts: Array<[string, string]> = [
        ["organization_identifiers", `INSERT INTO public.organization_identifiers (organization_id, identifier_type, namespace, value, normalized_value, status) VALUES ($1, 'CRA_BN', 'CRA', '123456782', '123456782', 'active')`],
        ["organization_aliases", `INSERT INTO public.organization_aliases (organization_id, alias, normalized_alias, alias_type, status) VALUES ($1, 'Intruder', 'intruder', 'trade_name', 'active')`],
        ["organization_classifications", `INSERT INTO public.organization_classifications (organization_id, classification_code, is_primary) VALUES ($1, 'owner_operator', false)`],
      ];
      for (const capability of ["ORGANIZATION_REGISTRY_READ"] as const) {
        await only(capability);
        for (const [table, sql] of inserts) refusedByPolicy(`${capability} INSERT ${table}`, await attempt(capability, sql, [organizationId]));
      }
      for (const [table] of inserts) assert.equal(await count(`SELECT count(*) FROM public.${table} WHERE organization_id = $1`, [organizationId]), 0, `${table} untouched`);

      await only("ORGANIZATION_UPDATE");
      await K.ci.addAlias(organizationId, { alias: `SPC Added ${run} ${n()}`, aliasType: "TRADE_NAME" });
      await K.ci.addClassification(organizationId, { code: "service_provider" });
      await K.ci.addIdentifier(organizationId, { kind: "CRA_BN", value: String(100_000_000 + randomInt(0, 800_000_000)) });
      for (const [table] of inserts) assert.equal(await count(`SELECT count(*) FROM public.${table} WHERE organization_id = $1`, [organizationId]), 1, `${table} written by ORGANIZATION_UPDATE`);
    });
  });

  // ---- (e) the operating profile reads registrations and their status periods ------------------------------------------

  describe("the operating profile's TAX comparison under COMPANY_PROFILE_READ only", () => {
    const iftaRow = async (organizationId: string) => (await K.cp.compareTaxApplicabilityWithRegistrations(organizationId)).find((row) => row.ruleCode === "IFTA");

    scenario("a registered program is REGISTRATION_WITHOUT_APPLICABILITY; with no registration it is NOT_CONFIGURED", async () => {
      const registered = await org("Registered");
      const unregistered = await org("Unregistered");
      await only("TAX_REGISTRATION_MANAGE");
      await K.tr.createRegistration({ organizationId: registered, program: "IFTA", number: `IF${digits()}`, jurisdiction: { country: "US", region: "TX" } });
      await only("COMPANY_PROFILE_READ");
      const withRegistration = await iftaRow(registered);
      assert.equal(withRegistration?.alignment, "REGISTRATION_WITHOUT_APPLICABILITY");
      assert.equal(withRegistration?.hasActiveRegistration, true);
      // vacuous-pass guard: the same comparison for an Organization with no registration says NOT_CONFIGURED
      const without = await iftaRow(unregistered);
      assert.equal(without?.alignment, "NOT_CONFIGURED");
      assert.equal(without?.hasActiveRegistration, false);
    });

    scenario("COMPANY_PROFILE_READ and COMPANY_PROFILE_MANAGE cannot write registrations or status periods, and never see registration_versions", async () => {
      const organizationId = await org("Registered");
      await only("TAX_REGISTRATION_MANAGE");
      const { view } = await K.tr.createRegistration({ organizationId, program: "IFTA", number: `IF${digits()}`, jurisdiction: { country: "US", region: "TX" } });
      const registrationId = view.registration.id;
      // The insert guard of migration 0016 also reads the registration (invisible to MANAGE); it is lifted by the table owner, restored in finally,
      // so that the INSERT reaches the WITH CHECK this test is about.
      await pools.admin.query(`ALTER TABLE public.registration_status_periods DISABLE TRIGGER registration_status_periods_guard_insert`);
      try {
        for (const capability of ["COMPANY_PROFILE_READ", "COMPANY_PROFILE_MANAGE"] as const) {
          await only(capability);
          assert.deepEqual(await visible(capability, `SELECT id FROM public.registration_versions WHERE registration_id = $1`, [registrationId]), [], `${capability} sees no registration_versions`);
          assert.equal((await visible(capability, `SELECT id FROM public.registrations WHERE id = $1`, [registrationId])).length, capability === "COMPANY_PROFILE_READ" ? 1 : 0, `${capability} registrations visibility`);
          assert.equal((await visible(capability, `SELECT id FROM public.registration_status_periods WHERE registration_id = $1`, [registrationId])).length, capability === "COMPANY_PROFILE_READ" ? 1 : 0, `${capability} status period visibility`);
          const writes: Array<[string, string, unknown[]]> = [
            ["INSERT registrations", `INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'KYU')`, [organizationId]],
            ["INSERT registration_status_periods", `INSERT INTO public.registration_status_periods (registration_id, registration_status, period_reason, effective_from) VALUES ($1, 'ACTIVE', 'TRANSITION', now())`, [registrationId]],
          ];
          for (const [name, sql, params] of writes) refusedByPolicy(`${capability} ${name}`, await attempt(capability, sql, params));
          const updates: Array<[string, string]> = [
            ["UPDATE registrations", `UPDATE public.registrations SET record_status = record_status WHERE id = $1`],
            ["UPDATE registration_status_periods", `UPDATE public.registration_status_periods SET record_status = record_status WHERE registration_id = $1`],
          ];
          for (const [name, sql] of updates) {
            const outcome = await attempt(capability, sql, [registrationId]);
            // READ sees the row, so the UPDATE reaches WITH CHECK and is refused; MANAGE cannot see the row at all, so it affects nothing.
            if (capability === "COMPANY_PROFILE_READ") refusedByPolicy(`${capability} ${name}`, outcome);
            else assert.deepEqual([outcome.code ?? null, outcome.rowCount], [null, 0], `${capability} ${name} affects no row`);
          }
        }
      } finally {
        await pools.admin.query(`ALTER TABLE public.registration_status_periods ENABLE TRIGGER registration_status_periods_guard_insert`);
      }
      assert.equal(await count(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [organizationId]), 1, "no registration inserted");
      assert.equal(await count(`SELECT count(*) FROM public.registration_status_periods WHERE registration_id = $1`, [registrationId]), 1, "no status period inserted");
    });
  });

  // ---- (d) policy definitions ------------------------------------------------------------------------------------

  describe("policy definitions", () => {
    type PolicyRow = { policyname: string; command: string; permissive: boolean; using: string | null; check: string | null };
    const capabilitiesOf = (expression: string | null) => {
      const match = expression?.match(/ARRAY\[(.*?)\]/);
      return match ? [...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort() : [];
    };
    const policiesOf = async (table: string) =>
      (
        await pools.admin.query<PolicyRow>(
          `SELECT p.polname AS policyname, p.polcmd AS command, p.polpermissive AS permissive,
                  pg_get_expr(p.polqual, p.polrelid) AS "using", pg_get_expr(p.polwithcheck, p.polrelid) AS "check"
             FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'public' AND c.relname = $1 ORDER BY p.polname`,
          [table],
        )
      ).rows;

    for (const expected of POLICIES) {
      it(`${expected.policy}: exact USING and WITH CHECK capabilities, FOR ALL, permissive`, async () => {
        const policy = (await policiesOf(expected.table)).find((row) => row.policyname === expected.policy);
        assert.ok(policy, `${expected.policy} exists`);
        assert.deepEqual(capabilitiesOf(policy.using), expected.using);
        assert.deepEqual(capabilitiesOf(policy.check), expected.check);
        assert.equal(policy.command, "*", "FOR ALL");
        assert.equal(policy.permissive, true, "not restrictive");
        assert.match(policy.using ?? "", /^tes_security\.system_context_authorized\(ARRAY\[[^\]]*\]\)$/);
        assert.match(policy.check ?? "", /^tes_security\.system_context_authorized\(ARRAY\[[^\]]*\]\)$/);
      });
    }

    it("the 0024 customer policies on those tables are unchanged (exact pg_get_expr text, read-only, no WITH CHECK)", async () => {
      for (const expected of CUSTOMER_POLICIES) {
        const rows = await policiesOf(expected.table);
        assert.deepEqual(rows.map((row) => row.policyname).sort(), [expected.policy, expected.table === "organizations" ? "organizations_system" : `${expected.table}_system`].sort(), `${expected.table} has exactly its customer and system policies`);
        const customer = rows.find((row) => row.policyname === expected.policy);
        assert.ok(customer);
        assert.equal(customer.using, expected.using, `${expected.policy} text`);
        assert.equal(customer.command, "r", `${expected.policy} is read-only`);
        assert.equal(customer.permissive, true);
        assert.equal(customer.check, null);
      }
    });
  });
});
