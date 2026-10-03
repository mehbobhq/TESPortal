import "../../helpers/register-alias-loader.mjs";
import test, { before } from "node:test";
import assert from "node:assert/strict";

import {
  closePerformanceEventWorkflow,
  deriveWorkflow,
  setPerformanceInvestigationRequirement,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-workflow.ts";
import {
  completePerformanceInvestigation,
  getActiveDetermination,
  getDeterminationsForInvestigation,
  getInvestigationsForEvent,
  openPerformanceInvestigation,
  recordPerformanceDetermination,
  resolvePreventability,
  setInvestigationContributingFactors,
  updatePerformanceInvestigation,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-investigation.ts";
import {
  createPerformanceEventRelationship,
  getActiveReclassification,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-event-relationships.ts";
import {
  updateCompanyActionEnrichment,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-company-actions.ts";

type DriverData = typeof import("../../../lib/driver-data");
let dd: DriverData;

before(async () => {
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  dd = (await import("../../../lib/driver-data.ts")) as DriverData;
});

// JSON is the persistence format, so comparisons normalise away explicit `undefined` keys that never reach storage.
const j = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const COMPANY = "C-PERSIST";
const KEY = `tes_company_drivers_${COMPANY}`;
const T = (n: number) => `2026-05-01T00:00:${String(n).padStart(2, "0")}.000Z`;

const event = (id: string, eventType: string, extra: object = {}) => ({ id, companyId: COMPANY, driverMasterId: "DRV-1", eventType, eventDate: "2026-04-30", severity: "Not Applicable", status: "Not Applicable", summary: `Seeded ${eventType}`, description: "d", evidenceIds: [], chronology: [], isArchived: false, createdAt: T(0), updatedAt: T(0), ...extra });
const legacyDetermination = { id: "DET-LEGACY", companyId: COMPANY, driverMasterId: "DRV-1", relatedRecordType: "Collision", relatedRecordId: "COL-1", determinationType: "COLLISION_PREVENTABILITY", determinationValue: "PREVENTABLE", preventabilityFinding: "Preventable", determinedBy: "Old Reviewer", determinationDate: "2025-01-01", createdAt: "2025-01-01T00:00:00.000Z" };
const legacyAction = { id: "ACT-LEGACY", companyId: COMPANY, driverMasterId: "DRV-1", actionType: "Coaching Session", title: "Old coaching", decidedBy: "Mgr", factualBasis: "f", effectiveDate: "2025-01-01", status: "Completed", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" };

function seedOldStore() {
  // Exactly the shape written before this slice: no performanceInvestigations / eventRelationships.
  localStorage.setItem(KEY, JSON.stringify({ version: 2, companyId: COMPANY, relationships: [], events: [event("COL-1", "Collision", { collisionDetails: { preventability: "Non-Preventable" } }), event("NM-1", "Near Miss"), event("COL-2", "Collision")], companyDeterminations: [legacyDetermination], companyActions: [legacyAction], evidence: ["E1", "E-basis", "E-done", "E-v"].map((id) => ({ id, companyId: COMPANY, driverMasterId: "DRV-1", fileName: `${id}.pdf`, fileType: "application/pdf", documentType: "Supporting", uploadedAt: T(0), source: "upload", isArchived: false })) }));
}

test("an old store without the new arrays loads with empty arrays and its legacy records intact", () => {
  seedOldStore();
  const store = dd.loadCompanyDriverStore(COMPANY);
  assert.deepEqual(store.performanceInvestigations, []);
  assert.deepEqual(store.eventRelationships, []);
  assert.equal(store.events.length, 3);
  assert.equal(store.companyDeterminations[0].id, "DET-LEGACY");
  assert.equal(store.companyActions[0].id, "ACT-LEGACY");
  assert.equal(store.companyActions[0].closureRequirement, undefined, "legacy actions gain no closure requirement");
});

test("legacy Collision preventability still resolves from a LOADED store (the load-time enum remap does not hide it)", () => {
  seedOldStore();
  const store = dd.loadCompanyDriverStore(COMPANY);
  const collision = store.events.find((item: { id: string }) => item.id === "COL-1");
  const resolved = resolvePreventability(store as never, collision as never);
  assert.deepEqual([resolved?.value, resolved?.source, resolved?.determinationId], ["PREVENTABLE", "LEGACY_DETERMINATION", "DET-LEGACY"]);
  const noLegacy = store.events.find((item: { id: string }) => item.id === "COL-2");
  assert.equal(resolvePreventability(store as never, noLegacy as never), null);
});

test("save -> reload -> read preserves every additive record and field, and derivation is unchanged by the round trip", () => {
  seedOldStore();
  // Build up state with the pure writers over the LOADED store, then persist it through the real save path.
  let store = dd.loadCompanyDriverStore(COMPANY) as never as Parameters<typeof openPerformanceInvestigation>[0];
  store = setPerformanceInvestigationRequirement(store, "NM-1", { required: true, reason: "Serious potential severity", setBy: "TES", at: T(1) }).state;
  const opened = openPerformanceInvestigation(store, { eventId: "NM-1", openedBy: "Safety Mgr", openingReason: "Serious", assignedInvestigator: "J. Reyes", at: T(2) });
  store = opened.state;
  const id = opened.investigation.id;
  store = updatePerformanceInvestigation(store, id, { by: "J. Reyes", conclusion: { summary: "Confirmed close call.", openQuestions: "Dashcam angle" }, additionalInvestigationRequired: { required: false }, at: T(3) }).state;
  store = recordPerformanceDetermination(store, { investigationId: id, assessment: { subject: "PREVENTABILITY", value: "UNDETERMINED" } as never, determinedBy: "R", determinationDate: "2026-05-01", at: T(4) }).state;
  const amended = recordPerformanceDetermination(store, { investigationId: id, assessment: { subject: "PREVENTABILITY", value: "PARTIALLY_PREVENTABLE", opportunityNotes: "Earlier braking" } as never, determinedBy: "R", determinationDate: "2026-05-02", at: T(5) });
  store = amended.state;
  store = recordPerformanceDetermination(store, { investigationId: id, assessment: { subject: "CLASSIFICATION", outcome: "RECLASSIFIED" } as never, determinedBy: "R", determinationDate: "2026-05-02", at: T(6) }).state;
  store = recordPerformanceDetermination(store, { investigationId: id, assessment: { subject: "RESPONSIBILITY", parties: [{ party: "OTHER_ROAD_USER", role: "PRIMARY" }, { party: "ENVIRONMENT_SITE", role: "CONTRIBUTING" }], catalogueVersion: 1 } as never, determinedBy: "R", determinationDate: "2026-05-02", at: T(7) }).state;
  store = recordPerformanceDetermination(store, { investigationId: id, assessment: { subject: "ROOT_CAUSE", category: "Process", finding: "No spotter policy", status: "PROBABLE", role: "PRIMARY" } as never, determinedBy: "R", determinationDate: "2026-05-02", at: T(8) }).state;
  store = setInvestigationContributingFactors(store, id, [{ domain: "DRIVER_STATE", factor: "Fatigue", role: "PRIMARY", evidenceIds: ["E1"] }, { domain: "ROAD_WEATHER", factor: "Glare", role: "SECONDARY" }], { by: "J. Reyes", at: T(9) }).state;
  store = completePerformanceInvestigation(store, id, { by: "J. Reyes", at: T(10) }).state;
  store = createPerformanceEventRelationship(store, { fromEventId: "NM-1", toEventId: "COL-1", type: "RECLASSIFIED_AS", createdBy: "R", basisInvestigationId: id, at: T(11) }).state;
  store = createPerformanceEventRelationship(store, { fromEventId: "NM-1", toEventId: "COL-2", type: "RECLASSIFIED_AS", createdBy: "R2", replaceActiveReclassification: true, at: T(12) }).state;
  // A new required action with the full enrichment, linked to the event and investigation.
  const baseAction = { id: "ACT-NEW", companyId: COMPANY, driverMasterId: "DRV-1", actionType: "CORRECTIVE_ACTION_PLAN", title: "Spotter policy", decidedBy: "Mgr", factualBasis: "f", effectiveDate: "2026-05-01", status: "Completed", targetCompletionDate: "2026-05-20", actualCompletionDate: "2026-05-10", evidenceIds: ["E-basis"], linkedEventIds: ["NM-1"], createdAt: T(13), updatedAt: T(13) };
  store = { ...store, companyActions: [...(store.companyActions || []), baseAction as never] };
  store = updateCompanyActionEnrichment(store, "ACT-NEW", { actionOwner: "Safety Lead", actionOwnerRole: "Safety", assignedAt: "2026-05-01", investigationId: id, closureRequirement: "REQUIRED", completionEvidenceIds: ["E-done"], verification: { required: true, status: "VERIFIED", verifiedBy: "QA", verifiedAt: "2026-05-11T00:00:00.000Z", evidenceIds: ["E-v"], notes: "ok" }, effectiveness: { status: "NOT_YET_EVALUATED" } }, { at: T(14) }).state;
  const closedBefore = closePerformanceEventWorkflow(store, "NM-1", { closedBy: "Mgr", note: "Reviewed", at: T(15) });
  store = closedBefore.state;
  const derivedBefore = deriveWorkflow(store.events.find((item: { id: string }) => item.id === "NM-1")!, store);
  assert.equal(derivedBefore.state, "CLOSED");

  dd.saveCompanyDriverStore(store as never);
  const reloaded = dd.loadCompanyDriverStore(COMPANY) as never as typeof store;

  // new arrays
  assert.deepEqual(reloaded.performanceInvestigations, j(store.performanceInvestigations));
  assert.deepEqual(reloaded.eventRelationships, j(store.eventRelationships));
  assert.equal(reloaded.eventRelationships?.length, 2);
  assert.equal(reloaded.eventRelationships?.[0].status, "WITHDRAWN", "history preserved across persistence");
  assert.equal(getActiveReclassification(reloaded, "NM-1")?.resultingEventId, "COL-2");
  const investigation = getInvestigationsForEvent(reloaded, "NM-1")[0];
  assert.deepEqual(investigation.statusHistory.map((entry: { status: string }) => entry.status), ["OPEN", "COMPLETED"]);
  assert.equal(investigation.contributingFactors?.items.length, 2);

  // additive determination fields survive even though the migrator remaps determinationType/determinationValue
  const all = getDeterminationsForInvestigation(reloaded, id, { includeInactive: true });
  assert.equal(all.length, 5, "4 subjects (preventability, classification, responsibility, root cause) + 1 superseded preventability row");
  const pick = (d: { id: string; subject?: string; investigationId?: string; assessment?: unknown; status?: string; supersedesDeterminationId?: string; assessmentSchemaVersion?: number; relatedRecordType?: string; relatedRecordId?: string }) => ({ id: d.id, subject: d.subject, investigationId: d.investigationId, assessment: d.assessment, status: d.status, supersedesDeterminationId: d.supersedesDeterminationId, assessmentSchemaVersion: d.assessmentSchemaVersion, relatedRecordType: d.relatedRecordType, relatedRecordId: d.relatedRecordId });
  const beforeRows = j(getDeterminationsForInvestigation(store, id, { includeInactive: true }).map(pick));
  assert.deepEqual(j(all.map(pick)), beforeRows);
  assert.equal((getActiveDetermination(reloaded, id, "PREVENTABILITY")?.assessment as { value: string }).value, "PARTIALLY_PREVENTABLE");
  assert.equal(all.find((d: { id: string }) => d.id === amended.determination.id)?.supersedesDeterminationId, amended.superseded?.id);
  assert.equal(resolvePreventability(reloaded, reloaded.events.find((e: { id: string }) => e.id === "NM-1")!)?.source, "INVESTIGATION");

  // additive Company Action fields survive; reused fields untouched
  const action = reloaded.companyActions?.find((a: { id: string }) => a.id === "ACT-NEW");
  assert.deepEqual([action?.actionOwner, action?.actionOwnerRole, action?.assignedAt, action?.investigationId, action?.closureRequirement], ["Safety Lead", "Safety", "2026-05-01", id, "REQUIRED"]);
  assert.deepEqual(action?.completionEvidenceIds, ["E-done"]);
  assert.deepEqual(action?.verification, { required: true, status: "VERIFIED", verifiedBy: "QA", verifiedAt: "2026-05-11T00:00:00.000Z", evidenceIds: ["E-v"], notes: "ok" });
  assert.deepEqual(action?.effectiveness, { status: "NOT_YET_EVALUATED" });
  assert.deepEqual([action?.targetCompletionDate, action?.actualCompletionDate, action?.evidenceIds, action?.linkedEventIds], ["2026-05-20", "2026-05-10", ["E-basis"], ["NM-1"]]);

  // event-level additive fields
  const nm = reloaded.events.find((e: { id: string }) => e.id === "NM-1")!;
  assert.deepEqual(nm.investigationRequirement, { required: true, reason: "Serious potential severity", setAt: T(1), setBy: "TES" });
  assert.deepEqual(nm.workflowClosures, j([closedBefore.closure]));

  // legacy records survive alongside
  assert.equal(reloaded.companyDeterminations?.some((d: { id: string }) => d.id === "DET-LEGACY"), true);
  assert.equal(reloaded.companyActions?.some((a: { id: string }) => a.id === "ACT-LEGACY"), true);

  // derivation is identical after the round trip
  const derivedAfter = deriveWorkflow(nm, reloaded);
  assert.deepEqual(j(derivedAfter), j(derivedBefore));
});

test("saving a second time is stable (no drift, no loss) and unrelated legacy fields on events survive", () => {
  seedOldStore();
  const first = dd.loadCompanyDriverStore(COMPANY);
  dd.saveCompanyDriverStore(first);
  const second = dd.loadCompanyDriverStore(COMPANY);
  dd.saveCompanyDriverStore(second);
  const third = dd.loadCompanyDriverStore(COMPANY);
  assert.deepEqual(third.performanceInvestigations, []);
  assert.deepEqual(third.eventRelationships, []);
  assert.equal(third.events.find((e: { id: string }) => e.id === "COL-1")?.collisionDetails?.preventability, "Non-Preventable", "deprecated Collision field untouched");
});
