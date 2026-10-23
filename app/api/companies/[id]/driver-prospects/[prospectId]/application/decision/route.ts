import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { recordDecision } from "@/lib/driver-application/review-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

/** The company comes from the path. The application must belong to THIS company; nothing the browser sends can choose another one. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json(await recordDecision({ organizationId: id, applicationId: String(body.applicationId ?? ""), decision: String(body.decision ?? ""), reasons: body.reasons, acknowledgeReviewRequirements: body.acknowledgeReviewRequirements === true }), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to record the decision.")
  }
}
