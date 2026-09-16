"use client"

import { useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { EntityPicker } from "@/src/components/shared/EntityPicker"
import { validateCompany } from "@/lib/company-validation"
import { createId, type VehicleStore } from "@/lib/vehicle-data"
import {
  createManualRepairInvoice,
  RECONCILIATION_TOLERANCE,
  type RepairInvoice,
  type RepairInvoiceLine,
  type RepairLineInput,
} from "@/lib/repair-invoice-data"
import type { PartCatalogEntry } from "@/lib/part-catalog-data"
import type { Company, VehicleRecord } from "@/src/types"

type RepairEmptyStateComponent = ComponentType<{
  title: string
  description: string
  action?: ReactNode
}>

type RepairSectionTitleComponent = ComponentType<{
  title: string
  description?: string
  action?: ReactNode
}>

type RepairStatusPillComponent = ComponentType<{
  value: string
}>

type RepairFieldComponent = ComponentType<{
  label: string
  required?: boolean
  className?: string
  children: ReactNode
}>

type RepairDividerComponent = ComponentType

export function currency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0)
}

export function RepairBillsView({
  companyId,
  vehicle,
  repairInvoices,
  partCatalog,
  spendSummary,
  spendByCategory,
  recurringIssues,
  onAddRepairBill,
  EmptyStateComponent,
  SectionTitleComponent,
  StatusPillComponent,
}: {
  companyId: string
  vehicle: VehicleRecord
  repairInvoices: { invoice: RepairInvoice; lines: RepairInvoiceLine[] }[]
  partCatalog: PartCatalogEntry[]
  spendSummary: { spendYTD: number; spendSinceFleetEntry: number }
  spendByCategory: { category: string; total: number; lineCount: number }[]
  recurringIssues: { key: string; label: string; count: number; monthsSpan: number }[]
  onAddRepairBill: () => void
  EmptyStateComponent: RepairEmptyStateComponent
  SectionTitleComponent: RepairSectionTitleComponent
  StatusPillComponent: RepairStatusPillComponent
}) {
  const catalogById = new Map(partCatalog.map((entry) => [entry.id, entry]))
  const maxCategorySpend = Math.max(1, ...spendByCategory.map((row) => row.total))

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Spend</p>
          <p className="mt-2 text-xl font-bold tabular-nums">{currency(spendSummary.spendYTD)}</p>
          <p className="text-[11px] text-muted-foreground">This year</p>
          <div className="mt-3 border-t border-border pt-2">
            <p className="text-sm font-semibold tabular-nums">{currency(spendSummary.spendSinceFleetEntry)}</p>
            <p className="text-[11px] text-muted-foreground">Since fleet entry</p>
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Spend by Category</p>
          {spendByCategory.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">No matched parts yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {spendByCategory.map((row) => (
                <div key={row.category}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium">{row.category}</span>
                    <span className="tabular-nums text-muted-foreground">{currency(row.total)}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${Math.max(4, (row.total / maxCategorySpend) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recurring Issues</p>
          {recurringIssues.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">No part repaired 3+ times in the last 12 months.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {recurringIssues.map((issue) => (
                <div key={issue.key} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{issue.label}</p>
                  <p className="text-[10px] text-muted-foreground">{issue.count} repairs in {issue.monthsSpan} months</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitleComponent
          title="Repair Bills"
          description="Line-item detail exactly as billed, from OCR or manual entry."
          action={<Button size="sm" onClick={onAddRepairBill}><Plus className="mr-1.5 size-3.5" />Add Repair Bill</Button>}
        />
        {repairInvoices.length === 0 ? (
          <EmptyStateComponent title="No repair bills recorded" description="Add a repair bill manually, or attach one through Upload Document / OCR." action={<Button onClick={onAddRepairBill}><Plus className="mr-1.5 size-4" />Add Repair Bill</Button>} />
        ) : (
          <div className="space-y-2 p-3">
            {repairInvoices.map(({ invoice, lines }) => (
              <Card key={invoice.id}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold">{invoice.invoiceNumber || "Repair Bill"}</h3>
                      <StatusPillComponent value={invoice.status === "auto_approved" ? "Verified" : "Pending"} />
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">{invoice.entrySource}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{invoice.invoiceDate || "—"}{invoice.vendorName ? ` · ${invoice.vendorName}` : ""}{invoice.maintenanceEventId ? ` · Linked to Maintenance Event ${invoice.maintenanceEventId}` : ""}</p>
                  </div>
                  <p className="text-sm font-bold tabular-nums">{currency(invoice.totalDue)}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2">Description</th>
                        <th className="px-4 py-2">Part</th>
                        <th className="px-4 py-2 text-right">Qty</th>
                        <th className="px-4 py-2 text-right">Unit Price</th>
                        <th className="px-4 py-2 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {lines.map((line) => (
                        <tr key={line.id}>
                          <td className="px-4 py-2">
                            {line.description}
                            {line.matchedPartId ? (
                              <span className="ml-1.5 text-[10px] text-muted-foreground">
                                → {catalogById.get(line.matchedPartId)?.canonicalName ?? "matched"}
                                {line.matchConfidence !== undefined ? ` (${Math.round(line.matchConfidence * 100)}%)` : ""}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">{line.partNumber || "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{line.quantity}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{currency(line.unitPrice)}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">{currency(line.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/10">
                        <td colSpan={4} className="px-4 py-2 text-right text-[11px] font-semibold">Invoice Total</td>
                        <td className="px-4 py-2 text-right font-bold tabular-nums">{currency(invoice.totalDue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {!invoice.reconciles ? (
                  <div className="border-t px-4 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    Line items subtotal ({currency(invoice.subtotal)}) does not reconcile with invoice total.
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

export function RepairBillLineRow({
  line,
  onChange,
  onRemove,
  canRemove,
  inputClass,
}: {
  line: RepairLineInput
  onChange: (next: RepairLineInput) => void
  onRemove: () => void
  canRemove: boolean
  inputClass: string
}) {
  const [overrideTotal, setOverrideTotal] = useState(false)
  const computedTotal = Math.round(line.quantity * line.unitPrice * 100) / 100
  return (
    <div className="grid grid-cols-12 gap-2 items-start rounded-lg border border-border p-3">
      <div className="col-span-4">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description<span className="text-destructive ml-0.5">*</span></label>
        <Input className="mt-1" value={line.description} onChange={(e) => onChange({ ...line, description: e.target.value })} />
      </div>
      <div className="col-span-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Part #</label>
        <Input className="mt-1" value={line.partNumber || ""} onChange={(e) => onChange({ ...line, partNumber: e.target.value })} />
      </div>
      <div className="col-span-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Qty<span className="text-destructive ml-0.5">*</span></label>
        <Input className="mt-1" type="number" min="0" step="any" value={line.quantity} onChange={(e) => onChange({ ...line, quantity: Number(e.target.value) || 0 })} />
      </div>
      <div className="col-span-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Unit Price<span className="text-destructive ml-0.5">*</span></label>
        <Input className="mt-1" type="number" min="0" step="any" value={line.unitPrice} onChange={(e) => onChange({ ...line, unitPrice: Number(e.target.value) || 0 })} />
      </div>
      <div className="col-span-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Line Total</label>
        <Input
          className="mt-1"
          type="number"
          min="0"
          step="any"
          value={overrideTotal ? (line.lineTotal ?? computedTotal) : computedTotal}
          onChange={(e) => { setOverrideTotal(true); onChange({ ...line, lineTotal: Number(e.target.value) || 0 }) }}
        />
        {overrideTotal ? (
          <button type="button" className="mt-0.5 text-[10px] text-primary hover:underline" onClick={() => { setOverrideTotal(false); onChange({ ...line, lineTotal: undefined }) }}>
            Reset to qty × unit price
          </button>
        ) : null}
      </div>
      <div className="col-span-1 flex justify-end pt-5">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={!canRemove}>
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function RepairBillForm({
  companyId,
  vehicle,
  store,
  onClose,
  onSaved,
  setError,
  readCompanies,
  FieldComponent,
  DividerComponent,
  inputClass,
  selectClass,
  todayISO,
}: {
  companyId: string
  vehicle: VehicleRecord
  store?: VehicleStore
  onClose: () => void
  onSaved: () => void
  setError: (value: string | null) => void
  readCompanies: () => Company[]
  FieldComponent: RepairFieldComponent
  DividerComponent: RepairDividerComponent
  inputClass: string
  selectClass: string
  todayISO: () => string
}) {
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [invoiceDate, setInvoiceDate] = useState(todayISO())
  const [totalDue, setTotalDue] = useState("")
  const [vendor, setVendor] = useState<Company | null>(null)
  const [maintenanceEventId, setMaintenanceEventId] = useState("")
  const [lines, setLines] = useState<RepairLineInput[]>([{ description: "", partNumber: "", quantity: 1, unitPrice: 0 }])
  const maintenanceRecords = (store?.maintenanceRecords || []).filter((record) => record.vehicleId === vehicle.id && !record.archived)

  const searchVendors = (query: string) =>
    readCompanies()
      .filter((company) => `${company.name} ${company.id}`.toLowerCase().includes(query.trim().toLowerCase()))
      .map((company) => ({ entityType: "Company" as const, id: company.id, label: company.name, secondaryText: company.id, status: company.status }))

  const createNewVendor = () => {
    const name = window.prompt("New Service Provider / Vendor name")?.trim() || ""
    if (!name) return
    const companies = readCompanies()
    const validation = validateCompany({ name }, companies)
    if (!validation.isValid || (validation.warning && !window.confirm(validation.message))) {
      setError(validation.message || "Company already exists or could not be created.")
      return
    }
    const company: Company = { id: createId("CMP"), name, kind: "Vendor", status: "Active", tone: "ok" }
    try {
      localStorage.setItem("tes_companies", JSON.stringify([...companies, company]))
      setVendor(company)
    } catch {
      setError("Could not create the vendor.")
    }
  }

  const addLine = () => setLines((current) => [...current, { description: "", partNumber: "", quantity: 1, unitPrice: 0 }])
  const updateLine = (index: number, next: RepairLineInput) => setLines((current) => current.map((line, i) => (i === index ? next : line)))
  const removeLine = (index: number) => setLines((current) => current.filter((_, i) => i !== index))

  const subtotal = Math.round(
    lines.reduce((sum, line) => sum + (line.lineTotal ?? line.quantity * line.unitPrice), 0) * 100
  ) / 100
  const totalDueNumber = Number(totalDue) || 0
  const reconciles = Math.abs(subtotal - totalDueNumber) <= RECONCILIATION_TOLERANCE

  const save = () => {
    if (!invoiceNumber.trim()) return setError("Invoice Number is required.")
    if (!invoiceDate) return setError("Invoice Date is required.")
    if (!totalDue || totalDueNumber <= 0) return setError("Total Due is required.")
    if (lines.length === 0) return setError("At least one line item is required.")
    for (const line of lines) {
      if (!line.description.trim()) return setError("Every line item requires a Description.")
      if (!line.quantity || line.quantity <= 0) return setError("Every line item requires a Quantity.")
      if (line.unitPrice === undefined || line.unitPrice === null || Number.isNaN(line.unitPrice)) {
        return setError("Every line item requires a Unit Price.")
      }
    }

    try {
      const result = createManualRepairInvoice(companyId, {
        vehicleId: vehicle.id,
        vendorId: vendor?.id,
        vendorName: vendor?.name,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        totalDue: totalDueNumber,
        lines,
        maintenanceEventId: maintenanceEventId || undefined,
      })
      if (result.reconciliationWarning) {
        setError(null)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repair bill could not be saved.")
    }
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-bold">Add Repair Bill</h2>
            <p className="text-[11px] text-muted-foreground">Structured line items only — every dollar amount must be tied to a line row.</p>
          </div>
          <button onClick={onClose}><X className="size-4" /></button>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <FieldComponent label="Invoice Number" required><Input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></FieldComponent>
            <FieldComponent label="Invoice Date" required><Input className={inputClass} type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></FieldComponent>
            <FieldComponent label="Total Due" required><Input className={inputClass} type="number" min="0" step="any" value={totalDue} onChange={(e) => setTotalDue(e.target.value)} /></FieldComponent>
            <FieldComponent label="Vendor">
              <EntityPicker
                label=""
                selectedEntity={vendor ? { entityType: "Company", id: vendor.id, label: vendor.name, secondaryText: vendor.id, status: vendor.status } : null}
                onSelect={(entity) => setVendor(entity ? readCompanies().find((company) => company.id === entity.id) || null : null)}
                onSearch={searchVendors}
                onCreateNew={createNewVendor}
                createNewButtonLabel="Create New Vendor"
              />
            </FieldComponent>
            <FieldComponent label="Maintenance Event" className="md:col-span-2">
              <select className={selectClass} value={maintenanceEventId} onChange={(e) => setMaintenanceEventId(e.target.value)}>
                <option value="">No linked Maintenance Event</option>
                {maintenanceRecords.map((record) => (
                  <option key={record.id} value={record.id}>{record.serviceDate || record.id} · {record.maintenanceType || "Maintenance"}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">Optional — one Maintenance Event can have zero, one, or multiple invoices.</p>
            </FieldComponent>
          </div>

          <DividerComponent />

          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Line Items</p>
            <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="mr-1.5 size-3" />Add Line</Button>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <RepairBillLineRow
                key={index}
                line={line}
                onChange={(next) => updateLine(index, next)}
                onRemove={() => removeLine(index)}
                canRemove={lines.length > 1}
                inputClass={inputClass}
              />
            ))}
          </div>

          <div className="rounded-lg border bg-muted/20 p-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold">Subtotal: {currency(subtotal)}</p>
              {!reconciles && totalDue ? (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                  Subtotal does not match Total Due ({currency(totalDueNumber)}). You can still save — this will be flagged for review.
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>Save Repair Bill</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
