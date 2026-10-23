import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { revealSensitive } from "@/lib/driver-application/review-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

/** The company comes from the path. The application must belong to THIS company; nothing the browser sends can choose another one. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    const result = await revealSensitive({ organizationId: id, applicationId: String(body.applicationId ?? ""), fieldId: String(body.fieldId ?? ""), purpose: String(body.purpose ?? "") })
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store, max-age=0" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to show that information.")
  }
}
