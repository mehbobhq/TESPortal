import "../../helpers/register-alias-loader.mjs";
import test, { before } from "node:test";
import assert from "node:assert/strict";

import {
  NEAR_MISS_COLLECTION_IDS,
  NEAR_MISS_IMMEDIATE_RESPONSES,
  NEAR_MISS_OPERATING_ACTIVITIES,
  NEAR_MISS_OTHER_PARTY_TYPES,
  NEAR_MISS_POTENTIAL_CONSEQUENCES,
  NEAR_MISS_POTENTIAL_SEVERITIES,
  NEAR_MISS_PRIMARY_TYPES,
  NEAR_MISS_SOURCES,
  NEAR_MISS_TYPE_GROUPS,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-near-miss-taxonomy.ts";
import {
  NEAR_MISS_DATA_POINTS as DP,
  buildNearMissMultiValueCollection,
  buildNearMissSummary,
  describeNearMiss,
  evaluateNearMissInvestigationRequirement,
  getNearMissPotentialSeverity,
  isLegacyNearMiss,
  isNewTaxonomyNearMiss,
  readNearMissMultiValues,
  resolveNearMissUnsafeCondition,
  setNearMissAssessedPotentialSeverity,
  validateNearMissMultiValues,
  validateNewNearMiss,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-near-miss.ts";
import {
  closePerformanceEventWorkflow,
  deriveWorkflow,
  setPerformanceInvestigationRequirement,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-workflow.ts";
import {
  deriveEventWorkflow,
  getWorkflowProvidersForEventType,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-workflow-registry.ts";
import {
  openPerformanceInvestigation,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-investigation.ts";

type DriverData = typeof import("../../../lib/driver-data");
type SchemaModule = typeof import("../../../lib/driver-performance-schema");
let dd: DriverData;
let schema: SchemaModule;
before(async () => {
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  dd = (await import("../../../lib/driver-data.ts")) as DriverData;
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  schema = (await import("../../../lib/driver-performance-schema.ts")) as SchemaModule;
});

const COMPANY = "C-NM";
const STAMP = "2026-09-28T12:00:00.000Z";
const fact = (dataPointId: string, value: string | number | boolean) => ({ dataPointId, value, valueType: typeof value === "number" ? ("number" as const) : ("string" as const) });
// The occurrence rules require an unsafe-condition answer; tests about other rules default it to NO.
const withUnsafe = <E extends { structuredEventFacts: Array<{ dataPointId: string; value: unknown; valueType: string }> }>(event: E): E => event.structuredEventFacts.some((item) => item.dataPointId === DP.unsafeConditionRemains) ? event : ({ ...event, structuredEventFacts: [...event.structuredEventFacts, { dataPointId: DP.unsafeConditionRemains, value: "NO", valueType: "string" }] });
const validateNew = (event: Parameters<typeof withUnsafe>[0] & Parameters<typeof validateNewNearMiss>[0]) => validateNewNearMiss(withUnsafe(event));
const multi = (collectionId: string, selected: string[]) => buildNearMissMultiValueCollection(collectionId, selected);

function newEvent(overrides: { facts?: Array<[string, string]>; collections?: Array<ReturnType<typeof multi>>; extra?: Record<string, unknown> } = {}) {
  const base: Array<[string, string]> = [[DP.primaryType, "MERGE_CONFLICT"], [DP.operatingActivity, "MERGING"]];
  // Later entries override earlier ones with the same data point id.
  const facts = [...new Map([...base, ...(overrides.facts || [])]).entries()].map(([id, value]) => fact(id, value));
  return {
    id: "NM-1", eventType: "Near Miss" as const, companyId: COMPANY, driverMasterId: "DRV-1", createdAt: STAMP,
    eventDate: "2026-09-28", eventTime: "14:05", location: "Hwy 2", stateProvince: "AB", country: "Canada", vehicleId: "VEH-1",
    canonicalLinks: [{ entityType: "Vehicle" as const, recordId: "VEH-1", label: "Unit 101", relationshipKey: "vehicle", source: "CANONICAL_STORE" as const }],
    structuredEventFacts: facts, childCollections: (overrides.collections || []).filter(Boolean) as never[],
    provenance: { sourceType: "SOURCE_FACT" as const, source: "Driver Self-report" }, evidenceIds: ["EV-1"],
    ...(overrides.extra || {}),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (events: ReturnType<typeof newEvent>[], extra: Record<string, unknown> = {}): any => ({ events, performanceInvestigations: [], companyActions: [], companyDeterminations: [], eventRelationships: [], ...extra });
const labels = (workflow: { reasons: Array<{ label: string }> }) => workflow.reasons.map((reason) => reason.label);

// ---------------------------------------------------------------- TAXONOMY
test("every Primary Near-Miss value is accepted; the taxonomy has the eight locked groups and exact terminology", () => {
  assert.equal(NEAR_MISS_TYPE_GROUPS.length, 8);
  assert.equal(NEAR_MISS_PRIMARY_TYPES.length, 8 + 6 + 6 + 6 + 8 + 6 + 5 + 4);
  for (const type of NEAR_MISS_PRIMARY_TYPES) assert.deepEqual(validateNew(newEvent({ facts: [[DP.primaryType, type.value]] })), [], type.value);
  const labelsList = NEAR_MISS_PRIMARY_TYPES.map((item: { label: string }) => item.label);
  assert.ok(labelsList.includes("Pre-trip / Inspection Concern"));
  assert.ok(!labelsList.some((label: string) => /inadequate pre-trip/i.test(label)));
  assert.equal(new Set(NEAR_MISS_PRIMARY_TYPES.map((item: { value: string }) => item.value)).size, NEAR_MISS_PRIMARY_TYPES.length);
});

test("the schema labels the field 'Primary Near-Miss Type' (never 'Near-Miss Configuration') and requires it for new records", () => {
  const fields = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Near Miss"].fields;
  const primary = fields.find((field) => field.key === "nearMissPrimaryType");
  assert.equal(primary?.label, "Primary Near-Miss Type");
  assert.equal(primary?.required, true);
  assert.ok(!fields.some((field) => field.label === "Near-Miss Configuration"));
  assert.ok(primary?.options?.every((option) => option.group));
  for (const [key, id] of Object.entries(DP)) assert.ok(fields.some((field) => field.dataPointId === id), `schema is missing ${key} (${id})`);
});

test("Secondary types are unique, come from the taxonomy and never repeat the Primary; Congestion is not a Secondary type", () => {
  assert.deepEqual(validateNearMissMultiValues({ primary: "MERGE_CONFLICT", secondary: ["UNSAFE_FOLLOWING_DISTANCE", "CUT_OFF"] }), []);
  assert.match(validateNearMissMultiValues({ primary: "MERGE_CONFLICT", secondary: ["MERGE_CONFLICT"] }).join(" "), /cannot also be a Secondary/);
  assert.match(validateNearMissMultiValues({ primary: "MERGE_CONFLICT", secondary: ["CUT_OFF", "CUT_OFF"] }).join(" "), /unique/);
  assert.match(validateNearMissMultiValues({ primary: "MERGE_CONFLICT", secondary: ["CONGESTION"] }).join(" "), /taxonomy/);
  const errors = validateNew(newEvent({ collections: [multi(NEAR_MISS_COLLECTION_IDS.SECONDARY_TYPES, ["MERGE_CONFLICT"])] }));
  assert.ok(errors.some((error) => /cannot also be a Secondary/.test(error)));
});

test("a multi-value collection stores one item per value, de-duplicates and reads back in order", () => {
  const collection = multi(NEAR_MISS_COLLECTION_IDS.POTENTIAL_CONSEQUENCES, ["COLLISION", "INJURY", "COLLISION"]);
  assert.deepEqual(collection?.items.map((item) => item.facts.value), ["COLLISION", "INJURY"]);
  assert.deepEqual(readNearMissMultiValues({ childCollections: collection ? [collection] : [] }, NEAR_MISS_COLLECTION_IDS.POTENTIAL_CONSEQUENCES), ["COLLISION", "INJURY"]);
  assert.equal(multi(NEAR_MISS_COLLECTION_IDS.POTENTIAL_CONSEQUENCES, []), undefined);
});

// ---------------------------------------------------------------- OCCURRENCE
test("a complete new record validates; each required occurrence field is individually enforced", () => {
  assert.deepEqual(validateNew(newEvent()), []);
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["event date", { eventDate: "" }, /Event Date/],
    ["event time", { eventTime: "" }, /Event Time/],
    ["driver", { driverMasterId: "" }, /Driver/],
    ["power unit", { vehicleId: undefined, canonicalLinks: [] }, /Power Unit/],
    ["location", { location: "" }, /Location/],
    ["country", { country: "" }, /Country/],
    ["source", { provenance: { sourceType: "SOURCE_FACT", source: "" } }, /Source/],
  ];
  for (const [name, extra, pattern] of cases) assert.match(validateNew(newEvent({ extra })).join(" "), pattern, name);
  const missingActivity = newEvent();
  missingActivity.structuredEventFacts = missingActivity.structuredEventFacts.filter((item) => item.dataPointId !== DP.operatingActivity);
  assert.match(validateNew(missingActivity).join(" "), /Operating Activity is required/);
  const missingPrimary = newEvent();
  missingPrimary.structuredEventFacts = missingPrimary.structuredEventFacts.filter((item) => item.dataPointId !== DP.primaryType);
  assert.match(validateNew(missingPrimary).join(" "), /Primary Near-Miss Type is required/);
});

test("operating activity accepts exactly the locked values", () => {
  assert.equal(NEAR_MISS_OPERATING_ACTIVITIES.length, 9);
  for (const item of NEAR_MISS_OPERATING_ACTIVITIES) assert.deepEqual(validateNew(newEvent({ facts: [[DP.operatingActivity, item.value]] })), [], item.value);
  assert.match(validateNew(newEvent({ facts: [[DP.operatingActivity, "FLYING"]] })).join(" "), /controlled value/);
});

test("time zone must be an IANA identifier, never an abbreviation", () => {
  assert.deepEqual(validateNew(newEvent({ facts: [[DP.eventTimeZone, "America/Edmonton"]] })), []);
  assert.match(validateNew(newEvent({ facts: [[DP.eventTimeZone, "MST"]] })).join(" "), /IANA/);
  assert.match(validateNew(newEvent({ facts: [[DP.eventTimeZone, "Mars/Olympus_Mons"]] })).join(" "), /IANA/);
});

test("other party type is controlled and Other requires a description", () => {
  assert.equal(NEAR_MISS_OTHER_PARTY_TYPES.length, 14);
  assert.deepEqual(validateNew(newEvent({ facts: [[DP.otherPartyType, "PASSENGER_VEHICLE"]] })), []);
  assert.match(validateNew(newEvent({ facts: [[DP.otherPartyType, "OTHER"]] })).join(" "), /Describe the Other Party/);
  assert.deepEqual(validateNew(newEvent({ facts: [[DP.otherPartyType, "OTHER"], [DP.otherPartyObject, "Stray shopping cart"]] })), []);
});

// ---------------------------------------------------------------- CONSEQUENCES / SEVERITY / RESPONSE
test("potential consequences persist as a multi-select and Other needs an explanation", () => {
  assert.equal(NEAR_MISS_POTENTIAL_CONSEQUENCES.length, 9);
  const ok = newEvent({ collections: [multi(NEAR_MISS_COLLECTION_IDS.POTENTIAL_CONSEQUENCES, ["COLLISION", "INJURY", "OTHER"])], facts: [[DP.potentialConsequenceOther, "Bridge strike"]] });
  assert.deepEqual(validateNew(ok), []);
  assert.deepEqual(describeNearMiss(ok).potentialConsequences, ["Collision", "Injury", "Other"]);
  const noText = newEvent({ collections: [multi(NEAR_MISS_COLLECTION_IDS.POTENTIAL_CONSEQUENCES, ["OTHER"])] });
  assert.match(validateNew(noText).join(" "), /Other Potential Consequence/);
});

test("immediate responses persist as a multi-select and Other needs an explanation", () => {
  assert.equal(NEAR_MISS_IMMEDIATE_RESPONSES.length, 8);
  const ok = newEvent({ collections: [multi(NEAR_MISS_COLLECTION_IDS.IMMEDIATE_RESPONSES, ["BRAKED", "STEERED_EVADED", "OTHER"])], facts: [[DP.immediateResponseOther, "Flashed lights"]] });
  assert.deepEqual(validateNew(ok), []);
  assert.deepEqual(describeNearMiss(ok).immediateResponses, ["Braked", "Steered / Evaded", "Other"]);
  assert.match(validateNew(newEvent({ collections: [multi(NEAR_MISS_COLLECTION_IDS.IMMEDIATE_RESPONSES, ["OTHER"])] })).join(" "), /Other Immediate Response/);
});

test("potential severity accepts the four values and keeps reported and TES-assessed distinct", () => {
  assert.equal(NEAR_MISS_POTENTIAL_SEVERITIES.length, 4);
  for (const item of NEAR_MISS_POTENTIAL_SEVERITIES) assert.deepEqual(validateNew(newEvent({ facts: [[DP.potentialSeverityReported, item.value]] })), [], item.value);
  const reported = newEvent({ facts: [[DP.potentialSeverityReported, "SERIOUS"]] });
  const before = getNearMissPotentialSeverity(reported);
  assert.equal(before.reported, "SERIOUS");
  assert.equal(before.assessed, undefined, "a reported Serious must never become TES-assessed");
  assert.deepEqual(before.effective, { value: "SERIOUS", basis: "SOURCE_REPORTED" });
  const assessed = setNearMissAssessedPotentialSeverity(reported, { value: "MODERATE", assessedBy: "Safety Manager", at: STAMP });
  const after = getNearMissPotentialSeverity(assessed);
  assert.equal(after.reported, "SERIOUS");
  assert.equal(after.assessed, "MODERATE");
  assert.deepEqual(after.effective, { value: "MODERATE", basis: "TES_ASSESSED" });
  assert.equal(after.assessedBy, "Safety Manager");
  assert.throws(() => setNearMissAssessedPotentialSeverity(reported, { value: "LOW", assessedBy: " " }), /assessedBy/);
  assert.match(validateNew(newEvent({ facts: [[DP.potentialSeverityAssessed, "SERIOUS"]] })).join(" "), /who assessed/);
  assert.equal(describeNearMiss(assessed).severity.effectiveBasis, "TES-assessed");
  assert.equal(describeNearMiss(reported).severity.effectiveBasis, "source-reported");
});

// ---------------------------------------------------------------- UNSAFE CONDITION + WORKFLOW
test("unsafe condition Yes -> workflow Open with the reason and its source", () => {
  const event = newEvent({ facts: [[DP.unsafeConditionRemains, "YES"]] });
  const workflow = deriveEventWorkflow(event, state([event]));
  assert.equal(workflow.state, "OPEN");
  assert.ok(labels(workflow).includes("Unsafe condition remains"));
  const reason = workflow.openReasons.find((item: { code: string }) => item.code === "UNSAFE_CONDITION_REMAINS");
  assert.deepEqual(reason?.source, { type: "EventFact", id: "NM-1#unsafeConditionRemains" });
});

test("unsafe condition No -> no unsafe-condition obligation", () => {
  const event = newEvent({ facts: [[DP.unsafeConditionRemains, "NO"]] });
  const workflow = deriveEventWorkflow(event, state([event]));
  assert.equal(workflow.state, "NOT_REQUIRED");
  assert.deepEqual(workflow.reasons, []);
});

test("unsafe condition Unknown is never treated as resolved: it surfaces a clarification review", () => {
  const event = newEvent({ facts: [[DP.unsafeConditionRemains, "UNKNOWN"]] });
  const workflow = deriveEventWorkflow(event, state([event]));
  assert.equal(workflow.state, "IN_REVIEW");
  assert.equal(workflow.openReasons.length, 1);
  assert.equal(workflow.openReasons[0].code, "REQUIRED_REVIEW_OUTSTANDING");
  assert.match(String(workflow.openReasons[0].detail), /unknown/i);
  assert.equal(evaluateNearMissInvestigationRequirement(event).required, false);
  const clarified = resolveNearMissUnsafeCondition(event, { outcome: "CLARIFIED_NO_UNSAFE_CONDITION", resolvedBy: "Reviewer", at: "2026-09-29T00:00:00.000Z" });
  assert.equal(deriveEventWorkflow(clarified, state([clarified])).state, "READY_TO_CLOSE");
});

test("a not-captured unsafe-condition answer creates no obligation (legacy-compatible)", () => {
  const event = newEvent();
  assert.equal(deriveEventWorkflow(event, state([event])).state, "NOT_REQUIRED");
});

test("unsafe condition + required corrective action produce BOTH reasons, with source ids and a stable order", () => {
  const event = newEvent({ facts: [[DP.unsafeConditionRemains, "YES"]] });
  const action = { id: "ACT-1", companyId: COMPANY, driverMasterId: "DRV-1", actionType: "COACHING", title: "Merge coaching", decidedBy: "M", factualBasis: "f", effectiveDate: "2026-09-29", status: "Active", linkedEventIds: ["NM-1"], closureRequirement: "REQUIRED", isArchived: false, createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z" };
  const s = state([event], { companyActions: [action] });
  const workflow = deriveEventWorkflow(event, s);
  assert.equal(workflow.state, "OPEN");
  // Unsafe condition = Yes also triggers the locked investigation requirement, so that reason is listed between the two.
  assert.deepEqual(labels(workflow), ["Unsafe condition remains", "Investigation incomplete", "Corrective action outstanding"]);
  assert.deepEqual(workflow.reasons.map((reason: { source: { type: string } }) => reason.source.type), ["EventFact", "EventFact", "CompanyAction"]);
  assert.equal(workflow.reasons[2].source.id, "ACT-1");
  assert.deepEqual(labels(deriveEventWorkflow(event, s)), labels(workflow));
  // A reviewer release does not suppress a policy-required investigation: all three reasons stay.
  const released = setPerformanceInvestigationRequirement(s, "NM-1", { required: false, reason: "Reviewed", setBy: "SM" });
  assert.deepEqual(labels(deriveEventWorkflow(released.state.events[0] as never, released.state)), ["Unsafe condition remains", "Investigation incomplete", "Corrective action outstanding"]);
  // The generic providers alone would not know about the unsafe condition: the family provider is what adds it.
  assert.equal(getWorkflowProvidersForEventType("Near Miss").length, getWorkflowProvidersForEventType("Collision").length + 1);
  assert.deepEqual(labels(deriveWorkflow(event, s, getWorkflowProvidersForEventType("Collision"))), ["Corrective action outstanding"]);
});

test("resolving the unsafe condition removes that open reason while a required action keeps the event Open independently", () => {
  const event = newEvent({ facts: [[DP.unsafeConditionRemains, "YES"]] });
  const resolved = resolveNearMissUnsafeCondition(event, { resolvedBy: "Safety Manager", note: "Guard rail repaired", at: "2026-09-30T00:00:00.000Z" });
  const action = { id: "ACT-1", companyId: COMPANY, driverMasterId: "DRV-1", actionType: "COACHING", title: "Merge coaching", decidedBy: "M", factualBasis: "f", effectiveDate: "2026-09-29", status: "Active", linkedEventIds: ["NM-1"], closureRequirement: "REQUIRED", isArchived: false, createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z" };
  const withAction = deriveEventWorkflow(resolved, state([resolved], { companyActions: [action] }));
  assert.equal(withAction.state, "OPEN");
  // Resolving removes only the current unsafe-condition reason; the original policy trigger (and its investigation) remains.
  assert.deepEqual(labels(withAction), ["Investigation incomplete", "Corrective action outstanding"]);
  assert.equal(evaluateNearMissInvestigationRequirement(resolved).policyRequired, true);
  assert.ok(withAction.resolvedReasons.some((reason: { code: string; resolvedBy?: string }) => reason.code === "UNSAFE_CONDITION_REMAINS" && reason.resolvedBy === "Safety Manager"));
  // The reporter's occurrence fact is never rewritten.
  assert.equal(describeNearMiss(resolved).unsafeCondition, "Yes");
  assert.match(String(describeNearMiss(resolved).unsafeConditionResolution), /Resolved by Safety Manager/);
  assert.throws(() => resolveNearMissUnsafeCondition(newEvent({ facts: [[DP.unsafeConditionRemains, "NO"]] }), { resolvedBy: "x" }), /Yes or Unknown/);
});

test("obligations resolved -> Ready to Close, never an automatic Closed; closing is a deliberate act", () => {
  const event = newEvent({ facts: [[DP.unsafeConditionRemains, "UNKNOWN"]] });
  assert.equal(deriveEventWorkflow(event, state([event])).state, "IN_REVIEW");
  const clarified = resolveNearMissUnsafeCondition(event, { outcome: "CLARIFIED_NO_UNSAFE_CONDITION", resolvedBy: "SM", at: "2026-09-30T00:00:00.000Z" });
  const s = state([clarified]);
  const workflow = deriveEventWorkflow(clarified, s);
  assert.equal(workflow.state, "READY_TO_CLOSE");
  assert.notEqual(workflow.state, "CLOSED");
  const closed = closePerformanceEventWorkflow(s, "NM-1", { closedBy: "SM", providers: getWorkflowProvidersForEventType("Near Miss") });
  assert.equal(deriveEventWorkflow(closed.state.events[0] as never, closed.state).state, "CLOSED");
  // A policy-required investigation blocks closure even after the unsafe condition is resolved and a reviewer "releases" it.
  const yes = resolveNearMissUnsafeCondition(newEvent({ facts: [[DP.unsafeConditionRemains, "YES"]] }), { resolvedBy: "SM", at: "2026-09-30T00:00:00.000Z" });
  const releasedYes = setPerformanceInvestigationRequirement(state([yes]), "NM-1", { required: false, setBy: "SM" });
  assert.equal(deriveEventWorkflow(releasedYes.state.events[0] as never, releasedYes.state).state, "OPEN");
  assert.throws(() => closePerformanceEventWorkflow(releasedYes.state, "NM-1", { closedBy: "SM", providers: getWorkflowProvidersForEventType("Near Miss") }), /cannot be closed/);
});

// ---------------------------------------------------------------- INVESTIGATION REQUIREMENT
test("investigation requirement triggers: TES-assessed Serious/Catastrophic, unsafe Yes, reviewer; not Low/Moderate alone", () => {
  const withAssessed = (value: string) => setNearMissAssessedPotentialSeverity(newEvent(), { value: value as never, assessedBy: "SM", at: STAMP });
  assert.deepEqual(evaluateNearMissInvestigationRequirement(withAssessed("SERIOUS")).triggers, ["TES_ASSESSED_SEVERITY"]);
  assert.equal(evaluateNearMissInvestigationRequirement(withAssessed("CATASTROPHIC")).required, true);
  assert.equal(evaluateNearMissInvestigationRequirement(withAssessed("LOW")).required, false);
  assert.equal(evaluateNearMissInvestigationRequirement(withAssessed("MODERATE")).required, false);
  assert.deepEqual(evaluateNearMissInvestigationRequirement(newEvent({ facts: [[DP.unsafeConditionRemains, "YES"]] })).triggers, ["UNSAFE_CONDITION_REMAINS"]);
  const explicit = setPerformanceInvestigationRequirement(state([newEvent()]), "NM-1", { required: true, setBy: "SM" }).event;
  assert.deepEqual(evaluateNearMissInvestigationRequirement(explicit as never).triggers, ["REVIEWER_REQUIRED"]);
});

test("reported Serious without a TES assessment does not masquerade as one: it surfaces a review instead", () => {
  const event = newEvent({ facts: [[DP.potentialSeverityReported, "CATASTROPHIC"]] });
  const policy = evaluateNearMissInvestigationRequirement(event);
  assert.equal(policy.required, false);
  assert.equal(policy.reportedSeverityAwaitsAssessment, true);
  const workflow = deriveEventWorkflow(event, state([event]));
  assert.equal(workflow.state, "IN_REVIEW");
  assert.match(String(workflow.openReasons[0].detail), /awaits TES assessment/);
  const assessed = setNearMissAssessedPotentialSeverity(event, { value: "LOW", assessedBy: "SM", at: STAMP });
  assert.equal(deriveEventWorkflow(assessed, state([assessed])).state, "READY_TO_CLOSE");
  const low = newEvent({ facts: [[DP.potentialSeverityReported, "LOW"]] });
  assert.equal(evaluateNearMissInvestigationRequirement(low).reportedSeverityAwaitsAssessment, false);
});

test("required investigation: not started -> Open; in progress and awaiting information follow the engine; never auto-completed", () => {
  const event = setNearMissAssessedPotentialSeverity(newEvent(), { value: "SERIOUS", assessedBy: "SM", at: STAMP });
  const none = deriveEventWorkflow(event, state([event]));
  assert.equal(none.state, "OPEN");
  assert.equal(none.openReasons[0].code, "INVESTIGATION_INCOMPLETE");
  assert.match(String(none.openReasons[0].detail), /not started/);
  const opened = openPerformanceInvestigation(state([event]), { eventId: "NM-1", openedBy: "SM" } as never);
  const inProgress = deriveEventWorkflow(event, opened.state);
  assert.equal(inProgress.state, "OPEN");
  assert.equal(inProgress.openReasons.length, 1);
  assert.equal(inProgress.openReasons[0].source.type, "Investigation");
  // An explicit reviewer requirement is reported once (by the generic provider), not twice.
  const explicit = setPerformanceInvestigationRequirement(state([event]), "NM-1", { required: true, setBy: "SM" });
  assert.equal(deriveEventWorkflow(explicit.state.events[0] as never, explicit.state).openReasons.filter((reason: { code: string }) => reason.code === "INVESTIGATION_INCOMPLETE").length, 1);
});

// ---------------------------------------------------------------- SOURCE / EVIDENCE / LEGACY
test("source is the canonical provenance source; source and evidence stay separate; no duplicate source-of-truth fact is written", () => {
  assert.deepEqual(NEAR_MISS_SOURCES.map((item: { value: string }) => item.value), ["Driver Self-report", "Dashcam / AI", "Telematics", "Dispatcher", "Customer", "Public Complaint", "Safety Manager", "Other"]);
  const policy = schema.resolvePerformanceSourcePolicy(schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Near Miss"]);
  assert.deepEqual(policy.authoritativeSourceTypes.map((item) => item.value), NEAR_MISS_SOURCES.map((item: { value: string }) => item.value));
  const event = newEvent({ extra: { provenance: { sourceType: "SOURCE_FACT", source: "Dashcam / AI" }, evidenceIds: ["EV-CLIP"] } });
  assert.deepEqual(validateNew(event), []);
  assert.equal(describeNearMiss(event).source, "Dashcam / AI");
  assert.deepEqual(event.evidenceIds, ["EV-CLIP"]);
  assert.match(validateNew(newEvent({ extra: { provenance: { sourceType: "SOURCE_FACT", source: "Driver Report" } } })).join(" "), /Source/);
  const fields = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Near Miss"].fields;
  for (const key of ["nearMissType", "triggerSource", "avoidanceAction"]) assert.equal(fields.find((field) => field.key === key)?.hiddenInCreation, true, key);
  const withLegacy = newEvent({ facts: [[DP.legacyTriggerSource, "FORWARD_CAMERA"]] });
  assert.match(validateNew(withLegacy).join(" "), /Legacy Near Miss fields/);
});

const legacyEvent = (facts: Array<[string, string]> = [[DP.legacyType, "REAR_END_RISK"], [DP.legacyTriggerSource, "FORWARD_CAMERA"]]) => ({
  id: "NM-OLD", eventType: "Near Miss" as const, companyId: COMPANY, driverMasterId: "DRV-1", createdAt: "2024-01-01T00:00:00.000Z", eventDate: "2024-01-01", summary: "Old near miss",
  structuredEventFacts: [...facts.map(([id, value]) => fact(id, value)), fact("DRV.PERF.NEAR_MISS.OTHERPARTYOBJECT", "Grey sedan"), fact(DP.distanceToImpact, 4)],
  provenance: { sourceType: "SOURCE_FACT" as const, source: "Driver Report" }, evidenceIds: [],
});

test("legacy records stay readable: old taxonomy preserved and labelled as legacy, legacy trigger source readable, new rules not applied", () => {
  const old = legacyEvent();
  assert.equal(isLegacyNearMiss(old), true);
  assert.equal(isNewTaxonomyNearMiss(old), false);
  const description = describeNearMiss(old);
  assert.equal(description.legacy, true);
  assert.equal(description.primaryType, "Rear-End Risk (legacy)");
  assert.equal(description.legacyTriggerSource, "Forward Camera");
  assert.equal(description.source, "Driver Report");
  assert.equal(description.otherPartyDescription, "Grey sedan");
  assert.deepEqual(description.measurements, [{ label: "Distance to Impact", value: "4 m" }]);
  assert.equal(description.operatingActivity, undefined);
  assert.deepEqual(description.secondaryTypes, []);
  assert.equal(buildNearMissSummary(old).contextLine, "Jan 1, 2024 · Rear-End Risk (legacy)");
  // The old Backing Conflict value is NOT silently reinterpreted as the new taxonomy's Backing Conflict.
  const backing = describeNearMiss(legacyEvent([[DP.legacyType, "BACKING_CONFLICT"]]));
  assert.equal(backing.legacy, true);
  assert.equal(backing.primaryType, "Backing Conflict (legacy)");
  // A legacy record with only the deprecated structuredFacts projection still renders.
  const projection = describeNearMiss({ id: "NM-P", eventType: "Near Miss", structuredFacts: { nearMissType: "ROLLOVER_RISK", triggerSource: "DRIVER_REPORT" } });
  assert.equal(projection.primaryType, "Rollover Risk (legacy)");
  assert.equal(projection.legacyTriggerSource, "Driver Report");
  // Legacy events have no obligations, so the workflow engine reports NOT_REQUIRED for them.
  assert.equal(deriveEventWorkflow(old as never, state([old as never])).state, "NOT_REQUIRED");
});

// ---------------------------------------------------------------- PRESENTATION
test("saved-event readback uses human-readable labels, never raw canonical strings, and keeps the summary hierarchy", () => {
  const event = newEvent({
    facts: [[DP.potentialSeverityReported, "SERIOUS"], [DP.otherPartyType, "COMMERCIAL_VEHICLE"], [DP.unsafeConditionRemains, "YES"], [DP.reporterDescription, "A truck cut in front of me."], [DP.roadHighway, "Hwy 2"], [DP.eventTimeZone, "America/Edmonton"]],
    collections: [multi(NEAR_MISS_COLLECTION_IDS.SECONDARY_TYPES, ["UNSAFE_FOLLOWING_DISTANCE"]), multi(NEAR_MISS_COLLECTION_IDS.POTENTIAL_CONSEQUENCES, ["COLLISION"]), multi(NEAR_MISS_COLLECTION_IDS.IMMEDIATE_RESPONSES, ["STEERED_EVADED", "NOTIFIED_DISPATCH"])],
    extra: { city: "Calgary" },
  });
  const description = describeNearMiss(event);
  const text = JSON.stringify(description);
  for (const raw of ["MERGE_CONFLICT", "STEERED_EVADED", "SERIOUS", "UNSAFE_FOLLOWING_DISTANCE", "COMMERCIAL_VEHICLE", "MERGING"]) assert.ok(!text.includes(raw), `raw enum leaked: ${raw}`);
  assert.equal(description.primaryType, "Merge Conflict");
  assert.equal(description.primaryTypeGroup, "Vehicle Conflict");
  assert.deepEqual(description.secondaryTypes, ["Unsafe Following Distance"]);
  assert.deepEqual(description.immediateResponses, ["Steered / Evaded", "Notified Dispatch"]);
  assert.equal(description.reporterDescription, "A truck cut in front of me.");
  const summary = buildNearMissSummary(event);
  assert.equal(summary.title, "Near Miss");
  assert.equal(summary.severityLine, "Potential Severity: Serious (reported)");
  assert.equal(summary.contextLine, "Sep 28, 2026 · Merge Conflict · Unit 101 · Hwy 2, Calgary, AB");
  const bare = buildNearMissSummary({ id: "x", eventType: "Near Miss" });
  assert.equal(bare.severityLine, undefined);
  assert.equal(bare.contextLine, "");
});

// ---------------------------------------------------------------- PERSISTENCE (data layer)
const VEH_KEY = `tes_company_vehicles_${COMPANY}`;
function seedVehicles() {
  localStorage.setItem(VEH_KEY, JSON.stringify({ version: 1, vehicles: [{ id: "VEH-1", unitNumber: "101", equipmentType: "Tractor" }, { id: "TRL-1", unitNumber: "T-9", equipmentType: "Trailer - Dry Van" }] }));
}
const payloadFrom = (input: ReturnType<typeof newEvent>) => {
  const event = withUnsafe(input);
  const { id: _id, companyId: _c, driverMasterId: _d, createdAt: _created, ...rest } = event;
  return { ...rest, severity: "Not Applicable", status: "Not Applicable", summary: "Merge near miss", description: "d", chronology: [], linkedRecords: [] } as never;
};

test("a new Near Miss persists through addPerformanceEvent with its multi-values, relationships and provenance intact after reload", () => {
  localStorage.clear();
  seedVehicles();
  const event = newEvent({
    facts: [[DP.potentialSeverityReported, "SERIOUS"], [DP.unsafeConditionRemains, "YES"], [DP.reporterDescription, "A truck cut in front of me."]],
    collections: [multi(NEAR_MISS_COLLECTION_IDS.SECONDARY_TYPES, ["CUT_OFF"]), multi(NEAR_MISS_COLLECTION_IDS.POTENTIAL_CONSEQUENCES, ["COLLISION", "INJURY"]), multi(NEAR_MISS_COLLECTION_IDS.IMMEDIATE_RESPONSES, ["BRAKED"])],
  });
  event.canonicalLinks.push({ entityType: "Trailer" as never, recordId: "TRL-1", label: "Trailer T-9", relationshipKey: "trailer", source: "CANONICAL_STORE" });
  const saved = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(event));
  const store = dd.loadCompanyDriverStore(COMPANY);
  const loaded = store.events.find((item) => item.id === saved.id)!;
  assert.equal(loaded.vehicleId, "VEH-1");
  assert.deepEqual(loaded.canonicalLinks?.map((link) => [link.entityType, link.recordId, link.relationshipKey]), [["Vehicle", "VEH-1", "vehicle"], ["Trailer", "TRL-1", "trailer"]]);
  assert.deepEqual(readNearMissMultiValues(loaded, NEAR_MISS_COLLECTION_IDS.POTENTIAL_CONSEQUENCES), ["COLLISION", "INJURY"]);
  assert.deepEqual(readNearMissMultiValues(loaded, NEAR_MISS_COLLECTION_IDS.SECONDARY_TYPES), ["CUT_OFF"]);
  assert.equal(loaded.provenance?.source, "Driver Self-report");
  assert.equal(describeNearMiss(loaded).primaryType, "Merge Conflict");
  const workflow = deriveEventWorkflow(loaded as never, store as never);
  assert.equal(workflow.state, "OPEN");
  assert.ok(labels(workflow).includes("Unsafe condition remains"));
  // Append-only resolution through the data layer survives reload.
  dd.resolveNearMissUnsafeConditionForEvent(COMPANY, saved.id, { resolvedBy: "Safety Manager", note: "Fixed" });
  const reloaded = dd.loadCompanyDriverStore(COMPANY).events.find((item) => item.id === saved.id)!;
  assert.equal(describeNearMiss(reloaded).unsafeCondition, "Yes");
  assert.match(String(describeNearMiss(reloaded).unsafeConditionResolution), /Safety Manager/);
});

test("the data layer rejects a new Near Miss missing required fields or pointing at a non-existent Power Unit", () => {
  localStorage.clear();
  seedVehicles();
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent({ extra: { eventTime: "" } }))), /Event Time/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent({ extra: { vehicleId: undefined, canonicalLinks: [] } }))), /Power Unit/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent({ extra: { vehicleId: "VEH-GHOST", canonicalLinks: [{ entityType: "Vehicle", recordId: "VEH-GHOST", relationshipKey: "vehicle", source: "CANONICAL_STORE" }] } }))), /does not exist/);
});

test("a legacy Near Miss already in storage loads and renders; missing new required fields never make it unreadable", () => {
  localStorage.clear();
  const key = `tes_company_drivers_${COMPANY}`;
  localStorage.setItem(key, JSON.stringify({ version: 2, companyId: COMPANY, relationships: [], events: [{ ...legacyEvent(), description: "old", severity: "Not Applicable", status: "Not Applicable", chronology: [] }] }));
  const store = dd.loadCompanyDriverStore(COMPANY);
  const old = store.events.find((item) => item.id === "NM-OLD")!;
  assert.equal(old.eventType, "Near Miss");
  assert.equal(describeNearMiss(old).primaryType, "Rear-End Risk (legacy)");
  dd.saveCompanyDriverStore(store);
  assert.equal(describeNearMiss(dd.loadCompanyDriverStore(COMPANY).events.find((item) => item.id === "NM-OLD")!).primaryType, "Rear-End Risk (legacy)");
  // Existing legacy facts were not remapped to a new-taxonomy value.
  assert.ok(!dd.loadCompanyDriverStore(COMPANY).events[0].structuredEventFacts?.some((item) => item.dataPointId === DP.primaryType));
});

// ---------------------------------------------------------------- CLOSURE PASS
test("Unsafe Condition Remains? is required for a new Near Miss: blank rejected, Yes / No / Unknown accepted, anything else rejected", () => {
  const blank = newEvent();
  assert.match(validateNewNearMiss(blank).join(" "), /Unsafe Condition Remains\? is required/);
  for (const value of ["YES", "NO", "UNKNOWN"]) assert.deepEqual(validateNewNearMiss(newEvent({ facts: [[DP.unsafeConditionRemains, value]] })), [], value);
  assert.match(validateNewNearMiss(newEvent({ facts: [[DP.unsafeConditionRemains, "MAYBE"]] })).join(" "), /Yes, No or Unknown/);
  const field = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Near Miss"].fields.find((item) => item.key === "unsafeConditionRemains");
  assert.equal(field?.required, true);
});

test("the data layer rejects a new Near Miss with a blank unsafe condition and accepts the three answers", () => {
  localStorage.clear();
  seedVehicles();
  const complete = payloadFrom(newEvent()) as unknown as { structuredEventFacts: Array<{ dataPointId: string }> };
  const blank = { ...complete, structuredEventFacts: complete.structuredEventFacts.filter((item) => item.dataPointId !== DP.unsafeConditionRemains) };
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", blank as never), /Unsafe Condition Remains/);
  for (const value of ["YES", "NO", "UNKNOWN"]) assert.doesNotThrow(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent({ facts: [[DP.unsafeConditionRemains, value]] }))), value);
});

test("a legacy Near Miss with no unsafe-condition value stays readable and unchanged", () => {
  const old = legacyEvent();
  assert.equal(describeNearMiss(old).unsafeCondition, undefined);
  assert.equal(deriveEventWorkflow(old as never, state([old as never])).state, "NOT_REQUIRED");
  localStorage.clear();
  localStorage.setItem(`tes_company_drivers_${COMPANY}`, JSON.stringify({ version: 2, companyId: COMPANY, relationships: [], events: [{ ...old, description: "old", severity: "Not Applicable", status: "Not Applicable", chronology: [] }] }));
  const store = dd.loadCompanyDriverStore(COMPANY);
  dd.saveCompanyDriverStore(store);
  const reloaded = dd.loadCompanyDriverStore(COMPANY).events[0];
  assert.ok(!reloaded.structuredEventFacts?.some((item) => item.dataPointId === DP.unsafeConditionRemains));
  assert.equal(describeNearMiss(reloaded).primaryType, "Rear-End Risk (legacy)");
});

test("investigation precedence: a reviewer may add and withdraw REVIEWER_REQUIRED but cannot release POLICY_REQUIRED", () => {
  // Reviewer-only requirement can be added and withdrawn.
  const plain = newEvent({ facts: [[DP.unsafeConditionRemains, "NO"]] });
  const added = setPerformanceInvestigationRequirement(state([plain]), "NM-1", { required: true, setBy: "SM" });
  const addedPolicy = evaluateNearMissInvestigationRequirement(added.event as never);
  assert.deepEqual([addedPolicy.policyRequired, addedPolicy.reviewerRequired, addedPolicy.required], [false, true, true]);
  const withdrawn = setPerformanceInvestigationRequirement(added.state, "NM-1", { required: false, setBy: "SM" });
  const withdrawnPolicy = evaluateNearMissInvestigationRequirement(withdrawn.event as never);
  assert.deepEqual([withdrawnPolicy.policyRequired, withdrawnPolicy.reviewerRequired, withdrawnPolicy.required, withdrawnPolicy.explicitlyReleased], [false, false, false, true]);
  assert.equal(deriveEventWorkflow(withdrawn.event as never, withdrawn.state).state, "NOT_REQUIRED");

  // Policy triggers survive a reviewer release.
  const assessed = setNearMissAssessedPotentialSeverity(newEvent({ facts: [[DP.unsafeConditionRemains, "NO"]] }), { value: "SERIOUS", assessedBy: "SM", at: STAMP });
  const releasedAssessed = setPerformanceInvestigationRequirement(state([assessed]), "NM-1", { required: false, setBy: "SM" });
  const assessedPolicy = evaluateNearMissInvestigationRequirement(releasedAssessed.event as never);
  assert.deepEqual([assessedPolicy.policyRequired, assessedPolicy.required, assessedPolicy.explicitlyReleased], [true, true, true]);
  assert.equal(deriveEventWorkflow(releasedAssessed.event as never, releasedAssessed.state).openReasons[0].code, "INVESTIGATION_INCOMPLETE");

  // Reviewer AND policy together: reported once.
  const both = setPerformanceInvestigationRequirement(state([assessed]), "NM-1", { required: true, setBy: "SM" });
  assert.equal(deriveEventWorkflow(both.event as never, both.state).openReasons.filter((reason: { code: string }) => reason.code === "INVESTIGATION_INCOMPLETE").length, 1);

  // Reported severity alone is never POLICY_REQUIRED until TES assesses it; the review reason stays.
  const reported = newEvent({ facts: [[DP.unsafeConditionRemains, "NO"], [DP.potentialSeverityReported, "CATASTROPHIC"]] });
  const reportedPolicy = evaluateNearMissInvestigationRequirement(reported);
  assert.deepEqual([reportedPolicy.policyRequired, reportedPolicy.reportedSeverityAwaitsAssessment], [false, true]);
  assert.match(String(deriveEventWorkflow(reported, state([reported])).openReasons[0].detail), /awaits TES assessment/);

  // Resolving the unsafe condition removes the current reason but never the historical policy trigger.
  const yes = newEvent({ facts: [[DP.unsafeConditionRemains, "YES"]] });
  const resolved = resolveNearMissUnsafeCondition(yes, { resolvedBy: "SM", at: "2026-09-30T00:00:00.000Z" });
  assert.equal(evaluateNearMissInvestigationRequirement(resolved).policyRequired, true);
  assert.deepEqual(evaluateNearMissInvestigationRequirement(resolved).triggers, ["UNSAFE_CONDITION_REMAINS"]);
  assert.deepEqual(labels(deriveEventWorkflow(resolved, state([resolved]))), ["Investigation incomplete"]);
});

test("the full explanatory hierarchy stays possible: Serious, Open, Unsafe condition remains + Investigation incomplete + Corrective action outstanding", () => {
  const base = newEvent({ facts: [[DP.unsafeConditionRemains, "YES"], [DP.potentialSeverityReported, "SERIOUS"]] });
  const event = setNearMissAssessedPotentialSeverity(base, { value: "SERIOUS", assessedBy: "SM", at: STAMP });
  const action = { id: "ACT-9", companyId: COMPANY, driverMasterId: "DRV-1", actionType: "COACHING", title: "Merge coaching", decidedBy: "M", factualBasis: "f", effectiveDate: "2026-09-29", status: "Active", linkedEventIds: ["NM-1"], closureRequirement: "REQUIRED", isArchived: false, createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z" };
  const workflow = deriveEventWorkflow(event, state([event], { companyActions: [action] }));
  assert.equal(workflow.state, "OPEN");
  assert.equal(buildNearMissSummary(event).severityLine, "Potential Severity: Serious");
  assert.deepEqual(labels(workflow), ["Unsafe condition remains", "Investigation incomplete", "Corrective action outstanding"]);
});
