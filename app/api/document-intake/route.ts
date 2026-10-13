import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { MAX_PAYLOAD_BYTES } from "@/lib/evidence-payload/definitions"
import { EvidenceValidationError, PayloadValidationError, uploadEvidence } from "@/lib/evidence-payload/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Compatibility entry point for document intake. It no longer accepts an unverified companyId or returns storage paths:
 * the upload goes through the same authorized, tenant-scoped lifecycle as /api/companies/{id}/evidence
 * (lib/evidence-payload/service.ts) - EVIDENCE_MANAGE is required, the organization must exist, the bytes are validated and
 * hashed on the server, and the original is placed in QUARANTINE only (create-only). Success means "accepted into
 * quarantine"; the document-security-scanner alone decides whether it is ever promoted.
 *
 * Form fields: file, companyId (the organization id), documentType, documentTitle.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get("file")
    const organizationId = form.get("companyId")
    if (!(file instanceof File)) throw new EvidenceValidationError("file", "A file is required.")
    if (typeof organizationId !== "string" || !organizationId.trim()) throw new EvidenceValidationError("companyId", "A companyId is required.")
    if (file.size > MAX_PAYLOAD_BYTES) throw new EvidenceValidationError("file", "The uploaded document exceeds the maximum allowed size.")
    const result = await uploadEvidence({
      organizationId: organizationId.trim(),
      documentType: String(form.get("documentType") ?? "OTHER_EVIDENCE"),
      documentTitle: String(form.get("documentTitle") ?? file.name),
      file: { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, filename: file.name },
    })
    return NextResponse.json({ result }, { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof PayloadValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
    return canonicalFailure(error, "Document intake could not be completed.")
  }
}
