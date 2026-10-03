import test from "node:test";
import assert from "node:assert/strict";

import {
  closePerformanceEventWorkflow,
  deriveWorkflow,
  explainWorkflow,
  makeObligation,
  setPerformanceInvestigationRequirement,
  type WorkflowProvider,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-workflow.ts";
import {
  completePerformanceInvestigation,
  openPerformanceInvestigation,
  recordPerformanceDetermination,
  transitionPerformanceInvestigation,
  updatePerformanceInvestigation,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-investigation.ts";
import {
  evaluateRequiredAction,
  getCompanyActionsForEvent,
  getCompanyActionsForInvestigation,
  updateCompanyActionEnrichment,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-company-actions.ts";

type State = Parameters<typeof deriveWorkflow>[1];

const T = (n: number) => `2026-04-01T00:00:${String(n).padStart(2, "0")}.000Z`;
const EVENT_ID = "NM-001";
const baseState = (extra: object = {}): State => ({ events: [{ id: EVENT_ID, companyId: "C1", eventType: "Near Miss", driverMasterId: "DRV-1", createdAt: T(0) }], ...extra } as unknown as State);
const derive = (s: State, providers?: readonly WorkflowProvider[]) => deriveWorkflow(s.events[0], s, providers);
const action = (over: object = {}) => ({ id: "ACT-1", companyId: "C1", driverMasterId: "DRV-1", actionType: "CORRECTIVE_ACTION_PLAN", title: "Retrain on following distance", decidedBy: "Mgr", factualBasis: "f", effectiveDate: "2026-04-01", status: "Active", linkedEventIds: [EVENT_ID], closureRequirement: "REQUIRED", createdAt: T(1), updatedAt: T(1), ...over });
const withActions = (...actions: object[]) => baseState({ companyActions: actions });

/** A test provider standing in for a future category provider (e.g. Near Miss "unsafe condition remains"). */
const unsafeCondition = (unresolved: boolean, createdAt = T(1)): WorkflowProvider => ({ id: "unsafe", collect: (event) => [makeObligation("UNSAFE_CONDITION_REMAINS", { type: "Event", id: event.id }, !unresolved, { createdAt, resolvedAt: T(4), resolvedBy: "Dispatcher" })] });

// ----------------------------------------------------------------- base derivation

test("no obligation ever existed -> NOT_REQUIRED, with no reasons", () => {
  const d = derive(baseState());
  assert.equal(d.state, "NOT_REQUIRED");
  assert.deepEqual(d.reasons, []);
  assert.throws(() => closePerformanceEventWorkflow(baseState(), EVENT_ID, { closedBy: "R" }), { code: "CLOSURE_NOT_ALLOWED" });
});

test("an unsafe condition keeps the event OPEN and explains why", () => {
  const d = derive(baseState(), [unsafeCondition(true)]);
  assert.equal(d.state, "OPEN");
  assert.deepEqual(d.reasons.map((r: { code: string }) => r.code), ["UNSAFE_CONDITION_REMAINS"]);
  assert.deepEqual(explainWorkflow(d), ["Unsafe condition remains"]);
});

test("a REQUIRED company action keeps the event OPEN with its source id", () => {
  const d = derive(withActions(action()));
  assert.equal(d.state, "OPEN");
  assert.deepEqual(d.openReasons.map((r: { code: string; source: { type: string; id: string } }) => [r.code, r.source.type, r.source.id]), [["CORRECTIVE_ACTION_OUTSTANDING", "CompanyAction", "ACT-1"]]);
  assert.equal(d.openReasons[0].detail, "Retrain on following distance");
});

test("multiple reasons are ordered by priority, then creation time, then source id, deterministically", () => {
  const s = withActions(action({ id: "ACT-B", createdAt: T(3) }), action({ id: "ACT-A", createdAt: T(3) }), action({ id: "ACT-C", createdAt: T(2) }));
  const withFollowUp = { ...s, events: [{ ...s.events[0], followUpActionRequired: true, followUpActionSummary: "call driver" }] } as State;
  const order = derive(withFollowUp).openReasons.map((r: { code: string; source: { id: string } }) => `${r.code}:${r.source.id}`);
  assert.deepEqual(order, ["CORRECTIVE_ACTION_OUTSTANDING:ACT-C", "CORRECTIVE_ACTION_OUTSTANDING:ACT-A", "CORRECTIVE_ACTION_OUTSTANDING:ACT-B", "FOLLOW_UP_OUTSTANDING:NM-001"]);
  const again = derive(withFollowUp).openReasons.map((r: { code: string; source: { id: string } }) => `${r.code}:${r.source.id}`);
  assert.deepEqual(again, order, "stable across runs");
});

test("reasons from several providers interleave by catalogue priority", () => {
  const s = withActions(action());
  const d = deriveWorkflow(s.events[0], s, [
    { id: "actions", collect: (e, st) => (deriveWorkflow(e, st).openReasons.length ? [makeObligation("CORRECTIVE_ACTION_OUTSTANDING", { type: "CompanyAction", id: "ACT-1" }, false, { createdAt: T(1) })] : []) },
    unsafeCondition(true),
    { id: "evidence", collect: (e) => [makeObligation("REQUIRED_EVIDENCE_MISSING", { type: "Event", id: e.id }, false, { createdAt: T(1) })] },
  ]);
  assert.deepEqual(d.reasons.map((r: { code: string }) => r.code), ["UNSAFE_CONDITION_REMAINS", "REQUIRED_EVIDENCE_MISSING", "CORRECTIVE_ACTION_OUTSTANDING"]);
});

test("only review/waiting-type conditions remain -> IN_REVIEW", () => {
  let s = baseState();
  s = setPerformanceInvestigationRequirement(s, EVENT_ID, { required: true, setBy: "TES", at: T(1) }).state;
  const { state, investigation } = openPerformanceInvestigation(s, { eventId: EVENT_ID, openedBy: "Inv", at: T(2) });
  assert.equal(derive(state).state, "OPEN", "required investigation in progress is an obligation");
  const waiting = transitionPerformanceInvestigation(state, investigation.id, { to: "AWAITING_INFORMATION", by: "Inv", at: T(3) }).state;
  const d = derive(waiting);
  assert.equal(d.state, "IN_REVIEW");
  assert.equal(d.reasons[0].code, "INVESTIGATION_INCOMPLETE");
  assert.equal(d.reasons[0].source.id, investigation.id);
});

test("a required action with pending verification is a review-type reason; failed verification is work again", () => {
  const pending = derive(withActions(action({ status: "Completed", actualCompletionDate: "2026-04-02", verification: { required: true, status: "PENDING" } })));
  assert.equal(pending.state, "IN_REVIEW");
  assert.equal(pending.reasons[0].code, "REQUIRED_REVIEW_OUTSTANDING");
  const failed = derive(withActions(action({ status: "Completed", verification: { required: true, status: "FAILED" } })));
  assert.equal(failed.state, "OPEN");
  assert.equal(failed.reasons[0].code, "CORRECTIVE_ACTION_OUTSTANDING");
});

test("all obligations resolved -> READY_TO_CLOSE, never CLOSED on its own", () => {
  const d = derive(withActions(action({ status: "Completed", actualCompletionDate: "2026-04-02", actionOwner: "Safety Lead" })), [unsafeCondition(false)]);
  assert.equal(d.state, "READY_TO_CLOSE");
  assert.equal(d.openReasons.length, 0);
  assert.deepEqual(explainWorkflow(d), ["Unsafe condition resolved", "Final closure review pending"]);
  assert.deepEqual([d.resolvedReasons[0].resolvedBy, d.resolvedReasons[0].resolvedAt], ["Dispatcher", T(4)], "who/when stay on the reason for later presentation");
  assert.equal(d.closure, undefined);
  const again = derive(withActions(action({ status: "Completed" })), [unsafeCondition(false)]);
  assert.equal(again.state, "READY_TO_CLOSE", "repeated derivation never auto-closes");
});

// ----------------------------------------------------------------- company actions

test("a REQUIRED action blocks readiness; a NOT_REQUIRED (or unspecified legacy) action does not", () => {
  assert.equal(derive(withActions(action())).state, "OPEN");
  assert.equal(derive(withActions(action({ closureRequirement: "NOT_REQUIRED" }))).state, "NOT_REQUIRED", "optional action creates no obligation");
  const legacyAction = { ...action(), closureRequirement: undefined };
  assert.equal(derive(withActions(legacyAction)).state, "NOT_REQUIRED", "legacy actions never block anything");
  const mixed = derive(withActions(action({ id: "R", status: "Completed" }), action({ id: "O", closureRequirement: "NOT_REQUIRED", status: "Active" })));
  assert.equal(mixed.state, "READY_TO_CLOSE");
});

test("required verification blocks readiness until satisfied", () => {
  const base = { status: "Completed", actualCompletionDate: "2026-04-02" };
  assert.equal(derive(withActions(action({ ...base, verification: { required: true, status: "PENDING" } }))).state, "IN_REVIEW");
  assert.equal(derive(withActions(action({ ...base, verification: { required: true, status: "VERIFIED", verifiedBy: "QA", verifiedAt: "2026-04-03T00:00:00.000Z" } }))).state, "READY_TO_CLOSE");
  assert.equal(derive(withActions(action({ ...base, verification: { required: false, status: "NOT_REQUIRED" } }))).state, "READY_TO_CLOSE");
});

test("effectiveness review never blocks readiness or closure", () => {
  for (const status of ["NOT_YET_EVALUATED", "NOT_EFFECTIVE", "CANNOT_DETERMINE", "EFFECTIVE"]) {
    const s = withActions(action({ status: "Completed", effectiveness: { status, reviewedBy: "Q", reviewedAt: T(5) } }));
    assert.equal(derive(s).state, "READY_TO_CLOSE", status);
  }
  const closed = closePerformanceEventWorkflow(withActions(action({ status: "Completed", effectiveness: { status: "NOT_YET_EVALUATED" } })), EVENT_ID, { closedBy: "R", at: T(9) });
  assert.equal(derive(closed.state).state, "CLOSED");
});

test("rescinded and archived required actions are excluded entirely", () => {
  assert.equal(evaluateRequiredAction(action({ status: "Rescinded" }) as never).relevant, false);
  assert.equal(derive(withActions(action({ isArchived: true }))).state, "NOT_REQUIRED");
});

test("actions reach the event directly (linkedEventIds) or through its investigation, and reverse selectors work", () => {
  const { state, investigation } = openPerformanceInvestigation(baseState({ companyActions: [action({ id: "DIRECT" }), action({ id: "VIA-INV", linkedEventIds: undefined, investigationId: undefined })] }), { eventId: EVENT_ID, openedBy: "Inv", at: T(1) });
  const linked = updateCompanyActionEnrichment(state, "VIA-INV", { investigationId: investigation.id }).state;
  assert.deepEqual(getCompanyActionsForEvent(linked, EVENT_ID).map((a: { id: string }) => a.id).sort(), ["DIRECT", "VIA-INV"]);
  assert.deepEqual(getCompanyActionsForInvestigation(linked, investigation.id).map((a: { id: string }) => a.id), ["VIA-INV"]);
  assert.throws(() => updateCompanyActionEnrichment(linked, "DIRECT", { investigationId: "INV-nope" }), { code: "INVESTIGATION_NOT_FOUND" });
});

test("enrichment is validated and merges without disturbing reused fields", () => {
  const s = withActions(action({ targetCompletionDate: "2026-05-01", evidenceIds: ["E-basis"] }));
  const { action: updated } = updateCompanyActionEnrichment(s, "ACT-1", { actionOwner: "Safety Lead", actionOwnerRole: "Safety", assignedAt: "2026-04-01", completionEvidenceIds: ["E-done"], verification: { required: true, status: "PENDING" }, effectiveness: { status: "NOT_YET_EVALUATED" } });
  assert.equal(updated.targetCompletionDate, "2026-05-01");
  assert.deepEqual(updated.evidenceIds, ["E-basis"]);
  assert.equal(updated.actionOwner, "Safety Lead");
  assert.throws(() => updateCompanyActionEnrichment(s, "ACT-1", { closureRequirement: "SOMETIMES" as never }), { code: "INVALID_ACTION_ENRICHMENT" });
  assert.throws(() => updateCompanyActionEnrichment(s, "ACT-1", { verification: { required: true, status: "VERIFIED" } }), { code: "INVALID_ACTION_ENRICHMENT" });
  assert.throws(() => updateCompanyActionEnrichment(s, "ACT-1", { effectiveness: { status: "EFFECTIVE" } }), { code: "INVALID_ACTION_ENRICHMENT" });
  assert.throws(() => updateCompanyActionEnrichment(s, "ACT-X", {}), { code: "ACTION_NOT_FOUND" });
});

// ----------------------------------------------------------------- investigation requirement / additional investigation

test("no investigation record is not 'incomplete' unless an investigation is REQUIRED", () => {
  assert.equal(derive(baseState()).state, "NOT_REQUIRED");
  const optional = openPerformanceInvestigation(baseState(), { eventId: EVENT_ID, openedBy: "Inv", at: T(1) }).state;
  assert.equal(derive(optional).state, "NOT_REQUIRED", "an optional investigation in progress creates no obligation");
  const required = setPerformanceInvestigationRequirement(baseState(), EVENT_ID, { required: true, reason: "Serious potential severity", setBy: "TES", at: T(1) }).state;
  const d = derive(required);
  assert.equal(d.state, "OPEN");
  assert.deepEqual([d.reasons[0].code, d.reasons[0].source.type], ["INVESTIGATION_INCOMPLETE", "Event"]);
});

test("completing a required investigation resolves its reason; the requirement can be released explicitly", () => {
  let s = setPerformanceInvestigationRequirement(baseState(), EVENT_ID, { required: true, setBy: "TES", at: T(1) }).state;
  const o = openPerformanceInvestigation(s, { eventId: EVENT_ID, openedBy: "Inv", at: T(2) });
  s = updatePerformanceInvestigation(o.state, o.investigation.id, { by: "Inv", conclusion: { summary: "done" } }).state;
  s = recordPerformanceDetermination(s, { investigationId: o.investigation.id, assessment: { subject: "CLASSIFICATION", outcome: "CONFIRMED_AS_REPORTED" } as never, determinedBy: "R", determinationDate: "2026-04-01", at: T(3) }).state;
  s = completePerformanceInvestigation(s, o.investigation.id, { by: "Inv", at: T(4) }).state;
  const d = derive(s);
  assert.equal(d.state, "READY_TO_CLOSE");
  assert.deepEqual([d.resolvedReasons[0].code, d.resolvedReasons[0].resolvedBy], ["INVESTIGATION_INCOMPLETE", "Inv"]);
  const released = setPerformanceInvestigationRequirement(baseState(), EVENT_ID, { required: false, setBy: "TES", at: T(1) }).state;
  assert.equal(derive(released).state, "NOT_REQUIRED");
});

test("additionalInvestigationRequired opens the event until cleared, even on an optional investigation", () => {
  const { state, investigation } = openPerformanceInvestigation(baseState(), { eventId: EVENT_ID, openedBy: "Inv", at: T(1) });
  const flagged = updatePerformanceInvestigation(state, investigation.id, { by: "Inv", additionalInvestigationRequired: { required: true, reason: "Dashcam gap" }, at: T(2) }).state;
  const d = derive(flagged);
  assert.equal(d.state, "OPEN");
  assert.deepEqual([d.reasons[0].code, d.reasons[0].detail], ["ADDITIONAL_INVESTIGATION_REQUIRED", "Dashcam gap"]);
  const cleared = updatePerformanceInvestigation(flagged, investigation.id, { by: "Inv", additionalInvestigationRequired: { required: false }, at: T(3) }).state;
  assert.equal(derive(cleared).state, "NOT_REQUIRED");
});

// ----------------------------------------------------------------- deliberate closure

test("deliberate closure: allowed only from READY_TO_CLOSE, recorded with actor/date/note, state becomes CLOSED", () => {
  const providers = [unsafeCondition(false)];
  const ready = withActions(action({ status: "Completed", actualCompletionDate: "2026-04-02" }));
  const closed = closePerformanceEventWorkflow(ready, EVENT_ID, { closedBy: "Safety Mgr", note: "Reviewed", at: T(10), providers });
  assert.equal(closed.closure.closedBy, "Safety Mgr");
  assert.equal(closed.closure.closedAt, T(10));
  assert.equal(closed.state.events[0].workflowClosures?.length, 1);
  const d = deriveWorkflow(closed.state.events[0], closed.state, providers);
  assert.equal(d.state, "CLOSED");
  assert.equal(d.closureSuperseded, false);
  const lines = explainWorkflow(d);
  assert.equal(lines[lines.length - 1], `Final closure review completed by Safety Mgr on ${T(10).slice(0, 10)}`);
  assert.throws(() => closePerformanceEventWorkflow(closed.state, EVENT_ID, { closedBy: " ", providers }), { code: "REQUIRED_FIELD" });
});

test("closure is blocked while obligations remain, and the blocking reasons are named", () => {
  assert.throws(() => closePerformanceEventWorkflow(withActions(action()), EVENT_ID, { closedBy: "R" }), (error: Error & { code?: string }) => error.code === "CLOSURE_NOT_ALLOWED" && /Corrective action outstanding/.test(error.message));
  assert.throws(() => closePerformanceEventWorkflow(baseState(), EVENT_ID, { closedBy: "R", providers: [unsafeCondition(true)] }), { code: "CLOSURE_NOT_ALLOWED" });
});

test("closing an already-closed event is refused (state is CLOSED, not READY_TO_CLOSE)", () => {
  const ready = withActions(action({ status: "Completed" }));
  const closed = closePerformanceEventWorkflow(ready, EVENT_ID, { closedBy: "R", at: T(10) });
  assert.throws(() => closePerformanceEventWorkflow(closed.state, EVENT_ID, { closedBy: "R", at: T(11) }), { code: "CLOSURE_NOT_ALLOWED" });
});

// ----------------------------------------------------------------- post-closure edge case

test("POST-CLOSURE: a new required obligation after closure surfaces, the closure stays on record, and re-closure is deliberate", () => {
  const ready = withActions(action({ id: "OLD", status: "Completed", createdAt: T(1) }));
  const closed = closePerformanceEventWorkflow(ready, EVENT_ID, { closedBy: "Mgr", note: "first closure", at: T(10) });
  assert.equal(derive(closed.state).state, "CLOSED");

  // A new REQUIRED action is created AFTER the closure.
  const withNew = { ...closed.state, companyActions: [...(closed.state.companyActions || []), action({ id: "NEW", status: "Active", createdAt: T(20), title: "Follow-up retraining" })] } as State;
  const reopened = derive(withNew);
  assert.equal(reopened.state, "OPEN", "the new obligation is surfaced; the event is not reported as closed");
  assert.deepEqual(reopened.openReasons.map((r: { source: { id: string } }) => r.source.id), ["NEW"]);
  assert.equal(reopened.closureSuperseded, true);
  assert.deepEqual(reopened.obligationsSinceClosure.map((r: { source: { id: string } }) => r.source.id), ["NEW"]);
  assert.equal(reopened.closure?.note, "first closure", "historical closure information is preserved");
  assert.equal(withNew.events[0].workflowClosures?.length, 1, "nothing was erased from the record");
  assert.throws(() => closePerformanceEventWorkflow(withNew, EVENT_ID, { closedBy: "Mgr", at: T(21) }), { code: "CLOSURE_NOT_ALLOWED" });

  // Resolving the new obligation does NOT silently reuse the old closure: a new deliberate closure is required.
  const resolved = { ...withNew, companyActions: withNew.companyActions!.map((a: { id: string }) => (a.id === "NEW" ? { ...a, status: "Completed", actualCompletionDate: "2026-04-05" } : a)) } as State;
  const ready2 = derive(resolved);
  assert.equal(ready2.state, "READY_TO_CLOSE");
  assert.equal(ready2.closureSuperseded, true);
  const closedAgain = closePerformanceEventWorkflow(resolved, EVENT_ID, { closedBy: "Mgr 2", at: T(30) });
  const finalState = derive(closedAgain.state);
  assert.equal(finalState.state, "CLOSED");
  assert.equal(closedAgain.state.events[0].workflowClosures?.length, 2, "both closures retained, append-only");
  assert.equal(finalState.closure?.closedBy, "Mgr 2");
  assert.equal(finalState.closureSuperseded, false);
});

// ----------------------------------------------------------------- determinism

test("derivation is deterministic, idempotent and does not mutate its inputs", () => {
  const s = withActions(action({ id: "B", createdAt: T(3) }), action({ id: "A", createdAt: T(2) }), action({ id: "C", status: "Completed", createdAt: T(1) }));
  const before = JSON.stringify(s);
  const first = derive(s);
  const second = derive(s);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(first.openReasons.map((r: { source: { id: string } }) => r.source.id), ["A", "B"]);
  assert.deepEqual(first.resolvedReasons.map((r: { source: { id: string } }) => r.source.id), ["C"]);
});
