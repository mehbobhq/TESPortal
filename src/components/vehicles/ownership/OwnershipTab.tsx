"use client"

import { useEffect, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { Archive, Edit3, Plus, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { validateCompany } from "@/lib/company-validation"
import { createId, isoNow, saveVehicleStore } from "@/lib/vehicle-data"
import type { VehicleStore, VehicleOwnershipRecord } from "@/lib/vehicle-data"
import { recordAuditEvent } from "@/lib/audit-logger"
import type { Company, VehicleRecord } from "@/src/types"
import type { EvidenceRecord } from "@/types/evidence"
import { EntityPicker } from "@/src/components/shared/EntityPicker"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"

const inputClass = "h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
const selectClass = inputClass

type OwnershipFieldComponent = ComponentType<{ label: string; children: ReactNode; required?: boolean; className?: string }>
type OwnershipDividerComponent = ComponentType
type OwnershipSectionTitleComponent = ComponentType<{ title: string; description?: string; action?: ReactNode }>
type OwnershipEmptyStateComponent = ComponentType<{ title: string; description: string; action?: ReactNode }>
type OwnershipStatusPillComponent = ComponentType<{ value: string }>

export interface OwnershipTabProps {
  companyId: string
  store: VehicleStore
  vehicle: VehicleRecord
  records: VehicleOwnershipRecord[]
  evidence: EvidenceRecord[]
  onStoreChange: (store: VehicleStore) => void
  onStartOCR: (documentType: string) => void
  pendingEvidenceId: string | null
  clearPendingEvidence: () => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  FieldComponent: OwnershipFieldComponent
  DividerComponent: OwnershipDividerComponent
  SectionTitleComponent: OwnershipSectionTitleComponent
  EmptyStateComponent: OwnershipEmptyStateComponent
  StatusPillComponent: OwnershipStatusPillComponent
  readCompanies: () => Company[]
  money: (value: string) => string
  addMonthsISO: (dateValue: string, monthsValue: string) => string
}

export function OwnershipTab({ companyId, store, vehicle, records, evidence, onStoreChange, onStartOCR, pendingEvidenceId, clearPendingEvidence, setError, setNotice, FieldComponent, DividerComponent, SectionTitleComponent, EmptyStateComponent, StatusPillComponent, readCompanies, money, addMonthsISO }: OwnershipTabProps) {
  const [editing, setEditing] = useState<VehicleOwnershipRecord | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const visible = records.filter((record) => showArchived || !record.archived)
  const archive = (record: VehicleOwnershipRecord) => {
    try { const next = { ...store, ownershipRecords: store.ownershipRecords.map((item) => item.id === record.id ? { ...item, archived: true, updatedAt: isoNow() } : item) }; saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: "ARCHIVE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `Archived ownership record ${record.id}.` }); setNotice("Ownership record archived.") } catch (err) { setError(err instanceof Error ? err.message : "Could not archive ownership record.") }
  }
  return <div className="space-y-3"><Card><SectionTitleComponent title="Ownership" description="Historical ownership relationships and supporting documents." action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide Archived" : "Show History"}</Button><Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}><Plus className="mr-1.5 size-3.5" />Add Ownership</Button></div>} /></Card>
    {visible.length === 0 ? <EmptyStateComponent title="No ownership records" description="Create a historical ownership record. Required source documents are presented inside the ownership workflow." action={<Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 size-4" />Add Ownership</Button>} /> : <div className="space-y-2">{visible.map((record) => <OwnershipRecordCard key={record.id} StatusPillComponent={StatusPillComponent} money={money} record={record} evidence={evidence} onEdit={() => { setEditing(record); setShowForm(true) }} onArchive={() => archive(record)} />)}</div>}
    {showForm ? <OwnershipForm companyId={companyId} FieldComponent={FieldComponent} DividerComponent={DividerComponent} readCompanies={readCompanies} addMonthsISO={addMonthsISO} vehicle={vehicle} initial={editing} store={store} pendingEvidenceId={pendingEvidenceId} onStartOCR={onStartOCR} clearPendingEvidence={clearPendingEvidence} onClose={() => setShowForm(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} /> : null}
  </div>
}

function OwnershipRecordCard({ record, evidence, onEdit, onArchive, StatusPillComponent, money }: { record: VehicleOwnershipRecord; evidence: EvidenceRecord[]; onEdit: () => void; onArchive: () => void; StatusPillComponent: OwnershipStatusPillComponent; money: (value: string) => string }) {
  const owners = record.legalOwners.length ? record.legalOwners.join(", ") : "—"
  return <Card className={record.archived ? "opacity-70" : ""}><div className="flex items-start justify-between gap-3 border-b px-4 py-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.relationship}</h3>{record.leasingStatus ? <StatusPillComponent value={`Leasing: ${record.leasingStatus}`} /> : null}</div><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">Record ID: {record.id}</p></div><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={onEdit}><Edit3 className="mr-1 size-3" />Edit</Button>{!record.archived ? <Button variant="ghost" size="sm" onClick={onArchive}><Archive className="mr-1 size-3" />Archive</Button> : null}</div></div><div className="grid gap-3 p-4 md:grid-cols-4"><ReadOnlyField label="Purchase Date" value={record.purchaseDate || "—"} /><ReadOnlyField label="Purchase Price" value={money(record.purchasePrice)} /><ReadOnlyField label="Ownership Start" value={record.ownershipStartDate || "—"} /><ReadOnlyField label="Ownership End" value={record.ownershipEndDate || "Current"} /><ReadOnlyField label="Legal Owner(s)" value={owners} />{record.leasingCompanyNameSnapshot ? <ReadOnlyField label="Leasing Company" value={record.leasingCompanyNameSnapshot} /> : null}{record.leaseTermMonths ? <ReadOnlyField label="Lease Term" value={`${record.leaseTermMonths} months`} /> : null}{record.leaseEndDate ? <ReadOnlyField label="Lease End Date" value={record.leaseEndDate} /> : null}{record.financingStatus ? <ReadOnlyField label="Financing Status" value={record.financingStatus} /> : null}</div>{evidence.filter((item) => record.evidenceIds.includes(item.id)).length ? <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">{evidence.filter((item) => record.evidenceIds.includes(item.id)).length} ownership document(s) attached.</div> : null}</Card>
}

function OwnershipForm({ companyId, vehicle, initial, store, pendingEvidenceId, onStartOCR, clearPendingEvidence, onClose, onStoreChange, setError, setNotice, FieldComponent, DividerComponent, readCompanies, addMonthsISO }: { companyId: string; vehicle: VehicleRecord; initial: VehicleOwnershipRecord | null; store: VehicleStore; pendingEvidenceId: string | null; onStartOCR: (documentType: string) => void; clearPendingEvidence: () => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void; FieldComponent: OwnershipFieldComponent; DividerComponent: OwnershipDividerComponent; readCompanies: () => Company[]; addMonthsISO: (dateValue: string, monthsValue: string) => string }) {
  const [relationship, setRelationship] = useState<VehicleOwnershipRecord["relationship"]>(initial?.relationship || "Company-Owned")
  const [purchaseDate, setPurchaseDate] = useState(initial?.purchaseDate || "")
  const [purchasePrice, setPurchasePrice] = useState(initial?.purchasePrice || "")
  const [ownershipStartDate, setOwnershipStartDate] = useState(initial?.ownershipStartDate || "")
  const [ownershipEndDate, setOwnershipEndDate] = useState(initial?.ownershipEndDate || "")
  const [legalOwners, setLegalOwners] = useState<string[]>(initial?.legalOwners || [])
  const [legalOwnerInput, setLegalOwnerInput] = useState("")
  const [financingStatus, setFinancingStatus] = useState<VehicleOwnershipRecord["financingStatus"]>(initial?.financingStatus || "No Financing")
  const [leasingStatus, setLeasingStatus] = useState<"Yes" | "No">(initial?.leasingStatus || "No")
  const [leasingCompany, setLeasingCompany] = useState<Company | null>(() => {
    const companies = readCompanies()
    return companies.find((company) => company.id === initial?.leasingCompanyId) || null
  })
  const [leaseTermMonths, setLeaseTermMonths] = useState(initial?.leaseTermMonths || "")
  const [evidenceIds, setEvidenceIds] = useState<string[]>(initial?.evidenceIds || [])
  const leaseEndDate = addMonthsISO(purchaseDate, leaseTermMonths)
  const requiredDocs = relationship === "Leased" || (relationship === "Owner-Operator" && leasingStatus === "Yes") ? ["Bill of Sale", "Lease Agreement", "Power of Attorney"] : relationship === "Owner-Operator" || relationship === "Company-Owned" ? ["Bill of Sale"] : ["Relationship / Rental Evidence"]
  useEffect(() => { if (pendingEvidenceId) { setEvidenceIds((current) => Array.from(new Set([...current, pendingEvidenceId]))); clearPendingEvidence() } }, [pendingEvidenceId, clearPendingEvidence])
  const addOwner = () => { const value = legalOwnerInput.trim(); if (!value) return; setLegalOwners((current) => current.includes(value) ? current : [...current, value]); setLegalOwnerInput("") }
  const searchCompanies = (query: string) => readCompanies().filter((company) => `${company.name} ${company.id}`.toLowerCase().includes(query.trim().toLowerCase())).map((company) => ({ entityType: "Company" as const, id: company.id, label: company.name, secondaryText: company.id, status: company.status }))
  const createNewCompany = () => {
    const name = window.prompt("New Leasing Company name")?.trim() || ""
    if (!name) return
    const companies = readCompanies()
    const validation = validateCompany({ name }, companies)
    if (!validation.isValid || (validation.warning && !window.confirm(validation.message))) { setError(validation.message || "Company already exists or could not be created."); return }
    const company: Company = { id: createId("CMP"), name, kind: "Vendor", status: "Active", tone: "ok" }
    try { localStorage.setItem("tes_companies", JSON.stringify([...companies, company])); setLeasingCompany(company); setNotice("New leasing company created in the canonical Companies store.") } catch { setError("Could not create the leasing company.") }
  }
  const save = () => {
    if (!ownershipStartDate) return setError("Ownership Start Date is required.")
    if (ownershipEndDate && ownershipEndDate < ownershipStartDate) return setError("Ownership End Date cannot precede Ownership Start Date.")
    if ((relationship === "Leased" || (relationship === "Owner-Operator" && leasingStatus === "Yes")) && !leasingCompany) return setError("Select a canonical Leasing Company.")
    if (legalOwners.length === 0) return setError("Add at least one Legal Owner.")
    if (evidenceIds.length === 0) return setError(`Attach at least one ownership document. Expected: ${requiredDocs.join(", ")}.`)
    const now = isoNow()
    const record: VehicleOwnershipRecord = { id: initial?.id || createId("OWN"), vehicleId: vehicle.id, relationship, purchaseDate, purchasePrice, ownershipStartDate, ownershipEndDate, legalOwners, financingStatus: relationship === "Company-Owned" ? financingStatus : undefined, leasingStatus: relationship === "Owner-Operator" ? leasingStatus : undefined, leasingCompanyId: (relationship === "Leased" || (relationship === "Owner-Operator" && leasingStatus === "Yes")) ? leasingCompany?.id : undefined, leasingCompanyNameSnapshot: (relationship === "Leased" || (relationship === "Owner-Operator" && leasingStatus === "Yes")) ? leasingCompany?.name : undefined, leaseTermMonths: (relationship === "Leased" || (relationship === "Owner-Operator" && leasingStatus === "Yes")) ? leaseTermMonths : undefined, leaseEndDate: (relationship === "Leased" || (relationship === "Owner-Operator" && leasingStatus === "Yes")) ? leaseEndDate : undefined, evidenceIds, archived: initial?.archived || false, createdAt: initial?.createdAt || now, updatedAt: now }
    const next = { ...store, ownershipRecords: initial ? store.ownershipRecords.map((item) => item.id === initial.id ? record : item) : [record, ...store.ownershipRecords] }
    try { saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: initial ? "UPDATE" : "CREATE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `${initial ? "Updated" : "Created"} ownership record ${record.id} for Vehicle ${vehicle.id}.` }); setNotice("Ownership record saved."); onClose() } catch (err) { setError(err instanceof Error ? err.message : "Ownership record could not be saved.") }
  }
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"><div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl border bg-card shadow-2xl"><div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-sm font-bold">{initial ? "Edit" : "Add"} Ownership Record</h2><p className="text-[11px] text-muted-foreground">OCR/source evidence belongs inside this workflow.</p></div><button onClick={onClose}><X className="size-4" /></button></div><div className="space-y-4 p-4">
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold">Start with ownership document</p><p className="text-[11px] text-muted-foreground">Required evidence: {requiredDocs.join(" · ")}</p></div><Button size="sm" variant="outline" onClick={() => onStartOCR(requiredDocs[0])}><Upload className="mr-1.5 size-3.5" />Upload / OCR</Button></div></div>
    <FieldComponent label="Asset Relationship" required><select className={selectClass} value={relationship} onChange={(e) => setRelationship(e.target.value as VehicleOwnershipRecord["relationship"])}><option>Company-Owned</option><option>Leased</option><option>Owner-Operator</option><option>Third-Party / Rented</option></select></FieldComponent>
    {relationship === "Owner-Operator" ? <FieldComponent label="Leasing Status" required><select className={selectClass} value={leasingStatus} onChange={(e) => setLeasingStatus(e.target.value as "Yes" | "No")}><option>Yes</option><option>No</option></select></FieldComponent> : null}
    {(relationship === "Leased" || (relationship === "Owner-Operator" && leasingStatus === "Yes")) ? <EntityPicker label="Leasing Company" required selectedEntity={leasingCompany ? { entityType: "Company", id: leasingCompany.id, label: leasingCompany.name, secondaryText: leasingCompany.id, status: leasingCompany.status } : null} onSelect={(entity) => setLeasingCompany(entity ? readCompanies().find((company) => company.id === entity.id) || null : null)} onSearch={searchCompanies} onCreateNew={createNewCompany} createNewButtonLabel="Create New Company" /> : null}
    <div className="grid gap-3 md:grid-cols-2"><FieldComponent label="Purchase Date"><Input className={inputClass} type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></FieldComponent><FieldComponent label="Purchase Price"><Input className={inputClass} value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="0.00" /></FieldComponent></div>
    {(relationship === "Leased" || (relationship === "Owner-Operator" && leasingStatus === "Yes")) ? <div className="grid gap-3 md:grid-cols-2"><FieldComponent label="Lease Term (Months)"><Input className={inputClass} type="number" min="1" value={leaseTermMonths} onChange={(e) => setLeaseTermMonths(e.target.value)} /></FieldComponent><FieldComponent label="Lease End Date"><Input className={inputClass} value={leaseEndDate} readOnly /></FieldComponent></div> : null}
    <DividerComponent /><div className="grid gap-3 md:grid-cols-2"><FieldComponent label="Ownership Start Date" required><Input className={inputClass} type="date" value={ownershipStartDate} onChange={(e) => setOwnershipStartDate(e.target.value)} /></FieldComponent><FieldComponent label="Ownership End Date"><Input className={inputClass} type="date" value={ownershipEndDate} onChange={(e) => setOwnershipEndDate(e.target.value)} /></FieldComponent></div>
    <DividerComponent /><div className="space-y-2"><FieldComponent label="Legal Owner" required><div className="flex gap-2"><Input className={inputClass} value={legalOwnerInput} onChange={(e) => setLegalOwnerInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOwner() } }} placeholder="Legal owner name" /><Button type="button" variant="outline" size="sm" onClick={addOwner}><Plus className="mr-1 size-3" />Add</Button></div></FieldComponent><div className="flex flex-wrap gap-1.5">{legalOwners.map((owner) => <button type="button" key={owner} onClick={() => setLegalOwners((current) => current.filter((item) => item !== owner))} className="rounded-full border bg-muted/30 px-2 py-1 text-[10px] font-semibold">{owner} ×</button>)}</div></div>
    {relationship === "Company-Owned" ? <FieldComponent label="Financing Status"><select className={selectClass} value={financingStatus || "No Financing"} onChange={(e) => setFinancingStatus(e.target.value as VehicleOwnershipRecord["financingStatus"])}><option>No Financing</option><option>Financed</option><option>Paid Off</option></select></FieldComponent> : null}
    <div className="rounded-lg border bg-muted/20 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Attached Evidence</p><p className="mt-1 text-xs">{evidenceIds.length ? `${evidenceIds.length} document(s) attached.` : "No document attached yet."}</p><p className="mt-1 text-[10px] text-muted-foreground">Use Upload / OCR above. Documents are persisted as evidence records, not filename-only strings.</p></div>
    <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Ownership</Button></div>
  </div></div></div>
}

