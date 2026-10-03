import "../../helpers/register-alias-loader.mjs";
import test, { before } from "node:test";
import assert from "node:assert/strict";

import {
  COMPANY_ACTION_TYPE_LABELS,
  companyActionTypeLabel,
  companyDeterminationTypeLabel,
  companyDeterminationValueLabel,
  isCoachingAction,
  isOpenCorrectivePlan,
  summarizeCollisionPreventability,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-action-metrics.ts";

type DriverData = typeof import("../../../lib/driver-data");
let dd: DriverData;
before(async () => {
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  dd = (await import("../../../lib/driver-data.ts")) as DriverData;
});

const COMPANY = "C-METRICS";
const KEY = `tes_company_drivers_${COMPANY}`;
const STAMP = "2025-01-01T00:00:00.000Z";
const action = (id: string, extra: object) => ({ id, companyId: COMPANY, driverMasterId: "D", title: id, decidedBy: "M", factualBasis: "f", effectiveDate: "2025-01-01", status: "Active", createdAt: STAMP, updatedAt: STAMP, ...extra });
const determination = (id: string, relatedRecordId: string, extra: object) => ({ id, companyId: COMPANY, driverMasterId: "D", relatedRecordType: "Collision", relatedRecordId, determinedBy: "R", determinationDate: "2025-01-01", createdAt: STAMP, ...extra });
const load = (actions: object[], determinations: object[]) => {
  localStorage.setItem(KEY, JSON.stringify({ version: 2, companyId: COMPANY, relationships: [], events: [], companyActions: actions, companyDeterminations: determinations }));
  const first = dd.loadCompanyDriverStore(COMPANY);
  dd.saveCompanyDriverStore(first);
  return dd.loadCompanyDriverStore(COMPANY);
};

test("canonical COACHING is recognised as coaching, including after a save/reload; legacy labels still resolve through migration", () => {
  const store = load([action("A1", { actionType: "COACHING" }), action("A2", { actionType: "Coaching Session" }), action("A3", { actionType: "Coaching" }), action("A4", { actionType: "VERBAL_WARNING" })], []);
  assert.deepEqual(store.companyActions.filter(isCoachingAction).map((a) => a.id), ["A1", "A2", "A3"]);
});

test("canonical CORRECTIVE_ACTION_PLAN and PERFORMANCE_IMPROVEMENT_PLAN count as open plans until Completed/Rescinded", () => {
  const store = load(
    [
      action("CAP-OPEN", { actionType: "CORRECTIVE_ACTION_PLAN", status: "Active" }),
      action("CAP-LEGACY", { actionType: "Corrective Action Plan", status: "In Progress" }),
      action("PIP-OPEN", { actionType: "PERFORMANCE_IMPROVEMENT_PLAN", status: "Draft" }),
      action("CAP-DONE", { actionType: "CORRECTIVE_ACTION_PLAN", status: "Completed" }),
      action("PIP-RESCINDED", { actionType: "PERFORMANCE_IMPROVEMENT_PLAN", status: "Rescinded" }),
      action("COACH", { actionType: "COACHING" }),
    ],
    [],
  );
  assert.deepEqual(store.companyActions.filter(isOpenCorrectivePlan).map((a) => a.id), ["CAP-OPEN", "CAP-LEGACY", "PIP-OPEN"]);
});

test("every other canonical action type is neither coaching nor an open corrective plan", () => {
  for (const type of Object.keys(COMPANY_ACTION_TYPE_LABELS).filter((t) => !["COACHING", "CORRECTIVE_ACTION_PLAN", "PERFORMANCE_IMPROVEMENT_PLAN"].includes(t))) {
    assert.equal(isCoachingAction({ actionType: type as keyof typeof COMPANY_ACTION_TYPE_LABELS }), false, type);
    assert.equal(isOpenCorrectivePlan({ actionType: type as keyof typeof COMPANY_ACTION_TYPE_LABELS, status: "Active" }), false, type);
  }
});

test("presentation shows human-readable labels for canonical values, with the legacy text as the fallback for unknown values", () => {
  assert.equal(companyActionTypeLabel("COACHING"), "Coaching Session");
  assert.equal(companyActionTypeLabel("CORRECTIVE_ACTION_PLAN"), "Corrective Action Plan");
  assert.equal(companyActionTypeLabel("OTHER", "Written Reprimand"), "Other");
  assert.equal(companyActionTypeLabel(undefined, "Written Reprimand"), "Written Reprimand");
  assert.equal(companyDeterminationTypeLabel("COLLISION_PREVENTABILITY"), "Collision Preventability");
  assert.equal(companyDeterminationValueLabel("NON_PREVENTABLE"), "Non-Preventable");
  assert.equal(companyDeterminationValueLabel(undefined, "Odd"), "Odd");
  for (const label of Object.values(COMPANY_ACTION_TYPE_LABELS)) assert.ok(!/^[A-Z_]+$/.test(String(label)));
});

test("canonical, label-based and legacy Collision determinations feed the counters once per collision; unrelated determinations never do", () => {
  const ids = ["COL-P", "COL-N", "COL-U", "COL-NONE", "COL-LEGACY", "COL-ARCH", "COL-OTHERTYPE"];
  const collisions = ids.map((id) => ({ id, companyId: COMPANY, eventType: "Collision" as const }));
  const store = load(
    [],
    [
      determination("D1", "COL-P", { determinationType: "COLLISION_PREVENTABILITY", determinationValue: "PREVENTABLE" }),
      determination("D2", "COL-N", { determinationType: "COLLISION_PREVENTABILITY", determinationValue: "NON_PREVENTABLE" }),
      determination("D3", "COL-U", { determinationType: "COLLISION_PREVENTABILITY", determinationValue: "UNABLE_TO_DETERMINE" }),
      determination("D4", "COL-LEGACY", { determinationType: "Collision Preventability", determinationValue: "Preventable" }),
      determination("D5", "COL-ARCH", { determinationType: "COLLISION_PREVENTABILITY", determinationValue: "PREVENTABLE", isArchived: true }),
      // A determination of another type on the same record id must not drive the Collision counters.
      determination("D6", "COL-OTHERTYPE", { determinationType: "ROOT_CAUSE_ANALYSIS", determinationValue: "PREVENTABLE" }),
    ],
  );
  const state = { events: collisions, companyDeterminations: store.companyDeterminations, performanceInvestigations: [], eventRelationships: [], companyActions: [] } as never;
  const result = summarizeCollisionPreventability(collisions, state);
  assert.deepEqual(result.preventable.map((c: { id: string }) => c.id), ["COL-P", "COL-LEGACY"]);
  assert.deepEqual(result.nonPreventable.map((c: { id: string }) => c.id), ["COL-N"]);
  assert.deepEqual(result.undetermined.map((c: { id: string }) => c.id), ["COL-U", "COL-NONE", "COL-ARCH", "COL-OTHERTYPE"]);
  // No double counting: the three buckets partition the collisions.
  assert.equal(result.preventable.length + result.nonPreventable.length + result.undetermined.length, collisions.length);
});
