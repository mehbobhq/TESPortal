import "server-only"
import { GoogleAuth, IdentityPoolClient } from "google-auth-library"
import { getVercelOidcToken } from "@vercel/oidc"
import {
  GOOGLE_CLOUD_PLATFORM_SCOPE,
  backendServiceAccountImpersonationUrl,
  isProductionRuntime,
  workloadIdentityAudience,
} from "./config"

/**
 * TES production Google authentication.
 *
 * Two completely separate, non-interchangeable paths - see the task this
 * module was written for. There is deliberately no shared try/catch that
 * could swap one for the other; `getGoogleAccessToken()` picks exactly one
 * path per call based on `isProductionRuntime()` and never falls through to
 * the other.
 *
 * PRODUCTION (Vercel Production environment only):
 *   Vercel OIDC token -> Google Workload Identity Federation (STS token
 *   exchange) -> impersonate tes-backend -> short-lived access token.
 *   No static key is read, held, or referenced anywhere on this path.
 *
 * NON-PRODUCTION (local development, Preview, anything else):
 *   Google Application Default Credentials (ADC) only - the official
 *   google-auth-library discovery chain (GOOGLE_APPLICATION_CREDENTIALS file,
 *   `gcloud auth application-default login` cache, or a GCP metadata server).
 *   This path cannot reach the production tes-backend identity: the Google
 *   Workload Identity Provider's own condition
 *   (assertion.sub == 'owner:tes-s-projects2:project:tesportal:environment:production')
 *   only ever accepts the Production Vercel OIDC subject, and this code path
 *   never even attempts the WIF exchange outside production, so the
 *   restriction does not depend on the Google-side condition alone.
 *   It never reads GOOGLE_APPLICATION_CREDENTIALS_JSON (the legacy
 *   raw-JSON-in-an-env-var format) - that remains untouched, legacy-only
 *   migration material per the task, not a fallback this module uses.
 */

export class GoogleAuthConfigurationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "GoogleAuthConfigurationError"
    this.code = code
  }
}

let cachedProductionClient: IdentityPoolClient | null = null
let cachedLocalAuth: GoogleAuth | null = null

function getProductionClient(): IdentityPoolClient {
  if (cachedProductionClient) return cachedProductionClient

  cachedProductionClient = new IdentityPoolClient({
    type: "external_account",
    audience: workloadIdentityAudience(),
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    service_account_impersonation_url: backendServiceAccountImpersonationUrl(),
    subject_token_supplier: {
      // Deliberately no try/catch here that would fall back to a different
      // credential mechanism - a failure here is a failure of the whole
      // production auth path, by design (fail closed).
      getSubjectToken: async () => getVercelOidcToken(),
    },
  })

  return cachedProductionClient
}

function getLocalAdcAuth(): GoogleAuth {
  if (cachedLocalAuth) return cachedLocalAuth
  // No `keyFile`/`credentials` option is passed: this is exactly the
  // official ADC discovery chain and nothing else. It will never read
  // GOOGLE_APPLICATION_CREDENTIALS_JSON (that is not a name google-auth-library
  // recognizes) and will never silently pick up the legacy key.
  cachedLocalAuth = new GoogleAuth({ scopes: [GOOGLE_CLOUD_PLATFORM_SCOPE] })
  return cachedLocalAuth
}

/**
 * Returns the underlying auth client instance for the current runtime
 * (production: the WIF IdentityPoolClient; non-production: the ADC
 * GoogleAuth instance), for callers such as @google-cloud/storage that accept
 * an `authClient`/`GoogleAuth` object directly instead of a bearer token
 * string. Same fail-closed, no-fallback contract as getGoogleAccessToken().
 */
export function getGoogleAuthClient(): IdentityPoolClient | GoogleAuth {
  return isProductionRuntime() ? getProductionClient() : getLocalAdcAuth()
}

/**
 * Returns a short-lived Google access token for the current runtime.
 * Never logs the token, the underlying error, or any credential material -
 * callers must not either.
 */
export async function getGoogleAccessToken(): Promise<string> {
  if (isProductionRuntime()) {
    try {
      const client = getProductionClient()
      const { token } = await client.getAccessToken()
      if (!token) throw new Error("empty token")
      return token
    } catch {
      // Sanitized by design: never surface the caught error (Google/Vercel
      // client errors can embed request/response detail), only a fixed code.
      throw new GoogleAuthConfigurationError(
        "PRODUCTION_WORKLOAD_IDENTITY_FAILED",
        "Google Workload Identity Federation authentication failed in production. This request cannot proceed; there is no fallback credential path.",
      )
    }
  }

  try {
    const auth = getLocalAdcAuth()
    const token = await auth.getAccessToken()
    if (!token) throw new Error("empty token")
    return token
  } catch {
    throw new GoogleAuthConfigurationError(
      "LOCAL_ADC_NOT_CONFIGURED",
      "Google Application Default Credentials are not configured for local development. Run `gcloud auth application-default login`, or set GOOGLE_APPLICATION_CREDENTIALS to a local ADC file. This module does not fall back to GOOGLE_APPLICATION_CREDENTIALS_JSON.",
    )
  }
}
