"use client"

import { useEffect, useMemo, useState } from "react"
import type { ComponentType } from "react"
import { Archive, Edit3, Plus, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

import {
  createId,
  isoNow,
  loadVehicleStore,
  saveVehicleStore,
  createInspectionFinding,
  updateInspectionFindingStatus,
  createMaintenanceItem,
  linkFindingToMaintenanceItem,
  getFindingsForInspection,
  getMaintenanceItemsForRecord,
  getLinksForFinding,
  deriveMaintenanceItemProvenance,
  type VehicleStore,
  type VehicleInspectionRecord,
  type VehicleMaintenanceRecord,
} from "@/lib/vehicle-data"
import {
  getVehicleRepairInvoices,
  getVehicleSpendSummary,
  getVehicleSpendByCategory,
  getVehicleRecurringIssues,
  verifyRepairInvoice,
  type RepairInvoice,
  type RepairInvoiceLine,
} from "@/lib/repair-invoice-data"
import { loadRepairComponentCatalog } from "@/lib/repair-component-catalog"
import { getRoadsideEventsForVehicle, type RoadsideEventForVehicle } from "@/lib/driver-data"
import { getRoadsideViolationCollection } from "@/lib/driver-performance-child-facts"
import { recordAuditEvent } from "@/lib/audit-logger"
import { INSPECTION_TYPES, type Company, type VehicleRecord } from "@/src/types"
import type { VehicleProfileRecord } from "@/src/components/vehicles/profile/VehicleProfileTab"
import type { EvidenceRecord } from "@/types/evidence"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { ISODateInput } from "@/src/components/shared/ISODateInput"
import {
  PREVENTIVE_MAINTENANCE_PROGRAM_TYPES,
  addDaysISO,
  deriveScheduledMaintenanceOutcome,
  isValidISODateStrict,
  type MaintenanceChecklistStatus,
  type MaintenancePerformedBy,
  type ScheduledMaintenanceBasis,
  type ScheduledMaintenanceOutcome,
  type ScheduledMaintenanceServiceAction,
  type ScheduledMaintenanceStatus,
} from "@/lib/scheduled-maintenance-data"
import { RepairBillsView, RepairBillForm } from "@/src/components/vehicles/repair/RepairBills"
import {
  VehicleInspectionsWorkspace,
  InspectionBackButton,
  type InspectionFamilyKey,
  type InspectionListStatusTone,
  type VehicleInspectionIndexRecord,
} from "./VehicleInspectionsWorkspace"

type AnyComponent = ComponentType<any>

export interface MaintenanceTabProps {
  companyId: string
  store: VehicleStore
  vehicle: VehicleRecord
  inspections: VehicleInspectionRecord[]
  maintenance: VehicleMaintenanceRecord[]
  evidence: EvidenceRecord[]
  onStoreChange: (store: VehicleStore) => void
  onStartOCR: (kind: "inspection" | "maintenance" | "repairBill", documentType: string) => void
  onAttachEvidence: (kind: "inspection" | "maintenance" | "repairBill", documentType: string) => void
  pendingInspectionEvidenceId: string | null
  pendingMaintenanceEvidenceId: string | null
  pendingRepairEvidenceId: string | null
  pendingMaintenanceOCRValues: Record<string, unknown> | null
  pendingRepairOCRValues: Record<string, unknown> | null
  clearInspectionEvidence: () => void
  clearMaintenanceEvidence: () => void
  clearMaintenanceOCRValues: () => void
  clearRepairEvidence: () => void
  clearRepairOCRValues: () => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  onRecordClick?: (record: VehicleInspectionRecord | VehicleMaintenanceRecord) => void
  onRepairRecordClick?: (invoice: RepairInvoice, lines: RepairInvoiceLine[]) => void
  readCompanies: () => Company[]
  todayISO: () => string
  money: (value: string) => string
  inputClass: string
  selectClass: string
  SectionTitleComponent: AnyComponent
  EmptyStateComponent: AnyComponent
  StatusPillComponent: AnyComponent
  FieldComponent: AnyComponent
  DividerComponent: AnyComponent
  ModalShellComponent: AnyComponent
  ModalOCRStripComponent: AnyComponent
  ModalSectionLabelComponent: AnyComponent
  ModalFieldGridComponent: AnyComponent
  ModalFieldComponent: AnyComponent
  ModalEvidenceCardComponent: AnyComponent
  ModalFooterComponent: AnyComponent
  modalFieldInputClass: string
}

const INSPECTION_SOURCES = ["Internal", "Third-Party Shop", "Roadside Enforcement"] as const
const INSPECTION_STATUSES = ["Pass", "Pass with Defects", "Fail", "Out of Service"] as const
const MAINTENANCE_TYPES = [...PREVENTIVE_MAINTENANCE_PROGRAM_TYPES]
const MAINTENANCE_STATUSES = ["Scheduled", "In Progress", "Completed", "Cancelled"] as const
const MAINTENANCE_BASIS_OPTIONS: { value: ScheduledMaintenanceBasis; label: string }[] = [
  { value: "CALENDAR", label: "Calendar interval" },
  { value: "ODOMETER", label: "Odometer interval" },
  { value: "ENGINE_HOURS", label: "Engine hours interval" },
  { value: "COMBINED", label: "Date / odometer / hours combined" },
  { value: "CONDITION_TRIGGERED", label: "Condition triggered" },
]
const PERFORMED_BY_OPTIONS: { value: MaintenancePerformedBy; label: string }[] = [
  { value: "IN_HOUSE", label: "In-house maintenance" },
  { value: "EXTERNAL_REPAIR_SHOP", label: "External repair shop" },
  { value: "MOBILE_MECHANIC", label: "Mobile mechanic" },
  { value: "DEALER_OEM", label: "Dealer / OEM" },
  { value: "ROADSIDE_SERVICE", label: "Roadside service" },
  { value: "OTHER", label: "Other" },
]
const CHECKLIST_STATUS_OPTIONS: { value: MaintenanceChecklistStatus; label: string }[] = [
  { value: "OK", label: "OK" },
  { value: "SERVICED", label: "Serviced" },
  { value: "ATTENTION_REQUIRED", label: "Attention required" },
  { value: "REPAIR_REQUIRED", label: "Repair required" },
  { value: "NOT_APPLICABLE", label: "N/A" },
]
const DEFAULT_FORM_CHECKLIST = [
  "Engine / fuel / exhaust",
  "Fluids",
  "Electrical / lighting",
  "Wheels / tires",
  "Brakes",
  "Steering / suspension",
  "Body / frame / fifth wheel",
  "Cab / visibility",
] as const

type ScheduledMaintenanceExtra = {
  scheduledMaintenanceBasis?: ScheduledMaintenanceBasis
  maintenanceOutcome?: ScheduledMaintenanceOutcome
  submittedStatus?: ScheduledMaintenanceStatus
  clientSubmitted?: boolean
  lockedAfterClientSubmission?: boolean
  submittedByName?: string
  submittedAt?: string
  lockedAt?: string
  performedBy?: MaintenancePerformedBy
  facilityAddress?: string
  technicianName?: string
  dueDate?: string
  dueOdometer?: string
  dueEngineHours?: string
  nextServiceDueEngineHours?: string
  checklistSummary?: { label: string; status: MaintenanceChecklistStatus; notes?: string }[]
  serviceActions?: ScheduledMaintenanceServiceAction[]
}

function maintenanceExtra(record: VehicleMaintenanceRecord): ScheduledMaintenanceExtra {
  return record as VehicleMaintenanceRecord & ScheduledMaintenanceExtra
}

function isLockedMaintenanceRecord(record: VehicleMaintenanceRecord): boolean {
  const extra = maintenanceExtra(record)
  return extra.lockedAfterClientSubmission === true || extra.submittedStatus === "SUBMITTED_LOCKED"
}

function outcomeLabel(value?: ScheduledMaintenanceOutcome): string {
  if (value === "COMPLETED_REPAIR_REQUIRED") return "Completed - Repair Required"
  if (value === "COMPLETED_ATTENTION_REQUIRED") return "Completed - Attention Required"
  return "Completed - No Defect Found"
}

function InspectionFindingsPanel({ companyId, store, onStoreChange, inspection, setNotice, setError }: {
  companyId: string
  store: VehicleStore
  onStoreChange: (store: VehicleStore) => void
  inspection: VehicleInspectionRecord
  setNotice: (value: string | null) => void
  setError: (value: string | null) => void
}) {
  const findings = getFindingsForInspection(store, inspection.id)
  const [showAdd, setShowAdd] = useState(false)
  const [rawDescription, setRawDescription] = useState("")
  const [componentSystem, setComponentSystem] = useState("")
  const refresh = () => onStoreChange(loadVehicleStore(companyId))

  const addFinding = () => {
    if (!rawDescription.trim()) return setError("Finding description is required.")
    createInspectionFinding(companyId, {
      inspectionId: inspection.id,
      rawDescription: rawDescription.trim(),
      componentSystem: componentSystem.trim() || undefined,
    })
    setRawDescription("")
    setComponentSystem("")
    setShowAdd(false)
    refresh()
    setNotice("Finding added.")
  }

  return (
    <div className="border-t border-border px-4 py-3" onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Findings ({findings.length})</p>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd((value) => !value)}><Plus className="mr-1 size-3" />Add Finding</Button>
      </div>
      {findings.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No findings recorded.</p>
      ) : (
        <div className="space-y-2">
          {findings.map((finding) => (
            <FindingRow key={finding.id} companyId={companyId} store={store} finding={finding} onStoreChange={onStoreChange} setNotice={setNotice} setError={setError} />
          ))}
        </div>
      )}
      {showAdd ? (
        <div className="mt-2 space-y-2 rounded-lg border border-border p-3">
          <Input placeholder="What did the inspection find? (required)" value={rawDescription} onChange={(e) => setRawDescription(e.target.value)} className={inputClass} />
          <Input placeholder="Component / system (optional)" value={componentSystem} onChange={(e) => setComponentSystem(e.target.value)} className={inputClass} />
          <div className="flex gap-2"><Button size="sm" onClick={addFinding}>Save Finding</Button><Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button></div>
        </div>
      ) : null}
    </div>
  )
}

function MaintenanceItemsPanel({ companyId, store, onStoreChange, record, setNotice, setError }: {
  companyId: string
  store: VehicleStore
  onStoreChange: (store: VehicleStore) => void
  record: VehicleMaintenanceRecord
  setNotice: (value: string | null) => void
  setError: (value: string | null) => void
}) {
  const items = getMaintenanceItemsForRecord(store, record.id)
  const [showAdd, setShowAdd] = useState(false)
  const [componentSystem, setComponentSystem] = useState("")
  const [workAction, setWorkAction] = useState("")
  const [specificDescription, setSpecificDescription] = useState("")
  const refresh = () => onStoreChange(loadVehicleStore(companyId))

  const addItem = () => {
    if (!specificDescription.trim()) return setError("Item description is required.")
    createMaintenanceItem(companyId, {
      maintenanceRecordId: record.id,
      componentSystem: componentSystem.trim() || undefined,
      workAction: workAction.trim() || undefined,
      specificDescription: specificDescription.trim(),
    })
    setComponentSystem("")
    setWorkAction("")
    setSpecificDescription("")
    setShowAdd(false)
    refresh()
    setNotice("Maintenance item added.")
  }

  return (
    <div className="border-t border-border px-4 py-3" onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Maintenance Items ({items.length})</p>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd((value) => !value)}><Plus className="mr-1 size-3" />Add Item</Button>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{record.maintenanceType ? `Legacy record: ${record.maintenanceType}` : "No structured items yet."}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => {
            const provenance = deriveMaintenanceItemProvenance(store, item)
            const heading = [item.componentSystem, item.workAction].filter(Boolean).join(" → ")
            return (
              <div key={item.id} className="rounded-lg border border-border p-2">
                <p className="text-xs font-semibold">{heading ? `${heading} — ` : ""}{item.specificDescription}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">Source: {provenance.label}{item.legacyMigrated ? " (migrated from legacy record)" : ""}</p>
              </div>
            )
          })}
        </div>
      )}
      {showAdd ? (
        <div className="mt-2 space-y-2 rounded-lg border border-border p-3">
          <Input placeholder="Component / system, e.g. Lighting" value={componentSystem} onChange={(e) => setComponentSystem(e.target.value)} className={inputClass} />
          <Input placeholder="Work action, e.g. Replace" value={workAction} onChange={(e) => setWorkAction(e.target.value)} className={inputClass} />
          <Input placeholder="Specific description (required)" value={specificDescription} onChange={(e) => setSpecificDescription(e.target.value)} className={inputClass} />
          <div className="flex gap-2"><Button size="sm" onClick={addItem}>Save Item</Button><Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button></div>
        </div>
      ) : null}
    </div>
  )
}

function inspectionFamily(record: VehicleInspectionRecord): InspectionFamilyKey {
  const value = `${record.inspectionType} ${record.inspectionSource}`.toLowerCase()
  if (record.inspectionSource === "Roadside Enforcement" || value.includes("roadside") || value.includes("cvsa")) return "ROADSIDE_CVSA"
  if (value.includes("pre-trip") || value.includes("pre trip") || value.includes("post-trip") || value.includes("post trip") || value.includes("dvir")) return "PRE_POST_TRIP"
  if (value.includes("annual") || value.includes("periodic") || value.includes("cvip") || value.includes("396.17")) return "ANNUAL_PERIODIC"
  return "OTHER"
}

function inspectionTone(status: VehicleInspectionRecord["inspectionStatus"]): InspectionListStatusTone {
  if (status === "Fail" || status === "Out of Service") return "CRITICAL"
  if (status === "Pass with Defects") return "WARNING"
  return status === "Pass" ? "GOOD" : "NEUTRAL"
}

function InspectionRecordDetail({
  companyId,
  store,
  record,
  onStoreChange,
  onBack,
  onEdit,
  onArchive,
  setNotice,
  setError,
  StatusPillComponent,
}: {
  companyId: string
  store: VehicleStore
  record: VehicleInspectionRecord
  onStoreChange: (store: VehicleStore) => void
  onBack: () => void
  onEdit: () => void
  onArchive: () => void
  setNotice: (value: string | null) => void
  setError: (value: string | null) => void
  StatusPillComponent: AnyComponent
}) {
  return <div className="space-y-3">
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="mb-3"><InspectionBackButton label="Back to inspection records" onClick={onBack} /></div>
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{record.inspectionType}</h3><StatusPillComponent value={record.inspectionStatus} /></div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{record.id}</p>
        </div>
        <div className="flex gap-1"><Button variant="outline" size="sm" onClick={onEdit}><Edit3 className="mr-1 size-3" />Edit</Button><Button variant="ghost" size="sm" onClick={onArchive}><Archive className="mr-1 size-3" />Archive</Button></div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 min-[1500px]:grid-cols-3">
        <ReadOnlyField label="Inspection Date" value={record.inspectionDate || "—"} />
        <ReadOnlyField label="Expiry Date" value={record.expiryDate || "—"} />
        <ReadOnlyField label="Next Due Date" value={record.nextDueDate || "—"} />
        <ReadOnlyField label="Inspection Source" value={record.inspectionSource || "—"} />
        <ReadOnlyField label="Inspector / Shop" value={record.inspectorShopName || "—"} />
        <ReadOnlyField label="Service Facility" value={record.serviceFacility || "—"} />
        <ReadOnlyField label="Odometer" value={record.odometer || "—"} />
        <ReadOnlyField label="Engine Hours" value={record.engineHours || "—"} />
        <ReadOnlyField label="Defects Found" value={record.defectsFound} />
        <ReadOnlyField label="Evidence" value={record.evidenceIds.length ? `${record.evidenceIds.length} attached` : "Missing"} />
        <ReadOnlyField label="Notes" value={record.notes || "—"} />
      </div>
      <InspectionFindingsPanel companyId={companyId} store={store} onStoreChange={onStoreChange} inspection={record} setNotice={setNotice} setError={setError} />
    </Card>
  </div>
}

function RoadsideInspectionDetail({ match, onBack }: { match: RoadsideEventForVehicle; onBack: () => void }) {
  const { event, matchedRole, resolution } = match
  const violations = getRoadsideViolationCollection(event)?.items || []
  return <Card>
    <div className="border-b border-border px-4 py-3">
      <div className="mb-3"><InspectionBackButton label="Back to Roadside / CVSA records" onClick={onBack} /></div>
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{event.summary || "Roadside Inspection"}</h3><span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{matchedRole === "POWER_UNIT" ? "Power Unit" : "Towed Unit"}</span></div>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{event.id}</p>
    </div>
    <div className="grid gap-3 p-4 sm:grid-cols-2">
      <ReadOnlyField label="Event Date" value={event.eventDate || "—"} />
      <ReadOnlyField label="Vehicle Match" value={resolution.resolvedEntitySummary ? "Matched" : resolution.state} />
      <ReadOnlyField label="Vehicle Role" value={matchedRole === "POWER_UNIT" ? "Power Unit" : "Towed Unit"} />
      <ReadOnlyField label="Violations" value={String(violations.length)} />
    </div>
    <div className="border-t border-border p-4">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Violations</p>
      {violations.length ? <div className="space-y-2">{violations.map((item) => <div className="rounded-lg border border-border p-3" key={item.itemId}><p className="text-xs font-semibold">{String(item.facts.description || item.facts.ruleRegulationCode || "Violation")}</p>{item.facts.oosState === "YES" ? <span className="mt-1 inline-flex rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">Out of service</span> : null}</div>)}</div> : <p className="text-xs text-muted-foreground">No violations recorded.</p>}
    </div>
  </Card>
}

export function MaintenanceTab({
  companyId, store, vehicle, inspections, maintenance, evidence, onStoreChange,
  onStartOCR, onAttachEvidence, pendingInspectionEvidenceId, pendingMaintenanceEvidenceId, pendingRepairEvidenceId, pendingMaintenanceOCRValues, pendingRepairOCRValues,
  clearInspectionEvidence, clearMaintenanceEvidence, clearMaintenanceOCRValues, clearRepairEvidence, clearRepairOCRValues, setError, setNotice, onRecordClick, onRepairRecordClick,
  readCompanies, todayISO, money, inputClass, selectClass,
  SectionTitleComponent, EmptyStateComponent, StatusPillComponent,
  FieldComponent, DividerComponent,
  ModalShellComponent, ModalOCRStripComponent, ModalSectionLabelComponent,
  ModalFieldGridComponent, ModalFieldComponent, ModalEvidenceCardComponent,
  ModalFooterComponent, modalFieldInputClass,
}: MaintenanceTabProps) {
  const [view, setView] = useState<"inspections" | "maintenance" | "repairBills">("inspections")
  const [showInspection, setShowInspection] = useState(false)
  const [showMaintenance, setShowMaintenance] = useState(false)
  const [showRepairBill, setShowRepairBill] = useState(false)
  const [editingInspection, setEditingInspection] = useState<VehicleInspectionRecord | null>(null)
  const [editingMaintenance, setEditingMaintenance] = useState<VehicleMaintenanceRecord | null>(null)
  const [roadsideMatches, setRoadsideMatches] = useState<RoadsideEventForVehicle[]>([])
  const [repairBillRefreshKey, setRepairBillRefreshKey] = useState(0)
  useEffect(() => {
    if (pendingMaintenanceEvidenceId || pendingMaintenanceOCRValues) {
      setView("maintenance")
      setEditingMaintenance(null)
      setShowMaintenance(true)
    }
  }, [pendingMaintenanceEvidenceId, pendingMaintenanceOCRValues])
  useEffect(() => { if (pendingRepairOCRValues) { setView("repairBills"); setShowRepairBill(true) } }, [pendingRepairOCRValues])
  useEffect(() => {
    try {
      setRoadsideMatches(getRoadsideEventsForVehicle(companyId, vehicle.id))
    } catch {
      setRoadsideMatches([])
    }
  }, [companyId, vehicle.id, store])
  const partCatalog = useMemo(() => loadRepairComponentCatalog(companyId), [companyId, repairBillRefreshKey])
  const repairInvoices = useMemo(
    () => getVehicleRepairInvoices(companyId, vehicle.id),
    [companyId, vehicle.id, repairBillRefreshKey]
  )
  const fleetEntryDate = (vehicle as VehicleProfileRecord).fleetStartDate
  const spendSummary = useMemo(
    () => getVehicleSpendSummary(companyId, vehicle.id, fleetEntryDate),
    [companyId, vehicle.id, fleetEntryDate, repairBillRefreshKey]
  )
  const spendByCategory = useMemo(
    () => getVehicleSpendByCategory(companyId, vehicle.id, partCatalog),
    [companyId, vehicle.id, partCatalog, repairBillRefreshKey]
  )
  const recurringIssues = useMemo(
    () => getVehicleRecurringIssues(companyId, vehicle.id, partCatalog),
    [companyId, vehicle.id, partCatalog, repairBillRefreshKey]
  )

  const archiveInspection = (record: VehicleInspectionRecord) => {
    const next = { ...store, inspectionRecords: store.inspectionRecords.map((item) => item.id === record.id ? { ...item, archived: true, updatedAt: isoNow() } : item) }
    try {
      saveVehicleStore(companyId, next)
      onStoreChange(next)
      recordAuditEvent({ action: "ARCHIVE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `Archived inspection record ${record.id}.` })
      setNotice("Inspection archived.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive inspection.")
    }
  }

  const archiveMaintenance = (record: VehicleMaintenanceRecord) => {
    const next = { ...store, maintenanceRecords: store.maintenanceRecords.map((item) => item.id === record.id ? { ...item, archived: true, updatedAt: isoNow() } : item) }
    try {
      saveVehicleStore(companyId, next)
      onStoreChange(next)
      recordAuditEvent({ action: "ARCHIVE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `Archived maintenance record ${record.id}.` })
      setNotice("Maintenance record archived.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive maintenance.")
    }
  }

  const activeInspections = inspections.filter((item) => !item.archived)
  const activeMaintenance = maintenance.filter((item) => !item.archived)
  const inspectionIndexRecords: VehicleInspectionIndexRecord[] = (() => {
    const stored = activeInspections.map((record) => ({
      id: record.id,
      family: inspectionFamily(record),
      title: record.inspectionType,
      inspectionDateLabel: record.inspectionDate || "Date not recorded",
      secondaryLabel: record.expiryDate ? `Expires ${record.expiryDate}` : record.nextDueDate ? `Due ${record.nextDueDate}` : record.inspectionSource,
      statusLabel: record.inspectionStatus,
      statusTone: inspectionTone(record.inspectionStatus),
      evidenceLabel: record.evidenceIds.length ? `${record.evidenceIds.length} attached` : "Missing",
      requiresAttention: ["Fail", "Out of Service", "Pass with Defects"].includes(record.inspectionStatus) || record.evidenceIds.length === 0,
    }))
    const canonicalRoadside = roadsideMatches.map((match) => {
      const violations = getRoadsideViolationCollection(match.event)?.items || []
      const hasOos = violations.some((item) => item.facts.oosState === "YES")
      return {
        id: `roadside:${match.event.id}:${match.resolution.relationshipKey}`,
        family: "ROADSIDE_CVSA" as const,
        title: match.event.summary || "Roadside Inspection",
        inspectionDateLabel: match.event.eventDate || "Date not recorded",
        secondaryLabel: match.matchedRole === "POWER_UNIT" ? "Power Unit" : "Towed Unit",
        statusLabel: hasOos ? "Out of Service" : violations.length ? `${violations.length} violation${violations.length === 1 ? "" : "s"}` : "No violations",
        statusTone: hasOos ? "CRITICAL" as const : violations.length ? "WARNING" as const : "GOOD" as const,
        evidenceLabel: "Canonical event",
        requiresAttention: hasOos || violations.length > 0,
      }
    })
    return [...stored, ...canonicalRoadside].sort((a, b) => b.inspectionDateLabel.localeCompare(a.inspectionDateLabel))
  })()

  return (
    <div className="space-y-3">
      <Card>
        <SectionTitleComponent
          title="Maintenance / Inspections"
          description="OCR-first document entry alongside manual operational records."
          action={
            <div>
              <Button size="sm" onClick={() => onStartOCR(view === "inspections" ? "inspection" : view === "repairBills" ? "repairBill" : "maintenance", view === "inspections" ? "Inspection Document" : view === "repairBills" ? "Repair Invoice / Work Order" : "Maintenance Work Order / Invoice")}>
                <Upload className="mr-1.5 size-3.5" />Upload Document / OCR
              </Button>
            </div>
          }
        />
      </Card>

      <div className="flex gap-1 border-b border-border">
        <button className={`border-b-2 px-3 py-2 text-xs font-semibold ${view === "inspections" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setView("inspections")}>Inspections</button>
        <button className={`border-b-2 px-3 py-2 text-xs font-semibold ${view === "maintenance" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setView("maintenance")}>Maintenance</button>
        <button className={`border-b-2 px-3 py-2 text-xs font-semibold ${view === "repairBills" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setView("repairBills")}>Repair Bills</button>
      </div>

      {view !== "repairBills" ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <p className="text-xs font-bold text-foreground">{view === "inspections" ? "Inspection records" : view === "maintenance" ? "Maintenance records" : "Repair bills"}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{view === "inspections" ? "Annual, operational and enforcement inspections for this vehicle." : view === "maintenance" ? "Scheduled service and maintenance work for this vehicle." : "Itemized repair invoices and linked repair work for this vehicle."}</p>
        </div>
        {view === "inspections" ? <Button size="sm" onClick={() => { setEditingInspection(null); setShowInspection(true) }}><Plus className="mr-1.5 size-3.5" />Add Inspection</Button> : null}
        {view === "maintenance" ? <Button size="sm" onClick={() => { setEditingMaintenance(null); setShowMaintenance(true) }}><Plus className="mr-1.5 size-3.5" />Add Maintenance Record</Button> : null}
      </div> : null}

      {view === "repairBills" && !showRepairBill ? (
        <RepairBillsView
          companyId={companyId}
          vehicle={vehicle}
          repairInvoices={repairInvoices}
          partCatalog={partCatalog}
          spendSummary={spendSummary}
          spendByCategory={spendByCategory}
          recurringIssues={recurringIssues}
          onAddRepairBill={() => setShowRepairBill(true)}
          onVerifyRepairBill={(invoiceId) => { try { verifyRepairInvoice(companyId, invoiceId, { reason: "Reviewed against attached evidence." }); setRepairBillRefreshKey((key) => key + 1); setNotice("Repair invoice verified and included in confirmed expenditure BI.") } catch (error) { setError(error instanceof Error ? error.message : "Repair invoice could not be verified.") } }}
          onSelectRepairBill={onRepairRecordClick}
          EmptyStateComponent={EmptyStateComponent}
          SectionTitleComponent={SectionTitleComponent}
          StatusPillComponent={StatusPillComponent}
        />
      ) : null}

      {view === "repairBills" && showRepairBill ? (
        <RepairBillForm
          companyId={companyId}
          vehicle={vehicle}
          store={store}
          roadsideOptions={roadsideMatches.map((match) => ({
            eventId: match.event.id,
            label: `${match.event.eventDate || "Date not recorded"} · ${match.event.summary || "Roadside inspection"}`,
            equipmentLabel: match.matchedRole === "POWER_UNIT" ? "Power Unit" : "Towed Unit",
            findings: (getRoadsideViolationCollection(match.event)?.items || []).map((item) => ({
              id: item.itemId,
              label: String(item.facts.description || item.facts.ruleRegulationCode || "Roadside finding"),
              outOfService: item.facts.oosState === "YES",
            })),
          }))}
          pendingEvidenceId={pendingRepairEvidenceId}
          initialOCRValues={pendingRepairOCRValues}
          onAttachEvidence={() => onAttachEvidence("repairBill", "Repair Invoice / Work Order")}
          clearPendingEvidence={clearRepairEvidence}
          onClose={() => setShowRepairBill(false)}
          onSaved={() => {
            setShowRepairBill(false)
            setView("repairBills")
            setRepairBillRefreshKey((k) => k + 1)
            clearRepairOCRValues()
            setNotice("Repair bill saved.")
          }}
          setError={setError}
          readCompanies={readCompanies}
          FieldComponent={FieldComponent}
          DividerComponent={DividerComponent}
          inputClass={inputClass}
          selectClass={selectClass}
          todayISO={todayISO}
        />
      ) : null}

      {view === "inspections" ? (
        <VehicleInspectionsWorkspace
          unitNumber={vehicle.unitNumber}
          vehicleLabel={[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.equipmentType}
          records={inspectionIndexRecords}
          inspectionTypes={INSPECTION_TYPES}
          onOpenRecord={(indexRecord) => {
            const record = activeInspections.find((item) => item.id === indexRecord.id)
            if (record) onRecordClick?.(record)
          }}
          renderRecord={(indexRecord, { onBackToList }) => {
            const record = activeInspections.find((item) => item.id === indexRecord.id)
            if (record) return <InspectionRecordDetail companyId={companyId} store={store} record={record} onStoreChange={onStoreChange} onBack={onBackToList} onEdit={() => { setEditingInspection(record); setShowInspection(true) }} onArchive={() => archiveInspection(record)} setNotice={setNotice} setError={setError} StatusPillComponent={StatusPillComponent} />
            const roadside = roadsideMatches.find((match) => `roadside:${match.event.id}:${match.resolution.relationshipKey}` === indexRecord.id)
            return roadside ? <RoadsideInspectionDetail match={roadside} onBack={onBackToList} /> : null
          }}
        />
      ) : null}

      {view === "maintenance" ? (
        activeMaintenance.length === 0 ? (
          <EmptyStateComponent title="No maintenance records" description="Upload a work order/invoice or add a maintenance record manually." />
        ) : (
          <div className="space-y-2">
            {activeMaintenance.map((record) => (
              <Card key={record.id} className="cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => onRecordClick?.(record)}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{record.maintenanceType}</h3><StatusPillComponent value={record.maintenanceStatus} />{isLockedMaintenanceRecord(record) ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Client submitted · locked</span> : null}</div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div>
                  <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); if (isLockedMaintenanceRecord(record)) { setNotice("Client-submitted maintenance records are locked. Attach evidence or create an addendum instead of editing the original."); return } setEditingMaintenance(record); setShowMaintenance(true) }}><Edit3 className="mr-1 size-3" />Edit</Button><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); archiveMaintenance(record) }}><Archive className="mr-1 size-3" />Archive</Button></div>
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 min-[1500px]:grid-cols-3">
                  <ReadOnlyField label="Service Date" value={record.serviceDate || "—"} />
                  <ReadOnlyField label="Odometer" value={record.odometer || "—"} />
                  <ReadOnlyField label="Due Date" value={maintenanceExtra(record).dueDate || "—"} />
                  <ReadOnlyField label="Due Odometer" value={maintenanceExtra(record).dueOdometer || "—"} />
                  <ReadOnlyField label="Outcome" value={outcomeLabel(maintenanceExtra(record).maintenanceOutcome)} />
                  <ReadOnlyField label="Performed By" value={maintenanceExtra(record).performedBy?.replaceAll("_", " ").toLowerCase() || "—"} />
                  <ReadOnlyField label="Work Order / Invoice" value={record.workOrderInvoiceNumber || "—"} />
                  <ReadOnlyField label="Facility / Provider" value={record.vendor || "—"} />
                  <ReadOnlyField label="Parts Cost" value={money(record.partsCost)} />
                  <ReadOnlyField label="Total Cost" value={money(record.totalCost)} />
                  <ReadOnlyField label="Next Service Due" value={record.nextServiceDueDate || "—"} />
                  <ReadOnlyField label="Next Due Odometer" value={record.nextServiceDueOdometer || "—"} />
                  <ReadOnlyField label="Evidence" value={record.evidenceIds.length ? `${record.evidenceIds.length} attached` : "Missing"} />
                </div>
                <MaintenanceItemsPanel companyId={companyId} store={store} onStoreChange={onStoreChange} record={record} setNotice={setNotice} setError={setError} />
              </Card>
            ))}
          </div>
        )
      ) : null}

      {showInspection ? <InspectionForm companyId={companyId} store={store} vehicle={vehicle} initial={editingInspection} pendingEvidenceId={pendingInspectionEvidenceId} clearPendingEvidence={clearInspectionEvidence} onStartOCR={() => onStartOCR("inspection", "Inspection Document")} onAttachEvidence={() => onAttachEvidence("inspection", "Inspection Document")} onClose={() => setShowInspection(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} ModalShellComponent={ModalShellComponent} ModalOCRStripComponent={ModalOCRStripComponent} ModalSectionLabelComponent={ModalSectionLabelComponent} ModalFieldGridComponent={ModalFieldGridComponent} ModalFieldComponent={ModalFieldComponent} ModalEvidenceCardComponent={ModalEvidenceCardComponent} ModalFooterComponent={ModalFooterComponent} modalFieldInputClass={modalFieldInputClass} /> : null}
      {showMaintenance ? <MaintenanceForm companyId={companyId} store={store} vehicle={vehicle} initial={editingMaintenance} pendingEvidenceId={pendingMaintenanceEvidenceId} pendingOCRValues={pendingMaintenanceOCRValues} clearPendingEvidence={clearMaintenanceEvidence} clearPendingOCRValues={clearMaintenanceOCRValues} onStartOCR={() => onStartOCR("maintenance", "Preventive / Scheduled Maintenance Document")} onAttachEvidence={() => onAttachEvidence("maintenance", "Preventive / Scheduled Maintenance Document")} onClose={() => setShowMaintenance(false)} onStoreChange={onStoreChange} onRecordSaved={(record) => onRecordClick?.(record)} setError={setError} setNotice={setNotice} ModalShellComponent={ModalShellComponent} ModalOCRStripComponent={ModalOCRStripComponent} ModalSectionLabelComponent={ModalSectionLabelComponent} ModalFieldGridComponent={ModalFieldGridComponent} ModalFieldComponent={ModalFieldComponent} ModalEvidenceCardComponent={ModalEvidenceCardComponent} ModalFooterComponent={ModalFooterComponent} modalFieldInputClass={modalFieldInputClass} /> : null}
    </div>
  )
}

function InspectionForm({ companyId, store, vehicle, initial, pendingEvidenceId, clearPendingEvidence, onStartOCR, onAttachEvidence, onClose, onStoreChange, setError, setNotice, ModalShellComponent, ModalOCRStripComponent, ModalSectionLabelComponent, ModalFieldGridComponent, ModalFieldComponent, ModalEvidenceCardComponent, ModalFooterComponent, modalFieldInputClass }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehicleInspectionRecord | null; pendingEvidenceId: string | null; clearPendingEvidence: () => void; onStartOCR: () => void; onAttachEvidence: () => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void; ModalShellComponent: AnyComponent; ModalOCRStripComponent: AnyComponent; ModalSectionLabelComponent: AnyComponent; ModalFieldGridComponent: AnyComponent; ModalFieldComponent: AnyComponent; ModalEvidenceCardComponent: AnyComponent; ModalFooterComponent: AnyComponent; modalFieldInputClass: string }) {
  const [inspectionType, setInspectionType] = useState(initial?.inspectionType || INSPECTION_TYPES[0])
  const [inspectionSource, setInspectionSource] = useState<VehicleInspectionRecord["inspectionSource"]>(initial?.inspectionSource || "Internal")
  const [inspectionStatus, setInspectionStatus] = useState<VehicleInspectionRecord["inspectionStatus"]>(initial?.inspectionStatus || "Pass")
  const [inspectionDate, setInspectionDate] = useState(initial?.inspectionDate || "")
  const [expiryDate, setExpiryDate] = useState(initial?.expiryDate || "")
  const [nextDueDate, setNextDueDate] = useState(initial?.nextDueDate || "")
  const [inspectorShopName, setInspectorShopName] = useState(initial?.inspectorShopName || "")
  const [odometer, setOdometer] = useState(initial?.odometer || "")
  const [engineHours, setEngineHours] = useState(initial?.engineHours || "")
  const [defectsFound, setDefectsFound] = useState<"Yes" | "No">(initial?.defectsFound || "No")
  const [serviceFacility, setServiceFacility] = useState(initial?.serviceFacility || "")
  const [notes, setNotes] = useState(initial?.notes || "")
  const [evidenceIds, setEvidenceIds] = useState<string[]>(initial?.evidenceIds || [])
  useEffect(() => { if (pendingEvidenceId) { setEvidenceIds((current) => Array.from(new Set([...current, pendingEvidenceId]))); clearPendingEvidence() } }, [pendingEvidenceId, clearPendingEvidence])
  const save = () => { const now = isoNow(); const record: VehicleInspectionRecord = { id: initial?.id || createId("INSP"), vehicleId: vehicle.id, inspectionType, inspectionSource, inspectionStatus, inspectionDate, expiryDate, nextDueDate, inspectorShopName, odometer, engineHours, defectsFound, serviceFacility, evidenceIds, notes, archived: initial?.archived || false, createdAt: initial?.createdAt || now, updatedAt: now }; const next = { ...store, inspectionRecords: initial ? store.inspectionRecords.map((item) => item.id === initial.id ? record : item) : [record, ...store.inspectionRecords] }; try { saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: initial ? "UPDATE" : "CREATE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `${initial ? "Updated" : "Created"} inspection record ${record.id}.` }); setNotice("Inspection saved."); onClose() } catch (err) { setError(err instanceof Error ? err.message : "Inspection could not be saved.") } }
  const isRoadside = inspectionType === "CVSA / Roadside Inspection"
  return (
    <ModalShellComponent
      title={`${initial ? "Edit" : "Add"} Inspection`}
      subtitle="OCR-first document capture is available directly here."
      onClose={onClose}
      footer={<ModalFooterComponent note="Upload inspection report or certificate." onCancel={onClose} onSave={save} saveLabel="Save Inspection" />}
    >
      <ModalOCRStripComponent
        title="Inspection Document"
        description="Review source before committing the inspection record."
        onStartOCR={onStartOCR}
      />

      <ModalSectionLabelComponent>Inspection Details</ModalSectionLabelComponent>
      <ModalFieldGridComponent>
        <ModalFieldComponent label="Inspection Type" required>
          <select className={modalFieldInputClass} value={inspectionType} onChange={(e) => setInspectionType(e.target.value)}>
            {INSPECTION_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Inspection Source">
          <select className={modalFieldInputClass} value={inspectionSource} onChange={(e) => setInspectionSource(e.target.value as VehicleInspectionRecord["inspectionSource"])}>
            {INSPECTION_SOURCES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalFieldComponent>
        {isRoadside ? (
          <div className="col-span-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground">
            Enforcement data for roadside inspections is captured in the Driver Performance section. This record links the inspection to this vehicle for maintenance and compliance tracking.
          </div>
        ) : null}
        <ModalFieldComponent label="Inspection Status" required>
          <select className={modalFieldInputClass} value={inspectionStatus} onChange={(e) => setInspectionStatus(e.target.value as VehicleInspectionRecord["inspectionStatus"])}>
            {INSPECTION_STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Inspection Date" required>
          <ISODateInput className={modalFieldInputClass} value={inspectionDate} onValueChange={setInspectionDate} required />
        </ModalFieldComponent>
        <ModalFieldComponent label="Expiry Date">
          <ISODateInput className={modalFieldInputClass} value={expiryDate} onValueChange={setExpiryDate} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Next Due Date">
          <ISODateInput className={modalFieldInputClass} value={nextDueDate} onValueChange={setNextDueDate} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Inspector / Shop">
          <Input className={modalFieldInputClass} value={inspectorShopName} onChange={(e) => setInspectorShopName(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Odometer">
          <Input className={modalFieldInputClass} value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Engine Hours">
          <Input className={modalFieldInputClass} value={engineHours} onChange={(e) => setEngineHours(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Service Facility">
          <Input className={modalFieldInputClass} value={serviceFacility} onChange={(e) => setServiceFacility(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Defects Found">
          <select className={modalFieldInputClass} value={defectsFound} onChange={(e) => setDefectsFound(e.target.value as "Yes" | "No")}>
            <option>Yes</option>
            <option>No</option>
          </select>
        </ModalFieldComponent>
        <div />
        <ModalFieldComponent label="Notes" className="col-span-2">
          <Textarea rows={3} className={modalFieldInputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </ModalFieldComponent>
      </ModalFieldGridComponent>

      <ModalSectionLabelComponent>Evidence</ModalSectionLabelComponent>
      <div className="grid grid-cols-1 gap-3 px-6 pb-4 sm:grid-cols-2">
        <ModalEvidenceCardComponent
          label="Inspection Document"
          attached={evidenceIds.length > 0}
          attachedNote={evidenceIds.length ? `${evidenceIds.length} attached` : undefined}
          onAttach={onAttachEvidence}
        />
      </div>
    </ModalShellComponent>
  )
}

function MaintenanceForm({ companyId, store, vehicle, initial, pendingEvidenceId, pendingOCRValues, clearPendingEvidence, clearPendingOCRValues, onStartOCR, onAttachEvidence, onClose, onStoreChange, onRecordSaved, setError, setNotice, ModalShellComponent, ModalOCRStripComponent, ModalSectionLabelComponent, ModalFieldGridComponent, ModalFieldComponent, ModalEvidenceCardComponent, ModalFooterComponent, modalFieldInputClass }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehicleMaintenanceRecord | null; pendingEvidenceId: string | null; pendingOCRValues: Record<string, unknown> | null; clearPendingEvidence: () => void; clearPendingOCRValues: () => void; onStartOCR: () => void; onAttachEvidence: () => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; onRecordSaved?: (record: VehicleMaintenanceRecord) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void; ModalShellComponent: AnyComponent; ModalOCRStripComponent: AnyComponent; ModalSectionLabelComponent: AnyComponent; ModalFieldGridComponent: AnyComponent; ModalFieldComponent: AnyComponent; ModalEvidenceCardComponent: AnyComponent; ModalFooterComponent: AnyComponent; modalFieldInputClass: string }) {
  const initialExtra = initial ? maintenanceExtra(initial) : {}
  const locked = initial ? isLockedMaintenanceRecord(initial) : false
  const [maintenanceType, setMaintenanceType] = useState(initial?.maintenanceType || MAINTENANCE_TYPES[0])
  const [maintenanceStatus, setMaintenanceStatus] = useState<VehicleMaintenanceRecord["maintenanceStatus"]>(initial?.maintenanceStatus || "Completed")
  const [basis, setBasis] = useState<ScheduledMaintenanceBasis>(initialExtra.scheduledMaintenanceBasis || "COMBINED")
  const [serviceDate, setServiceDate] = useState(initial?.serviceDate || "")
  const [dueDate, setDueDate] = useState(initialExtra.dueDate || "")
  const [odometer, setOdometer] = useState(initial?.odometer || "")
  const [dueOdometer, setDueOdometer] = useState(initialExtra.dueOdometer || "")
  const [engineHours, setEngineHours] = useState(initial?.engineHours || "")
  const [dueEngineHours, setDueEngineHours] = useState(initialExtra.dueEngineHours || "")
  const [performedBy, setPerformedBy] = useState<MaintenancePerformedBy>(initialExtra.performedBy || "IN_HOUSE")
  const [vendor, setVendor] = useState(initial?.vendor || "")
  const [facilityAddress, setFacilityAddress] = useState(initialExtra.facilityAddress || "")
  const [technicianName, setTechnicianName] = useState(initialExtra.technicianName || "")
  const [submittedByName, setSubmittedByName] = useState(initialExtra.submittedByName || "")
  const [workOrderInvoiceNumber, setWorkOrderInvoiceNumber] = useState(initial?.workOrderInvoiceNumber || initial?.workOrderNumber || initial?.invoiceNumber || "")
  const [partsCost, setPartsCost] = useState(initial?.partsCost || "")
  const [totalCost, setTotalCost] = useState(initial?.totalCost || "")
  const [nextServiceDueDate, setNextServiceDueDate] = useState(initial?.nextServiceDueDate || "")
  const [nextServiceDueOdometer, setNextServiceDueOdometer] = useState(initial?.nextServiceDueOdometer || "")
  const [nextServiceDueEngineHours, setNextServiceDueEngineHours] = useState(initialExtra.nextServiceDueEngineHours || "")
  const [checklist, setChecklist] = useState<{ label: string; status: MaintenanceChecklistStatus; notes?: string }[]>(initialExtra.checklistSummary?.length ? initialExtra.checklistSummary : DEFAULT_FORM_CHECKLIST.map((label) => ({ label, status: "OK" as const, notes: "" })))
  const [lockAsClientSubmission, setLockAsClientSubmission] = useState(initialExtra.clientSubmitted ?? !initial)
  const [notes, setNotes] = useState(initial?.notes || "")
  const [evidenceIds, setEvidenceIds] = useState<string[]>(initial?.evidenceIds || [])
  const [localError, setLocalError] = useState<string | null>(null)
  useEffect(() => { if (pendingEvidenceId) { setEvidenceIds((current) => Array.from(new Set([...current, pendingEvidenceId]))); clearPendingEvidence() } }, [pendingEvidenceId, clearPendingEvidence])
  useEffect(() => {
    if (!pendingOCRValues) return
    const read = (key: string) => String(pendingOCRValues[key] ?? "").trim()
    const sourceDate = read("serviceDate") || read("documentDate")
    if (sourceDate) setServiceDate(sourceDate)
    const sourceOdometer = read("odometer")
    if (sourceOdometer) setOdometer(sourceOdometer)
    const sourceUnit = read("unitNumber")
    const sourceVin = read("vin")
    const sourceVendor = read("facilityName") || read("providerName")
    const sourceInvoice = read("workOrderInvoiceNumber") || read("referenceNumber")
    if (sourceVendor) setVendor(sourceVendor)
    if (sourceInvoice) setWorkOrderInvoiceNumber(sourceInvoice)
    const sourceSubmittedBy = read("submittedByName")
    if (sourceSubmittedBy) setSubmittedByName(sourceSubmittedBy)
    const sourceNotes = [read("notes"), sourceUnit ? `OCR unit: ${sourceUnit}` : "", sourceVin ? `OCR VIN: ${sourceVin}` : ""].filter(Boolean).join("\n")
    if (sourceNotes) setNotes((current) => current ? `${current}\n${sourceNotes}` : sourceNotes)
    clearPendingOCRValues()
  }, [pendingOCRValues, clearPendingOCRValues])
  const computedOutcome = deriveScheduledMaintenanceOutcome(checklist)
  const fail = (message: string) => {
    setLocalError(message)
    setError(message)
  }
  const save = () => {
    setLocalError(null)
    if (locked) return fail("Client-submitted scheduled maintenance records are locked. Create an addendum instead of editing the original.")
    if (!serviceDate || !isValidISODateStrict(serviceDate)) return fail("Service date must be a real date in YYYY-MM-DD format.")
    if (dueDate && !isValidISODateStrict(dueDate)) return fail("Due date must be a real date in YYYY-MM-DD format.")
    if (nextServiceDueDate && !isValidISODateStrict(nextServiceDueDate)) return fail("Next service due date must be a real date in YYYY-MM-DD format.")
    if (!odometer || Number(odometer) < 0) return fail("Odometer is required for scheduled maintenance.")
    if (lockAsClientSubmission && !submittedByName.trim()) return fail("Submitted by is required for a client-submitted maintenance form.")
    const now = isoNow()
    const record = {
      id: initial?.id || createId("MNT"),
      vehicleId: vehicle.id,
      maintenanceType,
      maintenanceStatus,
      serviceDate,
      odometer,
      engineHours,
      vendor,
      workOrderInvoiceNumber,
      partsCost,
      totalCost,
      nextServiceDueDate,
      evidenceIds,
      notes,
      archived: initial?.archived || false,
      createdAt: initial?.createdAt || now,
      updatedAt: now,
      workOrderNumber: initial?.workOrderNumber || workOrderInvoiceNumber,
      invoiceNumber: initial?.invoiceNumber,
      labourCost: initial?.labourCost,
      nextServiceDueOdometer,
      scheduledMaintenanceBasis: basis,
      maintenanceOutcome: computedOutcome,
      submittedStatus: lockAsClientSubmission ? "SUBMITTED_LOCKED" : "INTERNAL_REVIEW",
      clientSubmitted: lockAsClientSubmission,
      lockedAfterClientSubmission: lockAsClientSubmission,
      submittedByName,
      submittedAt: initialExtra.submittedAt || now,
      lockedAt: lockAsClientSubmission ? (initialExtra.lockedAt || now) : undefined,
      performedBy,
      facilityAddress,
      technicianName,
      dueDate,
      dueOdometer,
      dueEngineHours,
      nextServiceDueEngineHours,
      checklistSummary: checklist,
      serviceActions: [
        { id: "oil", action: "Oil change", performed: maintenanceType.includes("Oil") || notes.toLowerCase().includes("oil") },
        { id: "filter", action: "Filter service", performed: maintenanceType.includes("Filter") || notes.toLowerCase().includes("filter") },
        { id: "lube", action: "Lubrication / greasing", performed: maintenanceType.includes("Lubrication") || notes.toLowerCase().includes("greas") },
        { id: "tire", action: "Tire service / rotation", performed: maintenanceType.includes("Tire") },
        { id: "alignment", action: "Wheel alignment", performed: maintenanceType.includes("Alignment") },
      ],
    } as VehicleMaintenanceRecord & ScheduledMaintenanceExtra
    const next = { ...store, maintenanceRecords: initial ? store.maintenanceRecords.map((item) => item.id === initial.id ? record : item) : [record, ...store.maintenanceRecords] }
    try {
      saveVehicleStore(companyId, next)
      onStoreChange(next)
      recordAuditEvent({ action: initial ? "UPDATE" : "CREATE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `${initial ? "Updated" : "Created"} scheduled maintenance record ${record.id}; outcome=${computedOutcome}; locked=${lockAsClientSubmission}.` })
      setNotice(lockAsClientSubmission ? "Scheduled maintenance submitted and locked." : "Maintenance record saved.")
      onRecordSaved?.(record)
      onClose()
    } catch (err) {
      fail(err instanceof Error ? err.message : "Maintenance record could not be saved.")
    }
  }
  const applyNinetyDayDefault = () => {
    if (serviceDate && !nextServiceDueDate) setNextServiceDueDate(addDaysISO(serviceDate, 90))
    if (odometer && !nextServiceDueOdometer) setNextServiceDueOdometer(String(Number(odometer) + 30000))
  }
  return (
    <ModalShellComponent
      title={`${initial ? locked ? "View" : "Edit" : "Add"} Preventive / Scheduled Maintenance`}
      subtitle="Client-submitted maintenance becomes a locked PDF-backed record. Repairs stay separate and linked only when required."
      onClose={onClose}
      footer={<ModalFooterComponent note={locked ? "Locked client submission. Create an addendum for corrections." : "Attach work order, worksheet, invoice, or generated PDF evidence."} onCancel={onClose} onSave={save} saveLabel={lockAsClientSubmission ? "Submit & Lock Maintenance" : "Save Maintenance"} />}
    >
      <ModalOCRStripComponent
        title="Maintenance Source Document"
        description="Upload a worksheet, work order, invoice or client-submitted PDF. OCR review stays separate from manual evidence attachment."
        onStartOCR={onStartOCR}
      />
      {localError ? <div className="mx-6 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{localError}</div> : null}
      {locked ? <div className="mx-6 mt-4 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary">This record was client-submitted and locked at submission. TES should attach evidence or create an addendum instead of changing original values.</div> : null}

      <ModalSectionLabelComponent>Maintenance Details</ModalSectionLabelComponent>
      <ModalFieldGridComponent>
        <ModalFieldComponent label="Maintenance Type" required>
          <select className={modalFieldInputClass} value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)} disabled={locked}>
            {MAINTENANCE_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Maintenance Status" required>
          <select className={modalFieldInputClass} value={maintenanceStatus} onChange={(e) => setMaintenanceStatus(e.target.value as VehicleMaintenanceRecord["maintenanceStatus"])} disabled={locked}>
            {MAINTENANCE_STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Schedule Basis" required>
          <select className={modalFieldInputClass} value={basis} onChange={(e) => setBasis(e.target.value as ScheduledMaintenanceBasis)} disabled={locked}>
            {MAINTENANCE_BASIS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Service Date" required>
          <ISODateInput className={modalFieldInputClass} value={serviceDate} onValueChange={setServiceDate} required disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Due Date">
          <ISODateInput className={modalFieldInputClass} value={dueDate} onValueChange={setDueDate} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Odometer" required>
          <Input className={modalFieldInputClass} type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Due Odometer">
          <Input className={modalFieldInputClass} type="number" min="0" value={dueOdometer} onChange={(e) => setDueOdometer(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Engine Hours">
          <Input className={modalFieldInputClass} type="number" min="0" value={engineHours} onChange={(e) => setEngineHours(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Due Engine Hours">
          <Input className={modalFieldInputClass} type="number" min="0" value={dueEngineHours} onChange={(e) => setDueEngineHours(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Performed By" required>
          <select className={modalFieldInputClass} value={performedBy} onChange={(e) => setPerformedBy(e.target.value as MaintenancePerformedBy)} disabled={locked}>
            {PERFORMED_BY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Facility / Provider">
          <Input className={modalFieldInputClass} value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Facility Address">
          <Input className={modalFieldInputClass} value={facilityAddress} onChange={(e) => setFacilityAddress(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Technician / Contact">
          <Input className={modalFieldInputClass} value={technicianName} onChange={(e) => setTechnicianName(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Submitted By" required={lockAsClientSubmission}>
          <Input className={modalFieldInputClass} value={submittedByName} onChange={(e) => setSubmittedByName(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Work Order / Invoice #">
          <Input className={modalFieldInputClass} value={workOrderInvoiceNumber} onChange={(e) => setWorkOrderInvoiceNumber(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Next Service Due">
          <ISODateInput className={modalFieldInputClass} value={nextServiceDueDate} onValueChange={setNextServiceDueDate} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Next Due Odometer">
          <Input className={modalFieldInputClass} type="number" min="0" value={nextServiceDueOdometer} onChange={(e) => setNextServiceDueOdometer(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Next Due Engine Hours">
          <Input className={modalFieldInputClass} type="number" min="0" value={nextServiceDueEngineHours} onChange={(e) => setNextServiceDueEngineHours(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Parts Cost">
          <Input className={modalFieldInputClass} type="number" min="0" value={partsCost} onChange={(e) => setPartsCost(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Total Cost">
          <Input className={modalFieldInputClass} type="number" min="0" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
        <div className="col-span-2 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={applyNinetyDayDefault} disabled={locked}>Apply 90 days / 30,000 km default</Button>
          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
            <input type="checkbox" checked={lockAsClientSubmission} onChange={(event) => setLockAsClientSubmission(event.target.checked)} disabled={locked} />
            Client-submitted form: lock after save
          </label>
        </div>
        <ModalFieldComponent label="Notes" className="col-span-2">
          <Textarea rows={3} className={modalFieldInputClass} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} />
        </ModalFieldComponent>
      </ModalFieldGridComponent>

      <ModalSectionLabelComponent>Checklist Outcome</ModalSectionLabelComponent>
      <div className="space-y-2 px-6 pb-4">
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
          Current outcome: <span className="font-semibold">{outcomeLabel(computedOutcome)}</span>
        </div>
        {checklist.map((item, index) => (
          <div key={item.label} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[minmax(180px,1fr)_190px_minmax(180px,1fr)]">
            <p className="text-xs font-semibold">{item.label}</p>
            <select className={modalFieldInputClass} value={item.status} onChange={(event) => setChecklist((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, status: event.target.value as MaintenanceChecklistStatus } : row))} disabled={locked}>
              {CHECKLIST_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <Input className={modalFieldInputClass} value={item.notes || ""} placeholder="Measurement or note" onChange={(event) => setChecklist((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, notes: event.target.value } : row))} disabled={locked} />
          </div>
        ))}
      </div>

      <ModalSectionLabelComponent>Evidence</ModalSectionLabelComponent>
      <div className="grid grid-cols-1 gap-3 px-6 pb-4 sm:grid-cols-2">
        <ModalEvidenceCardComponent
          label="Worksheet / Generated PDF / Invoice"
          attached={evidenceIds.length > 0}
          attachedNote={evidenceIds.length ? `${evidenceIds.length} attached` : undefined}
          onAttach={onAttachEvidence}
        />
      </div>
    </ModalShellComponent>
  )
}
