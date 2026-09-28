"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ISODateInput } from "@/src/components/shared/ISODateInput"
import {
  buildDefaultScheduledMaintenanceActions,
  buildDefaultScheduledMaintenanceChecklist,
  createScheduledMaintenanceId,
  deriveScheduledMaintenanceOutcome,
  lockScheduledMaintenanceSubmission,
  validateScheduledMaintenanceSubmission,
  type DistanceUnit,
  type MaintenanceChecklistStatus,
  type MaintenancePerformedBy,
  type ScheduledMaintenanceBasis,
  type ScheduledMaintenanceSubmission,
} from "@/lib/scheduled-maintenance-data"

export interface ScheduledMaintenanceVehicleOption {
  vehicleId: string
  unitNumber: string
  vin: string
  plateNumber?: string
  plateJurisdiction?: string
  vehicleYear?: string
  vehicleMake?: string
  vehicleModel?: string
  tireSize?: string
  odometerUnit?: DistanceUnit
}

export interface ScheduledMaintenancePortalFormProps {
  companyId: string
  companyName: string
  vehicles: ScheduledMaintenanceVehicleOption[]
  defaultVehicleId?: string
  onSubmit: (record: ScheduledMaintenanceSubmission) => void
  onCancel?: () => void
}

const BASIS_OPTIONS: { value: ScheduledMaintenanceBasis; label: string }[] = [
  { value: "COMBINED", label: "Date / odometer / engine hours" },
  { value: "CALENDAR", label: "Date only" },
  { value: "ODOMETER", label: "Odometer only" },
  { value: "ENGINE_HOURS", label: "Engine hours only" },
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

export function ScheduledMaintenancePortalForm({
  companyId,
  companyName,
  vehicles,
  defaultVehicleId,
  onSubmit,
  onCancel,
}: ScheduledMaintenancePortalFormProps) {
  const [vehicleId, setVehicleId] = useState(defaultVehicleId || vehicles[0]?.vehicleId || "")
  const vehicle = useMemo(() => vehicles.find((item) => item.vehicleId === vehicleId), [vehicleId, vehicles])
  const [basis, setBasis] = useState<ScheduledMaintenanceBasis>("COMBINED")
  const [serviceDate, setServiceDate] = useState("")
  const [serviceCompletionDate, setServiceCompletionDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [odometer, setOdometer] = useState("")
  const [dueOdometer, setDueOdometer] = useState("")
  const [engineHours, setEngineHours] = useState("")
  const [dueEngineHours, setDueEngineHours] = useState("")
  const [nextDueDate, setNextDueDate] = useState("")
  const [nextDueOdometer, setNextDueOdometer] = useState("")
  const [nextDueEngineHours, setNextDueEngineHours] = useState("")
  const [performedBy, setPerformedBy] = useState<MaintenancePerformedBy>("IN_HOUSE")
  const [facilityName, setFacilityName] = useState("")
  const [facilityAddress, setFacilityAddress] = useState("")
  const [technicianName, setTechnicianName] = useState("")
  const [workOrderNumber, setWorkOrderNumber] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [submittedByName, setSubmittedByName] = useState("")
  const [submittedByRole, setSubmittedByRole] = useState("")
  const [remarks, setRemarks] = useState("")
  const [checklist, setChecklist] = useState(buildDefaultScheduledMaintenanceChecklist())
  const [actions, setActions] = useState(buildDefaultScheduledMaintenanceActions())
  const [error, setError] = useState<string | null>(null)
  const outcome = deriveScheduledMaintenanceOutcome(checklist)

  const submit = () => {
    if (!vehicle) return setError("Select a vehicle.")
    const now = new Date().toISOString()
    const record: ScheduledMaintenanceSubmission = {
      id: createScheduledMaintenanceId("PM"),
      companyId,
      vehicleId: vehicle.vehicleId,
      unitNumber: vehicle.unitNumber,
      vin: vehicle.vin,
      plateNumber: vehicle.plateNumber,
      plateJurisdiction: vehicle.plateJurisdiction,
      vehicleYear: vehicle.vehicleYear,
      vehicleMake: vehicle.vehicleMake,
      vehicleModel: vehicle.vehicleModel,
      tireSize: vehicle.tireSize,
      source: "CLIENT_PORTAL",
      status: "DRAFT",
      submittedByName,
      submittedByRole,
      submittedAt: now,
      programName: "Preventive / Scheduled Maintenance",
      basis,
      triggerSource: "SCHEDULED",
      dueDate: dueDate || undefined,
      dueOdometer: dueOdometer ? Number(dueOdometer) : undefined,
      dueEngineHours: dueEngineHours ? Number(dueEngineHours) : undefined,
      serviceDate,
      serviceCompletionDate: serviceCompletionDate || serviceDate,
      odometer: Number(odometer),
      odometerUnit: vehicle.odometerUnit || "KM",
      engineHours: engineHours ? Number(engineHours) : undefined,
      nextDueDate: nextDueDate || undefined,
      nextDueOdometer: nextDueOdometer ? Number(nextDueOdometer) : undefined,
      nextDueEngineHours: nextDueEngineHours ? Number(nextDueEngineHours) : undefined,
      performedBy,
      facilityName,
      facilityAddress,
      technicianName,
      workOrderNumber,
      invoiceNumber,
      outcome,
      checklist,
      serviceActions: actions,
      remarks,
      evidenceIds: [],
      linkedRepairRecordIds: [],
      createdAt: now,
      updatedAt: now,
    }
    const validation = validateScheduledMaintenanceSubmission(record)
    if (!validation.ok) return setError(validation.errors.join(" "))
    setError(null)
    onSubmit(lockScheduledMaintenanceSubmission(record, now))
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-bold">Preventive / Scheduled Maintenance</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{companyName} · submitted records become locked PDF-backed evidence.</p>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-1 text-xs font-semibold">Vehicle / Unit
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
            {vehicles.map((item) => <option key={item.vehicleId} value={item.vehicleId}>{item.unitNumber} · {item.vin}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold">Schedule Basis
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={basis} onChange={(event) => setBasis(event.target.value as ScheduledMaintenanceBasis)}>
            {BASIS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold">Performed By
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={performedBy} onChange={(event) => setPerformedBy(event.target.value as MaintenancePerformedBy)}>
            {PERFORMED_BY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold">Service Date<ISODateInput value={serviceDate} onValueChange={setServiceDate} required /></label>
        <label className="space-y-1 text-xs font-semibold">Service Completion Date<ISODateInput value={serviceCompletionDate} onValueChange={setServiceCompletionDate} /></label>
        <label className="space-y-1 text-xs font-semibold">Due Date<ISODateInput value={dueDate} onValueChange={setDueDate} /></label>
        <label className="space-y-1 text-xs font-semibold">Odometer<Input type="number" min="0" value={odometer} onChange={(event) => setOdometer(event.target.value)} required /></label>
        <label className="space-y-1 text-xs font-semibold">Due Odometer<Input type="number" min="0" value={dueOdometer} onChange={(event) => setDueOdometer(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-semibold">Engine Hours<Input type="number" min="0" value={engineHours} onChange={(event) => setEngineHours(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-semibold">Due Engine Hours<Input type="number" min="0" value={dueEngineHours} onChange={(event) => setDueEngineHours(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-semibold">Next Due Date<ISODateInput value={nextDueDate} onValueChange={setNextDueDate} /></label>
        <label className="space-y-1 text-xs font-semibold">Next Due Odometer<Input type="number" min="0" value={nextDueOdometer} onChange={(event) => setNextDueOdometer(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-semibold">Next Due Engine Hours<Input type="number" min="0" value={nextDueEngineHours} onChange={(event) => setNextDueEngineHours(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-semibold">Facility / Shop<Input value={facilityName} onChange={(event) => setFacilityName(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-semibold">Facility Address<Input value={facilityAddress} onChange={(event) => setFacilityAddress(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-semibold">Technician / Contact<Input value={technicianName} onChange={(event) => setTechnicianName(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-semibold">Work Order #<Input value={workOrderNumber} onChange={(event) => setWorkOrderNumber(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-semibold">Invoice #<Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-semibold">Submitted By<Input value={submittedByName} onChange={(event) => setSubmittedByName(event.target.value)} required /></label>
        <label className="space-y-1 text-xs font-semibold">Submitter Role<Input value={submittedByRole} onChange={(event) => setSubmittedByRole(event.target.value)} /></label>
      </div>

      <div className="border-t px-4 py-3">
        <p className="text-xs font-bold">Service Actions</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => (
            <label key={action.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
              <input type="checkbox" checked={action.performed} onChange={(event) => setActions((current) => current.map((item) => item.id === action.id ? { ...item, performed: event.target.checked } : item))} />
              {action.action}
            </label>
          ))}
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold">Checklist Outcome</p>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{outcome.replaceAll("_", " ").toLowerCase()}</span>
        </div>
        <div className="mt-2 space-y-2">
          {checklist.map((item) => (
            <div key={item.id} className="grid gap-2 rounded-lg border px-3 py-2 md:grid-cols-[180px_minmax(180px,1fr)_180px_minmax(180px,1fr)]">
              <p className="text-xs font-semibold">{item.system}</p>
              <p className="text-xs text-muted-foreground">{item.component}</p>
              <select className="h-9 rounded-md border bg-background px-2 text-xs" value={item.status} onChange={(event) => setChecklist((current) => current.map((row) => row.id === item.id ? { ...row, status: event.target.value as MaintenanceChecklistStatus, createsRepairNeed: event.target.value === "REPAIR_REQUIRED" } : row))}>
                {CHECKLIST_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <Input className="h-9 text-xs" value={item.notes || ""} placeholder="Measurement / note" onChange={(event) => setChecklist((current) => current.map((row) => row.id === item.id ? { ...row, notes: event.target.value } : row))} />
            </div>
          ))}
        </div>
      </div>

      <div className="border-t p-4">
        <label className="space-y-1 text-xs font-semibold">Remarks / repair instructions
          <Textarea rows={3} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
        </label>
        {error ? <p className="mt-2 text-xs font-semibold text-destructive">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          {onCancel ? <Button variant="outline" onClick={onCancel}>Cancel</Button> : null}
          <Button onClick={submit}>Submit Maintenance Report</Button>
        </div>
      </div>
    </Card>
  )
}

