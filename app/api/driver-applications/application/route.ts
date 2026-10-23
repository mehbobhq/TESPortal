import type { NextRequest } from "next/server"
import { ensureApplicationPdf, loadApplicantApplication } from "@/lib/driver-application/applicant-service"
import { handle, json, sessionTokenOf } from "@/lib/driver-application/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  return handle(request, false, async () => {
    const view = await loadApplicantApplication(sessionTokenOf(request))
    if (view.application.status === "SUBMITTED" && !view.application.pdfDocumentId) {
      await ensureApplicationPdf(sessionTokenOf(request)).catch(() => undefined)
    }
    return json(view)
  })
}
