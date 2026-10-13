// Static boundary checks for the Company Credentials slice (no database needed).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DIR = path.join(ROOT, "lib/company-credentials");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));
const source = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIGRATION = "0018_company_credentials_foundation.sql";
const migrationText = () => readFileSync(path.join(ROOT, "database/migrations", MIGRATION), "utf8");
const migrationSql = () => codeOnly(migrationText().replace(/^\s*--.*$/gm, ""));

// SHA-256 of the applied (CLOSED) migrations 0001-0015. An applied migration must never change.
const CLOSED_MIGRATIONS: Record<string, string> = {
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
  "0015_customer_relationship_foundation.sql": "01bf25b68f07dca9cff60bcefa34a9ceb3abae0470e130f8e88d7b6b93a9254d",
};

describe("Company Credentials boundaries", () => {
  it("the service is the server-only entry point; domain modules stay testable", () => {
    assert.match(source("service.ts"), /^import "server-only"/);
    for (const file of files.filter((name) => name !== "service.ts")) assert.doesNotMatch(source(file), /import "server-only"/, file);
  });

  it("only the service reaches the authorization wrappers or the connection pool", () => {
    for (const file of files.filter((name) => name !== "service.ts")) {
      assert.doesNotMatch(codeOnly(source(file)), /withAuthorized|getPostgresPool|withPostgresTransaction|tes-authorization|tes-system-context/, file);
    }
  });

  it("the service is SYSTEM-only and uses exactly the two credential capabilities, each where designed", () => {
    const service = codeOnly(source("service.ts"));
    assert.doesNotMatch(service, /withAuthorizedCustomer|tes-customer-context/, "no CUSTOMER-facing path");
    const caps = new Set([...service.matchAll(/"([A-Z]+_[A-Z_]+)"/g)].map((match) => match[1]).filter((code) => /^(ORGANIZATION|CUSTOMER|PERSON|CONTACT|CREDENTIAL|INSURANCE|TAX|REGISTRATION|OPERATING|COMPANY)_/.test(code)));
    assert.deepEqual([...caps].sort(), ["CREDENTIAL_MANAGE", "CREDENTIAL_READ"]);
    assert.equal((service.match(/withAuthorizedSystem\("CREDENTIAL_READ"/g) ?? []).length, 3, "listSystems, getSystem, getOrganizationCredentials");
    assert.equal((service.match(/withAuthorizedSystem\("CREDENTIAL_MANAGE"/g) ?? []).length, 1, "every mutation goes through the one manage() helper");
    assert.equal((service.match(/withAuthorizedSystem\(/g) ?? []).length, 4);
  });

  it("the service exposes no reveal, export, delete or customer function", () => {
    const service = codeOnly(source("service.ts"));
    const exported = [...service.matchAll(/export (?:async function|const) (\w+)/g)].map((match) => match[1]);
    assert.ok(exported.length >= 20);
    for (const name of exported) assert.doesNotMatch(name, /reveal|decrypt|export|delete|remove|destroy|merge|secretValue|getSecret|readSecret|customer/i, name);
  });

  it("no DELETE/TRUNCATE SQL and no browser storage or object storage", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|storage\.googleapis|@google-cloud|\bgcs\b/i, file);
    }
  });

  it("the legacy module is pure: no imports besides definitions, no I/O, no database", () => {
    const legacy = codeOnly(source("legacy.ts"));
    const imports = [...legacy.matchAll(/^import[\s\S]*?from "([^"]+)"/gm)].map((match) => match[1]);
    assert.deepEqual(imports, ["@/lib/company-credentials/definitions"]);
    assert.doesNotMatch(legacy, /\bpg\b|fetch\(|node:fs|process\.env|localStorage|window\.|document\./);
  });

  it("the Master Register is only written through the shared recorder with existing event types, never with names, URLs or references", () => {
    const operations = codeOnly(source("operations.ts"));
    assert.match(operations, /recordEvent\(/);
    const types = new Set([...operations.matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.ok(types.size >= 5);
    const registered = readFileSync(path.join(ROOT, "lib/master-register/event-types.ts"), "utf8");
    for (const type of types) assert.ok(registered.includes(`${type}:`), `${type} must be an existing event type`);
    // literal(...) is only ever given codes held in local variables named for their vocabulary, never a name, username, URL or reference
    for (const call of operations.matchAll(/literal\(([^)]*)\)/g)) {
      assert.doesNotMatch(call[1], /username|displayName|normalized|loginUrl|secretReference|alias|input\.name|display\b|url/i, `literal(${call[1]})`);
    }
    assert.doesNotMatch(operations, /after:\s*(changed|literal)\([^)]*secretReference/);
    const resourceTypes = [...operations.matchAll(/resourceType:\s*"([a-z_]+)"/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(resourceTypes)].sort(), ["company_credential", "credential_secret_slot", "credential_status_period", "credential_system", "credential_system_alias", "credential_verification"]);
  });

  it("secret hygiene: no read path selects a store or reference, results carry no secret field, inputs are strict", () => {
    const repository = codeOnly(source("repository.ts"));
    const referenceMentions = repository.split("\n").filter((line) => /secret_reference|secret_store/.test(line));
    assert.equal(referenceMentions.length, 1, "only the attach UPDATE statement mentions them");
    for (const line of referenceMentions) assert.match(line, /UPDATE public\.credential_secret_slots SET secret_state = 'STORED'/);
    assert.doesNotMatch(repository, /SELECT[^`]*secret_(reference|store)/i);
    const types = codeOnly(source("types.ts"));
    assert.doesNotMatch(types, /secretReference|secretStore|secret_reference|password|secretValue|plaintext/i, "no result type can carry a reference or a value");
    const operations = codeOnly(source("operations.ts"));
    assert.match(operations, /requireObject\(rawInput, "input", \["slotId", "secretReference", "secretStore"\]\)/, "the attach input accepts exactly these keys");
    assert.doesNotMatch(operations, /input\.(value|password|secret)\b/);
    assert.match(operations, /isSecretReference\(input\.secretReference\)/);
    // an unknown key is refused without echoing its value
    assert.doesNotMatch(operations, /is not accepted\.`[^\n]*\$\{(value|input\[)/);
  });

  it("the actor of a verification is the authenticated actor, never an input", () => {
    const operations = codeOnly(source("operations.ts"));
    assert.match(operations, /actorId: ctx\.actor\.id/);
    assert.match(operations, /requireObject\(rawInput, "input", \["credentialId", "organizationId", "outcome", "method", "verifiedAt"\]\)/);
  });

  it("migrations 0001-0015 are byte-identical to their closed hashes; 0018 is additive", () => {
    const migrationsDir = path.join(ROOT, "database/migrations");
    for (const [file, hash] of Object.entries(CLOSED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(migrationsDir, file))).digest("hex"), hash, `${file} is CLOSED and must not change`);
    }
    assert.ok(readdirSync(migrationsDir).includes(MIGRATION));
    const sql = migrationSql();
    assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|TRIGGER|FUNCTION|INDEX|SCHEMA)\b/i);
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, "no existing table is altered");
    assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE\s+FROM|TRUNCATE)\s/im, "the migration changes schema and seeds only");
    const created = [...sql.matchAll(/CREATE\s+TABLE\s+public\.(\w+)/gi)].map((match) => match[1]);
    assert.deepEqual(created, ["credential_categories", "credential_systems", "credential_system_aliases", "company_credentials", "credential_status_periods", "credential_verifications", "credential_secret_slots"]);
  });

  it("migration 0018 grants no DELETE/TRUNCATE/ALL, has no SECURITY DEFINER, RLS, policy or tenant context, and grants no capability", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /GRANT\s+(ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/i);
    assert.doesNotMatch(sql, /GRANT\s+[^;]*\b(DELETE|TRUNCATE)\b/i);
    assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i);
    assert.doesNotMatch(sql, /ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY|FORCE\s+ROW/i);
    assert.doesNotMatch(sql, /set_config|current_customer_id/i);
    assert.doesNotMatch(sql, /relationship_capability_grants|relationship_assignments|actor_relationships/i, "nothing is granted to anyone");
    const inserted = [...sql.matchAll(/INSERT INTO public\.capabilities[\s\S]*?;/g)];
    assert.equal(inserted.length, 1);
    assert.deepEqual([...inserted[0][0].matchAll(/'([A-Z_]{5,})',\s*\n\s*'/g)].map((match) => match[1]), ["CREDENTIAL_READ", "CREDENTIAL_MANAGE"]);
  });

  it("migration 0018 has no column that could hold a secret value", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /^\s*(password|passwd|secret|secret_value|secret_text|value|token|api_key|apikey|seed|mfa_seed|pin|answer|security_answer|recovery_value|backup_code|private_key|hash|encrypted\w*|ciphertext)\s+(text|bytea|varchar|character)/im);
    assert.match(sql, /credential_secret_slots_reference_shape/);
    assert.match(sql, /secret_reference ~ '\^projects\//);
  });

  it("the migration has no line the migration runner rejects (transaction control, psql meta-commands)", () => {
    for (const line of migrationText().split("\n")) {
      assert.doesNotMatch(line, /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i, line);
      assert.doesNotMatch(line, /^\s*\\/, line);
    }
  });
});
