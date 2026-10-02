import test from "node:test";
import assert from "node:assert/strict";

import { recordEvent } from "../../../lib/master-register/record-event.ts";
import type { MasterRegisterEventInput } from "../../../lib/master-register/types.ts";
import { InMemoryMasterRegisterRepository } from "./in-memory-repository.ts";

function input(overrides: Partial<MasterRegisterEventInput> = {}): MasterRegisterEventInput {
  return {
    eventType: "RECORD_CREATED",
    actor: { actorType: "HUMAN", actorId: "USR-TEST-1" },
    source: { sourceType: "web-app", component: "companies-page" },
    ...overrides,
  };
}

test("repository has no update/delete/replace API on the concrete test adapter", () => {
  const repository = new InMemoryMasterRegisterRepository() as unknown as Record<string, unknown>;
  assert.equal(typeof repository.update, "undefined");
  assert.equal(typeof repository.delete, "undefined");
  assert.equal(typeof repository.replace, "undefined");
});

test("append never mutates a previously appended event object", async () => {
  const repository = new InMemoryMasterRegisterRepository();
  const event = await recordEvent(repository, input());
  const snapshotBefore = JSON.stringify(event);
  await recordEvent(repository, input({ eventType: "RECORD_UPDATED" }));
  assert.equal(JSON.stringify(event), snapshotBefore);
  assert.equal(repository.all().length, 2);
});

test("correlation queries return exactly the events sharing that correlationId", async () => {
  const repository = new InMemoryMasterRegisterRepository();
  const a = await recordEvent(repository, input({ relationships: { correlationId: "corr-A" } }));
  const b = await recordEvent(repository, input({ relationships: { correlationId: "corr-A" } }));
  await recordEvent(repository, input({ relationships: { correlationId: "corr-B" } }));

  const results = await repository.queryByCorrelationId("corr-A");
  assert.deepEqual(
    results.map((e) => e.eventId).sort(),
    [a.eventId, b.eventId].sort(),
  );
});

test("assessment queries return exactly the events referencing that assessmentId", async () => {
  const repository = new InMemoryMasterRegisterRepository();
  const match = await recordEvent(
    repository,
    input({ eventType: "COMPLIANCE_ASSESSMENT_COMPLETED", relationships: { assessmentId: "ASMT-99" } }),
  );
  await recordEvent(repository, input({ relationships: { assessmentId: "ASMT-OTHER" } }));

  const results = await repository.queryByAssessmentId("ASMT-99");
  assert.equal(results.length, 1);
  assert.equal(results[0]!.eventId, match.eventId);
});

test("automationRunId queries return exactly the events referencing that run", async () => {
  const repository = new InMemoryMasterRegisterRepository();
  const started = await recordEvent(
    repository,
    input({ eventType: "AUTOMATION_EXECUTION_STARTED", relationships: { automationRunId: "RUN-1" } }),
  );
  const completed = await recordEvent(
    repository,
    input({ eventType: "AUTOMATION_EXECUTION_COMPLETED", relationships: { automationRunId: "RUN-1" }, outcome: { result: "NO_FINDINGS" } }),
  );
  await recordEvent(repository, input({ eventType: "AUTOMATION_EXECUTION_STARTED", relationships: { automationRunId: "RUN-2" } }));

  const results = await repository.queryByAutomationRunId("RUN-1");
  assert.deepEqual(
    results.map((e) => e.eventId).sort(),
    [started.eventId, completed.eventId].sort(),
  );
});

test("integrationOperationId queries return exactly the events referencing that operation", async () => {
  const repository = new InMemoryMasterRegisterRepository();
  const match = await recordEvent(
    repository,
    input({ eventType: "INTEGRATION_OPERATION_COMPLETED", relationships: { integrationOperationId: "OP-1" } }),
  );
  await recordEvent(repository, input({ eventType: "INTEGRATION_OPERATION_STARTED", relationships: { integrationOperationId: "OP-2" } }));

  const results = await repository.queryByIntegrationOperationId("OP-1");
  assert.equal(results.length, 1);
  assert.equal(results[0]!.eventId, match.eventId);
});

test("company and actor queries work as a minimum query surface beyond the relationship-ID queries", async () => {
  const repository = new InMemoryMasterRegisterRepository();
  const event = await recordEvent(
    repository,
    input({ target: { resourceType: "Company", resourceId: "CMP-1", companyId: "CMP-1" } }),
  );

  const byCompany = await repository.queryByCompanyId("CMP-1");
  assert.equal(byCompany[0]?.eventId, event.eventId);

  const byActor = await repository.queryByActorId("USR-TEST-1");
  assert.equal(byActor[0]?.eventId, event.eventId);
});
