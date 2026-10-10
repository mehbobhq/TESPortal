// Static boundary checks for the Operating Authorities slice (no database needed).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DIR = path.join(ROOT, "lib/operating-authorities");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));
const source = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIGRATION = "0013_operating_authorities_foundation.sql";
const migrationSql = () => codeOnly(readFileSync(path.join(ROOT, "database/migrations", MIGRATION), "utf8").replace(/^\s*--.*$/gm, ""));

// SHA-256 of the applied migrations when migration 0013 was added. An applied migration must never change.
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
  "0012_organization_locations_foundation.sql": "fb253977ce49d0acf60bf81b4a676fc21a89882d0ba171dbd77034fcb8979866",
};

describe("Operating Authorities boundaries", () => {
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

  it("the service enforces exactly the mapped capabilities", () => {
    const service = codeOnly(source("service.ts"));
    const caps = new Set([...service.matchAll(/"(ORGANIZATION_[A-Z_]+|CUSTOMER_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.deepEqual([...caps].sort(), ["ORGANIZATION_READ", "ORGANIZATION_REGISTRY_READ", "ORGANIZATION_UPDATE"]);
    assert.equal((service.match(/withAuthorizedSystem\("ORGANIZATION_UPDATE"/g) ?? []).length, 8);
    assert.equal((service.match(/withAuthorizedSystem\("ORGANIZATION_REGISTRY_READ"/g) ?? []).length, 2);
    assert.equal((service.match(/withAuthorizedCustomer\(customerId, "ORGANIZATION_READ"/g) ?? []).length, 1);
  });

  it("no DELETE/TRUNCATE SQL, no merge, no expiry-status or evidence or required flag in the slice", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /merged_into|\b(?:merge|move|transfer)(?:Authorit|Organization)[A-Za-z]*\(/i, `${file}: moving / merging authorities is not implemented`);
      assert.doesNotMatch(code, /evidence_complete|is_required|\brequired_flag\b|"EXPIRED"/i, `${file}: no stored expired status / evidence / required flag`);
    }
  });

  it("Contacts, Customer Relationship, browser storage and GCS stay out of the slice", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /localStorage|sessionStorage|@google-cloud|PERSON_REGISTRY|CUSTOMER_RELATIONSHIP|\bcontacts?\b/i, file);
    }
  });

  it("every Master Register event type the slice uses already exists in the catalogue", async () => {
    await import("../../helpers/register-alias-loader.mjs");
    const { isRegisteredEventType } = await import("@/lib/master-register/event-types");
    const used = new Set([...source("operations.ts").matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.ok(used.size >= 6);
    for (const eventType of used) assert.equal(isRegisteredEventType(eventType), true, eventType);
  });

  it("applied migrations 0001-0012 are byte-for-byte unchanged and 0013 is the next, additive migration", () => {
    const dir = path.join(ROOT, "database/migrations");
    const present = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    for (const [name, expected] of Object.entries(APPLIED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(dir, name))).digest("hex"), expected, name);
    }
    assert.deepEqual(present.slice(0, 12), Object.keys(APPLIED_MIGRATIONS));
    assert.equal(present[12], MIGRATION);
    const sql = migrationSql();
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\s+public\.(?!operating_authorit|authority_kinds)/i);
    assert.doesNotMatch(sql, /\bDROP\b/i);
    assert.doesNotMatch(sql, /GRANT[^;]*\b(DELETE|TRUNCATE|ALL)\b/i);
  });

  it("migration 0013 adds no capability, no SECURITY DEFINER function and no RLS", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /public\.capabilities|relationship_capability_grants/i);
    assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i);
    assert.doesNotMatch(sql, /ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY|FORCE\s+ROW/i);
    assert.doesNotMatch(sql, /master_account|tes_set_tenant|set_config/i);
  });

  it("the migration has no line the migration runner rejects (transaction control, psql meta-commands)", () => {
    for (const line of readFileSync(path.join(ROOT, "database/migrations", MIGRATION), "utf8").split("\n")) {
      assert.doesNotMatch(line, /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i, line);
      assert.doesNotMatch(line, /^\s*\\/, line);
    }
  });

  it("the production verification workflow is manual, main-gated and read-only; its script is read-only and pre/post aware", () => {
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/production-operating-authorities-verification.yml"), "utf8");
    assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
    assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
    assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /environment: production-database/);
    assert.match(workflow, /verify-production-operating-authorities\.sh/);
    assert.doesNotMatch(workflow, /migrate\.sh|psql[^\n]*-c/);
    const script = readFileSync(path.join(ROOT, "scripts/database/verify-production-operating-authorities.sh"), "utf8");
    assert.match(script, /BEGIN READ ONLY;/);
    assert.match(script, /\nROLLBACK;/);
    assert.match(script, /TES_VERIFY_PHASE/);
    assert.match(script, /TES_VERIFY_EXPECT_EMPTY/);
    const sqlPart = script.slice(script.indexOf("<<'SQL'"));
    assert.doesNotMatch(sqlPart.replace(/\$exp\$[\s\S]*?\$exp\$/g, ""), /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/im);
  });
});
