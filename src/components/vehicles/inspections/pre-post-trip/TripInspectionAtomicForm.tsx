"use client"

import * as React from "react"
import { CheckCircle2, ChevronDown, Container, FileText, Link2, LockKeyhole, ShieldCheck, Truck } from "lucide-react"
import { POWER_UNIT_CHECKLIST, TRAILER_CHECKLIST, TRIP_INSPECTION_TEMPLATE_VERSION, groupChecklist, type ChecklistDefinition } from "./trip-inspection-checklist"

export type InspectionResult = "INSPECTED_OK" | "DEFECT_OBSERVED" | "NOT_APPLICABLE"
export type EquipmentRole = "POWER_UNIT" | `TRAILER_${number}`

export type InspectionEquipment = {
  id: string
  role: EquipmentRole
  unitNumber?: string
  vin: string
  plateNumber: string
  plateJurisdiction: string
  year?: string
  make?: string
  model?: string
  ownership: "COMPANY" | "THIRD_PARTY"
}

export type AtomicInspectionAnswer = {
  id: string
  checklistDefinitionId: string
  checklistLabelSnapshot: string
  checklistTemplateVersion: string
  regulatoryCategories: string[]
  subjectEquipmentId: string
  subjectEquipmentRole: EquipmentRole
  result: InspectionResult
  observation?: string
  componentPosition?: string
  evidenceIds: string[]
}

export type TripInspectionSubmission = {
  companyId: string
  driverId: string
  phase: "PRE_TRIP" | "POST_TRIP"
  inspectedAt: string
  timezone: string
  location: string
  odometer: string
  equipment: InspectionEquipment[]
  answers: AtomicInspectionAnswer[]
  certificationAccepted: true
}

type Props = {
  company: { id: string; legalName: string; logoUrl?: string; address: string; phone?: string; email?: string; nscNumber?: string; usdotNumber?: string }
  driver: { id: string; name: string; licenceNumber?: string; licenceJurisdiction?: string }
  powerUnits: InspectionEquipment[]
  trailers: InspectionEquipment[]
  onSubmit: (submission: TripInspectionSubmission) => Promise<{ recordId: string; pdfEvidenceId: string }>
}

type AnswerDraft = { result?: InspectionResult; observation: string; componentPosition: string }
const fieldClass = "h-10 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"

function equipmentKey(equipment: InspectionEquipment) {
  return `${equipment.id}:${equipment.role}`
}

function answerKey(equipment: InspectionEquipment, definition: ChecklistDefinition) {
  return `${equipmentKey(equipment)}:${definition.id}`
}

function ChecklistForEquipment({ equipment, definitions, drafts, setDraft }: {
  equipment: InspectionEquipment
  definitions: readonly ChecklistDefinition[]
  drafts: Record<string, AnswerDraft>
  setDraft: (key: string, patch: Partial<AnswerDraft>) => void
}) {
  const grouped = groupChecklist(definitions)
  const completed = definitions.filter((definition) => drafts[answerKey(equipment, definition)]?.result).length
  return <section className="overflow-hidden rounded-xl border border-border bg-card">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">{equipment.role === "POWER_UNIT" ? <Truck className="size-4 text-primary" /> : <Container className="size-4 text-primary" />}<div><h3 className="text-xs font-bold text-foreground">{equipment.role === "POWER_UNIT" ? `Power unit ${equipment.unitNumber || ""}` : `${equipment.role.replace("_", " ")} ${equipment.unitNumber || ""}`}</h3><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{equipment.vin} · {equipment.plateNumber} {equipment.plateJurisdiction}</p></div></div>
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${completed === definitions.length ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{completed} of {definitions.length}</span>
    </header>
    <div className="divide-y divide-border">
      {Object.entries(grouped).map(([group, items], groupIndex) => <details key={group} open={groupIndex === 0} className="group">
        <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-4 py-2.5 text-xs font-bold text-foreground marker:hidden"><span>{group}</span><span className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground">{items.filter((item) => drafts[answerKey(equipment, item)]?.result).length}/{items.length}<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></span></summary>
        <div className="border-t border-border bg-muted/[0.12] px-4">
          {items.map((definition) => {
            const key = answerKey(equipment, definition)
            const draft = drafts[key] || { observation: "", componentPosition: "" }
            return <div className="border-b border-border/80 py-3 last:border-b-0" key={definition.id}>
              <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_170px]"><div><p className="text-xs font-semibold text-foreground">{definition.label}</p><p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{definition.id}</p></div><select className={fieldClass} value={draft.result || ""} onChange={(event) => setDraft(key, { result: event.target.value as InspectionResult })}><option value="">Select result</option><option value="INSPECTED_OK">Inspected - OK</option><option value="DEFECT_OBSERVED">Defect observed</option><option value="NOT_APPLICABLE">Not applicable</option></select></div>
              {draft.result === "DEFECT_OBSERVED" ? <div className="mt-3 grid gap-3 rounded-lg border border-destructive/15 bg-destructive/[0.025] p-3 sm:grid-cols-[180px_minmax(0,1fr)]"><div><label className="mb-1 block text-[10px] font-bold text-muted-foreground">Component position</label><input className={fieldClass} value={draft.componentPosition} onChange={(event) => setDraft(key, { componentPosition: event.target.value })} placeholder="Axle, side or wheel" /></div><div><label className="mb-1 block text-[10px] font-bold text-muted-foreground">Observed condition *</label><textarea className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs" value={draft.observation} onChange={(event) => setDraft(key, { observation: event.target.value })} placeholder="Describe exactly what you observed. TES determines regulatory severity separately." /></div></div> : null}
            </div>
          })}
        </div>
      </details>)}
    </div>
  </section>
}

export function TripInspectionAtomicForm({ company, driver, powerUnits, trailers, onSubmit }: Props) {
  const [phase, setPhase] = React.useState<"PRE_TRIP" | "POST_TRIP">("PRE_TRIP")
  const [powerUnitId, setPowerUnitId] = React.useState(powerUnits[0]?.id || "")
  const [selectedTrailerIds, setSelectedTrailerIds] = React.useState<string[]>([])
  const [trailerToAdd, setTrailerToAdd] = React.useState("")
  const [location, setLocation] = React.useState("")
  const [odometer, setOdometer] = React.useState("")
  const [drafts, setDrafts] = React.useState<Record<string, AnswerDraft>>({})
  const [certified, setCertified] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [lockedRecord, setLockedRecord] = React.useState<{ recordId: string; pdfEvidenceId: string } | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const powerUnit = powerUnits.find((item) => item.id === powerUnitId)
  const attachedTrailers = selectedTrailerIds.map((id, index) => {
    const trailer = trailers.find((item) => item.id === id)
    return trailer ? { ...trailer, role: `TRAILER_${index + 1}` as EquipmentRole } : null
  }).filter(Boolean) as InspectionEquipment[]
  const equipment = powerUnit ? [{ ...powerUnit, role: "POWER_UNIT" as const }, ...attachedTrailers] : attachedTrailers
  const expectedCount = powerUnit ? POWER_UNIT_CHECKLIST.length + attachedTrailers.length * TRAILER_CHECKLIST.length : attachedTrailers.length * TRAILER_CHECKLIST.length
  const completedCount = equipment.reduce((total, item) => total + (item.role === "POWER_UNIT" ? POWER_UNIT_CHECKLIST : TRAILER_CHECKLIST).filter((definition) => drafts[answerKey(item, definition)]?.result).length, 0)

  function updateDraft(key: string, patch: Partial<AnswerDraft>) {
    setDrafts((current) => ({ ...current, [key]: { result: current[key]?.result, observation: current[key]?.observation || "", componentPosition: current[key]?.componentPosition || "", ...patch } }))
  }

  function addTrailer() {
    if (!trailerToAdd || selectedTrailerIds.includes(trailerToAdd)) return
    setSelectedTrailerIds((current) => [...current, trailerToAdd])
    setTrailerToAdd("")
  }

  async function submit() {
    if (!powerUnit || !location.trim() || !odometer.trim() || !certified) return setError("Complete the power unit, location, odometer and certification fields.")
    if (completedCount !== expectedCount) return setError(`Complete every inspection point. ${completedCount} of ${expectedCount} are answered.`)
    const definitionsFor = (item: InspectionEquipment) => item.role === "POWER_UNIT" ? POWER_UNIT_CHECKLIST : TRAILER_CHECKLIST
    const incompleteDefect = equipment.some((item) => definitionsFor(item).some((definition) => {
      const draft = drafts[answerKey(item, definition)]
      return draft?.result === "DEFECT_OBSERVED" && !draft.observation.trim()
    }))
    if (incompleteDefect) return setError("Describe every observed defect before submitting.")
    setSubmitting(true); setError(null)
    try {
      const answers: AtomicInspectionAnswer[] = equipment.flatMap((item) => definitionsFor(item).map((definition) => {
        const key = answerKey(item, definition); const draft = drafts[key]
        return { id: crypto.randomUUID(), checklistDefinitionId: definition.id, checklistLabelSnapshot: definition.label, checklistTemplateVersion: TRIP_INSPECTION_TEMPLATE_VERSION, regulatoryCategories: [...definition.regulatoryCategories], subjectEquipmentId: item.id, subjectEquipmentRole: item.role, result: draft.result!, observation: draft.observation.trim() || undefined, componentPosition: draft.componentPosition.trim() || undefined, evidenceIds: [] }
      }))
      const locked = await onSubmit({ companyId: company.id, driverId: driver.id, phase, inspectedAt: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, location: location.trim(), odometer: odometer.trim(), equipment, answers, certificationAccepted: true })
      setLockedRecord(locked)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Inspection could not be submitted.") } finally { setSubmitting(false) }
  }

  if (lockedRecord) return <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/60 p-5 dark:bg-emerald-950/20"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 text-emerald-700" /><div><h2 className="text-sm font-bold text-foreground">Inspection submitted and permanently locked</h2><p className="mt-1 text-xs text-muted-foreground">{lockedRecord.recordId} · {expectedCount} atomic answers · generated PDF evidence {lockedRecord.pdfEvidenceId}</p><div className="mt-4 flex flex-wrap gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><FileText className="size-3.5" />View-only PDF</span><span className="flex items-center gap-1.5"><Link2 className="size-3.5" />Visible to client and TES</span><span className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5" />No edit or delete endpoint</span></div></div></div></div>

  return <div className="space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card p-4"><div><p className="text-sm font-bold text-foreground">{company.legalName}</p><p className="mt-1 text-[11px] text-muted-foreground">Trip inspection · {driver.name}</p></div><div className="flex gap-2">{(["PRE_TRIP", "POST_TRIP"] as const).map((value) => <button key={value} type="button" onClick={() => setPhase(value)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${phase === value ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>{value === "PRE_TRIP" ? "Pre-Trip" : "Post-Trip"}</button>)}</div></header>
    {error ? <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div> : null}
    <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-[11px] font-bold text-muted-foreground">Power unit *</label><select className={fieldClass} value={powerUnitId} onChange={(event) => setPowerUnitId(event.target.value)}>{powerUnits.map((item) => <option key={item.id} value={item.id}>{item.unitNumber} · {item.plateNumber} · {item.vin}</option>)}</select></div><div><label className="mb-1.5 block text-[11px] font-bold text-muted-foreground">Location *</label><input className={fieldClass} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City, province/state or highway" /></div><div><label className="mb-1.5 block text-[11px] font-bold text-muted-foreground">Odometer *</label><input className={fieldClass} value={odometer} onChange={(event) => setOdometer(event.target.value)} /></div><div><label className="mb-1.5 block text-[11px] font-bold text-muted-foreground">Attach trailer</label><div className="flex gap-2"><select className={fieldClass} value={trailerToAdd} onChange={(event) => setTrailerToAdd(event.target.value)}><option value="">Select trailer</option>{trailers.filter((item) => !selectedTrailerIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.unitNumber || "Third party"} · {item.plateNumber} · {item.vin}</option>)}</select><button type="button" onClick={addTrailer} className="rounded-lg border border-border px-3 text-xs font-bold">Add</button></div></div></section>
    <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"><div><p className="text-xs font-bold text-foreground">Inspection completion</p><p className="mt-0.5 text-[10px] text-muted-foreground">46 power-unit points + 16 for each trailer</p></div><strong className="text-sm text-primary">{completedCount} of {expectedCount}</strong></div>
    {powerUnit ? <ChecklistForEquipment equipment={{ ...powerUnit, role: "POWER_UNIT" }} definitions={POWER_UNIT_CHECKLIST} drafts={drafts} setDraft={updateDraft} /> : null}
    {attachedTrailers.map((item) => <ChecklistForEquipment key={equipmentKey(item)} equipment={item} definitions={TRAILER_CHECKLIST} drafts={drafts} setDraft={updateDraft} />)}
    <section className="rounded-xl border border-border bg-card p-4"><label className="flex items-start gap-3 text-xs leading-5"><input type="checkbox" className="mt-1 size-4" checked={certified} onChange={(event) => setCertified(event.target.checked)} /><span>I certify that I inspected every identified item for the listed power unit and attached trailer(s). I understand this submission and the generated PDF become permanent and cannot be edited, replaced or deleted.</span></label><button type="button" disabled={submitting} onClick={submit} className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-bold text-primary-foreground disabled:opacity-50"><LockKeyhole className="size-4" />{submitting ? "Submitting…" : "Submit & permanently lock"}</button></section>
  </div>
}

/* Server contract: POST only. Persist the canonical snapshot and outbox/PDF job atomically.
   Never expose PUT/PATCH/DELETE for submitted inspections. Corrections are separate linked records. */

