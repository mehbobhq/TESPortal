// Static boundary checks for the evidence payload lifecycle (no database needed). The behaviour of the same rules is proven in
// lifecycle.db.test.ts; these tests pin the structure so a refactor cannot quietly remove a guard.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");
const MIGRATION = "database/migrations/0032_evidence_payload_lifecycle.sql";
const sql = () => codeOnly(read(MIGRATION));
const NEW_TABLES = ["evidence_payloads", "evidence_payload_access_events"];

const LIB = readdirSync(path.join(ROOT, "lib/evidence-payload")).filter((file) => file.endsWith(".ts")).map((file) => `lib/evidence-payload/${file}`);
const ROUTES = ["app/api/companies/[id]/evidence/route.ts", "app/api/companies/[id]/evidence/[documentId]/route.ts", "app/api/document-intake/route.ts"];
const UI = ["app/companies/[id]/onboarding/evidence-panel.tsx"];

// SHA-256 of the CLOSED migrations 0001-0031. An applied migration must never change; 0032 is purely additive.
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
  "0031_contracts_foundation.sql": "860c4f0b5a6ad1b193d3cdf2f5f85821f45c542bf2d0fca55500071e0f9f1cc3",
};

describe("migration 0032 is additive", () => {
  it("is the next migration number and leaves every closed migration byte-identical", () => {
    const files = readdirSync(path.join(ROOT, "database/migrations")).filter((file) => /^\d{4}_.*\.sql$/.test(file)).sort();
    assert.equal(files[31], "0032_evidence_payload_lifecycle.sql");
    for (const [file, expected] of Object.entries(CLOSED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(ROOT, "database/migrations", file))).digest("hex"), expected, `${file} must not change`);
    }
  });

  it("creates, never alters or removes, existing objects; its only writes to existing tables are guard triggers", () => {
    const text = sql();
    assert.doesNotMatch(text, /\bDROP\s+\w+/i);
    assert.doesNotMatch(text, /\bTRUNCATE\s+(TABLE\s+)?(ONLY\s+)?public\./i);
    assert.doesNotMatch(text, /\bDELETE\s+FROM\b|\bUPDATE\s+public\./i);
    assert.doesNotMatch(text, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(text, /\bALTER\s+(COLUMN|POLICY|TYPE)\b|\bRENAME\b/i);
    const alters = text.match(/ALTER TABLE [^;]+;/gi) ?? [];
    assert.equal(alters.length, NEW_TABLES.length);
    for (const statement of alters) {
      assert.match(statement, /ENABLE ROW LEVEL SECURITY/);
      assert.ok(NEW_TABLES.some((table) => statement.includes(`public.${table} `)), statement);
    }
    const guardedExisting = [...text.matchAll(/CREATE TRIGGER (\w+) BEFORE (?:INSERT OR UPDATE|INSERT|UPDATE) ON public\.(evidence_documents|onboarding_evidence_requirements)\b/g)].map((m) => `${m[2]}:${m[1]}`);
    assert.deepEqual(guardedExisting.sort(), ["evidence_documents:evidence_documents_guard_write", "onboarding_evidence_requirements:onboarding_evidence_requirements_guard_write"]);
  });

  it("adds no capabilities and scopes every policy to the existing EVIDENCE_* capabilities", () => {
    assert.doesNotMatch(sql(), /public\.capabilities/);
    const lists = [...sql().matchAll(/system_context_authorized\(ARRAY\[([^\]]+)\]\)/g)].map((m) => m[1]);
    assert.ok(lists.length >= 5);
    for (const list of lists) assert.match(list, /^('EVIDENCE_(READ|MANAGE)'(,)?)+$/);
    assert.doesNotMatch(sql(), /customer_context_authorized/);
  });

  it("gives both new tables RLS, policies and no-delete / no-truncate guards; the access ledger accepts no UPDATE", () => {
    const text = sql();
    for (const table of NEW_TABLES) {
      assert.match(text, new RegExp(`CREATE TABLE public\\.${table}\\b`), table);
      assert.match(text, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), table);
      assert.match(text, new RegExp(`CREATE POLICY ${table}_system_read ON public\\.${table} FOR SELECT`), table);
      assert.match(text, new RegExp(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON public\\.${table}`), table);
      assert.match(text, new RegExp(`CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON public\\.${table}`), table);
    }
    assert.doesNotMatch(text, /GRANT[^;]*\b(DELETE|TRUNCATE|ALL)\b/i);
    assert.match(text, /GRANT SELECT, INSERT ON public\.evidence_payload_access_events/);
    assert.doesNotMatch(text, /CREATE POLICY evidence_payload_access_events_system_update/);
    assert.match(text, /CREATE TRIGGER evidence_payload_access_events_immutable BEFORE UPDATE/);
  });

  it("allows SECURITY DEFINER only for the one boolean organization-existence predicate", () => {
    const definers = [...sql().matchAll(/CREATE FUNCTION (tes_security\.\w+)\([^)]*\)\s+RETURNS (\w+)\s+LANGUAGE sql STABLE SECURITY DEFINER\s+SET search_path = pg_catalog, public/g)];
    assert.deepEqual(definers.map((m) => [m[1], m[2]]), [["tes_security.evidence_organization_exists", "boolean"]]);
    assert.equal((sql().match(/SECURITY DEFINER/g) ?? []).length, 1);
    assert.match(sql(), /REVOKE ALL ON FUNCTION tes_security\.evidence_organization_exists\(uuid\) FROM PUBLIC/);
  });
});

describe("payloads live in GCS, never in PostgreSQL", () => {
  it("stores metadata only: names, generations, hashes - no bytes, base64, URLs or data URLs", () => {
    const text = sql();
    assert.doesNotMatch(text, /\b(bytea|payload_bytes|file_contents|base64|dataurl|data_url|signed_url|public_url|lo_import|large object)\b/i);
    assert.doesNotMatch(text, /https?:\/\//i);
    assert.match(text, /declared_sha256 text NOT NULL/);
    assert.match(text, /evidence_object_name text/);
  });

  it("derives tenant-scoped object names in CHECK constraints (organization and ids are part of the name)", () => {
    const text = sql();
    assert.match(text, /quarantine_object_name = 'quarantine\/' \|\| organization_id::text \|\| '\/' \|\| batch_id::text \|\| '\/' \|\| source_file_id::text \|\| '\/source'/);
    assert.match(text, /intake_object_name = 'intake\/' \|\| organization_id::text/);
    assert.match(text, /evidence_object_name = 'evidence\/' \|\| organization_id::text \|\| '\/' \|\| evidence_document_id::text \|\| '\/source'/);
    assert.match(text, /evidence_bucket <> quarantine_bucket/);
  });

  it("the services never touch browser storage, the legacy browser payload stores, or the raw OCR endpoints", () => {
    for (const file of [...LIB, ...ROUTES, ...UI]) {
      assert.ok(existsSync(path.join(ROOT, file)), file);
      const code = codeOnly(read(file));
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|document\.cookie|evidence-payload-store|evidence-file-store|FileReader|readAsDataURL|URL\.createObjectURL/i, file);
      assert.doesNotMatch(code, /api\/document-ai|api\/business-document-ocr|documentai\.googleapis/i, file);
    }
  });

  it("legacy browser payload stores are ratcheted: the set of importers may shrink but never grow", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(ROOT, dir))) {
        if (entry === "node_modules" || entry === ".next") continue;
        const relative = `${dir}/${entry}`;
        if (statSync(path.join(ROOT, relative)).isDirectory()) walk(relative);
        else if (/\.(ts|tsx)$/.test(entry) && /lib\/evidence-(payload|file)-store/.test(read(relative)) && !relative.startsWith("test/")) importers.push(relative);
      }
    };
    for (const dir of ["app", "src", "lib", "components"]) walk(dir);
    // legacy-vehicles.tsx is the RESTORED original Vehicles workspace (the file that imported this store before the canonical cutover,
    // commit 0e8e8c3). It is browser-local prototype data, never canonical; the owner directed its restoration. It is the only addition.
    assert.deepEqual(importers.sort(), [
      "app/companies/[id]/vehicles/legacy-vehicles.tsx",
      "src/components/business/AuditCasesSection.tsx",
      "src/components/business/CorporateDocumentsSection.tsx",
      "src/components/drivers/DriverWorkspace.tsx",
    ]);
  });
});

describe("no public access, no raw paths, no deletes", () => {
  it("never makes an object public or produces a signed or public URL", () => {
    for (const file of [...LIB, ...ROUTES, "lib/google/storage.ts"]) {
      assert.doesNotMatch(codeOnly(read(file)), /getSignedUrl|generateSignedPostPolicy|makePublic|makePrivate|predefinedAcl|\.acl\b|publicUrl|storage\.googleapis\.com|storage\.cloud\.google\.com|allUsers/i, file);
    }
  });

  it("the lifecycle never deletes, overwrites or moves a payload object", () => {
    for (const file of LIB) {
      const code = codeOnly(read(file));
      assert.doesNotMatch(code, /\.delete\(|\.rename\(|\.move\(|moveIntakeObjectToEvidence|deleteFiles|DELETE\s+FROM|TRUNCATE/i, file);
    }
    const storage = codeOnly(read("lib/google/storage.ts"));
    const added = storage.slice(storage.indexOf("Evidence payload lifecycle primitives") === -1 ? storage.indexOf("export type StorageBucketKind") : storage.indexOf("export type StorageBucketKind"));
    assert.doesNotMatch(added, /\.delete\(|\.save\(/, "the new primitives are read, stat, list and a create-only copy only");
    assert.match(added, /preconditionOpts: \{ ifGenerationMatch: 0 \}/);
    assert.match(added, /file\(intakeObjectName, \{ generation: intakeGeneration \}\)/);
  });

  it("the client-facing view carries no bucket, object name, generation or URL", () => {
    const types = codeOnly(read("lib/evidence-payload/types.ts"));
    const view = types.slice(types.indexOf("export type EvidenceItemView"), types.indexOf("export type FinalizeResult"));
    assert.doesNotMatch(view, /bucket|objectName|object_name|generation|url|gcs|sha256/i);
    const listing = codeOnly(read("lib/evidence-payload/operations.ts"));
    const listSql = listing.slice(listing.indexOf("export async function listEvidence"), listing.indexOf("export async function readAuditRows"));
    assert.doesNotMatch(listSql, /object_name|bucket|generation/i);
    for (const file of [...ROUTES, ...UI]) assert.doesNotMatch(codeOnly(read(file)), /gcs|objectName|bucketName|quarantineObjectName|evidenceObjectName/i, file);
  });

  it("the secure view is inline-only, private and sandboxed, and never sets a download disposition", () => {
    const route = codeOnly(read("app/api/companies/[id]/evidence/[documentId]/route.ts"));
    assert.match(route, /"Content-Disposition": "inline"/);
    assert.doesNotMatch(route, /attachment/i);
    assert.match(route, /"Cache-Control": "private, no-store, max-age=0"/);
    assert.match(route, /"X-Content-Type-Options": "nosniff"/);
    assert.match(route, /sandbox/);
    assert.match(route, /Cross-Origin-Resource-Policy/);
    assert.doesNotMatch(route, /redirect|Location/i);
  });
});

describe("authorization, ordering and accountability", () => {
  const service = () => codeOnly(read("lib/evidence-payload/service.ts"));
  const operations = () => codeOnly(read("lib/evidence-payload/operations.ts"));

  it("uses the authorization wrappers with the 0030 EVIDENCE capabilities", () => {
    assert.match(service(), /^import "server-only"/);
    assert.match(service(), /withAuthorizedSystem\("EVIDENCE_MANAGE"/);
    assert.match(service(), /withAuthorizedSystem\("EVIDENCE_READ"/);
    assert.doesNotMatch(service(), /export (async )?function (delete|remove|truncate)/i);
  });

  it("authorizes and validates before the first byte is written to storage", () => {
    const body = service().slice(service().indexOf("export async function uploadEvidence"), service().indexOf("// --- finalize"));
    const validate = body.indexOf("validateUpload(");
    const authorize = body.indexOf("operations.assertUploadAllowed");
    const write = body.indexOf("storage.putQuarantine");
    const record = body.indexOf("operations.recordUploadAccepted");
    assert.ok(validate > -1 && authorize > validate && write > authorize && record > write, "validate -> authorize -> write -> record");
  });

  it("records the view in the Master Register (and ledger) in a committed transaction before reading storage", () => {
    const body = service().slice(service().indexOf("export async function openEvidenceForView"), service().indexOf("// --- state changes"));
    const recorded = body.indexOf("operations.recordView(");
    const readStorage = body.indexOf("storage.readEvidence");
    assert.ok(recorded > -1 && readStorage > recorded, "recordView precedes readEvidence");
    assert.match(operations(), /DOCUMENT_VIEWED[\s\S]{0,400}INSERT INTO public\.evidence_payload_access_events/);
    assert.match(body, /sha256Hex\(bytes\) !== ticket\.verifiedSha256/);
  });

  it("every lifecycle transition and decision is recorded in the Master Register before it writes", () => {
    const ops = operations();
    for (const operation of ["accept_evidence_upload", "clear_evidence_payload", "block_evidence_payload", "store_evidence_payload", "supersede_evidence_document", "view_evidence_document", "archive_evidence_document", "review_evidence_document", "satisfy_evidence_requirement", "verify_evidence_payload_on_read"]) {
      assert.match(ops, new RegExp(operation), operation);
    }
    assert.doesNotMatch(ops, /field: "[^"]*(object|bucket|generation|url|path)[^"]*"/i, "events never carry storage locations");
  });

  it("looks documents up by organization AND id only", () => {
    assert.match(operations(), /WHERE d\.organization_id = \$1 AND d\.id = \$2/);
    const calls = [...operations().matchAll(/FROM public\.evidence_documents[^`]*WHERE ([^`]*?)`/g)].map((m) => m[1]);
    for (const where of calls.filter((w) => /d?\.?id = \$/.test(w))) assert.match(where, /organization_id/, where);
  });

  it("promotion copies the scanned generation create-only, re-hashes it, and never writes intake", () => {
    const finalize = service().slice(service().indexOf("export async function finalizeEvidence"), service().indexOf("// --- secure view"));
    assert.match(finalize, /storage\.statIntake/);
    assert.match(finalize, /sha256Hex\(bytes\) !== bundle\.declaredSha256/);
    assert.match(finalize, /storage\.copyIntakeToEvidence\(bundle\.intakeObjectName, bundle\.intakeGeneration, evidenceName\)/);
    assert.match(finalize, /sha256Hex\(stored\) !== bundle\.declaredSha256/);
    assert.doesNotMatch(codeOnly(read("lib/evidence-payload/ports.ts")), /putIntake|writeIntake|delete|signed|publicUrl/i);
  });

  it("readiness moves only on verified, payload-backed evidence", () => {
    const onboarding = codeOnly(read("lib/customer-onboarding/service.ts"));
    assert.match(onboarding, /\["verified", "waived", "not_applicable"\]\.includes\(item\.requirementStatus\)/);
    assert.doesNotMatch(onboarding, /\["received", "verified"/);
    assert.doesNotMatch(codeOnly(read("lib/onboarding-foundation/service.ts")), /export async function (createEvidenceDocument|reviewEvidenceDocument)/);
    assert.match(sql(), /A requirement can only be satisfied by a document with a stored, hash-verified payload/);
    assert.match(sql(), /A document can only be classified or verified once a stored, hash-verified payload backs it/);
  });

  it("the application role cannot register a document in any state but received", () => {
    assert.match(sql(), /current_user::text = 'tes-backend@tes-production-510007\.iam' AND \(NEW\.document_status <> 'received'/);
  });
});

describe("no static secrets, no new credentials", () => {
  it("introduces no keys, passwords, tokens or credential files", () => {
    const files = [MIGRATION, ...LIB, ...ROUTES, ...UI, "scripts/database/verify-production-evidence-payload-lifecycle.sh", "scripts/storage/verify-evidence-storage-config.mjs",
      ".github/workflows/evidence-payload-lifecycle-ci.yml", ".github/workflows/production-evidence-payload-lifecycle-verification.yml", "docs/evidence-payload-lifecycle.md"];
    for (const file of files) {
      assert.ok(existsSync(path.join(ROOT, file)), file);
      const text = read(file);
      assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|ya29\./, file);
      // the storage verifier names forbidden variables on purpose; every other file must not mention credential material at all
      // (the CI workflow's throwaway service-container password is a CI fixture, never a production credential)
      if (!file.startsWith("scripts/storage/") && !file.endsWith("evidence-payload-lifecycle-ci.yml")) assert.doesNotMatch(text, /"private_key"|client_secret|PGPASSWORD\s*[:=]\s*[^$\s"']/i, file);
    }
    for (const workflow of ["production-evidence-payload-lifecycle-verification.yml"]) {
      const text = read(`.github/workflows/${workflow}`);
      assert.doesNotMatch(text, /PGPASSWORD|password|credentials_json|GOOGLE_CREDENTIALS|service_account_key/i, workflow);
      assert.match(text, /workload_identity_provider/);
      assert.match(text, /--auto-iam-authn/);
    }
  });
});
