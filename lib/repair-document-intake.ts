export type DuplicateDecision = "NOT_DUPLICATE" | "EXACT_DUPLICATE" | "PROBABLE_DUPLICATE" | "POSSIBLE_DUPLICATE" | "AUTHORIZED_REPROCESSING"
export type IntakeStatus = "UPLOADED" | "SEGMENTATION_REVIEW" | "OCR_PENDING" | "OCR_REVIEW" | "CANONICAL_CREATED" | "DUPLICATE_REVIEW" | "MISMATCH_REVIEW"

export interface RepairSourceFile {
  id: string
  uploadBatchId: string
  fileName: string
  mimeType: string
  size: number
  pageCount?: number
  sha256: string
  pageHashes: string[]
  status: IntakeStatus
  createdAt: string
}

export interface DetectedRepairDocument {
  id: string
  sourceFileId: string
  pageNumbers: number[]
  documentType: "REPAIR_INVOICE" | "UNKNOWN"
  classificationConfidence: number
  segmentationConfidence: number
  status: IntakeStatus
}

export interface RepairDuplicateCandidate {
  invoiceId: string
  score: number
  decision: DuplicateDecision
  matchedSignals: string[]
}

interface RepairIntakeStore {
  version: 1
  sourceFiles: RepairSourceFile[]
  detectedDocuments: DetectedRepairDocument[]
}

const INTAKE_STORAGE_KEY = "tes_repair_document_intake_v1"

function readIntakeStore(): RepairIntakeStore {
  if (typeof window === "undefined") return { version: 1, sourceFiles: [], detectedDocuments: [] }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INTAKE_STORAGE_KEY) || "{}") as Partial<RepairIntakeStore>
    return { version: 1, sourceFiles: Array.isArray(parsed.sourceFiles) ? parsed.sourceFiles : [], detectedDocuments: Array.isArray(parsed.detectedDocuments) ? parsed.detectedDocuments : [] }
  } catch {
    return { version: 1, sourceFiles: [], detectedDocuments: [] }
  }
}

function writeIntakeStore(store: RepairIntakeStore): void {
  if (typeof window === "undefined") throw new Error("Repair document intake can only be stored in the browser.")
  window.localStorage.setItem(INTAKE_STORAGE_KEY, JSON.stringify(store))
}

function intakeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function registerRepairSourceFile(input: { file: File; uploadBatchId?: string; allowExactReprocessing?: boolean }): Promise<{ sourceFile: RepairSourceFile; duplicateDecision: DuplicateDecision; existingSourceFileId?: string }> {
  const bytes = new Uint8Array(await input.file.arrayBuffer())
  const sha256 = await sha256Hex(bytes)
  const store = readIntakeStore()
  const existing = store.sourceFiles.find((file) => file.sha256 === sha256 && file.size === input.file.size)
  if (existing && !input.allowExactReprocessing) return { sourceFile: existing, duplicateDecision: "EXACT_DUPLICATE", existingSourceFileId: existing.id }
  const sourceFile: RepairSourceFile = {
    id: intakeId("RSRC"),
    uploadBatchId: input.uploadBatchId || intakeId("RBATCH"),
    fileName: input.file.name,
    mimeType: input.file.type || "application/octet-stream",
    size: input.file.size,
    sha256,
    pageHashes: [],
    status: "UPLOADED",
    createdAt: new Date().toISOString(),
  }
  writeIntakeStore({ ...store, sourceFiles: [sourceFile, ...store.sourceFiles] })
  return { sourceFile, duplicateDecision: existing ? "AUTHORIZED_REPROCESSING" : "NOT_DUPLICATE", existingSourceFileId: existing?.id }
}

export function registerDetectedRepairDocument(input: Omit<DetectedRepairDocument, "id">): DetectedRepairDocument {
  const store = readIntakeStore()
  const overlapping = store.detectedDocuments.find((document) => document.sourceFileId === input.sourceFileId && document.pageNumbers.some((page) => input.pageNumbers.includes(page)))
  if (overlapping) throw new Error(`Source page ownership overlaps detected document ${overlapping.id}. Review segmentation before OCR.`)
  const document: DetectedRepairDocument = { ...input, id: intakeId("RDET") }
  writeIntakeStore({ ...store, detectedDocuments: [document, ...store.detectedDocuments] })
  return document
}

export function normalizeBusinessKey(value?: string): string {
  return (value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "").trim()
}

export async function sha256Hex(input: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input)
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("SHA-256 is unavailable in this environment.")
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("")
}

export function createInvoiceBusinessFingerprint(input: {
  companyId: string
  providerId?: string
  providerName?: string
  facilityId?: string
  invoiceNumber?: string
  invoiceDate?: string
  serviceCompletionDate?: string
  vehicleId?: string
  currency?: string
  totalDue?: number
  lineFingerprint?: string
}): string {
  return [
    input.companyId,
    input.providerId || normalizeBusinessKey(input.providerName),
    input.facilityId,
    normalizeBusinessKey(input.invoiceNumber),
    input.invoiceDate,
    input.serviceCompletionDate,
    input.vehicleId,
    input.currency,
    Number(input.totalDue || 0).toFixed(2),
    input.lineFingerprint,
  ].map((value) => value || "-").join("|")
}

export function createLineFingerprint(lines: {
  description: string
  partNumber?: string
  quantity: number
  unitPrice: number
  lineTotal: number
}[]): string {
  return lines.map((line) => [
    normalizeBusinessKey(line.description),
    normalizeBusinessKey(line.partNumber),
    Number(line.quantity || 0).toFixed(4),
    Number(line.unitPrice || 0).toFixed(2),
    Number(line.lineTotal || 0).toFixed(2),
  ].join(":" )).sort().join(";")
}

export function scoreDuplicateCandidate(source: {
  sourceHash?: string
  companyId: string
  providerId?: string
  normalizedProviderName?: string
  invoiceNumber?: string
  invoiceDate?: string
  serviceCompletionDate?: string
  vehicleId?: string
  currency?: string
  totalDue?: number
  lineFingerprint?: string
}, existing: typeof source & { invoiceId: string }): RepairDuplicateCandidate {
  const matchedSignals: string[] = []
  if (source.sourceHash && source.sourceHash === existing.sourceHash) return { invoiceId: existing.invoiceId, score: 1, decision: "EXACT_DUPLICATE", matchedSignals: ["sourceHash"] }
  let score = 0
  const match = (condition: boolean, weight: number, signal: string) => { if (condition) { score += weight; matchedSignals.push(signal) } }
  match(source.companyId === existing.companyId, 0.15, "company")
  match(Boolean(source.providerId && source.providerId === existing.providerId), 0.15, "provider")
  match(Boolean(!source.providerId && source.normalizedProviderName && source.normalizedProviderName === existing.normalizedProviderName), 0.1, "providerName")
  match(Boolean(source.invoiceNumber && normalizeBusinessKey(source.invoiceNumber) === normalizeBusinessKey(existing.invoiceNumber)), 0.2, "invoiceNumber")
  match(Boolean(source.invoiceDate && source.invoiceDate === existing.invoiceDate), 0.08, "invoiceDate")
  match(Boolean(source.serviceCompletionDate && source.serviceCompletionDate === existing.serviceCompletionDate), 0.05, "serviceCompletionDate")
  match(Boolean(source.vehicleId && source.vehicleId === existing.vehicleId), 0.12, "vehicle")
  match(Boolean(source.currency && source.currency === existing.currency), 0.03, "currency")
  match(Math.abs(Number(source.totalDue || 0) - Number(existing.totalDue || 0)) <= 0.02, 0.12, "total")
  match(Boolean(source.lineFingerprint && source.lineFingerprint === existing.lineFingerprint), 0.2, "lines")
  const bounded = Math.min(1, score)
  return {
    invoiceId: existing.invoiceId,
    score: bounded,
    decision: bounded >= 0.9 ? "PROBABLE_DUPLICATE" : bounded >= 0.65 ? "POSSIBLE_DUPLICATE" : "NOT_DUPLICATE",
    matchedSignals,
  }
}
