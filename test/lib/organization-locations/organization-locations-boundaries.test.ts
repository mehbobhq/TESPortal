// Static boundary checks for the Organization Locations slice (no database needed).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DIR = path.join(ROOT, "lib/organization-locations");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));
const source = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// SHA-256 of the applied migrations at the time migration 0012 was added. An applied migration must never change.
const APPLIED_MIGRATIONS: Record<string, string> = {
  "0001_database_foundation.sql": "cafc5c70d4af93754e36595087c817b7542587e8c06aa565f2c485308d59eba3",
  "0002_runtime_privilege_hardening.sql": "6bf3310f763ae8842b76d7098b9d5dcca39d56012e5bf25a1900edb43cf40ee3",
  "0003_canonical_organization_customer_foundation.sql": "b615a2d975fce55168486eafd1797d6d5d2e1919689ffd835b82b34c05f52444",
  "0004_tenant_isolation_foundation.sql": "4734f2fcb85b925f1fad938d00b5277148786e0c3ff6aad67359dec265592555",
  "0005_actor_authentication_identity_foundation.sql": "871e59ae6337ef45857e9cc22b3420d5050ab0845d2bb9bd926fa620dac8314e",
  "0006_authorization_foundation.sql": "f44853f86d34e016573d92203a5579fad3cdad63d02f9b3b10f1bd0635d5d6db",
  "0007_tenant_context_hardening.sql": "50d3f165d790cec8b076e17fb3f4e2a9ae3e10204cc7880f57dfdf30abb4d0b6",
  "0008_master_register_persistence.sql": "cc58d70465e68dba438c0c1d12520b9448ed34dccaf9e0837322e97a41731398",
  "0009_master_register_customer_context.sql": "867d9cb67472dec9c0e596a61cf57dccb91fd3a5c9aff2c1723dfdfa992d2660",
  "0010_legacy_company_identity_continuity.sql": "bc6cb94c85154615ad9fb857dc57d798fd7039ad98322cf000f8c6a5b4517c29",
  "0011_companies_capability_catalogue.sql": "2cc087df19b99e66b58d587d459e95f23880595742ef573d30759ffe0cf39bcb",
};

describe("Organization Locations boundaries", () => {
  it("the service is the server-only entry point; domain modules stay testable", () => {
    assert.match(source("service.ts"), /^import "server-only"/);
    for (const file of files.filter((name) => name !== "service.ts")) {
      assert.doesNotMatch(source(file), /import "server-only"/, file);
    }
  });

  it("only the service reaches the authorization wrappers or the connection pool", () => {
    for (const file of files.filter((name) => name !== "service.ts")) {
      assert.doesNotMatch(codeOnly(source(file)), /withAuthorized|getPostgresPool|withPostgresTransaction|tes-authorization|tes-system-context/, file);
    }
  });

  it("no DELETE/TRUNCATE SQL, no merge, no coordinates / timezone / geocoding, no CMP identity in the slice", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /merged_into|\bmerge[A-Z_a-z]*\(/i, `${file}: merge is not implemented`);
      assert.doesNotMatch(code, /latitude|longitude|geocod|timezone/i, `${file}: coordinates / timezone are deferred`);
      assert.doesNotMatch(code, /\bCMP-|legacy_record/i, `${file}: legacy CMP identity stays in migration 0010`);
    }
  });

  it("every Master Register event type the slice uses already exists in the catalogue", async () => {
    await import("../../helpers/register-alias-loader.mjs");
    const { isRegisteredEventType } = await import("@/lib/master-register/event-types");
    const used = new Set([...source("operations.ts").matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.ok(used.size >= 6);
    for (const eventType of used) assert.equal(isRegisteredEventType(eventType), true, eventType);
  });

  it("applied migrations 0001-0011 are byte-for-byte unchanged and 0012 is the next, additive migration", () => {
    const dir = path.join(ROOT, "database/migrations");
    const present = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    for (const [name, expected] of Object.entries(APPLIED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(dir, name))).digest("hex"), expected, name);
    }
    assert.deepEqual(present.slice(0, 11), Object.keys(APPLIED_MIGRATIONS));
    assert.equal(present[11], "0012_organization_locations_foundation.sql");
    const sql = readFileSync(path.join(dir, present[11]), "utf8").replace(/^\s*--.*$/gm, "");
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\s+public\.(?!locations|location_addresses|organization_location_assignments)/i);
    assert.doesNotMatch(sql, /merged_into|latitude|longitude|timezone/i);
    assert.doesNotMatch(sql, /GRANT[^;]*\b(DELETE|TRUNCATE|ALL)\b/i);
  });
});
