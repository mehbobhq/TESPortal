import type { NextRequest } from "next/server"
import { saveApplicantSensitive } from "@/lib/driver-application/applicant-service"
import { csrfOf, handle, json, readJson, sessionTokenOf } from "@/lib/driver-application/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Write-only: the response carries only the masked value. No read route for this data exists for applicants. */
export async function PUT(request: NextRequest) {
  return handle(request, true, async () => {
    const body = await readJson(request)
    return json(await saveApplicantSensitive(sessionTokenOf(request), csrfOf(request), { fieldId: body.fieldId, value: body.value }))
  })
}
