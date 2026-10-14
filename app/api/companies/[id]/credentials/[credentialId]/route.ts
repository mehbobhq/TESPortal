import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import {
  archiveCredential,
  changeCredentialStatus,
  correctCompanyCredentialStatus,
  declareCompanySecretSlot,
  linkCompanySlotToSecretManager,
  recordVerification,
  replaceCompanyCredential,
  restoreCredential,
  retireCompanySecretSlot,
  updateCompanyCredentialMetadata,
  voidCompanyVerification,
} from "@/lib/company-credentials/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; credentialId: string }> }

/**
 * Every id must belong to the company in the URL (an operation refuses a mismatch as "not found"). The request carries no
 * secret value: the canonical inputs are strict, so an extra key such as a secret or a value is refused.
 *
 * PATCH { action, ... }
 *   status          { status, effectiveFrom? }   a real-world status change (history kept)
 *   correctStatus   { periodId, status }          the current status was recorded wrongly (flagged, kept)
 *   verify          { outcome, method }           records who verified, when
 *   voidVerification{ verificationId }            a verification entered in error (kept, flagged)
 *   metadata        { category?, mfaMethod? }
 *   replace         { username, reason, ... }     a changed or wrongly entered login: a new credential replaces this one
 *   declareSlot     { slotKind }                  declares that a secret of this kind exists (state only)
 *   retireSlot      { slotId }
 *   linkSecret      { slotId, secretReference }   a Secret Manager resource NAME, never a value
 *   archive | restore
 */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, credentialId } = await context.params
    const { action, ...rest } = await readJsonBody(request)
    const done = (credential: unknown) => NextResponse.json({ credential }, { status: 200 })
    switch (action) {
      case "status":
        return done(await changeCredentialStatus({ ...rest, credentialId, organizationId }))
      case "correctStatus":
        return done(await correctCompanyCredentialStatus(organizationId, { ...rest, credentialId }))
      case "verify":
        return done(await recordVerification({ ...rest, credentialId, organizationId }))
      case "voidVerification":
        return done(await voidCompanyVerification(organizationId, rest))
      case "metadata":
        return done(await updateCompanyCredentialMetadata(organizationId, { ...rest, credentialId }))
      case "replace":
        return NextResponse.json({ credential: await replaceCompanyCredential(organizationId, { ...rest, credentialId }) }, { status: 201 })
      case "declareSlot":
        return done(await declareCompanySecretSlot(organizationId, { ...rest, credentialId }))
      case "retireSlot":
        return done(await retireCompanySecretSlot(organizationId, rest))
      case "linkSecret":
        return done(await linkCompanySlotToSecretManager(organizationId, rest))
      case "archive":
        return done(await archiveCredential({ credentialId, organizationId }))
      case "restore":
        return done(await restoreCredential({ credentialId, organizationId }))
      default:
        return NextResponse.json({ error: "Unsupported credential action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to update credential.")
  }
}
