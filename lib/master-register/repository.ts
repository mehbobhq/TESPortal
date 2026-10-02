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
 */

import type { MasterRegisterEvent } from "./types.ts";

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
