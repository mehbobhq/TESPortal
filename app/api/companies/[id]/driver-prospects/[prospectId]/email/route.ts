import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { addProspectEmail } from "@/lib/driver-prospects/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, prospectId } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json(await addProspectEmail({ organizationId: id, prospectId, email: typeof body.email === "string" ? body.email : "" }), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to add the email address.")
  }
}
