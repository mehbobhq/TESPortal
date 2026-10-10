// Static architecture rules for the authorization layer (no database). Run through scripts/test/run-auth-tests.sh.
//
// These keep Company/domain code on the approved path: authorization and work on ONE transaction through
// withAuthorizedSystem() / withAuthorizedCustomer(), SYSTEM never touching tenant context, and no unauthenticated
// transaction helper reachable from application code.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "test", "docs", "public", "scripts", ".tes-data"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mts|mjs|js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const files = sourceFiles(ROOT).map((file) => ({ file: rel(file), text: readFileSync(file, "utf8") }));

/** Source with comments removed, so rules apply to code and not to the prose that documents it. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function importersOf(pattern: RegExp): string[] {
  return files.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
}

describe("authorization layer boundaries", () => {
  it("only lib/auth may import the authorization entry, core or SQL modules (application code uses the wrappers)", () => {
    const offenders = importersOf(
      /from\s+["'](?:@\/lib\/auth\/|\.{1,2}\/(?:\.\.\/)*(?:lib\/)?auth\/)?tes-authorization(?:-core|-sql)?["']/,
    ).filter((file) => !file.startsWith("lib/auth/"));
    assert.deepEqual(offenders, []);
  });

  it("only lib/auth and lib/database may use the raw withPostgresTransaction helper (it has no authorization)", () => {
    const offenders = importersOf(/postgres-transaction["']/).filter(
      (file) => !file.startsWith("lib/auth/") && !file.startsWith("lib/database/"),
    );
    assert.deepEqual(offenders, []);
  });

  it("the SYSTEM wrapper never writes tenant context", () => {
    const text = codeOnly(files.find(({ file }) => file === "lib/auth/tes-system-context.ts")?.text ?? "");
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /set_config/);
    assert.doesNotMatch(text, /tes\.customer_id/);
    assert.match(text, /assertNoTenantContext/);
  });

  it("SYSTEM and CUSTOMER wrappers do not depend on each other (no scope inheritance by construction)", () => {
    const system = files.find(({ file }) => file === "lib/auth/tes-system-context.ts")?.text ?? "";
    const customer = files.find(({ file }) => file === "lib/auth/tes-customer-context.ts")?.text ?? "";
    assert.doesNotMatch(system, /tes-customer-context/);
    assert.doesNotMatch(customer, /tes-system-context/);
  });

  it("the pooled-connection requireTesAuthorization() (authorization on a different connection than the work) is gone", () => {
    const entry = files.find(({ file }) => file === "lib/auth/tes-authorization.ts")?.text ?? "";
    assert.doesNotMatch(entry, /export\s+(?:async\s+)?function\s+requireTesAuthorization\s*\(/);
  });

  it("every wrapper goes through the nesting guard and the tenant-context assertion", () => {
    for (const name of ["tes-system-context", "tes-customer-context", "tes-accessible-customers"]) {
      const text = files.find(({ file }) => file === `lib/auth/${name}.ts`)?.text ?? "";
      assert.match(text, /runExclusiveAuthorizedWork/, `${name} must use the nesting guard`);
      assert.match(text, /assertNoTenantContext/, `${name} must assert no tenant context`);
    }
  });

  it("capability strings are typed: wrappers take TesSystemCapability / TesCustomerCapability, not string", () => {
    const system = files.find(({ file }) => file === "lib/auth/tes-system-context.ts")?.text ?? "";
    const customer = files.find(({ file }) => file === "lib/auth/tes-customer-context.ts")?.text ?? "";
    assert.match(system, /capability: TesSystemCapability/);
    assert.match(customer, /capability: TesCustomerCapability/);
  });
});
