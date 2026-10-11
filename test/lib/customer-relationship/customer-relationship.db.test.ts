// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL Customer Relationship service through the REAL authorization wrappers and Clerk-to-actor resolution,
// on pooled connections that log in as the RUNTIME role, against a database with migrations 0001-0015 applied.

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
    c: await import("@/lib/customer-relationship/service"),
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
const CATALOGUES = ["engagement_types", "engagement_stage_types", "product_levels", "service_catalogue", "engagement_end_reasons"] as const;
const BUSINESS_TABLES = [
  "customer_engagement_stages", "customer_engagement_terminations", "engagement_service_scopes", "engagement_responsibility_periods", "customer_agreements", "customer_agreement_versions",
] as const;
const ALL_TABLES = [...CATALOGUES, ...BUSINESS_TABLES] as const;
type Capability = "CUSTOMER_ESTABLISH" | "CUSTOMER_RELATIONSHIP_READ" | "CUSTOMER_RELATIONSHIP_MANAGE";
const ALL_CAPABILITIES: Capability[] = ["CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE"];

describe("Customer Relationship (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
  let serviceCodes: string[] = [];
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
  const n = () => ++counter;

  /** Removes everything this scenario created. The no-delete triggers and the register's immutability are lifted only here, by the table owner. */
  async function purge() {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const table of BUSINESS_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${table}_no_delete`);
      await client.query(`ALTER TABLE public.master_register_events DISABLE TRIGGER master_register_events_immutable`);
      const customers = (await client.query<{ id: string }>(`SELECT id FROM public.customers WHERE organization_id = ANY($1::uuid[])`, [organizations])).rows.map((row) => row.id);
      await client.query(`DELETE FROM public.engagement_responsibility_periods WHERE engagement_id IN (SELECT id FROM public.customer_engagements WHERE customer_id = ANY($1::uuid[]))`, [customers]);
      await client.query(`DELETE FROM public.engagement_service_scopes WHERE engagement_id IN (SELECT id FROM public.customer_engagements WHERE customer_id = ANY($1::uuid[]))`, [customers]);
      await client.query(`DELETE FROM public.customer_engagement_stages WHERE engagement_id IN (SELECT id FROM public.customer_engagements WHERE customer_id = ANY($1::uuid[]))`, [customers]);
      await client.query(`DELETE FROM public.customer_engagement_terminations WHERE engagement_id IN (SELECT id FROM public.customer_engagements WHERE customer_id = ANY($1::uuid[]))`, [customers]);
      await client.query(`DELETE FROM public.customer_engagements WHERE customer_id = ANY($1::uuid[])`, [customers]);
      await client.query(`DELETE FROM public.customer_agreement_versions WHERE agreement_id IN (SELECT id FROM public.customer_agreements WHERE customer_id = ANY($1::uuid[]))`, [customers]);
      await client.query(`DELETE FROM public.customer_agreements WHERE customer_id = ANY($1::uuid[])`, [customers]);
      await client.query(`DELETE FROM public.master_register_events WHERE customer_id = ANY($1::uuid[])`, [customers]);
      await client.query(`DELETE FROM public.customers WHERE id = ANY($1::uuid[])`, [customers]);
      await client.query(`DELETE FROM public.service_catalogue WHERE code = ANY($1::text[])`, [serviceCodes]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query(`ALTER TABLE public.master_register_events ENABLE TRIGGER master_register_events_immutable`);
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
      serviceCodes = [];
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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `CR ${label} ${id.slice(0, 8)} ${n()}`]);
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
    const actor = await staff(...ALL_CAPABILITIES);
    signIn(actor);
    return actor;
  }
  async function concurrentActors(count: number) {
    const actors = await Promise.all(Array.from({ length: count }, () => staff(...ALL_CAPABILITIES)));
    return <T>(index: number, work: () => Promise<T>) => K.db.withClerkUser(actors[index].clerkSubject, work);
  }

  const MONTH = (m: number) => `2020-${String(m).padStart(2, "0")}-01T00:00:00Z`;
  const MICRO = (m: number) => `2020-${String(m).padStart(2, "0")}-01T00:00:00.000000Z`;

  const establish = (organizationId: string, over: Record<string, unknown> = {}) =>
    K.c.establishCustomerRelationship({ organizationId, engagementType: "RECURRING", stage: "ONBOARDING", startedAt: MONTH(1), ...over });

  async function addService(level = "COMPLIANCE"): Promise<string> {
    const code = `TEST_SVC_${run.toUpperCase()}_${n()}`;
    await pools.admin.query(`INSERT INTO public.service_catalogue (code, product_level_code, display_name, description, sort_order) VALUES ($1, $2, 'Test service', 'Test service', $3)`, [code, level, 10_000 + n()]);
    serviceCodes.push(code);
    return code;
  }

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const denied = (promise: Promise<unknown>) => rejectsWith(promise, K.authz.TesAuthorizationDeniedError);
  const rowCount = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const activeTerminations = (id: string) => rowCount(`SELECT count(*) FROM public.customer_engagement_terminations WHERE engagement_id = $1 AND record_status = 'active'`, [id]);
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

  /** Runs `sql` in its own transaction as the table owner and returns the COMMIT outcome (deferred triggers fire at commit). */
  async function ownerTransaction(statements: Array<[string, unknown[]?]>): Promise<{ error?: Error }> {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const [sql, params] of statements) await client.query(sql, params);
      await client.query("COMMIT");
      return {};
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return { error: error as Error };
    } finally {
      client.release();
    }
  }

  // =============================================================================================================
  describe("schema (migration 0015)", () => {
    scenario("tables, catalogue seeds, column, indexes, functions and triggers exist; the ledger records 0015", async () => {
      assert.deepEqual(
        (await pools.admin.query<{ n: string }>(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY 1`, [[...ALL_TABLES]])).rows.map((row) => row.n),
        [...ALL_TABLES].sort(),
      );
      const seeds = async (table: string) => (await pools.admin.query<{ code: string }>(`SELECT code FROM public.${table} ORDER BY sort_order`)).rows.map((row) => row.code);
      assert.deepEqual(await seeds("engagement_types"), ["RECURRING", "ONE_OFF"]);
      assert.deepEqual(await seeds("engagement_stage_types"), ["ONBOARDING", "TRIAL", "ACTIVE", "MANAGED_PROBATION", "SUSPENDED", "ENDED"]);
      assert.deepEqual(await seeds("product_levels"), ["COMPLIANCE", "BUSINESS_INTELLIGENCE", "DECISION_SUPPORT"]);
      assert.deepEqual(await seeds("engagement_end_reasons"), ["COMPLETED", "CUSTOMER_TERMINATED", "TES_TERMINATED", "MUTUAL_AGREEMENT", "ENTERED_IN_ERROR"]);
      assert.equal(await rowCount(`SELECT count(*) FROM public.engagement_end_reasons WHERE code ~ 'OTHER|UNKNOWN|UNSPECIFIED'`), 0, "there is no catch-all reason");
      assert.equal(await rowCount(`SELECT count(*) FROM public.service_catalogue WHERE code NOT LIKE 'TEST_SVC_%'`), 0, "no speculative services are seeded");
      const flags = (await pools.admin.query<{ code: string; is_bounded: boolean; is_terminal: boolean }>(`SELECT code, is_bounded, is_terminal FROM public.engagement_stage_types ORDER BY sort_order`)).rows;
      assert.deepEqual(flags.filter((row) => row.is_bounded).map((row) => row.code), ["TRIAL", "MANAGED_PROBATION"]);
      assert.deepEqual(flags.filter((row) => row.is_terminal).map((row) => row.code), ["ENDED"]);

      const column = await pools.admin.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customer_engagements' AND column_name = 'engagement_type'`);
      assert.equal(column.rows.length, 1);
      for (const index of ["customer_engagement_stages_current_uq", "engagement_service_scopes_current_uq", "engagement_responsibility_periods_current_uq", "customer_agreement_versions_current_uq"]) {
        assert.equal(await rowCount(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [index]), 1, index);
      }
      // the 0003 invariants this domain relies on are still in place
      assert.equal(await rowCount(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'customer_engagements_one_open_uq'`), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM pg_constraint WHERE conname = 'customers_organization_id_key'`), 1);

      const ledger = await pools.admin.query<{ sha256: string }>(`SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0015'`);
      const sql = readFileSync(path.join(process.cwd(), "database/migrations/0015_customer_relationship_foundation.sql"));
      assert.equal(ledger.rows[0]?.sha256, createHash("sha256").update(sql).digest("hex"));
    });

    scenario("the TypeScript vocabulary agrees with the catalogues (drift)", async () => {
      const defs = await import("@/lib/customer-relationship/definitions");
      const codes = async (table: string) => (await pools.admin.query<{ code: string }>(`SELECT code FROM public.${table} WHERE code NOT LIKE 'TEST_SVC_%' ORDER BY sort_order`)).rows.map((row) => row.code);
      assert.deepEqual(await codes("engagement_types"), [...defs.ENGAGEMENT_TYPES]);
      assert.deepEqual(await codes("engagement_stage_types"), defs.ENGAGEMENT_STAGES);
      assert.deepEqual(await codes("product_levels"), [...defs.PRODUCT_LEVELS]);
      assert.deepEqual(await codes("engagement_end_reasons"), [...defs.ENGAGEMENT_END_REASONS]);
      for (const row of (await pools.admin.query<{ code: keyof typeof defs.STAGE_DEFINITIONS; is_bounded: boolean; is_terminal: boolean }>(`SELECT code, is_bounded, is_terminal FROM public.engagement_stage_types`)).rows) {
        assert.equal(row.is_bounded, defs.STAGE_DEFINITIONS[row.code].bounded, row.code);
        assert.equal(row.is_terminal, defs.STAGE_DEFINITIONS[row.code].terminal, row.code);
      }
    });

    scenario("capabilities: the eight earlier ones are unchanged and exactly two SYSTEM capabilities were added; nothing is granted", async () => {
      const rows = (await pools.admin.query<{ code: string; description: string }>(`SELECT code, description FROM public.capabilities ORDER BY sort_order`)).rows;
      assert.deepEqual(rows.map((row) => row.code), [
        "ORGANIZATION_READ", "ORGANIZATION_REGISTRY_READ", "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_ARCHIVE", "CUSTOMER_ESTABLISH",
        "PERSON_REGISTRY_READ", "CONTACT_MANAGE", "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE",
      ]);
      for (const row of rows.slice(8)) assert.match(row.description, /Intended scope: SYSTEM only\.$/);
      assert.match(rows[5].description, /Establish the TES Customer relationship for an existing canonical Organization and begin the Customer engagement/, "CUSTOMER_ESTABLISH keeps its meaning");
      assert.equal(await rowCount(`SELECT count(*) FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id WHERE c.code LIKE 'CUSTOMER_RELATIONSHIP_%' AND g.created_at < now() - interval '1 day'`), 0);
    });

    scenario("no SECURITY DEFINER, no RLS, no policy on the new tables; every new function is invoker with a fixed search_path and no PUBLIC execute", async () => {
      const names = ["prevent_customer_relationship_removal", "guard_engagement_insert", "guard_engagement_update", "guard_engagement_child_update", "guard_engagement_stage_insert", "guard_engagement_termination_insert", "guard_engagement_termination_update", "guard_engagement_scope_insert", "guard_engagement_scope_update", "guard_engagement_responsibility_insert", "guard_customer_agreement_update", "guard_customer_agreement_version_insert", "require_engagement_consistency", "require_customer_agreement_version"];
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
      for (const table of [...ALL_TABLES, "customer_engagements", "customers"]) {
        assert.equal((await pools.admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${table}`])).rows[0].relrowsecurity, false, table);
      }
      assert.equal(await rowCount(`SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])`, [[...ALL_TABLES]]), 0);
    });

    scenario("runtime privileges: SELECT, column-specific INSERT/UPDATE, no DELETE, TRUNCATE, REFERENCES or TRIGGER, nothing for PUBLIC; catalogues are read-only", async () => {
      for (const table of ALL_TABLES) {
        for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          assert.equal((await pools.admin.query(`SELECT has_table_privilege($1, $2::regclass, $3) AS ok`, [RUNTIME_ROLE, `public.${table}`, privilege])).rows[0].ok, false, `${table} ${privilege}`);
        }
        assert.equal((await pools.admin.query(`SELECT has_table_privilege($1, $2::regclass, 'SELECT') AS ok`, [RUNTIME_ROLE, `public.${table}`])).rows[0].ok, true, table);
        assert.equal(await rowCount(`SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'PUBLIC'`, [table]), 0, `PUBLIC on ${table}`);
        await assert.rejects(pools.runtime.query(`DELETE FROM public.${table}`), /permission denied/, table);
        await assert.rejects(pools.runtime.query(`TRUNCATE public.${table}`), /permission denied/, table);
      }
      for (const table of CATALOGUES) {
        for (const privilege of ["INSERT", "UPDATE"]) {
          assert.equal((await pools.admin.query(`SELECT has_table_privilege($1, $2::regclass, $3) AS ok`, [RUNTIME_ROLE, `public.${table}`, privilege])).rows[0].ok, false, `${table} ${privilege}`);
        }
      }
      // the closed tables keep their 0003 privileges (plus engagement_type on INSERT); customers is not rewritable
      assert.equal((await pools.admin.query(`SELECT has_column_privilege($1, 'public.customer_engagements', 'engagement_type', 'INSERT') AS ok`, [RUNTIME_ROLE])).rows[0].ok, true);
      assert.equal((await pools.admin.query(`SELECT has_column_privilege($1, 'public.customer_engagements', 'engagement_type', 'UPDATE') AS ok`, [RUNTIME_ROLE])).rows[0].ok, false);
      assert.equal((await pools.admin.query(`SELECT has_column_privilege($1, 'public.customer_engagements', 'started_at', 'UPDATE') AS ok`, [RUNTIME_ROLE])).rows[0].ok, false);
      // the retired free-text reason is unwritable; the controlled code is writable
      for (const privilege of ["INSERT", "UPDATE"]) {
        assert.equal((await pools.admin.query(`SELECT has_column_privilege($1, 'public.customer_engagements', 'end_reason', $2) AS ok`, [RUNTIME_ROLE, privilege])).rows[0].ok, false, `end_reason ${privilege}`);
        assert.equal((await pools.admin.query(`SELECT has_column_privilege($1, 'public.customer_engagements', 'end_reason_code', $2) AS ok`, [RUNTIME_ROLE, privilege])).rows[0].ok, true, `end_reason_code ${privilege}`);
      }
      for (const column of ["ended_at", "end_reason_code", "updated_at"]) {
        assert.equal((await pools.admin.query(`SELECT has_column_privilege($1, 'public.customer_engagements', $2, 'UPDATE') AS ok`, [RUNTIME_ROLE, column])).rows[0].ok, true, column);
      }
      for (const column of ["id", "ended_at", "end_reason_code", "change_reason", "engagement_id"]) {
        assert.equal((await pools.admin.query(`SELECT has_column_privilege($1, 'public.customer_engagement_terminations', $2, 'UPDATE') AS ok`, [RUNTIME_ROLE, column])).rows[0].ok, false, `terminations.${column} is immutable`);
      }
      assert.equal((await pools.admin.query(`SELECT has_table_privilege($1, 'public.customers', 'UPDATE') AS ok`, [RUNTIME_ROLE])).rows[0].ok, false);
      // content columns are not updatable
      for (const [table, column] of [["customer_engagement_stages", "stage_code"], ["engagement_service_scopes", "product_level_code"], ["engagement_responsibility_periods", "scope_id"], ["customer_agreement_versions", "agreement_reference"], ["customer_agreements", "customer_id"]]) {
        assert.equal((await pools.admin.query(`SELECT has_column_privilege($1, $2::regclass, $3, 'UPDATE') AS ok`, [RUNTIME_ROLE, `public.${table}`, column])).rows[0].ok, false, `${table}.${column}`);
      }
    });

    scenario("database backstops hold even for the table owner", async () => {
      const orgId = await org("Backstop");
      const customerId = (await pools.admin.query<{ id: string }>(`INSERT INTO public.customers (organization_id) VALUES ($1) RETURNING id`, [orgId])).rows[0].id;
      const engagementId = randomUUID();
      const otherOrg = await org("Backstop2");
      const otherCustomer = (await pools.admin.query<{ id: string }>(`INSERT INTO public.customers (organization_id) VALUES ($1) RETURNING id`, [otherOrg])).rows[0].id;

      const eng = (id: string, customer: string, from: string, type: string | null = "RECURRING") =>
        [`INSERT INTO public.customer_engagements (id, customer_id, engagement_type, started_at) VALUES ($1, $2, $3, $4)`, [id, customer, type, from]] as [string, unknown[]];
      const stage = (id: string, eId: string, code: string, from: string, to: string | null = null, planned: string | null = null, reason = "INITIAL") =>
        [`INSERT INTO public.customer_engagement_stages (id, engagement_id, stage_code, planned_end_at, change_reason, effective_from, effective_to) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, eId, code, planned, reason, from, to]] as [string, unknown[]];
      const expectFailure = async (statements: Array<[string, unknown[]?]>, pattern: RegExp, label: string) => {
        const outcome = await ownerTransaction(statements);
        assert.ok(outcome.error, `${label}: expected a failure`);
        assert.match(outcome.error!.message, pattern, label);
      };

      // an Engagement needs a stage, a type, an active Organization and cannot overlap
      await expectFailure([eng(engagementId, customerId, MONTH(1))], /exactly one current stage/, "engagement without a stage");
      await expectFailure([eng(engagementId, customerId, MONTH(1), null)], /needs an engagement type/, "engagement without a type");
      await expectFailure([eng(engagementId, customerId, MONTH(1)), stage(randomUUID(), engagementId, "ACTIVE", MONTH(2))], /begin when the Engagement began/, "first stage must start at the Engagement start");
      await expectFailure([eng(engagementId, customerId, MONTH(1)), stage(randomUUID(), engagementId, "TRIAL", MONTH(1))], /bounded stage needs planned_end_at/, "bounded stage without planned_end_at");
      await expectFailure([eng(engagementId, customerId, MONTH(1)), stage(randomUUID(), engagementId, "ACTIVE", MONTH(1), null, MONTH(5))], /bounded stage needs planned_end_at|other stages must not/, "planned_end_at on an unbounded stage");
      await expectFailure([eng(engagementId, customerId, MONTH(1)), stage(randomUUID(), engagementId, "ENDED", MONTH(1))], /open Engagement cannot be in the ended stage/, "open Engagement in the ended stage");
      await expectFailure([eng(engagementId, customerId, MONTH(1)), stage(randomUUID(), engagementId, "ONBOARDING", MONTH(1), MONTH(2)), stage(randomUUID(), engagementId, "ACTIVE", MONTH(3))], /continuous/, "gap in stage history");
      await expectFailure([eng(engagementId, customerId, MONTH(1)), stage(randomUUID(), engagementId, "ONBOARDING", MONTH(1), MONTH(3)), stage(randomUUID(), engagementId, "ACTIVE", MONTH(2))], /cannot overlap/, "overlapping stage periods");
      await expectFailure([eng(engagementId, customerId, MONTH(3)), stage(randomUUID(), engagementId, "ACTIVE", MONTH(2))], /before its Engagement/, "stage before the Engagement");
      await expectFailure([eng(engagementId, customerId, MONTH(1)), stage(randomUUID(), engagementId, "ENDED", MONTH(2), MONTH(3))], /terminal and cannot itself end/, "ended stage that ends");
      await expectFailure([eng(engagementId, customerId, MONTH(1)), stage(randomUUID(), engagementId, "BOGUS", MONTH(1))], /foreign key|stage is unknown/, "unknown stage");

      // termination: ended_at and the ENDED stage always agree
      await expectFailure(
        [eng(engagementId, customerId, MONTH(1)), stage(randomUUID(), engagementId, "ACTIVE", MONTH(1)), [`UPDATE public.customer_engagements SET ended_at = $2, end_reason_code = 'COMPLETED' WHERE id = $1`, [engagementId, MONTH(3)]]],
        /ended Engagement must be in the ended stage/,
        "ended_at without the ENDED stage",
      );
      await expectFailure(
        [
          eng(engagementId, customerId, MONTH(1)),
          stage(randomUUID(), engagementId, "ACTIVE", MONTH(1), MONTH(3)),
          stage(randomUUID(), engagementId, "ENDED", MONTH(3)),
        ],
        /open Engagement cannot be in the ended stage/,
        "ENDED stage without ended_at",
      );
      await expectFailure(
        [
          eng(engagementId, customerId, MONTH(1)),
          stage(randomUUID(), engagementId, "ACTIVE", MONTH(1), MONTH(3)),
          stage(randomUUID(), engagementId, "ENDED", MONTH(3)),
          [`UPDATE public.customer_engagements SET ended_at = $2, end_reason_code = 'COMPLETED' WHERE id = $1`, [engagementId, MONTH(4)]],
        ],
        /ended Engagement must be in the ended stage, starting exactly when it ended/,
        "ended_at differing from the ENDED stage start",
      );
      await expectFailure([eng(engagementId, customerId, MONTH(1)), [`UPDATE public.customer_engagements SET ended_at = $2, end_reason_code = 'COMPLETED' WHERE id = $1`, [engagementId, MONTH(1)]]], /ended_after_start|exactly one current stage/, "zero-length Engagement");

      // a valid Engagement commits; then the immutability and finality rules apply
      const ended = await ownerTransaction([
        eng(engagementId, customerId, MONTH(1)),
        stage(randomUUID(), engagementId, "ACTIVE", MONTH(1), MONTH(3)),
        stage(randomUUID(), engagementId, "ENDED", MONTH(3)),
        [`UPDATE public.customer_engagements SET ended_at = $2, end_reason_code = 'COMPLETED' WHERE id = $1`, [engagementId, MONTH(3)]],
        [`INSERT INTO public.customer_engagement_terminations (id, engagement_id, ended_at, end_reason_code, change_reason) VALUES ($3, $1, $2, 'COMPLETED', 'INITIAL')`, [engagementId, MONTH(3), randomUUID()]],
      ]);
      assert.equal(ended.error, undefined, ended.error?.message);
      // REOPENING is impossible in every form
      await expectFailure([[`UPDATE public.customer_engagements SET ended_at = NULL, end_reason_code = NULL WHERE id = $1`, [engagementId]]], /cannot be reopened/, "reopening");
      await expectFailure([[`UPDATE public.customer_engagements SET ended_at = NULL WHERE id = $1`, [engagementId]]], /cannot be reopened/, "reopening (date only)");
      await expectFailure([[`UPDATE public.customer_engagements SET end_reason_code = NULL WHERE id = $1`, [engagementId]]], /cannot be reopened/, "reopening (reason only)");
      // a change of the canonical columns without the audit trail cannot commit (the deferred check mirrors them)
      await expectFailure([[`UPDATE public.customer_engagements SET ended_at = $2 WHERE id = $1`, [engagementId, MONTH(4)]]], /ended stage, starting exactly when it ended|termination record must mirror/, "re-dating without the stage and audit trail");
      await expectFailure([[`UPDATE public.customer_engagements SET end_reason_code = 'TES_TERMINATED' WHERE id = $1`, [engagementId]]], /termination record must mirror/, "re-reasoning without the audit trail");
      // the stages ARE moved correctly, but the audit trail is not: the date mirror alone catches it
      {
        const activeId = (await pools.admin.query<{ id: string }>(`SELECT id FROM public.customer_engagement_stages WHERE engagement_id = $1 AND stage_code = 'ACTIVE' AND record_status = 'active'`, [engagementId])).rows[0].id;
        const endedId = (await pools.admin.query<{ id: string }>(`SELECT id FROM public.customer_engagement_stages WHERE engagement_id = $1 AND stage_code = 'ENDED' AND record_status = 'active'`, [engagementId])).rows[0].id;
        const [activeNew, endedNew] = [randomUUID(), randomUUID()];
        await expectFailure(
          [
            [`UPDATE public.customer_engagements SET ended_at = $2 WHERE id = $1`, [engagementId, MONTH(4)]],
            [`UPDATE public.customer_engagement_stages SET record_status = 'corrected', corrected_at = now(), superseded_by_id = $2 WHERE id = $1`, [activeId, activeNew]],
            [`UPDATE public.customer_engagement_stages SET record_status = 'corrected', corrected_at = now(), superseded_by_id = $2 WHERE id = $1`, [endedId, endedNew]],
            stage(activeNew, engagementId, "ACTIVE", MONTH(1), MONTH(4), null, "CORRECTION"),
            stage(endedNew, engagementId, "ENDED", MONTH(4), null, null, "CORRECTION"),
          ],
          /termination record must mirror/,
          "moving the end and its stages without an audit row",
        );
      }
      await expectFailure([[`UPDATE public.customer_engagements SET end_reason_code = 'NOPE' WHERE id = $1`, [engagementId]]], /foreign key|end_reason_code_fk/, "unknown reason code");
      // the retired free-text column and the structural reason are consistent with the end
      await expectFailure([[`UPDATE public.customer_engagements SET end_reason = 'because' WHERE id = $1`, [engagementId]]], /end_reason_retired/, "free-text end reason");
      await expectFailure([eng(randomUUID(), customerId, MONTH(5)), [`UPDATE public.customer_engagements SET end_reason_code = 'COMPLETED' WHERE customer_id = $1 AND ended_at IS NULL`, [customerId]]], /end_reason_code_with_end/, "reason on an open Engagement");
      await expectFailure([[`INSERT INTO public.customer_engagements (customer_id, engagement_type, started_at, ended_at) VALUES ($1, 'RECURRING', $2, $3)`, [otherCustomer, MONTH(1), MONTH(2)]]], /end_reason_code_with_end/, "end without a reason");
      // the audit rows are immutable, undeletable and unique per Engagement
      await expectFailure([[`UPDATE public.customer_engagement_terminations SET ended_at = $2 WHERE engagement_id = $1`, [engagementId, MONTH(2)]]], /immutable/, "rewriting a termination record");
      await expectFailure([[`UPDATE public.customer_engagement_terminations SET end_reason_code = 'TES_TERMINATED' WHERE engagement_id = $1`, [engagementId]]], /immutable/, "rewriting a termination reason");
      await expectFailure([[`INSERT INTO public.customer_engagement_terminations (engagement_id, ended_at, end_reason_code, change_reason) VALUES ($1, $2, 'COMPLETED', 'CORRECTION')`, [engagementId, MONTH(3)]]], /current_uq|duplicate key/, "two active termination records");
      await expectFailure([[`UPDATE public.customer_engagements SET started_at = $2 WHERE id = $1`, [engagementId, MONTH(2)]]], /immutable/, "moving the start");
      await expectFailure([[`UPDATE public.customer_engagements SET engagement_type = 'ONE_OFF' WHERE id = $1`, [engagementId]]], /immutable/, "changing the type");
      await expectFailure([[`UPDATE public.customer_engagements SET customer_id = $2 WHERE id = $1`, [engagementId, otherCustomer]]], /immutable/, "moving to another Customer");
      await expectFailure([[`UPDATE public.customer_engagement_stages SET stage_code = 'TRIAL' WHERE engagement_id = $1`, [engagementId]]], /immutable/, "stage content");
      await expectFailure([[`UPDATE public.customer_engagement_stages SET effective_to = $2 WHERE engagement_id = $1 AND stage_code = 'ENDED'`, [engagementId, MONTH(9)]]], /terminal|re-dated|inconsistent|exactly one current stage|ended stage cannot itself end/, "ending the ended stage");
      // a new Engagement cannot overlap the closed one, nor two open ones coexist
      await expectFailure([eng(randomUUID(), customerId, MONTH(2))], /cannot overlap/, "overlap with a closed Engagement");
      await expectFailure([[`INSERT INTO public.customer_engagements (customer_id, engagement_type, started_at) VALUES ($1, 'RECURRING', $2)`, [otherCustomer, MONTH(1)]], [`INSERT INTO public.customer_engagements (customer_id, engagement_type, started_at) VALUES ($1, 'RECURRING', $2)`, [otherCustomer, MONTH(6)]]], /cannot overlap|one_open/, "two open Engagements");
      // an archived Organization cannot start an Engagement
      const archivedOrg = await org("Archived");
      const archivedCustomer = (await pools.admin.query<{ id: string }>(`INSERT INTO public.customers (organization_id) VALUES ($1) RETURNING id`, [archivedOrg])).rows[0].id;
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archivedOrg]);
      await expectFailure([eng(randomUUID(), archivedCustomer, MONTH(1))], /needs an active Organization/, "archived Organization");
      // one Customer per Organization
      await expectFailure([[`INSERT INTO public.customers (organization_id) VALUES ($1)`, [orgId]]], /customers_organization_id_key|duplicate key/, "second Customer for an Organization");

      // scopes / responsibility / agreements
      const scopeId = randomUUID();
      const scope = (id: string, level: string, service: string | null, from: string, to: string | null = null, agreement: string | null = null) =>
        [`INSERT INTO public.engagement_service_scopes (id, engagement_id, product_level_code, service_code, agreement_id, change_reason, effective_from, effective_to) VALUES ($1, $2, $3, $4, $5, 'INITIAL', $6, $7)`, [id, engagementId, level, service, agreement, from, to]] as [string, unknown[]];
      await expectFailure([scope(scopeId, "COMPLIANCE", null, MONTH(5))], /inside its Engagement/, "scope after the ended Engagement");
      await expectFailure([scope(scopeId, "COMPLIANCE", null, MONTH(1), MONTH(4))], /inside its Engagement/, "scope past the ended Engagement");
      await expectFailure([scope(scopeId, "COMPLIANCE", null, MONTH(1), MONTH(3)), scope(randomUUID(), "COMPLIANCE", null, MONTH(2), MONTH(3))], /cannot overlap/, "overlapping whole-level scopes");
      const service = await addService("COMPLIANCE");
      await expectFailure([scope(scopeId, "COMPLIANCE", null, MONTH(1), MONTH(3)), scope(randomUUID(), "COMPLIANCE", service, MONTH(2), MONTH(3))], /cannot overlap/, "specific service inside a whole-level scope");
      await expectFailure([scope(scopeId, "COMPLIANCE", service, MONTH(1), MONTH(3)), scope(randomUUID(), "BUSINESS_INTELLIGENCE", service, MONTH(1), MONTH(3))], /foreign key/, "service of another product level");
      const fine = await ownerTransaction([scope(scopeId, "COMPLIANCE", service, MONTH(1), MONTH(3)), scope(randomUUID(), "COMPLIANCE", null, MONTH(3 - 1) /* overlaps service */ , MONTH(3))]);
      assert.match(fine.error?.message ?? "", /cannot overlap/);
      const other = await ownerTransaction([scope(scopeId, "COMPLIANCE", service, MONTH(1), MONTH(3)), scope(randomUUID(), "BUSINESS_INTELLIGENCE", null, MONTH(1), MONTH(3))]);
      assert.equal(other.error, undefined, other.error?.message);
      const responsibility = (scopeRef: string, from: string, to: string | null = null) =>
        [`INSERT INTO public.engagement_responsibility_periods (engagement_id, scope_id, change_reason, effective_from, effective_to) VALUES ($1, $2, 'INITIAL', $3, $4)`, [engagementId, scopeRef, from, to]] as [string, unknown[]];
      await expectFailure([responsibility(scopeId, MONTH(1) /* equals scope start: ok */, MONTH(4))], /inside its scope and its Engagement/, "responsibility past the scope");
      await expectFailure([responsibility(randomUUID(), MONTH(1), MONTH(2))], /foreign key|active scope/, "responsibility on a missing scope");
      await expectFailure([responsibility(scopeId, MONTH(1), MONTH(2)), responsibility(scopeId, MONTH(2) /* fine */, MONTH(3)), responsibility(scopeId, "2020-02-15T00:00:00Z", MONTH(3))], /cannot overlap/, "overlapping responsibility windows");
      // a valid responsibility window, and an agreement with its version, commit; then nothing can delete them
      const okResponsibility = await ownerTransaction([responsibility(scopeId, MONTH(1), MONTH(2))]);
      assert.equal(okResponsibility.error, undefined, okResponsibility.error?.message);
      await expectFailure([[`UPDATE public.engagement_service_scopes SET effective_to = $2 WHERE id = $1`, [scopeId, MONTH(1) /* below the window end: refused by the window check */]]], /effective_window_valid|outlives|re-dated/, "ending a scope before its responsibility ends");
      const agreementId = randomUUID();
      const okAgreement = await ownerTransaction([
        [`INSERT INTO public.customer_agreements (id, customer_id) VALUES ($1, $2)`, [agreementId, customerId]],
        [`INSERT INTO public.customer_agreement_versions (agreement_id, change_reason, effective_from) VALUES ($1, 'INITIAL', $2)`, [agreementId, MONTH(1)]],
      ]);
      assert.equal(okAgreement.error, undefined, okAgreement.error?.message);
      await expectFailure([[`UPDATE public.customer_agreements SET record_status = 'archived', archived_at = now() WHERE id = $1`, [agreementId]]], /current version cannot be archived/, "archiving an agreement with a current version");
      await expectFailure([[`UPDATE public.customer_agreements SET customer_id = $2 WHERE id = $1`, [agreementId, otherCustomer]]], /immutable/, "moving an agreement to another Customer");
      await expectFailure([[`UPDATE public.customer_agreement_versions SET agreement_reference = 'X' WHERE agreement_id = $1`, [agreementId]]], /immutable/, "rewriting a version");
      await expectFailure([[`INSERT INTO public.customer_agreement_versions (agreement_id, change_reason, effective_from) VALUES ($1, 'AMENDMENT', $2)`, [agreementId, MONTH(2)]]], /cannot overlap/, "overlapping agreement versions");

      // agreements always have a version and cannot be deleted
      await expectFailure([[`INSERT INTO public.customer_agreements (customer_id) VALUES ($1)`, [customerId]]], /at least one version/, "agreement without a version");
      for (const table of BUSINESS_TABLES) {
        // a row-level DELETE trigger only fires when a row exists; the tables left empty by the rejected attempts above are covered by TRUNCATE
        if (await rowCount(`SELECT count(*) FROM public.${table}`) > 0) await assert.rejects(pools.admin.query(`DELETE FROM public.${table}`), /preserved|not permitted/, table);
        await assert.rejects(pools.admin.query(`TRUNCATE public.${table}`), /preserved|not permitted|pending trigger events|cannot truncate/, table);
      }
    });
  });

  // =============================================================================================================
  describe("establishment (CUSTOMER_ESTABLISH)", () => {
    scenario("establishes the Customer, the Engagement and its initial stage atomically, with Master Register events", async () => {
      const actor = await fullStaff();
      const o = await org();
      const result = await establish(o, { engagementType: "ONE_OFF", stage: "TRIAL", plannedEndAt: MONTH(2) });
      assert.equal(result.createdCustomer, true);
      assert.equal(result.customer.organizationId, o);
      assert.equal(result.engagement.engagement.engagementType, "ONE_OFF");
      assert.equal(result.engagement.engagement.endedAt, null);
      assert.equal(result.engagement.engagement.startedAt, MICRO(1));
      assert.equal(result.engagement.current.stage?.stage, "TRIAL");
      assert.equal(result.engagement.current.stage?.plannedEndAt, MICRO(2));
      assert.equal(result.engagement.current.stage?.effectiveFrom, MICRO(1));
      assert.equal(await rowCount(`SELECT count(*) FROM public.customers WHERE organization_id = $1`, [o]), 1);
      // exactly: customer, engagement, stage - and the events carry the customer context
      assert.deepEqual(await eventTypes(actor.actorId), ["RECORD_CREATED", "RECORD_CREATED", "RECORD_CREATED"]);
      assert.equal(await rowCount(`SELECT count(*) FROM public.master_register_events WHERE actor_id = $1::uuid AND customer_id = $2`, [actor.actorId, result.customer.id]), 3);
      // no agreement, price, scope or responsibility is required to establish
      assert.equal(await rowCount(`SELECT count(*) FROM public.customer_agreements WHERE customer_id = $1`, [result.customer.id]), 0);
      assert.equal((await K.c.getCustomerRelationship(o)).openEngagement?.engagement.id, result.engagement.engagement.id);
    });

    scenario("rejects an Organization that is missing, archived or merged, an unsuitable stage and an unknown type", async () => {
      await fullStaff();
      const o = await org();
      await rejectsWith(establish(randomUUID()), K.c.CustomerRelationshipNotFoundError);
      const archived = await org("Archived");
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archived]);
      await rejectsWith(establish(archived), K.c.CustomerRelationshipStateError);
      const survivor = await org("Survivor");
      const merged = await org("Merged");
      await pools.admin.query(`UPDATE public.organizations SET status = 'merged', merged_into_organization_id = $2 WHERE id = $1`, [merged, survivor]);
      await rejectsWith(establish(merged), K.c.CustomerRelationshipStateError);

      for (const bad of [
        { engagementType: "TRIAL" }, // a stage is not an engagement type
        { engagementType: "MANAGED_PROBATION" },
        { engagementType: "Recurring" },
        { stage: "ENDED" }, // reached only by ending
        { stage: "TRIAL" }, // bounded stage without plannedEndAt
        { stage: "ACTIVE", plannedEndAt: MONTH(3) }, // unbounded stage with plannedEndAt
        { stage: "TRIAL", plannedEndAt: MONTH(1) }, // planned end not after start
        { stage: "NOPE" },
        { startedAt: "2020-01-01" },
        { startedAt: "2999-01-01T00:00:00Z" },
        { unexpected: true },
      ] as Array<Record<string, unknown>>) {
        await assert.rejects(establish(o, bad), (error: unknown) => error instanceof K.c.CustomerRelationshipError, JSON.stringify(bad));
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.customers WHERE organization_id = $1`, [o]), 0, "nothing was created by any rejected attempt");
    });

    scenario("one open Engagement per Customer; a returning Customer is re-engaged under the SAME Customer", async () => {
      await fullStaff();
      const o = await org();
      const first = await establish(o);
      await rejectsWith(establish(o), K.c.CustomerRelationshipConflictError);
      await K.c.endEngagement({ engagementId: first.engagement.engagement.id, endedAt: MONTH(6), endReason: "COMPLETED" });
      // cannot start before the previous Engagement ended
      await rejectsWith(establish(o, { startedAt: MONTH(5) }), K.c.CustomerRelationshipValidationError);
      const second = await establish(o, { startedAt: MONTH(8), engagementType: "ONE_OFF", stage: "ACTIVE" });
      assert.equal(second.createdCustomer, false);
      assert.equal(second.customer.id, first.customer.id, "the same canonical Customer");
      assert.notEqual(second.engagement.engagement.id, first.engagement.engagement.id);
      assert.equal(await rowCount(`SELECT count(*) FROM public.customers WHERE organization_id = $1`, [o]), 1);
      const view = await K.c.getCustomerRelationship(o);
      assert.equal(view.engagements.length, 2);
      assert.equal(view.openEngagement?.engagement.id, second.engagement.engagement.id);
      // the old Engagement was never rewritten
      const old = view.engagements.find((row) => row.engagement.id === first.engagement.engagement.id)!;
      assert.equal(old.engagement.endedAt, MICRO(6));
      assert.equal(old.engagement.engagementType, "RECURRING");
      assert.equal(old.current.stage?.stage, "ENDED");
    });
  });

  // =============================================================================================================
  describe("stage history", () => {
    scenario("a real-world stage change keeps the previous stage as history; no transition matrix is imposed", async () => {
      const actor = await fullStaff();
      const o = await org();
      const { engagement } = await establish(o);
      const id = engagement.engagement.id;
      // any order is structurally fine: ONBOARDING -> MANAGED_PROBATION -> SUSPENDED -> TRIAL -> ACTIVE
      await K.c.changeStage({ engagementId: id, stage: "MANAGED_PROBATION", plannedEndAt: MONTH(4), effectiveFrom: MONTH(2) });
      await K.c.changeStage({ engagementId: id, stage: "SUSPENDED", effectiveFrom: MONTH(3) });
      await K.c.changeStage({ engagementId: id, stage: "TRIAL", plannedEndAt: MONTH(6), effectiveFrom: MONTH(4) });
      const view = await K.c.changeStage({ engagementId: id, stage: "ACTIVE", effectiveFrom: MONTH(5) });
      assert.deepEqual(view.stages.map((row) => row.stage), ["ONBOARDING", "MANAGED_PROBATION", "SUSPENDED", "TRIAL", "ACTIVE"]);
      assert.deepEqual(view.stages.map((row) => row.effectiveFrom), [1, 2, 3, 4, 5].map(MICRO));
      assert.deepEqual(view.stages.slice(0, 4).map((row) => row.effectiveTo), [2, 3, 4, 5].map(MICRO));
      assert.equal(view.current.stage?.stage, "ACTIVE");
      assert.equal(view.stages.every((row) => row.recordStatus === "active"), true);
      // the same stage again is not a change; an extension of a bounded stage (a new planned end) is
      await rejectsWith(K.c.changeStage({ engagementId: id, stage: "ACTIVE", effectiveFrom: MONTH(6) }), K.c.CustomerRelationshipValidationError);
      await K.c.changeStage({ engagementId: id, stage: "MANAGED_PROBATION", plannedEndAt: "2999-01-01T00:00:00Z", effectiveFrom: MONTH(6) });
      const extended = await K.c.changeStage({ engagementId: id, stage: "MANAGED_PROBATION", plannedEndAt: "3000-01-01T00:00:00Z", effectiveFrom: MONTH(7) });
      assert.equal(extended.stages.filter((row) => row.stage === "MANAGED_PROBATION").length, 3);
      // the database does not cap a bounded stage's length: that is policy, not schema
      assert.equal(extended.current.stage?.plannedEndAt, "3000-01-01T00:00:00.000000Z");
      // bad input
      await rejectsWith(K.c.changeStage({ engagementId: id, stage: "ENDED" }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.changeStage({ engagementId: id, stage: "TRIAL" }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.changeStage({ engagementId: id, stage: "ACTIVE", effectiveFrom: MONTH(1) }), K.c.CustomerRelationshipValidationError);
      assert.ok((await eventTypes(actor.actorId)).filter((type) => type === "RECORD_UPDATED").length >= 6);
    });

    scenario("a correction preserves the wrong row, inherits its business time and is never shown as genuine history", async () => {
      await fullStaff();
      const o = await org();
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      const wrong = (await K.c.changeStage({ engagementId: id, stage: "TRIAL", plannedEndAt: MONTH(6), effectiveFrom: MONTH(2) })).current.stage!;
      await K.c.changeStage({ engagementId: id, stage: "ACTIVE", effectiveFrom: MONTH(3) });
      // the TRIAL (already ended) was really MANAGED_PROBATION
      const view = await K.c.correctStage({ stageId: wrong.id, stage: "MANAGED_PROBATION", plannedEndAt: MONTH(5) });
      const old = view.stages.find((row) => row.id === wrong.id)!;
      assert.equal(old.recordStatus, "corrected");
      assert.equal(old.effectiveTo, MICRO(3), "the wrong row is kept as recorded, never re-dated");
      const replacement = view.stages.find((row) => row.id === old.supersededById)!;
      assert.deepEqual([replacement.stage, replacement.effectiveFrom, replacement.effectiveTo, replacement.changeReason], ["MANAGED_PROBATION", MICRO(2), MICRO(3), "CORRECTION"]);
      assert.equal(view.current.stage?.stage, "ACTIVE");
      assert.equal(view.asOf, null);
      const asOf = await K.c.getEngagement(id, { asOf: "2020-02-15T00:00:00Z" });
      assert.equal(asOf.asOf?.stage?.stage, "MANAGED_PROBATION", "as-of reads use the corrected truth");
      // a corrected row is frozen; the terminal stage cannot be corrected
      await rejectsWith(K.c.correctStage({ stageId: wrong.id, stage: "ACTIVE" }), K.c.CustomerRelationshipStateError);
      await rejectsWith(K.c.correctStage({ stageId: replacement.id, stage: "MANAGED_PROBATION", plannedEndAt: MONTH(5) }), K.c.CustomerRelationshipValidationError);
      // correcting the first stage keeps it starting at the Engagement start
      const first = view.stages.find((row) => row.effectiveFrom === MICRO(1))!;
      const fixed = await K.c.correctStage({ stageId: first.id, stage: "ONBOARDING" });
      assert.equal(fixed.stages.find((row) => row.supersededById === null && row.effectiveFrom === MICRO(1))?.stage, "ONBOARDING");
    });
  });

  // =============================================================================================================
  describe("termination (one canonical truth)", () => {
    scenario("ending an Engagement ends everything under it, starts the ENDED stage and records ended_at; it is final", async () => {
      const actor = await fullStaff();
      const o = await org();
      const { engagement, customer } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      const withScope = await K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(2) });
      await K.c.assumeResponsibility({ scopeId: withScope.current.scopes[0].id, effectiveFrom: MONTH(3) });
      const view = await K.c.endEngagement({ engagementId: id, endedAt: MONTH(8), endReason: "CUSTOMER_TERMINATED" });
      assert.equal(view.engagement.endedAt, MICRO(8));
      assert.equal(view.engagement.endReason, "CUSTOMER_TERMINATED");
      assert.equal(view.current.stage?.stage, "ENDED");
      assert.equal(view.current.stage?.effectiveFrom, MICRO(8));
      assert.deepEqual(view.current.scopes, []);
      assert.deepEqual(view.current.responsibilities, []);
      assert.equal(view.scopes[0].effectiveTo, MICRO(8));
      assert.equal(view.responsibilities[0].effectiveTo, MICRO(8));
      assert.equal(view.stages.find((row) => row.stage === "ACTIVE")?.effectiveTo, MICRO(8));
      // single truth: the Engagement row and the stage agree
      const row = (await pools.admin.query(`SELECT e.ended_at, s.stage_code, s.effective_from FROM public.customer_engagements e JOIN public.customer_engagement_stages s ON s.engagement_id = e.id AND s.effective_to IS NULL AND s.record_status = 'active' WHERE e.id = $1`, [id])).rows[0];
      assert.equal(row.stage_code, "ENDED");
      assert.equal(row.ended_at.toISOString(), row.effective_from.toISOString());
      // final: no further change of any kind to the ended Engagement
      await rejectsWith(K.c.endEngagement({ engagementId: id, endedAt: MONTH(9), endReason: "COMPLETED" }), K.c.CustomerRelationshipStateError);
      await rejectsWith(K.c.changeStage({ engagementId: id, stage: "ACTIVE" }), K.c.CustomerRelationshipStateError);
      await rejectsWith(K.c.addScope({ engagementId: id, productLevel: "DECISION_SUPPORT" }), K.c.CustomerRelationshipStateError);
      await rejectsWith(K.c.assumeResponsibility({ scopeId: view.scopes[0].id }), K.c.CustomerRelationshipStateError);
      // the Customer identity persists
      assert.equal(await rowCount(`SELECT count(*) FROM public.customers WHERE id = $1`, [customer.id]), 1);
      // events: references and vocabulary only - never the end reason
      assert.ok((await eventTypes(actor.actorId)).includes("RECORD_LINK_REMOVED"));
      assert.equal((await eventsJson(actor.actorId)).includes("customer left"), false);
    });

    scenario("an end that predates the Engagement, its current stage or a later-dated scope is refused and changes nothing", async () => {
      await fullStaff();
      const o = await org();
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      await K.c.changeStage({ engagementId: id, stage: "SUSPENDED", effectiveFrom: MONTH(4) });
      await K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(5) });
      await rejectsWith(K.c.endEngagement({ engagementId: id, endedAt: MONTH(1), endReason: "COMPLETED" }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.endEngagement({ engagementId: id, endedAt: MONTH(3), endReason: "COMPLETED" }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.endEngagement({ engagementId: id, endedAt: MONTH(5), endReason: "COMPLETED" }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.endEngagement({ engagementId: id, endedAt: "2999-01-01T00:00:00Z", endReason: "COMPLETED" }), K.c.CustomerRelationshipValidationError);
      const view = await K.c.getEngagement(id);
      assert.equal(view.engagement.endedAt, null);
      assert.equal(view.current.stage?.stage, "SUSPENDED");
      assert.equal(view.stages.length, 2);
    });
  });

  // =============================================================================================================
  describe("termination correction (never reopening)", () => {
    /** An ended Engagement: ACTIVE from month 1, a scope from 2, responsibility from 3, ended at month 8. */
    async function endedEngagement(over: { endedAt?: string; reason?: string } = {}) {
      const o = await org();
      const { engagement, customer } = await establish(o, { stage: "ONBOARDING" });
      const id = engagement.engagement.id;
      await K.c.changeStage({ engagementId: id, stage: "ACTIVE", effectiveFrom: MONTH(2) });
      const scope = (await K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(3) })).current.scopes[0];
      await K.c.assumeResponsibility({ scopeId: scope.id, effectiveFrom: MONTH(4) });
      const view = await K.c.endEngagement({ engagementId: id, endedAt: over.endedAt ?? MONTH(8), endReason: (over.reason ?? "CUSTOMER_TERMINATED") as never });
      return { o, id, customer, scope, view };
    }

    scenario("an end reason is a controlled code: free text, 'other', a missing value and a retired column are all refused", async () => {
      await fullStaff();
      const o = await org();
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      for (const bad of [undefined, "", "customer left", "OTHER", "completed", "UNKNOWN", 7, null, { code: "COMPLETED" }]) {
        await rejectsWith(K.c.endEngagement({ engagementId: id, endedAt: MONTH(5), endReason: bad as never }), K.c.CustomerRelationshipValidationError);
      }
      await assert.rejects(K.c.endEngagement({ engagementId: id, endedAt: MONTH(5) } as never), (error: unknown) => error instanceof K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.endEngagement({ engagementId: id, endedAt: MONTH(5), endReason: "COMPLETED", note: "narrative" } as never), K.c.CustomerRelationshipValidationError);
      assert.equal((await K.c.getEngagement(id)).engagement.endedAt, null, "nothing was recorded by any refused attempt");
      assert.equal(await rowCount(`SELECT count(*) FROM public.customer_engagement_terminations WHERE engagement_id = $1`, [id]), 0);
      // the retired free-text column is unreachable even for the runtime database role
      await assert.rejects(pools.runtime.query(`UPDATE public.customer_engagements SET end_reason = 'x' WHERE id = $1`, [id]), /permission denied/);
      for (const code of K.c.ENGAGEMENT_END_REASONS) {
        const fresh = await org(code);
        const started = await establish(fresh, { stage: "ACTIVE" });
        const ended = await K.c.endEngagement({ engagementId: started.engagement.engagement.id, endedAt: MONTH(5), endReason: code });
        assert.equal(ended.engagement.endReason, code);
        assert.equal(ended.current.termination?.endReason, code);
        assert.equal(ended.current.termination?.changeReason, "INITIAL");
      }
    });

    scenario("ending records the canonical termination AND an audit row that mirrors it", async () => {
      await fullStaff();
      const { id, view } = await endedEngagement();
      assert.equal(view.terminations.length, 1);
      assert.deepEqual([view.terminations[0].endedAt, view.terminations[0].endReason, view.terminations[0].recordStatus], [MICRO(8), "CUSTOMER_TERMINATED", "active"]);
      assert.equal(view.engagement.endedAt, view.current.termination?.endedAt);
      assert.equal(await activeTerminations(id), 1);
    });

    scenario("correcting an end that was recorded too LATE: dependents follow it inward, every original is preserved", async () => {
      const actor = await fullStaff();
      const { id, scope, view: ended } = await endedEngagement();
      const stagesBefore = ended.stages;
      const respBefore = ended.responsibilities[0];
      const view = await K.c.correctEngagementTermination({ engagementId: id, endedAt: MONTH(6) });

      // canonical truth and its projections agree
      assert.equal(view.engagement.endedAt, MICRO(6));
      assert.equal(view.engagement.endReason, "CUSTOMER_TERMINATED");
      assert.equal(view.current.stage?.stage, "ENDED");
      assert.equal(view.current.stage?.effectiveFrom, MICRO(6));
      assert.equal(view.current.stage?.changeReason, "CORRECTION");
      await assertEngagementConsistent(id);

      // the original termination record is kept, flagged and linked
      assert.equal(view.terminations.length, 2);
      const original = view.terminations.find((row) => row.changeReason === "INITIAL")!;
      assert.deepEqual([original.recordStatus, original.endedAt, original.endReason], ["corrected", MICRO(8), "CUSTOMER_TERMINATED"]);
      assert.equal(original.supersededById, view.current.termination?.id);
      assert.deepEqual([view.current.termination?.endedAt, view.current.termination?.changeReason], [MICRO(6), "CORRECTION"]);

      // the stage before the end and the old ENDED stage are kept as recorded; replacements carry the new boundary
      const oldEnded = view.stages.find((row) => row.id === stagesBefore.find((candidate) => candidate.stage === "ENDED")!.id)!;
      assert.deepEqual([oldEnded.recordStatus, oldEnded.effectiveFrom], ["corrected", MICRO(8)], "the wrongly dated ENDED row is preserved");
      const oldActive = view.stages.find((row) => row.stage === "ACTIVE" && row.recordStatus === "corrected")!;
      assert.equal(oldActive.effectiveTo, MICRO(8), "the wrongly dated ACTIVE row is preserved");
      const newActive = view.stages.find((row) => row.id === oldActive.supersededById)!;
      assert.deepEqual([newActive.stage, newActive.effectiveFrom, newActive.effectiveTo], ["ACTIVE", MICRO(2), MICRO(6)]);

      // dependents that were ended with the old boundary follow it inward; originals kept
      const oldScope = view.scopes.find((row) => row.id === scope.id)!;
      assert.deepEqual([oldScope.recordStatus, oldScope.effectiveTo], ["corrected", MICRO(8)]);
      const newScope = view.scopes.find((row) => row.id === oldScope.supersededById)!;
      assert.deepEqual([newScope.recordStatus, newScope.effectiveFrom, newScope.effectiveTo, newScope.productLevel], ["active", MICRO(3), MICRO(6), "COMPLIANCE"]);
      const oldResp = view.responsibilities.find((row) => row.id === respBefore.id)!;
      assert.deepEqual([oldResp.recordStatus, oldResp.effectiveTo], ["corrected", MICRO(8)]);
      const newResp = view.responsibilities.find((row) => row.id === oldResp.supersededById)!;
      assert.deepEqual([newResp.scopeId, newResp.effectiveFrom, newResp.effectiveTo], [newScope.id, MICRO(4), MICRO(6)]);
      assert.deepEqual(view.current.scopes, [], "nothing is open on an ended Engagement");

      // still ended: no way back to open; the Customer identity is untouched
      assert.notEqual(view.engagement.endedAt, null);
      assert.equal(await activeTerminations(id), 1);
      // register: references only - no date, no reason code
      const types = await eventTypes(actor.actorId);
      assert.ok(types.filter((type) => type === "RECORD_CORRECTED").length >= 5);
      const json = await eventsJson(actor.actorId);
      for (const leak of ["CUSTOMER_TERMINATED", "2020-06-01", "2020-08-01"]) assert.equal(json.includes(leak), false, leak);
    });

    scenario("correcting an end that was recorded too EARLY: the stage moves, dependents are left alone (a correction never expands TES responsibility)", async () => {
      await fullStaff();
      const { id, scope, view: ended } = await endedEngagement({ endedAt: MONTH(6) });
      const view = await K.c.correctEngagementTermination({ engagementId: id, endedAt: MONTH(9) });
      assert.equal(view.engagement.endedAt, MICRO(9));
      await assertEngagementConsistent(id);
      const active = view.stages.find((row) => row.stage === "ACTIVE" && row.recordStatus === "active")!;
      assert.equal(active.effectiveTo, MICRO(9), "the preceding stage is extended to the corrected end");
      assert.equal(view.current.stage?.effectiveFrom, MICRO(9));
      const sameScope = view.scopes.find((row) => row.id === scope.id)!;
      assert.deepEqual([sameScope.recordStatus, sameScope.effectiveTo], ["active", MICRO(6)], "the scope still ends when it ended: responsibility is not extended");
      assert.equal(view.responsibilities.filter((row) => row.recordStatus === "active")[0].effectiveTo, MICRO(6));
      assert.equal(view.scopes.length, ended.scopes.length);
      assert.equal(view.terminations.filter((row) => row.recordStatus === "corrected").length, 1);
    });

    scenario("a reason-only correction changes the code and the audit trail, not the dates or the stages", async () => {
      await fullStaff();
      const { id, view: ended } = await endedEngagement();
      const view = await K.c.correctEngagementTermination({ engagementId: id, endReason: "MUTUAL_AGREEMENT" });
      assert.equal(view.engagement.endReason, "MUTUAL_AGREEMENT");
      assert.equal(view.engagement.endedAt, ended.engagement.endedAt);
      assert.equal(view.stages.length, ended.stages.length, "no stage was touched");
      assert.equal(view.scopes.length, ended.scopes.length);
      assert.equal(view.terminations.length, 2);
      assert.equal(view.terminations.find((row) => row.recordStatus === "corrected")?.endReason, "CUSTOMER_TERMINATED", "the original reason is preserved");
      // corrected twice: history keeps growing, exactly one record is active
      await K.c.correctEngagementTermination({ engagementId: id, endedAt: MONTH(7) });
      const again = await K.c.getEngagement(id);
      assert.equal(again.terminations.length, 3);
      assert.equal(again.terminations.filter((row) => row.recordStatus === "active").length, 1);
      await assertEngagementConsistent(id);
    });

    scenario("only an ended Engagement can be corrected, and a correction can never reopen it", async () => {
      await fullStaff();
      const o = await org();
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const open = engagement.engagement.id;
      await rejectsWith(K.c.correctEngagementTermination({ engagementId: open, endedAt: MONTH(5) }), K.c.CustomerRelationshipStateError);
      await rejectsWith(K.c.correctEngagementTermination({ engagementId: open, endReason: "COMPLETED" }), K.c.CustomerRelationshipStateError);
      await rejectsWith(K.c.correctEngagementTermination({ engagementId: randomUUID(), endReason: "COMPLETED" }), K.c.CustomerRelationshipNotFoundError);
      const { id } = await endedEngagement();
      // there is no way to express "open again"
      for (const bad of [{ endedAt: null }, { endedAt: undefined, endReason: null }, { endReason: "" }, { endedAt: "" }, {}, { reopen: true }, { endedAt: MONTH(5), endReason: "OTHER" }] as Array<Record<string, unknown>>) {
        await assert.rejects(K.c.correctEngagementTermination({ engagementId: id, ...bad }), (error: unknown) => error instanceof K.c.CustomerRelationshipValidationError, JSON.stringify(bad));
      }
      assert.deepEqual(Object.keys(K.c).filter((key) => /reopen|restart|resume|undo/i.test(key)), []);
      const after = await K.c.getEngagement(id);
      assert.notEqual(after.engagement.endedAt, null);
      assert.equal(after.current.stage?.stage, "ENDED");
      assert.equal(after.terminations.length, 1, "refused corrections left no trace");
      await rejectsWith(K.c.endEngagement({ engagementId: id, endedAt: MONTH(9), endReason: "COMPLETED" }), K.c.CustomerRelationshipStateError);
      await rejectsWith(K.c.changeStage({ engagementId: id, stage: "ACTIVE" }), K.c.CustomerRelationshipStateError);
    });

    scenario("a corrected end that would make history or dependents impossible is refused and changes nothing", async () => {
      await fullStaff();
      const { id } = await endedEngagement();
      const snapshot = async () => JSON.stringify(await K.c.getEngagement(id));
      const before = await snapshot();
      // before the Engagement began, at/before the start of the stage that preceded the end, equal to the current end, in the future
      for (const endedAt of [MONTH(1), "2019-06-01T00:00:00Z", MONTH(2), "2999-01-01T00:00:00Z"]) {
        await rejectsWith(K.c.correctEngagementTermination({ engagementId: id, endedAt }), K.c.CustomerRelationshipValidationError);
      }
      // at/before the start of the responsibility window or the scope: they would start after the end
      await rejectsWith(K.c.correctEngagementTermination({ engagementId: id, endedAt: MONTH(3) }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.correctEngagementTermination({ engagementId: id, endedAt: MONTH(4) }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.correctEngagementTermination({ engagementId: id, endedAt: MONTH(8) }), K.c.CustomerRelationshipValidationError); // unchanged
      assert.equal(await snapshot(), before, "no refused correction left a trace");
      await assertEngagementConsistent(id);

      // a scope that ended for its OWN reason after the new boundary is not silently altered
      const o = await org("Own");
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const eid = engagement.engagement.id;
      const scope = (await K.c.addScope({ engagementId: eid, productLevel: "BUSINESS_INTELLIGENCE", effectiveFrom: MONTH(2) })).current.scopes[0];
      await K.c.endScope({ scopeId: scope.id, effectiveTo: MONTH(7) });
      await K.c.endEngagement({ engagementId: eid, endedAt: MONTH(9), endReason: "COMPLETED" });
      await rejectsWith(K.c.correctEngagementTermination({ engagementId: eid, endedAt: MONTH(5) }), K.c.CustomerRelationshipValidationError);
      const fine = await K.c.correctEngagementTermination({ engagementId: eid, endedAt: MONTH(8) });
      assert.equal(fine.scopes.find((row) => row.id === scope.id)?.recordStatus, "active", "a scope that ended earlier on its own is untouched");
      assert.equal(fine.scopes.find((row) => row.id === scope.id)?.effectiveTo, MICRO(7));
    });

    scenario("the correction is atomic with the Master Register: a failure rolls everything back", async () => {
      const actor = await fullStaff();
      const { id } = await endedEngagement();
      const dump = async () =>
        JSON.stringify({
          engagement: (await pools.admin.query(`SELECT ended_at, end_reason_code FROM public.customer_engagements WHERE id = $1`, [id])).rows,
          stages: (await pools.admin.query(`SELECT id, record_status FROM public.customer_engagement_stages WHERE engagement_id = $1 ORDER BY id`, [id])).rows,
          scopes: (await pools.admin.query(`SELECT id, record_status FROM public.engagement_service_scopes WHERE engagement_id = $1 ORDER BY id`, [id])).rows,
          terminations: (await pools.admin.query(`SELECT id, record_status FROM public.customer_engagement_terminations WHERE engagement_id = $1 ORDER BY id`, [id])).rows,
        });
      const before = await dump();
      const eventsBefore = (await eventTypes(actor.actorId)).length;
      await refuseMasterRegisterEvent("RECORD_CORRECTED");
      await assert.rejects(K.c.correctEngagementTermination({ engagementId: id, endedAt: MONTH(6) }), /master register write refused/);
      await assert.rejects(K.c.correctEngagementTermination({ engagementId: id, endReason: "COMPLETED" }), /master register write refused/);
      assert.equal(await dump(), before, "the correction left no trace");
      assert.equal((await eventTypes(actor.actorId)).length, eventsBefore);
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
      await K.c.correctEngagementTermination({ engagementId: id, endedAt: MONTH(6) });
      assert.notEqual(await dump(), before);
      await assertEngagementConsistent(id);
    });

    scenario("authorization: only CUSTOMER_RELATIONSHIP_MANAGE may correct a termination", async () => {
      await fullStaff();
      const { id } = await endedEngagement();
      K.db.setClerkUser(null);
      await assert.rejects(K.c.correctEngagementTermination({ engagementId: id, endReason: "COMPLETED" }));
      for (const capabilities of [[], ["CUSTOMER_ESTABLISH"], ["CUSTOMER_RELATIONSHIP_READ"]] as Capability[][]) {
        signIn(await staff(...capabilities));
        await denied(K.c.correctEngagementTermination({ engagementId: id, endReason: "COMPLETED" }));
      }
      signIn(await staff("CUSTOMER_RELATIONSHIP_MANAGE"));
      assert.equal((await K.c.correctEngagementTermination({ engagementId: id, endReason: "COMPLETED" })).engagement.endReason, "COMPLETED");
    });
  });

  // =============================================================================================================
  describe("service scope and TES responsibility", () => {
    scenario("scopes are effective-dated; overlap rules; end / correct / void keep history", async () => {
      const actor = await fullStaff();
      const o = await org();
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      const service = await addService("COMPLIANCE");
      const first = (await K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", service, effectiveFrom: MONTH(2) })).current.scopes[0];
      // the same service twice, or the whole level over a specific service, overlaps
      await rejectsWith(K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", service, effectiveFrom: MONTH(3) }), K.c.CustomerRelationshipConflictError);
      await rejectsWith(K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(3) }), K.c.CustomerRelationshipConflictError);
      // other levels are independent
      await K.c.addScope({ engagementId: id, productLevel: "BUSINESS_INTELLIGENCE", effectiveFrom: MONTH(3) });
      // a scope cannot start before its Engagement; a service must exist and match the level
      await rejectsWith(K.c.addScope({ engagementId: id, productLevel: "DECISION_SUPPORT", effectiveFrom: "2019-01-01T00:00:00Z" }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.addScope({ engagementId: id, productLevel: "DECISION_SUPPORT", service }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.addScope({ engagementId: id, productLevel: "DECISION_SUPPORT", service: "NO_SUCH_SERVICE" }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.addScope({ engagementId: id, productLevel: "NOPE" }), K.c.CustomerRelationshipValidationError);
      // end, then the whole level can be scoped from the end
      const ended = await K.c.endScope({ scopeId: first.id, effectiveTo: MONTH(6) });
      assert.equal(ended.scopes.find((row) => row.id === first.id)?.effectiveTo, MICRO(6));
      const next = await K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(6) });
      assert.equal(next.current.scopes.filter((row) => row.productLevel === "COMPLIANCE").length, 1);
      // correct: the wrong row is kept and flagged; the replacement inherits the window
      const wrong = next.current.scopes.find((row) => row.productLevel === "COMPLIANCE")!;
      const corrected = await K.c.correctScope({ scopeId: wrong.id, productLevel: "DECISION_SUPPORT" });
      assert.equal(corrected.scopes.find((row) => row.id === wrong.id)?.recordStatus, "corrected");
      const replacement = corrected.scopes.find((row) => row.id === wrong.id)!.supersededById!;
      assert.equal(corrected.scopes.find((row) => row.id === replacement)?.effectiveFrom, MICRO(6));
      await rejectsWith(K.c.correctScope({ scopeId: wrong.id, productLevel: "COMPLIANCE" }), K.c.CustomerRelationshipStateError);
      // void: never existed
      const voided = await K.c.voidScope({ scopeId: replacement });
      assert.equal(voided.scopes.find((row) => row.id === replacement)?.recordStatus, "voided");
      assert.equal(voided.current.scopes.some((row) => row.id === replacement), false);
      // events reference rows and catalogue codes only
      const types = await eventTypes(actor.actorId);
      for (const type of ["RECORD_LINK_ESTABLISHED", "RECORD_LINK_REMOVED", "RECORD_CORRECTED"]) assert.ok(types.includes(type), type);
    });

    scenario("responsibility is bounded by its scope and Engagement and never predates them", async () => {
      await fullStaff();
      const o = await org();
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      const scope = (await K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(3) })).current.scopes[0];
      // the carrier operated before TES took over: TES is not responsible for that time
      await rejectsWith(K.c.assumeResponsibility({ scopeId: scope.id, effectiveFrom: MONTH(2) }), K.c.CustomerRelationshipValidationError);
      const assumed = (await K.c.assumeResponsibility({ scopeId: scope.id, effectiveFrom: MONTH(4) })).current.responsibilities[0];
      assert.equal(assumed.effectiveFrom, MICRO(4), "responsibility may start after the scope (TES took over later), never before");
      await rejectsWith(K.c.assumeResponsibility({ scopeId: scope.id, effectiveFrom: MONTH(5) }), K.c.CustomerRelationshipConflictError);
      // a scope with responsibility can be neither corrected nor voided; ending the scope ends the responsibility with it
      await rejectsWith(K.c.correctScope({ scopeId: scope.id, productLevel: "DECISION_SUPPORT" }), K.c.CustomerRelationshipStateError);
      await rejectsWith(K.c.voidScope({ scopeId: scope.id }), K.c.CustomerRelationshipStateError);
      // correct the window itself (time-only record)
      const corrected = await K.c.correctResponsibility({ responsibilityId: assumed.id, effectiveFrom: MONTH(5) });
      const old = corrected.responsibilities.find((row) => row.id === assumed.id)!;
      assert.equal(old.recordStatus, "corrected");
      assert.equal(corrected.responsibilities.find((row) => row.id === old.supersededById)?.effectiveFrom, MICRO(5));
      await rejectsWith(K.c.correctResponsibility({ responsibilityId: old.id, effectiveFrom: MONTH(6) }), K.c.CustomerRelationshipStateError);
      await rejectsWith(K.c.correctResponsibility({ responsibilityId: old.supersededById!, effectiveFrom: MONTH(2) }), K.c.CustomerRelationshipValidationError);
      const ended = await K.c.endScope({ scopeId: scope.id, effectiveTo: MONTH(9) });
      assert.equal(ended.responsibilities.find((row) => row.id === old.supersededById)?.effectiveTo, MICRO(9));
      assert.deepEqual(ended.current.responsibilities, []);
      // the scope is over: responsibility cannot be assumed on it any more, and void works on a window
      await rejectsWith(K.c.assumeResponsibility({ scopeId: scope.id }), K.c.CustomerRelationshipStateError);
      const second = (await K.c.addScope({ engagementId: id, productLevel: "BUSINESS_INTELLIGENCE", effectiveFrom: MONTH(2) })).current.scopes[0];
      const window = (await K.c.assumeResponsibility({ scopeId: second.id, effectiveFrom: MONTH(3) })).current.responsibilities[0];
      const voided = await K.c.voidResponsibility({ responsibilityId: window.id });
      assert.equal(voided.responsibilities.find((row) => row.id === window.id)?.recordStatus, "voided");
      assert.deepEqual(voided.current.responsibilities, []);
      // after the void the scope can be voided too
      await K.c.voidScope({ scopeId: second.id });
    });
  });

  // =============================================================================================================
  describe("agreements", () => {
    scenario("an amendment preserves the previous version; corrections are flagged; archive is lifecycle only", async () => {
      const actor = await fullStaff();
      const o = await org();
      await rejectsWith(K.c.createAgreement({ organizationId: o }), K.c.CustomerRelationshipNotFoundError); // not a Customer yet
      const { customer, engagement } = await establish(o, { stage: "ACTIVE" });
      const created = await K.c.createAgreement({ organizationId: o, agreementReference: "MSA-17", signedOn: "2020-01-15", effectiveFrom: MONTH(1) });
      assert.equal(created.customerId, customer.id);
      assert.equal(created.versions.length, 1);
      assert.equal(created.versions[0].changeReason, "INITIAL");
      const amended = await K.c.amendAgreement({ agreementId: created.id, agreementReference: "MSA-17-A", signedOn: "2020-06-01", effectiveFrom: MONTH(6) });
      assert.deepEqual(amended.versions.map((row) => [row.agreementReference, row.effectiveTo, row.changeReason]), [["MSA-17", MICRO(6), "INITIAL"], ["MSA-17-A", null, "AMENDMENT"]]);
      await rejectsWith(K.c.amendAgreement({ agreementId: created.id, effectiveFrom: MONTH(3) }), K.c.CustomerRelationshipValidationError);
      const wrong = amended.versions[1];
      const fixed = await K.c.correctAgreementVersion({ versionId: wrong.id, agreementReference: "MSA-17-B", signedOn: "2020-06-02" });
      const flagged = fixed.versions.find((row) => row.id === wrong.id)!;
      assert.equal(flagged.recordStatus, "corrected");
      assert.equal(flagged.agreementReference, "MSA-17-A", "the wrong value is preserved");
      const replacement = fixed.versions.find((row) => row.id === flagged.supersededById)!;
      assert.deepEqual([replacement.agreementReference, replacement.effectiveFrom, replacement.changeReason], ["MSA-17-B", MICRO(6), "CORRECTION"]);
      await rejectsWith(K.c.correctAgreementVersion({ versionId: wrong.id, agreementReference: "X" }), K.c.CustomerRelationshipStateError);
      // an agreement with a current version cannot be archived; end it first
      await rejectsWith(K.c.archiveAgreement({ agreementId: created.id }), K.c.CustomerRelationshipStateError);
      const ended = await K.c.endAgreement({ agreementId: created.id, effectiveTo: MONTH(9) });
      assert.equal(ended.versions.find((row) => row.id === replacement.id)?.effectiveTo, MICRO(9));
      await rejectsWith(K.c.amendAgreement({ agreementId: created.id }), K.c.CustomerRelationshipStateError);
      const archived = await K.c.archiveAgreement({ agreementId: created.id });
      assert.equal(archived.recordStatus, "archived");
      await rejectsWith(K.c.archiveAgreement({ agreementId: created.id }), K.c.CustomerRelationshipStateError);
      const restored = await K.c.restoreAgreement({ agreementId: created.id });
      assert.equal(restored.recordStatus, "active");
      assert.equal(restored.versions.length, 3, "no history was lost");
      // validation
      for (const bad of [{ agreementReference: "x".repeat(101) }, { signedOn: "2020-13-45" }, { signedOn: "yesterday" }, { unexpected: 1 }] as Array<Record<string, unknown>>) {
        await assert.rejects(K.c.createAgreement({ organizationId: o, ...bad }), (error: unknown) => error instanceof K.c.CustomerRelationshipError, JSON.stringify(bad));
      }
      // events never carry the reference, the dates or the reason
      const json = await eventsJson(actor.actorId);
      for (const secret of ["MSA-17", "2020-01-15", "2020-06-01"]) assert.equal(json.includes(secret), false, secret);
      void engagement;
    });

    scenario("a scope may reference only an active agreement of the same Customer", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const first = await establish(a, { stage: "ACTIVE" });
      await establish(b, { stage: "ACTIVE" });
      const own = await K.c.createAgreement({ organizationId: a });
      const foreign = await K.c.createAgreement({ organizationId: b });
      const linked = await K.c.addScope({ engagementId: first.engagement.engagement.id, productLevel: "COMPLIANCE", agreementId: own.id, effectiveFrom: MONTH(2) });
      assert.equal(linked.current.scopes[0].agreementId, own.id);
      await rejectsWith(K.c.addScope({ engagementId: first.engagement.engagement.id, productLevel: "BUSINESS_INTELLIGENCE", agreementId: foreign.id }), K.c.CustomerRelationshipValidationError);
      await rejectsWith(K.c.addScope({ engagementId: first.engagement.engagement.id, productLevel: "BUSINESS_INTELLIGENCE", agreementId: randomUUID() }), K.c.CustomerRelationshipValidationError);
    });
  });

  // =============================================================================================================
  describe("reads", () => {
    scenario("an Organization that is not a Customer reads as such; a missing Organization is not found; as-of follows business time", async () => {
      await fullStaff();
      const o = await org();
      const empty = await K.c.getCustomerRelationship(o);
      assert.equal(empty.customer, null);
      assert.deepEqual(empty.engagements, []);
      await rejectsWith(K.c.getCustomerRelationship(randomUUID()), K.c.CustomerRelationshipNotFoundError);
      await rejectsWith(K.c.getEngagement(randomUUID()), K.c.CustomerRelationshipNotFoundError);
      const { engagement } = await establish(o, { stage: "ONBOARDING" });
      const id = engagement.engagement.id;
      await K.c.changeStage({ engagementId: id, stage: "ACTIVE", effectiveFrom: MONTH(4) });
      const early = await K.c.getEngagement(id, { asOf: "2020-02-15T00:00:00Z" });
      assert.equal(early.asOf?.stage?.stage, "ONBOARDING");
      assert.equal(early.asOf?.engagementInForce, true);
      const before = await K.c.getEngagement(id, { asOf: "2019-12-01T00:00:00Z" });
      assert.equal(before.asOf?.engagementInForce, false);
      assert.equal(before.asOf?.stage, null);
      assert.equal((await K.c.getEngagement(id, { asOf: "2020-05-01T00:00:00Z" })).asOf?.stage?.stage, "ACTIVE");
      await assert.rejects(K.c.getEngagement(id, { asOf: "not a date" }), (error: unknown) => error instanceof K.c.CustomerRelationshipValidationError);
    });
  });

  // =============================================================================================================
  describe("concurrency (real PostgreSQL, distinct authorized actors)", () => {
    scenario("1. simultaneous CUSTOMER_ESTABLISH for one Organization creates exactly one Customer and one Engagement", async () => {
      const as = await concurrentActors(5);
      const o = await org();
      const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => as(i, () => establish(o))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.CustomerRelationshipError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.customers WHERE organization_id = $1`, [o]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.customer_engagements WHERE customer_id IN (SELECT id FROM public.customers WHERE organization_id = $1)`, [o]), 1);
    });

    scenario("2. duplicate Customer identity for one Organization is impossible at the database", async () => {
      const o = await org();
      const [first, second] = [await pools.admin.connect(), await pools.admin.connect()];
      try {
        await first.query("BEGIN");
        await second.query("BEGIN");
        await first.query(`INSERT INTO public.customers (organization_id) VALUES ($1)`, [o]);
        const blocked = second.query(`INSERT INTO public.customers (organization_id) VALUES ($1)`, [o]);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await first.query("COMMIT");
        await assert.rejects(blocked, /duplicate key|customers_organization_id_key/);
      } finally {
        await first.query("ROLLBACK").catch(() => undefined);
        await second.query("ROLLBACK").catch(() => undefined);
        first.release();
        second.release();
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.customers WHERE organization_id = $1`, [o]), 1);
    });

    scenario("3. two simultaneous open Engagements for one Customer cannot both be created, even bypassing the service", async () => {
      const o = await org();
      const customerId = (await pools.admin.query<{ id: string }>(`INSERT INTO public.customers (organization_id) VALUES ($1) RETURNING id`, [o])).rows[0].id;
      const attempt = async (month: number) => {
        const client = await pools.admin.connect();
        try {
          await client.query("BEGIN");
          const id = randomUUID();
          await client.query(`INSERT INTO public.customer_engagements (id, customer_id, engagement_type, started_at) VALUES ($1, $2, 'RECURRING', $3)`, [id, customerId, MONTH(month)]);
          await client.query(`INSERT INTO public.customer_engagement_stages (engagement_id, stage_code, change_reason, effective_from) VALUES ($1, 'ACTIVE', 'INITIAL', $2)`, [id, MONTH(month)]);
          await new Promise((resolve) => setTimeout(resolve, 100));
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      };
      const results = await Promise.allSettled([attempt(1), attempt(2), attempt(3)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.customer_engagements WHERE customer_id = $1`, [customerId]), 1);
    });

    scenario("4. simultaneous stage changes: one wins, history stays contiguous with exactly one current stage", async () => {
      const as = await concurrentActors(4);
      const o = await org();
      signIn((await staff(...ALL_CAPABILITIES)));
      const { engagement } = await establish(o, { stage: "ONBOARDING" });
      const id = engagement.engagement.id;
      const stages = ["ACTIVE", "SUSPENDED", "TRIAL", "ACTIVE"] as const;
      const results = await Promise.allSettled(stages.map((stage, i) => as(i, () => K.c.changeStage({ engagementId: id, stage, ...(stage === "TRIAL" ? { plannedEndAt: "2999-01-01T00:00:00Z" } : {}), effectiveFrom: MONTH(2 + i) }))));
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.CustomerRelationshipError || r.reason instanceof K.authz.TesAuthorizationDeniedError, String(r.reason));
      assert.ok(results.some((r) => r.status === "fulfilled"));
      await assertEngagementConsistent(id);
    });

    scenario("5. overlapping current stage periods cannot be created, even bypassing the service", async () => {
      const o = await org();
      signIn(await staff(...ALL_CAPABILITIES));
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      const insert = async (from: string) => {
        const client = await pools.admin.connect();
        try {
          await client.query("BEGIN");
          await client.query(`UPDATE public.customer_engagement_stages SET effective_to = $2 WHERE engagement_id = $1 AND effective_to IS NULL`, [id, from]);
          await client.query(`INSERT INTO public.customer_engagement_stages (engagement_id, stage_code, change_reason, effective_from) VALUES ($1, 'SUSPENDED', 'CHANGE', $2)`, [id, from]);
          await new Promise((resolve) => setTimeout(resolve, 100));
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      };
      const results = await Promise.allSettled([insert(MONTH(3)), insert(MONTH(4)), insert(MONTH(5))]);
      assert.ok(results.filter((r) => r.status === "fulfilled").length >= 1);
      await assertEngagementConsistent(id);
    });

    scenario("6. a stage correction racing a real stage change leaves consistent history", async () => {
      const as = await concurrentActors(2);
      const o = await org();
      signIn(await staff(...ALL_CAPABILITIES));
      const { engagement } = await establish(o, { stage: "ONBOARDING" });
      const id = engagement.engagement.id;
      const current = engagement.current.stage!;
      const results = await Promise.allSettled([
        as(0, () => K.c.correctStage({ stageId: current.id, stage: "ACTIVE" })),
        as(1, () => K.c.changeStage({ engagementId: id, stage: "SUSPENDED", effectiveFrom: MONTH(3) })),
      ]);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.CustomerRelationshipError, String(r.reason));
      assert.equal(results.filter((r) => r.status === "fulfilled").length >= 1, true);
      await assertEngagementConsistent(id);
    });

    scenario("7. ending an Engagement racing another dependent mutation never leaves a scope past the end", async () => {
      const as = await concurrentActors(3);
      const o = await org();
      signIn(await staff(...ALL_CAPABILITIES));
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      const results = await Promise.allSettled([
        as(0, () => K.c.endEngagement({ engagementId: id, endedAt: MONTH(6), endReason: "COMPLETED" })),
        as(1, () => K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(2) })),
        as(2, () => K.c.addScope({ engagementId: id, productLevel: "BUSINESS_INTELLIGENCE", effectiveFrom: MONTH(7) })),
      ]);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.CustomerRelationshipError, String(r.reason));
      await assertEngagementConsistent(id);
      assert.equal(await rowCount(`SELECT count(*) FROM public.engagement_service_scopes WHERE engagement_id = $1 AND record_status = 'active' AND (effective_to IS NULL OR effective_to > '2020-06-01Z') AND (SELECT ended_at FROM public.customer_engagements WHERE id = $1) IS NOT NULL`, [id]), 0);
    });

    scenario("8. simultaneous overlapping scopes: exactly one is created", async () => {
      const as = await concurrentActors(4);
      const o = await org();
      signIn(await staff(...ALL_CAPABILITIES));
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => as(i, () => K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(2 + i) }))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.CustomerRelationshipError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.engagement_service_scopes WHERE engagement_id = $1 AND record_status = 'active'`, [id]), 1);
    });

    scenario("9. a responsibility mutation racing Engagement termination stays inside the Engagement", async () => {
      const as = await concurrentActors(3);
      const o = await org();
      signIn(await staff(...ALL_CAPABILITIES));
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      const scope = (await K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(2) })).current.scopes[0];
      const results = await Promise.allSettled([
        as(0, () => K.c.endEngagement({ engagementId: id, endedAt: MONTH(6), endReason: "COMPLETED" })),
        as(1, () => K.c.assumeResponsibility({ scopeId: scope.id, effectiveFrom: MONTH(3) })),
        as(2, () => K.c.endScope({ scopeId: scope.id, effectiveTo: MONTH(5) })),
      ]);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.CustomerRelationshipError, String(r.reason));
      await assertEngagementConsistent(id);
      assert.equal(await rowCount(`SELECT count(*) FROM public.engagement_responsibility_periods r JOIN public.engagement_service_scopes s ON s.id = r.scope_id WHERE r.engagement_id = $1 AND r.record_status = 'active' AND (r.effective_from < s.effective_from OR (s.effective_to IS NOT NULL AND (r.effective_to IS NULL OR r.effective_to > s.effective_to)))`, [id]), 0);
    });

    scenario("10. re-engagement after historical closure; racing re-engagements create exactly one new Engagement", async () => {
      const as = await concurrentActors(4);
      const o = await org();
      signIn(await staff(...ALL_CAPABILITIES));
      const first = await establish(o, { stage: "ACTIVE" });
      await K.c.endEngagement({ engagementId: first.engagement.engagement.id, endedAt: MONTH(3), endReason: "COMPLETED" });
      const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => as(i, () => establish(o, { startedAt: MONTH(4 + i), stage: "ACTIVE" }))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.customers WHERE organization_id = $1`, [o]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.customer_engagements WHERE customer_id = $1`, [first.customer.id]), 2);
      assert.equal(await rowCount(`SELECT count(*) FROM public.customer_engagements WHERE customer_id = $1 AND ended_at IS NULL`, [first.customer.id]), 1);
    });
  });

  describe("concurrency: termination correction", () => {
    scenario("11. termination corrections racing each other and other mutations leave one consistent, still-ended Engagement", async () => {
      const as = await concurrentActors(5);
      const o = await org();
      signIn(await staff(...ALL_CAPABILITIES));
      const { engagement } = await establish(o, { stage: "ONBOARDING" });
      const id = engagement.engagement.id;
      await K.c.changeStage({ engagementId: id, stage: "ACTIVE", effectiveFrom: MONTH(2) });
      const scope = (await K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(3) })).current.scopes[0];
      await K.c.assumeResponsibility({ scopeId: scope.id, effectiveFrom: MONTH(4) });
      const ended = await K.c.endEngagement({ engagementId: id, endedAt: MONTH(8), endReason: "COMPLETED" });
      const activeStage = ended.stages.find((row) => row.stage === "ACTIVE")!;
      const results = await Promise.allSettled([
        as(0, () => K.c.correctEngagementTermination({ engagementId: id, endedAt: MONTH(6) })),
        as(1, () => K.c.correctEngagementTermination({ engagementId: id, endedAt: MONTH(7) })),
        as(2, () => K.c.correctEngagementTermination({ engagementId: id, endReason: "TES_TERMINATED" })),
        as(3, () => K.c.correctStage({ stageId: activeStage.id, stage: "SUSPENDED" })),
        as(4, () => K.c.voidScope({ scopeId: scope.id })),
      ]);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.CustomerRelationshipError, String(r.reason));
      assert.ok(results.some((r) => r.status === "fulfilled"));
      await assertEngagementConsistent(id);
      const row = (await pools.admin.query(`SELECT ended_at, end_reason_code FROM public.customer_engagements WHERE id = $1`, [id])).rows[0];
      assert.notEqual(row.ended_at, null, "still ended: no race reopened it");
      assert.equal(await activeTerminations(id), 1);
      const active = (await pools.admin.query(`SELECT ended_at, end_reason_code FROM public.customer_engagement_terminations WHERE engagement_id = $1 AND record_status = 'active'`, [id])).rows[0];
      assert.equal(active.ended_at.getTime(), row.ended_at.getTime(), "the audit row mirrors the canonical columns");
      assert.equal(active.end_reason_code, row.end_reason_code);
      // no active scope or responsibility reaches past the (corrected) boundary
      assert.equal(await rowCount(`SELECT count(*) FROM public.engagement_service_scopes s JOIN public.customer_engagements e ON e.id = s.engagement_id WHERE s.engagement_id = $1 AND s.record_status = 'active' AND (s.effective_to IS NULL OR s.effective_to > e.ended_at)`, [id]), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.engagement_responsibility_periods r JOIN public.customer_engagements e ON e.id = r.engagement_id WHERE r.engagement_id = $1 AND r.record_status = 'active' AND (r.effective_to IS NULL OR r.effective_to > e.ended_at)`, [id]), 0);
    });
  });

  /** Verifies the structural invariants of one Engagement directly from the tables, independent of the service. */
  async function assertEngagementConsistent(engagementId: string) {
    const engagement = (await pools.admin.query<{ started_at: Date; ended_at: Date | null; end_reason_code: string | null }>(`SELECT started_at, ended_at, end_reason_code FROM public.customer_engagements WHERE id = $1`, [engagementId])).rows[0];
    const activeTerminationRows = (await pools.admin.query<{ ended_at: Date; end_reason_code: string }>(`SELECT ended_at, end_reason_code FROM public.customer_engagement_terminations WHERE engagement_id = $1 AND record_status = 'active'`, [engagementId])).rows;
    if (engagement.ended_at === null) assert.equal(activeTerminationRows.length + (engagement.end_reason_code === null ? 0 : 1), 0, "an open Engagement carries no termination");
    else {
      assert.equal(activeTerminationRows.length, 1, "exactly one active termination record");
      assert.equal(activeTerminationRows[0].ended_at.getTime(), engagement.ended_at.getTime());
      assert.equal(activeTerminationRows[0].end_reason_code, engagement.end_reason_code);
    }
    const stages = (await pools.admin.query<{ stage_code: string; effective_from: Date; effective_to: Date | null }>(
      `SELECT stage_code, effective_from, effective_to FROM public.customer_engagement_stages WHERE engagement_id = $1 AND record_status = 'active' ORDER BY effective_from`,
      [engagementId],
    )).rows;
    assert.ok(stages.length >= 1);
    assert.equal(stages[0].effective_from.getTime(), engagement.started_at.getTime(), "history starts with the Engagement");
    for (let i = 0; i < stages.length - 1; i++) assert.equal(stages[i].effective_to?.getTime(), stages[i + 1].effective_from.getTime(), "contiguous, never overlapping");
    assert.equal(stages.filter((row) => row.effective_to === null).length, 1, "exactly one current stage");
    const current = stages[stages.length - 1];
    assert.equal(current.effective_to, null);
    if (engagement.ended_at === null) assert.notEqual(current.stage_code, "ENDED");
    else {
      assert.equal(current.stage_code, "ENDED");
      assert.equal(current.effective_from.getTime(), engagement.ended_at.getTime());
    }
  }

  // =============================================================================================================
  describe("Master Register", () => {
    scenario("each material mutation writes its event in the same transaction; references and vocabulary only", async () => {
      const actor = await fullStaff();
      const o = await org();
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      const before = (await eventTypes(actor.actorId)).length;
      assert.equal(before, 3);
      const scope = (await K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(2) })).current.scopes[0];
      await K.c.assumeResponsibility({ scopeId: scope.id, effectiveFrom: MONTH(3) });
      await K.c.changeStage({ engagementId: id, stage: "MANAGED_PROBATION", plannedEndAt: MONTH(9), effectiveFrom: MONTH(4) });
      const agreement = await K.c.createAgreement({ organizationId: o, agreementReference: "SECRET-REF", signedOn: "2020-02-02", effectiveFrom: MONTH(2) });
      await K.c.amendAgreement({ agreementId: agreement.id, agreementReference: "SECRET-REF-2", effectiveFrom: MONTH(5) });
      await K.c.endEngagement({ engagementId: id, endedAt: MONTH(8), endReason: "TES_TERMINATED" });
      const types = await eventTypes(actor.actorId);
      const known = new Set(["RECORD_CREATED", "RECORD_UPDATED", "RECORD_CORRECTED", "RECORD_ARCHIVED", "RECORD_RESTORED", "RECORD_LINK_ESTABLISHED", "RECORD_LINK_REMOVED"]);
      for (const type of types) assert.ok(known.has(type), type);
      assert.ok(types.length > before);
      const json = await eventsJson(actor.actorId);
      for (const secret of ["SECRET-REF", "TES_TERMINATED", "2020-02-02"]) assert.equal(json.includes(secret), false, secret);
      // reads and refused calls write nothing
      const count = types.length;
      await K.c.getCustomerRelationship(o);
      await K.c.getEngagement(id);
      await assert.rejects(K.c.changeStage({ engagementId: id, stage: "ACTIVE" }));
      await assert.rejects(establish(randomUUID()));
      assert.equal((await eventTypes(actor.actorId)).length, count);
    });

    scenario("a Master Register failure rolls the whole mutation back", async () => {
      const actor = await fullStaff();
      const o = await org();
      await refuseMasterRegisterEvent("RECORD_CREATED");
      await assert.rejects(establish(o), /master register write refused/);
      assert.equal(await rowCount(`SELECT count(*) FROM public.customers WHERE organization_id = $1`, [o]), 0, "no Customer");
      assert.equal(await rowCount(`SELECT count(*) FROM public.customer_engagements e JOIN public.customers c ON c.id = e.customer_id WHERE c.organization_id = $1`, [o]), 0, "no Engagement");
      assert.deepEqual(await eventTypes(actor.actorId), []);
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);

      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      for (const [eventType, work] of [
        ["RECORD_UPDATED", () => K.c.changeStage({ engagementId: id, stage: "SUSPENDED", effectiveFrom: MONTH(3) })],
        ["RECORD_LINK_ESTABLISHED", () => K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(2) })],
      ] as Array<[string, () => Promise<unknown>]>) {
        await refuseMasterRegisterEvent(eventType);
        await assert.rejects(work(), /master register write refused/, eventType);
        await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
      }
      const view = await K.c.getEngagement(id);
      assert.equal(view.stages.length, 1, "the failed stage change left no trace");
      assert.equal(view.current.stage?.stage, "ACTIVE");
      assert.equal(view.scopes.length, 0, "the failed scope left no trace");
      // a failed end leaves the Engagement open and consistent
      await refuseMasterRegisterEvent("RECORD_UPDATED");
      await assert.rejects(K.c.endEngagement({ engagementId: id, endedAt: MONTH(6), endReason: "COMPLETED" }), /master register write refused/);
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
      assert.equal((await K.c.getEngagement(id)).engagement.endedAt, null);
      await assertEngagementConsistent(id);
    });
  });

  // =============================================================================================================
  describe("authorization", () => {
    scenario("no session, no capability and the wrong capability are denied and change nothing", async () => {
      await fullStaff();
      const o = await org();
      const { engagement } = await establish(o, { stage: "ACTIVE" });
      const id = engagement.engagement.id;
      const scope = (await K.c.addScope({ engagementId: id, productLevel: "COMPLIANCE", effectiveFrom: MONTH(2) })).current.scopes[0];

      K.db.setClerkUser(null);
      await assert.rejects(K.c.getCustomerRelationship(o));
      await assert.rejects(establish(o));

      signIn(await staff());
      await denied(K.c.getCustomerRelationship(o));
      await denied(establish(o));
      await denied(K.c.changeStage({ engagementId: id, stage: "SUSPENDED" }));

      // establish alone can neither read nor manage
      signIn(await staff("CUSTOMER_ESTABLISH"));
      await denied(K.c.getCustomerRelationship(o));
      await denied(K.c.getEngagement(id));
      await denied(K.c.changeStage({ engagementId: id, stage: "SUSPENDED" }));
      await denied(K.c.endEngagement({ engagementId: id }));
      await denied(K.c.addScope({ engagementId: id, productLevel: "DECISION_SUPPORT" }));
      await denied(K.c.createAgreement({ organizationId: o }));
      // read alone can neither establish nor manage
      signIn(await staff("CUSTOMER_RELATIONSHIP_READ"));
      assert.equal((await K.c.getCustomerRelationship(o)).engagements.length, 1);
      assert.equal((await K.c.getEngagement(id)).engagement.id, id);
      await denied(establish(await org("Second")));
      await denied(K.c.changeStage({ engagementId: id, stage: "SUSPENDED" }));
      await denied(K.c.correctStage({ stageId: engagement.current.stage!.id, stage: "TRIAL", plannedEndAt: "2999-01-01T00:00:00Z" }));
      await denied(K.c.endEngagement({ engagementId: id }));
      await denied(K.c.addScope({ engagementId: id, productLevel: "DECISION_SUPPORT" }));
      await denied(K.c.endScope({ scopeId: scope.id }));
      await denied(K.c.assumeResponsibility({ scopeId: scope.id }));
      await denied(K.c.createAgreement({ organizationId: o }));
      // manage alone can neither establish nor read
      signIn(await staff("CUSTOMER_RELATIONSHIP_MANAGE"));
      await denied(K.c.getCustomerRelationship(o));
      await denied(K.c.getEngagement(id));
      await denied(establish(await org("Third")));
      // ORGANIZATION_UPDATE (and the other 0011 capabilities) authorize nothing here
      signIn(await staff());
      assert.equal(await rowCount(`SELECT count(*) FROM public.customer_engagements WHERE id = $1 AND ended_at IS NULL`, [id]), 1);
    });

    scenario("a customer actor, even with ORGANIZATION_READ, reaches nothing and no capability was granted by the migration", async () => {
      await fullStaff();
      const customerA = await fx.organizationAndCustomer("CustA");
      const user = await fx.actor();
      const relationshipId = await fx.relationship(user.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customerA.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      signIn(user);
      // the service has no CUSTOMER-scope path at all
      await denied(K.c.getCustomerRelationship(customerA.organizationId));
      await denied(establish(customerA.organizationId));
      await denied(K.c.createAgreement({ organizationId: customerA.organizationId }));
      assert.deepEqual(
        (await pools.admin.query(`SELECT DISTINCT c.code FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id WHERE c.code LIKE 'CUSTOMER_RELATIONSHIP_%' AND g.relationship_id = $1`, [relationshipId])).rows,
        [],
      );
    });

    scenario("the service exposes no delete, remove, merge or customer-scope function", async () => {
      assert.deepEqual(Object.keys(K.c).filter((key) => /delete|remove|destroy|merge|withAuthorizedCustomer|customerContext/i.test(key)), []);
    });
  });
});
