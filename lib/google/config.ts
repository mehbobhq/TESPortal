import "server-only"

/**
 * Centralized, server-only Google Cloud configuration for TES.
 *
 * Every value here is either read from a server-side environment variable
 * (never NEXT_PUBLIC_*) or derived from one - there are no hardcoded
 * deployment-specific project/bucket/processor identifiers in source. None of
 * these values are secrets: production authentication is keyless (Vercel
 * OIDC -> Google Workload Identity Federation), so there is no private key or
 * service-account JSON for this module to hold.
 *
 * Fail-loud contract: every getter below throws a specific, named error the
 * moment a required environment variable is missing, naming the variable but
 * never any value. Nothing here silently defaults to the wrong project,
 * bucket, or processor.
 *
 * Environment variables (set these in Vercel for production; local
 * development already sets the non-WIF ones in .env.local):
 *   GOOGLE_CLOUD_PROJECT_ID       - e.g. tes-production-510007
 *   GOOGLE_CLOUD_PROJECT_NUMBER   - e.g. 156590412538 (only needed in production, to build the WIF audience)
 *   GOOGLE_DOCUMENT_AI_LOCATION   - e.g. us (defaults to "us" if unset)
 *   GOOGLE_DOCUMENT_AI_PROCESSOR_ID
 *   GOOGLE_BUSINESS_DOCUMENT_AI_PROCESSOR_ID
 *   GOOGLE_GCS_QUARANTINE_BUCKET  - where raw, untrusted application uploads land (create-only; the portal never reads or promotes from it)
 *   GOOGLE_GCS_INTAKE_BUCKET      - holds only scanner-cleared, promoted content; the portal never writes to it
 *   GOOGLE_GCS_EVIDENCE_BUCKET
 *   GOOGLE_WIF_POOL_ID            - only needed in production
 *   GOOGLE_WIF_PROVIDER_ID        - only needed in production
 *   GOOGLE_BACKEND_SERVICE_ACCOUNT - only needed in production
 *   GOOGLE_WIF_OIDC_AUDIENCE      - only needed in production; see workloadIdentityAudience() below for why this is NOT the same value as the Google STS audience
 */

export class GoogleConfigError extends Error {
  readonly missingVariable: string

  constructor(missingVariable: string) {
    super(`Missing required environment variable: ${missingVariable}`)
    this.name = "GoogleConfigError"
    this.missingVariable = missingVariable
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) throw new GoogleConfigError(name)
  return value.trim()
}

export const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"

/** True only in the Vercel Production environment - see lib/google/auth.ts for why this exact signal was chosen over NODE_ENV. */
export function isProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production"
}

// --- Values needed in every environment ---

export function googleProjectId(): string {
  return requireEnv("GOOGLE_CLOUD_PROJECT_ID")
}

export function documentAiLocation(): string {
  return process.env.GOOGLE_DOCUMENT_AI_LOCATION?.trim() || "us"
}

export function roadsideDocumentAiProcessorId(): string {
  return requireEnv("GOOGLE_DOCUMENT_AI_PROCESSOR_ID")
}

export function businessDocumentAiProcessorId(): string {
  return requireEnv("GOOGLE_BUSINESS_DOCUMENT_AI_PROCESSOR_ID")
}

export function quarantineBucketName(): string {
  return requireEnv("GOOGLE_GCS_QUARANTINE_BUCKET")
}

export function intakeBucketName(): string {
  return requireEnv("GOOGLE_GCS_INTAKE_BUCKET")
}

export function evidenceBucketName(): string {
  return requireEnv("GOOGLE_GCS_EVIDENCE_BUCKET")
}

// --- Values needed only in production (Workload Identity Federation) ---
// Non-production never calls these - it authenticates via ADC and has no
// service account to impersonate and no WIF provider to exchange against.

export function backendServiceAccountEmail(): string {
  return requireEnv("GOOGLE_BACKEND_SERVICE_ACCOUNT")
}

export function backendServiceAccountImpersonationUrl(): string {
  return `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${backendServiceAccountEmail()}:generateAccessToken`
}

/**
 * The Security Token Service "audience" for the external_account credential -
 * the canonical Google resource path of the Workload Identity Provider, in
 * the "//iam.googleapis.com/..." form google-auth-library's IdentityPoolClient
 * expects. This is constructed from the project number and pool/provider ids
 * rather than hardcoded, but it is still the one place a safe construction
 * could go wrong (e.g. a pool/provider renamed without updating this), so if
 * Google ever documents or requires a different canonical value for this
 * setup, set it directly via an explicit variable instead of relying on this
 * construction - see GOOGLE_WIF_OIDC_AUDIENCE below, which is a distinct
 * value (the Vercel-side token audience, not this one) and must not be
 * confused with it.
 */
export function workloadIdentityAudience(): string {
  const projectNumber = requireEnv("GOOGLE_CLOUD_PROJECT_NUMBER")
  const poolId = requireEnv("GOOGLE_WIF_POOL_ID")
  const providerId = requireEnv("GOOGLE_WIF_PROVIDER_ID")
  return `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`
}

/**
 * The Vercel-side OIDC token audience (e.g. https://vercel.com/tes-s-projects2)
 * - the `aud` claim Vercel's own default-issued production OIDC token already
 * carries. This is exposed as its own named variable per the deployment
 * configuration requirements, and is available for validation/diagnostics,
 * but is deliberately NOT passed to getVercelOidcToken() in lib/google/auth.ts:
 * passing a custom `audience` there triggers Vercel's OWN token-exchange for a
 * different-audience Vercel token (used for AWS-style integrations), which is
 * not what Google Workload Identity Federation needs here - Google's provider
 * is configured to accept the default Vercel production OIDC token as-is.
 */
export function vercelOidcAudience(): string {
  return requireEnv("GOOGLE_WIF_OIDC_AUDIENCE")
}
