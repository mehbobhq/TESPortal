/**
 * TES Master Register — universal event contract (Phase 1 foundation).
 *
 * This module defines the strongly typed shape of every Master Register
 * event. It contains no I/O, no persistence, and no business logic beyond
 * what TypeScript's type system itself enforces — validation of these
 * shapes at runtime lives in record-event.ts.
 *
 * LEGACY SYSTEMS — DO NOT USE AS MASTER REGISTER PERSISTENCE:
 * lib/audit.ts, lib/audit-logger.ts, lib/audit-log.ts, lib/activity-log.ts,
 * and lib/audit-case-store.ts are pre-existing, separate systems (two of
 * which already use the words "Master Register" in their own comments).
 * None of them are append-only in a real sense (several cap/evict entries),
 * all persist to localStorage, and none share this module's schema. They
 * are intentionally left untouched in this phase pending an explicit,
 * separate migration decision — nothing in this module reads from, writes
 * to, or wraps any of them.
 */

import type { MaterialOperationCoverage } from "./coverage.ts";

/** Category of actor attributed to an event. Non-human actors are first-class. */
export type ActorType = "HUMAN" | "SYSTEM" | "AUTOMATION" | "INTEGRATION" | "SERVICE_ACCOUNT";

/**
 * actorId is treated as an immutable, opaque TES identifier — never a
 * display name, email, or role label, and never inferred from one. This
 * phase does not implement authentication/authorization or an actor
 * directory; it only fixes the contract shape so later phases don't have
 * to change every event's structure when real identity arrives.
 */
export interface EventActor {
  actorType: ActorType;
  actorId: string;
}

export interface EventAction {
  verb?: string;
  operation?: string;
}

export interface EventTarget {
  resourceType?: string;
  resourceId?: string;
  companyId?: string;
  companyScope?: string[];
  subjectReferences?: string[];
}

/** Describes where/what originated the event — mandatory context for root events (see record-event.ts). */
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

/**
 * A closed representation of a single field's value at one point in time.
 * Deliberately NOT `unknown`/`any`/a generic object: a MasterRegisterEvent
 * must never carry an entire record, raw OCR text, or any other complex
 * payload as "the value" — only a short literal primitive, or a pointer
 * (REFERENCE/HASH) to where the real value lives, or a bare fact that a
 * value existed/changed without exposing it at all (REDACTED/CHANGED).
 * Each variant has a fixed, closed key set — no `[key: string]: unknown`
 * escape hatch anywhere in this union, so a caller cannot smuggle a nested
 * object in under an otherwise-innocent key.
 */
export type MasterRegisterChangeValue =
  | { kind: "LITERAL"; value: string | number | boolean | null }
  | { kind: "REFERENCE"; reference: string }
  | { kind: "HASH"; algorithm: string; value: string }
  | { kind: "REDACTED" }
  | { kind: "CHANGED" };

/**
 * A single named field's before/after values. Deliberately per-field, not a
 * generic object snapshot: callers cannot pass an entire record as "the
 * change" — they must name each field individually, and each value must be
 * one of the closed MasterRegisterChangeValue shapes above, which is what
 * keeps this a minimal representation rather than a duplicate data store.
 */
export interface FieldChange {
  field: string;
  before?: MasterRegisterChangeValue;
  after?: MasterRegisterChangeValue;
}

export interface ChangeSet {
  changedFields: string[];
  fieldChanges?: FieldChange[];
}

/**
 * References only — never source document contents, raw OCR text, or any
 * other duplicated payload. A reference is an opaque ID/URI a caller can
 * use to fetch the real artifact from its own system of record.
 */
export interface EvidenceReferences {
  evidenceReferences?: string[];
  documentReferences?: string[];
  supportingReferences?: string[];
}

/**
 * Optional, typed causal/operational relationships. None are required on
 * every event — callers populate only what applies — but every relationship
 * TES needs to reconstruct an event graph lives in exactly this one place,
 * never as ad hoc fields bolted onto individual event types.
 */
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

/**
 * Deliberately broad: covers "ran fine with nothing to report"
 * (NO_FINDINGS), "ran but only part of it completed" (PARTIAL_SUCCESS),
 * "didn't run at all when it was expected to" (NOT_EXECUTED), and the
 * explicit "we don't actually know" case (UNKNOWN) — so a caller is never
 * forced to misrepresent an unresolved/unobserved outcome as a clean
 * success. See invariant #10 in the architecture notes: an absence of
 * acquired data must never be recorded in a way that implies the absence
 * of the underlying real-world condition.
 */
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

/**
 * Contract/interface fields only — no cryptographic implementation in this
 * phase. `sequence`/`integrityReference` are reserved so a future phase can
 * add tamper-evidence (e.g. hash chaining) without changing this shape
 * again; they are simply absent/undefined until that phase exists.
 */
export interface EventIntegrity {
  sequence?: number;
  recordedBy?: string;
  integrityReference?: string;
}

/** What a caller supplies to the recording service. Notably absent: eventFamily (derived, never caller-supplied) and recordedAt (server-stamped). */
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
  /** Material-operation coverage (see coverage.ts) — primarily for automation/integration/batch events. */
  coverage?: MaterialOperationCoverage;
  governance?: EventGovernance;
  integrity?: EventIntegrity;
}

/** The full, stored, immutable record — what repository.append() receives and getById()/query*() return. */
export interface MasterRegisterEvent extends MasterRegisterEventInput {
  eventId: string;
  eventFamily: string;
  schemaVersion: number;
  catalogueVersion: number;
  occurredAt: string;
  recordedAt: string;
}
