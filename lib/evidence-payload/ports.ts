/**
 * The storage boundary of the evidence payload lifecycle. The service talks to this interface only; production wires the
 * GCS adapter (gcs-adapter.ts), tests wire an in-memory fake. Every method is create-only or read-only: there is no delete,
 * no overwrite, no signed URL and no public URL on this interface.
 */

export type StoredObjectInfo = { generation: string; size: number }

export interface EvidenceStoragePort {
  /** Create-only write of untrusted bytes into the quarantine bucket. Resolves the generation when known. */
  putQuarantine(objectName: string, bytes: Buffer, options: { contentType: string; metadata: Record<string, string> }): Promise<{ generation: string | null }>
  /** Live intake object (written only by the scanner) or null. */
  statIntake(objectName: string): Promise<StoredObjectInfo | null>
  readIntake(objectName: string, generation: string): Promise<Buffer>
  /** Create-only copy of the scanned intake generation into evidence. created=false means the destination already existed. */
  copyIntakeToEvidence(intakeObjectName: string, intakeGeneration: string, evidenceObjectName: string): Promise<{ created: boolean; generation: string | null }>
  statEvidence(objectName: string): Promise<StoredObjectInfo | null>
  readEvidence(objectName: string, generation?: string): Promise<Buffer>
  /** Read-only listing for the consistency audit. */
  listObjects(stage: "quarantine" | "intake" | "evidence", prefix: string, pageToken?: string): Promise<{ objects: Array<{ name: string; generation: string; size: number }>; nextPageToken: string | null }>
  bucketNames(): { quarantine: string; intake: string; evidence: string }
}
