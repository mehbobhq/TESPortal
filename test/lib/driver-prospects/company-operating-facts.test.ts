import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCompanyFacts, deriveHazmat, INTENDED_OPERATION_LABEL, orderIntendedOperations, UNKNOWN_FACTS, DEFAULT_INTENDED_OPERATION,
  type CompanyOperatingFacts,
} from "@/lib/driver-prospects/company-operating-facts";
import { evaluateScope, validateScopeInput, type ScopeKind } from "@/lib/driver-prospects/operating-scope";
import { resolvePlan, type ApplicationPlan } from "@/lib/driver-application/plan";
import { CURRENT_CATALOGUE_VERSION } from "@/lib/driver-application/catalogue";
import { validAnswers } from "../../helpers/driver-application-fill";
import { validateAnswers } from "@/lib/driver-application/validate";

const reg = (country: "US" | "CA" | null) => ({ country, basis: country ? ("REGISTRATION" as const) : ("UNRESOLVED" as const), reason: country ? null : "The company's registered country is not recorded as the United States or Canada." });
const facts = (o: { country?: "US" | "CA" | null; hazmat?: "YES" | "NO" | "UNKNOWN"; psp?: "YES" | "NO" | "UNKNOWN" } = {}): CompanyOperatingFacts => ({
  registration: reg(o.country === undefined ? "CA" : o.country), operatingScope: null,
  hazmat: { value: o.hazmat ?? "NO", basis: "CARGO_RECORDED_WITHOUT_HAZMAT" }, psp: { value: o.psp ?? "UNKNOWN" },
  passengerCarrying: { value: "UNKNOWN", basis: "NO_CANONICAL_SOURCE" }, profileReadable: true,
});
const planFor = (kind: ScopeKind, f: CompanyOperatingFacts, extra: { stateOrProvince?: boolean } = {}): { plan: ApplicationPlan; needs: string[] } => {
  const v = validateScopeInput({ kind });
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  const eff = applyCompanyFacts(v.value, f);
  const e = evaluateScope(eff.scope);
  assert.ok(e.issuable && e.profile, e.reason ?? "not issuable");
  const plan = resolvePlan({ scope: eff.scope, needsAttention: eff.needsAttention, profile: e.profile, carrierCountry: f.registration.country, hrSelections: {}, gates: { vaultReady: false, approvedSensitiveFields: [] } });
  void extra;
  return { plan, needs: plan.regulatoryReviewRequirements.map((r) => r.id) };
};
const hazIds = (p: ApplicationPlan) => p.fields.filter((f) => f.id.startsWith("hazmat.") || f.id === "docs.hazmat_qualification").map((f) => f.id);
const paxIds = (p: ApplicationPlan) => p.fields.filter((f) => f.id.startsWith("passenger.") || f.id === "docs.passenger_qualification").map((f) => f.id);
const NONE = { uploads: [] as never[], sensitiveCollected: [] as string[], consents: [] as never[] };
const label = (k: string) => (INTENDED_OPERATION_LABEL as Record<string, string>)[k];

describe("Add Driver: company facts decide application content (enter once, reuse everywhere)", () => {
  it("1. Canadian-registered company: the six options appear in the required order with stable values", () => {
    const order = orderIntendedOperations("CA");
    assert.deepEqual(order.map(label), ["Canada wide", "Cross border", "US wide", "Canada Intraprovince", "US Intrastate", "Not yet decided"]);
    assert.deepEqual(order, ["CA_INTERPROVINCIAL", "CROSS_BORDER", "US_INTERSTATE", "CA_INTRAPROVINCIAL", "US_INTRASTATE", "UNDETERMINED"]);
    assert.equal(DEFAULT_INTENDED_OPERATION, "UNDETERMINED");
  });
  it("2. U.S.-registered company: the six options appear in the required order", () => {
    assert.deepEqual(orderIntendedOperations("US").map(label), ["US wide", "Cross border", "Canada wide", "US Intrastate", "Canada Intraprovince", "Not yet decided"]);
  });
  it("2b. registration only orders: every country yields the same six values; an unresolved country guesses nothing", () => {
    for (const c of ["CA", "US", null] as const) assert.deepEqual([...orderIntendedOperations(c)].sort(), [...orderIntendedOperations("CA")].sort());
    assert.equal(orderIntendedOperations(null).length, 6);
  });
  it("3. hazmat company: hazmat questions, evidence upload and verification requirement are included", () => {
    const { plan } = planFor("US_INTERSTATE", facts({ hazmat: "YES" }));
    assert.deepEqual(hazIds(plan).sort(), ["docs.hazmat_qualification", "hazmat.credential_expiry", "hazmat.prior_incident", "hazmat.prior_incident_details", "hazmat.qualification"]);
    assert.ok(plan.requirements.some((r) => r.key === "hazmat_qualification"));
    assert.equal(plan.context.hazmat, true);
  });
  it("3b. hazmat content is a driver self-declaration to verify; it never marks the driver qualified", () => {
    const { plan } = planFor("CA_INTERPROVINCIAL", facts({ hazmat: "YES" }));
    const req = plan.requirements.find((r) => r.key === "hazmat_qualification")!;
    assert.equal(req.requiredForQualification, false);
    assert.ok(plan.fields.find((f) => f.id === "hazmat.qualification")!.options!.some((o) => o.value === "none"), "'none yet' is an allowed answer");
  });
  it("4. passenger company: passenger content exists in the catalogue and is included when the characteristic is established", () => {
    const f = facts();
    f.passengerCarrying = { value: "YES", basis: "NO_CANONICAL_SOURCE" };
    const { plan } = planFor("US_INTERSTATE", f);
    assert.deepEqual(paxIds(plan).sort(), ["docs.passenger_qualification", "passenger.qualification"]);
    assert.ok(plan.requirements.some((r) => r.key === "passenger_qualification" && !r.requiredForQualification));
  });
  it("5. company without hazmat or passenger operations: those sections are NOT added by company configuration", () => {
    const { plan, needs } = planFor("US_INTERSTATE", facts({ hazmat: "NO" }));
    assert.deepEqual(hazIds(plan), []);
    assert.deepEqual(paxIds(plan), []);
    assert.ok(!needs.includes("company_fact.hazmat_unknown"));
    assert.ok(plan.requirements.every((r) => r.key !== "hazmat_qualification" && r.key !== "passenger_qualification"));
  });
  it("6. missing company information is never read as 'No'", () => {
    assert.equal(deriveHazmat({ readable: true, cargoCodes: [], dgRules: [] }).value, "UNKNOWN");
    assert.equal(deriveHazmat({ readable: false, cargoCodes: null, dgRules: [] }).value, "UNKNOWN");
    assert.equal(deriveHazmat({ readable: true, cargoCodes: ["GENERAL_FREIGHT"], dgRules: [] }).value, "NO");
    assert.equal(deriveHazmat({ readable: true, cargoCodes: ["HAZARDOUS_MATERIALS"], dgRules: [{ rule: "DG_US", applicability: "DOES_NOT_APPLY" }] }).value, "YES");
    assert.equal(deriveHazmat({ readable: true, cargoCodes: [], dgRules: [{ rule: "DG_US", applicability: "DOES_NOT_APPLY" }] }).value, "NO");
    const { plan, needs } = planFor("US_INTERSTATE", facts({ hazmat: "UNKNOWN" }));
    assert.ok(hazIds(plan).length > 0, "unknown hazmat keeps the hazmat sections");
    assert.ok(needs.includes("company_fact.hazmat_unknown"));
    const unread = planFor("CA_INTERPROVINCIAL", UNKNOWN_FACTS(reg(null)));
    assert.ok(unread.needs.includes("company_fact.hazmat_unknown") && unread.needs.includes("company_fact.registration_country_unresolved") && unread.needs.includes("company_fact.passenger_not_recorded"));
  });
  it("6b. passenger carrying has no canonical source: it is flagged, never assumed to be 'No' and never silently added", () => {
    const { plan, needs } = planFor("US_INTERSTATE", facts());
    assert.ok(needs.includes("company_fact.passenger_not_recorded"));
    assert.deepEqual(paxIds(plan), []);
  });
  it("7. a cross-border company can hire an intraprovincial or intrastate driver", () => {
    const company = facts({ country: "CA" });
    company.operatingScope = "CANADA_AND_UNITED_STATES";
    for (const kind of ["CA_INTRAPROVINCIAL", "US_INTRASTATE"] as const) {
      const { plan } = planFor(kind, company);
      assert.equal(plan.context.scopeKind, kind);
    }
  });
  it("7b. U.S. operations derive CMV/CDL from the intended operation instead of asking, and flag it for staff", () => {
    const { plan, needs } = planFor("US_INTERSTATE", facts());
    assert.equal(plan.context.cmv, "YES");
    assert.equal(plan.context.cdl, "YES");
    assert.ok(needs.includes("company_fact.us_cmv_presumed"));
    assert.ok(plan.sections.length > 0 && plan.context.involvesUS);
  });
  it("10. existing personalization still works: Canada-only gets no U.S. federal sections; cross border gets both; PSP follows the company rule", () => {
    const ca = planFor("CA_INTERPROVINCIAL", facts({ hazmat: "NO" })).plan;
    assert.equal(ca.context.involvesUS, false);
    assert.equal(ca.context.cmv, "UNKNOWN");
    assert.equal(ca.requirements.some((r) => r.key === "clearinghouse"), false);
    const cb = planFor("CROSS_BORDER", facts({ psp: "YES" })).plan;
    assert.ok(cb.context.involvesUS && cb.context.involvesCA);
    assert.equal(cb.context.psp, true);
    assert.ok(cb.requirements.some((r) => r.key === "clearinghouse"));
    assert.equal(planFor("CROSS_BORDER", facts({ psp: "NO" })).plan.context.psp, false);
  });
  it("10b. hazmat answers validate and the previous catalogue version still resolves for frozen plans", () => {
    assert.equal(CURRENT_CATALOGUE_VERSION, "driver-application/2");
    const { plan } = planFor("US_INTERSTATE", facts({ hazmat: "YES" }));
    const answers = validAnswers(plan, { "hazmat.qualification": "none", "hazmat.prior_incident": "no" });
    const result = validateAnswers(plan, answers, "submit", NONE);
    assert.equal(result.errors["hazmat.qualification"], undefined);
    assert.equal(result.errors["hazmat.prior_incident"], undefined);
    assert.equal(result.errors["docs.hazmat_qualification"], undefined, "evidence is not demanded from a driver who holds nothing yet");
    const vs = validateScopeInput({ kind: "CA_INTERPROVINCIAL" });
    assert.ok(vs.ok);
    const e = evaluateScope(vs.value);
    const v1 = resolvePlan({ scope: vs.value, profile: e.profile!, carrierCountry: "CA", hrSelections: {}, gates: { vaultReady: false, approvedSensitiveFields: [] }, catalogueVersion: "driver-application/1" });
    assert.equal(v1.catalogueVersion, "driver-application/1");
    assert.equal(v1.fields.some((f) => f.id.startsWith("hazmat.")), false);
  });
  it("company facts do not alter the driver's own characteristics when the company says NO", () => {
    const v = validateScopeInput({ kind: "US_INTERSTATE" });
    assert.ok(v.ok);
    const eff = applyCompanyFacts(v.value, facts({ hazmat: "NO" }));
    assert.equal(eff.scope.characteristics.hazmat, false);
    assert.equal(eff.scope.characteristics.passengerCarrying, false);
  });
});
