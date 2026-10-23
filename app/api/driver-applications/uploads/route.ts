import type { NextRequest } from "next/server"
import { ApplicantInputError, uploadApplicantDocument } from "@/lib/driver-application/applicant-service"
import { csrfOf, handle, json, sessionTokenOf } from "@/lib/driver-application/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The hosting platform limits request bodies to about 4.5 MB; the page compresses photos before sending. */
const MAX_REQUEST_BYTES = 4_200_000

export async function POST(request: NextRequest) {
  return handle(request, true, async () => {
    if (Number(request.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) throw new ApplicantInputError(413, "That file is too large. Choose a smaller file or take a photo instead.")
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) throw new ApplicantInputError(400, "Choose a file to upload.")
    if (file.size > MAX_REQUEST_BYTES) throw new ApplicantInputError(413, "That file is too large. Choose a smaller file or take a photo instead.")
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await uploadApplicantDocument(sessionTokenOf(request), csrfOf(request), { fieldId: form.get("fieldId"), slot: form.get("slot") ?? "", bytes, mimeType: file.type, filename: file.name })
    return json(result)
  })
}
