import "server-only"

import { NextResponse, type NextRequest } from "next/server"
import { ApplicantSessionError } from "@/lib/auth/tes-applicant-context"
import { ApplicantInputError } from "./applicant-service"

/** HTTP edge for the applicant API. The session lives in an HttpOnly cookie; the CSRF token travels in a header; nothing identifying travels in a URL. */
export const SESSION_COOKIE = "__Host-tes_applicant"
export const SESSION_COOKIE_DEV = "tes_applicant"
export const CSRF_HEADER = "x-tes-csrf"
const MAX_JSON_BYTES = 450_000

export const cookieName = () => (process.env.NODE_ENV === "production" ? SESSION_COOKIE : SESSION_COOKIE_DEV)
export const sessionTokenOf = (request: NextRequest) => request.cookies.get(cookieName())?.value ?? null
export const csrfOf = (request: NextRequest) => request.headers.get(CSRF_HEADER)

const noStore = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...noStore, ...headers } })

export function setSessionCookie(response: NextResponse, token: string, maxAgeSeconds: number) {
  response.cookies.set(cookieName(), token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: maxAgeSeconds })
}

/** Writes must come from this site. SameSite=Strict plus the CSRF header already protect them; the Origin check is a third, independent layer. */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return true
  try {
    return new URL(origin).host === request.nextUrl.host || new URL(origin).host === request.headers.get("host")
  } catch {
    return false
  }
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (declared > MAX_JSON_BYTES) throw new ApplicantInputError(413, "That request is too large.")
  const text = await request.text()
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) throw new ApplicantInputError(413, "That request is too large.")
  try {
    const parsed = text ? JSON.parse(text) : {}
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape")
    return parsed as Record<string, unknown>
  } catch {
    throw new ApplicantInputError(400, "The request could not be read.")
  }
}

/** Maps service errors to responses. Unexpected errors are never echoed: the applicant sees a generic message and nothing from the stack or database. */
export async function handle(request: NextRequest, write: boolean, work: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    if (write && !sameOrigin(request)) return json({ error: "The request could not be verified." }, 403)
    return await work()
  } catch (error) {
    if (error instanceof ApplicantSessionError) return json({ error: error.message }, error.status)
    if (error instanceof ApplicantInputError) return json({ error: error.message, details: error.details }, error.status)
    console.error("driver-application: unexpected failure", error instanceof Error ? error.name : "unknown")
    return json({ error: "Something went wrong on our side. Your answers are saved. Try again in a moment." }, 500)
  }
}
