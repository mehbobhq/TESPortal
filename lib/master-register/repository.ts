/**
 * TES Master Register — production-agnostic repository contract.
 *
 * This is an interface only. No implementation lives in this module, and no
 * production persistence is implemented in this phase: no localStorage, no
 * IndexedDB, no filesystem/JSON, nothing. A real adapter (the actual
 * production database) is a separate, later decision.
 *
 * Deliberately excluded: update(), delete(), replace(). The Master Register
 * is append-only — there is no method here a caller could use to mutate or
 * remove a recorded event, by construction, not by convention. A correction
 * is always a new event (invariant #6), never an edit to history.
 *
 * append() MUST create a new immutable ledger entry and nothing else. If
 * `event.eventId` already exists in the underlying store, append() MUST
 * reject (throw/reject its Promise with a DuplicateEventError, or a
 * subclass of it) rather than overwrite, update, replace, merge, or silently
 * upsert the existing record. This closes the one loophole a naive
 * implementation could otherwise introduce: nothing in the method signature
 * alone (it accepts a complete event, including its id) stops a careless
 * adapter from treating a repeated eventId as an update — this requirement
 * makes that behavior a contract violation, not just bad practice.
 */

import type { MasterRegisterEvent } from "./types.ts";

/** Implementations must throw this (or a subclass) from append() when `event.eventId` already exists — never overwrite. */
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
  queryByCompanyId(companyId: string): Promise<MasterRegisterEvent[]>;
  queryByActorId(actorId: string): Promise<MasterRegisterEvent[]>;
  queryByAssessmentId(assessmentId: string): Promise<MasterRegisterEvent[]>;
  queryByAutomationRunId(automationRunId: string): Promise<MasterRegisterEvent[]>;
  queryByIntegrationOperationId(integrationOperationId: string): Promise<MasterRegisterEvent[]>;
}
