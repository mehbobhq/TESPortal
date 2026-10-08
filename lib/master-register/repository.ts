import type { MasterRegisterEvent } from "./types.ts";

export class DuplicateEventError extends Error {
  constructor(eventId: string) {
    super(`An event with eventId "${eventId}" has already been appended to the Master Register. append() never overwrites an existing event.`);
    this.name = "DuplicateEventError";
  }
}

export interface MasterRegisterRepository {
  append(event: MasterRegisterEvent): Promise<MasterRegisterEvent>;
  getById(eventId: string): Promise<MasterRegisterEvent | undefined>;
  queryByCorrelationId(correlationId: string): Promise<MasterRegisterEvent[]>;
  queryByCustomerId(customerId: string): Promise<MasterRegisterEvent[]>;
  queryByActorId(actorId: string): Promise<MasterRegisterEvent[]>;
  queryByAssessmentId(assessmentId: string): Promise<MasterRegisterEvent[]>;
  queryByAutomationRunId(automationRunId: string): Promise<MasterRegisterEvent[]>;
  queryByIntegrationOperationId(integrationOperationId: string): Promise<MasterRegisterEvent[]>;
}
