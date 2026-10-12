// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL Insurance service (scheduled vehicles, migration 0025) through the REAL authorization wrappers and
// Clerk-to-actor resolution, on pooled connections that log in as the RUNTIME role, against a database with every migration
// applied, including the row-level security of migration 0024. Fixtures (Organizations, vehicles, operating relationships,
// merges) are created by the table owner, who bypasses row-level security; the code under test runs policy-bound and sees
// them only through the policies. Statements that bypass the service still run as the runtime role, inside a transaction that
// carries the one SYSTEM capability the way the authorization wrapper establishes it.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    authz: await import("@/lib/auth/tes-authorization"),
    system: await import("@/lib/auth/tes-system-context"),
    customer: await import("@/lib/auth/tes-customer-context"),
    i: await import("@/lib/insurance/service"),
    identity: await import("@/lib/operational-identity/service"),
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
const TABLE = "insurance_coverage_vehicles";
const BUSINESS_TABLES = ["insurance_policies", "insurance_policy_terms", "insurance_endorsements", "insurance_coverages", "insurance_broker_periods", TABLE] as const;
const VEHICLE_TABLES = ["organization_vehicle_relationships", "vehicle_merges", "vehicles"] as const;
type Capability = "INSURANCE_READ" | "INSURANCE_MANAGE" | "VEHICLE_READ" | "VEHICLE_MANAGE" | "ORGANIZATION_REGISTRY_READ" | "CUSTOMER_RELATIONSHIP_READ";
/** What an operator who schedules vehicles and reads their insurance holds: both Insurance capabilities, plus VEHICLE_READ for the merge chain. */
const BOTH: Capability[] = ["INSURANCE_READ", "INSURANCE_MANAGE", "VEHICLE_READ"];
type Statement = [string, unknown[]?];
type Pg = Error & { code?: string; constraint?: string };

describe("Insurance scheduled vehicles (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
  let vehicles: string[] = [];
  /** Organizations whose insurance a scenario created but whose rows another fixture (a customer) owns; their insurance is purged, they are not. */
  let insuredElsewhere: string[] = [];
  let cleanups: Array<() => Promise<void>> = [];
  /** The staff actor whose capability the runtime-role transactions below carry (set by fullStaff). */
  let operator: TestActor | null = null;

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
      for (const table of VEHICLE_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${table}_no_delete`);
      const insured = [...organizations, ...insuredElsewhere];
      const policies = `(SELECT id FROM public.insurance_policies WHERE organization_id = ANY($1::uuid[]) OR insurer_organization_id = ANY($1::uuid[]))`;
      await client.query(`DELETE FROM public.${TABLE} WHERE organization_id = ANY($1::uuid[]) OR vehicle_id = ANY($2::uuid[])`, [insured, vehicles]);
      await client.query(`DELETE FROM public.insurance_coverages WHERE policy_id IN ${policies}`, [insured]);
      await client.query(`DELETE FROM public.insurance_endorsements WHERE policy_id IN ${policies}`, [insured]);
      await client.query(`DELETE FROM public.insurance_broker_periods WHERE policy_id IN ${policies}`, [insured]);
      await client.query(`DELETE FROM public.insurance_policy_terms WHERE policy_id IN ${policies}`, [insured]);
      await client.query(`DELETE FROM public.insurance_policies WHERE organization_id = ANY($1::uuid[]) OR insurer_organization_id = ANY($1::uuid[])`, [insured]);
      await client.query(`DELETE FROM public.vehicle_merges WHERE source_vehicle_id = ANY($1::uuid[]) OR target_vehicle_id = ANY($1::uuid[])`, [vehicles]);
      await client.query(`DELETE FROM public.organization_vehicle_relationships WHERE vehicle_id = ANY($1::uuid[])`, [vehicles]);
      // merged vehicles point at their survivors: release the pointers (and the archive marks) before the rows go
      await client.query(`ALTER TABLE public.vehicles DISABLE TRIGGER vehicles_merge_cycle_guard`);
      await client.query(`ALTER TABLE public.vehicles DISABLE TRIGGER vehicles_require_merge_consistency`);
      await client.query(`UPDATE public.vehicles SET record_status = 'active', merged_into_vehicle_id = NULL, archived_at = NULL WHERE id = ANY($1::uuid[])`, [vehicles]);
      await client.query(`DELETE FROM public.vehicles WHERE id = ANY($1::uuid[])`, [vehicles]);
      await client.query(`ALTER TABLE public.vehicles ENABLE TRIGGER vehicles_merge_cycle_guard`);
      await client.query(`ALTER TABLE public.vehicles ENABLE TRIGGER vehicles_require_merge_consistency`);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const table of VEHICLE_TABLES) await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${table}_no_delete`);
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
      vehicles = [];
      insuredElsewhere = [];
      cleanups = [];
      operator = null;
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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `SCH ${label} ${id.slice(0, 8)} ${n()}`]);
    organizations.push(id);
    return id;
  }

  /** The VIN is unique per run and per vehicle: 17 hexadecimal digits are always a well-formed VIN body. */
  const vin = () => (randomUUID().replace(/-/g, "") + run).toUpperCase().slice(0, 17);
  const VINS = new Map<string, string>();

  /**
   * A vehicle as the operational-identity domain leaves it: an active identity row with its VIN and (optionally) an OPERATES
   * relationship with an Organization over [from, to), created by the table owner.
   */
  async function vehicle(over: { operatedBy?: string | null; from?: string; to?: string | null } = {}): Promise<string> {
    const id = randomUUID();
    const identifier = vin();
    await pools.admin.query(`INSERT INTO public.vehicles (id, vehicle_type_code, vin_display, vin_normalized) VALUES ($1, 'TRUCK_TRACTOR', $2, $2)`, [id, identifier]);
    vehicles.push(id);
    VINS.set(id, identifier);
    if (over.operatedBy) await operate(id, over.operatedBy, over.from ?? "2022-01-01", over.to ?? null);
    return id;
  }
  const operate = (vehicleId: string, organizationId: string, from: string, to: string | null = null) =>
    pools.admin.query(
      `INSERT INTO public.organization_vehicle_relationships (organization_id, vehicle_id, relationship_type, effective_from, effective_to) VALUES ($1, $2, 'OPERATES', $3::timestamptz, $4::timestamptz)`,
      [organizationId, vehicleId, `${from}T00:00:00Z`, to ? `${to}T00:00:00Z` : null],
    );

  /** Merges `source` into `target` as the vehicle-merge domain does: the ledger row and the vehicle columns in one owner transaction. */
  async function mergeVehicle(source: string, target: string): Promise<void> {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO public.vehicle_merges (source_vehicle_id, target_vehicle_id, merge_reason) VALUES ($1, $2, 'DUPLICATE_RECORD')`, [source, target]);
      await client.query(`UPDATE public.vehicles SET record_status = 'merged', merged_into_vehicle_id = $2, updated_at = now() WHERE id = $1`, [source, target]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  const archivedVehicle = async (organizationId: string) => {
    const id = await vehicle({ operatedBy: organizationId });
    await archiveVehicle(id);
    return id;
  };
  const mergedAway = async (organizationId: string, survivor: string) => {
    const id = await vehicle({ operatedBy: organizationId });
    await mergeVehicle(id, survivor);
    return id;
  };
  const archiveVehicle = (id: string) => pools.admin.query(`UPDATE public.vehicles SET record_status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1`, [id]);
  const dbToday = async () => (await pools.admin.query<{ today: string }>(`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS today`)).rows[0].today;
  const addDays = async (date: string, days: number) => (await pools.admin.query<{ d: string }>(`SELECT ($1::date + $2::int)::text AS d`, [date, days])).rows[0].d;

  async function staff(...capabilities: Capability[]): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    return actor;
  }
  const signIn = (actor: TestActor) => K.db.setClerkUser(actor.clerkSubject);
  async function fullStaff() {
    const actor = await staff(...BOTH);
    signIn(actor);
    operator = actor;
    return actor;
  }
  async function concurrentActors(count: number, ...capabilities: Capability[]) {
    const actors = await Promise.all(Array.from({ length: count }, () => staff(...(capabilities.length ? capabilities : BOTH))));
    return <T>(index: number, work: () => Promise<T>) => K.db.withClerkUser(actors[index].clerkSubject, work);
  }

  const num = (prefix = "SCH") => `${prefix}-${run}-${n()}`;
  const AL = (over: Record<string, unknown> = {}) => ({ coverageType: "AUTO_LIABILITY", limitAmount: "1000000", currency: "CAD", limitBasis: "COMBINED_SINGLE_LIMIT", ...over });
  const PD = (over: Record<string, unknown> = {}) => ({ coverageType: "PHYSICAL_DAMAGE", limitAmount: "250000", currency: "CAD", limitBasis: "PER_VEHICLE", ...over });
  const CARGO = (over: Record<string, unknown> = {}) => ({ coverageType: "MOTOR_TRUCK_CARGO", limitAmount: 100000, currency: "CAD", limitBasis: "PER_VEHICLE", ...over });

  /**
   * A policy with a vehicle-scheduled auto liability coverage and a whole-fleet cargo coverage; term 2023-01-01 .. 2024-01-01
   * unless overridden. `scheduled` is the scheduled coverage, `fleet` the one that lists no vehicles.
   */
  async function scheduledPolicy(over: { insured?: string; insurer?: string; termStart?: string; termEnd?: string; extra?: Array<Record<string, unknown>> } = {}) {
    const organizationId = over.insured ?? (await org("Insured"));
    const insurerOrganizationId = over.insurer ?? (await org("Insurer"));
    const view = await K.i.createPolicy({
      organizationId,
      insurerOrganizationId,
      family: "INSURANCE",
      policyNumber: num(),
      termStart: over.termStart ?? "2023-01-01",
      termEnd: over.termEnd ?? "2024-01-01",
      coverages: [AL({ scheduledVehiclesOnly: true }), CARGO(), ...(over.extra ?? [])],
    });
    const coverages = view.terms[0].coverages;
    const byType = (type: string) => coverages.find((c) => c.coverageType === type)!;
    return {
      organizationId,
      insurerOrganizationId,
      policyId: view.policy.id,
      termId: view.terms[0].term.id,
      scheduled: byType("AUTO_LIABILITY").id,
      fleet: byType("MOTOR_TRUCK_CARGO").id,
      extra: coverages.filter((c) => c.coverageType !== "AUTO_LIABILITY" && c.coverageType !== "MOTOR_TRUCK_CARGO").map((c) => c.id),
    };
  }
  type Setup = Awaited<ReturnType<typeof scheduledPolicy>>;

  /** A scheduled policy and an operated vehicle, plus a schedule started 2023-02-01 (open). */
  async function started() {
    const a = await scheduledPolicy();
    const v = await vehicle({ operatedBy: a.organizationId });
    const view = await schedule(a, v, "2023-02-01");
    const row = genuine(view)[0];
    return { ...a, v, scheduleId: row.id, view };
  }
  const schedule = (a: Setup, vehicleId: string, effectiveFrom: string, effectiveTo?: string) =>
    K.i.scheduleVehicle({ organizationId: a.organizationId, coverageId: a.scheduled, vehicleId, effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}) });

  /** The genuine entries of a view's history. A view defaults to today, long after the 2023 coverages these scenarios use have ended, so its `scheduled` list is empty. */
  const genuine = <T extends { recordStatus: string }>(view: { history: T[] }): T[] => view.history.filter((row) => row.recordStatus === "active");
  const rows = async (coverageId: string) =>
    (await pools.admin.query<{ id: string; vehicle_id: string; organization_id: string; schedule_reason: string; effective_from: string; effective_to: string | null; record_status: string; corrected_at: string | null; superseded_by_schedule_id: string | null }>(
      `SELECT id, vehicle_id, organization_id, schedule_reason, effective_from::text, effective_to::text, record_status, corrected_at::text, superseded_by_schedule_id FROM public.${TABLE} WHERE coverage_id = $1 ORDER BY effective_from, created_at, id`,
      [coverageId],
    )).rows;
  const snapshot = async (coverageId: string) => JSON.stringify((await pools.admin.query(`SELECT * FROM public.${TABLE} WHERE coverage_id = $1 ORDER BY id`, [coverageId])).rows);

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
  const rowCount = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const eventTypes = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`, [actorId])).rows.map((row) => row.event_type);
  const eventsJson = async (actorId: string) => JSON.stringify((await pools.admin.query(`SELECT * FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId])).rows);

  /** Makes the Master Register refuse every event of a type, or only those about one resource type (the schedule rows, say). */
  async function refuseMasterRegisterEvent(eventType: string, resourceType?: string) {
    const resource = resourceType ? ` AND NEW.target->>'resourceType' = '${resourceType}'` : "";
    await pools.admin.query(`
      CREATE OR REPLACE FUNCTION public.tes_test_fail_master_register() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = '${eventType}'${resource} THEN RAISE EXCEPTION 'test: master register write refused'; END IF;
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

  /**
   * Opens a transaction on a RUNTIME-role connection that carries one SYSTEM capability for an actor, exactly as
   * withAuthorizedSystem establishes it (transaction-local settings; row-level security re-proves the actor's grant).
   */
  async function contextClient(actor: TestActor, capability: string): Promise<PoolClient> {
    const client = await pools.runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('tes.system_actor_id', $1, true), set_config('tes.system_capability', $2, true)`, [actor.actorId, capability]);
      return client;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw error;
    }
  }

  /**
   * Runs statements in their own transaction on the named pool and returns the COMMIT outcome (deferred constraints fire at
   * commit). The runtime pool carries INSURANCE_MANAGE for the signed-in operator unless another capability is named; the
   * admin pool is the table owner and bypasses row-level security.
   */
  async function transaction(pool: "admin" | "runtime", statements: Statement[], capability = "INSURANCE_MANAGE", actor = operator): Promise<{ error?: Pg }> {
    let client: PoolClient;
    if (pool === "runtime") {
      assert.ok(actor, "a runtime transaction needs an actor that holds the capability");
      client = await contextClient(actor, capability);
    } else {
      client = await pools.admin.connect();
      await client.query("BEGIN");
    }
    try {
      for (const [sql, params] of statements) await client.query(sql, params);
      await client.query("COMMIT");
      return {};
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return { error: error as Pg };
    } finally {
      client.release();
    }
  }
  async function refuses(pool: "admin" | "runtime", statements: Statement[], expected: RegExp | { constraint: string; code?: string }, label: string, capability?: string, actor?: TestActor) {
    const outcome = await transaction(pool, statements, capability, actor);
    assert.ok(outcome.error, `${label}: expected the database to refuse`);
    if (expected instanceof RegExp) assert.match(outcome.error!.message, expected, label);
    else {
      assert.equal(outcome.error!.constraint, expected.constraint, `${label}: ${outcome.error!.message}`);
      if (expected.code) assert.equal(outcome.error!.code, expected.code, label);
    }
  }
  const accepts = async (pool: "admin" | "runtime", statements: Statement[], label: string) => {
    const outcome = await transaction(pool, statements);
    assert.equal(outcome.error, undefined, `${label}: ${outcome.error?.message}`);
  };
  const insertRow = (o: { coverageId: string; vehicleId: string; organizationId: string; from: string; to?: string | null; reason?: string; id?: string }): Statement => [
    `INSERT INTO public.${TABLE} (id, coverage_id, vehicle_id, organization_id, schedule_reason, effective_from, effective_to) VALUES ($1, $2, $3, $4, $5, $6::date, $7::date)`,
    [o.id ?? randomUUID(), o.coverageId, o.vehicleId, o.organizationId, o.reason ?? "INITIAL", o.from, o.to ?? null],
  ];
  const settled = <T>(results: PromiseSettledResult<T>[]) => ({
    won: results.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled"),
    lost: results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason as unknown),
  });

  // =============================================================================================================
  describe("schema (migration 0025)", () => {
    scenario("the table, its indexes and triggers exist and the migration ledger records 0025", async () => {
      assert.equal(await rowCount(`SELECT count(*) FROM pg_class WHERE oid = 'public.${TABLE}'::regclass`), 1);
      const indexes = (await pools.admin.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`, [TABLE])).rows.map((row) => row.indexname);
      assert.deepEqual(indexes, [
        "insurance_coverage_vehicles_coverage_idx", "insurance_coverage_vehicles_id_coverage_uq", "insurance_coverage_vehicles_no_overlap",
        "insurance_coverage_vehicles_pkey", "insurance_coverage_vehicles_vehicle_idx",
      ]);
      const triggers = (await pools.admin.query<{ tgname: string }>(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.${TABLE}'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows.map((row) => row.tgname);
      assert.deepEqual(triggers, [
        "insurance_coverage_vehicles_guard_active_organization", "insurance_coverage_vehicles_guard_insert", "insurance_coverage_vehicles_guard_update",
        "insurance_coverage_vehicles_guard_vehicle", "insurance_coverage_vehicles_no_delete", "insurance_coverage_vehicles_no_truncate",
      ]);
      assert.equal(await rowCount(`SELECT count(*) FROM tes_system.schema_migrations WHERE filename = '0025_insurance_scheduled_vehicles_foundation.sql'`), 1);
    });

    scenario("the TypeScript vocabulary agrees with the CHECK constraint (drift)", async () => {
      const defs = await import("@/lib/insurance/definitions");
      const definition = (await pools.admin.query<{ d: string }>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'insurance_coverage_vehicles_reason_valid'`)).rows[0].d;
      assert.deepEqual([...definition.matchAll(/'([A-Z_]+)'::text/g)].map((match) => match[1]), [...defs.SCHEDULE_REASONS]);
      const status = (await pools.admin.query<{ d: string }>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'insurance_coverage_vehicles_record_status_valid'`)).rows[0].d;
      assert.deepEqual([...status.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]), ["active", "corrected"]);
    });

    scenario("capabilities: the two Insurance capabilities are unchanged, SYSTEM-only and granted to nobody by the migration", async () => {
      const rows = (await pools.admin.query<{ code: string; description: string; is_active: boolean }>(`SELECT code, description, is_active FROM public.capabilities WHERE code LIKE 'INSURANCE\\_%' ORDER BY sort_order`)).rows;
      assert.deepEqual(rows.map((row) => row.code), ["INSURANCE_READ", "INSURANCE_MANAGE"]);
      for (const row of rows) {
        assert.match(row.description, /Intended scope: SYSTEM only\.$/);
        assert.equal(row.is_active, true);
      }
      const tes = await import("@/lib/auth/tes-capabilities");
      assert.equal(tes.TES_CAPABILITY_SCOPES.INSURANCE_READ, "SYSTEM");
      assert.equal(tes.TES_CAPABILITY_SCOPES.INSURANCE_MANAGE, "SYSTEM");
      assert.equal(await rowCount(`SELECT count(*) FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id WHERE c.code LIKE 'INSURANCE\\_%' AND g.created_at < now() - interval '1 day'`), 0);
    });

    scenario("the four functions pin their search_path and have no PUBLIC execute; exactly one is SECURITY DEFINER and the runtime role cannot execute it", async () => {
      const functions = (await pools.admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; public_execute: boolean; runtime_execute: boolean }>(
        `SELECT p.proname, p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
                has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname ~ 'insurance_schedule' ORDER BY p.proname`,
        [RUNTIME_ROLE],
      )).rows;
      assert.deepEqual(functions.map((fn) => fn.proname), ["guard_insurance_schedule_insert", "guard_insurance_schedule_update", "guard_insurance_schedule_vehicle", "prevent_insurance_schedule_data_removal"]);
      for (const fn of functions) {
        assert.equal(fn.prosecdef, fn.proname === "guard_insurance_schedule_vehicle", fn.proname);
        assert.deepEqual(fn.proconfig, ["search_path=pg_catalog"], fn.proname);
        assert.equal(fn.public_execute, false, fn.proname);
        assert.equal(fn.runtime_execute, false, `${fn.proname}: the trigger runs as the table's DML caller; nobody calls it directly`);
      }
    });

    scenario("runtime privileges: SELECT, column-specific INSERT/UPDATE, no DELETE, TRUNCATE, REFERENCES or TRIGGER, nothing for PUBLIC", async () => {
      const has = async (privilege: string) => (await pools.admin.query(`SELECT has_table_privilege($1, $2::regclass, $3) AS ok`, [RUNTIME_ROLE, `public.${TABLE}`, privilege])).rows[0].ok;
      const column = async (name: string, privilege: string) => (await pools.admin.query(`SELECT has_column_privilege($1, $2::regclass, $3, $4) AS ok`, [RUNTIME_ROLE, `public.${TABLE}`, name, privilege])).rows[0].ok;
      for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) assert.equal(await has(privilege), false, privilege);
      assert.equal(await has("SELECT"), true);
      assert.equal(await rowCount(`SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'PUBLIC'`, [TABLE]), 0);
      await assert.rejects(pools.runtime.query(`DELETE FROM public.${TABLE}`), /permission denied/);
      await assert.rejects(pools.runtime.query(`TRUNCATE public.${TABLE}`), /permission denied/);
      const all = (await pools.admin.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [TABLE])).rows.map((row) => row.column_name);
      const writable: string[] = [];
      const insertable: string[] = [];
      for (const name of all) {
        if (await column(name, "UPDATE")) writable.push(name);
        if (await column(name, "INSERT")) insertable.push(name);
      }
      assert.deepEqual(writable.sort(), ["corrected_at", "effective_to", "record_status", "superseded_by_schedule_id", "updated_at"]);
      assert.deepEqual(insertable.sort(), ["coverage_id", "effective_from", "effective_to", "id", "organization_id", "schedule_reason", "vehicle_id"]);
      for (const name of ["id", "coverage_id", "vehicle_id", "organization_id", "schedule_reason", "effective_from", "created_at"]) assert.equal(await column(name, "UPDATE"), false, `${name} is immutable for the runtime role`);
    });
  });

  // =============================================================================================================
  describe("authorization", () => {
    scenario("no session, no capability and the wrong capability are denied and change nothing; READ cannot mutate; MANAGE cannot read", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      const spare = await vehicle({ operatedBy: a.organizationId });
      const first = genuine(await schedule(a, v, "2023-02-01"))[0];
      const before = await snapshot(a.scheduled);
      const input = { organizationId: a.organizationId, coverageId: a.scheduled, vehicleId: spare, effectiveFrom: "2023-03-01" };

      K.db.setClerkUser(null);
      await assert.rejects(K.i.getCoverageSchedule(a.scheduled));
      await assert.rejects(K.i.getVehicleInsurance(v));
      await assert.rejects(K.i.scheduleVehicle(input));

      signIn(await staff());
      await denied(K.i.getCoverageSchedule(a.scheduled));
      await denied(K.i.getVehicleInsurance(v));
      for (const other of ["ORGANIZATION_READ", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "CONTACT_MANAGE", "VEHICLE_READ", "VEHICLE_MANAGE"]) {
        const actor = await fx.actor();
        const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
        const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
        await fx.grant(relationshipId, other, { assignmentId });
        signIn(actor);
        await denied(K.i.getCoverageSchedule(a.scheduled));
        await denied(K.i.getVehicleInsurance(v));
        await denied(K.i.scheduleVehicle(input));
      }

      const mutations: Array<[string, unknown]> = [
        ["scheduleVehicle", input],
        ["removeScheduledVehicle", { scheduleId: first.id, effectiveTo: "2023-06-01" }],
        ["changeSchedule", { scheduleId: first.id, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" }],
        ["correctSchedule", { scheduleId: first.id, vehicleId: spare }],
      ];
      const call = (name: string, args: unknown) => (K.i as unknown as Record<string, (input: unknown) => Promise<unknown>>)[name](args);
      signIn(await staff("INSURANCE_READ"));
      assert.equal((await K.i.getCoverageSchedule(a.scheduled)).history.length, 1);
      await denied(K.i.getVehicleInsurance(v));
      for (const [name, args] of mutations) await denied(call(name, args));

      // a vehicle's insurance needs BOTH reads: the vehicle merge chain is VEHICLE_READ, the schedule INSURANCE_READ
      signIn(await staff("INSURANCE_READ", "VEHICLE_READ"));
      assert.equal((await K.i.getVehicleInsurance(v)).history.length, 1);
      for (const [name, args] of mutations) await denied(call(name, args));

      signIn(await staff("INSURANCE_MANAGE", "VEHICLE_READ"));
      await denied(K.i.getCoverageSchedule(a.scheduled));
      await denied(K.i.getVehicleInsurance(v));

      signIn(await staff("INSURANCE_MANAGE"));
      await denied(K.i.getCoverageSchedule(a.scheduled));
      await denied(K.i.getVehicleInsurance(v));
      assert.equal(await snapshot(a.scheduled), before, "no denied call changed anything");
      const view = await K.i.scheduleVehicle(input);
      assert.equal(view.history.length, 2, "MANAGE alone can mutate, although the transaction carries no VEHICLE policy");
    });

    scenario("a customer actor, even with ORGANIZATION_READ, reaches nothing; the service has no customer-scope path", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      const customerA = await fx.organizationAndCustomer("CustA");
      const user = await fx.actor();
      const relationshipId = await fx.relationship(user.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customerA.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      signIn(user);
      await denied(K.i.getCoverageSchedule(a.scheduled));
      await denied(K.i.getVehicleInsurance(v));
      await denied(schedule(a, v, "2023-02-01"));
      assert.equal(await rowCount(`SELECT count(*) FROM public.${TABLE} WHERE coverage_id = $1`, [a.scheduled]), 0);
    });
  });

  // =============================================================================================================
  describe("scheduleVehicle", () => {
    scenario("starts an open window on a vehicle-scheduled coverage; reads are as-of and the entry is genuine, INITIAL and open", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      const view = await schedule(a, v, "2023-02-01");
      assert.equal(view.coverageId, a.scheduled);
      assert.equal(view.organizationId, a.organizationId);
      assert.equal(view.coverage.scheduledVehiclesOnly, true);
      assert.equal(view.history.length, 1);
      assert.equal(view.scheduled.length, 0, "the view defaults to today, after this 2023 coverage ended");
      const [row] = view.history;
      assert.deepEqual(
        { vehicleId: row.vehicleId, organizationId: row.organizationId, coverageId: row.coverageId, reason: row.scheduleReason, from: row.effectiveFrom, to: row.effectiveTo, status: row.recordStatus, correctedAt: row.correctedAt, by: row.supersededById },
        { vehicleId: v, organizationId: a.organizationId, coverageId: a.scheduled, reason: "INITIAL", from: "2023-02-01", to: null, status: "active", correctedAt: null, by: null },
      );
      assert.deepEqual((await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-03-01" })).scheduled, view.history);

      // as-of reads are half-open on the start day
      assert.equal((await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-01-31" })).scheduled.length, 0);
      assert.equal((await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-02-01" })).scheduled.length, 1);
      assert.equal((await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-12-31" })).scheduled.length, 1);
      assert.equal((await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-12-31" })).asOfDate, "2023-12-31");
      assert.equal((await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-01-31" })).history.length, 1, "history does not depend on the as-of date");
      const insurance = await K.i.getVehicleInsurance(v, { asOf: "2023-03-01" });
      assert.equal(insurance.vehicleId, v);
      assert.equal(insurance.resolvedVehicleId, v);
      assert.equal(insurance.scheduled.length, 1);
      assert.equal(insurance.scheduled[0].coverage.id, a.scheduled);
      assert.equal(insurance.scheduled[0].coverage.coverageType, "AUTO_LIABILITY");
      assert.equal(insurance.scheduled[0].policyId, a.policyId);
      assert.equal(insurance.scheduled[0].organizationId, a.organizationId);
      assert.equal((await K.i.getVehicleInsurance(v, { asOf: "2023-01-31" })).scheduled.length, 0);
    });

    scenario("an already ended window may be recorded; adjacent windows of one vehicle are allowed, overlapping ones are not", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      const ended = await schedule(a, v, "2023-02-01", "2023-05-01");
      assert.equal(ended.history[0].effectiveTo, "2023-05-01");
      assert.equal((await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-05-01" })).scheduled.length, 0, "the end day is excluded");
      assert.equal((await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-04-30" })).scheduled.length, 1);
      const next = await schedule(a, v, "2023-05-01");
      assert.equal(next.history.length, 2);
      await conflict(schedule(a, v, "2023-04-01", "2023-06-01"));
      await conflict(schedule(a, v, "2023-08-01"));
      assert.equal((await rows(a.scheduled)).length, 2);
    });

    scenario("a vehicle may be scheduled on several coverages and a coverage may schedule several vehicles", async () => {
      await fullStaff();
      const a = await scheduledPolicy({ extra: [PD({ scheduledVehiclesOnly: true })] });
      const [pd] = a.extra;
      const [v1, v2] = [await vehicle({ operatedBy: a.organizationId }), await vehicle({ operatedBy: a.organizationId })];
      await schedule(a, v1, "2023-02-01");
      await schedule(a, v2, "2023-02-01");
      await K.i.scheduleVehicle({ organizationId: a.organizationId, coverageId: pd, vehicleId: v1, effectiveFrom: "2023-03-01" });
      assert.equal((await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-04-01" })).scheduled.length, 2);
      const insurance = await K.i.getVehicleInsurance(v1, { asOf: "2023-04-01" });
      assert.deepEqual(insurance.scheduled.map((s) => s.coverage.coverageType).sort(), ["AUTO_LIABILITY", "PHYSICAL_DAMAGE"]);
      assert.equal((await K.i.getVehicleInsurance(v1, { asOf: "2023-02-15" })).scheduled.length, 1);
      assert.equal((await K.i.getVehicleInsurance(v2, { asOf: "2023-04-01" })).scheduled.length, 1);
    });

    scenario("refusals: a coverage that does not list vehicles, another Organization's coverage, a missing coverage, Organization or vehicle", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const b = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      const before = await snapshot(a.scheduled);
      await stateError(K.i.scheduleVehicle({ organizationId: a.organizationId, coverageId: a.fleet, vehicleId: v, effectiveFrom: "2023-02-01" }));
      // the coverage belongs to Organization B: it is simply not found for A, and nothing of B is changed or disclosed
      await notFound(K.i.scheduleVehicle({ organizationId: a.organizationId, coverageId: b.scheduled, vehicleId: v, effectiveFrom: "2023-02-01" }));
      await notFound(K.i.scheduleVehicle({ organizationId: b.organizationId, coverageId: a.scheduled, vehicleId: v, effectiveFrom: "2023-02-01" }));
      await notFound(K.i.scheduleVehicle({ organizationId: a.organizationId, coverageId: randomUUID(), vehicleId: v, effectiveFrom: "2023-02-01" }));
      await notFound(K.i.scheduleVehicle({ organizationId: randomUUID(), coverageId: a.scheduled, vehicleId: v, effectiveFrom: "2023-02-01" }));
      // a vehicle the database cannot find is refused like an inactive one: the transaction carries no VEHICLE policy, so it cannot tell them apart
      await stateError(K.i.scheduleVehicle({ organizationId: a.organizationId, coverageId: a.scheduled, vehicleId: randomUUID(), effectiveFrom: "2023-02-01" }));
      assert.equal(await snapshot(a.scheduled), before);
      assert.equal(await rowCount(`SELECT count(*) FROM public.${TABLE} WHERE coverage_id = $1`, [b.scheduled]), 0);
    });

    scenario("refusals: the vehicle must be operated by the insured Organization when the schedule starts", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const other = await org("Other carrier");
      const unoperated = await vehicle();
      const theirs = await vehicle({ operatedBy: other });
      const late = await vehicle({ operatedBy: a.organizationId, from: "2023-06-01" });
      const gone = await vehicle({ operatedBy: a.organizationId, from: "2022-01-01", to: "2023-03-01" });
      await invalid(schedule(a, unoperated, "2023-02-01"));
      await invalid(schedule(a, theirs, "2023-02-01"));
      await invalid(schedule(a, late, "2023-02-01"));
      await invalid(schedule(a, gone, "2023-03-01"));
      await schedule(a, late, "2023-06-01");
      await schedule(a, gone, "2023-02-28");
      assert.equal((await rows(a.scheduled)).length, 2);
    });

    scenario("refusals: the window must lie inside the coverage, which ends at the earliest of its end, its term's end and a cancellation", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      await invalid(schedule(a, v, "2022-12-31"));
      await invalid(schedule(a, v, "2024-01-01"));
      await invalid(schedule(a, v, "2023-02-01", "2024-01-02"));
      await invalid(schedule(a, v, "2023-02-01", "2023-02-01"));
      await invalid(schedule(a, v, "2023-02-01", "2023-01-15"));
      await schedule(a, v, "2023-02-01", "2024-01-01");
      // a cancellation shortens the coverage: nothing can be scheduled after it
      const b = await scheduledPolicy();
      const w = await vehicle({ operatedBy: b.organizationId });
      await K.i.cancelTerm({ termId: b.termId, cancelledOn: "2023-07-01", reason: "INSURED_REQUEST" });
      await invalid(schedule(b, w, "2023-07-01"));
      await invalid(schedule(b, w, "2023-02-01", "2023-07-02"));
      await schedule(b, w, "2023-02-01");
      await schedule(b, await vehicle({ operatedBy: b.organizationId }), "2023-02-01", "2023-07-01");
      assert.equal((await rows(b.scheduled)).length, 2);
    });

    scenario("refusals: dates in the future, malformed input and unknown keys", async () => {
      await fullStaff();
      const today = await dbToday();
      const a = await scheduledPolicy({ termStart: await addDays(today, -100), termEnd: await addDays(today, 200) });
      const v = await vehicle({ operatedBy: a.organizationId, from: await addDays(today, -400) });
      await invalid(schedule(a, v, await addDays(today, 1)));
      await invalid(schedule(a, v, await addDays(today, -10), await addDays(today, 5)));
      const bad = (over: Record<string, unknown>) => K.i.scheduleVehicle({ organizationId: a.organizationId, coverageId: a.scheduled, vehicleId: v, effectiveFrom: today, ...over });
      await invalid(bad({ organizationId: "not-a-uuid" }));
      await invalid(bad({ coverageId: 42 }));
      await invalid(bad({ vehicleId: undefined }));
      await invalid(bad({ effectiveFrom: "2023-02-30" }));
      await invalid(bad({ effectiveFrom: undefined }));
      await invalid(bad({ effectiveTo: "tomorrow" }));
      await invalid(bad({ status: "active" }));
      await invalid(bad({ effectiveFrom: new Date() }));
      await invalid(K.i.scheduleVehicle(null));
      await invalid(K.i.scheduleVehicle([]));
      await invalid(K.i.scheduleVehicle("x"));
      assert.equal(await rowCount(`SELECT count(*) FROM public.${TABLE} WHERE coverage_id = $1`, [a.scheduled]), 0);
      assert.equal((await schedule(a, v, today)).scheduled.length, 1, "today is allowed");
    });

    scenario("refusals: an archived or merged vehicle cannot be newly scheduled", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const archived = await vehicle({ operatedBy: a.organizationId });
      const merged = await vehicle({ operatedBy: a.organizationId });
      const survivor = await vehicle({ operatedBy: a.organizationId });
      await archiveVehicle(archived);
      await mergeVehicle(merged, survivor);
      await stateError(schedule(a, archived, "2023-02-01"));
      await stateError(schedule(a, merged, "2023-02-01"));
      assert.equal(await rowCount(`SELECT count(*) FROM public.${TABLE} WHERE coverage_id = $1`, [a.scheduled]), 0);
      assert.equal(genuine(await schedule(a, survivor, "2023-02-01")).length, 1);
    });

    scenario("refusals: an archived or merged insured Organization, an archived policy and a corrected coverage or term", async () => {
      await fullStaff();
      const archivedOrg = await scheduledPolicy();
      const mergedOrg = await scheduledPolicy();
      const archivedPolicy = await scheduledPolicy();
      const corrected = await scheduledPolicy();
      const correctedTerm = await scheduledPolicy();
      const plan = [archivedOrg, mergedOrg, archivedPolicy, corrected, correctedTerm];
      const vs = await Promise.all(plan.map((p) => vehicle({ operatedBy: p.organizationId })));
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archivedOrg.organizationId]);
      const survivor = await org("Survivor");
      await pools.admin.query(`UPDATE public.organizations SET status = 'merged', merged_into_organization_id = $2 WHERE id = $1`, [mergedOrg.organizationId, survivor]);
      await K.i.archivePolicy({ policyId: archivedPolicy.policyId });
      await K.i.correctCoverage({ coverageId: corrected.scheduled, limitAmount: "2000000" });
      await K.i.correctTerm({ termId: correctedTerm.termId, policyNumber: num("FIX") });
      for (const [index, p] of plan.entries()) await stateError(schedule(p, vs[index], "2023-02-01"));
      for (const p of plan) assert.equal(await rowCount(`SELECT count(*) FROM public.${TABLE} WHERE coverage_id = $1`, [p.scheduled]), 0);
      // reads still work on all of them
      assert.equal((await K.i.getCoverageSchedule(archivedOrg.scheduled)).history.length, 0);
      assert.equal((await K.i.getCoverageSchedule(corrected.scheduled)).scheduled.length, 0);
    });

    scenario("an archived or merged insured Organization refuses every schedule write; reads still work", async () => {
      await fullStaff();
      const s = await started();
      const survivor = await org("Survivor");
      const spare = await vehicle({ operatedBy: s.organizationId });
      for (const change of [
        `UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`,
        `UPDATE public.organizations SET status = 'merged', merged_into_organization_id = '${survivor}' WHERE id = $1`,
      ]) {
        await pools.admin.query(`UPDATE public.organizations SET status = 'active', archived_at = NULL, merged_into_organization_id = NULL WHERE id = $1`, [s.organizationId]);
        await pools.admin.query(change, [s.organizationId]);
        const before = await snapshot(s.scheduled);
        await stateError(schedule(s, spare, "2023-03-01"));
        await stateError(K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01" }));
        await stateError(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" }));
        await stateError(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: spare }));
        assert.equal(await snapshot(s.scheduled), before);
        assert.equal((await K.i.getCoverageSchedule(s.scheduled, { asOf: "2023-03-01" })).scheduled.length, 1, "reads still work");
        assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2023-03-01" })).scheduled.length, 1);
      }
    });

    scenario("a duplicate current entry is refused with a domain conflict and changes nothing", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      await schedule(a, v, "2023-02-01");
      const before = await snapshot(a.scheduled);
      await conflict(schedule(a, v, "2023-02-01"));
      await conflict(schedule(a, v, "2023-03-01"));
      await conflict(schedule(a, v, "2023-01-15"));
      assert.equal(await snapshot(a.scheduled), before);
    });
  });

  // =============================================================================================================
  describe("removeScheduledVehicle", () => {
    scenario("ends the open window on the given day; the entry stays as history and reads are as-of", async () => {
      await fullStaff();
      const s = await started();
      const view = await K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01" });
      assert.equal(view.scheduled.length, 0, "nothing is scheduled today");
      assert.equal(view.history.length, 1);
      assert.equal(view.history[0].effectiveTo, "2023-06-01");
      assert.equal(view.history[0].recordStatus, "active", "a removal is a real-world end, not a correction");
      assert.equal((await K.i.getCoverageSchedule(s.scheduled, { asOf: "2023-05-31" })).scheduled.length, 1);
      assert.equal((await K.i.getCoverageSchedule(s.scheduled, { asOf: "2023-06-01" })).scheduled.length, 0);
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2023-05-31" })).scheduled.length, 1);
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2023-06-01" })).scheduled.length, 0);
      // the vehicle can be scheduled again afterwards
      assert.equal((await schedule(s, s.v, "2023-06-01")).history.length, 2);
    });

    scenario("the end defaults to the database date and cannot be in the future", async () => {
      await fullStaff();
      const today = await dbToday();
      const a = await scheduledPolicy({ termStart: await addDays(today, -100), termEnd: await addDays(today, 200) });
      const v = await vehicle({ operatedBy: a.organizationId, from: await addDays(today, -400) });
      const start = await addDays(today, -30);
      const id = (await schedule(a, v, start)).scheduled[0].id;
      await invalid(K.i.removeScheduledVehicle({ scheduleId: id, effectiveTo: await addDays(today, 1) }));
      const view = await K.i.removeScheduledVehicle({ scheduleId: id });
      assert.equal(view.history[0].effectiveTo, today);
    });

    scenario("refusals: unknown, already ended, corrected, not after the start, past the coverage, malformed", async () => {
      await fullStaff();
      const s = await started();
      await notFound(K.i.removeScheduledVehicle({ scheduleId: randomUUID(), effectiveTo: "2023-06-01" }));
      await invalid(K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-02-01" }));
      await invalid(K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-01-01" }));
      await invalid(K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2024-01-02" }));
      await invalid(K.i.removeScheduledVehicle({ scheduleId: "x" }));
      await invalid(K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-13-01" }));
      await invalid(K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01", reason: "x" }));
      await invalid(K.i.removeScheduledVehicle(undefined));
      assert.equal((await rows(s.scheduled))[0].effective_to, null);
      await K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01" });
      await stateError(K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-07-01" }));
      // a corrected entry is history
      const t = await started();
      const spare = await vehicle({ operatedBy: t.organizationId });
      await K.i.correctSchedule({ scheduleId: t.scheduleId, vehicleId: spare });
      await stateError(K.i.removeScheduledVehicle({ scheduleId: t.scheduleId, effectiveTo: "2023-07-01" }));
    });

    scenario("an archived vehicle can still be removed from a schedule, an archived Organization or policy cannot", async () => {
      await fullStaff();
      const s = await started();
      await archiveVehicle(s.v);
      const view = await K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01" });
      assert.equal(view.history[0].effectiveTo, "2023-06-01");
      const t = await started();
      await K.i.archivePolicy({ policyId: t.policyId });
      await stateError(K.i.removeScheduledVehicle({ scheduleId: t.scheduleId, effectiveTo: "2023-06-01" }));
      await K.i.restorePolicy({ policyId: t.policyId });
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [t.organizationId]);
      await stateError(K.i.removeScheduledVehicle({ scheduleId: t.scheduleId, effectiveTo: "2023-06-01" }));
      assert.equal((await rows(t.scheduled))[0].effective_to, null);
    });
  });

  // =============================================================================================================
  describe("changeSchedule", () => {
    scenario("ends the open window at T and starts the next, bounded, window at T (reason CHANGE); both stay genuine history", async () => {
      await fullStaff();
      const s = await started();
      const view = await K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" });
      assert.equal(view.history.length, 2);
      const [first, second] = view.history;
      assert.deepEqual([first.id, first.effectiveFrom, first.effectiveTo, first.recordStatus, first.scheduleReason], [s.scheduleId, "2023-02-01", "2023-04-01", "active", "INITIAL"]);
      assert.deepEqual([second.effectiveFrom, second.effectiveTo, second.recordStatus, second.scheduleReason, second.vehicleId], ["2023-04-01", "2023-09-01", "active", "CHANGE", s.v]);
      for (const [asOf, expected] of [["2023-03-31", first.id], ["2023-04-01", second.id], ["2023-08-31", second.id]] as const) {
        const read = await K.i.getCoverageSchedule(s.scheduled, { asOf });
        assert.deepEqual(read.scheduled.map((row) => row.id), [expected], asOf);
      }
      assert.equal((await K.i.getCoverageSchedule(s.scheduled, { asOf: "2023-09-01" })).scheduled.length, 0);
    });

    scenario("refusals: not after the start, unchanged shape, outside the coverage, future, ended or corrected entry, inactive vehicle, vehicle no longer operated", async () => {
      await fullStaff();
      const s = await started();
      await invalid(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-02-01", effectiveTo: "2023-09-01" }));
      await invalid(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-01-01", effectiveTo: "2023-09-01" }));
      await invalid(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01" }));
      await invalid(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-04-01" }));
      await invalid(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2024-01-02" }));
      await invalid(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2024-01-01", effectiveTo: "2024-02-01" }));
      await invalid(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2999-01-01", effectiveTo: "2999-02-01" }));
      await invalid(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01", vehicleId: randomUUID() }));
      await notFound(K.i.changeSchedule({ scheduleId: randomUUID(), effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" }));
      assert.equal((await rows(s.scheduled)).length, 1);
      assert.equal((await rows(s.scheduled))[0].effective_to, null);

      await archiveVehicle(s.v);
      await stateError(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" }));
      assert.equal((await rows(s.scheduled)).length, 1, "the refusal left the open window untouched");

      const t = await started();
      await K.i.removeScheduledVehicle({ scheduleId: t.scheduleId, effectiveTo: "2023-06-01" });
      await stateError(K.i.changeSchedule({ scheduleId: t.scheduleId, effectiveFrom: "2023-07-01", effectiveTo: "2023-09-01" }));

      // the vehicle stopped being operated by the Organization before T
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId, from: "2022-01-01", to: "2023-05-01" });
      const id = genuine(await schedule(a, v, "2023-02-01"))[0].id;
      await invalid(K.i.changeSchedule({ scheduleId: id, effectiveFrom: "2023-06-01", effectiveTo: "2023-09-01" }));
      assert.equal((await rows(a.scheduled)).length, 1);
    });
  });

  // =============================================================================================================
  describe("correctSchedule", () => {
    scenario("corrects the vehicle of an open entry: the wrong row is kept, flagged and frozen; the replacement inherits the window", async () => {
      await fullStaff();
      const s = await started();
      const right = await vehicle({ operatedBy: s.organizationId });
      const view = await K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: right });
      assert.equal(view.history.length, 2);
      const wrong = view.history.find((row) => row.id === s.scheduleId)!;
      const replacement = view.history.find((row) => row.id !== s.scheduleId)!;
      assert.equal(wrong.recordStatus, "corrected");
      assert.ok(wrong.correctedAt);
      assert.equal(wrong.supersededById, replacement.id);
      assert.equal(wrong.vehicleId, s.v, "the wrong entry is preserved as it was recorded");
      assert.equal(wrong.effectiveTo, null);
      assert.deepEqual([replacement.vehicleId, replacement.effectiveFrom, replacement.effectiveTo, replacement.recordStatus, replacement.scheduleReason, replacement.supersededById], [right, "2023-02-01", null, "active", "CORRECTION", null]);
      assert.deepEqual(genuine(view).map((row) => row.id), [replacement.id], "only the genuine entry counts");
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2023-03-01" })).scheduled.length, 0);
      assert.equal((await K.i.getVehicleInsurance(s.v)).history.length, 1, "the wrong entry is still in the vehicle's history, flagged");
      assert.equal((await K.i.getVehicleInsurance(right, { asOf: "2023-03-01" })).scheduled.length, 1);
    });

    scenario("corrects an ENDED entry too: the replacement is created with the same ended window", async () => {
      await fullStaff();
      const s = await started();
      await K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01" });
      const right = await vehicle({ operatedBy: s.organizationId });
      const view = await K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: right });
      const replacement = view.history.find((row) => row.vehicleId === right)!;
      assert.deepEqual([replacement.effectiveFrom, replacement.effectiveTo, replacement.scheduleReason, replacement.recordStatus], ["2023-02-01", "2023-06-01", "CORRECTION", "active"]);
      assert.equal(view.history.find((row) => row.id === s.scheduleId)!.recordStatus, "corrected");
      assert.equal((await K.i.getCoverageSchedule(s.scheduled, { asOf: "2023-03-01" })).scheduled[0].vehicleId, right);
      assert.equal((await K.i.getCoverageSchedule(s.scheduled, { asOf: "2023-06-01" })).scheduled.length, 0);
      // the replacement is a genuine entry: it can be corrected again, and the chain is preserved
      const again = await vehicle({ operatedBy: s.organizationId });
      const second = await K.i.correctSchedule({ scheduleId: replacement.id, vehicleId: again });
      assert.equal(second.history.length, 3);
      assert.deepEqual(second.history.map((row) => row.recordStatus).sort(), ["active", "corrected", "corrected"]);
      assert.equal(second.history.find((row) => row.vehicleId === again)!.effectiveTo, "2023-06-01");
    });

    scenario("corrects an entry that a change split in two: each half keeps its own window", async () => {
      await fullStaff();
      const s = await started();
      const changed = await K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" });
      const right = await vehicle({ operatedBy: s.organizationId });
      const view = await K.i.correctSchedule({ scheduleId: changed.history[0].id, vehicleId: right });
      const genuine = view.history.filter((row) => row.recordStatus === "active");
      assert.deepEqual(genuine.map((row) => [row.vehicleId, row.effectiveFrom, row.effectiveTo]), [[right, "2023-02-01", "2023-04-01"], [s.v, "2023-04-01", "2023-09-01"]]);
    });

    scenario("refusals: unchanged, unknown, already corrected, vehicle not operated at the start, overlapping entry of the target vehicle, inactive or missing vehicle", async () => {
      await fullStaff();
      const s = await started();
      const right = await vehicle({ operatedBy: s.organizationId });
      await invalid(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: s.v }));
      await notFound(K.i.correctSchedule({ scheduleId: randomUUID(), vehicleId: right }));
      await stateError(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: randomUUID() }));
      await invalid(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: await vehicle() }));
      await invalid(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: await vehicle({ operatedBy: s.organizationId, from: "2023-03-01" }) }));
      await invalid(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: right, effectiveFrom: "2023-02-02" }));
      await invalid(K.i.correctSchedule({ scheduleId: s.scheduleId }));
      const archived = await vehicle({ operatedBy: s.organizationId });
      await archiveVehicle(archived);
      await stateError(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: archived }));
      // the target vehicle is already scheduled on that coverage in an overlapping window
      await schedule(s, right, "2023-03-01");
      await conflict(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: right }));
      await assert.rejects(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: right }), /already scheduled on the coverage/);
      assert.equal((await rows(s.scheduled)).filter((row) => row.record_status === "corrected").length, 0, "every refusal left the entries genuine");
      // corrected rows are history: they cannot be corrected again
      const spare = await vehicle({ operatedBy: s.organizationId });
      await K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: spare });
      await stateError(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: await vehicle({ operatedBy: s.organizationId }) }));
    });

    scenario("a coverage that was itself corrected keeps its entries as frozen history and takes no changes; its replacement carries the schedule", async () => {
      await fullStaff();
      const s = await started();
      const right = await vehicle({ operatedBy: s.organizationId });
      const view = await K.i.correctCoverage({ coverageId: s.scheduled, limitAmount: "3000000" });
      const replacement = view.terms[0].coverages.find((c) => c.coverageType === "AUTO_LIABILITY" && c.recordStatus === "active")!;
      assert.notEqual(replacement.id, s.scheduled);
      await stateError(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: right }));
      await stateError(K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01" }));
      await stateError(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" }));
      const old = await K.i.getCoverageSchedule(s.scheduled, { asOf: "2023-03-01" });
      assert.equal(old.scheduled.length, 0, "a corrected coverage never counts");
      assert.equal(old.history.length, 1);
      assert.equal(old.coverage.recordStatus, "corrected");
      const carried = await K.i.getCoverageSchedule(replacement.id, { asOf: "2023-03-01" });
      assert.deepEqual(carried.scheduled.map((row) => [row.vehicleId, row.effectiveFrom, row.effectiveTo]), [[s.v, "2023-02-01", null]]);
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2023-03-01" })).scheduled[0].coverage.id, replacement.id);
      assert.equal((await K.i.getVehicleInsurance(s.v)).history.length, 2, "frozen original plus carried row");
    });
  });

  // =============================================================================================================
  describe("correctCoverage carries the schedule", () => {
    /** A scheduled policy with an open entry, an ended entry and a corrected entry (the corrected one must not be carried). */
    async function busy() {
      const s = await started();
      const [ended, wrong, right] = [await vehicle({ operatedBy: s.organizationId }), await vehicle({ operatedBy: s.organizationId }), await vehicle({ operatedBy: s.organizationId })];
      await schedule(s, ended, "2023-03-01", "2023-08-01");
      const wrongId = (await schedule(s, wrong, "2023-04-01")).history.find((row) => row.vehicleId === wrong)!.id;
      await K.i.correctSchedule({ scheduleId: wrongId, vehicleId: right });
      return { ...s, ended, wrong, right };
    }
    const replacementOf = (view: Awaited<ReturnType<typeof K.i.correctCoverage>>) => view.terms[0].coverages.find((c) => c.coverageType === "AUTO_LIABILITY" && c.recordStatus === "active")!.id;

    scenario("open and ended entries move with their vehicles and windows; the corrected coverage keeps its history untouched", async () => {
      await fullStaff();
      const s = await busy();
      const before = await snapshot(s.scheduled);
      const replacementId = replacementOf(await K.i.correctCoverage({ coverageId: s.scheduled, limitAmount: "3000000" }));
      assert.equal(await snapshot(s.scheduled), before, "the frozen coverage's rows are exactly as they were");
      const carried = (await rows(replacementId)).map((row) => [row.vehicle_id, row.effective_from, row.effective_to, row.schedule_reason, row.record_status, row.organization_id]);
      assert.deepEqual(carried, [
        [s.v, "2023-02-01", null, "CORRECTION", "active", s.organizationId],
        [s.ended, "2023-03-01", "2023-08-01", "CORRECTION", "active", s.organizationId],
        [s.right, "2023-04-01", null, "CORRECTION", "active", s.organizationId],
      ]);
      const read = await K.i.getCoverageSchedule(replacementId, { asOf: "2023-05-01" });
      assert.deepEqual(read.scheduled.map((row) => row.vehicleId).sort(), [s.v, s.ended, s.right].sort());
      assert.equal((await K.i.getCoverageSchedule(replacementId, { asOf: "2023-09-01" })).scheduled.length, 2);
      // the carried rows are ordinary genuine entries: they can be ended and corrected
      const open = read.scheduled.find((row) => row.vehicleId === s.v)!;
      assert.equal((await K.i.removeScheduledVehicle({ scheduleId: open.id, effectiveTo: "2023-10-01" })).history.find((row) => row.id === open.id)!.effectiveTo, "2023-10-01");
    });

    scenario("a correction that does not touch the schedule's coverage, or a coverage without entries, behaves as before", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      await schedule(a, v, "2023-02-01");
      const view = await K.i.correctCoverage({ coverageId: a.fleet, limitAmount: "150000" });
      assert.equal(view.terms[0].coverages.filter((c) => c.coverageType === "MOTOR_TRUCK_CARGO" && c.recordStatus === "active").length, 1);
      assert.equal((await rows(a.scheduled)).length, 1);
      const noRows = await scheduledPolicy();
      const turned = await K.i.correctCoverage({ coverageId: noRows.scheduled, scheduledVehiclesOnly: false });
      assert.equal(turned.terms[0].coverages.find((c) => c.coverageType === "AUTO_LIABILITY" && c.recordStatus === "active")!.scheduledVehiclesOnly, false);
    });

    scenario("refused as a whole, with a State error and nothing changed: the replacement would no longer list vehicles, or a vehicle can no longer be scheduled", async () => {
      const actor = await fullStaff();
      const s = await busy();
      const state = async () => JSON.stringify([await snapshot(s.scheduled), JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId))]);
      const before = await state();
      const events = (await eventTypes(actor.actorId)).length;
      await stateError(K.i.correctCoverage({ coverageId: s.scheduled, scheduledVehiclesOnly: false }));
      assert.equal(await state(), before);
      await archiveVehicle(s.ended);
      await stateError(K.i.correctCoverage({ coverageId: s.scheduled, limitAmount: "3000000" }));
      await pools.admin.query(`UPDATE public.vehicles SET record_status = 'active', archived_at = NULL, updated_at = now() WHERE id = $1`, [s.ended]);
      await mergeVehicle(s.right, await vehicle({ operatedBy: s.organizationId }));
      await stateError(K.i.correctCoverage({ coverageId: s.scheduled, limitAmount: "3000000" }));
      assert.equal(await state(), before, "the coverage is still genuine and unflagged");
      assert.equal((await eventTypes(actor.actorId)).length, events, "and no event was written");
    });

    scenario("records one RECORD_CREATED per carried entry, references only, and rolls everything back when the register refuses", async () => {
      const actor = await fullStaff();
      const s = await busy();
      const before = await snapshot(s.scheduled);
      const policyBefore = JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId));
      const eventsBefore = (await eventTypes(actor.actorId)).length;
      for (const eventType of ["RECORD_CREATED", "RECORD_CORRECTED"]) {
        await refuseMasterRegisterEvent(eventType);
        await assert.rejects(K.i.correctCoverage({ coverageId: s.scheduled, limitAmount: "3000000" }), /master register write refused/, eventType);
        await allowMasterRegister();
        assert.equal(await snapshot(s.scheduled), before, `${eventType}: the frozen coverage is untouched`);
        assert.equal(JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId)), policyBefore, `${eventType}: no replacement, no carried entry`);
        assert.equal((await eventTypes(actor.actorId)).length, eventsBefore, `${eventType}: no event`);
      }
      const replacementId = replacementOf(await K.i.correctCoverage({ coverageId: s.scheduled, limitAmount: "3000000" }));
      const events = (await pools.admin.query<{ event_type: string; target: { resourceType: string; resourceId: string; subjectReferences: string[] }; change_set: { fieldChanges: Array<{ before: { kind: string; reference?: string }; after: { kind: string; reference?: string } }> } }>(
        `SELECT event_type, target, change_set FROM public.master_register_events WHERE actor_id = $1::uuid AND target->>'resourceType' = 'insurance_coverage_vehicle' ORDER BY recorded_at, event_type`,
        [actor.actorId],
      )).rows.slice(-3);
      const carriedIds = (await rows(replacementId)).map((row) => row.id).sort();
      assert.equal(events.length, 3);
      assert.deepEqual(events.map((e) => e.event_type), ["RECORD_CREATED", "RECORD_CREATED", "RECORD_CREATED"]);
      assert.deepEqual(events.map((e) => e.target.resourceId).sort(), carriedIds);
      for (const event of events) {
        assert.deepEqual(event.target.subjectReferences, [`organization:${s.organizationId}`]);
        for (const change of event.change_set.fieldChanges) {
          if (change.after.kind === "REFERENCE") assert.match(change.after.reference!, /^(insurance_coverage_vehicles|vehicles):[0-9a-f-]{36}$/);
        }
      }
      const json = await eventsJson(actor.actorId);
      for (const secret of [...VINS.values(), "2023-02-01", "2023-08-01"]) assert.equal(json.includes(secret), false, secret);
    });

    scenario("a failure while carrying an entry rolls the whole correction back", async () => {
      await fullStaff();
      const s = await busy();
      const before = await snapshot(s.scheduled);
      const policyBefore = JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId));
      await pools.admin.query(`CREATE OR REPLACE FUNCTION public.tes_test_inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.effective_to IS NOT NULL THEN RAISE EXCEPTION 'test: injected failure'; END IF; RETURN NEW; END $$`);
      await pools.admin.query(`CREATE TRIGGER tes_test_inject_failure BEFORE INSERT ON public.${TABLE} FOR EACH ROW EXECUTE FUNCTION public.tes_test_inject_failure()`);
      cleanups.push(async () => {
        await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_inject_failure ON public.${TABLE}`);
        await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_inject_failure()`);
      });
      await assert.rejects(K.i.correctCoverage({ coverageId: s.scheduled, limitAmount: "3000000" }), /injected failure/);
      assert.equal(await snapshot(s.scheduled), before);
      assert.equal(JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId)), policyBefore);
    });

    scenario("a correction racing a new schedule entry on the same coverage: no entry is ever lost or stranded", async () => {
      await fullStaff();
      const as = await concurrentActors(2);
      const s = await busy();
      const fresh = await vehicle({ operatedBy: s.organizationId });
      const [fix, add] = await Promise.allSettled([
        as(0, () => K.i.correctCoverage({ coverageId: s.scheduled, limitAmount: "3000000" })),
        as(1, () => schedule(s, fresh, "2023-05-01")),
      ]);
      assert.equal(fix.status, "fulfilled", fix.status === "rejected" ? String(fix.reason) : "");
      const replacementId = replacementOf((fix as PromiseFulfilledResult<Awaited<ReturnType<typeof K.i.correctCoverage>>>).value);
      const carriedVehicles = (await rows(replacementId)).map((row) => row.vehicle_id);
      if (add.status === "fulfilled") assert.ok(carriedVehicles.includes(fresh), "the entry that landed first was carried");
      else {
        assert.ok(add.reason instanceof K.i.InsuranceStateError, String(add.reason));
        assert.equal(carriedVehicles.includes(fresh), false);
      }
      const genuineOld = (await rows(s.scheduled)).filter((row) => row.record_status === "active").map((row) => row.vehicle_id).sort();
      assert.deepEqual([...new Set(carriedVehicles)].sort(), genuineOld, "the replacement schedules exactly what the frozen coverage scheduled");
    });
  });

  // =============================================================================================================
  describe("every path that replaces coverage rows keeps the schedule", () => {
    const ALS = (over: Record<string, unknown> = {}) => AL({ scheduledVehiclesOnly: true, ...over });
    /** The genuine auto liability rows of a policy's genuine term(s), earliest first, with their entries. */
    const genuineAL = async (organizationId: string) =>
      (await pools.admin.query<{ id: string; effective_from: string; effective_to: string | null }>(
        `SELECT c.id, c.effective_from::text, c.effective_to::text FROM public.insurance_coverages c JOIN public.insurance_policy_terms t ON t.id = c.term_id
          WHERE c.organization_id = $1 AND c.coverage_type = 'AUTO_LIABILITY' AND c.record_status = 'active' AND t.record_status = 'active' ORDER BY c.effective_from`,
        [organizationId],
      )).rows;
    const entries = async (coverageId: string) => (await rows(coverageId)).map((row) => [row.vehicle_id, row.effective_from, row.effective_to, row.schedule_reason, row.record_status]);

    scenario("a change endorsement ends the open entries and restarts the same vehicles on the new state; ended entries stay; a state that stops listing vehicles is refused", async () => {
      const actor = await fullStaff();
      const s = await started();
      const gone = await vehicle({ operatedBy: s.organizationId });
      await schedule(s, gone, "2023-02-01", "2023-03-01");
      const before = await snapshot(s.scheduled);
      const policyBefore = JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId));
      await stateError(K.i.addEndorsement({ termId: s.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-06-01", coverage: AL({ limitAmount: "2000000" }) }));
      assert.equal(await snapshot(s.scheduled), before);
      assert.equal(JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId)), policyBefore, "the refused endorsement left nothing behind");

      await K.i.addEndorsement({ termId: s.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-06-01", coverage: ALS({ limitAmount: "2000000" }) });
      const [oldRow, newRow] = await genuineAL(s.organizationId);
      assert.equal(oldRow.id, s.scheduled);
      const oldEntries = await entries(oldRow.id);
      assert.equal(oldEntries.length, 2);
      assert.deepEqual(oldEntries.find((e) => e[0] === s.v), [s.v, "2023-02-01", "2023-06-01", "INITIAL", "active"]);
      assert.deepEqual(oldEntries.find((e) => e[0] === gone), [gone, "2023-02-01", "2023-03-01", "INITIAL", "active"]);
      assert.deepEqual(await entries(newRow.id), [[s.v, "2023-06-01", null, "CHANGE", "active"]]);
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2023-05-31" })).scheduled[0].coverage.id, oldRow.id);
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2023-06-01" })).scheduled[0].coverage.id, newRow.id);
      const kinds = (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid AND target->>'resourceType' = 'insurance_coverage_vehicle'`, [actor.actorId])).rows.map((row) => row.event_type);
      assert.ok(kinds.includes("RECORD_UPDATED"));
      assert.equal(await eventsJson(actor.actorId).then((json) => json.includes(VINS.get(s.v) as string)), false);

      // an entry bounded beyond the next endorsement date, or starting after it, cannot be split: refused as a whole
      const b = await scheduledPolicy();
      const bv = await vehicle({ operatedBy: b.organizationId });
      await schedule(b, bv, "2023-02-01", "2023-09-01");
      const bBefore = await snapshot(b.scheduled);
      await stateError(K.i.addEndorsement({ termId: b.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-06-01", coverage: ALS({ limitAmount: "2000000" }) }));
      assert.equal(await snapshot(b.scheduled), bBefore);
      assert.equal((await genuineAL(b.organizationId)).length, 1);
    });

    scenario("a mid-way failure while a change endorsement continues the schedule rolls the endorsement back", async () => {
      await fullStaff();
      const s = await started();
      const before = await snapshot(s.scheduled);
      const policyBefore = JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId));
      await pools.admin.query(`CREATE OR REPLACE FUNCTION public.tes_test_inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.schedule_reason = 'CHANGE' THEN RAISE EXCEPTION 'test: injected failure'; END IF; RETURN NEW; END $$`);
      await pools.admin.query(`CREATE TRIGGER tes_test_inject_failure BEFORE INSERT ON public.${TABLE} FOR EACH ROW EXECUTE FUNCTION public.tes_test_inject_failure()`);
      cleanups.push(async () => {
        await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_inject_failure ON public.${TABLE}`);
        await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_inject_failure()`);
      });
      await assert.rejects(K.i.addEndorsement({ termId: s.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-06-01", coverage: ALS({ limitAmount: "2000000" }) }), /injected failure/);
      assert.equal(await snapshot(s.scheduled), before, "the old entry is still open");
      assert.equal(JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId)), policyBefore);
    });

    scenario("a term correction carries every entry with its coverage row; a period that cannot hold a window is refused as a whole", async () => {
      const actor = await fullStaff();
      const s = await busyTerm();
      const frozenBefore = await snapshot(s.scheduled);
      const policyBefore = JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId));
      const eventsBefore = (await eventTypes(actor.actorId)).length;
      // shortening the term below an ended entry's end cannot hold it
      await stateError(K.i.correctTerm({ termId: s.termId, termEnd: "2023-06-01" }));
      assert.equal(JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId)), policyBefore);
      assert.equal((await eventTypes(actor.actorId)).length, eventsBefore);
      await refuseMasterRegisterEvent("RECORD_CORRECTED");
      await assert.rejects(K.i.correctTerm({ termId: s.termId, policyNumber: num("FIX") }), /master register write refused/);
      await allowMasterRegister();
      assert.equal(JSON.stringify(await K.i.getOrganizationInsurance(s.organizationId)), policyBefore);

      await K.i.correctTerm({ termId: s.termId, policyNumber: num("FIX"), termEnd: "2023-12-01" });
      assert.equal(await snapshot(s.scheduled), frozenBefore, "the corrected term's coverage keeps its entries untouched");
      const [fresh] = await genuineAL(s.organizationId);
      assert.notEqual(fresh.id, s.scheduled);
      assert.deepEqual((await entries(fresh.id)).sort((a, b) => String(a[1]).localeCompare(String(b[1]))), [[s.v, "2023-02-01", null, "CORRECTION", "active"], [s.ended, "2023-03-01", "2023-08-01", "CORRECTION", "active"]]);
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2023-04-01" })).scheduled[0].coverage.id, fresh.id);
      // a cancellation that falls inside an entry is held to the same rule
      await stateError(K.i.correctTerm({ termId: (await pools.admin.query<{ id: string }>(`SELECT id FROM public.insurance_policy_terms WHERE policy_id = $1 AND record_status = 'active'`, [s.policyId])).rows[0].id, cancellation: { cancelledOn: "2023-05-01", reason: "INSURED_REQUEST" } }));
    });

    scenario("an endorsement correction carries the entries of the coverage rows it replaces; re-dating it under entries is refused", async () => {
      await fullStaff();
      const s = await started();
      await K.i.addEndorsement({ termId: s.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-06-01", endorsementNumber: "E-1", coverage: ALS({ limitAmount: "2000000" }) });
      const [oldRow, newRow] = await genuineAL(s.organizationId);
      const endorsement = (await readPolicy(s.organizationId)).terms[0].endorsements[0];
      const snapshotBefore = JSON.stringify([await snapshot(oldRow.id), await snapshot(newRow.id)]);
      await stateError(K.i.correctEndorsement({ endorsementId: endorsement.id, effectiveOn: "2023-07-01" }));
      assert.equal(JSON.stringify([await snapshot(oldRow.id), await snapshot(newRow.id)]), snapshotBefore, "refused as a whole");
      await K.i.correctEndorsement({ endorsementId: endorsement.id, endorsementNumber: "E-1A" });
      const [endedAgain, startedAgain] = await genuineAL(s.organizationId);
      assert.ok(endedAgain.id !== oldRow.id && startedAgain.id !== newRow.id);
      assert.deepEqual(await entries(endedAgain.id), [[s.v, "2023-02-01", "2023-06-01", "CORRECTION", "active"]]);
      assert.deepEqual(await entries(startedAgain.id), [[s.v, "2023-06-01", null, "CORRECTION", "active"]]);
      assert.equal(await snapshot(oldRow.id), JSON.parse(snapshotBefore)[0], "the frozen rows keep their history");
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2023-07-01" })).scheduled[0].coverage.id, startedAgain.id);
    });

    scenario("a renewal does NOT carry the schedule: the new term's coverage lists nothing until its vehicles are scheduled again", async () => {
      const actor = await fullStaff();
      const s = await started();
      const before = await snapshot(s.scheduled);
      const scheduleEvents = async () =>
        Number((await pools.admin.query(`SELECT count(*) FROM public.master_register_events WHERE actor_id = $1::uuid AND target->>'resourceType' = 'insurance_coverage_vehicle'`, [actor.actorId])).rows[0].count);
      const eventsBefore = await scheduleEvents();
      const view = await K.i.renewPolicy({ policyId: s.policyId, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [ALS(), CARGO()] });
      const renewed = view.terms[1].coverages.find((c) => c.coverageType === "AUTO_LIABILITY")!;
      assert.equal(renewed.scheduledVehiclesOnly, true);
      assert.equal((await K.i.getCoverageSchedule(renewed.id)).history.length, 0, "nothing was carried");
      assert.equal((await rows(renewed.id)).length, 0);
      assert.equal(await snapshot(s.scheduled), before, "the previous term's entries are untouched history");
      assert.equal(await scheduleEvents(), eventsBefore, "and no schedule event was recorded");
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2024-02-01" })).scheduled.length, 0);
      // scheduling again is explicit
      const again = await K.i.scheduleVehicle({ organizationId: s.organizationId, coverageId: renewed.id, vehicleId: s.v, effectiveFrom: "2024-01-01" });
      assert.deepEqual(genuine(again).map((row) => [row.vehicleId, row.scheduleReason]), [[s.v, "INITIAL"]]);
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2024-02-01" })).scheduled[0].coverage.id, renewed.id);
      assert.equal((await K.i.getVehicleInsurance(s.v, { asOf: "2023-02-15" })).scheduled[0].coverage.id, s.scheduled);
    });

    scenario("a Master Register failure while a carried entry is recorded rolls back the correction or the endorsement as a whole", async () => {
      const actor = await fullStaff();
      type Setup = Awaited<ReturnType<typeof started>>;
      const policyState = async (setup: Setup) => JSON.stringify([await K.i.getOrganizationInsurance(setup.organizationId), await rowsOfPolicy(setup.policyId)]);
      const endorsed = async () => {
        const setup = await started();
        await K.i.addEndorsement({ termId: setup.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-06-01", endorsementNumber: "E-1", coverage: ALS({ limitAmount: "2000000" }) });
        return setup;
      };
      const operations: Array<[string, string, () => Promise<Setup>, (setup: Setup) => Promise<unknown>]> = [
        ["correctCoverage", "RECORD_CREATED", started, (setup) => K.i.correctCoverage({ coverageId: setup.scheduled, limitAmount: "3000000" })],
        ["correctTerm", "RECORD_CREATED", started, (setup) => K.i.correctTerm({ termId: setup.termId, policyNumber: num("FIX") })],
        ["correctEndorsement", "RECORD_CREATED", endorsed, async (setup) => K.i.correctEndorsement({ endorsementId: (await readPolicy(setup.organizationId)).terms[0].endorsements[0].id, endorsementNumber: "E-1A" })],
        ["addEndorsement", "RECORD_UPDATED", started, (setup) => K.i.addEndorsement({ termId: setup.termId, kind: "COVERAGE_CHANGED", effectiveOn: "2023-06-01", coverage: ALS({ limitAmount: "2000000" }) })],
      ];
      for (const [label, eventType, prepare, work] of operations) {
        const setup = await prepare();
        const before = await policyState(setup);
        const eventsBefore = (await eventTypes(actor.actorId)).length;
        await refuseMasterRegisterEvent(eventType, "insurance_coverage_vehicle");
        await assert.rejects(work(setup), /master register write refused/, label);
        await allowMasterRegister();
        assert.equal(await policyState(setup), before, `${label}: the policy and its schedule are exactly as they were`);
        assert.equal((await eventTypes(actor.actorId)).length, eventsBefore, `${label}: no event survived`);
        await work(setup);
        assert.notEqual(await policyState(setup), before, `${label}: the same call succeeds once the register accepts it`);
      }
    });

    /** Every schedule row of every coverage of a policy, for whole-policy before/after comparisons. */
    const rowsOfPolicy = async (policyId: string) =>
      (await pools.admin.query(`SELECT s.* FROM public.${TABLE} s JOIN public.insurance_coverages c ON c.id = s.coverage_id WHERE c.policy_id = $1 ORDER BY s.id`, [policyId])).rows;

    async function busyTerm() {
      const s = await started();
      const ended = await vehicle({ operatedBy: s.organizationId });
      await schedule(s, ended, "2023-03-01", "2023-08-01");
      return { ...s, ended };
    }
    const readPolicy = async (organizationId: string) => (await K.i.getOrganizationInsurance(organizationId)).policies[0];
  });

  // =============================================================================================================
  describe("reads", () => {
    scenario("an open window runs only until the coverage ends: its own end, its term's end or the term's cancellation", async () => {
      await fullStaff();
      const expired = await started();
      assert.equal((await K.i.getCoverageSchedule(expired.scheduled, { asOf: "2023-12-31" })).scheduled.length, 1);
      assert.equal((await K.i.getCoverageSchedule(expired.scheduled, { asOf: "2024-01-01" })).scheduled.length, 0, "the term ended");
      assert.equal((await K.i.getVehicleInsurance(expired.v, { asOf: "2023-12-31" })).scheduled.length, 1);
      assert.equal((await K.i.getVehicleInsurance(expired.v, { asOf: "2024-01-01" })).scheduled.length, 0);
      assert.equal((await K.i.getVehicleInsurance(expired.v, { asOf: "2024-01-01" })).history.length, 1, "the history is unaffected");

      const cancelled = await started();
      await K.i.cancelTerm({ termId: cancelled.termId, cancelledOn: "2023-07-01", reason: "INSURED_REQUEST" });
      for (const [asOf, expected] of [["2023-06-30", 1], ["2023-07-01", 0], ["2023-09-01", 0]] as const) {
        assert.equal((await K.i.getCoverageSchedule(cancelled.scheduled, { asOf })).scheduled.length, expected, `cancelled, ${asOf}`);
        assert.equal((await K.i.getVehicleInsurance(cancelled.v, { asOf })).scheduled.length, expected, `cancelled, vehicle, ${asOf}`);
      }

      const removed = await started();
      await K.i.addEndorsement({ termId: removed.termId, kind: "COVERAGE_REMOVED", effectiveOn: "2023-06-01", coverage: { coverageType: "AUTO_LIABILITY" } });
      for (const [asOf, expected] of [["2023-05-31", 1], ["2023-06-01", 0]] as const) {
        assert.equal((await K.i.getCoverageSchedule(removed.scheduled, { asOf })).scheduled.length, expected, `removed, ${asOf}`);
        assert.equal((await K.i.getVehicleInsurance(removed.v, { asOf })).scheduled.length, expected, `removed, vehicle, ${asOf}`);
      }
    });

    scenario("unknown and malformed inputs are refused; reads write nothing", async () => {
      const actor = await fullStaff();
      const s = await started();
      await notFound(K.i.getCoverageSchedule(randomUUID()));
      await notFound(K.i.getVehicleInsurance(randomUUID()));
      await invalid(K.i.getCoverageSchedule("nope"));
      await invalid(K.i.getVehicleInsurance("nope"));
      await invalid(K.i.getCoverageSchedule(s.scheduled, { asOf: "2023-02-30" }));
      await invalid(K.i.getVehicleInsurance(s.v, { asOf: "yesterday" }));
      const count = (await eventTypes(actor.actorId)).length;
      await K.i.getCoverageSchedule(s.scheduled);
      await K.i.getVehicleInsurance(s.v);
      assert.equal((await eventTypes(actor.actorId)).length, count);
    });

    scenario("one Organization's schedule never contains another's rows, even for a vehicle that changed hands", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const b = await scheduledPolicy();
      const shared = await vehicle({ operatedBy: a.organizationId, from: "2022-01-01", to: "2023-06-01" });
      await operate(shared, b.organizationId, "2023-06-01");
      // the vehicle was not operated by B in February
      await invalid(K.i.scheduleVehicle({ organizationId: b.organizationId, coverageId: b.scheduled, vehicleId: shared, effectiveFrom: "2023-02-01" }));
      await schedule(a, shared, "2023-02-01", "2023-06-01");
      await K.i.scheduleVehicle({ organizationId: b.organizationId, coverageId: b.scheduled, vehicleId: shared, effectiveFrom: "2023-06-01" });
      const viewA = await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-03-01" });
      const viewB = await K.i.getCoverageSchedule(b.scheduled, { asOf: "2023-07-01" });
      assert.deepEqual(viewA.history.map((row) => row.organizationId), [a.organizationId]);
      assert.deepEqual(viewB.history.map((row) => row.organizationId), [b.organizationId]);
      assert.equal(viewA.organizationId, a.organizationId);
      const both = await K.i.getVehicleInsurance(shared, { asOf: "2023-03-01" });
      assert.deepEqual(both.scheduled.map((s) => s.organizationId), [a.organizationId], "each as-of date shows the carrier insuring it then");
      assert.deepEqual((await K.i.getVehicleInsurance(shared, { asOf: "2023-07-01" })).scheduled.map((s) => s.organizationId), [b.organizationId]);
      assert.equal(both.history.length, 2);
    });

    scenario("reads follow vehicles.merged_into_vehicle_id: a merged-away vehicle answers for its survivor, which also shows what was scheduled on it", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const source = await vehicle({ operatedBy: a.organizationId });
      const survivor = await vehicle({ operatedBy: a.organizationId });
      const untouched = await vehicle({ operatedBy: a.organizationId });
      await schedule(a, source, "2023-02-01");
      await schedule(a, untouched, "2023-02-01");
      await mergeVehicle(source, survivor);
      await schedule(a, survivor, "2023-05-01");
      const fromSource = await K.i.getVehicleInsurance(source, { asOf: "2023-03-01" });
      const fromSurvivor = await K.i.getVehicleInsurance(survivor, { asOf: "2023-03-01" });
      assert.equal(fromSource.vehicleId, source);
      assert.equal(fromSource.resolvedVehicleId, survivor);
      assert.equal(fromSurvivor.vehicleId, survivor);
      assert.equal(fromSurvivor.resolvedVehicleId, survivor);
      assert.deepEqual(fromSource.scheduled.map((s) => s.schedule.vehicleId), [source], "each row still names the vehicle it was recorded on");
      assert.deepEqual(fromSurvivor.scheduled.map((s) => s.schedule.id), fromSource.scheduled.map((s) => s.schedule.id));
      assert.deepEqual(fromSource.history, fromSurvivor.history);
      const alone = await K.i.getVehicleInsurance(untouched, { asOf: "2023-03-01" });
      assert.equal(alone.scheduled.length, 1);
      assert.equal(alone.resolvedVehicleId, untouched);
      // chains: the survivor merged into a final vehicle; everything answers for the final vehicle
      const final = await vehicle({ operatedBy: a.organizationId });
      await mergeVehicle(survivor, final);
      const chained = await K.i.getVehicleInsurance(source, { asOf: "2023-03-01" });
      assert.equal(chained.resolvedVehicleId, final);
      assert.equal(chained.scheduled.length, 1);
      assert.equal((await K.i.getVehicleInsurance(final, { asOf: "2023-03-01" })).history.length, 2, "the final vehicle shows the entries of every vehicle merged into it, directly or not");
      assert.equal((await K.i.getVehicleInsurance(survivor, { asOf: "2023-03-01" })).resolvedVehicleId, final);
      // a merged-away vehicle can neither be newly scheduled nor keep its entry open past a removal
      await stateError(schedule(a, await mergedAway(a.organizationId, final), "2023-05-01"));
      await K.i.removeScheduledVehicle({ scheduleId: fromSource.scheduled[0].schedule.id, effectiveTo: "2023-06-01" });
      assert.deepEqual((await K.i.getVehicleInsurance(final, { asOf: "2023-06-01" })).scheduled.map((row) => row.schedule.vehicleId), [survivor], "only the survivor's own entry remains");
      assert.equal((await K.i.getVehicleInsurance(final, { asOf: "2023-05-31" })).scheduled.length, 2);
    });

    scenario("the merge walk is loop-safe: a merge loop (impossible through the guards) terminates with a domain state error instead of hanging", async () => {
      await fullStaff();
      const first = await vehicle();
      const second = await vehicle();
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        await client.query(`ALTER TABLE public.vehicles DISABLE TRIGGER vehicles_merge_cycle_guard`);
        await client.query(`ALTER TABLE public.vehicles DISABLE TRIGGER vehicles_require_merge_consistency`);
        await client.query(`UPDATE public.vehicles SET record_status = 'merged', merged_into_vehicle_id = $2 WHERE id = $1`, [first, second]);
        await client.query(`UPDATE public.vehicles SET record_status = 'merged', merged_into_vehicle_id = $2 WHERE id = $1`, [second, first]);
        await client.query(`ALTER TABLE public.vehicles ENABLE TRIGGER vehicles_merge_cycle_guard`);
        await client.query(`ALTER TABLE public.vehicles ENABLE TRIGGER vehicles_require_merge_consistency`);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      await stateError(K.i.getVehicleInsurance(first));
      await stateError(K.i.getVehicleInsurance(second));
    });

    scenario("a vehicle created through the operational-identity service and operated by the insured Organization can be scheduled and read", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      signIn(await staff("VEHICLE_MANAGE"));
      const created = await K.identity.createVehicle({ vehicleTypeCode: "TRAILER" });
      vehicles.push(created.vehicleId);
      await operate(created.vehicleId, a.organizationId, "2022-06-01");
      await fullStaff();
      const view = await schedule(a, created.vehicleId, "2023-02-01");
      assert.equal(genuine(view)[0].vehicleId, created.vehicleId);
      assert.equal((await K.i.getVehicleInsurance(created.vehicleId, { asOf: "2023-03-01" })).scheduled[0].coverage.id, a.scheduled);
    });

    scenario("OWNS and LEASES do not make an Organization the operator of the vehicle", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const v = await vehicle();
      for (const type of ["OWNS", "LEASES"]) {
        await pools.admin.query(`INSERT INTO public.organization_vehicle_relationships (organization_id, vehicle_id, relationship_type, effective_from) VALUES ($1, $2, $3, '2022-01-01T00:00:00Z')`, [a.organizationId, v, type]);
        await invalid(schedule(a, v, "2023-02-01"));
      }
      await operate(v, a.organizationId, "2022-01-01");
      assert.equal(genuine(await schedule(a, v, "2023-02-01")).length, 1);
    });
  });

  // =============================================================================================================
  describe("concurrency (real connections)", () => {
    scenario("1. simultaneous schedulers of the same vehicle on the same coverage: exactly one wins, the rest get a domain conflict", async () => {
      await fullStaff();
      const as = await concurrentActors(5);
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      const { won, lost } = settled(await Promise.allSettled([0, 1, 2, 3, 4].map((i) => as(i, () => schedule(a, v, "2023-02-01")))));
      assert.equal(won.length, 1);
      assert.equal(lost.length, 4);
      for (const error of lost) assert.ok(error instanceof K.i.InsuranceConflictError, String(error));
      assert.equal((await rows(a.scheduled)).length, 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.${TABLE} WHERE coverage_id = $1 AND effective_to IS NULL AND record_status = 'active'`, [a.scheduled]), 1);
    });

    scenario("2. simultaneous schedulers of different vehicles all succeed (serialized by the Organization lock)", async () => {
      await fullStaff();
      const as = await concurrentActors(4);
      const a = await scheduledPolicy();
      const vs = await Promise.all([0, 1, 2, 3].map(() => vehicle({ operatedBy: a.organizationId })));
      const { won, lost } = settled(await Promise.allSettled(vs.map((v, i) => as(i, () => schedule(a, v, "2023-02-01")))));
      assert.equal(won.length, 4);
      assert.deepEqual(lost, []);
      assert.equal((await K.i.getCoverageSchedule(a.scheduled, { asOf: "2023-03-01" })).scheduled.length, 4);
    });

    scenario("3. a removal racing a change of the same entry: exactly one wins and the timeline stays valid", async () => {
      await fullStaff();
      const as = await concurrentActors(2);
      const s = await started();
      const { won, lost } = settled(
        await Promise.allSettled([
          as(0, () => K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01" })),
          as(1, () => K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" })),
        ]),
      );
      assert.equal(won.length, 1);
      assert.equal(lost.length, 1);
      assert.ok(lost[0] instanceof K.i.InsuranceStateError, String(lost[0]));
      const list = (await rows(s.scheduled)).filter((row) => row.record_status === "active");
      for (const [index, row] of list.entries()) if (index < list.length - 1) assert.ok(row.effective_to !== null && row.effective_to <= list[index + 1].effective_from);
    });

    scenario("4. a correction racing a removal of the same entry: exactly one wins; two corrections of one entry: exactly one wins", async () => {
      await fullStaff();
      const as = await concurrentActors(3);
      const s = await started();
      const v1 = await vehicle({ operatedBy: s.organizationId });
      const first = settled(
        await Promise.allSettled([
          as(0, () => K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: v1 })),
          as(1, () => K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01" })),
        ]),
      );
      // either order is valid (a removal followed by a correction of the ended entry, or a correction that freezes the entry first)
      assert.ok(first.won.length >= 1, "at least one of the two wins");
      for (const error of first.lost) assert.ok(error instanceof K.i.InsuranceStateError, String(error));
      const genuine = (await rows(s.scheduled)).filter((row) => row.record_status === "active");
      assert.equal(genuine.length, 1, "exactly one genuine entry remains");
      assert.equal(genuine[0].vehicle_id, v1, "the corrected vehicle is the genuine one");
      assert.equal(genuine[0].effective_to, first.lost.length === 0 ? "2023-06-01" : null);
      const t = await started();
      const [w1, w2] = [await vehicle({ operatedBy: t.organizationId }), await vehicle({ operatedBy: t.organizationId })];
      const two = settled(
        await Promise.allSettled([
          as(0, () => K.i.correctSchedule({ scheduleId: t.scheduleId, vehicleId: w1 })),
          as(1, () => K.i.correctSchedule({ scheduleId: t.scheduleId, vehicleId: w2 })),
        ]),
      );
      assert.equal(two.won.length, 1);
      assert.equal(two.lost.length, 1);
      assert.ok(two.lost[0] instanceof K.i.InsuranceStateError, String(two.lost[0]));
      assert.equal((await rows(t.scheduled)).filter((row) => row.record_status === "active").length, 1);
    });

    scenario("5. two Organizations scheduling at the same moment never surface a raw deadlock", async () => {
      await fullStaff();
      const as = await concurrentActors(6);
      const a = await scheduledPolicy();
      const b = await scheduledPolicy();
      const va = await Promise.all([0, 1, 2].map(() => vehicle({ operatedBy: a.organizationId })));
      const vb = await Promise.all([0, 1, 2].map(() => vehicle({ operatedBy: b.organizationId })));
      const results = await Promise.allSettled([
        ...va.map((v, i) => as(i, () => schedule(a, v, "2023-02-01"))),
        ...vb.map((v, i) => as(3 + i, () => K.i.scheduleVehicle({ organizationId: b.organizationId, coverageId: b.scheduled, vehicleId: v, effectiveFrom: "2023-02-01" }))),
      ]);
      const { won, lost } = settled(results);
      assert.equal(won.length, 6);
      assert.deepEqual(lost, []);
    });

    scenario("6. a vehicle archived while it is being scheduled: the schedule either lands first or is refused with a domain state error", async () => {
      await fullStaff();
      const as = await concurrentActors(1);
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      const archive = (async () => {
        await pools.admin.query(`UPDATE public.vehicles SET record_status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1`, [v]);
      })();
      const outcome = await Promise.allSettled([as(0, () => schedule(a, v, "2023-02-01")), archive]);
      assert.equal(outcome[1].status, "fulfilled");
      if (outcome[0].status === "rejected") assert.ok(outcome[0].reason instanceof K.i.InsuranceStateError, String(outcome[0].reason));
      const state = (await pools.admin.query<{ record_status: string }>(`SELECT record_status FROM public.vehicles WHERE id = $1`, [v])).rows[0].record_status;
      assert.equal(state, "archived");
    });
  });

  // =============================================================================================================
  describe("Master Register", () => {
    scenario("every mutation records one event with references and controlled vocabulary only; reads and refusals record nothing", async () => {
      const actor = await fullStaff();
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      const other = await vehicle({ operatedBy: a.organizationId });
      const right = await vehicle({ operatedBy: a.organizationId });
      const view = await schedule(a, v, "2023-02-01");
      const id = genuine(view)[0].id;
      const changed = await K.i.changeSchedule({ scheduleId: id, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" });
      const second = changed.history[1].id;
      await K.i.correctSchedule({ scheduleId: second, vehicleId: right });
      await K.i.removeScheduledVehicle({ scheduleId: (await K.i.scheduleVehicle({ organizationId: a.organizationId, coverageId: a.scheduled, vehicleId: other, effectiveFrom: "2023-05-01" })).history.find((row) => row.vehicleId === other)!.id, effectiveTo: "2023-06-01" });

      const events = (await pools.admin.query<{ event_type: string; target: { resourceType: string; resourceId: string; subjectReferences: string[] }; change_set: { fieldChanges: Array<{ field: string; before: { kind: string; value?: unknown; reference?: string }; after: { kind: string; value?: unknown; reference?: string } }> } }>(
        `SELECT event_type, target, change_set FROM public.master_register_events WHERE actor_id = $1::uuid AND target->>'resourceType' = 'insurance_coverage_vehicle' ORDER BY recorded_at, event_type`,
        [actor.actorId],
      )).rows;
      assert.deepEqual(
        events.map((event) => event.event_type).sort(),
        ["RECORD_CORRECTED", "RECORD_CREATED", "RECORD_CREATED", "RECORD_UPDATED", "RECORD_UPDATED"],
      );
      const literals = new Set(["ended"]);
      for (const event of events) {
        assert.deepEqual(event.target.subjectReferences, [`organization:${a.organizationId}`]);
        assert.match(event.target.resourceId, /^[0-9a-f-]{36}$/);
        for (const change of event.change_set.fieldChanges) {
          assert.match(change.field, /^(scheduledVehicle|vehicle)$/);
          for (const side of [change.before, change.after]) {
            if (side.kind === "REFERENCE") assert.match(side.reference!, /^(insurance_coverage_vehicles|vehicles):[0-9a-f-]{36}$/);
            else {
              assert.equal(side.kind, "LITERAL");
              assert.ok(side.value === null || literals.has(side.value as string), `literal ${String(side.value)} is not controlled vocabulary`);
            }
          }
        }
      }
      const created = events.find((event) => event.event_type === "RECORD_CREATED")!;
      assert.deepEqual(
        created.change_set.fieldChanges.map((change) => [change.field, change.after.reference?.split(":")[0]]),
        [["scheduledVehicle", "insurance_coverage_vehicles"], ["vehicle", "vehicles"]],
      );
      const json = await eventsJson(actor.actorId);
      for (const secret of [...VINS.values(), "2023-02-01", "2023-04-01", "2023-09-01", "2023-06-01", "2023-05-01", "2024-01-01", "SCH Insured", "SCH Insurer"]) {
        assert.equal(json.includes(secret), false, `${secret} must not reach the Master Register`);
      }
      // reads and refusals write nothing
      const count = (await eventTypes(actor.actorId)).length;
      await K.i.getCoverageSchedule(a.scheduled);
      await K.i.getVehicleInsurance(v);
      await invalid(schedule(a, right, "2022-12-31"));
      await stateError(K.i.scheduleVehicle({ organizationId: a.organizationId, coverageId: a.scheduled, vehicleId: await archivedVehicle(a.organizationId), effectiveFrom: "2023-05-01" }));
      assert.equal((await eventTypes(actor.actorId)).length, count);
    });

    scenario("a Master Register failure rolls the whole mutation back, whichever event fails", async () => {
      const actor = await fullStaff();
      const s = await started();
      const right = await vehicle({ operatedBy: s.organizationId });
      const fresh = await vehicle({ operatedBy: s.organizationId });
      const before = await snapshot(s.scheduled);
      const eventsBefore = (await eventTypes(actor.actorId)).length;
      const operations: Array<[string, string, () => Promise<unknown>]> = [
        ["RECORD_CREATED", "scheduleVehicle", () => schedule(s, fresh, "2023-03-01")],
        ["RECORD_UPDATED", "removeScheduledVehicle", () => K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01" })],
        ["RECORD_UPDATED", "changeSchedule", () => K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" })],
        ["RECORD_CORRECTED", "correctSchedule", () => K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: right })],
      ];
      for (const [eventType, label, work] of operations) {
        await refuseMasterRegisterEvent(eventType);
        await assert.rejects(work(), /master register write refused/, label);
        await allowMasterRegister();
        assert.equal(await snapshot(s.scheduled), before, `${label}: the failed mutation left no trace`);
        assert.equal((await eventTypes(actor.actorId)).length, eventsBefore, `${label}: and no event`);
      }
      // ... and each is valid once the register accepts it
      assert.equal((await K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" })).history.length, 2);
    });

    scenario("a failure in the middle of an operation (not the register) leaves nothing behind either", async () => {
      await fullStaff();
      const s = await started();
      const right = await vehicle({ operatedBy: s.organizationId });
      const before = await snapshot(s.scheduled);
      const inject = async (condition: string) => {
        await pools.admin.query(`CREATE OR REPLACE FUNCTION public.tes_test_inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'test: injected failure'; END IF; RETURN NEW; END $$`);
        await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_inject_failure ON public.${TABLE}`);
        await pools.admin.query(`CREATE TRIGGER tes_test_inject_failure BEFORE INSERT ON public.${TABLE} FOR EACH ROW EXECUTE FUNCTION public.tes_test_inject_failure()`);
        cleanups.push(async () => {
          await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_inject_failure ON public.${TABLE}`);
          await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_inject_failure()`);
        });
      };
      await inject(`NEW.schedule_reason IN ('CHANGE', 'CORRECTION')`);
      // the first statement (end / flag the old row) succeeded before the insert failed: it must be rolled back
      await assert.rejects(K.i.changeSchedule({ scheduleId: s.scheduleId, effectiveFrom: "2023-04-01", effectiveTo: "2023-09-01" }), /injected failure/);
      assert.equal(await snapshot(s.scheduled), before);
      await assert.rejects(K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: right }), /injected failure/);
      assert.equal(await snapshot(s.scheduled), before);
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_inject_failure ON public.${TABLE}`);
      assert.equal((await K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: right })).history.length, 2);
    });
  });

  // =============================================================================================================
  describe("row-level security (migration 0024 model)", () => {
    /** Runs work in a real SYSTEM-scope transaction for the signed-in actor; the transaction carries ONLY the named capability. */
    const as = <T>(capability: Parameters<Kit["system"]["withAuthorizedSystem"]>[0], work: (client: PoolClient) => Promise<T>) => K.system.withAuthorizedSystem(capability, (client) => work(client));
    const COUNT = `SELECT count(*)::int AS n FROM public.${TABLE} WHERE coverage_id = $1`;

    scenario("a transaction under an unrelated SYSTEM capability sees nothing and writes nothing", async () => {
      await fullStaff();
      const s = await started();
      const spare = await vehicle({ operatedBy: s.organizationId });
      const before = await snapshot(s.scheduled);
      const [sql, params] = insertRow({ coverageId: s.scheduled, vehicleId: spare, organizationId: s.organizationId, from: "2023-03-01" });
      for (const capability of ["VEHICLE_MANAGE", "VEHICLE_READ", "ORGANIZATION_REGISTRY_READ", "CUSTOMER_RELATIONSHIP_READ"] as const) {
        signIn(await staff(capability));
        assert.equal((await as(capability, (client) => client.query<{ n: number }>(COUNT, [s.scheduled]))).rows[0].n, 0, `${capability} sees no schedule row`);
        assert.equal((await as(capability, (client) => client.query(`SELECT * FROM public.${TABLE} WHERE id = $1`, [s.scheduleId]))).rowCount, 0, `${capability} cannot find a row by id`);
        const update = await as(capability, (client) => client.query(`UPDATE public.${TABLE} SET effective_to = '2023-06-01' WHERE id = $1`, [s.scheduleId]));
        assert.equal(update.rowCount, 0, `${capability}: an update touches no row`);
        await assert.rejects(as(capability, (client) => client.query(sql, params)), `${capability}: an insert is refused`);
      }
      assert.equal(await snapshot(s.scheduled), before, "nothing changed");
      // the same actor, holding the capability that does apply, sees the row
      signIn(await staff("INSURANCE_READ"));
      assert.equal((await as("INSURANCE_READ", (client) => client.query<{ n: number }>(COUNT, [s.scheduled]))).rows[0].n, 1);
    });

    scenario("INSURANCE_READ sees the rows but cannot write them: the policy's check needs INSURANCE_MANAGE", async () => {
      await fullStaff();
      const s = await started();
      const spare = await vehicle({ operatedBy: s.organizationId });
      const before = await snapshot(s.scheduled);
      signIn(await staff("INSURANCE_READ"));
      assert.equal((await as("INSURANCE_READ", (client) => client.query(`SELECT id FROM public.${TABLE} WHERE coverage_id = $1`, [s.scheduled]))).rowCount, 1);
      // a valid row: every trigger accepts it, so it is the policy that refuses
      const [sql, params] = insertRow({ coverageId: s.scheduled, vehicleId: spare, organizationId: s.organizationId, from: "2023-03-01" });
      await assert.rejects(as("INSURANCE_READ", (client) => client.query(sql, params)), (error: Pg) => error.code === "42501" && /row-level security/.test(error.message));
      await assert.rejects(as("INSURANCE_READ", (client) => client.query(`UPDATE public.${TABLE} SET effective_to = '2023-06-01' WHERE id = $1`, [s.scheduleId])), (error: Pg) => error.code === "42501");
      assert.equal(await snapshot(s.scheduled), before);
      // INSURANCE_MANAGE may write what it can see
      signIn(await staff("INSURANCE_MANAGE"));
      await as("INSURANCE_MANAGE", (client) => client.query(sql, params));
      assert.equal((await rows(s.scheduled)).length, 2);
    });

    scenario("a CUSTOMER-scope transaction sees only its own Organization's rows and cannot write", async () => {
      await fullStaff();
      const customerA = await fx.organizationAndCustomer("CustA");
      const customerB = await fx.organizationAndCustomer("CustB");
      insuredElsewhere.push(customerA.organizationId, customerB.organizationId);
      const a = await scheduledPolicy({ insured: customerA.organizationId });
      const b = await scheduledPolicy({ insured: customerB.organizationId });
      const va = await vehicle({ operatedBy: a.organizationId });
      const spare = await vehicle({ operatedBy: a.organizationId });
      const vb = await vehicle({ operatedBy: b.organizationId });
      const rowA = genuine(await schedule(a, va, "2023-02-01"))[0];
      await schedule(b, vb, "2023-02-01");
      const before = JSON.stringify([await snapshot(a.scheduled), await snapshot(b.scheduled)]);

      const customerUser = async (customerId: string) => {
        const user = await fx.actor();
        const relationshipId = await fx.relationship(user.actorId, "CUSTOMER_USER");
        const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId });
        await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
        return user;
      };
      const inCustomer = <T>(customerId: string, work: (client: PoolClient) => Promise<T>) => K.customer.withAuthorizedCustomer(customerId, "ORGANIZATION_READ", (client) => work(client));

      signIn(await customerUser(customerA.customerId));
      const seen = await inCustomer(customerA.customerId, (client) => client.query<{ id: string; organization_id: string }>(`SELECT id, organization_id FROM public.${TABLE}`));
      assert.deepEqual(seen.rows.map((row) => [row.id, row.organization_id]), [[rowA.id, customerA.organizationId]], "only its own Organization's row");
      assert.equal((await inCustomer(customerA.customerId, (client) => client.query(`SELECT 1 FROM public.${TABLE} WHERE coverage_id = $1`, [b.scheduled]))).rowCount, 0, "another Organization's coverage has no visible rows");
      // a customer cannot write: not a new row (valid in every other respect), not an update, not a delete
      const [sql, params] = insertRow({ coverageId: a.scheduled, vehicleId: spare, organizationId: a.organizationId, from: "2023-03-01" });
      await assert.rejects(inCustomer(customerA.customerId, (client) => client.query(sql, params)));
      assert.equal((await inCustomer(customerA.customerId, (client) => client.query(`UPDATE public.${TABLE} SET effective_to = '2023-06-01' WHERE id = $1`, [rowA.id]))).rowCount, 0);
      await assert.rejects(inCustomer(customerA.customerId, (client) => client.query(`DELETE FROM public.${TABLE} WHERE id = $1`, [rowA.id])), /permission denied/);
      // ... and cannot ask for another customer's scope
      await denied(inCustomer(customerB.customerId, (client) => client.query(COUNT, [b.scheduled])));
      // the other customer sees its own row and none of A's
      signIn(await customerUser(customerB.customerId));
      const seenB = await inCustomer(customerB.customerId, (client) => client.query<{ organization_id: string }>(`SELECT organization_id FROM public.${TABLE}`));
      assert.deepEqual(seenB.rows.map((row) => row.organization_id), [customerB.organizationId]);
      // a customer-scope actor reaches no SYSTEM data through the service
      await denied(K.i.getCoverageSchedule(a.scheduled));
      await denied(K.i.getVehicleInsurance(va));
      assert.equal(JSON.stringify([await snapshot(a.scheduled), await snapshot(b.scheduled)]), before, "nothing changed");
    });

    scenario("no capability at all: a transaction without the settings sees and writes nothing", async () => {
      await fullStaff();
      const s = await started();
      const spare = await vehicle({ operatedBy: s.organizationId });
      const before = await snapshot(s.scheduled);
      assert.equal((await pools.runtime.query<{ n: number }>(COUNT, [s.scheduled])).rows[0].n, 0, "the runtime role, with no context, sees nothing");
      assert.equal((await pools.runtime.query(`UPDATE public.${TABLE} SET effective_to = '2023-06-01' WHERE id = $1`, [s.scheduleId])).rowCount, 0);
      const [sql, params] = insertRow({ coverageId: s.scheduled, vehicleId: spare, organizationId: s.organizationId, from: "2023-03-01" });
      await assert.rejects(pools.runtime.query(sql, params));
      assert.equal(await snapshot(s.scheduled), before);
      // a capability named in the settings but not granted to the actor proves nothing
      const stranger = await staff("VEHICLE_MANAGE");
      await refuses("runtime", [insertRow({ coverageId: s.scheduled, vehicleId: spare, organizationId: s.organizationId, from: "2023-03-01" })], /./, "an actor who does not hold INSURANCE_MANAGE", "INSURANCE_MANAGE", stranger);
      assert.equal(await snapshot(s.scheduled), before);
    });

    scenario("the runtime role cannot execute the vehicle guard directly, and it is the only SECURITY DEFINER function that concerns insurance", async () => {
      const guard = "tes_security.guard_insurance_schedule_vehicle()";
      assert.equal((await pools.admin.query(`SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS ok`, [RUNTIME_ROLE, guard])).rows[0].ok, false);
      assert.equal((await pools.admin.query(`SELECT has_function_privilege('public', $1::regprocedure, 'EXECUTE') AS ok`, [guard])).rows[0].ok, false);
      await assert.rejects(pools.runtime.query(`SELECT ${guard}`), /permission denied for function guard_insurance_schedule_vehicle/);
      const definers = (await pools.admin.query<{ proname: string }>(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef AND n.nspname IN ('public', 'tes_security', 'tes_system') AND (p.proname ~ 'insurance' OR p.prosrc ~* 'insurance') ORDER BY p.proname`,
      )).rows.map((row) => row.proname);
      assert.deepEqual(definers, ["guard_insurance_schedule_vehicle"]);
      const triggerFunctions = (await pools.admin.query<{ proname: string; prosecdef: boolean }>(
        `SELECT p.proname, p.prosecdef FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal`,
        [`public.${TABLE}`],
      )).rows;
      assert.deepEqual(triggerFunctions.filter((fn) => fn.prosecdef).map((fn) => fn.proname), ["guard_insurance_schedule_vehicle"], "one definer trigger on the table");
      assert.equal((await pools.admin.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${TABLE}`])).rows[0].relrowsecurity, true);
      const policies = (await pools.admin.query<{ policyname: string; cmd: string }>(`SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname`, [TABLE])).rows;
      assert.deepEqual(policies.map((policy) => [policy.policyname, policy.cmd]), [["insurance_coverage_vehicles_customer", "SELECT"], ["insurance_coverage_vehicles_system", "ALL"]]);
    });

    scenario("the definer check works under an INSURANCE_MANAGE-only transaction although that capability has no VEHICLE policy", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const operated = await vehicle({ operatedBy: a.organizationId });
      const stranger = await vehicle();
      const archived = await archivedVehicle(a.organizationId);
      signIn(await staff("INSURANCE_MANAGE"));
      await as("INSURANCE_MANAGE", async (client) => {
        // the transaction itself cannot see a single vehicle or relationship ...
        assert.equal((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.vehicles`)).rows[0].n, 0);
        assert.equal((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.organization_vehicle_relationships`)).rows[0].n, 0);
        // ... yet the guard sees them for it and decides correctly
        const attempt = async (vehicleId: string) => {
          await client.query("SAVEPOINT attempt");
          try {
            const [sql, params] = insertRow({ coverageId: a.scheduled, vehicleId, organizationId: a.organizationId, from: "2023-02-01" });
            await client.query(sql, params);
            return "accepted";
          } catch (error) {
            return `${(error as Pg).code}:${(error as Pg).constraint}`;
          } finally {
            await client.query("ROLLBACK TO SAVEPOINT attempt");
          }
        };
        assert.equal(await attempt(operated), "accepted");
        assert.equal(await attempt(stranger), "23514:insurance_coverage_vehicles_vehicle_operated");
        assert.equal(await attempt(archived), "55000:insurance_coverage_vehicles_vehicle_active");
        assert.equal(await attempt(randomUUID()), "55000:insurance_coverage_vehicles_vehicle_active");
        const [sql, params] = insertRow({ coverageId: a.scheduled, vehicleId: operated, organizationId: a.organizationId, from: "2023-02-01" });
        await client.query(sql, params);
      });
      assert.equal((await rows(a.scheduled)).length, 1);
    });
  });

  // =============================================================================================================
  describe("database backstops (service bypassed)", () => {
    /** The same attacks through the runtime role and through the table owner: the triggers apply to both. */
    for (const pool of ["runtime", "admin"] as const) {
      scenario(`${pool}: every rule of the schedule is enforced by the database`, async () => {
        await fullStaff();
        const a = await scheduledPolicy();
        const b = await scheduledPolicy();
        const v = await vehicle({ operatedBy: a.organizationId });
        const row = (over: Partial<Parameters<typeof insertRow>[0]> = {}) => insertRow({ coverageId: a.scheduled, vehicleId: v, organizationId: a.organizationId, from: "2023-02-01", ...over });

        await refuses(pool, [row({ organizationId: b.organizationId })], { constraint: "insurance_coverage_vehicles_same_organization", code: "23514" }, "other Organization");
        await refuses(pool, [row({ coverageId: b.scheduled })], { constraint: "insurance_coverage_vehicles_same_organization" }, "other Organization's coverage");
        await refuses(pool, [row({ coverageId: a.fleet })], { constraint: "insurance_coverage_vehicles_coverage_is_scheduled", code: "23514" }, "whole-fleet coverage");
        await refuses(pool, [row({ coverageId: randomUUID() })], { constraint: "insurance_coverage_vehicles_coverage_active", code: "55000" }, "no such coverage");
        await refuses(pool, [row({ from: "2022-12-31" })], { constraint: "insurance_coverage_vehicles_inside_coverage", code: "23514" }, "before the coverage");
        await refuses(pool, [row({ from: "2024-01-01" })], { constraint: "insurance_coverage_vehicles_inside_coverage" }, "after the coverage");
        await refuses(pool, [row({ to: "2024-01-02" })], { constraint: "insurance_coverage_vehicles_inside_coverage" }, "ends after the coverage");
        await refuses(pool, [row({ vehicleId: await vehicle() })], { constraint: "insurance_coverage_vehicles_vehicle_operated", code: "23514" }, "unoperated vehicle");
        await refuses(pool, [row({ vehicleId: await vehicle({ operatedBy: b.organizationId }) })], { constraint: "insurance_coverage_vehicles_vehicle_operated" }, "another carrier's vehicle");
        await refuses(pool, [row({ vehicleId: randomUUID() })], { constraint: "insurance_coverage_vehicles_vehicle_active" }, "no such vehicle");
        const archived = await vehicle({ operatedBy: a.organizationId });
        await archiveVehicle(archived);
        await refuses(pool, [row({ vehicleId: archived })], { constraint: "insurance_coverage_vehicles_vehicle_active", code: "55000" }, "archived vehicle");
        const merged = await vehicle({ operatedBy: a.organizationId });
        await mergeVehicle(merged, await vehicle({ operatedBy: a.organizationId }));
        await refuses(pool, [row({ vehicleId: merged })], { constraint: "insurance_coverage_vehicles_vehicle_active" }, "merged vehicle");
        await refuses(pool, [row({ reason: "OTHER" })], { constraint: "insurance_coverage_vehicles_reason_valid" }, "reason");
        await refuses(pool, [row({ to: "2023-02-01" })], { constraint: "insurance_coverage_vehicles_effective_window_valid" }, "empty window");
        await refuses(pool, [row({ to: "2023-01-15" })], /range lower bound must be less than or equal to range upper bound|effective_window_valid/, "reversed window");

        await accepts(pool, [row({ to: "2023-04-01" })], "a valid ended window");
        await refuses(pool, [row({ from: "2023-03-01", to: "2023-05-01" })], { constraint: "insurance_coverage_vehicles_no_overlap", code: "23P01" }, "overlap");
        await refuses(pool, [row({ from: "2023-03-31" })], { constraint: "insurance_coverage_vehicles_no_overlap", code: "23P01" }, "open window overlapping an ended one");
        await accepts(pool, [row({ from: "2023-04-01" })], "an adjacent open window");
        await refuses(pool, [row({ from: "2023-08-01" })], { constraint: "insurance_coverage_vehicles_no_overlap" }, "a second open window");

        // organization / coverage / term state
        const archivedOrg = await scheduledPolicy();
        const av = await vehicle({ operatedBy: archivedOrg.organizationId });
        await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archivedOrg.organizationId]);
        await refuses(pool, [insertRow({ coverageId: archivedOrg.scheduled, vehicleId: av, organizationId: archivedOrg.organizationId, from: "2023-02-01" })], { constraint: "organization_must_be_active" }, "archived Organization");
        const corrected = await scheduledPolicy();
        const cv = await vehicle({ operatedBy: corrected.organizationId });
        await K.i.correctCoverage({ coverageId: corrected.scheduled, limitAmount: "4000000" });
        await refuses(pool, [insertRow({ coverageId: corrected.scheduled, vehicleId: cv, organizationId: corrected.organizationId, from: "2023-02-01" })], { constraint: "insurance_coverage_vehicles_coverage_active" }, "corrected coverage");
        const correctedTerm = await scheduledPolicy();
        const tv = await vehicle({ operatedBy: correctedTerm.organizationId });
        await K.i.correctTerm({ termId: correctedTerm.termId, policyNumber: num("FIX") });
        await refuses(pool, [insertRow({ coverageId: correctedTerm.scheduled, vehicleId: tv, organizationId: correctedTerm.organizationId, from: "2023-02-01" })], { constraint: "insurance_coverage_vehicles_coverage_active" }, "corrected term");
      });
    }

    scenario("a cancelled term bounds the window at the database as well", async () => {
      await fullStaff();
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      await K.i.cancelTerm({ termId: a.termId, cancelledOn: "2023-07-01", reason: "INSURED_REQUEST" });
      await refuses("runtime", [insertRow({ coverageId: a.scheduled, vehicleId: v, organizationId: a.organizationId, from: "2023-07-01" })], { constraint: "insurance_coverage_vehicles_inside_coverage" }, "starts at the cancellation");
      await refuses("runtime", [insertRow({ coverageId: a.scheduled, vehicleId: v, organizationId: a.organizationId, from: "2023-02-01", to: "2023-07-02" })], { constraint: "insurance_coverage_vehicles_inside_coverage" }, "ends after the cancellation");
      await accepts("runtime", [insertRow({ coverageId: a.scheduled, vehicleId: v, organizationId: a.organizationId, from: "2023-02-01" })], "an open window runs until the coverage ends");
    });

    scenario("races that bypass the service: the database serializes two open windows of one vehicle on one coverage", async () => {
      await fullStaff();
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const a = await scheduledPolicy();
      const v = await vehicle({ operatedBy: a.organizationId });
      const actor = await staff("INSURANCE_MANAGE");
      const [c1, c2]: PoolClient[] = [await contextClient(actor, "INSURANCE_MANAGE"), await contextClient(actor, "INSURANCE_MANAGE")];
      try {
        const [sql, params] = insertRow({ coverageId: a.scheduled, vehicleId: v, organizationId: a.organizationId, from: "2023-02-01" });
        await c1.query(sql, params);
        const [sql2, params2] = insertRow({ coverageId: a.scheduled, vehicleId: v, organizationId: a.organizationId, from: "2023-03-01" });
        const blocked = c2.query(sql2, params2).then(() => ({ ok: true as const }), (error: Pg) => ({ ok: false as const, error }));
        assert.equal(await Promise.race([blocked, sleep(400).then(() => "waiting" as const)]), "waiting", "the second writer waits for the first to finish");
        await c1.query("COMMIT");
        const outcome = await blocked;
        await c2.query("ROLLBACK").catch(() => undefined);
        assert.equal(outcome.ok, false);
        if (!outcome.ok) assert.deepEqual([outcome.error.code, outcome.error.constraint], ["23P01", "insurance_coverage_vehicles_no_overlap"]);
      } finally {
        await c1.query("ROLLBACK").catch(() => undefined);
        await c2.query("ROLLBACK").catch(() => undefined);
        c1.release();
        c2.release();
      }
      assert.equal((await rows(a.scheduled)).length, 1);
    });

    scenario("the runtime role is refused identity and content changes, deletes and truncates; the table owner is refused by triggers", async () => {
      await fullStaff();
      const s = await started();
      const denied = (sql: string, params: unknown[]) => assert.rejects(pools.runtime.query(sql, params), /permission denied/, sql);
      await denied(`UPDATE public.${TABLE} SET vehicle_id = $2 WHERE id = $1`, [s.scheduleId, randomUUID()]);
      await denied(`UPDATE public.${TABLE} SET coverage_id = $2 WHERE id = $1`, [s.scheduleId, s.fleet]);
      await denied(`UPDATE public.${TABLE} SET organization_id = $2 WHERE id = $1`, [s.scheduleId, randomUUID()]);
      await denied(`UPDATE public.${TABLE} SET effective_from = '2023-03-01' WHERE id = $1`, [s.scheduleId]);
      await denied(`UPDATE public.${TABLE} SET schedule_reason = 'CHANGE' WHERE id = $1`, [s.scheduleId]);
      await denied(`UPDATE public.${TABLE} SET created_at = now() WHERE id = $1`, [s.scheduleId]);
      await denied(`DELETE FROM public.${TABLE} WHERE id = $1`, [s.scheduleId]);
      await denied(`TRUNCATE public.${TABLE}`, []);
      await refuses("admin", [[`DELETE FROM public.${TABLE}`]], /Insurance schedule data is preserved/, "owner delete");
      await refuses("admin", [[`TRUNCATE public.${TABLE} CASCADE`]], /Insurance schedule data is preserved/, "owner truncate");
    });

    scenario("the owner cannot rewrite identity or content; an ended row is not re-dated; a correction never ends a row", async () => {
      await fullStaff();
      const s = await started();
      const other = await vehicle({ operatedBy: s.organizationId });
      const owner = (sql: string, params: unknown[], pattern: RegExp | { constraint: string }, label: string) => refuses("admin", [[sql, params]], pattern, label);
      const id = s.scheduleId;
      await owner(`UPDATE public.${TABLE} SET vehicle_id = $2 WHERE id = $1`, [id, other], /content is immutable/, "vehicle");
      await owner(`UPDATE public.${TABLE} SET coverage_id = $2 WHERE id = $1`, [id, s.fleet], /content is immutable/, "coverage");
      await owner(`UPDATE public.${TABLE} SET organization_id = $2 WHERE id = $1`, [id, s.insurerOrganizationId], /content is immutable/, "organization");
      await owner(`UPDATE public.${TABLE} SET schedule_reason = 'CHANGE' WHERE id = $1`, [id], /content is immutable/, "reason");
      await owner(`UPDATE public.${TABLE} SET effective_from = '2023-03-01' WHERE id = $1`, [id], /content is immutable/, "start");
      await owner(`UPDATE public.${TABLE} SET created_at = now() - interval '1 day' WHERE id = $1`, [id], /content is immutable/, "created_at");
      await owner(`UPDATE public.${TABLE} SET id = $2 WHERE id = $1`, [id, randomUUID()], /content is immutable/, "id");
      // an open entry that is flagged corrected may not also be ended by the same statement
      await owner(`UPDATE public.${TABLE} SET record_status = 'corrected', corrected_at = now(), superseded_by_schedule_id = $2, effective_to = '2023-06-01' WHERE id = $1`, [id, randomUUID()], /does not end/, "correction ending a row");
      await owner(`UPDATE public.${TABLE} SET record_status = 'corrected' WHERE id = $1`, [id], { constraint: "insurance_coverage_vehicles_correction_state_consistent" }, "flag without link");
      await owner(`UPDATE public.${TABLE} SET record_status = 'corrected', corrected_at = now(), superseded_by_schedule_id = id WHERE id = $1`, [id], { constraint: "insurance_coverage_vehicles_not_superseded_by_self" }, "self supersession");
      await owner(`UPDATE public.${TABLE} SET superseded_by_schedule_id = $2 WHERE id = $1`, [id, id], { constraint: "insurance_coverage_vehicles_correction_state_consistent" }, "link without flag");
      // the end of an open entry is one-way
      await accepts("admin", [[`UPDATE public.${TABLE} SET effective_to = '2023-06-01' WHERE id = $1`, [id]]], "first end");
      await owner(`UPDATE public.${TABLE} SET effective_to = '2023-07-01' WHERE id = $1`, [id], /cannot be re-dated/, "ended entry re-dated");
      await owner(`UPDATE public.${TABLE} SET effective_to = NULL WHERE id = $1`, [id], /cannot be re-dated/, "ended entry re-opened");
      await owner(`UPDATE public.${TABLE} SET effective_to = '2023-02-01' WHERE id = $1`, [id], /cannot be re-dated/, "ended entry emptied");
      // a flagged correction without a replacement by commit time violates the composite supersession foreign key
      const outcome = await transaction("admin", [[`UPDATE public.${TABLE} SET record_status = 'corrected', corrected_at = now(), superseded_by_schedule_id = $2 WHERE id = $1`, [id, randomUUID()]]]);
      assert.equal(outcome.error?.code, "23503");
      assert.equal(outcome.error?.constraint, "insurance_coverage_vehicles_superseded_by_fk");
    });

    scenario("OWNER-LEVEL FROZEN ROWS: a corrected entry (open or ended) cannot be re-pointed, re-dated, re-opened or content-edited by anyone", async () => {
      await fullStaff();
      for (const ended of [false, true]) {
        const s = await started();
        if (ended) await K.i.removeScheduledVehicle({ scheduleId: s.scheduleId, effectiveTo: "2023-06-01" });
        const right = await vehicle({ operatedBy: s.organizationId });
        const decoy = await vehicle({ operatedBy: s.organizationId });
        const view = await K.i.correctSchedule({ scheduleId: s.scheduleId, vehicleId: right });
        assert.equal(view.history.length, 2);
        const other = (await schedule(s, decoy, "2023-03-01")).history.find((row) => row.vehicleId === decoy)!.id;
        const frozen = (sql: string, params: unknown[], label: string) => refuses("admin", [[sql, params]], /frozen/, `${ended ? "ended" : "open"}: ${label}`);
        const before = await snapshot(s.scheduled);
        await frozen(`UPDATE public.${TABLE} SET superseded_by_schedule_id = $2 WHERE id = $1`, [s.scheduleId, other], "re-pointed to another entry");
        await frozen(`UPDATE public.${TABLE} SET superseded_by_schedule_id = $2 WHERE id = $1`, [s.scheduleId, s.scheduleId], "re-pointed to itself");
        await frozen(`UPDATE public.${TABLE} SET superseded_by_schedule_id = NULL WHERE id = $1`, [s.scheduleId], "link removed");
        await frozen(`UPDATE public.${TABLE} SET record_status = 'active', corrected_at = NULL, superseded_by_schedule_id = NULL WHERE id = $1`, [s.scheduleId], "resurrected");
        await frozen(`UPDATE public.${TABLE} SET corrected_at = now() WHERE id = $1`, [s.scheduleId], "correction instant moved");
        await frozen(`UPDATE public.${TABLE} SET effective_to = '2023-12-01' WHERE id = $1`, [s.scheduleId], "re-dated");
        await frozen(`UPDATE public.${TABLE} SET effective_to = NULL WHERE id = $1`, [s.scheduleId], "re-opened");
        await frozen(`UPDATE public.${TABLE} SET effective_from = '2023-01-15' WHERE id = $1`, [s.scheduleId], "start moved");
        await frozen(`UPDATE public.${TABLE} SET vehicle_id = $2 WHERE id = $1`, [s.scheduleId, decoy], "vehicle swapped");
        await frozen(`UPDATE public.${TABLE} SET coverage_id = $2 WHERE id = $1`, [s.scheduleId, s.fleet], "coverage swapped");
        await frozen(`UPDATE public.${TABLE} SET organization_id = $2 WHERE id = $1`, [s.scheduleId, s.insurerOrganizationId], "organization swapped");
        await frozen(`UPDATE public.${TABLE} SET schedule_reason = 'CORRECTION' WHERE id = $1`, [s.scheduleId], "reason changed");
        await frozen(`UPDATE public.${TABLE} SET updated_at = now() WHERE id = $1`, [s.scheduleId], "touched");
        // the same attacks as the runtime role fail on privileges or on the same trigger
        await refuses("runtime", [[`UPDATE public.${TABLE} SET superseded_by_schedule_id = $2 WHERE id = $1`, [s.scheduleId, other]]], /frozen/, "runtime: re-pointed");
        await refuses("runtime", [[`UPDATE public.${TABLE} SET effective_to = '2023-12-01' WHERE id = $1`, [s.scheduleId]]], /frozen/, "runtime: re-dated");
        await refuses("runtime", [[`UPDATE public.${TABLE} SET vehicle_id = $2 WHERE id = $1`, [s.scheduleId, decoy]]], /permission denied/, "runtime: vehicle swapped");
        assert.equal(await snapshot(s.scheduled), before, "nothing changed");
      }
    });
  });
});
