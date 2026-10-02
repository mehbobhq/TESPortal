/**
 * TES Ingestion Spine - canonical GCS object paths.
 *
 *   quarantine/{companyId}/{batchId}/{sourceFileId}/source   (written by the portal, create-only)
 *   intake/{companyId}/{batchId}/{sourceFileId}/source       (written ONLY by the security scanner, after CLEARED)
 *
 * The security scanner (services/document-security-scanner/src/
 * pathValidation.ts) strictly validates the quarantine shape and derives the
 * intake path itself; it is a separate deployable and this module does not
 * import it. The two sides are kept in agreement by an explicit
 * cross-boundary compatibility test (test/lib/ingestion/object-paths.test.ts),
 * not by shared code.
 *
 * These helpers fail closed: they throw for any identity the scanner would
 * reject, so the portal can never produce a quarantine object name the
 * scanner would silently decline to process.
 */

import type { BatchId, SourceFileId } from "./ids.ts"

/** Conservative allow-list for companyId as a GCS path segment. Identifier validation only - NOT authorization. */
export const COMPANY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** Canonical form for batchId/sourceFileId: a standard 8-4-4-4-12 hex UUID (crypto.randomUUID() output). */
export const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CanonicalObjectIdentity {
  /** Not yet a canonical/normalized type repository-wide - see ids.ts's header note. */
  companyId: string
  batchId: BatchId
  sourceFileId: SourceFileId
}

export class InvalidObjectIdentityError extends Error {
  constructor(field: "companyId" | "batchId" | "sourceFileId") {
    super(`${field} is not a valid canonical identifier for an ingestion object path.`)
    this.name = "InvalidObjectIdentityError"
  }
}

function assertCanonicalIdentity(identity: CanonicalObjectIdentity): void {
  if (!COMPANY_ID_PATTERN.test(identity.companyId)) throw new InvalidObjectIdentityError("companyId")
  if (!CANONICAL_UUID_PATTERN.test(identity.batchId)) throw new InvalidObjectIdentityError("batchId")
  if (!CANONICAL_UUID_PATTERN.test(identity.sourceFileId)) throw new InvalidObjectIdentityError("sourceFileId")
}

export function quarantineObjectName(identity: CanonicalObjectIdentity): string {
  assertCanonicalIdentity(identity)
  return `quarantine/${identity.companyId}/${identity.batchId}/${identity.sourceFileId}/source`
}

/**
 * Where scanner-cleared content will live. For READ-SIDE use by later
 * pipeline stages only - nothing in the portal may write to this path; the
 * scanner is the only promoter.
 */
export function intakeObjectName(identity: CanonicalObjectIdentity): string {
  assertCanonicalIdentity(identity)
  return `intake/${identity.companyId}/${identity.batchId}/${identity.sourceFileId}/source`
}
