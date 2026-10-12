import "server-only"

import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import * as repository from "./repository"
import type {
  CreateLegacyCanonicalRecordMapInput,
  CreateLegacyImportBatchInput,
  LegacyImportCheckpointInput,
  LegacyImportBatch,
  LegacyImportBatchReport,
  LegacyImportRecord,
  LegacyImportRecordInput,
  LegacyImportRecordStatusInput,
  LegacyImportStageRecordsInput,
  LegacyImportStageRecordsResult,
  LegacyImportReviewDecisionInput,
} from "./types"

export type * from "./types"

function actorId(decision: SystemAuthorizationDecision): string {
  return decision.actor.id
}

export function createLegacyImportBatch(input: CreateLegacyImportBatchInput): Promise<LegacyImportBatch> {
  return withAuthorizedSystem("LEGACY_IMPORT_MANAGE", (client, decision) =>
    repository.createBatch(client, actorId(decision), input),
  )
}

export function startLegacyImportBatch(batchId: string): Promise<LegacyImportBatch> {
  return withAuthorizedSystem("LEGACY_IMPORT_MANAGE", (client) => repository.startBatch(client, batchId))
}

export function completeLegacyImportBatch(batchId: string): Promise<LegacyImportBatch> {
  return withAuthorizedSystem("LEGACY_IMPORT_MANAGE", (client) => repository.completeBatch(client, batchId))
}

export function failLegacyImportBatch(batchId: string, reason: string): Promise<LegacyImportBatch> {
  return withAuthorizedSystem("LEGACY_IMPORT_MANAGE", (client) => repository.failBatch(client, batchId, reason))
}

export function insertLegacyImportRecord(input: LegacyImportRecordInput): Promise<LegacyImportRecord> {
  return withAuthorizedSystem("LEGACY_IMPORT_MANAGE", (client) => repository.insertRecord(client, input))
}

export function createLegacyCanonicalRecordMap(input: CreateLegacyCanonicalRecordMapInput): Promise<string> {
  return withAuthorizedSystem("LEGACY_IMPORT_MANAGE", (client) => repository.createCanonicalRecordMap(client, input))
}

export function updateLegacyImportRecordStatus(input: LegacyImportRecordStatusInput): Promise<LegacyImportRecord> {
  return withAuthorizedSystem("LEGACY_IMPORT_MANAGE", (client) => repository.updateRecordStatus(client, input))
}

export function upsertLegacyImportCheckpoint(input: LegacyImportCheckpointInput): Promise<void> {
  return withAuthorizedSystem("LEGACY_IMPORT_MANAGE", (client) => repository.upsertCheckpoint(client, input))
}

export function stageLegacyImportRecords(input: LegacyImportStageRecordsInput): Promise<LegacyImportStageRecordsResult> {
  return withAuthorizedSystem("LEGACY_IMPORT_MANAGE", (client) => repository.stageRecords(client, input))
}

export function readLegacyImportBatchReport(importBatchId: string): Promise<LegacyImportBatchReport> {
  return withAuthorizedSystem("LEGACY_IMPORT_READ", (client) => repository.readBatchReport(client, importBatchId))
}

export function recordLegacyImportReviewDecision(input: LegacyImportReviewDecisionInput): Promise<void> {
  return withAuthorizedSystem("LEGACY_IMPORT_MANAGE", (client, decision) =>
    repository.recordReviewDecision(client, actorId(decision), input),
  )
}
