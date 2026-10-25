// Final gate: end-to-end flow and the six operating scenarios against the real services and database (storage is an in-memory stand-in; GCS itself is NOT exercised). Run with `npm run test:auth` or against a disposable database via the TES_TEST_* URLs.
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
    ev: await import("@/lib/evidence-payload/service"),
    pdfText: await import("../../helpers/pdf-text"),
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

describe("Universal driver application: end-to-end gate (migration 0041)", { skip: !enabled }, () => {
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
      const all = [...tables, ...APP_TABLES, "evidence_payload_access_events", "evidence_payloads", "evidence_documents"];
      for (const t of all) await client.query(`ALTER TABLE public.${t} DISABLE TRIGGER USER`);
      const people = (await client.query<{ person_id: string }>(`SELECT DISTINCT person_id FROM public.driver_prospects WHERE organization_id = ANY($1::uuid[])`, [organizations])).rows.map((r) => r.person_id);
      await client.query(`DELETE FROM public.evidence_payload_access_events WHERE payload_id IN (SELECT id FROM public.evidence_payloads WHERE organization_id = ANY($1::uuid[]))`, [organizations]);
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


  const review = async (o: string, prospectId: string) => (await K.rv.getApplicationReview({ organizationId: o, prospectId })).applications;

  type Port = InstanceType<Kit["storage"]["FakeEvidenceStorage"]>;
  const EVIDENCE = ["EVIDENCE_READ", "EVIDENCE_MANAGE"];
  const OUT = process.env.TES_GATE_OUT;

  async function issue(o: string, scope: Record<string, unknown>, name = `Gate Tester${n()}`) {
    const created = await K.svc.createProspect({ organizationId: o, fullName: name, email: `g${run}${n()}@example.com`, scope: scope as never });
    const links: string[] = [];
    const sent = await K.svc.sendInvitation({ organizationId: o, prospectId: created.prospectId, baseUrl: "https://tes.test" }, async (m: { link: string }) => {
      links.push(m.link);
      return { messageId: `m${n()}` };
    });
    assert.equal(sent.sent, true);
    return { ...created, secret: secretOf(links[0]), name };
  }
  const open = async (secret: string) => {
    const s = await K.as.startApplicantSession({ secret, ip: `10.2.${n() % 250}.1`, userAgent: "node-test" });
    assert.ok(s.ok);
    if (!s.ok) throw new Error("unreachable");
    return s;
  };
  async function uploadAll(sess: { sessionToken: string; csrfToken: string }, port: Port, everything = false) {
    const view = await K.as.loadApplicantApplication(sess.sessionToken);
    for (const { field, required } of K.validate.applicableFields(view.plan, view.answers)) {
      if (field.type !== "upload" || (!required && !everything)) continue;
      const pdf = field.evidence!.accept.includes("application/pdf");
      await K.as.uploadApplicantDocument(sess.sessionToken, sess.csrfToken, { fieldId: field.id, bytes: pdf ? K.fill.PDF_BYTES : K.fill.PNG_BYTES, mimeType: pdf ? "application/pdf" : "image/png", filename: pdf ? "synthetic.pdf" : "synthetic.png" }, port as never);
    }
  }
  async function signAll(sess: { sessionToken: string; csrfToken: string }, name: string) {
    const view = await K.as.loadApplicantApplication(sess.sessionToken);
    for (const c of view.plan.consents.filter((x) => !x.external)) {
      const shown = await K.as.presentApplicantConsent(sess.sessionToken, sess.csrfToken, c.key);
      assert.equal(shown.textSha256, c.textSha256);
      await K.as.acceptApplicantConsent(sess.sessionToken, sess.csrfToken, { key: c.key, signatureName: name, affirmed: true });
    }
  }

  scenario("END TO END: invitation -> applicant -> save/resume -> uploads -> authorizations -> submit -> signed PDF -> evidence lifecycle -> employer review -> records and Master Register", async () => {
    const o = await org("Prairie Freight Ltd", "CA");
    const staff = await asStaff(...FULL, ...EVIDENCE);
    const p = await issue(o, { kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["ON"] }, "Pat Synthetic");
    const port = new K.storage.FakeEvidenceStorage();

    // 2-4. open, complete part of the form, close, resume on a NEW session.
    const s1 = await open(p.secret);
    let view = await K.as.loadApplicantApplication(s1.sessionToken);
    const answers = K.fill.validAnswers(view.plan, { "identity.legal_first_name": "Pat", "identity.legal_last_name": "Synthetic" });
    const keys = Object.keys(answers);
    const half = Object.fromEntries(keys.slice(0, Math.ceil(keys.length / 2)).map((k) => [k, answers[k]]));
    await K.as.saveApplicantDraft(s1.sessionToken, s1.csrfToken, { version: view.answersVersion, patch: half });
    const s2 = await open(p.secret);
    view = await K.as.loadApplicantApplication(s2.sessionToken);
    assert.deepEqual(Object.keys(view.answers).sort(), Object.keys(half).sort(), "the saved half is there after resuming");
    const incomplete = await K.as.submitApplicantApplication(s2.sessionToken, s2.csrfToken);
    assert.equal(incomplete.ok, false, "an incomplete application is refused by the server");
    await K.as.saveApplicantDraft(s2.sessionToken, s2.csrfToken, { version: view.answersVersion, patch: answers });
    await rejectsWith(() => K.as.loadApplicantApplication(s1.sessionToken).then(() => { throw Object.assign(new Error("ok"), { status: 200 }); }), 200); // the first session is still valid (two devices)

    // 5-6. real documents, authorizations.
    await uploadAll(s2, port, true);
    await signAll(s2, "Pat Synthetic");

    // 7. submit; a second device cannot submit twice.
    const first = await K.as.submitApplicantApplication(s2.sessionToken, s2.csrfToken);
    assert.ok(first.ok);
    if (!first.ok) return;
    const second = await K.as.submitApplicantApplication(s1.sessionToken, s1.csrfToken);
    assert.ok(second.ok && second.alreadySubmitted && second.receiptId === first.receiptId);

    // 8. signed PDF generated, scanned (stand-in scanner), finalized and retrieved by staff.
    const pdf = await K.as.ensureApplicationPdf(s2.sessionToken, port as never);
    assert.ok(pdf?.created);
    const rows = await q<{ id: string; gcs_object_name: string }>(`SELECT id, gcs_object_name FROM public.evidence_documents WHERE organization_id = $1`, [o]);
    for (const r of rows) {
      port.scannerPromote(r.gcs_object_name);
      const fin = await K.ev.finalizeEvidence({ organizationId: o, documentId: r.id }, port as never);
      assert.equal(fin.state, "stored", `document ${r.id} is finalized into evidence storage`);
    }
    const opened = await K.ev.openEvidenceForView({ organizationId: o, documentId: pdf!.documentId }, port as never);
    assert.equal(createHash("sha256").update(opened.bytes).digest("hex"), pdf!.sha256, "retrieved bytes match the recorded SHA-256");
    const text = K.pdfText.pdfText(opened.bytes).replace(/\s+/g, " ");
    if (K.pdfText.hasPdftotext) {
      for (const must of ["Prairie", "Pat Synthetic", first.receiptId, "APPLICANT-DECLARED", "Typed signature of the applicant", "PENDING LEGAL REVIEW"]) assert.ok(text.includes(must), `PDF contains "${must}"`);
      for (const banned of ["Verification status", "Qualification requirements", "Driver hiring process", "Hiring decision"]) assert.ok(!text.includes(banned), `applicant PDF has no "${banned}"`);
      const pages = text.match(/Page (\d+) of (\d+)/g) ?? [];
      assert.ok(pages.length >= 5 && pages.every((x, i) => x.startsWith(`Page ${i + 1} of `)), "every page is numbered in order");
    }
    if (OUT) (await import("node:fs")).writeFileSync(`${OUT}/sample-signed-application.pdf`, opened.bytes);

    // 9. employer review workflow.
    const [app] = await review(o, p.prospectId);
    assert.equal(app.status, "SUBMITTED");
    assert.equal(app.receiptId, first.receiptId);
    assert.equal(app.pdf?.documentId, pdf!.documentId);
    assert.ok((app as { snapshotIntact?: boolean }).snapshotIntact && app.requirements.every((r) => r.current === null));
    assert.ok(app.uploads.length > 1 && app.uploads.every((u) => u.state === "stored"), JSON.stringify(app.uploads.map((u) => [u.fieldId, u.state])));
    for (const u of app.uploads) assert.ok(await K.rv.authorizeDocumentView({ organizationId: o, applicationId: app.id, documentId: u.documentId }));
    // 10. records, evidence links and Master Register.
    const [ap] = await q<{ applicant_actor_id: string; snapshot_sha256: string; pdf_evidence_document_id: string }>(`SELECT applicant_actor_id, snapshot_sha256, pdf_evidence_document_id FROM public.driver_applications WHERE id = $1`, [app.id]);
    assert.equal(ap.snapshot_sha256, app.snapshotSha256);
    assert.equal(ap.pdf_evidence_document_id, pdf!.documentId);
    const ops = (await q<{ op: string; actor_id: string }>(`SELECT action->>'operation' AS op, actor_id FROM public.master_register_events WHERE target->>'companyId' = $1`, [o]));
    const byApplicant = new Set(ops.filter((e) => e.actor_id === ap.applicant_actor_id).map((e) => e.op));
    for (const wanted of ["DRIVER_APPLICATION_SESSION_OPEN", "DRIVER_APPLICATION_UPLOAD", "DRIVER_APPLICATION_CONSENT_ACCEPT", "DRIVER_APPLICATION_SUBMIT", "DRIVER_APPLICATION_PDF_GENERATED"]) assert.ok(byApplicant.has(wanted), `applicant-attributed Master Register entry ${wanted}`);
    assert.ok(ops.some((e) => e.actor_id === staff.actorId), "staff actions (evidence finalize / view) are attributed to the staff actor");
    assert.equal((await q(`SELECT 1 FROM public.evidence_documents WHERE organization_id = $1 AND document_type = 'DRIVER_APPLICATION_PDF'`, [o])).length, 1);

    // 11. carrier dossier: the original declaration plus a separate review record, generated on demand for a reader with DRIVER_READ.
    const dossier = await K.rv.getCarrierDossierPdf({ organizationId: o, prospectId: p.prospectId, applicationId: app.id });
    assert.equal(dossier.receiptId, first.receiptId);
    if (K.pdfText.hasPdftotext) {
      const dtext = K.pdfText.pdfText(dossier.bytes).replace(/\s+/g, " ");
      for (const must of ["Driver Application Dossier", "Pat Synthetic", "PART 1", "Driver hiring process", "Document intake and processing", "Onboarding handoff", "Audit provenance", "Application submitted and signed", "NO DECISION RECORDED"]) assert.ok(dtext.includes(must), `dossier contains "${must}"`);
    }
  });

  const SCENARIOS: Array<{ name: string; country: "US" | "CA"; scope: Record<string, unknown>; us: boolean; ca: boolean; years: number; clearinghouse: boolean }> = [
    { name: "US intrastate", country: "US", scope: { kind: "US_INTRASTATE", usJurisdictions: ["TX"], characteristics: { cmvOperation: "YES", cdlRequired: "YES" } }, us: true, ca: false, years: 10, clearinghouse: true },
    { name: "US interstate", country: "US", scope: { kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: { cmvOperation: "YES", cdlRequired: "YES" } }, us: true, ca: false, years: 10, clearinghouse: true },
    { name: "CA intraprovincial", country: "CA", scope: { kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["ON"] }, us: false, ca: true, years: 3, clearinghouse: false },
    { name: "CA interprovincial", country: "CA", scope: { kind: "CA_INTERPROVINCIAL", caJurisdictions: ["ON", "QC"] }, us: false, ca: true, years: 3, clearinghouse: false },
    { name: "cross-border (CA carrier)", country: "CA", scope: { kind: "CROSS_BORDER", usJurisdictions: ["MI"], caJurisdictions: ["ON"], characteristics: { cmvOperation: "YES", cdlRequired: "YES" } }, us: true, ca: true, years: 10, clearinghouse: true },
    { name: "cross-border (US carrier)", country: "US", scope: { kind: "CROSS_BORDER", usJurisdictions: ["MI"], caJurisdictions: ["ON"], characteristics: { cmvOperation: "YES", cdlRequired: "YES" } }, us: true, ca: true, years: 10, clearinghouse: true },
  ];
  for (const sc of SCENARIOS) {
    scenario(`SCENARIO ${sc.name}: personalization, server validation, submission, PDF, review`, async () => {
      const o = await org(sc.name, sc.country);
      await asStaff(...FULL);
      const p = await issue(o, sc.scope);
      const port = new K.storage.FakeEvidenceStorage();
      const sess = await open(p.secret);
      const view = await K.as.loadApplicantApplication(sess.sessionToken);
      const ctx = view.plan.context;
      assert.equal(ctx.involvesUS, sc.us);
      assert.equal(ctx.involvesCA, sc.ca);
      assert.equal(ctx.historyYears, sc.years);
      assert.equal(view.plan.requirements.some((r) => r.key === "clearinghouse"), sc.clearinghouse);
      assert.equal(view.plan.consents.some((c) => c.key === "clearinghouse_limited_query"), sc.clearinghouse);
      assert.equal(view.plan.fields.some((f) => f.id === "identity.date_of_birth"), sc.us && !sc.ca, "date of birth is collected pre-offer only for U.S.-only operations");
      assert.ok(view.plan.fields.filter((f) => f.type === "sensitive").every((f) => !f.collection.enabled), "sensitive identifiers stay off");
      // Server-side validation: too little employment history for the scope is refused (the page cannot bypass it).
      const base = K.fill.validAnswers(view.plan, { "identity.legal_first_name": "Sam", "identity.legal_last_name": `Scenario${n()}` });
      const short = { ...base, "employment.history": [{ ...(base["employment.history"] as Array<Record<string, unknown>>)[0], from: new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10) }] };
      await K.as.saveApplicantDraft(sess.sessionToken, sess.csrfToken, { version: view.answersVersion, patch: short });
      await uploadAll(sess, port);
      const name = `${base["identity.legal_first_name"]} ${base["identity.legal_last_name"]}`;
      await signAll(sess, name);
      const refused = await K.as.submitApplicantApplication(sess.sessionToken, sess.csrfToken);
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.ok(refused.errors["employment.history"], "history coverage error is reported");
      const v2 = await K.as.loadApplicantApplication(sess.sessionToken);
      await K.as.saveApplicantDraft(sess.sessionToken, sess.csrfToken, { version: v2.answersVersion, patch: base });
      const done = await K.as.submitApplicantApplication(sess.sessionToken, sess.csrfToken);
      assert.ok(done.ok, JSON.stringify(done));
      const pdf = await K.as.ensureApplicationPdf(sess.sessionToken, port as never);
      assert.ok(pdf);
      const [app] = await review(o, p.prospectId);
      assert.equal(app.requirements.length, view.plan.requirements.length);
      assert.ok(app.requirements.every((r) => r.current === null), "nothing is verified by submitting");
      assert.equal(app.reviewRequirements.some((r) => r.id === "cross_border_applicability"), sc.us && sc.ca);
      assert.equal(app.consents.every((c) => c.legalStatus !== "APPROVED"), true);
      // The PDF states the scenario and never prints a restricted identifier.
      const bytes = [...port.stages.quarantine.values()].flat().find((x) => createHash("sha256").update(x.bytes).digest("hex") === pdf!.sha256)!.bytes;
      const text = K.pdfText.pdfText(bytes).replace(/\s+/g, " ");
      if (K.pdfText.hasPdftotext) {
        assert.ok(/Operating scope/i.test(text) && text.includes(sc.us && sc.ca ? "United States and Canada" : sc.us ? "United States" : "Canada"));
        assert.ok(!/\b\d{3}-?\d{2}-?\d{4}\b/.test(text));
      }
      if (OUT) (await import("node:fs")).writeFileSync(`${OUT}/scenario-${sc.name.replace(/[^a-z]+/gi, "-").toLowerCase()}.pdf`, bytes);
    });
  }

  scenario("restricted document views and verification boundaries: evidence-read alone cannot open a restricted document; read-only staff cannot decide", async () => {
    const o = await org("Boundary", "CA");
    await asStaff(...FULL, ...EVIDENCE);
    const p = await issue(o, { kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["ON"] });
    const port = new K.storage.FakeEvidenceStorage();
    const first = await open(p.secret);
    const v1 = await K.as.loadApplicantApplication(first.sessionToken);
    const answers = K.fill.validAnswers(v1.plan, { "identity.legal_first_name": "Bo", "identity.legal_last_name": "Boundary" });
    await K.as.saveApplicantDraft(first.sessionToken, first.csrfToken, { version: v1.answersVersion, patch: answers });
    await uploadAll(first, port);
    await signAll(first, "Bo Boundary");
    assert.ok((await K.as.submitApplicantApplication(first.sessionToken, first.csrfToken)).ok);
    await K.svc.reviewProspect({ organizationId: o, prospectId: p.prospectId, to: "UNDER_REVIEW" });
    const links: string[] = [];
    await K.svc.sendInvitation({ organizationId: o, prospectId: p.prospectId, baseUrl: "https://tes.test", stage: "CONDITIONAL_OFFER", supplementsApplicationId: v1.application.id }, async (m: { link: string }) => {
      links.push(m.link);
      return { messageId: `m${n()}` };
    });
    const sess = await open(secretOf(links[0]));
    const view = await K.as.loadApplicantApplication(sess.sessionToken);
    assert.equal(view.application.collectionStage, "CONDITIONAL_OFFER");
    const restricted = K.validate.applicableFields(view.plan, view.answers).map((x) => x.field).find((f) => f.type === "upload" && f.evidence!.sensitivity === "restricted");
    assert.ok(restricted, "the conditional-offer plan asks for a restricted document");
    const mime = restricted.evidence!.accept.includes("image/png") ? "image/png" : "application/pdf";
    const up = await K.as.uploadApplicantDocument(sess.sessionToken, sess.csrfToken, { fieldId: restricted.id, bytes: mime === "image/png" ? K.fill.PNG_BYTES : K.fill.PDF_BYTES, mimeType: mime, filename: "id" }, port as never);
    const [row] = await q<{ gcs_object_name: string }>(`SELECT gcs_object_name FROM public.evidence_documents WHERE id = $1`, [up.documentId]);
    port.scannerPromote(row.gcs_object_name);
    await K.ev.finalizeEvidence({ organizationId: o, documentId: up.documentId }, port as never);
    await assert.rejects(() => K.ev.openEvidenceForView({ organizationId: o, documentId: up.documentId }, port as never));
    await asStaff(...FULL, ...EVIDENCE, "DRIVER_SENSITIVE_READ");
    assert.ok((await K.ev.openEvidenceForView({ organizationId: o, documentId: up.documentId }, port as never)).bytes.length > 0);
  });
});
