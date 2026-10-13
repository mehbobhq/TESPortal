import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

type Defs = typeof import("../../../lib/contracts/definitions.ts");
let D: Defs;

describe("Contracts vocabulary and pure rules", () => {
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    D = await import("@/lib/contracts/definitions");
  });

  it("models draft -> ready_for_signature -> signed -> superseded/archived", () => {
    assert.deepEqual([...D.CONTRACT_STATUSES], ["draft", "ready_for_signature", "signed", "superseded", "archived"]);
    assert.equal(D.canTransition("draft", "ready_for_signature"), true);
    assert.equal(D.canTransition("ready_for_signature", "signed"), true);
    assert.equal(D.canTransition("ready_for_signature", "draft"), true, "returned to draft when something material changes");
    assert.equal(D.canTransition("signed", "superseded"), true);
    assert.equal(D.canTransition("superseded", "archived"), true);
  });

  it("forbids shortcuts and reopening", () => {
    assert.equal(D.canTransition("draft", "signed"), false);
    assert.equal(D.canTransition("draft", "superseded"), false);
    assert.equal(D.canTransition("signed", "draft"), false);
    assert.equal(D.canTransition("signed", "ready_for_signature"), false);
    assert.equal(D.canTransition("archived", "draft"), false);
    assert.deepEqual(D.CONTRACT_TRANSITIONS.archived, []);
    for (const status of D.CONTRACT_STATUSES) assert.equal(D.canTransition(status, status), false);
  });

  it("has exactly two authority types and the ten readiness gates", () => {
    assert.deepEqual([...D.AUTHORITY_TYPES], ["SERVICE_DECISION_AUTHORITY", "CONTRACT_SIGNATORY"]);
    assert.equal(D.isAuthorityType("OPERATIONAL_CONTACT"), false);
    assert.equal(D.GATE_CODES.length, 10);
    for (const code of D.GATE_CODES) assert.ok(D.GATE_LABELS[code], code);
  });

  it("derives the responsibility boundary: history is excluded unless explicitly assumed", () => {
    assert.equal(D.deriveResponsibilityBoundary([]), "from_effective_responsibility_date_only");
    assert.equal(D.deriveResponsibilityBoundary(["excluded", "excluded"]), "from_effective_responsibility_date_only");
    assert.equal(D.deriveResponsibilityBoundary(["excluded", "customer_retains"]), "customer_retains_history");
    assert.equal(D.deriveResponsibilityBoundary(["customer_retains", "tes_assumes_with_evidence"]), "tes_assumes_defined_history_with_evidence");
  });

  it("validates calendar dates, codes and identifiers strictly", () => {
    assert.equal(D.isCalendarDate("2020-03-01"), true);
    assert.equal(D.isCalendarDate("2020-02-30"), false);
    assert.equal(D.isCalendarDate("2020-3-1"), false);
    assert.equal(D.isCalendarDate(undefined), false);
    assert.equal(D.isCode("COMPLIANCE_MONITORING"), true);
    assert.equal(D.isCode("compliance"), false);
    assert.equal(D.isCode("A"), false);
    assert.equal(D.isUuid("7b0a3c1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"), true);
    assert.equal(D.isUuid("nope"), false);
    assert.equal(D.isOneOf(D.PRICING_BASES, "to_be_defined"), false);
    assert.equal(D.isOneOf(D.PRICING_BASES, "monthly_package"), true);
  });
});

describe("Contracts operations validate before they touch the database", () => {
  type Ops = typeof import("../../../lib/contracts/operations.ts");
  let O: Ops;
  let E: typeof import("../../../lib/contracts/errors.ts");
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    O = await import("@/lib/contracts/operations");
    E = await import("@/lib/contracts/errors");
  });

  const queries: string[] = [];
  const ctx = () => {
    queries.length = 0;
    return {
      client: { query: async (sql: string) => { queries.push(sql); return { rows: [] }; } },
      actor: { id: "7b0a3c1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b", actorType: "HUMAN" as const },
      masterRegister: { append: async () => { queries.push("MASTER_REGISTER"); throw new Error("must not record on invalid input"); } },
    } as never;
  };
  const ID = "7b0a3c1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

  it("rejects malformed identifiers, unknown statuses and bad enumerations without any query or event", async () => {
    await assert.rejects(O.advanceContractStatus(ctx(), { contractId: "x", toStatus: "signed", evidenceDocumentId: ID }), E.ContractValidationError);
    await assert.rejects(O.advanceContractStatus(ctx(), { contractId: ID, toStatus: "frozen", evidenceDocumentId: ID }), E.ContractValidationError);
    await assert.rejects(O.advanceContractStatus(ctx(), { contractId: ID, toStatus: "signed", evidenceDocumentId: null }), E.ContractValidationError, "evidence is mandatory");
    await assert.rejects(O.assignCustomerAuthority(ctx(), { customerId: ID, organizationId: ID, personId: ID, authorityType: "OPERATIONAL_CONTACT", noticeEvidenceDocumentId: ID }), E.ContractValidationError);
    await assert.rejects(O.assignCustomerAuthority(ctx(), { customerId: ID, organizationId: ID, personId: ID, authorityType: "CONTRACT_SIGNATORY", noticeEvidenceDocumentId: undefined }), E.ContractValidationError, "a written notice is mandatory");
    await assert.rejects(O.revokeCustomerAuthority(ctx(), { assignmentId: ID, noticeEvidenceDocumentId: "" }), E.ContractValidationError);
    await assert.rejects(O.assignPricingPackage(ctx(), { lineItemId: ID, decisionEvidenceDocumentId: ID, pricingBasis: "to_be_defined" }), E.ContractValidationError);
    await assert.rejects(O.assignPricingPackage(ctx(), { lineItemId: ID, decisionEvidenceDocumentId: ID, pricingBasis: "monthly_package", packageCode: "PKG_A" }), E.ContractValidationError, "a monthly package needs a fee");
    await assert.rejects(O.assignPricingPackage(ctx(), { lineItemId: ID, decisionEvidenceDocumentId: ID, pricingBasis: "included_in_package", packageCode: "PKG_A", feeMinorUnits: 5, feeCurrency: "CAD" }), E.ContractValidationError);
    await assert.rejects(O.linkContractEvidence(ctx(), { contractId: ID, ruleCode: "lower", evidenceDocumentId: ID }), E.ContractValidationError);
    await assert.rejects(O.attachServiceScopes(ctx(), { contractId: ID, scopeIds: [] }), E.ContractValidationError);
    assert.deepEqual(queries, [], "nothing reached the database or the Master Register");
  });

  it("requires an explicit effective responsibility date and evidence for assumed history", async () => {
    const rows = (over: Record<string, unknown>) => [{ responsibilityArea: "AREA_ONE", responsibleParty: "TES", effectiveResponsibilityDate: "2020-03-01", ...over }];
    const define = (r: unknown[]) => O.defineResponsibilityBoundary(ctx(), { lineItemId: ID, decisionEvidenceDocumentId: ID, rows: r });
    await assert.rejects(define(rows({ effectiveResponsibilityDate: undefined })), E.ContractValidationError);
    await assert.rejects(define(rows({ effectiveResponsibilityDate: "yesterday" })), E.ContractValidationError);
    await assert.rejects(define(rows({ responsibleParty: "NOBODY" })), E.ContractValidationError);
    await assert.rejects(define(rows({ historyTreatment: "tes_assumes_with_evidence" })), E.ContractValidationError);
    await assert.rejects(define(rows({ historyTreatment: "tes_assumes_with_evidence", historyAssumedFrom: "2020-03-01", historyEvidenceDocumentId: ID })), E.ContractValidationError, "history must start before TES responsibility");
    await assert.rejects(define(rows({ historyTreatment: "tes_assumes_with_evidence", historyAssumedFrom: "2019-01-01" })), E.ContractValidationError, "assumed history needs evidence");
    await assert.rejects(define([...rows({}), ...rows({})]), E.ContractValidationError, "an area appears once");
    assert.deepEqual(queries, []);
  });
});
