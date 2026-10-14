"use client"

import { useState, type ReactNode } from "react"
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Check,
  FileText,
  RotateCcw,
  Upload,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { TESStatusIndicator, TESStatusRing, type TESStatusTone } from "@/components/tes-status"
import { VehicleIllustration } from "@/components/vehicle-illustration"
import {
  displayEquipmentType,
  formatVehicleModel,
  normalizeVehicleManufacturer,
} from "@/lib/vehicle-manufacturers"
import type { VehicleRecord } from "@/src/types"
import type { EvidenceRecord } from "@/types/evidence"

export const inputClass =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15"
export const selectClass = inputClass
export const modalFieldInputClass =
  "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50"

export function vehicleStatusTone(status: string): TESStatusTone {
  if (["Active", "Pass", "Completed", "Verified", "Current"].includes(status)) return "current"
  if (["Expired", "Fail", "Out of Service", "Cancelled"].includes(status)) return "critical"
  if (["Expiring Soon", "Pass with Defects", "Pending", "Maintenance", "Scheduled", "In Progress"].includes(status)) return "attention"
  if (["Draft", "Inactive", "Archived", "Replaced"].includes(status)) return "neutral"
  return "info"
}

export function StatusPill({ value }: { value: string }) {
  return <TESStatusIndicator tone={vehicleStatusTone(value)}>{value}</TESStatusIndicator>
}

export function Field({
  label,
  children,
  required = false,
  className = "",
}: {
  label: string
  children: ReactNode
  required?: boolean
  className?: string
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-[11px] font-semibold text-muted-foreground">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {children}
    </div>
  )
}

export function Divider() {
  return <div className="my-5 border-t border-border/80" />
}

export function ModalShell({
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  title: string
  subtitle: string
  onClose: () => void
  footer: ReactNode
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-bold tracking-[-0.015em] text-foreground">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 mt-0.5 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer}
      </div>
    </div>
  )
}

export function ModalOCRStrip({ title, description, onStartOCR }: { title: string; description: string; onStartOCR: () => void }) {
  return (
    <div className="mx-6 mt-4 flex items-center justify-between gap-4 rounded-xl border border-primary/15 bg-primary/[0.035] px-4 py-3">
      <div>
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onStartOCR}>
        <Upload className="mr-1.5 size-3.5" />Upload / OCR
      </Button>
    </div>
  )
}

export function ModalSectionLabel({ children }: { children: ReactNode }) {
  return <p className="px-6 pb-2 pt-5 text-[11px] font-semibold text-foreground">{children}</p>
}

export function ModalFieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 px-6 sm:grid-cols-2">{children}</div>
}

export function ModalField({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label className="text-[11px] font-semibold text-muted-foreground">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {children}
    </div>
  )
}

export function ModalEvidenceCard({ label, attached, attachedNote, onAttach }: { label: string; attached: boolean; attachedNote?: string; onAttach: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3.5">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{attached ? attachedNote || "Attached" : "Missing"}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onAttach}>
        <Upload className="mr-1.5 size-3" />Attach
      </Button>
    </div>
  )
}

export function ModalFooter({ note, onCancel, onSave, saveLabel }: { note: string; onCancel: () => void; onSave: () => void; saveLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/20 px-6 py-4">
      <p className="text-[11px] text-muted-foreground">{note}</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onSave}>{saveLabel}</Button>
      </div>
    </div>
  )
}

export function SectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/80 px-4 py-3.5">
      <div>
        <h2 className="text-sm font-bold tracking-[-0.01em]">{title}</h2>
        {description ? <p className="mt-1 text-[11px] text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/10 px-5 py-10 text-center">
      <FileText className="mx-auto mb-3 size-7 text-muted-foreground/50" />
      <p className="text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function AlertBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <span className="flex items-center gap-2"><AlertCircle className="size-4" />{message}</span>
      <button onClick={onClose} aria-label="Dismiss"><X className="size-4" /></button>
    </div>
  )
}

export function NoticeBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700">
      <span className="flex items-center gap-2"><Check className="size-4" />{message}</span>
      <button onClick={onClose} aria-label="Dismiss"><X className="size-4" /></button>
    </div>
  )
}

export function VehicleWorkspaceHero({
  vehicle,
  companyName,
  activePlate,
  activeJurisdiction,
  onBack,
  onArchive,
  onRestore,
  onUpload,
}: {
  vehicle: VehicleRecord
  companyName?: string
  activePlate: string | null
  activeJurisdiction: string | null
  onBack: () => void
  onArchive: () => void
  onRestore: () => void
  onUpload: () => void
}) {
  const manufacturer = normalizeVehicleManufacturer(vehicle.make || "", vehicle.equipmentType)
  const identity = [
    vehicle.year,
    manufacturer.name,
    formatVehicleModel(vehicle.model || ""),
    vehicle.vin,
    activePlate,
    activeJurisdiction?.toUpperCase(),
  ].filter(Boolean)
  const operatingDetails = [
    displayEquipmentType(vehicle.equipmentType),
    vehicle.operatingRegion ? `Operating Region: ${vehicle.operatingRegion}` : "",
  ].filter(Boolean)
  const tone = vehicleStatusTone(vehicle.status)
  const statusClass = tone === "current"
    ? "bg-emerald-50 text-emerald-700"
    : tone === "attention"
      ? "bg-amber-50 text-amber-700"
      : tone === "critical"
        ? "bg-red-50 text-red-700"
        : "bg-secondary text-muted-foreground"

  return (
    <section className="flex flex-col gap-5 min-[1500px]:flex-row min-[1500px]:items-start min-[1500px]:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <button
          type="button"
          onClick={onBack}
          className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Back to vehicles"
          aria-label="Back to vehicles"
        >
          <ArrowLeft className="size-4" />
        </button>
        <VehicleIllustration color={vehicle.color} className="hidden size-28 sm:flex" />
        <div className="min-w-0 pt-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[28px] font-extrabold leading-8 tracking-[-0.035em] text-foreground">{vehicle.unitNumber || "Vehicle"}</h1>
            <TESStatusRing tone={tone} size="lg" />
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>{vehicle.status}</span>
          </div>
          {companyName ? <p className="mt-2 text-[13px] font-bold text-foreground">{companyName}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
            {identity.map((item, index) => <span key={`${item}-${index}`}>{index ? <span className="mr-2.5 text-border">•</span> : null}{item}</span>)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
            {operatingDetails.map((item, index) => <span key={item}>{index ? <span className="mr-2.5 text-border">•</span> : null}{item}</span>)}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 min-[1500px]:justify-end">
        {vehicle.status === "Archived" ? (
          <Button variant="outline" size="sm" onClick={onRestore}><RotateCcw className="mr-1.5 size-3.5" />Restore</Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onArchive}><Archive className="mr-1.5 size-3.5" />Archive</Button>
        )}
        <Button size="sm" onClick={onUpload}><Upload className="mr-1.5 size-3.5" />Document / OCR</Button>
      </div>
    </section>
  )
}

export interface VehicleSummaryItem {
  label: string
  value: string
  detail: string
  tone: TESStatusTone
}

export function VehicleComplianceStrip({ items }: { items: VehicleSummaryItem[] }) {
  return (
    <Card className="grid gap-0 overflow-hidden py-0 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => (
        <div key={item.label} className={`flex min-h-24 items-start gap-3 px-4 py-4 ${index ? "border-t sm:border-t-0 sm:border-l" : ""}`}>
          <TESStatusRing tone={item.tone} size="md" className="mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">{item.label}</p>
            <p className="mt-1 text-xs font-semibold text-primary">{item.value}</p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">{item.detail}</p>
          </div>
        </div>
      ))}
    </Card>
  )
}

export function VehicleEvidencePanel({
  title,
  items,
  totalCount,
  onOpen,
  onUpload,
  onClearSelection,
  details = [],
  activity = [],
  selectionRequired = false,
}: {
  title?: string
  items: EvidenceRecord[]
  totalCount: number
  onOpen: (item: EvidenceRecord) => void
  onUpload: () => void
  onClearSelection?: () => void
  details?: Array<{ label: string; value: string }>
  activity?: Array<{ title: string; description: string; date: string }>
  selectionRequired?: boolean
}) {
  const [tab, setTab] = useState<"evidence" | "details" | "activity">("evidence")
  const showRecordTabs = Boolean(title) && !selectionRequired
  return (
    <Card className="h-fit gap-0 overflow-hidden py-0 min-[1500px]:sticky min-[1500px]:top-4">
      <div className="flex items-start justify-between border-b border-border px-4 py-4">
        <div>
          <h2 className="text-base font-bold tracking-[-0.02em]">Evidence</h2>
          <p className="mt-1 max-w-[235px] truncate text-[11px] text-muted-foreground">{selectionRequired ? "Select a record to view its evidence" : title || `${totalCount} vehicle document${totalCount === 1 ? "" : "s"}`}</p>
        </div>
        {onClearSelection ? <button type="button" onClick={onClearSelection} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Show all vehicle evidence"><X className="size-3.5" /></button> : null}
      </div>

      {showRecordTabs ? <div className="grid grid-cols-3 border-b border-border px-2">
        {(["evidence", "details", "activity"] as const).map((value) => <button key={value} type="button" onClick={() => setTab(value)} className={`relative h-10 text-[11px] capitalize ${tab === value ? "font-bold text-primary after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:bg-primary" : "text-muted-foreground"}`}>{value}</button>)}
      </div> : null}

      <div className="p-4">
        {(!showRecordTabs || tab === "evidence") ? <>
        {!selectionRequired ? <button type="button" onClick={onUpload} className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-primary/25 bg-primary/[0.025] px-4 py-6 text-center transition-colors hover:bg-primary/[0.05]">
          <span className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Upload className="size-4" /></span>
          <span className="text-xs font-semibold text-foreground">Upload Document</span>
          <span className="mt-1 text-[11px] text-muted-foreground">Capture or select a source document</span>
        </button> : null}

        <div className="mt-3 divide-y divide-border/80">
          {items.length === 0 ? (
            <div className="py-8 text-center">
              <FileText className="mx-auto size-6 text-muted-foreground/40" />
              <p className="mt-2 text-xs font-medium text-foreground">{selectionRequired ? "No record selected" : "No evidence attached"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{selectionRequired ? "Choose a record from the list. Only evidence linked to that record will appear here." : "Documents remain available here after verification."}</p>
            </div>
          ) : items.map((item) => (
            <button key={item.id} type="button" onClick={() => onOpen(item)} className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-muted/25">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600"><FileText className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-foreground">{item.fileName}</span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.documentType} · {item.uploadedAt?.split("T")[0] || "Date unavailable"}</span>
              </span>
              <TESStatusRing tone={item.verificationState === "verified" ? "current" : "attention"} size="sm" />
            </button>
          ))}
        </div>
        </> : null}

        {showRecordTabs && tab === "details" ? <dl className="divide-y divide-border/80">
          {details.length ? details.map((item) => <div className="py-3" key={item.label}><dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{item.label}</dt><dd className="mt-1 text-xs font-semibold text-foreground">{item.value || "—"}</dd></div>) : <p className="py-8 text-center text-xs text-muted-foreground">No record details available.</p>}
        </dl> : null}

        {showRecordTabs && tab === "activity" ? <div className="space-y-0">
          {activity.length ? activity.map((item) => <article className="border-b border-border/80 py-3 last:border-b-0" key={`${item.title}:${item.date}`}><p className="text-xs font-bold text-foreground">{item.title}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{item.description}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.date}</p></article>) : <p className="py-8 text-center text-xs text-muted-foreground">No activity available.</p>}
        </div> : null}
      </div>
    </Card>
  )
}
