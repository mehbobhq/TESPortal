// Static boundary checks for the Customer Relationship slice (no database needed).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DIR = path.join(ROOT, "lib/customer-relationship");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));
const source = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIGRATION = "0015_customer_relationship_foundation.sql";
const migrationText = () => readFileSync(path.join(ROOT, "database/migrations", MIGRATION), "utf8");
const migrationSql = () => codeOnly(migrationText().replace(/^\s*--.*$/gm, ""));

// SHA-256 of the applied (CLOSED) migrations when migration 0015 was added. An applied migration must never change.
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
  "0013_operating_authorities_foundation.sql": "7fcb10c663e9bd7bc216dcf1aa8b08e000a7b1c3bba79a4d0754f63a39b99604",
  "0014_contacts_people_foundation.sql": "9f7cb7093a4d8afdf96a29c0b98de638661a251223f5358d2e1bcd63233db128",
};

describe("Customer Relationship boundaries", () => {
  it("the service is the server-only entry point; domain modules stay testable", () => {
    assert.match(source("service.ts"), /^import "server-only"/);
    for (const file of files.filter((name) => name !== "service.ts")) assert.doesNotMatch(source(file), /import "server-only"/, file);
  });

  it("only the service reaches the authorization wrappers or the connection pool", () => {
    for (const file of files.filter((name) => name !== "service.ts")) {
      assert.doesNotMatch(codeOnly(source(file)), /withAuthorized|getPostgresPool|withPostgresTransaction|tes-authorization|tes-system-context/, file);
    }
  });

  it("the service is SYSTEM-only and uses exactly the three Customer capabilities, each where designed", () => {
    const service = codeOnly(source("service.ts"));
    assert.doesNotMatch(service, /withAuthorizedCustomer|tes-customer-context/, "no CUSTOMER-facing path");
    const caps = new Set([...service.matchAll(/"([A-Z]+_[A-Z_]+)"/g)].map((match) => match[1]).filter((code) => /^(ORGANIZATION|CUSTOMER|PERSON|CONTACT)_/.test(code)));
    assert.deepEqual([...caps].sort(), ["CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_MANAGE", "CUSTOMER_RELATIONSHIP_READ"]);
    assert.equal((service.match(/withAuthorizedSystem\("CUSTOMER_ESTABLISH"/g) ?? []).length, 1, "only establishment uses CUSTOMER_ESTABLISH");
    assert.equal((service.match(/withAuthorizedSystem\("CUSTOMER_RELATIONSHIP_READ"/g) ?? []).length, 2);
    assert.equal((service.match(/withAuthorizedSystem\("CUSTOMER_RELATIONSHIP_MANAGE"/g) ?? []).length, 1, "every mutation goes through the one manage() helper");
  });

  it("no DELETE/TRUNCATE SQL and no hard-coded policy: no transition matrix, no 90-day limit, no pricing, no documents", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /\b90\b|ninety|MAX_PROBATION|probationDays|allowedTransitions|TRANSITIONS\b/i, `${file}: policy belongs to a Rules layer`);
      assert.doesNotMatch(code, /price|invoice|payment|bank|credential|localStorage|gcs|storage\.googleapis|@google-cloud/i, `${file}: out of scope for 0015`);
    }
  });

  it("the Master Register is only written through the shared recorder with existing event types, never with free text", () => {
    const operations = codeOnly(source("operations.ts"));
    assert.match(operations, /recordEvent\(/);
    const types = new Set([...operations.matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]));
    const registered = readFileSync(path.join(ROOT, "lib/master-register/event-types.ts"), "utf8");
    for (const type of types) assert.ok(registered.includes(type), `${type} must be an existing event type`);
    assert.doesNotMatch(operations, /literal\((endReason|input\.endReason|content\.reference|reference\b[^)]*Reference|signedOn)/, "agreement text and reasons never reach the register");
  });

  it("migrations 0001-0014 are byte-identical to their closed hashes; 0015 is additive", () => {
    const migrationsDir = path.join(ROOT, "database/migrations");
    const present = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    assert.deepEqual(present, [...Object.keys(APPLIED_MIGRATIONS), MIGRATION].sort(), "no migration besides 0015 was added or renamed");
    for (const [file, hash] of Object.entries(APPLIED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(migrationsDir, file))).digest("hex"), hash, `${file} is CLOSED and must not change`);
    }
    const sql = migrationSql();
    assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|TRIGGER|FUNCTION|INDEX)\b/i);
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\s+public\.(?!customer_engagements\b)\w+\s+(DROP|ALTER|RENAME)/i);
    assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE\s+FROM|TRUNCATE)\s/im, "the migration changes schema only");
    const alters = [...sql.matchAll(/ALTER\s+TABLE\s+public\.(\w+)\s+(ADD\s+\w+)/gi)].map((match) => `${match[1]} ${match[2].toUpperCase()}`);
    assert.deepEqual([...new Set(alters)], ["customer_engagements ADD COLUMN", "customer_engagements ADD CONSTRAINT"], "the only closed table touched is customer_engagements, additively");
  });

  it("migration 0015 adds exactly two capabilities, no SECURITY DEFINER, no RLS, no tenant context, no capability grants, no speculative data", () => {
    const sql = migrationSql();
    const inserted = [...sql.matchAll(/INSERT INTO public\.capabilities[\s\S]*?;/g)];
    assert.equal(inserted.length, 1);
    assert.deepEqual([...inserted[0][0].matchAll(/'([A-Z_]{5,})',\s*\n\s*'/g)].map((match) => match[1]), ["CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE"]);
    assert.doesNotMatch(sql, /relationship_capability_grants|relationship_assignments|actor_relationships/i, "nothing is granted");
    assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i);
    assert.doesNotMatch(sql, /ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY|FORCE\s+ROW/i);
    assert.doesNotMatch(sql, /set_config|current_customer_id/i);
    assert.doesNotMatch(sql, /\b(price|pricing|invoice|payment|card|bank|credential|document|evidence|vehicle|driver|insurance|tax)\w*\s+(text|numeric|integer|uuid|bytea)\b/i, "no pricing, payment, document, evidence, vehicle, driver, insurance or tax columns");
    // the stage matrix and the probation maximum are policy, not schema
    assert.doesNotMatch(sql, /interval\s+'|\bninety\b|\b90\s+days?\b|\bdays?\b[^;]*\b90\b/i, "no 90-day (or any duration) limit in the schema");
    assert.doesNotMatch(sql, /allowed_transition|stage_transitions|from_stage|to_stage/i, "no stage-transition matrix in the schema");
    assert.doesNotMatch(sql, /INSERT INTO public\.service_catalogue/i, "no speculative services are seeded");
    assert.doesNotMatch(sql, /'(TRIAL|MANAGED_PROBATION)'[^;]*INTO public\.engagement_types|INSERT INTO public\.engagement_types[^;]*'(TRIAL|MANAGED_PROBATION)'/i, "TRIAL and MANAGED_PROBATION are stages, not engagement types");
  });

  it("the termination reason is controlled: a small catalogue, no 'other', no free-text companion; the free-text column is retired", () => {
    const sql = migrationSql();
    assert.match(sql, /CREATE TABLE public\.engagement_end_reasons/);
    assert.match(sql, /customer_engagements_end_reason_code_fk/);
    assert.match(sql, /CHECK \(end_reason IS NULL\)/, "the 0003 free-text column must stay empty");
    assert.match(sql, /REVOKE INSERT \(end_reason\), UPDATE \(end_reason\)/, "the runtime role cannot write the free-text column");
    const seeds = [...sql.matchAll(/INSERT INTO public\.engagement_end_reasons[\s\S]*?;/g)].map((match) => match[0]).join("\n");
    const codes = [...seeds.matchAll(/\(\s*'([A-Z_]+)'/g)].map((match) => match[1]);
    assert.deepEqual(codes, ["COMPLETED", "CUSTOMER_TERMINATED", "TES_TERMINATED", "MUTUAL_AGREEMENT", "ENTERED_IN_ERROR"]);
    for (const code of codes) assert.doesNotMatch(code, /OTHER|UNKNOWN|UNSPECIFIED|MISC/);
    assert.doesNotMatch(sql, /end_reason_(note|text|detail|comment|description)|termination_(note|text|detail|comment)/i, "no free-text companion column");
    const operations = codeOnly(source("operations.ts"));
    assert.doesNotMatch(operations, /parseOptionalText\(input\.endReason/, "the end reason is never parsed as text");
    assert.match(operations, /isEngagementEndReason/);
    const definitions = codeOnly(source("definitions.ts"));
    assert.doesNotMatch(definitions.match(/ENGAGEMENT_END_REASONS = \[[^\]]*\]/)?.[0] ?? "", /OTHER|UNKNOWN|UNSPECIFIED/);
  });

  it("no operation can reopen an Engagement, and the termination correction is the only writer of a changed end", () => {
    const service = codeOnly(source("service.ts"));
    assert.doesNotMatch(service, /reopen|restart|resume|undo/i);
    const operations = codeOnly(source("operations.ts"));
    assert.equal((operations.match(/repo\.setEngagementEnd\(/g) ?? []).length, 2, "only endEngagement and correctEngagementTermination write ended_at");
    assert.doesNotMatch(operations, /ended_at\s*=\s*NULL|endedAt:\s*null\s*\}\s*\)/i);
    const sql = migrationSql();
    assert.match(sql, /cannot be reopened/);
    assert.match(sql, /customer_engagement_terminations/);
  });

  it("the migration has no line the migration runner rejects (transaction control, psql meta-commands)", () => {
    for (const line of migrationText().split("\n")) {
      assert.doesNotMatch(line, /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i, line);
      assert.doesNotMatch(line, /^\s*\\/, line);
    }
  });

  it("the production verification workflow is manual, main-gated and read-only; its script is read-only", () => {
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/production-customer-relationship-verification.yml"), "utf8");
    assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
    assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
    assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /environment: production-database/);
    assert.match(workflow, /verify-production-customer-relationship\.sh/);
    assert.doesNotMatch(workflow, /migrate\.sh|psql[^\n]*-c/);
    const script = readFileSync(path.join(ROOT, "scripts/database/verify-production-customer-relationship.sh"), "utf8");
    assert.match(script, /BEGIN READ ONLY;/);
    assert.match(script, /\nROLLBACK;/);
  });
});
