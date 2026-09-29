/**
 * Structured, minimal operational logging. Every log call takes an explicit,
 * whitelisted field object - there is no code path in this service that logs
 * a raw error object, a raw CloudEvent body, document bytes, or credentials.
 * See callers for what is actually passed.
 */

export interface LogFields {
  securityAssessmentId?: string;
  companyId?: string;
  batchId?: string;
  sourceFileId?: string;
  sourceObjectName?: string;
  scanOutcome?: string;
  securityDecision?: string;
  reasonCode?: string;
  durationMs?: number;
  message?: string;
}

function emit(level: "info" | "warn" | "error", fields: LogFields): void {
  // eslint-disable-next-line no-console
  console[level](JSON.stringify({ ...fields, level, timestamp: new Date().toISOString() }));
}

export const logger = {
  info: (fields: LogFields) => emit("info", fields),
  warn: (fields: LogFields) => emit("warn", fields),
  error: (fields: LogFields) => emit("error", fields),
};
