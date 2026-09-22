"use client"

import { useEffect, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { Archive, Edit3, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { createId, isoNow, saveVehicleStore } from "@/lib/vehicle-data"
import type { VehicleStore, VehiclePermitRecord } from "@/lib/vehicle-data"
import { recordAuditEvent } from "@/lib/audit-logger"
import { JURISDICTIONS } from "@/lib/jurisdictions"
import type { VehicleRecord } from "@/src/types"
import type { EvidenceRecord } from "@/types/evidence"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { ISODateInput } from "@/src/components/shared/ISODateInput"

const PERMIT_TYPES = [
  "Transponder (Annual)",
  "Transponder (Single Crossing)",
  "New Mexico WDT",
  "New York HUT",
  "KYU",
  "Oregon WMT",
  "Connecticut WDF",
  "California CTC",
  "ARBER",
  "Dangerous Goods Registration",
  "Trip Permit",
  "Fuel Permit",
  "OS Permit",
  "OW Permit",
  "OSOW Permit",
  "Alcohol Transportation Permit",
  "Hazmat Transportation Permit",
  "LCV",
  "Axle Lift",
  "TAC Permit",
  "Other",
]

function permitDisplayStatus(record: VehiclePermitRecord) {
  if (record.status === "Cancelled") return "Cancelled"
  if (record.startDate && new Date(`${record.startDate}T00:00:00`) > new Date()) return "Upcoming"
  if (record.expiryDate && new Date(`${record.expiryDate}T23:59:59`) < new Date()) return "Expired"
  if (record.expiryDate) {
    const days = (new Date(`${record.expiryDate}T23:59:59`).getTime() - Date.now()) / 86400000
    if (days <= 30) return "Expiring Soon"
  }
  return "Active"
}

type PermitStatusPillComponent = ComponentType<{ value: string }>
type PermitSectionTitleComponent = ComponentType<{ title: string; description?: string; action?: ReactNode }>
type PermitEmptyStateComponent = ComponentType<{ title: string; description: string; action?: ReactNode }>
type PermitModalShellComponent = ComponentType<{ title: string; subtitle: string; onClose: () => void; footer: ReactNode; children: ReactNode }>
type PermitModalOCRStripComponent = ComponentType<{ title: string; description: string; onStartOCR: () => void }>
type PermitModalSectionLabelComponent = ComponentType<{ children: ReactNode }>
type PermitModalFieldGridComponent = ComponentType<{ children: ReactNode }>
type PermitModalFieldComponent = ComponentType<{ label: string; required?: boolean; className?: string; children: ReactNode }>
type PermitModalEvidenceCardComponent = ComponentType<{ label: string; attached: boolean; attachedNote?: string; onAttach: () => void }>
type PermitModalFooterComponent = ComponentType<{ note: string; onCancel: () => void; onSave: () => void; saveLabel: string }>

export interface PermitTabProps {
  companyId: string
  store: VehicleStore
  vehicle: VehicleRecord
  records: VehiclePermitRecord[]
  evidence: EvidenceRecord[]
  onStoreChange: (store: VehicleStore) => void
  onStartOCR: (documentType: string) => void
  onAttachEvidence: (documentType: string) => void
  pendingEvidenceId: string | null
  clearPendingEvidence: () => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  onRecordClick?: (record: VehiclePermitRecord) => void
  StatusPillComponent: PermitStatusPillComponent
  SectionTitleComponent: PermitSectionTitleComponent
  EmptyStateComponent: PermitEmptyStateComponent
  ModalShellComponent: PermitModalShellComponent
  ModalOCRStripComponent: PermitModalOCRStripComponent
  ModalSectionLabelComponent: PermitModalSectionLabelComponent
  ModalFieldGridComponent: PermitModalFieldGridComponent
  ModalFieldComponent: PermitModalFieldComponent
  ModalEvidenceCardComponent: PermitModalEvidenceCardComponent
  ModalFooterComponent: PermitModalFooterComponent
  modalFieldInputClass: string
}

export function PermitTab({ companyId, store, vehicle, records, evidence, onStoreChange, onStartOCR, onAttachEvidence, pendingEvidenceId, clearPendingEvidence, setError, setNotice, onRecordClick, StatusPillComponent, SectionTitleComponent, EmptyStateComponent, ModalShellComponent, ModalOCRStripComponent, ModalSectionLabelComponent, ModalFieldGridComponent, ModalFieldComponent, ModalEvidenceCardComponent, ModalFooterComponent, modalFieldInputClass }: PermitTabProps) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<VehiclePermitRecord | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const visible = records.filter((record) => showArchived || !record.archived)
  const archive = (record: VehiclePermitRecord) => { const next = { ...store, permitRecords: store.permitRecords.map((item) => item.id === record.id ? { ...item, archived: true, updatedAt: isoNow() } : item) }; try { saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: "ARCHIVE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `Archived permit record ${record.id}.` }); setNotice("Permit archived.") } catch (err) { setError(err instanceof Error ? err.message : "Could not archive permit.") } }
  return <div className="space-y-3"><Card><SectionTitleComponent title="Permits" description="Existing permit fields and derived status behavior are preserved." action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide History" : "Show History"}</Button><Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}><Plus className="mr-1.5 size-3.5" />Add Permit</Button></div>} /></Card>
    {visible.length === 0 ? <EmptyStateComponent title="No permit records" description="Begin permit capture with OCR/document source." action={<Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 size-4" />Add Permit</Button>} /> : <div className="space-y-2">{visible.map((record) => <Card key={record.id} className={`${record.archived ? "opacity-70" : ""} cursor-pointer hover:bg-muted/20 transition-colors`} onClick={() => onRecordClick?.(record)}><div className="flex items-center justify-between border-b px-4 py-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.permitType === "Other" ? record.customPermitType : record.permitType}</h3><StatusPillComponent value={permitDisplayStatus(record)} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditing(record); setShowForm(true) }}><Edit3 className="mr-1 size-3" />Edit</Button>{!record.archived ? <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); archive(record) }}><Archive className="mr-1 size-3" />Archive</Button> : null}</div></div><div className="grid gap-3 p-4 md:grid-cols-4"><ReadOnlyField label="Permit #" value={record.permitNumber || "—"} /><ReadOnlyField label="Jurisdiction" value={record.jurisdiction || "—"} /><ReadOnlyField label="Start" value={record.startDate || "—"} /><ReadOnlyField label="Expiry" value={record.expiryDate || "—"} /><ReadOnlyField label="Evidence" value={record.evidenceIds.length ? `${record.evidenceIds.length} attached` : "Missing"} /><ReadOnlyField label="Notes" value={record.notes || "—"} /></div></Card>)}</div>}
    {showForm ? <PermitForm companyId={companyId} store={store} vehicle={vehicle} initial={editing} pendingEvidenceId={pendingEvidenceId} clearPendingEvidence={clearPendingEvidence} onStartOCR={onStartOCR} onAttachEvidence={onAttachEvidence} onClose={() => setShowForm(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} ModalShellComponent={ModalShellComponent} ModalOCRStripComponent={ModalOCRStripComponent} ModalSectionLabelComponent={ModalSectionLabelComponent} ModalFieldGridComponent={ModalFieldGridComponent} ModalFieldComponent={ModalFieldComponent} ModalEvidenceCardComponent={ModalEvidenceCardComponent} ModalFooterComponent={ModalFooterComponent} modalFieldInputClass={modalFieldInputClass} /> : null}
  </div>
}

function PermitForm({ companyId, store, vehicle, initial, pendingEvidenceId, clearPendingEvidence, onStartOCR, onAttachEvidence, onClose, onStoreChange, setError, setNotice, ModalShellComponent, ModalOCRStripComponent, ModalSectionLabelComponent, ModalFieldGridComponent, ModalFieldComponent, ModalEvidenceCardComponent, ModalFooterComponent, modalFieldInputClass }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehiclePermitRecord | null; pendingEvidenceId: string | null; clearPendingEvidence: () => void; onStartOCR: (documentType: string) => void; onAttachEvidence: (documentType: string) => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void; ModalShellComponent: PermitModalShellComponent; ModalOCRStripComponent: PermitModalOCRStripComponent; ModalSectionLabelComponent: PermitModalSectionLabelComponent; ModalFieldGridComponent: PermitModalFieldGridComponent; ModalFieldComponent: PermitModalFieldComponent; ModalEvidenceCardComponent: PermitModalEvidenceCardComponent; ModalFooterComponent: PermitModalFooterComponent; modalFieldInputClass: string }) {
  const [permitType, setPermitType] = useState(initial?.permitType || PERMIT_TYPES[0])
  const [customPermitType, setCustomPermitType] = useState(initial?.customPermitType || "")
  const [permitNumber, setPermitNumber] = useState(initial?.permitNumber || "")
  const [jurisdiction, setJurisdiction] = useState(initial?.jurisdiction || "")
  const [startDate, setStartDate] = useState(initial?.startDate || "")
  const [expiryDate, setExpiryDate] = useState(initial?.expiryDate || "")
  const [status, setStatus] = useState<VehiclePermitRecord["status"]>(initial?.status || "Active")
  const [notes, setNotes] = useState(initial?.notes || "")
  const [evidenceIds, setEvidenceIds] = useState<string[]>(initial?.evidenceIds || [])
  useEffect(() => { if (pendingEvidenceId) { setEvidenceIds((current) => Array.from(new Set([...current, pendingEvidenceId]))); clearPendingEvidence() } }, [pendingEvidenceId, clearPendingEvidence])
  const save = () => { if (permitType === "Other" && !customPermitType.trim()) return setError("Provide a custom Permit Type description."); const now = isoNow(); const record: VehiclePermitRecord = { id: initial?.id || createId("PMT"), vehicleId: vehicle.id, permitType, customPermitType, permitNumber, jurisdiction, startDate, expiryDate, status, evidenceIds, notes, archived: initial?.archived || false, createdAt: initial?.createdAt || now, updatedAt: now }; const next = { ...store, permitRecords: initial ? store.permitRecords.map((item) => item.id === initial.id ? record : item) : [record, ...store.permitRecords] }; try { saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: initial ? "UPDATE" : "CREATE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `${initial ? "Updated" : "Created"} permit record ${record.id}.` }); setNotice("Permit saved."); onClose() } catch (err) { setError(err instanceof Error ? err.message : "Permit could not be saved.") } }
  return (
    <ModalShellComponent
      title={`${initial ? "Edit" : "Add"} Permit`}
      subtitle="OCR/document capture is the first action."
      onClose={onClose}
      footer={<ModalFooterComponent note="Upload the permit document or decal image." onCancel={onClose} onSave={save} saveLabel="Save Permit" />}
    >
      <ModalOCRStripComponent
        title="Start with Permit Document"
        description="Review the source before committing permit fields."
        onStartOCR={() => onStartOCR("Permit Document")}
      />

      <ModalSectionLabelComponent>Permit Details</ModalSectionLabelComponent>
      <ModalFieldGridComponent>
        <ModalFieldComponent label="Permit Type" required>
          <select className={modalFieldInputClass} value={permitType} onChange={(e) => setPermitType(e.target.value)}>
            {PERMIT_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Permit #">
          <Input className={modalFieldInputClass} value={permitNumber} onChange={(e) => setPermitNumber(e.target.value)} />
        </ModalFieldComponent>
        {permitType === "Other" ? (
          <ModalFieldComponent label="Custom Permit Type" className="col-span-2">
            <Input className={modalFieldInputClass} value={customPermitType} onChange={(e) => setCustomPermitType(e.target.value)} />
          </ModalFieldComponent>
        ) : null}
        <ModalFieldComponent label="Jurisdiction">
          <select className={modalFieldInputClass} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
            <option value="">Select…</option>
            {JURISDICTIONS.map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Status">
          <select className={modalFieldInputClass} value={status} onChange={(e) => setStatus(e.target.value as VehiclePermitRecord["status"])}>
            <option>Active</option>
            <option>Cancelled</option>
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Start Date">
          <ISODateInput className={modalFieldInputClass} value={startDate} onValueChange={setStartDate} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Expiry Date">
          <ISODateInput className={modalFieldInputClass} value={expiryDate} onValueChange={setExpiryDate} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Notes" className="col-span-2">
          <Textarea rows={3} className={modalFieldInputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </ModalFieldComponent>
      </ModalFieldGridComponent>

      <ModalSectionLabelComponent>Evidence</ModalSectionLabelComponent>
      <div className="px-6 grid grid-cols-2 gap-3 pb-4">
        <ModalEvidenceCardComponent
          label="Permit Document"
          attached={evidenceIds.length > 0}
          attachedNote={evidenceIds.length ? `${evidenceIds.length} attached` : undefined}
          onAttach={() => onAttachEvidence("Permit Document")}
        />
      </div>
    </ModalShellComponent>
  )
}
