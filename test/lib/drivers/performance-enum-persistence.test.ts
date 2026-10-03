import "../../helpers/register-alias-loader.mjs";
import test, { before } from "node:test";
import assert from "node:assert/strict";

import {
  resolvePreventability,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-investigation.ts";

type DriverData = typeof import("../../../lib/driver-data");
let dd: DriverData;

before(async () => {
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  dd = (await import("../../../lib/driver-data.ts")) as DriverData;
});

const COMPANY = "C-ENUM";
const KEY = `tes_company_drivers_${COMPANY}`;
const STAMP = "2025-01-01T00:00:00.000Z";

const CANONICAL_TYPES = ["COLLISION_PREVENTABILITY", "COMPLAINT_SUBSTANTIATION", "INVESTIGATION_FINDING", "ROOT_CAUSE_ANALYSIS", "CORRECTIVE_ACTION_OUTCOME"];
const CANONICAL_VALUES = ["PREVENTABLE", "NON_PREVENTABLE", "SUBSTANTIATED", "NOT_SUBSTANTIATED", "UNABLE_TO_DETERMINE"];
const CANONICAL_ACTIONS = ["COACHING", "TRAINING_ASSIGNMENT", "VERBAL_WARNING", "WRITTEN_WARNING", "FINAL_WARNING", "SUSPENSION", "POLICY_REVIEW", "MONITORING_TELEMATICS", "DISPATCH_CHANGE", "EQUIPMENT_INSPECTION_REPAIR", "CORRECTIVE_ACTION_PLAN", "DISCIPLINARY_ACTION", "SAFETY_WARNING", "RETRAINING_MANDATE", "PERFORMANCE_IMPROVEMENT_PLAN", "OTHER"];
const TYPE_LABELS: Array<[string, string]> = [["Collision Preventability", "COLLISION_PREVENTABILITY"], ["Complaint Substantiation", "COMPLAINT_SUBSTANTIATION"], ["Investigation Finding", "INVESTIGATION_FINDING"], ["Root Cause Analysis", "ROOT_CAUSE_ANALYSIS"], ["Corrective Action Outcome", "CORRECTIVE_ACTION_OUTCOME"]];
const VALUE_LABELS: Array<[string, string]> = [["Preventable", "PREVENTABLE"], ["Non-Preventable", "NON_PREVENTABLE"], ["Substantiated", "SUBSTANTIATED"], ["Not Substantiated", "NOT_SUBSTANTIATED"], ["Unable to Determine", "UNABLE_TO_DETERMINE"]];
const ACTION_LABELS: Array<[string, string]> = [["Coaching", "COACHING"], ["Coaching Session", "COACHING"], ["Training Assignment", "TRAINING_ASSIGNMENT"], ["Verbal Warning", "VERBAL_WARNING"], ["Written Warning", "WRITTEN_WARNING"], ["Final Warning", "FINAL_WARNING"], ["Suspension", "SUSPENSION"], ["Policy Review", "POLICY_REVIEW"], ["Monitoring / Telematics Watch", "MONITORING_TELEMATICS"], ["Dispatch Change", "DISPATCH_CHANGE"], ["Equipment Inspection / Repair", "EQUIPMENT_INSPECTION_REPAIR"], ["Corrective Action Plan", "CORRECTIVE_ACTION_PLAN"], ["Disciplinary Action", "DISCIPLINARY_ACTION"], ["Safety Warning", "SAFETY_WARNING"], ["Retraining Mandate", "RETRAINING_MANDATE"], ["Performance Improvement Plan", "PERFORMANCE_IMPROVEMENT_PLAN"], ["Other", "OTHER"]];

const determination = (extra: object = {}) => ({ id: "DET-1", companyId: COMPANY, driverMasterId: "DRV-1", relatedRecordType: "Collision", relatedRecordId: "COL-1", determinedBy: "Rev", determinationDate: "2025-01-01", createdAt: STAMP, ...extra });
const action = (extra: object = {}) => ({ id: "ACT-1", companyId: COMPANY, driverMasterId: "DRV-1", title: "t", decidedBy: "Mgr", factualBasis: "f", effectiveDate: "2025-01-01", status: "Completed", createdAt: STAMP, updatedAt: STAMP, ...extra });
const collision = { id: "COL-1", companyId: COMPANY, driverMasterId: "DRV-1", eventType: "Collision", eventDate: "2025-01-01", severity: "Not Applicable", status: "Not Applicable", summary: "s", description: "d", evidenceIds: [], chronology: [], isArchived: false, createdAt: STAMP, updatedAt: STAMP };

function seed(determinations: object[], actions: object[]) {
  localStorage.setItem(KEY, JSON.stringify({ version: 2, companyId: COMPANY, relationships: [], events: [collision], companyDeterminations: determinations, companyActions: actions }));
}
// Load -> save -> reload, i.e. every migration pass a stored record goes through in normal use.
function roundTrip() {
  const first = dd.loadCompanyDriverStore(COMPANY);
  dd.saveCompanyDriverStore(first);
  return dd.loadCompanyDriverStore(COMPANY);
}

test("A. every canonical determinationType survives save -> reload -> reload unchanged", () => {
  for (const type of CANONICAL_TYPES) {
    seed([determination({ determinationType: type })], []);
    const store = roundTrip();
    assert.equal(store.companyDeterminations[0].determinationType, type);
    assert.equal(store.companyDeterminations[0].legacyDeterminationType, undefined);
    assert.equal(roundTrip().companyDeterminations[0].determinationType, type);
  }
});

test("B. recognised display labels for determinationType map to the canonical value and keep the label as legacy", () => {
  for (const [label, canonical] of TYPE_LABELS) {
    seed([determination({ determinationType: label })], []);
    const row = roundTrip().companyDeterminations[0];
    assert.equal(row.determinationType, canonical);
    assert.equal(row.legacyDeterminationType, label);
  }
});

test("C. every canonical determinationValue survives save -> reload unchanged", () => {
  for (const value of CANONICAL_VALUES) {
    seed([determination({ determinationType: "COLLISION_PREVENTABILITY", determinationValue: value })], []);
    const row = roundTrip().companyDeterminations[0];
    assert.equal(row.determinationValue, value);
    assert.equal(row.legacyDeterminationValue, undefined);
  }
});

test("D. recognised display labels for determinationValue map to the canonical value", () => {
  for (const [label, canonical] of VALUE_LABELS) {
    seed([determination({ determinationValue: label })], []);
    const row = roundTrip().companyDeterminations[0];
    assert.equal(row.determinationValue, canonical);
    assert.equal(row.legacyDeterminationValue, label);
  }
});

test("E. every canonical actionType survives save -> reload unchanged", () => {
  for (const type of CANONICAL_ACTIONS) {
    seed([], [action({ actionType: type })]);
    const row = roundTrip().companyActions[0];
    assert.equal(row.actionType, type);
    assert.equal(row.legacyActionType, undefined);
  }
});

test("F. recognised display labels for actionType map to the canonical value", () => {
  for (const [label, canonical] of ACTION_LABELS) {
    seed([], [action({ actionType: label })]);
    const row = roundTrip().companyActions[0];
    assert.equal(row.actionType, canonical);
    assert.equal(row.legacyActionType, label);
  }
});

test("G. unknown historical values keep the legacy-preserving fallback and are never turned into another valid value", () => {
  for (const unknown of ["Totally Unknown", "preventable", "COLLISION-PREVENTABILITY", "constructor", "toString"]) {
    seed([determination({ determinationType: unknown, determinationValue: unknown })], [action({ actionType: unknown })]);
    const store = roundTrip();
    const d = store.companyDeterminations[0];
    assert.equal(d.determinationType, undefined);
    assert.equal(d.legacyDeterminationType, unknown);
    assert.equal(d.determinationValue, undefined);
    assert.equal(d.legacyDeterminationValue, unknown);
    assert.equal(store.companyActions[0].actionType, "OTHER");
    assert.equal(store.companyActions[0].legacyActionType, unknown);
  }
  // An action with no type at all keeps the pre-existing OTHER fallback.
  seed([], [action({})]);
  assert.equal(roundTrip().companyActions[0].actionType, "OTHER");
});

test("records already damaged by the old migration (canonical string parked in legacy*) are recovered without erasing the legacy field", () => {
  seed([determination({ legacyDeterminationType: "COLLISION_PREVENTABILITY", legacyDeterminationValue: "NON_PREVENTABLE" })], [action({ actionType: "OTHER", legacyActionType: "CORRECTIVE_ACTION_PLAN" })]);
  const store = roundTrip();
  assert.equal(store.companyDeterminations[0].determinationType, "COLLISION_PREVENTABILITY");
  assert.equal(store.companyDeterminations[0].determinationValue, "NON_PREVENTABLE");
  assert.equal(store.companyDeterminations[0].legacyDeterminationType, "COLLISION_PREVENTABILITY");
  assert.equal(store.companyActions[0].actionType, "CORRECTIVE_ACTION_PLAN");
  assert.equal(store.companyActions[0].legacyActionType, "CORRECTIVE_ACTION_PLAN");
});

test("H. Collision preventability resolves to the same result whether the determination is canonical, label-based or already damaged", () => {
  const shapes = [
    { determinationType: "COLLISION_PREVENTABILITY", determinationValue: "PREVENTABLE" },
    { determinationType: "Collision Preventability", determinationValue: "Preventable" },
    { legacyDeterminationType: "COLLISION_PREVENTABILITY", legacyDeterminationValue: "PREVENTABLE" },
  ];
  for (const shape of shapes) {
    seed([determination(shape)], []);
    const store = dd.loadCompanyDriverStore(COMPANY);
    const resolved = resolvePreventability(store, store.events[0]);
    assert.equal(resolved?.value, "PREVENTABLE");
    assert.equal(resolved?.source, "LEGACY_DETERMINATION");
    const after = roundTrip();
    assert.deepEqual(resolvePreventability(after, after.events[0]), resolved);
  }
});

test("I. existing Company Actions and Determinations still load with their additive fields intact", () => {
  seed([determination({ determinationType: "COLLISION_PREVENTABILITY", determinationValue: "PREVENTABLE", futureField: "kept" })], [action({ actionType: "Coaching Session", actionOwner: "Dispatcher", futureField: "kept" })]);
  const store = roundTrip();
  assert.equal(store.companyActions.length, 1);
  assert.equal(store.companyActions[0].title, "t");
  assert.equal(store.companyActions[0].actionOwner, "Dispatcher");
  assert.equal((store.companyActions[0] as any).futureField, "kept");
  assert.equal((store.companyDeterminations[0] as any).futureField, "kept");
});
