// Call sites that decide on a TES denial themselves must not read `constructor.name`: a production build minifies class
// bindings (`class i extends Error`). These tests run the REAL routes and the REAL authorization kernel against a scripted
// pool (the decision queries are answered, not bypassed) and rename the REAL error classes the way a minifier does, so the
// route sees exactly what it sees in a production build. No database is needed.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const g = globalThis as Record<string, unknown>;
const ACTOR = randomUUID();
const GENERIC_OCR = "Document AI processing failed. Please try again.";
const GENERIC_BUSINESS = "Corporate OCR failed. The evidence remains available for manual review.";

type Ctor = (new (...args: unknown[]) => Error) & { prototype: Error };
let Denied: Ctor, IdentityRequired: Ctor, CapabilityScope: Ctor;
let isTesDenial: (error: unknown) => boolean;
let documentAi: { POST: (request: never) => Promise<Response> };
let businessOcr: { POST: (request: never) => Promise<Response> };
const savedEnv = { ...process.env };
const originals = new Map<Ctor, PropertyDescriptor | undefined>();
const realFetch = globalThis.fetch;
const realConsoleError = console.error;
let outbound: string[] = [];

/** What a minifier does to a class binding. The `this.name` / `this.code` the constructor assigns are untouched. */
function minify(C: Ctor, short: string) {
  if (!originals.has(C)) originals.set(C, Object.getOwnPropertyDescriptor(C, "name"));
  Object.defineProperty(C, "name", { value: short, configurable: true });
}
function restoreNames() {
  for (const [C, descriptor] of originals) if (descriptor) Object.defineProperty(C, "name", descriptor);
  originals.clear();
}

/** Answers the authorization kernel's queries from a script, like test/lib/driver-applications/endpoint-containment.test.ts. */
function scriptedPool(options: { identity: boolean; allowed: boolean }) {
  const query = async (text: string) => {
    const sql = String(text);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    if (sql.includes("current_setting('tes.customer_id', true)")) return { rows: [{ raw: null, resolved: null }] };
    if (sql.includes("UPDATE public.authentication_identities")) return { rows: [] };
    if (sql.includes("FROM public.authentication_identities")) {
      return { rows: options.identity ? [{ actor_id: ACTOR, actor_type: "HUMAN", actor_status: "active", identity_status: "active" }] : [] };
    }
    if (sql.includes("capability_known")) return { rows: [{ capability_known: true, capability_active: true, customer_exists: true, allowed: options.allowed }] };
    if (sql.includes("is_master_account")) return { rows: [{ is_master_account: false }] };
    if (sql.includes("set_config")) return { rows: [] };
    if (sql.includes("system_context_authorized")) return { rows: [{ allowed: options.allowed }] };
    return { rows: [] };
  };
  g.__tesTestRuntimePool = { connect: async () => ({ query, release() {} }), query };
}
/** A pool whose connection fails with `failure`: an infrastructure error, not an authorization outcome. */
function failingPool(failure: Error) {
  g.__tesTestRuntimePool = { connect: async () => { throw failure; }, query: async () => { throw failure; } };
}

before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  process.env.TES_LEGACY_OCR_UNSCANNED_EXCEPTION_UNTIL = tomorrow; // the routes must be OPEN to reach authorization
  delete process.env.TES_LEGACY_OCR_DISABLED;
  Denied = (await import("@/lib/auth/tes-authorization-core")).TesAuthorizationDeniedError as unknown as Ctor;
  CapabilityScope = (await import("@/lib/auth/tes-authorization-core")).TesCapabilityScopeError as unknown as Ctor;
  IdentityRequired = (await import("@/lib/auth/tes-actor")).TesIdentityRequiredError as unknown as Ctor;
  isTesDenial = (await import("@/lib/api/canonical-response")).isTesDenial;
  documentAi = (await import("@/app/api/document-ai/route")) as never;
  businessOcr = (await import("@/app/api/business-document-ocr/route")) as never;
  globalThis.fetch = (async (input: unknown) => { outbound.push(String(input)); throw new Error("no network in this test"); }) as typeof fetch;
  console.error = () => {};
});
after(() => {
  process.env = savedEnv;
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
});
afterEach(() => {
  restoreNames();
  g.__tesTestClerkUserId = null;
  delete g.__tesTestRuntimePool;
});

const post = (route: { POST: (request: never) => Promise<Response> }) => route.POST(new Request("http://localhost/api", { method: "POST" }) as never);
const NAMES = ["i", "m", "a", "Ab"];

for (const [label, getRoute, generic, status] of [
  ["POST /api/document-ai", () => documentAi, GENERIC_OCR, 500],
  ["POST /api/business-document-ocr", () => businessOcr, GENERIC_BUSINESS, 502],
] as const) {
  describe(`${label}: denial classification with minified class names`, () => {
    for (const short of NAMES) {
      it(`signed-in user without a TES identity -> 403 'Not authorized.' (TesIdentityRequiredError bound as "${short}")`, async () => {
        minify(IdentityRequired, short);
        g.__tesTestClerkUserId = "user_without_tes_identity";
        scriptedPool({ identity: false, allowed: false });
        const response = await post(getRoute());
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: "Not authorized." });
      });

      it(`TES actor without EVIDENCE_MANAGE -> 403 'Not authorized.' (TesAuthorizationDeniedError bound as "${short}")`, async () => {
        minify(Denied, short);
        g.__tesTestClerkUserId = "user_tes_actor";
        scriptedPool({ identity: true, allowed: false });
        const response = await post(getRoute());
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: "Not authorized." });
      });
    }

    it("no Clerk session at all -> 403 (TesIdentityRequiredError), not a server error", async () => {
      minify(IdentityRequired, "m");
      g.__tesTestClerkUserId = null;
      scriptedPool({ identity: false, allowed: false });
      assert.equal((await post(getRoute())).status, 403);
    });

    it("an infrastructure failure is NOT read as a denial: generic failure, no internal text", async () => {
      minify(Denied, "i");
      minify(IdentityRequired, "m");
      g.__tesTestClerkUserId = "user_tes_actor";
      failingPool(new Error("connect ECONNREFUSED 10.1.2.3:5432 password=hunter2"));
      const response = await post(getRoute());
      assert.equal(response.status, status);
      const body = await response.json();
      assert.deepEqual(body, { error: generic });
      assert.ok(!/hunter2|ECONNREFUSED|10\.1\.2\.3/.test(JSON.stringify(body)));
    });

    it("another Tes* server-defect error (TesCapabilityScopeError) is NOT read as a denial", async () => {
      minify(CapabilityScope, "k");
      g.__tesTestClerkUserId = "user_tes_actor";
      failingPool(new CapabilityScope());
      const response = await post(getRoute());
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: generic });
    });

    it("an Error merely NAMED like a denial (no code) is NOT read as a denial", async () => {
      g.__tesTestClerkUserId = "user_tes_actor";
      failingPool(Object.assign(new Error("impersonation"), { name: "TesAuthorizationDeniedError" }));
      const response = await post(getRoute());
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: generic });
    });

    it("no outbound request is made on any of these paths", () => {
      assert.deepEqual(outbound, []);
    });
  });
}

describe("isTesDenial", () => {
  it("is true for exactly the two denial errors, also when their class bindings are minified", () => {
    minify(Denied, "i");
    minify(IdentityRequired, "m");
    assert.equal(isTesDenial(new Denied()), true);
    assert.equal(isTesDenial(new IdentityRequired()), true);
  });
  it("is false for other Tes* errors, plain errors, look-alikes and non-errors", () => {
    for (const value of [new CapabilityScope(), new Error("x"), Object.assign(new Error("x"), { name: "TesAuthorizationDeniedError" }), Object.assign(new Error("x"), { code: 403 }), { code: "TES_AUTHORIZATION_DENIED" }, "TES_AUTHORIZATION_DENIED", null, undefined]) {
      assert.equal(isTesDenial(value), false);
    }
  });
  it("the codes it relies on are the ones the real classes carry (drift guard)", () => {
    assert.equal((new Denied() as Error & { code: string }).code, "TES_AUTHORIZATION_DENIED");
    assert.equal((new IdentityRequired() as Error & { code: string }).code, "TES_IDENTITY_REQUIRED");
  });
});

describe("no constructor-name-dependent error handling remains (static guard)", () => {
  const code = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|mts|mjs|js|jsx)$/.test(entry)) out.push(full);
    }
    return out;
  };

  it("no application source reads constructor.name, .constructor, or new.target.name", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "lib", "src", "components", "hooks", "types", "services"]) {
      let files: string[] = [];
      try { files = walk(path.join(ROOT, dir)); } catch { continue; }
      for (const file of files) if (/constructor\??\.\??name|\.constructor\b|new\.target/.test(code(file))) offenders.push(path.relative(ROOT, file));
    }
    assert.deepEqual(offenders, []);
  });

  it("the two OCR routes decide denial through isTesDenial; the contracts service through the explicit denial code", () => {
    for (const file of ["app/api/document-ai/route.ts", "app/api/business-document-ocr/route.ts"]) {
      assert.match(code(path.join(ROOT, file)), /isTesDenial\(error\)/, file);
    }
    const service = code(path.join(ROOT, "lib/contracts/service.ts"));
    assert.match(service, /\.code === "TES_AUTHORIZATION_DENIED"/);
    assert.ok(!/TES_IDENTITY_REQUIRED/.test(service), "only an authorization denial degrades the contacts list");
  });
});
