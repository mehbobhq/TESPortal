import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { issueEventRestriction, releaseEventRestriction } from "@/lib/driver-events/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; eventId: string }> }

/** Body: { action: "issue", restrictionKind, authority, subjectType, ... } | { action: "release", restrictionId, releaseBasis, evidenceDocumentId?, correctionSummary, releaseNote? }. A release needs the dedicated release capability. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, eventId } = await context.params
    const body = await readJsonBody(request)
    if (body.action === "release") {
      return NextResponse.json(
        await releaseEventRestriction(id, eventId, body.restrictionId as string, { releaseBasis: body.releaseBasis as string, evidenceDocumentId: (body.evidenceDocumentId as string) ?? null, correctionSummary: body.correctionSummary as string, releaseNote: (body.releaseNote as string) ?? null }, request.headers.get("x-request-id")),
        { status: 200 },
      )
    }
    return NextResponse.json(await issueEventRestriction(id, eventId, body as never), { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to update the event restrictions.")
  }
}
