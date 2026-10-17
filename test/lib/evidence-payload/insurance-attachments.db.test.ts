// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Evidence Phase 2: the Insurance workspace's use of the canonical association service. Insurance policy attachments through the REAL
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
    insurance: await import("@/lib/insurance/service"),
    workspace: await import("@/lib/insurance-workspace/service"),
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

const INSURANCE_AND_EVIDENCE = ["EVIDENCE_READ", "EVIDENCE_MANAGE", "INSURANCE_MANAGE", "INSURANCE_READ", "ORGANIZATION_REGISTRY_READ"];

describe("Insurance policy attachments (canonical evidence associations)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  let actorId = "";
  let storage: FakeStorage;
  const run = randomUUID().replace(/\D/g, "").slice(0, 6).padEnd(6, "9");
  let counter = 0;
  const n = () => ++counter;

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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `INSA ${label} ${run} ${id.slice(0, 6)}`]);
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

  async function policy(organizationId: string): Promise<string> {
    const insurer = await organization("insurer");
    const made = (await K.insurance.createPolicy({
      organizationId,
      insurerOrganizationId: insurer,
      family: "INSURANCE",
      policyNumber: `POL-${run}-${n()}`,
      termStart: "2024-01-01",
      termEnd: "2025-01-01",
      coverages: [{ coverageType: "AUTO_LIABILITY", limitAmount: "1000000", currency: "CAD" }],
    })) as unknown as { policy: { id: string } };
    return made.policy.id;
  }
  const storedDocument = (organizationId: string, status: "received" | "classified" | "verified" = "received") =>
    K.seed.seedPayloadBackedDocument(pools.admin, { organizationId, actorId, documentType: "OTHER_EVIDENCE", status, stage: "stored" });

  const attach = (organizationId: string, documentId: string, policyId: string) =>
    K.ev.associateEvidenceWithRecord({ organizationId, documentId, targetTable: "insurance_policies", targetId: policyId });
  const forPolicy = (organizationId: string, policyId: string, includeArchived = true) =>
    K.ev.listEvidenceAssociationsWithPermissions({ organizationId, targetTable: "insurance_policies", targetId: policyId, includeArchived });

  async function getJson(organizationId: string, query: string) {
    const url = new URL(`http://localhost/api?${query}`);
    const request = Object.assign(new Request(url), { nextUrl: url });
    const response = await K.collection.GET(request as never, { params: Promise.resolve({ id: organizationId }) });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  it("attach an eligible document: it appears with the document's own status, 'attached' is not verification, and it persists on a re-read", async () => {
    await signInWith(...INSURANCE_AND_EVIDENCE);
    const org = await organization("attach");
    const pol = await policy(org);
    const doc = await storedDocument(org, "received");
    const statusBefore = (await pools.admin.query(`SELECT document_status FROM public.evidence_documents WHERE id = $1`, [doc])).rows[0].document_status;
    const made = await attach(org, doc, pol);
    assert.equal(made.created, true);
    const first = await forPolicy(org, pol);
    assert.equal(first.links.length, 1);
    assert.equal(first.links[0].status, "active");
    assert.equal(first.links[0].document.documentStatus, "received", "the document keeps its own, unreviewed status");
    assert.equal(first.links[0].document.documentType, "OTHER_EVIDENCE");
    assert.equal((await pools.admin.query(`SELECT document_status FROM public.evidence_documents WHERE id = $1`, [doc])).rows[0].document_status, statusBefore);
    // refresh persistence: a new read (new transaction, new request) returns the same association
    const again = await getJson(org, `targetTable=insurance_policies&targetId=${pol}&includeArchived=true`);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body.links.map((l: { linkId: string }) => l.linkId), [made.link.linkId]);
    assert.deepEqual(Object.keys(again.body).sort(), ["links", "permissions"]);
    assert.doesNotMatch(JSON.stringify(again.body), /gcs|bucket|object_name|objectName|generation|sha256|https?:\/\//i, "no storage detail or URL reaches the client");
  });

  it("each document status is reported as the domain states it (received, classified, verified) and a later review does not touch the association", async () => {
    await signInWith(...INSURANCE_AND_EVIDENCE);
    const org = await organization("status");
    const pol = await policy(org);
    const docs = { received: await storedDocument(org, "received"), classified: await storedDocument(org, "classified"), verified: await storedDocument(org, "verified") };
    for (const doc of Object.values(docs)) await attach(org, doc, pol);
    const byDocument = new Map((await forPolicy(org, pol)).links.map((l) => [l.documentId, l.document.documentStatus]));
    assert.equal(byDocument.get(docs.received), "received");
    assert.equal(byDocument.get(docs.classified), "classified");
    assert.equal(byDocument.get(docs.verified), "verified");
    await K.ev.reviewEvidence({ organizationId: org, documentId: docs.received, decision: "rejected" });
    const after = (await forPolicy(org, pol)).links.find((l) => l.documentId === docs.received)!;
    assert.equal(after.document.documentStatus, "rejected", "the association shows the document's CURRENT status");
    assert.equal(after.status, "active", "a review changes the document, not the association");
  });

  it("duplicate attachment is idempotent: one active association, one event", async () => {
    await signInWith(...INSURANCE_AND_EVIDENCE);
    const org = await organization("dup");
    const pol = await policy(org);
    const doc = await storedDocument(org);
    const events = () => count(`SELECT count(*) FROM public.master_register_events WHERE event_type = 'EVIDENCE_ASSOCIATED' AND actor_id = $1::uuid`, [actorId]);
    const before = await events();
    const a = await attach(org, doc, pol);
    const b = await attach(org, doc, pol);
    assert.equal(b.created, false);
    assert.equal(b.link.linkId, a.link.linkId);
    assert.equal((await forPolicy(org, pol)).links.length, 1);
    assert.equal(await events(), before + 1);
  });

  it("archive the association: the document stays stored, unarchived and viewable; the history stays readable; re-attaching creates a new row", async () => {
    await signInWith(...INSURANCE_AND_EVIDENCE);
    const org = await organization("archive");
    const pol = await policy(org);
    const doc = await storedDocument(org, "verified");
    const made = await attach(org, doc, pol);
    await K.ev.archiveEvidenceAssociation({ organizationId: org, documentId: doc, linkId: made.link.linkId });
    const view = await forPolicy(org, pol);
    assert.deepEqual(view.links.map((l) => l.status), ["archived"]);
    assert.equal((await forPolicy(org, pol, false)).links.length, 0, "the active list excludes it");
    const document = (await pools.admin.query(`SELECT d.document_status, d.archived_at, p.lifecycle_state FROM public.evidence_documents d JOIN public.evidence_payloads p ON p.evidence_document_id = d.id WHERE d.id = $1`, [doc])).rows[0];
    assert.deepEqual([document.document_status, document.archived_at, document.lifecycle_state], ["verified", null, "stored"], "the document is not archived, deleted or demoted");
    const again = await attach(org, doc, pol);
    assert.equal(again.created, true);
    assert.equal((await forPolicy(org, pol)).links.length, 2);
  });

  it("other-company isolation: documents, associations and policies of another company are never reachable", async () => {
    await signInWith(...INSURANCE_AND_EVIDENCE);
    const a = await organization("iso-a");
    const b = await organization("iso-b");
    const polA = await policy(a);
    const polB = await policy(b);
    const docA = await storedDocument(a);
    const docB = await storedDocument(b);
    const linkA = await attach(a, docA, polA);
    // B sees no association of A's policy, and A's document is not offered to B
    assert.deepEqual((await forPolicy(b, polA)).links, []);
    assert.equal((await getJson(b, "")).body.evidence.some((item: { documentId: string }) => item.documentId === docA), false, "the document picker of B never lists A's document");
    assert.equal((await getJson(a, "")).body.evidence.some((item: { documentId: string }) => item.documentId === docB), false);
    // cross attachment in every direction is "not found"
    await notFound(attach(b, docA, polB));
    await notFound(attach(a, docA, polB));
    await notFound(attach(a, docB, polA));
    await notFound(K.ev.archiveEvidenceAssociation({ organizationId: b, documentId: docA, linkId: linkA.link.linkId }));
    assert.equal(await count(`SELECT count(*) FROM public.evidence_links WHERE organization_id = $1`, [b]), 0);
  });

  it("read-only and unauthorized access: permissions say so, and the server refuses every write", async () => {
    await signInWith(...INSURANCE_AND_EVIDENCE);
    const org = await organization("auth");
    const pol = await policy(org);
    const doc = await storedDocument(org);
    const made = await attach(org, doc, pol);
    // evidence read-only: sees the attachment, may not change it
    await signInWith("EVIDENCE_READ", "INSURANCE_READ");
    const readOnly = await forPolicy(org, pol);
    assert.equal(readOnly.links.length, 1);
    assert.deepEqual(readOnly.permissions, { canAssociate: false, canArchive: false });
    await denied(attach(org, doc, pol));
    await denied(K.ev.archiveEvidenceAssociation({ organizationId: org, documentId: doc, linkId: made.link.linkId }));
    // evidence manager without the insurance read capability: may archive, may not attach to a policy
    await signInWith("EVIDENCE_READ", "EVIDENCE_MANAGE");
    assert.deepEqual((await forPolicy(org, pol)).permissions, { canAssociate: false, canArchive: true });
    await denied(attach(org, doc, pol));
    // full: may do both
    await signInWith(...INSURANCE_AND_EVIDENCE);
    assert.deepEqual((await forPolicy(org, pol)).permissions, { canAssociate: true, canArchive: true });
    // no evidence capability at all (even with insurance): evidence is unreadable, 403 at the API
    await signInWith("INSURANCE_MANAGE", "INSURANCE_READ");
    await denied(forPolicy(org, pol));
    assert.equal((await getJson(org, `targetTable=insurance_policies&targetId=${pol}`)).status, 403);
    await signInWith();
    assert.equal((await getJson(org, `targetTable=insurance_policies&targetId=${pol}`)).status, 403);
    K.db.setClerkUser(null);
    assert.equal((await getJson(org, `targetTable=insurance_policies&targetId=${pol}`)).status, 403);
    assert.equal(await count(`SELECT count(*) FROM public.evidence_links WHERE organization_id = $1 AND link_status = 'active'`, [org]), 1);
  });

  it("secure view: an attached document opens only through the existing viewer (audit before bytes, hash re-verified); another company cannot open it; the association adds no other path", async () => {
    await signInWith(...INSURANCE_AND_EVIDENCE);
    const a = await organization("view-a");
    const b = await organization("view-b");
    const pol = await policy(a);
    const upload = await K.ev.uploadEvidence({ organizationId: a, documentType: "OTHER_EVIDENCE", documentTitle: "Certificate of insurance", file: { bytes: new Uint8Array(K.fake.samplePdf("coi")), mimeType: "application/pdf", filename: "coi.pdf" } }, storage);
    const quarantine = (await pools.admin.query(`SELECT quarantine_object_name FROM public.evidence_payloads WHERE evidence_document_id = $1`, [upload.documentId])).rows[0].quarantine_object_name as string;
    // not attachable before the scanner and finalize
    await assert.rejects(attach(a, upload.documentId, pol), (error: unknown) => error instanceof Error && error.name === "EvidenceStateError");
    storage.scannerPromote(quarantine);
    assert.equal((await K.ev.finalizeEvidence({ organizationId: a, documentId: upload.documentId }, storage)).state, "stored");
    await attach(a, upload.documentId, pol);
    const views = () => count(`SELECT count(*) FROM public.evidence_payload_access_events e WHERE e.evidence_document_id = $1`, [upload.documentId]);
    const before = await views();
    const opened = await K.ev.openEvidenceForView({ organizationId: a, documentId: upload.documentId }, storage);
    assert.ok(opened.bytes.length > 0);
    assert.equal(await views(), before + 1, "the view is recorded before the bytes are served");
    await notFound(K.ev.openEvidenceForView({ organizationId: b, documentId: upload.documentId }, storage));
    // the client link is the existing secure-view route, never a storage URL
    const component = readFileSync(`${process.cwd()}/src/components/shared/EvidenceAttachments.tsx`, "utf8");
    assert.match(component, /\/api\/companies\/\$\{encodeURIComponent\(companyId\)\}\/evidence\/\$\{encodeURIComponent\(link\.documentId\)\}/);
    // the route itself refuses an actor without EVIDENCE_READ before touching storage
    await signInWith("INSURANCE_READ");
    const response = await K.route.GET(new Request("http://localhost/api") as never, { params: Promise.resolve({ id: a, documentId: upload.documentId }) });
    assert.equal(response.status, 403);
  });

  it("Insurance operations are unaffected: archive and restore work with attachments present, and attachments are neither moved nor lost", async () => {
    await signInWith(...INSURANCE_AND_EVIDENCE);
    const org = await organization("ops");
    const pol = await policy(org);
    const doc = await storedDocument(org);
    const made = await attach(org, doc, pol);
    const policyBefore = (await pools.admin.query(`SELECT record_status FROM public.insurance_policies WHERE id = $1`, [pol])).rows[0].record_status;
    assert.equal(policyBefore, "active");
    await K.insurance.archivePolicy({ organizationId: org, policyId: pol });
    assert.equal((await pools.admin.query(`SELECT record_status FROM public.insurance_policies WHERE id = $1`, [pol])).rows[0].record_status, "archived");
    const links = (await forPolicy(org, pol)).links;
    assert.deepEqual(links.map((l) => [l.linkId, l.status]), [[made.link.linkId, "active"]], "archiving the policy keeps its association history");
    await K.insurance.restorePolicy({ organizationId: org, policyId: pol });
    assert.equal((await pools.admin.query(`SELECT record_status FROM public.insurance_policies WHERE id = $1`, [pol])).rows[0].record_status, "active");
    // a second, unrelated policy is unaffected by the first one's attachments
    const other = await policy(org);
    assert.deepEqual((await forPolicy(org, other)).links, []);
  });

  it("the shared component keeps to the canonical API: no browser storage, no storage URLs, no upload, no verification call", () => {
    const source = readFileSync(`${process.cwd()}/src/components/shared/EvidenceAttachments.tsx`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|storage\.googleapis|gs:\/\/|signedUrl|FormData/);
    assert.doesNotMatch(source, /action:\s*"(review|finalize|block|archive|satisfyRequirement)"/, "attaching never calls a review or document-lifecycle action");
    assert.match(source, /action: "link"/);
    assert.match(source, /action: "archiveLink"/);
    for (const section of ["TransportationPoliciesSection", "WorkersCompSection", "SuretyBondsSection"]) {
      const text = readFileSync(`${process.cwd()}/src/restored/insurance/${section}.tsx`, "utf8");
      assert.match(text, /EvidenceAttachments/, section);
      assert.doesNotMatch(text, /EvidenceNote/, section);
    }
  });
});
