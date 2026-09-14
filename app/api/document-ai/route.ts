import { randomUUID, createSign } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { GoogleDocumentAIAcquisitionProvider } from "@/lib/google-document-ai-provider"

interface ServiceAccountCredentials {
  client_email: string
  private_key: string
}

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64url")
}

function parseServiceAccountCredentials(raw: string): ServiceAccountCredentials {
  const trimmed = raw.trim()
  const decoded = trimmed.startsWith("ey") ? Buffer.from(trimmed, "base64").toString("utf8") : trimmed

  try {
    const credentials = JSON.parse(decoded) as Partial<ServiceAccountCredentials>
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("service account JSON is missing client_email or private_key")
    }
    return {
      client_email: credentials.client_email,
      private_key: credentials.private_key.replace(/\\n/g, "\n"),
    }
  } catch (error) {
    throw new Error(
      `Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON. Paste the service-account JSON as one quoted .env.local value, or base64-encode it. Parser detail: ${
        error instanceof Error ? error.message : "Unknown JSON parse error"
      }`
    )
  }
}

// GoogleDocumentAIAcquisitionProvider expects a bearer access token string
// (GoogleDocumentAIProviderConfig.accessToken: string), not the raw service
// account credentials JSON. This mints one via the standard JWT-bearer OAuth2
// flow so the provider itself never has to know about credential parsing.
async function getGoogleAccessToken(credentials: ServiceAccountCredentials): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const header = { alg: "RS256", typ: "JWT" }
  const claimSet = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }

  const unsignedToken = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`
  const signer = createSign("RSA-SHA256")
  signer.update(unsignedToken)
  signer.end()
  const signature = base64url(signer.sign(credentials.private_key))
  const assertion = `${unsignedToken}.${signature}`

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })

  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text()
    throw new Error(`Failed to obtain Google access token (${tokenResponse.status}): ${detail.slice(0, 500)}`)
  }

  const tokenData = (await tokenResponse.json()) as { access_token?: string }
  if (!tokenData.access_token) {
    throw new Error("Google token response did not include an access_token")
  }
  return tokenData.access_token
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID
    const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID
    const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION ?? "us"

    if (!credentialsJson || !projectId || !processorId) {
      return NextResponse.json({ error: "Document AI not configured" }, { status: 500 })
    }

    const credentials = parseServiceAccountCredentials(credentialsJson)
    const accessToken = await getGoogleAccessToken(credentials)

    const provider = new GoogleDocumentAIAcquisitionProvider({
      projectId,
      processorId,
      location,
      accessToken,
    })

    const arrayBuffer = await file.arrayBuffer()
    const contentBase64 = Buffer.from(arrayBuffer).toString("base64")

    const result = await provider.process({
      evidenceId: randomUUID(),
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      contentBase64,
    })

    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document AI processing failed"
    console.error("Document AI API error:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
