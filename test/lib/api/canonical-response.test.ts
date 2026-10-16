// canonicalFailure() classification. Production builds minify class bindings (`class i extends Error`), so the mapping must
// not depend on `constructor.name`. These tests run the REAL error classes, including with their class names renamed the
// way a minifier renames them, and pin every status the mapping produces. No database is needed.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const FALLBACK = "Unable to complete the request.";

type Ctor = new (...args: unknown[]) => Error;
type Failure = (error: unknown, fallback: string) => Response;
let canonicalFailure: Failure;
const real: Record<string, Ctor> = {};

const ERROR_MODULES = [
  "@/lib/contracts/errors",
  "@/lib/evidence-payload/errors",
  "@/lib/evidence-payload/validation",
  "@/lib/insurance/errors",
  "@/lib/operating-authorities/errors",
  "@/lib/tax-registrations/errors",
  "@/lib/corporate-identity/errors",
  "@/lib/company-credentials/errors",
  "@/lib/company-profile/errors",
  "@/lib/contacts/errors",
  "@/lib/customer-relationship/errors",
  "@/lib/organization-locations/errors",
  "@/lib/vehicle-merges/errors",
];

before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  canonicalFailure = (await import("@/lib/api/canonical-response")).canonicalFailure as Failure;
  for (const specifier of ERROR_MODULES) {
    const mod = (await import(specifier)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === "function" && value.prototype instanceof Error) real[name] = value as Ctor;
    }
  }
  // Typed namespace imports: each class is checked against its real declaration, with no cast.
  const actor = await import("@/lib/auth/tes-actor");
  const core = await import("@/lib/auth/tes-authorization-core");
  const guard = await import("@/lib/auth/tes-transaction-guard");
  Object.assign(real, {
    TesIdentityRequiredError: actor.TesIdentityRequiredError,
    TesAuthorizationDeniedError: core.TesAuthorizationDeniedError,
    TesUnknownCapabilityError: core.TesUnknownCapabilityError,
    TesCapabilityScopeError: core.TesCapabilityScopeError,
    TesNestedAuthorizationError: guard.TesNestedAuthorizationError,
    TesTenantContextPresentError: guard.TesTenantContextPresentError,
  });
});

const make = (C: Ctor): Error => new C("field", "A specific, user-safe message.");
const respond = async (error: unknown) => {
  const response = canonicalFailure(error, FALLBACK);
  return { status: response.status, body: (await response.json()) as { error: string } };
};

/** What a minifier does to a class binding: `constructor.name` becomes a short identifier, `this.name` is untouched. */
function minified(C: Ctor, short = "i"): Ctor {
  const twin = class extends C {} as Ctor;
  Object.defineProperty(twin, "name", { value: short });
  return twin;
}

const SUFFIX_STATUS: Array<[string, number]> = [
  ["ValidationError", 400],
  ["NotFoundError", 404],
  ["StateError", 409],
  ["ConflictError", 409],
  ["CollisionError", 409],
];

describe("canonicalFailure: domain error families", () => {
  it("covers every error family the canonical services define", () => {
    const covered = Object.keys(real).filter((name) => SUFFIX_STATUS.some(([suffix]) => name.endsWith(suffix)));
    assert.ok(covered.length >= 40, `expected the full set of canonical domain errors, found ${covered.length}`);
    for (const [suffix] of SUFFIX_STATUS) assert.ok(covered.some((name) => name.endsWith(suffix)), `no ${suffix} class found`);
  });

  for (const [suffix, status] of SUFFIX_STATUS) {
    it(`...${suffix} -> ${status}, keeping the error's own message`, async () => {
      const classes = Object.entries(real).filter(([name]) => name.endsWith(suffix));
      assert.ok(classes.length > 0);
      for (const [name, C] of classes) {
        const error = make(C);
        const result = await respond(error);
        assert.equal(result.status, status, name);
        assert.equal(result.body.error, error.message, name);
        assert.deepEqual(Object.keys(result.body), ["error"], `${name}: only the message is returned`);
      }
    });
  }

  it("each domain error declares its own class name, so classification never depends on the class binding", () => {
    for (const [name, C] of Object.entries(real)) {
      if (!SUFFIX_STATUS.some(([suffix]) => name.endsWith(suffix))) continue;
      assert.equal(make(C).name, name);
    }
  });
});

describe("canonicalFailure: authentication and authorization denial", () => {
  it("TesAuthorizationDeniedError -> 403 'Not authorized.'", async () => {
    assert.deepEqual(await respond(new real.TesAuthorizationDeniedError()), { status: 403, body: { error: "Not authorized." } });
  });

  it("TesIdentityRequiredError -> 403 'Not authorized.' (its own message is not echoed)", async () => {
    const error = new real.TesIdentityRequiredError();
    assert.ok(error.message.length > 0);
    assert.deepEqual(await respond(error), { status: 403, body: { error: "Not authorized." } });
  });

  it("the denial errors carry the explicit codes the mapping relies on", () => {
    assert.equal((new real.TesAuthorizationDeniedError() as Error & { code: string }).code, "TES_AUTHORIZATION_DENIED");
    assert.equal((new real.TesIdentityRequiredError() as Error & { code: string }).code, "TES_IDENTITY_REQUIRED");
  });

  it("other Tes* server-defect errors are NOT authorization errors: 500, generic message, no internal text", async () => {
    for (const name of ["TesUnknownCapabilityError", "TesCapabilityScopeError", "TesNestedAuthorizationError", "TesTenantContextPresentError"]) {
      const error = new real[name]();
      const result = await respond(error);
      assert.equal(result.status, 500, name);
      assert.deepEqual(result.body, { error: FALLBACK }, name);
    }
  });
});

describe("canonicalFailure: minified class names (production build)", () => {
  it("the renamed class really reports a different constructor.name (the failure mode being guarded)", () => {
    const Twin = minified(real.TesAuthorizationDeniedError, "i");
    const error = new Twin();
    assert.equal(error.constructor.name, "i");
    assert.equal(error.name, "TesAuthorizationDeniedError");
  });

  it("every mapped class keeps its status when its class binding is minified", async () => {
    let checked = 0;
    for (const [name, C] of Object.entries(real)) {
      const family = SUFFIX_STATUS.find(([suffix]) => name.endsWith(suffix));
      const expected = family ? family[1] : name === "TesAuthorizationDeniedError" || name === "TesIdentityRequiredError" ? 403 : null;
      if (expected === null) continue;
      for (const short of ["i", "m", "a", "Ab"]) {
        const error = make(minified(C, short));
        const result = await respond(error);
        assert.equal(result.status, expected, `${name} as "${short}"`);
        checked += 1;
      }
    }
    assert.ok(checked > 160);
  });

  it("unknown errors stay 500 whatever their (minified) class name is", async () => {
    for (const short of ["i", "m", "ValidationError2"]) {
      const Unknown = class extends Error {} as Ctor;
      Object.defineProperty(Unknown, "name", { value: short });
      assert.equal((await respond(new Unknown("boom"))).status, 500);
    }
  });
});

describe("canonicalFailure: unknown and infrastructure failures fail closed", () => {
  const cases: Array<[string, () => unknown]> = [
    ["plain Error", () => new Error("connect ECONNREFUSED 10.0.0.1:5432 password=hunter2")],
    ["TypeError", () => new TypeError("Cannot read properties of undefined")],
    // lib/database/postgres.ts is replaced by a stand-in in this harness, so its error shape is reproduced here.
    ["PostgresConnectionError (shape)", () => Object.assign(new Error("TES could not establish a PostgreSQL connection."), { name: "PostgresConnectionError", code: "POSTGRES_CONNECTION_FAILED" })],
    ["a string", () => "TES_AUTHORIZATION_DENIED"],
    ["null", () => null],
    ["undefined", () => undefined],
    ["a plain object with the denial code", () => ({ code: "TES_AUTHORIZATION_DENIED", message: "x" })],
    ["an Error merely NAMED like the denial error (no code)", () => Object.assign(new Error("impersonation"), { name: "TesAuthorizationDeniedError" })],
    ["an Error with a different code", () => Object.assign(new Error("other"), { code: "TES_CAPABILITY_UNKNOWN" })],
    ["an Error with a non-string code", () => Object.assign(new Error("other"), { code: 403 })],
  ];
  for (const [label, build] of cases) {
    it(`${label} -> 500 with only the caller's fallback message`, async () => {
      const result = await respond(build());
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { error: FALLBACK });
    });
  }

  it("the 500 body never carries the exception message, stack or class name", async () => {
    const error = new Error("secret detail /srv/app/db.ts:42");
    const text = JSON.stringify((await respond(error)).body);
    assert.ok(!/secret|\/srv\/|db\.ts|stack|Error/.test(text.replace(FALLBACK, "")));
  });
});

describe("canonicalFailure: static guards", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  };

  it("the classifier does not read constructor.name", () => {
    const code = readFileSync(path.join(ROOT, "lib/api/canonical-response.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/constructor\.name/.test(code));
  });

  it("every class named like a mapped family declares that same name via this.name (convention the mapping relies on)", () => {
    // CompanyDirectoryValidationError is excluded: it declares no name, but it is handled by `instanceof` in its only route
    // (app/api/companies/[id]/route.ts) and never reaches canonicalFailure.
    const EXCLUDED = new Set(["CompanyDirectoryValidationError"]);
    const suffixes = /(ValidationError|NotFoundError|StateError|ConflictError|CollisionError)$/;
    const offenders: string[] = [];
    let seen = 0;
    for (const dir of ["lib", "app", "src"]) {
      for (const file of walk(path.join(ROOT, dir))) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(/class (\w+) extends \w+[^{]*\{([\s\S]*?)(?=\nexport |\nclass |\n\/\*\*|$)/g)) {
          const [, className, body] = match;
          if (!suffixes.test(className) || EXCLUDED.has(className)) continue;
          seen += 1;
          if (!new RegExp(`this\\.name\\s*=\\s*"${className}"`).test(body)) offenders.push(`${path.relative(ROOT, file)}: ${className}`);
        }
      }
    }
    assert.ok(seen >= 40, `scanned ${seen} classes`);
    assert.deepEqual(offenders, []);
  });
});
