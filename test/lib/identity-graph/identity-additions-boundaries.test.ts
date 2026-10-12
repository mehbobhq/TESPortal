// Static boundary checks for the Core Operational Identity additions: migration 0025 (insurance scheduled vehicles),
// migration 0026 (vehicle merge ledger) and migration 0027 (organization access policies, policy-only), and the shared
// production verifier that covers them. No database needed.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const MIGRATIONS_DIR = path.join(ROOT, "database/migrations");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), "utf8");

// SHA-256 of every migration on origin/main (0001-0024, production-applied). An applied migration must never change.
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
  "0016_tax_registration_foundation.sql": "cf107674e5032d047b75b986a7cf0692105ef5edc5076733e8dd64d35a792bc0",
  "0017_insurance_foundation.sql": "222f674864a4f6b0bc3e08295d38965dbc8f0b5341538bef5c6ed9a33590bb44",
  "0018_company_credentials_foundation.sql": "024b250894c3ab66f870a7942234fda4031841de0bb47eaef94d4b415b638225",
  "0019_company_operating_profile_foundation.sql": "7114d125f301c6f0cd9c78d5af6628b8d897f04bfeb50aa117ed338bbfa4282c",
  "0020_vehicle_identity_foundation.sql": "3939b955323b8bff10810337ff013a1412a6157000e8c982544c1b242af083d4",
  "0021_driver_person_identity_foundation.sql": "9d820f18876b7c06f655ec38f1b7613bf3e6d51467625dd12fbdb557269cc69b",
  "0022_entity_resolution_foundation.sql": "7c96989ba8c50b7ca8477ec7bf03f5d76c2e98fe2fa8439bc1a1f8af07643697",
  "0023_operational_identity_integrity_hardening.sql": "4a0c0f2947711dd2429dbf30b74d75e33846b940d5c264da04ca803fe811a1e1",
  "0024_system_wide_authorization_rls_closure.sql": "ed55a575a609a10e5caa498cd3447c9c5d6aa09190c2ac988483a37adc9eb01a",
};

const ADDED = {
  "0025_insurance_scheduled_vehicles_foundation.sql": { table: "insurance_coverage_vehicles", definer: ["guard_insurance_schedule_vehicle"] },
  "0026_vehicle_merge_ledger.sql": { table: "vehicle_merges", definer: [] as string[] },
} as const;
const POLICY_ONLY = "0027_operational_identity_organization_access_policies.sql";
const ALTERED_POLICIES = [
  "ALTER POLICY organizations_system ON public.organizations",
  "ALTER POLICY organization_person_relationships_system ON public.organization_person_relationships",
];

describe("Identity graph additions: migrations", () => {
  it("migrations 0001-0024 are byte-for-byte identical to origin/main and 0025 / 0026 / 0027 follow contiguously", () => {
    const present = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    for (const [name, expected] of Object.entries(CLOSED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(MIGRATIONS_DIR, name))).digest("hex"), expected, name);
    }
    assert.deepEqual(present, [...Object.keys(CLOSED_MIGRATIONS), ...Object.keys(ADDED), POLICY_ONLY]);
  });

  for (const [name, spec] of Object.entries(ADDED)) {
    const sql = codeOnly(readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));

    describe(name, () => {
      it("is additive: no DROP / UPDATE / DELETE / TRUNCATE, no DELETE / TRUNCATE / ALL grant, no tenant-context write", () => {
        assert.doesNotMatch(sql, /^\s*(DROP|UPDATE|DELETE|TRUNCATE)\s/im, "destructive or data-changing statement");
        assert.doesNotMatch(sql, /^\s*INSERT\s/im, "no seed or capability rows are added");
        assert.doesNotMatch(sql, /GRANT[^;]*\b(DELETE|TRUNCATE|ALL)\b/i, "grant");
        assert.doesNotMatch(sql, /set_config|tes_set_tenant|master_account/i);
        assert.doesNotMatch(sql, /relationship_capability_grants|relationship_assignments|actor_relationships/i, "nothing is granted to anyone");
        assert.doesNotMatch(sql, /FORCE\s+ROW\s+LEVEL|DISABLE\s+ROW\s+LEVEL|NO\s+FORCE/i);
        assert.doesNotMatch(sql, /DROP\s+POLICY|ALTER\s+POLICY/i);
      });

      it("the only ALTER is ENABLE ROW LEVEL SECURITY on its own table, and policies are on its own table", () => {
        const alters = [...sql.matchAll(/^\s*ALTER\s.*$/gim)].map((m) => m[0].trim());
        assert.deepEqual(alters, [`ALTER TABLE public.${spec.table} ENABLE ROW LEVEL SECURITY;`]);
        const policies = [...sql.matchAll(/^\s*CREATE\s+POLICY\s+(\S+)\s+ON\s+(\S+)/gim)];
        assert.ok(policies.length >= 1, "at least one policy");
        for (const policy of policies) assert.equal(policy[2], `public.${spec.table}`, policy[1]);
        const creates = [...sql.matchAll(/^CREATE\s+TABLE\s+(\S+)/gim)].map((m) => m[1]);
        assert.deepEqual(creates, [`public.${spec.table}`]);
      });

      it("the context helpers appear only inside policies (current_customer_id / *_context_authorized)", () => {
        const withoutPolicies = sql.replace(/^CREATE POLICY[^\n]*$/gm, "");
        assert.doesNotMatch(withoutPolicies, /current_customer_id|system_context_authorized|customer_context_authorized/);
      });

      it("SECURITY DEFINER only in the allowed function(s), and every function pins its search_path", () => {
        const found: string[] = [];
        for (const block of sql.split(/^(?=CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s)/im)) {
          const header = block.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+tes_security\.([a-z_0-9]+)/i);
          if (header && /SECURITY\s+DEFINER/i.test(block.split(/\$\$/)[0])) found.push(header[1]);
        }
        assert.deepEqual(found, [...spec.definer]);
        assert.equal((sql.match(/SECURITY\s+DEFINER/gi) ?? []).length, spec.definer.length);
        for (const block of sql.split(/^(?=CREATE\s+FUNCTION\s)/im).slice(1)) {
          assert.match(block, /SET search_path = pg_catalog/, block.split("\n")[0]);
        }
      });

      it("no line is rejected by the migration runner (transaction control, psql meta-commands)", () => {
        const raw = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
        for (const line of raw.split("\n")) {
          assert.doesNotMatch(line, /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i, line);
          assert.doesNotMatch(line, /^\s*\\/, line);
        }
      });
    });
  }

  describe(POLICY_ONLY, () => {
    const raw = readFileSync(path.join(MIGRATIONS_DIR, POLICY_ONLY), "utf8");
    const sql = codeOnly(raw);
    // the statements with quoted literals (capability codes such as ORGANIZATION_CREATE) removed
    const unquoted = sql.replace(/'[^']*'/g, "''");

    it("is policy-only: no CREATE / DROP / INSERT / UPDATE / DELETE / GRANT / TRUNCATE and no other ALTER", () => {
      assert.doesNotMatch(unquoted, /\b(CREATE|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\b/i);
      assert.doesNotMatch(sql, /set_config|tes_set_tenant|master_account/i);
      assert.doesNotMatch(sql, /relationship_capability_grants|relationship_assignments|actor_relationships/i, "nothing is granted to anyone");
      assert.doesNotMatch(sql, /ROW\s+LEVEL|FORCE|DISABLE|ENABLE/i);
      const statements = sql.split(";").map((statement) => statement.replace(/\s+/g, " ").trim()).filter(Boolean);
      assert.equal(statements.length, 2);
    });

    it("alters exactly organizations_system and organization_person_relationships_system, USING only", () => {
      const alters = [...sql.matchAll(/^\s*ALTER\s.*$/gim)].map((m) => m[0].trim());
      assert.deepEqual(alters, ALTERED_POLICIES);
      const statements = sql.split(";").map((statement) => statement.replace(/\s+/g, " ").trim()).filter(Boolean);
      for (const [index, statement] of statements.entries()) {
        assert.match(statement, new RegExp(`^${ALTERED_POLICIES[index].replace(/\./g, "\\.")} USING \\(tes_security\\.system_context_authorized\\(ARRAY\\[('[A-Z_]+')(,'[A-Z_]+')*\\]\\)\\)$`));
      }
      assert.doesNotMatch(sql, /WITH\s+CHECK/i, "WITH CHECK is not changed");
    });

    it("has no SECURITY DEFINER and no function, and the context helper appears only inside the two USING expressions", () => {
      assert.doesNotMatch(sql, /SECURITY\s+DEFINER|FUNCTION|TRIGGER/i);
      assert.equal((sql.match(/system_context_authorized/g) ?? []).length, 2);
      assert.doesNotMatch(sql, /customer_context_authorized|current_customer_id/);
    });

    it("no line is rejected by the migration runner (transaction control, psql meta-commands)", () => {
      for (const line of raw.split("\n")) {
        assert.doesNotMatch(line, /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i, line);
        assert.doesNotMatch(line, /^\s*\\/, line);
      }
    });
  });
});

describe("Identity graph additions: shared production verification", () => {
  const fragmentsDir = path.join(ROOT, "scripts/database/verification/companies");

  it("the fragments directory holds exactly 0016-0019, 0025-0027, the baseline and the generator (no 0020-0024 fragment)", () => {
    assert.deepEqual(readdirSync(fragmentsDir).sort(), ["0016.sql", "0017.sql", "0018.sql", "0019.sql", "0025.sql", "0026.sql", "0027.sql", "baseline.sql", "generate-expectations.py"]);
  });

  it("the script allows exactly 0016-0019 and 0025-0027, defaults to 0025..0027, and maps the new migrations", () => {
    const script = read("scripts/database/verify-production-companies-foundation.sh");
    assert.match(script, /0016\|0017\|0018\|0019\|0025\|0026\|0027\) ;;/);
    assert.doesNotMatch(script, /\b002[0-4]\|/);
    assert.match(script, /TES_VERIFY_FROM:-0025/);
    assert.match(script, /TES_VERIFY_THROUGH:-0027/);
    assert.match(script, /for version in 0016 0017 0018 0019 0025 0026 0027; do/);
    assert.match(script, /\[0025\]="0025_insurance_scheduled_vehicles_foundation\.sql"/);
    assert.match(script, /\[0026\]="0026_vehicle_merge_ledger\.sql"/);
    assert.match(script, /\[0027\]="0027_operational_identity_organization_access_policies\.sql"/);
    assert.match(script, /if \[\[ "\$version" == "0027" \]\]; then/);
    assert.match(script, /ALTER POLICY organizations_system ON public\\\.organizations USING/);
    assert.match(script, /ALTER POLICY organization_person_relationships_system ON public\\\.organization_person_relationships USING/);
    assert.match(script, /\[0025\]="guard_insurance_schedule_vehicle"/);
    assert.match(script, /BEGIN READ ONLY;/);
    assert.match(script, /\nROLLBACK;/);
  });

  it("the workflow offers exactly 0016-0019 and 0025-0027, defaults 0025 -> 0027, and stays manual and read-only", () => {
    const workflow = read(".github/workflows/production-companies-foundation-verification.yml");
    for (const input of ["from_migration", "through_migration"]) {
      const block = workflow.match(new RegExp(`${input}:[\\s\\S]*?options:\\n((?:\\s+- "[0-9]{4}"\\n)+)`));
      assert.ok(block, input);
      assert.deepEqual([...block[1].matchAll(/"(\d{4})"/g)].map((m) => m[1]), ["0016", "0017", "0018", "0019", "0025", "0026", "0027"], input);
    }
    assert.match(workflow, /from_migration:[\s\S]*?default: "0025"/);
    assert.match(workflow, /through_migration:[\s\S]*?default: "0027"/);
    assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
    assert.doesNotMatch(workflow, /migrate\.sh|psql[^\n]*-c/);
  });

  it("the new fragments write nothing and verify RLS flags, policies and the SECURITY DEFINER function exactly", () => {
    for (const version of ["0025", "0026", "0027"]) {
      const raw = read("scripts/database/verification/companies", `${version}.sql`);
      const sql = raw.replace(/\$exp\$[\s\S]*?\$exp\$/g, "");
      assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/im, version);
      assert.match(raw, /row-level security policies/, version);
      assert.match(raw, /RLS flags/, version);
      assert.doesNotMatch(raw, /\bIN \(\)/, version);
    }
    assert.match(read("scripts/database/verification/companies/0025.sql"), /guard_insurance_schedule_vehicle secdef=true/);
  });

  it("the 0027 fragment is table-less: pre = exact 0024 policy sets, post = exact post-0027 policy sets of both tables", () => {
    const raw = read("scripts/database/verification/companies/0027.sql");
    assert.match(raw, /current_setting\('tes\.verify_phase'\) <> 'pre'/);
    assert.match(raw, /current_setting\('tes\.verify_phase'\) <> 'post'/);
    assert.match(raw, /pre-0027 \(0024\) row-level security policies of organizations, organization_person_relationships/);
    assert.match(raw, /the complete policy set/);
    assert.match(raw, /organizations_system cmd=\* permissive=true roles=PUBLIC using=tes_security\.system_context_authorized\(ARRAY\[[^\]]*'IDENTITY_RESOLUTION_MANAGE'::text\]\) check=/);
    assert.match(raw, /organization_person_relationships_system cmd=\* permissive=true roles=PUBLIC using=tes_security\.system_context_authorized\(ARRAY\['PERSON_REGISTRY_READ'::text, 'CONTACT_MANAGE'::text, 'INSURANCE_MANAGE'::text\]\) check=tes_security\.system_context_authorized\(ARRAY\['CONTACT_MANAGE'::text\]\)/);
    assert.match(raw, /RLS flags and owners/);
    assert.doesNotMatch(raw, /columns \(name, data type|0027 (constraints|indexes|triggers|functions|table ACL|column ACL)|seed rows/);
    assert.doesNotMatch(raw, /\bIN \(\)/);
  });
});
