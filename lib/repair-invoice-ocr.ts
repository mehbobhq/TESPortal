/**
 * TES-owned repair-invoice OCR contract.
 *
 * Provider SDK types must never escape an adapter. Google Document AI,
 * Azure, AWS, or a future TES model all map into these stable structures.
 */

import type { RepairCurrency, RepairLineType } from "@/lib/repair-invoice-data"

export const REPAIR_INVOICE_DOCUMENT_TYPE = "REPAIR_INVOICE" as const
export const REPAIR_OCR_CONTRACT_VERSION = "1.0.0"

export type IngestionDecision =
  | "AUTO_ACCEPT"
  | "HUMAN_REVIEW_REQUIRED"
  | "OWNERSHIP_MISMATCH"
  | "VEHICLE_MISMATCH"
  | "POSSIBLE_DUPLICATE"
  | "UNRECONCILED"
  | "UNSUPPORTED_DOCUMENT"

export interface OCRFieldValue<T> {
  rawValue?: string
  normalizedValue?: T
  confidence: number
  sourcePageNumber?: number
  sourceBoundingBox?: unknown
  reviewedValue?: T
  reviewedBy?: string
  reviewedAt?: string
}

export interface ExtractedRepairInvoiceLine {
  sourcePageNumber: number
  sourceText: string
  description?: OCRFieldValue<string>
  partNumber?: OCRFieldValue<string>
  quantity?: OCRFieldValue<number>
  unitPrice?: OCRFieldValue<number>
  lineTotal?: OCRFieldValue<number>
  suggestedLineType?: RepairLineType
  suggestedSystemId?: string
  suggestedAssemblyId?: string
  suggestedComponentId?: string
  suggestedAction?: string
  suggestedPosition?: string
  suggestedFinding?: string
  confidence: number
  sourceBoundingBox?: unknown
}

export interface ExtractedRepairInvoice {
  contractVersion: typeof REPAIR_OCR_CONTRACT_VERSION
  documentType: typeof REPAIR_INVOICE_DOCUMENT_TYPE
  provider: {
    rawName?: OCRFieldValue<string>
    address?: OCRFieldValue<string>
    phone?: OCRFieldValue<string>
    email?: OCRFieldValue<string>
    taxRegistrationNumber?: OCRFieldValue<string>
    facilityName?: OCRFieldValue<string>
    technicianNames?: OCRFieldValue<string[]>
  }
  customer: {
    rawCompanyName?: OCRFieldValue<string>
    address?: OCRFieldValue<string>
    accountNumber?: OCRFieldValue<string>
  }
  vehicle: {
    unitNumber?: OCRFieldValue<string>
    vin?: OCRFieldValue<string>
    plateNumber?: OCRFieldValue<string>
    plateJurisdiction?: OCRFieldValue<string>
    year?: OCRFieldValue<string>
    make?: OCRFieldValue<string>
    model?: OCRFieldValue<string>
    odometer?: OCRFieldValue<number>
    odometerUnit?: OCRFieldValue<"KM" | "MI">
  }
  invoice: {
    invoiceNumber?: OCRFieldValue<string>
    invoiceDate?: OCRFieldValue<string>
    serviceCompletionDate?: OCRFieldValue<string>
    workOrderNumber?: OCRFieldValue<string>
    purchaseOrderNumber?: OCRFieldValue<string>
    currency?: OCRFieldValue<RepairCurrency>
    subtotal?: OCRFieldValue<number>
    tax?: OCRFieldValue<number>
    total?: OCRFieldValue<number>
    credits?: OCRFieldValue<number>
  }
  lines: ExtractedRepairInvoiceLine[]
}

export interface OCRSourceDocument {
  sourceDocumentId: string
  fileName: string
  mimeType: string
  dataUrl?: string
  bytes?: Uint8Array
  pageNumbers?: number[]
}

export interface RepairInvoiceOCRResult {
  providerName: string
  adapterVersion: string
  sourceDocumentId: string
  classificationConfidence: number
  segmentationConfidence: number
  extraction: ExtractedRepairInvoice
  warnings: string[]
}

export interface RepairInvoiceOCRAdapter {
  providerName: string
  adapterVersion: string
  isConfigured(): boolean
  analyze(input: OCRSourceDocument): Promise<RepairInvoiceOCRResult>
}

/** Safe default used until permanent production OCR credentials exist. */
export class UnconfiguredRepairInvoiceOCRAdapter implements RepairInvoiceOCRAdapter {
  readonly providerName = "UNCONFIGURED"
  readonly adapterVersion = "1.0.0"

  isConfigured(): boolean {
    return false
  }

  async analyze(): Promise<RepairInvoiceOCRResult> {
    throw new Error("Repair invoice OCR is not configured. Attach the invoice and use manual entry; the evidence remains linked for later OCR processing.")
  }
}

export interface RepairIngestionConfidence {
  documentClassification: number
  segmentation: number
  companyOwnership: number
  vehicleIdentity: number
  providerMatch: number
  invoiceHeader: number
  invoiceLines: number
  financialReconciliation: number
  duplicateConfidence: number
}

export interface RepairIngestionThresholds {
  version: string
  documentClassification: number
  segmentation: number
  companyOwnership: number
  vehicleIdentity: number
  providerMatch: number
  invoiceHeader: number
  invoiceLines: number
  financialReconciliation: number
}

export const DEFAULT_REPAIR_INGESTION_THRESHOLDS: RepairIngestionThresholds = {
  version: "repair-ingestion-v1",
  documentClassification: 0.98,
  segmentation: 0.98,
  companyOwnership: 0.99,
  vehicleIdentity: 0.99,
  providerMatch: 0.9,
  invoiceHeader: 0.98,
  invoiceLines: 0.98,
  financialReconciliation: 1,
}

export function decideRepairInvoiceIngestion(input: {
  confidence: RepairIngestionConfidence
  thresholds?: RepairIngestionThresholds
  companyConflict?: boolean
  vehicleConflict?: boolean
  possibleDuplicate?: boolean
  reconciled?: boolean
  evidenceStored?: boolean
  supportedDocument?: boolean
}): { decision: IngestionDecision; reasons: string[]; thresholdVersion: string } {
  const thresholds = input.thresholds || DEFAULT_REPAIR_INGESTION_THRESHOLDS
  const reasons: string[] = []
  if (input.supportedDocument === false) return { decision: "UNSUPPORTED_DOCUMENT", reasons: ["The source is not a supported repair invoice or confirmed receipt."], thresholdVersion: thresholds.version }
  if (input.companyConflict) return { decision: "OWNERSHIP_MISMATCH", reasons: ["Extracted company identifiers conflict with the selected company."], thresholdVersion: thresholds.version }
  if (input.vehicleConflict) return { decision: "VEHICLE_MISMATCH", reasons: ["Extracted VIN, plate, or unit identifiers conflict with the selected vehicle."], thresholdVersion: thresholds.version }
  if (input.possibleDuplicate) return { decision: "POSSIBLE_DUPLICATE", reasons: ["The source resembles an existing repair invoice."], thresholdVersion: thresholds.version }
  if (input.reconciled === false) return { decision: "UNRECONCILED", reasons: ["Calculated invoice rows do not reconcile to the document total."], thresholdVersion: thresholds.version }
  if (!input.evidenceStored) reasons.push("Immutable source evidence has not been stored.")

  const checks: [keyof RepairIngestionConfidence, keyof RepairIngestionThresholds, string][] = [
    ["documentClassification", "documentClassification", "Document classification"],
    ["segmentation", "segmentation", "Document segmentation"],
    ["companyOwnership", "companyOwnership", "Company ownership"],
    ["vehicleIdentity", "vehicleIdentity", "Vehicle identity"],
    ["providerMatch", "providerMatch", "Provider match"],
    ["invoiceHeader", "invoiceHeader", "Invoice header extraction"],
    ["invoiceLines", "invoiceLines", "Invoice line extraction"],
    ["financialReconciliation", "financialReconciliation", "Financial reconciliation"],
  ]
  for (const [confidenceKey, thresholdKey, label] of checks) {
    const threshold = thresholds[thresholdKey]
    if (typeof threshold === "number" && input.confidence[confidenceKey] < threshold) reasons.push(`${label} confidence is below ${Math.round(threshold * 100)}%.`)
  }
  return {
    decision: reasons.length ? "HUMAN_REVIEW_REQUIRED" : "AUTO_ACCEPT",
    reasons,
    thresholdVersion: thresholds.version,
  }
}

