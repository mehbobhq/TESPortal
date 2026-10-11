import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

type Defs = typeof import("../../../lib/company-profile/definitions.ts");
type Legacy = typeof import("../../../lib/company-profile/legacy.ts");
let D: Defs;
let L: Legacy;

const ROOT = path.resolve(import.meta.dirname, "../../..");

before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  D = await import("@/lib/company-profile/definitions");
  L = await import("@/lib/company-profile/legacy");
});

describe("Company Operating Profile vocabulary", () => {
  it("operating scopes, applicabilities, sections and regions are the controlled sets; 'not configured' is not an applicability", () => {
    assert.deepEqual([...D.OPERATING_SCOPES], ["CANADA", "UNITED_STATES", "CANADA_AND_UNITED_STATES"]);
    assert.deepEqual([...D.APPLICABILITIES], ["APPLIES", "DOES_NOT_APPLY"]);
    assert.deepEqual([...D.RULE_SECTIONS], ["CARGO", "OPERATIONS", "TAX", "DRIVERS", "PROGRAMS"]);
    assert.deepEqual([...D.REGIONS], ["CANADA", "UNITED_STATES", "BOTH"]);
    for (const bad of ["NOT_CONFIGURED", "applies", "BOTH", "", null, undefined, 1]) assert.equal(D.isApplicability(bad), false, String(bad));
    for (const bad of ["both", "CANADA_AND_US", "BOTH", "us", "", null, undefined]) assert.equal(D.isOperatingScope(bad), false, String(bad));
    assert.equal(D.isOperatingScope("CANADA_AND_UNITED_STATES"), true);
    assert.equal(D.isRuleSection("TAX"), true);
    assert.equal(D.isRegion("BOTH"), true);
    assert.equal(D.isRegion("MEXICO"), false);
  });

  it("the catalogue has 45 unique rules, in the five sections, each with a well-formed code", () => {
    assert.equal(D.RULE_DEFINITIONS.length, 45);
    assert.equal(new Set(D.RULE_CODES).size, 45);
    for (const rule of D.RULE_DEFINITIONS) {
      assert.match(rule.code, /^[A-Z][A-Z0-9_]{1,47}$/, rule.code);
      assert.ok(D.isRuleSection(rule.section), rule.code);
      assert.ok(D.isRegion(rule.appliesToRegion), rule.code);
      assert.ok(rule.defaultApplicability === null || rule.defaultApplicability === "APPLIES", rule.code);
      assert.notEqual(rule.displayName.trim(), "", rule.code);
    }
    const bySection = (section: string) => D.RULE_DEFINITIONS.filter((rule) => rule.section === section).length;
    assert.deepEqual(["CARGO", "OPERATIONS", "TAX", "DRIVERS", "PROGRAMS"].map(bySection), [13, 1, 11, 11, 9]);
  });

  it("only TAX rules point at a registration program; Form 2290 points at nothing; each program is used once", () => {
    const withProgram = D.RULE_DEFINITIONS.filter((rule) => rule.registrationProgramCode !== null);
    for (const rule of withProgram) assert.equal(rule.section, "TAX", rule.code);
    assert.equal(D.getRuleDefinition("FORM_2290")?.registrationProgramCode, null);
    assert.equal(new Set(withProgram.map((rule) => rule.registrationProgramCode)).size, withProgram.length);
    assert.equal(withProgram.length, 10);
    assert.equal(D.getRuleDefinition("FUEL_CHARGE_REGISTRATION")?.registrationProgramCode, "FUEL_CHARGE");
    assert.equal(D.getRuleDefinition("TEXAS_EXCISE_TAX")?.registrationProgramCode, "TX_EXCISE");
  });

  it("the catalogue defaults are exactly the eight APPLIES defaults the legacy Settings workspace pre-filled", () => {
    assert.deepEqual(
      D.RULE_DEFINITIONS.filter((rule) => rule.defaultApplicability === "APPLIES").map((rule) => rule.code),
      ["DG_CANADA", "DG_US", "BACKGROUND_CHECK", "ANNUAL_ROAD_TEST", "PRE_EMPLOYMENT_ROAD_TEST", "CANADIAN_DRUG_ALCOHOL", "TAX_DOCUMENTS", "PASSPORT_US"],
    );
  });

  it("rule codes are strict: exact upper snake case, no trimming or case folding", () => {
    assert.equal(D.isRuleCode("DG_US"), true);
    for (const bad of ["dg_us", " DG_US", "DG_US ", "NOPE", "", null, undefined, 4, "__proto__", "constructor"]) assert.equal(D.isRuleCode(bad), false, String(bad));
    assert.equal(D.isRuleCodeShape("ANY_NEW_RULE"), true);
    for (const bad of ["a", "1ABC", "HAS SPACE", "lower", "X".repeat(49)]) assert.equal(D.isRuleCodeShape(bad), false, bad);
    assert.equal(D.getRuleDefinition("toString"), undefined);
  });

  it("effectiveApplicability: explicit assertion, else the catalogue default, else NOT_CONFIGURED", () => {
    const defaulted = D.getRuleDefinition("DG_CANADA")!;
    const plain = D.getRuleDefinition("DG_COLORADO")!;
    assert.deepEqual(D.effectiveApplicability(defaulted, null), { effective: "APPLIES", source: "DEFAULT" });
    assert.deepEqual(D.effectiveApplicability(defaulted, "DOES_NOT_APPLY"), { effective: "DOES_NOT_APPLY", source: "ASSERTED" });
    assert.deepEqual(D.effectiveApplicability(defaulted, "APPLIES"), { effective: "APPLIES", source: "ASSERTED" });
    assert.deepEqual(D.effectiveApplicability(plain, null), { effective: "NOT_CONFIGURED", source: "NOT_CONFIGURED" });
    assert.deepEqual(D.effectiveApplicability(plain, "APPLIES"), { effective: "APPLIES", source: "ASSERTED" });
    assert.deepEqual(D.effectiveApplicability(plain, "DOES_NOT_APPLY"), { effective: "DOES_NOT_APPLY", source: "ASSERTED" });
  });

  it("region relevance: BOTH rules suit every scope; a dual-scope company suits every rule", () => {
    const canada = D.getRuleDefinition("DG_CANADA")!;
    const us = D.getRuleDefinition("DG_US")!;
    const both = D.getRuleDefinition("IFTA")!;
    assert.equal(D.isRuleRelevantToScope(canada, "CANADA"), true);
    assert.equal(D.isRuleRelevantToScope(canada, "UNITED_STATES"), false);
    assert.equal(D.isRuleRelevantToScope(us, "UNITED_STATES"), true);
    assert.equal(D.isRuleRelevantToScope(us, "CANADA"), false);
    for (const scope of D.OPERATING_SCOPES) {
      assert.equal(D.isRuleRelevantToScope(both, scope), true);
      assert.equal(D.isRuleRelevantToScope(canada, "CANADA_AND_UNITED_STATES"), true);
      assert.equal(D.isRuleRelevantToScope(us, "CANADA_AND_UNITED_STATES"), true);
    }
  });

  it("driver minimums: whole numbers only, bounds mirror the schema (age 16-100 years, experience 0-600 months)", () => {
    assert.deepEqual(D.DRIVER_AGE_YEARS, { min: 16, max: 100 });
    assert.deepEqual(D.DRIVER_EXPERIENCE_MONTHS, { min: 0, max: 600 });
    for (const ok of [16, 21, 100]) assert.equal(D.isDriverAgeYears(ok), true, String(ok));
    for (const bad of [15, 101, 21.5, "21", null, undefined, Number.NaN, Infinity, -1]) assert.equal(D.isDriverAgeYears(bad), false, String(bad));
    for (const ok of [0, 24, 600]) assert.equal(D.isDriverExperienceMonths(ok), true, String(ok));
    for (const bad of [-1, 601, 0.5, "24", null, undefined, Number.NaN]) assert.equal(D.isDriverExperienceMonths(bad), false, String(bad));
  });

  it("there is no key/value, preference or settings vocabulary", () => {
    assert.deepEqual(Object.keys(D).filter((key) => /preference|keyvalue|settings|theme|layout/i.test(key)), []);
  });
});

describe("legacy Settings vocabulary mapping", () => {
  it("jurisdiction: canada | us | both map to the three operating scopes; everything else is UNMAPPABLE", () => {
    assert.deepEqual(L.mapLegacyJurisdiction("canada"), { status: "MAPPED", operatingScope: "CANADA" });
    assert.deepEqual(L.mapLegacyJurisdiction("us"), { status: "MAPPED", operatingScope: "UNITED_STATES" });
    assert.deepEqual(L.mapLegacyJurisdiction("both"), { status: "MAPPED", operatingScope: "CANADA_AND_UNITED_STATES" });
    for (const bad of ["Canada", "US", "BOTH", "usa", "", " both", null, undefined, 1, "__proto__", "toString", "constructor"]) {
      assert.deepEqual(L.mapLegacyJurisdiction(bad), { status: "UNMAPPABLE" }, String(bad));
    }
  });

  it("rule ids are the lower-case spelling of the canonical codes; every canonical rule is reachable", () => {
    assert.equal(L.LEGACY_RULE_IDS.length, 45);
    for (const rule of D.RULE_DEFINITIONS) assert.equal(L.mapLegacyRuleId(rule.code.toLowerCase()), rule.code);
    for (const bad of ["DG_US", "Dg_us", "unknown_rule", "", null, undefined, 3, "overview", "__proto__"]) assert.equal(L.mapLegacyRuleId(bad), null, String(bad));
  });

  it("rule values: applies -> APPLIES, does-not-apply -> DOES_NOT_APPLY, not-configured -> no assertion; anything else is UNMAPPABLE", () => {
    assert.deepEqual(L.mapLegacyRule("dg_colorado", "applies"), { status: "ASSERTION", ruleCode: "DG_COLORADO", applicability: "APPLIES", redundantWithDefault: false });
    assert.deepEqual(L.mapLegacyRule("dg_colorado", "does-not-apply"), { status: "ASSERTION", ruleCode: "DG_COLORADO", applicability: "DOES_NOT_APPLY", redundantWithDefault: false });
    assert.deepEqual(L.mapLegacyRule("dg_colorado", "not-configured"), { status: "NO_ASSERTION", ruleCode: "DG_COLORADO", overridesDefault: false });
    // a catalogue-default rule: 'applies' is redundant, 'not-configured' deliberately moved away from the default
    assert.deepEqual(L.mapLegacyRule("dg_canada", "applies"), { status: "ASSERTION", ruleCode: "DG_CANADA", applicability: "APPLIES", redundantWithDefault: true });
    assert.deepEqual(L.mapLegacyRule("dg_canada", "not-configured"), { status: "NO_ASSERTION", ruleCode: "DG_CANADA", overridesDefault: true });
    for (const bad of ["APPLIES", "yes", "", null, undefined, true, 1]) assert.deepEqual(L.mapLegacyRule("dg_canada", bad), { status: "UNMAPPABLE" }, String(bad));
    assert.deepEqual(L.mapLegacyRule("nonsense", "applies"), { status: "UNMAPPABLE" });
    assert.deepEqual([...L.LEGACY_RULE_VALUES], ["applies", "does-not-apply", "not-configured"]);
  });

  it("the legacy rule ids in the Settings page are exactly the 45 canonical rules", () => {
    const page = readFileSync(path.join(ROOT, "app/companies/[id]/settings/page.tsx"), "utf8");
    const ids = [...page.slice(page.indexOf("const RULES"), page.indexOf("] as const")).matchAll(/^\s+id: "([a-z0-9_]+)",$/gm)].map((match) => match[1]);
    const ruleIds = ids.filter((id) => !["overview", "cargo", "operations", "tax", "drivers", "programs"].includes(id));
    assert.deepEqual([...ruleIds].sort(), [...L.LEGACY_RULE_IDS].sort());
    assert.equal(ruleIds.length, 45);
  });

  it("legacy defaults in the Settings page agree with the catalogue defaults", () => {
    const page = readFileSync(path.join(ROOT, "app/companies/[id]/settings/page.tsx"), "utf8");
    const section = page.slice(page.indexOf("const RULES"), page.indexOf("] as const"));
    const defaulted = [...section.matchAll(/id: "([a-z0-9_]+)",[\s\S]*?(?=\n\s+\},)/g)].filter((match) => /defaultValue: "applies"/.test(match[0])).map((match) => match[1].toUpperCase());
    assert.deepEqual(defaulted.sort(), D.RULE_DEFINITIONS.filter((rule) => rule.defaultApplicability === "APPLIES").map((rule) => rule.code).sort());
    assert.match(page, /minimumDriverAge: "21"/);
    assert.match(page, /minimumDriverExperience: "24"/);
    assert.equal(L.LEGACY_DEFAULT_MINIMUM_DRIVER_AGE, "21");
    assert.equal(L.LEGACY_DEFAULT_MINIMUM_DRIVER_EXPERIENCE, "24");
  });

  it("the legacy tax codes (tax-filing TaxCode) are the identical strings as the legacy tax rule ids and map to registration programs", () => {
    const types = readFileSync(path.join(ROOT, "src/components/tax-filing/types.ts"), "utf8");
    const union = types.slice(types.indexOf("export type TaxCode"), types.indexOf("\n\n", types.indexOf("export type TaxCode")));
    const taxCodes = [...union.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
    assert.deepEqual(taxCodes, [...L.LEGACY_TAX_CODES]);
    assert.deepEqual(
      [...L.LEGACY_TAX_CODES],
      D.RULE_DEFINITIONS.filter((rule) => rule.section === "TAX").map((rule) => rule.code.toLowerCase()),
    );
    assert.deepEqual(L.mapLegacyTaxCode("ifta"), { status: "MAPPED", ruleCode: "IFTA", registrationProgramCode: "IFTA" });
    assert.deepEqual(L.mapLegacyTaxCode("texas_excise_tax"), { status: "MAPPED", ruleCode: "TEXAS_EXCISE_TAX", registrationProgramCode: "TX_EXCISE" });
    assert.deepEqual(L.mapLegacyTaxCode("arkansas_motor_fuel_tax"), { status: "MAPPED", ruleCode: "ARKANSAS_MOTOR_FUEL_TAX", registrationProgramCode: "AR_MFT" });
    assert.deepEqual(L.mapLegacyTaxCode("fuel_charge_registration"), { status: "MAPPED", ruleCode: "FUEL_CHARGE_REGISTRATION", registrationProgramCode: "FUEL_CHARGE" });
    assert.deepEqual(L.mapLegacyTaxCode("ontario_tobacco_tax"), { status: "MAPPED", ruleCode: "ONTARIO_TOBACCO_TAX", registrationProgramCode: "ON_TOBACCO" });
    assert.deepEqual(L.mapLegacyTaxCode("form_2290"), { status: "MAPPED", ruleCode: "FORM_2290", registrationProgramCode: null });
    for (const code of L.LEGACY_TAX_CODES) assert.equal(L.mapLegacyTaxCode(code).status, "MAPPED", code);
    // known rule ids that are not tax codes, and junk, are unmappable
    for (const bad of ["dg_us", "psp", "IFTA", "scac", "", null, undefined]) assert.deepEqual(L.mapLegacyTaxCode(bad), { status: "UNMAPPABLE" }, String(bad));
  });

  it("minimum driver age and experience: strict digits within range; the untouched defaults are NOT assertions", () => {
    assert.deepEqual(L.mapLegacyMinimumAge("21"), { status: "NO_ASSERTION" });
    assert.deepEqual(L.mapLegacyMinimumExperience("24"), { status: "NO_ASSERTION" });
    assert.deepEqual(L.mapLegacyMinimumAge("25"), { status: "ASSERTION", value: 25 });
    assert.deepEqual(L.mapLegacyMinimumAge("16"), { status: "ASSERTION", value: 16 });
    assert.deepEqual(L.mapLegacyMinimumAge("100"), { status: "ASSERTION", value: 100 });
    assert.deepEqual(L.mapLegacyMinimumExperience("0"), { status: "ASSERTION", value: 0 });
    assert.deepEqual(L.mapLegacyMinimumExperience("600"), { status: "ASSERTION", value: 600 });
    assert.deepEqual(L.mapLegacyMinimumExperience("12"), { status: "ASSERTION", value: 12 });
    for (const bad of ["", " ", "15", "101", "-5", "21.5", "2e1", "0x15", " 25", "25 ", "twenty", "+25", "０２５", "00000025", null, undefined, 25, true]) {
      assert.deepEqual(L.mapLegacyMinimumAge(bad), { status: "INVALID" }, `age ${String(bad)}`);
    }
    for (const bad of ["", "601", "-1", "12.5", "1e2", " 12", "a", null, undefined, 12]) {
      assert.deepEqual(L.mapLegacyMinimumExperience(bad), { status: "INVALID" }, `experience ${String(bad)}`);
    }
    // a leading-zero default is not the default string and is not accepted as one
    assert.deepEqual(L.mapLegacyMinimumAge("021"), { status: "ASSERTION", value: 21 });
  });

  it("the pair maps together: both defaults -> NO_ASSERTION; one set -> the pair (the default fills the other); any invalid -> INVALID", () => {
    assert.deepEqual(L.mapLegacyDriverRequirements("21", "24"), { status: "NO_ASSERTION" });
    assert.deepEqual(L.mapLegacyDriverRequirements("23", "36"), { status: "ASSERTION", minimumDriverAgeYears: 23, minimumDriverExperienceMonths: 36 });
    assert.deepEqual(L.mapLegacyDriverRequirements("23", "24"), { status: "ASSERTION", minimumDriverAgeYears: 23, minimumDriverExperienceMonths: 24 });
    assert.deepEqual(L.mapLegacyDriverRequirements("21", "6"), { status: "ASSERTION", minimumDriverAgeYears: 21, minimumDriverExperienceMonths: 6 });
    assert.deepEqual(L.mapLegacyDriverRequirements("abc", "24"), { status: "INVALID", invalidFields: ["minimumDriverAge"] });
    assert.deepEqual(L.mapLegacyDriverRequirements("23", "9999"), { status: "INVALID", invalidFields: ["minimumDriverExperience"] });
    assert.deepEqual(L.mapLegacyDriverRequirements("", ""), { status: "INVALID", invalidFields: ["minimumDriverAge", "minimumDriverExperience"] });
  });

  it("the mapping is pure: it exports no I/O and its source never touches browser storage or the database", () => {
    const source = readFileSync(path.join(ROOT, "lib/company-profile/legacy.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(source, /localStorage|sessionStorage|document\.|window\.|pg\b|client\.query|withAuthorized|fetch\(|require\(|process\.env/);
    assert.deepEqual([...source.matchAll(/^import .* from "([^"]+)"/gm)].map((match) => match[1]), ["@/lib/company-profile/definitions"]);
  });
});
