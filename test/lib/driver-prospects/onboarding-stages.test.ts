import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveOnboarding, ONBOARDING_STAGES } from "@/lib/driver-prospects/onboarding-stages";

const e = (eventType: string, at: string, toStatus: string | null = null) => ({ eventType, toStatus, occurredAt: `2026-03-0${at}T10:00:00.000Z` });
const labels = (p: ReturnType<typeof deriveOnboarding>) => p.stages.map((s) => `${s.state[0]}`).join("");

describe("onboarding stage chronology (derived only from recorded events)", () => {
  it("has the five stages in order", () => {
    assert.deepEqual(ONBOARDING_STAGES.map((s) => s.label), ["Application Sent", "Application Opened", "Application Submitted", "Pre-Employment Verification", "Hiring Package"]);
  });
  it("shows 'Not sent' before any invitation was delivered, with every stage pending", () => {
    const p = deriveOnboarding({ status: "PROSPECT", relationshipStatus: null, events: [e("PROSPECT_CREATED", "1"), e("INVITATION_CREATED", "1"), e("INVITATION_FAILED", "1")] });
    assert.equal(p.currentLabel, "Not sent");
    assert.equal(labels(p), "PPPPP");
    assert.equal(p.onboarding, true);
  });
  it("advances only as events are recorded, keeping each timestamp", () => {
    const sent = [e("INVITATION_SENT", "2")];
    assert.equal(deriveOnboarding({ status: "INVITED", relationshipStatus: null, events: sent }).currentLabel, "Application Sent");
    const opened = [...sent, e("APPLICATION_OPENED", "3")];
    const p2 = deriveOnboarding({ status: "INVITED", relationshipStatus: null, events: opened });
    assert.equal(p2.currentLabel, "Application Opened");
    assert.equal(labels(p2), "DCPPP");
    assert.equal(p2.stages[1].at, "2026-03-03T10:00:00.000Z");
    const submitted = [...opened, e("APPLICATION_SUBMITTED", "4")];
    assert.equal(deriveOnboarding({ status: "APPLICATION_SUBMITTED", relationshipStatus: null, events: submitted }).currentLabel, "Application Submitted");
    const review = [...submitted, e("STATUS_CHANGED", "5", "UNDER_REVIEW")];
    assert.equal(deriveOnboarding({ status: "UNDER_REVIEW", relationshipStatus: null, events: review }).currentLabel, "Pre-Employment Verification");
    const approved = [...review, e("STATUS_CHANGED", "6", "APPROVED")];
    const p5 = deriveOnboarding({ status: "APPROVED", relationshipStatus: null, events: approved });
    assert.equal(p5.currentLabel, "Hiring Package");
    assert.equal(labels(p5), "DDDDC");
  });
  it("a resent invitation does not inherit an earlier 'opened' event", () => {
    const p = deriveOnboarding({ status: "INVITED", relationshipStatus: null, events: [e("INVITATION_SENT", "2"), e("APPLICATION_OPENED", "3"), e("INVITATION_SENT", "4")] });
    assert.equal(p.currentLabel, "Application Sent");
  });
  it("is not onboarding once rejected, withdrawn or activated (history is kept, the chronology is not shown)", () => {
    for (const status of ["REJECTED", "WITHDRAWN"] as const) assert.equal(deriveOnboarding({ status, relationshipStatus: null, events: [e("INVITATION_SENT", "2")] }).onboarding, false);
    assert.equal(deriveOnboarding({ status: "APPROVED", relationshipStatus: "ACTIVE", events: [e("STATUS_CHANGED", "6", "APPROVED")] }).onboarding, false);
    assert.equal(deriveOnboarding({ status: "APPROVED", relationshipStatus: "ONBOARDING", events: [e("STATUS_CHANGED", "6", "APPROVED")] }).onboarding, true);
  });
  it("an invitation revoked after it was sent (scope change or failed resend) is not 'Application Sent'", () => {
    const p = deriveOnboarding({ status: "INVITED", relationshipStatus: null, events: [e("INVITATION_SENT", "2"), e("APPLICATION_OPENED", "3"), e("INVITATION_REVOKED", "4")] });
    assert.equal(p.currentLabel, "Not sent");
    const again = deriveOnboarding({ status: "INVITED", relationshipStatus: null, events: [e("INVITATION_SENT", "2"), e("INVITATION_REVOKED", "4"), e("INVITATION_SENT", "5")] });
    assert.equal(again.currentLabel, "Application Sent");
  });
});
