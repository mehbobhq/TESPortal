"use client"

import { useEffect, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { Archive, ChevronRight, Edit3, FileText, Plus, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { createId, isoNow, saveVehicleStore } from "@/lib/vehicle-data"
import type { VehicleStore, VehicleRegistrationRecord } from "@/lib/vehicle-data"
import { recordAuditEvent } from "@/lib/audit-logger"
import { JURISDICTIONS, getJurisdictionLabel } from "@/lib/jurisdictions"
import type { VehicleRecord } from "@/src/types"
import type { EvidenceRecord } from "@/types/evidence"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { TESRecordOverlay } from "@/src/components/shared/TESRecordOverlay"

const REGISTRATION_TYPES = [
  "Prorate PSV",
  "Urban",
  "Prorate Exempt Goods",
  "Public Service",
  "Continuous",
]

function isTrailer(vehicleType: string) {
  return vehicleType.toLowerCase().startsWith("trailer")
}

function isContinuousRegistration(vehicle: VehicleRecord, registrationType: string) {
  return isTrailer(vehicle.equipmentType) && registrationType === "Continuous"
}

function registrationStatus(record: VehicleRegistrationRecord): VehicleRegistrationRecord["status"] {
  if (record.status === "Cancelled" || record.status === "Replaced" || record.status === "Draft") return record.status
  if (!record.expiryDate || record.expiryDate === "Continuous") return "Active"
  return new Date(`${record.expiryDate}T23:59:59`) < new Date() ? "Expired" : "Active"
}

type RegistrationArchiveRequest = {
  requestedBy: string
  requestSource:
    | "Client Portal"
    | "Email"
    | "Ticket"
    | "Other Documented Source"
    | ""
  requestReference: string
  archiveRequestEvidenceId: string
  reason: string
}

function getPrototypeAuthenticatedActor(): string {
  if (typeof window === "undefined") return "Authenticated TES user"
  try {
    const raw = localStorage.getItem("tes_current_user") || localStorage.getItem("tes_user")
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const value = parsed.displayName || parsed.name || parsed.email || parsed.id
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  } catch {}
  return "Authenticated TES user (prototype fallback)"
}

function RegistrationArchiveDialog({ companyId, record, vehicle, evidence, onCancel, onArchive, FieldComponent, selectClass, todayISO }: { companyId: string; record: VehicleRegistrationRecord; vehicle: VehicleRecord; evidence: EvidenceRecord[]; onCancel: () => void; onArchive: (request: RegistrationArchiveRequest, requestEvidence: EvidenceRecord, performedBy: string, archivedAt: string) => void; FieldComponent: RegistrationFieldComponent; selectClass: string; todayISO: () => string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [requestedBy, setRequestedBy] = useState("")
  const [requestSource, setRequestSource] = useState<RegistrationArchiveRequest["requestSource"]>("")
  const [requestReference, setRequestReference] = useState("")
  const [archiveRequestEvidence, setArchiveRequestEvidence] = useState<EvidenceRecord | null>(null)
  const [reason, setReason] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [uploadError, setUploadError] = useState<string | null>(null)

  const performedBy = getPrototypeAuthenticatedActor()
  const request: RegistrationArchiveRequest = {
    requestedBy: requestedBy.trim(),
    requestSource,
    requestReference: requestReference.trim(),
    archiveRequestEvidenceId: archiveRequestEvidence?.id || "",
    reason: reason.trim(),
  }
  const requiresReference = requestSource === "Ticket" || requestSource === "Client Portal" || requestSource === "Other Documented Source"
  const referenceLabel = requestSource === "Email"
    ? "Email Reference"
    : requestSource === "Ticket"
      ? "Ticket Reference"
      : requestSource === "Client Portal"
        ? "Portal Request Reference"
        : "Source Reference / Description"
  const canContinue = Boolean(
    request.requestedBy &&
    request.requestSource &&
    (!requiresReference || request.requestReference) &&
    request.archiveRequestEvidenceId
  )
  const title = step === 1 ? "Archive Registration Record" : step === 2 ? "Archive this registration record?" : "Confirm Archive"
  const goBack = () => setStep((current) => current === 3 ? 2 : 1)

  const handleRequestEvidenceUpload = (file: File | undefined) => {
    setUploadError(null)
    if (!file) return
    const isSupported = file.type === "application/pdf" || file.type.startsWith("image/")
    if (!isSupported) {
      setUploadError("Upload a screenshot/image or PDF for the archive request evidence.")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const now = isoNow()
      const requestId = createId("ARQ")
      const evidenceRecord: EvidenceRecord = {
        id: createId("EVD"),
        companyId,
        entityType: "ArchiveRequest",
        entityId: requestId,
        documentType: "Archive Request Evidence",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileReference: String(reader.result || ""),
        fileSize: file.size,
        documentDate: todayISO(),
        uploadedAt: now,
        uploadedBy: performedBy,
        source: "upload",
        verificationState: "verified",
        notes: `Evidence of archive request. Source: ${requestSource || "Not selected"}. Reference: ${requestReference.trim() || "Not provided"}.`,
      }
      // entityType=ArchiveRequest deliberately keeps this canonical evidence out of Vehicle evidence.
      setArchiveRequestEvidence(evidenceRecord)
    }
    reader.onerror = () => setUploadError("The request evidence file could not be read.")
    reader.readAsDataURL(file)
  }

  return (
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Step {step} of 3</p>
            </div>
            <button type="button" onClick={onCancel} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close archive workflow">
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-5 rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <p className="font-semibold">{record.registrationType}</p>
            <p className="mt-1 text-xs text-muted-foreground">Unit {vehicle.unitNumber || "—"} · {getJurisdictionLabel(record.stateProvince)} · Plate {record.plate || "—"}</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">Record ID: {record.id}</p>
          </div>

          {step === 1 ? (
            <div className="space-y-4">
              <FieldComponent label="Requested By" required>
                <Input value={requestedBy} onChange={(event) => setRequestedBy(event.target.value)} placeholder="Name of the person requesting the archive" autoComplete="off" />
              </FieldComponent>

              <FieldComponent label="Request Source" required>
                <select className={selectClass} value={requestSource} onChange={(event) => { setRequestSource(event.target.value as RegistrationArchiveRequest["requestSource"]); setRequestReference(""); setArchiveRequestEvidence(null); setUploadError(null) }}>
                  <option value="">Select…</option>
                  <option value="Client Portal">Client Portal</option>
                  <option value="Email">Email</option>
                  <option value="Ticket">Ticket</option>
                  <option value="Other Documented Source">Other Documented Source</option>
                </select>
              </FieldComponent>

              {requestSource ? (
                <FieldComponent label={referenceLabel} required={requiresReference}>
                  <Input
                    value={requestReference}
                    onChange={(event) => setRequestReference(event.target.value)}
                    placeholder={requestSource === "Email" ? "Email subject, sender, or message/reference ID" : requestSource === "Ticket" ? "Ticket number or ID/reference" : requestSource === "Client Portal" ? "Temporary portal request reference" : "Describe the source or reference"}
                  />
                  {requestSource === "Email" ? <p className="mt-1 text-[11px] text-muted-foreground">Use the email subject, sender, and/or message/reference identifier where available.</p> : null}
                  {requestSource === "Client Portal" ? <p className="mt-1 text-[11px] text-muted-foreground">Temporary prototype field. Authenticated portal request metadata will provide this automatically later.</p> : null}
                </FieldComponent>
              ) : null}

              {requestSource ? (
                <FieldComponent label="Archive Request Evidence" required>
                  <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">Upload screenshot / PDF</p>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">{archiveRequestEvidence ? archiveRequestEvidence.fileName : "No request evidence uploaded"}</p>
                      </div>
                      <label className="inline-flex shrink-0 cursor-pointer items-center rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-muted">
                        <Upload className="mr-1.5 size-3.5" />{archiveRequestEvidence ? "Replace" : "Upload"}
                        <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(event) => handleRequestEvidenceUpload(event.target.files?.[0])} />
                      </label>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">This creates a new canonical “Archive Request Evidence” record. It is not selected from Vehicle evidence.</p>
                    {uploadError ? <p className="mt-2 text-[11px] text-destructive">{uploadError}</p> : null}
                  </div>
                </FieldComponent>
              ) : null}

              <FieldComponent label="Reason (optional)">
                <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional context supplied with the request" />
              </FieldComponent>

              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Performed By</p>
                <p className="mt-1 text-sm">{performedBy}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Taken from the current TES identity when available. The labeled fallback is temporary for this prototype.</p>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-4 text-sm">
                <p>The registration record will be archived without deleting the original record or its business evidence.</p>
                <p className="mt-2 text-xs text-muted-foreground">The archive request evidence is stored separately as canonical evidence of the instruction itself.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Requested By</p><p className="mt-1 text-sm">{request.requestedBy}</p></div>
                <div className="rounded-lg border border-border p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Request Source</p><p className="mt-1 text-sm">{request.requestSource}</p></div>
                <div className="rounded-lg border border-border p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Request Reference</p><p className="mt-1 text-sm break-words">{request.requestReference || "Not provided"}</p></div>
                <div className="rounded-lg border border-border p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Archive Request Evidence ID</p><p className="mt-1 font-mono text-[11px] break-all">{request.archiveRequestEvidenceId}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{archiveRequestEvidence?.fileName}</p></div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm font-semibold">Final confirmation required</p>
                <p className="mt-1 text-xs text-muted-foreground">This archives the registration record and preserves the original record, business evidence, and archive-request evidence.</p>
              </div>
              <FieldComponent label='Type "ARCHIVE" to confirm' required>
                <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="ARCHIVE" autoComplete="off" />
              </FieldComponent>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-4">
          <div>{step > 1 ? <Button variant="outline" onClick={goBack}>Back</Button> : <Button variant="outline" onClick={onCancel}>Cancel</Button>}</div>
          <div className="flex gap-2">
            {step === 1 ? <Button disabled={!canContinue} onClick={() => setStep(2)}>Continue</Button> : null}
            {step === 2 ? <Button onClick={() => setStep(3)}>Continue</Button> : null}
            {step === 3 ? <Button variant="destructive" disabled={confirmation !== "ARCHIVE"} onClick={() => onArchive(request, archiveRequestEvidence!, performedBy, isoNow())}>ARCHIVE</Button> : null}
          </div>
        </div>
      </section>
    </div>
  )
}


type RegistrationFieldComponent = ComponentType<{ label: string; children: ReactNode; required?: boolean; className?: string }>
type RegistrationStatusPillComponent = ComponentType<{ value: string }>
type RegistrationSectionTitleComponent = ComponentType<{ title: string; description?: string; action?: ReactNode }>
type RegistrationEmptyStateComponent = ComponentType<{ title: string; description: string; action?: ReactNode }>
type RegistrationModalShellComponent = ComponentType<{ title: string; subtitle: string; onClose: () => void; footer: ReactNode; children: ReactNode }>
type RegistrationModalOCRStripComponent = ComponentType<{ title: string; description: string; onStartOCR: () => void }>
type RegistrationModalSectionLabelComponent = ComponentType<{ children: ReactNode }>
type RegistrationModalFieldGridComponent = ComponentType<{ children: ReactNode }>
type RegistrationModalFieldComponent = ComponentType<{ label: string; required?: boolean; className?: string; children: ReactNode }>
type RegistrationModalEvidenceCardComponent = ComponentType<{ label: string; attached: boolean; attachedNote?: string; onAttach: () => void }>
type RegistrationModalFooterComponent = ComponentType<{ note: string; onCancel: () => void; onSave: () => void; saveLabel: string }>

export interface RegistrationTabProps {
  companyId: string
  store: VehicleStore
  vehicle: VehicleRecord
  records: VehicleRegistrationRecord[]
  evidence: EvidenceRecord[]
  onStoreChange: (store: VehicleStore) => void
  onStartOCR: (documentType: string) => void
  pendingEvidence: { id: string; documentType: string; values: Record<string, unknown> } | null
  clearPendingEvidence: () => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  onOpenEvidence: (item: EvidenceRecord) => void
  FieldComponent: RegistrationFieldComponent
  StatusPillComponent: RegistrationStatusPillComponent
  SectionTitleComponent: RegistrationSectionTitleComponent
  EmptyStateComponent: RegistrationEmptyStateComponent
  ModalShellComponent: RegistrationModalShellComponent
  ModalOCRStripComponent: RegistrationModalOCRStripComponent
  ModalSectionLabelComponent: RegistrationModalSectionLabelComponent
  ModalFieldGridComponent: RegistrationModalFieldGridComponent
  ModalFieldComponent: RegistrationModalFieldComponent
  ModalEvidenceCardComponent: RegistrationModalEvidenceCardComponent
  ModalFooterComponent: RegistrationModalFooterComponent
  modalFieldInputClass: string
  selectClass: string
  money: (value: string) => string
  todayISO: () => string
  addVehicleActivity: (companyId: string, vehicleId: string, entry: { event: string; detail: string; section: string }) => void
}

export function RegistrationTab({ companyId, store, vehicle, records, evidence, onStoreChange, onStartOCR, pendingEvidence, clearPendingEvidence, setError, setNotice, onOpenEvidence, FieldComponent, StatusPillComponent, SectionTitleComponent, EmptyStateComponent, ModalShellComponent, ModalOCRStripComponent, ModalSectionLabelComponent, ModalFieldGridComponent, ModalFieldComponent, ModalEvidenceCardComponent, ModalFooterComponent, modalFieldInputClass, selectClass, money, todayISO, addVehicleActivity }: RegistrationTabProps) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<VehicleRegistrationRecord | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<VehicleRegistrationRecord | null>(null)
  const [archiveRecord, setArchiveRecord] = useState<VehicleRegistrationRecord | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const visible = records.filter((record) => showArchived || !record.archived).sort((a, b) => b.registrationDate.localeCompare(a.registrationDate))
  const archive = (record: VehicleRegistrationRecord, request: RegistrationArchiveRequest, requestEvidence: EvidenceRecord, performedBy: string, archivedAt: string) => {
    const next = {
      ...store,
      registrationRecords: store.registrationRecords.map((item) => item.id === record.id ? { ...item, archived: true, updatedAt: archivedAt } : item),
      // Archive Request Evidence is canonical evidence, but deliberately NOT Vehicle evidence.
      evidence: [requestEvidence, ...store.evidence],
    }
    const details = [
      `Archived registration record ${record.id}.`,
      `Requested By: ${request.requestedBy}.`,
      `Request Source: ${request.requestSource}.`,
      `Request Reference: ${request.requestReference || "Not provided"}.`,
      `Archive Request Evidence ID: ${request.archiveRequestEvidenceId}.`,
      `Performed By: ${performedBy}.`,
      `Archive Timestamp: ${archivedAt}.`,
      `Reason: ${request.reason || "Not provided"}.`,
      "Original registration record and business evidence preserved.",
    ].join(" ")
    try {
      saveVehicleStore(companyId, next); onStoreChange(next)
      recordAuditEvent({ action: "ARCHIVE", entityType: "Vehicle", entityId: record.id, companyId, actor: performedBy, role: "", details })
      addVehicleActivity(companyId, vehicle.id, { event: "ARCHIVE_REGISTRATION", detail: details, section: "registration" })
      setArchiveRecord(null); setSelectedRecord(null)
      setNotice("Record archived. The record, business evidence, and archive request evidence remain preserved in TES.")
    } catch (err) { setError(err instanceof Error ? err.message : "Could not archive registration.") }
  }
  const evidenceById = (id?: string) => id ? evidence.find((item) => item.id === id) : undefined
  const evidenceItem = (label: string, id: string | undefined, required: boolean) => {
    const item = evidenceById(id)
    return item ? <button key={label} type="button" onClick={() => onOpenEvidence(item)} className="flex w-full items-start gap-3 rounded-lg border border-border bg-background p-3 text-left hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/30"><FileText className="mt-0.5 size-5 shrink-0 text-primary" /><span className="min-w-0"><span className="block text-xs font-semibold">{label}</span><span className="mt-1 block truncate text-sm">{item.fileName}</span><span className="mt-1 block text-[11px] text-muted-foreground">{item.documentType} · Attached</span></span></button> : <div key={label} className="rounded-lg border border-dashed border-border p-3"><p className="text-xs font-semibold">{label}</p><p className="mt-1 text-xs text-muted-foreground">{required ? "Required · Missing" : "Not attached"}</p></div>
  }
  return <div className="space-y-3">
    <Card><SectionTitleComponent title="Registration" description="Historical registrations; current plate comes from the active registration." action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide History" : "Show History"}</Button><Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}><Plus className="mr-1.5 size-3.5" />Add Registration</Button></div>} /></Card>
    {visible.length === 0 ? <EmptyStateComponent title="No registration records" description="Registration Document is mandatory for every registration. Prorate PSV additionally requires a Cab Card." action={<Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 size-4" />Add Registration</Button>} /> : <div className="space-y-2">{visible.map((record) => <Card key={record.id} className={`${record.archived ? "opacity-70" : ""} cursor-pointer hover:bg-muted/20 transition-colors`} onClick={() => setSelectedRecord(record)}><div className="flex items-center justify-between border-b px-4 py-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.registrationType}</h3><StatusPillComponent value={registrationStatus(record)} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div><ChevronRight className="size-4 text-muted-foreground" /></div><div className="grid gap-3 p-4 md:grid-cols-4"><ReadOnlyField label="State / Province" value={`${getJurisdictionLabel(record.stateProvince)} (${record.stateProvince})`} /><ReadOnlyField label="Plate" value={record.plate || "—"} /><ReadOnlyField label="Registration Date" value={record.registrationDate || "—"} /><ReadOnlyField label="Expiry Date" value={isContinuousRegistration(vehicle, record.registrationType) ? "Continuous" : record.expiryDate || "—"} /><ReadOnlyField label="Registration Document" value={record.registrationDocumentEvidenceId ? "Attached" : "Missing"} /><ReadOnlyField label="Cab Card" value={record.cabCardEvidenceId ? "Attached" : record.registrationType === "Prorate PSV" ? "Missing" : "Not required by rule"} /></div></Card>)}</div>}
    {selectedRecord ? <TESRecordOverlay open title={selectedRecord.registrationType} subtitle="Registration" context={`Unit ${vehicle.unitNumber || "—"} · ${getJurisdictionLabel(selectedRecord.stateProvince)} · ${registrationStatus(selectedRecord)}`} onClose={() => { if (!archiveRecord) setSelectedRecord(null) }} ariaLabel={`Registration record ${selectedRecord.id}`} actions={<><Button variant="outline" onClick={() => { setEditing(selectedRecord); setSelectedRecord(null); setShowForm(true) }} className="border-primary-foreground/55 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"><Edit3 className="mr-1.5 size-3.5" />Edit</Button>{!selectedRecord.archived ? <button type="button" title="Archive record" aria-label="Archive record" onClick={() => setArchiveRecord(selectedRecord)} className="flex size-9 items-center justify-center rounded-md border border-primary-foreground/35 text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"><Archive className="size-4" /></button> : null}</>}>
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <section className="rounded-xl border border-border bg-card"><div className="border-b border-border px-4 py-3 sm:px-5"><h3 className="text-sm font-semibold">Registration Information</h3><p className="mt-0.5 text-xs text-muted-foreground">Read-only structured record.</p></div><div className="grid gap-x-6 gap-y-5 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4"><ReadOnlyField label="Registration Type" value={selectedRecord.registrationType} /><ReadOnlyField label="Jurisdiction" value={`${getJurisdictionLabel(selectedRecord.stateProvince)} (${selectedRecord.stateProvince})`} /><ReadOnlyField label="Plate" value={selectedRecord.plate || "—"} /><ReadOnlyField label="Registration Date" value={selectedRecord.registrationDate || "—"} /><ReadOnlyField label="Expiry Date" value={isContinuousRegistration(vehicle, selectedRecord.registrationType) ? "Continuous" : selectedRecord.expiryDate || "—"} />{selectedRecord.price ? <ReadOnlyField label="Price" value={money(selectedRecord.price)} /> : null}<div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</p><div className="mt-1"><StatusPillComponent value={registrationStatus(selectedRecord)} /></div></div><ReadOnlyField label="Record ID" value={selectedRecord.id} /></div></section>
        <section className="rounded-xl border border-border bg-card"><div className="border-b border-border px-4 py-3 sm:px-5"><h3 className="text-sm font-semibold">Evidence</h3><p className="mt-0.5 text-xs text-muted-foreground">Source documents linked to this Registration record.</p></div><div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">{evidenceItem("Registration Document", selectedRecord.registrationDocumentEvidenceId, true)}{evidenceItem("Cab Card", selectedRecord.cabCardEvidenceId, selectedRecord.registrationType === "Prorate PSV")}</div></section>
      </div>
    </TESRecordOverlay> : null}
    {archiveRecord ? <RegistrationArchiveDialog companyId={companyId} record={archiveRecord} vehicle={vehicle} evidence={evidence} onCancel={() => setArchiveRecord(null)} onArchive={(request, requestEvidence, performedBy, archivedAt) => archive(archiveRecord, request, requestEvidence, performedBy, archivedAt)} FieldComponent={FieldComponent} selectClass={selectClass} todayISO={todayISO} /> : null}
    {showForm ? <RegistrationForm companyId={companyId} store={store} vehicle={vehicle} initial={editing} pendingEvidence={pendingEvidence} onStartOCR={onStartOCR} clearPendingEvidence={clearPendingEvidence} onClose={() => setShowForm(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} ModalShellComponent={ModalShellComponent} ModalOCRStripComponent={ModalOCRStripComponent} ModalSectionLabelComponent={ModalSectionLabelComponent} ModalFieldGridComponent={ModalFieldGridComponent} ModalFieldComponent={ModalFieldComponent} ModalEvidenceCardComponent={ModalEvidenceCardComponent} ModalFooterComponent={ModalFooterComponent} modalFieldInputClass={modalFieldInputClass} /> : null}
  </div>
}
function RegistrationForm({ companyId, store, vehicle, initial, pendingEvidence, clearPendingEvidence, onStartOCR, onClose, onStoreChange, setError, setNotice, ModalShellComponent, ModalOCRStripComponent, ModalSectionLabelComponent, ModalFieldGridComponent, ModalFieldComponent, ModalEvidenceCardComponent, ModalFooterComponent, modalFieldInputClass }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehicleRegistrationRecord | null; pendingEvidence: { id: string; documentType: string; values: Record<string, unknown> } | null; clearPendingEvidence: () => void; onStartOCR: (documentType: string) => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void; ModalShellComponent: RegistrationModalShellComponent; ModalOCRStripComponent: RegistrationModalOCRStripComponent; ModalSectionLabelComponent: RegistrationModalSectionLabelComponent; ModalFieldGridComponent: RegistrationModalFieldGridComponent; ModalFieldComponent: RegistrationModalFieldComponent; ModalEvidenceCardComponent: RegistrationModalEvidenceCardComponent; ModalFooterComponent: RegistrationModalFooterComponent; modalFieldInputClass: string }) {
  const [registrationType, setRegistrationType] = useState(initial?.registrationType || "Prorate PSV")
  const [stateProvince, setStateProvince] = useState(initial?.stateProvince || "")
  const [plate, setPlate] = useState(initial?.plate || "")
  const [registrationDate, setRegistrationDate] = useState(initial?.registrationDate || "")
  const [expiryDate, setExpiryDate] = useState(initial?.expiryDate || "")
  const [price, setPrice] = useState(initial?.price || "")
  const [status, setStatus] = useState<VehicleRegistrationRecord["status"]>(initial?.status || "Active")
  const [registrationDocumentEvidenceId, setRegistrationDocumentEvidenceId] = useState(initial?.registrationDocumentEvidenceId || "")
  const [cabCardEvidenceId, setCabCardEvidenceId] = useState(initial?.cabCardEvidenceId || "")
  const [docTarget, setDocTarget] = useState<"registration" | "cabCard">("registration")
  useEffect(() => { if (pendingEvidence) {
    if (docTarget === "cabCard") setCabCardEvidenceId(pendingEvidence.id); else setRegistrationDocumentEvidenceId(pendingEvidence.id)
    const values = pendingEvidence.values
    if (typeof values.stateProvince === "string") setStateProvince(values.stateProvince)
    if (typeof values.plate === "string") setPlate(values.plate)
    if (typeof values.registrationDate === "string") setRegistrationDate(values.registrationDate)
    if (typeof values.expiryDate === "string") setExpiryDate(values.expiryDate)
    clearPendingEvidence()
  } }, [pendingEvidence, docTarget, clearPendingEvidence])
  const trailer = isTrailer(vehicle.equipmentType)
  useEffect(() => { if (trailer && registrationType !== "Continuous") setRegistrationType("Continuous") }, [trailer])
  const continuous = isContinuousRegistration(vehicle, registrationType)
  const save = () => {
    if (!stateProvince) return setError("State / Province is required.")
    if (!plate) return setError("Plate is required.")
    if (!registrationDate) return setError("Registration Date is required.")
    if (!registrationDocumentEvidenceId) return setError("Registration Document is mandatory for every registration.")
    if (registrationType === "Prorate PSV" && !cabCardEvidenceId) return setError("Cab Card is required for Prorate PSV.")
    const now = isoNow()
    const record: VehicleRegistrationRecord = { id: initial?.id || createId("REG"), vehicleId: vehicle.id, registrationType, stateProvince, registrationDate, expiryDate: continuous ? "Continuous" : expiryDate, plate, price, status, registrationDocumentEvidenceId, cabCardEvidenceId: registrationType === "Prorate PSV" ? cabCardEvidenceId : undefined, archived: initial?.archived || false, createdAt: initial?.createdAt || now, updatedAt: now }
    const next = { ...store, registrationRecords: initial ? store.registrationRecords.map((item) => item.id === initial.id ? record : item) : [record, ...store.registrationRecords] }
    try { saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: initial ? "UPDATE" : "CREATE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `${initial ? "Updated" : "Created"} registration record ${record.id}.` }); setNotice("Registration saved."); onClose() } catch (err) { setError(err instanceof Error ? err.message : "Registration could not be saved.") }
  }
  return (
    <ModalShellComponent
      title={`${initial ? "Edit" : "Add"} Registration`}
      subtitle="OCR first. Registration Document is mandatory; Cab Card is conditional."
      onClose={onClose}
      footer={<ModalFooterComponent note="OCR first. Registration Document is always required." onCancel={onClose} onSave={save} saveLabel="Save Registration" />}
    >
      <ModalOCRStripComponent
        title="Start with Registration Document"
        description="Capture the source before entering State / Province, Plate and dates."
        onStartOCR={() => { setDocTarget("registration"); onStartOCR("Registration Document") }}
      />

      <ModalSectionLabelComponent>Registration Details</ModalSectionLabelComponent>
      <ModalFieldGridComponent>
        <ModalFieldComponent label="Registration Type" required>
          <select className={modalFieldInputClass} value={registrationType} disabled={trailer} onChange={(e) => setRegistrationType(e.target.value)}>
            {REGISTRATION_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
          {trailer ? <p className="mt-1 text-[10px] text-muted-foreground">Trailers use Continuous registration. No expiry date required.</p> : null}
        </ModalFieldComponent>
        <ModalFieldComponent label="Registration Status">
          <select className={modalFieldInputClass} value={status} onChange={(e) => setStatus(e.target.value as VehicleRegistrationRecord["status"])}>
            {["Draft", "Active", "Expired", "Replaced", "Cancelled"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="State / Province" required>
          <select className={modalFieldInputClass} value={stateProvince} onChange={(e) => setStateProvince(e.target.value)}>
            <option value="">Select…</option>
            {JURISDICTIONS.map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Plate" required>
          <Input className={modalFieldInputClass} value={plate} onChange={(e) => setPlate(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Registration Date" required>
          <Input className={modalFieldInputClass} type="date" value={registrationDate} onChange={(e) => setRegistrationDate(e.target.value)} />
        </ModalFieldComponent>
        {!trailer ? (
          <ModalFieldComponent label="Expiry Date">
            <Input className={modalFieldInputClass} type="date" value={continuous ? "" : expiryDate} disabled={continuous} onChange={(e) => setExpiryDate(e.target.value)} />
          </ModalFieldComponent>
        ) : null}
        <ModalFieldComponent label="Price" className="col-span-2">
          <Input className={modalFieldInputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
        </ModalFieldComponent>
      </ModalFieldGridComponent>

      <ModalSectionLabelComponent>Evidence</ModalSectionLabelComponent>
      <div className="px-6 grid grid-cols-2 gap-3 pb-4">
        <ModalEvidenceCardComponent
          label="Registration Document *"
          attached={Boolean(registrationDocumentEvidenceId)}
          onAttach={() => { setDocTarget("registration"); onStartOCR("Registration Document") }}
        />
        {registrationType === "Prorate PSV" ? (
          <ModalEvidenceCardComponent
            label="Cab Card *"
            attached={Boolean(cabCardEvidenceId)}
            onAttach={() => { setDocTarget("cabCard"); onStartOCR("Cab Card") }}
          />
        ) : null}
      </div>
    </ModalShellComponent>
  )
}
