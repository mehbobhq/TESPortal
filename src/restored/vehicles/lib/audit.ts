/**
 * The original workspace wrote its own audit lines to browser storage. In the TES records view every canonical operation records
 * its Master Register event inside the same database transaction on the server, so there is nothing to write from the browser.
 * These calls remain only so the original component code is unchanged; they record nothing.
 */
export function recordAuditEvent(_event: Record<string, unknown>): void {}
export function logAuditEvent(_event: Record<string, unknown>): void {}
export function recordDocumentViewEvent(_event: Record<string, unknown>): void {}
