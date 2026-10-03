import test from "node:test";
import assert from "node:assert/strict";

import {
  createRoadsideViolationCollection,
  createRoadsideViolationItem,
  deriveRoadsideOverallOutcome,
  deriveRoadsideViolationCounts,
  roadsideFindingApplicableTo,
  roadsideFindingOutcome,
  validateRoadsideViolationCollection,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/driver-performance-child-facts.ts";
import {
  LEGACY_ONLY_PERFORMANCE_EVENT_TYPES,
  PERFORMANCE_EVENT_FAMILIES,
  getRoadsideOpenActions,
  initialRoadsideStatus,
  performanceEventFamilyOf,
  performanceEventTitle,
  roadsideDriverStatementState,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/driver-performance-families.ts";

type Collection = NonNullable<Parameters<typeof deriveRoadsideOverallOutcome>[1]>;
const finding = (over: Record<string, unknown> = {}) => createRoadsideViolationItem({ ruleRegulationCode: "393.9", description: "Lamp", subjectType: "DRIVER", oosState: "NO", ...over } as never);
const collection = (...items: ReturnType<typeof finding>[]): Collection => createRoadsideViolationCollection(items, "COMPLETE");
const scope = { inspectionScope: "BOTH", driverInspectionResult: "PASS", vehicleInspectionResult: "PASS" };

// ---------------------------------------------------------------- catalogue

test("agreed families: Cargo Incident, Harsh Driving, Customer Event and HOS / Fatigue keep the underlying distinction as a subtype", () => {
  assert.equal(performanceEventTitle("Cargo Damage"), "Cargo Incident: Damage");
  assert.equal(performanceEventTitle("Cargo Theft"), "Cargo Incident: Theft");
  assert.equal(performanceEventTitle("Harsh Braking"), "Harsh Driving Event: Harsh Braking");
  assert.equal(performanceEventTitle("Harsh Acceleration"), "Harsh Driving Event: Harsh Acceleration");
  assert.equal(performanceEventTitle("Harsh Cornering"), "Harsh Driving Event: Harsh Cornering");
  assert.equal(performanceEventTitle("Customer Complaint"), "Customer Event: Complaint");
  assert.equal(performanceEventTitle("Customer Commendation"), "Customer Event: Commendation");
  assert.equal(performanceEventTitle("Customer-Site Behavior"), "Customer Event: Site Behavior");
  assert.equal(performanceEventTitle("Fatigue Indicator"), "HOS / Fatigue Related: Fatigue Indicator");
  assert.equal(performanceEventFamilyOf("Speeding")?.label, "Speeding", "Speeding stays separate from Harsh Acceleration");
});

test("a stored category belongs to at most one family and Near Miss appears exactly once", () => {
  const all = PERFORMANCE_EVENT_FAMILIES.flatMap((family: { members: Array<{ eventType: string }> }) => family.members.map((member) => member.eventType));
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.filter((type: string) => type === "Near Miss").length, 1);
  for (const kept of ["Collision", "Roadside Inspection", "Speeding", "Following Distance", "Distracted Driving", "Idle Time", "Spill or Release", "Security Incident", "Emergency Event", "Device / Data Integrity", "Equipment Failure / Critical Defect"]) assert.ok(all.includes(kept), kept);
});

test("outcomes/findings/non-events are legacy-only and never also a family member", () => {
  const all = new Set(PERFORMANCE_EVENT_FAMILIES.flatMap((family: { members: Array<{ eventType: string }> }) => family.members.map((member) => member.eventType)));
  for (const legacy of ["Out-of-Service Order", "Warning", "Violation", "Injury", "Safety Observation", "Trip Completion / Service Performance", "Backing", "Stop Sign / Red Light", "Railroad Crossing"]) {
    assert.ok(LEGACY_ONLY_PERFORMANCE_EVENT_TYPES.includes(legacy as never), legacy);
    assert.ok(!all.has(legacy), legacy);
    assert.equal(performanceEventTitle(legacy as never), legacy, "legacy records keep their stored name");
  }
});

test("Route Deviation is a conditional-capability family", () => {
  assert.equal(performanceEventFamilyOf("Route Deviation")?.conditionalCapability, true);
});

// ---------------------------------------------------------------- outcome

test("Overall Outcome precedence: Out of Service > Requires Attention > Warning > Pass", () => {
  assert.equal(deriveRoadsideOverallOutcome({ ...scope, overallOutcome: "PASS" }, collection()), "PASS");
  assert.equal(deriveRoadsideOverallOutcome({ ...scope, overallOutcome: "WARNING" }, collection(finding({ outcome: "WARNING" }))), "WARNING");
  assert.equal(deriveRoadsideOverallOutcome({ ...scope, overallOutcome: "WARNING" }, collection(finding({ outcome: "WARNING" }), finding({ outcome: "REQUIRES_ATTENTION" }))), "REQUIRES_ATTENTION");
  assert.equal(deriveRoadsideOverallOutcome({ ...scope, overallOutcome: "WARNING" }, collection(finding({ outcome: "REQUIRES_ATTENTION" }), finding({ outcome: "OUT_OF_SERVICE", oosState: "YES" }))), "OUT_OF_SERVICE");
});

test("an OOS state alone raises the outcome to Out of Service", () => {
  assert.equal(deriveRoadsideOverallOutcome({ inspectionScope: "DRIVER", driverInspectionResult: "VIOLATIONS_FOUND", driverOOSState: "YES", overallOutcome: "REQUIRES_ATTENTION" }, collection()), "OUT_OF_SERVICE");
});

test("legacy records without an Overall Outcome fact resolve from existing data and are never rewritten", () => {
  const legacyPass = { inspectionScope: "DRIVER", driverInspectionResult: "PASS", inspectionResult: "PASS" };
  assert.equal(deriveRoadsideOverallOutcome(legacyPass, undefined), "PASS");
  assert.equal(deriveRoadsideOverallOutcome({ ...scope, inspectionResult: "VIOLATIONS_FOUND" }, collection(finding())), "REQUIRES_ATTENTION", "a legacy finding with no outcome is a recorded violation");
  assert.equal(deriveRoadsideOverallOutcome({ ...scope }, collection(finding({ oosState: "YES" }))), "OUT_OF_SERVICE");
  const legacyItem = finding();
  assert.equal(legacyItem.facts.outcome, undefined, "legacy shape unchanged");
  assert.equal(roadsideFindingOutcome(legacyItem), "REQUIRES_ATTENTION");
  assert.equal(deriveRoadsideOverallOutcome({}, undefined), "UNKNOWN");
});

test("title reflects Overall Outcome and never the workflow status", () => {
  assert.equal(performanceEventTitle("Roadside Inspection", "Requires Attention"), "Roadside Inspection: Requires Attention");
  assert.equal(performanceEventTitle("Roadside Inspection", "Out of Service"), "Roadside Inspection: Out of Service");
  assert.equal(performanceEventTitle("Roadside Inspection"), "Roadside Inspection");
});

// ---------------------------------------------------------------- findings

test("findings keep Applicable To (Driver / Vehicle / Both) and Demerit Points as child facts; absence is never invented", () => {
  const both = finding({ subjectType: "OTHER", applicableTo: "BOTH", outcome: "WARNING", demeritPoints: 3 });
  const vehicle = finding({ subjectType: "POWER_UNIT", subjectEquipmentId: "RIE-1", applicableTo: "VEHICLE", outcome: "OUT_OF_SERVICE", oosState: "YES" });
  const noPoints = finding({ subjectType: "DRIVER" });
  assert.equal(roadsideFindingApplicableTo(both), "BOTH");
  assert.equal(roadsideFindingApplicableTo(noPoints), "DRIVER");
  assert.equal(roadsideFindingApplicableTo(finding({ subjectType: "OPERATING_CARRIER" })), undefined);
  assert.equal(noPoints.facts.demeritPoints, null, "no forced numeric value");
  const col = collection(both, vehicle, noPoints);
  assert.equal(col.items.length, 3, "multiple findings stay separate child facts");
  assert.deepEqual(validateRoadsideViolationCollection(col), []);
  const counts = deriveRoadsideViolationCounts(col);
  assert.equal(counts.driver, 2, "Both counts toward driver; plain Driver finding too");
  assert.equal(counts.vehicle, 2, "Both counts toward vehicle; vehicle finding too");
});

test("an Out of Service finding outcome cannot coexist with OOS state No", () => {
  const bad = collection(finding({ outcome: "OUT_OF_SERVICE", oosState: "NO" }));
  assert.ok(validateRoadsideViolationCollection(bad).some((message: string) => /Out of Service but OOS state No/.test(message)));
});

// ---------------------------------------------------------------- driver statement + open actions

const stmt = (status: string) => ({ itemId: `RST-${status}`, facts: { status }, evidenceIds: [], observations: [] });
const stmtCollection = (...statuses: string[]) => ({ collectionId: "DRV.PERF.ROADSIDE_INSPECTION.DRIVER_STATEMENTS", collectionVersion: "1.0", itemType: "DRIVER_STATEMENT", completeness: "COMPLETE", items: statuses.map(stmt) }) as never;

test("Driver Statement Required is NOT derived from Overall Outcome (Pass and non-Pass behave identically)", () => {
  for (const overallOutcome of ["PASS", "WARNING", "REQUIRES_ATTENTION", "OUT_OF_SERVICE"]) {
    const state = roadsideDriverStatementState({ childCollections: [] }, { overallOutcome });
    assert.deepEqual(state, { required: false, provided: false }, overallOutcome);
    assert.deepEqual(getRoadsideOpenActions({ childCollections: [] }, { overallOutcome }), [], `${overallOutcome}: a missing statement is not open unless required`);
  }
});

test("a Pass inspection can still require a statement, and a non-Pass can explicitly not require one", () => {
  assert.equal(getRoadsideOpenActions({}, { overallOutcome: "PASS", driverStatementRequired: "YES" }).length, 1);
  assert.equal(getRoadsideOpenActions({}, { overallOutcome: "OUT_OF_SERVICE", driverStatementRequired: "NO" }).length, 0);
});

test("required and provided are separate concepts", () => {
  assert.deepEqual(roadsideDriverStatementState({ childCollections: [stmtCollection("OBTAINED")] }, {}), { required: false, provided: true }, "voluntary statement on any inspection");
  assert.deepEqual(roadsideDriverStatementState({ childCollections: [] }, { driverStatementRequired: "YES" }), { required: true, provided: false });
  assert.deepEqual(roadsideDriverStatementState({ childCollections: [stmtCollection("REQUESTED")] }, {}), { required: true, provided: false }, "a formal request counts as required");
  assert.deepEqual(roadsideDriverStatementState({ childCollections: [stmtCollection("DECLINED")] }, { driverStatementRequired: "YES" }), { required: true, provided: false }, "declined is not provided");
});

test("required-but-missing statement keeps the record Open; nothing outstanding records it Closed", () => {
  const open = getRoadsideOpenActions({ childCollections: [] }, { driverStatementRequired: "YES" });
  assert.equal(initialRoadsideStatus(open), "Open");
  assert.equal(initialRoadsideStatus([]), "Closed");
});

test("a received statement does not close the event while another required action remains", () => {
  const event = { childCollections: [stmtCollection("OBTAINED")], followUpActionRequired: true };
  const actions = getRoadsideOpenActions(event, { driverStatementRequired: "YES" });
  assert.deepEqual(actions.map((action: { key: string }) => action.key), ["FOLLOW_UP"]);
  assert.equal(initialRoadsideStatus(actions), "Open");
  assert.deepEqual(getRoadsideOpenActions({ ...event, followUpActionRequired: false }, { driverStatementRequired: "YES" }), []);
});

test("citations are never a required action: an open Citation does not keep the Roadside Inspection open", () => {
  const event = { childCollections: [], canonicalLinks: [{ entityType: "Citation", recordId: "CIT-1" }] } as never;
  assert.deepEqual(getRoadsideOpenActions(event, {}), []);
});

test("Lane Departure is legacy-only: not offered for new creation, never a family member", () => {
  assert.ok(LEGACY_ONLY_PERFORMANCE_EVENT_TYPES.includes("Lane Departure" as never));
  assert.equal(performanceEventFamilyOf("Lane Departure" as never), undefined);
  assert.equal(performanceEventTitle("Lane Departure" as never), "Lane Departure");
});

test("Pass + Statement Required + no statement provided records Open", () => {
  const facts = { overallOutcome: "PASS", driverStatementRequired: "YES" };
  const actions = getRoadsideOpenActions({ childCollections: [] }, facts);
  assert.deepEqual(actions.map((action: { key: string }) => action.key), ["DRIVER_STATEMENT"]);
  assert.equal(initialRoadsideStatus(actions), "Open");
});

test("Open/Closed depends only on unresolved actions, never on Overall Outcome", () => {
  for (const overallOutcome of ["PASS", "WARNING", "REQUIRES_ATTENTION", "OUT_OF_SERVICE"]) {
    assert.equal(initialRoadsideStatus(getRoadsideOpenActions({ childCollections: [] }, { overallOutcome })), "Closed", overallOutcome + " with nothing outstanding");
    assert.equal(initialRoadsideStatus(getRoadsideOpenActions({ childCollections: [] }, { overallOutcome, driverStatementRequired: "YES" })), "Open", overallOutcome + " with an outstanding statement");
    assert.equal(initialRoadsideStatus(getRoadsideOpenActions({ childCollections: [], followUpActionRequired: true }, { overallOutcome })), "Open", overallOutcome + " with outstanding follow-up");
  }
});

test("PPE / Safety Protocol is legacy-only: not offered for new creation, never a family member", () => {
  assert.ok(LEGACY_ONLY_PERFORMANCE_EVENT_TYPES.includes("PPE / Safety Protocol" as never));
  assert.equal(performanceEventFamilyOf("PPE / Safety Protocol" as never), undefined);
  assert.equal(performanceEventTitle("PPE / Safety Protocol" as never), "PPE / Safety Protocol");
});
