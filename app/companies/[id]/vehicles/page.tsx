"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import {
  ChevronRight,
  Filter,
  Plus,
  Search,
  Truck,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { DataTableShell } from "@/components/data-table-shell"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PermitTab } from "@/src/components/vehicles/permits/PermitTab"
import {
  createId,
  isoNow,
  loadVehicleStore,
  saveVehicleStore,
  validateVehicleUniqueness,
  type VehicleStore,
} from "@/lib/vehicle-data"
import { is17CharVIN } from "@/lib/identifier-normalization"
import { recordAuditEvent } from "@/lib/audit-logger"
import { logAuditEvent } from "@/lib/audit-log"
import type { Company, EquipmentType, VehicleRecord, VehicleStatus } from "@/src/types"
import type { EvidenceRecord } from "@/types/evidence"
import type { OCRDocumentResult } from "@/types/ocr"
import { DocumentSourcePicker } from "@/src/components/shared/DocumentSourcePicker"
import { OCRReview } from "@/src/components/shared/OCRReview"
import { UnsavedChangesPrompt } from "@/src/components/shared/UnsavedChangesPrompt"
import { SecureDocumentViewer } from "@/src/components/shared/SecureDocumentViewer"
import { CameraCapture } from "@/src/components/CameraCapture"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { ProfileTab, VehicleProfileForm, buildVehicle } from "@/src/components/vehicles/profile/VehicleProfileTab"
import type { ProfileForm } from "@/src/components/vehicles/profile/VehicleProfileTab"
import { OwnershipTab } from "@/src/components/vehicles/ownership/OwnershipTab"
import { RegistrationTab } from "@/src/components/vehicles/registration/RegistrationTab"
import { SettingsTab } from "@/src/components/vehicles/settings/SettingsTab"
import { VehicleActivitySection, type VehicleActivityEntry } from "@/src/components/vehicles/activity/VehicleActivitySection"
import { MaintenanceTab } from "@/src/components/vehicles/maintenance/MaintenanceTab"
import {
  AlertBanner,
  Divider,
  EmptyState,
  Field,
  ModalEvidenceCard,
  ModalField,
  ModalFieldGrid,
  ModalFooter,
  ModalOCRStrip,
  ModalSectionLabel,
  ModalShell,
  NoticeBanner,
  SectionTitle,
  StatusPill,
  VehicleComplianceStrip,
  VehicleEvidencePanel,
  VehicleWorkspaceHero,
  inputClass,
  modalFieldInputClass,
  selectClass,
  type VehicleSummaryItem,
} from "@/src/components/vehicles/VehicleWorkspaceShell"
import { getQueryParam, pushHistoryQueryParams } from "@/lib/deep-linking"
import {
  migrateInlineEvidenceFiles,
  resolveEvidenceFile,
  saveEvidenceFile,
} from "@/lib/evidence-file-store"

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

// INSPECTION_TYPES is imported from @/src/types — the single authoritative
// controlled vocabulary — rather than duplicated here.

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

type EvidenceAttachmentReview = {
  context: OCRContext
  file: File
  previewUrl: string
}

export default function VehiclesPage() {
  const params = useParams()
  const searchParams = useSearchParams()
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

  // Next.js client navigation (sidebar, breadcrumb, Link) does not fire
  // popstate. Keep the selected workspace synchronized with the URL so a
  // navigation to the Vehicles route always returns to the vehicle list.
  const vehicleQueryParam = searchParams.get("vehicle")
  useEffect(() => {
    setSelectedVehicleId(vehicleQueryParam)
  }, [vehicleQueryParam])

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
    <div className="mx-auto w-full max-w-[1680px] space-y-5 text-foreground">
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
        <DataTableShell
          title="Vehicle records"
          description="Active equipment and its current operating identity. Historical records remain retained after archive."
          footer={<p className="text-xs text-muted-foreground">Showing {filteredVehicles.length} of {vehicles.filter((vehicle) => vehicle.status !== "Archived").length} active vehicle records</p>}
        >
          <Table>
              <TableHeader>
                <TableRow><TableHead>Equipment</TableHead><TableHead>VIN</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Operating Region</TableHead><TableHead className="text-right">Open</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {filteredVehicles.map((vehicle) => (
                  <TableRow key={vehicle.id} className="cursor-pointer" tabIndex={0} onClick={() => { setSelectedVehicleId(vehicle.id); pushHistoryQueryParams({ vehicle: vehicle.id, vehicleTab: null }) }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedVehicleId(vehicle.id); pushHistoryQueryParams({ vehicle: vehicle.id, vehicleTab: null }) } }}>
                    <TableCell><div className="font-semibold">{vehicle.unitNumber || "—"}</div><div className="font-mono text-[10px] text-muted-foreground">{vehicle.id}</div></TableCell>
                    <TableCell className="font-mono text-[11px]">{vehicle.vin || "—"}</TableCell>
                    <TableCell>{vehicle.equipmentType}</TableCell>
                    <TableCell><StatusPill value={vehicle.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{vehicle.operatingRegion}</TableCell>
                    <TableCell className="text-right"><ChevronRight className="ml-auto size-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
          </Table>
        </DataTableShell>
      )}

      {showCreate ? <VehicleCreateDialog companyId={companyId} onClose={() => setShowCreate(false)} onSave={createVehicle} setError={setError} /> : null}
    </div>
  )
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

  const confirmOCR = async (values: Record<string, unknown>, attachment: { fileRef: string; fileName: string; ocrConfidence: number }) => {
    setForm((current) => ({ ...current, ...Object.fromEntries(Object.entries(values).filter(([key]) => key in current)) as Partial<ProfileForm> }))
    if (ocrFile) {
      try {
      const evidenceId = attachment.fileRef || createId("DOC")
      const fileReference = await saveEvidenceFile(evidenceId, ocrFile, attachment.fileName, ocrFile.type)
      setPendingEvidence({
        id: evidenceId,
        companyId,
        entityType: "Vehicle",
        entityId: "",
        documentType: "Vehicle Profile Document",
        fileName: attachment.fileName,
        mimeType: ocrFile.type || "application/octet-stream",
        fileReference,
        fileSize: ocrFile.size,
        documentDate: todayISO(),
        uploadedAt: isoNow(),
        uploadedBy: "",
        source: "upload",
        verificationState: "verified",
        ocrMetadata: { overallConfidence: attachment.ocrConfidence, extractedFieldKeys: Object.keys(values), processedAt: isoNow() },
      })
      } catch (err) {
        setError(err instanceof Error ? err.message : "Vehicle evidence could not be saved.")
        return
      }
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
  const [showAttachmentCamera, setShowAttachmentCamera] = useState(false)
  const [ocrContext, setOCRContext] = useState<OCRContext | null>(null)
  const [ocrFile, setOCRFile] = useState<File | null>(null)
  const [ocrDataUrl, setOCRDataUrl] = useState("")
  const [ocrResult, setOCRResult] = useState<OCRDocumentResult | null>(null)
  const [previewEvidence, setPreviewEvidence] = useState<EvidenceRecord | null>(null)
  const [previewEvidenceObjectUrl, setPreviewEvidenceObjectUrl] = useState<string | null>(null)
  const [attachmentSourceContext, setAttachmentSourceContext] = useState<OCRContext | null>(null)
  const [attachmentReview, setAttachmentReview] = useState<EvidenceAttachmentReview | null>(null)
  const [selectedRecordEvidence, setSelectedRecordEvidence] = useState<{
    recordLabel: string
    evidenceIds: string[]
    kind?: "inspection" | "maintenance" | "permit"
    recordId?: string
    details?: Array<{ label: string; value: string }>
    activity?: Array<{ title: string; description: string; date: string }>
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

  useEffect(() => {
    let cancelled = false
    void migrateInlineEvidenceFiles(store).then(({ store: migratedStore, migrated }) => {
      if (cancelled || migrated === 0) return
      saveVehicleStore(companyId, migratedStore)
      onStoreChange(migratedStore)
    }).catch((migrationError) => {
      if (!cancelled) setError(migrationError instanceof Error ? migrationError.message : "Existing evidence files could not be migrated.")
    })
    return () => { cancelled = true }
    // Run once when this vehicle workspace opens. Subsequent files are written
    // directly to IndexedDB and never enter the localStorage record payload.
  }, [companyId, vehicle.id])

  const activeRegistration = useMemo(() => {
    const active = registrationRecords
      .filter((r) => !r.archived && r.plate)
      .sort((a, b) => (b.registrationDate ?? "").localeCompare(a.registrationDate ?? ""))[0]
    return active || null
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

  const openAttachmentPicker = (context: OCRContext) => {
    setAttachmentSourceContext(context)
  }

  const beginAttachmentReview = (context: OCRContext, file: File) => {
    setAttachmentReview({ context, file, previewUrl: URL.createObjectURL(file) })
  }

  const closeAttachmentReview = () => {
    if (attachmentReview?.previewUrl) URL.revokeObjectURL(attachmentReview.previewUrl)
    setAttachmentReview(null)
  }

  const confirmEvidenceAttachment = async () => {
    if (!attachmentReview) return
    const { context, file } = attachmentReview
    try {
      const now = isoNow()
      const evidenceId = createId("DOC")
      const fileReference = await saveEvidenceFile(evidenceId, file, file.name, file.type)
      const documentType = "documentType" in context ? context.documentType : "Vehicle Profile Document"
      const evidenceRecord: EvidenceRecord = {
        id: evidenceId,
        companyId,
        entityType: "Vehicle",
        entityId: vehicle.id,
        documentType,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileReference,
        fileSize: file.size,
        documentDate: todayISO(),
        uploadedAt: now,
        uploadedBy: "",
        source: "upload",
        verificationState: "verified",
      }
      let next: VehicleStore = { ...store, evidence: [evidenceRecord, ...store.evidence] }

      if (context.kind === "ownership") {
        setPendingOwnershipEvidenceId(evidenceRecord.id)
      } else if (context.kind === "registration") {
        setPendingRegistrationEvidence({ id: evidenceRecord.id, documentType, values: {} })
      } else if (context.kind === "permit") {
        if (context.recordId) {
          next = { ...next, permitRecords: next.permitRecords.map((record) => record.id === context.recordId ? { ...record, evidenceIds: Array.from(new Set([...record.evidenceIds, evidenceRecord.id])), updatedAt: now } : record) }
          setSelectedRecordEvidence((current) => current?.recordId === context.recordId ? { ...current, evidenceIds: Array.from(new Set([...current.evidenceIds, evidenceRecord.id])) } : current)
        } else setPendingPermitEvidenceId(evidenceRecord.id)
      } else if (context.kind === "inspection") {
        if (context.recordId) {
          next = { ...next, inspectionRecords: next.inspectionRecords.map((record) => record.id === context.recordId ? { ...record, evidenceIds: Array.from(new Set([...record.evidenceIds, evidenceRecord.id])), updatedAt: now } : record) }
          setSelectedRecordEvidence((current) => current?.recordId === context.recordId ? { ...current, evidenceIds: Array.from(new Set([...current.evidenceIds, evidenceRecord.id])) } : current)
        } else setPendingInspectionEvidenceId(evidenceRecord.id)
      } else if (context.kind === "maintenance") {
        if (context.recordId) {
          next = { ...next, maintenanceRecords: next.maintenanceRecords.map((record) => record.id === context.recordId ? { ...record, evidenceIds: Array.from(new Set([...record.evidenceIds, evidenceRecord.id])), updatedAt: now } : record) }
          setSelectedRecordEvidence((current) => current?.recordId === context.recordId ? { ...current, evidenceIds: Array.from(new Set([...current.evidenceIds, evidenceRecord.id])) } : current)
        } else setPendingMaintenanceEvidenceId(evidenceRecord.id)
      }

      saveVehicleStore(companyId, next)
      onStoreChange(next)
      closeAttachmentReview()
      setNotice(context.recordId ? "Evidence attached to the selected record." : "Evidence attached. Review the information already entered, then save the record.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evidence could not be attached.")
    }
  }

  const confirmOCR = async (values: Record<string, unknown>, attachment: { fileRef: string; fileName: string; ocrConfidence: number }) => {
    if (!ocrContext || !ocrFile) return
    try {
      const now = isoNow()
      const evidenceId = attachment.fileRef || createId("DOC")
      const fileReference = await saveEvidenceFile(evidenceId, ocrFile, attachment.fileName, ocrFile.type)
      const evidenceRecord: EvidenceRecord = {
      id: evidenceId,
      companyId,
      entityType: "Vehicle",
      entityId: vehicle.id,
      documentType: ocrContext.kind === "ownership" ? ocrContext.documentType : ocrContext.kind === "registration" ? ocrContext.documentType : ocrContext.kind === "permit" ? ocrContext.documentType : ocrContext.kind === "inspection" ? ocrContext.documentType : ocrContext.kind === "maintenance" ? ocrContext.documentType : "Vehicle Profile Document",
      fileName: attachment.fileName,
      mimeType: ocrFile.type || "application/octet-stream",
      fileReference,
      fileSize: ocrFile.size,
      documentDate: todayISO(),
      uploadedAt: now,
      uploadedBy: "",
      source: "upload",
      verificationState: "verified",
      ocrMetadata: { overallConfidence: attachment.ocrConfidence, extractedFieldKeys: Object.keys(values), processedAt: now },
      }
      let next: VehicleStore = { ...store, evidence: [evidenceRecord, ...store.evidence] }
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
      if (ocrContext.recordId) {
        next = {
          ...next,
          inspectionRecords: next.inspectionRecords.map((record) => record.id === ocrContext.recordId ? { ...record, evidenceIds: Array.from(new Set([...record.evidenceIds, evidenceRecord.id])), updatedAt: now } : record),
        }
        setSelectedRecordEvidence((current) => current?.recordId === ocrContext.recordId ? { ...current, evidenceIds: Array.from(new Set([...current.evidenceIds, evidenceRecord.id])) } : current)
      } else {
        setPendingInspectionEvidenceId(evidenceRecord.id)
      }
      nextTab = "maintenance"
    } else if (ocrContext.kind === "maintenance") {
      if (ocrContext.recordId) {
        next = {
          ...next,
          maintenanceRecords: next.maintenanceRecords.map((record) => record.id === ocrContext.recordId ? { ...record, evidenceIds: Array.from(new Set([...record.evidenceIds, evidenceRecord.id])), updatedAt: now } : record),
        }
        setSelectedRecordEvidence((current) => current?.recordId === ocrContext.recordId ? { ...current, evidenceIds: Array.from(new Set([...current.evidenceIds, evidenceRecord.id])) } : current)
      } else {
        setPendingMaintenanceEvidenceId(evidenceRecord.id)
      }
      nextTab = "maintenance"
    }
      saveVehicleStore(companyId, next)
      onStoreChange(next)
      setTab(nextTab)
      setShowOCR(false)
      setOCRContext(null)
      setOCRFile(null)
      setOCRResult(null)
      setNotice(ocrContext.recordId ? "Document verified and attached to the selected record." : "Document verified and attached to the Vehicle evidence record. Review the structured record before saving it.")
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

  const openEvidence = async (item: EvidenceRecord) => {
    try {
      const resolved = await resolveEvidenceFile(item.fileReference || "")
      if (previewEvidenceObjectUrl) URL.revokeObjectURL(previewEvidenceObjectUrl)
      setPreviewEvidenceObjectUrl(resolved.revoke ? resolved.url : null)
      setPreviewEvidence({ ...item, fileReference: resolved.url })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evidence could not be opened.")
    }
  }

  const closeEvidence = () => {
    if (previewEvidenceObjectUrl) URL.revokeObjectURL(previewEvidenceObjectUrl)
    setPreviewEvidenceObjectUrl(null)
    setPreviewEvidence(null)
  }

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

  const summaryItems: VehicleSummaryItem[] = (() => {
    const today = todayISO()
    const soon = new Date()
    soon.setDate(soon.getDate() + 60)
    const soonISO = soon.toISOString().slice(0, 10)

    const registration = registrationRecords
      .filter((record) => !record.archived)
      .sort((a, b) => (b.registrationDate || "").localeCompare(a.registrationDate || ""))[0]
    const registrationExpired = Boolean(registration?.expiryDate && registration.expiryDate < today) || registration?.status === "Expired"
    const registrationSoon = Boolean(registration?.expiryDate && registration.expiryDate >= today && registration.expiryDate <= soonISO)

    const livePermits = permitRecords.filter((record) => !record.archived && record.status === "Active")
    const expiredPermits = livePermits.filter((record) => record.expiryDate && record.expiryDate < today)
    const expiringPermits = livePermits.filter((record) => record.expiryDate && record.expiryDate >= today && record.expiryDate <= soonISO)

    const latestInspection = inspectionRecords
      .filter((record) => !record.archived)
      .sort((a, b) => (b.inspectionDate || "").localeCompare(a.inspectionDate || ""))[0]

    const activeMaintenance = maintenanceRecords.filter((record) => !record.archived && !["Completed", "Cancelled"].includes(record.maintenanceStatus))
    const latestMaintenance = maintenanceRecords
      .filter((record) => !record.archived)
      .sort((a, b) => (b.serviceDate || "").localeCompare(a.serviceDate || ""))[0]
    const nextMaintenanceDue = latestMaintenance?.nextServiceDueDate || ""
    const maintenanceOverdue = Boolean(nextMaintenanceDue && nextMaintenanceDue < today)
    const maintenanceDueSoon = Boolean(nextMaintenanceDue && nextMaintenanceDue >= today && nextMaintenanceDue <= soonISO)

    const items: VehicleSummaryItem[] = [
      {
        label: "Registration",
        value: !registration ? "No record" : registrationExpired ? "Expired" : registrationSoon ? "Expiring Soon" : "Current",
        detail: registration?.expiryDate ? `Expires ${registration.expiryDate}` : "No expiry date recorded",
        tone: !registration ? "neutral" : registrationExpired ? "critical" : registrationSoon ? "attention" : "current",
      },
      {
        label: "Permits",
        value: livePermits.length ? `${livePermits.length} Active` : "No active permits",
        detail: expiredPermits.length ? `${expiredPermits.length} expired` : expiringPermits.length ? `${expiringPermits.length} expiring soon` : "No immediate expiry",
        tone: expiredPermits.length ? "critical" : expiringPermits.length ? "attention" : livePermits.length ? "current" : "neutral",
      },
      {
        label: "Latest Inspection",
        value: latestInspection?.inspectionStatus || "No record",
        detail: latestInspection?.inspectionDate ? `Inspected ${latestInspection.inspectionDate}` : "No inspection recorded",
        tone: !latestInspection ? "neutral" : ["Fail", "Out of Service"].includes(latestInspection.inspectionStatus) ? "critical" : latestInspection.inspectionStatus === "Pass with Defects" ? "attention" : "current",
      },
      {
        label: "Maintenance",
        value: maintenanceOverdue ? "Overdue" : maintenanceDueSoon ? "Due Soon" : activeMaintenance.length ? `${activeMaintenance.length} Open` : "Current",
        detail: nextMaintenanceDue ? `Next due ${nextMaintenanceDue}` : "No upcoming service date",
        tone: maintenanceOverdue ? "critical" : maintenanceDueSoon || activeMaintenance.length ? "attention" : "current",
      },
    ]
    return items
  })()

  const displayedEvidence = selectedRecordEvidence
    ? getEvidenceForIds(selectedRecordEvidence.evidenceIds)
    : []

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5">
      <VehicleWorkspaceHero
        vehicle={vehicle}
        companyName={companyName}
        activePlate={activeRegistration?.plate || null}
        activeJurisdiction={activeRegistration?.stateProvince || null}
        onBack={onBack}
        onArchive={onArchive}
        onRestore={onRestore}
        onUpload={() => openSourcePicker({ kind: "profile" })}
      />

      {error ? <AlertBanner message={error} onClose={() => setError(null)} /> : null}
      {notice ? <NoticeBanner message={notice} onClose={() => setNotice(null)} /> : null}

      <VehicleComplianceStrip items={summaryItems} />

      <Tabs value={tab} onValueChange={(value) => { const nextTab = value as typeof tab; setTab(nextTab); setSelectedRecordEvidence(null); pushHistoryQueryParams({ vehicleTab: nextTab }) }}>
        <TabsList variant="line" className="overflow-x-auto">
          {(["profile", "ownership", "registrations", "permits", "maintenance", "activity", "settings"] as const).map((item) => <TabsTrigger key={item} value={item}>{item === "registrations" ? "Registration" : item.charAt(0).toUpperCase() + item.slice(1)}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <div className="grid items-start gap-4 min-[1500px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {tab === "profile" ? <ProfileTab companyId={companyId} vehicle={vehicle} FieldComponent={Field} SectionTitleComponent={SectionTitle} onSave={onSaveVehicle} onStartOCR={() => openSourcePicker({ kind: "profile" })} ocrValues={profileOCRValues} /> : null}
          {tab === "ownership" ? <OwnershipTab companyId={companyId} store={store} vehicle={vehicle} records={ownershipRecords} evidence={evidence} FieldComponent={Field} DividerComponent={Divider} SectionTitleComponent={SectionTitle} EmptyStateComponent={EmptyState} StatusPillComponent={StatusPill} readCompanies={readCompanies} money={money} addMonthsISO={addMonthsISO} onStoreChange={onStoreChange} onStartOCR={(documentType) => openSourcePicker({ kind: "ownership", documentType })} onAttachEvidence={(documentType) => openAttachmentPicker({ kind: "ownership", documentType })} pendingEvidenceId={pendingOwnershipEvidenceId} clearPendingEvidence={() => setPendingOwnershipEvidenceId(null)} setError={setError} setNotice={setNotice} /> : null}
          {tab === "registrations" ? <RegistrationTab companyId={companyId} store={store} vehicle={vehicle} records={registrationRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(documentType) => openSourcePicker({ kind: "registration", documentType })} onAttachEvidence={(documentType) => openAttachmentPicker({ kind: "registration", documentType })} pendingEvidence={pendingRegistrationEvidence} clearPendingEvidence={() => setPendingRegistrationEvidence(null)} setError={setError} setNotice={setNotice} onOpenEvidence={openEvidence} FieldComponent={Field} StatusPillComponent={StatusPill} SectionTitleComponent={SectionTitle} EmptyStateComponent={EmptyState} ModalShellComponent={ModalShell} ModalOCRStripComponent={ModalOCRStrip} ModalSectionLabelComponent={ModalSectionLabel} ModalFieldGridComponent={ModalFieldGrid} ModalFieldComponent={ModalField} ModalEvidenceCardComponent={ModalEvidenceCard} ModalFooterComponent={ModalFooter} modalFieldInputClass={modalFieldInputClass} selectClass={selectClass} money={money} todayISO={todayISO} addVehicleActivity={addVehicleActivity} /> : null}
          {tab === "permits" ? <PermitTab companyId={companyId} store={store} vehicle={vehicle} records={permitRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(documentType) => openSourcePicker({ kind: "permit", documentType })} onAttachEvidence={(documentType) => openAttachmentPicker({ kind: "permit", documentType })} pendingEvidenceId={pendingPermitEvidenceId} clearPendingEvidence={() => setPendingPermitEvidenceId(null)} setError={setError} setNotice={setNotice} onRecordClick={(record) => setSelectedRecordEvidence({ recordLabel: `${record.permitType === "Other" ? record.customPermitType : record.permitType} · ${record.jurisdiction ?? ""}`, evidenceIds: record.evidenceIds ?? [] })} StatusPillComponent={StatusPill} SectionTitleComponent={SectionTitle} EmptyStateComponent={EmptyState} ModalShellComponent={ModalShell} ModalOCRStripComponent={ModalOCRStrip} ModalSectionLabelComponent={ModalSectionLabel} ModalFieldGridComponent={ModalFieldGrid} ModalFieldComponent={ModalField} ModalEvidenceCardComponent={ModalEvidenceCard} ModalFooterComponent={ModalFooter} modalFieldInputClass={modalFieldInputClass} /> : null}
          {tab === "maintenance" ? <MaintenanceTab companyId={companyId} store={store} vehicle={vehicle} inspections={inspectionRecords} maintenance={maintenanceRecords} evidence={evidence} onStoreChange={onStoreChange} onStartOCR={(kind, documentType) => openSourcePicker({ kind, documentType })} onAttachEvidence={(kind, documentType) => openAttachmentPicker({ kind, documentType })} pendingInspectionEvidenceId={pendingInspectionEvidenceId} pendingMaintenanceEvidenceId={pendingMaintenanceEvidenceId} clearInspectionEvidence={() => setPendingInspectionEvidenceId(null)} clearMaintenanceEvidence={() => setPendingMaintenanceEvidenceId(null)} setError={setError} setNotice={setNotice} onRecordClick={(record) => setSelectedRecordEvidence({ recordLabel: "inspectionType" in record ? record.inspectionType : record.maintenanceType, evidenceIds: record.evidenceIds ?? [], kind: "inspectionType" in record ? "inspection" : "maintenance", recordId: record.id, details: "inspectionType" in record ? [{ label: "Inspection date", value: record.inspectionDate }, { label: "Expiry date", value: record.expiryDate }, { label: "Status", value: record.inspectionStatus }, { label: "Inspector / shop", value: record.inspectorShopName }, { label: "Service facility", value: record.serviceFacility }, { label: "Odometer", value: record.odometer }] : [{ label: "Service date", value: record.serviceDate }, { label: "Status", value: record.maintenanceStatus }, { label: "Vendor", value: record.vendor }, { label: "Work order / invoice", value: record.workOrderInvoiceNumber }, { label: "Total cost", value: money(record.totalCost) }], activity: [{ title: "Record created", description: "This record was added to the vehicle workspace.", date: record.createdAt?.split("T")[0] || "Date unavailable" }, { title: "Last updated", description: "Most recent saved change to this record.", date: record.updatedAt?.split("T")[0] || "Date unavailable" }] })} readCompanies={readCompanies} todayISO={todayISO} money={money} inputClass={inputClass} selectClass={selectClass} SectionTitleComponent={SectionTitle} EmptyStateComponent={EmptyState} StatusPillComponent={StatusPill} FieldComponent={Field} DividerComponent={Divider} ModalShellComponent={ModalShell} ModalOCRStripComponent={ModalOCRStrip} ModalSectionLabelComponent={ModalSectionLabel} ModalFieldGridComponent={ModalFieldGrid} ModalFieldComponent={ModalField} ModalEvidenceCardComponent={ModalEvidenceCard} ModalFooterComponent={ModalFooter} modalFieldInputClass={modalFieldInputClass} /> : null}
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
                loadVehicleActivity={loadVehicleActivity}
              />
            </div>
          ) : null}

          {tab === "settings" ? (
            <SettingsTab companyId={companyId} vehicle={vehicle} addVehicleActivity={addVehicleActivity} onSaved={() => setActivityRefreshKey((k) => k + 1)} />
          ) : null}
        </div>

        <VehicleEvidencePanel
          title={selectedRecordEvidence?.recordLabel}
          items={displayedEvidence}
          totalCount={evidence.length}
          selectionRequired={!selectedRecordEvidence}
          onOpen={openEvidence}
          onUpload={() => selectedRecordEvidence?.kind && selectedRecordEvidence.recordId
            ? openAttachmentPicker({ kind: selectedRecordEvidence.kind, recordId: selectedRecordEvidence.recordId, documentType: selectedRecordEvidence.kind === "inspection" ? "Inspection Document" : "Maintenance Work Order / Invoice" })
            : undefined}
          onClearSelection={selectedRecordEvidence ? () => setSelectedRecordEvidence(null) : undefined}
          details={selectedRecordEvidence?.details}
          activity={selectedRecordEvidence?.activity}
        />
      </div>

      <UnsavedChangesPrompt hasChanges={false} onSave={() => undefined} onDiscard={() => undefined} />

      {sourceContext ? <div className="fixed inset-0 z-[200]"><DocumentSourcePicker isOpen onClose={() => setSourceContext(null)} onSelectCamera={() => { setSourceContext(sourceContext); setShowCamera(true) }} onSelectFile={(file) => { const context = sourceContext; setSourceContext(null); void beginOCR(context, file) }} title="Vehicle Document — OCR First" subtitle="Capture or upload the source document before entering structured vehicle data." /></div> : null}
      {showCamera ? <div className="fixed inset-0 z-[200]"><CameraCapture onClose={() => setShowCamera(false)} onCapture={(file) => { setShowCamera(false); if (ocrContext || sourceContext) void beginOCR((ocrContext || sourceContext)!, file) }} /></div> : null}
      {attachmentSourceContext ? <div className="fixed inset-0 z-[210]"><DocumentSourcePicker isOpen onClose={() => setAttachmentSourceContext(null)} onSelectCamera={() => setShowAttachmentCamera(true)} onSelectFile={(file) => { const context = attachmentSourceContext; setAttachmentSourceContext(null); beginAttachmentReview(context, file) }} title="Attach Evidence — No OCR" subtitle="The entered record stays unchanged. Select a file, preview it, then attach it to this draft." /></div> : null}
      {showAttachmentCamera && attachmentSourceContext ? <div className="fixed inset-0 z-[220]"><CameraCapture onClose={() => setShowAttachmentCamera(false)} onCapture={(file) => { const context = attachmentSourceContext; setShowAttachmentCamera(false); setAttachmentSourceContext(null); beginAttachmentReview(context, file) }} /></div> : null}
      {attachmentReview ? <div className="fixed inset-0 z-[220] bg-black/45" role="dialog" aria-modal="true" aria-label="Review evidence attachment">
        <aside className="ml-auto flex h-full w-full max-w-xl flex-col border-l bg-background shadow-2xl">
          <div className="flex items-start justify-between border-b px-5 py-4">
            <div><h2 className="text-sm font-bold">Review Evidence</h2><p className="mt-1 text-[11px] text-muted-foreground">No fields will be extracted or replaced. Your manual entry remains exactly as entered.</p></div>
            <button type="button" onClick={closeAttachmentReview} className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label="Close evidence review"><X className="size-4" /></button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <div className="rounded-xl border bg-muted/15 p-3"><p className="text-xs font-bold">{attachmentReview.file.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{attachmentReview.file.type || "Unknown file type"} · {(attachmentReview.file.size / 1024).toFixed(1)} KB</p></div>
            {attachmentReview.file.type.startsWith("image/") ? <img src={attachmentReview.previewUrl} alt="Evidence preview" className="max-h-[62vh] w-full rounded-xl border object-contain" /> : attachmentReview.file.type === "application/pdf" ? <iframe src={attachmentReview.previewUrl} title="Evidence preview" className="h-[62vh] w-full rounded-xl border" /> : <div className="flex min-h-52 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">Preview is unavailable for this file type. Verify the filename above.</div>}
          </div>
          <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-5 py-4"><p className="text-[11px] text-muted-foreground">After attaching, return to the form and save the record once.</p><div className="flex gap-2"><Button variant="outline" onClick={closeAttachmentReview}>Cancel</Button><Button onClick={() => void confirmEvidenceAttachment()}>Attach Evidence</Button></div></div>
        </aside>
      </div> : null}
      {showOCR && ocrResult && ocrDataUrl ? <VehicleOCRReview result={ocrResult} dataUrl={ocrDataUrl} context={ocrContext} onCancel={() => { setShowOCR(false); setOCRContext(null) }} onConfirm={confirmOCR} /> : null}
      {previewEvidence ? <div className="fixed inset-0 z-[180] bg-background"><SecureDocumentViewer fileName={previewEvidence.fileName} mimeType={previewEvidence.mimeType} dataUrl={previewEvidence.fileReference} documentTitle={`Vehicle Evidence — ${previewEvidence.documentType}`} documentDate={previewEvidence.documentDate} companyId={companyId} onClose={closeEvidence} /></div> : null}
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
    if (context?.kind === "inspection") return [
      { key: "inspectionType", label: "Inspection Type", required: true },
      { key: "inspectionSource", label: "Inspection Source" },
      { key: "inspectionStatus", label: "Inspection Status", required: true },
      { key: "inspectionDate", label: "Inspection Date", type: "date" as const, required: true },
      { key: "expiryDate", label: "Expiry Date", type: "date" as const },
      { key: "nextDueDate", label: "Next Due Date", type: "date" as const },
      { key: "inspectorShopName", label: "Inspector / Shop" },
      { key: "serviceFacility", label: "Service Facility" },
      { key: "odometer", label: "Odometer" },
      { key: "engineHours", label: "Engine Hours" },
      { key: "defectsFound", label: "Defects Found" },
      { key: "notes", label: "Notes" },
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
