import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { reviewProspect } from "@/lib/driver-prospects/service"
import { REVIEW_TARGETS, type ReviewTarget } from "@/lib/driver-prospects/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, prospectId } = await context.params
    const body = await readJsonBody(request)
    const to = REVIEW_TARGETS.find((t) => t === body.to) as ReviewTarget | undefined
    if (!to) return NextResponse.json({ error: "Choose a valid review step." }, { status: 400 })
    return NextResponse.json(await reviewProspect({ organizationId: id, prospectId, to }), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to update the prospect.")
  }
}
