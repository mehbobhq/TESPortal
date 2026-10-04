/* eslint-disable @typescript-eslint/no-explicit-any */
import "../../helpers/register-alias-loader.mjs";
import test, { before } from "node:test";
import assert from "node:assert/strict";

import {
  SPILL_COLLECTION_IDS as CID,
  SPILL_SOURCES,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-spill-taxonomy.ts";
import {
  SPILL_DATA_POINTS as DP,
  SPILL_RESPONSE_FACT_KEYS,
  buildSpillSummary,
  deriveSpillPersonCounts,
  deriveSpillResponseDelays,
  deriveSpillTimingDelays,
  describeLegacySpill,
  describeSpillRelease,
  emptySpillCleanup,
  emptySpillDraft,
  emptySpillFinancial,
  emptySpillMaterial,
  emptySpillMedium,
  emptySpillObligation,
  emptySpillPerson,
  emptySpillQuantity,
  emptySpillStep,
  isLegacySpill,
  isNewTaxonomySpill,
  readSpillAssessments,
  readSpillCleanups,
  readSpillExecutions,
  readSpillFinancial,
  readSpillMaterials,
  readSpillMedia,
  readSpillPersons,
  readSpillQuantities,
  readSpillStatusHistory,
  readSpillTimeline,
  setSpillStatus,
  spillDraftToChildren,
  spillWorkflowProvider,
  upsertSpillChild,
  validateNewSpillRelease,
  validateNewSpillReleaseDetailed,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-spill.ts";
import {
  closePerformanceEventWorkflow,
  setPerformanceInvestigationRequirement,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-workflow.ts";
import {
  deriveEventWorkflow,
  getWorkflowProvidersForEventType,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-workflow-registry.ts";
import {
  CONTRIBUTING_FACTOR_DOMAINS,
  completePerformanceInvestigation,
  getInvestigationsForEvent,
  openPerformanceInvestigation,
  recordPerformanceDetermination,
  setInvestigationContributingFactors,
  updatePerformanceInvestigation,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-investigation.ts";
import {
  createPerformanceEventRelationship,
  getEventRelationships,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-event-relationships.ts";

let dd: any;
let schema: any;
before(async () => {
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  dd = await import("../../../lib/driver-data.ts");
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  schema = await import("../../../lib/driver-performance-schema.ts");
});

const COMPANY = "C-SPILL";
const STAMP = "2026-09-28T12:00:00.000Z";
const VEHICLES = [{ id: "VEH-1", label: "Unit 101" }, { id: "TRL-1", label: "Unit T-9" }];
const fact = (dataPointId: string, value: string) => ({ dataPointId, value, valueType: "string" });
const mat = (patch: Record<string, unknown> = {}) => ({ ...emptySpillMaterial(), itemId: "MAT-1", category: "FUEL", description: "Diesel fuel", identificationStatus: "REPORTED", materialSource: "DRIVER_REPORT", ...patch });
const qty = (patch: Record<string, unknown> = {}) => ({ ...emptySpillQuantity(), itemId: "QTY-1", dimension: "RELEASED", value: "100", unit: "LITRES", status: "ESTIMATED", method: "VISUAL_ESTIMATE", ...patch });
const person = (patch: Record<string, unknown> = {}) => ({ ...emptySpillPerson(), itemId: "PER-1", role: "FACILITY_WORKER", exposureStatus: "EXPOSED", exposureRoute: "INHALATION", ...patch });
const medium = (patch: Record<string, unknown> = {}) => ({ ...emptySpillMedium(), itemId: "MED-1", medium: "STORM_DRAIN", impactStatus: "SUSPECTED", ...patch });
const step = (ordinal: number, patch: Record<string, unknown> = {}) => ({ ...emptySpillStep(ordinal), itemId: `STP-${ordinal}`, action: "RELEASE_DISCOVERED", ...patch });
const cleanup = (patch: Record<string, unknown> = {}) => ({ ...emptySpillCleanup(), itemId: "CLN-1", ...patch });
const obligation = (patch: Record<string, unknown> = {}) => ({ ...emptySpillObligation(), assessmentId: "ASM-1", executionId: "EXE-1", jurisdiction: "Alberta", authority: "Provincial regulator", assessmentStatus: "REQUIRED", ...patch });

function newSpill(opts: { facts?: Array<[string, string]>; draft?: Record<string, unknown>; extra?: Record<string, unknown>; now?: string } = {}): any {
  const d = { ...emptySpillDraft(), powerUnitId: "VEH-1", materials: [mat()], ...(opts.draft || {}) } as any;
  const children = spillDraftToChildren(d, VEHICLES, { driverMasterId: "DRV-1", now: opts.now || STAMP });
  const base: Array<[string, string]> = [[DP.releaseDetermination, "SUSPECTED"], [DP.releaseCondition, "ACTIVE"], ...(opts.facts || [])];
  const facts = [...new Map(base).entries()].map(([id, value]) => fact(id, value));
  return {
    id: "SPL-1", eventType: "Spill or Release", companyId: COMPANY, driverMasterId: "DRV-1", createdAt: STAMP,
    eventDate: "2026-09-28", eventTime: "14:05", occurrencePrecision: children.occurrencePrecision, location: "Hwy 2", stateProvince: "AB", country: "Canada",
    vehicleId: children.vehicleId, canonicalLinks: children.canonicalLinks, structuredEventFacts: facts, childCollections: children.collections,
    provenance: { sourceType: "SOURCE_FACT", source: "Driver Report" }, evidenceIds: ["EV-1", "EV-2"],
    ...(opts.extra || {}),
  };
}
const messages = (event: any) => validateNewSpillRelease(event);
const state = (events: any[], extra: Record<string, unknown> = {}): any => ({ events, performanceInvestigations: [], companyActions: [], companyDeterminations: [], eventRelationships: [], ...extra });
const labels = (workflow: { reasons: Array<{ label: string }> }) => workflow.reasons.map((reason) => reason.label);
const provs = () => getWorkflowProvidersForEventType("Spill or Release");
const flow = (event: any, extra: Record<string, unknown> = {}) => deriveEventWorkflow(event, state([event], extra));

const VEH_KEY = `tes_company_vehicles_${COMPANY}`;
const seedVehicles = () => localStorage.setItem(VEH_KEY, JSON.stringify({ version: 1, vehicles: [{ id: "VEH-1", unitNumber: "101", equipmentType: "Tractor" }, { id: "TRL-1", unitNumber: "T-9", equipmentType: "Trailer - Dry Van" }] }));
const payloadFrom = (event: any) => { const { id: _i, companyId: _c, driverMasterId: _d, createdAt: _t, ...rest } = event; return { ...rest, severity: "Not Applicable", status: "Not Applicable", summary: "Spill", description: "d", chronology: [], linkedRecords: [] }; };
const apply = (event: any, collectionId: string, facts: Record<string, any>, extra: Record<string, unknown> = {}) => upsertSpillChild(event, { collectionId, facts, ...extra });

// 1 ---------------------------------------------------------------------------
test("1. the existing exact EventType is reused; no replacement type exists and Spill remains a recordable top-level event", () => {
  const definition = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Spill or Release"];
  assert.equal(definition.value, "Spill or Release");
  assert.equal(definition.code, "SPILL_RELEASE");
  assert.equal(schema.PERFORMANCE_CATEGORY_OWNERSHIP["Spill or Release"], "RECORDABLE_EVENT");
  assert.equal(newSpill().eventType, "Spill or Release");
  assert.ok(!Object.keys(schema.PERFORMANCE_CATEGORY_OWNERSHIP).some((type) => /^Spill( \/|-)/.test(type) && type !== "Spill or Release"), "no replacement Spill type");
  assert.deepEqual(definition.sources, SPILL_SOURCES.map((item: any) => item.value));
  assert.ok(definition.policy.steps.map((entry: any) => entry.key).includes("SPILL_REGULATORY"));
});

test("2. a new Spill / Release saves through addPerformanceEvent and every child structure survives a reload", () => {
  localStorage.clear(); seedVehicles();
  const event = newSpill({
    facts: [[DP.releaseForm, "LEAK"], [DP.releaseMechanism, "HOSE_FAILURE"], [DP.sourceCategory, "VEHICLE_SYSTEM"], [DP.sourceSubsystem, "Fuel System"], [DP.sourceComponent, "Fuel Line"], [DP.cleanupStatus, "NOT_STARTED"], [DP.loadReference, "LD-7731"]],
    draft: {
      trailerIds: ["TRL-1"], quantities: [qty()], persons: [person()], media: [medium()], steps: [step(1)], cleanups: [cleanup({ vendor: "Clean Co" })], obligations: [obligation({ notificationRequired: "YES", notificationStatus: "NOT_STARTED" })],
      financial: { ...emptySpillFinancial(), cleanupCost: "1500" },
    },
  });
  const saved = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(event));
  const loaded = dd.loadCompanyDriverStore(COMPANY).events.find((entry: any) => entry.id === saved.id);
  assert.equal(loaded.eventType, "Spill or Release");
  assert.equal(isNewTaxonomySpill(loaded), true);
  assert.equal(readSpillMaterials(loaded).length, 1);
  assert.equal(readSpillQuantities(loaded)[0].value, 100);
  assert.equal(readSpillPersons(loaded)[0].exposureStatus, "EXPOSED");
  assert.equal(readSpillMedia(loaded)[0].impactStatus, "SUSPECTED");
  assert.equal(readSpillTimeline(loaded)[0].action, "RELEASE_DISCOVERED");
  assert.equal(readSpillCleanups(loaded)[0].vendor, "Clean Co");
  assert.equal(readSpillAssessments(loaded)[0].assessmentStatus, "REQUIRED");
  assert.equal(readSpillExecutions(loaded)[0].notificationRequired, "YES");
  assert.equal(readSpillFinancial(loaded)?.cleanupCost?.currencyCode, "CAD");
  assert.equal(describeSpillRelease(loaded).release.sourceCategory, "Vehicle System");
  assert.equal(describeSpillRelease(loaded).operations.find((row: any) => row.label === "Load Reference")?.value, "LD-7731");
});

test("2b. required parent fields are enforced individually; time is required only when the occurrence is exact", () => {
  assert.deepEqual(messages(newSpill()), []);
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["date", { eventDate: "" }, /Event Date/], ["exact time", { eventTime: "" }, /Event Time is required when the occurrence is exact/], ["driver", { driverMasterId: "" }, /Driver/], ["location", { location: "" }, /Location/], ["country", { country: "" }, /Country/],
    ["source", { provenance: { sourceType: "SOURCE_FACT", source: "Customer" } }, /Source/], ["precision", { occurrencePrecision: "SOMETIME" }, /precision/],
  ];
  for (const [name, extra, pattern] of cases) assert.match(messages(newSpill({ extra })).join(" "), pattern, name);
  assert.deepEqual(messages(newSpill({ draft: { precision: "DATE_ONLY" }, extra: { eventTime: "" } })), [], "date-only precision needs no time");
  assert.deepEqual(messages(newSpill({ draft: { precision: "UNKNOWN" }, extra: { eventTime: "" } })), []);
  const noDetermination = newSpill(); noDetermination.structuredEventFacts = noDetermination.structuredEventFacts.filter((entry: any) => entry.dataPointId !== DP.releaseDetermination);
  assert.match(messages(noDetermination).join(" "), /Release Determination is required/);
  const noCondition = newSpill(); noCondition.structuredEventFacts = noCondition.structuredEventFacts.filter((entry: any) => entry.dataPointId !== DP.releaseCondition);
  assert.match(messages(noCondition).join(" "), /Release Condition is required/);
  assert.equal(validateNewSpillReleaseDetailed(noCondition).find((i: any) => /Release Condition/.test(i.message))?.step, "SPILL_RELEASE");
});

// 3-7 -------------------------------------------------------------------------
test("3. an unknown material is valid and recordable immediately; no material at all is also valid", () => {
  const unknown = newSpill({ draft: { materials: [mat({ category: "UNKNOWN", description: "Unknown substance leaking from tote", identificationStatus: "UNKNOWN", materialSource: "" })] } });
  assert.deepEqual(messages(unknown), []);
  const described = describeSpillRelease(unknown).materials[0];
  assert.equal(described.status, "Unknown");
  assert.equal(described.identificationPending, true);
  assert.equal(described.unId, undefined);
  assert.deepEqual(messages(newSpill({ draft: { materials: [] } })), [], "no minimum material count");
  assert.match(messages(newSpill({ draft: { materials: [mat({ description: "", category: "" })] } })).join(" "), /Describe each material/);
  assert.match(messages(newSpill({ draft: { materials: [mat({ identificationStatus: "" })] } })).join(" "), /identification status/);
});

test("4. Pending Identification is valid and may not carry a fake regulatory identity", () => {
  const pending = newSpill({ draft: { materials: [mat({ category: "CHEMICAL", description: "Drum labelled 'corrosive'", identificationStatus: "PENDING_IDENTIFICATION", materialSource: "LABEL" })] } });
  assert.deepEqual(messages(pending), []);
  assert.equal(describeSpillRelease(pending).materials[0].status, "Pending Identification");
  for (const key of ["properShippingName", "unId", "hazardClass", "packingGroup"]) {
    const value = key === "packingGroup" ? "II" : "X";
    for (const status of ["UNKNOWN", "PENDING_IDENTIFICATION"]) assert.match(messages(newSpill({ draft: { materials: [mat({ identificationStatus: status, [key]: value })] } })).join(" "), /cannot carry a proper shipping name/, `${status}/${key}`);
  }
});

test("5. one event can involve several materials, each with its own stable id", () => {
  const event = newSpill({ draft: { materials: [mat({ itemId: "MAT-A" }), mat({ itemId: "MAT-B", category: "COOLANT", description: "Coolant" })] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(readSpillMaterials(event).map((entry: any) => entry.itemId), ["MAT-A", "MAT-B"]);
  assert.match(messages(newSpill({ draft: { materials: [mat({ itemId: "MAT-A" }), mat({ itemId: "MAT-A" })] } })).join(" "), /Material ids must be present and unique/);
});

test("6. material provenance is preserved: identification status and source are separate controlled facts", () => {
  assert.match(messages(newSpill({ draft: { materials: [mat({ identificationStatus: "CONFIRMED", materialSource: "" })] } })).join(" "), /Confirmed material identification needs its source/);
  for (const source of ["SHIPPING_PAPER", "SDS", "LABEL", "PLACARD", "DRIVER_REPORT", "SHIPPER", "RECEIVER", "EMERGENCY_RESPONDER", "LABORATORY", "OTHER"]) assert.deepEqual(messages(newSpill({ draft: { materials: [mat({ identificationStatus: "CONFIRMED", materialSource: source })] } })), [], source);
  assert.match(messages(newSpill({ draft: { materials: [mat({ materialSource: "RUMOUR" })] } })).join(" "), /Material source must be a controlled value/);
  assert.match(messages(newSpill({ draft: { materials: [mat({ identificationStatus: "MAYBE" })] } })).join(" "), /Identification status must be a controlled value/);
  for (const status of ["CONFIRMED", "REPORTED", "ESTIMATED", "UNKNOWN", "PENDING_IDENTIFICATION"]) assert.deepEqual(messages(newSpill({ draft: { materials: [mat({ identificationStatus: status, materialSource: "SDS" })] } })), [], status);
  const reported = describeSpillRelease(newSpill({ draft: { materials: [mat({ identificationStatus: "REPORTED", materialSource: "DRIVER_REPORT" })] } })).materials[0];
  assert.deepEqual([reported.status, reported.source], ["Reported", "Driver Report"], "a reported observation is not presented as confirmed identity");
});

test("7. hazmat identity fields are separate from the operational category and never derived from it", () => {
  const category = newSpill({ draft: { materials: [mat({ category: "FUEL", description: "Diesel" })] } });
  const view = describeSpillRelease(category).materials[0];
  assert.equal(view.category, "Fuel");
  assert.deepEqual([view.properShippingName, view.unId, view.hazardClass, view.packingGroup], [undefined, undefined, undefined, undefined], "category does not populate regulatory identity");
  const identified = newSpill({ draft: { materials: [mat({ category: "FUEL", identificationStatus: "CONFIRMED", materialSource: "SHIPPING_PAPER", properShippingName: "Diesel fuel", technicalName: "Gas oil", unId: "UN1202", hazardClass: "3", packingGroup: "III", physicalState: "LIQUID", sdsStatus: "AVAILABLE", sdsReference: "SDS-77", placardRequired: "YES", placardDisplayed: "YES", shippingPapersStatus: "AVAILABLE" })] } });
  assert.deepEqual(messages(identified), []);
  const full = describeSpillRelease(identified).materials[0];
  assert.deepEqual([full.category, full.properShippingName, full.technicalName, full.unId, full.hazardClass, full.packingGroup, full.physicalState], ["Fuel", "Diesel fuel", "Gas oil", "UN1202", "3", "III", "Liquid"]);
  assert.deepEqual([full.sds, full.placardRequired, full.placardDisplayed, full.shippingPapers], ["Available - SDS-77", "Yes", "Yes", "Available"]);
  const item = identified.childCollections.find((c: any) => c.collectionId === CID.MATERIALS).items[0];
  assert.ok("category" in item.facts && "properShippingName" in item.facts && "unId" in item.facts, "stored as distinct facts");
  assert.match(messages(newSpill({ draft: { materials: [mat({ packingGroup: "IV" })] } })).join(" "), /Packing group must be a controlled value/);
  assert.match(messages(newSpill({ draft: { materials: [mat({ placardRequired: "MAYBE" })] } })).join(" "), /Placard required must be a controlled value/);
});

// 8-13 ------------------------------------------------------------------------
test("8-9. release determination: Suspected and Confirmed are distinct canonical values", () => {
  for (const value of ["SUSPECTED", "CONFIRMED", "UNKNOWN"]) assert.deepEqual(messages(newSpill({ facts: [[DP.releaseDetermination, value]] })), [], value);
  assert.equal(describeSpillRelease(newSpill({ facts: [[DP.releaseDetermination, "SUSPECTED"]] })).release.determination, "Suspected");
  assert.equal(describeSpillRelease(newSpill({ facts: [[DP.releaseDetermination, "CONFIRMED"]] })).release.determination, "Confirmed");
  assert.match(messages(newSpill({ facts: [[DP.releaseDetermination, "PROBABLE"]] })).join(" "), /Release Determination must be a controlled value/);
});

test("10. release condition is independent of the determination", () => {
  for (const determination of ["SUSPECTED", "CONFIRMED", "UNKNOWN"]) for (const condition of ["ACTIVE", "CONTAINED", "STOPPED", "UNKNOWN"]) assert.deepEqual(messages(newSpill({ facts: [[DP.releaseDetermination, determination], [DP.releaseCondition, condition]] })), [], `${determination}/${condition}`);
  assert.match(messages(newSpill({ facts: [[DP.releaseCondition, "LEAKING"]] })).join(" "), /Release Condition must be a controlled value/);
  const event = newSpill({ facts: [[DP.releaseDetermination, "SUSPECTED"], [DP.releaseCondition, "ACTIVE"]] });
  const changed = setSpillStatus(event, { field: "releaseCondition", to: "STOPPED", changedBy: "SM", at: "2026-09-28T15:00:00.000Z" });
  const view = describeSpillRelease(changed).release;
  assert.deepEqual([view.determination, view.condition], ["Suspected", "Stopped"], "changing the condition leaves the determination alone");
  assert.deepEqual(readSpillStatusHistory(changed).map((entry: any) => [entry.field, entry.from, entry.to]), [["releaseCondition", "ACTIVE", "STOPPED"]], "the prior value is preserved in history");
});

test("11. cleanup status is independent of the release condition and is not required at first report", () => {
  for (const condition of ["ACTIVE", "CONTAINED", "STOPPED", "UNKNOWN"]) for (const cleanupStatus of ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "VERIFICATION_PENDING"]) assert.deepEqual(messages(newSpill({ facts: [[DP.releaseCondition, condition], [DP.cleanupStatus, cleanupStatus]] })), [], `${condition}/${cleanupStatus}`);
  assert.deepEqual(messages(newSpill()), [], "no cleanup status at first report");
  assert.equal(describeSpillRelease(newSpill()).release.cleanupStatus, undefined, "an unrecorded cleanup status is not presented as Not Started");
  assert.match(messages(newSpill({ facts: [[DP.cleanupStatus, "DONE"]] })).join(" "), /Cleanup Status must be a controlled value/);
  const active = newSpill({ facts: [[DP.releaseCondition, "ACTIVE"], [DP.cleanupStatus, "COMPLETE"]] });
  assert.deepEqual([describeSpillRelease(active).release.condition, describeSpillRelease(active).release.cleanupStatus], ["Active", "Complete"]);
});

test("12. release form is a controlled fact describing how the release manifested", () => {
  for (const form of ["LEAK", "SEEPAGE", "DRIP", "SPILL", "SPRAY", "MIST", "VAPOR", "GAS", "RUPTURE", "UNKNOWN"]) assert.deepEqual(messages(newSpill({ facts: [[DP.releaseForm, form]] })), [], form);
  assert.match(messages(newSpill({ facts: [[DP.releaseForm, "GUSH"]] })).join(" "), /Release Form must be a controlled value/);
  assert.equal(describeSpillRelease(newSpill({ facts: [[DP.releaseForm, "SPRAY"]] })).release.form, "Spray");
});

test("13. release mechanism is occurrence information: it never becomes a root cause, investigation or determination", () => {
  for (const mechanism of ["CONTAINER_FAILURE", "VALVE_FAILURE", "FITTING_FAILURE", "HOSE_FAILURE", "OVERFILL", "COLLISION_DAMAGE", "FIRE_DAMAGE", "HANDLING_DAMAGE", "EQUIPMENT_FAILURE", "UNKNOWN"]) assert.deepEqual(messages(newSpill({ facts: [[DP.releaseMechanism, mechanism]] })), [], mechanism);
  assert.match(messages(newSpill({ facts: [[DP.releaseMechanism, "OTHER"]] })).join(" "), /Describe the Other release mechanism/);
  assert.equal(describeSpillRelease(newSpill({ facts: [[DP.releaseMechanism, "OTHER"], [DP.releaseMechanismOther, "Cracked tote"]] })).release.mechanism, "Other: Cracked tote");
  assert.match(messages(newSpill({ facts: [[DP.releaseMechanism, "HOSE_FAILURE"], [DP.releaseMechanismOther, "x"]] })).join(" "), /belongs only to the Other mechanism/);
  assert.match(messages(newSpill({ facts: [[DP.releaseMechanism, "MAINTENANCE_FAILURE"]] })).join(" "), /Release Mechanism must be a controlled value/);
  const event = newSpill({ facts: [[DP.releaseMechanism, "HOSE_FAILURE"]] });
  const s = state([event]);
  assert.deepEqual(getInvestigationsForEvent(s, "SPL-1"), [], "recording a mechanism creates no investigation");
  assert.deepEqual(s.companyDeterminations, [], "and no root-cause determination");
  assert.equal(flow(event).state, "NOT_REQUIRED");
  const opened = openPerformanceInvestigation(s, { eventId: "SPL-1", openedBy: "SM" });
  const root = recordPerformanceDetermination(opened.state, { investigationId: opened.investigation.id, assessment: { subject: "ROOT_CAUSE", category: "Maintenance", finding: "Hose deterioration", status: "DETERMINED", role: "PRIMARY" }, determinedBy: "SM", determinationDate: "2026-09-30" });
  assert.equal(root.state.companyDeterminations.length, 1, "the root cause lives in the common engine");
  assert.equal(describeSpillRelease(event).release.mechanism, "Hose Failure", "the occurrence fact is unchanged by the later determination");
});

// 14-16 -----------------------------------------------------------------------
test("14. the canonical Power Unit link is stored; an unknown vehicle is rejected by the data layer", () => {
  localStorage.clear(); seedVehicles();
  const event = newSpill();
  assert.deepEqual(event.canonicalLinks.map((link: any) => [link.entityType, link.recordId, link.relationshipKey, link.source]), [["Vehicle", "VEH-1", "vehicle", "CANONICAL_STORE"]]);
  const saved = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(event));
  assert.equal(dd.loadCompanyDriverStore(COMPANY).events.find((entry: any) => entry.id === saved.id).vehicleId, "VEH-1");
  assert.equal(describeSpillRelease(saved).release.powerUnit, "Unit 101");
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newSpill({ draft: { powerUnitId: "VEH-GHOST" } }))), /does not exist in the company Vehicle store/);
});

test("15. trailers are optional and the Power Unit itself is optional (a release can involve a package or a facility asset)", () => {
  assert.deepEqual(messages(newSpill({ draft: { powerUnitId: "", trailerIds: [] } })), []);
  const withTrailer = newSpill({ draft: { trailerIds: ["TRL-1"] } });
  assert.deepEqual(withTrailer.canonicalLinks.map((link: any) => [link.entityType, link.relationshipKey]), [["Vehicle", "vehicle"], ["Trailer", "trailer"]]);
  assert.equal(describeSpillRelease(withTrailer).release.trailers, "Unit T-9");
  assert.equal(describeSpillRelease(newSpill({ draft: { powerUnitId: "" } })).release.powerUnit, undefined, "no fake equipment is created");
  const definition = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Spill or Release"];
  assert.deepEqual(definition.relationships.map((entry: any) => [entry.key, entry.entityType, entry.applicability[0].state]), [["vehicle", "Vehicle", "OPTIONAL"], ["trailer", "Trailer", "OPTIONAL"]]);
});

test("16. subsystem and component are free text on the event; no canonical equipment or component entity is fabricated", () => {
  const event = newSpill({ facts: [[DP.sourceCategory, "VEHICLE_SYSTEM"], [DP.sourceSubsystem, "Fuel System"], [DP.sourceComponent, "Fuel Line"]] });
  assert.deepEqual([describeSpillRelease(event).release.subsystem, describeSpillRelease(event).release.component], ["Fuel System", "Fuel Line"]);
  assert.deepEqual([...new Set(event.canonicalLinks.map((link: any) => link.entityType))].sort(), ["Vehicle"], "only canonical Vehicle / Trailer links exist");
  for (const category of ["CARGO_PACKAGE", "CARGO_TANK_BULK", "TRAILER_BODY", "REEFER_UNIT", "VEHICLE_SYSTEM", "LOADING_UNLOADING_EQUIPMENT", "CUSTOMER_FACILITY_EQUIPMENT", "OTHER", "UNKNOWN"]) assert.deepEqual(messages(newSpill({ facts: [[DP.sourceCategory, category]], draft: { powerUnitId: "" } })), [], category);
  assert.match(messages(newSpill({ facts: [[DP.sourceCategory, "SPACESHIP"]] })).join(" "), /Release source category must be a controlled value/);
});

// 17-19 -----------------------------------------------------------------------
test("17. an unknown quantity is valid and unknown is never zero", () => {
  assert.deepEqual(messages(newSpill({ draft: { quantities: [qty({ value: "", unit: "", status: "UNKNOWN", method: "UNKNOWN", notes: "Large diesel leak - quantity unknown" })] } })), []);
  assert.deepEqual(messages(newSpill({ draft: { quantities: [] } })), [], "no quantity record at all is also valid");
  const unknown = newSpill({ draft: { quantities: [qty({ value: "", unit: "", status: "UNKNOWN" })] } });
  const stored = unknown.childCollections.find((c: any) => c.collectionId === CID.QUANTITIES).items[0];
  assert.equal(stored.facts.value, null, "unknown is null, not 0");
  assert.equal(readSpillQuantities(unknown)[0].value, undefined);
  const view = describeSpillRelease(unknown);
  assert.equal(view.quantities[0].amount, "Not established");
  assert.equal(view.releasedQuantityEstablished, false);
  const zero = newSpill({ draft: { quantities: [qty({ value: "0", status: "MEASURED" })] } });
  assert.deepEqual(messages(zero), [], "an explicit zero is a real measurement");
  assert.equal(readSpillQuantities(zero)[0].value, 0);
  assert.equal(describeSpillRelease(zero).releasedQuantityEstablished, true);
});

test("18. an estimated released quantity keeps its unit, method and certainty", () => {
  const event = newSpill({ draft: { quantities: [qty({ value: "200", unit: "LITRES", status: "ESTIMATED", method: "VISUAL_ESTIMATE" })] } });
  assert.deepEqual(messages(event), []);
  const view = describeSpillRelease(event).quantities[0];
  assert.deepEqual([view.type, view.amount, view.status, view.method], ["Quantity Released", "200 Litres", "Estimated", "Visual estimate"]);
  assert.match(messages(newSpill({ draft: { quantities: [qty({ unit: "" })] } })).join(" "), /needs a unit/);
  assert.match(messages(newSpill({ draft: { quantities: [qty({ status: "" })] } })).join(" "), /needs its status/);
  assert.match(messages(newSpill({ draft: { quantities: [qty({ value: "-1" })] } })).join(" "), /zero or greater/);
  assert.match(messages(newSpill({ draft: { quantities: [qty({ value: "abc" })] } })).join(" "), /zero or greater/);
  assert.match(messages(newSpill({ draft: { quantities: [qty({ unit: "BUCKETS" })] } })).join(" "), /Quantity unit must be a controlled value/);
  assert.match(messages(newSpill({ draft: { quantities: [qty({ method: "GUESS" })] } })).join(" "), /Estimation method must be a controlled value/);
  assert.match(messages(newSpill({ draft: { quantities: [qty({ status: "UNKNOWN" })] } })).join(" "), /cannot have a value and an Unknown status/);
});

test("19. involved / released / recovered / disposed / remaining are distinct; reconciliation is checked only when the facts support it", () => {
  const all = newSpill({ draft: { quantities: [
    qty({ itemId: "Q1", dimension: "INVOLVED", value: "500", status: "REPORTED" }), qty({ itemId: "Q2", dimension: "RELEASED", value: "100", status: "MEASURED" }), qty({ itemId: "Q3", dimension: "RECOVERED", value: "40", status: "MEASURED" }),
    qty({ itemId: "Q4", dimension: "DISPOSED", value: "10", status: "MEASURED" }), qty({ itemId: "Q5", dimension: "REMAINING", value: "5", status: "ESTIMATED" }),
  ] } });
  assert.deepEqual(messages(all), [], "released does NOT have to equal recovered + disposed + remaining");
  assert.deepEqual(readSpillQuantities(all).map((entry: any) => entry.dimension), ["INVOLVED", "RELEASED", "RECOVERED", "DISPOSED", "REMAINING"]);
  const measured = (patch: Record<string, unknown>) => newSpill({ draft: { quantities: [qty({ itemId: "Q2", status: "MEASURED" }), qty({ itemId: "Q3", dimension: "RECOVERED", status: "MEASURED", ...patch })] } });
  assert.match(messages(measured({ value: "150" })).join(" "), /recovered quantity cannot exceed the released quantity/);
  assert.deepEqual(messages(measured({ value: "150", unit: "KG" })), [], "different units are not comparable");
  assert.deepEqual(messages(newSpill({ draft: { quantities: [qty({ itemId: "Q2", status: "ESTIMATED" }), qty({ itemId: "Q3", dimension: "RECOVERED", status: "ESTIMATED", value: "150" })] } })), [], "estimates are never policed");
  assert.deepEqual(messages(newSpill({ draft: { quantities: [qty({ itemId: "Q3", dimension: "RECOVERED", status: "MEASURED", value: "150" })] } })), [], "nothing to compare without a released quantity");
  assert.match(messages(newSpill({ draft: { quantities: [qty({ itemId: "Q1" }), qty({ itemId: "Q2" })] } })).join(" "), /once per material/);
  assert.match(messages(newSpill({ draft: { quantities: [qty({ materialId: "MAT-GHOST" })] } })).join(" "), /references a material that does not exist/);
  assert.deepEqual(messages(newSpill({ draft: { materials: [mat({ itemId: "MAT-A" }), mat({ itemId: "MAT-B" })], quantities: [qty({ itemId: "Q1", materialId: "MAT-A" }), qty({ itemId: "Q2", materialId: "MAT-B" })] } })), [], "one released quantity per material");
  assert.ok(!JSON.stringify(all.structuredEventFacts).includes("total"), "no authoritative total is stored");
});

// 20 --------------------------------------------------------------------------
test("20. shipment and operations references stay free text; no Shipment / Trip / Customer entity or canonical link is created", () => {
  const event = newSpill({ facts: [[DP.loadReference, "LD-1"], [DP.bolPro, "BOL-9"], [DP.shipmentReference, "SHP-4"], [DP.customerName, "ACME"], [DP.shipperName, "Shipper Co"], [DP.receiverName, "Receiver Co"], [DP.origin, "Calgary"], [DP.destination, "Edmonton"], [DP.facilitySite, "Dock 4"], [DP.routeReference, "Hwy 2 N"], [DP.operatingStage, "Unloading"]] });
  assert.equal(describeSpillRelease(event).operations.length, 11);
  assert.ok(event.structuredEventFacts.filter((entry: any) => [DP.customerName, DP.shipperName, DP.loadReference].includes(entry.dataPointId)).every((entry: any) => typeof entry.value === "string"));
  assert.deepEqual([...new Set(event.canonicalLinks.map((link: any) => link.entityType))], ["Vehicle"]);
  assert.ok(!event.operationalReferences, "no operational reference / fake id was populated");
  assert.equal(describeSpillRelease(newSpill()).operations.length, 0);
});

// 21-25 -----------------------------------------------------------------------
test("21. a person exposure record keeps exposure, route, medical facts and an access classification", () => {
  const event = newSpill({ draft: { persons: [person({ symptomsReported: "YES", firstAid: "YES", medicalEvaluation: "AT_FACILITY", transported: "YES", hospitalized: "NO", fatality: "NO", accessClassification: "RESTRICTED_MEDICAL", evidenceIds: ["EV-1"] })] } });
  assert.deepEqual(messages(event), []);
  const view = describeSpillRelease(event).persons[0];
  assert.deepEqual([view.role, view.exposure, view.route, view.symptoms, view.medical, view.transported, view.access], ["Facility worker", "Exposed", "Inhalation", "Yes", "Evaluated at a facility", "Yes", "Restricted - medical"]);
  assert.match(messages(newSpill({ draft: { persons: [person({ symptomsReported: "YES" })] } })).join(" "), /requires an access classification/);
  assert.deepEqual(messages(newSpill({ draft: { persons: [person({ symptomsReported: "UNKNOWN" })] } })), [], "Unknown medical information needs no classification");
  assert.match(messages(newSpill({ draft: { persons: [person({ role: "" })] } })).join(" "), /needs a role/);
  assert.match(messages(newSpill({ draft: { persons: [person({ exposureStatus: "SOMEWHAT" })] } })).join(" "), /Exposure status must be a controlled value/);
  assert.match(messages(newSpill({ draft: { persons: [person({ itemId: "P" }), person({ itemId: "P" })] } })).join(" "), /Person ids must be present and unique/);
  const driver = newSpill({ draft: { persons: [person({ role: "CARRIER_DRIVER", isEventDriver: true })] } });
  assert.equal(readSpillPersons(driver)[0].linkedDriverMasterId, "DRV-1", "the canonical driver reference is used only where genuinely available");
  assert.match(messages(newSpill({ draft: { persons: [person({ role: "FACILITY_WORKER", isEventDriver: true })] } })).join(" "), /Only a carrier driver/);
  assert.equal(readSpillPersons(newSpill({ draft: { persons: [person()] } }))[0].linkedDriverMasterId, "", "no invented person reference");
});

test("22. person counts are DERIVED from person records; no editable duplicate total is stored", () => {
  assert.equal(deriveSpillPersonCounts(newSpill()), undefined, "no person records, no counts");
  const event = newSpill({ draft: { persons: [
    person({ itemId: "A", exposureStatus: "EXPOSED", transported: "YES", symptomsReported: "YES", accessClassification: "RESTRICTED_MEDICAL" }), person({ itemId: "B", exposureStatus: "SUSPECTED_EXPOSURE" }),
    person({ itemId: "C", exposureStatus: "EXPOSED", hospitalized: "YES", fatality: "YES", accessClassification: "RESTRICTED_MEDICAL" }), person({ itemId: "D", exposureStatus: "NOT_EXPOSED" }),
  ] } });
  assert.deepEqual(deriveSpillPersonCounts(event), { recorded: 4, exposed: 2, withSymptoms: 1, injured: 0, transported: 1, hospitalized: 1, fatalities: 1 });
  assert.ok(!JSON.stringify(event).match(/peopleExposed|totalExposed|personCount|fatalityCount/i), "no stored total");
  assert.deepEqual(deriveSpillPersonCounts(setSpillStatus(event, { field: "releaseCondition", to: "STOPPED", changedBy: "SM" })), deriveSpillPersonCounts(event));
});

test("23. environmental media: a confirmed impact is its own record per medium", () => {
  const event = newSpill({ draft: { media: [medium({ itemId: "M1", medium: "SOIL", impactStatus: "CONFIRMED", note: "Staining observed" }), medium({ itemId: "M2", medium: "ROADWAY", impactStatus: "NOT_OBSERVED" })] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(describeSpillRelease(event).media.map((entry: any) => [entry.medium, entry.status]), [["Soil", "Confirmed"], ["Roadway", "Not Observed"]]);
  for (const mediumValue of ["ROADWAY", "SOIL", "STORM_DRAIN", "SURFACE_WATER", "GROUNDWATER", "AIR", "VEGETATION", "SENSITIVE_AREA", "OTHER"]) assert.deepEqual(messages(newSpill({ draft: { media: [medium({ medium: mediumValue })] } })), [], mediumValue);
  assert.match(messages(newSpill({ draft: { media: [medium({ medium: "SOIL" }), medium({ itemId: "MED-2", medium: "SOIL" })] } })).join(" "), /Each environmental medium is recorded once/);
  assert.match(messages(newSpill({ draft: { media: [medium({ itemId: "X" }), medium({ itemId: "X", medium: "AIR" })] } })).join(" "), /ids must be present and unique/);
  assert.match(messages(newSpill({ draft: { media: [medium({ medium: "MOON" })] } })).join(" "), /Environmental medium must be a controlled value/);
  assert.match(messages(newSpill({ draft: { media: [medium({ impactStatus: "" })] } })).join(" "), /needs an impact status/);
});

test("24. a suspected environmental impact stays suspected and unknown stays unknown", () => {
  const event = newSpill({ draft: { media: [medium({ itemId: "M1", medium: "STORM_DRAIN", impactStatus: "SUSPECTED" }), medium({ itemId: "M2", medium: "GROUNDWATER", impactStatus: "UNKNOWN" })] } });
  assert.deepEqual(readSpillMedia(event).map((entry: any) => entry.impactStatus), ["SUSPECTED", "UNKNOWN"]);
  assert.deepEqual(describeSpillRelease(event).media.map((entry: any) => entry.status), ["Suspected", "Unknown"]);
  assert.ok(!describeSpillRelease(event).media.some((entry: any) => entry.status === "Confirmed"));
  assert.match(messages(newSpill({ draft: { media: [medium({ impactStatus: "PROBABLE" })] } })).join(" "), /Impact status must be a controlled value/);
});

test("25. a risk fact is not a confirmed impact and creates no medium record", () => {
  const event = newSpill({ facts: [[DP.waterwayRisk, "YES"], [DP.publicExposureRisk, "UNKNOWN"], [DP.continuingDanger, "NO"]] });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(readSpillMedia(event), [], "waterway risk did not create a surface-water impact");
  assert.deepEqual(describeSpillRelease(event).risk.map((row: any) => [row.label, row.value]), [["Waterway Risk", "Yes"], ["Public Exposure Risk", "Unknown"], ["Continuing Danger", "No"]]);
  assert.equal(describeSpillRelease(event).media.length, 0);
  assert.match(messages(newSpill({ facts: [[DP.waterwayRisk, "LIKELY"]] })).join(" "), /Waterway Risk must be a controlled value/);
});

// 26-28 -----------------------------------------------------------------------
test("26. immediate response facts are Yes / No / Unknown occurrence facts, not Company Actions or causes", () => {
  const facts: Array<[string, string]> = SPILL_RESPONSE_FACT_KEYS.map((key: string, index: number) => [(DP as any)[key], ["YES", "NO", "UNKNOWN"][index % 3]] as [string, string]);
  const event = newSpill({ facts });
  assert.deepEqual(messages(event), []);
  const view = describeSpillRelease(event).response;
  assert.equal(view.length, 12);
  assert.deepEqual(view.map((row: any) => row.label).slice(0, 3), ["Vehicle Stopped", "Engine Shut Off", "Valve Closed"]);
  assert.ok(view.some((row: any) => row.value === "No") && view.some((row: any) => row.value === "Unknown"), "No and Unknown stay distinct");
  assert.match(messages(newSpill({ facts: [[DP.valveClosed, "MAYBE"]] })).join(" "), /Valve Closed must be a controlled value/);
  const s = state([event]);
  assert.deepEqual(s.companyActions, [], "no Company Action was created");
  assert.equal(flow(event).state, "NOT_REQUIRED");
  assert.equal(describeSpillRelease(newSpill()).response.length, 0, "unrecorded response facts are not presented as No");
});

test("27. the response timeline is ordered by its sequence number and keeps actual timestamps; latencies are derived, never stored", () => {
  const event = newSpill({ draft: { steps: [
    step(3, { action: "EMERGENCY_SERVICES_NOTIFIED", timestamp: "2026-09-28T14:25", actor: "Dispatcher" }), step(1, { action: "RELEASE_DISCOVERED", timestamp: "2026-09-28T14:10" }),
    step(2, { action: "VEHICLE_STOPPED", timestamp: "2026-09-28T14:12", location: "Shoulder", source: "DRIVER_REPORT", evidenceIds: ["EV-1"] }), step(4, { action: "RELEASE_CONTAINED", timestamp: "2026-09-28T15:00" }),
    step(5, { action: "CLEANUP_STARTED", timestamp: "2026-09-28T16:00" }), step(6, { action: "CLEANUP_COMPLETED", timestamp: "2026-09-28T18:30" }), step(7, { action: "OTHER", actionOther: "Road reopened" }),
  ] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(readSpillTimeline(event).map((entry: any) => entry.ordinal), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(describeSpillRelease(event).timeline.map((entry: any) => entry.action), ["Release Discovered", "Vehicle Stopped", "Emergency Services Notified", "Release Contained", "Cleanup Started", "Cleanup Completed", "Other: Road reopened"]);
  assert.equal(readSpillTimeline(event)[2].actor, "Dispatcher");
  assert.deepEqual(deriveSpillResponseDelays(event), { discoveryToEmergencyNotificationMinutes: 15, discoveryToContainmentMinutes: 50, cleanupDurationMinutes: 150 });
  const stored = JSON.stringify(event.childCollections);
  assert.ok(!/latency|Minutes/i.test(stored), "no latency metric is stored");
  assert.deepEqual(deriveSpillResponseDelays(newSpill()), { discoveryToEmergencyNotificationMinutes: undefined, discoveryToContainmentMinutes: undefined, cleanupDurationMinutes: undefined });
  for (const action of ["RELEASE_DISCOVERED", "VEHICLE_STOPPED", "AREA_SECURED", "DISPATCH_NOTIFIED", "EMERGENCY_SERVICES_NOTIFIED", "HAZMAT_ARRIVED", "RELEASE_CONTAINED", "CLEANUP_STARTED", "CLEANUP_COMPLETED", "OTHER"]) assert.deepEqual(messages(newSpill({ draft: { steps: [step(1, { action, actionOther: action === "OTHER" ? "x" : "" })] } })), [], action);
});

test("28. duplicate or invalid response ordinals, bad chronology and bad actions are rejected", () => {
  assert.match(messages(newSpill({ draft: { steps: [step(1), { ...step(2), ordinal: "1" }] } })).join(" "), /ordinals must be unique/);
  assert.match(messages(newSpill({ draft: { steps: [step(1, { ordinal: "0" })] } })).join(" "), /positive whole numbers/);
  assert.match(messages(newSpill({ draft: { steps: [step(1, { ordinal: "1.5" })] } })).join(" "), /positive whole numbers/);
  assert.match(messages(newSpill({ draft: { steps: [step(1, { ordinal: "" })] } })).join(" "), /positive whole numbers/);
  assert.match(messages(newSpill({ draft: { steps: [step(1, { timestamp: "2026-09-28T15:00" }), step(2, { action: "VEHICLE_STOPPED", timestamp: "2026-09-28T14:30" })] } })).join(" "), /chronological order/);
  assert.match(messages(newSpill({ draft: { steps: [step(1, { timestamp: "2026-09-27T10:00" })] } })).join(" "), /cannot be before the occurrence/);
  assert.match(messages(newSpill({ draft: { steps: [step(1, { timestamp: "yesterday" })] } })).join(" "), /valid date \/ time/);
  assert.match(messages(newSpill({ draft: { steps: [step(1, { action: "" })] } })).join(" "), /needs an action/);
  assert.match(messages(newSpill({ draft: { steps: [step(1, { action: "PANIC" })] } })).join(" "), /Response action must be a controlled value/);
  assert.match(messages(newSpill({ draft: { steps: [step(1, { action: "OTHER" })] } })).join(" "), /Describe the Other response action/);
  assert.match(messages(newSpill({ draft: { steps: [step(1, { actionOther: "x" })] } })).join(" "), /belongs only to the Other action/);
  assert.match(messages(newSpill({ draft: { steps: [{ ...step(1), itemId: "S" }, { ...step(2), itemId: "S" }] } })).join(" "), /ids must be present and unique/);
  assert.deepEqual(messages(newSpill({ draft: { steps: [step(1, { timestamp: "2026-09-28T14:10" }), step(2, { action: "AREA_SECURED" })] } })), [], "a step without a timestamp is not forced into chronology");
});

// 29-30 -----------------------------------------------------------------------
test("29. a cleanup record keeps vendor, method, disposal, manifest, restoration, verification and a factual cost", () => {
  const record = cleanup({ startedAt: "2026-09-28T16:00", completedAt: "2026-09-29T09:00", vendor: "Clean Co", method: "Absorbent and vacuum", materialRemoved: "Contaminated soil", quantityRemoved: "2", quantityUnit: "CUBIC_METRES", disposalMethod: "Licensed facility", disposalManifest: "MAN-554", wasteClassification: "Per vendor", restorationStatus: "IN_PROGRESS", verificationStatus: "PENDING", verificationNote: "Awaiting lab", cost: "1800.50", costCurrency: "CAD", evidenceIds: ["EV-1"] });
  const event = newSpill({ draft: { cleanups: [record] } });
  assert.deepEqual(messages(event), []);
  const view = describeSpillRelease(event).cleanups[0];
  assert.deepEqual([view.vendor, view.manifest, view.removed, view.restoration, view.verification, view.cost], ["Clean Co", "MAN-554", "2 m3", "In progress", "Pending", "1,800.50 CAD"]);
  assert.match(messages(newSpill({ draft: { cleanups: [cleanup({ startedAt: "2026-09-28T16:00", completedAt: "2026-09-28T15:00" })] } })).join(" "), /cannot complete before it starts/);
  assert.match(messages(newSpill({ draft: { cleanups: [cleanup({ startedAt: "2026-09-27T09:00" })] } })).join(" "), /Cleanup start cannot be before the occurrence/);
  assert.match(messages(newSpill({ draft: { cleanups: [cleanup({ quantityRemoved: "3" })] } })).join(" "), /quantity removed needs a unit/);
  assert.match(messages(newSpill({ draft: { cleanups: [cleanup({ quantityRemoved: "-3", quantityUnit: "LITRES" })] } })).join(" "), /zero or greater/);
  assert.match(messages(newSpill({ draft: { cleanups: [cleanup({ cost: "100", costCurrency: "" })] } })).join(" "), /needs an ISO currency code/);
  assert.match(messages(newSpill({ draft: { cleanups: [cleanup({ cost: "100", costCurrency: "ZZ" })] } })).join(" "), /valid ISO 4217/);
  assert.match(messages(newSpill({ draft: { cleanups: [cleanup({ restorationStatus: "DONE" })] } })).join(" "), /Site restoration status must be a controlled value/);
  assert.match(messages(newSpill({ draft: { cleanups: [cleanup({ verificationStatus: "OK" })] } })).join(" "), /Cleanup verification status must be a controlled value/);
  assert.match(messages(newSpill({ draft: { cleanups: [cleanup({ materialId: "MAT-GHOST" })] } })).join(" "), /material that does not exist/);
  assert.match(messages(newSpill({ draft: { cleanups: [cleanup({ itemId: "C" }), cleanup({ itemId: "C" })] } })).join(" "), /Cleanup record ids must be present and unique/);
  assert.deepEqual(messages(newSpill({ draft: { cleanups: [cleanup()] } })), [], "an empty cleanup record is valid initial enrichment");
  assert.deepEqual(messages(newSpill({ draft: { cleanups: [cleanup({ materialId: "MAT-1" })] } })), [], "a cleanup record can reference an existing material");
  assert.ok(!JSON.stringify(event).match(/accounting|reserve|insurer|claimValue|netLoss/i), "no accounting is built");
});

test("30. Cleanup Status = Verification Pending is an explicit obligation; resolving it returns the event to Ready to Close", () => {
  const pending = newSpill({ facts: [[DP.cleanupStatus, "VERIFICATION_PENDING"]] });
  const open = flow(pending);
  assert.equal(open.state, "IN_REVIEW");
  assert.deepEqual(labels(open), ["Cleanup verification pending"]);
  assert.equal(open.openReasons[0].code, "CLEANUP_VERIFICATION_PENDING");
  assert.equal(flow(newSpill({ facts: [[DP.cleanupStatus, "COMPLETE"]] })).state, "NOT_REQUIRED", "Complete is not an obligation");
  assert.equal(flow(newSpill({ facts: [[DP.cleanupStatus, "NOT_STARTED"]] })).state, "NOT_REQUIRED", "cleanup is never inferred as required");
  assert.equal(flow(newSpill({ facts: [[DP.cleanupStatus, "IN_PROGRESS"]] })).state, "NOT_REQUIRED");
  const toPending = setSpillStatus(newSpill({ facts: [[DP.cleanupStatus, "IN_PROGRESS"]] }), { field: "cleanupStatus", to: "VERIFICATION_PENDING", changedBy: "SM", at: "2026-09-29T10:00:00.000Z" });
  assert.equal(flow(toPending).state, "IN_REVIEW");
  const done = setSpillStatus(toPending, { field: "cleanupStatus", to: "COMPLETE", changedBy: "SM", at: "2026-09-30T10:00:00.000Z" });
  const ready = flow(done);
  assert.equal(ready.state, "READY_TO_CLOSE", "an obligation existed and is resolved");
  assert.deepEqual(readSpillStatusHistory(done).map((entry: any) => [entry.from, entry.to]), [["IN_PROGRESS", "VERIFICATION_PENDING"], ["VERIFICATION_PENDING", "COMPLETE"]]);
  assert.ok(ready.resolvedReasons.some((reason: any) => reason.label === "Cleanup verification completed"));
  assert.equal(flow(newSpill({ facts: [[DP.cleanupStatus, "VERIFICATION_PENDING"]], draft: { cleanups: [cleanup({ verificationStatus: "VERIFIED" })] } })).state, "IN_REVIEW", "only the explicit parent status drives the obligation");
  // a record created already at Verification Pending is resolved when the status later changes
  const bornPending = newSpill({ facts: [[DP.cleanupStatus, "VERIFICATION_PENDING"]] });
  const settled = setSpillStatus(bornPending, { field: "cleanupStatus", to: "COMPLETE", changedBy: "SM", at: "2026-09-30T10:00:00.000Z" });
  const settledFlow = flow(settled);
  assert.equal(settledFlow.state, "READY_TO_CLOSE");
  assert.ok(settledFlow.resolvedReasons.some((reason: any) => reason.code === "CLEANUP_VERIFICATION_PENDING" && reason.resolvedAt === "2026-09-30T10:00:00.000Z"));
  const again = setSpillStatus(settled, { field: "cleanupStatus", to: "VERIFICATION_PENDING", changedBy: "SM", at: "2026-10-02T10:00:00.000Z" });
  assert.deepEqual(flow(again).openReasons.map((reason: any) => reason.code), ["CLEANUP_VERIFICATION_PENDING"], "a later return to Verification Pending is a new obligation");
  assert.equal(flow(again).resolvedReasons.length, 1, "the earlier episode stays resolved");
  assert.throws(() => setSpillStatus(newSpill(), { field: "cleanupStatus", to: "DONE", changedBy: "SM" }), /controlled value/);
  assert.throws(() => setSpillStatus(newSpill(), { field: "cleanupStatus", to: "COMPLETE", changedBy: " " }), /changedBy/);
});

// 31-36 -----------------------------------------------------------------------
test("31. an event can carry multiple regulatory obligations", () => {
  const event = newSpill({ draft: { obligations: [obligation({ assessmentId: "A1", executionId: "X1", jurisdiction: "Alberta", authority: "Provincial regulator" }), obligation({ assessmentId: "A2", executionId: "X2", jurisdiction: "Federal", authority: "National authority", assessmentStatus: "UNDER_REVIEW" }), obligation({ assessmentId: "A3", executionId: "X3", jurisdiction: "Municipal", authority: "", assessmentStatus: "NOT_REQUIRED" })] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(readSpillAssessments(event).map((entry: any) => entry.assessmentStatus), ["REQUIRED", "UNDER_REVIEW", "NOT_REQUIRED"]);
  assert.equal(describeSpillRelease(event).regulatory.length, 3);
  assert.match(messages(newSpill({ draft: { obligations: [obligation({ assessmentId: "A1" }), obligation({ assessmentId: "A1", executionId: "X2" })] } })).join(" "), /Regulatory obligation ids must be present and unique/);
  assert.match(messages(newSpill({ draft: { obligations: [obligation({ jurisdiction: "", authority: "" })] } })).join(" "), /needs a jurisdiction or an authority/);
});

test("32. regulatory assessment is stored separately from execution and no legal rule is applied", () => {
  const assessmentOnly = newSpill({ draft: { obligations: [obligation()] } });
  assert.equal(assessmentOnly.childCollections.some((c: any) => c.collectionId === CID.REGULATORY_EXECUTIONS), false, "no execution record without execution facts");
  assert.deepEqual(readSpillExecutions(assessmentOnly), []);
  const both = newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", notificationDeadline: "2026-09-29T18:00", notificationStatus: "IN_PROGRESS" })] } });
  assert.equal(readSpillAssessments(both)[0].itemId, "ASM-1");
  assert.equal(readSpillExecutions(both)[0].assessmentId, "ASM-1");
  assert.notEqual(both.childCollections.find((c: any) => c.collectionId === CID.REGULATORY_ASSESSMENTS), both.childCollections.find((c: any) => c.collectionId === CID.REGULATORY_EXECUTIONS));
  assert.equal(readSpillExecutions(both)[0].notificationDeadline, "2026-09-29T18:00", "a deadline is a stored fact, not derived");
  assert.match(messages(newSpill({ draft: { obligations: [obligation({ assessmentStatus: "" })] } })).join(" "), /needs an assessment status/);
  assert.match(messages(newSpill({ draft: { obligations: [obligation({ assessmentStatus: "LIKELY" })] } })).join(" "), /Assessment status must be a controlled value/);
  assert.match(messages(newSpill({ draft: { obligations: [obligation({ notificationRequired: "SOMETIMES" })] } })).join(" "), /Notification required must be a controlled value/);
  assert.match(messages(newSpill({ draft: { obligations: [obligation({ reportStatus: "DONE" })] } })).join(" "), /Report status must be a controlled value/);
  assert.match(messages(newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", notificationDeadline: "2026-09-27T10:00" })] } })).join(" "), /notification deadline cannot be before the occurrence/);
  assert.match(messages(newSpill({ draft: { obligations: [obligation({ notifiedAt: "2026-09-28T16:00", notificationStatus: "NOT_STARTED" })] } })).join(" "), /notified time cannot accompany/);
  assert.match(messages(newSpill({ draft: { obligations: [obligation({ submittedAt: "2026-09-28T16:00" })] } })).join(" "), /submitted time cannot accompany/);
  assert.match(messages(newSpill({ draft: { obligations: [obligation({ notificationRequired: "NO", notificationStatus: "COMPLETED" })] } })).join(" "), /cannot also be recorded as not required/);
  assert.deepEqual(messages(newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", notificationDeadline: "2026-09-28T16:00", notificationStatus: "COMPLETED", notifiedAt: "2026-09-28T20:00" })] } })), [], "a late notification is a fact, not an error");
  assert.ok(!JSON.stringify(both).match(/reportableQuantity|threshold|EPA|PHMSA/i), "no thresholds or legal references are stored or hardcoded");
});

test("33. a Required assessment with notification Required and incomplete raises REGULATORY_NOTIFICATION_INCOMPLETE", () => {
  const event = newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", notificationStatus: "IN_PROGRESS" })] } });
  const workflow = flow(event);
  assert.equal(workflow.state, "OPEN");
  assert.ok(workflow.openReasons.some((reason: any) => reason.code === "REGULATORY_NOTIFICATION_INCOMPLETE" && reason.detail === "Alberta / Provincial regulator"));
  assert.ok(labels(workflow).includes("Regulatory notification incomplete"));
  assert.equal(flow(newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES" })] } })).state, "OPEN", "no status yet is still incomplete");
  assert.equal(flow(newSpill({ draft: { obligations: [obligation({ notificationRequired: "NO", notificationStatus: "NOT_STARTED" })] } })).state, "READY_TO_CLOSE", "not required means no notification obligation");
  assert.equal(flow(newSpill({ draft: { obligations: [obligation({ notificationRequired: "UNKNOWN" })] } })).openReasons.length, 0, "Unknown is not Required");
  assert.equal(flow(newSpill({ draft: { obligations: [obligation({ assessmentStatus: "NOT_REQUIRED", notificationRequired: "YES" })] } })).state, "NOT_REQUIRED", "execution facts do not override an assessment of Not Required");
  assert.equal(flow(newSpill({ draft: { obligations: [obligation({ assessmentStatus: "UNDETERMINED", notificationRequired: "YES" })] } })).openReasons.some((reason: any) => reason.code === "REGULATORY_NOTIFICATION_INCOMPLETE"), false);
});

test("34. a Required assessment with report Required and incomplete raises REGULATORY_REPORT_INCOMPLETE", () => {
  const event = newSpill({ draft: { obligations: [obligation({ reportRequired: "YES", reportStatus: "IN_PROGRESS", reportDeadline: "2026-10-05T12:00" })] } });
  const workflow = flow(event);
  assert.equal(workflow.state, "OPEN");
  assert.ok(workflow.openReasons.some((reason: any) => reason.code === "REGULATORY_REPORT_INCOMPLETE"));
  assert.ok(labels(workflow).includes("Regulatory report incomplete"));
  assert.ok(!workflow.openReasons.some((reason: any) => reason.code === "REGULATORY_NOTIFICATION_INCOMPLETE"), "report and notification are separate obligations");
  const both = flow(newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", reportRequired: "YES" })] } }));
  assert.deepEqual(both.openReasons.map((reason: any) => reason.code), ["REGULATORY_NOTIFICATION_INCOMPLETE", "REGULATORY_REPORT_INCOMPLETE"]);
});

test("35. completed regulatory execution resolves the obligation; the assessment review reason is explicit", () => {
  const done = newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", notificationStatus: "COMPLETED", notifiedAt: "2026-09-28T16:00", reportRequired: "YES", reportStatus: "COMPLETED", submittedAt: "2026-09-30T10:00", reportControlNumber: "CTRL-1" })] } });
  const ready = flow(done);
  assert.equal(ready.state, "READY_TO_CLOSE");
  assert.deepEqual(ready.openReasons, []);
  assert.deepEqual(ready.resolvedReasons.map((reason: any) => reason.code).sort(), ["REGULATORY_ASSESSMENT_REQUIRED", "REGULATORY_NOTIFICATION_INCOMPLETE", "REGULATORY_REPORT_INCOMPLETE"]);
  const pending = newSpill({ draft: { obligations: [obligation({ assessmentStatus: "NOT_ASSESSED" })] } });
  assert.deepEqual(flow(pending).openReasons.map((reason: any) => [reason.code, reason.kind]), [["REGULATORY_ASSESSMENT_REQUIRED", "OBLIGATION"]]);
  assert.equal(flow(pending).state, "OPEN");
  const review = newSpill({ draft: { obligations: [obligation({ assessmentStatus: "UNDER_REVIEW" })] } });
  assert.equal(flow(review).state, "IN_REVIEW");
  assert.deepEqual(labels(flow(review)), ["Regulatory assessment required"]);
  // Progressive enrichment through the writer: a later execution update resolves the obligation.
  const open = newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", notificationStatus: "IN_PROGRESS" })] } });
  assert.equal(flow(open).state, "OPEN");
  const updated = apply(open, CID.REGULATORY_EXECUTIONS, { notificationStatus: "COMPLETED", notifiedAt: "2026-09-28T17:00" }, { itemId: "EXE-1" }).event;
  assert.equal(flow(updated).state, "READY_TO_CLOSE");
  assert.equal(readSpillExecutions(updated).length, 1, "the execution record was updated, not duplicated");
  assert.equal(readSpillAssessments(updated)[0].assessmentStatus, "REQUIRED", "the assessment is untouched by an execution update");
  assert.throws(() => apply(open, CID.REGULATORY_EXECUTIONS, { notificationStatus: "NOT_STARTED", notifiedAt: "2026-09-28T17:00" }, { itemId: "EXE-1" }), /notified time cannot accompany/, "an inconsistent update is refused");
  const reassessed = apply(pending, CID.REGULATORY_ASSESSMENTS, { assessmentStatus: "NOT_REQUIRED" }, { itemId: "ASM-1" }).event;
  assert.equal(flow(reassessed).state, "NOT_REQUIRED", "once assessed as Not Required the obligation is gone");
});

test("36. the absence of a regulatory record is NOT an obligation; nothing is inferred from material, quantity, category or impact", () => {
  const heavy = newSpill({
    facts: [[DP.releaseDetermination, "CONFIRMED"], [DP.waterwayRisk, "YES"], [DP.continuingDanger, "YES"], [DP.hazmatResponseContacted, "YES"], [DP.emergencyServicesContacted, "YES"]],
    draft: { materials: [mat({ category: "CHEMICAL", identificationStatus: "CONFIRMED", materialSource: "SHIPPING_PAPER", properShippingName: "Corrosive liquid", unId: "UN1760", hazardClass: "8", packingGroup: "II" })], quantities: [qty({ value: "50000", status: "MEASURED" })], media: [medium({ medium: "SURFACE_WATER", impactStatus: "CONFIRMED" })], persons: [person({ fatality: "YES", accessClassification: "RESTRICTED_MEDICAL" })] },
  });
  assert.deepEqual(readSpillAssessments(heavy), []);
  assert.equal(flow(heavy).state, "NOT_REQUIRED");
  assert.deepEqual(spillWorkflowProvider.collect(heavy, state([heavy])), []);
  assert.equal(heavy.childCollections.some((c: any) => c.collectionId.includes("REGULATORY")), false);
});

// 37-42 -----------------------------------------------------------------------
test("37. a bare Spill / Release is NOT_REQUIRED; it is registered with the common engine and no universal obligation exists", () => {
  const event = newSpill();
  const workflow = flow(event);
  assert.equal(workflow.state, "NOT_REQUIRED");
  assert.deepEqual(workflow.reasons, []);
  assert.deepEqual(provs().flatMap((provider: any) => provider.collect(event, state([event]))), []);
  assert.equal(provs().length, getWorkflowProvidersForEventType("Roadside Inspection").length + 1, "Spill / Release is registered with the common engine");
  assert.equal(flow(newSpill({ facts: [[DP.releaseCondition, "ACTIVE"], [DP.releaseDetermination, "CONFIRMED"]] })).state, "NOT_REQUIRED", "an active confirmed release alone is a fact, not an obligation");
  assert.equal(flow(newSpill({ draft: { materials: [mat({ category: "UNKNOWN", identificationStatus: "PENDING_IDENTIFICATION", materialSource: "" })] } })).state, "NOT_REQUIRED", "pending identification is not an obligation");
});

test("38. a reviewer-required investigation drives the workflow through the common provider", () => {
  const event = newSpill();
  const required = setPerformanceInvestigationRequirement(state([event]), "SPL-1", { required: true, reason: "Environmental exposure", setBy: "SM" });
  const workflow = deriveEventWorkflow(required.event as any, required.state);
  assert.equal(workflow.state, "OPEN");
  assert.deepEqual(labels(workflow), ["Investigation incomplete"]);
  const action = { id: "ACT-1", companyId: COMPANY, driverMasterId: "DRV-1", actionType: "COACHING", title: "Fuel-line inspection", decidedBy: "M", factualBasis: "f", effectiveDate: "2026-09-29", status: "Active", linkedEventIds: ["SPL-1"], closureRequirement: "REQUIRED", isArchived: false, createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z" };
  assert.deepEqual(labels(flow(event, { companyActions: [action] })), ["Corrective action outstanding"]);
  const combined = flow(newSpill({ facts: [[DP.cleanupStatus, "VERIFICATION_PENDING"]] }), { companyActions: [action] });
  assert.deepEqual(combined.openReasons.map((reason: any) => reason.code), ["CLEANUP_VERIFICATION_PENDING", "CORRECTIVE_ACTION_OUTSTANDING"], "common and Spill reasons coexist in priority order");
});

test("39. the five new contributing-factor domains are appended and every existing domain is preserved", () => {
  const domains: readonly string[] = CONTRIBUTING_FACTOR_DOMAINS;
  assert.deepEqual(domains.slice(-5), ["PACKAGING", "MAINTENANCE", "HANDLING", "TRAINING", "EXTERNAL_EVENT"]);
  assert.deepEqual(domains.slice(0, 12), ["DRIVER_STATE", "DRIVER_BEHAVIOR", "OTHER_ROAD_USER", "ROAD_WEATHER", "VEHICLE_EQUIPMENT", "OPERATIONS", "SITE_CUSTOMER", "LOADING_UNLOADING", "CARGO_SECUREMENT", "SECURITY", "FRAUD_CRIME", "PROCESS_POLICY"], "historical domains are neither renamed nor reordered");
  assert.equal(domains.length, 17);
  const event = newSpill();
  const opened = openPerformanceInvestigation(state([event]), { eventId: "SPL-1", openedBy: "SM" });
  const factors = setInvestigationContributingFactors(opened.state, opened.investigation.id, [{ domain: "MAINTENANCE", factor: "Hose past service interval", role: "PRIMARY" }, { domain: "PACKAGING", factor: "Tote closure", role: "SECONDARY" }, { domain: "HANDLING", factor: "Forklift contact", role: "SECONDARY" }, { domain: "TRAINING", factor: "Spill kit use", role: "SECONDARY" }, { domain: "EXTERNAL_EVENT", factor: "Third-party vehicle strike", role: "SECONDARY" }, { domain: "VEHICLE_EQUIPMENT", factor: "Fitting", role: "SECONDARY" }], { by: "SM" });
  assert.deepEqual(getInvestigationsForEvent(factors.state, "SPL-1")[0].contributingFactors!.items.map((entry: any) => entry.facts.domain), ["MAINTENANCE", "PACKAGING", "HANDLING", "TRAINING", "EXTERNAL_EVENT", "VEHICLE_EQUIPMENT"]);
  assert.throws(() => setInvestigationContributingFactors(factors.state, opened.investigation.id, [{ domain: "SPILL_RISK" as never, factor: "x", role: "PRIMARY" }], { by: "SM" }), /Unknown contributing-factor domain/);
  const readback = JSON.stringify(event);
  assert.ok(!readback.includes("MAINTENANCE"), "factors are investigation data, never part of the initial report");
});

test("40. the common investigation engine completes an investigation for a Spill / Release; the reporter decides none of it", () => {
  const event = newSpill({ facts: [[DP.releaseMechanism, "HOSE_FAILURE"]] });
  const required = setPerformanceInvestigationRequirement(state([event]), "SPL-1", { required: true, setBy: "SM" });
  const opened = openPerformanceInvestigation(required.state, { eventId: "SPL-1", openedBy: "SM" });
  const classified = recordPerformanceDetermination(opened.state, { investigationId: opened.investigation.id, assessment: { subject: "CLASSIFICATION", outcome: "CONFIRMED_AS_REPORTED" }, determinedBy: "SM", determinationDate: "2026-09-30" });
  const concluded = updatePerformanceInvestigation(classified.state, opened.investigation.id, { by: "SM", conclusion: { summary: "Reviewed." } });
  const completed = completePerformanceInvestigation(concluded.state, opened.investigation.id, { by: "SM" });
  assert.equal(deriveEventWorkflow(required.event as any, completed.state).state, "READY_TO_CLOSE");
  const keys = Object.keys(JSON.stringify(event).match(/"[a-zA-Z]+":/g) || {}).length;
  assert.ok(keys > 0);
  assert.ok(!/rootCause|preventab|responsib|liab|controlFailure/i.test(JSON.stringify(event.structuredEventFacts) + JSON.stringify(event.childCollections)), "no determination is stored in the occurrence record");
});

test("41. closure is deliberate: it needs a named closer and is refused while any obligation remains", () => {
  const open = newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", notificationStatus: "IN_PROGRESS" })] } });
  assert.throws(() => closePerformanceEventWorkflow(state([open]), "SPL-1", { closedBy: "SM", providers: provs() }), /cannot be closed/);
  const done = newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", notificationStatus: "COMPLETED", notifiedAt: "2026-09-28T16:00" })] } });
  assert.equal(flow(done).state, "READY_TO_CLOSE");
  assert.throws(() => closePerformanceEventWorkflow(state([done]), "SPL-1", { closedBy: " ", providers: provs() }), /closedBy/);
  const closed = closePerformanceEventWorkflow(state([done]), "SPL-1", { closedBy: "SM", note: "Reviewed", providers: provs(), at: "2026-10-01T00:00:00.000Z" });
  assert.equal(deriveEventWorkflow(closed.state.events[0], closed.state).state, "CLOSED");
  assert.throws(() => closePerformanceEventWorkflow(state([newSpill()]), "SPL-1", { closedBy: "SM", providers: provs() }), /cannot be closed/, "a bare Spill / Release is never closed by default");
});

test("42. a later obligation reopens a closed Spill / Release; resolving it returns it to Ready to Close and needs a new closure", () => {
  const done = newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", notificationStatus: "COMPLETED", notifiedAt: "2026-09-28T16:00" })] } });
  const closed = closePerformanceEventWorkflow(state([done]), "SPL-1", { closedBy: "SM", providers: provs(), at: "2026-10-01T00:00:00.000Z" });
  const closedEvent = closed.state.events[0];
  // a new regulatory obligation recorded AFTER the closure
  const later = upsertSpillChild(closedEvent, { collectionId: CID.REGULATORY_ASSESSMENTS, facts: { jurisdiction: "Federal", authority: "National authority", assessmentStatus: "UNDER_REVIEW" }, now: "2026-10-02T00:00:00.000Z" });
  const reopened = deriveEventWorkflow(later.event, state([later.event]));
  assert.equal(reopened.state, "IN_REVIEW");
  assert.equal(reopened.closureSuperseded, true);
  assert.equal(reopened.closure?.closedBy, "SM", "the closure record is kept");
  assert.deepEqual(reopened.obligationsSinceClosure.map((reason: any) => reason.code), ["REGULATORY_ASSESSMENT_REQUIRED"]);
  const resolved = upsertSpillChild(later.event, { collectionId: CID.REGULATORY_ASSESSMENTS, itemId: later.itemId, facts: { assessmentStatus: "NOT_REQUIRED" }, now: "2026-10-03T00:00:00.000Z" });
  const settled = deriveEventWorkflow(resolved.event, state([resolved.event]));
  assert.equal(settled.state, "CLOSED", "with the new obligation gone nothing has been created after closure that remains");
  // a new obligation that is explicitly Required and resolved still needs a new deliberate closure
  const required = upsertSpillChild(closedEvent, { collectionId: CID.REGULATORY_ASSESSMENTS, facts: { jurisdiction: "Municipal", assessmentStatus: "REQUIRED" }, now: "2026-10-02T00:00:00.000Z" });
  const again = deriveEventWorkflow(required.event, state([required.event]));
  assert.equal(again.state, "READY_TO_CLOSE", "resolved, but a NEW deliberate closure is required");
  assert.equal(again.closureSuperseded, true);
  const reclosed = closePerformanceEventWorkflow(state([required.event]), "SPL-1", { closedBy: "SM2", providers: provs(), at: "2026-10-04T00:00:00.000Z" });
  assert.equal(deriveEventWorkflow(reclosed.state.events[0], reclosed.state).state, "CLOSED");
  assert.equal(reclosed.state.events[0].workflowClosures.length, 2, "both closures are preserved");
  // cleanup verification pending after closure
  const pendingAgain = setSpillStatus(closedEvent, { field: "cleanupStatus", to: "VERIFICATION_PENDING", changedBy: "SM", at: "2026-10-05T00:00:00.000Z" });
  const reopenedCleanup = deriveEventWorkflow(pendingAgain, state([pendingAgain]));
  assert.equal(reopenedCleanup.state, "IN_REVIEW");
  assert.equal(reopenedCleanup.closureSuperseded, true);
});

// 43-47 -----------------------------------------------------------------------
test("43. Spill / Release can be related to a Collision through the existing relationship engine without duplicating either occurrence", () => {
  const spill = newSpill();
  const collision = { id: "COL-1", companyId: COMPANY, eventType: "Collision", driverMasterId: "DRV-1" };
  const related = createPerformanceEventRelationship(state([spill, collision]), { fromEventId: "SPL-1", toEventId: "COL-1", type: "SAME_OCCURRENCE_AS", createdBy: "SM", note: "Fuel tank ruptured in the collision" });
  assert.equal(related.state.events.length, 2, "no event was created or duplicated");
  assert.deepEqual(getEventRelationships(related.state, "SPL-1").map((view: any) => [view.effectiveType, view.otherEventId]), [["SAME_OCCURRENCE_AS", "COL-1"]]);
  assert.deepEqual(getEventRelationships(related.state, "COL-1").map((view: any) => [view.effectiveType, view.otherEventId]), [["SAME_OCCURRENCE_AS", "SPL-1"]], "the inverse is derived, not stored twice");
  assert.equal(related.state.eventRelationships.length, 1);
  const origin = createPerformanceEventRelationship(state([spill, collision]), { fromEventId: "SPL-1", toEventId: "COL-1", type: "ORIGINATED_FROM", createdBy: "SM" });
  assert.equal(getEventRelationships(origin.state, "COL-1")[0].effectiveType, "RECLASSIFIED_AS");
  assert.equal(describeSpillRelease(spill).materials.length, 1, "the Spill carries its own facts; nothing is copied from the Collision");
  assert.ok(!JSON.stringify(spill).includes("COL-1"), "the relationship lives in the engine, not on the Spill record");
  assert.throws(() => createPerformanceEventRelationship(related.state, { fromEventId: "SPL-1", toEventId: "COL-1", type: "SAME_OCCURRENCE_AS", createdBy: "SM" }), /already exists/);
});

test("44. Spill / Release can be related to a Cargo Incident and to a Security Incident", () => {
  const spill = newSpill();
  const cargo = { id: "CGO-1", companyId: COMPANY, eventType: "Cargo Incident", driverMasterId: "DRV-1" };
  const security = { id: "SEC-1", companyId: COMPANY, eventType: "Security Incident", driverMasterId: "DRV-1" };
  const first = createPerformanceEventRelationship(state([spill, cargo, security]), { fromEventId: "SPL-1", toEventId: "CGO-1", type: "RELATED_TO", createdBy: "SM" });
  const second = createPerformanceEventRelationship(first.state, { fromEventId: "SPL-1", toEventId: "SEC-1", type: "RELATED_TO", createdBy: "SM" });
  assert.deepEqual(getEventRelationships(second.state, "SPL-1").map((view: any) => view.otherEventId).sort(), ["CGO-1", "SEC-1"]);
  assert.deepEqual(getEventRelationships(second.state, "CGO-1").map((view: any) => [view.effectiveType, view.otherEventId]), [["RELATED_TO", "SPL-1"]]);
  assert.equal(second.state.events.length, 3);
  assert.equal(describeSpillRelease(spill).otherImpact.facts.length, 0, "no cargo or collision outcome was copied into the Spill");
});

test("45. there is no Performance -> Maintenance relationship or fake maintenance reference on a Spill / Release", () => {
  const definition = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Spill or Release"];
  assert.ok(!definition.fields.some((field: any) => /maintenance|workorder|repair(?!Cost)/i.test(field.key + field.dataPointId)), "no maintenance field");
  assert.ok(!(definition.relationships || []).some((entry: any) => /maintenance/i.test(entry.key + entry.entityType)), "no maintenance relationship");
  const event = newSpill({ facts: [[DP.sourceCategory, "VEHICLE_SYSTEM"], [DP.sourceSubsystem, "Fuel System"]] });
  assert.ok(event.canonicalLinks.every((link: any) => link.entityType === "Vehicle" || link.entityType === "Trailer"));
  assert.ok(!JSON.stringify(event).match(/maintenance/i), "equipment facts do not pretend a maintenance record is linked");
  assert.ok(!event.operationalReferences, "no MAINTENANCE_REFERENCE");
  const domains: readonly string[] = CONTRIBUTING_FACTOR_DOMAINS;
  assert.ok(domains.includes("MAINTENANCE"), "maintenance can still be an investigation contributing factor");
});

test("46. child records reference the parent's evidence; evidence is stored once on the event and no Spill evidence store exists", () => {
  const event = newSpill({ draft: { materials: [mat({ evidenceIds: ["EV-1"] })], quantities: [qty({ evidenceIds: ["EV-2"] })], persons: [person({ evidenceIds: ["EV-1"] })], media: [medium({ evidenceIds: ["EV-2"] })], steps: [step(1, { evidenceIds: ["EV-1", "EV-2"] })], cleanups: [cleanup({ evidenceIds: ["EV-1"] })], obligations: [obligation({ notificationRequired: "YES", evidenceIds: ["EV-2"] })] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(event.evidenceIds, ["EV-1", "EV-2"], "evidence is stored once, on the event");
  const childEvidence = event.childCollections.flatMap((entry: any) => entry.items.flatMap((item: any) => item.evidenceIds));
  assert.ok(childEvidence.length > 0 && childEvidence.every((id: string) => event.evidenceIds.includes(id)));
  assert.ok(!event.childCollections.some((entry: any) => /EVIDENCE/.test(entry.collectionId)), "no SpillReleaseEvidence collection");
  assert.ok(!Object.values(CID).some((id: any) => /EVIDENCE/.test(id)));
  assert.deepEqual(readSpillMaterials(event)[0].evidenceIds, ["EV-1"]);
});

test("47. a child reference to evidence that is not linked to the event is rejected, including through the data layer", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["material", { materials: [mat({ evidenceIds: ["EV-X"] })] }], ["quantity", { quantities: [qty({ evidenceIds: ["EV-X"] })] }], ["person", { persons: [person({ evidenceIds: ["EV-X"] })] }], ["medium", { media: [medium({ evidenceIds: ["EV-X"] })] }],
    ["step", { steps: [step(1, { evidenceIds: ["EV-X"] })] }], ["cleanup", { cleanups: [cleanup({ evidenceIds: ["EV-X"] })] }], ["execution", { obligations: [obligation({ notificationRequired: "YES", evidenceIds: ["EV-X"] })] }],
  ];
  for (const [name, patch] of cases) assert.match(messages(newSpill({ draft: patch })).join(" "), /not linked to this Spill \/ Release/, name);
  localStorage.clear(); seedVehicles();
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newSpill({ draft: { materials: [mat({ evidenceIds: ["EV-X"] })] } }))), /not linked to this Spill/);
  const event = newSpill();
  assert.throws(() => upsertSpillChild(event, { collectionId: CID.CLEANUP, facts: { vendor: "x" }, evidenceIds: ["EV-X"] }), /not linked to this Spill/);
  assert.equal(upsertSpillChild(event, { collectionId: CID.CLEANUP, facts: { vendor: "x" }, evidenceIds: ["EV-1"] }).event.childCollections.length > 0, true);
});

// 48-50 -----------------------------------------------------------------------
const legacySpill = (): any => ({
  id: "OLD-SPL", eventType: "Spill or Release", companyId: COMPANY, driverMasterId: "DRV-1", createdAt: "2024-02-01T00:00:00.000Z", eventDate: "2024-02-01", summary: "Old spill", description: "Old record", severity: "Not Applicable", status: "Not Applicable", evidenceIds: ["EV-OLD"], chronology: [], isArchived: false,
  structuredEventFacts: [
    { dataPointId: "DRV.PERF.SPILL_RELEASE.MATERIAL", value: "Hydraulic oil", valueType: "string" }, { dataPointId: "DRV.PERF.SPILL_RELEASE.QUANTITYRELEASED", value: 20, valueType: "measurement", unit: "L" },
    { dataPointId: "DRV.PERF.SPILL_RELEASE.RELEASEENVIRONMENT", value: "Soil", valueType: "string" }, { dataPointId: "DRV.PERF.SPILL_RELEASE.CONTAINMENTPERFORMED", value: true, valueType: "boolean" },
    { dataPointId: "DRV.PERF.SPILL_RELEASE.EMERGENCYRESPONSE", value: false, valueType: "boolean" }, { dataPointId: "DRV.PERF.SPILL_RELEASE.RESPONSENOTES", value: "Applied absorbent", valueType: "string" },
  ],
  provenance: { sourceType: "SOURCE_FACT", source: "Driver Report" },
});

test("48. a legacy Spill / Release record stays readable through a compatibility readback", () => {
  const legacy = legacySpill();
  assert.equal(isLegacySpill(legacy), true);
  assert.equal(isNewTaxonomySpill(legacy), false);
  assert.deepEqual(describeLegacySpill(legacy), { material: "Hydraulic oil", quantityReleased: "20 L", releaseEnvironment: "Soil", containmentPerformed: "Yes", emergencyResponse: "No", responseNotes: "Applied absorbent", source: "Driver Report" });
  assert.equal(isLegacySpill(newSpill()), false);
  assert.deepEqual(spillWorkflowProvider.collect(legacy, state([legacy])), [], "a legacy record creates no Spill obligation");
  assert.equal(flow(legacy).state, "NOT_REQUIRED");
  assert.throws(() => upsertSpillChild(legacy, { collectionId: CID.CLEANUP, facts: { vendor: "x" } }), /Legacy Spill/);
  assert.throws(() => setSpillStatus(legacy, { field: "cleanupStatus", to: "COMPLETE", changedBy: "SM" }), /Legacy Spill/);
  const definition = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Spill or Release"];
  const hidden = definition.fields.filter((field: any) => field.hiddenInCreation).map((field: any) => field.key).sort();
  assert.deepEqual(hidden, ["containmentPerformed", "emergencyResponse", "material", "quantityReleased", "releaseEnvironment"], "mixed legacy fields are not offered for new records");
  assert.ok(!definition.fields.find((field: any) => field.key === "material")?.required, "the old material is no longer universally required");
});

test("49. there is no legacy migration: legacy records are untouched on load and nothing is fabricated from them", () => {
  localStorage.clear(); seedVehicles();
  const legacy = legacySpill();
  const store = dd.loadCompanyDriverStore(COMPANY);
  localStorage.setItem(`tes_company_drivers_${COMPANY}`, JSON.stringify({ ...store, events: [legacy] }));
  const loaded = dd.loadCompanyDriverStore(COMPANY).events.find((entry: any) => entry.id === "OLD-SPL");
  assert.deepEqual(loaded.structuredEventFacts, legacy.structuredEventFacts, "stored facts are byte-for-byte unchanged");
  assert.equal(loaded.childCollections, undefined, "no child records were fabricated");
  const view = describeSpillRelease(loaded);
  assert.deepEqual([view.materials, view.quantities, view.media, view.persons, view.regulatory, view.cleanups], [[], [], [], [], [], []], "legacy values were not reinterpreted into new records");
  assert.deepEqual(view.release, { determination: undefined, condition: undefined, cleanupStatus: undefined, form: undefined, mechanism: undefined, sourceCategory: undefined, subsystem: undefined, component: undefined, powerUnit: undefined, trailers: undefined, narrative: "Applied absorbent" }, "no release state was inferred from the old booleans (the narrative is the one shared legacy field)");
  assert.equal(JSON.stringify(loaded).includes("Soil") && view.media.length === 0, true, "the old Release Environment did not become a medium");
  assert.equal(readSpillStatusHistory(loaded).length, 0);
});

test("50. no BI metric, risk score or universal severity is stored on a Spill / Release", () => {
  const event = newSpill({ facts: [[DP.waterwayRisk, "YES"]], draft: { quantities: [qty()], media: [medium()], persons: [person()] } });
  const everything = JSON.stringify([event.structuredEventFacts, event.childCollections]);
  assert.ok(!/score|riskLevel|spillSeverity|priority|latencyMinutes|recurrence/i.test(everything), "nothing derived is persisted");
  const definition = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Spill or Release"];
  assert.ok(!definition.fields.some((field: any) => /score|severity|latency/i.test(field.key)), "no severity / score field in the schema");
  assert.equal(buildSpillSummary(event).title, "Spill or Release");
  assert.ok(!/severity|score/i.test(JSON.stringify(buildSpillSummary(event))));
  assert.equal(payloadFrom(event).severity, "Not Applicable", "the generic severity stays compatible and non-authoritative");
});

// extras ----------------------------------------------------------------------
test("51. the registry data point ids match the pure module's constants and every Spill field has a stable id", () => {
  const definition = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Spill or Release"];
  const ids = new Set(definition.fields.map((field: any) => field.dataPointId));
  for (const id of Object.values(DP)) assert.ok(ids.has(id as string), `registry has ${id}`);
  assert.equal(ids.size, definition.fields.length, "data point ids are unique");
  for (const legacy of ["MATERIAL", "QUANTITYRELEASED", "RELEASEENVIRONMENT", "CONTAINMENTPERFORMED", "EMERGENCYRESPONSE", "RESPONSENOTES"]) assert.ok(ids.has(`DRV.PERF.SPILL_RELEASE.${legacy}`), `legacy id kept: ${legacy}`);
  assert.deepEqual(Object.values(CID).length, new Set(Object.values(CID)).size);
});

test("52. occurrence timing: precision, window, discovery and report are separate; chronology is data-layer enforced; delays are derived", () => {
  const timed = newSpill({ facts: [[DP.discoveryDate, "2026-09-28"], [DP.discoveryTime, "14:20"], [DP.reportedTime, "14:40"], [DP.eventTimeZone, "America/Edmonton"]], extra: { reportedDate: "2026-09-28" } });
  assert.deepEqual(messages(timed), []);
  assert.deepEqual(deriveSpillTimingDelays(timed), { occurrenceToDiscoveryMinutes: 15, discoveryToReportMinutes: 20, occurrenceToReportMinutes: 35 });
  assert.equal(describeSpillRelease(timed).time.timeZone, "America/Edmonton");
  assert.ok(!/Minutes/i.test(JSON.stringify(timed.structuredEventFacts)), "no latency is stored");
  const approximate = newSpill({ draft: { precision: "APPROXIMATE" }, extra: { eventTime: "" } });
  assert.deepEqual(deriveSpillTimingDelays(approximate), { occurrenceToDiscoveryMinutes: undefined, discoveryToReportMinutes: undefined, occurrenceToReportMinutes: undefined }, "exact time is never manufactured");
  assert.match(messages(newSpill({ facts: [[DP.discoveryDate, "2026-09-28"], [DP.discoveryTime, "13:00"]] })).join(" "), /Discovery cannot be before the occurrence/);
  assert.match(messages(newSpill({ facts: [[DP.discoveryDate, "2026-09-28"], [DP.discoveryTime, "15:00"], [DP.reportedTime, "14:30"]], extra: { reportedDate: "2026-09-28" } })).join(" "), /report cannot be dated before discovery/);
  assert.match(messages(newSpill({ facts: [[DP.windowStart, "2026-09-28T10:00"]] })).join(" "), /needs both a start and an end/);
  assert.match(messages(newSpill({ facts: [[DP.windowStart, "2026-09-28T12:00"], [DP.windowEnd, "2026-09-28T10:00"]] })).join(" "), /window end cannot be before its start/);
  assert.deepEqual(messages(newSpill({ draft: { precision: "APPROXIMATE" }, facts: [[DP.windowStart, "2026-09-28T10:00"], [DP.windowEnd, "2026-09-28T12:00"], [DP.windowBasis, "Overnight parking"]], extra: { eventTime: "" } })), []);
  assert.match(messages(newSpill({ facts: [[DP.discoveryTime, "14:20"]] })).join(" "), /discovery time needs a discovery date/);
  assert.match(messages(newSpill({ facts: [[DP.reportedTime, "14:20"]] })).join(" "), /reported time needs a reported date/);
  assert.match(messages(newSpill({ facts: [[DP.eventTimeZone, "Mars/Olympus"]] })).join(" "), /valid IANA zone/);
  assert.match(messages(newSpill({ facts: [[DP.discoveryDate, "28/09/2026"]] })).join(" "), /Discovery date must be a valid date/);
});

test("53. financial facts are local raw amounts in { value, currencyCode } shape; no total, net loss, claim or reserve is calculated", () => {
  const event = newSpill({ draft: { financial: { ...emptySpillFinancial(), materialValue: "900", cleanupCost: "2500.5", remediationCost: "10000", remediationCostCurrency: "USD", repairCost: "300" }, cleanups: [cleanup({ cost: "1200", costCurrency: "CAD" })] } });
  assert.deepEqual(messages(event), []);
  const financial = readSpillFinancial(event)!;
  assert.deepEqual(financial.remediationCost, { value: 10000, currencyCode: "USD" });
  assert.deepEqual(financial.cleanupCost, { value: 2500.5, currencyCode: "CAD" });
  assert.deepEqual(Object.keys(describeSpillRelease(event).financial!), ["materialValue", "cleanupCost", "remediationCost", "repairCost"]);
  assert.ok(!/total|net|claim|reserve|settle/i.test(JSON.stringify(describeSpillRelease(event).financial)));
  assert.equal(readSpillFinancial(newSpill()), undefined, "an unrecorded amount is not zero");
  assert.match(messages(newSpill({ draft: { financial: { ...emptySpillFinancial(), repairCost: "-5" } } })).join(" "), /Repair cost must be zero or greater/);
  assert.match(messages(newSpill({ draft: { financial: { ...emptySpillFinancial(), materialValue: "5", materialValueCurrency: "" } } })).join(" "), /Material value needs an ISO currency code/);
  assert.match(messages(newSpill({ draft: { financial: { ...emptySpillFinancial(), cleanupCost: "5", cleanupCostCurrency: "XX1" } } })).join(" "), /valid ISO 4217/);
  assert.equal(event.childCollections.find((c: any) => c.collectionId === CID.FINANCIAL).items.length, 1);
});

test("54. other impact: compact facts only, no copied Collision or Cargo outcome", () => {
  const event = newSpill({ facts: [[DP.roadwayInterruption, "YES"], [DP.operationalInterruption, "NO"], [DP.serviceImpact, "UNKNOWN"], [DP.otherImpactNote, "Dock door damaged by spill"]] });
  assert.deepEqual(messages(event), []);
  const view = describeSpillRelease(event).otherImpact;
  assert.deepEqual(view.facts.map((row: any) => [row.label, row.value]), [["Roadway Interruption", "Yes"], ["Operational Interruption", "No"], ["Service Impact", "Unknown"]]);
  assert.equal(view.note, "Dock door damaged by spill");
  assert.match(messages(newSpill({ facts: [[DP.serviceImpact, "BAD"]] })).join(" "), /Service Impact must be a controlled value/);
});

test("55. downstream enrichment: material identification can progress from Pending to Confirmed without losing the record; unknown stays valid", () => {
  const event = newSpill({ draft: { materials: [mat({ itemId: "MAT-1", category: "UNKNOWN", description: "Unknown liquid", identificationStatus: "PENDING_IDENTIFICATION", materialSource: "" })] } });
  const enriched = upsertSpillChild(event, { collectionId: CID.MATERIALS, itemId: "MAT-1", facts: { identificationStatus: "CONFIRMED", materialSource: "SDS", properShippingName: "Corrosive liquid", unId: "UN1760", hazardClass: "8", packingGroup: "II" } }).event;
  const view = describeSpillRelease(enriched).materials[0];
  assert.deepEqual([view.status, view.source, view.unId, view.title], ["Confirmed", "SDS", "UN1760", "Unknown liquid"]);
  assert.equal(readSpillMaterials(enriched).length, 1, "enrichment updates the record, it does not add a second material");
  assert.throws(() => upsertSpillChild(enriched, { collectionId: CID.MATERIALS, itemId: "MAT-1", facts: { identificationStatus: "UNKNOWN" } }), /cannot carry a proper shipping name/, "an observation cannot be downgraded while still claiming an identity");
  const addedStep = upsertSpillChild(event, { collectionId: CID.RESPONSE_TIMELINE, facts: { action: "CLEANUP_STARTED", timestamp: "2026-09-28T16:00" } });
  assert.equal(readSpillTimeline(addedStep.event)[0].ordinal, 1);
  const secondStep = upsertSpillChild(addedStep.event, { collectionId: CID.RESPONSE_TIMELINE, facts: { action: "CLEANUP_COMPLETED", timestamp: "2026-09-28T18:00" } });
  assert.deepEqual(readSpillTimeline(secondStep.event).map((entry: any) => entry.ordinal), [1, 2], "the next ordinal is assigned automatically");
  assert.throws(() => upsertSpillChild(secondStep.event, { collectionId: CID.RESPONSE_TIMELINE, facts: { action: "VEHICLE_STOPPED", timestamp: "2026-09-28T10:00" } }), /cannot be before the occurrence/);
  assert.throws(() => upsertSpillChild(event, { collectionId: CID.STATUS_HISTORY, facts: { x: "y" } }), /Unknown Spill/);
  assert.throws(() => upsertSpillChild(event, { collectionId: CID.MATERIALS, itemId: "NOPE", facts: { description: "x" } }), /not found/);
  const cleaned = upsertSpillChild(event, { collectionId: CID.CLEANUP, facts: { vendor: "Clean Co", disposalManifest: "MAN-1" } });
  assert.equal(readSpillCleanups(cleaned.event)[0].disposalManifest, "MAN-1");
  assert.ok(readSpillCleanups(cleaned.event)[0].recordedAt, "a new record stamps when it was recorded");
  const cleared = upsertSpillChild(cleaned.event, { collectionId: CID.CLEANUP, itemId: cleaned.itemId, facts: { disposalManifest: "" } });
  assert.equal(readSpillCleanups(cleared.event)[0].disposalManifest, "", "a cleared fact is empty");
});

test("56. persistence: enrichment survives a reload and the full downstream chain works through the data layer", () => {
  localStorage.clear(); seedVehicles();
  const saved = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newSpill({ draft: { obligations: [obligation({ notificationRequired: "YES", notificationStatus: "IN_PROGRESS" })] }, facts: [[DP.cleanupStatus, "IN_PROGRESS"]] })));
  assert.equal(flow(saved).state, "OPEN");
  const store = dd.loadCompanyDriverStore(COMPANY);
  const enriched = setSpillStatus(upsertSpillChild(saved, { collectionId: CID.REGULATORY_EXECUTIONS, itemId: "EXE-1", facts: { notificationStatus: "COMPLETED", notifiedAt: "2026-09-28T18:00" } }).event, { field: "cleanupStatus", to: "VERIFICATION_PENDING", changedBy: "SM" });
  localStorage.setItem(`tes_company_drivers_${COMPANY}`, JSON.stringify({ ...store, events: store.events.map((entry: any) => (entry.id === saved.id ? enriched : entry)) }));
  const loaded = dd.loadCompanyDriverStore(COMPANY).events.find((entry: any) => entry.id === saved.id);
  assert.equal(readSpillExecutions(loaded)[0].notificationStatus, "COMPLETED");
  assert.equal(deriveEventWorkflow(loaded, state([loaded])).state, "IN_REVIEW");
  assert.deepEqual(deriveEventWorkflow(loaded, state([loaded])).openReasons.map((reason: any) => reason.code), ["CLEANUP_VERIFICATION_PENDING"]);
  // invalid payloads are refused by the data layer, not only by the wizard
  const bad = newSpill({ draft: { steps: [step(1), { ...step(2), ordinal: "1" }] } });
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(bad)), /ordinals must be unique/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newSpill({ facts: [[DP.releaseCondition, "LEAKING"]] }))), /Invalid controlled value|Release Condition must be a controlled value/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newSpill({ draft: { materials: [mat({ identificationStatus: "UNKNOWN", unId: "UN1202" })] } }))), /cannot carry a proper shipping name/);
});

test("57. the structured-facts-only rule and readback neutrality: missing enrichment is never presented as compliant or non-compliant", () => {
  assert.match(messages(newSpill({ extra: { structuredFacts: { legacy: "x" } } })).join(" "), /structured facts only/);
  const bare = describeSpillRelease(newSpill({ draft: { materials: [] } }));
  assert.deepEqual([bare.materials, bare.quantities, bare.persons, bare.media, bare.timeline, bare.cleanups, bare.regulatory], [[], [], [], [], [], [], []]);
  assert.equal(bare.releasedQuantityEstablished, false);
  assert.equal(bare.personCounts, undefined);
  assert.ok(!/compliant|overdue|late|violation/i.test(JSON.stringify(bare)));
  const summary = buildSpillSummary(newSpill({ facts: [[DP.releaseDetermination, "CONFIRMED"]] }));
  assert.equal(summary.releaseLine, "Release Confirmed - Condition Active");
  assert.equal(summary.materialLine, "Diesel fuel");
  assert.match(summary.contextLine, /Sep 28, 2026 · Unit 101 · Hwy 2, AB/);
});

test("58. person Injury Status is explicit; injured is derived and never inferred from exposure, symptoms, first aid, evaluation, transport or hospitalization", () => {
  const injured = newSpill({ draft: { persons: [person({ itemId: "A", injuryStatus: "YES", injuryDescription: "Chemical burn to forearm", accessClassification: "RESTRICTED_MEDICAL" })] } });
  assert.deepEqual(messages(injured), []);
  assert.equal(deriveSpillPersonCounts(injured)?.injured, 1, "Yes derives one injured person");
  assert.equal(readSpillPersons(injured)[0].injuryDescription, "Chemical burn to forearm");
  assert.equal(describeSpillRelease(injured).persons[0].injury, "Yes");
  const no = newSpill({ draft: { persons: [person({ itemId: "A", injuryStatus: "NO", accessClassification: "RESTRICTED_MEDICAL" })] } });
  assert.equal(deriveSpillPersonCounts(no)?.injured, 0, "No does not count");
  const unknown = newSpill({ draft: { persons: [person({ itemId: "A", injuryStatus: "UNKNOWN" })] } });
  assert.equal(deriveSpillPersonCounts(unknown)?.injured, 0);
  assert.equal(readSpillPersons(unknown)[0].injuryStatus, "UNKNOWN", "Unknown stays Unknown, not No or Yes");
  assert.equal(describeSpillRelease(unknown).persons[0].injury, "Unknown");
  const unrecorded = newSpill({ draft: { persons: [person({ itemId: "A" })] } });
  assert.equal(describeSpillRelease(unrecorded).persons[0].injury, undefined, "an unrecorded injury status is not presented as No");
  const everythingElse = newSpill({ draft: { persons: [person({ itemId: "A", exposureStatus: "EXPOSED", symptomsReported: "YES", firstAid: "YES", medicalEvaluation: "AT_FACILITY", transported: "YES", hospitalized: "YES", accessClassification: "RESTRICTED_MEDICAL" })] } });
  assert.deepEqual(deriveSpillPersonCounts(everythingElse), { recorded: 1, exposed: 1, withSymptoms: 1, injured: 0, transported: 1, hospitalized: 1, fatalities: 0 }, "symptoms, hospitalization etc. never imply injury");
  const mixed = newSpill({ draft: { persons: [
    person({ itemId: "P1", exposureStatus: "EXPOSED", symptomsReported: "YES", injuryStatus: "NO", accessClassification: "RESTRICTED_MEDICAL" }), person({ itemId: "P2", injuryStatus: "YES", accessClassification: "RESTRICTED_MEDICAL" }),
    person({ itemId: "P3", injuryStatus: "YES", hospitalized: "YES", accessClassification: "RESTRICTED_MEDICAL" }), person({ itemId: "P4", exposureStatus: "NOT_EXPOSED", injuryStatus: "UNKNOWN" }),
  ] } });
  assert.deepEqual(deriveSpillPersonCounts(mixed), { recorded: 4, exposed: 3, withSymptoms: 1, injured: 2, transported: 0, hospitalized: 1, fatalities: 0 });
  assert.ok(!JSON.stringify(mixed).match(/peopleInjured|injuredCount|totalInjured/i), "no stored aggregate");
  assert.match(messages(newSpill({ draft: { persons: [person({ injuryStatus: "MAYBE" })] } })).join(" "), /Injury status must be a controlled value/);
  const tampered = newSpill({ draft: { persons: [person({ injuryStatus: "YES", injuryDescription: "x", accessClassification: "RESTRICTED_MEDICAL" })] } });
  tampered.childCollections.find((c: any) => c.collectionId === CID.PERSONS).items[0].facts.injuryStatus = "NO";
  assert.match(messages(tampered).join(" "), /injury description belongs only/, "the data layer rejects a description without Injury Status Yes");
  assert.equal(readSpillPersons(newSpill({ draft: { persons: [person({ injuryStatus: "NO", injuryDescription: "stale", accessClassification: "RESTRICTED_MEDICAL" })] } }))[0].injuryDescription, "", "a description is not stored unless Injury Status is Yes");
  assert.match(messages(newSpill({ draft: { persons: [person({ injuryStatus: "YES" })] } })).join(" "), /requires an access classification/);
  assert.match(messages(newSpill({ draft: { persons: [person({ evidenceIds: ["EV-X"] })] } })).join(" "), /not linked to this Spill/, "person evidence validation remains intact");
  assert.match(messages(newSpill({ draft: { persons: [person({ itemId: "P" }), person({ itemId: "P" })] } })).join(" "), /Person ids must be present and unique/);
  assert.equal(deriveSpillPersonCounts(setSpillStatus(mixed, { field: "releaseCondition", to: "STOPPED", changedBy: "SM" }))?.injured, 2);
});
