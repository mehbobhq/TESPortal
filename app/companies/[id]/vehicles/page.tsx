"use client"

import { useEffect, useMemo, useState } from "react"
import type { Dispatch, ReactNode, SetStateAction } from "react"
import { useParams } from "next/navigation"
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  Edit3,
  FileText,
  Filter,
  Plus,
  RotateCcw,
  Search,
  Truck,
  Upload,
  Wrench,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { validateCompany } from "@/lib/company-validation"
import {
  createId,
  isoNow,
  loadVehicleStore,
  saveVehicleStore,
  validateVehicleUniqueness,
  type VehicleStore,
  type VehicleOwnershipRecord,
  type VehicleRegistrationRecord,
  type VehiclePermitRecord,
  type VehicleInspectionRecord,
  type VehicleMaintenanceRecord,
} from "@/lib/vehicle-data"
import { normalizeVIN, is17CharVIN } from "@/lib/identifier-normalization"
import { recordAuditEvent } from "@/lib/audit-logger"
import { JURISDICTIONS, getJurisdictionLabel } from "@/lib/jurisdictions"
import type { Company, EquipmentType, VehicleRecord, VehicleStatus } from "@/src/types"
import type { EvidenceRecord } from "@/types/evidence"
import type { OCRDocumentResult } from "@/types/ocr"
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker"
import { OCRReview } from "@/src/components/shared/OCRReview"
import { EvidencePanel } from "@/src/components/shared/EvidencePanel"
import { EntityPicker } from "@/src/components/shared/EntityPicker"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { UnsavedChangesPrompt } from "@/src/components/shared/UnsavedChangesPrompt"
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer"
import { CameraCapture } from "@/src/components/CameraCapture"

const VEHICLE_TYPES: EquipmentType[] = [
  "Tractor",
  "Trailer - Dry Van",
  "Trailer - Reefer",
  "Trailer - Flatbed",
  "Trailer - Step Deck / Lowboy",
  "Trailer - Intermodal Chassis",
  "Converter Dolly",
  "Straight Truck",
  "Service Vehicle",
  "Other Equipment",
]

const VEHICLE_STATUSES: VehicleStatus[] = [
  "Active",
  "Maintenance",
  "Out of Service",
  "Inactive",
]

const REGISTRATION_TYPES = [
  "Prorate PSV",
  "Urban",
  "Continuous",
  "Prorate Exempt Goods",
  "Public Service",
]

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

const INSPECTION_TYPES = [
  "Annual / Periodic Vehicle Inspection",
  "Provincial / State Safety Inspection",
  "Emissions Test",
  "Pre-Trip Inspection",
  "Post-Trip Inspection / DVIR",
  "Scheduled Internal Inspection",
  "Brake Inspection",
  "Trailer Inspection",
  "Reefer / Temperature-Control Unit Inspection",
  "CVSA / Roadside Inspection",
  "Special Inspection",
  "Other",
]

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

const inputClass = "h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
const selectClass = inputClass

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function money(value: string) {
  const n = Number(value)
  return Number.isFinite(n) && value !== "" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n) : "—"
}

function addMonthsISO(dateValue: string, monthsValue: string) {
  if (!dateValue || !monthsValue || !Number.isFinite(Number(monthsValue)) || Number(monthsValue) <= 0) return ""
  const date = new Date(`${dateValue}T00:00:00`)
  date.setMonth(date.getMonth() + Number(monthsValue))
  return date.toISOString().slice(0, 10)
}

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

function statusTone(status: string) {
  if (["Active", "Pass", "Completed", "Verified"].includes(status)) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
  if (["Expired", "Fail", "Out of Service", "Cancelled"].includes(status)) return "bg-destructive/10 text-destructive border-destructive/20"
  if (["Expiring Soon", "Pass with Defects", "Pending"].includes(status)) return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20"
  return "bg-muted text-muted-foreground border-border"
}

function StatusPill({ value }: { value: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(value)}`}>{value}</span>
}

function Field({ label, children, required = false, className = "" }: { label: string; children: ReactNode; required?: boolean; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}{required ? <span className="ml-0.5 text-destructive">*</span> : null}</label>
      {children}
    </div>
  )
}

function Divider() {
  return <div className="my-4 border-t border-border" />
}

function SectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <h2 className="text-sm font-bold">{title}</h2>
        {description ? <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/10 px-5 py-8 text-center">
      <FileText className="mx-auto mb-2 size-7 text-muted-foreground/50" />
      <p className="text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

function readCompanies(): Company[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem("tes_companies")
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is Company => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string" && typeof (item as Record<string, unknown>).name === "string")) : []
  } catch {
    return []
  }
}

function makeOCRResult(file: File, documentType: string): OCRDocumentResult {
  return {
    documentId: createId("DOC"),
    documentType,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    pageCount: 1,
    overallConfidence: 0,
    extractedFields: {},
    processedAt: isoNow(),
    adapterVersion: "Shared OCR review — no repository OCR adapter configured",
  }
}

type OCRContext =
  | { kind: "profile" }
  | { kind: "ownership"; recordId?: string; documentType: string }
  | { kind: "registration"; recordId?: string; documentType: string }
  | { kind: "permit"; recordId?: string; documentType: string }
  | { kind: "inspection"; recordId?: string; documentType: string }
  | { kind: "maintenance"; recordId?: string; documentType: string }

type VehicleProfileRecord = VehicleRecord & {
  fleetStartDate?: string
  fleetEndDate?: string
  tareWeightUnit?: "kg" | "lb"
  equipmentLengthUnit?: "ft" | "m"
}

interface ProfileForm {
  unitNumber: string
  equipmentType: EquipmentType
  status: VehicleStatus
  vin: string
  year: string
  make: string
  model: string
  color: string
  operatingRegion: VehicleRecord["operatingRegion"]
  axles: string
  fleetStartDate: string
  fleetEndDate: string
  tareWeight: string
  tareWeightUnit: "kg" | "lb"
  fuelType: VehicleRecord["fuelType"]
  equipmentLength: string
  equipmentLengthUnit: "ft" | "m"
  gpsProvider: string
}

function profileFromVehicle(vehicle: VehicleRecord): ProfileForm {
  const profileVehicle = vehicle as VehicleProfileRecord
  return {
    unitNumber: vehicle.unitNumber || "",
    equipmentType: vehicle.equipmentType,
    status: vehicle.status === "Archived" ? "Inactive" : vehicle.status,
    vin: vehicle.vin || "",
    year: vehicle.year || "",
    make: vehicle.make || "",
    model: vehicle.model || "",
    color: vehicle.color || "",
    operatingRegion: vehicle.operatingRegion,
    axles: String(vehicle.axles ?? ""),
    fleetStartDate: profileVehicle.fleetStartDate || "",
    fleetEndDate: profileVehicle.fleetEndDate || "",
    tareWeight: profileVehicle.tareWeightKgs !== undefined ? String(profileVehicle.tareWeightKgs) : "",
    tareWeightUnit: profileVehicle.tareWeightUnit || "kg",
    fuelType: vehicle.fuelType,
    equipmentLength: profileVehicle.lengthFeet || "",
    equipmentLengthUnit: profileVehicle.equipmentLengthUnit || "ft",
    gpsProvider: vehicle.gpsProvider || "",
  }
}

function buildVehicle(form: ProfileForm, existing?: VehicleRecord): VehicleRecord {
  const tareKg = form.tareWeightUnit === "kg" ? Number(form.tareWeight) : Number(form.tareWeight) * 0.45359237
  const lengthFt = form.equipmentLengthUnit === "ft" ? form.equipmentLength : Number.isFinite(Number(form.equipmentLength)) ? String(Number(form.equipmentLength) * 3.280839895) : ""
  const now = isoNow()
  const record: VehicleProfileRecord = {
    id: existing?.id || createId("VEH"),
    unitNumber: form.unitNumber.trim(),
    equipmentType: form.equipmentType,
    status: form.status,
    vin: normalizeVIN(form.vin),
    year: form.year.trim(),
    make: form.make.trim(),
    model: form.model.trim(),
    color: form.color.trim(),
    operatingRegion: form.operatingRegion,
    axles: Number(form.axles) || 0,
    lengthFeet: lengthFt,
    tareWeightKgs: Number.isFinite(tareKg) && form.tareWeight !== "" ? Math.round(tareKg * 100) / 100 : undefined,
    fuelType: form.fuelType,
    gpsProvider: form.gpsProvider.trim(),
    transponderNumber: existing?.transponderNumber,
    fleetStartDate: form.fleetStartDate || undefined,
    fleetEndDate: form.fleetEndDate || undefined,
    tareWeightUnit: form.tareWeightUnit,
    equipmentLengthUnit: form.equipmentLengthUnit,
    ownershipType: existing?.ownershipType || "Owned",
    ownerCompanyName: existing?.ownerCompanyName,
    purchaseDate: existing?.purchaseDate,
    purchasePrice: existing?.purchasePrice,
    leaseTermMonths: existing?.leaseTermMonths,
    leaseEndDate: existing?.leaseEndDate,
    registration: existing?.registration,
    permits: existing?.permits || [],
    inspections: existing?.inspections || [],
    evidenceIds: existing?.evidenceIds || [],
    source: existing?.source || "Manual",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    notes: existing?.notes,
  }
  return record
}

export default function VehiclesPage() {
  const params = useParams()
  const companyId = String(params.id || "")
  const [store, setStore] = useState<VehicleStore | null>(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [typeFilter, setTypeFilter] = useState("All")
  const [showFilters, setShowFilters] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    if (!companyId) return
    setStore(loadVehicleStore(companyId))
  }, [companyId])

  const vehicles = store?.vehicles || []
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || null

  const filteredVehicles = useMemo(() => {
    const term = search.trim().toLowerCase()
    return vehicles.filter((vehicle) => {
      if (vehicle.status === "Archived") return false
      const matchesSearch = !term || vehicle.unitNumber.toLowerCase().includes(term) || vehicle.vin.toLowerCase().includes(term)
      const matchesStatus = statusFilter === "All" || vehicle.status === statusFilter
      const matchesType = typeFilter === "All" || vehicle.equipmentType === typeFilter
      return matchesSearch && matchesStatus && matchesType
    })
  }, [vehicles, search, statusFilter, typeFilter])

  const commitStore = (next: VehicleStore, audit?: { action: "CREATE" | "UPDATE" | "ARCHIVE" | "RESTORE"; entityId: string; details: string }) => {
    try {
      saveVehicleStore(companyId, next)
      setStore(next)
      if (audit) {
        recordAuditEvent({
          action: audit.action,
          entityType: "Vehicle",
          entityId: audit.entityId,
          companyId,
          actor: "",
          role: "",
          details: audit.details,
        })
      }
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vehicle changes could not be saved.")
      return false
    }
  }

  const createVehicle = (form: ProfileForm, sourceEvidence?: EvidenceRecord) => {
    const vehicle = buildVehicle(form)
    if (!vehicle.unitNumber) return setError("Equipment Number is required.")
    if (!vehicle.vin || !is17CharVIN(vehicle.vin)) return setError("VIN must contain 17 valid VIN characters.")
    if (vehicles.some((item) => item.id !== vehicle.id && item.status !== "Archived" && item.unitNumber.trim().toUpperCase() === vehicle.unitNumber.trim().toUpperCase())) {
      return setError(`Equipment Number "${vehicle.unitNumber}" already exists in this company.`)
    }
    const collision = validateVehicleUniqueness(companyId, vehicle.vin, "", vehicle.id)
    if (!collision.isValid) return setError(collision.message || "Vehicle identity collision detected.")
    const savedVehicle = sourceEvidence ? { ...vehicle, evidenceIds: Array.from(new Set([...vehicle.evidenceIds, sourceEvidence.id])) } : vehicle
    const next: VehicleStore = { ...store!, vehicles: [...vehicles, savedVehicle], evidence: sourceEvidence ? [{ ...sourceEvidence, entityId: savedVehicle.id }, ...store!.evidence] : store!.evidence }
    if (commitStore(next, { action: "CREATE", entityId: savedVehicle.id, details: `Created Vehicle ${savedVehicle.unitNumber}.` })) {
      setSelectedVehicleId(vehicle.id)
      setShowCreate(false)
      setNotice("Vehicle saved successfully.")
    }
  }

  const updateVehicle = (vehicle: VehicleRecord) => {
    if (!vehicle.unitNumber) return setError("Equipment Number is required.")
    if (!vehicle.vin || !is17CharVIN(vehicle.vin)) return setError("VIN must contain 17 valid VIN characters.")
    if (vehicles.some((item) => item.id !== vehicle.id && item.status !== "Archived" && item.unitNumber.trim().toUpperCase() === vehicle.unitNumber.trim().toUpperCase())) {
      return setError(`Equipment Number "${vehicle.unitNumber}" already exists in this company.`)
    }
    const collision = validateVehicleUniqueness(companyId, vehicle.vin, "", vehicle.id)
    if (!collision.isValid) return setError(collision.message || "Vehicle identity collision detected.")
    const next: VehicleStore = { ...store!, vehicles: vehicles.map((item) => item.id === vehicle.id ? vehicle : item) }
    if (commitStore(next, { action: "UPDATE", entityId: vehicle.id, details: `Updated Vehicle ${vehicle.unitNumber}.` })) setNotice("Vehicle profile saved.")
  }

  const archiveVehicle = (vehicle: VehicleRecord) => {
    const next: VehicleStore = { ...store!, vehicles: vehicles.map((item) => item.id === vehicle.id ? { ...item, status: "Archived", updatedAt: isoNow() } : item) }
    if (commitStore(next, { action: "ARCHIVE", entityId: vehicle.id, details: `Archived Vehicle ${vehicle.unitNumber}.` })) {
      setSelectedVehicleId(null)
      setNotice("Vehicle archived. Historical data was retained.")
    }
  }

  const restoreVehicle = (vehicle: VehicleRecord) => {
    const next: VehicleStore = { ...store!, vehicles: vehicles.map((item) => item.id === vehicle.id ? { ...item, status: "Inactive", updatedAt: isoNow() } : item) }
    if (commitStore(next, { action: "RESTORE", entityId: vehicle.id, details: `Restored Vehicle ${vehicle.unitNumber}.` })) setNotice("Vehicle restored as Inactive.")
  }

  if (!store) return <div className="p-8 text-sm text-muted-foreground">Loading vehicles…</div>

  if (selectedVehicle) {
    return (
      <VehicleWorkspace
        companyId={companyId}
        store={store}
        vehicle={selectedVehicle}
        onStoreChange={setStore}
        onSaveVehicle={updateVehicle}
        onBack={() => setSelectedVehicleId(null)}
        onArchive={() => archiveVehicle(selectedVehicle)}
        onRestore={() => restoreVehicle(selectedVehicle)}
        error={error}
        setError={setError}
        notice={notice}
        setNotice={setNotice}
      />
    )
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-5 text-foreground">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{filteredVehicles.length}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Company-scoped vehicle master records and historical compliance records.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search equipment or VIN…" className="h-9 w-[260px] pl-9 text-xs" />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters((value) => !value)}><Filter className="mr-1.5 size-3.5" />Filters</Button>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-1.5 size-3.5" />Add Vehicle</Button>
        </div>
      </div>

      {error ? <AlertBanner message={error} onClose={() => setError(null)} /> : null}
      {notice ? <NoticeBanner message={notice} onClose={() => setNotice(null)} /> : null}

      {showFilters ? (
        <Card className="grid gap-3 p-3 sm:grid-cols-3">
          <Field label="Status"><select className={selectClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All</option>{VEHICLE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field>
          <Field label="Vehicle Type"><select className={selectClass} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>All</option>{VEHICLE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
          <div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => { setStatusFilter("All"); setTypeFilter("All") }}>Clear</Button></div>
        </Card>
      ) : null}

      {filteredVehicles.length === 0 ? (
        <EmptyState title="No vehicles in this company" description="Start with a vehicle document so TES can route the source through the shared OCR review workflow." action={<Button onClick={() => setShowCreate(true)}><Plus className="mr-1.5 size-4" />Add Vehicle</Button>} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-4 py-3">Equipment</th><th className="px-4 py-3">VIN</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Operating Region</th><th className="px-4 py-3 text-right">Open</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="cursor-pointer hover:bg-muted/20" onClick={() => setSelectedVehicleId(vehicle.id)}>
                    <td className="px-4 py-3"><div className="font-semibold">{vehicle.unitNumber || "—"}</div><div className="font-mono text-[10px] text-muted-foreground">{vehicle.id}</div></td>
                    <td className="px-4 py-3 font-mono text-[11px]">{vehicle.vin || "—"}</td>
                    <td className="px-4 py-3">{vehicle.equipmentType}</td>
                    <td className="px-4 py-3"><StatusPill value={vehicle.status} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{vehicle.operatingRegion}</td>
                    <td className="px-4 py-3 text-right"><ChevronRight className="ml-auto size-4 text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showCreate ? <VehicleCreateDialog companyId={companyId} onClose={() => setShowCreate(false)} onSave={createVehicle} setError={setError} /> : null}
    </div>
  )
}

function AlertBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"><span className="flex items-center gap-2"><AlertCircle className="size-4" />{message}</span><button onClick={onClose}><X className="size-4" /></button></div>
}
function NoticeBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"><span className="flex items-center gap-2"><Check className="size-4" />{message}</span><button onClick={onClose}><X className="size-4" /></button></div>
}

function VehicleCreateDialog({ companyId, onClose, onSave, setError }: { companyId: string; onClose: () => void; onSave: (form: ProfileForm, evidence?: EvidenceRecord) => void; setError: (value: string | null) => void }) {
  const [form, setForm] = useState<ProfileForm>({ unitNumber: "", equipmentType: "Tractor", status: "Active", vin: "", year: "", make: "", model: "", color: "", operatingRegion: "US Only", axles: "", fleetStartDate: "", fleetEndDate: "", tareWeight: "", tareWeightUnit: "kg", fuelType: "Diesel", equipmentLength: "", equipmentLengthUnit: "ft", gpsProvider: "" })
  const [sourceOpen, setSourceOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [ocrOpen, setOCROpen] = useState(false)
  const [ocrDataUrl, setOCRDataUrl] = useState("")
  const [ocrResult, setOCRResult] = useState<OCRDocumentResult | null>(null)
  const [ocrFile, setOCRFile] = useState<File | null>(null)
  const [pendingEvidence, setPendingEvidence] = useState<EvidenceRecord | null>(null)

  const startOCR = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      setOCRDataUrl(String(reader.result || ""))
      setOCRFile(file)
      setOCRResult(makeOCRResult(file, "Vehicle Profile Document"))
      setOCROpen(true)
    }
    reader.readAsDataURL(file)
  }

  const confirmOCR = (values: Record<string, unknown>, attachment: { fileRef: string; fileName: string; ocrConfidence: number }) => {
    setForm((current) => ({ ...current, ...Object.fromEntries(Object.entries(values).filter(([key]) => key in current)) as Partial<ProfileForm> }))
    if (ocrFile) {
      setPendingEvidence({
        id: attachment.fileRef,
        companyId,
        entityType: "Vehicle",
        entityId: "",
        documentType: "Vehicle Profile Document",
        fileName: attachment.fileName,
        mimeType: ocrFile.type || "application/octet-stream",
        fileReference: ocrDataUrl,
        fileSize: ocrFile.size,
        documentDate: todayISO(),
        uploadedAt: isoNow(),
        uploadedBy: "",
        source: "upload",
        verificationState: "verified",
        ocrMetadata: { overallConfidence: attachment.ocrConfidence, extractedFieldKeys: Object.keys(values), processedAt: isoNow() },
      })
    }
    setOCROpen(false)
  }

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
    <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-sm font-bold">Create Vehicle</h2><p className="text-[11px] text-muted-foreground">OCR/document capture is the first entry path.</p></div><button onClick={onClose}><X className="size-4" /></button></div>
      <div className="p-4"><VehicleProfileForm companyId={companyId} vehicle={null} form={form} setForm={setForm} onCancel={onClose} onSave={() => { if (!form.vin || !is17CharVIN(form.vin)) { setError("VIN must contain 17 valid VIN characters."); return } onSave(form, pendingEvidence || undefined) }} onStartOCR={() => setSourceOpen(true)} forceOCRPrompt /></div>
    </div>
    {sourceOpen ? <DocumentSourcePicker isOpen onClose={() => setSourceOpen(false)} onSelectCamera={() => { setSourceOpen(false); setCameraOpen(true) }} onSelectFile={(file) => { setSourceOpen(false); startOCR(file) }} title="Vehicle Profile — OCR First" subtitle="Capture the source document before entering structured Vehicle fields." /> : null}
    {cameraOpen ? <CameraCapture onClose={() => setCameraOpen(false)} onCapture={(file) => { setCameraOpen(false); startOCR(file) }} /> : null}
    {ocrOpen && ocrResult && ocrDataUrl ? <div className="fixed inset-0 z-[160] bg-background"><OCRReview documentResult={ocrResult} documentDataUrl={ocrDataUrl} initialValues={{ unitNumber: form.unitNumber, vin: form.vin, year: form.year, make: form.make, model: form.model, color: form.color, axles: form.axles, tareWeight: form.tareWeight, equipmentLength: form.equipmentLength }} fieldDefinitions={[{ key: "unitNumber", label: "Equipment Number", required: true }, { key: "vin", label: "VIN", required: true }, { key: "year", label: "Year" }, { key: "make", label: "Make" }, { key: "model", label: "Model" }, { key: "color", label: "Color" }, { key: "axles", label: "Equipment Axles", type: "number" }, { key: "tareWeight", label: "Tare Weight", type: "number" }, { key: "equipmentLength", label: "Equipment Length", type: "number" }]} onConfirm={(values, attachment) => confirmOCR(values, attachment)} onCancel={() => setOCROpen(false)} /></div> : null}
  </div>
}
function VehicleWorkspace({ companyId, store, vehicle, onStoreChange, onSaveVehicle, onBack, onArchive, onRestore, error, setError, notice, setNotice }: {
  companyId: string
  store: VehicleStore
  vehicle: VehicleRecord
  onStoreChange: (store: VehicleStore) => void
  onSaveVehicle: (vehicle: VehicleRecord) => void
  onBack: () => void
  onArchive: () => void
  onRestore: () => void
  error: string | null
  setError: (value: string | null) => void
  notice: string | null
  setNotice: (value: string | null) => void
}) {
  const [tab, setTab] = useState<"profile" | "ownership" | "registrations" | "permits" | "maintenance" | "evidence">("profile")
  const [showOCR, setShowOCR] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [ocrContext, setOCRContext] = useState<OCRContext | null>(null)
  const [ocrFile, setOCRFile] = useState<File | null>(null)
  const [ocrDataUrl, setOCRDataUrl] = useState("")
  const [ocrResult, setOCRResult] = useState<OCRDocumentResult | null>(null)
  const [previewEvidence, setPreviewEvidence] = useState<EvidenceRecord | null>(null)

  const ownershipRecords = store.ownershipRecords.filter((record) => record.vehicleId === vehicle.id)
  const registrationRecords = store.registrationRecords.filter((record) => record.vehicleId === vehicle.id)
  const permitRecords = store.permitRecords.filter((record) => record.vehicleId === vehicle.id)
  const inspectionRecords = store.inspectionRecords.filter((record) => record.vehicleId === vehicle.id)
  const maintenanceRecords = store.maintenanceRecords.filter((record) => record.vehicleId === vehicle.id)
  const evidence = store.evidence.filter((item) => item.entityType === "Vehicle" && item.entityId === vehicle.id)

  const beginOCR = async (context: OCRContext, file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || "")
      setOCRContext(context)
      setOCRFile(file)
      setOCRDataUrl(dataUrl)
      setOCRResult(makeOCRResult(file, "Vehicle compliance document"))
      setShowOCR(true)
    }
    reader.readAsDataURL(file)
  }

  const openSourcePicker = (context: OCRContext) => {
    setOCRContext(context)
    setShowOCR(false)
    setOCRResult(null)
    setSourceContext(context)
  }

  const [sourceContext, setSourceContext] = useState<OCRContext | null>(null)

  const confirmOCR = (values: Record<string, unknown>, attachment: { fileRef: string; fileName: string; ocrConfidence: number }) => {
    if (!ocrContext || !ocrFile) return
    const now = isoNow()
    const evidenceRecord: EvidenceRecord = {
      id: attachment.fileRef || createId("DOC"),
      companyId,
      entityType: "Vehicle",
      entityId: vehicle.id,
      documentType: ocrContext.kind === "ownership" ? ocrContext.documentType : ocrContext.kind === "registration" ? ocrContext.documentType : ocrContext.kind === "permit" ? ocrContext.documentType : ocrContext.kind === "inspection" ? ocrContext.documentType : ocrContext.kind === "maintenance" ? ocrContext.documentType : "Vehicle Profile Document",
      fileName: attachment.fileName,
      mimeType: ocrFile.type || "application/octet-stream",
      fileReference: ocrDataUrl,
      fileSize: ocrFile.size,
      documentDate: todayISO(),
      uploadedAt: now,
      uploadedBy: "",
      source: "upload",
      verificationState: "verified",
      ocrMetadata: { overallConfidence: attachment.ocrConfidence, extractedFieldKeys: Object.keys(values), processedAt: now },
    }
    const next = { ...store, evidence: [evidenceRecord, ...store.evidence] }
    let nextTab = tab
    if (ocrContext.kind === "profile") {
      setProfileOCRValues(values)
      nextTab = "profile"
    } else if (ocrContext.kind === "ownership") {
      setPendingOwnershipEvidenceId(evidenceRecord.id)
      nextTab = "ownership"
    } else if (ocrContext.kind === "registration") {
      setPendingRegistrationEvidence({ id: evidenceRecord.id, documentType: ocrContext.documentType })
      nextTab = "registrations"
    } else if (ocrContext.kind === "permit") {
      setPendingPermitEvidenceId(evidenceRecord.id)
      nextTab = "permits"
    } else if (ocrContext.kind === "inspection") {
      setPendingInspectionEvidenceId(evidenceRecord.id)
      nextTab = "maintenance"
    } else if (ocrContext.kind === "maintenance") {
      setPendingMaintenanceEvidenceId(evidenceRecord.id)
      nextTab = "maintenance"
    }
    try {
      saveVehicleStore(companyId, next)
      onStoreChange(next)
      setTab(nextTab)
      setShowOCR(false)
      setOCRContext(null)
      setOCRFile(null)
      setOCRResult(null)
      setNotice("Document verified and attached to the Vehicle evidence record. Review the structured record before saving it.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evidence could not be saved.")
    }
  }

  const [profileOCRValues, setProfileOCRValues] = useState<Record<string, unknown> | null>(null)
  const [pendingOwnershipEvidenceId, setPendingOwnershipEvidenceId] = useState<string | null>(null)
  const [pendingRegistrationEvidence, setPendingRegistrationEvidence] = useState<{ id: string; documentType: string } | null>(null)
  const [pendingPermitEvidenceId, setPendingPermitEvidenceId] = useState<string | null>(null)
  const [pendingInspectionEvidenceId, setPendingInspectionEvidenceId] = useState<string | null>(null)
  const [pendingMaintenanceEvidenceId, setPendingMaintenanceEvidenceId] = useState<string | null>(null)

  const persistChild = (next: VehicleStore, audit: { action: "CREATE" | "UPDATE" | "ARCHIVE" | "RESTORE"; entityId: string; entityType: "Vehicle" | "Permit" | "Inspection" | "Evidence"; details: string }) => {
    try {
      saveVehicleStore(companyId, next)
      onStoreChange(next)
      recordAuditEvent({ action: audit.action, entityType: audit.entityType, entityId: audit.entityId, companyId, actor: "", role: "", details: audit.details })
      setError(null)
      setNotice("Saved successfully.")
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "The record could not be saved.")
      return false
    }
  }

  const openEvidence = (item: EvidenceRecord) => setPreviewEvidence(item)

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="size-4" /></Button>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{vehicle.unitNumber || "Vehicle"}</h1><StatusPill value={vehicle.status} /></div><p className="mt-1 text-xs text-muted-foreground">{vehicle.equipmentType} · {vehicle.year} {vehicle.make} {vehicle.model} · VIN {vehicle.vin}</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {vehicle.status === "Archived" ? <Button variant="outline" size="sm" onClick={onRestore}><RotateCcw className="mr-1.5 size-3.5" />Restore</Button> : <Button variant="outline" size="sm" onClick={onArchive}><Archive className="mr-1.5 size-3.5" />Archive</Button>}
          <Button size="sm" onClick={() => openSourcePicker({ kind: "profile" })}><Upload className="mr-1.5 size-3.5" />Document / OCR</Button>
        </div>
      </div>

      {error ? <AlertBanner message={error} onClose={() => setError(null)} /> : null}
      {notice ? <NoticeBanner message={notice} onClose={() => setNotice(null)} /> : null}

      <div className="flex flex-wrap gap-1 border-b border-border">
        {(["profile", "ownership", "registrations", "permits", "maintenance", "evidence"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-3 py-2 text-xs font-semibold capitalize ${tab === item ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{item === "registrations" ? "Registration" : item}</button>)}
      </div>

      {tab === "profile" ? <ProfileTab companyId={companyId} vehicle={vehicle} onSave={onSaveVehicle} onStartOCR={() => openSourcePicker({ kind: "profile" })} ocrValues={profileOCRValues} /> : null}
      {tab === "ownership" ? <OwnershipTab companyId={companyId} store={store} vehicle={vehicle} records={ownershipRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(documentType) => openSourcePicker({ kind: "ownership", documentType })} pendingEvidenceId={pendingOwnershipEvidenceId} clearPendingEvidence={() => setPendingOwnershipEvidenceId(null)} setError={setError} setNotice={setNotice} /> : null}
      {tab === "registrations" ? <RegistrationTab companyId={companyId} store={store} vehicle={vehicle} records={registrationRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(documentType) => openSourcePicker({ kind: "registration", documentType })} pendingEvidence={pendingRegistrationEvidence} clearPendingEvidence={() => setPendingRegistrationEvidence(null)} setError={setError} setNotice={setNotice} /> : null}
      {tab === "permits" ? <PermitTab companyId={companyId} store={store} vehicle={vehicle} records={permitRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(documentType) => openSourcePicker({ kind: "permit", documentType })} pendingEvidenceId={pendingPermitEvidenceId} clearPendingEvidence={() => setPendingPermitEvidenceId(null)} setError={setError} setNotice={setNotice} /> : null}
      {tab === "maintenance" ? <MaintenanceTab companyId={companyId} store={store} vehicle={vehicle} inspections={inspectionRecords} maintenance={maintenanceRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(kind, documentType) => openSourcePicker({ kind, documentType })} pendingInspectionEvidenceId={pendingInspectionEvidenceId} pendingMaintenanceEvidenceId={pendingMaintenanceEvidenceId} clearInspectionEvidence={() => setPendingInspectionEvidenceId(null)} clearMaintenanceEvidence={() => setPendingMaintenanceEvidenceId(null)} setError={setError} setNotice={setNotice} /> : null}
      {tab === "evidence" ? <EvidencePanel evidenceItems={evidence} onOpenDocument={openEvidence} onAddEvidence={() => openSourcePicker({ kind: "profile" })} title="Vehicle Evidence & Source Documents" /> : null}

      <UnsavedChangesPrompt hasChanges={false} onSave={() => undefined} onDiscard={() => undefined} />

      {sourceContext ? <DocumentSourcePicker isOpen onClose={() => setSourceContext(null)} onSelectCamera={() => { setSourceContext(sourceContext); setShowCamera(true) }} onSelectFile={(file) => { const context = sourceContext; setSourceContext(null); void beginOCR(context, file) }} title="Vehicle Document — OCR First" subtitle="Capture or upload the source document before entering structured vehicle data." /> : null}
      {showCamera ? <CameraCapture onClose={() => setShowCamera(false)} onCapture={(file) => { setShowCamera(false); if (ocrContext || sourceContext) void beginOCR((ocrContext || sourceContext)!, file) }} /> : null}
      {showOCR && ocrResult && ocrDataUrl ? <VehicleOCRReview result={ocrResult} dataUrl={ocrDataUrl} context={ocrContext} onCancel={() => { setShowOCR(false); setOCRContext(null) }} onConfirm={confirmOCR} /> : null}
      {previewEvidence ? <div className="fixed inset-0 z-[180] bg-background"><SecureDocumentViewer fileName={previewEvidence.fileName} mimeType={previewEvidence.mimeType} dataUrl={previewEvidence.fileReference} documentTitle={`Vehicle Evidence — ${previewEvidence.documentType}`} documentDate={previewEvidence.documentDate} companyId={companyId} onClose={() => setPreviewEvidence(null)} /></div> : null}
    </div>
  )
}

function VehicleOCRReview({ result, dataUrl, context, onCancel, onConfirm }: { result: OCRDocumentResult; dataUrl: string; context: OCRContext | null; onCancel: () => void; onConfirm: (values: Record<string, unknown>, attachment: { fileRef: string; fileName: string; ocrConfidence: number }) => void }) {
  const fieldDefinitions = useMemo(() => {
    if (context?.kind === "profile") return [
      { key: "unitNumber", label: "Equipment Number", required: true },
      { key: "vin", label: "VIN", required: true },
      { key: "year", label: "Year" },
      { key: "make", label: "Make" },
      { key: "model", label: "Model" },
      { key: "color", label: "Color" },
      { key: "axles", label: "Equipment Axles", type: "number" as const },
      { key: "tareWeight", label: "Tare Weight", type: "number" as const },
      { key: "equipmentLength", label: "Equipment Length", type: "number" as const },
    ]
    if (context?.kind === "registration") return [
      { key: "stateProvince", label: "State / Province", required: true },
      { key: "plate", label: "Plate", required: true },
      { key: "registrationDate", label: "Registration Date", type: "date" as const, required: true },
      { key: "expiryDate", label: "Expiry Date", type: "date" as const },
    ]
    return [
      { key: "documentDate", label: "Document Date", type: "date" as const },
      { key: "referenceNumber", label: "Reference / Number" },
      { key: "notes", label: "Review Notes" },
    ]
  }, [context])
  const initialValues = useMemo(() => {
    const value: Record<string, unknown> = {}
    for (const field of fieldDefinitions) value[field.key] = ""
    return value
  }, [fieldDefinitions])
  return <div className="fixed inset-0 z-[170] bg-background"><OCRReview documentResult={result} documentDataUrl={dataUrl} initialValues={initialValues} fieldDefinitions={fieldDefinitions} onConfirm={onConfirm} onCancel={onCancel} /></div>
}

function ProfileTab({ companyId, vehicle, onSave, onStartOCR, ocrValues }: { companyId: string; vehicle: VehicleRecord; onSave: (vehicle: VehicleRecord) => void; onStartOCR: () => void; ocrValues: Record<string, unknown> | null }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<ProfileForm>(profileFromVehicle(vehicle))
  useEffect(() => { setForm({ ...profileFromVehicle(vehicle), ...(ocrValues ? Object.fromEntries(Object.entries(ocrValues).filter(([key]) => key in profileFromVehicle(vehicle))) as Partial<ProfileForm> : {}) }) }, [vehicle, ocrValues])
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => setForm((current) => ({ ...current, [key]: value }))
  if (!editing) return <div className="space-y-3">
    <Card><SectionTitle title="Vehicle Profile" description="Compact master record. Source documents enter through OCR first." action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={onStartOCR}><Upload className="mr-1.5 size-3.5" />Document / OCR</Button><Button size="sm" onClick={() => setEditing(true)}><Edit3 className="mr-1.5 size-3.5" />Edit</Button></div>} />
      <div className="grid gap-3 p-4 md:grid-cols-4">
        <ReadOnlyField label="Record ID" value={vehicle.id} />
        <ReadOnlyField label="Equipment Number" value={vehicle.unitNumber} />
        <ReadOnlyField label="Vehicle Type" value={vehicle.equipmentType} />
        <ReadOnlyField label="Status" value={vehicle.status} />
        <ReadOnlyField label="VIN" value={vehicle.vin} />
        <ReadOnlyField label="Year" value={vehicle.year} />
        <ReadOnlyField label="Make" value={vehicle.make} />
        <ReadOnlyField label="Model" value={vehicle.model} />
        <ReadOnlyField label="Color" value={vehicle.color} />
        <ReadOnlyField label="Operating Region" value={vehicle.operatingRegion} />
        <ReadOnlyField label="Equipment Axles" value={String(vehicle.axles)} />
        <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tare Weight</p><p className="mt-1 text-lg font-bold tabular-nums">{vehicle.tareWeightKgs ?? "—"}<span className="ml-1 text-[10px] font-semibold text-muted-foreground">kg</span></p></div>
        <ReadOnlyField label="Fuel Type" value={vehicle.fuelType} />
        <div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Equipment Length</p><p className="mt-1 text-lg font-bold tabular-nums">{vehicle.lengthFeet ?? "—"}<span className="ml-1 text-[10px] font-semibold text-muted-foreground">ft</span></p></div>
        <ReadOnlyField label="GPS Provider" value={vehicle.gpsProvider || "—"} />
      </div>
    </Card>
  </div>

  return <Card><SectionTitle title="Edit Vehicle Profile" description="Review extracted values before saving." /><div className="p-4"><VehicleProfileForm companyId={companyId} vehicle={vehicle} form={form} setForm={setForm} onCancel={() => { setEditing(false); setForm(profileFromVehicle(vehicle)) }} onSave={() => { onSave(buildVehicle(form, vehicle)); setEditing(false) }} onStartOCR={onStartOCR} /></div></Card>
}

function VehicleProfileForm({ companyId, vehicle, form, setForm, onCancel, onSave, onStartOCR, forceOCRPrompt = false }: { companyId: string; vehicle: VehicleRecord | null; form: ProfileForm; setForm: Dispatch<SetStateAction<ProfileForm>>; onCancel: () => void; onSave: () => void; onStartOCR: () => void; forceOCRPrompt?: boolean }) {
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => setForm((current) => ({ ...current, [key]: value }))
  return <div className="space-y-4">
    <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3"><div><p className="text-xs font-bold">OCR-first source capture</p><p className="text-[11px] text-muted-foreground">Upload the source document, review extracted values, then save the structured Vehicle record.</p></div><Button variant="outline" size="sm" onClick={onStartOCR}><Upload className="mr-1.5 size-3.5" />Start with Document</Button></div>
    <div className="grid gap-3 md:grid-cols-4">
      <Field label="Record ID"><Input className={inputClass} value={vehicle?.id || "Generated on save"} disabled /></Field>
      <Field label="Equipment Number" required><Input className={inputClass} value={form.unitNumber} onChange={(e) => set("unitNumber", e.target.value)} /></Field>
      <Field label="Vehicle Type" required><select className={selectClass} value={form.equipmentType} onChange={(e) => set("equipmentType", e.target.value as EquipmentType)}>{VEHICLE_TYPES.map((item) => <option key={item}>{item}</option>)}</select></Field>
      <Field label="Status"><select className={selectClass} value={form.status} onChange={(e) => set("status", e.target.value as VehicleStatus)}>{VEHICLE_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></Field>
      <Field label="VIN" required><Input className={inputClass} value={form.vin} onChange={(e) => set("vin", normalizeVIN(e.target.value))} maxLength={17} /></Field>
      <Field label="Year"><Input className={inputClass} value={form.year} onChange={(e) => set("year", e.target.value)} /></Field>
      <Field label="Make"><Input className={inputClass} value={form.make} onChange={(e) => set("make", e.target.value)} /></Field>
      <Field label="Model"><Input className={inputClass} value={form.model} onChange={(e) => set("model", e.target.value)} /></Field>
      <Field label="Color"><Input className={inputClass} value={form.color} onChange={(e) => set("color", e.target.value)} /></Field>
      <Field label="Operating Region"><select className={selectClass} value={form.operatingRegion} onChange={(e) => set("operatingRegion", e.target.value as ProfileForm["operatingRegion"])}><option>Canada Only</option><option>US Only</option><option>Cross-Border</option></select></Field>
      <Field label="Equipment Axles"><Input className={inputClass} type="number" min="0" value={form.axles} onChange={(e) => set("axles", e.target.value)} /></Field>
      <Field label="Fleet Start Date"><Input className={inputClass} type="date" value={form.fleetStartDate} onChange={(e) => set("fleetStartDate", e.target.value)} /></Field>
      <Field label="Fleet End Date"><Input className={inputClass} type="date" value={form.fleetEndDate} onChange={(e) => set("fleetEndDate", e.target.value)} /></Field>
      <Field label="Tare Weight" className="md:col-span-2"><div className="flex items-center gap-2"><Input className={`${inputClass} text-base font-bold tabular-nums`} type="number" min="0" value={form.tareWeight} onChange={(e) => set("tareWeight", e.target.value)} /><select className="h-9 w-16 rounded-lg border border-input bg-background px-2 text-[10px] font-semibold" value={form.tareWeightUnit} onChange={(e) => set("tareWeightUnit", e.target.value as "kg" | "lb")}><option>kg</option><option>lb</option></select></div></Field>
      <Field label="Fuel Type"><select className={selectClass} value={form.fuelType} onChange={(e) => set("fuelType", e.target.value as ProfileForm["fuelType"])}><option>Diesel</option><option>Electric</option><option>Gasoline</option><option>CNG/LNG</option><option>None / Unpowered</option></select></Field>
      <Field label="Equipment Length" className="md:col-span-2"><div className="flex items-center gap-2"><Input className={`${inputClass} text-base font-bold tabular-nums`} type="number" min="0" value={form.equipmentLength} onChange={(e) => set("equipmentLength", e.target.value)} /><select className="h-9 w-16 rounded-lg border border-input bg-background px-2 text-[10px] font-semibold" value={form.equipmentLengthUnit} onChange={(e) => set("equipmentLengthUnit", e.target.value as "ft" | "m")}><option>ft</option><option>m</option></select></div></Field>
      <Field label="GPS Provider"><Input className={inputClass} value={form.gpsProvider} onChange={(e) => set("gpsProvider", e.target.value)} /></Field>
    </div>
    <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button onClick={onSave}>Save Vehicle</Button></div>
  </div>
}

function OwnershipTab({ companyId, store, vehicle, records, evidence, onStoreChange, onStartOCR, pendingEvidenceId, clearPendingEvidence, setError, setNotice }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; records: VehicleOwnershipRecord[]; evidence: EvidenceRecord[]; onStoreChange: (store: VehicleStore) => void; onStartOCR: (documentType: string) => void; pendingEvidenceId: string | null; clearPendingEvidence: () => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void }) {
  const [editing, setEditing] = useState<VehicleOwnershipRecord | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const visible = records.filter((record) => showArchived || !record.archived)
  const archive = (record: VehicleOwnershipRecord) => {
    try { const next = { ...store, ownershipRecords: store.ownershipRecords.map((item) => item.id === record.id ? { ...item, archived: true, updatedAt: isoNow() } : item) }; saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: "ARCHIVE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `Archived ownership record ${record.id}.` }); setNotice("Ownership record archived.") } catch (err) { setError(err instanceof Error ? err.message : "Could not archive ownership record.") }
  }
  return <div className="space-y-3"><Card><SectionTitle title="Ownership" description="Historical ownership relationships and supporting documents." action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide Archived" : "Show History"}</Button><Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}><Plus className="mr-1.5 size-3.5" />Add Ownership</Button></div>} /></Card>
    {visible.length === 0 ? <EmptyState title="No ownership records" description="Create a historical ownership record. Required source documents are presented inside the ownership workflow." action={<Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 size-4" />Add Ownership</Button>} /> : <div className="space-y-2">{visible.map((record) => <OwnershipRecordCard key={record.id} record={record} evidence={evidence} onEdit={() => { setEditing(record); setShowForm(true) }} onArchive={() => archive(record)} />)}</div>}
    {showForm ? <OwnershipForm companyId={companyId} vehicle={vehicle} initial={editing} store={store} pendingEvidenceId={pendingEvidenceId} onStartOCR={onStartOCR} clearPendingEvidence={clearPendingEvidence} onClose={() => setShowForm(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} /> : null}
  </div>
}

function OwnershipRecordCard({ record, evidence, onEdit, onArchive }: { record: VehicleOwnershipRecord; evidence: EvidenceRecord[]; onEdit: () => void; onArchive: () => void }) {
  const owners = record.legalOwners.length ? record.legalOwners.join(", ") : "—"
  return <Card className={record.archived ? "opacity-70" : ""}><div className="flex items-start justify-between gap-3 border-b px-4 py-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.relationship}</h3>{record.leasingStatus ? <StatusPill value={`Leasing: ${record.leasingStatus}`} /> : null}</div><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">Record ID: {record.id}</p></div><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={onEdit}><Edit3 className="mr-1 size-3" />Edit</Button>{!record.archived ? <Button variant="ghost" size="sm" onClick={onArchive}><Archive className="mr-1 size-3" />Archive</Button> : null}</div></div><div className="grid gap-3 p-4 md:grid-cols-4"><ReadOnlyField label="Purchase Date" value={record.purchaseDate || "—"} /><ReadOnlyField label="Purchase Price" value={money(record.purchasePrice)} /><ReadOnlyField label="Ownership Start" value={record.ownershipStartDate || "—"} /><ReadOnlyField label="Ownership End" value={record.ownershipEndDate || "Current"} /><ReadOnlyField label="Legal Owner(s)" value={owners} />{record.leasingCompanyNameSnapshot ? <ReadOnlyField label="Leasing Company" value={record.leasingCompanyNameSnapshot} /> : null}{record.leaseTermMonths ? <ReadOnlyField label="Lease Term" value={`${record.leaseTermMonths} months`} /> : null}{record.leaseEndDate ? <ReadOnlyField label="Lease End Date" value={record.leaseEndDate} /> : null}{record.financingStatus ? <ReadOnlyField label="Financing Status" value={record.financingStatus} /> : null}</div>{evidence.filter((item) => record.evidenceIds.includes(item.id)).length ? <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">{evidence.filter((item) => record.evidenceIds.includes(item.id)).length} ownership document(s) attached.</div> : null}</Card>
}

function OwnershipForm({ companyId, vehicle, initial, store, pendingEvidenceId, onStartOCR, clearPendingEvidence, onClose, onStoreChange, setError, setNotice }: { companyId: string; vehicle: VehicleRecord; initial: VehicleOwnershipRecord | null; store: VehicleStore; pendingEvidenceId: string | null; onStartOCR: (documentType: string) => void; clearPendingEvidence: () => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void }) {
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
    <Field label="Asset Relationship" required><select className={selectClass} value={relationship} onChange={(e) => setRelationship(e.target.value as VehicleOwnershipRecord["relationship"])}><option>Company-Owned</option><option>Leased</option><option>Owner-Operator</option><option>Third-Party / Rented</option></select></Field>
    {relationship === "Owner-Operator" ? <Field label="Leasing Status" required><select className={selectClass} value={leasingStatus} onChange={(e) => setLeasingStatus(e.target.value as "Yes" | "No")}><option>Yes</option><option>No</option></select></Field> : null}
    {(relationship === "Leased" || (relationship === "Owner-Operator" && leasingStatus === "Yes")) ? <EntityPicker label="Leasing Company" required selectedEntity={leasingCompany ? { entityType: "Company", id: leasingCompany.id, label: leasingCompany.name, secondaryText: leasingCompany.id, status: leasingCompany.status } : null} onSelect={(entity) => setLeasingCompany(entity ? readCompanies().find((company) => company.id === entity.id) || null : null)} onSearch={searchCompanies} onCreateNew={createNewCompany} createNewButtonLabel="Create New Company" /> : null}
    <div className="grid gap-3 md:grid-cols-2"><Field label="Purchase Date"><Input className={inputClass} type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field><Field label="Purchase Price"><Input className={inputClass} value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="0.00" /></Field></div>
    {(relationship === "Leased" || (relationship === "Owner-Operator" && leasingStatus === "Yes")) ? <div className="grid gap-3 md:grid-cols-2"><Field label="Lease Term (Months)"><Input className={inputClass} type="number" min="1" value={leaseTermMonths} onChange={(e) => setLeaseTermMonths(e.target.value)} /></Field><Field label="Lease End Date"><Input className={inputClass} value={leaseEndDate} readOnly /></Field></div> : null}
    <Divider /><div className="grid gap-3 md:grid-cols-2"><Field label="Ownership Start Date" required><Input className={inputClass} type="date" value={ownershipStartDate} onChange={(e) => setOwnershipStartDate(e.target.value)} /></Field><Field label="Ownership End Date"><Input className={inputClass} type="date" value={ownershipEndDate} onChange={(e) => setOwnershipEndDate(e.target.value)} /></Field></div>
    <Divider /><div className="space-y-2"><Field label="Legal Owner" required><div className="flex gap-2"><Input className={inputClass} value={legalOwnerInput} onChange={(e) => setLegalOwnerInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOwner() } }} placeholder="Legal owner name" /><Button type="button" variant="outline" size="sm" onClick={addOwner}><Plus className="mr-1 size-3" />Add</Button></div></Field><div className="flex flex-wrap gap-1.5">{legalOwners.map((owner) => <button type="button" key={owner} onClick={() => setLegalOwners((current) => current.filter((item) => item !== owner))} className="rounded-full border bg-muted/30 px-2 py-1 text-[10px] font-semibold">{owner} ×</button>)}</div></div>
    {relationship === "Company-Owned" ? <Field label="Financing Status"><select className={selectClass} value={financingStatus || "No Financing"} onChange={(e) => setFinancingStatus(e.target.value as VehicleOwnershipRecord["financingStatus"])}><option>No Financing</option><option>Financed</option><option>Paid Off</option></select></Field> : null}
    <div className="rounded-lg border bg-muted/20 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Attached Evidence</p><p className="mt-1 text-xs">{evidenceIds.length ? `${evidenceIds.length} document(s) attached.` : "No document attached yet."}</p><p className="mt-1 text-[10px] text-muted-foreground">Use Upload / OCR above. Documents are persisted as evidence records, not filename-only strings.</p></div>
    <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Ownership</Button></div>
  </div></div></div>
}

function RegistrationTab({ companyId, store, vehicle, records, evidence, onStoreChange, onStartOCR, pendingEvidence, clearPendingEvidence, setError, setNotice }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; records: VehicleRegistrationRecord[]; evidence: EvidenceRecord[]; onStoreChange: (store: VehicleStore) => void; onStartOCR: (documentType: string) => void; pendingEvidence: { id: string; documentType: string } | null; clearPendingEvidence: () => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<VehicleRegistrationRecord | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const visible = records.filter((record) => showArchived || !record.archived).sort((a, b) => b.registrationDate.localeCompare(a.registrationDate))
  const archive = (record: VehicleRegistrationRecord) => { const next = { ...store, registrationRecords: store.registrationRecords.map((item) => item.id === record.id ? { ...item, archived: true, updatedAt: isoNow() } : item) }; try { saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: "ARCHIVE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `Archived registration record ${record.id}.` }); setNotice("Registration archived.") } catch (err) { setError(err instanceof Error ? err.message : "Could not archive registration.") } }
  return <div className="space-y-3"><Card><SectionTitle title="Registration" description="Historical registrations; current plate comes from the active registration." action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide History" : "Show History"}</Button><Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}><Plus className="mr-1.5 size-3.5" />Add Registration</Button></div>} /></Card>
    {visible.length === 0 ? <EmptyState title="No registration records" description="Registration Document is mandatory for every registration. Prorate PSV additionally requires a Cab Card." action={<Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 size-4" />Add Registration</Button>} /> : <div className="space-y-2">{visible.map((record) => <Card key={record.id} className={record.archived ? "opacity-70" : ""}><div className="flex items-center justify-between border-b px-4 py-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.registrationType}</h3><StatusPill value={registrationStatus(record)} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => { setEditing(record); setShowForm(true) }}><Edit3 className="mr-1 size-3" />Edit</Button>{!record.archived ? <Button variant="ghost" size="sm" onClick={() => archive(record)}><Archive className="mr-1 size-3" />Archive</Button> : null}</div></div><div className="grid gap-3 p-4 md:grid-cols-4"><ReadOnlyField label="State / Province" value={`${getJurisdictionLabel(record.stateProvince)} (${record.stateProvince})`} /><ReadOnlyField label="Plate" value={record.plate || "—"} /><ReadOnlyField label="Registration Date" value={record.registrationDate || "—"} /><ReadOnlyField label="Expiry Date" value={isContinuousRegistration(vehicle, record.registrationType) ? "Continuous" : record.expiryDate || "—"} /><ReadOnlyField label="Registration Document" value={record.registrationDocumentEvidenceId ? "Attached" : "Missing"} /><ReadOnlyField label="Cab Card" value={record.cabCardEvidenceId ? "Attached" : record.registrationType === "Prorate PSV" ? "Missing" : "Not required by rule"} /></div></Card>)}</div>}
    {showForm ? <RegistrationForm companyId={companyId} store={store} vehicle={vehicle} initial={editing} pendingEvidence={pendingEvidence} onStartOCR={onStartOCR} clearPendingEvidence={clearPendingEvidence} onClose={() => setShowForm(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} /> : null}
  </div>
}

function RegistrationForm({ companyId, store, vehicle, initial, pendingEvidence, clearPendingEvidence, onStartOCR, onClose, onStoreChange, setError, setNotice }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehicleRegistrationRecord | null; pendingEvidence: { id: string; documentType: string } | null; clearPendingEvidence: () => void; onStartOCR: (documentType: string) => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void }) {
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
  useEffect(() => { if (pendingEvidence) { if (docTarget === "cabCard") setCabCardEvidenceId(pendingEvidence.id); else setRegistrationDocumentEvidenceId(pendingEvidence.id); clearPendingEvidence() } }, [pendingEvidence, docTarget, clearPendingEvidence])
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
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border bg-card shadow-2xl"><div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-sm font-bold">{initial ? "Edit" : "Add"} Registration</h2><p className="text-[11px] text-muted-foreground">OCR first. Registration Document is mandatory; Cab Card is conditional.</p></div><button onClick={onClose}><X className="size-4" /></button></div><div className="space-y-4 p-4">
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold">Start with Registration Document</p><p className="text-[11px] text-muted-foreground">Capture the source before entering State / Province, Plate and dates.</p></div><Button size="sm" variant="outline" onClick={() => { setDocTarget("registration"); onStartOCR("Registration Document") }}><Upload className="mr-1.5 size-3.5" />Upload / OCR</Button></div></div>
    <div className="grid gap-3 md:grid-cols-2"><Field label="Registration Type" required><select className={selectClass} value={registrationType} onChange={(e) => setRegistrationType(e.target.value)}>{REGISTRATION_TYPES.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Registration Status"><select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as VehicleRegistrationRecord["status"])}>{["Draft", "Active", "Expired", "Replaced", "Cancelled"].map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="State / Province" required><select className={selectClass} value={stateProvince} onChange={(e) => setStateProvince(e.target.value)}><option value="">Select…</option>{JURISDICTIONS.map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}</select></Field><Field label="Plate" required><Input className={inputClass} value={plate} onChange={(e) => setPlate(e.target.value)} /></Field><Field label="Registration Date" required><Input className={inputClass} type="date" value={registrationDate} onChange={(e) => setRegistrationDate(e.target.value)} /></Field><Field label="Expiry Date"><Input className={inputClass} type="date" value={continuous ? "" : expiryDate} disabled={continuous} onChange={(e) => setExpiryDate(e.target.value)} />{continuous ? <p className="text-[10px] text-muted-foreground">Continuous registration for Trailer + Continuous has no normal expiry requirement.</p> : null}</Field><Field label="Price"><Input className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} /></Field></div>
    <Divider /><div className="grid gap-3 md:grid-cols-2"><div className="rounded-lg border p-3"><div className="flex items-center justify-between"><div><p className="text-xs font-bold">Registration Document <span className="text-destructive">*</span></p><p className="text-[10px] text-muted-foreground">Required for every registration.</p></div><Button size="sm" variant="outline" onClick={() => { setDocTarget("registration"); onStartOCR("Registration Document") }}><Upload className="mr-1 size-3" />{registrationDocumentEvidenceId ? "Replace" : "Attach"}</Button></div><p className="mt-2 text-[11px]">{registrationDocumentEvidenceId ? "Attached" : "Missing"}</p></div><div className="rounded-lg border p-3"><div className="flex items-center justify-between"><div><p className="text-xs font-bold">Cab Card {registrationType === "Prorate PSV" ? <span className="text-destructive">*</span> : null}</p><p className="text-[10px] text-muted-foreground">Required only for Prorate PSV.</p></div><Button size="sm" variant="outline" onClick={() => { setDocTarget("cabCard"); onStartOCR("Cab Card") }} disabled={registrationType !== "Prorate PSV"}><Upload className="mr-1 size-3" />Attach</Button></div><p className="mt-2 text-[11px]">{cabCardEvidenceId ? "Attached" : registrationType === "Prorate PSV" ? "Missing" : "Not required"}</p></div></div>
    <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Registration</Button></div>
  </div></div></div>
}

function PermitTab({ companyId, store, vehicle, records, evidence, onStoreChange, onStartOCR, pendingEvidenceId, clearPendingEvidence, setError, setNotice }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; records: VehiclePermitRecord[]; evidence: EvidenceRecord[]; onStoreChange: (store: VehicleStore) => void; onStartOCR: (documentType: string) => void; pendingEvidenceId: string | null; clearPendingEvidence: () => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<VehiclePermitRecord | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const visible = records.filter((record) => showArchived || !record.archived)
  const archive = (record: VehiclePermitRecord) => { const next = { ...store, permitRecords: store.permitRecords.map((item) => item.id === record.id ? { ...item, archived: true, updatedAt: isoNow() } : item) }; try { saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: "ARCHIVE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `Archived permit record ${record.id}.` }); setNotice("Permit archived.") } catch (err) { setError(err instanceof Error ? err.message : "Could not archive permit.") } }
  return <div className="space-y-3"><Card><SectionTitle title="Permits" description="Existing permit fields and derived status behavior are preserved." action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide History" : "Show History"}</Button><Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}><Plus className="mr-1.5 size-3.5" />Add Permit</Button></div>} /></Card>
    {visible.length === 0 ? <EmptyState title="No permit records" description="Begin permit capture with OCR/document source." action={<Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 size-4" />Add Permit</Button>} /> : <div className="space-y-2">{visible.map((record) => <Card key={record.id} className={record.archived ? "opacity-70" : ""}><div className="flex items-center justify-between border-b px-4 py-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.permitType === "Other" ? record.customPermitType : record.permitType}</h3><StatusPill value={permitDisplayStatus(record)} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => { setEditing(record); setShowForm(true) }}><Edit3 className="mr-1 size-3" />Edit</Button>{!record.archived ? <Button variant="ghost" size="sm" onClick={() => archive(record)}><Archive className="mr-1 size-3" />Archive</Button> : null}</div></div><div className="grid gap-3 p-4 md:grid-cols-4"><ReadOnlyField label="Permit #" value={record.permitNumber || "—"} /><ReadOnlyField label="Jurisdiction" value={record.jurisdiction || "—"} /><ReadOnlyField label="Start" value={record.startDate || "—"} /><ReadOnlyField label="Expiry" value={record.expiryDate || "—"} /><ReadOnlyField label="Evidence" value={record.evidenceIds.length ? `${record.evidenceIds.length} attached` : "Missing"} /><ReadOnlyField label="Notes" value={record.notes || "—"} /></div></Card>)}</div>}
    {showForm ? <PermitForm companyId={companyId} store={store} vehicle={vehicle} initial={editing} pendingEvidenceId={pendingEvidenceId} clearPendingEvidence={clearPendingEvidence} onStartOCR={onStartOCR} onClose={() => setShowForm(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} /> : null}
  </div>
}

function PermitForm({ companyId, store, vehicle, initial, pendingEvidenceId, clearPendingEvidence, onStartOCR, onClose, onStoreChange, setError, setNotice }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehiclePermitRecord | null; pendingEvidenceId: string | null; clearPendingEvidence: () => void; onStartOCR: (documentType: string) => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void }) {
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
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-card shadow-2xl"><div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-sm font-bold">{initial ? "Edit" : "Add"} Permit</h2><p className="text-[11px] text-muted-foreground">OCR/document capture is the first action.</p></div><button onClick={onClose}><X className="size-4" /></button></div><div className="space-y-4 p-4"><div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><div className="flex items-center justify-between"><div><p className="text-xs font-bold">Start with Permit Document</p><p className="text-[11px] text-muted-foreground">Review the source before committing permit fields.</p></div><Button variant="outline" size="sm" onClick={() => onStartOCR("Permit Document")}><Upload className="mr-1.5 size-3.5" />Upload / OCR</Button></div></div><div className="grid gap-3 md:grid-cols-2"><Field label="Permit Type"><select className={selectClass} value={permitType} onChange={(e) => setPermitType(e.target.value)}>{PERMIT_TYPES.map((item) => <option key={item}>{item}</option>)}</select></Field>{permitType === "Other" ? <Field label="Custom Permit Type"><Input className={inputClass} value={customPermitType} onChange={(e) => setCustomPermitType(e.target.value)} /></Field> : null}<Field label="Permit #"><Input className={inputClass} value={permitNumber} onChange={(e) => setPermitNumber(e.target.value)} /></Field><Field label="Jurisdiction"><Input className={inputClass} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} /></Field><Field label="Start Date"><Input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field><Field label="Expiry Date"><Input className={inputClass} type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></Field><Field label="Status"><select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as VehiclePermitRecord["status"])}><option>Active</option><option>Cancelled</option></select></Field></div><Field label="Notes"><textarea className="min-h-20 w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus:border-primary" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><div className="rounded-lg border bg-muted/20 p-3 text-xs">Evidence attached: <strong>{evidenceIds.length}</strong></div><div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Permit</Button></div></div></div></div>
}

function MaintenanceTab({ companyId, store, vehicle, inspections, maintenance, evidence, onStoreChange, onStartOCR, pendingInspectionEvidenceId, pendingMaintenanceEvidenceId, clearInspectionEvidence, clearMaintenanceEvidence, setError, setNotice }: {
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
}) {
  const [view, setView] = useState<"inspections" | "maintenance">("inspections")
  const [showInspection, setShowInspection] = useState(false)
  const [showMaintenance, setShowMaintenance] = useState(false)
  const [editingInspection, setEditingInspection] = useState<VehicleInspectionRecord | null>(null)
  const [editingMaintenance, setEditingMaintenance] = useState<VehicleMaintenanceRecord | null>(null)

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
        <SectionTitle
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
            </div>
          }
        />
      </Card>

      <div className="flex gap-1 border-b border-border">
        <button className={`border-b-2 px-3 py-2 text-xs font-semibold ${view === "inspections" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setView("inspections")}>Inspections</button>
        <button className={`border-b-2 px-3 py-2 text-xs font-semibold ${view === "maintenance" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setView("maintenance")}>Maintenance</button>
      </div>

      {view === "inspections" ? (
        activeInspections.length === 0 ? (
          <EmptyState title="No inspection records" description="Upload an inspection document or add an inspection manually." action={<Button onClick={() => setShowInspection(true)}><Plus className="mr-1.5 size-4" />Add Inspection</Button>} />
        ) : (
          <div className="space-y-2">
            {activeInspections.map((record) => (
              <Card key={record.id}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.inspectionType}</h3><StatusPill value={record.inspectionStatus} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div>
                  <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => { setEditingInspection(record); setShowInspection(true) }}><Edit3 className="mr-1 size-3" />Edit</Button><Button variant="ghost" size="sm" onClick={() => archiveInspection(record)}><Archive className="mr-1 size-3" />Archive</Button></div>
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
              </Card>
            ))}
          </div>
        )
      ) : (
        activeMaintenance.length === 0 ? (
          <EmptyState title="No maintenance records" description="Upload a work order/invoice or add a maintenance record manually." action={<Button onClick={() => setShowMaintenance(true)}><Plus className="mr-1.5 size-4" />Add Maintenance</Button>} />
        ) : (
          <div className="space-y-2">
            {activeMaintenance.map((record) => (
              <Card key={record.id}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.maintenanceType}</h3><StatusPill value={record.maintenanceStatus} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div>
                  <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => { setEditingMaintenance(record); setShowMaintenance(true) }}><Edit3 className="mr-1 size-3" />Edit</Button><Button variant="ghost" size="sm" onClick={() => archiveMaintenance(record)}><Archive className="mr-1 size-3" />Archive</Button></div>
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
              </Card>
            ))}
          </div>
        )
      )}

      {showInspection ? <InspectionForm companyId={companyId} store={store} vehicle={vehicle} initial={editingInspection} pendingEvidenceId={pendingInspectionEvidenceId} clearPendingEvidence={clearInspectionEvidence} onStartOCR={() => onStartOCR("inspection", "Inspection Document")} onClose={() => setShowInspection(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} /> : null}
      {showMaintenance ? <MaintenanceForm companyId={companyId} store={store} vehicle={vehicle} initial={editingMaintenance} pendingEvidenceId={pendingMaintenanceEvidenceId} clearPendingEvidence={clearMaintenanceEvidence} onStartOCR={() => onStartOCR("maintenance", "Maintenance Work Order / Invoice")} onClose={() => setShowMaintenance(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} /> : null}
    </div>
  )
}

function InspectionForm({ companyId, store, vehicle, initial, pendingEvidenceId, clearPendingEvidence, onStartOCR, onClose, onStoreChange, setError, setNotice }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehicleInspectionRecord | null; pendingEvidenceId: string | null; clearPendingEvidence: () => void; onStartOCR: () => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void }) {
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
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border bg-card shadow-2xl"><div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-sm font-bold">{initial ? "Edit" : "Add"} Inspection</h2><p className="text-[11px] text-muted-foreground">OCR-first document capture is available directly here.</p></div><button onClick={onClose}><X className="size-4" /></button></div><div className="space-y-4 p-4"><div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><div className="flex items-center justify-between"><div><p className="text-xs font-bold">Inspection Document</p><p className="text-[11px] text-muted-foreground">Review source before committing the inspection record.</p></div><Button variant="outline" size="sm" onClick={onStartOCR}><Upload className="mr-1.5 size-3.5" />Upload / OCR</Button></div></div><div className="grid gap-3 md:grid-cols-2"><Field label="Inspection Type"><select className={selectClass} value={inspectionType} onChange={(e) => setInspectionType(e.target.value)}>{INSPECTION_TYPES.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Inspection Source"><select className={selectClass} value={inspectionSource} onChange={(e) => setInspectionSource(e.target.value as VehicleInspectionRecord["inspectionSource"])}>{INSPECTION_SOURCES.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Inspection Status"><select className={selectClass} value={inspectionStatus} onChange={(e) => setInspectionStatus(e.target.value as VehicleInspectionRecord["inspectionStatus"])}>{INSPECTION_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Inspection Date"><Input className={inputClass} type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} /></Field><Field label="Expiry Date"><Input className={inputClass} type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></Field><Field label="Next Due Date"><Input className={inputClass} type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} /></Field><Field label="Inspector / Shop"><Input className={inputClass} value={inspectorShopName} onChange={(e) => setInspectorShopName(e.target.value)} /></Field><Field label="Odometer"><Input className={inputClass} value={odometer} onChange={(e) => setOdometer(e.target.value)} /></Field><Field label="Engine Hours"><Input className={inputClass} value={engineHours} onChange={(e) => setEngineHours(e.target.value)} /></Field><Field label="Defects Found"><select className={selectClass} value={defectsFound} onChange={(e) => setDefectsFound(e.target.value as "Yes" | "No")}><option>Yes</option><option>No</option></select></Field><Field label="Service Facility"><Input className={inputClass} value={serviceFacility} onChange={(e) => setServiceFacility(e.target.value)} /></Field></div><Field label="Notes"><textarea className="min-h-20 w-full rounded-lg border border-input bg-background p-3 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><div className="rounded-lg border bg-muted/20 p-3 text-xs">Evidence attached: <strong>{evidenceIds.length}</strong></div><div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Inspection</Button></div></div></div></div>
}

function MaintenanceForm({ companyId, store, vehicle, initial, pendingEvidenceId, clearPendingEvidence, onStartOCR, onClose, onStoreChange, setError, setNotice }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehicleMaintenanceRecord | null; pendingEvidenceId: string | null; clearPendingEvidence: () => void; onStartOCR: () => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void }) {
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
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border bg-card shadow-2xl"><div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-sm font-bold">{initial ? "Edit" : "Add"} Maintenance Record</h2><p className="text-[11px] text-muted-foreground">One Work Order / Invoice Number. Parts Cost and Total Cost are independently stored.</p></div><button onClick={onClose}><X className="size-4" /></button></div><div className="space-y-4 p-4"><div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><div className="flex items-center justify-between"><div><p className="text-xs font-bold">Work Order / Invoice Document</p><p className="text-[11px] text-muted-foreground">Start with the source document and review it before saving.</p></div><Button variant="outline" size="sm" onClick={onStartOCR}><Upload className="mr-1.5 size-3.5" />Upload / OCR</Button></div></div><div className="grid gap-3 md:grid-cols-2"><Field label="Maintenance Type"><select className={selectClass} value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)}>{MAINTENANCE_TYPES.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Maintenance Status"><select className={selectClass} value={maintenanceStatus} onChange={(e) => setMaintenanceStatus(e.target.value as VehicleMaintenanceRecord["maintenanceStatus"])}>{MAINTENANCE_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Service Date"><Input className={inputClass} type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} /></Field><Field label="Odometer"><Input className={inputClass} value={odometer} onChange={(e) => setOdometer(e.target.value)} /></Field><Field label="Engine Hours"><Input className={inputClass} value={engineHours} onChange={(e) => setEngineHours(e.target.value)} /></Field><Field label="Vendor"><Input className={inputClass} value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field><Field label="Work Order / Invoice Number"><Input className={inputClass} value={workOrderInvoiceNumber} onChange={(e) => setWorkOrderInvoiceNumber(e.target.value)} /></Field><Field label="Parts Cost"><Input className={inputClass} type="number" min="0" value={partsCost} onChange={(e) => setPartsCost(e.target.value)} /></Field><Field label="Total Cost"><Input className={inputClass} type="number" min="0" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} /></Field><Field label="Next Service Due"><Input className={inputClass} type="date" value={nextServiceDueDate} onChange={(e) => setNextServiceDueDate(e.target.value)} /></Field></div><Field label="Notes"><textarea className="min-h-20 w-full rounded-lg border border-input bg-background p-3 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><div className="rounded-lg border bg-muted/20 p-3 text-xs">Evidence attached: <strong>{evidenceIds.length}</strong></div><div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Maintenance</Button></div></div></div></div>
}
