/* eslint-disable @typescript-eslint/no-explicit-any */
import "../../helpers/register-alias-loader.mjs";
import test, { before } from "node:test";
import assert from "node:assert/strict";

import {
  CE_COLLECTION_IDS as CID,
  CE_SOURCES,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-customer-event-taxonomy.ts";
import {
  CE_DATA_POINTS as DP,
  buildCustomerEventSummary,
  customerDraftToChildren,
  customerEventCounterBucket,
  customerEventSubtype,
  customerEventWorkflowProvider,
  deriveCustomerResponseDelays,
  deriveCustomerTimingDelays,
  deriveOwningDriverRole,
  describeCustomerEvent,
  describeLegacyCustomerEvent,
  emptyCustomerBehavior,
  emptyCustomerClaim,
  emptyCustomerCommendation,
  emptyCustomerCondition,
  emptyCustomerDraft,
  emptyCustomerOutcome,
  emptyCustomerParty,
  emptyCustomerResolution,
  emptyCustomerStatement,
  emptyCustomerStep,
  isLegacyCustomerEvent,
  isNewTaxonomyCustomerEvent,
  readCustomerBehaviors,
  readCustomerClaims,
  readCustomerCommendation,
  readCustomerConditions,
  readCustomerFinancial,
  readCustomerOutcome,
  readCustomerParties,
  readCustomerResolution,
  readCustomerReviews,
  readCustomerStatements,
  readCustomerStatusHistory,
  readCustomerTimeline,
  setCustomerRequirement,
  upsertCustomerChild,
  validateNewCustomerEvent,
  validateNewCustomerEventDetailed,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-customer-event.ts";
import {
  closePerformanceEventWorkflow,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-workflow.ts";
import {
  deriveEventWorkflow,
  getWorkflowProvidersForEventType,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-workflow-registry.ts";
import {
  CONTRIBUTING_FACTOR_DOMAINS,
  SUBSTANTIATION_OUTCOMES,
  completePerformanceInvestigation,
  getInvestigationsForEvent,
  openPerformanceInvestigation,
  recordPerformanceDetermination,
  setInvestigationContributingFactors,
  updatePerformanceInvestigation,
  validateDeterminationAssessment,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-investigation.ts";
import {
  createPerformanceEventRelationship,
  getEventRelationships,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-event-relationships.ts";
import {
  LEGACY_ONLY_PERFORMANCE_EVENT_TYPES,
  PERFORMANCE_EVENT_FAMILIES,
  performanceEventTitle,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/driver-performance-families.ts";

let dd: any;
let schema: any;
before(async () => {
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  dd = await import("../../../lib/driver-data.ts");
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  schema = await import("../../../lib/driver-performance-schema.ts");
});

const COMPANY = "C-CUST";
const STAMP = "2026-10-03T16:00:00.000Z";
const fact = (dataPointId: string, value: string) => ({ dataPointId, value, valueType: "string" });
const party = (patch: Record<string, unknown> = {}) => ({ ...emptyCustomerParty(), itemId: "P1", capacities: ["REPORTER"], personType: "CUSTOMER_CONTACT", name: "Pat Manager", organization: "ACME Receiving", ...patch });
const claim = (patch: Record<string, unknown> = {}) => ({ ...emptyCustomerClaim(), itemId: "CL1", claimType: "LATE_ARRIVAL", reportedStatement: "Driver arrived four hours late.", ...patch });
const statement = (patch: Record<string, unknown> = {}) => ({ ...emptyCustomerStatement(), itemId: "ST1", text: "Your driver was four hours late and never called.", ...patch });
const behavior = (patch: Record<string, unknown> = {}) => ({ ...emptyCustomerBehavior(), itemId: "BH1", subjectPartyId: "P-SUBJ", primaryCategory: "SAFETY_COMPLIANCE", description: "Crossed the truck path without stopping.", ...patch });
const condition = (patch: Record<string, unknown> = {}) => ({ ...emptyCustomerCondition(), itemId: "CN1", category: "BLOCKED_ACCESS_OR_DOCK", description: "Dock 3 blocked by pallets.", ...patch });
const step = (ordinal: number, patch: Record<string, unknown> = {}) => ({ ...emptyCustomerStep(ordinal), itemId: `RS-${ordinal}`, action: "RECEIVED_RECORDED", ...patch });
const commendation = (patch: Record<string, unknown> = {}) => ({ ...emptyCustomerCommendation(), recognizedPartyId: "P-REC", positiveBehaviorCategory: "PROACTIVE_COMMUNICATION", positiveBehaviorDescription: "Sent ETA updates before every stop.", ...patch });
const subjParty = (patch: Record<string, unknown> = {}) => party({ itemId: "P-SUBJ", capacities: ["SUBJECT"], personType: "FORKLIFT_OPERATOR", name: "Forklift operator", organization: "ACME Receiving", ...patch });
const obsParty = (patch: Record<string, unknown> = {}) => party({ itemId: "P-OBS", capacities: ["OBSERVER"], personType: "CARRIER_DRIVER", name: "Tony Mayer", organization: "", ...patch });
const recParty = (patch: Record<string, unknown> = {}) => party({ itemId: "P-REC", capacities: ["RECOGNIZED_PARTY"], personType: "CARRIER_DRIVER", name: "Tony Mayer", ...patch });

function newEvent(opts: { subtype?: string; facts?: Array<[string, string]>; draft?: Record<string, unknown>; extra?: Record<string, unknown>; now?: string } = {}): any {
  const subtype = opts.subtype ?? "COMPLAINT";
  const d = { ...emptyCustomerDraft(), ...(opts.draft || {}) } as any;
  const children = customerDraftToChildren(d, { driverMasterId: "DRV-1", now: opts.now || STAMP });
  const base: Array<[string, string]> = [...(subtype ? ([[DP.customerEventType, subtype]] as Array<[string, string]>) : []), ...(opts.facts || [])];
  return {
    id: "CE-1", eventType: "Customer Event", companyId: COMPANY, driverMasterId: "DRV-1", createdAt: STAMP, summary: "Customer feedback",
    eventDate: "2026-10-03", eventTime: "14:05", occurrencePrecision: children.occurrencePrecision, structuredEventFacts: [...new Map(base).entries()].map(([id, value]) => fact(id, value)), childCollections: children.collections,
    provenance: { sourceType: "SOURCE_FACT", source: "Customer" }, evidenceIds: ["EV-1", "EV-2"], ...(opts.extra || {}),
  };
}
const messages = (event: any) => validateNewCustomerEvent(event);
const state = (events: any[], extra: Record<string, unknown> = {}): any => ({ events, performanceInvestigations: [], companyActions: [], companyDeterminations: [], eventRelationships: [], ...extra });
const labels = (workflow: { reasons: Array<{ label: string }> }) => workflow.reasons.map((reason) => reason.label);
const provs = () => getWorkflowProvidersForEventType("Customer Event");
const flow = (event: any, extra: Record<string, unknown> = {}) => deriveEventWorkflow(event, state([event], extra));
const payloadFrom = (event: any) => { const { id: _i, companyId: _c, driverMasterId: _d, createdAt: _t, ...rest } = event; return { ...rest, severity: "Not Applicable", status: "Not Applicable", summary: "Customer feedback", description: "d", chronology: [], linkedRecords: [] }; };
const apply = (event: any, collectionId: string, facts: Record<string, any>, extra: Record<string, unknown> = {}) => upsertCustomerChild(event, { collectionId, facts, ...extra });
const withInvestigation = (event: any) => { const opened = openPerformanceInvestigation(state([event]), { eventId: event.id, openedBy: "SM" }); return opened; };
const substantiate = (s: any, investigationId: string, outcome: string) => recordPerformanceDetermination(s, { investigationId, assessment: { subject: "SUBSTANTIATION", outcome: outcome as any }, determinedBy: "SM", determinationDate: "2026-10-05" });

// 1-5 -------------------------------------------------------------------------
test("1. the canonical Customer Event type exists, is recordable, and has its own source policy (the shared CUSTOMER policy is unchanged)", () => {
  const definition = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Customer Event"];
  assert.equal(definition.value, "Customer Event");
  assert.equal(schema.PERFORMANCE_CATEGORY_OWNERSHIP["Customer Event"], "RECORDABLE_EVENT");
  assert.ok(schema.RECORDABLE_PERFORMANCE_CATEGORIES.includes("Customer Event"));
  assert.deepEqual(definition.sources, CE_SOURCES.map((item: any) => item.value));
  const policy = schema.PERFORMANCE_SOURCE_POLICY_BY_EVENT_TYPE?.["Customer Event"] ?? definition.sourcePolicy;
  if (policy) assert.deepEqual(policy.authoritativeSourceTypes.map((item: any) => item.value), ["Customer", "Company Staff", "Driver Report", "Camera", "Other"]);
  assert.ok(definition.policy.steps.map((entry: any) => entry.key).includes("CE_SUBTYPE"));
  assert.equal(performanceEventTitle("Customer Event" as any), "Customer Event");
  const customerFamily = PERFORMANCE_EVENT_FAMILIES.find((family: any) => family.key === "CUSTOMER_EVENT");
  assert.deepEqual(customerFamily!.members.map((member: any) => member.eventType), ["Customer Event", "Customer Complaint", "Customer Commendation", "Customer-Site Behavior"]);
});

test("2. the subtype is a required, controlled parent fact; it persists through addPerformanceEvent and reloads", () => {
  localStorage.clear();
  const noSubtype = newEvent({ subtype: "" });
  assert.match(messages(noSubtype).join(" "), /Customer Event type is required/);
  assert.match(messages(newEvent({ subtype: "PRAISE" })).join(" "), /Customer Event type must be a controlled value/);
  assert.equal(isNewTaxonomyCustomerEvent(noSubtype), false);
  for (const subtype of ["COMPLAINT", "COMMENDATION", "SITE_BEHAVIOR"]) assert.deepEqual(messages(newEvent({ subtype })), [], subtype);
  const saved = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent()));
  const loaded = dd.loadCompanyDriverStore(COMPANY).events.find((entry: any) => entry.id === saved.id);
  assert.equal(loaded.eventType, "Customer Event");
  assert.equal(customerEventSubtype(loaded), "COMPLAINT");
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(noSubtype)), /Customer Event type is required|missing required data point/);
});

test("3. a Complaint saves with categories, claims, an original statement and impact facts", () => {
  const event = newEvent({ facts: [[DP.complaintPrimaryCategory, "DELIVERY_PERFORMANCE"], [DP.complaintSecondaryCategories, "COMMUNICATION"], [DP.customerImpactNote, "Receiving line idle for 2 hours"], [DP.operationalInterruption, "YES"], [DP.safetySignificance, "NO"], [DP.regulatorySignificance, "UNKNOWN"]], draft: { claims: [claim(), claim({ itemId: "CL2", claimType: "POOR_COMMUNICATION", reportedStatement: "" })], statements: [statement()], parties: [party({ capacities: ["REPORTER"] })] } });
  assert.deepEqual(messages(event), []);
  const view = describeCustomerEvent(event);
  assert.equal(view.subtypeLabel, "Complaint");
  assert.equal(view.complaint?.primaryCategory, "Delivery Performance");
  assert.deepEqual(view.complaint?.secondaryCategories, ["Communication"]);
  assert.equal(view.complaint?.claims.length, 2);
  assert.deepEqual([view.complaint?.impact.operationalInterruption, view.complaint?.impact.safetySignificance, view.complaint?.impact.regulatorySignificance], ["Yes", "No", "Unknown"]);
});

test("4. a Commendation saves with a recognized party, positive behavior and recognition facts", () => {
  const event = newEvent({ subtype: "COMMENDATION", draft: { parties: [recParty(), party({ itemId: "P1", capacities: ["REPORTER"] })], commendation: commendation({ recognitionCategory: "COMMUNICATION", recognitionSource: "CUSTOMER", recognitionLevel: "WRITTEN", businessImpactNote: "Customer renewed the lane", recognitionAction: "Thanked in dispatch meeting", shareConsent: "NO" }) } });
  assert.deepEqual(messages(event), []);
  const view = describeCustomerEvent(event).commendation!;
  assert.deepEqual([view.category, view.positiveBehavior, view.level, view.shareConsent, view.recognitionAction], ["Communication", "Proactive Communication", "Written", "No", "Thanked in dispatch meeting"]);
  assert.match(view.recognizedParty!, /Tony Mayer/);
});

test("5. a Site Behavior event saves with person behavior and site condition records", () => {
  const event = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [obsParty(), subjParty()], behaviors: [behavior()], conditions: [condition()] } });
  assert.deepEqual(messages(event), []);
  const view = describeCustomerEvent(event);
  assert.equal(view.behaviors.length, 1);
  assert.equal(view.conditions.length, 1);
  assert.equal(view.behaviors[0].primaryCategory, "Safety Compliance");
});

// 6-10 ------------------------------------------------------------------------
const legacyBase = (eventType: string, facts: any[], extra: Record<string, unknown> = {}): any => ({ id: `OLD-${eventType}`, eventType, companyId: COMPANY, driverMasterId: "DRV-1", createdAt: "2024-02-01T00:00:00.000Z", eventDate: "2024-02-01", summary: "Old record", description: "Old", severity: "Not Applicable", status: "Not Applicable", evidenceIds: ["EV-OLD"], chronology: [], isArchived: false, structuredEventFacts: facts, provenance: { sourceType: "SOURCE_FACT", source: "Customer" }, ...extra });
const lf = (suffix: string, value: any) => ({ dataPointId: `DRV.PERF.LEGACY.${suffix}`, value, valueType: typeof value === "number" ? "number" : "string" });
const legacyComplaint = () => legacyBase("Customer Complaint", [lf("CUSTOMERNAME", "ACME"), lf("COMPLAINTCATEGORY", "Delivery Delay"), lf("RECEIVEDDATE", "2024-02-03"), lf("COMPLAINTNARRATIVE", "Late again"), lf("SUBSTANTIATIONSTATUS", "Substantiated")], { complaintDetails: { customerName: "ACME", category: "Delivery Delay", substantiationStatus: "Substantiated", reviewNotes: "Reviewed", loadNumber: "L-9" } });
const legacyCommendation = () => legacyBase("Customer Commendation", [lf("CUSTOMERNAME", "ACME"), lf("COMMENDATIONTYPE", "Customer Commendation"), lf("RECOGNIZEDBY", "Pat"), lf("RECOGNITIONDATE", "2024-03-01"), lf("RECOGNITIONNARRATIVE", "Great service")]);
const legacySite = () => legacyBase("Customer-Site Behavior", [lf("BEHAVIORTYPE", "Dock Conduct"), lf("BEHAVIORNARRATIVE", "Waited politely")]);

test("6-8. legacy Complaint, Commendation and Site Behavior records stay readable through a compatibility readback", () => {
  const complaint = describeLegacyCustomerEvent(legacyComplaint());
  assert.deepEqual([complaint.kind, complaint.customerName, complaint.complaintCategory, complaint.receivedDate, complaint.complaintNarrative, complaint.substantiationStatus, complaint.reviewNotes, complaint.loadNumber], ["COMPLAINT", "ACME", "Delivery Delay", "2024-02-03", "Late again", "Substantiated", "Reviewed", "L-9"]);
  const praise = describeLegacyCustomerEvent(legacyCommendation());
  assert.deepEqual([praise.kind, praise.commendationType, praise.recognizedBy, praise.recognitionDate, praise.recognitionNarrative], ["COMMENDATION", "Customer Commendation", "Pat", "2024-03-01", "Great service"]);
  const site = describeLegacyCustomerEvent(legacySite());
  assert.deepEqual([site.kind, site.behaviorType, site.behaviorNarrative], ["SITE_BEHAVIOR", "Dock Conduct", "Waited politely"]);
  for (const event of [legacyComplaint(), legacyCommendation(), legacySite()]) { assert.equal(isLegacyCustomerEvent(event), true); assert.equal(isNewTaxonomyCustomerEvent(event), false); assert.deepEqual(customerEventWorkflowProvider.collect(event, state([event])), []); }
  assert.equal(describeLegacyCustomerEvent(legacyComplaint()).source, "Customer");
});

test("9. there is no migration: legacy records load unchanged and nothing is converted into Customer Event children", () => {
  localStorage.clear();
  const legacy = legacyComplaint();
  const store = dd.loadCompanyDriverStore(COMPANY);
  localStorage.setItem(`tes_company_drivers_${COMPANY}`, JSON.stringify({ ...store, events: [legacy] }));
  const loaded = dd.loadCompanyDriverStore(COMPANY).events.find((entry: any) => entry.id === legacy.id);
  assert.deepEqual(loaded.structuredEventFacts, legacy.structuredEventFacts);
  assert.deepEqual(loaded.complaintDetails, legacy.complaintDetails, "the legacy projection is untouched");
  assert.equal(loaded.eventType, "Customer Complaint", "the stored type is not remapped");
  assert.equal(loaded.childCollections, undefined);
  assert.throws(() => upsertCustomerChild(loaded, { collectionId: CID.TIMELINE, facts: { action: "ACKNOWLEDGED" } }), /Legacy customer records/);
  assert.throws(() => setCustomerRequirement(loaded, { field: "complaintAssessmentRequired", to: "YES", changedBy: "SM" }), /Legacy customer records/);
});

test("10. the legacy types are unavailable for new creation; the alias and the family titles are preserved", () => {
  for (const type of ["Customer Complaint", "Customer Commendation", "Customer-Site Behavior"]) {
    assert.equal(schema.PERFORMANCE_CATEGORY_OWNERSHIP[type], "LEGACY_READ_ONLY", type);
    assert.ok(LEGACY_ONLY_PERFORMANCE_EVENT_TYPES.includes(type as any), type);
    assert.ok(!schema.RECORDABLE_PERFORMANCE_CATEGORIES.includes(type), type);
  }
  localStorage.clear();
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", { ...payloadFrom(newEvent()), eventType: "Customer Complaint" }), /cannot be created as a new Performance Event|owned by/);
  assert.equal(schema.PERFORMANCE_CATEGORY_OWNERSHIP["Customer Compliment"], "ALIAS");
  assert.equal(schema.DRIVER_PERFORMANCE_LEGACY_CATEGORY_ALIASES["Customer Compliment"], "Customer Commendation");
  assert.deepEqual(["Customer Complaint", "Customer Commendation", "Customer-Site Behavior"].map((type) => performanceEventTitle(type as any)), ["Customer Event: Complaint", "Customer Event: Commendation", "Customer Event: Site Behavior"]);
  for (const key of ["customerName", "complaintCategory", "substantiationStatus", "behaviorType", "recognizedBy"]) assert.ok(schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Customer Complaint"].fields.concat(schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Customer Commendation"].fields, schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Customer-Site Behavior"].fields).some((field: any) => field.key === key), `legacy field kept: ${key}`);
});

// 11-15 -----------------------------------------------------------------------
test("11-12. customer, site and shipment references are free text; no canonical link or fake entity is created", () => {
  const event = newEvent({ facts: [[DP.customerName, "ACME Foods"], [DP.customerRole, "Receiver"], [DP.customerContact, "Pat Manager"], [DP.customerSite, "ACME DC 4"], [DP.siteArea, "Dock 3"], [DP.shipperName, "Shipper Co"], [DP.receiverName, "ACME"], [DP.brokerName, "Broker LLC"], [DP.loadReference, "LD-1"], [DP.shipmentReference, "SHP-2"], [DP.bolPro, "BOL-3"], [DP.origin, "Calgary"], [DP.destination, "Edmonton"], [DP.appointmentReference, "APPT-9"], [DP.routeReference, "Hwy 2"], [DP.serviceType, "Dedicated"], [DP.operatingStage, "Unloading"]] });
  assert.deepEqual(messages(event), []);
  const view = describeCustomerEvent(event);
  assert.equal(view.customer.length, 8);
  assert.equal(view.operations.length, 9);
  assert.ok(event.structuredEventFacts.every((entry: any) => typeof entry.value === "string"));
  assert.ok(!event.canonicalLinks && !event.operationalReferences, "nothing canonical or fake is populated");
  assert.match(messages(newEvent({ extra: { canonicalLinks: [{ entityType: "Vehicle", recordId: "V1", relationshipKey: "vehicle", source: "CANONICAL_STORE" }] } })).join(" "), /no canonical links/);
  assert.deepEqual([describeCustomerEvent(newEvent()).customer, describeCustomerEvent(newEvent()).operations], [[], []]);
});

test("13. occurrence precision: exact, date only, approximate and unknown are all supported; an exact time is never assumed", () => {
  assert.match(messages(newEvent({ extra: { eventTime: "" } })).join(" "), /Event Time is required when the occurrence is exact/);
  for (const precision of ["DATE_ONLY", "APPROXIMATE", "UNKNOWN"]) assert.deepEqual(messages(newEvent({ draft: { precision }, extra: { eventTime: "" } })), [], precision);
  assert.match(messages(newEvent({ draft: { precision: "SOMETIME" } })).join(" "), /precision/);
  assert.deepEqual(messages(newEvent({ draft: { precision: "APPROXIMATE" }, facts: [[DP.windowStart, "2026-10-03T08:00"], [DP.windowEnd, "2026-10-03T12:00"], [DP.windowBasis, "Customer said morning"]], extra: { eventTime: "" } })), []);
  assert.match(messages(newEvent({ facts: [[DP.windowStart, "2026-10-03T12:00"], [DP.windowEnd, "2026-10-03T10:00"]] })).join(" "), /window end cannot be before its start/);
  assert.match(messages(newEvent({ facts: [[DP.windowStart, "2026-10-03T12:00"]] })).join(" "), /needs both a start and an end/);
  assert.match(messages(newEvent({ facts: [[DP.eventTimeZone, "Mars/Olympus"]] })).join(" "), /valid IANA zone/);
  assert.deepEqual(messages(newEvent({ facts: [[DP.eventTimeZone, "America/Edmonton"]] })), []);
  assert.equal(describeCustomerEvent(newEvent({ draft: { precision: "DATE_ONLY" } })).time.precision, "Date only");
});

test("14. the occurrence clock and the feedback-received clock are separate; delays are derived, never stored", () => {
  const event = newEvent({ facts: [[DP.discoveryDate, "2026-10-03"], [DP.discoveryTime, "15:00"], [DP.reportedTime, "16:30"]], extra: { reportedDate: "2026-10-03" } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(deriveCustomerTimingDelays(event), { occurrenceToDiscoveryMinutes: 55, discoveryToReceivedMinutes: 90, occurrenceToReceivedMinutes: 145 });
  assert.equal(describeCustomerEvent(event).time.received, "2026-10-03 16:30");
  assert.ok(!/Minutes/i.test(JSON.stringify(event.structuredEventFacts)), "no latency is stored");
  const sameDayLater = newEvent({ extra: { reportedDate: "2026-10-09" } });
  assert.deepEqual(messages(sameDayLater), [], "received days after the occurrence is normal");
  assert.match(messages(newEvent({ extra: { reportedDate: "2026-10-02" } })).join(" "), /cannot be received before the occurrence/);
  assert.match(messages(newEvent({ facts: [[DP.discoveryDate, "2026-10-03"], [DP.discoveryTime, "13:00"]] })).join(" "), /Discovery cannot be before the occurrence/);
  assert.match(messages(newEvent({ facts: [[DP.discoveryDate, "2026-10-03"], [DP.discoveryTime, "16:00"], [DP.reportedTime, "15:00"]], extra: { reportedDate: "2026-10-03" } })).join(" "), /cannot be received before it was discovered/);
  assert.match(messages(newEvent({ facts: [[DP.reportedTime, "15:00"]] })).join(" "), /received time needs a received/);
  assert.deepEqual(deriveCustomerTimingDelays(newEvent({ draft: { precision: "APPROXIMATE" }, extra: { eventTime: "", reportedDate: "2026-10-04" } })).occurrenceToReceivedMinutes, undefined);
});

test("15. intake channel is a controlled event-local fact and is not provenance; the Customer Event source set includes Driver Report and Camera", () => {
  for (const channel of ["EMAIL", "PHONE", "PORTAL", "IN_PERSON", "OTHER", "UNKNOWN"]) assert.deepEqual(messages(newEvent({ facts: [[DP.intakeChannel, channel]] })), [], channel);
  assert.match(messages(newEvent({ facts: [[DP.intakeChannel, "FAX"]] })).join(" "), /Intake channel must be a controlled value/);
  const event = newEvent({ facts: [[DP.intakeChannel, "EMAIL"]] });
  assert.equal(event.provenance.source, "Customer", "the channel did not touch provenance");
  assert.equal(describeCustomerEvent(event).intakeChannel, "Email");
  for (const source of ["Customer", "Company Staff", "Driver Report", "Camera", "Other"]) assert.deepEqual(messages(newEvent({ extra: { provenance: { sourceType: "SOURCE_FACT", source } } })), [], source);
  assert.match(messages(newEvent({ extra: { provenance: { sourceType: "SOURCE_FACT", source: "Dashcam / AI" } } })).join(" "), /Source is required/);
});

// 16-22 -----------------------------------------------------------------------
test("16. parties carry stable unique ids, controlled capacities, person types, certainty and access classification", () => {
  const event = newEvent({ draft: { parties: [party({ accessClassification: "RESTRICTED_INTERNAL", certainty: "PARTIALLY_IDENTIFIED" }), subjParty()] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(readCustomerParties(event).map((entry: any) => entry.itemId), ["P1", "P-SUBJ"]);
  assert.match(messages(newEvent({ draft: { parties: [party(), party()] } })).join(" "), /Party ids must be present and unique/);
  assert.match(messages(newEvent({ draft: { parties: [party({ capacities: [] })] } })).join(" "), /needs at least one capacity/);
  assert.match(messages(newEvent({ draft: { parties: [party({ capacities: ["BOSS"] })] } })).join(" "), /capacity must be a controlled value/);
  const duplicated = newEvent({ draft: { parties: [party()] } }); duplicated.childCollections.find((c: any) => c.collectionId === CID.PARTIES).items[0].facts.capacities = "REPORTER|REPORTER";
  assert.match(messages(duplicated).join(" "), /same capacity more than once/);
  assert.match(messages(newEvent({ draft: { parties: [party({ personType: "ALIEN" })] } })).join(" "), /Person type must be a controlled value/);
  assert.match(messages(newEvent({ draft: { parties: [party({ certainty: "SURE" })] } })).join(" "), /Identification certainty must be a controlled value/);
  assert.match(messages(newEvent({ draft: { parties: [party({ accessClassification: "SECRET" })] } })).join(" "), /Access classification must be a controlled value/);
  assert.match(messages(newEvent({ draft: { parties: [party({ evidenceIds: ["EV-X"] })] } })).join(" "), /not linked to this Customer Event/);
  for (const type of ["CARRIER_DRIVER", "DISPATCHER", "CUSTOMER_CONTACT", "CUSTOMER_EMPLOYEE", "FORKLIFT_OPERATOR", "YARD_WORKER", "CONTRACTOR", "VISITOR", "SECURITY", "OTHER"]) assert.deepEqual(messages(newEvent({ draft: { parties: [party({ personType: type })] } })), [], type);
});

test("17. observer and subject are distinct: one party cannot be both, and a subject needs the Subject capacity", () => {
  const both = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty({ capacities: ["SUBJECT", "OBSERVER"] })], behaviors: [behavior()] } });
  assert.match(messages(both).join(" "), /observer and the subject of an observation must be distinct/);
  const notSubject = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty({ capacities: ["INVOLVED"] })], behaviors: [behavior()] } });
  assert.match(messages(notSubject).join(" "), /needs the Subject capacity/);
  const ok = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [obsParty(), subjParty()], behaviors: [behavior()] } });
  assert.deepEqual(messages(ok), []);
  assert.deepEqual(describeCustomerEvent(ok).parties.map((entry: any) => entry.capacities), [["Observer"], ["Subject"]]);
});

test("18-20. the owning driver may be the observer, the subject or the reporter; the role is derived and never a responsibility", () => {
  const asObserver = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [obsParty({ isOwningDriver: true }), subjParty()], behaviors: [behavior()] } });
  assert.deepEqual(messages(asObserver), []);
  assert.deepEqual(deriveOwningDriverRole(asObserver).labels, ["Observer"]);
  assert.equal(describeCustomerEvent(asObserver).owningDriver.text, "Owning driver's role: Observer");
  const subject = describeCustomerEvent(asObserver).behaviors[0].subject;
  assert.match(subject!, /Forklift operator/, "the subject is the forklift operator, not the owning driver");
  const asSubject = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [party({ itemId: "P-SUBJ", capacities: ["SUBJECT"], personType: "CARRIER_DRIVER", isOwningDriver: true, name: "Tony Mayer" }), party({ itemId: "P-MGR", capacities: ["OBSERVER", "REPORTER"], personType: "CUSTOMER_CONTACT", name: "Site manager" })], behaviors: [behavior({ description: "Reported as not following a posted site rule." })] } });
  assert.deepEqual(messages(asSubject), []);
  assert.deepEqual(deriveOwningDriverRole(asSubject).labels, ["Subject"]);
  const asReporter = newEvent({ draft: { parties: [party({ itemId: "P-DRV", capacities: ["REPORTER", "INVOLVED"], personType: "CARRIER_DRIVER", isOwningDriver: true })] } });
  assert.deepEqual(deriveOwningDriverRole(asReporter).labels, ["Reporter", "Involved"]);
  for (const event of [asObserver, asSubject, asReporter]) assert.ok(!/responsib|fault|violat|caused/i.test(JSON.stringify(describeCustomerEvent(event))), "no blame language");
  assert.equal(describeCustomerEvent(newEvent()).owningDriver.text, "Owning driver's role not recorded");
  assert.equal(readCustomerParties(newEvent({ draft: { parties: [party({ isOwningDriver: false })] } }))[0].linkedDriverMasterId, "", "no invented driver link");
  assert.match(messages(newEvent({ draft: { parties: [party({ personType: "CUSTOMER_CONTACT", isOwningDriver: true })] } })).join(" "), /Only a carrier driver can be linked/);
  const foreign = newEvent({ draft: { parties: [party({ personType: "CARRIER_DRIVER" })] } });
  foreign.childCollections.find((c: any) => c.collectionId === CID.PARTIES).items[0].facts.linkedDriverMasterId = "DRV-OTHER";
  assert.match(messages(foreign).join(" "), /linked driver must be this event's owning Driver/);
  assert.match(messages(newEvent({ draft: { parties: [party({ itemId: "A", personType: "CARRIER_DRIVER", isOwningDriver: true }), party({ itemId: "B", personType: "CARRIER_DRIVER", isOwningDriver: true })] } })).join(" "), /Only one party can be linked/);
});

test("21-22. the subject can be a non-driver, and one person may hold several capacities", () => {
  const event = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty({ personType: "CONTRACTOR", name: "", certainty: "UNIDENTIFIED" }), party({ itemId: "P-MGR", capacities: ["REPORTER", "OBSERVER", "RECORDED_BY"], personType: "CUSTOMER_CONTACT" })], behaviors: [behavior()] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(describeCustomerEvent(event).parties[1].capacities, ["Reporter", "Observer", "Recorded By"]);
  assert.equal(describeCustomerEvent(event).parties[0].certainty, "Unidentified");
  assert.ok(event.driverMasterId === "DRV-1" && !readCustomerParties(event).some((entry: any) => entry.linkedDriverMasterId), "a non-driver subject does not need or create a driver");
});

// 23-28 -----------------------------------------------------------------------
test("23-24. complaint categories are controlled; one primary and zero or more distinct secondary categories", () => {
  for (const category of ["DELIVERY_PERFORMANCE", "PICKUP_PERFORMANCE", "COMMUNICATION", "DRIVER_CONDUCT", "CARGO_CONDITION", "DOCUMENTATION", "BILLING_CHARGES", "SAFETY_COMPLIANCE", "TECHNOLOGY_VISIBILITY", "SITE_FACILITY", "OTHER"]) assert.deepEqual(messages(newEvent({ facts: [[DP.complaintPrimaryCategory, category]] })), [], category);
  assert.match(messages(newEvent({ facts: [[DP.complaintPrimaryCategory, "RUDENESS"]] })).join(" "), /Complaint primary category must be a controlled value/);
  assert.match(messages(newEvent({ facts: [[DP.complaintPrimaryCategory, "COMMUNICATION"], [DP.complaintSecondaryCategories, "COMMUNICATION"]] })).join(" "), /cannot repeat the primary/);
  assert.match(messages(newEvent({ facts: [[DP.complaintPrimaryCategory, "COMMUNICATION"], [DP.complaintSecondaryCategories, "DOCUMENTATION|DOCUMENTATION"]] })).join(" "), /listed more than once/);
  assert.match(messages(newEvent({ facts: [[DP.complaintPrimaryCategory, "COMMUNICATION"], [DP.complaintSecondaryCategories, "NONSENSE"]] })).join(" "), /Secondary complaint category must be a controlled value/);
  assert.match(messages(newEvent({ facts: [[DP.complaintSecondaryCategories, "DOCUMENTATION"]] })).join(" "), /Choose the primary complaint category/);
  assert.deepEqual(messages(newEvent({ facts: [[DP.complaintPrimaryCategory, "DELIVERY_PERFORMANCE"], [DP.complaintSecondaryCategories, "COMMUNICATION|DRIVER_CONDUCT"]] })), []);
  const event = newEvent({ facts: [[DP.complaintPrimaryCategory, "DRIVER_CONDUCT"]] });
  assert.deepEqual(readCustomerClaims(event), [], "a category creates no claim, no investigation and no other event");
  assert.equal(flow(event).state, "NOT_REQUIRED");
  assert.equal(state([event]).events.length, 1);
});

test("25-27. a Complaint can carry several claims; every claim stays Reported; a claim never creates a confirmed fact or another event", () => {
  const event = newEvent({ draft: { claims: [claim(), claim({ itemId: "CL2", claimType: "POOR_COMMUNICATION", reportedIssue: "Nobody called ahead", reportedStatement: "" }), claim({ itemId: "CL3", claimType: "UNSAFE_OPERATION", reportedStatement: "Driver was speeding through our yard." })] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(readCustomerClaims(event).map((entry: any) => entry.assertionStatus), ["REPORTED", "REPORTED", "REPORTED"]);
  assert.ok(describeCustomerEvent(event).complaint?.claims.every((entry: any) => entry.status === "Reported (not established)"));
  const tampered = newEvent({ draft: { claims: [claim()] } });
  for (const status of ["CONFIRMED", "PROVEN", "SUBSTANTIATED", "FALSE", ""]) { tampered.childCollections.find((c: any) => c.collectionId === CID.CLAIMS).items[0].facts.assertionStatus = status; assert.match(messages(tampered).join(" "), /cannot be recorded as confirmed, proven, substantiated or false/, status || "blank"); }
  const upserted = apply(event, CID.CLAIMS, { claimType: "NO_SHOW", assertionStatus: "CONFIRMED" }, { itemId: "CL1" }).event;
  assert.equal(readCustomerClaims(upserted)[0].assertionStatus, "REPORTED", "even a writer cannot confirm a claim");
  assert.match(messages(newEvent({ draft: { claims: [claim({ claimType: "" })] } })).join(" "), /needs a claim type/);
  assert.match(messages(newEvent({ draft: { claims: [claim({ claimType: "WITCHCRAFT" })] } })).join(" "), /Claim type must be a controlled value/);
  assert.match(messages(newEvent({ draft: { claims: [claim({ source: "RUMOUR" })] } })).join(" "), /Claim source must be a controlled value/);
  assert.match(messages(newEvent({ draft: { claims: [claim(), claim()] } })).join(" "), /Claim ids must be present and unique/);
  assert.match(messages(newEvent({ draft: { claims: [claim({ evidenceIds: ["EV-X"] })] } })).join(" "), /not linked to this Customer Event/);
  // "Driver was speeding" is an allegation: it is not a Speeding event, a determination or a Company Action.
  const s = state([event]);
  assert.equal(s.events.length, 1);
  assert.deepEqual(s.companyDeterminations, []);
  assert.deepEqual(s.companyActions, []);
  assert.equal(flow(event).state, "NOT_REQUIRED");
  assert.ok(!/violated|caused|at fault|confirmed misconduct/i.test(JSON.stringify(describeCustomerEvent(event))));
});

test("28. original statement, normalized summary, claim and established facts are kept separate; statements need an access classification", () => {
  const event = newEvent({ facts: [[DP.normalizedNarrative, "Customer reported a late delivery and no call-ahead."]], draft: { statements: [statement({ accessClassification: "RESTRICTED_INTERNAL", evidenceIds: ["EV-1"] })], claims: [claim()], parties: [party()] } });
  assert.deepEqual(messages(event), []);
  const view = describeCustomerEvent(event);
  assert.equal(view.normalizedNarrative, "Customer reported a late delivery and no call-ahead.");
  assert.equal(view.statements[0].text, "Your driver was four hours late and never called.");
  assert.equal(view.complaint?.claims[0].reportedStatement, "Driver arrived four hours late.");
  assert.notEqual(view.normalizedNarrative, view.statements[0].text);
  assert.equal(view.statements[0].access, "Restricted - internal");
  assert.ok(!event.structuredEventFacts.some((entry: any) => entry.value === "Your driver was four hours late and never called."), "the long original wording is not duplicated into parent facts");
  assert.deepEqual(readCustomerStatements(event)[0].evidenceIds, ["EV-1"], "source evidence stays canonical");
  assert.match(messages(newEvent({ draft: { statements: [statement({ accessClassification: "" })] } })).join(" "), /needs an access classification/);
  assert.match(messages(newEvent({ draft: { statements: [statement({ text: "" })] } })).join(" "), /needs the statement text/);
  assert.match(messages(newEvent({ draft: { statements: [statement({ providedByPartyId: "P-GHOST" })] } })).join(" "), /party that does not exist/);
  assert.match(messages(newEvent({ draft: { statements: [statement(), statement()] } })).join(" "), /Original statement ids must be present and unique/);
});

// 29-36 -----------------------------------------------------------------------
test("29-33. SUBSTANTIATION is an additive determination subject with four stored outcomes; Pending is never stored", () => {
  assert.deepEqual([...SUBSTANTIATION_OUTCOMES], ["SUBSTANTIATED", "PARTIALLY_SUBSTANTIATED", "UNSUBSTANTIATED", "UNABLE_TO_DETERMINE"]);
  assert.deepEqual(validateDeterminationAssessment({ subject: "SUBSTANTIATION", outcome: "PENDING_ASSESSMENT" } as any).length, 1);
  assert.deepEqual(validateDeterminationAssessment({ subject: "SUBSTANTIATION", outcome: "DUPLICATE" } as any).length, 1, "Duplicate is not a substantiation outcome");
  const event = newEvent();
  for (const [outcome, label] of [["SUBSTANTIATED", "Substantiated"], ["PARTIALLY_SUBSTANTIATED", "Partially"], ["UNSUBSTANTIATED", "Unsubstantiated"], ["UNABLE_TO_DETERMINE", "Unable"]] as const) {
    const opened = withInvestigation(event);
    const recorded = substantiate(opened.state, opened.investigation.id, outcome);
    assert.equal(recorded.determination.subject, "SUBSTANTIATION", label);
    assert.equal((recorded.determination.assessment as any).outcome, outcome, label);
    assert.equal(recorded.determination.determinationType, "COMPLAINT_SUBSTANTIATION");
  }
  const opened = withInvestigation(event);
  const first = substantiate(opened.state, opened.investigation.id, "SUBSTANTIATED");
  const amended = substantiate(first.state, opened.investigation.id, "PARTIALLY_SUBSTANTIATED");
  assert.equal(amended.superseded?.id, first.determination.id, "an amendment supersedes; history is preserved");
  assert.equal(amended.state.companyDeterminations.filter((d: any) => d.subject === "SUBSTANTIATION" && d.status === "ACTIVE").length, 1);
});

test("34. Pending assessment is derived by the ABSENCE of a substantiation determination", () => {
  const event = setCustomerRequirement(newEvent(), { field: "complaintAssessmentRequired", to: "YES", changedBy: "SM", at: "2026-10-04T09:00:00.000Z" });
  assert.deepEqual(flow(event).openReasons.map((reason: any) => reason.code), ["COMPLAINT_ASSESSMENT_PENDING"]);
  const opened = withInvestigation(event);
  assert.deepEqual(deriveEventWorkflow(event, opened.state).openReasons.map((reason: any) => reason.code), ["COMPLAINT_ASSESSMENT_PENDING"], "an open investigation alone does not resolve the assessment");
  const done = substantiate(opened.state, opened.investigation.id, "UNABLE_TO_DETERMINE");
  const workflow = deriveEventWorkflow(event, done.state);
  assert.deepEqual(workflow.openReasons, []);
  assert.ok(workflow.resolvedReasons.some((reason: any) => reason.code === "COMPLAINT_ASSESSMENT_PENDING"));
  assert.equal(workflow.state, "READY_TO_CLOSE");
  const withdrawn = flow(newEvent());
  assert.equal(withdrawn.state, "NOT_REQUIRED", "a Complaint with no explicit requirement has no pending assessment");
});

test("35. a duplicate Complaint is Classification = DUPLICATE plus a DUPLICATE_OF relationship; both events remain", () => {
  const original = newEvent();
  const duplicate = { ...newEvent({ extra: { id: "CE-2" } }), id: "CE-2" };
  const opened = openPerformanceInvestigation(state([original, duplicate]), { eventId: "CE-2", openedBy: "SM" });
  const classified = recordPerformanceDetermination(opened.state, { investigationId: opened.investigation.id, assessment: { subject: "CLASSIFICATION", outcome: "DUPLICATE" }, determinedBy: "SM", determinationDate: "2026-10-05" });
  const related = createPerformanceEventRelationship(classified.state, { fromEventId: "CE-2", toEventId: "CE-1", type: "DUPLICATE_OF", createdBy: "SM", note: "Same email re-sent through the portal" });
  assert.equal(related.state.events.length, 2, "nothing is deleted");
  assert.deepEqual(getEventRelationships(related.state, "CE-2").map((view: any) => [view.effectiveType, view.otherEventId]), [["DUPLICATE_OF", "CE-1"]]);
  assert.deepEqual(getEventRelationships(related.state, "CE-1").map((view: any) => [view.effectiveType, view.otherEventId]), [["HAS_DUPLICATE", "CE-2"]]);
  assert.equal((classified.determination.assessment as any).outcome, "DUPLICATE");
  assert.ok(!(SUBSTANTIATION_OUTCOMES as readonly string[]).includes("DUPLICATE"));
  const same = createPerformanceEventRelationship(state([original, duplicate]), { fromEventId: "CE-1", toEventId: "CE-2", type: "SAME_OCCURRENCE_AS", createdBy: "SM" });
  assert.equal(getEventRelationships(same.state, "CE-2")[0].effectiveType, "SAME_OCCURRENCE_AS");
  const superseded = createPerformanceEventRelationship(state([original, duplicate]), { fromEventId: "CE-2", toEventId: "CE-1", type: "SUPERSEDES", createdBy: "SM" });
  assert.equal(superseded.state.events.length, 2);
});

test("36. common investigation completion still requires Classification; Substantiation does not replace it", () => {
  const event = newEvent();
  const opened = withInvestigation(event);
  const substantiated = substantiate(opened.state, opened.investigation.id, "SUBSTANTIATED");
  const concluded = updatePerformanceInvestigation(substantiated.state, opened.investigation.id, { by: "SM", conclusion: { summary: "Reviewed." } });
  assert.throws(() => completePerformanceInvestigation(concluded.state, opened.investigation.id, { by: "SM" }), /Classification determination/);
  const classified = recordPerformanceDetermination(concluded.state, { investigationId: opened.investigation.id, assessment: { subject: "CLASSIFICATION", outcome: "CONFIRMED_AS_REPORTED" }, determinedBy: "SM", determinationDate: "2026-10-05" });
  const completed = completePerformanceInvestigation(classified.state, opened.investigation.id, { by: "SM" });
  assert.equal(getInvestigationsForEvent(completed.state, "CE-1")[0].status, "COMPLETED");
  assert.equal(completed.state.companyDeterminations.filter((d: any) => d.status === "ACTIVE").length, 2, "Classification and Substantiation coexist");
});

// 37-40 -----------------------------------------------------------------------
test("37-39. a Commendation needs a recognized party, stores raw positive behavior, and uses no investigation by default", () => {
  assert.match(messages(newEvent({ subtype: "COMMENDATION", draft: { commendation: commendation({ recognizedPartyId: "" }), parties: [recParty()] } })).join(" "), /needs a recognized party/);
  assert.match(messages(newEvent({ subtype: "COMMENDATION", draft: { commendation: commendation({ recognizedPartyId: "P-GHOST" }), parties: [recParty()] } })).join(" "), /recognized party does not exist/);
  assert.match(messages(newEvent({ subtype: "COMMENDATION", draft: { commendation: commendation(), parties: [recParty({ capacities: ["INVOLVED"] })] } })).join(" "), /needs the Recognized Party capacity/);
  for (const category of ["PROACTIVE_COMMUNICATION", "PROFESSIONAL_CONDUCT", "SAFE_SITE_CONDUCT", "SAFE_DRIVING_RECOGNITION", "CAREFUL_CARGO_HANDLING", "PROBLEM_RESOLUTION", "DOCUMENTATION_QUALITY", "OTHER"]) assert.deepEqual(messages(newEvent({ subtype: "COMMENDATION", draft: { commendation: commendation({ positiveBehaviorCategory: category }), parties: [recParty()] } })), [], category);
  assert.match(messages(newEvent({ subtype: "COMMENDATION", draft: { commendation: commendation({ positiveBehaviorCategory: "HEROISM" }), parties: [recParty()] } })).join(" "), /Positive behavior category must be a controlled value/);
  assert.match(messages(newEvent({ subtype: "COMMENDATION", draft: { commendation: commendation({ recognitionLevel: "GOLD" }), parties: [recParty()] } })).join(" "), /Recognition level must be a controlled value/);
  assert.match(messages(newEvent({ subtype: "COMMENDATION", draft: { commendation: commendation({ shareConsent: "MAYBE" }), parties: [recParty()] } })).join(" "), /Share consent must be a controlled value/);
  const event = newEvent({ subtype: "COMMENDATION", draft: { commendation: commendation(), parties: [recParty()] } });
  assert.equal(flow(event).state, "NOT_REQUIRED", "a Commendation never requires an investigation by default");
  assert.deepEqual(getInvestigationsForEvent(state([event]), "CE-1"), []);
  assert.deepEqual(customerEventWorkflowProvider.collect(event, state([event])), []);
  assert.ok(!JSON.stringify(event).match(/safetyScore|riskReduction|cancelsComplaint/i));
});

test("40. recognition creates no Company Action and no new action type", () => {
  const event = newEvent({ subtype: "COMMENDATION", draft: { commendation: commendation({ recognitionAction: "Recognized at the monthly meeting" }), parties: [recParty()] } });
  const s = state([event]);
  assert.deepEqual(s.companyActions, []);
  assert.equal(describeCustomerEvent(event).commendation?.recognitionAction, "Recognized at the monthly meeting");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return import("../../../lib/driver-taxonomy.ts" as any).then((taxonomy: any) => { assert.ok(!taxonomy.COMPANY_ACTION_TYPES.some((type: string) => /RECOGNI|COMMEND|PRAISE/i.test(type)), "Company Actions stay corrective / operational"); });
});

// 41-44 -----------------------------------------------------------------------
test("41-43. Site Behavior person behavior and site condition are separate records; an event can hold either or both", () => {
  const personOnly = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [obsParty(), subjParty()], behaviors: [behavior({ secondaryCategories: ["CONFLICT_ESCALATION"], certainty: "OBSERVED" })] } });
  assert.deepEqual(messages(personOnly), []);
  assert.deepEqual([describeCustomerEvent(personOnly).behaviors.length, describeCustomerEvent(personOnly).conditions.length], [1, 0]);
  const siteOnly = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [obsParty()], conditions: [condition({ immediateRisk: "YES", certainty: "REPORTED" })] } });
  assert.deepEqual(messages(siteOnly), [], "a site condition needs no person behavior");
  assert.deepEqual([describeCustomerEvent(siteOnly).behaviors.length, describeCustomerEvent(siteOnly).conditions.length], [0, 1]);
  assert.equal(describeCustomerEvent(siteOnly).conditions[0].immediateRisk, "Yes");
  const both = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [obsParty({ isOwningDriver: true }), subjParty()], behaviors: [behavior({ description: "Ignored the blocked dock signage" })], conditions: [condition()] } });
  assert.deepEqual(messages(both), []);
  assert.deepEqual([describeCustomerEvent(both).behaviors.length, describeCustomerEvent(both).conditions.length], [1, 1]);
  for (const category of ["DRIVER_BEHAVIOR", "CUSTOMER_SITE_CONDUCT", "SAFETY_COMPLIANCE", "SECURITY_BEHAVIOR", "COMMUNICATION_BEHAVIOR", "OPERATIONAL_BEHAVIOR", "CONFLICT_ESCALATION", "ENVIRONMENTAL_HOUSEKEEPING", "OTHER"]) assert.deepEqual(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty()], behaviors: [behavior({ primaryCategory: category })] } })), [], category);
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty()], behaviors: [behavior({ primaryCategory: "RUDE" })] } })).join(" "), /Behavior category must be a controlled value/);
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty()], behaviors: [behavior({ primaryCategory: "SAFETY_COMPLIANCE", secondaryCategories: ["SAFETY_COMPLIANCE"] })] } })).join(" "), /cannot repeat the primary/);
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty()], behaviors: [behavior({ subjectPartyId: "" })] } })).join(" "), /needs the party who is the subject/);
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty()], behaviors: [behavior({ subjectPartyId: "P-GHOST" })] } })).join(" "), /subject party that does not exist/);
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty()], behaviors: [behavior({ description: "" })] } })).join(" "), /needs a description/);
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { conditions: [condition({ category: "" })] } })).join(" "), /needs a category/);
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { conditions: [condition({ immediateRisk: "MAYBE" })] } })).join(" "), /Immediate risk must be a controlled value/);
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { conditions: [condition({ certainty: "SURE" })] } })).join(" "), /Site condition certainty must be a controlled value/);
});

test("44. a subject or a site condition never implies responsibility, a violation or another Performance event", () => {
  const event = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [party({ itemId: "P-SUBJ", capacities: ["SUBJECT"], personType: "CARRIER_DRIVER", isOwningDriver: true }), party({ itemId: "P-MGR", capacities: ["OBSERVER"], personType: "CUSTOMER_CONTACT" })], behaviors: [behavior({ primaryCategory: "DRIVER_BEHAVIOR" })], conditions: [condition()] } });
  const s = state([event]);
  assert.deepEqual(s.companyDeterminations, []);
  assert.deepEqual(s.companyActions, []);
  assert.equal(s.events.length, 1, "no Near Miss, Backing, Security or Speeding event was created");
  assert.equal(flow(event).state, "NOT_REQUIRED");
  assert.ok(!event.structuredEventFacts.some((entry: any) => /responsib|violation|fault/i.test(entry.dataPointId)));
  assert.ok(!/violated|caused|at fault|confirmed misconduct|responsible/i.test(JSON.stringify(describeCustomerEvent(event))));
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty()], behaviors: [behavior()] } })).join(" ") || "ok", /^ok$/);
});

// 45-49 -----------------------------------------------------------------------
test("45. immediate response facts are Yes / No / Unknown occurrence facts, not resolution, Company Actions or findings", () => {
  const event = newEvent({ subtype: "SITE_BEHAVIOR", facts: [[DP.coachingGiven, "NO"], [DP.activityStopped, "YES"], [DP.supervisorContacted, "YES"], [DP.securityContacted, "UNKNOWN"], [DP.emergencyServicesContacted, "NO"], [DP.areaSecured, "YES"], [DP.noImmediateAction, "NO"], [DP.otherImmediateAction, "YES"], [DP.otherImmediateActionNote, "Radioed the gate"]] });
  assert.deepEqual(messages(event), []);
  const view = describeCustomerEvent(event);
  assert.equal(view.response.length, 8);
  assert.ok(view.response.some((row: any) => row.value === "No") && view.response.some((row: any) => row.value === "Unknown"));
  assert.equal(view.responseNote, "Radioed the gate");
  assert.match(messages(newEvent({ facts: [[DP.otherImmediateAction, "YES"]] })).join(" "), /Describe the Other immediate action/);
  assert.match(messages(newEvent({ facts: [[DP.otherImmediateActionNote, "x"]] })).join(" "), /belongs only to Other = Yes/);
  assert.match(messages(newEvent({ facts: [[DP.areaSecured, "MAYBE"]] })).join(" "), /Area Secured must be a controlled value/);
  assert.deepEqual(state([event]).companyActions, []);
  assert.equal(flow(event).state, "NOT_REQUIRED");
  assert.equal(describeCustomerEvent(newEvent()).response.length, 0, "unrecorded facts are not presented as No");
});

test("46. the response timeline is sequenced, keeps actual timestamps and derives latencies without storing them", () => {
  const event = newEvent({ draft: { steps: [
    step(2, { action: "ACKNOWLEDGED", timestamp: "2026-10-03T16:30", actor: "Dispatcher" }), step(1, { action: "RECEIVED_RECORDED", timestamp: "2026-10-03T16:00" }), step(3, { action: "ASSIGNED", timestamp: "2026-10-03T17:00" }),
    step(4, { action: "INVESTIGATION_STARTED", timestamp: "2026-10-04T09:00" }), step(5, { action: "RESPONSE_SENT", timestamp: "2026-10-04T12:00" }), step(6, { action: "RESOLUTION_PROVIDED", timestamp: "2026-10-05T10:00" }),
    step(7, { action: "FOLLOW_UP_REQUESTED" }), step(8, { action: "REOPENED", timestamp: "2026-10-06T08:00" }), step(9, { action: "OTHER", actionOther: "Escalated to account manager" }),
  ] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(readCustomerTimeline(event).map((entry: any) => entry.ordinal), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(deriveCustomerResponseDelays(event), { receivedToAcknowledgedMinutes: 30, receivedToAssignedMinutes: 60, receivedToInvestigationStartedMinutes: 1020, receivedToResponseMinutes: 1200, receivedToResolutionMinutes: 2520 });
  assert.ok(!/Minutes|latency/i.test(JSON.stringify(event.childCollections)), "no latency is stored");
  assert.match(messages(newEvent({ draft: { steps: [step(1), { ...step(2), ordinal: "1" }] } })).join(" "), /ordinals must be unique/);
  assert.match(messages(newEvent({ draft: { steps: [step(1, { ordinal: "0" })] } })).join(" "), /positive whole numbers/);
  assert.match(messages(newEvent({ draft: { steps: [step(1, { timestamp: "2026-10-04T10:00" }), step(2, { timestamp: "2026-10-04T09:00" })] } })).join(" "), /chronological order/);
  assert.match(messages(newEvent({ draft: { steps: [step(1, { timestamp: "2026-10-02T10:00" })] } })).join(" "), /cannot be before the occurrence/);
  assert.match(messages(newEvent({ draft: { steps: [step(1, { action: "" })] } })).join(" "), /needs an action/);
  assert.match(messages(newEvent({ draft: { steps: [step(1, { action: "PANIC" })] } })).join(" "), /Response action must be a controlled value/);
  assert.match(messages(newEvent({ draft: { steps: [step(1, { action: "OTHER" })] } })).join(" "), /Describe the Other response action/);
  assert.match(messages(newEvent({ draft: { steps: [step(1, { evidenceIds: ["EV-X"] })] } })).join(" "), /not linked to this Customer Event/);
  const appended = upsertCustomerChild(event, { collectionId: CID.TIMELINE, facts: { action: "ACKNOWLEDGED", timestamp: "2026-10-07T08:00" } }).event;
  assert.equal(readCustomerTimeline(appended).length, 10);
  assert.equal(readCustomerTimeline(appended)[9].ordinal, 10, "the next ordinal is assigned automatically");
});

test("47-49. resolution and customer outcome are separate from investigation and closure; acceptance and rejection never close or open anything", () => {
  const resolved = newEvent({ draft: { resolution: { ...emptyCustomerResolution(), status: "PROVIDED", summary: "Re-delivered with a credit offer", owner: "Account manager", responseProvided: "YES", responseProvidedAt: "2026-10-04T12:00", resolutionProvidedAt: "2026-10-05T10:00" }, outcome: { ...emptyCustomerOutcome(), acceptance: "ACCEPTED", customerResponseReceivedAt: "2026-10-05T15:00", followUpRequested: "NO", note: "Customer satisfied with the credit" } } });
  assert.deepEqual(messages(resolved), []);
  const view = describeCustomerEvent(resolved);
  assert.deepEqual([view.resolution?.status, view.outcome?.acceptance, view.outcome?.followUpRequested], ["Provided", "Accepted", "No"]);
  assert.equal(flow(resolved).state, "NOT_REQUIRED", "acceptance and a provided resolution neither close the case nor create an obligation");
  assert.equal(flow(resolved).closure, undefined);
  for (const acceptance of ["ACCEPTED", "REJECTED", "NO_RESPONSE", "NOT_REQUESTED", "PENDING", "UNKNOWN"]) {
    const event = newEvent({ draft: { resolution: { ...emptyCustomerResolution(), responseProvided: "YES", responseProvidedAt: "2026-10-04T12:00" }, outcome: { ...emptyCustomerOutcome(), acceptance } } });
    assert.deepEqual(messages(event), [], acceptance);
    assert.equal(flow(event).state, "NOT_REQUIRED", `${acceptance} is not a workflow obligation`);
  }
  const rejected = newEvent({ draft: { resolution: { ...emptyCustomerResolution(), status: "PROVIDED", responseProvided: "YES" }, outcome: { ...emptyCustomerOutcome(), acceptance: "REJECTED", customerResponseReceivedAt: "2026-10-06T09:00" } } });
  assert.deepEqual(flow(rejected).reasons, [], "customer rejection does not keep the case open");
  const rejectedWithObligation = setCustomerRequirement(rejected, { field: "complaintAssessmentRequired", to: "YES", changedBy: "SM" });
  const accepted = apply(rejectedWithObligation, CID.OUTCOME, { acceptance: "ACCEPTED" }).event;
  assert.deepEqual(flow(accepted).openReasons.map((reason: any) => reason.code), ["COMPLAINT_ASSESSMENT_PENDING"], "acceptance does not resolve an unrelated internal obligation");
  assert.match(messages(newEvent({ draft: { outcome: { ...emptyCustomerOutcome(), acceptance: "HAPPY" } } })).join(" "), /Customer acceptance must be a controlled value/);
  const res = (patch: Record<string, unknown>) => ({ ...emptyCustomerResolution(), ...patch });
  assert.match(messages(newEvent({ draft: { resolution: res({ responseProvidedAt: "2026-10-04T12:00" }) } })).join(" "), /needs Response provided = Yes/);
  assert.match(messages(newEvent({ draft: { resolution: res({ resolutionProvidedAt: "2026-10-04T12:00", status: "IN_PROGRESS" }) } })).join(" "), /needs the resolution status Provided/);
  assert.match(messages(newEvent({ draft: { resolution: res({ status: "PROVIDED", responseProvided: "YES", responseProvidedAt: "2026-10-05T12:00", resolutionProvidedAt: "2026-10-04T12:00" }) } })).join(" "), /resolution cannot be provided before the response/);
  assert.match(messages(newEvent({ draft: { resolution: res({ responseProvided: "YES", responseProvidedAt: "2026-10-05T12:00" }), outcome: { ...emptyCustomerOutcome(), customerResponseReceivedAt: "2026-10-04T12:00" } } })).join(" "), /customer cannot respond before/);
  assert.deepEqual(messages(newEvent({ draft: { outcome: { ...emptyCustomerOutcome(), customerResponseReceivedAt: "2026-10-04T12:00" } } })), [], "no TES timestamp is known, so nothing is contradicted and nothing is invented");
  assert.deepEqual(messages(newEvent({ draft: { resolution: res({ responseProvided: "YES", responseProvidedAt: "2026-10-04T12:00" }), outcome: { ...emptyCustomerOutcome(), customerResponseReceivedAt: "2026-10-04T12:00" } } })), [], "a reaction at the same minute is not before");
  assert.match(messages(newEvent({ draft: { resolution: res({ responseProvided: "MAYBE" }) } })).join(" "), /Response provided must be a controlled value/);
  assert.match(messages(newEvent({ draft: { resolution: res({ responseProvided: "YES", responseProvidedAt: "2026-10-02T12:00" }) } })).join(" "), /cannot be before the occurrence/);
  // single canonical owner: no TES response / resolution fact exists on the customer outcome, and no field is duplicated
  const owner = newEvent({ draft: { resolution: res({ status: "PROVIDED", responseProvided: "YES", responseProvidedAt: "2026-10-04T12:00", resolutionProvidedAt: "2026-10-05T10:00" }), outcome: { ...emptyCustomerOutcome(), acceptance: "REJECTED", customerResponseReceivedAt: "2026-10-05T15:00", followUpRequested: "YES", note: "Not accepted" } } });
  const resolutionFacts = Object.keys(owner.childCollections.find((c: any) => c.collectionId === CID.RESOLUTION).items[0].facts);
  const outcomeFacts = Object.keys(owner.childCollections.find((c: any) => c.collectionId === CID.OUTCOME).items[0].facts);
  assert.deepEqual(outcomeFacts.sort(), ["acceptance", "customerResponseReceivedAt", "followUpRequested", "note"]);
  assert.ok(["responseProvided", "responseProvidedAt", "resolutionProvidedAt", "status", "summary", "owner"].every((key) => resolutionFacts.includes(key)));
  assert.ok(!outcomeFacts.some((key) => resolutionFacts.includes(key)), "no fact is persisted in both records");
  assert.deepEqual(describeCustomerEvent(owner).chronology.map((row: any) => [row.label, row.at]), [["TES response provided", "2026-10-04T12:00"], ["Resolution provided", "2026-10-05T10:00"], ["Customer response received", "2026-10-05T15:00"]], "the combined chronology is read from the two records");
  assert.equal(Object.keys(describeCustomerEvent(owner).outcome!).includes("responseProvidedAt"), false);
  // TES response != customer reaction != closure
  assert.equal(flow(owner).state, "NOT_REQUIRED");
  assert.match(messages(newEvent({ subtype: "COMMENDATION", draft: { outcome: { ...emptyCustomerOutcome(), acceptance: "ACCEPTED" }, parties: [recParty()], commendation: commendation() } })).join(" "), /do not apply to a Commendation/);
  assert.equal(readCustomerResolution(newEvent()), undefined);
  assert.equal(readCustomerOutcome(newEvent()), undefined);
});

// 50-54 -----------------------------------------------------------------------
test("50. financial facts are raw local amounts; actual and potential stay separate; revenue at risk is its own fact; nothing is totalled", () => {
  const event = newEvent({ draft: { financial: { credit: "250", creditCurrency: "CAD", creditBasis: "ACTUAL", chargeback: "100", chargebackCurrency: "USD", chargebackBasis: "POTENTIAL", detention: "300", detentionCurrency: "CAD", detentionBasis: "ACTUAL", revenueAtRisk: "50000", revenueAtRiskCurrency: "CAD", other: "10", otherCurrency: "CAD", otherBasis: "ACTUAL", otherLabel: "Courier" } } });
  assert.deepEqual(messages(event), []);
  const financial = readCustomerFinancial(event)!;
  assert.deepEqual(financial.rows.map((row: any) => row.kind), ["credit", "chargeback", "detention", "revenueAtRisk", "other"]);
  assert.deepEqual(financial.rows.find((row: any) => row.kind === "chargeback")!.money, { value: 100, currencyCode: "USD", basis: "POTENTIAL" });
  assert.equal(financial.rows.find((row: any) => row.kind === "revenueAtRisk")!.money.basis, undefined, "revenue at risk carries no actual/potential flag");
  const view = describeCustomerEvent(event).financial!;
  assert.ok(view.rows.some((row: any) => row.label === "Other: Courier"));
  assert.ok(!/total|net|reserve|claimValue|profit/i.test(JSON.stringify(view)));
  assert.match(messages(newEvent({ draft: { financial: { credit: "5", creditCurrency: "CAD" } } })).join(" "), /Credit needs a basis/);
  assert.match(messages(newEvent({ draft: { financial: { credit: "5", creditBasis: "ACTUAL" } } })).join(" "), /Credit needs an ISO currency code/);
  assert.match(messages(newEvent({ draft: { financial: { credit: "5", creditCurrency: "ZZ", creditBasis: "ACTUAL" } } })).join(" "), /valid ISO 4217/);
  assert.match(messages(newEvent({ draft: { financial: { penalty: "-5", penaltyCurrency: "CAD", penaltyBasis: "ACTUAL" } } })).join(" "), /Penalty must be zero or greater/);
  assert.match(messages(newEvent({ draft: { financial: { credit: "5", creditCurrency: "CAD", creditBasis: "PROBABLE" } } })).join(" "), /basis must be Actual or Potential/);
  assert.equal(readCustomerFinancial(newEvent()), undefined, "an unrecorded amount is not zero");
  assert.match(messages(newEvent({ subtype: "COMMENDATION", draft: { financial: { credit: "5", creditCurrency: "CAD", creditBasis: "ACTUAL" }, parties: [recParty()], commendation: commendation() } })).join(" "), /do not apply to a Commendation/);
});

test("51-52. evidence is stored once on the event; every child reference must resolve to it; no Customer Event evidence store exists", () => {
  const event = newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty({ evidenceIds: ["EV-1"] })], behaviors: [behavior({ evidenceIds: ["EV-2"] })], conditions: [condition({ evidenceIds: ["EV-1", "EV-2"] })], statements: [statement({ evidenceIds: ["EV-1"] })], steps: [step(1, { evidenceIds: ["EV-2"] })] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(event.evidenceIds, ["EV-1", "EV-2"]);
  const childEvidence = event.childCollections.flatMap((entry: any) => entry.items.flatMap((item: any) => item.evidenceIds));
  assert.ok(childEvidence.length > 0 && childEvidence.every((id: string) => event.evidenceIds.includes(id)));
  assert.ok(!event.childCollections.some((entry: any) => /EVIDENCE/.test(entry.collectionId)) && !Object.values(CID).some((id: any) => /EVIDENCE/.test(id)));
  const cases: Array<[string, Record<string, unknown>]> = [["party", { parties: [subjParty({ evidenceIds: ["EV-X"] })] }], ["behavior", { parties: [subjParty()], behaviors: [behavior({ evidenceIds: ["EV-X"] })] }], ["condition", { conditions: [condition({ evidenceIds: ["EV-X"] })] }], ["statement", { statements: [statement({ evidenceIds: ["EV-X"] })] }], ["resolution", { resolution: { ...emptyCustomerResolution(), status: "PROVIDED", evidenceIds: ["EV-X"] } }], ["outcome", { outcome: { ...emptyCustomerOutcome(), responseProvided: "YES", evidenceIds: ["EV-X"] } }]];
  for (const [name, draft] of cases) assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft })).join(" "), /not linked to this Customer Event/, name);
  localStorage.clear();
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent({ draft: { claims: [claim({ evidenceIds: ["EV-X"] })] } }))), /not linked to this Customer Event/);
  assert.throws(() => upsertCustomerChild(newEvent(), { collectionId: CID.TIMELINE, facts: { action: "ACKNOWLEDGED" }, evidenceIds: ["EV-X"] }), /not linked to this Customer Event/);
});

test("53-54. a Customer Event relates to any Performance event through the common engine; a security link creates and converts nothing", () => {
  const complaint = newEvent();
  const others = [["COL-1", "Collision"], ["CGO-1", "Cargo Incident"], ["SPL-1", "Spill or Release"], ["NM-1", "Near Miss"], ["RSI-1", "Roadside Inspection"], ["SEC-1", "Security Incident"], ["EQP-1", "Equipment Failure / Critical Defect"], ["FAT-1", "Fatigue Indicator"], ["CE-2", "Customer Event"]].map(([id, eventType]) => ({ id, companyId: COMPANY, eventType, driverMasterId: "DRV-1" }));
  let s = state([complaint, ...others]);
  for (const other of others) s = createPerformanceEventRelationship(s, { fromEventId: "CE-1", toEventId: other.id, type: "RELATED_TO", createdBy: "SM" }).state;
  assert.equal(getEventRelationships(s, "CE-1").length, others.length);
  assert.equal(s.events.length, others.length + 1, "no event was created");
  const security = createPerformanceEventRelationship(state([newEvent({ subtype: "SITE_BEHAVIOR", draft: { parties: [subjParty()], behaviors: [behavior({ primaryCategory: "SECURITY_BEHAVIOR" })] } }), others[5]]), { fromEventId: "CE-1", toEventId: "SEC-1", type: "RELATED_TO", createdBy: "SM", note: "Threat made at the gate" });
  assert.equal(security.state.events.length, 2, "a security behavior does not create a Security Incident");
  assert.equal(security.state.events[0].eventType, "Customer Event", "and does not convert the Customer Event");
  assert.deepEqual(getEventRelationships(security.state, "SEC-1").map((view: any) => view.otherEventId), ["CE-1"]);
  const reclass = createPerformanceEventRelationship(security.state, { fromEventId: "CE-1", toEventId: "SEC-1", type: "RECLASSIFIED_AS", createdBy: "SM" });
  assert.equal(getEventRelationships(reclass.state, "SEC-1").find((view: any) => view.relationship.type === "RECLASSIFIED_AS")?.effectiveType, "ORIGINATED_FROM", "the common reclassification architecture is available");
  assert.throws(() => createPerformanceEventRelationship(state([complaint]), { fromEventId: "CE-1", toEventId: "LOAD-1", type: "RELATED_TO", createdBy: "SM" }), /was not found/, "loads, sites and dispatches are not Performance events");
  assert.ok(!JSON.stringify(complaint).includes("COL-1"));
});

// 55-60 -----------------------------------------------------------------------
test("55. a bare Customer Event of every subtype is NOT_REQUIRED; the subtype alone creates no obligation; the provider is registered", () => {
  for (const subtype of ["COMPLAINT", "COMMENDATION", "SITE_BEHAVIOR"]) { const event = newEvent({ subtype }); const workflow = flow(event); assert.equal(workflow.state, "NOT_REQUIRED", subtype); assert.deepEqual(workflow.reasons, []); assert.deepEqual(customerEventWorkflowProvider.collect(event, state([event])), []); }
  assert.equal(provs().length, getWorkflowProvidersForEventType("Roadside Inspection").length + 1);
  const loaded = newEvent({ facts: [[DP.complaintPrimaryCategory, "SAFETY_COMPLIANCE"], [DP.safetySignificance, "YES"], [DP.regulatorySignificance, "YES"], [DP.operationalInterruption, "YES"]], draft: { claims: [claim()], financial: { claim: "9000", claimCurrency: "CAD", claimBasis: "POTENTIAL" }, outcome: { ...emptyCustomerOutcome(), acceptance: "REJECTED" } } });
  assert.equal(flow(loaded).state, "NOT_REQUIRED", "category, significance, a claim amount and a rejection are facts, not obligations");
  const site = newEvent({ subtype: "SITE_BEHAVIOR", facts: [[DP.securityContacted, "YES"]], draft: { parties: [subjParty()], behaviors: [behavior({ primaryCategory: "SECURITY_BEHAVIOR" })], conditions: [condition({ immediateRisk: "YES" })] } });
  assert.equal(flow(site).state, "NOT_REQUIRED", "security category, immediate risk and a site condition create no site review");
});

test("56. an explicit Complaint assessment requirement raises COMPLAINT_ASSESSMENT_PENDING; it is a Complaint-only fact", () => {
  const event = newEvent({ facts: [[DP.complaintAssessmentRequired, "YES"]] });
  const workflow = flow(event);
  assert.equal(workflow.state, "OPEN");
  assert.deepEqual(workflow.openReasons.map((reason: any) => [reason.code, reason.label]), [["COMPLAINT_ASSESSMENT_PENDING", "Complaint assessment pending"]]);
  assert.equal(flow(newEvent({ facts: [[DP.complaintAssessmentRequired, "NO"]] })).state, "NOT_REQUIRED");
  assert.match(messages(newEvent({ subtype: "COMMENDATION", facts: [[DP.complaintAssessmentRequired, "YES"]] })).join(" "), /only for a Complaint/);
  assert.match(messages(newEvent({ facts: [[DP.complaintAssessmentRequired, "MAYBE"]] })).join(" "), /must be Yes or No/);
  assert.equal(flow(newEvent({ facts: [[DP.complaintPrimaryCategory, "SAFETY_COMPLIANCE"], [DP.safetySignificance, "YES"]] })).state, "NOT_REQUIRED", "the requirement is never inferred from category or significance");
});

test("57. an explicit customer-response requirement raises CUSTOMER_RESPONSE_PENDING; only an explicit response provided resolves it", () => {
  const event = newEvent({ facts: [[DP.customerResponseRequired, "YES"]] });
  assert.deepEqual(flow(event).openReasons.map((reason: any) => reason.code), ["CUSTOMER_RESPONSE_PENDING"]);
  for (const acceptance of ["ACCEPTED", "REJECTED"]) assert.equal(flow(apply(event, CID.OUTCOME, { acceptance }).event).state, "OPEN", `${acceptance} is irrelevant to whether the response was sent`);
  assert.equal(flow(apply(event, CID.OUTCOME, { followUpRequested: "YES" }).event).state, "OPEN", "customer-side facts are not the TES response");
  assert.equal(flow(apply(event, CID.RESOLUTION, { status: "PROVIDED" }).event).state, "OPEN", "a resolution status alone is not an explicit response provided");
  const answered = apply(event, CID.RESOLUTION, { responseProvided: "YES", responseProvidedAt: "2026-10-04T12:00" }).event;
  const workflow = flow(answered);
  assert.equal(workflow.state, "READY_TO_CLOSE");
  assert.ok(workflow.resolvedReasons.some((reason: any) => reason.code === "CUSTOMER_RESPONSE_PENDING" && reason.resolvedAt === "2026-10-04T12:00"));
  assert.match(messages(newEvent({ subtype: "COMMENDATION", facts: [[DP.customerResponseRequired, "YES"]], draft: { parties: [recParty()], commendation: commendation() } })).join(" "), /does not apply to a Commendation/);
  assert.equal(flow(newEvent({ subtype: "SITE_BEHAVIOR", facts: [[DP.customerResponseRequired, "YES"]] })).state, "OPEN");
});

test("58. an explicit site-review requirement raises SITE_REVIEW_REQUIRED; a completed site review resolves it", () => {
  const event = newEvent({ subtype: "SITE_BEHAVIOR", facts: [[DP.siteReviewRequired, "YES"]] });
  const open = flow(event);
  assert.equal(open.state, "IN_REVIEW");
  assert.deepEqual(open.openReasons.map((reason: any) => reason.code), ["SITE_REVIEW_REQUIRED"]);
  const reviewed = apply(event, CID.REVIEWS, { reviewType: "SITE", reviewedBy: "Safety Manager", reviewedAt: "2026-10-05T10:00", note: "Dock layout reviewed" }).event;
  assert.equal(flow(reviewed).state, "READY_TO_CLOSE");
  assert.equal(readCustomerReviews(reviewed)[0].reviewedBy, "Safety Manager");
  assert.throws(() => apply(event, CID.REVIEWS, { reviewType: "RECOGNITION", reviewedBy: "SM", reviewedAt: "2026-10-05T10:00" }), /belongs only to a Commendation/);
  assert.throws(() => apply(event, CID.REVIEWS, { reviewType: "SITE", reviewedAt: "2026-10-05T10:00" }), /needs who reviewed/);
  assert.match(messages(newEvent({ facts: [[DP.siteReviewRequired, "YES"]] })).join(" "), /only for a Site Behavior event/);
  assert.equal(flow(apply(event, CID.REVIEWS, { reviewType: "SITE", reviewedBy: "SM", reviewedAt: "2026-10-05T10:00" }).event, {}).openReasons.length, 0);
});

test("59. an explicit recognition-review requirement raises RECOGNITION_REVIEW_PENDING; not every Commendation needs processing", () => {
  const base = { subtype: "COMMENDATION", draft: { parties: [recParty()], commendation: commendation() } };
  assert.equal(flow(newEvent(base)).state, "NOT_REQUIRED");
  const event = newEvent({ ...base, facts: [[DP.recognitionReviewRequired, "YES"]] });
  assert.deepEqual(flow(event).openReasons.map((reason: any) => reason.code), ["RECOGNITION_REVIEW_PENDING"]);
  const reviewed = apply(event, CID.REVIEWS, { reviewType: "RECOGNITION", reviewedBy: "Ops Manager", reviewedAt: "2026-10-05T10:00" }).event;
  assert.equal(flow(reviewed).state, "READY_TO_CLOSE");
  assert.match(messages(newEvent({ facts: [[DP.recognitionReviewRequired, "YES"]] })).join(" "), /only for a Commendation/);
  assert.deepEqual(state([event]).companyActions, [], "no Company Action is created for recognition");
});

test("60. reasons resolve independently; one resolved obligation leaves the others open; the common providers still apply", () => {
  const event = newEvent({ facts: [[DP.complaintAssessmentRequired, "YES"], [DP.customerResponseRequired, "YES"]] });
  assert.deepEqual(flow(event).openReasons.map((reason: any) => reason.code), ["COMPLAINT_ASSESSMENT_PENDING", "CUSTOMER_RESPONSE_PENDING"], "listed in catalogue priority order");
  const answered = apply(event, CID.RESOLUTION, { responseProvided: "YES" }).event;
  assert.deepEqual(flow(answered).openReasons.map((reason: any) => reason.code), ["COMPLAINT_ASSESSMENT_PENDING"]);
  const opened = withInvestigation(answered);
  const done = substantiate(opened.state, opened.investigation.id, "UNSUBSTANTIATED");
  assert.equal(deriveEventWorkflow(answered, done.state).state, "READY_TO_CLOSE", "Unsubstantiated does not by itself close the event");
  const required = { id: "ACT-1", companyId: COMPANY, driverMasterId: "DRV-1", actionType: "COACHING", title: "Coach on call-ahead", decidedBy: "M", factualBasis: "f", effectiveDate: "2026-10-05", status: "Active", linkedEventIds: ["CE-1"], closureRequirement: "REQUIRED", isArchived: false, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" };
  assert.deepEqual(deriveEventWorkflow(answered, { ...done.state, companyActions: [required] }).openReasons.map((reason: any) => reason.code), ["CORRECTIVE_ACTION_OUTSTANDING"], "a substantiated or unsubstantiated finding never replaces an independent action obligation");
  const history = readCustomerStatusHistory(setCustomerRequirement(newEvent(), { field: "customerResponseRequired", to: "YES", changedBy: "SM" }));
  assert.equal(history.length, 1);
  assert.throws(() => setCustomerRequirement(newEvent(), { field: "siteReviewRequired", to: "MAYBE" as any, changedBy: "SM" }), /Yes or No/);
  assert.throws(() => setCustomerRequirement(newEvent(), { field: "customerResponseRequired", to: "YES", changedBy: " " }), /changedBy/);
});

// 61-64 -----------------------------------------------------------------------
test("61-62. the common investigation engine serves Customer Event; COMMUNICATION is appended and every historical domain is preserved", () => {
  const domains: readonly string[] = CONTRIBUTING_FACTOR_DOMAINS;
  assert.equal(domains.at(-1), "COMMUNICATION");
  assert.deepEqual(domains.slice(0, 17), ["DRIVER_STATE", "DRIVER_BEHAVIOR", "OTHER_ROAD_USER", "ROAD_WEATHER", "VEHICLE_EQUIPMENT", "OPERATIONS", "SITE_CUSTOMER", "LOADING_UNLOADING", "CARGO_SECUREMENT", "SECURITY", "FRAUD_CRIME", "PROCESS_POLICY", "PACKAGING", "MAINTENANCE", "HANDLING", "TRAINING", "EXTERNAL_EVENT"]);
  assert.equal(domains.length, 18);
  assert.ok(!domains.includes("DOCUMENTATION"), "Documentation was deliberately not added");
  const event = newEvent();
  const opened = withInvestigation(event);
  const factors = setInvestigationContributingFactors(opened.state, opened.investigation.id, [{ domain: "COMMUNICATION", factor: "No call-ahead to the receiver", role: "PRIMARY" }, { domain: "SITE_CUSTOMER", factor: "Dock congestion", role: "SECONDARY" }], { by: "SM" });
  assert.deepEqual(getInvestigationsForEvent(factors.state, "CE-1")[0].contributingFactors!.items.map((entry: any) => entry.facts.domain), ["COMMUNICATION", "SITE_CUSTOMER"]);
  assert.throws(() => setInvestigationContributingFactors(factors.state, opened.investigation.id, [{ domain: "LATE_DELIVERY" as never, factor: "x", role: "PRIMARY" }], { by: "SM" }), /Unknown contributing-factor domain/);
  // Site Behavior can use the engine without preventability, responsibility or root cause.
  const site = newEvent({ subtype: "SITE_BEHAVIOR" });
  const siteOpened = openPerformanceInvestigation(state([site]), { eventId: "CE-1", openedBy: "SM" });
  const classified = recordPerformanceDetermination(siteOpened.state, { investigationId: siteOpened.investigation.id, assessment: { subject: "CLASSIFICATION", outcome: "CONFIRMED_AS_REPORTED" }, determinedBy: "SM", determinationDate: "2026-10-05" });
  const concluded = updatePerformanceInvestigation(classified.state, siteOpened.investigation.id, { by: "SM", conclusion: { summary: "Reviewed with the customer." } });
  const completed = completePerformanceInvestigation(concluded.state, siteOpened.investigation.id, { by: "SM" });
  assert.equal(getInvestigationsForEvent(completed.state, "CE-1")[0].status, "COMPLETED", "no preventability, responsibility or root cause was required");
  assert.deepEqual(completed.state.companyDeterminations.map((d: any) => d.subject), ["CLASSIFICATION"]);
});

test("63. closure is deliberate; substantiation, resolution and acceptance never close the event", () => {
  const event = newEvent({ facts: [[DP.complaintAssessmentRequired, "YES"]], draft: { outcome: { ...emptyCustomerOutcome(), acceptance: "ACCEPTED" }, resolution: { ...emptyCustomerResolution(), status: "PROVIDED" } } });
  const opened = withInvestigation(event);
  const done = substantiate(opened.state, opened.investigation.id, "SUBSTANTIATED");
  const ready = deriveEventWorkflow(event, done.state);
  assert.equal(ready.state, "READY_TO_CLOSE");
  assert.notEqual(ready.state, "CLOSED");
  assert.throws(() => closePerformanceEventWorkflow(state([event]), "CE-1", { closedBy: "SM", providers: provs() }), /cannot be closed/);
  assert.throws(() => closePerformanceEventWorkflow(done.state, "CE-1", { closedBy: " ", providers: provs() }), /closedBy/);
  const closed = closePerformanceEventWorkflow(done.state, "CE-1", { closedBy: "SM", note: "Reviewed with the customer", providers: provs(), at: "2026-10-06T00:00:00.000Z" });
  assert.equal(deriveEventWorkflow(closed.state.events[0], closed.state).state, "CLOSED");
  assert.throws(() => closePerformanceEventWorkflow(state([newEvent()]), "CE-1", { closedBy: "SM", providers: provs() }), /cannot be closed/, "a bare Customer Event is never closed by default");
});

test("64. a new obligation after closure reopens through the existing semantics; resolving it requires a new deliberate closure", () => {
  const event = newEvent({ facts: [[DP.complaintAssessmentRequired, "YES"]] });
  const opened = withInvestigation(event);
  const done = substantiate(opened.state, opened.investigation.id, "PARTIALLY_SUBSTANTIATED");
  const closed = closePerformanceEventWorkflow(done.state, "CE-1", { closedBy: "SM", providers: provs(), at: "2026-10-06T00:00:00.000Z" });
  const closedEvent = closed.state.events[0];
  const reopened = setCustomerRequirement(closedEvent, { field: "customerResponseRequired", to: "YES", changedBy: "SM", at: "2026-10-07T00:00:00.000Z" });
  const workflow = deriveEventWorkflow(reopened, { ...closed.state, events: [reopened] });
  assert.equal(workflow.state, "OPEN");
  assert.equal(workflow.closureSuperseded, true);
  assert.equal(workflow.closure?.closedBy, "SM", "the earlier closure is kept");
  assert.deepEqual(workflow.obligationsSinceClosure.map((reason: any) => reason.code), ["CUSTOMER_RESPONSE_PENDING"]);
  const answered = apply(reopened, CID.RESOLUTION, { responseProvided: "YES", responseProvidedAt: "2026-10-08T09:00" }).event;
  const ready = deriveEventWorkflow(answered, { ...closed.state, events: [answered] });
  assert.equal(ready.state, "READY_TO_CLOSE", "resolved, but a NEW deliberate closure is required");
  const reclosed = closePerformanceEventWorkflow({ ...closed.state, events: [answered] }, "CE-1", { closedBy: "SM2", providers: provs(), at: "2026-10-09T00:00:00.000Z" });
  assert.equal(reclosed.state.events[0].workflowClosures.length, 2);
  assert.equal(deriveEventWorkflow(reclosed.state.events[0], reclosed.state).state, "CLOSED");
});

// 65-67 + integrity -------------------------------------------------------------
test("65. counters: the canonical Customer Event counts through its subtype, legacy records keep counting through their own type, and nothing is double-counted", () => {
  assert.equal(customerEventCounterBucket(newEvent({ subtype: "COMPLAINT" })), "complaint");
  assert.equal(customerEventCounterBucket(newEvent({ subtype: "COMMENDATION" })), "commendation");
  assert.equal(customerEventCounterBucket(newEvent({ subtype: "SITE_BEHAVIOR" })), "operational");
  assert.equal(customerEventCounterBucket(legacyComplaint()), "complaint");
  assert.equal(customerEventCounterBucket(legacyCommendation()), "commendation");
  assert.equal(customerEventCounterBucket(legacySite()), "operational");
  assert.equal(customerEventCounterBucket(newEvent({ subtype: "" })), undefined);
  const events = [newEvent(), newEvent({ subtype: "COMMENDATION" }), newEvent({ subtype: "SITE_BEHAVIOR" }), legacyComplaint(), legacyCommendation(), legacySite()];
  const count = (bucket: string) => events.filter((event: any) => customerEventCounterBucket(event) === bucket).length;
  assert.deepEqual([count("complaint"), count("commendation"), count("operational")], [2, 2, 2]);
  // The Tab's legacy filters match only their own stored types, so a canonical event is never counted by both paths.
  const legacyOnly = (type: string) => events.filter((event: any) => event.eventType === type).length;
  assert.deepEqual([legacyOnly("Customer Complaint"), legacyOnly("Customer Commendation"), legacyOnly("Customer-Site Behavior")], [1, 1, 1]);
  assert.equal(events.filter((event: any) => event.eventType === "Customer Event").length, 3);
});

test("66-67. no universal severity, score, sentiment or BI metric is stored on a Customer Event", () => {
  const event = newEvent({ facts: [[DP.complaintPrimaryCategory, "DRIVER_CONDUCT"], [DP.safetySignificance, "YES"]], draft: { claims: [claim()], financial: { claim: "1000", claimCurrency: "CAD", claimBasis: "POTENTIAL" } } });
  const everything = JSON.stringify([event.structuredEventFacts, event.childCollections]);
  assert.ok(!/score|sentiment|health|riskLevel|severity|priority|latencyMinutes|weight/i.test(everything), "nothing derived is persisted");
  const definition = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Customer Event"];
  assert.ok(!definition.fields.some((field: any) => /score|severity|sentiment|health|sla|due/i.test(field.key)), "no severity, score or SLA field in the schema");
  assert.equal(payloadFrom(event).severity, "Not Applicable");
  assert.ok(!JSON.stringify(buildCustomerEventSummary(event)).match(/score|severity/i));
  assert.ok(!Object.keys(DP).some((key) => /sla|due|deadline|score/i.test(key)), "SLA is deferred");
  assert.equal(describeCustomerEvent(newEvent({ subtype: "COMMENDATION", draft: { parties: [recParty()], commendation: commendation() } })).complaint, undefined, "a Commendation carries no complaint impact");
});

test("68. subtype integrity: subtype-specific children belong only to the matching subtype and the subtype can never be changed in place", () => {
  assert.match(messages(newEvent({ subtype: "COMMENDATION", draft: { claims: [claim()], parties: [recParty()] } })).join(" "), /belong only to a Complaint/);
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { claims: [claim()] } })).join(" "), /belong only to a Complaint/);
  assert.match(messages(newEvent({ subtype: "COMMENDATION", facts: [[DP.complaintPrimaryCategory, "COMMUNICATION"]], draft: { parties: [recParty()] } })).join(" "), /belong only to a Complaint/);
  assert.match(messages(newEvent({ subtype: "COMPLAINT", draft: { commendation: commendation(), parties: [recParty()] } })).join(" "), /belongs only to a Commendation/);
  assert.match(messages(newEvent({ subtype: "SITE_BEHAVIOR", draft: { commendation: commendation(), parties: [recParty()] } })).join(" "), /belongs only to a Commendation/);
  assert.match(messages(newEvent({ subtype: "COMPLAINT", draft: { behaviors: [behavior()], parties: [subjParty()] } })).join(" "), /belong only to a Site Behavior/);
  assert.match(messages(newEvent({ subtype: "COMMENDATION", draft: { conditions: [condition()], parties: [recParty()], commendation: commendation() } })).join(" "), /belong only to a Site Behavior/);
  const event = newEvent();
  assert.throws(() => upsertCustomerChild(event, { collectionId: "DRV.PERF.CUSTOMER_EVENT.CUSTOMER_EVENT_TYPE", facts: { value: "COMMENDATION" } }), /Unknown Customer Event record type/);
  assert.throws(() => upsertCustomerChild(event, { collectionId: CID.STATUS_HISTORY, facts: { x: "y" } }), /Unknown Customer Event record type/);
  assert.throws(() => upsertCustomerChild(event, { collectionId: CID.COMMENDATION, facts: { recognizedPartyId: "P1" } }), /belongs only to a Commendation|recognized party/);
  assert.throws(() => upsertCustomerChild(event, { collectionId: CID.BEHAVIORS, facts: { subjectPartyId: "P1", description: "x" } }), /belong only to a Site Behavior/);
  const changed = setCustomerRequirement(event, { field: "customerResponseRequired", to: "YES", changedBy: "SM" });
  assert.equal(customerEventSubtype(changed), "COMPLAINT", "no writer changes the subtype");
  const upserted = apply(event, CID.TIMELINE, { action: "ACKNOWLEDGED" }).event;
  assert.equal(customerEventSubtype(upserted), "COMPLAINT");
  assert.equal(validateNewCustomerEventDetailed(newEvent({ subtype: "" })).find((entry: any) => /Customer Event type/.test(entry.message))?.step, "OCCURRENCE");
  const retyped = { ...event, structuredEventFacts: event.structuredEventFacts.map((entry: any) => (entry.dataPointId === DP.customerEventType ? { ...entry, value: "SITE_BEHAVIOR" } : entry)) };
  assert.deepEqual(messages(retyped), [], "a hand-edited subtype with no subtype data stays internally valid, which is why no UI or writer exposes it");
});

test("69. persistence: downstream enrichment survives a reload and invalid payloads are refused by the data layer, not only by the wizard", () => {
  localStorage.clear();
  const saved = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent({ facts: [[DP.complaintAssessmentRequired, "YES"]], draft: { claims: [claim()], parties: [party()], statements: [statement()] } })));
  assert.equal(flow(saved).state, "OPEN");
  const store = dd.loadCompanyDriverStore(COMPANY);
  const enriched = apply(apply(saved, CID.RESOLUTION, { status: "IN_PROGRESS", summary: "Reviewing GPS" }).event, CID.OUTCOME, { acceptance: "PENDING" }).event;
  localStorage.setItem(`tes_company_drivers_${COMPANY}`, JSON.stringify({ ...store, events: store.events.map((entry: any) => (entry.id === saved.id ? enriched : entry)) }));
  const loaded = dd.loadCompanyDriverStore(COMPANY).events.find((entry: any) => entry.id === saved.id);
  assert.equal(readCustomerResolution(loaded)?.summary, "Reviewing GPS");
  assert.equal(readCustomerOutcome(loaded)?.acceptance, "PENDING");
  assert.equal(flow(loaded).state, "OPEN");
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent({ draft: { steps: [step(1), { ...step(2), ordinal: "1" }] } }))), /ordinals must be unique/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent({ draft: { claims: [claim()] }, subtype: "COMMENDATION" }))), /belong only to a Complaint/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent({ extra: { provenance: { sourceType: "SOURCE_FACT", source: "Fax" } } }))), /Source is required/);
});

test("70. the registry data point ids match the pure module and every Customer Event field has a stable id", () => {
  const definition = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Customer Event"];
  const ids = new Set(definition.fields.map((field: any) => field.dataPointId));
  for (const id of Object.values(DP)) assert.ok(ids.has(id as string), `registry has ${id}`);
  assert.equal(ids.size, definition.fields.length, "data point ids are unique");
  assert.ok(definition.fields.find((field: any) => field.key === "customerEventType").required, "subtype is required");
  assert.equal(new Set(Object.values(CID)).size, Object.values(CID).length);
  assert.equal(describeCustomerEvent(newEvent()).owningDriver.recorded, false);
  assert.match(buildCustomerEventSummary(newEvent({ facts: [[DP.complaintPrimaryCategory, "COMMUNICATION"], [DP.customerName, "ACME"]] })).subtypeLine!, /Complaint - Communication/);
});

// additional focused coverage -----------------------------------------------------
test("71. initial recording principle: a bare Complaint, Commendation or Site Behavior saves with only the subtype and the occurrence basics", () => {
  for (const subtype of ["COMPLAINT", "COMMENDATION", "SITE_BEHAVIOR"]) assert.deepEqual(messages(newEvent({ subtype })), [], subtype);
  assert.deepEqual(messages(newEvent({ draft: { precision: "UNKNOWN" }, extra: { eventTime: "" } })), [], "even an unknown occurrence time is recordable");
  assert.equal(describeCustomerEvent(newEvent()).complaint?.claims.length, 0, "no allegation is required to record a complaint");
});

test("72. a Commendation event leaves a Complaint's substantiation, workflow and counters untouched", () => {
  const complaint = setCustomerRequirement(newEvent(), { field: "complaintAssessmentRequired", to: "YES", changedBy: "SM" });
  const praise = { ...newEvent({ subtype: "COMMENDATION", draft: { parties: [recParty()], commendation: commendation() } }), id: "CE-9" };
  const both = state([complaint, praise]);
  assert.deepEqual(deriveEventWorkflow(complaint, both).openReasons.map((reason: any) => reason.code), ["COMPLAINT_ASSESSMENT_PENDING"], "a commendation does not resolve or cancel the complaint");
  assert.equal(deriveEventWorkflow(praise, both).state, "NOT_REQUIRED");
  assert.deepEqual(both.companyDeterminations, []);
});

test("73. the data layer rejects canonical links and legacy projections on a Customer Event", () => {
  localStorage.clear();
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent({ extra: { canonicalLinks: [{ entityType: "Vehicle", recordId: "V1", relationshipKey: "vehicle", source: "CANONICAL_STORE" }] } }))), /no canonical links/);
  const saved = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newEvent()));
  assert.equal(saved.complaintDetails, undefined, "the old complaintDetails projection is not written");
  assert.equal(saved.commendationDetails, undefined, "the old commendationDetails projection is not written");
});

test("74. the owning driver is required and single: a Customer Event has exactly one owning driver", () => {
  assert.match(messages(newEvent({ extra: { driverMasterId: "" } })).join(" "), /owning Driver is required/);
  const event = newEvent({ draft: { parties: [party({ itemId: "D", personType: "CARRIER_DRIVER", capacities: ["INVOLVED"], isOwningDriver: true }), party({ itemId: "D2", personType: "CARRIER_DRIVER", capacities: ["INVOLVED"], name: "Another TES driver" })] } });
  assert.deepEqual(messages(event), [], "another TES driver can appear as a non-owning party");
  assert.deepEqual(readCustomerParties(event).map((entry: any) => Boolean(entry.linkedDriverMasterId)), [true, false], "no fake secondary ownership");
});

test("75. a Site Behavior event needs nothing subtype-specific to be recorded, and neutral wording is used for an unclassified observation", () => {
  const event = newEvent({ subtype: "SITE_BEHAVIOR" });
  const view = describeCustomerEvent(event);
  assert.deepEqual([view.behaviors, view.conditions], [[], []]);
  assert.equal(view.complaint, undefined);
  assert.equal(view.commendation, undefined);
});

test("76. status history is append-only for explicit requirements and keeps the prior value", () => {
  const first = setCustomerRequirement(newEvent(), { field: "customerResponseRequired", to: "YES", changedBy: "SM", at: "2026-10-04T09:00:00.000Z" });
  const second = setCustomerRequirement(first, { field: "customerResponseRequired", to: "NO", changedBy: "SM2", at: "2026-10-05T09:00:00.000Z", note: "Customer withdrew the request" });
  assert.deepEqual(readCustomerStatusHistory(second).map((entry: any) => [entry.from, entry.to]), [["", "YES"], ["YES", "NO"]]);
  assert.equal(flow(second).state, "NOT_REQUIRED", "withdrawing an explicit requirement removes the obligation");
  assert.equal(describeCustomerEvent(second).statusHistory.length, 2);
});

test("77. response steps cannot precede the occurrence and the next ordinal is assigned automatically", () => {
  const event = newEvent();
  const one = upsertCustomerChild(event, { collectionId: CID.TIMELINE, facts: { action: "RECEIVED_RECORDED", timestamp: "2026-10-03T16:00" } });
  const two = upsertCustomerChild(one.event, { collectionId: CID.TIMELINE, facts: { action: "ACKNOWLEDGED", timestamp: "2026-10-03T16:30" } });
  assert.deepEqual(readCustomerTimeline(two.event).map((entry: any) => entry.ordinal), [1, 2]);
  assert.throws(() => upsertCustomerChild(two.event, { collectionId: CID.TIMELINE, facts: { action: "ASSIGNED", timestamp: "2026-10-01T08:00" } }), /cannot be before the occurrence/);
  assert.throws(() => upsertCustomerChild(two.event, { collectionId: CID.CLAIMS, itemId: "NOPE", facts: { claimType: "NO_SHOW" } }), /not found/);
});

test("78. the legacy Customer Compliment alias still resolves to the legacy Commendation and no new type is created for it", () => {
  assert.equal(schema.DRIVER_PERFORMANCE_LEGACY_CATEGORY_ALIASES["Customer Compliment"], "Customer Commendation");
  assert.equal(schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Customer Compliment"].value, "Customer Compliment");
  assert.ok(!schema.RECORDABLE_PERFORMANCE_CATEGORIES.includes("Customer Compliment"));
  assert.equal(describeLegacyCustomerEvent(legacyCommendation()).kind, "COMMENDATION");
});
