// Runs the read-only production assessment against the disposable database: every statement must execute inside a READ ONLY
// transaction (so it cannot write), and the row counts must be identical before and after.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import type { Pools } from "@/test/helpers/auth-db";

const enabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
if (!enabled && process.env.TES_REQUIRE_DB_TESTS === "1") {
  it("requires a disposable test database (TES_REQUIRE_DB_TESTS=1)", () => {
    assert.fail("TES_TEST_ADMIN_DATABASE_URL and TES_TEST_RUNTIME_DATABASE_URL must be set");
  });
}

describe("company recovery assessment SQL", { skip: !enabled }, () => {
  let pools: Pools;
  let db: typeof import("@/test/helpers/auth-db");
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    db = await import("@/test/helpers/auth-db");
    pools = db.openPools();
  });
  after(async () => {
    await db.closePools();
  });

  for (const file of ["company-recovery-assessment.sql", "creator-capability-check.sql", "power-way-identification.sql"]) it(`${file}: executes every statement read-only and changes nothing`, async () => {
    const sql = readFileSync(`scripts/database/assessment/${file}`, "utf8");
    const statements = sql
      .split(/^-- name: /m)
      .slice(1)
      .map((block) => ({ name: block.split("\n", 1)[0], text: block.slice(block.indexOf("\n") + 1).trim() }));
    assert.ok(statements.length >= 2);
    assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/i, "the assessment contains no write or DDL");

    const counts = async () => (await pools.admin.query(`SELECT (SELECT count(*) FROM public.organizations) AS o, (SELECT count(*) FROM public.customers) AS c`)).rows[0];
    const before = await counts();
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN READ ONLY");
      for (const statement of statements) await client.query(statement.text.replace(/;\s*$/, "")).catch((error: Error) => { throw new Error(`${statement.name}: ${error.message}`); });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    assert.deepEqual(await counts(), before);
  });

  it("creator-capability-check reports exactly which capabilities an actor lacks (mirrors the RLS gate)", async () => {
    const fx = new db.AuthFixtures(pools.admin);
    try {
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
      for (const capability of ["ORGANIZATION_CREATE", "COMPANY_PROFILE_MANAGE"]) await fx.grant(relationshipId, capability, { assignmentId });

      const sql = readFileSync("scripts/database/assessment/creator-capability-check.sql", "utf8");
      const second = sql.split(/^-- name: /m).slice(1)[1];
      const text = second.slice(second.indexOf("\n") + 1).trim().replace(/;\s*$/, "");
      const row = (await pools.admin.query(text)).rows.find((r: { actor_id: string }) => r.actor_id === actor.actorId);
      assert.ok(row, "the staff actor is listed");
      assert.equal(row.master_account, false);
      assert.equal(row.can_create_minimal_company, true);
      assert.equal(row.can_create_complete_customer, false);
      assert.equal(row.can_read_complete_profile, false);
      assert.ok((row.missing_capabilities as string[]).includes("CONTACT_MANAGE"));
      assert.ok(!(row.missing_capabilities as string[]).includes("ORGANIZATION_CREATE"));
    } finally {
      await fx.cleanup();
    }
  });
});
