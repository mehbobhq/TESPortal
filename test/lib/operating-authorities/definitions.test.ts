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

  it("every kind's rule is registered under its own version forever", () => {
    for (const kind of D.AUTHORITY_KINDS) assert.equal(D.NORMALIZATION_RULES[D.KIND_DEFINITIONS[kind].rule.version], D.KIND_DEFINITIONS[kind].rule);
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

  it("USDOT: prefixes and leading zeros are formatting", () => {
    for (const value of ["1234567", "USDOT 1234567", "us dot: 1234567", "DOT-1234567", " 0001234567 "].slice(0, 4)) assert.equal(n("USDOT", value).normalized, "1234567");
    assert.equal(n("USDOT", "01234567").normalized, "1234567");
    assert.equal(n("USDOT", "USDOT 0012345").normalized, "12345");
    assert.equal(n("USDOT", "12345").ruleVersion, "usdot.v1");
    for (const bad of ["", "abc", "123456789", "0", "00000", "12 34 x"]) invalid(() => n("USDOT", bad));
    invalid(() => n("USDOT", 12345));
    invalid(() => n("USDOT", null));
  });

  it("MC: optional MC prefix; FF and MX dockets are not MC", () => {
    assert.equal(n("MC", "MC-0012345").normalized, "12345");
    assert.equal(n("MC", "mc 12345").normalized, "12345");
    for (const bad of ["FF123456", "ff 12345", "MX12345", "MC", "0", "abc"]) invalid(() => n("MC", bad));
  });

  it("CVOR: nine digits, separators ignored", () => {
    assert.equal(n("CVOR", "123-456-789").normalized, "123456789");
    assert.equal(n("CVOR", "123 456 789").normalized, "123456789");
    for (const bad of ["12345678", "1234567890", "000000000", "12345678A"]) invalid(() => n("CVOR", bad));
  });

  it("MVID / RIN / SAFETY_FITNESS / IRP: generic alphanumeric, case and separators ignored", () => {
    for (const kind of ["MVID", "RIN", "SAFETY_FITNESS", "IRP"] as const) {
      assert.equal(n(kind, "ab-12.3/4 5").normalized, "AB12345");
      assert.equal(n(kind, "ab-12.3/4 5").display, "ab-12.3/4 5");
      for (const bad of ["ab", "", "!!!", "A".repeat(25)]) invalid(() => n(kind, bad));
    }
  });

  it("display is trimmed and whitespace-collapsed, length-bounded, and records the rule version", () => {
    assert.equal(n("RIN", "  ab   12  345 ").display, "ab 12 345");
    invalid(() => n("RIN", "A".repeat(41)));
    assert.equal(n("IRP", "ABC123").ruleVersion, "irp.v1");
  });

  it("MVID and RIN of the same text normalize identically but are different kinds (namespaces never mix)", () => {
    assert.equal(n("MVID", "AB1234").normalized, n("RIN", "AB1234").normalized);
    assert.notEqual(n("MVID", "AB1234").ruleVersion, n("RIN", "AB1234").ruleVersion);
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

  it("provincial kinds require a Canadian region", () => {
    for (const kind of ["MVID", "RIN", "SAFETY_FITNESS"] as const) {
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

describe("status transition policy", () => {
  it("every transition is between known statuses and never to itself", () => {
    for (const from of D.AUTHORITY_STATUSES) assert.equal(D.isAllowedTransition(from, from), false);
  });

  it("PENDING can only be activated or canceled", () => {
    const allowed = D.AUTHORITY_STATUSES.filter((to) => D.isAllowedTransition("PENDING", to));
    assert.deepEqual(allowed, ["ACTIVE", "CANCELED"]);
  });

  it("ACTIVE cannot return to PENDING; nothing returns to PENDING", () => {
    for (const from of D.AUTHORITY_STATUSES) assert.equal(D.isAllowedTransition(from, "PENDING"), false);
  });

  it("every non-ACTIVE status can be reactivated; PENDING -> ACTIVE is an activation, not a reactivation", () => {
    for (const from of ["INACTIVE", "SUSPENDED", "REVOKED", "CANCELED"] as const) {
      assert.equal(D.isAllowedTransition(from, "ACTIVE"), true, from);
      assert.equal(D.isReactivation(from, "ACTIVE"), true, from);
    }
    assert.equal(D.isReactivation("PENDING", "ACTIVE"), false);
    assert.equal(D.isReactivation("ACTIVE", "ACTIVE"), false);
    assert.equal(D.isReactivation("ACTIVE", "SUSPENDED"), false);
  });

  it("only terminal-ish statuses are archivable; a live authority is not", () => {
    assert.deepEqual([...D.ARCHIVABLE_STATUSES], ["INACTIVE", "REVOKED", "CANCELED"]);
    assert.ok(!D.ARCHIVABLE_STATUSES.includes("ACTIVE"));
    assert.ok(!D.ARCHIVABLE_STATUSES.includes("SUSPENDED"));
    assert.ok(!D.ARCHIVABLE_STATUSES.includes("PENDING"));
  });
});
