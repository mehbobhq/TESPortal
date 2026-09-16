"use client"

import { useEffect, useMemo, useState } from "react"
import type { ComponentType } from "react"
import { Archive, Edit3, Plus, Upload, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

import {
  createId,
  isoNow,
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
} from "@/lib/repair-invoice-data"
import { loadPartCatalog } from "@/lib/part-catalog-data"
import { getRoadsideEventsForVehicle, type RoadsideEventForVehicle } from "@/lib/driver-data"
import { getRoadsideViolationCollection } from "@/lib/driver-performance-child-facts"
import { recordAuditEvent } from "@/lib/audit-logger"
import { INSPECTION_TYPES, type Company, type VehicleRecord } from "@/src/types"
import type { VehicleProfileRecord } from "@/src/components/vehicles/profile/VehicleProfileTab"
import type { EvidenceRecord } from "@/types/evidence"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { RepairBillsView, RepairBillForm } from "@/src/components/vehicles/repair/RepairBills"

type AnyComponent = ComponentType<any>

export interface MaintenanceTabProps {
  companyId: string
  store: VehicleStore
  vehicle: VehicleRecord
  inspections: VehicleInspectionRecord[]
  maintenance: VehicleMaintenanceRecord[]
  evidence: EvidenceRecord[]
  onStoreChange: (store: VehicleStore) => void
  onStartOCR: (kind: "inspection" | "maintenance", documentType: string) => void
  pendingInspectionEvidenceId: string | null
  pendingMaintenanceEvidenceId: string | null
  clearInspectionEvidence: () => void
  clearMaintenanceEvidence: () => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  onRecordClick?: (record: VehicleInspectionRecord | VehicleMaintenanceRecord) => void
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
const MAINTENANCE_TYPES = [
  "Preventive Maintenance / Scheduled Service",
  "Oil and Filter Change",
  "Lubrication Service",
  "Brake Repair",
  "Tire Service / Replacement",
  "Wheel Alignment",
  "Suspension Repair",
  "Engine Repair",
  "Transmission / Driveline Repair",
  "Electrical / Lighting Repair",
  "HVAC Repair",
  "Cooling System Repair",
  "Exhaust / Emissions Repair",
  "Fuel System Repair",
  "Trailer Repair",
  "Reefer Unit Service",
  "Defect Repair",
  "Accident Repair",
  "Recall Repair",
  "Emergency / Roadside Repair",
  "Other",
]
const MAINTENANCE_STATUSES = ["Scheduled", "In Progress", "Completed", "Cancelled"] as const

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

/**
 * Read-only reference to canonical Roadside/CVSA Inspection Performance
 * Events (EVT-*) that this vehicle actually participated in, as either the
 * resolved Power Unit or a resolved Towed Unit. Nothing here is copied or
 * editable — PerformanceEventRecord in the Driver store remains the sole
 * canonical record; edit it from Driver Performance. An unrelated vehicle
 * that never participated in any event correctly renders nothing.
 */
function RoadsideInspectionsPanel({ companyId, vehicleId }: { companyId: string; vehicleId: string }) {
  const [matches, setMatches] = useState<RoadsideEventForVehicle[]>([])

  useEffect(() => {
    try {
      setMatches(getRoadsideEventsForVehicle(companyId, vehicleId))
    } catch {
      setMatches([])
    }
  }, [companyId, vehicleId])

  if (matches.length === 0) return null

  return (
    <Card className="mb-2">
      <SectionTitleComponent
        title="Roadside / CVSA Inspections"
        description="Canonical Driver Performance events this unit participated in — read-only here, edit in Driver Performance."
      />
      <div className="space-y-2 p-3">
        {matches.map(({ event, matchedRole, resolution }) => {
          const violations = getRoadsideViolationCollection(event)?.items || []
          return (
            <div key={`${event.id}:${resolution.relationshipKey}`} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold">{event.summary || "Roadside Inspection"}</h4>
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {matchedRole === "POWER_UNIT" ? "Power Unit" : "Towed Unit"}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{event.id}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">{event.eventDate}</p>
                  <p className="text-[10px] text-muted-foreground">{resolution.resolvedEntitySummary ? "Matched" : resolution.state}</p>
                </div>
              </div>
              {violations.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {violations.map((item) => (
                    <p key={item.itemId} className="text-[11px] text-muted-foreground">
                      • {String(item.facts.description || item.facts.ruleRegulationCode || "Violation")}
                      {item.facts.oosState === "YES" ? <span className="ml-1 font-semibold text-destructive">OOS</span> : null}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">No violations recorded.</p>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export function MaintenanceTab({
  companyId, store, vehicle, inspections, maintenance, evidence, onStoreChange,
  onStartOCR, pendingInspectionEvidenceId, pendingMaintenanceEvidenceId,
  clearInspectionEvidence, clearMaintenanceEvidence, setError, setNotice, onRecordClick,
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
  const [repairBillRefreshKey, setRepairBillRefreshKey] = useState(0)
  const partCatalog = useMemo(() => loadPartCatalog(), [repairBillRefreshKey])
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

  return (
    <div className="space-y-3">
      <Card>
        <SectionTitleComponent
          title="Maintenance / Inspections"
          description="OCR-first document entry alongside manual operational records."
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => onStartOCR(view === "inspections" ? "inspection" : "maintenance", view === "inspections" ? "Inspection Document" : "Maintenance Work Order / Invoice")}>
                <Upload className="mr-1.5 size-3.5" />Upload Document / OCR
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setEditingInspection(null); setShowInspection(true) }}>
                <Plus className="mr-1.5 size-3.5" />Add Inspection
              </Button>
              <Button size="sm" onClick={() => { setEditingMaintenance(null); setShowMaintenance(true) }}>
                <Wrench className="mr-1.5 size-3.5" />Add Maintenance Record
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowRepairBill(true)}>
                <Plus className="mr-1.5 size-3.5" />Add Repair Bill
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

      {view === "repairBills" ? (
        <RepairBillsView
          companyId={companyId}
          vehicle={vehicle}
          repairInvoices={repairInvoices}
          partCatalog={partCatalog}
          spendSummary={spendSummary}
          spendByCategory={spendByCategory}
          recurringIssues={recurringIssues}
          onAddRepairBill={() => setShowRepairBill(true)}
          EmptyStateComponent={EmptyStateComponent}
          SectionTitleComponent={SectionTitleComponent}
          StatusPillComponent={StatusPillComponent}
        />
      ) : null}

      {view === "inspections" ? (
        <RoadsideInspectionsPanel companyId={companyId} vehicleId={vehicle.id} />
      ) : null}

      {view === "inspections" ? (
        activeInspections.length === 0 ? (
          <EmptyStateComponent title="No inspection records" description="Upload an inspection document or add an inspection manually." action={<Button onClick={() => setShowInspection(true)}><Plus className="mr-1.5 size-4" />Add Inspection</Button>} />
        ) : (
          <div className="space-y-2">
            {activeInspections.map((record) => (
              <Card key={record.id} className="cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => onRecordClick?.(record)}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.inspectionType}</h3><StatusPillComponent value={record.inspectionStatus} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div>
                  <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditingInspection(record); setShowInspection(true) }}><Edit3 className="mr-1 size-3" />Edit</Button><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); archiveInspection(record) }}><Archive className="mr-1 size-3" />Archive</Button></div>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-4">
                  <ReadOnlyField label="Inspection Date" value={record.inspectionDate || "—"} />
                  <ReadOnlyField label="Expiry Date" value={record.expiryDate || "—"} />
                  <ReadOnlyField label="Next Due Date" value={record.nextDueDate || "—"} />
                  <ReadOnlyField label="Inspector / Shop" value={record.inspectorShopName || "—"} />
                  <ReadOnlyField label="Odometer" value={record.odometer || "—"} />
                  <ReadOnlyField label="Engine Hours" value={record.engineHours || "—"} />
                  <ReadOnlyField label="Defects Found" value={record.defectsFound} />
                  <ReadOnlyField label="Evidence" value={record.evidenceIds.length ? `${record.evidenceIds.length} attached` : "Missing"} />
                </div>
                <InspectionFindingsPanel companyId={companyId} store={store} onStoreChange={onStoreChange} inspection={record} setNotice={setNotice} setError={setError} />
              </Card>
            ))}
          </div>
        )
      ) : null}

      {view === "maintenance" ? (
        activeMaintenance.length === 0 ? (
          <EmptyStateComponent title="No maintenance records" description="Upload a work order/invoice or add a maintenance record manually." action={<Button onClick={() => setShowMaintenance(true)}><Plus className="mr-1.5 size-4" />Add Maintenance</Button>} />
        ) : (
          <div className="space-y-2">
            {activeMaintenance.map((record) => (
              <Card key={record.id} className="cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => onRecordClick?.(record)}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.maintenanceType}</h3><StatusPillComponent value={record.maintenanceStatus} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div>
                  <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditingMaintenance(record); setShowMaintenance(true) }}><Edit3 className="mr-1 size-3" />Edit</Button><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); archiveMaintenance(record) }}><Archive className="mr-1 size-3" />Archive</Button></div>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-4">
                  <ReadOnlyField label="Service Date" value={record.serviceDate || "—"} />
                  <ReadOnlyField label="Odometer" value={record.odometer || "—"} />
                  <ReadOnlyField label="Work Order / Invoice" value={record.workOrderInvoiceNumber || "—"} />
                  <ReadOnlyField label="Vendor" value={record.vendor || "—"} />
                  <ReadOnlyField label="Parts Cost" value={money(record.partsCost)} />
                  <ReadOnlyField label="Total Cost" value={money(record.totalCost)} />
                  <ReadOnlyField label="Next Service Due" value={record.nextServiceDueDate || "—"} />
                  <ReadOnlyField label="Evidence" value={record.evidenceIds.length ? `${record.evidenceIds.length} attached` : "Missing"} />
                </div>
                <MaintenanceItemsPanel companyId={companyId} store={store} onStoreChange={onStoreChange} record={record} setNotice={setNotice} setError={setError} />
              </Card>
            ))}
          </div>
        )
      ) : null}

      {showInspection ? <InspectionForm companyId={companyId} store={store} vehicle={vehicle} initial={editingInspection} pendingEvidenceId={pendingInspectionEvidenceId} clearPendingEvidence={clearInspectionEvidence} onStartOCR={() => onStartOCR("inspection", "Inspection Document")} onClose={() => setShowInspection(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} ModalShellComponent={ModalShellComponent} ModalOCRStripComponent={ModalOCRStripComponent} ModalSectionLabelComponent={ModalSectionLabelComponent} ModalFieldGridComponent={ModalFieldGridComponent} ModalFieldComponent={ModalFieldComponent} ModalEvidenceCardComponent={ModalEvidenceCardComponent} ModalFooterComponent={ModalFooterComponent} modalFieldInputClass={modalFieldInputClass} /> : null}
      {showMaintenance ? <MaintenanceForm companyId={companyId} store={store} vehicle={vehicle} initial={editingMaintenance} pendingEvidenceId={pendingMaintenanceEvidenceId} clearPendingEvidence={clearMaintenanceEvidence} onStartOCR={() => onStartOCR("maintenance", "Maintenance Work Order / Invoice")} onClose={() => setShowMaintenance(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} ModalShellComponent={ModalShellComponent} ModalOCRStripComponent={ModalOCRStripComponent} ModalSectionLabelComponent={ModalSectionLabelComponent} ModalFieldGridComponent={ModalFieldGridComponent} ModalFieldComponent={ModalFieldComponent} ModalEvidenceCardComponent={ModalEvidenceCardComponent} ModalFooterComponent={ModalFooterComponent} modalFieldInputClass={modalFieldInputClass} /> : null}
      {showRepairBill ? (
        <RepairBillForm
          companyId={companyId}
          vehicle={vehicle}
          store={store}
          onClose={() => setShowRepairBill(false)}
          onSaved={() => {
            setShowRepairBill(false)
            setView("repairBills")
            setRepairBillRefreshKey((k) => k + 1)
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
    </div>
  )
}

function InspectionForm({ companyId, store, vehicle, initial, pendingEvidenceId, clearPendingEvidence, onStartOCR, onClose, onStoreChange, setError, setNotice, ModalShellComponent, ModalOCRStripComponent, ModalSectionLabelComponent, ModalFieldGridComponent, ModalFieldComponent, ModalEvidenceCardComponent, ModalFooterComponent, modalFieldInputClass }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehicleInspectionRecord | null; pendingEvidenceId: string | null; clearPendingEvidence: () => void; onStartOCR: () => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void; ModalShellComponent: AnyComponent; ModalOCRStripComponent: AnyComponent; ModalSectionLabelComponent: AnyComponent; ModalFieldGridComponent: AnyComponent; ModalFieldComponent: AnyComponent; ModalEvidenceCardComponent: AnyComponent; ModalFooterComponent: AnyComponent; modalFieldInputClass: string }) {
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
          <Input className={modalFieldInputClass} type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Expiry Date">
          <Input className={modalFieldInputClass} type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Next Due Date">
          <Input className={modalFieldInputClass} type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
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
      <div className="px-6 grid grid-cols-2 gap-3 pb-4">
        <ModalEvidenceCardComponent
          label="Inspection Document"
          attached={evidenceIds.length > 0}
          attachedNote={evidenceIds.length ? `${evidenceIds.length} attached` : undefined}
          onAttach={onStartOCR}
        />
      </div>
    </ModalShellComponent>
  )
}

function MaintenanceForm({ companyId, store, vehicle, initial, pendingEvidenceId, clearPendingEvidence, onStartOCR, onClose, onStoreChange, setError, setNotice, ModalShellComponent, ModalOCRStripComponent, ModalSectionLabelComponent, ModalFieldGridComponent, ModalFieldComponent, ModalEvidenceCardComponent, ModalFooterComponent, modalFieldInputClass }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehicleMaintenanceRecord | null; pendingEvidenceId: string | null; clearPendingEvidence: () => void; onStartOCR: () => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void; ModalShellComponent: AnyComponent; ModalOCRStripComponent: AnyComponent; ModalSectionLabelComponent: AnyComponent; ModalFieldGridComponent: AnyComponent; ModalFieldComponent: AnyComponent; ModalEvidenceCardComponent: AnyComponent; ModalFooterComponent: AnyComponent; modalFieldInputClass: string }) {
  const [maintenanceType, setMaintenanceType] = useState(initial?.maintenanceType || MAINTENANCE_TYPES[0])
  const [maintenanceStatus, setMaintenanceStatus] = useState<VehicleMaintenanceRecord["maintenanceStatus"]>(initial?.maintenanceStatus || "Completed")
  const [serviceDate, setServiceDate] = useState(initial?.serviceDate || "")
  const [odometer, setOdometer] = useState(initial?.odometer || "")
  const [engineHours, setEngineHours] = useState(initial?.engineHours || "")
  const [vendor, setVendor] = useState(initial?.vendor || "")
  const [workOrderInvoiceNumber, setWorkOrderInvoiceNumber] = useState(initial?.workOrderInvoiceNumber || initial?.workOrderNumber || initial?.invoiceNumber || "")
  const [partsCost, setPartsCost] = useState(initial?.partsCost || "")
  const [totalCost, setTotalCost] = useState(initial?.totalCost || "")
  const [nextServiceDueDate, setNextServiceDueDate] = useState(initial?.nextServiceDueDate || "")
  const [notes, setNotes] = useState(initial?.notes || "")
  const [evidenceIds, setEvidenceIds] = useState<string[]>(initial?.evidenceIds || [])
  useEffect(() => { if (pendingEvidenceId) { setEvidenceIds((current) => Array.from(new Set([...current, pendingEvidenceId]))); clearPendingEvidence() } }, [pendingEvidenceId, clearPendingEvidence])
  const save = () => { const now = isoNow(); const record: VehicleMaintenanceRecord = { id: initial?.id || createId("MNT"), vehicleId: vehicle.id, maintenanceType, maintenanceStatus, serviceDate, odometer, engineHours, vendor, workOrderInvoiceNumber, partsCost, totalCost, nextServiceDueDate, evidenceIds, notes, archived: initial?.archived || false, createdAt: initial?.createdAt || now, updatedAt: now, workOrderNumber: initial?.workOrderNumber, invoiceNumber: initial?.invoiceNumber, labourCost: initial?.labourCost, nextServiceDueOdometer: initial?.nextServiceDueOdometer }; const next = { ...store, maintenanceRecords: initial ? store.maintenanceRecords.map((item) => item.id === initial.id ? record : item) : [record, ...store.maintenanceRecords] }; try { saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: initial ? "UPDATE" : "CREATE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `${initial ? "Updated" : "Created"} maintenance record ${record.id}.` }); setNotice("Maintenance record saved."); onClose() } catch (err) { setError(err instanceof Error ? err.message : "Maintenance record could not be saved.") } }
  return (
    <ModalShellComponent
      title={`${initial ? "Edit" : "Add"} Maintenance Record`}
      subtitle="One Work Order / Invoice Number. Parts Cost and Total Cost are independently stored."
      onClose={onClose}
      footer={<ModalFooterComponent note="Attach work order, invoice, or service record." onCancel={onClose} onSave={save} saveLabel="Save Maintenance" />}
    >
      <ModalOCRStripComponent
        title="Work Order / Invoice Document"
        description="Start with the source document and review it before saving."
        onStartOCR={onStartOCR}
      />

      <ModalSectionLabelComponent>Maintenance Details</ModalSectionLabelComponent>
      <ModalFieldGridComponent>
        <ModalFieldComponent label="Maintenance Type" required>
          <select className={modalFieldInputClass} value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)}>
            {MAINTENANCE_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Maintenance Status" required>
          <select className={modalFieldInputClass} value={maintenanceStatus} onChange={(e) => setMaintenanceStatus(e.target.value as VehicleMaintenanceRecord["maintenanceStatus"])}>
            {MAINTENANCE_STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalFieldComponent>
        <ModalFieldComponent label="Service Date" required>
          <Input className={modalFieldInputClass} type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Odometer">
          <Input className={modalFieldInputClass} value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Engine Hours">
          <Input className={modalFieldInputClass} value={engineHours} onChange={(e) => setEngineHours(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Vendor">
          <Input className={modalFieldInputClass} value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Work Order / Invoice #">
          <Input className={modalFieldInputClass} value={workOrderInvoiceNumber} onChange={(e) => setWorkOrderInvoiceNumber(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Next Service Due">
          <Input className={modalFieldInputClass} type="date" value={nextServiceDueDate} onChange={(e) => setNextServiceDueDate(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Parts Cost">
          <Input className={modalFieldInputClass} type="number" min="0" value={partsCost} onChange={(e) => setPartsCost(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Total Cost">
          <Input className={modalFieldInputClass} type="number" min="0" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} />
        </ModalFieldComponent>
        <ModalFieldComponent label="Notes" className="col-span-2">
          <Textarea rows={3} className={modalFieldInputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </ModalFieldComponent>
      </ModalFieldGridComponent>

      <ModalSectionLabelComponent>Evidence</ModalSectionLabelComponent>
      <div className="px-6 grid grid-cols-2 gap-3 pb-4">
        <ModalEvidenceCardComponent
          label="Work Order / Invoice Document"
          attached={evidenceIds.length > 0}
          attachedNote={evidenceIds.length ? `${evidenceIds.length} attached` : undefined}
          onAttach={onStartOCR}
        />
      </div>
    </ModalShellComponent>
  )
}
