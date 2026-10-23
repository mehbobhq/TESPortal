import type { NextRequest } from "next/server"
import { ensureApplicationPdf, submitApplicantApplication } from "@/lib/driver-application/applicant-service"
import { csrfOf, handle, json, sessionTokenOf } from "@/lib/driver-application/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  return handle(request, true, async () => {
    const result = await submitApplicantApplication(sessionTokenOf(request), csrfOf(request))
    if (result.ok) {
      // The receipt is already issued; a PDF failure is retried on the next visit and never reported as a failed submission.
      await ensureApplicationPdf(sessionTokenOf(request)).catch((error) => console.error("driver-application: pdf generation deferred", error instanceof Error ? error.name : "unknown"))
    }
    return json(result.ok ? { receiptId: result.receiptId, submittedAt: result.submittedAt, alreadySubmitted: result.alreadySubmitted } : { error: "Some answers need attention before you can submit.", errors: result.errors, itemErrors: result.itemErrors, missingConsents: result.missingConsents }, result.ok ? 200 : 422)
  })
}
