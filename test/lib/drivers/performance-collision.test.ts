/* eslint-disable @typescript-eslint/no-explicit-any */
import "../../helpers/register-alias-loader.mjs";
import test, { before } from "node:test";
import assert from "node:assert/strict";

import {
  COLLISION_FIRST_HARMFUL_EVENTS,
  COLLISION_MANNERS,
  COLLISION_SOURCES,
  COLLISION_TYPES,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-collision-taxonomy.ts";
import {
  COLLISION_DATA_POINTS as DP,
  buildCollisionSummary,
  carrierPartyItemId,
  collisionDraftToChildren,
  deriveCollisionInjuryCounts,
  describeCollision,
  emptyCollisionDraft,
  emptyUnitDetail,
  getCollisionReportability,
  isLegacyCollision,
  isNewTaxonomyCollision,
  readCollisionParties,
  readCollisionPersons,
  readCollisionSequence,
  readCollisionStatements,
  validateNewCollision,
  validateNewCollisionDetailed,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-collision.ts";
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
  completePerformanceInvestigation,
  openPerformanceInvestigation,
  recordPerformanceDetermination,
  resolvePreventability,
  updatePerformanceInvestigation,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-investigation.ts";
import {
  summarizeCollisionPreventability,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-action-metrics.ts";

let dd: any;
let schema: any;
before(async () => {
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  dd = await import("../../../lib/driver-data.ts");
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  schema = await import("../../../lib/driver-performance-schema.ts");
});

const COMPANY = "C-COL";
const STAMP = "2026-09-28T12:00:00.000Z";
const fact = (dataPointId: string, value: string | number) => ({ dataPointId, value, valueType: typeof value === "number" ? "number" : "string" });
const VEHICLES = [{ id: "VEH-1", label: "Unit 101" }, { id: "TRL-1", label: "Unit T-9" }];

const BASE_FACTS: Array<[string, string]> = [[DP.classType, "MULTI_VEHICLE"], [DP.manner, "REAR_END"], [DP.firstHarmfulEvent, "MOTOR_VEHICLE_IN_TRANSPORT"], [DP.injuryStatus, "NO_INJURY_REPORTED"]];

function draft(patch: Record<string, unknown> = {}): any {
  return { ...emptyCollisionDraft(), powerUnitId: "VEH-1", trailerIds: [], ...patch };
}

function newCollision(opts: { facts?: Array<[string, string | number]>; draft?: Record<string, unknown>; extra?: Record<string, unknown>; skipChildren?: boolean } = {}): any {
  const d = draft(opts.draft);
  const children = collisionDraftToChildren(d, VEHICLES);
  const facts = [...new Map<string, string | number>([...BASE_FACTS, ...(opts.facts || [])]).entries()].map(([id, value]) => fact(id, value));
  return {
    id: "COL-1", eventType: "Collision", companyId: COMPANY, driverMasterId: "DRV-1", createdAt: STAMP,
    eventDate: "2026-09-28", eventTime: "14:05", location: "Hwy 2", stateProvince: "AB", country: "Canada",
    vehicleId: children.vehicleId, canonicalLinks: children.canonicalLinks, structuredEventFacts: facts, childCollections: children.collections,
    provenance: { sourceType: "SOURCE_FACT", source: "Driver Report" }, evidenceIds: ["EV-1", "EV-2"],
    ...(opts.extra || {}),
  };
}
const state = (events: any[], extra: Record<string, unknown> = {}): any => ({ events, performanceInvestigations: [], companyActions: [], companyDeterminations: [], eventRelationships: [], ...extra });
const labels = (workflow: { reasons: Array<{ label: string }> }) => workflow.reasons.map((reason) => reason.label);
const messages = (event: any) => validateNewCollision(event);

const person = (patch: Record<string, unknown> = {}) => ({ itemId: "CIP-1", role: "OTHER_DRIVER", name: "", linkedPartyId: "", injurySeverity: "", transported: "", treatmentStatus: "", facility: "", fatalityDate: "", notes: "", accessClassification: "RESTRICTED_MEDICAL", evidenceIds: [], ...patch });
const other = (patch: Record<string, unknown> = {}) => ({ itemId: "CPT-OTHER-1", partyType: "PASSENGER_VEHICLE", description: "", identifier: "", ...emptyUnitDetail(), ...patch });

const VEH_KEY = `tes_company_vehicles_${COMPANY}`;
const seedVehicles = () => localStorage.setItem(VEH_KEY, JSON.stringify({ version: 1, vehicles: [{ id: "VEH-1", unitNumber: "101", equipmentType: "Tractor" }, { id: "TRL-1", unitNumber: "T-9", equipmentType: "Trailer - Dry Van" }] }));
const payloadFrom = (event: any) => { const { id: _i, companyId: _c, driverMasterId: _d, createdAt: _t, ...rest } = event; return { ...rest, severity: "Not Applicable", status: "Not Applicable", summary: "Collision on Hwy 2", description: "d", chronology: [], linkedRecords: [] }; };

// ------------------------------------------------------------------ CREATION
test("a complete new Collision validates; each required occurrence / classification / outcome field is enforced", () => {
  assert.deepEqual(messages(newCollision()), []);
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["date", { eventDate: "" }, /Event Date/], ["time", { eventTime: "" }, /Event Time/], ["driver", { driverMasterId: "" }, /Driver/], ["location", { location: "" }, /Location/], ["country", { country: "" }, /Country/],
    ["source", { provenance: { sourceType: "SOURCE_FACT", source: "Dashcam / AI" } }, /Source/],
  ];
  for (const [name, extra, pattern] of cases) assert.match(messages(newCollision({ extra })).join(" "), pattern, name);
  for (const [id, pattern] of [[DP.classType, /Collision Type is required/], [DP.manner, /Manner of Collision is required/], [DP.firstHarmfulEvent, /First Harmful Event is required/], [DP.injuryStatus, /Injury Status is required/]] as Array<[string, RegExp]>) {
    const event = newCollision(); event.structuredEventFacts = event.structuredEventFacts.filter((item: any) => item.dataPointId !== id);
    assert.match(messages(event).join(" "), pattern, id);
  }
  assert.deepEqual(COLLISION_SOURCES.map((item: any) => item.value), ["Driver Report", "Company Staff", "Camera", "Roadside Inspection", "Other"]);
});

test("the three classification concepts are independent catalogues and are all controlled", () => {
  assert.ok(COLLISION_TYPES.length > 3 && COLLISION_MANNERS.length > 3 && COLLISION_FIRST_HARMFUL_EVENTS.length > 3);
  assert.notDeepEqual(COLLISION_TYPES.map((i: any) => i.value), COLLISION_MANNERS.map((i: any) => i.value));
  assert.match(messages(newCollision({ facts: [[DP.manner, "SIDEWAYS"]] })).join(" "), /Manner of Collision must be a controlled value/);
  assert.match(messages(newCollision({ facts: [[DP.classType, "REAR_END"]] })).join(" "), /Collision Type must be a controlled value/, "an old configuration value is never accepted as the new Collision Type");
  const d = describeCollision(newCollision({ facts: [[DP.classType, "VEHICLE_VS_ANIMAL"], [DP.manner, "RUN_OFF_ROAD"], [DP.firstHarmfulEvent, "ANIMAL"]] }));
  assert.deepEqual([d.classification.type, d.classification.manner, d.classification.firstHarmfulEvent], ["Vehicle vs animal", "Run-off-road", "Collision with animal"]);
});

test("registry: new fields exist with the ids the logic uses; legacy fields are hidden from creation and no longer required; labels are not corrupted", () => {
  const fields = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Collision"].fields;
  for (const [key, id] of Object.entries(DP)) assert.ok(fields.some((field: any) => field.dataPointId === id), `schema is missing ${key} (${id})`);
  for (const key of ["collisionType", "otherPartyObject", "injuriesCount", "fatalitiesCount", "towRequired", "policeAttended", "propertyDamage", "driverStatement", "investigationNotes"]) assert.equal(fields.find((field: any) => field.key === key)?.hiddenInCreation, true, key);
  assert.notEqual(fields.find((field: any) => field.key === "collisionType")?.required, true);
  assert.deepEqual(["collisionClassType", "collisionManner", "firstHarmfulEvent", "injuryStatus"].map((key) => fields.find((field: any) => field.key === key)?.required), [true, true, true, true]);
  const lighting = fields.find((field: any) => field.key === "lightCondition").options.map((option: any) => option.label);
  assert.ok(lighting.includes("Dark — Lighted") && lighting.includes("Dark — Unlighted"));
  assert.ok(!lighting.some((label: string) => /[Ââ]/.test(label)), "no mojibake in lighting labels");
  assert.equal(schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Collision"].fields.find((field: any) => field.key === "reportabilityResult").label, "Reportability Determination");
  const steps = schema.resolvePerformanceSteps(schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Collision"], {}).map((step: any) => step.key);
  assert.deepEqual(steps, ["CATEGORY", "OCCURRENCE", "COLLISION_FACTS", "COLLISION_PARTIES", "COLLISION_ENVIRONMENT", "COLLISION_OUTCOMES", "COLLISION_INJURIES", "EVIDENCE", "REVIEW"]);
});

test("legacy facts cannot be written on a new record", () => {
  for (const id of [DP.legacyConfiguration, DP.legacyInjuries, DP.legacyFatalities, DP.legacyTow, DP.legacyPolice, DP.legacyPropertyDamage, DP.legacyDriverStatement, DP.legacyInvestigationNotes, DP.legacyOtherParty]) {
    assert.match(messages(newCollision({ facts: [[id, id === DP.legacyInjuries ? 2 : "X"]] })).join(" "), /Legacy Collision fields/, id);
  }
});

// ------------------------------------------------------------------ PARTIES
test("carrier Power Unit is required, must match the selected unit, trailers link canonically, other parties never reference a company vehicle", () => {
  const noPower = newCollision({ draft: { powerUnitId: "" } });
  assert.match(messages(noPower).join(" "), /Power Unit is required/);
  assert.equal(validateNewCollisionDetailed(noPower).find((issue: any) => /Power Unit is required/.test(issue.message))?.step, "COLLISION_PARTIES");
  const ok = newCollision({ draft: { trailerIds: ["TRL-1"], others: [other()] } });
  assert.deepEqual(messages(ok), []);
  assert.deepEqual(ok.canonicalLinks.map((link: any) => [link.entityType, link.recordId, link.relationshipKey]), [["Vehicle", "VEH-1", "vehicle"], ["Trailer", "TRL-1", "trailer"]]);
  assert.deepEqual(readCollisionParties(ok).map((party: any) => party.role), ["CARRIER_POWER_UNIT", "CARRIER_TRAILER", "OTHER_PARTY"]);
  const mismatch = newCollision({ draft: { trailerIds: ["TRL-1"] } }); mismatch.canonicalLinks = mismatch.canonicalLinks.filter((link: any) => link.relationshipKey !== "trailer");
  assert.match(messages(mismatch).join(" "), /Trailer party must reference a linked Trailer/);
  const fake = newCollision({ draft: { others: [other()] } });
  fake.childCollections.find((c: any) => c.collectionId.endsWith("INVOLVED_PARTIES")).items.find((item: any) => item.facts.role === "OTHER_PARTY").facts.linkedVehicleId = "VEH-FAKE";
  assert.match(messages(fake).join(" "), /must not reference a canonical company Vehicle/);
  assert.match(messages(newCollision({ draft: { others: [other({ partyType: "OTHER" })] } })).join(" "), /Describe the Other party/);
  assert.match(messages(newCollision({ draft: { others: [other({ partyType: "" })] } })).join(" "), /Other-party type is required/);
});

test("damage, drivability, tow, impact and speed persist on each party; speed needs a unit", () => {
  const event = newCollision({ draft: { carriers: { "VEH-1": { ...emptyUnitDetail(), damageStatus: "SEVERE", drivability: "NOT_DRIVABLE", towStatus: "TOWED", impactPoint: "FRONT", speed: "62", speedUnit: "KMH" } }, others: [other({ damageStatus: "MODERATE", drivability: "DRIVABLE", towStatus: "NOT_TOWED" })] } });
  assert.deepEqual(messages(event), []);
  const parties = readCollisionParties(event);
  assert.deepEqual([parties[0].damageStatus, parties[0].drivability, parties[0].towStatus, parties[0].impactPoint, parties[0].speed, parties[0].speedUnit], ["SEVERE", "NOT_DRIVABLE", "TOWED", "FRONT", 62, "KMH"]);
  assert.deepEqual([parties[1].damageStatus, parties[1].drivability, parties[1].towStatus], ["MODERATE", "DRIVABLE", "NOT_TOWED"]);
  assert.match(messages(newCollision({ draft: { carriers: { "VEH-1": { ...emptyUnitDetail(), speed: "40" } } } })).join(" "), /explicit unit/);
  assert.match(messages(newCollision({ draft: { carriers: { "VEH-1": { ...emptyUnitDetail(), damageStatus: "CATASTROPHIC" } } } })).join(" "), /Damage status must be a controlled value/);
  const unknowns = newCollision();
  assert.deepEqual(messages(unknowns), [], "unavailable detail is never required");
});

// ------------------------------------------------------------------ SEQUENCE
test("event sequence: explicit ordinals are the ordering authority, ids and ordinals are unique, evidence is referenced not copied", () => {
  const event = newCollision({ draft: { sequence: [
    { itemId: "CSQ-C", ordinal: "3", eventValue: "CAME_TO_REST", description: "", notes: "", evidenceIds: [] },
    { itemId: "CSQ-A", ordinal: "1", eventValue: "LOSS_OF_CONTROL", description: "Hit ice", notes: "", evidenceIds: ["EV-1"] },
    { itemId: "CSQ-B", ordinal: "2", eventValue: "", description: "Guardrail struck", notes: "", evidenceIds: [] },
  ] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(readCollisionSequence(event).map((step: any) => step.ordinal), [1, 2, 3], "read order follows ordinals even though the array is stored out of order");
  assert.deepEqual(readCollisionSequence(event)[0].evidenceIds, ["EV-1"]);
  assert.deepEqual(event.evidenceIds, ["EV-1", "EV-2"], "evidence stays on the event once");
  assert.deepEqual(describeCollision(event).sequence.map((step: any) => step.event || step.description), ["Loss of control", "Guardrail struck", "Came to rest"]);
  const dup = newCollision({ draft: { sequence: [{ itemId: "A", ordinal: "1", eventValue: "FIRE", description: "", notes: "", evidenceIds: [] }, { itemId: "B", ordinal: "1", eventValue: "FIRE", description: "", notes: "", evidenceIds: [] }] } });
  assert.match(messages(dup).join(" "), /ordinals must be unique/);
  assert.match(messages(newCollision({ draft: { sequence: [{ itemId: "A", ordinal: "0", eventValue: "FIRE", description: "", notes: "", evidenceIds: [] }] } })).join(" "), /positive whole numbers/);
  assert.match(messages(newCollision({ draft: { sequence: [{ itemId: "A", ordinal: "1", eventValue: "", description: "", notes: "", evidenceIds: [] }] } })).join(" "), /needs a controlled event or a description/);
  assert.match(messages(newCollision({ draft: { sequence: [{ itemId: "A", ordinal: "1", eventValue: "FIRE", description: "", notes: "", evidenceIds: ["EV-GHOST"] }] } })).join(" "), /not linked to this Collision/);
  assert.deepEqual(readCollisionSequence(newCollision()), [], "zero steps is valid");
});

// ------------------------------------------------------------------ INJURY
test("zero, one and several injured persons; injury reported without any medical detail", () => {
  assert.deepEqual(messages(newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]] })), [], "Injury reported with no person records is valid");
  const bare = newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]], draft: { persons: [person({ accessClassification: "" })] } });
  assert.deepEqual(messages(bare), [], "a person with no medical detail needs no classification");
  const one = newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]], draft: { persons: [person({ injurySeverity: "MINOR" })] } });
  assert.deepEqual(messages(one), []);
  assert.deepEqual(deriveCollisionInjuryCounts(one), { injured: 1, fatalities: 0, source: "PERSON_RECORDS" });
  const several = newCollision({ facts: [[DP.injuryStatus, "FATALITY_REPORTED"]], draft: { others: [other()], persons: [person({ itemId: "P1", injurySeverity: "SERIOUS", linkedPartyId: carrierPartyItemId("VEH-1") }), person({ itemId: "P2", role: "OTHER_OCCUPANT", injurySeverity: "FATAL", fatalityDate: "2026-09-30", linkedPartyId: "CPT-OTHER-1" }), person({ itemId: "P3", role: "PEDESTRIAN", injurySeverity: "UNKNOWN" })] } });
  assert.deepEqual(messages(several), []);
  assert.deepEqual(deriveCollisionInjuryCounts(several), { injured: 2, fatalities: 1, source: "PERSON_RECORDS" });
  assert.equal(readCollisionPersons(several).length, 3);
  assert.equal(deriveCollisionInjuryCounts(newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]] })), undefined, "no person records means no derived counts");
});

test("injury coherence: status vs people, fatality details, access classification, party links", () => {
  assert.match(messages(newCollision({ draft: { persons: [person({ injurySeverity: "MINOR" })] } })).join(" "), /No injury reported/);
  assert.match(messages(newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]], draft: { persons: [person({ injurySeverity: "FATAL" })] } })).join(" "), /requires Injury Status = Fatality reported/);
  assert.match(messages(newCollision({ facts: [[DP.injuryStatus, "FATALITY_REPORTED"]], draft: { persons: [person({ injurySeverity: "MINOR" })] } })).join(" "), /no injured person is recorded as fatal/);
  assert.deepEqual(messages(newCollision({ facts: [[DP.injuryStatus, "FATALITY_REPORTED"]] })), [], "fatality reported with no person records yet is valid");
  const fatalBase = { facts: [[DP.injuryStatus, "FATALITY_REPORTED"]] as Array<[string, string]> };
  assert.match(messages(newCollision({ ...fatalBase, draft: { persons: [person({ injurySeverity: "FATAL", fatalityDate: "2026-09-01" })] } })).join(" "), /before the Collision date/);
  assert.match(messages(newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]], draft: { persons: [person({ injurySeverity: "MINOR", fatalityDate: "2026-09-30" })] } })).join(" "), /fatality date requires a Fatal/);
  assert.match(messages(newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]], draft: { persons: [person({ treatmentStatus: "ADMITTED", accessClassification: "" })] } })).join(" "), /requires an access classification/);
  assert.match(messages(newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]], draft: { persons: [person({ injurySeverity: "MINOR", accessClassification: "PUBLIC" })] } })).join(" "), /Access classification must be a controlled value/);
  assert.match(messages(newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]], draft: { persons: [person({ linkedPartyId: "CPT-GHOST" })] } })).join(" "), /involved party that does not exist/);
  assert.match(messages(newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]], draft: { persons: [person({ role: "" })] } })).join(" "), /role must be a controlled value/);
  const dupe = newCollision({ facts: [[DP.injuryStatus, "INJURY_REPORTED"]], draft: { persons: [person({ itemId: "S" }), person({ itemId: "S" })] } });
  assert.match(messages(dupe).join(" "), /ids must be unique/);
});

test("legacy numeric injury / fatality counts stay readable and are never overwritten by the derived counts", () => {
  const legacy: any = { id: "COL-OLD", eventType: "Collision", structuredEventFacts: [fact(DP.legacyConfiguration, "REAR_END"), fact(DP.legacyInjuries, 2), fact(DP.legacyFatalities, 1)] };
  assert.deepEqual(deriveCollisionInjuryCounts(legacy), { injured: 2, fatalities: 1, source: "LEGACY_COUNTS" });
  const fromDetails: any = { id: "COL-OLD2", eventType: "Collision", collisionDetails: { injuriesCount: 3, fatalitiesCount: 0 } };
  assert.deepEqual(deriveCollisionInjuryCounts(fromDetails), { injured: 3, fatalities: 0, source: "LEGACY_COUNTS" });
  assert.equal(legacy.structuredEventFacts.find((item: any) => item.dataPointId === DP.legacyInjuries).value, 2);
});

// ------------------------------------------------------------------ STATEMENT / EVIDENCE
test("Driver Statement child: multiline content, method, source/provenance, evidence referenced once", () => {
  const content = "I was driving north.\nThe truck ahead braked suddenly.\n\nI could not stop in time.";
  const event = newCollision({ draft: { statement: { itemId: "CST-1", status: "OBTAINED", date: "2026-09-28", time: "16:30", method: "UPLOADED_DOCUMENT", content, evidenceIds: ["EV-2"] } } });
  assert.deepEqual(messages(event), []);
  const [statement] = readCollisionStatements(event);
  assert.equal(statement.content, content);
  assert.deepEqual([statement.status, statement.method, statement.date, statement.time, statement.evidenceIds], ["OBTAINED", "UPLOADED_DOCUMENT", "2026-09-28", "16:30", ["EV-2"]]);
  const item = event.childCollections.find((c: any) => c.collectionId.endsWith("DRIVER_STATEMENTS")).items[0];
  assert.equal(item.provenance.source, "Uploaded document");
  assert.deepEqual(event.evidenceIds, ["EV-1", "EV-2"]);
  assert.match(messages(newCollision({ draft: { statement: { itemId: "S", status: "OBTAINED", date: "", time: "", method: "WRITTEN", content: "", evidenceIds: [] } } })).join(" "), /content is required/);
  assert.match(messages(newCollision({ draft: { statement: { itemId: "S", status: "OBTAINED", date: "", time: "", method: "UPLOADED_DOCUMENT", content: "x", evidenceIds: [] } } })).join(" "), /must reference its evidence/);
  assert.match(messages(newCollision({ draft: { statement: { itemId: "S", status: "OBTAINED", date: "", time: "", method: "WRITTEN", content: "x", evidenceIds: ["EV-GHOST"] } } })).join(" "), /not linked to this Collision/);
  assert.deepEqual(readCollisionStatements(newCollision()), [], "no statement is required by default");
  assert.deepEqual(messages(newCollision({ draft: { statement: { itemId: "S", status: "DECLINED", date: "", time: "", method: "", content: "", evidenceIds: [] } } })), []);
});

// ------------------------------------------------------------------ REPORTABILITY
test("reportability stays a manual determination and is never derived from other facts", () => {
  for (const [value, expected] of [["REPORTABLE", "REPORTABLE"], ["NOT_REPORTABLE", "NOT_REPORTABLE"], ["UNABLE_TO_DETERMINE", "UNABLE_TO_DETERMINE"]] as Array<[string, string]>) {
    assert.equal(getCollisionReportability(newCollision({ facts: [[DP.reportability, value]] })), expected);
  }
  const grave = newCollision({ facts: [[DP.injuryStatus, "FATALITY_REPORTED"], [DP.hazmat, "RELEASE_OR_SPILL"], [DP.policeResponse, "ATTENDED"]] });
  assert.equal(getCollisionReportability(grave), "NOT_RECORDED", "a fatality, hazmat release and police attendance do not auto-determine reportability");
  assert.equal(describeCollision(grave).outcomes.reportability, undefined);
  assert.match(messages(newCollision({ facts: [[DP.reportability, "MAYBE"]] })).join(" "), /Reportability Determination must be a controlled value/);
  assert.equal(getCollisionReportability({ id: "x", eventType: "Collision", collisionDetails: { dotReportable: true } } as any), "REPORTABLE");
});

// ------------------------------------------------------------------ PERSISTENCE (data layer)
test("a new Collision persists through addPerformanceEvent and survives reload with all child structures", () => {
  localStorage.clear(); seedVehicles();
  const event = newCollision({
    facts: [[DP.injuryStatus, "INJURY_REPORTED"], [DP.policeResponse, "ATTENDED"], [DP.eventTimeZone, "America/Edmonton"], [DP.weather, "CLEAR"]],
    draft: { trailerIds: ["TRL-1"], carriers: { "VEH-1": { ...emptyUnitDetail(), damageStatus: "MODERATE", drivability: "NOT_DRIVABLE", towStatus: "TOWED" } }, others: [other()], persons: [person({ injurySeverity: "MINOR" })], sequence: [{ itemId: "S1", ordinal: "1", eventValue: "STRUCK_VEHICLE", description: "", notes: "", evidenceIds: ["EV-1"] }], statement: { itemId: "CST-1", status: "OBTAINED", date: "2026-09-28", time: "", method: "WRITTEN", content: "Line one\nLine two", evidenceIds: [] } },
  });
  const saved = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(event));
  const store = dd.loadCompanyDriverStore(COMPANY);
  const loaded = store.events.find((item: any) => item.id === saved.id);
  assert.equal(isNewTaxonomyCollision(loaded), true);
  assert.equal(loaded.vehicleId, "VEH-1");
  assert.deepEqual(readCollisionParties(loaded).map((p: any) => [p.role, p.towStatus]), [["CARRIER_POWER_UNIT", "TOWED"], ["CARRIER_TRAILER", ""], ["OTHER_PARTY", ""]]);
  assert.equal(readCollisionPersons(loaded).length, 1);
  assert.equal(readCollisionStatements(loaded)[0].content, "Line one\nLine two");
  assert.deepEqual(readCollisionSequence(loaded)[0].evidenceIds, ["EV-1"]);
  assert.deepEqual(describeCollision(loaded).outcomes.injuryStatus, "Injury reported");
  assert.equal(deriveEventWorkflow(loaded, store).state, "NOT_REQUIRED", "a Collision by itself creates no obligation");
});

test("the data layer rejects a new Collision that fails the new-record rules or points at a missing Power Unit", () => {
  localStorage.clear(); seedVehicles();
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCollision({ extra: { eventTime: "" } }))), /Event Time/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCollision({ draft: { powerUnitId: "" } }))), /Power Unit/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCollision({ draft: { powerUnitId: "VEH-GHOST" } }))), /does not exist in the company Vehicle store/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCollision({ facts: [[DP.legacyInjuries, 1]] }))), /Legacy Collision fields/);
});

// ------------------------------------------------------------------ PREVENTABILITY
test("a new Collision can receive a preventability determination through the engine; the resolver and the counters read it", () => {
  const event = newCollision();
  let s = state([event]);
  assert.equal(resolvePreventability(s, event), null);
  assert.equal(summarizeCollisionPreventability([event], s).undetermined.length, 1);
  const opened = openPerformanceInvestigation(s, { eventId: "COL-1", openedBy: "Reviewer" });
  const recorded = recordPerformanceDetermination(opened.state, { investigationId: opened.investigation.id, assessment: { subject: "PREVENTABILITY", value: "PREVENTABLE" }, determinedBy: "Reviewer", determinationDate: "2026-09-30" });
  s = recorded.state;
  assert.deepEqual([resolvePreventability(s, event)?.value, resolvePreventability(s, event)?.source], ["PREVENTABLE", "INVESTIGATION"]);
  assert.equal(summarizeCollisionPreventability([event], s).preventable.length, 1);
  const nonPrevent = recordPerformanceDetermination(s, { investigationId: opened.investigation.id, assessment: { subject: "PREVENTABILITY", value: "NOT_PREVENTABLE" }, determinedBy: "Reviewer", determinationDate: "2026-10-01" });
  assert.equal(summarizeCollisionPreventability([event], nonPrevent.state).nonPreventable.length, 1, "an amendment supersedes - the counters follow the one active determination");
  // An unrelated determination subject never drives the counter.
  const rootOnly = recordPerformanceDetermination(opened.state, { investigationId: opened.investigation.id, assessment: { subject: "ROOT_CAUSE", category: "Weather", finding: "Ice on the road", status: "DETERMINED", role: "PRIMARY" }, determinedBy: "Reviewer", determinationDate: "2026-09-30" });
  assert.equal(summarizeCollisionPreventability([event], rootOnly.state).undetermined.length, 1);
});

test("legacy preventability stays readable with the existing precedence and feeds the same counters", () => {
  const legacyDetermination = { id: "D-OLD", companyId: COMPANY, driverMasterId: "DRV-1", relatedRecordType: "Collision", relatedRecordId: "COL-LEG", determinationType: "COLLISION_PREVENTABILITY", determinationValue: "PREVENTABLE", determinedBy: "Old", determinationDate: "2025-01-01", createdAt: "2025-01-01T00:00:00.000Z" };
  const legacyEvent: any = { id: "COL-LEG", eventType: "Collision", companyId: COMPANY, driverMasterId: "DRV-1", createdAt: "2025-01-01T00:00:00.000Z", collisionDetails: { preventability: "Non-Preventable" } };
  const s = state([legacyEvent], { companyDeterminations: [legacyDetermination] });
  assert.deepEqual([resolvePreventability(s, legacyEvent)?.value, resolvePreventability(s, legacyEvent)?.source], ["PREVENTABLE", "LEGACY_DETERMINATION"]);
  const onlyDeprecated = state([legacyEvent]);
  assert.deepEqual([resolvePreventability(onlyDeprecated, legacyEvent)?.value, resolvePreventability(onlyDeprecated, legacyEvent)?.source], ["NOT_PREVENTABLE", "DEPRECATED_COLLISION_FIELD"]);
  assert.equal(summarizeCollisionPreventability([legacyEvent], s).preventable.length, 1);
  // Approved behaviour: with no higher-precedence determination, the deprecated collisionDetails value is read through the resolver and counted.
  const deprecatedCounts = summarizeCollisionPreventability([legacyEvent], onlyDeprecated);
  assert.deepEqual([deprecatedCounts.nonPreventable.length, deprecatedCounts.preventable.length, deprecatedCounts.undetermined.length], [1, 0, 0]);
});

// ------------------------------------------------------------------ WORKFLOW
const action = (extra: Record<string, unknown> = {}) => ({ id: "ACT-1", companyId: COMPANY, driverMasterId: "DRV-1", actionType: "COACHING", title: "Coaching", decidedBy: "M", factualBasis: "f", effectiveDate: "2026-09-29", status: "Active", linkedEventIds: ["COL-1"], closureRequirement: "REQUIRED", isArchived: false, createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z", ...extra });
const provs = () => getWorkflowProvidersForEventType("Collision");

test("workflow: a Collision alone creates no universal review obligation and nothing is invented to move it", () => {
  const event = newCollision();
  const workflow = deriveEventWorkflow(event, state([event]));
  assert.equal(workflow.state, "NOT_REQUIRED");
  assert.deepEqual(workflow.reasons, []);
  assert.deepEqual(provs().flatMap((provider: any) => provider.collect(event, state([event]))), [], "no provider emits an obligation for a bare Collision");
  const grave = newCollision({ facts: [[DP.injuryStatus, "FATALITY_REPORTED"], [DP.hazmat, "RELEASE_OR_SPILL"]] });
  assert.equal(deriveEventWorkflow(grave, state([grave])).state, "NOT_REQUIRED", "severity facts alone are not obligations");
});

test("an explicit reviewer requirement creates the investigation obligation; Collision has no policy trigger of its own", () => {
  const event = newCollision({ facts: [[DP.injuryStatus, "FATALITY_REPORTED"]] });
  const required = setPerformanceInvestigationRequirement(state([event]), "COL-1", { required: true, reason: "Fatality review", setBy: "SM" });
  const workflow = deriveEventWorkflow(required.event as any, required.state);
  assert.equal(workflow.state, "OPEN");
  assert.deepEqual(labels(workflow), ["Investigation incomplete"]);
  assert.equal(workflow.openReasons[0].source.type, "Event");
  const withdrawn = setPerformanceInvestigationRequirement(required.state, "COL-1", { required: false, setBy: "SM" });
  assert.equal(deriveEventWorkflow(withdrawn.event as any, withdrawn.state).state, "NOT_REQUIRED", "the reviewer can withdraw their own requirement");
  const opened = openPerformanceInvestigation(state([event]), { eventId: "COL-1", openedBy: "SM" });
  assert.equal(deriveEventWorkflow(event, opened.state).state, "NOT_REQUIRED", "an investigation that exists but is not required is not an obligation");
});

test("a required Company Action gates closure; completing it makes the Collision Ready to Close, and closure stays deliberate", () => {
  const event = newCollision();
  const open = state([event], { companyActions: [action()] });
  const gated = deriveEventWorkflow(event, open);
  assert.equal(gated.state, "OPEN");
  assert.deepEqual(labels(gated), ["Corrective action outstanding"]);
  assert.throws(() => closePerformanceEventWorkflow(open, "COL-1", { closedBy: "SM", providers: provs() }), /cannot be closed/);
  const done = state([event], { companyActions: [action({ status: "Completed", actualCompletionDate: "2026-10-01" })] });
  const ready = deriveEventWorkflow(event, done);
  assert.equal(ready.state, "READY_TO_CLOSE", "all applicable obligations resolved");
  assert.notEqual(ready.state, "CLOSED", "no auto-close");
  assert.equal((done.events[0].workflowClosures || []).length, 0);
  const closed = closePerformanceEventWorkflow(done, "COL-1", { closedBy: "SM", note: "Reviewed", providers: provs() });
  assert.equal(deriveEventWorkflow(closed.state.events[0], closed.state).state, "CLOSED");
  assert.equal(closed.closure.closedBy, "SM");
  const later = state([closed.state.events[0]], { companyActions: [action({ status: "Completed", actualCompletionDate: "2026-10-01" }), action({ id: "ACT-2", createdAt: "2027-01-01T00:00:00.000Z" })] });
  const reopened = deriveEventWorkflow(closed.state.events[0], later);
  assert.equal(reopened.state, "OPEN");
  assert.equal(reopened.closureSuperseded, true, "a later obligation reopens it; the closure record is kept");
});

test("preventability may be recorded freely but is not required to close a Collision", () => {
  const event = newCollision();
  const withAction = state([event], { companyActions: [action({ status: "Completed", actualCompletionDate: "2026-10-01" })] });
  assert.equal(resolvePreventability(withAction, event), null, "no preventability recorded");
  assert.equal(deriveEventWorkflow(event, withAction).state, "READY_TO_CLOSE");
  const closed = closePerformanceEventWorkflow(withAction, "COL-1", { closedBy: "SM", providers: provs() });
  assert.equal(deriveEventWorkflow(closed.state.events[0], closed.state).state, "CLOSED", "closed without any preventability decision");
  const opened = openPerformanceInvestigation(state([event]), { eventId: "COL-1", openedBy: "R" });
  const decided = recordPerformanceDetermination(opened.state, { investigationId: opened.investigation.id, assessment: { subject: "PREVENTABILITY", value: "PREVENTABLE" }, determinedBy: "R", determinationDate: "2026-09-30" });
  assert.equal(resolvePreventability(decided.state, event)?.value, "PREVENTABLE");
  assert.equal(deriveEventWorkflow(event, decided.state).state, "NOT_REQUIRED", "recording preventability neither adds nor resolves an obligation");
  assert.equal(summarizeCollisionPreventability([event], decided.state).preventable.length, 1);
});

test("a reviewer-required investigation, once completed, brings the Collision to Ready to Close; it is never closed automatically", () => {
  const event = newCollision();
  const required = setPerformanceInvestigationRequirement(state([event]), "COL-1", { required: true, setBy: "SM" });
  const opened = openPerformanceInvestigation(required.state, { eventId: "COL-1", openedBy: "SM" });
  const classified = recordPerformanceDetermination(opened.state, { investigationId: opened.investigation.id, assessment: { subject: "CLASSIFICATION", outcome: "CONFIRMED_AS_REPORTED" }, determinedBy: "SM", determinationDate: "2026-09-30" });
  assert.equal(deriveEventWorkflow(required.event as any, classified.state).state, "OPEN");
  const concluded = updatePerformanceInvestigation(classified.state, opened.investigation.id, { by: "SM", conclusion: { summary: "Reviewed; no further action." } });
  const completed = completePerformanceInvestigation(concluded.state, opened.investigation.id, { by: "SM" });
  const ready = deriveEventWorkflow(required.event as any, completed.state);
  assert.equal(ready.state, "READY_TO_CLOSE");
  assert.notEqual(ready.state, "CLOSED");
});

test("workflow reasons: required investigation, required company action, required verification and an explicitly required Driver Statement", () => {
  const event = newCollision();
  const required = setPerformanceInvestigationRequirement(state([event]), "COL-1", { required: true, reason: "Fatality", setBy: "SM" });
  const reasons = deriveEventWorkflow(required.event as any, required.state);
  assert.deepEqual(labels(reasons), ["Investigation incomplete"]);
  const withAction = deriveEventWorkflow(event, state([event], { companyActions: [action()] }));
  assert.ok(labels(withAction).includes("Corrective action outstanding"));
  assert.ok(withAction.openReasons.some((reason: any) => reason.source.type === "CompanyAction" && reason.source.id === "ACT-1"));
  const verifying = deriveEventWorkflow(event, state([event], { companyActions: [action({ status: "Completed", verification: { required: true, status: "PENDING" } })] }));
  assert.ok(labels(verifying).includes("Required review outstanding"));
  assert.ok(verifying.openReasons.some((reason: any) => /verification pending/.test(String(reason.detail))));
  // Driver Statement is only required when the Collision says so.
  assert.ok(!labels(deriveEventWorkflow(event, state([event]))).includes("Driver statement required"));
  const needsStatement = newCollision({ facts: [[DP.driverStatementRequired, "YES"]] });
  assert.ok(labels(deriveEventWorkflow(needsStatement, state([needsStatement]))).includes("Driver statement required"));
  const withStatement = newCollision({ facts: [[DP.driverStatementRequired, "YES"]], draft: { statement: { itemId: "S", status: "OBTAINED", date: "2026-09-29", time: "", method: "WRITTEN", content: "x", evidenceIds: [] } } });
  assert.ok(!labels(deriveEventWorkflow(withStatement, state([withStatement]))).includes("Driver statement required"));
  const requestedOnly = newCollision({ facts: [[DP.driverStatementRequired, "YES"]], draft: { statement: { itemId: "S", status: "REQUESTED", date: "", time: "", method: "", content: "", evidenceIds: [] } } });
  assert.ok(labels(deriveEventWorkflow(requestedOnly, state([requestedOnly]))).includes("Driver statement required"), "a requested but not obtained statement does not satisfy the requirement");
  assert.ok(withAction.reasons.every((reason: any) => reason.source.id && reason.source.type), "every reason carries its source");
});

test("workflow derivation is registered for Collision only through the family provider; Roadside keeps the generic providers", () => {
  assert.equal(getWorkflowProvidersForEventType("Collision").length, getWorkflowProvidersForEventType("Roadside Inspection").length + 1);
});

// ------------------------------------------------------------------ LEGACY
const legacyFacts = (): any => ({
  id: "COL-OLD", eventType: "Collision", companyId: COMPANY, driverMasterId: "DRV-1", createdAt: "2024-03-05T10:00:00.000Z", eventDate: "2024-03-05", location: "Yard", summary: "Old collision",
  structuredEventFacts: [fact(DP.legacyConfiguration, "LANE_CHANGE"), fact(DP.legacyInjuries, 1), fact(DP.legacyFatalities, 0), fact(DP.legacyTow, "x"), fact(DP.legacyDriverStatement, "Old statement"), fact(DP.legacyInvestigationNotes, "Old narrative"), fact(DP.legacyOtherParty, "Grey sedan")],
  provenance: { sourceType: "SOURCE_FACT", source: "Driver Report" }, evidenceIds: [],
});

test("legacy Collision records (old facts and collisionDetails) stay readable, are labelled legacy and are not reinterpreted", () => {
  const old = legacyFacts();
  assert.deepEqual([isLegacyCollision(old), isNewTaxonomyCollision(old)], [true, false]);
  const d = describeCollision(old);
  assert.equal(d.legacy, true);
  assert.equal(d.classification.legacyConfiguration, "Lane Change");
  assert.equal(d.classification.type, undefined, "the old configuration is NOT mapped into the new Collision Type");
  assert.equal(d.legacyDetails!.driverStatement, "Old statement");
  assert.equal(d.legacyDetails!.investigationNarrative, "Old narrative");
  assert.equal(d.legacyDetails!.otherParty, "Grey sedan");
  assert.deepEqual(d.injuryCounts, { injured: 1, fatalities: 0, source: "LEGACY_COUNTS" });
  assert.equal(buildCollisionSummary(old).contextLine, "Mar 5, 2024 · Lane Change (legacy) · Yard");
  const onlyDetails: any = { id: "COL-D", eventType: "Collision", eventDate: "2023-01-02", collisionDetails: { collisionType: "Rollover", weather: "Snow", roadCondition: "Icy", lightCondition: "Daylight", towRequired: true, policeAttended: false, policeReportNumber: "PR-9", injuriesCount: 2, fatalitiesCount: 1, driverStatement: "Details-only statement", estimatedCost: "$5,000", witnessStatements: "Two witnesses", dotReportable: true } };
  const dd2 = describeCollision(onlyDetails);
  assert.equal(dd2.classification.legacyConfiguration, "Rollover");
  assert.deepEqual([dd2.legacyDetails!.tow, dd2.legacyDetails!.police, dd2.legacyDetails!.policeReportNumber, dd2.legacyDetails!.driverStatement, dd2.legacyDetails!.estimatedCost, dd2.legacyDetails!.reportability], ["Yes", "No", "PR-9", "Details-only statement", "$5,000", "Reportable"]);
  assert.equal(JSON.stringify(dd2).includes("ROLLOVER"), false);
});

test("a stored legacy Collision loads and reloads unchanged and its workflow resolves through the legacy determination", () => {
  localStorage.clear();
  const old = { ...legacyFacts(), description: "old", severity: "Not Applicable", status: "Open", chronology: [], collisionDetails: { preventability: "Preventable" } };
  const determination = { id: "D-OLD", companyId: COMPANY, driverMasterId: "DRV-1", relatedRecordType: "Collision", relatedRecordId: "COL-OLD", determinationType: "COLLISION_PREVENTABILITY", determinationValue: "NON_PREVENTABLE", determinedBy: "Old", determinationDate: "2024-04-01", createdAt: "2024-04-01T00:00:00.000Z" };
  localStorage.setItem(`tes_company_drivers_${COMPANY}`, JSON.stringify({ version: 2, companyId: COMPANY, relationships: [], events: [old], companyDeterminations: [determination] }));
  const store = dd.loadCompanyDriverStore(COMPANY);
  dd.saveCompanyDriverStore(store);
  const reloaded = dd.loadCompanyDriverStore(COMPANY);
  const event = reloaded.events.find((item: any) => item.id === "COL-OLD");
  assert.equal(event.status, "Open", "stored status is untouched");
  assert.equal(event.collisionDetails.preventability, "Preventable");
  assert.ok(!event.structuredEventFacts.some((item: any) => item.dataPointId === DP.classType), "no new-taxonomy fact was written");
  assert.deepEqual([resolvePreventability(reloaded, event)?.value, resolvePreventability(reloaded, event)?.source], ["NOT_PREVENTABLE", "LEGACY_DETERMINATION"]);
  assert.equal(deriveEventWorkflow(event, reloaded).state, "NOT_REQUIRED", "a legacy determination neither creates nor resolves an obligation");
  assert.equal(summarizeCollisionPreventability([event], reloaded).nonPreventable.length, 1);
});
