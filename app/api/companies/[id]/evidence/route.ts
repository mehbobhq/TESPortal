import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { MAX_PAYLOAD_BYTES } from "@/lib/evidence-payload/definitions"
import { EvidenceValidationError, PayloadValidationError, listEvidenceAssociationsWithPermissions, listOrganizationEvidence, uploadEvidence } from "@/lib/evidence-payload/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    // ?documentId=... or ?targetTable=...&targetId=... (optionally &includeArchived=true) returns the associations instead of the document list.
    const query = request.nextUrl.searchParams
    if (query.has("documentId") || query.has("targetTable")) {
      const { links, permissions } = await listEvidenceAssociationsWithPermissions({
        organizationId: id,
        documentId: query.get("documentId") ?? undefined,
        targetTable: query.get("targetTable") ?? undefined,
        targetId: query.get("targetId") ?? undefined,
        includeArchived: query.get("includeArchived") === "true",
      })
      return NextResponse.json({ links, permissions }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
    }
    return NextResponse.json({ evidence: await listOrganizationEvidence(id) }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to load evidence.")
  }
}

/** Accepts one upload into quarantine. The organization comes from the route, never from the form. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) throw new EvidenceValidationError("file", "A file is required.")
    // Checked before any byte is read.
    if (file.size > MAX_PAYLOAD_BYTES) throw new EvidenceValidationError("file", "The uploaded document exceeds the maximum allowed size.")
    const supersedes = form.get("supersedesDocumentId")
    const result = await uploadEvidence({
      organizationId: id,
      documentType: String(form.get("documentType") ?? ""),
      documentTitle: String(form.get("documentTitle") ?? ""),
      file: { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, filename: file.name },
      supersedesDocumentId: typeof supersedes === "string" && supersedes ? supersedes : null,
    })
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof PayloadValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
    return canonicalFailure(error, "Evidence upload could not be completed.")
  }
}
