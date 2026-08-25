"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useParams, useRouter } from "next/navigation"
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  Eye,
  FileText,
  HardHat,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Truck,
  Upload,
  UserRound,
  X,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

/* =========================================================
   TYPES
========================================================= */

type ExpiryRules = {
  healthyMinDays: number
  watchMinDays: number
  urgentMinDays: number
  criticalMinDays: number
  criticalMaxDays: number
}

type SystemSettings = {
  version: number
  expiryRules: ExpiryRules
  updatedAt?: string
  updatedBy?: string
}

type RecordStatus =
  | "Healthy"
  | "Watch"
  | "Urgent"
  | "Critical"
  | "Expired"
  | "Archived"

type SourceType = "Manual" | "OCR"

type RecordFamily =
  | "transportation"
  | "driver"
  | "us_filing"
  | "workers"
  | "legacy_bond"

type OcrStatus =
  | "Not Used"
  | "Ready"
  | "Processing"
  | "Needs Review"
  | "Verified"

type CoverageScope =
  | "all_active_fleet"
  | "selected_units"
  | "not_applicable"

type InsuranceEventType =
  | "INSURANCE_RECORD_CREATED"
  | "INSURANCE_RECORD_UPDATED"
  | "INSURANCE_RECORD_ARCHIVED"
  | "INSURANCE_RECORD_RESTORED"
  | "INSURANCE_DOCUMENT_ATTACHED"
  | "INSURANCE_RELATIONSHIP_UPDATED"

type InsuranceEvent = {
  id: string
  type: InsuranceEventType
  timestamp: string
  actor: string
  description: string
}

type InsuranceRecord = {
  id: string
  family: RecordFamily

  type: string
  number: string
  provider: string

  broker?: string
  brokerEmail?: string
  brokerPhone?: string

  limits?: string
  effective: string
  expiry?: string

  coverageScope?: CoverageScope
  linkedVehicleIds?: string[]
  linkedDriverIds?: string[]

  notes?: string

  status: RecordStatus
  source: SourceType

  documentName?: string
  documentType?: string
  documentEvidenceId?: string

  ocrStatus: OcrStatus
  ocrConfidence?: number

  createdAt: string
  updatedAt?: string

  archivedAt?: string
  archivedBy?: string
  archiveReason?: string

  events: InsuranceEvent[]
}

type Company = {
  id: string
  name: string
  region?: string
  regCorpState?: string
  regCorpCountry?: string
}

type VehicleReference = {
  id: string
  label: string
  detail?: string
  archived?: boolean
}

type DriverReference = {
  id: string
  label: string
  detail?: string
  archived?: boolean
}

type RecordDraft = Omit<
  InsuranceRecord,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "status"
  | "archivedAt"
  | "archivedBy"
  | "archiveReason"
  | "events"
>

/* =========================================================
   SETTINGS / CONSTANTS
========================================================= */

const SETTINGS_STORAGE_KEY = "tes_system_settings"

const DEFAULT_EXPIRY_RULES: ExpiryRules = {
  healthyMinDays: 61,
  watchMinDays: 31,
  urgentMinDays: 11,
  criticalMinDays: 0,
  criticalMaxDays: 10,
}

const FAMILY_OPTIONS: Record<
  Exclude<RecordFamily, "legacy_bond">,
  string[]
> = {
  transportation: [
    "Auto Liability",
    "Motor Truck Cargo",
    "General Liability",
    "Physical Damage",
    "Trailer Interchange",
    "Non-Owned Auto",
    "Other Transportation Insurance",
  ],
  driver: [
    "Non-Trucking Liability",
    "Occupational Accident",
    "Driver-Specific Coverage",
    "Other Driver Coverage",
  ],
  us_filing: [
    "BMC-91",
    "BMC-91X",
    "Other U.S. Insurance Filing",
  ],
  workers: [
    "WCB",
    "WSIB",
    "CNESST",
    "Workers Compensation Certificate",
    "Other Workers Compensation Evidence",
  ],
}

/* =========================================================
   HELPERS
========================================================= */

function makeId(prefix: string) {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.floor(
    Math.random() * 10000
  )}`
}

function now() {
  return new Date().toISOString()
}

function loadSystemSettings(): SystemSettings {
  const fallback: SystemSettings = {
    version: 1,
    expiryRules: DEFAULT_EXPIRY_RULES,
  }

  if (typeof window === "undefined") return fallback

  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return fallback

    const parsed = JSON.parse(raw)

    return {
      ...fallback,
      ...parsed,
      expiryRules: {
        ...DEFAULT_EXPIRY_RULES,
        ...(parsed.expiryRules || {}),
      },
    }
  } catch {
    return fallback
  }
}

function getDaysUntilExpiry(expiry?: string) {
  if (!expiry) return null

  const current = new Date()
  const today = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate()
  )
  const expiryDate = new Date(`${expiry}T23:59:59`)

  return Math.ceil(
    (expiryDate.getTime() - today.getTime()) / 86400000
  )
}

function getRecordStatus(
  expiry: string | undefined,
  rules: ExpiryRules,
  archived = false
): RecordStatus {
  if (archived) return "Archived"
  if (!expiry) return "Healthy"

  const days = getDaysUntilExpiry(expiry)
  if (days === null) return "Healthy"
  if (days < 0) return "Expired"

  if (
    days >= rules.criticalMinDays &&
    days <= rules.criticalMaxDays
  ) {
    return "Critical"
  }

  if (
    days >= rules.urgentMinDays &&
    days < rules.watchMinDays
  ) {
    return "Urgent"
  }

  if (
    days >= rules.watchMinDays &&
    days < rules.healthyMinDays
  ) {
    return "Watch"
  }

  return "Healthy"
}

function getStatusClasses(status: RecordStatus) {
  switch (status) {
    case "Healthy":
      return {
        badge:
          "border-emerald-200 bg-emerald-50 text-emerald-800",
        row: "",
        date: "text-emerald-700",
      }
    case "Watch":
      return {
        badge:
          "border-amber-200 bg-amber-50 text-amber-800",
        row: "bg-amber-50/20",
        date: "text-amber-700",
      }
    case "Urgent":
      return {
        badge: "border-red-200 bg-red-50 text-red-700",
        row: "bg-red-50/20",
        date: "text-red-700",
      }
    case "Critical":
      return {
        badge: "border-red-400 bg-red-100 text-red-900",
        row: "bg-red-50/40",
        date: "font-semibold text-red-800",
      }
    case "Expired":
      return {
        badge: "border-red-700 bg-red-950 text-white",
        row: "bg-red-50/60",
        date: "font-bold text-red-950",
      }
    case "Archived":
      return {
        badge: "border-slate-200 bg-slate-50 text-slate-600",
        row: "opacity-60",
        date: "text-muted-foreground",
      }
  }
}

function normalizeIdentifier(value?: string) {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_/]/g, "")
}

function findDuplicateIdentifier(
  records: InsuranceRecord[],
  number: string,
  excludeId?: string
) {
  const normalized = normalizeIdentifier(number)
  if (!normalized) return undefined

  return records.find(
    (record) =>
      record.id !== excludeId &&
      record.status !== "Archived" &&
      record.family !== "legacy_bond" &&
      normalizeIdentifier(record.number) === normalized
  )
}

function appendEvent(
  record: InsuranceRecord,
  type: InsuranceEventType,
  description: string
): InsuranceRecord {
  const timestamp = now()

  return {
    ...record,
    updatedAt: timestamp,
    events: [
      {
        id: makeId("EVT"),
        type,
        timestamp,
        actor: "Current User",
        description,
      },
      ...(record.events || []),
    ],
  }
}

function safeParseArray(key: string) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadReferenceCandidates(keys: string[]) {
  for (const key of keys) {
    const rows = safeParseArray(key)
    if (rows.length) return rows
  }

  return []
}

function loadVehicleReferences(
  companyId: string
): VehicleReference[] {
  const rows = loadReferenceCandidates([
    `tes_company_vehicles_${companyId}`,
    `tes_company_fleet_${companyId}`,
    "tes_vehicles_v5",
    "tes_vehicles",
  ])

  return rows
    .filter(
      (row: any) =>
        !row.companyId || row.companyId === companyId
    )
    .map((row: any, index: number) => {
      const id = String(
        row.id || row.globalId || row.vehicleId || `vehicle-${index}`
      )
      const unit =
        row.unitNumber ||
        row.unit ||
        row.unitNo ||
        row.truckNumber ||
        row.vehicleNumber ||
        row.name ||
        id
      const detail =
        row.vin || row.plate || row.licensePlate || row.makeModel || ""

      return {
        id,
        label: `Unit ${unit}`,
        detail: String(detail || ""),
        archived: Boolean(
          row.isArchived ||
            row.archivedAt ||
            row.status === "Archived"
        ),
      }
    })
}

function loadDriverReferences(
  companyId: string
): DriverReference[] {
  const rows = loadReferenceCandidates([
    `tes_company_drivers_${companyId}`,
    "tes_drivers_v5",
    "tes_drivers",
  ])

  return rows
    .filter(
      (row: any) =>
        !row.companyId || row.companyId === companyId
    )
    .map((row: any, index: number) => {
      const id = String(
        row.id || row.globalId || row.driverId || `driver-${index}`
      )
      const fullName =
        row.name ||
        [row.firstName, row.lastName].filter(Boolean).join(" ") ||
        id
      const detail =
        row.dlNumber || row.licenceNumber || row.licenseNumber || ""

      return {
        id,
        label: String(fullName),
        detail: String(detail || ""),
        archived: Boolean(
          row.isArchived ||
            row.archivedAt ||
            row.status === "Archived"
        ),
      }
    })
}

function inferFamily(type?: string): RecordFamily {
  if (
    [
      "WCB",
      "WSIB",
      "CNESST",
      "Workers Compensation",
      "Workers Compensation Certificate",
      "Occupational Accident",
    ].includes(type || "")
  ) {
    return type === "Occupational Accident" ? "driver" : "workers"
  }

  if (["BMC-91", "BMC-91X"].includes(type || "")) {
    return "us_filing"
  }

  if (
    [
      "US Customs Continuous",
      "Freight Broker BMC-84",
      "Performance Bond",
    ].includes(type || "")
  ) {
    return "legacy_bond"
  }

  return "transportation"
}

function ScanDocumentIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-0">
        <span className="absolute left-0 top-0 h-[35%] w-[35%] rounded-tl-[2px] border-l-[1.5px] border-t-[1.5px] border-current" />
        <span className="absolute right-0 top-0 h-[35%] w-[35%] rounded-tr-[2px] border-r-[1.5px] border-t-[1.5px] border-current" />
        <span className="absolute bottom-0 left-0 h-[35%] w-[35%] rounded-bl-[2px] border-b-[1.5px] border-l-[1.5px] border-current" />
        <span className="absolute bottom-0 right-0 h-[35%] w-[35%] rounded-br-[2px] border-b-[1.5px] border-r-[1.5px] border-current" />
      </span>
      <FileText
        className="relative"
        style={{
          width: size * 0.58,
          height: size * 0.58,
          strokeWidth: 1.8,
        }}
      />
    </span>
  )
}

function StatusBadge({ status }: { status: RecordStatus }) {
  const classes = getStatusClasses(status)

  const icon =
    status === "Healthy" ? (
      <CheckCircle2 className="size-3" />
    ) : status === "Watch" ? (
      <CalendarClock className="size-3" />
    ) : status === "Archived" ? (
      <Archive className="size-3" />
    ) : (
      <AlertTriangle className="size-3" />
    )

  return (
    <Badge variant="outline" className={`gap-1 ${classes.badge}`}>
      {icon}
      {status}
    </Badge>
  )
}

function CopyableValue({
  label,
  value,
}: {
  label: string
  value?: string
}) {
  const [copied, setCopied] = useState(false)

  const copyValue = async () => {
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard access may fail in non-secure local environments.
    }
  }

  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-1">
        <span className="min-w-0 flex-1 select-text truncate text-xs font-medium">
          {value || "Not recorded"}
        </span>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={copyValue}
            title={`Copy ${label}`}
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-600" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

/* =========================================================
   OCR PANEL
========================================================= */

type OCRResult = {
  confidence: number
  type?: string
  number?: string
  provider?: string
  broker?: string
  brokerEmail?: string
  brokerPhone?: string
  limits?: string
  effective?: string
  expiry?: string
}

function OCRDocumentPanel({
  title,
  description,
  onFileSelected,
  onExtractionComplete,
}: {
  title: string
  description: string
  onFileSelected: (file: File | null) => void
  onExtractionComplete: (result: OCRResult) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [reviewReady, setReviewReady] = useState(false)
  const [confidence, setConfidence] = useState<number | null>(null)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
    setProcessing(false)
    setReviewReady(false)
    setConfidence(null)
    if (inputRef.current) inputRef.current.value = ""
    onFileSelected(null)
  }

  const handleFile = (selected: File | null) => {
    if (!selected) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)

    const url = URL.createObjectURL(selected)
    setFile(selected)
    setPreviewUrl(url)
    setProcessing(false)
    setReviewReady(false)
    setConfidence(null)
    onFileSelected(selected)
  }

  const runOCR = async () => {
    if (!file) return

    setProcessing(true)
    setReviewReady(false)

    /*
      TES DOCUMENT INTELLIGENCE INTEGRATION POINT

      Production flow:
      upload original evidence -> quality validation -> classification ->
      extraction -> field confidence -> duplicate check -> human review if
      required -> verified save -> immutable Master Register event.

      Replace ONLY this simulated extraction section later.
    */

    await new Promise((resolve) => setTimeout(resolve, 700))

    // Do not invent policy data during prototype OCR testing.
    const result: OCRResult = { confidence: 90 }

    setConfidence(result.confidence)
    setProcessing(false)
    setReviewReady(true)
    onExtractionComplete(result)
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div className="border-b bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ScanDocumentIcon size={18} />
            </div>
            <div>
              <h4 className="text-sm font-semibold">{title}</h4>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          </div>

          {file && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={clearFile}
              title="Remove document"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center p-10 text-center transition-colors hover:bg-muted/20"
        >
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ScanDocumentIcon size={23} />
          </div>
          <p className="text-sm font-semibold">Upload insurance evidence</p>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Select a PDF, JPG or PNG. The original evidence stays associated
            with the record; OCR only assists data entry.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs font-medium shadow-sm">
            <Upload className="size-3.5" />
            Choose File
          </div>
        </button>
      ) : (
        <div className="grid min-h-[400px] lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.45fr)]">
          <div className="border-b bg-muted/10 p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Original Evidence
                </p>
                <p className="mt-1 max-w-[500px] truncate text-xs font-medium">
                  {file.name}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => inputRef.current?.click()}
                >
                  <RefreshCcw className="mr-1.5 size-3.5" />
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    previewUrl &&
                    window.open(previewUrl, "_blank", "noopener,noreferrer")
                  }
                >
                  <Eye className="mr-1.5 size-3.5" />
                  Full View
                </Button>
              </div>
            </div>

            <div className="flex h-[330px] items-center justify-center overflow-hidden rounded-lg border bg-background">
              {file.type === "application/pdf" ? (
                <iframe
                  src={previewUrl || undefined}
                  className="h-full w-full"
                  title="Insurance document preview"
                />
              ) : (
                <img
                  src={previewUrl || undefined}
                  alt="Insurance document preview"
                  className="h-full w-full object-contain"
                />
              )}
            </div>
          </div>

          <div className="flex flex-col p-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Document Intelligence
              </p>
              <div className="mt-5 space-y-4">
                <ProcessStep
                  complete
                  title="Evidence uploaded"
                  description="Original source is ready for comparison."
                />
                <ProcessStep
                  complete={reviewReady}
                  processing={processing}
                  title={
                    processing
                      ? "Reading document..."
                      : reviewReady
                        ? "Extraction complete"
                        : "OCR ready"
                  }
                  description={
                    reviewReady
                      ? "Review every populated field against the original."
                      : "Run OCR to extract available insurance information."
                  }
                />
              </div>

              {confidence !== null && (
                <div className="mt-5 rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      OCR confidence
                    </span>
                    <span className="text-sm font-bold">{confidence}%</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Testing value only. Production acceptance uses central TES
                    Document Intelligence rules and field-level confidence.
                  </p>
                </div>
              )}
            </div>

            {!reviewReady ? (
              <Button
                type="button"
                className="mt-auto"
                onClick={runOCR}
                disabled={processing}
              >
                {processing ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <ScanDocumentIcon size={15} />
                    <span className="ml-2">Run OCR</span>
                  </>
                )}
              </Button>
            ) : (
              <div className="mt-auto rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
                  <p className="text-xs leading-relaxed text-amber-900">
                    OCR does not create authoritative compliance data. Review
                    the extraction and save only after verification.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(event) =>
          handleFile(event.target.files?.[0] || null)
        }
      />
    </div>
  )
}

function ProcessStep({
  complete = false,
  processing = false,
  title,
  description,
}: {
  complete?: boolean
  processing?: boolean
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
          processing
            ? "bg-blue-100 text-blue-700"
            : complete
              ? "bg-emerald-100 text-emerald-700"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {processing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : complete ? (
          <Check className="size-3.5" />
        ) : (
          <ScanDocumentIcon size={13} />
        )}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}

/* =========================================================
   RELATIONSHIP PICKER
========================================================= */

function ReferencePicker({
  label,
  description,
  items,
  selectedIds,
  onChange,
  emptyText,
}: {
  label: string
  description: string
  items: Array<VehicleReference | DriverReference>
  selectedIds: string[]
  onChange: (ids: string[]) => void
  emptyText: string
}) {
  const activeItems = items.filter((item) => !item.archived)

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((current) => current !== id)
        : [...selectedIds, id]
    )
  }

  return (
    <div className="space-y-2 sm:col-span-2 lg:col-span-3">
      <div>
        <Label>{label}</Label>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {description}
        </p>
      </div>

      {activeItems.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/10 p-4 text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeItems.map((item) => {
            const checked = selectedIds.includes(item.id)
            return (
              <label
                key={item.id}
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors ${
                  checked
                    ? "border-primary/40 bg-primary/[0.04]"
                    : "hover:bg-muted/20"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={checked}
                  onChange={() => toggle(item.id)}
                />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold">
                    {item.label}
                  </span>
                  {item.detail && (
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {item.detail}
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* =========================================================
   RECORD FORM - ADD + EDIT
========================================================= */

function RecordForm({
  title,
  recordType,
  records,
  vehicles,
  drivers,
  initialSource,
  initialRecord,
  onSave,
  onCancel,
}: {
  title: string
  recordType: Exclude<RecordFamily, "legacy_bond">
  records: InsuranceRecord[]
  vehicles: VehicleReference[]
  drivers: DriverReference[]
  initialSource: SourceType
  initialRecord?: InsuranceRecord
  onSave: (record: RecordDraft) => void
  onCancel: () => void
}) {
  const [source, setSource] = useState<SourceType>(
    initialRecord?.source || initialSource
  )
  const [document, setDocument] = useState<File | null>(null)
  const [ocrConfidence, setOcrConfidence] = useState<number | undefined>(
    initialRecord?.ocrConfidence
  )

  const [type, setType] = useState(initialRecord?.type || "")
  const [number, setNumber] = useState(initialRecord?.number || "")
  const [provider, setProvider] = useState(initialRecord?.provider || "")
  const [broker, setBroker] = useState(initialRecord?.broker || "")
  const [brokerEmail, setBrokerEmail] = useState(
    initialRecord?.brokerEmail || ""
  )
  const [brokerPhone, setBrokerPhone] = useState(
    initialRecord?.brokerPhone || ""
  )
  const [limits, setLimits] = useState(initialRecord?.limits || "")
  const [effective, setEffective] = useState(initialRecord?.effective || "")
  const [expiry, setExpiry] = useState(initialRecord?.expiry || "")
  const [coverageScope, setCoverageScope] = useState<CoverageScope>(
    initialRecord?.coverageScope ||
      (recordType === "transportation"
        ? "all_active_fleet"
        : "not_applicable")
  )
  const [linkedVehicleIds, setLinkedVehicleIds] = useState<string[]>(
    initialRecord?.linkedVehicleIds || []
  )
  const [linkedDriverIds, setLinkedDriverIds] = useState<string[]>(
    initialRecord?.linkedDriverIds || []
  )
  const [notes, setNotes] = useState(initialRecord?.notes || "")
  const [error, setError] = useState<string | null>(null)

  const duplicate = useMemo(
    () =>
      findDuplicateIdentifier(
        records,
        number,
        initialRecord?.id
      ),
    [records, number, initialRecord?.id]
  )

  const applyOCRResult = (result: OCRResult) => {
    setOcrConfidence(result.confidence)
    if (result.type) setType(result.type)
    if (result.number) setNumber(result.number)
    if (result.provider) setProvider(result.provider)
    if (result.broker) setBroker(result.broker)
    if (result.brokerEmail) setBrokerEmail(result.brokerEmail)
    if (result.brokerPhone) setBrokerPhone(result.brokerPhone)
    if (result.limits) setLimits(result.limits)
    if (result.effective) setEffective(result.effective)
    if (result.expiry) setExpiry(result.expiry)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!type) return setError("Select a record type.")
    if (!number.trim()) return setError("Policy / filing number is required.")
    if (!provider.trim()) return setError("Carrier / provider is required.")
    if (!effective) return setError("Effective date is required.")

    if (recordType !== "us_filing" && !expiry) {
      return setError("Expiry date is required for this record.")
    }

    if (
      effective &&
      expiry &&
      new Date(expiry) < new Date(effective)
    ) {
      return setError("Expiry date cannot be earlier than the effective date.")
    }

    if (duplicate) {
      return setError(
        `Possible duplicate: ${duplicate.type} already uses ${duplicate.number}.`
      )
    }

    if (
      recordType === "transportation" &&
      coverageScope === "selected_units" &&
      linkedVehicleIds.length === 0
    ) {
      return setError("Select at least one covered vehicle or choose all active fleet.")
    }

    if (recordType === "driver" && linkedDriverIds.length === 0) {
      return setError("Link this coverage to at least one existing driver record.")
    }

    const newDocumentName = document?.name || initialRecord?.documentName
    const newDocumentType = document?.type || initialRecord?.documentType

    onSave({
      family: recordType,
      type,
      number: number.trim(),
      provider: provider.trim(),
      broker: broker.trim(),
      brokerEmail: brokerEmail.trim(),
      brokerPhone: brokerPhone.trim(),
      limits: limits.trim(),
      effective,
      expiry,
      coverageScope:
        recordType === "transportation"
          ? coverageScope
          : "not_applicable",
      linkedVehicleIds:
        recordType === "transportation" &&
        coverageScope === "selected_units"
          ? linkedVehicleIds
          : [],
      linkedDriverIds:
        recordType === "driver" ? linkedDriverIds : [],
      notes: notes.trim(),
      source,
      documentName: newDocumentName,
      documentType: newDocumentType,
      documentEvidenceId: initialRecord?.documentEvidenceId,
      ocrStatus:
        source === "OCR"
          ? document
            ? "Needs Review"
            : initialRecord?.ocrStatus || "Needs Review"
          : "Not Used",
      ocrConfidence,
    })
  }

  const providerLabel =
    recordType === "workers"
      ? "Issuing Board / Provider *"
      : recordType === "us_filing"
        ? "Insurance Carrier / Filing Provider *"
        : "Insurance Carrier *"

  return (
    <form onSubmit={submit} className="border-b bg-primary/[0.02]">
      <div className="border-b p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {initialRecord
                ? "Update the record without destroying its history. Changes are audit events."
                : "Create a structured insurance record from verified evidence or manual entry."}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>

        {!initialRecord && (
          <div className="mt-4 flex w-fit rounded-lg border bg-background p-1">
            <button
              type="button"
              onClick={() => {
                setSource("Manual")
                setError(null)
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                source === "Manual"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Manual Entry
            </button>
            <button
              type="button"
              onClick={() => {
                setSource("OCR")
                setError(null)
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                source === "OCR"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <ScanDocumentIcon size={13} />
                Scan Document
              </span>
            </button>
          </div>
        )}
      </div>

      {source === "OCR" && (
        <div className="border-b p-5">
          <OCRDocumentPanel
            title="Insurance Evidence"
            description="Upload the original policy, certificate, filing evidence or workers compensation certificate."
            onFileSelected={setDocument}
            onExtractionComplete={applyOCRResult}
          />
        </div>
      )}

      <div className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>Record Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {FAMILY_OPTIONS[recordType].map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>
              {recordType === "us_filing"
                ? "Filing / Policy Number *"
                : recordType === "workers"
                  ? "Account / Certificate Number *"
                  : "Policy Number *"}
            </Label>
            <Input
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
            {duplicate && (
              <p className="flex items-start gap-1.5 text-[11px] font-medium text-red-700">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                Duplicate identifier found in {duplicate.type}.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Coverage Limit / Detail</Label>
            <Input
              value={limits}
              onChange={(event) => setLimits(event.target.value)}
              placeholder="e.g. $1,000,000"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>{providerLabel}</Label>
            <Input
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            />
          </div>

          {recordType === "transportation" && (
            <div className="space-y-2">
              <Label>Broker / Agency</Label>
              <Input
                value={broker}
                onChange={(event) => setBroker(event.target.value)}
              />
            </div>
          )}

          {recordType === "transportation" && (
            <>
              <div className="space-y-2">
                <Label>Broker Email</Label>
                <Input
                  type="email"
                  value={brokerEmail}
                  onChange={(event) => setBrokerEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Broker Phone</Label>
                <Input
                  value={brokerPhone}
                  onChange={(event) => setBrokerPhone(event.target.value)}
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label>Effective Date *</Label>
            <Input
              type="date"
              value={effective}
              onChange={(event) => setEffective(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>
              Expiry Date{recordType !== "us_filing" ? " *" : ""}
            </Label>
            <Input
              type="date"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            />
            {recordType === "us_filing" && (
              <p className="text-[11px] text-muted-foreground">
                Leave blank only where the filing evidence itself has no stated expiry.
              </p>
            )}
          </div>

          {recordType === "transportation" && (
            <div className="space-y-2">
              <Label>Fleet Coverage Scope *</Label>
              <Select
                value={coverageScope}
                onValueChange={(value) =>
                  setCoverageScope(value as CoverageScope)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_active_fleet">
                    All Active Fleet Units
                  </SelectItem>
                  <SelectItem value="selected_units">
                    Selected Units Only
                  </SelectItem>
                  <SelectItem value="not_applicable">
                    Not Unit-Specific
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {recordType === "transportation" &&
            coverageScope === "selected_units" && (
              <ReferencePicker
                label="Covered Fleet Units"
                description="Link the policy to existing vehicle master records."
                items={vehicles}
                selectedIds={linkedVehicleIds}
                onChange={setLinkedVehicleIds}
                emptyText="No active vehicle records were found for this company. Add the fleet record first, then link it here."
              />
            )}

          {recordType === "driver" && (
            <ReferencePicker
              label="Covered Drivers *"
              description="Link coverage to existing Driver Master records rather than duplicating driver identity."
              items={drivers}
              selectedIds={linkedDriverIds}
              onChange={setLinkedDriverIds}
              emptyText="No active driver records were found for this company. Add the driver first, then link the coverage here."
            />
          )}

          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Operational context, renewal instruction, endorsement detail or verification note."
              className="min-h-[90px]"
            />
          </div>
        </div>

        {source === "OCR" && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
              <div>
                <p className="text-xs font-semibold text-amber-900">
                  Human verification before save
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  Compare populated fields with the original evidence. OCR never
                  silently creates or changes authoritative compliance data.
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p className="text-xs font-medium">{error}</p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={Boolean(duplicate)}>
            <Check className="mr-2 size-4" />
            {initialRecord ? "Save Changes" : "Verify & Save"}
          </Button>
        </div>
      </div>
    </form>
  )
}

/* =========================================================
   ARCHIVE / HISTORY
========================================================= */

function ArchivePanel({
  record,
  onConfirm,
  onCancel,
}: {
  record: InsuranceRecord
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState("")

  return (
    <div className="border-b border-amber-200 bg-amber-50/60 p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
          <Archive className="size-4" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold">Archive {record.type}</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The record remains permanently retained as historical evidence. It
            is removed only from normal operational views.
          </p>
          <div className="mt-4 max-w-xl space-y-2">
            <Label>Archive Reason *</Label>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Replaced by renewal policy"
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!reason.trim()}
              onClick={() => onConfirm(reason.trim())}
            >
              <Archive className="mr-2 size-4" />
              Confirm Archive
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HistoryPanel({
  record,
  onClose,
}: {
  record: InsuranceRecord
  onClose: () => void
}) {
  return (
    <div className="border-b bg-muted/10 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4" />
            Record History
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Prototype event history. Production events also write to the immutable Master Register.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {(record.events || []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No event history recorded.</p>
        ) : (
          record.events.map((event) => (
            <div key={event.id} className="rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">{event.description}</p>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {event.type} · {event.actor}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* =========================================================
   RECORD ROW
========================================================= */

function RecordRow({
  record,
  vehicles,
  drivers,
  onEdit,
  onArchive,
  onRestore,
  onHistory,
}: {
  record: InsuranceRecord
  vehicles: VehicleReference[]
  drivers: DriverReference[]
  onEdit: (record: InsuranceRecord) => void
  onArchive: (record: InsuranceRecord) => void
  onRestore: (record: InsuranceRecord) => void
  onHistory: (record: InsuranceRecord) => void
}) {
  const classes = getStatusClasses(record.status)
  const days = getDaysUntilExpiry(record.expiry)

  const coveredUnits =
    record.coverageScope === "all_active_fleet"
      ? "All active fleet units"
      : (record.linkedVehicleIds || [])
          .map((id) => vehicles.find((vehicle) => vehicle.id === id)?.label)
          .filter(Boolean)
          .join(", ")

  const coveredDrivers = (record.linkedDriverIds || [])
    .map((id) => drivers.find((driver) => driver.id === id)?.label)
    .filter(Boolean)
    .join(", ")

  return (
    <div className={`p-4 transition-colors hover:bg-muted/20 ${classes.row}`}>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr_0.8fr_0.9fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{record.type}</p>
            {record.source === "OCR" && (
              <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
                <ScanDocumentIcon size={10} />
                <span className="ml-1">OCR</span>
              </Badge>
            )}
          </div>
          <div className="mt-2">
            <CopyableValue label="Policy / Filing #" value={record.number} />
          </div>
          {record.documentName && (
            <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
              <FileText className="size-3" />
              <span className="truncate">{record.documentName}</span>
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <CopyableValue label="Carrier / Provider" value={record.provider} />
          {record.broker && (
            <CopyableValue label="Broker / Agency" value={record.broker} />
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Coverage
          </p>
          <p className="mt-1 text-xs font-medium">{record.limits || "Not recorded"}</p>
          {record.family === "transportation" && coveredUnits && (
            <p className="mt-2 line-clamp-2 text-[10px] text-muted-foreground">
              {coveredUnits}
            </p>
          )}
          {record.family === "driver" && coveredDrivers && (
            <p className="mt-2 line-clamp-2 text-[10px] text-muted-foreground">
              {coveredDrivers}
            </p>
          )}
        </div>

        <div className="text-xs">
          <p className="text-muted-foreground">Effective: {record.effective || "—"}</p>
          <p className={`mt-1 ${classes.date}`}>
            Expiry: {record.expiry || "No stated expiry"}
          </p>
          {record.expiry && days !== null && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {days < 0
                ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} expired`
                : days === 0
                  ? "Expires today"
                  : `${days} day${days === 1 ? "" : "s"} remaining`}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-start justify-start gap-1 lg:justify-end">
          <StatusBadge status={record.status} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            title="View history"
            onClick={() => onHistory(record)}
          >
            <History className="size-4" />
          </Button>
          {record.status === "Archived" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              title="Restore record"
              onClick={() => onRestore(record)}
            >
              <ArchiveRestore className="size-4" />
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                title="Edit record"
                onClick={() => onEdit(record)}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                title="Archive record"
                onClick={() => onArchive(record)}
              >
                <Archive className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {(record.brokerEmail || record.brokerPhone || record.notes) && (
        <div className="mt-4 grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {record.brokerEmail && (
            <CopyableValue label="Broker Email" value={record.brokerEmail} />
          )}
          {record.brokerPhone && (
            <CopyableValue label="Broker Phone" value={record.brokerPhone} />
          )}
          {record.notes && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Notes
              </p>
              <p className="mt-1 whitespace-pre-wrap text-xs">{record.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* =========================================================
   INSURANCE SECTION
========================================================= */

function InsuranceSection({
  title,
  description,
  icon,
  records,
  allRecords,
  recordType,
  vehicles,
  drivers,
  onCreate,
  onUpdate,
  onArchive,
  onRestore,
}: {
  title: string
  description: string
  icon: React.ReactNode
  records: InsuranceRecord[]
  allRecords: InsuranceRecord[]
  recordType: Exclude<RecordFamily, "legacy_bond">
  vehicles: VehicleReference[]
  drivers: DriverReference[]
  onCreate: (record: RecordDraft) => void
  onUpdate: (id: string, record: RecordDraft) => void
  onArchive: (id: string, reason: string) => void
  onRestore: (id: string) => void
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [initialSource, setInitialSource] = useState<SourceType>("Manual")
  const [editTarget, setEditTarget] = useState<InsuranceRecord | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<InsuranceRecord | null>(null)
  const [historyTarget, setHistoryTarget] = useState<InsuranceRecord | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const activeRecords = records.filter((record) => record.status !== "Archived")
  const archivedRecords = records.filter((record) => record.status === "Archived")
  const visibleRecords = showArchived
    ? [...activeRecords, ...archivedRecords]
    : activeRecords

  const openForm = (source: SourceType) => {
    setInitialSource(source)
    setEditTarget(null)
    setArchiveTarget(null)
    setHistoryTarget(null)
    setFormOpen(true)
  }

  const startEdit = (record: InsuranceRecord) => {
    setFormOpen(false)
    setArchiveTarget(null)
    setHistoryTarget(null)
    setEditTarget(record)
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20 py-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              {icon}
              {title}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              {description}
            </CardDescription>
          </div>

          {!formOpen && !editTarget && (
            <div className="flex flex-wrap items-center gap-2">
              {archivedRecords.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowArchived((value) => !value)}
                >
                  {showArchived ? "Hide Archived" : `Archived (${archivedRecords.length})`}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => openForm("OCR")}>
                <ScanDocumentIcon size={14} />
                <span className="ml-1.5">Scan Document</span>
              </Button>
              <Button size="sm" onClick={() => openForm("Manual")}>
                <Plus className="mr-1.5 size-4" />
                Manual Add
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {formOpen && (
          <RecordForm
            key={`${recordType}-${initialSource}-new`}
            title={`Add ${title} Record`}
            recordType={recordType}
            records={allRecords}
            vehicles={vehicles}
            drivers={drivers}
            initialSource={initialSource}
            onCancel={() => setFormOpen(false)}
            onSave={(record) => {
              onCreate(record)
              setFormOpen(false)
            }}
          />
        )}

        {editTarget && (
          <RecordForm
            key={`${editTarget.id}-edit`}
            title={`Edit ${editTarget.type}`}
            recordType={recordType}
            records={allRecords}
            vehicles={vehicles}
            drivers={drivers}
            initialSource={editTarget.source}
            initialRecord={editTarget}
            onCancel={() => setEditTarget(null)}
            onSave={(record) => {
              onUpdate(editTarget.id, record)
              setEditTarget(null)
            }}
          />
        )}

        {archiveTarget && (
          <ArchivePanel
            record={archiveTarget}
            onCancel={() => setArchiveTarget(null)}
            onConfirm={(reason) => {
              onArchive(archiveTarget.id, reason)
              setArchiveTarget(null)
            }}
          />
        )}

        {historyTarget && (
          <HistoryPanel
            record={historyTarget}
            onClose={() => setHistoryTarget(null)}
          />
        )}

        {visibleRecords.length === 0 ? (
          <div className="p-10 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {icon}
            </div>
            <p className="mt-3 text-sm font-medium">No active records</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Scan source evidence for assisted extraction or create the record manually.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {visibleRecords.map((record) => (
              <RecordRow
                key={record.id}
                record={record}
                vehicles={vehicles}
                drivers={drivers}
                onEdit={startEdit}
                onArchive={setArchiveTarget}
                onRestore={(target) => onRestore(target.id)}
                onHistory={setHistoryTarget}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* =========================================================
   SUMMARY
========================================================= */

function SummaryCard({
  label,
  value,
  status,
}: {
  label: string
  value: number
  status: RecordStatus
}) {
  return (
    <Card className={getStatusClasses(status).row}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {status === "Healthy" ? (
            <CheckCircle2 className="size-4 text-emerald-600" />
          ) : status === "Archived" ? (
            <Archive className="size-4 text-muted-foreground" />
          ) : status === "Expired" ? (
            <XCircle className="size-4 text-red-950" />
          ) : (
            <AlertTriangle className="size-4 text-amber-700" />
          )}
        </div>
        <p className="mt-2 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  )
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function InsurancePage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string

  const [company, setCompany] = useState<Company | null>(null)
  const [records, setRecords] = useState<InsuranceRecord[]>([])
  const [vehicles, setVehicles] = useState<VehicleReference[]>([])
  const [drivers, setDrivers] = useState<DriverReference[]>([])
  const [settings, setSettings] = useState<SystemSettings>({
    version: 1,
    expiryRules: DEFAULT_EXPIRY_RULES,
  })
  const [loading, setLoading] = useState(true)

  const storageKey = `tes_company_insurance_${companyId}`

  useEffect(() => {
    try {
      const savedCompanies = JSON.parse(
        localStorage.getItem("tes_companies") || "[]"
      )
      const found = savedCompanies.find(
        (item: Company) => item.id === companyId
      )
      setCompany(found || null)

      const savedRecords = safeParseArray(storageKey)

      const migrated = savedRecords.map(
        (record: any): InsuranceRecord => ({
          ...record,
          family: record.family
            ? record.family === "bond"
              ? "legacy_bond"
              : record.family
            : inferFamily(record.type),
          provider: record.provider || record.company || "",
          linkedVehicleIds: record.linkedVehicleIds || [],
          linkedDriverIds: record.linkedDriverIds || [],
          events: record.events || [],
          ocrStatus:
            record.ocrStatus ||
            (record.source === "OCR" ? "Needs Review" : "Not Used"),
        })
      )

      setRecords(migrated)
      setVehicles(loadVehicleReferences(companyId))
      setDrivers(loadDriverReferences(companyId))
      setSettings(loadSystemSettings())
    } catch (error) {
      console.error("Unable to load insurance page:", error)
    } finally {
      setLoading(false)
    }
  }, [companyId, storageKey])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_STORAGE_KEY) {
        setSettings(loadSystemSettings())
      }
    }

    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  useEffect(() => {
    if (!loading) {
      localStorage.setItem(storageKey, JSON.stringify(records))
    }
  }, [records, loading, storageKey])

  const normalizedRecords = useMemo(
    () =>
      records.map((record) => ({
        ...record,
        status: getRecordStatus(
          record.expiry,
          settings.expiryRules,
          Boolean(record.archivedAt) || record.status === "Archived"
        ),
      })),
    [records, settings.expiryRules]
  )

  const operationalRecords = normalizedRecords.filter(
    (record) => record.family !== "legacy_bond"
  )

  const summary = useMemo(() => {
    const count = (status: RecordStatus) =>
      operationalRecords.filter((record) => record.status === status).length

    return {
      healthy: count("Healthy"),
      watch: count("Watch"),
      urgent: count("Urgent"),
      critical: count("Critical"),
      expired: count("Expired"),
      archived: count("Archived"),
    }
  }, [operationalRecords])

  const createRecord = (draft: RecordDraft) => {
    const duplicate = findDuplicateIdentifier(normalizedRecords, draft.number)
    if (duplicate) {
      window.alert(
        `Duplicate identifier detected. ${duplicate.type} already uses ${duplicate.number}.`
      )
      return
    }

    const timestamp = now()
    const id = makeId(`${companyId}-INS`)

    const newRecord: InsuranceRecord = {
      ...draft,
      id,
      createdAt: timestamp,
      status: getRecordStatus(draft.expiry, settings.expiryRules),
      events: [
        {
          id: makeId("EVT"),
          type: "INSURANCE_RECORD_CREATED",
          timestamp,
          actor: "Current User",
          description: `${draft.type} record created.`,
        },
      ],
    }

    setRecords((current) => [newRecord, ...current])

    /*
      MASTER REGISTER INTEGRATION POINT:
      INSURANCE_RECORD_CREATED with actor, role, companyId, recordId,
      source, timestamp and durable evidence ID.
    */
  }

  const updateRecord = (id: string, draft: RecordDraft) => {
    const duplicate = findDuplicateIdentifier(
      normalizedRecords,
      draft.number,
      id
    )

    if (duplicate) {
      window.alert(
        `Duplicate identifier detected. ${duplicate.type} already uses ${duplicate.number}.`
      )
      return
    }

    setRecords((current) =>
      current.map((record) => {
        if (record.id !== id) return record

        const updated = appendEvent(
          {
            ...record,
            ...draft,
            id: record.id,
            createdAt: record.createdAt,
            status: getRecordStatus(
              draft.expiry,
              settings.expiryRules,
              Boolean(record.archivedAt)
            ),
            events: record.events || [],
          },
          "INSURANCE_RECORD_UPDATED",
          `${draft.type} record updated.`
        )

        return updated
      })
    )

    /* MASTER REGISTER: INSURANCE_RECORD_UPDATED */
  }

  const archiveRecord = (id: string, reason: string) => {
    setRecords((current) =>
      current.map((record) => {
        if (record.id !== id) return record

        const timestamp = now()
        return appendEvent(
          {
            ...record,
            status: "Archived",
            archivedAt: timestamp,
            archivedBy: "Current User",
            archiveReason: reason,
          },
          "INSURANCE_RECORD_ARCHIVED",
          `${record.type} archived: ${reason}`
        )
      })
    )

    /* MASTER REGISTER: INSURANCE_RECORD_ARCHIVED */
  }

  const restoreRecord = (id: string) => {
    setRecords((current) =>
      current.map((record) => {
        if (record.id !== id) return record

        const restored: InsuranceRecord = {
          ...record,
          archivedAt: undefined,
          archivedBy: undefined,
          archiveReason: undefined,
          status: getRecordStatus(record.expiry, settings.expiryRules),
        }

        return appendEvent(
          restored,
          "INSURANCE_RECORD_RESTORED",
          `${record.type} restored to operational view.`
        )
      })
    )

    /* MASTER REGISTER: INSURANCE_RECORD_RESTORED */
  }

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center p-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-10 text-center">
        <Building2 className="size-10 text-muted-foreground/40" />
        <div>
          <h2 className="text-lg font-semibold">Company Not Found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The requested company record could not be loaded.
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push("/companies")}>
          <ArrowLeft className="mr-2 size-4" />
          Return to Companies
        </Button>
      </div>
    )
  }

  const transportationRecords = normalizedRecords.filter(
    (record) => record.family === "transportation"
  )
  const driverRecords = normalizedRecords.filter(
    (record) => record.family === "driver"
  )
  const usFilingRecords = normalizedRecords.filter(
    (record) => record.family === "us_filing"
  )
  const workersRecords = normalizedRecords.filter(
    (record) => record.family === "workers"
  )
  const legacyBondRecords = normalizedRecords.filter(
    (record) => record.family === "legacy_bond"
  )

  return (
    <div className="flex max-w-7xl flex-col gap-6 pb-12">
      <div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => router.push(`/companies/${company.id}/profile`)}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Insurance & Coverage
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {company.name}{" "}
              <span className="font-mono text-xs">({company.id})</span>
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Registered Origin
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                <Building2 className="size-3.5 text-primary" />
                {company.regCorpState || "Unknown"}, {company.regCorpCountry || "Unknown"}
              </p>
            </div>
            <div className="hidden h-8 w-px bg-border sm:block" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Operating Region
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                <CheckCircle2 className="size-3.5 text-primary" />
                {company.region || "Not specified"}
              </p>
            </div>
            <div className="hidden h-8 w-px bg-border lg:block" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Relationship Sources
              </p>
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                {vehicles.filter((item) => !item.archived).length} active vehicles · {drivers.filter((item) => !item.archived).length} active drivers
              </p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Renewal Position</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Live classification based on central Portal Settings rules.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => {
              setSettings(loadSystemSettings())
              setVehicles(loadVehicleReferences(companyId))
              setDrivers(loadDriverReferences(companyId))
            }}
          >
            <RefreshCcw className="mr-1.5 size-3.5" />
            Refresh Relationships
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SummaryCard label="Healthy" value={summary.healthy} status="Healthy" />
          <SummaryCard label="Watch" value={summary.watch} status="Watch" />
          <SummaryCard label="Urgent" value={summary.urgent} status="Urgent" />
          <SummaryCard label="Critical" value={summary.critical} status="Critical" />
          <SummaryCard label="Expired" value={summary.expired} status="Expired" />
          <SummaryCard label="Archived" value={summary.archived} status="Archived" />
        </div>
      </div>

      <InsuranceSection
        title="Fleet & Commercial Insurance"
        description="Auto liability, cargo, general liability, physical damage and other commercial fleet coverage linked to real vehicle records where applicable."
        icon={<Truck className="size-4 text-primary" />}
        recordType="transportation"
        records={transportationRecords}
        allRecords={normalizedRecords}
        vehicles={vehicles}
        drivers={drivers}
        onCreate={createRecord}
        onUpdate={updateRecord}
        onArchive={archiveRecord}
        onRestore={restoreRecord}
      />

      <InsuranceSection
        title="Driver-Specific Coverage"
        description="Coverage that genuinely applies to individual drivers, linked to existing Driver Master records rather than duplicated identities."
        icon={<UserRound className="size-4 text-primary" />}
        recordType="driver"
        records={driverRecords}
        allRecords={normalizedRecords}
        vehicles={vehicles}
        drivers={drivers}
        onCreate={createRecord}
        onUpdate={updateRecord}
        onArchive={archiveRecord}
        onRestore={restoreRecord}
      />

      <InsuranceSection
        title="U.S. Insurance Filings"
        description="Insurance-specific U.S. filing evidence such as BMC-91 and BMC-91X. Customs, permit and other surety bonds do not belong in this module."
        icon={<ShieldCheck className="size-4 text-primary" />}
        recordType="us_filing"
        records={usFilingRecords}
        allRecords={normalizedRecords}
        vehicles={vehicles}
        drivers={drivers}
        onCreate={createRecord}
        onUpdate={updateRecord}
        onArchive={archiveRecord}
        onRestore={restoreRecord}
      />

      <InsuranceSection
        title="Workers Compensation"
        description="Active WCB, WSIB, CNESST or equivalent certificate evidence only. Account credentials remain in the separate access/credentials system."
        icon={<HardHat className="size-4 text-primary" />}
        recordType="workers"
        records={workersRecords}
        allRecords={normalizedRecords}
        vehicles={vehicles}
        drivers={drivers}
        onCreate={createRecord}
        onUpdate={updateRecord}
        onArchive={archiveRecord}
        onRestore={restoreRecord}
      />

      {legacyBondRecords.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                <ClipboardList className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {legacyBondRecords.length} legacy bond record{legacyBondRecords.length === 1 ? "" : "s"} retained
                </p>
                <p className="mt-1 max-w-4xl text-xs leading-relaxed text-amber-900/80">
                  Earlier versions stored customs, freight-broker or performance bonds inside Insurance. Those records have not been deleted. They are retained for historical migration, but they are excluded from Insurance status calculations because the dedicated Customs/Bonds module owns them going forward.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-dashed bg-muted/10">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <History className="size-4" />
            </div>
            <div>
              <p className="text-xs font-semibold">Compliance record integrity</p>
              <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
                Insurance records are evidence-backed, editable through auditable updates and archived rather than deleted. Relationships point to existing company, driver and vehicle records. OCR assists extraction but never silently changes authoritative compliance information. Production events should also be written to the immutable TES Master Register.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
