import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { resendInvitationDelivery } from "@/lib/driver-prospects/delivery"
import { sendInvitation } from "@/lib/driver-prospects/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

/** The company and prospect come from the path only; the body is never read, so no caller can name another company. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, prospectId } = await context.params
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "Email delivery is not configured. Nothing was sent." }, { status: 503 })
    const baseUrl = process.env.TES_PUBLIC_BASE_URL?.trim() || request.nextUrl.origin
    const result = await sendInvitation({ organizationId: id, prospectId, baseUrl }, resendInvitationDelivery)
    if (!result.sent) return NextResponse.json({ error: "The invitation email could not be delivered. The prospect was kept; you can try again.", ...result }, { status: 502 })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to send the application.")
  }
}
