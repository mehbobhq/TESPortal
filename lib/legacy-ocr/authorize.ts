import "server-only"

import { withAuthorizedSystem } from "@/lib/auth/tes-system-context"

/**
 * The legacy OCR routes were reachable by any signed-in user. They now require the same SYSTEM capability that governs
 * evidence handling (EVIDENCE_MANAGE), proven by the authorization kernel in a short transaction that touches no tenant data.
 * Denial surfaces as TesAuthorizationDeniedError / TesIdentityRequiredError, which canonicalFailure maps to 403.
 */
export async function authorizeLegacyOcr(): Promise<void> {
  await withAuthorizedSystem("EVIDENCE_MANAGE", async () => undefined)
}
