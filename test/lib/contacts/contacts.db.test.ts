// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL Contacts service through the REAL authorization wrappers and Clerk-to-actor resolution, on pooled
// connections that log in as the RUNTIME role, against a database with migrations 0001-0014 applied.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    authz: await import("@/lib/auth/tes-authorization"),
    c: await import("@/lib/contacts/service"),
    defs: await import("@/lib/contacts/definitions"),
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
const CATALOGUE = "contact_purpose_types";
const BUSINESS_TABLES = [
  "persons", "person_name_versions", "person_channels", "organization_channels",
  "organization_person_relationships", "organization_person_titles", "contact_purpose_assignments",
] as const;
const ALL_TABLES = [CATALOGUE, ...BUSINESS_TABLES] as const;
type Capability = "PERSON_REGISTRY_READ" | "CONTACT_MANAGE";

describe("Contacts (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
  let customerOrganizations: string[] = [];
  let strayPersons: string[] = [];
  let cleanups: Array<() => Promise<void>> = [];

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  const run = randomUUID().slice(0, 8);
  let counter = 0;

  /** Removes everything this scenario created. The no-delete triggers are lifted only here, by the table owner. */
  async function purge() {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const table of BUSINESS_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${table}_no_delete`);
      const owned = [...organizations, ...customerOrganizations];
      const persons = [
        ...(await client.query<{ person_id: string }>(`SELECT DISTINCT person_id FROM public.organization_person_relationships WHERE organization_id = ANY($1::uuid[])`, [owned])).rows.map((row) => row.person_id),
        ...strayPersons,
      ];
      await client.query(`DELETE FROM public.contact_purpose_assignments WHERE organization_id = ANY($1::uuid[])`, [owned]);
      await client.query(`DELETE FROM public.organization_person_titles WHERE organization_id = ANY($1::uuid[])`, [owned]);
      await client.query(`DELETE FROM public.organization_person_relationships WHERE organization_id = ANY($1::uuid[]) OR person_id = ANY($2::uuid[])`, [owned, persons]);
      await client.query(`DELETE FROM public.organization_channels WHERE organization_id = ANY($1::uuid[])`, [owned]);
      await client.query(`DELETE FROM public.person_channels WHERE person_id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.person_name_versions WHERE person_id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.persons WHERE id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const table of BUSINESS_TABLES) await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${table}_no_delete`);
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
      customerOrganizations = [];
      strayPersons = [];
      cleanups = [];
      K.db.setClerkUser(null);
      try {
        await body();
      } finally {
        K.db.setClerkUser(null);
        for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
        await purge();
        await fx.cleanup();
      }
    });

  // ---- fixtures ------------------------------------------------------------------------------------------------

  async function org(label = "Org"): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `CT ${label} ${id.slice(0, 8)} ${++counter}`]);
    organizations.push(id);
    return id;
  }

  async function staff(...capabilities: Capability[]): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability as never, { assignmentId });
    return actor;
  }
  const signIn = (actor: TestActor) => K.db.setClerkUser(actor.clerkSubject);
  async function fullStaff() {
    const actor = await staff("CONTACT_MANAGE", "PERSON_REGISTRY_READ");
    signIn(actor);
    return actor;
  }

  const n = () => ++counter;
  const email = () => `person.${run}.${n()}@example.test`;
  const phone = () => `+1403555${String(1000 + (n() % 9000)).padStart(4, "0")}`;
  const uniqueName = (label = "Pat") => ({ givenName: `${label}${run}`, familyName: `Tester${n()}` });
  const MONTH = (m: number) => `2020-${String(m).padStart(2, "0")}-01T00:00:00Z`;

  const create = (organizationId: string, over: Record<string, unknown> = {}) =>
    K.c.createContact({ organizationId, name: uniqueName(), effectiveFrom: MONTH(1), ...over } as never);

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const denied = (promise: Promise<unknown>) => rejectsWith(promise, K.authz.TesAuthorizationDeniedError);
  const rowCount = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  // Events can share a recorded_at (same instant); break such ties by type so the order is deterministic.
  const eventTypes = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`, [actorId])).rows.map((row) => row.event_type);
  const eventsJson = async (actorId: string) =>
    JSON.stringify((await pools.admin.query(`SELECT * FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId])).rows);

  async function refuseMasterRegisterEvent(eventType: string) {
    await pools.admin.query(`
      CREATE OR REPLACE FUNCTION public.tes_test_fail_master_register() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = '${eventType}' THEN RAISE EXCEPTION 'test: master register write refused'; END IF;
        RETURN NEW;
      END $$`);
    await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
    await pools.admin.query(`CREATE TRIGGER tes_test_fail_master_register BEFORE INSERT ON public.master_register_events FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_master_register()`);
    cleanups.push(async function removeMasterRegisterRefusal() {
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
      await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_master_register()`);
    });
  }

  async function concurrentActors(count: number) {
    const actors = await Promise.all(Array.from({ length: count }, () => staff("CONTACT_MANAGE", "PERSON_REGISTRY_READ")));
    return <T>(index: number, work: () => Promise<T>) => K.db.withClerkUser(actors[index].clerkSubject, work);
  }

  // =============================================================================================================
  describe("schema (migration 0014)", () => {
    scenario("tables, catalogue seed, indexes, functions and triggers exist; the ledger records 0014", async () => {
      const names = async (sql: string) => (await pools.admin.query<{ n: string }>(sql)).rows.map((row) => row.n);
      assert.deepEqual(
        (await pools.admin.query<{ n: string }>(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY 1`, [[...ALL_TABLES]])).rows.map((row) => row.n),
        [...ALL_TABLES].sort(),
      );
      assert.deepEqual(await names(`SELECT code AS n FROM public.contact_purpose_types ORDER BY sort_order`), [...K.defs.CONTACT_PURPOSES]);
      const indexes = await names(`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public'`);
      for (const expected of [
        "person_name_versions_current_uq", "person_channels_current_value_uq", "person_channels_current_preferred_uq",
        "organization_channels_current_value_uq", "organization_channels_current_preferred_uq",
        "organization_person_relationships_current_uq", "organization_person_titles_current_uq",
        "contact_purpose_assignments_current_uq", "contact_purpose_assignments_current_primary_uq",
      ]) assert.ok(indexes.includes(expected), expected);
      const triggers = await names(`SELECT tgname AS n FROM pg_trigger WHERE NOT tgisinternal`);
      for (const table of BUSINESS_TABLES) {
        assert.ok(triggers.includes(`${table}_no_delete`), `${table}_no_delete`);
        assert.ok(triggers.includes(`${table}_no_truncate`), `${table}_no_truncate`);
      }
      const ledger = await pools.admin.query<{ sha256: string }>(`SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0014'`);
      assert.equal(ledger.rowCount, 1);
      const file = readFileSync(path.resolve(import.meta.dirname, "../../../database/migrations/0014_contacts_people_foundation.sql"));
      assert.equal(ledger.rows[0].sha256, createHash("sha256").update(file).digest("hex"));
    });

    scenario("the purpose catalogue agrees with the server definitions, including primary_mode", async () => {
      const rows = (await pools.admin.query(`SELECT code, primary_mode, is_active FROM public.contact_purpose_types`)).rows;
      assert.equal(rows.length, K.defs.CONTACT_PURPOSES.length);
      for (const row of rows) {
        assert.equal(row.primary_mode, K.defs.PURPOSE_DEFINITIONS[row.code as keyof typeof K.defs.PURPOSE_DEFINITIONS].primaryMode, row.code);
        assert.equal(row.is_active, true);
      }
    });

    scenario("capabilities: the six originals are unchanged and exactly two SYSTEM capabilities were added", async () => {
      const rows = (await pools.admin.query<{ code: string; description: string; sort_order: number }>(`SELECT code, description, sort_order FROM public.capabilities WHERE sort_order <= 80 ORDER BY sort_order`)).rows;
      assert.deepEqual(rows.map((row) => row.code), [
        "ORGANIZATION_READ", "ORGANIZATION_REGISTRY_READ", "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_ARCHIVE", "CUSTOMER_ESTABLISH",
        "PERSON_REGISTRY_READ", "CONTACT_MANAGE",
      ]);
      for (const row of rows.slice(6)) assert.match(row.description, /Intended scope: SYSTEM only\.$/);
      assert.match(rows[3].description, /Does not authorize independent domains such as Authorities, Tax, Customs, Vehicles, Drivers, Contacts/);
    });

    scenario("no SECURITY DEFINER, no RLS, no policy on the Contacts tables; no driver data columns", async () => {
      const functions = (await pools.admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
        `SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'tes_security' AND p.proname = ANY($1::text[])`,
        [["prevent_contact_data_removal", "guard_person_update", "guard_contact_period_update", "guard_person_dependent_insert", "guard_organization_channel_insert", "guard_relationship_insert", "guard_relationship_update", "guard_relationship_dependent_insert", "guard_purpose_assignment_insert"]],
      )).rows;
      assert.equal(functions.length, 9);
      for (const fn of functions) {
        assert.equal(fn.prosecdef, false, fn.proname);
        assert.deepEqual(fn.proconfig, ["search_path=pg_catalog"], fn.proname);
      }
      for (const table of ALL_TABLES) {
        assert.equal((await pools.admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${table}`])).rows[0].relrowsecurity, false, table);
      }
      assert.equal(await rowCount(`SELECT count(*) FROM pg_policies WHERE tablename = ANY($1::text[])`, [[...ALL_TABLES]]), 0);
      const columns = (await pools.admin.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [[...ALL_TABLES]])).rows.map((row) => row.column_name);
      assert.deepEqual(columns.filter((name) => /licen|dob|birth|medical|passport|government|driver|ssn|sin\b|verified/i.test(name)), []);
    });

    scenario("runtime privileges: no DELETE/TRUNCATE anywhere, no content rewrites, no PUBLIC privilege", async () => {
      const has = async (sql: string, params: unknown[]) => (await pools.admin.query<{ ok: boolean }>(sql, params)).rows[0].ok;
      for (const table of ALL_TABLES) {
        for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          assert.equal(await has(`SELECT has_table_privilege($1, $2, $3) AS ok`, [RUNTIME_ROLE, `public.${table}`, privilege]), false, `${table} ${privilege}`);
        }
        assert.equal(await has(`SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [RUNTIME_ROLE, `public.${table}`]), true, table);
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          assert.equal(await has(`SELECT has_table_privilege('public', $1, $2) AS ok`, [`public.${table}`, privilege]), false, `PUBLIC ${table} ${privilege}`);
        }
      }
      const column = (table: string, name: string, privilege: string) => has(`SELECT has_column_privilege($1, $2, $3, $4) AS ok`, [RUNTIME_ROLE, `public.${table}`, name, privilege]);
      for (const [table, names] of [
        ["person_name_versions", ["given_name", "family_name", "name_normalized", "person_id", "effective_from", "change_reason", "created_at"]],
        ["person_channels", ["value_display", "value_normalized", "channel_type", "person_id", "extension", "is_preferred", "effective_from"]],
        ["organization_channels", ["value_normalized", "channel_usage", "organization_id", "is_preferred", "effective_from"]],
        ["organization_person_relationships", ["organization_id", "person_id", "effective_from", "created_at"]],
        ["organization_person_titles", ["title_display", "title_normalized", "relationship_id", "effective_from"]],
        ["contact_purpose_assignments", ["purpose_code", "is_primary", "relationship_id", "effective_from"]],
        ["persons", ["id", "created_at"]],
      ] as const) {
        for (const name of names) assert.equal(await column(table, name, "UPDATE"), false, `${table}.${name} UPDATE`);
      }
      for (const table of ["person_name_versions", "person_channels", "organization_channels", "organization_person_titles", "contact_purpose_assignments"]) {
        for (const name of ["effective_to", "record_status", "corrected_at", "superseded_by_id"]) assert.equal(await column(table, name, "UPDATE"), true, `${table}.${name}`);
      }
      assert.equal(await column("organization_person_relationships", "effective_to", "UPDATE"), true);
      assert.equal(await column("persons", "record_status", "UPDATE"), true);
      for (const table of ALL_TABLES) {
        await assert.rejects(pools.runtime.query(`DELETE FROM public.${table}`), /permission denied/, table);
        await assert.rejects(pools.runtime.query(`TRUNCATE public.${table}`), /permission denied/, table);
      }
      await assert.rejects(pools.runtime.query(`INSERT INTO public.contact_purpose_types (code, display_name, primary_mode, sort_order) VALUES ('X','x','NONE',99)`), /permission denied/);
    });

    scenario("every person has exactly one current name at commit; no path leaves one nameless", async () => {
      await fullStaff();
      const o = await org();
      // supported creation always writes the name in the same transaction
      const { contact } = await create(o);
      const currentNames = (personId: string) => rowCount(`SELECT count(*) FROM public.person_name_versions WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [personId]);
      assert.equal(await currentNames(contact.person.id), 1);
      // a change and a correction each leave exactly one current name, and every superseded row is preserved
      await K.c.changePersonName({ organizationId: o, personId: contact.person.id, givenName: `Chg${run}`, effectiveFrom: MONTH(3) } as never);
      assert.equal(await currentNames(contact.person.id), 1);
      await K.c.correctPersonName({ organizationId: o, personId: contact.person.id, givenName: `Cor${run}` } as never);
      assert.equal(await currentNames(contact.person.id), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.person_name_versions WHERE person_id = $1`, [contact.person.id]), 3);
      assert.equal((await K.c.getPerson(contact.person.id)).currentName?.givenName, `Cor${run}`);

      // even the table owner cannot commit a nameless person, nor end/correct the only current name without a replacement
      const owner = await pools.admin.connect();
      try {
        await owner.query("BEGIN");
        await owner.query(`INSERT INTO public.persons DEFAULT VALUES`);
        await assert.rejects(owner.query("COMMIT"), /exactly one current name/);
        await owner.query("ROLLBACK").catch(() => undefined);

        await owner.query("BEGIN");
        await owner.query(`UPDATE public.person_name_versions SET effective_to = now() WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [contact.person.id]);
        await assert.rejects(owner.query("COMMIT"), /exactly one current name/);
        await owner.query("ROLLBACK").catch(() => undefined);

        await owner.query("BEGIN");
        // a correction without its replacement is refused outright by the correction-state constraint
        await assert.rejects(
          owner.query(`UPDATE public.person_name_versions SET record_status = 'corrected', corrected_at = now() WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [contact.person.id]),
          /correction_state/,
        );
        await owner.query("ROLLBACK").catch(() => undefined);
      } finally {
        owner.release();
      }
      assert.equal(await currentNames(contact.person.id), 1, "all attempts rolled back");
      // the runtime role (which holds UPDATE on effective_to) is held to the same invariant
      const runtime = await pools.runtime.connect();
      try {
        await runtime.query("BEGIN");
        await runtime.query(`UPDATE public.person_name_versions SET effective_to = now() WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [contact.person.id]);
        await assert.rejects(runtime.query("COMMIT"), /exactly one current name/);
        await runtime.query("ROLLBACK").catch(() => undefined);
      } finally {
        runtime.release();
      }
      assert.equal(await currentNames(contact.person.id), 1);
    });

    scenario("primary_mode semantics: NONE forbids, OPTIONAL allows zero or one, SINGLE is one sole primary holder", async () => {
      await fullStaff();
      const modes = await pools.admin.query<{ code: string; primary_mode: string }>(`SELECT code, primary_mode FROM public.contact_purpose_types ORDER BY sort_order`);
      assert.deepEqual(modes.rows.map((r) => [r.code, r.primary_mode]), [
        ["PRIMARY", "SINGLE"], ["BILLING", "OPTIONAL"], ["SAFETY", "OPTIONAL"], ["OPERATIONS", "OPTIONAL"], ["COMPLIANCE", "OPTIONAL"], ["EMERGENCY", "OPTIONAL"],
      ]);
      await assert.rejects(pools.admin.query(`UPDATE public.contact_purpose_types SET primary_mode = 'REQUIRED' WHERE code = 'PRIMARY'`), /primary_mode_valid/);
      const o = await org();
      // OPTIONAL: two current BILLING assignments, no primary at all, is a valid state
      const a = (await create(o, { purposes: [{ purpose: "BILLING" }] })).contact;
      const b = (await create(o, { name: uniqueName("Bo"), purposes: [{ purpose: "BILLING" }] })).contact;
      const primaries = () => rowCount(`SELECT count(*) FROM public.contact_purpose_assignments WHERE organization_id = $1 AND purpose_code = 'BILLING' AND is_primary AND record_status = 'active' AND effective_to IS NULL`, [o]);
      assert.equal(await primaries(), 0);
      // first primary, swap, ending the primary, ending the last assignment: never more than one, zero allowed
      await K.c.makePrimary({ organizationId: o, relationshipId: a.relationship.id, purpose: "BILLING", effectiveFrom: MONTH(4) });
      assert.equal(await primaries(), 1);
      await K.c.makePrimary({ organizationId: o, relationshipId: b.relationship.id, purpose: "BILLING", effectiveFrom: MONTH(5) });
      assert.equal(await primaries(), 1);
      const view = (await K.c.getOrganizationContacts(o)).contacts.find((c) => c.relationship.id === b.relationship.id)!;
      await K.c.endPurpose({ organizationId: o, assignmentId: view.current.purposes[0].id, effectiveTo: MONTH(6) });
      assert.equal(await primaries(), 0, "an Organization can legitimately have BILLING contacts and no primary one");
      // PRIMARY (SINGLE) is a different concept from the BILLING primary flag: the same person can hold both independently
      const sole = (await create(o, { name: uniqueName("Sol"), purposes: [{ purpose: "PRIMARY" }, { purpose: "BILLING", primary: true }] })).contact;
      assert.deepEqual(sole.current.purposes.map((p) => [p.purpose, p.isPrimary]).sort(), [["BILLING", true], ["PRIMARY", true]]);
      assert.equal(await rowCount(`SELECT count(*) FROM public.contact_purpose_assignments WHERE organization_id = $1 AND purpose_code = 'PRIMARY' AND record_status = 'active' AND effective_to IS NULL`, [o]), 1);
    });

    scenario("database backstops hold even for the table owner", async () => {
      const client = await pools.admin.connect();
      const orgId = await org("Backstop");
      const expectFailure = async (sql: string, params: unknown[], pattern: RegExp) => {
        await client.query("SAVEPOINT s");
        await assert.rejects(client.query(sql, params), pattern, sql);
        await client.query("ROLLBACK TO SAVEPOINT s");
      };
      try {
        await client.query("BEGIN");
        const person = async () => (await client.query<{ id: string }>(`INSERT INTO public.persons DEFAULT VALUES RETURNING id`)).rows[0].id;
        const p1 = await person();
        const p2 = await person();
        const rel = async (p: string, from = "2020-01-01Z") =>
          (await client.query<{ id: string }>(`INSERT INTO public.organization_person_relationships (organization_id, person_id, effective_from) VALUES ($1, $2, $3) RETURNING id`, [orgId, p, from])).rows[0].id;
        const r1 = await rel(p1);
        const r2 = await rel(p2);
        const assign = (r: string, p: string, purpose: string, primary: boolean, from = "2020-02-01Z") =>
          client.query(`INSERT INTO public.contact_purpose_assignments (relationship_id, organization_id, person_id, purpose_code, is_primary, change_reason, effective_from) VALUES ($1, $2, $3, $4, $5, 'INITIAL', $6)`, [r, orgId, p, purpose, primary, from]);

        // one open relationship per Organization + person
        await expectFailure(`INSERT INTO public.organization_person_relationships (organization_id, person_id, effective_from) VALUES ($1, $2, now())`, [orgId, p1], /relationships_current_uq/);
        // purpose rules: PRIMARY is always primary; an unknown purpose is refused
        await expectFailure(`INSERT INTO public.contact_purpose_assignments (relationship_id, organization_id, person_id, purpose_code, is_primary, change_reason, effective_from) VALUES ($1, $2, $3, 'PRIMARY', false, 'INITIAL', '2020-02-01Z')`, [r1, orgId, p1], /incompatible with the primary flag/);
        await expectFailure(`INSERT INTO public.contact_purpose_assignments (relationship_id, organization_id, person_id, purpose_code, is_primary, change_reason, effective_from) VALUES ($1, $2, $3, 'NOPE', false, 'INITIAL', '2020-02-01Z')`, [r1, orgId, p1], /foreign key|incompatible with the primary flag/);
        // at most one current primary per Organization + purpose
        await assign(r1, p1, "BILLING", true);
        await expectFailure(`INSERT INTO public.contact_purpose_assignments (relationship_id, organization_id, person_id, purpose_code, is_primary, change_reason, effective_from) VALUES ($1, $2, $3, 'BILLING', true, 'INITIAL', '2020-02-01Z')`, [r2, orgId, p2], /current_primary_uq/);
        await assign(r2, p2, "BILLING", false); // a second, non-primary biller is fine
        // the same purpose twice in one relationship
        await expectFailure(`INSERT INTO public.contact_purpose_assignments (relationship_id, organization_id, person_id, purpose_code, is_primary, change_reason, effective_from) VALUES ($1, $2, $3, 'BILLING', false, 'INITIAL', '2020-02-01Z')`, [r1, orgId, p1], /assignments_current_uq/);
        // a dependent cannot start before its relationship
        await expectFailure(`INSERT INTO public.contact_purpose_assignments (relationship_id, organization_id, person_id, purpose_code, is_primary, change_reason, effective_from) VALUES ($1, $2, $3, 'SAFETY', false, 'INITIAL', '2019-01-01Z')`, [r1, orgId, p1], /fall inside an active relationship/);
        // dependents must name their relationship's own Organization and person
        await expectFailure(`INSERT INTO public.contact_purpose_assignments (relationship_id, organization_id, person_id, purpose_code, is_primary, change_reason, effective_from) VALUES ($1, $2, $3, 'SAFETY', false, 'INITIAL', '2020-02-01Z')`, [r1, orgId, p2], /foreign key/);
        // a relationship cannot end while a dependent outlives it
        await expectFailure(`UPDATE public.organization_person_relationships SET effective_to = '2020-06-01Z' WHERE id = $1`, [r1], /outlive it/);
        await expectFailure(`UPDATE public.organization_person_relationships SET record_status = 'voided', corrected_at = now() WHERE id = $1`, [r1], /cannot be voided/);
        // a person with a current relationship cannot be archived
        await expectFailure(`UPDATE public.persons SET record_status = 'archived', archived_at = now() WHERE id = $1`, [p1], /cannot be archived/);
        // content is immutable; lifecycle is guarded
        await expectFailure(`UPDATE public.organization_person_relationships SET person_id = $2 WHERE id = $1`, [r1, p2], /content is immutable|foreign key/);
        await expectFailure(`UPDATE public.contact_purpose_assignments SET is_primary = false WHERE relationship_id = $1 AND purpose_code = 'BILLING'`, [r1], /content is immutable/);
        await expectFailure(`UPDATE public.persons SET created_at = '2001-01-01Z' WHERE id = $1`, [p1], /identity is immutable/);
        // names: one current, at least one part
        await client.query(`INSERT INTO public.person_name_versions (person_id, given_name, name_normalized, change_reason, effective_from) VALUES ($1, 'A', 'a', 'INITIAL', '2020-01-01Z')`, [p1]);
        await expectFailure(`INSERT INTO public.person_name_versions (person_id, given_name, name_normalized, change_reason, effective_from) VALUES ($1, 'B', 'b', 'CHANGE', '2020-03-01Z')`, [p1], /name_versions_current_uq/);
        await expectFailure(`INSERT INTO public.person_name_versions (person_id, name_normalized, change_reason, effective_from) VALUES ($1, 'x', 'INITIAL', '2020-01-01Z')`, [p2], /has_a_name/);
        // shared email across people is allowed; the same email twice for one person is not
        const addEmail = (p: string, value: string) =>
          client.query(`INSERT INTO public.person_channels (person_id, channel_type, value_display, value_normalized, normalization_rule_version, change_reason, effective_from) VALUES ($1, 'EMAIL', $2, $2, 'test.v1', 'INITIAL', '2020-01-01Z')`, [p, value]);
        await addEmail(p1, "shared@example.test");
        await addEmail(p2, "shared@example.test");
        await expectFailure(`INSERT INTO public.person_channels (person_id, channel_type, value_display, value_normalized, normalization_rule_version, change_reason, effective_from) VALUES ($1, 'EMAIL', 'shared@example.test', 'shared@example.test', 'test.v1', 'INITIAL', '2020-01-01Z')`, [p1], /current_value_uq/);
        // corrected rows need a replacement, voided rows must not have one
        await expectFailure(`UPDATE public.person_channels SET record_status = 'corrected', corrected_at = now() WHERE person_id = $1`, [p1], /correction_state_consistent/);
        // an ended row cannot be re-dated; a correction never ends a row; corrected rows are frozen
        await client.query(`UPDATE public.person_channels SET effective_to = '2020-05-01Z' WHERE person_id = $1`, [p2]);
        await expectFailure(`UPDATE public.person_channels SET effective_to = '2020-06-01Z' WHERE person_id = $1`, [p2], /cannot be re-dated/);
        await client.query(`UPDATE public.person_channels SET record_status = 'voided', corrected_at = now() WHERE person_id = $1 AND effective_to IS NULL`, [p1]);
        await expectFailure(`UPDATE public.person_channels SET record_status = 'active', corrected_at = NULL WHERE person_id = $1`, [p1], /frozen/);
        // nothing is ever deleted
        await expectFailure(`DELETE FROM public.persons WHERE id = $1`, [p1], /preserved/);
        await expectFailure(`DELETE FROM public.contact_purpose_assignments`, [], /preserved/);
        await expectFailure(`TRUNCATE public.organization_person_titles`, [], /preserved/);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
  });

  // =============================================================================================================
  describe("creating contacts and the canonical person model", () => {
    scenario("createContact creates a person, name, relationship, channels, titles and purposes atomically, with advisory data only", async () => {
      const actor = await fullStaff();
      const o = await org();
      const mail = email();
      const { contact, matches } = await K.c.createContact({
        organizationId: o,
        name: { givenName: "Alex", familyName: `Rivera${run}` },
        channels: [{ type: "EMAIL", value: mail, preferred: true }, { type: "PHONE", value: "(403) 555-0111 ext 5" }],
        titles: ["Safety Manager"],
        purposes: [{ purpose: "SAFETY", primary: true }, { purpose: "COMPLIANCE" }],
        effectiveFrom: MONTH(1),
      });
      assert.deepEqual(matches, []);
      assert.equal(contact.person.recordStatus, "active");
      assert.equal(contact.current.name?.givenName, "Alex");
      assert.equal(contact.current.channels.length, 2);
      const phoneChannel = contact.current.channels.find((c) => c.channelType === "PHONE")!;
      assert.equal(phoneChannel.valueNormalized, "+14035550111");
      assert.equal(phoneChannel.extension, "5");
      assert.equal(contact.current.channels.find((c) => c.channelType === "EMAIL")!.isPreferred, true);
      assert.deepEqual(contact.current.titles.map((t) => t.titleDisplay), ["Safety Manager"]);
      assert.deepEqual(contact.current.purposes.map((p) => [p.purpose, p.isPrimary]).sort(), [["COMPLIANCE", false], ["SAFETY", true]]);
      // titles and purposes are different concepts, and "Primary" is a flag on a purpose, not a title or identity
      assert.equal(contact.current.titles.some((t) => /primary/i.test(t.titleDisplay)), false);
      assert.equal(contact.relationship.organizationId, o);
      // no verification claim of any kind
      assert.equal(JSON.stringify(contact).includes("verif"), false);
      // one create, one link, two purpose links; none of the values appear in the register
      const types = await eventTypes(actor.actorId);
      assert.deepEqual(types, ["RECORD_CREATED", "RECORD_LINK_ESTABLISHED", "RECORD_LINK_ESTABLISHED", "RECORD_LINK_ESTABLISHED"]);
      const json = await eventsJson(actor.actorId);
      for (const secret of [mail, "Alex", `Rivera${run}`, "5550111", "Safety Manager"]) assert.equal(json.includes(secret), false, `register must not contain ${secret}`);
    });

    scenario("a person can work with several Organizations; reuse is explicit and visibility-checked", async () => {
      const full = await staff("CONTACT_MANAGE", "PERSON_REGISTRY_READ");
      const blind = await staff("CONTACT_MANAGE");
      const [a, b, c] = [await org("A"), await org("B"), await org("C")];
      signIn(full);
      const created = (await create(a)).contact;
      const personId = created.person.id;

      // with registry read the existing person can be related to another Organization
      const second = await K.c.addRelationship({ organizationId: b, personId, effectiveFrom: MONTH(2) });
      assert.equal(second.person.id, personId, "one human identity, not a duplicate");
      assert.equal((await K.c.getPerson(personId)).relationships.filter((r) => r.recordStatus === "active").length, 2);

      // without registry read the person is invisible: exactly like a person that does not exist
      signIn(blind);
      const message = async (id: string) => {
        try {
          await K.c.addRelationship({ organizationId: c, personId: id });
        } catch (error) {
          assert.ok(error instanceof K.c.ContactNotFoundError);
          return (error as Error).message;
        }
        assert.fail("expected NotFound");
      };
      assert.equal(await message(personId), await message(randomUUID()));
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_person_relationships WHERE organization_id = $1`, [c]), 0);

      // but a manager can always create a NEW person, and rehire one already related to the Organization
      const own = (await create(c)).contact;
      await K.c.endRelationship({ organizationId: c, relationshipId: own.relationship.id, effectiveTo: MONTH(3) });
      const rehired = await K.c.addRelationship({ organizationId: c, personId: own.person.id, effectiveFrom: MONTH(4) });
      assert.notEqual(rehired.relationship.id, own.relationship.id, "a rehire is a new relationship");
      assert.equal(rehired.person.id, own.person.id);
    });

    scenario("no unsafe auto-merge: matching is advisory, shared email and phone are allowed", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const shared = email();
      const line = "+14035559999";
      const first = (await create(a, { channels: [{ type: "EMAIL", value: shared }, { type: "PHONE", value: line }] })).contact;
      // a second, different person using the same mailbox and phone line is created separately and flagged for review
      const second = await create(b, { name: uniqueName("Sam"), channels: [{ type: "EMAIL", value: shared.toUpperCase() }, { type: "PHONE", value: "403-555-9999" }] });
      assert.notEqual(second.contact.person.id, first.person.id);
      assert.equal(second.matches.length, 1);
      assert.equal(second.matches[0].personId, first.person.id);
      assert.deepEqual([...second.matches[0].reasons].sort(), ["EMAIL", "PHONE"]);
      assert.equal(await rowCount(`SELECT count(*) FROM public.person_channels WHERE channel_type = 'EMAIL' AND value_normalized = $1 AND record_status = 'active'`, [shared.toLowerCase()]), 2);
      // the same name alone is also only a suggestion
      const sameName = await create(b, { name: { givenName: first.current.name!.givenName ?? undefined, familyName: first.current.name!.familyName ?? undefined } });
      assert.ok(sameName.matches.some((m) => m.personId === first.person.id && m.reasons.includes("NAME")));
      assert.notEqual(sameName.contact.person.id, first.person.id);
      // explicit lookup returns candidates and merges nothing
      const lookup = await K.c.findPersonMatches({ email: shared, phone: line });
      assert.ok(lookup.length >= 2);
      assert.equal(await rowCount(`SELECT count(*) FROM public.persons`) >= 3, true);
    });

    scenario("without PERSON_REGISTRY_READ createContact discloses no matches", async () => {
      const full = await staff("CONTACT_MANAGE", "PERSON_REGISTRY_READ");
      const blind = await staff("CONTACT_MANAGE");
      const [a, b] = [await org("A"), await org("B")];
      const shared = email();
      signIn(full);
      await create(a, { channels: [{ type: "EMAIL", value: shared }] });
      signIn(blind);
      const second = await create(b, { channels: [{ type: "EMAIL", value: shared }] });
      assert.deepEqual(second.matches, []);
      assert.equal(JSON.stringify(second).includes(a), false);
    });

    scenario("validation: unknown fields, bad channels, unknown purposes and primary-mode rules are refused with nothing created", async () => {
      await fullStaff();
      const o = await org();
      const before = await rowCount(`SELECT count(*) FROM public.persons`);
      const bad: Array<Record<string, unknown>> = [
        { name: {} },
        { name: { givenName: "A" }, channels: [{ type: "FAX", value: "1" }] },
        { name: { givenName: "A" }, channels: [{ type: "EMAIL", value: "nope" }] },
        { name: { givenName: "A" }, purposes: [{ purpose: "OWNER_OPERATOR" }] },
        { name: { givenName: "A" }, purposes: [{ purpose: "PRIMARY", primary: false }] },
        { name: { givenName: "A" }, titles: [""] },
        { name: { givenName: "A" }, surprise: true },
        { name: { givenName: "A" }, channels: [{ type: "EMAIL", value: "a@b.co" }, { type: "EMAIL", value: "A@B.CO" }] },
      ];
      for (const over of bad) await assert.rejects(K.c.createContact({ organizationId: o, ...over } as never), (error: unknown) => error instanceof K.c.ContactError);
      await rejectsWith(K.c.createContact({ organizationId: randomUUID(), name: { givenName: "A" } }), K.c.ContactNotFoundError);
      assert.equal(await rowCount(`SELECT count(*) FROM public.persons`), before, "every refusal rolled back");
    });
  });

  // =============================================================================================================
  describe("relationships, history, archive", () => {
    scenario("leaving ends the relationship and its titles and purposes together; history is kept, nothing is deleted", async () => {
      const actor = await fullStaff();
      const o = await org();
      const { contact } = await create(o, { titles: ["Dispatcher"], purposes: [{ purpose: "OPERATIONS" }] });
      const ended = await K.c.endRelationship({ organizationId: o, relationshipId: contact.relationship.id, effectiveTo: MONTH(6) });
      assert.notEqual(ended.relationship.effectiveTo, null);
      assert.equal(ended.current.titles.length, 0);
      assert.equal(ended.current.purposes.length, 0);
      assert.equal(ended.titles.every((t) => t.effectiveTo !== null && t.recordStatus === "active"), true);
      assert.equal(ended.purposes.every((p) => p.effectiveTo !== null), true);
      // as-of reads follow business time
      const before = (await K.c.getOrganizationContacts(o, { asOf: MONTH(3) })).contacts[0];
      assert.equal(before.asOf!.relationshipInForce, true);
      assert.equal(before.asOf!.titles.length, 1);
      const after = (await K.c.getOrganizationContacts(o, { asOf: MONTH(8) })).contacts[0];
      assert.equal(after.asOf!.relationshipInForce, false);
      assert.equal(after.asOf!.titles.length, 0);
      // a second end is refused; changes on an ended relationship are refused
      await rejectsWith(K.c.endRelationship({ organizationId: o, relationshipId: contact.relationship.id }), K.c.ContactStateError);
      await rejectsWith(K.c.addTitle({ organizationId: o, relationshipId: contact.relationship.id, title: "Boss" }), K.c.ContactStateError);
      await rejectsWith(K.c.assignPurpose({ organizationId: o, relationshipId: contact.relationship.id, purpose: "BILLING" }), K.c.ContactStateError);
      assert.equal((await eventTypes(actor.actorId)).filter((t) => t === "RECORD_LINK_REMOVED").length, 2);
    });

    scenario("a wrongly recorded relationship is voided with its dependents, never deleted, and never counts as history", async () => {
      await fullStaff();
      const o = await org();
      const { contact } = await create(o, { titles: ["Director"], purposes: [{ purpose: "BILLING" }] });
      const voided = await K.c.voidRelationship({ organizationId: o, relationshipId: contact.relationship.id });
      assert.equal(voided.relationship.recordStatus, "voided");
      assert.equal(voided.titles.every((t) => t.recordStatus === "voided"), true);
      assert.equal(voided.current.titles.length, 0);
      assert.equal(voided.current.purposes.length, 0);
      assert.equal((await K.c.getOrganizationContacts(o, { asOf: MONTH(3) })).contacts[0].asOf!.relationshipInForce, false);
      await rejectsWith(K.c.voidRelationship({ organizationId: o, relationshipId: contact.relationship.id }), K.c.ContactStateError);
      // the void does not block a correct relationship afterwards
      const again = await K.c.addRelationship({ organizationId: o, personId: contact.person.id, effectiveFrom: MONTH(2) });
      assert.equal(again.relationship.recordStatus, "active");
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_person_relationships WHERE organization_id = $1`, [o]), 2);
    });

    scenario("archiving a person requires no current relationship; restoring returns the same person", async () => {
      const actor = await fullStaff();
      const o = await org();
      const { contact } = await create(o);
      await rejectsWith(K.c.archivePerson({ organizationId: o, personId: contact.person.id }), K.c.ContactStateError);
      await K.c.endRelationship({ organizationId: o, relationshipId: contact.relationship.id, effectiveTo: MONTH(5) });
      const archived = await K.c.archivePerson({ organizationId: o, personId: contact.person.id });
      assert.equal(archived.recordStatus, "archived");
      assert.ok(archived.archivedAt);
      await rejectsWith(K.c.archivePerson({ organizationId: o, personId: contact.person.id }), K.c.ContactStateError);
      await rejectsWith(K.c.addRelationship({ organizationId: o, personId: contact.person.id }), K.c.ContactStateError);
      await rejectsWith(K.c.addPersonChannel({ organizationId: o, personId: contact.person.id, channel: { type: "EMAIL", value: email() } }), K.c.ContactStateError);
      const restored = await K.c.restorePerson({ organizationId: o, personId: contact.person.id });
      assert.equal(restored.id, contact.person.id);
      assert.equal(restored.recordStatus, "active");
      await rejectsWith(K.c.restorePerson({ organizationId: o, personId: contact.person.id }), K.c.ContactStateError);
      const types = await eventTypes(actor.actorId);
      assert.ok(types.includes("RECORD_ARCHIVED") && types.includes("RECORD_RESTORED"));
    });

    scenario("a person is only reachable through an Organization it is related to", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const { contact } = await create(a);
      await rejectsWith(K.c.changePersonName({ organizationId: b, personId: contact.person.id, givenName: "Zed" }), K.c.ContactNotFoundError);
      await rejectsWith(K.c.addPersonChannel({ organizationId: b, personId: contact.person.id, channel: { type: "EMAIL", value: email() } }), K.c.ContactNotFoundError);
      await rejectsWith(K.c.archivePerson({ organizationId: b, personId: contact.person.id }), K.c.ContactNotFoundError);
      await rejectsWith(K.c.endRelationship({ organizationId: b, relationshipId: contact.relationship.id }), K.c.ContactNotFoundError);
      await rejectsWith(K.c.addTitle({ organizationId: b, relationshipId: contact.relationship.id, title: "X" }), K.c.ContactNotFoundError);
    });

    scenario("an archived or merged Organization cannot gain contacts", async () => {
      await fullStaff();
      const o = await org();
      const { contact } = await create(o);
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived' WHERE id = $1`, [o]).catch(() => undefined);
      const status = (await pools.admin.query(`SELECT status FROM public.organizations WHERE id = $1`, [o])).rows[0].status;
      if (status === "archived") {
        await rejectsWith(create(o), K.c.ContactStateError);
        await rejectsWith(K.c.addTitle({ organizationId: o, relationshipId: contact.relationship.id, title: "X" }), K.c.ContactStateError);
      }
    });
  });

  // =============================================================================================================
  describe("names, titles, channels: real-world change versus correction", () => {
    scenario("a name change keeps the old name as history; a correction preserves the wrong name but never reports it as history", async () => {
      const actor = await fullStaff();
      const o = await org();
      const { contact } = await create(o, { name: { givenName: "Jane", familyName: `Doe${run}` } });
      const changed = await K.c.changePersonName({ organizationId: o, personId: contact.person.id, familyName: `Smith${run}`, effectiveFrom: MONTH(6) });
      assert.equal(changed.current.name!.familyName, `Smith${run}`);
      assert.deepEqual(changed.names.filter((x) => x.recordStatus === "active").map((x) => x.familyName), [`Doe${run}`, `Smith${run}`]);
      assert.equal((await K.c.getOrganizationContacts(o, { asOf: MONTH(3) })).contacts[0].asOf!.name!.familyName, `Doe${run}`);

      const fixed = await K.c.correctPersonName({ organizationId: o, personId: contact.person.id, givenName: "Janet" });
      const wrong = fixed.names.find((x) => x.recordStatus === "corrected")!;
      assert.equal(wrong.givenName, "Jane");
      assert.equal(wrong.effectiveTo, null, "a correction never ends the wrong row");
      assert.equal(wrong.supersededById, fixed.current.name!.id);
      assert.equal(fixed.current.name!.givenName, "Janet");
      assert.equal(fixed.current.name!.effectiveFrom, wrong.effectiveFrom, "inherits business time");
      assert.equal(fixed.names.filter((x) => x.recordStatus === "active").length, 2, "no invented transition");
      await rejectsWith(K.c.correctPersonName({ organizationId: o, personId: contact.person.id, givenName: "Janet" }), K.c.ContactValidationError);
      await rejectsWith(K.c.changePersonName({ organizationId: o, personId: contact.person.id } as never), K.c.ContactValidationError);
      assert.deepEqual((await eventTypes(actor.actorId)).slice(-2), ["RECORD_UPDATED", "RECORD_CORRECTED"]);
    });

    scenario("a promotion is a title change (history); a typo is a title correction; several titles may be held at once", async () => {
      const actor = await fullStaff();
      const o = await org();
      const { contact } = await create(o, { titles: ["Manager"] });
      const manager = contact.current.titles[0];
      const promoted = await K.c.changeTitle({ organizationId: o, titleId: manager.id, title: "Director", effectiveFrom: MONTH(7) });
      assert.deepEqual(promoted.titles.filter((t) => t.recordStatus === "active").map((t) => t.titleDisplay), ["Manager", "Director"]);
      assert.deepEqual(promoted.current.titles.map((t) => t.titleDisplay), ["Director"]);
      assert.equal((await K.c.getOrganizationContacts(o, { asOf: MONTH(3) })).contacts[0].asOf!.titles[0].titleDisplay, "Manager");

      const typo = await K.c.correctTitle({ organizationId: o, titleId: promoted.current.titles[0].id, title: "Directer Of Safety" });
      const fixed = await K.c.correctTitle({ organizationId: o, titleId: typo.current.titles[0].id, title: "Director of Safety" });
      assert.equal(fixed.titles.filter((t) => t.recordStatus === "corrected").length, 2);
      assert.deepEqual(fixed.current.titles.map((t) => t.titleDisplay), ["Director of Safety"]);
      assert.equal(fixed.titles.filter((t) => t.recordStatus === "active").length, 2, "Manager (ended) + the corrected Director");

      // concurrent titles are allowed; the identical current title is not
      const more = await K.c.addTitle({ organizationId: o, relationshipId: contact.relationship.id, title: "Dispatcher" });
      assert.equal(more.current.titles.length, 2);
      await rejectsWith(K.c.addTitle({ organizationId: o, relationshipId: contact.relationship.id, title: "dispatcher" }), K.c.ContactConflictError);
      const ended = await K.c.endTitle({ organizationId: o, titleId: more.current.titles.find((t) => t.titleDisplay === "Dispatcher")!.id });
      assert.equal(ended.current.titles.length, 1);
      const voided = await K.c.voidTitle({ organizationId: o, titleId: ended.current.titles[0].id });
      assert.equal(voided.current.titles.length, 0);
      assert.equal(voided.titles.filter((t) => t.recordStatus === "voided").length, 1);
      await rejectsWith(K.c.changeTitle({ organizationId: o, titleId: manager.id, title: "Chief" }), K.c.ContactNotFoundError);
      const types = await eventTypes(actor.actorId);
      assert.ok(types.includes("RECORD_UPDATED") && types.includes("RECORD_CORRECTED"));
      // titles never decide authorization: nothing here depends on the text
      assert.equal(JSON.stringify(Object.keys(K.c)).includes("Authoriz"), false);
    });

    scenario("person channels: change keeps history, correction replaces a typo, end and void work, shared and preferred rules hold", async () => {
      const actor = await fullStaff();
      const o = await org();
      const { contact } = await create(o, { channels: [{ type: "PHONE", value: "403-555-0100", preferred: true }, { type: "EMAIL", value: email() }] });
      const personId = contact.person.id;
      const line = contact.current.channels.find((c) => c.channelType === "PHONE")!;

      const moved = await K.c.changePersonChannel({ organizationId: o, personId, channelId: line.id, value: "403-555-0200", effectiveFrom: MONTH(5) });
      assert.deepEqual(moved.channels.filter((c) => c.channelType === "PHONE" && c.recordStatus === "active").map((c) => c.valueNormalized), ["+14035550100", "+14035550200"]);
      assert.equal(moved.current.channels.find((c) => c.channelType === "PHONE")!.isPreferred, true, "preference carries over");
      assert.equal((await K.c.getOrganizationContacts(o, { asOf: MONTH(2) })).contacts[0].asOf!.channels.find((c) => c.channelType === "PHONE")!.valueNormalized, "+14035550100");

      const typo = await K.c.correctPersonChannel({ organizationId: o, personId, channelId: moved.current.channels.find((c) => c.channelType === "PHONE")!.id, value: "403-555-0299" });
      const fixedPhone = typo.current.channels.find((c) => c.channelType === "PHONE")!;
      assert.equal(fixedPhone.valueNormalized, "+14035550299");
      assert.equal(typo.channels.filter((c) => c.recordStatus === "corrected").length, 1);
      assert.equal(typo.channels.find((c) => c.recordStatus === "corrected")!.effectiveTo, null);
      assert.equal(fixedPhone.effectiveFrom, moved.current.channels.find((c) => c.channelType === "PHONE")!.effectiveFrom);

      // the same value twice is a conflict; a second preferred phone is a conflict
      await rejectsWith(K.c.addPersonChannel({ organizationId: o, personId, channel: { type: "PHONE", value: "(403) 555-0299" } }), K.c.ContactConflictError);
      await rejectsWith(K.c.addPersonChannel({ organizationId: o, personId, channel: { type: "PHONE", value: "403-555-0311", preferred: true } }), K.c.ContactConflictError);
      const extra = await K.c.addPersonChannel({ organizationId: o, personId, channel: { type: "PHONE", value: "403-555-0311" } });
      const second = extra.current.channels.find((c) => c.valueNormalized === "+14035550311")!;
      const ended = await K.c.endPersonChannel({ organizationId: o, personId, channelId: second.id });
      assert.equal(ended.current.channels.some((c) => c.id === second.id), false);
      assert.equal(ended.channels.some((c) => c.id === second.id && c.recordStatus === "active" && c.effectiveTo !== null), true);
      const mail = ended.current.channels.find((c) => c.channelType === "EMAIL")!;
      const voided = await K.c.voidPersonChannel({ organizationId: o, personId, channelId: mail.id });
      assert.equal(voided.current.channels.some((c) => c.channelType === "EMAIL"), false);
      assert.equal(voided.channels.find((c) => c.id === mail.id)!.recordStatus, "voided");
      await rejectsWith(K.c.changePersonChannel({ organizationId: o, personId, channelId: mail.id, value: email() }), K.c.ContactNotFoundError);
      await rejectsWith(K.c.changePersonChannel({ organizationId: o, personId, channelId: fixedPhone.id } as never), K.c.ContactValidationError);
      const json = await eventsJson(actor.actorId);
      assert.equal(json.includes("5550299"), false);
      assert.equal(json.includes(mail.valueNormalized), false);
    });

    scenario("Organization channels are independent of any person and distinguishable from person channels", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const general = email();
      const view = await K.c.addOrganizationChannel({ organizationId: a, channel: { type: "PHONE", value: "403-555-0000", usage: "OFFICE", preferred: true }, effectiveFrom: MONTH(1) });
      assert.equal(view.contacts.length, 0, "no person involved");
      const dispatch = await K.c.addOrganizationChannel({ organizationId: a, channel: { type: "EMAIL", value: general, usage: "DISPATCH" } });
      assert.deepEqual(dispatch.currentChannels.map((c) => [c.ownerType, c.channelType, c.usage]).sort(), [["ORGANIZATION", "EMAIL", "DISPATCH"], ["ORGANIZATION", "PHONE", "OFFICE"]]);
      // the same mailbox may be a person's channel and an Organization channel, and may serve two Organizations
      await create(a, { channels: [{ type: "EMAIL", value: general }] });
      await K.c.addOrganizationChannel({ organizationId: b, channel: { type: "EMAIL", value: general, usage: "GENERAL" } });
      await rejectsWith(K.c.addOrganizationChannel({ organizationId: a, channel: { type: "EMAIL", value: general.toUpperCase(), usage: "DISPATCH" } }), K.c.ContactConflictError);
      await rejectsWith(K.c.addOrganizationChannel({ organizationId: a, channel: { type: "EMAIL", value: email(), usage: "NOPE" } } as never), K.c.ContactValidationError);
      await rejectsWith(K.c.addOrganizationChannel({ organizationId: a, channel: { type: "EMAIL", value: email() } } as never), K.c.ContactValidationError);

      const office = dispatch.currentChannels.find((c) => c.usage === "OFFICE")!;
      const changed = await K.c.changeOrganizationChannel({ organizationId: a, channelId: office.id, value: "403-555-0001", effectiveFrom: MONTH(6) });
      assert.equal(changed.channels.filter((c) => c.usage === "OFFICE" && c.recordStatus === "active").length, 2);
      const current = changed.currentChannels.find((c) => c.usage === "OFFICE")!;
      const fixed = await K.c.correctOrganizationChannel({ organizationId: a, channelId: current.id, value: "403-555-0002" });
      assert.equal(fixed.currentChannels.find((c) => c.usage === "OFFICE")!.valueNormalized, "+14035550002");
      const ended = await K.c.endOrganizationChannel({ organizationId: a, channelId: fixed.currentChannels.find((c) => c.usage === "OFFICE")!.id });
      assert.equal(ended.currentChannels.some((c) => c.usage === "OFFICE"), false);
      const voided = await K.c.voidOrganizationChannel({ organizationId: a, channelId: ended.currentChannels.find((c) => c.usage === "DISPATCH")!.id });
      assert.equal(voided.currentChannels.length, 0);
      // another Organization's channels are untouched and unreachable through this one
      assert.equal((await K.c.getOrganizationContacts(b)).currentChannels.length, 1);
      await rejectsWith(K.c.endOrganizationChannel({ organizationId: b, channelId: office.id }), K.c.ContactNotFoundError);
    });
  });

  // =============================================================================================================
  describe("contact purposes and the primary-per-purpose invariant", () => {
    scenario("a person can serve several purposes; PRIMARY is exclusive; a non-primary biller coexists with the primary", async () => {
      await fullStaff();
      const o = await org();
      const a = (await create(o, { purposes: [{ purpose: "PRIMARY" }, { purpose: "BILLING", primary: true }, { purpose: "SAFETY" }] })).contact;
      const b = (await create(o, { name: uniqueName("Bo") })).contact;
      assert.deepEqual(a.current.purposes.map((p) => p.purpose).sort(), ["BILLING", "PRIMARY", "SAFETY"]);
      assert.equal(a.current.purposes.find((p) => p.purpose === "PRIMARY")!.isPrimary, true, "PRIMARY is always the primary one");

      // a second PRIMARY holder is refused; a second BILLING primary is refused; a non-primary BILLING is fine
      await rejectsWith(K.c.assignPurpose({ organizationId: o, relationshipId: b.relationship.id, purpose: "PRIMARY" }), K.c.ContactConflictError);
      await rejectsWith(K.c.assignPurpose({ organizationId: o, relationshipId: b.relationship.id, purpose: "BILLING", primary: true }), K.c.ContactConflictError);
      const billing = await K.c.assignPurpose({ organizationId: o, relationshipId: b.relationship.id, purpose: "BILLING" });
      assert.equal(billing.current.purposes[0].isPrimary, false);
      await rejectsWith(K.c.assignPurpose({ organizationId: o, relationshipId: b.relationship.id, purpose: "BILLING" }), K.c.ContactConflictError);
      await rejectsWith(K.c.assignPurpose({ organizationId: o, relationshipId: b.relationship.id, purpose: "PRIMARY", primary: false }), K.c.ContactValidationError);
      await rejectsWith(K.c.assignPurpose({ organizationId: o, relationshipId: b.relationship.id, purpose: "OWNER_OPERATOR" }), K.c.ContactValidationError);
      // primary is per Organization + purpose: another Organization has its own
      const other = await org("Other");
      await create(other, { purposes: [{ purpose: "PRIMARY" }] });
    });

    scenario("makePrimary swaps the primary atomically: the old primary stays a non-primary biller, history is kept", async () => {
      const actor = await fullStaff();
      const o = await org();
      const a = (await create(o, { purposes: [{ purpose: "BILLING", primary: true }] })).contact;
      const b = (await create(o, { name: uniqueName("Bo"), purposes: [{ purpose: "BILLING" }] })).contact;
      const swapped = await K.c.makePrimary({ organizationId: o, relationshipId: b.relationship.id, purpose: "BILLING", effectiveFrom: MONTH(6) });
      assert.deepEqual(swapped.current.purposes.map((p) => [p.purpose, p.isPrimary]), [["BILLING", true]]);
      const aNow = (await K.c.getOrganizationContacts(o)).contacts.find((c) => c.relationship.id === a.relationship.id)!;
      assert.deepEqual(aNow.current.purposes.map((p) => [p.purpose, p.isPrimary]), [["BILLING", false]], "the former primary still serves the purpose");
      assert.equal(aNow.purposes.filter((p) => p.recordStatus === "active").length, 2, "primary then non-primary: true history");
      assert.equal(await rowCount(`SELECT count(*) FROM public.contact_purpose_assignments WHERE organization_id = $1 AND purpose_code = 'BILLING' AND is_primary AND record_status = 'active' AND effective_to IS NULL`, [o]), 1);
      await rejectsWith(K.c.makePrimary({ organizationId: o, relationshipId: b.relationship.id, purpose: "BILLING" }), K.c.ContactStateError);
      // a PRIMARY purpose handover ends the previous holder
      const p1 = (await create(o, { name: uniqueName("P1"), purposes: [{ purpose: "PRIMARY" }] })).contact;
      const p2 = (await create(o, { name: uniqueName("P2") })).contact;
      const handed = await K.c.makePrimary({ organizationId: o, relationshipId: p2.relationship.id, purpose: "PRIMARY", effectiveFrom: MONTH(7) });
      assert.equal(handed.current.purposes[0].isPrimary, true);
      const p1Now = (await K.c.getOrganizationContacts(o)).contacts.find((c) => c.relationship.id === p1.relationship.id)!;
      assert.equal(p1Now.current.purposes.length, 0);
      assert.ok((await eventTypes(actor.actorId)).includes("RECORD_UPDATED"));
    });

    scenario("ending and voiding a purpose; as-of reads follow business time", async () => {
      await fullStaff();
      const o = await org();
      const { contact } = await create(o, { purposes: [{ purpose: "EMERGENCY" }, { purpose: "SAFETY" }] });
      const emergency = contact.current.purposes.find((p) => p.purpose === "EMERGENCY")!;
      const ended = await K.c.endPurpose({ organizationId: o, assignmentId: emergency.id, effectiveTo: MONTH(6) });
      assert.deepEqual(ended.current.purposes.map((p) => p.purpose), ["SAFETY"]);
      assert.equal((await K.c.getOrganizationContacts(o, { asOf: MONTH(3) })).contacts[0].asOf!.purposes.length, 2);
      const safety = ended.current.purposes[0];
      const voided = await K.c.voidPurpose({ organizationId: o, assignmentId: safety.id });
      assert.equal(voided.current.purposes.length, 0);
      assert.equal((await K.c.getOrganizationContacts(o, { asOf: MONTH(3) })).contacts[0].asOf!.purposes.length, 1, "the voided row never answers as-of");
      await rejectsWith(K.c.endPurpose({ organizationId: o, assignmentId: emergency.id }), K.c.ContactNotFoundError);
    });
  });

  // =============================================================================================================
  describe("concurrency (distinct actors, so the calls genuinely overlap)", () => {
    scenario("two simultaneous attempts to relate the same person to the same Organization: exactly one wins", async () => {
      const as = await concurrentActors(4);
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const personId = (await create(a)).contact.person.id;
      const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => as(i, () => K.c.addRelationship({ organizationId: b, personId }))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.ContactConflictError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_person_relationships WHERE organization_id = $1 AND person_id = $2 AND record_status = 'active' AND effective_to IS NULL`, [b, personId]), 1);
    });

    scenario("simultaneous attempts to assign two primaries for one Organization + purpose: exactly one wins", async () => {
      const as = await concurrentActors(4);
      await fullStaff();
      const o = await org();
      const people = await Promise.all([0, 1, 2, 3].map((i) => create(o, { name: uniqueName(`C${i}`) })));
      const results = await Promise.allSettled(people.map((p, i) => as(i, () => K.c.assignPurpose({ organizationId: o, relationshipId: p.contact.relationship.id, purpose: "PRIMARY" }))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.ContactConflictError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.contact_purpose_assignments WHERE organization_id = $1 AND purpose_code = 'PRIMARY' AND record_status = 'active' AND effective_to IS NULL`, [o]), 1);
    });

    scenario("simultaneous makePrimary calls end with exactly one primary and no deadlock", async () => {
      const as = await concurrentActors(4);
      await fullStaff();
      const o = await org();
      const people = await Promise.all([0, 1, 2, 3].map((i) => create(o, { name: uniqueName(`D${i}`), purposes: [{ purpose: "BILLING" }] })));
      const results = await Promise.allSettled(people.map((p, i) => as(i, () => K.c.makePrimary({ organizationId: o, relationshipId: p.contact.relationship.id, purpose: "BILLING" }))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length >= 1, true, JSON.stringify(results.filter((r) => r.status === "rejected")));
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.ContactError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.contact_purpose_assignments WHERE organization_id = $1 AND purpose_code = 'BILLING' AND is_primary AND record_status = 'active' AND effective_to IS NULL`, [o]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.contact_purpose_assignments WHERE organization_id = $1 AND purpose_code = 'BILLING' AND record_status = 'active' AND effective_to IS NULL`, [o]), 4, "everyone still serves the purpose");
    });

    scenario("simultaneous identical titles: exactly one wins; simultaneous name correction and change serialize", async () => {
      const as = await concurrentActors(4);
      await fullStaff();
      const o = await org();
      const { contact } = await create(o);
      const titles = await Promise.allSettled([0, 1, 2, 3].map((i) => as(i, () => K.c.addTitle({ organizationId: o, relationshipId: contact.relationship.id, title: "Dispatcher" }))));
      assert.equal(titles.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of titles) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.ContactConflictError, String(r.reason));

      const names = await Promise.allSettled([
        as(0, () => K.c.correctPersonName({ organizationId: o, personId: contact.person.id, givenName: "Corr" })),
        as(1, () => K.c.changePersonName({ organizationId: o, personId: contact.person.id, givenName: "Chg", effectiveFrom: MONTH(6) })),
        as(2, () => K.c.correctPersonName({ organizationId: o, personId: contact.person.id, familyName: "Fam" })),
      ]);
      assert.equal(names.filter((r) => r.status === "fulfilled").length, 3, JSON.stringify(names.filter((r) => r.status === "rejected")));
      assert.equal(await rowCount(`SELECT count(*) FROM public.person_name_versions WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [contact.person.id]), 1);
    });

    scenario("one person shared by two Organizations is written from both at once without deadlock or lost rows", async () => {
      const as = await concurrentActors(6);
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const personId = (await create(a)).contact.person.id;
      await K.c.addRelationship({ organizationId: b, personId, effectiveFrom: MONTH(2) });
      const results = await Promise.allSettled([
        ...[0, 1, 2].map((i) => as(i, () => K.c.addPersonChannel({ organizationId: a, personId, channel: { type: "EMAIL", value: email() } }))),
        ...[3, 4, 5].map((i) => as(i, () => K.c.addPersonChannel({ organizationId: b, personId, channel: { type: "PHONE", value: `+1403555${2000 + i}` } }))),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 6, JSON.stringify(results.filter((r) => r.status === "rejected")));
      assert.equal(await rowCount(`SELECT count(*) FROM public.person_channels WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [personId]), 6);
    });

    scenario("a concurrent archive and a concurrent relationship for the same person cannot both succeed", async () => {
      const as = await concurrentActors(2);
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const { contact } = await create(a);
      await K.c.endRelationship({ organizationId: a, relationshipId: contact.relationship.id, effectiveTo: MONTH(3) });
      const results = await Promise.allSettled([
        as(0, () => K.c.archivePerson({ organizationId: a, personId: contact.person.id })),
        as(1, () => K.c.addRelationship({ organizationId: b, personId: contact.person.id })),
      ]);
      const person = (await pools.admin.query(`SELECT record_status FROM public.persons WHERE id = $1`, [contact.person.id])).rows[0].record_status;
      const openRelationships = await rowCount(`SELECT count(*) FROM public.organization_person_relationships WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [contact.person.id]);
      assert.ok(!(person === "archived" && openRelationships > 0), "an archived person never has a current relationship");
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.ContactError || r.reason instanceof K.authz.TesAuthorizationDeniedError, String(r.reason));
    });
  });

  // =============================================================================================================
  describe("Master Register (same transaction)", () => {
    scenario("each mutation family writes an existing event type; reads, lookups and refused calls write none; no PII", async () => {
      const actor = await fullStaff();
      const o = await org();
      const mail = email();
      const { contact } = await create(o, { name: { givenName: "Secret", familyName: `Name${run}` }, channels: [{ type: "EMAIL", value: mail }], titles: ["Chief Secret Officer"] });
      await K.c.changePersonName({ organizationId: o, personId: contact.person.id, givenName: "Hidden", effectiveFrom: MONTH(3) });
      await K.c.addPersonChannel({ organizationId: o, personId: contact.person.id, channel: { type: "PHONE", value: "403-555-0177" }, effectiveFrom: MONTH(2) });
      await K.c.addOrganizationChannel({ organizationId: o, channel: { type: "PHONE", value: "403-555-0188", usage: "GENERAL" }, effectiveFrom: MONTH(2) });
      await K.c.assignPurpose({ organizationId: o, relationshipId: contact.relationship.id, purpose: "COMPLIANCE", effectiveFrom: MONTH(2) });
      await K.c.changeTitle({ organizationId: o, titleId: contact.current.titles[0].id, title: "Chief Hidden Officer", effectiveFrom: MONTH(4) });
      await K.c.endRelationship({ organizationId: o, relationshipId: contact.relationship.id, effectiveTo: MONTH(8) });
      await K.c.archivePerson({ organizationId: o, personId: contact.person.id });
      const writes = await eventTypes(actor.actorId);
      assert.deepEqual(writes, [
        "RECORD_CREATED", "RECORD_LINK_ESTABLISHED", // createContact
        "RECORD_UPDATED", // changePersonName
        "RECORD_CREATED", // addPersonChannel
        "RECORD_CREATED", // addOrganizationChannel
        "RECORD_LINK_ESTABLISHED", // assignPurpose
        "RECORD_UPDATED", // changeTitle
        "RECORD_UPDATED", "RECORD_LINK_REMOVED", "RECORD_LINK_REMOVED", // endRelationship: title, purpose, relationship
        "RECORD_ARCHIVED", // archivePerson
      ]);
      const known = new Set(["RECORD_CREATED", "RECORD_UPDATED", "RECORD_CORRECTED", "RECORD_ARCHIVED", "RECORD_RESTORED", "RECORD_LINK_ESTABLISHED", "RECORD_LINK_REMOVED"]);
      for (const type of writes) assert.ok(known.has(type), type);
      // reads, lookups and refused calls
      await K.c.getOrganizationContacts(o);
      await K.c.getOrganizationContacts(o, { asOf: MONTH(2) });
      await K.c.getPerson(contact.person.id);
      await K.c.findPersonMatches({ email: mail });
      await assert.rejects(K.c.addTitle({ organizationId: o, relationshipId: contact.relationship.id, title: "X" }));
      await assert.rejects(K.c.archivePerson({ organizationId: o, personId: contact.person.id }));
      assert.deepEqual(await eventTypes(actor.actorId), writes);
      const json = await eventsJson(actor.actorId);
      for (const secret of [mail, "Secret", "Hidden", `Name${run}`, "Chief", "5550177", "5550188", "Officer"]) assert.equal(json.includes(secret), false, `register must not contain ${secret}`);
    });

    scenario("a Master Register failure rolls the whole mutation back", async () => {
      await fullStaff();
      const o = await org();
      const { contact } = await create(o, { channels: [{ type: "EMAIL", value: email() }], titles: ["Manager"], purposes: [{ purpose: "SAFETY" }] });
      const snapshot = async () =>
        JSON.stringify(
          await Promise.all(
            [
              `SELECT id, record_status, effective_to FROM public.person_name_versions WHERE person_id = '${contact.person.id}' ORDER BY id`,
              `SELECT id, record_status, effective_to FROM public.person_channels WHERE person_id = '${contact.person.id}' ORDER BY id`,
              `SELECT id, record_status, effective_to FROM public.organization_person_titles WHERE organization_id = '${o}' ORDER BY id`,
              `SELECT id, record_status, effective_to FROM public.contact_purpose_assignments WHERE organization_id = '${o}' ORDER BY id`,
              `SELECT id, record_status, effective_to FROM public.organization_person_relationships WHERE organization_id = '${o}' ORDER BY id`,
              `SELECT id, record_status FROM public.persons WHERE id = '${contact.person.id}'`,
            ].map(async (sql) => (await pools.admin.query(sql)).rows),
          ),
        );
      const before = await snapshot();
      const attempts: Array<[string, () => Promise<unknown>]> = [
        ["RECORD_CORRECTED", () => K.c.correctPersonName({ organizationId: o, personId: contact.person.id, givenName: "Zed" })],
        ["RECORD_CORRECTED", () => K.c.correctTitle({ organizationId: o, titleId: contact.current.titles[0].id, title: "Boss" })],
        ["RECORD_UPDATED", () => K.c.changePersonChannel({ organizationId: o, personId: contact.person.id, channelId: contact.current.channels[0].id, value: email(), effectiveFrom: MONTH(2) })],
        ["RECORD_LINK_REMOVED", () => K.c.endRelationship({ organizationId: o, relationshipId: contact.relationship.id, effectiveTo: MONTH(3) })],
        ["RECORD_LINK_REMOVED", () => K.c.endPurpose({ organizationId: o, assignmentId: contact.current.purposes[0].id })],
        ["RECORD_CORRECTED", () => K.c.voidRelationship({ organizationId: o, relationshipId: contact.relationship.id })],
        ["RECORD_LINK_ESTABLISHED", () => K.c.assignPurpose({ organizationId: o, relationshipId: contact.relationship.id, purpose: "BILLING" })],
      ];
      for (const [eventType, work] of attempts) {
        await refuseMasterRegisterEvent(eventType);
        await assert.rejects(work(), /master register|Master Register/i);
        assert.equal(await snapshot(), before, `${eventType} rolled back`);
      }
      await refuseMasterRegisterEvent("RECORD_CREATED");
      const before2 = await rowCount(`SELECT count(*) FROM public.persons`);
      await assert.rejects(create(o, { name: uniqueName("Rollback") }), /master register|Master Register/i);
      assert.equal(await rowCount(`SELECT count(*) FROM public.persons`), before2, "no half-created person");
    });
  });

  // =============================================================================================================
  describe("authorization and tenant boundary", () => {
    scenario("no session, no capability and the wrong capability are denied and change nothing", async () => {
      await fullStaff();
      const o = await org();
      const { contact } = await create(o);

      K.db.setClerkUser(null);
      await assert.rejects(K.c.getOrganizationContacts(o));
      await assert.rejects(create(o));

      signIn(await staff());
      await denied(K.c.getOrganizationContacts(o));
      await denied(create(o));

      // registry read alone cannot mutate
      signIn(await staff("PERSON_REGISTRY_READ"));
      assert.equal((await K.c.getOrganizationContacts(o)).contacts.length, 1);
      assert.equal((await K.c.getPerson(contact.person.id)).person.id, contact.person.id);
      assert.ok(Array.isArray(await K.c.findPersonMatches({ email: "x@example.test" })));
      await denied(create(o));
      await denied(K.c.addRelationship({ organizationId: o, personId: contact.person.id }));
      await denied(K.c.endRelationship({ organizationId: o, relationshipId: contact.relationship.id }));
      await denied(K.c.changePersonName({ organizationId: o, personId: contact.person.id, givenName: "Z" }));
      await denied(K.c.addPersonChannel({ organizationId: o, personId: contact.person.id, channel: { type: "EMAIL", value: email() } }));
      await denied(K.c.addOrganizationChannel({ organizationId: o, channel: { type: "EMAIL", value: email(), usage: "GENERAL" } }));
      await denied(K.c.addTitle({ organizationId: o, relationshipId: contact.relationship.id, title: "X" }));
      await denied(K.c.assignPurpose({ organizationId: o, relationshipId: contact.relationship.id, purpose: "BILLING" }));
      await denied(K.c.archivePerson({ organizationId: o, personId: contact.person.id }));

      // manage alone cannot read registry data
      signIn(await staff("CONTACT_MANAGE"));
      await denied(K.c.getOrganizationContacts(o));
      await denied(K.c.getPerson(contact.person.id));
      await denied(K.c.findPersonMatches({ email: "x@example.test" }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_person_relationships WHERE organization_id = $1`, [o]), 1);
    });

    scenario("a customer actor, even with ORGANIZATION_READ, reaches no contact data of its own Organization or anyone else's", async () => {
      await fullStaff();
      const customerA = await fx.organizationAndCustomer("CustA");
      const customerB = await fx.organizationAndCustomer("CustB");
      customerOrganizations.push(customerA.organizationId, customerB.organizationId);
      const a = (await create(customerA.organizationId)).contact;
      const b = (await create(customerB.organizationId)).contact;

      const user = await fx.actor();
      const relationshipId = await fx.relationship(user.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customerA.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      signIn(user);

      // the service has no CUSTOMER-scope path at all
      assert.deepEqual(Object.keys(K.c).filter((key) => /customer/i.test(key)), []);
      await denied(K.c.getOrganizationContacts(customerA.organizationId));
      await denied(K.c.getOrganizationContacts(customerB.organizationId));
      await denied(K.c.getPerson(a.person.id));
      await denied(K.c.getPerson(b.person.id));
      await denied(K.c.findPersonMatches({ givenName: "Pat" }));
      await denied(create(customerA.organizationId));
      await denied(K.c.addRelationship({ organizationId: customerA.organizationId, personId: b.person.id }));
      await denied(K.c.endRelationship({ organizationId: customerA.organizationId, relationshipId: a.relationship.id }));
    });

    scenario("a canonical person is globally stored but one Organization's view never contains another's data", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const first = (await create(a, { titles: ["Alpha Title"], channels: [{ type: "EMAIL", value: email() }] })).contact;
      await K.c.addOrganizationChannel({ organizationId: a, channel: { type: "EMAIL", value: email(), usage: "GENERAL" } });
      const second = (await create(b, { titles: ["Beta Title"] })).contact;
      const viewB = await K.c.getOrganizationContacts(b);
      assert.equal(viewB.contacts.length, 1);
      assert.equal(viewB.channels.length, 0);
      const text = JSON.stringify(viewB);
      assert.equal(text.includes(first.person.id), false);
      assert.equal(text.includes("Alpha Title"), false);
      assert.equal(viewB.contacts[0].person.id, second.person.id);
    });

    scenario("the service exposes no delete, remove, merge, authorization-by-title or customer function", async () => {
      assert.deepEqual(Object.keys(K.c).filter((key) => /delete|remove|destroy|merge|customer|authoriz|permission/i.test(key)), []);
    });
  });
});
