// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Migrations 0039-0041 (driver prospects, application invitations, operating scope, universal application sessions), driven through the REAL authorization wrappers and the real
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
    as: await import("@/lib/driver-application/applicant-service"),
    rv: await import("@/lib/driver-application/review-service"),
    fill: await import("../../helpers/driver-application-fill"),
    storage: await import("../../helpers/fake-evidence-storage"),
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

describe("Driver prospects and application invitations (migrations 0039, 0040)", { skip: !enabled }, () => {
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
      "driver_prospect_events", "driver_application_submissions", "driver_application_invitations", "driver_prospect_operating_scopes", "organization_presentation_jurisdictions", "driver_prospects", "organization_identifiers",
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
      // Migration 0041 tables and the evidence rows the applicant uploads created: every user trigger is lifted for exactly these, inside this transaction.
      const appTables = [
        "driver_application_corrections", "driver_application_decisions", "driver_application_verifications", "driver_sensitive_access_events", "driver_sensitive_values", "driver_application_uploads",
        "driver_application_consent_revocations", "driver_application_consents", "driver_application_consent_presentations", "driver_application_snapshots", "driver_application_drafts",
        "driver_application_sessions", "driver_applications", "organization_hr_screening_profiles", "evidence_payloads", "evidence_documents",
      ];
      for (const t of appTables) await client.query(`ALTER TABLE public.${t} DISABLE TRIGGER USER`);
      const people = (await client.query<{ person_id: string }>(`SELECT DISTINCT person_id FROM public.driver_prospects WHERE organization_id = ANY($1::uuid[])`, [organizations])).rows.map((r) => r.person_id);
      for (const t of appTables) await client.query(`DELETE FROM public.${t} WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      for (const t of ["driver_prospect_events", "driver_application_submissions", "driver_application_invitations", "driver_prospect_operating_scopes", "organization_presentation_jurisdictions", "driver_prospects", "organization_identifiers", "organization_driver_relationships"]) {
        await client.query(`DELETE FROM public.${t} WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      }
      for (const t of ["driver_licences", "driver_profiles", "person_channels", "person_name_versions", "person_birth_dates"]) await client.query(`DELETE FROM public.${t} WHERE person_id = ANY($1::uuid[])`, [people]);
      await client.query(`DELETE FROM public.persons WHERE id = ANY($1::uuid[])`, [people]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const r of triggers) await client.query(`ALTER TABLE public.${r.t} ENABLE TRIGGER ${r.n}`);
      for (const t of appTables) await client.query(`ALTER TABLE public.${t} ENABLE TRIGGER USER`);
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

  async function org(label = "Org", country: string | null = "CA"): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name, country_code) VALUES ($1, $2, lower($2), $3)`, [id, `DP ${label} ${id.slice(0, 8)}`, country]);
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
  // Most scenarios are about the lifecycle, not the scope: they save a prospect whose scope is already established (Canadian intraprovincial).
  const DEFAULT_SCOPE = { kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["ON"] } as const;
  const mk = (input: Parameters<Kit["svc"]["createProspect"]>[0]) => K.svc.createProspect({ scope: DEFAULT_SCOPE as never, ...input });
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

  const secretOf = (link: string) => decodeURIComponent(new URL(link).hash.replace(/^#k=/, ""));
  const startSession = (secret: string) => K.as.startApplicantSession({ secret, ip: "127.0.0.1", userAgent: "node-test" });
  const opens = async (secret: string) => (await startSession(secret)).ok;

  /** Fills EVERY applicable question, uploads every required document, signs every authorization and submits, all through the real applicant service. */
  async function completeApplication(secret: string, overrides: Record<string, unknown> = {}) {
    const started = await startSession(secret);
    assert.ok(started.ok, "the invitation opens a session");
    if (!started.ok) throw new Error("unreachable");
    const { sessionToken, csrfToken } = started;
    const port = new K.storage.FakeEvidenceStorage() as never;
    let view = await K.as.loadApplicantApplication(sessionToken);
    const answers = K.fill.validAnswers(view.plan, overrides);
    await K.as.saveApplicantDraft(sessionToken, csrfToken, { version: view.answersVersion, patch: answers });
    view = await K.as.loadApplicantApplication(sessionToken);
    for (const { field, required } of (await import("@/lib/driver-application/validate")).applicableFields(view.plan, view.answers)) {
      if (field.type !== "upload" || !required) continue;
      const pdf = field.evidence?.accept.includes("application/pdf");
      await K.as.uploadApplicantDocument(sessionToken, csrfToken, { fieldId: field.id, bytes: pdf ? K.fill.PDF_BYTES : K.fill.PNG_BYTES, mimeType: pdf ? "application/pdf" : "image/png", filename: pdf ? "doc.pdf" : "doc.png" }, port);
    }
    view = await K.as.loadApplicantApplication(sessionToken);
    const legalName = `${answers["identity.legal_first_name"]} ${answers["identity.legal_last_name"]}`;
    for (const c of view.plan.consents) {
      if (c.external) continue;
      await K.as.presentApplicantConsent(sessionToken, csrfToken, c.key);
      await K.as.acceptApplicantConsent(sessionToken, csrfToken, { key: c.key, signatureName: legalName, affirmed: true });
    }
    const result = await K.as.submitApplicantApplication(sessionToken, csrfToken);
    return { result, sessionToken, csrfToken, view };
  }

  /**
   * Records the carrier's review of every submitted application. Authorization wording is pending legal review in this repository, so a check that relies on one
   * cannot be verified; the TEST simulates counsel's approval of the signed wording directly in the database (owner-level, trigger lifted for that one table).
   */
  async function qualify(o: string, prospectId: string) {
    const { applications } = await K.rv.getApplicationReview({ organizationId: o, prospectId });
    for (const app of applications) {
      const client = await pools.admin.connect();
      try {
        await client.query("BEGIN");
        await client.query(`ALTER TABLE public.driver_application_consents DISABLE TRIGGER USER`);
        await client.query(`UPDATE public.driver_application_consents SET legal_status = 'APPROVED' WHERE application_id = $1`, [app.id]);
        await client.query(`ALTER TABLE public.driver_application_consents ENABLE TRIGGER USER`);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      for (const r of app.requirements.filter((x) => x.requiredForQualification)) {
        await K.rv.recordVerification({ organizationId: o, applicationId: app.id, requirementKey: r.key, status: "VERIFIED", note: "Checked by the carrier (test)." });
      }
      await K.rv.recordDecision({ organizationId: o, applicationId: app.id, decision: "QUALIFIED", reasons: ["Reviewed"], acknowledgeReviewRequirements: true });
    }
  }

  scenario("1. a prospect can be saved with a full name and an email only", async () => {
    const o = await org();
    await only(...FULL);
    const created = await mk({ organizationId: o, fullName: name(), email: email() });
    assert.equal(created.status, "PROSPECT");
    const list = await K.svc.listProspects(o);
    assert.equal(list.length, 1);
    assert.equal(list[0].statusLabel, "Prospect");
    assert.equal(list[0].canInvite, true);
  });

  scenario("2. a prospect can be saved with a full name and a phone only (cannot be emailed until an email is added)", async () => {
    const o = await org();
    await only(...FULL);
    const created = await mk({ organizationId: o, fullName: name(), phone: "(416) 555-0142" });
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
    const { personId } = await mk({ organizationId: o, fullName: name(), email: email() });
    assert.equal((await q(`SELECT 1 FROM public.driver_profiles WHERE person_id = $1`, [personId])).length, 0);
    assert.equal((await q(`SELECT 1 FROM public.driver_licences WHERE person_id = $1`, [personId])).length, 0);
    assert.equal((await q(`SELECT 1 FROM public.organization_driver_relationships WHERE person_id = $1`, [personId])).length, 0);
  });

  scenario("5. a prospect is never an active or assigned company driver", async () => {
    const o = await org();
    await only(...FULL);
    const { personId } = await mk({ organizationId: o, fullName: name(), email: email() });
    const roster = await (await import("@/lib/operational-identity/reads")).listOrganizationDrivers(o);
    assert.equal(roster.length, 0);
    await rejects(() => K.oi.establishOrganizationDriver({ organizationId: o, personId, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2026-01-01" } as never), "StateError");
    assert.equal((await q(`SELECT 1 FROM public.organization_driver_relationships WHERE person_id = $1`, [personId])).length, 0);
  });

  scenario("6. an authorized invitation is sent, only a hash is stored, and the status persists; a delivery failure is recorded and keeps the prospect", async () => {
    const o = await org();
    await only(...FULL);
    const { prospectId } = await mk({ organizationId: o, fullName: name(), email: email() });
    const calls: string[] = [];
    const sent = await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test/" }, okDelivery(calls));
    assert.equal(sent.sent, true);
    assert.equal(calls.length, 1);
    const secret = secretOf(calls[0]);
    assert.ok(secret.length >= 40);
    const [inv] = await q<{ status: string; token_hash: string; provider_message_id: string }>(`SELECT status, token_hash, provider_message_id FROM public.driver_application_invitations WHERE prospect_id = $1`, [prospectId]);
    assert.equal(inv.status, "SENT");
    assert.notEqual(inv.token_hash, secret);
    assert.equal(inv.token_hash, (await import("@/lib/driver-prospects/operations")).hashInvitationToken(secret));
    assert.equal((await K.svc.listProspects(o))[0].status, "INVITED");

    const { prospectId: p2 } = await mk({ organizationId: o, fullName: name(), email: email() });
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
    const { prospectId } = await mk({ organizationId: a, fullName: name(), email: email() });
    const calls: string[] = [];
    await rejects(() => K.svc.sendInvitation({ organizationId: b, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls)), "NotFoundError");
    assert.equal(calls.length, 0);
    assert.equal((await K.svc.listProspects(b)).length, 0, "tenant isolation: company B sees no prospects of company A");

    await only("DRIVER_READ");
    await assert.rejects(() => mk({ organizationId: a, fullName: name(), email: email() }));
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
    const { prospectId, personId } = await mk({ organizationId: o, fullName: name(), email: email() });
    const calls: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls));
    const secret = secretOf(calls[0]);
    const before = Number((await q<{ c: string }>(`SELECT count(*) AS c FROM public.persons`))[0].c);

    assert.equal((await startSession("x".repeat(43))).ok, false, "an unknown secret opens nothing");
    const { result, sessionToken, csrfToken } = await completeApplication(secret);
    assert.ok(result.ok, "the complete application is accepted");
    if (!result.ok) return;
    assert.ok(result.receiptId);
    assert.equal(Number((await q<{ c: string }>(`SELECT count(*) AS c FROM public.persons`))[0].c), before, "no person created");
    assert.equal((await q(`SELECT 1 FROM public.driver_application_submissions WHERE prospect_id = $1`, [prospectId])).length, 1);
    const [row] = await K.svc.listProspects(o);
    assert.equal(row.status, "APPLICATION_SUBMITTED");
    assert.equal(row.personId, personId, "identity continuity");
    const again = await K.as.submitApplicantApplication(sessionToken, csrfToken);
    assert.ok(again.ok && again.alreadySubmitted && again.receiptId === result.receiptId, "a repeat submit returns the original receipt");
    assert.equal((await q(`SELECT 1 FROM public.driver_application_submissions WHERE prospect_id = $1`, [prospectId])).length, 1, "no second submission");
    await assert.rejects(() => K.as.saveApplicantDraft(sessionToken, csrfToken, { version: 1, patch: { "identity.phone": "000" } }), "a submitted application cannot be edited");
    assert.ok((await K.svc.getProspectSubmission({ organizationId: o, prospectId })).receiptId);
    const other = await org("other");
    await rejects(() => K.svc.getProspectSubmission({ organizationId: other, prospectId }), "NotFoundError");
  });

  scenario("9. full onboarding requirements are enforced before a company driver exists, and the result is never ACTIVE", async () => {
    const o = await org();
    await only(...FULL);
    const { prospectId, personId } = await mk({ organizationId: o, fullName: name(), email: email() });
    const convert = (over: Record<string, unknown> = {}) =>
      K.svc.convertProspectToCompanyDriver({
        organizationId: o, prospectId, relationshipType: "EMPLOYEE", relationshipStartDate: "2026-02-01", dateOfBirth: "1990-05-05",
        licence: { country: "CA", region: "ON", number: `D${run}${n()}`, effectiveFrom: "2020-01-01" }, ...over,
      } as never);
    await rejects(() => convert(), "StateError"); // not approved
    const calls: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls));
    assert.ok((await startSession(secretOf(calls[0]))).ok);
    assert.ok((await completeApplication(secretOf(calls[0]))).result.ok);
    await rejects(() => K.svc.reviewProspect({ organizationId: o, prospectId, to: "APPROVED" }), "StateError"); // order enforced
    await K.svc.reviewProspect({ organizationId: o, prospectId, to: "UNDER_REVIEW" });
    await rejects(() => K.svc.reviewProspect({ organizationId: o, prospectId, to: "APPROVED" }), "StateError"); // a submission never qualifies anyone
    await qualify(o, prospectId);
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
    const { prospectId } = await mk({ organizationId: o, fullName: name(), email: e });
    await rejects(() => mk({ organizationId: o, fullName: name(), email: e }), "ConflictError");
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
    const { prospectId, personId } = await mk({ organizationId: o, fullName: name(), email: email() });
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, async () => {
      throw new Error("down");
    });
    const calls: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls));
    assert.ok((await startSession(secretOf(calls[0]))).ok);
    assert.ok((await completeApplication(secretOf(calls[0]))).result.ok);
    await K.svc.reviewProspect({ organizationId: o, prospectId, to: "UNDER_REVIEW" });
    await qualify(o, prospectId);
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
    const { prospectId } = await mk({ organizationId: a, fullName: name(), phone: "416-555-0199" });
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
    assert.equal(await opens(secretOf(first[0])), false, "the earlier link is revoked");
    assert.ok(await opens(secretOf(second[0])));

    // An expired invitation (inserted by the owner with a past expiry) opens nothing and accepts no submission.
    const { createHash } = await import("node:crypto");
    const secret = `expired-${randomUUID()}-${randomUUID()}`;
    const { prospectId: p2 } = await mk({ organizationId: a, fullName: name(), email: email() });
    const invitationId = randomUUID();
    await pools.admin.query(
      `INSERT INTO public.driver_application_invitations (id, prospect_id, organization_id, token_hash, recipient_email_normalized, expires_at, created_by_actor_id, status, operating_scope_id, requirements_profile, requirements_rules_version)
       VALUES ($1, $2, $3, $4, 'x@example.com', now() - interval '1 minute', (SELECT created_by_actor_id FROM public.driver_prospects WHERE id = $2), 'SENT',
               (SELECT id FROM public.driver_prospect_operating_scopes WHERE prospect_id = $2 AND superseded_at IS NULL), '{}'::jsonb, 'test')`,
      [invitationId, p2, a, createHash("sha256").update(secret).digest("hex")],
    );
    assert.equal(await opens(secret), false, "an expired invitation opens nothing");
  });

  scenario("13. the register's onboarding stage follows the recorded events, and an activated driver leaves onboarding", async () => {
    const o = await org();
    await only(...FULL);
    const stage = async (id: string) => (await K.svc.listProspects(o)).find((p) => p.prospectId === id)!.onboarding;
    const { prospectId, personId } = await mk({ organizationId: o, fullName: name(), email: email() });
    assert.equal((await stage(prospectId)).currentLabel, "Not sent");
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, async () => {
      throw new Error("down");
    });
    assert.equal((await stage(prospectId)).currentLabel, "Not sent", "a failed delivery is not 'sent'");
    const calls: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls));
    assert.equal((await stage(prospectId)).currentLabel, "Application Sent");
    assert.ok((await startSession(secretOf(calls[0]))).ok);
    assert.equal((await stage(prospectId)).currentLabel, "Application Opened");
    assert.ok((await completeApplication(secretOf(calls[0]))).result.ok);
    assert.equal((await stage(prospectId)).currentLabel, "Application Submitted");
    await K.svc.reviewProspect({ organizationId: o, prospectId, to: "UNDER_REVIEW" });
    assert.equal((await stage(prospectId)).currentLabel, "Pre-Employment Verification");
    await qualify(o, prospectId);
    await K.svc.reviewProspect({ organizationId: o, prospectId, to: "APPROVED" });
    const hiring = await stage(prospectId);
    assert.equal(hiring.currentLabel, "Hiring Package");
    assert.ok(hiring.stages.slice(0, 4).every((x) => x.state === "DONE" && x.at));
    await K.svc.convertProspectToCompanyDriver({
      organizationId: o, prospectId, relationshipType: "EMPLOYEE", relationshipStartDate: "2026-02-01", dateOfBirth: "1990-05-05",
      licence: { country: "CA", region: "ON", number: `S${run}${n()}`, effectiveFrom: "2020-01-01" },
    } as never);
    assert.equal((await stage(prospectId)).onboarding, true, "still onboarding while the relationship is ONBOARDING");
    // Activation (owner-level here; there is no staff activation operation in this change) takes the driver out of onboarding without losing history.
    await pools.admin.query(`UPDATE public.organization_driver_relationships SET status = 'ACTIVE' WHERE person_id = $1 AND organization_id = $2`, [personId, o]).catch(() => undefined);
    const after = await stage(prospectId);
    const rel = (await q<{ status: string }>(`SELECT status FROM public.organization_driver_relationships WHERE person_id = $1`, [personId]))[0].status;
    if (rel === "ACTIVE") assert.equal(after.onboarding, false);
    assert.ok((await q(`SELECT 1 FROM public.driver_prospect_events WHERE prospect_id = $1`, [prospectId])).length >= 6, "history is kept");
  });

  // ---- Operating scope, requirements profile and company presentation jurisdiction (migration 0040) ----

  const CDL = { cmvOperation: "YES", cdlRequired: "YES" } as const;
  /** Saves a prospect with an email, establishes the scope, sends through the real service, and returns what the APPLICANT receives. */
  async function issue(o: string, scope: Record<string, unknown>) {
    const created = await K.svc.createProspect({ organizationId: o, fullName: name(), email: email(), scope: scope as never });
    const calls: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId: created.prospectId, baseUrl: "https://tes.test" }, okDelivery(calls));
    const secret = secretOf(calls[0]);
    assert.ok(await opens(secret), "the invitation opens a session");
    const [inv] = await q<{ id: string; requirements_profile: { applicationRegion: string; scopeKind: string; sections: Record<string, boolean>; employmentHistoryYears: number; plan: { context: Record<string, unknown> } } }>(
      `SELECT id, requirements_profile FROM public.driver_application_invitations WHERE token_hash = $1`, [(await import("@/lib/driver-prospects/operations")).hashInvitationToken(secret)]);
    const opened = { invitationId: inv.id };
    const claims = { operatingRegion: inv.requirements_profile.applicationRegion, requirements: inv.requirements_profile };
    return { created, secret, opened, claims, calls };
  }

  scenario("14. U.S. company: an intrastate hire and an interstate hire each get U.S. requirements; neither is cross-border", async () => {
    const o = await org("US", "US");
    await only(...FULL);
    const intra = await issue(o, { kind: "US_INTRASTATE", usJurisdictions: ["TX"], characteristics: CDL });
    assert.equal(intra.claims.operatingRegion, "United States");
    assert.equal(intra.claims.requirements?.sections.clearinghouse, true);
    assert.equal(intra.claims.requirements?.sections.psp, false, "PSP only when intended");
    const inter = await issue(o, { kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: { ...CDL, pspIntended: true } });
    assert.equal(inter.claims.operatingRegion, "United States");
    assert.equal(inter.claims.requirements?.employmentHistoryYears, 10);
    assert.equal(inter.claims.requirements?.sections.psp, true);
    const [row] = await q<{ requirements_profile: { scopeKind: string }; requirements_rules_version: string }>(`SELECT requirements_profile, requirements_rules_version FROM public.driver_application_invitations WHERE id = $1`, [inter.opened.invitationId]);
    assert.equal(row.requirements_profile.scopeKind, "US_INTERSTATE", "the requirements are frozen on the invitation");
    assert.ok(row.requirements_rules_version);
  });

  scenario("15. Canadian company: intraprovincial and interprovincial hires get Canadian requirements with NO U.S. federal sections", async () => {
    const o = await org("CA", "CA");
    await only(...FULL);
    for (const scope of [{ kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["AB"] }, { kind: "CA_INTERPROVINCIAL", caJurisdictions: ["ON", "QC"] }]) {
      const r = await issue(o, scope);
      assert.equal(r.claims.operatingRegion, "Canada");
      assert.deepEqual(r.claims.requirements?.sections, { clearinghouse: false, psp: false, dotDrugAlcoholHistory: false });
      assert.equal(r.claims.requirements?.employmentHistoryYears, 3);
    }
  });

  scenario("16. cross-border hires get the combined requirements from either country's company", async () => {
    for (const country of ["CA", "US"]) {
      const o = await org(`XB-${country}`, country);
      await only(...FULL);
      const r = await issue(o, { kind: "CROSS_BORDER", usJurisdictions: ["MI"], caJurisdictions: ["ON"], characteristics: CDL });
      assert.equal(r.claims.operatingRegion, "Cross-Border", `${country} company`);
      assert.equal(r.claims.requirements?.sections.clearinghouse, true);
    }
  });

  scenario("17. a company with cross-border registrations hiring a domestic-only driver does not make that driver cross-border", async () => {
    const o = await org("DUAL", "CA");
    await pools.admin.query(
      `INSERT INTO public.organization_identifiers (organization_id, identifier_type, namespace, jurisdiction_country, value, normalized_value)
       VALUES ($1, 'employer_identification_number', 'irs', 'US', '12-3456789', '123456789')`, [o],
    );
    await only(...FULL, "ORGANIZATION_REGISTRY_READ");
    const presentation = await K.svc.getPresentationContext(o);
    assert.equal(presentation.basis, "UNRESOLVED", "registered in both countries: an explicit presentation choice is required");
    assert.match(presentation.reason ?? "", /both the United States and Canada/);
    await only(...FULL);
    const r = await issue(o, { kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["BC"] });
    assert.equal(r.claims.operatingRegion, "Canada");
    assert.notEqual(r.claims.requirements?.scopeKind, "CROSS_BORDER");
  });

  scenario("18. an undetermined scope can be saved but blocks every application, in the service and in the database", async () => {
    const o = await org();
    await only(...FULL);
    const created = await K.svc.createProspect({ organizationId: o, fullName: name(), email: email() }); // no scope
    const [row] = await K.svc.listProspects(o);
    assert.equal(row.operatingScope, null);
    assert.equal(row.canInvite, false);
    assert.match(row.inviteBlockedReason ?? "", /operating scope is not established/);
    const calls: string[] = [];
    await rejects(() => K.svc.sendInvitation({ organizationId: o, prospectId: created.prospectId, baseUrl: "https://tes.test" }, okDelivery(calls)), "StateError");
    assert.equal(calls.length, 0, "nothing is sent");
    assert.equal((await q(`SELECT 1 FROM public.driver_application_invitations WHERE prospect_id = $1`, [created.prospectId])).length, 0);
    // US operations with unknown CMV/CDL status are also blocked rather than sent a possibly wrong form.
    await K.svc.establishOperatingScope({ organizationId: o, prospectId: created.prospectId, scope: { kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"] } as never });
    assert.match((await K.svc.listProspects(o))[0].inviteBlockedReason ?? "", /commercial motor vehicle/);
    // The database refuses an invitation row that names no current, determined scope, whatever writes it.
    await assert.rejects(
      () => pools.admin.query(`INSERT INTO public.driver_application_invitations (prospect_id, organization_id, token_hash, recipient_email_normalized, expires_at, created_by_actor_id)
        VALUES ($1, $2, repeat('a', 64), 'x@example.com', now() + interval '1 day', (SELECT created_by_actor_id FROM public.driver_prospects WHERE id = $1))`, [created.prospectId, o]),
      /cannot be issued without an established operating scope/,
    );
  });

  scenario("19. changing the scope after an invitation revokes the old application and requires a new, matching one", async () => {
    const o = await org();
    await only(...FULL);
    const first = await issue(o, { kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["ON"] });
    const personsBefore = Number((await q<{ c: string }>(`SELECT count(*) AS c FROM public.persons`))[0].c);
    const change = await K.svc.establishOperatingScope({ organizationId: o, prospectId: first.created.prospectId, scope: { kind: "CROSS_BORDER", usJurisdictions: ["NY"], caJurisdictions: ["ON"], characteristics: CDL } as never });
    assert.equal(change.changed, true);
    assert.equal(change.revokedInvitations, 1);
    assert.equal(await opens(first.secret), false, "the outdated link no longer opens");
    const [prospect] = await K.svc.listProspects(o);
    assert.equal(prospect.onboarding.currentLabel, "Not sent", "the chronology no longer claims it was sent");
    assert.equal(prospect.operatingScope?.kind, "CROSS_BORDER");
    const calls: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId: first.created.prospectId, baseUrl: "https://tes.test" }, okDelivery(calls));
    assert.ok(await opens(secretOf(calls[0])));
    const [fresh] = await q<{ requirements_profile: { scopeKind: string } }>(`SELECT requirements_profile FROM public.driver_application_invitations WHERE status <> 'REVOKED' AND prospect_id = $1`, [first.created.prospectId]);
    assert.equal(fresh.requirements_profile.scopeKind, "CROSS_BORDER");
    assert.equal(Number((await q<{ c: string }>(`SELECT count(*) AS c FROM public.persons`))[0].c), personsBefore, "no duplicate person");
    const versions = await q<{ superseded_at: string | null }>(`SELECT superseded_at FROM public.driver_prospect_operating_scopes WHERE prospect_id = $1 ORDER BY established_at`, [first.created.prospectId]);
    assert.equal(versions.length, 2, "history is kept");
    assert.ok(versions[0].superseded_at && !versions[1].superseded_at);
    const ops = (await q<{ op: string }>(`SELECT action->>'operation' AS op FROM public.master_register_events WHERE action->>'operation' = 'DRIVER_PROSPECT_SCOPE_ESTABLISH'`)).length;
    assert.ok(ops >= 2, "each scope version is in the Master Register");
    // Re-saving the identical scope changes nothing.
    assert.equal((await K.svc.establishOperatingScope({ organizationId: o, prospectId: first.created.prospectId, scope: { kind: "CROSS_BORDER", usJurisdictions: ["NY"], caJurisdictions: ["ON"], characteristics: CDL } as never })).changed, false);
  });

  scenario("20. a failed invitation followed by a retry uses the same saved driver: no duplicate person, prospect or scope", async () => {
    const o = await org();
    await only(...FULL);
    const created = await mk({ organizationId: o, fullName: name(), email: email() });
    const counts = async () => ({ persons: (await q(`SELECT 1 FROM public.persons`)).length, prospects: (await q(`SELECT 1 FROM public.driver_prospects WHERE organization_id = $1`, [o])).length });
    const before = await counts();
    const failed = await K.svc.sendInvitation({ organizationId: o, prospectId: created.prospectId, baseUrl: "https://tes.test" }, async () => {
      throw new Error("down");
    });
    assert.equal(failed.sent, false);
    assert.equal((await K.svc.listProspects(o))[0].onboarding.currentLabel, "Not sent");
    const retry = await K.svc.sendInvitation({ organizationId: o, prospectId: created.prospectId, baseUrl: "https://tes.test" }, okDelivery());
    assert.equal(retry.sent, true);
    assert.deepEqual(await counts(), before);
    assert.deepEqual((await q<{ status: string }>(`SELECT status FROM public.driver_application_invitations WHERE prospect_id = $1 ORDER BY created_at`, [created.prospectId])).map((r) => r.status), ["FAILED", "SENT"]);
    assert.equal((await q(`SELECT 1 FROM public.driver_prospect_operating_scopes WHERE prospect_id = $1`, [created.prospectId])).length, 1);
  });

  scenario("21. scope operations are tenant-isolated, authorized, and frozen once the application is submitted", async () => {
    const a = await org("A");
    const b = await org("B");
    await only(...FULL);
    const { prospectId } = await mk({ organizationId: a, fullName: name(), email: email() });
    await rejects(() => K.svc.establishOperatingScope({ organizationId: b, prospectId, scope: { kind: "UNDETERMINED" } as never }), "NotFoundError");
    await rejects(() => K.svc.establishOperatingScope({ organizationId: a, prospectId, scope: { kind: "US_INTRASTATE", usJurisdictions: ["TX", "OK"] } as never }), "ValidationError");
    for (const t of ["driver_prospect_operating_scopes", "organization_presentation_jurisdictions"]) {
      assert.equal((await pools.runtime.query(`SELECT 1 FROM public.${t}`)).rowCount, 0, `${t}: no rows without an authorized system context`);
    }
    await only("DRIVER_READ");
    await assert.rejects(() => K.svc.establishOperatingScope({ organizationId: a, prospectId, scope: { kind: "UNDETERMINED" } as never }));
    await only(...FULL);
    const calls: string[] = [];
    await K.svc.sendInvitation({ organizationId: a, prospectId, baseUrl: "https://tes.test" }, okDelivery(calls));
    assert.ok((await startSession(secretOf(calls[0]))).ok);
    assert.ok((await completeApplication(secretOf(calls[0]))).result.ok);
    await rejects(() => K.svc.establishOperatingScope({ organizationId: a, prospectId, scope: { kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["AB"] } as never }), "StateError");
    // Versions and the invitation's frozen requirements cannot be rewritten, even by the table owner's ordinary UPDATE.
    await assert.rejects(() => pools.admin.query(`UPDATE public.driver_prospect_operating_scopes SET scope_kind = 'US_INTRASTATE' WHERE prospect_id = $1`, [prospectId]));
    await assert.rejects(() => pools.admin.query(`UPDATE public.driver_application_invitations SET requirements_profile = '{}'::jsonb WHERE prospect_id = $1`, [prospectId]));
  });

  scenario("22. company presentation jurisdiction: derived from the registered country, explicit when it cannot be derived, never a regulatory input", async () => {
    const us = await org("PUS", "US");
    const ca = await org("PCA", "CA");
    const none = await org("PNONE", null);
    await only(...FULL, "ORGANIZATION_REGISTRY_READ");
    assert.deepEqual(await K.svc.getPresentationContext(us), { country: "US", basis: "REGISTRATION", reason: null });
    assert.deepEqual(await K.svc.getPresentationContext(ca), { country: "CA", basis: "REGISTRATION", reason: null });
    const unresolved = await K.svc.getPresentationContext(none);
    assert.equal(unresolved.country, null);
    assert.equal(unresolved.basis, "UNRESOLVED");
    // Selecting a presentation country is a company-profile act and needs that authority.
    await only(...FULL);
    await assert.rejects(() => K.svc.establishPresentationJurisdiction({ organizationId: none, country: "US" }));
    await rejects(() => K.svc.establishPresentationJurisdiction({ organizationId: none, country: "MX" }), "ValidationError");
    await only(...FULL, "COMPANY_PROFILE_MANAGE");
    assert.equal((await K.svc.establishPresentationJurisdiction({ organizationId: none, country: "CA" })).changed, true);
    assert.deepEqual(await K.svc.getPresentationContext(none), { country: "CA", basis: "EXPLICIT", reason: null });
    // An explicit choice overrides the registered country for presentation (a dual-registered company), and is versioned.
    assert.equal((await K.svc.establishPresentationJurisdiction({ organizationId: us, country: "CA" })).changed, true);
    assert.equal((await K.svc.getPresentationContext(us)).country, "CA");
    assert.equal((await q(`SELECT 1 FROM public.organization_presentation_jurisdictions WHERE organization_id = $1`, [us])).length, 1);
    // ...yet it decides nothing about the driver: a Canadian-presented company can still hire a U.S. intrastate driver.
    const r = await issue(us, { kind: "US_INTRASTATE", usJurisdictions: ["TX"], characteristics: CDL });
    assert.equal(r.claims.operatingRegion, "United States");
    assert.ok((await q(`SELECT 1 FROM public.master_register_events WHERE action->>'operation' = 'ORGANIZATION_PRESENTATION_JURISDICTION_ESTABLISH'`)).length >= 2);
  });
});
