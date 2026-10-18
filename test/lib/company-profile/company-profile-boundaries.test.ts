// Static boundary checks for the Company Operating Profile slice (no database needed).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DIR = path.join(ROOT, "lib/company-profile");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));
const source = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIGRATION = "0019_company_operating_profile_foundation.sql";
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

describe("Company Operating Profile boundaries", () => {
  it("the domain ships exactly the expected modules", () => {
    assert.deepEqual([...files].sort(), ["definitions.ts", "errors.ts", "facts.ts", "legacy.ts", "operations.ts", "repository.ts", "service.ts", "types.ts"]);
  });

  it("the service is the server-only entry point; domain modules stay testable", () => {
    assert.match(source("service.ts"), /^import "server-only"/);
    for (const file of files.filter((name) => name !== "service.ts")) assert.doesNotMatch(source(file), /import "server-only"/, file);
  });

  it("only the service reaches the authorization wrappers or the connection pool", () => {
    for (const file of files.filter((name) => name !== "service.ts")) {
      assert.doesNotMatch(codeOnly(source(file)), /withAuthorized|getPostgresPool|withPostgresTransaction|tes-authorization|tes-system-context|tes-customer-context/, file);
    }
  });

  it("the service is SYSTEM-only and uses exactly the two Company Profile capabilities, each where designed", () => {
    const service = codeOnly(source("service.ts"));
    assert.doesNotMatch(service, /withAuthorizedCustomer|tes-customer-context/, "no CUSTOMER-facing path");
    const caps = new Set([...service.matchAll(/"([A-Z]+_[A-Z_]+)"/g)].map((match) => match[1]).filter((code) => /_(READ|MANAGE|ESTABLISH|UPDATE|CREATE|ARCHIVE|REGISTRY_READ)$/.test(code)));
    assert.deepEqual([...caps].sort(), ["COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ"]);
    assert.equal((service.match(/withAuthorizedSystem\("COMPANY_PROFILE_READ"/g) ?? []).length, 3, "listRules, getCompanyProfile, compareTaxApplicabilityWithRegistrations");
    assert.equal((service.match(/withAuthorizedSystem\("COMPANY_PROFILE_MANAGE"/g) ?? []).length, 1, "every mutation goes through the one manage() helper");
    assert.equal((service.match(/withAuthorizedSystem\(/g) ?? []).length, 4, "no other authorization call");
    assert.equal((service.match(/manage\(\(ctx\)/g) ?? []).length, 7, "the seven mutations");
  });

  it("the service exposes no delete, remove, merge, customer-scope or key/value function", () => {
    const exported = [...codeOnly(source("service.ts")).matchAll(/export (?:async function|const) (\w+)/g)].map((match) => match[1]);
    assert.deepEqual(exported.sort(), [
      "clearRuleApplicability", "compareTaxApplicabilityWithRegistrations", "correctDriverRequirements", "correctOperatingScope", "correctRuleApplicability",
      "getCompanyProfile", "listRules", "setDriverRequirements", "setOperatingScope", "setRuleApplicability",
    ]);
    assert.deepEqual(exported.filter((name) => /delete|remove|destroy|merge|customer|preference|setting|keyvalue/i.test(name)), []);
  });

  it("no DELETE/TRUNCATE SQL, no browser storage, no GCS, no key/value or preference storage", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /localStorage|sessionStorage|storage\.googleapis|@google-cloud|\bgcs\b/i, file);
      assert.doesNotMatch(code, /key_value|keyvalue|setting_key|setting_value|user_preference|ui_preference|theme|layout/i, `${file}: no preference storage`);
    }
  });

  it("this domain never imports another domain: cross-domain reads are plain SELECTs in the repository", () => {
    for (const file of files) {
      assert.doesNotMatch(
        codeOnly(source(file)),
        /from "@\/lib\/(tax-registrations|insurance|company-credentials|operating-authorities|customer-relationship|contacts|organization-locations|corporate-identity)/,
        file,
      );
    }
    const repository = codeOnly(source("repository.ts"));
    assert.match(repository, /FROM public\.registrations/);
    assert.doesNotMatch(repository, /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(registrations|registration_versions|registration_status_periods|registration_programs)\b/i, "registrations are only ever read here");
  });

  it("the Master Register is only written through the shared recorder with existing event types, never with names, numbers, dates or free text", () => {
    const operations = codeOnly(source("operations.ts"));
    assert.match(operations, /recordEvent\(/);
    const types = new Set([...operations.matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.deepEqual([...types].sort(), ["RECORD_CORRECTED", "RECORD_CREATED", "RECORD_UPDATED"]);
    const registered = readFileSync(path.join(ROOT, "lib/master-register/event-types.ts"), "utf8");
    for (const type of types) assert.ok(registered.includes(`${type}:`), `${type} must be an existing event type`);
    // numbers (driver minimums), dates and instants never become register values
    assert.doesNotMatch(operations, /literal\([^)]*(minimumDriver|effectiveFrom|effectiveTo|endedAt|\bat\b|asOf|displayName|\.name)/, "no numeric, date or name literal reaches the register");
    assert.deepEqual(
      [...operations.matchAll(/resourceType: "([a-z_]+)"/g)].map((match) => match[1]).filter((value, index, all) => all.indexOf(value) === index).sort(),
      ["company_driver_requirement_period", "company_operating_scope_period", "company_rule_applicability_period"],
    );
    assert.equal((operations.match(/subjectReferences: \[`organization:\$\{target\.organizationId\}`\]/g) ?? []).length, 1);
  });

  it("every mutation locks the Organization first; every correction re-reads its target under that lock", () => {
    const operations = codeOnly(source("operations.ts"));
    const bodies = operations.split(/\nexport async function /).slice(1);
    const mutations = bodies.filter((body) => /^(set|clear|correct)[A-Z]/.test(body));
    assert.equal(mutations.length, 7);
    for (const body of mutations) {
      const name = body.slice(0, body.indexOf("("));
      const lockAt = body.indexOf("lockActiveOrganization(");
      assert.ok(lockAt > 0, `${name} locks the Organization`);
      for (const later of ["repo.getCurrent", "repo.getScopePeriod(ctx.client, periodId, true)", "repo.getRulePeriod(ctx.client, periodId, true)", "repo.getDriverPeriod(ctx.client, periodId, true)", "repo.endPeriod", "repo.markCorrected", "repo.insert"]) {
        const at = body.indexOf(later);
        if (at >= 0) assert.ok(at > lockAt, `${name}: ${later} comes after the Organization lock`);
      }
    }
  });

  it("migrations 0001-0015 are byte-identical to their closed hashes; 0019 is additive", () => {
    const migrationsDir = path.join(ROOT, "database/migrations");
    const present = new Set(readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")));
    assert.ok(present.has(MIGRATION));
    for (const [file, hash] of Object.entries(CLOSED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(migrationsDir, file))).digest("hex"), hash, `${file} is CLOSED and must not change`);
    }
    const sql = migrationSql();
    assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|TRIGGER|FUNCTION|INDEX|SCHEMA)\b/i);
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\s+public\.\w+\s+(ADD|DROP|ALTER|RENAME)/i, "no existing table is altered");
    assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE\s+FROM|TRUNCATE)\s/im, "the migration changes schema and seeds only");
    assert.deepEqual(
      [...sql.matchAll(/CREATE\s+TABLE\s+public\.(\w+)/gi)].map((match) => match[1]),
      ["company_profile_rules", "company_operating_scope_periods", "company_rule_applicability_periods", "company_driver_requirement_periods"],
    );
  });

  it("migration 0019 adds exactly two SYSTEM capabilities, grants nothing, and stays out of scope", () => {
    const text = migrationText();
    const sql = migrationSql();
    const inserted = [...sql.matchAll(/INSERT INTO public\.capabilities[\s\S]*?;/g)];
    assert.equal(inserted.length, 1);
    assert.deepEqual([...inserted[0][0].matchAll(/'([A-Z_]{5,})',\s*\n\s*'/g)].map((match) => match[1]), ["COMPANY_PROFILE_READ", "COMPANY_PROFILE_MANAGE"]);
    assert.equal((text.match(/Intended scope: SYSTEM only\./g) ?? []).length, 2);
    assert.doesNotMatch(sql, /relationship_capability_grants|relationship_assignments|actor_relationships/i, "nothing is granted to anyone");
    assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i);
    assert.doesNotMatch(sql, /ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY|FORCE\s+ROW/i);
    assert.doesNotMatch(sql, /set_config|current_customer_id/i);
    assert.doesNotMatch(sql, /GRANT\s+(ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/i, "no broad runtime privilege");
    assert.doesNotMatch(sql, /\bGRANT\s+UPDATE\s+ON\b|\bGRANT\s+INSERT\s+ON\b/i, "INSERT / UPDATE are column-specific");
    assert.doesNotMatch(sql, /\b(jsonb?|hstore)\b|setting_key|setting_value|preference|theme|layout|key_value/i, "no generic key/value storage, no preference columns");
    assert.doesNotMatch(sql, /\b(legal_name|trade_name|address|latitude|authority_number|registration_number|policy_number|credential_secret|secret_reference)\w*\s+(text|uuid|numeric)\b/i, "no mirrored Organization / Location / Authority / Registration / Insurance / Credential fields");
    assert.equal((sql.match(/INSERT INTO public\.company_profile_rules/g) ?? []).length, 1);
    assert.equal([...sql.matchAll(/^\s+\('([A-Z0-9_]+)', '(CARGO|OPERATIONS|TAX|DRIVERS|PROGRAMS)'/gm)].length, 45);
  });

  it("the migration has no line the migration runner rejects (transaction control, psql meta-commands)", () => {
    for (const line of migrationText().split("\n")) {
      assert.doesNotMatch(line, /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i, line);
      assert.doesNotMatch(line, /^\s*\\/, line);
    }
  });
});
