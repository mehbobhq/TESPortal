// Run with `scripts/test/run-auth-tests.sh --test-name-pattern='Legacy import infrastructure'`
// or against a disposable database via TES_TEST_ADMIN_DATABASE_URL and TES_TEST_RUNTIME_DATABASE_URL.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    legacy: await import("@/lib/legacy-import/service"),
    companies: await import("@/lib/legacy-import/domains/companies"),
    source: await import("@/lib/legacy-import/source"),
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

type Capability = "LEGACY_IMPORT_READ" | "LEGACY_IMPORT_MANAGE";
const ALL_CAPABILITIES: Capability[] = ["LEGACY_IMPORT_READ", "LEGACY_IMPORT_MANAGE"];
const IMPORT_TABLES = [
  "legacy_import_review_decisions",
  "legacy_import_checkpoints",
  "legacy_import_records",
  "legacy_canonical_record_map",
  "legacy_import_batches",
] as const;

describe("Legacy import infrastructure (real authorization, real RLS, real transactions)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let batchIds: string[] = [];

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });

  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  async function purge() {
    if (batchIds.length === 0) return;
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const table of IMPORT_TABLES) await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`);
      for (const table of IMPORT_TABLES) await client.query(`DELETE FROM public.${table} WHERE ${
        table === "legacy_import_review_decisions"
          ? "import_record_id IN (SELECT id FROM public.legacy_import_records WHERE import_batch_id = ANY($1::uuid[]))"
          : table === "legacy_canonical_record_map"
            ? "import_batch_id = ANY($1::uuid[])"
            : table === "legacy_import_batches"
              ? "id = ANY($1::uuid[])"
              : "import_batch_id = ANY($1::uuid[])"
      }`, [batchIds]);
      for (const table of [...IMPORT_TABLES].reverse()) await client.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      batchIds = [];
    }
  }

  const scenario = (name: string, body: () => Promise<void>) =>
    it(name, async () => {
      fx = new K.db.AuthFixtures(pools.admin);
      batchIds = [];
      K.db.setClerkUser(null);
      try {
        await body();
      } finally {
        K.db.setClerkUser(null);
        await purge();
        await fx.cleanup();
      }
    });

  async function staff(...capabilities: Capability[]): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    return actor;
  }

  async function fullStaff() {
    const actor = await staff(...ALL_CAPABILITIES);
    K.db.setClerkUser(actor.clerkSubject);
    return actor;
  }

  async function createBatch() {
    const batch = await K.legacy.createLegacyImportBatch({
      sourceSystem: "tes-browser-localstorage",
      sourceNamespace: `legacy-import-db-test:${randomUUID()}`,
      sourceDescription: "Disposable legacy import DB test",
      importMode: "dry_run",
    });
    batchIds.push(batch.id);
    return batch;
  }

  const canonicalRowCount = async () =>
    Number((await pools.admin.query(`
      SELECT
        (SELECT count(*) FROM public.organizations WHERE legal_name LIKE 'Legacy Import DB Test%')
        + (SELECT count(*) FROM public.customers c JOIN public.organizations o ON o.id = c.organization_id WHERE o.legal_name LIKE 'Legacy Import DB Test%') AS count
    `)).rows[0].count);

  scenario("stages supported source records idempotently and reports review exceptions", async () => {
    await fullStaff();
    const beforeCanonical = await canonicalRowCount();
    const batch = await createBatch();
    await K.legacy.startLegacyImportBatch(batch.id);

    const plan = K.companies.buildCompanyCustomerStagePlan({
      importBatchId: batch.id,
      sourceSystem: batch.sourceSystem,
      sourceNamespace: batch.sourceNamespace,
      companies: [
        { id: "CMP-1", name: "Legacy Import DB Test Alpha", type: "Customer", customBrowserOnlyFlag: true },
      ],
    });

    const first = await K.legacy.stageLegacyImportRecords(plan);
    assert.equal(first.records.length, 2);
    assert.equal(first.checkpoint.checkpointStatus, "completed");
    assert.equal(first.checkpoint.reviewCount, 2);

    const replay = await K.legacy.stageLegacyImportRecords(plan);
    assert.deepEqual(replay.records.map((record) => record.id).sort(), first.records.map((record) => record.id).sort());

    const report = await K.legacy.readLegacyImportBatchReport(batch.id);
    assert.equal(report.totalRecords, 2);
    assert.equal(report.byStatus.review_required, 2);
    assert.equal(report.byEntityType.COMPANY, 1);
    assert.equal(report.byEntityType.CUSTOMER, 1);
    assert.equal(report.unsupportedFieldCount, 2);
    assert.equal(await canonicalRowCount(), beforeCanonical);
  });

  scenario("rejects changed content under the same batch source key without canonical mutation", async () => {
    await fullStaff();
    const beforeCanonical = await canonicalRowCount();
    const batch = await createBatch();
    await K.legacy.startLegacyImportBatch(batch.id);

    const original = K.source.prepareLegacySourceRecord({
      importBatchId: batch.id,
      sourceSystem: batch.sourceSystem,
      sourceNamespace: batch.sourceNamespace,
      legacyEntityType: "COMPANY",
      legacyId: "CMP-COLLISION",
      sourceSnapshot: { id: "CMP-COLLISION", name: "Legacy Import DB Test Original" },
      supportedFields: ["id", "name"],
    });
    await K.legacy.insertLegacyImportRecord(original);

    const changed = K.source.prepareLegacySourceRecord({
      importBatchId: batch.id,
      sourceSystem: batch.sourceSystem,
      sourceNamespace: batch.sourceNamespace,
      legacyEntityType: "COMPANY",
      legacyId: "CMP-COLLISION",
      sourceSnapshot: { id: "CMP-COLLISION", name: "Legacy Import DB Test Changed" },
      supportedFields: ["id", "name"],
    });

    await assert.rejects(
      K.legacy.insertLegacyImportRecord(changed),
      /source key already exists with different source content/i,
    );
    assert.equal(await canonicalRowCount(), beforeCanonical);
  });
});
