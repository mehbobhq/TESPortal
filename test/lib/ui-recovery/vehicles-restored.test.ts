// Static and unit checks for the restored Vehicles workspace and the vehicle lifecycle operations (no database needed).

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("vehicle lifecycle operations: static boundaries", () => {
  const files = ["vehicle-lifecycle.ts", "vehicle-lifecycle-repository.ts", "vehicle-errors.ts", "vehicle-workspace-reads.ts"];

  it("never deletes, never uses browser storage, never uses unsafe casts", () => {
    for (const file of files) {
      const code = codeOnly(read(`lib/operational-identity/${file}`));
      assert.doesNotMatch(code, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i, file);
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB/, file);
      assert.doesNotMatch(code, /\bas any\b/, file);
    }
  });

  it("only the service and the read model reach the authorization wrapper", () => {
    for (const file of ["vehicle-lifecycle.ts", "vehicle-lifecycle-repository.ts", "vehicle-errors.ts"]) {
      assert.doesNotMatch(codeOnly(read(`lib/operational-identity/${file}`)), /withAuthorized|tes-system-context|getPostgresPool|withPostgresTransaction/, file);
    }
    assert.match(read("lib/operational-identity/vehicle-workspace-reads.ts"), /withAuthorizedSystem\("VEHICLE_READ"/);
  });

  it("every mutation is wired to VEHICLE_MANAGE in the service and nothing else", () => {
    const service = codeOnly(read("lib/operational-identity/service.ts"));
    for (const name of ["addVehicleRegistration", "changeVehicleRegistration", "correctVehicleRegistration", "voidVehicleRegistration", "archiveVehicle", "restoreVehicle", "endVehicleRelationship", "changeVehicleUnitNumber", "correctVehicleUnitNumber"]) {
      assert.match(service, new RegExp(`export const ${name}=\\(input:lifecycle\\.\\w+\\)=>withAuthorizedSystem\\("VEHICLE_MANAGE"`), name);
    }
  });

  it("each mutation writes its Master Register event through the shared recorder, with registered event types and references only", () => {
    const operations = codeOnly(read("lib/operational-identity/vehicle-lifecycle.ts"));
    assert.match(operations, /recordEvent\(/);
    const registered = read("lib/master-register/event-types.ts");
    for (const type of new Set([...operations.matchAll(/"(RECORD_[A-Z_]+)"/g)].map((match) => match[1]))) assert.ok(registered.includes(`${type}:`), type);
    const literals = [...operations.matchAll(/literal\(([^)]*)\)/g)].map((match) => match[1].trim());
    assert.ok(literals.length >= 10);
    for (const argument of literals) assert.match(argument, /^(null|"[A-Za-z_]+")$/, `literal(${argument}) must be controlled vocabulary`);
    assert.equal((operations.match(/await record\(/g) ?? []).length >= 13, true, "every branch records an event");
  });

  it("routes take the company from the URL and never from the body", () => {
    const dir = "app/api/companies/[id]/vehicles";
    const routes = [`${dir}/workspace/route.ts`, `${dir}/[vehicleId]/route.ts`, `${dir}/[vehicleId]/registrations/route.ts`, `${dir}/registrations/[registrationId]/route.ts`, `${dir}/relationships/[relationshipId]/route.ts`];
    for (const route of routes) {
      const code = read(route);
      assert.match(code, /await context\.params/, route);
      assert.doesNotMatch(code, /body\.organizationId|body\.companyId/, route);
      assert.doesNotMatch(code, /localStorage|window\.|document\.|\b(?:SELECT|INSERT|UPDATE|DELETE)\b\s/, route);
    }
  });

  it("adds no migration", () => {
    const migrations = readdirSync(path.join(ROOT, "database/migrations")).filter((file) => file.endsWith(".sql"));
    assert.equal(migrations.at(-1), "0032_evidence_payload_lifecycle.sql");
  });
});

describe("restored Vehicles workspace", () => {
  it("keeps the inspection-type vocabulary identical to src/types.ts", () => {
    const original = [...read("src/types.ts").match(/export const INSPECTION_TYPES = \[([\s\S]*?)\] as const/)![1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const restored = [...read("src/restored/vehicles/lib/inspection-types.ts").match(/export const INSPECTION_TYPES = \[([\s\S]*?)\] as const/)![1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(restored, original);
  });

  it("the page keeps the gate, talks to the API and lists what is deferred", () => {
    const page = read("app/companies/[id]/vehicles/page.tsx");
    assert.match(page, /LegacyWorkspaceGate/);
    assert.match(page, /fetch\(/);
    assert.match(page, /deferred/);
    assert.match(page, /canonical=\{<CanonicalVehicles/);
  });
});

describe("restored Vehicles adapter", () => {
  const K: { canonical?: typeof import("@/src/restored/vehicles/canonical"); store?: typeof import("@/src/restored/vehicles/lib/vehicle-data") } = {};
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    K.canonical = await import("@/src/restored/vehicles/canonical");
    K.store = await import("@/src/restored/vehicles/lib/vehicle-data");
  });

  it("maps only exact vehicle types and refuses the rest instead of guessing", () => {
    const { typeCodeFor } = K.canonical!;
    assert.equal(typeCodeFor("Tractor"), "TRUCK_TRACTOR");
    assert.equal(typeCodeFor("Straight Truck"), "STRAIGHT_TRUCK");
    assert.equal(typeCodeFor("Trailer"), "TRAILER");
    assert.equal(typeCodeFor("Other Equipment"), "OTHER");
    for (const type of ["Trailer - Dry Van", "Trailer - Reefer", "Converter Dolly", "Service Vehicle"]) {
      assert.throws(() => typeCodeFor(type), (error: unknown) => error instanceof Error && error.name === "CanonicalOperationUnavailableError", type);
    }
  });

  it("maps canonical records honestly: unknown fields are not invented and history rows are flagged", () => {
    const store = K.canonical!.storeFromWorkspace([
      {
        relationshipId: "r1", vehicleId: "v1", relationshipType: "LEASES", unitNumber: "U-1", relationshipEffectiveFrom: "2024-01-01T00:00:00.000Z", vehicleType: "TRAILER",
        vin: "1HGBH41JXMN109186", modelYear: null, make: "Acme", model: null, vehicleStatus: "archived", archivedAt: "2024-02-01T00:00:00.000Z", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-02-01T00:00:00.000Z",
        registrations: [
          { id: "g1", registrationKind: "BASE", registrationNumber: null, plate: "ABC123", jurisdictionCountry: "CA", jurisdictionRegion: "ON", effectiveFrom: "2024-01-01", effectiveTo: null, recordStatus: "active" },
          { id: "g0", registrationKind: "BASE", registrationNumber: null, plate: "OLD111", jurisdictionCountry: "CA", jurisdictionRegion: "ON", effectiveFrom: "2023-01-01", effectiveTo: "2024-01-01", recordStatus: "corrected" },
        ],
        relationshipHistory: [],
      },
    ]);
    const vehicle = store.vehicles[0];
    assert.equal(vehicle.equipmentType, "Trailer");
    assert.equal(vehicle.status, "Archived");
    assert.equal(vehicle.year, "");
    assert.equal(vehicle.color, "");
    assert.equal(vehicle.axles, 0);
    assert.equal(store.ownershipRecords[0].relationship, "Leased");
    assert.equal(store.registrationRecords.find((r) => r.id === "g1")!.archived, false);
    assert.equal(store.registrationRecords.find((r) => r.id === "g0")!.archived, true);
    assert.equal(store.registrationRecords.find((r) => r.id === "g0")!.status, "Replaced");
    assert.equal(store.permitRecords.length + store.inspectionRecords.length + store.maintenanceRecords.length + store.evidence.length, 0);
  });

  it("saveVehicleStore refuses any change to a collection with no canonical backend and never persists", () => {
    const { saveVehicleStore, emptyVehicleStore, setVehicleStoreInMemory } = K.store!;
    const base = emptyVehicleStore();
    setVehicleStoreInMemory("c-test", base);
    saveVehicleStore("c-test", { ...base }); // unchanged: accepted
    assert.throws(
      () => saveVehicleStore("c-test", { ...base, permitRecords: [{ id: "p" } as never] }),
      (error: unknown) => error instanceof Error && error.name === "CanonicalOperationUnavailableError" && /permits/.test(error.message),
    );
    assert.throws(() => saveVehicleStore("c-test", { ...base, evidence: [{ id: "e" } as never] }), (error: unknown) => error instanceof Error && /vehicle document target/.test(error.message));
  });
});
