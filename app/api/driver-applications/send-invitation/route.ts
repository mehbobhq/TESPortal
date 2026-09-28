import { NextRequest, NextResponse } from "next/server"
import { createDriverInvitationToken } from "@/lib/driver-invitation-token"

export const runtime = "nodejs"

const FROM = "TES <applications@truckease.co>"
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c))

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) return NextResponse.json({ error: "RESEND_API_KEY is not configured on the server." }, { status: 500 })

    const body = await request.json()
    const {
      companyId,
      companyName,
      companyAddress,
      companyPhone,
      companyEmail,
      driverMasterId,
      applicationId,
      recipientEmail,
      driverName,
      applicationType,
      operatingRegion,
    } = body ?? {}
    if (![companyId, companyName, driverMasterId, applicationId, recipientEmail, driverName].every((v) => typeof v === "string" && v.trim())) {
      return NextResponse.json({ error: "The invitation request is incomplete." }, { status: 400 })
    }
    if (!EMAIL.test(recipientEmail)) return NextResponse.json({ error: "The Driver email address is invalid." }, { status: 400 })

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const token = createDriverInvitationToken({
      version: 1,
      companyId,
      companyName,
      companyAddress: companyAddress && typeof companyAddress === "object"
        ? {
            street: String(companyAddress.street ?? "").trim(),
            city: String(companyAddress.city ?? "").trim(),
            stateProvince: String(companyAddress.stateProvince ?? "").trim(),
            postalCode: String(companyAddress.postalCode ?? "").trim(),
            country: String(companyAddress.country ?? "").trim(),
          }
        : undefined,
      companyPhone: typeof companyPhone === "string" ? companyPhone.trim() : undefined,
      companyEmail: typeof companyEmail === "string" ? companyEmail.trim().toLowerCase() : undefined,
      driverMasterId,
      applicationId,
      recipientEmail: recipientEmail.trim().toLowerCase(),
      driverName,
      operatingRegion:
        operatingRegion === "United States" || operatingRegion === "Cross-Border"
          ? operatingRegion
          : "Canada",
      expiresAt,
    })
    const origin = request.nextUrl.origin
    const invitationUrl = `${origin}/driver-application?token=${encodeURIComponent(token)}`

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `driver-application/${applicationId}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [recipientEmail.trim().toLowerCase()],
        subject: `${companyName} — Complete your driver application`,
        html: `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,sans-serif;color:#172033"><div style="max-width:620px;margin:32px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden"><div style="padding:24px 28px;border-bottom:1px solid #e5e7eb"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280">Powered by TES</div><h1 style="font-size:22px;margin:8px 0 0">Driver Application</h1></div><div style="padding:28px"><p>Hello ${esc(driverName)},</p><p>${esc(companyName)} has invited you to complete your driver application through TES.</p><p style="font-size:13px;color:#6b7280"><strong>Application:</strong> ${esc(applicationId)}<br><strong>Type:</strong> ${esc(applicationType)}<br><strong>Operating region:</strong> ${esc(operatingRegion)}</p><p style="margin:28px 0"><a href="${esc(invitationUrl)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open Driver Application</a></p><p style="font-size:12px;color:#6b7280">This secure invitation expires in 7 days. If you were not expecting it, do not use the link.</p></div><div style="padding:16px 28px;background:#fafafa;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280">TES · Trucking compliance technology · truckease.co</div></div></body></html>`,
      }),
    })

    const result = await resendResponse.json().catch(() => ({}))
    if (!resendResponse.ok || !result?.id) {
      return NextResponse.json({ error: result?.message || result?.error?.message || "Resend rejected the invitation email." }, { status: resendResponse.status || 502 })
    }

    return NextResponse.json({ messageId: result.id, sentAt: new Date().toISOString(), expiresAt })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to send Driver Application invitation." }, { status: 500 })
  }
}
