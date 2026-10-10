// Static boundary checks for the Corporate Identity slice (no database needed).

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const DIR = path.resolve(import.meta.dirname, "../../../lib/corporate-identity");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));
const source = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Corporate Identity boundaries", () => {
  it("the service is the server-only entry point; domain modules stay testable", () => {
    assert.match(source("service.ts"), /^import "server-only"/);
    for (const file of files.filter((name) => name !== "service.ts")) {
      assert.doesNotMatch(source(file), /import "server-only"/, file);
    }
  });

  it("only the service reaches the authorization wrappers or the connection pool", () => {
    for (const file of files.filter((name) => name !== "service.ts")) {
      assert.doesNotMatch(codeOnly(source(file)), /withAuthorized|getPostgresPool|withPostgresTransaction|tes-authorization/, file);
    }
  });

  it("no legacy CMP identity, no DELETE/TRUNCATE SQL and no merge in the slice", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /\bCMP-|\bcmp[A-Z_]|legacy_record/i, `${file}: legacy CMP identity must stay in migration 0010`);
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /merged_into_organization_id\s*=|status\s*=\s*'merged'/i, `${file}: merge is not implemented here`);
    }
  });

  it("every Master Register event type the slice uses already exists in the catalogue", async () => {
    await import("../../helpers/register-alias-loader.mjs");
    const { isRegisteredEventType } = await import("@/lib/master-register/event-types");
    const used = new Set([...source("operations.ts").matchAll(/"((?:ORGANIZATION|RECORD)_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.ok(used.size >= 5);
    for (const eventType of used) assert.equal(isRegisteredEventType(eventType), true, eventType);
  });
});
