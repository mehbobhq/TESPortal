// Static boundary checks for the Companies foundation completion program (migrations 0016-0019). No database needed.
// Domain-specific boundaries live next to each domain; this file holds what is shared: the closed history, migration
// additivity across the whole batch, and the single shared production verification script and workflow.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const MIGRATIONS_DIR = path.join(ROOT, "database/migrations");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

// SHA-256 of the closed (production-applied) migrations. An applied migration must never change.
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

const NEW_MIGRATIONS = [
  "0016_tax_registration_foundation.sql",
  "0017_insurance_foundation.sql",
  "0018_company_credentials_foundation.sql",
  "0019_company_operating_profile_foundation.sql",
] as const;

describe("Companies foundation completion: migrations", () => {
  it("applied migrations 0001-0015 are byte-for-byte unchanged and 0016-0019 follow them contiguously (no 0020)", () => {
    const present = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    for (const [name, expected] of Object.entries(CLOSED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(MIGRATIONS_DIR, name))).digest("hex"), expected, name);
    }
    assert.deepEqual(present, [...Object.keys(CLOSED_MIGRATIONS), ...NEW_MIGRATIONS]);
  });

  it("every new migration is additive: no DROP/ALTER/UPDATE/DELETE/TRUNCATE, no DELETE/TRUNCATE/ALL grant, no SECURITY DEFINER, no RLS, no tenant context, no capability grant", () => {
    for (const name of NEW_MIGRATIONS) {
      const sql = codeOnly(readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
      assert.doesNotMatch(sql, /^\s*(DROP|ALTER|UPDATE|DELETE|TRUNCATE)\s/im, `${name}: destructive or altering statement`);
      assert.doesNotMatch(sql, /GRANT[^;]*\b(DELETE|TRUNCATE|ALL)\b/i, name);
      assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i, name);
      assert.doesNotMatch(sql, /ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY|FORCE\s+ROW/i, name);
      assert.doesNotMatch(sql, /set_config|tes_set_tenant|current_customer_id|master_account/i, name);
      assert.doesNotMatch(sql, /relationship_capability_grants|relationship_assignments|actor_relationships/i, `${name}: capabilities exist but are granted to nobody`);
      for (const insert of sql.matchAll(/^INSERT INTO\s+(\S+)/gim)) {
        assert.match(insert[1], /^public\.(capabilities|registration_programs|insurance_coverage_types|credential_categories|company_profile_rules)$/, `${name}: ${insert[1]}`);
      }
    }
  });

  it("no migration line is rejected by the migration runner (transaction control, psql meta-commands)", () => {
    for (const name of NEW_MIGRATIONS) {
      for (const line of readFileSync(path.join(MIGRATIONS_DIR, name), "utf8").split("\n")) {
        assert.doesNotMatch(line, /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i, `${name}: ${line}`);
        assert.doesNotMatch(line, /^\s*\\/, `${name}: ${line}`);
      }
    }
  });

  it("the new capabilities are all SYSTEM-only catalogue rows and exactly eight are added", () => {
    const added: string[] = [];
    for (const name of NEW_MIGRATIONS) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
      const block = sql.slice(sql.indexOf("INSERT INTO public.capabilities"));
      if (!sql.includes("INSERT INTO public.capabilities")) continue;
      const rows = [...block.matchAll(/\(\s*\n\s+'([A-Z_]+)',\s*\n\s+'[^']+',\s*\n\s+'((?:[^']|'')+)',\s*\n\s+true,\s*\n\s+(\d+)\s*\n\s+\)/g)];
      for (const row of rows) {
        assert.match(row[2], /Intended scope: SYSTEM only\.$/, row[1]);
        added.push(row[1]);
      }
    }
    assert.deepEqual(added, [
      "TAX_REGISTRATION_READ", "TAX_REGISTRATION_MANAGE", "INSURANCE_READ", "INSURANCE_MANAGE",
      "CREDENTIAL_READ", "CREDENTIAL_MANAGE", "COMPANY_PROFILE_READ", "COMPANY_PROFILE_MANAGE",
    ]);
  });
});

describe("Companies foundation completion: one shared production verification", () => {
  const workflowPath = path.join(ROOT, ".github/workflows/production-companies-foundation-verification.yml");
  const scriptPath = path.join(ROOT, "scripts/database/verify-production-companies-foundation.sh");
  const fragmentsDir = path.join(ROOT, "scripts/database/verification/companies");

  it("the workflow is manual, main-gated, read-only and runs only the shared script", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
    assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
    assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /environment: production-database/);
    assert.match(workflow, /verify-production-companies-foundation\.sh/);
    assert.match(workflow, /TES_VERIFY_FROM: \$\{\{ inputs\.from_migration \}\}/);
    assert.match(workflow, /TES_VERIFY_THROUGH: \$\{\{ inputs\.through_migration \}\}/);
    assert.doesNotMatch(workflow, /migrate\.sh|psql[^\n]*-c/);
  });

  it("the script is read-only (BEGIN READ ONLY ... ROLLBACK), pre/post aware, parameterized by FROM/THROUGH", () => {
    const script = readFileSync(scriptPath, "utf8");
    assert.match(script, /BEGIN READ ONLY;/);
    assert.match(script, /\nROLLBACK;/);
    for (const variable of ["TES_VERIFY_PHASE", "TES_VERIFY_EXPECT_EMPTY", "TES_VERIFY_BASELINE_COUNTS", "TES_VERIFY_FROM", "TES_VERIFY_THROUGH"]) {
      assert.match(script, new RegExp(variable));
    }
  });

  it("each migration has its own expectation fragment, and no fragment writes anything", () => {
    const files = readdirSync(fragmentsDir).filter((name) => name.endsWith(".sql")).sort();
    assert.deepEqual(files, ["0016.sql", "0017.sql", "0018.sql", "0019.sql", "baseline.sql"]);
    for (const file of files) {
      const sql = readFileSync(path.join(fragmentsDir, file), "utf8").replace(/\$exp\$[\s\S]*?\$exp\$/g, "");
      assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/im, file);
    }
    assert.ok(existsSync(path.join(fragmentsDir, "generate-expectations.py")));
  });
});
