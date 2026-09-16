"use client"

import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { useParams } from "next/navigation"
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { validateCompany } from "@/lib/company-validation"
import {
  createId,
  isoNow,
  loadVehicleStore,
  saveVehicleStore,
  validateVehicleUniqueness,
  createInspectionFinding,
  updateInspectionFindingStatus,
  createMaintenanceItem,
  linkFindingToMaintenanceItem,
  getFindingsForInspection,
  getMaintenanceItemsForRecord,
  getLinksForFinding,
  deriveMaintenanceItemProvenance,
  type VehicleStore,
  type VehicleOwnershipRecord,
  type VehicleRegistrationRecord,
  type VehiclePermitRecord,
  type VehicleInspectionRecord,
  type VehicleMaintenanceRecord,
  type InspectionFinding,
  type MaintenanceItem,
} from "@/lib/vehicle-data"
import { normalizeVIN, is17CharVIN } from "@/lib/identifier-normalization"
import {
  createManualRepairInvoice,
  getVehicleRepairInvoices,
  getVehicleSpendSummary,
  getVehicleSpendByCategory,
  getVehicleRecurringIssues,
  RECONCILIATION_TOLERANCE,
  type RepairInvoice,
  type RepairInvoiceLine,
  type RepairLineInput,
} from "@/lib/repair-invoice-data"
import { loadPartCatalog, type PartCatalogEntry } from "@/lib/part-catalog-data"
import { getRoadsideEventsForVehicle, type RoadsideEventForVehicle } from "@/lib/driver-data"
import { getRoadsideViolationCollection } from "@/lib/driver-performance-child-facts"
import { recordAuditEvent } from "@/lib/audit-logger"
import { logAuditEvent } from "@/lib/audit-log"
import { JURISDICTIONS, getJurisdictionLabel } from "@/lib/jurisdictions"
import type { Company, EquipmentType, VehicleRecord, VehicleStatus } from "@/src/types"
import { INSPECTION_TYPES } from "@/src/types"
import type { EvidenceRecord } from "@/types/evidence"
import type { OCRDocumentResult } from "@/types/ocr"
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker"
import { OCRReview } from "@/src/components/shared/OCRReview"
import { EntityPicker } from "@/src/components/shared/EntityPicker"
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField"
import { UnsavedChangesPrompt } from "@/src/components/shared/UnsavedChangesPrompt"
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer"
import { CameraCapture } from "@/src/components/CameraCapture"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { TESRecordOverlay } from "@/src/components/shared/TESRecordOverlay"
import { ProfileTab, VehicleProfileForm, buildVehicle } from "@/src/components/vehicles/profile/VehicleProfileTab"
import type { ProfileForm, VehicleProfileRecord } from "@/src/components/vehicles/profile/VehicleProfileTab"
import { getQueryParam, pushHistoryQueryParams } from "@/lib/deep-linking"

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
  "Prorate Exempt Goods",
  "Public Service",
  "Continuous",
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

// INSPECTION_TYPES is imported from @/src/types — the single authoritative
// controlled vocabulary — rather than duplicated here.

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

const modalFieldInputClass = "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"

function ModalShell({ title, subtitle, onClose, footer, children }: { title: string; subtitle: string; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors ml-4 mt-0.5"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
        {footer}
      </div>
    </div>
  )
}

function ModalOCRStrip({ title, description, onStartOCR }: { title: string; description: string; onStartOCR: () => void }) {
  return (
    <div className="mx-6 mt-4 flex items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3">
      <div>
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onStartOCR}>
        <Upload className="mr-1.5 size-3.5" />Upload / OCR
      </Button>
    </div>
  )
}

function ModalSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-6 pt-4 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}

function ModalFieldGrid({ children }: { children: ReactNode }) {
  return <div className="px-6 grid grid-cols-2 gap-4">{children}</div>
}

function ModalField({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}{required ? <span className="text-destructive ml-0.5">*</span> : null}
      </label>
      {children}
    </div>
  )
}

function ModalEvidenceCard({ label, attached, attachedNote, onAttach }: { label: string; attached: boolean; attachedNote?: string; onAttach: () => void }) {
  return (
    <div className="rounded-xl border border-border p-3 flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{attached ? (attachedNote || "Attached") : "Missing"}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onAttach}>
        <Upload className="mr-1.5 size-3" />Attach
      </Button>
    </div>
  )
}

function ModalFooter({ note, onCancel, onSave, saveLabel }: { note: string; onCancel: () => void; onSave: () => void; saveLabel: string }) {
  return (
    <div className="border-t border-border px-6 py-4 flex items-center justify-between bg-muted/20">
      <p className="text-[11px] text-muted-foreground">{note}</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onSave}>{saveLabel}</Button>
      </div>
    </div>
  )
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

interface VehicleActivityEntry {
  id: string
  t: string
  event: string
  detail: string
  section: string
}

function loadVehicleActivity(
  companyId: string,
  vehicleId: string
): VehicleActivityEntry[] {
  try {
    const raw = localStorage.getItem(
      `tes_vehicle_activity_${companyId}_${vehicleId}`
    )
    if (!raw) return []
    return JSON.parse(raw) as VehicleActivityEntry[]
  } catch {
    return []
  }
}

function addVehicleActivity(
  companyId: string,
  vehicleId: string,
  entry: Omit<VehicleActivityEntry, "id" | "t">
): void {
  try {
    const existing = loadVehicleActivity(companyId, vehicleId)
    const newEntry: VehicleActivityEntry = {
      ...entry,
      id: crypto.randomUUID(),
      t: new Date().toISOString(),
    }
    localStorage.setItem(
      `tes_vehicle_activity_${companyId}_${vehicleId}`,
      JSON.stringify([newEntry, ...existing])
    )
  } catch {}
}

interface VehicleSettings {
  travelsNY: boolean
  travelsNM: boolean
  travelsKY: boolean
  travelsOR: boolean
  travelsCT: boolean
  travelsCA: boolean
  carriesOSOW: boolean
  carriesAlcohol: boolean
  carriesTobacco: boolean
  carriesHazmat: boolean
  operatesLCV: boolean
  operatesAxleLift: boolean
  eldDeviceId: string
  gpsProvider: string
  complianceNotes: string
}

function defaultVehicleSettings(): VehicleSettings {
  return {
    travelsNY: false, travelsNM: false, travelsKY: false,
    travelsOR: false, travelsCT: false, travelsCA: false,
    carriesOSOW: false, carriesAlcohol: false,
    carriesTobacco: false,
    carriesHazmat: false, operatesLCV: false,
    operatesAxleLift: false, eldDeviceId: "",
    gpsProvider: "", complianceNotes: "",
  }
}

function loadVehicleSettings(
  companyId: string,
  vehicleId: string
): VehicleSettings {
  try {
    const raw = localStorage.getItem(
      `tes_vehicle_settings_${companyId}_${vehicleId}`
    )
    return raw ? { ...defaultVehicleSettings(), ...JSON.parse(raw) } : defaultVehicleSettings()
  } catch {
    return defaultVehicleSettings()
  }
}

function saveVehicleSettings(
  companyId: string,
  vehicleId: string,
  settings: VehicleSettings
): void {
  try {
    localStorage.setItem(
      `tes_vehicle_settings_${companyId}_${vehicleId}`,
      JSON.stringify(settings)
    )
  } catch {}
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

export default function VehiclesPage() {
  const params = useParams()
  const companyId = String(params.id || "")
  const [company, setCompany] = useState<{ id: string; name: string; kind: string; status: string } | null>(null)
  const [store, setStore] = useState<VehicleStore | null>(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    () => typeof window !== "undefined" ? getQueryParam("vehicle") : null
  )
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
    try {
      const companies = readCompanies()
      const found = companies.find((c) => c.id === companyId)
      setCompany(found ? { id: found.id, name: found.name, kind: (found as any).kind, status: (found as any).status } : null)
    } catch {
      setCompany(null)
    }
  }, [companyId])

  useEffect(() => {
    const sync = () => setSelectedVehicleId(getQueryParam("vehicle"))
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

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
      logAuditEvent({
        e: "RECORD_CREATED",
        co: companyId,
        cn: company?.name,
        eid: savedVehicle.id,
        el: savedVehicle.unitNumber,
        det: `Created Vehicle ${savedVehicle.unitNumber}.`,
      })
      setSelectedVehicleId(vehicle.id)
      pushHistoryQueryParams({ vehicle: vehicle.id, vehicleTab: null })
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
    if (commitStore(next, { action: "UPDATE", entityId: vehicle.id, details: `Updated Vehicle ${vehicle.unitNumber}.` })) {
      logAuditEvent({
        e: "RECORD_UPDATED",
        co: companyId,
        cn: company?.name,
        eid: vehicle.id,
        el: vehicle.unitNumber,
        det: `Updated Vehicle ${vehicle.unitNumber}.`,
      })
      setNotice("Vehicle profile saved.")
    }
  }

  const archiveVehicle = (vehicle: VehicleRecord) => {
    const next: VehicleStore = { ...store!, vehicles: vehicles.map((item) => item.id === vehicle.id ? { ...item, status: "Archived", updatedAt: isoNow() } : item) }
    if (commitStore(next, { action: "ARCHIVE", entityId: vehicle.id, details: `Archived Vehicle ${vehicle.unitNumber}.` })) {
      logAuditEvent({
        e: "RECORD_ARCHIVED",
        co: companyId,
        cn: company?.name,
        eid: vehicle.id,
        el: vehicle.unitNumber,
        det: `Archived Vehicle ${vehicle.unitNumber}.`,
      })
      setSelectedVehicleId(null)
      pushHistoryQueryParams({ vehicle: null, vehicleTab: null })
      setNotice("Vehicle archived. Historical data was retained.")
    }
  }

  const restoreVehicle = (vehicle: VehicleRecord) => {
    const next: VehicleStore = { ...store!, vehicles: vehicles.map((item) => item.id === vehicle.id ? { ...item, status: "Inactive", updatedAt: isoNow() } : item) }
    if (commitStore(next, { action: "RESTORE", entityId: vehicle.id, details: `Restored Vehicle ${vehicle.unitNumber}.` })) {
      logAuditEvent({
        e: "RECORD_UPDATED",
        co: companyId,
        cn: company?.name,
        eid: vehicle.id,
        el: vehicle.unitNumber,
        det: `Restored Vehicle ${vehicle.unitNumber}.`,
      })
      setNotice("Vehicle restored as Inactive.")
    }
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
        onBack={() => { setSelectedVehicleId(null); pushHistoryQueryParams({ vehicle: null, vehicleTab: null }) }}
        onArchive={() => archiveVehicle(selectedVehicle)}
        onRestore={() => restoreVehicle(selectedVehicle)}
        error={error}
        setError={setError}
        notice={notice}
        setNotice={setNotice}
      />
    )
  }

  const vehicleListActions = (
    <>
      <div className="relative">
        <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search equipment or VIN…" className="h-9 w-[260px] pl-9 text-xs" />
      </div>
      <Button variant="outline" size="sm" onClick={() => setShowFilters((value) => !value)}><Filter className="mr-1.5 size-3.5" />Filters</Button>
      <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-1.5 size-3.5" />Add Vehicle</Button>
    </>
  )

  return (
    <div className="space-y-4 p-5 text-foreground">
      {company ? (
        <CompanyWorkspaceHeader
          company={company}
          section="Vehicles"
          description="Company-scoped vehicle master records and historical compliance records."
          actions={vehicleListActions}
        />
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Truck className="size-5 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{filteredVehicles.length}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Company-scoped vehicle master records and historical compliance records.</p>
          </div>
          <div className="flex flex-wrap gap-2">{vehicleListActions}</div>
        </div>
      )}

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
                  <tr key={vehicle.id} className="cursor-pointer hover:bg-muted/20" onClick={() => { setSelectedVehicleId(vehicle.id); pushHistoryQueryParams({ vehicle: vehicle.id, vehicleTab: null }) }}>
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
      <div className="p-4"><VehicleProfileForm companyId={companyId} vehicle={null} form={form} FieldComponent={Field} setForm={setForm} onCancel={onClose} onSave={() => { if (!form.vin || !is17CharVIN(form.vin)) { setError("VIN must contain 17 valid VIN characters."); return } onSave(form, pendingEvidence || undefined) }} onStartOCR={() => setSourceOpen(true)} forceOCRPrompt /></div>
    </div>
    {sourceOpen ? <div className="fixed inset-0 z-[200]"><DocumentSourcePicker isOpen onClose={() => setSourceOpen(false)} onSelectCamera={() => { setSourceOpen(false); setCameraOpen(true) }} onSelectFile={(file) => { setSourceOpen(false); startOCR(file) }} title="Vehicle Profile — OCR First" subtitle="Capture the source document before entering structured Vehicle fields." /></div> : null}
    {cameraOpen ? <div className="fixed inset-0 z-[200]"><CameraCapture onClose={() => setCameraOpen(false)} onCapture={(file) => { setCameraOpen(false); startOCR(file) }} /></div> : null}
    {ocrOpen && ocrResult && ocrDataUrl ? <div className="fixed inset-0 z-[160] bg-background"><OCRReview documentResult={ocrResult} documentDataUrl={ocrDataUrl} initialValues={{ unitNumber: form.unitNumber, vin: form.vin, year: form.year, make: form.make, model: form.model, color: form.color, axles: form.axles, tareWeight: form.tareWeight, equipmentLength: form.equipmentLength }} fieldDefinitions={[{ key: "unitNumber", label: "Equipment Number", required: true }, { key: "vin", label: "VIN", required: true }, { key: "year", label: "Year" }, { key: "make", label: "Make" }, { key: "model", label: "Model" }, { key: "color", label: "Color" }, { key: "axles", label: "Equipment Axles", type: "number" }, { key: "tareWeight", label: "Tare Weight", type: "number" }, { key: "equipmentLength", label: "Equipment Length", type: "number" }]} onConfirm={(values, attachment) => confirmOCR(values, attachment)} onCancel={() => setOCROpen(false)} /></div> : null}
  </div>
}
function VehicleActivitySection({
  companyId,
  vehicleId,
  refreshKey,
  showAll = false,
}: {
  companyId: string
  vehicleId: string
  refreshKey?: number
  showAll?: boolean
}) {
  const [entries, setEntries] = useState<VehicleActivityEntry[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setEntries(loadVehicleActivity(companyId, vehicleId))
  }, [companyId, vehicleId, refreshKey])

  const visible = showAll || expanded ? entries : entries.slice(0, 5)

  const dotColor = (event: string) => {
    if (event.includes("CREATED")) return "bg-muted-foreground"
    if (event.includes("ARCHIVED")) return "bg-destructive"
    if (event.includes("INGESTED")) return "bg-primary"
    if (event.includes("ADDED") || event.includes("RENEWED"))
      return "bg-green-500"
    if (event.includes("UPDATED")) return "bg-amber-500"
    return "bg-muted-foreground"
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Vehicle Activity</p>
        <span className="text-[10px] text-muted-foreground">
          Append-only compliance trail
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-4 text-center">
          No activity recorded yet.
        </p>
      ) : (
        <div className="space-y-0">
          {visible.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-3 py-2.5 border-b border-border last:border-0"
            >
              <div className={`mt-1.5 size-2 rounded-full shrink-0 ${dotColor(entry.event)}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-foreground tracking-wide">
                    {entry.event}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {entry.t.split("T")[0]}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  {entry.detail}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                {new Date(entry.t).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      )}

      {!showAll && entries.length > 5 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-primary hover:underline"
        >
          {expanded
            ? "Show less"
            : `View all ${entries.length} activity entries`}
        </button>
      ) : null}
    </div>
  )
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
  const [tab, setTab] = useState<"profile" | "ownership" | "registrations" | "permits" | "maintenance" | "activity" | "settings">(
    () => (typeof window !== "undefined" ? getQueryParam("vehicleTab") : null) as any || "profile"
  )
  const [showOCR, setShowOCR] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [ocrContext, setOCRContext] = useState<OCRContext | null>(null)
  const [ocrFile, setOCRFile] = useState<File | null>(null)
  const [ocrDataUrl, setOCRDataUrl] = useState("")
  const [ocrResult, setOCRResult] = useState<OCRDocumentResult | null>(null)
  const [previewEvidence, setPreviewEvidence] = useState<EvidenceRecord | null>(null)
  const [selectedRecordEvidence, setSelectedRecordEvidence] = useState<{
    recordLabel: string
    evidenceIds: string[]
  } | null>(null)

  const THREE_YEARS_AGO = new Date()
  THREE_YEARS_AGO.setFullYear(THREE_YEARS_AGO.getFullYear() - 3)
  const THREE_YEARS_AGO_ISO = THREE_YEARS_AGO.toISOString().split("T")[0]

  function isWithin3Years(dateStr?: string | null): boolean {
    if (!dateStr) return true
    return dateStr >= THREE_YEARS_AGO_ISO
  }

  const ownershipRecords = store.ownershipRecords.filter((record) => record.vehicleId === vehicle.id)
  const registrationRecords = store.registrationRecords.filter(
    (record) =>
      record.vehicleId === vehicle.id &&
      isWithin3Years(record.expiryDate || record.registrationDate)
  )
  const permitRecords = store.permitRecords.filter(
    (record) =>
      record.vehicleId === vehicle.id &&
      isWithin3Years(record.expiryDate || record.startDate)
  )
  const inspectionRecords = store.inspectionRecords.filter(
    (record) =>
      record.vehicleId === vehicle.id &&
      isWithin3Years(record.expiryDate || record.inspectionDate)
  )
  const maintenanceRecords = store.maintenanceRecords.filter(
    (record) =>
      record.vehicleId === vehicle.id &&
      isWithin3Years(record.serviceDate)
  )
  const evidence = store.evidence.filter((item) => item.entityType === "Vehicle" && item.entityId === vehicle.id)
  const getEvidenceForIds = (ids: string[]): EvidenceRecord[] =>
    evidence.filter((e) => ids.includes(e.id))

  const activePlate = useMemo(() => {
    const active = registrationRecords
      .filter((r) => !r.archived && r.plate)
      .sort((a, b) => (b.registrationDate ?? "").localeCompare(a.registrationDate ?? ""))[0]
    return active
      ? `${active.plate}${active.stateProvince ? " " + getJurisdictionLabel(active.stateProvince) : ""}`
      : null
  }, [registrationRecords])

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
      setPendingRegistrationEvidence({ id: evidenceRecord.id, documentType: ocrContext.documentType, values })
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
  const [pendingRegistrationEvidence, setPendingRegistrationEvidence] = useState<{ id: string; documentType: string; values: Record<string, unknown> } | null>(null)
  const [pendingPermitEvidenceId, setPendingPermitEvidenceId] = useState<string | null>(null)
  const [pendingInspectionEvidenceId, setPendingInspectionEvidenceId] = useState<string | null>(null)
  const [pendingMaintenanceEvidenceId, setPendingMaintenanceEvidenceId] = useState<string | null>(null)

  const [activityRefreshKey, setActivityRefreshKey] = useState(0)

  const persistChild = (next: VehicleStore, audit: { action: "CREATE" | "UPDATE" | "ARCHIVE" | "RESTORE"; entityId: string; entityType: "Vehicle" | "Permit" | "Inspection" | "Evidence"; details: string }) => {
    try {
      saveVehicleStore(companyId, next)
      onStoreChange(next)
      recordAuditEvent({ action: audit.action, entityType: audit.entityType, entityId: audit.entityId, companyId, actor: "", role: "", details: audit.details })
      addVehicleActivity(companyId, vehicle.id, {
        event: `${audit.action}_${audit.entityType.toUpperCase()}`,
        detail: audit.details,
        section: audit.entityType.toLowerCase(),
      })
      setActivityRefreshKey((k) => k + 1)
      setError(null)
      setNotice("Saved successfully.")
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "The record could not be saved.")
      return false
    }
  }

  const openEvidence = (item: EvidenceRecord) => setPreviewEvidence(item)

  const [companyName, setCompanyName] = useState<string>("")
  useEffect(() => {
    try {
      const companies = JSON.parse(
        localStorage.getItem("tes_companies") || "[]"
      )
      const match = companies.find((c: any) => c.id === companyId)
      if (match) setCompanyName(match.name)
    } catch {}
  }, [companyId])

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center justify-between border-b border-border bg-background px-0 py-3">

        {/* Left: back + identity */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Back"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </button>

          <div className="flex flex-col gap-0.5">
            {/* Row 1: unit number + status + company name */}
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground leading-tight">
                {vehicle.unitNumber || "Vehicle"}
              </span>
              <StatusPill value={vehicle.status} />
              {companyName ? (
                <>
                  <div className="mx-2 h-4 w-px bg-border shrink-0" />
                  <span className="text-xs text-muted-foreground font-medium">
                    {companyName}
                  </span>
                </>
              ) : null}
            </div>
            {/* Row 2: vehicle details */}
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground leading-tight">
              {vehicle.equipmentType ? (
                <span>{vehicle.equipmentType}</span>
              ) : null}
              {vehicle.year ? (
                <><span className="opacity-40">·</span><span>{vehicle.year}</span></>
              ) : null}
              {vehicle.make ? (
                <><span className="opacity-40">·</span><span>{vehicle.make}</span></>
              ) : null}
              {vehicle.model ? (
                <><span className="opacity-40">·</span><span>{vehicle.model}</span></>
              ) : null}
              {vehicle.vin ? (
                <><span className="opacity-40">·</span>
                <span className="font-mono">{vehicle.vin}</span></>
              ) : null}
              {activePlate ? (
                <><span className="opacity-40">·</span>
                <span>{activePlate}</span></>
              ) : null}
            </div>
          </div>
        </div>

        {/* Right: icon actions + Document/OCR button */}
        <div className="flex items-center gap-2 shrink-0">

          {/* Clone icon button */}
          <button
            type="button"
            title="Clone"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Copy className="size-4" />
          </button>

          {/* Archive / Restore icon button */}
          {vehicle.status === "Archived" ? (
            <button
              type="button"
              title="Restore"
              onClick={onRestore}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              title="Archive"
              onClick={onArchive}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Archive className="size-4" />
            </button>
          )}

          {/* Document / OCR — keeps existing style */}
          <Button
            size="sm"
            onClick={() => openSourcePicker({ kind: "profile" })}
            className="ml-1"
          >
            <Upload className="mr-1.5 size-3.5" />
            Document / OCR
          </Button>
        </div>
      </div>

      {error ? <AlertBanner message={error} onClose={() => setError(null)} /> : null}
      {notice ? <NoticeBanner message={notice} onClose={() => setNotice(null)} /> : null}

      <div className="flex flex-wrap gap-1 border-b border-border">
        {(["profile", "ownership", "registrations", "permits", "maintenance", "activity", "settings"] as const).map((item) => <button key={item} onClick={() => { setTab(item); setSelectedRecordEvidence(null); pushHistoryQueryParams({ vehicleTab: item }) }} className={`border-b-2 px-3 py-2 text-xs font-semibold capitalize ${tab === item ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{item === "registrations" ? "Registration" : item}</button>)}
      </div>

      <div className={`flex gap-0 ${selectedRecordEvidence ? "divide-x divide-border" : ""}`}>
        <div className={selectedRecordEvidence ? "flex-1 min-w-0" : "w-full"}>
          {tab === "profile" ? <ProfileTab companyId={companyId} vehicle={vehicle} FieldComponent={Field} SectionTitleComponent={SectionTitle} onSave={onSaveVehicle} onStartOCR={() => openSourcePicker({ kind: "profile" })} ocrValues={profileOCRValues} /> : null}
          {tab === "ownership" ? <OwnershipTab companyId={companyId} store={store} vehicle={vehicle} records={ownershipRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(documentType) => openSourcePicker({ kind: "ownership", documentType })} pendingEvidenceId={pendingOwnershipEvidenceId} clearPendingEvidence={() => setPendingOwnershipEvidenceId(null)} setError={setError} setNotice={setNotice} /> : null}
          {tab === "registrations" ? <RegistrationTab companyId={companyId} store={store} vehicle={vehicle} records={registrationRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(documentType) => openSourcePicker({ kind: "registration", documentType })} pendingEvidence={pendingRegistrationEvidence} clearPendingEvidence={() => setPendingRegistrationEvidence(null)} setError={setError} setNotice={setNotice} onOpenEvidence={openEvidence} /> : null}
          {tab === "permits" ? <PermitTab companyId={companyId} store={store} vehicle={vehicle} records={permitRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(documentType) => openSourcePicker({ kind: "permit", documentType })} pendingEvidenceId={pendingPermitEvidenceId} clearPendingEvidence={() => setPendingPermitEvidenceId(null)} setError={setError} setNotice={setNotice} onRecordClick={(record) => setSelectedRecordEvidence({ recordLabel: `${record.permitType === "Other" ? record.customPermitType : record.permitType} · ${record.jurisdiction ?? ""}`, evidenceIds: record.evidenceIds ?? [] })} /> : null}
          {tab === "maintenance" ? <MaintenanceTab companyId={companyId} store={store} vehicle={vehicle} inspections={inspectionRecords} maintenance={maintenanceRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(kind, documentType) => openSourcePicker({ kind, documentType })} pendingInspectionEvidenceId={pendingInspectionEvidenceId} pendingMaintenanceEvidenceId={pendingMaintenanceEvidenceId} clearInspectionEvidence={() => setPendingInspectionEvidenceId(null)} clearMaintenanceEvidence={() => setPendingMaintenanceEvidenceId(null)} setError={setError} setNotice={setNotice} onRecordClick={(record) => setSelectedRecordEvidence({ recordLabel: "inspectionType" in record ? record.inspectionType : record.maintenanceType, evidenceIds: record.evidenceIds ?? [] })} /> : null}
          {tab === "activity" ? (
            <div className="space-y-0">
              <div className="flex items-center justify-between px-1 py-3 border-b border-border">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Vehicle Activity
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Complete append-only compliance and maintenance trail for this unit.
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground border border-border rounded-full px-2.5 py-1">
                  Append-only
                </span>
              </div>

              <VehicleActivitySection
                companyId={companyId}
                vehicleId={vehicle.id}
                refreshKey={activityRefreshKey}
                showAll={true}
              />
            </div>
          ) : null}

          {tab === "settings" ? (
            <SettingsTab companyId={companyId} vehicle={vehicle} onSaved={() => setActivityRefreshKey((k) => k + 1)} />
          ) : null}
        </div>

        {selectedRecordEvidence ? (
          <div className="w-80 shrink-0 flex flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Evidence
                </p>
                <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                  {selectedRecordEvidence.recordLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecordEvidence(null)}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {getEvidenceForIds(selectedRecordEvidence.evidenceIds).length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-4 text-center">
                  No evidence attached to this record.
                </p>
              ) : (
                getEvidenceForIds(selectedRecordEvidence.evidenceIds).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openEvidence(item)}
                    className="w-full text-left rounded-lg border border-border
                      bg-card p-3 hover:bg-muted transition-colors"
                  >
                    <p className="text-xs font-medium text-foreground truncate">
                      {item.fileName}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {item.documentType} · {item.uploadedAt?.split("T")[0] ?? ""}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>

      <UnsavedChangesPrompt hasChanges={false} onSave={() => undefined} onDiscard={() => undefined} />

      {sourceContext ? <div className="fixed inset-0 z-[200]"><DocumentSourcePicker isOpen onClose={() => setSourceContext(null)} onSelectCamera={() => { setSourceContext(sourceContext); setShowCamera(true) }} onSelectFile={(file) => { const context = sourceContext; setSourceContext(null); void beginOCR(context, file) }} title="Vehicle Document — OCR First" subtitle="Capture or upload the source document before entering structured vehicle data." /></div> : null}
      {showCamera ? <div className="fixed inset-0 z-[200]"><CameraCapture onClose={() => setShowCamera(false)} onCapture={(file) => { setShowCamera(false); if (ocrContext || sourceContext) void beginOCR((ocrContext || sourceContext)!, file) }} /></div> : null}
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
  return <div className="fixed inset-0 z-[200] bg-background"><OCRReview documentResult={result} documentDataUrl={dataUrl} initialValues={initialValues} fieldDefinitions={fieldDefinitions} onConfirm={onConfirm} onCancel={onCancel} /></div>
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

function RegistrationArchiveDialog({ companyId, record, vehicle, evidence, onCancel, onArchive }: { companyId: string; record: VehicleRegistrationRecord; vehicle: VehicleRecord; evidence: EvidenceRecord[]; onCancel: () => void; onArchive: (request: RegistrationArchiveRequest, requestEvidence: EvidenceRecord, performedBy: string, archivedAt: string) => void }) {
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
              <Field label="Requested By" required>
                <Input value={requestedBy} onChange={(event) => setRequestedBy(event.target.value)} placeholder="Name of the person requesting the archive" autoComplete="off" />
              </Field>

              <Field label="Request Source" required>
                <select className={selectClass} value={requestSource} onChange={(event) => { setRequestSource(event.target.value as RegistrationArchiveRequest["requestSource"]); setRequestReference(""); setArchiveRequestEvidence(null); setUploadError(null) }}>
                  <option value="">Select…</option>
                  <option value="Client Portal">Client Portal</option>
                  <option value="Email">Email</option>
                  <option value="Ticket">Ticket</option>
                  <option value="Other Documented Source">Other Documented Source</option>
                </select>
              </Field>

              {requestSource ? (
                <Field label={referenceLabel} required={requiresReference}>
                  <Input
                    value={requestReference}
                    onChange={(event) => setRequestReference(event.target.value)}
                    placeholder={requestSource === "Email" ? "Email subject, sender, or message/reference ID" : requestSource === "Ticket" ? "Ticket number or ID/reference" : requestSource === "Client Portal" ? "Temporary portal request reference" : "Describe the source or reference"}
                  />
                  {requestSource === "Email" ? <p className="mt-1 text-[11px] text-muted-foreground">Use the email subject, sender, and/or message/reference identifier where available.</p> : null}
                  {requestSource === "Client Portal" ? <p className="mt-1 text-[11px] text-muted-foreground">Temporary prototype field. Authenticated portal request metadata will provide this automatically later.</p> : null}
                </Field>
              ) : null}

              {requestSource ? (
                <Field label="Archive Request Evidence" required>
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
                </Field>
              ) : null}

              <Field label="Reason (optional)">
                <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional context supplied with the request" />
              </Field>

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
              <Field label='Type "ARCHIVE" to confirm' required>
                <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="ARCHIVE" autoComplete="off" />
              </Field>
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


function RegistrationTab({ companyId, store, vehicle, records, evidence, onStoreChange, onStartOCR, pendingEvidence, clearPendingEvidence, setError, setNotice, onOpenEvidence }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; records: VehicleRegistrationRecord[]; evidence: EvidenceRecord[]; onStoreChange: (store: VehicleStore) => void; onStartOCR: (documentType: string) => void; pendingEvidence: { id: string; documentType: string; values: Record<string, unknown> } | null; clearPendingEvidence: () => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void; onOpenEvidence: (item: EvidenceRecord) => void }) {
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
    <Card><SectionTitle title="Registration" description="Historical registrations; current plate comes from the active registration." action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide History" : "Show History"}</Button><Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}><Plus className="mr-1.5 size-3.5" />Add Registration</Button></div>} /></Card>
    {visible.length === 0 ? <EmptyState title="No registration records" description="Registration Document is mandatory for every registration. Prorate PSV additionally requires a Cab Card." action={<Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 size-4" />Add Registration</Button>} /> : <div className="space-y-2">{visible.map((record) => <Card key={record.id} className={`${record.archived ? "opacity-70" : ""} cursor-pointer hover:bg-muted/20 transition-colors`} onClick={() => setSelectedRecord(record)}><div className="flex items-center justify-between border-b px-4 py-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.registrationType}</h3><StatusPill value={registrationStatus(record)} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div><ChevronRight className="size-4 text-muted-foreground" /></div><div className="grid gap-3 p-4 md:grid-cols-4"><ReadOnlyField label="State / Province" value={`${getJurisdictionLabel(record.stateProvince)} (${record.stateProvince})`} /><ReadOnlyField label="Plate" value={record.plate || "—"} /><ReadOnlyField label="Registration Date" value={record.registrationDate || "—"} /><ReadOnlyField label="Expiry Date" value={isContinuousRegistration(vehicle, record.registrationType) ? "Continuous" : record.expiryDate || "—"} /><ReadOnlyField label="Registration Document" value={record.registrationDocumentEvidenceId ? "Attached" : "Missing"} /><ReadOnlyField label="Cab Card" value={record.cabCardEvidenceId ? "Attached" : record.registrationType === "Prorate PSV" ? "Missing" : "Not required by rule"} /></div></Card>)}</div>}
    {selectedRecord ? <TESRecordOverlay open title={selectedRecord.registrationType} subtitle="Registration" context={`Unit ${vehicle.unitNumber || "—"} · ${getJurisdictionLabel(selectedRecord.stateProvince)} · ${registrationStatus(selectedRecord)}`} onClose={() => { if (!archiveRecord) setSelectedRecord(null) }} ariaLabel={`Registration record ${selectedRecord.id}`} actions={<><Button variant="outline" onClick={() => { setEditing(selectedRecord); setSelectedRecord(null); setShowForm(true) }} className="border-primary-foreground/55 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"><Edit3 className="mr-1.5 size-3.5" />Edit</Button>{!selectedRecord.archived ? <button type="button" title="Archive record" aria-label="Archive record" onClick={() => setArchiveRecord(selectedRecord)} className="flex size-9 items-center justify-center rounded-md border border-primary-foreground/35 text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"><Archive className="size-4" /></button> : null}</>}>
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <section className="rounded-xl border border-border bg-card"><div className="border-b border-border px-4 py-3 sm:px-5"><h3 className="text-sm font-semibold">Registration Information</h3><p className="mt-0.5 text-xs text-muted-foreground">Read-only structured record.</p></div><div className="grid gap-x-6 gap-y-5 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4"><ReadOnlyField label="Registration Type" value={selectedRecord.registrationType} /><ReadOnlyField label="Jurisdiction" value={`${getJurisdictionLabel(selectedRecord.stateProvince)} (${selectedRecord.stateProvince})`} /><ReadOnlyField label="Plate" value={selectedRecord.plate || "—"} /><ReadOnlyField label="Registration Date" value={selectedRecord.registrationDate || "—"} /><ReadOnlyField label="Expiry Date" value={isContinuousRegistration(vehicle, selectedRecord.registrationType) ? "Continuous" : selectedRecord.expiryDate || "—"} />{selectedRecord.price ? <ReadOnlyField label="Price" value={money(selectedRecord.price)} /> : null}<div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</p><div className="mt-1"><StatusPill value={registrationStatus(selectedRecord)} /></div></div><ReadOnlyField label="Record ID" value={selectedRecord.id} /></div></section>
        <section className="rounded-xl border border-border bg-card"><div className="border-b border-border px-4 py-3 sm:px-5"><h3 className="text-sm font-semibold">Evidence</h3><p className="mt-0.5 text-xs text-muted-foreground">Source documents linked to this Registration record.</p></div><div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">{evidenceItem("Registration Document", selectedRecord.registrationDocumentEvidenceId, true)}{evidenceItem("Cab Card", selectedRecord.cabCardEvidenceId, selectedRecord.registrationType === "Prorate PSV")}</div></section>
      </div>
    </TESRecordOverlay> : null}
    {archiveRecord ? <RegistrationArchiveDialog companyId={companyId} record={archiveRecord} vehicle={vehicle} evidence={evidence} onCancel={() => setArchiveRecord(null)} onArchive={(request, requestEvidence, performedBy, archivedAt) => archive(archiveRecord, request, requestEvidence, performedBy, archivedAt)} /> : null}
    {showForm ? <RegistrationForm companyId={companyId} store={store} vehicle={vehicle} initial={editing} pendingEvidence={pendingEvidence} onStartOCR={onStartOCR} clearPendingEvidence={clearPendingEvidence} onClose={() => setShowForm(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} /> : null}
  </div>
}
function RegistrationForm({ companyId, store, vehicle, initial, pendingEvidence, clearPendingEvidence, onStartOCR, onClose, onStoreChange, setError, setNotice }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; initial: VehicleRegistrationRecord | null; pendingEvidence: { id: string; documentType: string; values: Record<string, unknown> } | null; clearPendingEvidence: () => void; onStartOCR: (documentType: string) => void; onClose: () => void; onStoreChange: (store: VehicleStore) => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void }) {
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
    <ModalShell
      title={`${initial ? "Edit" : "Add"} Registration`}
      subtitle="OCR first. Registration Document is mandatory; Cab Card is conditional."
      onClose={onClose}
      footer={<ModalFooter note="OCR first. Registration Document is always required." onCancel={onClose} onSave={save} saveLabel="Save Registration" />}
    >
      <ModalOCRStrip
        title="Start with Registration Document"
        description="Capture the source before entering State / Province, Plate and dates."
        onStartOCR={() => { setDocTarget("registration"); onStartOCR("Registration Document") }}
      />

      <ModalSectionLabel>Registration Details</ModalSectionLabel>
      <ModalFieldGrid>
        <ModalField label="Registration Type" required>
          <select className={modalFieldInputClass} value={registrationType} disabled={trailer} onChange={(e) => setRegistrationType(e.target.value)}>
            {REGISTRATION_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
          {trailer ? <p className="mt-1 text-[10px] text-muted-foreground">Trailers use Continuous registration. No expiry date required.</p> : null}
        </ModalField>
        <ModalField label="Registration Status">
          <select className={modalFieldInputClass} value={status} onChange={(e) => setStatus(e.target.value as VehicleRegistrationRecord["status"])}>
            {["Draft", "Active", "Expired", "Replaced", "Cancelled"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalField>
        <ModalField label="State / Province" required>
          <select className={modalFieldInputClass} value={stateProvince} onChange={(e) => setStateProvince(e.target.value)}>
            <option value="">Select…</option>
            {JURISDICTIONS.map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}
          </select>
        </ModalField>
        <ModalField label="Plate" required>
          <Input className={modalFieldInputClass} value={plate} onChange={(e) => setPlate(e.target.value)} />
        </ModalField>
        <ModalField label="Registration Date" required>
          <Input className={modalFieldInputClass} type="date" value={registrationDate} onChange={(e) => setRegistrationDate(e.target.value)} />
        </ModalField>
        {!trailer ? (
          <ModalField label="Expiry Date">
            <Input className={modalFieldInputClass} type="date" value={continuous ? "" : expiryDate} disabled={continuous} onChange={(e) => setExpiryDate(e.target.value)} />
          </ModalField>
        ) : null}
        <ModalField label="Price" className="col-span-2">
          <Input className={modalFieldInputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
        </ModalField>
      </ModalFieldGrid>

      <ModalSectionLabel>Evidence</ModalSectionLabel>
      <div className="px-6 grid grid-cols-2 gap-3 pb-4">
        <ModalEvidenceCard
          label="Registration Document *"
          attached={Boolean(registrationDocumentEvidenceId)}
          onAttach={() => { setDocTarget("registration"); onStartOCR("Registration Document") }}
        />
        {registrationType === "Prorate PSV" ? (
          <ModalEvidenceCard
            label="Cab Card *"
            attached={Boolean(cabCardEvidenceId)}
            onAttach={() => { setDocTarget("cabCard"); onStartOCR("Cab Card") }}
          />
        ) : null}
      </div>
    </ModalShell>
  )
}

function PermitTab({ companyId, store, vehicle, records, evidence, onStoreChange, onStartOCR, pendingEvidenceId, clearPendingEvidence, setError, setNotice, onRecordClick }: { companyId: string; store: VehicleStore; vehicle: VehicleRecord; records: VehiclePermitRecord[]; evidence: EvidenceRecord[]; onStoreChange: (store: VehicleStore) => void; onStartOCR: (documentType: string) => void; pendingEvidenceId: string | null; clearPendingEvidence: () => void; setError: (value: string | null) => void; setNotice: (value: string | null) => void; onRecordClick?: (record: VehiclePermitRecord) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<VehiclePermitRecord | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const visible = records.filter((record) => showArchived || !record.archived)
  const archive = (record: VehiclePermitRecord) => { const next = { ...store, permitRecords: store.permitRecords.map((item) => item.id === record.id ? { ...item, archived: true, updatedAt: isoNow() } : item) }; try { saveVehicleStore(companyId, next); onStoreChange(next); recordAuditEvent({ action: "ARCHIVE", entityType: "Vehicle", entityId: record.id, companyId, actor: "", role: "", details: `Archived permit record ${record.id}.` }); setNotice("Permit archived.") } catch (err) { setError(err instanceof Error ? err.message : "Could not archive permit.") } }
  return <div className="space-y-3"><Card><SectionTitle title="Permits" description="Existing permit fields and derived status behavior are preserved." action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide History" : "Show History"}</Button><Button size="sm" onClick={() => { setEditing(null); setShowForm(true) }}><Plus className="mr-1.5 size-3.5" />Add Permit</Button></div>} /></Card>
    {visible.length === 0 ? <EmptyState title="No permit records" description="Begin permit capture with OCR/document source." action={<Button onClick={() => setShowForm(true)}><Plus className="mr-1.5 size-4" />Add Permit</Button>} /> : <div className="space-y-2">{visible.map((record) => <Card key={record.id} className={`${record.archived ? "opacity-70" : ""} cursor-pointer hover:bg-muted/20 transition-colors`} onClick={() => onRecordClick?.(record)}><div className="flex items-center justify-between border-b px-4 py-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.permitType === "Other" ? record.customPermitType : record.permitType}</h3><StatusPill value={permitDisplayStatus(record)} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditing(record); setShowForm(true) }}><Edit3 className="mr-1 size-3" />Edit</Button>{!record.archived ? <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); archive(record) }}><Archive className="mr-1 size-3" />Archive</Button> : null}</div></div><div className="grid gap-3 p-4 md:grid-cols-4"><ReadOnlyField label="Permit #" value={record.permitNumber || "—"} /><ReadOnlyField label="Jurisdiction" value={record.jurisdiction || "—"} /><ReadOnlyField label="Start" value={record.startDate || "—"} /><ReadOnlyField label="Expiry" value={record.expiryDate || "—"} /><ReadOnlyField label="Evidence" value={record.evidenceIds.length ? `${record.evidenceIds.length} attached` : "Missing"} /><ReadOnlyField label="Notes" value={record.notes || "—"} /></div></Card>)}</div>}
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
  return (
    <ModalShell
      title={`${initial ? "Edit" : "Add"} Permit`}
      subtitle="OCR/document capture is the first action."
      onClose={onClose}
      footer={<ModalFooter note="Upload the permit document or decal image." onCancel={onClose} onSave={save} saveLabel="Save Permit" />}
    >
      <ModalOCRStrip
        title="Start with Permit Document"
        description="Review the source before committing permit fields."
        onStartOCR={() => onStartOCR("Permit Document")}
      />

      <ModalSectionLabel>Permit Details</ModalSectionLabel>
      <ModalFieldGrid>
        <ModalField label="Permit Type" required>
          <select className={modalFieldInputClass} value={permitType} onChange={(e) => setPermitType(e.target.value)}>
            {PERMIT_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalField>
        <ModalField label="Permit #">
          <Input className={modalFieldInputClass} value={permitNumber} onChange={(e) => setPermitNumber(e.target.value)} />
        </ModalField>
        {permitType === "Other" ? (
          <ModalField label="Custom Permit Type" className="col-span-2">
            <Input className={modalFieldInputClass} value={customPermitType} onChange={(e) => setCustomPermitType(e.target.value)} />
          </ModalField>
        ) : null}
        <ModalField label="Jurisdiction">
          <select className={modalFieldInputClass} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
            <option value="">Select…</option>
            {JURISDICTIONS.map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}
          </select>
        </ModalField>
        <ModalField label="Status">
          <select className={modalFieldInputClass} value={status} onChange={(e) => setStatus(e.target.value as VehiclePermitRecord["status"])}>
            <option>Active</option>
            <option>Cancelled</option>
          </select>
        </ModalField>
        <ModalField label="Start Date">
          <Input className={modalFieldInputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </ModalField>
        <ModalField label="Expiry Date">
          <Input className={modalFieldInputClass} type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </ModalField>
        <ModalField label="Notes" className="col-span-2">
          <Textarea rows={3} className={modalFieldInputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </ModalField>
      </ModalFieldGrid>

      <ModalSectionLabel>Evidence</ModalSectionLabel>
      <div className="px-6 grid grid-cols-2 gap-3 pb-4">
        <ModalEvidenceCard
          label="Permit Document"
          attached={evidenceIds.length > 0}
          attachedNote={evidenceIds.length ? `${evidenceIds.length} attached` : undefined}
          onAttach={() => onStartOCR("Permit Document")}
        />
      </div>
    </ModalShell>
  )
}

function FindingRow({ companyId, store, finding, onStoreChange, setNotice, setError }: {
  companyId: string
  store: VehicleStore
  finding: InspectionFinding
  onStoreChange: (store: VehicleStore) => void
  setNotice: (value: string | null) => void
  setError: (value: string | null) => void
}) {
  const [showLink, setShowLink] = useState(false)
  const refresh = () => onStoreChange(loadVehicleStore(companyId))
  const allItems = store.maintenanceItems.filter((item) => !item.archived)
  const links = getLinksForFinding(store, finding.id)
  const linkedItems = links.map((link) => allItems.find((item) => item.id === link.maintenanceItemId)).filter((item): item is MaintenanceItem => Boolean(item))

  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">{finding.rawDescription}</p>
          {finding.componentSystem ? <p className="text-[10px] text-muted-foreground mt-0.5">{finding.componentSystem}</p> : null}
          {finding.affectedEntityRawRef ? <p className="text-[10px] text-muted-foreground">Unresolved unit ref: {finding.affectedEntityRawRef}</p> : null}
        </div>
        <StatusPill value={finding.status} />
      </div>
      {linkedItems.length > 0 ? (
        <div className="mt-1.5 space-y-0.5">
          {linkedItems.map((item) => (
            <p key={item.id} className="text-[10px] text-muted-foreground">→ Maintenance Item: {item.specificDescription}</p>
          ))}
        </div>
      ) : null}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => setShowLink((value) => !value)}>Link Maintenance Item</Button>
        {finding.status !== "RESOLVED" ? (
          <Button variant="ghost" size="sm" onClick={() => { updateInspectionFindingStatus(companyId, finding.id, "RESOLVED"); refresh(); setNotice("Finding marked resolved.") }}>
            Mark Resolved
          </Button>
        ) : null}
      </div>
      {showLink ? (
        <select
          className={`${selectClass} mt-1.5`}
          defaultValue=""
          onChange={(e) => {
            if (!e.target.value) return
            linkFindingToMaintenanceItem(companyId, finding.id, e.target.value)
            refresh()
            setShowLink(false)
            setNotice("Finding linked to maintenance item.")
          }}
        >
          <option value="">Select a Maintenance Item…</option>
          {allItems.map((item) => <option key={item.id} value={item.id}>{item.specificDescription}</option>)}
        </select>
      ) : null}
    </div>
  )
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
      <SectionTitle
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

function MaintenanceTab({ companyId, store, vehicle, inspections, maintenance, evidence, onStoreChange, onStartOCR, pendingInspectionEvidenceId, pendingMaintenanceEvidenceId, clearInspectionEvidence, clearMaintenanceEvidence, setError, setNotice, onRecordClick }: {
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
}) {
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
        />
      ) : null}

      {view === "inspections" ? (
        <RoadsideInspectionsPanel companyId={companyId} vehicleId={vehicle.id} />
      ) : null}

      {view === "inspections" ? (
        activeInspections.length === 0 ? (
          <EmptyState title="No inspection records" description="Upload an inspection document or add an inspection manually." action={<Button onClick={() => setShowInspection(true)}><Plus className="mr-1.5 size-4" />Add Inspection</Button>} />
        ) : (
          <div className="space-y-2">
            {activeInspections.map((record) => (
              <Card key={record.id} className="cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => onRecordClick?.(record)}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.inspectionType}</h3><StatusPill value={record.inspectionStatus} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div>
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
          <EmptyState title="No maintenance records" description="Upload a work order/invoice or add a maintenance record manually." action={<Button onClick={() => setShowMaintenance(true)}><Plus className="mr-1.5 size-4" />Add Maintenance</Button>} />
        ) : (
          <div className="space-y-2">
            {activeMaintenance.map((record) => (
              <Card key={record.id} className="cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => onRecordClick?.(record)}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div><div className="flex items-center gap-2"><h3 className="text-sm font-bold">{record.maintenanceType}</h3><StatusPill value={record.maintenanceStatus} /></div><p className="font-mono text-[10px] text-muted-foreground">{record.id}</p></div>
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

      {showInspection ? <InspectionForm companyId={companyId} store={store} vehicle={vehicle} initial={editingInspection} pendingEvidenceId={pendingInspectionEvidenceId} clearPendingEvidence={clearInspectionEvidence} onStartOCR={() => onStartOCR("inspection", "Inspection Document")} onClose={() => setShowInspection(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} /> : null}
      {showMaintenance ? <MaintenanceForm companyId={companyId} store={store} vehicle={vehicle} initial={editingMaintenance} pendingEvidenceId={pendingMaintenanceEvidenceId} clearPendingEvidence={clearMaintenanceEvidence} onStartOCR={() => onStartOCR("maintenance", "Maintenance Work Order / Invoice")} onClose={() => setShowMaintenance(false)} onStoreChange={onStoreChange} setError={setError} setNotice={setNotice} /> : null}
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
        />
      ) : null}
    </div>
  )
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0)
}

function RepairBillsView({
  companyId,
  vehicle,
  repairInvoices,
  partCatalog,
  spendSummary,
  spendByCategory,
  recurringIssues,
  onAddRepairBill,
}: {
  companyId: string
  vehicle: VehicleRecord
  repairInvoices: { invoice: RepairInvoice; lines: RepairInvoiceLine[] }[]
  partCatalog: PartCatalogEntry[]
  spendSummary: { spendYTD: number; spendSinceFleetEntry: number }
  spendByCategory: { category: string; total: number; lineCount: number }[]
  recurringIssues: { key: string; label: string; count: number; monthsSpan: number }[]
  onAddRepairBill: () => void
}) {
  const catalogById = new Map(partCatalog.map((entry) => [entry.id, entry]))
  const maxCategorySpend = Math.max(1, ...spendByCategory.map((row) => row.total))

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Spend</p>
          <p className="mt-2 text-xl font-bold tabular-nums">{currency(spendSummary.spendYTD)}</p>
          <p className="text-[11px] text-muted-foreground">This year</p>
          <div className="mt-3 border-t border-border pt-2">
            <p className="text-sm font-semibold tabular-nums">{currency(spendSummary.spendSinceFleetEntry)}</p>
            <p className="text-[11px] text-muted-foreground">Since fleet entry</p>
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Spend by Category</p>
          {spendByCategory.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">No matched parts yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {spendByCategory.map((row) => (
                <div key={row.category}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium">{row.category}</span>
                    <span className="tabular-nums text-muted-foreground">{currency(row.total)}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${Math.max(4, (row.total / maxCategorySpend) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recurring Issues</p>
          {recurringIssues.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">No part repaired 3+ times in the last 12 months.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {recurringIssues.map((issue) => (
                <div key={issue.key} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{issue.label}</p>
                  <p className="text-[10px] text-muted-foreground">{issue.count} repairs in {issue.monthsSpan} months</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle
          title="Repair Bills"
          description="Line-item detail exactly as billed, from OCR or manual entry."
          action={<Button size="sm" onClick={onAddRepairBill}><Plus className="mr-1.5 size-3.5" />Add Repair Bill</Button>}
        />
        {repairInvoices.length === 0 ? (
          <EmptyState title="No repair bills recorded" description="Add a repair bill manually, or attach one through Upload Document / OCR." action={<Button onClick={onAddRepairBill}><Plus className="mr-1.5 size-4" />Add Repair Bill</Button>} />
        ) : (
          <div className="space-y-2 p-3">
            {repairInvoices.map(({ invoice, lines }) => (
              <Card key={invoice.id}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold">{invoice.invoiceNumber || "Repair Bill"}</h3>
                      <StatusPill value={invoice.status === "auto_approved" ? "Verified" : "Pending"} />
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">{invoice.entrySource}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{invoice.invoiceDate || "—"}{invoice.vendorName ? ` · ${invoice.vendorName}` : ""}{invoice.maintenanceEventId ? ` · Linked to Maintenance Event ${invoice.maintenanceEventId}` : ""}</p>
                  </div>
                  <p className="text-sm font-bold tabular-nums">{currency(invoice.totalDue)}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2">Description</th>
                        <th className="px-4 py-2">Part</th>
                        <th className="px-4 py-2 text-right">Qty</th>
                        <th className="px-4 py-2 text-right">Unit Price</th>
                        <th className="px-4 py-2 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {lines.map((line) => (
                        <tr key={line.id}>
                          <td className="px-4 py-2">
                            {line.description}
                            {line.matchedPartId ? (
                              <span className="ml-1.5 text-[10px] text-muted-foreground">
                                → {catalogById.get(line.matchedPartId)?.canonicalName ?? "matched"}
                                {line.matchConfidence !== undefined ? ` (${Math.round(line.matchConfidence * 100)}%)` : ""}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">{line.partNumber || "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{line.quantity}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{currency(line.unitPrice)}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">{currency(line.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/10">
                        <td colSpan={4} className="px-4 py-2 text-right text-[11px] font-semibold">Invoice Total</td>
                        <td className="px-4 py-2 text-right font-bold tabular-nums">{currency(invoice.totalDue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {!invoice.reconciles ? (
                  <div className="border-t px-4 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    Line items subtotal ({currency(invoice.subtotal)}) does not reconcile with invoice total.
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function RepairBillLineRow({
  line,
  onChange,
  onRemove,
  canRemove,
}: {
  line: RepairLineInput
  onChange: (next: RepairLineInput) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const [overrideTotal, setOverrideTotal] = useState(false)
  const computedTotal = Math.round(line.quantity * line.unitPrice * 100) / 100
  return (
    <div className="grid grid-cols-12 gap-2 items-start rounded-lg border border-border p-3">
      <div className="col-span-4">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description<span className="text-destructive ml-0.5">*</span></label>
        <Input className="mt-1" value={line.description} onChange={(e) => onChange({ ...line, description: e.target.value })} />
      </div>
      <div className="col-span-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Part #</label>
        <Input className="mt-1" value={line.partNumber || ""} onChange={(e) => onChange({ ...line, partNumber: e.target.value })} />
      </div>
      <div className="col-span-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Qty<span className="text-destructive ml-0.5">*</span></label>
        <Input className="mt-1" type="number" min="0" step="any" value={line.quantity} onChange={(e) => onChange({ ...line, quantity: Number(e.target.value) || 0 })} />
      </div>
      <div className="col-span-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Unit Price<span className="text-destructive ml-0.5">*</span></label>
        <Input className="mt-1" type="number" min="0" step="any" value={line.unitPrice} onChange={(e) => onChange({ ...line, unitPrice: Number(e.target.value) || 0 })} />
      </div>
      <div className="col-span-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Line Total</label>
        <Input
          className="mt-1"
          type="number"
          min="0"
          step="any"
          value={overrideTotal ? (line.lineTotal ?? computedTotal) : computedTotal}
          onChange={(e) => { setOverrideTotal(true); onChange({ ...line, lineTotal: Number(e.target.value) || 0 }) }}
        />
        {overrideTotal ? (
          <button type="button" className="mt-0.5 text-[10px] text-primary hover:underline" onClick={() => { setOverrideTotal(false); onChange({ ...line, lineTotal: undefined }) }}>
            Reset to qty × unit price
          </button>
        ) : null}
      </div>
      <div className="col-span-1 flex justify-end pt-5">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={!canRemove}>
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function RepairBillForm({
  companyId,
  vehicle,
  store,
  onClose,
  onSaved,
  setError,
}: {
  companyId: string
  vehicle: VehicleRecord
  store?: VehicleStore
  onClose: () => void
  onSaved: () => void
  setError: (value: string | null) => void
}) {
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [invoiceDate, setInvoiceDate] = useState(todayISO())
  const [totalDue, setTotalDue] = useState("")
  const [vendor, setVendor] = useState<Company | null>(null)
  const [maintenanceEventId, setMaintenanceEventId] = useState("")
  const [lines, setLines] = useState<RepairLineInput[]>([{ description: "", partNumber: "", quantity: 1, unitPrice: 0 }])
  const maintenanceRecords = (store?.maintenanceRecords || []).filter((record) => record.vehicleId === vehicle.id && !record.archived)

  const searchVendors = (query: string) =>
    readCompanies()
      .filter((company) => `${company.name} ${company.id}`.toLowerCase().includes(query.trim().toLowerCase()))
      .map((company) => ({ entityType: "Company" as const, id: company.id, label: company.name, secondaryText: company.id, status: company.status }))

  const createNewVendor = () => {
    const name = window.prompt("New Service Provider / Vendor name")?.trim() || ""
    if (!name) return
    const companies = readCompanies()
    const validation = validateCompany({ name }, companies)
    if (!validation.isValid || (validation.warning && !window.confirm(validation.message))) {
      setError(validation.message || "Company already exists or could not be created.")
      return
    }
    const company: Company = { id: createId("CMP"), name, kind: "Vendor", status: "Active", tone: "ok" }
    try {
      localStorage.setItem("tes_companies", JSON.stringify([...companies, company]))
      setVendor(company)
    } catch {
      setError("Could not create the vendor.")
    }
  }

  const addLine = () => setLines((current) => [...current, { description: "", partNumber: "", quantity: 1, unitPrice: 0 }])
  const updateLine = (index: number, next: RepairLineInput) => setLines((current) => current.map((line, i) => (i === index ? next : line)))
  const removeLine = (index: number) => setLines((current) => current.filter((_, i) => i !== index))

  const subtotal = Math.round(
    lines.reduce((sum, line) => sum + (line.lineTotal ?? line.quantity * line.unitPrice), 0) * 100
  ) / 100
  const totalDueNumber = Number(totalDue) || 0
  const reconciles = Math.abs(subtotal - totalDueNumber) <= RECONCILIATION_TOLERANCE

  const save = () => {
    if (!invoiceNumber.trim()) return setError("Invoice Number is required.")
    if (!invoiceDate) return setError("Invoice Date is required.")
    if (!totalDue || totalDueNumber <= 0) return setError("Total Due is required.")
    if (lines.length === 0) return setError("At least one line item is required.")
    for (const line of lines) {
      if (!line.description.trim()) return setError("Every line item requires a Description.")
      if (!line.quantity || line.quantity <= 0) return setError("Every line item requires a Quantity.")
      if (line.unitPrice === undefined || line.unitPrice === null || Number.isNaN(line.unitPrice)) {
        return setError("Every line item requires a Unit Price.")
      }
    }

    try {
      const result = createManualRepairInvoice(companyId, {
        vehicleId: vehicle.id,
        vendorId: vendor?.id,
        vendorName: vendor?.name,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        totalDue: totalDueNumber,
        lines,
        maintenanceEventId: maintenanceEventId || undefined,
      })
      if (result.reconciliationWarning) {
        setError(null)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repair bill could not be saved.")
    }
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-bold">Add Repair Bill</h2>
            <p className="text-[11px] text-muted-foreground">Structured line items only — every dollar amount must be tied to a line row.</p>
          </div>
          <button onClick={onClose}><X className="size-4" /></button>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Invoice Number" required><Input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></Field>
            <Field label="Invoice Date" required><Input className={inputClass} type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
            <Field label="Total Due" required><Input className={inputClass} type="number" min="0" step="any" value={totalDue} onChange={(e) => setTotalDue(e.target.value)} /></Field>
            <Field label="Vendor">
              <EntityPicker
                label=""
                selectedEntity={vendor ? { entityType: "Company", id: vendor.id, label: vendor.name, secondaryText: vendor.id, status: vendor.status } : null}
                onSelect={(entity) => setVendor(entity ? readCompanies().find((company) => company.id === entity.id) || null : null)}
                onSearch={searchVendors}
                onCreateNew={createNewVendor}
                createNewButtonLabel="Create New Vendor"
              />
            </Field>
            <Field label="Maintenance Event" className="md:col-span-2">
              <select className={selectClass} value={maintenanceEventId} onChange={(e) => setMaintenanceEventId(e.target.value)}>
                <option value="">No linked Maintenance Event</option>
                {maintenanceRecords.map((record) => (
                  <option key={record.id} value={record.id}>{record.serviceDate || record.id} · {record.maintenanceType || "Maintenance"}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">Optional — one Maintenance Event can have zero, one, or multiple invoices.</p>
            </Field>
          </div>

          <Divider />

          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Line Items</p>
            <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="mr-1.5 size-3" />Add Line</Button>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <RepairBillLineRow
                key={index}
                line={line}
                onChange={(next) => updateLine(index, next)}
                onRemove={() => removeLine(index)}
                canRemove={lines.length > 1}
              />
            ))}
          </div>

          <div className="rounded-lg border bg-muted/20 p-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold">Subtotal: {currency(subtotal)}</p>
              {!reconciles && totalDue ? (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                  Subtotal does not match Total Due ({currency(totalDueNumber)}). You can still save — this will be flagged for review.
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>Save Repair Bill</Button>
          </div>
        </div>
      </div>
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
  const isRoadside = inspectionType === "CVSA / Roadside Inspection"
  return (
    <ModalShell
      title={`${initial ? "Edit" : "Add"} Inspection`}
      subtitle="OCR-first document capture is available directly here."
      onClose={onClose}
      footer={<ModalFooter note="Upload inspection report or certificate." onCancel={onClose} onSave={save} saveLabel="Save Inspection" />}
    >
      <ModalOCRStrip
        title="Inspection Document"
        description="Review source before committing the inspection record."
        onStartOCR={onStartOCR}
      />

      <ModalSectionLabel>Inspection Details</ModalSectionLabel>
      <ModalFieldGrid>
        <ModalField label="Inspection Type" required>
          <select className={modalFieldInputClass} value={inspectionType} onChange={(e) => setInspectionType(e.target.value)}>
            {INSPECTION_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalField>
        <ModalField label="Inspection Source">
          <select className={modalFieldInputClass} value={inspectionSource} onChange={(e) => setInspectionSource(e.target.value as VehicleInspectionRecord["inspectionSource"])}>
            {INSPECTION_SOURCES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalField>
        {isRoadside ? (
          <div className="col-span-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground">
            Enforcement data for roadside inspections is captured in the Driver Performance section. This record links the inspection to this vehicle for maintenance and compliance tracking.
          </div>
        ) : null}
        <ModalField label="Inspection Status" required>
          <select className={modalFieldInputClass} value={inspectionStatus} onChange={(e) => setInspectionStatus(e.target.value as VehicleInspectionRecord["inspectionStatus"])}>
            {INSPECTION_STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalField>
        <ModalField label="Inspection Date" required>
          <Input className={modalFieldInputClass} type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
        </ModalField>
        <ModalField label="Expiry Date">
          <Input className={modalFieldInputClass} type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </ModalField>
        <ModalField label="Next Due Date">
          <Input className={modalFieldInputClass} type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
        </ModalField>
        <ModalField label="Inspector / Shop">
          <Input className={modalFieldInputClass} value={inspectorShopName} onChange={(e) => setInspectorShopName(e.target.value)} />
        </ModalField>
        <ModalField label="Odometer">
          <Input className={modalFieldInputClass} value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </ModalField>
        <ModalField label="Engine Hours">
          <Input className={modalFieldInputClass} value={engineHours} onChange={(e) => setEngineHours(e.target.value)} />
        </ModalField>
        <ModalField label="Service Facility">
          <Input className={modalFieldInputClass} value={serviceFacility} onChange={(e) => setServiceFacility(e.target.value)} />
        </ModalField>
        <ModalField label="Defects Found">
          <select className={modalFieldInputClass} value={defectsFound} onChange={(e) => setDefectsFound(e.target.value as "Yes" | "No")}>
            <option>Yes</option>
            <option>No</option>
          </select>
        </ModalField>
        <div />
        <ModalField label="Notes" className="col-span-2">
          <Textarea rows={3} className={modalFieldInputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </ModalField>
      </ModalFieldGrid>

      <ModalSectionLabel>Evidence</ModalSectionLabel>
      <div className="px-6 grid grid-cols-2 gap-3 pb-4">
        <ModalEvidenceCard
          label="Inspection Document"
          attached={evidenceIds.length > 0}
          attachedNote={evidenceIds.length ? `${evidenceIds.length} attached` : undefined}
          onAttach={onStartOCR}
        />
      </div>
    </ModalShell>
  )
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
  return (
    <ModalShell
      title={`${initial ? "Edit" : "Add"} Maintenance Record`}
      subtitle="One Work Order / Invoice Number. Parts Cost and Total Cost are independently stored."
      onClose={onClose}
      footer={<ModalFooter note="Attach work order, invoice, or service record." onCancel={onClose} onSave={save} saveLabel="Save Maintenance" />}
    >
      <ModalOCRStrip
        title="Work Order / Invoice Document"
        description="Start with the source document and review it before saving."
        onStartOCR={onStartOCR}
      />

      <ModalSectionLabel>Maintenance Details</ModalSectionLabel>
      <ModalFieldGrid>
        <ModalField label="Maintenance Type" required>
          <select className={modalFieldInputClass} value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)}>
            {MAINTENANCE_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalField>
        <ModalField label="Maintenance Status" required>
          <select className={modalFieldInputClass} value={maintenanceStatus} onChange={(e) => setMaintenanceStatus(e.target.value as VehicleMaintenanceRecord["maintenanceStatus"])}>
            {MAINTENANCE_STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </ModalField>
        <ModalField label="Service Date" required>
          <Input className={modalFieldInputClass} type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
        </ModalField>
        <ModalField label="Odometer">
          <Input className={modalFieldInputClass} value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </ModalField>
        <ModalField label="Engine Hours">
          <Input className={modalFieldInputClass} value={engineHours} onChange={(e) => setEngineHours(e.target.value)} />
        </ModalField>
        <ModalField label="Vendor">
          <Input className={modalFieldInputClass} value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </ModalField>
        <ModalField label="Work Order / Invoice #">
          <Input className={modalFieldInputClass} value={workOrderInvoiceNumber} onChange={(e) => setWorkOrderInvoiceNumber(e.target.value)} />
        </ModalField>
        <ModalField label="Next Service Due">
          <Input className={modalFieldInputClass} type="date" value={nextServiceDueDate} onChange={(e) => setNextServiceDueDate(e.target.value)} />
        </ModalField>
        <ModalField label="Parts Cost">
          <Input className={modalFieldInputClass} type="number" min="0" value={partsCost} onChange={(e) => setPartsCost(e.target.value)} />
        </ModalField>
        <ModalField label="Total Cost">
          <Input className={modalFieldInputClass} type="number" min="0" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} />
        </ModalField>
        <ModalField label="Notes" className="col-span-2">
          <Textarea rows={3} className={modalFieldInputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </ModalField>
      </ModalFieldGrid>

      <ModalSectionLabel>Evidence</ModalSectionLabel>
      <div className="px-6 grid grid-cols-2 gap-3 pb-4">
        <ModalEvidenceCard
          label="Work Order / Invoice Document"
          attached={evidenceIds.length > 0}
          attachedNote={evidenceIds.length ? `${evidenceIds.length} attached` : undefined}
          onAttach={onStartOCR}
        />
      </div>
    </ModalShell>
  )
}

const PERMIT_PROGRAM_ROWS: { key: keyof VehicleSettings; label: string; desc: string }[] = [
  { key: "travelsNY", label: "Does this unit cross into New York?", desc: "Required for NY Highway Use Tax (HUT)" },
  { key: "travelsNM", label: "Does this unit cross into New Mexico?", desc: "Required for NM Weight Distance Tax (WDT)" },
  { key: "travelsKY", label: "Does this unit cross into Kentucky?", desc: "Required for KY Weight Distance Tax (KYU)" },
  { key: "travelsOR", label: "Does this unit cross into Oregon?", desc: "Required for OR Weight-Mile Tax" },
  { key: "travelsCT", label: "Does this unit cross into Connecticut?", desc: "Required for CT Highway Use Tax" },
  { key: "travelsCA", label: "Does this unit cross into California?", desc: "Required for CA DMV operating authority" },
  { key: "carriesOSOW", label: "Does this unit haul oversize or overweight loads?", desc: "Triggers OSOW permit requirements per jurisdiction" },
  { key: "carriesAlcohol", label: "Does this unit transport beverage alcohol?", desc: "Required for liquor transport endorsement and compliance" },
  { key: "carriesTobacco", label: "Does this unit transport tobacco products?", desc: "Required for tobacco excise tax and transport compliance" },
  { key: "carriesHazmat", label: "Does this unit transport dangerous goods?", desc: "Required for TDG/HMR compliance, placarding, and routing" },
  { key: "operatesLCV", label: "Does this unit operate as a Long Combination Vehicle?", desc: "Required for LCV permits in AB, SK, and MB" },
  { key: "operatesAxleLift", label: "Does this unit operate with an axle lift?", desc: "Affects axle weight compliance and permit calculations" },
]

const CANADA_ONLY_DISABLED_KEYS: (keyof VehicleSettings)[] = [
  "travelsNY", "travelsNM", "travelsKY", "travelsOR", "travelsCT", "travelsCA", "carriesAlcohol", "carriesTobacco",
]

function readCompanyLoadTypes(companyId: string): string[] {
  try {
    const raw = localStorage.getItem(`tes_company_compliance_settings_${companyId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { rules?: Record<string, string> }
    const rules = parsed.rules || {}
    const types: string[] = []
    if (rules.dg_us === "applies" || rules.dg_canada === "applies") types.push("hazmat")
    return types
  } catch {
    return []
  }
}

function SettingsToggleRow({ label, description, checked, onCheckedChange, disabled = false, title }: { label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border">
      <div className="pr-4">
        <p className="text-sm font-medium text-foreground">
          {label}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        title={title}
        onClick={() => onCheckedChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer
          rounded-full border-2 border-transparent transition-colors
          focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-primary focus-visible:ring-offset-2
          ${checked ? "bg-primary" : "bg-input"}
          ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      >
        <span className={`pointer-events-none inline-block size-4
          rounded-full bg-background shadow-lg ring-0 transition-transform
          ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </div>
  )
}

function SettingsTab({ companyId, vehicle, onSaved }: { companyId: string; vehicle: VehicleRecord; onSaved?: () => void }) {
  const [saved, setSaved] = useState<VehicleSettings>(() => loadVehicleSettings(companyId, vehicle.id))
  const [draft, setDraft] = useState<VehicleSettings>(saved)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    const loaded = loadVehicleSettings(companyId, vehicle.id)
    setSaved(loaded)
    setDraft(loaded)
    setSavedAt(null)
  }, [companyId, vehicle.id])

  const set = <K extends keyof VehicleSettings>(key: K, value: VehicleSettings[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const isDirty = JSON.stringify(saved) !== JSON.stringify(draft)

  const isCanadaOnly = vehicle.operatingRegion === "Canada Only"

  const companyLoadTypes = useMemo(() => readCompanyLoadTypes(companyId), [companyId])
  const hasHazmatLoadType = companyLoadTypes.includes("hazmat")
  const showHazmat = hasHazmatLoadType && (vehicle.operatingRegion === "US Only" || vehicle.operatingRegion === "Cross-Border")

  const visibleRows = PERMIT_PROGRAM_ROWS.filter((row) => row.key !== "carriesHazmat" || showHazmat)

  const handleSave = () => {
    saveVehicleSettings(companyId, vehicle.id, draft)
    setSaved(draft)
    addVehicleActivity(companyId, vehicle.id, {
      event: "SETTINGS_UPDATED",
      detail: "Vehicle compliance settings updated.",
      section: "settings",
    })
    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))
    onSaved?.()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permit Programs</CardTitle>
          <CardDescription>Mark which jurisdictions and cargo programs apply to this specific unit.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {isCanadaOnly ? (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Some permit programs are disabled because this unit's Operating Region is set to Canada Only.
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            {visibleRows.map((row) => {
              const disabled = isCanadaOnly && CANADA_ONLY_DISABLED_KEYS.includes(row.key)
              return (
                <SettingsToggleRow
                  key={row.key}
                  label={row.label}
                  description={row.desc}
                  checked={draft[row.key] as boolean}
                  onCheckedChange={(value) => set(row.key, value as VehicleSettings[typeof row.key])}
                  disabled={disabled}
                  title={disabled ? "Not applicable — Operating Region is Canada Only" : undefined}
                />
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Telematics & Tracking</CardTitle>
          <CardDescription>Device identifiers linked to this unit.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 pt-0 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="eldDeviceId">ELD Device ID</Label>
            <Input id="eldDeviceId" value={draft.eldDeviceId} onChange={(e) => set("eldDeviceId", e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Device serial number linked to this vehicle</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="settingsGpsProvider">GPS / Telematics Provider</Label>
            <Input id="settingsGpsProvider" value={draft.gpsProvider} onChange={(e) => set("gpsProvider", e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Fleet tracking provider for this unit</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compliance Notes</CardTitle>
          <CardDescription>Internal-only observations for this vehicle.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Label htmlFor="complianceNotes">Internal Notes</Label>
          <Textarea id="complianceNotes" rows={4} value={draft.complianceNotes} onChange={(e) => set("complianceNotes", e.target.value)} />
          <p className="text-[11px] text-muted-foreground">Compliance program exceptions or special handling for this vehicle</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          {isDirty ? (
            <>
              <div className="text-sm font-medium">Unsaved changes</div>
              <p className="text-xs text-muted-foreground">Your changes are not active until you save these settings.</p>
            </>
          ) : savedAt ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" />Saved {savedAt}</span>
          ) : (
            <p className="text-xs text-muted-foreground">No changes yet.</p>
          )}
        </div>
        <Button type="button" onClick={handleSave} disabled={!isDirty}>
          <Check className="mr-2 size-4" />
          Save Settings
        </Button>
      </div>
    </div>
  )
}
