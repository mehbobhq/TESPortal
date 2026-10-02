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
 *
 * GENERATION PINNING: every read of, and the promotion copy from, a
 * quarantine object is pinned to ONE exact GCS object generation - the
 * generation named by the Eventarc finalize event. A pinned operation either
 * acts on exactly that generation or fails; it can never silently act on a
 * newer one. See pinnedSource() and assessment.ts.
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

/**
 * A GCS generation is a decimal integer (microseconds since epoch, ~1.7e15 -
 * safely inside Number's exact-integer range). This is validated strictly
 * because the @google-cloud/storage client converts the value with Number()
 * and SILENTLY DROPS the pin when the result is NaN - an unvalidated string
 * would turn a "pinned" operation into an unpinned one.
 */
export function isValidGeneration(generation: unknown): generation is string {
  return typeof generation === "string" && /^[1-9][0-9]{0,18}$/.test(generation) && Number.isSafeInteger(Number(generation));
}

/** The pinned generation is no longer readable/promotable: the object was replaced or removed after it was assessed (or its metadata reports a different generation). Always fail closed. */
export class SourceGenerationUnavailableError extends Error {
  constructor() {
    super("The assessed quarantine object generation is no longer available.");
    this.name = "SourceGenerationUnavailableError";
  }
}

/** The minimal structural slice of a GCS Bucket needed to open a generation-pinned object. */
export interface PinnableBucket<T> {
  file(name: string, options: { generation: string }): T;
}

/**
 * Opens a quarantine object handle scoped to one exact generation. Every
 * subsequent metadata read, download and copy made through the returned
 * handle carries that generation (`generation` / `sourceGeneration` query
 * parameters in the GCS client). Throws for anything that is not a valid
 * generation so a malformed value can never yield an unpinned handle.
 */
export function pinnedSource<T>(bucket: PinnableBucket<T>, objectName: string, generation: string): T {
  if (!isValidGeneration(generation)) throw new SourceGenerationUnavailableError();
  return bucket.file(objectName, { generation });
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 404;
}

export interface QuarantineObjectMetadata {
  size: number;
  generation: string;
  contentType?: string;
}

/**
 * Reads only metadata (no bytes) for the PINNED generation of a quarantine
 * object - used to enforce the maximum-object-size limit BEFORE any byte
 * download is attempted. The returned generation is re-checked against the
 * pin as defense in depth. The scanner's Storage Object Admin role on
 * Quarantine includes read access, so this works today.
 */
export async function getQuarantineObjectMetadata(objectName: string, generation: string): Promise<QuarantineObjectMetadata> {
  const file = pinnedSource(quarantineBucket(), objectName, generation);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if (isNotFound(error)) throw new SourceGenerationUnavailableError();
    throw error;
  }
  if (metadata.generation === undefined || String(metadata.generation) !== generation) {
    throw new SourceGenerationUnavailableError();
  }
  return {
    size: Number(metadata.size ?? 0),
    generation: String(metadata.generation),
    contentType: metadata.contentType,
  };
}

/**
 * Downloads the full content of the PINNED generation of a quarantine
 * object. Callers must have already checked size against the configured
 * maximum. If that generation has been replaced or removed this fails; it
 * never returns the bytes of a newer generation.
 */
export async function downloadQuarantineObject(objectName: string, generation: string): Promise<Buffer> {
  const file = pinnedSource(quarantineBucket(), objectName, generation);
  try {
    const [content] = await file.download();
    return content;
  } catch (error) {
    if (isNotFound(error)) throw new SourceGenerationUnavailableError();
    throw error;
  }
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
  | { status: "SOURCE_GENERATION_UNAVAILABLE" }
  | { status: "FAILED"; error: unknown };

/**
 * Copies the exact scanned quarantine generation to its derived Intake
 * destination. Promotion is conditional on BOTH:
 *  1. source generation == the generation that was assessed (the source
 *     handle is pinned, so GCS copies that generation or answers 404), and
 *  2. the destination not existing (`ifGenerationMatch: 0`).
 *
 * The scanner also holds Storage Object Viewer on Intake for the post-copy
 * SHA-256 re-verification in src/integrity.ts / src/assessment.ts, which
 * remains required as defense in depth; the destination precondition is what
 * guarantees an existing Intake object is never overwritten. Never deletes
 * the quarantine source - that is a deliberate omission, not an oversight.
 */
export async function promoteQuarantineObjectToIntake(
  quarantineObjectName: string,
  intakeObjectName: string,
  sourceGeneration: string,
): Promise<PromotionOutcome> {
  let source;
  try {
    source = pinnedSource(quarantineBucket(), quarantineObjectName, sourceGeneration);
  } catch {
    return { status: "SOURCE_GENERATION_UNAVAILABLE" };
  }
  return copyCreateOnly(source, intakeBucket().file(intakeObjectName));
}

/** The minimal structural slice of a GCS File that copyCreateOnly needs - lets the create-only guarantee be unit tested with a fake. */
export interface CopyableObject {
  copy(
    destination: unknown,
    options: { preconditionOpts: { ifGenerationMatch: 0 } },
  ): Promise<[unknown, unknown]>;
}

/**
 * The create-only copy itself: always sends the atomic `ifGenerationMatch: 0`
 * precondition, so an existing destination is NEVER overwritten or merged
 * (GCS answers 412 and touches nothing, which maps to SKIPPED_ALREADY_EXISTS -
 * the caller then verifies whatever is already there by hash). A 404 means the
 * pinned source generation is gone (SOURCE_GENERATION_UNAVAILABLE - nothing was
 * written). Any other failure maps to FAILED, never to success.
 */
export async function copyCreateOnly(sourceFile: CopyableObject, destinationFile: unknown): Promise<PromotionOutcome> {
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
    if (statusCode === 404) {
      return { status: "SOURCE_GENERATION_UNAVAILABLE" };
    }
    return { status: "FAILED", error };
  }
}
