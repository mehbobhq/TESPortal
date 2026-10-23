import type { NextRequest } from "next/server"
import { SESSION_TTL_SECONDS, startApplicantSession } from "@/lib/driver-application/applicant-service"
import { handle, json, readJson, setSessionCookie } from "@/lib/driver-application/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Exchanges the invitation secret (sent in the body, never a URL) for a server-side session. All failures to open look the same. */
export async function POST(request: NextRequest) {
  return handle(request, true, async () => {
    const body = await readJson(request)
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown"
    const result = await startApplicantSession({ secret: body.secret, ip, userAgent: request.headers.get("user-agent") ?? "" })
    if (!result.ok) {
      return result.reason === "RATE_LIMITED"
        ? json({ error: "Too many attempts. Wait a few minutes and try again." }, 429)
        : json({ error: "This link is not valid any more. Ask the company for a new application link." }, 404)
    }
    const response = json({ csrfToken: result.csrfToken, expiresAt: result.expiresAt })
    setSessionCookie(response, result.sessionToken, SESSION_TTL_SECONDS)
    return response
  })
}
