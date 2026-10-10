// Pure tests (no database) for the server-owned Corporate Identity identifier definitions, jurisdiction codes and name
// normalization. Imports are dynamic so the "@/" alias loader is registered first.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

async function load() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    defs: await import("@/lib/corporate-identity/identifier-definitions"),
    norm: await import("@/lib/corporate-identity/normalization"),
    jur: await import("@/lib/corporate-identity/jurisdiction"),
    errors: await import("@/lib/corporate-identity/errors"),
  };
}
const K = {} as Awaited<ReturnType<typeof load>>;

describe("Corporate identifier definitions", () => {
  before(async () => {
    Object.assign(K, await load());
  });

  const invalid = (input: unknown, field?: string) =>
    assert.throws(
      () => K.defs.prepareCorporateIdentifier(input),
      (error: unknown) => {
        assert.ok(error instanceof K.errors.CorporateIdentityValidationError, String(error));
        if (field) assert.equal((error as { field: string }).field, field);
        return true;
      },
    );

  it("CRA_BN: derives persistence vocabulary, normalizes to 9 digits and stores the rule version", () => {
    const grouped = K.defs.prepareCorporateIdentifier({ kind: "CRA_BN", value: " 123 456 789 " });
    assert.deepEqual(
      { ...grouped },
      {
        kind: "CRA_BN",
        identifierType: "business_number",
        namespace: "cra",
        jurisdictionCountry: "CA",
        jurisdictionRegion: null,
        value: "123 456 789",
        normalizedValue: "123456789",
        normalizationRuleVersion: "cra_bn.v1",
      },
    );
    assert.equal(K.defs.prepareCorporateIdentifier({ kind: "CRA_BN", value: "123-456-789" }).normalizedValue, "123456789");
    assert.equal(K.defs.prepareCorporateIdentifier({ kind: "CRA_BN", value: "123456789" }).normalizedValue, "123456789");
  });

  it("CRA_BN: rejects malformed values and program accounts (RT0001 is not a BN root)", () => {
    for (const value of ["12345678", "1234567890", "12345678A", "", "   ", "000000000", "123456789RT0001", "123456789 RT 0001", "12-3456789", "123.456.789"]) {
      invalid({ kind: "CRA_BN", value }, "identifier.value");
    }
  });

  it("IRS_EIN: accepts 12-3456789 / 123456789, normalizes to 9 digits, rejects malformed values", () => {
    const withDash = K.defs.prepareCorporateIdentifier({ kind: "IRS_EIN", value: "12-3456789" });
    assert.equal(withDash.normalizedValue, "123456789");
    assert.equal(withDash.identifierType, "employer_identification_number");
    assert.equal(withDash.namespace, "irs");
    assert.equal(withDash.jurisdictionCountry, "US");
    assert.equal(withDash.jurisdictionRegion, null);
    assert.equal(withDash.normalizationRuleVersion, "irs_ein.v1");
    assert.equal(K.defs.prepareCorporateIdentifier({ kind: "IRS_EIN", value: "123456789" }).normalizedValue, "123456789");
    for (const value of ["1-23456789", "12-345678", "12345678", "12-34567890", "ab-cdefghi", "00-0000000", ""]) {
      invalid({ kind: "IRS_EIN", value });
    }
  });

  it("BN and EIN are independent kinds with different vocabulary (a 9-digit value is not interchangeable)", () => {
    const bn = K.defs.prepareCorporateIdentifier({ kind: "CRA_BN", value: "123456789" });
    const ein = K.defs.prepareCorporateIdentifier({ kind: "IRS_EIN", value: "123456789" });
    assert.notEqual(K.defs.collisionKey(bn), K.defs.collisionKey(ein));
  });

  it("INCORPORATION: country required, region required for US, optional (federal) for CA, region must belong to the country", () => {
    const federal = K.defs.prepareCorporateIdentifier({ kind: "INCORPORATION", value: "1234567-8", country: "ca" });
    assert.equal(federal.jurisdictionCountry, "CA");
    assert.equal(federal.jurisdictionRegion, null);
    assert.equal(federal.normalizedValue, "12345678");
    assert.equal(federal.normalizationRuleVersion, "corporate_registration.default.v1");
    assert.equal(federal.identifierType, "incorporation_number");
    assert.equal(federal.namespace, "corporate_registry");

    const ontario = K.defs.prepareCorporateIdentifier({ kind: "INCORPORATION", value: "bc 123.456", country: "CA", region: "on" });
    assert.equal(ontario.jurisdictionRegion, "ON");
    assert.equal(ontario.normalizedValue, "BC123456");

    assert.equal(K.defs.prepareCorporateIdentifier({ kind: "INCORPORATION", value: "5551234", country: "US", region: "DE" }).jurisdictionRegion, "DE");

    invalid({ kind: "INCORPORATION", value: "5551234", country: "US" }, "identifier.region");
    invalid({ kind: "INCORPORATION", value: "5551234", country: "US", region: "ON" }, "identifier.region");
    invalid({ kind: "INCORPORATION", value: "5551234", country: "CA", region: "CA" }, "identifier.region");
    invalid({ kind: "INCORPORATION", value: "5551234", country: "Canada", region: "ON" }, "identifier.country");
    invalid({ kind: "INCORPORATION", value: "5551234", country: "MX" }, "identifier.country");
    invalid({ kind: "INCORPORATION", value: "5551234" }, "identifier.country");
    invalid({ kind: "INCORPORATION", value: "12", country: "CA" }, "identifier.value");
    invalid({ kind: "INCORPORATION", value: "12!34#56", country: "CA" }, "identifier.value");
  });

  it("the same registry number in different jurisdictions has different collision keys", () => {
    const on = K.defs.prepareCorporateIdentifier({ kind: "INCORPORATION", value: "1234567", country: "CA", region: "ON" });
    const bc = K.defs.prepareCorporateIdentifier({ kind: "INCORPORATION", value: "1234567", country: "CA", region: "BC" });
    const federal = K.defs.prepareCorporateIdentifier({ kind: "INCORPORATION", value: "1234567", country: "CA" });
    assert.equal(new Set([K.defs.collisionKey(on), K.defs.collisionKey(bc), K.defs.collisionKey(federal)]).size, 3);
    assert.equal(
      K.defs.collisionKey(on),
      K.defs.collisionKey(K.defs.prepareCorporateIdentifier({ kind: "INCORPORATION", value: " 123-4567 ", country: "ca", region: "on" })),
    );
  });

  it("EXTRA_PROVINCIAL_REGISTRATION: country and region both required", () => {
    const registration = K.defs.prepareCorporateIdentifier({ kind: "EXTRA_PROVINCIAL_REGISTRATION", value: "XP-99001", country: "CA", region: "BC" });
    assert.equal(registration.identifierType, "extra_provincial_registration");
    assert.equal(registration.jurisdictionRegion, "BC");
    invalid({ kind: "EXTRA_PROVINCIAL_REGISTRATION", value: "XP99001", country: "CA" }, "identifier.region");
    invalid({ kind: "EXTRA_PROVINCIAL_REGISTRATION", value: "XP99001", region: "BC" }, "identifier.country");
  });

  it("raw persistence vocabulary and unknown kinds cannot enter through the semantic input", () => {
    for (const extra of [
      { identifierType: "business_number" },
      { namespace: "cra" },
      { normalizedValue: "123456789" },
      { normalizationRuleVersion: "cra_bn.v0" },
      { jurisdictionCountry: "CA" },
      { jurisdiction_country: "CA" },
      { status: "active" },
      { verificationStatus: "verified" },
      { country: "CA" }, // not a BN input: the jurisdiction of a BN is fixed
      { region: "ON" },
    ]) {
      invalid({ kind: "CRA_BN", value: "123456789", ...extra });
    }
    invalid({ kind: "EXTRA_PROVINCIAL_REGISTRATION", value: "XP99001", country: "CA", region: "BC", namespace: "x" });
    invalid({ kind: "cra_bn", value: "123456789" }, "identifier.kind");
    invalid({ kind: "PROGRAM_ACCOUNT", value: "123456789RT0001" }, "identifier.kind");
    invalid({ value: "123456789" }, "identifier.kind");
    invalid(null);
    invalid("123456789");
    invalid([]);
  });

  it("every stored rule version resolves to an unchanged rule and reverse vocabulary lookup round-trips", () => {
    for (const kind of K.defs.CORPORATE_IDENTIFIER_KINDS) {
      const vocabulary = K.defs.persistedVocabularyFor(kind);
      assert.equal(K.defs.kindForPersistedType(vocabulary.identifierType, vocabulary.namespace), kind);
    }
    assert.equal(K.defs.kindForPersistedType("unknown", "cra"), undefined);
    assert.deepEqual(Object.keys(K.defs.NORMALIZATION_RULES).sort(), [
      "corporate_registration.default.v1",
      "cra_bn.v1",
      "irs_ein.v1",
    ]);
    for (const [version, rule] of Object.entries(K.defs.NORMALIZATION_RULES)) assert.equal(rule.version, version);
  });
});

describe("Jurisdiction codes and name normalization", () => {
  before(async () => {
    Object.assign(K, await load());
  });

  it("countries are codes only; regions must belong to the country", () => {
    assert.equal(K.jur.parseCountryCode(" us ", "c"), "US");
    assert.throws(() => K.jur.parseCountryCode("United States", "c"));
    assert.throws(() => K.jur.parseCountryCode("", "c"));
    assert.throws(() => K.jur.parseCountryCode(undefined, "c"));
    assert.equal(K.jur.parseRegionCode("CA", "qc", "r"), "QC");
    assert.equal(K.jur.parseRegionCode("US", "dc", "r"), "DC");
    assert.equal(K.jur.parseRegionCode("US", "CA", "r"), "CA"); // California
    assert.throws(() => K.jur.parseRegionCode("CA", "CA", "r")); // not a Canadian region
    assert.throws(() => K.jur.parseRegionCode("US", "ON", "r"));
    assert.equal(K.jur.parseOptionalRegion("CA", "  ", "r"), null);
    assert.equal(K.jur.parseOptionalRegion("CA", undefined, "r"), null);
  });

  it("legal-name normalization is a stable lookup key that keeps legal-form words", () => {
    const n = (value: string) => K.norm.normalizeBusinessName(K.norm.cleanDisplayText(value, "n"), "n");
    assert.equal(n("  Acme   Transport, Inc. "), "acme transport inc");
    assert.equal(n("ACME TRANSPORT INC"), "acme transport inc");
    assert.equal(n("Smith & Sons Ltd."), "smith and sons ltd");
    assert.notEqual(n("Acme Inc"), n("Acme Ltd")); // legal-form words are deliberately kept
    assert.equal(n("Société Transport Québec"), "société transport québec");
    assert.throws(() => K.norm.normalizeBusinessName("!!!", "n"));
    assert.throws(() => K.norm.cleanDisplayText("   ", "n"));
    assert.throws(() => K.norm.cleanDisplayText("a\u0000b", "n"));
    assert.throws(() => K.norm.cleanDisplayText("x".repeat(301), "n"));
    assert.throws(() => K.norm.cleanDisplayText(42, "n"));
  });
});
