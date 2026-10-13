import type { BlockReason, LifecycleState } from "@/lib/evidence-payload/definitions"

/** What the client sees. Deliberately carries no bucket, object name, generation or URL. */
export type EvidenceItemView = {
  documentId: string
  documentType: string
  documentTitle: string
  documentStatus: "received" | "classified" | "verified" | "rejected" | "archived"
  expiresAt: string | null
  createdAt: string
  supersedesDocumentId: string | null
  payload: {
    state: LifecycleState
    mimeType: string
    byteSize: number
    originalFilename: string
    blockReason: BlockReason | null
    /** True once the stored bytes were re-hashed and matched the hash declared at upload. */
    integrityVerified: boolean
    viewable: boolean
    storedAt: string | null
  }
}

export type FinalizeResult = {
  documentId: string
  state: LifecycleState
  /** True while the scanner has not yet promoted the object into intake. */
  pending: boolean
}

/** Server-internal row for the consistency audit (never serialized to a client). */
export type AuditPayloadRow = {
  payloadId: string
  documentId: string
  organizationId: string
  state: LifecycleState
  quarantineObjectName: string
  intakeObjectName: string | null
  intakeGeneration: string | null
  evidenceObjectName: string | null
  evidenceGeneration: string | null
  byteSize: number
  createdAt: string
}

export type OpenedEvidence = {
  bytes: Buffer
  mimeType: string
  byteSize: number
}
