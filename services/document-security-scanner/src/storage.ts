import { Storage } from "@google-cloud/storage";

import { googleProjectId, intakeBucketName, quarantineBucketName } from "./config.js";

/**
 * GCS access for the scanner - deliberately independent of the portal's
 * lib/google/storage.ts (isolation requirement: this service does not
 * import portal code, and vice versa).
 *
 * Authentication: no service-account JSON, no WIF exchange. On Cloud Run,
 * the @google-cloud/storage client's default credential discovery
 * automatically uses the Cloud Run service's attached identity
 * (tes-security-scanner@...) via the metadata server - this is Google
 * Application Default Credentials, exactly as required. No `keyFile` or
 * `credentials` option is passed anywhere in this module.
 */

let cachedStorage: Storage | null = null;

function storageClient(): Storage {
  if (cachedStorage) return cachedStorage;
  cachedStorage = new Storage({ projectId: googleProjectId() });
  return cachedStorage;
}

function quarantineBucket() {
  return storageClient().bucket(quarantineBucketName());
}

function intakeBucket() {
  return storageClient().bucket(intakeBucketName());
}

export interface QuarantineObjectMetadata {
  size: number;
  generation?: string;
  contentType?: string;
}

/**
 * Reads only metadata (no bytes) for a quarantine object - used to enforce
 * the maximum-object-size limit BEFORE any byte download is attempted. The
 * scanner's Storage Object Admin role on Quarantine includes read access, so
 * this works today.
 */
export async function getQuarantineObjectMetadata(objectName: string): Promise<QuarantineObjectMetadata> {
  const [metadata] = await quarantineBucket().file(objectName).getMetadata();
  return {
    size: Number(metadata.size ?? 0),
    generation: metadata.generation !== undefined ? String(metadata.generation) : undefined,
    contentType: metadata.contentType,
  };
}

/** Downloads the full content of a quarantine object. Callers must have already checked size against the configured maximum. */
export async function downloadQuarantineObject(objectName: string): Promise<Buffer> {
  const [content] = await quarantineBucket().file(objectName).download();
  return content;
}

/**
 * Downloads the full content of an Intake object, for post-promotion
 * destination integrity verification only. Requires Storage Object Viewer
 * (storage.objects.get) on the Intake bucket - now granted to
 * tes-security-scanner alongside its existing Storage Object Creator role.
 * This function never writes to Intake; it is read-only.
 */
export async function downloadIntakeObject(objectName: string): Promise<Buffer> {
  const [content] = await intakeBucket().file(objectName).download();
  return content;
}

export type PromotionOutcome =
  | { status: "PROMOTED"; size?: number; generation?: string }
  | { status: "SKIPPED_ALREADY_EXISTS" }
  | { status: "FAILED"; error: unknown };

/**
 * Copies a validated quarantine object to its derived Intake destination.
 *
 * Uses an atomic `ifGenerationMatch: 0` precondition on the destination
 * rather than a plain overwrite. The scanner now also holds Storage Object
 * Viewer on the Intake bucket (added specifically to enable the destination
 * integrity re-verification in src/integrity.ts / src/assessment.ts), but
 * this precondition is kept regardless - it is still the mechanism that
 * guarantees the destination is never overwritten, and it remains the
 * correct atomic, race-free way to express "create only if this object does
 * not already exist" even with read access available. If the destination
 * already exists, GCS returns 412 and the copy never touches it - the
 * caller (assessment.ts) is responsible for then re-verifying whatever
 * object is already there, rather than assuming it is identical.
 *
 * Never deletes the quarantine source - that is a deliberate omission, not
 * an oversight; see the service's promotion/cleanup-policy documentation.
 */
export async function promoteQuarantineObjectToIntake(
  quarantineObjectName: string,
  intakeObjectName: string,
): Promise<PromotionOutcome> {
  const sourceFile = quarantineBucket().file(quarantineObjectName);
  const destinationFile = intakeBucket().file(intakeObjectName);

  try {
    const [, apiResponse] = await sourceFile.copy(destinationFile, {
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    const resource = apiResponse as { size?: string; generation?: string } | undefined;
    return {
      status: "PROMOTED",
      size: resource?.size ? Number(resource.size) : undefined,
      generation: resource?.generation,
    };
  } catch (error) {
    const statusCode = (error as { code?: number })?.code;
    if (statusCode === 412) {
      return { status: "SKIPPED_ALREADY_EXISTS" };
    }
    return { status: "FAILED", error };
  }
}
