import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { recordCorrection } from "@/lib/driver-application/review-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

/** The company comes from the path. The application must belong to THIS company; nothing the browser sends can choose another one. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json(await recordCorrection({ organizationId: id, applicationId: String(body.applicationId ?? ""), fieldId: String(body.fieldId ?? ""), correctedValue: body.correctedValue, reason: String(body.reason ?? ""), evidenceDocumentId: typeof body.evidenceDocumentId === "string" ? body.evidenceDocumentId : null }), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to record the correction.")
  }
}
