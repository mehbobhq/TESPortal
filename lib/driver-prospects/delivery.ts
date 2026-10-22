import "server-only"
import type { InvitationDeliveryPort } from "./types"

const FROM = "TES <applications@truckease.co>"
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c))

/** The existing approved mail mechanism (Resend). Throws on any failure; callers record only a generic outcome. */
export const resendInvitationDelivery: InvitationDeliveryPort = async (m) => {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured")
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `driver-application/${m.invitationId}` },
    body: JSON.stringify({
      from: FROM,
      to: [m.to],
      subject: `${m.companyName} — Complete your driver application`,
      html: `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,sans-serif;color:#172033"><div style="max-width:620px;margin:32px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden"><div style="padding:24px 28px;border-bottom:1px solid #e5e7eb"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280">Powered by TES</div><h1 style="font-size:22px;margin:8px 0 0">Driver Application</h1></div><div style="padding:28px"><p>Hello ${esc(m.applicantName)},</p><p>${esc(m.companyName)} has invited you to complete your driver application through TES.</p><p style="margin:28px 0"><a href="${esc(m.link)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open Driver Application</a></p><p style="font-size:12px;color:#6b7280">This secure invitation expires on ${esc(m.expiresAt.slice(0, 10))}. If you were not expecting it, do not use the link.</p></div><div style="padding:16px 28px;background:#fafafa;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280">TES · Trucking compliance technology · truckease.co</div></div></body></html>`,
    }),
  })
  const result = (await response.json().catch(() => ({}))) as { id?: string }
  if (!response.ok || !result?.id) throw new Error(`delivery rejected (${response.status})`)
  return { messageId: result.id }
}
