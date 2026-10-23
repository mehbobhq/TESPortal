import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { resendInvitationDelivery } from "@/lib/driver-prospects/delivery"
import { sendInvitation } from "@/lib/driver-prospects/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

/**
 * The company and prospect come from the path only. The optional body can only ask for a LATER-STAGE SUPPLEMENT of an application this company already received
 * ({ stage, supplementsApplicationId }); the application is re-checked against the path's company and prospect on the server, so no caller can name another company.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, prospectId } = await context.params
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "Email delivery is not configured. Nothing was sent." }, { status: 503 })
    // The link host is configuration, never the request's Host header (a forged Host could point the applicant at another site). Production requires it.
    const configured = process.env.TES_PUBLIC_BASE_URL?.trim()
    let baseUrl: string | null = null
    if (configured) {
      try {
        const url = new URL(configured)
        const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
        if (url.protocol === "https:" || (local && url.protocol === "http:")) baseUrl = url.origin
      } catch {
        baseUrl = null
      }
    } else if (process.env.NODE_ENV !== "production") {
      baseUrl = request.nextUrl.origin
    }
    if (!baseUrl) return NextResponse.json({ error: "The public application address is not configured. Nothing was sent." }, { status: 503 })
    let stage: "CONDITIONAL_OFFER" | "POST_OFFER" | undefined
    let supplementsApplicationId: string | undefined
    const raw = await request.text()
    if (raw.trim()) {
      let body: Record<string, unknown>
      try {
        body = JSON.parse(raw) as Record<string, unknown>
      } catch {
        return NextResponse.json({ error: "The request could not be read." }, { status: 400 })
      }
      if (body.stage !== undefined) {
        if (body.stage !== "CONDITIONAL_OFFER" && body.stage !== "POST_OFFER") return NextResponse.json({ error: "Choose a valid application stage." }, { status: 400 })
        stage = body.stage
        if (typeof body.supplementsApplicationId !== "string") return NextResponse.json({ error: "Name the application this supplements." }, { status: 400 })
        supplementsApplicationId = body.supplementsApplicationId
      }
    }
    const result = await sendInvitation({ organizationId: id, prospectId, baseUrl, stage, supplementsApplicationId }, resendInvitationDelivery)
    if (!result.sent) return NextResponse.json({ error: "The invitation email could not be delivered. The prospect was kept; you can try again.", ...result }, { status: 502 })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to send the application.")
  }
}
