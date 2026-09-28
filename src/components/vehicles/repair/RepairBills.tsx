"use client"

import { useMemo, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { ChevronDown, ChevronRight, Plus, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { EntityPicker } from "@/src/components/shared/EntityPicker"
import { validateCompany } from "@/lib/company-validation"
import { normalizeSuffix } from "@/lib/company-validation"
import { createId, type VehicleStore } from "@/lib/vehicle-data"
import {
  calculateRowsTotal,
  createRepairInvoice,
  createManualRepairInvoice,
  getCompanyPreviouslyUsedVendorIds,
  getRepairLineTypeTotals,
  getVarianceState,
  type EquipmentPosition,
  type OdometerSource,
  type RepairCurrency,
  type RepairDocumentKind,
  type RepairInvoice,
  type RepairInvoiceLine,
  type RepairLineInput,
  type RepairLineType,
  type VarianceState,
} from "@/lib/repair-invoice-data"
import {
  ISODateInput,
  isValidISODate,
} from "@/src/components/shared/ISODateInput"
import { REPAIR_ACTIONS, REPAIR_ORIGINS, REPAIR_SYSTEMS, type RepairComponentCatalogEntry, type RepairOrigin } from "@/lib/repair-component-catalog"
import {
  createServiceProviderProfile,
  getServiceProviderByOrganizationId,
  listServiceProviders,
  PROVIDER_TYPE_OPTIONS,
  type ServiceProviderProfile,
  type ServiceProviderType,
} from "@/lib/service-provider-data"
import type { Company, VehicleRecord } from "@/src/types"

const MIN_PROVIDER_SEARCH_CHARS = 3
/** No existing result-limiting constant was found elsewhere in the codebase for a search component like this (checked before introducing this — see task report); 8 approximates EntityPicker's own max-h-56 visible-row scroll area. */
const MAX_PROVIDER_SEARCH_RESULTS = 8

type RepairEmptyStateComponent = ComponentType<{ title: string; description: string; action?: ReactNode }>
type RepairSectionTitleComponent = ComponentType<{ title: string; description?: string; action?: ReactNode }>
type RepairStatusPillComponent = ComponentType<{ value: string }>
type RepairFieldComponent = ComponentType<{ label: string; required?: boolean; className?: string; children: ReactNode }>
type RepairDividerComponent = ComponentType

export interface RoadsideRepairLinkOption {
  eventId: string
  label: string
  equipmentLabel: string
  findings: { id: string; label: string; outOfService: boolean }[]
}

const LINE_TYPES: { value: RepairLineType; label: string }[] = [
  { value: "PART", label: "Part / material" },
  { value: "LABOR", label: "Labor / service" },
  { value: "SUBLET", label: "Sublet work" },
  { value: "SHOP_SUPPLY", label: "Shop supply" },
  { value: "TOWING", label: "Towing / recovery" },
  { value: "FEE", label: "Fee" },
  { value: "TAX", label: "Tax" },
  { value: "CREDIT", label: "Credit / discount" },
  { value: "OTHER", label: "Other" },
]

const POSITIONS: { value: EquipmentPosition; label: string }[] = [
  { value: "NOT_STATED", label: "Not stated" },
  { value: "FRONT_LEFT", label: "Front left" },
  { value: "FRONT_RIGHT", label: "Front right" },
  { value: "REAR_LEFT", label: "Rear left" },
  { value: "REAR_RIGHT", label: "Rear right" },
  { value: "AXLE_1", label: "Axle 1" },
  { value: "AXLE_2", label: "Axle 2" },
  { value: "AXLE_3", label: "Axle 3" },
  { value: "TRACTOR", label: "Tractor / power unit" },
  { value: "TRAILER", label: "Trailer" },
]

function money(value: number, currency: RepairCurrency = "CAD"): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value || 0)
}

function formatDate(value?: string): string {
  if (!value) return "Date not recorded"
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })
}

function normalizeDateForForm(value?: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback
  const raw = value.trim()
  if (!raw) return fallback
  if (isValidISODate(raw)) return raw

  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw)
  if (slashDate) {
    const normalized = `${slashDate[3]}-${slashDate[1].padStart(2, "0")}-${slashDate[2].padStart(2, "0")}`
    return isValidISODate(normalized) ? normalized : fallback
  }

  const compact = raw.replace(/\D/g, "")
  if (compact.length === 8) {
    const normalized = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
    return isValidISODate(normalized) ? normalized : fallback
  }

  return fallback
}

function RepairFormSection({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className={className}>{children}</div>
    </section>
  )
}

function lineSummary(lines: RepairInvoiceLine[]): string {
  const meaningful = lines.filter((line) => !["TAX", "CREDIT"].includes(line.lineType))
  const labels = meaningful.slice(0, 2).map((line) => line.component || line.rawDescription)
  if (!labels.length) return "No itemized work captured"
  return `${labels.join("; ")}${meaningful.length > 2 ? ` +${meaningful.length - 2} more` : ""}`
}

export function RepairBillsView({
  repairInvoices,
  spendSummary,
  spendByCategory,
  recurringIssues,
  onAddRepairBill,
  onVerifyRepairBill,
  onSelectRepairBill,
  EmptyStateComponent,
  SectionTitleComponent,
  StatusPillComponent,
}: {
  companyId: string
  vehicle: VehicleRecord
  repairInvoices: { invoice: RepairInvoice; lines: RepairInvoiceLine[] }[]
  partCatalog: RepairComponentCatalogEntry[]
  spendSummary: { spendYTD: number; spendSinceFleetEntry: number; invoiceCount?: number; lineCount?: number }
  spendByCategory: { category: string; total: number; lineCount: number }[]
  recurringIssues: { key: string; label: string; count: number; invoiceCount?: number; totalCost?: number; monthsSpan: number }[]
  onAddRepairBill: () => void
  onVerifyRepairBill?: (invoiceId: string) => void
  onSelectRepairBill?: (invoice: RepairInvoice, lines: RepairInvoiceLine[]) => void
  EmptyStateComponent: RepairEmptyStateComponent
  SectionTitleComponent: RepairSectionTitleComponent
  StatusPillComponent: RepairStatusPillComponent
}) {
  const [query, setQuery] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(() => repairInvoices.filter(({ invoice, lines }) => {
    if (!normalizedQuery) return true
    return [invoice.invoiceNumber, invoice.vendorName, invoice.repairOrigin, ...lines.flatMap((line) => [line.rawDescription, line.partNumber, line.system, line.component])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery))
  }), [repairInvoices, normalizedQuery])
  const leadingCategory = spendByCategory[0]
  const reportingCurrency = repairInvoices[0]?.invoice.reportingCurrency || "CAD"

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Year-to-date spend</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{money(spendSummary.spendYTD, reportingCurrency)}</p>
          <p className="text-[10px] text-muted-foreground">Final invoices and confirmed receipts</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Since fleet entry</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{money(spendSummary.spendSinceFleetEntry, reportingCurrency)}</p>
          <p className="text-[10px] text-muted-foreground">{spendSummary.invoiceCount ?? repairInvoices.length} invoices</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Largest cost area</p>
          <p className="mt-1 truncate text-sm font-bold">{leadingCategory?.category || "No classified costs"}</p>
          <p className="text-[10px] text-muted-foreground">{leadingCategory ? `${money(leadingCategory.total, reportingCurrency)} · ${leadingCategory.lineCount} rows` : "Waiting for invoice rows"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recurring components</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{recurringIssues.length}</p>
          <p className="text-[10px] text-muted-foreground">Components appearing on 2+ invoices</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <SectionTitleComponent
          title="Repair Bills"
          description="Each invoice row is retained, normalized and available for vehicle and fleet BI."
          action={<Button size="sm" onClick={onAddRepairBill}><Plus className="mr-1.5 size-3.5" />Add Repair Bill</Button>}
        />

        {repairInvoices.length === 0 ? (
          <EmptyStateComponent title="No repair bills recorded" description="Use Add Repair Bill for manual entry, or Upload Document / OCR from the page header." />
        ) : (
          <>
            <div className="border-b border-border p-3">
              <div className="relative max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-9 pl-9 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice, vendor, component, part number or repair…" />
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">No repair bills match this search.</div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map(({ invoice, lines }) => {
                  const expanded = expandedId === invoice.id
                  const totals = getRepairLineTypeTotals(lines)
                  const evidenceLabel = invoice.evidenceIds.length ? `${invoice.evidenceIds.length} evidence file${invoice.evidenceIds.length === 1 ? "" : "s"}` : "Evidence missing"
                  return (
                    <div key={invoice.id}>
                      <button type="button" className="grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20 md:grid-cols-[120px_180px_minmax(240px,1fr)_130px_110px_28px]" onClick={() => { setExpandedId(expanded ? null : invoice.id); onSelectRepairBill?.(invoice, lines) }}>
                        <div><p className="text-xs font-semibold">{formatDate(invoice.serviceCompletionDate)}</p><p className="mt-0.5 text-[10px] text-muted-foreground">Service completed</p></div>
                        <div><p className="truncate text-xs font-semibold">{invoice.invoiceNumber || "Repair bill"}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{invoice.vendorName || "Provider not recorded"}</p></div>
                        <div><p className="line-clamp-2 text-xs font-medium">{lineSummary(lines)}</p><div className="mt-1 flex flex-wrap gap-1">{Array.from(new Set(lines.map((line) => line.system).filter(Boolean))).slice(0, 3).map((system) => <span key={system} className="rounded-full bg-primary/5 px-2 py-0.5 text-[9px] font-medium text-primary">{system}</span>)}</div></div>
                        <div><p className="text-xs font-semibold tabular-nums">{invoice.odometer ? `${invoice.odometer.toLocaleString()} ${invoice.odometerUnit?.toLowerCase() || ""}` : "Not stated"}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{invoice.odometerSource.replaceAll("_", " ").toLowerCase()}</p></div>
                        <div className="text-right"><p className="text-xs font-bold tabular-nums">{money(invoice.totalDue, invoice.currency)}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{evidenceLabel}</p></div>
                        <div className="flex items-start justify-end pt-0.5">{expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</div>
                      </button>

                      {expanded ? (
                        <div className="border-t bg-muted/10 px-4 py-3">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <StatusPillComponent value={invoice.status === "auto_approved" || invoice.status === "verified" ? "Verified" : invoice.status === "duplicate_review" ? "Possible duplicate" : invoice.status === "mismatch_review" ? "Identity mismatch" : "Pending review"} />
                            <span className="rounded-full border px-2 py-0.5 text-[10px] capitalize">{invoice.entrySource}</span>
                            {invoice.repairOrigin ? <span className="text-[10px] text-muted-foreground">Origin: {invoice.repairOrigin}</span> : null}
                            {invoice.maintenanceEventId ? <span className="text-[10px] text-primary">Linked maintenance: {invoice.maintenanceEventId}</span> : null}
                            {invoice.roadsideEventId ? <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">Linked roadside: {invoice.roadsideEventId}</span> : null}
                            {invoice.status === "duplicate_review" ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">{invoice.duplicateDecision.replaceAll("_", " ").toLowerCase()}</span> : null}
                            {invoice.status === "pending_review" && onVerifyRepairBill ? <Button className="ml-auto" size="sm" variant="outline" onClick={() => onVerifyRepairBill(invoice.id)} disabled={!invoice.evidenceIds.length || !invoice.reconciles}>Verify Invoice</Button> : null}
                          </div>
                          <div className="overflow-x-auto rounded-lg border bg-card">
                            <table className="w-full min-w-[820px] text-left text-xs">
                              <thead className="border-b bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Original invoice row</th><th className="px-3 py-2">Normalized item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit price</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                              <tbody className="divide-y divide-border/60">{lines.map((line) => <tr key={line.id}><td className="px-3 py-2 text-[10px] font-semibold text-muted-foreground">{line.lineType.replaceAll("_", " ")}</td><td className="max-w-sm px-3 py-2"><p>{line.rawDescription}</p>{line.partNumber ? <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">Part {line.partNumber}</p> : null}</td><td className="px-3 py-2"><p className="font-medium">{line.component || "Needs classification"}</p><p className="text-[10px] text-muted-foreground">{[line.system, line.assembly, line.position && line.position !== "NOT_STATED" ? line.position.replaceAll("_", " ").toLowerCase() : ""].filter(Boolean).join(" · ") || "—"}</p></td><td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td><td className="px-3 py-2 text-right tabular-nums">{money(line.unitPrice, invoice.currency)}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{money(line.lineTotal, invoice.currency)}</td></tr>)}</tbody>
                            </table>
                          </div>
                          {(() => {
                            const calculatedRows = calculateRowsTotal(lines)
                            const { state: varianceState, variance } = getVarianceState(invoice.totalDue || null, calculatedRows)
                            return (
                              <>
                                <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-9">
                                  <MiniTotal label="Parts" value={totals.PART} currency={invoice.currency} />
                                  <MiniTotal label="Labor" value={totals.LABOR} currency={invoice.currency} />
                                  <MiniTotal label="Sublet" value={totals.SUBLET} currency={invoice.currency} />
                                  <MiniTotal label="Supplies / fees" value={totals.SHOP_SUPPLY + totals.FEE} currency={invoice.currency} />
                                  <MiniTotal label="Towing" value={totals.TOWING} currency={invoice.currency} />
                                  <MiniTotal label="Other" value={totals.OTHER} currency={invoice.currency} />
                                  <MiniTotal label="Tax" value={totals.TAX} currency={invoice.currency} />
                                  <MiniTotal label="Credits" value={totals.CREDIT} currency={invoice.currency} />
                                  <MiniTotal label="Invoice total" value={invoice.totalDue} currency={invoice.currency} strong />
                                </div>
                                <VarianceBanner className="mt-2" state={varianceState} calculatedRows={calculatedRows} documentTotal={invoice.totalDue} variance={variance} currency={invoice.currency} />
                              </>
                            )
                          })()}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </Card>

      {recurringIssues.length ? (
        <Card className="p-4"><p className="text-xs font-bold">Recurring component patterns</p><div className="mt-2 grid gap-2 md:grid-cols-2">{recurringIssues.slice(0, 6).map((issue) => <div key={issue.key} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">{issue.label}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{issue.invoiceCount ?? issue.count} invoice appearances · {issue.count} rows · {issue.monthsSpan} month span</p></div><p className="text-xs font-bold tabular-nums">{money(issue.totalCost || 0, reportingCurrency)}</p></div></div>)}</div></Card>
      ) : null}
    </div>
  )
}

function MiniTotal({ label, value, currency, strong = false }: { label: string; value: number; currency: RepairCurrency; strong?: boolean }) {
  return <div className={`rounded-lg border px-3 py-2 ${strong ? "bg-primary/5" : "bg-card"}`}><p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p><p className={`mt-0.5 text-xs tabular-nums ${strong ? "font-bold" : "font-semibold"}`}>{money(value, currency)}</p></div>
}

/**
 * Three-state variance display (locked spec, section 3A). NOT_YET_COMPARABLE
 * uses neutral styling — it must never look like a firm mismatch warning
 * merely because the Document Invoice Total hasn't been entered yet.
 * Warning styling is reserved for VARIANCE_DETECTED only.
 */
function VarianceBanner({ state, calculatedRows, documentTotal, variance, currency, className = "" }: { state: VarianceState; calculatedRows: number; documentTotal: number; variance: number | null; currency: RepairCurrency; className?: string }) {
  const toneClass =
    state === "VARIANCE_DETECTED" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
    : state === "RECONCILED" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : "bg-muted text-muted-foreground"
  const text =
    state === "NOT_YET_COMPARABLE" ? `Calculated rows: ${money(calculatedRows, currency)} · Document Invoice Total not yet entered.`
    : state === "RECONCILED" ? `Balanced · Calculated rows ${money(calculatedRows, currency)} matches Document Invoice Total.`
    : `Variance detected: Calculated rows ${money(calculatedRows, currency)} vs Document Invoice Total ${money(documentTotal, currency)} (${money(variance ?? 0, currency)}). Review required.`
  return <p className={`rounded-lg px-3 py-2 text-[11px] font-semibold ${toneClass} ${className}`} data-variance-state={state}>{text}</p>
}

function RepairBillLineRow({ line, onChange, onRemove, canRemove, inputClass, selectClass, availableFindings = [] }: { line: RepairLineInput; onChange: (next: RepairLineInput) => void; onRemove: () => void; canRemove: boolean; inputClass: string; selectClass: string; availableFindings?: { id: string; label: string; outOfService: boolean }[] }) {
  const [showClassification, setShowClassification] = useState(false)
  const computedTotal = Math.round((line.lineTotal ?? line.quantity * line.unitPrice) * 100) / 100
  return (
    <div className="rounded-lg border border-border bg-card">
      {/*
        Level 1 (always visible): Type, Original invoice description, Qty,
        Unit Price, Amount — the locked 13-15" minimum set. Part # is an
        addition shown once the container is wide enough (>=1400px, the
        16-24" tier's "description, part number, quantity, unit price, and
        amount together" requirement), not part of the narrow-width
        minimum.
      */}
      <div className="grid grid-cols-1 items-end gap-2 p-3 @min-[700px]/rbmain:grid-cols-2 @min-[1040px]/rbmain:grid-cols-12">
        <label className="@min-[1040px]/rbmain:col-span-2"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Type</span><select className={`${selectClass} mt-1`} value={line.lineType || "PART"} onChange={(event) => onChange({ ...line, lineType: event.target.value as RepairLineType })}>{LINE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="@min-[700px]/rbmain:col-span-2 @min-[1040px]/rbmain:col-span-4"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Original invoice description *</span><Input className={`${inputClass} mt-1`} value={line.description} onChange={(event) => onChange({ ...line, description: event.target.value })} /></label>
        <label className="@min-[1040px]/rbmain:col-span-2"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Part #</span><Input className={`${inputClass} mt-1`} value={line.partNumber || ""} onChange={(event) => onChange({ ...line, partNumber: event.target.value })} /></label>
        <label className="@min-[1040px]/rbmain:col-span-1"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Qty *</span><Input className={`${inputClass} mt-1`} type="number" min="0" step="any" value={line.quantity} onChange={(event) => onChange({ ...line, quantity: Number(event.target.value) || 0, lineTotal: undefined })} /></label>
        <label className="@min-[1040px]/rbmain:col-span-1"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Unit price *</span><Input className={`${inputClass} mt-1`} type="number" step="any" value={line.unitPrice} onChange={(event) => onChange({ ...line, unitPrice: Number(event.target.value) || 0, lineTotal: undefined })} /></label>
        <label className="@min-[1040px]/rbmain:col-span-1"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount</span><Input className={`${inputClass} mt-1`} type="number" step="any" value={computedTotal} onChange={(event) => onChange({ ...line, lineTotal: Number(event.target.value) || 0 })} /></label>
        <div className="flex justify-end gap-1 @min-[1040px]/rbmain:col-span-1"><Button type="button" variant="ghost" size="sm" onClick={() => setShowClassification((value) => !value)}>{showClassification ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button><Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={!canRemove}><X className="size-3.5" /></Button></div>
      </div>
      {showClassification ? (
        <div className="grid gap-2 border-t bg-muted/10 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <label><span className="text-[10px] font-semibold text-muted-foreground">System</span><select className={`${selectClass} mt-1`} value={line.system || ""} onChange={(event) => onChange({ ...line, system: event.target.value || undefined })}><option value="">Needs classification</option>{REPAIR_SYSTEMS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Assembly</span><Input className="mt-1" value={line.assembly || ""} onChange={(event) => onChange({ ...line, assembly: event.target.value })} placeholder="Example: Disc Brake" /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Component</span><Input className="mt-1" value={line.component || ""} onChange={(event) => onChange({ ...line, component: event.target.value })} placeholder="Example: Brake Pad" /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Action</span><select className={`${selectClass} mt-1`} value={line.action || ""} onChange={(event) => onChange({ ...line, action: event.target.value || undefined })}><option value="">Not selected</option>{REPAIR_ACTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Position</span><select className={`${selectClass} mt-1`} value={line.position || "NOT_STATED"} onChange={(event) => onChange({ ...line, position: event.target.value as EquipmentPosition })}>{POSITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Finding / failure detail</span><Input className="mt-1" value={line.finding || ""} onChange={(event) => onChange({ ...line, finding: event.target.value })} placeholder="Leaking, worn, damaged…" /></label>
          {availableFindings.length ? <div className="sm:col-span-2 lg:col-span-3"><p className="text-[10px] font-semibold text-muted-foreground">Exact roadside finding(s) resolved by this row</p><div className="mt-1 grid gap-1.5 md:grid-cols-2">{availableFindings.map((finding) => { const checked = (line.sourceFindingIds || []).includes(finding.id); return <label key={finding.id} className="flex items-start gap-2 rounded-md border bg-card p-2 text-[10px]"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(event) => onChange({ ...line, sourceFindingIds: event.target.checked ? Array.from(new Set([...(line.sourceFindingIds || []), finding.id])) : (line.sourceFindingIds || []).filter((id) => id !== finding.id) })} /><span>{finding.label}{finding.outOfService ? <strong className="ml-1 text-destructive">OOS</strong> : null}</span></label> })}</div></div> : null}
        </div>
      ) : null}
    </div>
  )
}

export function RepairBillForm({ companyId, vehicle, store, roadsideOptions = [], pendingEvidenceId = null, initialOCRValues = null, onAttachEvidence, clearPendingEvidence, onClose, onSaved, setError, readCompanies, FieldComponent, inputClass, selectClass, todayISO }: { companyId: string; vehicle: VehicleRecord; store?: VehicleStore; roadsideOptions?: RoadsideRepairLinkOption[]; pendingEvidenceId?: string | null; initialOCRValues?: Record<string, unknown> | null; onAttachEvidence?: () => void; clearPendingEvidence?: () => void; onClose: () => void; onSaved: () => void; setError: (value: string | null) => void; readCompanies: () => Company[]; FieldComponent: RepairFieldComponent; DividerComponent: RepairDividerComponent; inputClass: string; selectClass: string; todayISO: () => string }) {
  const ocrString = (key: string, fallback = "") => typeof initialOCRValues?.[key] === "string" ? String(initialOCRValues[key]) : fallback
  const ocrNumber = (key: string, fallback = 0) => Number.isFinite(Number(initialOCRValues?.[key])) ? Number(initialOCRValues?.[key]) : fallback
  const [invoiceNumber, setInvoiceNumber] = useState(ocrString("invoiceNumber"))
  const [invoiceDate, setInvoiceDate] = useState(normalizeDateForForm(initialOCRValues?.invoiceDate, todayISO()))
  const [serviceCompletionDate, setServiceCompletionDate] = useState(normalizeDateForForm(initialOCRValues?.serviceCompletionDate, normalizeDateForForm(initialOCRValues?.invoiceDate, todayISO())))
  const [documentTotal, setDocumentTotal] = useState(ocrString("documentTotal", initialOCRValues?.documentTotal != null ? String(initialOCRValues.documentTotal) : ""))
  const [documentKind, setDocumentKind] = useState<RepairDocumentKind>("FINAL_INVOICE")
  const [vendor, setVendor] = useState<Company | null>(null)
  const [repairOrigin, setRepairOrigin] = useState("")
  const [maintenanceEventId, setMaintenanceEventId] = useState("")
  const [roadsideEventId, setRoadsideEventId] = useState("")
  const [roadsideFindingIds, setRoadsideFindingIds] = useState<string[]>([])
  const [odometer, setOdometer] = useState(ocrString("odometer", initialOCRValues?.odometer != null ? String(initialOCRValues.odometer) : ""))
  const [odometerUnit, setOdometerUnit] = useState<"KM" | "MI">("KM")
  const [odometerSource, setOdometerSource] = useState<OdometerSource>("EVIDENCE")
  const [currency, setCurrency] = useState<RepairCurrency>(ocrString("currency").toUpperCase() === "USD" ? "USD" : "CAD")
  const [reportingCurrency, setReportingCurrency] = useState<RepairCurrency>("CAD")
  const [exchangeRate, setExchangeRate] = useState("1")
  const [exchangeRateSource, setExchangeRateSource] = useState("")
  const [exchangeRateEffectiveDate, setExchangeRateEffectiveDate] = useState(todayISO())
  const [showProviderCreator, setShowProviderCreator] = useState(false)
  const [submissionKey] = useState(() => `manual:${createId("REQ")}`)
  const [evidenceSheetOpen, setEvidenceSheetOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [lines, setLines] = useState<RepairLineInput[]>([{ description: ocrString("lineDescription"), lineType: "PART", partNumber: "", quantity: Math.max(1, ocrNumber("lineQuantity", 1)), unitPrice: ocrNumber("lineUnitPrice"), lineTotal: initialOCRValues?.lineTotal != null ? ocrNumber("lineTotal") : undefined, position: "NOT_STATED" }])
  const ocrProviderName = ocrString("providerName")
  const maintenanceRecords = (store?.maintenanceRecords || []).filter((record) => record.vehicleId === vehicle.id && !record.archived)
  const selectedRoadside = roadsideOptions.find((option) => option.eventId === roadsideEventId)
  /**
   * Workstream C privacy correction: never queries/returns anything on an
   * empty or sub-minimum-length query (no "browse all providers"
   * affordance), queries SERVICE-PROVIDER PROFILES specifically (not the
   * full company list), never exposes an internal id or a total count,
   * ranks this carrier's previously-used providers first, and caps the
   * result set.
   */
  const searchVendors = (query: string) => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_PROVIDER_SEARCH_CHARS) return []
    const normalizedQuery = trimmed.toLowerCase()
    const previouslyUsed = getCompanyPreviouslyUsedVendorIds(companyId)
    const companiesById = new Map(readCompanies().map((company) => [company.id, company]))
    const matches = listServiceProviders()
      .filter((provider) => `${provider.legalName} ${provider.tradeName || ""}`.toLowerCase().includes(normalizedQuery))
      .map((provider) => ({ provider, company: companiesById.get(provider.organizationId) }))
      .filter((entry): entry is { provider: ServiceProviderProfile; company: Company } => Boolean(entry.company))
    matches.sort((a, b) => {
      const aUsed = previouslyUsed.has(a.company.id) ? 0 : 1
      const bUsed = previouslyUsed.has(b.company.id) ? 0 : 1
      if (aUsed !== bUsed) return aUsed - bUsed
      return a.provider.legalName.localeCompare(b.provider.legalName)
    })
    return matches.slice(0, MAX_PROVIDER_SEARCH_RESULTS).map(({ provider, company }) => ({
      entityType: "Company" as const,
      id: company.id,
      label: provider.tradeName || provider.legalName,
      // City/region only — never the internal id.
      secondaryText: [provider.facilities[0]?.city, provider.facilities[0]?.region].filter(Boolean).join(", ") || undefined,
      status: company.status,
    }))
  }
  const createNewVendor = () => setShowProviderCreator(true)
  const resolvedLines = useMemo(() => lines.map((line) => ({ lineType: line.lineType || "PART" as RepairLineType, lineTotal: line.lineTotal ?? line.quantity * line.unitPrice })), [lines])
  const subtotal = calculateRowsTotal(resolvedLines)
  const documentTotalNumber = documentTotal.trim() === "" ? null : Number(documentTotal)
  const { state: varianceState, variance } = getVarianceState(documentTotalNumber, subtotal)
  // Live per-type breakdown shows the MAGNITUDE entered for each type (see
  // getRepairLineTypeTotals's own comment for why) — Credits' sign-based
  // subtraction is applied only inside calculateRowsTotal above.
  const liveTypeTotals = useMemo(() => resolvedLines.reduce<Record<RepairLineType, number>>((totals, line) => { totals[line.lineType] += Math.abs(line.lineTotal); return totals }, { PART: 0, LABOR: 0, SUBLET: 0, SHOP_SUPPLY: 0, TOWING: 0, FEE: 0, TAX: 0, CREDIT: 0, OTHER: 0 }), [resolvedLines])
  const fail = (message: string) => {
    setLocalError(message)
    setError(message)
  }

  const save = () => {
    setLocalError(null)
    if (!invoiceNumber.trim()) return fail("Invoice Number is required.")
    if (!serviceCompletionDate) return fail("Service Completion Date is required.")
    if (!isValidISODate(serviceCompletionDate)) return fail("Service Completion Date must be a real date as YYYY-MM-DD.")
    if (!invoiceDate) return fail("Invoice Date is required.")
    if (!isValidISODate(invoiceDate)) return fail("Invoice Date must be a real date as YYYY-MM-DD.")
    if (!vendor) return fail("Service Provider / Repair Shop is required.")
    const normalizeIdentifier = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "")
    const ocrCompanyName = ocrString("companyName")
    const canonicalCompanyName = readCompanies().find((company) => company.id === companyId)?.name || ""
    if (ocrCompanyName && canonicalCompanyName && normalizeSuffix(ocrCompanyName) !== normalizeSuffix(canonicalCompanyName)) return fail(`Company mismatch: the invoice names “${ocrCompanyName}” but this record belongs to “${canonicalCompanyName}”. Send it to ownership review instead of saving it here.`)
    const ocrVin = normalizeIdentifier(ocrString("vin"))
    const canonicalVin = normalizeIdentifier(vehicle.vin || "")
    if (ocrVin && canonicalVin && ocrVin !== canonicalVin) return fail("Vehicle mismatch: the VIN on the repair invoice does not match this vehicle.")
    const ocrUnit = normalizeIdentifier(ocrString("unitNumber"))
    const canonicalUnit = normalizeIdentifier(vehicle.unitNumber || "")
    if (ocrUnit && canonicalUnit && ocrUnit !== canonicalUnit) return fail("Vehicle mismatch: the unit number on the repair invoice does not match this vehicle.")
    const ocrPlate = normalizeIdentifier(ocrString("plateNumber"))
    const currentPlate = normalizeIdentifier(String((store?.registrationRecords || []).filter((record) => record.vehicleId === vehicle.id && !record.archived).sort((a, b) => (b.registrationDate || "").localeCompare(a.registrationDate || ""))[0]?.plate || ""))
    if (ocrPlate && currentPlate && ocrPlate !== currentPlate && !ocrVin) return fail("Vehicle mismatch: the plate on the repair invoice does not match this vehicle and no matching VIN was supplied.")
    if (documentTotalNumber === null || documentTotalNumber <= 0) return fail("Document Invoice Total is required.")
    if (odometerSource !== "NOT_STATED" && (!odometer || Number(odometer) <= 0)) return fail("Enter the odometer or select Not stated on source.")
    if (currency !== reportingCurrency && Number(exchangeRate) <= 0) return fail("A valid exchange rate is required when currencies differ.")
    if (currency !== reportingCurrency && !exchangeRateSource.trim()) return fail("Exchange Rate Source is required when currencies differ.")
    if (currency !== reportingCurrency && !exchangeRateEffectiveDate) return fail("Exchange Rate Effective Date is required when currencies differ.")
    if (currency !== reportingCurrency && !isValidISODate(exchangeRateEffectiveDate)) return fail("Exchange Rate Effective Date must be a real date as YYYY-MM-DD.")
    if (roadsideEventId && selectedRoadside?.findings.length && roadsideFindingIds.length === 0) return fail("Select at least one roadside finding addressed by this repair.")
    for (const line of lines) {
      if (!line.description.trim()) return fail("Every invoice row requires its original description.")
      if (line.quantity <= 0) return fail("Every invoice row requires a quantity greater than zero.")
      const amount = line.lineTotal ?? line.quantity * line.unitPrice
      if ((line.lineType || "PART") !== "CREDIT" && amount < 0) return fail("Negative amounts must use the Credit / discount row type.")
    }
    const unmappedFindings = roadsideFindingIds.filter((findingId) => !lines.some((line) => (line.sourceFindingIds || []).includes(findingId)))
    if (unmappedFindings.length) return fail("Connect every selected roadside finding to at least one exact repair row using Additional classification and links.")
    try {
      const provider = getServiceProviderByOrganizationId(vendor.id)
      const facility = provider?.facilities.find((item) => item.active) || provider?.facilities[0]
      const contact = provider?.contacts.find((item) => item.active && (!item.facilityId || item.facilityId === facility?.id)) || provider?.contacts[0]
      const invoiceInput = { vehicleId: vehicle.id, vendorId: vendor.id, vendorName: vendor.name, providerProfileId: provider?.id, facilityId: facility?.id, contactId: contact?.id, technicianId: contact?.technicianLicenceNumber ? contact.id : undefined, invoiceNumber: invoiceNumber.trim(), invoiceDate, serviceCompletionDate, documentKind, currency, reportingCurrency, exchangeRate: currency === reportingCurrency ? 1 : Number(exchangeRate), exchangeRateSource: currency === reportingCurrency ? "IDENTITY" : exchangeRateSource.trim() || undefined, exchangeRateEffectiveDate: currency === reportingCurrency ? invoiceDate : exchangeRateEffectiveDate, totalDue: documentTotalNumber, odometer: odometerSource === "NOT_STATED" ? undefined : Number(odometer), odometerUnit, odometerSource, lines, repairOrigin: (repairOrigin || undefined) as RepairOrigin | undefined, maintenanceEventId: maintenanceEventId || undefined, roadsideEventId: roadsideEventId || undefined, sourceInspectionFindingIds: roadsideFindingIds, evidenceIds: pendingEvidenceId ? [pendingEvidenceId] : [], sourceDocumentHash: ocrString("__sourceDocumentHash") || undefined }
      if (initialOCRValues) createRepairInvoice(companyId, invoiceInput, { entrySource: "ocr", sourceDocumentId: ocrString("__sourceDocumentId") || pendingEvidenceId || undefined, uploadBatchId: ocrString("__uploadBatchId") || undefined, detectedDocumentId: ocrString("__detectedDocumentId") || undefined, idempotencyKey: ocrString("__idempotencyKey") || `ocr:${submissionKey}` })
      else createManualRepairInvoice(companyId, { ...invoiceInput, idempotencyKey: submissionKey })
      clearPendingEvidence?.()
      onSaved()
    } catch (error) { fail(error instanceof Error ? error.message : "Repair bill could not be saved.") }
  }

  const evidenceContent = (
    <>
      <p className="text-xs font-bold">Evidence and verification</p>
      {pendingEvidenceId ? (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Source invoice attached</p>
          <p className="mt-1 break-all font-mono text-[9px] text-muted-foreground">{pendingEvidenceId}</p>
          <div className="mt-2 flex gap-2">{onAttachEvidence ? <Button type="button" variant="outline" size="sm" onClick={onAttachEvidence}>Replace</Button> : null}{clearPendingEvidence ? <Button type="button" variant="ghost" size="sm" onClick={clearPendingEvidence}>Remove</Button> : null}</div>
        </div>
      ) : (
        // Workstream D: the master Evidence panel, when empty, always shows
        // the Attach action directly — never a bare empty state.
        <div className="mt-3 rounded-lg border border-dashed p-4 text-center">
          <p className="text-[11px] text-muted-foreground">Attach the original invoice for side-by-side verification. This does not restart OCR or erase the information entered above.</p>
          {onAttachEvidence ? <Button type="button" className="mt-3" variant="outline" size="sm" onClick={onAttachEvidence}>Attach Source Invoice</Button> : null}
        </div>
      )}
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">Without evidence, the record remains incomplete and pending review.</p>
    </>
  )

  return (
    // Workstream D — responds to CONTAINER width via Tailwind's @container
    // convention (already established elsewhere: components/ui/card.tsx,
    // components/ui/field.tsx use @container/<name> + @<size>/<name>:
    // variants) rather than viewport media queries. The named container
    // must wrap EVERYTHING that uses an @.../rbform: variant, including the
    // header bar's Evidence-drawer trigger below — an earlier version of
    // this placed that button outside the container, which silently made
    // its @min-[900px]/rbform:hidden variant never match (confirmed via
    // live browser inspection during validation; see the task report).
    // Tiers: <900px container = 13-15" laptop behavior (single column,
    // compact full-width calculation, Evidence in a drawer); 900-1500px =
    // 16-24" desktop (multi-column, fixed ~300px Evidence aside);
    // >=1500px = 27-34" ultrawide (content capped at a maximum width —
    // max-w-[1800px], chosen here since no existing max-width token for
    // this purpose was found elsewhere in the codebase; see the task
    // report — extra space becomes margin, fixed ~320px aside). Real
    // achievable container width in this page's actual layout (sidebar +
    // master Evidence rail already consume space) was measured live at
    // ~1245-1325px even at a 1920px viewport — thresholds were calibrated
    // against that measurement, not raw viewport width.
    <div className="@container/rbform mx-auto max-w-[1800px] space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <Button variant="outline" onClick={onClose}>← Back to Repair Bills</Button>
        <div><h2 className="text-base font-bold">Add Repair Bill</h2><p className="text-[11px] text-muted-foreground">Enter the invoice once. TES will retain every row and calculate the BI totals automatically.</p></div>
        <div className="ml-auto flex gap-2">
          {/* Narrower-than-desktop collapse step 3: Evidence moves into a drawer, triggered here, sharing the exact same evidenceContent — never a second independent surface. */}
          <Button type="button" variant="outline" className="@min-[1180px]/rbform:hidden" onClick={() => setEvidenceSheetOpen(true)}>Evidence{pendingEvidenceId ? " ✓" : ""}</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save Repair Bill</Button>
        </div>
      </div>
      {localError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs font-semibold text-destructive">
          {localError}
        </div>
      ) : null}

      <div>
        <div className="grid gap-3 @min-[1180px]/rbform:grid-cols-[minmax(0,1fr)_300px] @min-[1400px]/rbform:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="@container/rbmain overflow-hidden @min-[1180px]/rbform:col-start-1 @min-[1180px]/rbform:row-start-1">
            <div className="space-y-5 border-b p-4">
              <RepairFormSection title="Invoice details" className="grid grid-cols-1 gap-3 @min-[620px]/rbmain:grid-cols-2 @min-[1040px]/rbmain:grid-cols-5">
                <FieldComponent label="Invoice Number" required><Input className={inputClass} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></FieldComponent>
                <FieldComponent label="Service Completion Date" required><ISODateInput className={inputClass} value={serviceCompletionDate} onValueChange={setServiceCompletionDate} required /></FieldComponent>
                <FieldComponent label="Invoice Date" required><ISODateInput className={inputClass} value={invoiceDate} onValueChange={setInvoiceDate} required /></FieldComponent>
                <FieldComponent label="Document Invoice Total" required><Input className={inputClass} type="number" min="0" step="any" value={documentTotal} onChange={(event) => setDocumentTotal(event.target.value)} /></FieldComponent>
                <FieldComponent label="Document Type"><select className={selectClass} value={documentKind} onChange={(event) => setDocumentKind(event.target.value as RepairDocumentKind)}><option value="FINAL_INVOICE">Final invoice</option><option value="CONFIRMED_RECEIPT">Confirmed receipt</option></select></FieldComponent>
              </RepairFormSection>

              <RepairFormSection title="Provider & discovery" className="grid grid-cols-1 gap-3 @min-[720px]/rbmain:grid-cols-2 @min-[1040px]/rbmain:grid-cols-4">
                <div className="@min-[1040px]/rbmain:col-span-1">
                  <FieldComponent label="Service Provider / Repair Shop" required><EntityPicker label="" placeholder={`Type ${MIN_PROVIDER_SEARCH_CHARS}+ characters to search providers…`} selectedEntity={vendor ? { entityType: "Company", id: vendor.id, label: vendor.name, status: vendor.status } : null} onSelect={(entity) => setVendor(entity ? readCompanies().find((company) => company.id === entity.id) || null : null)} onSearch={searchVendors} onCreateNew={createNewVendor} createNewButtonLabel="Create Service Provider" />{ocrProviderName && !vendor ? <span className="mt-1 block text-[9px] text-amber-700 dark:text-amber-300">OCR read “{ocrProviderName}”. Search and confirm the canonical provider; TES will not match a company by name alone.</span> : null}</FieldComponent>
                </div>
                <FieldComponent label="Discovery / Repair Origin"><select className={selectClass} value={repairOrigin} onChange={(event) => setRepairOrigin(event.target.value)}><option value="">Not stated / unknown</option>{REPAIR_ORIGINS.map((value) => <option key={value} value={value}>{value}</option>)}</select></FieldComponent>
                <FieldComponent label="Linked Maintenance Event"><select className={selectClass} value={maintenanceEventId} onChange={(event) => setMaintenanceEventId(event.target.value)}><option value="">No linked event</option>{maintenanceRecords.map((record) => <option key={record.id} value={record.id}>{record.serviceDate || record.id} · {record.maintenanceType || "Maintenance"}</option>)}</select></FieldComponent>
                <FieldComponent label="Linked Roadside Inspection"><select className={selectClass} value={roadsideEventId} onChange={(event) => { const next = event.target.value; setRoadsideEventId(next); setRoadsideFindingIds([]); if (next) setRepairOrigin("Roadside inspection finding") }}><option value="">No linked roadside inspection</option>{roadsideOptions.map((option) => <option key={option.eventId} value={option.eventId}>{option.label} · {option.equipmentLabel}</option>)}</select></FieldComponent>
              </RepairFormSection>

              <RepairFormSection title="Odometer & currency" className="grid grid-cols-1 gap-3 @min-[620px]/rbmain:grid-cols-2 @min-[1040px]/rbmain:grid-cols-5">
                <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                  <FieldComponent label="Odometer"><Input className={inputClass} type="number" min="0" value={odometer} disabled={odometerSource === "NOT_STATED"} onChange={(event) => setOdometer(event.target.value)} /></FieldComponent>
                  <FieldComponent label="Unit"><select className={selectClass} value={odometerUnit} onChange={(event) => setOdometerUnit(event.target.value as "KM" | "MI")}><option value="KM">km</option><option value="MI">mi</option></select></FieldComponent>
                </div>
                <FieldComponent label="Odometer Source"><select className={selectClass} value={odometerSource} onChange={(event) => setOdometerSource(event.target.value as OdometerSource)}><option value="EVIDENCE">Shown on invoice</option><option value="CLIENT_CONFIRMED">Client confirmed</option><option value="LINKED_RECORD">Linked record</option><option value="NOT_STATED">Not stated on source</option></select></FieldComponent>
                <FieldComponent label="Invoice Currency"><select className={selectClass} value={currency} onChange={(event) => setCurrency(event.target.value as RepairCurrency)}><option value="CAD">CAD</option><option value="USD">USD</option></select></FieldComponent>
                <FieldComponent label="Company Reporting Currency"><select className={selectClass} value={reportingCurrency} onChange={(event) => setReportingCurrency(event.target.value as RepairCurrency)}><option value="CAD">CAD</option><option value="USD">USD</option></select></FieldComponent>
                <FieldComponent label="Exchange Rate"><Input className={inputClass} type="number" min="0" step="any" value={currency === reportingCurrency ? "1" : exchangeRate} disabled={currency === reportingCurrency} onChange={(event) => setExchangeRate(event.target.value)} /></FieldComponent>
                {currency !== reportingCurrency ? (
                  <>
                    <FieldComponent label="Exchange Rate Source" required><Input className={inputClass} value={exchangeRateSource} onChange={(event) => setExchangeRateSource(event.target.value)} placeholder="Bank of Canada, invoice, client confirmed…" /></FieldComponent>
                    <FieldComponent label="Rate Effective Date" required><ISODateInput className={inputClass} value={exchangeRateEffectiveDate} onValueChange={setExchangeRateEffectiveDate} required /></FieldComponent>
                  </>
                ) : null}
              </RepairFormSection>
            </div>

            {selectedRoadside ? <div className="border-b bg-amber-500/5 p-4"><p className="text-xs font-bold">Roadside findings addressed by this repair</p><p className="mt-1 text-[10px] text-muted-foreground">Select only the exact findings resolved by work on this invoice. Additional shop discoveries remain normal invoice rows.</p><div className="mt-2 grid gap-2 md:grid-cols-2">{selectedRoadside.findings.map((finding) => <label key={finding.id} className="flex items-start gap-2 rounded-lg border bg-card p-3 text-xs"><input type="checkbox" className="mt-0.5" checked={roadsideFindingIds.includes(finding.id)} onChange={(event) => setRoadsideFindingIds((current) => event.target.checked ? [...current, finding.id] : current.filter((id) => id !== finding.id))} /><span><span className="font-medium">{finding.label}</span>{finding.outOfService ? <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[9px] font-bold text-destructive">OOS</span> : null}</span></label>)}</div>{selectedRoadside.findings.length === 0 ? <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">No structured equipment findings are available on this roadside event. The event can still be linked, but it will require review.</p> : null}</div> : null}

            {/*
              Calculation summary: full-width compact block directly below
              invoice details at narrow container widths (13-15"), moved
              into the fixed-width aside column at >=1400px (16-24"/
              ultrawide) via col/row placement below.
            */}
            <div className="border-b p-4 @container/calc @min-[1180px]/rbform:hidden">
              <LiveCalculationPanel liveTypeTotals={liveTypeTotals} subtotal={subtotal} documentTotalNumber={documentTotalNumber} varianceState={varianceState} variance={variance} currency={currency} reportingCurrency={reportingCurrency} exchangeRate={exchangeRate} horizontal />
            </div>

            <div className="p-4">
              <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold">Invoice rows</p><p className="text-[10px] text-muted-foreground">Keep the vendor wording. Classification remains separate underneath each row.</p></div><Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, { description: "", lineType: "PART", quantity: 1, unitPrice: 0, position: "NOT_STATED" }])}><Plus className="mr-1.5 size-3" />Add Row</Button></div>
              <div className="space-y-2">{lines.map((line, index) => <RepairBillLineRow key={index} line={line} onChange={(next) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} canRemove={lines.length > 1} inputClass={inputClass} selectClass={selectClass} availableFindings={selectedRoadside?.findings.filter((finding) => roadsideFindingIds.includes(finding.id)) || []} />)}</div>
            </div>
          </Card>

          {/* Wide-container-only aside (>=1400px) — hidden entirely below that, where the compact summary above and the Evidence drawer trigger in the header take over. Exactly one Evidence surface is ever visible at once. */}
          <aside className="hidden space-y-3 @min-[1180px]/rbform:col-start-2 @min-[1180px]/rbform:row-start-1 @min-[1180px]/rbform:block">
            <Card className="p-4 @container/calc">
              <LiveCalculationPanel liveTypeTotals={liveTypeTotals} subtotal={subtotal} documentTotalNumber={documentTotalNumber} varianceState={varianceState} variance={variance} currency={currency} reportingCurrency={reportingCurrency} exchangeRate={exchangeRate} />
            </Card>
            <Card className="p-4">{evidenceContent}</Card>
          </aside>
        </div>
      </div>

      <Sheet open={evidenceSheetOpen} onOpenChange={setEvidenceSheetOpen}>
        <SheetContent side="right" className="w-full max-w-sm p-4">
          <SheetHeader className="p-0"><SheetTitle>Evidence and verification</SheetTitle></SheetHeader>
          <div className="mt-3">{evidenceContent}</div>
        </SheetContent>
      </Sheet>

      {showProviderCreator ? <ProviderQuickCreate companies={readCompanies()} inputClass={inputClass} selectClass={selectClass} setError={setError} onCancel={() => setShowProviderCreator(false)} onCreated={(company) => { setVendor(company); setShowProviderCreator(false) }} /> : null}
    </div>
  )
}

function LiveCalculationPanel({ liveTypeTotals, subtotal, documentTotalNumber, varianceState, variance, currency, reportingCurrency, exchangeRate, horizontal = false }: { liveTypeTotals: Record<RepairLineType, number>; subtotal: number; documentTotalNumber: number | null; varianceState: VarianceState; variance: number | null; currency: RepairCurrency; reportingCurrency: RepairCurrency; exchangeRate: string; horizontal?: boolean }) {
  return (
    <>
      <p className="text-xs font-bold">Live invoice calculation</p>
      {/* At every width, Calculated Rows / Document Invoice Total / Variance status remain visible (locked minimum, section 6). All 9 categories affecting the sum are shown here — none exists in the math without also being visible. */}
      <div className={`mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs @[420px]/calc:grid-cols-3 ${horizontal ? "@min-[1180px]/rbform:grid-cols-8" : ""}`}>
        <TotalRow label="Parts" value={liveTypeTotals.PART} currency={currency} />
        <TotalRow label="Labor" value={liveTypeTotals.LABOR} currency={currency} />
        <TotalRow label="Sublet" value={liveTypeTotals.SUBLET} currency={currency} />
        <TotalRow label="Supplies / fees" value={liveTypeTotals.SHOP_SUPPLY + liveTypeTotals.FEE} currency={currency} />
        <TotalRow label="Towing" value={liveTypeTotals.TOWING} currency={currency} />
        <TotalRow label="Other" value={liveTypeTotals.OTHER} currency={currency} />
        <TotalRow label="Tax" value={liveTypeTotals.TAX} currency={currency} />
        <TotalRow label="Credits" value={liveTypeTotals.CREDIT} currency={currency} />
      </div>
      <div className="mt-2 space-y-1 border-t pt-2 text-xs">
        <TotalRow label="Calculated rows" value={subtotal} currency={currency} strong />
        <TotalRow label="Document total" value={documentTotalNumber ?? 0} currency={currency} strong />
      </div>
      <VarianceBanner className="mt-2" state={varianceState} calculatedRows={subtotal} documentTotal={documentTotalNumber ?? 0} variance={variance} currency={currency} />
      {currency !== reportingCurrency ? <div className="mt-2 rounded-lg border p-2"><p className="text-[10px] text-muted-foreground">Reporting total</p><p className="mt-0.5 font-bold">{money((documentTotalNumber ?? 0) * (Number(exchangeRate) || 0), reportingCurrency)}</p></div> : null}
    </>
  )
}

function TotalRow({ label, value, currency, strong = false }: { label: string; value: number; currency: RepairCurrency; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 ${strong ? "font-bold" : ""}`}><span>{label}</span><span className="tabular-nums">{money(value, currency)}</span></div>
}

function ProviderQuickCreate({ companies, inputClass, selectClass, setError, onCancel, onCreated }: { companies: Company[]; inputClass: string; selectClass: string; setError: (value: string | null) => void; onCancel: () => void; onCreated: (company: Company) => void }) {
  // Workstream C4: an existing Company (e.g. already a TES client) can
  // RECEIVE a service-provider profile rather than forcing a duplicate
  // organization record — the locked model's own organizationId link
  // already supports this; this is just wiring the creation flow to offer
  // it, per the smallest-correct-extension instruction.
  const [existingCompany, setExistingCompany] = useState<Company | null>(null)
  const [legalName, setLegalName] = useState("")
  const [tradeName, setTradeName] = useState("")
  const [providerType, setProviderType] = useState<ServiceProviderType>("REPAIR_SHOP")
  const [additionalProviderTypes, setAdditionalProviderTypes] = useState<ServiceProviderType[]>([])
  const [taxNumber, setTaxNumber] = useState("")
  const [businessNumber, setBusinessNumber] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [website, setWebsite] = useState("")
  const [address, setAddress] = useState("")
  const [city, setCity] = useState("")
  const [region, setRegion] = useState("")
  const [postalCode, setPostalCode] = useState("")
  const [country, setCountry] = useState<"CA" | "US" | "OTHER">("CA")
  const [contactName, setContactName] = useState("")
  const [contactRole, setContactRole] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [technicianLicence, setTechnicianLicence] = useState("")
  const [capabilities, setCapabilities] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const fail = (message: string) => {
    setLocalError(message)
    setError(message)
  }

  const saveProvider = () => {
    setLocalError(null)
    if (!legalName.trim()) return fail("Service provider legal name is required.")
    if (!address.trim() || !city.trim() || !region.trim()) return fail("Service provider facility address, city and province/state are required.")
    // Duplicate detection reuses the existing Companies aggressive
    // fuzzy-match mechanism (lib/company-validation.ts validateCompany —
    // the same "Inc" vs "Inc." detection already used by Companies
    // creation) rather than a second, parallel mechanism. It surfaces a
    // SUGGESTION requiring explicit human confirmation (window.confirm)
    // and never auto-selects/merges anything — declining simply blocks
    // creation, per the locked spec.
    const validation = existingCompany ? { isValid: true, warning: false, message: "" } : validateCompany({ name: legalName.trim() }, companies)
    if (!validation.isValid || (validation.warning && !window.confirm(validation.message))) return fail(validation.message || "Service provider could not be created.")
    const company: Company = existingCompany || { id: createId("CMP"), name: tradeName.trim() || legalName.trim(), kind: "Vendor", status: "Active", tone: "ok" }
    try {
      createServiceProviderProfile({
        organizationId: company.id,
        legalName: legalName.trim(),
        tradeName: tradeName.trim() || undefined,
        providerType,
        additionalProviderTypes,
        taxRegistrationNumber: taxNumber.trim() || undefined,
        businessNumber: businessNumber.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        website: website.trim() || undefined,
        addressLine1: address.trim(),
        city: city.trim(),
        region: region.trim(),
        postalCode: postalCode.trim() || undefined,
        country,
        contactName: contactName.trim() || undefined,
        contactRole: contactRole.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        technicianLicenceNumber: technicianLicence.trim() || undefined,
        capabilities: capabilities.split(",").map((value) => value.trim()).filter(Boolean),
        mobileService: providerType === "MOBILE_MECHANIC" || additionalProviderTypes.includes("MOBILE_MECHANIC"),
        towingAvailable: providerType === "TOWING_RECOVERY" || additionalProviderTypes.includes("TOWING_RECOVERY"),
      })
      if (!existingCompany) localStorage.setItem("tes_companies", JSON.stringify([...companies, company]))
      setError(null)
      onCreated(company)
    } catch (error) {
      fail(error instanceof Error ? error.message : "Service provider could not be created.")
    }
  }

  return (
    <div className="fixed inset-0 z-[180] overflow-y-auto bg-black/60 p-4">
      <Card className="mx-auto w-full max-w-4xl overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4"><div><h3 className="text-sm font-bold">Create Service Provider</h3><p className="mt-0.5 text-[11px] text-muted-foreground">Create the organization and its first facility/contact once. Future repair bills reuse this record.</p></div><Button variant="ghost" size="sm" onClick={onCancel}><X className="size-4" /></Button></div>
        {localError ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-3 text-xs font-semibold text-destructive">
            {localError}
          </div>
        ) : null}
        <div className="border-b bg-muted/10 px-5 py-3">
          <p className="text-xs font-semibold">Attach a service-provider role to an existing company</p>
          <div className="mt-2">
            <EntityPicker
              placeholder="Search existing companies to attach a provider role instead of creating a new one…"
              selectedEntity={existingCompany ? { entityType: "Company", id: existingCompany.id, label: existingCompany.name, status: existingCompany.status } : null}
              onSelect={(entity) => { const found = entity ? companies.find((company) => company.id === entity.id) || null : null; setExistingCompany(found); if (found) { setLegalName(found.name); setTradeName(found.name) } }}
              onSearch={(query) => { const trimmed = query.trim(); if (trimmed.length < MIN_PROVIDER_SEARCH_CHARS) return []; return companies.filter((company) => company.name.toLowerCase().includes(trimmed.toLowerCase())).slice(0, MAX_PROVIDER_SEARCH_RESULTS).map((company) => ({ entityType: "Company" as const, id: company.id, label: company.name, status: company.status })) }}
            />
            <p className="mt-1 text-[9px] text-muted-foreground">Leave empty to create a brand-new organization below.</p>
          </div>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <label><span className="text-[10px] font-semibold text-muted-foreground">Legal name *</span><Input className={`${inputClass} mt-1`} value={legalName} onChange={(event) => setLegalName(event.target.value)} disabled={Boolean(existingCompany)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Operating / trade name</span><Input className={`${inputClass} mt-1`} value={tradeName} onChange={(event) => setTradeName(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Primary Provider type *</span><select className={`${selectClass} mt-1`} value={providerType} onChange={(event) => setProviderType(event.target.value as ServiceProviderType)}>{PROVIDER_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="sm:col-span-2 lg:col-span-3">
            <span className="text-[10px] font-semibold text-muted-foreground">Additional Provider types (optional)</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {PROVIDER_TYPE_OPTIONS.filter((option) => option.value !== providerType).map((option) => {
                const checked = additionalProviderTypes.includes(option.value)
                return (
                  <label key={option.value} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${checked ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
                    <input type="checkbox" className="size-3" checked={checked} onChange={(event) => setAdditionalProviderTypes((current) => event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value))} />
                    {option.label}
                  </label>
                )
              })}
            </div>
          </label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Tax registration number</span><Input className={`${inputClass} mt-1`} value={taxNumber} onChange={(event) => setTaxNumber(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Business number</span><Input className={`${inputClass} mt-1`} value={businessNumber} onChange={(event) => setBusinessNumber(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Website</span><Input className={`${inputClass} mt-1`} value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">General phone</span><Input className={`${inputClass} mt-1`} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">General email</span><Input className={`${inputClass} mt-1`} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="sm:col-span-2"><span className="text-[10px] font-semibold text-muted-foreground">Facility address *</span><Input className={`${inputClass} mt-1`} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">City *</span><Input className={`${inputClass} mt-1`} value={city} onChange={(event) => setCity(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Province / State *</span><Input className={`${inputClass} mt-1`} value={region} onChange={(event) => setRegion(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Postal / ZIP</span><Input className={`${inputClass} mt-1`} value={postalCode} onChange={(event) => setPostalCode(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Country *</span><select className={`${selectClass} mt-1`} value={country} onChange={(event) => setCountry(event.target.value as "CA" | "US" | "OTHER")}><option value="CA">Canada</option><option value="US">United States</option><option value="OTHER">Other</option></select></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Primary contact / technician</span><Input className={`${inputClass} mt-1`} value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Role</span><Input className={`${inputClass} mt-1`} value={contactRole} onChange={(event) => setContactRole(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Contact phone</span><Input className={`${inputClass} mt-1`} value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Contact email</span><Input className={`${inputClass} mt-1`} value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label>
          <label><span className="text-[10px] font-semibold text-muted-foreground">Technician licence number</span><Input className={`${inputClass} mt-1`} value={technicianLicence} onChange={(event) => setTechnicianLicence(event.target.value)} /></label>
          <label className="sm:col-span-2"><span className="text-[10px] font-semibold text-muted-foreground">Capabilities</span><Input className={`${inputClass} mt-1`} value={capabilities} onChange={(event) => setCapabilities(event.target.value)} placeholder="Brakes, engine, reefer, mobile service…" /><span className="mt-1 block text-[9px] text-muted-foreground">Separate capabilities with commas.</span></label>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-4"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button onClick={saveProvider}>Create Service Provider</Button></div>
      </Card>
    </div>
  )
}
