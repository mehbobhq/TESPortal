/**
 * Repair bills in the restored Vehicles workspace.
 *
 * The original module kept repair invoices in this browser's storage. There is no canonical (PostgreSQL) repair-invoice store, so:
 *   - the pure calculation helpers are kept as they were (they decide nothing about persistence);
 *   - every read answers "nothing recorded" (no repair bill exists in the canonical records);
 *   - every write refuses with CanonicalOperationUnavailableError, which the original forms already surface as their error message.
 * Types are the original types (erased at build time).
 */
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import type { RepairComponentCatalogEntry } from "./repair-component-catalog"
import type {
  RepairInvoice,
  RepairInvoiceLine,
  RepairLineType,
  createManualRepairInvoice as OriginalCreateManualRepairInvoice,
  createRepairInvoice as OriginalCreateRepairInvoice,
} from "@/lib/repair-invoice-data"

export type {
  EquipmentPosition,
  OdometerSource,
  RepairCurrency,
  RepairDocumentKind,
  RepairInvoice,
  RepairInvoiceLine,
  RepairLineInput,
  RepairLineType,
  VarianceState,
} from "@/lib/repair-invoice-data"

const NO_REPAIR_STORE =
  "repair bills have no canonical (PostgreSQL) record yet, and the browser-local repair store is not used by the TES records view"

export const RECONCILIATION_TOLERANCE = 0.02

const money = (value: number): number => Math.round(value * 100) / 100

export function signedLineAmount(line: { lineType: RepairLineType; lineTotal: number }): number {
  const magnitude = Math.abs(line.lineTotal)
  return line.lineType === "CREDIT" ? -magnitude : line.lineTotal
}

export function calculateRowsTotal(lines: { lineType: RepairLineType; lineTotal: number }[]): number {
  return Math.round(lines.reduce((sum, line) => sum + signedLineAmount(line), 0) * 100) / 100
}

export function getVarianceState(
  documentInvoiceTotal: number | null | undefined,
  calculatedRows: number,
): { state: "NOT_YET_COMPARABLE" | "RECONCILED" | "VARIANCE_DETECTED"; variance: number | null } {
  if (documentInvoiceTotal === null || documentInvoiceTotal === undefined || Number.isNaN(documentInvoiceTotal) || documentInvoiceTotal === 0) {
    return { state: "NOT_YET_COMPARABLE", variance: null }
  }
  const variance = money(documentInvoiceTotal - calculatedRows)
  return { state: Math.abs(variance) <= RECONCILIATION_TOLERANCE ? "RECONCILED" : "VARIANCE_DETECTED", variance }
}

export function getRepairLineTypeTotals(lines: RepairInvoiceLine[]): Record<RepairLineType, number> {
  const totals: Record<RepairLineType, number> = { PART: 0, LABOR: 0, SUBLET: 0, SHOP_SUPPLY: 0, TOWING: 0, FEE: 0, TAX: 0, CREDIT: 0, OTHER: 0 }
  for (const line of lines) totals[line.lineType] = money(totals[line.lineType] + Math.abs(line.lineTotal))
  return totals
}

// ---- reads: nothing is recorded canonically ---------------------------------------------------------------------------

export function getCompanyPreviouslyUsedVendorIds(_companyId: string): Set<string> {
  return new Set<string>()
}

export function getVehicleRepairInvoices(_companyId: string, _vehicleId: string): { invoice: RepairInvoice; lines: RepairInvoiceLine[] }[] {
  return []
}

export function getVehicleSpendSummary(
  _companyId: string,
  _vehicleId: string,
  _fleetEntryDate?: string,
): { spendYTD: number; spendSinceFleetEntry: number; invoiceCount: number; lineCount: number } {
  return { spendYTD: 0, spendSinceFleetEntry: 0, invoiceCount: 0, lineCount: 0 }
}

export function getVehicleSpendByCategory(
  _companyId: string,
  _vehicleId: string,
  _catalog?: RepairComponentCatalogEntry[],
): { category: string; total: number; lineCount: number }[] {
  return []
}

export function getVehicleRecurringIssues(
  _companyId: string,
  _vehicleId: string,
  _catalog?: RepairComponentCatalogEntry[],
): { key: string; label: string; count: number; invoiceCount: number; totalCost: number; monthsSpan: number }[] {
  return []
}

// ---- writes: refused ---------------------------------------------------------------------------------------------------

export const createRepairInvoice: typeof OriginalCreateRepairInvoice = () => {
  throw new CanonicalOperationUnavailableError("Saving a repair bill", NO_REPAIR_STORE)
}

export const createManualRepairInvoice: typeof OriginalCreateManualRepairInvoice = () => {
  throw new CanonicalOperationUnavailableError("Saving a repair bill", NO_REPAIR_STORE)
}

export function verifyRepairInvoice(_companyId: string, _invoiceId: string, _input: { actorId?: string; actorRole?: string; reason?: string }): RepairInvoice {
  throw new CanonicalOperationUnavailableError("Verifying a repair bill", NO_REPAIR_STORE)
}

export function archiveRepairInvoice(_companyId: string, _invoiceId: string, _input: { actorId?: string; actorRole?: string; reason: string }): RepairInvoice {
  throw new CanonicalOperationUnavailableError("Archiving a repair bill", NO_REPAIR_STORE)
}

export function attachEvidenceToRepairInvoice(_companyId: string, _invoiceId: string, _evidenceId: string): RepairInvoice {
  throw new CanonicalOperationUnavailableError("Attaching evidence to a repair bill", NO_REPAIR_STORE)
}
