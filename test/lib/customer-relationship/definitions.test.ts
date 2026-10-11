import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

type Defs = typeof import("../../../lib/customer-relationship/definitions.ts");
let D: Defs;

describe("Customer Relationship vocabulary", () => {
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    D = await import("@/lib/customer-relationship/definitions");
  });

  it("engagement types are RECURRING and ONE_OFF only; TRIAL and MANAGED_PROBATION are stages", () => {
    assert.deepEqual([...D.ENGAGEMENT_TYPES], ["RECURRING", "ONE_OFF"]);
    for (const stage of ["TRIAL", "MANAGED_PROBATION", "ONBOARDING", "ACTIVE", "SUSPENDED", "ENDED"]) assert.equal(D.isEngagementType(stage), false, stage);
  });

  it("the six stages, with TRIAL and MANAGED_PROBATION bounded and ENDED terminal", () => {
    assert.deepEqual(D.ENGAGEMENT_STAGES, ["ONBOARDING", "TRIAL", "ACTIVE", "MANAGED_PROBATION", "SUSPENDED", "ENDED"]);
    assert.deepEqual(D.ENGAGEMENT_STAGES.filter((stage) => D.STAGE_DEFINITIONS[stage].bounded), ["TRIAL", "MANAGED_PROBATION"]);
    assert.deepEqual(D.ENGAGEMENT_STAGES.filter((stage) => D.STAGE_DEFINITIONS[stage].terminal), ["ENDED"]);
    assert.equal(D.isEngagementStage("ACTIVE"), true);
    assert.equal(D.isEngagementStage("active"), false);
    assert.equal(D.isEngagementStage("toString"), false, "prototype keys are not stages");
    assert.equal(D.isEngagementStage("__proto__"), false);
  });

  it("the three product layers; service codes are catalogue keys", () => {
    assert.deepEqual([...D.PRODUCT_LEVELS], ["COMPLIANCE", "BUSINESS_INTELLIGENCE", "DECISION_SUPPORT"]);
    assert.equal(D.isProductLevel("COMPLIANCE"), true);
    assert.equal(D.isProductLevel("compliance"), false);
    assert.equal(D.isServiceCode("SOME_SERVICE"), true);
    for (const bad of ["", "a", "lower_case", "1ABC", "HAS SPACE", 7, null, undefined]) assert.equal(D.isServiceCode(bad), false, String(bad));
  });

  it("there is no stage-transition matrix and no duration limit in the vocabulary", () => {
    assert.deepEqual(Object.keys(D).filter((key) => /transition|maximum|max|days|limit|policy/i.test(key)), []);
  });
});
