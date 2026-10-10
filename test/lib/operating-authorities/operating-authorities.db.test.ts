// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// These drive the REAL Operating Authority service through the REAL authorization wrappers and Clerk-to-actor
// resolution, on pooled connections that log in as the RUNTIME role, against a database with migrations 0001-0013 applied.

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
    oa: await import("@/lib/operating-authorities/service"),
    defs: await import("@/lib/operating-authorities/definitions"),
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
const TABLES = ["authority_kinds", "operating_authorities", "operating_authority_versions", "operating_authority_status_periods"] as const;
const BUSINESS_TABLES = ["operating_authorities", "operating_authority_versions", "operating_authority_status_periods"] as const;
const KINDS = ["USDOT", "MC", "MVID", "RIN", "CVOR", "SAFETY_FITNESS", "IRP"] as const;
type Kind = (typeof KINDS)[number];

describe("Operating Authorities (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
  /** Customer-owned Organizations: their authorities are purged here, the Organization itself by the fixtures. */
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
      const ids = `(SELECT id FROM public.operating_authorities WHERE organization_id = ANY($1::uuid[]))`;
      await client.query(`DELETE FROM public.operating_authority_status_periods WHERE authority_id IN ${ids}`, [owned]);
      await client.query(`DELETE FROM public.operating_authority_versions WHERE authority_id IN ${ids}`, [owned]);
      await client.query(`DELETE FROM public.operating_authorities WHERE organization_id = ANY($1::uuid[])`, [owned]);
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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `OA ${label} ${id.slice(0, 8)} ${++counter}`]);
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

  // Numbers are unique per run so parallel/previous data never collides.
  const unique = () => String(1_000_000 + ((Date.now() + ++counter * 7919) % 8_000_000));
  const alnum = (prefix = "T") => `${prefix}${unique()}`;
  const numberFor = (kind: Kind): string => {
    if (kind === "CVOR" || kind === "RIN") return String(100_000_000 + ((Date.now() + ++counter * 104729) % 800_000_000));
    if (kind === "USDOT" || kind === "MC") return unique();
    return alnum(kind.slice(0, 2));
  };
  const jurisdictionFor = (kind: Kind): unknown => {
    switch (kind) {
      case "USDOT":
      case "MC":
        return undefined;
      case "CVOR":
      case "RIN":
        return { region: "ON" };
      case "IRP":
        return { country: "US", region: "TX" };
      default:
        return { region: "AB" };
    }
  };
  const create = (organizationId: string, kind: Kind, over: Record<string, unknown> = {}) =>
    K.oa.createAuthority({ organizationId, kind, number: numberFor(kind), jurisdiction: jurisdictionFor(kind), ...over } as never);

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const denied = (promise: Promise<unknown>) => rejectsWith(promise, K.authz.TesAuthorizationDeniedError);
  const rowCount = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const eventTypes = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_id`, [actorId])).rows.map((row) => row.event_type);
  const eventsJson = async (actorId: string) =>
    JSON.stringify((await pools.admin.query(`SELECT * FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId])).rows);
  const MONTH = (n: number) => `2020-${String(n).padStart(2, "0")}-01T00:00:00Z`;

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
    const actors = await Promise.all(Array.from({ length: count }, () => staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ")));
    return <T>(index: number, work: () => Promise<T>) => K.db.withClerkUser(actors[index].clerkSubject, work);
  }

  // =============================================================================================================
  describe("schema (migration 0013)", () => {
    scenario("tables, catalogue seed, constraints, indexes, functions and triggers exist; the ledger records 0013", async () => {
      const names = async (sql: string) => (await pools.admin.query<{ n: string }>(sql)).rows.map((row) => row.n);
      assert.deepEqual(
        await names(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('authority_kinds','operating_authorities','operating_authority_versions','operating_authority_status_periods') ORDER BY 1`),
        ["authority_kinds", "operating_authorities", "operating_authority_status_periods", "operating_authority_versions"],
      );
      assert.deepEqual(await names(`SELECT code AS n FROM public.authority_kinds ORDER BY sort_order`), [...KINDS]);
      const indexes = await names(`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'operating_authorit%'`);
      for (const expected of [
        "operating_authority_versions_current_uq", "operating_authority_versions_current_identity_uq",
        "operating_authority_versions_current_number_uq", "operating_authority_versions_history_idx",
        "operating_authority_versions_number_lookup_idx", "operating_authority_status_periods_current_uq",
        "operating_authority_status_periods_history_idx", "operating_authorities_organization_idx",
      ]) assert.ok(indexes.includes(expected), expected);
      const triggers = await names(`SELECT tgname AS n FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE 'operating_authorit%'`);
      for (const expected of [
        "operating_authorities_guard_update", "operating_authorities_require_current_state",
        "operating_authority_versions_guard_insert", "operating_authority_versions_guard_update",
        "operating_authority_status_periods_guard_insert", "operating_authority_status_periods_guard_update",
        ...BUSINESS_TABLES.flatMap((table) => [`${table}_no_delete`, `${table}_no_truncate`]),
      ]) assert.ok(triggers.includes(expected), expected);

      const ledger = await pools.admin.query<{ sha256: string }>(`SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0013'`);
      assert.equal(ledger.rowCount, 1);
      const file = readFileSync(path.resolve(import.meta.dirname, "../../../database/migrations/0013_operating_authorities_foundation.sql"));
      assert.equal(ledger.rows[0].sha256, createHash("sha256").update(file).digest("hex"));
    });

    scenario("the server definitions agree with the persisted catalogue, and the identity index covers exactly the one-current-per-Organization kinds", async () => {
      const rows = (await pools.admin.query(`SELECT * FROM public.authority_kinds ORDER BY sort_order`)).rows;
      assert.equal(rows.length, K.defs.AUTHORITY_KINDS.length);
      for (const row of rows) {
        const def = K.defs.KIND_DEFINITIONS[row.code as Kind];
        assert.ok(def, row.code);
        assert.equal(row.jurisdiction_scope, def.jurisdictionScope, row.code);
        assert.equal(row.issuer_country, def.issuerCountry, row.code);
        assert.equal(row.region_required, def.regionRequired, row.code);
        assert.equal(row.fixed_region, def.fixedRegion, row.code);
        assert.equal(row.has_expiry, def.hasExpiry, row.code);
        assert.equal(row.one_current_per_organization, def.oneCurrentPerOrganization, row.code);
      }
      const indexdef = (await pools.admin.query<{ d: string }>(`SELECT pg_get_indexdef('public.operating_authority_versions_current_identity_uq'::regclass) AS d`)).rows[0].d;
      for (const kind of KINDS) {
        const def = K.defs.KIND_DEFINITIONS[kind];
        assert.equal(indexdef.includes(`'${kind}'`), def.oneCurrentPerOrganization, `identity index coverage of ${kind}`);
      }
    });

    scenario("no new capability, no unintended SECURITY DEFINER, no RLS, no policy", async () => {
      const codes = (await pools.admin.query<{ code: string }>(`SELECT code FROM public.capabilities ORDER BY code`)).rows.map((row) => row.code);
      assert.deepEqual(codes, ["CUSTOMER_ESTABLISH", "ORGANIZATION_ARCHIVE", "ORGANIZATION_CREATE", "ORGANIZATION_READ", "ORGANIZATION_REGISTRY_READ", "ORGANIZATION_UPDATE"]);
      const functions = (await pools.admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
        `SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'tes_security' AND p.proname ~ '(authority|authorities)'`,
      )).rows;
      assert.equal(functions.length, 7);
      for (const fn of functions) {
        assert.equal(fn.prosecdef, false, fn.proname);
        assert.deepEqual(fn.proconfig, ["search_path=pg_catalog"], fn.proname);
      }
      for (const table of TABLES) {
        assert.equal((await pools.admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${table}`])).rows[0].relrowsecurity, false, table);
      }
      assert.equal(await rowCount(`SELECT count(*) FROM pg_policies WHERE tablename LIKE 'operating_authorit%' OR tablename = 'authority_kinds'`), 0);
    });

    scenario("runtime privileges: no DELETE/TRUNCATE anywhere, no content rewrites, no PUBLIC privilege", async () => {
      const has = async (sql: string, params: unknown[]) => (await pools.admin.query<{ ok: boolean }>(sql, params)).rows[0].ok;
      for (const table of TABLES) {
        for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"].filter((p) => table === "authority_kinds" || p === "DELETE" || p === "TRUNCATE" || p === "REFERENCES" || p === "TRIGGER")) {
          assert.equal(await has(`SELECT has_table_privilege($1, $2, $3) AS ok`, [RUNTIME_ROLE, `public.${table}`, privilege]), false, `${table} ${privilege}`);
        }
        assert.equal(await has(`SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [RUNTIME_ROLE, `public.${table}`]), true, table);
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          assert.equal(await has(`SELECT has_table_privilege('public', $1, $2) AS ok`, [`public.${table}`, privilege]), false, `PUBLIC ${table} ${privilege}`);
        }
      }
      const column = (table: string, name: string, privilege: string) =>
        has(`SELECT has_column_privilege($1, $2, $3, $4) AS ok`, [RUNTIME_ROLE, `public.${table}`, name, privilege]);
      assert.equal(await column("operating_authorities", "organization_id", "INSERT"), true);
      assert.equal(await column("operating_authorities", "kind", "INSERT"), true);
      for (const name of ["organization_id", "kind", "id", "created_at"]) assert.equal(await column("operating_authorities", name, "UPDATE"), false, `authorities.${name}`);
      for (const name of ["record_status", "archived_at", "updated_at"]) assert.equal(await column("operating_authorities", name, "UPDATE"), true, name);
      for (const name of ["number_display", "number_normalized", "normalization_rule_version", "jurisdiction_country", "jurisdiction_region", "issued_on", "expires_on", "authority_id", "organization_id", "kind", "effective_from", "version_reason", "created_at"]) {
        assert.equal(await column("operating_authority_versions", name, "UPDATE"), false, `versions.${name}`);
      }
      for (const name of ["effective_to", "record_status", "corrected_at", "superseded_by_version_id"]) assert.equal(await column("operating_authority_versions", name, "UPDATE"), true, name);
      for (const name of ["authority_status", "authority_id", "period_reason", "effective_from", "created_at"]) assert.equal(await column("operating_authority_status_periods", name, "UPDATE"), false, `periods.${name}`);
      for (const name of ["effective_to", "record_status", "corrected_at", "superseded_by_period_id"]) assert.equal(await column("operating_authority_status_periods", name, "UPDATE"), true, name);
      for (const table of TABLES) {
        await assert.rejects(pools.runtime.query(`DELETE FROM public.${table}`), /permission denied/, table);
        await assert.rejects(pools.runtime.query(`TRUNCATE public.${table}`), /permission denied/, table);
      }
      await assert.rejects(pools.runtime.query(`INSERT INTO public.authority_kinds (code, display_name, description, jurisdiction_scope, issuer_country, region_required, has_expiry, sort_order) VALUES ('X','x','x','NATIONAL','US',false,false,99)`), /permission denied/);
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
        const authority = async (kind: string) => (await client.query<{ id: string }>(`INSERT INTO public.operating_authorities (organization_id, kind) VALUES ($1, $2) RETURNING id`, [orgId, kind])).rows[0].id;
        const version = (id: string, kind: string, number: string, country: string, region: string | null, extra = "") =>
          client.query<{ id: string }>(
            `INSERT INTO public.operating_authority_versions (authority_id, organization_id, kind, number_display, number_normalized, normalization_rule_version, jurisdiction_country, jurisdiction_region, version_reason, effective_from${extra ? ", expires_on" : ""})
             VALUES ($1, $2, $3, $4, $4, 'test.v1', $5, $6, 'INITIAL', '2020-01-01Z'${extra ? ", '2030-01-01'" : ""}) RETURNING id`,
            [id, orgId, kind, number, country, region],
          );
        const usdot = await authority("USDOT");
        const v1 = (await version(usdot, "USDOT", "1", "US", null)).rows[0].id;
        await client.query(`INSERT INTO public.operating_authority_status_periods (authority_id, authority_status, period_reason, effective_from) VALUES ($1, 'ACTIVE', 'INITIAL', '2020-01-01Z')`, [usdot]);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("SET CONSTRAINTS ALL DEFERRED");

        await expectFailure(`INSERT INTO public.operating_authority_status_periods (authority_id, authority_status, period_reason, effective_from) VALUES ($1, 'EXPIRED', 'INITIAL', now())`, [usdot], /status_valid/);
        await expectFailure(`INSERT INTO public.operating_authorities (organization_id, kind) VALUES ($1, 'UCR')`, [orgId], /foreign key/);
        // one current version, one current status period
        await expectFailure(`INSERT INTO public.operating_authority_versions (authority_id, organization_id, kind, number_display, number_normalized, normalization_rule_version, jurisdiction_country, version_reason, effective_from) VALUES ($1, $2, 'USDOT', '2', '2', 'x', 'US', 'CHANGE', now())`, [usdot, orgId], /current_uq/);
        await expectFailure(`INSERT INTO public.operating_authority_status_periods (authority_id, authority_status, period_reason, effective_from) VALUES ($1, 'INACTIVE', 'TRANSITION', now())`, [usdot], /current_uq/);
        // a version must carry its authority's organization and kind
        await expectFailure(`INSERT INTO public.operating_authority_versions (authority_id, organization_id, kind, number_display, number_normalized, normalization_rule_version, jurisdiction_country, version_reason, effective_from) VALUES ($1, $2, 'MC', '2', '2', 'x', 'US', 'INITIAL', now())`, [usdot, orgId], /organization_fk|foreign key|current_uq/);
        // jurisdiction rules of the kind
        const cvor = await authority("CVOR");
        await expectFailure(`INSERT INTO public.operating_authority_versions (authority_id, organization_id, kind, number_display, number_normalized, normalization_rule_version, jurisdiction_country, jurisdiction_region, version_reason, effective_from) VALUES ($1, $2, 'CVOR', '123456789', '123456789', 'x', 'CA', 'AB', 'INITIAL', now())`, [cvor, orgId], /jurisdiction does not satisfy/);
        await expectFailure(`INSERT INTO public.operating_authority_versions (authority_id, organization_id, kind, number_display, number_normalized, normalization_rule_version, jurisdiction_country, version_reason, effective_from) VALUES ($1, $2, 'USDOT', '9', '9', 'x', 'CA', 'INITIAL', now())`, [usdot, orgId], /current_uq|jurisdiction does not satisfy/);
        // expiry only where it applies
        const mc = await authority("MC");
        await expectFailure(`INSERT INTO public.operating_authority_versions (authority_id, organization_id, kind, number_display, number_normalized, normalization_rule_version, jurisdiction_country, version_reason, effective_from, expires_on) VALUES ($1, $2, 'MC', '5', '5', 'x', 'US', 'INITIAL', now(), '2030-01-01')`, [mc, orgId], /expiry date does not apply/);
        // identity and content are immutable
        await expectFailure(`UPDATE public.operating_authorities SET organization_id = gen_random_uuid() WHERE id = $1`, [usdot], /identity is immutable|foreign key/);
        await expectFailure(`UPDATE public.operating_authorities SET kind = 'MC' WHERE id = $1`, [usdot], /identity is immutable/);
        await expectFailure(`UPDATE public.operating_authority_versions SET number_normalized = '99' WHERE id = $1`, [v1], /content is immutable/);
        await expectFailure(`UPDATE public.operating_authority_status_periods SET authority_status = 'REVOKED' WHERE authority_id = $1`, [usdot], /content is immutable/);
        // a correction does not end a version; ended versions cannot be re-dated; no deletes
        await expectFailure(`UPDATE public.operating_authority_versions SET record_status = 'corrected', corrected_at = now(), effective_to = now(), superseded_by_version_id = id WHERE id = $1`, [v1], /not_superseded_by_self|must not set effective_to/);
        await expectFailure(`DELETE FROM public.operating_authority_versions WHERE id = $1`, [v1], /preserved/);
        await expectFailure(`DELETE FROM public.operating_authorities WHERE id = $1`, [usdot], /preserved/);
        await expectFailure(`TRUNCATE public.operating_authority_status_periods`, [], /preserved/);
        // an authority without a current version / status cannot commit
        const bare = await authority("RIN");
        void bare;
        await assert.rejects(client.query("SET CONSTRAINTS ALL IMMEDIATE"), /must have a current/);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
    scenario("the number index is the owner-level backstop: national numbers (NULL region) and namespaced numbers cannot be held twice", async () => {
      const client = await pools.admin.connect();
      const [a, b] = [await org("A"), await org("B")];
      try {
        await client.query("BEGIN");
        await client.query("SET CONSTRAINTS ALL DEFERRED");
        const hold = async (orgId: string, kind: string, number: string, country: string, region: string | null) => {
          const id = (await client.query<{ id: string }>(`INSERT INTO public.operating_authorities (organization_id, kind) VALUES ($1, $2) RETURNING id`, [orgId, kind])).rows[0].id;
          await client.query(
            `INSERT INTO public.operating_authority_versions (authority_id, organization_id, kind, number_display, number_normalized, normalization_rule_version, jurisdiction_country, jurisdiction_region, version_reason, effective_from)
             VALUES ($1, $2, $3, $4, $4, 'test.v1', $5, $6, 'INITIAL', '2020-01-01Z')`,
            [id, orgId, kind, number, country, region],
          );
        };
        const attempt = async (orgId: string, kind: string, number: string, country: string, region: string | null) => {
          await client.query("SAVEPOINT s");
          await assert.rejects(hold(orgId, kind, number, country, region), /current_number_uq/, `${kind} ${number}`);
          await client.query("ROLLBACK TO SAVEPOINT s");
        };
        await hold(a, "MC", "4242", "US", null);
        await attempt(b, "MC", "4242", "US", null);
        await hold(a, "MVID", "AB4242", "CA", "AB");
        await attempt(b, "MVID", "AB4242", "CA", "AB");
        await client.query("SAVEPOINT s");
        await hold(b, "MVID", "AB4242", "CA", "BC"); // another province is another namespace
        await client.query("RELEASE SAVEPOINT s");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
  });

  // =============================================================================================================
  describe("creation, kinds and normalization", () => {
    for (const kind of KINDS) {
      scenario(`creates a ${kind} authority with display/normalized/rule version, an initial status and one Master Register event`, async () => {
        const actor = await fullStaff();
        const o = await org();
        const raw = kind === "USDOT" ? "USDOT 00123456" : kind === "MC" ? "MC-0123456" : kind === "CVOR" ? "123-456-789" : kind === "RIN" ? "987 654 321" : "ab-1234.56";
        const { view } = await K.oa.createAuthority({ organizationId: o, kind, number: raw, jurisdiction: jurisdictionFor(kind) } as never);
        const version = view.current.version!;
        assert.equal(view.authority.kind, kind);
        assert.equal(view.authority.organizationId, o);
        assert.equal(view.authority.recordStatus, "active");
        assert.equal(version.numberDisplay, raw);
        assert.equal(version.numberNormalized, K.defs.prepareAuthorityNumber(kind, raw).normalized);
        assert.equal(version.normalizationRuleVersion, K.defs.KIND_DEFINITIONS[kind].rule.version);
        assert.equal(version.versionReason, "INITIAL");
        assert.equal(view.current.status!.authorityStatus, "ACTIVE");
        assert.equal(view.current.status!.periodReason, "INITIAL");
        assert.deepEqual(await eventTypes(actor.actorId), ["RECORD_CREATED"]);
        // stable references only: no raw number in the Master Register
        const json = await eventsJson(actor.actorId);
        assert.equal(json.includes(version.numberNormalized) && version.numberNormalized.length > 6, false, "no normalized number in the register");
        assert.equal(json.includes(raw), false, "no display number in the register");
      });
    }

    scenario("CVOR defaults to Ontario; expiry is accepted only where it applies; initial status may be PENDING", async () => {
      await fullStaff();
      const o = await org();
      const cvor = await K.oa.createAuthority({ organizationId: o, kind: "CVOR", number: "111222333", expiresOn: "2030-06-30", issuedOn: "2020-06-30", status: "PENDING" });
      assert.equal(cvor.view.current.version!.jurisdictionRegion, "ON");
      assert.equal(cvor.view.current.version!.expiresOn, "2030-06-30");
      assert.equal(cvor.view.current.status!.authorityStatus, "PENDING");
      await rejectsWith(K.oa.createAuthority({ organizationId: o, kind: "USDOT", number: unique(), expiresOn: "2030-01-01" }), K.oa.OperatingAuthorityValidationError);
      await rejectsWith(K.oa.createAuthority({ organizationId: o, kind: "IRP", number: alnum("IR"), jurisdiction: { country: "US", region: "TX" }, expiresOn: "2030-01-01" }), K.oa.OperatingAuthorityValidationError);
      await rejectsWith(K.oa.createAuthority({ organizationId: o, kind: "SAFETY_FITNESS", number: alnum("SF"), jurisdiction: { region: "AB" }, issuedOn: "2025-01-01", expiresOn: "2024-01-01" }), K.oa.OperatingAuthorityValidationError);
      await rejectsWith(K.oa.createAuthority({ organizationId: o, kind: "MVID", number: alnum("MV") }), K.oa.OperatingAuthorityValidationError);
      await rejectsWith(K.oa.createAuthority({ organizationId: o, kind: "UCR" as never, number: "1" }), K.oa.OperatingAuthorityValidationError);
      await rejectsWith(K.oa.createAuthority({ organizationId: o, kind: "MC", number: unique(), status: "EXPIRED" as never }), K.oa.OperatingAuthorityValidationError);
      await rejectsWith(K.oa.createAuthority({ organizationId: o, kind: "MC", number: unique(), evidenceComplete: true } as never), K.oa.OperatingAuthorityValidationError);
      await rejectsWith(K.oa.createAuthority({ organizationId: randomUUID(), kind: "MC", number: unique() }), K.oa.OperatingAuthorityNotFoundError);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1`, [o]), 1, "rejected creations left nothing behind");
    });

    scenario("an archived or merged Organization cannot gain authorities", async () => {
      await fullStaff();
      const o = await org();
      await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [o]).catch(() => undefined);
      const status = (await pools.admin.query(`SELECT status FROM public.organizations WHERE id = $1`, [o])).rows[0].status;
      if (status === "archived") await rejectsWith(create(o, "MC"), K.oa.OperatingAuthorityStateError);
    });
  });

  // =============================================================================================================
  describe("collisions and cross-Organization disclosure", () => {
    scenario("national namespace: USDOT and MC collide across Organizations regardless of formatting", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const n = unique();
      await K.oa.createAuthority({ organizationId: a, kind: "USDOT", number: `USDOT ${n}` });
      await rejectsWith(K.oa.createAuthority({ organizationId: b, kind: "USDOT", number: `0${n}` }), K.oa.AuthorityNumberCollisionError);
      const m = unique();
      await K.oa.createAuthority({ organizationId: a, kind: "MC", number: `MC-${m}` });
      await rejectsWith(K.oa.createAuthority({ organizationId: b, kind: "MC", number: m }), K.oa.AuthorityNumberCollisionError);
      // same text in another KIND is a different namespace
      await K.oa.createAuthority({ organizationId: b, kind: "MC", number: n });
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1`, [b]), 1);
    });

    scenario("country+region namespaces: MVID/SAFETY_FITNESS per issuing province, RIN/CVOR Ontario only, never across kinds", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      for (const kind of ["MVID", "SAFETY_FITNESS"] as const) {
        const number = alnum(kind.slice(0, 2));
        await K.oa.createAuthority({ organizationId: a, kind, number, jurisdiction: { region: "AB" } });
        await rejectsWith(K.oa.createAuthority({ organizationId: b, kind, number: number.toLowerCase(), jurisdiction: { region: "AB" } }), K.oa.AuthorityNumberCollisionError);
        // same number in another province is a different namespace
        await K.oa.createAuthority({ organizationId: b, kind, number, jurisdiction: { region: "BC" } });
      }
      // MVID and SAFETY_FITNESS are separate kinds: the same text in each never collides
      const shared = alnum("XX");
      const c = await org("C");
      await K.oa.createAuthority({ organizationId: c, kind: "MVID", number: shared, jurisdiction: { region: "MB" } });
      await K.oa.createAuthority({ organizationId: c, kind: "SAFETY_FITNESS", number: shared, jurisdiction: { region: "MB" } });
      // CVOR and RIN are separate Ontario namespaces: the same nine digits in each never collide, within one kind they do
      const digits = String(300_000_000 + (counter % 1000));
      await K.oa.createAuthority({ organizationId: c, kind: "CVOR", number: digits });
      await K.oa.createAuthority({ organizationId: c, kind: "RIN", number: digits });
      await rejectsWith(K.oa.createAuthority({ organizationId: a, kind: "CVOR", number: digits }), K.oa.AuthorityNumberCollisionError);
      await rejectsWith(K.oa.createAuthority({ organizationId: a, kind: "RIN", number: digits }), K.oa.AuthorityNumberCollisionError);
      // CVOR has an authoritative nine-digit format; RIN's format is deliberately not asserted
      await rejectsWith(K.oa.createAuthority({ organizationId: a, kind: "CVOR", number: "12345678" }), K.oa.OperatingAuthorityValidationError);
      await rejectsWith(K.oa.createAuthority({ organizationId: a, kind: "RIN", number: numberFor("RIN"), jurisdiction: { region: "AB" } }), K.oa.OperatingAuthorityValidationError);
    });

    scenario("IRP: base-jurisdiction namespace; the same number in another base jurisdiction is allowed", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const number = alnum("IR");
      await K.oa.createAuthority({ organizationId: a, kind: "IRP", number, jurisdiction: { country: "US", region: "TX" } });
      await rejectsWith(K.oa.createAuthority({ organizationId: b, kind: "IRP", number, jurisdiction: { country: "US", region: "TX" } }), K.oa.AuthorityNumberCollisionError);
      await K.oa.createAuthority({ organizationId: b, kind: "IRP", number, jurisdiction: { country: "CA", region: "AB" } });
    });

    scenario("with ORGANIZATION_REGISTRY_READ the collision names the holder; without it the result is generic", async () => {
      const full = await staff("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ");
      const blind = await staff("ORGANIZATION_UPDATE");
      const [a, b] = [await org("A"), await org("B")];
      const n = unique();
      signIn(full);
      const held = await K.oa.createAuthority({ organizationId: a, kind: "USDOT", number: n });

      const collide = async () => {
        try {
          await K.oa.createAuthority({ organizationId: b, kind: "USDOT", number: n });
        } catch (error) {
          assert.ok(error instanceof K.oa.AuthorityNumberCollisionError);
          return error as InstanceType<typeof K.oa.AuthorityNumberCollisionError>;
        }
        assert.fail("expected a collision");
      };
      const visible = await collide();
      assert.equal(visible.match?.organizationId, a);
      assert.equal(visible.match?.authorityId, held.view.authority.id);
      assert.equal(visible.match?.recommendedAction, "OPEN_EXISTING");

      signIn(blind);
      const hidden = await collide();
      assert.equal(hidden.match, undefined);
      assert.equal(JSON.stringify(hidden).includes(a), false);
      assert.equal(hidden.message, visible.message);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1`, [b]), 0);
    });

    scenario("an archived or canceled authority keeps holding its number; the registry recommends restoring it", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const n = unique();
      const held = (await K.oa.createAuthority({ organizationId: a, kind: "MC", number: n })).view;
      await K.oa.changeAuthorityStatus({ organizationId: a, authorityId: held.authority.id, status: "CANCELED" });
      await K.oa.archiveAuthority({ organizationId: a, authorityId: held.authority.id });
      await assert.rejects(K.oa.createAuthority({ organizationId: b, kind: "MC", number: n }), (error: unknown) => {
        assert.ok(error instanceof K.oa.AuthorityNumberCollisionError);
        assert.equal(error.match?.recommendedAction, "RESTORE_ARCHIVED");
        return true;
      });
      // the same Organization cannot silently re-create the same number either (restore is the path back)
      await rejectsWith(K.oa.createAuthority({ organizationId: a, kind: "MC", number: n }), K.oa.AuthorityNumberCollisionError);
      // a USDOT keeps holding the Organization's one-USDOT identity while canceled and archived
      const usdot = (await create(a, "USDOT")).view;
      await K.oa.changeAuthorityStatus({ organizationId: a, authorityId: usdot.authority.id, status: "CANCELED" });
      await K.oa.archiveAuthority({ organizationId: a, authorityId: usdot.authority.id });
      await rejectsWith(create(a, "USDOT"), K.oa.OperatingAuthorityConflictError);
      await K.oa.restoreAuthority({ organizationId: a, authorityId: usdot.authority.id });
    });

    scenario("MC docket identity: the docket number is held once, never duplicated for another record, and a per-docket child can reference it later", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const docket = unique();
      const held = (await K.oa.createAuthority({ organizationId: a, kind: "MC", number: `MC-${docket}` })).view;
      // the same docket cannot be recorded again, in this Organization or any other
      await rejectsWith(K.oa.createAuthority({ organizationId: a, kind: "MC", number: docket }), K.oa.AuthorityNumberCollisionError);
      await rejectsWith(K.oa.createAuthority({ organizationId: b, kind: "MC", number: docket }), K.oa.AuthorityNumberCollisionError);
      // one status history belongs to the docket record (entitlement-level status is deferred)
      assert.equal(held.statusPeriods.filter((p) => p.recordStatus === "active" && p.effectiveTo === null).length, 1);
      // an additive child (several entitlements per docket, each with its own history) needs no change to 0013
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        await client.query(`CREATE TABLE public.zz_entitlement_probe (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), authority_id uuid NOT NULL, kind text NOT NULL CHECK (kind = 'MC'),
          entitlement_type text NOT NULL, status text NOT NULL,
          FOREIGN KEY (authority_id, kind) REFERENCES public.operating_authorities (id, kind))`);
        for (const type of ["COMMON", "BROKER"]) {
          await client.query(`INSERT INTO public.zz_entitlement_probe (authority_id, kind, entitlement_type, status) VALUES ($1, 'MC', $2, $3)`, [held.authority.id, type, type === "COMMON" ? "ACTIVE" : "REVOKED"]);
        }
        assert.equal(Number((await client.query(`SELECT count(*) FROM public.zz_entitlement_probe WHERE authority_id = $1`, [held.authority.id])).rows[0].count), 2);
        await client.query("SAVEPOINT s");
        await assert.rejects(client.query(`INSERT INTO public.zz_entitlement_probe (authority_id, kind, entitlement_type, status) VALUES ($1, 'MC', 'X', 'ACTIVE')`, [(await client.query<{ id: string }>(`SELECT id FROM public.operating_authorities WHERE organization_id = $1 AND kind = 'MC' AND id <> $2 LIMIT 1`, [b, held.authority.id])).rows[0]?.id ?? randomUUID()]), /foreign key/);
        await client.query("ROLLBACK TO SAVEPOINT s");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });

    scenario("checkAuthorityNumber is read-only, needs ORGANIZATION_REGISTRY_READ and writes no Master Register event", async () => {
      const actor = await fullStaff();
      const o = await org();
      const n = unique();
      await K.oa.createAuthority({ organizationId: o, kind: "USDOT", number: n });
      const before = await eventTypes(actor.actorId);
      const hit = await K.oa.checkAuthorityNumber({ kind: "USDOT", number: `DOT ${n}` });
      assert.equal(hit.registered, true);
      assert.equal(hit.match?.organizationId, o);
      const miss = await K.oa.checkAuthorityNumber({ kind: "USDOT", number: unique() });
      assert.equal(miss.registered, false);
      assert.deepEqual(await eventTypes(actor.actorId), before);

      signIn(await staff("ORGANIZATION_UPDATE"));
      await denied(K.oa.checkAuthorityNumber({ kind: "USDOT", number: n }));
    });

    scenario("the number index is the backstop against concurrent creation of the same number", async () => {
      const as = await concurrentActors(4);
      const orgs = await Promise.all([org(), org(), org(), org()]);
      const number = alnum("CC");
      const results = await Promise.allSettled(orgs.map((id, i) => as(i, () => K.oa.createAuthority({ organizationId: id, kind: "MVID", number, jurisdiction: { region: "SK" } }))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.oa.AuthorityNumberCollisionError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authority_versions WHERE kind = 'MVID' AND number_normalized = $1 AND record_status = 'active' AND effective_to IS NULL`, [number.toUpperCase()]), 1);
    });
  });

  // =============================================================================================================
  describe("identity invariants", () => {
    scenario("one current USDOT per Organization; every other kind is distinguished by its number, not claimed one-per-Organization", async () => {
      await fullStaff();
      const o = await org();
      await create(o, "USDOT");
      await rejectsWith(create(o, "USDOT"), K.oa.OperatingAuthorityConflictError);
      // regulator documentation does not establish one-per-Organization for these kinds: several records, each with its own number
      for (const kind of ["MC", "IRP", "CVOR", "RIN", "MVID", "SAFETY_FITNESS"] as const) {
        const first = (await create(o, kind)).view.authority.id;
        const second = (await create(o, kind)).view.authority.id;
        assert.notEqual(first, second, kind);
      }
      // ... but never the same number twice in one namespace, not even within the Organization
      const held = (await create(o, "MC")).view.current.version!.numberNormalized;
      await rejectsWith(K.oa.createAuthority({ organizationId: o, kind: "MC", number: held }), K.oa.AuthorityNumberCollisionError);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1 AND kind = 'USDOT'`, [o]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1 AND kind = 'MC'`, [o]), 3);
    });

    scenario("concurrent creation of distinct MC dockets in one Organization all succeed; the same docket yields exactly one", async () => {
      const as = await concurrentActors(4);
      const o = await org();
      const distinct = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => as(i, () => create(o, "MC"))));
      assert.equal(distinct.filter((r) => r.status === "fulfilled").length, 4, JSON.stringify(distinct.filter((r) => r.status === "rejected")));
      const number = unique();
      const same = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => as(i, () => K.oa.createAuthority({ organizationId: o, kind: "MC", number }))));
      assert.equal(same.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of same) if (r.status === "rejected") assert.ok(r.reason instanceof K.oa.AuthorityNumberCollisionError, String(r.reason));
    });

    scenario("concurrent creation of one identity in one Organization yields exactly one authority (USDOT)", async () => {
      const as = await concurrentActors(4);
      const o = await org();
      const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => as(i, () => create(o, "USDOT"))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.oa.OperatingAuthorityConflictError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1`, [o]), 1);
    });

    scenario("every authority always has exactly one current genuine version and one current status", async () => {
      await fullStaff();
      const o = await org();
      const { view } = await create(o, "SAFETY_FITNESS", { expiresOn: "2030-01-01", effectiveFrom: MONTH(1) });
      const id = view.authority.id;
      await K.oa.changeAuthorityVersion({ organizationId: o, authorityId: id, expiresOn: "2031-01-01", effectiveFrom: MONTH(3) });
      await K.oa.correctAuthorityVersion({ organizationId: o, authorityId: id, issuedOn: "2020-01-01" });
      await K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: "SUSPENDED", effectiveFrom: MONTH(4) });
      await K.oa.correctAuthorityStatus({ organizationId: o, authorityId: id, status: "INACTIVE" });
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authority_versions WHERE authority_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authority_status_periods WHERE authority_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]), 1);
    });
  });

  // =============================================================================================================
  describe("status, reactivation, archive", () => {
    scenario("status history records observed status without a universal transition matrix; a return to ACTIVE is a recorded reactivation of the same authority", async () => {
      const actor = await fullStaff();
      const o = await org();
      const created = (await create(o, "MC", { effectiveFrom: MONTH(1) })).view;
      const id = created.authority.id;
      const number = created.current.version!.numberNormalized;
      const t = (status: string, month: number) => K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: status as never, effectiveFrom: MONTH(month) });

      await rejectsWith(t("ACTIVE", 2), K.oa.OperatingAuthorityStateError); // unchanged is the only refusal
      await t("SUSPENDED", 2);
      // returning to ACTIVE through the ordinary operation is recorded as a reactivation of the SAME authority
      const reactivated = await t("ACTIVE", 3);
      assert.equal(reactivated.authority.id, id);
      assert.equal(reactivated.current.version!.numberNormalized, number);
      assert.equal(reactivated.current.status!.authorityStatus, "ACTIVE");
      assert.equal(reactivated.current.status!.periodReason, "REACTIVATION");
      await rejectsWith(K.oa.reactivateAuthority({ organizationId: o, authorityId: id }), K.oa.OperatingAuthorityStateError); // already ACTIVE

      // no invented legal matrix: REVOKED -> SUSPENDED and ACTIVE -> PENDING are simply recorded observations
      await t("REVOKED", 4);
      await t("SUSPENDED", 5);
      await K.oa.reactivateAuthority({ organizationId: o, authorityId: id, effectiveFrom: MONTH(6) });
      await t("PENDING", 7);
      const history = (await K.oa.getOrganizationAuthorities(o)).authorities[0].statusPeriods.filter((p) => p.recordStatus === "active");
      assert.deepEqual(history.map((p) => p.authorityStatus), ["ACTIVE", "SUSPENDED", "ACTIVE", "REVOKED", "SUSPENDED", "ACTIVE", "PENDING"]);
      assert.deepEqual(history.map((p) => p.periodReason), ["INITIAL", "TRANSITION", "REACTIVATION", "TRANSITION", "TRANSITION", "REACTIVATION", "TRANSITION"]);
      assert.equal(history.filter((p) => p.effectiveTo === null).length, 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1`, [o]), 1, "never a second authority");
      assert.deepEqual((await eventTypes(actor.actorId)).filter((e) => e === "RECORD_STATUS_CHANGED").length, 6);
    });

    scenario("a never-active PENDING authority is activated (not reactivated), and any status may be the first observation", async () => {
      await fullStaff();
      const o = await org();
      const id = (await create(o, "CVOR", { status: "PENDING" })).view.authority.id;
      await rejectsWith(K.oa.reactivateAuthority({ organizationId: o, authorityId: id }), K.oa.OperatingAuthorityStateError);
      const active = await K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: "ACTIVE" });
      assert.equal(active.current.status!.periodReason, "TRANSITION");
      for (const status of ["PENDING", "INACTIVE", "SUSPENDED", "REVOKED", "CANCELED", "ACTIVE"] as const) {
        const created = await create(o, "IRP", { status });
        assert.equal(created.view.current.status!.authorityStatus, status);
      }
    });

    scenario("a status correction preserves the wrong period, never ends it, and inherits its business time", async () => {
      await fullStaff();
      const o = await org();
      const id = (await create(o, "RIN", { effectiveFrom: MONTH(1) })).view.authority.id;
      const view = await K.oa.correctAuthorityStatus({ organizationId: o, authorityId: id, status: "INACTIVE" });
      const wrong = view.statusPeriods.find((p) => p.recordStatus === "corrected")!;
      const right = view.current.status!;
      assert.equal(wrong.authorityStatus, "ACTIVE");
      assert.equal(wrong.effectiveTo, null, "a correction never ends the wrong row");
      assert.equal(wrong.supersededByPeriodId, right.id);
      assert.equal(right.authorityStatus, "INACTIVE");
      assert.equal(right.periodReason, "CORRECTION");
      assert.equal(right.effectiveFrom, wrong.effectiveFrom);
      assert.equal(view.statusPeriods.filter((p) => p.recordStatus === "active").length, 1, "no invented transition");
      await rejectsWith(K.oa.correctAuthorityStatus({ organizationId: o, authorityId: id, status: "INACTIVE" }), K.oa.OperatingAuthorityValidationError);
    });

    scenario("archive is TES record lifecycle independent of regulatory status: allowed in any status, blocks changes, restore returns the same authority", async () => {
      const actor = await fullStaff();
      const o = await org();
      for (const status of ["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED", "REVOKED", "CANCELED"] as const) {
        const view = (await create(o, "MC", { status })).view;
        const archived = await K.oa.archiveAuthority({ organizationId: o, authorityId: view.authority.id });
        assert.equal(archived.authority.recordStatus, "archived", status);
        assert.equal(archived.current.status!.authorityStatus, status, "archive does not touch regulatory status");
        await K.oa.restoreAuthority({ organizationId: o, authorityId: view.authority.id });
      }
      const id = (await create(o, "MC")).view.authority.id;
      const archived = await K.oa.archiveAuthority({ organizationId: o, authorityId: id });
      assert.equal(archived.authority.recordStatus, "archived");
      assert.ok(archived.authority.archivedAt);
      await rejectsWith(K.oa.archiveAuthority({ organizationId: o, authorityId: id }), K.oa.OperatingAuthorityStateError);
      await rejectsWith(K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: "INACTIVE" }), K.oa.OperatingAuthorityStateError);
      await rejectsWith(K.oa.reactivateAuthority({ organizationId: o, authorityId: id }), K.oa.OperatingAuthorityStateError);
      await rejectsWith(K.oa.changeAuthorityVersion({ organizationId: o, authorityId: id, issuedOn: "2020-01-01" }), K.oa.OperatingAuthorityStateError);
      await rejectsWith(K.oa.correctAuthorityStatus({ organizationId: o, authorityId: id, status: "CANCELED" }), K.oa.OperatingAuthorityStateError);
      const restored = await K.oa.restoreAuthority({ organizationId: o, authorityId: id });
      assert.equal(restored.authority.id, id);
      assert.equal(restored.authority.recordStatus, "active");
      assert.equal(restored.authority.archivedAt, null);
      await rejectsWith(K.oa.restoreAuthority({ organizationId: o, authorityId: id }), K.oa.OperatingAuthorityStateError);
      const types = await eventTypes(actor.actorId);
      assert.ok(types.includes("RECORD_ARCHIVED") && types.includes("RECORD_RESTORED"));
    });

    scenario("an authority is only reachable through its own Organization", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const id = (await create(a, "MC")).view.authority.id;
      await rejectsWith(K.oa.changeAuthorityStatus({ organizationId: b, authorityId: id, status: "INACTIVE" }), K.oa.OperatingAuthorityNotFoundError);
      await rejectsWith(K.oa.archiveAuthority({ organizationId: b, authorityId: id }), K.oa.OperatingAuthorityNotFoundError);
      await rejectsWith(K.oa.correctAuthorityVersion({ organizationId: b, authorityId: id, issuedOn: "2020-01-01" }), K.oa.OperatingAuthorityNotFoundError);
    });
  });

  // =============================================================================================================
  describe("number and jurisdiction: changes versus corrections", () => {
    scenario("IRP base move is a business transition; both jurisdictions stay genuine history and as-of reads follow business time", async () => {
      const actor = await fullStaff();
      const o = await org();
      const created = (await create(o, "IRP", { jurisdiction: { country: "CA", region: "AB" }, effectiveFrom: MONTH(1) })).view;
      const id = created.authority.id;
      const moved = (await K.oa.changeAuthorityVersion({ organizationId: o, authorityId: id, jurisdiction: { country: "US", region: "TX" }, effectiveFrom: MONTH(6) })).view;
      assert.equal(moved.authority.id, id, "same authority");
      assert.equal(moved.current.version!.jurisdictionRegion, "TX");
      assert.equal(moved.current.version!.versionReason, "CHANGE");
      const genuine = moved.versions.filter((v) => v.recordStatus === "active");
      assert.deepEqual(genuine.map((v) => v.jurisdictionRegion), ["AB", "TX"]);
      assert.notEqual(genuine[0].effectiveTo, null);
      const early = (await K.oa.getOrganizationAuthorities(o, { asOf: MONTH(3) })).authorities[0];
      assert.equal(early.asOf!.version!.jurisdictionRegion, "AB");
      const late = (await K.oa.getOrganizationAuthorities(o, { asOf: MONTH(8) })).authorities[0];
      assert.equal(late.asOf!.version!.jurisdictionRegion, "TX");
      assert.ok((await eventTypes(actor.actorId)).includes("RECORD_UPDATED"));
    });

    scenario("a wrongly recorded jurisdiction is a CORRECTION: the wrong version is preserved, flagged, never ended, excluded from current and as-of", async () => {
      await fullStaff();
      const o = await org();
      const created = (await create(o, "IRP", { jurisdiction: { country: "CA", region: "AB" }, effectiveFrom: MONTH(1) })).view;
      const id = created.authority.id;
      const view = (await K.oa.correctAuthorityVersion({ organizationId: o, authorityId: id, jurisdiction: { country: "CA", region: "BC" } })).view;
      const wrong = view.versions.find((v) => v.recordStatus === "corrected")!;
      assert.equal(wrong.jurisdictionRegion, "AB");
      assert.equal(wrong.effectiveTo, null);
      assert.equal(wrong.supersededByVersionId, view.current.version!.id);
      assert.equal(view.current.version!.jurisdictionRegion, "BC");
      assert.equal(view.current.version!.versionReason, "CORRECTION");
      assert.equal(view.current.version!.effectiveFrom, wrong.effectiveFrom, "inherits business time");
      const asOf = (await K.oa.getOrganizationAuthorities(o, { asOf: MONTH(3) })).authorities[0];
      assert.equal(asOf.asOf!.version!.jurisdictionRegion, "BC", "the corrected row never answers as-of");
      assert.equal(view.versions.filter((v) => v.recordStatus === "active").length, 1, "no invented transition");
    });

    scenario("a wrongly recorded province of MVID/SAFETY_FITNESS is correctable, but an in-place change of issuing province is refused (only IRP base moves)", async () => {
      await fullStaff();
      const o = await org();
      const id = (await create(o, "MVID", { jurisdiction: { region: "AB" } })).view.authority.id;
      await rejectsWith(K.oa.changeAuthorityVersion({ organizationId: o, authorityId: id, jurisdiction: { region: "BC" } }), K.oa.OperatingAuthorityValidationError);
      const fixed = (await K.oa.correctAuthorityVersion({ organizationId: o, authorityId: id, jurisdiction: { region: "BC" } })).view;
      assert.equal(fixed.current.version!.jurisdictionRegion, "BC");
      assert.equal(fixed.authority.id, id);
    });

    scenario("a jurisdiction correction that lands in an occupied number namespace is a collision and rolls back", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const number = alnum("MV");
      await K.oa.createAuthority({ organizationId: a, kind: "MVID", number, jurisdiction: { region: "AB" } });
      const bc = (await K.oa.createAuthority({ organizationId: b, kind: "MVID", number, jurisdiction: { region: "BC" } })).view.authority.id;
      await rejectsWith(K.oa.correctAuthorityVersion({ organizationId: b, authorityId: bc, jurisdiction: { region: "AB" } }), K.oa.AuthorityNumberCollisionError);
      assert.equal((await K.oa.getOrganizationAuthorities(b)).authorities[0].current.version!.jurisdictionRegion, "BC", "the failed correction rolled back");
    });

    scenario("number correction: the wrong number is preserved but freed from the namespace, and the new number is protected", async () => {
      await fullStaff();
      const [a, b] = [await org("A"), await org("B")];
      const wrong = unique();
      const right = unique();
      const id = (await K.oa.createAuthority({ organizationId: a, kind: "USDOT", number: wrong })).view.authority.id;
      const view = (await K.oa.correctAuthorityVersion({ organizationId: a, authorityId: id, number: right })).view;
      assert.equal(view.current.version!.numberNormalized, right);
      assert.equal(view.versions.find((v) => v.recordStatus === "corrected")!.numberNormalized, wrong);
      // the wrong number no longer blocks anyone; the right one does
      const taken = await K.oa.createAuthority({ organizationId: b, kind: "USDOT", number: wrong });
      assert.equal(taken.view.current.version!.numberNormalized, wrong);
      const c = await org("C");
      await rejectsWith(K.oa.createAuthority({ organizationId: c, kind: "USDOT", number: right }), K.oa.AuthorityNumberCollisionError);
      // correcting into a number someone else holds is a collision and rolls back
      await rejectsWith(K.oa.correctAuthorityVersion({ organizationId: a, authorityId: id, number: wrong }), K.oa.AuthorityNumberCollisionError);
      assert.equal((await K.oa.getOrganizationAuthorities(a)).authorities[0].current.version!.numberNormalized, right);
      // and an unchanged correction / empty change is refused
      await rejectsWith(K.oa.correctAuthorityVersion({ organizationId: a, authorityId: id, number: right }), K.oa.OperatingAuthorityValidationError);
      await rejectsWith(K.oa.correctAuthorityVersion({ organizationId: a, authorityId: id } as never), K.oa.OperatingAuthorityValidationError);
    });

    scenario("a national number never changes in the real world (only corrected); a re-issued provincial number may change", async () => {
      await fullStaff();
      const o = await org();
      const mc = (await create(o, "MC")).view.authority.id;
      await rejectsWith(K.oa.changeAuthorityVersion({ organizationId: o, authorityId: mc, number: unique() }), K.oa.OperatingAuthorityValidationError);
      const rin = (await create(o, "MVID", { effectiveFrom: MONTH(1) })).view.authority.id;
      const next = alnum("MV");
      const changed = (await K.oa.changeAuthorityVersion({ organizationId: o, authorityId: rin, number: next, effectiveFrom: MONTH(5) })).view;
      assert.equal(changed.current.version!.numberNormalized, next.toUpperCase());
      assert.equal(changed.versions.filter((v) => v.recordStatus === "active").length, 2);
      await rejectsWith(K.oa.changeAuthorityVersion({ organizationId: o, authorityId: rin, issuedOn: "2020-01-01", effectiveFrom: MONTH(4) }), K.oa.OperatingAuthorityValidationError);
      await rejectsWith(K.oa.changeAuthorityVersion({ organizationId: o, authorityId: rin, issuedOn: "2020-01-01", effectiveFrom: "2999-01-01T00:00:00Z" }), K.oa.OperatingAuthorityValidationError);
    });

    scenario("renewal dates change as real history; clearing a date works; expiry cannot be set where it does not apply", async () => {
      await fullStaff();
      const o = await org();
      const id = (await create(o, "CVOR", { expiresOn: "2025-01-01", effectiveFrom: MONTH(1) })).view.authority.id;
      const renewed = (await K.oa.changeAuthorityVersion({ organizationId: o, authorityId: id, expiresOn: "2027-01-01", effectiveFrom: MONTH(2) })).view;
      assert.equal(renewed.current.version!.expiresOn, "2027-01-01");
      const cleared = (await K.oa.correctAuthorityVersion({ organizationId: o, authorityId: id, expiresOn: null })).view;
      assert.equal(cleared.current.version!.expiresOn, null);
      const mc = (await create(o, "MC")).view.authority.id;
      await rejectsWith(K.oa.changeAuthorityVersion({ organizationId: o, authorityId: mc, expiresOn: "2030-01-01" }), K.oa.OperatingAuthorityValidationError);
    });

    scenario("concurrent corrections of one authority serialize: one current version, every wrong row preserved", async () => {
      const as = await concurrentActors(3);
      await fullStaff();
      const o = await org();
      const id = (await create(o, "MVID")).view.authority.id;
      const results = await Promise.allSettled([0, 1, 2].map((i) => as(i, () => K.oa.correctAuthorityVersion({ organizationId: o, authorityId: id, number: alnum(`C${i}`) }))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authority_versions WHERE authority_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authority_versions WHERE authority_id = $1 AND record_status = 'corrected'`, [id]), 3);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authority_versions WHERE authority_id = $1`, [id]), 4);
    });

    scenario("concurrent status changes and a concurrent correction serialize without losing the current period", async () => {
      const as = await concurrentActors(3);
      await fullStaff();
      const o = await org();
      const id = (await create(o, "MC", { effectiveFrom: MONTH(1) })).view.authority.id;
      const results = await Promise.allSettled([
        as(0, () => K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: "SUSPENDED", effectiveFrom: MONTH(2) })),
        as(1, () => K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: "INACTIVE", effectiveFrom: MONTH(3) })),
        as(2, () => K.oa.correctAuthorityStatus({ organizationId: o, authorityId: id, status: "PENDING" })),
      ]);
      assert.ok(results.some((r) => r.status === "fulfilled"));
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.oa.OperatingAuthorityError, String(r.reason));
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authority_status_periods WHERE authority_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [id]), 1);
    });
  });

  // =============================================================================================================
  describe("Master Register (same transaction)", () => {
    scenario("each mutation family writes its existing event type; reads, lookups and refused calls write none", async () => {
      const actor = await fullStaff();
      const o = await org();
      const id = (await create(o, "IRP", { effectiveFrom: MONTH(1) })).view.authority.id;
      await K.oa.changeAuthorityVersion({ organizationId: o, authorityId: id, jurisdiction: { country: "US", region: "OK" }, effectiveFrom: MONTH(2) });
      await K.oa.correctAuthorityVersion({ organizationId: o, authorityId: id, jurisdiction: { country: "US", region: "KS" } });
      await K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: "INACTIVE", effectiveFrom: MONTH(3) });
      await K.oa.reactivateAuthority({ organizationId: o, authorityId: id, effectiveFrom: MONTH(4) });
      await K.oa.correctAuthorityStatus({ organizationId: o, authorityId: id, status: "SUSPENDED" });
      await K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: "CANCELED", effectiveFrom: MONTH(5) });
      await K.oa.archiveAuthority({ organizationId: o, authorityId: id });
      await K.oa.restoreAuthority({ organizationId: o, authorityId: id });
      const writes = await eventTypes(actor.actorId);
      assert.deepEqual(writes, [
        "RECORD_CREATED", "RECORD_UPDATED", "RECORD_CORRECTED", "RECORD_STATUS_CHANGED", "RECORD_STATUS_CHANGED",
        "RECORD_CORRECTED", "RECORD_STATUS_CHANGED", "RECORD_ARCHIVED", "RECORD_RESTORED",
      ]);
      // reads, lookups, refused calls
      await K.oa.getOrganizationAuthorities(o);
      await K.oa.getOrganizationAuthorities(o, { asOf: MONTH(2) });
      await K.oa.checkAuthorityNumber({ kind: "MC", number: unique() });
      await assert.rejects(K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: "CANCELED" })); // already CANCELED
      const heldNumber = (await K.oa.getOrganizationAuthorities(o)).authorities[0].current.version!.numberNormalized;
      await assert.rejects(K.oa.createAuthority({ organizationId: o, kind: "IRP", number: heldNumber, jurisdiction: { country: "US", region: "KS" } }), K.oa.AuthorityNumberCollisionError);
      assert.deepEqual(await eventTypes(actor.actorId), writes);
      const json = await eventsJson(actor.actorId);
      assert.doesNotMatch(json, /"(number|numberDisplay|numberNormalized|number_display)"/i);
    });

    scenario("a Master Register failure rolls the whole mutation back (creation, correction, status, archive)", async () => {
      await fullStaff();
      const o = await org();
      const id = (await create(o, "MC", { effectiveFrom: MONTH(1) })).view.authority.id;
      const snapshot = async () =>
        JSON.stringify([
          (await pools.admin.query(`SELECT id, record_status, effective_to FROM public.operating_authority_versions WHERE authority_id = $1 ORDER BY id`, [id])).rows,
          (await pools.admin.query(`SELECT id, authority_status, record_status, effective_to FROM public.operating_authority_status_periods WHERE authority_id = $1 ORDER BY id`, [id])).rows,
          (await pools.admin.query(`SELECT record_status FROM public.operating_authorities WHERE id = $1`, [id])).rows,
        ]);
      const before = await snapshot();
      for (const [eventType, work] of [
        ["RECORD_CORRECTED", () => K.oa.correctAuthorityVersion({ organizationId: o, authorityId: id, issuedOn: "2020-01-01" })],
        ["RECORD_CORRECTED", () => K.oa.correctAuthorityStatus({ organizationId: o, authorityId: id, status: "PENDING" })],
        ["RECORD_UPDATED", () => K.oa.changeAuthorityVersion({ organizationId: o, authorityId: id, issuedOn: "2020-02-01", effectiveFrom: MONTH(2) })],
        ["RECORD_STATUS_CHANGED", () => K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: "INACTIVE", effectiveFrom: MONTH(2) })],
      ] as Array<[string, () => Promise<unknown>]>) {
        await refuseMasterRegisterEvent(eventType);
        await assert.rejects(work(), /master register|Master Register/i);
        assert.equal(await snapshot(), before, `${eventType} rolled back`);
      }
      await refuseMasterRegisterEvent("RECORD_CREATED");
      const o2 = await org();
      await assert.rejects(create(o2, "USDOT"), /master register|Master Register/i);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1`, [o2]), 0);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authority_versions WHERE organization_id = $1`, [o2]), 0);
    });
  });

  // =============================================================================================================
  describe("authorization", () => {
    scenario("no session, no capability, and the wrong capability are all denied and change nothing", async () => {
      await fullStaff();
      const o = await org();
      const id = (await create(o, "MC")).view.authority.id;

      K.db.setClerkUser(null);
      await assert.rejects(K.oa.getOrganizationAuthorities(o));
      await assert.rejects(create(o, "USDOT"));

      signIn(await staff());
      await denied(create(o, "USDOT"));
      await denied(K.oa.getOrganizationAuthorities(o));

      signIn(await staff("ORGANIZATION_REGISTRY_READ"));
      assert.equal((await K.oa.getOrganizationAuthorities(o)).authorities.length, 1);
      await denied(create(o, "USDOT"));
      await denied(K.oa.changeAuthorityVersion({ organizationId: o, authorityId: id, issuedOn: "2020-01-01" }));
      await denied(K.oa.correctAuthorityVersion({ organizationId: o, authorityId: id, issuedOn: "2020-01-01" }));
      await denied(K.oa.changeAuthorityStatus({ organizationId: o, authorityId: id, status: "INACTIVE" }));
      await denied(K.oa.reactivateAuthority({ organizationId: o, authorityId: id }));
      await denied(K.oa.correctAuthorityStatus({ organizationId: o, authorityId: id, status: "INACTIVE" }));
      await denied(K.oa.archiveAuthority({ organizationId: o, authorityId: id }));
      await denied(K.oa.restoreAuthority({ organizationId: o, authorityId: id }));

      signIn(await staff("ORGANIZATION_UPDATE"));
      await denied(K.oa.getOrganizationAuthorities(o));
      await denied(K.oa.checkAuthorityNumber({ kind: "MC", number: "1" }));
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1`, [o]), 1);
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authority_versions WHERE authority_id = $1`, [id]), 1);
    });

    scenario("a customer reads only its own Organization's authorities and cannot search, look up or mutate", async () => {
      await fullStaff();
      const customerA = await fx.organizationAndCustomer("CustA");
      const customerB = await fx.organizationAndCustomer("CustB");
      customerOrganizations.push(customerA.organizationId, customerB.organizationId);
      const a = (await create(customerA.organizationId, "MC")).view;
      const b = (await create(customerB.organizationId, "MC")).view;

      const user = await fx.actor();
      const relationshipId = await fx.relationship(user.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customerA.customerId });
      await fx.grant(relationshipId, "ORGANIZATION_READ", { assignmentId });
      signIn(user);

      const own = await K.oa.readCustomerOrganizationAuthorities(customerA.customerId);
      assert.equal(own.organizationId, customerA.organizationId);
      assert.equal(own.authorities.length, 1);
      assert.equal(own.authorities[0].authority.id, a.authority.id);
      assert.equal(JSON.stringify(own).includes(b.authority.id), false);
      assert.equal(JSON.stringify(own).includes(customerB.organizationId), false);
      const asOf = await K.oa.readCustomerOrganizationAuthorities(customerA.customerId, { asOf: new Date().toISOString() });
      assert.ok(asOf.authorities[0].asOf);

      await denied(K.oa.readCustomerOrganizationAuthorities(customerB.customerId));
      await denied(K.oa.readCustomerOrganizationAuthorities(randomUUID()));
      await denied(K.oa.getOrganizationAuthorities(customerA.organizationId));
      await denied(K.oa.checkAuthorityNumber({ kind: "MC", number: a.current.version!.numberNormalized }));
      await denied(create(customerA.organizationId, "USDOT"));
      await denied(K.oa.changeAuthorityStatus({ organizationId: customerA.organizationId, authorityId: a.authority.id, status: "INACTIVE" }));
      await denied(K.oa.archiveAuthority({ organizationId: customerA.organizationId, authorityId: a.authority.id }));
    });

    scenario("staff without a customer ORGANIZATION_READ path cannot use the customer read, and registry read is not a customer path", async () => {
      await fullStaff();
      const customer = await fx.organizationAndCustomer("Cust");
      customerOrganizations.push(customer.organizationId);
      await create(customer.organizationId, "MC");
      await denied(K.oa.readCustomerOrganizationAuthorities(customer.customerId));
    });

    scenario("the service exposes no delete, remove, merge or move operation", async () => {
      assert.deepEqual(Object.keys(K.oa).filter((key) => /delete|remove|destroy|merge|move|transfer|evidence/i.test(key)), []);
    });
  });

  // =============================================================================================================
  describe("data safety", () => {
    scenario("business tables hold exactly what the scenario wrote (runtime role works through column grants only)", async () => {
      await fullStaff();
      const o = await org();
      await create(o, "USDOT");
      assert.equal(await rowCount(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1`, [o]), 1);
      await assert.rejects(pools.runtime.query(`UPDATE public.operating_authority_versions SET number_normalized = 'x'`), /permission denied/);
      await assert.rejects(pools.runtime.query(`UPDATE public.operating_authorities SET kind = 'MC'`), /permission denied/);
      await assert.rejects(pools.runtime.query(`UPDATE public.operating_authority_status_periods SET authority_status = 'REVOKED'`), /permission denied/);
    });
  });
});
