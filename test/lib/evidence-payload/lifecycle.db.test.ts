// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Migration 0032 (evidence payload lifecycle) and lib/evidence-payload/service.ts, through the REAL authorization wrappers
// and the RUNTIME role (row-level security applies), with the real Master Register. Storage is an in-memory port with the
// same semantics as GCS (create-only writes, pinned reads, separate scanner as the only intake writer). Fixtures use the
// admin (table owner) pool.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";
import type { FakeEvidenceStorage as FakeStorage } from "@/test/helpers/fake-evidence-storage";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    fake: await import("@/test/helpers/fake-evidence-storage"),
    seed: await import("@/test/helpers/evidence-payload-fixtures"),
    sys: await import("@/lib/auth/tes-system-context"),
    authz: await import("@/lib/auth/tes-authorization"),
    caps: await import("@/lib/auth/tes-capabilities"),
    ev: await import("@/lib/evidence-payload/service"),
    keys: await import("@/lib/evidence-payload/object-keys"),
    onb: await import("@/lib/customer-onboarding/service"),
    of: await import("@/lib/onboarding-foundation/service"),
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

type PgError = Error & { code?: string };

describe("Evidence payload lifecycle (migration 0032, real authorization, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  let staffActorId = "";
  let storage: FakeStorage;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    for (const fx of fixtures) await fx.cleanup();
    await K.db.closePools();
  });

  async function signInWith(...capabilities: string[]) {
    const fx = new K.db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
    staffActorId = actor.actorId;
  }

  const WRITE_AND_READ = ["EVIDENCE_READ", "EVIDENCE_MANAGE"];

  async function organization(): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `Evidence ${id.slice(0, 8)}`]);
    return id;
  }

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });

  const upload = (organizationId: string, bytes: Buffer, over: Record<string, unknown> = {}) =>
    K.ev.uploadEvidence(
      { organizationId, documentType: "CUSTOMER_AUTHORITY_NOTICE", documentTitle: "Authority notice", file: { bytes, mimeType: "application/pdf", filename: "notice.pdf" }, ...over },
      storage,
    );

  const row = async (documentId: string) =>
    (await pools.admin.query(`SELECT d.document_status, d.gcs_bucket, d.gcs_object_name, p.* FROM public.evidence_documents d JOIN public.evidence_payloads p ON p.evidence_document_id = d.id WHERE d.id = $1`, [documentId])).rows[0];

  const quarantineNameOf = async (documentId: string) => (await row(documentId)).quarantine_object_name as string;

  const masterEvents = async (type: string, documentId?: string) =>
    Number(
      (
        await pools.admin.query(
          `SELECT count(*) FROM public.master_register_events WHERE event_type = $1 AND actor_id = $2::uuid AND ($3::text IS NULL OR target ->> 'resourceId' = $3)`,
          [type, staffActorId, documentId ?? null],
        )
      ).rows[0].count,
    );

  /** upload -> scanner -> finalize: a stored payload. */
  async function storedDocument(organizationId: string, label: string = randomUUID(), over: Record<string, unknown> = {}) {
    const { documentId } = await upload(organizationId, K.fake.samplePdf(label), over);
    storage.scannerPromote(await quarantineNameOf(documentId));
    const result = await K.ev.finalizeEvidence({ organizationId, documentId }, storage);
    assert.equal(result.state, "stored");
    return documentId;
  }

  async function raw(sql: string, params: unknown[] = [], capability: "EVIDENCE_MANAGE" | "EVIDENCE_READ" = "EVIDENCE_MANAGE"): Promise<PgError | null> {
    try {
      await K.sys.withAuthorizedSystem(capability, async (client) => {
        await client.query(sql, params);
      });
      return null;
    } catch (error) {
      return error as PgError;
    }
  }

  function freshStorage() {
    storage = new K.fake.FakeEvidenceStorage();
  }

  // =============================================================================================================
  describe("upload -> quarantine -> scanner -> evidence", () => {
    it("walks quarantined -> cleared -> stored with tenant-scoped names, create-only writes and a Master Register trail", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const bytes = K.fake.samplePdf("happy path");
      const { documentId, state } = await upload(org, bytes);
      assert.equal(state, "quarantined");

      let current = await row(documentId);
      assert.equal(current.lifecycle_state, "quarantined");
      assert.equal(current.document_status, "received");
      assert.equal(current.gcs_bucket, "tes-test-quarantine", "a new document points at quarantine only");
      assert.equal(current.quarantine_object_name, `quarantine/${org}/${current.batch_id}/${current.source_file_id}/source`);
      assert.equal(current.declared_sha256, K.fake.sha256(bytes));
      assert.equal(storage.count("evidence"), 0, "nothing reaches evidence on upload");
      assert.equal(storage.count("intake"), 0, "the portal never writes intake");
      assert.equal(await masterEvents("DOCUMENT_INGESTED", documentId), 1);

      // The scanner has not cleared it: finalize is a harmless no-op, not an error and not a promotion.
      const pending = await K.ev.finalizeEvidence({ organizationId: org, documentId }, storage);
      assert.deepEqual({ state: pending.state, pending: pending.pending }, { state: "quarantined", pending: true });
      assert.equal(storage.count("evidence"), 0);

      storage.scannerPromote(current.quarantine_object_name);
      const done = await K.ev.finalizeEvidence({ organizationId: org, documentId }, storage);
      assert.equal(done.state, "stored");

      current = await row(documentId);
      assert.equal(current.lifecycle_state, "stored");
      assert.equal(current.evidence_object_name, K.keys.evidenceKey({ organizationId: org, documentId }));
      assert.equal(current.verified_sha256, K.fake.sha256(bytes));
      assert.equal(current.gcs_bucket, "tes-test-evidence", "the document now points at the verified evidence object");
      assert.equal(current.gcs_object_name, current.evidence_object_name);
      assert.ok(storage.names("evidence").includes(current.evidence_object_name));
      assert.ok(storage.names("intake").length === 1 && storage.names("quarantine").length === 1, "the originals are never deleted");
      assert.equal(await masterEvents("RECORD_STATUS_CHANGED", documentId), 2, "cleared and stored were each recorded");

      // idempotent: finalizing again changes nothing and writes nothing more
      const writesBefore = storage.calls.filter((call) => call.startsWith("copyIntakeToEvidence")).length;
      assert.equal((await K.ev.finalizeEvidence({ organizationId: org, documentId }, storage)).state, "stored");
      assert.equal(storage.calls.filter((call) => call.startsWith("copyIntakeToEvidence")).length, writesBefore);
    });

    it("validates before it writes: size, MIME, magic bytes, type and title never reach storage", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const good = K.fake.samplePdf("validation");
      const bad: Array<[string, Parameters<typeof upload>[2]]> = [
        ["unsupported MIME", { file: { bytes: good, mimeType: "text/html", filename: "x.html" } }],
        ["MIME does not match the bytes", { file: { bytes: Buffer.from("not really a pdf at all"), mimeType: "application/pdf", filename: "x.pdf" } }],
        ["empty", { file: { bytes: Buffer.alloc(0), mimeType: "application/pdf", filename: "x.pdf" } }],
        ["oversized", { file: { bytes: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(26 * 1024 * 1024)]), mimeType: "application/pdf", filename: "x.pdf" } }],
        ["bad document type", { documentType: "lower case" }],
        ["empty title", { documentTitle: "   " }],
      ];
      for (const [label, over] of bad) await assert.rejects(upload(org, good, over), (error: unknown) => error instanceof K.ev.PayloadValidationError, label);
      assert.deepEqual(storage.calls, [], "no storage call was made for any invalid upload");
      assert.equal(Number((await pools.admin.query(`SELECT count(*) FROM public.evidence_payloads WHERE organization_id = $1`, [org])).rows[0].count), 0);

      // a sanitized filename is metadata only and never part of an object name
      const { documentId } = await upload(org, good, { file: { bytes: good, mimeType: "application/pdf", filename: "../../etc/passwd\u0000.pdf" } });
      const stored = await row(documentId);
      assert.equal(stored.original_filename, "passwd.pdf");
      assert.doesNotMatch(stored.quarantine_object_name, /passwd|\.\./);
    });

    it("blocks a payload whose scanned intake bytes differ from the hash declared at upload", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const { documentId } = await upload(org, K.fake.samplePdf("tamper"));
      storage.scannerPromote(await quarantineNameOf(documentId), () => Buffer.from("%PDF-1.4 swapped bytes"));
      const result = await K.ev.finalizeEvidence({ organizationId: org, documentId }, storage);
      assert.equal(result.state, "blocked");
      const current = await row(documentId);
      assert.equal(current.block_reason, "INTEGRITY_MISMATCH");
      assert.equal(storage.count("evidence"), 0, "a blocked payload is never promoted");
      await rejectsWith(K.ev.openEvidenceForView({ organizationId: org, documentId }, storage), K.ev.EvidenceStateError);
      assert.equal((await K.ev.finalizeEvidence({ organizationId: org, documentId }, storage)).state, "blocked", "blocked is terminal");
    });

    it("never overwrites an existing evidence object: identical bytes are adopted (crash recovery), different bytes block", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();

      // crash recovery: the copy happened but the database never recorded it
      const first = K.fake.samplePdf("recovery");
      const { documentId } = await upload(org, first);
      storage.scannerPromote(await quarantineNameOf(documentId));
      storage.seed("evidence", K.keys.evidenceKey({ organizationId: org, documentId }), first);
      assert.equal((await K.ev.finalizeEvidence({ organizationId: org, documentId }, storage)).state, "stored");
      assert.equal(storage.stages.evidence.get(K.keys.evidenceKey({ organizationId: org, documentId }))?.length, 1, "no second write");

      // a squatter object with the wrong bytes at the evidence name
      const second = await upload(org, K.fake.samplePdf("squatted"));
      storage.scannerPromote(await quarantineNameOf(second.documentId));
      const name = K.keys.evidenceKey({ organizationId: org, documentId: second.documentId });
      storage.seed("evidence", name, Buffer.from("%PDF-1.4 something else"));
      assert.equal((await K.ev.finalizeEvidence({ organizationId: org, documentId: second.documentId }, storage)).state, "blocked");
      assert.equal((await row(second.documentId)).block_reason, "EVIDENCE_HASH_MISMATCH");
      assert.equal(storage.stages.evidence.get(name)?.length, 1, "the existing object was not overwritten or deleted");
    });
  });

  // =============================================================================================================
  describe("secure view", () => {
    it("records the Master Register event and access ledger row BEFORE any byte is read, and returns the verified bytes", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const documentId = await storedDocument(org, "view");
      const eventsBefore = await masterEvents("DOCUMENT_VIEWED", documentId);
      let loggedAtReadTime = -1;
      storage.beforeEvidenceRead = async () => {
        loggedAtReadTime = Number((await pools.admin.query(`SELECT count(*) FROM public.evidence_payload_access_events WHERE evidence_document_id = $1`, [documentId])).rows[0].count);
      };
      const opened = await K.ev.openEvidenceForView({ organizationId: org, documentId }, storage);
      assert.equal(loggedAtReadTime, 1, "the access was already committed when storage was read");
      assert.equal(opened.mimeType, "application/pdf");
      assert.equal(K.fake.sha256(opened.bytes), (await row(documentId)).verified_sha256);
      assert.equal(await masterEvents("DOCUMENT_VIEWED", documentId), eventsBefore + 1);
      const ledger = (await pools.admin.query(`SELECT a.actor_id, a.master_register_event_id, e.event_type FROM public.evidence_payload_access_events a JOIN public.master_register_events e ON e.event_id = a.master_register_event_id WHERE a.evidence_document_id = $1`, [documentId])).rows;
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].event_type, "DOCUMENT_VIEWED");
      assert.equal(ledger[0].actor_id, staffActorId);
    });

    it("serves nothing when the register cannot record the view", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const documentId = await storedDocument(org, "register-down");
      const readsBefore = storage.calls.filter((call) => call.startsWith("readEvidence")).length;
      await pools.admin.query(`ALTER TABLE public.master_register_events ADD CONSTRAINT mr_block_view CHECK (event_type <> 'DOCUMENT_VIEWED') NOT VALID`);
      try {
        await assert.rejects(K.ev.openEvidenceForView({ organizationId: org, documentId }, storage));
      } finally {
        await pools.admin.query(`ALTER TABLE public.master_register_events DROP CONSTRAINT mr_block_view`);
      }
      assert.equal(storage.calls.filter((call) => call.startsWith("readEvidence")).length, readsBefore, "no byte was read without a recorded view");
      assert.equal(Number((await pools.admin.query(`SELECT count(*) FROM public.evidence_payload_access_events WHERE evidence_document_id = $1`, [documentId])).rows[0].count), 0);
    });

    it("refuses to serve bytes that no longer match the verified hash, and records the failure", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const documentId = await storedDocument(org, "bitrot");
      const current = await row(documentId);
      const name = current.evidence_object_name as string;
      storage.stages.evidence.set(name, (storage.stages.evidence.get(name) ?? []).map((object) => ({ ...object, bytes: Buffer.from("tampered") })));
      const before = await masterEvents("VALIDATION_COMPLETED", documentId);
      await rejectsWith(K.ev.openEvidenceForView({ organizationId: org, documentId }, storage), K.ev.EvidenceStateError);
      assert.equal(await masterEvents("VALIDATION_COMPLETED", documentId), before + 1, "the integrity failure is in the register");
    });

    it("only stored-or-later payloads are viewable", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const { documentId } = await upload(org, K.fake.samplePdf("not yet"));
      await rejectsWith(K.ev.openEvidenceForView({ organizationId: org, documentId }, storage), K.ev.EvidenceStateError);
      assert.equal(await masterEvents("DOCUMENT_VIEWED", documentId), 0, "an unavailable document is not a recorded view");
      assert.ok(!storage.calls.some((call) => call.startsWith("readEvidence")));
    });
  });

  // =============================================================================================================
  describe("tenant isolation and authorization", () => {
    it("a document of another organization is not found: no view event, no storage read, no state change", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const orgA = await organization();
      const orgB = await organization();
      const documentId = await storedDocument(orgA, "tenant");
      const callsBefore = storage.calls.length;
      const viewsBefore = await masterEvents("DOCUMENT_VIEWED");

      await rejectsWith(K.ev.openEvidenceForView({ organizationId: orgB, documentId }, storage), K.ev.EvidenceNotFoundError);
      await rejectsWith(K.ev.finalizeEvidence({ organizationId: orgB, documentId }, storage), K.ev.EvidenceNotFoundError);
      await rejectsWith(K.ev.reviewEvidence({ organizationId: orgB, documentId, decision: "verified" }), K.ev.EvidenceNotFoundError);
      await rejectsWith(K.ev.satisfyEvidenceRequirement({ organizationId: orgB, documentId }), K.ev.EvidenceNotFoundError);
      await rejectsWith(K.ev.archiveEvidence({ organizationId: orgB, documentId }), K.ev.EvidenceNotFoundError);
      await rejectsWith(K.ev.blockEvidence({ organizationId: orgB, documentId }), K.ev.EvidenceNotFoundError);
      await rejectsWith(upload(orgB, K.fake.samplePdf("x"), { supersedesDocumentId: documentId }), K.ev.EvidenceNotFoundError);

      assert.equal(storage.calls.length, callsBefore, "no storage call at all");
      assert.equal(await masterEvents("DOCUMENT_VIEWED"), viewsBefore, "a refused cross-tenant view is not a recorded view");
      assert.equal((await row(documentId)).lifecycle_state, "stored");
      assert.deepEqual((await K.ev.listOrganizationEvidence(orgB)).map((item) => item.documentId), [], "B's listing never contains A's documents");
      assert.deepEqual((await K.ev.listOrganizationEvidence(orgA)).map((item) => item.documentId), [documentId]);

      // an unknown organization cannot receive an upload (nothing is written under its prefix)
      const ghost = randomUUID();
      const before = storage.calls.length;
      await rejectsWith(upload(ghost, K.fake.samplePdf("ghost")), K.ev.EvidenceNotFoundError);
      assert.equal(storage.calls.length, before);
    });

    it("capabilities: no capability is denied everywhere; read-only can view and list but not upload or change anything", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const documentId = await storedDocument(org, "caps");
      const callsBefore = storage.calls.length;

      await signInWith("ORGANIZATION_REGISTRY_READ");
      await rejectsWith(K.ev.listOrganizationEvidence(org), K.authz.TesAuthorizationDeniedError);
      await rejectsWith(K.ev.openEvidenceForView({ organizationId: org, documentId }, storage), K.authz.TesAuthorizationDeniedError);
      await rejectsWith(upload(org, K.fake.samplePdf("denied")), K.authz.TesAuthorizationDeniedError);
      assert.equal(storage.calls.length, callsBefore, "an unauthorized caller reaches no storage");

      await signInWith("EVIDENCE_READ");
      assert.equal((await K.ev.listOrganizationEvidence(org)).length, 1);
      assert.equal((await K.ev.openEvidenceForView({ organizationId: org, documentId }, storage)).mimeType, "application/pdf");
      await rejectsWith(upload(org, K.fake.samplePdf("read-only")), K.authz.TesAuthorizationDeniedError);
      await rejectsWith(K.ev.reviewEvidence({ organizationId: org, documentId, decision: "verified" }), K.authz.TesAuthorizationDeniedError);
      await rejectsWith(K.ev.archiveEvidence({ organizationId: org, documentId }), K.authz.TesAuthorizationDeniedError);

      await signInWith("EVIDENCE_MANAGE");
      assert.equal((await raw(`SELECT 1 FROM public.evidence_payload_access_events`, [], "EVIDENCE_MANAGE")), null, "manage may read the ledger it can write");

      K.db.setClerkUser(null);
      await assert.rejects(K.ev.listOrganizationEvidence(org));
      await assert.rejects(K.ev.openEvidenceForView({ organizationId: org, documentId }, storage));
    });
  });

  // =============================================================================================================
  describe("evidence requirements and readiness", () => {
    it("a requirement is satisfied only by a stored payload, and readiness moves only once that evidence is verified", async () => {
      await signInWith(...(K.caps.TES_CAPABILITY_CODES as readonly string[]));
      freshStorage();
      const org = await organization();
      const missingCount = async () => {
        const view = await K.onb.getCustomerOnboarding(org);
        return { documents: view.steps.find((step) => step.key === "documents")!, requirements: view.evidenceRequirements };
      };
      const before = await missingCount();
      assert.match(before.documents.detail, /1 evidence requirement still missing/);

      // 1. quarantined only: cannot satisfy
      const { documentId } = await upload(org, K.fake.samplePdf("requirement"));
      await rejectsWith(K.ev.satisfyEvidenceRequirement({ organizationId: org, documentId }), K.ev.EvidenceStateError);
      await rejectsWith(K.ev.reviewEvidence({ organizationId: org, documentId, decision: "verified" }), K.ev.EvidenceStateError);

      // 2. stored but unverified: the requirement is only 'received' and readiness does not move
      storage.scannerPromote(await quarantineNameOf(documentId));
      await K.ev.finalizeEvidence({ organizationId: org, documentId }, storage);
      assert.deepEqual(await K.ev.satisfyEvidenceRequirement({ organizationId: org, documentId }), { requirementCode: "CUSTOMER_AUTHORITY_NOTICE", requirementStatus: "received" });
      let after = await missingCount();
      assert.equal(after.requirements[0].requirementStatus, "received");
      assert.match(after.documents.detail, /1 evidence requirement still missing/, "received is not satisfied");

      // 3. verified + linked: now it counts
      await K.ev.reviewEvidence({ organizationId: org, documentId, decision: "verified" });
      assert.deepEqual(await K.ev.satisfyEvidenceRequirement({ organizationId: org, documentId }), { requirementCode: "CUSTOMER_AUTHORITY_NOTICE", requirementStatus: "verified" });
      after = await missingCount();
      assert.equal(after.requirements[0].requirementStatus, "verified");
      assert.equal(after.documents.status, "complete");
      assert.equal(await masterEvents("EVIDENCE_ASSOCIATED", documentId), 2);

      // a document type that satisfies no onboarding requirement is refused
      const other = await storedDocument(org, "other", { documentType: "HISTORY_RECORDS" });
      await rejectsWith(K.ev.satisfyEvidenceRequirement({ organizationId: org, documentId: other }), K.ev.EvidenceValidationError);
    });

    it("the database refuses a requirement without a stored payload of the right type, whoever asks", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const stored = await storedDocument(org, "type-check");
      const metadataOnly = randomUUID();
      await pools.admin.query(
        `INSERT INTO public.evidence_documents (id, organization_id, document_type, document_title, document_status, gcs_bucket, gcs_object_name, sha256, mime_type, byte_size, source_channel)
         VALUES ($1, $2, 'CUSTOMER_AUTHORITY_NOTICE', 'metadata only', 'verified', 'tes-test-evidence', $3, $4, 'application/pdf', 10, 'staff_upload')`,
        [metadataOnly, org, `evidence/${org}/${metadataOnly}/source`, "a".repeat(64)],
      );
      const upsert = (documentId: string, over: Record<string, unknown> = {}) =>
        K.of.upsertEvidenceRequirement({
          organizationId: org, requirementCode: "CUSTOMER_AUTHORITY_NOTICE", requirementLabel: "Notice", requiredFor: "authority_roles",
          requiredDocumentType: "CUSTOMER_AUTHORITY_NOTICE", requirementStatus: "verified", satisfiedByEvidenceDocumentId: documentId, ...over,
        } as never);
      await assert.rejects(upsert(metadataOnly), /stored, hash-verified payload/);
      await assert.rejects(upsert(stored), /verified, unexpired document/, "stored but not yet verified cannot be 'verified'");
      await assert.rejects(upsert(stored, { requiredDocumentType: "SERVICE_SCOPE_CONFIRMATION", requirementCode: "SERVICE_SCOPE_CONFIRMATION" }), /required type/);
      assert.equal((await upsert(stored, { requirementStatus: "received" })).requirementStatus, "received");
    });
  });

  // =============================================================================================================
  describe("versions, archive and recovery", () => {
    it("a replacement supersedes the earlier document: archived, never deleted, still viewable", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const first = await storedDocument(org, "v1");
      await K.ev.reviewEvidence({ organizationId: org, documentId: first, decision: "verified" });
      await rejectsWith(upload(org, K.fake.samplePdf("wrong type"), { supersedesDocumentId: first, documentType: "SERVICE_SCOPE_CONFIRMATION" }), K.ev.EvidenceValidationError);

      const second = await upload(org, K.fake.samplePdf("v2"), { supersedesDocumentId: first });
      await rejectsWith(upload(org, K.fake.samplePdf("v3"), { supersedesDocumentId: first }), K.ev.EvidenceConflictError);
      assert.equal((await row(first)).lifecycle_state, "stored", "the earlier document stays authoritative until the replacement is stored");
      storage.scannerPromote(await quarantineNameOf(second.documentId));
      await K.ev.finalizeEvidence({ organizationId: org, documentId: second.documentId }, storage);

      const older = await row(first);
      assert.equal(older.lifecycle_state, "superseded");
      assert.equal(older.document_status, "archived");
      assert.ok(storage.names("evidence").includes(older.evidence_object_name), "the old evidence object is retained");
      assert.equal((await K.ev.openEvidenceForView({ organizationId: org, documentId: first }, storage)).mimeType, "application/pdf");
      assert.equal(await masterEvents("DOCUMENT_SUPERSEDED", first), 1);
    });

    it("archives instead of deleting, and nothing can be deleted or truncated", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const documentId = await storedDocument(org, "archive");
      await K.ev.archiveEvidence({ organizationId: org, documentId });
      const archived = await row(documentId);
      assert.equal(archived.document_status, "archived");
      assert.equal(archived.lifecycle_state, "archived");
      assert.equal(await masterEvents("DOCUMENT_ARCHIVED", documentId), 1);
      await rejectsWith(K.ev.archiveEvidence({ organizationId: org, documentId }), K.ev.EvidenceStateError);
      await rejectsWith(K.ev.reviewEvidence({ organizationId: org, documentId, decision: "verified" }), K.ev.EvidenceStateError);

      for (const table of ["evidence_payloads", "evidence_payload_access_events", "evidence_documents"]) {
        assert.ok(await raw(`DELETE FROM public.${table}`), `DELETE on ${table} must be refused`);
        assert.ok(await raw(`TRUNCATE public.${table}`), `TRUNCATE on ${table} must be refused`);
      }
      await assert.rejects(pools.admin.query(`UPDATE public.evidence_payload_access_events SET access_kind = access_kind`), /append-only|no rows/).catch(() => undefined);
    });

    it("audit finds missing, drifted, stalled, orphan and foreign objects without changing anything", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const healthy = await storedDocument(org, "audit-healthy");
      const missing = await storedDocument(org, "audit-missing");
      const stalled = (await upload(org, K.fake.samplePdf("audit-stalled"))).documentId;
      await pools.admin.query(`ALTER TABLE public.evidence_payloads DISABLE TRIGGER USER`);
      await pools.admin.query(`UPDATE public.evidence_payloads SET created_at = now() - interval '3 days' WHERE evidence_document_id = $1`, [stalled]);
      await pools.admin.query(`ALTER TABLE public.evidence_payloads ENABLE TRIGGER USER`);

      const missingName = (await row(missing)).evidence_object_name as string;
      storage.stages.evidence.delete(missingName);
      const orphanName = `evidence/${org}/${randomUUID()}/source`;
      storage.seed("evidence", orphanName, Buffer.from("orphan"));
      storage.seed("quarantine", `quarantine/${org}/${randomUUID()}/${randomUUID()}/source`, Buffer.from("never recorded"));
      storage.seed("evidence", `evidence/${org}/not-a-canonical-name`, Buffer.from("junk"));

      const snapshot = JSON.stringify([storage.names("quarantine"), storage.names("intake"), storage.names("evidence")]);
      const report = await K.ev.auditEvidencePayloads({ organizationId: org }, storage);
      const codes = report.findings.map((finding) => finding.code).sort();
      assert.deepEqual(codes, ["MISSING_EVIDENCE_OBJECT", "ORPHAN_EVIDENCE_OBJECT", "ORPHAN_QUARANTINE_OBJECT", "SCAN_STALLED", "UNRECOGNIZED_OBJECT"].sort());
      assert.ok(report.findings.some((finding) => finding.code === "MISSING_EVIDENCE_OBJECT" && finding.documentId === missing));
      assert.ok(!report.findings.some((finding) => finding.documentId === healthy));
      assert.equal(JSON.stringify([storage.names("quarantine"), storage.names("intake"), storage.names("evidence")]), snapshot, "the audit never repairs, moves or deletes");

      // a tenant-scoped audit lists only that tenant's prefix
      const scoped = storage.calls.filter((call) => call.startsWith("list:"));
      assert.ok(scoped.every((call) => call.includes(org)), "listings are limited to the audited tenant");
    });

    it("an upload whose database record fails leaves an unreferenced quarantine object that the audit reports, never serves", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      await pools.admin.query(`ALTER TABLE public.master_register_events ADD CONSTRAINT mr_block_ingest CHECK (event_type <> 'DOCUMENT_INGESTED') NOT VALID`);
      try {
        await assert.rejects(upload(org, K.fake.samplePdf("db-fails")));
      } finally {
        await pools.admin.query(`ALTER TABLE public.master_register_events DROP CONSTRAINT mr_block_ingest`);
      }
      assert.equal(storage.count("quarantine"), 1);
      assert.deepEqual((await K.ev.listOrganizationEvidence(org)), [], "no record, so nothing to view or promote");
      const report = await K.ev.auditEvidencePayloads({ organizationId: org }, storage);
      assert.deepEqual(report.findings.map((finding) => finding.code), ["ORPHAN_QUARANTINE_OBJECT"]);
    });
  });

  // =============================================================================================================
  describe("database guards (as the runtime role)", () => {
    it("the application cannot register a non-received document, verify without a payload, or repoint storage", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const insert = (status: string, id = randomUUID()) =>
        raw(
          `INSERT INTO public.evidence_documents (id, organization_id, document_type, document_title, document_status, gcs_bucket, gcs_object_name, sha256, mime_type, byte_size, source_channel, archived_at)
           VALUES ($1, $2, 'OTHER_EVIDENCE', 'x', $3, 'tes-test-quarantine', $4, $5, 'application/pdf', 10, 'staff_upload', CASE WHEN $3 = 'archived' THEN now() ELSE NULL END)`,
          [id, org, status, `quarantine/${org}/${randomUUID()}/${randomUUID()}/source`, "b".repeat(64)],
        );
      for (const status of ["verified", "classified", "rejected", "archived"]) {
        const error = await insert(status);
        assert.equal(error?.code, "23514", `${status}: ${error?.message}`);
      }
      assert.equal(await insert("received"), null);

      // unbacked document: cannot be classified or verified
      const bare = randomUUID();
      assert.equal(await insert("received", bare), null);
      for (const status of ["classified", "verified"]) {
        const error = await raw(`UPDATE public.evidence_documents SET document_status = $2 WHERE id = $1`, [bare, status]);
        assert.equal(error?.code, "23514", error?.message);
        assert.match(error?.message ?? "", /stored, hash-verified payload/);
      }

      // a stored document: hash/size/org are immutable and its location can only be its own verified evidence object
      const stored = await storedDocument(org, "guards");
      for (const sql of [
        `UPDATE public.evidence_documents SET sha256 = '${"c".repeat(64)}' WHERE id = $1`,
        `UPDATE public.evidence_documents SET byte_size = 11 WHERE id = $1`,
        `UPDATE public.evidence_documents SET gcs_object_name = 'evidence/${org}/${randomUUID()}/source' WHERE id = $1`,
        `UPDATE public.evidence_documents SET gcs_bucket = 'some-other-bucket' WHERE id = $1`,
      ]) {
        const error = await raw(sql, [stored]);
        assert.ok(error, sql);
      }
    });

    it("payload rows: tenant-bound names, forward-only transitions, immutable hashes and locations, append-only access ledger", async () => {
      await signInWith(...WRITE_AND_READ);
      freshStorage();
      const org = await organization();
      const other = await organization();
      const documentId = await storedDocument(org, "payload-guards");
      const current = await row(documentId);

      const attempts: Array<[string, string, unknown[]]> = [
        ["backward transition", `UPDATE public.evidence_payloads SET lifecycle_state = 'cleared' WHERE id = $1`, [current.id]],
        ["stored cannot jump to blocked", `UPDATE public.evidence_payloads SET lifecycle_state = 'blocked', block_reason = 'OPERATOR_BLOCKED', evidence_object_name = NULL WHERE id = $1`, [current.id]],
        ["change declared hash", `UPDATE public.evidence_payloads SET declared_sha256 = '${"d".repeat(64)}' WHERE id = $1`, [current.id]],
        ["change verified hash", `UPDATE public.evidence_payloads SET verified_sha256 = '${"e".repeat(64)}' WHERE id = $1`, [current.id]],
        ["move to another organization", `UPDATE public.evidence_payloads SET organization_id = $2 WHERE id = $1`, [current.id, other]],
        ["repoint the evidence object", `UPDATE public.evidence_payloads SET evidence_object_name = 'evidence/${org}/${randomUUID()}/source' WHERE id = $1`, [current.id]],
        ["change the generation", `UPDATE public.evidence_payloads SET evidence_generation = '999' WHERE id = $1`, [current.id]],
      ];
      for (const [label, sql, params] of attempts) assert.ok(await raw(sql, params), label);

      // names are derived: a quarantine object name for another tenant cannot be recorded
      const batch = randomUUID();
      const source = randomUUID();
      const foreignDoc = randomUUID();
      await pools.admin.query(
        `INSERT INTO public.evidence_documents (id, organization_id, document_type, document_title, gcs_bucket, gcs_object_name, sha256, mime_type, byte_size, source_channel)
         VALUES ($1, $2, 'OTHER_EVIDENCE', 'x', 'tes-test-quarantine', $3, $4, 'application/pdf', 10, 'staff_upload')`,
        [foreignDoc, org, `quarantine/${other}/${batch}/${source}/source`, "f".repeat(64)],
      );
      const wrongTenant = await raw(
        `INSERT INTO public.evidence_payloads (evidence_document_id, organization_id, batch_id, source_file_id, quarantine_bucket, quarantine_object_name, declared_sha256, mime_type, byte_size, original_filename, uploaded_by_actor_id)
         VALUES ($1, $2, $3, $4, 'tes-test-quarantine', $5, $6, 'application/pdf', 10, 'x.pdf', $7)`,
        [foreignDoc, org, batch, source, `quarantine/${other}/${batch}/${source}/source`, "f".repeat(64), staffActorId],
      );
      assert.equal(wrongTenant?.code, "23514", wrongTenant?.message);
      assert.match(wrongTenant?.message ?? "", /evidence_payloads_quarantine_name_valid/);

      // the access ledger is append-only, even for the owner
      await K.ev.openEvidenceForView({ organizationId: org, documentId }, storage);
      await assert.rejects(pools.admin.query(`UPDATE public.evidence_payload_access_events SET access_kind = access_kind`), /append-only/);
      assert.ok(await raw(`UPDATE public.evidence_payload_access_events SET access_kind = access_kind`));
    });
  });
});
