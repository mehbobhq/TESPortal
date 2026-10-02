/**
 * TES Master Register — the one controlled event-construction/recording
 * service. UI/pages/components must never construct or persist Master
 * Register events directly; everything goes through here.
 *
 * Construction (buildMasterRegisterEvent) and persistence (recordEvent's use
 * of the repository) are deliberately separate functions so each can be
 * tested independently of the other, per the Phase 1 scope.
 */

import { randomUUID } from "node:crypto";

import { validateActor } from "./actor-identity.ts";
import { validateCoverage } from "./coverage.ts";
import { CATALOGUE_VERSION, getEventTypeDefinition, isRegisteredEventType, UnregisteredEventTypeError } from "./event-types.ts";
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
  if (change.fieldChanges) {
    for (const fieldChange of change.fieldChanges) {
      if (typeof fieldChange.field !== "string" || fieldChange.field.length === 0) {
        throw new InvalidChangeSetError("Each ChangeSet.fieldChanges entry requires a non-empty field name.");
      }
    }
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
