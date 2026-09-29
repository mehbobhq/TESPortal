import "server-only"
import { Storage, type StorageOptions } from "@google-cloud/storage"
import { evidenceBucketName, googleProjectId, intakeBucketName } from "./config"
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
 * TES GCS foundation - intake (temporary/raw processing uploads) and
 * evidence (permanent) buckets, both server-only.
 *
 * This establishes the storage foundation only: it does not implement the
 * full ingestion pipeline (segmentation, classification, canonical records).
 *
 * Security invariants enforced structurally by this module:
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

function intakeBucket() {
  return storageClient().bucket(intakeBucketName())
}

function evidenceBucket() {
  return storageClient().bucket(evidenceBucketName())
}

/** Uploads raw bytes to the temporary intake bucket. Returns the object name. */
export async function uploadIntakeObject(
  objectName: string,
  data: Buffer | Uint8Array,
  options?: { contentType?: string },
): Promise<{ bucket: string; objectName: string }> {
  const file = intakeBucket().file(objectName)
  await file.save(Buffer.isBuffer(data) ? data : Buffer.from(data), {
    resumable: false,
    contentType: options?.contentType,
  })
  return { bucket: intakeBucketName(), objectName }
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
