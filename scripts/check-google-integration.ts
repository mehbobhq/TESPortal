/**
 * TES Google integration health check.
 *
 * Read-only, non-destructive diagnostic for the production Google foundation
 * (Workload Identity Federation / ADC -> GCS + Document AI). It never writes
 * or deletes any object, and it never prints a token, credential, header, or
 * raw exception - only a fixed "ok" or a short sanitized error code per
 * check, so its output is safe to paste into a chat, a PR, or a log.
 *
 * This is intentionally a plain, standalone script with NO dependency on
 * lib/google/* (which are marked "server-only" and are only meant to be
 * loaded through Next.js's bundler) and NO special Node loader/module-config
 * flags. It reads the exact same environment variables and follows the exact
 * same production/non-production branching as lib/google/auth.ts and
 * lib/google/config.ts, but does so independently so it stays trivially
 * runnable with:
 *
 *   node scripts/check-google-integration.ts
 *
 * (Node 22.6+/24 strips TypeScript type annotations natively - no build step
 * or extra dependency such as tsx/ts-node is required. This file avoids
 * TypeScript syntax that requires transformation rather than pure erasure,
 * such as constructor parameter properties, so Node's strip-only mode can run
 * it directly.)
 *
 * What this proves and does not prove:
 * - Run locally, this exercises the LOCAL Application Default Credentials
 *   path. It does NOT exercise, and cannot exercise, the production Vercel
 *   OIDC -> Workload Identity Federation path - that only exists inside the
 *   Vercel Production runtime. A local "ok" here is evidence the ADC path and
 *   the GCS/Document AI resources are reachable with whatever identity ran
 *   this script; it is not evidence the production identity works.
 */

import { GoogleAuth, IdentityPoolClient } from "google-auth-library"
import { getVercelOidcToken } from "@vercel/oidc"
import { Storage, type StorageOptions } from "@google-cloud/storage"

// See the identical cast in lib/google/storage.ts: @google-cloud/storage
// depends on its own google-auth-library instance, so its authClient option
// type is structurally distinct from this script's, even when both resolve
// to the same package version. Duck-type compatible at runtime.
type StorageAuthClient = NonNullable<StorageOptions["authClient"]>

const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"

function isProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production"
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) throw new Error(`MISSING_ENV:${name}`)
  return value.trim()
}

async function getAccessToken(): Promise<{ token: string; authClient: unknown }> {
  if (isProductionRuntime()) {
    const projectNumber = requireEnv("GOOGLE_CLOUD_PROJECT_NUMBER")
    const poolId = requireEnv("GOOGLE_WIF_POOL_ID")
    const providerId = requireEnv("GOOGLE_WIF_PROVIDER_ID")
    const backendServiceAccount = requireEnv("GOOGLE_BACKEND_SERVICE_ACCOUNT")

    const client = new IdentityPoolClient({
      type: "external_account",
      audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${backendServiceAccount}:generateAccessToken`,
      subject_token_supplier: {
        getSubjectToken: async () => getVercelOidcToken(),
      },
    })
    const { token } = await client.getAccessToken()
    if (!token) throw new Error("EMPTY_TOKEN")
    return { token, authClient: client }
  }

  const auth = new GoogleAuth({ scopes: [GOOGLE_CLOUD_PLATFORM_SCOPE] })
  const token = await auth.getAccessToken()
  if (!token) throw new Error("EMPTY_TOKEN")
  return { token, authClient: auth }
}

type CheckResult = "ok" | string // "ok" or a short sanitized error code

async function checkAuthentication(): Promise<{ result: CheckResult; authClient?: unknown; token?: string }> {
  try {
    const { authClient, token } = await getAccessToken()
    return { result: "ok", authClient, token }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MISSING_ENV:")) {
      return { result: error.message }
    }
    return { result: isProductionRuntime() ? "PRODUCTION_WORKLOAD_IDENTITY_FAILED" : "LOCAL_ADC_NOT_CONFIGURED" }
  }
}

async function checkBucket(authClient: unknown, bucketEnvVar: string): Promise<CheckResult> {
  try {
    const projectId = requireEnv("GOOGLE_CLOUD_PROJECT_ID")
    const bucketName = requireEnv(bucketEnvVar)
    const storage = new Storage({ projectId, authClient: authClient as unknown as StorageAuthClient })
    // A read-only reachability/permission check only - this never writes or
    // deletes an object, per the diagnostic hardening requirement.
    await storage.bucket(bucketName).file("__tes_health_check_nonexistent_object__").exists()
    return "ok"
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MISSING_ENV:")) return error.message
    return "BUCKET_UNREACHABLE_OR_FORBIDDEN"
  }
}

async function checkDocumentAiReachable(token: string): Promise<CheckResult> {
  try {
    const projectId = requireEnv("GOOGLE_CLOUD_PROJECT_ID")
    const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION?.trim() || "us"
    const processorId = requireEnv("GOOGLE_DOCUMENT_AI_PROCESSOR_ID")
    // A GET on the processor resource itself - metadata only, does not
    // submit any document and does not consume Document AI processing quota.
    const url = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    return response.ok ? "ok" : `DOCUMENT_AI_HTTP_${response.status}`
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MISSING_ENV:")) return error.message
    return "DOCUMENT_AI_UNREACHABLE"
  }
}

async function main() {
  const auth = await checkAuthentication()

  const results = {
    runtime: isProductionRuntime() ? "production" : "non-production (ADC)",
    authentication: auth.result,
    // The remaining checks only make sense once authentication succeeded -
    // without a working auth client there is nothing valid to check bucket/
    // processor reachability WITH, so they are reported as skipped rather
    // than attempted with no credentials (which would just always fail and
    // add noise, not information).
    intakeBucket: auth.result === "ok" ? await checkBucket(auth.authClient, "GOOGLE_GCS_INTAKE_BUCKET") : "SKIPPED_AUTH_FAILED",
    evidenceBucket: auth.result === "ok" ? await checkBucket(auth.authClient, "GOOGLE_GCS_EVIDENCE_BUCKET") : "SKIPPED_AUTH_FAILED",
    documentAI: auth.result === "ok" && auth.token ? await checkDocumentAiReachable(auth.token) : "SKIPPED_AUTH_FAILED",
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(results, null, 2))

  const allOk = Object.entries(results).every(([key, value]) => key === "runtime" || value === "ok")
  process.exit(allOk ? 0 : 1)
}

void main()
