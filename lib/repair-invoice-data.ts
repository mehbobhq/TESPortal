/**
 * Repair invoice + repair invoice line tracking.
 *
 * Storage note: this app has no SQL database (see part-catalog-data.ts for
 * the full explanation) — every store here is localStorage-backed, scoped
 * per company, mirroring lib/vehicle-data.ts. OCR and manual entry write
 * through the SAME insert path (buildRepairInvoiceLines) so both produce
 * identical RepairInvoiceLine rows, per the "one schema, one table" rule.
 */

import { createId, isoNow } from "./vehicle-data";
import {
  loadPartCatalog,
  matchPartToCatalog,
  PART_MATCH_REVIEW_CONFIDENCE,
  type PartCatalogEntry,
} from "./part-catalog-data";

export type RepairLineEntryMethod = "ocr" | "manual" | "manual_correction";
export type RepairInvoiceStatus = "auto_approved" | "needs_review";

export interface RepairInvoiceLine {
  id: string;
  repairInvoiceId: string;
  description: string;
  partNumber?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  matchedPartId?: string;
  matchConfidence?: number;
  entryMethod: RepairLineEntryMethod;
  /**
   * Optional link to a first-class MaintenanceItem (lib/vehicle-data.ts).
   * NEVER assume 1:1 — lines like "Shop supplies", "Labour", "Environmental
   * fee", or "Tax" are financial evidence with no corresponding maintenance
   * work item, and one labour line can relate to multiple items. Only set
   * this when the relationship is semantically valid; never fabricate an
   * allocation just so every line has one.
   */
  maintenanceItemId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepairInvoice {
  id: string;
  vehicleId: string;
  vendorId?: string;
  vendorName?: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalDue: number;
  subtotal: number;
  reconciles: boolean;
  status: RepairInvoiceStatus;
  entrySource: RepairLineEntryMethod;
  /** One Maintenance Event (VehicleMaintenanceRecord) can have zero, one, or multiple invoices; existing invoices remain valid without this. */
  maintenanceEventId?: string;
  evidenceIds: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepairInvoiceStore {
  version: number;
  invoices: RepairInvoice[];
  lines: RepairInvoiceLine[];
}

export const repairInvoiceStorageKey = (companyId: string) => `tes_repair_invoices_${companyId}`;

const EMPTY_STORE = (): RepairInvoiceStore => ({ version: 1, invoices: [], lines: [] });

export function loadRepairInvoiceStore(companyId: string): RepairInvoiceStore {
  if (typeof window === "undefined" || !companyId) return EMPTY_STORE();
  try {
    const raw = localStorage.getItem(repairInvoiceStorageKey(companyId));
    if (!raw) return EMPTY_STORE();
    const parsed = JSON.parse(raw) as Partial<RepairInvoiceStore>;
    return {
      version: parsed.version ?? 1,
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
    };
  } catch {
    return EMPTY_STORE();
  }
}

export function saveRepairInvoiceStore(companyId: string, store: RepairInvoiceStore): void {
  localStorage.setItem(repairInvoiceStorageKey(companyId), JSON.stringify(store));
}

/** The tolerance (absolute $) within which subtotal vs. header total_due is considered reconciled. */
export const RECONCILIATION_TOLERANCE = 1;

export interface RepairLineInput {
  description: string;
  partNumber?: string;
  quantity: number;
  unitPrice: number;
  lineTotal?: number;
  /** See RepairInvoiceLine.maintenanceItemId — optional, only when the relationship is semantically valid. */
  maintenanceItemId?: string;
}

/**
 * Builds RepairInvoiceLine rows for a new invoice, running matchPartToCatalog
 * on every line. Shared by both the manual-entry save path and the OCR
 * ingestion path so both produce the identical schema.
 */
export function buildRepairInvoiceLines(
  repairInvoiceId: string,
  rawLines: RepairLineInput[],
  entryMethod: RepairLineEntryMethod,
  catalog: PartCatalogEntry[] = loadPartCatalog()
): RepairInvoiceLine[] {
  const now = isoNow();
  return rawLines.map((line) => {
    const lineTotal = line.lineTotal ?? Math.round(line.quantity * line.unitPrice * 100) / 100;
    const match = matchPartToCatalog(line.description, catalog);
    return {
      id: createId("RIL"),
      repairInvoiceId,
      description: line.description,
      partNumber: line.partNumber || undefined,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal,
      matchedPartId: match?.matchedPartId,
      matchConfidence: match?.confidence,
      entryMethod,
      maintenanceItemId: line.maintenanceItemId,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export interface CreateRepairInvoiceInput {
  vehicleId: string;
  vendorId?: string;
  vendorName?: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalDue: number;
  lines: RepairLineInput[];
  evidenceIds?: string[];
  /** One Maintenance Event can have zero, one, or multiple invoices. */
  maintenanceEventId?: string;
}

export interface CreateRepairInvoiceResult {
  invoice: RepairInvoice;
  lines: RepairInvoiceLine[];
  reconciliationWarning: string | null;
}

/**
 * Inserts a repair invoice + its lines, for either entry path. `entryMethod`
 * controls what gets written to each line's entry_method — 'manual' for the
 * Add Repair Bill form (FIX 3), 'ocr' for a future itemized-OCR pipeline.
 */
function createRepairInvoice(
  companyId: string,
  input: CreateRepairInvoiceInput,
  entryMethod: RepairLineEntryMethod
): CreateRepairInvoiceResult {
  if (input.lines.length === 0) {
    throw new Error("At least one line item is required to save a repair bill.");
  }

  const store = loadRepairInvoiceStore(companyId);
  const invoiceId = createId("RINV");
  const catalog = loadPartCatalog();
  const lines = buildRepairInvoiceLines(invoiceId, input.lines, entryMethod, catalog);
  const subtotal = Math.round(lines.reduce((sum, line) => sum + line.lineTotal, 0) * 100) / 100;

  const reconciles = Math.abs(subtotal - input.totalDue) <= RECONCILIATION_TOLERANCE;
  const anyLineNeedsReview = lines.some(
    (line) => line.matchedPartId === undefined || (line.matchConfidence ?? 0) < PART_MATCH_REVIEW_CONFIDENCE
  );
  const status: RepairInvoiceStatus = reconciles && !anyLineNeedsReview ? "auto_approved" : "needs_review";

  const now = isoNow();
  const invoice: RepairInvoice = {
    id: invoiceId,
    vehicleId: input.vehicleId,
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    totalDue: input.totalDue,
    subtotal,
    reconciles,
    status,
    entrySource: entryMethod,
    maintenanceEventId: input.maintenanceEventId,
    evidenceIds: input.evidenceIds || [],
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  const next: RepairInvoiceStore = {
    ...store,
    invoices: [invoice, ...store.invoices],
    lines: [...lines, ...store.lines],
  };
  saveRepairInvoiceStore(companyId, next);

  return {
    invoice,
    lines,
    reconciliationWarning: reconciles
      ? null
      : `Subtotal (${subtotal.toFixed(2)}) does not match invoice total (${input.totalDue.toFixed(2)}).`,
  };
}

export function createManualRepairInvoice(
  companyId: string,
  input: CreateRepairInvoiceInput
): CreateRepairInvoiceResult {
  return createRepairInvoice(companyId, input, "manual");
}

/**
 * Reserved entry point for a future itemized-OCR pipeline. The current
 * OCRReview component only extracts flat header fields, not repeatable line
 * arrays, so nothing calls this yet — but it exists so OCR ingestion, once
 * built, writes through the identical schema/matching path as manual entry.
 */
export function createRepairInvoiceFromOCR(
  companyId: string,
  input: CreateRepairInvoiceInput
): CreateRepairInvoiceResult {
  return createRepairInvoice(companyId, input, "ocr");
}

export function getVehicleRepairInvoices(companyId: string, vehicleId: string) {
  const store = loadRepairInvoiceStore(companyId);
  return store.invoices
    .filter((invoice) => invoice.vehicleId === vehicleId && !invoice.archived)
    .map((invoice) => ({
      invoice,
      lines: store.lines.filter((line) => line.repairInvoiceId === invoice.id),
    }))
    .sort((a, b) => b.invoice.invoiceDate.localeCompare(a.invoice.invoiceDate));
}

export interface SpendSummary {
  spendYTD: number;
  spendSinceFleetEntry: number;
}

/** FIX 4, widget 1 — total spend this year and since the vehicle's fleet start date. */
export function getVehicleSpendSummary(
  companyId: string,
  vehicleId: string,
  fleetEntryDate?: string
): SpendSummary {
  const invoices = getVehicleRepairInvoices(companyId, vehicleId);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  let spendYTD = 0;
  let spendSinceFleetEntry = 0;
  for (const { invoice } of invoices) {
    if (invoice.invoiceDate >= yearStart) spendYTD += invoice.totalDue;
    if (!fleetEntryDate || invoice.invoiceDate >= fleetEntryDate) spendSinceFleetEntry += invoice.totalDue;
  }
  return {
    spendYTD: Math.round(spendYTD * 100) / 100,
    spendSinceFleetEntry: Math.round(spendSinceFleetEntry * 100) / 100,
  };
}

export interface CategorySpend {
  category: string;
  total: number;
  lineCount: number;
}

/** FIX 4, widget 2 — spend grouped by part_catalog.category, matched lines only. */
export function getVehicleSpendByCategory(
  companyId: string,
  vehicleId: string,
  catalog: PartCatalogEntry[] = loadPartCatalog()
): CategorySpend[] {
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const totals = new Map<string, CategorySpend>();

  for (const { lines } of getVehicleRepairInvoices(companyId, vehicleId)) {
    for (const line of lines) {
      if (!line.matchedPartId) continue;
      const part = catalogById.get(line.matchedPartId);
      if (!part) continue;
      const existing = totals.get(part.category) || { category: part.category, total: 0, lineCount: 0 };
      existing.total = Math.round((existing.total + line.lineTotal) * 100) / 100;
      existing.lineCount += 1;
      totals.set(part.category, existing);
    }
  }

  return Array.from(totals.values()).sort((a, b) => b.total - a.total);
}

export interface RecurringIssue {
  key: string;
  label: string;
  count: number;
  monthsSpan: number;
}

/** FIX 4, widget 3 — same matched part repaired 3+ times within a rolling 12-month window. */
export function getVehicleRecurringIssues(
  companyId: string,
  vehicleId: string,
  catalog: PartCatalogEntry[] = loadPartCatalog(),
  opts?: { windowMonths?: number; minCount?: number }
): RecurringIssue[] {
  const windowMonths = opts?.windowMonths ?? 12;
  const minCount = opts?.minCount ?? 3;
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - windowMonths, now.getDate());

  const groups = new Map<string, { label: string; dates: Date[] }>();
  for (const { invoice, lines } of getVehicleRepairInvoices(companyId, vehicleId)) {
    const invoiceDate = new Date(`${invoice.invoiceDate}T00:00:00`);
    if (Number.isNaN(invoiceDate.getTime()) || invoiceDate < windowStart) continue;
    for (const line of lines) {
      if (!line.matchedPartId) continue;
      const part = catalogById.get(line.matchedPartId);
      if (!part) continue;
      const key = line.matchedPartId;
      const group = groups.get(key) || { label: part.canonicalName, dates: [] };
      group.dates.push(invoiceDate);
      groups.set(key, group);
    }
  }

  const issues: RecurringIssue[] = [];
  for (const [key, group] of groups) {
    if (group.dates.length < minCount) continue;
    const sorted = [...group.dates].sort((a, b) => a.getTime() - b.getTime());
    const spanMonths = Math.max(
      1,
      Math.round(
        (sorted[sorted.length - 1].getTime() - sorted[0].getTime()) / (1000 * 60 * 60 * 24 * 30)
      )
    );
    issues.push({ key, label: group.label, count: group.dates.length, monthsSpan: spanMonths });
  }

  return issues.sort((a, b) => b.count - a.count);
}

export interface PartPriceTrendPoint {
  quarter: string;
  vendorId?: string;
  avgUnitPrice: number;
  count: number;
}

/**
 * FIX 5 — unit_price over time for a matched part, grouped by quarter and
 * optionally by vendor. Company-scoped (this store has no companyId-less
 * global table), spans every vehicle in the company so vendor overcharging
 * can be detected across the fleet, not just one unit.
 */
export function getPartPriceTrend(
  companyId: string,
  partId: string,
  opts?: { vendorId?: string }
): PartPriceTrendPoint[] {
  const store = loadRepairInvoiceStore(companyId);
  const invoicesById = new Map(store.invoices.map((invoice) => [invoice.id, invoice]));
  const buckets = new Map<string, { total: number; count: number; vendorId?: string }>();

  for (const line of store.lines) {
    if (line.matchedPartId !== partId) continue;
    const invoice = invoicesById.get(line.repairInvoiceId);
    if (!invoice || invoice.archived) continue;
    if (opts?.vendorId && invoice.vendorId !== opts.vendorId) continue;

    const date = new Date(`${invoice.invoiceDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) continue;
    const quarter = `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
    const bucketKey = opts?.vendorId ? `${quarter}:${invoice.vendorId ?? ""}` : quarter;

    const bucket = buckets.get(bucketKey) || { total: 0, count: 0, vendorId: invoice.vendorId };
    bucket.total += line.unitPrice;
    bucket.count += 1;
    buckets.set(bucketKey, bucket);
  }

  const points: PartPriceTrendPoint[] = [];
  for (const [key, bucket] of buckets) {
    const quarter = key.split(":")[0];
    points.push({
      quarter,
      vendorId: opts?.vendorId ? bucket.vendorId : undefined,
      avgUnitPrice: Math.round((bucket.total / bucket.count) * 100) / 100,
      count: bucket.count,
    });
  }

  return points.sort((a, b) => a.quarter.localeCompare(b.quarter));
}
