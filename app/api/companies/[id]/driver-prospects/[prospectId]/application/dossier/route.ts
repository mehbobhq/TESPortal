import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { getCarrierDossierPdf } from "@/lib/driver-application/review-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

/** GET ?applicationId=… — the carrier dossier PDF (DRIVER_READ). */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { id, prospectId } = await context.params
    const applicationId = request.nextUrl.searchParams.get("applicationId") ?? ""
    const { bytes, receiptId } = await getCarrierDossierPdf({ organizationId: id, prospectId, applicationId })
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="driver-application-dossier-${receiptId}.pdf"`, "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return canonicalFailure(error, "Unable to generate the dossier.")
  }
}
