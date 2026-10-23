import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateScope, validateScopeInput, SCOPE_RULES_VERSION, type ScopeInput } from "@/lib/driver-prospects/operating-scope";
import { jurisdictionGroups, orderScopeKinds } from "@/lib/jurisdiction-context";

const cdl = { cmvOperation: "YES", cdlRequired: "YES" } as const;
const evalOf = (input: ScopeInput) => {
  const v = validateScopeInput(input);
  assert.ok(v.ok, v.ok ? "" : v.errors.join("; "));
  return evaluateScope(v.value);
};
const profileOf = (input: ScopeInput) => {
  const e = evalOf(input);
  assert.ok(e.issuable, e.reason ?? "");
  return e.profile;
};

describe("operating scope -> application requirements (rules " + SCOPE_RULES_VERSION + ")", () => {
  it("1. U.S. intrastate CDL driver: U.S. region, Clearinghouse and DOT testing history apply, NO PSP unless intended, intrastate verification flagged", () => {
    const p = profileOf({ kind: "US_INTRASTATE", usJurisdictions: ["TX"], characteristics: cdl });
    assert.equal(p.applicationRegion, "United States");
    assert.deepEqual(p.sections, { clearinghouse: true, psp: false, dotDrugAlcoholHistory: true });
    assert.ok(p.manualVerification.some((m) => /Intrastate requirements of TX/.test(m)));
  });
  it("1b. U.S. intrastate non-CMV driver: no federal driver-qualification sections at all, 3-year history", () => {
    const p = profileOf({ kind: "US_INTRASTATE", usJurisdictions: ["TX"], characteristics: { cmvOperation: "NO" } });
    assert.deepEqual(p.sections, { clearinghouse: false, psp: false, dotDrugAlcoholHistory: false });
    assert.equal(p.employmentHistoryYears, 3);
  });
  it("2. U.S. interstate CDL driver: federal sections apply; 10-year history; PSP only when intended", () => {
    const base: ScopeInput = { kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: cdl };
    const p = profileOf(base);
    assert.equal(p.employmentHistoryYears, 10);
    assert.equal(p.sections.clearinghouse, true);
    assert.equal(p.sections.psp, false);
    const withPsp = profileOf({ ...base, characteristics: { ...cdl, pspIntended: true } });
    assert.equal(withPsp.sections.psp, true);
    assert.ok(withPsp.verification.some((v) => /PSP/.test(v)));
  });
  it("3. Canadian intraprovincial driver: Canada region, NO U.S. federal sections, 3-year baseline", () => {
    const p = profileOf({ kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["AB"] });
    assert.equal(p.applicationRegion, "Canada");
    assert.deepEqual(p.sections, { clearinghouse: false, psp: false, dotDrugAlcoholHistory: false });
    assert.equal(p.employmentHistoryYears, 3);
    assert.ok(p.verification.every((v) => !/FMCSA|PSP|Clearinghouse/.test(v)));
  });
  it("4. Canadian interprovincial driver: Canada region, no U.S. federal sections", () => {
    const p = profileOf({ kind: "CA_INTERPROVINCIAL", caJurisdictions: ["ON", "QC"] });
    assert.equal(p.applicationRegion, "Canada");
    assert.equal(p.sections.clearinghouse || p.sections.psp || p.sections.dotDrugAlcoholHistory, false);
  });
  it("5/6. cross-border CDL driver gets the combined requirements whichever country the company is in (company country is not an input)", () => {
    const p = profileOf({ kind: "CROSS_BORDER", usJurisdictions: ["MI"], caJurisdictions: ["ON"], characteristics: cdl });
    assert.equal(p.applicationRegion, "Cross-Border");
    assert.equal(p.sections.clearinghouse, true);
    assert.equal(p.employmentHistoryYears, 10);
    assert.ok(p.manualVerification.some((m) => /Provincial/.test(m)));
  });
  it("7. a domestic-only driver is NOT cross-border however the employer is authorized (scope never depends on the employer)", () => {
    const p = profileOf({ kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["BC"] });
    assert.notEqual(p.applicationRegion, "Cross-Border");
    const us = profileOf({ kind: "US_INTRASTATE", usJurisdictions: ["FL"], characteristics: cdl });
    assert.notEqual(us.applicationRegion, "Cross-Border");
  });
  it("8. an undetermined or missing scope blocks issuance with a reason", () => {
    for (const s of [null, validateScopeInput({ kind: "UNDETERMINED" })]) {
      const e = evaluateScope(s === null ? null : s.ok ? s.value : null);
      assert.equal(e.issuable, false);
      assert.match(e.reason ?? "", /not established/);
    }
  });
  it("blocks U.S. operations when CMV or CDL status is unknown, rather than sending a possibly wrong form", () => {
    assert.match(evalOf({ kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"] }).reason ?? "", /commercial motor vehicle/);
    assert.match(evalOf({ kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: { cmvOperation: "YES" } }).reason ?? "", /commercial driver's licence/);
  });
  it("Canada-only scopes are not blocked by U.S. questions", () => {
    assert.equal(evalOf({ kind: "CA_INTERPROVINCIAL", caJurisdictions: ["AB", "SK"] }).issuable, true);
  });
  it("mixed assignments combine requirements (union) and need jurisdictions for every component", () => {
    const p = profileOf({ kind: "MIXED", components: ["CA_INTERPROVINCIAL", "US_INTERSTATE"], caJurisdictions: ["ON", "QC"], usJurisdictions: ["NY", "OH"], characteristics: cdl });
    assert.equal(p.applicationRegion, "Cross-Border");
    const bad = validateScopeInput({ kind: "MIXED", components: ["CA_INTERPROVINCIAL", "US_INTERSTATE"], caJurisdictions: ["ON", "QC"] });
    assert.equal(bad.ok, false);
  });
  it("PSP cannot be requested for a Canada-only driver", () => {
    const v = validateScopeInput({ kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["AB"], characteristics: { pspIntended: true } });
    assert.equal(v.ok, false);
  });
  it("shape rules: intrastate is one state, interstate two or more, codes belong to their country", () => {
    assert.equal(validateScopeInput({ kind: "US_INTRASTATE", usJurisdictions: ["TX", "OK"] }).ok, false);
    assert.equal(validateScopeInput({ kind: "US_INTERSTATE", usJurisdictions: ["TX"] }).ok, false);
    assert.equal(validateScopeInput({ kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["TX"] }).ok, false);
    assert.equal(validateScopeInput({ kind: "CROSS_BORDER", usJurisdictions: ["TX"] }).ok, false);
    assert.equal(validateScopeInput({ kind: "NOPE" }).ok, false);
  });
  it("hazmat and passenger operations are recorded and flagged for manual verification, not silently ignored", () => {
    const p = profileOf({ kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: { ...cdl, hazmat: true, passengerCarrying: true } });
    assert.equal(p.manualVerification.filter((m) => /Hazardous|Passenger/.test(m)).length, 2);
  });
  it("every evaluation states its limitations (no claim of legal eligibility)", () => {
    const e = evalOf({ kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["AB"] });
    assert.ok(e.limitations.some((l) => /does not establish/.test(l)));
  });
});

describe("country-first presentation ordering (policy: context, never applicability)", () => {
  it("14. U.S. company: U.S. options and states first; Canadian company: Canada first; both always available", () => {
    assert.equal(orderScopeKinds("US")[0], "US_INTRASTATE");
    assert.equal(orderScopeKinds("CA")[0], "CA_INTRAPROVINCIAL");
    assert.equal(orderScopeKinds("US").length, orderScopeKinds("CA").length);
    assert.equal(jurisdictionGroups("US")[0].country, "United States");
    assert.equal(jurisdictionGroups("US")[0].term, "State");
    assert.equal(jurisdictionGroups("CA")[0].country, "Canada");
    assert.equal(jurisdictionGroups("CA")[0].term, "Province / territory");
    assert.equal(jurisdictionGroups("CA").flatMap((g) => g.options).length, jurisdictionGroups("US").flatMap((g) => g.options).length);
  });
  it("with no established presentation country the neutral order makes no assumption", () => {
    const neutral = orderScopeKinds(null);
    assert.notEqual(neutral[0], "UNDETERMINED");
    assert.equal(neutral.length, orderScopeKinds("US").length);
  });
});
