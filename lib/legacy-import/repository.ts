import "server-only"

import type { PoolClient } from "pg"
import type {
  CreateLegacyImportBatchInput,
  CreateLegacyCanonicalRecordMapInput,
  LegacyImportBatch,
  LegacyImportBatchReport,
  LegacyImportCheckpointInput,
  LegacyImportRecord,
  LegacyImportRecordInput,
  LegacyImportRecordStatusInput,
  LegacyImportStageRecordsInput,
  LegacyImportStageRecordsResult,
  LegacyImportReviewDecisionInput,
} from "./types"

type BatchRow = {
  id: string
  source_system: string
  source_namespace: string
  source_description: string | null
  import_mode: "dry_run" | "commit"
  batch_status: "draft" | "running" | "completed" | "failed" | "cancelled"
  requested_by_actor_id: string
  started_at: Date | null
  completed_at: Date | null
  failed_at: Date | null
  failure_reason: string | null
  created_at: Date
  updated_at: Date
}

export async function createCanonicalRecordMap(
  client: PoolClient,
  input: CreateLegacyCanonicalRecordMapInput,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `WITH existing AS (
       SELECT id, canonical_table, canonical_id
       FROM public.legacy_canonical_record_map
       WHERE source_system = $1
         AND source_namespace = $2
         AND legacy_entity_type = $3
         AND legacy_id = $4
         AND mapping_status = 'active'
     ), inserted AS (
       INSERT INTO public.legacy_canonical_record_map
         (source_system, source_namespace, legacy_entity_type, legacy_id, canonical_table, canonical_id, import_batch_id)
       SELECT $1, $2, $3, $4, $5, $6, $7
       WHERE NOT EXISTS (SELECT 1 FROM existing)
       RETURNING id
     )
     SELECT id FROM inserted
     UNION ALL
     SELECT id
     FROM existing
     WHERE canonical_table = $5 AND canonical_id = $6
     LIMIT 1`,
    [
      input.sourceSystem,
      input.sourceNamespace,
      input.legacyEntityType,
      input.legacyId,
      input.canonicalTable,
      input.canonicalId,
      input.importBatchId,
    ],
  )
  if (result.rowCount !== 1) throw new Error("Legacy mapping already exists for a different canonical record.")
  return result.rows[0].id
}

type RecordRow = {
  id: string
  import_batch_id: string
  source_system: string
  source_namespace: string
  legacy_entity_type: LegacyImportRecord["legacyEntityType"]
  legacy_id: string
  source_key: string
  source_sha256: string
  record_status: LegacyImportRecord["recordStatus"]
  canonical_table: string | null
  canonical_id: string | null
  legacy_company_record_map_id: string | null
  legacy_canonical_record_map_id: string | null
  exception_summary: string | null
  created_at: Date
  updated_at: Date
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function toBatch(row: BatchRow): LegacyImportBatch {
  return {
    id: row.id,
    sourceSystem: row.source_system,
    sourceNamespace: row.source_namespace,
    sourceDescription: row.source_description,
    importMode: row.import_mode,
    batchStatus: row.batch_status,
    requestedByActorId: row.requested_by_actor_id,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    failedAt: iso(row.failed_at),
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toRecord(row: RecordRow): LegacyImportRecord {
  return {
    id: row.id,
    importBatchId: row.import_batch_id,
    sourceSystem: row.source_system,
    sourceNamespace: row.source_namespace,
    legacyEntityType: row.legacy_entity_type,
    legacyId: row.legacy_id,
    sourceKey: row.source_key,
    sourceSha256: row.source_sha256,
    recordStatus: row.record_status,
    canonicalTable: row.canonical_table,
    canonicalId: row.canonical_id,
    legacyCompanyRecordMapId: row.legacy_company_record_map_id,
    legacyCanonicalRecordMapId: row.legacy_canonical_record_map_id,
    exceptionSummary: row.exception_summary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function createBatch(
  client: PoolClient,
  actorId: string,
  input: CreateLegacyImportBatchInput,
): Promise<LegacyImportBatch> {
  const result = await client.query<BatchRow>(
    `INSERT INTO public.legacy_import_batches
       (source_system, source_namespace, source_description, import_mode, requested_by_actor_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.sourceSystem, input.sourceNamespace, input.sourceDescription ?? null, input.importMode, actorId],
  )
  return toBatch(result.rows[0])
}

export async function startBatch(client: PoolClient, batchId: string): Promise<LegacyImportBatch> {
  const result = await client.query<BatchRow>(
    `UPDATE public.legacy_import_batches
        SET batch_status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
      WHERE id = $1 AND batch_status = 'draft'
      RETURNING *`,
    [batchId],
  )
  if (result.rowCount !== 1) throw new Error("Legacy import batch could not be started from draft state.")
  return toBatch(result.rows[0])
}

export async function completeBatch(client: PoolClient, batchId: string): Promise<LegacyImportBatch> {
  const result = await client.query<BatchRow>(
    `UPDATE public.legacy_import_batches
        SET batch_status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = $1 AND batch_status = 'running'
      RETURNING *`,
    [batchId],
  )
  if (result.rowCount !== 1) throw new Error("Legacy import batch could not be completed from running state.")
  return toBatch(result.rows[0])
}

export async function failBatch(client: PoolClient, batchId: string, reason: string): Promise<LegacyImportBatch> {
  const result = await client.query<BatchRow>(
    `UPDATE public.legacy_import_batches
        SET batch_status = 'failed', failed_at = now(), failure_reason = $2, updated_at = now()
      WHERE id = $1 AND batch_status = 'running'
      RETURNING *`,
    [batchId, reason],
  )
  if (result.rowCount !== 1) throw new Error("Legacy import batch could not be failed from running state.")
  return toBatch(result.rows[0])
}

export async function insertRecord(client: PoolClient, input: LegacyImportRecordInput): Promise<LegacyImportRecord> {
  const result = await client.query<RecordRow>(
    `INSERT INTO public.legacy_import_records
       (import_batch_id, source_system, source_namespace, legacy_entity_type, legacy_id, source_key, source_sha256,
        source_snapshot, parent_legacy_ids, unsupported_fields)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
     ON CONFLICT (import_batch_id, source_key) DO UPDATE
       SET updated_at = now()
       WHERE public.legacy_import_records.source_sha256 = EXCLUDED.source_sha256
     RETURNING *`,
    [
      input.importBatchId,
      input.sourceSystem,
      input.sourceNamespace,
      input.legacyEntityType,
      input.legacyId,
      input.sourceKey,
      input.sourceSha256,
      JSON.stringify(input.sourceSnapshot),
      JSON.stringify(input.parentLegacyIds ?? {}),
      JSON.stringify(input.unsupportedFields ?? []),
    ],
  )
  if (result.rowCount !== 1) {
    throw new Error("Legacy import source key already exists with different source content.")
  }
  return toRecord(result.rows[0])
}

export async function updateRecordStatus(
  client: PoolClient,
  input: LegacyImportRecordStatusInput,
): Promise<LegacyImportRecord> {
  const result = await client.query<RecordRow>(
    `UPDATE public.legacy_import_records
        SET record_status = $2,
            canonical_table = $3,
            canonical_id = $4,
            legacy_company_record_map_id = $5,
            legacy_canonical_record_map_id = $6,
            secondary_canonical_rows = $7::jsonb,
            unsupported_fields = $8::jsonb,
            exception_summary = $9,
            exception_details = $10::jsonb,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      input.recordId,
      input.recordStatus,
      input.canonicalTable ?? null,
      input.canonicalId ?? null,
      input.legacyCompanyRecordMapId ?? null,
      input.legacyCanonicalRecordMapId ?? null,
      JSON.stringify(input.secondaryCanonicalRows ?? []),
      JSON.stringify(input.unsupportedFields ?? []),
      input.exceptionSummary ?? null,
      JSON.stringify(input.exceptionDetails ?? {}),
    ],
  )
  if (result.rowCount !== 1) throw new Error("Legacy import record was not found.")
  return toRecord(result.rows[0])
}

export async function upsertCheckpoint(client: PoolClient, input: LegacyImportCheckpointInput): Promise<void> {
  await client.query(
    `INSERT INTO public.legacy_import_checkpoints
       (import_batch_id, domain_code, checkpoint_status, processed_count, imported_count, review_count,
        unsupported_count, failed_count, last_source_key, checkpoint_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (import_batch_id, domain_code) DO UPDATE
       SET checkpoint_status = EXCLUDED.checkpoint_status,
           processed_count = EXCLUDED.processed_count,
           imported_count = EXCLUDED.imported_count,
           review_count = EXCLUDED.review_count,
           unsupported_count = EXCLUDED.unsupported_count,
           failed_count = EXCLUDED.failed_count,
           last_source_key = EXCLUDED.last_source_key,
           checkpoint_payload = EXCLUDED.checkpoint_payload,
           updated_at = now()`,
    [
      input.importBatchId,
      input.domainCode,
      input.checkpointStatus,
      input.processedCount,
      input.importedCount ?? 0,
      input.reviewCount ?? 0,
      input.unsupportedCount ?? 0,
      input.failedCount ?? 0,
      input.lastSourceKey ?? null,
      JSON.stringify(input.checkpointPayload ?? {}),
    ],
  )
}

export async function stageRecords(
  client: PoolClient,
  input: LegacyImportStageRecordsInput,
): Promise<LegacyImportStageRecordsResult> {
  const records: LegacyImportRecord[] = []
  let reviewCount = 0
  let unsupportedCount = 0
  let failedCount = 0
  let lastSourceKey: string | null = null

  await upsertCheckpoint(client, {
    importBatchId: input.importBatchId,
    domainCode: input.domainCode,
    checkpointStatus: "running",
    processedCount: 0,
    checkpointPayload: input.checkpointPayload,
  })

  for (const sourceRecord of input.records) {
    lastSourceKey = sourceRecord.sourceKey
    try {
      let staged = await insertRecord(client, sourceRecord)
      if (sourceRecord.sourceUnsupportedFields.length > 0) {
        reviewCount += 1
        staged = await updateRecordStatus(client, {
          recordId: staged.id,
          recordStatus: "review_required",
          unsupportedFields: sourceRecord.sourceUnsupportedFields,
          exceptionSummary: "Legacy source has fields that are not mapped into the canonical import procedure.",
          exceptionDetails: { unsupportedFields: sourceRecord.sourceUnsupportedFields },
        })
      }
      records.push(staged)
    } catch (error) {
      failedCount += 1
      await upsertCheckpoint(client, {
        importBatchId: input.importBatchId,
        domainCode: input.domainCode,
        checkpointStatus: "failed",
        processedCount: records.length + failedCount,
        importedCount: 0,
        reviewCount,
        unsupportedCount,
        failedCount,
        lastSourceKey,
        checkpointPayload: input.checkpointPayload,
      })
      throw error
    }
  }

  const checkpoint: LegacyImportCheckpointInput = {
    importBatchId: input.importBatchId,
    domainCode: input.domainCode,
    checkpointStatus: failedCount > 0 ? "failed" : "completed",
    processedCount: records.length + failedCount,
    importedCount: 0,
    reviewCount,
    unsupportedCount,
    failedCount,
    lastSourceKey,
    checkpointPayload: input.checkpointPayload,
  }
  await upsertCheckpoint(client, checkpoint)

  return { records, checkpoint }
}

export async function readBatchReport(client: PoolClient, importBatchId: string): Promise<LegacyImportBatchReport> {
  const result = await client.query<{
    total_records: string
    by_status: Record<string, number> | null
    by_entity_type: Record<string, number> | null
    exception_count: string
    unsupported_field_count: string
  }>(
    `WITH records AS (
       SELECT *
       FROM public.legacy_import_records
       WHERE import_batch_id = $1
     ),
     status_counts AS (
       SELECT record_status, count(*) AS status_count
       FROM records
       GROUP BY record_status
     ),
     entity_counts AS (
       SELECT legacy_entity_type, count(*) AS entity_count
       FROM records
       GROUP BY legacy_entity_type
     )
     SELECT
       (SELECT count(*)::text FROM records) AS total_records,
       (SELECT COALESCE(jsonb_object_agg(record_status, status_count), '{}'::jsonb) FROM status_counts) AS by_status,
       (SELECT COALESCE(jsonb_object_agg(legacy_entity_type, entity_count), '{}'::jsonb) FROM entity_counts) AS by_entity_type,
       (SELECT count(*)::text FROM records WHERE exception_summary IS NOT NULL) AS exception_count,
       (SELECT COALESCE(sum(jsonb_array_length(unsupported_fields)), 0)::text FROM records) AS unsupported_field_count
     FROM public.legacy_import_batches
     WHERE id = $1`,
    [importBatchId],
  )
  const row = result.rows[0]
  return {
    importBatchId,
    totalRecords: Number(row?.total_records ?? 0),
    byStatus: {
      pending: Number(row?.by_status?.pending ?? 0),
      imported: Number(row?.by_status?.imported ?? 0),
      review_required: Number(row?.by_status?.review_required ?? 0),
      unsupported: Number(row?.by_status?.unsupported ?? 0),
      skipped: Number(row?.by_status?.skipped ?? 0),
      failed: Number(row?.by_status?.failed ?? 0),
    },
    byEntityType: row?.by_entity_type ?? {},
    exceptionCount: Number(row?.exception_count ?? 0),
    unsupportedFieldCount: Number(row?.unsupported_field_count ?? 0),
  }
}

export async function recordReviewDecision(
  client: PoolClient,
  actorId: string,
  input: LegacyImportReviewDecisionInput,
): Promise<void> {
  await client.query(
    `INSERT INTO public.legacy_import_review_decisions
       (import_record_id, decision, decided_by_actor_id, decision_reason, decision_payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.importRecordId,
      input.decision,
      actorId,
      input.decisionReason,
      JSON.stringify(input.decisionPayload ?? {}),
    ],
  )
}
