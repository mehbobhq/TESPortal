/**
 * The company change ledger: one append-only row per business operation, with its evidence links. Plain domain logic on a transaction the
 * caller opened (and on which an authorising capability is already in force); no authorization here.
 */
import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"

export type LedgerEvidence = { documentId: string; role: "GOVERNMENT_DOCUMENT" | "WRITTEN_REQUEST" | "DIRECTOR_VERIFICATION" | "REGISTRATION" | "CONFIRMATION" }

export type LedgerInput = {
  organizationId: string
  actorId: string
  operation: string
  summary: string
  previous?: string | null
  next?: string | null
  effectiveAt?: string | null
  source?: "COMPANY_WRITTEN_REQUEST" | "COMPANY_VERBAL_CONFIRMED" | "VERIFIED_CHANNEL_CONFIRMATION" | "STAFF_ENTRY" | null
  request?: { table: "company_legal_name_change_requests" | "company_channel_change_requests"; id: string } | null
  basis?: { kind: "BUSINESS_CONFIRMATION" | "REGISTRATION_EVIDENCE"; reference: string } | null
  eventId?: string | null
  evidence?: LedgerEvidence[]
}

/** A change the edit transaction noticed; it is written to the ledger (with the actor and organization) once the whole edit has been applied. */
export type PlannedChange = Omit<LedgerInput, "organizationId" | "actorId">

const clip = (value: string | null | undefined, max: number) => (value === null || value === undefined ? null : value.length > max ? `${value.slice(0, max - 1)}…` : value)

export async function appendChange(client: Pick<PoolClient, "query">, input: LedgerInput): Promise<string> {
  const id = randomUUID()
  await client.query(
    `INSERT INTO public.company_change_records
       (id, organization_id, operation_code, summary, previous_value, new_value, effective_at, actor_id, request_source, request_table, request_id, basis, basis_reference, master_register_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $9, $10, $11, $12, $13, $14)`,
    [
      id, input.organizationId, input.operation, clip(input.summary, 400), clip(input.previous, 500), clip(input.next, 500), input.effectiveAt ?? null, input.actorId,
      input.source ?? null, input.request?.table ?? null, input.request?.id ?? null, input.basis?.kind ?? null, input.basis?.reference ?? null, input.eventId ?? null,
    ],
  )
  for (const item of input.evidence ?? []) {
    await client.query(
      `INSERT INTO public.company_change_record_evidence (change_record_id, organization_id, evidence_document_id, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [id, input.organizationId, item.documentId, item.role],
    )
  }
  return id
}

export type LedgerRow = {
  id: string
  operation: string
  summary: string
  previousValue: string | null
  newValue: string | null
  effectiveAt: string
  recordedAt: string
  actorId: string
  requestSource: string | null
  requestId: string | null
  basis: string | null
  basisReference: string | null
  masterRegisterEventId: string | null
  evidence: Array<{ documentId: string; role: string }>
}

export async function listLedger(client: Pick<PoolClient, "query">, organizationId: string): Promise<LedgerRow[]> {
  const rows = await client.query(
    `SELECT id, operation_code, summary, previous_value, new_value, effective_at, recorded_at, actor_id, request_source, request_id, basis, basis_reference, master_register_event_id
       FROM public.company_change_records WHERE organization_id = $1 ORDER BY recorded_at DESC, id`,
    [organizationId],
  )
  const links = await client.query(
    `SELECT l.change_record_id, l.evidence_document_id, l.role FROM public.company_change_record_evidence l WHERE l.organization_id = $1 ORDER BY l.created_at`,
    [organizationId],
  )
  const byChange = new Map<string, Array<{ documentId: string; role: string }>>()
  for (const link of links.rows) {
    const list = byChange.get(link.change_record_id) ?? []
    list.push({ documentId: link.evidence_document_id, role: link.role })
    byChange.set(link.change_record_id, list)
  }
  return rows.rows.map((row) => ({
    id: row.id,
    operation: row.operation_code,
    summary: row.summary,
    previousValue: row.previous_value,
    newValue: row.new_value,
    effectiveAt: new Date(row.effective_at).toISOString(),
    recordedAt: new Date(row.recorded_at).toISOString(),
    actorId: row.actor_id,
    requestSource: row.request_source,
    requestId: row.request_id,
    basis: row.basis,
    basisReference: row.basis_reference,
    masterRegisterEventId: row.master_register_event_id,
    evidence: byChange.get(row.id) ?? [],
  }))
}
