// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL Tax Registration service through the REAL authorization wrappers and Clerk-to-actor resolution, on
// pooled connections that log in as the RUNTIME role, against a database with migrations 0001-0019 applied.

import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    authz: await import("@/lib/auth/tes-authorization"),
    tr: await import("@/lib/tax-registrations/service"),
    defs: await import("@/lib/tax-registrations/definitions"),
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
const TABLES = ["registration_programs", "registrations", "registration_versions", "registration_status_periods"] as const;
const BUSINESS_TABLES = ["registrations", "registration_versions", "registration_status_periods"] as const;
const PROGRAMS = ["IFTA", "CT_HUF", "NY_HUT", "KYU", "NM_WDT", "OR_WMT", "FUEL_CHARGE", "TX_EXCISE", "AR_MFT", "ON_TOBACCO", "SCAC", "CA_CARRIER_CODE"] as const;
type Program = (typeof PROGRAMS)[number];
type Cap = "TAX_REGISTRATION_READ" | "TAX_REGISTRATION_MANAGE";
const NON_BASE_PROGRAMS = PROGRAMS.filter((program) => program !== "IFTA");

describe("Tax Registrations (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
  /** Customer-owned Organizations: their registrations are purged here, the Organization itself by the fixtures. */
  let customerOrganizations: string[] = [];
  let cleanups: Array<() => Promise<void>> = [];

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  let counter = 0;

  /** Removes everything this scenario created. The no-delete triggers are lifted only here, by the table owner, inside a transaction. */
  async function purge() {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const table of BUSINESS_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${table}_no_delete`);
      const owned = [...organizations, ...customerOrganizations];
      const ids = `(SELECT id FROM public.registrations WHERE organization_id = ANY($1::uuid[]))`;
      await client.query(`DELETE FROM public.registration_status_periods WHERE registration_id IN ${ids}`, [owned]);
      await client.query(`DELETE FROM public.registration_versions WHERE registration_id IN ${ids}`, [owned]);
      await client.query(`DELETE FROM public.registrations WHERE organization_id = ANY($1::uuid[])`, [owned]);
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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `TR ${label} ${id.slice(0, 8)} ${++counter}`]);
    organizations.push(id);
    return id;
  }

  async function staff(...capabilities: Cap[] | string[]): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    return actor;
  }
  const signIn = (actor: TestActor) => K.db.setClerkUser(actor.clerkSubject);
  async function fullStaff() {
    const actor = await staff("TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ");
    signIn(actor);
    return actor;
  }

  // Numbers are unique per run so parallel/previous data never collides.
  const usedLetters = new Set<string>();
  const letters = (length: number): string => {
    for (;;) {
      let text = "";
      for (let i = 0; i < length; i += 1) text += String.fromCharCode(65 + randomInt(0, 26));
      if (!usedLetters.has(text)) {
        usedLetters.add(text);
        return text;
      }
    }
  };
  const digits = () => String(1_000_000 + randomInt(0, 8_000_000)) + String(++counter);
  const numberFor = (program: Program): string => (program === "SCAC" ? letters(4) : `${program.slice(0, 2)}${digits()}`);
  const jurisdictionFor = (program: Program): unknown => (program === "IFTA" ? { country: "US", region: "TX" } : undefined);
  const create = (organizationId: string, program: Program, over: Record<string, unknown> = {}) =>
    K.tr.createRegistration({ organizationId, program, number: numberFor(program), jurisdiction: jurisdictionFor(program), ...over } as never);

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const denied = (promise: Promise<unknown>) => rejectsWith(promise, K.authz.TesAuthorizationDeniedError);
  const rowCount = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const eventTypes = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type, event_id`, [actorId])).rows.map((row) => row.event_type);
  const eventsJson = async (actorId: string) =>
    JSON.stringify((await pools.admin.query(`SELECT * FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId])).rows);
  const MONTH = (n: number) => `2020-${String(n).padStart(2, "0")}-01T00:00:00Z`;
  const ids = (view: { registration: { id: string } }) => view.registration.id;

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

  /** Several DIFFERENT actors, so the calls genuinely overlap (one actor's authorization step would serialize them). */
  async function concurrentActors(count: number) {
    const actors = await Promise.all(Array.from({ length: count }, () => staff("TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ")));
    return <T>(index: number, work: () => Promise<T>) => K.db.withClerkUser(actors[index].clerkSubject, work);
  }

  // =============================================================================================================
  describe("schema (migration 0016)", () => {
    scenario("tables, catalogue seed, constraints, indexes, functions and triggers exist; the ledger records 0016", async () => {
      const names = async (sql: string) => (await pools.admin.query<{ n: string }>(sql)).rows.map((row) => row.n);
      assert.deepEqual(
        await names(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'registration%' ORDER BY 1`),
        ["registration_programs", "registration_status_periods", "registration_versions", "registrations"],
      );
      assert.deepEqual(await names(`SELECT code AS n FROM public.registration_programs ORDER BY sort_order`), [...PROGRAMS]);
      const indexes = await names(`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'registration%'`);
      for (const expected of [
        "registration_versions_current_uq", "registration_versions_current_number_uq", "registration_versions_history_idx",
        "registration_versions_number_lookup_idx", "registration_status_periods_current_uq", "registration_status_periods_history_idx",
        "registrations_organization_idx",
      ]) assert.ok(indexes.includes(expected), expected);
      assert.equal(indexes.some((name) => /identity/.test(name)), false, "no program claims one-current-per-Organization: there is no identity index");
      const triggers = await names(`SELECT tgname AS n FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE 'registration%'`);
      for (const expected of [
        "registrations_guard_update", "registrations_require_current_state", "registrations_guard_active_organization",
        "registration_versions_guard_insert", "registration_versions_guard_update", "registration_versions_guard_active_organization",
        "registration_status_periods_guard_insert", "registration_status_periods_guard_update",
        ...BUSINESS_TABLES.flatMap((table) => [`${table}_no_delete`, `${table}_no_truncate`]),
      ]) assert.ok(triggers.includes(expected), expected);

      const ledger = await pools.admin.query<{ sha256: string }>(`SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0016'`);
      assert.equal(ledger.rowCount, 1);
      const file = readFileSync(path.resolve(import.meta.dirname, "../../../database/migrations/0016_tax_registration_foundation.sql"));
      assert.equal(ledger.rows[0].sha256, createHash("sha256").update(file).digest("hex"));
    });

    scenario("the server definitions agree with the persisted catalogue; the identity-claim columns do not exist", async () => {
      const rows = (await pools.admin.query(`SELECT * FROM public.registration_programs ORDER BY sort_order`)).rows;
      assert.equal(rows.length, K.defs.PROGRAM_CODES.length);
      for (const row of rows) {
        const def = K.defs.PROGRAM_DEFINITIONS[row.code as Program];
        assert.ok(def, row.code);
        assert.equal(row.program_family, def.family, row.code);
        assert.equal(row.jurisdiction_scope, def.jurisdictionScope, row.code);
        assert.equal(row.issuer_country, def.issuerCountry, row.code);
        assert.equal(row.region_required, def.regionRequired, row.code);
        assert.equal(row.fixed_region, def.fixedRegion, row.code);
        assert.equal(row.sort_order, def.sortOrder, row.code);
      }
      const columns = (await pools.admin.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registration_programs'`)).rows.map((row) => row.column_name);
      assert.equal(columns.includes("one_current_per_organization"), false);
      assert.equal(columns.includes("has_expiry"), false, "no expiry gating");
    });

    scenario("registration is not authority, filing, payment, decal or credential: no such table or column exists", async () => {
      // no registration program code collides with an operating-authority kind code (IRP stays canonical in 0013 and is absent here)
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_programs p JOIN public.authority_kinds k ON k.code = p.code`), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_programs WHERE code IN ('IRP','USDOT','MC','MVID','RIN','CVOR','SAFETY_FITNESS','FORM_2290','CUSTOMS')`), 0);
      const columns = (await pools.admin.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('registration_programs','registrations','registration_versions','registration_status_periods')`,
      )).rows.map((row) => row.column_name);
      for (const column of columns) assert.doesNotMatch(column, /filing|return|payment|amount|decal|credential|password|secret|username|login|portal|vehicle|unit_id|evidence|document|url/i, column);
      const tables = (await pools.admin.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%registration%'`)).rows.map((row) => row.table_name);
      assert.deepEqual(tables.sort(), ["registration_programs", "registration_status_periods", "registration_versions", "registrations"]);
    });

    scenario("capabilities: exactly TAX_REGISTRATION_READ and TAX_REGISTRATION_MANAGE exist, SYSTEM-only, and are granted to nobody", async () => {
      const rows = (await pools.admin.query<{ code: string; description: string; is_active: boolean; sort_order: number }>(
        `SELECT code, description, is_active, sort_order FROM public.capabilities WHERE code LIKE 'TAX_REGISTRATION%' ORDER BY sort_order`,
      )).rows;
      assert.deepEqual(rows.map((row) => row.code), ["TAX_REGISTRATION_READ", "TAX_REGISTRATION_MANAGE"]);
      for (const row of rows) {
        assert.match(row.description, /Intended scope: SYSTEM only\.$/, row.code);
        assert.equal(row.is_active, true, row.code);
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id WHERE c.code LIKE 'TAX_REGISTRATION_%'`), 0, "the migration grants nothing to anyone");
      const registry = readFileSync(path.resolve(import.meta.dirname, "../../../lib/auth/tes-capabilities.ts"), "utf8");
      assert.match(registry, /TAX_REGISTRATION_READ:\s*"SYSTEM"/);
      assert.match(registry, /TAX_REGISTRATION_MANAGE:\s*"SYSTEM"/);
    });

    scenario("no unintended SECURITY DEFINER, no RLS, no policy; every function is invoker with a fixed search_path and no PUBLIC execute", async () => {
      const names = [
        "prevent_registration_data_removal", "guard_registration_update", "guard_registration_version_insert", "guard_registration_version_update",
        "guard_registration_status_period_insert", "guard_registration_status_period_update", "require_registration_current_state", "guard_active_organization",
      ];
      const functions = (await pools.admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; public_execute: boolean }>(
        `SELECT p.proname, p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname = ANY($1::text[])`,
        [names],
      )).rows;
      assert.equal(functions.length, names.length);
      for (const fn of functions) {
        assert.equal(fn.prosecdef, false, fn.proname);
        assert.deepEqual(fn.proconfig, ["search_path=pg_catalog"], fn.proname);
        assert.equal(fn.public_execute, false, fn.proname);
      }
      for (const table of TABLES) {
        assert.equal((await pools.admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${table}`])).rows[0].relrowsecurity, false, table);
      }
      assert.equal(await rowCount(`SELECT count(*) FROM pg_policies WHERE tablename LIKE 'registration%'`), 0);
    });

    scenario("runtime privileges: no DELETE/TRUNCATE/REFERENCES/TRIGGER anywhere, no content rewrites, no PUBLIC privilege", async () => {
      const has = async (sql: string, params: unknown[]) => (await pools.admin.query<{ ok: boolean }>(sql, params)).rows[0].ok;
      for (const table of TABLES) {
        for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          assert.equal(await has(`SELECT has_table_privilege($1, $2, $3) AS ok`, [RUNTIME_ROLE, `public.${table}`, privilege]), false, `${table} ${privilege}`);
        }
        assert.equal(await has(`SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [RUNTIME_ROLE, `public.${table}`]), true, table);
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          assert.equal(await has(`SELECT has_table_privilege('public', $1, $2) AS ok`, [`public.${table}`, privilege]), false, `PUBLIC ${table} ${privilege}`);
        }
      }
      for (const privilege of ["INSERT", "UPDATE"]) assert.equal(await has(`SELECT has_table_privilege($1, 'public.registration_programs', $2) AS ok`, [RUNTIME_ROLE, privilege]), false, `catalogue ${privilege}`);
      const column = (table: string, name: string, privilege: string) =>
        has(`SELECT has_column_privilege($1, $2, $3, $4) AS ok`, [RUNTIME_ROLE, `public.${table}`, name, privilege]);
      // identity: insertable only as (organization_id, program_code); never updatable except the record lifecycle
      for (const name of ["organization_id", "program_code"]) assert.equal(await column("registrations", name, "INSERT"), true, `registrations.${name} INSERT`);
      for (const name of ["id", "record_status", "archived_at", "created_at", "updated_at"]) assert.equal(await column("registrations", name, "INSERT"), false, `registrations.${name} INSERT`);
      for (const name of ["organization_id", "program_code", "id", "created_at"]) assert.equal(await column("registrations", name, "UPDATE"), false, `registrations.${name} UPDATE`);
      for (const name of ["record_status", "archived_at", "updated_at"]) assert.equal(await column("registrations", name, "UPDATE"), true, `registrations.${name} UPDATE`);
      // versions: content is insert-only
      const contentColumns = ["number_display", "number_normalized", "normalization_rule_version", "jurisdiction_country", "jurisdiction_region", "issued_on", "expires_on", "registration_id", "organization_id", "program_code", "effective_from", "version_reason", "created_at", "id"];
      for (const name of contentColumns) assert.equal(await column("registration_versions", name, "UPDATE"), false, `versions.${name} UPDATE`);
      for (const name of contentColumns.filter((c) => c !== "created_at")) assert.equal(await column("registration_versions", name, "INSERT"), true, `versions.${name} INSERT`);
      for (const name of ["effective_to", "record_status", "corrected_at", "superseded_by_version_id", "updated_at"]) {
        assert.equal(await column("registration_versions", name, "UPDATE"), true, `versions.${name} UPDATE`);
        assert.equal(await column("registration_versions", name, "INSERT"), false, `versions.${name} INSERT`);
      }
      const periodContent = ["registration_status", "registration_id", "period_reason", "effective_from", "created_at", "id"];
      for (const name of periodContent) assert.equal(await column("registration_status_periods", name, "UPDATE"), false, `periods.${name} UPDATE`);
      for (const name of ["effective_to", "record_status", "corrected_at", "superseded_by_period_id", "updated_at"]) {
        assert.equal(await column("registration_status_periods", name, "UPDATE"), true, `periods.${name} UPDATE`);
        assert.equal(await column("registration_status_periods", name, "INSERT"), false, `periods.${name} INSERT`);
      }
      for (const table of TABLES) {
        await assert.rejects(pools.runtime.query(`DELETE FROM public.${table}`), /permission denied/, table);
        await assert.rejects(pools.runtime.query(`TRUNCATE public.${table}`), /permission denied/, table);
      }
      await assert.rejects(pools.runtime.query(`INSERT INTO public.registration_programs (code, display_name, program_family, jurisdiction_scope, region_required, sort_order) VALUES ('ZZ','x','FUEL_TAX','GLOBAL',false,999)`), /permission denied/);
      await assert.rejects(pools.runtime.query(`UPDATE public.registration_programs SET is_active = false`), /permission denied/);
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
        const registration = async (program: string) => (await client.query<{ id: string }>(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, $2) RETURNING id`, [orgId, program])).rows[0].id;
        const versionSql = (extraCols = "", extraVals = "") =>
          `INSERT INTO public.registration_versions (registration_id, organization_id, program_code, number_display, number_normalized, normalization_rule_version, jurisdiction_country, jurisdiction_region, version_reason, effective_from${extraCols})
           VALUES ($1, $2, $3, $4, $4, 'test.v1', $5, $6, 'INITIAL', '2020-01-01Z'${extraVals}) RETURNING id`;
        const ifta = await registration("IFTA");
        const v1 = (await client.query<{ id: string }>(versionSql(), [ifta, orgId, "IFTA", "1", "US", "TX"])).rows[0].id;
        await client.query(`INSERT INTO public.registration_status_periods (registration_id, registration_status, period_reason, effective_from) VALUES ($1, 'ACTIVE', 'INITIAL', '2020-01-01Z')`, [ifta]);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("SET CONSTRAINTS ALL DEFERRED");

        await expectFailure(`INSERT INTO public.registration_status_periods (registration_id, registration_status, period_reason, effective_from) VALUES ($1, 'REVOKED', 'INITIAL', now())`, [ifta], /status_valid/);
        await expectFailure(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'IRP')`, [orgId], /foreign key/);
        await expectFailure(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'USDOT')`, [orgId], /foreign key/);
        await expectFailure(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'SCAC')`, [randomUUID()], /foreign key|not active/);
        // one current version, one current status period
        await expectFailure(versionSql(), [ifta, orgId, "IFTA", "2", "US", "TX"], /current_uq|current_number_uq/);
        await expectFailure(`INSERT INTO public.registration_status_periods (registration_id, registration_status, period_reason, effective_from) VALUES ($1, 'INACTIVE', 'TRANSITION', now())`, [ifta], /current_uq/);
        // a version must carry its registration's organization and program
        const kyu = await registration("KYU");
        await expectFailure(versionSql(), [kyu, orgId, "SCAC", "AB", null, null], /registration_fk|foreign key/);
        await expectFailure(versionSql(), [kyu, randomUUID(), "KYU", "3", "US", "KY"], /organization_fk|foreign key|not active/);
        await expectFailure(versionSql(), [randomUUID(), orgId, "KYU", "3", "US", "KY"], /registration_fk|foreign key|active registration/);
        // jurisdiction rules of the program
        const scac = await registration("SCAC");
        await expectFailure(versionSql(), [scac, orgId, "SCAC", "ABCD", "US", null], /jurisdiction does not satisfy/);
        await expectFailure(versionSql(), [scac, orgId, "SCAC", "ABCD", "US", "TX"], /jurisdiction does not satisfy/);
        const ct = await registration("CT_HUF");
        await expectFailure(versionSql(), [ct, orgId, "CT_HUF", "5", "US", "NY"], /jurisdiction does not satisfy/);
        await expectFailure(versionSql(), [ct, orgId, "CT_HUF", "5", "CA", "CT"], /jurisdiction does not satisfy/);
        await expectFailure(versionSql(), [ct, orgId, "CT_HUF", "5", "US", null], /jurisdiction does not satisfy/);
        const fuel = await registration("FUEL_CHARGE");
        await expectFailure(versionSql(), [fuel, orgId, "FUEL_CHARGE", "5", "CA", "ON"], /jurisdiction does not satisfy/);
        await expectFailure(versionSql(), [fuel, orgId, "FUEL_CHARGE", "5", "US", null], /jurisdiction does not satisfy/);
        await expectFailure(versionSql(), [ifta, orgId, "IFTA", "5", "US", null], /jurisdiction does not satisfy|current_uq/);
        // the document dates are optional but ordered
        await expectFailure(versionSql(", issued_on, expires_on", ", '2025-01-01', '2024-01-01'"), [scac, orgId, "SCAC", "ABCD", null, null], /document_dates_valid/);
        // identity and content are immutable
        await expectFailure(`UPDATE public.registrations SET organization_id = gen_random_uuid() WHERE id = $1`, [ifta], /identity is immutable|foreign key/);
        await expectFailure(`UPDATE public.registrations SET program_code = 'SCAC' WHERE id = $1`, [ifta], /identity is immutable/);
        await expectFailure(`UPDATE public.registration_versions SET number_normalized = '99' WHERE id = $1`, [v1], /content is immutable/);
        await expectFailure(`UPDATE public.registration_status_periods SET registration_status = 'CLOSED' WHERE registration_id = $1`, [ifta], /content is immutable/);
        // a correction does not end a version; no deletes
        await expectFailure(`UPDATE public.registration_versions SET record_status = 'corrected', corrected_at = now(), effective_to = now(), superseded_by_version_id = id WHERE id = $1`, [v1], /not_superseded_by_self|must not set effective_to/);
        await expectFailure(`DELETE FROM public.registration_versions WHERE id = $1`, [v1], /preserved/);
        await expectFailure(`DELETE FROM public.registrations WHERE id = $1`, [ifta], /preserved/);
        await expectFailure(`TRUNCATE public.registration_status_periods`, [], /preserved/);
        // a registration without a current version / status cannot commit
        await registration("AR_MFT");
        await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"), /must have a current/);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });

    scenario("the number index is the owner-level backstop in every namespace: global (NULL country), national, country+region, base jurisdiction", async () => {
      const client = await pools.admin.connect();
      const [a, b] = [await org("A"), await org("B")];
      try {
        await client.query("BEGIN");
        await client.query("SET CONSTRAINTS ALL DEFERRED");
        const hold = async (orgId: string, program: string, number: string, country: string | null, region: string | null) => {
          const id = (await client.query<{ id: string }>(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, $2) RETURNING id`, [orgId, program])).rows[0].id;
          await client.query(
            `INSERT INTO public.registration_versions (registration_id, organization_id, program_code, number_display, number_normalized, normalization_rule_version, jurisdiction_country, jurisdiction_region, version_reason, effective_from)
             VALUES ($1, $2, $3, $4, $4, 'test.v1', $5, $6, 'INITIAL', '2020-01-01Z')`,
            [id, orgId, program, number, country, region],
          );
        };
        const attempt = async (orgId: string, program: string, number: string, country: string | null, region: string | null) => {
          await client.query("SAVEPOINT s");
          await assert.rejects(hold(orgId, program, number, country, region), /current_number_uq/, `${program} ${number}`);
          await client.query("ROLLBACK TO SAVEPOINT s");
        };
        await hold(a, "SCAC", "ZQXW", null, null);
        await attempt(b, "SCAC", "ZQXW", null, null);
        await hold(a, "CA_CARRIER_CODE", "4242", "CA", null);
        await attempt(b, "CA_CARRIER_CODE", "4242", "CA", null);
        await hold(a, "CT_HUF", "4242", "US", "CT");
        await attempt(b, "CT_HUF", "4242", "US", "CT");
        await hold(a, "IFTA", "AB4242", "US", "TX");
        await attempt(b, "IFTA", "AB4242", "US", "TX");
        for (const [program, country, region] of [["IFTA", "CA", "AB"], ["NY_HUT", "US", "NY"], ["CA_CARRIER_CODE", "CA", null], ["FUEL_CHARGE", "CA", null]] as const) {
          await client.query("SAVEPOINT s");
          await hold(b, program, program === "IFTA" || program === "NY_HUT" || program === "FUEL_CHARGE" ? "AB4242" : "9999", country, region); // another program / base is another namespace
          await client.query("RELEASE SAVEPOINT s");
        }
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
  });

  // =============================================================================================================
  describe("DB backstops reachable when the service is bypassed (direct runtime-role SQL)", () => {
    scenario("the Organization lifecycle guard refuses a registration for an archived or merged Organization, and for a missing one", async () => {
      const active = await org("Active");
      const archived = await org("Archived");
      const survivor = await org("Survivor");
      const merged = await org("Merged");
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archived]);
      await pools.admin.query(`UPDATE public.organizations SET status = 'merged', merged_into_organization_id = $2 WHERE id = $1`, [merged, survivor]);
      const rt = await pools.runtime.connect();
      try {
        for (const [label, orgId, pattern] of [["archived", archived, /is not active/], ["merged", merged, /is not active/], ["missing", randomUUID(), /is not active|foreign key/]] as const) {
          await rt.query("BEGIN");
          await assert.rejects(rt.query(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'SCAC')`, [orgId]), pattern, label);
          await rt.query("ROLLBACK");
        }
        // an active Organization is accepted by the same direct insert (control)
        await rt.query("BEGIN");
        await rt.query(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'SCAC')`, [active]);
        await rt.query("ROLLBACK");
      } finally {
        rt.release();
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = ANY($1::uuid[])`, [[archived, merged, active]]), 0);
    });

    scenario("versions and status periods cannot be added to an archived registration, nor registrations without both current rows, nor in the wrong namespace", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const archivedId = ids((await create(a, "TX_EXCISE")).view);
      await K.tr.archiveRegistration({ organizationId: a, registrationId: archivedId });
      const held = (await create(b, "TX_EXCISE")).view.current.version!;
      const rt = await pools.runtime.connect();
      const rejected = async (sql: string, params: unknown[], pattern: RegExp, label: string) => {
        await rt.query("BEGIN");
        try {
          await assert.rejects(rt.query(sql, params), pattern, label);
        } finally {
          await rt.query("ROLLBACK");
        }
      };
      const versionInsert = `INSERT INTO public.registration_versions (registration_id, organization_id, program_code, number_display, number_normalized, normalization_rule_version, jurisdiction_country, jurisdiction_region, version_reason, effective_from)
        VALUES ($1, $2, $3, 'X1', 'X1', 'test.v1', $4, $5, 'CHANGE', now())`;
      try {
        await rejected(versionInsert, [archivedId, a, "TX_EXCISE", "US", "TX"], /active registration record/, "version on archived registration");
        await rejected(`INSERT INTO public.registration_status_periods (registration_id, registration_status, period_reason, effective_from) VALUES ($1, 'ACTIVE', 'TRANSITION', now())`, [archivedId], /active registration record/, "status on archived registration");

        // a registration alone cannot commit
        await rt.query("BEGIN");
        await rt.query(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'KYU')`, [a]);
        await assert.rejects(rt.query("SET CONSTRAINTS ALL IMMEDIATE"), /must have a current/);
        await rt.query("ROLLBACK");

        // wrong namespace for the program, and a number already held by another Organization
        await rt.query("BEGIN");
        const scac = (await rt.query<{ id: string }>(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'SCAC') RETURNING id`, [a])).rows[0].id;
        await rt.query("SAVEPOINT s");
        await assert.rejects(rt.query(versionInsert, [scac, a, "SCAC", "US", "TX"]), /jurisdiction does not satisfy/);
        await rt.query("ROLLBACK TO SAVEPOINT s");
        await rt.query("ROLLBACK");

        await rt.query("BEGIN");
        const dup = (await rt.query<{ id: string }>(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'TX_EXCISE') RETURNING id`, [a])).rows[0].id;
        await assert.rejects(
          rt.query(
            `INSERT INTO public.registration_versions (registration_id, organization_id, program_code, number_display, number_normalized, normalization_rule_version, jurisdiction_country, jurisdiction_region, version_reason, effective_from)
             VALUES ($1, $2, 'TX_EXCISE', $3, $3, 'test.v1', 'US', 'TX', 'INITIAL', now())`,
            [dup, a, held.numberNormalized],
          ),
          /current_number_uq/,
        );
        await rt.query("ROLLBACK");

        // a complete direct creation by the runtime role commits (the backstops do not block valid use)
        await rt.query("BEGIN");
        const ok = (await rt.query<{ id: string }>(`INSERT INTO public.registrations (organization_id, program_code) VALUES ($1, 'SCAC') RETURNING id`, [a])).rows[0].id;
        await rt.query(
          `INSERT INTO public.registration_versions (registration_id, organization_id, program_code, number_display, number_normalized, normalization_rule_version, version_reason, effective_from) VALUES ($1, $2, 'SCAC', 'QQQQ', 'QQQQ', 'test.v1', 'INITIAL', now())`,
          [ok, a],
        );
        await rt.query(`INSERT INTO public.registration_status_periods (registration_id, registration_status, period_reason, effective_from) VALUES ($1, 'ACTIVE', 'INITIAL', now())`, [ok]);
        await rt.query("COMMIT");
      } finally {
        rt.release();
      }
    });

    scenario("the runtime role cannot rewrite identity or content, even with its column grants", async () => {
      await fullStaff();
      const o = await org();
      const view = (await create(o, "OR_WMT")).view;
      const rt = await pools.runtime.connect();
      try {
        for (const sql of [
          `UPDATE public.registrations SET program_code = 'SCAC'`,
          `UPDATE public.registrations SET organization_id = gen_random_uuid()`,
          `UPDATE public.registration_versions SET number_normalized = 'x'`,
          `UPDATE public.registration_versions SET jurisdiction_region = 'WA'`,
          `UPDATE public.registration_versions SET expires_on = '2099-01-01'`,
          `UPDATE public.registration_status_periods SET registration_status = 'CLOSED'`,
        ]) await assert.rejects(rt.query(sql), /permission denied/, sql);
        // the allowed columns are still guarded by triggers: an ended version cannot be re-dated, a corrected one is frozen
        await rt.query("BEGIN");
        await assert.rejects(rt.query(`UPDATE public.registration_versions SET record_status = 'corrected', corrected_at = now() WHERE id = $1`, [view.current.version!.id]), /correction_state_consistent/);
        await rt.query("ROLLBACK");
      } finally {
        rt.release();
      }
    });
  });

  // =============================================================================================================
  describe("corrected rows are frozen", () => {
    scenario("a corrected version cannot be re-pointed at another replacement, even by the runtime role's column grants", async () => {
      await fullStaff();
      const o = await org();
      const created = await create(o, "OR_WMT");
      const registrationId = created.view.registration.id;
      await K.tr.correctRegistrationVersion({ organizationId: o, registrationId, number: letters(4) });
      const second = await K.tr.correctRegistrationVersion({ organizationId: o, registrationId, number: letters(5) });
      const versions = second.view.versions;
      const corrected = versions.filter((v: { recordStatus: string }) => v.recordStatus === "corrected");
      assert.equal(corrected.length, 2);
      const current = second.view.current.version!;
      const rt = await pools.runtime.connect();
      try {
        await rt.query("BEGIN");
        await assert.rejects(
          rt.query(`UPDATE public.registration_versions SET superseded_by_version_id = $2 WHERE id = $1`, [corrected[0].id, current.id]),
          /corrected registration version is frozen/,
        );
        await rt.query("ROLLBACK");
      } finally {
        rt.release();
      }
    });
  });

  describe("corrected status periods are frozen (owner level)", () => {
    scenario("a corrected registration status period cannot be re-pointed or re-dated", async () => {
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        const [orgId, regId, p1, p2, p3] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        await client.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, 'Frozen', 'frozen')`, [orgId]);
        await client.query(`INSERT INTO public.registrations (id, organization_id, program_code) VALUES ($1, $2, 'OR_WMT')`, [regId, orgId]);
        await client.query(`INSERT INTO public.registration_versions (registration_id, organization_id, program_code, number_display, number_normalized, normalization_rule_version, jurisdiction_country, jurisdiction_region, version_reason, effective_from) VALUES ($1, $2, 'OR_WMT', 'F1', 'F1', 'x', 'US', 'OR', 'INITIAL', now())`, [regId, orgId]);
        const period = `INSERT INTO public.registration_status_periods (id, registration_id, registration_status, period_reason, effective_from, record_status, corrected_at, superseded_by_period_id) VALUES ($1, $2, 'ACTIVE', $3, now(), $4, $5, $6)`;
        await client.query(period, [p1, regId, "INITIAL", "corrected", new Date(), p2]);
        await client.query(period, [p2, regId, "CORRECTION", "corrected", new Date(), p3]);
        await client.query(period, [p3, regId, "CORRECTION", "active", null, null]);
        await client.query("SAVEPOINT s");
        await assert.rejects(client.query(`UPDATE public.registration_status_periods SET superseded_by_period_id = $2 WHERE id = $1`, [p1, p3]), /corrected registration status period is frozen/);
        await client.query("ROLLBACK TO SAVEPOINT s");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
  });

  // =============================================================================================================
  describe("creation, programs and normalization", () => {
    for (const program of PROGRAMS) {
      scenario(`creates a ${program} registration with display/normalized/rule version, an initial status and one Master Register event`, async () => {
        const actor = await fullStaff();
        const o = await org();
        const raw = program === "SCAC" ? " tesc " : "ab-1234.56";
        const { view } = await K.tr.createRegistration({ organizationId: o, program, number: raw, jurisdiction: jurisdictionFor(program) } as never);
        const version = view.current.version!;
        assert.equal(view.registration.program, program);
        assert.equal(view.registration.organizationId, o);
        assert.equal(view.registration.recordStatus, "active");
        assert.equal(version.numberDisplay, raw.trim());
        assert.equal(version.numberNormalized, K.defs.prepareRegistrationNumber(program, raw).normalized);
        assert.equal(version.normalizationRuleVersion, K.defs.PROGRAM_DEFINITIONS[program].rule.version);
        assert.equal(version.versionReason, "INITIAL");
        assert.equal(version.issuedOn, null, "dates are optional for every program");
        assert.equal(version.expiresOn, null, "dates are optional for every program");
        const def = K.defs.PROGRAM_DEFINITIONS[program];
        if (def.jurisdictionScope === "GLOBAL") assert.deepEqual([version.jurisdictionCountry, version.jurisdictionRegion], [null, null]);
        if (def.jurisdictionScope === "NATIONAL") assert.deepEqual([version.jurisdictionCountry, version.jurisdictionRegion], ["CA", null]);
        if (def.jurisdictionScope === "COUNTRY_REGION") assert.deepEqual([version.jurisdictionCountry, version.jurisdictionRegion], [def.issuerCountry, def.fixedRegion]);
        if (def.jurisdictionScope === "BASE_JURISDICTION") assert.deepEqual([version.jurisdictionCountry, version.jurisdictionRegion], ["US", "TX"]);
        assert.equal(view.current.status!.registrationStatus, "ACTIVE");
        assert.equal(view.current.status!.periodReason, "INITIAL");
        assert.deepEqual(await eventTypes(actor.actorId), ["RECORD_CREATED"]);
        // stable references only: no number in the Master Register
        const json = await eventsJson(actor.actorId);
        assert.equal(json.includes(version.numberNormalized), false, "no normalized number in the register");
        assert.equal(json.includes(raw.trim()), false, "no display number in the register");
      });
    }

    scenario("jurisdiction input per program: IFTA needs a base, SCAC rejects any, national programs reject a region, fixed-region programs reject another region", async () => {
      await fullStaff();
      const o = await org();
      const invalid = (promise: Promise<unknown>) => rejectsWith(promise, K.tr.RegistrationValidationError);
      await invalid(K.tr.createRegistration({ organizationId: o, program: "IFTA", number: numberFor("IFTA") }));
      await invalid(K.tr.createRegistration({ organizationId: o, program: "IFTA", number: numberFor("IFTA"), jurisdiction: { region: "TX" } }));
      await invalid(K.tr.createRegistration({ organizationId: o, program: "IFTA", number: numberFor("IFTA"), jurisdiction: { country: "MX", region: "TX" } } as never));
      const base = await K.tr.createRegistration({ organizationId: o, program: "IFTA", number: numberFor("IFTA"), jurisdiction: { country: "CA", region: "ON" } });
      assert.deepEqual([base.view.current.version!.jurisdictionCountry, base.view.current.version!.jurisdictionRegion], ["CA", "ON"]);
      await invalid(K.tr.createRegistration({ organizationId: o, program: "SCAC", number: letters(3), jurisdiction: { country: "US" } } as never));
      await invalid(K.tr.createRegistration({ organizationId: o, program: "SCAC", number: letters(3), jurisdiction: { region: "TX" } } as never));
      await invalid(K.tr.createRegistration({ organizationId: o, program: "FUEL_CHARGE", number: numberFor("FUEL_CHARGE"), jurisdiction: { region: "ON" } } as never));
      await invalid(K.tr.createRegistration({ organizationId: o, program: "CA_CARRIER_CODE", number: numberFor("CA_CARRIER_CODE"), jurisdiction: { country: "US" } } as never));
      await invalid(K.tr.createRegistration({ organizationId: o, program: "CT_HUF", number: numberFor("CT_HUF"), jurisdiction: { region: "NY" } } as never));
      await invalid(K.tr.createRegistration({ organizationId: o, program: "ON_TOBACCO", number: numberFor("ON_TOBACCO"), jurisdiction: { country: "US", region: "ON" } } as never));
      const ct = await K.tr.createRegistration({ organizationId: o, program: "CT_HUF", number: numberFor("CT_HUF"), jurisdiction: { country: "US", region: "ct" } } as never);
      assert.equal(ct.view.current.version!.jurisdictionRegion, "CT");
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [o]), 2, "rejected creations left nothing behind");
    });

    scenario("dates are optional for every program, ordered when both are present; any initial status is accepted; unknown input is refused", async () => {
      await fullStaff();
      const o = await org();
      for (const program of PROGRAMS) {
        const created = await create(o, program, { issuedOn: "2020-06-30", expiresOn: "2030-06-30" });
        assert.equal(created.view.current.version!.issuedOn, "2020-06-30", program);
        assert.equal(created.view.current.version!.expiresOn, "2030-06-30", program);
      }
      const expiredAlready = await create(o, "KYU", { expiresOn: "2001-01-01" });
      assert.equal(expiredAlready.view.current.status!.registrationStatus, "ACTIVE", "an expiry date never changes or gates the status");
      await rejectsWith(create(o, "IFTA", { issuedOn: "2025-01-01", expiresOn: "2024-01-01" }), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "IFTA", { issuedOn: "2025-02-30" }), K.tr.RegistrationValidationError);
      for (const status of K.defs.REGISTRATION_STATUSES) {
        const created = await create(o, "TX_EXCISE", { status });
        assert.equal(created.view.current.status!.registrationStatus, status);
      }
      for (const status of ["REVOKED", "CANCELED", "EXPIRED", "ARCHIVED", "active"]) await rejectsWith(create(o, "AR_MFT", { status }), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "UCR" as never), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "IRP" as never), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "USDOT" as never), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "MC" as never, { number: "1" }), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "SCAC", { number: "TOOLONG" }), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "SCAC", { number: "A1" }), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "NY_HUT", { number: "" }), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "NY_HUT", { number: 12345 }), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "NY_HUT", { filingFrequency: "quarterly" }), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "NY_HUT", { password: "x" }), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "NY_HUT", { organizationId: "not-a-uuid" }), K.tr.RegistrationValidationError);
      await rejectsWith(create(o, "NY_HUT", { effectiveFrom: "2020-01-01" }), K.tr.RegistrationValidationError);
      await rejectsWith(create(randomUUID(), "NY_HUT"), K.tr.RegistrationNotFoundError);
      await rejectsWith(K.tr.createRegistration(null as never), K.tr.RegistrationValidationError);
    });

    scenario("the same Organization may hold several registrations, of one program or many; the number is what distinguishes them", async () => {
      await fullStaff();
      const o = await org();
      const first = (await create(o, "IFTA")).view.registration.id;
      const second = (await create(o, "IFTA")).view.registration.id;
      assert.notEqual(first, second);
      for (const program of NON_BASE_PROGRAMS) {
        const a = (await create(o, program)).view.registration.id;
        const b = (await create(o, program)).view.registration.id;
        assert.notEqual(a, b, program);
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [o]), 2 + NON_BASE_PROGRAMS.length * 2);
      // ... but never the same number twice in one namespace, not even within the Organization
      const held = (await create(o, "NY_HUT")).view.current.version!.numberNormalized;
      await rejectsWith(K.tr.createRegistration({ organizationId: o, program: "NY_HUT", number: held }), K.tr.RegistrationNumberCollisionError);
    });

    scenario("an archived or merged Organization cannot gain registrations and its existing registrations cannot change (server guard)", async () => {
      await fullStaff();
      const [archivedOrg, mergedOrg, survivor] = [await org("Archived"), await org("Merged"), await org("Survivor")];
      const a = (await create(archivedOrg, "TX_EXCISE")).view;
      const m = (await create(mergedOrg, "AR_MFT")).view;
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archivedOrg]);
      await pools.admin.query(`UPDATE public.organizations SET status = 'merged', merged_into_organization_id = $2 WHERE id = $1`, [mergedOrg, survivor]);
      for (const [organizationId, view] of [[archivedOrg, a], [mergedOrg, m]] as const) {
        const registrationId = view.registration.id;
        await rejectsWith(create(organizationId, "SCAC"), K.tr.RegistrationStateError);
        await rejectsWith(K.tr.changeRegistrationVersion({ organizationId, registrationId, expiresOn: "2031-01-01" }), K.tr.RegistrationStateError);
        await rejectsWith(K.tr.correctRegistrationVersion({ organizationId, registrationId, expiresOn: "2031-01-01" }), K.tr.RegistrationStateError);
        await rejectsWith(K.tr.changeRegistrationStatus({ organizationId, registrationId, status: "CLOSED" }), K.tr.RegistrationStateError);
        await rejectsWith(K.tr.correctRegistrationStatus({ organizationId, registrationId, status: "CLOSED" }), K.tr.RegistrationStateError);
        await rejectsWith(K.tr.archiveRegistration({ organizationId, registrationId }), K.tr.RegistrationStateError);
        await rejectsWith(K.tr.restoreRegistration({ organizationId, registrationId }), K.tr.RegistrationStateError);
        // history stays readable
        assert.equal((await K.tr.getOrganizationRegistrations(organizationId)).registrations.length, 1);
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = ANY($1::uuid[])`, [[archivedOrg, mergedOrg]]), 2);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_versions WHERE organization_id = ANY($1::uuid[])`, [[archivedOrg, mergedOrg]]), 2);
    });

    scenario("registrations reference the canonical organizations table: an unknown Organization is not found, and the foreign key backs it", async () => {
      await fullStaff();
      await rejectsWith(create(randomUUID(), "SCAC"), K.tr.RegistrationNotFoundError);
      await rejectsWith(K.tr.getOrganizationRegistrations(randomUUID()), K.tr.RegistrationNotFoundError);
      const fk = await pools.admin.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.registrations'::regclass AND contype = 'f'`);
      assert.ok(fk.rows.some((row) => /REFERENCES organizations\(id\) ON DELETE RESTRICT/.test(row.def)));
      assert.ok(fk.rows.some((row) => /REFERENCES registration_programs\(code\)/.test(row.def)));
    });
  });

  // =============================================================================================================
  describe("collisions and cross-Organization disclosure", () => {
    scenario("GLOBAL namespace: a SCAC collides across Organizations regardless of case or spacing; the same text in another program does not", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const scac = letters(4);
      await K.tr.createRegistration({ organizationId: a, program: "SCAC", number: scac });
      await rejectsWith(K.tr.createRegistration({ organizationId: b, program: "SCAC", number: ` ${scac.toLowerCase()} ` }), K.tr.RegistrationNumberCollisionError);
      await rejectsWith(K.tr.createRegistration({ organizationId: a, program: "SCAC", number: scac }), K.tr.RegistrationNumberCollisionError);
      // a different program with the same text is a different namespace
      await K.tr.createRegistration({ organizationId: b, program: "CA_CARRIER_CODE", number: scac });
      await K.tr.createRegistration({ organizationId: b, program: "TX_EXCISE", number: scac });
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [b]), 2);
    });

    scenario("NATIONAL namespace: FUEL_CHARGE and CA_CARRIER_CODE are one Canadian number space each", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      for (const program of ["FUEL_CHARGE", "CA_CARRIER_CODE"] as const) {
        const number = numberFor(program);
        await K.tr.createRegistration({ organizationId: a, program, number });
        await rejectsWith(K.tr.createRegistration({ organizationId: b, program, number: number.toLowerCase() }), K.tr.RegistrationNumberCollisionError);
        await rejectsWith(K.tr.createRegistration({ organizationId: b, program, number: `${number.slice(0, 2)}-${number.slice(2)}` }), K.tr.RegistrationNumberCollisionError);
      }
    });

    scenario("COUNTRY_REGION namespaces: each state / province program is its own number space and never mixes with another program", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const shared = `ZZ${digits()}`;
      const regional = ["CT_HUF", "NY_HUT", "KYU", "NM_WDT", "OR_WMT", "TX_EXCISE", "AR_MFT", "ON_TOBACCO"] as const;
      for (const program of regional) await K.tr.createRegistration({ organizationId: a, program, number: shared });
      for (const program of regional) await rejectsWith(K.tr.createRegistration({ organizationId: b, program, number: shared }), K.tr.RegistrationNumberCollisionError);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [b]), 0);
      const free = `ZZ${digits()}`;
      for (const program of regional) await K.tr.createRegistration({ organizationId: b, program, number: free });
    });

    scenario("IFTA: base-jurisdiction namespace; the same number under another base jurisdiction is allowed", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const number = numberFor("IFTA");
      await K.tr.createRegistration({ organizationId: a, program: "IFTA", number, jurisdiction: { country: "US", region: "TX" } });
      await rejectsWith(K.tr.createRegistration({ organizationId: b, program: "IFTA", number, jurisdiction: { country: "US", region: "TX" } }), K.tr.RegistrationNumberCollisionError);
      await K.tr.createRegistration({ organizationId: b, program: "IFTA", number, jurisdiction: { country: "CA", region: "AB" } });
      await K.tr.createRegistration({ organizationId: b, program: "IFTA", number, jurisdiction: { country: "US", region: "OK" } });
    });

    scenario("with TAX_REGISTRATION_READ the collision names the holder; with MANAGE alone it is generic and discloses nothing", async () => {
      const full = await staff("TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ");
      const blind = await staff("TAX_REGISTRATION_MANAGE");
      const [a, b] = [await org("A"), await org("B")];
      const n = letters(4);
      signIn(full);
      const held = await K.tr.createRegistration({ organizationId: a, program: "SCAC", number: n });

      const collide = async () => {
        try {
          await K.tr.createRegistration({ organizationId: b, program: "SCAC", number: n });
        } catch (error) {
          assert.ok(error instanceof K.tr.RegistrationNumberCollisionError);
          return error as InstanceType<typeof K.tr.RegistrationNumberCollisionError>;
        }
        assert.fail("expected a collision");
      };
      const visible = await collide();
      assert.equal(visible.match?.organizationId, a);
      assert.equal(visible.match?.registrationId, held.view.registration.id);
      assert.equal(visible.match?.recommendedAction, "OPEN_EXISTING");
      assert.equal(visible.match?.registrationStatus, "ACTIVE");
      assert.equal(visible.program, "SCAC");

      signIn(blind);
      const hidden = await collide();
      assert.equal(hidden.match, undefined);
      assert.equal(JSON.stringify(hidden).includes(a), false);
      assert.equal(JSON.stringify(hidden).includes(held.view.registration.id), false);
      assert.equal(hidden.message, visible.message);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [b]), 0);

      // review matches (ended / corrected holders) are produced only for READ holders
      signIn(full);
      const corrected = await K.tr.correctRegistrationVersion({ organizationId: a, registrationId: held.view.registration.id, number: letters(4) });
      assert.equal(corrected.reviewMatches.length, 0, "the new number has no history elsewhere");
      const reuse = await K.tr.createRegistration({ organizationId: b, program: "SCAC", number: n });
      assert.deepEqual(reuse.reviewMatches.map((m) => [m.organizationId, m.versionRecordStatus]), [[a, "corrected"]]);
      signIn(blind);
      const blindReuse = await K.tr.createRegistration({ organizationId: await org("C"), program: "SCAC", number: letters(4) });
      assert.deepEqual(blindReuse.reviewMatches, []);
    });

    scenario("a closed or archived registration keeps holding its number; the registry recommends restoring it", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const n = numberFor("NM_WDT");
      const held = (await K.tr.createRegistration({ organizationId: a, program: "NM_WDT", number: n })).view;
      await K.tr.changeRegistrationStatus({ organizationId: a, registrationId: held.registration.id, status: "CLOSED" });
      await rejectsWith(K.tr.createRegistration({ organizationId: b, program: "NM_WDT", number: n }), K.tr.RegistrationNumberCollisionError);
      await K.tr.archiveRegistration({ organizationId: a, registrationId: held.registration.id });
      await assert.rejects(K.tr.createRegistration({ organizationId: b, program: "NM_WDT", number: n }), (error: unknown) => {
        assert.ok(error instanceof K.tr.RegistrationNumberCollisionError);
        assert.equal(error.match?.recommendedAction, "RESTORE_ARCHIVED");
        assert.equal(error.match?.registrationRecordStatus, "archived");
        assert.equal(error.match?.registrationStatus, "CLOSED");
        return true;
      });
      // the same Organization cannot silently re-create the same number either (restore is the path back)
      await rejectsWith(K.tr.createRegistration({ organizationId: a, program: "NM_WDT", number: n }), K.tr.RegistrationNumberCollisionError);
      await K.tr.restoreRegistration({ organizationId: a, registrationId: held.registration.id });
    });

    scenario("checkRegistrationNumber is read-only, needs TAX_REGISTRATION_READ and writes no Master Register event", async () => {
      const actor = await fullStaff();
      const o = await org();
      const n = numberFor("KYU");
      const view = (await K.tr.createRegistration({ organizationId: o, program: "KYU", number: n })).view;
      const before = await eventTypes(actor.actorId);
      const hit = await K.tr.checkRegistrationNumber({ program: "KYU", number: n.toLowerCase() });
      assert.equal(hit.registered, true);
      assert.equal(hit.match?.organizationId, o);
      assert.equal(hit.match?.registrationId, view.registration.id);
      const miss = await K.tr.checkRegistrationNumber({ program: "KYU", number: numberFor("KYU") });
      assert.equal(miss.registered, false);
      assert.equal(miss.match, null);
      const otherProgram = await K.tr.checkRegistrationNumber({ program: "TX_EXCISE", number: n });
      assert.equal(otherProgram.registered, false, "another program is another namespace");
      const scac = await K.tr.checkRegistrationNumber({ program: "SCAC", number: "abcd" });
      assert.equal(scac.registered, false);
      await rejectsWith(K.tr.checkRegistrationNumber({ program: "SCAC", number: "abcd", jurisdiction: { country: "US" } } as never), K.tr.RegistrationValidationError);
      await rejectsWith(K.tr.checkRegistrationNumber({ program: "IFTA", number: "1" } as never), K.tr.RegistrationValidationError);
      await rejectsWith(K.tr.checkRegistrationNumber({ program: "KYU", number: "1", extra: true } as never), K.tr.RegistrationValidationError);
      assert.deepEqual(await eventTypes(actor.actorId), before);

      signIn(await staff("TAX_REGISTRATION_MANAGE"));
      await denied(K.tr.checkRegistrationNumber({ program: "KYU", number: n }));
    });

    scenario("concurrent creation of the same number in different Organizations yields exactly one winner and domain collisions for the rest", async () => {
      const as = await concurrentActors(4);
      const orgs = await Promise.all([org(), org(), org(), org()]);
      for (const [program, number] of [["SCAC", letters(4)], ["CA_CARRIER_CODE", numberFor("CA_CARRIER_CODE")], ["TX_EXCISE", numberFor("TX_EXCISE")]] as const) {
        const results = await Promise.allSettled(orgs.map((id, i) => as(i, () => K.tr.createRegistration({ organizationId: id, program, number }))));
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, program);
        for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.tr.RegistrationNumberCollisionError, String(r.reason));
        assert.equal(await rowCount(`SELECT count(*) FROM public.registration_versions WHERE program_code = $1 AND number_normalized = $2 AND record_status = 'active' AND effective_to IS NULL`, [program, number.toUpperCase()]), 1, program);
      }
    });

    scenario("concurrent creation in one Organization: distinct numbers all succeed; the same number yields exactly one", async () => {
      const as = await concurrentActors(4);
      const o = await org();
      const distinct = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => as(i, () => create(o, "NY_HUT"))));
      assert.equal(distinct.filter((r) => r.status === "fulfilled").length, 4, JSON.stringify(distinct.filter((r) => r.status === "rejected")));
      const number = numberFor("NY_HUT");
      const same = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => as(i, () => K.tr.createRegistration({ organizationId: o, program: "NY_HUT", number }))));
      assert.equal(same.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of same) if (r.status === "rejected") assert.ok(r.reason instanceof K.tr.RegistrationNumberCollisionError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [o]), 5, "losers left no orphan registration behind");
    });

    scenario("a concurrent change and a concurrent creation fighting for one IFTA namespace slot yield one winner and a domain error", async () => {
      const as = await concurrentActors(2);
      const [a, b] = [await org("A"), await org("B")];
      const number = numberFor("IFTA");
      await fullStaff();
      const target = (await K.tr.createRegistration({ organizationId: a, program: "IFTA", number, jurisdiction: { country: "US", region: "OK" }, effectiveFrom: MONTH(1) })).view;
      const results = await Promise.allSettled([
        as(0, () => K.tr.changeRegistrationVersion({ organizationId: a, registrationId: target.registration.id, jurisdiction: { country: "US", region: "TX" }, effectiveFrom: MONTH(2) })),
        as(1, () => K.tr.createRegistration({ organizationId: b, program: "IFTA", number, jurisdiction: { country: "US", region: "TX" } })),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.tr.RegistrationNumberCollisionError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_versions WHERE program_code = 'IFTA' AND jurisdiction_region = 'TX' AND number_normalized = $1 AND record_status = 'active' AND effective_to IS NULL`, [number.toUpperCase()]), 1);
    });
  });

  // =============================================================================================================
  describe("cross-Organization non-leakage", () => {
    scenario("reads for one Organization never contain another Organization's rows, ids or numbers", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const va = (await create(a, "CT_HUF")).view;
      const vb = (await create(b, "CT_HUF")).view;
      await K.tr.correctRegistrationStatus({ organizationId: b, registrationId: vb.registration.id, status: "SUSPENDED" });
      const readA = JSON.stringify(await K.tr.getOrganizationRegistrations(a));
      assert.equal(readA.includes(vb.registration.id), false);
      assert.equal(readA.includes(vb.current.version!.numberNormalized), false);
      assert.equal(readA.includes(b), false);
      assert.equal(readA.includes(va.registration.id), true);
      const readAsOf = JSON.stringify(await K.tr.getOrganizationRegistrations(a, { asOf: new Date().toISOString() }));
      assert.equal(readAsOf.includes(vb.registration.id), false);
      // a registration is reachable only through its own Organization, for every mutation
      for (const work of [
        () => K.tr.changeRegistrationVersion({ organizationId: b, registrationId: va.registration.id, expiresOn: "2030-01-01" }),
        () => K.tr.correctRegistrationVersion({ organizationId: b, registrationId: va.registration.id, expiresOn: "2030-01-01" }),
        () => K.tr.changeRegistrationStatus({ organizationId: b, registrationId: va.registration.id, status: "INACTIVE" }),
        () => K.tr.correctRegistrationStatus({ organizationId: b, registrationId: va.registration.id, status: "INACTIVE" }),
        () => K.tr.archiveRegistration({ organizationId: b, registrationId: va.registration.id }),
        () => K.tr.restoreRegistration({ organizationId: b, registrationId: va.registration.id }),
      ]) await rejectsWith(work(), K.tr.RegistrationNotFoundError);
      assert.equal((await K.tr.getOrganizationRegistrations(a)).registrations[0].current.status!.registrationStatus, "ACTIVE");
    });
  });

  // =============================================================================================================
  describe("identity invariants", () => {
    scenario("every registration always has exactly one current genuine version and one current status", async () => {
      await fullStaff();
      const o = await org();
      const { view } = await create(o, "IFTA", { expiresOn: "2030-01-01", effectiveFrom: MONTH(1) });
      const id = view.registration.id;
      await K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, expiresOn: "2031-01-01", effectiveFrom: MONTH(3) });
      await K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01" });
      await K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "SUSPENDED", effectiveFrom: MONTH(4) });
      await K.tr.correctRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE" });
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_versions WHERE registration_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_status_periods WHERE registration_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]), 1);
    });
  });

  // =============================================================================================================
  describe("status, reactivation, archive", () => {
    scenario("status history records observed status without a transition matrix; a return to ACTIVE is a recorded reactivation of the same registration", async () => {
      const actor = await fullStaff();
      const o = await org();
      const created = (await create(o, "NY_HUT", { effectiveFrom: MONTH(1) })).view;
      const id = created.registration.id;
      const number = created.current.version!.numberNormalized;
      const t = (status: string, month: number) => K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: status as never, effectiveFrom: MONTH(month) });

      await rejectsWith(t("ACTIVE", 2), K.tr.RegistrationStateError); // unchanged is the only refusal
      await t("SUSPENDED", 2);
      const reactivated = await t("ACTIVE", 3);
      assert.equal(reactivated.registration.id, id);
      assert.equal(reactivated.current.version!.numberNormalized, number);
      assert.equal(reactivated.current.status!.registrationStatus, "ACTIVE");
      assert.equal(reactivated.current.status!.periodReason, "REACTIVATION");

      // no invented legal matrix: CLOSED -> SUSPENDED and ACTIVE -> PENDING are simply recorded observations
      await t("CLOSED", 4);
      await t("SUSPENDED", 5);
      await t("ACTIVE", 6);
      await t("PENDING", 7);
      await t("INACTIVE", 8);
      const history = (await K.tr.getOrganizationRegistrations(o)).registrations[0].statusPeriods.filter((p) => p.recordStatus === "active");
      assert.deepEqual(history.map((p) => p.registrationStatus), ["ACTIVE", "SUSPENDED", "ACTIVE", "CLOSED", "SUSPENDED", "ACTIVE", "PENDING", "INACTIVE"]);
      assert.deepEqual(history.map((p) => p.periodReason), ["INITIAL", "TRANSITION", "REACTIVATION", "TRANSITION", "TRANSITION", "REACTIVATION", "TRANSITION", "TRANSITION"]);
      assert.equal(history.filter((p) => p.effectiveTo === null).length, 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [o]), 1, "never a second registration");
      assert.equal((await eventTypes(actor.actorId)).filter((e) => e === "RECORD_STATUS_CHANGED").length, 7);
      for (const bad of ["REVOKED", "CANCELED", "EXPIRED", "ARCHIVED"]) await rejectsWith(t(bad, 9), K.tr.RegistrationValidationError);
    });

    scenario("a never-active PENDING registration is activated (a transition, not a reactivation)", async () => {
      await fullStaff();
      const o = await org();
      const id = ids((await create(o, "ON_TOBACCO", { status: "PENDING" }).then((r) => r.view)));
      const active = await K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "ACTIVE" });
      assert.equal(active.current.status!.periodReason, "TRANSITION");
    });

    scenario("a status correction preserves the wrong period, never ends it, and inherits its business time", async () => {
      await fullStaff();
      const o = await org();
      const id = ids((await create(o, "KYU", { effectiveFrom: MONTH(1) })).view);
      const view = await K.tr.correctRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE" });
      const wrong = view.statusPeriods.find((p) => p.recordStatus === "corrected")!;
      const right = view.current.status!;
      assert.equal(wrong.registrationStatus, "ACTIVE");
      assert.equal(wrong.effectiveTo, null, "a correction never ends the wrong row");
      assert.equal(wrong.supersededByPeriodId, right.id);
      assert.notEqual(wrong.correctedAt, null);
      assert.equal(right.registrationStatus, "INACTIVE");
      assert.equal(right.periodReason, "CORRECTION");
      assert.equal(right.effectiveFrom, wrong.effectiveFrom);
      assert.equal(view.statusPeriods.filter((p) => p.recordStatus === "active").length, 1, "no invented transition");
      await rejectsWith(K.tr.correctRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE" }), K.tr.RegistrationValidationError);
      // as-of reads never answer from the corrected row
      const asOf = (await K.tr.getOrganizationRegistrations(o, { asOf: MONTH(2) })).registrations[0];
      assert.equal(asOf.asOf!.status!.registrationStatus, "INACTIVE");
    });

    scenario("archive is TES record lifecycle independent of registration status: allowed in any status, blocks changes, restore returns the same registration", async () => {
      const actor = await fullStaff();
      const o = await org();
      for (const status of K.defs.REGISTRATION_STATUSES) {
        const view = (await create(o, "OR_WMT", { status })).view;
        const archived = await K.tr.archiveRegistration({ organizationId: o, registrationId: view.registration.id });
        assert.equal(archived.registration.recordStatus, "archived", status);
        assert.equal(archived.current.status!.registrationStatus, status, "archive does not touch registration status");
        await K.tr.restoreRegistration({ organizationId: o, registrationId: view.registration.id });
      }
      const id = ids((await create(o, "OR_WMT")).view);
      const archived = await K.tr.archiveRegistration({ organizationId: o, registrationId: id });
      assert.equal(archived.registration.recordStatus, "archived");
      assert.ok(archived.registration.archivedAt);
      await rejectsWith(K.tr.archiveRegistration({ organizationId: o, registrationId: id }), K.tr.RegistrationStateError);
      await rejectsWith(K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE" }), K.tr.RegistrationStateError);
      await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01" }), K.tr.RegistrationStateError);
      await rejectsWith(K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01" }), K.tr.RegistrationStateError);
      await rejectsWith(K.tr.correctRegistrationStatus({ organizationId: o, registrationId: id, status: "CLOSED" }), K.tr.RegistrationStateError);
      const restored = await K.tr.restoreRegistration({ organizationId: o, registrationId: id });
      assert.equal(restored.registration.id, id);
      assert.equal(restored.registration.recordStatus, "active");
      assert.equal(restored.registration.archivedAt, null);
      await rejectsWith(K.tr.restoreRegistration({ organizationId: o, registrationId: id }), K.tr.RegistrationStateError);
      const types = await eventTypes(actor.actorId);
      assert.ok(types.includes("RECORD_ARCHIVED") && types.includes("RECORD_RESTORED"));
    });
  });

  // =============================================================================================================
  describe("number and jurisdiction: changes versus corrections", () => {
    scenario("a renewed licence / certificate period is a real-world change for EVERY program; the earlier period stays genuine history", async () => {
      await fullStaff();
      const o = await org();
      for (const program of PROGRAMS) {
        const created = (await create(o, program, { issuedOn: "2020-01-01", expiresOn: "2021-01-01", effectiveFrom: MONTH(1) })).view;
        const id = created.registration.id;
        const renewed = (await K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2021-01-01", expiresOn: "2022-01-01", effectiveFrom: MONTH(6) })).view;
        assert.equal(renewed.current.version!.expiresOn, "2022-01-01", program);
        assert.equal(renewed.current.version!.versionReason, "CHANGE", program);
        assert.equal(renewed.current.version!.numberNormalized, created.current.version!.numberNormalized, `${program}: same number carries over`);
        const genuine = renewed.versions.filter((v) => v.recordStatus === "active");
        assert.deepEqual(genuine.map((v) => v.expiresOn), ["2021-01-01", "2022-01-01"], program);
        assert.notEqual(genuine[0].effectiveTo, null, program);
        const early = (await K.tr.getOrganizationRegistrations(o, { asOf: MONTH(3) })).registrations.find((r) => r.registration.id === id)!;
        assert.equal(early.asOf!.version!.expiresOn, "2021-01-01", program);
        const late = (await K.tr.getOrganizationRegistrations(o, { asOf: MONTH(8) })).registrations.find((r) => r.registration.id === id)!;
        assert.equal(late.asOf!.version!.expiresOn, "2022-01-01", program);
      }
    });

    scenario("a date can be cleared by correction, an unchanged or empty change is refused, and time cannot move backwards or into the future", async () => {
      await fullStaff();
      const o = await org();
      const id = ids((await create(o, "AR_MFT", { expiresOn: "2025-01-01", effectiveFrom: MONTH(2) })).view);
      const cleared = (await K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, expiresOn: null })).view;
      assert.equal(cleared.current.version!.expiresOn, null);
      await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id } as never), K.tr.RegistrationValidationError);
      await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, expiresOn: null }), K.tr.RegistrationValidationError);
      await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01", effectiveFrom: MONTH(1) }), K.tr.RegistrationValidationError);
      await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01", effectiveFrom: "2999-01-01T00:00:00Z" }), K.tr.RegistrationValidationError);
      await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01", effectiveFrom: "2020-01-01" }), K.tr.RegistrationValidationError);
      await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01", expiresOn: "2019-01-01" }), K.tr.RegistrationValidationError);
      assert.equal((await K.tr.getOrganizationRegistrations(o)).registrations[0].versions.length, 2, "refused calls left no row behind");
    });

    scenario("a change of NUMBER or JURISDICTION in place is refused for every program except IFTA", async () => {
      await fullStaff();
      const o = await org();
      for (const program of NON_BASE_PROGRAMS) {
        const id = ids((await create(o, program)).view);
        await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, number: numberFor(program) }), K.tr.RegistrationValidationError);
        const def = K.defs.PROGRAM_DEFINITIONS[program];
        if (def.jurisdictionScope === "COUNTRY_REGION") {
          await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, jurisdiction: { country: def.issuerCountry, region: def.issuerCountry === "US" ? "WA" : "QC" } } as never), K.tr.RegistrationValidationError);
        }
        if (def.jurisdictionScope === "GLOBAL") {
          await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, jurisdiction: { country: "US" } } as never), K.tr.RegistrationValidationError);
        }
        // a formatting-only change of the displayed number is still a change of the number
        const current = (await K.tr.getOrganizationRegistrations(o)).registrations.find((r) => r.registration.id === id)!.current.version!;
        await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, number: current.numberDisplay.toLowerCase() === current.numberDisplay ? current.numberDisplay.toUpperCase() : current.numberDisplay.toLowerCase() }), K.tr.RegistrationValidationError);
        const view = (await K.tr.getOrganizationRegistrations(o)).registrations.find((r) => r.registration.id === id)!;
        assert.equal(view.versions.length, 1, `${program}: refused change left the version untouched`);
        assert.equal(view.current.version!.effectiveTo, null);
      }
    });

    scenario("IFTA base move is a business transition; both base jurisdictions stay genuine history and as-of reads follow business time", async () => {
      const actor = await fullStaff();
      const o = await org();
      const created = (await create(o, "IFTA", { jurisdiction: { country: "CA", region: "AB" }, effectiveFrom: MONTH(1) })).view;
      const id = created.registration.id;
      const reissued = alnum("IF");
      const moved = (await K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, jurisdiction: { country: "US", region: "TX" }, number: reissued, effectiveFrom: MONTH(6) })).view;
      assert.equal(moved.registration.id, id, "same registration");
      assert.equal(moved.current.version!.jurisdictionRegion, "TX");
      assert.equal(moved.current.version!.numberNormalized, reissued.toUpperCase());
      assert.equal(moved.current.version!.versionReason, "CHANGE");
      const genuine = moved.versions.filter((v) => v.recordStatus === "active");
      assert.deepEqual(genuine.map((v) => v.jurisdictionRegion), ["AB", "TX"]);
      assert.notEqual(genuine[0].effectiveTo, null);
      const early = (await K.tr.getOrganizationRegistrations(o, { asOf: MONTH(3) })).registrations[0];
      assert.equal(early.asOf!.version!.jurisdictionRegion, "AB");
      assert.equal(early.asOf!.version!.numberNormalized, created.current.version!.numberNormalized);
      const late = (await K.tr.getOrganizationRegistrations(o, { asOf: MONTH(8) })).registrations[0];
      assert.equal(late.asOf!.version!.jurisdictionRegion, "TX");
      // only the base moves: the same number kept, in a new namespace
      const kept = (await K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, jurisdiction: { country: "US", region: "OK" }, effectiveFrom: MONTH(9) })).view;
      assert.equal(kept.current.version!.numberNormalized, reissued.toUpperCase());
      assert.equal(kept.versions.filter((v) => v.recordStatus === "active").length, 3);
      assert.ok((await eventTypes(actor.actorId)).includes("RECORD_UPDATED"));
    });

    scenario("an IFTA change into an occupied namespace is a collision and rolls back completely (the old version is NOT ended)", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const number = numberFor("IFTA");
      await K.tr.createRegistration({ organizationId: a, program: "IFTA", number, jurisdiction: { country: "US", region: "TX" } });
      const mine = (await K.tr.createRegistration({ organizationId: b, program: "IFTA", number, jurisdiction: { country: "US", region: "OK" }, effectiveFrom: MONTH(1) })).view;
      await rejectsWith(K.tr.changeRegistrationVersion({ organizationId: b, registrationId: mine.registration.id, jurisdiction: { country: "US", region: "TX" }, effectiveFrom: MONTH(2) }), K.tr.RegistrationNumberCollisionError);
      const after = (await K.tr.getOrganizationRegistrations(b)).registrations[0];
      assert.equal(after.versions.length, 1);
      assert.equal(after.current.version!.jurisdictionRegion, "OK");
      assert.equal(after.current.version!.effectiveTo, null, "the failed change rolled back, including ending the old version");
    });

    scenario("a wrongly recorded base jurisdiction is a CORRECTION: the wrong version is preserved, flagged, never ended, excluded from current and as-of", async () => {
      await fullStaff();
      const o = await org();
      const created = (await create(o, "IFTA", { jurisdiction: { country: "CA", region: "AB" }, effectiveFrom: MONTH(1) })).view;
      const id = created.registration.id;
      const view = (await K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, jurisdiction: { country: "CA", region: "BC" } })).view;
      const wrong = view.versions.find((v) => v.recordStatus === "corrected")!;
      assert.equal(wrong.jurisdictionRegion, "AB");
      assert.equal(wrong.effectiveTo, null);
      assert.notEqual(wrong.correctedAt, null);
      assert.equal(wrong.supersededByVersionId, view.current.version!.id);
      assert.equal(view.current.version!.jurisdictionRegion, "BC");
      assert.equal(view.current.version!.versionReason, "CORRECTION");
      assert.equal(view.current.version!.effectiveFrom, wrong.effectiveFrom, "inherits business time");
      const asOf = (await K.tr.getOrganizationRegistrations(o, { asOf: MONTH(3) })).registrations[0];
      assert.equal(asOf.asOf!.version!.jurisdictionRegion, "BC", "the corrected row never answers as-of");
      assert.equal(view.versions.filter((v) => v.recordStatus === "active").length, 1, "no invented transition");
    });

    scenario("for non-IFTA programs a wrong number is a CORRECTION: preserved, freed from the namespace, and the new number is protected", async () => {
      await fullStaff();
      const [a, b, c] = [await org("A"), await org("B"), await org("C")];
      for (const program of NON_BASE_PROGRAMS) {
        const wrong = numberFor(program);
        const right = numberFor(program);
        const id = ids((await K.tr.createRegistration({ organizationId: a, program, number: wrong })).view);
        const view = (await K.tr.correctRegistrationVersion({ organizationId: a, registrationId: id, number: right })).view;
        assert.equal(view.current.version!.numberNormalized, right.toUpperCase(), program);
        assert.equal(view.versions.find((v) => v.recordStatus === "corrected")!.numberNormalized, wrong.toUpperCase(), program);
        // the wrong number no longer blocks anyone; the right one does
        const taken = await K.tr.createRegistration({ organizationId: b, program, number: wrong });
        assert.equal(taken.view.current.version!.numberNormalized, wrong.toUpperCase(), program);
        await rejectsWith(K.tr.createRegistration({ organizationId: c, program, number: right }), K.tr.RegistrationNumberCollisionError);
        // correcting into a number someone else holds is a collision and rolls back
        await rejectsWith(K.tr.correctRegistrationVersion({ organizationId: a, registrationId: id, number: wrong }), K.tr.RegistrationNumberCollisionError);
        const after = (await K.tr.getOrganizationRegistrations(a)).registrations.find((r) => r.registration.id === id)!;
        assert.equal(after.current.version!.numberNormalized, right.toUpperCase(), program);
        assert.equal(after.versions.length, 2, `${program}: the failed correction rolled back`);
        // and an unchanged correction / empty change is refused
        await rejectsWith(K.tr.correctRegistrationVersion({ organizationId: a, registrationId: id, number: right }), K.tr.RegistrationValidationError);
        await rejectsWith(K.tr.correctRegistrationVersion({ organizationId: a, registrationId: id } as never), K.tr.RegistrationValidationError);
      }
    });

    scenario("a wrongly recorded jurisdiction of a fixed-region program cannot be 'corrected' to another region either (the program decides the region)", async () => {
      await fullStaff();
      const o = await org();
      const id = ids((await create(o, "CT_HUF")).view);
      await rejectsWith(K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, jurisdiction: { region: "NY" } }), K.tr.RegistrationValidationError);
      await rejectsWith(K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, jurisdiction: { country: "US", region: "CT" }, number: "x!" }), K.tr.RegistrationValidationError);
    });

    scenario("a correction that lands in an occupied IFTA namespace is a collision and rolls back", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const number = numberFor("IFTA");
      await K.tr.createRegistration({ organizationId: a, program: "IFTA", number, jurisdiction: { country: "US", region: "TX" } });
      const ok = (await K.tr.createRegistration({ organizationId: b, program: "IFTA", number, jurisdiction: { country: "CA", region: "BC" } })).view.registration.id;
      await rejectsWith(K.tr.correctRegistrationVersion({ organizationId: b, registrationId: ok, jurisdiction: { country: "US", region: "TX" } }), K.tr.RegistrationNumberCollisionError);
      assert.equal((await K.tr.getOrganizationRegistrations(b)).registrations[0].current.version!.jurisdictionRegion, "BC");
    });

    scenario("concurrent corrections of one registration serialize: one current version, every wrong row preserved", async () => {
      const as = await concurrentActors(3);
      await fullStaff();
      const o = await org();
      const id = ids((await create(o, "NM_WDT")).view);
      const results = await Promise.allSettled([0, 1, 2].map((i) => as(i, () => K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, number: numberFor("NM_WDT") }))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 3, JSON.stringify(results.filter((r) => r.status === "rejected")));
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_versions WHERE registration_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_versions WHERE registration_id = $1 AND record_status = 'corrected'`, [id]), 3);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_versions WHERE registration_id = $1`, [id]), 4);
    });

    scenario("concurrent status changes and a concurrent correction serialize without losing the current period", async () => {
      const as = await concurrentActors(3);
      await fullStaff();
      const o = await org();
      const id = ids((await create(o, "KYU", { effectiveFrom: MONTH(1) })).view);
      const results = await Promise.allSettled([
        as(0, () => K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "SUSPENDED", effectiveFrom: MONTH(2) })),
        as(1, () => K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE", effectiveFrom: MONTH(3) })),
        as(2, () => K.tr.correctRegistrationStatus({ organizationId: o, registrationId: id, status: "PENDING" })),
      ]);
      assert.ok(results.some((r) => r.status === "fulfilled"));
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.tr.RegistrationError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_status_periods WHERE registration_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]), 1);
    });

    scenario("a concurrent archive and a concurrent change serialize: no change lands on an archived registration", async () => {
      const as = await concurrentActors(2);
      await fullStaff();
      const o = await org();
      const id = ids((await create(o, "TX_EXCISE", { effectiveFrom: MONTH(1) })).view);
      const results = await Promise.allSettled([
        as(0, () => K.tr.archiveRegistration({ organizationId: o, registrationId: id })),
        as(1, () => K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "SUSPENDED", effectiveFrom: MONTH(2) })),
      ]);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.tr.RegistrationStateError, String(r.reason));
      assert.ok(results.some((r) => r.status === "fulfilled"));
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_status_periods WHERE registration_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]), 1);
    });
  });

  // =============================================================================================================
  describe("Master Register (same transaction)", () => {
    scenario("each mutation family writes its existing event type; reads, lookups and refused calls write none", async () => {
      const actor = await fullStaff();
      const o = await org();
      const id = ids((await create(o, "IFTA", { effectiveFrom: MONTH(1) })).view);
      await K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, jurisdiction: { country: "US", region: "OK" }, effectiveFrom: MONTH(2) });
      await K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, jurisdiction: { country: "US", region: "KS" } });
      await K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE", effectiveFrom: MONTH(3) });
      await K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "ACTIVE", effectiveFrom: MONTH(4) });
      await K.tr.correctRegistrationStatus({ organizationId: o, registrationId: id, status: "SUSPENDED" });
      await K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "CLOSED", effectiveFrom: MONTH(5) });
      await K.tr.archiveRegistration({ organizationId: o, registrationId: id });
      await K.tr.restoreRegistration({ organizationId: o, registrationId: id });
      const writes = await eventTypes(actor.actorId);
      assert.deepEqual([...writes].sort(), [
        "RECORD_ARCHIVED", "RECORD_CORRECTED", "RECORD_CORRECTED", "RECORD_CREATED", "RECORD_RESTORED",
        "RECORD_STATUS_CHANGED", "RECORD_STATUS_CHANGED", "RECORD_STATUS_CHANGED", "RECORD_UPDATED",
      ]);
      // reads, lookups, refused calls
      await K.tr.getOrganizationRegistrations(o);
      await K.tr.getOrganizationRegistrations(o, { asOf: MONTH(2) });
      await K.tr.checkRegistrationNumber({ program: "SCAC", number: letters(3) });
      await assert.rejects(K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "CLOSED" })); // already CLOSED
      const held = (await K.tr.getOrganizationRegistrations(o)).registrations[0].current.version!.numberNormalized;
      await assert.rejects(K.tr.createRegistration({ organizationId: o, program: "IFTA", number: held, jurisdiction: { country: "US", region: "KS" } }), K.tr.RegistrationNumberCollisionError);
      assert.deepEqual(await eventTypes(actor.actorId), writes);
    });

    scenario("events carry only table:id references and small controlled-vocabulary literals: never numbers, jurisdictions, dates, amounts or free text", async () => {
      const actor = await fullStaff();
      const o = await org();
      const number = alnum("MR");
      const id = ids((await K.tr.createRegistration({ organizationId: o, program: "IFTA", number, jurisdiction: { country: "US", region: "TX" }, issuedOn: "2021-03-04", expiresOn: "2031-05-06", effectiveFrom: MONTH(1) })).view);
      await K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, expiresOn: "2032-07-08", effectiveFrom: MONTH(2) });
      await K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2021-09-10" });
      await K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "SUSPENDED", effectiveFrom: MONTH(3) });
      await K.tr.correctRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE" });
      await K.tr.archiveRegistration({ organizationId: o, registrationId: id });
      await K.tr.restoreRegistration({ organizationId: o, registrationId: id });

      const events = (await pools.admin.query<{ event_type: string; target: { resourceType: string; resourceId: string; subjectReferences: string[] }; change_set: { fieldChanges: Array<{ field: string; before?: { kind: string; value?: unknown; reference?: string }; after?: { kind: string; value?: unknown; reference?: string } }> } }>(
        `SELECT event_type, target, change_set FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type, event_id`, [actor.actorId],
      )).rows;
      assert.equal(events.length, 7);
      const vocabulary = new Set<unknown>([...K.defs.PROGRAM_CODES, ...K.defs.REGISTRATION_STATUSES, "active", "archived"]);
      const resourceTypes = new Set(["registration", "registration_version", "registration_status_period"]);
      for (const event of events) {
        assert.ok(resourceTypes.has(event.target.resourceType), event.target.resourceType);
        assert.match(event.target.resourceId, /^[0-9a-f-]{36}$/);
        assert.deepEqual(event.target.subjectReferences, [`organization:${o}`]);
        for (const change of event.change_set.fieldChanges) {
          for (const side of [change.before, change.after]) {
            if (!side) continue;
            if (side.kind === "REFERENCE") assert.match(String(side.reference), /^registration_(versions|status_periods):[0-9a-f-]{36}$/);
            else if (side.kind === "LITERAL") assert.ok(vocabulary.has(side.value), `literal ${String(side.value)} is not controlled vocabulary`);
            else assert.fail(`unexpected change value kind ${side.kind}`);
          }
        }
      }
      const json = await eventsJson(actor.actorId);
      for (const forbidden of [number, number.toUpperCase(), "2021-03-04", "2031-05-06", "2032-07-08", "2021-09-10", "2020-01-01", "2020-02-01", "numberDisplay", "number_display", "numberNormalized", "jurisdiction"]) {
        assert.equal(json.includes(forbidden), false, forbidden);
      }
    });

    scenario("a Master Register failure rolls the whole mutation back (creation, version change / correction, status change / correction, archive, restore)", async () => {
      await fullStaff();
      const o = await org();
      const id = ids((await create(o, "IFTA", { effectiveFrom: MONTH(1) })).view);
      const archivedId = ids((await create(o, "SCAC", { effectiveFrom: MONTH(1) })).view);
      await K.tr.archiveRegistration({ organizationId: o, registrationId: archivedId });
      const snapshot = async () =>
        JSON.stringify([
          (await pools.admin.query(`SELECT id, record_status, effective_to FROM public.registration_versions WHERE organization_id = $1 ORDER BY id`, [o])).rows,
          (await pools.admin.query(`SELECT id, registration_status, record_status, effective_to FROM public.registration_status_periods WHERE registration_id IN (SELECT id FROM public.registrations WHERE organization_id = $1) ORDER BY id`, [o])).rows,
          (await pools.admin.query(`SELECT id, record_status FROM public.registrations WHERE organization_id = $1 ORDER BY id`, [o])).rows,
        ]);
      const before = await snapshot();
      for (const [eventType, work] of [
        ["RECORD_CORRECTED", () => K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01" })],
        ["RECORD_CORRECTED", () => K.tr.correctRegistrationStatus({ organizationId: o, registrationId: id, status: "PENDING" })],
        ["RECORD_UPDATED", () => K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-02-01", effectiveFrom: MONTH(2) })],
        ["RECORD_STATUS_CHANGED", () => K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE", effectiveFrom: MONTH(2) })],
        ["RECORD_ARCHIVED", () => K.tr.archiveRegistration({ organizationId: o, registrationId: id })],
        ["RECORD_RESTORED", () => K.tr.restoreRegistration({ organizationId: o, registrationId: archivedId })],
      ] as Array<[string, () => Promise<unknown>]>) {
        await refuseMasterRegisterEvent(eventType);
        await assert.rejects(work(), /master register|Master Register/i);
        assert.equal(await snapshot(), before, `${eventType} rolled back`);
      }
      await refuseMasterRegisterEvent("RECORD_CREATED");
      const o2 = await org();
      await assert.rejects(create(o2, "SCAC"), /master register|Master Register/i);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [o2]), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_versions WHERE organization_id = $1`, [o2]), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_status_periods WHERE registration_id IN (SELECT id FROM public.registrations WHERE organization_id = $1)`, [o2]), 0);
    });
  });

  // =============================================================================================================
  describe("authorization", () => {
    scenario("no session, no capability, and the wrong capability are all denied and change nothing", async () => {
      await fullStaff();
      const o = await org();
      const id = ids((await create(o, "KYU")).view);

      K.db.setClerkUser(null);
      await assert.rejects(K.tr.getOrganizationRegistrations(o));
      await assert.rejects(create(o, "SCAC"));

      const everything = (): Array<() => Promise<unknown>> => [
        () => create(o, "SCAC"),
        () => K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01" }),
        () => K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01" }),
        () => K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE" }),
        () => K.tr.correctRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE" }),
        () => K.tr.archiveRegistration({ organizationId: o, registrationId: id }),
        () => K.tr.restoreRegistration({ organizationId: o, registrationId: id }),
        () => K.tr.getOrganizationRegistrations(o),
        () => K.tr.checkRegistrationNumber({ program: "KYU", number: "1" }),
      ];
      signIn(await staff());
      for (const call of everything()) await denied(call());
      // the neighbouring domains' capabilities do not substitute
      signIn(await staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "ORGANIZATION_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "CUSTOMER_RELATIONSHIP_READ", "CONTACT_MANAGE", "PERSON_REGISTRY_READ"));
      for (const call of everything()) await denied(call());
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [o]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_versions WHERE registration_id = $1`, [id]), 1);
    });

    scenario("TAX_REGISTRATION_READ alone reads and looks up but cannot mutate anything", async () => {
      await fullStaff();
      const o = await org();
      const id = ids((await create(o, "KYU")).view);
      const number = (await K.tr.getOrganizationRegistrations(o)).registrations[0].current.version!.numberNormalized;
      signIn(await staff("TAX_REGISTRATION_READ"));
      assert.equal((await K.tr.getOrganizationRegistrations(o)).registrations.length, 1);
      assert.equal((await K.tr.checkRegistrationNumber({ program: "KYU", number })).registered, true);
      await denied(create(o, "SCAC"));
      await denied(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01" }));
      await denied(K.tr.correctRegistrationVersion({ organizationId: o, registrationId: id, issuedOn: "2020-01-01" }));
      await denied(K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE" }));
      await denied(K.tr.correctRegistrationStatus({ organizationId: o, registrationId: id, status: "INACTIVE" }));
      await denied(K.tr.archiveRegistration({ organizationId: o, registrationId: id }));
      await denied(K.tr.restoreRegistration({ organizationId: o, registrationId: id }));
      assert.equal((await K.tr.getOrganizationRegistrations(o)).registrations[0].versions.length, 1);
    });

    scenario("TAX_REGISTRATION_MANAGE alone mutates but cannot read, look up, or learn who holds a number", async () => {
      const actor = await staff("TAX_REGISTRATION_MANAGE");
      signIn(actor);
      const o = await org();
      const created = await create(o, "SCAC");
      assert.deepEqual(created.reviewMatches, []);
      const id = created.view.registration.id;
      await K.tr.changeRegistrationStatus({ organizationId: o, registrationId: id, status: "SUSPENDED" });
      await K.tr.archiveRegistration({ organizationId: o, registrationId: id });
      await K.tr.restoreRegistration({ organizationId: o, registrationId: id });
      await denied(K.tr.getOrganizationRegistrations(o));
      await denied(K.tr.getOrganizationRegistrations(o, { asOf: MONTH(1) }));
      await denied(K.tr.checkRegistrationNumber({ program: "SCAC", number: "ABCD" }));
      assert.deepEqual((await eventTypes(actor.actorId)).filter((e) => e === "RECORD_CREATED").length, 1);
    });

    scenario("customers have no access: a customer-scope user, even with a SYSTEM capability grant on a customer assignment, is denied everything", async () => {
      await fullStaff();
      const customerA = await fx.organizationAndCustomer("CustA");
      customerOrganizations.push(customerA.organizationId);
      const view = (await create(customerA.organizationId, "TX_EXCISE")).view;

      const user = await fx.actor();
      const relationshipId = await fx.relationship(user.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customerA.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      await fx.grant(relationshipId, "TAX_REGISTRATION_READ", { assignmentId }).catch(() => undefined);
      await fx.grant(relationshipId, "TAX_REGISTRATION_MANAGE", { assignmentId }).catch(() => undefined);
      signIn(user);

      await denied(K.tr.getOrganizationRegistrations(customerA.organizationId));
      await denied(K.tr.checkRegistrationNumber({ program: "TX_EXCISE", number: view.current.version!.numberNormalized }));
      await denied(create(customerA.organizationId, "SCAC"));
      await denied(K.tr.changeRegistrationStatus({ organizationId: customerA.organizationId, registrationId: view.registration.id, status: "INACTIVE" }));
      await denied(K.tr.archiveRegistration({ organizationId: customerA.organizationId, registrationId: view.registration.id }));
      assert.equal(Object.keys(K.tr).filter((key) => /customer/i.test(key)).length, 0, "the service has no customer-facing function");
    });

    scenario("the service exposes exactly the nine operations and no delete, remove, merge, move, filing or credential operation", async () => {
      const operations = Object.keys(K.tr).filter((key) => typeof (K.tr as Record<string, unknown>)[key] === "function" && !/Error$/.test(key));
      assert.deepEqual(operations.sort(), [
        "archiveRegistration", "changeRegistrationStatus", "changeRegistrationVersion", "checkRegistrationNumber", "correctRegistrationStatus",
        "correctRegistrationVersion", "createRegistration", "getOrganizationRegistrations", "restoreRegistration",
      ]);
      assert.deepEqual(operations.filter((key) => /delete|remove|destroy|merge|move|transfer|file|submit|pay|credential|decal/i.test(key)), []);
    });
  });

  // =============================================================================================================
  describe("cross-domain links", () => {
    scenario("the ten tax rules of the Company Profile point at existing programs; Form 2290 has none; SCAC and the carrier code have no rule", async () => {
      const rules = (await pools.admin.query<{ code: string; registration_program_code: string | null }>(
        `SELECT code, registration_program_code FROM public.company_profile_rules WHERE section = 'TAX' ORDER BY sort_order`,
      )).rows;
      assert.equal(rules.length, 11);
      const linked = rules.filter((rule) => rule.registration_program_code !== null);
      assert.equal(linked.length, 10);
      assert.deepEqual(linked.map((rule) => rule.registration_program_code), ["IFTA", "CT_HUF", "NY_HUT", "KYU", "NM_WDT", "OR_WMT", "FUEL_CHARGE", "TX_EXCISE", "AR_MFT", "ON_TOBACCO"]);
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_profile_rules r JOIN public.registration_programs p ON p.code = r.registration_program_code`), 10, "every linked program exists in the catalogue");
      assert.deepEqual(rules.filter((rule) => rule.registration_program_code === null).map((rule) => rule.code), ["FORM_2290"]);
      const unlinked = (await pools.admin.query<{ code: string }>(`SELECT p.code FROM public.registration_programs p WHERE NOT EXISTS (SELECT 1 FROM public.company_profile_rules r WHERE r.registration_program_code = p.code) ORDER BY p.sort_order`)).rows.map((row) => row.code);
      assert.deepEqual(unlinked, ["SCAC", "CA_CARRIER_CODE"]);
      // the foreign key is real: a rule cannot point at a program that does not exist
      const admin = await pools.admin.connect();
      try {
        await admin.query("BEGIN");
        await assert.rejects(admin.query(`UPDATE public.company_profile_rules SET registration_program_code = 'NOPE' WHERE code = 'IFTA'`), /foreign key|permission/i);
      } finally {
        await admin.query("ROLLBACK").catch(() => undefined);
        admin.release();
      }
    });

    scenario("registrations and operating authorities coexist for one Organization without sharing a namespace or table", async () => {
      await fullStaff();
      const o = await org();
      const scac = letters(4);
      const reg = (await K.tr.createRegistration({ organizationId: o, program: "SCAC", number: scac })).view;
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1`, [o]), 0, "a registration never creates an authority");
      assert.equal(reg.registration.program, "SCAC");
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [o]), 1);
    });
  });

  // =============================================================================================================
  describe("data safety", () => {
    scenario("business tables hold exactly what the scenario wrote (runtime role works through column grants only)", async () => {
      await fullStaff();
      const o = await org();
      await create(o, "CA_CARRIER_CODE");
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [o]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_versions WHERE organization_id = $1`, [o]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.registration_status_periods WHERE registration_id IN (SELECT id FROM public.registrations WHERE organization_id = $1)`, [o]), 1);
      await assert.rejects(pools.runtime.query(`UPDATE public.registration_versions SET number_normalized = 'x'`), /permission denied/);
      await assert.rejects(pools.runtime.query(`UPDATE public.registrations SET program_code = 'SCAC'`), /permission denied/);
      await assert.rejects(pools.runtime.query(`UPDATE public.registration_status_periods SET registration_status = 'CLOSED'`), /permission denied/);
    });
  });
});

function alnum(prefix: string): string {
  return `${prefix}${randomInt(1_000_000, 9_999_999)}${randomInt(100, 999)}`;
}
