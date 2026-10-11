// Pure tests (no database): vocabularies, name / username normalization, reference and URL shapes, legacy mapping.
// The drift test against the seeded catalogue lives in company-credentials.db.test.ts.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import type * as Defs from "../../../lib/company-credentials/definitions.ts";
import type * as Errs from "../../../lib/company-credentials/errors.ts";
import type * as Legacy from "../../../lib/company-credentials/legacy.ts";

let D = {} as typeof Defs;
let E = {} as typeof Errs;
let L = {} as typeof Legacy;
before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  D = (await import("@/lib/company-credentials/definitions")) as typeof Defs;
  E = (await import("@/lib/company-credentials/errors")) as typeof Errs;
  L = (await import("@/lib/company-credentials/legacy")) as typeof Legacy;
});

const invalid = (fn: () => unknown) => assert.throws(fn, (error) => error instanceof E.CompanyCredentialValidationError);

describe("vocabularies", () => {
  it("has exactly the locked codes", () => {
    assert.deepEqual([...D.CREDENTIAL_CATEGORIES], ["FLEET", "COMPLIANCE", "REGISTRATION", "INSURANCE", "ACCOUNTING", "FUEL", "OTHER"]);
    assert.deepEqual([...D.CREDENTIAL_STATUSES], ["ACTIVE", "NEEDS_VERIFICATION", "LOCKED", "DISABLED"]);
    assert.deepEqual([...D.MFA_METHODS], ["NONE", "AUTHENTICATOR_APP", "SMS", "EMAIL", "HARDWARE_KEY", "OTHER"]);
    assert.deepEqual([...D.SLOT_KINDS], ["PASSWORD", "MFA_SECRET", "RECOVERY_EMAIL", "RECOVERY_PHONE", "RECOVERY_PIN", "BACKUP_CODES", "SECURITY_ANSWER", "OTHER_RECOVERY"]);
    assert.deepEqual([...D.SECRET_STATES], ["UNRESOLVED", "STORED", "RETIRED"]);
    assert.deepEqual([...D.SECRET_STORES], ["GCP_SECRET_MANAGER"]);
    assert.deepEqual([...D.VERIFICATION_OUTCOMES], ["VERIFIED", "FAILED", "LOCKED_OUT"]);
    assert.deepEqual([...D.VERIFICATION_METHODS], ["MANUAL_LOGIN", "PORTAL_CHECK", "CLIENT_CONFIRMATION"]);
    assert.deepEqual([...D.REPLACEMENT_REASONS], ["USERNAME_CHANGED", "CORRECTION"]);
  });

  it("membership checks are exact (case-sensitive, no prototype keys, no non-strings)", () => {
    assert.equal(D.isCredentialCategory("FLEET"), true);
    assert.equal(D.isCredentialCategory("Fleet"), false);
    assert.equal(D.isCredentialStatus("NEEDS_VERIFICATION"), true);
    assert.equal(D.isCredentialStatus("Needs verification"), false);
    assert.equal(D.isSlotKind("toString"), false);
    assert.equal(D.isSlotKind("__proto__"), false);
    for (const bad of [7, null, undefined, {}, []]) assert.equal(D.isMfaMethod(bad), false);
  });

  it("there is no slot kind, state or store that could hold a value", () => {
    for (const code of [...D.SLOT_KINDS, ...D.SECRET_STATES, ...D.SECRET_STORES]) assert.doesNotMatch(code, /VALUE|PLAINTEXT|CLEAR|REVEAL/);
    assert.equal(Object.keys(D).some((key) => /reveal|decrypt|plaintext/i.test(key)), false);
  });
});

describe("system name normalization", () => {
  it("folds spelling, punctuation, case and accents to one comparison form", () => {
    for (const variant of ["ATIOS Alberta", "ATIOS-Alberta", "atios   alberta", "Átios Alberta", "  A.T.I.O.S.  Alberta  ", "ATIOS_Alberta"]) {
      assert.equal(D.normalizeSystemName(variant.replace("A.T.I.O.S.", "ATIOS")), "atios alberta", variant);
    }
    assert.equal(D.normalizeSystemName("Átios Alberta"), "atios alberta");
  });

  it("keeps different systems apart", () => {
    assert.notEqual(D.normalizeSystemName("ATIOS Alberta"), D.normalizeSystemName("TRACS Alberta"));
    assert.notEqual(D.normalizeSystemName("Motive"), D.normalizeSystemName("Samsara"));
  });

  it("produces only lower-case ASCII words separated by single spaces", () => {
    for (const name of ["BVD", "Motive (ELD)", "Zoë & Co.", "Ünïcödé—Dash", "A  B   C"]) {
      assert.match(D.normalizeSystemName(name), /^[a-z0-9]+( [a-z0-9]+)*$/, name);
    }
  });

  it("rejects an empty or incomparable name and one over 120 normalized characters", () => {
    for (const bad of ["", "   ", "---", "!!!", "電子", 5, null, undefined]) invalid(() => D.normalizeSystemName(bad));
    assert.equal(D.normalizeSystemName("a".repeat(120)).length, 120);
    invalid(() => D.normalizeSystemName("a".repeat(121)));
  });

  it("the display name is trimmed, bounded and free of control characters", () => {
    assert.equal(D.parseSystemDisplayName("  ATIOS Alberta  "), "ATIOS Alberta");
    invalid(() => D.parseSystemDisplayName(""));
    invalid(() => D.parseSystemDisplayName("a".repeat(201)));
    invalid(() => D.parseSystemDisplayName("bad\u0000name"));
    invalid(() => D.parseSystemDisplayName("line\nbreak"));
  });
});

describe("username normalization", () => {
  it("trims and lower-cases only; inner characters stay significant", () => {
    assert.equal(D.normalizeUsername("  Dispatch@Example.COM "), "dispatch@example.com");
    assert.equal(D.normalizeUsername("first last"), "first last");
    assert.notEqual(D.normalizeUsername("a-b"), D.normalizeUsername("ab"));
    assert.equal(D.normalizeUsername("ＡＢＣ"), "abc", "NFKC folds full-width forms");
  });

  it("rejects empty, over-long and control-character usernames", () => {
    for (const bad of ["", "   ", 1, null, undefined, "a\u0000b"]) invalid(() => D.normalizeUsername(bad));
    assert.equal(D.normalizeUsername("a".repeat(254)).length, 254);
    invalid(() => D.normalizeUsername("a".repeat(255)));
  });

  it("the display form is the trimmed text as entered", () => {
    assert.equal(D.parseUsernameDisplay("  MixedCase  "), "MixedCase");
  });
});

describe("secret-store references mirror the database CHECK", () => {
  it("accepts only Secret Manager resource names", () => {
    for (const ok of [
      "projects/tes-production-510007/secrets/atios-abc",
      "projects/tes-production-510007/secrets/Atios_ABC-1/versions/3",
      "projects/tes-production-510007/secrets/x/versions/latest",
    ]) assert.equal(D.isSecretReference(ok), true, ok);
  });

  it("refuses anything that looks like a value", () => {
    for (const bad of [
      "hunter2", "P@ssw0rd!", "https://portal.example.com/login", "0123456789abcdef0123456789abcdef", "correct horse battery staple",
      "projects/ab/secrets/x", "projects/Tes-Prod-1/secrets/x", "projects/tes-production-510007/secrets/", "projects/tes-production-510007/secrets/a b",
      "projects/tes-production-510007/secrets/x/versions/", "projects/tes-production-510007/secrets/x/versions/v1", "projects/tes-production-510007/secrets/x\n",
      `projects/tes-production-510007/secrets/${"a".repeat(256)}`, "", 5, null, undefined,
    ]) assert.equal(D.isSecretReference(bad), false, String(bad));
  });
});

describe("login URLs mirror the database CHECK", () => {
  it("accepts a public https sign-in page", () => {
    for (const ok of ["https://atios.alberta.ca", "https://portal.example.com/login", "https://portal.example.com:8443/a/b", "https://a-b.example.com/"]) assert.equal(D.isLoginUrl(ok), true, ok);
    assert.equal(D.parseLoginUrl("  https://portal.example.com/login "), "https://portal.example.com/login");
  });

  it("refuses http, userinfo, query, fragment, spaces and over-long values", () => {
    for (const bad of [
      "http://portal.example.com", "https://user:pass@portal.example.com", "https://user@portal.example.com", "https://portal.example.com/?a=1", "https://portal.example.com/#x",
      "https://portal.example.com/a b", "ftp://x.example.com", "portal.example.com", "https://", "https://portal.example.com:99999/", `https://x.example.com/${"a".repeat(500)}`, "", 5, null,
    ]) assert.equal(D.isLoginUrl(bad), false, String(bad));
    invalid(() => D.parseLoginUrl("http://portal.example.com"));
  });
});

describe("legacy mapping (pure)", () => {
  it("maps every legacy category and status, and nothing else", () => {
    assert.deepEqual(Object.keys(L.LEGACY_CATEGORY_MAP), ["Fleet", "Compliance", "Registration", "Insurance", "Accounting", "Fuel", "Other"]);
    for (const [legacy, code] of Object.entries(L.LEGACY_CATEGORY_MAP)) {
      assert.equal(L.mapLegacyCategory(legacy), code);
      assert.equal(D.isCredentialCategory(code), true);
    }
    assert.deepEqual(Object.keys(L.LEGACY_STATUS_MAP), ["Active", "Needs verification", "Locked", "Disabled"]);
    for (const [legacy, code] of Object.entries(L.LEGACY_STATUS_MAP)) {
      assert.equal(L.mapLegacyStatus(legacy), code);
      assert.equal(D.isCredentialStatus(code), true);
    }
    for (const bad of ["fleet", "Unknown", "", "toString", "__proto__", 3, null, undefined]) {
      assert.equal(L.mapLegacyCategory(bad), null, String(bad));
      assert.equal(L.mapLegacyStatus(bad), null, String(bad));
    }
  });

  it("recoveryStatus has no canonical equivalent: it is explicitly DERIVED", () => {
    for (const legacy of ["Not added", "Partially added", "Recovery added", "garbage", undefined]) assert.equal(L.mapLegacyRecoveryStatus(legacy), "DERIVED_FROM_SLOT_STATE");
    const mapped = L.mapLegacyCredentialMetadata({ category: "Fuel", status: "Locked", username: "x", recoveryStatus: "Partially added", lastVerifiedAt: "2024-01-01T00:00:00Z" });
    assert.deepEqual(mapped, { category: "FUEL", status: "LOCKED", recoveryStatus: "DERIVED_FROM_SLOT_STATE", lastVerifiedAt: "NOT_IMPORTED_NO_ACTOR_OR_METHOD" });
    assert.equal(L.mapLegacyCredentialMetadata({ category: "nope", status: "nope" }).category, null);
    assert.equal(L.mapLegacyCredentialMetadata({}).lastVerifiedAt, null);
  });

  it("maps recovery method types to slot KINDS only; unknown types are null", () => {
    assert.equal(L.mapLegacyRecoveryMethodType("Recovery email"), "RECOVERY_EMAIL");
    assert.equal(L.mapLegacyRecoveryMethodType("Recovery phone"), "RECOVERY_PHONE");
    assert.equal(L.mapLegacyRecoveryMethodType("Recovery PIN"), "RECOVERY_PIN");
    assert.equal(L.mapLegacyRecoveryMethodType("Backup codes"), "BACKUP_CODES");
    assert.equal(L.mapLegacyRecoveryMethodType("MFA recovery"), "OTHER_RECOVERY");
    assert.equal(L.mapLegacyRecoveryMethodType("Other"), "OTHER_RECOVERY");
    assert.equal(L.mapLegacyRecoveryMethodType("Carrier pigeon"), null);
    for (const kind of Object.values(L.LEGACY_RECOVERY_METHOD_MAP)) assert.equal(D.isSlotKind(kind), true);
    assert.equal(L.LEGACY_SECURITY_QUESTION_SLOT_KIND, "SECURITY_ANSWER");
  });

  it("legacy secrets are NEVER mapped: every field, every value is SECRET_NOT_MIGRATED, and the value is not echoed", () => {
    for (const field of [...L.LEGACY_SECRET_FIELDS, "somethingElse"]) {
      const result = L.legacySecretDisposition(field, "hunter2-real-password");
      assert.deepEqual(result, { outcome: "SECRET_NOT_MIGRATED", field });
      assert.equal(JSON.stringify(result).includes("hunter2"), false);
    }
    assert.deepEqual([...L.LEGACY_SECRET_FIELDS], ["password", "securityQuestionAnswer", "recoveryValue"]);
  });

  const ATIOS = { id: "CA-AB-ATIOS", providerCompanyId: "", name: "ATIOS Alberta", legalName: "Alberta Transportation Online Services", jurisdiction: "Alberta", country: "Canada", services: ["IRP"], aliases: ["ATIOS", "IRP Alberta", "Alberta IRP"], loginUrl: "" };
  const TRACS = { id: "CA-AB-TRACS", providerCompanyId: "", name: "TRACS Alberta", legalName: "Tax and Revenue Administration Client Self-Service", jurisdiction: "Alberta", country: "Canada", services: ["IFTA"], aliases: ["TRACS", "IFTA Alberta", "Alberta IFTA"], loginUrl: "" };

  it("maps the two seed portals to distinct, valid createSystem inputs and lists what is dropped", () => {
    const a = L.mapLegacyPortal(ATIOS);
    const t = L.mapLegacyPortal(TRACS);
    assert.equal(a.status, "MAPPED");
    assert.equal(t.status, "MAPPED");
    if (a.status !== "MAPPED" || t.status !== "MAPPED") return;
    assert.deepEqual(a.input, { name: "ATIOS Alberta", aliases: ["ATIOS", "IRP Alberta", "Alberta IRP"], jurisdictionCountry: "CA", jurisdictionRegion: "AB" });
    assert.deepEqual(t.input, { name: "TRACS Alberta", aliases: ["TRACS", "IFTA Alberta", "Alberta IFTA"], jurisdictionCountry: "CA", jurisdictionRegion: "AB" });
    assert.notEqual(D.normalizeSystemName(a.input.name), D.normalizeSystemName(t.input.name));
    assert.deepEqual([...a.dropped], ["services", "legalName"]);
    assert.equal(a.legacyId, "CA-AB-ATIOS");
    assert.equal(a.legacyProviderCompanyId, null);
    assert.deepEqual(a.unmapped, []);
    // no alias of one seed portal is a name or alias of the other
    const names = new Set([a.input.name, ...a.input.aliases].map((n) => D.normalizeSystemName(n)));
    for (const other of [t.input.name, ...t.input.aliases]) assert.equal(names.has(D.normalizeSystemName(other)), false, other);
  });

  it("never guesses: unknown country / region / URL are reported, an unusable name is UNMAPPABLE, duplicate aliases are dropped", () => {
    const odd = L.mapLegacyPortal({ name: "Motive", country: "Atlantis", jurisdiction: "Deep", loginUrl: "http://insecure.example.com", aliases: ["motive", "MOTIVE!", "Keeptruckin", "Keeptruckin", "  "], services: ["ELD"] });
    assert.equal(odd.status, "MAPPED");
    if (odd.status !== "MAPPED") return;
    assert.deepEqual(odd.input, { name: "Motive", aliases: ["Keeptruckin"] });
    assert.deepEqual(odd.unmapped, ["country", "jurisdiction", "loginUrl"]);
    assert.deepEqual(odd.duplicateAliasesDropped, ["motive", "MOTIVE!", "Keeptruckin"]);
    assert.deepEqual(L.mapLegacyPortal({ name: "   " }), { status: "UNMAPPABLE", reason: "NAME_MISSING_OR_NOT_COMPARABLE" });
    assert.deepEqual(L.mapLegacyPortal({}), { status: "UNMAPPABLE", reason: "NAME_MISSING_OR_NOT_COMPARABLE" });
    const region = L.mapLegacyPortal({ name: "X", country: "Canada", jurisdiction: "Narnia" });
    assert.equal(region.status === "MAPPED" && region.input.jurisdictionRegion, undefined);
    const url = L.mapLegacyPortal({ name: "X", loginUrl: "https://portal.example.com/login" });
    assert.equal(url.status === "MAPPED" && url.input.loginUrl, "https://portal.example.com/login");
  });

  it("a mapped legacy portal has no secret or credential field at all", () => {
    const mapped = L.mapLegacyPortal({ ...ATIOS, password: "hunter2" } as never);
    assert.equal(JSON.stringify(mapped).includes("hunter2"), false);
  });
});
