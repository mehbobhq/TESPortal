// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// The driver-application containment endpoints, end to end through the REAL route handlers, the REAL authorization kernel
// and the REAL Clerk-subject-to-actor resolution, against a DISPOSABLE PostgreSQL migrated by the repository's own migrations
// and queried as the RUNTIME role (so row-level security applies). Only three things are stand-ins, all supplied by
// test/helpers: the Clerk session (the subject the test sets), the Cloud SQL connector (a pool to the disposable database)
// and `server-only`. Nothing else is replaced.
//
// Complements endpoint-containment.test.ts, which answers the kernel's queries from a script. This file pins the same
// 401 / 403 / 503 outcomes against real grants. It cannot reach a shared database (loopback-only guard below), sends no
// email (RESEND_API_KEY is removed and every outbound request is refused and recorded), and writes no applicant data (the
// legacy submission store is a sandboxed file whose hash must not change).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    submissions: await import("@/app/api/driver-applications/submissions/route"),
    invitation: await import("@/app/api/driver-applications/send-invitation/route"),
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

const SENTINEL = "SENTINEL-APPLICANT-PII-4f1c";
const READ_MESSAGE = "Applicant submission retrieval is temporarily unavailable while canonical application records are being established.";
const VALID_REFERENCES = { companyId: "ORG-A", driverMasterId: "DRV-1", applicationId: "APP-100", recipientEmail: "dana@driver.test" };
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]", ""]);

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("driver-application containment through the real routes (disposable PostgreSQL, runtime role)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let sandbox = "";
  let storeFile = "";
  let storeHash = "";
  let originalCwd = "";
  let realFetch: typeof fetch;
  let savedResendKey: string | undefined;
  let savedInvitationSecret: string | undefined;
  const outbound: string[] = [];

  before(async () => {
    // Defence in depth on top of scripts/test/run-auth-tests.sh: refuse any database that is not on this machine.
    for (const name of ["TES_TEST_ADMIN_DATABASE_URL", "TES_TEST_RUNTIME_DATABASE_URL"] as const) {
      const host = new URL(process.env[name] as string).hostname;
      assert.ok(LOOPBACK.has(host), `${name} must point at a loopback database, not "${host}"`);
    }

    Object.assign(K, await loadKit());
    pools = K.db.openPools();
    const server = await pools.admin.query<{ addr: string | null }>(`SELECT inet_server_addr()::text AS addr`);
    const addr = server.rows[0].addr;
    assert.ok(addr === null || /^(127\.|::1)/.test(addr), `connected to a non-loopback server (${addr})`);

    fx = new K.db.AuthFixtures(pools.admin);

    // A sandboxed copy of the legacy submission store, so any read or write of it would be visible.
    originalCwd = process.cwd();
    sandbox = mkdtempSync(path.join(tmpdir(), "tes-containment-db-"));
    mkdirSync(path.join(sandbox, ".tes-data"));
    storeFile = path.join(sandbox, ".tes-data", "driver-application-submissions.json");
    writeFileSync(
      storeFile,
      JSON.stringify({
        version: 1,
        submissions: { "APP-000102": { applicationId: "APP-000102", submittedAt: "2026-10-01T00:00:00.000Z", receiptId: "R-1", completedSteps: ["personal"], draft: { legalName: SENTINEL } } },
      }),
    );
    storeHash = sha256(storeFile);
    process.chdir(sandbox);

    // No provider key, a test-only token secret, and no network at all.
    savedResendKey = process.env.RESEND_API_KEY;
    savedInvitationSecret = process.env.TES_INVITATION_SECRET;
    delete process.env.RESEND_API_KEY;
    process.env.TES_INVITATION_SECRET = "test-only-invitation-secret";
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      outbound.push(String(input));
      throw new Error("no network in this test");
    }) as typeof fetch;
  });

  after(async () => {
    if (realFetch) globalThis.fetch = realFetch;
    if (savedResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedResendKey;
    if (savedInvitationSecret === undefined) delete process.env.TES_INVITATION_SECRET;
    else process.env.TES_INVITATION_SECRET = savedInvitationSecret;
    if (originalCwd) process.chdir(originalCwd);
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    if (K.db) {
      K.db.setClerkUser(null);
      if (fx) await fx.cleanup();
      await K.db.closePools();
    }
  });

  /** A TES staff actor holding exactly `capability` at SYSTEM scope (or no grant at all when null). */
  async function staff(capability: string | null) {
    const actor = await fx.actor();
    if (capability) {
      const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
      const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
      await fx.grant(relationshipId, capability, { assignmentId });
    }
    return actor;
  }

  const registerEvents = async () => Number((await pools.admin.query(`SELECT count(*) FROM public.master_register_events`)).rows[0].count);

  const get = async () => {
    const response = await K.submissions.GET();
    return { status: response.status, text: await response.text() };
  };
  const postInvitation = async (body: unknown) => {
    const response = await K.invitation.POST(new Request("http://localhost/api/driver-applications/send-invitation", { method: "POST", body: JSON.stringify(body) }) as never);
    return { status: response.status, text: await response.text() };
  };
  const postSubmission = async (headers: Record<string, string>) => {
    const response = await K.submissions.POST(
      new Request("http://localhost/api/driver-applications/submissions", { method: "POST", headers, body: JSON.stringify({ applicationId: "APP-000102", draft: { legalName: "x" } }) }) as never,
    );
    return { status: response.status, text: await response.text() };
  };

  describe("GET /api/driver-applications/submissions", () => {
    it("no Clerk session -> 401", async () => {
      K.db.setClerkUser(null);
      const result = await get();
      assert.equal(result.status, 401);
      assert.ok(!result.text.includes(SENTINEL));
    });

    it("signed-in identity with no TES actor -> 403", async () => {
      K.db.setClerkUser(`user_without_tes_actor_${Date.now()}`);
      const result = await get();
      assert.equal(result.status, 403);
      assert.ok(!result.text.includes(SENTINEL));
    });

    it("TES actor holding an unrelated capability -> 403", async () => {
      K.db.setClerkUser((await staff("ORGANIZATION_CREATE")).clerkSubject);
      assert.equal((await get()).status, 403);
    });

    it("TES actor with no grants at all -> 403", async () => {
      K.db.setClerkUser((await staff(null)).clerkSubject);
      assert.equal((await get()).status, 403);
    });

    it("DRIVER_MANAGE alone does not authorize reading (no capability inheritance) -> 403", async () => {
      K.db.setClerkUser((await staff("DRIVER_MANAGE")).clerkSubject);
      assert.equal((await get()).status, 403);
    });

    it("authorized DRIVER_READ actor -> the fixed 503; no applicant data; the legacy store is untouched", async () => {
      K.db.setClerkUser((await staff("DRIVER_READ")).clerkSubject);
      const result = await get();
      assert.equal(result.status, 503);
      assert.ok(!result.text.includes(SENTINEL) && !result.text.includes("APP-000102"));
      assert.deepEqual(JSON.parse(result.text), { error: READ_MESSAGE });
      assert.equal(sha256(storeFile), storeHash);
    });
  });

  describe("POST /api/driver-applications/send-invitation", () => {
    it("no Clerk session -> 401", async () => {
      K.db.setClerkUser(null);
      assert.equal((await postInvitation(VALID_REFERENCES)).status, 401);
    });

    it("signed-in identity with no TES actor -> 403", async () => {
      K.db.setClerkUser(`user_without_tes_actor_${Date.now()}`);
      assert.equal((await postInvitation(VALID_REFERENCES)).status, 403);
    });

    it("an actor with DRIVER_READ but not DRIVER_MANAGE -> 403 before the body is read; nothing audited or sent", async () => {
      K.db.setClerkUser((await staff("DRIVER_READ")).clerkSubject);
      const before = await registerEvents();
      assert.equal((await postInvitation(VALID_REFERENCES)).status, 403);
      assert.equal((await postInvitation({})).status, 403, "an empty body is refused for lack of authority, not for being empty");
      assert.equal(await registerEvents(), before);
      assert.deepEqual(outbound, []);
    });

    it("an authorized DRIVER_MANAGE actor still cannot send without authoritative records -> 503 'Nothing was sent'; no Register event; no outbound call", async () => {
      K.db.setClerkUser((await staff("DRIVER_MANAGE")).clerkSubject);
      const before = await registerEvents();
      const result = await postInvitation(VALID_REFERENCES);
      assert.equal(result.status, 503);
      const body = JSON.parse(result.text) as Record<string, unknown>;
      assert.match(String(body.error), /Nothing was sent/);
      assert.equal(body.messageId, undefined);
      assert.equal(await registerEvents(), before, "no intent event without verified records");
      assert.deepEqual(outbound, []);
    });

    it("an authorized DRIVER_MANAGE actor with an incomplete body -> 400 (authorization precedes body validation); nothing sent", async () => {
      K.db.setClerkUser((await staff("DRIVER_MANAGE")).clerkSubject);
      assert.equal((await postInvitation({})).status, 400);
      assert.deepEqual(outbound, []);
    });
  });

  describe("POST /api/driver-applications/submissions", () => {
    it("a missing, malformed or forged invitation token -> 401; the legacy store is untouched", async () => {
      K.db.setClerkUser(null);
      const attempts: Array<Record<string, string>> = [{}, { authorization: "Bearer not-a-real-token" }, { authorization: "Basic abc" }, { authorization: "Bearer a.b.c" }];
      for (const headers of attempts) {
        assert.equal((await postSubmission(headers)).status, 401);
      }
      assert.equal(sha256(storeFile), storeHash);
    });
  });

  it("across everything above: no outbound request of any kind, and the legacy submission store never changed", () => {
    assert.deepEqual(outbound, []);
    assert.equal(sha256(storeFile), storeHash);
  });
});
