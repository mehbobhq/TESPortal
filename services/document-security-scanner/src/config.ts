/**
 * Scanner configuration - environment variables only, no hardcoded
 * production bucket/project names, no credentials in source, no
 * NEXT_PUBLIC_* variables (this service has nothing to do with the Next.js
 * build). Every getter throws a named, sanitized error the moment a required
 * variable is missing - fail closed, never silently default.
 */

export class ScannerConfigError extends Error {
  readonly missingVariable: string;

  constructor(missingVariable: string) {
    super(`Missing required environment variable: ${missingVariable}`);
    this.name = "ScannerConfigError";
    this.missingVariable = missingVariable;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new ScannerConfigError(name);
  return value.trim();
}

/** Default matches the current TES canonical intake upload limit (Phase 1). */
const DEFAULT_MAX_OBJECT_BYTES = 25 * 1024 * 1024;

export function googleProjectId(): string {
  return requireEnv("GOOGLE_CLOUD_PROJECT_ID");
}

export function quarantineBucketName(): string {
  return requireEnv("GOOGLE_GCS_QUARANTINE_BUCKET");
}

export function intakeBucketName(): string {
  return requireEnv("GOOGLE_GCS_INTAKE_BUCKET");
}

export function maxObjectBytes(): number {
  const raw = process.env.SCANNER_MAX_OBJECT_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_OBJECT_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ScannerConfigError("SCANNER_MAX_OBJECT_BYTES");
  }
  return parsed;
}

export function port(): number {
  const raw = process.env.PORT?.trim();
  const parsed = raw ? Number(raw) : 8080;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ScannerConfigError("PORT");
  }
  return parsed;
}

/** Wall-clock timeout for a single ClamAV invocation, in milliseconds. */
export function clamScanTimeoutMs(): number {
  const raw = process.env.SCANNER_CLAMSCAN_TIMEOUT_MS?.trim();
  if (!raw) return 60_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ScannerConfigError("SCANNER_CLAMSCAN_TIMEOUT_MS");
  }
  return parsed;
}
