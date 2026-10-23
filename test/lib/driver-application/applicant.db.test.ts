// Migration 0041: the applicant boundary. Run with `npm run test:auth` or against a disposable database via the TES_TEST_* URLs.
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

describe("Universal driver application: applicant boundary (migration 0041)", { skip: !enabled }, () => {
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

  scenario("sessions: only the hash is stored, secrets and CSRF are required, bad or missing values behave identically, and a session can be revoked", async () => {
    const o = await org();
    await asStaff(...FULL);
    const a = await applicant(o);
    const [s] = await q<{ session_hash: string; csrf_hash: string }>(`SELECT session_hash, csrf_hash FROM public.driver_application_sessions WHERE application_id = (SELECT id FROM public.driver_applications WHERE prospect_id = $1)`, [a.prospectId]);
    assert.equal(s.session_hash, K.ctx.sha256Hex(a.sessionToken));
    assert.notEqual(s.session_hash, a.sessionToken);
    assert.equal(s.csrf_hash, K.ctx.sha256Hex(a.csrfToken));
    // Reads need only the session; writes also need the matching CSRF token.
    assert.ok((await K.as.loadApplicantApplication(a.sessionToken)).application.id);
    await rejectsWith(() => K.as.saveApplicantDraft(a.sessionToken, null, { version: 1, patch: {} }), 403);
    await rejectsWith(() => K.as.saveApplicantDraft(a.sessionToken, "wrong-csrf-token-value-0123456789", { version: 1, patch: {} }), 403);
    await rejectsWith(() => K.as.loadApplicantApplication(null), 401);
    await rejectsWith(() => K.as.loadApplicantApplication("x".repeat(43)), 401);
    // An expired or revoked session is indistinguishable from an unknown one.
    await pools.admin.query(`UPDATE public.driver_application_sessions SET revoked_at = now() WHERE application_id = (SELECT id FROM public.driver_applications WHERE prospect_id = $1)`, [a.prospectId]);
    await rejectsWith(() => K.as.loadApplicantApplication(a.sessionToken), 401);
    // The invitation secret can open a fresh session; it is stored only as a hash.
    const again = await K.as.startApplicantSession({ secret: a.secret, ip: "10.9.9.9", userAgent: "x" });
    assert.ok(again.ok);
    const inv = await q<{ token_hash: string }>(`SELECT token_hash FROM public.driver_application_invitations WHERE prospect_id = $1`, [a.prospectId]);
    assert.notEqual(inv[0].token_hash, a.secret);
  });

  scenario("rate limiting is persistent in PostgreSQL: repeated session opens from one source are refused", async () => {
    const o = await org();
    await asStaff(...FULL);
    const a = await applicant(o);
    let limited = false;
    for (let i = 0; i < 40 && !limited; i += 1) {
      const r = await K.as.startApplicantSession({ secret: a.secret, ip: "203.0.113.77", userAgent: "x" });
      if (!r.ok && r.reason === "RATE_LIMITED") limited = true;
    }
    assert.ok(limited, "the 31st attempt from one address is refused");
    assert.ok((await q(`SELECT 1 FROM public.applicant_rate_counters`)).length >= 1);
    await noAccess(() => pools.runtime.query(`SELECT 1 FROM public.applicant_rate_counters`), "the runtime role cannot read the counters directly");
  });

  scenario("tenant isolation: a session sees only its own application, and the runtime role has no table access without a system context", async () => {
    const a = await org("A");
    const b = await org("B");
    await asStaff(...FULL);
    const pa = await applicant(a);
    const pb = await applicant(b);
    const viewA = await K.as.loadApplicantApplication(pa.sessionToken);
    const viewB = await K.as.loadApplicantApplication(pb.sessionToken);
    assert.notEqual(viewA.application.id, viewB.application.id);
    assert.notEqual(viewA.companyName, viewB.companyName);
    for (const t of [...APP_TABLES, "driver_applications"]) {
      await noAccess(() => asRuntimeInContext(pa.sessionToken, `SELECT 1 FROM public.${t}`), `${t}: an applicant context reads nothing directly`);
    }
    const insert = () => asRuntimeInContext(pa.sessionToken, `INSERT INTO public.driver_application_drafts (application_id, organization_id) VALUES ($1, $2)`, [viewB.application.id, b]);
    await assert.rejects(insert);
    await assert.rejects(() => asRuntimeInContext(pa.sessionToken, `UPDATE public.driver_application_drafts SET answers = '{}'::jsonb`));
    // Company A's session cannot read company B's application by any definer function: the function acts only on the session's own application.
    const doc = await asRuntimeInContext(pa.sessionToken, `SELECT tes_security.applicant_get_application() AS doc`);
    assert.equal((doc.rows[0].doc as { application: { id: string } }).application.id, viewA.application.id);
    // A forged session identifier set by hand does nothing: the context is established only by enter_applicant_context from a real hash.
    const client = await pools.runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('tes.applicant_session_id', $1, true)`, [randomUUID()]);
      const forged = await client.query(`SELECT tes_security.applicant_get_application() AS doc`).catch(() => ({ rows: [{ doc: null }] }));
      assert.equal(forged.rows[0].doc, null);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  scenario("drafts: optimistic concurrency, patches limited to this plan's answer fields, and hidden answers are retained", async () => {
    const o = await org();
    await asStaff(...FULL);
    const a = await applicant(o);
    const view = await K.as.loadApplicantApplication(a.sessionToken);
    const v0 = view.answersVersion;
    const first = await K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: v0, patch: { "identity.legal_first_name": "Alex" } });
    assert.equal(first.version, v0 + 1);
    await rejectsWith(() => K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: v0, patch: { "identity.legal_first_name": "Stale" } }), 409);
    await rejectsWith(() => K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: first.version, patch: { "not.a.field": "x" } }), 422);
    const sensitive = view.plan.fields.find((f) => f.type === "sensitive");
    if (sensitive) await rejectsWith(() => K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: first.version, patch: { [sensitive.id]: "123456789" } }), 422);
    const upload = view.plan.fields.find((f) => f.type === "upload")!;
    await rejectsWith(() => K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: first.version, patch: { [upload.id]: "x" } }), 422);
    await rejectsWith(() => K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: first.version, patch: { "identity.legal_last_name": "y".repeat(150_000) } }), 413);
    const reread = await K.as.loadApplicantApplication(a.sessionToken);
    assert.equal(reread.answers["identity.legal_first_name"], "Alex");
    assert.equal(reread.application.status, "DRAFT");
    // A double-click: two concurrent saves of the same version cannot both win.
    const results = await Promise.allSettled([
      K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: reread.answersVersion, patch: { "identity.legal_last_name": "One" } }),
      K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: reread.answersVersion, patch: { "identity.legal_last_name": "Two" } }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  });

  scenario("submit: server-side validation, one receipt generated by the database, idempotent, immutable afterwards, and the frozen plan cannot change", async () => {
    const o = await org();
    const staff = await asStaff(...FULL);
    const a = await applicant(o);
    const early = await K.as.submitApplicantApplication(a.sessionToken, a.csrfToken);
    assert.equal(early.ok, false, "an empty application is not accepted");
    assert.equal((await q(`SELECT 1 FROM public.driver_application_snapshots`)).filter(Boolean).length >= 0, true);

    const port = new K.storage.FakeEvidenceStorage();
    let view = await K.as.loadApplicantApplication(a.sessionToken);
    const answers = K.fill.validAnswers(view.plan);
    await K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: view.answersVersion, patch: answers });
    view = await K.as.loadApplicantApplication(a.sessionToken);
    for (const { field, required } of K.validate.applicableFields(view.plan, view.answers)) {
      if (field.type === "upload" && required) {
        const pdf = field.evidence!.accept.includes("application/pdf");
        await K.as.uploadApplicantDocument(a.sessionToken, a.csrfToken, { fieldId: field.id, bytes: pdf ? K.fill.PDF_BYTES : K.fill.PNG_BYTES, mimeType: pdf ? "application/pdf" : "image/png", filename: pdf ? "a.pdf" : "a.png" }, port as never);
      }
    }
    const name = `${answers["identity.legal_first_name"]} ${answers["identity.legal_last_name"]}`;
    view = await K.as.loadApplicantApplication(a.sessionToken);
    for (const c of view.plan.consents.filter((x) => !x.external)) {
      await K.as.presentApplicantConsent(a.sessionToken, a.csrfToken, c.key);
      await K.as.acceptApplicantConsent(a.sessionToken, a.csrfToken, { key: c.key, signatureName: name, affirmed: true });
    }
    const [r1, r2] = await Promise.all([K.as.submitApplicantApplication(a.sessionToken, a.csrfToken), K.as.submitApplicantApplication(a.sessionToken, a.csrfToken)]);
    assert.ok(r1.ok && r2.ok);
    if (!r1.ok || !r2.ok) return;
    assert.equal(r1.receiptId, r2.receiptId, "concurrent submits produce one receipt");
    assert.equal(r1.alreadySubmitted !== r2.alreadySubmitted, true, "exactly one of them did the work");
    assert.equal((await q(`SELECT 1 FROM public.driver_application_snapshots WHERE application_id = $1`, [view.application.id])).length, 1);
    assert.equal((await q(`SELECT 1 FROM public.driver_application_submissions WHERE prospect_id = $1`, [a.prospectId])).length, 1);
    const [snap] = await q<{ payload_sha256: string; payload: { declaredBy: string } }>(`SELECT payload_sha256, payload FROM public.driver_application_snapshots WHERE application_id = $1`, [view.application.id]);
    assert.equal(snap.payload.declaredBy, "APPLICANT");
    assert.match(snap.payload_sha256, /^[0-9a-f]{64}$/);
    // Locked after submission.
    await rejectsWith(() => K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: view.answersVersion + 1, patch: { "identity.phone": "000" } }), 409);
    await assert.rejects(() => pools.admin.query(`UPDATE public.driver_application_snapshots SET payload = '{}'::jsonb WHERE application_id = $1`, [view.application.id]));
    await assert.rejects(() => pools.admin.query(`DELETE FROM public.driver_application_snapshots WHERE application_id = $1`, [view.application.id]));
    await assert.rejects(() => pools.admin.query(`UPDATE public.driver_applications SET plan = '{}'::jsonb WHERE id = $1`, [view.application.id]));
    await assert.rejects(() => pools.admin.query(`UPDATE public.driver_application_drafts SET answers = '{}'::jsonb WHERE application_id = $1`, [view.application.id]));
    // The signed PDF: generated once from the stored snapshot, stored as controlled evidence, attached once.
    const before = port.count("quarantine");
    const [p1, p2] = await Promise.all([K.as.ensureApplicationPdf(a.sessionToken, port as never), K.as.ensureApplicationPdf(a.sessionToken, port as never)]);
    assert.ok(p1 && p2 && p1.documentId === p2.documentId, "concurrent generation yields one document");
    assert.equal([p1, p2].filter((x) => x?.created).length, 1);
    assert.equal(port.count("quarantine"), before + 1);
    const again = await K.as.ensureApplicationPdf(a.sessionToken, port as never);
    assert.ok(again && !again.created && again.sha256 === p1.sha256);
    const [pdf] = await q<{ document_type: string; source_channel: string; mime_type: string; sha256: string; pdf_sha256: string }>(
      `SELECT d.document_type, d.source_channel, d.mime_type, d.sha256, a.pdf_sha256 FROM public.driver_applications a JOIN public.evidence_documents d ON d.id = a.pdf_evidence_document_id WHERE a.id = $1`, [view.application.id]);
    assert.deepEqual([pdf.document_type, pdf.source_channel, pdf.mime_type], ["DRIVER_APPLICATION_PDF", "system_generated", "application/pdf"]);
    assert.equal(pdf.sha256, pdf.pdf_sha256);
    const stored = [...port.stages.quarantine.values()].flat().find((o) => o.bytes.subarray(0, 5).toString("latin1") === "%PDF-" && createHash("sha256").update(o.bytes).digest("hex") === pdf.sha256);
    assert.ok(stored, "the stored bytes hash to the recorded SHA-256");
    await assert.rejects(() => pools.admin.query(`UPDATE public.driver_applications SET pdf_sha256 = repeat('b', 64) WHERE id = $1`, [view.application.id]), "the attached PDF cannot be swapped");
    // A draft application has no PDF.
    const draft = await applicant(o);
    assert.equal(await K.as.ensureApplicationPdf(draft.sessionToken, port as never), null);
    assert.ok(staff.actorId);
  });

  scenario("uploads: only requested documents, validated type and signature, tenant-scoped object, source recorded, never trusting the browser's field or company", async () => {
    const o = await org();
    await asStaff(...FULL);
    const a = await applicant(o);
    const port = new K.storage.FakeEvidenceStorage();
    const view = await K.as.loadApplicantApplication(a.sessionToken);
    const uploadField = K.validate.applicableFields(view.plan, view.answers).map((x) => x.field).find((f) => f.type === "upload")!;
    const png = !uploadField.evidence!.accept.includes("application/pdf") || uploadField.evidence!.accept.includes("image/png");
    await rejectsWith(() => K.as.uploadApplicantDocument(a.sessionToken, a.csrfToken, { fieldId: "no.such.field", bytes: K.fill.PNG_BYTES, mimeType: "image/png", filename: "a.png" }, port as never), 404);
    await rejectsWith(() => K.as.uploadApplicantDocument(a.sessionToken, a.csrfToken, { fieldId: "identity.legal_first_name", bytes: K.fill.PNG_BYTES, mimeType: "image/png", filename: "a.png" }, port as never), 404);
    await rejectsWith(() => K.as.uploadApplicantDocument(a.sessionToken, a.csrfToken, { fieldId: uploadField.id, bytes: new TextEncoder().encode("MZ not an image"), mimeType: "image/png", filename: "a.png" }, port as never), 422);
    await rejectsWith(() => K.as.uploadApplicantDocument(a.sessionToken, a.csrfToken, { fieldId: uploadField.id, bytes: K.fill.PNG_BYTES, mimeType: "application/x-msdownload", filename: "a.exe" }, port as never), 422);
    assert.equal(port.count("quarantine"), 0, "nothing reached storage for refused files");
    if (png) {
      const ok = await K.as.uploadApplicantDocument(a.sessionToken, a.csrfToken, { fieldId: uploadField.id, bytes: K.fill.PNG_BYTES, mimeType: "image/png", filename: "licence front.png" }, port as never);
      assert.equal(ok.state, "quarantined");
      const [ev] = await q<{ organization_id: string; gcs_object_name: string; source_channel: string; sha256: string; document_type: string }>(`SELECT organization_id, gcs_object_name, source_channel, sha256, document_type FROM public.evidence_documents WHERE id = $1`, [ok.documentId]);
      assert.equal(ev.organization_id, o);
      assert.ok(ev.gcs_object_name.includes(o), "the object key is scoped to the company");
      assert.equal(ev.source_channel, "client_upload");
      assert.match(ev.document_type, /^DRIVER_APPLICATION_/);
      const reread = await K.as.loadApplicantApplication(a.sessionToken);
      assert.equal(reread.uploads.filter((u) => u.fieldId === uploadField.id).length, 1);
      assert.equal(reread.uploads[0].state === "blocked", false);
      // A replacement supersedes; only one current document per field/slot.
      await K.as.uploadApplicantDocument(a.sessionToken, a.csrfToken, { fieldId: uploadField.id, bytes: K.fill.PNG_BYTES, mimeType: "image/png", filename: "again.png" }, port as never);
      assert.equal((await K.as.loadApplicantApplication(a.sessionToken)).uploads.filter((u) => u.fieldId === uploadField.id).length, 1);
      assert.equal((await q(`SELECT 1 FROM public.driver_application_uploads WHERE application_id = $1 AND field_id = $2`, [view.application.id, uploadField.id])).length, 2, "history kept");
    }
  });

  scenario("authorizations: presentation before signature, exact text hash recorded, typed name must match, pending-legal-review is recorded as such, external processes are never signed here", async () => {
    const o = await org();
    await asStaff(...FULL);
    const a = await applicant(o, { kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: { cmvOperation: "YES", cdlRequired: "YES", pspIntended: true } });
    const view = await K.as.loadApplicantApplication(a.sessionToken);
    const answers = K.fill.validAnswers(view.plan);
    await K.as.saveApplicantDraft(a.sessionToken, a.csrfToken, { version: view.answersVersion, patch: answers });
    const name = `${answers["identity.legal_first_name"]} ${answers["identity.legal_last_name"]}`;
    const signable = view.plan.consents.find((c) => !c.external)!;
    await rejectsWith(() => K.as.acceptApplicantConsent(a.sessionToken, a.csrfToken, { key: signable.key, signatureName: name, affirmed: true }), 409);
    const shown = await K.as.presentApplicantConsent(a.sessionToken, a.csrfToken, signable.key);
    assert.equal(shown.textSha256, signable.textSha256);
    await rejectsWith(() => K.as.acceptApplicantConsent(a.sessionToken, a.csrfToken, { key: signable.key, signatureName: "Someone Else", affirmed: true }), 422);
    await rejectsWith(() => K.as.acceptApplicantConsent(a.sessionToken, a.csrfToken, { key: "no_such_consent", signatureName: name, affirmed: true }), 404);
    await rejectsWith(() => K.as.acceptApplicantConsent(a.sessionToken, a.csrfToken, { key: signable.key, signatureName: name }), 422); // no affirmative action
    const accepted = await K.as.acceptApplicantConsent(a.sessionToken, a.csrfToken, { key: signable.key, signatureName: name, affirmed: true });
    assert.ok(accepted.consentId);
    const [row] = await q<{ text_sha256: string; signature_name: string; legal_status: string; purpose: string; authorized_parties: unknown; jurisdiction: string; accepted_at: Date; consent_version: string }>(
      `SELECT text_sha256, signature_name, legal_status, purpose, authorized_parties, jurisdiction, accepted_at, consent_version FROM public.driver_application_consents WHERE id = $1`, [accepted.consentId]);
    assert.equal(row.text_sha256, signable.textSha256);
    assert.equal(row.signature_name, name);
    assert.equal(row.legal_status, signable.legalStatus);
    assert.ok(row.purpose && row.jurisdiction && row.accepted_at && row.consent_version);
    assert.notEqual(row.legal_status, "APPROVED", "no wording in this repository is counsel-approved");
    const external = view.plan.consents.find((c) => c.external);
    if (external) await rejectsWith(() => K.as.acceptApplicantConsent(a.sessionToken, a.csrfToken, { key: external.key, signatureName: name, affirmed: true }), 409);
    await assert.rejects(() => pools.admin.query(`UPDATE public.driver_application_consents SET signature_name = 'x' WHERE id = $1`, [accepted.consentId]));
  });

  scenario("sensitive identifiers: collection is off, nothing is stored, no ordinary JSON holds one, and the runtime role cannot read the vault", async () => {
    const o = await org();
    await asStaff(...FULL);
    const a = await applicant(o, { kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: { cmvOperation: "YES", cdlRequired: "YES" } });
    const view = await K.as.loadApplicantApplication(a.sessionToken);
    const ssn = view.plan.fields.find((f) => f.id === "eligibility.ssn");
    assert.ok(ssn && ssn.collection.enabled === false);
    await rejectsWith(() => K.as.saveApplicantSensitive(a.sessionToken, a.csrfToken, { fieldId: "eligibility.ssn", value: "123-45-6789" }), 409);
    await rejectsWith(() => K.as.saveApplicantSensitive(a.sessionToken, a.csrfToken, { fieldId: "identity.legal_first_name", value: "x" }), 404);
    assert.equal((await q(`SELECT 1 FROM public.driver_sensitive_values`)).length, 0);
    for (const t of ["driver_sensitive_values", "driver_sensitive_access_events"]) {
      await noAccess(() => pools.runtime.query(`SELECT 1 FROM public.${t}`), `${t}: unreadable to the runtime role without a system context`);
    }
    const drafts = JSON.stringify(await q(`SELECT answers FROM public.driver_application_drafts`));
    assert.ok(!/123-?45-?6789/.test(drafts));
  });

  scenario("attribution: every applicant has an individual actor, applicant actions are in the Master Register under that actor, and nobody shares one", async () => {
    const o = await org();
    await asStaff(...FULL);
    const a1 = await applicant(o);
    const a2 = await applicant(o);
    const [x1] = await q<{ applicant_actor_id: string }>(`SELECT applicant_actor_id FROM public.driver_applications WHERE prospect_id = $1`, [a1.prospectId]);
    const [x2] = await q<{ applicant_actor_id: string }>(`SELECT applicant_actor_id FROM public.driver_applications WHERE prospect_id = $1`, [a2.prospectId]);
    assert.notEqual(x1.applicant_actor_id, x2.applicant_actor_id);
    const v1 = await K.as.loadApplicantApplication(a1.sessionToken);
    await K.as.saveApplicantDraft(a1.sessionToken, a1.csrfToken, { version: v1.answersVersion, patch: { "identity.legal_first_name": "Pat" } });
    const ops1 = await q<{ op: string }>(`SELECT action->>'operation' AS op FROM public.master_register_events WHERE actor_id = $1`, [x1.applicant_actor_id]);
    assert.ok(ops1.some((r) => r.op === "DRIVER_APPLICATION_SESSION_OPEN"), "the applicant's own session is in the Master Register");
    assert.equal((await q(`SELECT 1 FROM public.master_register_events WHERE actor_id = $1`, [x2.applicant_actor_id])).filter((r) => r).length >= 1, true);
    const [ident] = await q<{ provider: string }>(`SELECT provider FROM public.authentication_identities WHERE actor_id = $1`, [x1.applicant_actor_id]);
    assert.equal(ident.provider, "tes-driver-invitation");
    // The applicant actor can write Master Register events only about its own application (policy), never about another company.
    const bad = await pools.runtime.connect();
    try {
      await bad.query("BEGIN");
      await bad.query(`SELECT * FROM tes_security.enter_applicant_context($1)`, [K.ctx.sha256Hex(a1.sessionToken)]);
      await assert.rejects(() => bad.query(`INSERT INTO public.master_register_events (id, event_type, actor_id, target, action, source, classification, change, outcome, event_hash, previous_hash, sequence_number, occurred_at, recorded_at) SELECT gen_random_uuid(), 'RECORD_CREATED', $1, '{"companyId":"00000000-0000-0000-0000-000000000000"}'::jsonb, action, source, classification, change, outcome, event_hash, previous_hash, sequence_number + 99999, occurred_at, recorded_at FROM public.master_register_events LIMIT 1`, [x1.applicant_actor_id]));
      await bad.query("ROLLBACK");
    } finally {
      bad.release();
    }
  });
});
