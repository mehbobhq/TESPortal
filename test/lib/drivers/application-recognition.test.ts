import test from "node:test";
import assert from "node:assert/strict";

import {
  applicationWorkflowOutcome,
  assessApplicationRequirement,
  checkApplicationCreation,
  classifyHiringContext,
  hasVerifiedExperienceEvidence,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/driver-application-evidence.ts";

type App = Parameters<typeof assessApplicationRequirement>[0][number];
type Evd = Parameters<typeof assessApplicationRequirement>[1][number];

const ctx = { companyId: "CMP-1", driverMasterId: "DRV-1", relationshipId: "REL-1", identity: { legalFirstName: "Amandeep", legalLastName: "Dhillon", dateOfBirth: "1985-04-02" } };

function evidence(over: Partial<Evd> = {}): Evd {
  return {
    id: "EVD-1", companyId: "CMP-1", driverMasterId: "DRV-1", fileName: "application.pdf", fileType: "application/pdf",
    documentType: "Driver Application", uploadedAt: "2026-01-01T00:00:00Z", source: "upload", linkedRecordType: "Driver Application", linkedRecordId: "APP-1",
    verificationState: "verified", verifiedBy: "Reviewer", verifiedAt: "2026-01-02T00:00:00Z", isArchived: false, ...over,
  } as Evd;
}
function app(over: Partial<App> = {}): App {
  return {
    id: "APP-1", companyId: "CMP-1", driverMasterId: "DRV-1", companyDriverRelationshipId: "REL-1", source: "Carrier Supplied",
    applicationType: "Full Driver Employment", status: "Submitted", operatingRegion: "Canada", createdDate: "2026-01-01", evidenceIds: ["EVD-1"],
    personalInfoClaimed: { legalFirstName: "amandeep", legalLastName: "Dhillon", dateOfBirth: "1985-04-02", phone: "", email: "", workAuthorized: true },
    consents: { mvrConsent: true, clearinghouseConsent: true, backgroundCheckConsent: true, drugAlcoholConsent: true, signatureName: "A Dhillon", signedAt: "2025-12-30" },
    processing: { status: "Processed", findingIds: [], fileCompleteness: "Complete", qualificationAssessment: "Assessed", updatedAt: "" },
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
  } as App;
}

test("verified carrier-supplied application with verified canonical evidence satisfies the requirement", () => {
  const result = assessApplicationRequirement([app()], [evidence()], ctx);
  assert.equal(result.state, "VERIFIED");
  assert.equal(result.authoritativeApplicationId, "APP-1");
  assert.deepEqual(result.qualifyingEvidenceIds, ["EVD-1"]);
  assert.equal(applicationWorkflowOutcome(result).status, "SATISFIED");
});

test("pending evidence is awaiting review, never satisfied", () => {
  for (const verificationState of ["unverified", "pending_review", "Not Reviewed", "Under Review"] as const) {
    const result = assessApplicationRequirement([app()], [evidence({ verificationState, verifiedBy: undefined, verifiedAt: undefined })], ctx);
    assert.equal(result.state, "AWAITING_REVIEW", verificationState);
    assert.equal(applicationWorkflowOutcome(result).action, "CONTINUE_APPLICATION");
  }
});

test("OCR classification, filename and upload alone are not proof", () => {
  const upload = evidence({ verificationState: "unverified", verifiedBy: undefined, verifiedAt: undefined, ocrConfidence: 99, fileName: "Driver Application - verified.pdf" });
  assert.notEqual(assessApplicationRequirement([app()], [upload], ctx).state, "VERIFIED");
  // A verified state without a named reviewer and time is also insufficient.
  assert.notEqual(assessApplicationRequirement([app()], [evidence({ verifiedBy: undefined })], ctx).state, "VERIFIED");
  assert.notEqual(assessApplicationRequirement([app()], [evidence({ verifiedAt: undefined })], ctx).state, "VERIFIED");
});

test("missing evidence: no application and no document is MISSING and offers Send Application without creating anything", () => {
  const apps: App[] = [];
  const result = assessApplicationRequirement(apps, [], ctx);
  assert.equal(result.state, "MISSING");
  assert.equal(applicationWorkflowOutcome(result).action, "SEND_APPLICATION");
  assert.equal(apps.length, 0);
});

test("an application document with no application record is held for linking and does not satisfy the requirement", () => {
  const result = assessApplicationRequirement([], [evidence({ linkedRecordId: "APP-404" })], ctx);
  assert.equal(result.state, "AWAITING_REVIEW");
  assert.deepEqual(result.unlinkedApplicationEvidenceIds, ["EVD-1"]);
});

test("evidence from another company or driver, archived, superseded, or of an unsupported type is not accepted", () => {
  const rejected: Partial<Evd>[] = [
    { companyId: "CMP-2" }, { driverMasterId: "DRV-2" }, { isArchived: true }, { verificationState: "superseded" },
    // Free-text documentType / OCR label without the canonical "Driver Application" link: classification pending review.
    { linkedRecordType: undefined, linkedRecordId: undefined, documentType: "Driver Application" },
  ];
  for (const over of rejected) assert.notEqual(assessApplicationRequirement([app()], [evidence(over)], ctx).state, "VERIFIED", JSON.stringify(over));
  const replaced = assessApplicationRequirement([app()], [evidence(), evidence({ id: "EVD-2", supersedesEvidenceId: "EVD-1", verificationState: "unverified", verifiedBy: undefined, verifiedAt: undefined })], ctx);
  assert.notEqual(replaced.state, "VERIFIED");
});

test("evidence is recognised through the evidence-side canonical link as well", () => {
  const result = assessApplicationRequirement([app({ evidenceIds: [] })], [evidence()], ctx);
  assert.equal(result.state, "VERIFIED");
});

test("identity mismatch requires correction", () => {
  const wrongName = app({ personalInfoClaimed: { ...app().personalInfoClaimed!, legalLastName: "Someone Else" } });
  assert.equal(assessApplicationRequirement([wrongName], [evidence()], ctx).state, "REQUIRES_CORRECTION");
  assert.equal(assessApplicationRequirement([app({ companyDriverRelationshipId: "REL-9" })], [evidence()], ctx).state, "REQUIRES_CORRECTION");
});

test("a verified document with matching name, DOB and signature is not a compliant application until completeness is assessed", () => {
  for (const processing of [undefined, { status: "Processed", findingIds: [], fileCompleteness: "Not Assessed", qualificationAssessment: "Not Assessed", updatedAt: "" }]) {
    const result = assessApplicationRequirement([app({ processing: processing as App["processing"] })], [evidence()], ctx);
    assert.equal(result.state, "AWAITING_REVIEW");
    assert.match(result.reasons.join(" "), /completeness is Not Assessed/);
    assert.equal(applicationWorkflowOutcome(result).status, "PENDING");
  }
  for (const fileCompleteness of ["Incomplete", "Review Required"] as const) {
    const processing = { status: "Review Required", findingIds: [], fileCompleteness, qualificationAssessment: "Pending", updatedAt: "" } as App["processing"];
    assert.equal(assessApplicationRequirement([app({ processing })], [evidence()], ctx).state, "REQUIRES_CORRECTION", fileCompleteness);
  }
});

test("remediation: open finding requires correction; resolving it, or a verified remediating application, clears it", () => {
  const finding = { id: "F1", type: "MISMATCH", status: "Open", subject: "Licence", label: "Licence number differs", evidenceIds: [], createdAt: "", updatedAt: "" } as NonNullable<App["findings"]>[number];
  assert.equal(assessApplicationRequirement([app({ findings: [finding] })], [evidence()], ctx).state, "REQUIRES_CORRECTION");
  assert.equal(assessApplicationRequirement([app({ findings: [{ ...finding, status: "Resolved" }] })], [evidence()], ctx).state, "VERIFIED");

  const original = app({ findings: [finding] });
  const remediation = app({ id: "APP-2", remediatesApplicationId: "APP-1", evidenceIds: ["EVD-2"] });
  const result = assessApplicationRequirement([original, remediation], [evidence(), evidence({ id: "EVD-2", linkedRecordId: "APP-2" })], ctx);
  assert.equal(result.state, "VERIFIED");
  assert.equal(result.authoritativeApplicationId, "APP-2");
  assert.equal(result.verdicts.length, 2, "the original is preserved in the assessment");
});

test("the first array entry is not authoritative", () => {
  const rejectedFirst = app({ id: "APP-0", status: "Rejected", evidenceIds: [] });
  const result = assessApplicationRequirement([rejectedFirst, app()], [evidence()], ctx);
  assert.equal(result.state, "VERIFIED");
  assert.equal(result.authoritativeApplicationId, "APP-1");
});

test("a superseded application is history; its linked replacement drives the result", () => {
  const original = app({ status: "Superseded", supersededByApplicationId: "APP-2" });
  const replacement = app({ id: "APP-2", source: "TES Workflow", status: "Invitation Ready", replacesApplicationId: "APP-1", evidenceIds: [] });
  const result = assessApplicationRequirement([replacement, original], [evidence()], ctx);
  assert.equal(result.state, "NEW_APPLICATION_WORKFLOW");
  assert.equal(result.authoritativeApplicationId, "APP-2");
  assert.equal(applicationWorkflowOutcome(result).action, "SEND_APPLICATION");
  assert.equal(result.verdicts.find((v: { applicationId: string }) => v.applicationId === "APP-1")?.state, "SUPERSEDED");
});

test("TES-workflow lifecycle is preserved but a submitted application is not regulatorily complete", () => {
  const notAssessed = { status: "Not Started", findingIds: [], fileCompleteness: "Not Assessed", qualificationAssessment: "Not Assessed", updatedAt: "" } as App["processing"];
  const tes = (status: App["status"], processing: App["processing"] = notAssessed) =>
    assessApplicationRequirement([app({ source: "TES Workflow", status, evidenceIds: [], processing })], [], ctx);
  const submitted = tes("Submitted");
  assert.equal(submitted.submission, "Submitted");
  assert.equal(submitted.verification, "Not Applicable");
  assert.equal(submitted.completeness, "Not Assessed");
  assert.equal(submitted.state, "AWAITING_REVIEW");
  assert.equal(submitted.completenessNotAssessed, true);
  assert.equal(applicationWorkflowOutcome(submitted).status, "PENDING");
  assert.equal(applicationWorkflowOutcome(submitted).label, "Application Completeness Not Assessed");
  // only an explicit completeness outcome satisfies it
  assert.equal(tes("Submitted", { ...notAssessed!, fileCompleteness: "Complete" }).state, "VERIFIED");
  assert.equal(tes("Approved").state, "AWAITING_REVIEW", "a company determination is not a completeness assessment");
  assert.equal(tes("Submitted", undefined).completeness, "Not Assessed");
  // lifecycle states are unchanged
  assert.equal(tes("Invited").state, "AWAITING_REVIEW");
  assert.equal(tes("Invited").submission, "Not Submitted");
  assert.equal(tes("Invited").completenessNotAssessed, false);
  assert.equal(applicationWorkflowOutcome(tes("Invited")).label, "Application Pending");
  assert.equal(tes("Invitation Ready").state, "NEW_APPLICATION_WORKFLOW");
  assert.equal(tes("Rejected").state, "NEW_APPLICATION_WORKFLOW");
});

test("submission, verification and completeness are independent facts for carrier-supplied applications", () => {
  const done = (fileCompleteness: string) => ({ status: "Processed", findingIds: [], fileCompleteness, qualificationAssessment: "Assessed", updatedAt: "" } as App["processing"]);
  // submitted, document pending verification, completeness irrelevant until verified
  const pending = assessApplicationRequirement([app()], [evidence({ verificationState: "pending_review", verifiedBy: undefined, verifiedAt: undefined })], ctx);
  assert.deepEqual([pending.submission, pending.verification, pending.completeness, pending.completenessNotAssessed], ["Submitted", "Pending", "Complete", false]);
  assert.equal(pending.state, "AWAITING_REVIEW");
  // verified document, completeness Not Assessed: pending, never satisfied
  const verified = assessApplicationRequirement([app({ processing: done("Not Assessed") })], [evidence()], ctx);
  assert.deepEqual([verified.submission, verified.verification, verified.completeness, verified.completenessNotAssessed], ["Submitted", "Verified", "Not Assessed", true]);
  assert.notEqual(verified.state, "VERIFIED");
  // completeness stated Complete on an unverified document does not satisfy it either
  assert.notEqual(assessApplicationRequirement([app({ processing: done("Complete") })], [evidence({ verificationState: "unverified", verifiedBy: undefined })], ctx).state, "VERIFIED");
  // both gates met
  assert.equal(assessApplicationRequirement([app({ processing: done("Complete") })], [evidence()], ctx).state, "VERIFIED");
});

test("banner resolves automatically when the missing evidence arrives and is reassessed", () => {
  const apps = [app()];
  const states = [
    assessApplicationRequirement(apps, [], ctx),
    assessApplicationRequirement(apps, [evidence({ verificationState: "pending_review", verifiedBy: undefined, verifiedAt: undefined })], ctx),
    assessApplicationRequirement(apps, [evidence()], ctx),
  ].map((r) => applicationWorkflowOutcome(r).action);
  assert.deepEqual(states, ["REMEDIATE_HIRING_FILE", "CONTINUE_APPLICATION", undefined]);
});

test("an existing driver is never classified as a prospective hire for want of a TES start date", () => {
  assert.equal(classifyHiringContext({ driverStatus: "Active" }), "Existing Driver File Completion");
  assert.equal(classifyHiringContext({ driverStatus: "Terminated" }), "Existing Driver File Completion");
  assert.equal(classifyHiringContext({ driverStatus: "Not Established" }), "Prospective Hire");
  assert.equal(classifyHiringContext(undefined), "Prospective Hire");
});

test("Verified Commercial Experience needs a completed review and correct linkage, not just a document type", () => {
  const a = app();
  const mvr = (over: Partial<Evd> = {}) => evidence({ documentType: "Previous Employer Verification", ...over });
  assert.equal(hasVerifiedExperienceEvidence(a, [mvr()]), true);
  assert.equal(hasVerifiedExperienceEvidence(a, [mvr({ verificationState: "unverified", verifiedBy: undefined, verifiedAt: undefined })]), false);
  assert.equal(hasVerifiedExperienceEvidence(a, [mvr({ verificationState: "Difference Present" })]), false);
  assert.equal(hasVerifiedExperienceEvidence(app({ evidenceIds: [] }), [mvr({ linkedRecordId: "APP-9" })]), false);
  assert.equal(hasVerifiedExperienceEvidence(a, [mvr({ driverMasterId: "DRV-2" })]), false);
  assert.equal(hasVerifiedExperienceEvidence(a, [mvr({ isArchived: true })]), false);
  assert.equal(hasVerifiedExperienceEvidence(a, [evidence({ documentType: "Employment Application" })]), false, "the application itself is not experience verification");
});

test("duplicate prevention: unrelated TES applications are refused; remediation and linked replacement paths are allowed", () => {
  const create = (apps: App[], input: Parameters<typeof checkApplicationCreation>[3], ev: Evd[] = [evidence()]) => checkApplicationCreation(apps, ev, ctx, input);
  const tes = { source: "TES Workflow" } as const;
  // verified, awaiting review, in progress and defective applications all block a fresh TES application
  assert.ok(create([app()], tes));
  assert.ok(create([app()], tes, [evidence({ verificationState: "unverified", verifiedBy: undefined })]));
  assert.ok(create([app({ source: "TES Workflow", status: "Invited", evidenceIds: [] })], tes, []));
  const defective = app({ processing: { status: "Review Required", findingIds: [], fileCompleteness: "Incomplete", qualificationAssessment: "Pending", updatedAt: "" } });
  assert.ok(create([defective], tes));
  // a submitted application flagged "New Application Required" must be replaced through the linked path
  const flagged = app({ findings: [{ id: "F", type: "MISMATCH", status: "New Application Required", subject: "Other", label: "x", evidenceIds: [], createdAt: "", updatedAt: "" }] });
  assert.ok(create([flagged], tes));
  // genuine new workflow: nothing on file, or the only application is dead
  assert.equal(create([], tes, []), undefined);
  assert.equal(create([app({ status: "Rejected" })], tes), undefined);
  // imported / carrier-supplied records are historical records, not invitations
  assert.equal(create([app()], { source: "Imported" }), undefined);
  // remediation: only against a live application of this driver that requires correction
  assert.equal(create([defective], { ...tes, remediatesApplicationId: "APP-1" }), undefined);
  assert.ok(create([app()], { ...tes, remediatesApplicationId: "APP-1" }), "verified application needs no remediation");
  assert.ok(create([defective], { ...tes, remediatesApplicationId: "APP-404" }), "unknown target");
  assert.ok(create([{ ...defective, driverMasterId: "DRV-2" }], { ...tes, remediatesApplicationId: "APP-1" }), "other driver's application");
  // replacement is only valid through createReplacementDriverApplication
  assert.ok(create([defective], { ...tes, replacesApplicationId: "APP-1" }));
});
