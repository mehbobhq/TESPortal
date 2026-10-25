import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { linkEventEvidence, unlinkEventEvidence, verifyEventEvidence } from "@/lib/driver-events/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; eventId: string }> }

/**
 * Links an evidence document that already went through the company evidence upload (quarantine -> scan -> intake -> evidence). The bytes are never sent here.
 * Body: { action: "link", documentId, role, note? } | { action: "verify", linkId, decision, note? } | { action: "unlink", linkId, reason }.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, eventId } = await context.params
    const body = await readJsonBody(request)
    if (body.action === "verify") return NextResponse.json(await verifyEventEvidence(id, eventId, body.linkId as string, { decision: body.decision as string, note: typeof body.note === "string" ? body.note : null }), { status: 200 })
    if (body.action === "unlink") return NextResponse.json(await unlinkEventEvidence(id, eventId, body.linkId as string, { reason: body.reason as string }), { status: 200 })
    return NextResponse.json(await linkEventEvidence(id, eventId, { documentId: body.documentId as string, role: body.role as string, note: typeof body.note === "string" ? body.note : null }), { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to update the event evidence.")
  }
}
