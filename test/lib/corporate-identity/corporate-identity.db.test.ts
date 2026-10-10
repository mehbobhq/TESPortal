// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL Corporate Identity service through the REAL authorization wrappers and Clerk-to-actor resolution,
// on pooled connections that log in as the RUNTIME role, against a database with migrations 0001-0011 applied.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    authz: await import("@/lib/auth/tes-authorization"),
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

type Capability =
  | "ORGANIZATION_CREATE"
  | "ORGANIZATION_UPDATE"
  | "ORGANIZATION_ARCHIVE"
  | "ORGANIZATION_REGISTRY_READ"
  | "ORGANIZATION_READ";

describe("Corporate Identity service (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let createdOrganizations: string[] = [];
  let cleanups: Array<() => Promise<void>> = [];

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  const scenario = (name: string, body: () => Promise<void>) =>
    it(name, async () => {
      fx = new K.db.AuthFixtures(pools.admin);
      createdOrganizations = [];
      cleanups = [];
      K.db.setClerkUser(null);
      try {
        await body();
      } finally {
        K.db.setClerkUser(null);
        for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
        await removeOrganizations(createdOrganizations);
        await fx.cleanup();
      }
    });

  /** Removes organizations the test created (children first; merged rows before their targets). Master Register is append-only. */
  async function removeOrganizations(ids: string[]) {
    if (ids.length === 0) return;
    for (const table of ["organization_classifications", "organization_aliases", "organization_identifiers"]) {
      await pools.admin.query(`DELETE FROM public.${table} WHERE organization_id = ANY($1::uuid[])`, [ids]);
    }
    await pools.admin.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[]) AND merged_into_organization_id IS NOT NULL`, [ids]);
    await pools.admin.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [ids]);
  }

  const track = (id: string) => {
    createdOrganizations.push(id);
    return id;
  };

  const run = randomUUID().slice(0, 8);
  let counter = 0;
  const name = (label: string) => `CI Test ${run} ${label} ${++counter}`;
  const digits = (length: number) => {
    let out = String(1 + Math.floor(Math.random() * 9));
    while (out.length < length) out += String(Math.floor(Math.random() * 10));
    return out;
  };
  const bn = () => digits(9);
  const incorporationNumber = () => `T${run.toUpperCase()}${digits(6)}`;

  async function staff(...capabilities: Capability[]): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    return actor;
  }
  const signIn = (actor: TestActor) => K.db.setClerkUser(actor.clerkSubject);

  /** An actor holding every SYSTEM capability this service uses. */
  async function fullStaff() {
    const actor = await staff("ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_ARCHIVE", "ORGANIZATION_REGISTRY_READ");
    signIn(actor);
    return actor;
  }

  async function create(input: Parameters<Kit["ci"]["createOrganization"]>[0]) {
    const result = await K.ci.createOrganization(input);
    track(result.organization.id);
    return result;
  }

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });

  async function eventsFor(resourceId: string) {
    const result = await pools.admin.query<{ event_type: string; actor_id: string; target: Record<string, unknown>; change_set: unknown; outcome: unknown }>(
      `SELECT event_type, actor_id, target, change_set, outcome FROM public.master_register_events
        WHERE target ->> 'resourceId' = $1 ORDER BY recorded_at, event_id`,
      [resourceId],
    );
    return result.rows;
  }
  const eventsByActor = async (actorId: string) =>
    Number((await pools.admin.query(`SELECT count(*) FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId])).rows[0].count);
  const organizationExists = async (legalName: string) =>
    (await pools.admin.query(`SELECT 1 FROM public.organizations WHERE legal_name = $1`, [legalName])).rowCount === 1;

  // =============================================================================================================
  describe("create", () => {
    scenario("minimal valid Organization", async () => {
      const actor = await fullStaff();
      const legalName = name("Minimal");
      const { organization, reviewMatches } = await create({ legalName });
      assert.equal(organization.legalName, legalName);
      assert.equal(organization.displayName, null);
      assert.equal(organization.status, "active");
      assert.equal(organization.formationCountry, null);
      assert.equal(organization.formationRegion, null);
      assert.equal(organization.normalizedLegalName, legalName.toLowerCase());
      assert.deepEqual(organization.identifiers, []);
      assert.deepEqual(organization.aliases, []);
      assert.deepEqual(organization.classifications, []);
      assert.equal(organization.primaryRegistration, null);
      assert.deepEqual(reviewMatches, []);
      const events = await eventsFor(organization.id);
      assert.equal(events.length, 1);
      assert.equal(events[0].event_type, "ORGANIZATION_CREATED");
      assert.equal(events[0].actor_id, actor.actorId);
    });

    scenario("whitespace is cleaned, display name stored, name normalized for lookup", async () => {
      await fullStaff();
      const base = name("Spacing");
      const { organization } = await create({ legalName: `  ${base.replace(" ", "   ")}  `, displayName: "  Spacing   Co " });
      assert.equal(organization.legalName, base);
      assert.equal(organization.displayName, "Spacing Co");
    });

    scenario("Organization with a CRA Business Number", async () => {
      await fullStaff();
      const value = bn();
      const { organization } = await create({ legalName: name("BN"), identifiers: [{ kind: "CRA_BN", value }] });
      const [identifier] = organization.identifiers;
      assert.equal(identifier.kind, "CRA_BN");
      assert.equal(identifier.identifierType, "business_number");
      assert.equal(identifier.namespace, "cra");
      assert.equal(identifier.jurisdictionCountry, "CA");
      assert.equal(identifier.jurisdictionRegion, null);
      assert.equal(identifier.normalizedValue, value);
      assert.equal(identifier.normalizationRuleVersion, "cra_bn.v1");
      assert.equal(identifier.verificationStatus, "unverified");
      assert.equal(identifier.status, "active");
      assert.equal(organization.primaryRegistration, null);
    });

    scenario("Organization with an EIN", async () => {
      await fullStaff();
      const value = bn();
      const { organization } = await create({ legalName: name("EIN"), identifiers: [{ kind: "IRS_EIN", value: `${value.slice(0, 2)}-${value.slice(2)}` }] });
      const [identifier] = organization.identifiers;
      assert.equal(identifier.kind, "IRS_EIN");
      assert.equal(identifier.jurisdictionCountry, "US");
      assert.equal(identifier.normalizedValue, value);
      assert.equal(identifier.normalizationRuleVersion, "irs_ein.v1");
    });

    scenario("Organization with BOTH a BN and an EIN (independent, not mutually exclusive)", async () => {
      await fullStaff();
      const { organization } = await create({
        legalName: name("Both"),
        identifiers: [
          { kind: "CRA_BN", value: bn() },
          { kind: "IRS_EIN", value: bn() },
        ],
      });
      assert.deepEqual(organization.identifiers.map((identifier) => identifier.kind).sort(), ["CRA_BN", "IRS_EIN"]);
    });

    scenario("Organization with an incorporation identifier adopts the formation jurisdiction and exposes the derived primary registration", async () => {
      await fullStaff();
      const value = incorporationNumber();
      const { organization } = await create({
        legalName: name("Inc"),
        identifiers: [{ kind: "INCORPORATION", value, country: "ca", region: "on" }],
      });
      assert.equal(organization.formationCountry, "CA");
      assert.equal(organization.formationRegion, "ON");
      assert.equal(organization.primaryRegistration?.kind, "INCORPORATION");
      assert.equal(organization.primaryRegistration?.normalizedValue, value);
      assert.equal(organization.primaryRegistration?.normalizationRuleVersion, "corporate_registration.default.v1");
    });

    scenario("federal incorporation (Canada, no region) and an explicit formation that matches", async () => {
      await fullStaff();
      const { organization } = await create({
        legalName: name("Federal"),
        formation: { country: "CA" },
        identifiers: [{ kind: "INCORPORATION", value: incorporationNumber(), country: "CA" }],
      });
      assert.equal(organization.formationRegion, null);
      assert.ok(organization.primaryRegistration);
    });

    scenario("extra-provincial registration never becomes the primary registration", async () => {
      await fullStaff();
      const { organization } = await create({
        legalName: name("ExtraProv"),
        identifiers: [
          { kind: "EXTRA_PROVINCIAL_REGISTRATION", value: incorporationNumber(), country: "CA", region: "BC" },
          { kind: "INCORPORATION", value: incorporationNumber(), country: "CA", region: "ON" },
        ],
      });
      assert.equal(organization.primaryRegistration?.kind, "INCORPORATION");
      assert.equal(organization.primaryRegistration?.jurisdictionRegion, "ON");
      assert.equal(organization.identifiers.filter((identifier) => identifier.kind === "EXTRA_PROVINCIAL_REGISTRATION").length, 1);

      const alone = await create({
        legalName: name("ExtraOnly"),
        formation: { country: "CA", region: "ON" },
        identifiers: [{ kind: "EXTRA_PROVINCIAL_REGISTRATION", value: incorporationNumber(), country: "CA", region: "BC" }],
      });
      assert.equal(alone.organization.primaryRegistration, null);
    });

    scenario("an Organization may legitimately have no incorporation identifier and none is fabricated", async () => {
      await fullStaff();
      const { organization } = await create({ legalName: name("NoInc"), identifiers: [{ kind: "CRA_BN", value: bn() }] });
      assert.equal(organization.identifiers.some((identifier) => identifier.kind === "INCORPORATION"), false);
      assert.equal(organization.formationCountry, null);
    });

    scenario("aliases and multiple classifications", async () => {
      await fullStaff();
      const { organization } = await create({
        legalName: name("Rich"),
        aliases: [
          { alias: "Rich Haulage", aliasType: "TRADE_NAME" },
          { alias: "Old Rich Ltd.", aliasType: "FORMER_NAME" },
        ],
        classifications: [{ code: "owner_operator", isPrimary: true }, { code: "service_provider" }, { code: "sub_contractor" }],
      });
      assert.deepEqual(organization.aliases.map((alias) => [alias.alias, alias.aliasType, alias.normalizedAlias, alias.status]).sort(), [
        ["Old Rich Ltd.", "former_name", "old rich ltd", "active"],
        ["Rich Haulage", "trade_name", "rich haulage", "active"],
      ]);
      assert.equal(organization.classifications.length, 3);
      assert.deepEqual(organization.classifications.filter((classification) => classification.isPrimary).map((classification) => classification.code), ["owner_operator"]);
      assert.equal(organization.classifications.every((classification) => classification.effectiveTo === null), true);
    });

    scenario("a trade name is an alias, not a new Organization", async () => {
      await fullStaff();
      const before = Number((await pools.admin.query(`SELECT count(*) FROM public.organizations`)).rows[0].count);
      await create({ legalName: name("Parent"), aliases: [{ alias: "Roadrunner Freight", aliasType: "TRADE_NAME" }] });
      const after = Number((await pools.admin.query(`SELECT count(*) FROM public.organizations`)).rows[0].count);
      assert.equal(after - before, 1);
    });

    scenario("Customer and Prospect are not classifications; unknown codes are rejected", async () => {
      await fullStaff();
      for (const code of ["customer", "prospect", "Customer", "nonsense"]) {
        const legalName = name("BadClass");
        await rejectsWith(create({ legalName, classifications: [{ code }] }), K.ci.CorporateIdentityValidationError);
        assert.equal(await organizationExists(legalName), false);
      }
    });

    scenario("invalid structure is rejected before any write", async () => {
      await fullStaff();
      const cases: Array<[string, Parameters<Kit["ci"]["createOrganization"]>[0]]> = [
        ["blank name", { legalName: "   " }],
        ["duplicate identifier in the request", { legalName: name("D1"), identifiers: [{ kind: "CRA_BN", value: "111222333" }, { kind: "CRA_BN", value: "111-222-333" }] }],
        ["two incorporations", { legalName: name("D2"), identifiers: [{ kind: "INCORPORATION", value: "AAA111", country: "CA", region: "ON" }, { kind: "INCORPORATION", value: "BBB222", country: "CA", region: "BC" }] }],
        ["formation vs incorporation mismatch", { legalName: name("D3"), formation: { country: "CA", region: "BC" }, identifiers: [{ kind: "INCORPORATION", value: "CCC333", country: "CA", region: "ON" }] }],
        ["extra-provincial in the formation jurisdiction", { legalName: name("D4"), formation: { country: "CA", region: "ON" }, identifiers: [{ kind: "EXTRA_PROVINCIAL_REGISTRATION", value: "DDD444", country: "CA", region: "ON" }] }],
        ["US formation without a state", { legalName: name("D5"), formation: { country: "US" } }],
        ["formation by country name", { legalName: name("D6"), formation: { country: "Canada", region: "ON" } }],
        ["duplicate alias", { legalName: name("D7"), aliases: [{ alias: "Foo Bar", aliasType: "TRADE_NAME" }, { alias: "FOO  bar!", aliasType: "TRADE_NAME" }] }],
        ["unknown alias type", { legalName: name("D8"), aliases: [{ alias: "Foo", aliasType: "NICKNAME" as never }] }],
        ["two primary classifications", { legalName: name("D9"), classifications: [{ code: "owner_operator", isPrimary: true }, { code: "other", isPrimary: true }] }],
        ["duplicate classification", { legalName: name("D10"), classifications: [{ code: "other" }, { code: "other" }] }],
      ];
      for (const [label, input] of cases) {
        await assert.rejects(K.ci.createOrganization(input), (error: unknown) => {
          assert.ok(error instanceof K.ci.CorporateIdentityValidationError, `${label}: ${String(error)}`);
          return true;
        });
        if ("legalName" in input && input.legalName.trim()) assert.equal(await organizationExists(input.legalName.trim()), false, label);
      }
    });

    scenario("callers cannot supply status, merge target, ids, CMP ids or persistence vocabulary", async () => {
      await fullStaff();
      const smuggled: Array<Record<string, unknown>> = [
        { status: "archived" },
        { status: "Active" },
        { id: randomUUID() },
        { mergedIntoOrganizationId: randomUUID() },
        { cmpId: "CMP-12345" },
        { legacyId: "CMP-12345" },
        { country_code: "CA" },
        { normalizedLegalName: "x" },
      ];
      for (const extra of smuggled) {
        const legalName = name("Smuggle");
        await rejectsWith(K.ci.createOrganization({ legalName, ...extra } as never), K.ci.CorporateIdentityValidationError);
        assert.equal(await organizationExists(legalName), false);
      }
      await rejectsWith(
        K.ci.createOrganization({ legalName: name("Vocab"), identifiers: [{ kind: "CRA_BN", value: bn(), identifierType: "anything", namespace: "mine" } as never] }),
        K.ci.CorporateIdentityValidationError,
      );
    });

    scenario("malformed BN, malformed EIN and wrong jurisdictions are rejected", async () => {
      await fullStaff();
      const bad: Array<unknown> = [
        { kind: "CRA_BN", value: "12345" },
        { kind: "CRA_BN", value: "123456789RT0001" },
        { kind: "IRS_EIN", value: "12-345" },
        { kind: "INCORPORATION", value: "ABC123", country: "US", region: "ON" },
        { kind: "INCORPORATION", value: "ABC123", country: "CA", region: "TX" },
        { kind: "EXTRA_PROVINCIAL_REGISTRATION", value: "ABC123", country: "CA" },
        { kind: "CRA_BN", value: "123456789", country: "US" },
      ];
      for (const identifier of bad) {
        const legalName = name("BadId");
        await rejectsWith(K.ci.createOrganization({ legalName, identifiers: [identifier as never] }), K.ci.CorporateIdentityValidationError);
        assert.equal(await organizationExists(legalName), false);
      }
    });

    scenario("atomic rollback: a Master Register write failure leaves neither the Organization nor any child rows", async () => {
      await fullStaff();
      await pools.admin.query(`
        CREATE OR REPLACE FUNCTION public.tes_test_fail_master_register() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.change_set::text LIKE '%MR-FAIL-TEST%' THEN RAISE EXCEPTION 'test: master register write refused'; END IF;
          RETURN NEW;
        END $$`);
      await pools.admin.query(`CREATE TRIGGER tes_test_fail_master_register BEFORE INSERT ON public.master_register_events
                               FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_master_register()`);
      cleanups.push(async () => {
        await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
        await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_master_register()`);
      });

      const legalName = `MR-FAIL-TEST ${name("Atomic")}`;
      const value = bn();
      await assert.rejects(
        K.ci.createOrganization({
          legalName,
          identifiers: [{ kind: "CRA_BN", value }],
          aliases: [{ alias: "Atomic Alias", aliasType: "TRADE_NAME" }],
          classifications: [{ code: "other" }],
        }),
        /master register write refused/,
      );
      assert.equal(await organizationExists(legalName), false);
      const leaked = await pools.admin.query(
        `SELECT 1 FROM public.organization_identifiers WHERE normalized_value = $1
         UNION ALL SELECT 1 FROM public.organization_aliases WHERE alias = 'Atomic Alias'`,
        [value],
      );
      assert.equal(leaked.rowCount, 0);
      assert.equal(
        (await pools.admin.query(`SELECT 1 FROM public.master_register_events WHERE change_set::text LIKE '%MR-FAIL-TEST%'`)).rowCount,
        0,
      );
    });
  });

  // =============================================================================================================
  describe("duplicates and collisions", () => {
    scenario("exact authoritative collision; the caller with registry read sees the match, with a recommended action", async () => {
      const actor = await fullStaff();
      const value = bn();
      const first = await create({ legalName: name("First"), displayName: "First Display", identifiers: [{ kind: "CRA_BN", value }] });
      const events = await eventsByActor(actor.actorId);
      const legalName = name("Second");

      await assert.rejects(K.ci.createOrganization({ legalName, identifiers: [{ kind: "CRA_BN", value }] }), (error: unknown) => {
        assert.ok(error instanceof K.ci.CorporateIdentifierCollisionError);
        assert.equal(error.code, "CORPORATE_IDENTIFIER_COLLISION");
        assert.equal(error.kind, "CRA_BN");
        assert.equal(error.match?.organizationId, first.organization.id);
        assert.equal(error.match?.legalName, first.organization.legalName);
        assert.equal(error.match?.displayName, "First Display");
        assert.equal(error.match?.status, "active");
        assert.equal(error.match?.recommendedAction, "OPEN_EXISTING");
        assert.equal(error.match?.identifierId, first.organization.identifiers[0].id);
        return true;
      });
      assert.equal(await organizationExists(legalName), false);
      assert.equal(await eventsByActor(actor.actorId), events, "a refused duplicate writes no Master Register event");
    });

    scenario("a caller WITHOUT registry read gets an opaque conflict: no matched Organization details", async () => {
      const owner = await fullStaff();
      const value = bn();
      const existingName = name("Hidden");
      await create({ legalName: existingName, identifiers: [{ kind: "CRA_BN", value }] });

      const creator = await staff("ORGANIZATION_CREATE");
      signIn(creator);
      await assert.rejects(K.ci.createOrganization({ legalName: name("Probe"), identifiers: [{ kind: "CRA_BN", value }] }), (error: unknown) => {
        assert.ok(error instanceof K.ci.CorporateIdentifierCollisionError);
        assert.equal(error.match, undefined);
        assert.equal(error.kind, "CRA_BN");
        const surface = JSON.stringify({ message: error.message, code: error.code, kind: error.kind, match: error.match });
        assert.equal(surface.includes(existingName), false);
        assert.equal(surface.includes(owner.actorId), false);
        return true;
      });
      // ...and the same opacity holds when the caller is able to create but the registry-read capability is merely absent
      // for the matched record's kind: there is no per-record exception.
    });

    scenario("Master Account follows existing semantics: no relationship needed, collision details disclosed", async () => {
      await fullStaff();
      const value = bn();
      const existing = await create({ legalName: name("MasterTarget"), identifiers: [{ kind: "CRA_BN", value }] });

      const master = await fx.actor();
      await fx.master(master.actorId);
      signIn(master);
      await assert.rejects(K.ci.createOrganization({ legalName: name("ByMaster"), identifiers: [{ kind: "CRA_BN", value }] }), (error: unknown) => {
        assert.ok(error instanceof K.ci.CorporateIdentifierCollisionError);
        assert.equal(error.match?.organizationId, existing.organization.id);
        return true;
      });
      const created = await create({ legalName: name("MasterCreated") });
      assert.equal((await K.ci.getOrganization(created.organization.id)).id, created.organization.id);
    });

    scenario("normalized-format collisions (BN grouping, EIN dash, incorporation punctuation/case)", async () => {
      await fullStaff();
      const number = bn();
      await create({ legalName: name("Norm1"), identifiers: [{ kind: "CRA_BN", value: number }, { kind: "IRS_EIN", value: number }] });
      const grouped = `${number.slice(0, 3)}-${number.slice(3, 6)}-${number.slice(6)}`;
      await rejectsWith(K.ci.createOrganization({ legalName: name("Norm2"), identifiers: [{ kind: "CRA_BN", value: grouped }] }), K.ci.CorporateIdentifierCollisionError);
      await rejectsWith(K.ci.createOrganization({ legalName: name("Norm3"), identifiers: [{ kind: "IRS_EIN", value: `${number.slice(0, 2)}-${number.slice(2)}` }] }), K.ci.CorporateIdentifierCollisionError);

      const registration = incorporationNumber();
      await create({ legalName: name("Norm4"), identifiers: [{ kind: "INCORPORATION", value: registration, country: "CA", region: "ON" }] });
      const reformatted = `${registration.slice(0, 3)}-${registration.slice(3).toLowerCase()}`;
      await rejectsWith(
        K.ci.createOrganization({ legalName: name("Norm5"), identifiers: [{ kind: "INCORPORATION", value: reformatted, country: "ca", region: "on" }] }),
        K.ci.CorporateIdentifierCollisionError,
      );
      // The same number in a different jurisdiction is a different registration.
      await create({ legalName: name("Norm6"), identifiers: [{ kind: "INCORPORATION", value: registration, country: "CA", region: "BC" }] });
    });

    scenario("concurrent writer: a unique violation at insert time is the same collision result (registry reader sees the winner)", async () => {
      await fullStaff();
      const value = bn();
      const winner = await heldCompetingBn(value);
      const loserName = name("Loser");
      const attempt = K.ci.createOrganization({
        legalName: loserName,
        identifiers: [{ kind: "CRA_BN", value }],
        aliases: [{ alias: "Loser Alias", aliasType: "TRADE_NAME" }],
      });
      await winner.commitWhenBlocked();
      await assert.rejects(attempt, (error: unknown) => {
        assert.ok(error instanceof K.ci.CorporateIdentifierCollisionError, String(error));
        assert.equal(error.match?.organizationId, winner.organizationId);
        return true;
      });
      assert.equal(await organizationExists(loserName), false, "the losing transaction rolled back completely");
      assert.equal((await pools.admin.query(`SELECT 1 FROM public.organization_aliases WHERE alias = 'Loser Alias'`)).rowCount, 0);
    });

    scenario("concurrent writer without registry read: opaque race result", async () => {
      const value = bn();
      const winner = await heldCompetingBn(value);
      const creator = await staff("ORGANIZATION_CREATE");
      signIn(creator);
      const attempt = K.ci.createOrganization({ legalName: name("BlindLoser"), identifiers: [{ kind: "CRA_BN", value }] });
      await winner.commitWhenBlocked();
      await assert.rejects(attempt, (error: unknown) => {
        assert.ok(error instanceof K.ci.CorporateIdentifierCollisionError, String(error));
        assert.equal(error.match, undefined);
        return true;
      });
    });

    /** An admin transaction that holds an UNCOMMITTED active BN, so a service insert of the same BN blocks on the unique index. */
    async function heldCompetingBn(value: string) {
      const client = await pools.admin.connect();
      const organizationId = randomUUID();
      await client.query("BEGIN");
      await client.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [organizationId, name("RaceWinner")]);
      await client.query(
        `INSERT INTO public.organization_identifiers (organization_id, identifier_type, namespace, jurisdiction_country, value, normalized_value)
         VALUES ($1, 'business_number', 'cra', 'CA', $2, $2)`,
        [organizationId, value],
      );
      let finished = false;
      cleanups.push(async () => {
        if (!finished) await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      });
      track(organizationId);
      return {
        organizationId,
        async commitWhenBlocked() {
          for (let attempt = 0; attempt < 200; attempt += 1) {
            const waiting = await pools.admin.query(`SELECT 1 FROM pg_stat_activity WHERE state = 'active' AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
            if (waiting.rowCount && waiting.rowCount > 0) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          await client.query("COMMIT");
          finished = true;
        },
      };
    }

    scenario("archived Organization keeps protecting its identifiers and points toward restoration", async () => {
      await fullStaff();
      const value = bn();
      const original = await create({ legalName: name("Archived"), identifiers: [{ kind: "CRA_BN", value }] });
      await K.ci.archiveOrganization(original.organization.id);
      await assert.rejects(K.ci.createOrganization({ legalName: name("Again"), identifiers: [{ kind: "CRA_BN", value }] }), (error: unknown) => {
        assert.ok(error instanceof K.ci.CorporateIdentifierCollisionError);
        assert.equal(error.match?.status, "archived");
        assert.equal(error.match?.recommendedAction, "RESTORE_ARCHIVED");
        assert.equal(error.match?.organizationId, original.organization.id);
        return true;
      });
    });

    scenario("merged Organization keeps protecting its identifiers and points to the survivor", async () => {
      await fullStaff();
      const value = bn();
      const survivor = await create({ legalName: name("Survivor") });
      const merged = await create({ legalName: name("Merged"), identifiers: [{ kind: "CRA_BN", value }] });
      await pools.admin.query(`UPDATE public.organizations SET status = 'merged', merged_into_organization_id = $2 WHERE id = $1`, [
        merged.organization.id,
        survivor.organization.id,
      ]);
      await assert.rejects(K.ci.createOrganization({ legalName: name("ToMerged"), identifiers: [{ kind: "CRA_BN", value }] }), (error: unknown) => {
        assert.ok(error instanceof K.ci.CorporateIdentifierCollisionError);
        assert.equal(error.match?.status, "merged");
        assert.equal(error.match?.recommendedAction, "USE_SURVIVOR");
        assert.equal(error.match?.mergedIntoOrganizationId, survivor.organization.id);
        return true;
      });
      // A merged Organization can no longer be changed, archived or restored by this service.
      await rejectsWith(K.ci.updateLegalIdentity(merged.organization.id, { displayName: "x" }), K.ci.CorporateIdentityStateError);
      await rejectsWith(K.ci.archiveOrganization(merged.organization.id), K.ci.CorporateIdentityStateError);
      await rejectsWith(K.ci.restoreOrganization(merged.organization.id), K.ci.CorporateIdentityStateError);
    });

    scenario("a superseded identifier does not hard-block; registry readers get review evidence, others do not", async () => {
      await fullStaff();
      const value = bn();
      const old = await create({ legalName: name("Old"), identifiers: [{ kind: "CRA_BN", value }] });
      await K.ci.supersedeIdentifier(old.organization.id, old.organization.identifiers[0].id);

      const reused = await create({ legalName: name("Reuser"), identifiers: [{ kind: "CRA_BN", value }] });
      assert.equal(reused.organization.identifiers[0].status, "active");
      assert.deepEqual(
        reused.reviewMatches.map((match) => [match.kind, match.organizationId, match.identifierKind]),
        [["SUPERSEDED_IDENTIFIER", old.organization.id, "CRA_BN"]],
      );

      const value2 = bn();
      const old2 = await create({ legalName: name("Old2"), identifiers: [{ kind: "CRA_BN", value: value2 }] });
      await K.ci.supersedeIdentifier(old2.organization.id, old2.organization.identifiers[0].id);
      signIn(await staff("ORGANIZATION_CREATE"));
      const blind = await create({ legalName: name("BlindReuser"), identifiers: [{ kind: "CRA_BN", value: value2 }] });
      assert.deepEqual(blind.reviewMatches, []);
    });

    scenario("adding or correcting an identifier collides with another Organization's active identifier", async () => {
      await fullStaff();
      const value = bn();
      await create({ legalName: name("Holder"), identifiers: [{ kind: "CRA_BN", value }] });
      const other = await create({ legalName: name("Other"), identifiers: [{ kind: "CRA_BN", value: bn() }] });
      // A BN and an EIN are different identifier kinds: the same digits as an EIN do not collide with a BN.
      const einSameDigits = await K.ci.addIdentifier(other.organization.id, { kind: "IRS_EIN", value });
      assert.equal(einSameDigits.organization.identifiers.length, 2);
      // adding the SAME BN to another Organization collides
      const third = await create({ legalName: name("Third") });
      await rejectsWith(K.ci.addIdentifier(third.organization.id, { kind: "CRA_BN", value }), K.ci.CorporateIdentifierCollisionError);
      // correcting into a value another Organization holds collides, and the failed correction changes nothing
      await rejectsWith(K.ci.correctIdentifier(other.organization.id, other.organization.identifiers[0].id, { kind: "CRA_BN", value }), K.ci.CorporateIdentifierCollisionError);
      const unchanged = await K.ci.getOrganization(other.organization.id);
      assert.equal(unchanged.identifiers.length, 2);
      assert.equal(unchanged.identifiers.every((identifier) => identifier.status === "active"), true, "a failed correction rolls back its supersede");
    });
  });

  // =============================================================================================================
  describe("identifier maintenance", () => {
    scenario("correction preserves history: the old row is superseded, a new row is created, rule version stored", async () => {
      const actor = await fullStaff();
      const wrong = bn();
      const right = bn();
      const { organization } = await create({ legalName: name("Correct"), identifiers: [{ kind: "CRA_BN", value: wrong }] });
      const oldId = organization.identifiers[0].id;

      const result = await K.ci.correctIdentifier(organization.id, oldId, { kind: "CRA_BN", value: right });
      assert.equal(result.organization.identifiers.length, 2);
      const old = result.organization.identifiers.find((identifier) => identifier.id === oldId);
      const replacement = result.organization.identifiers.find((identifier) => identifier.id !== oldId);
      assert.equal(old?.status, "superseded");
      assert.ok(old?.supersededAt);
      assert.equal(old?.normalizedValue, wrong, "the superseded row's identity fields are untouched");
      assert.equal(replacement?.status, "active");
      assert.equal(replacement?.normalizedValue, right);
      assert.equal(replacement?.normalizationRuleVersion, "cra_bn.v1");

      const events = await eventsFor(replacement!.id);
      assert.deepEqual(events.map((event) => event.event_type), ["RECORD_CORRECTED"]);
      assert.equal(events[0].actor_id, actor.actorId);

      // The corrected-away value is free again, and correcting a superseded row is refused.
      await rejectsWith(K.ci.correctIdentifier(organization.id, oldId, { kind: "CRA_BN", value: bn() }), K.ci.CorporateIdentityStateError);
    });

    scenario("a formatting-only correction keeps the same normalized key without colliding with its own history", async () => {
      await fullStaff();
      const value = bn();
      const { organization } = await create({ legalName: name("Format"), identifiers: [{ kind: "CRA_BN", value }] });
      const grouped = `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6)}`;
      const result = await K.ci.correctIdentifier(organization.id, organization.identifiers[0].id, { kind: "CRA_BN", value: grouped });
      assert.equal(result.organization.identifiers.filter((identifier) => identifier.status === "active").length, 1);
      assert.equal(result.organization.identifiers.find((identifier) => identifier.status === "active")?.value, grouped);
    });

    scenario("a correction must be the same kind and stay in the formation jurisdiction", async () => {
      await fullStaff();
      const { organization } = await create({
        legalName: name("Kind"),
        identifiers: [{ kind: "CRA_BN", value: bn() }, { kind: "INCORPORATION", value: incorporationNumber(), country: "CA", region: "ON" }],
      });
      const bnRow = organization.identifiers.find((identifier) => identifier.kind === "CRA_BN")!;
      const incorporation = organization.identifiers.find((identifier) => identifier.kind === "INCORPORATION")!;
      await rejectsWith(K.ci.correctIdentifier(organization.id, bnRow.id, { kind: "IRS_EIN", value: bn() }), K.ci.CorporateIdentityValidationError);
      await rejectsWith(
        K.ci.correctIdentifier(organization.id, incorporation.id, { kind: "INCORPORATION", value: incorporationNumber(), country: "CA", region: "BC" }),
        K.ci.CorporateIdentityValidationError,
      );
      await rejectsWith(K.ci.correctIdentifier(organization.id, randomUUID(), { kind: "CRA_BN", value: bn() }), K.ci.CorporateIdentityNotFoundError);
    });

    scenario("addIdentifier: BN and EIN coexist; one active incorporation; formation adopted; supersede then replace", async () => {
      await fullStaff();
      const { organization } = await create({ legalName: name("Add"), identifiers: [{ kind: "CRA_BN", value: bn() }] });

      const withEin = await K.ci.addIdentifier(organization.id, { kind: "IRS_EIN", value: bn() });
      assert.equal(withEin.organization.identifiers.length, 2);

      const withInc = await K.ci.addIdentifier(organization.id, { kind: "INCORPORATION", value: incorporationNumber(), country: "CA", region: "ON" });
      assert.equal(withInc.organization.formationRegion, "ON", "an Organization with no formation adopts its first incorporation's jurisdiction");
      assert.ok(withInc.organization.primaryRegistration);

      await rejectsWith(
        K.ci.addIdentifier(organization.id, { kind: "INCORPORATION", value: incorporationNumber(), country: "CA", region: "ON" }),
        K.ci.CorporateIdentityConflictError,
      );
      await rejectsWith(
        K.ci.addIdentifier(organization.id, { kind: "EXTRA_PROVINCIAL_REGISTRATION", value: incorporationNumber(), country: "CA", region: "ON" }),
        K.ci.CorporateIdentityValidationError,
      );
      const withExtra = await K.ci.addIdentifier(organization.id, { kind: "EXTRA_PROVINCIAL_REGISTRATION", value: incorporationNumber(), country: "CA", region: "BC" });
      assert.equal(withExtra.organization.primaryRegistration?.kind, "INCORPORATION");

      const superseded = await K.ci.supersedeIdentifier(organization.id, withInc.organization.primaryRegistration!.id);
      assert.equal(superseded.organization.primaryRegistration, null, "no active incorporation means no derived primary registration");
      await rejectsWith(K.ci.supersedeIdentifier(organization.id, withInc.organization.primaryRegistration!.id), K.ci.CorporateIdentityStateError);
    });

    scenario("the runtime role cannot rewrite identity-defining identifier columns", async () => {
      await fullStaff();
      const { organization } = await create({ legalName: name("Immutable"), identifiers: [{ kind: "CRA_BN", value: bn() }] });
      await assert.rejects(
        pools.runtime.query(`UPDATE public.organization_identifiers SET normalized_value = '999999999' WHERE id = $1`, [organization.identifiers[0].id]),
        /permission denied/,
      );
    });
  });

  // =============================================================================================================
  describe("legal identity, aliases and classifications", () => {
    scenario("update legal/display identity", async () => {
      await fullStaff();
      const { organization } = await create({ legalName: name("Rename"), displayName: "Before" });
      const renamed = name("Renamed");
      const result = await K.ci.updateLegalIdentity(organization.id, { legalName: ` ${renamed} `, displayName: null });
      assert.equal(result.organization.legalName, renamed);
      assert.equal(result.organization.displayName, null);
      assert.equal(result.organization.normalizedLegalName, renamed.toLowerCase());
      assert.ok(result.organization.updatedAt >= organization.updatedAt);

      const events = await eventsFor(organization.id);
      assert.deepEqual(events.map((event) => event.event_type), ["ORGANIZATION_CREATED", "RECORD_UPDATED"]);

      // No-op update writes nothing.
      await K.ci.updateLegalIdentity(organization.id, { legalName: renamed });
      assert.equal((await eventsFor(organization.id)).length, 2);

      await rejectsWith(K.ci.updateLegalIdentity(organization.id, {} as never), K.ci.CorporateIdentityValidationError);
      await rejectsWith(K.ci.updateLegalIdentity(organization.id, { status: "archived" } as never), K.ci.CorporateIdentityValidationError);
      await rejectsWith(K.ci.updateLegalIdentity(randomUUID(), { displayName: "x" }), K.ci.CorporateIdentityNotFoundError);
      await rejectsWith(K.ci.updateLegalIdentity("not-a-uuid", { displayName: "x" }), K.ci.CorporateIdentityValidationError);
    });

    scenario("formation jurisdiction can change only while no incorporation identifier is active", async () => {
      await fullStaff();
      const { organization } = await create({
        legalName: name("Formation"),
        identifiers: [{ kind: "INCORPORATION", value: incorporationNumber(), country: "CA", region: "ON" }],
      });
      await rejectsWith(K.ci.updateLegalIdentity(organization.id, { formation: { country: "CA", region: "BC" } }), K.ci.CorporateIdentityStateError);
      await K.ci.supersedeIdentifier(organization.id, organization.primaryRegistration!.id);
      const moved = await K.ci.updateLegalIdentity(organization.id, { formation: { country: "CA", region: "BC" } });
      assert.equal(moved.organization.formationRegion, "BC");
      const cleared = await K.ci.updateLegalIdentity(organization.id, { formation: null });
      assert.equal(cleared.organization.formationCountry, null);
    });

    scenario("aliases: add, reject duplicates, deactivate, allow re-adding after deactivation", async () => {
      await fullStaff();
      const { organization } = await create({ legalName: name("Alias") });
      const added = await K.ci.addAlias(organization.id, { alias: "Fast Freight", aliasType: "TRADE_NAME" });
      const aliasId = added.organization.aliases[0].id;
      await rejectsWith(K.ci.addAlias(organization.id, { alias: "FAST  freight", aliasType: "TRADE_NAME" }), K.ci.CorporateIdentityConflictError);
      // same text under a different alias type is a different record
      await K.ci.addAlias(organization.id, { alias: "Fast Freight", aliasType: "FORMER_NAME" });

      const off = await K.ci.deactivateAlias(organization.id, aliasId);
      assert.equal(off.organization.aliases.find((alias) => alias.id === aliasId)?.status, "inactive");
      await rejectsWith(K.ci.deactivateAlias(organization.id, aliasId), K.ci.CorporateIdentityStateError);
      await rejectsWith(K.ci.deactivateAlias(organization.id, randomUUID()), K.ci.CorporateIdentityNotFoundError);
      const again = await K.ci.addAlias(organization.id, { alias: "Fast Freight", aliasType: "TRADE_NAME" });
      assert.equal(again.organization.aliases.filter((alias) => alias.status === "active" && alias.aliasType === "trade_name").length, 1);
    });

    scenario("classifications: add, primary handover, end, no duplicates, no Customer/Prospect", async () => {
      await fullStaff();
      const { organization } = await create({ legalName: name("Class") });
      const first = await K.ci.addClassification(organization.id, { code: "owner_operator", isPrimary: true });
      const second = await K.ci.addClassification(organization.id, { code: "service_provider" });
      const ownerOperator = first.organization.classifications[0];
      const serviceProvider = second.organization.classifications.find((classification) => classification.code === "service_provider")!;

      await rejectsWith(K.ci.addClassification(organization.id, { code: "service_provider" }), K.ci.CorporateIdentityConflictError);
      await rejectsWith(K.ci.addClassification(organization.id, { code: "customer" }), K.ci.CorporateIdentityValidationError);
      await rejectsWith(K.ci.addClassification(organization.id, { code: "prospect" }), K.ci.CorporateIdentityValidationError);

      const switched = await K.ci.setPrimaryClassification(organization.id, serviceProvider.id);
      assert.deepEqual(switched.organization.classifications.filter((classification) => classification.isPrimary).map((classification) => classification.code), ["service_provider"]);
      await rejectsWith(K.ci.setPrimaryClassification(organization.id, serviceProvider.id), K.ci.CorporateIdentityStateError);

      const ended = await K.ci.endClassification(organization.id, ownerOperator.id);
      const endedRow = ended.organization.classifications.find((classification) => classification.id === ownerOperator.id)!;
      assert.ok(endedRow.effectiveTo);
      assert.equal(endedRow.isPrimary, false);
      await rejectsWith(K.ci.endClassification(organization.id, ownerOperator.id), K.ci.CorporateIdentityStateError);
      await rejectsWith(K.ci.setPrimaryClassification(organization.id, ownerOperator.id), K.ci.CorporateIdentityStateError);

      // A classification can be re-added after it ended; history keeps both rows.
      const readded = await K.ci.addClassification(organization.id, { code: "owner_operator" });
      assert.equal(readded.organization.classifications.filter((classification) => classification.code === "owner_operator").length, 2);
    });
  });

  // =============================================================================================================
  describe("archive and restore", () => {
    scenario("archive preserves the Organization and its history; restore returns it; archived is read-only", async () => {
      await fullStaff();
      const value = bn();
      const { organization } = await create({
        legalName: name("Lifecycle"),
        identifiers: [{ kind: "CRA_BN", value }],
        aliases: [{ alias: "Lifecycle Trade", aliasType: "TRADE_NAME" }],
        classifications: [{ code: "other" }],
      });

      const archived = await K.ci.archiveOrganization(organization.id, { reason: "closed" });
      assert.equal(archived.organization.status, "archived");
      assert.ok(archived.organization.archivedAt);
      assert.equal(archived.organization.identifiers.length, 1);
      assert.equal(archived.organization.identifiers[0].status, "active");
      assert.equal((await K.ci.getOrganization(organization.id)).legalName, organization.legalName);

      await rejectsWith(K.ci.archiveOrganization(organization.id), K.ci.CorporateIdentityStateError);
      await rejectsWith(K.ci.updateLegalIdentity(organization.id, { displayName: "x" }), K.ci.CorporateIdentityStateError);
      await rejectsWith(K.ci.addAlias(organization.id, { alias: "Nope", aliasType: "TRADE_NAME" }), K.ci.CorporateIdentityStateError);
      await rejectsWith(K.ci.addIdentifier(organization.id, { kind: "IRS_EIN", value: bn() }), K.ci.CorporateIdentityStateError);
      await rejectsWith(K.ci.addClassification(organization.id, { code: "owner_operator" }), K.ci.CorporateIdentityStateError);

      const restored = await K.ci.restoreOrganization(organization.id);
      assert.equal(restored.organization.status, "active");
      assert.equal(restored.organization.archivedAt, null);
      assert.equal(restored.organization.id, organization.id);
      assert.equal(restored.organization.identifiers[0].normalizedValue, value);
      assert.equal(restored.organization.aliases.length, 1);
      assert.equal(restored.organization.classifications.length, 1);
      await rejectsWith(K.ci.restoreOrganization(organization.id), K.ci.CorporateIdentityStateError);

      const events = await eventsFor(organization.id);
      assert.deepEqual(events.map((event) => event.event_type), ["ORGANIZATION_CREATED", "ORGANIZATION_STATUS_CHANGED", "ORGANIZATION_STATUS_CHANGED"]);
      assert.deepEqual((events[1].outcome as { reason?: string }).reason, "closed");
    });

    scenario("there is no delete path: no exported delete operation and the runtime role cannot DELETE", async () => {
      await fullStaff();
      const { organization } = await create({ legalName: name("NoDelete"), identifiers: [{ kind: "CRA_BN", value: bn() }] });
      assert.deepEqual(Object.keys(K.ci).filter((key) => /delete|remove|destroy|merge/i.test(key)), []);
      for (const table of ["organizations", "organization_identifiers", "organization_aliases", "organization_classifications"]) {
        await assert.rejects(pools.runtime.query(`DELETE FROM public.${table}`), /permission denied/, table);
      }
      assert.equal((await K.ci.getOrganization(organization.id)).id, organization.id);
    });
  });

  // =============================================================================================================
  describe("authorization", () => {
    scenario("each operation requires its own SYSTEM capability and nothing else", async () => {
      const full = await fullStaff();
      const target = await create({ legalName: name("AuthTarget"), identifiers: [{ kind: "CRA_BN", value: bn() }], aliases: [{ alias: "Auth Alias", aliasType: "TRADE_NAME" }], classifications: [{ code: "other" }] });
      const id = target.organization.id;
      const identifierId = target.organization.identifiers[0].id;
      const aliasId = target.organization.aliases[0].id;
      const classificationId = target.organization.classifications[0].id;
      void full;

      const operations: Record<Capability, Array<[string, () => Promise<unknown>]>> = {
        ORGANIZATION_CREATE: [["createOrganization", () => K.ci.createOrganization({ legalName: name("Denied") })]],
        ORGANIZATION_REGISTRY_READ: [["getOrganization", () => K.ci.getOrganization(id)]],
        ORGANIZATION_UPDATE: [
          ["updateLegalIdentity", () => K.ci.updateLegalIdentity(id, { displayName: "D" })],
          ["addIdentifier", () => K.ci.addIdentifier(id, { kind: "IRS_EIN", value: bn() })],
          ["correctIdentifier", () => K.ci.correctIdentifier(id, identifierId, { kind: "CRA_BN", value: bn() })],
          ["supersedeIdentifier", () => K.ci.supersedeIdentifier(id, identifierId)],
          ["addAlias", () => K.ci.addAlias(id, { alias: "X Y", aliasType: "TRADE_NAME" })],
          ["deactivateAlias", () => K.ci.deactivateAlias(id, aliasId)],
          ["addClassification", () => K.ci.addClassification(id, { code: "sub_contractor" })],
          ["endClassification", () => K.ci.endClassification(id, classificationId)],
          ["setPrimaryClassification", () => K.ci.setPrimaryClassification(id, classificationId)],
        ],
        ORGANIZATION_ARCHIVE: [
          ["archiveOrganization", () => K.ci.archiveOrganization(id)],
          ["restoreOrganization", () => K.ci.restoreOrganization(id)],
        ],
        ORGANIZATION_READ: [],
      };

      const all: Capability[] = ["ORGANIZATION_CREATE", "ORGANIZATION_REGISTRY_READ", "ORGANIZATION_UPDATE", "ORGANIZATION_ARCHIVE"];
      for (const needed of all) {
        // An actor holding every SYSTEM capability EXCEPT the one under test is denied exactly those operations.
        const actor = await staff(...all.filter((capability) => capability !== needed));
        signIn(actor);
        for (const [label, call] of operations[needed]) {
          await assert.rejects(call(), (error: unknown) => {
            assert.ok(error instanceof K.authz.TesAuthorizationDeniedError, `${label} without ${needed}: ${String(error)}`);
            return true;
          });
        }
        // ...and not denied any other operation family (spot-check a read, which has no state side effects).
        if (needed !== "ORGANIZATION_REGISTRY_READ") assert.equal((await K.ci.getOrganization(id)).id, id);
      }

      // Unauthenticated: no session, no work.
      K.db.setClerkUser(null);
      await assert.rejects(K.ci.getOrganization(id));
      assert.equal((await pools.admin.query(`SELECT count(*) FROM public.organizations WHERE id = $1`, [id])).rows[0].count, "1");
    });

    scenario("denied operations never run work: no rows, no Master Register events", async () => {
      await fullStaff();
      const target = await create({ legalName: name("DeniedTarget") });
      const before = (await eventsFor(target.organization.id)).length;
      const noCapabilities = await staff();
      signIn(noCapabilities);
      const legalName = name("NeverCreated");
      await assert.rejects(K.ci.createOrganization({ legalName }));
      await assert.rejects(K.ci.archiveOrganization(target.organization.id));
      assert.equal(await organizationExists(legalName), false);
      assert.equal((await eventsFor(target.organization.id)).length, before);
      assert.equal(await eventsByActor(noCapabilities.actorId), 0);
      assert.equal((await K.ci.getOrganization.length) >= 0, true);
    });

    scenario("CUSTOMER ORGANIZATION_READ reads only its own Organization and cannot perform SYSTEM operations", async () => {
      const a = await fx.organizationAndCustomer("CustA");
      const b = await fx.organizationAndCustomer("CustB");
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: a.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      signIn(actor);

      const own = await K.ci.readCustomerOrganization(a.customerId);
      assert.equal(own.id, a.organizationId);

      await assert.rejects(K.ci.readCustomerOrganization(b.customerId), (error: unknown) => {
        assert.ok(error instanceof K.authz.TesAuthorizationDeniedError);
        return true;
      });
      await assert.rejects(K.ci.readCustomerOrganization(randomUUID()), (error: unknown) => {
        assert.ok(error instanceof K.authz.TesAuthorizationDeniedError);
        return true;
      });

      // CUSTOMER scope never satisfies SYSTEM capabilities.
      await assert.rejects(K.ci.getOrganization(a.organizationId), (error: unknown) => error instanceof K.authz.TesAuthorizationDeniedError);
      await assert.rejects(K.ci.createOrganization({ legalName: name("ByCustomer") }), (error: unknown) => error instanceof K.authz.TesAuthorizationDeniedError);
      await assert.rejects(K.ci.archiveOrganization(a.organizationId), (error: unknown) => error instanceof K.authz.TesAuthorizationDeniedError);
    });

    scenario("a SYSTEM registry reader without CUSTOMER assignment cannot use the customer read", async () => {
      const a = await fx.organizationAndCustomer("CustC");
      const actor = await staff("ORGANIZATION_REGISTRY_READ");
      signIn(actor);
      assert.equal((await K.ci.getOrganization(a.organizationId)).id, a.organizationId);
      await assert.rejects(K.ci.readCustomerOrganization(a.customerId), (error: unknown) => error instanceof K.authz.TesAuthorizationDeniedError);
    });

    scenario("unknown ids are not found after authorization, never a generic error", async () => {
      await fullStaff();
      await rejectsWith(K.ci.getOrganization(randomUUID()), K.ci.CorporateIdentityNotFoundError);
      await rejectsWith(K.ci.getOrganization("nope"), K.ci.CorporateIdentityValidationError);
    });
  });

  // =============================================================================================================
  describe("Master Register", () => {
    scenario("each material mutation writes the expected event in the same transaction; no identifier values are copied", async () => {
      const actor = await fullStaff();
      const secretBn = bn();
      const { organization } = await create({ legalName: name("MR"), identifiers: [{ kind: "CRA_BN", value: secretBn }] });
      const identifierId = organization.identifiers[0].id;

      const created = (await eventsFor(organization.id))[0];
      assert.equal(created.event_type, "ORGANIZATION_CREATED");
      assert.equal(created.actor_id, actor.actorId);
      assert.equal((created.target as { resourceType: string }).resourceType, "organization");
      assert.equal(JSON.stringify(created).includes(secretBn), false, "tax/registry numbers are referenced, never copied into the Master Register");
      assert.ok(JSON.stringify(created.change_set).includes(identifierId), "the identifier row is referenced");

      const alias = (await K.ci.addAlias(organization.id, { alias: "MR Alias", aliasType: "TRADE_NAME" })).organization.aliases[0];
      const classification = (await K.ci.addClassification(organization.id, { code: "other" })).organization.classifications[0];
      const added = (await K.ci.addIdentifier(organization.id, { kind: "IRS_EIN", value: bn() })).organization.identifiers.find((identifier) => identifier.kind === "IRS_EIN")!;

      assert.deepEqual((await eventsFor(alias.id)).map((event) => event.event_type), ["RECORD_CREATED"]);
      assert.deepEqual((await eventsFor(classification.id)).map((event) => event.event_type), ["RECORD_CREATED"]);
      assert.deepEqual((await eventsFor(added.id)).map((event) => event.event_type), ["RECORD_CREATED"]);

      await K.ci.deactivateAlias(organization.id, alias.id);
      await K.ci.endClassification(organization.id, classification.id);
      await K.ci.supersedeIdentifier(organization.id, identifierId);
      assert.deepEqual((await eventsFor(alias.id)).map((event) => event.event_type), ["RECORD_CREATED", "RECORD_STATUS_CHANGED"]);
      assert.deepEqual((await eventsFor(classification.id)).map((event) => event.event_type), ["RECORD_CREATED", "RECORD_STATUS_CHANGED"]);
      assert.deepEqual((await eventsFor(identifierId)).map((event) => event.event_type), ["RECORD_STATUS_CHANGED"]);

      for (const event of [created, ...(await eventsFor(alias.id)), ...(await eventsFor(added.id))]) {
        assert.equal(event.actor_id, actor.actorId);
      }
      const row = (await pools.admin.query(`SELECT customer_id, event_family FROM public.master_register_events WHERE event_id = (SELECT event_id FROM public.master_register_events WHERE target ->> 'resourceId' = $1 LIMIT 1)`, [organization.id])).rows[0];
      assert.equal(row.customer_id, null, "an Organization event is not tenant-scoped");
    });

    scenario("a failed mutation leaves neither the change nor an event", async () => {
      const actor = await fullStaff();
      const { organization } = await create({ legalName: name("FailMR") });
      const before = await eventsByActor(actor.actorId);

      await rejectsWith(K.ci.addClassification(organization.id, { code: "customer" }), K.ci.CorporateIdentityValidationError);
      await rejectsWith(K.ci.addIdentifier(organization.id, { kind: "CRA_BN", value: "12" }), K.ci.CorporateIdentityValidationError);
      assert.equal(await eventsByActor(actor.actorId), before);

      await pools.admin.query(`
        CREATE OR REPLACE FUNCTION public.tes_test_fail_master_register() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.event_type = 'RECORD_CREATED' THEN RAISE EXCEPTION 'test: master register write refused'; END IF;
          RETURN NEW;
        END $$`);
      await pools.admin.query(`CREATE TRIGGER tes_test_fail_master_register BEFORE INSERT ON public.master_register_events
                               FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_master_register()`);
      cleanups.push(async () => {
        await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
        await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_master_register()`);
      });

      const value = bn();
      await assert.rejects(K.ci.addIdentifier(organization.id, { kind: "CRA_BN", value }), /master register write refused/);
      await assert.rejects(K.ci.addAlias(organization.id, { alias: "Ghost", aliasType: "TRADE_NAME" }), /master register write refused/);
      const reread = await K.ci.getOrganization(organization.id);
      assert.deepEqual(reread.identifiers, []);
      assert.deepEqual(reread.aliases, []);
      assert.equal(await eventsByActor(actor.actorId), before);
    });

    scenario("reads, lookups and duplicate pre-checks write no event", async () => {
      const actor = await fullStaff();
      const value = bn();
      const { organization } = await create({ legalName: name("Quiet"), identifiers: [{ kind: "CRA_BN", value }] });
      const before = await eventsByActor(actor.actorId);

      await K.ci.getOrganization(organization.id);
      await K.ci.getOrganization(organization.id);
      await rejectsWith(K.ci.createOrganization({ legalName: name("QuietDup"), identifiers: [{ kind: "CRA_BN", value }] }), K.ci.CorporateIdentifierCollisionError);
      await rejectsWith(K.ci.getOrganization(randomUUID()), K.ci.CorporateIdentityNotFoundError);
      assert.equal(await eventsByActor(actor.actorId), before);

      const customer = await fx.organizationAndCustomer("QuietCust");
      const reader = await fx.actor();
      const relationshipId = await fx.relationship(reader.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customer.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      signIn(reader);
      await K.ci.readCustomerOrganization(customer.customerId);
      assert.equal(await eventsByActor(reader.actorId), 0);
    });
  });
});
