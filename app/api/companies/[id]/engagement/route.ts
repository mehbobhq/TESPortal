import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { endEngagement, getCustomerRelationship, CustomerRelationshipNotFoundError } from "@/lib/customer-relationship/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/**
 * Ends the company's OPEN customer engagement with a reason from the closed catalogue (the original form's "End Date"). The
 * engagement is resolved from the company in the URL, so another company's engagement can never be addressed. An ended
 * engagement is never reopened or deleted (migration 0015); a mistaken end is corrected through the domain's own correction.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    const relationship = await getCustomerRelationship(id)
    const open = relationship.openEngagement
    if (!relationship.customer || !open) throw new CustomerRelationshipNotFoundError("Open engagement")
    const view = await endEngagement({ engagementId: open.engagement.id, endedAt: body.endedAt, endReason: body.endReason })
    return NextResponse.json({ engagement: view }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to end the engagement.")
  }
}
