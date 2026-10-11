// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL Company Credentials service through the REAL authorization wrappers and Clerk-to-actor resolution,
// on pooled connections that log in as the RUNTIME role, against a database with migrations 0001-0018 applied.

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
    c: await import("@/lib/company-credentials/service"),
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
const TABLES = [
  "credential_categories", "credential_systems", "credential_system_aliases", "company_credentials", "credential_status_periods", "credential_verifications", "credential_secret_slots",
] as const;
const BUSINESS_TABLES = TABLES.filter((table) => table !== "credential_categories");
type Capability = "CREDENTIAL_READ" | "CREDENTIAL_MANAGE";
const BOTH: Capability[] = ["CREDENTIAL_READ", "CREDENTIAL_MANAGE"];
const READS = ["listSystems", "getSystem", "getOrganizationCredentials"] as const;
const MUTATIONS = [
  "createSystem", "updateSystem", "addAlias", "retireAlias", "archiveSystem", "restoreSystem", "createCredential", "replaceCredential", "updateCredentialMetadata",
  "archiveCredential", "restoreCredential", "changeCredentialStatus", "correctCredentialStatus", "recordVerification", "voidVerification", "addSecretSlot",
  "attachSecretReference", "retireSecretSlot",
] as const;

describe("Company Credentials (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
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
  const n = () => ++counter;
  /** A unique, already-normalized token: every name this run creates starts with it (so the purge can find them). */
  const token = () => `tcx${run}${n()}`;

  /** Removes everything this scenario created. The no-delete triggers are lifted only here, by the table owner. */
  async function purge() {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const table of BUSINESS_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${table}_no_delete`);
      const credentials = `SELECT id FROM public.company_credentials WHERE organization_id = ANY($1::uuid[])`;
      const systems = `SELECT id FROM public.credential_systems WHERE display_name_normalized LIKE 'tcx${run}%'`;
      await client.query(`DELETE FROM public.credential_secret_slots WHERE credential_id IN (${credentials})`, [organizations]);
      await client.query(`DELETE FROM public.credential_verifications WHERE credential_id IN (${credentials})`, [organizations]);
      await client.query(`DELETE FROM public.credential_status_periods WHERE credential_id IN (${credentials})`, [organizations]);
      // replacement chains: delete leaves first
      for (let i = 0; i < 12; i += 1) {
        const result = await client.query(
          `DELETE FROM public.company_credentials c WHERE c.organization_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM public.company_credentials r WHERE r.replaces_credential_id = c.id)`,
          [organizations],
        );
        if (result.rowCount === 0) break;
      }
      await client.query(`DELETE FROM public.credential_system_aliases WHERE system_id IN (${systems})`);
      await client.query(`DELETE FROM public.credential_systems WHERE id IN (${systems})`);
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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `CC ${label} ${id.slice(0, 8)} ${n()}`]);
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
    const actor = await staff(...BOTH);
    signIn(actor);
    return actor;
  }
  async function concurrentActors(count: number) {
    const actors = await Promise.all(Array.from({ length: count }, () => staff(...BOTH)));
    return <T>(index: number, work: () => Promise<T>) => K.db.withClerkUser(actors[index].clerkSubject, work);
  }

  const MONTH = (m: number) => `2020-${String(m).padStart(2, "0")}-01T00:00:00Z`;
  const MICRO = (m: number) => `2020-${String(m).padStart(2, "0")}-01T00:00:00.000000Z`;
  const FUTURE = "2999-01-01T00:00:00Z";

  const mkSystem = (over: Record<string, unknown> = {}) => K.c.createSystem({ name: `${token()} Portal`, ...over });
  const mkCred = (organizationId: string, systemId: string, username: string, over: Record<string, unknown> = {}) =>
    K.c.createCredential({ organizationId, systemId, category: "FLEET", username, effectiveFrom: MONTH(1), ...over });
  async function fixture(label = "Fx") {
    const o = await org(label);
    const system = await mkSystem();
    const view = await mkCred(o, system.id, `user.${token()}`);
    return { o, system, view, id: view.credential.id, passwordSlot: view.slots[0] };
  }

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      // a domain error never carries database detail
      assert.doesNotMatch((error as Error).message, /duplicate key|violates|constraint|credential_systems|company_credentials|credential_secret|public\.|SQLSTATE|relation "/i);
      return true;
    });
  const denied = (promise: Promise<unknown>) => rejectsWith(promise, K.authz.TesAuthorizationDeniedError);
  const invalid = (promise: Promise<unknown>) => rejectsWith(promise, K.c.CompanyCredentialValidationError);
  const notFound = (promise: Promise<unknown>) => rejectsWith(promise, K.c.CompanyCredentialNotFoundError);
  const stateError = (promise: Promise<unknown>) => rejectsWith(promise, K.c.CompanyCredentialStateError);
  const conflict = (promise: Promise<unknown>) => rejectsWith(promise, K.c.CompanyCredentialConflictError);
  const rowCount = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const priv = async (sql: string, params: unknown[]) => (await pools.admin.query<{ ok: boolean }>(sql, params)).rows[0].ok;

  // Events can share a recorded_at (same instant); break such ties by type so the order is deterministic.
  const events = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string; resource_type: string | null; resource_id: string | null; subjects: string[] | null }>(
      `SELECT event_type, target->>'resourceType' AS resource_type, target->>'resourceId' AS resource_id,
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(target->'subjectReferences', '[]'::jsonb))) AS subjects
         FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type, resource_type`,
      [actorId],
    )).rows;
  const eventTypes = async (actorId: string) => (await events(actorId)).map((row) => row.event_type);
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
    cleanups.push(allowMasterRegister);
  }
  async function allowMasterRegister() {
    await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
    await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_master_register()`);
  }

  /** Makes every INSERT into `table` fail, to force a failure in the MIDDLE of an operation. */
  async function failInsertsInto(table: string) {
    await pools.admin.query(`CREATE OR REPLACE FUNCTION public.tes_test_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test: insert refused'; END $$`);
    await pools.admin.query(`CREATE TRIGGER tes_test_fail_insert BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_insert()`);
    return async function allowInserts() {
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_insert ON public.${table}`);
      await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_insert()`);
    };
  }

  async function transactionAs(pool: "admin" | "runtime", statements: Array<[string, unknown[]?]>): Promise<{ error?: Error & { constraint?: string; code?: string } }> {
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
  const asOwner = (statements: Array<[string, unknown[]?]>) => transactionAs("admin", statements);
  const asRuntime = (statements: Array<[string, unknown[]?]>) => transactionAs("runtime", statements);

  // =============================================================================================================
  describe("schema (migration 0018)", () => {
    scenario("tables, category seeds, indexes, functions and triggers exist; the ledger records 0018", async () => {
      assert.deepEqual(
        (await pools.admin.query<{ n: string }>(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY 1`, [[...TABLES]])).rows.map((row) => row.n),
        [...TABLES].sort(),
      );
      assert.deepEqual(
        (await pools.admin.query<{ code: string }>(`SELECT code FROM public.credential_categories ORDER BY sort_order`)).rows.map((row) => row.code),
        ["FLEET", "COMPLIANCE", "REGISTRATION", "INSURANCE", "ACCOUNTING", "FUEL", "OTHER"],
      );
      for (const index of [
        "credential_systems_name_normalized_uq", "credential_system_aliases_active_uq", "company_credentials_active_account_uq", "credential_status_periods_current_uq", "credential_secret_slots_single_live_uq",
      ]) assert.equal(await rowCount(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [index]), 1, index);
      const ledger = await pools.admin.query<{ sha256: string }>(`SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0018'`);
      const sql = readFileSync(path.join(process.cwd(), "database/migrations/0018_company_credentials_foundation.sql"));
      assert.equal(ledger.rows[0]?.sha256, createHash("sha256").update(sql).digest("hex"));
    });

    scenario("the TypeScript vocabulary agrees with the catalogue and the closed CHECK lists (drift)", async () => {
      const defs = await import("@/lib/company-credentials/definitions");
      assert.deepEqual(
        (await pools.admin.query<{ code: string }>(`SELECT code FROM public.credential_categories ORDER BY sort_order`)).rows.map((row) => row.code),
        [...defs.CREDENTIAL_CATEGORIES],
      );
      const literals = async (constraint: string) => {
        const row = await pools.admin.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`, [constraint]);
        assert.equal(row.rows.length, 1, constraint);
        return [...row.rows[0].def.matchAll(/'([A-Z_]+)'::text/g)].map((match) => match[1]);
      };
      const same = (actual: string[], expected: readonly string[], label: string) => assert.deepEqual([...actual].sort(), [...expected].sort(), label);
      same(await literals("credential_status_periods_status_valid"), defs.CREDENTIAL_STATUSES, "statuses");
      same(await literals("company_credentials_mfa_method_valid"), defs.MFA_METHODS, "mfa methods");
      same(await literals("credential_secret_slots_kind_valid"), defs.SLOT_KINDS, "slot kinds");
      same(await literals("credential_secret_slots_state_valid"), defs.SECRET_STATES, "secret states");
      same(await literals("credential_secret_slots_store_valid"), defs.SECRET_STORES, "secret stores");
      same(await literals("credential_verifications_outcome_valid"), defs.VERIFICATION_OUTCOMES, "outcomes");
      same(await literals("credential_verifications_method_valid"), defs.VERIFICATION_METHODS, "methods");
      same(await literals("company_credentials_replacement_reason_valid"), defs.REPLACEMENT_REASONS, "replacement reasons");
      same(await literals("credential_status_periods_reason_valid"), defs.PERIOD_REASONS, "period reasons");
    });

    scenario("the reference and URL shapes in definitions.ts accept and refuse exactly what the database CHECKs do", async () => {
      const defs = await import("@/lib/company-credentials/definitions");
      const dbAccepts = async (column: "secret_reference" | "login_url", value: string): Promise<boolean> => {
        const sql = column === "secret_reference"
          ? `SELECT (length($1) <= 400 AND $1 ~ '^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/secrets/[A-Za-z0-9_-]{1,255}(/versions/([0-9]+|latest))?$') AS ok`
          : `SELECT (length($1) <= 500 AND $1 ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]?#]*)?$') AS ok`;
        return priv(sql, [value]);
      };
      for (const value of ["projects/tes-production-510007/secrets/abc", "projects/tes-production-510007/secrets/abc/versions/12", "projects/tes-production-510007/secrets/abc/versions/latest", "hunter2", "P@ssw0rd!", "https://x.example.com/a", "0123456789abcdef0123456789abcdef", "projects/tes-production-510007/secrets/abc\n"]) {
        assert.equal(defs.isSecretReference(value), await dbAccepts("secret_reference", value), value);
      }
      for (const value of ["https://x.example.com/login", "https://x.example.com:8443/a/b", "http://x.example.com", "https://u:p@x.example.com", "https://x.example.com/?q=1", "https://x.example.com/#f", "https://x.example.com/a b", "https://", "x"]) {
        assert.equal(defs.isLoginUrl(value), await dbAccepts("login_url", value), value);
      }
    });

    scenario("capabilities: exactly CREDENTIAL_READ and CREDENTIAL_MANAGE were added, SYSTEM only, and granted to nobody", async () => {
      const rows = (await pools.admin.query<{ code: string; description: string; sort_order: number; is_active: boolean }>(
        `SELECT code, description, sort_order, is_active FROM public.capabilities WHERE code LIKE 'CREDENTIAL\\_%' ORDER BY sort_order`,
      )).rows;
      assert.deepEqual(rows.map((row) => row.code), ["CREDENTIAL_READ", "CREDENTIAL_MANAGE"]);
      assert.deepEqual(rows.map((row) => row.sort_order), [150, 160]);
      for (const row of rows) {
        assert.match(row.description, /Intended scope: SYSTEM only\.$/);
        assert.equal(row.is_active, true);
        assert.doesNotMatch(row.description, /reveal|view password|show password/i);
      }
      assert.match(rows[0].description, /Never returns a secret/);
      assert.match(rows[1].description, /Never handles secret values/);
      assert.equal(await rowCount(`SELECT count(*) FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id WHERE c.code LIKE 'CREDENTIAL\\_%'`), 0, "the migration granted nothing");
      const { TES_CAPABILITY_SCOPES } = await import("@/lib/auth/tes-capabilities");
      assert.equal(TES_CAPABILITY_SCOPES.CREDENTIAL_READ, "SYSTEM");
      assert.equal(TES_CAPABILITY_SCOPES.CREDENTIAL_MANAGE, "SYSTEM");
    });

    scenario("no SECURITY DEFINER, no RLS, no policy on the new tables; every new function is invoker with a fixed search_path and no PUBLIC execute", async () => {
      const names = [
        "prevent_credential_data_removal", "guard_credential_system_name", "guard_credential_alias", "guard_company_credential_insert", "guard_company_credential_update",
        "guard_credential_status_period_insert", "guard_credential_status_period_update", "require_credential_current_state", "guard_credential_verification_insert",
        "guard_credential_verification_update", "guard_credential_secret_slot_insert", "guard_credential_secret_slot_update",
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
      for (const table of TABLES) assert.equal((await pools.admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${table}`])).rows[0].relrowsecurity, false, table);
      assert.equal(await rowCount(`SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])`, [[...TABLES]]), 0);
    });

    scenario("runtime privileges: SELECT, column-specific INSERT/UPDATE, no DELETE, TRUNCATE, REFERENCES or TRIGGER, nothing for PUBLIC; the catalogue is read-only", async () => {
      for (const table of TABLES) {
        for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          assert.equal(await priv(`SELECT has_table_privilege($1, $2::regclass, $3) AS ok`, [RUNTIME_ROLE, `public.${table}`, privilege]), false, `${table} ${privilege}`);
        }
        assert.equal(await priv(`SELECT has_table_privilege($1, $2::regclass, 'SELECT') AS ok`, [RUNTIME_ROLE, `public.${table}`]), true, table);
        assert.equal(await rowCount(`SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'PUBLIC'`, [table]), 0, `PUBLIC on ${table}`);
        await assert.rejects(pools.runtime.query(`DELETE FROM public.${table}`), /permission denied/, table);
        await assert.rejects(pools.runtime.query(`TRUNCATE public.${table}`), /permission denied/, table);
      }
      for (const privilege of ["INSERT", "UPDATE"]) assert.equal(await priv(`SELECT has_table_privilege($1, 'public.credential_categories', $2) AS ok`, [RUNTIME_ROLE, privilege]), false, `categories ${privilege}`);
      const column = (table: string, name: string, privilege: "INSERT" | "UPDATE") => priv(`SELECT has_column_privilege($1, $2::regclass, $3, $4) AS ok`, [RUNTIME_ROLE, `public.${table}`, name, privilege]);
      // identity / content columns are never updatable
      for (const [table, columns] of Object.entries({
        company_credentials: ["id", "organization_id", "system_id", "username_display", "username_normalized", "replaces_credential_id", "replacement_reason", "created_at"],
        credential_secret_slots: ["id", "credential_id", "organization_id", "slot_kind", "created_at"],
        credential_system_aliases: ["id", "system_id", "alias_display", "alias_normalized", "created_at"],
        credential_systems: ["id", "created_at"],
        credential_status_periods: ["id", "credential_id", "credential_status", "period_reason", "effective_from", "created_at"],
        credential_verifications: ["id", "credential_id", "organization_id", "outcome", "method", "verified_at", "recorded_by_actor_id", "created_at"],
      })) {
        for (const name of columns) assert.equal(await column(table, name, "UPDATE"), false, `${table}.${name} must not be updatable`);
      }
      for (const [table, columns] of Object.entries({
        company_credentials: ["category", "mfa_method", "record_status", "archived_at"],
        credential_secret_slots: ["secret_state", "secret_store", "secret_reference", "stored_at", "retired_at"],
        credential_system_aliases: ["record_status", "retired_at"],
        credential_systems: ["display_name", "display_name_normalized", "login_url", "record_status"],
        credential_status_periods: ["effective_to", "record_status", "corrected_at", "superseded_by_period_id"],
        credential_verifications: ["record_status", "voided_at"],
      })) {
        for (const name of columns) assert.equal(await column(table, name, "UPDATE"), true, `${table}.${name}`);
      }
      // ... and the columns only the service may set at insert are the only insertable ones
      assert.equal(await column("credential_status_periods", "effective_to", "INSERT"), false, "a status period is inserted open");
      assert.equal(await column("credential_secret_slots", "secret_reference", "INSERT"), false, "a slot is inserted UNRESOLVED");
      assert.equal(await column("credential_secret_slots", "secret_state", "INSERT"), false);
      assert.equal(await column("credential_verifications", "record_status", "INSERT"), false);
      assert.equal(await column("company_credentials", "record_status", "INSERT"), false);
    });

    scenario("no column of the new tables can hold a secret value; the slot table has exactly the expected columns", async () => {
      const columns = (await pools.admin.query<{ table_name: string; column_name: string; data_type: string }>(
        `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [[...TABLES]],
      )).rows;
      for (const col of columns) {
        assert.doesNotMatch(col.column_name, /password|passwd|secret_value|plaintext|token|api_?key|seed|pin_value|answer|ciphertext|encrypted|private_key|backup_code/i, `${col.table_name}.${col.column_name}`);
        assert.notEqual(col.data_type, "bytea", `${col.table_name}.${col.column_name}`);
      }
      assert.deepEqual(
        columns.filter((col) => col.table_name === "credential_secret_slots").map((col) => col.column_name).sort(),
        ["created_at", "credential_id", "id", "organization_id", "retired_at", "secret_reference", "secret_state", "secret_store", "slot_kind", "stored_at", "updated_at"],
      );
      // the only free-form text column that could hold a secret is secret_reference, and a CHECK pins it to a resource name
      const check = (await pools.admin.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'credential_secret_slots_reference_shape'`)).rows[0].def;
      assert.match(check, /projects\//);
    });
  });

  // =============================================================================================================
  describe("corrected status periods are frozen (owner level)", () => {
    scenario("a corrected credential status period cannot be re-pointed or re-dated", async () => {
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        const [orgId, sysId, credId, p1, p2, p3] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        await client.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, 'Frozen', 'frozen')`, [orgId]);
        await client.query(`INSERT INTO public.credential_systems (id, display_name, display_name_normalized) VALUES ($1, 'Frozen Sys', 'frozen sys ' || $2)`, [sysId, sysId.slice(0, 8).replace(/-/g, "")]);
        await client.query(`INSERT INTO public.company_credentials (id, organization_id, system_id, category, username_display, username_normalized) VALUES ($1, $2, $3, 'FLEET', 'u', 'u')`, [credId, orgId, sysId]);
        const period = `INSERT INTO public.credential_status_periods (id, credential_id, credential_status, period_reason, effective_from, record_status, corrected_at, superseded_by_period_id) VALUES ($1, $2, 'ACTIVE', $3, now(), $4, $5, $6)`;
        await client.query(period, [p1, credId, "INITIAL", "corrected", new Date(), p2]);
        await client.query(period, [p2, credId, "CORRECTION", "corrected", new Date(), p3]);
        await client.query(period, [p3, credId, "CORRECTION", "active", null, null]);
        await client.query("SAVEPOINT s");
        await assert.rejects(client.query(`UPDATE public.credential_status_periods SET superseded_by_period_id = $2 WHERE id = $1`, [p1, p3]), /corrected credential status period is frozen/);
        await client.query("ROLLBACK TO SAVEPOINT s");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
  });

  describe("secret hygiene", () => {
    scenario("the secret_reference CHECK rejects anything that is not a resource name, as the runtime role and as the owner", async () => {
      await fullStaff();
      const { passwordSlot } = await fixture();
      const bad = ["hunter2", "P@ssw0rd!", "https://portal.example.com/login?token=abc", "0123456789abcdef0123456789abcdef", "correct horse battery staple", "projects/x/secrets/y", "secrets/abc", `projects/tes-production-510007/secrets/${"a".repeat(300)}`];
      for (const value of bad) {
        for (const who of [asRuntime, asOwner]) {
          const outcome = await who([[`UPDATE public.credential_secret_slots SET secret_state = 'STORED', secret_store = 'GCP_SECRET_MANAGER', secret_reference = $2, stored_at = now() WHERE id = $1`, [passwordSlot.id, value]]]);
          assert.ok(outcome.error, value);
          assert.equal(outcome.error!.constraint, "credential_secret_slots_reference_shape", value);
        }
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_secret_slots WHERE id = $1 AND secret_state = 'UNRESOLVED' AND secret_reference IS NULL`, [passwordSlot.id]), 1);
      // a store without a reference, a reference without a store and an inconsistent state are all refused
      for (const [sql, label] of [
        [`UPDATE public.credential_secret_slots SET secret_store = 'GCP_SECRET_MANAGER' WHERE id = $1`, "store only"],
        [`UPDATE public.credential_secret_slots SET secret_reference = 'projects/tes-production-510007/secrets/abc' WHERE id = $1`, "reference only"],
        [`UPDATE public.credential_secret_slots SET secret_state = 'STORED' WHERE id = $1`, "STORED without a reference"],
        [`UPDATE public.credential_secret_slots SET secret_store = 'AWS', secret_reference = 'projects/tes-production-510007/secrets/abc' WHERE id = $1`, "another store"],
      ] as Array<[string, string]>) {
        const outcome = await asRuntime([[sql, [passwordSlot.id]]]);
        assert.ok(outcome.error, label);
        assert.ok(outcome.error!.constraint, `${label}: a named constraint rejected it`);
      }
      // a genuine resource name is accepted
      const ok = await asRuntime([[`UPDATE public.credential_secret_slots SET secret_state = 'STORED', secret_store = 'GCP_SECRET_MANAGER', secret_reference = 'projects/tes-production-510007/secrets/abc', stored_at = now() WHERE id = $1`, [passwordSlot.id]]]);
      assert.equal(ok.error, undefined);
    });

    scenario("the service refuses extra keys and malformed references without echoing them, and changes nothing", async () => {
      await fullStaff();
      const { passwordSlot, o, id } = await fixture();
      const reference = "projects/tes-production-510007/secrets/ok-1";
      for (const key of ["value", "password", "secret", "secretValue", "plaintext", "token", "apiKey", "passphrase"]) {
        await invalid(K.c.attachSecretReference({ slotId: passwordSlot.id, secretReference: reference, [key]: "hunter2" }));
        await invalid(K.c.attachSecretReference({ slotId: passwordSlot.id, [key]: "hunter2" }));
      }
      for (const value of ["hunter2", "P@ssw0rd!", "https://portal.example.com/login", "0123456789abcdef0123456789abcdef", "", 5, null, undefined, { a: 1 }, ["projects/tes-production-510007/secrets/x"]]) {
        const error = await K.c.attachSecretReference({ slotId: passwordSlot.id, secretReference: value }).then(() => null, (e: unknown) => e);
        assert.ok(error instanceof K.c.CompanyCredentialValidationError, String(value));
        if (typeof value === "string" && value.length > 3) assert.equal((error as Error).message.includes(value), false, "the submitted value is never echoed");
      }
      await invalid(K.c.attachSecretReference({ slotId: passwordSlot.id, secretReference: reference, secretStore: "AWS_SECRETS" }));
      // a "password" key is also refused by every other mutation that takes an object
      await invalid(K.c.createCredential({ organizationId: o, systemId: (await mkSystem()).id, category: "FLEET", username: "u", password: "hunter2" }));
      await invalid(K.c.replaceCredential({ credentialId: id, username: "other", reason: "USERNAME_CHANGED", password: "hunter2" }));
      await invalid(K.c.addSecretSlot({ credentialId: id, slotKind: "PASSWORD", value: "hunter2" }));
      await invalid(K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN", password: "hunter2" }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_secret_slots WHERE credential_id = $1 AND secret_state = 'UNRESOLVED'`, [id]), 1);
    });

    scenario("nothing the service returns contains a secret reference, store or value; slot results carry state only", async () => {
      await fullStaff();
      const { o, id, passwordSlot } = await fixture();
      const reference = `projects/hygiene-project-123/secrets/hyg-secret-${run}`;
      const attached = await K.c.attachSecretReference({ slotId: passwordSlot.id, secretReference: reference });
      const mfa = await K.c.addSecretSlot({ credentialId: id, slotKind: "MFA_SECRET" });
      const results = [attached, mfa, await K.c.getOrganizationCredentials(o), await K.c.getOrganizationCredentials(o, { asOf: MONTH(6) }), await K.c.retireSecretSlot({ slotId: passwordSlot.id })];
      for (const result of results) {
        const json = JSON.stringify(result);
        assert.equal(json.includes(reference), false, "no reference");
        assert.equal(json.includes("hyg-secret"), false);
        assert.doesNotMatch(json, /secret_reference|secretReference|secret_store|secretStore|GCP_SECRET_MANAGER|password"|"value"/);
      }
      const slot = attached.slots.find((row) => row.id === passwordSlot.id)!;
      assert.deepEqual(Object.keys(slot).sort(), ["credentialId", "id", "retiredAt", "secretState", "slotKind", "storedAt"]);
      assert.equal(slot.secretState, "STORED");
      assert.ok(slot.storedAt);
      // the reference is in the database (that is its job) and survives retirement for audit
      assert.equal((await pools.admin.query(`SELECT secret_reference, secret_store, secret_state FROM public.credential_secret_slots WHERE id = $1`, [passwordSlot.id])).rows[0].secret_reference, reference);
    });
  });

  // =============================================================================================================
  describe("system registry", () => {
    scenario("creates a system with aliases, provider, jurisdiction and login page; reads return it", async () => {
      const actor = await fullStaff();
      const provider = await org("Provider");
      const t = token();
      const view = await K.c.createSystem({ name: `${t} ATIOS Alberta`, aliases: [`${t} ATIOS`, `${t} IRP Alberta`], providerOrganizationId: provider, jurisdictionCountry: "ca", jurisdictionRegion: "ab", loginUrl: "https://atios.example.com/login" });
      assert.equal(view.displayName, `${t} ATIOS Alberta`);
      assert.equal(view.providerOrganizationId, provider);
      assert.equal(view.jurisdictionCountry, "CA");
      assert.equal(view.jurisdictionRegion, "AB");
      assert.equal(view.loginUrl, "https://atios.example.com/login");
      assert.equal(view.recordStatus, "active");
      assert.deepEqual(view.aliases.map((alias) => alias.alias).sort(), [`${t} ATIOS`, `${t} IRP Alberta`]);
      assert.ok(view.aliases.every((alias) => alias.recordStatus === "active" && alias.systemId === view.id));
      assert.deepEqual((await K.c.getSystem(view.id)).aliases.length, 2);
      assert.ok((await K.c.listSystems()).some((row) => row.id === view.id));
      assert.equal((await pools.admin.query(`SELECT display_name_normalized AS n FROM public.credential_systems WHERE id = $1`, [view.id])).rows[0].n, `${t} atios alberta`);
      const bare = await mkSystem();
      assert.equal(bare.providerOrganizationId, null);
      assert.equal(bare.loginUrl, null);
      assert.deepEqual(bare.aliases, []);
      const recorded = await events(actor.actorId);
      assert.deepEqual(recorded.map((row) => row.event_type), ["RECORD_CREATED", "RECORD_CREATED", "RECORD_CREATED", "RECORD_CREATED"]);
      assert.deepEqual(recorded.map((row) => row.resource_type).sort(), ["credential_system", "credential_system", "credential_system_alias", "credential_system_alias"]);
      for (const row of recorded) assert.deepEqual(row.subjects, [], "systems belong to no Organization");
    });

    scenario("system names are globally unambiguous: spelling, punctuation, case and accents are one name; ATIOS and TRACS are distinct", async () => {
      await fullStaff();
      const t = token();
      const first = await K.c.createSystem({ name: `${t} ATIOS Alberta`, aliases: [`${t} Alias One`] });
      for (const variant of [`${t}-ATIOS-Alberta`, `${t}   atios   alberta`, `${t} Átios Alberta`, `${t.toUpperCase()} Atios, Alberta!`, `${t}_atios_alberta`]) {
        await conflict(K.c.createSystem({ name: variant }));
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_systems WHERE display_name_normalized LIKE $1`, [`${t} atios%`]), 1);
      const tracs = await K.c.createSystem({ name: `${t} TRACS Alberta` });
      assert.notEqual(tracs.id, first.id);
      // a name versus an existing ACTIVE alias of another system
      await conflict(K.c.createSystem({ name: `${t}-alias-one` }));
      // alias versus another system's name, alias versus another system's alias, and the same alias twice on one system
      await conflict(K.c.addAlias({ systemId: tracs.id, alias: `${t} atios alberta` }));
      await conflict(K.c.addAlias({ systemId: tracs.id, alias: `${t} ALIAS ONE` }));
      await conflict(K.c.addAlias({ systemId: first.id, alias: `${t} alias-one` }));
      // an alias equal to the system's own name is meaningless
      await invalid(K.c.addAlias({ systemId: first.id, alias: `${t} ATIOS-Alberta!` }));
      // a new system whose alias collides is refused whole
      await conflict(K.c.createSystem({ name: `${t} Fresh`, aliases: [`${t} Alias One`] }));
      await conflict(K.c.createSystem({ name: `${t} Fresh`, aliases: [`${t} tracs alberta`] }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_systems WHERE display_name_normalized = $1`, [`${t} fresh`]), 0, "the refused system left no trace");
      // duplicate aliases inside one request, or an alias equal to the name
      await invalid(K.c.createSystem({ name: `${t} Dup`, aliases: [`${t} X`, `${t}-x`] }));
      await invalid(K.c.createSystem({ name: `${t} Dup`, aliases: [`${t}-dup`] }));
      // the same words on the same-named alias of a DIFFERENT system after it was added: allowed words, distinct systems
      const other = await mkSystem();
      await K.c.addAlias({ systemId: other.id, alias: `${t} Something Else` });
      // the registry keeps an archived system's name for ever
      await K.c.archiveSystem({ systemId: other.id });
      await conflict(K.c.createSystem({ name: other.displayName.toUpperCase() }));
    });

    scenario("renaming re-normalizes and must stay globally unique; retiring an alias frees its name", async () => {
      await fullStaff();
      const t = token();
      const a = await K.c.createSystem({ name: `${t} Alpha`, aliases: [`${t} Short`] });
      const b = await K.c.createSystem({ name: `${t} Beta` });
      await conflict(K.c.updateSystem({ systemId: b.id, name: `${t}-ALPHA` }));
      await conflict(K.c.updateSystem({ systemId: b.id, name: `${t} short` }));
      const renamed = await K.c.updateSystem({ systemId: b.id, name: `${t} Beta Prime` });
      assert.equal(renamed.displayName, `${t} Beta Prime`);
      assert.equal((await pools.admin.query(`SELECT display_name_normalized AS n FROM public.credential_systems WHERE id = $1`, [b.id])).rows[0].n, `${t} beta prime`);
      // punctuation-only rename keeps the same normalized name and is allowed
      assert.equal((await K.c.updateSystem({ systemId: b.id, name: `${t} Beta-Prime` })).displayName, `${t} Beta-Prime`);
      // the old name is now free (the registry holds names of existing systems, not of past spellings)
      const reused = await K.c.createSystem({ name: `${t} Beta` });
      assert.notEqual(reused.id, b.id);
      // a system can take the name of one of its OWN aliases
      assert.equal((await K.c.updateSystem({ systemId: a.id, name: `${t} Short` })).displayName, `${t} Short`);
      // retire an alias: its name is free for another system
      const aliasId = (await K.c.getSystem(a.id)).aliases[0].id;
      await K.c.retireAlias({ aliasId });
      await stateError(K.c.retireAlias({ aliasId }));
      const taken = await K.c.createSystem({ name: `${t} Gamma`, aliases: [`${t} Gamma Short`] });
      assert.equal(taken.aliases.length, 1);
      const retired = (await K.c.getSystem(a.id)).aliases.find((alias) => alias.id === aliasId)!;
      assert.equal(retired.recordStatus, "retired");
      assert.ok(retired.retiredAt);
      await K.c.addAlias({ systemId: b.id, alias: `${t} Alpha Alias` });
    });

    scenario("update validation: provider, jurisdiction, login URL; null clears; nothing-to-change is refused", async () => {
      const actor = await fullStaff();
      const provider = await org("Provider");
      const archivedProvider = await org("Archived");
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [archivedProvider]);
      const system = await mkSystem();
      await invalid(K.c.updateSystem({ systemId: system.id }));
      await invalid(K.c.updateSystem({ systemId: system.id, unexpected: 1 }));
      await invalid(K.c.updateSystem({ systemId: system.id, jurisdictionRegion: "AB" }));
      await invalid(K.c.updateSystem({ systemId: system.id, providerOrganizationId: randomUUID() }));
      await invalid(K.c.updateSystem({ systemId: system.id, providerOrganizationId: archivedProvider }));
      for (const url of ["http://x.example.com", "https://u:p@x.example.com", "https://x.example.com/?q=1", "https://x.example.com/#f", "not a url", 5]) await invalid(K.c.updateSystem({ systemId: system.id, loginUrl: url }));
      await invalid(K.c.updateSystem({ systemId: system.id, jurisdictionCountry: "CAN" }));
      await invalid(K.c.updateSystem({ systemId: system.id, name: "!!!" }));
      const updated = await K.c.updateSystem({ systemId: system.id, providerOrganizationId: provider, jurisdictionCountry: "us", jurisdictionRegion: "tx", loginUrl: "https://portal.example.com" });
      assert.deepEqual([updated.providerOrganizationId, updated.jurisdictionCountry, updated.jurisdictionRegion, updated.loginUrl], [provider, "US", "TX", "https://portal.example.com"]);
      await invalid(K.c.updateSystem({ systemId: system.id, jurisdictionCountry: null }));
      await invalid(K.c.updateSystem({ systemId: system.id, loginUrl: "https://portal.example.com" }));
      const cleared = await K.c.updateSystem({ systemId: system.id, providerOrganizationId: null, jurisdictionRegion: null, loginUrl: null });
      assert.deepEqual([cleared.providerOrganizationId, cleared.jurisdictionRegion, cleared.loginUrl, cleared.jurisdictionCountry], [null, null, null, "US"]);
      const both = await K.c.updateSystem({ systemId: system.id, jurisdictionCountry: null });
      assert.equal(both.jurisdictionCountry, null);
      // events carry no name, URL or code of a URL; a name/URL change is recorded as CHANGED only
      const json = await eventsJson(actor.actorId);
      assert.equal(json.includes("portal.example.com"), false);
      assert.equal(json.includes(system.displayName), false);
    });

    scenario("an archived system refuses edits, aliases and new credentials; restoring it re-enables them", async () => {
      await fullStaff();
      const o = await org();
      const system = await mkSystem();
      const existing = await mkCred(o, system.id, "kept");
      const archived = await K.c.archiveSystem({ systemId: system.id });
      assert.equal(archived.recordStatus, "archived");
      assert.ok(archived.archivedAt);
      await stateError(K.c.archiveSystem({ systemId: system.id }));
      await stateError(K.c.updateSystem({ systemId: system.id, loginUrl: "https://x.example.com" }));
      await stateError(K.c.addAlias({ systemId: system.id, alias: `${token()} Alias` }));
      await stateError(mkCred(o, system.id, "another"));
      assert.equal((await K.c.getOrganizationCredentials(o)).credentials.length, 1, "existing credentials stay readable");
      assert.equal(existing.credential.recordStatus, "active");
      assert.ok(!(await K.c.listSystems()).some((row) => row.id === system.id));
      assert.ok((await K.c.listSystems({ includeArchived: true })).some((row) => row.id === system.id));
      await stateError(K.c.restoreSystem({ systemId: (await mkSystem()).id }));
      const restored = await K.c.restoreSystem({ systemId: system.id });
      assert.equal(restored.recordStatus, "active");
      assert.equal(restored.archivedAt, null);
      await mkCred(o, system.id, "another");
    });

    scenario("reads: listSystems / getSystem validate their input and report missing systems", async () => {
      await fullStaff();
      await invalid(K.c.listSystems({ unexpected: true } as never));
      await invalid(K.c.listSystems({ includeArchived: "yes" } as never));
      await invalid(K.c.getSystem("not-a-uuid"));
      await invalid(K.c.getSystem(undefined as never));
      await notFound(K.c.getSystem(randomUUID()));
    });
  });

  // =============================================================================================================
  describe("credentials", () => {
    scenario("creates the account with an INITIAL status and one UNRESOLVED PASSWORD slot; Master Register holds references and codes only", async () => {
      const actor = await fullStaff();
      const o = await org();
      const system = await mkSystem();
      const username = `Dispatch.${token()}@Example.com`;
      const view = await mkCred(o, system.id, `  ${username}  `, { category: "COMPLIANCE", mfaMethod: "AUTHENTICATOR_APP" });
      assert.equal(view.credential.username, username, "the username is kept as entered, trimmed");
      assert.equal(view.credential.organizationId, o);
      assert.equal(view.credential.systemId, system.id);
      assert.equal(view.credential.category, "COMPLIANCE");
      assert.equal(view.credential.mfaMethod, "AUTHENTICATOR_APP");
      assert.equal(view.credential.recordStatus, "active");
      assert.equal(view.credential.replacesCredentialId, null);
      assert.equal(view.system.displayName, system.displayName);
      assert.equal(view.statusHistory.length, 1);
      assert.equal(view.currentStatus?.status, "ACTIVE");
      assert.equal(view.currentStatus?.reason, "INITIAL");
      assert.equal(view.currentStatus?.effectiveFrom, MICRO(1));
      assert.equal(view.slots.length, 1);
      assert.equal(view.slots[0].slotKind, "PASSWORD");
      assert.equal(view.slots[0].secretState, "UNRESOLVED");
      assert.equal(view.slots[0].storedAt, null);
      assert.deepEqual(view.verifications, []);
      assert.equal(view.lastVerification, null);
      assert.equal(view.replacedByCredentialId, null);
      assert.equal((await pools.admin.query(`SELECT username_normalized AS u FROM public.company_credentials WHERE id = $1`, [view.credential.id])).rows[0].u, username.toLowerCase());

      const noSlot = await mkCred(o, system.id, `other.${token()}`, { passwordSlot: false, status: "NEEDS_VERIFICATION" });
      assert.deepEqual(noSlot.slots, []);
      assert.equal(noSlot.currentStatus?.status, "NEEDS_VERIFICATION");
      const defaultTime = await K.c.createCredential({ organizationId: o, systemId: system.id, category: "OTHER", username: `third.${token()}` });
      assert.ok(defaultTime.currentStatus!.effectiveFrom > MICRO(1));

      const recorded = await events(actor.actorId);
      const forFirst = recorded.filter((row) => row.resource_id === view.credential.id || row.resource_id === view.currentStatus!.id || row.resource_id === view.slots[0].id);
      assert.deepEqual(forFirst.map((row) => row.resource_type).sort(), ["company_credential", "credential_secret_slot", "credential_status_period"]);
      for (const row of forFirst) assert.deepEqual(row.subjects, [`organization:${o}`]);
      const json = await eventsJson(actor.actorId);
      for (const forbidden of [username, username.toLowerCase(), system.displayName, "Example.com"]) assert.equal(json.includes(forbidden), false, forbidden);
      assert.ok(json.includes(`company_credentials:${view.credential.id}`));
    });

    scenario("validation: category, status, mfa, username, instants and unknown keys", async () => {
      await fullStaff();
      const o = await org();
      const s = await mkSystem();
      const good = { organizationId: o, systemId: s.id, category: "FLEET", username: "valid" };
      for (const bad of [
        { category: "Fleet" }, { category: undefined }, { username: "" }, { username: "   " }, { username: 5 }, { username: "a".repeat(255) }, { username: "tab\tinside" }, { status: "Active" },
        { status: "ENDED" }, { mfaMethod: "PHONE" }, { effectiveFrom: "2020-01-01" }, { effectiveFrom: FUTURE }, { passwordSlot: "yes" }, { organizationId: "nope" }, { systemId: undefined }, { extra: 1 },
      ] as Array<Record<string, unknown>>) await invalid(K.c.createCredential({ ...good, ...bad }));
      for (const bad of [null, undefined, "x", 5, [], [good]]) await invalid(K.c.createCredential(bad));
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1`, [o]), 0, "nothing was created by any rejected attempt");
      await K.c.createCredential({ ...good, mfaMethod: null });
    });

    scenario("the same username on two systems is allowed; the same account twice is not, however it is spelled", async () => {
      await fullStaff();
      const o = await org();
      const other = await org("Other");
      const s1 = await mkSystem();
      const s2 = await mkSystem();
      await mkCred(o, s1.id, "Fleet.Manager@Example.com");
      await mkCred(o, s2.id, "fleet.manager@example.com");
      await mkCred(other, s1.id, "fleet.manager@example.com");
      for (const spelling of ["fleet.manager@example.com", "  FLEET.MANAGER@EXAMPLE.COM ", "Fleet.Manager@Example.com"]) await conflict(mkCred(o, s1.id, spelling));
      await mkCred(o, s1.id, "fleet.manager+2@example.com");
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1 AND record_status = 'active'`, [o]), 3);
    });

    scenario("an archived credential frees the account; restoring is refused when it would duplicate an active account", async () => {
      const actor = await fullStaff();
      const o = await org();
      const s = await mkSystem();
      const first = await mkCred(o, s.id, "shared.login");
      await stateError(K.c.restoreCredential({ credentialId: first.credential.id }));
      const archived = await K.c.archiveCredential({ credentialId: first.credential.id });
      assert.equal(archived.credential.recordStatus, "archived");
      assert.ok(archived.credential.archivedAt);
      assert.equal(archived.statusHistory.length, 1, "history stays");
      await stateError(K.c.archiveCredential({ credentialId: first.credential.id }));
      const second = await mkCred(o, s.id, "SHARED.LOGIN");
      await conflict(K.c.restoreCredential({ credentialId: first.credential.id }));
      assert.equal((await K.c.getOrganizationCredentials(o)).credentials.find((c) => c.credential.id === first.credential.id)!.credential.recordStatus, "archived");
      await K.c.archiveCredential({ credentialId: second.credential.id });
      const restored = await K.c.restoreCredential({ credentialId: first.credential.id });
      assert.equal(restored.credential.recordStatus, "active");
      assert.equal(restored.credential.archivedAt, null);
      assert.deepEqual((await eventTypes(actor.actorId)).filter((type) => type === "RECORD_ARCHIVED" || type === "RECORD_RESTORED").sort(), ["RECORD_ARCHIVED", "RECORD_ARCHIVED", "RECORD_RESTORED"]);
    });

    scenario("a changed login is a NEW credential that replaces the old one; the old keeps its history", async () => {
      await fullStaff();
      const o = await org();
      const s = await mkSystem();
      const old = await mkCred(o, s.id, "old.login", { category: "FUEL", mfaMethod: "SMS" });
      await K.c.recordVerification({ credentialId: old.credential.id, outcome: "VERIFIED", method: "MANUAL_LOGIN", verifiedAt: MONTH(2) });
      await K.c.changeCredentialStatus({ credentialId: old.credential.id, status: "LOCKED", effectiveFrom: MONTH(3) });

      await invalid(K.c.replaceCredential({ credentialId: old.credential.id, username: "old.login", reason: "USERNAME_CHANGED" }));
      await invalid(K.c.replaceCredential({ credentialId: old.credential.id, username: "new.login", reason: "BECAUSE" }));
      await invalid(K.c.replaceCredential({ credentialId: old.credential.id, username: "new.login" }));
      const replacement = await K.c.replaceCredential({ credentialId: old.credential.id, username: "new.login", reason: "USERNAME_CHANGED", effectiveFrom: MONTH(4) });
      assert.equal(replacement.credential.replacesCredentialId, old.credential.id);
      assert.equal(replacement.credential.replacementReason, "USERNAME_CHANGED");
      assert.equal(replacement.credential.systemId, s.id);
      assert.equal(replacement.credential.category, "FUEL", "category is inherited");
      assert.equal(replacement.credential.mfaMethod, "SMS", "mfa method is inherited");
      assert.equal(replacement.credential.recordStatus, "active");
      assert.equal(replacement.currentStatus?.status, "NEEDS_VERIFICATION", "a new login has not been verified");
      assert.equal(replacement.slots.length, 1);
      assert.equal(replacement.slots[0].secretState, "UNRESOLVED");
      assert.deepEqual(replacement.verifications, []);

      const view = await K.c.getOrganizationCredentials(o);
      const before = view.credentials.find((c) => c.credential.id === old.credential.id)!;
      assert.equal(before.credential.recordStatus, "archived");
      assert.equal(before.replacedByCredentialId, replacement.credential.id);
      assert.equal(before.statusHistory.length, 2, "the old credential's status history is untouched");
      assert.equal(before.verifications.length, 1, "the old credential's verification history is untouched");
      assert.equal(before.slots.length, 1);
      await stateError(K.c.replaceCredential({ credentialId: old.credential.id, username: "third.login", reason: "CORRECTION" }));

      // overrides, and a case-only correction of the same login (the old one has left the active-account index)
      const corrected = await K.c.replaceCredential({ credentialId: replacement.credential.id, username: "NEW.LOGIN", reason: "CORRECTION", category: "OTHER", mfaMethod: null, status: "ACTIVE", passwordSlot: false });
      assert.equal(corrected.credential.username, "NEW.LOGIN");
      assert.equal(corrected.credential.category, "OTHER");
      assert.equal(corrected.credential.mfaMethod, null);
      assert.equal(corrected.currentStatus?.status, "ACTIVE");
      assert.deepEqual(corrected.slots, []);
      assert.equal((await K.c.getOrganizationCredentials(o)).credentials.filter((c) => c.credential.recordStatus === "active").length, 1);
      // replacement chain is intact in the database
      assert.deepEqual((await pools.admin.query(`SELECT replacement_reason AS r FROM public.company_credentials WHERE organization_id = $1 AND replaces_credential_id IS NOT NULL ORDER BY created_at`, [o])).rows.map((row) => row.r), ["USERNAME_CHANGED", "CORRECTION"]);
    });

    scenario("a replacement that duplicates another active account is refused whole, and the old credential stays active", async () => {
      await fullStaff();
      const o = await org();
      const s = await mkSystem();
      const keep = await mkCred(o, s.id, "taken.login");
      const target = await mkCred(o, s.id, "to.replace");
      await conflict(K.c.replaceCredential({ credentialId: target.credential.id, username: "TAKEN.login", reason: "USERNAME_CHANGED" }));
      const views = (await K.c.getOrganizationCredentials(o)).credentials;
      assert.equal(views.length, 2);
      assert.ok(views.every((v) => v.credential.recordStatus === "active"));
      assert.equal(keep.credential.recordStatus, "active");
    });

    scenario("metadata updates change category / mfa method only, and only when something changes", async () => {
      const actor = await fullStaff();
      const { id } = await fixture();
      await invalid(K.c.updateCredentialMetadata({ credentialId: id }));
      await invalid(K.c.updateCredentialMetadata({ credentialId: id, category: "FLEET" }));
      await invalid(K.c.updateCredentialMetadata({ credentialId: id, category: "Fuel" }));
      await invalid(K.c.updateCredentialMetadata({ credentialId: id, mfaMethod: "PHONE" }));
      await invalid(K.c.updateCredentialMetadata({ credentialId: id, username: "nope" }));
      await invalid(K.c.updateCredentialMetadata({ credentialId: id, systemId: randomUUID() }));
      const view = await K.c.updateCredentialMetadata({ credentialId: id, category: "INSURANCE", mfaMethod: "EMAIL" });
      assert.deepEqual([view.credential.category, view.credential.mfaMethod], ["INSURANCE", "EMAIL"]);
      assert.equal((await K.c.updateCredentialMetadata({ credentialId: id, mfaMethod: null })).credential.mfaMethod, null);
      assert.ok((await eventTypes(actor.actorId)).includes("RECORD_UPDATED"));
      await K.c.archiveCredential({ credentialId: id });
      await stateError(K.c.updateCredentialMetadata({ credentialId: id, category: "FUEL" }));
    });

    scenario("an archived or merged Organization refuses writes (and keeps its history readable)", async () => {
      await fullStaff();
      const { o, system, id, passwordSlot } = await fixture();
      const verification = (await K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN", verifiedAt: MONTH(2) })).verifications[0];
      const mfa = (await K.c.addSecretSlot({ credentialId: id, slotKind: "MFA_SECRET" })).slots.find((slot) => slot.slotKind === "MFA_SECRET")!;
      const periodId = (await K.c.getOrganizationCredentials(o)).credentials[0].currentStatus!.id;
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [o]);
      await stateError(mkCred(o, system.id, "blocked"));
      await stateError(K.c.replaceCredential({ credentialId: id, username: "blocked", reason: "USERNAME_CHANGED" }));
      await stateError(K.c.updateCredentialMetadata({ credentialId: id, category: "FUEL" }));
      await stateError(K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED" }));
      await stateError(K.c.recordVerification({ credentialId: id, outcome: "FAILED", method: "MANUAL_LOGIN" }));
      await stateError(K.c.addSecretSlot({ credentialId: id, slotKind: "BACKUP_CODES" }));
      await stateError(K.c.attachSecretReference({ slotId: passwordSlot.id, secretReference: "projects/tes-production-510007/secrets/abc" }));
      assert.equal((await K.c.getOrganizationCredentials(o)).credentials.length, 1, "reads still work");
      // closing out is allowed: void a wrong verification, retire a slot, correct the current status, archive
      assert.equal((await K.c.voidVerification({ verificationId: verification.id })).verifications[0].recordStatus, "voided");
      assert.equal((await K.c.retireSecretSlot({ slotId: mfa.id })).slots.find((slot) => slot.id === mfa.id)!.secretState, "RETIRED");
      assert.equal((await K.c.correctCredentialStatus({ periodId, status: "DISABLED" })).currentStatus?.status, "DISABLED");
      await K.c.archiveCredential({ credentialId: id });
      await stateError(K.c.restoreCredential({ credentialId: id }));

      const survivor = await org("Survivor");
      const merged = await org("Merged");
      await pools.admin.query(`UPDATE public.organizations SET status = 'merged', merged_into_organization_id = $2 WHERE id = $1`, [merged, survivor]);
      await stateError(mkCred(merged, system.id, "blocked"));
      assert.equal((await K.c.getOrganizationCredentials(merged)).credentials.length, 0);
    });

    scenario("missing references are reported as not found, never as database errors", async () => {
      await fullStaff();
      const { o, system } = await fixture();
      const ghost = randomUUID();
      await notFound(mkCred(ghost, system.id, "x"));
      await notFound(mkCred(o, ghost, "x"));
      await notFound(K.c.getOrganizationCredentials(ghost));
      for (const [call, input] of [
        ["replaceCredential", { credentialId: ghost, username: "x", reason: "CORRECTION" }],
        ["updateCredentialMetadata", { credentialId: ghost, category: "FUEL" }],
        ["archiveCredential", { credentialId: ghost }],
        ["restoreCredential", { credentialId: ghost }],
        ["changeCredentialStatus", { credentialId: ghost, status: "LOCKED" }],
        ["correctCredentialStatus", { periodId: ghost, status: "LOCKED" }],
        ["recordVerification", { credentialId: ghost, outcome: "VERIFIED", method: "MANUAL_LOGIN" }],
        ["voidVerification", { verificationId: ghost }],
        ["addSecretSlot", { credentialId: ghost, slotKind: "MFA_SECRET" }],
        ["attachSecretReference", { slotId: ghost, secretReference: "projects/tes-production-510007/secrets/abc" }],
        ["retireSecretSlot", { slotId: ghost }],
        ["updateSystem", { systemId: ghost, loginUrl: "https://x.example.com" }],
        ["addAlias", { systemId: ghost, alias: "x y" }],
        ["retireAlias", { aliasId: ghost }],
        ["archiveSystem", { systemId: ghost }],
        ["restoreSystem", { systemId: ghost }],
      ] as Array<[keyof typeof K.c, unknown]>) await notFound((K.c[call] as (input: unknown) => Promise<unknown>)(input));
    });
  });

  // =============================================================================================================
  describe("status history", () => {
    scenario("a real-world change ends the old period and starts the next at the same instant; validation protects the timeline", async () => {
      const actor = await fullStaff();
      const { o, id } = await fixture();
      await invalid(K.c.changeCredentialStatus({ credentialId: id, status: "ACTIVE", effectiveFrom: MONTH(3) }));
      await invalid(K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED", effectiveFrom: MONTH(1) }));
      await invalid(K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED", effectiveFrom: FUTURE }));
      await invalid(K.c.changeCredentialStatus({ credentialId: id, status: "Locked" }));
      await invalid(K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED", effectiveFrom: "2020-03-01" }));
      await invalid(K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED", extra: 1 }));
      await K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED", effectiveFrom: MONTH(3) });
      const view = await K.c.changeCredentialStatus({ credentialId: id, status: "NEEDS_VERIFICATION", effectiveFrom: MONTH(5) });
      assert.deepEqual(view.statusHistory.map((p) => p.status), ["ACTIVE", "LOCKED", "NEEDS_VERIFICATION"]);
      assert.deepEqual(view.statusHistory.map((p) => p.reason), ["INITIAL", "TRANSITION", "TRANSITION"]);
      assert.deepEqual(view.statusHistory.map((p) => p.effectiveFrom), [MICRO(1), MICRO(3), MICRO(5)]);
      assert.deepEqual(view.statusHistory.map((p) => p.effectiveTo), [MICRO(3), MICRO(5), null]);
      assert.ok(view.statusHistory.every((p) => p.recordStatus === "active"));
      assert.equal(view.currentStatus?.status, "NEEDS_VERIFICATION");
      await invalid(K.c.changeCredentialStatus({ credentialId: id, status: "DISABLED", effectiveFrom: MONTH(4) }));
      // as-of reads follow business time
      const at = async (m: number) => (await K.c.getOrganizationCredentials(o, { asOf: MONTH(m) })).credentials[0].asOf;
      assert.equal((await at(2))?.status?.status, "ACTIVE");
      assert.equal((await at(3))?.status?.status, "LOCKED");
      assert.equal((await at(4))?.status?.status, "LOCKED");
      assert.equal((await at(6))?.status?.status, "NEEDS_VERIFICATION");
      assert.equal((await K.c.getOrganizationCredentials(o, { asOf: "2019-01-01T00:00:00Z" })).credentials[0].asOf?.status, null, "before the credential existed");
      assert.equal((await K.c.getOrganizationCredentials(o)).credentials[0].asOf, null);
      const types = await eventTypes(actor.actorId);
      assert.equal(types.filter((type) => type === "RECORD_STATUS_CHANGED").length, 2);
      await K.c.archiveCredential({ credentialId: id });
      await stateError(K.c.changeCredentialStatus({ credentialId: id, status: "DISABLED" }));
    });

    scenario("a correction keeps the wrong period flagged, inherits its business time and is never shown as genuine history", async () => {
      await fullStaff();
      const { o, id } = await fixture();
      const view = await K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED", effectiveFrom: MONTH(3) });
      const ended = view.statusHistory[0];
      const wrong = view.currentStatus!;
      await stateError(K.c.correctCredentialStatus({ periodId: ended.id, status: "DISABLED" }));
      await invalid(K.c.correctCredentialStatus({ periodId: wrong.id, status: "LOCKED" }));
      await invalid(K.c.correctCredentialStatus({ periodId: wrong.id, status: "bogus" }));
      await invalid(K.c.correctCredentialStatus({ periodId: wrong.id }));
      const fixed = await K.c.correctCredentialStatus({ periodId: wrong.id, status: "DISABLED" });
      assert.equal(fixed.statusHistory.length, 3, "the wrong period is preserved");
      const preserved = fixed.statusHistory.find((p) => p.id === wrong.id)!;
      assert.equal(preserved.recordStatus, "corrected");
      assert.equal(preserved.status, "LOCKED", "its content is unchanged");
      assert.equal(preserved.effectiveTo, null, "a correction does not end the period");
      assert.ok(preserved.correctedAt);
      const replacement = fixed.statusHistory.find((p) => p.id === preserved.supersededById)!;
      assert.equal(replacement.reason, "CORRECTION");
      assert.equal(replacement.status, "DISABLED");
      assert.equal(replacement.effectiveFrom, wrong.effectiveFrom, "the replacement inherits the business time");
      assert.equal(replacement.recordStatus, "active");
      assert.equal(fixed.currentStatus?.id, replacement.id);
      assert.equal((await K.c.getOrganizationCredentials(o, { asOf: MONTH(4) })).credentials[0].asOf?.status?.status, "DISABLED");
      await stateError(K.c.correctCredentialStatus({ periodId: wrong.id, status: "ACTIVE" }));
      // history continues normally after a correction
      const next = await K.c.changeCredentialStatus({ credentialId: id, status: "ACTIVE", effectiveFrom: MONTH(6) });
      assert.deepEqual(next.statusHistory.filter((p) => p.recordStatus === "active").map((p) => p.status), ["ACTIVE", "DISABLED", "ACTIVE"]);
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_status_periods WHERE credential_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]), 1);
    });
  });

  // =============================================================================================================
  describe("verification", () => {
    scenario("records who verified what and when, never changes the status, and voiding is one-way", async () => {
      const first = await staff(...BOTH);
      const second = await staff(...BOTH);
      signIn(first);
      const { o, id } = await fixture();
      const one = await K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN", verifiedAt: MONTH(2) });
      assert.equal(one.verifications.length, 1);
      assert.equal(one.verifications[0].recordedByActorId, first.actorId, "the actor is the authenticated TES actor");
      assert.equal(one.verifications[0].verifiedAt, MICRO(2));
      assert.equal(one.currentStatus?.status, "ACTIVE");
      signIn(second);
      const two = await K.c.recordVerification({ credentialId: id, outcome: "LOCKED_OUT", method: "PORTAL_CHECK" });
      assert.equal(two.currentStatus?.status, "ACTIVE", "a failed / locked-out verification does not silently change the status");
      assert.equal(two.statusHistory.length, 1);
      const latest = two.verifications.find((v) => v.outcome === "LOCKED_OUT")!;
      assert.equal(latest.recordedByActorId, second.actorId);
      assert.equal(two.lastVerification?.id, latest.id);
      assert.deepEqual(two.verifications.map((v) => v.method), ["MANUAL_LOGIN", "PORTAL_CHECK"], "ordered by business time");

      await invalid(K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN", verifiedAt: FUTURE }));
      await invalid(K.c.recordVerification({ credentialId: id, outcome: "PASSED", method: "MANUAL_LOGIN" }));
      await invalid(K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "TELEPATHY" }));
      await invalid(K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN", recordedByActorId: first.actorId }));
      await invalid(K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN", actorId: first.actorId }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_verifications WHERE credential_id = $1`, [id]), 2);

      const voided = await K.c.voidVerification({ verificationId: latest.id });
      const row = voided.verifications.find((v) => v.id === latest.id)!;
      assert.equal(row.recordStatus, "voided");
      assert.ok(row.voidedAt);
      assert.equal(voided.verifications.length, 2, "a voided verification is kept");
      assert.equal(voided.lastVerification?.id, one.verifications[0].id, "a voided verification is no longer the latest");
      await stateError(K.c.voidVerification({ verificationId: latest.id }));
      assert.equal((await K.c.getOrganizationCredentials(o)).credentials[0].verifications.length, 2);
      await K.c.archiveCredential({ credentialId: id });
      await stateError(K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN" }));
    });
  });

  // =============================================================================================================
  describe("secret slots", () => {
    scenario("one live PASSWORD and one live MFA_SECRET per credential; other kinds repeat; retiring frees the kind", async () => {
      const actor = await fullStaff();
      const { id, passwordSlot } = await fixture();
      assert.equal(passwordSlot.secretState, "UNRESOLVED");
      await conflict(K.c.addSecretSlot({ credentialId: id, slotKind: "PASSWORD" }));
      await invalid(K.c.addSecretSlot({ credentialId: id, slotKind: "PIN" }));
      await invalid(K.c.addSecretSlot({ credentialId: id, slotKind: "PASSWORD", secretState: "STORED" }));
      const mfa = await K.c.addSecretSlot({ credentialId: id, slotKind: "MFA_SECRET" });
      await conflict(K.c.addSecretSlot({ credentialId: id, slotKind: "MFA_SECRET" }));
      await K.c.addSecretSlot({ credentialId: id, slotKind: "RECOVERY_EMAIL" });
      const many = await K.c.addSecretSlot({ credentialId: id, slotKind: "RECOVERY_EMAIL" });
      assert.equal(many.slots.filter((slot) => slot.slotKind === "RECOVERY_EMAIL").length, 2);
      const mfaSlot = mfa.slots.find((slot) => slot.slotKind === "MFA_SECRET")!;
      const retired = await K.c.retireSecretSlot({ slotId: mfaSlot.id });
      const row = retired.slots.find((slot) => slot.id === mfaSlot.id)!;
      assert.equal(row.secretState, "RETIRED");
      assert.ok(row.retiredAt);
      await stateError(K.c.retireSecretSlot({ slotId: mfaSlot.id }));
      await K.c.addSecretSlot({ credentialId: id, slotKind: "MFA_SECRET" });
      await stateError(K.c.attachSecretReference({ slotId: mfaSlot.id, secretReference: "projects/tes-production-510007/secrets/abc" }));
      const types = await events(actor.actorId);
      assert.ok(types.some((row2) => row2.resource_type === "credential_secret_slot" && row2.event_type === "RECORD_STATUS_CHANGED"));
    });

    scenario("attach moves UNRESOLVED -> STORED once; retiring keeps the reference; a retired slot is frozen", async () => {
      await fullStaff();
      const { id, passwordSlot } = await fixture();
      const reference = `projects/tes-production-510007/secrets/atios-${run}/versions/3`;
      const stored = await K.c.attachSecretReference({ slotId: passwordSlot.id, secretReference: reference, secretStore: "GCP_SECRET_MANAGER" });
      const slot = stored.slots[0];
      assert.equal(slot.secretState, "STORED");
      assert.ok(slot.storedAt);
      assert.equal(slot.retiredAt, null);
      const dbRow = (await pools.admin.query(`SELECT secret_store, secret_reference FROM public.credential_secret_slots WHERE id = $1`, [passwordSlot.id])).rows[0];
      assert.deepEqual(dbRow, { secret_store: "GCP_SECRET_MANAGER", secret_reference: reference });
      await stateError(K.c.attachSecretReference({ slotId: passwordSlot.id, secretReference: `projects/tes-production-510007/secrets/other-${run}` }));
      assert.equal((await pools.admin.query(`SELECT secret_reference FROM public.credential_secret_slots WHERE id = $1`, [passwordSlot.id])).rows[0].secret_reference, reference, "a stored reference is never rewritten");
      const retired = await K.c.retireSecretSlot({ slotId: passwordSlot.id });
      assert.equal(retired.slots[0].secretState, "RETIRED");
      assert.equal((await pools.admin.query(`SELECT secret_reference FROM public.credential_secret_slots WHERE id = $1`, [passwordSlot.id])).rows[0].secret_reference, reference, "the reference is kept so the stored version can be destroyed and audited");
      await stateError(K.c.attachSecretReference({ slotId: passwordSlot.id, secretReference: reference }));
      // a fresh PASSWORD slot can replace the retired one
      const next = await K.c.addSecretSlot({ credentialId: id, slotKind: "PASSWORD" });
      assert.equal(next.slots.filter((s) => s.slotKind === "PASSWORD" && s.secretState === "UNRESOLVED").length, 1);
      // an UNRESOLVED slot can be retired without ever holding a reference
      const unresolved = next.slots.find((s) => s.secretState === "UNRESOLVED")!;
      await K.c.retireSecretSlot({ slotId: unresolved.id });
      assert.equal((await pools.admin.query(`SELECT secret_reference FROM public.credential_secret_slots WHERE id = $1`, [unresolved.id])).rows[0].secret_reference, null);
      // an archived credential's slots can be closed out but not stored
      const other = await K.c.addSecretSlot({ credentialId: id, slotKind: "BACKUP_CODES" });
      await K.c.archiveCredential({ credentialId: id });
      const backup = other.slots.find((s) => s.slotKind === "BACKUP_CODES")!;
      await stateError(K.c.attachSecretReference({ slotId: backup.id, secretReference: reference }));
      await stateError(K.c.addSecretSlot({ credentialId: id, slotKind: "RECOVERY_PIN" }));
      assert.equal((await K.c.retireSecretSlot({ slotId: backup.id })).slots.find((s) => s.id === backup.id)!.secretState, "RETIRED");
    });
  });

  // =============================================================================================================
  describe("reads and cross-Organization non-leakage", () => {
    scenario("an Organization's credentials never contain another Organization's rows", async () => {
      await fullStaff();
      const a = await org("A");
      const b = await org("B");
      const s = await mkSystem();
      const userA = `alice.${token()}`;
      const userB = `bob.${token()}`;
      const credA = await mkCred(a, s.id, userA);
      const credB = await mkCred(b, s.id, userB);
      await K.c.recordVerification({ credentialId: credA.credential.id, outcome: "VERIFIED", method: "MANUAL_LOGIN" });
      await K.c.recordVerification({ credentialId: credB.credential.id, outcome: "FAILED", method: "PORTAL_CHECK" });
      await K.c.changeCredentialStatus({ credentialId: credB.credential.id, status: "LOCKED" });
      const viewA = await K.c.getOrganizationCredentials(a);
      const viewB = await K.c.getOrganizationCredentials(b);
      assert.equal(viewA.organizationId, a);
      assert.deepEqual(viewA.credentials.map((c) => c.credential.id), [credA.credential.id]);
      assert.deepEqual(viewB.credentials.map((c) => c.credential.id), [credB.credential.id]);
      const jsonA = JSON.stringify(viewA);
      assert.equal(jsonA.includes(userB), false);
      assert.equal(jsonA.includes(credB.credential.id), false);
      for (const slot of credB.slots) assert.equal(jsonA.includes(slot.id), false);
      assert.equal(JSON.stringify(viewB).includes(userA), false);
      assert.equal(viewA.credentials[0].statusHistory.length, 1);
      assert.equal(viewB.credentials[0].statusHistory.length, 2);
      assert.deepEqual((await K.c.getOrganizationCredentials(await org("Empty"))).credentials, []);
      await invalid(K.c.getOrganizationCredentials("nope"));
      await invalid(K.c.getOrganizationCredentials(a, { asOf: "2020-01-01" }));
      await invalid(K.c.getOrganizationCredentials(a, { asOf: MONTH(1), unexpected: true } as never));
    });
  });

  // =============================================================================================================
  describe("database backstops (the service bypassed, as the runtime role)", () => {
    scenario("system names: duplicates, name-vs-alias and alias-vs-name are refused by the database", async () => {
      await fullStaff();
      const t = token();
      const a = await K.c.createSystem({ name: `${t} Alpha`, aliases: [`${t} Short`] });
      const b = await K.c.createSystem({ name: `${t} Beta` });
      const insertSystem = (name: string, normalized: string) => [`INSERT INTO public.credential_systems (display_name, display_name_normalized) VALUES ($1, $2)`, [name, normalized]] as [string, unknown[]];
      const insertAlias = (systemId: string, display: string, normalized: string) => [`INSERT INTO public.credential_system_aliases (system_id, alias_display, alias_normalized) VALUES ($1, $2, $3)`, [systemId, display, normalized]] as [string, unknown[]];
      const expectConstraint = async (who: typeof asRuntime, statements: Array<[string, unknown[]?]>, constraint: string, label: string) => {
        const outcome = await who(statements);
        assert.ok(outcome.error, `${label}: expected a failure`);
        assert.equal(outcome.error!.constraint, constraint, label);
      };
      for (const who of [asRuntime, asOwner]) {
        await expectConstraint(who, [insertSystem(`${t}-ALPHA`, `${t} alpha`)], "credential_systems_name_normalized_uq", "same normalized name");
        await expectConstraint(who, [insertSystem(`${t} Short!`, `${t} short`)], "credential_systems_name_not_alias", "name equals another system's alias");
        await expectConstraint(who, [insertAlias(b.id, `${t} alpha`, `${t} alpha`)], "credential_system_aliases_not_system_name", "alias equals another system's name");
        await expectConstraint(who, [insertAlias(b.id, `${t} SHORT`, `${t} short`)], "credential_system_aliases_active_uq", "alias equals another system's alias");
      }
      await K.c.archiveSystem({ systemId: a.id });
      await expectConstraint(asRuntime, [insertAlias(a.id, `${t} Late`, `${t} late`)], "credential_system_aliases_system_active", "alias for an archived system");
      // a system cannot be renamed onto another system's name or alias
      await expectConstraint(asRuntime, [[`UPDATE public.credential_systems SET display_name_normalized = $2, display_name = $2 WHERE id = $1`, [b.id, `${t} alpha`]]], "credential_systems_name_normalized_uq", "rename onto another name");
      await expectConstraint(asRuntime, [[`UPDATE public.credential_systems SET display_name_normalized = $2, display_name = $2 WHERE id = $1`, [b.id, `${t} short`]]], "credential_systems_name_not_alias", "rename onto an alias");
      // check constraints
      for (const [display, normalized, constraint] of [
        ["x", "Not Normalized", "credential_systems_name_normalized_valid"], ["x", " leading", "credential_systems_name_normalized_valid"], ["x", "double  space", "credential_systems_name_normalized_valid"],
        [" padded", `${t} pad`, "credential_systems_display_name_not_blank"], ["", `${t} blank`, "credential_systems_display_name_not_blank"],
      ] as Array<[string, string, string]>) await expectConstraint(asRuntime, [insertSystem(display, normalized)], constraint, `${display}|${normalized}`);
      for (const [column, value, constraint] of [
        ["login_url", "http://x.example.com", "credential_systems_login_url_valid"], ["login_url", "https://u:p@x.example.com", "credential_systems_login_url_valid"], ["login_url", "https://x.example.com/?a=1", "credential_systems_login_url_valid"],
        ["jurisdiction_country", "CAN", "credential_systems_country_valid"], ["jurisdiction_region", "AB", "credential_systems_region_valid"],
      ] as Array<[string, string, string]>) await expectConstraint(asRuntime, [[`UPDATE public.credential_systems SET ${column} = $2 WHERE id = $1`, [b.id, value]]], constraint, `${column} ${value}`);
    });

    scenario("two connections inserting one system name: the second waits for the first, then fails with a named constraint", async () => {
      await fullStaff();
      const t = token();
      const [first, second] = [await pools.runtime.connect(), await pools.runtime.connect()];
      try {
        await first.query("BEGIN");
        await second.query("BEGIN");
        await first.query(`INSERT INTO public.credential_systems (display_name, display_name_normalized) VALUES ($1, $2)`, [`${t} Race`, `${t} race`]);
        const blocked = second.query(`INSERT INTO public.credential_systems (display_name, display_name_normalized) VALUES ($1, $2)`, [`${t}-RACE`, `${t} race`]);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await first.query("COMMIT");
        await assert.rejects(blocked, (error: { constraint?: string }) => error.constraint === "credential_systems_name_normalized_uq");
        // an alias racing a system name: the alias insert waits for the system's name lock, then sees the committed system
        const other = await K.c.createSystem({ name: `${t} Other` });
        await second.query("ROLLBACK");
        await first.query("BEGIN");
        await second.query("BEGIN");
        await first.query(`INSERT INTO public.credential_systems (display_name, display_name_normalized) VALUES ($1, $2)`, [`${t} Contested`, `${t} contested`]);
        const aliasInsert = second.query(`INSERT INTO public.credential_system_aliases (system_id, alias_display, alias_normalized) VALUES ($1, $2, $3)`, [other.id, `${t} contested`, `${t} contested`]);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await first.query("COMMIT");
        await assert.rejects(aliasInsert, (error: { constraint?: string }) => error.constraint === "credential_system_aliases_not_system_name");
      } finally {
        await first.query("ROLLBACK").catch(() => undefined);
        await second.query("ROLLBACK").catch(() => undefined);
        first.release();
        second.release();
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_systems WHERE display_name_normalized = $1`, [`${t} race`]), 1);
    });

    scenario("credentials: active account, active system, active Organization, current status, identity, FK scopes and check constraints", async () => {
      await fullStaff();
      const { o, system, id } = await fixture();
      const archivedSystem = await mkSystem();
      await K.c.archiveSystem({ systemId: archivedSystem.id });
      const closedOrg = await org("Closed");
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [closedOrg]);
      const username = (await pools.admin.query<{ u: string }>(`SELECT username_normalized AS u FROM public.company_credentials WHERE id = $1`, [id])).rows[0].u;
      const insert = (over: Partial<Record<"id" | "org" | "system" | "category" | "display" | "normalized" | "mfa" | "replaces" | "reason", unknown>> = {}) => {
        const v = { id: randomUUID(), org: o, system: system.id, category: "FLEET", display: "someone", normalized: "someone", mfa: null, replaces: null, reason: null, ...over };
        return [`INSERT INTO public.company_credentials (id, organization_id, system_id, category, username_display, username_normalized, mfa_method, replaces_credential_id, replacement_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [v.id, v.org, v.system, v.category, v.display, v.normalized, v.mfa, v.replaces, v.reason]] as [string, unknown[]];
      };
      const period = (credentialId: string, status = "ACTIVE") => [`INSERT INTO public.credential_status_periods (credential_id, credential_status, period_reason, effective_from) VALUES ($1, $2, 'INITIAL', '2020-01-01')`, [credentialId, status]] as [string, unknown[]];
      const withPeriod = (statement: [string, unknown[]]): Array<[string, unknown[]]> => [statement, period(statement[1][0] as string)];
      const fails = async (statements: Array<[string, unknown[]?]>, expected: string | RegExp, label: string, who: typeof asRuntime = asRuntime) => {
        const outcome = await who(statements);
        assert.ok(outcome.error, `${label}: expected a failure`);
        if (typeof expected === "string") assert.equal(outcome.error!.constraint, expected, label);
        else assert.match(outcome.error!.message, expected, label);
      };

      await fails(withPeriod(insert({ normalized: username, display: username })), "company_credentials_active_account_uq", "duplicate active account");
      await fails(withPeriod(insert({ system: archivedSystem.id })), "company_credentials_system_active", "archived system");
      await fails(withPeriod(insert({ org: closedOrg })), "organization_must_be_active", "archived Organization");
      await fails([insert()], "company_credentials_require_current_status", "a credential without a current status cannot commit");
      await fails(withPeriod(insert({ category: "BOGUS" })), /foreign key|company_credentials_category_fkey/, "unknown category");
      await fails(withPeriod(insert({ system: randomUUID() })), "company_credentials_system_active", "unknown system");
      await fails(withPeriod(insert({ org: randomUUID() })), "organization_must_be_active", "unknown Organization");
      await fails(withPeriod(insert({ mfa: "PHONE" })), "company_credentials_mfa_method_valid", "unknown mfa method");
      await fails(withPeriod(insert({ display: " padded", normalized: "padded" })), "company_credentials_username_display_not_blank", "padded username");
      await fails(withPeriod(insert({ normalized: "UPPER" })), "company_credentials_username_normalized_valid", "non-lower-case normalized username");
      await fails(withPeriod(insert({ replaces: id })), "company_credentials_replacement_state_consistent", "a replacement needs a reason");
      await fails(withPeriod(insert({ replaces: id, reason: "WHY" })), "company_credentials_replacement_reason_valid", "unknown replacement reason");
      // a replacement must be on the SAME Organization and system
      const otherSystem = await mkSystem();
      await fails(withPeriod(insert({ system: otherSystem.id, replaces: id, reason: "CORRECTION" })), /foreign key|company_credentials_replaces_fk/, "replacement on another system");
      const stranger = await org("Stranger");
      await fails(withPeriod(insert({ org: stranger, replaces: id, reason: "CORRECTION" })), /foreign key|company_credentials_replaces_fk/, "replacement on another Organization");
      // identity is immutable, even for the table owner
      for (const [column, value] of [["username_display", "renamed"], ["username_normalized", "renamed"], ["system_id", otherSystem.id], ["organization_id", stranger]] as Array<[string, string]>) {
        await fails([[`UPDATE public.company_credentials SET ${column} = $2 WHERE id = $1`, [id, value]]], /./, `owner updating ${column}`, asOwner);
        await fails([[`UPDATE public.company_credentials SET ${column} = $2 WHERE id = $1`, [id, value]]], /permission denied/, `runtime updating ${column}`);
      }
      await fails([[`DELETE FROM public.company_credentials WHERE id = $1`, [id]]], /permission denied/, "runtime delete");
      await fails([[`DELETE FROM public.company_credentials WHERE id = $1`, [id]]], /Credential data is preserved/, "owner delete", asOwner);
      await fails([[`TRUNCATE public.company_credentials CASCADE`]], /Credential data is preserved|permission denied/, "owner truncate", asOwner);
      // the same login on another system / Organization is fine at the database too
      const ok = await asRuntime(withPeriod(insert({ system: otherSystem.id, normalized: username, display: username })));
      assert.equal(ok.error, undefined);
    });

    scenario("status periods, verifications and slots: parents must be active; one current period; content and state are immutable", async () => {
      await fullStaff();
      const { o, id, passwordSlot, system } = await fixture();
      const view = await K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN", verifiedAt: MONTH(2) });
      const verificationId = view.verifications[0].id;
      const periodId = view.currentStatus!.id;
      const archived = await mkCred(o, system.id, `gone.${token()}`);
      await K.c.archiveCredential({ credentialId: archived.credential.id });
      const actorId = view.verifications[0].recordedByActorId;
      const fails = async (statements: Array<[string, unknown[]?]>, expected: string | RegExp, label: string, who: typeof asRuntime = asRuntime) => {
        const outcome = await who(statements);
        assert.ok(outcome.error, `${label}: expected a failure`);
        if (typeof expected === "string") assert.equal(outcome.error!.constraint, expected, label);
        else assert.match(outcome.error!.message, expected, label);
      };

      // status periods
      await fails([[`INSERT INTO public.credential_status_periods (credential_id, credential_status, period_reason, effective_from) VALUES ($1, 'LOCKED', 'TRANSITION', '2020-06-01')`, [id]]], "credential_status_periods_current_uq", "two current periods");
      await fails([[`INSERT INTO public.credential_status_periods (credential_id, credential_status, period_reason, effective_from) VALUES ($1, 'LOCKED', 'TRANSITION', '2020-06-01')`, [archived.credential.id]]], "credential_status_periods_credential_active", "period for an archived credential");
      await fails([[`INSERT INTO public.credential_status_periods (credential_id, credential_status, period_reason, effective_from) VALUES ($1, 'RETIRED', 'TRANSITION', '2020-06-01')`, [id]]], "credential_status_periods_status_valid", "unknown status");
      await fails([[`UPDATE public.credential_status_periods SET effective_to = '2019-01-01' WHERE id = $1`, [periodId]]], "credential_status_periods_effective_window_valid", "an end before the start");
      for (const column of ["credential_status", "effective_from", "period_reason"]) await fails([[`UPDATE public.credential_status_periods SET ${column} = ${column} WHERE id = $1`, [periodId]]], /permission denied/, `runtime updating ${column}`);
      await fails([[`UPDATE public.credential_status_periods SET credential_status = 'LOCKED' WHERE id = $1`, [periodId]]], /immutable/, "owner rewriting a status", asOwner);
      await fails([[`UPDATE public.credential_status_periods SET record_status = 'corrected', corrected_at = now() WHERE id = $1`, [periodId]]], /./, "a correction without its replacement", asRuntime);
      // a pointer to a period of ANOTHER credential is refused at commit
      const foreign = (await K.c.createCredential({ organizationId: o, systemId: system.id, category: "FLEET", username: `foreign.${token()}` })).currentStatus!.id;
      await fails([[`UPDATE public.credential_status_periods SET record_status = 'corrected', corrected_at = now(), superseded_by_period_id = $2 WHERE id = $1`, [periodId, foreign]]], /foreign key|superseded_by_fk/, "cross-credential pointer");

      // verifications
      const verification = (verifiedAt: string, credential = id, organization = o) =>
        [`INSERT INTO public.credential_verifications (credential_id, organization_id, outcome, method, verified_at, recorded_by_actor_id) VALUES ($1, $2, 'VERIFIED', 'MANUAL_LOGIN', $3, $4)`, [credential, organization, verifiedAt, actorId]] as [string, unknown[]];
      await fails([verification("2999-01-01")], "credential_verifications_not_future", "future verification");
      await fails([verification("2020-01-01", archived.credential.id)], "credential_verifications_credential_active", "verification for an archived credential");
      await fails([verification("2020-01-01", id, await org("Wrong"))], /foreign key|credential_verifications_credential_fk/, "verification with another Organization");
      await fails([verification("2020-01-01", randomUUID())], "credential_verifications_credential_active", "verification for an unknown credential");
      for (const column of ["outcome", "method", "verified_at", "recorded_by_actor_id", "credential_id"]) await fails([[`UPDATE public.credential_verifications SET ${column} = ${column} WHERE id = $1`, [verificationId]]], /permission denied/, `runtime updating ${column}`);
      await fails([[`UPDATE public.credential_verifications SET outcome = 'FAILED' WHERE id = $1`, [verificationId]]], /immutable fact/, "owner rewriting an outcome", asOwner);
      await fails([[`UPDATE public.credential_verifications SET record_status = 'voided' WHERE id = $1`, [verificationId]]], "credential_verifications_void_state_consistent", "void without a time");
      const voided = await asRuntime([[`UPDATE public.credential_verifications SET record_status = 'voided', voided_at = now() WHERE id = $1`, [verificationId]]]);
      assert.equal(voided.error, undefined);
      await fails([[`UPDATE public.credential_verifications SET record_status = 'active', voided_at = NULL WHERE id = $1`, [verificationId]]], /frozen/, "un-voiding");

      // secret slots
      const slotInsert = (credential: string, kind: string, organization = o) => [`INSERT INTO public.credential_secret_slots (credential_id, organization_id, slot_kind) VALUES ($1, $2, $3)`, [credential, organization, kind]] as [string, unknown[]];
      await fails([slotInsert(id, "PASSWORD")], "credential_secret_slots_single_live_uq", "second live PASSWORD");
      await fails([slotInsert(archived.credential.id, "MFA_SECRET")], "credential_secret_slots_credential_active", "slot for an archived credential");
      await fails([slotInsert(id, "NOTE")], "credential_secret_slots_kind_valid", "unknown slot kind");
      await fails([slotInsert(id, "MFA_SECRET", await org("Wrong2"))], /foreign key|credential_secret_slots_credential_fk/, "slot with another Organization");
      await fails([[`INSERT INTO public.credential_secret_slots (credential_id, organization_id, slot_kind, secret_state) VALUES ($1, $2, 'MFA_SECRET', 'STORED')`, [id, o]]], /permission denied/, "a slot cannot be inserted already STORED (column not insertable)");
      await fails([[`INSERT INTO public.credential_secret_slots (credential_id, organization_id, slot_kind, secret_state, secret_store, secret_reference, stored_at) VALUES ($1, $2, 'MFA_SECRET', 'STORED', 'GCP_SECRET_MANAGER', 'projects/tes-production-510007/secrets/abc', now())`, [id, o]]], /starts UNRESOLVED/, "the owner cannot insert a STORED slot either", asOwner);
      for (const column of ["slot_kind", "credential_id", "organization_id"]) await fails([[`UPDATE public.credential_secret_slots SET ${column} = ${column} WHERE id = $1`, [passwordSlot.id]]], /permission denied/, `runtime updating ${column}`);
      const reference = "projects/tes-production-510007/secrets/abc";
      const store = (state: string) => [`UPDATE public.credential_secret_slots SET secret_state = $2, secret_store = 'GCP_SECRET_MANAGER', secret_reference = $3, stored_at = now() WHERE id = $1`, [passwordSlot.id, state, reference]] as [string, unknown[]];
      assert.equal((await asRuntime([store("STORED")])).error, undefined);
      await fails([[`UPDATE public.credential_secret_slots SET secret_reference = 'projects/tes-production-510007/secrets/changed' WHERE id = $1`, [passwordSlot.id]]], /never rewritten/, "rewriting a stored reference");
      await fails([[`UPDATE public.credential_secret_slots SET secret_state = 'UNRESOLVED', secret_store = NULL, secret_reference = NULL, stored_at = NULL WHERE id = $1`, [passwordSlot.id]]], /Invalid secret slot transition/, "STORED back to UNRESOLVED");
      await fails([[`UPDATE public.credential_secret_slots SET secret_state = 'RETIRED', retired_at = now(), secret_reference = NULL, secret_store = NULL WHERE id = $1`, [passwordSlot.id]]], /keeps its reference unchanged/, "retiring while erasing the reference");
      assert.equal((await asRuntime([[`UPDATE public.credential_secret_slots SET secret_state = 'RETIRED', retired_at = now() WHERE id = $1`, [passwordSlot.id]]])).error, undefined);
      await fails([[`UPDATE public.credential_secret_slots SET secret_state = 'STORED', retired_at = NULL WHERE id = $1`, [passwordSlot.id]]], /frozen/, "reviving a retired slot");
      await fails([[`DELETE FROM public.credential_secret_slots WHERE id = $1`, [passwordSlot.id]]], /Credential data is preserved/, "owner delete of a slot", asOwner);
    });
  });

  // =============================================================================================================
  describe("concurrency (real PostgreSQL, distinct authorized actors)", () => {
    const succeeded = (results: PromiseSettledResult<unknown>[]) => results.filter((r) => r.status === "fulfilled").length;
    const onlyDomainErrors = (results: PromiseSettledResult<unknown>[]) => {
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.CompanyCredentialError, `a raw error leaked: ${String(r.reason)}`);
    };

    scenario("1. simultaneous creators of one canonical system name (any spelling): exactly one wins", async () => {
      const as = await concurrentActors(5);
      const t = token();
      const names = [`${t} ATIOS Alberta`, `${t}-ATIOS-Alberta`, `${t}  atios   alberta`, `${t} Átios Alberta`, `${t.toUpperCase()}_atios_alberta`];
      const results = await Promise.allSettled(names.map((name, i) => as(i, () => K.c.createSystem({ name }))));
      assert.equal(succeeded(results), 1);
      onlyDomainErrors(results);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.CompanyCredentialConflictError);
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_systems WHERE display_name_normalized = $1`, [`${t} atios alberta`]), 1);
    });

    scenario("2. a system name racing an alias of the same name on another system: exactly one wins, either direction", async () => {
      const as = await concurrentActors(4);
      await fullStaff();
      const other = await K.c.createSystem({ name: `${token()} Holder` });
      const other2 = await K.c.createSystem({ name: `${token()} Holder` });
      const t = token();
      const results = await Promise.allSettled([
        as(0, () => K.c.createSystem({ name: `${t} Contested` })),
        as(1, () => K.c.addAlias({ systemId: other.id, alias: `${t}-contested` })),
        as(2, () => K.c.addAlias({ systemId: other2.id, alias: `${t} CONTESTED` })),
        as(3, () => K.c.createSystem({ name: `${t} Other Thing`, aliases: [`${t} contested`] })),
      ]);
      onlyDomainErrors(results);
      assert.equal(succeeded(results), 1, "exactly one of the four claims the name");
      const holders = await rowCount(
        `SELECT (SELECT count(*) FROM public.credential_systems WHERE display_name_normalized = $1) + (SELECT count(*) FROM public.credential_system_aliases WHERE alias_normalized = $1 AND record_status = 'active') AS count`,
        [`${t} contested`],
      );
      assert.equal(holders, 1);
    });

    scenario("3. crossing names: {A with alias B} racing {B with alias A} cannot deadlock and cannot both win", async () => {
      const as = await concurrentActors(4);
      for (let round = 0; round < 3; round += 1) {
        const a = `${token()} Left`;
        const b = `${token()} Right`;
        const results = await Promise.allSettled([
          as(0, () => K.c.createSystem({ name: a, aliases: [b] })),
          as(1, () => K.c.createSystem({ name: b, aliases: [a] })),
          as(2, () => K.c.createSystem({ name: a.toUpperCase() })),
          as(3, () => K.c.createSystem({ name: b.toLowerCase(), aliases: [a.toLowerCase()] })),
        ]);
        onlyDomainErrors(results);
        assert.ok(succeeded(results) >= 1);
        for (const name of [a, b]) {
          const normalized = name.toLowerCase();
          const holders = await rowCount(
            `SELECT (SELECT count(*) FROM public.credential_systems WHERE display_name_normalized = $1) + (SELECT count(*) FROM public.credential_system_aliases WHERE alias_normalized = $1 AND record_status = 'active') AS count`,
            [normalized],
          );
          assert.ok(holders <= 1, `${normalized} is held at most once`);
        }
      }
    });

    scenario("4. simultaneous creators of the same (Organization, system, username): exactly one wins", async () => {
      const as = await concurrentActors(5);
      await fullStaff();
      const o = await org();
      const s = await mkSystem();
      const spellings = ["Same.Login", "same.login", "  SAME.LOGIN ", "Same.login", "sAME.lOGIN"];
      const results = await Promise.allSettled(spellings.map((username, i) => as(i, () => mkCred(o, s.id, username))));
      assert.equal(succeeded(results), 1);
      onlyDomainErrors(results);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.c.CompanyCredentialConflictError);
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1`, [o]), 1);
    });

    scenario("5. two connections inserting the same active account directly: the second waits, then fails with the named index", async () => {
      await fullStaff();
      const o = await org();
      const s = await mkSystem();
      const insert = `INSERT INTO public.company_credentials (organization_id, system_id, category, username_display, username_normalized) VALUES ($1, $2, 'FLEET', 'racer', 'racer') RETURNING id`;
      const period = `INSERT INTO public.credential_status_periods (credential_id, credential_status, period_reason, effective_from) VALUES ($1, 'ACTIVE', 'INITIAL', '2020-01-01')`;
      const [first, second] = [await pools.runtime.connect(), await pools.runtime.connect()];
      try {
        await first.query("BEGIN");
        await second.query("BEGIN");
        const id = (await first.query(insert, [o, s.id])).rows[0].id;
        await first.query(period, [id]);
        const blocked = second.query(insert, [o, s.id]);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await first.query("COMMIT");
        await assert.rejects(blocked, (error: { constraint?: string }) => error.constraint === "company_credentials_active_account_uq");
      } finally {
        await first.query("ROLLBACK").catch(() => undefined);
        await second.query("ROLLBACK").catch(() => undefined);
        first.release();
        second.release();
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1`, [o]), 1);
    });

    scenario("6. restoring a credential racing the creation of its account: exactly one active account remains", async () => {
      const as = await concurrentActors(4);
      await fullStaff();
      const o = await org();
      const s = await mkSystem();
      const first = await mkCred(o, s.id, "contested.login");
      await K.c.archiveCredential({ credentialId: first.credential.id });
      const results = await Promise.allSettled([
        as(0, () => K.c.restoreCredential({ credentialId: first.credential.id })),
        as(1, () => mkCred(o, s.id, "CONTESTED.login")),
        as(2, () => K.c.restoreCredential({ credentialId: first.credential.id })),
        as(3, () => mkCred(o, s.id, "contested.LOGIN")),
      ]);
      onlyDomainErrors(results);
      assert.equal(succeeded(results), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1 AND record_status = 'active'`, [o]), 1);
    });

    scenario("7. simultaneous live PASSWORD slots: exactly one is created", async () => {
      const as = await concurrentActors(4);
      const { id } = await (async () => {
        await fullStaff();
        const o = await org();
        const s = await mkSystem();
        const view = await mkCred(o, s.id, `slots.${token()}`, { passwordSlot: false });
        return { id: view.credential.id };
      })();
      const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => as(i, () => K.c.addSecretSlot({ credentialId: id, slotKind: "PASSWORD" }))));
      assert.equal(succeeded(results), 1);
      onlyDomainErrors(results);
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_secret_slots WHERE credential_id = $1 AND slot_kind = 'PASSWORD' AND secret_state <> 'RETIRED'`, [id]), 1);
    });

    scenario("8. simultaneous attaches to one slot: one reference is stored, the rest are refused", async () => {
      const as = await concurrentActors(4);
      await fullStaff();
      const { passwordSlot, id } = await fixture();
      const references = Array.from({ length: 4 }, (_, i) => `projects/tes-production-510007/secrets/race-${run}-${i}`);
      const results = await Promise.allSettled(references.map((secretReference, i) => as(i, () => K.c.attachSecretReference({ slotId: passwordSlot.id, secretReference }))));
      assert.equal(succeeded(results), 1);
      onlyDomainErrors(results);
      const stored = (await pools.admin.query<{ secret_reference: string }>(`SELECT secret_reference FROM public.credential_secret_slots WHERE credential_id = $1 AND secret_state = 'STORED'`, [id])).rows;
      assert.equal(stored.length, 1);
      assert.ok(references.includes(stored[0].secret_reference));
    });

    scenario("9. simultaneous status changes at one instant: one wins; history stays contiguous with one current period", async () => {
      const as = await concurrentActors(4);
      await fullStaff();
      const { id } = await fixture();
      const statuses = ["LOCKED", "DISABLED", "NEEDS_VERIFICATION", "LOCKED"];
      const results = await Promise.allSettled(statuses.map((status, i) => as(i, () => K.c.changeCredentialStatus({ credentialId: id, status, effectiveFrom: MONTH(3) }))));
      assert.equal(succeeded(results), 1);
      onlyDomainErrors(results);
      const rows = (await pools.admin.query<{ effective_from: Date; effective_to: Date | null }>(`SELECT effective_from, effective_to FROM public.credential_status_periods WHERE credential_id = $1 AND record_status = 'active' ORDER BY effective_from`, [id])).rows;
      assert.equal(rows.length, 2);
      assert.equal(rows[0].effective_to?.getTime(), rows[1].effective_from.getTime());
      assert.equal(rows[1].effective_to, null);
    });

    scenario("10. simultaneous replacements of one credential: exactly one replacement; the old one is archived once", async () => {
      const as = await concurrentActors(4);
      await fullStaff();
      const { o, id } = await fixture();
      const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => as(i, () => K.c.replaceCredential({ credentialId: id, username: `replacement.${i}`, reason: "USERNAME_CHANGED" }))));
      assert.equal(succeeded(results), 1);
      onlyDomainErrors(results);
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_credentials WHERE replaces_credential_id = $1`, [id]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1 AND record_status = 'active'`, [o]), 1);
    });

    scenario("11. a status change racing a correction and an archive leaves consistent history", async () => {
      const as = await concurrentActors(4);
      await fullStaff();
      const { o, id, view } = await fixture();
      const periodId = view.currentStatus!.id;
      const results = await Promise.allSettled([
        as(0, () => K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED", effectiveFrom: MONTH(3) })),
        as(1, () => K.c.correctCredentialStatus({ periodId, status: "DISABLED" })),
        as(2, () => K.c.archiveCredential({ credentialId: id })),
        as(3, () => K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN", verifiedAt: MONTH(2) })),
      ]);
      onlyDomainErrors(results);
      assert.ok(succeeded(results) >= 1);
      const periods = await rowCount(`SELECT count(*) FROM public.credential_status_periods WHERE credential_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]);
      assert.equal(periods, 1, "exactly one genuine current period");
      const read = (await K.c.getOrganizationCredentials(o)).credentials[0];
      assert.ok(read.currentStatus);
    });
  });

  // =============================================================================================================
  describe("Master Register and atomicity", () => {
    scenario("events carry only table:id references and codes: never usernames, names, aliases, URLs or secret references", async () => {
      const actor = await fullStaff();
      const o = await org();
      const t = token();
      const username = `hygiene.user.${t}@example.com`;
      const reference = `projects/hygiene-project-123/secrets/hyg-secret-${t}`;
      const url = `https://hygiene-${t}.example.com/login`;
      const system = await K.c.createSystem({ name: `${t} Hygiene Portal`, aliases: [`${t} Hygiene Alias`], loginUrl: url });
      await K.c.updateSystem({ systemId: system.id, name: `${t} Hygiene Portal Two`, loginUrl: `https://hygiene2-${t}.example.com` });
      await K.c.addAlias({ systemId: system.id, alias: `${t} Second Alias` });
      await K.c.retireAlias({ aliasId: (await K.c.getSystem(system.id)).aliases[0].id });
      const cred = await mkCred(o, system.id, username);
      await K.c.updateCredentialMetadata({ credentialId: cred.credential.id, category: "FUEL", mfaMethod: "SMS" });
      await K.c.changeCredentialStatus({ credentialId: cred.credential.id, status: "LOCKED", effectiveFrom: MONTH(3) });
      await K.c.correctCredentialStatus({ periodId: (await K.c.getOrganizationCredentials(o)).credentials[0].currentStatus!.id, status: "DISABLED" });
      const verified = await K.c.recordVerification({ credentialId: cred.credential.id, outcome: "VERIFIED", method: "MANUAL_LOGIN", verifiedAt: MONTH(4) });
      await K.c.voidVerification({ verificationId: verified.verifications[0].id });
      await K.c.attachSecretReference({ slotId: cred.slots[0].id, secretReference: reference });
      await K.c.addSecretSlot({ credentialId: cred.credential.id, slotKind: "MFA_SECRET" });
      await K.c.retireSecretSlot({ slotId: cred.slots[0].id });
      const replaced = await K.c.replaceCredential({ credentialId: cred.credential.id, username: `${username}.new`, reason: "USERNAME_CHANGED" });
      await K.c.archiveCredential({ credentialId: replaced.credential.id });
      await K.c.restoreCredential({ credentialId: replaced.credential.id });
      await K.c.archiveSystem({ systemId: system.id });
      await K.c.restoreSystem({ systemId: system.id });

      const json = await eventsJson(actor.actorId);
      for (const forbidden of [username, username.toUpperCase(), t, "Hygiene", "hygiene", reference, "hyg-secret", url, "example.com", "projects/", "GCP_SECRET_MANAGER", "https://"]) {
        assert.equal(json.includes(forbidden), false, `the register must not contain ${forbidden}`);
      }
      const recorded = await events(actor.actorId);
      const known = new Set(["RECORD_CREATED", "RECORD_UPDATED", "RECORD_CORRECTED", "RECORD_STATUS_CHANGED", "RECORD_ARCHIVED", "RECORD_RESTORED"]);
      for (const row of recorded) assert.ok(known.has(row.event_type), row.event_type);
      assert.deepEqual([...new Set(recorded.map((row) => row.resource_type))].sort(), ["company_credential", "credential_secret_slot", "credential_status_period", "credential_system", "credential_system_alias", "credential_verification"]);
      for (const row of recorded) {
        if (row.resource_type === "credential_system" || row.resource_type === "credential_system_alias") assert.deepEqual(row.subjects, []);
        else assert.deepEqual(row.subjects, [`organization:${o}`], row.resource_type ?? "");
      }
      // every change value in every event is a reference, a code or CHANGED / null
      const changes = (await pools.admin.query<{ change_set: { fieldChanges?: Array<{ before?: { kind: string; value?: unknown; reference?: string }; after?: { kind: string; value?: unknown; reference?: string } }> } }>(
        `SELECT change_set FROM public.master_register_events WHERE actor_id = $1::uuid`, [actor.actorId],
      )).rows;
      for (const row of changes) {
        for (const change of row.change_set.fieldChanges ?? []) {
          for (const side of [change.before, change.after]) {
            if (!side) continue;
            assert.ok(["LITERAL", "REFERENCE", "CHANGED"].includes(side.kind), side.kind);
            if (side.kind === "REFERENCE") assert.match(side.reference!, /^[a-z_]+:[0-9a-f-]{36}$/);
            if (side.kind === "LITERAL" && side.value !== null) assert.match(String(side.value), /^[A-Za-z_]+$/, "literals are codes and lifecycle words only");
          }
        }
      }
      // reads and refused calls write nothing
      const count = recorded.length;
      await K.c.getOrganizationCredentials(o);
      await K.c.listSystems();
      await K.c.getSystem(system.id);
      await assert.rejects(K.c.changeCredentialStatus({ credentialId: replaced.credential.id, status: replaced.currentStatus!.status }));
      await assert.rejects(mkCred(o, system.id, `${username}.new`));
      assert.equal((await events(actor.actorId)).length, count);
    });

    scenario("a Master Register failure rolls the whole mutation back", async () => {
      const actor = await fullStaff();
      const o = await org();
      const t = token();
      await refuseMasterRegisterEvent("RECORD_CREATED");
      await assert.rejects(K.c.createSystem({ name: `${t} Doomed`, aliases: [`${t} Doomed Alias`] }), /master register write refused/);
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_systems WHERE display_name_normalized LIKE $1`, [`${t}%`]), 0);
      await allowMasterRegister();
      const system = await mkSystem();
      await refuseMasterRegisterEvent("RECORD_CREATED");
      await assert.rejects(mkCred(o, system.id, "doomed"), /master register write refused/);
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1`, [o]), 0, "no credential");
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_status_periods p JOIN public.company_credentials c ON c.id = p.credential_id WHERE c.organization_id = $1`, [o]), 0, "no status period");
      await allowMasterRegister();

      const view = await mkCred(o, system.id, "kept");
      const id = view.credential.id;
      const before = (await events(actor.actorId)).length;
      const periodId = view.currentStatus!.id;
      const slotId = view.slots[0].id;
      const cases: Array<[string, () => Promise<unknown>]> = [
        ["RECORD_STATUS_CHANGED", () => K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED", effectiveFrom: MONTH(3) })],
        ["RECORD_CORRECTED", () => K.c.correctCredentialStatus({ periodId, status: "DISABLED" })],
        ["RECORD_CREATED", () => K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN", verifiedAt: MONTH(2) })],
        ["RECORD_UPDATED", () => K.c.attachSecretReference({ slotId, secretReference: "projects/tes-production-510007/secrets/abc" })],
        ["RECORD_UPDATED", () => K.c.updateCredentialMetadata({ credentialId: id, category: "FUEL" })],
        ["RECORD_ARCHIVED", () => K.c.replaceCredential({ credentialId: id, username: "replaced", reason: "USERNAME_CHANGED" })],
        ["RECORD_ARCHIVED", () => K.c.archiveCredential({ credentialId: id })],
        ["RECORD_ARCHIVED", () => K.c.archiveSystem({ systemId: system.id })],
      ];
      for (const [eventType, work] of cases) {
        await refuseMasterRegisterEvent(eventType);
        await assert.rejects(work(), /master register write refused/, eventType);
        await allowMasterRegister();
      }
      const read = (await K.c.getOrganizationCredentials(o)).credentials;
      assert.equal(read.length, 1, "the failed replacement left no new credential");
      assert.equal(read[0].credential.recordStatus, "active");
      assert.equal(read[0].credential.category, "FLEET");
      assert.equal(read[0].statusHistory.length, 1);
      assert.equal(read[0].currentStatus?.status, "ACTIVE");
      assert.deepEqual(read[0].verifications, []);
      assert.equal(read[0].slots[0].secretState, "UNRESOLVED");
      assert.equal((await K.c.getSystem(system.id)).recordStatus, "active");
      assert.equal((await events(actor.actorId)).length, before, "no event survived a rollback");
    });

    scenario("a failure in the MIDDLE of an operation rolls everything back", async () => {
      const actor = await fullStaff();
      const o = await org();
      const system = await mkSystem();
      const before = (await events(actor.actorId)).length;
      let restore = await failInsertsInto("credential_secret_slots");
      cleanups.push(restore);
      await assert.rejects(mkCred(o, system.id, "midway"), /insert refused/);
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1`, [o]), 0, "the credential and its status period were rolled back");
      assert.equal((await events(actor.actorId)).length, before);
      await restore();

      const view = await mkCred(o, system.id, "original", { passwordSlot: false });
      restore = await failInsertsInto("credential_status_periods");
      cleanups.push(restore);
      await assert.rejects(K.c.replaceCredential({ credentialId: view.credential.id, username: "replacement", reason: "USERNAME_CHANGED" }), /insert refused/);
      await assert.rejects(K.c.changeCredentialStatus({ credentialId: view.credential.id, status: "LOCKED", effectiveFrom: MONTH(3) }), /insert refused/);
      await restore();
      const read = (await K.c.getOrganizationCredentials(o)).credentials;
      assert.equal(read.length, 1);
      assert.equal(read[0].credential.recordStatus, "active", "the old credential was not archived by the failed replacement");
      assert.equal(read[0].statusHistory.length, 1);
      assert.equal(read[0].statusHistory[0].effectiveTo, null, "the failed change did not end the current period");

      restore = await failInsertsInto("credential_system_aliases");
      cleanups.push(restore);
      const t = token();
      await assert.rejects(K.c.createSystem({ name: `${t} Midway`, aliases: [`${t} Midway Alias`] }), /insert refused/);
      await restore();
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_systems WHERE display_name_normalized LIKE $1`, [`${t}%`]), 0, "the system was rolled back with its failed alias");
    });
  });

  // =============================================================================================================
  describe("authorization", () => {
    scenario("no session, no capability and the wrong capability are denied and change nothing", async () => {
      await fullStaff();
      const { o, system, id, passwordSlot } = await fixture();
      const before = await rowCount(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1`, [o]);

      K.db.setClerkUser(null);
      await assert.rejects(K.c.getOrganizationCredentials(o));
      await assert.rejects(K.c.listSystems());
      await assert.rejects(K.c.createSystem({ name: `${token()} Nobody` }));

      const reads: Array<() => Promise<unknown>> = [() => K.c.listSystems(), () => K.c.getSystem(system.id), () => K.c.getOrganizationCredentials(o)];
      const writes: Array<() => Promise<unknown>> = [
        () => K.c.createSystem({ name: `${token()} Denied` }),
        () => mkCred(o, system.id, `denied.${token()}`),
        () => K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED" }),
        () => K.c.recordVerification({ credentialId: id, outcome: "VERIFIED", method: "MANUAL_LOGIN" }),
        () => K.c.attachSecretReference({ slotId: passwordSlot.id, secretReference: "projects/tes-production-510007/secrets/abc" }),
        () => K.c.archiveCredential({ credentialId: id }),
      ];
      // an actor with no credential capability
      signIn(await staff());
      for (const call of [...reads, ...writes]) await denied(call());
      // other Companies capabilities authorize nothing here
      signIn(await fx.actor().then(async (actor) => {
        const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
        const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
        for (const code of ["ORGANIZATION_READ", "ORGANIZATION_UPDATE", "CUSTOMER_RELATIONSHIP_MANAGE", "CONTACT_MANAGE"]) await fx.grant(relationshipId, code, { assignmentId });
        return actor;
      }));
      for (const call of [...reads, ...writes]) await denied(call());

      // READ alone: every read works, no mutation does
      signIn(await staff("CREDENTIAL_READ"));
      assert.ok((await K.c.listSystems()).length > 0);
      assert.equal((await K.c.getSystem(system.id)).id, system.id);
      assert.equal((await K.c.getOrganizationCredentials(o)).credentials.length, 1);
      for (const call of writes) await denied(call());
      for (const name of MUTATIONS) await denied((K.c[name] as (input: unknown) => Promise<unknown>)({}));

      // MANAGE alone: no read works, and every mutation passes authorization (an empty input is then a VALIDATION error, not a denial)
      signIn(await staff("CREDENTIAL_MANAGE"));
      for (const call of reads) await denied(call());
      for (const name of MUTATIONS) await invalid((K.c[name] as (input: unknown) => Promise<unknown>)({}));
      const made = await K.c.createSystem({ name: `${token()} ManageOnly` });
      assert.equal(made.recordStatus, "active");

      signIn(await staff());
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1`, [o]), before, "a denied call changed nothing");
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_status_periods WHERE credential_id = $1`, [id]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_verifications WHERE credential_id = $1`, [id]), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_secret_slots WHERE id = $1 AND secret_state = 'UNRESOLVED'`, [passwordSlot.id]), 1);
    });

    scenario("a customer actor reaches nothing: not even with credential capabilities granted at CUSTOMER scope", async () => {
      await fullStaff();
      const { o, system, id } = await fixture();
      const customer = await fx.organizationAndCustomer("CustA");
      const user = await fx.actor();
      const relationshipId = await fx.relationship(user.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customer.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      signIn(user);
      await denied(K.c.getOrganizationCredentials(customer.organizationId));
      await denied(K.c.getOrganizationCredentials(o));
      await denied(K.c.listSystems());
      await denied(K.c.getSystem(system.id));
      await denied(mkCred(customer.organizationId, system.id, "x"));
      await denied(K.c.changeCredentialStatus({ credentialId: id, status: "LOCKED" }));

      // the capabilities are SYSTEM-scoped: a CUSTOMER-scope grant of them does not authorize SYSTEM work
      const second = await fx.actor();
      const secondRelationship = await fx.relationship(second.actorId, "CUSTOMER_USER");
      const secondAssignment = await fx.assignment(secondRelationship, { type: "CUSTOMER", customerId: customer.customerId });
      for (const code of BOTH) await fx.grant(secondRelationship, code, { assignmentId: secondAssignment }).catch(() => undefined);
      signIn(second);
      await denied(K.c.getOrganizationCredentials(o));
      await denied(K.c.createSystem({ name: `${token()} Customer` }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.credential_systems WHERE display_name_normalized LIKE 'tcx${run}%' AND provider_organization_id = $1`, [customer.organizationId]), 0);
    });

    scenario("the service exposes exactly the designed functions: no reveal, delete, export, merge or customer-scope function", async () => {
      const exported = Object.keys(K.c).filter((key) => typeof (K.c as Record<string, unknown>)[key] === "function" && !/Error$/.test(key) && !/^(is|normalize|parse)[A-Z]/.test(key));
      assert.deepEqual(exported.sort(), [...READS, ...MUTATIONS].sort());
      assert.deepEqual(Object.keys(K.c).filter((key) => /delete|remove|destroy|merge|reveal|decrypt|export|withAuthorizedCustomer|customerContext|secretValue|getSecret/i.test(key)), []);
    });
  });
});
