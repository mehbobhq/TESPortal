import { NextRequest } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { authorizeDocumentView } from "@/lib/driver-application/review-service"
import { openEvidenceForView } from "@/lib/evidence-payload/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string; documentId: string }> }

/** Only a document that belongs to THIS company's application can be opened here; restricted documents also need the dedicated sensitive-read capability. Inline view only, recorded before any byte is read. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { id, documentId } = await context.params
    const applicationId = request.nextUrl.searchParams.get("applicationId") ?? ""
    const allowed = await authorizeDocumentView({ organizationId: id, applicationId, documentId })
    const opened = await openEvidenceForView({ organizationId: allowed.organizationId, documentId: allowed.documentId })
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
