import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import {
  archiveCredential,
  changeCredentialStatus,
  recordVerification,
  restoreCredential,
} from "@/lib/company-credentials/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; credentialId: string }> }

/** The credential must belong to the company in the URL (the operation refuses a mismatch as not found). PATCH { action: "status" | "verify" | "archive" | "restore", ... } maps onto the canonical credential operations. */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, credentialId } = await context.params
    const body = await readJsonBody(request)
    switch (body.action) {
      case "status":
        return NextResponse.json({ credential: await changeCredentialStatus({ credentialId, organizationId, status: body.status }) }, { status: 200 })
      case "verify":
        return NextResponse.json(
          { credential: await recordVerification({ credentialId, organizationId, outcome: body.outcome, method: body.method }) },
          { status: 200 },
        )
      case "archive":
        return NextResponse.json({ credential: await archiveCredential({ credentialId, organizationId }) }, { status: 200 })
      case "restore":
        return NextResponse.json({ credential: await restoreCredential({ credentialId, organizationId }) }, { status: 200 })
      default:
        return NextResponse.json({ error: "Unsupported credential action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to update credential.")
  }
}
