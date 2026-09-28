import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"
import { GoogleDocumentAIAcquisitionProvider } from "@/lib/google-document-ai-provider"
import type { TESMachineDocumentResult } from "@/lib/machine-acquisition"
import { getGoogleAccessToken } from "@/lib/google/auth"
import { documentAiLocation, googleProjectId, roadsideDocumentAiProcessorId } from "@/lib/google/config"

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
// (the Google access token used for every chunk is minted once per request
// via lib/google/auth.ts, which itself caches internally — no extra token
// round trip per chunk), and stitch the results back into a single
// TESMachineDocumentResult with page numbers remapped to the original
// document.
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

    const projectId = googleProjectId()
    const processorId = roadsideDocumentAiProcessorId()
    const location = documentAiLocation()
    const accessToken = await getGoogleAccessToken()

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
    // Server-side only: the full error (which may include upstream Google
    // response text, e.g. from lib/google-document-ai-provider.ts) is logged
    // here for operators, but never contains credentials or tokens - Google's
    // error response bodies describe the request that failed, not the
    // Authorization header used to make it. The client below always gets a
    // stable, generic message instead of this detail, regardless of what
    // actually failed (missing configuration, a Google API error, an auth
    // failure, or a parsing error), so upstream response text, auth details,
    // tokens, and internal configuration state can never reach the client.
    console.error("Document AI API error:", error)
    return NextResponse.json({ error: "Document AI processing failed. Please try again." }, { status: 500 })
  }
}
