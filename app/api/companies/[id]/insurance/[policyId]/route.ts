import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { archivePolicy, cancelTerm, restorePolicy } from "@/lib/insurance/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; policyId: string }> }

/** The policy must belong to the company in the URL (the operation refuses a mismatch as not found). PATCH { action: "archive" | "restore" | "cancel", ... } maps onto the canonical insurance operations. */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, policyId } = await context.params
    const body = await readJsonBody(request)
    switch (body.action) {
      case "archive":
        return NextResponse.json({ policy: await archivePolicy({ policyId, organizationId }) }, { status: 200 })
      case "restore":
        return NextResponse.json({ policy: await restorePolicy({ policyId, organizationId }) }, { status: 200 })
      case "cancel": {
        const { termId, cancelledOn, reason } = body
        return NextResponse.json({ policy: await cancelTerm({ termId, organizationId, cancelledOn, reason }) }, { status: 200 })
      }
      default:
        return NextResponse.json({ error: "Unsupported policy action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to update policy.")
  }
}
