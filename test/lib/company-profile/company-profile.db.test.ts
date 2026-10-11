// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL Company Operating Profile service through the REAL authorization wrappers and Clerk-to-actor
// resolution, on pooled connections that log in as the RUNTIME role, against a database with migrations 0001-0019 applied.

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
    caps: await import("@/lib/auth/tes-capabilities"),
    p: await import("@/lib/company-profile/service"),
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
const BUSINESS_TABLES = ["company_operating_scope_periods", "company_rule_applicability_periods", "company_driver_requirement_periods"] as const;
const ALL_TABLES = ["company_profile_rules", ...BUSINESS_TABLES] as const;
const REGISTRATION_TABLES = ["registration_status_periods", "registration_versions", "registrations"] as const;
type Capability = "COMPANY_PROFILE_READ" | "COMPANY_PROFILE_MANAGE";
const ALL_CAPABILITIES: Capability[] = ["COMPANY_PROFILE_READ", "COMPANY_PROFILE_MANAGE"];

describe("Company Operating Profile (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
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

  const run = randomUUID().slice(0, 8).toUpperCase();
  let counter = 0;
  const n = () => ++counter;

  /** Removes everything this scenario created. The no-delete triggers are lifted only here, by the table owner. */
  async function purge() {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const table of BUSINESS_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${table}_no_delete`);
      for (const table of REGISTRATION_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`);
      for (const table of BUSINESS_TABLES) await client.query(`DELETE FROM public.${table} WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.registration_status_periods WHERE registration_id IN (SELECT id FROM public.registrations WHERE organization_id = ANY($1::uuid[]))`, [organizations]);
      await client.query(`DELETE FROM public.registration_versions WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.registrations WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const table of REGISTRATION_TABLES) await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`);
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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `CP ${label} ${id.slice(0, 8)} ${n()}`]);
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
  const tomorrow = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  const setScope = (organizationId: string, operatingScope: string, effectiveFrom?: string) => K.p.setOperatingScope({ organizationId, operatingScope, ...(effectiveFrom ? { effectiveFrom } : {}) });
  const setRule = (organizationId: string, ruleCode: string, applicability: string, effectiveFrom?: string) =>
    K.p.setRuleApplicability({ organizationId, ruleCode, applicability, ...(effectiveFrom ? { effectiveFrom } : {}) });
  const setDrivers = (organizationId: string, minimumDriverAgeYears: number, minimumDriverExperienceMonths: number, effectiveFrom?: string) =>
    K.p.setDriverRequirements({ organizationId, minimumDriverAgeYears, minimumDriverExperienceMonths, ...(effectiveFrom ? { effectiveFrom } : {}) });
  type View = Awaited<ReturnType<typeof K.p.getCompanyProfile>>;
  const entry = (view: View, code: string) => view.rules.find((candidate) => candidate.rule.code === code)!;

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const invalid = (promise: Promise<unknown>) => rejectsWith(promise, K.p.CompanyProfileValidationError);
  const conflict = (promise: Promise<unknown>) => rejectsWith(promise, K.p.CompanyProfileConflictError);
  const stateError = (promise: Promise<unknown>) => rejectsWith(promise, K.p.CompanyProfileStateError);
  const notFound = (promise: Promise<unknown>) => rejectsWith(promise, K.p.CompanyProfileNotFoundError);
  const denied = (promise: Promise<unknown>) => rejectsWith(promise, K.authz.TesAuthorizationDeniedError);
  const rowCount = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const counts = async (organizationId: string) => ({
    scope: await rowCount(`SELECT count(*) FROM public.company_operating_scope_periods WHERE organization_id = $1`, [organizationId]),
    rule: await rowCount(`SELECT count(*) FROM public.company_rule_applicability_periods WHERE organization_id = $1`, [organizationId]),
    driver: await rowCount(`SELECT count(*) FROM public.company_driver_requirement_periods WHERE organization_id = $1`, [organizationId]),
    open: await rowCount(
      `SELECT (SELECT count(*) FROM public.company_operating_scope_periods WHERE organization_id = $1 AND effective_to IS NULL AND record_status = 'active')
            + (SELECT count(*) FROM public.company_rule_applicability_periods WHERE organization_id = $1 AND effective_to IS NULL AND record_status = 'active')
            + (SELECT count(*) FROM public.company_driver_requirement_periods WHERE organization_id = $1 AND effective_to IS NULL AND record_status = 'active') AS count`,
      [organizationId],
    ),
  });
  // Events can share a recorded_at (same instant); break such ties by type so the order is deterministic.
  const eventTypes = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`, [actorId])).rows.map((row) => row.event_type);
  const events = async (actorId: string) =>
    (await pools.admin.query<Record<string, unknown>>(`SELECT * FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`, [actorId])).rows;
  const eventsJson = async (actorId: string) => JSON.stringify(await events(actorId));

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

  /** Makes every INSERT into the given table fail, AFTER the earlier statements of the operation already ran. */
  async function failInsertsInto(table: string) {
    await pools.admin.query(`
      CREATE OR REPLACE FUNCTION public.tes_test_fail_profile_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test: profile insert refused'; END $$`);
    await pools.admin.query(`CREATE TRIGGER tes_test_fail_profile_insert BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_profile_insert()`);
    cleanups.push(async function removeInsertRefusal() {
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_profile_insert ON public.${table}`);
      await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_profile_insert()`);
    });
    return () => pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_profile_insert ON public.${table}`);
  }

  async function setOrganizationStatus(organizationId: string, status: "active" | "archived" | "merged", mergedInto?: string) {
    await pools.admin.query(
      `UPDATE public.organizations SET status = $2, archived_at = CASE WHEN $2 = 'archived' THEN now() ELSE NULL END, merged_into_organization_id = $3 WHERE id = $1`,
      [organizationId, status, status === "merged" ? mergedInto : null],
    );
  }

  /** A registration (0016 fixture, written by the table owner) with an optional status and archive flag. */
  async function registration(organizationId: string, programCode: string, status = "ACTIVE", options: { archived?: boolean } = {}): Promise<{ id: string; number: string }> {
    const program = (await pools.admin.query<{ jurisdiction_scope: string; issuer_country: string | null; fixed_region: string | null }>(`SELECT jurisdiction_scope, issuer_country, fixed_region FROM public.registration_programs WHERE code = $1`, [programCode])).rows[0];
    const country = program.jurisdiction_scope === "GLOBAL" ? null : (program.issuer_country ?? "US");
    const region = program.jurisdiction_scope === "COUNTRY_REGION" ? (program.fixed_region ?? "TX") : program.jurisdiction_scope === "BASE_JURISDICTION" ? "TX" : null;
    const id = randomUUID();
    const number = `T${run}${n()}`;
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO public.registrations (id, organization_id, program_code) VALUES ($1, $2, $3)`, [id, organizationId, programCode]);
      await client.query(
        `INSERT INTO public.registration_versions (registration_id, organization_id, program_code, number_display, number_normalized, normalization_rule_version, jurisdiction_country, jurisdiction_region, version_reason, effective_from)
         VALUES ($1, $2, $3, $4, $4, 'test.v1', $5, $6, 'INITIAL', '2020-01-01T00:00:00Z')`,
        [id, organizationId, programCode, number, country, region],
      );
      await client.query(`INSERT INTO public.registration_status_periods (registration_id, registration_status, period_reason, effective_from) VALUES ($1, $2, 'INITIAL', '2020-01-01T00:00:00Z')`, [id, status]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (options.archived) await pools.admin.query(`UPDATE public.registrations SET record_status = 'archived', archived_at = now() WHERE id = $1`, [id]);
    return { id, number };
  }

  /** Runs statements in their own transaction as the table owner and returns the COMMIT outcome (deferred triggers fire at commit). */
  async function ownerTransaction(statements: Array<[string, unknown[]?]>): Promise<{ error?: Error & { code?: string; constraint?: string } }> {
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
  const hasColumnPrivilege = async (table: string, column: string, privilege: string, role = RUNTIME_ROLE) =>
    (await pools.admin.query<{ ok: boolean }>(`SELECT has_column_privilege($1, $2::regclass, $3, $4) AS ok`, [role, `public.${table}`, column, privilege])).rows[0].ok;
  const hasTablePrivilege = async (table: string, privilege: string, role = RUNTIME_ROLE) =>
    (await pools.admin.query<{ ok: boolean }>(`SELECT has_table_privilege($1, $2::regclass, $3) AS ok`, [role, `public.${table}`, privilege])).rows[0].ok;

  // =============================================================================================================
  describe("schema (migration 0019)", () => {
    scenario("tables, seeds, indexes and triggers exist; the ledger records 0019; nothing else was added", async () => {
      assert.deepEqual(
        (await pools.admin.query<{ n: string }>(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY 1`, [[...ALL_TABLES]])).rows.map((row) => row.n),
        [...ALL_TABLES].sort(),
      );
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_profile_rules`), 45);
      for (const index of ["company_operating_scope_periods_current_uq", "company_rule_applicability_periods_current_uq", "company_driver_requirement_periods_current_uq", "company_profile_rules_program_uq"]) {
        assert.equal(await rowCount(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [index]), 1, index);
      }
      for (const table of BUSINESS_TABLES) {
        for (const suffix of ["no_delete", "no_truncate", "guard_active_organization"]) {
          assert.equal(await rowCount(`SELECT count(*) FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2 AND NOT tgisinternal`, [`public.${table}`, `${table}_${suffix}`]), 1, `${table} ${suffix}`);
        }
      }
      assert.equal(await rowCount(`SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.company_rule_applicability_periods'::regclass AND tgname = 'company_rule_applicability_periods_guard_insert'`), 1);
      const ledger = await pools.admin.query<{ sha256: string }>(`SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0019'`);
      const sql = readFileSync(path.join(process.cwd(), "database/migrations/0019_company_operating_profile_foundation.sql"));
      assert.equal(ledger.rows[0]?.sha256, createHash("sha256").update(sql).digest("hex"));
    });

    scenario("out of scope is ABSENT: no key/value table, no preference columns, no mirrored Organization/Location/Authority/Registration/Insurance/Credential fields", async () => {
      const columns = async (table: string) => (await pools.admin.query<{ c: string }>(`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])).rows.map((row) => row.c);
      const lifecycle = ["id", "organization_id"];
      const tail = ["effective_from", "effective_to", "record_status", "corrected_at", "superseded_by_period_id", "created_at", "updated_at"];
      assert.deepEqual(await columns("company_operating_scope_periods"), [...lifecycle, "operating_scope", ...tail]);
      assert.deepEqual(await columns("company_rule_applicability_periods"), [...lifecycle, "rule_code", "applicability", ...tail]);
      assert.deepEqual(await columns("company_driver_requirement_periods"), [...lifecycle, "minimum_driver_age_years", "minimum_driver_experience_months", ...tail]);
      assert.deepEqual(await columns("company_profile_rules"), ["code", "section", "display_name", "applies_to_region", "default_applicability", "registration_program_code", "is_active", "sort_order", "created_at", "updated_at"]);
      // no json / hstore / free-text value column on any of the four tables
      assert.equal(
        await rowCount(`SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[]) AND data_type IN ('json', 'jsonb', 'USER-DEFINED', 'ARRAY')`, [[...ALL_TABLES]]),
        0,
      );
      assert.equal(await rowCount(`SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[]) AND column_name ~* '(preference|theme|layout|setting|^key$|^value$|note|comment)'`, [[...ALL_TABLES]]), 0);
    });

    scenario("the TypeScript vocabulary agrees with the catalogue rows and CHECK constraints (drift)", async () => {
      const defs = await import("@/lib/company-profile/definitions");
      const rows = (await pools.admin.query<Record<string, unknown>>(`SELECT code, section, display_name, applies_to_region, default_applicability, registration_program_code, is_active, sort_order FROM public.company_profile_rules ORDER BY sort_order`)).rows;
      assert.equal(rows.length, defs.RULE_DEFINITIONS.length);
      assert.deepEqual(
        rows.map((row) => ({ code: row.code, section: row.section, displayName: row.display_name, appliesToRegion: row.applies_to_region, defaultApplicability: row.default_applicability, registrationProgramCode: row.registration_program_code })),
        defs.RULE_DEFINITIONS.map((rule) => ({ ...rule })),
      );
      assert.deepEqual(rows.map((row) => row.code), [...defs.RULE_CODES]);
      for (const row of rows) assert.equal(row.is_active, true, String(row.code));
      assert.equal(new Set(rows.map((row) => row.sort_order)).size, 45);
      // every mapped program exists in the 0016 catalogue
      for (const rule of defs.RULE_DEFINITIONS.filter((candidate) => candidate.registrationProgramCode !== null)) {
        assert.equal(await rowCount(`SELECT count(*) FROM public.registration_programs WHERE code = $1`, [rule.registrationProgramCode]), 1, String(rule.registrationProgramCode));
      }
      // the vocabulary lists are the CHECK constraints' literals, in order
      const literals = async (constraint: string) => {
        const definition = (await pools.admin.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`, [constraint])).rows[0].def;
        return [...definition.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
      };
      assert.deepEqual(await literals("company_operating_scope_periods_scope_valid"), [...defs.OPERATING_SCOPES]);
      assert.deepEqual(await literals("company_rule_applicability_periods_applicability_valid"), [...defs.APPLICABILITIES]);
      assert.deepEqual(await literals("company_profile_rules_section_valid"), [...defs.RULE_SECTIONS]);
      assert.deepEqual(await literals("company_profile_rules_region_valid"), [...defs.REGIONS]);
      const bounds = async (constraint: string) => [...(await pools.admin.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`, [constraint])).rows[0].def.matchAll(/>= (\d+)\) AND \(\w+ <= (\d+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
      assert.deepEqual(await bounds("company_driver_requirement_periods_age_valid"), [[defs.DRIVER_AGE_YEARS.min, defs.DRIVER_AGE_YEARS.max]]);
      assert.deepEqual(await bounds("company_driver_requirement_periods_experience_valid"), [[defs.DRIVER_EXPERIENCE_MONTHS.min, defs.DRIVER_EXPERIENCE_MONTHS.max]]);
    });

    scenario("capabilities: exactly two SYSTEM-only catalogue rows exist and are granted to nobody", async () => {
      const rows = (await pools.admin.query<{ code: string; description: string; is_active: boolean; sort_order: number }>(
        `SELECT code, description, is_active, sort_order FROM public.capabilities WHERE code LIKE 'COMPANY_PROFILE\\_%' ORDER BY sort_order`,
      )).rows;
      assert.deepEqual(rows.map((row) => row.code), ["COMPANY_PROFILE_READ", "COMPANY_PROFILE_MANAGE"]);
      for (const row of rows) {
        assert.match(row.description, /Intended scope: SYSTEM only\.$/, row.code);
        assert.equal(row.is_active, true, row.code);
      }
      assert.equal(await rowCount(`SELECT count(*) FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id WHERE c.code LIKE 'COMPANY_PROFILE\\_%' AND g.created_at < now() - interval '1 day'`), 0);
      assert.equal(K.caps.TES_CAPABILITY_SCOPES.COMPANY_PROFILE_READ, "SYSTEM");
      assert.equal(K.caps.TES_CAPABILITY_SCOPES.COMPANY_PROFILE_MANAGE, "SYSTEM");
    });

    scenario("no SECURITY DEFINER, no RLS, no policy; every new function is invoker with a fixed search_path and no PUBLIC execute", async () => {
      const names = ["prevent_company_profile_data_removal", "guard_company_rule_applicability_insert", "guard_company_operating_scope_update", "guard_company_rule_applicability_update", "guard_company_driver_requirement_update"];
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
      for (const table of ALL_TABLES) assert.equal((await pools.admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${table}`])).rows[0].relrowsecurity, false, table);
      assert.equal(await rowCount(`SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])`, [[...ALL_TABLES]]), 0);
    });

    scenario("runtime privileges: SELECT, column-specific INSERT/UPDATE, no DELETE, TRUNCATE, REFERENCES or TRIGGER, nothing for PUBLIC; the catalogue is read-only", async () => {
      for (const table of ALL_TABLES) {
        for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) assert.equal(await hasTablePrivilege(table, privilege), false, `${table} ${privilege}`);
        assert.equal(await hasTablePrivilege(table, "SELECT"), true, table);
        assert.equal(await rowCount(`SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'PUBLIC'`, [table]), 0, `PUBLIC on ${table}`);
        await assert.rejects(pools.runtime.query(`DELETE FROM public.${table}`), /permission denied/, table);
        await assert.rejects(pools.runtime.query(`TRUNCATE public.${table}`), /permission denied/, table);
      }
      for (const privilege of ["INSERT", "UPDATE"]) assert.equal(await hasTablePrivilege("company_profile_rules", privilege), false, `catalogue ${privilege}`);
      await assert.rejects(pools.runtime.query(`UPDATE public.company_profile_rules SET is_active = false WHERE code = 'DG_US'`), /permission denied/);
      await assert.rejects(pools.runtime.query(`INSERT INTO public.company_profile_rules (code, section, display_name, applies_to_region, sort_order) VALUES ('RUNTIME_RULE', 'CARGO', 'x', 'BOTH', 99999)`), /permission denied/);
      const content: Array<[string, string[], string[]]> = [
        ["company_operating_scope_periods", ["id", "organization_id", "operating_scope", "effective_from"], ["operating_scope", "organization_id", "id", "effective_from", "created_at"]],
        ["company_rule_applicability_periods", ["id", "organization_id", "rule_code", "applicability", "effective_from"], ["rule_code", "applicability", "organization_id", "id", "effective_from", "created_at"]],
        ["company_driver_requirement_periods", ["id", "organization_id", "minimum_driver_age_years", "minimum_driver_experience_months", "effective_from"], ["minimum_driver_age_years", "minimum_driver_experience_months", "organization_id", "id", "effective_from", "created_at"]],
      ];
      for (const [table, insertable, immutable] of content) {
        for (const column of insertable) assert.equal(await hasColumnPrivilege(table, column, "INSERT"), true, `${table}.${column} INSERT`);
        for (const column of ["record_status", "corrected_at", "superseded_by_period_id", "created_at", "updated_at"]) assert.equal(await hasColumnPrivilege(table, column, "INSERT"), false, `${table}.${column} INSERT`);
        for (const column of immutable) assert.equal(await hasColumnPrivilege(table, column, "UPDATE"), false, `${table}.${column} is immutable`);
        for (const column of ["effective_to", "record_status", "corrected_at", "superseded_by_period_id", "updated_at"]) assert.equal(await hasColumnPrivilege(table, column, "UPDATE"), true, `${table}.${column} UPDATE`);
      }
    });
  });

  // =============================================================================================================
  describe("corrected periods are frozen (owner level)", () => {
    scenario("a corrected rule applicability period cannot be re-pointed or re-dated", async () => {
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        const [orgId, p1, p2, p3] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        await client.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, 'Frozen', 'frozen')`, [orgId]);
        const period = `INSERT INTO public.company_rule_applicability_periods (id, organization_id, rule_code, applicability, effective_from, record_status, corrected_at, superseded_by_period_id) VALUES ($1, $2, 'IFTA', 'APPLIES', now(), $3, $4, $5)`;
        await client.query(period, [p1, orgId, "corrected", new Date(), p2]);
        await client.query(period, [p2, orgId, "corrected", new Date(), p3]);
        await client.query(period, [p3, orgId, "active", null, null]);
        await client.query("SAVEPOINT s");
        await assert.rejects(client.query(`UPDATE public.company_rule_applicability_periods SET superseded_by_period_id = $2 WHERE id = $1`, [p1, p3]), /corrected rule applicability period is frozen/);
        await client.query("ROLLBACK TO SAVEPOINT s");
        await client.query("SAVEPOINT s2");
        await assert.rejects(client.query(`UPDATE public.company_rule_applicability_periods SET effective_to = now() WHERE id = $1`, [p1]), /frozen/);
        await client.query("ROLLBACK TO SAVEPOINT s2");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
  });

  describe("database backstops (service bypassed)", () => {
    scenario("the table owner cannot violate vocabularies, windows, correction state, lifecycle or immutability", async () => {
      const o = await org();
      const archived = await org("Archived");
      await setOrganizationStatus(archived, "archived");
      const other = await org("Other");
      const fail = async (statements: Array<[string, unknown[]?]>, pattern: RegExp, label: string) => {
        const outcome = await ownerTransaction(statements);
        assert.ok(outcome.error, `${label}: expected a failure`);
        assert.match(outcome.error!.message, pattern, label);
        return outcome.error!;
      };
      const scope = (id: string, org_: string, value: string, from = MONTH(1), to: string | null = null) =>
        [`INSERT INTO public.company_operating_scope_periods (id, organization_id, operating_scope, effective_from, effective_to) VALUES ($1, $2, $3, $4, $5)`, [id, org_, value, from, to]] as [string, unknown[]];
      const rulePeriod = (id: string, org_: string, rule: string, value: string, from = MONTH(1), to: string | null = null) =>
        [`INSERT INTO public.company_rule_applicability_periods (id, organization_id, rule_code, applicability, effective_from, effective_to) VALUES ($1, $2, $3, $4, $5, $6)`, [id, org_, rule, value, from, to]] as [string, unknown[]];
      const driver = (id: string, org_: string, age: number, months: number, from = MONTH(1)) =>
        [`INSERT INTO public.company_driver_requirement_periods (id, organization_id, minimum_driver_age_years, minimum_driver_experience_months, effective_from) VALUES ($1, $2, $3, $4, $5)`, [id, org_, age, months, from]] as [string, unknown[]];

      // vocabularies and ranges
      await fail([scope(randomUUID(), o, "MEXICO")], /scope_valid/, "unknown scope");
      await fail([scope(randomUUID(), o, "BOTH")], /scope_valid/, "legacy 'both' is not a scope");
      await fail([rulePeriod(randomUUID(), o, "DG_US", "NOT_CONFIGURED")], /applicability_valid/, "not-configured is not a stored value");
      await fail([rulePeriod(randomUUID(), o, "DG_US", "applies")], /applicability_valid/, "lower-case applicability");
      for (const [age, months, constraint] of [[15, 24, "age_valid"], [101, 24, "age_valid"], [21, -1, "experience_valid"], [21, 601, "experience_valid"]] as const) {
        await fail([driver(randomUUID(), o, age, months)], new RegExp(constraint), `driver ${age}/${months}`);
      }
      await fail([scope(randomUUID(), o, "CANADA", MONTH(3), MONTH(3))], /effective_window_valid/, "empty window");
      await fail([scope(randomUUID(), o, "CANADA", MONTH(3), MONTH(2))], /effective_window_valid/, "inverted window");
      // the rule must be a catalogued, active rule
      await fail([rulePeriod(randomUUID(), o, "NOT_A_RULE", "APPLIES")], /not an active company profile rule/, "unknown rule (the insert guard fires before the foreign key)");
      await pools.admin.query(`UPDATE public.company_profile_rules SET is_active = false WHERE code = 'DG_IDAHO'`);
      cleanups.push(async () => void (await pools.admin.query(`UPDATE public.company_profile_rules SET is_active = true WHERE code = 'DG_IDAHO'`)));
      const inactive = await fail([rulePeriod(randomUUID(), o, "DG_IDAHO", "APPLIES")], /not an active company profile rule/, "inactive rule");
      assert.equal(inactive.constraint, "company_rule_applicability_periods_rule_active");
      // an archived Organization gains nothing, for all three facts
      for (const [label, statement] of [["scope", scope(randomUUID(), archived, "CANADA")], ["rule", rulePeriod(randomUUID(), archived, "DG_US", "APPLIES")], ["driver", driver(randomUUID(), archived, 21, 24)]] as const) {
        const error = await fail([statement], /is not active/, `archived organization ${label}`);
        assert.equal(error.constraint, "organization_must_be_active");
      }
      // correction state is all-or-nothing, and a row cannot be superseded by itself or by a row of another Organization
      const id = randomUUID();
      await fail([scope(id, o, "CANADA"), [`UPDATE public.company_operating_scope_periods SET record_status = 'corrected' WHERE id = $1`, [id]]], /correction_state_consistent/, "corrected without pointer");
      await fail([scope(id, o, "CANADA"), [`UPDATE public.company_operating_scope_periods SET record_status = 'corrected', corrected_at = now(), superseded_by_period_id = id WHERE id = $1`, [id]]], /not_superseded_by_self/, "superseded by itself");
      const foreign = randomUUID();
      await fail(
        [scope(id, o, "CANADA"), scope(foreign, other, "UNITED_STATES"), [`UPDATE public.company_operating_scope_periods SET record_status = 'corrected', corrected_at = now(), superseded_by_period_id = $2 WHERE id = $1`, [id, foreign]]],
        /superseded_by_fk|foreign key/,
        "superseded by another Organization's row",
      );
      const ruleId = randomUUID();
      const otherRule = randomUUID();
      await fail(
        [rulePeriod(ruleId, o, "DG_US", "APPLIES"), rulePeriod(otherRule, o, "DG_CANADA", "APPLIES"), [`UPDATE public.company_rule_applicability_periods SET record_status = 'corrected', corrected_at = now(), superseded_by_period_id = $2 WHERE id = $1`, [ruleId, otherRule]]],
        /superseded_by_fk|foreign key/,
        "superseded by another rule's row",
      );
      // exactly one current period per fact (per rule), whatever the writer
      await fail([scope(randomUUID(), o, "CANADA"), scope(randomUUID(), o, "UNITED_STATES")], /current_uq|duplicate key/, "two current scopes");
      await fail([rulePeriod(randomUUID(), o, "DG_US", "APPLIES"), rulePeriod(randomUUID(), o, "DG_US", "DOES_NOT_APPLY")], /current_uq|duplicate key/, "two current assertions for one rule");
      await fail([driver(randomUUID(), o, 21, 24), driver(randomUUID(), o, 22, 25)], /current_uq|duplicate key/, "two current driver periods");
      assert.deepEqual((await ownerTransaction([rulePeriod(randomUUID(), o, "DG_US", "APPLIES"), rulePeriod(randomUUID(), o, "DG_CANADA", "APPLIES"), rulePeriod(randomUUID(), other, "DG_US", "APPLIES")])).error, undefined, "different rules / Organizations are independent");
      // immutability and freezing
      const a = randomUUID();
      const b = randomUUID();
      assert.equal((await ownerTransaction([scope(a, o, "CANADA", MONTH(1), MONTH(3)), scope(b, o, "UNITED_STATES", MONTH(3))])).error, undefined);
      await fail([[`UPDATE public.company_operating_scope_periods SET operating_scope = 'CANADA' WHERE id = $1`, [b]]], /content is immutable/, "scope content");
      await fail([[`UPDATE public.company_operating_scope_periods SET effective_from = $2 WHERE id = $1`, [b, MONTH(2)]]], /content is immutable/, "effective_from");
      await fail([[`UPDATE public.company_operating_scope_periods SET effective_to = $2 WHERE id = $1`, [a, MONTH(2)]]], /cannot be re-dated/, "ended period re-dated");
      await fail([[`UPDATE public.company_operating_scope_periods SET organization_id = $2 WHERE id = $1`, [b, other]]], /content is immutable/, "re-parenting");
      await fail([[`UPDATE public.company_rule_applicability_periods SET applicability = 'DOES_NOT_APPLY' WHERE organization_id = $1 AND rule_code = 'DG_US'`, [o]]], /content is immutable/, "applicability content");
      await fail([[`UPDATE public.company_rule_applicability_periods SET rule_code = 'DG_CANADA' WHERE organization_id = $1 AND rule_code = 'DG_US'`, [o]]], /content is immutable|current_uq/, "rule re-pointing");
      assert.equal((await ownerTransaction([driver(randomUUID(), o, 21, 24)])).error, undefined);
      await fail([[`UPDATE public.company_driver_requirement_periods SET minimum_driver_age_years = 30 WHERE organization_id = $1`, [o]]], /content is immutable/, "driver content");
      // a corrected period is frozen, and a correction never ends a period
      const wrong = randomUUID();
      const right = randomUUID();
      await fail(
        [scope(wrong, other, "CANADA", MONTH(5)), [`UPDATE public.company_operating_scope_periods SET record_status = 'corrected', corrected_at = now(), superseded_by_period_id = $2 WHERE id = $1`, [wrong, right]]],
        /superseded_by_fk|foreign key/,
        "pointer to a row that never appears",
      );
      await ownerTransaction([scope(wrong, other, "CANADA", MONTH(5), MONTH(7))]);
      const third = await org("Third");
      const openRow = randomUUID();
      await fail([scope(openRow, third, "CANADA", MONTH(5)), [`UPDATE public.company_operating_scope_periods SET record_status = 'corrected', corrected_at = now(), superseded_by_period_id = $2, effective_to = $3 WHERE id = $1`, [openRow, right, MONTH(6)]]], /does not end/, "a correction does not end");
      assert.equal(
        (await ownerTransaction([scope(right, other, "UNITED_STATES", MONTH(5), MONTH(7)), [`UPDATE public.company_operating_scope_periods SET record_status = 'corrected', corrected_at = now(), superseded_by_period_id = $2 WHERE id = $1`, [wrong, right]]])).error,
        undefined,
      );
      await fail([[`UPDATE public.company_operating_scope_periods SET updated_at = now() WHERE id = $1`, [wrong]]], /is frozen/, "a corrected period is frozen");
      // nothing can be deleted or truncated, even by the owner
      for (const table of BUSINESS_TABLES) {
        await fail([[`DELETE FROM public.${table}`]], /preserved/, `delete ${table}`);
        await fail([[`TRUNCATE public.${table}`]], /preserved/, `truncate ${table}`);
      }
    });

    scenario("the RUNTIME role reaches the same backstops by writing SQL directly", async () => {
      const o = await org();
      const archived = await org("Archived");
      await setOrganizationStatus(archived, "archived");
      const insertScopeSql = `INSERT INTO public.company_operating_scope_periods (id, organization_id, operating_scope, effective_from) VALUES ($1, $2, $3, $4)`;
      const first = randomUUID();
      await pools.runtime.query(insertScopeSql, [first, o, "CANADA", MONTH(1)]);
      await assert.rejects(pools.runtime.query(insertScopeSql, [randomUUID(), o, "UNITED_STATES", MONTH(2)]), (error: { code?: string; constraint?: string }) => error.code === "23505" && error.constraint === "company_operating_scope_periods_current_uq");
      await assert.rejects(pools.runtime.query(insertScopeSql, [randomUUID(), archived, "CANADA", MONTH(1)]), /is not active/);
      await assert.rejects(pools.runtime.query(insertScopeSql, [randomUUID(), o, "EVERYWHERE", MONTH(1)]), /scope_valid/);
      await assert.rejects(pools.runtime.query(`INSERT INTO public.company_rule_applicability_periods (organization_id, rule_code, applicability, effective_from) VALUES ($1, 'NOT_A_RULE', 'APPLIES', $2)`, [o, MONTH(1)]), /not an active company profile rule/);
      await assert.rejects(pools.runtime.query(`INSERT INTO public.company_driver_requirement_periods (organization_id, minimum_driver_age_years, minimum_driver_experience_months, effective_from) VALUES ($1, 15, 0, $2)`, [o, MONTH(1)]), /age_valid/);
      // content columns are not writable; lifecycle columns are, and the triggers still guard them
      await assert.rejects(pools.runtime.query(`UPDATE public.company_operating_scope_periods SET operating_scope = 'UNITED_STATES' WHERE id = $1`, [first]), /permission denied/);
      await assert.rejects(pools.runtime.query(`INSERT INTO public.company_operating_scope_periods (id, organization_id, operating_scope, effective_from, record_status) VALUES ($1, $2, 'CANADA', $3, 'corrected')`, [randomUUID(), o, MONTH(1)]), /permission denied/);
      await pools.runtime.query(`UPDATE public.company_operating_scope_periods SET effective_to = $2 WHERE id = $1`, [first, MONTH(4)]);
      await assert.rejects(pools.runtime.query(`UPDATE public.company_operating_scope_periods SET effective_to = $2 WHERE id = $1`, [first, MONTH(2)]), /cannot be re-dated/);
      await assert.rejects(pools.runtime.query(`DELETE FROM public.company_operating_scope_periods WHERE id = $1`, [first]), /permission denied/);
      assert.equal(await rowCount(`SELECT count(*) FROM public.master_register_events WHERE target ->> 'resourceId' = $1`, [first]), 0, "direct SQL records nothing: only the service writes the register");
    });
  });

  // =============================================================================================================
  describe("authorization", () => {
    scenario("no session, no capability and the wrong capability are denied and change nothing", async () => {
      await fullStaff();
      const o = await org();
      await setScope(o, "CANADA", MONTH(1));
      await setRule(o, "DG_COLORADO", "APPLIES", MONTH(1));
      await setDrivers(o, 25, 36, MONTH(1));
      const before = await counts(o);
      const view = await K.p.getCompanyProfile(o);
      const scopeId = view.operatingScope.assertion!.id;
      const ruleId = entry(view, "DG_COLORADO").assertion!.id;
      const driverId = view.driverRequirements.assertion!.id;
      const mutations: Array<() => Promise<unknown>> = [
        () => setScope(o, "UNITED_STATES"),
        () => K.p.correctOperatingScope({ periodId: scopeId, operatingScope: "UNITED_STATES" }),
        () => setRule(o, "DG_COLORADO", "DOES_NOT_APPLY"),
        () => K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO" }),
        () => K.p.correctRuleApplicability({ periodId: ruleId, applicability: "DOES_NOT_APPLY" }),
        () => setDrivers(o, 30, 12),
        () => K.p.correctDriverRequirements({ periodId: driverId, minimumDriverAgeYears: 30, minimumDriverExperienceMonths: 12 }),
      ];
      const reads: Array<() => Promise<unknown>> = [() => K.p.listRules(), () => K.p.getCompanyProfile(o), () => K.p.compareTaxApplicabilityWithRegistrations(o)];

      K.db.setClerkUser(null);
      for (const call of [...reads, ...mutations]) await assert.rejects(call());

      // an actor with no capability at all
      signIn(await staff());
      for (const call of [...reads, ...mutations]) await denied(call());

      // unrelated capabilities authorize nothing here
      const unrelated = await fx.actor();
      const relationshipId = await fx.relationship(unrelated.actorId, "TES_STAFF");
      const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
      for (const capability of ["ORGANIZATION_UPDATE", "ORGANIZATION_READ", "ORGANIZATION_REGISTRY_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "TAX_REGISTRATION_MANAGE"]) await fx.grant(relationshipId, capability as never, { assignmentId });
      signIn(unrelated);
      for (const call of [...reads, ...mutations]) await denied(call());

      // READ alone reads everything and mutates nothing
      signIn(await staff("COMPANY_PROFILE_READ"));
      assert.equal((await K.p.listRules()).length, 45);
      assert.equal((await K.p.getCompanyProfile(o)).organizationId, o);
      assert.equal((await K.p.compareTaxApplicabilityWithRegistrations(o)).length, 11);
      for (const call of mutations) await denied(call());

      // MANAGE alone mutates but reads nothing (its mutations return no profile to a reader without READ... they do return the view, since the
      // capability to record a fact includes seeing the result), yet it cannot call any read function
      signIn(await staff("COMPANY_PROFILE_MANAGE"));
      for (const call of reads) await denied(call());

      signIn(await staff());
      assert.deepEqual(await counts(o), before, "denied calls changed nothing");
    });

    scenario("MANAGE alone can record facts; a customer actor, even with ORGANIZATION_READ, reaches nothing", async () => {
      await fullStaff();
      const o = await org();
      const manager = await staff("COMPANY_PROFILE_MANAGE");
      signIn(manager);
      const written = await setScope(o, "CANADA", MONTH(1));
      assert.equal(written.operatingScope.assertion?.operatingScope, "CANADA");
      assert.deepEqual(await eventTypes(manager.actorId), ["RECORD_CREATED"]);

      const customerA = await fx.organizationAndCustomer("CustA");
      const user = await fx.actor();
      const relationshipId = await fx.relationship(user.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customerA.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      signIn(user);
      await denied(K.p.getCompanyProfile(customerA.organizationId));
      await denied(K.p.listRules());
      await denied(K.p.compareTaxApplicabilityWithRegistrations(customerA.organizationId));
      await denied(setScope(customerA.organizationId, "CANADA"));
      await denied(setRule(customerA.organizationId, "DG_US", "APPLIES"));
      await denied(setDrivers(customerA.organizationId, 21, 24));
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_operating_scope_periods WHERE organization_id = $1`, [customerA.organizationId]), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.relationship_capability_grants g JOIN public.capabilities c ON c.id = g.capability_id WHERE c.code LIKE 'COMPANY_PROFILE\\_%' AND g.relationship_id = $1`, [relationshipId]), 0);
    });

    scenario("the service exposes no delete, remove, merge, customer-scope or key/value function", async () => {
      assert.deepEqual(Object.keys(K.p).filter((key) => /delete|remove|destroy|merge|withAuthorizedCustomer|customerContext|preference|setting|keyvalue/i.test(key)), []);
    });
  });

  // =============================================================================================================
  describe("reads", () => {
    scenario("an unconfigured Organization lists every rule: catalogue defaults are DEFAULT, everything else NOT_CONFIGURED", async () => {
      await fullStaff();
      const defs = await import("@/lib/company-profile/definitions");
      const o = await org();
      const view = await K.p.getCompanyProfile(o);
      assert.equal(view.organizationId, o);
      assert.equal(view.asOf, null);
      assert.equal(view.operatingScope.assertion, null);
      assert.deepEqual(view.operatingScope.history, []);
      assert.equal(view.driverRequirements.assertion, null);
      assert.equal(view.rules.length, 45);
      assert.deepEqual(view.rules.map((candidate) => candidate.rule.code), [...defs.RULE_CODES], "catalogue order");
      for (const candidate of view.rules) {
        assert.equal(candidate.assertion, null);
        assert.deepEqual(candidate.history, []);
        const defaulted = candidate.rule.defaultApplicability === "APPLIES";
        assert.equal(candidate.effective, defaulted ? "APPLIES" : "NOT_CONFIGURED", candidate.rule.code);
        assert.equal(candidate.source, defaulted ? "DEFAULT" : "NOT_CONFIGURED", candidate.rule.code);
      }
      assert.equal(view.rules.filter((candidate) => candidate.source === "DEFAULT").length, 8);
      const catalogue = await K.p.listRules();
      assert.equal(catalogue.length, 45);
      assert.deepEqual(catalogue.map((rule) => rule.code), [...defs.RULE_CODES]);
      assert.equal(catalogue.find((rule) => rule.code === "KYU")?.registrationProgramCode, "KYU");
      assert.equal(catalogue.find((rule) => rule.code === "FORM_2290")?.registrationProgramCode, null);
      assert.ok(catalogue.every((rule) => rule.isActive));
    });

    scenario("a missing Organization is not found; malformed input is a validation error; reads write nothing", async () => {
      const actor = await fullStaff();
      const o = await org();
      await notFound(K.p.getCompanyProfile(randomUUID()));
      await notFound(K.p.compareTaxApplicabilityWithRegistrations(randomUUID()));
      for (const bad of ["", "not-a-uuid", "123", null, undefined, 7, {}]) {
        await invalid(K.p.getCompanyProfile(bad as never));
        await invalid(K.p.compareTaxApplicabilityWithRegistrations(bad as never));
      }
      await invalid(K.p.getCompanyProfile(o, { asOf: "2020-01-01" } as never));
      await invalid(K.p.getCompanyProfile(o, { asOf: "yesterday" } as never));
      await invalid(K.p.getCompanyProfile(o, { asOf: MONTH(1), extra: 1 } as never));
      await invalid(K.p.getCompanyProfile(o, "now" as never));
      await K.p.getCompanyProfile(o.toUpperCase());
      assert.deepEqual(await eventTypes(actor.actorId), [], "reads write no Master Register event");
    });
  });

  // =============================================================================================================
  describe("operating scope", () => {
    scenario("first assertion, real-world changes and as-of reads; the previous scope stays true history", async () => {
      const actor = await fullStaff();
      const o = await org();
      const first = await setScope(o, "CANADA", MONTH(1));
      assert.equal(first.operatingScope.assertion?.operatingScope, "CANADA");
      assert.equal(first.operatingScope.assertion?.effectiveFrom, MICRO(1));
      assert.equal(first.operatingScope.assertion?.effectiveTo, null);
      assert.equal(first.operatingScope.assertion?.recordStatus, "active");
      assert.equal(first.operatingScope.history.length, 1);

      await conflict(setScope(o, "CANADA", MONTH(2)));
      await invalid(setScope(o, "UNITED_STATES", MONTH(1)));
      await invalid(setScope(o, "UNITED_STATES", "2019-12-01T00:00:00Z"));
      await invalid(setScope(o, "UNITED_STATES", tomorrow()));
      assert.equal((await counts(o)).scope, 1, "refused changes left nothing behind");

      const second = await setScope(o, "UNITED_STATES", MONTH(3));
      assert.equal(second.operatingScope.assertion?.operatingScope, "UNITED_STATES");
      assert.deepEqual(second.operatingScope.history.map((row) => [row.operatingScope, row.effectiveFrom, row.effectiveTo]), [
        ["CANADA", MICRO(1), MICRO(3)],
        ["UNITED_STATES", MICRO(3), null],
      ]);
      const third = await setScope(o, "CANADA_AND_UNITED_STATES", MONTH(5));
      assert.equal(third.operatingScope.history.length, 3);

      const at = async (instant: string) => (await K.p.getCompanyProfile(o, { asOf: instant })).operatingScope.assertion?.operatingScope ?? null;
      assert.equal(await at("2019-12-31T23:59:59Z"), null);
      assert.equal(await at(MONTH(1)), "CANADA");
      assert.equal(await at("2020-02-29T23:59:59Z"), "CANADA");
      assert.equal(await at(MONTH(3)), "UNITED_STATES", "a period starts inclusive");
      assert.equal(await at("2020-04-30T23:59:59.999999Z"), "UNITED_STATES");
      assert.equal(await at(MONTH(5)), "CANADA_AND_UNITED_STATES", "and ends exclusive");
      assert.equal(await at("2999-01-01T00:00:00Z"), "CANADA_AND_UNITED_STATES");
      assert.equal((await K.p.getCompanyProfile(o, { asOf: MONTH(2) })).asOf, MICRO(2));
      assert.deepEqual(await eventTypes(actor.actorId), ["RECORD_CREATED", "RECORD_UPDATED", "RECORD_UPDATED"]);
    });

    scenario("microsecond precision survives; a backdated first assertion is allowed, the future is not", async () => {
      await fullStaff();
      const o = await org();
      const view = await setScope(o, "CANADA", "2020-01-01T00:00:00.123456Z");
      assert.equal(view.operatingScope.assertion?.effectiveFrom, "2020-01-01T00:00:00.123456Z");
      const next = await setScope(o, "UNITED_STATES", "2020-01-01T00:00:00.123457Z");
      assert.equal(next.operatingScope.history[0].effectiveTo, "2020-01-01T00:00:00.123457Z");
      const offset = await setScope(o, "CANADA", "2020-06-01T05:00:00.5+02:00");
      assert.equal(offset.operatingScope.assertion?.effectiveFrom, "2020-06-01T03:00:00.500000Z");
      const unspecified = await setScope(await org("Now"), "CANADA");
      assert.ok(unspecified.operatingScope.assertion!.effectiveFrom <= new Date().toISOString().replace("Z", "999Z"), "defaults to the database clock");
    });

    scenario("a correction of the CURRENT scope preserves the wrong row, inherits its business time and is never shown as genuine history", async () => {
      const actor = await fullStaff();
      const o = await org();
      await setScope(o, "CANADA", MONTH(1));
      const before = await setScope(o, "CANADA_AND_UNITED_STATES", MONTH(5));
      const currentId = before.operatingScope.assertion!.id;
      const previous = before.operatingScope.history[0];

      const corrected = await K.p.correctOperatingScope({ periodId: currentId, operatingScope: "UNITED_STATES" });
      const rows = corrected.operatingScope.history;
      assert.equal(rows.length, 3);
      const wrong = rows.find((row) => row.id === currentId)!;
      const replacement = corrected.operatingScope.assertion!;
      assert.equal(wrong.recordStatus, "corrected");
      assert.ok(wrong.correctedAt);
      assert.equal(wrong.operatingScope, "CANADA_AND_UNITED_STATES", "the wrong value is preserved");
      assert.equal(wrong.effectiveTo, null, "a correction does not end the wrong row");
      assert.equal(wrong.supersededById, replacement.id);
      assert.equal(replacement.recordStatus, "active");
      assert.equal(replacement.operatingScope, "UNITED_STATES");
      assert.equal(replacement.effectiveFrom, MICRO(5), "the replacement inherits the business time");
      assert.equal(replacement.effectiveTo, null);
      assert.equal(replacement.supersededById, null);
      assert.equal(rows.indexOf(wrong) < rows.indexOf(replacement), true, "the original is listed before its replacement");
      assert.deepEqual(corrected.operatingScope.history.find((row) => row.id === previous.id), previous, "earlier history is untouched");
      assert.equal((await K.p.getCompanyProfile(o, { asOf: MONTH(6) })).operatingScope.assertion?.id, replacement.id, "as-of uses the replacement, never the wrong row");
      assert.equal((await counts(o)).open, 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_operating_scope_periods WHERE organization_id = $1 AND record_status = 'corrected' AND superseded_by_period_id IS NOT NULL AND corrected_at IS NOT NULL`, [o]), 1);

      // a real-world change after a correction still works and keeps both
      const changed = await setScope(o, "CANADA", MONTH(7));
      assert.equal(changed.operatingScope.history.length, 4);
      assert.equal(changed.operatingScope.history.find((row) => row.id === replacement.id)?.effectiveTo, MICRO(7));

      // refusals
      await stateError(K.p.correctOperatingScope({ periodId: currentId, operatingScope: "CANADA" }));
      await invalid(K.p.correctOperatingScope({ periodId: changed.operatingScope.assertion!.id, operatingScope: "CANADA" }));
      await notFound(K.p.correctOperatingScope({ periodId: randomUUID(), operatingScope: "CANADA" }));
      await invalid(K.p.correctOperatingScope({ periodId: "nope", operatingScope: "CANADA" }));
      await invalid(K.p.correctOperatingScope({ periodId: currentId, operatingScope: "us" }));
      await invalid(K.p.correctOperatingScope({ periodId: currentId, operatingScope: "CANADA", effectiveFrom: MONTH(1) } as never));
      assert.deepEqual(await eventTypes(actor.actorId), ["RECORD_CREATED", "RECORD_UPDATED", "RECORD_CORRECTED", "RECORD_UPDATED"]);
    });

    // Correcting an ENDED period needs its replacement to be born with the same window, i.e. INSERT (effective_to).
    scenario("a correction of an ENDED scope gives the replacement the same window and leaves the wrong row ended", async () => {
      await fullStaff();
      const o = await org();
      await setScope(o, "CANADA", MONTH(1));
      await setScope(o, "UNITED_STATES", MONTH(3));
      const current = await setScope(o, "CANADA_AND_UNITED_STATES", MONTH(5));
      const ended = current.operatingScope.history[1];
      assert.equal(ended.operatingScope, "UNITED_STATES");
      const corrected = await K.p.correctOperatingScope({ periodId: ended.id, operatingScope: "CANADA" });
      const rows = corrected.operatingScope.history;
      assert.equal(rows.length, 4);
      const wrong = rows.find((row) => row.id === ended.id)!;
      const replacement = rows.find((row) => row.id === wrong.supersededById)!;
      assert.equal(wrong.recordStatus, "corrected");
      assert.equal(wrong.operatingScope, "UNITED_STATES");
      assert.equal(wrong.effectiveTo, MICRO(5));
      assert.deepEqual([replacement.operatingScope, replacement.effectiveFrom, replacement.effectiveTo, replacement.recordStatus], ["CANADA", MICRO(3), MICRO(5), "active"]);
      assert.equal((await K.p.getCompanyProfile(o, { asOf: MONTH(4) })).operatingScope.assertion?.id, replacement.id);
      assert.equal(corrected.operatingScope.assertion?.operatingScope, "CANADA_AND_UNITED_STATES", "the current period is untouched");
      assert.equal((await counts(o)).open, 1);
    });

    scenario("strict input: unknown keys, bad scopes, bad dates and non-objects are validation errors; nothing is written", async () => {
      await fullStaff();
      const o = await org();
      for (const bad of [null, undefined, "x", 7, [], { organizationId: o }, { organizationId: o, operatingScope: "CANADA", extra: true }, { organizationId: o, operatingScope: "canada" }, { organizationId: o, operatingScope: "BOTH" }, { organizationId: "x", operatingScope: "CANADA" }, { organizationId: o, operatingScope: "CANADA", effectiveFrom: "2020-01-01" }, { organizationId: o, operatingScope: "CANADA", effectiveFrom: 5 }, { organizationId: o, operatingScope: "CANADA", effectiveFrom: "2020-13-45T00:00:00Z" }, { organizationId: o, operatingScope: "CANADA", effectiveFrom: null }]) {
        await invalid(K.p.setOperatingScope(bad));
      }
      await notFound(setScope(randomUUID(), "CANADA"));
      assert.deepEqual(await counts(o), { scope: 0, rule: 0, driver: 0, open: 0 });
    });
  });

  // =============================================================================================================
  describe("rule applicability", () => {
    scenario("assert, change, refuse a repeat, clear back to not-configured, and re-assert only from the end of earlier history", async () => {
      const actor = await fullStaff();
      const o = await org();
      let view = await setRule(o, "DG_COLORADO", "APPLIES", MONTH(1));
      assert.equal(entry(view, "DG_COLORADO").effective, "APPLIES");
      assert.equal(entry(view, "DG_COLORADO").source, "ASSERTED");
      assert.equal(entry(view, "DG_COLORADO").assertion?.ruleCode, "DG_COLORADO");
      await conflict(setRule(o, "DG_COLORADO", "APPLIES", MONTH(2)));
      await invalid(setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(1)));
      await invalid(setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", tomorrow()));

      view = await setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(4));
      assert.equal(entry(view, "DG_COLORADO").effective, "DOES_NOT_APPLY");
      assert.deepEqual(entry(view, "DG_COLORADO").history.map((row) => [row.applicability, row.effectiveFrom, row.effectiveTo]), [
        ["APPLIES", MICRO(1), MICRO(4)],
        ["DOES_NOT_APPLY", MICRO(4), null],
      ]);

      // a clear ends the assertion and returns the rule to NOT CONFIGURED
      await invalid(K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO", endedAt: MONTH(4) }));
      await invalid(K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO", endedAt: tomorrow() }));
      view = await K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO", endedAt: MONTH(6) });
      assert.equal(entry(view, "DG_COLORADO").assertion, null);
      assert.equal(entry(view, "DG_COLORADO").effective, "NOT_CONFIGURED");
      assert.equal(entry(view, "DG_COLORADO").source, "NOT_CONFIGURED");
      assert.equal(entry(view, "DG_COLORADO").history[1].effectiveTo, MICRO(6), "the cleared assertion stays as history");
      await stateError(K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO" }));
      await stateError(K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_IDAHO" }));

      // as-of: asserted, then asserted differently, then not configured again
      const asOf = async (instant: string) => entry(await K.p.getCompanyProfile(o, { asOf: instant }), "DG_COLORADO").effective;
      assert.equal(await asOf("2019-06-01T00:00:00Z"), "NOT_CONFIGURED");
      assert.equal(await asOf(MONTH(2)), "APPLIES");
      assert.equal(await asOf(MONTH(5)), "DOES_NOT_APPLY");
      assert.equal(await asOf(MONTH(6)), "NOT_CONFIGURED", "the end is exclusive");
      assert.equal(await asOf(MONTH(8)), "NOT_CONFIGURED");

      // a new assertion cannot start before earlier history ended; starting exactly at the end is contiguous
      await invalid(setRule(o, "DG_COLORADO", "APPLIES", MONTH(5)));
      await invalid(setRule(o, "DG_COLORADO", "APPLIES", "2019-01-01T00:00:00Z"));
      view = await setRule(o, "DG_COLORADO", "APPLIES", MONTH(6));
      assert.equal(entry(view, "DG_COLORADO").history.length, 3);
      assert.equal(entry(view, "DG_COLORADO").effective, "APPLIES");
      assert.equal((await counts(o)).open, 1);
      // a second ASSERTION after a clear is a creation, not an update
      assert.deepEqual(await eventTypes(actor.actorId), ["RECORD_CREATED", "RECORD_UPDATED", "RECORD_UPDATED", "RECORD_CREATED"]);
    });

    scenario("a catalogue-default rule: an assertion overrides the default; clearing returns to the default, never to nothing", async () => {
      await fullStaff();
      const o = await org();
      assert.deepEqual([entry(await K.p.getCompanyProfile(o), "DG_CANADA").effective, entry(await K.p.getCompanyProfile(o), "DG_CANADA").source], ["APPLIES", "DEFAULT"]);
      let view = await setRule(o, "DG_CANADA", "DOES_NOT_APPLY", MONTH(2));
      assert.deepEqual([entry(view, "DG_CANADA").effective, entry(view, "DG_CANADA").source], ["DOES_NOT_APPLY", "ASSERTED"]);
      await conflict(setRule(o, "DG_CANADA", "DOES_NOT_APPLY", MONTH(3)));
      view = await K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_CANADA", endedAt: MONTH(4) });
      assert.deepEqual([entry(view, "DG_CANADA").effective, entry(view, "DG_CANADA").source, entry(view, "DG_CANADA").assertion], ["APPLIES", "DEFAULT", null]);
      const asOf = async (instant: string) => entry(await K.p.getCompanyProfile(o, { asOf: instant }), "DG_CANADA");
      assert.equal((await asOf(MONTH(1))).source, "DEFAULT");
      assert.equal((await asOf(MONTH(3))).effective, "DOES_NOT_APPLY");
      assert.equal((await asOf(MONTH(5))).source, "DEFAULT");
      // asserting the default value is still an explicit assertion
      view = await setRule(o, "DG_CANADA", "APPLIES", MONTH(4));
      assert.deepEqual([entry(view, "DG_CANADA").effective, entry(view, "DG_CANADA").source], ["APPLIES", "ASSERTED"]);
    });

    scenario("rules are independent: asserting one never touches another; only catalogued, active rules and the two stored values are accepted", async () => {
      await fullStaff();
      const o = await org();
      await setRule(o, "DG_COLORADO", "APPLIES", MONTH(1));
      const view = await setRule(o, "ALCOHOL_NJ", "DOES_NOT_APPLY", MONTH(2));
      assert.equal(view.rules.filter((candidate) => candidate.assertion !== null).length, 2);
      assert.equal(entry(view, "DG_IDAHO").assertion, null);
      assert.equal(entry(view, "DG_COLORADO").assertion?.applicability, "APPLIES");

      for (const ruleCode of ["NOT_A_RULE", "dg_us", "DG US", "", "X", null, undefined, 4, "__proto__"]) {
        await invalid(K.p.setRuleApplicability({ organizationId: o, ruleCode, applicability: "APPLIES" }));
        await invalid(K.p.clearRuleApplicability({ organizationId: o, ruleCode }));
      }
      for (const applicability of ["NOT_CONFIGURED", "applies", "YES", "", null, undefined, true]) {
        await invalid(K.p.setRuleApplicability({ organizationId: o, ruleCode: "DG_US", applicability }));
      }
      await invalid(K.p.setRuleApplicability({ organizationId: o, ruleCode: "DG_US", applicability: "APPLIES", note: "free text" } as never));
      await invalid(K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO", reason: "free text" } as never));
      await notFound(setRule(randomUUID(), "DG_US", "APPLIES"));

      // an inactive catalogue rule accepts no new assertion but still reads
      await pools.admin.query(`UPDATE public.company_profile_rules SET is_active = false WHERE code = 'DG_IDAHO'`);
      cleanups.push(async () => void (await pools.admin.query(`UPDATE public.company_profile_rules SET is_active = true WHERE code = 'DG_IDAHO'`)));
      await invalid(setRule(o, "DG_IDAHO", "APPLIES"));
      const after = await K.p.getCompanyProfile(o);
      assert.equal(entry(after, "DG_IDAHO").rule.isActive, false);
      assert.equal(after.rules.length, 45, "an inactive rule is still catalogued");
      assert.equal((await counts(o)).rule, 2);
    });

    scenario("a correction of the CURRENT assertion preserves the wrong one, inherits its window, and refuses no-ops and repeats", async () => {
      await fullStaff();
      const o = await org();
      await setRule(o, "DG_COLORADO", "APPLIES", MONTH(1));
      let view = await setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(4));
      const [ended, open] = entry(view, "DG_COLORADO").history;

      view = await K.p.correctRuleApplicability({ periodId: open.id, applicability: "APPLIES" });
      const history = entry(view, "DG_COLORADO").history;
      assert.equal(history.length, 3);
      assert.deepEqual(history.find((row) => row.id === ended.id), ended, "earlier history is untouched");
      const wrong = history.find((row) => row.id === open.id)!;
      assert.deepEqual([wrong.recordStatus, wrong.applicability, wrong.effectiveTo], ["corrected", "DOES_NOT_APPLY", null]);
      const replacement = entry(view, "DG_COLORADO").assertion!;
      assert.equal(wrong.supersededById, replacement.id);
      assert.deepEqual([replacement.applicability, replacement.effectiveFrom, replacement.effectiveTo, replacement.ruleCode], ["APPLIES", MICRO(4), null, "DG_COLORADO"]);
      assert.equal(entry(view, "DG_COLORADO").effective, "APPLIES");
      assert.equal(entry(await K.p.getCompanyProfile(o, { asOf: MONTH(5) }), "DG_COLORADO").assertion?.id, replacement.id);
      assert.equal((await counts(o)).open, 1);

      await stateError(K.p.correctRuleApplicability({ periodId: open.id, applicability: "DOES_NOT_APPLY" }));
      await invalid(K.p.correctRuleApplicability({ periodId: replacement.id, applicability: "APPLIES" }));
      await invalid(K.p.correctRuleApplicability({ periodId: replacement.id, applicability: "NOT_CONFIGURED" }));
      await notFound(K.p.correctRuleApplicability({ periodId: randomUUID(), applicability: "APPLIES" }));
      await invalid(K.p.correctRuleApplicability({ periodId: replacement.id, applicability: "DOES_NOT_APPLY", ruleCode: "DG_US" } as never));
      // clearing after a correction ends the REPLACEMENT, not the wrong row
      view = await K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO", endedAt: MONTH(7) });
      assert.equal(entry(view, "DG_COLORADO").history.find((row) => row.id === replacement.id)?.effectiveTo, MICRO(7));
      assert.equal(entry(view, "DG_COLORADO").history.find((row) => row.id === wrong.id)?.effectiveTo, null);
    });

    scenario("a correction of an ENDED assertion gives the replacement the same window", async () => {
      await fullStaff();
      const o = await org();
      await setRule(o, "DG_COLORADO", "APPLIES", MONTH(1));
      let view = await setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(4));
      const ended = entry(view, "DG_COLORADO").history[0];
      view = await K.p.correctRuleApplicability({ periodId: ended.id, applicability: "DOES_NOT_APPLY" });
      const history = entry(view, "DG_COLORADO").history;
      assert.equal(history.length, 3);
      const wrong = history.find((row) => row.id === ended.id)!;
      const replacement = history.find((row) => row.id === wrong.supersededById)!;
      assert.deepEqual([wrong.recordStatus, wrong.applicability, wrong.effectiveTo], ["corrected", "APPLIES", MICRO(4)]);
      assert.deepEqual([replacement.applicability, replacement.effectiveFrom, replacement.effectiveTo], ["DOES_NOT_APPLY", MICRO(1), MICRO(4)]);
      assert.equal(entry(await K.p.getCompanyProfile(o, { asOf: MONTH(2) }), "DG_COLORADO").assertion?.id, replacement.id);
      assert.equal((await counts(o)).open, 1);
      // a CLEARED (ended, nothing current) assertion may be corrected too, and stays ended
      view = await K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO", endedAt: MONTH(7) });
      view = await K.p.correctRuleApplicability({ periodId: entry(view, "DG_COLORADO").history.at(-1)!.id, applicability: "APPLIES" });
      assert.equal(entry(view, "DG_COLORADO").assertion, null);
      assert.deepEqual([entry(view, "DG_COLORADO").history.at(-1)?.effectiveTo, entry(view, "DG_COLORADO").history.at(-1)?.applicability], [MICRO(7), "APPLIES"]);
    });
  });

  // =============================================================================================================
  describe("driver requirements", () => {
    scenario("record, change, refuse a repeat; as-of reads; corrections keep the wrong row", async () => {
      await fullStaff();
      const o = await org();
      let view = await setDrivers(o, 25, 36, MONTH(1));
      assert.deepEqual([view.driverRequirements.assertion?.minimumDriverAgeYears, view.driverRequirements.assertion?.minimumDriverExperienceMonths], [25, 36]);
      await conflict(setDrivers(o, 25, 36, MONTH(2)));
      await invalid(setDrivers(o, 26, 36, MONTH(1)));
      await invalid(setDrivers(o, 26, 36, tomorrow()));
      view = await setDrivers(o, 25, 48, MONTH(3));
      view = await setDrivers(o, 23, 12, MONTH(5));
      assert.deepEqual(view.driverRequirements.history.map((row) => [row.minimumDriverAgeYears, row.minimumDriverExperienceMonths, row.effectiveFrom, row.effectiveTo]), [
        [25, 36, MICRO(1), MICRO(3)],
        [25, 48, MICRO(3), MICRO(5)],
        [23, 12, MICRO(5), null],
      ]);
      const at = async (instant: string) => (await K.p.getCompanyProfile(o, { asOf: instant })).driverRequirements.assertion;
      assert.equal(await at("2019-01-01T00:00:00Z"), null);
      assert.equal((await at(MONTH(4)))?.minimumDriverExperienceMonths, 48);
      assert.equal((await at(MONTH(6)))?.minimumDriverAgeYears, 23);

      // the current period is corrected in place (flagged, never ended); the replacement inherits its start
      const current = view.driverRequirements.assertion!;
      view = await K.p.correctDriverRequirements({ periodId: current.id, minimumDriverAgeYears: 24, minimumDriverExperienceMonths: 12 });
      const wrong = view.driverRequirements.history.find((row) => row.id === current.id)!;
      assert.deepEqual([wrong.recordStatus, wrong.minimumDriverAgeYears, wrong.effectiveTo], ["corrected", 23, null]);
      assert.deepEqual([view.driverRequirements.assertion?.minimumDriverAgeYears, view.driverRequirements.assertion?.effectiveFrom, wrong.supersededById === view.driverRequirements.assertion?.id], [24, MICRO(5), true]);
      assert.equal((await at(MONTH(6)))?.minimumDriverAgeYears, 24);
      await stateError(K.p.correctDriverRequirements({ periodId: current.id, minimumDriverAgeYears: 30, minimumDriverExperienceMonths: 1 }));
      await invalid(K.p.correctDriverRequirements({ periodId: view.driverRequirements.assertion!.id, minimumDriverAgeYears: 24, minimumDriverExperienceMonths: 12 }));
      await notFound(K.p.correctDriverRequirements({ periodId: randomUUID(), minimumDriverAgeYears: 30, minimumDriverExperienceMonths: 1 }));
      await invalid(K.p.correctDriverRequirements({ periodId: current.id, minimumDriverAgeYears: 15, minimumDriverExperienceMonths: 1 }));
      assert.equal((await counts(o)).open, 1);
    });

    scenario("a correction of ENDED driver minimums gives the replacement the same window", async () => {
      await fullStaff();
      const o = await org();
      await setDrivers(o, 25, 36, MONTH(1));
      await setDrivers(o, 25, 48, MONTH(3));
      let view = await setDrivers(o, 23, 12, MONTH(5));
      const middle = view.driverRequirements.history[1];
      view = await K.p.correctDriverRequirements({ periodId: middle.id, minimumDriverAgeYears: 27, minimumDriverExperienceMonths: 48 });
      const wrong = view.driverRequirements.history.find((row) => row.id === middle.id)!;
      const replacement = view.driverRequirements.history.find((row) => row.id === wrong.supersededById)!;
      assert.deepEqual([wrong.recordStatus, wrong.minimumDriverAgeYears, wrong.effectiveTo], ["corrected", 25, MICRO(5)]);
      assert.deepEqual([replacement.minimumDriverAgeYears, replacement.minimumDriverExperienceMonths, replacement.effectiveFrom, replacement.effectiveTo], [27, 48, MICRO(3), MICRO(5)]);
      assert.equal((await K.p.getCompanyProfile(o, { asOf: MONTH(4) })).driverRequirements.assertion?.id, replacement.id);
      assert.equal((await counts(o)).open, 1);
    });

    scenario("only whole numbers inside the schema's ranges are accepted; the boundaries are accepted", async () => {
      await fullStaff();
      const o = await org();
      const bad: Array<[unknown, unknown]> = [[15, 24], [101, 24], [21, -1], [21, 601], [21.5, 24], [21, 24.5], ["21", 24], [21, "24"], [null, 24], [21, null], [undefined, 24], [21, undefined], [Number.NaN, 24], [Infinity, 24], [21, Number.NaN], [true, 24], [[21], 24]];
      for (const [age, months] of bad) await invalid(K.p.setDriverRequirements({ organizationId: o, minimumDriverAgeYears: age, minimumDriverExperienceMonths: months }));
      await invalid(K.p.setDriverRequirements({ organizationId: o, minimumDriverAgeYears: 21, minimumDriverExperienceMonths: 24, minimumAge: 3 } as never));
      await invalid(K.p.setDriverRequirements({ organizationId: o, minimumDriverAgeYears: 21 } as never));
      assert.equal((await counts(o)).driver, 0);
      assert.equal((await setDrivers(o, 16, 0, MONTH(1))).driverRequirements.assertion?.minimumDriverAgeYears, 16);
      assert.equal((await setDrivers(o, 100, 600, MONTH(2))).driverRequirements.assertion?.minimumDriverExperienceMonths, 600);
      assert.equal((await counts(o)).driver, 2);
    });
  });

  // =============================================================================================================
  describe("Organization lifecycle", () => {
    scenario("an archived or merged Organization refuses every mutation but can still be read; restoring it re-enables writes", async () => {
      const actor = await fullStaff();
      const o = await org();
      const survivor = await org("Survivor");
      await setScope(o, "CANADA", MONTH(1));
      await setRule(o, "DG_COLORADO", "APPLIES", MONTH(1));
      await setDrivers(o, 25, 36, MONTH(1));
      const view = await K.p.getCompanyProfile(o);
      const ids = { scope: view.operatingScope.assertion!.id, rule: entry(view, "DG_COLORADO").assertion!.id, driver: view.driverRequirements.assertion!.id };
      const attempts: Array<() => Promise<unknown>> = [
        () => setScope(o, "UNITED_STATES"),
        () => K.p.correctOperatingScope({ periodId: ids.scope, operatingScope: "UNITED_STATES" }),
        () => setRule(o, "DG_IDAHO", "APPLIES"),
        () => setRule(o, "DG_COLORADO", "DOES_NOT_APPLY"),
        () => K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO" }),
        () => K.p.correctRuleApplicability({ periodId: ids.rule, applicability: "DOES_NOT_APPLY" }),
        () => setDrivers(o, 30, 1),
        () => K.p.correctDriverRequirements({ periodId: ids.driver, minimumDriverAgeYears: 30, minimumDriverExperienceMonths: 1 }),
      ];
      for (const status of ["archived", "merged"] as const) {
        await setOrganizationStatus(o, status, survivor);
        const before = await counts(o);
        const eventsBefore = (await eventTypes(actor.actorId)).length;
        for (const attempt of attempts) await stateError(attempt());
        assert.deepEqual(await counts(o), before, `${status}: nothing changed`);
        assert.equal((await eventTypes(actor.actorId)).length, eventsBefore, `${status}: nothing recorded`);
        assert.equal((await K.p.getCompanyProfile(o)).operatingScope.assertion?.operatingScope, "CANADA", `${status}: still readable`);
        assert.equal((await K.p.compareTaxApplicabilityWithRegistrations(o)).length, 11);
      }
      await setOrganizationStatus(o, "active");
      assert.equal((await setScope(o, "UNITED_STATES", MONTH(2))).operatingScope.assertion?.operatingScope, "UNITED_STATES");
      await notFound(setScope(randomUUID(), "CANADA"));
    });

    scenario("the Organization lock serializes writers: a pending archive wins and the waiting writer is refused", async () => {
      await fullStaff();
      const o = await org();
      const holder = await pools.admin.connect();
      try {
        await holder.query("BEGIN");
        await holder.query(`SELECT id FROM public.organizations WHERE id = $1 FOR UPDATE`, [o]);
        let settled = false;
        const waiting = setScope(o, "CANADA", MONTH(1)).then(
          () => { settled = true; return "ok" as const; },
          (error: unknown) => { settled = true; return error; },
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(settled, false, "the writer waits for the Organization lock");
        await holder.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [o]);
        await holder.query("COMMIT");
        const outcome = await waiting;
        assert.ok(outcome instanceof K.p.CompanyProfileStateError, String(outcome));
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release();
      }
      assert.equal((await counts(o)).scope, 0);
    });
  });

  // =============================================================================================================
  describe("cross-Organization non-leakage", () => {
    scenario("one Organization's profile never contains another's rows, and its facts never move another's", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      await setScope(a, "CANADA", MONTH(1));
      await setRule(a, "DG_COLORADO", "APPLIES", MONTH(1));
      await setDrivers(a, 25, 36, MONTH(1));
      await setScope(b, "UNITED_STATES", MONTH(1));
      await setRule(b, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(2));
      await setRule(b, "ALCOHOL_TX", "APPLIES", MONTH(2));
      await setDrivers(b, 30, 60, MONTH(1));

      const viewA = await K.p.getCompanyProfile(a);
      const viewB = await K.p.getCompanyProfile(b);
      const idsOf = (view: View) => [view.operatingScope.history, view.driverRequirements.history, ...view.rules.map((candidate) => candidate.history)].flat();
      for (const row of idsOf(viewA)) assert.equal(row.organizationId, a);
      for (const row of idsOf(viewB)) assert.equal(row.organizationId, b);
      assert.equal(idsOf(viewA).length, 3);
      assert.equal(idsOf(viewB).length, 4);
      assert.equal(entry(viewA, "DG_COLORADO").effective, "APPLIES");
      assert.equal(entry(viewB, "DG_COLORADO").effective, "DOES_NOT_APPLY");
      assert.equal(entry(viewA, "ALCOHOL_TX").assertion, null);
      const jsonA = JSON.stringify(viewA);
      for (const row of idsOf(viewB)) assert.equal(jsonA.includes(row.id), false);

      // a period of A cannot be corrected through B's facts, and clearing B's rule leaves A's alone
      await K.p.clearRuleApplicability({ organizationId: b, ruleCode: "DG_COLORADO", endedAt: MONTH(4) });
      assert.equal(entry(await K.p.getCompanyProfile(a), "DG_COLORADO").effective, "APPLIES");
      assert.equal(entry(await K.p.getCompanyProfile(b), "DG_COLORADO").effective, "NOT_CONFIGURED");
      await invalid(K.p.correctOperatingScope({ periodId: viewA.operatingScope.assertion!.id, operatingScope: "CANADA" }));
      assert.equal((await K.p.getCompanyProfile(b)).operatingScope.assertion?.operatingScope, "UNITED_STATES");
    });
  });

  // =============================================================================================================
  describe("cross-domain: tax applicability beside registrations (read-only)", () => {
    scenario("each TAX rule is compared with an ACTIVE-status, non-archived registration of its mapped program; nothing else leaks", async () => {
      const actor = await fullStaff();
      const [o, other] = [await org(), await org("Other")];
      const compare = async (organizationId = o) => new Map((await K.p.compareTaxApplicabilityWithRegistrations(organizationId)).map((row) => [row.ruleCode, row]));

      // nothing registered, nothing asserted
      let rows = await compare();
      assert.equal(rows.size, 11);
      assert.deepEqual([...rows.keys()], ["IFTA", "CT_HUF", "NY_HUT", "KYU", "NM_WDT", "OR_WMT", "FORM_2290", "FUEL_CHARGE_REGISTRATION", "TEXAS_EXCISE_TAX", "ARKANSAS_MOTOR_FUEL_TAX", "ONTARIO_TOBACCO_TAX"]);
      assert.deepEqual(rows.get("IFTA"), { ruleCode: "IFTA", registrationProgramCode: "IFTA", effective: "NOT_CONFIGURED", source: "NOT_CONFIGURED", hasActiveRegistration: false, alignment: "NOT_CONFIGURED" });
      assert.deepEqual(rows.get("FORM_2290"), { ruleCode: "FORM_2290", registrationProgramCode: null, effective: "NOT_CONFIGURED", source: "NOT_CONFIGURED", hasActiveRegistration: null, alignment: "NO_REGISTRATION_IDENTITY" });
      assert.equal(rows.get("TEXAS_EXCISE_TAX")?.registrationProgramCode, "TX_EXCISE");

      // registrations: ACTIVE; SUSPENDED; ACTIVE-but-archived; ACTIVE in ANOTHER Organization only
      const ifta = await registration(o, "IFTA", "ACTIVE");
      await registration(o, "KYU", "SUSPENDED");
      await registration(o, "NM_WDT", "ACTIVE", { archived: true });
      await registration(other, "OR_WMT", "ACTIVE");
      const tx = await registration(o, "TX_EXCISE", "ACTIVE");
      await registration(o, "AR_MFT", "PENDING");
      await registration(o, "ON_TOBACCO", "CLOSED");
      // assertions
      await setRule(o, "CT_HUF", "APPLIES", MONTH(1));
      await setRule(o, "NY_HUT", "DOES_NOT_APPLY", MONTH(1));
      await setRule(o, "KYU", "APPLIES", MONTH(1));
      await setRule(o, "NM_WDT", "APPLIES", MONTH(1));
      await setRule(o, "OR_WMT", "DOES_NOT_APPLY", MONTH(1));
      await setRule(o, "FORM_2290", "APPLIES", MONTH(1));
      await setRule(o, "ARKANSAS_MOTOR_FUEL_TAX", "APPLIES", MONTH(1));
      await setRule(o, "ONTARIO_TOBACCO_TAX", "DOES_NOT_APPLY", MONTH(1));

      rows = await compare();
      const alignment = (code: string) => rows.get(code)!.alignment;
      assert.equal(alignment("IFTA"), "REGISTRATION_WITHOUT_APPLICABILITY", "registered but no assertion");
      assert.equal(alignment("CT_HUF"), "APPLIES_WITHOUT_ACTIVE_REGISTRATION");
      assert.equal(alignment("NY_HUT"), "CONSISTENT", "does not apply and nothing registered");
      assert.equal(alignment("KYU"), "APPLIES_WITHOUT_ACTIVE_REGISTRATION", "a SUSPENDED registration is not ACTIVE");
      assert.equal(alignment("NM_WDT"), "APPLIES_WITHOUT_ACTIVE_REGISTRATION", "an archived registration does not count");
      assert.equal(alignment("OR_WMT"), "CONSISTENT", "another Organization's registration does not count");
      assert.equal(rows.get("OR_WMT")?.hasActiveRegistration, false);
      assert.equal(alignment("FORM_2290"), "NO_REGISTRATION_IDENTITY");
      assert.equal(rows.get("FORM_2290")?.effective, "APPLIES");
      assert.equal(alignment("TEXAS_EXCISE_TAX"), "REGISTRATION_WITHOUT_APPLICABILITY");
      assert.equal(alignment("ARKANSAS_MOTOR_FUEL_TAX"), "APPLIES_WITHOUT_ACTIVE_REGISTRATION", "PENDING is not ACTIVE");
      assert.equal(alignment("ONTARIO_TOBACCO_TAX"), "CONSISTENT", "CLOSED registration, does not apply");
      assert.equal(rows.get("IFTA")?.hasActiveRegistration, true);

      await setRule(o, "IFTA", "APPLIES", MONTH(1));
      await setRule(o, "TEXAS_EXCISE_TAX", "DOES_NOT_APPLY", MONTH(1));
      rows = await compare();
      assert.equal(alignment("IFTA"), "CONSISTENT");
      assert.equal(alignment("TEXAS_EXCISE_TAX"), "DOES_NOT_APPLY_WITH_ACTIVE_REGISTRATION");
      assert.equal(rows.get("IFTA")?.source, "ASSERTED");

      // the other Organization sees only its own registration
      const theirs = await compare(other);
      assert.equal(theirs.get("OR_WMT")?.hasActiveRegistration, true);
      assert.equal(theirs.get("IFTA")?.hasActiveRegistration, false);

      // only booleans and controlled codes are exposed; no number, id or date
      const json = JSON.stringify([...rows.values()]);
      for (const secret of [ifta.number, tx.number, ifta.id, tx.id, "2020-01-01"]) assert.equal(json.includes(secret), false, secret);
      assert.deepEqual(Object.keys(rows.get("IFTA")!).sort(), ["alignment", "effective", "hasActiveRegistration", "registrationProgramCode", "ruleCode", "source"]);

      // it writes nothing, to either domain
      const registrationRows = await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = ANY($1::uuid[])`, [[o, other]]);
      const eventCount = (await eventTypes(actor.actorId)).length;
      await compare();
      assert.equal(await rowCount(`SELECT count(*) FROM public.registrations WHERE organization_id = ANY($1::uuid[])`, [[o, other]]), registrationRows);
      assert.equal((await eventTypes(actor.actorId)).length, eventCount);

      // a rule's applicability follows an as-of change in the profile, the registration check is always "now"
      assert.equal(rows.get("CT_HUF")?.effective, "APPLIES");
    });

    scenario("every catalogue program a TAX rule points at exists in the registration catalogue and is used once", async () => {
      await fullStaff();
      const rows = (await pools.admin.query<{ code: string; registration_program_code: string }>(
        `SELECT r.code, r.registration_program_code FROM public.company_profile_rules r JOIN public.registration_programs p ON p.code = r.registration_program_code WHERE r.section = 'TAX' ORDER BY r.sort_order`,
      )).rows;
      assert.equal(rows.length, 10);
      assert.equal(new Set(rows.map((row) => row.registration_program_code)).size, 10);
      await assert.rejects(
        pools.admin.query(`INSERT INTO public.company_profile_rules (code, section, display_name, applies_to_region, registration_program_code, sort_order) VALUES ('SECOND_IFTA', 'TAX', 'x', 'BOTH', 'IFTA', 99999)`),
        /program_uq|duplicate key/,
      );
      await assert.rejects(
        pools.admin.query(`INSERT INTO public.company_profile_rules (code, section, display_name, applies_to_region, registration_program_code, sort_order) VALUES ('CARGO_WITH_PROGRAM', 'CARGO', 'x', 'BOTH', 'SCAC', 99998)`),
        /program_only_for_tax/,
      );
    });
  });

  // =============================================================================================================
  describe("Master Register", () => {
    scenario("each material mutation writes its event in the same transaction; references and controlled vocabulary only", async () => {
      const actor = await fullStaff();
      const o = await org();
      const scopeView = await setScope(o, "CANADA", MONTH(1));
      await setScope(o, "UNITED_STATES", MONTH(2));
      await setRule(o, "DG_COLORADO", "APPLIES", MONTH(1));
      await setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(2));
      await K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO", endedAt: MONTH(3) });
      await setDrivers(o, 73, 437, MONTH(1));
      const driverView = await setDrivers(o, 74, 438, MONTH(2));
      const current = driverView.driverRequirements.assertion!;
      await K.p.correctDriverRequirements({ periodId: current.id, minimumDriverAgeYears: 75, minimumDriverExperienceMonths: 439 });
      const scopeNow = (await K.p.getCompanyProfile(o)).operatingScope.assertion!;
      await K.p.correctOperatingScope({ periodId: scopeNow.id, operatingScope: "CANADA_AND_UNITED_STATES" });
      await setRule(o, "ALCOHOL_NY", "APPLIES", MONTH(4));
      const ruleNow = entry(await K.p.getCompanyProfile(o), "ALCOHOL_NY").assertion!;
      await K.p.correctRuleApplicability({ periodId: ruleNow.id, applicability: "DOES_NOT_APPLY" });

      const types = await eventTypes(actor.actorId);
      const known = new Set(["RECORD_CREATED", "RECORD_UPDATED", "RECORD_CORRECTED"]);
      for (const type of types) assert.ok(known.has(type), type);
      assert.equal(types.length, 11);
      assert.equal(types.filter((type) => type === "RECORD_CORRECTED").length, 3);

      const recorded = await events(actor.actorId);
      assert.deepEqual([...new Set(recorded.map((row) => (row.target as { resourceType: string }).resourceType))].sort(), [
        "company_driver_requirement_period", "company_operating_scope_period", "company_rule_applicability_period",
      ]);
      for (const row of recorded) {
        const target = row.target as { resourceId: string; subjectReferences: string[] };
        assert.deepEqual(target.subjectReferences, [`organization:${o}`]);
        assert.match(target.resourceId, /^[0-9a-f-]{36}$/);
        assert.equal((row.source as { component: string }).component, "company-profile");
      }
      // only references and controlled-vocabulary literals; never numbers, dates or free text
      const json = JSON.stringify(recorded.map((row) => ({ change_set: row.change_set, target: row.target, action: row.action })));
      for (const forbidden of ['"value":73', '"value":"73"', '"value":437', '"value":"437"', '"value":74', '"value":75', '"value":439', "2020-", "minimumDriver"]) assert.equal(json.includes(forbidden), false, forbidden);
      const literals = recorded.flatMap((row) => ((row.change_set as { fieldChanges?: Array<{ before?: { kind: string; value?: unknown }; after?: { kind: string; value?: unknown } }> }).fieldChanges ?? []).flatMap((change) => [change.before, change.after])).filter((value) => value?.kind === "LITERAL").map((value) => String(value!.value));
      const allowed = new Set(["CANADA", "UNITED_STATES", "CANADA_AND_UNITED_STATES", "APPLIES", "DOES_NOT_APPLY", "NOT_CONFIGURED", "DG_COLORADO", "ALCOHOL_NY"]);
      for (const value of literals) assert.ok(allowed.has(value), `unexpected literal ${value}`);
      const references = recorded.flatMap((row) => ((row.change_set as { fieldChanges?: Array<{ before?: { reference?: string }; after?: { reference?: string } }> }).fieldChanges ?? []).flatMap((change) => [change.before?.reference, change.after?.reference])).filter(Boolean) as string[];
      assert.ok(references.length >= 8);
      for (const reference of references) assert.match(reference, /^company_(operating_scope|rule_applicability|driver_requirement)_periods:[0-9a-f-]{36}$/);
      assert.equal(scopeView.operatingScope.assertion?.effectiveFrom, MICRO(1));

      // reads and refused calls write nothing
      await K.p.getCompanyProfile(o);
      await K.p.listRules();
      await K.p.compareTaxApplicabilityWithRegistrations(o);
      await assert.rejects(setScope(o, "CANADA_AND_UNITED_STATES"));
      await assert.rejects(setRule(o, "NOT_A_RULE", "APPLIES"));
      await assert.rejects(setDrivers(o, 10, 10));
      await assert.rejects(setScope(randomUUID(), "CANADA"));
      assert.equal((await eventTypes(actor.actorId)).length, 11);
    });

    scenario("a Master Register failure rolls the whole mutation back (every operation)", async () => {
      const actor = await fullStaff();
      const o = await org();
      const snapshot = async () => JSON.stringify(await pools.admin.query(
        `SELECT 'scope' AS t, id, operating_scope AS v, effective_from, effective_to, record_status FROM public.company_operating_scope_periods WHERE organization_id = $1
         UNION ALL SELECT 'rule', id, rule_code || applicability, effective_from, effective_to, record_status FROM public.company_rule_applicability_periods WHERE organization_id = $1
         UNION ALL SELECT 'driver', id, minimum_driver_age_years || '/' || minimum_driver_experience_months, effective_from, effective_to, record_status FROM public.company_driver_requirement_periods WHERE organization_id = $1
         ORDER BY 1, 2`, [o]));

      // creations
      await refuseMasterRegisterEvent("RECORD_CREATED");
      await assert.rejects(setScope(o, "CANADA", MONTH(1)), /master register write refused/);
      await assert.rejects(setRule(o, "DG_COLORADO", "APPLIES", MONTH(1)), /master register write refused/);
      await assert.rejects(setDrivers(o, 25, 36, MONTH(1)), /master register write refused/);
      assert.deepEqual(await counts(o), { scope: 0, rule: 0, driver: 0, open: 0 }, "no creation left a trace");
      assert.deepEqual(await eventTypes(actor.actorId), []);
      await allowMasterRegister();

      const scope = (await setScope(o, "CANADA", MONTH(1))).operatingScope.assertion!;
      const rule = entry(await setRule(o, "DG_COLORADO", "APPLIES", MONTH(1)), "DG_COLORADO").assertion!;
      const driver = (await setDrivers(o, 25, 36, MONTH(1))).driverRequirements.assertion!;
      const settled = await snapshot();
      const eventsBefore = await eventTypes(actor.actorId);

      // changes, clears (UPDATED) and corrections (CORRECTED) all roll back
      for (const [eventType, work] of [
        ["RECORD_UPDATED", () => setScope(o, "UNITED_STATES", MONTH(2))],
        ["RECORD_UPDATED", () => setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(2))],
        ["RECORD_UPDATED", () => K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO", endedAt: MONTH(2) })],
        ["RECORD_UPDATED", () => setDrivers(o, 30, 12, MONTH(2))],
        ["RECORD_CORRECTED", () => K.p.correctOperatingScope({ periodId: scope.id, operatingScope: "UNITED_STATES" })],
        ["RECORD_CORRECTED", () => K.p.correctRuleApplicability({ periodId: rule.id, applicability: "DOES_NOT_APPLY" })],
        ["RECORD_CORRECTED", () => K.p.correctDriverRequirements({ periodId: driver.id, minimumDriverAgeYears: 30, minimumDriverExperienceMonths: 12 })],
      ] as Array<[string, () => Promise<unknown>]>) {
        await refuseMasterRegisterEvent(eventType);
        await assert.rejects(work(), /master register write refused/, eventType);
        assert.equal(await snapshot(), settled, `${eventType}: the failed operation changed nothing`);
        await allowMasterRegister();
      }
      assert.deepEqual(await eventTypes(actor.actorId), eventsBefore);
      const view = await K.p.getCompanyProfile(o);
      assert.equal(view.operatingScope.assertion?.operatingScope, "CANADA");
      assert.equal(entry(view, "DG_COLORADO").effective, "APPLIES");
      assert.equal(view.driverRequirements.assertion?.minimumDriverAgeYears, 25);
      assert.equal((await counts(o)).open, 3);
      // and the same operations succeed once the register accepts events again
      await setScope(o, "UNITED_STATES", MONTH(2));
    });
  });

  // =============================================================================================================
  describe("transaction rollback", () => {
    scenario("a failure after the old period was ended or marked corrected leaves the old period exactly as it was", async () => {
      await fullStaff();
      const o = await org();
      const scope = (await setScope(o, "CANADA", MONTH(1))).operatingScope.assertion!;
      const rule = entry(await setRule(o, "DG_COLORADO", "APPLIES", MONTH(1)), "DG_COLORADO").assertion!;
      const driver = (await setDrivers(o, 25, 36, MONTH(1))).driverRequirements.assertion!;
      const row = async (table: string, id: string) => (await pools.admin.query(`SELECT effective_to, record_status, corrected_at, superseded_by_period_id FROM public.${table} WHERE id = $1`, [id])).rows[0];
      const open = { effective_to: null, record_status: "active", corrected_at: null, superseded_by_period_id: null };

      const cases: Array<[string, string, string, () => Promise<unknown>, () => Promise<unknown>]> = [
        ["company_operating_scope_periods", "scope change", scope.id, () => setScope(o, "UNITED_STATES", MONTH(2)), () => setScope(o, "UNITED_STATES", MONTH(2))],
        ["company_operating_scope_periods", "scope correction", scope.id, () => K.p.correctOperatingScope({ periodId: scope.id, operatingScope: "UNITED_STATES" }), () => setScope(o, "CANADA_AND_UNITED_STATES", MONTH(2))],
        ["company_rule_applicability_periods", "rule change", rule.id, () => setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(2)), () => setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(2))],
        ["company_rule_applicability_periods", "rule correction", rule.id, () => K.p.correctRuleApplicability({ periodId: rule.id, applicability: "DOES_NOT_APPLY" }), () => setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(2))],
        ["company_driver_requirement_periods", "driver change", driver.id, () => setDrivers(o, 30, 12, MONTH(2)), () => setDrivers(o, 30, 12, MONTH(2))],
        ["company_driver_requirement_periods", "driver correction", driver.id, () => K.p.correctDriverRequirements({ periodId: driver.id, minimumDriverAgeYears: 30, minimumDriverExperienceMonths: 12 }), () => setDrivers(o, 31, 12, MONTH(2))],
      ];
      // each table is exercised with its own failing insert; the first two of each pair run with the failure, the rest of the state is checked
      const byTable = new Map<string, typeof cases>();
      for (const item of cases) byTable.set(item[0], [...(byTable.get(item[0]) ?? []), item]);
      for (const [table, items] of byTable) {
        const lift = await failInsertsInto(table);
        for (const [, label, id, work] of items) {
          const before = await counts(o);
          await assert.rejects(work(), /profile insert refused/, label);
          assert.deepEqual(await row(table, id), open, `${label}: the old period was neither ended nor corrected`);
          assert.deepEqual(await counts(o), before, `${label}: no stray row`);
        }
        await lift();
      }
      // with the failure gone the same changes succeed
      await setScope(o, "UNITED_STATES", MONTH(2));
      await setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(2));
      await setDrivers(o, 30, 12, MONTH(2));
      assert.equal((await counts(o)).open, 3);
    });
  });

  // =============================================================================================================
  describe("concurrency (real PostgreSQL, distinct authorized actors)", () => {
    const onlyDomainErrors = (results: Array<PromiseSettledResult<unknown>>) => {
      for (const result of results) if (result.status === "rejected") assert.ok(result.reason instanceof K.p.CompanyProfileError, `raw error escaped: ${String(result.reason)}`);
    };
    const fulfilled = (results: Array<PromiseSettledResult<unknown>>) => results.filter((result) => result.status === "fulfilled").length;

    scenario("1. simultaneous first assertions for one (Organization, rule): exactly one wins and the others get a Conflict", async () => {
      const as = await concurrentActors(6);
      const o = await org();
      const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => as(i, () => setRule(o, "DG_COLORADO", "APPLIES", MONTH(1)))));
      assert.equal(fulfilled(results), 1);
      onlyDomainErrors(results);
      for (const result of results) if (result.status === "rejected") assert.ok(result.reason instanceof K.p.CompanyProfileConflictError);
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_rule_applicability_periods WHERE organization_id = $1 AND rule_code = 'DG_COLORADO'`, [o]), 1);
      assert.equal((await counts(o)).open, 1);
    });

    scenario("2. simultaneous first scope / driver minimums: exactly one wins each", async () => {
      const as = await concurrentActors(5);
      const o = await org();
      const scopes = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => as(i, () => setScope(o, "CANADA", MONTH(1)))));
      const drivers = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => as(i, () => setDrivers(o, 25, 36, MONTH(1)))));
      assert.equal(fulfilled(scopes), 1);
      assert.equal(fulfilled(drivers), 1);
      onlyDomainErrors([...scopes, ...drivers]);
      assert.deepEqual(await counts(o), { scope: 1, rule: 0, driver: 1, open: 2 });
    });

    scenario("3. independent rules of one Organization do not conflict; neither do different Organizations", async () => {
      await fullStaff();
      const as = await concurrentActors(8);
      const [a, b] = [await org("A"), await org("B")];
      const codes = ["DG_COLORADO", "DG_IDAHO", "ALCOHOL_NJ", "ALCOHOL_TX"];
      const results = await Promise.allSettled([
        ...codes.map((code, i) => as(i, () => setRule(a, code, "APPLIES", MONTH(1)))),
        ...codes.map((code, i) => as(4 + i, () => setRule(b, code, "DOES_NOT_APPLY", MONTH(1)))),
      ]);
      assert.equal(fulfilled(results), 8, results.map((result) => (result.status === "rejected" ? String(result.reason) : "")).join(";"));
      assert.equal((await counts(a)).rule, 4);
      assert.equal((await counts(b)).rule, 4);
      for (const view of [await K.p.getCompanyProfile(a), await K.p.getCompanyProfile(b)]) assert.equal(view.rules.filter((candidate) => candidate.assertion !== null).length, 4);
    });

    scenario("4. simultaneous different changes of one rule serialize into contiguous history with one current assertion", async () => {
      await fullStaff();
      const as = await concurrentActors(4);
      const o = await org();
      await setRule(o, "DG_COLORADO", "APPLIES", MONTH(1));
      const results = await Promise.allSettled([
        as(0, () => setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(3))),
        as(1, () => setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(3))),
        as(2, () => K.p.clearRuleApplicability({ organizationId: o, ruleCode: "DG_COLORADO", endedAt: MONTH(3) })),
        as(3, () => setRule(o, "DG_COLORADO", "DOES_NOT_APPLY", MONTH(4))),
      ]);
      onlyDomainErrors(results);
      assert.ok(fulfilled(results) >= 1);
      const history = (await pools.admin.query<{ applicability: string; effective_from: Date; effective_to: Date | null; record_status: string }>(
        `SELECT applicability, effective_from, effective_to, record_status FROM public.company_rule_applicability_periods WHERE organization_id = $1 AND rule_code = 'DG_COLORADO' AND record_status = 'active' ORDER BY effective_from`, [o])).rows;
      assert.ok((await counts(o)).open <= 1, "at most one current assertion");
      for (let i = 0; i + 1 < history.length; i += 1) assert.ok(history[i].effective_to !== null && history[i].effective_to! <= history[i + 1].effective_from, "periods never overlap");
      assert.equal(history.filter((row) => row.effective_to === null).length, (await counts(o)).open);
    });

    scenario("5. a correction racing a real change leaves consistent, non-overlapping history", async () => {
      await fullStaff();
      const as = await concurrentActors(3);
      const o = await org();
      const first = (await setScope(o, "CANADA", MONTH(1))).operatingScope.assertion!;
      const results = await Promise.allSettled([
        as(0, () => K.p.correctOperatingScope({ periodId: first.id, operatingScope: "UNITED_STATES" })),
        as(1, () => setScope(o, "CANADA_AND_UNITED_STATES", MONTH(3))),
        as(2, () => K.p.correctOperatingScope({ periodId: first.id, operatingScope: "CANADA_AND_UNITED_STATES" })),
      ]);
      onlyDomainErrors(results);
      assert.ok(fulfilled(results) >= 1);
      assert.equal((await counts(o)).open, 1, "exactly one current scope");
      assert.ok(await rowCount(`SELECT count(*) FROM public.company_operating_scope_periods WHERE organization_id = $1 AND record_status = 'corrected' AND superseded_by_period_id IS NOT NULL AND corrected_at IS NOT NULL`, [o]) <= 1, "the first period was corrected at most once");
      assert.equal(await rowCount(`SELECT count(*) FROM public.company_operating_scope_periods a JOIN public.company_operating_scope_periods b ON a.organization_id = b.organization_id AND a.id < b.id AND a.record_status = 'active' AND b.record_status = 'active' AND tstzrange(a.effective_from, a.effective_to) && tstzrange(b.effective_from, b.effective_to) WHERE a.organization_id = $1`, [o]), 0, "no two genuine periods overlap");
    });

    scenario("6. the database alone arbitrates racing writers that bypass the service (one current per fact)", async () => {
      const o = await org();
      const inserts: Array<[string, string, unknown[]]> = [
        ["company_operating_scope_periods", `INSERT INTO public.company_operating_scope_periods (organization_id, operating_scope, effective_from) VALUES ($1, 'CANADA', $2)`, [o, MONTH(1)]],
        ["company_rule_applicability_periods", `INSERT INTO public.company_rule_applicability_periods (organization_id, rule_code, applicability, effective_from) VALUES ($1, 'DG_US', 'APPLIES', $2)`, [o, MONTH(1)]],
        ["company_driver_requirement_periods", `INSERT INTO public.company_driver_requirement_periods (organization_id, minimum_driver_age_years, minimum_driver_experience_months, effective_from) VALUES ($1, 21, 24, $2)`, [o, MONTH(1)]],
      ];
      for (const [table, sql, params] of inserts) {
        const [first, second] = [await pools.runtime.connect(), await pools.runtime.connect()];
        try {
          await first.query("BEGIN");
          await second.query("BEGIN");
          await first.query(sql, params);
          const blocked = second.query(sql, params);
          await new Promise((resolve) => setTimeout(resolve, 150));
          await first.query("COMMIT");
          await assert.rejects(blocked, (error: { code?: string; constraint?: string }) => error.code === "23505" && error.constraint === `${table}_current_uq`, table);
        } finally {
          await first.query("ROLLBACK").catch(() => undefined);
          await second.query("ROLLBACK").catch(() => undefined);
          first.release();
          second.release();
        }
        assert.equal(await rowCount(`SELECT count(*) FROM public.${table} WHERE organization_id = $1`, [o]), 1, table);
      }
    });
  });
});
