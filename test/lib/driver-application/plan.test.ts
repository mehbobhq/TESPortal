import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { canonicalJson, sha256Canonical } from "@/lib/driver-application/canonical";
import { resolvePlan, planSha256, validateHrSelections, type ApplicationPlan } from "@/lib/driver-application/plan";
import { buildSnapshot, snapshotSha256 } from "@/lib/driver-application/snapshot";
import { coverage, validateAnswers, applicableFields, normalizeName } from "@/lib/driver-application/validate";
import { decryptSensitive, encryptSensitive, normalizeSensitive, SensitiveValueError, vaultReady } from "@/lib/driver-application/sensitive";
import { evaluateScope, validateScopeInput, type ScopeInput } from "@/lib/driver-prospects/operating-scope";
import { validAnswers } from "../../helpers/driver-application-fill";

const CDL = { cmvOperation: "YES", cdlRequired: "YES" } as const;
const SCENARIOS: Array<{ name: string; carrier: "US" | "CA"; input: ScopeInput }> = [
  { name: "US intrastate", carrier: "US", input: { kind: "US_INTRASTATE", usJurisdictions: ["TX"], characteristics: CDL } },
  { name: "US interstate", carrier: "US", input: { kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: CDL } },
  { name: "CA intraprovincial", carrier: "CA", input: { kind: "CA_INTRAPROVINCIAL", caJurisdictions: ["ON"] } },
  { name: "CA interprovincial", carrier: "CA", input: { kind: "CA_INTERPROVINCIAL", caJurisdictions: ["ON", "QC"] } },
  { name: "cross-border (CA carrier)", carrier: "CA", input: { kind: "CROSS_BORDER", usJurisdictions: ["MI"], caJurisdictions: ["ON"], characteristics: CDL } },
  { name: "cross-border (US carrier)", carrier: "US", input: { kind: "CROSS_BORDER", usJurisdictions: ["MI"], caJurisdictions: ["ON"], characteristics: CDL } },
];

function planFor(input: ScopeInput, carrier: "US" | "CA", extra: { hr?: Record<string, { enabled: boolean; acknowledgedRestriction?: boolean }>; vault?: boolean; approved?: string[]; stage?: "PRE_OFFER" | "CONDITIONAL_OFFER" } = {}): ApplicationPlan {
  const v = validateScopeInput(input);
  assert.ok(v.ok);
  const e = evaluateScope(v.ok ? v.value : null);
  assert.ok(e.issuable && e.profile);
  return resolvePlan({
    scope: (v as unknown as { value: never }).value, profile: e.profile!, carrierCountry: carrier, hrSelections: extra.hr ?? {},
    collectionStage: extra.stage, gates: { vaultReady: extra.vault ?? false, approvedSensitiveFields: extra.approved ?? [] },
  });
}

describe("universal application: one catalogue, six operating scenarios", () => {
  const plans = SCENARIOS.map((s) => ({ ...s, plan: planFor(s.input, s.carrier) }));

  it("every scenario resolves from the SAME catalogue and rules version (no per-scenario form)", () => {
    assert.equal(new Set(plans.map((p) => p.plan.catalogueVersion)).size, 1);
    assert.equal(new Set(plans.map((p) => p.plan.rulesVersion)).size, 1);
    const universe = new Set(plans.flatMap((p) => p.plan.fields.map((f) => f.id)));
    for (const p of plans) for (const f of p.plan.fields) assert.ok(universe.has(f.id));
  });

  it("the plan follows the operation, not the carrier's country: the same scope yields the same questions from either carrier", () => {
    const fromCa = planFor(SCENARIOS[4].input, "CA");
    const fromUs = planFor(SCENARIOS[4].input, "US");
    assert.deepEqual(fromCa.fields.map((f) => f.id), fromUs.fields.map((f) => f.id));
    assert.deepEqual(fromCa.consents.map((c) => c.key), fromUs.consents.map((c) => c.key));
  });

  it("U.S. scenarios carry the U.S. federal items; Canadian-only scenarios carry none", () => {
    const keys = (p: ApplicationPlan) => p.consents.map((c) => c.key);
    assert.ok(plans[1].plan.context.dotDrugAlcohol && plans[1].plan.context.involvesUS);
    assert.ok(keys(plans[1].plan).includes("clearinghouse_limited_query"));
    for (const i of [2, 3]) {
      assert.equal(plans[i].plan.context.involvesUS, false);
      assert.equal(plans[i].plan.context.dotDrugAlcohol, false);
      assert.ok(!keys(plans[i].plan).includes("clearinghouse_limited_query"));
      assert.ok(plans[i].plan.requirements.every((r) => r.type !== "CLEARINGHOUSE" && r.type !== "PSP"));
    }
    assert.ok(plans[4].plan.context.involvesUS && plans[4].plan.context.involvesCA, "cross-border involves both");
  });

  it("history years follow the scope rules (3 or 10) and cross-border lists the unresolved applicability as a review requirement", () => {
    assert.equal(plans[1].plan.context.historyYears, 10);
    assert.equal(plans[2].plan.context.historyYears, 3);
    for (const i of [4, 5]) assert.ok(plans[i].plan.regulatoryReviewRequirements.some((r) => r.id === "cross_border_applicability"));
    assert.ok(plans[0].plan.regulatoryReviewRequirements.some((r) => r.id === "us_intrastate_state_rules"));
  });

  it("a plan is deterministic and hashed; any change to the scope changes the hash", () => {
    const a = planFor(SCENARIOS[1].input, "US");
    const b = planFor(SCENARIOS[1].input, "US");
    assert.equal(planSha256(a), planSha256(b));
    assert.match(planSha256(a), /^[0-9a-f]{64}$/);
    assert.notEqual(planSha256(a), planSha256(planFor(SCENARIOS[2].input, "CA")));
  });

  it("every cited legal source is marked unverified by counsel; nothing claims compliance", () => {
    for (const p of plans) {
      for (const s of Object.values(p.plan.legalSources)) assert.equal(s.verification, "UNVERIFIED_BY_COUNSEL");
      assert.ok(p.plan.limitations.some((l) => /does not establish/.test(l)));
    }
  });

  it("authorizations: none is marked APPROVED without verified counsel text; PSP is an external process the form never signs", () => {
    for (const p of plans) {
      for (const c of p.plan.consents) {
        assert.ok(c.text.length > 0 && c.textSha256.length === 64);
        if (c.legalStatus === "APPROVED") assert.fail(`${c.key} is APPROVED but no counsel approval exists in this repository`);
      }
    }
    const psp = planFor({ kind: "US_INTERSTATE", usJurisdictions: ["OH", "PA"], characteristics: { ...CDL, pspIntended: true } }, "US").consents.find((c) => c.key === "psp");
    assert.ok(psp?.external && psp.legalStatus === "EXTERNAL_PROCESS_REQUIRED");
  });
});

describe("sensitive identifiers stay OFF until encryption and legal approval both exist", () => {
  it("default plan: every gated field is disabled, with the reason and an open regulatory review requirement", () => {
    const plan = planFor(SCENARIOS[1].input, "US");
    const sensitive = plan.fields.filter((f) => f.type === "sensitive");
    assert.ok(sensitive.length > 0, "the U.S. CMV plan names the SSN item");
    for (const f of sensitive) {
      assert.equal(f.collection.enabled, false);
      assert.ok(f.collection.disabledReason);
    }
  });
  it("a configured key alone is not enough: legal approval of each field is also required", () => {
    const plan = planFor(SCENARIOS[1].input, "US", { vault: true });
    assert.ok(plan.fields.filter((f) => f.type === "sensitive").every((f) => !f.collection.enabled));
    const target = plan.fields.find((f) => f.type === "sensitive")!;
    const approved = planFor(SCENARIOS[1].input, "US", { vault: true, approved: [target.id] });
    assert.equal(approved.fields.find((f) => f.id === target.id)!.collection.enabled, true);
  });
  it("encryption: AES-256-GCM bound to application and field; wrong context cannot decrypt; masked value never holds the identifier", () => {
    const prior = process.env.TES_SENSITIVE_DATA_KEY;
    try {
      delete process.env.TES_SENSITIVE_DATA_KEY;
      assert.equal(vaultReady(), false);
      assert.throws(() => encryptSensitive("app-1", "f", "123456789"), SensitiveValueError);
      process.env.TES_SENSITIVE_DATA_KEY = randomBytes(32).toString("base64");
      assert.equal(vaultReady(), true);
      const sealed = encryptSensitive("app-1", "eligibility.ssn", "123456789");
      assert.ok(!sealed.ciphertext.toString("utf8").includes("123456789"));
      assert.equal(decryptSensitive("app-1", "eligibility.ssn", sealed.ciphertext, sealed.nonce), "123456789");
      assert.throws(() => decryptSensitive("app-2", "eligibility.ssn", sealed.ciphertext, sealed.nonce));
      assert.throws(() => decryptSensitive("app-1", "identity.sin", sealed.ciphertext, sealed.nonce));
      const n = normalizeSensitive("eligibility.ssn", "123-45-6789");
      assert.equal(n.normalized, "123456789");
      assert.ok(!n.masked.includes("12345") && n.masked.endsWith("6789"));
    } finally {
      if (prior === undefined) delete process.env.TES_SENSITIVE_DATA_KEY;
      else process.env.TES_SENSITIVE_DATA_KEY = prior;
    }
  });
});

describe("carrier HR layer: the legal matrix", () => {
  it("a PROHIBITED item can never be enabled, a RESTRICTED one needs acknowledgement, and cross-border uses the strictest rule", () => {
    assert.equal(validateHrSelections({ credit_check: { enabled: true } }, { involvesUS: true, involvesCA: false }, "PRE_OFFER").ok, false);
    assert.equal(validateHrSelections({ citizenship_inquiry: { enabled: true, acknowledgedRestriction: true } }, { involvesUS: true, involvesCA: true }, "POST_OFFER").ok, false);
    const bg = (ack: boolean, us: boolean, ca: boolean, stage: "PRE_OFFER" | "CONDITIONAL_OFFER") =>
      validateHrSelections({ background_screening: { enabled: true, acknowledgedRestriction: ack } }, { involvesUS: us, involvesCA: ca }, stage).ok;
    assert.equal(bg(false, true, false, "PRE_OFFER"), false, "U.S. pre-offer: restricted, needs acknowledgement");
    assert.equal(bg(true, true, false, "PRE_OFFER"), true);
    assert.equal(bg(true, false, true, "PRE_OFFER"), false, "Canada pre-offer: prohibited even with acknowledgement");
    assert.equal(bg(false, false, true, "CONDITIONAL_OFFER"), false, "Canada after a conditional offer: restricted");
    assert.equal(bg(true, false, true, "CONDITIONAL_OFFER"), true);
    assert.equal(bg(false, true, true, "CONDITIONAL_OFFER"), false, "cross-border takes the strictest of the two countries");
    assert.equal(bg(true, true, true, "PRE_OFFER"), false, "cross-border pre-offer inherits Canada's prohibition");
    assert.equal(validateHrSelections({ made_up: { enabled: true } }, { involvesUS: true, involvesCA: false }, "PRE_OFFER").ok, false);
  });
  it("an enabled HR item adds its questions; a disabled one adds none", () => {
    const without = planFor(SCENARIOS[2].input, "CA");
    const withRefs = planFor(SCENARIOS[2].input, "CA", { hr: { professional_references: { enabled: true } } });
    assert.ok(!without.fields.some((f) => f.id === "hr.references"));
    assert.ok(withRefs.fields.some((f) => f.id === "hr.references"));
    assert.ok(withRefs.requirements.some((r) => r.key === "references"));
  });
  it("Canadian pre-offer plans do not collect date of birth before a conditional offer; U.S. plans do", () => {
    assert.ok(!planFor(SCENARIOS[2].input, "CA").fields.some((f) => f.id === "identity.date_of_birth"));
    assert.ok(planFor(SCENARIOS[1].input, "US").fields.some((f) => f.id === "identity.date_of_birth"));
  });
});

describe("conditional validation", () => {
  const plan = planFor(SCENARIOS[1].input, "US");
  const none = { uploads: [] as never[], sensitiveCollected: [] as string[], consents: [] as never[] };

  it("a complete valid answer set passes every field check (uploads and signatures are separate)", () => {
    const answers = validAnswers(plan);
    const r = validateAnswers(plan, answers, "submit", none);
    assert.deepEqual(Object.keys(r.errors).filter((k) => !plan.fields.find((f) => f.id === k && f.type === "upload")), [], JSON.stringify(r.errors));
    assert.deepEqual(r.itemErrors, {});
  });
  it("answering yes to a gating question makes its follow-ups required; answering no hides them and keeps the old answer out of the current facts", () => {
    const base = validAnswers(plan);
    const gate = plan.fields.find((f) => f.id === "licence.denied_suspended_revoked")!;
    const yes = { ...base, [gate.id]: "yes" };
    assert.ok(validateAnswers(plan, yes, "submit", none).errors["licence.denied_suspended_revoked_details"]);
    const detailed = { ...yes, "licence.denied_suspended_revoked_details": "Suspended in 2019, reinstated." };
    assert.equal(validateAnswers(plan, detailed, "submit", none).errors["licence.denied_suspended_revoked_details"], undefined);
    const retracted = { ...detailed, [gate.id]: "no" };
    assert.equal(applicableFields(plan, retracted).some((a) => a.field.id === "licence.denied_suspended_revoked_details"), false);
    const snap = buildSnapshot({ plan, planSha256: planSha256(plan), answers: retracted, consents: [], presentations: [], uploads: [], sensitiveCollected: [] });
    assert.ok(!snap.fields.some((f) => f.id === "licence.denied_suspended_revoked_details"), "not a current declared fact");
    assert.ok(snap.retainedNotApplicable.includes("licence.denied_suspended_revoked_details"), "but retained");
  });
  it("employment history must cover the required years and gaps over 30 days must be explained", () => {
    const today = new Date("2026-06-01T00:00:00Z");
    assert.equal(coverage([{ from: "2015-01-01" }], 10, today).ok, true);
    const gap = coverage([{ from: "2018-01-01", to: "2020-01-01" }, { from: "2020-03-15" }], 10, today);
    assert.equal(gap.ok, false);
    assert.ok(gap.gaps.length >= 1);
    assert.equal(coverage([{ from: "2018-12-01" }], 3, new Date("2022-01-01T00:00:00Z")).ok, true);
  });
  it("format and range checks reject bad values; names are compared normalized", () => {
    const base = validAnswers(plan);
    assert.ok(validateAnswers(plan, { ...base, "identity.email": "nope" }, "submit", none).errors["identity.email"]);
    assert.ok(validateAnswers(plan, { ...base, "identity.date_of_birth": "2015-01-01" }, "submit", none).errors["identity.date_of_birth"]);
    assert.ok(validateAnswers(plan, { ...base, "identity.date_of_birth": "2999-01-01" }, "submit", none).errors["identity.date_of_birth"]);
    assert.equal(normalizeName("  José   GARCÍA "), normalizeName("josé garcía"));
  });
  it("draft mode accepts incomplete answers; submit mode lists every missing required item and every unsigned authorization", () => {
    assert.equal(Object.keys(validateAnswers(plan, {}, "draft", none).errors).length, 0);
    const r = validateAnswers(plan, {}, "submit", none);
    assert.ok(Object.keys(r.errors).length > 5);
    assert.ok(r.missingConsents.length > 0);
    assert.equal(r.ok, false);
  });
});

describe("snapshot and hashing", () => {
  it("canonical JSON is key-order independent and the snapshot hash is stable", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 1, c: 2 } }), canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
    assert.equal(sha256Canonical({ a: 1, b: 2 }), sha256Canonical({ b: 2, a: 1 }));
    const plan = planFor(SCENARIOS[2].input, "CA");
    const answers = validAnswers(plan);
    const a = buildSnapshot({ plan, planSha256: planSha256(plan), answers, consents: [], presentations: [], uploads: [], sensitiveCollected: [] });
    const b = buildSnapshot({ plan, planSha256: planSha256(plan), answers: Object.fromEntries(Object.entries(answers).reverse()), consents: [], presentations: [], uploads: [], sensitiveCollected: [] });
    assert.equal(snapshotSha256(a), snapshotSha256(b));
    assert.ok(a.fields.every((f) => f.status === "APPLICANT_DECLARED"), "nothing in a submission is verified");
  });
});
