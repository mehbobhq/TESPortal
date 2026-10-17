// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Evidence Phase 3: the Authorities workspace's use of the canonical association service. Operating authority (and tax registration) attachments through the REAL
// authorization wrappers, the RUNTIME role and the real Master Register; documents come from the established fixtures (a seeded stored
// document, and the fake storage port for the secure-view proof). No storage override is introduced.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";
import type { FakeEvidenceStorage as FakeStorage } from "@/test/helpers/fake-evidence-storage";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    seed: await import("@/test/helpers/evidence-payload-fixtures"),
    fake: await import("@/test/helpers/fake-evidence-storage"),
    ev: await import("@/lib/evidence-payload/service"),
    oa: await import("@/lib/operating-authorities/service"),
    tr: await import("@/lib/tax-registrations/service"),
    collection: await import("@/app/api/companies/[id]/evidence/route"),
    route: await import("@/app/api/companies/[id]/evidence/[documentId]/route"),
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

const AUTH_AND_EVIDENCE = ["EVIDENCE_READ", "EVIDENCE_MANAGE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ"];

describe("Authorities attachments (canonical evidence associations)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  let actorId = "";
  let storage: FakeStorage;
  const run = randomUUID().replace(/\D/g, "").slice(0, 6).padEnd(6, "9");
  let counter = 0;
  const n = () => ++counter;
  const digits = () => `${run}${String(n()).padStart(3, "0")}`;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
    storage = new K.fake.FakeEvidenceStorage();
  });
  after(async () => {
    K.db.setClerkUser(null);
    for (const fx of fixtures) await fx.cleanup().catch(() => undefined);
    await K.db.closePools();
  });

  async function signInWith(...capabilities: string[]) {
    const fx = new K.db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability as never, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
    actorId = actor.actorId;
  }
  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `AUTHA ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const named = (name: string) => (promise: Promise<unknown>) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof Error && error.name === name, `expected ${name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const notFound = named("EvidenceNotFoundError");
  const denied = named("TesAuthorizationDeniedError");

  async function authority(organizationId: string, kind: "MC" | "USDOT" = "MC"): Promise<string> {
    const made = await K.oa.createAuthority({ organizationId, kind, number: kind === "MC" ? `MC-${digits()}` : digits() });
    return made.view.authority.id;
  }
  async function registration(organizationId: string): Promise<string> {
    const made = await K.tr.createRegistration({ organizationId, program: "NY_HUT", number: `NY${digits()}` });
    return made.view.registration.id;
  }
  const storedDocument = (organizationId: string, status: "received" | "classified" | "verified" = "received") =>
    K.seed.seedPayloadBackedDocument(pools.admin, { organizationId, actorId, documentType: "OTHER_EVIDENCE", status, stage: "stored" });

  type Table = "operating_authorities" | "registrations";
  const attach = (organizationId: string, documentId: string, targetId: string, targetTable: Table = "operating_authorities") =>
    K.ev.associateEvidenceWithRecord({ organizationId, documentId, targetTable, targetId });
  const forRecord = (organizationId: string, targetId: string, targetTable: Table = "operating_authorities", includeArchived = true) =>
    K.ev.listEvidenceAssociationsWithPermissions({ organizationId, targetTable, targetId, includeArchived });
  const authorityState = async (id: string) =>
    (await pools.admin.query(`SELECT record_status FROM public.operating_authorities WHERE id = $1`, [id])).rows[0].record_status as string;

  async function getJson(organizationId: string, query: string) {
    const url = new URL(`http://localhost/api?${query}`);
    const request = Object.assign(new Request(url), { nextUrl: url });
    const response = await K.collection.GET(request as never, { params: Promise.resolve({ id: organizationId }) });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  it("attach to an authority: the document keeps its own status, nothing about the authority changes, and the association persists on a re-read", async () => {
    await signInWith(...AUTH_AND_EVIDENCE);
    const org = await organization("attach");
    const auth = await authority(org);
    const doc = await storedDocument(org, "received");
    const authorityBefore = JSON.stringify((await K.oa.getOrganizationAuthorities(org)).authorities[0]);
    const statusBefore = (await pools.admin.query(`SELECT document_status FROM public.evidence_documents WHERE id = $1`, [doc])).rows[0].document_status;
    const made = await attach(org, doc, auth);
    assert.equal(made.created, true);
    const first = await forRecord(org, auth);
    assert.equal(first.links.length, 1);
    assert.equal(first.links[0].status, "active");
    assert.equal(first.links[0].document.documentStatus, "received", "the document keeps its own, unreviewed status");
    assert.equal((await pools.admin.query(`SELECT document_status FROM public.evidence_documents WHERE id = $1`, [doc])).rows[0].document_status, statusBefore, "association does not verify the document");
    assert.equal(JSON.stringify((await K.oa.getOrganizationAuthorities(org)).authorities[0]), authorityBefore, "attaching does not change the authority's status, versions or periods");
    const again = await getJson(org, `targetTable=operating_authorities&targetId=${auth}&includeArchived=true`);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body.links.map((l: { linkId: string }) => l.linkId), [made.link.linkId]);
    assert.deepEqual(Object.keys(again.body).sort(), ["links", "permissions"]);
    assert.doesNotMatch(JSON.stringify(again.body), /gcs|bucket|object_name|objectName|generation|sha256|https?:\/\//i, "no storage detail or URL reaches the client");
  });

  it("attach to a tax registration: same behaviour on the registrations target; an authority's association is not visible on a registration", async () => {
    await signInWith(...AUTH_AND_EVIDENCE);
    const org = await organization("reg");
    const reg = await registration(org);
    const auth = await authority(org);
    const doc = await storedDocument(org, "classified");
    const made = await attach(org, doc, reg, "registrations");
    assert.equal(made.created, true);
    const view = await forRecord(org, reg, "registrations");
    assert.deepEqual(view.links.map((l) => [l.documentId, l.document.documentStatus, l.status]), [[doc, "classified", "active"]]);
    assert.deepEqual((await forRecord(org, auth)).links, [], "targets are separate: the authority has no association");
    // a registration id cannot be used as an authority id, nor the reverse
    await notFound(attach(org, doc, reg, "operating_authorities"));
    await notFound(attach(org, doc, auth, "registrations"));
  });

  it("each document status is reported as the domain states it, and a later review does not touch the association or the authority", async () => {
    await signInWith(...AUTH_AND_EVIDENCE);
    const org = await organization("status");
    const auth = await authority(org);
    const docs = { received: await storedDocument(org, "received"), classified: await storedDocument(org, "classified"), verified: await storedDocument(org, "verified") };
    for (const doc of Object.values(docs)) await attach(org, doc, auth);
    const byDocument = new Map((await forRecord(org, auth)).links.map((l) => [l.documentId, l.document.documentStatus]));
    assert.equal(byDocument.get(docs.received), "received");
    assert.equal(byDocument.get(docs.classified), "classified");
    assert.equal(byDocument.get(docs.verified), "verified");
    const view = (await K.oa.getOrganizationAuthorities(org)).authorities[0];
    assert.equal(view.current.status?.authorityStatus, "ACTIVE", "a verified attachment does not alter the authority's regulatory status (it was ACTIVE by creation, not by evidence)");
    await K.ev.reviewEvidence({ organizationId: org, documentId: docs.received, decision: "rejected" });
    const after = (await forRecord(org, auth)).links.find((l) => l.documentId === docs.received)!;
    assert.equal(after.document.documentStatus, "rejected");
    assert.equal(after.status, "active", "a review changes the document, not the association");
  });

  it("duplicate attachment is idempotent: one active association, one event", async () => {
    await signInWith(...AUTH_AND_EVIDENCE);
    const org = await organization("dup");
    const auth = await authority(org);
    const doc = await storedDocument(org);
    const events = () => count(`SELECT count(*) FROM public.master_register_events WHERE event_type = 'EVIDENCE_ASSOCIATED' AND actor_id = $1::uuid`, [actorId]);
    const before = await events();
    const a = await attach(org, doc, auth);
    const b = await attach(org, doc, auth);
    assert.equal(b.created, false);
    assert.equal(b.link.linkId, a.link.linkId);
    assert.equal((await forRecord(org, auth)).links.length, 1);
    assert.equal(await events(), before + 1);
  });

  it("archive the association: the document stays stored and unarchived, the history stays readable, re-attaching creates a new row", async () => {
    await signInWith(...AUTH_AND_EVIDENCE);
    const org = await organization("archive");
    const auth = await authority(org);
    const doc = await storedDocument(org, "verified");
    const made = await attach(org, doc, auth);
    await K.ev.archiveEvidenceAssociation({ organizationId: org, documentId: doc, linkId: made.link.linkId });
    const view = await forRecord(org, auth);
    assert.deepEqual(view.links.map((l) => l.status), ["archived"]);
    assert.equal((await forRecord(org, auth, "operating_authorities", false)).links.length, 0, "the active list excludes it");
    const document = (await pools.admin.query(`SELECT d.document_status, d.archived_at, p.lifecycle_state FROM public.evidence_documents d JOIN public.evidence_payloads p ON p.evidence_document_id = d.id WHERE d.id = $1`, [doc])).rows[0];
    assert.deepEqual([document.document_status, document.archived_at, document.lifecycle_state], ["verified", null, "stored"]);
    const again = await attach(org, doc, auth);
    assert.equal(again.created, true);
    assert.equal((await forRecord(org, auth)).links.length, 2);
  });

  it("other-company isolation: documents, associations and authorities/registrations of another company are never reachable", async () => {
    await signInWith(...AUTH_AND_EVIDENCE);
    const a = await organization("iso-a");
    const b = await organization("iso-b");
    const authA = await authority(a);
    const authB = await authority(b);
    const regA = await registration(a);
    const docA = await storedDocument(a);
    const docB = await storedDocument(b);
    const linkA = await attach(a, docA, authA);
    await attach(a, docA, regA, "registrations");
    assert.deepEqual((await forRecord(b, authA)).links, []);
    assert.deepEqual((await forRecord(b, regA, "registrations")).links, []);
    assert.equal((await getJson(b, "")).body.evidence.some((item: { documentId: string }) => item.documentId === docA), false, "the picker of B never lists A's document");
    assert.equal((await getJson(a, "")).body.evidence.some((item: { documentId: string }) => item.documentId === docB), false);
    await notFound(attach(b, docA, authB));
    await notFound(attach(a, docA, authB));
    await notFound(attach(a, docB, authA));
    await notFound(attach(b, docA, regA, "registrations"));
    await notFound(K.ev.archiveEvidenceAssociation({ organizationId: b, documentId: docA, linkId: linkA.link.linkId }));
    assert.equal(await count(`SELECT count(*) FROM public.evidence_links WHERE organization_id = $1`, [b]), 0);
  });

  it("read-only and unauthorized access: permissions say so, and the server refuses every write", async () => {
    await signInWith(...AUTH_AND_EVIDENCE);
    const org = await organization("auth");
    const auth = await authority(org);
    const reg = await registration(org);
    const doc = await storedDocument(org);
    const made = await attach(org, doc, auth);
    await signInWith("EVIDENCE_READ", "ORGANIZATION_REGISTRY_READ", "TAX_REGISTRATION_READ");
    const readOnly = await forRecord(org, auth);
    assert.equal(readOnly.links.length, 1);
    assert.deepEqual(readOnly.permissions, { canAssociate: false, canArchive: false });
    await denied(attach(org, doc, auth));
    await denied(K.ev.archiveEvidenceAssociation({ organizationId: org, documentId: doc, linkId: made.link.linkId }));
    // evidence manager without the registry read capability: may archive, may not attach to an authority
    await signInWith("EVIDENCE_READ", "EVIDENCE_MANAGE", "TAX_REGISTRATION_READ");
    assert.deepEqual((await forRecord(org, auth)).permissions, { canAssociate: false, canArchive: true });
    await denied(attach(org, doc, auth));
    // the registry read capability is per target: tax-registration read does not open authorities, and the reverse
    assert.deepEqual((await forRecord(org, reg, "registrations")).permissions, { canAssociate: true, canArchive: true });
    await signInWith("EVIDENCE_READ", "EVIDENCE_MANAGE", "ORGANIZATION_REGISTRY_READ");
    await denied(attach(org, doc, reg, "registrations"));
    assert.deepEqual((await forRecord(org, auth)).permissions, { canAssociate: true, canArchive: true });
    // authority management without any evidence capability: evidence is unreadable, 403 at the API
    await signInWith("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ");
    await denied(forRecord(org, auth));
    assert.equal((await getJson(org, `targetTable=operating_authorities&targetId=${auth}`)).status, 403);
    await signInWith();
    assert.equal((await getJson(org, `targetTable=operating_authorities&targetId=${auth}`)).status, 403);
    K.db.setClerkUser(null);
    assert.equal((await getJson(org, `targetTable=operating_authorities&targetId=${auth}`)).status, 403);
    assert.equal(await count(`SELECT count(*) FROM public.evidence_links WHERE organization_id = $1 AND link_status = 'active'`, [org]), 1);
  });

  it("archived authority: history stays readable, restore keeps it, and the UI contract is read-only for archived records", async () => {
    await signInWith(...AUTH_AND_EVIDENCE);
    const org = await organization("archived");
    const auth = await authority(org);
    const doc = await storedDocument(org);
    const made = await attach(org, doc, auth);
    await K.oa.archiveAuthority({ organizationId: org, authorityId: auth });
    assert.equal(await authorityState(auth), "archived");
    assert.deepEqual((await forRecord(org, auth)).links.map((l) => [l.linkId, l.status]), [[made.link.linkId, "active"]], "archiving the authority keeps its association history");
    await K.oa.restoreAuthority({ organizationId: org, authorityId: auth });
    assert.equal(await authorityState(auth), "active");
    assert.deepEqual((await forRecord(org, auth)).links.map((l) => l.linkId), [made.link.linkId]);
    // the inspector gives the component allowWrite={!isArchived}; the component then offers no attach or archive control
    const inspector = readFileSync(`${process.cwd()}/src/restored/authorities/record-inspector.tsx`, "utf8");
    assert.match(inspector, /allowWrite=\{!record\.isArchived\}/);
    const component = readFileSync(`${process.cwd()}/src/components/shared/EvidenceAttachments.tsx`, "utf8");
    assert.match(component, /allowWrite/);
  });

  it("authorities operations are unaffected: change, correction and a second authority with attachments present", async () => {
    await signInWith(...AUTH_AND_EVIDENCE);
    const org = await organization("ops");
    const auth = await authority(org);
    const doc = await storedDocument(org);
    await attach(org, doc, auth);
    await K.oa.changeAuthorityStatus({ organizationId: org, authorityId: auth, status: "SUSPENDED" });
    await K.oa.correctAuthorityStatus({ organizationId: org, authorityId: auth, status: "ACTIVE" });
    const view = (await K.oa.getOrganizationAuthorities(org)).authorities.find((v) => v.authority.id === auth)!;
    assert.equal(view.current.status?.authorityStatus, "ACTIVE");
    assert.equal((await forRecord(org, auth)).links.length, 1, "status changes and corrections keep the association");
    const other = await authority(org, "USDOT");
    assert.deepEqual((await forRecord(org, other)).links, []);
  });

  it("secure view: an attached document opens only through the existing viewer (audit before bytes); another company cannot open it", async () => {
    await signInWith(...AUTH_AND_EVIDENCE);
    const a = await organization("view-a");
    const b = await organization("view-b");
    const auth = await authority(a);
    const upload = await K.ev.uploadEvidence({ organizationId: a, documentType: "OTHER_EVIDENCE", documentTitle: "Authority certificate", file: { bytes: new Uint8Array(K.fake.samplePdf("auth")), mimeType: "application/pdf", filename: "auth.pdf" } }, storage);
    const quarantine = (await pools.admin.query(`SELECT quarantine_object_name FROM public.evidence_payloads WHERE evidence_document_id = $1`, [upload.documentId])).rows[0].quarantine_object_name as string;
    await assert.rejects(attach(a, upload.documentId, auth), (error: unknown) => error instanceof Error && error.name === "EvidenceStateError");
    storage.scannerPromote(quarantine);
    assert.equal((await K.ev.finalizeEvidence({ organizationId: a, documentId: upload.documentId }, storage)).state, "stored");
    await attach(a, upload.documentId, auth);
    const views = () => count(`SELECT count(*) FROM public.evidence_payload_access_events e WHERE e.evidence_document_id = $1`, [upload.documentId]);
    const before = await views();
    const opened = await K.ev.openEvidenceForView({ organizationId: a, documentId: upload.documentId }, storage);
    assert.ok(opened.bytes.length > 0);
    assert.equal(await views(), before + 1);
    await notFound(K.ev.openEvidenceForView({ organizationId: b, documentId: upload.documentId }, storage));
    await signInWith("ORGANIZATION_REGISTRY_READ");
    const response = await K.route.GET(new Request("http://localhost/api") as never, { params: Promise.resolve({ id: a, documentId: upload.documentId }) });
    assert.equal(response.status, 403);
  });

  it("the Authorities inspector uses the shared component only: placeholder gone, correct target table, no browser storage", () => {
    const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const inspector = strip(readFileSync(`${process.cwd()}/src/restored/authorities/record-inspector.tsx`, "utf8"));
    assert.match(inspector, /<EvidenceAttachments[\s\S]*targetTable="operating_authorities"[\s\S]*targetId=\{selected\.record\.id\}/);
    assert.doesNotMatch(inspector, /no canonical link to a registration record|CanonicalUnavailable|localStorage|sessionStorage|indexedDB/);
    const root = strip(readFileSync(`${process.cwd()}/src/restored/authorities/RestoredAuthorities.tsx`, "utf8"));
    assert.match(root, /<RecordInspector[\s\S]*companyId=\{companyId\}/);
    const component = strip(readFileSync(`${process.cwd()}/src/components/shared/EvidenceAttachments.tsx`, "utf8"));
    assert.doesNotMatch(component, /localStorage|sessionStorage|indexedDB|document\.cookie|storage\.googleapis|gs:\/\/|signedUrl|FormData/);
    assert.doesNotMatch(component, /action:\s*"(review|finalize|block|archive|satisfyRequirement)"/);
  });
});
