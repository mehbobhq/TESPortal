/**
 * Evidence payload object keys: the only place object names are built or parsed.
 *
 * Every key is derived from canonical identifiers, never from client input, and carries the owning organization as a path
 * segment. The database (migration 0032, evidence_payloads_*_name_valid) re-derives and enforces the same names.
 *
 *   quarantine/{org}/{batch}/{sourceFile}/source     written by the portal, create-only (shape fixed by the scanner contract)
 *   intake/{org}/{batch}/{sourceFile}/source         written ONLY by the document-security-scanner after a CLEARED decision
 *   evidence/{org}/{document}/source                 written by the portal, create-only, after the hash is re-verified
 *   processed/{org}/{document}/{artifact}            reserved for derived artifacts (OCR text, layout); never the source
 *
 * Pure module: no I/O, no framework imports, no server-only.
 */

import { COMPANY_ID_PATTERN, intakeObjectName, quarantineObjectName } from "@/lib/ingestion/object-paths"
import { asBatchId, asSourceFileId } from "@/lib/ingestion/ids"

const CANONICAL_LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Derived artifacts that may live under processed/. Closed list: no free-form artifact names. */
export const PROCESSED_ARTIFACTS = ["ocr-text.json", "ocr-layout.json", "preview.png"] as const
export type ProcessedArtifact = (typeof PROCESSED_ARTIFACTS)[number]

export type ObjectStage = "quarantine" | "intake" | "evidence" | "processed"

export class InvalidObjectKeyError extends Error {
  constructor(field: string) {
    super(`${field} is not a valid canonical identifier for an evidence object key.`)
    this.name = "InvalidObjectKeyError"
  }
}

function canonicalUuid(field: string, value: unknown): string {
  if (typeof value !== "string" || !CANONICAL_LOWER_UUID.test(value)) throw new InvalidObjectKeyError(field)
  return value
}

export type SourceIdentity = { organizationId: string; batchId: string; sourceFileId: string }

export function quarantineKey(identity: SourceIdentity): string {
  return quarantineObjectName({
    companyId: canonicalUuid("organizationId", identity.organizationId),
    batchId: asBatchId(canonicalUuid("batchId", identity.batchId)),
    sourceFileId: asSourceFileId(canonicalUuid("sourceFileId", identity.sourceFileId)),
  })
}

export function intakeKey(identity: SourceIdentity): string {
  return intakeObjectName({
    companyId: canonicalUuid("organizationId", identity.organizationId),
    batchId: asBatchId(canonicalUuid("batchId", identity.batchId)),
    sourceFileId: asSourceFileId(canonicalUuid("sourceFileId", identity.sourceFileId)),
  })
}

export function evidenceKey(identity: { organizationId: string; documentId: string }): string {
  return `evidence/${canonicalUuid("organizationId", identity.organizationId)}/${canonicalUuid("documentId", identity.documentId)}/source`
}

export function processedKey(identity: { organizationId: string; documentId: string; artifact: string }): string {
  if (!(PROCESSED_ARTIFACTS as readonly string[]).includes(identity.artifact)) throw new InvalidObjectKeyError("artifact")
  return `processed/${canonicalUuid("organizationId", identity.organizationId)}/${canonicalUuid("documentId", identity.documentId)}/${identity.artifact}`
}

export type ParsedObjectKey =
  | { stage: "quarantine" | "intake"; organizationId: string; batchId: string; sourceFileId: string }
  | { stage: "evidence"; organizationId: string; documentId: string }
  | { stage: "processed"; organizationId: string; documentId: string; artifact: ProcessedArtifact }

const SOURCE_KEY = /^(quarantine|intake)\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/source$/
const EVIDENCE_KEY = /^evidence\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/source$/
const PROCESSED_KEY = /^processed\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([a-z0-9.-]+)$/

/** Returns null for anything that is not exactly one of the canonical shapes (no traversal, no extra segments, no case games). */
export function parseObjectKey(name: string): ParsedObjectKey | null {
  if (typeof name !== "string" || name.length > 400) return null
  const source = SOURCE_KEY.exec(name)
  if (source && [source[2], source[3], source[4]].every((part) => CANONICAL_LOWER_UUID.test(part))) {
    return { stage: source[1] as "quarantine" | "intake", organizationId: source[2], batchId: source[3], sourceFileId: source[4] }
  }
  const evidence = EVIDENCE_KEY.exec(name)
  if (evidence && [evidence[1], evidence[2]].every((part) => CANONICAL_LOWER_UUID.test(part))) {
    return { stage: "evidence", organizationId: evidence[1], documentId: evidence[2] }
  }
  const processed = PROCESSED_KEY.exec(name)
  if (processed && [processed[1], processed[2]].every((part) => CANONICAL_LOWER_UUID.test(part)) && (PROCESSED_ARTIFACTS as readonly string[]).includes(processed[3])) {
    return { stage: "processed", organizationId: processed[1], documentId: processed[2], artifact: processed[3] as ProcessedArtifact }
  }
  return null
}

/** Tenant check on a stored name: true only when the name parses AND its organization segment is the expected organization. */
export function keyBelongsToOrganization(name: string, organizationId: string): boolean {
  const parsed = parseObjectKey(name)
  return parsed !== null && parsed.organizationId === organizationId && CANONICAL_LOWER_UUID.test(organizationId)
}

/** The scanner contract's own company-id allow-list is wider than a UUID; this module only ever emits canonical UUIDs. */
export const SCANNER_COMPANY_ID_PATTERN = COMPANY_ID_PATTERN
