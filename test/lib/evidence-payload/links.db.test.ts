// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Canonical evidence ASSOCIATION (lib/evidence-payload/links.ts over public.evidence_links, migration 0030), through the REAL authorization
// wrappers, the RUNTIME role (row-level security applies) and the real Master Register. Documents are seeded payload-backed rows
// (stored / quarantined) built only with valid lifecycle transitions; targets are created through their own domain services.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    seed: await import("@/test/helpers/evidence-payload-fixtures"),
    sys: await import("@/lib/auth/tes-system-context"),
    ev: await import("@/lib/evidence-payload/service"),
    defs: await import("@/lib/evidence-payload/definitions"),
    registry: await import("@/lib/master-register/event-types"),
    oa: await import("@/lib/operating-authorities/service"),
    tr: await import("@/lib/tax-registrations/service"),
    insurance: await import("@/lib/insurance/service"),
    oi: await import("@/lib/operational-identity/service"),
    route: await import("@/app/api/companies/[id]/evidence/[documentId]/route"),
    collection: await import("@/app/api/companies/[id]/evidence/route"),
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

const FULL = [
  "EVIDENCE_READ", "EVIDENCE_MANAGE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ",
  "INSURANCE_MANAGE", "INSURANCE_READ", "VEHICLE_MANAGE", "VEHICLE_READ", "DRIVER_MANAGE", "DRIVER_READ",
];
type Table = "organizations" | "operating_authorities" | "registrations" | "insurance_policies" | "organization_vehicle_relationships" | "organization_driver_relationships";

describe("evidence associations (public.evidence_links): canonical, tenant-scoped, audited", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  let actorId = "";
  const run = randomUUID().replace(/\D/g, "").slice(0, 6).padEnd(6, "5");
  let counter = 0;
  const n = () => ++counter;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
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
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `EVL ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const rejectsWith = (promise: Promise<unknown>, name: string) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof Error && error.name === name, `expected ${name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const notFound = (p: Promise<unknown>) => rejectsWith(p, "EvidenceNotFoundError");
  const badState = (p: Promise<unknown>) => rejectsWith(p, "EvidenceStateError");
  const invalid = (p: Promise<unknown>) => rejectsWith(p, "EvidenceValidationError");
  const denied = (p: Promise<unknown>) => rejectsWith(p, "TesAuthorizationDeniedError");

  /** A stored, payload-backed document (status 'received' unless given). */
  const document = (organizationId: string, status: "received" | "classified" | "verified" = "received") =>
    K.seed.seedPayloadBackedDocument(pools.admin, { organizationId, actorId, documentType: "OTHER_EVIDENCE", status, stage: "stored" });

  /** One real target of every supported kind for an organization, created through the domain services (needs the FULL actor). */
  async function targets(organizationId: string): Promise<Record<Table, string>> {
    const insurer = await organization("insurer");
    const authority = await K.oa.createAuthority({ organizationId, kind: "USDOT", number: `${run}${n()}`.padEnd(7, "1").slice(0, 8) });
    const registration = await K.tr.createRegistration({ organizationId, program: "NY_HUT", number: `NY${run}${n()}` });
    const policy = await K.insurance.createPolicy({ organizationId, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: `POL-${run}-${n()}`, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [{ coverageType: "AUTO_LIABILITY", limitAmount: "1000000", currency: "CAD" }] });
    const vehicle = await K.oi.createVehicleForOrganization({ vehicleTypeCode: "TRUCK_TRACTOR", vin: `1HG${run}${String(n()).padStart(8, "0")}` }, { organizationId, relationshipType: "OPERATES", unitNumber: `T-${n()}`, effectiveFrom: new Date(Date.now() - 60_000).toISOString() });
    const driver = await K.oi.createDriver({ organizationId, givenName: "Ev", familyName: `Driver${n()}`, email: `ev.${run}.${n()}@example.test`, phone: `+1403555${String(1000 + (n() % 9000)).padStart(4, "0")}`, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2024-01-01" });
    return {
      organizations: organizationId,
      operating_authorities: (authority as { view: { authority: { id: string } } }).view.authority.id,
      registrations: (registration as { view: { registration: { id: string } } }).view.registration.id,
      insurance_policies: (policy as unknown as { policy: { id: string } }).policy?.id ?? (policy as unknown as { id: string }).id,
      organization_vehicle_relationships: vehicle.relationship.relationshipId,
      organization_driver_relationships: driver.relationshipId,
    };
  }

  const associate = (organizationId: string, documentId: string, targetTable: string, targetId: string, relationshipType?: string) =>
    K.ev.associateEvidenceWithRecord({ organizationId, documentId, targetTable, targetId, relationshipType });
  const links = (documentId: string) => count(`SELECT count(*) FROM public.evidence_links WHERE evidence_document_id = $1`, [documentId]);
  const events = async (type: string) => (await pools.admin.query(`SELECT * FROM public.master_register_events WHERE event_type = $1 AND actor_id = $2::uuid ORDER BY recorded_at`, [type, actorId])).rows;

  it("associates a stored document with every supported kind of record of the same organization, and verifies nothing", async () => {
    await signInWith(...FULL);
    const org = await organization("all");
    const t = await targets(org);
    const doc = await document(org);
    const before = (await pools.admin.query(`SELECT document_status, updated_at::text FROM public.evidence_documents WHERE id = $1`, [doc])).rows[0];
    for (const table of Object.keys(t) as Table[]) {
      const result = await associate(org, doc, table, t[table]);
      assert.equal(result.created, true, table);
      assert.equal(result.link.targetTable, table);
      assert.equal(result.link.targetId, t[table]);
      assert.equal(result.link.relationshipType, "supports");
      assert.equal(result.link.status, "active");
      const row = (await pools.admin.query(`SELECT organization_id FROM public.evidence_links WHERE id = $1`, [result.link.linkId])).rows[0];
      assert.equal(row.organization_id, org, "the association belongs to the requesting organization");
    }
    const after = (await pools.admin.query(`SELECT document_status, updated_at::text FROM public.evidence_documents WHERE id = $1`, [doc])).rows[0];
    assert.deepEqual(after, before, "association changes neither the document's review status nor its record");
    assert.equal(after.document_status, "received", "attached evidence is not verification");
    assert.equal(await links(doc), 6);
  });

  it("records one EVIDENCE_ASSOCIATED event per new association, in the same transaction, with references and no content", async () => {
    await signInWith(...FULL);
    const org = await organization("mr");
    const t = await targets(org);
    const doc = await document(org);
    const before = (await events("EVIDENCE_ASSOCIATED")).length;
    const made = await associate(org, doc, "insurance_policies", t.insurance_policies);
    const recorded = (await events("EVIDENCE_ASSOCIATED")).slice(before);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].target.resourceType, "evidence_link");
    assert.equal(recorded[0].target.resourceId, made.link.linkId);
    assert.ok(recorded[0].target.subjectReferences.includes(`organization:${org}`));
    assert.ok(recorded[0].target.subjectReferences.includes(`insurance_policies:${t.insurance_policies}`));
    const raw = JSON.stringify(recorded[0]);
    assert.ok(!raw.includes("fixture.pdf") && !raw.includes("OTHER_EVIDENCE fixture"), "no filename or title in the register");
    // a repeat writes nothing
    await associate(org, doc, "insurance_policies", t.insurance_policies);
    assert.equal((await events("EVIDENCE_ASSOCIATED")).length, before + 1);
  });

  it("is idempotent: a repeat returns the same association, even concurrently; a different relationship type is a separate association", async () => {
    await signInWith(...FULL);
    const org = await organization("idem");
    const t = await targets(org);
    const doc = await document(org);
    const first = await associate(org, doc, "operating_authorities", t.operating_authorities);
    const again = await associate(org, doc, "operating_authorities", t.operating_authorities);
    assert.equal(again.created, false);
    assert.equal(again.link.linkId, first.link.linkId);
    const race = await Promise.all([1, 2, 3].map(() => associate(org, doc, "registrations", t.registrations)));
    assert.equal(race.filter((r) => r.created).length, 1, "exactly one concurrent request creates it");
    assert.equal(new Set(race.map((r) => r.link.linkId)).size, 1);
    const source = await associate(org, doc, "operating_authorities", t.operating_authorities, "source");
    assert.equal(source.created, true);
    assert.equal(await count(`SELECT count(*) FROM public.evidence_links WHERE evidence_document_id = $1 AND link_status = 'active'`, [doc]), 3);
  });

  it("tenant isolation: another organization's document or target is 'not found', and nothing is written", async () => {
    await signInWith(...FULL);
    const a = await organization("iso-a");
    const b = await organization("iso-b");
    const ta = await targets(a);
    const tb = await targets(b);
    const docA = await document(a);
    const before = await count(`SELECT count(*) FROM public.evidence_links`);
    await notFound(associate(b, docA, "operating_authorities", tb.operating_authorities));          // A's document through B
    for (const table of Object.keys(tb) as Table[]) await notFound(associate(a, docA, table, tb[table])); // B's records through A
    await notFound(associate(a, docA, "operating_authorities", randomUUID()));                    // nonexistent: same answer
    await notFound(associate(a, docA, "organizations", b));                                      // another organization as the target
    assert.equal(await count(`SELECT count(*) FROM public.evidence_links`), before);
    // the same records for the right organization work
    assert.equal((await associate(a, docA, "operating_authorities", ta.operating_authorities)).created, true);
  });

  it("global identities and unsupported kinds are rejected as targets", async () => {
    await signInWith(...FULL);
    const org = await organization("global");
    const t = await targets(org);
    const doc = await document(org);
    const globalVehicle = (await pools.admin.query(`SELECT vehicle_id FROM public.organization_vehicle_relationships WHERE id = $1`, [t.organization_vehicle_relationships])).rows[0].vehicle_id;
    const person = (await pools.admin.query(`SELECT person_id FROM public.organization_driver_relationships WHERE id = $1`, [t.organization_driver_relationships])).rows[0].person_id;
    for (const [table, id] of [["vehicles", globalVehicle], ["driver_profiles", person], ["persons", person], ["company_credentials", randomUUID()], ["credential_systems", randomUUID()], ["customer_contracts", randomUUID()], ["customer_engagements", randomUUID()], ["bogus_table", randomUUID()]] as const) {
      await invalid(associate(org, doc, table, id));
    }
    await invalid(associate(org, doc, "operating_authorities", "not-a-uuid"));
    await invalid(associate(org, doc, "operating_authorities", t.operating_authorities, "contract_attachment")); // reserved relationship types
    assert.equal(await links(doc), 0);
  });

  it("only a stored, non-archived, non-rejected document can receive an association", async () => {
    await signInWith(...FULL);
    const org = await organization("life");
    const t = await targets(org);
    const quarantined = await K.seed.seedPayloadBackedDocument(pools.admin, { organizationId: org, actorId, documentType: "OTHER_EVIDENCE", stage: "quarantined" });
    await badState(associate(org, quarantined, "organizations", org));
    const blocked = await K.seed.seedPayloadBackedDocument(pools.admin, { organizationId: org, actorId, documentType: "OTHER_EVIDENCE", stage: "quarantined" });
    await K.ev.blockEvidence({ organizationId: org, documentId: blocked });
    await badState(associate(org, blocked, "organizations", org));
    const archived = await document(org);
    await K.ev.archiveEvidence({ organizationId: org, documentId: archived });
    await badState(associate(org, archived, "organizations", org));
    const rejected = await document(org);
    await K.ev.reviewEvidence({ organizationId: org, documentId: rejected, decision: "rejected" });
    await badState(associate(org, rejected, "organizations", org));
    const replaced = await document(org);
    await pools.admin.query(`UPDATE public.evidence_payloads SET lifecycle_state = 'superseded' WHERE evidence_document_id = $1`, [replaced]);
    await badState(associate(org, replaced, "organizations", org));
    for (const status of ["received", "classified", "verified"] as const) {
      const ok = await document(org, status);
      assert.equal((await associate(org, ok, "operating_authorities", t.operating_authorities)).created, true, status);
    }
    assert.equal(await count(`SELECT count(*) FROM public.evidence_links WHERE evidence_document_id = ANY($1::uuid[])`, [[quarantined, blocked, archived, rejected, replaced]]), 0);
  });

  it("a record that was corrected or voided cannot receive new evidence", async () => {
    await signInWith(...FULL);
    const org = await organization("corrected");
    const t = await targets(org);
    const doc = await document(org);
    await K.oi.correctVehicleUnitNumber({ organizationId: org, relationshipId: t.organization_vehicle_relationships, unitNumber: `FIX-${n()}` });
    await badState(associate(org, doc, "organization_vehicle_relationships", t.organization_vehicle_relationships));
    assert.equal(await links(doc), 0);
  });

  it("capabilities: no capability and read-only cannot associate; the target domain's read capability is also required; denial is checked before anything is disclosed", async () => {
    await signInWith(...FULL);
    const org = await organization("auth");
    const t = await targets(org);
    const doc = await document(org);
    await signInWith();
    await denied(associate(org, doc, "operating_authorities", t.operating_authorities));
    await denied(K.ev.listEvidenceAssociations({ organizationId: org, documentId: doc }));
    await signInWith("EVIDENCE_READ");
    await denied(associate(org, doc, "operating_authorities", t.operating_authorities));
    assert.deepEqual(await K.ev.listEvidenceAssociations({ organizationId: org, documentId: doc }), []);
    await signInWith("EVIDENCE_READ", "EVIDENCE_MANAGE"); // manages evidence but reads no domain
    for (const table of Object.keys(t) as Table[]) await denied(associate(org, doc, table, t[table]));
    await denied(associate(org, doc, "insurance_policies", randomUUID())); // a missing target is not revealed to an actor who may not see the domain
    await signInWith("EVIDENCE_READ", "EVIDENCE_MANAGE", "ORGANIZATION_REGISTRY_READ"); // authorities yes, insurance no
    assert.equal((await associate(org, doc, "operating_authorities", t.operating_authorities)).created, true);
    await denied(associate(org, doc, "insurance_policies", t.insurance_policies));
    assert.equal(await links(doc), 1);
  });

  it("archive: the row is kept and flagged, the document is untouched, EVIDENCE_ASSOCIATION_REMOVED is recorded, and the history stays readable", async () => {
    await signInWith(...FULL);
    const org = await organization("archive");
    const t = await targets(org);
    const doc = await document(org, "verified");
    const first = await associate(org, doc, "operating_authorities", t.operating_authorities);
    const docBefore = (await pools.admin.query(`SELECT document_status, archived_at FROM public.evidence_documents WHERE id = $1`, [doc])).rows[0];
    const removedBefore = (await events("EVIDENCE_ASSOCIATION_REMOVED")).length;
    const archived = await K.ev.archiveEvidenceAssociation({ organizationId: org, documentId: doc, linkId: first.link.linkId });
    assert.equal(archived.status, "archived");
    assert.ok(archived.archivedAt);
    const row = (await pools.admin.query(`SELECT link_status, archived_at, evidence_document_id, target_table, target_id FROM public.evidence_links WHERE id = $1`, [first.link.linkId])).rows[0];
    assert.equal(row.link_status, "archived");
    assert.ok(row.archived_at);
    assert.deepEqual([row.evidence_document_id, row.target_table, row.target_id], [doc, "operating_authorities", t.operating_authorities], "the row is not repointed");
    assert.deepEqual((await pools.admin.query(`SELECT document_status, archived_at FROM public.evidence_documents WHERE id = $1`, [doc])).rows[0], docBefore, "the document is unchanged");
    const removed = (await events("EVIDENCE_ASSOCIATION_REMOVED")).slice(removedBefore);
    assert.equal(removed.length, 1);
    assert.equal(removed[0].target.resourceId, first.link.linkId);
    await badState(K.ev.archiveEvidenceAssociation({ organizationId: org, documentId: doc, linkId: first.link.linkId }));
    assert.equal((await events("EVIDENCE_ASSOCIATION_REMOVED")).length, removedBefore + 1, "no event for a refused archive");
    // history: not in the active list, present with includeArchived; a new association is a new row
    assert.equal((await K.ev.listEvidenceAssociations({ organizationId: org, documentId: doc })).length, 0);
    assert.equal((await K.ev.listEvidenceAssociations({ organizationId: org, documentId: doc, includeArchived: true })).length, 1);
    const again = await associate(org, doc, "operating_authorities", t.operating_authorities);
    assert.equal(again.created, true);
    assert.notEqual(again.link.linkId, first.link.linkId);
    assert.equal(await links(doc), 2);
    // the runtime role cannot delete
    const error = await K.sys.withAuthorizedSystem("EVIDENCE_MANAGE", async (client) => {
      try {
        await client.query(`DELETE FROM public.evidence_links WHERE id = $1`, [first.link.linkId]);
        return null;
      } catch (e) {
        return e as Error;
      }
    });
    assert.ok(error, "DELETE on evidence_links is refused");
  });

  it("archive is scoped: another organization, or the wrong document, cannot archive an association; archiving needs EVIDENCE_MANAGE", async () => {
    await signInWith(...FULL);
    const a = await organization("arch-a");
    const b = await organization("arch-b");
    const ta = await targets(a);
    const docA = await document(a);
    const otherDoc = await document(a);
    const link = await associate(a, docA, "operating_authorities", ta.operating_authorities);
    await notFound(K.ev.archiveEvidenceAssociation({ organizationId: b, documentId: docA, linkId: link.link.linkId }));
    await notFound(K.ev.archiveEvidenceAssociation({ organizationId: a, documentId: otherDoc, linkId: link.link.linkId }));
    await notFound(K.ev.archiveEvidenceAssociation({ organizationId: a, documentId: docA, linkId: randomUUID() }));
    await signInWith("EVIDENCE_READ");
    await denied(K.ev.archiveEvidenceAssociation({ organizationId: a, documentId: docA, linkId: link.link.linkId }));
    assert.equal(await count(`SELECT count(*) FROM public.evidence_links WHERE id = $1 AND link_status = 'active'`, [link.link.linkId]), 1);
  });

  it("reads: by document and by target, always limited to the organization", async () => {
    await signInWith(...FULL);
    const a = await organization("read-a");
    const b = await organization("read-b");
    const ta = await targets(a);
    const doc1 = await document(a);
    const doc2 = await document(a);
    await associate(a, doc1, "insurance_policies", ta.insurance_policies);
    await associate(a, doc2, "insurance_policies", ta.insurance_policies);
    await associate(a, doc1, "registrations", ta.registrations);
    assert.equal((await K.ev.listEvidenceAssociations({ organizationId: a, documentId: doc1 })).length, 2);
    const byTarget = await K.ev.listEvidenceAssociations({ organizationId: a, targetTable: "insurance_policies", targetId: ta.insurance_policies });
    assert.deepEqual(byTarget.map((l) => l.documentId).sort(), [doc1, doc2].sort());
    for (const view of byTarget) assert.ok(!JSON.stringify(view).match(/gcs|bucket|object|generation|sha256/i), "no storage detail in the view");
    // another organization sees nothing, by document or by target
    assert.deepEqual(await K.ev.listEvidenceAssociations({ organizationId: b, documentId: doc1 }), []);
    assert.deepEqual(await K.ev.listEvidenceAssociations({ organizationId: b, targetTable: "insurance_policies", targetId: ta.insurance_policies }), []);
    await invalid(K.ev.listEvidenceAssociations({ organizationId: a }));
    await invalid(K.ev.listEvidenceAssociations({ organizationId: a, targetTable: "vehicles", targetId: randomUUID() }));
  });

  it("API: link / archiveLink on the existing PATCH route and the association query on the existing GET route", async () => {
    await signInWith(...FULL);
    const a = await organization("api-a");
    const b = await organization("api-b");
    const ta = await targets(a);
    const tb = await targets(b);
    const doc = await document(a);
    const patch = async (organizationId: string, documentId: string, body: unknown) => {
      const response = await K.route.PATCH(new Request("http://localhost/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: organizationId, documentId }) });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    };
    const get = async (organizationId: string, query: string) => {
      const request = new Request(`http://localhost/api?${query}`) as unknown as { nextUrl: URL };
      (request as { nextUrl: URL }).nextUrl = new URL(`http://localhost/api?${query}`);
      const response = await K.collection.GET(request as never, { params: Promise.resolve({ id: organizationId }) });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    };
    const created = await patch(a, doc, { action: "link", targetTable: "operating_authorities", targetId: ta.operating_authorities });
    assert.equal(created.status, 201);
    assert.equal(created.body.link.status, "active");
    const repeat = await patch(a, doc, { action: "link", targetTable: "operating_authorities", targetId: ta.operating_authorities });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.link.linkId, created.body.link.linkId);
    assert.equal((await patch(a, doc, { action: "link", targetTable: "operating_authorities", targetId: tb.operating_authorities })).status, 404, "another company's record");
    assert.equal((await patch(b, doc, { action: "link", targetTable: "organizations", targetId: b })).status, 404, "another company's document");
    assert.equal((await patch(a, doc, { action: "link", targetTable: "vehicles", targetId: randomUUID() })).status, 400);
    assert.equal((await patch(a, doc, { action: "link", organizationId: b, targetTable: "organizations", targetId: a })).status, 201, "a body organizationId is ignored: the URL company wins");
    assert.equal(await count(`SELECT count(*) FROM public.evidence_links WHERE organization_id = $1`, [b]), 0);
    const byDoc = await get(a, `documentId=${doc}`);
    assert.equal(byDoc.status, 200);
    assert.equal(byDoc.body.links.length, 2);
    const byTarget = await get(a, `targetTable=operating_authorities&targetId=${ta.operating_authorities}`);
    assert.equal(byTarget.body.links.length, 1);
    assert.deepEqual((await get(b, `documentId=${doc}`)).body.links, []);
    const archived = await patch(a, doc, { action: "archiveLink", linkId: created.body.link.linkId });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.link.status, "archived");
    assert.equal((await patch(a, doc, { action: "archiveLink", linkId: created.body.link.linkId })).status, 409);
    await signInWith("EVIDENCE_READ", "EVIDENCE_MANAGE");
    assert.equal((await patch(a, doc, { action: "link", targetTable: "operating_authorities", targetId: ta.operating_authorities })).status, 403);
    await signInWith();
    assert.equal((await get(a, `documentId=${doc}`)).status, 403);
    K.db.setClerkUser(null);
    assert.equal((await patch(a, doc, { action: "link", targetTable: "organizations", targetId: a })).status, 403);
  });

  it("contracts: the code allowlist is inside the database allowlist, the events exist in the catalogue, and nothing reads constructor.name", async () => {
    const check = (await pools.admin.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'evidence_links_target_valid'`)).rows[0].def as string;
    for (const table of Object.keys(K.defs.EVIDENCE_LINK_TARGETS)) assert.ok(check.includes(`'${table}'`), `${table} is allowed by evidence_links_target_valid`);
    const relationships = (await pools.admin.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'evidence_links_relationship_valid'`)).rows[0].def as string;
    for (const relationship of K.defs.EVIDENCE_LINK_RELATIONSHIPS) assert.ok(relationships.includes(`'${relationship}'`));
    assert.ok("EVIDENCE_ASSOCIATED" in K.registry.EVENT_TYPE_REGISTRY && "EVIDENCE_ASSOCIATION_REMOVED" in K.registry.EVENT_TYPE_REGISTRY);
    for (const excluded of ["vehicles", "driver_profiles", "persons", "company_credentials", "credential_systems"]) assert.ok(!(excluded in K.defs.EVIDENCE_LINK_TARGETS), `${excluded} is not an association target`);
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(`${process.cwd()}/lib/evidence-payload/links.ts`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(source, /constructor\.name|localStorage|sessionStorage|indexedDB/);
  });
});
