/**
 * Evidence payload operations: the database half of the payload lifecycle, on a caller-supplied transaction.
 *
 * Every function runs INSIDE the transaction the authorization wrapper opened (EVIDENCE_READ or EVIDENCE_MANAGE) and writes
 * its Master Register event through a repository bound to the same client, so a failure anywhere - including the Master
 * Register - rolls the whole change back. Storage (GCS) work happens in service.ts, between transactions, behind a port.
 *
 * Tenant isolation: every lookup is scoped by BOTH the organization and the document id. A document of another organization
 * is indistinguishable from a missing one (EvidenceNotFoundError).
 *
 * Master Register events carry references (table:id) and controlled literals only - never an object name, URL or document
 * content. Upload events carry the payload's SHA-256 as a HASH value.
 *
 * No "server-only" import: plain domain logic, testable under Node. The server-only boundary is service.ts.
 */

import type { PoolClient } from "pg"
import { randomUUID } from "node:crypto"
import { REQUIREMENT_CATALOGUE, VIEWABLE_STATES, isBlockReason, type BlockReason, type LifecycleState } from "@/lib/evidence-payload/definitions"
import { EvidenceConflictError, EvidenceNotFoundError, EvidenceStateError, EvidenceValidationError } from "@/lib/evidence-payload/errors"
import { evidenceKey } from "@/lib/evidence-payload/object-keys"
import type { AuditPayloadRow, EvidenceItemView } from "@/lib/evidence-payload/types"
import type { ValidatedUpload } from "@/lib/evidence-payload/validation"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType, FieldChange } from "@/lib/master-register/types"

export type OperationContext = {
  client: PoolClient
  actor: { id: string; actorType: ActorType }
  masterRegister: MasterRegisterRepository
}

const MICRO_ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const MICRO_ISO_NULL = (column: string) => `CASE WHEN ${column} IS NULL THEN NULL ELSE ${MICRO_ISO(column)} END`

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName =
  | "DOCUMENT_INGESTED"
  | "DOCUMENT_VIEWED"
  | "DOCUMENT_SUPERSEDED"
  | "DOCUMENT_ARCHIVED"
  | "RECORD_STATUS_CHANGED"
  | "EVIDENCE_ASSOCIATED"
  | "VALIDATION_COMPLETED"

const literal = (value: string | number | boolean | null) => ({ kind: "LITERAL" as const, value })
const reference = (table: string, id: string) => ({ kind: "REFERENCE" as const, reference: `${table}:${id}` })

async function record(
  ctx: OperationContext,
  eventType: EventTypeName,
  operation: string,
  target: { documentId: string; organizationId: string },
  fieldChanges: FieldChange[],
  options: { outcome?: "SUCCESS" | "FAILURE"; reasonCode?: string } = {},
): Promise<string> {
  const event = await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: { resourceType: "evidence_document", resourceId: target.documentId, subjectReferences: [`organization:${target.organizationId}`] },
    source: { sourceType: "APPLICATION", component: "evidence-payload", workflow: operation },
    classification: { materiality: "MATERIAL", sensitivity: "CONFIDENTIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    evidence: { evidenceReferences: [`evidence_document:${target.documentId}`] },
    outcome: { result: options.outcome ?? "SUCCESS", ...(options.reasonCode ? { reasonCode: options.reasonCode } : {}) },
  })
  return event.eventId
}

// ---------------------------------------------------------------------------------------------------------------
// Bundles (document + payload), always scoped by organization
// ---------------------------------------------------------------------------------------------------------------

export type Bundle = {
  documentId: string
  organizationId: string
  documentType: string
  documentStatus: EvidenceItemView["documentStatus"]
  expiresAt: string | null
  sha256: string
  payloadId: string
  state: LifecycleState
  batchId: string
  sourceFileId: string
  quarantineBucket: string
  quarantineObjectName: string
  intakeObjectName: string | null
  intakeGeneration: string | null
  evidenceBucket: string | null
  evidenceObjectName: string | null
  evidenceGeneration: string | null
  declaredSha256: string
  verifiedSha256: string | null
  mimeType: string
  byteSize: number
  supersedesDocumentId: string | null
}

type BundleRow = {
  document_id: string
  organization_id: string
  document_type: string
  document_status: Bundle["documentStatus"]
  expires_at: string | null
  sha256: string
  payload_id: string
  lifecycle_state: LifecycleState
  batch_id: string
  source_file_id: string
  quarantine_bucket: string
  quarantine_object_name: string
  intake_object_name: string | null
  intake_generation: string | null
  evidence_bucket: string | null
  evidence_object_name: string | null
  evidence_generation: string | null
  declared_sha256: string
  verified_sha256: string | null
  mime_type: string
  byte_size: string
  supersedes_evidence_document_id: string | null
}

const BUNDLE_SELECT = `SELECT d.id AS document_id, d.organization_id, d.document_type, d.document_status, d.expires_at::text AS expires_at, d.sha256,
       p.id AS payload_id, p.lifecycle_state, p.batch_id, p.source_file_id, p.quarantine_bucket, p.quarantine_object_name,
       p.intake_object_name, p.intake_generation, p.evidence_bucket, p.evidence_object_name, p.evidence_generation,
       p.declared_sha256, p.verified_sha256, p.mime_type, p.byte_size::text AS byte_size, p.supersedes_evidence_document_id
  FROM public.evidence_documents d
  JOIN public.evidence_payloads p ON p.evidence_document_id = d.id`

const toBundle = (row: BundleRow): Bundle => ({
  documentId: row.document_id,
  organizationId: row.organization_id,
  documentType: row.document_type,
  documentStatus: row.document_status,
  expiresAt: row.expires_at,
  sha256: row.sha256,
  payloadId: row.payload_id,
  state: row.lifecycle_state,
  batchId: row.batch_id,
  sourceFileId: row.source_file_id,
  quarantineBucket: row.quarantine_bucket,
  quarantineObjectName: row.quarantine_object_name,
  intakeObjectName: row.intake_object_name,
  intakeGeneration: row.intake_generation,
  evidenceBucket: row.evidence_bucket,
  evidenceObjectName: row.evidence_object_name,
  evidenceGeneration: row.evidence_generation,
  declaredSha256: row.declared_sha256,
  verifiedSha256: row.verified_sha256,
  mimeType: row.mime_type,
  byteSize: Number(row.byte_size),
  supersedesDocumentId: row.supersedes_evidence_document_id,
})

/** The only way a document is looked up: organization AND id. A document of another organization is simply not found. */
export async function loadBundle(client: Pick<PoolClient, "query">, organizationId: string, documentId: string, options: { lock?: boolean } = {}): Promise<Bundle> {
  const result = await client.query<BundleRow>(
    `${BUNDLE_SELECT} WHERE d.organization_id = $1 AND d.id = $2 ${options.lock ? "FOR UPDATE OF p" : ""}`,
    [organizationId, documentId],
  )
  if (result.rows.length === 0) throw new EvidenceNotFoundError()
  return toBundle(result.rows[0])
}

function requireUuid(field: string, value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new EvidenceValidationError(field, `${field} must be a valid identifier.`)
  }
  return value.toLowerCase()
}

export const requireOrganizationId = (value: unknown) => requireUuid("organizationId", value)
export const requireDocumentId = (value: unknown) => requireUuid("documentId", value)

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------

type ItemRow = {
  document_id: string
  document_type: string
  document_title: string
  document_status: EvidenceItemView["documentStatus"]
  expires_at: string | null
  created_at: string
  supersedes_evidence_document_id: string | null
  lifecycle_state: LifecycleState
  mime_type: string
  byte_size: string
  original_filename: string
  block_reason: BlockReason | null
  verified_sha256: string | null
  stored_at: string | null
}

export async function listEvidence(client: Pick<PoolClient, "query">, organizationIdInput: unknown): Promise<EvidenceItemView[]> {
  const organizationId = requireOrganizationId(organizationIdInput)
  const result = await client.query<ItemRow>(
    `SELECT d.id AS document_id, d.document_type, d.document_title, d.document_status, d.expires_at::text AS expires_at,
            ${MICRO_ISO("d.created_at")} AS created_at, p.supersedes_evidence_document_id, p.lifecycle_state, p.mime_type,
            p.byte_size::text AS byte_size, p.original_filename, p.block_reason, p.verified_sha256, ${MICRO_ISO_NULL("p.stored_at")} AS stored_at
       FROM public.evidence_documents d
       JOIN public.evidence_payloads p ON p.evidence_document_id = d.id
      WHERE d.organization_id = $1
      ORDER BY d.created_at DESC, d.id`,
    [organizationId],
  )
  return result.rows.map((row) => ({
    documentId: row.document_id,
    documentType: row.document_type,
    documentTitle: row.document_title,
    documentStatus: row.document_status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    supersedesDocumentId: row.supersedes_evidence_document_id,
    payload: {
      state: row.lifecycle_state,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      originalFilename: row.original_filename,
      blockReason: row.block_reason,
      integrityVerified: row.verified_sha256 !== null,
      viewable: (VIEWABLE_STATES as readonly string[]).includes(row.lifecycle_state),
      storedAt: row.stored_at,
    },
  }))
}

/** Server-internal rows for the consistency audit. */
export async function readAuditRows(client: Pick<PoolClient, "query">, organizationId: string | null): Promise<AuditPayloadRow[]> {
  const result = await client.query<{
    payload_id: string
    evidence_document_id: string
    organization_id: string
    lifecycle_state: LifecycleState
    quarantine_object_name: string
    intake_object_name: string | null
    intake_generation: string | null
    evidence_object_name: string | null
    evidence_generation: string | null
    byte_size: string
    created_at: string
  }>(
    `SELECT id AS payload_id, evidence_document_id, organization_id, lifecycle_state, quarantine_object_name, intake_object_name, intake_generation,
            evidence_object_name, evidence_generation, byte_size::text AS byte_size, ${MICRO_ISO("created_at")} AS created_at
       FROM public.evidence_payloads
      WHERE ($1::uuid IS NULL OR organization_id = $1::uuid)
      ORDER BY created_at, id`,
    [organizationId],
  )
  return result.rows.map((row) => ({
    payloadId: row.payload_id,
    documentId: row.evidence_document_id,
    organizationId: row.organization_id,
    state: row.lifecycle_state,
    quarantineObjectName: row.quarantine_object_name,
    intakeObjectName: row.intake_object_name,
    intakeGeneration: row.intake_generation,
    evidenceObjectName: row.evidence_object_name,
    evidenceGeneration: row.evidence_generation,
    byteSize: Number(row.byte_size),
    createdAt: row.created_at,
  }))
}

// ---------------------------------------------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------------------------------------------

/** Pre-flight (before any byte is written to storage): the organization exists and a superseded document is a same-type document of it. */
export async function assertUploadAllowed(
  client: Pick<PoolClient, "query">,
  input: { organizationId: string; documentType: string; supersedesDocumentId: string | null },
): Promise<void> {
  const exists = await client.query<{ ok: boolean }>(`SELECT tes_security.evidence_organization_exists($1::uuid) AS ok`, [input.organizationId])
  if (exists.rows[0]?.ok !== true) throw new EvidenceNotFoundError("Organization")
  if (input.supersedesDocumentId) {
    const older = await client.query<{ document_type: string; document_status: string }>(
      `SELECT document_type, document_status FROM public.evidence_documents WHERE id = $1 AND organization_id = $2`,
      [input.supersedesDocumentId, input.organizationId],
    )
    if (older.rows.length === 0) throw new EvidenceNotFoundError("The document to supersede")
    if (older.rows[0].document_type !== input.documentType) throw new EvidenceValidationError("supersedesDocumentId", "A replacement must have the same document type.")
    if (older.rows[0].document_status === "archived") throw new EvidenceStateError("An archived document cannot be superseded.")
    const taken = await client.query(`SELECT 1 FROM public.evidence_payloads WHERE supersedes_evidence_document_id = $1 AND lifecycle_state <> 'archived'`, [input.supersedesDocumentId])
    if (taken.rows.length > 0) throw new EvidenceConflictError("A replacement for this document is already in progress.")
  }
}

export type UploadIds = { documentId: string; batchId: string; sourceFileId: string }

/** Records an accepted quarantine upload: the evidence document (received), its payload (quarantined) and the Master Register event. */
export async function recordUploadAccepted(
  ctx: OperationContext,
  input: {
    organizationId: string
    ids: UploadIds
    validated: ValidatedUpload
    quarantineBucket: string
    quarantineObjectName: string
    quarantineGeneration: string | null
    supersedesDocumentId: string | null
  },
): Promise<void> {
  const { organizationId, ids, validated } = input
  await record(
    ctx,
    "DOCUMENT_INGESTED",
    "accept_evidence_upload",
    { documentId: ids.documentId, organizationId },
    [
      { field: "documentType", after: literal(validated.documentType) },
      { field: "payloadState", after: literal("quarantined") },
      { field: "mimeType", after: literal(validated.mimeType) },
      { field: "byteSize", after: literal(validated.byteSize) },
      { field: "sha256", after: { kind: "HASH", algorithm: "SHA-256", value: validated.sha256 } },
      ...(input.supersedesDocumentId ? [{ field: "supersedes", after: reference("evidence_document", input.supersedesDocumentId) }] : []),
    ],
  )
  await ctx.client.query(
    `INSERT INTO public.evidence_documents
      (id, organization_id, document_type, document_title, gcs_bucket, gcs_object_name, gcs_generation, sha256, mime_type, byte_size, source_channel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'staff_upload')`,
    [ids.documentId, organizationId, validated.documentType, validated.documentTitle, input.quarantineBucket, input.quarantineObjectName, input.quarantineGeneration, validated.sha256, validated.mimeType, validated.byteSize],
  )
  await ctx.client.query(
    `INSERT INTO public.evidence_payloads
      (evidence_document_id, organization_id, supersedes_evidence_document_id, batch_id, source_file_id, quarantine_bucket, quarantine_object_name,
       quarantine_generation, declared_sha256, mime_type, byte_size, original_filename, uploaded_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      ids.documentId, organizationId, input.supersedesDocumentId, ids.batchId, ids.sourceFileId, input.quarantineBucket, input.quarantineObjectName,
      input.quarantineGeneration, validated.sha256, validated.mimeType, validated.byteSize, validated.originalFilename, ctx.actor.id,
    ],
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Lifecycle transitions. Each returns false when a concurrent writer already moved the payload (the caller reloads).
// ---------------------------------------------------------------------------------------------------------------

export async function applyCleared(ctx: OperationContext, bundle: Bundle, input: { intakeObjectName: string; intakeGeneration: string }): Promise<boolean> {
  const result = await ctx.client.query(
    `UPDATE public.evidence_payloads
        SET lifecycle_state = 'cleared', intake_object_name = $2, intake_generation = $3, cleared_at = clock_timestamp()
      WHERE id = $1 AND lifecycle_state = 'quarantined'`,
    [bundle.payloadId, input.intakeObjectName, input.intakeGeneration],
  )
  if (result.rowCount !== 1) return false
  await record(ctx, "RECORD_STATUS_CHANGED", "clear_evidence_payload", { documentId: bundle.documentId, organizationId: bundle.organizationId }, [
    { field: "payloadState", before: literal("quarantined"), after: literal("cleared") },
  ])
  return true
}

export async function applyBlocked(ctx: OperationContext, bundle: Bundle, reasonInput: unknown): Promise<boolean> {
  if (!isBlockReason(reasonInput)) throw new EvidenceValidationError("reason", "Unsupported block reason.")
  const result = await ctx.client.query(
    `UPDATE public.evidence_payloads SET lifecycle_state = 'blocked', block_reason = $2
      WHERE id = $1 AND lifecycle_state IN ('quarantined', 'cleared')`,
    [bundle.payloadId, reasonInput],
  )
  if (result.rowCount !== 1) return false
  await record(
    ctx,
    "RECORD_STATUS_CHANGED",
    "block_evidence_payload",
    { documentId: bundle.documentId, organizationId: bundle.organizationId },
    [
      { field: "payloadState", before: literal(bundle.state), after: literal("blocked") },
      { field: "blockReason", after: literal(reasonInput) },
    ],
    { outcome: reasonInput === "OPERATOR_BLOCKED" ? "SUCCESS" : "FAILURE", reasonCode: reasonInput },
  )
  return true
}

export async function applyStored(ctx: OperationContext, bundle: Bundle, input: { evidenceBucket: string; evidenceGeneration: string }): Promise<boolean> {
  const objectName = evidenceKey({ organizationId: bundle.organizationId, documentId: bundle.documentId })
  const result = await ctx.client.query(
    `UPDATE public.evidence_payloads
        SET lifecycle_state = 'stored', evidence_bucket = $2, evidence_object_name = $3, evidence_generation = $4,
            verified_sha256 = declared_sha256, stored_at = clock_timestamp()
      WHERE id = $1 AND lifecycle_state = 'cleared'`,
    [bundle.payloadId, input.evidenceBucket, objectName, input.evidenceGeneration],
  )
  if (result.rowCount !== 1) return false
  await ctx.client.query(
    `UPDATE public.evidence_documents SET gcs_bucket = $2, gcs_object_name = $3, gcs_generation = $4, updated_at = clock_timestamp() WHERE id = $1`,
    [bundle.documentId, input.evidenceBucket, objectName, input.evidenceGeneration],
  )
  await record(ctx, "RECORD_STATUS_CHANGED", "store_evidence_payload", { documentId: bundle.documentId, organizationId: bundle.organizationId }, [
    { field: "payloadState", before: literal("cleared"), after: literal("stored") },
    { field: "integrityVerified", after: literal(true) },
  ])

  if (bundle.supersedesDocumentId) {
    const older = await ctx.client.query(
      `UPDATE public.evidence_payloads SET lifecycle_state = 'superseded'
        WHERE evidence_document_id = $1 AND organization_id = $2 AND lifecycle_state = 'stored'`,
      [bundle.supersedesDocumentId, bundle.organizationId],
    )
    await ctx.client.query(
      `UPDATE public.evidence_documents SET document_status = 'archived', archived_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = $1 AND organization_id = $2 AND document_status <> 'archived'`,
      [bundle.supersedesDocumentId, bundle.organizationId],
    )
    await record(ctx, "DOCUMENT_SUPERSEDED", "supersede_evidence_document", { documentId: bundle.supersedesDocumentId, organizationId: bundle.organizationId }, [
      { field: "supersededBy", after: reference("evidence_document", bundle.documentId) },
      { field: "payloadState", after: literal(older.rowCount === 1 ? "superseded" : "unchanged") },
    ])
  }
  return true
}

// ---------------------------------------------------------------------------------------------------------------
// Secure view
// ---------------------------------------------------------------------------------------------------------------

export type ViewTicket = { evidenceObjectName: string; evidenceGeneration: string | null; verifiedSha256: string; mimeType: string; byteSize: number }

/**
 * Authorizes and RECORDS a view: the Master Register event and the access-ledger row are written before any byte is read
 * from storage. If recording fails, the transaction rolls back and the caller never receives a ticket.
 */
export async function recordView(ctx: OperationContext, bundle: Bundle): Promise<ViewTicket> {
  if (!(VIEWABLE_STATES as readonly string[]).includes(bundle.state) || !bundle.evidenceObjectName || !bundle.verifiedSha256) {
    throw new EvidenceStateError("This document is not available to view yet: its payload has not been cleared and stored.")
  }
  const eventId = await record(ctx, "DOCUMENT_VIEWED", "view_evidence_document", { documentId: bundle.documentId, organizationId: bundle.organizationId }, [
    { field: "documentType", after: literal(bundle.documentType) },
    { field: "payloadState", after: literal(bundle.state) },
    { field: "accessKind", after: literal("view") },
  ])
  await ctx.client.query(
    `INSERT INTO public.evidence_payload_access_events (payload_id, evidence_document_id, organization_id, access_kind, actor_id, master_register_event_id)
     VALUES ($1, $2, $3, 'view', $4, $5)`,
    [bundle.payloadId, bundle.documentId, bundle.organizationId, ctx.actor.id, eventId],
  )
  return {
    evidenceObjectName: bundle.evidenceObjectName,
    evidenceGeneration: bundle.evidenceGeneration,
    verifiedSha256: bundle.verifiedSha256,
    mimeType: bundle.mimeType,
    byteSize: bundle.byteSize,
  }
}

/** A stored object whose bytes no longer match the verified hash: recorded as a failed validation, never served. */
export async function recordIntegrityFailure(ctx: OperationContext, bundle: Bundle): Promise<void> {
  await record(
    ctx,
    "VALIDATION_COMPLETED",
    "verify_evidence_payload_on_read",
    { documentId: bundle.documentId, organizationId: bundle.organizationId },
    [{ field: "integrityVerified", after: literal(false) }],
    { outcome: "FAILURE", reasonCode: "EVIDENCE_HASH_MISMATCH" },
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Archive (never delete)
// ---------------------------------------------------------------------------------------------------------------

export async function archiveDocument(ctx: OperationContext, organizationIdInput: unknown, documentIdInput: unknown): Promise<void> {
  const organizationId = requireOrganizationId(organizationIdInput)
  const documentId = requireDocumentId(documentIdInput)
  const bundle = await loadBundle(ctx.client, organizationId, documentId, { lock: true })
  if (bundle.state === "archived" || bundle.documentStatus === "archived") throw new EvidenceStateError("The document is already archived.")
  await record(ctx, "DOCUMENT_ARCHIVED", "archive_evidence_document", { documentId, organizationId }, [
    { field: "documentStatus", before: literal(bundle.documentStatus), after: literal("archived") },
    { field: "payloadState", before: literal(bundle.state), after: literal("archived") },
  ])
  await ctx.client.query(`UPDATE public.evidence_payloads SET lifecycle_state = 'archived' WHERE id = $1`, [bundle.payloadId])
  await ctx.client.query(`UPDATE public.evidence_documents SET document_status = 'archived', archived_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`, [documentId])
}

// ---------------------------------------------------------------------------------------------------------------
// Review and requirement satisfaction
// ---------------------------------------------------------------------------------------------------------------

export type ReviewDecision = "classified" | "verified" | "rejected"

/** Human review of a document. classified / verified need a stored, hash-verified payload - the database refuses otherwise. */
export async function reviewDocument(ctx: OperationContext, input: { organizationId: unknown; documentId: unknown; decision: unknown }): Promise<void> {
  const organizationId = requireOrganizationId(input.organizationId)
  const documentId = requireDocumentId(input.documentId)
  if (input.decision !== "classified" && input.decision !== "verified" && input.decision !== "rejected") {
    throw new EvidenceValidationError("decision", "Unsupported evidence review decision.")
  }
  const bundle = await loadBundle(ctx.client, organizationId, documentId, { lock: true })
  if (bundle.documentStatus === "archived") throw new EvidenceStateError("An archived evidence document cannot be reviewed.")
  if (input.decision !== "rejected" && bundle.state !== "stored") {
    throw new EvidenceStateError("The document can be classified or verified only after its payload is cleared and stored.")
  }
  await record(ctx, "VALIDATION_COMPLETED", "review_evidence_document", { documentId, organizationId }, [
    { field: "documentStatus", before: literal(bundle.documentStatus), after: literal(input.decision) },
  ])
  await ctx.client.query(`UPDATE public.evidence_documents SET document_status = $2, updated_at = clock_timestamp() WHERE id = $1`, [documentId, input.decision])
}

/**
 * Links a stored document to the evidence requirement its type satisfies. The requirement is derived from the document
 * (server-side), never taken from the client. The requirement becomes 'verified' only when the document itself is verified;
 * a stored but unverified document leaves it 'received'. The database re-checks type, organization, payload and verification.
 */
export async function satisfyRequirement(ctx: OperationContext, input: { organizationId: unknown; documentId: unknown }): Promise<{ requirementCode: string; requirementStatus: "received" | "verified" }> {
  const organizationId = requireOrganizationId(input.organizationId)
  const documentId = requireDocumentId(input.documentId)
  const bundle = await loadBundle(ctx.client, organizationId, documentId, { lock: true })
  const definition = REQUIREMENT_CATALOGUE[bundle.documentType]
  if (!definition) throw new EvidenceValidationError("documentId", "This document type does not satisfy an onboarding evidence requirement.")
  if (bundle.state !== "stored" || bundle.documentStatus === "archived" || bundle.documentStatus === "rejected") {
    throw new EvidenceStateError("Only a stored, non-rejected, non-archived document can satisfy a requirement.")
  }
  const status = bundle.documentStatus === "verified" ? "verified" : "received"
  await record(ctx, "EVIDENCE_ASSOCIATED", "satisfy_evidence_requirement", { documentId, organizationId }, [
    { field: "requirementCode", after: literal(bundle.documentType) },
    { field: "requirementStatus", after: literal(status) },
  ])
  await ctx.client.query(
    `INSERT INTO public.onboarding_evidence_requirements
      (id, organization_id, requirement_code, requirement_label, required_for, required_document_type, requirement_status, satisfied_by_evidence_document_id)
     VALUES ($1, $2, $3, $4, $5, $3, $6, $7)
     ON CONFLICT (organization_id, COALESCE(engagement_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), requirement_code)
     DO UPDATE SET requirement_status = EXCLUDED.requirement_status, satisfied_by_evidence_document_id = EXCLUDED.satisfied_by_evidence_document_id, updated_at = clock_timestamp()`,
    [randomUUID(), organizationId, bundle.documentType, definition.label, definition.requiredFor, status, documentId],
  )
  return { requirementCode: bundle.documentType, requirementStatus: status }
}
