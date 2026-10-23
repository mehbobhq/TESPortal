import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { getApplicationReview } from "@/lib/driver-application/review-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id, prospectId } = await context.params
    return NextResponse.json(await getApplicationReview({ organizationId: id, prospectId }), { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to load the application.")
  }
}
