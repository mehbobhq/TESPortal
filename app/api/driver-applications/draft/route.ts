import type { NextRequest } from "next/server"
import { saveApplicantDraft } from "@/lib/driver-application/applicant-service"
import { csrfOf, handle, json, readJson, sessionTokenOf } from "@/lib/driver-application/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(request: NextRequest) {
  return handle(request, true, async () => {
    const body = await readJson(request)
    return json(await saveApplicantDraft(sessionTokenOf(request), csrfOf(request), { version: body.version, patch: body.patch }))
  })
}
