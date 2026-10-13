// Static boundary checks for the Contracts foundation (no database needed). The database behaviour of the same rules is
// proven in contracts.db.test.ts; these tests pin the structure so a refactor cannot quietly remove a guard.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");
const MIGRATION = "database/migrations/0031_contracts_foundation.sql";
const sql = () => codeOnly(read(MIGRATION));

const CONTRACT_SOURCES = ["lib/contracts/definitions.ts", "lib/contracts/errors.ts", "lib/contracts/operations.ts", "lib/contracts/service.ts", "lib/contracts/types.ts"];
const NEW_TABLES = [
  "contract_package_definitions",
  "contract_evidence_rules",
  "customer_contract_line_pricing",
  "customer_contract_responsibility_matrix",
  "customer_contract_evidence_requirements",
  "customer_contract_status_events",
  "customer_authority_change_events",
];

// SHA-256 of the CLOSED migrations 0001-0030. An applied migration must never change; 0031 is purely additive.
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
  "0025_insurance_scheduled_vehicles_foundation.sql": "4329c9ec5cdeb442eb694c7f7b84e84b8062f3d42cb49c69f74441b9b52356a6",
  "0026_vehicle_merge_ledger.sql": "6e2758517a708b619ebb87977b7eb45783de65740b422e168f65ffa706435863",
  "0027_operational_identity_organization_access_policies.sql": "3ac1661e820f68615df0f44ebc80bc8f5e885acb5043d99522e8e63b56cb0f5a",
  "0028_system_rls_policy_closure.sql": "bf75862261136b0de64765d7d425f6f68f9b8e932c7625980ec0164abb1f6ea2",
  "0029_canonical_data_cutover_import_infrastructure.sql": "94aff3433bdfd9254f4852941577bca3a14442e5035d39b480dc2bd336613615",
  "0030_onboarding_evidence_contracts_foundation.sql": "af5c7b07538e21d8e636f4c6cca0937792a0abf290e2e7ee67485fc178494c15",
};

describe("migration 0031 is additive", () => {
  it("is the next migration number and leaves every closed migration byte-identical", () => {
    const files = readdirSync(path.join(ROOT, "database/migrations")).filter((file) => /^\d{4}_.*\.sql$/.test(file)).sort();
    assert.equal(files[30], "0031_contracts_foundation.sql");
    for (const [file, expected] of Object.entries(CLOSED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(ROOT, "database/migrations", file))).digest("hex"), expected, `${file} must not change`);
    }
  });

  it("creates, never alters or removes, existing objects", () => {
    const text = sql();
    assert.doesNotMatch(text, /\bDROP\s+\w+/i);
    assert.doesNotMatch(text, /\bTRUNCATE\s+(TABLE\s+)?(ONLY\s+)?public\./i, "only BEFORE TRUNCATE guard triggers are allowed");
    assert.doesNotMatch(text, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(text, /\bALTER\s+TABLE\s+public\.(evidence_documents|evidence_links|onboarding_evidence_requirements|onboarding_readiness_snapshots|customer_authority_assignments|customer_contracts|customer_contract_line_items)\b/i);
    assert.doesNotMatch(text, /\bALTER\s+(COLUMN|POLICY|TYPE)\b|\bRENAME\b|\bDROP\s+(COLUMN|CONSTRAINT|POLICY)\b/i);
    // the only ALTER TABLE statements enable row level security on the NEW tables
    const alters = text.match(/ALTER TABLE [^;]+;/gi) ?? [];
    assert.equal(alters.length, NEW_TABLES.length);
    for (const statement of alters) {
      assert.match(statement, /ENABLE ROW LEVEL SECURITY/);
      assert.ok(NEW_TABLES.some((table) => statement.includes(`public.${table} `)), statement);
    }
    // the only writes to existing data would be INSERTs into the new catalogue table
    const inserts = [...text.matchAll(/INSERT\s+INTO\s+(public\.\w+)/gi)].map((match) => match[1]);
    assert.deepEqual([...new Set(inserts)], ["public.contract_evidence_rules"]);
    assert.doesNotMatch(text, /\bUPDATE\s+public\./i);
  });

  it("adds no capabilities: CONTRACT_READ / CONTRACT_MANAGE from 0030 are reused", () => {
    assert.doesNotMatch(sql(), /public\.capabilities/);
    const policies = [...sql().matchAll(/system_context_authorized\(ARRAY\[([^\]]+)\]\)/g)].map((match) => match[1]);
    for (const list of policies) assert.match(list, /^('CONTRACT_(READ|MANAGE)'(,)?)+$/);
  });

  it("creates every new table with row level security, policies, no-delete and no-truncate guards", () => {
    const text = sql();
    for (const table of NEW_TABLES) {
      assert.match(text, new RegExp(`CREATE TABLE public\\.${table}\\b`), table);
      assert.match(text, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), table);
      assert.match(text, new RegExp(`CREATE POLICY ${table}_system_read ON public\\.${table} FOR SELECT`), table);
      assert.match(text, new RegExp(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON public\\.${table}`), table);
      assert.match(text, new RegExp(`CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON public\\.${table}`), table);
    }
    assert.doesNotMatch(text, /GRANT[^;]*\b(DELETE|TRUNCATE|ALL)\b/i);
    // ledgers and the rule catalogue accept no UPDATE
    assert.match(text, /GRANT SELECT, INSERT ON\s+public\.customer_contract_status_events,\s+public\.customer_authority_change_events/);
    assert.doesNotMatch(text, /CREATE POLICY (customer_contract_status_events|customer_authority_change_events|contract_evidence_rules)_system_update/);
  });

  it("allows SECURITY DEFINER only for narrow predicates that return a boolean or date, never rows", () => {
    const text = sql();
    const definers = [...text.matchAll(/CREATE FUNCTION (tes_security\.\w+)\([^)]*\)\s+RETURNS (\w+)\s+LANGUAGE sql STABLE SECURITY DEFINER\s+SET search_path = pg_catalog, public/g)];
    assert.equal(definers.length, (text.match(/SECURITY DEFINER/g) ?? []).length, "every SECURITY DEFINER function pins search_path and is plain SQL");
    for (const [, name, returns] of definers) {
      assert.match(returns, /^(boolean|date)$/, name);
      assert.match(text, new RegExp(`REVOKE ALL ON FUNCTION ${name.replace(".", "\\.")}\\(`), `${name} is not executable by PUBLIC`);
    }
  });
});

describe("evidence is metadata only; payloads stay in GCS", () => {
  it("stores no document payload in PostgreSQL", () => {
    const text = sql();
    assert.doesNotMatch(text, /\b(bytea|payload|file_contents|base64|lo_import|large object)\b/i);
    // evidence is only ever referenced by evidence_documents(id); no storage location is copied into contract tables
    assert.doesNotMatch(text, /gcs_bucket|gcs_object_name|sha256|byte_size/i);
    for (const file of CONTRACT_SOURCES) {
      assert.doesNotMatch(codeOnly(read(file)), /gcs_bucket|gcs_object_name|createReadStream|signedUrl|downloadUrl|storage\.googleapis|makePublic|Buffer\.from\(.*(file|document)/i, file);
    }
  });
});

describe("no browser storage anywhere in the contracts and onboarding path", () => {
  it("never touches localStorage, sessionStorage, IndexedDB or cookies", () => {
    const files = [
      ...CONTRACT_SOURCES,
      "app/api/companies/[id]/contracts/route.ts",
      "app/companies/[id]/onboarding/page.tsx",
      "app/companies/[id]/onboarding/contracts-panel.tsx",
      "lib/customer-onboarding/service.ts",
      "lib/onboarding-foundation/service.ts",
    ];
    for (const file of files) {
      assert.ok(existsSync(path.join(ROOT, file)), file);
      assert.doesNotMatch(codeOnly(read(file)), /localStorage|sessionStorage|indexedDB|document\.cookie|evidence-payload-store|evidence-file-store/i, file);
    }
    assert.doesNotMatch(sql(), /localStorage|sessionStorage|indexedDB/i);
  });
});

describe("no billing, invoicing or payment collection", () => {
  it("carries pricing metadata only", () => {
    assert.doesNotMatch(sql(), /\b(invoice|invoices|payment|payments|card|bank|stripe|interac|amount_due|subtotal|tax_amount|total_amount|receipt|billing_)\b/i);
    for (const file of CONTRACT_SOURCES) {
      assert.doesNotMatch(codeOnly(read(file)), /\b(invoice|payment|stripe|interac|amount_due|subtotal|receipt)\b/i, file);
    }
  });

  it("pricing rows cannot be left to be defined and fees have a defined shape", () => {
    const text = sql();
    assert.match(text, /customer_contract_line_pricing_basis_valid\s+CHECK \(pricing_basis IN \('monthly_package', 'one_time_service', 'included_in_package'\)\)/);
    assert.doesNotMatch(text.slice(text.indexOf("CREATE TABLE public.customer_contract_line_pricing"), text.indexOf("CREATE TABLE public.customer_contract_responsibility_matrix")), /to_be_defined/);
    assert.match(text, /customer_contract_line_pricing_shape_valid/);
  });
});

describe("authority and signatory rules cannot be bypassed", () => {
  it("relies on the 0030 one-active-holder index and adds notice, ledger and immutability guards", () => {
    assert.match(read("database/migrations/0030_onboarding_evidence_contracts_foundation.sql"), /customer_authority_assignments_one_active_uq[\s\S]{0,200}WHERE assignment_status = 'active' AND effective_to IS NULL/);
    const text = sql();
    for (const trigger of [
      "customer_authority_assignments_guard_insert",
      "customer_authority_assignments_guard_update",
      "customer_authority_assignments_change_recorded",
      "customer_authority_change_events_guard_insert",
    ]) assert.match(text, new RegExp(`CREATE (CONSTRAINT )?TRIGGER ${trigger}\\b`), trigger);
    assert.match(text, /CREATE CONSTRAINT TRIGGER customer_authority_assignments_change_recorded\s+AFTER INSERT OR UPDATE[\s\S]{0,80}DEFERRABLE INITIALLY DEFERRED/);
    assert.match(text, /contract_evidence_document_acceptable\(NEW\.notice_evidence_document_id, NEW\.organization_id, 'CUSTOMER_AUTHORITY_NOTICE'\)/);
    assert.match(text, /A superseded or voided authority assignment is preserved history/);
    assert.match(text, /notice_evidence_document_id uuid NOT NULL[\s\S]{0,200}master_register_event_id uuid NOT NULL/);
  });

  it("only the Contracts operations write authority assignments", () => {
    const writers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(ROOT, dir))) {
        const relative = `${dir}/${entry}`;
        if (statSync(path.join(ROOT, relative)).isDirectory()) walk(relative);
        else if (/\.(ts|tsx)$/.test(entry) && /(INSERT\s+INTO|UPDATE)\s+public\.customer_authority_assignments/i.test(read(relative))) writers.push(relative);
      }
    };
    for (const dir of ["lib", "app", "components", "src", "services"]) if (existsSync(path.join(ROOT, dir))) walk(dir);
    assert.deepEqual(writers, ["lib/contracts/operations.ts"]);
    const onboarding = codeOnly(read("lib/onboarding-foundation/service.ts"));
    assert.doesNotMatch(onboarding, /export async function (assignCustomerAuthority|createContractFoundation)/);
    assert.match(codeOnly(read("lib/customer-onboarding/service.ts")), /applyContractsAction\(organizationId, \{ \.\.\.input, action: "assignAuthority" \}\)/);
  });

  it("scope, responsibility and pricing decisions are tied to the contract's Service Decision Authority", () => {
    const text = sql();
    assert.match(text, /Contracted service scope can only be decided by the contract''s active Service Decision Authority/);
    assert.match(text, /assignment\.authority_type <> 'SERVICE_DECISION_AUTHORITY'/);
    assert.match(text, /contract\.service_decision_authority_assignment_id IS DISTINCT FROM assignment\.id/);
    assert.match(codeOnly(read("lib/contracts/operations.ts")), /requireActiveDecisionAuthority\(ctx\.client, contract\)/);
  });
});

describe("TES responsibility boundary", () => {
  it("starts only at an explicit effective date inside TES responsibility; history needs evidence", () => {
    const text = sql();
    assert.match(text, /effective_responsibility_date date NOT NULL/);
    assert.match(text, /The effective responsibility date cannot precede the date TES assumed responsibility for the scope/);
    assert.match(text, /history_treatment = 'tes_assumes_with_evidence'\s+AND history_evidence_document_id IS NOT NULL\s+AND history_assumed_from IS NOT NULL\s+AND history_assumed_from < effective_responsibility_date/);
    assert.match(text, /history_treatment IN \('excluded', 'customer_retains'\)\s+AND history_evidence_document_id IS NULL/);
    assert.match(text, /history_treatment text NOT NULL DEFAULT 'excluded'/);
  });
});

describe("readiness and status gates live in the database", () => {
  const text = () => sql();
  it("computes every required gate from one function the status trigger enforces", () => {
    const body = text();
    for (const gate of ["CUSTOMER_RELATIONSHIP", "SERVICE_SCOPE", "RESPONSIBILITY_MATRIX", "REQUIRED_SETTINGS", "PRICING_PACKAGE", "SERVICE_DECISION_AUTHORITY", "CONTRACT_SIGNATORY", "EVIDENCE_REQUIREMENTS", "MASTER_REGISTER_ACCOUNTABILITY", "CONTRACT_REFERENCE"]) {
      assert.match(body, new RegExp(`array_append\\(failures, '${gate}'\\)`), gate);
    }
    assert.match(body, /failures := tes_security\.contract_gate_failures\(NEW\.id, NEW\.contract_status\)/);
    assert.match(body, /CREATE TRIGGER customer_contracts_guard_update\s+BEFORE UPDATE ON public\.customer_contracts/);
  });

  it("refuses a status change without evidence and a Master Register record in the same transaction", () => {
    const body = text();
    assert.match(body, /master_register_event_id uuid NOT NULL\s+REFERENCES public\.master_register_events\(event_id\)[\s\S]{0,400}CREATE TABLE|master_register_event_id uuid NOT NULL\s+REFERENCES public\.master_register_events\(event_id\)/);
    assert.match(body, /CONSTRAINT customer_contract_status_events_evidence_required\s+CHECK \(from_status IS NULL OR evidence_document_id IS NOT NULL\)/);
    assert.match(body, /e\.recorded_txid = txid_current\(\)/);
    assert.match(body, /requires verified evidence and a Master Register accountability record in the same transaction/);
    assert.match(body, /CASE WHEN NEW\.to_status = 'signed' THEN 'SIGNED_CONTRACT_DOCUMENT' ELSE NULL END/);
  });

  it("the service advances status only through the ledger-then-update operation", () => {
    const ops = codeOnly(read("lib/contracts/operations.ts"));
    const statusWrites = ops.match(/UPDATE public\.customer_contracts SET contract_status/g) ?? [];
    assert.equal(statusWrites.length, 2, "advanceContractStatus and the authority realignment are the only status writers");
    for (const marker of ["INSERT INTO public.customer_contract_status_events"]) {
      assert.ok((ops.match(new RegExp(marker, "g")) ?? []).length >= 3, marker);
    }
    assert.match(ops, /readContractReadiness\(ctx\.client, contractId, from\)[\s\S]{0,200}if \(!readiness\.ready\) throw new ContractStateError/);
  });

  it("every mutating operation records a Master Register event before it writes", () => {
    const ops = codeOnly(read("lib/contracts/operations.ts"));
    for (const operation of [
      "define_package", "assign_customer_authority", "revoke_customer_authority", "create_contract_draft", "update_contract_draft",
      "attach_service_scope", "detach_service_scope", "define_responsibility_boundary", "assign_pricing_package", "link_contract_evidence",
      "view_contracts_workspace", "establish_contract_accountability_baseline",
    ]) assert.match(ops, new RegExp(operation), operation);
    assert.match(codeOnly(read("lib/contracts/service.ts")), /recordContractsViewed\(/);
    assert.doesNotMatch(ops, /DELETE\s+FROM|TRUNCATE|DROP\s+/i);
  });
});

describe("service and API layer", () => {
  it("uses the authorization wrappers with the 0030 capabilities and exposes no delete", () => {
    const service = codeOnly(read("lib/contracts/service.ts"));
    assert.match(service, /^import "server-only"/);
    assert.match(service, /withAuthorizedSystem\("CONTRACT_MANAGE"/);
    assert.match(service, /withAuthorizedSystem\("CONTRACT_READ"/);
    assert.doesNotMatch(service, /export (async )?function (delete|remove|truncate)/i);
    const route = codeOnly(read("app/api/companies/[id]/contracts/route.ts"));
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function PATCH/);
    assert.doesNotMatch(route, /export async function (DELETE|PUT|POST)/);
  });

  it("does not leak storage locations or secrets to the workspace view", () => {
    const service = codeOnly(read("lib/contracts/service.ts"));
    assert.doesNotMatch(service, /gcsBucket|gcsObjectName|sha256/);
  });
});
