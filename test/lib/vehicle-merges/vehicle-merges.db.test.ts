// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL vehicle merge service through the REAL authorization wrappers and Clerk-to-actor resolution, on pooled
// connections that log in as the RUNTIME role (policy-bound by the row-level security of migration 0024), against a database
// with migrations 0001-0026 applied. Fixtures and owner-level checks use the admin (table owner) pool, which bypasses RLS.

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
    v: await import("@/lib/vehicle-merges/service"),
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
type Capability = "VEHICLE_READ" | "VEHICLE_MANAGE";
const BOTH: Capability[] = ["VEHICLE_READ", "VEHICLE_MANAGE"];
const REASONS = ["DUPLICATE_RECORD", "IDENTIFIER_CORRECTION", "RESOLUTION_REVIEW"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type PgError = Error & { code?: string; constraint?: string };
type Step = [string, unknown[]?] | (() => Promise<unknown>);
type Outcome = { error?: PgError };

describe("Vehicle merges (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let vehicles: string[] = [];
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

  const run = randomUUID().slice(0, 8).toUpperCase();
  let counter = 0;
  const n = () => ++counter;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Removes everything this scenario created. The no-delete triggers are lifted only here, by the table owner, in a transaction. */
  async function purge() {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const [table, trigger] of [
        ["vehicle_merges", "vehicle_merges_no_delete"],
        ["vehicles", "vehicles_no_delete"],
        ["organization_vehicle_relationships", "organization_vehicle_relationships_no_delete"],
      ]) {
        await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`);
      }
      await client.query(`DELETE FROM public.vehicle_merges WHERE source_vehicle_id = ANY($1::uuid[]) OR target_vehicle_id = ANY($1::uuid[])`, [vehicles]);
      await client.query(`DELETE FROM public.organization_vehicle_relationships WHERE vehicle_id = ANY($1::uuid[])`, [vehicles]);
      await client.query(`DELETE FROM public.vehicles WHERE id = ANY($1::uuid[])`, [vehicles]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const [table, trigger] of [
        ["organization_vehicle_relationships", "organization_vehicle_relationships_no_delete"],
        ["vehicles", "vehicles_no_delete"],
        ["vehicle_merges", "vehicle_merges_no_delete"],
      ]) {
        await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`);
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
      vehicles = [];
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

  /** A structurally valid VIN that is unique per run (no I, O or Q; 17 characters). */
  const vinOf = () => `TV${run}${String(n()).padStart(7, "0")}`;

  async function vehicle(over: { vin?: string | null; archived?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    const vin = over.vin === undefined ? vinOf() : over.vin;
    await pools.admin.query(
      `INSERT INTO public.vehicles (id, vehicle_type_code, vin_display, vin_normalized, make) VALUES ($1, 'TRUCK_TRACTOR', $2, $2, 'Testmake')`,
      [id, vin],
    );
    vehicles.push(id);
    if (over.archived) await pools.admin.query(`UPDATE public.vehicles SET record_status = 'archived', archived_at = now() WHERE id = $1`, [id]);
    return id;
  }
  const vehicleList = async (count: number) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) ids.push(await vehicle());
    return ids;
  };

  async function organization(label = "Org"): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `VM ${label} ${id.slice(0, 8)} ${n()}`]);
    organizations.push(id);
    return id;
  }

  async function relationship(organizationId: string, vehicleId: string, unit: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(
      `INSERT INTO public.organization_vehicle_relationships (id, organization_id, vehicle_id, relationship_type, unit_number_display, unit_number_normalized, effective_from)
       VALUES ($1, $2, $3, 'OPERATES', $4, upper($4), now() - interval '30 days')`,
      [id, organizationId, vehicleId, unit],
    );
    return id;
  }

  async function staff(...capabilities: string[]): Promise<TestActor> {
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
    return actor;
  }
  async function concurrentActors(count: number, ...capabilities: Capability[]) {
    const actors = await Promise.all(Array.from({ length: count }, () => staff(...(capabilities.length ? capabilities : BOTH))));
    return <T>(index: number, work: () => Promise<T>) => K.db.withClerkUser(actors[index].clerkSubject, work);
  }

  const input = (survivorId: string, mergedId: string, reason: (typeof REASONS)[number] = "DUPLICATE_RECORD") => ({ survivorId, mergedId, reason });
  const merge = (survivorId: string, mergedId: string, reason: (typeof REASONS)[number] = "DUPLICATE_RECORD") => K.v.mergeVehicles(input(survivorId, mergedId, reason));
  const reverse = (mergeId: string) => K.v.reverseVehicleMerge({ mergeId });

  type VehicleDb = { id: string; vin_normalized: string | null; record_status: string; merged_into_vehicle_id: string | null; archived_at: string | null; updated_at: string };
  const vehicleRow = async (id: string) =>
    (await pools.admin.query<VehicleDb>(`SELECT id, vin_normalized, record_status, merged_into_vehicle_id, archived_at::text, updated_at::text FROM public.vehicles WHERE id = $1`, [id])).rows[0];
  const vehicleJson = async (id: string) => JSON.stringify((await pools.admin.query(`SELECT * FROM public.vehicles WHERE id = $1`, [id])).rows[0]);
  const ledgerRows = async (vehicleId: string) =>
    (await pools.admin.query<{ id: string; source_vehicle_id: string; target_vehicle_id: string; merge_reason: string; record_status: string; merged_at: string; reversed_at: string | null }>(
      `SELECT id, source_vehicle_id, target_vehicle_id, merge_reason, record_status, merged_at::text, reversed_at::text
         FROM public.vehicle_merges WHERE source_vehicle_id = $1 OR target_vehicle_id = $1 ORDER BY merged_at, id`,
      [vehicleId],
    )).rows;
  const ledgerCount = async (ids: string[]) =>
    Number((await pools.admin.query(`SELECT count(*) FROM public.vehicle_merges WHERE source_vehicle_id = ANY($1::uuid[]) OR target_vehicle_id = ANY($1::uuid[])`, [ids])).rows[0].count);
  const stateOf = async (ids: string[]) =>
    JSON.stringify({
      vehicles: (await pools.admin.query(`SELECT * FROM public.vehicles WHERE id = ANY($1::uuid[]) ORDER BY id`, [ids])).rows,
      ledger: (await pools.admin.query(`SELECT * FROM public.vehicle_merges WHERE source_vehicle_id = ANY($1::uuid[]) OR target_vehicle_id = ANY($1::uuid[]) ORDER BY id`, [ids])).rows,
    });

  /** No vehicle disagrees with the ledger: a merged vehicle has exactly one matching active row, any other vehicle has none. */
  async function assertConsistent(ids: string[]) {
    const bad = await pools.admin.query<{ id: string }>(
      `SELECT v.id FROM public.vehicles v
        WHERE v.id = ANY($1::uuid[]) AND (
          (v.record_status = 'merged' AND (SELECT count(*) FROM public.vehicle_merges m WHERE m.source_vehicle_id = v.id AND m.record_status = 'active' AND m.target_vehicle_id = v.merged_into_vehicle_id) <> 1)
          OR (v.record_status <> 'merged' AND EXISTS (SELECT 1 FROM public.vehicle_merges m WHERE m.source_vehicle_id = v.id AND m.record_status = 'active')))`,
      [ids],
    );
    assert.deepEqual(bad.rows, [], "vehicle columns and ledger agree");
  }

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const denied = (promise: Promise<unknown>) => rejectsWith(promise, K.authz.TesAuthorizationDeniedError);
  const invalid = (promise: Promise<unknown>) => rejectsWith(promise, K.v.VehicleMergeValidationError);
  const stateError = (promise: Promise<unknown>) => rejectsWith(promise, K.v.VehicleMergeStateError);
  const notFound = (promise: Promise<unknown>) => rejectsWith(promise, K.v.VehicleMergeNotFoundError);
  const rowCount = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const settled = <T>(results: PromiseSettledResult<T>[]) => ({
    won: results.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled").map((r) => r.value),
    lost: results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason as unknown),
  });

  const eventTypes = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`, [actorId])).rows.map((row) => row.event_type);
  const eventContent = async (actorId: string) =>
    JSON.stringify((await pools.admin.query(`SELECT event_type, action, target, source, classification, change_set, outcome FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId])).rows);

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

  /** Runs steps in their own transaction as the table owner and returns the COMMIT outcome (deferred triggers fire at commit). */
  async function ownerTransaction(steps: Step[]): Promise<Outcome> {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const step of steps) {
        if (typeof step === "function") await step();
        else await client.query(step[0], step[1]);
      }
      await client.query("COMMIT");
      return {};
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return { error: error as PgError };
    } finally {
      client.release();
    }
  }

  /**
   * Runs steps in their own transaction as the RUNTIME role, carrying exactly the context withAuthorizedSystem establishes
   * (actor and ONE capability), but WITHOUT the service: this is what a caller that bypasses the service can reach.
   */
  async function runtimeTransaction(actor: TestActor | null, capability: string | null, steps: Step[], rows?: unknown[][]): Promise<Outcome> {
    const client = await pools.runtime.connect();
    try {
      await client.query("BEGIN");
      if (actor && capability) await client.query(`SELECT set_config('tes.system_actor_id', $1, true), set_config('tes.system_capability', $2, true)`, [actor.actorId, capability]);
      for (const step of steps) {
        if (typeof step === "function") await step();
        else {
          const result = await client.query(step[0], step[1]);
          rows?.push(result.rows);
        }
      }
      await client.query("COMMIT");
      return {};
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return { error: error as PgError };
    } finally {
      client.release();
    }
  }

  const INSERT_LEDGER = `INSERT INTO public.vehicle_merges (id, source_vehicle_id, target_vehicle_id, merge_reason) VALUES ($1, $2, $3, 'DUPLICATE_RECORD')`;
  const FLIP_MERGED = `UPDATE public.vehicles SET record_status = 'merged', merged_into_vehicle_id = $2, updated_at = now() WHERE id = $1`;
  const FLIP_ACTIVE = `UPDATE public.vehicles SET record_status = 'active', merged_into_vehicle_id = NULL, updated_at = now() WHERE id = $1`;
  const REVERSE_LEDGER = `UPDATE public.vehicle_merges SET record_status = 'reversed', reversed_at = clock_timestamp(), updated_at = now() WHERE id = $1`;

  // =============================================================================================================
  describe("schema (migration 0026)", () => {
    scenario("the table, indexes, functions and triggers exist; the ledger records 0026", async () => {
      assert.equal(await rowCount(`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vehicle_merges'`), 1);
      for (const index of ["vehicle_merges_active_source_uq", "vehicle_merges_target_idx"]) {
        assert.equal(await rowCount(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [index]), 1, index);
      }
      for (const trigger of [
        "vehicle_merges_guard_insert", "vehicle_merges_guard_update", "vehicle_merges_require_consistency", "vehicles_require_merge_consistency",
        "vehicle_merges_no_delete", "vehicle_merges_no_truncate",
      ]) {
        assert.equal(await rowCount(`SELECT count(*) FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal`, [trigger]), 1, trigger);
      }
      for (const trigger of ["vehicle_merges_require_consistency", "vehicles_require_merge_consistency"]) {
        const row = (await pools.admin.query<{ tgdeferrable: boolean; tginitdeferred: boolean }>(`SELECT tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname = $1`, [trigger])).rows[0];
        assert.deepEqual(row, { tgdeferrable: true, tginitdeferred: true }, `${trigger} is checked at commit`);
      }
      const ledger = await pools.admin.query<{ sha256: string }>(`SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0026'`);
      const sql = readFileSync(path.join(process.cwd(), "database/migrations/0026_vehicle_merge_ledger.sql"));
      assert.equal(ledger.rows[0]?.sha256, createHash("sha256").update(sql).digest("hex"));
    });

    scenario("the TypeScript vocabulary agrees with the CHECK constraints (drift)", async () => {
      const defs = await import("@/lib/vehicle-merges/definitions");
      const values = async (constraint: string) => {
        const definition = (await pools.admin.query<{ d: string }>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = $1`, [constraint])).rows[0].d;
        return [...definition.matchAll(/'([A-Za-z_]+)'::text/g)].map((match) => match[1]);
      };
      assert.deepEqual(await values("vehicle_merges_reason_valid"), [...defs.MERGE_REASONS]);
      assert.deepEqual(await values("vehicle_merges_record_status_valid"), [...defs.MERGE_STATUSES]);
      const vehicleStatus = (await pools.admin.query<{ d: string }>(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.vehicles'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ 'merged'::text AND pg_get_constraintdef(oid) ~ 'ARRAY'`)).rows.map((row) => row.d).join(" ");
      for (const status of defs.VEHICLE_RECORD_STATUSES) assert.match(vehicleStatus, new RegExp(`'${status}'`), status);
    });

    scenario("VEHICLE_READ and VEHICLE_MANAGE are SYSTEM capabilities; this migration adds and grants none", async () => {
      const tes = await import("@/lib/auth/tes-capabilities");
      assert.equal(tes.TES_CAPABILITY_SCOPES.VEHICLE_READ, "SYSTEM");
      assert.equal(tes.TES_CAPABILITY_SCOPES.VEHICLE_MANAGE, "SYSTEM");
      assert.equal(await rowCount(`SELECT count(*) FROM public.capabilities WHERE code IN ('VEHICLE_READ', 'VEHICLE_MANAGE') AND is_active`), 2);
      assert.equal(await rowCount(`SELECT count(*) FROM public.capabilities WHERE code ~ 'MERGE'`), 0, "no merge-specific capability exists");
    });

    scenario("every new function is invoker with a fixed search_path and no PUBLIC execute; RLS is on with the single SYSTEM policy", async () => {
      const functions = (await pools.admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; public_execute: boolean }>(
        `SELECT p.proname, p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname IN ('prevent_vehicle_merge_data_removal', 'guard_vehicle_merge_insert', 'guard_vehicle_merge_update', 'require_vehicle_merge_consistency')`,
      )).rows;
      assert.equal(functions.length, 4);
      for (const fn of functions) {
        assert.equal(fn.prosecdef, false, fn.proname);
        assert.deepEqual(fn.proconfig, ["search_path=pg_catalog"], fn.proname);
        assert.equal(fn.public_execute, false, fn.proname);
      }
      assert.equal((await pools.admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.vehicle_merges'::regclass`)).rows[0].relrowsecurity, true);
      const policies = (await pools.admin.query<{ policyname: string; cmd: string; qual: string; with_check: string }>(`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_merges'`)).rows;
      assert.equal(policies.length, 1);
      assert.equal(policies[0].cmd, "ALL");
      assert.match(policies[0].qual, /VEHICLE_READ.*VEHICLE_MANAGE/);
      assert.match(policies[0].with_check, /VEHICLE_MANAGE/);
      assert.doesNotMatch(policies[0].with_check, /VEHICLE_READ/);
      assert.doesNotMatch(policies[0].qual, /customer/i, "no CUSTOMER path");
    });

    scenario("runtime privileges: SELECT, column-specific INSERT / UPDATE only; no DELETE, TRUNCATE, REFERENCES or TRIGGER; nothing for PUBLIC", async () => {
      const has = async (privilege: string) => (await pools.admin.query(`SELECT has_table_privilege($1, 'public.vehicle_merges'::regclass, $2) AS ok`, [RUNTIME_ROLE, privilege])).rows[0].ok;
      const column = async (name: string, privilege: string) =>
        (await pools.admin.query(`SELECT has_column_privilege($1, 'public.vehicle_merges'::regclass, $2, $3) AS ok`, [RUNTIME_ROLE, name, privilege])).rows[0].ok;
      for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "INSERT", "UPDATE"]) assert.equal(await has(privilege), false, `table-level ${privilege}`);
      assert.equal(await has("SELECT"), true);
      assert.equal(await rowCount(`SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = 'vehicle_merges' AND grantee = 'PUBLIC'`), 0);
      const all = (await pools.admin.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vehicle_merges'`)).rows.map((row) => row.column_name);
      const writable = async (privilege: string) => {
        const names: string[] = [];
        for (const name of all) if (await column(name, privilege)) names.push(name);
        return names.sort();
      };
      assert.deepEqual(await writable("INSERT"), ["id", "merge_reason", "source_vehicle_id", "target_vehicle_id"]);
      assert.deepEqual(await writable("UPDATE"), ["record_status", "reversed_at", "updated_at"]);
      await assert.rejects(pools.runtime.query(`DELETE FROM public.vehicle_merges`), /permission denied/);
      await assert.rejects(pools.runtime.query(`TRUNCATE public.vehicle_merges`), /permission denied/);
    });
  });

  // =============================================================================================================
  describe("authorization", () => {
    scenario("no session, no capability and the wrong capability are denied and change nothing", async () => {
      const [survivor, duplicate, other] = await vehicleList(3);
      const done = await (async () => {
        await fullStaff();
        return merge(survivor, duplicate);
      })();
      const ids = [survivor, duplicate, other];
      const before = await stateOf(ids);
      const mutations: Array<[string, () => Promise<unknown>]> = [
        ["mergeVehicles", () => merge(survivor, other)],
        ["reverseVehicleMerge", () => reverse(done.merge.id)],
      ];
      const reads: Array<[string, () => Promise<unknown>]> = [
        ["resolveVehicle", () => K.v.resolveVehicle(duplicate)],
        ["listVehicleMerges", () => K.v.listVehicleMerges(duplicate)],
      ];

      K.db.setClerkUser(null);
      for (const [, call] of [...mutations, ...reads]) await assert.rejects(call());

      signIn(await staff());
      for (const [, call] of [...mutations, ...reads]) await denied(call());
      // other SYSTEM capabilities authorize nothing here
      for (const other of ["DRIVER_MANAGE", "IDENTITY_RESOLUTION_MANAGE", "ORGANIZATION_READ", "ORGANIZATION_UPDATE", "INSURANCE_READ", "INSURANCE_MANAGE"]) {
        signIn(await staff(other));
        for (const [, call] of [...mutations, ...reads]) await denied(call());
      }
      assert.equal(await stateOf(ids), before, "denied calls changed nothing");
    });

    scenario("VEHICLE_READ alone reads and cannot mutate; VEHICLE_MANAGE alone mutates and cannot read", async () => {
      const [survivor, duplicate] = await vehicleList(2);
      const reader = await staff("VEHICLE_READ");
      const manager = await staff("VEHICLE_MANAGE");

      signIn(reader);
      assert.equal((await K.v.resolveVehicle(duplicate)).resolvedVehicleId, duplicate);
      assert.deepEqual((await K.v.listVehicleMerges(duplicate)).merges, []);
      await denied(merge(survivor, duplicate));
      assert.equal(await ledgerCount([survivor, duplicate]), 0);

      signIn(manager);
      const result = await merge(survivor, duplicate);
      await denied(K.v.resolveVehicle(duplicate));
      await denied(K.v.listVehicleMerges(duplicate));

      signIn(reader);
      await denied(reverse(result.merge.id));
      assert.equal((await ledgerRows(duplicate))[0].record_status, "active", "READ cannot reverse");
      assert.equal((await K.v.resolveVehicle(duplicate)).resolvedVehicleId, survivor);

      signIn(manager);
      assert.equal((await reverse(result.merge.id)).merge.status, "reversed");
    });

    scenario("a customer actor cannot use any operation, even with customer-scoped grants", async () => {
      const [survivor, duplicate] = await vehicleList(2);
      await fullStaff();
      const done = await merge(survivor, duplicate);
      const { customerId } = await fx.organizationAndCustomer("VM customer");
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      const before = await stateOf([survivor, duplicate]);
      signIn(actor);
      await denied(K.v.resolveVehicle(duplicate));
      await denied(K.v.listVehicleMerges(duplicate));
      await denied(merge(duplicate, survivor));
      await denied(reverse(done.merge.id));
      assert.equal(await stateOf([survivor, duplicate]), before);
    });
  });

  // =============================================================================================================
  describe("row-level security of vehicle_merges (policy-bound runtime role)", () => {
    scenario("the table is SYSTEM-only and keyed on VEHICLE_*: other capabilities, other actors and customer scope see nothing", async () => {
      const [survivor, duplicate] = await vehicleList(2);
      const organizationId = await organization();
      await relationship(organizationId, duplicate, `UNIT-${run}`);
      await fullStaff();
      const done = await merge(survivor, duplicate);
      const reader = await staff("VEHICLE_READ");
      const manager = await staff("VEHICLE_MANAGE");
      const unrelated = await staff("INSURANCE_READ", "INSURANCE_MANAGE", "DRIVER_MANAGE");
      const count = `SELECT count(*)::int AS n FROM public.vehicle_merges WHERE id = $1`;
      const visible = async (actor: TestActor | null, capability: string | null) => {
        const rows: unknown[][] = [];
        const outcome = await runtimeTransaction(actor, capability, [[count, [done.merge.id]]], rows);
        assert.equal(outcome.error, undefined);
        return (rows[0] as Array<{ n: number }>)[0].n;
      };

      assert.equal(await visible(reader, "VEHICLE_READ"), 1);
      assert.equal(await visible(manager, "VEHICLE_MANAGE"), 1);
      assert.equal(await visible(null, null), 0, "no context at all");
      assert.equal(await visible(unrelated, "INSURANCE_READ"), 0, "an unrelated capability");
      assert.equal(await visible(unrelated, "DRIVER_MANAGE"), 0);
      assert.equal(await visible(unrelated, "VEHICLE_READ"), 0, "claiming a capability the actor does not hold");
      assert.equal(await visible(reader, "VEHICLE_MANAGE"), 0, "the actor holds READ only");
      assert.equal(await visible(reader, "INSURANCE_READ"), 0, "a capability the actor does not hold");

      // READ sees but cannot write; an unrelated capability cannot write
      const [freshSurvivor, freshDuplicate] = await vehicleList(2);
      const insert: Step = [INSERT_LEDGER, [randomUUID(), freshSurvivor, freshDuplicate]];
      assert.equal((await runtimeTransaction(reader, "VEHICLE_READ", [insert])).error?.code, "42501", "READ cannot insert");
      // without a VEHICLE_* context the vehicles themselves are invisible, so the insert guard reports them as not active (55000)
      assert.equal((await runtimeTransaction(unrelated, "INSURANCE_MANAGE", [insert])).error?.code, "55000", "unrelated capability cannot insert");
      assert.equal((await runtimeTransaction(null, null, [insert])).error?.code, "55000", "no context cannot insert");
      assert.equal(await ledgerCount([freshSurvivor, freshDuplicate]), 0);
      const rows: unknown[][] = [];
      const update = await runtimeTransaction(reader, "VEHICLE_READ", [[REVERSE_LEDGER + " RETURNING id", [done.merge.id]]], rows);
      assert.equal(update.error?.code, "42501", "READ cannot reverse");

      // customer scope cannot reach SYSTEM data: not for a customer unrelated to the vehicle, and not for one that operates it
      const customerContext = async (customerId: string, customerActorId: string, work: (client: import("pg").PoolClient) => Promise<void>) => {
        const client = await pools.runtime.connect();
        try {
          await client.query("BEGIN");
          await client.query(`SELECT set_config('tes.customer_id', $1, true), set_config('tes.customer_actor_id', $2, true), set_config('tes.customer_capability', 'ORGANIZATION_READ', true)`, [customerId, customerActorId]);
          await work(client);
        } finally {
          await client.query("ROLLBACK").catch(() => undefined);
          client.release();
        }
      };
      const customerOf = async (label: string) => {
        const tenant = await fx.organizationAndCustomer(label);
        const actor = await fx.actor();
        const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER");
        const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: tenant.customerId });
        await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
        return { ...tenant, actorId: actor.actorId };
      };
      const unrelatedCustomer = await customerOf("VM unrelated tenant");
      await customerContext(unrelatedCustomer.customerId, unrelatedCustomer.actorId, async (client) => {
        assert.equal((await client.query(`SELECT count(*)::int AS n FROM public.vehicle_merges`)).rows[0].n, 0);
        assert.equal((await client.query(`SELECT count(*)::int AS n FROM public.vehicles WHERE id = $1`, [duplicate])).rows[0].n, 0);
      });
      const operating = await customerOf("VM operating tenant");
      const operated = await vehicle();
      await relationship(operating.organizationId, operated, `OWN-${run}`);
      await customerContext(operating.customerId, operating.actorId, async (client) => {
        assert.equal((await client.query(`SELECT count(*)::int AS n FROM public.vehicles WHERE id = $1`, [operated])).rows[0].n, 1, "the operated vehicle is visible (migration 0024)");
        assert.equal((await client.query(`SELECT count(*)::int AS n FROM public.vehicle_merges`)).rows[0].n, 0, "the ledger never is");
      });
      assert.equal((await ledgerRows(duplicate))[0].record_status, "active", "nothing above changed the ledger");
    });
  });

  // =============================================================================================================
  describe("merge and reversal (happy paths)", () => {
    scenario("a merge records the ledger row and flips the duplicate; nothing else changes and nothing is copied", async () => {
      const actor = await fullStaff();
      const [survivor, duplicate] = await vehicleList(2);
      const survivorBefore = await vehicleJson(survivor);
      const duplicateBefore = await vehicleRow(duplicate);
      const duplicateColumnsBefore = JSON.parse(await vehicleJson(duplicate)) as Record<string, unknown>;

      const result = await merge(survivor, duplicate, "IDENTIFIER_CORRECTION");
      assert.match(result.merge.id, UUID);
      assert.equal(result.merge.mergedVehicleId, duplicate);
      assert.equal(result.merge.survivorVehicleId, survivor);
      assert.equal(result.merge.reason, "IDENTIFIER_CORRECTION");
      assert.equal(result.merge.status, "active");
      assert.equal(result.merge.reversedAt, null);
      assert.match(result.merge.mergedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      assert.deepEqual(result.mergedVehicle, { id: duplicate, recordStatus: "merged", mergedIntoVehicleId: survivor });

      assert.equal(await vehicleJson(survivor), survivorBefore, "the survivor row is byte-for-byte untouched");
      const after = await vehicleRow(duplicate);
      assert.equal(after.record_status, "merged");
      assert.equal(after.merged_into_vehicle_id, survivor);
      assert.equal(after.vin_normalized, duplicateBefore.vin_normalized, "the merged vehicle keeps its own identifier");
      const duplicateColumnsAfter = JSON.parse(await vehicleJson(duplicate)) as Record<string, unknown>;
      for (const column of Object.keys(duplicateColumnsBefore)) {
        if (["record_status", "merged_into_vehicle_id", "updated_at"].includes(column)) continue;
        assert.deepEqual(duplicateColumnsAfter[column], duplicateColumnsBefore[column], `${column} is unchanged`);
      }
      const ledger = await ledgerRows(duplicate);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].id, result.merge.id);
      assert.equal(ledger[0].source_vehicle_id, duplicate);
      assert.equal(ledger[0].target_vehicle_id, survivor);
      assert.deepEqual(await eventTypes(actor.actorId), ["RECORD_CREATED", "RECORD_STATUS_CHANGED"]);
      await assertConsistent([survivor, duplicate]);
    });

    scenario("every merge reason is accepted; the identifier of the survivor is never overwritten, whatever the duplicate carries", async () => {
      await fullStaff();
      for (const reason of REASONS) {
        const [survivor, duplicate] = await vehicleList(2);
        assert.equal((await merge(survivor, duplicate, reason)).merge.reason, reason);
      }
      // a survivor WITHOUT a VIN stays without one: the duplicate's VIN is not copied
      const noVin = await vehicle({ vin: null });
      const withVin = await vehicle();
      await merge(noVin, withVin);
      assert.equal((await vehicleRow(noVin)).vin_normalized, null, "no silent copy of identity data");
      assert.notEqual((await vehicleRow(withVin)).vin_normalized, null, "no silent loss either");
      // two different non-null VINs are allowed: they were distinct identifiers of a duplicate, and both are kept
      const [keptA, keptB] = await vehicleList(2);
      const vins = [(await vehicleRow(keptA)).vin_normalized, (await vehicleRow(keptB)).vin_normalized];
      assert.notEqual(vins[0], vins[1]);
      await merge(keptA, keptB);
      assert.deepEqual([(await vehicleRow(keptA)).vin_normalized, (await vehicleRow(keptB)).vin_normalized], vins);
      // a VIN-less duplicate merges into a survivor with a VIN
      const [vinned] = await vehicleList(1);
      const bare = await vehicle({ vin: null });
      await merge(vinned, bare);
      assert.equal((await vehicleRow(bare)).vin_normalized, null);
    });

    scenario("records of other domains stay attached to the vehicle that earned them (alias semantics, no rewrite), across merge and reversal", async () => {
      await fullStaff();
      const [survivor, duplicate] = await vehicleList(2);
      const organizationId = await organization();
      const relationshipId = await relationship(organizationId, duplicate, `ALIAS-${run}`);
      const survivorRelationship = await relationship(organizationId, survivor, `KEEP-${run}`);
      const holdings = async () =>
        JSON.stringify((await pools.admin.query(`SELECT id, vehicle_id, organization_id FROM public.organization_vehicle_relationships WHERE id = ANY($1::uuid[]) ORDER BY id`, [[relationshipId, survivorRelationship]])).rows);
      const before = await holdings();

      const done = await merge(survivor, duplicate);
      assert.equal(await holdings(), before, "the relationship still points at the merged vehicle");
      assert.equal((await K.v.resolveVehicle(duplicate)).resolvedVehicleId, survivor, "readers follow resolveVehicle to the survivor");
      await reverse(done.merge.id);
      assert.equal(await holdings(), before, "and still does after the reversal");
    });

    scenario("resolveVehicle: itself when never merged, the survivor when merged, with hops; archived targets are reported as such", async () => {
      await fullStaff();
      const [a, b, c, lone] = await vehicleList(4);
      assert.deepEqual(await K.v.resolveVehicle(lone), { requestedVehicleId: lone, resolvedVehicleId: lone, hops: 0, resolvedRecordStatus: "active" });
      await merge(b, a);
      assert.deepEqual(await K.v.resolveVehicle(a), { requestedVehicleId: a, resolvedVehicleId: b, hops: 1, resolvedRecordStatus: "active" });
      await merge(c, b);
      assert.deepEqual(await K.v.resolveVehicle(a), { requestedVehicleId: a, resolvedVehicleId: c, hops: 2, resolvedRecordStatus: "active" });
      assert.deepEqual(await K.v.resolveVehicle(b), { requestedVehicleId: b, resolvedVehicleId: c, hops: 1, resolvedRecordStatus: "active" });
      assert.equal((await K.v.resolveVehicle(c)).hops, 0);
      assert.equal((await K.v.resolveVehicle(a.toUpperCase())).requestedVehicleId, a, "ids are normalized");
      await pools.admin.query(`UPDATE public.vehicles SET record_status = 'archived', archived_at = now() WHERE id = $1`, [c]);
      assert.deepEqual(await K.v.resolveVehicle(a), { requestedVehicleId: a, resolvedVehicleId: c, hops: 2, resolvedRecordStatus: "archived" });
    });

    scenario("listVehicleMerges: the vehicle as merged vehicle and as survivor, reversed rows flagged, ids and enums only", async () => {
      await fullStaff();
      const [a, b, c] = await vehicleList(3);
      const first = await merge(b, a, "DUPLICATE_RECORD");
      const second = await merge(c, b, "RESOLUTION_REVIEW");
      const asB = await K.v.listVehicleMerges(b);
      assert.equal(asB.vehicleId, b);
      assert.deepEqual(asB.merges.map((row) => [row.id, row.role, row.reversed, row.status]), [
        [first.merge.id, "SURVIVOR", false, "active"],
        [second.merge.id, "MERGED", false, "active"],
      ]);
      await reverse(second.merge.id);
      await reverse(first.merge.id);
      const again = await merge(b, a, "IDENTIFIER_CORRECTION");
      const asA = await K.v.listVehicleMerges(a);
      assert.deepEqual(asA.merges.map((row) => [row.id, row.role, row.reversed, row.status, row.reason]), [
        [first.merge.id, "MERGED", true, "reversed", "DUPLICATE_RECORD"],
        [again.merge.id, "MERGED", false, "active", "IDENTIFIER_CORRECTION"],
      ]);
      assert.ok(asA.merges[0].reversedAt !== null && asA.merges[0].reversedAt >= asA.merges[0].mergedAt);
      assert.equal(asA.merges[1].reversedAt, null);
      assert.deepEqual((await K.v.listVehicleMerges(c)).merges.map((row) => [row.id, row.role, row.reversed]), [[second.merge.id, "SURVIVOR", true]]);
      assert.deepEqual((await K.v.listVehicleMerges((await vehicleList(1))[0])).merges, []);
      const json = JSON.stringify([asA, asB]);
      assert.doesNotMatch(json, /vin|TV[0-9A-F]{8}\d{7}/i, "no VIN reaches a read result");
      for (const row of asA.merges) assert.deepEqual(Object.keys(row).sort(), ["createdAt", "id", "mergedAt", "mergedVehicleId", "reason", "reversed", "reversedAt", "role", "status", "survivorVehicleId"]);
    });

    scenario("a reversal returns the vehicle to active, keeps the ledger row and allows the same merge again", async () => {
      const actor = await fullStaff();
      const [survivor, duplicate] = await vehicleList(2);
      const done = await merge(survivor, duplicate);
      const reversed = await reverse(done.merge.id);
      assert.equal(reversed.merge.id, done.merge.id);
      assert.equal(reversed.merge.status, "reversed");
      assert.ok(reversed.merge.reversedAt !== null && reversed.merge.reversedAt >= reversed.merge.mergedAt);
      assert.deepEqual(reversed.mergedVehicle, { id: duplicate, recordStatus: "active", mergedIntoVehicleId: null });
      const row = await vehicleRow(duplicate);
      assert.equal(row.record_status, "active");
      assert.equal(row.merged_into_vehicle_id, null);
      assert.equal(row.archived_at, null);
      assert.equal((await K.v.resolveVehicle(duplicate)).resolvedVehicleId, duplicate);
      assert.equal((await ledgerRows(duplicate)).length, 1, "the ledger row is kept");
      assert.deepEqual(await eventTypes(actor.actorId), ["RECORD_CREATED", "RECORD_STATUS_CHANGED", "RECORD_UPDATED", "RECORD_STATUS_CHANGED"]);

      // merge again after the reversal: a NEW ledger row, the old one stays reversed
      const again = await merge(survivor, duplicate, "RESOLUTION_REVIEW");
      assert.notEqual(again.merge.id, done.merge.id);
      assert.deepEqual((await ledgerRows(duplicate)).map((r) => r.record_status), ["reversed", "active"]);
      assert.equal((await K.v.resolveVehicle(duplicate)).resolvedVehicleId, survivor);
      // ... and the opposite direction is possible too after a reversal
      await reverse(again.merge.id);
      assert.equal((await merge(duplicate, survivor)).mergedVehicle.mergedIntoVehicleId, duplicate);
      await assertConsistent([survivor, duplicate]);
    });

    scenario("the merged vehicle leaves the VIN namespace while merged; the survivor keeps its own VIN", async () => {
      await fullStaff();
      const [survivor, duplicate] = await vehicleList(2);
      const vin = (await vehicleRow(duplicate)).vin_normalized;
      await merge(survivor, duplicate);
      const taker = await vehicle({ vin });
      assert.equal((await vehicleRow(taker)).vin_normalized, vin, "a new current vehicle may now hold the VIN");
      assert.equal(await rowCount(`SELECT count(*) FROM public.vehicles WHERE vin_normalized = $1 AND record_status <> 'merged'`, [vin]), 1);
    });
  });

  // =============================================================================================================
  describe("refusals", () => {
    scenario("invalid input is a validation error before anything is read or written", async () => {
      const actor = await fullStaff();
      const [a, b] = await vehicleList(2);
      const before = await stateOf([a, b]);
      const eventsBefore = (await eventTypes(actor.actorId)).length;
      const bad: unknown[] = [
        undefined, null, "x", 7, [], {}, { ...input(a, b), reason: "OTHER" }, { survivorId: a, mergedId: b }, { survivorId: a, reason: "DUPLICATE_RECORD" }, { mergedId: b, reason: "DUPLICATE_RECORD" },
        { ...input(a, b), extra: 1 }, { ...input(a, b), reason: "duplicate_record" }, { ...input(a, b), reason: " DUPLICATE_RECORD" }, { ...input(a, b), survivorId: "not-a-uuid" },
        { ...input(a, b), mergedId: 12 }, { ...input(a, b), survivorId: "" }, { ...input(a, b), mergedId: null },
        input(a, a), { ...input(a, a), mergedId: a.toUpperCase() }, { ...input(a, a), mergedId: ` ${a} ` },
      ];
      for (const value of bad) await invalid(K.v.mergeVehicles(value));
      for (const value of [undefined, null, "x", [], {}, { mergeId: "nope" }, { mergeId: 5 }, { mergeId: randomUUID(), extra: true }, { id: randomUUID() }]) await invalid(K.v.reverseVehicleMerge(value));
      await invalid(K.v.resolveVehicle("not-a-uuid"));
      await invalid(K.v.listVehicleMerges(""));
      assert.equal(await stateOf([a, b]), before);
      assert.equal((await eventTypes(actor.actorId)).length, eventsBefore, "refusals record nothing");

      // the field is named, never a column
      await assert.rejects(K.v.mergeVehicles({ ...input(a, b), reason: "NOPE" }), (error: unknown) => error instanceof K.v.VehicleMergeValidationError && error.field === "reason");
      await assert.rejects(K.v.mergeVehicles(input(a, a)), (error: unknown) => error instanceof K.v.VehicleMergeValidationError && error.field === "mergedId");
    });

    scenario("unknown vehicles and merges are not found", async () => {
      const actor = await fullStaff();
      const [a] = await vehicleList(1);
      const eventsBefore = (await eventTypes(actor.actorId)).length;
      await notFound(merge(a, randomUUID()));
      await notFound(merge(randomUUID(), a));
      await notFound(merge(randomUUID(), randomUUID()));
      await notFound(reverse(randomUUID()));
      await notFound(K.v.resolveVehicle(randomUUID()));
      await notFound(K.v.listVehicleMerges(randomUUID()));
      assert.equal(await ledgerCount([a]), 0);
      assert.equal((await eventTypes(actor.actorId)).length, eventsBefore);
    });

    scenario("a self-merge row is refused by the table's own CHECK even when the insert guard is out of the way (owner level)", async () => {
      await fullStaff();
      const [a] = await vehicleList(1);
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        await client.query("ALTER TABLE public.vehicle_merges DISABLE TRIGGER vehicle_merges_guard_insert");
        await assert.rejects(
          client.query(`INSERT INTO public.vehicle_merges (source_vehicle_id, target_vehicle_id, merge_reason) VALUES ($1, $1, 'DUPLICATE_RECORD')`, [a]),
          (error: PgError) => error.constraint === "vehicle_merges_not_self",
        );
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
      assert.equal(await ledgerCount([a]), 0);
    });

    scenario("both vehicles must be active: archived, already merged and merged-away vehicles are state errors; self-merge and cycles are refused", async () => {
      const actor = await fullStaff();
      const [a, b, c, d] = await vehicleList(4);
      const archived = await vehicle({ archived: true });
      const eventsBefore = (await eventTypes(actor.actorId)).length;
      await stateError(merge(a, archived));
      await stateError(merge(archived, a));
      // the service names the offending side itself, before the database backstop is reached
      await assert.rejects(merge(a, archived), /vehicle to merge must be active/);
      await assert.rejects(merge(archived, a), /surviving vehicle must be active/);
      assert.equal(await ledgerCount([a, archived]), 0);

      const first = await merge(b, a); // a -> b
      await stateError(merge(c, a)); // a is already merged away
      await stateError(merge(a, c)); // cannot merge INTO a merged vehicle
      await stateError(merge(a, b)); // the opposite direction is a cycle: a is no longer active
      await stateError(merge(b, a)); // the same merge again
      const second = await merge(c, b); // b -> c (a chain)
      await stateError(merge(a, c)); // c -> a would close the loop a -> b -> c -> a
      await stateError(merge(b, c));
      assert.equal(await ledgerCount([a, b, c, d]), 2);
      assert.equal((await eventTypes(actor.actorId)).length, eventsBefore + 4, "only the two accepted merges recorded events");
      assert.equal((await K.v.resolveVehicle(a)).resolvedVehicleId, c);
      assert.deepEqual([first.merge.status, second.merge.status], ["active", "active"]);
      await assertConsistent([a, b, c, d, archived]);
    });

    scenario("double reversal is a state error; the first reversal stands", async () => {
      const actor = await fullStaff();
      const [survivor, duplicate] = await vehicleList(2);
      const done = await merge(survivor, duplicate);
      await reverse(done.merge.id);
      const snapshot = await stateOf([survivor, duplicate]);
      const events = (await eventTypes(actor.actorId)).length;
      await stateError(reverse(done.merge.id));
      await stateError(reverse(done.merge.id));
      assert.equal(await stateOf([survivor, duplicate]), snapshot);
      assert.equal((await eventTypes(actor.actorId)).length, events);
    });

    scenario("chain order: with A->B and B->C, B->C is reversed first; the survivor merged away blocks the earlier reversal", async () => {
      const actor = await fullStaff();
      const [a, b, c] = await vehicleList(3);
      const ab = await merge(b, a);
      const bc = await merge(c, b);
      const snapshot = await stateOf([a, b, c]);
      const events = (await eventTypes(actor.actorId)).length;
      await stateError(reverse(ab.merge.id));
      await assert.rejects(reverse(ab.merge.id), /reverse that merge first/);
      assert.equal(await stateOf([a, b, c]), snapshot, "the refused reversal changed nothing");
      assert.equal((await eventTypes(actor.actorId)).length, events);
      assert.equal((await K.v.resolveVehicle(a)).resolvedVehicleId, c);

      await reverse(bc.merge.id);
      assert.equal((await K.v.resolveVehicle(a)).resolvedVehicleId, b, "after B->C is reversed A resolves to B");
      assert.equal((await K.v.resolveVehicle(b)).resolvedVehicleId, b);
      await reverse(ab.merge.id);
      assert.equal((await K.v.resolveVehicle(a)).resolvedVehicleId, a);
      assert.deepEqual((await ledgerRows(b)).map((row) => row.record_status), ["reversed", "reversed"]);
      await assertConsistent([a, b, c]);
    });

    scenario("a long chain resolves up to the bound and is refused beyond it; a corrupted loop cannot hang the walk", async () => {
      await fullStaff();
      const defs = await import("@/lib/vehicle-merges/definitions");
      const chain = await vehicleList(defs.MAX_RESOLUTION_HOPS + 2);
      for (let i = 0; i < chain.length - 1; i += 1) await merge(chain[i + 1], chain[i]);
      const last = chain[chain.length - 1];
      const within = await K.v.resolveVehicle(chain[1]);
      assert.deepEqual([within.resolvedVehicleId, within.hops], [last, defs.MAX_RESOLUTION_HOPS]);
      await stateError(K.v.resolveVehicle(chain[0]));

      // owner-level corruption: a two-vehicle loop (the cycle guard and the consistency trigger are lifted only for this fixture)
      const [x, y] = await vehicleList(2);
      const lift = async (enable: boolean) => {
        const verb = enable ? "ENABLE" : "DISABLE";
        await pools.admin.query(`ALTER TABLE public.vehicles ${verb} TRIGGER vehicles_merge_cycle_guard`);
        await pools.admin.query(`ALTER TABLE public.vehicles ${verb} TRIGGER vehicles_require_merge_consistency`);
      };
      await lift(false);
      cleanups.push(() => lift(true));
      await pools.admin.query(`UPDATE public.vehicles SET record_status = 'merged', merged_into_vehicle_id = CASE id WHEN $1 THEN $2::uuid ELSE $1::uuid END WHERE id IN ($1, $2)`, [x, y]);
      await lift(true);
      await stateError(K.v.resolveVehicle(x));
      await stateError(K.v.resolveVehicle(y));
      await lift(false);
      await pools.admin.query(`UPDATE public.vehicles SET record_status = 'active', merged_into_vehicle_id = NULL WHERE id IN ($1, $2)`, [x, y]);
      await lift(true);
      assert.equal((await K.v.resolveVehicle(x)).hops, 0);
    });
  });

  // =============================================================================================================
  describe("VIN namespace on reversal", () => {
    scenario("a taken VIN makes the reversal a collision; everything rolls back; the holder is named only to VEHICLE_READ holders, and no VIN is ever in the message", async () => {
      const manager = await staff("VEHICLE_MANAGE");
      const full = await staff(...BOTH);
      signIn(full);
      const [survivor, duplicate] = await vehicleList(2);
      const vin = (await vehicleRow(duplicate)).vin_normalized as string;
      const done = await merge(survivor, duplicate);
      const holder = await vehicle({ vin });
      const ids = [survivor, duplicate, holder];
      const snapshot = await stateOf(ids);
      const events = (await eventTypes(full.actorId)).length;

      for (const [who, expectedHolder] of [[full, holder], [manager, undefined]] as const) {
        signIn(who);
        await assert.rejects(reverse(done.merge.id), (error: unknown) => {
          assert.ok(error instanceof K.v.VehicleVinCollisionError, String(error));
          assert.equal(error.code, "VEHICLE_MERGE_VIN_COLLISION");
          assert.equal(error.holderVehicleId, expectedHolder);
          assert.equal(error.message.includes(vin), false, "the message carries no VIN");
          assert.doesNotMatch(error.message, /vehicles_vin_current_uq|duplicate key|constraint/i, "no database detail");
          return true;
        });
        assert.equal(await stateOf(ids), snapshot, "full rollback: ledger, vehicles and updated_at");
      }
      assert.equal((await eventTypes(full.actorId)).length, events, "no event is recorded for the failed reversal");
      assert.equal((await eventTypes(manager.actorId)).length, 0);
      assert.equal((await vehicleRow(duplicate)).record_status, "merged");
      assert.equal((await ledgerRows(duplicate))[0].record_status, "active");
      await assertConsistent(ids);

      // an ARCHIVED holder still occupies the namespace; a merged-away holder does not
      await pools.admin.query(`UPDATE public.vehicles SET record_status = 'archived', archived_at = now() WHERE id = $1`, [holder]);
      signIn(full);
      await assert.rejects(reverse(done.merge.id), (error: unknown) => error instanceof K.v.VehicleVinCollisionError && error.holderVehicleId === holder);
      // once the holder lets go of the VIN the reversal succeeds
      await pools.admin.query(`UPDATE public.vehicles SET vin_normalized = NULL, vin_display = NULL WHERE id = $1`, [holder]);
      assert.equal((await reverse(done.merge.id)).merge.status, "reversed");
      assert.equal((await vehicleRow(duplicate)).vin_normalized, vin);
    });

    scenario("the same collision when the VIN holder arrives concurrently with the reversal never surfaces a raw database error", async () => {
      const as = await concurrentActors(2);
      for (let round = 0; round < 4; round += 1) {
        const [survivor, duplicate] = await vehicleList(2);
        const vin = (await vehicleRow(duplicate)).vin_normalized as string;
        const done = await as(0, () => merge(survivor, duplicate));
        const holderId = randomUUID();
        vehicles.push(holderId);
        const results = await Promise.allSettled([
          as(0, () => reverse(done.merge.id)),
          pools.admin.query(`INSERT INTO public.vehicles (id, vehicle_type_code, vin_display, vin_normalized) VALUES ($1, 'TRUCK_TRACTOR', $2, $2)`, [holderId, vin]),
        ]);
        const reversal = results[0];
        const insert = results[1];
        if (reversal.status === "fulfilled") {
          assert.equal(insert.status, "rejected", "the VIN was taken by the reversal first, so the new vehicle is the one refused");
          assert.equal((await vehicleRow(duplicate)).record_status, "active");
        } else {
          assert.ok(reversal.reason instanceof K.v.VehicleVinCollisionError, String(reversal.reason));
          assert.equal(insert.status, "fulfilled");
          assert.equal((await vehicleRow(duplicate)).record_status, "merged");
        }
        await assertConsistent([survivor, duplicate]);
      }
    });
  });

  // =============================================================================================================
  describe("database backstops (reachable when the service is bypassed), as the runtime role AND as the table owner", () => {
    for (const mode of ["runtime", "owner"] as const) {
      /** `runtime` carries the real VEHICLE_MANAGE context; `owner` is the migration identity, which bypasses RLS but not triggers. */
      const execute = async (steps: Step[]): Promise<Outcome> => {
        if (mode === "owner") return ownerTransaction(steps);
        const actor = await staff("VEHICLE_MANAGE");
        return runtimeTransaction(actor, "VEHICLE_MANAGE", steps);
      };
      const expectFailure = (outcome: Outcome, code: string, constraint?: string, message?: RegExp) => {
        assert.ok(outcome.error, "the database rejects it");
        assert.equal(outcome.error.code, code, outcome.error.message);
        if (constraint) assert.equal(outcome.error.constraint, constraint);
        if (message) assert.match(outcome.error.message, message);
      };
      const asService = async () => {
        await fullStaff();
      };

      scenario(`${mode}: a bare ledger row without the vehicle state is rejected at commit`, async () => {
        const [survivor, duplicate] = await vehicleList(2);
        const snapshot = await stateOf([survivor, duplicate]);
        expectFailure(await execute([[INSERT_LEDGER, [randomUUID(), duplicate, survivor]]]), "23514", "vehicles_merged_state_consistent");
        assert.equal(await stateOf([survivor, duplicate]), snapshot);
      });

      scenario(`${mode}: a vehicle flipped to merged without a ledger row is rejected at commit; so is one pointing at a different survivor than its ledger row`, async () => {
        const [survivor, duplicate, other] = await vehicleList(3);
        const snapshot = await stateOf([survivor, duplicate, other]);
        expectFailure(await execute([[FLIP_MERGED, [duplicate, survivor]]]), "23514", "vehicles_merged_state_consistent");
        expectFailure(await execute([[INSERT_LEDGER, [randomUUID(), duplicate, survivor]], [FLIP_MERGED, [duplicate, other]]]), "23514", "vehicles_merged_state_consistent");
        assert.equal(await stateOf([survivor, duplicate, other]), snapshot);
      });

      scenario(`${mode}: the consistent pair commits, and undoing only one side is rejected`, async () => {
        const [survivor, duplicate] = await vehicleList(2);
        const mergeId = randomUUID();
        assert.deepEqual(await execute([[INSERT_LEDGER, [mergeId, duplicate, survivor]], [FLIP_MERGED, [duplicate, survivor]]]), {}, "ledger row and vehicle state together are accepted");
        await assertConsistent([survivor, duplicate]);
        expectFailure(await execute([[FLIP_ACTIVE, [duplicate]]]), "23514", "vehicles_merged_state_consistent");
        expectFailure(await execute([[REVERSE_LEDGER, [mergeId]]]), "23514", "vehicles_merged_state_consistent");
        assert.deepEqual(await execute([[REVERSE_LEDGER, [mergeId]], [FLIP_ACTIVE, [duplicate]]]), {}, "the consistent reversal is accepted");
        assert.equal((await vehicleRow(duplicate)).record_status, "active");
        await assertConsistent([survivor, duplicate]);
      });

      scenario(`${mode}: both vehicles of a ledger row must be active when it is inserted`, async () => {
        const [survivor, duplicate] = await vehicleList(2);
        const archived = await vehicle({ archived: true });
        expectFailure(await execute([[INSERT_LEDGER, [randomUUID(), duplicate, archived]]]), "55000", "vehicle_merges_both_active");
        expectFailure(await execute([[INSERT_LEDGER, [randomUUID(), archived, survivor]]]), "55000", "vehicle_merges_both_active");
        await asService();
        await merge(survivor, duplicate);
        const third = await vehicle();
        expectFailure(await execute([[INSERT_LEDGER, [randomUUID(), duplicate, third]]]), "55000", "vehicle_merges_both_active");
        expectFailure(await execute([[INSERT_LEDGER, [randomUUID(), third, duplicate]]]), "55000", "vehicle_merges_both_active");
        assert.equal(await ledgerCount([third, archived]), 0);
      });

      scenario(`${mode}: self-merge, an invalid reason and an invalid status are rejected`, async () => {
        const [a, b] = await vehicleList(2);
        // the insert guard runs before the CHECK constraints and counts the distinct vehicles it finds, so a self-merge is reported by it
        expectFailure(await execute([[INSERT_LEDGER, [randomUUID(), a, a]]]), "55000", "vehicle_merges_both_active");
        expectFailure(await execute([[`INSERT INTO public.vehicle_merges (source_vehicle_id, target_vehicle_id, merge_reason) VALUES ($1, $2, 'OTHER')`, [a, b]]]), "23514", "vehicle_merges_reason_valid");
        expectFailure(await execute([[FLIP_MERGED, [a, a]]]), "23514");
        assert.equal(await ledgerCount([a, b]), 0);
      });

      scenario(`${mode}: a vehicle can be merged away once at a time (unique active source)`, async () => {
        const [target, other, source] = await vehicleList(3);
        expectFailure(
          await execute([[INSERT_LEDGER, [randomUUID(), source, target]], [INSERT_LEDGER, [randomUUID(), source, other]]]),
          "23505",
          "vehicle_merges_active_source_uq",
        );
        assert.equal(await ledgerCount([source]), 0);
      });

      scenario(`${mode}: a merge cycle is rejected`, async () => {
        const [a, b] = await vehicleList(2);
        const outcome = await execute([[INSERT_LEDGER, [randomUUID(), a, b]], [FLIP_MERGED, [a, b]], [INSERT_LEDGER, [randomUUID(), b, a]], [FLIP_MERGED, [b, a]]]);
        assert.ok(outcome.error, "rejected");
        assert.ok(["23514", "55000"].includes(outcome.error.code ?? ""), String(outcome.error.code));
        assert.equal(await ledgerCount([a, b]), 0);
        const chainOutcome = await execute([
          [INSERT_LEDGER, [randomUUID(), a, b]], [FLIP_MERGED, [a, b]],
          [`UPDATE public.vehicles SET record_status = 'merged', merged_into_vehicle_id = $2 WHERE id = $1`, [b, a]],
        ]);
        expectFailure(chainOutcome, "23514", undefined, /cycle/i);
        assert.equal(await ledgerCount([a, b]), 0);
      });

      scenario(`${mode}: a merge cannot be reversed while its survivor is merged away`, async () => {
        const [a, b, c] = await vehicleList(3);
        await asService();
        const ab = await merge(b, a);
        await merge(c, b);
        const snapshot = await stateOf([a, b, c]);
        expectFailure(await execute([[REVERSE_LEDGER, [ab.merge.id]], [FLIP_ACTIVE, [a]]]), "55000", "vehicle_merges_survivor_not_merged");
        assert.equal(await stateOf([a, b, c]), snapshot);
      });

      scenario(`${mode}: the reversal bookkeeping is checked (reversed needs reversed_at, not before the merge; active forbids it)`, async () => {
        const [survivor, duplicate] = await vehicleList(2);
        await asService();
        const done = await merge(survivor, duplicate);
        expectFailure(await execute([[`UPDATE public.vehicle_merges SET record_status = 'reversed' WHERE id = $1`, [done.merge.id]]]), "23514", "vehicle_merges_reversal_state_consistent");
        expectFailure(await execute([[`UPDATE public.vehicle_merges SET record_status = 'reversed', reversed_at = merged_at - interval '1 second' WHERE id = $1`, [done.merge.id]]]), "23514", "vehicle_merges_reversal_state_consistent");
        expectFailure(await execute([[`UPDATE public.vehicle_merges SET reversed_at = now() WHERE id = $1`, [done.merge.id]]]), "23514", "vehicle_merges_reversal_state_consistent");
        expectFailure(await execute([[`UPDATE public.vehicle_merges SET record_status = 'undone' WHERE id = $1`, [done.merge.id]]]), "23514", "vehicle_merges_record_status_valid");
        assert.equal((await ledgerRows(duplicate))[0].record_status, "active");
      });

      scenario(`${mode}: a taken VIN namespace rejects a raw reversal (unique violation on the VIN index)`, async () => {
        const [survivor, duplicate] = await vehicleList(2);
        await asService();
        const done = await merge(survivor, duplicate);
        await vehicle({ vin: (await vehicleRow(duplicate)).vin_normalized });
        const snapshot = await stateOf([survivor, duplicate]);
        expectFailure(await execute([[REVERSE_LEDGER, [done.merge.id]], [FLIP_ACTIVE, [duplicate]]]), "23505", "vehicles_vin_current_uq");
        assert.equal(await stateOf([survivor, duplicate]), snapshot);
      });

      scenario(`${mode}: ledger rows cannot be deleted or truncated`, async () => {
        const [survivor, duplicate] = await vehicleList(2);
        await asService();
        const done = await merge(survivor, duplicate);
        const expected = mode === "owner" ? { code: "55000" } : { code: "42501" };
        for (const sql of [`DELETE FROM public.vehicle_merges WHERE id = '${done.merge.id}'`, "DELETE FROM public.vehicle_merges", "TRUNCATE public.vehicle_merges"]) {
          const outcome = await execute([[sql]]);
          assert.equal(outcome.error?.code, expected.code, sql);
        }
        assert.equal(await ledgerCount([survivor, duplicate]), 1);
      });
    }

    scenario("owner: reversed rows are frozen, and the content of an active row cannot be edited, re-pointed or re-dated", async () => {
      await fullStaff();
      const [survivor, duplicate, other] = await vehicleList(3);
      const active = await merge(survivor, duplicate);
      const [x, y] = await vehicleList(2);
      const ended = await merge(x, y);
      await reverse(ended.merge.id);

      const frozen = [
        `UPDATE public.vehicle_merges SET record_status = 'active', reversed_at = NULL WHERE id = $1`,
        `UPDATE public.vehicle_merges SET target_vehicle_id = '${other}' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET source_vehicle_id = '${other}' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET merge_reason = 'RESOLUTION_REVIEW' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET merged_at = merged_at - interval '1 day' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET reversed_at = reversed_at + interval '1 day' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET created_at = created_at - interval '1 day' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET id = gen_random_uuid() WHERE id = $1`,
        `UPDATE public.vehicle_merges SET updated_at = now() WHERE id = $1`,
      ];
      const snapshot = await stateOf([x, y]);
      for (const sql of frozen) {
        const outcome = await ownerTransaction([[sql, [ended.merge.id]]]);
        assert.equal(outcome.error?.code, "55000", sql);
        assert.match(outcome.error?.message ?? "", /frozen/, sql);
      }
      assert.equal(await stateOf([x, y]), snapshot, "the reversed row is exactly as it was");

      const immutable = [
        `UPDATE public.vehicle_merges SET target_vehicle_id = '${other}' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET source_vehicle_id = '${other}' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET merge_reason = 'RESOLUTION_REVIEW' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET merged_at = merged_at - interval '1 day' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET created_at = created_at - interval '1 day' WHERE id = $1`,
        `UPDATE public.vehicle_merges SET id = gen_random_uuid() WHERE id = $1`,
      ];
      const activeSnapshot = await stateOf([survivor, duplicate]);
      for (const sql of immutable) {
        const outcome = await ownerTransaction([[sql, [active.merge.id]]]);
        assert.equal(outcome.error?.code, "55000", sql);
        assert.match(outcome.error?.message ?? "", /immutable/, sql);
      }
      assert.equal(await stateOf([survivor, duplicate]), activeSnapshot, "an active row's content is exactly as it was");
      // the runtime role cannot even name those columns
      const actor = await staff("VEHICLE_MANAGE");
      for (const column of ["merge_reason", "source_vehicle_id", "target_vehicle_id", "merged_at", "created_at", "id"]) {
        const outcome = await runtimeTransaction(actor, "VEHICLE_MANAGE", [[`UPDATE public.vehicle_merges SET ${column} = ${column} WHERE id = $1`, [active.merge.id]]]);
        assert.equal(outcome.error?.code, "42501", column);
      }
    });
  });

  // =============================================================================================================
  describe("concurrency (real PostgreSQL, distinct authorized actors, 4 rounds each)", () => {
    const ROUNDS = 4;

    scenario("1. two merges of one vehicle at the same moment: exactly one wins, the other is a state error", async () => {
      const as = await concurrentActors(2);
      for (let round = 0; round < ROUNDS; round += 1) {
        const [duplicate, first, second] = await vehicleList(3);
        const { won, lost } = settled(await Promise.allSettled([as(0, () => merge(first, duplicate)), as(1, () => merge(second, duplicate))]));
        assert.equal(won.length, 1);
        assert.equal(lost.length, 1);
        assert.ok(lost[0] instanceof K.v.VehicleMergeStateError, String(lost[0]));
        assert.equal((await ledgerRows(duplicate)).length, 1);
        assert.equal((await vehicleRow(duplicate)).merged_into_vehicle_id, won[0].merge.survivorVehicleId);
        await assertConsistent([duplicate, first, second]);
      }
    });

    scenario("2. A into B against B into A: exactly one wins, never a cycle", async () => {
      const as = await concurrentActors(2);
      for (let round = 0; round < ROUNDS; round += 1) {
        const [a, b] = await vehicleList(2);
        const { won, lost } = settled(await Promise.allSettled([as(0, () => merge(b, a)), as(1, () => merge(a, b))]));
        assert.equal(won.length, 1);
        assert.equal(lost.length, 1);
        assert.ok(lost[0] instanceof K.v.VehicleMergeStateError, String(lost[0]));
        assert.equal(await rowCount(`SELECT count(*) FROM public.vehicle_merges WHERE source_vehicle_id = ANY($1::uuid[])`, [[a, b]]), 1);
        const resolved = await Promise.all([K.db.withClerkUser((await staff("VEHICLE_READ")).clerkSubject, () => K.v.resolveVehicle(a))]);
        assert.equal(resolved[0].hops <= 1, true);
        await assertConsistent([a, b]);
      }
    });

    scenario("3. two reversals of one merge: exactly one wins, the other is a state error", async () => {
      const as = await concurrentActors(2);
      for (let round = 0; round < ROUNDS; round += 1) {
        const [survivor, duplicate] = await vehicleList(2);
        const done = await as(0, () => merge(survivor, duplicate));
        const { won, lost } = settled(await Promise.allSettled([as(0, () => reverse(done.merge.id)), as(1, () => reverse(done.merge.id))]));
        assert.equal(won.length, 1);
        assert.equal(lost.length, 1);
        assert.ok(lost[0] instanceof K.v.VehicleMergeStateError, String(lost[0]));
        assert.equal((await ledgerRows(duplicate))[0].record_status, "reversed");
        await assertConsistent([survivor, duplicate]);
      }
    });

    scenario("4. reversal against a merge of the survivor: the merge always succeeds, the reversal only if it came first", async () => {
      const as = await concurrentActors(2);
      let reversalWon = 0;
      let reversalRefused = 0;
      for (let round = 0; round < ROUNDS; round += 1) {
        const [a, b, c] = await vehicleList(3);
        const ab = await as(0, () => merge(b, a));
        const results = await Promise.allSettled([as(0, () => reverse(ab.merge.id)), as(1, () => merge(c, b))]);
        assert.equal(results[1].status, "fulfilled", "merging the survivor never fails");
        if (results[0].status === "fulfilled") {
          reversalWon += 1;
          assert.equal((await vehicleRow(a)).record_status, "active");
        } else {
          reversalRefused += 1;
          assert.ok(results[0].reason instanceof K.v.VehicleMergeStateError, String(results[0].reason));
          assert.equal((await vehicleRow(a)).record_status, "merged", "refused: A is still merged into B");
        }
        assert.equal((await vehicleRow(b)).merged_into_vehicle_id, c);
        await assertConsistent([a, b, c]);
      }
      assert.equal(reversalWon + reversalRefused, ROUNDS);
    });

    scenario("5. reversal against an archive of the merged vehicle or of the survivor: the reversal always succeeds, the database arbitrates the archive", async () => {
      const as = await concurrentActors(1);
      const archiver = await staff("VEHICLE_MANAGE");
      const archive = (id: string, delayMs: number, holdMs: number) =>
        sleep(delayMs).then(() =>
          runtimeTransaction(archiver, "VEHICLE_MANAGE", [
            [`UPDATE public.vehicles SET record_status = 'archived', merged_into_vehicle_id = NULL, archived_at = now(), updated_at = now() WHERE id = $1`, [id]],
            () => sleep(holdMs),
          ]),
        );
      for (let round = 0; round < ROUNDS; round += 1) {
        const [survivor, duplicate] = await vehicleList(2);
        const done = await as(0, () => merge(survivor, duplicate));
        const [reversal, archived] = await Promise.all([as(0, () => reverse(done.merge.id)), archive(duplicate, round * 10, 60)]);
        assert.equal(reversal.merge.status, "reversed");
        const row = await vehicleRow(duplicate);
        if (archived.error) {
          assert.equal(archived.error.code, "23514", "archiving a merged vehicle is rejected at commit: it still has an active merge record");
          assert.equal(row.record_status, "active");
        } else {
          assert.equal(row.record_status, "archived", "the archive came after the reversal");
        }
        await assertConsistent([survivor, duplicate]);
      }
      for (let round = 0; round < ROUNDS; round += 1) {
        const [survivor, duplicate] = await vehicleList(2);
        const done = await as(0, () => merge(survivor, duplicate));
        const [reversal, archived] = await Promise.all([as(0, () => reverse(done.merge.id)), archive(survivor, round * 10, 30)]);
        assert.equal(reversal.merge.status, "reversed", "an archived survivor does not block the reversal");
        assert.equal(archived.error, undefined);
        assert.equal((await vehicleRow(survivor)).record_status, "archived");
        assert.equal((await vehicleRow(duplicate)).record_status, "active");
        await assertConsistent([survivor, duplicate]);
      }
    });

    scenario("6. opposite lock orders across several vehicles never surface a raw deadlock", async () => {
      const as = await concurrentActors(4);
      for (let round = 0; round < ROUNDS; round += 1) {
        const [a, b, c, d] = await vehicleList(4);
        const results = await Promise.allSettled([as(0, () => merge(a, b)), as(1, () => merge(b, a)), as(2, () => merge(c, d)), as(3, () => merge(d, c))]);
        for (const result of results) {
          if (result.status === "rejected") assert.ok(result.reason instanceof K.v.VehicleMergeStateError || result.reason instanceof K.v.VehicleMergeConflictError, String(result.reason));
        }
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 2, "exactly one of each opposite pair wins");
        await assertConsistent([a, b, c, d]);
      }
    });
  });

  // =============================================================================================================
  describe("Master Register (same transaction, references and vocabulary only)", () => {
    scenario("every mutation records its events with references and controlled words; reads and refusals record nothing; no identifier, unit number or date reaches the register", async () => {
      const actor = await fullStaff();
      const [survivor, duplicate, third] = await vehicleList(3);
      const organizationId = await organization();
      const unit = `SECRETUNIT-${run}`;
      await relationship(organizationId, duplicate, unit);
      const vins = await Promise.all([survivor, duplicate, third].map(async (id) => (await vehicleRow(id)).vin_normalized as string));

      const done = await merge(survivor, duplicate, "IDENTIFIER_CORRECTION");
      await reverse(done.merge.id);
      const again = await merge(survivor, duplicate, "RESOLUTION_REVIEW");
      await merge(third, survivor);
      await K.v.resolveVehicle(duplicate);
      await K.v.listVehicleMerges(survivor);
      await stateError(reverse(again.merge.id));
      await invalid(K.v.mergeVehicles({}));

      const events = (await pools.admin.query<{
        event_type: string;
        target: { resourceType: string; resourceId: string; subjectReferences: string[] };
        change_set: { changedFields: string[]; fieldChanges: Array<{ field: string; before?: { kind: string; value?: unknown; reference?: string }; after?: { kind: string; value?: unknown; reference?: string } }> };
      }>(`SELECT event_type, target, change_set FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`, [actor.actorId])).rows;
      assert.equal(events.length, 8, "four accepted mutations, two events each; nothing for the reads or the refusals");
      assert.deepEqual(events.map((e) => e.event_type).sort(), [
        "RECORD_CREATED", "RECORD_CREATED", "RECORD_CREATED", "RECORD_STATUS_CHANGED", "RECORD_STATUS_CHANGED", "RECORD_STATUS_CHANGED", "RECORD_STATUS_CHANGED", "RECORD_UPDATED",
      ]);
      const literals = new Set(["DUPLICATE_RECORD", "IDENTIFIER_CORRECTION", "RESOLUTION_REVIEW", "active", "merged", "reversed", null]);
      for (const event of events) {
        assert.ok(["vehicles", "vehicle_merges"].includes(event.target.resourceType), event.target.resourceType);
        assert.match(event.target.resourceId, UUID);
        assert.equal(event.target.subjectReferences.length, 2);
        for (const subject of event.target.subjectReferences) assert.match(subject, /^vehicle:[0-9a-f-]{36}$/);
        assert.deepEqual(event.change_set.changedFields, event.change_set.fieldChanges.map((change) => change.field));
        for (const change of event.change_set.fieldChanges) {
          for (const side of [change.before, change.after]) {
            if (!side) continue;
            if (side.kind === "REFERENCE") assert.match(side.reference as string, /^(vehicles|vehicle_merges):[0-9a-f-]{36}$/);
            else {
              assert.equal(side.kind, "LITERAL");
              assert.ok(literals.has(side.value as string | null), `literal ${String(side.value)} is not controlled vocabulary`);
            }
          }
        }
      }
      const content = await eventContent(actor.actorId);
      for (const secret of [...vins, unit, unit.toLowerCase(), "Testmake", "VM Org"]) assert.equal(content.includes(secret), false, `${secret} must not reach the Master Register`);
      assert.doesNotMatch(content, /\d{4}-\d{2}-\d{2}/, "no dates reach the register");
      assert.doesNotMatch(content, /vin|plate|unit_number|legal_name/i);
    });

    scenario("a Master Register failure rolls the whole mutation back, whichever event fails", async () => {
      const actor = await fullStaff();
      const [survivor, duplicate, a, b] = await vehicleList(4);
      const done = await merge(b, a);
      const ids = [survivor, duplicate, a, b];
      const before = await stateOf(ids);
      const events = (await eventTypes(actor.actorId)).length;

      const cases: Array<[string, string, () => Promise<unknown>]> = [
        ["RECORD_CREATED", "mergeVehicles (first event)", () => merge(survivor, duplicate)],
        ["RECORD_STATUS_CHANGED", "mergeVehicles (second event, after the first was written)", () => merge(survivor, duplicate)],
        ["RECORD_UPDATED", "reverseVehicleMerge (first event)", () => reverse(done.merge.id)],
        ["RECORD_STATUS_CHANGED", "reverseVehicleMerge (second event, after the first was written)", () => reverse(done.merge.id)],
      ];
      for (const [eventType, label, work] of cases) {
        await refuseMasterRegisterEvent(eventType);
        await assert.rejects(work(), /master register write refused/, label);
        await allowMasterRegister();
        assert.equal(await stateOf(ids), before, `${label}: the failed mutation left no trace in the vehicles or the ledger`);
        assert.equal((await eventTypes(actor.actorId)).length, events, `${label}: and no event`);
      }
      await assertConsistent(ids);
      // valid once the register accepts it
      assert.equal((await merge(survivor, duplicate)).merge.status, "active");
      assert.equal((await reverse(done.merge.id)).merge.status, "reversed");
    });
  });
});
