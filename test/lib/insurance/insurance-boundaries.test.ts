// Static boundary checks for the Insurance slice (no database needed).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DIR = path.join(ROOT, "lib/insurance");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));
const source = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIGRATION = "0017_insurance_foundation.sql";
const migrationText = () => readFileSync(path.join(ROOT, "database/migrations", MIGRATION), "utf8");
const migrationSql = () => codeOnly(migrationText().replace(/^\s*--.*$/gm, ""));

// SHA-256 of the applied (CLOSED) migrations. An applied migration must never change.
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

describe("Insurance boundaries", () => {
  it("the service is the server-only entry point; domain modules stay testable", () => {
    assert.match(source("service.ts"), /^import "server-only"/);
    for (const file of files.filter((name) => name !== "service.ts")) assert.doesNotMatch(source(file), /import "server-only"/, file);
  });

  it("only the service reaches the authorization wrappers or the connection pool", () => {
    for (const file of files.filter((name) => name !== "service.ts")) {
      assert.doesNotMatch(codeOnly(source(file)), /withAuthorized|hasAdditionalSystemCapability|getPostgresPool|withPostgresTransaction|tes-authorization|tes-system-context/, file);
    }
  });

  it("the service is SYSTEM-only and uses exactly the two Insurance capabilities, each where designed", () => {
    const service = codeOnly(source("service.ts"));
    assert.doesNotMatch(service, /withAuthorizedCustomer|tes-customer-context/, "no CUSTOMER-facing path");
    const caps = new Set([...service.matchAll(/"([A-Z]+_[A-Z_]+)"/g)].map((match) => match[1]).filter((code) => /^(ORGANIZATION|CUSTOMER|PERSON|CONTACT|INSURANCE|TAX|CREDENTIAL|COMPANY)_/.test(code)));
    assert.deepEqual([...caps].sort(), ["INSURANCE_MANAGE", "INSURANCE_READ"]);
    assert.equal((service.match(/withAuthorizedSystem\("INSURANCE_READ"/g) ?? []).length, 4, "getOrganizationInsurance, checkPolicyNumber, getCoverageSchedule and getVehicleInsurance (0025 added the last two)");
    assert.equal((service.match(/withAuthorizedSystem\("VEHICLE_READ"/g) ?? []).length, 1, "getVehicleInsurance resolves the vehicle merge chain in its own VEHICLE_READ transaction (0025)");
    assert.equal((service.match(/withAuthorizedSystem\("INSURANCE_MANAGE"/g) ?? []).length, 1, "every mutation goes through the one manage() helper");
    assert.equal((service.match(/withAuthorizedSystem\(/g) ?? []).length, 6, "no other authorization entry exists");
    assert.equal((service.match(/hasAdditionalSystemCapability\(client, decision, "INSURANCE_READ"\)/g) ?? []).length, 1, "collision disclosure is gated on INSURANCE_READ, once");
  });

  it("the service exposes exactly the designed operations", () => {
    const service = codeOnly(source("service.ts"));
    const exported = [...service.matchAll(/^export (?:async function|const) (\w+)/gm)].map((match) => match[1]).sort();
    assert.deepEqual(exported, [
      "addEndorsement", "archivePolicy", "cancelTerm", "changeBroker", "changeSchedule", "checkPolicyNumber", "correctBroker", "correctCoverage", "correctEndorsement", "correctSchedule",
      "correctTerm", "createPolicy", "getCoverageSchedule", "getOrganizationInsurance", "getVehicleInsurance", "removeScheduledVehicle", "renewPolicy", "restorePolicy", "scheduleVehicle",
    ]);
    // removeScheduledVehicle (0025) ends a schedule window and deletes nothing; it is the only permitted "remove"
    assert.doesNotMatch(service.replace(/removeScheduledVehicle/g, ""), /delete|remove|destroy|merge|reopen|undo/i);
  });

  it("no DELETE/TRUNCATE SQL; no browser storage or Google Cloud storage; no UI imports", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|@google-cloud|storage\.googleapis|gcs\b/i, file);
      assert.doesNotMatch(code, /from "react"|from "next|@\/components|@\/app\//, file);
    }
  });

  it("the legacy mapping is pure: no database, no authorization, no I/O", () => {
    const legacy = codeOnly(source("legacy.ts"));
    assert.doesNotMatch(legacy, /repository|operations|service|pg"|from "node:fs"|process\.env|fetch\(|await /);
  });

  it("the Master Register is only written through the shared recorder with existing event types, never with numbers, amounts, dates or names", () => {
    const operations = codeOnly(source("operations.ts"));
    assert.match(operations, /recordEvent\(/);
    const types = new Set([...operations.matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.ok(types.size > 0);
    const registered = readFileSync(path.join(ROOT, "lib/master-register/event-types.ts"), "utf8");
    for (const type of types) assert.ok(registered.includes(`${type}:`), `${type} must be an existing event type`);
    // only literal() of controlled vocabulary; every literal() argument is a constant, a code variable, or a lifecycle word
    const literals = [...operations.matchAll(/literal\(([^)]*)\)/g)].map((match) => match[1].trim());
    const allowed = /^(null|"[A-Za-z_]+"|family|kind|reason|spec\.coverageType|current\.coverageType|old\.kind|endorsement\.kind|from\.coverageType|target\.coverageType|merged\.coverageType|coverageType)$/;
    for (const argument of literals) assert.match(argument, allowed, `literal(${argument}) must be controlled vocabulary`);
    assert.doesNotMatch(operations, /literal\([^)]*(number|amount|limit|deductible|Date|termStart|termEnd|cancelledOn|effectiveOn|legalName|display)/i, "no numbers, amounts, dates or names reach the register");
    // resource types are the six designed ones (insurance_coverage_vehicle was added by 0025)
    const resources = new Set([...operations.matchAll(/resourceType: "(\w+)"/g)].map((match) => match[1]));
    assert.deepEqual([...resources].sort(), ["insurance_broker_period", "insurance_coverage", "insurance_coverage_vehicle", "insurance_endorsement", "insurance_policy", "insurance_policy_term"]);
    assert.match(operations, /subjectReferences: \[`organization:\$\{target\.organizationId\}`\]/);
  });

  it("every mutation takes the locks in the designed order: Organization, then policy, then dependents", () => {
    const operations = codeOnly(source("operations.ts"));
    const lockPolicy = operations.slice(operations.indexOf("async function lockPolicy("), operations.indexOf("type LockedTerm"));
    assert.ok(lockPolicy.indexOf("lockActiveOrganization") < lockPolicy.indexOf("repo.getPolicy("), "Organization before policy");
    const repository = codeOnly(source("repository.ts"));
    assert.match(repository, /FROM public\.organizations WHERE id = \$1 FOR UPDATE/);
    assert.match(repository, /FROM public\.insurance_policies WHERE id = \$1\$\{lock \? " FOR UPDATE" : ""\}/);
    // createPolicy locks the insured Organization before touching anything else
    const create = operations.slice(operations.indexOf("export async function createPolicy("), operations.indexOf("function coverageInsert("));
    assert.ok(create.indexOf("lockActiveOrganization(ctx, organizationId)") < create.indexOf("repo.insertPolicy("));
    // every mutating operation enters through lockPolicy / lockTerm / lockActiveOrganization
    for (const name of ["renewPolicy", "cancelTerm", "addEndorsement", "correctTerm", "correctCoverage", "correctEndorsement", "changeBroker", "correctBroker", "archivePolicy", "restorePolicy"]) {
      const start = operations.indexOf(`export async function ${name}(`);
      const body = operations.slice(start, operations.indexOf("\nexport ", start + 10) === -1 ? undefined : operations.indexOf("\nexport ", start + 10));
      assert.match(body, /lockPolicy\(|lockTerm\(/, name);
    }
  });

  it("out of scope is absent: no certificates, evidence, URLs, filings, sufficiency verdicts or stored status (the vehicle schedule of 0025 is in scope)", () => {
    const forbiddenWord = /certificate|\bcoi\b|evidence|document|\burl\b|\bocr\b|filing|bmc[-_ ]?91|sufficien|verdict|compliant/i;
    for (const file of files) {
      const code = codeOnly(source(file));
      if (file === "legacy.ts") continue; // legacy.ts names the legacy fields it deliberately does not migrate
      assert.doesNotMatch(code, forbiddenWord, file);
    }
    // expiry and "in force" are derived (definitions.ts), never persisted: no SQL mentions them
    assert.doesNotMatch(codeOnly(source("repository.ts")), /expired|in_force|policy_status|is_expired|is_in_force/i);
    const sql = migrationSql();
    const columns = [...sql.matchAll(/^\s{4}([a-z][a-z0-9_]*)\s+(?:uuid|text|date|timestamptz|boolean|integer|numeric\(\d+,\s*\d+\))\b/gm)].map((match) => match[1]);
    assert.ok(columns.length > 60, "the column scan found the table columns");
    for (const column of columns) {
      assert.doesNotMatch(column, /certificate|coi|evidence|document|file|url|ocr|filing|bmc|vehicle_id|sufficien|verdict|compliant|expired|in_force|policy_status/, `column ${column}`);
      if (column !== "record_status") assert.doesNotMatch(column, /^status$|_status$/, `column ${column}`);
    }
    assert.deepEqual([...new Set(columns.filter((column) => /status/.test(column)))], ["record_status"], "the only status column is the record lifecycle");
    assert.doesNotMatch(sql, /CREATE TABLE public\.(?!insurance_)\w+/, "every table is an insurance table");
    assert.deepEqual(
      [...sql.matchAll(/CREATE TABLE public\.(\w+)/g)].map((match) => match[1]),
      ["insurance_coverage_types", "insurance_policies", "insurance_policy_terms", "insurance_endorsements", "insurance_coverages", "insurance_broker_periods"],
    );
  });

  it("migrations 0001-0015 are byte-identical to their closed hashes; 0017 exists and nothing numbered <= 0015 was added or renamed", () => {
    const migrationsDir = path.join(ROOT, "database/migrations");
    const present = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    assert.deepEqual(
      present.filter((file) => Number(file.slice(0, 4)) <= 15),
      Object.keys(CLOSED_MIGRATIONS).sort(),
    );
    assert.ok(present.includes(MIGRATION));
    for (const [file, hash] of Object.entries(CLOSED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(migrationsDir, file))).digest("hex"), hash, `${file} is CLOSED and must not change`);
    }
  });

  it("migration 0017 is additive: only new tables, indexes, functions, triggers, one catalogue seed and two capability rows", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|TRIGGER|FUNCTION|INDEX|SCHEMA)\b/i);
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, "no existing table is altered");
    assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE\s+FROM|TRUNCATE)\s/im, "the migration changes schema only");
    assert.doesNotMatch(sql, /\bGRANT\s+(ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/i, "no DELETE / TRUNCATE / ALL grant");
    assert.doesNotMatch(sql, /\bGRANT\s+UPDATE\s+ON\b/i, "UPDATE is only ever granted per column");
    assert.doesNotMatch(sql, /\bGRANT\s+INSERT\s+ON\b/i, "INSERT is only ever granted per column");
    assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i);
    assert.doesNotMatch(sql, /ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY|FORCE\s+ROW/i);
    assert.doesNotMatch(sql, /set_config|current_customer_id/i);
    assert.doesNotMatch(sql, /relationship_capability_grants|relationship_assignments|actor_relationships/i, "nothing is granted to anyone");
    const inserts = [...sql.matchAll(/INSERT INTO public\.(\w+)/g)].map((match) => match[1]);
    assert.deepEqual(inserts, ["insurance_coverage_types", "capabilities"]);
    const capabilities = [...sql.matchAll(/INSERT INTO public\.capabilities[\s\S]*?;/g)];
    assert.equal(capabilities.length, 1);
    assert.deepEqual([...capabilities[0][0].matchAll(/'([A-Z_]{5,})',\s*\n\s*'/g)].map((match) => match[1]), ["INSURANCE_READ", "INSURANCE_MANAGE"]);
    for (const description of [...capabilities[0][0].matchAll(/Intended scope: SYSTEM only\./g)]) assert.ok(description);
    assert.equal((capabilities[0][0].match(/Intended scope: SYSTEM only\./g) ?? []).length, 2);
    // every function is invoker with a fixed search_path and no PUBLIC execute
    const functions = [...sql.matchAll(/CREATE FUNCTION tes_security\.(\w+)\(\)/g)].map((match) => match[1]);
    assert.ok(functions.length >= 12);
    assert.equal((sql.match(/SECURITY INVOKER/g) ?? []).length, functions.length);
    assert.equal((sql.match(/SET search_path = pg_catalog/g) ?? []).length, functions.length);
    for (const name of functions) assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION tes_security\\.${name}\\(\\) FROM PUBLIC`), name);
    // the runtime role never receives DELETE / TRUNCATE; every table has a no-delete and a no-truncate trigger
    for (const table of ["insurance_policies", "insurance_policy_terms", "insurance_endorsements", "insurance_coverages", "insurance_broker_periods"]) {
      assert.match(sql, new RegExp(`CREATE TRIGGER ${table}_no_delete`), table);
      assert.match(sql, new RegExp(`CREATE TRIGGER ${table}_no_truncate`), table);
    }
  });

  it("the migration has no line the migration runner rejects (transaction control, psql meta-commands)", () => {
    for (const line of migrationText().split("\n")) {
      assert.doesNotMatch(line, /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)([\s;]|$)/i, line);
      assert.doesNotMatch(line, /^\s*\\/, line);
    }
  });

  it("the policy-number namespace is per insurer, never global: the lookup index and the rule are insurer-scoped", () => {
    const sql = migrationSql();
    assert.match(sql, /insurance_policy_terms_number_lookup_idx\s+ON public\.insurance_policy_terms \(insurer_organization_id, number_normalized\)/);
    assert.doesNotMatch(sql, /CREATE UNIQUE INDEX\s+\w+\s+ON public\.insurance_policy_terms/i, "no unique index on a policy number: the namespace is a per-insurer trigger");
    const operations = codeOnly(source("operations.ts"));
    assert.match(operations, /findNumberHolder\(client, insurerOrganizationId, number\.normalized, null\)/);
  });
});
