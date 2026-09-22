"use client"

import * as React from "react"
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, ClipboardCheck, ListChecks, ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"

export type InspectionFamilyKey = "ANNUAL_PERIODIC" | "PRE_POST_TRIP" | "ROADSIDE_CVSA" | "OTHER"
export type InspectionListStatusTone = "GOOD" | "WARNING" | "CRITICAL" | "NEUTRAL"

export interface VehicleInspectionIndexRecord {
  id: string
  family: InspectionFamilyKey
  title: string
  inspectionDateLabel: string
  secondaryLabel: string
  statusLabel: string
  statusTone: InspectionListStatusTone
  evidenceLabel: string
  requiresAttention?: boolean
}

export interface VehicleInspectionsWorkspaceProps {
  unitNumber: string
  vehicleLabel: string
  records: VehicleInspectionIndexRecord[]
  inspectionTypes?: readonly string[]
  onOpenRecord?: (record: VehicleInspectionIndexRecord) => void
  renderRecord?: (record: VehicleInspectionIndexRecord, controls: { onBackToList: () => void }) => React.ReactNode
}

const FAMILY_DETAILS: Record<Exclude<InspectionFamilyKey, "OTHER">, { title: string; description: string }> = {
  ANNUAL_PERIODIC: { title: "Annual / Periodic Inspection History", description: "Certificates, expiry cycles and supporting evidence for this vehicle." },
  PRE_POST_TRIP: { title: "Pre-Trip / Post-Trip Register", description: "High-volume driver inspection reports, ordered newest first." },
  ROADSIDE_CVSA: { title: "Roadside / CVSA Register", description: "Enforcement events, outcomes, violations and permanent repair links." },
}

function typeFamily(value: string): InspectionFamilyKey {
  const normalized = value.toLowerCase()
  if (normalized.includes("roadside") || normalized.includes("cvsa")) return "ROADSIDE_CVSA"
  if (normalized.includes("pre-trip") || normalized.includes("pre trip") || normalized.includes("post-trip") || normalized.includes("post trip") || normalized.includes("dvir")) return "PRE_POST_TRIP"
  if (normalized.includes("annual") || normalized.includes("periodic") || normalized.includes("cvip") || normalized.includes("396.17")) return "ANNUAL_PERIODIC"
  return "OTHER"
}

function statusClasses(tone: InspectionListStatusTone) {
  return cn("inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold", tone === "GOOD" && "bg-emerald-50 text-emerald-700", tone === "WARNING" && "bg-amber-50 text-amber-700", tone === "CRITICAL" && "bg-red-50 text-red-700", tone === "NEUTRAL" && "bg-muted text-muted-foreground")
}

export function InspectionBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button aria-label={label} className="inline-flex h-9 items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 text-xs font-bold text-primary shadow-sm transition hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" onClick={onClick} type="button">
    <span className="grid size-5 place-items-center rounded-md bg-primary text-primary-foreground"><ArrowLeft className="size-3.5" /></span>{label}
  </button>
}

function Metric({ label, value, attention }: { label: string; value: string | number; attention?: boolean }) {
  return <span><small className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</small><strong className={cn("mt-1 block text-xs", attention ? "text-amber-700" : "text-foreground")}>{value}</strong></span>
}

function RecordTable({ records, onOpen }: { records: VehicleInspectionIndexRecord[]; onOpen: (record: VehicleInspectionIndexRecord) => void }) {
  return <div className="overflow-hidden rounded-lg border border-border bg-card">
    <div className="hidden grid-cols-[minmax(220px,1.3fr)_140px_130px_140px_24px] gap-3 bg-muted/50 px-4 py-3 text-[10px] font-bold uppercase tracking-wide text-muted-foreground md:grid"><span>Record</span><span>Date</span><span>Status</span><span>Evidence</span><span /></div>
    {records.map((record) => <button className="grid min-h-20 w-full grid-cols-[1fr_20px] items-center gap-3 border-t border-border px-4 py-3 text-left hover:bg-muted/30 md:grid-cols-[minmax(220px,1.3fr)_140px_130px_140px_24px]" key={record.id} onClick={() => onOpen(record)} type="button">
      <span><strong className="block text-sm text-foreground">{record.title}</strong><small className="mt-1 block font-mono text-[10px] text-muted-foreground">{record.id}</small></span>
      <span className="hidden text-xs text-foreground md:block">{record.inspectionDateLabel}<small className="mt-1 block text-[10px] text-muted-foreground">{record.secondaryLabel}</small></span>
      <span className="hidden md:block"><span className={statusClasses(record.statusTone)}>{record.statusLabel}</span></span>
      <span className="hidden text-xs font-semibold text-foreground md:block">{record.evidenceLabel}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>)}
    {records.length === 0 ? <div className="grid min-h-32 place-items-center p-6 text-center text-xs text-muted-foreground"><div><AlertTriangle className="mx-auto mb-2 h-5 w-5" />No records in this inspection type.</div></div> : null}
  </div>
}

export function VehicleInspectionsWorkspace({ unitNumber, vehicleLabel, records, inspectionTypes = [], onOpenRecord, renderRecord }: VehicleInspectionsWorkspaceProps) {
  const [activeFamily, setActiveFamily] = React.useState<Exclude<InspectionFamilyKey, "OTHER"> | null>(null)
  const [activeType, setActiveType] = React.useState<string | null>(null)
  const [activeRecordId, setActiveRecordId] = React.useState<string | null>(null)
  const activeRecord = records.find((record) => record.id === activeRecordId) || null

  const openRecord = (record: VehicleInspectionIndexRecord) => { setActiveRecordId(record.id); onOpenRecord?.(record) }
  const backToLanding = () => { setActiveFamily(null); setActiveType(null); setActiveRecordId(null) }
  const visibleRecords = activeType ? records.filter((record) => record.title === activeType) : activeFamily ? records.filter((record) => record.family === activeFamily) : []
  const annualRecords = records.filter((record) => record.family === "ANNUAL_PERIODIC")
  const currentAnnual = annualRecords[0]
  const tripRecords = records.filter((record) => record.family === "PRE_POST_TRIP")
  const roadsideRecords = records.filter((record) => record.family === "ROADSIDE_CVSA")
  const configuredOtherTypes = Array.from(new Set([...inspectionTypes.filter((type) => typeFamily(type) === "OTHER"), ...records.filter((record) => record.family === "OTHER").map((record) => record.title)]))

  React.useEffect(() => { if (activeRecordId && !records.some((record) => record.id === activeRecordId)) setActiveRecordId(null) }, [activeRecordId, records])
  if (activeRecord && renderRecord) return <>{renderRecord(activeRecord, { onBackToList: () => setActiveRecordId(null) })}</>

  if (activeFamily || activeType) {
    const heading = activeType || FAMILY_DETAILS[activeFamily!].title
    const description = activeType ? `All ${activeType} records for ${unitNumber}, ordered newest first.` : FAMILY_DETAILS[activeFamily!].description
    return <section className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-4"><div className="mb-3"><InspectionBackButton label="Back to inspection overview" onClick={backToLanding} /></div><h2 className="text-sm font-bold text-foreground">{heading}</h2><p className="mt-1 text-[11px] text-muted-foreground">{description}</p></div>
      <RecordTable records={visibleRecords} onOpen={openRecord} />
    </section>
  }

  return <section className="space-y-3">
    <div className="rounded-lg border border-border bg-card p-4"><h2 className="text-sm font-bold text-foreground">Inspection overview</h2><p className="mt-1 text-[11px] text-muted-foreground">{unitNumber} · {vehicleLabel}. Annual compliance is separated from high-volume operational and enforcement records.</p></div>

    <button className="relative grid min-h-32 w-full overflow-hidden rounded-lg border border-primary/25 bg-card p-4 text-left shadow-sm transition hover:border-primary/50 hover:shadow-md md:grid-cols-[52px_minmax(260px,1fr)_repeat(4,minmax(100px,auto))_24px] md:items-center md:gap-4" onClick={() => setActiveFamily("ANNUAL_PERIODIC")} type="button">
      <span className="absolute inset-y-0 left-0 w-1 bg-primary" />
      <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary"><ClipboardCheck className="size-5" /></span>
      <span className="mt-3 md:mt-0"><span className="inline-flex rounded-full bg-primary/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-primary">Compliance cycle</span><strong className="mt-2 block text-base text-foreground">Annual / Periodic Vehicle Inspection</strong><small className="mt-1 block text-[11px] text-muted-foreground">Current certificate, expiry, evidence completeness and prior annual history.</small></span>
      <span className="mt-3 md:mt-0"><Metric label="Current status" value={currentAnnual?.statusLabel || "No record"} attention={currentAnnual?.requiresAttention} /></span>
      <span className="mt-3 md:mt-0"><Metric label="Latest" value={currentAnnual?.inspectionDateLabel || "—"} /></span>
      <span className="mt-3 md:mt-0"><Metric label="Evidence" value={currentAnnual?.evidenceLabel || "Missing"} attention={!currentAnnual || currentAnnual.evidenceLabel === "Missing"} /></span>
      <span className="mt-3 md:mt-0"><Metric label="History" value={`${annualRecords.length} record${annualRecords.length === 1 ? "" : "s"}`} /></span>
      <ChevronRight className="absolute right-4 top-4 size-5 text-primary md:static" />
    </button>

    <div className="grid gap-3 lg:grid-cols-2">
      {[
        { family: "PRE_POST_TRIP" as const, title: "Pre-Trip / Post-Trip Register", description: "Daily driver inspection stream", icon: CheckCircle2, data: tripRecords },
        { family: "ROADSIDE_CVSA" as const, title: "Roadside / CVSA Register", description: "Enforcement and violation stream", icon: ShieldAlert, data: roadsideRecords },
      ].map((item) => { const Icon = item.icon; const attention = item.data.filter((record) => record.requiresAttention).length; return <button className="grid min-h-28 grid-cols-[42px_1fr_20px] items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-muted/20" key={item.family} onClick={() => setActiveFamily(item.family)} type="button"><span className="grid size-10 place-items-center rounded-lg bg-muted text-primary"><Icon className="size-4" /></span><span><strong className="block text-sm text-foreground">{item.title}</strong><small className="mt-1 block text-[11px] text-muted-foreground">{item.description}</small><span className="mt-2 flex gap-4 text-[10px] text-muted-foreground"><b className="text-foreground">{item.data.length} records</b><b className={attention ? "text-amber-700" : "text-emerald-700"}>{attention ? `${attention} attention` : "No attention"}</b></span></span><ChevronRight className="size-4 text-muted-foreground" /></button> })}
    </div>

    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3"><span className="grid size-9 place-items-center rounded-lg bg-muted text-primary"><ListChecks className="size-4" /></span><div><h3 className="text-sm font-bold text-foreground">Additional inspection types</h3><p className="mt-0.5 text-[11px] text-muted-foreground">The controlled inspection list stays available without mixing these records into Annual Inspection.</p></div></div>
      {configuredOtherTypes.length ? <div className="grid sm:grid-cols-2">{configuredOtherTypes.map((type) => { const typeRecords = records.filter((record) => record.title === type); return <button className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-4 py-3 text-left hover:bg-muted/25 sm:odd:border-r" key={type} onClick={() => setActiveType(type)} type="button"><span><strong className="block text-xs text-foreground">{type}</strong><small className="mt-1 block text-[10px] text-muted-foreground">{typeRecords.length} record{typeRecords.length === 1 ? "" : "s"}</small></span><ChevronRight className="size-4 text-muted-foreground" /></button> })}</div> : <p className="px-4 py-6 text-xs text-muted-foreground">No additional inspection types are configured.</p>}
    </div>
  </section>
}
