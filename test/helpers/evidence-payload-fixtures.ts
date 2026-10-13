// Admin-pool (table owner) fixtures that build a payload-backed evidence document without storage, using only the valid
// lifecycle transitions - so tests that need a "verified, stored" document exercise the real database guards.

import { randomUUID } from "node:crypto";
import type pg from "pg";
import { sha256 } from "./fake-evidence-storage";

export async function seedPayloadBackedDocument(
  admin: pg.Pool,
  input: { organizationId: string; actorId: string; documentType: string; status?: "received" | "classified" | "verified"; stage?: "quarantined" | "stored" },
): Promise<string> {
  const documentId = randomUUID();
  const batchId = randomUUID();
  const sourceFileId = randomUUID();
  const bytes = Buffer.from(`%PDF-1.4 ${documentId}`);
  const hash = sha256(bytes);
  const quarantineName = `quarantine/${input.organizationId}/${batchId}/${sourceFileId}/source`;
  const evidenceName = `evidence/${input.organizationId}/${documentId}/source`;
  await admin.query(
    `INSERT INTO public.evidence_documents (id, organization_id, document_type, document_title, gcs_bucket, gcs_object_name, sha256, mime_type, byte_size, source_channel)
     VALUES ($1, $2, $3, $4, 'tes-test-quarantine', $5, $6, 'application/pdf', $7, 'staff_upload')`,
    [documentId, input.organizationId, input.documentType, `${input.documentType} fixture`, quarantineName, hash, bytes.byteLength],
  );
  await admin.query(
    `INSERT INTO public.evidence_payloads (evidence_document_id, organization_id, batch_id, source_file_id, quarantine_bucket, quarantine_object_name,
       declared_sha256, mime_type, byte_size, original_filename, uploaded_by_actor_id)
     VALUES ($1, $2, $3, $4, 'tes-test-quarantine', $5, $6, 'application/pdf', $7, 'fixture.pdf', $8)`,
    [documentId, input.organizationId, batchId, sourceFileId, quarantineName, hash, bytes.byteLength, input.actorId],
  );
  if ((input.stage ?? "stored") === "stored") {
    await admin.query(
      `UPDATE public.evidence_payloads SET lifecycle_state = 'cleared', intake_object_name = $2, intake_generation = '1', cleared_at = now() WHERE evidence_document_id = $1`,
      [documentId, quarantineName.replace("quarantine/", "intake/")],
    );
    await admin.query(
      `UPDATE public.evidence_payloads SET lifecycle_state = 'stored', evidence_bucket = 'tes-test-evidence', evidence_object_name = $2, evidence_generation = '2',
         verified_sha256 = declared_sha256, stored_at = now() WHERE evidence_document_id = $1`,
      [documentId, evidenceName],
    );
    await admin.query(`UPDATE public.evidence_documents SET gcs_bucket = 'tes-test-evidence', gcs_object_name = $2, gcs_generation = '2' WHERE id = $1`, [documentId, evidenceName]);
    if (input.status && input.status !== "received") {
      await admin.query(`UPDATE public.evidence_documents SET document_status = $2 WHERE id = $1`, [documentId, input.status]);
    }
  }
  return documentId;
}
