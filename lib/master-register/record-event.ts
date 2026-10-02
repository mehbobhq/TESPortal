/**
 * TES Master Register — the one controlled event-construction/recording
 * service. UI/pages/components must never construct or persist Master
 * Register events directly; everything goes through here.
 *
 * Construction (buildMasterRegisterEvent) and persistence (recordEvent's use
 * of the repository) are deliberately separate functions so each can be
 * tested independently of the other, per the Phase 1 scope.
 *
 * SERVER-ONLY NOTE: this file intentionally does NOT import the `server-only`
 * marker package itself — doing so would make this module throw under plain
 * `node --test` (the `server-only` package only becomes a no-op under
 * Next.js's "react-server" bundler condition; under plain Node it throws
 * unconditionally), which would break the test suite's established
 * convention of importing and exercising this module directly. The guard
 * instead lives on server.ts, the actual entry point real application code
 * must import from to record events — index.ts does not re-export this
 * module either, so no barrel import can hand a client component a callable
 * write path. See server.ts for the enforced boundary.
 */

import { randomUUID } from "node:crypto";

import { validateActor } from "./actor-identity.ts";
import { validateCoverage } from "./coverage.ts";
import { CATALOGUE_VERSION, getEventTypeDefinition, isRegisteredEventType, UnregisteredEventTypeError } from "./event-types.ts";
import { HASH_ALGORITHM_MAX_LENGTH, HASH_VALUE_MAX_LENGTH, IDENTIFIER_MAX_LENGTH, REFERENCE_MAX_LENGTH, SHORT_TEXT_MAX_LENGTH } from "./limits.ts";
import type { MasterRegisterRepository } from "./repository.ts";
import type { ChangeSet, MasterRegisterEvent, MasterRegisterEventInput } from "./types.ts";

export class ForbiddenFamilyOverrideError extends Error {
  constructor() {
    super("Callers must not supply eventFamily. It is derived exclusively from the registered eventType.");
    this.name = "ForbiddenFamilyOverrideError";
  }
}

export class ForbiddenSensitivePayloadError extends Error {
  constructor(keyPath: string) {
    super(`Field "${keyPath}" looks like a forbidden sensitive key (password/secret/token/credential/etc.) and cannot be recorded in the Master Register.`);
    this.name = "ForbiddenSensitivePayloadError";
  }
}

export class InvalidChangeSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChangeSetError";
  }
}

export class RootEventSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RootEventSourceError";
  }
}

export class InvalidOccurredAtError extends Error {
  constructor(value: unknown) {
    super(`occurredAt must be a valid ISO 8601 date string, got ${JSON.stringify(value)}.`);
    this.name = "InvalidOccurredAtError";
  }
}

export class InvalidFieldLengthError extends Error {
  constructor(fieldPath: string, maxLength: number, actualLength: number) {
    super(`"${fieldPath}" must not exceed ${maxLength} characters (got ${actualLength}).`);
    this.name = "InvalidFieldLengthError";
  }
}

/**
 * Whole tokens that are forbidden by themselves, after tokenization (so
 * "secret" is forbidden, but "secretary" — a single token, since it has no
 * camelCase/underscore boundary to split on — is not). Includes a few
 * already-concatenated forms (e.g. "apikey") for keys written without a
 * separator at all.
 */
const FORBIDDEN_SINGLE_TOKENS = new Set([
  "password",
  "passwd",
  "secret",
  "secrets",
  "passphrase",
  "token",
  "tokens",
  "credential",
  "credentials",
  "ssn",
  "cvv",
  "cvc",
  "apikey",
  "privatekey",
  "accesskey",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "bearertoken",
  "creditcard",
  "cardnumber",
  "bankaccount",
  "routingnumber",
  "socialsecurity",
]);

/** Pairs of adjacent tokens that, together, form a forbidden compound (e.g. "api" + "key"). Neither token alone is necessarily forbidden. */
const FORBIDDEN_TOKEN_BIGRAMS = new Set([
  "api|key",
  "private|key",
  "access|key",
  "access|token",
  "refresh|token",
  "session|token",
  "bearer|token",
  "credit|card",
  "card|number",
  "bank|account",
  "routing|number",
  "social|security",
]);

/**
 * Splits a field name into lowercase tokens on camelCase boundaries,
 * underscores, and hyphens — e.g. "apiKey"/"api_key"/"API-Key" all tokenize
 * to ["api", "key"], while "secretary" (no boundary) stays a single token
 * ["secretary"]. Matching then operates on these tokens, never on raw
 * substring occurrence, so a legitimate word that merely contains a
 * forbidden substring is never rejected.
 */
function tokenizeKey(key: string): string[] {
  const withBoundaries = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
  return withBoundaries
    .split(/[_\-\s]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);
}

function isForbiddenKey(key: string): boolean {
  const tokens = tokenizeKey(key);
  if (tokens.some((token) => FORBIDDEN_SINGLE_TOKENS.has(token))) return true;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (FORBIDDEN_TOKEN_BIGRAMS.has(`${tokens[i]}|${tokens[i + 1]}`)) return true;
  }
  return false;
}

/**
 * Recursively scans an arbitrary input's own keys for anything that looks
 * like a forbidden sensitive field name. Depth-limited so a pathological
 * input can't force unbounded recursion; Master Register inputs are small,
 * flat, reference-only structures by design, so real inputs never approach
 * this limit.
 */
function assertNoForbiddenKeys(value: unknown, pathPrefix: string, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${pathPrefix}[${index}]`, depth + 1));
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenKey(key)) {
      throw new ForbiddenSensitivePayloadError(pathPrefix ? `${pathPrefix}.${key}` : key);
    }
    assertNoForbiddenKeys(nested, pathPrefix ? `${pathPrefix}.${key}` : key, depth + 1);
  }
}

function assertMaxLength(value: string, maxLength: number, fieldPath: string): void {
  if (value.length > maxLength) {
    throw new InvalidFieldLengthError(fieldPath, maxLength, value.length);
  }
}

function assertMaxLengthEach(values: readonly string[] | undefined, maxLength: number, fieldPath: string): void {
  if (!values) return;
  values.forEach((value, index) => assertMaxLength(value, maxLength, `${fieldPath}[${index}]`));
}

/**
 * Validates one MasterRegisterChangeValue against its closed shape — exactly
 * one of LITERAL/REFERENCE/HASH/REDACTED/CHANGED, each with exactly its own
 * fixed key set. An object with an unrecognized `kind`, a missing `kind`, or
 * any extra key beyond what that variant declares is rejected outright: this
 * is what makes the union closed in practice, not just in the type system —
 * a caller cannot smuggle `{ kind: "LITERAL", value: "x", extra: {...} }`
 * past this at runtime just because TypeScript wasn't there to stop it.
 */
function assertValidChangeValue(value: unknown, path: string): void {
  if (value === undefined) return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidChangeSetError(
      `"${path}" must be a MasterRegisterChangeValue object (kind: LITERAL/REFERENCE/HASH/REDACTED/CHANGED) — got ${Array.isArray(value) ? "an array" : value === null ? "null" : typeof value}.`,
    );
  }

  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;

  function assertExactKeys(allowed: readonly string[]): void {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(candidate)) {
      if (!allowedSet.has(key)) {
        throw new InvalidChangeSetError(`"${path}" (kind: "${String(kind)}") has an unexpected key "${key}".`);
      }
    }
  }

  switch (kind) {
    case "LITERAL": {
      assertExactKeys(["kind", "value"]);
      const literal = candidate.value;
      if (literal !== null && typeof literal !== "string" && typeof literal !== "number" && typeof literal !== "boolean") {
        throw new InvalidChangeSetError(`"${path}.value" must be a string, number, boolean, or null.`);
      }
      if (typeof literal === "string") {
        assertMaxLength(literal, SHORT_TEXT_MAX_LENGTH, `${path}.value`);
      }
      return;
    }
    case "REFERENCE": {
      assertExactKeys(["kind", "reference"]);
      if (typeof candidate.reference !== "string" || candidate.reference.length === 0) {
        throw new InvalidChangeSetError(`"${path}.reference" must be a non-empty string.`);
      }
      assertMaxLength(candidate.reference, REFERENCE_MAX_LENGTH, `${path}.reference`);
      return;
    }
    case "HASH": {
      assertExactKeys(["kind", "algorithm", "value"]);
      if (typeof candidate.algorithm !== "string" || candidate.algorithm.length === 0) {
        throw new InvalidChangeSetError(`"${path}.algorithm" must be a non-empty string.`);
      }
      if (typeof candidate.value !== "string" || candidate.value.length === 0) {
        throw new InvalidChangeSetError(`"${path}.value" must be a non-empty string.`);
      }
      assertMaxLength(candidate.algorithm, HASH_ALGORITHM_MAX_LENGTH, `${path}.algorithm`);
      assertMaxLength(candidate.value, HASH_VALUE_MAX_LENGTH, `${path}.value`);
      return;
    }
    case "REDACTED":
    case "CHANGED": {
      assertExactKeys(["kind"]);
      return;
    }
    default:
      throw new InvalidChangeSetError(`"${path}.kind" must be one of LITERAL, REFERENCE, HASH, REDACTED, CHANGED — got ${JSON.stringify(kind)}.`);
  }
}

/** A ChangeSet may only ever describe individually named fields — never an unrestricted generic object snapshot. */
function assertWellFormedChangeSet(change: ChangeSet): void {
  const allowedKeys = new Set(["changedFields", "fieldChanges"]);
  for (const key of Object.keys(change)) {
    if (!allowedKeys.has(key)) {
      throw new InvalidChangeSetError(
        `Unexpected key "${key}" on ChangeSet — only "changedFields" and per-field "fieldChanges" are accepted (never a raw full-record snapshot).`,
      );
    }
  }
  if (!Array.isArray(change.changedFields) || change.changedFields.some((f) => typeof f !== "string")) {
    throw new InvalidChangeSetError("ChangeSet.changedFields must be an array of field-name strings.");
  }
  assertMaxLengthEach(change.changedFields, IDENTIFIER_MAX_LENGTH, "change.changedFields");

  if (change.fieldChanges) {
    change.fieldChanges.forEach((fieldChange, index) => {
      if (typeof fieldChange.field !== "string" || fieldChange.field.length === 0) {
        throw new InvalidChangeSetError("Each ChangeSet.fieldChanges entry requires a non-empty field name.");
      }
      assertMaxLength(fieldChange.field, IDENTIFIER_MAX_LENGTH, `change.fieldChanges[${index}].field`);
      assertValidChangeValue(fieldChange.before, `change.fieldChanges[${index}].before`);
      assertValidChangeValue(fieldChange.after, `change.fieldChanges[${index}].after`);
    });
  }
}

/**
 * Length constraints on the identifier/reference/short-text fields this
 * service controls (see limits.ts for rationale). This is structural
 * data-minimization, not content/PII scanning — it bounds how much text any
 * single field can carry, nothing more.
 */
function assertLengthConstraints(input: MasterRegisterEventInput): void {
  assertMaxLength(input.source.sourceType, IDENTIFIER_MAX_LENGTH, "source.sourceType");
  if (input.source.component !== undefined) assertMaxLength(input.source.component, IDENTIFIER_MAX_LENGTH, "source.component");
  if (input.source.workflow !== undefined) assertMaxLength(input.source.workflow, IDENTIFIER_MAX_LENGTH, "source.workflow");
  if (input.source.sessionId !== undefined) assertMaxLength(input.source.sessionId, IDENTIFIER_MAX_LENGTH, "source.sessionId");
  if (input.source.requestId !== undefined) assertMaxLength(input.source.requestId, IDENTIFIER_MAX_LENGTH, "source.requestId");

  if (input.target) {
    if (input.target.resourceId !== undefined) assertMaxLength(input.target.resourceId, IDENTIFIER_MAX_LENGTH, "target.resourceId");
    if (input.target.companyId !== undefined) assertMaxLength(input.target.companyId, IDENTIFIER_MAX_LENGTH, "target.companyId");
    assertMaxLengthEach(input.target.companyScope, IDENTIFIER_MAX_LENGTH, "target.companyScope");
    assertMaxLengthEach(input.target.subjectReferences, REFERENCE_MAX_LENGTH, "target.subjectReferences");
  }

  if (input.evidence) {
    assertMaxLengthEach(input.evidence.evidenceReferences, REFERENCE_MAX_LENGTH, "evidence.evidenceReferences");
    assertMaxLengthEach(input.evidence.documentReferences, REFERENCE_MAX_LENGTH, "evidence.documentReferences");
    assertMaxLengthEach(input.evidence.supportingReferences, REFERENCE_MAX_LENGTH, "evidence.supportingReferences");
  }

  if (input.relationships) {
    const r = input.relationships;
    const idFields: Array<[string, string | undefined]> = [
      ["correlationId", r.correlationId],
      ["causationEventId", r.causationEventId],
      ["parentEventId", r.parentEventId],
      ["workflowId", r.workflowId],
      ["taskId", r.taskId],
      ["assignmentId", r.assignmentId],
      ["assessmentId", r.assessmentId],
      ["automationRunId", r.automationRunId],
      ["integrationOperationId", r.integrationOperationId],
      ["processingRunId", r.processingRunId],
      ["reviewId", r.reviewId],
      ["investigationId", r.investigationId],
      ["batchId", r.batchId],
    ];
    for (const [name, value] of idFields) {
      if (value !== undefined) assertMaxLength(value, IDENTIFIER_MAX_LENGTH, `relationships.${name}`);
    }
    assertMaxLengthEach(r.relatedEventIds, IDENTIFIER_MAX_LENGTH, "relationships.relatedEventIds");
  }

  if (input.outcome) {
    if (input.outcome.reasonCode !== undefined) assertMaxLength(input.outcome.reasonCode, IDENTIFIER_MAX_LENGTH, "outcome.reasonCode");
    if (input.outcome.reason !== undefined) assertMaxLength(input.outcome.reason, SHORT_TEXT_MAX_LENGTH, "outcome.reason");
    if (input.outcome.failureReference !== undefined) assertMaxLength(input.outcome.failureReference, REFERENCE_MAX_LENGTH, "outcome.failureReference");
  }

  if (input.coverage?.artifactReference !== undefined) {
    assertMaxLength(input.coverage.artifactReference, REFERENCE_MAX_LENGTH, "coverage.artifactReference");
  }
}

function isValidIsoDate(value: string): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

/**
 * Pure construction + validation — no I/O. Exported separately from
 * recordEvent so construction logic can be unit tested without a
 * repository.
 */
export function buildMasterRegisterEvent(input: MasterRegisterEventInput): MasterRegisterEvent {
  // Reject caller attempts to smuggle an eventFamily in, even past
  // MasterRegisterEventInput's type (which already omits the field) — this
  // guards against a loosely-typed/`as any` caller.
  if ("eventFamily" in (input as unknown as Record<string, unknown>)) {
    throw new ForbiddenFamilyOverrideError();
  }

  if (!isRegisteredEventType(input.eventType)) {
    throw new UnregisteredEventTypeError(input.eventType);
  }
  const definition = getEventTypeDefinition(input.eventType);
  const eventFamily = definition.family;

  validateActor(input.actor);

  if (!input.source || typeof input.source.sourceType !== "string" || input.source.sourceType.trim().length === 0) {
    throw new RootEventSourceError("source.sourceType is required on every Master Register event.");
  }

  const hasCausalParent = Boolean(input.relationships?.causationEventId || input.relationships?.parentEventId);
  if (!hasCausalParent) {
    // Root events must identify their initiating source/context beyond the
    // bare sourceType category (invariant #9).
    const hasAdditionalContext = Boolean(
      input.source.component || input.source.workflow || input.source.sessionId || input.source.requestId,
    );
    if (!hasAdditionalContext) {
      throw new RootEventSourceError(
        "Root events (no causationEventId/parentEventId) must identify their initiating context via source.component, source.workflow, source.sessionId, or source.requestId.",
      );
    }
  }

  if (input.occurredAt !== undefined && !isValidIsoDate(input.occurredAt)) {
    throw new InvalidOccurredAtError(input.occurredAt);
  }

  if (input.change) {
    assertWellFormedChangeSet(input.change);
  }

  if (input.coverage) {
    validateCoverage(input.coverage);
  }

  assertLengthConstraints(input);
  assertNoForbiddenKeys(input, "");

  const recordedAt = new Date().toISOString();
  const occurredAt = input.occurredAt ?? recordedAt;

  const event: MasterRegisterEvent = {
    ...input,
    eventId: randomUUID(),
    eventFamily,
    schemaVersion: definition.schemaVersion,
    catalogueVersion: CATALOGUE_VERSION,
    occurredAt,
    recordedAt,
  };

  return event;
}

/** Construction + repository append. Never mutates an existing event — always a fresh append. */
export async function recordEvent(
  repository: MasterRegisterRepository,
  input: MasterRegisterEventInput,
): Promise<MasterRegisterEvent> {
  const event = buildMasterRegisterEvent(input);
  return repository.append(event);
}
