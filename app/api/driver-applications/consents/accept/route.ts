import type { NextRequest } from "next/server"
import { acceptApplicantConsent } from "@/lib/driver-application/applicant-service"
import { csrfOf, handle, json, readJson, sessionTokenOf } from "@/lib/driver-application/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  return handle(request, true, async () => {
    const body = await readJson(request)
    return json(await acceptApplicantConsent(sessionTokenOf(request), csrfOf(request), { key: body.key, signatureName: body.signatureName, affirmed: body.affirmed }))
  })
}
