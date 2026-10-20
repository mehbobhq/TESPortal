// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Company change accountability: the registered legal name changes ONLY through the evidence + authority gate (enforced on the server and
// backstopped by the database); sensitive channel replacements wait for confirmation through an established channel; every real change
// appends an accountable ledger row; the Company Activity shows business operations. Real authorization, transactions and Master Register.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    fixtures: await import("@/test/helpers/evidence-payload-fixtures"),
    dir: await import("@/lib/company-directory/service"),
    contacts: await import("@/lib/contacts/service"),
    changes: await import("@/lib/company-changes/service"),
    ct: await import("@/lib/contracts/service"),
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

const STAFF = [
  "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CONTACT_MANAGE", "PERSON_REGISTRY_READ",
  "COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ", "CUSTOMER_ESTABLISH",
  "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "CONTRACT_READ", "CONTRACT_MANAGE", "EVIDENCE_READ", "EVIDENCE_MANAGE",
];
const ONBOARDING = [...STAFF, "COMPANY_LEGAL_NAME_CHANGE"];
const digits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join("");

describe("Company change accountability", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 8).toUpperCase();

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
    return { actorId: actor.actorId, fx };
  }
  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pools.admin.query(sql, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
  const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(sql, params)).n);
  const refused = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as Error & { blockers?: Array<{ code: string; message: string }> };
    }
    assert.fail("expected the operation to be refused");
  };
  const legalNameOf = async (id: string) => (await one<{ legal_name: string }>(`SELECT legal_name FROM public.organizations WHERE id = $1`, [id])).legal_name;

  /** A Customer company whose Primary Contact (optionally) holds a recorded Service Decision Authority backed by a verified, stored notice. */
  const company = async (label: string, options: { authority?: boolean } = {}) => {
    const tag = `${label}${digits(4)}`;
    const created = await K.dir.createCompanyDirectoryRecord({
      companyName: `Chg ${run} ${tag} Transport Ltd`, companyType: "Customer", cargoTypes: ["General Freight"], startDate: "2024-01-15", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada",
      contactPerson: `Pat Primary${digits(3)}`, email: `accounts-${tag.toLowerCase()}@example.test`, billingEmail: `billing-${tag.toLowerCase()}@example.test`, phone: `+1 416 555 ${digits(4)}`,
      website: `https://${tag.toLowerCase()}.example.test`,
    });
    const id = created.company.id as string;
    const contacts = await K.contacts.getOrganizationContacts(id);
    const primary = contacts.contacts.find((c) => c.current.purposes.some((p) => p.purpose === "PRIMARY" && p.isPrimary))!;
    const customerId = (await one<{ id: string }>(`SELECT id FROM public.customers WHERE organization_id = $1`, [id])).id;
    const authority = options.authority === false ? null : await grantAuthority(id, customerId, primary.person.id);
    return { id, tag, primary, customerId, authority };
  };
  /** Records a customer authority through the contract-authority process itself (active, with its notice evidence). */
  const grantAuthority = async (organizationId: string, customerId: string, personId: string, type = "SERVICE_DECISION_AUTHORITY") => {
    const actorId = (await one<{ id: string }>(`SELECT id FROM public.actors ORDER BY created_at DESC LIMIT 1`)).id;
    const notice = await evidence(organizationId, actorId, "CUSTOMER_AUTHORITY_NOTICE", "verified");
    const view = await K.ct.assignCustomerAuthority({ customerId, organizationId, personId, authorityType: type, noticeEvidenceDocumentId: notice });
    return { id: view.id as string, notice };
  };
  const endAuthority = async (organizationId: string, assignmentId: string) => {
    const actorId = (await one<{ id: string }>(`SELECT id FROM public.actors ORDER BY created_at DESC LIMIT 1`)).id;
    await K.ct.revokeCustomerAuthority({ assignmentId, noticeEvidenceDocumentId: await evidence(organizationId, actorId, "CUSTOMER_AUTHORITY_NOTICE", "verified") });
  };
  const evidence = async (organizationId: string, actorId: string, documentType: string, status: "received" | "verified" = "verified", stage: "quarantined" | "stored" = "stored") =>
    K.fixtures.seedPayloadBackedDocument(pools.admin, { organizationId, actorId, documentType, status, stage });
  const request = (over: Record<string, unknown>) => ({
    requestSource: "EMAIL", requestReference: "email from the company, subject: legal name change", requestReceivedAt: new Date(Date.now() - 3600_000).toISOString(), ...over,
  });
  const legalRequest = (c: { id: string; primary: any }, name: string, over: Record<string, unknown> = {}) =>
    K.changes.requestLegalNameChange({ organizationId: c.id, requestedLegalName: name, requestedByPersonId: c.primary.person.id, requesterRelationshipId: c.primary.relationship.id, requesterBasis: "CUSTOMER_AUTHORITY", ...request({}), ...over });
  const registerEvents = (companyId: string) => count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%' || $1 || '%'`, [companyId]);

  describe("registered legal name", () => {
    it("is not editable through the ordinary company edit: a different name is refused on the server, the same name is a no-op", async () => {
      await signInWith(...ONBOARDING);
      const { id } = await company("A");
      const before = await legalNameOf(id);
      const error = await refused(K.dir.editCompany(id, { companyName: `${before} Renamed` }));
      assert.match(error.message, /legal-name change procedure/i);
      assert.equal(await legalNameOf(id), before);
      await K.dir.editCompany(id, { companyName: before });
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_change_records WHERE organization_id = $1`, [id]), 0, "an unchanged name records nothing");
    });

    it("a pending request records the ask but never changes the canonical legal name", async () => {
      const { actorId } = await signInWith(...STAFF);
      const c = await company("B");
      const before = await legalNameOf(c.id);
      const pending = await legalRequest(c, "Renamed Holdings Inc.");
      assert.deepEqual([pending.status, pending.previousLegalName, pending.requestedLegalName, pending.requesterBasis], ["PENDING", before, "Renamed Holdings Inc.", "CUSTOMER_AUTHORITY"]);
      assert.equal(pending.requesterAuthorityAssignmentId, c.authority!.id, "the request is bound to the recorded authority assignment");
      assert.equal(await legalNameOf(c.id), before, "the canonical legal name is untouched while the request is pending");
      assert.match((await refused(legalRequest(c, "Another Name Ltd"))).message, /already pending/i);
      const ledger = await rows<{ operation_code: string }>(`SELECT operation_code FROM public.company_change_records WHERE organization_id = $1`, [c.id]);
      assert.deepEqual(ledger.map((r) => r.operation_code), ["LEGAL_NAME_CHANGE_REQUESTED"]);
      assert.ok(actorId);
    });

    it("execution is refused, with every blocker listed and the name untouched, until BOTH evidence links exist and are verified, stored and of the right type", async () => {
      await signInWith(...ONBOARDING);
      const c = await company("C");
      const { id } = c;
      const before = await legalNameOf(id);
      const pending = await legalRequest(c, "Evidence Gate Ltd");
      const exec = (extra: Record<string, unknown> = {}) => K.changes.applyLegalNameChange({ organizationId: id, requestId: pending.id, effectiveDate: "2026-10-01", ...extra });

      let error = await refused(exec());
      assert.deepEqual(error.blockers?.map((b) => b.code).sort(), ["GOVERNMENT_DOCUMENT_MISSING", "WRITTEN_REQUEST_MISSING"]);
      assert.equal(await legalNameOf(id), before);

      const actorId = (await one<{ id: string }>(`SELECT id FROM public.actors ORDER BY created_at DESC LIMIT 1`)).id;
      const unverified = await evidence(id, actorId, "GOVERNMENT_NAME_DOCUMENT", "received");
      const wrongType = await evidence(id, actorId, "OTHER_EVIDENCE");
      const quarantined = await evidence(id, actorId, "COMPANY_WRITTEN_REQUEST", "verified", "quarantined");
      await K.changes.attachLegalNameEvidence({ organizationId: id, requestId: pending.id, role: "GOVERNMENT_DOCUMENT", documentId: unverified });
      await K.changes.attachLegalNameEvidence({ organizationId: id, requestId: pending.id, role: "WRITTEN_REQUEST", documentId: quarantined });
      error = await refused(exec());
      assert.deepEqual(error.blockers?.map((b) => b.code).sort(), ["GOVERNMENT_DOCUMENT_NOT_VERIFIED", "WRITTEN_REQUEST_NOT_STORED", "WRITTEN_REQUEST_NOT_VERIFIED"]);
      await K.changes.attachLegalNameEvidence({ organizationId: id, requestId: pending.id, role: "GOVERNMENT_DOCUMENT", documentId: wrongType });
      assert.ok((await refused(exec())).blockers?.some((b) => b.code === "GOVERNMENT_DOCUMENT_WRONG_TYPE"));
      assert.equal(await legalNameOf(id), before, "still unchanged");

      // another company's document can never be linked
      const other = await company("C2");
      const foreign = await evidence(other.id, actorId, "GOVERNMENT_NAME_DOCUMENT");
      assert.match((await refused(K.changes.attachLegalNameEvidence({ organizationId: id, requestId: pending.id, role: "GOVERNMENT_DOCUMENT", documentId: foreign }))).message, /not found for this company/i);
    });

    it("FINDING 1: a Primary Contact designation alone authorizes nothing; the requester must hold a recorded customer authority (or be a Director with a verified document)", async () => {
      const { actorId } = await signInWith(...ONBOARDING);
      const c = await company("D", { authority: false });
      const { id, primary } = c;
      const before = await legalNameOf(id);
      assert.ok(primary.current.purposes.some((p: any) => p.purpose === "PRIMARY" && p.isPrimary), "the requester IS the designated Primary Contact");

      // refused at request time: no authority recorded; the removed PRIMARY_CONTACT basis is not accepted either
      const noAuthority = await refused(legalRequest(c, "Primary Only Ltd"));
      assert.equal(noAuthority.name, "CompanyChangeValidationError");
      assert.match(noAuthority.message, /does not currently hold a Service Decision Authority or Contract Signatory/i);
      assert.match((await refused(legalRequest(c, "Primary Only Ltd", { requesterBasis: "PRIMARY_CONTACT" }))).message, /requesterBasis must be one of/i);
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_legal_name_change_requests WHERE organization_id = $1`, [id]), 0, "nothing was recorded");

      // a Director with only a title (no verification document) is not authorized either
      const dana = (await K.contacts.createContact({ organizationId: id, name: { givenName: "Dana", familyName: "Director" }, titles: ["Director"] })).contact;
      const gov = await evidence(id, actorId, "GOVERNMENT_NAME_DOCUMENT");
      const written = await evidence(id, actorId, "COMPANY_WRITTEN_REQUEST");
      const titled = await K.changes.requestLegalNameChange({ organizationId: id, requestedLegalName: "Director Title Ltd", requestedByPersonId: dana.person.id, requesterRelationshipId: dana.relationship.id, requesterBasis: "VERIFIED_DIRECTOR", ...request({}), governmentEvidenceDocumentId: gov, writtenRequestEvidenceDocumentId: written });
      assert.ok((await refused(K.changes.applyLegalNameChange({ organizationId: id, requestId: titled.id, effectiveDate: "2026-10-01" }))).blockers?.some((b) => b.code === "DIRECTOR_VERIFICATION_MISSING"));
      assert.equal(await legalNameOf(id), before);
      // a Director backed by a verified, stored document succeeds
      const directorDoc = await evidence(id, actorId, "DIRECTOR_VERIFICATION_DOCUMENT");
      await K.changes.attachLegalNameEvidence({ organizationId: id, requestId: titled.id, role: "DIRECTOR_VERIFICATION", documentId: directorDoc });
      assert.equal((await K.changes.applyLegalNameChange({ organizationId: id, requestId: titled.id, effectiveDate: "2026-10-01" })).status, "APPLIED");
      assert.equal(await legalNameOf(id), "Director Title Ltd");
    });

    it("FINDING 1: authority is re-proven when the change is executed: ended authority, an unverified notice, another company's authority, or an unreadable authority record all block it", async () => {
      const { actorId } = await signInWith(...ONBOARDING);
      const attach = async (c: { id: string }, requestId: string) => {
        await K.changes.attachLegalNameEvidence({ organizationId: c.id, requestId, role: "GOVERNMENT_DOCUMENT", documentId: await evidence(c.id, actorId, "GOVERNMENT_NAME_DOCUMENT") });
        await K.changes.attachLegalNameEvidence({ organizationId: c.id, requestId, role: "WRITTEN_REQUEST", documentId: await evidence(c.id, actorId, "COMPANY_WRITTEN_REQUEST") });
      };
      const blockers = async (c: { id: string }, requestId: string) => (await refused(K.changes.applyLegalNameChange({ organizationId: c.id, requestId, effectiveDate: "2026-10-01" }))).blockers?.map((b) => b.code) ?? [];

      // authority ended after the request
      const ended = await company("E1");
      const r1 = await legalRequest(ended, "Ended Authority Ltd");
      await attach(ended, r1.id);
      await endAuthority(ended.id, ended.authority!.id);
      assert.deepEqual(await blockers(ended, r1.id), ["REQUESTER_AUTHORITY_ENDED"]);
      assert.equal(await legalNameOf(ended.id).then((n) => n.includes("Ended Authority")), false);

      // the notice that established the authority is not verified
      const weak = await company("E2", { authority: false });
      const grant = await grantAuthority(weak.id, weak.customerId, weak.primary.person.id, "CONTRACT_SIGNATORY");
      await pools.admin.query(`UPDATE public.evidence_documents SET document_status = 'received' WHERE id = $1`, [grant.notice]);
      const r2 = await legalRequest(weak, "Weak Notice Ltd");
      assert.equal(r2.requesterAuthorityAssignmentId, grant.id, "a Contract Signatory may also ask");
      await attach(weak, r2.id);
      assert.deepEqual(await blockers(weak, r2.id), ["AUTHORITY_NOTICE_NOT_VERIFIED"]);

      // an authority holder of ANOTHER company is not a requester for this one
      const here = await company("E3", { authority: false });
      const there = await company("E4");
      const foreign = await refused(K.changes.requestLegalNameChange({ organizationId: here.id, requestedLegalName: "Borrowed Authority Ltd", requestedByPersonId: there.primary.person.id, requesterRelationshipId: there.primary.relationship.id, requesterBasis: "CUSTOMER_AUTHORITY", ...request({}) }));
      assert.match(foreign.message, /does not currently hold|not a contact/i);

      // an executor who cannot read the authority records cannot verify it
      const holder = await company("E5");
      const r5 = await legalRequest(holder, "Unreadable Authority Ltd");
      await attach(holder, r5.id);
      await signInWith(...ONBOARDING.filter((capability) => capability !== "CONTRACT_READ"));
      assert.ok((await K.changes.legalNameRequestReadiness(holder.id, r5.id)).blockers.some((b) => b.code === "AUTHORITY_UNVERIFIABLE"));
      assert.ok((await blockers(holder, r5.id)).includes("AUTHORITY_UNVERIFIABLE"));
      // a non-customer company has no authority records at all: only the Director route exists
      await signInWith(...ONBOARDING);
      const plain = (await K.dir.createCompanyDirectoryRecord({ companyName: `Plain ${run} ${digits(4)} Ltd`, companyType: "Owner Operator", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada", contactPerson: "Pat Q", email: `p${digits(5)}@example.test` })).company.id as string;
      const plainPrimary = (await K.contacts.getOrganizationContacts(plain)).contacts[0];
      assert.match((await refused(K.changes.requestLegalNameChange({ organizationId: plain, requestedLegalName: "Plain Renamed Ltd", requestedByPersonId: plainPrimary.person.id, requesterRelationshipId: plainPrimary.relationship.id, requesterBasis: "CUSTOMER_AUTHORITY", ...request({}) }))).message, /does not currently hold/i);
    });

    it("the database backstops the authority rules: no PRIMARY_CONTACT basis, an authority basis needs a recorded assignment of the same person and company", async () => {
      const { actorId } = await signInWith(...STAFF);
      const c = await company("DB");
      const other = await company("DB2");
      const insert = (basis: string, assignment: string | null, person = c.primary.person.id, rel = c.primary.relationship.id) =>
        pools.admin.query(
          `INSERT INTO public.company_legal_name_change_requests (organization_id, previous_legal_name, requested_legal_name, requested_by_person_id, requester_relationship_id, requester_basis, requester_authority_assignment_id, request_source, request_reference, request_received_at, recorded_by_actor_id)
           VALUES ($1, 'Old Name Ltd', 'New DB Name Ltd', $2, $3, $4, $5, 'EMAIL', 'a reference', now(), $6)`,
          [c.id, person, rel, basis, assignment, actorId],
        );
      await assert.rejects(insert("PRIMARY_CONTACT", null), /legal_name_requests_(basis_valid|authority_consistent)/, "the old Primary Contact basis no longer exists");
      await assert.rejects(insert("PRIMARY_CONTACT", c.authority!.id), /legal_name_requests_(basis_valid|authority_consistent)/);
      await assert.rejects(insert("CUSTOMER_AUTHORITY", null), /legal_name_requests_authority_consistent/);
      await assert.rejects(insert("VERIFIED_DIRECTOR", c.authority!.id), /legal_name_requests_authority_consistent/);
      await assert.rejects(insert("CUSTOMER_AUTHORITY", other.authority!.id), /legal_name_requests_authority_fk/, "another company's authority assignment cannot be used");
      await insert("CUSTOMER_AUTHORITY", c.authority!.id);
      await pools.admin.query(`DELETE FROM public.company_legal_name_change_requests WHERE FALSE`);
    });

    it("only an authorized Onboarding Team member (COMPANY_LEGAL_NAME_CHANGE) or the founder-level account may execute; success keeps everything accountable", async () => {
      const { actorId } = await signInWith(...STAFF);
      const c = await company("F0");
      const { id, primary } = c;
      const before = await legalNameOf(id);
      const gov = await evidence(id, actorId, "GOVERNMENT_NAME_DOCUMENT");
      const written = await evidence(id, actorId, "COMPANY_WRITTEN_REQUEST");
      const pending = await legalRequest(c, "Authorized Change Inc.", { governmentEvidenceDocumentId: gov, writtenRequestEvidenceDocumentId: written });

      // a staff member WITHOUT the capability is refused (even with every other capability)
      assert.match((await refused(K.changes.applyLegalNameChange({ organizationId: id, requestId: pending.id, effectiveDate: "2026-10-01" }))).message, /not authorized|denied/i);
      const readiness = await K.changes.legalNameRequestReadiness(id, pending.id);
      assert.deepEqual([readiness.ready, readiness.blockers.map((b) => b.code)], [false, ["EXECUTOR_NOT_AUTHORIZED"]]);
      assert.equal(await legalNameOf(id), before);

      const executor = await signInWith(...ONBOARDING);
      assert.equal((await K.changes.legalNameRequestReadiness(id, pending.id)).ready, true);
      const applied = await K.changes.applyLegalNameChange({ organizationId: id, requestId: pending.id, effectiveDate: "2026-10-01" });
      assert.equal(applied.status, "APPLIED");
      assert.equal(await legalNameOf(id), "Authorized Change Inc.");

      const record = await one<Record<string, any>>(`SELECT * FROM public.company_legal_name_change_requests WHERE id = $1`, [pending.id]);
      assert.deepEqual([record.organization_id, record.previous_legal_name, record.requested_legal_name, record.requested_by_person_id, record.requester_basis, record.requester_authority_assignment_id, record.decided_by_actor_id], [id, before, "Authorized Change Inc.", primary.person.id, "CUSTOMER_AUTHORITY", c.authority!.id, executor.actorId]);
      assert.ok(record.effective_at && record.recorded_at && record.decided_at, "effective, recorded and decision times are preserved");
      assert.equal(record.request_source, "EMAIL");
      const change = await one<Record<string, any>>(`SELECT * FROM public.company_change_records WHERE id = $1`, [record.change_record_id]);
      assert.deepEqual([change.operation_code, change.previous_value, change.new_value, change.actor_id], ["LEGAL_NAME_CHANGED", before, "Authorized Change Inc.", executor.actorId]);
      const links = await rows<{ role: string; evidence_document_id: string }>(`SELECT role, evidence_document_id FROM public.company_change_record_evidence WHERE change_record_id = $1 ORDER BY role`, [change.id]);
      assert.deepEqual(links.map((l) => [l.role, l.evidence_document_id]), [["GOVERNMENT_DOCUMENT", gov], ["WRITTEN_REQUEST", written]], "the evidence is linked to the exact change");
      const alias = await count(`SELECT count(*) AS n FROM public.organization_aliases WHERE organization_id = $1 AND alias = $2 AND upper(alias_type) = 'FORMER_NAME'`, [id, before]);
      assert.equal(alias, 1, "the previous legal name is kept as a former name");
      const event = await one<{ n: string }>(`SELECT count(*) AS n FROM public.master_register_events e WHERE e.actor_id = $1 AND e::text LIKE '%applyLegalNameChange%' AND e::text LIKE '%' || $2 || '%' AND e::text LIKE '%' || $3 || '%'`, [executor.actorId, id, gov]);
      assert.ok(Number(event.n) >= 1, "the Master Register holds the actor, the company and the evidence reference");
      assert.match((await refused(K.changes.applyLegalNameChange({ organizationId: id, requestId: pending.id, effectiveDate: "2026-10-01" }))).message, /already been decided|cannot be applied/i, "an applied request cannot be applied twice");
    });

    it("the founder-level Master Account satisfies the executor requirement", async () => {
      const { actorId, fx } = await signInWith(...STAFF);
      const c = await company("F");
      const gov = await evidence(c.id, actorId, "GOVERNMENT_NAME_DOCUMENT");
      const written = await evidence(c.id, actorId, "COMPANY_WRITTEN_REQUEST");
      const pending = await legalRequest(c, "Founder Executed Ltd", { governmentEvidenceDocumentId: gov, writtenRequestEvidenceDocumentId: written });
      await fx.master(actorId);
      assert.equal((await K.changes.applyLegalNameChange({ organizationId: c.id, requestId: pending.id, effectiveDate: "2026-10-01" })).status, "APPLIED");
    });

    it("the database backstops the service: an applied request cannot exist without the evidence links, and decided requests are frozen", async () => {
      const { actorId } = await signInWith(...STAFF);
      const c = await company("G");
      const pending = await legalRequest(c, "Backstop Ltd");
      await assert.rejects(
        pools.admin.query(`UPDATE public.company_legal_name_change_requests SET status = 'APPLIED', decided_by_actor_id = $2, decided_at = now(), effective_at = now() WHERE id = $1`, [pending.id, actorId]),
        /legal_name_requests_applied_requires_evidence/,
      );
      await assert.rejects(pools.admin.query(`UPDATE public.company_legal_name_change_requests SET requested_legal_name = 'Tampered Ltd' WHERE id = $1`, [pending.id]), /immutable/);
      await assert.rejects(pools.admin.query(`UPDATE public.company_legal_name_change_requests SET requester_basis = 'VERIFIED_DIRECTOR', requester_authority_assignment_id = NULL WHERE id = $1`, [pending.id]), /immutable/, "the basis and authority are frozen once recorded");
      await assert.rejects(pools.admin.query(`DELETE FROM public.company_legal_name_change_requests WHERE id = $1`, [pending.id]), /append-only/);
      await assert.rejects(pools.admin.query(`UPDATE public.company_change_records SET summary = 'x' WHERE organization_id = $1`, [c.id]), /append-only/);
      assert.equal(await legalNameOf(c.id).then((n) => n.includes("Backstop")), false);
    });
  });

  describe("FINDING 3: mandatory historical and accountability writes are never skipped", () => {
    /** Installs a trigger that makes one write fail (or be silently dropped), runs `work`, and always removes it again. */
    const withInjected = async (table: string, when: string, action: "RAISE" | "SKIP", work: () => Promise<void>) => {
      const fn = `tmp_inject_${randomInt(1e6)}`;
      await pools.admin.query(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${action === "RAISE" ? "RAISE EXCEPTION 'injected failure'" : "RETURN NULL"}; END; $$`);
      await pools.admin.query(`CREATE TRIGGER zz_${fn} BEFORE ${when.startsWith("UPDATE") ? "UPDATE" : "INSERT"} ON public.${table} FOR EACH ROW WHEN (${when.replace(/^(UPDATE|INSERT) /, "")}) EXECUTE FUNCTION public.${fn}()`);
      try {
        await work();
      } finally {
        await pools.admin.query(`DROP TRIGGER zz_${fn} ON public.${table}`);
        await pools.admin.query(`DROP FUNCTION public.${fn}()`);
      }
    };
    const ready = async (label: string) => {
      const { actorId } = await signInWith(...ONBOARDING);
      const c = await company(label);
      const gov = await evidence(c.id, actorId, "GOVERNMENT_NAME_DOCUMENT");
      const written = await evidence(c.id, actorId, "COMPANY_WRITTEN_REQUEST");
      const pending = await legalRequest(c, `Atomic ${label} Ltd`, { governmentEvidenceDocumentId: gov, writtenRequestEvidenceDocumentId: written });
      const snapshot = async () => JSON.stringify([await legalNameOf(c.id), await registerEvents(c.id), await count(`SELECT count(*) AS n FROM public.company_change_records WHERE organization_id = $1`, [c.id]), await count(`SELECT count(*) AS n FROM public.organization_aliases WHERE organization_id = $1`, [c.id]), (await one<{ status: string }>(`SELECT status FROM public.company_legal_name_change_requests WHERE id = $1`, [pending.id])).status]);
      return { c, pending, snapshot, apply: () => K.changes.applyLegalNameChange({ organizationId: c.id, requestId: pending.id, effectiveDate: "2026-10-01" }) };
    };

    it("if the former-name record cannot be written the legal name is NOT changed and nothing is half-saved (the failure is no longer suppressed)", async () => {
      const t = await ready("H1");
      const before = await t.snapshot();
      await withInjected("organization_aliases", "INSERT upper(NEW.alias_type) = 'FORMER_NAME'", "RAISE", async () => {
        const error = await refused(t.apply());
        assert.equal(error.name, "CompanyChangeStateError");
        assert.match(error.message, /previous legal name could not be kept as a former name/i);
      });
      assert.equal(await t.snapshot(), before, "name, register events, ledger, aliases and request status are all exactly as before");
      assert.equal((await t.apply()).status, "APPLIED", "once the fault is gone the same request completes");
    });

    it("if the request cannot be marked applied (the update touches no row) the whole change rolls back instead of reporting success", async () => {
      const t = await ready("H2");
      const before = await t.snapshot();
      await withInjected("company_legal_name_change_requests", "UPDATE NEW.status = 'APPLIED'", "SKIP", async () => {
        const error = await refused(t.apply());
        assert.equal(error.name, "CompanyChangeStateError");
        assert.match(error.message, /could not be marked applied; nothing was saved/i);
      });
      assert.equal(await t.snapshot(), before);
    });

    it("if the accountability ledger row cannot be written the legal name is not changed", async () => {
      const t = await ready("H3");
      const before = await t.snapshot();
      await withInjected("company_change_records", "INSERT NEW.operation_code = 'LEGAL_NAME_CHANGED'", "RAISE", async () => {
        await refused(t.apply());
      });
      assert.equal(await t.snapshot(), before);
    });

    it("no accountability code swallows an error: no empty catch or ignored promise in the change services", async () => {
      for (const file of ["lib/company-changes/service.ts", "lib/company-changes/ledger.ts", "lib/company-directory/update-company.ts", "lib/company-directory/service.ts"]) {
        const source = readFileSync(path.join(process.cwd(), file), "utf8");
        assert.doesNotMatch(source, /\.catch\(\s*\(\)\s*=>\s*(undefined|null|\{\s*\})\s*\)/, `${file} must not ignore a failed write`);
        assert.doesNotMatch(source, /catch\s*(\([^)]*\))?\s*\{\s*\}/, `${file} must not have an empty catch`);
      }
    });
  });

  describe("company channels (FINDING 2: confirmation needs verified evidence, a different TES user and an established channel)", () => {
    const pendingOf = async (id: string) => (await K.changes.getCompanyActivity(id)).pending.channels[0];
    const proof = async (id: string, actorId: string, over: { type?: string; status?: "received" | "verified"; stage?: "quarantined" | "stored" } = {}) =>
      evidence(id, actorId, over.type ?? "CHANNEL_CHANGE_CONFIRMATION", over.status ?? "verified", over.stage ?? "stored");

    it("a first value is recorded directly; replacing OR removing an established value waits for confirmation and changes nothing; the sender is never trusted", async () => {
      await signInWith(...ONBOARDING);
      const { id, tag } = await company("H");
      const established = `https://${tag.toLowerCase()}.example.test`;
      const current = async () => (await K.contacts.getOrganizationContacts(id)).currentChannels.map((c) => `${c.channelType}:${c.usage}:${c.valueDisplay}`).sort();
      const before = await current();

      assert.match((await refused(K.dir.editCompany(id, { website: "https://new-site.example.test" }))).message ?? "", /Nothing was saved|could not be saved|source and reference/i);
      const result = await K.dir.editCompany(id, { website: "https://new-site.example.test", channelChangeSource: "COMPANY_WRITTEN_REQUEST", channelChangeReference: "email from info@unfamiliar-domain.test", channelChangeSender: "info@unfamiliar-domain.test" });
      assert.equal(result.details?.website, "pending_confirmation");
      assert.deepEqual(await current(), before, "the established website is still the trusted one");
      assert.ok((await current()).includes(`WEBSITE:GENERAL:${established}`));
      const activity = await K.changes.getCompanyActivity(id);
      assert.equal(activity.pending.channels.length, 1);
      assert.deepEqual([activity.pending.channels[0].changeKind, activity.pending.channels[0].senderAddress, activity.pending.channels[0].recordedByYou], ["REPLACE", "info@unfamiliar-domain.test", true]);

      // REMOVAL is a sensitive change too: it needs how it was requested, and then waits (the phone is untouched)
      assert.match((await refused(K.dir.editCompany(id, { phone: "" }))).message ?? "", /source and reference|Nothing was saved/i);
      const removal = await K.dir.editCompany(id, { phone: "", channelChangeSource: "COMPANY_WRITTEN_REQUEST", channelChangeReference: "letter asking to drop the phone" });
      assert.equal(removal.details?.channels.find((c: any) => c.field === "phone")?.action, "pending_confirmation");
      assert.deepEqual(await current(), before, "nothing was removed");
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_channel_change_requests WHERE organization_id = $1 AND status = 'PENDING_CONFIRMATION' AND change_kind = 'REMOVE'`, [id]), 1);
    });

    it("confirmation REFUSES every missing proof: no evidence, a free-text reference alone, wrong type, unverified, quarantined, older than the request, reused, or by the person who recorded the request", async () => {
      const recorder = await signInWith(...ONBOARDING);
      const { id, primary } = await company("I");
      const tooOld = await proof(id, recorder.actorId); // created BEFORE the request
      await K.dir.editCompany(id, { website: "https://replacement.example.test", channelChangeSource: "COMPANY_WRITTEN_REQUEST", channelChangeReference: "letter received", channelChangeSender: "attacker@replacement.example.test" });
      const pending = await pendingOf(id);
      const phone = (await K.contacts.getOrganizationContacts(id)).currentChannels.find((c) => c.channelType === "PHONE")!;
      const confirm = (over: Record<string, unknown>) => K.changes.confirmChannelChange({ organizationId: id, requestId: pending.id, confirmationChannelKind: "COMPANY_CHANNEL", confirmationChannelId: phone.id, confirmationMethod: "CALL_BACK", ...over });
      const codes = async (over: Record<string, unknown>) => (await refused(confirm(over))).blockers?.map((b) => b.code).sort() ?? [];
      const stillPending = async () => assert.equal((await pendingOf(id))?.id, pending.id, "the request is still pending and the established value still trusted");

      // the recorder cannot confirm their own request, whatever the evidence
      const good = await proof(id, recorder.actorId);
      assert.deepEqual(await codes({ confirmationEvidenceDocumentId: good }), ["SELF_CONFIRMATION"]);
      await stillPending();

      const confirmer = await signInWith(...ONBOARDING);
      const stranger = await company("I3");
      // a typed reference alone is nothing: the evidence document is required
      assert.match((await refused(confirm({ confirmationReference: "I called them and they agreed" }))).message, /confirmationEvidenceDocumentId must be a UUID/i);
      assert.match((await refused(confirm({ confirmationEvidenceDocumentId: randomUUID() }))).message ?? "", /not be found|CONFIRMATION_EVIDENCE|cannot be applied/i);
      assert.deepEqual(await codes({ confirmationEvidenceDocumentId: await proof(id, confirmer.actorId, { type: "OTHER_EVIDENCE" }) }), ["CONFIRMATION_EVIDENCE_WRONG_TYPE"]);
      assert.deepEqual(await codes({ confirmationEvidenceDocumentId: await proof(id, confirmer.actorId, { status: "received" }) }), ["CONFIRMATION_EVIDENCE_NOT_VERIFIED"]);
      assert.ok((await codes({ confirmationEvidenceDocumentId: await proof(id, confirmer.actorId, { stage: "quarantined" }) })).includes("CONFIRMATION_EVIDENCE_NOT_STORED"));
      assert.deepEqual(await codes({ confirmationEvidenceDocumentId: tooOld }), ["CONFIRMATION_EVIDENCE_TOO_OLD"]);
      assert.ok((await codes({ confirmationEvidenceDocumentId: await proof(stranger.id, confirmer.actorId) })).includes("CONFIRMATION_EVIDENCE_NOT_FOUND"), "another company's evidence is not found for this company");
      await stillPending();

      // the established channel rules still hold: another company's channel, and one recorded AFTER the request
      const good2 = await proof(id, confirmer.actorId);
      const otherChannel = (await K.contacts.getOrganizationContacts(stranger.id)).currentChannels[0];
      assert.match((await refused(confirm({ confirmationEvidenceDocumentId: good2, confirmationChannelId: otherChannel.id }))).message, /not a current channel of this company/i);
      const late = await K.contacts.addPersonChannel({ organizationId: id, personId: primary.person.id, channel: { type: "EMAIL", value: `late-${randomInt(1e6)}@replacement.example.test` } });
      const lateChannel = late.current.channels.find((c) => c.valueDisplay.startsWith("late-"))!;
      assert.match((await refused(confirm({ confirmationEvidenceDocumentId: good2, confirmationChannelKind: "PERSON_CHANNEL", confirmationChannelId: lateChannel.id }))).message, /recorded after the request/i);
      await stillPending();
      assert.equal(await count(`SELECT count(*) AS n FROM public.organization_channels WHERE organization_id = $1 AND channel_type = 'WEBSITE' AND effective_to IS NULL AND value_display LIKE '%replacement.example.test%'`, [id]), 0, "nothing was applied by any refused attempt");

      // all proof present, a different user, an established channel: applied
      const done = await confirm({ confirmationEvidenceDocumentId: good2, confirmationNote: "spoke to the Primary Contact on the number on file" });
      assert.equal(done.status, "APPLIED");
      assert.equal(done.confirmationEvidenceDocumentId, good2);
      const stored = await one<Record<string, any>>(`SELECT confirmation_channel_kind, confirmation_channel_id, confirmation_evidence_document_id, confirmed_by_actor_id, recorded_by_actor_id FROM public.company_channel_change_requests WHERE id = $1`, [pending.id]);
      assert.deepEqual([stored.confirmation_channel_kind, stored.confirmation_channel_id, stored.confirmation_evidence_document_id, stored.confirmed_by_actor_id === confirmer.actorId, stored.confirmed_by_actor_id !== stored.recorded_by_actor_id], ["COMPANY_CHANNEL", phone.id, good2, true, true]);
      const ledger = await one<Record<string, any>>(`SELECT id, operation_code, request_source FROM public.company_change_records WHERE organization_id = $1 AND operation_code = 'WEBSITE_UPDATED'`, [id]);
      assert.deepEqual([ledger.operation_code, ledger.request_source], ["WEBSITE_UPDATED", "VERIFIED_CHANNEL_CONFIRMATION"]);
      assert.deepEqual((await rows<{ evidence_document_id: string; role: string }>(`SELECT evidence_document_id, role FROM public.company_change_record_evidence WHERE change_record_id = $1`, [ledger.id])).map((r) => [r.evidence_document_id, r.role]), [[good2, "CONFIRMATION"]]);
      assert.ok(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%confirmChannelChange%' AND e::text LIKE '%' || $1 || '%'`, [good2])).n) >= 1, "the Master Register holds the confirmation and its evidence reference");
      const emails = await count(`SELECT count(*) AS n FROM public.organization_channels WHERE organization_id = $1 AND channel_type = 'EMAIL' AND effective_to IS NULL`, [id]);
      assert.equal(emails, 2, "a website change never changes the company's email");

      // one evidence document confirms one request, once
      await K.dir.editCompany(id, { email: "second@replacement.example.test", channelChangeSource: "STAFF_ENTRY", channelChangeReference: "second request" });
      const second = await pendingOf(id);
      const reuse = await refused(K.changes.confirmChannelChange({ organizationId: id, requestId: second.id, confirmationChannelKind: "COMPANY_CHANNEL", confirmationChannelId: phone.id, confirmationMethod: "CALL_BACK", confirmationEvidenceDocumentId: good2 }));
      assert.ok(reuse.blockers?.some((b) => b.code === "CONFIRMATION_EVIDENCE_REUSED" || b.code === "CONFIRMATION_EVIDENCE_TOO_OLD"));
    });

    it("a confirmed REMOVAL ends the value (history kept), and 'remove, then add' cannot bypass the confirmation", async () => {
      const recorder = await signInWith(...ONBOARDING);
      const { id } = await company("R");
      const phoneBefore = (await K.contacts.getOrganizationContacts(id)).currentChannels.find((c) => c.channelType === "PHONE")!;
      const account = (await K.contacts.getOrganizationContacts(id)).currentChannels.find((c) => c.channelType === "EMAIL" && c.usage === "GENERAL")!;
      await K.dir.editCompany(id, { phone: "", channelChangeSource: "COMPANY_WRITTEN_REQUEST", channelChangeReference: "letter asking to drop the phone" });
      const pending = await pendingOf(id);
      assert.equal(pending.changeKind, "REMOVE");
      await signInWith(...ONBOARDING);
      const doc = await proof(id, (await one<{ id: string }>(`SELECT id FROM public.actors ORDER BY created_at DESC LIMIT 1`)).id);
      const done = await K.changes.confirmChannelChange({ organizationId: id, requestId: pending.id, confirmationChannelKind: "COMPANY_CHANNEL", confirmationChannelId: account.id, confirmationMethod: "EMAIL_REPLY", confirmationEvidenceDocumentId: doc });
      assert.equal(done.status, "APPLIED");
      assert.equal((await K.contacts.getOrganizationContacts(id)).currentChannels.some((c) => c.channelType === "PHONE"), false, "the phone is no longer current");
      assert.equal(await count(`SELECT count(*) AS n FROM public.organization_channels WHERE id = $1 AND effective_to IS NOT NULL AND record_status = 'active'`, [phoneBefore.id]), 1, "it is ended, never deleted");
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_change_records WHERE organization_id = $1 AND operation_code = 'COMPANY_PHONE_REMOVED'`, [id]), 1);

      // setting a new phone afterwards is NOT a first value any more: it waits for confirmation
      await signInWith(...ONBOARDING);
      const readded = await K.dir.editCompany(id, { phone: "+1 905 555 0123", channelChangeSource: "STAFF_ENTRY", channelChangeReference: "re-adding the removed phone" });
      assert.equal(readded.details?.channels.find((c: any) => c.field === "phone")?.action, "pending_confirmation");
      assert.equal((await K.contacts.getOrganizationContacts(id)).currentChannels.some((c) => c.channelType === "PHONE"), false);
      assert.ok(recorder);
    });

    it("no other route changes a company channel directly: the contacts API refuses add / end of a company line, and a corrected (voided) website is not a way around it", async () => {
      const route = readFileSync(path.join(process.cwd(), "app/api/companies/[id]/contacts/route.ts"), "utf8");
      const block = route.slice(route.indexOf('case "addChannel"'), route.indexOf('case "addPersonChannel"'));
      assert.match(block, /case "endChannel":/);
      assert.match(block, /refuseDirectCompanyChannelChange/);
      assert.doesNotMatch(block, /addOrganizationChannel|endOrganizationChannel/);
      // the refusal comes AFTER authorization: a user without CONTACT_MANAGE is denied (403), an authorized one is refused (409 state error)
      await signInWith("ORGANIZATION_REGISTRY_READ", "PERSON_REGISTRY_READ");
      assert.match((await refused(K.contacts.refuseDirectCompanyChannelChange())).message, /not authorized|denied/i);
      await signInWith(...ONBOARDING);
      const state = await refused(K.contacts.refuseDirectCompanyChannelChange());
      assert.equal(state.name, "ContactStateError");
      assert.match(state.message, /Company Edit/);
      assert.doesNotMatch(readFileSync(path.join(process.cwd(), "lib/company-directory/update-company.ts"), "utf8"), /voidOrganizationChannel|endOrganizationChannel/);
      await signInWith(...ONBOARDING);
      const { id } = await company("V");
      const before = (await K.contacts.getOrganizationContacts(id)).currentChannels.map((c) => c.valueDisplay).sort();
      const attempt = await refused(K.dir.editCompany(id, { website: "", factMode: "correct" }));
      assert.match(attempt.message ?? "", /source and reference|Nothing was saved/i, "even factMode 'correct' only creates a removal request");
      assert.deepEqual((await K.contacts.getOrganizationContacts(id)).currentChannels.map((c) => c.valueDisplay).sort(), before);
    });

    it("the database backstops the service: an applied channel change cannot exist without evidence and a different confirming user", async () => {
      const recorder = await signInWith(...ONBOARDING);
      const { id } = await company("J");
      await K.dir.editCompany(id, { email: "ops@new-domain.example.test", channelChangeSource: "COMPANY_VERBAL_CONFIRMED", channelChangeReference: "caller said to switch", channelChangeSender: "primary@sender-domain.example.test" });
      const pending = await pendingOf(id);
      const phone = (await K.contacts.getOrganizationContacts(id)).currentChannels.find((c) => c.channelType === "PHONE")!;
      const doc = await proof(id, recorder.actorId);
      const change = (await one<{ id: string }>(`INSERT INTO public.company_change_records (organization_id, operation_code, summary, actor_id, effective_at) VALUES ($1, 'COMPANY_EMAIL_CHANGED', 'test', $2, now()) RETURNING id`, [id, recorder.actorId])).id;
      const apply = (over: { evidence?: string | null; confirmer?: string }) =>
        pools.admin.query(
          `UPDATE public.company_channel_change_requests SET status = 'APPLIED', applied_at = now(), change_record_id = $2, confirmation_channel_kind = 'COMPANY_CHANNEL', confirmation_channel_id = $3,
                  confirmation_method = 'CALL_BACK', confirmation_evidence_document_id = $4, confirmed_by_actor_id = $5, confirmed_at = now() WHERE id = $1`,
          [pending.id, change, phone.id, over.evidence === undefined ? doc : over.evidence, over.confirmer ?? recorder.actorId],
        );
      await assert.rejects(apply({ evidence: null, confirmer: (await signInWith(...ONBOARDING)).actorId }), /channel_requests_applied_requires_confirmation/, "no evidence document");
      await assert.rejects(apply({ confirmer: recorder.actorId }), /channel_requests_applied_requires_confirmation/, "the recorder cannot be the confirmer");
      await assert.rejects(pools.admin.query(`UPDATE public.company_channel_change_requests SET status = 'APPLIED', applied_at = now(), change_record_id = $2 WHERE id = $1`, [pending.id, change]), /channel_requests_applied_requires_confirmation/, "no confirmation at all");
    });

    it("confirmation needs CONTACT_MANAGE and evidence access; a rejected or withdrawn request keeps the established value", async () => {
      const recorder = await signInWith(...ONBOARDING);
      const { id } = await company("K");
      await K.dir.editCompany(id, { phone: "+1 604 555 0199", channelChangeSource: "STAFF_ENTRY", channelChangeReference: "staff note" });
      const pending = await pendingOf(id);
      const phone = (await K.contacts.getOrganizationContacts(id)).currentChannels.find((c) => c.channelType === "PHONE")!;
      const doc = await proof(id, recorder.actorId);
      await signInWith("ORGANIZATION_REGISTRY_READ", "PERSON_REGISTRY_READ");
      assert.match((await refused(K.changes.confirmChannelChange({ organizationId: id, requestId: pending.id, confirmationChannelKind: "COMPANY_CHANNEL", confirmationChannelId: phone.id, confirmationMethod: "IN_PERSON", confirmationEvidenceDocumentId: doc }))).message, /not authorized|denied/i);
      await signInWith("CONTACT_MANAGE", "ORGANIZATION_REGISTRY_READ", "PERSON_REGISTRY_READ");
      assert.match((await refused(K.changes.confirmChannelChange({ organizationId: id, requestId: pending.id, confirmationChannelKind: "COMPANY_CHANNEL", confirmationChannelId: phone.id, confirmationMethod: "IN_PERSON", confirmationEvidenceDocumentId: doc }))).message, /not authorized|denied|EVIDENCE_READ/i, "without evidence access the proof cannot be checked");
      await signInWith(...ONBOARDING);
      const closed = await K.changes.closeChannelChange({ organizationId: id, requestId: pending.id, outcome: "REJECTED", reason: "caller could not be confirmed" });
      assert.equal(closed.status, "REJECTED");
      assert.ok((await K.contacts.getOrganizationContacts(id)).currentChannels.some((c) => c.id === phone.id), "the established phone stays in use");
      assert.equal(closed.appliedAt, null);
    });
  });

  describe("accountable ledger and Company Activity", () => {
    it("every actual change appends a ledger row with the previous value; an unchanged value records nothing; DBA keeps its basis and evidence link", async () => {
      const { actorId } = await signInWith(...ONBOARDING);
      const { id } = await company("L");
      const doc = await evidence(id, actorId, "OTHER_EVIDENCE");
      await K.dir.editCompany(id, { dba: "Maple Haulage", dbaBasis: "REGISTRATION_EVIDENCE", dbaBasisReference: "Business Names Act registration 2026-10-01", dbaEvidenceDocumentId: doc });
      await K.dir.editCompany(id, { dba: "Maple Haulage", reg_street: "1 Main St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5V 1A1", reg_country: "Canada" });
      await K.dir.editCompany(id, { reg_street: "2 Main St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5V 1A1", reg_country: "Canada" });
      await K.dir.editCompany(id, { dba: "Maple Haulage", reg_street: "2 Main St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5V 1A1", reg_country: "Canada" });
      await K.dir.editCompany(id, { dba: "Maple Freight" });

      const ledger = await rows<Record<string, any>>(`SELECT operation_code, previous_value, new_value, basis, actor_id FROM public.company_change_records WHERE organization_id = $1 ORDER BY recorded_at, id`, [id]);
      assert.deepEqual(ledger.map((r) => r.operation_code), ["DBA_ADDED", "ADDRESS_UPDATED", "ADDRESS_UPDATED", "DBA_UPDATED"]);
      const dba = ledger.find((r) => r.operation_code === "DBA_ADDED")!;
      assert.deepEqual([dba.new_value, dba.basis, dba.actor_id], ["Maple Haulage", "REGISTRATION_EVIDENCE", actorId]);
      const update = ledger.find((r) => r.operation_code === "DBA_UPDATED")!;
      assert.deepEqual([update.previous_value, update.new_value], ["Maple Haulage", "Maple Freight"], "the previous value is retained automatically");
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_change_record_evidence WHERE organization_id = $1 AND role = 'REGISTRATION'`, [id]), 1);
      const moved = ledger.find((r) => r.operation_code === "ADDRESS_UPDATED" && r.previous_value);
      assert.match(String(moved?.previous_value), /1 Main St/);
      assert.match(String(moved?.new_value), /2 Main St/);
    });

    it("Company Activity names the business operations, links evidence only for readers of evidence, includes Primary Contact changes, and is tenant scoped", async () => {
      const { actorId } = await signInWith(...ONBOARDING);
      const a = await company("M");
      const b = await company("M2");
      const second = (await K.contacts.createContact({ organizationId: a.id, name: { givenName: "Next", familyName: "Primary" } })).contact;
      await grantAuthority(a.id, a.customerId, second.person.id);
      await K.contacts.makePrimary({ organizationId: a.id, relationshipId: second.relationship.id, purpose: "PRIMARY" });
      await K.dir.editCompany(a.id, { dba: "Activity Trading" });
      const gov = await evidence(a.id, actorId, "GOVERNMENT_NAME_DOCUMENT");
      const written = await evidence(a.id, actorId, "COMPANY_WRITTEN_REQUEST");
      const req = await K.changes.requestLegalNameChange({ organizationId: a.id, requestedLegalName: "Activity Named Ltd", requestedByPersonId: second.person.id, requesterRelationshipId: second.relationship.id, requesterBasis: "CUSTOMER_AUTHORITY", ...request({}), governmentEvidenceDocumentId: gov, writtenRequestEvidenceDocumentId: written });
      await K.changes.applyLegalNameChange({ organizationId: a.id, requestId: req.id, effectiveDate: "2026-10-01" });

      const view = await K.changes.getCompanyActivity(a.id);
      const labels = view.entries.map((e) => e.label);
      for (const expected of ["Legal Name Changed", "DBA Added", "Primary Contact Changed", "Primary Contact Designated"]) assert.ok(labels.includes(expected), `${expected} in ${labels.join(", ")}`);
      const legal = view.entries.find((e) => e.label === "Legal Name Changed")!;
      assert.deepEqual(legal.evidence.map((e) => e.role).sort(), ["GOVERNMENT_DOCUMENT", "WRITTEN_REQUEST"]);
      assert.ok(legal.evidence.every((e) => e.title !== null), "an evidence reader sees the linked documents");
      assert.equal(view.entries.some((e) => /Chg .* M2/.test(e.summary + (e.newValue ?? ""))), false);
      assert.equal((await K.changes.getCompanyActivity(b.id)).entries.some((e) => e.operation === "LEGAL_NAME_CHANGED"), false, "tenant isolation");

      await signInWith("ORGANIZATION_REGISTRY_READ");
      const limited = await K.changes.getCompanyActivity(a.id);
      assert.ok(limited.entries.find((e) => e.label === "Legal Name Changed")!.evidence.every((e) => e.title === null), "without evidence access the link is shown but not the document");
      assert.equal(limited.entries.some((e) => e.group === "contacts"), false, "people-registry data is withheld");
      await signInWith();
      assert.match((await refused(K.changes.getCompanyActivity(a.id))).message, /not authorized|denied/i);
    });
  });
});
