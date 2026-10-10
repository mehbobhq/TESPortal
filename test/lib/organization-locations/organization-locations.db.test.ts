// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL Organization Location service through the REAL authorization wrappers and Clerk-to-actor
// resolution, on pooled connections that log in as the RUNTIME role, against a database with migrations 0001-0012 applied.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type pg from "pg";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    authz: await import("@/lib/auth/tes-authorization"),
    loc: await import("@/lib/organization-locations/service"),
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
const TABLES = ["locations", "location_addresses", "organization_location_assignments"] as const;

describe("Organization Locations (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
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

  /** Removes everything this run created. The no-delete triggers are lifted only here, by the table owner, inside a transaction. */
  async function purge() {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const table of TABLES) {
        await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${table === "organization_location_assignments" ? "organization_location_assignments_no_delete" : `${table}_no_delete`}`);
      }
      const locations = (await client.query<{ location_id: string }>(
        `SELECT DISTINCT location_id FROM public.location_addresses WHERE address_line_1 LIKE $1`,
        [`%${run}%`],
      )).rows.map((row) => row.location_id);
      await client.query(`DELETE FROM public.organization_location_assignments WHERE organization_id = ANY($1::uuid[]) OR location_id = ANY($2::uuid[])`, [organizations, locations]);
      await client.query(`DELETE FROM public.location_addresses WHERE location_id = ANY($1::uuid[])`, [locations]);
      await client.query(`DELETE FROM public.locations WHERE id = ANY($1::uuid[])`, [locations]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const table of TABLES) {
        await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${table === "organization_location_assignments" ? "organization_location_assignments_no_delete" : `${table}_no_delete`}`);
      }
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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `LOC ${label} ${run} ${++counter}`]);
    organizations.push(id);
    return id;
  }

  async function staff(...capabilities: Array<"ORGANIZATION_UPDATE" | "ORGANIZATION_REGISTRY_READ">): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    return actor;
  }
  const signIn = (actor: TestActor) => K.db.setClerkUser(actor.clerkSubject);
  async function fullStaff() {
    const actor = await staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ");
    signIn(actor);
    return actor;
  }

  /** A unique, valid Calgary address. Every test address carries the run tag so purge() can find it. */
  const addr = (over: Record<string, unknown> = {}) => ({
    country: "CA",
    region: "AB",
    locality: "Calgary",
    postalCode: "T2E 1A1",
    addressLine1: `${100 + ++counter} Industrial Way ${run}`,
    ...over,
  });

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const denied = (promise: Promise<unknown>) => rejectsWith(promise, K.authz.TesAuthorizationDeniedError);

  async function eventsFor(resourceId: string) {
    return (await pools.admin.query<{ event_type: string; actor_id: string; target: Record<string, unknown>; change_set: unknown }>(
      `SELECT event_type, actor_id, target, change_set FROM public.master_register_events WHERE target ->> 'resourceId' = $1 ORDER BY recorded_at, event_id`,
      [resourceId],
    )).rows;
  }
  const eventCount = async (actorId: string) =>
    Number((await pools.admin.query(`SELECT count(*) FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId])).rows[0].count);
  const rowCount = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);

  /** Makes the Master Register refuse one event type (test-only trigger, removed by the scenario cleanup). */
  async function refuseMasterRegisterEvent(eventType: string) {
    await pools.admin.query(`
      CREATE OR REPLACE FUNCTION public.tes_test_fail_master_register() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = '${eventType}' THEN RAISE EXCEPTION 'test: master register write refused'; END IF;
        RETURN NEW;
      END $$`);
    await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
    await pools.admin.query(`CREATE TRIGGER tes_test_fail_master_register BEFORE INSERT ON public.master_register_events FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_master_register()`);
    if (!cleanups.some((cleanup) => cleanup.name === "removeMasterRegisterRefusal")) {
      cleanups.push(async function removeMasterRegisterRefusal() {
        await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
        await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_master_register()`);
      });
    }
  }


  const MONTH = (n: number) => `2020-${String(n).padStart(2, "0")}-01T00:00:00Z`;

  // =============================================================================================================
  describe("schema (migration 0012)", () => {
    scenario("tables, constraints, indexes and triggers exist; the ledger records 0012", async () => {
      const names = async (sql: string) => (await pools.admin.query<{ n: string }>(sql)).rows.map((row) => row.n);
      assert.deepEqual(
        await names(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('locations','location_addresses','organization_location_assignments') ORDER BY 1`),
        ["location_addresses", "locations", "organization_location_assignments"],
      );
      const constraints = await names(`SELECT conname AS n FROM pg_constraint WHERE conrelid IN ('public.locations'::regclass, 'public.location_addresses'::regclass, 'public.organization_location_assignments'::regclass)`);
      for (const expected of [
        "locations_kind_valid", "locations_status_valid", "locations_archive_state_consistent", "locations_id_kind_uq",
        "location_addresses_country_code_valid", "location_addresses_region_code_valid", "location_addresses_effective_window_valid",
        "location_addresses_correction_state_consistent", "location_addresses_not_superseded_by_self", "location_addresses_id_location_uq",
        "location_addresses_superseded_by_fk", "organization_location_assignments_location_fk", "organization_location_assignments_role_valid",
        "organization_location_assignments_home_yard_physical", "organization_location_assignments_effective_window_valid",
        "organization_location_assignments_end_state_consistent", "organization_location_assignments_status_valid",
        "organization_location_assignments_correction_state_consistent", "organization_location_assignments_not_superseded_by_self",
        "organization_location_assignments_id_org_role_uq", "organization_location_assignments_superseded_by_fk",
      ]) assert.ok(constraints.includes(expected), expected);
      const indexes = await names(`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('locations','location_addresses','organization_location_assignments')`);
      for (const expected of [
        "location_addresses_current_uq", "location_addresses_location_history_idx", "location_addresses_match_building_idx",
        "location_addresses_match_unit_idx", "organization_location_assignments_current_role_uq",
        "organization_location_assignments_org_history_idx", "organization_location_assignments_location_idx",
        "organization_location_assignments_id_org_role_uq",
      ]) assert.ok(indexes.includes(expected), expected);
      const triggers = await names(`SELECT tgname AS n FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.locations'::regclass, 'public.location_addresses'::regclass, 'public.organization_location_assignments'::regclass)`);
      for (const expected of [
        "locations_guard_update", "locations_require_current_address", "location_addresses_guard_update",
        "organization_location_assignments_guard_insert", "organization_location_assignments_guard_update",
        "locations_no_delete", "location_addresses_no_delete", "organization_location_assignments_no_delete",
        "locations_no_truncate", "location_addresses_no_truncate", "organization_location_assignments_no_truncate",
      ]) assert.ok(triggers.includes(expected), expected);

      const ledger = await pools.admin.query<{ sha256: string }>(`SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0012'`);
      assert.equal(ledger.rowCount, 1);
      const file = readFileSync(path.resolve(import.meta.dirname, "../../../database/migrations/0012_organization_locations_foundation.sql"));
      assert.equal(ledger.rows[0].sha256, createHash("sha256").update(file).digest("hex"));
    });

    scenario("geography is extensible: no CA/US restriction in the database, no coordinates or merge columns", async () => {
      const defs = (await pools.admin.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.location_addresses'::regclass AND conname IN ('location_addresses_country_code_valid','location_addresses_region_code_valid')`,
      )).rows.map((row) => row.def).join(" ");
      assert.doesNotMatch(defs, /'CA'|'US'|Canada|United States/);
      const columns = (await pools.admin.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('locations','location_addresses','organization_location_assignments')`,
      )).rows.map((row) => row.column_name);
      assert.deepEqual(columns.filter((name) => /merge|latitude|longitude|timezone|geo|source|confidence|external/i.test(name)), []);
      // a hypothetical new country is storable without a migration
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        const location = (await client.query<{ id: string }>(`INSERT INTO public.locations (kind) VALUES ('PHYSICAL') RETURNING id`)).rows[0].id;
        await client.query(
          `INSERT INTO public.location_addresses (location_id, country_code, region_code, locality, address_line_1, match_key_building, match_key_unit, version_reason, effective_from)
           VALUES ($1, 'MX', 'NLE', 'Monterrey', '1 Calle Uno', 'k', 'k', 'INITIAL', now())`,
          [location],
        );
        await client.query("COMMIT");
        // remove this one row set directly, lifting the no-delete triggers only inside this owner transaction
        await client.query("BEGIN");
        await client.query(`ALTER TABLE public.location_addresses DISABLE TRIGGER location_addresses_no_delete`);
        await client.query(`ALTER TABLE public.locations DISABLE TRIGGER locations_no_delete`);
        await client.query(`DELETE FROM public.location_addresses WHERE location_id = $1`, [location]);
        await client.query(`DELETE FROM public.locations WHERE id = $1`, [location]);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query(`ALTER TABLE public.location_addresses ENABLE TRIGGER location_addresses_no_delete`);
        await client.query(`ALTER TABLE public.locations ENABLE TRIGGER locations_no_delete`);
        await client.query("COMMIT");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });

    scenario("runtime privileges: no DELETE/TRUNCATE anywhere, no content rewrites, no RLS", async () => {
      const has = async (sql: string, params: unknown[]) => (await pools.admin.query<{ ok: boolean }>(sql, params)).rows[0].ok;
      for (const table of TABLES) {
        for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          assert.equal(await has(`SELECT has_table_privilege($1, $2, $3) AS ok`, [RUNTIME_ROLE, `public.${table}`, privilege]), false, `${table} ${privilege}`);
        }
        assert.equal(await has(`SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [RUNTIME_ROLE, `public.${table}`]), true);
        assert.equal((await pools.admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${table}`])).rows[0].relrowsecurity, false);
        // PUBLIC has nothing
        assert.equal(await has(`SELECT has_table_privilege('public', $1, 'SELECT') AS ok`, [`public.${table}`]), false);
      }
      const column = (table: string, name: string, privilege: string) =>
        has(`SELECT has_column_privilege($1, $2, $3, $4) AS ok`, [RUNTIME_ROLE, `public.${table}`, name, privilege]);
      for (const name of ["address_line_1", "locality", "country_code", "match_key_building", "location_id", "effective_from", "version_reason"]) {
        assert.equal(await column("location_addresses", name, "UPDATE"), false, `addresses.${name}`);
      }
      for (const name of ["effective_to", "status", "corrected_at", "superseded_by_address_id"]) assert.equal(await column("location_addresses", name, "UPDATE"), true, name);
      assert.equal(await column("locations", "kind", "UPDATE"), false);
      assert.equal(await column("locations", "status", "UPDATE"), true);
      for (const name of ["organization_id", "location_id", "role", "effective_from", "created_at"]) assert.equal(await column("organization_location_assignments", name, "UPDATE"), false, name);
      assert.equal(await column("organization_location_assignments", "effective_to", "UPDATE"), true);
      for (const name of ["end_reason", "status", "corrected_at", "superseded_by_assignment_id"]) assert.equal(await column("organization_location_assignments", name, "UPDATE"), true, name);
      for (const table of TABLES) {
        await assert.rejects(pools.runtime.query(`DELETE FROM public.${table}`), /permission denied/, table);
        await assert.rejects(pools.runtime.query(`TRUNCATE public.${table}`), /permission denied/, table);
      }
    });

    scenario("database backstops hold even for the table owner", async () => {
      const client = await pools.admin.connect();
      const expectFailure = async (sql: string, params: unknown[], pattern: RegExp) => {
        await client.query("SAVEPOINT s");
        await assert.rejects(client.query(sql, params), pattern, sql);
        await client.query("ROLLBACK TO SAVEPOINT s");
      };
      try {
        await client.query("BEGIN");
        const physical = (await client.query<{ id: string }>(`INSERT INTO public.locations (kind) VALUES ('PHYSICAL') RETURNING id`)).rows[0].id;
        const postal = (await client.query<{ id: string }>(`INSERT INTO public.locations (kind) VALUES ('POSTAL_ONLY') RETURNING id`)).rows[0].id;
        const insertAddress = (locationId: string, extra = "") =>
          client.query<{ id: string }>(
            `INSERT INTO public.location_addresses (location_id, country_code, region_code, locality, address_line_1, match_key_building, match_key_unit, version_reason, effective_from${extra ? ", status, corrected_at, superseded_by_address_id" : ""})
             VALUES ($1, 'CA', 'AB', 'Calgary', 'A ${run}', 'k', 'k', 'INITIAL', '2020-01-01Z'${extra ? `, ${extra}` : ""}) RETURNING id`,
            [locationId],
          );
        const physicalAddress = (await insertAddress(physical)).rows[0].id;
        await insertAddress(postal);
        const orgId = randomUUID();
        organizations.push(orgId);
        await client.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, 'Backstop ${run}', 'backstop')`, [orgId]);
        const assign = (location: string, kind: string, role: string, from = "2020-01-01Z") =>
          client.query(`INSERT INTO public.organization_location_assignments (organization_id, location_id, location_kind, role, effective_from) VALUES ($1, $2, $3, $4, $5)`, [orgId, location, kind, role, from]);

        // HOME_YARD requires a PHYSICAL Location (declarative, via the composite foreign key + check)
        await expectFailure(`INSERT INTO public.organization_location_assignments (organization_id, location_id, location_kind, role, effective_from) VALUES ($1, $2, 'POSTAL_ONLY', 'HOME_YARD', now())`, [orgId, postal], /home_yard_physical/);
        // a lying location_kind is rejected by the composite foreign key
        await expectFailure(`INSERT INTO public.organization_location_assignments (organization_id, location_id, location_kind, role, effective_from) VALUES ($1, $2, 'PHYSICAL', 'HOME_YARD', now())`, [orgId, postal], /location_fk/);
        await assign(physical, "PHYSICAL", "HOME_YARD");
        // one CURRENT assignment per Organization per role (final concurrency backstop)
        await expectFailure(`INSERT INTO public.organization_location_assignments (organization_id, location_id, location_kind, role, effective_from) VALUES ($1, $2, 'PHYSICAL', 'HOME_YARD', now())`, [orgId, physical], /current_role_uq/);
        // ...but the same Location can carry several roles
        await assign(physical, "PHYSICAL", "REGISTERED");
        await assign(physical, "PHYSICAL", "MAILING");
        // one CURRENT address version per Location
        await expectFailure(`INSERT INTO public.location_addresses (location_id, country_code, region_code, locality, address_line_1, match_key_building, match_key_unit, version_reason, effective_from) VALUES ($1, 'CA', 'AB', 'X', 'B ${run}', 'k', 'k', 'INITIAL', now())`, [physical], /current_uq/);
        // address content is immutable, corrected rows are frozen, an ended window cannot be re-dated
        await expectFailure(`UPDATE public.location_addresses SET address_line_1 = 'changed' WHERE id = $1`, [physicalAddress], /immutable/);
        await expectFailure(`UPDATE public.location_addresses SET effective_to = '2019-01-01Z' WHERE id = $1`, [physicalAddress], /effective_window_valid/);
        // assignment identity is immutable
        await expectFailure(`UPDATE public.organization_location_assignments SET role = 'MAILING' WHERE organization_id = $1 AND role = 'HOME_YARD'`, [orgId], /immutable/);
        // a Location with a current assignment cannot be archived; kind and identity are immutable
        await expectFailure(`UPDATE public.locations SET status = 'archived', archived_at = now() WHERE id = $1`, [physical], /cannot be archived/);
        await expectFailure(`UPDATE public.locations SET kind = 'POSTAL_ONLY' WHERE id = $1`, [physical], /immutable|location_fk/);
        // no hard delete or truncate, even for the owner
        await expectFailure(`DELETE FROM public.location_addresses WHERE id = $1`, [physicalAddress], /preserved/);
        await expectFailure(`DELETE FROM public.organization_location_assignments WHERE organization_id = $1`, [orgId], /preserved/);
        await expectFailure(`DELETE FROM public.locations WHERE id = $1`, [physical], /preserved/);
        // an assignment cannot reference an archived Location
        await client.query(`UPDATE public.organization_location_assignments SET effective_to = now() + interval '1 second', end_reason = 'CEASED' WHERE organization_id = $1`, [orgId]);
        await client.query(`UPDATE public.locations SET status = 'archived', archived_at = now() WHERE id = $1`, [physical]);
        await expectFailure(`INSERT INTO public.organization_location_assignments (organization_id, location_id, location_kind, role, effective_from) VALUES ($1, $2, 'PHYSICAL', 'HOME_YARD', now() + interval '1 hour')`, [orgId, physical], /active Location/);
        // an ended assignment cannot be changed
        await expectFailure(`UPDATE public.organization_location_assignments SET effective_to = now() + interval '1 year' WHERE organization_id = $1`, [orgId], /cannot be changed/);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });

    scenario("TRUNCATE is refused even for the table owner", async () => {
      for (const table of TABLES) {
        const client = await pools.admin.connect();
        try {
          await client.query("BEGIN");
          await assert.rejects(client.query(`TRUNCATE public.${table} CASCADE`), /preserved/, table);
        } finally {
          await client.query("ROLLBACK").catch(() => undefined);
          client.release();
        }
      }
    });

    scenario("a Location without a current address cannot be committed", async () => {
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        await client.query(`INSERT INTO public.locations (kind) VALUES ('PHYSICAL')`);
        await assert.rejects(client.query("COMMIT"), /must have a current address/);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
  });

  // =============================================================================================================
  describe("locations and addresses", () => {
    scenario("create a PHYSICAL Location with its initial address; displayable values are stored exactly", async () => {
      const actor = await fullStaff();
      const input = addr({ postalCode: " t2e  1a1 ", unit: "Suite 100", addressLine2: "Building B" });
      const { location, assignment, matches } = await K.loc.createLocation({ kind: "PHYSICAL", address: input as never });
      assert.equal(location.kind, "PHYSICAL");
      assert.equal(location.status, "active");
      assert.equal(assignment, null);
      assert.deepEqual(matches, []);
      const current = location.currentAddress!;
      assert.equal(current.versionReason, "INITIAL");
      assert.equal(current.status, "active");
      assert.equal(current.effectiveTo, null);
      assert.equal(current.postalCode, "t2e 1a1");
      assert.equal(current.unit, "Suite 100");
      assert.equal(current.addressLine2, "Building B");
      assert.equal(current.country, "CA");
      const stored = (await pools.admin.query(`SELECT postal_code_normalized, match_key_building, match_key_unit FROM public.location_addresses WHERE id = $1`, [current.id])).rows[0];
      assert.equal(stored.postal_code_normalized, "T2E1A1");
      assert.match(stored.match_key_building, /^CA\|AB\|CALGARY\|T2E1A1\|/);
      assert.ok(stored.match_key_unit.startsWith(stored.match_key_building));
      const events = await eventsFor(location.id);
      assert.deepEqual(events.map((event) => event.event_type), ["RECORD_CREATED"]);
      assert.equal(events[0].actor_id, actor.actorId);
    });

    scenario("create a POSTAL_ONLY Location (PO box / service address)", async () => {
      await fullStaff();
      const { location } = await K.loc.createLocation({ kind: "POSTAL_ONLY", address: addr({ addressLine1: `PO Box 77 ${run}` }) as never });
      assert.equal(location.kind, "POSTAL_ONLY");
      assert.ok(location.currentAddress);
    });

    scenario("invalid addresses fail at the service boundary and create nothing", async () => {
      await fullStaff();
      const before = await rowCount(`SELECT count(*) FROM public.locations`);
      const bad: Array<[string, unknown]> = [
        ["unsupported country", addr({ country: "MX", region: "NLE" })],
        ["country by name", addr({ country: "Canada" })],
        ["region of another country", addr({ region: "TX" })],
        ["bad postal", addr({ postalCode: "12345" })],
        ["blank locality", addr({ locality: " " })],
        ["smuggled match key", addr({ matchKeyBuilding: "x" })],
        ["smuggled coordinates", addr({ latitude: 51.04, longitude: -114.07 })],
        ["smuggled timezone", addr({ timezone: "America/Edmonton" })],
      ];
      for (const [label, address] of bad) {
        await assert.rejects(K.loc.createLocation({ kind: "PHYSICAL", address: address as never }), (error: unknown) => {
          assert.ok(error instanceof K.loc.OrganizationLocationValidationError, `${label}: ${String(error)}`);
          return true;
        });
      }
      await rejectsWith(K.loc.createLocation({ kind: "WAREHOUSE" as never, address: addr() as never }), K.loc.OrganizationLocationValidationError);
      await rejectsWith(K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, status: "archived" } as never), K.loc.OrganizationLocationValidationError);
      assert.equal(await rowCount(`SELECT count(*) FROM public.locations`), before);
    });

    scenario("identical normalized addresses never force or merge Locations", async () => {
      await fullStaff();
      const address = addr();
      const first = await K.loc.createLocation({ kind: "PHYSICAL", address: address as never });
      const second = await K.loc.createLocation({ kind: "PHYSICAL", address: { ...address, addressLine1: String(address.addressLine1).toLowerCase() } as never });
      assert.notEqual(first.location.id, second.location.id);
      assert.equal(second.matches.length, 1, "the earlier Location is suggested, never reused automatically");
      assert.equal(second.matches[0].location.id, first.location.id);
      assert.equal(second.matches[0].unitMatch, true);
      assert.equal(await rowCount(`SELECT count(*) FROM public.location_addresses WHERE match_key_building = (SELECT match_key_building FROM public.location_addresses WHERE id = $1) AND status = 'active' AND effective_to IS NULL`, [first.location.currentAddress!.id]), 2);
    });

    scenario("distinct units at one building stay distinct Locations; matching is advisory and separates building from unit", async () => {
      await fullStaff();
      const street = addr();
      const s100 = await K.loc.createLocation({ kind: "PHYSICAL", address: { ...street, unit: "Suite 100" } as never });
      const s200 = await K.loc.createLocation({ kind: "PHYSICAL", address: { ...street, unit: "Suite 200" } as never });
      assert.notEqual(s100.location.id, s200.location.id);
      assert.equal(s200.matches.length, 1);
      assert.equal(s200.matches[0].buildingMatch, true);
      assert.equal(s200.matches[0].unitMatch, false);

      const again = await K.loc.createLocation({ kind: "PHYSICAL", address: { ...street, unit: "STE 100" } as never });
      assert.equal(again.matches.length, 2);
      assert.equal(again.matches[0].unitMatch, true, "the same unit sorts first");
      assert.equal(again.matches[0].location.id, s100.location.id);
      assert.equal(again.matches[1].unitMatch, false);

      const lookup = await K.loc.findLocationMatches({ ...street, addressLine1: String(street.addressLine1).replace("Way", "Wy") } as never);
      assert.equal(lookup.length, 0, "a different street spelling is not a match");
      const spelled = await K.loc.findLocationMatches({ ...street, unit: "100", postalCode: "t2e1a1" } as never);
      assert.equal(spelled.length, 3);
    });
  });

  // =============================================================================================================
  describe("Registered, Mailing and Home Yard", () => {
    scenario("establish REGISTERED with an initial Location in one transaction", async () => {
      const actor = await fullStaff();
      const a = await org("A");
      const { location, assignment, endedAssignment } = await K.loc.createLocation({
        kind: "POSTAL_ONLY",
        address: addr() as never,
        assignment: { organizationId: a, role: "REGISTERED" },
      });
      assert.equal(endedAssignment, null);
      assert.equal(assignment!.role, "REGISTERED");
      assert.equal(assignment!.locationId, location.id);
      assert.equal(assignment!.effectiveTo, null);
      assert.equal(assignment!.endReason, null);
      const view = await K.loc.getOrganizationLocations(a);
      assert.equal(view.current.REGISTERED?.location.id, location.id);
      assert.equal(view.current.REGISTERED?.address?.id, location.currentAddress!.id);
      assert.equal(view.current.MAILING, null);
      assert.equal(view.current.HOME_YARD, null);
      assert.deepEqual((await eventsFor(assignment!.id)).map((event) => event.event_type), ["RECORD_LINK_ESTABLISHED"]);
      assert.equal((await eventsFor(assignment!.id))[0].actor_id, actor.actorId);
    });

    scenario("a REGISTERED change ends the old assignment and starts the new one atomically, preserving history", async () => {
      await fullStaff();
      const a = await org("A");
      const one = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "REGISTERED" } });
      const two = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "REGISTERED" } });

      assert.equal(two.endedAssignment?.id, one.assignment!.id);
      assert.equal(two.endedAssignment?.endReason, "CHANGED");
      assert.equal(two.endedAssignment?.effectiveTo, two.assignment!.effectiveFrom, "the old role ends exactly when the new one starts");
      const view = await K.loc.getOrganizationLocations(a);
      assert.equal(view.current.REGISTERED?.location.id, two.location.id);
      assert.equal(view.history.length, 2);
      assert.deepEqual(view.history.map((entry) => entry.assignment.locationId), [two.location.id, one.location.id]);
      assert.equal(view.history[1].assignment.endReason, "CHANGED");
      assert.deepEqual((await eventsFor(one.assignment!.id)).map((event) => event.event_type), ["RECORD_LINK_ESTABLISHED", "RECORD_LINK_REMOVED"]);
      assert.deepEqual((await eventsFor(two.assignment!.id)).map((event) => event.event_type), ["RECORD_LINK_ESTABLISHED"]);
    });

    scenario("the same role cannot be assigned to the Location it already holds", async () => {
      await fullStaff();
      const a = await org("A");
      const one = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "REGISTERED" } });
      await rejectsWith(K.loc.assignLocation({ organizationId: a, role: "REGISTERED", locationId: one.location.id }), K.loc.OrganizationLocationStateError);
    });

    scenario("MAILING: same Location as REGISTERED without duplication; a Registered change never moves Mailing", async () => {
      await fullStaff();
      const a = await org("A");
      const first = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "REGISTERED" } });
      const mailing = await K.loc.assignLocation({ organizationId: a, role: "MAILING", locationId: first.location.id });
      assert.equal(mailing.assignment.locationId, first.location.id, "same as Registered = the same Location");
      assert.equal(await rowCount(`SELECT count(*) FROM public.locations l JOIN public.location_addresses a ON a.location_id = l.id WHERE a.address_line_1 = $1`, [first.location.currentAddress!.addressLine1]), 1);

      const moved = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "REGISTERED" } });
      const view = await K.loc.getOrganizationLocations(a);
      assert.equal(view.current.REGISTERED?.location.id, moved.location.id);
      assert.equal(view.current.MAILING?.location.id, first.location.id, "Mailing did not follow Registered");
      assert.equal(view.current.MAILING?.assignment.id, mailing.assignment.id);
      assert.equal(view.current.MAILING?.assignment.effectiveTo, null);

      const independent = await K.loc.createLocation({ kind: "POSTAL_ONLY", address: addr() as never, assignment: { organizationId: a, role: "MAILING" } });
      const after = await K.loc.getOrganizationLocations(a);
      assert.equal(after.current.MAILING?.location.id, independent.location.id);
      assert.equal(after.current.REGISTERED?.location.id, moved.location.id, "an independent Mailing change leaves Registered alone");
    });

    scenario("HOME_YARD requires a PHYSICAL Location (service and database)", async () => {
      await fullStaff();
      const a = await org("A");
      const before = await rowCount(`SELECT count(*) FROM public.locations`);
      await rejectsWith(
        K.loc.createLocation({ kind: "POSTAL_ONLY", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } }),
        K.loc.OrganizationLocationValidationError,
      );
      assert.equal(await rowCount(`SELECT count(*) FROM public.locations`), before, "nothing was created");
      const postal = await K.loc.createLocation({ kind: "POSTAL_ONLY", address: addr() as never, assignment: { organizationId: a, role: "MAILING" } });
      await rejectsWith(K.loc.assignLocation({ organizationId: a, role: "HOME_YARD", locationId: postal.location.id }), K.loc.OrganizationLocationValidationError);
      const physical = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      assert.equal(physical.assignment?.role, "HOME_YARD");
    });

    scenario("Home Yard move retains history; returning to a former yard creates a NEW assignment on the same Location", async () => {
      await fullStaff();
      const a = await org("A");
      const yard1 = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(1) } });
      const yard2 = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(6) } });
      assert.equal(yard2.endedAssignment?.id, yard1.assignment!.id);
      assert.ok(yard2.endedAssignment?.effectiveTo?.startsWith("2020-06-01T00:00:00"));

      const back = await K.loc.assignLocation({ organizationId: a, role: "HOME_YARD", locationId: yard1.location.id, effectiveFrom: MONTH(11) });
      assert.equal(back.assignment.locationId, yard1.location.id);
      assert.notEqual(back.assignment.id, yard1.assignment!.id, "a NEW assignment, not a reopened one");
      assert.equal(back.endedAssignment?.id, yard2.assignment!.id);

      const view = await K.loc.getOrganizationLocations(a);
      assert.equal(view.history.length, 3);
      assert.equal(view.current.HOME_YARD?.assignment.id, back.assignment.id);
      const first = view.history.find((entry) => entry.assignment.id === yard1.assignment!.id)!;
      assert.ok(first.assignment.effectiveTo?.startsWith("2020-06-01T00:00:00"), "the original stint is unchanged");
      assert.equal(first.assignment.endReason, "CHANGED");
      assert.equal(view.history.filter((entry) => entry.assignment.locationId === yard1.location.id).length, 2);
      assert.equal(await rowCount(`SELECT count(*) FROM public.locations WHERE id = $1`, [yard1.location.id]), 1, "the Location itself was reused, never duplicated");
    });

    scenario("a Location is shared across Organizations without duplication; roles are independent per Organization", async () => {
      await fullStaff();
      const a = await org("A");
      const b = await org("B");
      const yard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      const shared = await K.loc.assignLocation({ organizationId: b, role: "HOME_YARD", locationId: yard.location.id });
      assert.equal(shared.assignment.locationId, yard.location.id);
      const viewA = await K.loc.getOrganizationLocations(a);
      const viewB = await K.loc.getOrganizationLocations(b);
      assert.equal(viewA.current.HOME_YARD?.location.id, viewB.current.HOME_YARD?.location.id);
      assert.notEqual(viewA.current.HOME_YARD?.assignment.id, viewB.current.HOME_YARD?.assignment.id);

      // B moving away does not touch A
      await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: b, role: "HOME_YARD" } });
      assert.equal((await K.loc.getOrganizationLocations(a)).current.HOME_YARD?.assignment.effectiveTo, null);

      const matches = await K.loc.findLocationMatches({ country: "CA", region: "AB", locality: "Calgary", postalCode: "T2E 1A1", addressLine1: yard.location.currentAddress!.addressLine1 } as never);
      assert.deepEqual(matches[0].currentOrganizationIds, [a]);
    });

    scenario("ending an assignment records CEASED and leaves history; there is no hard delete path", async () => {
      await fullStaff();
      const a = await org("A");
      const yard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(1) } });
      const ended = await K.loc.endAssignment({ organizationId: a, role: "HOME_YARD", effectiveTo: MONTH(9) });
      assert.equal(ended.id, yard.assignment!.id);
      assert.equal(ended.endReason, "CEASED");
      assert.ok(ended.effectiveTo?.startsWith("2020-09-01T00:00:00"));
      const view = await K.loc.getOrganizationLocations(a);
      assert.equal(view.current.HOME_YARD, null);
      assert.equal(view.history.length, 1);
      assert.deepEqual((await eventsFor(yard.assignment!.id)).map((event) => event.event_type), ["RECORD_LINK_ESTABLISHED", "RECORD_LINK_REMOVED"]);
      await rejectsWith(K.loc.endAssignment({ organizationId: a, role: "HOME_YARD" }), K.loc.OrganizationLocationNotFoundError);
      await rejectsWith(K.loc.endAssignment({ organizationId: a, role: "MAILING" }), K.loc.OrganizationLocationNotFoundError);
      assert.deepEqual(Object.keys(K.loc).filter((key) => /delete|remove|destroy|merge/i.test(key)), []);
    });

    /** Several DIFFERENT actors, so the calls genuinely overlap (one actor's authorization step would serialize them). */
    async function concurrentActors(count: number) {
      const actors = await Promise.all(Array.from({ length: count }, () => staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ")));
      return <T>(index: number, work: () => Promise<T>) => K.db.withClerkUser(actors[index].clerkSubject, work);
    }

    scenario("one current assignment per role under real concurrency (distinct actors)", async () => {
      await fullStaff();
      const a = await org("A");
      await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      const extra = await Promise.all([1, 2, 3, 4].map(() => K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never })));
      const as = await concurrentActors(extra.length);
      const results = await Promise.all(
        extra.map((created, index) => as(index, () => K.loc.assignLocation({ organizationId: a, role: "HOME_YARD", locationId: created.location.id }))),
      );
      assert.equal(results.length, 4, "every concurrent change succeeded, serialized by the Organization lock");
      const rows = (await pools.admin.query<{ effective_from: Date; effective_to: Date | null; end_reason: string | null }>(
        `SELECT effective_from, effective_to, end_reason FROM public.organization_location_assignments WHERE organization_id = $1 AND role = 'HOME_YARD' ORDER BY effective_from`,
        [a],
      )).rows;
      assert.equal(rows.length, 5);
      assert.equal(rows.filter((row) => row.effective_to === null).length, 1, "exactly one current Home Yard");
      for (let index = 0; index < rows.length - 1; index += 1) {
        assert.equal(rows[index].end_reason, "CHANGED");
        assert.equal(rows[index].effective_to?.getTime(), rows[index + 1].effective_from.getTime(), "a gapless, non-overlapping chain");
      }
    });

    scenario("concurrent REGISTERED creations for one Organization also end with exactly one current assignment", async () => {
      await fullStaff();
      const a = await org("A");
      const as = await concurrentActors(3);
      await Promise.all([0, 1, 2].map((index) => as(index, () => K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "REGISTERED" } }))));
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1 AND role = 'REGISTERED' AND effective_to IS NULL`, [a]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1 AND role = 'REGISTERED'`, [a]), 3);
    });

    scenario("concurrent correction and real-world change of one Location leave exactly one current address", async () => {
      await fullStaff();
      const a = await org("A");
      const created = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(1) } });
      const as = await concurrentActors(2);
      const outcomes = await Promise.allSettled([
        as(0, () => K.loc.correctLocationAddress({ organizationId: a, locationId: created.location.id, address: addr() as never })),
        as(1, () => K.loc.changeLocationAddress({ organizationId: a, locationId: created.location.id, address: addr() as never, effectiveFrom: "2021-01-01T00:00:00Z" })),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 2, "the Location row lock serializes them");
      assert.equal(await rowCount(`SELECT count(*) FROM public.location_addresses WHERE location_id = $1 AND status = 'active' AND effective_to IS NULL`, [created.location.id]), 1);
    });

    scenario("archived Organizations are read-only for locations; unknown Organizations are not found", async () => {
      await fullStaff();
      const a = await org("A");
      const yard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [a]);
      await rejectsWith(K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "MAILING" } }), K.loc.OrganizationLocationStateError);
      await rejectsWith(K.loc.assignLocation({ organizationId: a, role: "MAILING", locationId: yard.location.id }), K.loc.OrganizationLocationStateError);
      await rejectsWith(K.loc.endAssignment({ organizationId: a, role: "HOME_YARD" }), K.loc.OrganizationLocationStateError);
      assert.equal((await K.loc.getOrganizationLocations(a)).current.HOME_YARD?.location.id, yard.location.id, "archiving an Organization does not end its assignments");
      await rejectsWith(K.loc.assignLocation({ organizationId: randomUUID(), role: "MAILING", locationId: yard.location.id }), K.loc.OrganizationLocationNotFoundError);
    });
  });

  // =============================================================================================================
  describe("history: business time, real-world change, correction", () => {
    scenario("backdated effective_from is accepted while created_at stays the real creation time; the future is refused", async () => {
      await fullStaff();
      const a = await org("A");
      const { assignment, location } = await K.loc.createLocation({
        kind: "PHYSICAL",
        address: addr() as never,
        assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: "2018-04-05T12:00:00Z" },
      });
      assert.ok(assignment!.effectiveFrom.startsWith("2018-04-05T12:00:00"));
      assert.ok(location.currentAddress!.effectiveFrom.startsWith("2018-04-05T12:00:00"), "the initial address is true from the assignment's business time");
      for (const record of [assignment!.createdAt, location.createdAt, location.currentAddress!.createdAt]) {
        assert.ok(Math.abs(Date.now() - new Date(record).getTime()) < 60_000, `created_at ${record} must be the real creation time`);
      }
      const future = new Date(Date.now() + 86_400_000).toISOString();
      await rejectsWith(
        K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "MAILING", effectiveFrom: future } }),
        K.loc.OrganizationLocationValidationError,
      );
      await rejectsWith(K.loc.endAssignment({ organizationId: a, role: "HOME_YARD", effectiveTo: future }), K.loc.OrganizationLocationValidationError);
      await rejectsWith(K.loc.endAssignment({ organizationId: a, role: "HOME_YARD", effectiveTo: "2018-04-05T12:00:00Z" }), K.loc.OrganizationLocationValidationError);
      await rejectsWith(
        K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: "2010-01-01T00:00:00Z" } }),
        K.loc.OrganizationLocationValidationError,
      );
      await rejectsWith(
        K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "MAILING", effectiveFrom: "yesterday" } }),
        K.loc.OrganizationLocationValidationError,
      );
    });

    scenario("as-of views answer from business time across role changes", async () => {
      await fullStaff();
      const a = await org("A");
      const yard1 = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(1) } });
      const yard2 = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(6) } });
      const early = await K.loc.getOrganizationLocations(a, { asOf: "2020-03-15T00:00:00Z" });
      assert.equal(early.asOf?.assignments.HOME_YARD?.location.id, yard1.location.id);
      assert.equal(early.asOf?.assignments.HOME_YARD?.address?.addressLine1, yard1.location.currentAddress!.addressLine1);
      const late = await K.loc.getOrganizationLocations(a, { asOf: "2021-01-01T00:00:00Z" });
      assert.equal(late.asOf?.assignments.HOME_YARD?.location.id, yard2.location.id);
      const before = await K.loc.getOrganizationLocations(a, { asOf: "2019-01-01T00:00:00Z" });
      assert.equal(before.asOf?.assignments.HOME_YARD, null);
      assert.equal(before.current.HOME_YARD?.location.id, yard2.location.id);
      const boundary = await K.loc.getOrganizationLocations(a, { asOf: MONTH(6) });
      assert.equal(boundary.asOf?.assignments.HOME_YARD?.location.id, yard2.location.id, "[from, to): the new role holds at its own start instant");
    });

    scenario("REAL-WORLD change keeps both addresses as genuine history", async () => {
      await fullStaff();
      const a = await org("A");
      const created = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(1) } });
      const oldLine = created.location.currentAddress!.addressLine1;
      const newAddress = addr({ addressLine1: `${900 + counter} Renumbered Blvd ${run}` });
      const changed = await K.loc.changeLocationAddress({ organizationId: a, locationId: created.location.id, address: newAddress as never, effectiveFrom: "2022-06-01T00:00:00Z" });
      assert.equal(changed.address.versionReason, "POSTAL_CHANGE");
      assert.ok(changed.address.effectiveFrom.startsWith("2022-06-01T00:00:00"));
      assert.equal(changed.usedByOtherOrganizations, false);

      const view = await K.loc.getOrganizationLocations(a, { asOf: "2021-03-01T00:00:00Z" });
      assert.equal(view.asOf?.assignments.HOME_YARD?.address?.addressLine1, oldLine);
      assert.equal((await K.loc.getOrganizationLocations(a, { asOf: "2023-03-01T00:00:00Z" })).asOf?.assignments.HOME_YARD?.address?.addressLine1, newAddress.addressLine1);
      const now = await K.loc.getOrganizationLocations(a);
      assert.equal(now.current.HOME_YARD?.address?.id, changed.address.id);
      const versions = now.current.HOME_YARD!.versions;
      assert.equal(versions.length, 2);
      assert.deepEqual(versions.map((version) => version.status), ["active", "active"], "a real change makes no version 'corrected'");
      assert.ok(versions[0].effectiveTo?.startsWith("2022-06-01T00:00:00"));
      assert.equal(versions[0].effectiveTo, versions[1].effectiveFrom);
      assert.deepEqual((await eventsFor(changed.address.id)).map((event) => event.event_type), ["RECORD_UPDATED"]);

      // the change cannot pre-date the version it replaces, and an unchanged address is not a change
      await rejectsWith(
        K.loc.changeLocationAddress({ organizationId: a, locationId: created.location.id, address: addr() as never, effectiveFrom: "2019-01-01T00:00:00Z" }),
        K.loc.OrganizationLocationValidationError,
      );
      await rejectsWith(
        K.loc.changeLocationAddress({ organizationId: a, locationId: created.location.id, address: newAddress as never }),
        K.loc.OrganizationLocationValidationError,
      );
    });

    scenario("CORRECTION preserves the erroneous row, flags it, and never reports it as genuine history", async () => {
      const actor = await fullStaff();
      const a = await org("A");
      const wrong = addr({ addressLine1: `55 Wrong Street ${run}`, locality: "Edmonton", postalCode: "T5J 0N3" });
      const created = await K.loc.createLocation({ kind: "PHYSICAL", address: wrong as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: "2019-02-03T00:00:00Z" } });
      const wrongId = created.location.currentAddress!.id;
      const right = addr({ addressLine1: `56 Right Street ${run}`, locality: "Edmonton", postalCode: "T5J 0N4" });

      const corrected = await K.loc.correctLocationAddress({ organizationId: a, locationId: created.location.id, address: right as never });
      assert.equal(corrected.address.versionReason, "CORRECTION");
      assert.equal(corrected.address.status, "active");
      assert.equal(corrected.address.effectiveFrom, created.location.currentAddress!.effectiveFrom, "the replacement carries the business time of the version it corrects");
      assert.equal(corrected.address.effectiveTo, null);

      // The erroneous row is preserved byte-for-byte, flagged and linked.
      const old = (await pools.admin.query(`SELECT address_line_1, status, corrected_at, superseded_by_address_id, effective_to FROM public.location_addresses WHERE id = $1`, [wrongId])).rows[0];
      assert.equal(old.address_line_1, wrong.addressLine1);
      assert.equal(old.status, "corrected");
      assert.ok(old.corrected_at);
      assert.equal(old.superseded_by_address_id, corrected.address.id);
      assert.equal(old.effective_to, null, "a correction does not assert the wrong address ever ended");

      const view = await K.loc.getOrganizationLocations(a, { asOf: "2019-06-01T00:00:00Z" });
      assert.equal(view.asOf?.assignments.HOME_YARD?.address?.addressLine1, right.addressLine1, "as-of reads the corrected address");
      assert.equal(view.current.HOME_YARD?.address?.addressLine1, right.addressLine1);
      const versions = view.current.HOME_YARD!.versions;
      assert.equal(versions.length, 2);
      assert.deepEqual(versions.map((version) => version.status).sort(), ["active", "corrected"]);
      assert.ok(versions.find((version) => version.status === "corrected" && version.id === wrongId), "the wrong row stays visible, flagged");
      assert.equal(
        await rowCount(`SELECT count(*) FROM public.location_addresses WHERE location_id = $1 AND status = 'active' AND effective_to IS NULL`, [created.location.id]),
        1,
        "exactly one current version",
      );
      // The wrong row is frozen, even for the table owner.
      await assert.rejects(pools.admin.query(`UPDATE public.location_addresses SET effective_to = now() WHERE id = $1`, [wrongId]), /frozen/);

      const events = await eventsFor(corrected.address.id);
      assert.deepEqual(events.map((event) => event.event_type), ["RECORD_CORRECTED"]);
      assert.equal(events[0].actor_id, actor.actorId);
      assert.ok(JSON.stringify(events[0].change_set).includes(wrongId), "the corrected row is referenced");
      await rejectsWith(K.loc.correctLocationAddress({ organizationId: a, locationId: created.location.id, address: right as never }), K.loc.OrganizationLocationValidationError);
    });

    scenario("a correction after a real-world change corrects only the current version; earlier history is untouched", async () => {
      await fullStaff();
      const a = await org("A");
      const created = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(1) } });
      const original = created.location.currentAddress!.addressLine1;
      const moved = await K.loc.changeLocationAddress({ organizationId: a, locationId: created.location.id, address: addr({ addressLine1: `7 Typo Ave ${run}` }) as never, effectiveFrom: "2021-01-01T00:00:00Z" });
      const fixed = await K.loc.correctLocationAddress({ organizationId: a, locationId: created.location.id, address: addr({ addressLine1: `7 Fixed Ave ${run}` }) as never });
      assert.equal(fixed.address.effectiveFrom, moved.address.effectiveFrom);
      assert.equal((await K.loc.getOrganizationLocations(a, { asOf: "2020-07-01T00:00:00Z" })).asOf?.assignments.HOME_YARD?.address?.addressLine1, original);
      assert.equal((await K.loc.getOrganizationLocations(a, { asOf: "2021-07-01T00:00:00Z" })).asOf?.assignments.HOME_YARD?.address?.addressLine1, `7 Fixed Ave ${run}`);
      const versions = (await K.loc.getOrganizationLocations(a)).current.HOME_YARD!.versions;
      assert.deepEqual(versions.map((version) => [version.versionReason, version.status]), [
        ["INITIAL", "active"],
        ["POSTAL_CHANGE", "corrected"],
        ["CORRECTION", "active"],
      ]);
    });

    scenario("a shared Location's address change or correction applies to every Organization using it", async () => {
      await fullStaff();
      const a = await org("A");
      const b = await org("B");
      const yard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      await K.loc.assignLocation({ organizationId: b, role: "HOME_YARD", locationId: yard.location.id });
      const result = await K.loc.correctLocationAddress({ organizationId: a, locationId: yard.location.id, address: addr() as never });
      assert.equal(result.usedByOtherOrganizations, true);
      assert.equal((await K.loc.getOrganizationLocations(b)).current.HOME_YARD?.address?.id, result.address.id);
    });
  });

  // =============================================================================================================
  describe("assignment correction (a correction is not a real-world transition)", () => {
    const ROLES = ["REGISTERED", "MAILING", "HOME_YARD"] as const;

    for (const role of ROLES) {
      scenario(`wrong ${role} assignment: corrected without CEASED/CHANGED, preserved and flagged, never reported as genuine`, async () => {
        const actor = await fullStaff();
        const a = await org("A");
        const wrongLoc = await K.loc.createLocation({
          kind: "PHYSICAL",
          address: addr({ addressLine1: `${300 + ++counter} Wrong Yard Road ${run}` }) as never,
          assignment: { organizationId: a, role, effectiveFrom: "2020-02-01T00:00:00Z" },
        });
        const wrong = wrongLoc.assignment!;
        const rightLoc = await K.loc.createLocation({ kind: "PHYSICAL", address: addr({ addressLine1: `${300 + ++counter} Right Yard Road ${run}` }) as never });

        const result = await K.loc.correctAssignment({ organizationId: a, assignmentId: wrong.id, locationId: rightLoc.location.id });

        // the replacement is the actual business fact, with the original business time and the REAL creation time
        const replacement = result.assignment;
        assert.equal(replacement.role, role);
        assert.equal(replacement.locationId, rightLoc.location.id);
        assert.equal(replacement.status, "active");
        assert.equal(replacement.effectiveFrom, wrong.effectiveFrom, "inherits the original effective business time");
        assert.ok(replacement.effectiveFrom.startsWith("2020-02-01T00:00:00"));
        assert.equal(replacement.effectiveTo, null);
        assert.equal(replacement.endReason, null);
        assert.ok(Math.abs(Date.now() - new Date(replacement.createdAt).getTime()) < 60_000, "created_at is the real insertion time, never backdated");
        assert.ok(new Date(replacement.createdAt).getTime() > new Date(replacement.effectiveFrom).getTime());

        // the erroneous assignment is preserved, flagged, and was NOT ended
        const stored = (await pools.admin.query(`SELECT * FROM public.organization_location_assignments WHERE id = $1`, [wrong.id])).rows[0];
        assert.ok(stored, "the erroneous assignment is never erased");
        assert.equal(stored.status, "corrected");
        assert.equal(stored.superseded_by_assignment_id, replacement.id);
        assert.ok(stored.corrected_at);
        assert.equal(stored.effective_to, null, "a correction does not pretend the assignment ended");
        assert.equal(stored.end_reason, null, "neither CHANGED nor CEASED is invented");
        assert.equal(stored.location_id, wrongLoc.location.id);
        assert.equal(result.correctedAssignment.status, "corrected");
        assert.equal(result.correctedAssignment.createdAt, wrong.createdAt, "the original created_at is untouched");

        // normal reads
        const view = await K.loc.getOrganizationLocations(a, { asOf: "2020-06-01T00:00:00Z" });
        assert.equal(view.current[role]?.assignment.id, replacement.id, "current read excludes the corrected assignment");
        assert.equal(view.current[role]?.location.id, rightLoc.location.id);
        assert.equal(view.asOf?.assignments[role]?.assignment.id, replacement.id, "as-of read excludes the corrected assignment as business truth");
        assert.equal(view.asOf?.assignments[role]?.location.id, rightLoc.location.id);
        assert.equal((await K.loc.getOrganizationLocations(a, { asOf: "2020-01-15T00:00:00Z" })).asOf?.assignments[role], null);
        const customerView = JSON.stringify(view.current) + JSON.stringify(view.asOf);
        assert.equal(customerView.includes(wrongLoc.location.id), false, "the wrong Location is not business truth anywhere in current / as-of");

        // audit representation keeps it identifiable
        assert.equal(view.history.length, 2);
        const audit = view.history.find((entry) => entry.assignment.id === wrong.id)!;
        assert.equal(audit.assignment.status, "corrected");
        assert.equal(audit.assignment.supersededByAssignmentId, replacement.id);
        assert.ok(audit.assignment.correctedAt);
        assert.equal(audit.assignment.endReason, null);
        assert.equal(view.history.find((entry) => entry.assignment.id === replacement.id)?.assignment.status, "active");

        // Master Register: RECORD_CORRECTED, no fabricated lifecycle event
        assert.deepEqual((await eventsFor(replacement.id)).map((event) => event.event_type), ["RECORD_CORRECTED"]);
        assert.deepEqual((await eventsFor(wrong.id)).map((event) => event.event_type), ["RECORD_LINK_ESTABLISHED"], "no LINK_REMOVED for a correction");
        const event = (await eventsFor(replacement.id))[0];
        assert.equal(event.actor_id, actor.actorId);
        assert.ok(JSON.stringify(event.change_set).includes(wrong.id));
        assert.equal(JSON.stringify(event).includes("CEASED") || JSON.stringify(event).includes("CHANGED"), false);

        // a known-wrong assignment no longer pins its Location or grants visibility
        assert.deepEqual((await K.loc.findLocationMatches({ country: "CA", region: "AB", locality: "Calgary", postalCode: "T2E 1A1", addressLine1: wrongLoc.location.currentAddress!.addressLine1 } as never))[0].currentOrganizationIds, []);
        const archived = await K.loc.archiveLocation(wrongLoc.location.id);
        assert.equal(archived.status, "archived", "a corrected assignment does not block archiving the wrong Location");

        // twice is refused; the replacement can be changed or ended like any real assignment
        await rejectsWith(K.loc.correctAssignment({ organizationId: a, assignmentId: wrong.id, locationId: rightLoc.location.id }), K.loc.OrganizationLocationStateError);
      });
    }

    scenario("a corrected assignment grants no visibility: without registry read the wrong Location is no longer reusable", async () => {
      await fullStaff();
      const a = await org("A");
      const wrongYard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "MAILING" } });
      const right = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never });
      // before the correction the Organization has genuinely used the wrong Location, so it could return to it blind
      signIn(await staff("ORGANIZATION_UPDATE"));
      await K.loc.assignLocation({ organizationId: a, role: "REGISTERED", locationId: wrongYard.location.id });
      signIn(await staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ"));
      await K.loc.correctAssignment({ organizationId: a, assignmentId: wrongYard.assignment!.id, locationId: right.location.id });
      await K.loc.endAssignment({ organizationId: a, role: "REGISTERED" });
      // the REGISTERED stint (genuine) still counts as use, so isolate with a second Organization that only had the wrong row
      const b = await org("B");
      const bWrong = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: b, role: "HOME_YARD" } });
      await K.loc.correctAssignment({ organizationId: b, assignmentId: bWrong.assignment!.id, locationId: right.location.id });
      signIn(await staff("ORGANIZATION_UPDATE"));
      await rejectsWith(K.loc.assignLocation({ organizationId: b, role: "MAILING", locationId: bWrong.location.id }), K.loc.OrganizationLocationNotFoundError);
    });

    scenario("correcting a historical (already ended) assignment keeps its business window and the chain intact", async () => {
      await fullStaff();
      const a = await org("A");
      const wrongYard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(1) } });
      const second = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(6) } });
      const rightYard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never });

      const fixed = await K.loc.correctAssignment({ organizationId: a, assignmentId: wrongYard.assignment!.id, locationId: rightYard.location.id });
      assert.equal(fixed.assignment.effectiveFrom, wrongYard.assignment!.effectiveFrom);
      assert.ok(fixed.assignment.effectiveTo?.startsWith("2020-06-01T00:00:00"), "the replacement keeps the genuine end of the stint");
      assert.equal(fixed.assignment.endReason, "CHANGED", "the REAL transition to the next yard is still a real change");
      assert.equal(fixed.correctedAssignment.status, "corrected");
      assert.ok(fixed.correctedAssignment.effectiveTo?.startsWith("2020-06-01T00:00:00"), "the erroneous row is stored exactly as recorded");

      const early = await K.loc.getOrganizationLocations(a, { asOf: "2020-03-01T00:00:00Z" });
      assert.equal(early.asOf?.assignments.HOME_YARD?.location.id, rightYard.location.id);
      const late = await K.loc.getOrganizationLocations(a, { asOf: "2020-09-01T00:00:00Z" });
      assert.equal(late.asOf?.assignments.HOME_YARD?.location.id, second.location.id);
      const now = await K.loc.getOrganizationLocations(a);
      assert.equal(now.current.HOME_YARD?.assignment.id, second.assignment!.id, "the current assignment is untouched");
      assert.equal(now.history.length, 3);
      assert.deepEqual((await eventsFor(fixed.assignment.id)).map((event) => event.event_type), ["RECORD_CORRECTED"]);
    });

    scenario("a correction can create the right Location in the same transaction (no registry access needed)", async () => {
      const actor = await staff("ORGANIZATION_UPDATE");
      signIn(actor);
      const a = await org("A");
      const wrongYard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(3) } });
      const result = await K.loc.correctAssignment({
        organizationId: a,
        assignmentId: wrongYard.assignment!.id,
        location: { kind: "PHYSICAL", address: addr({ addressLine1: `${500 + ++counter} Correct Yard Road ${run}` }) as never },
      });
      assert.ok(result.createdLocation);
      assert.equal(result.assignment.locationId, result.createdLocation!.id);
      assert.ok(result.createdLocation!.currentAddress!.effectiveFrom.startsWith("2020-03-01T00:00:00"), "the new Location's address is true from the corrected business time");
      assert.deepEqual((await eventsFor(result.createdLocation!.id)).map((event) => event.event_type), ["RECORD_CREATED"]);
      assert.deepEqual((await eventsFor(result.assignment.id)).map((event) => event.event_type), ["RECORD_CORRECTED"]);
      await fullStaff();
      assert.equal((await K.loc.getOrganizationLocations(a)).current.HOME_YARD?.location.id, result.createdLocation!.id);
    });

    scenario("correction input is validated: role rules, exactly one target, ownership, disclosure, state", async () => {
      await fullStaff();
      const a = await org("A");
      const b = await org("B");
      const home = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      const mail = await K.loc.createLocation({ kind: "POSTAL_ONLY", address: addr() as never, assignment: { organizationId: a, role: "MAILING" } });
      const other = await K.loc.createLocation({ kind: "POSTAL_ONLY", address: addr() as never });
      const physical = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never });
      const locationsBefore = await rowCount(`SELECT count(*) FROM public.locations`);

      // a Home Yard can only be corrected to a PHYSICAL Location, and nothing is created on failure
      await rejectsWith(K.loc.correctAssignment({ organizationId: a, assignmentId: home.assignment!.id, locationId: other.location.id }), K.loc.OrganizationLocationValidationError);
      await rejectsWith(
        K.loc.correctAssignment({ organizationId: a, assignmentId: home.assignment!.id, location: { kind: "POSTAL_ONLY", address: addr() as never } }),
        K.loc.OrganizationLocationValidationError,
      );
      assert.equal(await rowCount(`SELECT count(*) FROM public.locations`), locationsBefore);
      // exactly one target; same Location is not a correction; foreign / unknown assignments are not found
      await rejectsWith(K.loc.correctAssignment({ organizationId: a, assignmentId: home.assignment!.id } as never), K.loc.OrganizationLocationValidationError);
      await rejectsWith(K.loc.correctAssignment({ organizationId: a, assignmentId: home.assignment!.id, locationId: physical.location.id, location: { kind: "PHYSICAL", address: addr() } } as never), K.loc.OrganizationLocationValidationError);
      await rejectsWith(K.loc.correctAssignment({ organizationId: a, assignmentId: home.assignment!.id, locationId: home.location.id }), K.loc.OrganizationLocationStateError);
      await rejectsWith(K.loc.correctAssignment({ organizationId: b, assignmentId: home.assignment!.id, locationId: physical.location.id }), K.loc.OrganizationLocationNotFoundError);
      await rejectsWith(K.loc.correctAssignment({ organizationId: a, assignmentId: randomUUID(), locationId: physical.location.id }), K.loc.OrganizationLocationNotFoundError);
      await rejectsWith(K.loc.correctAssignment({ organizationId: a, assignmentId: mail.assignment!.id, locationId: mail.location.id, status: "active" } as never), K.loc.OrganizationLocationValidationError);
      // an archived target cannot be assigned
      await K.loc.archiveLocation(physical.location.id);
      await rejectsWith(K.loc.correctAssignment({ organizationId: a, assignmentId: home.assignment!.id, locationId: physical.location.id }), K.loc.OrganizationLocationStateError);

      // without registry read: another Organization's Location is indistinguishable from a missing one
      const bYard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: b, role: "HOME_YARD" } });
      signIn(await staff("ORGANIZATION_UPDATE"));
      const message = async (locationId: string) => {
        try {
          await K.loc.correctAssignment({ organizationId: a, assignmentId: home.assignment!.id, locationId });
        } catch (error) {
          assert.ok(error instanceof K.loc.OrganizationLocationNotFoundError);
          return (error as Error).message;
        }
        assert.fail("expected NotFound");
      };
      assert.equal(await message(bYard.location.id), await message(randomUUID()));
      // archived Organization: read-only
      signIn(await staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ"));
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [a]);
      await rejectsWith(K.loc.correctAssignment({ organizationId: a, assignmentId: home.assignment!.id, locationId: bYard.location.id }), K.loc.OrganizationLocationStateError);
    });

    scenario("real-world change is unchanged by corrections: a later move ends the replacement with CHANGED and a link event", async () => {
      await fullStaff();
      const a = await org("A");
      const wrongYard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "REGISTERED", effectiveFrom: MONTH(1) } });
      const right = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never });
      const fixed = await K.loc.correctAssignment({ organizationId: a, assignmentId: wrongYard.assignment!.id, locationId: right.location.id });
      const moved = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "REGISTERED", effectiveFrom: MONTH(8) } });

      assert.equal(moved.endedAssignment?.id, fixed.assignment.id, "the real change ends the replacement, never the corrected row");
      assert.equal(moved.endedAssignment?.endReason, "CHANGED");
      assert.deepEqual((await eventsFor(fixed.assignment.id)).map((event) => event.event_type), ["RECORD_CORRECTED", "RECORD_LINK_REMOVED"]);
      const stored = (await pools.admin.query(`SELECT status, effective_to FROM public.organization_location_assignments WHERE id = $1`, [wrongYard.assignment!.id])).rows[0];
      assert.equal(stored.status, "corrected");
      assert.equal(stored.effective_to, null);
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1 AND role = 'REGISTERED' AND status = 'active' AND effective_to IS NULL`, [a]), 1);
    });

    scenario("a failed correction rolls back the status change, the replacement, a created Location and the Master Register event", async () => {
      const actor = await fullStaff();
      const a = await org("A");
      const wrongYard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(2) } });
      const eventsBefore = await eventCount(actor.actorId);
      const locationsBefore = await rowCount(`SELECT count(*) FROM public.locations`);
      const assignmentsBefore = await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1`, [a]);
      const marker = `${800 + ++counter} Rollback Yard Road ${run}`;

      await refuseMasterRegisterEvent("RECORD_CORRECTED");
      await assert.rejects(
        K.loc.correctAssignment({ organizationId: a, assignmentId: wrongYard.assignment!.id, location: { kind: "PHYSICAL", address: addr({ addressLine1: marker }) as never } }),
        /master register write refused/,
      );
      const stored = (await pools.admin.query(`SELECT status, corrected_at, superseded_by_assignment_id FROM public.organization_location_assignments WHERE id = $1`, [wrongYard.assignment!.id])).rows[0];
      assert.equal(stored.status, "active");
      assert.equal(stored.corrected_at, null);
      assert.equal(stored.superseded_by_assignment_id, null);
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1`, [a]), assignmentsBefore, "no replacement survived");
      assert.equal(await rowCount(`SELECT count(*) FROM public.locations`), locationsBefore, "the Location created for the correction rolled back too");
      assert.equal(await rowCount(`SELECT count(*) FROM public.location_addresses WHERE address_line_1 = $1`, [marker]), 0);
      assert.equal(await eventCount(actor.actorId), eventsBefore);
      assert.equal((await K.loc.getOrganizationLocations(a)).current.HOME_YARD?.assignment.id, wrongYard.assignment!.id);
    });

    scenario("concurrent correction and real-world change leave exactly one current assignment (either order)", async () => {
      await fullStaff();
      for (let round = 0; round < 3; round += 1) {
        const a = await org(`A${round}`);
        const wrongYard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD", effectiveFrom: MONTH(1) } });
        const right = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never });
        const next = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never });
        const actors = await Promise.all([staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ"), staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ")]);
        const outcomes = await Promise.allSettled([
          K.db.withClerkUser(actors[0].clerkSubject, () => K.loc.correctAssignment({ organizationId: a, assignmentId: wrongYard.assignment!.id, locationId: right.location.id })),
          K.db.withClerkUser(actors[1].clerkSubject, () => K.loc.assignLocation({ organizationId: a, role: "HOME_YARD", locationId: next.location.id })),
        ]);
        assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 2, `round ${round}: the Organization lock serializes both`);
        assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1 AND role = 'HOME_YARD' AND status = 'active' AND effective_to IS NULL`, [a]), 1);
        assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1 AND role = 'HOME_YARD' AND status = 'corrected'`, [a]), 1);
        const view = await K.loc.getOrganizationLocations(a);
        assert.equal(view.current.HOME_YARD?.location.id, next.location.id);
      }
    });

    scenario("two concurrent corrections of one assignment: exactly one wins, the other is a state error", async () => {
      await fullStaff();
      const a = await org("A");
      const wrongYard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "MAILING", effectiveFrom: MONTH(1) } });
      const one = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never });
      const two = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never });
      const actors = await Promise.all([staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ"), staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ")]);
      const outcomes = await Promise.allSettled([
        K.db.withClerkUser(actors[0].clerkSubject, () => K.loc.correctAssignment({ organizationId: a, assignmentId: wrongYard.assignment!.id, locationId: one.location.id })),
        K.db.withClerkUser(actors[1].clerkSubject, () => K.loc.correctAssignment({ organizationId: a, assignmentId: wrongYard.assignment!.id, locationId: two.location.id })),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
      assert.ok(rejected.reason instanceof K.loc.OrganizationLocationStateError);
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1 AND role = 'MAILING' AND status = 'active' AND effective_to IS NULL`, [a]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1 AND role = 'MAILING'`, [a]), 2);
    });

    scenario("database backstops for corrected assignments hold even for the table owner", async () => {
      const client = await pools.admin.connect();
      const expectFailure = async (sql: string, params: unknown[], pattern: RegExp) => {
        await client.query("SAVEPOINT s");
        await assert.rejects(client.query(sql, params), pattern, sql);
        await client.query("ROLLBACK TO SAVEPOINT s");
      };
      try {
        await client.query("BEGIN");
        const orgId = randomUUID();
        organizations.push(orgId);
        await client.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, 'Corr ${run}', 'corr')`, [orgId]);
        const newLocation = async () => {
          const id = (await client.query<{ id: string }>(`INSERT INTO public.locations (kind) VALUES ('PHYSICAL') RETURNING id`)).rows[0].id;
          await client.query(
            `INSERT INTO public.location_addresses (location_id, country_code, region_code, locality, address_line_1, match_key_building, match_key_unit, version_reason, effective_from)
             VALUES ($1, 'CA', 'AB', 'Calgary', 'C ${run}', 'k', 'k', 'INITIAL', '2020-01-01Z')`,
            [id],
          );
          return id;
        };
        const wrongLoc = await newLocation();
        const rightLoc = await newLocation();
        const wrongId = (await client.query<{ id: string }>(
          `INSERT INTO public.organization_location_assignments (organization_id, location_id, location_kind, role, effective_from) VALUES ($1, $2, 'PHYSICAL', 'HOME_YARD', '2020-02-01Z') RETURNING id`,
          [orgId, wrongLoc],
        )).rows[0].id;
        const replacementId = randomUUID();

        // a correction cannot also end the assignment (no invented lifecycle event)
        await expectFailure(`UPDATE public.organization_location_assignments SET status = 'corrected', corrected_at = now(), superseded_by_assignment_id = $2, effective_to = now(), end_reason = 'CEASED' WHERE id = $1`, [wrongId, replacementId], /does not end an assignment/);
        // a corrected state needs the pointer and timestamp
        await expectFailure(`UPDATE public.organization_location_assignments SET status = 'corrected' WHERE id = $1`, [wrongId], /correction_state_consistent/);
        await expectFailure(`UPDATE public.organization_location_assignments SET status = 'corrected', corrected_at = now(), superseded_by_assignment_id = id WHERE id = $1`, [wrongId], /not_superseded_by_self/);

        await client.query(`UPDATE public.organization_location_assignments SET status = 'corrected', corrected_at = now(), superseded_by_assignment_id = $2 WHERE id = $1`, [wrongId, replacementId]);
        // the slot is free for the replacement, which must be the same Organization and role (deferred foreign key checks at commit)
        await client.query(
          `INSERT INTO public.organization_location_assignments (id, organization_id, location_id, location_kind, role, effective_from) VALUES ($1, $2, $3, 'PHYSICAL', 'HOME_YARD', '2020-02-01Z')`,
          [replacementId, orgId, rightLoc],
        );
        // still exactly one current active assignment per role
        await expectFailure(`INSERT INTO public.organization_location_assignments (organization_id, location_id, location_kind, role, effective_from) VALUES ($1, $2, 'PHYSICAL', 'HOME_YARD', now())`, [orgId, wrongLoc], /current_role_uq/);
        // a corrected assignment is frozen and cannot be deleted
        await expectFailure(`UPDATE public.organization_location_assignments SET effective_to = now() WHERE id = $1`, [wrongId], /frozen/);
        await expectFailure(`UPDATE public.organization_location_assignments SET status = 'active', corrected_at = NULL, superseded_by_assignment_id = NULL WHERE id = $1`, [wrongId], /frozen/);
        await expectFailure(`DELETE FROM public.organization_location_assignments WHERE id = $1`, [wrongId], /preserved/);
        // the wrong Location is no longer pinned by the corrected row
        await client.query(`UPDATE public.locations SET status = 'archived', archived_at = now() WHERE id = $1`, [wrongLoc]);
        await expectFailure(`UPDATE public.locations SET status = 'archived', archived_at = now() WHERE id = $1`, [rightLoc], /cannot be archived/);
        // a replacement pointing at another Organization / role is rejected at constraint time
        const otherRole = randomUUID();
        await client.query(`UPDATE public.organization_location_assignments SET effective_to = now() + interval '1 second', end_reason = 'CEASED' WHERE id = $1`, [replacementId]);
        const fresh = (await client.query<{ id: string }>(
          `INSERT INTO public.organization_location_assignments (organization_id, location_id, location_kind, role, effective_from) VALUES ($1, $2, 'PHYSICAL', 'HOME_YARD', now() + interval '2 seconds') RETURNING id`,
          [orgId, rightLoc],
        )).rows[0].id;
        await client.query(`INSERT INTO public.organization_location_assignments (id, organization_id, location_id, location_kind, role, effective_from) VALUES ($1, $2, $3, 'PHYSICAL', 'MAILING', now())`, [otherRole, orgId, rightLoc]);
        await client.query(`UPDATE public.organization_location_assignments SET status = 'corrected', corrected_at = now(), superseded_by_assignment_id = $2 WHERE id = $1`, [fresh, otherRole]);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE").then(
          () => assert.fail("a replacement with a different role must be rejected"),
          (error: Error) => assert.match(error.message, /superseded_by_fk/),
        );
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
  });

  // =============================================================================================================
  describe("authorization, tenancy and disclosure", () => {
    scenario("every SYSTEM operation requires its own capability", async () => {
      await fullStaff();
      const a = await org("A");
      const yard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      const id = yard.location.id;

      const updateOnly = await staff("ORGANIZATION_UPDATE");
      const registryOnly = await staff("ORGANIZATION_REGISTRY_READ");
      const nothing = await staff();

      const mutations: Array<[string, () => Promise<unknown>]> = [
        ["createLocation", () => K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never })],
        ["assignLocation", () => K.loc.assignLocation({ organizationId: a, role: "MAILING", locationId: id })],
        ["endAssignment", () => K.loc.endAssignment({ organizationId: a, role: "HOME_YARD" })],
        ["changeLocationAddress", () => K.loc.changeLocationAddress({ organizationId: a, locationId: id, address: addr() as never })],
        ["correctLocationAddress", () => K.loc.correctLocationAddress({ organizationId: a, locationId: id, address: addr() as never })],
        ["archiveLocation", () => K.loc.archiveLocation(id)],
        ["restoreLocation", () => K.loc.restoreLocation(id)],
      ];
      const reads: Array<[string, () => Promise<unknown>]> = [
        ["findLocationMatches", () => K.loc.findLocationMatches(addr() as never)],
        ["getOrganizationLocations", () => K.loc.getOrganizationLocations(a)],
      ];
      for (const actor of [registryOnly, nothing]) {
        signIn(actor);
        for (const [label, call] of mutations) await assert.rejects(call(), (error: unknown) => error instanceof K.authz.TesAuthorizationDeniedError, `${label} without ORGANIZATION_UPDATE`);
      }
      for (const actor of [updateOnly, nothing]) {
        signIn(actor);
        for (const [label, call] of reads) await assert.rejects(call(), (error: unknown) => error instanceof K.authz.TesAuthorizationDeniedError, `${label} without ORGANIZATION_REGISTRY_READ`);
      }
      signIn(registryOnly);
      assert.equal((await K.loc.getOrganizationLocations(a)).current.HOME_YARD?.location.id, id);
      K.db.setClerkUser(null);
      await assert.rejects(K.loc.getOrganizationLocations(a));
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1`, [a]), 1, "denied calls changed nothing");
    });

    scenario("CUSTOMER ORGANIZATION_READ reads only its own Organization's locations and cannot search or mutate", async () => {
      await fullStaff();
      const customerA = await fx.organizationAndCustomer("CustA");
      const customerB = await fx.organizationAndCustomer("CustB");
      const yardA = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: customerA.organizationId, role: "HOME_YARD" } });
      const yardB = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: customerB.organizationId, role: "HOME_YARD" } });

      const user = await fx.actor();
      const relationshipId = await fx.relationship(user.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customerA.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      signIn(user);

      const own = await K.loc.readCustomerOrganizationLocations(customerA.customerId);
      assert.equal(own.organizationId, customerA.organizationId);
      assert.equal(own.current.HOME_YARD?.location.id, yardA.location.id);
      assert.equal(own.history.every((entry) => entry.assignment.organizationId === customerA.organizationId), true);
      assert.equal(JSON.stringify(own).includes(yardB.location.id), false, "no other Organization's Location appears");

      await denied(K.loc.readCustomerOrganizationLocations(customerB.customerId));
      await denied(K.loc.readCustomerOrganizationLocations(randomUUID()));
      // no customer-facing global search, registry read or mutation
      await denied(K.loc.findLocationMatches(addr() as never));
      await denied(K.loc.getOrganizationLocations(customerA.organizationId));
      await denied(K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never }));
      await denied(K.loc.assignLocation({ organizationId: customerA.organizationId, role: "MAILING", locationId: yardA.location.id }));
      await denied(K.loc.correctLocationAddress({ organizationId: customerA.organizationId, locationId: yardA.location.id, address: addr() as never }));
    });

    scenario("without ORGANIZATION_REGISTRY_READ there is no cross-Organization disclosure and no silent reuse", async () => {
      await fullStaff();
      const a = await org("A");
      const b = await org("B");
      const street = addr();
      const bYard = await K.loc.createLocation({ kind: "PHYSICAL", address: street as never, assignment: { organizationId: b, role: "HOME_YARD" } });

      const blind = await staff("ORGANIZATION_UPDATE");
      signIn(blind);

      // a creation that collides on the building key succeeds, with a SEPARATE Location, and reveals nothing
      const separate = await K.loc.createLocation({ kind: "PHYSICAL", address: street as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      assert.notEqual(separate.location.id, bYard.location.id);
      assert.deepEqual(separate.matches, []);
      assert.equal(JSON.stringify(separate).includes(b), false);

      // another Organization's Location is indistinguishable from a nonexistent one
      const messageFor = async (locationId: string) => {
        try {
          await K.loc.assignLocation({ organizationId: a, role: "MAILING", locationId });
        } catch (error) {
          assert.ok(error instanceof K.loc.OrganizationLocationNotFoundError);
          return (error as Error).message;
        }
        assert.fail("expected NotFound");
      };
      assert.equal(await messageFor(bYard.location.id), await messageFor(randomUUID()));
      await rejectsWith(K.loc.changeLocationAddress({ locationId: bYard.location.id, address: addr() as never }), K.loc.OrganizationLocationNotFoundError);
      await rejectsWith(K.loc.correctLocationAddress({ organizationId: a, locationId: bYard.location.id, address: addr() as never }), K.loc.OrganizationLocationNotFoundError);
      await rejectsWith(K.loc.archiveLocation(bYard.location.id), K.loc.OrganizationLocationNotFoundError);
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1 AND role = 'MAILING'`, [a]), 0);

      // an Organization may return to its OWN former Location without registry access
      await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      const back = await K.loc.assignLocation({ organizationId: a, role: "HOME_YARD", locationId: separate.location.id });
      assert.equal(back.assignment.locationId, separate.location.id);

      // revising its own Location works, and does not say whether anyone else uses it
      const own = await K.loc.correctLocationAddress({ organizationId: a, locationId: separate.location.id, address: addr() as never });
      assert.equal(own.usedByOtherOrganizations, undefined);

      // a registry reader sees what the blind caller cannot
      signIn(await staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ"));
      const sighted = await K.loc.createLocation({ kind: "PHYSICAL", address: street as never });
      assert.deepEqual(sighted.matches.map((match) => match.location.id).sort(), [bYard.location.id].sort());
      assert.deepEqual(sighted.matches[0].currentOrganizationIds, [b]);
      const reuse = await K.loc.assignLocation({ organizationId: a, role: "MAILING", locationId: bYard.location.id });
      assert.equal(reuse.assignment.locationId, bYard.location.id);
    });

    scenario("Master Account follows existing authorization semantics", async () => {
      const master = await fx.actor();
      await fx.master(master.actorId);
      signIn(master);
      const a = await org("A");
      const first = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      const second = await K.loc.createLocation({ kind: "PHYSICAL", address: { country: "CA", region: "AB", locality: "Calgary", postalCode: "T2E 1A1", addressLine1: first.location.currentAddress!.addressLine1 } as never });
      assert.equal(second.matches[0].location.id, first.location.id, "Master Account may see registry matches");
      assert.equal((await K.loc.getOrganizationLocations(a)).current.HOME_YARD?.location.id, first.location.id);
    });
  });

  // =============================================================================================================
  describe("Master Register", () => {
    scenario("mutations write the expected events; address text is never copied into the register", async () => {
      const actor = await fullStaff();
      const a = await org("A");
      const street = `${400 + counter} Secret Lane Reference ${run}`;
      const created = await K.loc.createLocation({
        kind: "PHYSICAL",
        address: addr({ addressLine1: street, locality: "Okotoks", postalCode: "T1S 1A1" }) as never,
        assignment: { organizationId: a, role: "HOME_YARD" },
      });
      const changed = await K.loc.changeLocationAddress({ organizationId: a, locationId: created.location.id, address: addr({ addressLine1: `${street} B`, locality: "Okotoks", postalCode: "T1S 1A1" }) as never, });
      const corrected = await K.loc.correctLocationAddress({ organizationId: a, locationId: created.location.id, address: addr({ addressLine1: `${street} C`, locality: "Okotoks", postalCode: "T1S 1A1" }) as never });
      const second = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      await K.loc.endAssignment({ organizationId: a, role: "HOME_YARD" });
      await K.loc.archiveLocation(created.location.id);
      await K.loc.restoreLocation(created.location.id);

      const types = async (id: string) => (await eventsFor(id)).map((event) => event.event_type);
      assert.deepEqual(await types(created.location.id), ["RECORD_CREATED", "RECORD_ARCHIVED", "RECORD_RESTORED"]);
      assert.deepEqual(await types(changed.address.id), ["RECORD_UPDATED"]);
      assert.deepEqual(await types(corrected.address.id), ["RECORD_CORRECTED"]);
      assert.deepEqual(await types(created.assignment!.id), ["RECORD_LINK_ESTABLISHED", "RECORD_LINK_REMOVED"]);
      assert.deepEqual(await types(second.assignment!.id), ["RECORD_LINK_ESTABLISHED", "RECORD_LINK_REMOVED"]);

      const ids = [created.location.id, changed.address.id, corrected.address.id, created.assignment!.id, second.assignment!.id, created.location.currentAddress!.id];
      const everything: string[] = [];
      for (const id of ids) for (const event of await eventsFor(id)) {
        assert.equal(event.actor_id, actor.actorId);
        everything.push(JSON.stringify(event));
      }
      const text = everything.join(" ");
      for (const leaked of [street, "Secret Lane", "Okotoks", "T1S", "Calgary", "T2E", run]) {
        assert.equal(text.includes(leaked), false, `address text "${leaked}" must not appear in Master Register events`);
      }
      assert.ok(text.includes(created.location.currentAddress!.id), "events reference the canonical rows instead");
    });

    scenario("a failure on the LAST step of create-and-assign rolls back the Location, its address and its creation event", async () => {
      const actor = await fullStaff();
      const a = await org("A");
      const eventsBefore = await eventCount(actor.actorId);
      const locationsBefore = await rowCount(`SELECT count(*) FROM public.locations`);
      const addressesBefore = await rowCount(`SELECT count(*) FROM public.location_addresses`);
      const marker = `${700 + ++counter} Rollback Road ${run}`;

      await refuseMasterRegisterEvent("RECORD_LINK_ESTABLISHED");
      await assert.rejects(
        K.loc.createLocation({ kind: "PHYSICAL", address: addr({ addressLine1: marker }) as never, assignment: { organizationId: a, role: "MAILING" } }),
        /master register write refused/,
      );
      assert.equal(await rowCount(`SELECT count(*) FROM public.locations`), locationsBefore);
      assert.equal(await rowCount(`SELECT count(*) FROM public.location_addresses`), addressesBefore);
      assert.equal(await rowCount(`SELECT count(*) FROM public.location_addresses WHERE address_line_1 = $1`, [marker]), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.organization_location_assignments WHERE organization_id = $1`, [a]), 0);
      assert.equal(await eventCount(actor.actorId), eventsBefore, "RECORD_CREATED was rolled back with everything else");

      // a failure on the FIRST event also leaves nothing behind
      await refuseMasterRegisterEvent("RECORD_CREATED");
      await assert.rejects(K.loc.createLocation({ kind: "PHYSICAL", address: addr({ addressLine1: marker }) as never }), /master register write refused/);
      assert.equal(await rowCount(`SELECT count(*) FROM public.location_addresses WHERE address_line_1 = $1`, [marker]), 0);
    });

    scenario("rollback of a role move or an address revision restores the previous state exactly", async () => {
      const actor = await fullStaff();
      const a = await org("A");
      const home = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      const other = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never });
      const before = await eventCount(actor.actorId);

      // role move: the "removed" event succeeds, the "established" event fails -> everything rolls back
      await refuseMasterRegisterEvent("RECORD_LINK_ESTABLISHED");
      await assert.rejects(K.loc.assignLocation({ organizationId: a, role: "HOME_YARD", locationId: other.location.id }), /master register write refused/);
      const view = await K.loc.getOrganizationLocations(a);
      assert.equal(view.current.HOME_YARD?.assignment.id, home.assignment!.id);
      assert.equal(view.current.HOME_YARD?.assignment.effectiveTo, null);
      assert.equal(view.history.length, 1);

      await refuseMasterRegisterEvent("RECORD_UPDATED");
      await assert.rejects(K.loc.changeLocationAddress({ organizationId: a, locationId: home.location.id, address: addr() as never }), /master register write refused/);
      await refuseMasterRegisterEvent("RECORD_CORRECTED");
      await assert.rejects(K.loc.correctLocationAddress({ organizationId: a, locationId: home.location.id, address: addr() as never }), /master register write refused/);
      const after = (await K.loc.getOrganizationLocations(a)).current.HOME_YARD!;
      assert.equal(after.versions.length, 1);
      assert.equal(after.versions[0].status, "active");
      assert.equal(after.versions[0].effectiveTo, null);
      assert.equal(await eventCount(actor.actorId), before, "no event survived any failed transaction");
    });

    scenario("reads, matching and refused operations create no Master Register events", async () => {
      const actor = await fullStaff();
      const a = await org("A");
      const street = addr();
      const yard = await K.loc.createLocation({ kind: "PHYSICAL", address: street as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      const before = await eventCount(actor.actorId);

      await K.loc.getOrganizationLocations(a);
      await K.loc.getOrganizationLocations(a, { asOf: "2021-01-01T00:00:00Z" });
      await K.loc.findLocationMatches(street as never);
      await rejectsWith(K.loc.assignLocation({ organizationId: a, role: "HOME_YARD", locationId: yard.location.id }), K.loc.OrganizationLocationStateError);
      await rejectsWith(K.loc.assignLocation({ organizationId: a, role: "MAILING", locationId: randomUUID() }), K.loc.OrganizationLocationNotFoundError);
      await rejectsWith(K.loc.createLocation({ kind: "PHYSICAL", address: addr({ country: "MX" }) as never }), K.loc.OrganizationLocationValidationError);
      await rejectsWith(K.loc.correctLocationAddress({ organizationId: a, locationId: yard.location.id, address: street as never }), K.loc.OrganizationLocationValidationError);
      assert.equal(await eventCount(actor.actorId), before);
    });
  });

  // =============================================================================================================
  describe("archive", () => {
    scenario("a Location with a current assignment cannot be archived; once free it can be, and restored; archived ones cannot be assigned", async () => {
      await fullStaff();
      const a = await org("A");
      const yard = await K.loc.createLocation({ kind: "PHYSICAL", address: addr() as never, assignment: { organizationId: a, role: "HOME_YARD" } });
      await rejectsWith(K.loc.archiveLocation(yard.location.id), K.loc.OrganizationLocationStateError);
      assert.equal((await pools.admin.query(`SELECT status FROM public.locations WHERE id = $1`, [yard.location.id])).rows[0].status, "active");

      await K.loc.endAssignment({ organizationId: a, role: "HOME_YARD" });
      const archived = await K.loc.archiveLocation(yard.location.id);
      assert.equal(archived.status, "archived");
      assert.ok(archived.archivedAt);
      assert.ok(archived.currentAddress, "the address history is preserved");
      await rejectsWith(K.loc.archiveLocation(yard.location.id), K.loc.OrganizationLocationStateError);
      await rejectsWith(K.loc.assignLocation({ organizationId: a, role: "HOME_YARD", locationId: yard.location.id }), K.loc.OrganizationLocationStateError);
      await rejectsWith(K.loc.correctLocationAddress({ organizationId: a, locationId: yard.location.id, address: addr() as never }), K.loc.OrganizationLocationStateError);
      assert.equal((await pools.admin.query(`SELECT count(*) FROM public.location_addresses WHERE location_id = $1`, [yard.location.id])).rows[0].count, "1");

      const restored = await K.loc.restoreLocation(yard.location.id);
      assert.equal(restored.status, "active");
      assert.equal(restored.archivedAt, null);
      await rejectsWith(K.loc.restoreLocation(yard.location.id), K.loc.OrganizationLocationStateError);
      const back = await K.loc.assignLocation({ organizationId: a, role: "HOME_YARD", locationId: yard.location.id });
      assert.equal(back.assignment.locationId, yard.location.id);
    });
  });
});
