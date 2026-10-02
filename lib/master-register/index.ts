/**
 * TES Master Register — Phase 1 foundation public API.
 *
 * This is the ONLY module application code should import from. UI/pages/
 * components must never construct or persist Master Register events
 * directly (see record-event.ts), and must never read/write any of the
 * pre-existing, separate systems below as if they were this one.
 *
 * LEGACY SYSTEMS — explicitly out of scope for this phase, not migrated,
 * not wrapped, not used as persistence for anything exported here:
 *   - lib/audit.ts            (console.log-only stub; already misuses the
 *                               name "Master Register" in its own comments)
 *   - lib/audit-logger.ts     (localStorage "Layer-1" buffer; also already
 *                               uses the name "Master Register" in its own
 *                               header comment)
 *   - lib/audit-log.ts        (localStorage NDJSON security/session log)
 *   - lib/activity-log.ts     (localStorage per-company activity feed)
 *   - lib/audit-case-store.ts (localStorage regulatory-audit-case tracker)
 * Reconciling the naming collision with lib/audit.ts and lib/audit-logger.ts,
 * and any eventual migration of these systems, is a separate, explicit
 * future decision — not part of this foundation.
 */

export * from "./types.ts";
export * from "./event-types.ts";
export * from "./coverage.ts";
export * from "./assessment.ts";
export * from "./actor-identity.ts";
export * from "./repository.ts";
export * from "./record-event.ts";
