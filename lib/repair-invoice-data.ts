import { createId, isoNow } from "@/lib/vehicle-data"
import {
  loadRepairComponentCatalog,
  matchRepairComponent,
  type RepairComponentCatalogEntry,
  type RepairOrigin,
} from "@/lib/repair-component-catalog"
import { recordAuditEvent } from "@/lib/audit-logger"
import {
  createInvoiceBusinessFingerprint,
  createLineFingerprint,
  normalizeBusinessKey,
  scoreDuplicateCandidate,
  type DuplicateDecision,
} from "@/lib/repair-document-intake"

export const RECONCILIATION_TOLERANCE = 0.02

export function signedLineAmount(line: { lineType: RepairLineType; lineTotal: number }): number {
  const magnitude = Math.abs(line.lineTotal)
  return line.lineType === "CREDIT" ? -magnitude : line.lineTotal
}

export function calculateRowsTotal(lines: { lineType: RepairLineType; lineTotal: number }[]): number {
  return Math.round(lines.reduce((sum, line) => sum + signedLineAmount(line), 0) * 100) / 100
}

export type VarianceState = "NOT_YET_COMPARABLE" | "RECONCILED" | "VARIANCE_DETECTED"

export function getVarianceState(documentInvoiceTotal: number | null | undefined, calculatedRows: number): { state: VarianceState; variance: number | null } {
  if (documentInvoiceTotal === null || documentInvoiceTotal === undefined || Number.isNaN(documentInvoiceTotal) || documentInvoiceTotal === 0) {
    return { state: "NOT_YET_COMPARABLE", variance: null }
  }
  const variance = money(documentInvoiceTotal - calculatedRows)
  return { state: Math.abs(variance) <= RECONCILIATION_TOLERANCE ? "RECONCILED" : "VARIANCE_DETECTED", variance }
}

export type RepairInvoiceStatus = "pending_review" | "verified" | "auto_approved" | "duplicate_review" | "mismatch_review"
export type RepairEntrySource = "manual" | "ocr" | "import" | "system"
export type RepairDocumentKind = "FINAL_INVOICE" | "CONFIRMED_RECEIPT"
export type RepairCurrency = "CAD" | "USD"
export type RepairLineType = "PART" | "LABOR" | "SUBLET" | "SHOP_SUPPLY" | "TOWING" | "FEE" | "TAX" | "CREDIT" | "OTHER"
export type OdometerSource = "EVIDENCE" | "CLIENT_CONFIRMED" | "LINKED_RECORD" | "NOT_STATED"
export type EquipmentPosition = "FRONT_LEFT" | "FRONT_RIGHT" | "REAR_LEFT" | "REAR_RIGHT" | "AXLE_1" | "AXLE_2" | "AXLE_3" | "TRACTOR" | "TRAILER" | "NOT_STATED"

export interface RepairInvoice {
  id: string
  companyId: string
  vehicleId: string
  vendorId?: string
  vendorName?: string
  providerProfileId?: string
  facilityId?: string
  contactId?: string
  technicianId?: string
  invoiceNumber: string
  invoiceDate: string
  /** Mechanical chronology and recurrence use this date. */
  serviceCompletionDate: string
  documentKind: RepairDocumentKind
  currency: RepairCurrency
  reportingCurrency: RepairCurrency
  exchangeRate: number
  exchangeRateSource?: string
  exchangeRateEffectiveDate?: string
  /** Gross final invoice amount in the source currency. */
  totalDue: number
  /** Gross final invoice amount converted to the company reporting currency. */
  reportingTotal: number
  subtotal: number
  variance: number
  reconciliationState: VarianceState
  reconciles: boolean
  status: RepairInvoiceStatus
  entrySource: RepairEntrySource
  repairOrigin?: RepairOrigin
  odometer?: number
  odometerUnit?: "KM" | "MI"
  odometerSource: OdometerSource
  maintenanceEventId?: string
  roadsideEventId?: string
  sourceInspectionFindingIds: string[]
  evidenceIds: string[]
  sourceDocumentId?: string
  sourceDocumentHash?: string
  uploadBatchId?: string
  detectedDocumentId?: string
  idempotencyKey: string
  businessFingerprint: string
  thresholdVersion?: string
  confidenceSnapshot?: Record<string, number>
  duplicateDecision: DuplicateDecision
  duplicateOfInvoiceId?: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface RepairInvoiceLine {
  id: string
  invoiceId: string
  /** Exact source wording. Never replace it with the normalized label. */
  rawDescription: string
  description: string
  lineType: RepairLineType
  partNumber?: string
  quantity: number
  unitPrice: number
  lineTotal: number
  system?: string
  assembly?: string
  component?: string
  action?: string
  finding?: string
  position?: EquipmentPosition
  repairOrigin?: RepairOrigin
  matchedPartId?: string
  matchConfidence?: number
  mappingStatus: "UNMAPPED" | "SYSTEM_MATCHED" | "COMPONENT_MATCHED" | "HUMAN_VERIFIED"
  sourcePage?: number
  sourceBoundingBox?: unknown
  sourceEventIds: string[]
  sourceFindingIds: string[]
  ocrConfidence?: number
  createdAt: string
  updatedAt: string
}

export interface RepairLineInput {
  description: string
  lineType?: RepairLineType
  partNumber?: string
  quantity: number
  unitPrice: number
  lineTotal?: number
  system?: string
  assembly?: string
  component?: string
  action?: string
  finding?: string
  position?: EquipmentPosition
  repairOrigin?: RepairOrigin
  matchedPartId?: string
  sourcePage?: number
  sourceBoundingBox?: unknown
  sourceEventIds?: string[]
  sourceFindingIds?: string[]
  ocrConfidence?: number
}

export interface RepairSourceLink {
  id: string
  sourceType: "MAINTENANCE_EVENT" | "ROADSIDE_EVENT" | "INSPECTION_FINDING" | "DVIR_FINDING" | "POST_INCIDENT_INSPECTION"
  sourceId: string
  invoiceId: string
  lineId?: string
  createdAt: string
}

interface RepairInvoiceStoreV4 {
  version: 4
  invoices: RepairInvoice[]
  lines: RepairInvoiceLine[]
  sourceLinks: RepairSourceLink[]
}

interface LegacyRepairInvoiceStore {
  version?: number
  invoices?: Partial<RepairInvoice>[]
  lines?: Partial<RepairInvoiceLine>[]
  sourceLinks?: Partial<RepairSourceLink>[]
}

const STORE_PREFIX = "tes_repair_invoice_store_v4_"
const LEGACY_STORE_PREFIXES = ["tes_repair_invoice_store_v3_", "tes_repair_invoice_store_v2_"]

function emptyStore(): RepairInvoiceStoreV4 {
  return { version: 4, invoices: [], lines: [], sourceLinks: [] }
}

function storageKey(companyId: string): string {
  return `${STORE_PREFIX}${companyId}`
}

function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

function inferLineType(description: string): RepairLineType {
  const value = description.toLowerCase()
  if (/\b(labou?r|service|diagnos|technician|hours?)\b/.test(value)) return "LABOR"
  if (/\b(shop suppl|environment|recycl|disposal)\b/.test(value)) return "SHOP_SUPPLY"
  if (/\b(tow|hook fee|recovery)\b/.test(value)) return "TOWING"
  if (/\b(gst|hst|pst|sales tax|tax)\b/.test(value)) return "TAX"
  if (/\b(credit|discount|refund)\b/.test(value)) return "CREDIT"
  if (/\b(sublet|machine shop)\b/.test(value)) return "SUBLET"
  return "PART"
}

function migrateStore(value: LegacyRepairInvoiceStore): RepairInvoiceStoreV4 {
  const invoices = Array.isArray(value.invoices) ? value.invoices : []
  const lines = Array.isArray(value.lines) ? value.lines : []
  return {
    version: 4,
    invoices: invoices.map((source) => {
      const totalDue = money(source.totalDue || 0)
      return {
        id: source.id || createId("RINV"),
        companyId: source.companyId || "",
        vehicleId: source.vehicleId || "",
        vendorId: source.vendorId,
        vendorName: source.vendorName,
        providerProfileId: source.providerProfileId,
        facilityId: source.facilityId,
        contactId: source.contactId,
        technicianId: source.technicianId,
        invoiceNumber: source.invoiceNumber || "",
        invoiceDate: source.invoiceDate || "",
        serviceCompletionDate: source.serviceCompletionDate || source.invoiceDate || "",
        documentKind: source.documentKind || "FINAL_INVOICE",
        currency: source.currency || "CAD",
        reportingCurrency: source.reportingCurrency || source.currency || "CAD",
        exchangeRate: Number(source.exchangeRate) || 1,
        exchangeRateSource: source.exchangeRateSource,
        exchangeRateEffectiveDate: source.exchangeRateEffectiveDate,
        totalDue,
        reportingTotal: money(source.reportingTotal || totalDue),
        subtotal: money(source.subtotal || 0),
        variance: money(source.variance || ((source.totalDue || 0) - (source.subtotal || 0))),
        reconciliationState: source.reconciliationState || (source.reconciles ? "RECONCILED" : "VARIANCE_DETECTED"),
        reconciles: Boolean(source.reconciles),
        status: source.status || "pending_review",
        entrySource: source.entrySource || "manual",
        repairOrigin: source.repairOrigin,
        odometer: source.odometer,
        odometerUnit: source.odometerUnit,
        odometerSource: source.odometerSource || "NOT_STATED",
        maintenanceEventId: source.maintenanceEventId,
        roadsideEventId: source.roadsideEventId,
        sourceInspectionFindingIds: source.sourceInspectionFindingIds || [],
        evidenceIds: source.evidenceIds || [],
        sourceDocumentId: source.sourceDocumentId,
        sourceDocumentHash: source.sourceDocumentHash,
        uploadBatchId: source.uploadBatchId,
        detectedDocumentId: source.detectedDocumentId,
        idempotencyKey: source.idempotencyKey || `legacy:${source.id || createId("RINV")}`,
        businessFingerprint: source.businessFingerprint || "",
        thresholdVersion: source.thresholdVersion,
        confidenceSnapshot: source.confidenceSnapshot,
        duplicateDecision: source.duplicateDecision || "NOT_DUPLICATE",
        duplicateOfInvoiceId: source.duplicateOfInvoiceId,
        archived: Boolean(source.archived),
        createdAt: source.createdAt || isoNow(),
        updatedAt: source.updatedAt || isoNow(),
      }
    }),
    lines: lines.map((source) => ({
      id: source.id || createId("RLINE"),
      invoiceId: source.invoiceId || "",
      rawDescription: source.rawDescription || source.description || "",
      description: source.description || source.rawDescription || "",
      lineType: source.lineType || inferLineType(source.rawDescription || source.description || ""),
      partNumber: source.partNumber,
      quantity: Number(source.quantity) || 0,
      unitPrice: money(source.unitPrice || 0),
      lineTotal: money(source.lineTotal || 0),
      system: source.system,
      assembly: source.assembly,
      component: source.component,
      action: source.action,
      finding: source.finding,
      position: source.position,
      repairOrigin: source.repairOrigin,
      matchedPartId: source.matchedPartId,
      matchConfidence: source.matchConfidence,
      mappingStatus: source.mappingStatus || "UNMAPPED",
      sourcePage: source.sourcePage,
      sourceBoundingBox: source.sourceBoundingBox,
      sourceEventIds: source.sourceEventIds || [],
      sourceFindingIds: source.sourceFindingIds || [],
      ocrConfidence: source.ocrConfidence,
      createdAt: source.createdAt || isoNow(),
      updatedAt: source.updatedAt || isoNow(),
    })),
    sourceLinks: Array.isArray(value.sourceLinks) ? value.sourceLinks.filter((link): link is RepairSourceLink => Boolean(link.id && link.sourceId && link.invoiceId)).map((link) => ({
      id: link.id,
      sourceType: link.sourceType,
      sourceId: link.sourceId,
      invoiceId: link.invoiceId,
      lineId: link.lineId,
      createdAt: link.createdAt || isoNow(),
    })) : [],
  }
}

function readStore(companyId: string): RepairInvoiceStoreV4 {
  if (typeof window === "undefined") return emptyStore()
  try {
    const current = window.localStorage.getItem(storageKey(companyId))
    if (current) return migrateStore(JSON.parse(current) as LegacyRepairInvoiceStore)
    const legacy = LEGACY_STORE_PREFIXES.map((prefix) => window.localStorage.getItem(`${prefix}${companyId}`)).find(Boolean)
    if (!legacy) return emptyStore()
    const migrated = migrateStore(JSON.parse(legacy) as LegacyRepairInvoiceStore)
    window.localStorage.setItem(storageKey(companyId), JSON.stringify(migrated))
    return migrated
  } catch {
    return emptyStore()
  }
}

function writeStore(companyId: string, store: RepairInvoiceStoreV4): void {
  if (typeof window === "undefined") throw new Error("Repair bills can only be saved in the browser.")
  window.localStorage.setItem(storageKey(companyId), JSON.stringify(store))
}

export interface RepairInvoiceInput {
  vehicleId: string
  vendorId?: string
  vendorName?: string
  providerProfileId?: string
  facilityId?: string
  contactId?: string
  technicianId?: string
  invoiceNumber: string
  invoiceDate: string
  serviceCompletionDate: string
  documentKind?: RepairDocumentKind
  currency?: RepairCurrency
  reportingCurrency?: RepairCurrency
  exchangeRate?: number
  exchangeRateSource?: string
  exchangeRateEffectiveDate?: string
  totalDue: number
  odometer?: number
  odometerUnit?: "KM" | "MI"
  odometerSource?: OdometerSource
  lines: RepairLineInput[]
  repairOrigin?: RepairOrigin
  maintenanceEventId?: string
  roadsideEventId?: string
  sourceInspectionFindingIds?: string[]
  evidenceIds?: string[]
  sourceDocumentHash?: string
}

export interface RepairInvoiceCreationContext {
  entrySource: RepairEntrySource
  actorId?: string
  actorRole?: string
  sourceDocumentId?: string
  uploadBatchId?: string
  detectedDocumentId?: string
  idempotencyKey: string
  thresholdVersion?: string
  confidenceSnapshot?: Record<string, number>
  allowPossibleDuplicate?: boolean
}

function validateRepairInvoiceInput(input: RepairInvoiceInput): void {
  if (!input.vehicleId) throw new Error("Vehicle is required.")
  if (!input.invoiceNumber.trim()) throw new Error("Invoice number is required.")
  if (!input.invoiceDate) throw new Error("Invoice date is required.")
  if (!input.serviceCompletionDate) throw new Error("Service completion date is required.")
  if (!input.vendorId && !input.vendorName?.trim()) throw new Error("Service provider is required.")
  if (!Number.isFinite(input.totalDue) || input.totalDue <= 0) throw new Error("Document invoice total must be greater than zero.")
  if (!input.lines.length) throw new Error("At least one invoice row is required.")
  if ((input.currency || "CAD") !== (input.reportingCurrency || input.currency || "CAD") && (!input.exchangeRate || input.exchangeRate <= 0)) throw new Error("A valid exchange rate is required when currencies differ.")
  for (const source of input.lines) {
    if (!source.description.trim()) throw new Error("Every invoice row requires its original description.")
    if (!Number.isFinite(source.quantity) || source.quantity <= 0) throw new Error("Every invoice row requires a quantity greater than zero.")
    const calculated = source.lineTotal ?? source.quantity * source.unitPrice
    if (!Number.isFinite(calculated)) throw new Error("Every invoice row requires a valid amount.")
    if ((source.lineType || inferLineType(source.description)) !== "CREDIT" && calculated < 0) throw new Error("Negative amounts must use the Credit / discount row type.")
  }
}

export function createRepairInvoice(companyId: string, input: RepairInvoiceInput, context: RepairInvoiceCreationContext): { invoice: RepairInvoice; lines: RepairInvoiceLine[]; reconciliationWarning: boolean; duplicateDecision: DuplicateDecision } {
  validateRepairInvoiceInput(input)
  if (!context.idempotencyKey.trim()) throw new Error("An idempotency key is required for repair invoice creation.")
  const store = readStore(companyId)
  const idempotent = store.invoices.find((existing) => existing.idempotencyKey === context.idempotencyKey)
  if (idempotent) return { invoice: idempotent, lines: store.lines.filter((line) => line.invoiceId === idempotent.id), reconciliationWarning: !idempotent.reconciles, duplicateDecision: idempotent.duplicateDecision }

  const now = isoNow()
  const invoiceId = createId("RINV")
  const catalog = loadRepairComponentCatalog(companyId)
  const lines: RepairInvoiceLine[] = input.lines.map((source) => {
    const calculatedTotal = source.lineTotal ?? source.quantity * source.unitPrice
    const manualEntry = source.matchedPartId ? catalog.find((entry) => entry.id === source.matchedPartId) : undefined
    const automaticMatch = manualEntry ? null : matchRepairComponent(source.description, catalog)
    const matchedEntry = manualEntry || automaticMatch?.entry
    const hasManualClassification = Boolean(source.system || source.assembly || source.component || source.action || source.finding)
    return {
      id: createId("RLINE"),
      invoiceId,
      rawDescription: source.description.trim(),
      description: source.description.trim(),
      lineType: source.lineType || inferLineType(source.description),
      partNumber: source.partNumber?.trim() || undefined,
      quantity: Number(source.quantity) || 0,
      unitPrice: money(source.unitPrice),
      lineTotal: money(calculatedTotal),
      system: source.system?.trim() || matchedEntry?.system,
      assembly: source.assembly?.trim() || matchedEntry?.assembly,
      component: source.component?.trim() || matchedEntry?.canonicalName,
      action: source.action?.trim() || undefined,
      finding: source.finding?.trim() || undefined,
      position: source.position,
      repairOrigin: source.repairOrigin || input.repairOrigin,
      matchedPartId: matchedEntry?.id,
      matchConfidence: manualEntry ? 1 : automaticMatch?.confidence,
      mappingStatus: hasManualClassification ? "HUMAN_VERIFIED" : matchedEntry ? "COMPONENT_MATCHED" : "UNMAPPED",
      sourcePage: source.sourcePage,
      sourceBoundingBox: source.sourceBoundingBox,
      sourceEventIds: Array.from(new Set([...(source.sourceEventIds || []), ...(input.maintenanceEventId ? [input.maintenanceEventId] : []), ...(input.roadsideEventId ? [input.roadsideEventId] : [])])),
      sourceFindingIds: Array.from(new Set(source.sourceFindingIds || [])),
      ocrConfidence: source.ocrConfidence,
      createdAt: now,
      updatedAt: now,
    }
  })
  const subtotal = calculateRowsTotal(lines)
  const totalDue = money(input.totalDue)
  const exchangeRate = Number(input.exchangeRate) || 1
  const reconciliation = getVarianceState(totalDue, subtotal)
  const reconciles = reconciliation.state === "RECONCILED"
  const lineFingerprint = createLineFingerprint(lines.map((line) => ({ description: line.rawDescription, partNumber: line.partNumber, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal })))
  const businessFingerprint = createInvoiceBusinessFingerprint({ companyId, providerId: input.providerProfileId || input.vendorId, providerName: input.vendorName, facilityId: input.facilityId, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, serviceCompletionDate: input.serviceCompletionDate, vehicleId: input.vehicleId, currency: input.currency || "CAD", totalDue, lineFingerprint })
  const candidates = store.invoices.filter((existing) => !existing.archived && !existing.duplicateOfInvoiceId).map((existing) => scoreDuplicateCandidate({
    sourceHash: input.sourceDocumentHash,
    companyId,
    providerId: input.providerProfileId || input.vendorId,
    normalizedProviderName: normalizeBusinessKey(input.vendorName),
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    serviceCompletionDate: input.serviceCompletionDate,
    vehicleId: input.vehicleId,
    currency: input.currency || "CAD",
    totalDue,
    lineFingerprint,
  }, {
    invoiceId: existing.id,
    sourceHash: existing.sourceDocumentHash,
    companyId: existing.companyId,
    providerId: existing.providerProfileId || existing.vendorId,
    normalizedProviderName: normalizeBusinessKey(existing.vendorName),
    invoiceNumber: existing.invoiceNumber,
    invoiceDate: existing.invoiceDate,
    serviceCompletionDate: existing.serviceCompletionDate,
    vehicleId: existing.vehicleId,
    currency: existing.currency,
    totalDue: existing.totalDue,
    lineFingerprint: createLineFingerprint(store.lines.filter((line) => line.invoiceId === existing.id).map((line) => ({ description: line.rawDescription, partNumber: line.partNumber, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal }))),
  })).sort((a, b) => b.score - a.score)
  const strongestDuplicate = candidates[0]
  const duplicateDecision: DuplicateDecision = strongestDuplicate?.decision || "NOT_DUPLICATE"
  if (strongestDuplicate && duplicateDecision === "EXACT_DUPLICATE" && !context.allowPossibleDuplicate) {
    throw new Error(`Possible duplicate repair bill: it matches ${strongestDuplicate.invoiceId} (${strongestDuplicate.matchedSignals.join(", ")}). Review the existing record instead of creating another.`)
  }
  const invoice: RepairInvoice = {
    id: invoiceId,
    companyId,
    vehicleId: input.vehicleId,
    vendorId: input.vendorId,
    vendorName: input.vendorName?.trim() || undefined,
    providerProfileId: input.providerProfileId,
    facilityId: input.facilityId,
    contactId: input.contactId,
    technicianId: input.technicianId,
    invoiceNumber: input.invoiceNumber.trim(),
    invoiceDate: input.invoiceDate,
    serviceCompletionDate: input.serviceCompletionDate || input.invoiceDate,
    documentKind: input.documentKind || "FINAL_INVOICE",
    currency: input.currency || "CAD",
    reportingCurrency: input.reportingCurrency || input.currency || "CAD",
    exchangeRate,
    exchangeRateSource: input.exchangeRateSource?.trim() || undefined,
    exchangeRateEffectiveDate: input.exchangeRateEffectiveDate,
    totalDue,
    reportingTotal: money(totalDue * exchangeRate),
    subtotal,
    variance: reconciliation.variance || 0,
    reconciliationState: reconciliation.state,
    reconciles,
    status: ["POSSIBLE_DUPLICATE", "PROBABLE_DUPLICATE"].includes(duplicateDecision) ? "duplicate_review" : "pending_review",
    entrySource: context.entrySource,
    repairOrigin: input.repairOrigin,
    odometer: input.odometer,
    odometerUnit: input.odometerUnit,
    odometerSource: input.odometerSource || "NOT_STATED",
    maintenanceEventId: input.maintenanceEventId,
    roadsideEventId: input.roadsideEventId,
    sourceInspectionFindingIds: input.sourceInspectionFindingIds || [],
    evidenceIds: input.evidenceIds || [],
    sourceDocumentId: context.sourceDocumentId,
    sourceDocumentHash: input.sourceDocumentHash,
    uploadBatchId: context.uploadBatchId,
    detectedDocumentId: context.detectedDocumentId,
    idempotencyKey: context.idempotencyKey,
    businessFingerprint,
    thresholdVersion: context.thresholdVersion,
    confidenceSnapshot: context.confidenceSnapshot,
    duplicateDecision,
    archived: false,
    createdAt: now,
    updatedAt: now,
  }
  const sourceLinks: RepairSourceLink[] = []
  const pushLink = (sourceType: RepairSourceLink["sourceType"], sourceId: string, lineId?: string) => sourceLinks.push({ id: createId("RLINK"), sourceType, sourceId, invoiceId, lineId, createdAt: now })
  if (input.maintenanceEventId) pushLink("MAINTENANCE_EVENT", input.maintenanceEventId)
  if (input.roadsideEventId) pushLink("ROADSIDE_EVENT", input.roadsideEventId)
  for (const findingId of input.sourceInspectionFindingIds || []) pushLink("INSPECTION_FINDING", findingId)
  for (const line of lines) {
    for (const eventId of line.sourceEventIds) {
      if (eventId !== input.maintenanceEventId && eventId !== input.roadsideEventId) pushLink("DVIR_FINDING", eventId, line.id)
    }
    for (const findingId of line.sourceFindingIds) pushLink("INSPECTION_FINDING", findingId, line.id)
  }
  writeStore(companyId, { version: 4, invoices: [invoice, ...store.invoices], lines: [...lines, ...store.lines], sourceLinks: [...sourceLinks, ...store.sourceLinks] })
  recordAuditEvent({ action: "CREATE", entityType: "Vehicle", entityId: invoice.id, companyId, actor: context.actorId || "", role: context.actorRole || "", details: `Created repair invoice ${invoice.invoiceNumber} from ${context.entrySource}; reconciliation=${invoice.reconciliationState}; duplicate=${duplicateDecision}; evidence=${invoice.evidenceIds.length}.` })
  return { invoice, lines, reconciliationWarning: !reconciles, duplicateDecision }
}

export function createManualRepairInvoice(companyId: string, input: RepairInvoiceInput & { idempotencyKey?: string }): { invoice: RepairInvoice; lines: RepairInvoiceLine[]; reconciliationWarning: boolean; duplicateDecision: DuplicateDecision } {
  const requestKey = input.idempotencyKey || `manual:${createId("REQ")}`
  return createRepairInvoice(companyId, input, { entrySource: "manual", idempotencyKey: requestKey })
}

export function getVehicleRepairInvoices(companyId: string, vehicleId: string): { invoice: RepairInvoice; lines: RepairInvoiceLine[] }[] {
  const store = readStore(companyId)
  return store.invoices
    .filter((invoice) => invoice.vehicleId === vehicleId && !invoice.archived && !invoice.duplicateOfInvoiceId)
    .sort((a, b) => `${b.serviceCompletionDate}${b.createdAt}`.localeCompare(`${a.serviceCompletionDate}${a.createdAt}`))
    .map((invoice) => ({ invoice, lines: store.lines.filter((line) => line.invoiceId === invoice.id) }))
}

function invoiceSpend(invoice: RepairInvoice): number {
  return money(invoice.reportingTotal || invoice.totalDue)
}

function isConfirmedExpenditure(invoice: RepairInvoice): boolean {
  return !invoice.archived
    && !invoice.duplicateOfInvoiceId
    && invoice.documentKind !== undefined
    && ["verified", "auto_approved"].includes(invoice.status)
}

export function getVehicleSpendSummary(companyId: string, vehicleId: string, fleetEntryDate?: string): { spendYTD: number; spendSinceFleetEntry: number; invoiceCount: number; lineCount: number } {
  const records = getVehicleRepairInvoices(companyId, vehicleId).filter(({ invoice }) => isConfirmedExpenditure(invoice))
  const year = new Date().getFullYear().toString()
  const fleetEntry = fleetEntryDate ? new Date(`${fleetEntryDate}T00:00:00`) : null
  const sinceFleetEntry = fleetEntry && !Number.isNaN(fleetEntry.getTime())
    ? records.filter(({ invoice }) => new Date(`${invoice.serviceCompletionDate}T00:00:00`) >= fleetEntry)
    : records
  return {
    spendYTD: money(records.filter(({ invoice }) => invoice.serviceCompletionDate.startsWith(year)).reduce((sum, { invoice }) => sum + invoiceSpend(invoice), 0)),
    spendSinceFleetEntry: money(sinceFleetEntry.reduce((sum, { invoice }) => sum + invoiceSpend(invoice), 0)),
    invoiceCount: records.length,
    lineCount: records.reduce((sum, record) => sum + record.lines.length, 0),
  }
}

export function getVehicleSpendByCategory(companyId: string, vehicleId: string, catalog: RepairComponentCatalogEntry[] = loadRepairComponentCatalog(companyId)): { category: string; total: number; lineCount: number }[] {
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]))
  const grouped = new Map<string, { total: number; lineCount: number }>()
  for (const { invoice, lines } of getVehicleRepairInvoices(companyId, vehicleId).filter(({ invoice }) => isConfirmedExpenditure(invoice))) {
    for (const line of lines) {
      const category = line.system || (line.matchedPartId ? catalogById.get(line.matchedPartId)?.system : undefined) || line.lineType.replaceAll("_", " ")
      const current = grouped.get(category) || { total: 0, lineCount: 0 }
      grouped.set(category, { total: current.total + signedLineAmount(line) * (invoice.exchangeRate || 1), lineCount: current.lineCount + 1 })
    }
  }
  return Array.from(grouped.entries()).map(([category, value]) => ({ category, total: money(value.total), lineCount: value.lineCount })).sort((a, b) => b.total - a.total)
}

export function getVehicleRecurringIssues(companyId: string, vehicleId: string, catalog: RepairComponentCatalogEntry[] = loadRepairComponentCatalog(companyId)): { key: string; label: string; count: number; invoiceCount: number; totalCost: number; monthsSpan: number }[] {
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]))
  const grouped = new Map<string, { label: string; dates: Date[]; invoiceIds: Set<string>; totalCost: number }>()
  const nonMechanical = new Set<RepairLineType>(["SHOP_SUPPLY", "FEE", "TAX", "CREDIT", "TOWING"])
  for (const { invoice, lines } of getVehicleRepairInvoices(companyId, vehicleId).filter(({ invoice }) => isConfirmedExpenditure(invoice))) {
    const date = new Date(`${invoice.serviceCompletionDate}T00:00:00`)
    if (Number.isNaN(date.getTime())) continue
    for (const line of lines) {
      if (nonMechanical.has(line.lineType)) continue
      const entry = line.matchedPartId ? catalogById.get(line.matchedPartId) : undefined
      const key = line.matchedPartId || [line.system, line.assembly, line.component].filter(Boolean).join("|").toLowerCase()
      if (!key) continue
      const current = grouped.get(key) || { label: line.component || entry?.canonicalName || line.rawDescription, dates: [], invoiceIds: new Set<string>(), totalCost: 0 }
      current.dates.push(date)
      current.invoiceIds.add(invoice.id)
      current.totalCost += line.lineTotal * (invoice.exchangeRate || 1)
      grouped.set(key, current)
    }
  }
  return Array.from(grouped.entries())
    .filter(([, value]) => value.invoiceIds.size >= 2)
    .map(([key, value]) => {
      const sorted = value.dates.sort((a, b) => a.getTime() - b.getTime())
      const monthsSpan = Math.max(1, Math.ceil((sorted[sorted.length - 1].getTime() - sorted[0].getTime()) / (1000 * 60 * 60 * 24 * 30.44)))
      return { key, label: value.label, count: value.dates.length, invoiceCount: value.invoiceIds.size, totalCost: money(value.totalCost), monthsSpan }
    })
    .sort((a, b) => b.invoiceCount - a.invoiceCount || b.totalCost - a.totalCost)
}

export function getRepairLineTypeTotals(lines: RepairInvoiceLine[]): Record<RepairLineType, number> {
  const totals: Record<RepairLineType, number> = { PART: 0, LABOR: 0, SUBLET: 0, SHOP_SUPPLY: 0, TOWING: 0, FEE: 0, TAX: 0, CREDIT: 0, OTHER: 0 }
  for (const line of lines) totals[line.lineType] = money(totals[line.lineType] + Math.abs(line.lineTotal))
  return totals
}

export function getCompanyPreviouslyUsedVendorIds(companyId: string): Set<string> {
  const store = readStore(companyId)
  return new Set(store.invoices.filter((invoice) => !invoice.archived && invoice.vendorId).map((invoice) => invoice.vendorId as string))
}

export function getRepairLinksForSource(companyId: string, sourceId: string): { link: RepairSourceLink; invoice?: RepairInvoice; line?: RepairInvoiceLine }[] {
  const store = readStore(companyId)
  return store.sourceLinks.filter((link) => link.sourceId === sourceId).map((link) => ({
    link,
    invoice: store.invoices.find((invoice) => invoice.id === link.invoiceId),
    line: link.lineId ? store.lines.find((line) => line.id === link.lineId) : undefined,
  }))
}

export function verifyRepairInvoice(companyId: string, invoiceId: string, input: { actorId?: string; actorRole?: string; reason?: string }): RepairInvoice {
  const store = readStore(companyId)
  const current = store.invoices.find((invoice) => invoice.id === invoiceId)
  if (!current) throw new Error("Repair invoice was not found.")
  if (current.archived) throw new Error("Archived repair invoices cannot be verified.")
  if (!current.evidenceIds.length) throw new Error("Source evidence is required before verification.")
  if (!current.reconciles) throw new Error("The invoice rows must reconcile to the document total before verification.")
  if (current.duplicateDecision !== "NOT_DUPLICATE" && current.duplicateDecision !== "AUTHORIZED_REPROCESSING") throw new Error("Complete duplicate review before verification.")
  const updated: RepairInvoice = { ...current, status: "verified", updatedAt: isoNow() }
  writeStore(companyId, { ...store, invoices: store.invoices.map((invoice) => invoice.id === invoiceId ? updated : invoice) })
  recordAuditEvent({ action: "UPDATE", entityType: "Vehicle", entityId: invoiceId, companyId, actor: input.actorId || "", role: input.actorRole || "", details: `Verified repair invoice ${current.invoiceNumber}.${input.reason ? ` Reason: ${input.reason}` : ""}` })
  return updated
}

export function archiveRepairInvoice(companyId: string, invoiceId: string, input: { actorId?: string; actorRole?: string; reason: string }): RepairInvoice {
  if (!input.reason.trim()) throw new Error("An archive reason is required.")
  const store = readStore(companyId)
  const current = store.invoices.find((invoice) => invoice.id === invoiceId)
  if (!current) throw new Error("Repair invoice was not found.")
  const updated: RepairInvoice = { ...current, archived: true, updatedAt: isoNow() }
  writeStore(companyId, { ...store, invoices: store.invoices.map((invoice) => invoice.id === invoiceId ? updated : invoice) })
  recordAuditEvent({ action: "ARCHIVE", entityType: "Vehicle", entityId: invoiceId, companyId, actor: input.actorId || "", role: input.actorRole || "", details: `Archived repair invoice ${current.invoiceNumber}. Reason: ${input.reason.trim()}` })
  return updated
}

export function attachEvidenceToRepairInvoice(companyId: string, invoiceId: string, evidenceId: string, input: { actorId?: string; actorRole?: string } = {}): RepairInvoice {
  const store = readStore(companyId)
  const current = store.invoices.find((invoice) => invoice.id === invoiceId)
  if (!current) throw new Error("Repair invoice was not found.")
  const updated: RepairInvoice = { ...current, evidenceIds: Array.from(new Set([...current.evidenceIds, evidenceId])), updatedAt: isoNow() }
  writeStore(companyId, { ...store, invoices: store.invoices.map((invoice) => invoice.id === invoiceId ? updated : invoice) })
  recordAuditEvent({ action: "UPDATE", entityType: "Vehicle", entityId: invoiceId, companyId, actor: input.actorId || "", role: input.actorRole || "", details: `Attached evidence ${evidenceId} to repair invoice ${current.invoiceNumber}.` })
  return updated
}
