// Migration 0041: employer review, verification and qualification. Run with `npm run test:auth` or against a disposable database via the TES_TEST_* URLs.
// The applicant has NO database identity: the service reaches PostgreSQL as the RUNTIME role and only through definer functions bound to a session.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    svc: await import("@/lib/driver-prospects/service"),
    ops: await import("@/lib/driver-prospects/operations"),
    as: await import("@/lib/driver-application/applicant-service"),
    ctx: await import("@/lib/auth/tes-applicant-context"),
    fill: await import("../../helpers/driver-application-fill"),
    storage: await import("../../helpers/fake-evidence-storage"),
    validate: await import("@/lib/driver-application/validate"),
    rv: await import("@/lib/driver-application/review-service"),
    rops: await import("@/lib/driver-application/review"),
  };
}
type Kit = Awaited<ReturnType<typeof loadKit>>;
const K = {} as Kit;

const enabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
if (!enabled && process.env.TES_REQUIRE_DB_TESTS === "1") {
  it("requires a disposable test database (TES_REQUIRE_DB_TESTS=1)", () => assert.fail("TES_TEST_ADMIN_DATABASE_URL and TES_TEST_RUNTIME_DATABASE_URL must be set"));
}

const APP_TABLES = [
  "driver_application_corrections", "driver_application_decisions", "driver_application_verifications", "driver_sensitive_access_events", "driver_sensitive_values", "driver_application_uploads",
  "driver_application_consent_revocations", "driver_application_consents", "driver_application_consent_presentations", "driver_application_snapshots", "driver_application_drafts",
  "driver_application_sessions", "driver_applications", "organization_hr_screening_profiles",
];

describe("Universal driver application: employer review (migration 0041)", { skip: !enabled }, () => {
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

  async function purge() {
    if (organizations.length === 0) return;
    const adminUrl = process.env.TES_TEST_ADMIN_DATABASE_URL ?? "";
    assert.ok(/@(127\.0\.0\.1|localhost|\[::1\])[:/]|[?&]host=\//.test(adminUrl) || !/@/.test(adminUrl), "cleanup refuses to run against a non-loopback database");
    const tables = ["driver_prospect_events", "driver_application_submissions", "driver_application_invitations", "driver_prospect_operating_scopes", "organization_presentation_jurisdictions", "driver_prospects", "organization_driver_relationships", "person_channels", "person_name_versions", "persons"];
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      const all = [...tables, ...APP_TABLES, "evidence_payloads", "evidence_documents"];
      for (const t of all) await client.query(`ALTER TABLE public.${t} DISABLE TRIGGER USER`);
      const people = (await client.query<{ person_id: string }>(`SELECT DISTINCT person_id FROM public.driver_prospects WHERE organization_id = ANY($1::uuid[])`, [organizations])).rows.map((r) => r.person_id);
      for (const t of [...APP_TABLES, "evidence_payloads", "evidence_documents", "driver_prospect_events", "driver_application_submissions", "driver_application_invitations", "driver_prospect_operating_scopes", "organization_presentation_jurisdictions", "driver_prospects", "organization_driver_relationships"]) {
        await client.query(`DELETE FROM public.${t} WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      }
      for (const t of ["person_channels", "person_name_versions"]) await client.query(`DELETE FROM public.${t} WHERE person_id = ANY($1::uuid[])`, [people]);
      await client.query(`DELETE FROM public.persons WHERE id = ANY($1::uuid[])`, [people]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const t of all) await client.query(`ALTER TABLE public.${t} ENABLE TRIGGER USER`);
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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name, country_code) VALUES ($1, $2, lower($2), $3)`, [id, `AP ${label} ${id.slice(0, 8)}`, country]);
    organizations.push(id);
    return id;
  }
  async function asStaff(...capabilities: string[]) {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
    return actor;
  }
  const FULL = ["DRIVER_MANAGE", "DRIVER_READ", "PERSON_IDENTITY_MANAGE"];
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pools.admin.query<T>(sql, params)).rows;
  const secretOf = (link: string) => decodeURIComponent(new URL(link).hash.replace(/^#k=/, ""));

  /** A saved prospect with an issued application (Canadian intraprovincial unless stated) and an open applicant session. */
  async function applicant(o: string, scope: Record<string, unknown> = { kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["ON"] }) {
    const created = await K.svc.createProspect({ organizationId: o, fullName: `Alex Applicant${n()}`, email: `ap${run}${n()}@example.com`, scope: scope as never });
    const links: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId: created.prospectId, baseUrl: "https://tes.test" }, async (m: { link: string }) => {
      links.push(m.link);
      return { messageId: `m${n()}` };
    });
    const secret = secretOf(links[0]);
    const started = await K.as.startApplicantSession({ secret, ip: `10.0.${n() % 250}.1`, userAgent: "node-test" });
    assert.ok(started.ok);
    if (!started.ok) throw new Error("unreachable");
    return { ...created, secret, sessionToken: started.sessionToken, csrfToken: started.csrfToken };
  }
  /** Either no rows or a permission error: both mean "no direct access". */
  const noAccess = async (work: () => Promise<{ rowCount: number | null }>, message: string) => {
    try {
      assert.equal((await work()).rowCount, 0, message);
    } catch (error) {
      assert.match((error as Error).message, /permission denied|row-level security/, message);
    }
  };
  const rejectsWith = async (work: () => Promise<unknown>, status: number) => {
    await assert.rejects(work, (e: { status?: number }) => {
      assert.equal(e.status, status);
      return true;
    });
  };
  /** The SQL a hostile or buggy code path would run, as the runtime role, inside an applicant context. */
  async function asRuntimeInContext(sessionToken: string, sql: string, params: unknown[] = []) {
    const client = await pools.runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT * FROM tes_security.enter_applicant_context($1)`, [K.ctx.sha256Hex(sessionToken)]);
      const r = await client.query(sql, params);
      await client.query("ROLLBACK");
      return r;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }


  /** Fill, upload, sign and submit through the real applicant service. */
  async function submitFor(o: string, scope: Record<string, unknown> = { kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["ON"] }, stage?: string, supplements?: string) {
    const created = await K.svc.createProspect({ organizationId: o, fullName: `Riley Reviewer${n()}`, email: `rv${run}${n()}@example.com`, scope: scope as never });
    return { ...created, ...(await sendAndSubmit(o, created.prospectId, stage, supplements)) };
  }
  async function sendAndSubmit(o: string, prospectId: string, stage?: string, supplements?: string) {
    const links: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId, baseUrl: "https://tes.test", stage: stage as never, supplementsApplicationId: supplements }, async (m: { link: string }) => {
      links.push(m.link);
      return { messageId: `m${n()}` };
    });
    const started = await K.as.startApplicantSession({ secret: secretOf(links[0]), ip: `10.1.${n() % 250}.1`, userAgent: "node-test" });
    assert.ok(started.ok);
    if (!started.ok) throw new Error("unreachable");
    const { sessionToken, csrfToken } = started;
    const port = new K.storage.FakeEvidenceStorage();
    let view = await K.as.loadApplicantApplication(sessionToken);
    const inPlan = (id: string) => view.plan.fields.some((f) => f.id === id);
    const answers = K.fill.validAnswers(view.plan, { ...(inPlan("identity.legal_first_name") ? { "identity.legal_first_name": "Riley", "identity.legal_last_name": `Reviewer${n()}` } : {}) });
    await K.as.saveApplicantDraft(sessionToken, csrfToken, { version: view.answersVersion, patch: answers });
    view = await K.as.loadApplicantApplication(sessionToken);
    for (const { field, required } of K.validate.applicableFields(view.plan, view.answers)) {
      if (field.type === "upload" && required) {
        const pdf = field.evidence!.accept.includes("application/pdf");
        await K.as.uploadApplicantDocument(sessionToken, csrfToken, { fieldId: field.id, bytes: pdf ? K.fill.PDF_BYTES : K.fill.PNG_BYTES, mimeType: pdf ? "application/pdf" : "image/png", filename: pdf ? "d.pdf" : "d.png" }, port as never);
      }
    }
    view = await K.as.loadApplicantApplication(sessionToken);
    const name = inPlan("identity.legal_first_name") ? `${answers["identity.legal_first_name"]} ${answers["identity.legal_last_name"]}` : view.applicantName;
    for (const c of view.plan.consents.filter((x) => !x.external)) {
      await K.as.presentApplicantConsent(sessionToken, csrfToken, c.key);
      await K.as.acceptApplicantConsent(sessionToken, csrfToken, { key: c.key, signatureName: name, affirmed: true });
    }
    const result = await K.as.submitApplicantApplication(sessionToken, csrfToken);
    assert.ok(result.ok, JSON.stringify(result));
    await K.as.ensureApplicationPdf(sessionToken, port as never);
    return { sessionToken, csrfToken, applicationId: view.application.id, answers };
  }
  /** TEST ONLY: simulates counsel's approval of the signed wording (owner-level update with the immutability trigger lifted for that one table). */
  async function simulateCounselApproval(applicationId: string) {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      await client.query(`ALTER TABLE public.driver_application_consents DISABLE TRIGGER USER`);
      await client.query(`UPDATE public.driver_application_consents SET legal_status = 'APPROVED' WHERE application_id = $1`, [applicationId]);
      await client.query(`ALTER TABLE public.driver_application_consents ENABLE TRIGGER USER`);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  }
  const review = async (o: string, prospectId: string) => (await K.rv.getApplicationReview({ organizationId: o, prospectId })).applications;

  scenario("a submission is applicant-declared: nothing is verified or qualified, and approval is blocked until a Qualified decision exists", async () => {
    const o = await org();
    await asStaff(...FULL);
    const s = await submitFor(o);
    const [app] = await review(o, s.prospectId);
    assert.equal(app.status, "SUBMITTED");
    assert.equal(app.decisions.length, 0);
    assert.ok(app.requirements.length > 0 && app.requirements.every((r) => r.current === null), "no requirement is verified by the act of submitting");
    assert.equal(app.canQualify, false);
    assert.ok(app.snapshot && app.snapshotIntact && app.snapshot.fields.every((f) => f.status === "APPLICANT_DECLARED"));
    assert.ok(app.pdf, "the signed PDF is attached");
    await K.svc.reviewProspect({ organizationId: o, prospectId: s.prospectId, to: "UNDER_REVIEW" });
    await assert.rejects(() => K.svc.reviewProspect({ organizationId: o, prospectId: s.prospectId, to: "APPROVED" }), (e: Error) => e.constructor.name.endsWith("StateError"));
    await assert.rejects(() => K.rv.recordDecision({ organizationId: o, applicationId: app.id, decision: "QUALIFIED", reasons: ["x"], acknowledgeReviewRequirements: true }), (e: Error) => e.constructor.name.endsWith("StateError"));
    assert.equal((await q(`SELECT 1 FROM public.driver_application_decisions`)).length, 0);
  });

  scenario("verification: needs support, cannot rely on an authorization that is pending legal review, and the exception path is recorded and attributed", async () => {
    const o = await org();
    const staff = await asStaff(...FULL);
    const s = await submitFor(o);
    const [app] = await review(o, s.prospectId);
    const plain = app.requirements.find((r) => !r.consentKey && r.requiredForQualification)!;
    const relies = app.requirements.find((r) => r.consentKey)!;
    assert.ok(plain && relies);
    assert.equal(relies.consent?.relianceAllowed, false);
    assert.match(relies.consent?.reason ?? "", /pending legal review/);
    const bad = (input: Record<string, unknown>) => K.rv.recordVerification({ organizationId: o, applicationId: app.id, requirementKey: plain.key, status: "VERIFIED", ...input });
    await assert.rejects(() => bad({}), (e: Error) => e.constructor.name.endsWith("ValidationError")); // verified with no support
    await assert.rejects(() => bad({ status: "MAYBE", note: "x" }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    await assert.rejects(() => bad({ requirementKey: "not_a_requirement", note: "x" }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    await bad({ status: "EVIDENCE_RECEIVED" });
    await bad({ status: "VERIFIED", note: "Checked the original licence in person." });
    // Reliance block.
    await assert.rejects(() => K.rv.recordVerification({ organizationId: o, applicationId: app.id, requirementKey: relies.key, status: "VERIFIED", note: "Done" }), (e: Error) => e.constructor.name.endsWith("StateError"));
    const exc = await K.rv.recordVerification({ organizationId: o, applicationId: app.id, requirementKey: relies.key, status: "EXCEPTION", note: "Proceeding on a different lawful basis: counsel memo 12." });
    assert.equal(exc.status, "EXCEPTION");
    const [after] = await review(o, s.prospectId);
    const hist = after.requirements.find((r) => r.key === plain.key)!.history.map((h) => h.status);
    assert.deepEqual(hist, ["EVIDENCE_RECEIVED", "VERIFIED"], "history is kept, latest wins");
    const [row] = await q<{ recorded_by_actor_id: string }>(`SELECT recorded_by_actor_id FROM public.driver_application_verifications WHERE id = $1`, [exc.verificationId]);
    assert.equal(row.recorded_by_actor_id, staff.actorId, "each outcome is attributed to the person who recorded it");
    assert.ok((await q(`SELECT 1 FROM public.master_register_events WHERE action->>'operation' = 'DRIVER_APPLICATION_VERIFICATION_RECORD' AND actor_id = $1`, [staff.actorId])).length >= 2);
    await assert.rejects(() => pools.admin.query(`UPDATE public.driver_application_verifications SET status = 'VERIFIED' WHERE id = $1`, [exc.verificationId]));
    await assert.rejects(() => pools.admin.query(`DELETE FROM public.driver_application_verifications WHERE id = $1`, [exc.verificationId]));
  });

  scenario("qualification: an exception NEVER satisfies a required check; Qualified needs every required check verified on usable authorizations; then approval is allowed", async () => {
    const o = await org();
    await asStaff(...FULL);
    const s = await submitFor(o);
    const [app] = await review(o, s.prospectId);
    const decide = (over: Record<string, unknown> = {}) => K.rv.recordDecision({ organizationId: o, applicationId: app.id, decision: "QUALIFIED", reasons: ["Reviewed"], acknowledgeReviewRequirements: true, ...over });
    const stateError = (e: Error) => e.constructor.name.endsWith("StateError");
    const required = app.requirements.filter((x) => x.requiredForQualification);
    // 1. Authorization wording is pending legal review: the dependent checks cannot be verified, and recording an exception does not get around that.
    for (const r of required) {
      if (r.consentKey) {
        await assert.rejects(() => K.rv.recordVerification({ organizationId: o, applicationId: app.id, requirementKey: r.key, status: "VERIFIED", note: "x" }), stateError);
        await K.rv.recordVerification({ organizationId: o, applicationId: app.id, requirementKey: r.key, status: "EXCEPTION", note: "Proceeding on another basis." });
      } else {
        await K.rv.recordVerification({ organizationId: o, applicationId: app.id, requirementKey: r.key, status: "VERIFIED", note: "Reviewed." });
      }
    }
    await assert.rejects(() => decide(), (e: Error) => stateError(e) && /exception does not satisfy/.test(e.message));
    assert.equal((await q(`SELECT 1 FROM public.driver_application_decisions`)).length, 0);
    await assert.rejects(() => K.svc.reviewProspect({ organizationId: o, prospectId: s.prospectId, to: "APPROVED" }), stateError);
    // 2. Counsel approves the wording (simulated); the checks can now be verified.
    await simulateCounselApproval(app.id);
    await assert.rejects(() => decide(), stateError, "exceptions are still not verification");
    for (const r of required.filter((x) => x.consentKey)) await K.rv.recordVerification({ organizationId: o, applicationId: app.id, requirementKey: r.key, status: "VERIFIED", note: "Verified after approval." });
    await assert.rejects(() => decide({ acknowledgeReviewRequirements: false }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    await assert.rejects(() => decide({ decision: "NOT_QUALIFIED", reasons: [] }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    const ok = await decide();
    assert.equal(ok.decision, "QUALIFIED");
    const [d] = await q<{ snapshot_sha256: string }>(`SELECT snapshot_sha256 FROM public.driver_application_decisions WHERE id = $1`, [ok.decisionId]);
    assert.equal(d.snapshot_sha256, app.snapshotSha256, "the decision is bound to the exact application it was made on");
    await K.svc.reviewProspect({ organizationId: o, prospectId: s.prospectId, to: "UNDER_REVIEW" });
    assert.equal((await K.svc.reviewProspect({ organizationId: o, prospectId: s.prospectId, to: "APPROVED" })).status, "APPROVED");
    await K.rv.recordDecision({ organizationId: o, applicationId: app.id, decision: "NOT_QUALIFIED", reasons: ["New information"] });
    assert.equal((await review(o, s.prospectId))[0].decisions.length, 2);
  });

  scenario("revoking an authorization after verification blocks qualification again", async () => {
    const o = await org();
    await asStaff(...FULL);
    const s = await submitFor(o);
    const [app] = await review(o, s.prospectId);
    await simulateCounselApproval(app.id);
    for (const r of app.requirements.filter((x) => x.requiredForQualification)) await K.rv.recordVerification({ organizationId: o, applicationId: app.id, requirementKey: r.key, status: "VERIFIED", note: "ok" });
    const consent = app.consents.find((c) => app.requirements.some((r) => r.consentKey === c.key && r.requiredForQualification))!;
    const admin = await pools.admin.connect();
    try {
      await admin.query(`INSERT INTO public.driver_application_consent_revocations (application_id, organization_id, consent_id, revoked_by_actor_id, reason) SELECT $1, $2, $3, applicant_actor_id, 'applicant withdrew' FROM public.driver_applications WHERE id = $1`, [app.id, o, consent.id]);
    } finally {
      admin.release();
    }
    await assert.rejects(() => K.rv.recordDecision({ organizationId: o, applicationId: app.id, decision: "QUALIFIED", reasons: ["x"], acknowledgeReviewRequirements: true }), (e: Error) => e.constructor.name.endsWith("StateError") && /revoked/.test(e.message));
  });

  scenario("corrections and supplements never alter the signed application; they are separate, traceable records", async () => {
    const o = await org();
    const staff = await asStaff(...FULL);
    const s = await submitFor(o);
    const [app] = await review(o, s.prospectId);
    const before = JSON.stringify(app.snapshot);
    const beforeHash = app.snapshotSha256;
    const c = await K.rv.recordCorrection({ organizationId: o, applicationId: app.id, fieldId: "identity.phone", correctedValue: "416-555-0000", reason: "Applicant phoned with a new number." });
    assert.ok(c.correctionId);
    await assert.rejects(() => K.rv.recordCorrection({ organizationId: o, applicationId: app.id, fieldId: "eligibility.ssn", correctedValue: "x", reason: "no" }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    await assert.rejects(() => K.rv.recordCorrection({ organizationId: o, applicationId: app.id, fieldId: "identity.phone", correctedValue: "x", reason: "" }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    const [after] = await review(o, s.prospectId);
    assert.equal(JSON.stringify(after.snapshot), before, "the signed application is unchanged");
    assert.equal(after.snapshotSha256, beforeHash);
    assert.equal(after.corrections.length, 1);
    assert.equal(after.corrections[0].previousValue, app.snapshot!.fields.find((f) => f.id === "identity.phone")!.value);
    assert.equal(after.corrections[0].recordedByActorId, staff.actorId);
    // A conditional-stage supplement is a NEW application that references the original.
    await K.svc.reviewProspect({ organizationId: o, prospectId: s.prospectId, to: "UNDER_REVIEW" });
    const sup = await sendAndSubmit(o, s.prospectId, "CONDITIONAL_OFFER", app.id);
    const all = await review(o, s.prospectId);
    assert.equal(all.length, 2);
    const second = all.find((x) => x.id === sup.applicationId)!;
    assert.equal(second.supplementsApplicationId, app.id);
    assert.equal(second.stage, "CONDITIONAL_OFFER");
    assert.equal(all.find((x) => x.id === app.id)!.snapshotSha256, beforeHash, "the original is untouched by the supplement");
    assert.equal((await K.svc.listProspects(o)).find((p) => p.prospectId === s.prospectId)!.status, "UNDER_REVIEW", "a supplement does not move the prospect backwards");
    await assert.rejects(() => K.rv.recordCorrection({ organizationId: o, applicationId: app.id, fieldId: "identity.phone", correctedValue: "x", reason: "y".repeat(1200) }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    await assert.rejects(() => pools.admin.query(`UPDATE public.driver_application_corrections SET reason = 'x' WHERE application_id = $1`, [app.id]));
  });

  scenario("tenant isolation: another company cannot read, verify, decide, correct or open documents of this application", async () => {
    const a = await org("A");
    const b = await org("B");
    await asStaff(...FULL);
    const s = await submitFor(a);
    const [app] = await review(a, s.prospectId);
    const notFound = (e: Error) => e.constructor.name.endsWith("NotFoundError");
    assert.equal((await K.rv.getApplicationReview({ organizationId: b, prospectId: s.prospectId })).applications.length, 0);
    await assert.rejects(() => K.rv.recordVerification({ organizationId: b, applicationId: app.id, requirementKey: app.requirements[0].key, status: "PENDING" }), notFound);
    await assert.rejects(() => K.rv.recordDecision({ organizationId: b, applicationId: app.id, decision: "NOT_QUALIFIED", reasons: ["x"] }), notFound);
    await assert.rejects(() => K.rv.recordCorrection({ organizationId: b, applicationId: app.id, fieldId: "identity.phone", correctedValue: "1", reason: "x" }), notFound);
    const doc = app.uploads[0].documentId;
    await assert.rejects(() => K.rv.authorizeDocumentView({ organizationId: b, applicationId: app.id, documentId: doc }), notFound);
    await assert.rejects(() => K.rv.authorizeDocumentView({ organizationId: a, applicationId: app.id, documentId: randomUUID() }), notFound);
    assert.ok(await K.rv.authorizeDocumentView({ organizationId: a, applicationId: app.id, documentId: doc }));
    // Without a system context the runtime role reads nothing; a read-only staff member cannot write.
    for (const t of ["driver_application_verifications", "driver_application_decisions", "driver_application_corrections", "driver_applications"]) {
      const r = await pools.runtime.query(`SELECT 1 FROM public.${t}`);
      assert.equal(r.rowCount, 0, `${t}: hidden without an authorized system context`);
    }
    await asStaff("DRIVER_READ");
    assert.ok((await K.rv.getApplicationReview({ organizationId: a, prospectId: s.prospectId })).applications.length === 1);
    await assert.rejects(() => K.rv.recordVerification({ organizationId: a, applicationId: app.id, requirementKey: app.requirements[0].key, status: "PENDING" }));
    await assert.rejects(() => K.rv.recordDecision({ organizationId: a, applicationId: app.id, decision: "NOT_QUALIFIED", reasons: ["x"] }));
    K.db.setClerkUser(null);
    await assert.rejects(() => K.rv.getApplicationReview({ organizationId: a, prospectId: s.prospectId }));
  });

  scenario("sensitive access: the dedicated capability is required, a purpose is mandatory, and every reveal is recorded (collection stays off here, so the ledger path is exercised through the gate)", async () => {
    const o = await org();
    await asStaff(...FULL);
    const s = await submitFor(o, { kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: { cmvOperation: "YES", cdlRequired: "YES" } });
    const [app] = await review(o, s.prospectId);
    const review1 = await K.rv.getApplicationReview({ organizationId: o, prospectId: s.prospectId });
    assert.equal(review1.canSeeSensitive, false);
    await assert.rejects(() => K.rv.revealSensitive({ organizationId: o, applicationId: app.id, fieldId: "eligibility.ssn", purpose: "check" }), (e: Error) => /denied|authoriz|forbidden/i.test(e.message + e.constructor.name));
    await asStaff(...FULL, "DRIVER_SENSITIVE_READ");
    assert.equal((await K.rv.getApplicationReview({ organizationId: o, prospectId: s.prospectId })).canSeeSensitive, true);
    await assert.rejects(() => K.rv.revealSensitive({ organizationId: o, applicationId: app.id, fieldId: "eligibility.ssn", purpose: "" }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    await assert.rejects(() => K.rv.revealSensitive({ organizationId: o, applicationId: app.id, fieldId: "eligibility.ssn", purpose: "Identity check" }), (e: Error) => e.constructor.name.endsWith("NotFoundError"), "nothing was collected, so nothing can be revealed");
    assert.equal((await q(`SELECT 1 FROM public.driver_sensitive_access_events`)).length, 0);
  });

  scenario("carrier HR configuration: validated against the legal matrix, versioned, and used for the next application", async () => {
    const o = await org();
    const staff = await asStaff(...FULL);
    const cfg = await K.rv.getHrProfile(o);
    assert.equal(cfg.version, 0);
    assert.ok(cfg.items.length > 5);
    await assert.rejects(() => K.rv.saveHrProfile({ organizationId: o, selections: { credit_check: { enabled: true } } }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    await assert.rejects(() => K.rv.saveHrProfile({ organizationId: o, selections: { made_up_item: { enabled: true } } }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    await assert.rejects(() => K.rv.saveHrProfile({ organizationId: o, selections: [] }), (e: Error) => e.constructor.name.endsWith("ValidationError"));
    assert.equal((await K.rv.saveHrProfile({ organizationId: o, selections: { professional_references: { enabled: true } } })).version, 1);
    assert.equal((await K.rv.saveHrProfile({ organizationId: o, selections: { professional_references: { enabled: true }, work_availability: { enabled: true } } })).version, 2);
    assert.equal((await K.rv.getHrProfile(o)).version, 2);
    assert.equal((await q(`SELECT 1 FROM public.organization_hr_screening_profiles WHERE organization_id = $1`, [o])).length, 2, "versions are kept");
    const s = await submitFor(o);
    const [app] = await review(o, s.prospectId);
    assert.ok(app.requirements.some((r) => r.key === "references"), "the carrier's choice reaches the plan frozen for the applicant");
    assert.ok(staff.actorId);
    // Another company's configuration is separate.
    const other = await org("Other");
    assert.equal((await K.rv.getHrProfile(other)).version, 0);
    await asStaff("DRIVER_READ");
    await assert.rejects(() => K.rv.saveHrProfile({ organizationId: o, selections: {} }));
  });
});
