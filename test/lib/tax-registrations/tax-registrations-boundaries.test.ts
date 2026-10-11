// Static boundary checks for the Tax Registrations slice (no database needed).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DIR = path.join(ROOT, "lib/tax-registrations");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));
const source = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIGRATION = "0016_tax_registration_foundation.sql";
const migrationText = () => readFileSync(path.join(ROOT, "database/migrations", MIGRATION), "utf8");
const migrationSql = () => codeOnly(migrationText().replace(/^\s*--.*$/gm, ""));

// SHA-256 of the applied (CLOSED) migrations when migration 0016 was added. An applied migration must never change.
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

describe("Tax Registrations boundaries", () => {
  it("the domain has exactly the expected modules", () => {
    assert.deepEqual([...files].sort(), ["definitions.ts", "errors.ts", "legacy.ts", "operations.ts", "repository.ts", "service.ts", "types.ts"]);
  });

  it("the service is the server-only entry point; domain modules stay testable", () => {
    assert.match(source("service.ts"), /^import "server-only"/);
    for (const file of files.filter((name) => name !== "service.ts")) assert.doesNotMatch(source(file), /import "server-only"/, file);
  });

  it("only the service reaches the authorization wrappers or the connection pool", () => {
    for (const file of files.filter((name) => name !== "service.ts")) {
      assert.doesNotMatch(codeOnly(source(file)), /withAuthorized|hasAdditionalSystemCapability|getPostgresPool|withPostgresTransaction|tes-authorization|tes-system-context/, file);
    }
  });

  it("the service is SYSTEM-only and uses exactly the two registration capabilities, each where designed", () => {
    const service = codeOnly(source("service.ts"));
    assert.doesNotMatch(service, /withAuthorizedCustomer|tes-customer-context/, "no CUSTOMER-facing path");
    const caps = new Set([...service.matchAll(/"([A-Z]+_[A-Z_]+)"/g)].map((match) => match[1]).filter((code) => /^(ORGANIZATION|CUSTOMER|PERSON|CONTACT|TAX)_/.test(code)));
    assert.deepEqual([...caps].sort(), ["TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ"]);
    assert.equal((service.match(/withAuthorizedSystem\("TAX_REGISTRATION_READ"/g) ?? []).length, 2, "checkRegistrationNumber and getOrganizationRegistrations");
    assert.equal((service.match(/withAuthorizedSystem\("TAX_REGISTRATION_MANAGE"/g) ?? []).length, 1, "every mutation goes through the one manage() helper");
    assert.equal((service.match(/hasAdditionalSystemCapability\(client, decision, "TAX_REGISTRATION_READ"\)/g) ?? []).length, 1, "the lazy secondary check for collision disclosure");
    assert.equal((service.match(/manage\(\(ctx\)/g) ?? []).length, 7, "seven mutations");
    assert.deepEqual(
      [...service.matchAll(/^export (?:const|async function) (\w+)/gm)].map((match) => match[1]).sort(),
      ["archiveRegistration", "changeRegistrationStatus", "changeRegistrationVersion", "checkRegistrationNumber", "correctRegistrationStatus", "correctRegistrationVersion", "createRegistration", "getOrganizationRegistrations", "restoreRegistration"],
    );
  });

  it("the capability names the service uses exist in the capability registry as SYSTEM-only", () => {
    const registry = readFileSync(path.join(ROOT, "lib/auth/tes-capabilities.ts"), "utf8");
    assert.match(registry, /TAX_REGISTRATION_READ:\s*"SYSTEM"/);
    assert.match(registry, /TAX_REGISTRATION_MANAGE:\s*"SYSTEM"/);
  });

  it("no DELETE/TRUNCATE SQL; no filing, return, payment, decal, credential or required-flag concept in the slice", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /\b(filings?|payments?|decals?|credentials?|passwords?|portal|invoices?|taxReturns?|fileRegistration|submitRegistration)\b|is_required|required_flag|"EXPIRED"|"REVOKED"|"CANCELED"/i, `${file}: out of scope for 0016`);
    }
  });

  it("no browser storage, no Google Cloud, no cross-domain imports", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /localStorage|sessionStorage|@google-cloud|storage\.googleapis/i, file);
      assert.doesNotMatch(code, /from "@\/lib\/(contacts|customer-relationship|insurance|company-credentials|company-profile|operating-authorities)\//, `${file}: no sibling-domain imports`);
    }
  });

  it("the Master Register is only written through the shared recorder with existing event types, never with numbers, dates or free text", () => {
    const operations = codeOnly(source("operations.ts"));
    assert.match(operations, /recordEvent\(/);
    const types = new Set([...operations.matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.deepEqual([...types].sort(), ["RECORD_ARCHIVED", "RECORD_CORRECTED", "RECORD_CREATED", "RECORD_RESTORED", "RECORD_STATUS_CHANGED", "RECORD_UPDATED"]);
    const registered = readFileSync(path.join(ROOT, "lib/master-register/event-types.ts"), "utf8");
    for (const type of types) assert.ok(registered.includes(`${type}:`), `${type} must be an existing event type`);
    // literals carry only program / status / record-status vocabulary
    const literals = [...operations.matchAll(/literal\(([^)]*)\)/g)].map((match) => match[1].trim());
    assert.deepEqual([...new Set(literals)].sort(), ['"active"', '"archived"', "current.registrationStatus", "from", "program", "status", "target"].sort());
    assert.doesNotMatch(operations, /literal\((at|number|values|jurisdiction|issuedOn|expiresOn|effectiveFrom|input)/, "no business time, number or jurisdiction reaches the register");
    assert.doesNotMatch(operations, /subjectReferences:\s*\[[^\]]*(number|name)/i);
  });

  it("every Master Register event type the slice uses is registered", async () => {
    await import("../../helpers/register-alias-loader.mjs");
    const { isRegisteredEventType } = await import("@/lib/master-register/event-types");
    const used = new Set([...source("operations.ts").matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.ok(used.size >= 6);
    for (const eventType of used) assert.equal(isRegisteredEventType(eventType), true, eventType);
  });

  it("migrations 0001-0015 are byte-identical to their closed hashes; 0016 exists and is additive", () => {
    const dir = path.join(ROOT, "database/migrations");
    const present = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    assert.deepEqual(present.slice(0, 16), [...Object.keys(CLOSED_MIGRATIONS), MIGRATION]);
    for (const [file, hash] of Object.entries(CLOSED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(dir, file))).digest("hex"), hash, `${file} is CLOSED and must not change`);
    }
    const sql = migrationSql();
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, "no existing table is altered");
    assert.doesNotMatch(sql, /\bDROP\b/i);
    assert.doesNotMatch(sql, /GRANT[^;]*\b(DELETE|TRUNCATE|ALL)\b/i);
    assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE\s+FROM|TRUNCATE)\s/im, "the migration changes schema and seeds only");
    assert.doesNotMatch(sql, /REFERENCES\s+public\.(?!organizations\b|registration_programs\b|registrations\b|registration_versions\b|registration_status_periods\b)\w+/i, "references only the canonical organizations table and its own tables");
  });

  it("migration 0016 adds exactly two SYSTEM capabilities, no SECURITY DEFINER, no RLS, no tenant context, no grants of capabilities", () => {
    const sql = migrationSql();
    const inserted = [...sql.matchAll(/INSERT INTO public\.capabilities[\s\S]*?;/g)];
    assert.equal(inserted.length, 1);
    assert.deepEqual([...inserted[0][0].matchAll(/'([A-Z_]{5,})',\s*\n\s*'/g)].map((match) => match[1]), ["TAX_REGISTRATION_READ", "TAX_REGISTRATION_MANAGE"]);
    assert.doesNotMatch(sql, /relationship_capability_grants|relationship_assignments|actor_relationships/i, "nothing is granted");
    assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i);
    assert.doesNotMatch(sql, /ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY|FORCE\s+ROW/i);
    assert.doesNotMatch(sql, /set_config|current_customer_id|master_account|tes_set_tenant/i);
  });

  it("the migration seeds exactly the twelve programs and none of the authority kinds, Form 2290 or customs memberships", () => {
    const sql = migrationSql();
    const seed = sql.match(/INSERT INTO public\.registration_programs[\s\S]*?;\n/)?.[0] ?? "";
    const codes = [...seed.matchAll(/\(\s*'([A-Z_]+)',\s*'/g)].map((match) => match[1]);
    assert.deepEqual(codes, ["IFTA", "CT_HUF", "NY_HUT", "KYU", "NM_WDT", "OR_WMT", "FUEL_CHARGE", "TX_EXCISE", "AR_MFT", "ON_TOBACCO", "SCAC", "CA_CARRIER_CODE"]);
    for (const forbidden of ["IRP", "USDOT", "MC", "MVID", "RIN", "CVOR", "SAFETY_FITNESS", "FORM_2290", "CTPAT", "CUSTOMS"]) assert.ok(!codes.includes(forbidden), forbidden);
    assert.doesNotMatch(sql, /CREATE TABLE public\.(?!registration_programs\b|registrations\b|registration_versions\b|registration_status_periods\b)/i, "four tables only");
    assert.doesNotMatch(sql, /\b(filing|return|payment|decal|credential|password|secret|vehicle|unit)\w*\s+(text|numeric|integer|uuid|boolean|date|timestamptz|bytea)\b/i, "no filing, payment, decal, credential or vehicle columns");
  });

  it("the migration has no line the migration runner rejects (transaction control, psql meta-commands)", () => {
    for (const line of migrationText().split("\n")) {
      assert.doesNotMatch(line, /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i, line);
      assert.doesNotMatch(line, /^\s*\\/, line);
    }
  });
});
