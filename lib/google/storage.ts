import "server-only"
import { Storage, type StorageOptions } from "@google-cloud/storage"
import { evidenceBucketName, googleProjectId, intakeBucketName, quarantineBucketName } from "./config"
import { saveCreateOnly } from "./create-only-write"
import { getGoogleAuthClient } from "./auth"

// @google-cloud/storage depends on its own google-auth-library instance
// (pinned to the same major version as the one this project installs
// directly, but still a structurally distinct type from TypeScript's point
// of view). getGoogleAuthClient()'s return type is duck-type compatible at
// runtime - Storage only ever calls the standard AuthClient/GoogleAuth
// methods (getAccessToken/getRequestHeaders/request) on whatever is passed -
// so this cast is derived directly from Storage's own declared option type
// rather than guessed, and is here solely to bridge that generic-parameter
// mismatch, not to paper over an actual behavioral difference.
type StorageAuthClient = NonNullable<StorageOptions["authClient"]>

/**
 * TES GCS foundation - quarantine (raw, untrusted uploads), intake
 * (scanner-cleared, promoted content only) and evidence (permanent) buckets,
 * all server-only.
 *
 * This establishes the storage foundation only: it does not implement the
 * full ingestion pipeline (segmentation, classification, canonical records).
 *
 * Security invariants enforced structurally by this module:
 * - Raw application uploads can only be written to QUARANTINE (create-only,
 *   see uploadQuarantineObject). There is deliberately no function in this
 *   module that writes raw bytes to the intake bucket: only the isolated
 *   document-security-scanner service promotes quarantine -> intake, and only
 *   for a CLEARED security decision.
 * - No public URLs are ever generated (no getSignedUrl/makePublic calls exist
 *   here at all).
 * - There is no evidence-delete or evidence-overwrite operation. Evidence is
 *   retained, never silently replaced - see moveIntakeObjectToEvidence below,
 *   which copies into evidence and only ever deletes from intake.
 */

let cachedStorage: Storage | null = null

function storageClient(): Storage {
  if (cachedStorage) return cachedStorage
  cachedStorage = new Storage({
    projectId: googleProjectId(),
    authClient: getGoogleAuthClient() as unknown as StorageAuthClient,
  })
  return cachedStorage
}

function quarantineBucket() {
  return storageClient().bucket(quarantineBucketName())
}

function intakeBucket() {
  return storageClient().bucket(intakeBucketName())
}

function evidenceBucket() {
  return storageClient().bucket(evidenceBucketName())
}

/**
 * Uploads raw, untrusted bytes to the QUARANTINE bucket. Returns the object
 * name. Success means only "accepted into quarantine" - it says nothing about
 * security clearance, processing, or evidence status; the scanner decides
 * that asynchronously (Eventarc) and is the only thing that can promote the
 * object to intake.
 *
 * The write is create-only (see create-only-write.ts): an existing quarantine
 * object is never overwritten. This runtime therefore needs only
 * storage.objects.create on the quarantine bucket.
 *
 * `options.metadata` is stored as GCS custom object metadata (safe tracing
 * identifiers only - e.g. batch/source-file ids and original filename, never
 * secrets or extracted document contents; callers are responsible for that).
 */
export async function uploadQuarantineObject(
  objectName: string,
  data: Buffer | Uint8Array,
  options?: { contentType?: string; metadata?: Record<string, string> },
): Promise<{ bucket: string; objectName: string }> {
  await saveCreateOnly(quarantineBucket().file(objectName), data, options)
  return { bucket: quarantineBucketName(), objectName }
}

/** Returns true if the given object exists in the intake bucket. */
export async function intakeObjectExists(objectName: string): Promise<boolean> {
  const [exists] = await intakeBucket().file(objectName).exists()
  return exists
}

/** Returns true if the given object exists in the evidence bucket. */
export async function evidenceObjectExists(objectName: string): Promise<boolean> {
  const [exists] = await evidenceBucket().file(objectName).exists()
  return exists
}

/** Reads object metadata (size, content type, updated time, etc.) from the intake bucket. */
export async function getIntakeObjectMetadata(objectName: string) {
  const [metadata] = await intakeBucket().file(objectName).getMetadata()
  return metadata
}

/** Reads object metadata from the evidence bucket. */
export async function getEvidenceObjectMetadata(objectName: string) {
  const [metadata] = await evidenceBucket().file(objectName).getMetadata()
  return metadata
}

/** Downloads the full content of an intake object. */
export async function downloadIntakeObject(objectName: string): Promise<Buffer> {
  const [content] = await intakeBucket().file(objectName).download()
  return content
}

/** Downloads the full content of an evidence object. */
export async function downloadEvidenceObject(objectName: string): Promise<Buffer> {
  const [content] = await evidenceBucket().file(objectName).download()
  return content
}

/**
 * Promotes a validated intake object to permanent evidence storage under its
 * canonical filename, then removes the source from intake only.
 *
 * This is deliberately copy-then-delete-from-intake, not a rename/move
 * primitive, and there is no equivalent function that deletes or overwrites
 * an evidence object - evidence is retained, never silently replaced. If the
 * destination evidence object already exists, this throws rather than
 * overwriting it.
 */
export async function moveIntakeObjectToEvidence(
  intakeObjectName: string,
  evidenceObjectName: string,
): Promise<{ bucket: string; objectName: string }> {
  const destinationExists = await evidenceObjectExists(evidenceObjectName)
  if (destinationExists) {
    throw new Error(`Evidence object already exists and cannot be overwritten: ${evidenceObjectName}`)
  }

  const sourceFile = intakeBucket().file(intakeObjectName)
  const destinationFile = evidenceBucket().file(evidenceObjectName)
  await sourceFile.copy(destinationFile)
  await sourceFile.delete()

  return { bucket: evidenceBucketName(), objectName: evidenceObjectName }
}

// ---------------------------------------------------------------------------------------------------------------------
// Evidence payload lifecycle primitives (lib/evidence-payload). Read, stat, list and a create-only copy. Nothing here
// deletes, overwrites or makes anything public; no signed or public URL is ever produced.
// ---------------------------------------------------------------------------------------------------------------------

export type StorageBucketKind = "quarantine" | "intake" | "evidence"

function bucketFor(kind: StorageBucketKind) {
  return kind === "quarantine" ? quarantineBucket() : kind === "intake" ? intakeBucket() : evidenceBucket()
}

export function configuredBucketNames(): Record<StorageBucketKind, string> {
  return { quarantine: quarantineBucketName(), intake: intakeBucketName(), evidence: evidenceBucketName() }
}

/** Generation and size of the live object, or null when it does not exist. */
export async function statStorageObject(kind: StorageBucketKind, objectName: string): Promise<{ generation: string; size: number } | null> {
  const file = bucketFor(kind).file(objectName)
  const [exists] = await file.exists()
  if (!exists) return null
  const [metadata] = await file.getMetadata()
  return { generation: String(metadata.generation), size: Number(metadata.size) }
}

/** Reads an object; when a generation is given the read is pinned to it (a replaced object fails rather than substituting). */
export async function readStorageObject(kind: StorageBucketKind, objectName: string, generation?: string): Promise<Buffer> {
  const file = generation ? bucketFor(kind).file(objectName, { generation }) : bucketFor(kind).file(objectName)
  const [content] = await file.download()
  return content
}

/**
 * Copies the exact scanned intake generation into the evidence bucket. Create-only (`ifGenerationMatch: 0`): an existing
 * evidence object is never overwritten, and the source is never deleted. Returns created=false when the destination already
 * existed (the caller must then verify its hash before trusting it).
 */
export async function copyIntakeToEvidenceCreateOnly(
  intakeObjectName: string,
  intakeGeneration: string,
  evidenceObjectName: string,
): Promise<{ generation: string; created: boolean } | { created: false; generation: null }> {
  const source = intakeBucket().file(intakeObjectName, { generation: intakeGeneration })
  const destination = evidenceBucket().file(evidenceObjectName)
  try {
    const [, apiResponse] = await source.copy(destination, { preconditionOpts: { ifGenerationMatch: 0 } })
    const generation = (apiResponse as { resource?: { generation?: string | number } } | undefined)?.resource?.generation
    return { generation: String(generation ?? ""), created: true }
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 412) return { created: false, generation: null }
    throw error
  }
}

/** One page of object names under a prefix (read-only; for the consistency audit). */
export async function listStorageObjects(
  kind: StorageBucketKind,
  prefix: string,
  pageToken?: string,
  pageSize = 500,
): Promise<{ objects: Array<{ name: string; generation: string; size: number }>; nextPageToken: string | null }> {
  const [files, nextQuery] = await bucketFor(kind).getFiles({ prefix, maxResults: pageSize, pageToken, autoPaginate: false })
  return {
    objects: files.map((file) => ({ name: file.name, generation: String(file.metadata.generation), size: Number(file.metadata.size) })),
    nextPageToken: (nextQuery as { pageToken?: string } | null)?.pageToken ?? null,
  }
}
