import test from "node:test";
import assert from "node:assert/strict";

import {
  ForbiddenFamilyOverrideError,
  ForbiddenSensitivePayloadError,
  InvalidChangeSetError,
  RootEventSourceError,
  buildMasterRegisterEvent,
  recordEvent,
} from "../../../lib/master-register/record-event.ts";
import { InvalidActorError } from "../../../lib/master-register/actor-identity.ts";
import { InvalidCoverageError } from "../../../lib/master-register/coverage.ts";
import { UnregisteredEventTypeError } from "../../../lib/master-register/event-types.ts";
import type { MasterRegisterEventInput } from "../../../lib/master-register/types.ts";
import { InMemoryMasterRegisterRepository } from "./in-memory-repository.ts";

function validInput(overrides: Partial<MasterRegisterEventInput> = {}): MasterRegisterEventInput {
  return {
    eventType: "RECORD_CREATED",
    actor: { actorType: "HUMAN", actorId: "USR-TEST-1" },
    source: { sourceType: "web-app", component: "companies-page" },
    ...overrides,
  };
}

test("unknown event type is rejected by construction", () => {
  assert.throws(() => buildMasterRegisterEvent(validInput({ eventType: "NOT_REGISTERED" })), UnregisteredEventTypeError);
});

test("caller cannot override event family, even via a loosely-typed/`as any` input", () => {
  const input = { ...validInput(), eventFamily: "SECURITY" } as unknown as MasterRegisterEventInput;
  assert.throws(() => buildMasterRegisterEvent(input), ForbiddenFamilyOverrideError);
});

test("append succeeds for a valid event, and the derived family is attached", async () => {
  const repository = new InMemoryMasterRegisterRepository();
  const event = await recordEvent(repository, validInput());
  assert.equal(event.eventFamily, "RECORD_DATA");
  assert.equal((await repository.getById(event.eventId))?.eventId, event.eventId);
});

test("event IDs are unique across generated events", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const event = buildMasterRegisterEvent(validInput());
    ids.add(event.eventId);
  }
  assert.equal(ids.size, 200);
});

test("occurredAt and recordedAt semantics are preserved: a caller-supplied occurredAt is kept distinct from the server-stamped recordedAt", () => {
  const backdated = "2020-01-01T00:00:00.000Z";
  const event = buildMasterRegisterEvent(validInput({ occurredAt: backdated }));
  assert.equal(event.occurredAt, backdated);
  assert.notEqual(event.recordedAt, backdated);
  assert.ok(!Number.isNaN(new Date(event.recordedAt).getTime()));
  assert.ok(new Date(event.recordedAt).getTime() > new Date(backdated).getTime());
});

test("occurredAt defaults to recordedAt when the caller does not supply one", () => {
  const event = buildMasterRegisterEvent(validInput());
  assert.equal(event.occurredAt, event.recordedAt);
});

test("an invalid occurredAt value is rejected", () => {
  assert.throws(() => buildMasterRegisterEvent(validInput({ occurredAt: "not-a-date" })));
});

test("actorId is required for an attributable actor", () => {
  const input = validInput({ actor: { actorType: "HUMAN", actorId: "" } });
  assert.throws(() => buildMasterRegisterEvent(input), InvalidActorError);
});

test("an unrecognized actorType is rejected", () => {
  const input = { ...validInput(), actor: { actorType: "ROBOT", actorId: "X" } } as unknown as MasterRegisterEventInput;
  assert.throws(() => buildMasterRegisterEvent(input), InvalidActorError);
});

test("non-human actors carry their own specific actorId", () => {
  const event = buildMasterRegisterEvent(
    validInput({ actor: { actorType: "AUTOMATION", actorId: "AUTOMATION-NIGHTLY-REMINDER" } }),
  );
  assert.equal(event.actor.actorType, "AUTOMATION");
  assert.equal(event.actor.actorId, "AUTOMATION-NIGHTLY-REMINDER");
});

test("a root event (no causationEventId/parentEventId) must identify initiating context beyond the bare sourceType", () => {
  const input = validInput({ source: { sourceType: "web-app" } });
  assert.throws(() => buildMasterRegisterEvent(input), RootEventSourceError);
});

test("a non-root event (has a causationEventId) does not require additional source context", () => {
  const input = validInput({
    source: { sourceType: "web-app" },
    relationships: { causationEventId: "11111111-1111-1111-1111-111111111111" },
  });
  assert.doesNotThrow(() => buildMasterRegisterEvent(input));
});

test("relationship references survive round-trip through construction unchanged", () => {
  const relationships = {
    correlationId: "corr-1",
    causationEventId: "11111111-1111-1111-1111-111111111111",
    parentEventId: "22222222-2222-2222-2222-222222222222",
    relatedEventIds: ["33333333-3333-3333-3333-333333333333"],
    workflowId: "wf-1",
    taskId: "task-1",
    assignmentId: "assign-1",
    assessmentId: "asmt-1",
    automationRunId: "run-1",
    integrationOperationId: "intop-1",
    processingRunId: "proc-1",
    reviewId: "review-1",
    investigationId: "inv-1",
    batchId: "batch-1",
  };
  const event = buildMasterRegisterEvent(validInput({ relationships }));
  assert.deepEqual(event.relationships, relationships);
});

test("coverage rejects negative/impossible counts", () => {
  assert.throws(
    () =>
      buildMasterRegisterEvent(
        validInput({
          eventType: "AUTOMATION_EXECUTION_COMPLETED",
          coverage: { expectedCount: 10, attemptedCount: -1, succeededCount: 0, failedCount: 0, unresolvedCount: 0 },
        }),
      ),
    InvalidCoverageError,
  );
  assert.throws(
    () =>
      buildMasterRegisterEvent(
        validInput({
          eventType: "AUTOMATION_EXECUTION_COMPLETED",
          coverage: { expectedCount: 5, attemptedCount: 5, succeededCount: 5, failedCount: 5, unresolvedCount: 0 },
        }),
      ),
    InvalidCoverageError,
  );
});

test("partial coverage is representable", () => {
  const event = buildMasterRegisterEvent(
    validInput({
      eventType: "AUTOMATION_EXECUTION_COMPLETED",
      outcome: { result: "PARTIAL_SUCCESS" },
      coverage: { expectedCount: 10, attemptedCount: 7, succeededCount: 4, failedCount: 1, unresolvedCount: 2 },
    }),
  );
  assert.equal(event.outcome?.result, "PARTIAL_SUCCESS");
  assert.equal(event.coverage?.unresolvedCount, 2);
});

test("zero findings after successful execution is representable, and is distinguishable from failed execution", () => {
  const cleanRun = buildMasterRegisterEvent(
    validInput({
      eventType: "AUTOMATION_EXECUTION_COMPLETED",
      outcome: { result: "NO_FINDINGS" },
      coverage: { expectedCount: 50, attemptedCount: 50, succeededCount: 50, failedCount: 0, unresolvedCount: 0 },
    }),
  );
  const failedRun = buildMasterRegisterEvent(
    validInput({
      eventType: "AUTOMATION_EXECUTION_FAILED",
      outcome: { result: "FAILURE", reasonCode: "TIMEOUT" },
    }),
  );
  assert.equal(cleanRun.eventType, "AUTOMATION_EXECUTION_COMPLETED");
  assert.equal(cleanRun.outcome?.result, "NO_FINDINGS");
  assert.equal(failedRun.eventType, "AUTOMATION_EXECUTION_FAILED");
  assert.equal(failedRun.outcome?.result, "FAILURE");
  assert.notEqual(cleanRun.eventType, failedRun.eventType);
});

test("missed automation execution is representable as its own distinct event type", () => {
  const missed = buildMasterRegisterEvent(
    validInput({ eventType: "AUTOMATION_EXPECTED_EXECUTION_MISSED", outcome: { result: "NOT_EXECUTED" } }),
  );
  assert.equal(missed.eventType, "AUTOMATION_EXPECTED_EXECUTION_MISSED");
  assert.equal(missed.outcome?.result, "NOT_EXECUTED");
});

test("forbidden sensitive payload keys are rejected, even when smuggled past the type system", () => {
  const input = {
    ...validInput(),
    target: { resourceType: "Credential", resourceId: "abc", password: "hunter2" },
  } as unknown as MasterRegisterEventInput;
  assert.throws(() => buildMasterRegisterEvent(input), ForbiddenSensitivePayloadError);
});

test("forbidden sensitive payload keys are rejected when nested under change.fieldChanges", () => {
  const input = {
    ...validInput(),
    change: { changedFields: ["apiKey"], fieldChanges: [{ field: "apiKey", after: { apiKey: "sk-live-xyz" } }] },
  } as unknown as MasterRegisterEventInput;
  assert.throws(() => buildMasterRegisterEvent(input), ForbiddenSensitivePayloadError);
});

test("sensitive key variants are rejected regardless of casing/separator style", () => {
  const forbiddenKeys = [
    "password",
    "passwd",
    "secret",
    "secrets",
    "token",
    "apiKey",
    "api_key",
    "privateKey",
    "private_key",
    "credential",
    "credentials",
    "accessToken",
    "refresh_token",
    "creditCardNumber",
  ];
  for (const key of forbiddenKeys) {
    const input = { ...validInput(), target: { resourceType: "X", [key]: "value" } } as unknown as MasterRegisterEventInput;
    assert.throws(() => buildMasterRegisterEvent(input), ForbiddenSensitivePayloadError, `expected "${key}" to be rejected`);
  }
});

test("a legitimate key that merely contains a forbidden substring is NOT rejected (token-based matching, not substring matching)", () => {
  const legitimateKeys = ["secretary", "tokenize", "secretariat", "keynote"];
  for (const key of legitimateKeys) {
    const input = { ...validInput(), target: { resourceType: "X", [key]: "value" } } as unknown as MasterRegisterEventInput;
    assert.doesNotThrow(() => buildMasterRegisterEvent(input), `expected "${key}" to NOT be rejected`);
  }
});

test("raw arbitrary full-record snapshots are not accepted through an unrestricted generic payload object on ChangeSet", () => {
  const input = {
    ...validInput(),
    change: { changedFields: ["name"], snapshot: { name: "Acme Corp", ssnOnFile: "123-45-6789" } },
  } as unknown as MasterRegisterEventInput;
  assert.throws(() => buildMasterRegisterEvent(input), InvalidChangeSetError);
});

test("COMPLIANCE_ASSESSMENT_COMPLETED can reference a report, coverage, and an assessment ID together", () => {
  const event = buildMasterRegisterEvent(
    validInput({
      eventType: "COMPLIANCE_ASSESSMENT_COMPLETED",
      target: { resourceType: "Company", resourceId: "CMP-1", companyId: "CMP-1" },
      evidence: { documentReferences: ["assessment-report-ref-1"] },
      relationships: { assessmentId: "ASMT-1" },
      coverage: { expectedCount: 12, attemptedCount: 12, succeededCount: 12, failedCount: 0, unresolvedCount: 0 },
      outcome: { result: "SUCCESS" },
    }),
  );
  assert.equal(event.relationships?.assessmentId, "ASMT-1");
  assert.deepEqual(event.evidence?.documentReferences, ["assessment-report-ref-1"]);
  assert.equal(event.coverage?.expectedCount, 12);
});

test("investigation events are not automatically generated by a security event", async () => {
  const repository = new InMemoryMasterRegisterRepository();
  await recordEvent(
    repository,
    validInput({
      eventType: "SECURITY_ANOMALY_DETECTED",
      classification: { securityRelevance: true },
      source: { sourceType: "web-app", component: "audit-log" },
    }),
  );
  const stored = repository.all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.eventType, "SECURITY_ANOMALY_DETECTED");
  assert.ok(!stored.some((event) => event.eventFamily === "INVESTIGATION"));
});
