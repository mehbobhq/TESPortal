// Static boundary checks for the vehicle merge slice (no database needed).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DIR = path.join(ROOT, "lib/vehicle-merges");
const files = readdirSync(DIR).filter((file) => file.endsWith(".ts"));
const source = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIGRATION = "0026_vehicle_merge_ledger.sql";
const migrationSql = () => codeOnly(readFileSync(path.join(ROOT, "database/migrations", MIGRATION), "utf8").replace(/^\s*--.*$/gm, ""));

// SHA-256 of the applied (CLOSED) migrations this slice builds on. An applied migration must never change.
const CLOSED_MIGRATIONS: Record<string, string> = {
  "0020_vehicle_identity_foundation.sql": "3939b955323b8bff10810337ff013a1412a6157000e8c982544c1b242af083d4",
  "0021_driver_person_identity_foundation.sql": "9d820f18876b7c06f655ec38f1b7613bf3e6d51467625dd12fbdb557269cc69b",
  "0022_entity_resolution_foundation.sql": "7c96989ba8c50b7ca8477ec7bf03f5d76c2e98fe2fa8439bc1a1f8af07643697",
  "0023_operational_identity_integrity_hardening.sql": "4a0c0f2947711dd2429dbf30b74d75e33846b940d5c264da04ca803fe811a1e1",
  "0024_system_wide_authorization_rls_closure.sql": "ed55a575a609a10e5caa498cd3447c9c5d6aa09190c2ac988483a37adc9eb01a",
};

describe("Vehicle merge boundaries", () => {
  it("the service is the server-only entry point; domain modules stay testable", () => {
    assert.match(source("service.ts"), /^import "server-only"/);
    for (const file of files.filter((name) => name !== "service.ts")) assert.doesNotMatch(source(file), /import "server-only"/, file);
  });

  it("only the service reaches the authorization wrappers or the connection pool", () => {
    for (const file of files.filter((name) => name !== "service.ts")) {
      assert.doesNotMatch(codeOnly(source(file)), /withAuthorized|hasAdditionalSystemCapability|getPostgresPool|withPostgresTransaction|tes-authorization|tes-system-context/, file);
    }
  });

  it("the service is SYSTEM-only and uses exactly VEHICLE_READ and VEHICLE_MANAGE, each where designed", () => {
    const service = codeOnly(source("service.ts"));
    assert.doesNotMatch(service, /withAuthorizedCustomer|tes-customer-context/, "no CUSTOMER-facing path");
    const caps = new Set([...service.matchAll(/"([A-Z]+_[A-Z_]+)"/g)].map((match) => match[1]).filter((code) => /^(ORGANIZATION|CUSTOMER|PERSON|DRIVER|VEHICLE|INSURANCE|IDENTITY)_/.test(code)));
    assert.deepEqual([...caps].sort(), ["VEHICLE_MANAGE", "VEHICLE_READ"]);
    assert.equal((service.match(/withAuthorizedSystem\("VEHICLE_READ"/g) ?? []).length, 2, "resolveVehicle and listVehicleMerges");
    assert.equal((service.match(/withAuthorizedSystem\("VEHICLE_MANAGE"/g) ?? []).length, 1, "every mutation goes through the one manage() helper");
    assert.equal((service.match(/withAuthorizedSystem\(/g) ?? []).length, 3, "no other authorization entry exists");
    assert.equal((service.match(/hasAdditionalSystemCapability\(client, decision, "VEHICLE_READ"\)/g) ?? []).length, 1, "collision disclosure is gated on VEHICLE_READ, once");
  });

  it("the service exposes exactly the designed operations and nothing that deletes", () => {
    const service = codeOnly(source("service.ts"));
    const exported = [...service.matchAll(/^export (?:async function|const) (\w+)/gm)].map((match) => match[1]).sort();
    assert.deepEqual(exported, ["listVehicleMerges", "mergeVehicles", "resolveVehicle", "reverseVehicleMerge"]);
    assert.doesNotMatch(service, /delete|remove|destroy|purge/i);
  });

  it("no DELETE/TRUNCATE SQL; no browser or cloud storage; no UI imports", () => {
    for (const file of files) {
      const code = codeOnly(source(file));
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|@google-cloud|storage\.googleapis|gcs\b/i, file);
      assert.doesNotMatch(code, /from "react"|from "next|@\/components|@\/app\//, file);
    }
  });

  it("no debug output, placeholders or unsafe casts", () => {
    for (const file of files) {
      const text = source(file);
      assert.doesNotMatch(codeOnly(text), /console\.|debugger/, file);
      assert.doesNotMatch(text, /TODO|FIXME|HACK|XXX/, file);
      assert.doesNotMatch(codeOnly(text), /\bas any\b|\bas never\b/, file);
      assert.ok(text.endsWith("\n"), `${file} ends with a newline`);
    }
  });

  it("the Master Register is only written through the shared recorder, with existing event types, references and controlled words", () => {
    const operations = codeOnly(source("operations.ts"));
    assert.match(operations, /recordEvent\(/);
    const types = new Set([...operations.matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]));
    assert.deepEqual([...types].sort(), ["RECORD_CREATED", "RECORD_STATUS_CHANGED", "RECORD_UPDATED"]);
    const registered = readFileSync(path.join(ROOT, "lib/master-register/event-types.ts"), "utf8");
    for (const type of types) assert.ok(registered.includes(`${type}:`), `${type} must be an existing event type`);
    // every literal() argument is a controlled word or null: never a variable, an identifier or a date
    const literals = [...operations.matchAll(/literal\(([^)]*)\)/g)].map((match) => match[1].trim());
    assert.ok(literals.length >= 8);
    for (const argument of literals) assert.match(argument, /^(null|reason|"[A-Za-z_]+")$/, `literal(${argument}) must be controlled vocabulary`);
    assert.doesNotMatch(operations, /literal\([^)]*(vin|plate|unit|display|Date|At\b|name)/i, "no identifiers, dates or names reach the register");
    const resources = new Set([...operations.matchAll(/resourceType: "(\w+)"/g)].map((match) => match[1]));
    assert.deepEqual([...resources].sort(), ["vehicle_merges", "vehicles"]);
    assert.match(operations, /subjectReferences: target\.vehicleIds\.map\(\(id\) => `vehicle:\$\{id\}`\)/);
  });

  it("the lock order is vehicles in uuid order, then the ledger row; and the repository locks in that order", () => {
    const repository = codeOnly(source("repository.ts"));
    assert.match(repository, /WHERE id = ANY\(\$1::uuid\[\]\) ORDER BY id FOR UPDATE/);
    assert.match(repository, /FROM public\.vehicle_merges WHERE id = \$1\$\{options\.lock \? " FOR UPDATE" : ""\}/);
    const operations = codeOnly(source("operations.ts"));
    const merge = operations.slice(operations.indexOf("export async function mergeVehicles("), operations.indexOf("export async function reverseVehicleMerge("));
    assert.ok(merge.indexOf("repo.lockVehicles(") < merge.indexOf("repo.insertMerge("), "vehicles before the ledger row on merge");
    const reverse = operations.slice(operations.indexOf("export async function reverseVehicleMerge("));
    assert.ok(reverse.indexOf("repo.lockVehicles(") < reverse.indexOf("repo.getMerge(ctx.client, mergeId, { lock: true })"), "vehicles before the ledger row on reversal");
    assert.ok(reverse.indexOf("repo.getMerge(ctx.client, mergeId, { lock: false })") < reverse.indexOf("repo.lockVehicles("), "the unlocked read only learns which vehicles to lock");
  });

  it("a merge never copies, rewrites or deletes identity data or other domains' records", () => {
    const repository = codeOnly(source("repository.ts"));
    const updates = [...repository.matchAll(/UPDATE\s+public\.(\w+)\s+SET\s+([\s\S]*?)\s+WHERE/g)].map((match) => [match[1], match[2].replace(/\s+/g, " ")]);
    assert.deepEqual(updates, [
      ["vehicles", "record_status = 'merged', merged_into_vehicle_id = $2, updated_at = now()"],
      ["vehicles", "record_status = 'active', merged_into_vehicle_id = NULL, updated_at = now()"],
      ["vehicle_merges", "record_status = 'reversed', reversed_at = clock_timestamp(), updated_at = now()"],
    ]);
    assert.doesNotMatch(repository, /organization_vehicle_relationships|vehicle_registration_periods|insurance_|vin_display\s*=|vin_normalized\s*=\s*\$/, "other domains and identifiers are never touched");
    const inserts = [...repository.matchAll(/INSERT INTO public\.(\w+)/g)].map((match) => match[1]);
    assert.deepEqual(inserts, ["vehicle_merges"]);
  });

  it("migrations 0020-0024 are byte-identical to their closed hashes, and 0026 exists", () => {
    const migrationsDir = path.join(ROOT, "database/migrations");
    assert.ok(readdirSync(migrationsDir).includes(MIGRATION));
    for (const [file, hash] of Object.entries(CLOSED_MIGRATIONS)) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(migrationsDir, file))).digest("hex"), hash, `${file} is CLOSED and must not change`);
    }
  });

  it("migration 0026 is additive: one table, no alteration of existing objects, invoker functions, column-level grants, SYSTEM-only RLS", () => {
    const sql = migrationSql();
    assert.deepEqual([...sql.matchAll(/CREATE TABLE public\.(\w+)/g)].map((match) => match[1]), ["vehicle_merges"]);
    assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|TRIGGER|FUNCTION|INDEX|SCHEMA)\b/i);
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\b(?!\s+public\.vehicle_merges\s+ENABLE ROW LEVEL SECURITY)/i, "no existing table is altered");
    assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE\s+FROM|TRUNCATE)\s/im, "the migration changes schema only");
    assert.doesNotMatch(sql, /\bGRANT\s+(ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/i, "no DELETE / TRUNCATE / ALL grant");
    assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i);
    const functions = [...sql.matchAll(/CREATE FUNCTION tes_security\.(\w+)\(\)/g)].map((match) => match[1]);
    assert.equal(functions.length, 4);
    assert.equal((sql.match(/SECURITY INVOKER/g) ?? []).length, functions.length);
    assert.equal((sql.match(/SET search_path = pg_catalog/g) ?? []).length, functions.length);
    for (const name of functions) assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION tes_security\\.${name}\\(\\) FROM PUBLIC`), name);
    assert.match(sql, /CREATE TRIGGER vehicle_merges_no_delete/);
    assert.match(sql, /CREATE TRIGGER vehicle_merges_no_truncate/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /system_context_authorized\(ARRAY\['VEHICLE_READ','VEHICLE_MANAGE'\]\)/);
    assert.match(sql, /WITH CHECK \(tes_security\.system_context_authorized\(ARRAY\['VEHICLE_MANAGE'\]\)\)/);
    assert.doesNotMatch(sql, /customer_context_authorized/, "SYSTEM-only");
  });

  it("the migration has no line the migration runner rejects (transaction control, psql meta-commands)", () => {
    for (const line of readFileSync(path.join(ROOT, "database/migrations", MIGRATION), "utf8").split("\n")) {
      assert.doesNotMatch(line, /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)([\s;]|$)/i, line);
      assert.doesNotMatch(line, /^\s*\\/, line);
    }
  });
});
