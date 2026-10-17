/**
 * Canonical evidence ASSOCIATION operations over the existing public.evidence_links table (migration 0030). No schema change.
 *
 * Like operations.ts, every function runs INSIDE the transaction the authorization wrapper opened and writes its Master Register
 * event through a repository bound to the same client, so a failure anywhere - including the Master Register - rolls the whole
 * change back. Nothing here deletes anything: an association is archived, never removed.
 *
 * Integrity (the database does not enforce these for evidence_links, so this module is the control):
 *   - the document is looked up by organization AND id (another organization's document is "not found");
 *   - the document must be STORED (cleared, scanned, hash-verified) and not archived or rejected; a quarantined, cleared, blocked,
 *     superseded or archived document cannot receive a new association;
 *   - the target must be one of EVIDENCE_LINK_TARGETS, must exist, and must carry the SAME organization_id (a target of another
 *     organization is indistinguishable from a missing one); global vehicle and person records are not targets;
 *   - the actor must hold EVIDENCE_MANAGE (the transaction) AND the target domain's read capability, so evidence can only be attached
 *     to a record the actor may see;
 *   - an active association for the same document, target and relationship is never duplicated (the repeat is a no-op, no new event);
 *   - the association never changes the document's status: attaching evidence is not verification and not compliance.
 *
 * Master Register events carry references (table:id) and controlled literals only.
 */

import { randomUUID } from "node:crypto"
import {
  EVIDENCE_LINK_TARGETS,
  INELIGIBLE_TARGET_STATUSES,
  isEvidenceLinkRelationship,
  isEvidenceLinkTarget,
  type EvidenceLinkRelationship,
  type EvidenceLinkTargetTable,
} from "@/lib/evidence-payload/definitions"
import { EvidenceNotFoundError, EvidenceStateError, EvidenceValidationError } from "@/lib/evidence-payload/errors"
import { loadBundle, requireDocumentId, requireOrganizationId, type OperationContext } from "@/lib/evidence-payload/operations"
import type { EvidenceLinkView } from "@/lib/evidence-payload/types"
import { recordEvent } from "@/lib/master-register/record-event"
import type { FieldChange } from "@/lib/master-register/types"

/** The operation context plus the two capability hooks the (server-only) service supplies. */
export type LinkContext = OperationContext & {
  /** Re-proves `capability` for row-level security on this connection, or throws the authorization denial. */
  enterCapability: (capability: string) => Promise<void>
  /** Whether the already-authorized actor also holds `capability`. */
  hasCapability: (capability: string) => Promise<boolean>
  /** The denial thrown when the actor lacks a required capability. */
  denied: () => Error
}

const literal = (value: string | number | boolean | null) => ({ kind: "LITERAL" as const, value })

function requireUuid(field: string, value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new EvidenceValidationError(field, `${field} must be a valid identifier.`)
  }
  return value.toLowerCase()
}

function requireTarget(value: unknown): EvidenceLinkTargetTable {
  if (!isEvidenceLinkTarget(value)) throw new EvidenceValidationError("targetTable", "This kind of record cannot have evidence associated with it.")
  return value
}

function requireRelationship(value: unknown): EvidenceLinkRelationship {
  if (value === undefined || value === null) return "supports"
  if (!isEvidenceLinkRelationship(value)) throw new EvidenceValidationError("relationshipType", "Unsupported association type.")
  return value
}

async function recordLinkEvent(
  ctx: LinkContext,
  eventType: "EVIDENCE_ASSOCIATED" | "EVIDENCE_ASSOCIATION_REMOVED",
  operation: string,
  link: { linkId: string; documentId: string; organizationId: string; targetTable: string; targetId: string },
  fieldChanges: FieldChange[],
): Promise<void> {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: {
      resourceType: "evidence_link",
      resourceId: link.linkId,
      subjectReferences: [`organization:${link.organizationId}`, `${link.targetTable}:${link.targetId}`],
    },
    source: { sourceType: "APPLICATION", component: "evidence-payload", workflow: operation },
    classification: { materiality: "MATERIAL", sensitivity: "CONFIDENTIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    evidence: { evidenceReferences: [`evidence_document:${link.documentId}`] },
    outcome: { result: "SUCCESS" },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------------

type LinkRow = {
  link_id: string
  document_id: string
  target_table: EvidenceLinkTargetTable
  target_id: string
  relationship_type: EvidenceLinkRelationship
  link_status: "active" | "archived"
  created_at: string
  archived_at: string | null
  document_type: string
  document_title: string
  document_status: EvidenceLinkView["document"]["documentStatus"]
  lifecycle_state: EvidenceLinkView["document"]["payloadState"]
  expires_at: string | null
}

const iso = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** Always joins the document AND filters both the link and the document by organization: another organization's rows never match. */
const LINK_SELECT = `SELECT l.id AS link_id, l.evidence_document_id AS document_id, l.target_table, l.target_id, l.relationship_type, l.link_status,
       ${iso("l.created_at")} AS created_at, CASE WHEN l.archived_at IS NULL THEN NULL ELSE ${iso("l.archived_at")} END AS archived_at,
       d.document_type, d.document_title, d.document_status, p.lifecycle_state, d.expires_at::text AS expires_at
  FROM public.evidence_links l
  JOIN public.evidence_documents d ON d.id = l.evidence_document_id AND d.organization_id = l.organization_id
  JOIN public.evidence_payloads p ON p.evidence_document_id = d.id`

const toView = (row: LinkRow): EvidenceLinkView => ({
  linkId: row.link_id,
  documentId: row.document_id,
  targetTable: row.target_table,
  targetId: row.target_id,
  relationshipType: row.relationship_type,
  status: row.link_status,
  createdAt: row.created_at,
  archivedAt: row.archived_at,
  document: {
    documentType: row.document_type,
    documentTitle: row.document_title,
    documentStatus: row.document_status,
    payloadState: row.lifecycle_state,
    expiresAt: row.expires_at,
  },
})

// ---------------------------------------------------------------------------------------------------------------
// Associate
// ---------------------------------------------------------------------------------------------------------------

export type AssociateInput = { organizationId: unknown; documentId: unknown; targetTable: unknown; targetId: unknown; relationshipType?: unknown }

/** Proves, as the requesting actor, that the target exists and belongs to the organization. Another organization's record is "not found". */
async function assertTargetOwned(ctx: LinkContext, organizationId: string, table: EvidenceLinkTargetTable, targetId: string): Promise<void> {
  // The table name comes from the closed EVIDENCE_LINK_TARGETS map, never from input.
  const result =
    table === "organizations"
      ? await ctx.client.query<{ status: string | null }>(`SELECT NULL::text AS status FROM public.organizations WHERE id = $1 AND id = $2`, [targetId, organizationId])
      : await ctx.client.query<{ status: string | null }>(`SELECT record_status AS status FROM public.${table} WHERE id = $1 AND organization_id = $2`, [targetId, organizationId])
  if (result.rows.length === 0) throw new EvidenceNotFoundError("Record")
  const status = result.rows[0].status
  if (status !== null && INELIGIBLE_TARGET_STATUSES.includes(status)) {
    throw new EvidenceStateError("Evidence cannot be associated with a record that was voided or corrected.")
  }
}

export async function associateEvidence(ctx: LinkContext, input: AssociateInput): Promise<{ link: EvidenceLinkView; created: boolean }> {
  const organizationId = requireOrganizationId(input.organizationId)
  const documentId = requireDocumentId(input.documentId)
  const table = requireTarget(input.targetTable)
  const targetId = requireUuid("targetId", input.targetId)
  const relationship = requireRelationship(input.relationshipType)
  const domainCapability = EVIDENCE_LINK_TARGETS[table].readCapability

  // Fail closed before anything about the document or the target is disclosed.
  if (!(await ctx.hasCapability(domainCapability))) throw ctx.denied()

  const bundle = await loadBundle(ctx.client, organizationId, documentId, { lock: true })
  if (bundle.state !== "stored") throw new EvidenceStateError("Only a stored, scanner-cleared document can be associated with a record.")
  if (bundle.documentStatus === "archived" || bundle.documentStatus === "rejected") {
    throw new EvidenceStateError("An archived or rejected document cannot be associated with a record.")
  }

  // Read the target under the target domain's own capability (row-level security), then return to the evidence capability.
  await ctx.enterCapability(domainCapability)
  try {
    await assertTargetOwned(ctx, organizationId, table, targetId)
  } finally {
    await ctx.enterCapability("EVIDENCE_MANAGE")
  }

  const existing = await ctx.client.query<LinkRow>(
    `${LINK_SELECT} WHERE l.organization_id = $1 AND l.evidence_document_id = $2 AND l.target_table = $3 AND l.target_id = $4 AND l.relationship_type = $5 AND l.link_status = 'active'`,
    [organizationId, documentId, table, targetId, relationship],
  )
  if (existing.rows[0]) return { link: toView(existing.rows[0]), created: false }

  const linkId = randomUUID()
  const inserted = await ctx.client.query(
    `INSERT INTO public.evidence_links (id, evidence_document_id, organization_id, target_table, target_id, relationship_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (evidence_document_id, target_table, target_id, relationship_type) WHERE link_status = 'active' DO NOTHING
     RETURNING id`,
    [linkId, documentId, organizationId, table, targetId, relationship],
  )
  if (inserted.rowCount === 0) {
    // A concurrent identical request won the unique index: this request is the idempotent repeat.
    const winner = await ctx.client.query<LinkRow>(
      `${LINK_SELECT} WHERE l.organization_id = $1 AND l.evidence_document_id = $2 AND l.target_table = $3 AND l.target_id = $4 AND l.relationship_type = $5 AND l.link_status = 'active'`,
      [organizationId, documentId, table, targetId, relationship],
    )
    return { link: toView(winner.rows[0]), created: false }
  }
  await recordLinkEvent(ctx, "EVIDENCE_ASSOCIATED", "associate_evidence", { linkId, documentId, organizationId, targetTable: table, targetId }, [
    { field: "targetTable", after: literal(table) },
    { field: "relationshipType", after: literal(relationship) },
    { field: "linkStatus", after: literal("active") },
  ])
  const created = await ctx.client.query<LinkRow>(`${LINK_SELECT} WHERE l.organization_id = $1 AND l.id = $2`, [organizationId, linkId])
  return { link: toView(created.rows[0]), created: true }
}

// ---------------------------------------------------------------------------------------------------------------
// Archive (never delete)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Archives an association: the row stays, with link_status 'archived' and archived_at, and the document itself is untouched. The
 * Master Register event is the catalogue's own EVIDENCE_ASSOCIATION_REMOVED ("An evidence association was removed."), written in the
 * same transaction. The association leaves active use; its history stays readable and a new association may be made later.
 */
export async function archiveAssociation(ctx: LinkContext, input: { organizationId: unknown; documentId: unknown; linkId: unknown }): Promise<EvidenceLinkView> {
  const organizationId = requireOrganizationId(input.organizationId)
  const documentId = requireDocumentId(input.documentId)
  const linkId = requireUuid("linkId", input.linkId)
  const found = await ctx.client.query<LinkRow>(
    `${LINK_SELECT} WHERE l.organization_id = $1 AND l.evidence_document_id = $2 AND l.id = $3 FOR UPDATE OF l`,
    [organizationId, documentId, linkId],
  )
  if (found.rows.length === 0) throw new EvidenceNotFoundError("Association")
  const link = found.rows[0]
  if (link.link_status === "archived") throw new EvidenceStateError("The association is already archived.")
  await recordLinkEvent(ctx, "EVIDENCE_ASSOCIATION_REMOVED", "archive_evidence_association", { linkId, documentId, organizationId, targetTable: link.target_table, targetId: link.target_id }, [
    { field: "linkStatus", before: literal("active"), after: literal("archived") },
  ])
  await ctx.client.query(`UPDATE public.evidence_links SET link_status = 'archived', archived_at = clock_timestamp() WHERE id = $1 AND organization_id = $2`, [linkId, organizationId])
  const updated = await ctx.client.query<LinkRow>(`${LINK_SELECT} WHERE l.organization_id = $1 AND l.id = $2`, [organizationId, linkId])
  return toView(updated.rows[0])
}

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------

export type ListLinksInput = { organizationId: unknown; documentId?: unknown; targetTable?: unknown; targetId?: unknown; includeArchived?: boolean }

/** By document, or by target. Always limited to the organization; another organization's associations never appear. */
export async function listAssociations(ctx: Pick<OperationContext, "client">, input: ListLinksInput): Promise<EvidenceLinkView[]> {
  const organizationId = requireOrganizationId(input.organizationId)
  const byDocument = input.documentId !== undefined && input.documentId !== null
  const byTarget = input.targetTable !== undefined && input.targetTable !== null
  if (byDocument === byTarget) throw new EvidenceValidationError("query", "Ask for the associations of one document or of one record.")
  const status = input.includeArchived ? "" : "AND l.link_status = 'active'"
  if (byDocument) {
    const documentId = requireDocumentId(input.documentId)
    const rows = await ctx.client.query<LinkRow>(`${LINK_SELECT} WHERE l.organization_id = $1 AND l.evidence_document_id = $2 ${status} ORDER BY l.created_at, l.id`, [organizationId, documentId])
    return rows.rows.map(toView)
  }
  const table = requireTarget(input.targetTable)
  const targetId = requireUuid("targetId", input.targetId)
  const rows = await ctx.client.query<LinkRow>(`${LINK_SELECT} WHERE l.organization_id = $1 AND l.target_table = $2 AND l.target_id = $3 ${status} ORDER BY l.created_at, l.id`, [organizationId, table, targetId])
  return rows.rows.map(toView)
}
