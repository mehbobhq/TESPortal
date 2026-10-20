import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { endCompanyService } from "@/lib/company-directory/service-lifecycle"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/**
 * Ends the company's OPEN customer engagement with a reason from the closed catalogue (the original form's "End Date"). The
 * engagement is resolved from the company in the URL, so another company's engagement can never be addressed. A service governed by a
 * SIGNED contract is refused (see endCompanyService); an ended engagement is never reopened or deleted (migration 0015).
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    const view = await endCompanyService(id, { endedAt: body.endedAt, endReason: body.endReason })
    return NextResponse.json({ engagement: view }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to end the engagement.")
  }
}
