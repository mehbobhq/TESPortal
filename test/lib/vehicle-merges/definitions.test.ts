// Pure tests (no database): vocabulary and error contracts of the vehicle merge ledger.
// The drift test that proves the vocabulary agrees with the CHECK constraints of migration 0026 lives in vehicle-merges.db.test.ts.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

type Defs = typeof import("../../../lib/vehicle-merges/definitions.ts");
type Errs = typeof import("../../../lib/vehicle-merges/errors.ts");

let D = {} as Defs;
let E = {} as Errs;
before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  D = (await import("@/lib/vehicle-merges/definitions")) as Defs;
  E = (await import("@/lib/vehicle-merges/errors")) as Errs;
});

describe("vocabulary", () => {
  it("has exactly the three merge reasons, with no catch-all", () => {
    assert.deepEqual([...D.MERGE_REASONS], ["DUPLICATE_RECORD", "IDENTIFIER_CORRECTION", "RESOLUTION_REVIEW"]);
    for (const reason of D.MERGE_REASONS) assert.doesNotMatch(reason, /OTHER|UNKNOWN|UNSPECIFIED/, reason);
  });

  it("recognizes only those reasons, exactly as written", () => {
    for (const reason of D.MERGE_REASONS) assert.equal(D.isMergeReason(reason), true, reason);
    for (const value of ["duplicate_record", " DUPLICATE_RECORD", "OTHER", "", null, undefined, 1, {}, ["DUPLICATE_RECORD"]]) {
      assert.equal(D.isMergeReason(value), false, String(value));
    }
  });

  it("a ledger row is active or reversed; a vehicle is active, archived or merged", () => {
    assert.deepEqual([...D.MERGE_STATUSES], ["active", "reversed"]);
    assert.deepEqual([...D.VEHICLE_RECORD_STATUSES], ["active", "archived", "merged"]);
  });

  it("bounds the resolution walk with a positive whole number", () => {
    assert.ok(Number.isInteger(D.MAX_RESOLUTION_HOPS));
    assert.ok(D.MAX_RESOLUTION_HOPS >= 8);
  });
});

describe("errors", () => {
  it("every error carries a stable code and extends the base error", () => {
    const cases: Array<[Error & { code: string }, string]> = [
      [new E.VehicleMergeValidationError("reason", "bad"), "VEHICLE_MERGE_INVALID"],
      [new E.VehicleMergeNotFoundError(), "VEHICLE_MERGE_NOT_FOUND"],
      [new E.VehicleMergeStateError("state"), "VEHICLE_MERGE_STATE"],
      [new E.VehicleMergeConflictError("retry"), "VEHICLE_MERGE_CONFLICT"],
      [new E.VehicleVinCollisionError(undefined), "VEHICLE_MERGE_VIN_COLLISION"],
    ];
    for (const [error, code] of cases) {
      assert.ok(error instanceof E.VehicleMergeError, code);
      assert.equal(error.code, code);
    }
  });

  it("the validation error names the semantic field", () => {
    assert.equal(new E.VehicleMergeValidationError("mergedId", "x").field, "mergedId");
  });

  it("the not-found message names the kind of record and nothing else", () => {
    assert.equal(new E.VehicleMergeNotFoundError("Vehicle merge").message, "Vehicle merge was not found.");
    assert.equal(new E.VehicleMergeNotFoundError().message, "Vehicle was not found.");
  });

  it("the VIN collision carries the holder id when given and never a VIN", () => {
    const holder = "11111111-2222-4333-8444-555555555555";
    const named = new E.VehicleVinCollisionError(holder);
    assert.equal(named.holderVehicleId, holder);
    assert.equal(new E.VehicleVinCollisionError(undefined).holderVehicleId, undefined);
    assert.doesNotMatch(named.message, /[A-HJ-NPR-Z0-9]{17}/);
    assert.equal(named.message.includes(holder), false, "the holder is data on the error, not text in the message");
  });
});
