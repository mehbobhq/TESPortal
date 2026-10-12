// Pure tests (no database) for the scheduled-vehicle slice of Insurance (migration 0025): vocabulary, date derivation, and the
// static boundaries of the code and the migration. The drift test that proves the vocabulary agrees with the CHECK list in
// PostgreSQL lives in insurance-schedule.db.test.ts.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

type Defs = typeof import("../../../lib/insurance/definitions.ts");
let D = {} as Defs;
before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  D = (await import("@/lib/insurance/definitions")) as Defs;
});

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DIR = path.join(ROOT, "lib/insurance");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));
const source = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIGRATION = "0025_insurance_scheduled_vehicles_foundation.sql";
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

describe("schedule vocabulary", () => {
  it("has exactly the three schedule reasons, none a catch-all", () => {
    assert.deepEqual([...D.SCHEDULE_REASONS], ["INITIAL", "CHANGE", "CORRECTION"]);
    for (const reason of D.SCHEDULE_REASONS) assert.doesNotMatch(reason, /OTHER|UNKNOWN|UNSPECIFIED/);
  });

  it("the type guard rejects lookalikes and prototype keys", () => {
    for (const good of D.SCHEDULE_REASONS) assert.equal(D.isScheduleReason(good), true, good);
    for (const bad of ["initial", "Initial", "RENEWAL", "toString", "__proto__", "constructor", "", 7, null, undefined, {}]) assert.equal(D.isScheduleReason(bad), false, String(bad));
  });

  it("introduces no stored status vocabulary", () => {
    assert.deepEqual(Object.keys(D).filter((key) => /^(POLICY_|SCHEDULE_)?STATUS|STATUSES$/.test(key)), []);
  });
});

describe("coverageWindowEnd", () => {
  it("is the earliest stated end of the coverage, its term and a cancellation, and null when none is stated", () => {
    assert.equal(D.coverageWindowEnd({ coverageEnd: null, termEnd: null, cancelledOn: null }), null);
    assert.equal(D.coverageWindowEnd({ coverageEnd: null, termEnd: "2024-01-01", cancelledOn: null }), "2024-01-01");
    assert.equal(D.coverageWindowEnd({ coverageEnd: "2023-09-01", termEnd: "2024-01-01", cancelledOn: null }), "2023-09-01");
    assert.equal(D.coverageWindowEnd({ coverageEnd: "2023-09-01", termEnd: "2024-01-01", cancelledOn: "2023-07-01" }), "2023-07-01");
    assert.equal(D.coverageWindowEnd({ coverageEnd: null, termEnd: "2024-01-01", cancelledOn: "2023-12-31" }), "2023-12-31");
    assert.equal(D.coverageWindowEnd({ coverageEnd: "2023-07-01", termEnd: "2023-07-01", cancelledOn: "2023-07-01" }), "2023-07-01");
    assert.equal(D.coverageWindowEnd({ coverageEnd: null, termEnd: null, cancelledOn: "2023-07-01" }), "2023-07-01");
  });
});

describe("scheduleInForce", () => {
  it("a window is half-open: in force from its first day up to, not including, its end", () => {
    const closed = { effectiveFrom: "2023-02-01", effectiveTo: "2023-05-01" };
    assert.equal(D.scheduleInForce(closed, "2023-01-31"), false);
    assert.equal(D.scheduleInForce(closed, "2023-02-01"), true);
    assert.equal(D.scheduleInForce(closed, "2023-04-30"), true);
    assert.equal(D.scheduleInForce(closed, "2023-05-01"), false);
    const open = { effectiveFrom: "2023-02-01", effectiveTo: null };
    assert.equal(D.scheduleInForce(open, "2023-01-31"), false);
    assert.equal(D.scheduleInForce(open, "2023-02-01"), true);
    assert.equal(D.scheduleInForce(open, "2999-12-31"), true);
  });
});

describe("scheduled vehicles: static boundaries", () => {
  it("the service reaches the schedule through INSURANCE_READ (plus VEHICLE_READ for the merge chain) and every mutation through manage()", () => {
    const service = codeOnly(source("service.ts"));
    assert.match(service, /export async function getCoverageSchedule\([^)]*\)[^{]*\{\s*return withAuthorizedSystem\("INSURANCE_READ"/);
    // a vehicle read resolves the merge chain in its own VEHICLE_READ transaction, then reads the schedule under INSURANCE_READ
    const vehicleRead = service.slice(service.indexOf("export async function getVehicleInsurance("), service.indexOf("// --- mutations"));
    assert.ok(vehicleRead.indexOf('withAuthorizedSystem("VEHICLE_READ"') > 0 && vehicleRead.indexOf('withAuthorizedSystem("VEHICLE_READ"') < vehicleRead.indexOf('withAuthorizedSystem("INSURANCE_READ"'));
    assert.equal((service.match(/withAuthorizedSystem\("VEHICLE_READ"/g) ?? []).length, 1, "VEHICLE_READ is used once, by getVehicleInsurance");
    for (const name of ["scheduleVehicle", "removeScheduledVehicle", "changeSchedule", "correctSchedule"]) {
      assert.match(service, new RegExp(`export const ${name} = \\(input: unknown\\): Promise<CoverageScheduleView> => manage\\(`), name);
    }
    assert.equal((service.match(/withAuthorizedSystem\("INSURANCE_MANAGE"/g) ?? []).length, 1, "one manage() helper");
    assert.doesNotMatch(service, /withAuthorizedCustomer|tes-customer-context/);
  });

  it("only operations.ts writes the Master Register and only with existing event types, references and small controlled literals", () => {
    const operations = codeOnly(source("operations.ts"));
    const start = operations.indexOf("type LockedCoverage");
    assert.ok(start > 0);
    const section = operations.slice(start);
    const registered = readFileSync(path.join(ROOT, "lib/master-register/event-types.ts"), "utf8");
    const types = new Set([...section.matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.deepEqual([...types].sort(), ["RECORD_CORRECTED", "RECORD_CREATED", "RECORD_UPDATED"]);
    for (const type of types) assert.ok(registered.includes(`${type}:`), `${type} must be an existing event type`);
    assert.match(section, /resourceType: "insurance_coverage_vehicle"/);
    const literals = [...section.matchAll(/literal\(([^)]*)\)/g)].map((match) => match[1].trim());
    assert.ok(literals.length > 0);
    for (const argument of literals) assert.match(argument, /^(null|"ended")$/, `literal(${argument}) must be a controlled literal`);
    const references = [...section.matchAll(/reference\("(\w+)", /g)].map((match) => match[1]);
    assert.deepEqual([...new Set(references)].sort(), ["insurance_coverage_vehicles", "vehicles"]);
    assert.doesNotMatch(section, /literal\([^)]*(effective|Date|vin|serial|unit|plate|legalName)/i, "no dates, identifiers or names reach the register");
  });

  it("every schedule mutation locks in the designed order: Organization, policy, term and coverage, then the schedule row; the vehicle is locked by the database guard", () => {
    const operations = codeOnly(source("operations.ts"));
    const lockCoverage = operations.slice(operations.indexOf("async function lockCoverage("), operations.indexOf("type LockedSchedule"));
    const order = ["lockActiveOrganization(", "repo.getPolicy(", "repo.getTerm(", "repo.getCoverage("].map((needle) => lockCoverage.indexOf(needle, lockCoverage.indexOf("const insuredId")));
    assert.ok(order.every((index) => index > 0), "all lock steps exist");
    assert.deepEqual([...order].sort((a, b) => a - b), order, "locks are taken in order");
    const lockSchedule = operations.slice(operations.indexOf("async function lockSchedule("), operations.indexOf("function assertOpen("));
    assert.ok(lockSchedule.indexOf("lockCoverage(") < lockSchedule.indexOf("repo.getSchedule("), "the coverage context is locked before the schedule row");
    for (const name of ["scheduleVehicle", "removeScheduledVehicle", "changeSchedule", "correctSchedule"]) {
      const start = operations.indexOf(`export async function ${name}(`);
      const end = operations.indexOf("\nexport ", start + 10);
      const body = operations.slice(start, end === -1 ? undefined : end);
      assert.match(body, /lockCoverage\(|lockSchedule\(/, name);
      assert.ok(body.search(/lockCoverage\(|lockSchedule\(/) < body.search(/repo\.insertSchedule\(|repo\.endSchedule\(|repo\.supersedeSchedule\(/), `${name}: every write follows the locks`);
    }
    const repository = codeOnly(source("repository.ts"));
    assert.match(repository, /FOR NO KEY UPDATE OF s/);
    assert.match(migrationSql(), /FROM public\.vehicles AS v WHERE v\.id = NEW\.vehicle_id FOR SHARE/, "the guard takes the vehicle lock after the coverage lock");
  });

  it("the transaction never reads vehicle tables itself: only the VEHICLE_READ chain walk touches public.vehicles", () => {
    const repository = codeOnly(source("repository.ts"));
    assert.equal((repository.match(/public\.vehicles\b/g) ?? []).length, 3, "only the survivor and family walks read vehicles, and nothing else does");
    assert.doesNotMatch(repository, /organization_vehicle_relationships|vehicle_merges/);
    const resolve = repository.slice(repository.indexOf("export async function findVehicleSurvivor("), repository.indexOf("export async function findScheduleCoverage("));
    assert.equal((resolve.match(/public\.vehicles\b/g) ?? []).length, 3);
    assert.match(resolve, /merged_into_vehicle_id/);
    assert.equal((resolve.match(/\bUNION\b/g) ?? []).length, 2, "both recursive walks use set UNION, so they terminate on a loop");
  });

  it("no DELETE/TRUNCATE SQL, no browser storage or Google Cloud storage, no UI imports anywhere in the slice", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|@google-cloud|storage\.googleapis|gcs\b/i, file);
      assert.doesNotMatch(code, /from "react"|from "next|@\/components|@\/app\//, file);
    }
  });

  it("the slice reads vehicles through SQL only and never imports another domain's code", () => {
    for (const file of files) assert.doesNotMatch(codeOnly(source(file)), /@\/lib\/(operational-identity|vehicle-merges|vehicles|drivers|identity-resolution)/, file);
  });

  it("the schedule never claims sufficiency: nothing in the code stores or derives a verdict", () => {
    const code = ["operations.ts", "repository.ts", "types.ts", "definitions.ts", "service.ts"].map((file) => codeOnly(source(file))).join("\n");
    assert.doesNotMatch(code, /sufficien|verdict|compliant|meets_requirement/i);
  });

  it("migrations 0001-0024 are byte-identical to their closed hashes and nothing numbered <= 0024 was added or renamed", () => {
    const migrationsDir = path.join(ROOT, "database/migrations");
    const present = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    assert.deepEqual(
      present.filter((file) => Number(file.slice(0, 4)) <= 24),
      Object.keys(CLOSED_MIGRATIONS).sort(),
    );
    assert.ok(present.includes(MIGRATION));
    for (const [file, hash] of Object.entries(CLOSED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(migrationsDir, file))).digest("hex"), hash, `${file} is CLOSED and must not change`);
    }
  });

  it("migration 0025 is additive: one new table with its indexes, row-level security, four functions (one SECURITY DEFINER) and the triggers; nothing existing is touched", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|TRIGGER|FUNCTION|INDEX|SCHEMA|POLICY)\b/i);
    assert.deepEqual([...sql.matchAll(/\bALTER\s+(\w+)\s+(\S+)\s+(\w+)/gi)].map((match) => `${match[1]} ${match[2]} ${match[3]}`), ["TABLE public.insurance_coverage_vehicles ENABLE"], "the only ALTER enables row-level security on the new table");
    assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE\s+FROM|TRUNCATE)\s/im, "the migration changes schema only");
    assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i, "no data is seeded");
    assert.doesNotMatch(sql, /\bGRANT\s+(ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/i, "no DELETE / TRUNCATE / ALL grant");
    assert.doesNotMatch(sql, /\bGRANT\s+UPDATE\s+ON\b/i, "UPDATE is only ever granted per column");
    assert.doesNotMatch(sql, /\bGRANT\s+INSERT\s+ON\b/i, "INSERT is only ever granted per column");
    assert.doesNotMatch(sql, /FORCE\s+ROW|BYPASSRLS|set_config/i);
    assert.doesNotMatch(sql, /relationship_capability_grants|relationship_assignments|actor_relationships/i, "nothing is granted to anyone");
    assert.deepEqual([...sql.matchAll(/CREATE TABLE public\.(\w+)/g)].map((match) => match[1]), ["insurance_coverage_vehicles"]);
    const functions = [...sql.matchAll(/CREATE FUNCTION tes_security\.(\w+)\(\)/g)].map((match) => match[1]);
    assert.deepEqual(functions, ["prevent_insurance_schedule_data_removal", "guard_insurance_schedule_insert", "guard_insurance_schedule_vehicle", "guard_insurance_schedule_update"]);
    assert.equal((sql.match(/SECURITY INVOKER/g) ?? []).length, functions.length - 1);
    assert.equal((sql.match(/SECURITY DEFINER/g) ?? []).length, 1, "exactly one SECURITY DEFINER function");
    assert.match(sql, /CREATE FUNCTION tes_security\.guard_insurance_schedule_vehicle\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER/);
    assert.equal((sql.match(/SET search_path = pg_catalog/g) ?? []).length, functions.length, "every function pins its search_path");
    for (const name of functions) assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION tes_security\\.${name}\\(\\) FROM PUBLIC`), name);
    assert.deepEqual([...sql.matchAll(/CREATE POLICY (\w+) ON public\.insurance_coverage_vehicles/g)].map((match) => match[1]), ["insurance_coverage_vehicles_system", "insurance_coverage_vehicles_customer"]);
    assert.match(sql, /CREATE TRIGGER insurance_coverage_vehicles_no_delete/);
    assert.match(sql, /CREATE TRIGGER insurance_coverage_vehicles_no_truncate/);
  });

  it("the migration has no line the migration runner rejects (transaction control, psql meta-commands)", () => {
    for (const line of migrationText().split("\n")) {
      assert.doesNotMatch(line, /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)([\s;]|$)/i, line);
      assert.doesNotMatch(line, /^\s*\\/, line);
    }
  });
});
