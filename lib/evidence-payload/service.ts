import "server-only"

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import { classifyPayloadConsistency, type ConsistencyFinding, type ListedObject } from "@/lib/evidence-payload/consistency"
import { EvidenceStateError, EvidenceValidationError } from "@/lib/evidence-payload/errors"
import { intakeKey, evidenceKey, quarantineKey } from "@/lib/evidence-payload/object-keys"
import * as operations from "@/lib/evidence-payload/operations"
import type { EvidenceStoragePort } from "@/lib/evidence-payload/ports"
import type { EvidenceItemView, FinalizeResult, OpenedEvidence } from "@/lib/evidence-payload/types"
import { sha256Hex, validateUpload } from "@/lib/evidence-payload/validation"

export * from "@/lib/evidence-payload/errors"
export * from "@/lib/evidence-payload/definitions"
export type * from "@/lib/evidence-payload/types"
export { PayloadValidationError } from "@/lib/evidence-payload/validation"

/**
 * Evidence payload service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorizedSystem (authorization + one transaction) -> operations -> PostgreSQL
 *                  \                                                          \-> Master Register, same transaction
 *                   \-> storage port (GCS) between transactions: create-only writes, pinned reads, never a delete
 *
 * Capabilities (all SYSTEM scope; there is no CUSTOMER-facing path):
 *   EVIDENCE_READ     list, secure view (the view is recorded in the Master Register BEFORE any byte is read), audit
 *   EVIDENCE_MANAGE   upload, finalize, block, archive, review, satisfy a requirement
 *
 * Payloads never touch PostgreSQL, the browser, a public URL or a signed URL. The browser sends bytes to this server and
 * receives bytes from this server; it never learns a bucket, an object name or a generation.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): operations.OperationContext {
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
  }
}

const manage = <T>(work: (ctx: operations.OperationContext) => Promise<T>) => withAuthorizedSystem("EVIDENCE_MANAGE", (client, decision) => work(context(client, decision)))
const read = <T>(work: (ctx: operations.OperationContext) => Promise<T>) => withAuthorizedSystem("EVIDENCE_READ", (client, decision) => work(context(client, decision)))

async function defaultPort(): Promise<EvidenceStoragePort> {
  const { createGcsEvidenceStoragePort } = await import("@/lib/evidence-payload/gcs-adapter")
  return createGcsEvidenceStoragePort()
}

// --- reads -------------------------------------------------------------------------------------------------------

export async function listOrganizationEvidence(organizationId: string): Promise<EvidenceItemView[]> {
  return withAuthorizedSystem("EVIDENCE_READ", (client) => operations.listEvidence(client, organizationId))
}

// --- upload ------------------------------------------------------------------------------------------------------

export type UploadInput = {
  organizationId: string
  documentType: string
  documentTitle: string
  file: { bytes: Uint8Array; mimeType: string; filename: string }
  supersedesDocumentId?: string | null
}

/**
 * Accepts an upload into QUARANTINE. Order matters:
 *   1. validate the bytes (size, MIME allow-list, magic bytes) and hash them on the server
 *   2. authorize (EVIDENCE_MANAGE) and check the organization - before a single byte is written to storage
 *   3. create-only write to quarantine/{org}/{batch}/{file}/source
 *   4. record the evidence document + payload + Master Register event in one transaction
 * A crash between 3 and 4 leaves an unreferenced quarantine object (reported by the audit, never overwritten, never served).
 * Success means only "accepted into quarantine": nothing is cleared, stored or verified.
 */
export async function uploadEvidence(input: UploadInput, port?: EvidenceStoragePort): Promise<{ documentId: string; state: "quarantined" }> {
  const organizationId = operations.requireOrganizationId(input.organizationId)
  const supersedesDocumentId = input.supersedesDocumentId ? operations.requireDocumentId(input.supersedesDocumentId) : null
  const validated = validateUpload({
    documentType: input.documentType,
    documentTitle: input.documentTitle,
    mimeType: input.file.mimeType,
    originalFilename: input.file.filename,
    bytes: input.file.bytes,
  })

  await manage((ctx) => operations.assertUploadAllowed(ctx.client, { organizationId, documentType: validated.documentType, supersedesDocumentId }))

  const storage = port ?? (await defaultPort())
  const ids = { documentId: randomUUID(), batchId: randomUUID(), sourceFileId: randomUUID() }
  const objectName = quarantineKey({ organizationId, batchId: ids.batchId, sourceFileId: ids.sourceFileId })
  const put = await storage.putQuarantine(objectName, Buffer.from(input.file.bytes), {
    contentType: validated.mimeType,
    metadata: { companyId: organizationId, batchId: ids.batchId, sourceFileId: ids.sourceFileId, documentId: ids.documentId, originalFilename: validated.originalFilename },
  })

  await manage((ctx) =>
    operations.recordUploadAccepted(ctx, {
      organizationId,
      ids,
      validated,
      quarantineBucket: storage.bucketNames().quarantine,
      quarantineObjectName: objectName,
      quarantineGeneration: put.generation,
      supersedesDocumentId,
    }),
  )
  return { documentId: ids.documentId, state: "quarantined" }
}

// --- finalize (scanner result -> evidence) ---------------------------------------------------------------------

/**
 * Advances a payload as far as it can safely go, idempotently (safe to call repeatedly and concurrently):
 *   quarantined: is the scanner's CLEARED copy present in intake? If so, re-hash it against the hash declared at upload.
 *                A mismatch BLOCKS the payload; a match moves it to 'cleared'.
 *   cleared:     create-only copy of the exact scanned intake generation into the evidence bucket, re-hash the evidence
 *                object, then 'stored'. An evidence object that already exists is never overwritten - it is verified.
 * An absent intake object is not an error: the scanner has not cleared the file (yet, or ever). Nothing is promoted without it.
 */
export async function finalizeEvidence(input: { organizationId: string; documentId: string }, port?: EvidenceStoragePort): Promise<FinalizeResult> {
  const organizationId = operations.requireOrganizationId(input.organizationId)
  const documentId = operations.requireDocumentId(input.documentId)
  const storage = port ?? (await defaultPort())

  let bundle = await manage((ctx) => operations.loadBundle(ctx.client, organizationId, documentId))
  const result = (state: FinalizeResult["state"], pending = false): FinalizeResult => ({ documentId, state, pending })

  if (bundle.state === "quarantined") {
    const intakeName = intakeKey({ organizationId, batchId: bundle.batchId, sourceFileId: bundle.sourceFileId })
    const info = await storage.statIntake(intakeName)
    if (!info) return result("quarantined", true)
    const bytes = await storage.readIntake(intakeName, info.generation)
    if (bytes.byteLength !== bundle.byteSize || sha256Hex(bytes) !== bundle.declaredSha256) {
      await manage((ctx) => operations.applyBlocked(ctx, bundle, "INTEGRITY_MISMATCH"))
      return result("blocked")
    }
    await manage((ctx) => operations.applyCleared(ctx, bundle, { intakeObjectName: intakeName, intakeGeneration: info.generation }))
    bundle = await manage((ctx) => operations.loadBundle(ctx.client, organizationId, documentId))
  }

  if (bundle.state === "cleared") {
    if (!bundle.intakeObjectName || !bundle.intakeGeneration) throw new EvidenceStateError("The cleared payload has no intake reference.")
    const evidenceName = evidenceKey({ organizationId, documentId })
    const copy = await storage.copyIntakeToEvidence(bundle.intakeObjectName, bundle.intakeGeneration, evidenceName)
    const existing = copy.created ? null : await storage.statEvidence(evidenceName)
    const generation = copy.created ? copy.generation : (existing?.generation ?? null)
    if (!generation) throw new EvidenceStateError("The evidence object could not be confirmed.")
    const stored = await storage.readEvidence(evidenceName, generation)
    if (stored.byteLength !== bundle.byteSize || sha256Hex(stored) !== bundle.declaredSha256) {
      // Never deleted, never overwritten: the payload is blocked for a human.
      await manage((ctx) => operations.applyBlocked(ctx, bundle, "EVIDENCE_HASH_MISMATCH"))
      return result("blocked")
    }
    await manage((ctx) => operations.applyStored(ctx, bundle, { evidenceBucket: storage.bucketNames().evidence, evidenceGeneration: generation }))
    bundle = await manage((ctx) => operations.loadBundle(ctx.client, organizationId, documentId))
  }

  return result(bundle.state)
}

// --- secure view ---------------------------------------------------------------------------------------------------

/**
 * Opens a stored document for an authorized, inline view. The view is authorized and written to the Master Register
 * (and the access ledger) in a committed transaction BEFORE any byte is read from storage; the bytes are then read pinned to
 * the verified generation and re-hashed against the verified SHA-256 before they are returned. A tenant mismatch is a
 * not-found, with no register event and no storage read.
 */
export async function openEvidenceForView(input: { organizationId: string; documentId: string }, port?: EvidenceStoragePort): Promise<OpenedEvidence> {
  const organizationId = operations.requireOrganizationId(input.organizationId)
  const documentId = operations.requireDocumentId(input.documentId)

  const { ticket, bundle } = await read(async (ctx) => {
    const found = await operations.loadBundle(ctx.client, organizationId, documentId)
    return { ticket: await operations.recordView(ctx, found), bundle: found }
  })

  const storage = port ?? (await defaultPort())
  const bytes = await storage.readEvidence(ticket.evidenceObjectName, ticket.evidenceGeneration ?? undefined)
  if (bytes.byteLength !== ticket.byteSize || sha256Hex(bytes) !== ticket.verifiedSha256) {
    await manage((ctx) => operations.recordIntegrityFailure(ctx, bundle))
    throw new EvidenceStateError("The stored document failed its integrity check and cannot be shown.")
  }
  return { bytes, mimeType: ticket.mimeType, byteSize: ticket.byteSize }
}

// --- state changes --------------------------------------------------------------------------------------------------

export async function blockEvidence(input: { organizationId: string; documentId: string }): Promise<void> {
  const organizationId = operations.requireOrganizationId(input.organizationId)
  const documentId = operations.requireDocumentId(input.documentId)
  await manage(async (ctx) => {
    const bundle = await operations.loadBundle(ctx.client, organizationId, documentId, { lock: true })
    if (!(await operations.applyBlocked(ctx, bundle, "OPERATOR_BLOCKED"))) throw new EvidenceStateError("Only a quarantined or cleared payload can be blocked.")
  })
}

export const archiveEvidence = (input: { organizationId: string; documentId: string }) => manage((ctx) => operations.archiveDocument(ctx, input.organizationId, input.documentId))
export const reviewEvidence = (input: { organizationId: string; documentId: string; decision: unknown }) => manage((ctx) => operations.reviewDocument(ctx, input))
export const satisfyEvidenceRequirement = (input: { organizationId: string; documentId: string }) => manage((ctx) => operations.satisfyRequirement(ctx, input))

// --- audit / recovery -------------------------------------------------------------------------------------------

export type AuditReport = { findings: ConsistencyFinding[]; checkedRows: number; listed: { quarantine: number; intake: number; evidence: number } }

async function listAll(port: EvidenceStoragePort, stage: "quarantine" | "intake" | "evidence", prefix: string): Promise<ListedObject[]> {
  const all: ListedObject[] = []
  let token: string | undefined
  do {
    const page = await port.listObjects(stage, prefix, token)
    all.push(...page.objects)
    token = page.nextPageToken ?? undefined
  } while (token)
  return all
}

/**
 * Read-only consistency audit: database rows against storage listings. Reports missing objects, size / generation drift,
 * stalled scans and orphan or foreign objects. It never repairs, moves or deletes anything; recovery is an operator decision.
 * Pass organizationId to audit one tenant (listings are then limited to that tenant's prefix).
 */
export async function auditEvidencePayloads(input: { organizationId?: string | null; deepVerify?: boolean } = {}, port?: EvidenceStoragePort): Promise<AuditReport> {
  const organizationId = input.organizationId ? operations.requireOrganizationId(input.organizationId) : null
  const rows = await read((ctx) => operations.readAuditRows(ctx.client, organizationId))
  const storage = port ?? (await defaultPort())
  const scope = organizationId ? `${organizationId}/` : ""
  const [quarantine, intake, evidence] = await Promise.all([
    listAll(storage, "quarantine", `quarantine/${scope}`),
    listAll(storage, "intake", `intake/${scope}`),
    listAll(storage, "evidence", `evidence/${scope}`),
  ])
  const findings = classifyPayloadConsistency({ rows, quarantine, intake, evidence, now: new Date() })

  if (input.deepVerify) {
    for (const row of rows.filter((item) => item.state === "stored" && item.evidenceObjectName)) {
      const bundle = await read((ctx) => operations.loadBundle(ctx.client, row.organizationId, row.documentId))
      const bytes = await storage.readEvidence(row.evidenceObjectName as string, row.evidenceGeneration ?? undefined).catch(() => null)
      if (!bytes || sha256Hex(bytes) !== bundle.verifiedSha256) {
        findings.push({ code: "MISSING_EVIDENCE_OBJECT", severity: "critical", documentId: row.documentId, objectName: row.evidenceObjectName })
      }
    }
  }
  return { findings, checkedRows: rows.length, listed: { quarantine: quarantine.length, intake: intake.length, evidence: evidence.length } }
}

// --- API dispatch -------------------------------------------------------------------------------------------------

/** Dispatches one evidence PATCH action. Unknown actions are refused; nothing here deletes anything. */
export async function applyEvidenceAction(organizationId: string, documentId: string, input: Record<string, unknown>): Promise<EvidenceItemView[]> {
  switch (input.action) {
    case "finalize":
      await finalizeEvidence({ organizationId, documentId })
      break
    case "review":
      await reviewEvidence({ organizationId, documentId, decision: input.decision })
      break
    case "satisfyRequirement":
      await satisfyEvidenceRequirement({ organizationId, documentId })
      break
    case "block":
      await blockEvidence({ organizationId, documentId })
      break
    case "archive":
      await archiveEvidence({ organizationId, documentId })
      break
    default:
      throw new EvidenceValidationError("action", "Unsupported evidence action.")
  }
  return listOrganizationEvidence(organizationId)
}
