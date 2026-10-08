/**
 * TES Master Register — universal event contract (Phase 1 foundation).
 *
 * This module defines the strongly typed shape of every Master Register
 * event. It contains no I/O, no persistence, and no business logic beyond
 * what TypeScript's type system itself enforces — validation of these
 * shapes at runtime lives in record-event.ts.
 */

import type { MaterialOperationCoverage } from "./coverage.ts";

export type ActorType = "HUMAN" | "SYSTEM" | "AUTOMATION" | "INTEGRATION" | "SERVICE_ACCOUNT";

export interface EventActor {
  actorType: ActorType;
  actorId: string;
}

export interface EventAction {
  verb?: string;
  operation?: string;
}

/**
 * Four identities remain deliberately separate:
 * - actor: who/what acted
 * - customerId: canonical TES tenant/business context (customers.id)
 * - resourceType + resourceId: exact affected record
 * - subjectReferences: entities the resource/event concerns
 */
export interface EventTarget {
  resourceType?: string;
  resourceId?: string;
  customerId?: string;
  subjectReferences?: string[];
}

export interface EventSource {
  sourceType: string;
  component?: string;
  workflow?: string;
  sessionId?: string;
  requestId?: string;
}

export type Sensitivity = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
export type Materiality = "ROUTINE" | "NOTABLE" | "MATERIAL" | "CRITICAL";
export type EventSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface EventClassification {
  sensitivity?: Sensitivity;
  securityRelevance?: boolean;
  materiality?: Materiality;
  eventSeverity?: EventSeverity;
}

export type MasterRegisterChangeValue =
  | { kind: "LITERAL"; value: string | number | boolean | null }
  | { kind: "REFERENCE"; reference: string }
  | { kind: "HASH"; algorithm: string; value: string }
  | { kind: "REDACTED" }
  | { kind: "CHANGED" };

export interface FieldChange {
  field: string;
  before?: MasterRegisterChangeValue;
  after?: MasterRegisterChangeValue;
}

export interface ChangeSet {
  changedFields: string[];
  fieldChanges?: FieldChange[];
}

export interface EvidenceReferences {
  evidenceReferences?: string[];
  documentReferences?: string[];
  supportingReferences?: string[];
}

export interface EventRelationships {
  correlationId?: string;
  causationEventId?: string;
  parentEventId?: string;
  relatedEventIds?: string[];
  workflowId?: string;
  taskId?: string;
  assignmentId?: string;
  assessmentId?: string;
  automationRunId?: string;
  integrationOperationId?: string;
  processingRunId?: string;
  reviewId?: string;
  investigationId?: string;
  batchId?: string;
}

export type OutcomeResult =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "NO_FINDINGS"
  | "FAILURE"
  | "NOT_EXECUTED"
  | "UNRESOLVED"
  | "UNKNOWN";

export interface EventOutcome {
  result: OutcomeResult;
  reasonCode?: string;
  reason?: string;
  failureReference?: string;
}

export interface EventGovernance {
  retentionClass?: string;
  accessClassification?: string;
  legalGovernanceMarkers?: string[];
}

export interface EventIntegrity {
  sequence?: number;
  recordedBy?: string;
  integrityReference?: string;
}

export interface MasterRegisterEventInput {
  eventType: string;
  actor: EventActor;
  occurredAt?: string;
  action?: EventAction;
  target?: EventTarget;
  source: EventSource;
  classification?: EventClassification;
  change?: ChangeSet;
  evidence?: EvidenceReferences;
  relationships?: EventRelationships;
  outcome?: EventOutcome;
  coverage?: MaterialOperationCoverage;
  governance?: EventGovernance;
  integrity?: EventIntegrity;
}

export interface MasterRegisterEvent extends MasterRegisterEventInput {
  eventId: string;
  eventFamily: string;
  schemaVersion: number;
  catalogueVersion: number;
  occurredAt: string;
  recordedAt: string;
}
