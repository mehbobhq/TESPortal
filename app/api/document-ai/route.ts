import { randomUUID, createSign } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"
import { GoogleDocumentAIAcquisitionProvider } from "@/lib/google-document-ai-provider"
import type { TESMachineDocumentResult } from "@/lib/machine-acquisition"

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

// Module-level token cache. Google access tokens minted via the JWT-bearer
// flow below are valid for a full hour (see `exp: nowSeconds + 3600`), but
// prior to this fix every single document upload minted a brand new one —
// an RSA sign plus a full network round trip to oauth2.googleapis.com —
// even when a perfectly valid token already existed. That was pure latency
// on every OCR request for no reason. Caching it here (keyed by service
// account, in case that ever changes) cuts one full network round trip off
// every upload after the first, and the in-flight promise dedup below
// collapses concurrent uploads (e.g. a bulk/batch upload firing several
// documents at once) onto a single token mint instead of one each.
// NOTE: this cache lives in the Node process's memory. It survives across
// requests as long as this server process stays warm (true for `next start`
// / a long-running Node server); on a cold-starting serverless platform
// each new instance re-mints once, same as before, but still avoids
// re-minting per request within a warm instance.
let cachedToken: { accessToken: string; expiresAtMs: number; clientEmail: string } | null = null
let inFlightTokenRequest: Promise<string> | null = null
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min before actual expiry

async function getCachedGoogleAccessToken(credentials: ServiceAccountCredentials): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.clientEmail === credentials.client_email && cachedToken.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > now) {
    return cachedToken.accessToken
  }
  if (inFlightTokenRequest) return inFlightTokenRequest

  inFlightTokenRequest = (async () => {
    const mintedAt = Date.now()
    const accessToken = await getGoogleAccessToken(credentials)
    cachedToken = { accessToken, expiresAtMs: mintedAt + 3600 * 1000, clientEmail: credentials.client_email }
    return accessToken
  })()

  try {
    return await inFlightTokenRequest
  } finally {
    inFlightTokenRequest = null
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

// ---------------------------------------------------------------------------
// Large-PDF chunking (interim, no-Cloud-Storage workaround)
//
// Google's synchronous Document AI `:process` endpoint — the one this route
// calls — hard-caps at 15 pages per request (30 with imageless_mode, which
// this processor isn't confirmed to have enabled). A real multi-page source
// bundle (e.g. an 800-1000 page scan) simply cannot go through it as one
// call; it isn't a slowness problem, it's a hard rejection.
//
// The *correct* long-term answer is Document AI's asynchronous batchProcess
// API plus a Splitter/Classifier processor — but both require standing up
// Cloud Storage (batchProcess reads/writes GCS, full stop) and a trained
// classifier, which is deliberately deferred to the pre-launch phase (see
// docs/bulk-ingestion-architecture.md).
//
// Until then, this is a stopgap that unblocks testing OCR against real
// large documents with zero new infrastructure: split the PDF locally into
// <=15-page chunks, run each chunk through the existing synchronous call
// (now cheap thanks to the cached OAuth token above — no extra round trip
// per chunk), and stitch the results back into a single TESMachineDocumentResult
// with page numbers remapped to the original document.
//
// IMPORTANT LIMITATION — this does NOT do document-type segregation. Every
// chunk is run through the same processor (currently tuned for Roadside
// Inspection). If a source file is a bundle of DIFFERENT document types
// (e.g. CDL copies + MVRs + medical certs concatenated into one scan), this
// will dutifully OCR every page but only meaningfully extract fields from
// the pages that actually match that processor's schema — pages of other
// types will come back with few/no mapped observations, not an error. That
// "divide by type" problem is exactly what the deferred Splitter/Classifier
// processor solves; this chunker only solves "our extractor chokes past
// page 15."
const SYNC_PAGE_LIMIT = 15
const CHUNK_CONCURRENCY = 4

async function splitPdfIntoChunks(pdfBytes: Uint8Array, maxPagesPerChunk: number): Promise<Array<{ bytes: Uint8Array; startPage: number; pageCount: number }>> {
  const source = await PDFDocument.load(pdfBytes)
  const totalPages = source.getPageCount()
  const chunks: Array<{ bytes: Uint8Array; startPage: number; pageCount: number }> = []

  for (let start = 0; start < totalPages; start += maxPagesPerChunk) {
    const end = Math.min(start + maxPagesPerChunk, totalPages)
    const chunkDoc = await PDFDocument.create()
    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i)
    const copiedPages = await chunkDoc.copyPages(source, pageIndices)
    for (const page of copiedPages) chunkDoc.addPage(page)
    const bytes = await chunkDoc.save()
    chunks.push({ bytes, startPage: start, pageCount: end - start })
  }
  return chunks
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function worker() {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function mergeChunkResults(
  evidenceId: string,
  chunkResults: Array<{ result: TESMachineDocumentResult; pageOffset: number }>
): TESMachineDocumentResult {
  const observations = chunkResults.flatMap(({ result, pageOffset }) =>
    result.observations.map((observation) =>
      pageOffset === 0 || !observation.sourceLocation?.page
        ? observation
        : { ...observation, sourceLocation: { ...observation.sourceLocation, page: observation.sourceLocation.page + pageOffset } }
    )
  )
  const bestClassification = chunkResults
    .map(({ result }) => result.classification)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]
  const warnings = [
    `Source document was split locally into ${chunkResults.length} chunk(s) of up to ${SYNC_PAGE_LIMIT} pages each (no Cloud Storage / batch pipeline configured yet). Each chunk ran through the same processor — this does not segregate mixed document-type bundles.`,
    ...chunkResults.flatMap(({ result }) => result.warnings),
  ]
  return {
    sourceEvidenceId: evidenceId,
    classification: bestClassification,
    observations,
    providerMetadata: chunkResults[0].result.providerMetadata,
    warnings,
  }
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
    const accessToken = await getCachedGoogleAccessToken(credentials)

    const provider = new GoogleDocumentAIAcquisitionProvider({
      projectId,
      processorId,
      location,
      accessToken,
    })

    const evidenceId = randomUUID()
    const mimeType = file.type || "application/pdf"
    const arrayBuffer = await file.arrayBuffer()
    const isPdf = mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")

    // Only PDFs can carry more pages than the sync endpoint allows — images
    // are inherently single-page, so they always take the direct path.
    const pageCount = isPdf ? (await PDFDocument.load(arrayBuffer)).getPageCount() : 1

    if (pageCount <= SYNC_PAGE_LIMIT) {
      const contentBase64 = Buffer.from(arrayBuffer).toString("base64")
      const result = await provider.process({ evidenceId, fileName: file.name, mimeType, contentBase64 })
      return NextResponse.json({ result })
    }

    // Over the limit — split locally and process each chunk with the same
    // cached-token provider, bounded concurrency to stay polite to Document
    // AI's per-minute quota. See the chunking comment above for what this
    // does and doesn't solve.
    console.warn(`[Document AI] ${file.name}: ${pageCount} pages exceeds the ${SYNC_PAGE_LIMIT}-page sync limit — chunking locally.`)
    const chunks = await splitPdfIntoChunks(new Uint8Array(arrayBuffer), SYNC_PAGE_LIMIT)
    const chunkResults = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, async (chunk, index) => {
      const contentBase64 = Buffer.from(chunk.bytes).toString("base64")
      const result = await provider.process({
        evidenceId: `${evidenceId}-chunk-${index}`,
        fileName: `${file.name} (pages ${chunk.startPage + 1}-${chunk.startPage + chunk.pageCount})`,
        mimeType: "application/pdf",
        contentBase64,
      })
      return { result, pageOffset: chunk.startPage }
    })

    const result = mergeChunkResults(evidenceId, chunkResults)
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document AI processing failed"
    console.error("Document AI API error:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
