// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Migration 0031 (Contracts foundation) and the Contracts service, through the REAL authorization wrappers and the RUNTIME
// role (row-level security applies), with the real Master Register. Fixtures use the admin (table owner) pool. The second
// half drives the RUNTIME role directly (inside an authorized CONTRACT_MANAGE transaction) to prove the database refuses
// every route around the service: raw status writes, un-noticed authority changes, second active holders, deletes.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    sys: await import("@/lib/auth/tes-system-context"),
    authz: await import("@/lib/auth/tes-authorization"),
    ct: await import("@/lib/contracts/service"),
    cr: await import("@/lib/customer-relationship/service"),
    cp: await import("@/lib/company-profile/service"),
    co: await import("@/lib/contacts/service"),
    ev: await import("@/lib/evidence-payload/service"),
    fx: await import("@/test/helpers/evidence-payload-fixtures"),
    dir: await import("@/lib/company-directory/service"),
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

const MONTH = (m: number) => `2020-${String(m).padStart(2, "0")}-01T00:00:00Z`;
type PgError = Error & { code?: string };

const STAFF_CAPABILITIES = [
  "CONTRACT_READ", "CONTRACT_MANAGE", "EVIDENCE_READ", "EVIDENCE_MANAGE", "CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_READ",
  "CUSTOMER_RELATIONSHIP_MANAGE", "COMPANY_PROFILE_READ", "COMPANY_PROFILE_MANAGE", "CONTACT_MANAGE", "PERSON_REGISTRY_READ",
  "MASTER_REGISTER_READ",
];

describe("Contracts foundation (migration 0031, real authorization, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 8).toUpperCase();
  let staffActorId = "";

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

  type World = {
    organizationId: string;
    customerId: string;
    engagementId: string;
    scopeId: string;
    personA: string;
    personB: string;
  };

  async function evidence(organizationId: string, documentType: string, over: { status?: string; expiresAt?: string | null; organization?: string } = {}): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(
      `INSERT INTO public.evidence_documents
        (id, organization_id, document_type, document_title, document_status, gcs_bucket, gcs_object_name, sha256, mime_type, byte_size, source_channel, expires_at, archived_at)
       VALUES ($1, $2, $3, $4, $5, 'tes-test-evidence', $6, $7, 'application/pdf', 1024, 'staff_upload', $8::date, NULL)`,
      [id, over.organization ?? organizationId, documentType, `${documentType} ${run}`, over.status ?? "verified", `contracts/${run}/${id}.pdf`, "a".repeat(64), over.expiresAt ?? null],
    );
    return id;
  }

  async function world(options: { settings?: boolean; responsibility?: boolean } = {}): Promise<World> {
    const organizationId = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [organizationId, `Contracts ${run} ${organizationId.slice(0, 6)}`]);
    const established = await K.cr.establishCustomerRelationship({ organizationId, engagementType: "RECURRING", stage: "ONBOARDING", startedAt: MONTH(1) });
    const engagementId = established.engagement.engagement.id;
    const withScope = await K.cr.addScope({ engagementId, productLevel: "COMPLIANCE", effectiveFrom: MONTH(2) });
    const scopeId = withScope.current.scopes[0].id;
    if (options.responsibility !== false) await K.cr.assumeResponsibility({ scopeId, effectiveFrom: MONTH(3) });
    if (options.settings !== false) {
      await K.cp.setOperatingScope({ organizationId, operatingScope: "CANADA", effectiveFrom: MONTH(2) });
      await K.cp.setDriverRequirements({ organizationId, minimumDriverAgeYears: 23, minimumDriverExperienceMonths: 24, effectiveFrom: MONTH(2) });
    }
    const person = async (given: string) => {
      const created = await K.co.createContact({ organizationId, name: { givenName: given, familyName: `Holder${run}` }, effectiveFrom: MONTH(1) } as never);
      return created.contact.person.id as string;
    };
    return { organizationId, customerId: established.customer.id, engagementId, scopeId, personA: await person("Alex"), personB: await person("Blair") };
  }

  const assign = (w: World, personId: string, authorityType: "SERVICE_DECISION_AUTHORITY" | "CONTRACT_SIGNATORY", noticeEvidenceDocumentId: string) =>
    K.ct.assignCustomerAuthority({ customerId: w.customerId, organizationId: w.organizationId, personId, authorityType, noticeEvidenceDocumentId });

  async function assignBoth(w: World, person: string = w.personA) {
    const notice = await evidence(w.organizationId, "CUSTOMER_AUTHORITY_NOTICE");
    const sda = await assign(w, person, "SERVICE_DECISION_AUTHORITY", notice);
    const signatory = await assign(w, person, "CONTRACT_SIGNATORY", notice);
    return { notice, sda, signatory };
  }

  const rejectsWith = (promise: Promise<unknown>, ctor: new (...args: never[]) => Error) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ctor, `expected ${ctor.name}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return true;
    });

  async function workspace(w: World) {
    return K.ct.getContractsWorkspace(w.organizationId);
  }

  async function newDraft(w: World, reference = `CTR-${run}-${Math.floor(Math.random() * 1e6)}`): Promise<string> {
    await K.ct.createContractDraft(w.organizationId, { contractReference: reference });
    const ws = await workspace(w);
    return ws.contracts[0].id;
  }

  /** Builds a fully ready contract (every gate satisfied) and returns its ids. */
  async function readyDraft(w: World) {
    const { notice } = await assignBoth(w);
    await K.ct.definePackage(w.organizationId, { packageCode: `PKG_${run}_${Math.floor(Math.random() * 1e5)}`, packageName: "Monthly compliance", pricingBasis: "monthly_package" });
    const pkg = (await workspace(w)).packages[0].packageCode;
    const contractId = await newDraft(w);
    await K.ct.attachServiceScopes({ contractId, scopeIds: [w.scopeId] });
    const lineId = (await workspace(w)).contracts[0].lines[0].id;
    const decision = await evidence(w.organizationId, "SERVICE_SCOPE_CONFIRMATION");
    await K.ct.defineResponsibilityBoundary({
      lineItemId: lineId,
      decisionEvidenceDocumentId: decision,
      rows: [{ responsibilityArea: "COMPLIANCE_MONITORING", responsibleParty: "TES", effectiveResponsibilityDate: "2020-03-01" }],
    });
    await K.ct.assignPricingPackage({ lineItemId: lineId, decisionEvidenceDocumentId: decision, pricingBasis: "monthly_package", packageCode: pkg, feeMinorUnits: 125000, feeCurrency: "CAD" });
    for (const rule of ["CUSTOMER_AUTHORITY_NOTICE", "SERVICE_SCOPE_CONFIRMATION", "RESPONSIBILITY_START_CONFIRMATION", "REQUIRED_SETTINGS_CONFIRMATION", "PRICING_PACKAGE_CONFIRMATION"]) {
      await K.ct.linkContractEvidence({ contractId, ruleCode: rule, evidenceDocumentId: rule === "CUSTOMER_AUTHORITY_NOTICE" ? notice : await evidence(w.organizationId, rule) });
    }
    return { contractId, lineId, notice, decision, pkg };
  }

  /** Runs raw SQL as the RUNTIME role inside an authorized CONTRACT_MANAGE transaction and returns the PostgreSQL error, if any. */
  async function rawAsContractManager(sql: string, params: unknown[] = []): Promise<PgError | null> {
    try {
      await K.sys.withAuthorizedSystem("CONTRACT_MANAGE", async (client) => {
        await client.query(sql, params);
      });
      return null;
    } catch (error) {
      return error as PgError;
    }
  }

  const masterEvents = async (type: string) =>
    Number((await pools.admin.query(`SELECT count(*) FROM public.master_register_events WHERE event_type = $1 AND actor_id = $2::uuid`, [type, staffActorId])).rows[0].count);

  // =============================================================================================================
  describe("authority and signatory", () => {
    it("assigns exactly one active holder per role; the same person may hold both; replacement preserves history", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const { notice, sda, signatory } = await assignBoth(w);
      assert.equal(sda.personId, w.personA);
      assert.equal(signatory.personId, w.personA);
      let ws = await workspace(w);
      assert.equal(ws.authorities.samePerson, true);
      assert.equal(ws.authorities.serviceDecisionAuthority?.id, sda.id);

      // Different people for the two roles is equally valid.
      const noticeB = await evidence(w.organizationId, "CUSTOMER_AUTHORITY_NOTICE");
      const replacement = await assign(w, w.personB, "CONTRACT_SIGNATORY", noticeB);
      ws = await workspace(w);
      assert.equal(ws.authorities.samePerson, false);
      assert.equal(ws.authorities.contractSignatory?.id, replacement.id);

      const oldRow = ws.authorities.assignments.find((item) => item.id === signatory.id);
      assert.equal(oldRow?.assignmentStatus, "superseded");
      assert.ok(oldRow?.effectiveTo, "the replaced authority is ended, not deleted");
      assert.equal(oldRow?.noticeEvidenceDocumentId, notice, "historical evidence is preserved");
      const active = ws.authorities.assignments.filter((item) => item.assignmentStatus === "active" && item.authorityType === "CONTRACT_SIGNATORY");
      assert.equal(active.length, 1, "never multiple active holders");
      const change = ws.authorities.changes.find((item) => item.newAssignmentId === replacement.id);
      assert.equal(change?.changeType, "replaced");
      assert.equal(change?.priorAssignmentId, signatory.id);
      assert.equal(change?.noticeEvidenceDocumentId, noticeB);
      assert.ok(change?.masterRegisterEventId);
    });

    it("refuses authority changes without a verified written company notice", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const notVerified = await evidence(w.organizationId, "CUSTOMER_AUTHORITY_NOTICE", { status: "received" });
      const wrongType = await evidence(w.organizationId, "OTHER_DOCUMENT");
      const expired = await evidence(w.organizationId, "CUSTOMER_AUTHORITY_NOTICE", { expiresAt: "2020-01-01" });
      const otherOrg = await world({ settings: false, responsibility: false });
      const foreign = await evidence(otherOrg.organizationId, "CUSTOMER_AUTHORITY_NOTICE");

      for (const bad of [notVerified, wrongType, expired, foreign]) {
        await rejectsWith(assign(w, w.personA, "SERVICE_DECISION_AUTHORITY", bad), K.ct.ContractStateError);
      }
      await rejectsWith(assign(w, w.personA, "SERVICE_DECISION_AUTHORITY", randomUUID()), K.ct.ContractStateError);
      await rejectsWith(
        K.ct.assignCustomerAuthority({ customerId: w.customerId, organizationId: w.organizationId, personId: w.personA, authorityType: "SERVICE_DECISION_AUTHORITY", noticeEvidenceDocumentId: "" }),
        K.ct.ContractValidationError,
      );
      assert.equal((await workspace(w)).authorities.assignments.length, 0, "every refusal rolled back");
    });

    it("refuses a holder who is not an active contact of the organization, and a future-dated authority", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const other = await world({ settings: false, responsibility: false });
      const notice = await evidence(w.organizationId, "CUSTOMER_AUTHORITY_NOTICE");
      await rejectsWith(assign(w, other.personA, "SERVICE_DECISION_AUTHORITY", notice), K.ct.ContractStateError);
      await rejectsWith(
        K.ct.assignCustomerAuthority({
          customerId: w.customerId, organizationId: w.organizationId, personId: w.personA, authorityType: "SERVICE_DECISION_AUTHORITY",
          noticeEvidenceDocumentId: notice, effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
        }),
        K.ct.ContractValidationError,
      );
    });

    it("revokes an authority with a notice, leaving the role vacant and blocking readiness", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const { sda } = await assignBoth(w);
      const notice = await evidence(w.organizationId, "CUSTOMER_AUTHORITY_NOTICE");
      await new Promise((resolve) => setTimeout(resolve, 20));
      const revoked = await K.ct.revokeCustomerAuthority({ assignmentId: sda.id, noticeEvidenceDocumentId: notice });
      assert.equal(revoked.assignmentStatus, "voided");
      const ws = await workspace(w);
      assert.equal(ws.authorities.serviceDecisionAuthority, null);
      assert.equal(ws.authorities.changes.some((item) => item.changeType === "revoked" && item.priorAssignmentId === sda.id), true);
      await rejectsWith(K.ct.revokeCustomerAuthority({ assignmentId: sda.id, noticeEvidenceDocumentId: notice }), K.ct.ContractStateError);
    });

    it("the database refuses every route around the service", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const { sda, signatory, notice } = await assignBoth(w);

      // second active holder of the same role (partial unique index)
      const second = await rawAsContractManager(
        `INSERT INTO public.customer_authority_assignments (customer_id, organization_id, person_id, authority_type, effective_from, notice_evidence_document_id)
         VALUES ($1, $2, $3, 'SERVICE_DECISION_AUTHORITY', now(), $4)`,
        [w.customerId, w.organizationId, w.personB, notice],
      );
      assert.equal(second?.code, "23505");

      // a raw replacement with no change ledger row fails at commit
      const noLedger = await rawAsContractManager(
        `WITH ended AS (UPDATE public.customer_authority_assignments SET assignment_status = 'superseded', effective_to = now(), replacement_reason = 'raw replacement' WHERE id = $1 RETURNING 1)
         INSERT INTO public.customer_authority_assignments (customer_id, organization_id, person_id, authority_type, effective_from, notice_evidence_document_id)
         SELECT $2, $3, $4, 'SERVICE_DECISION_AUTHORITY', now() + interval '1 millisecond', $5 FROM ended`,
        [sda.id, w.customerId, w.organizationId, w.personB, notice],
      );
      assert.equal(noLedger?.code, "23514", noLedger?.message);
      assert.match(noLedger?.message ?? "", /no verified-notice change record/);

      // an assignment with no notice at all
      const noNotice = await rawAsContractManager(
        `INSERT INTO public.customer_authority_assignments (customer_id, organization_id, person_id, authority_type, effective_from) VALUES ($1, $2, $3, 'CONTRACT_SIGNATORY', now())`,
        [w.customerId, w.organizationId, w.personB],
      );
      assert.ok(noNotice, "an authority without a notice is refused");

      // an active authority cannot be edited into another person; ended authorities are frozen history
      const edit = await rawAsContractManager(`UPDATE public.customer_authority_assignments SET person_id = $2 WHERE id = $1`, [signatory.id, w.personB]);
      assert.equal(edit?.code, "55000");
      const stillActive = await rawAsContractManager(`UPDATE public.customer_authority_assignments SET updated_at = now() WHERE id = $1`, [signatory.id]);
      assert.equal(stillActive?.code, "55000");

      // no delete / truncate, on 0030 and 0031 tables alike
      for (const table of ["customer_authority_assignments", "customer_authority_change_events", "customer_contract_status_events", "customer_contracts", "customer_contract_line_pricing"]) {
        const del = await rawAsContractManager(`DELETE FROM public.${table}`);
        assert.ok(del, `DELETE on ${table} must be refused`);
        const trunc = await rawAsContractManager(`TRUNCATE public.${table}`);
        assert.ok(trunc, `TRUNCATE on ${table} must be refused`);
      }
      // ledgers are append-only even for the owner (row triggers only fire on existing rows, so make sure there are some)
      await newDraft(w);
      await assert.rejects(pools.admin.query(`UPDATE public.customer_authority_change_events SET actor_id = actor_id`), /append-only/);
      await assert.rejects(pools.admin.query(`UPDATE public.customer_contract_status_events SET to_status = to_status`), /append-only/);
      await assert.rejects(pools.admin.query(`UPDATE public.contract_evidence_rules SET rule_label = rule_label`), /append-only/);
    });
  });

  // =============================================================================================================
  describe("contract draft, scope, responsibility, pricing", () => {
    it("creates a draft with a Master Register accountability baseline and links scopes only under an active Service Decision Authority", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const contractId = await newDraft(w);
      let ws = await workspace(w);
      const contract = ws.contracts[0];
      assert.equal(contract.contractStatus, "draft");
      assert.equal(contract.statusHistory.length, 1);
      assert.equal(contract.statusHistory[0].fromStatus, null);
      assert.ok(contract.statusHistory[0].masterRegisterEventId);
      assert.equal(contract.evidenceRequirements.length, 6, "one requirement per active catalogue rule");

      // Without a Service Decision Authority no one can decide contracted scope.
      await rejectsWith(K.ct.attachServiceScopes({ contractId, scopeIds: [w.scopeId] }), K.ct.ContractStateError);

      await assignBoth(w);
      await K.ct.updateContractDraft({ contractId, syncAuthorities: true });
      await K.ct.attachServiceScopes({ contractId, scopeIds: [w.scopeId] });
      ws = await workspace(w);
      assert.equal(ws.contracts[0].lines.length, 1);
      assert.equal(ws.contracts[0].lines[0].scopeId, w.scopeId);

      // a scope of another engagement can never be attached
      const other = await world();
      await rejectsWith(K.ct.attachServiceScopes({ contractId, scopeIds: [other.scopeId] }), K.ct.ContractStateError);
      // one working contract per engagement
      await rejectsWith(K.ct.createContractDraft(w.organizationId, {}), K.ct.ContractConflictError);
    });

    it("TES responsibility starts only at the explicit effective date, and history is excluded unless evidence supports assuming it", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      await assignBoth(w);
      const contractId = await newDraft(w);
      await K.ct.attachServiceScopes({ contractId, scopeIds: [w.scopeId] });
      const lineId = (await workspace(w)).contracts[0].lines[0].id;
      const decision = await evidence(w.organizationId, "SERVICE_SCOPE_CONFIRMATION");
      const row = (over: Record<string, unknown> = {}) => ({ responsibilityArea: "COMPLIANCE_MONITORING", responsibleParty: "TES", effectiveResponsibilityDate: "2020-03-01", ...over });
      const define = (rows: unknown[], decisionEvidenceDocumentId = decision) => K.ct.defineResponsibilityBoundary({ lineItemId: lineId, decisionEvidenceDocumentId, rows });

      // no explicit date / malformed date
      await rejectsWith(define([row({ effectiveResponsibilityDate: undefined })]), K.ct.ContractValidationError);
      await rejectsWith(define([row({ effectiveResponsibilityDate: "2020-02-30" })]), K.ct.ContractValidationError);
      // before TES assumed responsibility for the scope (assumed 2020-03-01)
      await rejectsWith(define([row({ effectiveResponsibilityDate: "2020-02-15" })]), K.ct.ContractStateError);
      // decision evidence must be verified
      await rejectsWith(define([row()], await evidence(w.organizationId, "SERVICE_SCOPE_CONFIRMATION", { status: "received" })), K.ct.ContractStateError);
      // assuming history without evidence / dates
      await rejectsWith(define([row({ historyTreatment: "tes_assumes_with_evidence" })]), K.ct.ContractValidationError);
      await rejectsWith(define([row({ historyTreatment: "tes_assumes_with_evidence", historyAssumedFrom: "2019-01-01" })]), K.ct.ContractValidationError);
      await rejectsWith(
        define([row({ historyTreatment: "tes_assumes_with_evidence", historyAssumedFrom: "2019-01-01", historyEvidenceDocumentId: await evidence(w.organizationId, "HISTORY_RECORDS", { status: "received" }) })]),
        K.ct.ContractStateError,
      );
      // history evidence on a treatment that does not assume history
      await rejectsWith(define([row({ historyTreatment: "excluded", historyEvidenceDocumentId: decision })]), K.ct.ContractValidationError);
      assert.equal((await workspace(w)).contracts[0].lines[0].responsibilities.length, 0, "every refusal rolled back");

      const saved = await define([row()]);
      assert.equal(saved[0].historyTreatment, "excluded");
      assert.equal((await workspace(w)).contracts[0].lines[0].responsibilityBoundary, "from_effective_responsibility_date_only");

      const history = await evidence(w.organizationId, "HISTORY_RECORDS");
      await define([row(), row({ responsibilityArea: "DOCUMENT_COLLECTION", historyTreatment: "tes_assumes_with_evidence", historyAssumedFrom: "2019-01-01", historyEvidenceDocumentId: history })]);
      assert.equal((await workspace(w)).contracts[0].lines[0].responsibilityBoundary, "tes_assumes_defined_history_with_evidence");
    });

    it("requires pricing/package metadata and fee shape; fees never reach the Master Register", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      await assignBoth(w);
      const contractId = await newDraft(w);
      await K.ct.attachServiceScopes({ contractId, scopeIds: [w.scopeId] });
      const lineId = (await workspace(w)).contracts[0].lines[0].id;
      const decision = await evidence(w.organizationId, "PRICING_PACKAGE_CONFIRMATION");
      const price = (over: Record<string, unknown>) => K.ct.assignPricingPackage({ lineItemId: lineId, decisionEvidenceDocumentId: decision, pricingBasis: "monthly_package", ...over });

      await rejectsWith(price({ pricingBasis: "to_be_defined" }), K.ct.ContractValidationError);
      await rejectsWith(price({ packageCode: undefined, feeMinorUnits: 100, feeCurrency: "CAD" }), K.ct.ContractValidationError);
      await rejectsWith(price({ packageCode: "NOPE_PACKAGE", feeMinorUnits: 100, feeCurrency: "CAD" }), K.ct.ContractStateError);
      await rejectsWith(price({ packageCode: "ANY", feeMinorUnits: -5, feeCurrency: "CAD" }), K.ct.ContractValidationError);
      await rejectsWith(price({ packageCode: "ANY", feeMinorUnits: 100, feeCurrency: "EUR" }), K.ct.ContractValidationError);

      await K.ct.definePackage(w.organizationId, { packageCode: `PKG_${run}_PRICE`, packageName: "Package", pricingBasis: "monthly_package" });
      const saved = await price({ packageCode: `PKG_${run}_PRICE`, feeMinorUnits: 987654, feeCurrency: "CAD" });
      assert.equal(saved.feeMinorUnits, 987654);
      assert.equal(saved.feePeriod, "monthly");
      const events = await pools.admin.query(`SELECT change_set::text AS c FROM public.master_register_events WHERE event_type = 'APPROVAL_DECISION_RECORDED' AND actor_id = $1::uuid`, [staffActorId]);
      assert.ok(events.rows.length >= 1);
      for (const event of events.rows) assert.doesNotMatch(event.c, /987654/, "fee amounts are never copied into the Master Register");
    });
  });

  // =============================================================================================================
  describe("readiness gates and status lifecycle", () => {
    it("reports every unmet gate and refuses to advance; readiness is not possible without evidence, pricing or authorities", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world({ settings: false, responsibility: false });
      await K.ct.createContractDraft(w.organizationId, {});
      const contractId = (await workspace(w)).contracts[0].id;
      const bare = (await workspace(w)).contracts[0];
      assert.equal(bare.readiness.target, "ready_for_signature");
      assert.equal(bare.readiness.ready, false);
      for (const gate of ["CONTRACT_REFERENCE", "SERVICE_SCOPE", "RESPONSIBILITY_MATRIX", "REQUIRED_SETTINGS", "PRICING_PACKAGE", "SERVICE_DECISION_AUTHORITY", "CONTRACT_SIGNATORY", "EVIDENCE_REQUIREMENTS"]) {
        assert.ok(bare.readiness.failures.includes(gate as never), `${gate} should be unmet`);
      }
      assert.equal(bare.readiness.failures.includes("MASTER_REGISTER_ACCOUNTABILITY" as never), false, "the baseline gives the accountability path");
      const doc = await evidence(w.organizationId, "CONTRACT_READY_CONFIRMATION");
      await rejectsWith(K.ct.advanceContractStatus({ contractId, toStatus: "ready_for_signature", evidenceDocumentId: doc }), K.ct.ContractStateError);
      assert.equal((await workspace(w)).contracts[0].contractStatus, "draft");
    });

    it("a fully prepared contract is ready, and losing any single gate blocks it again", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const { contractId, lineId, pkg } = await readyDraft(w);
      assert.deepEqual((await workspace(w)).contracts[0].readiness, { target: "ready_for_signature", failures: [], ready: true });

      // evidence that expires stops counting
      const expiring = (await workspace(w)).contracts[0].evidenceRequirements.find((item) => item.ruleCode === "PRICING_PACKAGE_CONFIRMATION")!.evidenceDocumentId!;
      await pools.admin.query(`UPDATE public.evidence_documents SET expires_at = '2020-01-01' WHERE id = $1`, [expiring]);
      assert.deepEqual((await workspace(w)).contracts[0].readiness.failures, ["EVIDENCE_REQUIREMENTS"]);
      await pools.admin.query(`UPDATE public.evidence_documents SET expires_at = NULL WHERE id = $1`, [expiring]);

      // a retired package no longer defines the pricing
      await pools.admin.query(`UPDATE public.contract_package_definitions SET package_status = 'retired' WHERE package_code = $1`, [pkg]);
      assert.deepEqual((await workspace(w)).contracts[0].readiness.failures, ["PRICING_PACKAGE"]);
      await pools.admin.query(`UPDATE public.contract_package_definitions SET package_status = 'active' WHERE package_code = $1`, [pkg]);

      // removing the only scope removes scope, responsibility and pricing together
      await K.ct.detachServiceScope({ lineItemId: lineId });
      const failures = (await workspace(w)).contracts[0].readiness.failures;
      for (const gate of ["SERVICE_SCOPE", "RESPONSIBILITY_MATRIX", "PRICING_PACKAGE"]) assert.ok(failures.includes(gate as never), gate);
      void contractId;
    });

    it("walks draft -> ready_for_signature -> signed -> superseded -> archived, each step with evidence and a Master Register record", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const { contractId } = await readyDraft(w);
      const confirmation = await evidence(w.organizationId, "CONTRACT_READY_CONFIRMATION");

      await rejectsWith(K.ct.advanceContractStatus({ contractId, toStatus: "signed", evidenceDocumentId: confirmation }), K.ct.ContractStateError);
      await rejectsWith(K.ct.advanceContractStatus({ contractId, toStatus: "ready_for_signature", evidenceDocumentId: await evidence(w.organizationId, "X_DOC", { status: "received" }) }), K.ct.ContractStateError);
      await K.ct.advanceContractStatus({ contractId, toStatus: "ready_for_signature", evidenceDocumentId: confirmation });
      let contract = (await workspace(w)).contracts[0];
      assert.equal(contract.contractStatus, "ready_for_signature");
      assert.equal(contract.lines[0].lineStatus, "ready");

      // signing needs the signed document rule satisfied and a SIGNED_CONTRACT_DOCUMENT as the change evidence
      assert.deepEqual(contract.readiness.failures, ["EVIDENCE_REQUIREMENTS"]);
      const signedDoc = await evidence(w.organizationId, "SIGNED_CONTRACT_DOCUMENT");
      await K.ct.linkContractEvidence({ contractId, ruleCode: "SIGNED_CONTRACT_DOCUMENT", evidenceDocumentId: signedDoc });
      await rejectsWith(K.ct.advanceContractStatus({ contractId, toStatus: "signed", evidenceDocumentId: confirmation }), K.ct.ContractStateError);
      await K.ct.advanceContractStatus({ contractId, toStatus: "signed", evidenceDocumentId: signedDoc });
      contract = (await workspace(w)).contracts[0];
      assert.equal(contract.contractStatus, "signed");
      assert.equal(contract.lines[0].lineStatus, "signed");

      // a signed contract's design is frozen
      await rejectsWith(K.ct.updateContractDraft({ contractId, contractReference: "CHANGED" }), K.ct.ContractStateError);
      await rejectsWith(K.ct.attachServiceScopes({ contractId, scopeIds: [w.scopeId] }), K.ct.ContractStateError);
      await rejectsWith(K.ct.detachServiceScope({ lineItemId: contract.lines[0].id }), K.ct.ContractStateError);

      await K.ct.advanceContractStatus({ contractId, toStatus: "superseded", evidenceDocumentId: confirmation });
      await K.ct.advanceContractStatus({ contractId, toStatus: "archived", evidenceDocumentId: confirmation });
      contract = (await workspace(w)).contracts[0];
      assert.equal(contract.contractStatus, "archived");
      await rejectsWith(K.ct.advanceContractStatus({ contractId, toStatus: "draft", evidenceDocumentId: confirmation }), K.ct.ContractStateError);

      const trail = contract.statusHistory.map((event) => `${event.fromStatus ?? "-"}>${event.toStatus}`);
      assert.deepEqual(trail, ["->draft", "draft>ready_for_signature", "ready_for_signature>signed", "signed>superseded", "superseded>archived"]);
      for (const event of contract.statusHistory) assert.ok(event.masterRegisterEventId);
      for (const event of contract.statusHistory.slice(1)) assert.ok(event.evidenceDocumentId, "every status change names evidence");
      const mr = await pools.admin.query(
        `SELECT count(*) FROM public.master_register_events WHERE event_id = ANY($1::uuid[])`,
        [contract.statusHistory.map((event) => event.masterRegisterEventId)],
      );
      assert.equal(Number(mr.rows[0].count), contract.statusHistory.length);
    });

    it("the company profile derives Service Type from a SIGNED contract only: read-only, never typed in, and 'Not contracted' otherwise", async () => {
      await signInWith(...STAFF_CAPABILITIES, "ORGANIZATION_REGISTRY_READ", "TAX_REGISTRATION_READ");
      const w = await world();
      const { contractId } = await readyDraft(w);
      const confirmation = await evidence(w.organizationId, "CONTRACT_READY_CONFIRMATION");
      const serviceType = async () => (await K.dir.getCompanyProfile(w.organizationId))?.serviceType;

      assert.deepEqual(await serviceType(), { state: "not_contracted" }, "a draft contract is not authoritative");
      await K.ct.advanceContractStatus({ contractId, toStatus: "ready_for_signature", evidenceDocumentId: confirmation });
      assert.deepEqual(await serviceType(), { state: "not_contracted" }, "ready for signature is not signed");
      const signedDoc = await evidence(w.organizationId, "SIGNED_CONTRACT_DOCUMENT");
      await K.ct.linkContractEvidence({ contractId, ruleCode: "SIGNED_CONTRACT_DOCUMENT", evidenceDocumentId: signedDoc });
      await K.ct.advanceContractStatus({ contractId, toStatus: "signed", evidenceDocumentId: signedDoc });
      const signed = await serviceType();
      assert.equal(signed?.state, "contracted");
      assert.deepEqual(signed && "packages" in signed ? signed.packages : null, ["Monthly compliance"], "the package name comes from the signed contract line");

      // The only way to change it is the contract workflow: an ordinary profile edit is refused, and nothing changes.
      await assert.rejects(K.dir.editCompany(w.organizationId, { svcType: "Premium" }), (error: unknown) => error instanceof Error && error.name === "CompanyCreationValidationError");
      assert.deepEqual(await serviceType(), signed);

      // A caller who may not read contracts sees "restricted", never a guessed value.
      await signInWith("ORGANIZATION_REGISTRY_READ", "CUSTOMER_RELATIONSHIP_READ", "COMPANY_PROFILE_READ", "PERSON_REGISTRY_READ", "TAX_REGISTRATION_READ");
      const restricted = await K.dir.getCompanyProfile(w.organizationId);
      assert.deepEqual(restricted?.serviceType, { state: "restricted" });
      assert.equal(restricted?.sections.contracts, "not_permitted");

      await signInWith(...STAFF_CAPABILITIES, "ORGANIZATION_REGISTRY_READ", "TAX_REGISTRATION_READ");
      await K.ct.advanceContractStatus({ contractId, toStatus: "superseded", evidenceDocumentId: confirmation });
      assert.deepEqual(await serviceType(), { state: "not_contracted" }, "a superseded contract no longer defines the service");
    });

    it("Service Type follows the CURRENT engagement only: sign -> end -> rejoin -> new contract; earlier contracts stay as history", async () => {
      await signInWith(...STAFF_CAPABILITIES, "ORGANIZATION_REGISTRY_READ", "TAX_REGISTRATION_READ");
      const w = await world();
      const first = await readyDraft(w);
      const confirmation = await evidence(w.organizationId, "CONTRACT_READY_CONFIRMATION");
      const sign = async (contractId: string) => {
        await K.ct.advanceContractStatus({ contractId, toStatus: "ready_for_signature", evidenceDocumentId: confirmation });
        const signedDoc = await evidence(w.organizationId, "SIGNED_CONTRACT_DOCUMENT");
        await K.ct.linkContractEvidence({ contractId, ruleCode: "SIGNED_CONTRACT_DOCUMENT", evidenceDocumentId: signedDoc });
        await K.ct.advanceContractStatus({ contractId, toStatus: "signed", evidenceDocumentId: signedDoc });
      };
      const serviceType = async () => (await K.dir.getCompanyProfile(w.organizationId))?.serviceType;
      const names = (value: Awaited<ReturnType<typeof serviceType>>) => (value && "packages" in value ? value.packages : null);

      assert.deepEqual(await serviceType(), { state: "not_contracted" });
      await sign(first.contractId);
      assert.deepEqual(names(await serviceType()), ["Monthly compliance"]);

      // leave: the signed contract stays signed history, but nothing is current
      const { ENGAGEMENT_END_REASONS } = await import("@/lib/customer-relationship/definitions");
      await K.cr.endEngagement({ engagementId: w.engagementId, endReason: ENGAGEMENT_END_REASONS[0] });
      assert.deepEqual(await serviceType(), { state: "not_contracted" }, "an ended engagement has no current contract");

      // rejoin: a new engagement without a signed contract is Not contracted; the old contract is neither reactivated nor altered
      const rejoined = await K.cr.establishCustomerRelationship({ organizationId: w.organizationId, engagementType: "RECURRING", stage: "ONBOARDING" });
      const newEngagementId = rejoined.engagement.engagement.id;
      assert.deepEqual(await serviceType(), { state: "not_contracted" }, "a rejoin does not revive the earlier signed contract");
      const history = (await workspace(w)).contracts;
      assert.deepEqual(history.map((c) => [c.id, c.engagementId, c.contractStatus]), [[first.contractId, w.engagementId, "signed"]], "the earlier contract is still readable, still signed, still bound to its own engagement");

      // a new signed contract for the new engagement defines the service
      const scope = (await K.cr.addScope({ engagementId: newEngagementId, productLevel: "COMPLIANCE" })).current.scopes[0].id;
      await K.cr.assumeResponsibility({ scopeId: scope });
      await K.ct.definePackage(w.organizationId, { packageCode: `PKG_${run}_NEW${Math.floor(Math.random() * 1e5)}`, packageName: "Renewed compliance", pricingBasis: "monthly_package" });
      const pkg = (await workspace(w)).packages.find((p) => p.packageName === "Renewed compliance")!.packageCode;
      await K.ct.createContractDraft(w.organizationId, { contractReference: `CTR-${run}-NEW${Math.floor(Math.random() * 1e6)}` });
      const draft = (await workspace(w)).contracts.find((c) => c.engagementId === newEngagementId)!;
      await K.ct.attachServiceScopes({ contractId: draft.id, scopeIds: [scope] });
      const lineId = (await workspace(w)).contracts.find((c) => c.id === draft.id)!.lines[0].id;
      const decision = await evidence(w.organizationId, "SERVICE_SCOPE_CONFIRMATION");
      const today = new Date().toISOString().slice(0, 10);
      await K.ct.defineResponsibilityBoundary({ lineItemId: lineId, decisionEvidenceDocumentId: decision, rows: [{ responsibilityArea: "COMPLIANCE_MONITORING", responsibleParty: "TES", effectiveResponsibilityDate: today }] });
      await K.ct.assignPricingPackage({ lineItemId: lineId, decisionEvidenceDocumentId: decision, pricingBasis: "monthly_package", packageCode: pkg, feeMinorUnits: 99000, feeCurrency: "CAD" });
      for (const rule of ["CUSTOMER_AUTHORITY_NOTICE", "SERVICE_SCOPE_CONFIRMATION", "RESPONSIBILITY_START_CONFIRMATION", "REQUIRED_SETTINGS_CONFIRMATION", "PRICING_PACKAGE_CONFIRMATION"]) {
        await K.ct.linkContractEvidence({ contractId: draft.id, ruleCode: rule, evidenceDocumentId: rule === "CUSTOMER_AUTHORITY_NOTICE" ? first.notice : await evidence(w.organizationId, rule) });
      }
      assert.deepEqual(await serviceType(), { state: "not_contracted" }, "a draft for the new engagement is not yet a service");
      await sign(draft.id);
      const current = await serviceType();
      assert.equal(current?.state, "contracted");
      assert.deepEqual(names(current), ["Renewed compliance"], "only the new engagement's contract, not the earlier package");
      assert.equal(current && "contractReference" in current ? current.contractReference : null, draft.contractReference);

      // both contracts remain in the workspace history, the old one untouched
      const all = (await workspace(w)).contracts;
      assert.deepEqual(all.map((c) => [c.engagementId, c.contractStatus]).sort(), [[newEngagementId, "signed"], [w.engagementId, "signed"]].sort());
    });

    it("an authority replacement returns a ready contract to draft and invalidates the old authority's decisions", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const { contractId, notice } = await readyDraft(w);
      await K.ct.advanceContractStatus({ contractId, toStatus: "ready_for_signature", evidenceDocumentId: await evidence(w.organizationId, "CONTRACT_READY_CONFIRMATION") });
      const noticeB = await evidence(w.organizationId, "CUSTOMER_AUTHORITY_NOTICE");
      await assign(w, w.personB, "SERVICE_DECISION_AUTHORITY", noticeB);

      const contract = (await workspace(w)).contracts[0];
      assert.equal(contract.contractStatus, "draft", "the replaced authority's contract is no longer ready for signature");
      assert.equal(contract.statusHistory.at(-1)?.evidenceDocumentId, noticeB);
      const active = (await workspace(w)).authorities.serviceDecisionAuthority;
      assert.equal(contract.serviceDecisionAuthorityAssignmentId, active?.id, "the draft follows the new holder");
      assert.ok(contract.readiness.failures.includes("RESPONSIBILITY_MATRIX"), "decisions made under the old authority are stale");
      assert.ok(contract.readiness.failures.includes("PRICING_PACKAGE"));
      void notice;
    });

    it("the database refuses a status change that skips evidence, the ledger or the gates", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const { contractId } = await readyDraft(w);
      const confirmation = await evidence(w.organizationId, "CONTRACT_READY_CONFIRMATION");

      // raw status write: no ledger row in this transaction
      const raw = await rawAsContractManager(`UPDATE public.customer_contracts SET contract_status = 'ready_for_signature' WHERE id = $1`, [contractId]);
      assert.equal(raw?.code, "23514");
      assert.match(raw?.message ?? "", /requires verified evidence and a Master Register accountability record/);

      // ledger row without a Master Register event (FK) or without evidence (check) or with unverified evidence (guard)
      const noEvent = await rawAsContractManager(
        `INSERT INTO public.customer_contract_status_events (contract_id, from_status, to_status, evidence_document_id, master_register_event_id, actor_id) VALUES ($1, 'draft', 'ready_for_signature', $2, $3, $4)`,
        [contractId, confirmation, randomUUID(), staffActorId],
      );
      assert.equal(noEvent?.code, "23503");
      const mrEvent = (await pools.admin.query(`SELECT event_id FROM public.master_register_events WHERE actor_id = $1::uuid LIMIT 1`, [staffActorId])).rows[0].event_id;
      const noEvidence = await rawAsContractManager(
        `INSERT INTO public.customer_contract_status_events (contract_id, from_status, to_status, evidence_document_id, master_register_event_id, actor_id) VALUES ($1, 'draft', 'ready_for_signature', NULL, $2, $3)`,
        [contractId, mrEvent, staffActorId],
      );
      assert.equal(noEvidence?.code, "23514");
      const unverified = await evidence(w.organizationId, "CONTRACT_READY_CONFIRMATION", { status: "received" });
      const badEvidence = await rawAsContractManager(
        `INSERT INTO public.customer_contract_status_events (contract_id, from_status, to_status, evidence_document_id, master_register_event_id, actor_id) VALUES ($1, 'draft', 'ready_for_signature', $2, $3, $4)`,
        [contractId, unverified, mrEvent, staffActorId],
      );
      assert.equal(badEvidence?.code, "23514");

      // a complete ledger row but a failing gate (pricing removed) still cannot advance
      await pools.admin.query(`ALTER TABLE public.customer_contract_line_pricing DISABLE TRIGGER USER`);
      await pools.admin.query(`UPDATE public.customer_contract_line_pricing SET decided_by_assignment_id = (SELECT id FROM public.customer_authority_assignments WHERE customer_id = $1 AND authority_type = 'CONTRACT_SIGNATORY' AND assignment_status = 'active')`, [w.customerId]);
      await pools.admin.query(`ALTER TABLE public.customer_contract_line_pricing ENABLE TRIGGER USER`);
      const gated = await rawAsContractManager(
        `WITH l AS (INSERT INTO public.customer_contract_status_events (contract_id, from_status, to_status, evidence_document_id, master_register_event_id, actor_id) VALUES ($1, 'draft', 'ready_for_signature', $2, $3, $4) RETURNING 1)
         UPDATE public.customer_contracts SET contract_status = 'ready_for_signature' WHERE id = $1 AND EXISTS (SELECT 1 FROM l)`,
        [contractId, confirmation, mrEvent, staffActorId],
      );
      assert.equal(gated?.code, "23514", gated?.message);
      assert.match(gated?.message ?? "", /readiness gates failed: .*PRICING_PACKAGE/);

      // identity is frozen
      const moved = await rawAsContractManager(`UPDATE public.customer_contracts SET engagement_id = $2 WHERE id = $1`, [contractId, randomUUID()]);
      assert.equal(moved?.code, "55000");
    });

    it("the decision rows can only be written by the contract's active Service Decision Authority (an operational contact is refused)", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      await assignBoth(w);
      // a different person is the Contract Signatory: a signatory is not a Service Decision Authority
      const noticeB = await evidence(w.organizationId, "CUSTOMER_AUTHORITY_NOTICE");
      const signatoryB = await assign(w, w.personB, "CONTRACT_SIGNATORY", noticeB);
      const contractId = await newDraft(w);
      await K.ct.attachServiceScopes({ contractId, scopeIds: [w.scopeId] });
      const lineId = (await workspace(w)).contracts[0].lines[0].id;
      const decision = await evidence(w.organizationId, "SERVICE_SCOPE_CONFIRMATION");
      const mrEvent = (await pools.admin.query(`SELECT event_id FROM public.master_register_events WHERE actor_id = $1::uuid LIMIT 1`, [staffActorId])).rows[0].event_id;
      const asSignatory = await rawAsContractManager(
        `INSERT INTO public.customer_contract_responsibility_matrix
          (line_item_id, responsibility_area, responsible_party, effective_responsibility_date, decided_by_assignment_id, decision_evidence_document_id, master_register_event_id)
         VALUES ($1, 'COMPLIANCE_MONITORING', 'TES', '2020-03-01', $2, $3, $4)`,
        [lineId, signatoryB.id, decision, mrEvent],
      );
      assert.equal(asSignatory?.code, "23514");
      assert.match(asSignatory?.message ?? "", /Service Decision Authority/);
      const noDecisionRow = await rawAsContractManager(
        `INSERT INTO public.customer_contract_responsibility_matrix
          (line_item_id, responsibility_area, responsible_party, effective_responsibility_date, decided_by_assignment_id, decision_evidence_document_id, master_register_event_id)
         VALUES ($1, 'COMPLIANCE_MONITORING', 'TES', '2020-03-01', $2, $3, $4)`,
        [lineId, randomUUID(), decision, mrEvent],
      );
      assert.ok(noDecisionRow);
    });
  });

  // =============================================================================================================
  describe("Master Register accountability and authorization", () => {
    it("records actions, decisions, evidence links and views in the Master Register", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      await readyDraft(w);
      const before = await masterEvents("RECORD_VIEWED");
      await workspace(w);
      assert.equal(await masterEvents("RECORD_VIEWED"), before + 1, "viewing the contracts workspace is itself accountable");
      for (const type of ["RECORD_CREATED", "RECORD_LINK_ESTABLISHED", "APPROVAL_DECISION_RECORDED", "EVIDENCE_ASSOCIATED", "ASSIGNMENT_CREATED"]) {
        assert.ok((await masterEvents(type)) > 0, `${type} was recorded`);
      }
    });

    it("rolls the whole change back when the Master Register cannot record it", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      await assignBoth(w);
      await pools.admin.query(`ALTER TABLE public.master_register_events ADD CONSTRAINT mr_test_block CHECK (event_type <> 'RECORD_CREATED') NOT VALID`);
      try {
        await assert.rejects(K.ct.createContractDraft(w.organizationId, { contractReference: "ROLLBACK" }));
      } finally {
        await pools.admin.query(`ALTER TABLE public.master_register_events DROP CONSTRAINT mr_test_block`);
      }
      assert.equal((await workspace(w)).contracts.length, 0, "no contract without its accountability record");
    });

    it("enforces capabilities: read-only cannot manage, manage alone cannot read evidence, others are denied", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      await assignBoth(w);
      K.db.setClerkUser(null);

      await signInWith("CONTRACT_READ", "EVIDENCE_READ", "CUSTOMER_RELATIONSHIP_READ");
      await workspace(w);
      await rejectsWith(K.ct.createContractDraft(w.organizationId, {}), K.authz.TesAuthorizationDeniedError);

      await signInWith("EVIDENCE_MANAGE", "EVIDENCE_READ");
      await rejectsWith(workspace(w), K.authz.TesAuthorizationDeniedError);
      await rejectsWith(assign(w, w.personB, "SERVICE_DECISION_AUTHORITY", randomUUID()), K.authz.TesAuthorizationDeniedError);

      // CONTRACT_MANAGE alone sees neither evidence metadata nor Master Register rows through RLS
      await signInWith("CONTRACT_MANAGE");
      const seen = await K.sys.withAuthorizedSystem("CONTRACT_MANAGE", async (client) => ({
        evidence: (await client.query(`SELECT count(*) FROM public.evidence_documents`)).rows[0].count,
        register: (await client.query(`SELECT count(*) FROM public.master_register_events`)).rows[0].count,
      }));
      assert.deepEqual(seen, { evidence: "0", register: "0" });

      K.db.setClerkUser(null);
      await assert.rejects(workspace(w));
    });

    it("lets a reviewer verify payload-backed evidence through the Master Register, and refuses a document that is not verified", async () => {
      await signInWith(...STAFF_CAPABILITIES);
      const w = await world();
      const doc = await K.fx.seedPayloadBackedDocument(pools.admin, { organizationId: w.organizationId, actorId: staffActorId, documentType: "CUSTOMER_AUTHORITY_NOTICE", status: "received" });
      await rejectsWith(assign(w, w.personA, "SERVICE_DECISION_AUTHORITY", doc), K.ct.ContractStateError);
      await K.ev.reviewEvidence({ organizationId: w.organizationId, documentId: doc, decision: "verified" });
      assert.ok((await masterEvents("VALIDATION_COMPLETED")) > 0);
      const created = await assign(w, w.personA, "SERVICE_DECISION_AUTHORITY", doc);
      assert.equal(created.assignmentStatus, "active");
    });
  });
});
