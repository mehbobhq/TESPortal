// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Migration 0039 (driver prospects and application invitations), driven through the REAL authorization wrappers and the real
// Master Register. Fixtures and owner-level checks use the admin pool; the services run as the RUNTIME role under row-level security.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    svc: await import("@/lib/driver-prospects/service"),
    app: await import("@/lib/driver-prospects/applicant"),
    errors: await import("@/lib/driver-prospects/errors"),
    oi: await import("@/lib/operational-identity/service"),
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

describe("Driver prospects and application invitations (migration 0039)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
  const run = randomUUID().slice(0, 8);
  let counter = 0;
  const n = () => ++counter;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  /** Removes what a scenario created. The owner lifts the no-delete triggers of exactly these tables, inside one transaction, only here. */
  async function purge() {
    if (organizations.length === 0) return;
    // Test-only safety: trigger disabling below must never reach anything but a disposable loopback database.
    const adminUrl = process.env.TES_TEST_ADMIN_DATABASE_URL ?? "";
    assert.ok(/@(127\.0\.0\.1|localhost|\[::1\])[:/]|[?&]host=\//.test(adminUrl) || !/@/.test(adminUrl), "cleanup refuses to run against a non-loopback database");
    const tables = [
      "driver_prospect_events", "driver_application_submissions", "driver_application_invitations", "driver_prospects",
      "organization_driver_relationships", "driver_licences", "driver_profiles", "person_channels", "person_name_versions", "person_birth_dates", "persons",
    ];
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      const triggers = (
        await client.query<{ t: string; n: string }>(
          `SELECT c.relname AS t, g.tgname AS n FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'public' AND c.relname = ANY($1::text[]) AND NOT g.tgisinternal AND g.tgenabled <> 'D' AND g.tgname ~ '(no_delete|no_truncate|no_update)'`,
          [tables],
        )
      ).rows;
      for (const r of triggers) await client.query(`ALTER TABLE public.${r.t} DISABLE TRIGGER ${r.n}`);
      const people = (await client.query<{ person_id: string }>(`SELECT DISTINCT person_id FROM public.driver_prospects WHERE organization_id = ANY($1::uuid[])`, [organizations])).rows.map((r) => r.person_id);
      for (const t of ["driver_prospect_events", "driver_application_submissions", "driver_application_invitations", "driver_prospects", "organization_driver_relationships"]) {
        await client.query(`DELETE FROM public.${t} WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      }
      for (const t of ["driver_licences", "driver_profiles", "person_channels", "person_name_versions", "person_birth_dates"]) await client.query(`DELETE FROM public.${t} WHERE person_id = ANY($1::uuid[])`, [people]);
      await client.query(`DELETE FROM public.persons WHERE id = ANY($1::uuid[])`, [people]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const r of triggers) await client.query(`ALTER TABLE public.${r.t} ENABLE TRIGGER ${r.n}`);
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
      K.db.setClerkUser(null);
      try {
        await body();
      } finally {
        K.db.setClerkUser(null);
        await purge();
        await fx.cleanup();
      }
    });

  async function org(label = "Org"): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `DP ${label} ${id.slice(0, 8)}`]);
    organizations.push(id);
    return id;
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
  const FULL = ["DRIVER_MANAGE", "DRIVER_READ", "PERSON_IDENTITY_MANAGE"];
  const name = () => `Pat Prospect${n()}`;
  const email = () => `prospect${run}${n()}@example.com`;
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pools.admin.query<T>(sql, params)).rows;
  const rejects = async (work: () => Promise<unknown>, nameEndsWith: string) => {
    await assert.rejects(work, (e: Error) => {
      assert.ok(e.constructor.name.endsWith(nameEndsWith), `expected *${nameEndsWith}, got ${e.constructor.name}: ${e.message}`);
      return true;
    });
  };
  const okDelivery = (calls: string[] = []) => async (m: { link: string; to: string }) => {
    calls.push(m.link);
    return { messageId: `msg_${n()}` };
  };

  scenario("1. a prospect can be saved with a full name and an email only", async () => {
    const o = await org();
    await only(...FULL);
    const created = await K.svc.createProspect({ organizationId: o, fullName: name(), email: email() });
    assert.equal(created.status, "PROSPECT");
    const list = await K.svc.listProspects(o);
    assert.equal(list.length, 1);
    assert.equal(list[0].statusLabel, "Prospect");
    assert.equal(list[0].canInvite, true);
  });

  scenario("2. a prospect can be saved with a full name and a phone only (cannot be emailed until an email is added)", async () => {
    const o = await org();
    await only(...FULL);
    const created = await K.svc.createProspect({ organizationId: o, fullName: name(), phone: "(416) 555-0142" });
    const [row] = await K.svc.listProspects(o);
    assert.equal(row.prospectId, created.prospectId);
    assert.equal(row.canInvite, false);
    assert.ok(row.inviteBlockedReason);
    const calls: string[] = [];
    await rejects(() => K.svc.sendInvitation({ organizationId: o, prospectId: created.prospectId, baseUrl: "https://tes.test" }, okDelivery(calls)), "StateError");
    assert.equal(calls.length, 0, "nothing is sent without an email");
    await K.svc.addProspectEmail({ organizationId: o, prospectId: created.prospectId, email: email() });
    assert.equal((await K.svc.listProspects(o))[0].canInvite, true);
  });

  scenario("3. a prospect without a usable contact method is rejected (and a single word is not a full name)", async () => {
    const o = await org();
    await only(...FULL);
    await rejects(() => K.svc.createProspect({ organizationId: o, fullName: name() }), "ValidationError");
    await rejects(() => K.svc.createProspect({ organizationId: o, fullName: name(), email: "not-an-email", phone: "abc" }), "ValidationError");
    await rejects(() => K.svc.createProspect({ organizationId: o, fullName: "Cher", email: email() }), "ValidationError");
    assert.equal((await q(`SELECT 1 FROM public.driver_prospects WHERE organization_id = $1`, [o])).length, 0);
  });

  scenario("4. saving needs no date of birth, address, start date, effective dates or licence", async () => {
    const o = await org();
    await only(...FULL);
    const { personId } = await K.svc.createProspect({ organizationId: o, fullName: name(), email: email() });
    assert.equal((await q(`SELECT 1 FROM public.driver_profiles WHERE person_id = $1`, [personId])).length, 0);
    assert.equal((await q(`SELECT 1 FROM public.driver_licences WHERE person_id = $1`, [personId])).length, 0);
    assert.equal((await q(`SELECT 1 FROM public.organization_driver_relationships WHERE person_id = $1`, [personId])).length, 0);
  });

  scenario("5. a prospect is never an active or assigned company driver", async () => {
    const o = await org();
    await only(...FULL);
    const { personId } = await K.svc.createProspect({ organizationId: o, fullName: name(), email: email() });
    const roster = await (await import("@/lib/operational-identity/reads")).listOrganizationDrivers(o);
    assert.equal(roster.length, 0);
    await rejects(() => K.oi.establishOrganizationDriver({ organizationId: o, personId, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2026-01-01" } as never), "StateError");
    assert.equal((await q(`SELECT 1 FROM public.organization_driver_relationships WHERE person_id = $1`, [personId])).length, 0);
  });

  scenario("6. an authorized invitation is sent, only a hash is stored, and the status persists; a delivery failure is recorded and keeps the prospect", async () => {
    const o = await org();
    await only(...FULL);
    const { prospectId } = await K.svc.createProspect({ organizationId: o, fullName: name(), email: email() });
    const calls: string[] = [];
    const sent = await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test/" }, okDelivery(calls));
    assert.equal(sent.sent, true);
    assert.equal(calls.length, 1);
    const secret = new URL(calls[0]).searchParams.get("invitation")!;
    assert.ok(secret.length >= 40);
    const [inv] = await q<{ status: string; token_hash: string; provider_message_id: string }>(`SELECT status, token_hash, provider_message_id FROM public.driver_application_invitations WHERE prospect_id = $1`, [prospectId]);
    assert.equal(inv.status, "SENT");
    assert.notEqual(inv.token_hash, secret);
    assert.equal(inv.token_hash, K.app && (await import("@/lib/driver-prospects/operations")).hashInvitationToken(secret));
    assert.equal((await K.svc.listProspects(o))[0].status, "INVITED");

    const { prospectId: p2 } = await K.svc.createProspect({ organizationId: o, fullName: name(), email: email() });
    const failed = await K.svc.sendInvitation({ organizationId: o, prospectId: p2, baseUrl: "https://tes.test" }, async () => {
      throw new Error("provider said secret detail");
    });
    assert.equal(failed.sent, false);
    const [bad] = await q<{ status: string; delivery_error_code: string }>(`SELECT status, delivery_error_code FROM public.driver_application_invitations WHERE prospect_id = $1`, [p2]);
    assert.equal(bad.status, "FAILED");
    assert.equal(bad.delivery_error_code, "DELIVERY_FAILED");
    assert.equal((await K.svc.listProspects(o)).find((p) => p.prospectId === p2)!.status, "PROSPECT");
  });

  scenario("7. unauthorized and cross-company invitation attempts are rejected and nothing is sent", async () => {
    const a = await org("A");
    const b = await org("B");
    await only(...FULL);
    const { prospectId } = await K.svc.createProspect({ organizationId: a, fullName: name(), email: email() });
    const calls: string[] = [];
    await rejects(() => K.svc.sendInvitation({ organizationId: b, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls)), "NotFoundError");
    assert.equal(calls.length, 0);
    assert.equal((await K.svc.listProspects(b)).length, 0, "tenant isolation: company B sees no prospects of company A");

    await only("DRIVER_READ");
    await assert.rejects(() => K.svc.createProspect({ organizationId: a, fullName: name(), email: email() }));
    await assert.rejects(() => K.svc.sendInvitation({ organizationId: a, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls)));
    K.db.setClerkUser(null);
    await assert.rejects(() => K.svc.listProspects(a));
    await only();
    await assert.rejects(() => K.svc.listProspects(a));
    assert.equal(calls.length, 0);
    assert.equal((await q(`SELECT 1 FROM public.driver_application_invitations WHERE organization_id = $1`, [a])).length, 0);
  });

  scenario("8. completing the application creates no duplicate person and cannot be repeated or forged", async () => {
    const o = await org();
    await only(...FULL);
    const { prospectId, personId } = await K.svc.createProspect({ organizationId: o, fullName: name(), email: email() });
    const calls: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls));
    const secret = new URL(calls[0]).searchParams.get("invitation")!;
    const before = Number((await q<{ c: string }>(`SELECT count(*) AS c FROM public.persons`))[0].c);

    assert.equal(await K.app.openInvitation("x".repeat(43)), null, "an unknown secret opens nothing");
    const opened = await K.app.openInvitation(secret);
    assert.ok(opened);
    assert.equal(opened!.organizationId, o, "the company comes from the database record");
    assert.equal(opened!.prospectId, prospectId);

    assert.deepEqual(await K.app.submitApplication(randomUUID(), "r0", {}), { kind: "NOT_A_DATABASE_APPLICATION" });
    const saved = await K.app.submitApplication(opened!.invitationId, `rcpt_${n()}`, { draft: { note: "x" } });
    assert.equal(saved.kind, "SAVED");
    assert.equal(Number((await q<{ c: string }>(`SELECT count(*) AS c FROM public.persons`))[0].c), before, "no person created");
    assert.equal((await q(`SELECT 1 FROM public.driver_application_submissions WHERE prospect_id = $1`, [prospectId])).length, 1);
    const [row] = await K.svc.listProspects(o);
    assert.equal(row.status, "APPLICATION_SUBMITTED");
    assert.equal(row.personId, personId, "identity continuity");
    assert.equal((await K.app.submitApplication(opened!.invitationId, "again", {})).kind, "CLOSED");
    assert.equal(await K.app.openInvitation(secret), null, "a used link no longer opens");
    assert.ok((await K.svc.getProspectSubmission({ organizationId: o, prospectId })).receiptId);
    const other = await org("other");
    await rejects(() => K.svc.getProspectSubmission({ organizationId: other, prospectId }), "NotFoundError");
  });

  scenario("9. full onboarding requirements are enforced before a company driver exists, and the result is never ACTIVE", async () => {
    const o = await org();
    await only(...FULL);
    const { prospectId, personId } = await K.svc.createProspect({ organizationId: o, fullName: name(), email: email() });
    const convert = (over: Record<string, unknown> = {}) =>
      K.svc.convertProspectToCompanyDriver({
        organizationId: o, prospectId, relationshipType: "EMPLOYEE", relationshipStartDate: "2026-02-01", dateOfBirth: "1990-05-05",
        licence: { country: "CA", region: "ON", number: `D${run}${n()}`, effectiveFrom: "2020-01-01" }, ...over,
      } as never);
    await rejects(() => convert(), "StateError"); // not approved
    const calls: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls));
    const opened = await K.app.openInvitation(new URL(calls[0]).searchParams.get("invitation")!);
    await K.app.submitApplication(opened!.invitationId, "r1", { draft: {} });
    await rejects(() => K.svc.reviewProspect({ organizationId: o, prospectId, to: "APPROVED" }), "StateError"); // order enforced
    await K.svc.reviewProspect({ organizationId: o, prospectId, to: "UNDER_REVIEW" });
    await K.svc.reviewProspect({ organizationId: o, prospectId, to: "APPROVED" });
    assert.equal((await q(`SELECT 1 FROM public.organization_driver_relationships WHERE person_id = $1`, [personId])).length, 0, "approval alone assigns nothing");
    await rejects(() => convert({ dateOfBirth: "" }), "ValidationError");
    await rejects(() => convert({ relationshipStartDate: "" }), "ValidationError");
    await rejects(() => convert({ licence: { country: "CA", region: "ON", number: "", effectiveFrom: "2020-01-01" } }), "ValidationError");
    assert.equal((await q(`SELECT 1 FROM public.organization_driver_relationships WHERE person_id = $1`, [personId])).length, 0);
    const done = await convert();
    assert.equal(done.status, "ONBOARDING");
    const rel = await q<{ status: string }>(`SELECT status FROM public.organization_driver_relationships WHERE person_id = $1`, [personId]);
    assert.deepEqual(rel.map((r) => r.status), ["ONBOARDING"]);
    assert.equal((await q(`SELECT 1 FROM public.persons WHERE id = $1`, [personId])).length, 1, "same person, no duplicate");
    await rejects(() => convert(), "StateError"); // not twice
  });

  scenario("10. the Master Register records the actions, a duplicate prospect is refused, and the history is append-only", async () => {
    const o = await org();
    const actor = await only(...FULL);
    const e = email();
    const { prospectId } = await K.svc.createProspect({ organizationId: o, fullName: name(), email: e });
    await rejects(() => K.svc.createProspect({ organizationId: o, fullName: name(), email: e }), "ConflictError");
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, okDelivery());
    const ops = await q<{ op: string }>(`SELECT action->>'operation' AS op FROM public.master_register_events WHERE actor_id = $1`, [actor.actorId]);
    for (const wanted of ["DRIVER_PROSPECT_CREATE", "DRIVER_APPLICATION_INVITATION_CREATE", "DRIVER_APPLICATION_INVITATION_SEND"]) assert.ok(ops.some((r) => r.op === wanted), `Master Register records ${wanted}`);
    const events = await q<{ event_type: string }>(`SELECT event_type FROM public.driver_prospect_events WHERE prospect_id = $1 ORDER BY occurred_at, id`, [prospectId]);
    assert.ok(["PROSPECT_CREATED", "INVITATION_CREATED", "INVITATION_SENT"].every((t) => events.some((x) => x.event_type === t)));
    await assert.rejects(() => pools.admin.query(`DELETE FROM public.driver_prospect_events WHERE prospect_id = $1`, [prospectId]));
    for (const t of ["driver_prospects", "driver_application_invitations", "driver_application_submissions", "driver_prospect_events"]) {
      assert.equal((await pools.runtime.query(`SELECT 1 FROM public.${t}`)).rowCount, 0, `${t}: row-level security hides every row without an authorized system context`);
    }
  });

  scenario("11. the whole lifecycle is accounted for in the Master Register, with the same person throughout", async () => {
    const o = await org();
    const actor = await only(...FULL);
    const { prospectId, personId } = await K.svc.createProspect({ organizationId: o, fullName: name(), email: email() });
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, async () => {
      throw new Error("down");
    });
    const calls: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls));
    const opened = await K.app.openInvitation(new URL(calls[0]).searchParams.get("invitation")!);
    await K.app.submitApplication(opened!.invitationId, "r-life", { draft: {} });
    await K.svc.reviewProspect({ organizationId: o, prospectId, to: "UNDER_REVIEW" });
    await K.svc.reviewProspect({ organizationId: o, prospectId, to: "APPROVED" });
    await K.svc.convertProspectToCompanyDriver({
      organizationId: o, prospectId, relationshipType: "EMPLOYEE", relationshipStartDate: "2026-02-01", dateOfBirth: "1990-05-05",
      licence: { country: "CA", region: "ON", number: `L${run}${n()}`, effectiveFrom: "2020-01-01" },
    } as never);
    const ops = (await q<{ op: string }>(`SELECT action->>'operation' AS op FROM public.master_register_events WHERE actor_id = $1`, [actor.actorId])).map((r) => r.op);
    for (const wanted of ["DRIVER_PROSPECT_CREATE", "DRIVER_APPLICATION_INVITATION_CREATE", "DRIVER_APPLICATION_INVITATION_FAILED", "DRIVER_APPLICATION_INVITATION_SEND", "DRIVER_PROSPECT_STATUS_CHANGE", "DRIVER_PROSPECT_CONVERT"]) {
      assert.ok(ops.includes(wanted), `Master Register records ${wanted}`);
    }
    assert.ok(ops.filter((x) => x === "DRIVER_PROSPECT_STATUS_CHANGE").length >= 2);
    const rows = await q<{ person_id: string }>(`SELECT person_id FROM public.organization_driver_relationships WHERE organization_id = $1`, [o]);
    assert.deepEqual(rows.map((r) => r.person_id), [personId]);
  });

  scenario("12. cross-company review, conversion and email changes are refused; an expired invitation opens nothing; a resend revokes the old link", async () => {
    const a = await org("A");
    const b = await org("B");
    await only(...FULL);
    const { prospectId } = await K.svc.createProspect({ organizationId: a, fullName: name(), phone: "416-555-0199" });
    await rejects(() => K.svc.reviewProspect({ organizationId: b, prospectId, to: "UNDER_REVIEW" }), "NotFoundError");
    await rejects(() => K.svc.addProspectEmail({ organizationId: b, prospectId, email: email() }), "NotFoundError");
    await rejects(
      () => K.svc.convertProspectToCompanyDriver({ organizationId: b, prospectId, relationshipType: "EMPLOYEE", relationshipStartDate: "2026-02-01", dateOfBirth: "1990-05-05", licence: { country: "CA", region: "ON", number: "X1", effectiveFrom: "2020-01-01" } } as never),
      "NotFoundError",
    );
    await K.svc.addProspectEmail({ organizationId: a, prospectId, email: email() });
    const first: string[] = [];
    await K.svc.sendInvitation({ organizationId: a, prospectId, baseUrl: "https://tes.test" }, okDelivery(first));
    const second: string[] = [];
    await K.svc.sendInvitation({ organizationId: a, prospectId, baseUrl: "https://tes.test" }, okDelivery(second));
    assert.equal(await K.app.openInvitation(new URL(first[0]).searchParams.get("invitation")!), null, "the earlier link is revoked");
    assert.ok(await K.app.openInvitation(new URL(second[0]).searchParams.get("invitation")!));

    // An expired invitation (inserted by the owner with a past expiry) opens nothing and accepts no submission.
    const { createHash } = await import("node:crypto");
    const secret = `expired-${randomUUID()}-${randomUUID()}`;
    const { prospectId: p2 } = await K.svc.createProspect({ organizationId: a, fullName: name(), email: email() });
    const invitationId = randomUUID();
    await pools.admin.query(
      `INSERT INTO public.driver_application_invitations (id, prospect_id, organization_id, token_hash, recipient_email_normalized, expires_at, created_by_actor_id, status)
       VALUES ($1, $2, $3, $4, 'x@example.com', now() - interval '1 minute', (SELECT created_by_actor_id FROM public.driver_prospects WHERE id = $2), 'SENT')`,
      [invitationId, p2, a, createHash("sha256").update(secret).digest("hex")],
    );
    assert.equal(await K.app.openInvitation(secret), null);
    assert.equal((await K.app.submitApplication(invitationId, "late", {})).kind, "CLOSED");
  });
});
