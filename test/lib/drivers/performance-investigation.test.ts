import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelPerformanceInvestigation,
  completePerformanceInvestigation,
  getActiveDetermination,
  getActiveDeterminations,
  getDeterminationsForInvestigation,
  getInvestigationsForEvent,
  isDeterminationActive,
  openPerformanceInvestigation,
  recordPerformanceDetermination,
  reopenPerformanceInvestigation,
  resolvePreventability,
  setInvestigationContributingFactors,
  transitionPerformanceInvestigation,
  updatePerformanceInvestigation,
  withdrawPerformanceDetermination,
  validateDeterminationAssessment,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-investigation.ts";

type State = Parameters<typeof openPerformanceInvestigation>[0];

const baseState = (): State => ({
  events: [
    { id: "EVT-NM", companyId: "C1", eventType: "Near Miss", driverMasterId: "DRV-1", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "EVT-COL", companyId: "C1", eventType: "Collision", driverMasterId: "DRV-1", createdAt: "2026-01-01T00:00:00.000Z" },
  ],
} as unknown as State);

const T = (n: number) => `2026-02-01T00:00:${String(n).padStart(2, "0")}.000Z`;
const classify = (state: State, investigationId: string, outcome = "CONFIRMED_AS_REPORTED", at = T(5)) =>
  recordPerformanceDetermination(state, { investigationId, assessment: { subject: "CLASSIFICATION", outcome } as never, determinedBy: "Reviewer", determinationDate: "2026-02-01", at });

function opened() {
  const { state, investigation } = openPerformanceInvestigation(baseState(), { eventId: "EVT-NM", openedBy: "Safety Mgr", openingReason: "Potential severity serious", at: T(1) });
  return { state, id: investigation.id };
}

// ----------------------------------------------------------------- investigation lifecycle

test("opening an investigation records the authoritative eventId, derives companyId, and never stores NOT_STARTED", () => {
  const { state, investigation } = openPerformanceInvestigation(baseState(), { eventId: "EVT-NM", openedBy: "Safety Mgr", evidenceIds: ["EVD-1", "EVD-1"], at: T(1) });
  assert.equal(investigation.status, "OPEN");
  assert.equal(investigation.companyId, "C1");
  assert.equal(investigation.eventId, "EVT-NM");
  assert.equal(investigation.schemaVersion, 1);
  assert.deepEqual(investigation.evidenceIds, ["EVD-1"]);
  assert.deepEqual(investigation.statusHistory.map((entry: { status: string }) => entry.status), ["OPEN"]);
  assert.equal(getInvestigationsForEvent(state, "EVT-NM").length, 1, "reverse direction is a selector");
  assert.equal(getInvestigationsForEvent(state, "EVT-COL").length, 0, "absence of a record means no investigation");
  assert.ok(!JSON.stringify(investigation).includes("NOT_STARTED"));
});

test("opening rejects an unknown event, a blank opener, and a second active investigation for the same event", () => {
  assert.throws(() => openPerformanceInvestigation(baseState(), { eventId: "NOPE", openedBy: "A" }), { code: "EVENT_NOT_FOUND" });
  assert.throws(() => openPerformanceInvestigation(baseState(), { eventId: "EVT-NM", openedBy: "  " }), { code: "REQUIRED_FIELD" });
  const { state } = opened();
  assert.throws(() => openPerformanceInvestigation(state, { eventId: "EVT-NM", openedBy: "A" }), { code: "INVESTIGATION_ALREADY_ACTIVE" });
});

test("writers never mutate their input state", () => {
  const input = baseState();
  const frozen = JSON.stringify(input);
  openPerformanceInvestigation(input, { eventId: "EVT-NM", openedBy: "A", at: T(1) });
  assert.equal(JSON.stringify(input), frozen);
});

test("OPEN <-> AWAITING_INFORMATION appends history; invalid transitions are rejected", () => {
  const { state, id } = opened();
  const waiting = transitionPerformanceInvestigation(state, id, { to: "AWAITING_INFORMATION", by: "Inv", reason: "Need dashcam", at: T(2) });
  assert.equal(waiting.investigation.status, "AWAITING_INFORMATION");
  const back = transitionPerformanceInvestigation(waiting.state, id, { to: "OPEN", by: "Inv", at: T(3) });
  assert.deepEqual(back.investigation.statusHistory.map((entry: { status: string }) => entry.status), ["OPEN", "AWAITING_INFORMATION", "OPEN"]);
  assert.equal(back.investigation.statusHistory[1].reason, "Need dashcam");
  assert.throws(() => transitionPerformanceInvestigation(back.state, id, { to: "OPEN", by: "Inv" }), { code: "INVALID_TRANSITION" });
});

test("completion is rejected without a conclusion summary, then without an active Classification, and needs nothing else", () => {
  const { state, id } = opened();
  assert.throws(() => completePerformanceInvestigation(state, id, { by: "Inv" }), { code: "COMPLETION_REQUIRES_CONCLUSION" });
  const withSummary = updatePerformanceInvestigation(state, id, { by: "Inv", conclusion: { summary: "Close call at intersection." } }).state;
  assert.throws(() => completePerformanceInvestigation(withSummary, id, { by: "Inv" }), { code: "COMPLETION_REQUIRES_CLASSIFICATION" });
  const classified = classify(withSummary, id).state;
  // No preventability / responsibility / root cause recorded: completion must still succeed.
  const done = completePerformanceInvestigation(classified, id, { by: "Inv", at: T(9) });
  assert.equal(done.investigation.status, "COMPLETED");
  assert.equal(done.investigation.completedBy, "Inv");
  assert.equal(done.investigation.completedAt, T(9));
});

test("cancellation needs a reason; cancelled and completed investigations can be reopened without losing history", () => {
  const { state, id } = opened();
  assert.throws(() => cancelPerformanceInvestigation(state, id, { by: "Inv", reason: " " }), { code: "REQUIRED_FIELD" });
  const cancelled = cancelPerformanceInvestigation(state, id, { by: "Inv", reason: "Duplicate report", at: T(2) });
  assert.equal(cancelled.investigation.cancelledReason, "Duplicate report");
  const reopened = reopenPerformanceInvestigation(cancelled.state, id, { by: "Inv", at: T(3) });
  assert.equal(reopened.investigation.status, "OPEN");
  assert.equal(reopened.investigation.cancelledReason, undefined, "current-state field cleared");
  assert.deepEqual(reopened.investigation.statusHistory.map((entry: { status: string }) => entry.status), ["OPEN", "CANCELLED", "OPEN"]);
  assert.equal(reopened.investigation.statusHistory[1].reason, "Duplicate report", "earlier cancellation preserved in history");

  let s = updatePerformanceInvestigation(reopened.state, id, { by: "Inv", conclusion: { summary: "done" } }).state;
  s = classify(s, id).state;
  const completed = completePerformanceInvestigation(s, id, { by: "Inv", at: T(6) });
  const again = reopenPerformanceInvestigation(completed.state, id, { by: "Inv", at: T(7) });
  assert.equal(again.investigation.completedAt, undefined);
  assert.deepEqual(again.investigation.statusHistory.map((entry: { status: string }) => entry.status), ["OPEN", "CANCELLED", "OPEN", "COMPLETED", "OPEN"]);
});

test("a completed or cancelled investigation is not editable until reopened", () => {
  const { state, id } = opened();
  const cancelled = cancelPerformanceInvestigation(state, id, { by: "Inv", reason: "r" }).state;
  assert.throws(() => updatePerformanceInvestigation(cancelled, id, { by: "Inv", assignedInvestigator: "X" }), { code: "INVESTIGATION_NOT_EDITABLE" });
  assert.throws(() => classify(cancelled, id), { code: "INVESTIGATION_NOT_EDITABLE" });
});

test("updating only ADDS evidence ids and keeps other fields", () => {
  const { state, id } = opened();
  const updated = updatePerformanceInvestigation(state, id, { by: "Inv", assignedInvestigator: "J. Reyes", addEvidenceIds: ["E1"], additionalInvestigationRequired: { required: true, reason: "Dashcam unclear" } });
  const again = updatePerformanceInvestigation(updated.state, id, { by: "Inv", addEvidenceIds: ["E2", "E1"] });
  assert.deepEqual(again.investigation.evidenceIds, ["E1", "E2"]);
  assert.equal(again.investigation.assignedInvestigator, "J. Reyes");
  assert.equal(again.investigation.additionalInvestigationRequired?.required, true);
});

// ----------------------------------------------------------------- determinations

test("several determination subjects coexist on one investigation; each is selected independently", () => {
  const { state, id } = opened();
  let s = classify(state, id).state;
  s = recordPerformanceDetermination(s, { investigationId: id, assessment: { subject: "PREVENTABILITY", value: "PARTIALLY_PREVENTABLE" } as never, determinedBy: "R", determinationDate: "2026-02-01", at: T(6) }).state;
  s = recordPerformanceDetermination(s, { investigationId: id, assessment: { subject: "RESPONSIBILITY", parties: [{ party: "CARRIER_DRIVER", role: "PRIMARY" }], catalogueVersion: 1 } as never, determinedBy: "R", determinationDate: "2026-02-01", at: T(7) }).state;
  s = recordPerformanceDetermination(s, { investigationId: id, assessment: { subject: "ROOT_CAUSE", category: "Process", finding: "No spotter policy", status: "PROBABLE", role: "PRIMARY" } as never, determinedBy: "R", determinationDate: "2026-02-01", at: T(8) }).state;
  s = recordPerformanceDetermination(s, { investigationId: id, assessment: { subject: "GENERAL_FINDING", summary: "note" } as never, determinedBy: "R", determinationDate: "2026-02-01", at: T(9) }).state;
  assert.equal(getDeterminationsForInvestigation(s, id).length, 5);
  assert.equal((getActiveDetermination(s, id, "PREVENTABILITY")?.assessment as { value: string }).value, "PARTIALLY_PREVENTABLE");
  assert.equal(getActiveDetermination(s, id, "CLASSIFICATION")?.subject, "CLASSIFICATION");
  assert.equal(getActiveDetermination(s, id, "ROOT_CAUSE", "PRIMARY")?.subject, "ROOT_CAUSE");
});

test("amending a unique-subject determination supersedes the old one and preserves history", () => {
  const { state, id } = opened();
  const first = recordPerformanceDetermination(state, { investigationId: id, assessment: { subject: "PREVENTABILITY", value: "UNDETERMINED" } as never, determinedBy: "R", determinationDate: "2026-02-01", at: T(2) });
  const second = recordPerformanceDetermination(first.state, { investigationId: id, assessment: { subject: "PREVENTABILITY", value: "PREVENTABLE", opportunityNotes: "Following distance" } as never, determinedBy: "R", determinationDate: "2026-02-02", at: T(3) });
  assert.equal(second.superseded?.id, first.determination.id);
  assert.equal(second.determination.supersedesDeterminationId, first.determination.id);
  const all = getDeterminationsForInvestigation(second.state, id, { includeInactive: true });
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((item: { status?: string }) => item.status), ["SUPERSEDED", "ACTIVE"]);
  assert.equal(getActiveDeterminations(second.state, id, "PREVENTABILITY").length, 1, "never two active for a unique subject");
  assert.equal((all[0].assessment as { value: string }).value, "UNDETERMINED", "old row content untouched");
});

test("explicit supersede targets must be active, same-subject, same-investigation", () => {
  const { state, id } = opened();
  const cls = classify(state, id);
  assert.throws(() => recordPerformanceDetermination(cls.state, { investigationId: id, assessment: { subject: "PREVENTABILITY", value: "PREVENTABLE" } as never, determinedBy: "R", determinationDate: "2026-02-01", supersedesDeterminationId: cls.determination.id }), { code: "INVALID_SUPERSEDE_TARGET" });
  assert.throws(() => recordPerformanceDetermination(cls.state, { investigationId: id, assessment: { subject: "PREVENTABILITY", value: "PREVENTABLE" } as never, determinedBy: "R", determinationDate: "2026-02-01", supersedesDeterminationId: "DET-nope" }), { code: "INVALID_SUPERSEDE_TARGET" });
});

test("legacy determinations (no status, no subject) stay readable, active by default, and are never altered by the writers", () => {
  const legacy = { id: "DET-OLD", companyId: "C1", driverMasterId: "DRV-1", relatedRecordType: "Collision", relatedRecordId: "EVT-COL", determinationType: "COLLISION_PREVENTABILITY", determinationValue: "PREVENTABLE", determinedBy: "A", determinationDate: "2025-01-01", createdAt: "2025-01-01T00:00:00.000Z" };
  const start = { ...baseState(), companyDeterminations: [legacy] } as unknown as State;
  assert.equal(isDeterminationActive(legacy as never), true);
  const { state, id } = (() => { const r = openPerformanceInvestigation(start, { eventId: "EVT-COL", openedBy: "A", at: T(1) }); return { state: r.state, id: r.investigation.id }; })();
  const after = recordPerformanceDetermination(state, { investigationId: id, assessment: { subject: "PREVENTABILITY", value: "NOT_PREVENTABLE" } as never, determinedBy: "R", determinationDate: "2026-02-01", at: T(2) }).state;
  assert.deepEqual(after.companyDeterminations?.[0], legacy, "legacy row byte-for-byte unchanged");
  assert.equal(getDeterminationsForInvestigation(after, id).length, 1, "legacy rows have no investigationId so they never appear as investigation determinations");
});

test("new determinations hang off the investigation, not the event id, and use subject rather than new enum values", () => {
  const { state, id } = opened();
  const { determination } = classify(state, id);
  assert.equal(determination.relatedRecordType, "Investigation");
  assert.equal(determination.relatedRecordId, id);
  assert.equal(determination.investigationId, id);
  assert.equal(determination.assessmentSchemaVersion, 1);
  assert.ok(["INVESTIGATION_FINDING", "ROOT_CAUSE_ANALYSIS"].includes(String(determination.determinationType)), "only pre-existing enum values are used");
});

test("withdrawing preserves the row and removes it from the active set", () => {
  const { state, id } = opened();
  const { state: s1, determination } = classify(state, id);
  const withdrawn = withdrawPerformanceDetermination(s1, determination.id, { by: "R", reason: "Entered in error", at: T(8) });
  assert.equal(withdrawn.determination.status, "WITHDRAWN");
  assert.equal(getActiveDeterminations(withdrawn.state, id, "CLASSIFICATION").length, 0);
  assert.equal(getDeterminationsForInvestigation(withdrawn.state, id, { includeInactive: true }).length, 1);
  assert.throws(() => withdrawPerformanceDetermination(withdrawn.state, determination.id, { by: "R", reason: "again" }), { code: "DETERMINATION_NOT_ACTIVE" });
  // Completion needs an ACTIVE classification: the withdrawn one does not count.
  const withSummary = updatePerformanceInvestigation(withdrawn.state, id, { by: "Inv", conclusion: { summary: "s" } }).state;
  assert.throws(() => completePerformanceInvestigation(withSummary, id, { by: "Inv" }), { code: "COMPLETION_REQUIRES_CLASSIFICATION" });
});

// ----------------------------------------------------------------- preventability

test("all four preventability values record and resolve from the investigation", () => {
  for (const value of ["PREVENTABLE", "NOT_PREVENTABLE", "PARTIALLY_PREVENTABLE", "UNDETERMINED"]) {
    const { state, id } = opened();
    const s = recordPerformanceDetermination(state, { investigationId: id, assessment: { subject: "PREVENTABILITY", value } as never, determinedBy: "R", determinationDate: "2026-02-01" }).state;
    const resolved = resolvePreventability(s, s.events[0]);
    assert.equal(resolved?.value, value);
    assert.equal(resolved?.source, "INVESTIGATION");
    assert.equal(resolved?.investigationId, id);
  }
  assert.ok(validateDeterminationAssessment({ subject: "PREVENTABILITY", value: "MAYBE" } as never).length);
});

test("preventability resolution order: investigation > legacy determination > deprecated Collision field, with source reported", () => {
  const col = { id: "EVT-COL", companyId: "C1", eventType: "Collision", driverMasterId: "DRV-1", collisionDetails: { preventability: "Non-Preventable" } };
  const legacyCanonical = { id: "L1", companyId: "C1", driverMasterId: "DRV-1", relatedRecordType: "Collision", relatedRecordId: "EVT-COL", determinationType: "COLLISION_PREVENTABILITY", determinationValue: "PREVENTABLE", determinedBy: "A", determinationDate: "2025-01-01", createdAt: "2025-01-01T00:00:00.000Z" };
  // The shape loaded stores actually have: load-time migration moves canonical enums into legacy* strings.
  const legacyMigrated = { ...legacyCanonical, id: "L2", determinationType: undefined, determinationValue: undefined, legacyDeterminationType: "COLLISION_PREVENTABILITY", legacyDeterminationValue: "NON_PREVENTABLE", createdAt: "2025-02-01T00:00:00.000Z" };

  const none = { events: [{ ...col, collisionDetails: undefined }] } as unknown as State;
  assert.equal(resolvePreventability(none, none.events[0]), null);

  const deprecatedOnly = { events: [col] } as unknown as State;
  assert.deepEqual(resolvePreventability(deprecatedOnly, col as never), { value: "NOT_PREVENTABLE", source: "DEPRECATED_COLLISION_FIELD" });

  const legacyA = { events: [col], companyDeterminations: [legacyCanonical] } as unknown as State;
  assert.deepEqual(resolvePreventability(legacyA, col as never), { value: "PREVENTABLE", source: "LEGACY_DETERMINATION", determinationId: "L1" }, "legacy beats the deprecated field");

  const legacyB = { events: [col], companyDeterminations: [legacyCanonical, legacyMigrated] } as unknown as State;
  const viaMigrated = resolvePreventability(legacyB, col as never);
  assert.equal(viaMigrated?.value, "NOT_PREVENTABLE", "migrated legacy shape (legacy* strings) resolves, latest legacy row wins");
  assert.equal(viaMigrated?.source, "LEGACY_DETERMINATION");

  const opened1 = openPerformanceInvestigation(legacyB, { eventId: "EVT-COL", openedBy: "A", at: T(1) });
  const withNew = recordPerformanceDetermination(opened1.state, { investigationId: opened1.investigation.id, assessment: { subject: "PREVENTABILITY", value: "PARTIALLY_PREVENTABLE" } as never, determinedBy: "R", determinationDate: "2026-02-01", at: T(2) });
  const top = resolvePreventability(withNew.state, col as never);
  assert.equal(top?.source, "INVESTIGATION");
  assert.equal(top?.value, "PARTIALLY_PREVENTABLE");
  // Once the new one is superseded/withdrawn the resolver falls back to legacy again.
  const withdrawn = withdrawPerformanceDetermination(withNew.state, withNew.determination.id, { by: "R", reason: "r" });
  assert.equal(resolvePreventability(withdrawn.state, col as never)?.source, "LEGACY_DETERMINATION");
});

test("an unmappable legacy value resolves to UNDETERMINED rather than inventing a conclusion", () => {
  const col = { id: "EVT-COL", companyId: "C1", eventType: "Collision" };
  const odd = { id: "L9", companyId: "C1", driverMasterId: "", relatedRecordType: "Collision", relatedRecordId: "EVT-COL", legacyDeterminationType: "COLLISION_PREVENTABILITY", legacyDeterminationValue: "???", determinedBy: "A", determinationDate: "2025-01-01", createdAt: "x" };
  const state = { events: [col], companyDeterminations: [odd] } as unknown as State;
  assert.equal(resolvePreventability(state, col as never)?.value, "UNDETERMINED");
});

// ----------------------------------------------------------------- responsibility

const respond = (state: State, id: string, assessment: object) => recordPerformanceDetermination(state, { investigationId: id, assessment: { subject: "RESPONSIBILITY", catalogueVersion: 1, ...assessment } as never, determinedBy: "R", determinationDate: "2026-02-01" });

test("responsibility: one PRIMARY plus any number of CONTRIBUTING parties", () => {
  const { state, id } = opened();
  const { determination } = respond(state, id, { parties: [{ party: "OTHER_ROAD_USER", role: "PRIMARY" }, { party: "ENVIRONMENT_SITE", role: "CONTRIBUTING" }, { party: "OPERATIONAL_PROCESS", role: "CONTRIBUTING" }] });
  assert.equal(determination.status, "ACTIVE");
});

test("responsibility rejects multiple PRIMARY, duplicate/unknown parties, empty input, and standalone+parties together", () => {
  const { state, id } = opened();
  assert.throws(() => respond(state, id, { parties: [{ party: "CARRIER_DRIVER", role: "PRIMARY" }, { party: "THIRD_PARTY", role: "PRIMARY" }] }), { code: "INVALID_ASSESSMENT" });
  assert.throws(() => respond(state, id, { parties: [{ party: "THIRD_PARTY", role: "CONTRIBUTING" }, { party: "THIRD_PARTY", role: "CONTRIBUTING" }] }), { code: "INVALID_ASSESSMENT" });
  assert.throws(() => respond(state, id, { parties: [{ party: "MARTIANS", role: "PRIMARY" }] }), { code: "INVALID_ASSESSMENT" });
  assert.throws(() => respond(state, id, {}), { code: "INVALID_ASSESSMENT" });
  assert.throws(() => respond(state, id, { standalone: "UNDETERMINED", parties: [{ party: "CARRIER_DRIVER", role: "PRIMARY" }] }), { code: "INVALID_ASSESSMENT" });
});

test("NO_DETERMINATION and UNDETERMINED are distinct standalone states", () => {
  const { state, id } = opened();
  const a = respond(state, id, { standalone: "NO_DETERMINATION" });
  const b = respond(a.state, id, { standalone: "UNDETERMINED" });
  assert.equal((a.determination.assessment as { standalone: string }).standalone, "NO_DETERMINATION");
  assert.equal((b.determination.assessment as { standalone: string }).standalone, "UNDETERMINED");
  assert.equal(b.superseded?.id, a.determination.id, "amending responsibility supersedes the earlier assessment");
});

// ----------------------------------------------------------------- root cause

const rootCause = (state: State, id: string, over: object) => recordPerformanceDetermination(state, { investigationId: id, assessment: { subject: "ROOT_CAUSE", category: "Process", finding: "f", status: "DETERMINED", role: "PRIMARY", ...over } as never, determinedBy: "R", determinationDate: "2026-02-01", ...(over as { opts?: object }).opts });

test("root cause: one active PRIMARY; a new PRIMARY supersedes it while CONTRIBUTING roots coexist", () => {
  const { state, id } = opened();
  const p1 = rootCause(state, id, { finding: "first" });
  const c1 = rootCause(p1.state, id, { role: "CONTRIBUTING", finding: "c1" });
  const c2 = rootCause(c1.state, id, { role: "CONTRIBUTING", finding: "c2" });
  const p2 = rootCause(c2.state, id, { finding: "second" });
  assert.equal(p2.superseded?.id, p1.determination.id);
  assert.equal(getActiveDeterminations(p2.state, id, "ROOT_CAUSE").length, 3, "one primary + two contributing");
  assert.equal((getActiveDetermination(p2.state, id, "ROOT_CAUSE", "PRIMARY")?.assessment as { finding: string }).finding, "second");
});

test("promoting a contributing root cause to PRIMARY while a primary exists is rejected", () => {
  const { state, id } = opened();
  const p = rootCause(state, id, {});
  const c = rootCause(p.state, id, { role: "CONTRIBUTING", finding: "c" });
  assert.throws(() => recordPerformanceDetermination(c.state, { investigationId: id, assessment: { subject: "ROOT_CAUSE", category: "Process", finding: "c", status: "DETERMINED", role: "PRIMARY" } as never, determinedBy: "R", determinationDate: "2026-02-01", supersedesDeterminationId: c.determination.id }), { code: "SECOND_PRIMARY_ROOT_CAUSE" });
});

test("root cause never forces certainty: UNDETERMINED needs no finding, PROBABLE does", () => {
  const { state, id } = opened();
  assert.doesNotThrow(() => rootCause(state, id, { status: "UNDETERMINED", finding: undefined }));
  assert.doesNotThrow(() => rootCause(state, id, { status: "PROBABLE", finding: "likely distraction" }));
  assert.throws(() => rootCause(state, id, { status: "PROBABLE", finding: "" }), { code: "INVALID_ASSESSMENT" });
  assert.throws(() => rootCause(state, id, { status: "SURE" }), { code: "INVALID_ASSESSMENT" });
  assert.throws(() => rootCause(state, id, { category: "" }), { code: "INVALID_ASSESSMENT" });
});

// ----------------------------------------------------------------- contributing factors

test("contributing factors: zero or more, at most one PRIMARY, stored in a generic child collection", () => {
  const { state, id } = opened();
  const empty = setInvestigationContributingFactors(state, id, [], { by: "Inv" });
  assert.equal(empty.investigation.contributingFactors?.items.length, 0);
  const set = setInvestigationContributingFactors(state, id, [
    { domain: "DRIVER_STATE", factor: "Fatigue", role: "PRIMARY", evidenceIds: ["E1"], note: "per ELD" },
    { domain: "ROAD_WEATHER", factor: "Glare", role: "SECONDARY" },
    { domain: "OPERATIONS", factor: "Tight schedule", role: "SECONDARY" },
  ], { by: "Inv" });
  const collection = set.investigation.contributingFactors;
  assert.equal(collection?.collectionId, "DRV.PERF.INVESTIGATION.CONTRIBUTING_FACTORS");
  assert.equal(collection?.items.length, 3);
  assert.equal(collection?.items[0].facts.domain, "DRIVER_STATE");
  assert.deepEqual(collection?.items[0].evidenceIds, ["E1"]);
  assert.ok(!JSON.stringify(collection).includes("primaryFactor"), "the legacy RootCauseFactor shape is not used");
});

test("contributing factors reject two PRIMARY, unknown domains, blank factors, and edits to a closed investigation", () => {
  const { state, id } = opened();
  assert.throws(() => setInvestigationContributingFactors(state, id, [{ domain: "DRIVER_STATE", factor: "a", role: "PRIMARY" }, { domain: "OPERATIONS", factor: "b", role: "PRIMARY" }], { by: "I" }), { code: "INVALID_CONTRIBUTING_FACTORS" });
  assert.throws(() => setInvestigationContributingFactors(state, id, [{ domain: "WEATHERISH" as never, factor: "a", role: "SECONDARY" }], { by: "I" }), { code: "INVALID_CONTRIBUTING_FACTORS" });
  assert.throws(() => setInvestigationContributingFactors(state, id, [{ domain: "DRIVER_STATE", factor: " ", role: "SECONDARY" }], { by: "I" }), { code: "INVALID_CONTRIBUTING_FACTORS" });
  const cancelled = cancelPerformanceInvestigation(state, id, { by: "I", reason: "r" }).state;
  assert.throws(() => setInvestigationContributingFactors(cancelled, id, [], { by: "I" }), { code: "INVESTIGATION_NOT_EDITABLE" });
});

test("evidence ids are checked against the store's evidence when present, and stored once as references", () => {
  const state = { ...baseState(), evidence: [{ id: "EVD-1" }] } as unknown as State;
  assert.throws(() => openPerformanceInvestigation(state, { eventId: "EVT-NM", openedBy: "A", evidenceIds: ["EVD-404"] }), { code: "UNKNOWN_EVIDENCE" });
  const ok = openPerformanceInvestigation(state, { eventId: "EVT-NM", openedBy: "A", evidenceIds: ["EVD-1"] });
  assert.deepEqual(ok.investigation.evidenceIds, ["EVD-1"]);
  assert.deepEqual(ok.state.evidence, state.evidence, "no evidence is copied or created");
});
