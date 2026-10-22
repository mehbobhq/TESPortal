import { NextRequest, NextResponse } from "next/server"
import { openInvitation, signedApplicantToken } from "@/lib/driver-prospects/applicant"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Public by design: the secret in the body IS the credential. Every failure looks the same so a token cannot be probed. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  try {
    const opened = await openInvitation(body && typeof body === "object" ? (body as Record<string, unknown>).invitation : null)
    if (!opened) return NextResponse.json({ error: "This invitation link is not valid or has expired." }, { status: 404 })
    return NextResponse.json({ token: signedApplicantToken(opened) }, { status: 200 })
  } catch {
    return NextResponse.json({ error: "This invitation link is not valid or has expired." }, { status: 404 })
  }
}
