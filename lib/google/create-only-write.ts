/**
 * Create-only object write, isolated from `server-only` and the GCS client
 * so its guarantee can be unit tested with a structural fake.
 *
 * `ifGenerationMatch: 0` is GCS's atomic "create only if no live object with
 * this name exists" precondition. It means a quarantine object can never be
 * overwritten by a later (or racing) upload: the original untrusted bytes a
 * scanner assessed are the only bytes that name will ever hold. It also means
 * the portal needs only `storage.objects.create` on the quarantine bucket -
 * no read, list, update, or delete.
 */

export interface CreateOnlySaveOptions {
  resumable: false
  contentType?: string
  metadata?: { metadata: Record<string, string> }
  preconditionOpts: { ifGenerationMatch: 0 }
}

/** The minimal structural slice of a GCS File this helper needs. */
export interface CreateOnlyWritable {
  save(data: Buffer, options: CreateOnlySaveOptions): Promise<void>
}

export class ObjectAlreadyExistsError extends Error {
  constructor() {
    super("An object with this name already exists and cannot be overwritten.")
    this.name = "ObjectAlreadyExistsError"
  }
}

export async function saveCreateOnly(
  file: CreateOnlyWritable,
  data: Buffer | Uint8Array,
  options?: { contentType?: string; metadata?: Record<string, string> },
): Promise<void> {
  try {
    await file.save(Buffer.isBuffer(data) ? data : Buffer.from(data), {
      resumable: false,
      contentType: options?.contentType,
      metadata: options?.metadata ? { metadata: options.metadata } : undefined,
      preconditionOpts: { ifGenerationMatch: 0 },
    })
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 412) throw new ObjectAlreadyExistsError()
    throw error
  }
}
