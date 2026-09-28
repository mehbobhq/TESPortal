import { createHmac, timingSafeEqual } from "node:crypto"

export interface DriverInvitationTokenPayload {
  version: 1
  companyId: string
  companyName: string
  companyAddress?: {
    street?: string
    city?: string
    stateProvince?: string
    postalCode?: string
    country?: string
  }
  companyPhone?: string
  companyEmail?: string
  driverMasterId: string
  applicationId: string
  recipientEmail: string
  driverName: string
  operatingRegion?: "Canada" | "United States" | "Cross-Border"
  expiresAt: string
}

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url")
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8")

function signingSecret() {
  const secret = process.env.TES_INVITATION_SECRET || process.env.RESEND_API_KEY
  if (!secret) throw new Error("TES invitation signing secret is not configured.")
  return secret
}

function signature(body: string) {
  return createHmac("sha256", signingSecret()).update(body).digest("base64url")
}

export function createDriverInvitationToken(payload: DriverInvitationTokenPayload) {
  const body = encode(JSON.stringify(payload))
  return `${body}.${signature(body)}`
}

export function verifyDriverInvitationToken(token: string): DriverInvitationTokenPayload | null {
  try {
    const [body, supplied] = token.split(".")
    if (!body || !supplied) return null
    const expected = signature(body)
    const a = Buffer.from(supplied)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const payload = JSON.parse(decode(body)) as DriverInvitationTokenPayload
    if (payload.version !== 1 || !payload.applicationId || !payload.recipientEmail || !payload.expiresAt) return null
    if (Date.parse(payload.expiresAt) <= Date.now()) return null
    return payload
  } catch {
    return null
  }
}
