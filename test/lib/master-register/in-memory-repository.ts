/**
 * TEST-ONLY in-memory Master Register repository adapter.
 *
 * This exists solely so tests can exercise the repository contract without
 * production persistence. It is deliberately NOT exported from
 * lib/master-register and must never be imported by application code.
 */

import { DuplicateEventError } from "../../../lib/master-register/repository.ts";
import type { MasterRegisterRepository } from "../../../lib/master-register/repository.ts";
import type { MasterRegisterEvent } from "../../../lib/master-register/types.ts";

export class InMemoryMasterRegisterRepository implements MasterRegisterRepository {
  private readonly events: MasterRegisterEvent[] = [];
  private readonly eventIds = new Set<string>();

  async append(event: MasterRegisterEvent): Promise<MasterRegisterEvent> {
    if (this.eventIds.has(event.eventId)) {
      throw new DuplicateEventError(event.eventId);
    }
    this.eventIds.add(event.eventId);
    this.events.push(event);
    return event;
  }

  async getById(eventId: string): Promise<MasterRegisterEvent | undefined> {
    return this.events.find((event) => event.eventId === eventId);
  }

  async queryByCorrelationId(correlationId: string): Promise<MasterRegisterEvent[]> {
    return this.events.filter((event) => event.relationships?.correlationId === correlationId);
  }

  async queryByCustomerId(customerId: string): Promise<MasterRegisterEvent[]> {
    return this.events.filter((event) => event.target?.customerId === customerId);
  }

  async queryByActorId(actorId: string): Promise<MasterRegisterEvent[]> {
    return this.events.filter((event) => event.actor.actorId === actorId);
  }

  async queryByAssessmentId(assessmentId: string): Promise<MasterRegisterEvent[]> {
    return this.events.filter((event) => event.relationships?.assessmentId === assessmentId);
  }

  async queryByAutomationRunId(automationRunId: string): Promise<MasterRegisterEvent[]> {
    return this.events.filter((event) => event.relationships?.automationRunId === automationRunId);
  }

  async queryByIntegrationOperationId(integrationOperationId: string): Promise<MasterRegisterEvent[]> {
    return this.events.filter((event) => event.relationships?.integrationOperationId === integrationOperationId);
  }

  /** Test-only escape hatch to inspect raw stored count/contents. Not part of the production repository interface. */
  all(): readonly MasterRegisterEvent[] {
    return this.events;
  }
}
