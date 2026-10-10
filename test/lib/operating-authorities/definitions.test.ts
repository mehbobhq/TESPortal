// Pure tests (no database): kinds, versioned number normalization, jurisdiction resolution and status policy.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import type * as Defs from "../../../lib/operating-authorities/definitions.ts";
import type * as Errs from "../../../lib/operating-authorities/errors.ts";

// Loaded in before(): the alias loader must be registered before the "@/..." imports resolve.
let D = {} as typeof Defs;
let E = {} as typeof Errs;
before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  D = (await import("@/lib/operating-authorities/definitions")) as typeof Defs;
  E = (await import("@/lib/operating-authorities/errors")) as typeof Errs;
});

const invalid = (fn: () => unknown) => assert.throws(fn, (error) => error instanceof E.OperatingAuthorityValidationError);

describe("authority kinds and statuses", () => {
  it("has exactly the seven locked kinds, kept distinct", () => {
    assert.deepEqual([...D.AUTHORITY_KINDS], ["USDOT", "MC", "MVID", "RIN", "CVOR", "SAFETY_FITNESS", "IRP"]);
    assert.notEqual(D.KIND_DEFINITIONS.MVID.rule.version, D.KIND_DEFINITIONS.RIN.rule.version);
    assert.notEqual(D.KIND_DEFINITIONS.CVOR.rule.version, D.KIND_DEFINITIONS.SAFETY_FITNESS.rule.version);
  });

  it("has exactly the six regulatory statuses and no EXPIRED / ARCHIVED", () => {
    assert.deepEqual([...D.AUTHORITY_STATUSES], ["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED", "REVOKED", "CANCELED"]);
  });

  it("every kind's rule is registered under its version forever", () => {
    for (const kind of D.AUTHORITY_KINDS) assert.equal(D.NORMALIZATION_RULES[D.KIND_DEFINITIONS[kind].rule.version], D.KIND_DEFINITIONS[kind].rule);
  });

  it("rule names are honest: 'permissive' in the name iff the rule is not authoritative; authoritative rules cite a source", () => {
    for (const rule of Object.values(D.NORMALIZATION_RULES)) {
      assert.equal(/permissive/.test(rule.version), rule.classification === "PERMISSIVE", rule.version);
      assert.equal(typeof rule.source === "string" && rule.source.length > 0, rule.classification === "AUTHORITATIVE", rule.version);
      assert.match(rule.version, /\.v\d+$/, "versioned so v2/v3 can be added without rewriting history");
    }
    const authoritative = D.AUTHORITY_KINDS.filter((kind) => D.KIND_DEFINITIONS[kind].rule.classification === "AUTHORITATIVE");
    assert.deepEqual(authoritative, ["RIN", "CVOR"]);
  });

  it("only USDOT claims one current record per Organization", () => {
    assert.deepEqual(D.AUTHORITY_KINDS.filter((kind) => D.KIND_DEFINITIONS[kind].oneCurrentPerOrganization), ["USDOT"]);
  });

  it("RIN and CVOR are Ontario programs; MVID, SAFETY_FITNESS and IRP record their issuing jurisdiction", () => {
    assert.equal(D.KIND_DEFINITIONS.RIN.fixedRegion, "ON");
    assert.equal(D.KIND_DEFINITIONS.CVOR.fixedRegion, "ON");
    for (const kind of ["MVID", "SAFETY_FITNESS", "IRP"] as const) {
      assert.equal(D.KIND_DEFINITIONS[kind].fixedRegion, null);
      assert.equal(D.KIND_DEFINITIONS[kind].regionRequired, true);
    }
  });

  it("namespaces: USDOT/MC national, IRP base jurisdiction, the rest country+region", () => {
    assert.equal(D.KIND_DEFINITIONS.USDOT.jurisdictionScope, "NATIONAL");
    assert.equal(D.KIND_DEFINITIONS.MC.jurisdictionScope, "NATIONAL");
    assert.equal(D.KIND_DEFINITIONS.IRP.jurisdictionScope, "BASE_JURISDICTION");
    for (const kind of ["MVID", "RIN", "CVOR", "SAFETY_FITNESS"] as const) assert.equal(D.KIND_DEFINITIONS[kind].jurisdictionScope, "COUNTRY_REGION");
  });

  it("expiry applies only to CVOR and SAFETY_FITNESS", () => {
    assert.deepEqual(D.AUTHORITY_KINDS.filter((kind) => D.KIND_DEFINITIONS[kind].hasExpiry), ["CVOR", "SAFETY_FITNESS"]);
  });
});

describe("number normalization (every kind)", () => {
  const n = (kind: (typeof D.AUTHORITY_KINDS)[number], value: unknown) => D.prepareAuthorityNumber(kind, value);

  it("USDOT (PERMISSIVE): optional prefix, digits, leading zeros are not significant", () => {
    for (const value of ["1234567", "USDOT 1234567", "us dot: 1234567", "DOT-1234567", "0001234567"]) assert.equal(n("USDOT", value).normalized, "1234567", value);
    assert.equal(n("USDOT", "12345").ruleVersion, "usdot.numeric_permissive.v1");
    assert.equal(n("USDOT", "123456789012").normalized, "123456789012", "no unsupported maximum-length claim at 8 digits");
    for (const bad of ["", "abc", "0", "00000", "12 x4", "1234567890123"]) invalid(() => n("USDOT", bad));
    invalid(() => n("USDOT", 12345));
    invalid(() => n("USDOT", null));
  });

  it("MC (PERMISSIVE): MC-prefixed dockets only; FF and MX dockets are out of scope", () => {
    assert.equal(n("MC", "MC-0012345").normalized, "12345");
    assert.equal(n("MC", "mc 12345").normalized, "12345");
    assert.equal(n("MC", "12345").ruleVersion, "mc.numeric_permissive.v1");
    for (const bad of ["FF123456", "ff 12345", "MX12345", "MC", "0", "abc"]) invalid(() => n("MC", bad));
  });

  it("CVOR (AUTHORITATIVE, Ontario MTO): exactly nine digits, separators ignored, digits kept as issued", () => {
    assert.equal(n("CVOR", "123-456-789").normalized, "123456789");
    assert.equal(n("CVOR", "123 456 789").normalized, "123456789");
    assert.equal(n("CVOR", "012345678").normalized, "012345678", "leading zero preserved");
    assert.equal(n("CVOR", "000000000").normalized, "000000000", "no unsupported reserved-range claim");
    assert.equal(n("CVOR", "123456789").ruleVersion, "cvor.ontario_nine_digit.v1");
    for (const bad of ["12345678", "1234567890", "12345678A", ""]) invalid(() => n("CVOR", bad));
  });

  it("RIN (AUTHORITATIVE, Ontario MTO): exactly nine digits", () => {
    assert.equal(n("RIN", "987 654 321").normalized, "987654321");
    assert.equal(n("RIN", "987654321").ruleVersion, "rin.ontario_nine_digit.v1");
    for (const bad of ["98765432", "9876543210", "AB1234567", "ab-1234.56"]) invalid(() => n("RIN", bad));
  });

  it("MVID / SAFETY_FITNESS / IRP (PERMISSIVE): letters and digits only, case and separators ignored", () => {
    for (const kind of ["MVID", "SAFETY_FITNESS", "IRP"] as const) {
      assert.equal(n(kind, "ab-12.3/4 5").normalized, "AB12345");
      assert.equal(n(kind, "ab-12.3/4 5").display, "ab-12.3/4 5");
      assert.equal(n(kind, "A").normalized, "A", "no unsupported minimum-length claim");
      assert.equal(n(kind, "ab1").ruleVersion, "authority_identifier.permissive.v1");
      for (const bad of ["", "!!!", "A".repeat(33), "ab#12"]) invalid(() => n(kind, bad));
    }
  });

  it("display is trimmed and whitespace-collapsed, length-bounded", () => {
    assert.equal(n("MVID", "  ab   12  345 ").display, "ab 12 345");
    invalid(() => n("MVID", "A".repeat(41)));
  });

  it("MVID and SAFETY_FITNESS of the same text share a permissive rule but remain different kinds (namespaces never mix)", () => {
    assert.equal(n("MVID", "AB1234").normalized, n("SAFETY_FITNESS", "AB1234").normalized);
  });
});

describe("jurisdiction resolution", () => {
  it("national kinds take no jurisdiction and resolve to US", () => {
    assert.deepEqual(D.resolveJurisdiction("USDOT", undefined), { country: "US", region: null });
    assert.deepEqual(D.resolveJurisdiction("MC", null), { country: "US", region: null });
    invalid(() => D.resolveJurisdiction("USDOT", { region: "TX" }));
  });

  it("CVOR defaults to Ontario and rejects any other region", () => {
    assert.deepEqual(D.resolveJurisdiction("CVOR", undefined), { country: "CA", region: "ON" });
    assert.deepEqual(D.resolveJurisdiction("CVOR", { region: "on" }), { country: "CA", region: "ON" });
    invalid(() => D.resolveJurisdiction("CVOR", { region: "AB" }));
    invalid(() => D.resolveJurisdiction("CVOR", { country: "US", region: "ON" }));
  });

  it("RIN defaults to Ontario like CVOR and rejects any other region", () => {
    assert.deepEqual(D.resolveJurisdiction("RIN", undefined), { country: "CA", region: "ON" });
    invalid(() => D.resolveJurisdiction("RIN", { region: "AB" }));
  });

  it("provincial kinds require a Canadian region", () => {
    for (const kind of ["MVID", "SAFETY_FITNESS"] as const) {
      assert.deepEqual(D.resolveJurisdiction(kind, { region: "ab" }), { country: "CA", region: "AB" });
      invalid(() => D.resolveJurisdiction(kind, undefined));
      invalid(() => D.resolveJurisdiction(kind, { country: "US", region: "TX" }));
      invalid(() => D.resolveJurisdiction(kind, { region: "ZZ" }));
      invalid(() => D.resolveJurisdiction(kind, { region: "AB", extra: 1 } as never));
      invalid(() => D.resolveJurisdiction(kind, "AB"));
    }
  });

  it("IRP accepts a Canadian province or a US state, and requires one", () => {
    assert.deepEqual(D.resolveJurisdiction("IRP", { country: "CA", region: "AB" }), { country: "CA", region: "AB" });
    assert.deepEqual(D.resolveJurisdiction("IRP", { country: "US", region: "tx" }), { country: "US", region: "TX" });
    invalid(() => D.resolveJurisdiction("IRP", undefined));
    invalid(() => D.resolveJurisdiction("IRP", { country: "MX", region: "AB" }));
  });
});

describe("status vocabulary (no universal transition matrix, no archive-by-status rule)", () => {
  it("exports no transition or archive policy: legality is kind/regulator-specific Rules-layer policy", () => {
    const exported = Object.keys(D);
    for (const forbidden of ["isAllowedTransition", "isReactivation", "ARCHIVABLE_STATUSES", "TRANSITIONS"]) assert.ok(!exported.includes(forbidden), forbidden);
  });

  it("the vocabulary is exactly the six regulatory statuses", () => {
    assert.deepEqual([...D.AUTHORITY_STATUSES], ["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED", "REVOKED", "CANCELED"]);
  });
});
