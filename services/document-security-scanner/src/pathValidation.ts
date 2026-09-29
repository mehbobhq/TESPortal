import type { QuarantineObjectIdentity } from "./types.js";

/**
 * Same conservative identifier allow-list used by canonical intake
 * (app/api/document-intake/route.ts's COMPANY_ID_PATTERN) - kept as an
 * independent copy here deliberately (this service does not import portal
 * code), but must stay in sync in spirit: no "/", no "..", no control
 * characters, no whitespace-only values.
 */
const COMPANY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Phase 1 (app/api/document-intake) generates batchId/sourceFileId via crypto.randomUUID() - validate as a standard UUID. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strictly validates a quarantine object name against the exact expected
 * shape `quarantine/{companyId}/{batchId}/{sourceFileId}/source` and
 * extracts its identity. Returns null for anything that does not match -
 * callers must treat null as "decline processing", never attempt to repair
 * or reinterpret a malformed path.
 */
export function parseQuarantineObjectName(objectName: string): QuarantineObjectIdentity | null {
  const segments = objectName.split("/");
  if (segments.length !== 5) return null;

  const [prefix, companyId, batchId, sourceFileId, suffix] = segments;
  if (prefix !== "quarantine" || suffix !== "source") return null;
  if (!COMPANY_ID_PATTERN.test(companyId)) return null;
  if (!UUID_PATTERN.test(batchId)) return null;
  if (!UUID_PATTERN.test(sourceFileId)) return null;

  return { companyId, batchId, sourceFileId };
}

/**
 * Derives the Intake destination object name from a validated identity only
 * - never from a caller/event-supplied destination path. This is the only
 * function permitted to produce an Intake object name in this service.
 */
export function deriveIntakeObjectName(identity: QuarantineObjectIdentity): string {
  return `intake/${identity.companyId}/${identity.batchId}/${identity.sourceFileId}/source`;
}
