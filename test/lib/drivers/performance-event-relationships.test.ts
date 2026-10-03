import test from "node:test";
import assert from "node:assert/strict";

import {
  createPerformanceEventRelationship,
  getActiveReclassification,
  getEventRelationships,
  withdrawPerformanceEventRelationship,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-event-relationships.ts";

type State = Parameters<typeof createPerformanceEventRelationship>[0];

const state = (): State => ({
  events: [
    { id: "NM-001", companyId: "C1", eventType: "Near Miss" },
    { id: "COL-004", companyId: "C1", eventType: "Collision" },
    { id: "COL-005", companyId: "C1", eventType: "Collision" },
    { id: "NM-002", companyId: "C1", eventType: "Near Miss" },
    { id: "OTHER-CO", companyId: "C2", eventType: "Collision" },
  ],
} as unknown as State);

const reclass = (s: State, from: string, to: string, extra: object = {}) => createPerformanceEventRelationship(s, { fromEventId: from, toEventId: to, type: "RECLASSIFIED_AS", createdBy: "Reviewer", at: "2026-03-01T00:00:00.000Z", ...extra });

test("creating a relationship stores one directional row and never touches either event", () => {
  const input = state();
  const before = JSON.stringify(input.events);
  const { state: next, relationship } = reclass(input, "NM-001", "COL-004", { basisInvestigationId: "INV-1", basisDeterminationId: "DET-1", note: "Contact occurred" });
  assert.equal(relationship.status, "ACTIVE");
  assert.equal(relationship.schemaVersion, 1);
  assert.equal(relationship.companyId, "C1");
  assert.equal(relationship.basisDeterminationId, "DET-1");
  assert.equal(next.eventRelationships?.length, 1, "inverse is never stored");
  assert.equal(JSON.stringify(next.events), before, "original eventType and every other event field are untouched");
  assert.equal(next.events[0].eventType, "Near Miss");
});

test("reverse lookup is derived: the target sees the inverse type", () => {
  const { state: s } = reclass(state(), "NM-001", "COL-004");
  const fromNm = getEventRelationships(s, "NM-001");
  const fromCol = getEventRelationships(s, "COL-004");
  assert.deepEqual([fromNm[0].direction, fromNm[0].effectiveType, fromNm[0].otherEventId], ["OUTGOING", "RECLASSIFIED_AS", "COL-004"]);
  assert.deepEqual([fromCol[0].direction, fromCol[0].effectiveType, fromCol[0].otherEventId], ["INCOMING", "ORIGINATED_FROM", "NM-001"]);
  assert.equal(getActiveReclassification(s, "NM-001")?.resultingEventId, "COL-004");
  assert.equal(getActiveReclassification(s, "COL-004"), undefined);
});

test("symmetric and directional types derive their inverse labels", () => {
  let s = state();
  s = createPerformanceEventRelationship(s, { fromEventId: "NM-001", toEventId: "NM-002", type: "SAME_OCCURRENCE_AS", createdBy: "R" }).state;
  s = createPerformanceEventRelationship(s, { fromEventId: "COL-005", toEventId: "COL-004", type: "SUPERSEDES", createdBy: "R" }).state;
  assert.equal(getEventRelationships(s, "NM-002")[0].effectiveType, "SAME_OCCURRENCE_AS");
  assert.equal(getEventRelationships(s, "COL-004")[0].effectiveType, "SUPERSEDED_BY");
});

test("self-links, unknown events, cross-company events and unknown types are rejected", () => {
  assert.throws(() => reclass(state(), "NM-001", "NM-001"), { code: "SELF_RELATIONSHIP" });
  assert.throws(() => reclass(state(), "NM-001", "NOPE"), { code: "EVENT_NOT_FOUND" });
  assert.throws(() => reclass(state(), "NOPE", "COL-004"), { code: "EVENT_NOT_FOUND" });
  assert.throws(() => reclass(state(), "NM-001", "OTHER-CO"), { code: "CROSS_COMPANY_RELATIONSHIP" });
  assert.throws(() => createPerformanceEventRelationship(state(), { fromEventId: "NM-001", toEventId: "COL-004", type: "BOGUS" as never, createdBy: "R" }), { code: "INVALID_RELATIONSHIP_TYPE" });
  assert.throws(() => createPerformanceEventRelationship(state(), { fromEventId: "NM-001", toEventId: "COL-004", type: "RELATED_TO", createdBy: " " }), { code: "REQUIRED_FIELD" });
});

test("RECLASSIFIED_AS cycles are rejected, including through the equivalent ORIGINATED_FROM form", () => {
  const a = reclass(state(), "NM-001", "COL-004").state;
  assert.throws(() => reclass(a, "COL-004", "NM-001"), { code: "RECLASSIFICATION_CYCLE" });
  const chain = reclass(a, "COL-004", "COL-005").state; // NM-001 -> COL-004 -> COL-005
  assert.throws(() => reclass(chain, "COL-005", "NM-001"), { code: "RECLASSIFICATION_CYCLE" });
  // ORIGINATED_FROM(COL-004 -> NM-001) is the same fact as RECLASSIFIED_AS(NM-001 -> COL-004); the reverse of it is a cycle.
  const viaOriginated = createPerformanceEventRelationship(state(), { fromEventId: "COL-004", toEventId: "NM-001", type: "ORIGINATED_FROM", createdBy: "R" }).state;
  assert.equal(getActiveReclassification(viaOriginated, "NM-001")?.resultingEventId, "COL-004");
  assert.throws(() => reclass(viaOriginated, "COL-004", "NM-001"), { code: "RECLASSIFICATION_CYCLE" });
});

test("a second active RECLASSIFIED_AS from the same event is rejected, even in the equivalent form", () => {
  const first = reclass(state(), "NM-001", "COL-004").state;
  assert.throws(() => reclass(first, "NM-001", "COL-005"), { code: "RECLASSIFICATION_EXISTS" });
  assert.throws(() => createPerformanceEventRelationship(first, { fromEventId: "COL-005", toEventId: "NM-001", type: "ORIGINATED_FROM", createdBy: "R" }), { code: "RECLASSIFICATION_EXISTS" });
  assert.throws(() => reclass(first, "NM-001", "COL-004"), { code: "DUPLICATE_RELATIONSHIP" }, "an identical active row is also rejected");
});

test("changing the active reclassification withdraws the old row and keeps both in history", () => {
  const first = reclass(state(), "NM-001", "COL-004", { at: "2026-03-01T00:00:00.000Z" });
  const second = reclass(first.state, "NM-001", "COL-005", { replaceActiveReclassification: true, createdBy: "Reviewer 2", at: "2026-03-02T00:00:00.000Z" });
  assert.equal(second.withdrawn?.id, first.relationship.id);
  const rows = second.state.eventRelationships || [];
  assert.equal(rows.length, 2, "nothing was deleted");
  const old = rows.find((row: { id: string }) => row.id === first.relationship.id);
  assert.deepEqual([old?.status, old?.withdrawnBy, old?.withdrawnAt], ["WITHDRAWN", "Reviewer 2", "2026-03-02T00:00:00.000Z"]);
  assert.equal(getActiveReclassification(second.state, "NM-001")?.resultingEventId, "COL-005");
  assert.equal(getEventRelationships(second.state, "NM-001").length, 1, "default view shows active only");
  assert.equal(getEventRelationships(second.state, "NM-001", { includeWithdrawn: true }).length, 2);
});

test("withdrawal preserves the row; only an ACTIVE row can be withdrawn; a withdrawn row frees the slot", () => {
  const created = reclass(state(), "NM-001", "COL-004");
  const withdrawn = withdrawPerformanceEventRelationship(created.state, created.relationship.id, { by: "R", at: "2026-03-05T00:00:00.000Z" });
  assert.equal(withdrawn.relationship.status, "WITHDRAWN");
  assert.equal(withdrawn.state.eventRelationships?.length, 1);
  assert.equal(getActiveReclassification(withdrawn.state, "NM-001"), undefined);
  assert.throws(() => withdrawPerformanceEventRelationship(withdrawn.state, created.relationship.id, { by: "R" }), { code: "RELATIONSHIP_NOT_ACTIVE" });
  assert.throws(() => withdrawPerformanceEventRelationship(withdrawn.state, "ERL-x", { by: "R" }), { code: "RELATIONSHIP_NOT_FOUND" });
  assert.doesNotThrow(() => reclass(withdrawn.state, "NM-001", "COL-005"));
});

test("duplicate detection treats symmetric types as unordered", () => {
  const a = createPerformanceEventRelationship(state(), { fromEventId: "NM-001", toEventId: "NM-002", type: "RELATED_TO", createdBy: "R" }).state;
  assert.throws(() => createPerformanceEventRelationship(a, { fromEventId: "NM-002", toEventId: "NM-001", type: "RELATED_TO", createdBy: "R" }), { code: "DUPLICATE_RELATIONSHIP" });
});
