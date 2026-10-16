import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { productionInvitationDeps } from "@/lib/driver-applications/access"
import { handleInvitationRequest } from "@/lib/driver-applications/invitation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Sends a Driver Application invitation. The body carries references only (companyId, driverMasterId, applicationId,
 * recipientEmail); company identity, driver details and the destination are resolved from authoritative server records and
 * the TES actor must hold DRIVER_MANAGE. See lib/driver-applications/invitation.ts. While canonical application records do
 * not exist in PostgreSQL this endpoint fails closed (503) and sends nothing.
 */
export async function POST(request: NextRequest) {
  try {
    const outcome = await handleInvitationRequest(request, productionInvitationDeps(new URL(request.url).origin))
    const { status, ...body } = outcome
    return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to send the Driver Application invitation.")
  }
}
