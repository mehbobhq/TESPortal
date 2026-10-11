// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL Insurance service through the REAL authorization wrappers and Clerk-to-actor resolution, on pooled
// connections that log in as the RUNTIME role, against a database with migrations 0001-0017 applied.

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
    i: await import("@/lib/insurance/service"),
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
const CATALOGUE = "insurance_coverage_types";
const BUSINESS_TABLES = ["insurance_policies", "insurance_policy_terms", "insurance_endorsements", "insurance_coverages", "insurance_broker_periods"] as const;
const ALL_TABLES = [CATALOGUE, ...BUSINESS_TABLES] as const;
type Capability = "INSURANCE_READ" | "INSURANCE_MANAGE";
const BOTH: Capability[] = ["INSURANCE_READ", "INSURANCE_MANAGE"];
// Persons are fixtures of the Contacts domain (broker contacts); their tables are purged with the same pattern.
const CONTACT_TABLES = ["persons", "person_name_versions", "organization_person_relationships"] as const;

describe("Insurance (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
  let persons: string[] = [];
  let cleanups: Array<() => Promise<void>> = [];

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

  /** Removes everything this scenario created. The no-delete triggers are lifted only here, by the table owner, in a transaction. */
  async function purge() {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const table of BUSINESS_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${table}_no_delete`);
      for (const table of CONTACT_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${table}_no_delete`);
      const policies = `(SELECT id FROM public.insurance_policies WHERE organization_id = ANY($1::uuid[]) OR insurer_organization_id = ANY($1::uuid[]))`;
      await client.query(`DELETE FROM public.insurance_coverages WHERE policy_id IN ${policies}`, [organizations]);
      await client.query(`DELETE FROM public.insurance_endorsements WHERE policy_id IN ${policies}`, [organizations]);
      await client.query(`DELETE FROM public.insurance_broker_periods WHERE policy_id IN ${policies}`, [organizations]);
      await client.query(`DELETE FROM public.insurance_policy_terms WHERE policy_id IN ${policies}`, [organizations]);
      await client.query(`DELETE FROM public.insurance_policies WHERE organization_id = ANY($1::uuid[]) OR insurer_organization_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.organization_person_relationships WHERE person_id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.person_name_versions WHERE person_id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.persons WHERE id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const table of CONTACT_TABLES) await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${table}_no_delete`);
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
      persons = [];
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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `INS ${label} ${id.slice(0, 8)} ${n()}`]);
    organizations.push(id);
    return id;
  }

  /** A person who holds an ACTIVE relationship with `organizationId` (a broker contact), created as the Contacts domain would. */
  async function contact(organizationId: string): Promise<{ personId: string; relationshipId: string }> {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      const personId = (await client.query<{ id: string }>(`INSERT INTO public.persons DEFAULT VALUES RETURNING id`)).rows[0].id;
      await client.query(
        `INSERT INTO public.person_name_versions (person_id, given_name, family_name, name_normalized, change_reason, effective_from) VALUES ($1, 'Test', $2, $3, 'INITIAL', '2020-01-01Z')`,
        [personId, `Broker${n()}`, `test broker${counter}`],
      );
      const relationshipId = (
        await client.query<{ id: string }>(`INSERT INTO public.organization_person_relationships (organization_id, person_id, effective_from) VALUES ($1, $2, '2020-01-01Z') RETURNING id`, [organizationId, personId])
      ).rows[0].id;
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

  async function staff(...capabilities: Capability[]): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability as never, { assignmentId });
    return actor;
  }
  const signIn = (actor: TestActor) => K.db.setClerkUser(actor.clerkSubject);
  async function fullStaff() {
    const actor = await staff(...BOTH);
    signIn(actor);
    return actor;
  }
  async function concurrentActors(count: number, ...capabilities: Capability[]) {
    const actors = await Promise.all(Array.from({ length: count }, () => staff(...(capabilities.length ? capabilities : BOTH))));
    return <T>(index: number, work: () => Promise<T>) => K.db.withClerkUser(actors[index].clerkSubject, work);
  }

  // Policy numbers are unique per run (the namespace is per insurer, but the disposable database is shared with other tests).
  const num = (prefix = "POL") => `${prefix}-${run}-${n()}`;
  const AL = (over: Record<string, unknown> = {}) => ({ coverageType: "AUTO_LIABILITY", limitAmount: "1000000", currency: "CAD", limitBasis: "COMBINED_SINGLE_LIMIT", ...over });
  const CARGO = (over: Record<string, unknown> = {}) => ({ coverageType: "MOTOR_TRUCK_CARGO", limitAmount: 100000, deductibleAmount: "1000", currency: "CAD", limitBasis: "PER_VEHICLE", ...over });
  const GL = (over: Record<string, unknown> = {}) => ({ coverageType: "GENERAL_LIABILITY", limitAmount: "2000000", currency: "CAD", limitBasis: "PER_OCCURRENCE", ...over });
  const WC = { coverageType: "WORKERS_COMPENSATION" };
  const BOND = (over: Record<string, unknown> = {}) => ({ coverageType: "BOND_FREIGHT_BROKER", limitAmount: "75000", currency: "USD", limitBasis: "PENAL_SUM", ...over });

  type Make = { insured?: string; insurer?: string } & Record<string, unknown>;
  /** Creates a standard INSURANCE policy (auto liability + cargo), term 2023-01-01 .. 2024-01-01. */
  async function policy(over: Make = {}) {
    const { insured, insurer, ...rest } = over;
    const organizationId = insured ?? (await org("Insured"));
    const insurerOrganizationId = insurer ?? (await org("Insurer"));
    const view = await K.i.createPolicy({
      organizationId,
      insurerOrganizationId,
      family: "INSURANCE",
      policyNumber: num(),
      termStart: "2023-01-01",
      termEnd: "2024-01-01",
      coverages: [AL(), CARGO()],
      ...rest,
    });
    return { organizationId, insurerOrganizationId, view, policyId: view.policy.id, termId: view.terms[0].term.id };
  }
  const coverageOf = (view: Awaited<ReturnType<typeof K.i.getOrganizationInsurance>>["policies"][number], type: string) =>
    view.terms.flatMap((t) => t.coverages).filter((c) => c.coverageType === type);

  /** Asserts the genuine coverage rows of a term form a valid timeline per type: no overlap and at most one open row, last. */
  async function assertTimelines(termId: string) {
    const rows = (await pools.admin.query<{ coverage_type: string; effective_from: string; effective_to: string | null }>(
      `SELECT coverage_type, effective_from::text, effective_to::text FROM public.insurance_coverages WHERE term_id = $1 AND record_status = 'active' ORDER BY coverage_type, effective_from`,
      [termId],
    )).rows;
    const byType = new Map<string, typeof rows>();
    for (const row of rows) byType.set(row.coverage_type, [...(byType.get(row.coverage_type) ?? []), row]);
    for (const [type, list] of byType) {
      list.forEach((row, index) => {
        if (index < list.length - 1) {
          assert.ok(row.effective_to !== null, `${type}: only the last row may be open`);
          assert.ok(row.effective_to <= list[index + 1].effective_from, `${type}: rows overlap`);
        }
        if (row.effective_to !== null) assert.ok(row.effective_to > row.effective_from, `${type}: empty period`);
      });
    }
  }

  /** A policy with history: AL changed on 2023-04-01 (E-1), cargo removed on 2023-06-01 (E-2). Term 2023-01-01 .. 2024-01-01. */
  async function rich(over: Make = {}) {
    const a = await policy(over);
    await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-04-01", endorsementNumber: "E-1", coverage: AL({ limitAmount: "2000000" }) });
    const view = await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_REMOVED", effectiveOn: "2023-06-01", endorsementNumber: "E-2", coverage: { coverageType: "MOTOR_TRUCK_CARGO" } });
    const endorsement = (kind: string) => view.terms[0].endorsements.find((e) => e.kind === kind)!;
    return { ...a, view, changed: endorsement("COVERAGE_CHANGED"), removed: endorsement("COVERAGE_REMOVED") };
  }
  const readPolicy = async (organizationId: string, asOf?: string) => (await K.i.getOrganizationInsurance(organizationId, asOf ? { asOf } : undefined)).policies[0];
  const activeRows = async (termId: string, type: string) =>
    (await pools.admin.query<{ id: string; limit_amount: string; effective_from: string; effective_to: string | null; endorsement_id: string | null; ended_by_endorsement_id: string | null }>(
      `SELECT id, limit_amount::text, effective_from::text, effective_to::text, endorsement_id, ended_by_endorsement_id FROM public.insurance_coverages WHERE term_id = $1 AND coverage_type = $2 AND record_status = 'active' ORDER BY effective_from`,
      [termId, type],
    )).rows;

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const denied = (promise: Promise<unknown>) => rejectsWith(promise, K.authz.TesAuthorizationDeniedError);
  const invalid = (promise: Promise<unknown>) => rejectsWith(promise, K.i.InsuranceValidationError);
  const stateError = (promise: Promise<unknown>) => rejectsWith(promise, K.i.InsuranceStateError);
  const conflict = (promise: Promise<unknown>) => rejectsWith(promise, K.i.InsuranceConflictError);
  const notFound = (promise: Promise<unknown>) => rejectsWith(promise, K.i.InsuranceNotFoundError);
  const collision = (promise: Promise<unknown>) => rejectsWith(promise, K.i.PolicyNumberCollisionError);
  const rowCount = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const orgRows = (table: string, column: string, id: string) => rowCount(`SELECT count(*) FROM public.${table} WHERE ${column} = $1`, [id]);
  const policyRows = (organizationId: string) => orgRows("insurance_policies", "organization_id", organizationId);
  // Events can share a recorded_at (same instant); break such ties by type so the order is deterministic.
  const eventTypes = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`, [actorId])).rows.map((row) => row.event_type);
  const eventsJson = async (actorId: string) => JSON.stringify((await pools.admin.query(`SELECT * FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId])).rows);

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
  const allowMasterRegister = () => pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);

  /** Runs statements in their own transaction as the table owner and returns the COMMIT outcome (deferred triggers fire at commit). */
  async function ownerTransaction(statements: Array<[string, unknown[]?]>): Promise<{ error?: Error & { constraint?: string; code?: string } }> {
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
  describe("schema (migration 0017)", () => {
    scenario("tables, catalogue seeds, indexes, functions and triggers exist; the ledger records 0017", async () => {
      assert.deepEqual(
        (await pools.admin.query<{ n: string }>(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY 1`, [[...ALL_TABLES]])).rows.map((row) => row.n),
        [...ALL_TABLES].sort(),
      );
      for (const index of ["insurance_coverages_current_uq", "insurance_broker_periods_current_uq", "insurance_endorsements_number_uq", "insurance_policy_terms_number_lookup_idx"]) {
        assert.equal(await rowCount(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [index]), 1, index);
      }
      for (const trigger of [
        "insurance_policies_require_active_term", "insurance_policy_terms_require_coverage", "insurance_policy_terms_guard_insert", "insurance_coverages_guard_insert",
        "insurance_endorsements_guard_insert", "insurance_broker_periods_guard_insert", "insurance_policies_guard_active_organization",
      ]) {
        assert.equal(await rowCount(`SELECT count(*) FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal`, [trigger]), 1, trigger);
      }
      const ledger = await pools.admin.query<{ sha256: string }>(`SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0017'`);
      const sql = readFileSync(path.join(process.cwd(), "database/migrations/0017_insurance_foundation.sql"));
      assert.equal(ledger.rows[0]?.sha256, createHash("sha256").update(sql).digest("hex"));
    });

    scenario("the TypeScript vocabulary agrees with the catalogue and the CHECK constraints (drift)", async () => {
      const defs = await import("@/lib/insurance/definitions");
      const rows = (await pools.admin.query<{ code: string; family: string; limit_required: boolean; is_active: boolean }>(`SELECT code, family, limit_required, is_active FROM public.insurance_coverage_types ORDER BY sort_order`)).rows;
      assert.deepEqual(rows.map((row) => row.code), defs.COVERAGE_TYPES);
      for (const row of rows) {
        assert.equal(row.family, defs.COVERAGE_TYPE_DEFINITIONS[row.code as keyof typeof defs.COVERAGE_TYPE_DEFINITIONS].family, row.code);
        assert.equal(row.limit_required, defs.COVERAGE_TYPE_DEFINITIONS[row.code as keyof typeof defs.COVERAGE_TYPE_DEFINITIONS].limitRequired, row.code);
        assert.equal(row.is_active, true, row.code);
      }
      assert.equal(rows.length, 10);
      const values = async (constraint: string) => {
        const definition = (await pools.admin.query<{ d: string }>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = $1`, [constraint])).rows[0].d;
        return [...definition.matchAll(/'([A-Z_]+)'::text/g)].map((match) => match[1]);
      };
      assert.deepEqual(await values("insurance_policies_family_valid"), [...defs.FAMILIES]);
      assert.deepEqual(await values("insurance_coverage_types_family_valid"), [...defs.FAMILIES]);
      assert.deepEqual(await values("insurance_policy_terms_cancellation_reason_valid"), [...defs.CANCELLATION_REASONS]);
      assert.deepEqual(await values("insurance_policy_terms_reason_valid"), [...defs.TERM_REASONS]);
      assert.deepEqual(await values("insurance_endorsements_kind_valid"), [...defs.ENDORSEMENT_KINDS]);
      assert.deepEqual(await values("insurance_coverages_limit_basis_valid"), [...defs.LIMIT_BASES]);
      assert.deepEqual(await values("insurance_coverages_currency_valid"), [...defs.CURRENCIES]);
    });

    scenario("capabilities: exactly two SYSTEM-only capabilities were added after the earlier ones; nothing is granted", async () => {
      const rows = (await pools.admin.query<{ code: string; description: string; is_active: boolean; sort_order: number }>(`SELECT code, description, is_active, sort_order FROM public.capabilities WHERE code LIKE 'INSURANCE\\_%' ORDER BY sort_order`)).rows;
      assert.deepEqual(rows.map((row) => row.code), ["INSURANCE_READ", "INSURANCE_MANAGE"]);
      for (const row of rows) {
        assert.match(row.description, /Intended scope: SYSTEM only\.$/);
        assert.equal(row.is_active, true);
      }
      assert.match(rows[0].description, /read access/i);
      assert.match(rows[1].description, /Does not store certificates or evidence/);
      const tes = await import("@/lib/auth/tes-capabilities");
      assert.equal(tes.TES_CAPABILITY_SCOPES.INSURANCE_READ, "SYSTEM");
      assert.equal(tes.TES_CAPABILITY_SCOPES.INSURANCE_MANAGE, "SYSTEM");
      assert.equal(await rowCount(`SELECT count(*) FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id WHERE c.code LIKE 'INSURANCE\\_%' AND g.created_at < now() - interval '1 day'`), 0, "the migration grants nothing");
    });

    scenario("no SECURITY DEFINER, no RLS, no policy on the new tables; every new function is invoker with a fixed search_path and no PUBLIC execute", async () => {
      const functions = (await pools.admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; public_execute: boolean }>(
        `SELECT p.proname, p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname ~ '(insurance)'`,
      )).rows;
      assert.equal(functions.length, 12);
      for (const fn of functions) {
        assert.equal(fn.prosecdef, false, fn.proname);
        assert.deepEqual(fn.proconfig, ["search_path=pg_catalog"], fn.proname);
        assert.equal(fn.public_execute, false, fn.proname);
      }
      for (const table of ALL_TABLES) {
        assert.equal((await pools.admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${table}`])).rows[0].relrowsecurity, false, table);
      }
      assert.equal(await rowCount(`SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])`, [[...ALL_TABLES]]), 0);
    });

    scenario("runtime privileges: SELECT, column-specific INSERT/UPDATE, no DELETE, TRUNCATE, REFERENCES or TRIGGER, nothing for PUBLIC; the catalogue is read-only", async () => {
      const has = async (table: string, privilege: string) => (await pools.admin.query(`SELECT has_table_privilege($1, $2::regclass, $3) AS ok`, [RUNTIME_ROLE, `public.${table}`, privilege])).rows[0].ok;
      const column = async (table: string, name: string, privilege: string) =>
        (await pools.admin.query(`SELECT has_column_privilege($1, $2::regclass, $3, $4) AS ok`, [RUNTIME_ROLE, `public.${table}`, name, privilege])).rows[0].ok;
      for (const table of ALL_TABLES) {
        for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) assert.equal(await has(table, privilege), false, `${table} ${privilege}`);
        assert.equal(await has(table, "SELECT"), true, table);
        assert.equal(await rowCount(`SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'PUBLIC'`, [table]), 0, `PUBLIC on ${table}`);
        await assert.rejects(pools.runtime.query(`DELETE FROM public.${table}`), /permission denied/, table);
        await assert.rejects(pools.runtime.query(`TRUNCATE public.${table}`), /permission denied/, table);
      }
      for (const privilege of ["INSERT", "UPDATE"]) assert.equal(await has(CATALOGUE, privilege), false, `catalogue ${privilege}`);
      // identity and content columns are insert-only: never updatable by the runtime role
      const immutable: Array<[string, string[]]> = [
        ["insurance_policies", ["id", "organization_id", "insurer_organization_id", "family", "renews_policy_id", "created_at"]],
        ["insurance_policy_terms", ["id", "policy_id", "organization_id", "insurer_organization_id", "family", "number_display", "number_normalized", "normalization_rule_version", "term_start", "term_end", "term_reason", "created_at"]],
        ["insurance_endorsements", ["id", "term_id", "number_display", "number_normalized", "endorsement_kind", "effective_on"]],
        ["insurance_coverages", ["id", "term_id", "coverage_type", "limit_amount", "deductible_amount", "currency", "limit_basis", "scheduled_vehicles_only", "effective_from", "endorsement_id"]],
        ["insurance_broker_periods", ["id", "policy_id", "broker_organization_id", "broker_relationship_id", "broker_person_id", "effective_from"]],
      ];
      for (const [table, columns] of immutable) for (const name of columns) assert.equal(await column(table, name, "UPDATE"), false, `${table}.${name} is immutable`);
      // the writable surface is exactly the lifecycle / one-way columns
      const updatable: Array<[string, string[]]> = [
        ["insurance_policies", ["record_status", "archived_at", "updated_at"]],
        ["insurance_policy_terms", ["cancelled_on", "cancellation_reason", "record_status", "corrected_at", "superseded_by_term_id", "updated_at"]],
        ["insurance_endorsements", ["record_status", "corrected_at", "superseded_by_endorsement_id", "updated_at"]],
        ["insurance_coverages", ["effective_to", "ended_by_endorsement_id", "record_status", "corrected_at", "superseded_by_coverage_id", "updated_at"]],
        ["insurance_broker_periods", ["effective_to", "record_status", "corrected_at", "superseded_by_period_id", "updated_at"]],
      ];
      for (const [table, columns] of updatable) {
        const all = (await pools.admin.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows.map((row) => row.column_name);
        const writable: string[] = [];
        for (const name of all) if (await column(table, name, "UPDATE")) writable.push(name);
        assert.deepEqual(writable.sort(), [...columns].sort(), `${table} writable columns`);
      }
    });
  });

  // =============================================================================================================
  describe("authorization", () => {
    scenario("no session, no capability and the wrong capability are denied and change nothing", async () => {
      await fullStaff();
      const { organizationId, insurerOrganizationId, policyId, termId } = await policy();
      const before = await policyRows(organizationId);
      const input = { organizationId, insurerOrganizationId, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] };

      K.db.setClerkUser(null);
      await assert.rejects(K.i.getOrganizationInsurance(organizationId));
      await assert.rejects(K.i.createPolicy(input));
      await assert.rejects(K.i.checkPolicyNumber(insurerOrganizationId, "X1"));

      signIn(await staff());
      await denied(K.i.getOrganizationInsurance(organizationId));
      await denied(K.i.checkPolicyNumber(insurerOrganizationId, "X1"));
      await denied(K.i.createPolicy(input));
      // other Companies capabilities authorize nothing here
      for (const other of ["ORGANIZATION_READ", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "CONTACT_MANAGE"]) {
        const actor = await fx.actor();
        const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
        const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
        await fx.grant(relationshipId, other as never, { assignmentId });
        signIn(actor);
        await denied(K.i.getOrganizationInsurance(organizationId));
        await denied(K.i.createPolicy(input));
      }

      // READ alone can read, and can neither mutate nor correct anything
      signIn(await staff("INSURANCE_READ"));
      assert.equal((await K.i.getOrganizationInsurance(organizationId)).policies.length, 1);
      assert.equal((await K.i.checkPolicyNumber(insurerOrganizationId, "X1")).registered, false);
      const mutations: Array<[string, unknown]> = [
        ["createPolicy", input],
        ["renewPolicy", { policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()] }],
        ["cancelTerm", { termId, cancelledOn: "2023-06-01", reason: "INSURED_REQUEST" }],
        ["addEndorsement", { termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-03-01", coverage: GL() }],
        ["correctTerm", { termId, termEnd: "2024-02-01" }],
        ["correctCoverage", { coverageId: randomUUID(), limitAmount: 5 }],
        ["correctEndorsement", { endorsementId: randomUUID(), effectiveOn: "2023-03-02" }],
        ["changeBroker", { policyId, brokerOrganizationId: await org("Broker") }],
        ["correctBroker", { brokerPeriodId: randomUUID(), brokerOrganizationId: await org("Broker") }],
        ["archivePolicy", { policyId }],
        ["restorePolicy", { policyId }],
      ];
      for (const [name, args] of mutations) await denied((K.i as unknown as Record<string, (input: unknown) => Promise<unknown>>)[name](args));

      // MANAGE alone can mutate but can read nothing (neither the view nor the registry)
      signIn(await staff("INSURANCE_MANAGE"));
      await denied(K.i.getOrganizationInsurance(organizationId));
      await denied(K.i.checkPolicyNumber(insurerOrganizationId, "X1"));
      assert.equal((await K.i.archivePolicy({ policyId })).policy.recordStatus, "archived");
      assert.equal((await K.i.restorePolicy({ policyId })).policy.recordStatus, "active");

      assert.equal(await policyRows(organizationId), before, "no denied call created anything");
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1`, [policyId]), 1);
    });

    scenario("a customer actor, even with ORGANIZATION_READ, reaches nothing; the service has no customer-scope path", async () => {
      await fullStaff();
      const customerA = await fx.organizationAndCustomer("CustA");
      const insurer = await org("Insurer");
      const user = await fx.actor();
      const relationshipId = await fx.relationship(user.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customerA.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      signIn(user);
      await denied(K.i.getOrganizationInsurance(customerA.organizationId));
      await denied(K.i.checkPolicyNumber(insurer, "X1"));
      await denied(K.i.createPolicy({ organizationId: customerA.organizationId, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] }));
      assert.deepEqual((await pools.admin.query(`SELECT 1 FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id WHERE c.code LIKE 'INSURANCE\\_%' AND g.relationship_id = $1`, [relationshipId])).rows, []);
    });

    scenario("the service exposes no delete, remove, merge or customer-scope function and no status setter", async () => {
      assert.deepEqual(Object.keys(K.i).filter((key) => /delete|remove|destroy|merge|withAuthorizedCustomer|customerContext|setStatus|expire/i.test(key)), []);
    });
  });

  // =============================================================================================================
  describe("createPolicy", () => {
    scenario("creates the policy, its first term, every coverage and the broker atomically; nothing is a stored status", async () => {
      const actor = await fullStaff();
      const insured = await org("Insured");
      const insurer = await org("Insurer");
      const brokerage = await org("Brokerage");
      const { personId, relationshipId } = await contact(brokerage);
      const number = num();
      const view = await K.i.createPolicy({
        organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: ` ${number.toLowerCase()} `, termStart: "2023-01-01", termEnd: "2024-01-01",
        coverages: [AL(), CARGO(), GL({ scheduledVehiclesOnly: false })],
        broker: { brokerOrganizationId: brokerage, brokerPersonId: personId },
      });
      assert.equal(view.policy.organizationId, insured);
      assert.equal(view.policy.insurerOrganizationId, insurer);
      assert.equal(view.policy.family, "INSURANCE");
      assert.equal(view.policy.recordStatus, "active");
      assert.equal(view.policy.renewsPolicyId, null);
      assert.equal(view.terms.length, 1);
      const term = view.terms[0].term;
      assert.equal(term.numberDisplay, number.toLowerCase());
      assert.equal(term.numberNormalized, number.replace(/-/g, "").toUpperCase());
      assert.equal(term.normalizationRuleVersion, "insurance_policy_number.permissive.v1");
      assert.deepEqual([term.termStart, term.termEnd, term.cancelledOn, term.termReason, term.recordStatus], ["2023-01-01", "2024-01-01", null, "INITIAL", "active"]);
      assert.equal(view.terms[0].coverages.length, 3);
      const auto = view.terms[0].coverages.find((c) => c.coverageType === "AUTO_LIABILITY")!;
      assert.deepEqual(
        [auto.limitAmount, auto.deductibleAmount, auto.currency, auto.limitBasis, auto.scheduledVehiclesOnly, auto.effectiveFrom, auto.effectiveTo, auto.endorsementId, auto.recordStatus],
        ["1000000.00", null, "CAD", "COMBINED_SINGLE_LIMIT", false, "2023-01-01", null, null, "active"],
      );
      const cargo = view.terms[0].coverages.find((c) => c.coverageType === "MOTOR_TRUCK_CARGO")!;
      assert.deepEqual([cargo.limitAmount, cargo.deductibleAmount], ["100000.00", "1000.00"]);
      assert.equal(view.brokerPeriods.length, 1);
      assert.deepEqual([view.brokerPeriods[0].brokerOrganizationId, view.brokerPeriods[0].brokerPersonId, view.brokerPeriods[0].brokerRelationshipId, view.brokerPeriods[0].effectiveTo], [brokerage, personId, relationshipId, null]);
      assert.equal(view.current.broker?.id, view.brokerPeriods[0].id);
      // "in force" is derived from the dates: in the past, so the 2023 term is EXPIRED today
      assert.equal(view.terms[0].state, "EXPIRED");
      assert.equal(view.asOf.inForce, false);
      assert.deepEqual(await eventTypes(actor.actorId), ["RECORD_CREATED", "RECORD_CREATED", "RECORD_CREATED", "RECORD_CREATED", "RECORD_CREATED", "RECORD_CREATED"]);
      // there is no stored status column of any kind besides the record lifecycle
      const statusColumns = await pools.admin.query<{ c: string }>(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[]) AND column_name ~ 'status|expired|in_force'`, [[...ALL_TABLES]]);
      assert.deepEqual(statusColumns.rows.map((row) => row.c).sort(), BUSINESS_TABLES.map((table) => `${table}.record_status`).sort());
    });

    scenario("workers' compensation takes no limit; a bond is a penal sum and may be continuous", async () => {
      await fullStaff();
      const insured = await org("Insured");
      const board = await org("Board");
      const wc = await K.i.createPolicy({ organizationId: insured, insurerOrganizationId: board, family: "WORKERS_COMPENSATION", policyNumber: num("WCB"), termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [WC] });
      assert.equal(wc.policy.family, "WORKERS_COMPENSATION");
      const row = wc.terms[0].coverages[0];
      assert.deepEqual([row.coverageType, row.limitAmount, row.currency, row.limitBasis], ["WORKERS_COMPENSATION", null, null, null]);
      const surety = await org("Surety");
      const bond = await K.i.createPolicy({ organizationId: insured, insurerOrganizationId: surety, family: "BOND", policyNumber: num("BND"), termStart: "2022-05-01", coverages: [BOND()] });
      assert.equal(bond.terms[0].term.termEnd, null);
      assert.equal(bond.terms[0].coverages[0].limitBasis, "PENAL_SUM");
      assert.equal(bond.terms[0].state, "IN_FORCE", "a continuous bond is in force until cancelled");
      assert.equal(bond.asOf.inForce, true);
      assert.deepEqual(bond.asOf.coverages.map((c) => c.coverageType), ["BOND_FREIGHT_BROKER"]);
      // a continuous term is a bond-only privilege
      await invalid(K.i.createPolicy({ organizationId: insured, insurerOrganizationId: board, family: "WORKERS_COMPENSATION", policyNumber: num(), termStart: "2024-01-01", coverages: [WC] }));
      await invalid(K.i.createPolicy({ organizationId: insured, insurerOrganizationId: surety, family: "INSURANCE", policyNumber: num(), termStart: "2024-01-01", coverages: [AL()] }));
    });

    scenario("a new-policy renewal points at its predecessor (same Organization and family)", async () => {
      await fullStaff();
      const first = await policy();
      const renewed = await K.i.createPolicy({
        organizationId: first.organizationId, insurerOrganizationId: first.insurerOrganizationId, family: "INSURANCE", policyNumber: num(), termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()], renewsPolicyId: first.policyId,
      });
      assert.equal(renewed.policy.renewsPolicyId, first.policyId);
      assert.notEqual(renewed.policy.id, first.policyId);
      // another Organization's policy, or another family, cannot be renewed
      const other = await policy();
      await invalid(K.i.createPolicy({ organizationId: first.organizationId, insurerOrganizationId: first.insurerOrganizationId, family: "INSURANCE", policyNumber: num(), termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()], renewsPolicyId: other.policyId }));
      await invalid(K.i.createPolicy({ organizationId: first.organizationId, insurerOrganizationId: first.insurerOrganizationId, family: "BOND", policyNumber: num(), termStart: "2024-01-01", coverages: [BOND()], renewsPolicyId: first.policyId }));
      await notFound(K.i.createPolicy({ organizationId: first.organizationId, insurerOrganizationId: first.insurerOrganizationId, family: "INSURANCE", policyNumber: num(), termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()], renewsPolicyId: randomUUID() }));
      assert.equal(await policyRows(first.organizationId), 2);
    });

    scenario("invalid input is refused with a domain error and creates nothing", async () => {
      await fullStaff();
      const insured = await org("Insured");
      const insurer = await org("Insurer");
      const base = { organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] };
      const cases: Array<[string, Record<string, unknown>]> = [
        ["unknown key", { unexpected: true }],
        ["not an object coverage", { coverages: ["AUTO_LIABILITY"] }],
        ["no coverage", { coverages: [] }],
        ["coverages missing", { coverages: undefined }],
        ["duplicate coverage type", { coverages: [AL(), AL({ limitAmount: "5" })] }],
        ["unknown coverage type", { coverages: [AL({ coverageType: "CYBER" })] }],
        ["coverage of another family", { coverages: [AL(), { coverageType: "BOND_CUSTOMS", limitAmount: "5", currency: "USD" }] }],
        ["workers' type on an insurance policy", { coverages: [WC] }],
        ["limit missing where required", { coverages: [AL({ limitAmount: undefined })] }],
        ["limit on a statutory account", { family: "WORKERS_COMPENSATION", coverages: [{ ...WC, limitAmount: "100", currency: "CAD" }] }],
        ["zero limit", { coverages: [AL({ limitAmount: "0" })] }],
        ["negative limit", { coverages: [AL({ limitAmount: "-5" })] }],
        ["float noise", { coverages: [AL({ limitAmount: "1e6" })] }],
        ["too many decimals", { coverages: [AL({ limitAmount: "10.005" })] }],
        ["currency missing with an amount", { coverages: [AL({ currency: undefined })] }],
        ["currency without an amount", { family: "WORKERS_COMPENSATION", coverages: [{ ...WC, currency: "CAD" }] }],
        ["unknown currency", { coverages: [AL({ currency: "EUR" })] }],
        ["unknown limit basis", { coverages: [AL({ limitBasis: "WHENEVER" })] }],
        ["penal sum on insurance", { coverages: [AL({ limitBasis: "PENAL_SUM" })] }],
        ["occurrence basis on a bond", { family: "BOND", termEnd: undefined, coverages: [BOND({ limitBasis: "PER_OCCURRENCE" })] }],
        ["scheduled-vehicles flag on a bond", { family: "BOND", termEnd: undefined, coverages: [BOND({ scheduledVehiclesOnly: true })] }],
        ["scheduled-vehicles flag not boolean", { coverages: [AL({ scheduledVehiclesOnly: "yes" })] }],
        ["unknown family", { family: "LIFE" }],
        ["no family", { family: undefined }],
        ["insurer is the insured", { insurerOrganizationId: insured }],
        ["insured not a UUID", { organizationId: "nope" }],
        ["number blank", { policyNumber: "  " }],
        ["number too long", { policyNumber: "A".repeat(41) }],
        ["number with illegal characters", { policyNumber: "POL#1" }],
        ["term start missing", { termStart: undefined }],
        ["term start not a date", { termStart: "2023-02-30" }],
        ["term end not after start", { termEnd: "2023-01-01" }],
        ["term end before start", { termEnd: "2022-12-31" }],
        ["term end missing for insurance", { termEnd: undefined }],
        ["broker not an object", { broker: "ACME" }],
        ["broker unknown key", { broker: { brokerOrganizationId: insurer, extra: 1 } }],
        ["broker organization missing", { broker: {} }],
        ["broker start in the future", { broker: { brokerOrganizationId: insurer, effectiveFrom: "2999-01-01T00:00:00Z" } }],
        ["broker start not an instant", { broker: { brokerOrganizationId: insurer, effectiveFrom: "2020-01-01" } }],
        ["renews not a UUID", { renewsPolicyId: "x" }],
      ];
      for (const [label, over] of cases) {
        const input = { ...base, ...over };
        for (const key of Object.keys(input)) if (input[key as keyof typeof input] === undefined) delete input[key as keyof typeof input];
        await assert.rejects(K.i.createPolicy(input), (error: unknown) => error instanceof K.i.InsuranceError, label);
      }
      await assert.rejects(K.i.createPolicy(null), (error: unknown) => error instanceof K.i.InsuranceValidationError);
      await assert.rejects(K.i.createPolicy([base]), (error: unknown) => error instanceof K.i.InsuranceValidationError);
      assert.equal(await policyRows(insured), 0, "nothing was created by any rejected attempt");
      // validation errors name the field and never leak database detail
      await assert.rejects(K.i.createPolicy({ ...base, termEnd: "2022-01-01" }), (error: unknown) => {
        assert.ok(error instanceof K.i.InsuranceValidationError);
        assert.equal(error.field, "termEnd");
        assert.doesNotMatch(error.message, /constraint|violates|insurance_|public\./i);
        return true;
      });
    });

    scenario("missing, archived and merged Organizations are refused; so is an inactive insurer or brokerage", async () => {
      await fullStaff();
      const insurer = await org("Insurer");
      const input = (over: Record<string, unknown>) => ({ organizationId: randomUUID(), insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()], ...over });
      await notFound(K.i.createPolicy(input({})));
      const archived = await org("Archived");
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archived]);
      await stateError(K.i.createPolicy(input({ organizationId: archived })));
      const survivor = await org("Survivor");
      const merged = await org("Merged");
      await pools.admin.query(`UPDATE public.organizations SET status = 'merged', merged_into_organization_id = $2 WHERE id = $1`, [merged, survivor]);
      await stateError(K.i.createPolicy(input({ organizationId: merged })));
      const insured = await org("Insured");
      await notFound(K.i.createPolicy(input({ organizationId: insured, insurerOrganizationId: randomUUID() })));
      await stateError(K.i.createPolicy(input({ organizationId: insured, insurerOrganizationId: archived })));
      await stateError(K.i.createPolicy(input({ organizationId: insured, insurerOrganizationId: merged })));
      await notFound(K.i.createPolicy(input({ organizationId: insured, broker: { brokerOrganizationId: randomUUID() } })));
      await stateError(K.i.createPolicy(input({ organizationId: insured, broker: { brokerOrganizationId: archived } })));
      assert.equal(await policyRows(insured), 0);
    });

    scenario("a broker contact must hold an ACTIVE relationship with the brokerage firm", async () => {
      await fullStaff();
      const insured = await org("Insured");
      const insurer = await org("Insurer");
      const brokerage = await org("Brokerage");
      const otherFirm = await org("Other firm");
      const stranger = await contact(otherFirm);
      await invalid(K.i.createPolicy({ organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()], broker: { brokerOrganizationId: brokerage, brokerPersonId: stranger.personId } }));
      await invalid(K.i.createPolicy({ organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()], broker: { brokerOrganizationId: brokerage, brokerPersonId: randomUUID() } }));
      // an ended relationship no longer qualifies
      const ended = await contact(brokerage);
      await pools.admin.query(`UPDATE public.organization_person_relationships SET effective_to = now() WHERE id = $1`, [ended.relationshipId]);
      await invalid(K.i.createPolicy({ organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()], broker: { brokerOrganizationId: brokerage, brokerPersonId: ended.personId } }));
      assert.equal(await policyRows(insured), 0);
      // a brokerage with no named contact is fine
      const view = await K.i.createPolicy({ organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()], broker: { brokerOrganizationId: brokerage } });
      assert.deepEqual([view.brokerPeriods[0].brokerPersonId, view.brokerPeriods[0].brokerRelationshipId], [null, null]);
    });
  });

  // =============================================================================================================
  describe("policy-number namespace (per insurer)", () => {
    scenario("a number belongs to ONE policy within its insurer; spellings are equal; another insurer may reuse it", async () => {
      await fullStaff();
      const a = await policy({ policyNumber: `pol-${run}-100 a` });
      const insured2 = await org("Insured2");
      const sameInsurer = (over: Record<string, unknown>) => K.i.createPolicy({ organizationId: insured2, insurerOrganizationId: a.insurerOrganizationId, family: "INSURANCE", termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()], ...over });
      for (const spelling of [`POL${run}100A`, `Pol ${run} 100/A`, `pol.${run}.100_a`, ` POL-${run}-100-A `]) await collision(sameInsurer({ policyNumber: spelling }));
      // the same insured Organization cannot hold the same number on a second policy either
      await collision(K.i.createPolicy({ organizationId: a.organizationId, insurerOrganizationId: a.insurerOrganizationId, family: "INSURANCE", policyNumber: `POL${run}100A`, termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] }));
      assert.equal(await policyRows(insured2), 0);
      // a DIFFERENT insurer may issue the very same number
      const otherInsurer = await org("Other insurer");
      const ok = await sameInsurer({ insurerOrganizationId: otherInsurer, policyNumber: `POL${run}100A` });
      assert.equal(ok.terms[0].term.numberNormalized, `POL${run}100A`);
      // and the number space does not span families of unrelated insurers either
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE number_normalized = $1 AND record_status = 'active'`, [`POL${run}100A`]), 2);
    });

    scenario("a collision names the holder only when the caller also holds INSURANCE_READ; the registry check names it to readers", async () => {
      const manageOnly = await staff("INSURANCE_MANAGE");
      const readManage = await staff(...BOTH);
      signIn(readManage);
      const held = await policy();
      const other = await org("Other insured");
      const input = { organizationId: other, insurerOrganizationId: held.insurerOrganizationId, family: "INSURANCE", policyNumber: held.view.terms[0].term.numberDisplay.toLowerCase(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] };

      signIn(manageOnly);
      await assert.rejects(K.i.createPolicy(input), (error: unknown) => {
        assert.ok(error instanceof K.i.PolicyNumberCollisionError);
        assert.equal(error.match, undefined, "no disclosure without INSURANCE_READ");
        assert.equal(error.message, "This policy number is already registered with that insurer.");
        assert.equal((error as { code: string }).code, "INSURANCE_NUMBER_COLLISION");
        return true;
      });
      signIn(readManage);
      await assert.rejects(K.i.createPolicy(input), (error: unknown) => {
        assert.ok(error instanceof K.i.PolicyNumberCollisionError);
        assert.deepEqual(
          { ...error.match, organizationLegalName: undefined },
          { policyId: held.policyId, termId: held.termId, organizationId: held.organizationId, organizationLegalName: undefined, family: "INSURANCE", policyRecordStatus: "active", recommendedAction: "OPEN_EXISTING" },
        );
        assert.match(error.match!.organizationLegalName, /^INS Insured /);
        return true;
      });

      const check = await K.i.checkPolicyNumber(held.insurerOrganizationId, ` ${held.view.terms[0].term.numberDisplay.toLowerCase()} `);
      assert.equal(check.registered, true);
      assert.equal(check.holder?.policyId, held.policyId);
      assert.equal(check.number.normalized, held.view.terms[0].term.numberNormalized);
      assert.equal(check.number.ruleVersion, "insurance_policy_number.permissive.v1");
      const free = await K.i.checkPolicyNumber(held.insurerOrganizationId, num("FREE"));
      assert.deepEqual([free.registered, free.holder], [false, null]);
      // the same number at another insurer is not registered there
      assert.equal((await K.i.checkPolicyNumber(await org("Elsewhere"), held.view.terms[0].term.numberDisplay)).registered, false);
      await notFound(K.i.checkPolicyNumber(randomUUID(), "X1"));
      await invalid(K.i.checkPolicyNumber(held.insurerOrganizationId, "###"));
      await invalid(K.i.checkPolicyNumber("not-a-uuid", "X1"));

      // an ARCHIVED policy keeps its number: reuse is an explicit decision (restore, do not duplicate)
      await K.i.archivePolicy({ policyId: held.policyId });
      await assert.rejects(K.i.createPolicy(input), (error: unknown) => {
        assert.ok(error instanceof K.i.PolicyNumberCollisionError);
        assert.equal(error.match?.recommendedAction, "RESTORE_ARCHIVED");
        assert.equal(error.match?.policyRecordStatus, "archived");
        return true;
      });
      assert.equal((await K.i.checkPolicyNumber(held.insurerOrganizationId, held.view.terms[0].term.numberDisplay)).holder?.recommendedAction, "RESTORE_ARCHIVED");
      assert.equal(await policyRows(other), 0);
    });

    scenario("the same policy may repeat its number on every term; a corrected term releases its number", async () => {
      await fullStaff();
      const a = await policy();
      const number = a.view.terms[0].term.numberDisplay;
      const renewed = await K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()] });
      assert.deepEqual(renewed.terms.map((t) => t.term.numberDisplay), [number, number], "the number carries over when not given");
      const renewedExplicit = await K.i.renewPolicy({ policyId: a.policyId, policyNumber: number.toLowerCase(), termStart: "2025-01-01", termEnd: "2026-01-01", coverages: [AL()] });
      assert.equal(renewedExplicit.terms.length, 3);
      // another policy of the insurer is still refused
      await collision(K.i.createPolicy({ organizationId: await org("Other"), insurerOrganizationId: a.insurerOrganizationId, family: "INSURANCE", policyNumber: number, termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] }));
      // correct EVERY term to a new number: the old number is free again
      const newNumber = num("NEW");
      let view = renewedExplicit;
      for (const term of view.terms.map((t) => t.term).filter((t) => t.recordStatus === "active")) {
        view = await K.i.correctTerm({ termId: view.terms.find((t) => t.term.termStart === term.termStart && t.term.recordStatus === "active")!.term.id, policyNumber: newNumber });
      }
      assert.equal(view.terms.filter((t) => t.term.recordStatus === "active" && t.term.numberDisplay === newNumber).length, 3);
      const reused = await K.i.createPolicy({ organizationId: await org("Other2"), insurerOrganizationId: a.insurerOrganizationId, family: "INSURANCE", policyNumber: number, termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] });
      assert.equal(reused.terms[0].term.numberDisplay, number);
      // ... while the corrected terms still hold their wrong number as history (flagged), which no longer blocks anyone
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1 AND record_status = 'corrected' AND number_normalized = $2`, [a.policyId, a.view.terms[0].term.numberNormalized]), 3);
    });
  });

  // =============================================================================================================
  describe("renewal as a new term of the same policy", () => {
    scenario("a renewal is a new term; the previous term and its coverages stay history; reads are as-of", async () => {
      const actor = await fullStaff();
      const a = await policy();
      const view = await K.i.renewPolicy({ policyId: a.policyId, policyNumber: num("RENEWED"), termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL({ limitAmount: "2000000" }), GL()] });
      assert.equal(view.terms.length, 2);
      const [first, second] = view.terms;
      assert.deepEqual([first.term.termReason, second.term.termReason], ["INITIAL", "RENEWAL"]);
      assert.deepEqual([first.term.recordStatus, second.term.recordStatus], ["active", "active"]);
      assert.notEqual(first.term.numberNormalized, second.term.numberNormalized, "the number may change on renewal");
      assert.deepEqual(second.coverages.map((c) => [c.coverageType, c.limitAmount, c.effectiveFrom]).sort(), [["AUTO_LIABILITY", "2000000.00", "2024-01-01"], ["GENERAL_LIABILITY", "2000000.00", "2024-01-01"]]);
      assert.equal(view.current.latestTerm?.id, second.term.id);
      const read = async (asOf: string) => (await K.i.getOrganizationInsurance(a.organizationId, { asOf })).policies[0];
      let at = await read("2023-06-01");
      assert.equal(at.asOf.inForce, true);
      assert.equal(at.asOf.term?.id, first.term.id);
      assert.deepEqual(at.asOf.coverages.map((c) => c.coverageType).sort(), ["AUTO_LIABILITY", "MOTOR_TRUCK_CARGO"]);
      at = await read("2023-12-31");
      assert.equal(at.asOf.term?.id, first.term.id);
      at = await read("2024-01-01");
      assert.equal(at.asOf.term?.id, second.term.id, "the new term starts the day the old one expires");
      assert.deepEqual(at.asOf.coverages.map((c) => c.coverageType).sort(), ["AUTO_LIABILITY", "GENERAL_LIABILITY"]);
      at = await read("2025-01-01");
      assert.equal(at.asOf.inForce, false);
      assert.deepEqual([at.asOf.term, at.asOf.coverages], [null, []]);
      at = await read("2022-12-31");
      assert.equal(at.asOf.inForce, false);
      assert.deepEqual(at.terms.map((t) => t.state), ["NOT_STARTED", "NOT_STARTED"]);
      assert.deepEqual((await read("2024-06-01")).terms.map((t) => t.state), ["EXPIRED", "IN_FORCE"]);
      assert.deepEqual((await eventTypes(actor.actorId)).filter((t) => t !== "RECORD_CREATED"), []);
    });

    scenario("terms of a policy never overlap: a renewal starts when the previous term ended, a gap is allowed", async () => {
      await fullStaff();
      const a = await policy();
      const renew = (over: Record<string, unknown>) => K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()], ...over });
      for (const termStart of ["2023-12-31", "2023-06-01", "2023-01-01", "2022-01-01"]) await invalid(renew({ termStart, termEnd: "2025-01-01" }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1`, [a.policyId]), 1);
      const gap = await renew({ termStart: "2024-03-01", termEnd: "2025-03-01" });
      assert.equal(gap.terms.length, 2);
      assert.equal((await K.i.getOrganizationInsurance(a.organizationId, { asOf: "2024-02-15" })).policies[0].asOf.inForce, false, "a gap in cover is a real gap");
      await invalid(renew({ termStart: "2025-02-01", termEnd: "2026-01-01" }));
      await invalid(renew({ termStart: "2025-03-01", termEnd: "2025-03-01" }));
      await invalid(renew({ termStart: "2025-03-01", termEnd: undefined }));
      await invalid(renew({ termStart: "2025-03-01", coverages: [] }));
      await invalid(renew({ termStart: "2025-03-01", coverages: [{ coverageType: "BOND_CUSTOMS", limitAmount: "1", currency: "CAD" }] }));
      await invalid(renew({ termStart: "2025-03-01", policyNumber: "###" }));
      await invalid(renew({ termStart: "2025-03-01", extra: 1 }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1`, [a.policyId]), 2);
    });

    scenario("a cancelled term can be followed from its cancellation date; a continuous bond must be cancelled first", async () => {
      await fullStaff();
      const a = await policy();
      await K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-06-01", reason: "REPLACED_BY_NEW_POLICY" });
      await invalid(K.i.renewPolicy({ policyId: a.policyId, termStart: "2023-05-31", termEnd: "2024-06-01", coverages: [AL()] }));
      const view = await K.i.renewPolicy({ policyId: a.policyId, termStart: "2023-06-01", termEnd: "2024-06-01", coverages: [AL()] });
      assert.deepEqual(view.terms.map((t) => t.state), ["CANCELLED", "EXPIRED"]);
      const at = await K.i.getOrganizationInsurance(a.organizationId, { asOf: "2023-06-01" });
      assert.equal(at.policies[0].asOf.term?.id, view.terms[1].term.id, "from the cancellation date the replacement term is the one in force");

      const insured = await org("Insured");
      const surety = await org("Surety");
      const bond = await K.i.createPolicy({ organizationId: insured, insurerOrganizationId: surety, family: "BOND", policyNumber: num("BND"), termStart: "2022-01-01", coverages: [BOND()] });
      await stateError(K.i.renewPolicy({ policyId: bond.policy.id, termStart: "2023-01-01", coverages: [BOND()] }));
      await K.i.cancelTerm({ termId: bond.terms[0].term.id, cancelledOn: "2023-01-01", reason: "INSURER_CANCELLATION" });
      const renewed = await K.i.renewPolicy({ policyId: bond.policy.id, termStart: "2023-01-01", coverages: [BOND({ limitAmount: "100000" })] });
      assert.deepEqual(renewed.terms.map((t) => t.state), ["CANCELLED", "IN_FORCE"]);
    });

    scenario("an archived or missing policy, or an inactive insurer, refuses a renewal", async () => {
      await fullStaff();
      const a = await policy();
      await notFound(K.i.renewPolicy({ policyId: randomUUID(), termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()] }));
      await K.i.archivePolicy({ policyId: a.policyId });
      await stateError(K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()] }));
      await K.i.restorePolicy({ policyId: a.policyId });
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [a.insurerOrganizationId]);
      await stateError(K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()] }));
      await pools.admin.query(`UPDATE public.organizations SET status = 'active', archived_at = NULL WHERE id = $1`, [a.insurerOrganizationId]);
      assert.equal((await K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()] })).terms.length, 2);
    });
  });

  // =============================================================================================================
  describe("cancellation (one-way fact on a term)", () => {
    scenario("records the date and a controlled reason; in force is derived; later facts follow the cancellation", async () => {
      const actor = await fullStaff();
      const a = await policy();
      const view = await K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-06-15", reason: "NON_PAYMENT" });
      const term = view.terms[0].term;
      assert.deepEqual([term.cancelledOn, term.cancellationReason, term.termEnd, term.recordStatus], ["2023-06-15", "NON_PAYMENT", "2024-01-01", "active"]);
      const read = async (asOf: string) => (await K.i.getOrganizationInsurance(a.organizationId, { asOf })).policies[0];
      assert.deepEqual([(await read("2023-06-14")).asOf.inForce, (await read("2023-06-14")).terms[0].state], [true, "IN_FORCE"]);
      assert.deepEqual([(await read("2023-06-15")).asOf.inForce, (await read("2023-06-15")).terms[0].state], [false, "CANCELLED"]);
      assert.deepEqual((await read("2023-06-15")).asOf.coverages, [], "no coverage is in force after the cancellation");
      assert.deepEqual((await eventTypes(actor.actorId)).slice(-1), ["RECORD_STATUS_CHANGED"]);
      // an endorsement may not be dated after the cancellation; the cancellation date itself is still inside
      await invalid(K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-06-16", coverage: GL() }));
      assert.equal((await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-06-15", coverage: GL() })).terms[0].coverages.length, 3);
      // cancelling is one-way
      await stateError(K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-07-01", reason: "INSURED_REQUEST" }));
      assert.equal((await pools.admin.query<{ c: string }>(`SELECT cancelled_on::text AS c FROM public.insurance_policy_terms WHERE id = $1`, [a.termId])).rows[0].c, "2023-06-15");
    });

    scenario("the date must fall inside the term, not be in the future and not precede an endorsement; the reason is controlled", async () => {
      await fullStaff();
      const a = await policy();
      const cancel = (over: Record<string, unknown>) => K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-06-01", reason: "INSURED_REQUEST", ...over });
      for (const bad of [{ cancelledOn: "2022-12-31" }, { cancelledOn: "2024-01-02" }, { cancelledOn: "2023-02-30" }, { cancelledOn: undefined }, { reason: "OTHER" }, { reason: "non_payment" }, { reason: undefined }, { reason: "Because" }, { extra: 1 }, { termId: "x" }]) {
        await assert.rejects(cancel(bad), (error: unknown) => error instanceof K.i.InsuranceValidationError, JSON.stringify(bad));
      }
      await notFound(cancel({ termId: randomUUID() }));
      // the future cannot be cancelled retroactively into existence
      const future = await policy({ termStart: "2025-01-01", termEnd: "2999-01-01" });
      await invalid(K.i.cancelTerm({ termId: future.termId, cancelledOn: "2998-01-01", reason: "INSURED_REQUEST" }));
      await invalid(K.i.cancelTerm({ termId: future.termId, cancelledOn: "2024-12-31", reason: "INSURED_REQUEST" }));
      // an endorsement dated after the proposed cancellation blocks it
      await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-08-01", coverage: GL() });
      await invalid(cancel({ cancelledOn: "2023-07-31" }));
      assert.equal((await K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-08-01", reason: "INSURER_CANCELLATION" })).terms[0].term.cancelledOn, "2023-08-01");
      // the stated end date is a valid cancellation date for a bond / policy cancelled at expiry
      const b = await policy();
      assert.equal((await K.i.cancelTerm({ termId: b.termId, cancelledOn: "2024-01-01", reason: "INSURED_REQUEST" })).terms[0].term.cancelledOn, "2024-01-01");
    });
  });

  // =============================================================================================================
  describe("endorsements and the coverage timeline", () => {
    scenario("added / changed / removed coverage ends the old row, starts the new state and keeps both as history", async () => {
      await fullStaff();
      const a = await policy();
      const read = async (asOf?: string) => (await K.i.getOrganizationInsurance(a.organizationId, asOf ? { asOf } : undefined)).policies[0];
      const rowsOf = async (type: string) => coverageOf(await read(), type).map((c) => [c.limitAmount, c.effectiveFrom, c.effectiveTo, c.recordStatus]);

      let view = await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-04-01", endorsementNumber: "End-001", coverage: AL({ limitAmount: "2000000" }) });
      assert.deepEqual(await rowsOf("AUTO_LIABILITY"), [["1000000.00", "2023-01-01", "2023-04-01", "active"], ["2000000.00", "2023-04-01", null, "active"]]);
      const endorsement = view.terms[0].endorsements[0];
      assert.deepEqual([endorsement.kind, endorsement.effectiveOn, endorsement.numberDisplay, endorsement.numberNormalized, endorsement.recordStatus], ["COVERAGE_CHANGED", "2023-04-01", "End-001", "END001", "active"]);
      const [ended, started] = coverageOf(await read(), "AUTO_LIABILITY");
      assert.equal(ended.endedByEndorsementId, endorsement.id);
      assert.equal(started.endorsementId, endorsement.id);
      assert.equal(ended.endorsementId, null);

      view = await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-05-01", coverage: GL() });
      assert.deepEqual(await rowsOf("GENERAL_LIABILITY"), [["2000000.00", "2023-05-01", null, "active"]]);
      view = await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_REMOVED", effectiveOn: "2023-06-01", coverage: { coverageType: "MOTOR_TRUCK_CARGO" } });
      assert.deepEqual(await rowsOf("MOTOR_TRUCK_CARGO"), [["100000.00", "2023-01-01", "2023-06-01", "active"]]);
      // a removed coverage can come back, as a new row after the removal
      view = await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-08-01", coverage: CARGO({ limitAmount: "250000" }) });
      assert.deepEqual(await rowsOf("MOTOR_TRUCK_CARGO"), [["100000.00", "2023-01-01", "2023-06-01", "active"], ["250000.00", "2023-08-01", null, "active"]]);
      assert.equal(view.terms[0].endorsements.length, 4);

      const types = async (asOf: string) => (await read(asOf)).asOf.coverages.map((c) => `${c.coverageType}:${c.limitAmount}`).sort();
      assert.deepEqual(await types("2023-03-31"), ["AUTO_LIABILITY:1000000.00", "MOTOR_TRUCK_CARGO:100000.00"]);
      assert.deepEqual(await types("2023-04-01"), ["AUTO_LIABILITY:2000000.00", "MOTOR_TRUCK_CARGO:100000.00"]);
      assert.deepEqual(await types("2023-05-01"), ["AUTO_LIABILITY:2000000.00", "GENERAL_LIABILITY:2000000.00", "MOTOR_TRUCK_CARGO:100000.00"]);
      assert.deepEqual(await types("2023-06-01"), ["AUTO_LIABILITY:2000000.00", "GENERAL_LIABILITY:2000000.00"], "cargo is off cover between removal and re-adding");
      assert.deepEqual(await types("2023-08-01"), ["AUTO_LIABILITY:2000000.00", "GENERAL_LIABILITY:2000000.00", "MOTOR_TRUCK_CARGO:250000.00"]);
      assert.deepEqual(await types("2024-01-01"), [], "everything lapses with the term");
      // exactly one open row per type, and the timeline of each type is contiguous or gapped, never overlapping
      await assertTimelines(a.termId);
    });

    scenario("refusals: unchanged, out of order, not in force, already in force, outside the term, in the future, malformed", async () => {
      await fullStaff();
      const a = await policy();
      const add = (over: Record<string, unknown>) => K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-04-01", coverage: AL({ limitAmount: "2000000" }), ...over });
      await invalid(add({ coverage: AL() }));
      await invalid(add({ effectiveOn: "2023-01-01" }));
      await invalid(add({ effectiveOn: "2022-12-31" }));
      await invalid(add({ effectiveOn: "2024-01-01" }));
      await invalid(add({ effectiveOn: "2023-02-30" }));
      await invalid(add({ kind: "COVERAGE_RENEWED" }));
      await invalid(add({ kind: undefined }));
      await invalid(add({ coverage: undefined }));
      await invalid(add({ coverage: AL({ limitAmount: undefined }) }));
      await invalid(add({ coverage: AL({ coverageType: "BOND_CUSTOMS" }) }));
      await invalid(add({ coverage: { ...AL({ limitAmount: "2000000" }), extra: 1 } }));
      await invalid(add({ endorsementNumber: "###" }));
      await invalid(add({ extra: 1 }));
      await invalid(add({ kind: "COVERAGE_REMOVED", coverage: AL() }));
      await invalid(add({ kind: "COVERAGE_REMOVED", coverage: { coverageType: "NOPE" } }));
      await stateError(add({ coverage: GL() }));
      await stateError(add({ kind: "COVERAGE_REMOVED", coverage: { coverageType: "REEFER_BREAKDOWN" } }));
      await conflict(add({ kind: "COVERAGE_ADDED", coverage: AL({ limitAmount: "3000000" }) }));
      await notFound(add({ termId: randomUUID() }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_endorsements WHERE term_id = $1`, [a.termId]), 0, "no refused endorsement left a trace");
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_coverages WHERE term_id = $1`, [a.termId]), 2);

      // not in the future
      const future = await policy({ termStart: "2025-01-01", termEnd: "2999-01-01" });
      await invalid(K.i.addEndorsement({ termId: future.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2998-06-01", coverage: AL({ limitAmount: "9" }) }));

      // appended in order: after a later change, an earlier date is refused (the earlier endorsement is corrected instead)
      await add({ effectiveOn: "2023-06-01" });
      await invalid(add({ effectiveOn: "2023-05-01", coverage: AL({ limitAmount: "3000000" }) }));
      await invalid(add({ effectiveOn: "2023-06-01", coverage: AL({ limitAmount: "3000000" }) }));
      // a statutory account takes no limit and a bond no insurance coverage
      const board = await org("Board");
      const wc = await K.i.createPolicy({ organizationId: await org("Employer"), insurerOrganizationId: board, family: "WORKERS_COMPENSATION", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [WC] });
      await invalid(K.i.addEndorsement({ termId: wc.terms[0].term.id, kind: "COVERAGE_ADDED", effectiveOn: "2023-02-01", coverage: AL() }));
      await stateError(K.i.addEndorsement({ termId: wc.terms[0].term.id, kind: "COVERAGE_REMOVED", effectiveOn: "2023-02-01", coverage: { coverageType: "WORKERS_COMPENSATION" } }).then(() => K.i.addEndorsement({ termId: wc.terms[0].term.id, kind: "COVERAGE_REMOVED", effectiveOn: "2023-03-01", coverage: { coverageType: "WORKERS_COMPENSATION" } })));
    });

    scenario("endorsement numbers are unique within a term (normalized) and may repeat on another term", async () => {
      await fullStaff();
      const a = await policy();
      await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-02-01", endorsementNumber: "E-1", coverage: GL() });
      await conflict(K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-03-01", endorsementNumber: "e 1", coverage: AL({ limitAmount: "5000000" }) }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_endorsements WHERE term_id = $1`, [a.termId]), 1, "the refused endorsement left no row");
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_coverages WHERE term_id = $1 AND coverage_type = 'AUTO_LIABILITY' AND effective_to IS NOT NULL`, [a.termId]), 0, "and ended nothing");
      // unnumbered endorsements are many
      await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-03-01", coverage: AL({ limitAmount: "5000000" }) });
      await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-04-01", coverage: AL({ limitAmount: "6000000" }) });
      const renewed = await K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()] });
      const second = renewed.terms[1].term.id;
      const view = await K.i.addEndorsement({ termId: second, kind: "COVERAGE_ADDED", effectiveOn: "2024-02-01", endorsementNumber: "E-1", coverage: GL() });
      assert.equal(view.terms[1].endorsements[0].numberNormalized, "E1");
    });
  });

  // =============================================================================================================
  describe("correcting a term (the wrong term is kept, flagged and frozen)", () => {
    scenario("a corrected number replaces the term; coverages and endorsements are carried; the wrong term and its rows stay as history", async () => {
      const actor = await fullStaff();
      const a = await rich();
      const wrongNumber = a.view.terms[0].term.numberNormalized;
      const newNumber = num("FIX");
      const view = await K.i.correctTerm({ termId: a.termId, policyNumber: newNumber });
      assert.equal(view.terms.length, 2);
      const old = view.terms.find((t) => t.term.id === a.termId)!;
      const fresh = view.terms.find((t) => t.term.id !== a.termId)!;
      assert.deepEqual([old.term.recordStatus, old.state, old.term.supersededById], ["corrected", "CORRECTED", fresh.term.id]);
      assert.ok(old.term.correctedAt);
      assert.equal(old.term.numberNormalized, wrongNumber, "the wrong number is preserved");
      assert.deepEqual([fresh.term.recordStatus, fresh.term.termReason, fresh.term.policyId, fresh.term.numberDisplay, fresh.term.termStart, fresh.term.termEnd], ["active", "CORRECTION", a.policyId, newNumber, "2023-01-01", "2024-01-01"]);
      assert.deepEqual([fresh.term.correctedAt, fresh.term.supersededById], [null, null]);
      // endorsements and every genuine coverage row were carried, with pointers remapped inside the new term
      assert.deepEqual(fresh.endorsements.map((e) => [e.kind, e.effectiveOn, e.numberNormalized]), [["COVERAGE_CHANGED", "2023-04-01", "E1"], ["COVERAGE_REMOVED", "2023-06-01", "E2"]]);
      const changed = fresh.endorsements[0];
      const removed = fresh.endorsements[1];
      const al = fresh.coverages.filter((c) => c.coverageType === "AUTO_LIABILITY");
      assert.deepEqual(al.map((c) => [c.limitAmount, c.effectiveFrom, c.effectiveTo, c.endorsementId, c.endedByEndorsementId]), [
        ["1000000.00", "2023-01-01", "2023-04-01", null, changed.id],
        ["2000000.00", "2023-04-01", null, changed.id, null],
      ]);
      const cargo = fresh.coverages.filter((c) => c.coverageType === "MOTOR_TRUCK_CARGO");
      assert.deepEqual(cargo.map((c) => [c.effectiveTo, c.endedByEndorsementId]), [["2023-06-01", removed.id]]);
      assert.ok(fresh.coverages.every((c) => c.termId === fresh.term.id && c.recordStatus === "active"));
      // the old term keeps its endorsements and coverage rows, untouched
      assert.equal(old.endorsements.length, 2);
      assert.equal(old.coverages.length, 3);
      assert.ok(old.endorsements.every((e) => e.termId === a.termId && e.recordStatus === "active"));
      assert.ok(old.coverages.every((c) => c.termId === a.termId));
      // reads count the genuine term only: its coverages, not the corrected term's
      const mid = await readPolicy(a.organizationId, "2023-05-01");
      assert.equal(mid.asOf.term?.id, fresh.term.id);
      assert.deepEqual(mid.asOf.coverages.map((c) => `${c.coverageType}:${c.limitAmount}:${c.termId === fresh.term.id}`).sort(), ["AUTO_LIABILITY:2000000.00:true", "MOTOR_TRUCK_CARGO:100000.00:true"]);
      assert.equal(mid.current.latestTerm?.id, fresh.term.id);
      // the corrected number is the one registered; the wrong one is no longer held
      assert.equal((await K.i.checkPolicyNumber(a.insurerOrganizationId, newNumber)).holder?.termId, fresh.term.id);
      assert.equal((await K.i.checkPolicyNumber(a.insurerOrganizationId, wrongNumber)).registered, false);
      assert.deepEqual((await eventTypes(actor.actorId)).filter((t) => t === "RECORD_CORRECTED").length, 1 + 2 + 3);
      await assertTimelines(fresh.term.id);
    });

    scenario("corrected dates move the term start with the coverage that began with it; endorsement dates must still fit", async () => {
      await fullStaff();
      const a = await rich();
      const view = await K.i.correctTerm({ termId: a.termId, termStart: "2022-12-01", termEnd: "2023-12-31" });
      const fresh = view.terms.find((t) => t.term.id !== a.termId)!;
      assert.deepEqual([fresh.term.termStart, fresh.term.termEnd], ["2022-12-01", "2023-12-31"]);
      assert.deepEqual(fresh.coverages.map((c) => [c.coverageType, c.effectiveFrom, c.effectiveTo]).sort(), [
        ["AUTO_LIABILITY", "2022-12-01", "2023-04-01"],
        ["AUTO_LIABILITY", "2023-04-01", null],
        ["MOTOR_TRUCK_CARGO", "2022-12-01", "2023-06-01"],
      ]);
      assert.deepEqual(fresh.endorsements.map((e) => e.effectiveOn), ["2023-04-01", "2023-06-01"], "endorsement dates never move");
      // a second correction of the replacement works the same way
      const again = await K.i.correctTerm({ termId: fresh.term.id, termEnd: "2024-02-01" });
      assert.equal(again.terms.filter((t) => t.term.recordStatus === "active").length, 1);
      assert.equal(again.terms.filter((t) => t.term.recordStatus === "corrected").length, 2);
      const active = again.terms.find((t) => t.term.recordStatus === "active")!;
      assert.deepEqual([active.term.termStart, active.term.termEnd], ["2022-12-01", "2024-02-01"]);
      assert.equal(active.coverages.length, 3);
      await assertTimelines(active.term.id);
      // a start after an endorsement, or an end at or before one, would leave it outside the term
      await invalid(K.i.correctTerm({ termId: active.term.id, termStart: "2023-05-01" }));
      await invalid(K.i.correctTerm({ termId: active.term.id, termEnd: "2023-06-01" }));
      await invalid(K.i.correctTerm({ termId: active.term.id, termEnd: "2023-04-01" }));
      await invalid(K.i.correctTerm({ termId: active.term.id, termEnd: null }));
      await invalid(K.i.correctTerm({ termId: active.term.id, termStart: "2024-03-01" }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1`, [a.policyId]), 3, "refused corrections left nothing behind");
    });

    scenario("a correction that would make terms overlap, or changes nothing, is refused and rolled back", async () => {
      await fullStaff();
      const a = await policy();
      const renewed = await K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()] });
      const second = renewed.terms[1].term.id;
      await invalid(K.i.correctTerm({ termId: second, termStart: "2023-06-01" }));
      await invalid(K.i.correctTerm({ termId: a.termId, termEnd: "2024-06-01" }));
      await invalid(K.i.correctTerm({ termId: second, policyNumber: renewed.terms[1].term.numberDisplay }));
      await invalid(K.i.correctTerm({ termId: second }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1 AND record_status = 'corrected'`, [a.policyId]), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_coverages WHERE policy_id = $1`, [a.policyId]), 3);
    });

    scenario("a wrongly recorded cancellation is corrected like any other term fact", async () => {
      await fullStaff();
      const a = await policy();
      await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-05-01", coverage: GL() });
      await K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-09-01", reason: "NON_PAYMENT" });
      assert.equal((await readPolicy(a.organizationId, "2023-10-01")).asOf.inForce, false);
      // correct the date and the reason
      let view = await K.i.correctTerm({ termId: a.termId, cancellation: { cancelledOn: "2023-10-15", reason: "INSURED_REQUEST" } });
      let active = view.terms.find((t) => t.term.recordStatus === "active")!;
      assert.deepEqual([active.term.cancelledOn, active.term.cancellationReason], ["2023-10-15", "INSURED_REQUEST"]);
      assert.equal(view.terms.find((t) => t.term.id === a.termId)!.term.cancelledOn, "2023-09-01", "the wrong cancellation is preserved");
      assert.equal((await readPolicy(a.organizationId, "2023-10-01")).asOf.inForce, true);
      // never cancelled at all
      view = await K.i.correctTerm({ termId: active.term.id, cancellation: null });
      active = view.terms.find((t) => t.term.recordStatus === "active")!;
      assert.deepEqual([active.term.cancelledOn, active.term.cancellationReason, active.state], [null, null, "EXPIRED"]);
      assert.equal((await readPolicy(a.organizationId, "2023-12-01")).asOf.inForce, true);
      // a cancellation is validated like the original fact
      await invalid(K.i.correctTerm({ termId: active.term.id, cancellation: { cancelledOn: "2023-04-30", reason: "NON_PAYMENT" } }));
      await invalid(K.i.correctTerm({ termId: active.term.id, cancellation: { cancelledOn: "2024-01-02", reason: "NON_PAYMENT" } }));
      await invalid(K.i.correctTerm({ termId: active.term.id, cancellation: { cancelledOn: "2023-10-01", reason: "OTHER" } }));
      await invalid(K.i.correctTerm({ termId: active.term.id, cancellation: { cancelledOn: "2023-10-01" } }));
      await invalid(K.i.correctTerm({ termId: active.term.id, cancellation: { cancelledOn: "2023-10-01", reason: "NON_PAYMENT", extra: 1 } }));
      await invalid(K.i.correctTerm({ termId: active.term.id, cancellation: null }));
    });

    scenario("refusals: a corrected term is frozen, a held number collides and rolls back, a missing or archived record is refused", async () => {
      await fullStaff();
      const a = await policy();
      const other = await policy({ insurer: a.insurerOrganizationId });
      const heldNumber = other.view.terms[0].term.numberDisplay;
      await collision(K.i.correctTerm({ termId: a.termId, policyNumber: heldNumber.toLowerCase() }));
      assert.equal((await pools.admin.query<{ record_status: string }>(`SELECT record_status FROM public.insurance_policy_terms WHERE id = $1`, [a.termId])).rows[0].record_status, "active", "the collision rolled the flagging back");
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1`, [a.policyId]), 1);
      const view = await K.i.correctTerm({ termId: a.termId, policyNumber: num("OK") });
      await stateError(K.i.correctTerm({ termId: a.termId, policyNumber: num("AGAIN") }));
      await notFound(K.i.correctTerm({ termId: randomUUID(), policyNumber: num() }));
      await invalid(K.i.correctTerm({ termId: a.termId, extra: 1 }));
      await invalid(K.i.correctTerm({ termId: "nope" }));
      const fresh = view.terms.find((t) => t.term.recordStatus === "active")!.term.id;
      await K.i.archivePolicy({ policyId: a.policyId });
      await stateError(K.i.correctTerm({ termId: fresh, policyNumber: num() }));
      await K.i.restorePolicy({ policyId: a.policyId });
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [a.insurerOrganizationId]);
      await stateError(K.i.correctTerm({ termId: fresh, policyNumber: num() }));
    });
  });

  // =============================================================================================================
  describe("correcting a coverage row", () => {
    scenario("the wrong row is kept and flagged; the replacement keeps the same term, dates and endorsement links", async () => {
      const actor = await fullStaff();
      const a = await rich();
      const [first, second] = await activeRows(a.termId, "AUTO_LIABILITY");
      // the CURRENT state (open) was keyed wrongly
      const view = await K.i.correctCoverage({ coverageId: second.id, limitAmount: "2500000", deductibleAmount: "5000" });
      const rows = view.terms[0].coverages.filter((c) => c.coverageType === "AUTO_LIABILITY");
      assert.equal(rows.length, 3);
      const wrong = rows.find((c) => c.id === second.id)!;
      const replacement = rows.find((c) => c.recordStatus === "active" && c.effectiveTo === null)!;
      assert.deepEqual([wrong.recordStatus, wrong.supersededById, wrong.limitAmount], ["corrected", replacement.id, "2000000.00"]);
      assert.ok(wrong.correctedAt);
      assert.equal(wrong.effectiveTo, null, "a correction never ends the wrong row");
      assert.deepEqual(
        [replacement.limitAmount, replacement.deductibleAmount, replacement.currency, replacement.limitBasis, replacement.effectiveFrom, replacement.termId, replacement.endorsementId],
        ["2500000.00", "5000.00", "CAD", "COMBINED_SINGLE_LIMIT", "2023-04-01", a.termId, second.endorsement_id],
      );
      assert.equal(rows.find((c) => c.id === first.id)!.recordStatus, "active", "the earlier real state is untouched");
      assert.equal((await readPolicy(a.organizationId, "2023-05-01")).asOf.coverages.find((c) => c.coverageType === "AUTO_LIABILITY")?.limitAmount, "2500000.00");
      assert.equal((await eventTypes(actor.actorId)).at(-1), "RECORD_CORRECTED");
      await assertTimelines(a.termId);
    });

    scenario("a coverage that ended the term's history can be corrected too: the replacement ends the same way", async () => {
      await fullStaff();
      const a = await rich();
      const [cargo] = await activeRows(a.termId, "MOTOR_TRUCK_CARGO");
      assert.equal(cargo.effective_to, "2023-06-01");
      const view = await K.i.correctCoverage({ coverageId: cargo.id, limitAmount: 150000, limitBasis: "PER_OCCURRENCE", scheduledVehiclesOnly: true });
      const replacement = view.terms[0].coverages.find((c) => c.coverageType === "MOTOR_TRUCK_CARGO" && c.recordStatus === "active")!;
      assert.deepEqual(
        [replacement.limitAmount, replacement.limitBasis, replacement.scheduledVehiclesOnly, replacement.effectiveFrom, replacement.effectiveTo, replacement.endedByEndorsementId],
        ["150000.00", "PER_OCCURRENCE", true, "2023-01-01", "2023-06-01", cargo.ended_by_endorsement_id],
      );
      assert.equal(view.terms[0].coverages.find((c) => c.id === cargo.id)!.endedByEndorsementId, cargo.ended_by_endorsement_id, "the wrong row keeps its end");
      await assertTimelines(a.termId);
    });

    scenario("a coverage type, an amount, a currency and a basis are corrected under the same rules as a new coverage", async () => {
      await fullStaff();
      const a = await policy();
      const [al] = await activeRows(a.termId, "AUTO_LIABILITY");
      const [cargo] = await activeRows(a.termId, "MOTOR_TRUCK_CARGO");
      await invalid(K.i.correctCoverage({ coverageId: al.id }));
      await invalid(K.i.correctCoverage({ coverageId: al.id, limitAmount: "1000000" }), );
      await invalid(K.i.correctCoverage({ coverageId: al.id, limitAmount: null }));
      await invalid(K.i.correctCoverage({ coverageId: al.id, currency: null }));
      await invalid(K.i.correctCoverage({ coverageId: al.id, currency: "EUR" }));
      await invalid(K.i.correctCoverage({ coverageId: al.id, limitBasis: "PENAL_SUM" }));
      await invalid(K.i.correctCoverage({ coverageId: al.id, coverageType: "WORKERS_COMPENSATION" }));
      await invalid(K.i.correctCoverage({ coverageId: al.id, coverageType: "NOPE" }));
      await invalid(K.i.correctCoverage({ coverageId: al.id, limitAmount: "0" }));
      await invalid(K.i.correctCoverage({ coverageId: al.id, unexpected: 1 }));
      await invalid(K.i.correctCoverage({ coverageId: "nope", limitAmount: "5" }));
      await conflict(K.i.correctCoverage({ coverageId: al.id, coverageType: "MOTOR_TRUCK_CARGO" }));
      await notFound(K.i.correctCoverage({ coverageId: randomUUID(), limitAmount: "5" }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_coverages WHERE term_id = $1`, [a.termId]), 2, "no refused correction left a trace");
      // the type itself can be corrected when the target type is free
      const view = await K.i.correctCoverage({ coverageId: cargo.id, coverageType: "PHYSICAL_DAMAGE" });
      assert.deepEqual(view.terms[0].coverages.filter((c) => c.recordStatus === "active").map((c) => c.coverageType).sort(), ["AUTO_LIABILITY", "PHYSICAL_DAMAGE"]);
      assert.equal(view.terms[0].coverages.find((c) => c.id === cargo.id)!.coverageType, "MOTOR_TRUCK_CARGO", "the wrong type is preserved");
      // clearing the deductible clears nothing else; clearing the limit basis is explicit
      const cleared = await K.i.correctCoverage({ coverageId: (await activeRows(a.termId, "PHYSICAL_DAMAGE"))[0].id, deductibleAmount: null, limitBasis: null });
      const row = cleared.terms[0].coverages.find((c) => c.coverageType === "PHYSICAL_DAMAGE" && c.recordStatus === "active")!;
      assert.deepEqual([row.deductibleAmount, row.limitBasis, row.limitAmount, row.currency], [null, null, "100000.00", "CAD"]);
    });

    scenario("an earlier coverage state cannot be corrected in place while a later state of the same coverage is open; corrected rows are frozen", async () => {
      await fullStaff();
      const a = await rich();
      const [first, second] = await activeRows(a.termId, "AUTO_LIABILITY");
      await stateError(K.i.correctCoverage({ coverageId: first.id, limitAmount: "900000" }));
      const view = await K.i.correctCoverage({ coverageId: second.id, limitAmount: "2100000" });
      await stateError(K.i.correctCoverage({ coverageId: second.id, limitAmount: "2200000" }));
      assert.equal(view.terms[0].coverages.filter((c) => c.coverageType === "AUTO_LIABILITY" && c.recordStatus === "corrected").length, 1);
      // a coverage of a corrected term cannot be corrected: correct the term (or its replacement's rows)
      const termView = await K.i.correctTerm({ termId: a.termId, policyNumber: num("T") });
      await stateError(K.i.correctCoverage({ coverageId: first.id, limitAmount: "900000" }));
      const fresh = termView.terms.find((t) => t.term.recordStatus === "active")!;
      const [freshFirst] = fresh.coverages.filter((c) => c.coverageType === "AUTO_LIABILITY");
      await stateError(K.i.correctCoverage({ coverageId: freshFirst.id, limitAmount: "900000" }));
    });
  });

  // =============================================================================================================
  describe("correcting an endorsement", () => {
    scenario("a corrected CHANGED endorsement re-dates the ended and started coverage rows together; the timeline stays contiguous", async () => {
      await fullStaff();
      const a = await rich();
      const before = await activeRows(a.termId, "AUTO_LIABILITY");
      const view = await K.i.correctEndorsement({ endorsementId: a.changed.id, effectiveOn: "2023-04-15", limitAmount: "2500000" });
      const endorsements = view.terms[0].endorsements;
      const wrong = endorsements.find((e) => e.id === a.changed.id)!;
      const fresh = endorsements.find((e) => e.supersededById === null && e.kind === "COVERAGE_CHANGED")!;
      assert.deepEqual([wrong.recordStatus, wrong.supersededById, wrong.effectiveOn], ["corrected", fresh.id, "2023-04-01"]);
      assert.deepEqual([fresh.effectiveOn, fresh.numberNormalized, fresh.recordStatus], ["2023-04-15", "E1", "active"]);
      const rows = await activeRows(a.termId, "AUTO_LIABILITY");
      assert.deepEqual(rows.map((r) => [r.limit_amount, r.effective_from, r.effective_to, r.endorsement_id, r.ended_by_endorsement_id]), [
        ["1000000.00", "2023-01-01", "2023-04-15", null, fresh.id],
        ["2500000.00", "2023-04-15", null, fresh.id, null],
      ]);
      // the wrong rows are preserved, flagged and pointed at their replacements
      const flagged = view.terms[0].coverages.filter((c) => c.coverageType === "AUTO_LIABILITY" && c.recordStatus === "corrected");
      assert.deepEqual(flagged.map((c) => c.id).sort(), before.map((r) => r.id).sort());
      assert.deepEqual(flagged.map((c) => c.supersededById).sort(), rows.map((r) => r.id).sort());
      assert.deepEqual(flagged.map((c) => [c.effectiveFrom, c.effectiveTo]).sort(), [["2023-01-01", "2023-04-01"], ["2023-04-01", null]]);
      assert.equal((await readPolicy(a.organizationId, "2023-04-10")).asOf.coverages.find((c) => c.coverageType === "AUTO_LIABILITY")?.limitAmount, "1000000.00");
      assert.equal((await readPolicy(a.organizationId, "2023-04-15")).asOf.coverages.find((c) => c.coverageType === "AUTO_LIABILITY")?.limitAmount, "2500000.00");
      await assertTimelines(a.termId);
    });

    scenario("a removal and an addition are re-dated; the endorsement number is corrected or cleared", async () => {
      await fullStaff();
      const a = await rich();
      const added = await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-07-01", coverage: GL() });
      const glEndorsement = added.terms[0].endorsements.find((e) => e.kind === "COVERAGE_ADDED")!;
      let view = await K.i.correctEndorsement({ endorsementId: a.removed.id, effectiveOn: "2023-06-10", endorsementNumber: "E-2A" });
      assert.deepEqual((await activeRows(a.termId, "MOTOR_TRUCK_CARGO")).map((r) => [r.effective_from, r.effective_to]), [["2023-01-01", "2023-06-10"]]);
      assert.equal(view.terms[0].endorsements.find((e) => e.kind === "COVERAGE_REMOVED" && e.recordStatus === "active")!.numberNormalized, "E2A");
      view = await K.i.correctEndorsement({ endorsementId: glEndorsement.id, effectiveOn: "2023-07-05", deductibleAmount: "2500" });
      assert.deepEqual((await activeRows(a.termId, "GENERAL_LIABILITY")).map((r) => [r.effective_from, r.effective_to]), [["2023-07-05", null]]);
      assert.equal(view.terms[0].coverages.find((c) => c.coverageType === "GENERAL_LIABILITY" && c.recordStatus === "active")!.deductibleAmount, "2500.00");
      const numbered = view.terms[0].endorsements.find((e) => e.kind === "COVERAGE_REMOVED" && e.recordStatus === "active")!;
      const unnumbered = await K.i.correctEndorsement({ endorsementId: numbered.id, endorsementNumber: null });
      assert.equal(unnumbered.terms[0].endorsements.find((e) => e.kind === "COVERAGE_REMOVED" && e.recordStatus === "active")!.numberDisplay, null);
      await invalid(K.i.correctEndorsement({ endorsementId: unnumbered.terms[0].endorsements.find((e) => e.kind === "COVERAGE_REMOVED" && e.recordStatus === "active")!.id, endorsementNumber: null }));
      await assertTimelines(a.termId);
    });

    scenario("only the latest endorsement of a coverage can be corrected; dates must fit; nothing else about it can change", async () => {
      await fullStaff();
      const a = await rich();
      await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-07-01", coverage: AL({ limitAmount: "3000000" }) });
      await stateError(K.i.correctEndorsement({ endorsementId: a.changed.id, effectiveOn: "2023-04-10" }));
      // a cargo re-add after its removal builds on the removal
      await K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-08-01", coverage: CARGO() });
      await stateError(K.i.correctEndorsement({ endorsementId: a.removed.id, effectiveOn: "2023-06-10" }));
      const second = (await readPolicy(a.organizationId)).terms[0].endorsements.find((e) => e.effectiveOn === "2023-07-01")!;
      for (const bad of [{ effectiveOn: "2023-04-01" }, { effectiveOn: "2023-03-01" }, { effectiveOn: "2022-12-31" }, { effectiveOn: "2024-01-01" }, { effectiveOn: "2023-02-30" }, { kind: "COVERAGE_ADDED", effectiveOn: "2023-07-02" }, { coverageType: "GENERAL_LIABILITY", effectiveOn: "2023-07-02" }, {}, { endorsementNumber: "###" }]) {
        await assert.rejects(K.i.correctEndorsement({ endorsementId: second.id, ...bad }), (error: unknown) => error instanceof K.i.InsuranceError, JSON.stringify(bad));
      }
      await invalid(K.i.correctEndorsement({ endorsementId: second.id, effectiveOn: "2999-01-01" }));
      await invalid(K.i.correctEndorsement({ endorsementId: second.id, effectiveOn: "2023-07-01" }));
      await notFound(K.i.correctEndorsement({ endorsementId: randomUUID(), effectiveOn: "2023-07-02" }));
      // a removal carries no coverage content
      const removalLatest = await rich();
      await invalid(K.i.correctEndorsement({ endorsementId: removalLatest.removed.id, limitAmount: "5" }));
      const ok = await K.i.correctEndorsement({ endorsementId: second.id, effectiveOn: "2023-07-02" });
      await stateError(K.i.correctEndorsement({ endorsementId: second.id, effectiveOn: "2023-07-03" }));
      assert.equal(ok.terms[0].endorsements.filter((e) => e.recordStatus === "corrected").length, 1);
      await assertTimelines(a.termId);
    });
  });

  // =============================================================================================================
  describe("broker of record", () => {
    const T = (month: number, day = 1) => `2023-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`;
    const MICRO = (month: number, day = 1) => T(month, day).replace("Z", ".000000Z");

    scenario("a change ends the current period and starts the next at the same instant; reads are as-of; the contact comes from Contacts", async () => {
      const actor = await fullStaff();
      const first = await org("Broker one");
      const second = await org("Broker two");
      const p1 = await contact(first);
      const p2 = await contact(second);
      const a = await policy({ broker: { brokerOrganizationId: first, brokerPersonId: p1.personId, effectiveFrom: T(1) } });
      const view = await K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: second, brokerPersonId: p2.personId, effectiveFrom: T(6) });
      assert.equal(view.brokerPeriods.length, 2);
      const [one, two] = view.brokerPeriods;
      assert.deepEqual([one.brokerOrganizationId, one.effectiveFrom, one.effectiveTo, one.recordStatus], [first, MICRO(1), MICRO(6), "active"]);
      assert.deepEqual([two.brokerOrganizationId, two.brokerPersonId, two.brokerRelationshipId, two.effectiveFrom, two.effectiveTo], [second, p2.personId, p2.relationshipId, MICRO(6), null]);
      assert.equal(view.current.broker?.id, two.id);
      assert.equal((await readPolicy(a.organizationId, "2023-05-31")).asOf.broker?.id, one.id);
      assert.equal((await readPolicy(a.organizationId, "2023-06-01")).asOf.broker?.id, two.id, "the new broker is of record from the change date");
      assert.equal((await readPolicy(a.organizationId, "2022-12-31")).asOf.broker, null);
      // a change of contact inside the same firm is a change too
      const p3 = await contact(second);
      const view3 = await K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: second, brokerPersonId: p3.personId, effectiveFrom: T(8) });
      assert.deepEqual(view3.brokerPeriods.map((b) => b.effectiveTo === null), [false, false, true]);
      assert.equal(view3.brokerPeriods.filter((b) => b.recordStatus === "active" && b.effectiveTo === null).length, 1);
      assert.deepEqual((await eventTypes(actor.actorId)).slice(-2), ["RECORD_UPDATED", "RECORD_UPDATED"]);
    });

    scenario("the first broker of a policy without one is a plain creation; nothing earlier than the previous period is accepted", async () => {
      const actor = await fullStaff();
      const brokerage = await org("Brokerage");
      const a = await policy();
      assert.equal(a.view.brokerPeriods.length, 0);
      const view = await K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: brokerage, effectiveFrom: T(3) });
      assert.deepEqual(view.brokerPeriods.map((b) => [b.brokerPersonId, b.effectiveTo]), [[null, null]]);
      assert.equal((await eventTypes(actor.actorId)).at(-1), "RECORD_CREATED");
      const other = await org("Other brokerage");
      await invalid(K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: other, effectiveFrom: T(3) }));
      await invalid(K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: other, effectiveFrom: T(2) }));
      await invalid(K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: other, effectiveFrom: "2999-01-01T00:00:00Z" }));
      await invalid(K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: brokerage }), );
      await invalid(K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: other, effectiveFrom: "2023-03-04" }));
      await invalid(K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: other, extra: 1 }));
      await invalid(K.i.changeBroker({ policyId: a.policyId }));
      await notFound(K.i.changeBroker({ policyId: randomUUID(), brokerOrganizationId: other }));
      await notFound(K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: randomUUID() }));
      const archivedFirm = await org("Archived firm");
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archivedFirm]);
      await stateError(K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: archivedFirm, effectiveFrom: T(4) }));
      const stranger = await contact(other);
      await invalid(K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: brokerage, brokerPersonId: stranger.personId, effectiveFrom: T(4) }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_broker_periods WHERE policy_id = $1`, [a.policyId]), 1);
    });

    scenario("a broker correction keeps the wrong period flagged and inherits the window; an earlier period behind a current one is not corrected in place", async () => {
      await fullStaff();
      const first = await org("Broker one");
      const second = await org("Broker two");
      const third = await org("Broker three");
      const person = await contact(third);
      const a = await policy({ broker: { brokerOrganizationId: first, effectiveFrom: T(1) } });
      let view = await K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: second, effectiveFrom: T(5) });
      const [earlier, current] = view.brokerPeriods;
      // the CURRENT period was keyed with the wrong brokerage
      view = await K.i.correctBroker({ brokerPeriodId: current.id, brokerOrganizationId: third, brokerPersonId: person.personId });
      const wrong = view.brokerPeriods.find((b) => b.id === current.id)!;
      const fresh = view.brokerPeriods.find((b) => b.recordStatus === "active" && b.effectiveTo === null)!;
      assert.deepEqual([wrong.recordStatus, wrong.supersededById, wrong.brokerOrganizationId, wrong.effectiveTo], ["corrected", fresh.id, second, null]);
      assert.ok(wrong.correctedAt);
      assert.deepEqual([fresh.brokerOrganizationId, fresh.brokerPersonId, fresh.brokerRelationshipId, fresh.effectiveFrom], [third, person.personId, person.relationshipId, current.effectiveFrom]);
      assert.equal(view.current.broker?.id, fresh.id);
      assert.equal((await readPolicy(a.organizationId, "2023-06-01")).asOf.broker?.brokerOrganizationId, third);
      // changing the firm without naming a contact drops the contact (it belongs to the old firm)
      view = await K.i.correctBroker({ brokerPeriodId: fresh.id, brokerOrganizationId: second });
      assert.deepEqual([view.current.broker?.brokerOrganizationId, view.current.broker?.brokerPersonId], [second, null]);
      // the contact alone can be corrected, and cleared
      const secondContact = await contact(second);
      view = await K.i.correctBroker({ brokerPeriodId: view.current.broker!.id, brokerPersonId: secondContact.personId });
      assert.equal(view.current.broker?.brokerPersonId, secondContact.personId);
      view = await K.i.correctBroker({ brokerPeriodId: view.current.broker!.id, brokerPersonId: null });
      assert.equal(view.current.broker?.brokerPersonId, null);
      // refusals
      await stateError(K.i.correctBroker({ brokerPeriodId: earlier.id, brokerOrganizationId: third }));
      await stateError(K.i.correctBroker({ brokerPeriodId: current.id, brokerOrganizationId: third }));
      await invalid(K.i.correctBroker({ brokerPeriodId: view.current.broker!.id, brokerOrganizationId: second }));
      await invalid(K.i.correctBroker({ brokerPeriodId: view.current.broker!.id }));
      await invalid(K.i.correctBroker({ brokerPeriodId: view.current.broker!.id, brokerPersonId: person.personId }));
      await invalid(K.i.correctBroker({ brokerPeriodId: view.current.broker!.id, extra: 1 }));
      await notFound(K.i.correctBroker({ brokerPeriodId: randomUUID(), brokerOrganizationId: third }));
      await notFound(K.i.correctBroker({ brokerPeriodId: view.current.broker!.id, brokerOrganizationId: randomUUID() }));
      assert.equal(view.brokerPeriods.filter((b) => b.recordStatus === "active" && b.effectiveTo === null).length, 1);
    });
  });

  // =============================================================================================================
  describe("archive and restore (record lifecycle, not policy status)", () => {
    scenario("an archived policy refuses every change but stays readable; restoring returns it unchanged", async () => {
      const actor = await fullStaff();
      const brokerage = await org("Brokerage");
      const a = await rich({ broker: { brokerOrganizationId: await org("First broker"), effectiveFrom: "2023-01-01T00:00:00Z" } });
      const [al] = await activeRows(a.termId, "AUTO_LIABILITY");
      const archived = await K.i.archivePolicy({ policyId: a.policyId });
      assert.deepEqual([archived.policy.recordStatus, archived.terms[0].term.recordStatus, archived.terms[0].coverages.length], ["archived", "active", 3]);
      assert.ok(archived.policy.archivedAt);
      assert.equal((await eventTypes(actor.actorId)).at(-1), "RECORD_ARCHIVED");
      assert.equal((await readPolicy(a.organizationId)).policy.recordStatus, "archived");
      const calls: Array<[string, () => Promise<unknown>]> = [
        ["renew", () => K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()] })],
        ["cancel", () => K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-09-01", reason: "INSURED_REQUEST" })],
        ["endorse", () => K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-07-01", coverage: GL() })],
        ["correct term", () => K.i.correctTerm({ termId: a.termId, policyNumber: num() })],
        ["correct coverage", () => K.i.correctCoverage({ coverageId: al.id, limitAmount: "7" })],
        ["correct endorsement", () => K.i.correctEndorsement({ endorsementId: a.removed.id, effectiveOn: "2023-06-02" })],
        ["change broker", () => K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: brokerage })],
        ["correct broker", () => K.i.correctBroker({ brokerPeriodId: a.view.brokerPeriods[0]?.id ?? randomUUID(), brokerOrganizationId: brokerage })],
        ["archive again", () => K.i.archivePolicy({ policyId: a.policyId })],
      ];
      for (const [label, call] of calls) {
        await assert.rejects(call(), (error: unknown) => error instanceof K.i.InsuranceError && !(error instanceof K.i.InsuranceValidationError), label);
      }
      for (const [label, call] of calls.slice(0, 7)) await stateError(call()).catch((error) => { throw new Error(`${label}: ${String(error)}`) });
      const restored = await K.i.restorePolicy({ policyId: a.policyId });
      assert.deepEqual([restored.policy.recordStatus, restored.policy.archivedAt], ["active", null]);
      assert.equal(restored.terms[0].coverages.length, 3, "archiving changed no fact");
      await stateError(K.i.restorePolicy({ policyId: a.policyId }));
      await notFound(K.i.archivePolicy({ policyId: randomUUID() }));
      await invalid(K.i.archivePolicy({ policyId: a.policyId, extra: 1 }));
      await invalid(K.i.restorePolicy({ policyId: "x" }));
      assert.deepEqual((await eventTypes(actor.actorId)).filter((t) => t === "RECORD_ARCHIVED" || t === "RECORD_RESTORED"), ["RECORD_ARCHIVED", "RECORD_RESTORED"]);
    });

    scenario("an archived or merged insured Organization refuses every write, archive and restore included; reads still work", async () => {
      await fullStaff();
      const a = await rich();
      const survivor = await org("Survivor");
      for (const [status, change] of [
        ["archived", `UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`],
        ["merged", `UPDATE public.organizations SET status = 'merged', merged_into_organization_id = '${survivor}' WHERE id = $1`],
      ] as const) {
        await pools.admin.query(`UPDATE public.organizations SET status = 'active', archived_at = NULL, merged_into_organization_id = NULL WHERE id = $1`, [a.organizationId]);
        await pools.admin.query(change, [a.organizationId]);
        const [al] = await activeRows(a.termId, "AUTO_LIABILITY");
        const calls: Array<() => Promise<unknown>> = [
          () => K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL()] }),
          () => K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-09-01", reason: "INSURED_REQUEST" }),
          () => K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-07-01", coverage: GL() }),
          () => K.i.correctTerm({ termId: a.termId, policyNumber: num() }),
          () => K.i.correctCoverage({ coverageId: al.id, limitAmount: "7" }),
          () => K.i.correctEndorsement({ endorsementId: a.removed.id, effectiveOn: "2023-06-02" }),
          () => K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: survivor }),
          () => K.i.archivePolicy({ policyId: a.policyId }),
          () => K.i.restorePolicy({ policyId: a.policyId }),
          () => K.i.createPolicy({ organizationId: a.organizationId, insurerOrganizationId: a.insurerOrganizationId, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] }),
        ];
        for (const [index, call] of calls.entries()) await stateError(call()).catch((error) => { throw new Error(`${status} #${index}: ${String(error)}`) });
        assert.equal((await readPolicy(a.organizationId)).terms[0].coverages.length, 3, `${status}: reads still work`);
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1`, [a.policyId]), 1);
    });
  });

  // =============================================================================================================
  describe("reads", () => {
    scenario("one Organization's view never contains another's rows; unknown Organizations and bad input are refused", async () => {
      const actor = await fullStaff();
      const a = await policy();
      const b = await policy();
      const sharedInsurer = await org("Shared insurer");
      const c = await policy({ insurer: sharedInsurer });
      const d = await policy({ insurer: sharedInsurer });
      const view = await K.i.getOrganizationInsurance(a.organizationId);
      assert.equal(view.organizationId, a.organizationId);
      assert.deepEqual(view.policies.map((p) => p.policy.id), [a.policyId]);
      const json = JSON.stringify(view);
      for (const other of [b, c, d]) {
        assert.equal(json.includes(other.policyId), false);
        assert.equal(json.includes(other.view.terms[0].term.numberNormalized), false);
        assert.equal(json.includes(other.organizationId), false);
      }
      // the insurer's own view lists the policies it INSURES (as an insured), not the ones it issued
      assert.deepEqual((await K.i.getOrganizationInsurance(sharedInsurer)).policies, []);
      assert.deepEqual((await K.i.getOrganizationInsurance(c.organizationId)).policies.map((p) => p.policy.id), [c.policyId]);
      await notFound(K.i.getOrganizationInsurance(randomUUID()));
      await invalid(K.i.getOrganizationInsurance("not-a-uuid"));
      for (const bad of ["2023-02-30", "yesterday", "20230101", "2023-01-01T00:00:00Z", ""]) await invalid(K.i.getOrganizationInsurance(a.organizationId, { asOf: bad }));
      // an Organization with no insurance simply has none
      assert.deepEqual((await K.i.getOrganizationInsurance(await org("Empty"))).policies, []);
      // default as-of is the database date
      const today = (await pools.admin.query<{ d: string }>(`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS d`)).rows[0].d;
      assert.ok([today, view.asOfDate].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
      assert.equal((await K.i.getOrganizationInsurance(a.organizationId, { asOf: "2023-06-01" })).asOfDate, "2023-06-01");
      // reads and refused calls write nothing to the Master Register
      const count = (await eventTypes(actor.actorId)).length;
      await K.i.getOrganizationInsurance(a.organizationId);
      await K.i.checkPolicyNumber(a.insurerOrganizationId, a.view.terms[0].term.numberDisplay);
      await assert.rejects(K.i.createPolicy({ organizationId: a.organizationId }));
      await assert.rejects(K.i.cancelTerm({ termId: randomUUID(), cancelledOn: "2023-01-01", reason: "NON_PAYMENT" }));
      assert.equal((await eventTypes(actor.actorId)).length, count);
    });

    scenario("one Organization can hold several families and several policies at once; each is read on its own dates", async () => {
      await fullStaff();
      const insured = await org("Insured");
      const a = await policy({ insured });
      const board = await org("Board");
      const surety = await org("Surety");
      const wc = await K.i.createPolicy({ organizationId: insured, insurerOrganizationId: board, family: "WORKERS_COMPENSATION", policyNumber: num("WCB"), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [WC] });
      const bond = await K.i.createPolicy({ organizationId: insured, insurerOrganizationId: surety, family: "BOND", policyNumber: num("BND"), termStart: "2022-01-01", coverages: [BOND()] });
      const view = await K.i.getOrganizationInsurance(insured, { asOf: "2023-06-01" });
      assert.equal(view.policies.length, 3);
      assert.deepEqual(view.policies.map((p) => p.policy.family).sort(), ["BOND", "INSURANCE", "WORKERS_COMPENSATION"]);
      assert.ok(view.policies.every((p) => p.asOf.inForce));
      assert.equal(view.policies.flatMap((p) => p.asOf.coverages).length, 4);
      const later = await K.i.getOrganizationInsurance(insured, { asOf: "2024-06-01" });
      assert.deepEqual(later.policies.map((p) => [p.policy.family, p.asOf.inForce]).sort(), [["BOND", true], ["INSURANCE", false], ["WORKERS_COMPENSATION", false]]);
      assert.equal(wc.policy.id !== bond.policy.id && bond.policy.id !== a.policyId, true);
    });
  });

  // =============================================================================================================
  describe("concurrency (real PostgreSQL, distinct authorized actors)", () => {
    const creator = (insured: string, insurer: string, number: string) =>
      K.i.createPolicy({ organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: number, termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] });
    const settled = <T>(results: PromiseSettledResult<T>[]) => ({
      won: results.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled"),
      lost: results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason as unknown),
    });
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    scenario("1. simultaneous creators of the same (insurer, number) for different Organizations: exactly one wins, the rest get the collision result", async () => {
      const as = await concurrentActors(5);
      const insurer = await org("Insurer");
      const insureds = await Promise.all([org(), org(), org(), org(), org()]);
      const number = num("RACE");
      const { won, lost } = settled(await Promise.allSettled(insureds.map((id, i) => as(i, () => creator(id, insurer, number)))));
      assert.equal(won.length, 1);
      assert.equal(lost.length, 4);
      const winner = won[0].value.policy.id;
      for (const error of lost) {
        assert.ok(error instanceof K.i.PolicyNumberCollisionError, String(error));
        assert.equal(error.match?.policyId, winner, "a reader is told who holds the number");
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE insurer_organization_id = $1 AND number_normalized = $2 AND record_status = 'active'`, [insurer, number.replace(/-/g, "")]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policies WHERE insurer_organization_id = $1`, [insurer]), 1, "no loser left a policy behind");
    });

    scenario("2. the same race for ONE insured Organization, and for MANAGE-only actors (no disclosure)", async () => {
      const as = await concurrentActors(4);
      const insurer = await org("Insurer");
      const insured = await org("Insured");
      const { won, lost } = settled(await Promise.allSettled([0, 1, 2, 3].map((i) => as(i, () => creator(insured, insurer, num("SAME"))))));
      assert.equal(won.length, 4, "different numbers: all four policies are created (serialized by the Organization lock)");
      assert.equal(lost.length, 0);
      const number = num("SAMEN");
      const same = settled(await Promise.allSettled([0, 1, 2, 3].map((i) => as(i, () => creator(insured, insurer, number)))));
      assert.equal(same.won.length, 1);
      for (const error of same.lost) assert.ok(error instanceof K.i.PolicyNumberCollisionError);

      const writers = await concurrentActors(3, "INSURANCE_MANAGE");
      const others = await Promise.all([org(), org(), org()]);
      const blind = settled(await Promise.allSettled(others.map((id, i) => writers(i, () => creator(id, insurer, num("BLIND").replace(/\d+$/, "1") + run)))));
      assert.equal(blind.won.length, 1);
      for (const error of blind.lost) {
        assert.ok(error instanceof K.i.PolicyNumberCollisionError, String(error));
        assert.equal(error.match, undefined, "without INSURANCE_READ the holder is never named");
      }
    });

    scenario("3. simultaneous renewals of one policy: exactly one wins and the terms never overlap", async () => {
      await fullStaff();
      const as = await concurrentActors(4);
      const a = await policy();
      const starts = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-01-01"];
      const { won, lost } = settled(await Promise.allSettled(starts.map((termStart, i) => as(i, () => K.i.renewPolicy({ policyId: a.policyId, policyNumber: num("R"), termStart, termEnd: "2025-06-01", coverages: [AL()] })))));
      assert.equal(won.length, 1);
      for (const error of lost) assert.ok(error instanceof K.i.InsuranceError, String(error));
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1 AND record_status = 'active'`, [a.policyId]), 2);
      const overlapping = await rowCount(
        `SELECT count(*) FROM public.insurance_policy_terms x JOIN public.insurance_policy_terms y ON x.policy_id = y.policy_id AND x.id < y.id
          WHERE x.policy_id = $1 AND x.record_status = 'active' AND y.record_status = 'active' AND daterange(x.term_start, x.term_end) && daterange(y.term_start, y.term_end)`,
        [a.policyId],
      );
      assert.equal(overlapping, 0);
    });

    scenario("4. simultaneous endorsements on one term never corrupt the coverage timeline", async () => {
      await fullStaff();
      const as = await concurrentActors(6);
      const a = await policy();
      const dates = ["2023-02-01", "2023-03-01", "2023-04-01", "2023-05-01", "2023-06-01", "2023-07-01"];
      const { won, lost } = settled(
        await Promise.allSettled(dates.map((effectiveOn, i) => as(i, () => K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_CHANGED", effectiveOn, coverage: AL({ limitAmount: String(2_000_000 + i * 100_000) }) })))),
      );
      assert.ok(won.length >= 1);
      for (const error of lost) assert.ok(error instanceof K.i.InsuranceValidationError, String(error));
      const rows = await activeRows(a.termId, "AUTO_LIABILITY");
      assert.equal(rows.length, won.length + 1);
      assert.equal(rows.filter((r) => r.effective_to === null).length, 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_endorsements WHERE term_id = $1 AND record_status = 'active'`, [a.termId]), won.length);
      await assertTimelines(a.termId);
      // adding the same coverage at the same moment: one winner, the rest conflict
      const adders = settled(await Promise.allSettled([0, 1, 2, 3].map((i) => as(i, () => K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-08-01", coverage: GL() })))));
      assert.equal(adders.won.length, 1);
      for (const error of adders.lost) assert.ok(error instanceof K.i.InsuranceConflictError, String(error));
      assert.equal((await activeRows(a.termId, "GENERAL_LIABILITY")).length, 1);
      await assertTimelines(a.termId);
    });

    scenario("5. simultaneous broker changes leave one current period and a contiguous history", async () => {
      await fullStaff();
      const as = await concurrentActors(4);
      const first = await org("First");
      const a = await policy({ broker: { brokerOrganizationId: first, effectiveFrom: "2023-01-01T00:00:00Z" } });
      const brokers = await Promise.all([org(), org(), org(), org()]);
      const { won, lost } = settled(await Promise.allSettled(brokers.map((brokerOrganizationId, i) => as(i, () => K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId })))));
      for (const error of lost) assert.ok(error instanceof K.i.InsuranceError, String(error));
      assert.ok(won.length >= 1);
      const periods = (await pools.admin.query<{ effective_from: string; effective_to: string | null }>(`SELECT effective_from::text, effective_to::text FROM public.insurance_broker_periods WHERE policy_id = $1 AND record_status = 'active' ORDER BY effective_from`, [a.policyId])).rows;
      assert.equal(periods.length, won.length + 1);
      assert.equal(periods.filter((p) => p.effective_to === null).length, 1);
      periods.slice(0, -1).forEach((p, i) => assert.equal(p.effective_to, periods[i + 1].effective_from, "each period ends exactly when the next begins"));
      // the same instant for everybody: one winner
      const instant = "2023-09-01T00:00:00Z";
      const again = await policy({ broker: { brokerOrganizationId: first, effectiveFrom: "2023-01-01T00:00:00Z" } });
      const same = settled(await Promise.allSettled(brokers.map((brokerOrganizationId, i) => as(i, () => K.i.changeBroker({ policyId: again.policyId, brokerOrganizationId, effectiveFrom: instant })))));
      assert.equal(same.won.length, 1);
      for (const error of same.lost) assert.ok(error instanceof K.i.InsuranceValidationError, String(error));
    });

    scenario("6. a term correction racing an endorsement and a cancellation leaves one consistent genuine term", async () => {
      await fullStaff();
      const as = await concurrentActors(3);
      const a = await rich();
      const results = await Promise.allSettled([
        as(0, () => K.i.correctTerm({ termId: a.termId, policyNumber: num("RACE") })),
        as(1, () => K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-07-01", coverage: GL() })),
        as(2, () => K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-12-01", reason: "INSURED_REQUEST" })),
      ]);
      for (const result of results) if (result.status === "rejected") assert.ok(result.reason instanceof K.i.InsuranceError, String(result.reason));
      assert.equal(results[0].status, "fulfilled");
      const view = await readPolicy(a.organizationId);
      const genuine = view.terms.filter((t) => t.term.recordStatus === "active");
      assert.equal(genuine.length, 1);
      const [fresh] = genuine;
      // whatever order the three ran in, the genuine term carries every successful fact exactly once
      const endorsed = results[1].status === "fulfilled";
      assert.equal(fresh.endorsements.filter((e) => e.kind === "COVERAGE_ADDED").length, endorsed ? 1 : 0);
      assert.equal(fresh.coverages.filter((c) => c.coverageType === "GENERAL_LIABILITY").length, endorsed ? 1 : 0);
      assert.equal(fresh.term.cancelledOn !== null, results[2].status === "fulfilled");
      await assertTimelines(fresh.term.id);
    });
  });

  describe("concurrency: lock-order corner", () => {
    scenario("7. two Organizations insuring each other at the same moment never surface a raw deadlock", async () => {
      const as = await concurrentActors(2);
      const creator = (insured: string, insurer: string) =>
        K.i.createPolicy({ organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: num("X"), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] });
      for (let round = 0; round < 6; round += 1) {
        const [x, y] = [await org("X"), await org("Y")];
        const results = await Promise.allSettled([as(0, () => creator(x, y)), as(1, () => creator(y, x))]);
        for (const result of results) {
          if (result.status === "rejected") assert.ok(result.reason instanceof K.i.InsuranceConflictError, `a deadlock is a retryable conflict, got ${String(result.reason)}`);
        }
        assert.ok(results.some((result) => result.status === "fulfilled"), "at least one of the two wins");
      }
    });
  });

  // =============================================================================================================
  describe("Master Register (same transaction, references and vocabulary only)", () => {
    scenario("every mutation records its events with references and controlled vocabulary; reads and refusals record nothing", async () => {
      const actor = await fullStaff();
      const insured = await org("Insured");
      const insurer = await org("Insurer");
      const brokerage = await org("Brokerage");
      const secondBrokerage = await org("Brokerage2");
      const person = await contact(brokerage);
      const secretNumber = `SECRET-${run}-${n()}`;
      const view0 = await K.i.createPolicy({
        organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: secretNumber, termStart: "2023-01-01", termEnd: "2024-01-01",
        coverages: [AL({ limitAmount: "1234567.89" }), CARGO({ deductibleAmount: "7654.32" })], broker: { brokerOrganizationId: brokerage, brokerPersonId: person.personId, effectiveFrom: "2023-01-01T00:00:00Z" },
      });
      const termId = view0.terms[0].term.id;
      const policyId = view0.policy.id;
      await K.i.addEndorsement({ termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-04-01", endorsementNumber: `ENDSECRET-${run}`, coverage: AL({ limitAmount: "2222222" }) });
      await K.i.addEndorsement({ termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-05-01", coverage: GL() });
      await K.i.addEndorsement({ termId, kind: "COVERAGE_REMOVED", effectiveOn: "2023-06-01", coverage: { coverageType: "MOTOR_TRUCK_CARGO" } });
      const gl = (await activeRows(termId, "GENERAL_LIABILITY"))[0];
      await K.i.correctCoverage({ coverageId: gl.id, limitAmount: "3333333" });
      const endorsement = (await readPolicy(insured)).terms[0].endorsements.find((e) => e.kind === "COVERAGE_REMOVED")!;
      await K.i.correctEndorsement({ endorsementId: endorsement.id, effectiveOn: "2023-06-10" });
      await K.i.cancelTerm({ termId, cancelledOn: "2023-11-01", reason: "NON_PAYMENT" });
      await K.i.correctTerm({ termId, cancellation: { cancelledOn: "2023-11-15", reason: "INSURER_CANCELLATION" } });
      await K.i.changeBroker({ policyId, brokerOrganizationId: secondBrokerage, effectiveFrom: "2023-07-01T00:00:00Z" });
      await K.i.correctBroker({ brokerPeriodId: (await readPolicy(insured)).current.broker!.id, brokerOrganizationId: brokerage });
      await K.i.archivePolicy({ policyId });
      await K.i.restorePolicy({ policyId });

      const events = (await pools.admin.query<{ event_type: string; target: { resourceType: string; resourceId: string; subjectReferences: string[] }; change_set: { fieldChanges: Array<{ field: string; before: { kind: string; value?: unknown; reference?: string }; after: { kind: string; value?: unknown; reference?: string } }> } }>(
        `SELECT event_type, target, change_set FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`,
        [actor.actorId],
      )).rows;
      assert.ok(events.length >= 20);
      const known = new Set(["RECORD_CREATED", "RECORD_UPDATED", "RECORD_CORRECTED", "RECORD_STATUS_CHANGED", "RECORD_ARCHIVED", "RECORD_RESTORED"]);
      const resources = new Set(["insurance_policy", "insurance_policy_term", "insurance_endorsement", "insurance_coverage", "insurance_broker_period"]);
      const literals = new Set([
        "INSURANCE", "WORKERS_COMPENSATION", "BOND", "INITIAL", "RENEWAL", "CORRECTION", "active", "archived", "in_force", "ended", "NON_PAYMENT", "INSURER_CANCELLATION", "INSURED_REQUEST", "REPLACED_BY_NEW_POLICY",
        "COVERAGE_ADDED", "COVERAGE_CHANGED", "COVERAGE_REMOVED", "AUTO_LIABILITY", "MOTOR_TRUCK_CARGO", "GENERAL_LIABILITY", "PHYSICAL_DAMAGE", "UMBRELLA_EXCESS", "REEFER_BREAKDOWN",
      ]);
      for (const event of events) {
        assert.ok(known.has(event.event_type), event.event_type);
        assert.ok(resources.has(event.target.resourceType), event.target.resourceType);
        assert.deepEqual(event.target.subjectReferences, [`organization:${insured}`]);
        assert.match(event.target.resourceId, /^[0-9a-f-]{36}$/);
        for (const change of event.change_set.fieldChanges) {
          for (const side of [change.before, change.after]) {
            if (side.kind === "REFERENCE") assert.match(side.reference!, /^(insurance_[a-z_]+|organizations):[0-9a-f-]{36}$/);
            else {
              assert.equal(side.kind, "LITERAL");
              assert.ok(side.value === null || literals.has(side.value as string), `literal ${String(side.value)} is not controlled vocabulary`);
            }
          }
        }
      }
      const types = events.map((e) => e.event_type);
      for (const needed of ["RECORD_CREATED", "RECORD_UPDATED", "RECORD_CORRECTED", "RECORD_STATUS_CHANGED", "RECORD_ARCHIVED", "RECORD_RESTORED"]) assert.ok(types.includes(needed), needed);
      const json = await eventsJson(actor.actorId);
      for (const secret of [secretNumber, secretNumber.replace(/-/g, ""), `ENDSECRET-${run}`, `ENDSECRET${run}`, "1234567", "7654.32", "2222222", "3333333", "2023-01-01", "2023-04-01", "2023-11-15", "2024-01-01", "INS Insured", "INS Insurer", "INS Brokerage"]) {
        assert.equal(json.includes(secret), false, `${secret} must not reach the Master Register`);
      }
      assert.doesNotMatch(json, /Broker\d|Test Broker/, "no person name reaches the Master Register");
      // reads and refusals write nothing
      const count = types.length;
      await K.i.getOrganizationInsurance(insured);
      await K.i.checkPolicyNumber(insurer, secretNumber);
      await assert.rejects(K.i.renewPolicy({ policyId, termStart: "2023-02-01", termEnd: "2025-01-01", coverages: [AL()] }));
      await collision(K.i.createPolicy({ organizationId: await org("Other"), insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: secretNumber, termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL()] }));
      assert.equal((await eventTypes(actor.actorId)).length, count);
    });

    scenario("a Master Register failure rolls the whole mutation back, whichever event fails", async () => {
      const actor = await fullStaff();
      const first = await org("Broker one");
      const second = await org("Broker two");
      const a = await rich({ broker: { brokerOrganizationId: first, effectiveFrom: "2023-01-01T00:00:00Z" } });
      const state = async () => JSON.stringify(await readPolicy(a.organizationId));
      const [al, alCurrent] = await activeRows(a.termId, "AUTO_LIABILITY");
      void al;
      const before = await state();
      const eventsBefore = (await eventTypes(actor.actorId)).length;

      const operations: Array<[string, string, () => Promise<unknown>]> = [
        ["RECORD_CREATED", "renewPolicy", () => K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL(), GL()] })],
        ["RECORD_STATUS_CHANGED", "cancelTerm", () => K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-09-01", reason: "INSURED_REQUEST" })],
        ["RECORD_UPDATED", "addEndorsement (after its first event was written)", () => K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-07-01", coverage: AL({ limitAmount: "9000000" }) })],
        ["RECORD_CREATED", "addEndorsement (ADDED)", () => K.i.addEndorsement({ termId: a.termId, kind: "COVERAGE_ADDED", effectiveOn: "2023-07-01", coverage: GL() })],
        ["RECORD_CORRECTED", "correctTerm", () => K.i.correctTerm({ termId: a.termId, policyNumber: num("MR") })],
        ["RECORD_CORRECTED", "correctCoverage", () => K.i.correctCoverage({ coverageId: alCurrent.id, limitAmount: "2100000" })],
        ["RECORD_CORRECTED", "correctEndorsement", () => K.i.correctEndorsement({ endorsementId: a.removed.id, effectiveOn: "2023-06-10" })],
        ["RECORD_UPDATED", "changeBroker", () => K.i.changeBroker({ policyId: a.policyId, brokerOrganizationId: second })],
        ["RECORD_CORRECTED", "correctBroker", () => K.i.correctBroker({ brokerPeriodId: a.view.current.broker!.id, brokerOrganizationId: second })],
        ["RECORD_ARCHIVED", "archivePolicy", () => K.i.archivePolicy({ policyId: a.policyId })],
      ];
      for (const [eventType, label, work] of operations) {
        await refuseMasterRegisterEvent(eventType);
        await assert.rejects(work(), /master register write refused/, label);
        await allowMasterRegister();
        assert.equal(await state(), before, `${label}: the failed mutation left no trace`);
        assert.equal((await eventTypes(actor.actorId)).length, eventsBefore, `${label}: and no event`);
      }
      // createPolicy: nothing at all is created
      const insured = await org("Insured");
      await refuseMasterRegisterEvent("RECORD_CREATED");
      await assert.rejects(K.i.createPolicy({ organizationId: insured, insurerOrganizationId: a.insurerOrganizationId, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL(), CARGO()], broker: { brokerOrganizationId: first } }), /master register write refused/);
      await allowMasterRegister();
      assert.equal(await policyRows(insured), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_broker_periods WHERE organization_id = $1`, [insured]), 0);
      // restore is refused the same way
      await K.i.archivePolicy({ policyId: a.policyId });
      const archivedState = await state();
      await refuseMasterRegisterEvent("RECORD_RESTORED");
      await assert.rejects(K.i.restorePolicy({ policyId: a.policyId }), /master register write refused/);
      await allowMasterRegister();
      assert.equal(await state(), archivedState);
      // ... and valid once the register accepts it
      await K.i.restorePolicy({ policyId: a.policyId });
      assert.equal((await K.i.renewPolicy({ policyId: a.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL(), GL()] })).terms.length, 2);
    });

    scenario("a failure in the middle of an operation (not the register) leaves nothing behind either", async () => {
      await fullStaff();
      const insured = await org("Insured");
      const insurer = await org("Insurer");
      const brokerage = await org("Brokerage");
      const inject = async (table: string, condition: string) => {
        await pools.admin.query(`CREATE OR REPLACE FUNCTION public.tes_test_inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'test: injected failure'; END IF; RETURN NEW; END $$`);
        await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_inject_failure ON public.${table}`);
        await pools.admin.query(`CREATE TRIGGER tes_test_inject_failure BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.tes_test_inject_failure()`);
        cleanups.push(async () => {
          await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_inject_failure ON public.${table}`);
          await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_inject_failure()`);
        });
      };
      const input = { organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [AL(), CARGO()], broker: { brokerOrganizationId: brokerage } };
      // the broker insert is the LAST write: the policy, term and both coverages are already in the transaction
      await inject("insurance_broker_periods", "true");
      await assert.rejects(K.i.createPolicy(input), /injected failure/);
      assert.equal(await policyRows(insured), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_coverages WHERE organization_id = $1`, [insured]), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE organization_id = $1`, [insured]), 0);
      await pools.admin.query(`DROP TRIGGER tes_test_inject_failure ON public.insurance_broker_periods`);
      // the second coverage fails: the first coverage, the term and the policy go with it
      await inject("insurance_coverages", "NEW.coverage_type = 'MOTOR_TRUCK_CARGO'");
      await assert.rejects(K.i.createPolicy(input), /injected failure/);
      assert.equal(await policyRows(insured), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_coverages WHERE organization_id = $1`, [insured]), 0);
      // a correction whose carried coverage fails does not flag the term
      await pools.admin.query(`DROP TRIGGER tes_test_inject_failure ON public.insurance_coverages`);
      const view = await K.i.createPolicy(input);
      const before = JSON.stringify(await readPolicy(insured));
      await inject("insurance_coverages", "NEW.coverage_type = 'MOTOR_TRUCK_CARGO'");
      await assert.rejects(K.i.correctTerm({ termId: view.terms[0].term.id, policyNumber: num() }), /injected failure/);
      await assert.rejects(K.i.renewPolicy({ policyId: view.policy.id, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [AL(), CARGO()] }), /injected failure/);
      assert.equal(JSON.stringify(await readPolicy(insured)), before);
    });
  });

  // =============================================================================================================
  describe("database backstops (reachable when the service is bypassed)", () => {
    const FAMILY = "INSURANCE";
    const RULE = "insurance_policy_number.permissive.v1";
    type Statement = [string, unknown[]?];
    const insertPolicy = (id: string, organizationId: string, insurerId: string, family = FAMILY, renews: string | null = null): Statement => [
      `INSERT INTO public.insurance_policies (id, organization_id, insurer_organization_id, family, renews_policy_id) VALUES ($1, $2, $3, $4, $5)`,
      [id, organizationId, insurerId, family, renews],
    ];
    const insertTerm = (id: string, policyId: string, organizationId: string, insurerId: string, number: string, start: string, end: string | null, family = FAMILY): Statement => [
      `INSERT INTO public.insurance_policy_terms (id, policy_id, organization_id, insurer_organization_id, family, number_display, number_normalized, normalization_rule_version, term_start, term_end, term_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, 'INITIAL')`,
      [id, policyId, organizationId, insurerId, family, number, number.replace(/[^A-Z0-9]/gi, "").toUpperCase(), RULE, start, end],
    ];
    const insertCoverage = (
      termId: string, policyId: string, organizationId: string, type: string, limit: string | null, from: string, over: { family?: string; to?: string | null; currency?: string | null; deductible?: string | null; basis?: string | null; endorsementId?: string | null } = {},
    ): Statement => [
      `INSERT INTO public.insurance_coverages (id, term_id, policy_id, organization_id, family, coverage_type, limit_amount, deductible_amount, currency, limit_basis, effective_from, effective_to, endorsement_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9, $10, $11::date, $12::date, $13)`,
      [randomUUID(), termId, policyId, organizationId, over.family ?? FAMILY, type, limit, over.deductible ?? null, over.currency === undefined ? (limit === null ? null : "CAD") : over.currency, over.basis ?? null, from, over.to ?? null, over.endorsementId ?? null],
    ];
    const insertEndorsement = (termId: string, policyId: string, organizationId: string, kind: string, on: string, number: string | null = null, id = randomUUID()): Statement => [
      `INSERT INTO public.insurance_endorsements (id, term_id, policy_id, organization_id, family, number_display, number_normalized, endorsement_kind, effective_on) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date)`,
      [id, termId, policyId, organizationId, FAMILY, number, number === null ? null : number.toUpperCase(), kind, on],
    ];
    const insertBroker = (policyId: string, organizationId: string, brokerId: string, relationshipId: string | null, personId: string | null, from = "2023-01-01Z", id = randomUUID()): Statement => [
      `INSERT INTO public.insurance_broker_periods (id, policy_id, organization_id, broker_organization_id, broker_relationship_id, broker_person_id, effective_from) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, policyId, organizationId, brokerId, relationshipId, personId, from],
    ];

    async function transaction(pool: "admin" | "runtime", statements: Statement[]): Promise<{ error?: Error & { constraint?: string; code?: string } }> {
      const client = await pools[pool].connect();
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
    /** Executes as the given role and asserts the database (not the service) refuses, optionally by constraint name or message. */
    async function refuses(pool: "admin" | "runtime", statements: Statement[], expected: RegExp | { constraint: string }, label: string) {
      const outcome = await transaction(pool, statements);
      assert.ok(outcome.error, `${label}: expected the database to refuse`);
      if (expected instanceof RegExp) assert.match(outcome.error!.message, expected, label);
      else assert.equal(outcome.error!.constraint, expected.constraint, `${label}: ${outcome.error!.message}`);
    }
    const accepts = async (pool: "admin" | "runtime", statements: Statement[], label: string) => {
      const outcome = await transaction(pool, statements);
      assert.equal(outcome.error, undefined, `${label}: ${outcome.error?.message}`);
    };
    /** A standalone, service-created policy to attack. */
    async function target(over: Make = {}) {
      await fullStaff();
      const a = await policy(over);
      return { ...a, number: a.view.terms[0].term.numberDisplay };
    }

    scenario("the runtime role is refused identity and content changes, deletes and truncates; the table owner is refused by triggers", async () => {
      await fullStaff();
      const a = await rich({ broker: { brokerOrganizationId: await org("Broker"), effectiveFrom: "2023-01-01T00:00:00Z" } });
      const [row] = await activeRows(a.termId, "AUTO_LIABILITY");
      const brokerPeriodId = a.view.brokerPeriods[0].id;
      const denied = (sql: string, params: unknown[]) => assert.rejects(pools.runtime.query(sql, params), /permission denied/, sql);
      await denied(`UPDATE public.insurance_policies SET organization_id = $2 WHERE id = $1`, [a.policyId, randomUUID()]);
      await denied(`UPDATE public.insurance_policies SET family = 'BOND' WHERE id = $1`, [a.policyId]);
      await denied(`UPDATE public.insurance_policy_terms SET number_normalized = 'X' WHERE id = $1`, [a.termId]);
      await denied(`UPDATE public.insurance_policy_terms SET term_end = '2030-01-01' WHERE id = $1`, [a.termId]);
      await denied(`UPDATE public.insurance_endorsements SET effective_on = '2023-01-02' WHERE id = $1`, [a.changed.id]);
      await denied(`UPDATE public.insurance_coverages SET limit_amount = 1 WHERE id = $1`, [row.id]);
      await denied(`UPDATE public.insurance_coverages SET effective_from = '2023-01-02' WHERE id = $1`, [row.id]);
      await denied(`UPDATE public.insurance_broker_periods SET broker_organization_id = $2 WHERE id = $1`, [brokerPeriodId, a.insurerOrganizationId]);
      await denied(`UPDATE public.insurance_coverage_types SET limit_required = false WHERE code = 'AUTO_LIABILITY'`, []);
      await denied(`INSERT INTO public.insurance_coverage_types (code, display_name, family, limit_required, sort_order) VALUES ('X1', 'X', 'INSURANCE', true, 999)`, []);
      for (const table of ALL_TABLES) {
        await denied(`DELETE FROM public.${table}`, []);
        await denied(`TRUNCATE public.${table}`, []);
      }
      // even the owner cannot delete or truncate: the no-delete triggers hold
      for (const table of BUSINESS_TABLES) {
        await refuses("admin", [[`DELETE FROM public.${table}`]], /Insurance data is preserved/, `${table} delete`);
        await refuses("admin", [[`TRUNCATE public.${table} CASCADE`]], /Insurance data is preserved/, `${table} truncate`);
      }
    });

    scenario("the owner cannot rewrite identity or content either; corrected rows are frozen; one-way facts stay one-way", async () => {
      await fullStaff();
      const a = await rich({ broker: { brokerOrganizationId: await org("Broker"), effectiveFrom: "2023-01-01T00:00:00Z" } });
      const [first] = await activeRows(a.termId, "AUTO_LIABILITY");
      const brokerPeriodId = a.view.brokerPeriods[0].id;
      const owner = (sql: string, params: unknown[], pattern: RegExp, label: string) => refuses("admin", [[sql, params]], pattern, label);
      await owner(`UPDATE public.insurance_policies SET insurer_organization_id = $2 WHERE id = $1`, [a.policyId, a.organizationId], /identity is immutable/, "policy insurer");
      await owner(`UPDATE public.insurance_policy_terms SET number_display = 'ZZ' WHERE id = $1`, [a.termId], /content is immutable/, "term number");
      await owner(`UPDATE public.insurance_policy_terms SET term_start = '2022-01-01' WHERE id = $1`, [a.termId], /content is immutable/, "term start");
      await owner(`UPDATE public.insurance_endorsements SET endorsement_kind = 'COVERAGE_ADDED' WHERE id = $1`, [a.changed.id], /content is immutable/, "endorsement kind");
      await owner(`UPDATE public.insurance_coverages SET limit_amount = 5 WHERE id = $1`, [first.id], /content is immutable/, "coverage limit");
      await owner(`UPDATE public.insurance_coverages SET effective_to = '2023-05-05' WHERE id = $1`, [first.id], /cannot be re-dated/, "ended coverage re-dated");
      await owner(`UPDATE public.insurance_broker_periods SET broker_organization_id = $2 WHERE id = $1`, [brokerPeriodId, a.insurerOrganizationId], /content is immutable/, "broker org");
      // a cancellation is one-way and a correction does not cancel
      await accepts("admin", [[`UPDATE public.insurance_policy_terms SET cancelled_on = '2023-09-01', cancellation_reason = 'NON_PAYMENT' WHERE id = $1`, [a.termId]]], "first cancellation");
      await owner(`UPDATE public.insurance_policy_terms SET cancelled_on = '2023-09-02' WHERE id = $1`, [a.termId], /cancellation cannot be changed|cancellation_state/, "cancellation re-dated");
      await owner(`UPDATE public.insurance_policy_terms SET cancellation_reason = 'INSURED_REQUEST' WHERE id = $1`, [a.termId], /cancellation cannot be changed/, "reason changed");
      // frozen once corrected
      const view = await K.i.correctTerm({ termId: a.termId, policyNumber: num("F") });
      const corrected = view.terms.find((t) => t.term.id === a.termId)!;
      await owner(`UPDATE public.insurance_policy_terms SET cancelled_on = NULL WHERE id = $1`, [corrected.term.id], /frozen/, "corrected term");
      const aBroker = await K.i.correctBroker({ brokerPeriodId, brokerOrganizationId: a.insurerOrganizationId });
      const wrongPeriod = aBroker.brokerPeriods.find((b) => b.id === brokerPeriodId)!;
      assert.equal(wrongPeriod.recordStatus, "corrected");
      await owner(`UPDATE public.insurance_broker_periods SET effective_to = now() WHERE id = $1`, [brokerPeriodId], /frozen/, "corrected broker period");
      const active = view.terms.find((t) => t.term.recordStatus === "active")!;
      const activeFirst = active.coverages.find((c) => c.coverageType === "AUTO_LIABILITY" && c.effectiveTo === null)!;
      // correct a coverage, then try to touch the flagged row
      const fixed = await K.i.correctCoverage({ coverageId: activeFirst.id, deductibleAmount: "10" });
      const flagged = fixed.terms.find((t) => t.term.id === active.term.id)!.coverages.find((c) => c.id === activeFirst.id)!;
      assert.equal(flagged.recordStatus, "corrected");
      await owner(`UPDATE public.insurance_coverages SET updated_at = now() WHERE id = $1`, [flagged.id], /frozen/, "corrected coverage");
    });

    scenario("a policy needs an active term and a term needs a coverage by the end of the transaction", async () => {
      const a = await target();
      const policyId = randomUUID();
      const termId = randomUUID();
      const bare = insertPolicy(policyId, a.organizationId, a.insurerOrganizationId);
      await refuses("runtime", [bare], /must have an active term/, "policy without a term");
      await refuses("runtime", [bare, insertTerm(termId, policyId, a.organizationId, a.insurerOrganizationId, num(), "2023-01-01", "2024-01-01")], /must have at least one coverage/, "term without a coverage");
      await accepts("runtime", [bare, insertTerm(termId, policyId, a.organizationId, a.insurerOrganizationId, num(), "2023-01-01", "2024-01-01"), insertCoverage(termId, policyId, a.organizationId, "AUTO_LIABILITY", "5", "2023-01-01")], "complete policy");
      // a renewal term of an existing policy also needs its coverage
      const renewal = randomUUID();
      await refuses("runtime", [insertTerm(renewal, a.policyId, a.organizationId, a.insurerOrganizationId, num(), "2024-01-01", "2025-01-01")], /must have at least one coverage/, "renewal term without a coverage");
    });

    scenario("policy rules: insurer differs from insured, both Organizations are active, a renewal keeps Organization and family, a term needs an active policy", async () => {
      const a = await target();
      const policyId = randomUUID();
      const termId = randomUUID();
      const full = (id: string, organizationId: string, insurerId: string, family = FAMILY, renews: string | null = null) => [
        insertPolicy(id, organizationId, insurerId, family, renews),
        insertTerm(termId, id, organizationId, insurerId, num(), "2023-01-01", family === "BOND" ? null : "2024-01-01", family),
        insertCoverage(termId, id, organizationId, family === "BOND" ? "BOND_CUSTOMS" : "AUTO_LIABILITY", "5", "2023-01-01", { family }),
      ];
      await refuses("runtime", full(policyId, a.organizationId, a.organizationId), { constraint: "insurance_policies_insurer_differs_from_insured" }, "insurer is the insured");
      const archived = await org("Archived");
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archived]);
      await refuses("runtime", full(policyId, archived, a.insurerOrganizationId), { constraint: "organization_must_be_active" }, "archived insured");
      await refuses("runtime", full(policyId, a.organizationId, archived), { constraint: "organization_must_be_active" }, "archived insurer");
      await refuses("runtime", [...full(policyId, a.organizationId, a.insurerOrganizationId, "BOND", a.policyId)], { constraint: "insurance_policies_renews_fk" }, "renewal in another family");
      const other = await policy();
      await refuses("runtime", [...full(policyId, a.organizationId, a.insurerOrganizationId, FAMILY, other.policyId)], { constraint: "insurance_policies_renews_fk" }, "renewal of another Organization's policy");
      await refuses("runtime", [...full(policyId, a.organizationId, a.insurerOrganizationId, "LIFE")], { constraint: "insurance_policies_family_valid" }, "unknown family");
      // renewing itself
      await refuses("runtime", [[`INSERT INTO public.insurance_policies (id, organization_id, insurer_organization_id, family, renews_policy_id) VALUES ($1, $2, $3, 'INSURANCE', $1)`, [policyId, a.organizationId, a.insurerOrganizationId]]], { constraint: "insurance_policies_not_renewal_of_self" }, "renews itself");
      // archived policies take no new term or broker period
      await pools.admin.query(`UPDATE public.insurance_policies SET record_status = 'archived', archived_at = now() WHERE id = $1`, [a.policyId]);
      await refuses("runtime", [insertTerm(randomUUID(), a.policyId, a.organizationId, a.insurerOrganizationId, num(), "2024-01-01", "2025-01-01")], { constraint: "insurance_policy_terms_policy_active" }, "term on archived policy");
      await refuses("runtime", [insertBroker(a.policyId, a.organizationId, a.insurerOrganizationId, null, null)], { constraint: "insurance_broker_periods_policy_active" }, "broker on archived policy");
      assert.equal(await policyRows(archived), 0);
    });

    scenario("term rules: periods, expiry, cancellation window, overlap and the per-insurer number namespace", async () => {
      const a = await target();
      const t = (number: string, start: string, end: string | null, family = FAMILY) => insertTerm(randomUUID(), a.policyId, a.organizationId, a.insurerOrganizationId, number, start, end, family);
      const withCoverage = (termStatement: Statement) => [termStatement, insertCoverage(termStatement[1]![0] as string, a.policyId, a.organizationId, "AUTO_LIABILITY", "5", termStatement[1]![8] as string)];
      await refuses("runtime", withCoverage(t(a.number, "2024-01-01", "2024-01-01")), { constraint: "insurance_policy_terms_period_valid" }, "empty period");
      await refuses("runtime", withCoverage(t(a.number, "2024-01-01", null)), { constraint: "insurance_policy_terms_expiry_required" }, "no expiry outside bonds");
      await refuses("runtime", withCoverage(t(a.number, "2023-06-01", "2024-06-01")), { constraint: "insurance_policy_terms_no_overlap" }, "overlap");
      await refuses("runtime", withCoverage(t(a.number, "2022-01-01", "2023-01-02")), { constraint: "insurance_policy_terms_no_overlap" }, "overlap at the start");
      await refuses("runtime", [[`INSERT INTO public.insurance_policy_terms (id, policy_id, organization_id, insurer_organization_id, family, number_display, number_normalized, normalization_rule_version, term_start, term_end, term_reason)
         VALUES ($1, $2, $3, $4, 'BOND', 'X', 'X', 'v', '2025-01-01', '2026-01-01', 'INITIAL')`, [randomUUID(), a.policyId, a.organizationId, a.insurerOrganizationId]]], { constraint: "insurance_policy_terms_policy_fk" }, "family other than the policy's");
      await refuses("runtime", [[`INSERT INTO public.insurance_policy_terms (id, policy_id, organization_id, insurer_organization_id, family, number_display, number_normalized, normalization_rule_version, term_start, term_end, term_reason)
         VALUES ($1, $2, $3, $4, 'INSURANCE', ' ', 'X', 'v', '2025-01-01', '2026-01-01', 'INITIAL')`, [randomUUID(), a.policyId, a.organizationId, a.insurerOrganizationId]]], { constraint: "insurance_policy_terms_number_display_not_blank" }, "blank number");
      await refuses("runtime", [[`INSERT INTO public.insurance_policy_terms (id, policy_id, organization_id, insurer_organization_id, family, number_display, number_normalized, normalization_rule_version, term_start, term_end, term_reason)
         VALUES ($1, $2, $3, $4, 'INSURANCE', 'X', 'X', 'v', '2025-01-01', '2026-01-01', 'SOMETHING')`, [randomUUID(), a.policyId, a.organizationId, a.insurerOrganizationId]]], { constraint: "insurance_policy_terms_reason_valid" }, "unknown reason");
      // adjacent is fine, and the same policy repeats its number
      await accepts("runtime", withCoverage(t(a.number, "2024-01-01", "2025-01-01")), "adjacent term with the same number");
      // cancellation window and shape
      await refuses("runtime", [[`UPDATE public.insurance_policy_terms SET cancelled_on = '2023-06-01' WHERE id = $1`, [a.termId]]], { constraint: "insurance_policy_terms_cancellation_state_consistent" }, "cancellation without a reason");
      await refuses("runtime", [[`UPDATE public.insurance_policy_terms SET cancelled_on = '2022-12-31', cancellation_reason = 'NON_PAYMENT' WHERE id = $1`, [a.termId]]], { constraint: "insurance_policy_terms_cancellation_within_term" }, "cancellation before the term");
      await refuses("runtime", [[`UPDATE public.insurance_policy_terms SET cancelled_on = '2024-01-02', cancellation_reason = 'NON_PAYMENT' WHERE id = $1`, [a.termId]]], { constraint: "insurance_policy_terms_cancellation_within_term" }, "cancellation after the term");
      await refuses("runtime", [[`UPDATE public.insurance_policy_terms SET cancelled_on = '2023-06-01', cancellation_reason = 'BECAUSE' WHERE id = $1`, [a.termId]]], { constraint: "insurance_policy_terms_cancellation_reason_valid" }, "unknown reason");
      await refuses("runtime", [[`UPDATE public.insurance_policy_terms SET record_status = 'corrected' WHERE id = $1`, [a.termId]]], { constraint: "insurance_policy_terms_correction_state_consistent" }, "corrected without a replacement");
    });

    scenario("the number namespace is per insurer at the database; an archived or ended holder still holds it", async () => {
      const a = await target();
      const other = await policy({ insurer: a.insurerOrganizationId });
      const claim = (policy: { policyId: string; organizationId: string }, insurerId: string) =>
        insertTerm(randomUUID(), policy.policyId, policy.organizationId, insurerId, a.number, "2025-01-01", "2026-01-01");
      const coverageFor = (statement: Statement, policy: { policyId: string; organizationId: string }) => insertCoverage(statement[1]![0] as string, policy.policyId, policy.organizationId, "AUTO_LIABILITY", "5", "2025-01-01");
      const sameInsurer = claim(other, a.insurerOrganizationId);
      await refuses("runtime", [sameInsurer, coverageFor(sameInsurer, other)], { constraint: "insurance_policy_terms_number_namespace" }, "another policy of the same insurer");
      // the Organization of the holder is irrelevant: the namespace belongs to the insurer
      const elsewhere = await org("Another insurer");
      const otherInsurer = await policy({ insurer: elsewhere });
      const reuse = insertTerm(randomUUID(), otherInsurer.policyId, otherInsurer.organizationId, elsewhere, a.number, "2025-01-01", "2026-01-01");
      await accepts("runtime", [reuse, coverageFor(reuse, otherInsurer)], "the same number at another insurer");
      await pools.admin.query(`UPDATE public.insurance_policies SET record_status = 'archived', archived_at = now() WHERE id = $1`, [a.policyId]);
      await refuses("runtime", [sameInsurer, coverageFor(sameInsurer, other)], { constraint: "insurance_policy_terms_number_namespace" }, "an archived policy still holds its number");
    });

    scenario("coverage rules: limit by type, currency by amount, family by composite key, window, overlap and one open row", async () => {
      const a = await target();
      const cov = (type: string, limit: string | null, over: Parameters<typeof insertCoverage>[6] = {}, from = "2023-01-01") => insertCoverage(a.termId, a.policyId, a.organizationId, type, limit, from, over);
      await refuses("runtime", [cov("REEFER_BREAKDOWN", null)], { constraint: "insurance_coverages_limit_rules" }, "limit missing where required");
      await refuses("runtime", [cov("REEFER_BREAKDOWN", "5", { family: "WORKERS_COMPENSATION" })], /insurance_coverages_(term|type)_fk/, "a family other than the term's");
      await refuses("runtime", [cov("BOND_CUSTOMS", "5")], { constraint: "insurance_coverages_type_fk" }, "bond type under an insurance policy");
      await refuses("runtime", [cov("WORKERS_COMPENSATION", null)], { constraint: "insurance_coverages_type_fk" }, "workers' type under an insurance policy");
      await refuses("runtime", [cov("REEFER_BREAKDOWN", "5", { currency: null })], { constraint: "insurance_coverages_currency_state_consistent" }, "amount without a currency");
      await refuses("runtime", [cov("REEFER_BREAKDOWN", "5", { currency: "EUR" })], { constraint: "insurance_coverages_currency_valid" }, "unknown currency");
      await refuses("runtime", [cov("REEFER_BREAKDOWN", "0")], { constraint: "insurance_coverages_limit_positive" }, "zero limit");
      await refuses("runtime", [cov("REEFER_BREAKDOWN", "5", { deductible: "-1" })], { constraint: "insurance_coverages_deductible_non_negative" }, "negative deductible");
      await refuses("runtime", [cov("REEFER_BREAKDOWN", "5", { basis: "WHENEVER" })], { constraint: "insurance_coverages_limit_basis_valid" }, "unknown basis");
      await refuses("runtime", [cov("REEFER_BREAKDOWN", "5", { to: "2023-01-01" })], { constraint: "insurance_coverages_period_valid" }, "empty period");
      await refuses("runtime", [cov("REEFER_BREAKDOWN", "5", {}, "2022-12-31")], { constraint: "insurance_coverages_inside_active_term" }, "before the term");
      await refuses("runtime", [cov("REEFER_BREAKDOWN", "5", {}, "2024-01-01")], { constraint: "insurance_coverages_inside_active_term" }, "at the term end");
      await refuses("runtime", [cov("REEFER_BREAKDOWN", "5", { to: "2024-01-02" })], { constraint: "insurance_coverages_inside_active_term" }, "ending after the term");
      await refuses("runtime", [cov("AUTO_LIABILITY", "9", {}, "2023-06-01")], { constraint: "insurance_coverages_no_overlap" }, "second open row of one type");
      await refuses("runtime", [cov("AUTO_LIABILITY", "9", { to: "2023-03-01" }, "2023-02-01")], { constraint: "insurance_coverages_no_overlap" }, "overlapping closed row");
      await accepts("runtime", [cov("REEFER_BREAKDOWN", "5", { basis: "AGGREGATE", deductible: "100" })], "valid new coverage");
      // an ended row followed by a new state
      await refuses("runtime", [[`UPDATE public.insurance_coverages SET effective_to = '2024-01-05' WHERE term_id = $1 AND coverage_type = 'REEFER_BREAKDOWN'`, [a.termId]]], { constraint: "insurance_coverages_inside_active_term" }, "ended after the term");
      // a coverage cannot begin after the cancellation
      await accepts("admin", [[`UPDATE public.insurance_policy_terms SET cancelled_on = '2023-05-01', cancellation_reason = 'NON_PAYMENT' WHERE id = $1`, [a.termId]]], "cancel");
      await refuses("runtime", [cov("PHYSICAL_DAMAGE", "5", {}, "2023-05-02")], { constraint: "insurance_coverages_inside_active_term" }, "after the cancellation");
      await accepts("runtime", [cov("PHYSICAL_DAMAGE", "5", {}, "2023-05-01")], "on the cancellation date");
      // statutory accounts take no limit
      const wc = await K.i.createPolicy({ organizationId: await org("Employer"), insurerOrganizationId: await org("Board"), family: "WORKERS_COMPENSATION", policyNumber: num(), termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [WC] });
      const wcTerm = wc.terms[0].term.id;
      await refuses("runtime", [insertCoverage(wcTerm, wc.policy.id, wc.policy.organizationId, "WORKERS_COMPENSATION", "5", "2023-02-01", { family: "WORKERS_COMPENSATION" })], { constraint: "insurance_coverages_limit_rules" }, "limit on a workers' account");
    });

    scenario("endorsement rules: inside an active, uncancelled term; one active number per term; no endorsement on a corrected term", async () => {
      const a = await target();
      const end = (kind: string, on: string, number: string | null = null) => insertEndorsement(a.termId, a.policyId, a.organizationId, kind, on, number);
      await refuses("runtime", [end("COVERAGE_ADDED", "2022-12-31")], { constraint: "insurance_endorsements_inside_active_term" }, "before the term");
      await refuses("runtime", [end("COVERAGE_ADDED", "2024-01-01")], { constraint: "insurance_endorsements_inside_active_term" }, "at the term end");
      await refuses("runtime", [end("COVERAGE_RENEWED", "2023-02-01")], { constraint: "insurance_endorsements_kind_valid" }, "unknown kind");
      await refuses("runtime", [[`INSERT INTO public.insurance_endorsements (id, term_id, policy_id, organization_id, family, number_display, endorsement_kind, effective_on) VALUES ($1, $2, $3, $4, 'INSURANCE', 'E1', 'COVERAGE_ADDED', '2023-02-01')`, [randomUUID(), a.termId, a.policyId, a.organizationId]]], { constraint: "insurance_endorsements_number_pair" }, "number display without a normalized form");
      await accepts("runtime", [end("COVERAGE_ADDED", "2023-02-01", "E1")], "first numbered endorsement");
      await refuses("runtime", [end("COVERAGE_ADDED", "2023-03-01", "E1")], { constraint: "insurance_endorsements_number_uq" }, "duplicate number");
      await accepts("runtime", [end("COVERAGE_ADDED", "2023-03-01", "E2"), end("COVERAGE_ADDED", "2023-03-02"), end("COVERAGE_ADDED", "2023-03-03")], "other numbers and unnumbered ones");
      await accepts("admin", [[`UPDATE public.insurance_policy_terms SET cancelled_on = '2023-05-01', cancellation_reason = 'NON_PAYMENT' WHERE id = $1`, [a.termId]]], "cancel");
      await refuses("runtime", [end("COVERAGE_ADDED", "2023-05-02", "E3")], { constraint: "insurance_endorsements_inside_active_term" }, "after the cancellation");
      await accepts("runtime", [end("COVERAGE_ADDED", "2023-05-01", "E3")], "on the cancellation date");
      // a corrected term takes no endorsement and no coverage
      await K.i.correctTerm({ termId: a.termId, cancellation: null });
      await refuses("runtime", [end("COVERAGE_ADDED", "2023-06-01", "E9")], { constraint: "insurance_endorsements_inside_active_term" }, "endorsement on a corrected term");
      await refuses("runtime", [insertCoverage(a.termId, a.policyId, a.organizationId, "PHYSICAL_DAMAGE", "5", "2023-06-01")], { constraint: "insurance_coverages_inside_active_term" }, "coverage on a corrected term");
    });

    scenario("broker rules: an active policy, an ACTIVE relationship with the brokerage firm itself, one current period", async () => {
      const a = await target();
      const brokerage = await org("Brokerage");
      const other = await org("Other firm");
      const mine = await contact(brokerage);
      const theirs = await contact(other);
      await refuses("runtime", [insertBroker(a.policyId, a.organizationId, brokerage, mine.relationshipId, null)], { constraint: "insurance_broker_periods_contact_pair" }, "relationship without a person");
      await refuses("runtime", [insertBroker(a.policyId, a.organizationId, brokerage, null, mine.personId)], { constraint: "insurance_broker_periods_contact_pair" }, "person without a relationship");
      await refuses("runtime", [insertBroker(a.policyId, a.organizationId, brokerage, theirs.relationshipId, theirs.personId)], { constraint: "insurance_broker_periods_contact_fk" }, "a contact of a different firm");
      await refuses("runtime", [insertBroker(a.policyId, a.organizationId, brokerage, mine.relationshipId, theirs.personId)], { constraint: "insurance_broker_periods_contact_fk" }, "a person who is not the relationship's");
      await refuses("runtime", [insertBroker(a.policyId, a.organizationId, a.organizationId === brokerage ? other : randomUUID(), null, null)], { constraint: "organization_must_be_active" }, "unknown brokerage");
      await refuses("runtime", [insertBroker(a.policyId, a.organizationId, brokerage, null, null, "2023-01-01Z"), insertBroker(a.policyId, a.organizationId, other, null, null, "2023-02-01Z")], { constraint: "insurance_broker_periods_current_uq" }, "two current periods");
      await accepts("runtime", [insertBroker(a.policyId, a.organizationId, brokerage, mine.relationshipId, mine.personId)], "a valid broker with a contact");
      await pools.admin.query(`UPDATE public.organization_person_relationships SET effective_to = now() WHERE id = $1`, [theirs.relationshipId]);
      await accepts("admin", [[`UPDATE public.insurance_broker_periods SET effective_to = '2023-03-01Z' WHERE policy_id = $1`, [a.policyId]]], "end the current period");
      await refuses("runtime", [insertBroker(a.policyId, a.organizationId, other, theirs.relationshipId, theirs.personId, "2023-03-01Z")], { constraint: "insurance_broker_periods_contact_active" }, "an ended relationship");
      await refuses("admin", [[`UPDATE public.insurance_broker_periods SET effective_to = '2023-06-01Z' WHERE policy_id = $1`, [a.policyId]]], /cannot be re-dated/, "an ended period cannot be re-dated");
      // a brokerage that is archived cannot be named
      const archivedFirm = await org("Archived firm");
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archivedFirm]);
      await refuses("runtime", [insertBroker(a.policyId, a.organizationId, archivedFirm, null, null, "2023-04-01Z")], { constraint: "organization_must_be_active" }, "archived brokerage");
    });

    scenario("races that bypass the service: the database serializes number claims, open coverage rows, current brokers and overlapping terms", async () => {
      await fullStaff();
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      /** Runs `first` (left uncommitted) and `second` on two runtime connections; `second` must block until `first` commits and then fail. */
      async function race(first: (c: import("pg").PoolClient) => Promise<void>, second: (c: import("pg").PoolClient) => Promise<void>) {
        const [c1, c2] = [await pools.runtime.connect(), await pools.runtime.connect()];
        try {
          await c1.query("BEGIN");
          await c2.query("BEGIN");
          await first(c1);
          const blocked = second(c2).then(() => ({ ok: true as const }), (error: Error & { code?: string; constraint?: string }) => ({ ok: false as const, error }));
          const early = await Promise.race([blocked, sleep(400).then(() => "waiting" as const)]);
          assert.equal(early, "waiting", "the second writer waits for the first to finish");
          await c1.query("COMMIT");
          const outcome = await blocked;
          await c2.query("ROLLBACK").catch(() => undefined);
          return outcome;
        } finally {
          await c1.query("ROLLBACK").catch(() => undefined);
          c1.release();
          c2.release();
        }
      }
      const run1 = async (c: import("pg").PoolClient, statements: Statement[]) => {
        for (const [sql, params] of statements) await c.query(sql, params);
      };

      // (1) the same number, different policies of one insurer
      const insurer = await org("Insurer");
      const [o1, o2] = [await org("Insured one"), await org("Insured two")];
      const number = num("DBRACE");
      const mk = (organizationId: string) => {
        const policyId = randomUUID();
        const termId = randomUUID();
        return [insertPolicy(policyId, organizationId, insurer), insertTerm(termId, policyId, organizationId, insurer, number, "2023-01-01", "2024-01-01"), insertCoverage(termId, policyId, organizationId, "AUTO_LIABILITY", "5", "2023-01-01")];
      };
      const outcome = await race((c) => run1(c, mk(o1)), (c) => run1(c, mk(o2)));
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.deepEqual([outcome.error.code, outcome.error.constraint], ["23505", "insurance_policy_terms_number_namespace"]);
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE insurer_organization_id = $1 AND number_normalized = $2`, [insurer, number.replace(/-/g, "")]), 1);

      // (2) two open rows of one coverage type in one term
      const a = await policy();
      const openCargo = (c: import("pg").PoolClient) => run1(c, [insertCoverage(a.termId, a.policyId, a.organizationId, "PHYSICAL_DAMAGE", "5", "2023-01-01")]);
      const coverageRace = await race(openCargo, openCargo);
      assert.equal(coverageRace.ok, false);
      if (!coverageRace.ok) assert.ok(["23505", "23P01"].includes(coverageRace.error.code!), coverageRace.error.message);
      assert.equal((await activeRows(a.termId, "PHYSICAL_DAMAGE")).length, 1);

      // (3) two current broker periods
      const brokerage = await org("Brokerage");
      const broker = (c: import("pg").PoolClient) => run1(c, [insertBroker(a.policyId, a.organizationId, brokerage, null, null)]);
      const brokerRace = await race(broker, broker);
      assert.equal(brokerRace.ok, false);
      if (!brokerRace.ok) assert.deepEqual([brokerRace.error.code, brokerRace.error.constraint], ["23505", "insurance_broker_periods_current_uq"]);
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_broker_periods WHERE policy_id = $1 AND effective_to IS NULL`, [a.policyId]), 1);

      // (4) two overlapping terms of one policy
      const term = (start: string, end: string) => (c: import("pg").PoolClient) => {
        const id = randomUUID();
        return run1(c, [insertTerm(id, a.policyId, a.organizationId, a.insurerOrganizationId, num("T"), start, end), insertCoverage(id, a.policyId, a.organizationId, "AUTO_LIABILITY", "5", start)]);
      };
      const termRace = await race(term("2024-01-01", "2025-01-01"), term("2024-06-01", "2025-06-01"));
      assert.equal(termRace.ok, false);
      if (!termRace.ok) assert.deepEqual([termRace.error.code, termRace.error.constraint], ["23P01", "insurance_policy_terms_no_overlap"]);
      assert.equal(await rowCount(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1 AND record_status = 'active'`, [a.policyId]), 2);
    });
  });
});
