// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh). Migration 0037: driver identity integrity and exclusive company assignment.
//
// These tests drive the REAL operational-identity service through the REAL authorization wrappers, on pooled connections that log in as the RUNTIME
// role (policy-bound by row-level security), with the real Master Register; fixtures and owner-level checks use the admin pool.
// The suite detects which schema the disposable database is in (MIGRATIONS_DIR can stop the runner at 0036):
//   - tests marked [any] hold in BOTH states (the application-level canonicalization and exclusivity work before 0037 is applied);
//   - tests marked [0037] need the migration;
//   - tests marked [pre-0037] run only on a 0036 database, prove the 0037 operations fail closed, then prove the migration REFUSES to apply over real
//     conflicts (changing nothing), that the read-only preflight lists them, and that it applies cleanly once they are resolved.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    fixtures: await import("@/test/helpers/evidence-payload-fixtures"),
    sys: await import("@/lib/auth/tes-system-context"),
    oi: await import("@/lib/operational-identity/service"),
    errors: await import("@/lib/operational-identity/errors"),
    juris: await import("@/lib/operational-identity/jurisdiction"),
    response: await import("@/lib/api/canonical-response"),
    ident: await import("@/lib/contact-identity/identity-details"),
  };
}
type Kit = Awaited<ReturnType<typeof loadKit>>;
const K = {} as Kit;

const enabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
if (!enabled && process.env.TES_REQUIRE_DB_TESTS === "1") {
  it("requires a disposable test database (TES_REQUIRE_DB_TESTS=1)", () => assert.fail("TES_TEST_ADMIN_DATABASE_URL and TES_TEST_RUNTIME_DATABASE_URL must be set"));
}

type PgError = Error & { code?: string; constraint?: string };
class RollBack extends Error {}

describe("Driver identity integrity and exclusive assignment (migration 0037)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let has0037 = false;
  let organizations: string[] = [];
  let persons: string[] = [];
  const run = randomUUID().slice(0, 8).toUpperCase();
  let counter = 0;
  const n = () => ++counter;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
    has0037 = (await pools.admin.query(`SELECT to_regclass('public.driver_identity_verifications') IS NOT NULL AS p`)).rows[0].p;
  });
  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  /** Removes what a scenario created (no-delete triggers lifted only here, by the table owner). Rows that cannot be removed (evidence, resolution cases) are left: the database is disposable. */
  async function purge() {
    const triggers: Array<[string, string]> = [
      ["driver_profiles", "driver_profiles_no_delete"],
      ["driver_licences", "driver_licences_no_delete"],
      ["organization_driver_relationships", "organization_driver_relationships_no_delete"],
      ["persons", "persons_no_delete"],
      ["person_name_versions", "person_name_versions_no_delete"],
      ["organization_person_relationships", "organization_person_relationships_no_delete"],
    ];
    if (has0037) triggers.push(["driver_identity_verifications", "driver_identity_verifications_no_delete"]);
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const [table, trigger] of triggers) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`);
      if (has0037) await client.query(`DELETE FROM public.driver_identity_verifications WHERE person_id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.organization_driver_relationships WHERE organization_id = ANY($1::uuid[]) OR person_id = ANY($2::uuid[])`, [organizations, persons]);
      await client.query(`DELETE FROM public.driver_licences WHERE person_id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.driver_profiles WHERE person_id = ANY($1::uuid[])`, [persons]);
      await client.query(`DELETE FROM public.organization_person_relationships WHERE person_id = ANY($1::uuid[]) OR organization_id = ANY($2::uuid[])`, [persons, organizations]);
      await client.query(`DELETE FROM public.person_name_versions WHERE person_id = ANY($1::uuid[])`, [persons]);
      for (const id of persons) {
        await client.query("SAVEPOINT p");
        await client.query(`DELETE FROM public.persons WHERE id = $1`, [id]).then(() => client.query("RELEASE SAVEPOINT p"), () => client.query("ROLLBACK TO SAVEPOINT p"));
      }
      for (const id of organizations) {
        await client.query("SAVEPOINT o");
        await client.query(`DELETE FROM public.organizations WHERE id = $1`, [id]).then(() => client.query("RELEASE SAVEPOINT o"), () => client.query("ROLLBACK TO SAVEPOINT o"));
      }
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const [table, trigger] of [...triggers].reverse()) await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const scenario = (name: string, body: () => Promise<void>, mode: "any" | "0037" | "pre" = "any") =>
    it(`[${mode === "pre" ? "pre-0037" : mode}] ${name}`, async (t) => {
      if ((mode === "0037" && !has0037) || (mode === "pre" && has0037)) return t.skip(mode === "pre" ? "database already has 0037" : "database has no 0037");
      fx = new K.db.AuthFixtures(pools.admin);
      organizations = [];
      persons = [];
      K.db.setClerkUser(null);
      try {
        await body();
      } finally {
        K.db.setClerkUser(null);
        await purge();
        await fx.cleanup().catch(() => undefined);
      }
    });

  // ---- fixtures ------------------------------------------------------------------------------------------------

  async function org(label = "Org", status: "active" | "archived" = "active"): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `DII ${label} ${id.slice(0, 8)} ${n()}`]);
    organizations.push(id);
    if (status === "archived") await pools.admin.query(`UPDATE public.organizations SET status = 'archived', archived_at = now() WHERE id = $1`, [id]);
    return id;
  }
  /** A person with a driver profile. */
  async function driver(withProfile = true): Promise<string> {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      const personId = (await client.query<{ id: string }>(`INSERT INTO public.persons DEFAULT VALUES RETURNING id`)).rows[0].id;
      await client.query(
        `INSERT INTO public.person_name_versions (person_id, given_name, family_name, name_normalized, change_reason, effective_from) VALUES ($1, 'Test', $2, $3, 'INITIAL', '2020-01-01Z')`,
        [personId, `Dii${n()}`, `test dii${counter}`],
      );
      if (withProfile) await client.query(`INSERT INTO public.driver_profiles (person_id) VALUES ($1)`, [personId]);
      await client.query("COMMIT");
      persons.push(personId);
      return personId;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async function staff(...capabilities: string[]): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    return actor;
  }
  async function only(...capabilities: string[]) {
    const actor = await staff(...capabilities);
    K.db.setClerkUser(actor.clerkSubject);
    return actor;
  }
  /** Every capability the 0037 operations need. */
  // Deliberately WITHOUT IDENTITY_RESOLUTION_READ: the ambiguity safeguards must hold for callers who cannot see resolution cases.
  const FULL = () => ["DRIVER_MANAGE", "DRIVER_READ", "EVIDENCE_READ", "DRIVER_IDENTITY_VERIFY"];
  // Before 0037 the ambiguity check can only be made directly, so assignment fails closed for a caller without IDENTITY_RESOLUTION_READ.
  const DM = () => (has0037 ? ["DRIVER_MANAGE"] : ["DRIVER_MANAGE", "IDENTITY_RESOLUTION_READ"]);

  const licenceNo = () => `T${run}${String(n()).padStart(5, "0")}`;
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const rows = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await pools.admin.query(sql, params)).rows as T[];
  const refused = async (promise: Promise<unknown>): Promise<Error> => {
    try {
      await promise;
    } catch (error) {
      return error as Error;
    }
    return assert.fail("expected the operation to be refused");
  };
  const today = async () => (await rows<{ d: string }>(`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d`))[0].d;
  const open = (personId: string) => count(`SELECT count(*) FROM public.organization_driver_relationships WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL`, [personId]);
  const establish = (organizationId: string, personId: string, status: "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "ON_LEAVE" = "ACTIVE", effectiveFrom = "2024-01-01") =>
    K.oi.establishOrganizationDriver({ organizationId, personId, relationshipType: "EMPLOYEE", status, effectiveFrom });
  const addLicence = (personId: string, country: string, region: string, licenceNumber: string) =>
    K.oi.addDriverLicence({ personId, jurisdictionCountry: country, jurisdictionRegion: region, licenceNumber, effectiveFrom: "2024-01-01" });
  const evidence = async (organizationId: string, actorId: string, documentType = "DRIVER_IDENTITY_DOCUMENT", status: "received" | "verified" = "verified", stage: "quarantined" | "stored" = "stored") =>
    K.fixtures.seedPayloadBackedDocument(pools.admin, { organizationId, actorId, documentType, status, stage });
  /** Establishes the driver in `organizationId` (if no assignment exists yet) and verifies the identity through the real service. */
  async function verified(actor: TestActor, organizationId: string, personId: string) {
    const doc = await evidence(organizationId, actor.actorId);
    await K.oi.verifyDriverIdentity({ personId, organizationId, evidenceDocumentId: doc, method: "LICENCE_DOCUMENT_REVIEW" });
    return doc;
  }
  async function attempt(capability: Parameters<Kit["sys"]["withAuthorizedSystem"]>[0], sql: string, params: unknown[] = []) {
    let result: { rowCount: number | null; code?: string } = { rowCount: null };
    try {
      await K.sys.withAuthorizedSystem(capability, async (client) => {
        await client.query("SAVEPOINT attempt");
        try {
          result = { rowCount: (await client.query(sql, params)).rowCount };
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT attempt");
          result = { rowCount: null, code: (error as PgError).code };
        }
        throw new RollBack();
      });
    } catch (error) {
      if (!(error instanceof RollBack)) throw error;
    }
    return result;
  }
  const raw = async (sql: string, params: unknown[] = []) => {
    try {
      await pools.admin.query(sql, params);
    } catch (error) {
      return error as PgError;
    }
    return assert.fail("expected the statement to be refused");
  };
  /** Opens an unresolved PERSON case that names the driver as a candidate (owner-level fixture). */
  async function ambiguous(personId: string, state: "PENDING" | "REVIEW_REQUIRED" | "RESOLVED" = "REVIEW_REQUIRED") {
    const caseId = randomUUID();
    await pools.admin.query(`INSERT INTO public.entity_resolution_cases (id, entity_type, source_system, source_record_key, resolution_state${state === "RESOLVED" ? ", outcome, resolved_person_id, resolved_at" : ""}) VALUES ($1, 'PERSON', $2, $3, $4${state === "RESOLVED" ? ", 'EXACT_IDENTITY_MATCH', $5, now()" : ""})`, [caseId, `DII-${run}`, `k-${n()}`, state, ...(state === "RESOLVED" ? [personId] : [])]);
    await pools.admin.query(`INSERT INTO public.entity_resolution_candidates (resolution_case_id, candidate_person_id, match_class, basis) VALUES ($1, $2, 'AMBIGUOUS_MATCH', 'same name and date of birth')`, [caseId, personId]);
  }
  const register = (operation: string, resourceId: string) =>
    rows<{ actor_id: string; event_type: string }>(`SELECT actor_id, event_type FROM public.master_register_events WHERE action->>'operation' = $1 AND target->>'resourceId' = $2`, [operation, resourceId]);

  // ---- 1. normalization and duplicate prevention -----------------------------------------------------------------

  describe("licence canonicalization and duplicate prevention", () => {
    scenario("equivalent spellings of country, jurisdiction and number are ONE licence; the stored form is canonical", async () => {
      await only(...DM());
      const first = await driver();
      const second = await driver();
      const number = licenceNo();
      const created = await addLicence(first, " Canada ", "Ontario", number.toLowerCase().replace(/^t/, "t-"));
      assert.equal(created.kind, "CREATED");
      const stored = (await rows(`SELECT jurisdiction_country AS c, jurisdiction_region AS r, licence_number_normalized AS n FROM public.driver_licences WHERE person_id = $1`, [first]))[0];
      assert.deepEqual(stored, { c: "CA", r: "ON", n: number });

      for (const [country, region, text] of [["CA", "ON", number], ["can", " on. ", number.toLowerCase()], ["CANADA", "ONTARIO", `${number.slice(0, 3)} ${number.slice(3)}`]] as const) {
        const error = await refused(addLicence(second, country, region, text));
        assert.ok(error instanceof K.errors.DriverIdentityConflictError, `${country}/${region} is the same licence`);
      }
      assert.equal(await count(`SELECT count(*) FROM public.driver_licences WHERE person_id = $1`, [second]), 0, "nothing was saved for the second person");
      // another jurisdiction is a different licence
      assert.equal((await addLicence(second, "Canada", "Quebec", number)).kind, "CREATED");
      // the same person re-adding it is idempotent, not an error and not a duplicate
      const again = await addLicence(first, "ca", "on", number);
      assert.equal(again.kind, "EXISTING");
      assert.equal(await count(`SELECT count(*) FROM public.driver_licences WHERE person_id = $1`, [first]), 1);
      // a second, different licence from the same jurisdiction is a state conflict (renew or correct), not a silent duplicate
      assert.ok((await refused(addLicence(first, "CA", "ON", licenceNo()))) instanceof K.errors.DriverIdentityStateError);
    });

    scenario("unrecognised jurisdictions are rejected as validation errors (HTTP 400), never stored as free text", async () => {
      await only(...DM());
      const personId = await driver();
      for (const [country, region] of [["Narnia", "ON"], ["CA", "Atlantis"], ["CA", ""], ["CA", "TOOLONGREGION"], ["CA", "TX"], ["US", "Ontario"], ["MX", "CA"], ["Mexico", "Texas"], ["GB", "ON"], ["US", "NLE"]]) {
        const error = await refused(addLicence(personId, country, region, licenceNo()));
        assert.ok(error instanceof K.errors.DriverIdentityValidationError || error.message.includes("required"), `${country}/${region}: ${error.message}`);
      }
      assert.ok((await refused(addLicence(personId, "CA", "ON", " - . "))) instanceof K.errors.DriverIdentityValidationError);
      assert.equal(await count(`SELECT count(*) FROM public.driver_licences WHERE person_id = $1`, [personId]), 0);
    });

    scenario("every supported jurisdiction is accepted in its own namespace, in any equivalent spelling, and stored canonically", async () => {
      await only(...DM());
      const cases: Array<[string, string, string, string]> = [
        ["Canada", "Québec", "CA", "QC"], ["CAN", "new-brunswick", "CA", "NB"], ["U.S.A.", " Texas ", "US", "TX"], ["United States of America", "washington dc", "US", "DC"],
        ["US", "Puerto Rico", "US", "PR"], ["México", "Nuevo León", "MX", "NLE"], ["MEX", "ciudad de mexico", "MX", "CMX"], ["Mexico", "JAL", "MX", "JAL"],
      ];
      for (const [country, region, c, r] of cases) {
        const personId = await driver();
        assert.equal((await addLicence(personId, country, region, licenceNo())).kind, "CREATED", `${country}/${region}`);
        assert.deepEqual((await rows(`SELECT jurisdiction_country AS c, jurisdiction_region AS r FROM public.driver_licences WHERE person_id = $1`, [personId]))[0], { c, r });
      }
      // the same licence number in two DIFFERENT jurisdictions is two licences; "CA" the country and "CA" California never collide
      const number = licenceNo();
      const [a, b] = [await driver(), await driver()];
      assert.equal((await addLicence(a, "Canada", "Ontario", number)).kind, "CREATED");
      assert.equal((await addLicence(b, "United States", "California", number)).kind, "CREATED");
    });

    scenario("the Contacts licence writer applies the same rule: a duplicate under another spelling is a safe conflict", async () => {
      assert.deepEqual(K.ident.prepareLicence({ number: "d-123 456", country: "Canada", region: "Ontario" } as never), { number: "d-123 456", normalized: "D123456", country: "CA", region: "ON", licenceClass: null, issueDate: null, expiryDate: null });
      await only(...DM());
      const first = await driver();
      const second = await driver();
      const number = licenceNo();
      await addLicence(first, "CA", "ON", number);
      const prepared = K.ident.prepareLicence({ number, country: "Canada", region: "Ontario" } as never);
      assert.equal(prepared.country, "CA");
      assert.equal(prepared.region, "ON");
      assert.equal(await count(`SELECT count(*) FROM public.driver_licences WHERE person_id = $1`, [second]), 0);
    });

    scenario("a verified licence conflict is HTTP 409 and discloses neither the other person nor any other company", async () => {
      await only(...DM());
      const holderCompany = await org("SecretHolder");
      const first = await driver();
      const second = await driver();
      await establish(holderCompany, first);
      const number = licenceNo();
      await addLicence(first, "CA", "ON", number);
      const error = await refused(addLicence(second, "Canada", "Ontario", number));
      const response = K.response.canonicalFailure(error, "fallback");
      assert.equal(response.status, 409);
      const text = JSON.stringify(await response.json());
      for (const secret of [first, holderCompany, number]) assert.ok(!text.includes(secret), "no identifier of the other record in the response");
      assert.ok(!error.message.includes(first) && !error.message.includes(holderCompany));
    });

    scenario("TypeScript canonicalization is deterministic and idempotent", async () => {
      const { canonicalCountryCode: c, canonicalRegionCode: r, canonicalLicenceNumber: l } = K.juris;
      assert.equal(c(" united states of america "), "US");
      assert.equal(r("Québec"), "QC");
      assert.equal(r(" d.c. "), "DC");
      assert.equal(l("ab-12 34/x"), "AB1234X");
      for (const v of ["Canada", "can", "XX", " ca "]) assert.equal(c(c(v)), c(v));
    });
  });

  describe("database-level canonical identity (cannot be bypassed)", () => {
    scenario("a raw insert of a non-canonical spelling is stored canonically and collides with the existing licence", async () => {
      const first = await driver();
      const second = await driver();
      const number = licenceNo();
      const insert = (personId: string, country: string, region: string, display: string) =>
        pools.admin.query(`INSERT INTO public.driver_licences (person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_number_normalized, effective_from) VALUES ($1, $2, $3, $4, $5, '2024-01-01')`, [personId, country, region, display, display]);
      await insert(first, "canada", " ontario ", number.toLowerCase());
      assert.deepEqual((await rows(`SELECT jurisdiction_country AS c, jurisdiction_region AS r, licence_number_normalized AS n FROM public.driver_licences WHERE person_id = $1`, [first]))[0], { c: "CA", r: "ON", n: number });
      for (const [country, region, display] of [["CA", "ON", number], ["Can", "on.", ` ${number.toLowerCase()} `], ["CANADA", "Ontario", number.replace(/(...)/, "$1-")]]) {
        const error = await raw(`INSERT INTO public.driver_licences (person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_number_normalized, effective_from) VALUES ($1, $2, $3, $4, $4, '2024-01-01')`, [second, country, region, display]).catch((e) => e);
        assert.ok(["23505", "23P01"].includes((error as PgError).code ?? ""), `${country}/${region}: ${(error as PgError).code}`);
      }
      assert.equal((await raw(`INSERT INTO public.driver_licences (person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_number_normalized, effective_from) VALUES ($1, 'Narnia', 'ON', 'X1', 'X1', '2024-01-01')`, [second])).code, "23514");
      assert.equal((await raw(`INSERT INTO public.driver_licences (person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_number_normalized, effective_from) VALUES ($1, 'CA', 'ON', ' - ', ' - ', '2024-01-01')`, [second])).code, "23514");
      // an invalid country-region pair is refused by the database itself, in any spelling
      for (const [country, region] of [["US", "ON"], ["Canada", "Texas"], ["MX", "CA"], ["GB", "ON"], ["CA", "Atlantis"]]) {
        assert.equal((await raw(`INSERT INTO public.driver_licences (person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_number_normalized, effective_from) VALUES ($1, $2, $3, 'Z9', 'Z9', '2024-01-01')`, [second, country, region])).code, "23514", `${country}/${region}`);
      }
      const ok = await pools.admin.query(`INSERT INTO public.driver_licences (person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_number_normalized, effective_from) VALUES ($1, 'México', 'Nuevo-León', 'Z9', 'Z9', '2024-01-01') RETURNING jurisdiction_country AS c, jurisdiction_region AS r`, [second]);
      assert.deepEqual(ok.rows[0], { c: "MX", r: "NLE" });
    }, "0037");

    scenario("SQL and TypeScript canonicalization agree on the whole vocabulary and on case / whitespace / punctuation variants", async () => {
      const spellings = (v: string) => [v, v.toLowerCase(), `  ${v}  `, v.replace(/ /g, "   "), `${v}.`, `${v},`, v.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase())];
      const extra = ["XX", "", "ON-1", "d.c.", "Washington D.C.", "Québec", "Que\u0301bec", "QUÉBEC", " québec ", "Nuevo León", "NUEVO-LEON", "new_brunswick", "México", "Mexico City", "Ciudad de México", "Yucatán", "U.S.A.", "U.S.", "ñ", "ß"];
      const inputs = [...K.juris.JURISDICTION_VOCABULARY.countries, ...K.juris.JURISDICTION_VOCABULARY.regions, ...extra].flatMap(spellings);
      const sql = await rows<{ v: string; c: string; r: string }>(`SELECT v, tes_security.canonical_country_code(v) AS c, tes_security.canonical_region_code(v) AS r FROM unnest($1::text[]) AS v`, [inputs]);
      for (const row of sql) {
        assert.equal(row.c, K.juris.canonicalCountryCode(row.v), `country ${JSON.stringify(row.v)}`);
        assert.equal(row.r, K.juris.canonicalRegionCode(row.v), `region ${JSON.stringify(row.v)}`);
      }
      // the namespace rule: SQL region_country and TypeScript isValidJurisdiction agree for every (country, region code) pair
      const codes = [...new Set(K.juris.JURISDICTION_VOCABULARY.regions.map((name: string) => K.juris.canonicalRegionCode(name)))] as string[];
      for (const code of [...codes, "XX", "ON "]) {
        const owner = (await rows<{ c: string | null }>(`SELECT tes_security.region_country($1) AS c`, [code]))[0].c;
        assert.equal(owner, K.juris.regionCountry(code), code);
        for (const country of ["CA", "US", "MX", "GB"]) assert.equal(K.juris.isValidJurisdiction(country, code), owner === country, `${country}/${code}`);
      }
      const numbers = ["d1234-567 890", "ab/12 34", "  x  ", "", "---", "é1é2"];
      for (const v of numbers) assert.equal((await rows<{ n: string }>(`SELECT tes_security.canonical_licence_number($1) AS n`, [v]))[0].n, K.juris.canonicalLicenceNumber(v), v);
    }, "0037");
  });

  // ---- 2. exclusive assignment ---------------------------------------------------------------------------------

  describe("one open assignment per driver identity across TES", () => {
    scenario("ONBOARDING, ACTIVE, SUSPENDED and ON_LEAVE each hold the driver: another company is refused with a safe 409", async () => {
      await only(...DM());
      const holder = await org("Holder");
      const other = await org("Other");
      for (const status of ["ONBOARDING", "ACTIVE", "SUSPENDED", "ON_LEAVE"] as const) {
        const personId = await driver();
        if (status === "ON_LEAVE" && !has0037) {
          assert.match((await refused(establish(holder, personId, status))).message, /migration 0037/);
          continue;
        }
        await establish(holder, personId, status);
        const error = await refused(establish(other, personId));
        assert.ok(error instanceof K.errors.DriverIdentityConflictError, status);
        const response = K.response.canonicalFailure(error, "x");
        assert.equal(response.status, 409);
        const text = JSON.stringify(await response.json());
        assert.ok(!text.includes(holder) && !text.includes(personId), "the holder company and the person id are not disclosed");
        assert.ok(!error.message.includes(holder));
        assert.equal(await open(personId), 1);
        assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE person_id = $1 AND organization_id = $2`, [personId, other]), 0);
        // the same company cannot duplicate its own open assignment either
        assert.ok((await refused(establish(holder, personId))) instanceof K.errors.DriverIdentityConflictError);
      }
    });

    scenario("simultaneous assignment attempts by two companies for one driver: exactly one wins, the other gets the safe conflict", async () => {
      await only(...DM());
      const companies = await Promise.all([org("RaceA"), org("RaceB")]);
      const people = await Promise.all(Array.from({ length: 8 }, () => driver()));
      const results = await Promise.allSettled(people.flatMap((personId) => companies.map((organizationId) => establish(organizationId, personId))));
      const winners = results.filter((r) => r.status === "fulfilled").length;
      assert.equal(winners, people.length, "one winner per driver");
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.errors.DriverIdentityConflictError, String(r.reason));
      for (const personId of people) assert.equal(await open(personId), 1);
    });

    scenario("a writer that bypasses the service is still stopped by the database: concurrent raw inserts in two companies", async () => {
      const [a, b] = await Promise.all([org("RawA"), org("RawB")]);
      const personId = await driver();
      const insert = `INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from) VALUES ($1, $2, 'EMPLOYEE', 'ACTIVE', '2024-01-01')`;
      const c1 = await pools.admin.connect();
      const c2 = await pools.admin.connect();
      try {
        await c1.query("BEGIN");
        await c1.query(insert, [a, personId]);
        await c2.query("BEGIN");
        const second = c2.query(insert, [b, personId]).then(() => undefined, (e: PgError) => e);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await c1.query("COMMIT");
        const error = await second;
        assert.ok(error && ["23505", "23P01"].includes(error.code ?? ""), `the second writer lost the race: ${error?.code}`);
        await c2.query("ROLLBACK");
      } finally {
        c1.release();
        c2.release();
      }
      assert.equal(await open(personId), 1);
    }, "0037");

    scenario("overlapping periods are refused for one driver in any company; a back-dated row cannot slip in behind an ended assignment", async () => {
      await only(...DM());
      const [a, b] = await Promise.all([org("OvA"), org("OvB")]);
      const personId = await driver();
      await establish(a, personId, "ACTIVE", "2024-01-01");
      await pools.admin.query(`UPDATE public.organization_driver_relationships SET status = 'ENDED', effective_to = '2024-06-01', closed_at = now(), end_reason = 'ENDED' WHERE person_id = $1`, [personId]);
      assert.equal(await open(personId), 0);
      assert.ok((await refused(establish(b, personId, "ACTIVE", "2024-03-01"))) instanceof K.errors.DriverIdentityConflictError, "starts inside the ended period");
      await establish(b, personId, "ACTIVE", "2024-06-01");
      assert.equal(await open(personId), 1);
    }, "0037");

    scenario("a driver pending identity review cannot be assigned by ANY caller, including one without IDENTITY_RESOLUTION_READ", async () => {
      const company = await org("Amb");
      const personId = await driver();
      await ambiguous(personId);
      // a caller that can see resolution cases, and one that cannot: both are refused (before 0037 the second fails closed instead)
      await only("DRIVER_MANAGE", "IDENTITY_RESOLUTION_READ");
      const withRead = await refused(establish(company, personId));
      assert.ok(withRead instanceof K.errors.DriverIdentityStateError);
      assert.match(withRead.message, /pending review/);
      await only("DRIVER_MANAGE");
      const without = await refused(establish(company, personId));
      assert.ok(without instanceof K.errors.DriverIdentityStateError, "refused, never silently allowed");
      if (has0037) assert.match(without.message, /pending review/);
      else assert.match(without.message, /migration 0037/);
      assert.equal(await open(personId), 0);
      // a resolved case no longer blocks; a PENDING one does
      const cleared = await driver();
      await ambiguous(cleared, "RESOLVED");
      await only(...DM());
      assert.ok((await establish(company, cleared)).relationshipId);
      const pending = await driver();
      await ambiguous(pending, "PENDING");
      assert.ok((await refused(establish(company, pending))) instanceof K.errors.DriverIdentityStateError);
    });

    scenario("the ambiguity safeguard is in the database: even a writer that bypasses the service cannot open an assignment, and no visibility is widened", async () => {
      const company = await org("AmbDb");
      const personId = await driver();
      await ambiguous(personId);
      const insert = `INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from) VALUES ($1, $2, 'EMPLOYEE', 'ACTIVE', '2024-01-01')`;
      assert.equal((await raw(insert, [company, personId])).code, "23514", "owner-level writer");
      await only("DRIVER_MANAGE", "VEHICLE_READ");
      assert.equal((await attempt("DRIVER_MANAGE", insert, [company, personId])).code, "23514", "runtime writer holding only DRIVER_MANAGE");
      // an ended (historical) row is not a new open assignment and is not blocked
      await pools.admin.query(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from, effective_to) VALUES ($1, $2, 'EMPLOYEE', 'ENDED', '2020-01-01', '2020-02-01')`, [company, personId]);
      // DRIVER_MANAGE still cannot READ the resolution tables (the check is a boolean for one person, not visibility)
      const seen = await attempt("DRIVER_MANAGE", `SELECT 1 FROM public.entity_resolution_candidates WHERE candidate_person_id = $1`, [personId]);
      assert.equal(seen.rowCount, 0, "no identity-resolution rows are visible to a driver-management caller");
      // the function is not an oracle for callers outside driver management / verification
      assert.equal((await attempt("VEHICLE_READ", `SELECT tes_security.driver_identity_unresolved($1)`, [personId])).code, "42501");
      assert.equal((await attempt("DRIVER_MANAGE", `SELECT tes_security.driver_identity_unresolved($1)`, [personId])).rowCount, 1);
    }, "0037");

    scenario("the identity pre-check under the real role model: ownership, EXECUTE grants, pinned search_path, no role name in any decision, no oracle", async () => {
      const company = await org("RoleModel");
      const personId = await driver();
      await ambiguous(personId);
      const runtimeRole = (await pools.runtime.query<{ r: string }>(`SELECT current_user AS r`)).rows[0].r;

      // --- catalog: ownership, privileges, configuration
      const fn = (await rows(
        `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.prosrc,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec, has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_exec
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tes_security' AND p.proname IN ('driver_identity_unresolved', 'guard_driver_assignment_identity') ORDER BY 1`,
        [runtimeRole],
      )) as Array<Record<string, any>>;
      assert.equal(fn.length, 2);
      const tableOwners = (await rows<{ o: string }>(`SELECT DISTINCT pg_get_userbyid(relowner) AS o FROM pg_class WHERE oid IN ('public.entity_resolution_cases'::regclass, 'public.entity_resolution_candidates'::regclass)`)).map((r) => r.o);
      for (const f of fn) {
        assert.equal(f.prosecdef, true, `${f.proname} is SECURITY DEFINER`);
        assert.deepEqual(tableOwners, [f.owner], `${f.proname} is owned by the owner of the resolution tables (reads them as owner, row-level security not forced)`);
        assert.ok((f.proconfig as string[]).includes("search_path=pg_catalog, pg_temp"), `${f.proname} pins search_path: ${f.proconfig}`);
        assert.equal(f.public_exec, false, `${f.proname}: no PUBLIC execute`);
        assert.ok(!/tes-backend|iam\b|session_user|current_user/i.test(f.prosrc), `${f.proname} names no principal`);
      }
      assert.equal(fn.find((f) => f.proname === "driver_identity_unresolved")!.runtime_exec, true, "the runtime role may call the pre-check (and it self-authorizes)");
      assert.equal(fn.find((f) => f.proname === "guard_driver_assignment_identity")!.runtime_exec, false, "nothing is granted on the trigger function");
      const grantees = await rows<{ g: string }>(`SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS g FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = 'tes_security.driver_identity_unresolved(uuid)'::regprocedure`);
      assert.deepEqual(grantees.map((r) => r.g).sort(), [fn[0].owner, runtimeRole].sort(), "EXECUTE: the owner and the runtime principal only");
      assert.equal((await rows<{ m: boolean }>(`SELECT pg_has_role($1, $2::name, 'MEMBER') AS m`, [runtimeRole, fn[0].owner]))[0].m, false, "the runtime role is not a member of the owner role");

      // --- the runtime role: no context, a forged capability without an actor, a wrong capability, a right capability
      const asRuntime = async (prelude: string | null) => {
        const client = await pools.runtime.connect();
        try {
          await client.query("BEGIN");
          if (prelude) await client.query(prelude);
          await client.query("SAVEPOINT s");
          return await client.query(`SELECT tes_security.driver_identity_unresolved($1) AS u`, [personId]).then((r) => ({ code: undefined as string | undefined, value: r.rows[0].u }), (e: PgError) => ({ code: e.code, value: undefined }));
        } finally {
          await client.query("ROLLBACK").catch(() => undefined);
          client.release();
        }
      };
      assert.equal((await asRuntime(null)).code, "42501", "no context at all");
      assert.equal((await asRuntime(`SELECT set_config('tes.system_capability', 'DRIVER_MANAGE', true)`)).code, "42501", "a claimed capability without an authorized actor");
      assert.equal((await asRuntime(`SELECT set_config('tes.system_capability', 'DRIVER_MANAGE', true), set_config('tes.system_actor_id', '${randomUUID()}', true)`)).code, "42501", "an actor with no grant");
      await only("DRIVER_MANAGE", "VEHICLE_READ", "DRIVER_IDENTITY_VERIFY");
      assert.equal((await attempt("VEHICLE_READ", `SELECT tes_security.driver_identity_unresolved($1)`, [personId])).code, "42501", "an unrelated capability");
      for (const capability of ["DRIVER_MANAGE", "DRIVER_IDENTITY_VERIFY"] as const) {
        const answered = await K.sys.withAuthorizedSystem(capability, async (client) => (await client.query(`SELECT tes_security.driver_identity_unresolved($1) AS u`, [personId])).rows[0].u);
        assert.equal(answered, true, `${capability} gets its one boolean`);
      }
      // it answers about ONE person only and returns nothing else: another person is simply false
      const other = await driver();
      assert.equal(await K.sys.withAuthorizedSystem("DRIVER_MANAGE", async (client) => (await client.query(`SELECT tes_security.driver_identity_unresolved($1) AS u`, [other])).rows[0].u), false);

      // --- authorization for EVERY assignment, direct writes included: owner, runtime under each capability, runtime with no context
      const insert = `INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from) VALUES ($1, $2, 'EMPLOYEE', 'ACTIVE', '2024-01-01')`;
      assert.equal((await raw(insert, [company, personId])).code, "23514", "owner-level writer");
      for (const capability of ["DRIVER_MANAGE", "DRIVER_IDENTITY_VERIFY"] as const) assert.equal((await attempt(capability, insert, [company, personId])).code, "23514", `runtime under ${capability}`);
      assert.notEqual((await attempt("VEHICLE_READ", insert, [company, personId])).code, undefined, "runtime without driver capability: refused (row-level security) - never inserted");
      assert.equal(await open(personId), 0);
    }, "0037");

    scenario("establishing keeps its earlier refusals: unknown and archived organizations", async () => {
      await only(...DM());
      const personId = await driver();
      assert.equal((await refused(establish(randomUUID(), personId))).message, "Organization not found.");
      assert.equal((await refused(establish(await org("Arch", "archived"), personId))).message, "Organization must be active.");
      assert.equal((await refused(establish(await org("Ok"), randomUUID()))).message, "Person not found.");
    });
  });

  // ---- 3. end and transfer --------------------------------------------------------------------------------------

  describe("ending and transferring an assignment", () => {
    scenario("end closes only the named company's open assignment, keeps history, allows a same-day end, then another company may assign", async () => {
      await only(...FULL());
      const [a, b] = await Promise.all([org("EndA"), org("EndB")]);
      const personId = await driver();
      const day = await today();
      const established = await establish(a, personId, "ACTIVE", day);
      // another company cannot end it: it has no assignment of its own to end
      assert.ok((await refused(K.oi.endOrganizationDriver({ organizationId: b, personId }))) instanceof K.errors.DriverIdentityNotFoundError);
      assert.equal(await open(personId), 1, "the other company's attempt ended nothing");
      const ended = await K.oi.endOrganizationDriver({ organizationId: a, personId });
      assert.equal(ended.effectiveTo, day, "same-day end");
      const row = (await rows(`SELECT status, to_char(effective_from,'YYYY-MM-DD') AS f, to_char(effective_to,'YYYY-MM-DD') AS t, closed_at IS NOT NULL AS closed, end_reason, record_status FROM public.organization_driver_relationships WHERE id = $1`, [established.relationshipId]))[0];
      assert.deepEqual(row, { status: "ENDED", f: day, t: day, closed: true, end_reason: "ENDED", record_status: "active" });
      assert.equal(await open(personId), 0);
      assert.ok((await refused(K.oi.endOrganizationDriver({ organizationId: a, personId }))) instanceof K.errors.DriverIdentityNotFoundError, "nothing left to end");
      // another company can now assign the same driver, the ended row is preserved
      await establish(b, personId, "ONBOARDING", day);
      assert.equal(await open(personId), 1);
      assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE person_id = $1`, [personId]), 2);
      // a future end date and an end before the start are refused
      assert.ok((await refused(K.oi.endOrganizationDriver({ organizationId: b, personId, effectiveTo: "2999-01-01" }))) instanceof K.errors.DriverIdentityValidationError);
      assert.ok((await refused(K.oi.endOrganizationDriver({ organizationId: b, personId, effectiveTo: "2000-01-01" }))) instanceof K.errors.DriverIdentityValidationError);
      assert.equal((await register("ORGANIZATION_DRIVER_END", established.relationshipId)).length, 1, "the Master Register records the end");
    }, "0037");

    scenario("a verified driver transfers in ONE step: previous row closed TRANSFERRED, new row opened on the same instant, same transfer id, two Master Register events", async () => {
      const actor = await only(...FULL());
      const [a, b] = await Promise.all([org("TrA"), org("TrB")]);
      const personId = await driver();
      const day = await today();
      const first = await establish(a, personId, "SUSPENDED", day);
      await verified(actor, a, personId);
      const moved = await K.oi.transferOrganizationDriver({ fromOrganizationId: a, toOrganizationId: b, personId, relationshipType: "CONTRACTOR", status: "ONBOARDING" });
      assert.equal(moved.endedRelationshipId, first.relationshipId);
      const [from, to] = await rows(`SELECT * FROM public.organization_driver_relationships WHERE id = ANY($1::uuid[]) ORDER BY organization_id = $2 DESC`, [[moved.endedRelationshipId, moved.relationshipId], a]);
      assert.equal(from.status, "ENDED");
      assert.equal(from.end_reason, "TRANSFERRED");
      assert.equal(to.status, "ONBOARDING");
      assert.equal(to.organization_id, b);
      assert.equal(from.transfer_id, moved.transferId);
      assert.equal(to.transfer_id, moved.transferId);
      assert.equal(new Date(from.closed_at).getTime(), new Date(to.activated_at).getTime(), "one instant");
      assert.equal(await open(personId), 1);
      assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE person_id = $1 AND organization_id = $2 AND effective_to IS NULL`, [personId, b]), 1);
      assert.equal((await register("ORGANIZATION_DRIVER_TRANSFER_OUT", moved.endedRelationshipId)).length, 1);
      const inEvents = await register("ORGANIZATION_DRIVER_TRANSFER_IN", moved.relationshipId);
      assert.equal(inEvents.length, 1);
      assert.equal(inEvents[0].actor_id, actor.actorId, "accountable to the actor who transferred");
      assert.ok((await refused(K.oi.transferOrganizationDriver({ fromOrganizationId: a, toOrganizationId: b, personId, relationshipType: "CONTRACTOR" }))) instanceof K.errors.DriverIdentityNotFoundError, "the source no longer holds the driver");
      assert.ok((await refused(K.oi.transferOrganizationDriver({ fromOrganizationId: b, toOrganizationId: b, personId, relationshipType: "CONTRACTOR" }))) instanceof K.errors.DriverIdentityValidationError);
    }, "0037");

    scenario("same-day transfers chain A -> B -> C -> A with no overlap, no gap and one open row", async () => {
      const actor = await only(...FULL());
      const [a, b, c] = await Promise.all([org("ChA"), org("ChB"), org("ChC")]);
      const personId = await driver();
      const day = await today();
      await establish(a, personId, "ACTIVE", day);
      await verified(actor, a, personId);
      for (const [from, to] of [[a, b], [b, c], [c, a]]) {
        await K.oi.transferOrganizationDriver({ fromOrganizationId: from, toOrganizationId: to, personId, relationshipType: "EMPLOYEE", status: "ACTIVE" });
        assert.equal(await open(personId), 1);
      }
      const history = await rows(`SELECT organization_id, status, to_char(effective_from,'YYYY-MM-DD') AS f, to_char(effective_to,'YYYY-MM-DD') AS t FROM public.organization_driver_relationships WHERE person_id = $1 ORDER BY activated_at NULLS FIRST, created_at, id`, [personId]);
      assert.equal(history.length, 4, "every row is preserved");
      assert.equal(history.filter((r) => r.t === null).length, 1);
      assert.ok(history.every((r) => r.f === day));
      assert.equal((await rows(`SELECT organization_id FROM public.organization_driver_relationships WHERE person_id = $1 AND effective_to IS NULL`, [personId]))[0].organization_id, a);
    }, "0037");

    scenario("concurrent transfers of one driver to two different companies: exactly one succeeds, never two open rows", async () => {
      const actor = await only(...FULL());
      const [from, b, c] = await Promise.all([org("CtF"), org("CtB"), org("CtC")]);
      const people = await Promise.all(Array.from({ length: 6 }, () => driver()));
      for (const personId of people) {
        await establish(from, personId);
        await verified(actor, from, personId);
      }
      const results = await Promise.allSettled(people.flatMap((personId) => [b, c].map((to) => K.oi.transferOrganizationDriver({ fromOrganizationId: from, toOrganizationId: to, personId, relationshipType: "EMPLOYEE" }))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, people.length);
      for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof K.errors.DriverIdentityNotFoundError || r.reason instanceof K.errors.DriverIdentityConflictError, String(r.reason));
      for (const personId of people) {
        assert.equal(await open(personId), 1);
        assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE person_id = $1 AND organization_id = $2 AND status = 'ENDED' AND end_reason = 'TRANSFERRED'`, [personId, from]), 1);
      }
    }, "0037");

    scenario("a transfer needs a VERIFIED identity: unverified, revoked and ambiguous identities are refused and nothing changes", async () => {
      const actor = await only(...FULL());
      const [a, b] = await Promise.all([org("VrA"), org("VrB")]);
      const personId = await driver();
      await establish(a, personId);
      const attempt1 = () => K.oi.transferOrganizationDriver({ fromOrganizationId: a, toOrganizationId: b, personId, relationshipType: "EMPLOYEE" });
      assert.match((await refused(attempt1())).message, /verified against evidence/, "unverified");
      // a matching name / date of birth / licence number is never verification
      await addLicence(personId, "CA", "ON", licenceNo());
      assert.equal((await K.oi.readDriverIdentityVerification(personId)).status, "UNVERIFIED");
      assert.match((await refused(attempt1())).message, /verified against evidence/);
      const doc = await verified(actor, a, personId);
      await K.oi.revokeDriverIdentityVerification({ personId, reason: "evidence found to be for another person" });
      assert.equal((await K.oi.readDriverIdentityVerification(personId)).status, "REVOKED");
      assert.match((await refused(attempt1())).message, /verified against evidence/, "revoked");
      // re-verification reuses the SAME stored evidence: no duplicate upload
      await K.oi.verifyDriverIdentity({ personId, organizationId: a, evidenceDocumentId: doc, method: "LICENCE_DOCUMENT_REVIEW" });
      assert.equal((await K.oi.readDriverIdentityVerification(personId)).status, "VERIFIED");
      // ambiguous: an unresolved person case names the driver (the actor here holds NO IDENTITY_RESOLUTION_READ and is still refused)
      await ambiguous(personId, "PENDING");
      assert.match((await refused(attempt1())).message, /pending review/);
      assert.equal(await open(personId), 1);
      assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE person_id = $1 AND organization_id = $2`, [personId, b]), 0);
    }, "0037");
  });

  // ---- 4. verified identity --------------------------------------------------------------------------------------

  describe("evidence-backed identity verification", () => {
    scenario("verification needs a verified, stored, correctly typed document that belongs to a company the driver is recorded with", async () => {
      const actor = await only(...FULL());
      const [a, stranger] = await Promise.all([org("EvA"), org("EvStranger")]);
      const personId = await driver();
      await establish(a, personId);
      const verify = (organizationId: string, evidenceDocumentId: string) => K.oi.verifyDriverIdentity({ personId, organizationId, evidenceDocumentId, method: "GOVERNMENT_ID_REVIEW" });
      const bad: Array<[string, string, RegExp]> = [
        ["unverified document", await evidence(a, actor.actorId, "DRIVER_IDENTITY_DOCUMENT", "received"), /not been verified/],
        ["wrong type", await evidence(a, actor.actorId, "OTHER_EVIDENCE"), /must be a DRIVER_IDENTITY_DOCUMENT/],
        ["not stored", await evidence(a, actor.actorId, "DRIVER_IDENTITY_DOCUMENT", "verified", "quarantined"), /not securely stored/],
      ];
      for (const [label, doc, pattern] of bad) assert.match((await refused(verify(a, doc))).message, pattern, label);
      assert.match((await refused(verify(a, randomUUID()))).message, /could not be found/);
      assert.match((await refused(verify(stranger, await evidence(stranger, actor.actorId)))).message, /recorded with/, "a company the driver has no record with");
      assert.ok((await refused(K.oi.verifyDriverIdentity({ personId, organizationId: a, evidenceDocumentId: await evidence(a, actor.actorId), method: "SELF_DECLARED" as never }))) instanceof K.errors.DriverIdentityValidationError);
      assert.equal((await K.oi.readDriverIdentityVerification(personId)).status, "UNVERIFIED");
      assert.equal(await count(`SELECT count(*) FROM public.driver_identity_verifications WHERE person_id = $1`, [personId]), 0);

      const good = await evidence(a, actor.actorId);
      const done = await verify(a, good);
      assert.equal((await K.oi.readDriverIdentityVerification(personId)).status, "VERIFIED");
      const events = await register("DRIVER_IDENTITY_VERIFY", done.verificationId);
      assert.equal(events.length, 1);
      assert.equal(events[0].actor_id, actor.actorId);
      const stored = (await rows(`SELECT master_register_event_id, evidence_document_id FROM public.driver_identity_verifications WHERE id = $1`, [done.verificationId]))[0];
      assert.equal(stored.evidence_document_id, good);
      assert.ok(stored.master_register_event_id);
      // the same document can never verify a DIFFERENT driver (identity evidence is about one person)
      const other = await driver();
      await establish(a, other);
      const crossed = await refused(K.oi.verifyDriverIdentity({ personId: other, organizationId: a, evidenceDocumentId: good, method: "GOVERNMENT_ID_REVIEW" }));
      assert.ok(crossed instanceof K.errors.DriverIdentityConflictError);
      assert.ok(!crossed.message.includes(personId));
      assert.equal(await count(`SELECT count(*) FROM public.driver_identity_verifications WHERE person_id = $1`, [other]), 0);
      // revocation needs a reason and is recorded; the earlier event stays
      assert.ok((await refused(K.oi.revokeDriverIdentityVerification({ personId, reason: " " }))) instanceof K.errors.DriverIdentityValidationError);
      const revoked = await K.oi.revokeDriverIdentityVerification({ personId, reason: "evidence withdrawn" });
      assert.equal((await register("DRIVER_IDENTITY_REVOKE", revoked.verificationId)).length, 1);
      assert.equal(await count(`SELECT count(*) FROM public.driver_identity_verifications WHERE person_id = $1`, [personId]), 2);
      assert.ok((await refused(K.oi.revokeDriverIdentityVerification({ personId, reason: "again" }))) instanceof K.errors.DriverIdentityStateError);
      // RE-VERIFICATION with the same stored document: no new upload, a third append-only event, same provenance
      const again = await verify(a, good);
      assert.equal((await K.oi.readDriverIdentityVerification(personId)).status, "VERIFIED");
      const log = await rows(`SELECT verification_status AS s, evidence_document_id AS d, organization_id AS o FROM public.driver_identity_verifications WHERE person_id = $1 ORDER BY recorded_at, id`, [personId]);
      assert.deepEqual(log.map((r) => r.s), ["VERIFIED", "REVOKED", "VERIFIED"], "every event is kept");
      assert.equal(log[2].d, good);
      assert.equal(log[2].o, a);
      assert.equal((await register("DRIVER_IDENTITY_VERIFY", again.verificationId)).length, 1);
      // ... but only while the document is still a verified, stored one: archived/rejected evidence cannot re-verify
      await K.oi.revokeDriverIdentityVerification({ personId, reason: "second revocation" });
      await pools.admin.query(`UPDATE public.evidence_documents SET document_status = 'rejected' WHERE id = $1`, [good]);
      assert.match((await refused(verify(a, good))).message, /not been verified/);
    }, "0037");

    scenario("the verification log is append-only for every role, and a VERIFIED row cannot exist without evidence", async () => {
      const actor = await only(...FULL());
      const a = await org("Log");
      const personId = await driver();
      await establish(a, personId);
      const doc = await verified(actor, a, personId);
      assert.equal((await raw(`UPDATE public.driver_identity_verifications SET reason = 'x' WHERE person_id = $1`, [personId])).code, "23514");
      assert.equal((await raw(`DELETE FROM public.driver_identity_verifications WHERE person_id = $1`, [personId])).code, "23514");
      assert.equal((await raw(`TRUNCATE public.driver_identity_verifications`)).code, "23514");
      const bare = await raw(`INSERT INTO public.driver_identity_verifications (person_id, verification_status, verified_by_actor_id) VALUES ($1, 'VERIFIED', $2)`, [personId, actor.actorId]);
      assert.equal(bare.code, "23514", "no method / evidence / event");
      const reuse = `INSERT INTO public.driver_identity_verifications (person_id, verification_status, method, organization_id, evidence_document_id, verified_by_actor_id, master_register_event_id) VALUES ($1, 'VERIFIED', 'GOVERNMENT_ID_REVIEW', $2, $3, $4, $5)`;
      await pools.admin.query(reuse, [personId, a, doc, actor.actorId, randomUUID()]); // the SAME driver may reuse the document (re-verification)
      const stranger = await driver();
      assert.equal((await raw(reuse, [stranger, a, doc, actor.actorId, randomUUID()])).code, "23505", "a different driver may not");
      // the runtime role: no UPDATE / DELETE privilege, and no insert without DRIVER_IDENTITY_VERIFY
      assert.equal((await attempt("DRIVER_MANAGE", `UPDATE public.driver_identity_verifications SET reason = 'x'`)).code, "42501");
      assert.equal((await attempt("DRIVER_MANAGE", `DELETE FROM public.driver_identity_verifications`)).code, "42501");
      const insert = `INSERT INTO public.driver_identity_verifications (person_id, verification_status, reason, verified_by_actor_id, master_register_event_id) VALUES ($1, 'REVOKED', 'r', $2, $3)`;
      assert.equal((await attempt("DRIVER_MANAGE", insert, [personId, actor.actorId, randomUUID()])).code, "42501", "RLS: DRIVER_MANAGE cannot write verifications");
      assert.equal((await attempt("DRIVER_IDENTITY_VERIFY", insert, [personId, actor.actorId, randomUUID()])).rowCount, 1);
    }, "0037");
  });

  // ---- 5. authorization and tenant isolation ----------------------------------------------------------------------

  describe("capability enforcement and isolation", () => {
    scenario("each operation is refused without its capability, and nothing is changed", async () => {
      const full = await staff(...FULL());
      const [a, b] = await Promise.all([org("CapA"), org("CapB")]);
      const personId = await driver();
      K.db.setClerkUser(full.clerkSubject);
      await establish(a, personId);
      await verified(full, a, personId);
      const doc = await evidence(a, full.actorId);
      const denied = async (capabilities: string[], work: () => Promise<unknown>, label: string) => {
        await only(...capabilities);
        assert.equal((await refused(work())).constructor.name, "TesAuthorizationDeniedError", label);
      };
      const spare = await driver();
      await denied(["DRIVER_READ"], () => establish(b, spare), "read-only cannot establish");
      await denied(["DRIVER_READ"], () => K.oi.endOrganizationDriver({ organizationId: a, personId }), "read-only cannot end");
      await denied(["DRIVER_READ"], () => K.oi.transferOrganizationDriver({ fromOrganizationId: a, toOrganizationId: b, personId, relationshipType: "EMPLOYEE" }), "read-only cannot transfer");
      await denied(["DRIVER_MANAGE", "EVIDENCE_READ"], () => K.oi.verifyDriverIdentity({ personId, organizationId: a, evidenceDocumentId: doc, method: "GOVERNMENT_ID_REVIEW" }), "no DRIVER_IDENTITY_VERIFY");
      await denied(["DRIVER_MANAGE", "DRIVER_IDENTITY_VERIFY"], () => K.oi.verifyDriverIdentity({ personId, organizationId: a, evidenceDocumentId: doc, method: "GOVERNMENT_ID_REVIEW" }), "no EVIDENCE_READ");
      await denied(["DRIVER_MANAGE"], () => K.oi.revokeDriverIdentityVerification({ personId, reason: "no capability" }), "revoke without DRIVER_IDENTITY_VERIFY");
      assert.equal((await K.oi.readDriverIdentityVerification(personId).catch((e: Error) => e.constructor.name)), "TesAuthorizationDeniedError", "reading needs DRIVER_READ");
      assert.equal(await open(personId), 1);
      assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE person_id = $1`, [personId]), 1);
      assert.equal(await count(`SELECT count(*) FROM public.driver_identity_verifications WHERE person_id = $1`, [personId]), 1);
    }, "0037");

    scenario("a company's staff view never learns another company's drivers: conflict and not-found responses carry no foreign identifiers", async () => {
      const actor = await only(...FULL());
      const [mine, theirs] = await Promise.all([org("Mine"), org("Theirs")]);
      const theirDriver = await driver();
      await establish(theirs, theirDriver);
      const text = (error: Error) => JSON.stringify({ ...error, message: error.message });
      for (const error of [
        await refused(establish(mine, theirDriver)),
        await refused(K.oi.endOrganizationDriver({ organizationId: mine, personId: theirDriver })),
        await refused(K.oi.transferOrganizationDriver({ fromOrganizationId: mine, toOrganizationId: theirs, personId: theirDriver, relationshipType: "EMPLOYEE" })),
      ]) {
        const body = text(error);
        for (const secret of [theirs, theirDriver, "Theirs"]) assert.ok(!body.includes(secret), `no foreign identifier in: ${body}`);
        assert.ok([409, 404].includes(K.response.canonicalFailure(error, "x").status));
      }
      // ending as the wrong company changed nothing of the other company's relationship
      assert.equal(await open(theirDriver), 1);
      void actor;
    }, "0037");
  });

  // ---- 6. schema parity and compatibility -------------------------------------------------------------------------

  describe("temporal integrity and first-time onboarding", () => {
    scenario("same-day changes keep a reliable, queryable timeline: both time dimensions, point-in-time holder, no phantom rows", async () => {
      const actor = await only(...FULL());
      const [a, b, c] = await Promise.all([org("TlA"), org("TlB"), org("TlC")]);
      const personId = await driver();
      const day = await today();
      await establish(a, personId, "ACTIVE", day);
      await verified(actor, a, personId);
      for (const [from, to] of [[a, b], [b, a], [a, c]]) await K.oi.transferOrganizationDriver({ fromOrganizationId: from, toOrganizationId: to, personId, relationshipType: "EMPLOYEE", status: "ACTIVE" });

      const timeline: any[] = await K.oi.readDriverAssignmentTimeline(personId);
      assert.deepEqual(timeline.map((r: any) => r.organization_id), [a, b, a, c], "ordered by the instant TES opened each row");
      assert.ok(timeline.every((r: any) => r.activated_at && r.effective_from === day));
      for (let i = 0; i < 3; i += 1) {
        assert.equal(timeline[i].closed_at, timeline[i + 1].activated_at, `row ${i} closes at the very instant row ${i + 1} opens (microsecond precision)`);
        assert.equal(timeline[i].effective_to, day);
        assert.equal(timeline[i].end_reason, "TRANSFERRED");
      }
      assert.equal(timeline[3].closed_at, null);
      assert.equal(timeline[3].effective_to, null);
      assert.ok(timeline.every((r: any, i: number) => i === 0 || r.activated_at > timeline[i - 1].activated_at), "strictly increasing");

      // by business DAY: every row that touched the day, including the empty same-day periods; the day before has none
      assert.equal((await K.oi.readDriverAssignmentTimeline(personId, { onDate: day })).length, 4);
      const yesterday = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      assert.equal((await K.oi.readDriverAssignmentTimeline(personId, { onDate: yesterday })).length, 0);
      // by INSTANT: exactly one holder at any moment, and none before the first assignment was recorded
      for (const row of timeline) {
        const at = await K.oi.readDriverAssignmentTimeline(personId, { atInstant: row.activated_at });
        assert.deepEqual(at.map((r: any) => r.id), [row.id], `holder at ${row.activated_at}`);
      }
      assert.equal((await K.oi.readDriverAssignmentTimeline(personId, { atInstant: new Date(Date.parse(timeline[0].activated_at) - 5).toISOString() })).length, 0);
      assert.equal((await K.oi.readDriverAssignmentTimeline(personId, { atInstant: new Date(Date.now() + 60_000).toISOString() }))[0].id, timeline[3].id);
      assert.ok((await refused(K.oi.readDriverAssignmentTimeline(personId, { atInstant: "not a time" }))) instanceof K.errors.DriverIdentityValidationError);

      // no phantom same-day row can be inserted behind the open assignment (it would overlap in recording time), and none without instants
      const phantom = (activated: string | null, closed: string | null) =>
        raw(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from, effective_to, activated_at, closed_at, end_reason) VALUES ($1, $2, 'EMPLOYEE', 'ENDED', $3, $3, $4, $5, 'ENDED')`, [b, personId, day, activated, closed]);
      const t3 = Date.parse(timeline[3].activated_at);
      assert.equal((await phantom(new Date(t3 + 1000).toISOString(), new Date(t3 + 2000).toISOString())).code, "23P01");
      assert.equal((await phantom(null, null)).code, "23514");
      // the timeline needs 0037 and DRIVER_READ
      await only("DRIVER_MANAGE");
      assert.equal((await refused(K.oi.readDriverAssignmentTimeline(personId))).constructor.name, "TesAuthorizationDeniedError");
    }, "0037");

    scenario("first-time onboarding has no circular dependency: profile, licence, evidence, assignment, verification, transfer", async () => {
      const actor = await only(...FULL());
      const [a, b] = await Promise.all([org("OnA"), org("OnB")]);
      const personId = await driver(false);
      const day = await today();
      assert.deepEqual(await K.oi.createDriverProfile({ personId }), { personId });
      assert.equal((await addLicence(personId, "Canada", "Ontario", licenceNo())).kind, "CREATED");
      // evidence can be stored before the assignment exists, but verification needs the company to hold a record of the driver
      const doc = await evidence(a, actor.actorId);
      assert.match((await refused(K.oi.verifyDriverIdentity({ personId, organizationId: a, evidenceDocumentId: doc, method: "LICENCE_DOCUMENT_REVIEW" }))).message, /recorded with/);
      // the driver is assigned UNVERIFIED (onboarding) - assignment never requires verification
      const assigned = await establish(a, personId, "ONBOARDING", day);
      assert.equal((await K.oi.readDriverIdentityVerification(personId)).status, "UNVERIFIED");
      const transfer = () => K.oi.transferOrganizationDriver({ fromOrganizationId: a, toOrganizationId: b, personId, relationshipType: "EMPLOYEE", status: "ACTIVE" });
      assert.match((await refused(transfer())).message, /verified against evidence/, "an unverified driver cannot be moved");
      // verification with the evidence the company already holds: nothing else is needed, and re-verification never re-uploads
      const done = await K.oi.verifyDriverIdentity({ personId, organizationId: a, evidenceDocumentId: doc, method: "LICENCE_DOCUMENT_REVIEW" });
      assert.equal((await K.oi.readDriverIdentityVerification(personId)).status, "VERIFIED");
      const moved = await transfer();
      assert.equal(moved.endedRelationshipId, assigned.relationshipId);
      assert.equal(await open(personId), 1);
      const timeline: any[] = await K.oi.readDriverAssignmentTimeline(personId);
      assert.deepEqual(timeline.map((r: any) => [r.organization_id, r.status]), [[a, "ENDED"], [b, "ACTIVE"]]);
      // accountability: every step is in the Master Register against the acting user
      for (const [operation, id] of [["DRIVER_PROFILE_CREATE", personId], ["ORGANIZATION_DRIVER_ESTABLISH", assigned.relationshipId], ["DRIVER_IDENTITY_VERIFY", done.verificationId], ["ORGANIZATION_DRIVER_TRANSFER_OUT", moved.endedRelationshipId], ["ORGANIZATION_DRIVER_TRANSFER_IN", moved.relationshipId]]) {
        const events = await register(operation, id);
        assert.equal(events.length, 1, operation);
        assert.equal(events[0].actor_id, actor.actorId, operation);
      }
    }, "0037");

    scenario("two drivers racing to use the same evidence document: exactly one verification is recorded", async () => {
      const actor = await only(...FULL());
      const a = await org("RaceEv");
      const people = await Promise.all([driver(), driver()]);
      for (const personId of people) await establish(a, personId);
      const doc = await evidence(a, actor.actorId);
      const results = await Promise.allSettled(people.map((personId) => K.oi.verifyDriverIdentity({ personId, organizationId: a, evidenceDocumentId: doc, method: "GOVERNMENT_ID_REVIEW" })));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.ok(lost.reason instanceof K.errors.DriverIdentityConflictError, String(lost.reason));
      assert.equal(await count(`SELECT count(DISTINCT person_id) FROM public.driver_identity_verifications WHERE evidence_document_id = $1`, [doc]), 1);
    }, "0037");
  });

  describe("periods and constraints", () => {
    scenario("the period check allows a same-day (empty) period but not an inverted one; the open-assignment index ignores closed rows", async () => {
      const [a, b] = await Promise.all([org("PerA"), org("PerB")]);
      const personId = await driver();
      const insert = (organizationId: string, from: string, to: string | null, status = "ENDED") =>
        pools.admin.query(
          `INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from, effective_to) VALUES ($1, $2, 'EMPLOYEE', $3, $4, $5)`,
          [organizationId, personId, status, from, to],
        );
      // a same-day (empty) period is legal only when it carries its recording instants
      assert.equal((await raw(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from, effective_to) VALUES ($1, $2, 'EMPLOYEE', 'ENDED', '2024-05-01', '2024-05-01')`, [a, personId])).code, "23514");
      await pools.admin.query(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from, effective_to, activated_at, closed_at, end_reason) VALUES ($1, $2, 'EMPLOYEE', 'ENDED', '2024-05-01', '2024-05-01', '2024-05-01T08:00:00Z', '2024-05-01T09:00:00Z', 'ENDED')`, [a, personId]);
      assert.equal((await raw(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from, effective_to, activated_at, closed_at, end_reason) VALUES ($1, $2, 'EMPLOYEE', 'ENDED', '2024-05-01', '2024-05-01', '2024-05-01T08:30:00Z', '2024-05-01T08:45:00Z', 'ENDED')`, [b, personId])).code, "23P01", "instants of one driver never overlap");
      assert.equal((await raw(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from, effective_to, activated_at, closed_at, end_reason) VALUES ($1, $2, 'EMPLOYEE', 'ENDED', '2024-05-01', '2024-05-01', '2024-05-01T10:00:00Z', '2024-05-01T09:30:00Z', 'ENDED')`, [b, personId])).code, "23514", "closed before activated");
      await pools.admin.query(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from, effective_to, activated_at, closed_at, end_reason) VALUES ($1, $2, 'EMPLOYEE', 'ENDED', '2024-05-01', '2024-05-01', '2024-05-01T09:00:00Z', '2024-05-01T09:30:00Z', 'ENDED')`, [b, personId]); // touching instants [) are fine
      assert.equal((await raw(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from, effective_to) VALUES ($1, $2, 'EMPLOYEE', 'ENDED', '2024-05-02', '2024-05-01')`, [a, personId])).code, "23514");
      await insert(b, "2024-05-01", null, "ON_LEAVE");
      assert.equal(await open(personId), 1);
      assert.equal((await raw(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from) VALUES ($1, $2, 'EMPLOYEE', 'ACTIVE', '2030-01-01')`, [a, personId])).code, "23505");
      assert.equal((await raw(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from) VALUES ($1, $2, 'EMPLOYEE', 'RETIRED', '2030-01-01')`, [a, personId])).code, "23514", "unknown status");
      assert.equal((await raw(`UPDATE public.organization_driver_relationships SET closed_at = now() WHERE person_id = $1 AND status = 'ON_LEAVE'`, [personId])).code, "23514", "close bookkeeping must be consistent");
    }, "0037");
  });

  // ---- 7. before the migration ---------------------------------------------------------------------------------------

  describe("before migration 0037 is applied, then the migration itself", () => {
    scenario("the 0037 operations fail closed with a clear message and change nothing; existing operations keep working", async () => {
      await only(...["DRIVER_MANAGE", "DRIVER_READ", "EVIDENCE_READ", "IDENTITY_RESOLUTION_READ"]);
      const [a, b] = await Promise.all([org("PreA"), org("PreB")]);
      const personId = await driver();
      await establish(a, personId);
      for (const work of [
        () => K.oi.endOrganizationDriver({ organizationId: a, personId }),
        () => K.oi.transferOrganizationDriver({ fromOrganizationId: a, toOrganizationId: b, personId, relationshipType: "EMPLOYEE" }),
        () => K.oi.verifyDriverIdentity({ personId, organizationId: a, evidenceDocumentId: randomUUID(), method: "GOVERNMENT_ID_REVIEW" }),
      ]) {
        const error = await refused(work());
        assert.ok(error instanceof K.errors.DriverIdentityStateError || error.constructor.name === "TesAuthorizationDeniedError", error.message);
        if (error instanceof K.errors.DriverIdentityStateError) assert.match(error.message, /migration 0037/);
      }
      assert.equal(await open(personId), 1);
      assert.equal((await K.oi.readDriverIdentityVerification(personId)).status, "UNVERIFIED");
      // before 0037 the ambiguity check needs IDENTITY_RESOLUTION_READ, so assignment FAILS CLOSED for a caller without it
      const blind = await driver();
      await only("DRIVER_MANAGE");
      assert.match((await refused(establish(a, blind))).message, /migration 0037/);
      assert.equal(await open(blind), 0);
      await only("DRIVER_MANAGE", "DRIVER_READ", "EVIDENCE_READ", "IDENTITY_RESOLUTION_READ");
      // the application-level exclusivity holds without the index: the person lock serializes two companies racing for one driver
      const raced = await driver();
      const results = await Promise.allSettled([establish(a, raced), establish(b, raced)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(await open(raced), 1);
      // the licence conflict is also decided in the application, across spellings
      const [p1, p2] = [await driver(), await driver()];
      const number = licenceNo();
      await addLicence(p1, "Canada", "Ontario", number);
      assert.ok((await refused(addLicence(p2, "CA", "ON", number))) instanceof K.errors.DriverIdentityConflictError);
    }, "pre");

    scenario("migration 0037 REFUSES to apply over existing conflicts (changing nothing), the preflight lists them, and it applies once they are resolved without rewriting history", async () => {
      const [a, b] = await Promise.all([org("MigA"), org("MigB")]);
      const [p1, p2, legacy, twice] = [await driver(), await driver(), await driver(), await driver()];
      const number = licenceNo();
      const insertLicence = (personId: string, country: string, region: string, display: string) =>
        pools.admin.query(`INSERT INTO public.driver_licences (person_id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_number_normalized, effective_from) VALUES ($1, $2, $3, $4, $4, '2024-01-01')`, [personId, country, region, display]);
      // legacy rows stored in different spellings: the pre-0037 unique index cannot see they are the same licence
      await insertLicence(p1, "CA", "ON", number);
      await insertLicence(p2, "Canada", "Ontario", number);
      const legacyNumber = licenceNo();
      // a historical licence from outside the supported countries (and an invalid pair) is legal before 0037; it must survive the migration untouched
      const historical = await driver();
      await insertLicence(historical, "United Kingdom", "Greater London", licenceNo());
      await insertLicence(await driver(), "Canada", "Texas", licenceNo());
      await insertLicence(legacy, "Canada", "Ontario", legacyNumber);
      // a driver in two companies at once is possible before 0037 only through direct writes (different organizations)
      const assign = (organizationId: string, personId: string) =>
        pools.admin.query(`INSERT INTO public.organization_driver_relationships (organization_id, person_id, relationship_type, status, effective_from) VALUES ($1, $2, 'EMPLOYEE', 'ACTIVE', '2024-01-01')`, [organizationId, personId]);
      await assign(a, twice);
      await assign(b, twice);

      const sql = readFileSync(path.join(process.cwd(), "database/migrations/0037_driver_identity_integrity_and_exclusive_assignment.sql"), "utf8");
      const error = await raw(sql);
      assert.match(error.message, /Migration 0037 cannot be applied/);
      assert.equal((await rows(`SELECT to_regclass('public.driver_identity_verifications') AS t, to_regprocedure('tes_security.canonical_country_code(text)') AS f`))[0].t, null, "nothing was applied");
      assert.equal(await count(`SELECT count(*) FROM public.driver_licences WHERE person_id = ANY($1::uuid[])`, [[p1, p2, legacy]]), 3, "no record was merged or removed");

      // the read-only preflight lists the conflicts (its psql meta-commands are skipped; the statements are plain SELECTs)
      const preflight = readFileSync(path.join(process.cwd(), "scripts/database/preflight-0037-driver-identity.sql"), "utf8")
        .split("\n").filter((line) => !line.startsWith("\\")).join("\n");
      const client = await pools.admin.connect();
      let results: Array<{ rows: any[] }>;
      try {
        results = (await client.query(preflight)) as never;
      } finally {
        await client.query("RESET default_transaction_read_only").catch(() => undefined);
        client.release();
      }
      const select = results.filter((r: any) => r.command === "SELECT") as Array<{ rows: any[] }>;
      assert.equal(select.length, 5);
      assert.ok(select[0].rows.some((r) => r.number === number && Number(r.rows) === 2), "the equivalent-spelling licence group is listed");
      assert.ok(select[1].rows.length >= 1, "the overlapping licence periods are listed");
      assert.ok(select[2].rows.some((r) => r.person_id === twice && Number(r.open_assignments) === 2), "the driver in two companies is listed");
      assert.ok(select[3].rows.length >= 1);

      // resolve by an authorized review (here: direct, as the owner) - the migration never does it automatically
      await pools.admin.query(`UPDATE public.driver_licences SET record_status = 'voided', corrected_at = now() WHERE person_id = $1`, [p2]);
      await pools.admin.query(`UPDATE public.organization_driver_relationships SET record_status = 'voided', corrected_at = now() WHERE person_id = $1 AND organization_id = $2`, [twice, b]);
      await pools.admin.query(sql);
      has0037 = true;
      // history is preserved exactly: the legacy non-canonical row was NOT rewritten, the voided and ended rows are intact
      assert.deepEqual(
        (await rows(`SELECT jurisdiction_country AS c, jurisdiction_region AS r FROM public.driver_licences WHERE person_id = $1`, [legacy]))[0],
        { c: "Canada", r: "Ontario" },
      );
      assert.equal(await count(`SELECT count(*) FROM public.driver_licences WHERE person_id = $1 AND record_status = 'voided'`, [p2]), 1);
      assert.deepEqual((await rows(`SELECT jurisdiction_country AS c, jurisdiction_region AS r FROM public.driver_licences WHERE person_id = $1`, [historical]))[0], { c: "United Kingdom", r: "Greater London" }, "historical rows are not rewritten or rejected");
      assert.equal(await count(`SELECT count(*) FROM public.driver_licences WHERE jurisdiction_country = 'Canada' AND jurisdiction_region = 'Texas' AND person_id = ANY($1::uuid[])`, [persons]), 1);
      assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE person_id = $1`, [twice]), 2);
      // ...and the canonical constraints now also cover those legacy rows
      await only(...DM());
      assert.ok((await refused(addLicence(await driver(), "CA", "ON", legacyNumber))) instanceof K.errors.DriverIdentityConflictError, "a legacy 'Canada/Ontario' row still blocks the 'CA/ON' spelling");
      assert.equal((await rows(`SELECT count(*)::int AS c FROM public.capabilities WHERE code = 'DRIVER_IDENTITY_VERIFY' AND is_active`))[0].c, 1);
    }, "pre");
  });
});
