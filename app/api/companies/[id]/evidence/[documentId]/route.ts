import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { applyEvidenceAction, openEvidenceForView } from "@/lib/evidence-payload/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; documentId: string }> }

/**
 * Secure inline view. The view is authorized and recorded in the Master Register before any byte is read; the response is
 * private, uncached, non-sniffable, sandboxed and inline-only. There is no download or print affordance here, and no storage
 * location, URL or signed link is ever returned. (A browser can still save what it renders - this is a policy and audit
 * control, not DRM.)
 */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id, documentId } = await context.params
    const opened = await openEvidenceForView({ organizationId: id, documentId })
    return new Response(new Uint8Array(opened.bytes), {
      status: 200,
      headers: {
        "Content-Type": opened.mimeType,
        "Content-Length": String(opened.byteSize),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
      },
    })
  } catch (error) {
    return canonicalFailure(error, "Unable to open the document.")
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id, documentId } = await context.params
    return NextResponse.json({ evidence: await applyEvidenceAction(id, documentId, await readJsonBody(request)) }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to update the document.")
  }
}
