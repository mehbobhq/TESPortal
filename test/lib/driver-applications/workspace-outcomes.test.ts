import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";

let M: typeof import("@/lib/driver-applications/workspace-outcomes");
let INVITATION_DELIVERY_UNCONFIRMED_STATUS: string;
let SUBMISSION_SYNC_COOLDOWN_MS: number;
let SUBMISSION_SYNC_PAUSED_NOTICE: string;
let classifySubmissionSyncStatus: typeof M.classifySubmissionSyncStatus;
let hasUnconfirmedInvitation: typeof M.hasUnconfirmedInvitation;
let interpretInvitationResponse: typeof M.interpretInvitationResponse;
let shouldSkipSubmissionSync: typeof M.shouldSkipSubmissionSync;

before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  M = await import("@/lib/driver-applications/workspace-outcomes");
  ({
    INVITATION_DELIVERY_UNCONFIRMED_STATUS,
    SUBMISSION_SYNC_COOLDOWN_MS,
    SUBMISSION_SYNC_PAUSED_NOTICE,
    classifySubmissionSyncStatus,
    hasUnconfirmedInvitation,
    interpretInvitationResponse,
    shouldSkipSubmissionSync,
  } = M);
});

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("invitation response interpretation", () => {
  it("a 200 with a message id is SENT, and carries the audit flag", () => {
    const outcome = interpretInvitationResponse({ status: 200, body: { messageId: "m1", sentAt: "t", expiresAt: "e", auditRecorded: false } });
    assert.deepEqual(outcome, { kind: "SENT", messageId: "m1", sentAt: "t", expiresAt: "e", auditRecorded: false });
  });

  it("502 delivery UNKNOWN is UNKNOWN, never SENT and never NOT_SENT", () => {
    const outcome = interpretInvitationResponse({ status: 502, body: { error: "may have been sent", delivery: "UNKNOWN", auditRecorded: true } });
    assert.equal(outcome.kind, "UNKNOWN");
  });

  it("502 delivery REJECTED is NOT_SENT with the server's words", () => {
    const outcome = interpretInvitationResponse({ status: 502, body: { error: "refused. Nothing was sent.", delivery: "REJECTED" } });
    assert.deepEqual(outcome, { kind: "NOT_SENT", message: "refused. Nothing was sent." });
  });

  it("pre-send refusals with a JSON error are NOT_SENT", () => {
    for (const status of [400, 401, 403, 404, 422, 503]) {
      assert.equal(interpretInvitationResponse({ status, body: { error: "no" } }).kind, "NOT_SENT", String(status));
    }
  });

  it("anything that cannot establish the outcome is UNKNOWN", () => {
    const cases = [
      { status: 500, body: { error: "x" } },
      { status: 504, body: null },
      { status: 503, body: null },
      { status: 503, body: "<html>gateway</html>" },
      { status: 200, body: {} },
      { status: 200, body: { messageId: "" } },
      { status: 502, body: { error: "x" } },
      { status: 0, body: null, networkError: true },
    ];
    for (const response of cases) assert.equal(interpretInvitationResponse(response).kind, "UNKNOWN", JSON.stringify(response));
  });
});

describe("Send stays closed after an unconfirmed invitation", () => {
  const apps = () => [
    { driverMasterId: "D1", status: INVITATION_DELIVERY_UNCONFIRMED_STATUS },
    { driverMasterId: "D2", status: "Invitation Ready" },
  ];

  it("is per driver and decided only from the persisted application status (survives refresh and remount)", () => {
    assert.equal(hasUnconfirmedInvitation(apps(), "D1"), true);
    assert.equal(hasUnconfirmedInvitation(apps(), "D2"), false);
    assert.equal(hasUnconfirmedInvitation([], "D1"), false);
  });

  it("the workspace records UNKNOWN as its own status, never as Invitation Ready, Invited or a rejection", () => {
    const code = stripComments(read("src/components/drivers/DriverWorkspace.tsx"));
    assert.match(code, /status: unconfirmed \? INVITATION_DELIVERY_UNCONFIRMED_STATUS : "Invitation Ready"/);
    assert.match(code, /if \(hasUnconfirmedInvitation\(applications, master\.id\)\) \{\s*setCreationError\(INVITATION_DELIVERY_UNCONFIRMED_MESSAGE\);\s*return;/);
    assert.match(code, /disabled=\{isSendingApplication \|\| hasUnconfirmedInvitation\(applications, master\.id\)\}/);
    assert.match(code, /data-testid="invitation-delivery-unconfirmed"/);
    assert.equal(/setTimeout|setInterval/.test(code.slice(code.indexOf("handleCreateApplication"), code.indexOf("handleCreateHiringPackage"))), false, "no automatic retry");
  });

  it("the hiring workflow never offers Send while a delivery is unconfirmed", () => {
    const code = stripComments(read("lib/driver-data.ts"));
    const unconfirmedBranch = code.indexOf("INVITATION_DELIVERY_UNCONFIRMED_STATUS)) {");
    const sendBranch = code.indexOf('nextAction = "SEND_APPLICATION"');
    assert.ok(unconfirmedBranch > 0 && unconfirmedBranch < sendBranch);
    assert.match(code.slice(unconfirmedBranch, sendBranch), /nextAction = "CONTINUE_APPLICATION"/);
  });

  it("the new status exists in the type", () => {
    assert.match(read("types/drivers.ts"), /\| "Invitation Delivery Unconfirmed"/);
  });
});

describe("paused applicant submissions are visible, not silent", () => {
  it("classifies 2xx as OK, 503 as PAUSED, everything else as FAILED", () => {
    assert.equal(classifySubmissionSyncStatus(200), "OK");
    assert.equal(classifySubmissionSyncStatus(503), "PAUSED");
    for (const status of [401, 403, 500, 502]) assert.equal(classifySubmissionSyncStatus(status), "FAILED");
  });

  it("the notice does not imply applicants have not responded", () => {
    assert.match(SUBMISSION_SYNC_PAUSED_NOTICE, /does not mean the applicant has not responded/);
    assert.match(SUBMISSION_SYNC_PAUSED_NOTICE, /temporarily unavailable/);
  });

  it("does not poll again during the cool-down, and resumes after it", () => {
    const now = 1_000_000;
    assert.equal(shouldSkipSubmissionSync(now, now - 1000), true);
    assert.equal(shouldSkipSubmissionSync(now, now - SUBMISSION_SYNC_COOLDOWN_MS), false);
    assert.equal(shouldSkipSubmissionSync(now, null), false);
    assert.equal(shouldSkipSubmissionSync(now, now + 5000), false);
  });

  it("the workspace shows the notice on 503 and still ingests nothing, invents nothing and clears no drafts", () => {
    const code = stripComments(read("src/components/drivers/DriverWorkspace.tsx"));
    const reconcile = code.slice(code.indexOf("const reconcileSubmittedApplications"), code.indexOf("void reconcileSubmittedApplications"));
    assert.match(reconcile, /syncState === "PAUSED"[\s\S]*setSubmissionSyncPaused\(true\)[\s\S]*return\b/);
    assert.ok(reconcile.indexOf("PAUSED") < reconcile.indexOf("ingestApplicantSubmissionSnapshot"), "ingest only after an OK response");
    assert.equal(/localStorage/.test(reconcile), false, "drafts are not touched");
    assert.match(code, /data-testid="submission-sync-paused"/);
    assert.match(code, /SUBMISSION_SYNC_PAUSED_NOTICE/);
  });
});
