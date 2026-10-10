// Pure tests (no database): channel normalization, names, titles and the purpose vocabulary.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import type * as Defs from "../../../lib/contacts/definitions.ts";
import type * as Errs from "../../../lib/contacts/errors.ts";

// Loaded in before(): the alias loader must be registered before the "@/..." imports resolve.
let D = {} as typeof Defs;
let E = {} as typeof Errs;
before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  D = (await import("@/lib/contacts/definitions")) as typeof Defs;
  E = (await import("@/lib/contacts/errors")) as typeof Errs;
});

const invalid = (fn: () => unknown) => assert.throws(fn, (error) => error instanceof E.ContactValidationError);

describe("channel normalization", () => {
  it("email: lower-cased, structural only, no provider-specific folding", () => {
    const a = D.prepareChannel("EMAIL", "  Dispatch@Example.COM ");
    assert.equal(a.normalized, "dispatch@example.com");
    assert.equal(a.display, "Dispatch@Example.COM");
    assert.equal(a.ruleVersion, "email.lowercase_structural_permissive.v1");
    assert.equal(a.extension, null);
    // dots in a local part are significant: no Gmail-style folding that would equate different mailboxes
    assert.notEqual(D.prepareChannel("EMAIL", "a.b@gmail.com").normalized, D.prepareChannel("EMAIL", "ab@gmail.com").normalized);
    // plus addressing is not stripped either
    assert.notEqual(D.prepareChannel("EMAIL", "a+x@example.com").normalized, D.prepareChannel("EMAIL", "a@example.com").normalized);
    for (const bad of ["", "no-at", "a@b", "a b@c.d", "@x.com", "a@@x.com", "a".repeat(250) + "@x.com"]) invalid(() => D.prepareChannel("EMAIL", bad));
    invalid(() => D.prepareChannel("EMAIL", 5));
    invalid(() => D.prepareChannel("EMAIL", "a@b.co", "12"));
  });

  it("phone: North American 10/11 digits and international + form; extensions are separate", () => {
    for (const raw of ["403-555-0100", "(403) 555 0100", "1 403 555 0100", "+1 (403) 555-0100", "403.555.0100"]) {
      assert.equal(D.prepareChannel("PHONE", raw).normalized, "+14035550100", raw);
    }
    assert.equal(D.prepareChannel("PHONE", "+44 20 7946 0958").normalized, "+442079460958");
    const withExt = D.prepareChannel("PHONE", "403-555-0100 ext. 22");
    assert.equal(withExt.normalized, "+14035550100");
    assert.equal(withExt.extension, "22");
    assert.equal(D.prepareChannel("PHONE", "403-555-0100 x7").extension, "7");
    assert.equal(D.prepareChannel("PHONE", "403-555-0100", "9").extension, "9");
    assert.equal(D.prepareChannel("PHONE", "403-555-0100").ruleVersion, "phone.nanp_or_international_permissive.v1");
    for (const bad of ["", "555-0100", "12345", "+12", "+1234567890123456", "call me"]) invalid(() => D.prepareChannel("PHONE", bad));
    invalid(() => D.prepareChannel("PHONE", "403-555-0100", "abc"));
  });

  it("rule names say they are permissive, and every rule resolves forever", () => {
    for (const rule of Object.values(D.CHANNEL_RULES)) assert.match(rule.version, /permissive\.v\d+$/);
    assert.deepEqual([...D.CHANNEL_TYPES], ["EMAIL", "PHONE"]);
  });
});

describe("names and titles", () => {
  it("a name needs at least one part and is normalized for advisory matching only", () => {
    const n = D.prepareName("  José  ", "O'Brien-Smith");
    assert.equal(n.givenName, "José");
    assert.equal(n.familyName, "O'Brien-Smith");
    assert.equal(n.normalized, "jose o brien smith");
    assert.equal(D.prepareName(undefined, "Cher").givenName, null);
    assert.equal(D.prepareName("Madonna", "").familyName, null);
    invalid(() => D.prepareName(undefined, undefined));
    invalid(() => D.prepareName("  ", ""));
    invalid(() => D.prepareName("!!!", undefined));
    invalid(() => D.prepareName("x".repeat(101), "y"));
    invalid(() => D.prepareName(5, "y"));
  });

  it("titles are free text with a normalized form; they carry no authorization meaning", () => {
    assert.equal(D.prepareTitle("  Safety   Manager ").display, "Safety Manager");
    assert.equal(D.prepareTitle("Safety Manager").normalized, D.prepareTitle("safety-manager").normalized);
    invalid(() => D.prepareTitle(""));
    invalid(() => D.prepareTitle("  "));
    invalid(() => D.prepareTitle("x".repeat(101)));
    invalid(() => D.prepareTitle("***"));
    invalid(() => D.prepareTitle(undefined));
  });
});

describe("purpose vocabulary", () => {
  it("has the approved initial purposes; PRIMARY implies the primary flag", () => {
    assert.deepEqual([...D.CONTACT_PURPOSES], ["PRIMARY", "BILLING", "SAFETY", "OPERATIONS", "COMPLIANCE", "EMERGENCY"]);
    assert.equal(D.PURPOSE_DEFINITIONS.PRIMARY.primaryMode, "REQUIRED");
    for (const purpose of D.CONTACT_PURPOSES.filter((p) => p !== "PRIMARY")) assert.equal(D.PURPOSE_DEFINITIONS[purpose].primaryMode, "OPTIONAL");
  });

  it("titles and purposes are different concepts: no purpose is a title", () => {
    for (const purpose of D.CONTACT_PURPOSES) assert.equal(D.isContactPurpose(purpose), true);
    for (const title of ["President", "Director", "Manager", "Safety Manager", "Dispatcher", "Accountant"]) assert.equal(D.isContactPurpose(title), false);
  });

  it("the legacy values that need interpretation are not blindly mapped to a purpose", () => {
    for (const legacy of ["Owner", "Operator", "Owner/Operator", "Driver", "Director", "Manager", "President"]) {
      assert.equal(D.isContactPurpose(legacy.toUpperCase()), false, legacy);
    }
  });
});
